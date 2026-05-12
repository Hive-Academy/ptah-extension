/**
 * DI Token Registry — Memory Curator Tokens
 *
 * Convention mirrors `libs/backend/agent-sdk/src/lib/di/tokens.ts`:
 *  - Always `Symbol.for('Name')` (globally interned).
 *  - Each description is globally unique across all token files.
 *  - Frozen `as const` so consumer types narrow on the symbol values.
 */
export const MEMORY_TOKENS = {
  /** MemoryCuratorService — orchestrates extract → resolve → score on PreCompact. */
  MEMORY_CURATOR: Symbol.for('PtahMemoryCurator'),
  /** MemorySearchService — hybrid BM25 + vector search with RRF fusion. */
  MEMORY_SEARCH: Symbol.for('PtahMemorySearch'),
  /** MemoryStore — typed CRUD over `memories` and `memory_chunks` tables. */
  MEMORY_STORE: Symbol.for('PtahMemoryStore'),
  /** SalienceScorer — pure scoring function used by curator + decay. */
  MEMORY_SALIENCE_SCORER: Symbol.for('PtahMemorySalienceScorer'),
  /** MemoryDecayJob — periodic tier transition + salience recompute. */
  MEMORY_DECAY_JOB: Symbol.for('PtahMemoryDecayJob'),
  /** ICuratorLLM — small/fast LLM wrapper for extract/resolve prompts. */
  CURATOR_LLM: Symbol.for('PtahCuratorLlm'),
  /** IndexingControlService — workspace indexing state machine (TASK_2026_114). */
  INDEXING_CONTROL: Symbol.for('PtahIndexingControl'),
} as const;

export type MemoryDIToken = keyof typeof MEMORY_TOKENS;
