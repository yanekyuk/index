const MAX_SAMPLES = 500;

const store = new Map<string, number[]>();

export function recordTiming(name: string, durationMs: number): void {
  let arr = store.get(name);
  if (!arr) {
    arr = [];
    store.set(name, arr);
  }
  arr.push(durationMs);
  if (arr.length > MAX_SAMPLES) {
    store.set(name, arr.slice(-MAX_SAMPLES));
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
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
