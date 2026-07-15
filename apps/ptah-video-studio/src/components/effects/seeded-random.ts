/**
 * Deterministic PRNG for effect layers (particles, meteors) that need
 * per-item "randomness" without breaking Remotion's per-frame render
 * determinism — `Math.random()` would make headless re-renders inconsistent.
 * mulberry32: tiny, fast, stable across Node/Chromium.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build `count` deterministic values in [0, 1) from a single seed. */
export function seededSeries(seed: number, count: number): number[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, () => rand());
}
