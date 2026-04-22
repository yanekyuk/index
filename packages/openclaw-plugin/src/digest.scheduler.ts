/**
 * Calculates milliseconds until the next occurrence of the given digest time.
 *
 * @param digestTime - Time in "HH:MM" format (24-hour, local timezone)
 * @param now - Current date/time (defaults to new Date())
 * @returns Milliseconds until the next digest time
 */
export function msUntilNextDigest(digestTime: string, now: Date = new Date()): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(digestTime);
  if (!match) {
    throw new Error(`Invalid digestTime "${digestTime}" — expected HH:MM format`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid digestTime "${digestTime}" — hours must be 0-23, minutes 0-59`);
  }

  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  // If target is now or in the past, schedule for tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}
