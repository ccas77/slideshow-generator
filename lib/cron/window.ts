// Check if a window should be scheduled: any window whose start hour is >= current hour
// (i.e., all remaining windows today). Duplicate prevention is handled by the
// scheduled-today tracking.
export function shouldProcessWindow(windowStart: string): boolean {
  const [sh] = windowStart.split(":").map(Number);
  const currentHour = new Date().getUTCHours();
  return sh >= currentHour;
}

export function randomTimeInWindow(windowStart: string, windowEnd: string): Date {
  const [sh, sm] = windowStart.split(":").map(Number);
  const [eh, em] = windowEnd.split(":").map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  // Midnight wrap: e.g. 22:00→00:30 becomes 1320→1470 (next day)
  if (endMin <= startMin) endMin += 1440;
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
