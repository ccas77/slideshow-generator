import { notify } from "@/lib/notify";
import {
  verifyPostScheduled,
  verifyAccountHasPostsToday,
  isPostsCreateError,
} from "@/lib/post-bridge";
import { withJobTimeout } from "@/lib/cron/with-timeout";

interface NotifyPostFailureOpts {
  subject: string;
  body: string;
  error: unknown;
  accountId: number;
  scheduledAt?: Date;
  captionSlice?: string;
  dedupeKey: string;
  cooldownSec?: number;
}

// Decides whether to email or silently swallow a post failure.
//
// Two-stage suppression (per 2026-06-26 redesign after repeated crying-wolf
// complaints):
//
// 1. Precise match. For POST /v1/posts errors specifically: PostBridge may
//    have accepted the post even though the response failed. Query for a
//    matching scheduled_at + caption to confirm.
//
// 2. Broad "account posted today" check. For any failure type (upload step
//    exhausted, build error, network error on /v1/posts): if the account
//    has ANY post scheduled for today at PostBridge, suppress. Catches the
//    common pattern of "an earlier or later window already posted, this
//    single window's failure is noise."
//
// Only if BOTH suppression checks come back empty do we send the email.
// Matches the user's mental model: she checks TikTok, sees whether posts
// happened. If yes, the system works; she doesn't want to be paged.
// Hard cap on the whole verification decision. This runs in the catch block of
// every phase, i.e. OUTSIDE withJobTimeout, so before this cap it was the one
// unbounded stretch of the cron: 8s + 5s of deliberate waits followed by up to
// four paginated PostBridge reads. With retrying reads a single failed job could
// occupy minutes, and the serial phases (instagram, video, excerpts) await it
// once per window — enough failures and Vercel killed the function mid-run,
// which is exactly the silent-lockout mode the runbook keeps hitting. On
// timeout we fall through and alert: a spurious alert is recoverable, a killed
// cron run is not.
const VERIFY_BUDGET_MS = 40_000;

export async function notifyPostFailure(
  opts: NotifyPostFailureOpts,
): Promise<{ verified: boolean }> {
  let suppress = false;
  try {
    suppress = await withJobTimeout(
      (async () => {
        // Stage 1: precise match for POST /v1/posts response-after-success case.
        if (isPostsCreateError(opts.error) && opts.scheduledAt) {
          const exactMatch = await verifyPostScheduled({
            accountId: opts.accountId,
            scheduledAtISO: opts.scheduledAt.toISOString(),
            captionSlice: opts.captionSlice,
          });
          if (exactMatch) return true;
        }

        // Stage 2: broad "did this account post anything today" check. Applies
        // to all failure types — if the account is posting fine via other
        // paths, a single hiccup is not worth an alert.
        return await verifyAccountHasPostsToday(opts.accountId);
      })(),
      VERIFY_BUDGET_MS,
      `verify-failure ${opts.accountId}`,
    );
  } catch {
    suppress = false;
  }
  if (suppress) return { verified: true };

  // Stage 3: defer-and-recheck. Instead of emailing immediately, queue the
  // alert with a 30-min fireAt. The next cron drains the queue and only
  // sends alerts whose re-verification still shows the account has no post
  // today. Catches the common "PB was flaky at :00, healed by :30" pattern
  // where an alert would have been true when queued but stale by morning.
  await notify({
    subject: opts.subject,
    body: opts.body,
    dedupeKey: opts.dedupeKey,
    cooldownSec: opts.cooldownSec,
    recheck: { accountId: opts.accountId },
  });
  return { verified: false };
}
