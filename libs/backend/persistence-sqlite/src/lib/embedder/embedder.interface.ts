/**
 * IEmbedder — shared contract for text-to-vector embedding providers.
 *
 * Implemented by `memory-curator`'s transformers.js worker proxy and consumed
 * by both memory-curator (for memory_chunks_vec) and skill-synthesis (for
 * skill_candidates_vec). Living in `persistence-sqlite` keeps both consumer
 * libraries at L3 without a horizontal L3-to-L3 dependency.
 *
 * The interface is intentionally minimal: implementations may pre-load models,
 * batch internally, or run in worker threads — all callers see is "given N
 * strings, give me N Float32Arrays of length `dim`".
 */
export interface IEmbedder {
  /** Embedding dimension — MUST equal the FLOAT[N] in vec0 tables (e.g. 384). */
  readonly dim: number;
  /** Stable model identifier (e.g. 'Xenova/bge-small-en-v1.5'). */
  readonly modelId: string;
  /**
   * Embed N strings into N Float32Array vectors of length `dim`.
   * Order of the returned array matches input order. Empty input is allowed
   * and returns an empty array.
   */
  embed(texts: readonly string[]): Promise<Float32Array[]>;
  /** Release any underlying resources (worker threads, native handles). */
  dispose(): Promise<void>;
}
