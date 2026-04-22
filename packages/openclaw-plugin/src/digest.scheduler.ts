/**
 * Calculates milliseconds until the next occurrence of the given digest time.
 *
 * @param digestTime - Time in "HH:MM" format (24-hour, local timezone)
 * @param now - Current date/time (defaults to new Date())
 * @returns Milliseconds until the next digest time
 */
export function msUntilNextDigest(digestTime: string, now: Date = new Date()): number {
  const [hours, minutes] = digestTime.split(':').map(Number);

  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  // If target is now or in the past, schedule for tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}
