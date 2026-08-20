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
  /** IndexingControlService — workspace indexing state machine. */
  INDEXING_CONTROL: Symbol.for('PtahIndexingControl'),
  /** CodeSymbolStore — typed CRUD over the dedicated `code_symbols` table. */
  CODE_SYMBOL_STORE: Symbol.for('PtahCodeSymbolStore'),
  /** MemoryTriggerService — idle/turn/boot scan trigger orchestrator. */
  MEMORY_TRIGGER_SERVICE: Symbol.for('PtahMemoryTriggerService'),
  /** MemoryDiagnosticsService — read-only snapshot for the Diagnostics tab. */
  MEMORY_DIAGNOSTICS_SERVICE: Symbol.for('PtahMemoryDiagnosticsService'),
  /** ObservationQueueStore — typed CRUD over the `observation_queue` capture table. */
  OBSERVATION_QUEUE_STORE: Symbol.for('PtahObservationQueueStore'),
  /** CorpusStore — typed CRUD over `corpora` + `corpus_memories` (migration 0017). */
  CORPUS_STORE: Symbol.for('PtahCorpusStore'),
  /** CorpusSuggestionService — read-only clustering pass for one-click corpus suggestions. */
  CORPUS_SUGGESTION_SERVICE: Symbol.for('PtahCorpusSuggestionService'),
  /**
   * KnowledgeAgentService — orchestrates corpus build/prime/query/rebuild.
   * Same interned symbol as `memory-contracts` `KNOWLEDGE_AGENT_TOKEN`
   * (`Symbol.for('PtahKnowledgeAgentService')`) — declared as its own literal
   * (not a reference) so di-lint resolves it, mirroring the `CURATOR_LLM`
   * dual-literal convention. Keep the description in sync with that token.
   */
  KNOWLEDGE_AGENT_SERVICE: Symbol.for('PtahKnowledgeAgentService'),
  /** EmbedderStatusService — single source of truth for bge-small ONNX readiness + lazy download progress. */
  EMBEDDER_STATUS: Symbol.for('PtahEmbedderStatus'),
  /** IEmbedderWorkerProcessFactory — host impl (Electron utilityProcess); absent on VS Code/CLI → embedder degrades to unavailable. */
  EMBEDDER_WORKER_PROCESS_FACTORY: Symbol.for(
    'PtahEmbedderWorkerProcessFactory',
  ),
  /** Optional idle-teardown override (ms) for the embedder worker — mainly a test seam. */
  EMBEDDER_WORKER_IDLE_MS: Symbol.for('PtahEmbedderWorkerIdleMs'),
} as const;

export type MemoryDIToken = keyof typeof MEMORY_TOKENS;
