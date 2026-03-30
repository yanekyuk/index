/**
 * Represents a single Server-Sent Event parsed from a text stream.
 */
export interface SSEEvent {
  /** The event type (from the `event:` field). Undefined for data-only events. */
  event?: string;
  /** The event data (from the `data:` field). Multiple data lines are joined with newlines. */
  data: string;
}

/**
 * Parse a chunk of SSE text into discrete events.
 *
 * Events are delimited by double newlines (`\n\n`). Incomplete events
 * (no trailing double newline) are not returned — the caller should
 * buffer the remainder and prepend it to the next chunk.
 *
 * @param chunk - Raw SSE text, potentially containing multiple events.
 * @returns Array of fully parsed SSE events.
 */
export function parseSSEEvents(chunk: string): SSEEvent[] {
  if (!chunk) return [];

  const events: SSEEvent[] = [];
  const rawEvents = chunk.split("\n\n");

  // The last element after split is either empty (complete) or a partial event.
  // We only process complete events (all but the last if it's non-empty).
  for (let i = 0; i < rawEvents.length; i++) {
    const raw = rawEvents[i].trim();
    if (!raw) continue;

    // If this is the last segment and the original chunk doesn't end with \n\n,
    // it's an incomplete event — skip it.
    if (i === rawEvents.length - 1 && !chunk.endsWith("\n\n")) {
      continue;
    }

    let eventType: string | undefined;
    const dataLines: string[] = [];

    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) {
        // Comment line — ignore.
        continue;
      }
      if (line.startsWith("event:")) {
        eventType = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    if (dataLines.length > 0) {
      events.push({
        event: eventType,
        data: dataLines.join("\n"),
      });
    }
  }

  return events;
}
