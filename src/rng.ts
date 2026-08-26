/**
 * Seeded PRNG so a seed reproduces a stream exactly — the property that makes
 * the output usable as a CI fixture. Standard mulberry32.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one item with probability proportional to its weight. */
export function weightedPick<T>(rng: () => number, items: [T, number][]): T {
  if (items.length === 0) throw new Error("weightedPick: no items");
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [item, weight] of items) {
    r -= weight;
    if (r < 0) return item;
  }
  return items[items.length - 1]![0]; // float drift only
}
