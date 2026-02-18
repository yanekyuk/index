/**
 * Markdown normalization aligned with frontend ChatContent.
 * Ensures blockquote lines are followed by a blank line so subsequent
 * non-blockquote text isn't absorbed via markdown "lazy continuation".
 * e.g. "> Retrieving…\nHere is…" → "> Retrieving…\n\nHere is…"
 */
export function normalizeBlockquotes(text: string): string {
  return text.replace(/^(>.*)\n(?!>|\n)/gm, "$1\n\n");
}
