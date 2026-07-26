// Per-job hard cap for cron publish pipelines. Each phase's processJob can
// hang inside image gen, PB upload, or PB create if a downstream service is
// slow. Without a per-job cap, the whole serverless function eventually
// gets killed by Vercel — no thrown error, no notifyPostFailure, no digest
// entry, mark-scheduled key stays set, and the account is silently locked
// out for the rest of the day (and every subsequent day it re-hangs).
// See 2026-07-11 incident: psychological.booktok (62255) went 5 days with
// no posts and no alerts because publishTopN hung inside the cron loop.

export async function withJobTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Job timed out after ${ms}ms: ${label}`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Must cover the observed 30-90s happy path PLUS the retry sleeps one job can
// legitimately incur. A job issues two retryable calls per slide
// (create-upload-url, then the presigned S3 PUT), and each can sleep through
// its backoff schedule — see RETRY_DELAYS_MS in lib/post-bridge.ts. At 120s a
// single transient 5xx in a 6-slide carousel pushed the job past the cap, so
// our own timeout aborted work that was about to succeed; the window was then
// re-run from scratch (fresh image gen, fresh uploads) on the next cron and
// often timed out the same way, turning brief PostBridge flakiness into a wall
// of "post failed" alerts. Total run time is now bounded by the shared budget
// in ./deadline.ts, so a per-job cap this size cannot run the function over.
export const JOB_TIMEOUT_MS = 180_000;

// Video jobs run ffmpeg encoding plus the same upload+PB path as the
// carousel phases. Encoding alone can take 60-120s on the Vercel Node
// runtime, so give video a bigger budget before we consider it hung.
export const VIDEO_JOB_TIMEOUT_MS = 300_000;
