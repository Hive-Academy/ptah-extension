/**
 * Tiny Levenshtein-distance utility for "did you mean…?" suggestions in CLI
 * validation paths. Hand-rolled (no dependency) — TASK CLI-bug-batch item #10.
 *
 * The implementation is the standard two-row dynamic-programming variant:
 *   - O(n*m) time, O(min(n,m)) space.
 *   - Returns the edit distance (insertions + deletions + substitutions).
 *
 * Pure function. No IO, no DI.
 */

/**
 * Compute the Levenshtein edit distance between `a` and `b`.
 *
 * The function is allocation-light: it keeps two rolling rows of length
 * `min(a.length, b.length) + 1` rather than the full matrix. Both inputs are
 * treated as raw UTF-16 code units; `a-b` distance equals 1 even if one of
 * the characters is a surrogate pair half — fine for ASCII provider IDs.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure `a` is the shorter string to minimise the rolling-row size.
  let s = a;
  let t = b;
  if (s.length > t.length) {
    const tmp = s;
    s = t;
    t = tmp;
  }

  const sLen = s.length;
  const tLen = t.length;

  let prev: number[] = new Array(sLen + 1);
  let curr: number[] = new Array(sLen + 1);
  for (let i = 0; i <= sLen; i++) prev[i] = i;

  for (let j = 1; j <= tLen; j++) {
    curr[0] = j;
    for (let i = 1; i <= sLen; i++) {
      const cost = s.charCodeAt(i - 1) === t.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[i] + 1;
      const ins = curr[i - 1] + 1;
      const sub = prev[i - 1] + cost;
      let min = del < ins ? del : ins;
      if (sub < min) min = sub;
      curr[i] = min;
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[sLen];
}

/**
 * Find the closest match in `candidates` to `input` within `maxDistance`
 * edits. Returns `null` when nothing falls within the threshold.
 */
export function suggestClosest(
  input: string,
  candidates: readonly string[],
  maxDistance = 2,
): string | null {
  let best: string | null = null;
  let bestDistance = maxDistance + 1;

  for (const candidate of candidates) {
    const d = levenshtein(input, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }

  return bestDistance <= maxDistance ? best : null;
}
