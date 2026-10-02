/**
 * Order a cluster's members by distance to its centroid (TASK_2026_578).
 *
 * The umbrella synthesizer keeps only its first `UMBRELLA_MAX_MEMBERS`
 * inputs, so the umbrella pass hands it members closest to the centroid first
 * and the farthest are the ones dropped.
 */
import { cosineSimilarity } from '../cosine-similarity';

export interface CentroidOrder<T> {
  /** Comparable members, closest to the centroid first. */
  readonly ordered: T[];
  /** Members left out because their embedding dimension differs. */
  readonly mismatched: number;
}

/**
 * The members sharing the cluster's most common embedding dimension (ties: the
 * first seen), ordered by cosine similarity to their centroid, closest first;
 * ties keep discovery order. The others cannot be compared with the rest and
 * are left out, counted in `mismatched`.
 */
export function orderByCentroidDistance<T extends { embedding: Float32Array }>(
  members: readonly T[],
): CentroidOrder<T> {
  const byDimension = new Map<number, number>();
  for (const m of members) {
    const n = m.embedding.length;
    byDimension.set(n, (byDimension.get(n) ?? 0) + 1);
  }
  let dimension = 0;
  for (const [n, count] of byDimension) {
    if (count > (byDimension.get(dimension) ?? 0)) dimension = n;
  }
  const comparable = members.filter((m) => m.embedding.length === dimension);
  // The sum, not the mean: cosine similarity is scale-invariant.
  const centroid = new Float32Array(dimension);
  for (const m of comparable) {
    for (let d = 0; d < dimension; d++) centroid[d] += m.embedding[d];
  }
  const ordered = comparable
    .map((member, index) => ({
      member,
      index,
      similarity: cosineSimilarity(member.embedding, centroid),
    }))
    .sort((a, b) => b.similarity - a.similarity || a.index - b.index)
    .map((entry) => entry.member);
  return { ordered, mismatched: members.length - comparable.length };
}
