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
 * same cluster. Two vectors are linked when their cosine similarity exceeds
 * `threshold`; a cluster is a connected component of that graph, which is
 * exactly the single-linkage partition at `> threshold` (a~b and b~c put a and
 * c together even when a≁c).
 *
 * Union-find over every pair in one O(n²·d) sweep. The label of a component is
 * the LOWEST input index among its members, so labels are stable for a given
 * input order and callers (and specs) may compare them as values.
 */
export function agglomerate(
  embeddings: Float32Array[],
  threshold: number,
): number[] {
  const parent: number[] = embeddings.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    // Path compression: point every node on the walk straight at the root.
    let node = i;
    while (parent[node] !== root) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };

  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI === rootJ) continue;
      if (cosineSimilarity(embeddings[i], embeddings[j]) <= threshold) continue;
      // The smaller index always becomes the root, so the root of a component
      // is its lowest member index — the label contract above.
      if (rootI < rootJ) parent[rootJ] = rootI;
      else parent[rootI] = rootJ;
    }
  }

  return embeddings.map((_, i) => find(i));
}
