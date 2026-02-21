const MAX_SAMPLES_PER_NAME = 500;

/** Test-only override; when set, recordTiming trims to this many samples per name. */
let maxSamplesForTesting: number | null = null;

const store = new Map<string, number[]>();

export function setMaxSamplesForTesting(n: number | null): void {
  maxSamplesForTesting = n;
}

export function recordTiming(callName: string, durationMs: number): void {
  let arr = store.get(callName);
  if (!arr) {
    arr = [];
    store.set(callName, arr);
  }
  arr.push(durationMs);
  const max = maxSamplesForTesting ?? MAX_SAMPLES_PER_NAME;
  if (arr.length > max) {
    store.set(callName, arr.slice(-max));
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

export function getStats(): Record<string, { count: number; p50: number; p95: number }> {
  const out: Record<string, { count: number; p50: number; p95: number }> = {};
  for (const [name, arr] of store) {
    const sorted = [...arr].sort((a, b) => a - b);
    out[name] = {
      count: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
    };
  }
  return out;
}

export function resetStats(): void {
  store.clear();
}
