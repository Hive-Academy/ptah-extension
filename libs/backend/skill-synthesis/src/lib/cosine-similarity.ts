/**
 * Cosine similarity utility — shared between SkillCandidateStore and
 * SkillClusterDedupService so neither duplicates the implementation.
 */

/**
 * Compute cosine similarity between two equal-length float vectors.
 * Returns 0 on degenerate input (zero-length vectors or length mismatch).
 * Returns a value in [-1, 1] (practically [0, 1] for embedding vectors).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Single-linkage agglomerative clustering over embedding vectors.
 *
 * Returns a cluster-id per input index: indices sharing a value belong to the
 * same cluster. Two clusters merge when the MAX pairwise cosine similarity
 * between their members exceeds `threshold` (single-linkage). O(n^2) per merge
 * iteration — acceptable for the expected few-hundred-vector ceiling.
 */
export function agglomerate(
  embeddings: Float32Array[],
  threshold: number,
): number[] {
  const clusterOf: number[] = embeddings.map((_, i) => i);
  if (embeddings.length <= 1) return clusterOf;
  let merged = true;
  while (merged) {
    merged = false;
    const clusterIds = [...new Set(clusterOf)];
    outer: for (let ci = 0; ci < clusterIds.length; ci++) {
      for (let cj = ci + 1; cj < clusterIds.length; cj++) {
        const membersI = clusterOf
          .map((c, idx) => (c === clusterIds[ci] ? idx : -1))
          .filter((idx) => idx >= 0);
        const membersJ = clusterOf
          .map((c, idx) => (c === clusterIds[cj] ? idx : -1))
          .filter((idx) => idx >= 0);
        let maxSim = -Infinity;
        for (const i of membersI) {
          for (const j of membersJ) {
            const sim = cosineSimilarity(embeddings[i], embeddings[j]);
            if (sim > maxSim) maxSim = sim;
          }
        }
        if (maxSim > threshold) {
          const targetId = clusterIds[ci];
          const sourceId = clusterIds[cj];
          for (let k = 0; k < clusterOf.length; k++) {
            if (clusterOf[k] === sourceId) clusterOf[k] = targetId;
          }
          merged = true;
          break outer;
        }
      }
    }
  }
  return clusterOf;
}
