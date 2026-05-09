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
