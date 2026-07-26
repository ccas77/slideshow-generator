// One wall-clock budget shared by every phase of a single cron invocation.
//
// Vercel kills the function at `maxDuration` with no catchable error. That kill
// is the root of every silent-lockout incident in the runbook (2026-05-07,
// 2026-06-02, 2026-06-15, 2026-07-05, 2026-07-11): no throw means no catch, so
// no notify(), no digest entry, no unmark of the schedule keys the phase had
// already marked — and the affected windows are burned for the rest of the day
// with zero telemetry.
//
// The defence is to stop *starting* new work while there is still time to exit
// cleanly. A phase that runs out of budget unmarks the windows it has not
// started yet, so the next invocation picks them up, and records one digest
// entry so the overrun is visible instead of silent.

export interface RunDeadline {
  remainingMs(): number;
  /** True when there is room for a job of up to `ms` plus bookkeeping slack. */
  hasTimeFor(ms: number): boolean;
}

// Bookkeeping slack held back on every hasTimeFor() check: unmarking keys,
// saving pointers and statuses all happen after the last job returns.
const SLACK_MS = 20_000;

export function createRunDeadline(budgetMs: number): RunDeadline {
  const start = Date.now();
  const left = () => budgetMs - (Date.now() - start);
  return {
    remainingMs: () => Math.max(0, left()),
    hasTimeFor: (ms: number) => left() > ms + SLACK_MS,
  };
}

// `maxDuration` on the cron route is 800s. Hold back ~90s so that when the
// budget runs out the phases still have time to unmark keys, persist pointers
// and return a response rather than being killed mid-write.
export const CRON_BUDGET_MS = 710_000;

// Used when a phase is called outside the cron (tests, manual invocation):
// effectively unlimited, so behaviour is unchanged.
export function unlimitedDeadline(): RunDeadline {
  return { remainingMs: () => Number.MAX_SAFE_INTEGER, hasTimeFor: () => true };
}
