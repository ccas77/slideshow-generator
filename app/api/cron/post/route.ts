import { NextRequest, NextResponse } from "next/server";
import {
  getAccountData,
  setAccountData,
  getBooks,
  getTopNLists,
  getIgAutomation,
  getIgSlideshows,
  setIgAutomation,
} from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { listTikTokAccounts, pbFetch, uploadPng } from "@/lib/post-bridge";
import { publishTopN } from "@/lib/topn-publisher";

export const maxDuration = 300; // 5 min for Hobby

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomTimeInWindow(windowStart: string, windowEnd: string): Date {
  const [sh, sm] = windowStart.split(":").map(Number);
  const [eh, em] = windowEnd.split(":").map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin = startMin + 60;
  const pickMin = startMin + Math.floor(Math.random() * (endMin - startMin));

  const now = new Date();
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      Math.floor(pickMin / 60),
      pickMin % 60,
      0,
      0
    )
  );
  if (target.getTime() <= now.getTime() + 60_000) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target;
}

interface Job {
  acc: { id: number; username: string };
  win: { start: string; end: string };
  imagePrompt: string;
  slideTexts: string[];
  captionText: string;
  source: string;
  coverImage?: string;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    accountId: number;
    username: string;
    status: string;
  }> = [];

  try {
    const accounts = await listTikTokAccounts();
    const books = await getBooks();

    // Phase 1: Build all jobs (fast, no I/O-heavy work)
    const jobs: Job[] = [];
    const accountData = new Map<number, Awaited<ReturnType<typeof getAccountData>>>();

    for (const acc of accounts) {
      try {
        const data = await getAccountData(acc.id);
        accountData.set(acc.id, data);
        if (!data.config.enabled) continue;

        let windows: Array<{ start: string; end: string }> = [];
        if (data.config.intervals && data.config.intervals.length > 0) {
          windows = data.config.intervals;
        } else {
          windows.push({
            start: data.config.windowStart,
            end: data.config.windowEnd,
          });
          if (data.config.windowStart2 && data.config.windowEnd2) {
            windows.push({
              start: data.config.windowStart2,
              end: data.config.windowEnd2,
            });
          }
        }

        for (const win of windows) {
          let imagePrompt = "";
          let slideTexts: string[] = [];
          let captionText = "";
          let source = "";
          let coverImage: string | undefined;

          const { bookId, slideshowIds, selections } = data.config;
          const candidates: Array<{
            book: (typeof books)[0];
            slideshow: (typeof books)[0]["slideshows"][0];
          }> = [];

          if (selections && selections.length > 0) {
            for (const sel of selections) {
              const book = books.find((b) => b.id === sel.bookId);
              const slideshow = book?.slideshows.find(
                (s) => s.id === sel.slideshowId
              );
              if (book && slideshow) candidates.push({ book, slideshow });
            }
          } else if (bookId && slideshowIds && slideshowIds.length > 0) {
            const book = books.find((b) => b.id === bookId);
            if (book) {
              for (const sid of slideshowIds) {
                const slideshow = book.slideshows.find((s) => s.id === sid);
                if (slideshow) candidates.push({ book, slideshow });
              }
            }
          }

          if (candidates.length > 0) {
            const picked = pickRandom(candidates);
            if (!picked || !picked.slideshow.slideTexts.trim()) continue;
            const { book, slideshow: pickedSlideshow } = picked;
            // If the slideshow explicitly links prompts/captions, rotate only
            // through those. Otherwise (e.g. imported slideshows with empty
            // id arrays) fall back to the book's full pool so it still posts.
            const linkedPrompts = (book.imagePrompts || []).filter((p) =>
              pickedSlideshow.imagePromptIds.includes(p.id)
            );
            const linkedCaptions = (book.captions || []).filter((c) =>
              pickedSlideshow.captionIds.includes(c.id)
            );
            const allowedPrompts =
              linkedPrompts.length > 0 ? linkedPrompts : book.imagePrompts || [];
            const allowedCaptions =
              linkedCaptions.length > 0 ? linkedCaptions : book.captions || [];
            const pickedPrompt = pickRandom(allowedPrompts);
            const pickedCaption = pickRandom(allowedCaptions);
            if (!pickedPrompt) continue;
            imagePrompt = pickedPrompt.value;
            slideTexts = pickedSlideshow.slideTexts
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean);
            // If book has a cover image, drop the last text slide (book tag)
            // since the cover replaces it
            if (book.coverImage && slideTexts.length > 2) {
              slideTexts = slideTexts.slice(0, -1);
            }
            captionText = pickedCaption?.value || "";
            coverImage = book.coverImage;
            source = `book:${book.name}/${pickedSlideshow.name}`;
          } else {
            const prompt = pickRandom(data.prompts);
            const textSet = pickRandom(data.texts);
            const captionItem = pickRandom(data.captions);
            if (!prompt || !textSet) continue;
            imagePrompt = prompt.value;
            slideTexts = textSet.value
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean);
            captionText = captionItem?.value || "";
            source = "legacy-saved";
          }

          if (slideTexts.length < 2) continue;

          jobs.push({ acc, win, imagePrompt, slideTexts, captionText, source, coverImage });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          accountId: acc.id,
          username: acc.username,
          status: `error: ${msg}`,
        });
      }
    }

    // Phase 2: Generate all images in parallel (Gemini API, no sharp involved)
    const images = await Promise.all(
      jobs.map(async (job) => {
        try {
          return await generateImage(job.imagePrompt);
        } catch {
          return null;
        }
      })
    );

    // Phase 3: Render slides strictly one at a time (sharp Pango fails under concurrency)
    // Then upload and post each job
    const postResults: Array<{ job: Job; status: string }> = [];

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const image = images[i];
      if (!image) {
        postResults.push({ job, status: "skipped: image generation failed" });
        continue;
      }
      try {
        const slideBufs: Buffer[] = [];
        const textStyle = Math.floor(Math.random() * 3);
        for (const text of job.slideTexts) {
          const buf = await renderSlide(image, text, textStyle);
          slideBufs.push(buf);
        }

        const mediaIds: string[] = [];
        for (let j = 0; j < slideBufs.length; j++) {
          const mediaId = await uploadPng(slideBufs[j], `slide-${j + 1}.png`);
          mediaIds.push(mediaId);
        }

        // Upload book cover as final slide if available
        if (job.coverImage) {
          const base64 = job.coverImage.replace(/^data:[^;]+;base64,/, "");
          const coverBuf = Buffer.from(base64, "base64");
          const coverMediaId = await uploadPng(coverBuf, `slide-${slideBufs.length + 1}-cover.png`);
          mediaIds.push(coverMediaId);
        }

        const scheduledAt = randomTimeInWindow(job.win.start, job.win.end);

        const postResp = await pbFetch("/v1/posts", {
          method: "POST",
          body: JSON.stringify({
            caption: job.captionText,
            media: mediaIds,
            social_accounts: [job.acc.id],
            scheduled_at: scheduledAt.toISOString(),
            platform_configurations: {
              tiktok: { draft: false, is_aigc: true },
            },
          }),
        });

        const postId = postResp.id || postResp.data?.id || "unknown";
        postResults.push({
          job,
          status: `scheduled ${job.slideTexts.length} slides for ${scheduledAt.toISOString()} (${job.source}) [post:${postId}]`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        postResults.push({ job, status: `error: ${msg}` });
      }
    }

    // Phase 4: Aggregate results per account and save status
    const accountStatuses = new Map<number, string[]>();
    for (const r of postResults) {
      const id = r.job.acc.id;
      if (!accountStatuses.has(id)) accountStatuses.set(id, []);
      accountStatuses.get(id)!.push(r.status);
    }

    for (const [accId, statuses] of accountStatuses) {
      const acc = jobs.find((j) => j.acc.id === accId)?.acc;
      const status = statuses.join(" | ");
      results.push({
        accountId: accId,
        username: acc?.username || "unknown",
        status,
      });
      try {
        const data = accountData.get(accId);
        if (data) {
          await setAccountData(accId, {
            ...data,
            lastRun: new Date().toISOString(),
            lastStatus: status,
          });
        }
      } catch {}
    }

    // Include skipped accounts (enabled=false or no jobs)
    for (const acc of accounts) {
      if (!results.find((r) => r.accountId === acc.id)) {
        results.push({
          accountId: acc.id,
          username: acc.username,
          status: "skipped",
        });
      }
    }

    // Phase 5: Top N list automation (sequential — sharp Pango)
    const topNResults: Array<{ listName: string; status: string }> = [];
    try {
      const topNLists = await getTopNLists();
      for (const list of topNLists) {
        const auto = list.automation;
        if (!auto || !auto.enabled) continue;
        // Merge all account groups
        const allAutoAccountIds = [
          ...(auto.accountIds || []),
          ...(auto.videoAccountIds || []),
          ...(auto.fbAccountIds || []),
          ...(auto.igCarouselAccountIds || []),
          ...(auto.igVideoAccountIds || []),
        ];
        if (allAutoAccountIds.length === 0) continue;
        if (!auto.intervals || auto.intervals.length === 0) continue;

        for (const win of auto.intervals) {
          try {
            const scheduledAt = randomTimeInWindow(win.start, win.end);
            const r = await publishTopN({
              listId: list.id,
              accountIds: allAutoAccountIds,
              scheduledAt: scheduledAt.toISOString(),
            });
            topNResults.push({
              listName: list.name,
              status: `scheduled ${r.slides} slides for ${scheduledAt.toISOString()} [post:${r.postId}]`,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            topNResults.push({ listName: list.name, status: `error: ${msg}` });
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      topNResults.push({ listName: "(list fetch)", status: `error: ${msg}` });
    }

    // Phase 6: IG slideshow automation — per-account config (sequential — sharp Pango)
    const igAutoResults: Array<{ status: string }> = [];
    try {
      const igAuto = await getIgAutomation();
      if (igAuto.enabled && igAuto.accounts) {
        const igSlideshows = await getIgSlideshows();
        if (igSlideshows.length > 0) {
          let updated = false;
          const updatedAccounts = { ...igAuto.accounts };

          for (const [accIdStr, accConfig] of Object.entries(igAuto.accounts)) {
            if (!accConfig.enabled || accConfig.intervals.length === 0) continue;

            // Build pool: filter by books, then by specific slideshows
            let pool = igSlideshows;
            if (accConfig.bookIds.length > 0) {
              pool = pool.filter((s) => s.sourceBookId && accConfig.bookIds.includes(s.sourceBookId));
            }
            if (accConfig.slideshowIds.length > 0) {
              pool = pool.filter((s) => accConfig.slideshowIds.includes(s.id));
            }
            if (pool.length === 0) continue;

            let pointer = accConfig.pointer;

            for (const win of accConfig.intervals) {
              const ss = pool[pointer % pool.length];
              const prompt = pickRandom(ss.imagePrompts);
              const caption = pickRandom(ss.captions);
              if (!prompt) continue;

              const texts = ss.slideTexts.split("\n").map((t) => t.trim()).filter(Boolean);
              if (texts.length < 2) continue;

              try {
                const image = await generateImage(prompt.value);
                if (!image) {
                  igAutoResults.push({ status: `skip: image gen failed for ${ss.name} (${accIdStr})` });
                  continue;
                }
                const slideBufs: Buffer[] = [];
                const textStyle = Math.floor(Math.random() * 3);
                for (const text of texts) {
                  slideBufs.push(await renderSlide(image, text, textStyle));
                }
                const mediaIds: string[] = [];
                for (let j = 0; j < slideBufs.length; j++) {
                  mediaIds.push(await uploadPng(slideBufs[j], `ig-auto-${accIdStr}-${j + 1}.png`));
                }

                // Determine platform config based on account type
                const accId = Number(accIdStr);
                const isIg = igAuto.igAccountIds?.includes(accId) || !igAuto.tiktokAccountIds?.includes(accId);
                const platformCfg = isIg
                  ? { instagram: {} }
                  : { tiktok: { draft: false, is_aigc: true } };

                const scheduledAt = randomTimeInWindow(win.start, win.end);
                const postResp = await pbFetch("/v1/posts", {
                  method: "POST",
                  body: JSON.stringify({
                    caption: caption?.value || "",
                    media: mediaIds,
                    social_accounts: [accId],
                    scheduled_at: scheduledAt.toISOString(),
                    platform_configurations: platformCfg,
                  }),
                });
                const postId = postResp.id || postResp.data?.id || "unknown";
                igAutoResults.push({
                  status: `${ss.name} → ${accIdStr} at ${scheduledAt.toISOString()} [post:${postId}]`,
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                igAutoResults.push({ status: `error (${accIdStr}): ${msg}` });
              }

              pointer++;
            }

            updatedAccounts[accIdStr] = { ...accConfig, pointer };
            updated = true;
          }

          if (updated) {
            await setIgAutomation({ ...igAuto, accounts: updatedAccounts });
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      igAutoResults.push({ status: `IG automation error: ${msg}` });
    }

    return NextResponse.json({ ok: true, results, topNResults, igAutoResults });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
