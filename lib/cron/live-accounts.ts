import { listAllSocialAccountIds } from "@/lib/post-bridge";
import { notify } from "@/lib/notify";

// The TikTok phase builds its accounts from PostBridge's live list, so an
// account PostBridge has dropped disappears from its rotation on its own. The
// TopN, IG, video and excerpt phases instead iterate stored config, so a
// dropped account stays in the rotation forever: every window builds a job,
// publishes, advances the pointer, and comes back "Refresh token is invalid or
// expired". This guard is how those phases get the TikTok phase's behaviour.

export type GoneAccountGuard = (
  accIdStr: string,
  phase: string,
) => Promise<boolean>;

/**
 * Builds a predicate that answers "has PostBridge dropped this account?" and
 * reports the account once a day the first time it says yes.
 *
 * Reads PostBridge once per cron run. If that read fails or comes back
 * truncated the predicate answers false for everything, so an unreachable
 * PostBridge can never stop the fleet from posting.
 */
export async function buildGoneAccountGuard(): Promise<GoneAccountGuard> {
  const liveIds = await listAllSocialAccountIds();
  const reported = new Set<string>();

  return async (accIdStr: string, phase: string): Promise<boolean> => {
    if (liveIds === null) return false;
    const id = Number(accIdStr);
    if (!Number.isFinite(id) || liveIds.has(id)) return false;

    if (!reported.has(accIdStr)) {
      reported.add(accIdStr);
      await notify({
        subject: `Slideshow Generator: account ${accIdStr} is gone from PostBridge`,
        body:
          `Account ${accIdStr} is still enabled for ${phase} posting, but PostBridge no longer lists it, ` +
          `so every post to it fails with an expired/invalid token.\n\n` +
          `Its windows are being skipped until it comes back. Reconnect the account in PostBridge, ` +
          `or disable it in ${phase} settings to stop this notice.`,
        dedupeKey: `account-missing:${accIdStr}:${new Date().toISOString().slice(0, 10)}`,
        cooldownSec: 86400,
      });
    }
    return true;
  };
}
