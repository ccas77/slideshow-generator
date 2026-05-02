import {
  getIgAutomation,
  getIgSlideshows,
  setIgAutomation,
} from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { pbFetch, uploadPng } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled } from "./scheduled-today";
import type { IgAutoResult } from "./types";

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runInstagramPhase(
  scheduledToday: Set<string>
): Promise<IgAutoResult[]> {
  const igAutoResults: IgAutoResult[] = [];
  try {
    const igAuto = await getIgAutomation();
    if (igAuto.accounts && Object.keys(igAuto.accounts).length > 0) {
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

          // Mark IG schedule keys upfront
          const igSchedKeys = accConfig.intervals
            .filter((w) => shouldProcessWindow(w.start) && !scheduledToday.has(`ig:${accIdStr}:${w.start}`))
            .map((w) => `ig:${accIdStr}:${w.start}`);
          if (igSchedKeys.length > 0) await markScheduled(igSchedKeys);

          for (const win of accConfig.intervals) {
            if (!shouldProcessWindow(win.start)) continue;
            if (scheduledToday.has(`ig:${accIdStr}:${win.start}`)) continue;
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

              for (const text of texts) {
                slideBufs.push(await renderSlide(image, text));
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

  return igAutoResults;
}
