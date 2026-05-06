import {
  getTopNLists,
  getTopNAutomation,
  setTopNAutomation,
} from "@/lib/kv";
import { publishTopN } from "@/lib/topn-publisher";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled, unmarkScheduled } from "./scheduled-today";
import type { TopNResult } from "./types";

export async function runTopNPhase(
  scheduledToday: Set<string>
): Promise<TopNResult[]> {
  const topNResults: TopNResult[] = [];
  try {
    const topNLists = await getTopNLists();
    const topNAuto = await getTopNAutomation();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    let topNUpdated = false;
    const updatedTopNAccounts = { ...topNAuto.accounts };

    for (const [accIdStr, accConfig] of Object.entries(topNAuto.accounts)) {
      if (!accConfig.enabled || accConfig.intervals.length === 0) continue;

      // Frequency check: skip if not enough days since last post
      if (accConfig.lastPostDate) {
        const lastDate = new Date(accConfig.lastPostDate + "T00:00:00Z");
        const todayDate = new Date(today + "T00:00:00Z");
        const daysSince = Math.floor((todayDate.getTime() - lastDate.getTime()) / 86400000);
        if (daysSince < accConfig.frequencyDays) continue;
      }

      // Build eligible list pool
      let pool = topNLists.filter((l) => l.bookIds.length > 0 || (l.genres && l.genres.length > 0));
      if (accConfig.listIds.length > 0) {
        pool = pool.filter((l) => accConfig.listIds.includes(l.id));
      }
      if (pool.length === 0) continue;

      // Check if any window is active this hour and not already scheduled
      const activeWindows = accConfig.intervals.filter((w) => {
        const sk = `topn:${accIdStr}:${w.start}`;
        return shouldProcessWindow(w.start) && !scheduledToday.has(sk);
      });
      if (activeWindows.length === 0) continue;

      // Mark all TopN window keys for this account before heavy work
      const topnSchedKeys = activeWindows.map((w) => `topn:${accIdStr}:${w.start}`);
      await markScheduled(topnSchedKeys);

      const failedTopnKeys: string[] = [];
      let successCount = 0;
      let currentPointer = accConfig.pointer;
      for (const win of activeWindows) {
        // Each window picks the next list in rotation
        const listIndex = currentPointer % pool.length;
        const selectedList = pool[listIndex];
        currentPointer++;
        try {
          const scheduledAt = randomTimeInWindow(win.start, win.end);
          const r = await publishTopN({
            listId: selectedList.id,
            accountIds: [Number(accIdStr)],
            scheduledAt: scheduledAt.toISOString(),
            platform: accConfig.platform,
            backgroundPrompts: accConfig.backgroundPrompts,
          });
          topNResults.push({
            listName: selectedList.name,
            status: `${accIdStr}: scheduled ${r.slides} slides for ${scheduledAt.toISOString()} [post:${r.postId}]`,
          });
          successCount++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          topNResults.push({ listName: selectedList.name, status: `error (${accIdStr}): ${msg}` });
          failedTopnKeys.push(`topn:${accIdStr}:${win.start}`);
        }
      }
      if (failedTopnKeys.length > 0) {
        await unmarkScheduled(failedTopnKeys);
      }

      // Advance pointer by number of windows attempted, mark today if any succeeded
      if (successCount > 0) {
        updatedTopNAccounts[accIdStr] = {
          ...accConfig,
          pointer: currentPointer,
          lastPostDate: today,
        };
        topNUpdated = true;
      }
    }

    if (topNUpdated) {
      await setTopNAutomation({ accounts: updatedTopNAccounts });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    topNResults.push({ listName: "(topn-auto)", status: `error: ${msg}` });
  }

  return topNResults;
}
