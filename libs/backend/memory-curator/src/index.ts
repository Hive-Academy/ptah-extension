/**
 * @ptah-extension/memory-curator — public API.
 *
 * Letta-style tiered memory (core/recall/archival) curated automatically on
 * SDK PreCompact firings. Hybrid search via FTS5 (BM25) + sqlite-vec with
 * Reciprocal Rank Fusion fallback to BM25-only.
 */
export type {
  Memory,
  MemoryChunk,
  MemoryId,
  ChunkId,
  MemoryTier,
  MemoryKind,
  MemoryInsert,
  ChunkInsert,
  MemorySearchHit,
  MemorySearchResponse,
  MemoryListResponse,
  MemoryStatsResponse,
} from './lib/memory.types';
export { memoryId, chunkId } from './lib/memory.types';
export { MemoryStore } from './lib/memory.store';
export { CodeSymbolStore } from './lib/code-symbol.store';
export type {
  CodeSymbolInsert,
  CodeSymbolSearchParams,
  CodeSymbolSearchResult,
  CodeSymbolListEntry,
} from './lib/code-symbol.store';
export { MemorySearchService } from './lib/memory-search.service';
export type {
  MemSearchIndexFilter,
  MemSearchIndexResponse,
  MemTimelineRequest,
  MemTimelineResponse,
  MemGetObservationsRequest,
  MemGetObservationsResponse,
  MemoryIndexRowOut,
  MemMemoryFullOut,
  MemObservationRowOut,
} from './lib/memory-search.service';
export { ObservationQueueStore } from './lib/observation-queue.store';
export type {
  ObservationKind,
  ObservationQueueInsert,
  ObservationQueueRow,
  ObservationCaptureEvent,
  ObservationCaptureListener,
} from './lib/observation-queue.store';
export { SalienceScorer } from './lib/salience-scorer';
export type { ScoreInputs } from './lib/salience-scorer';
export { MemoryDecayJob } from './lib/memory-decay.job';
export type { DecayJobOptions, DecayRunStats } from './lib/memory-decay.job';
export { MemoryTriggerService } from './lib/triggers/memory-trigger.service';
export {
  DEFAULT_CUE_LIST,
  MEMORY_TRIGGER_DEFAULTS,
  MEMORY_TRIGGER_KEYS,
  MEMORY_TRIGGER_PREFIXES,
  MEMORY_TRIGGER_SECTION,
  flattenMemoryTriggers,
  readMemoryTriggers,
  type PopulatedMemoryTriggers,
} from './lib/triggers/memory-trigger-config';
export { BootScanRunner } from './lib/triggers/boot-scan-runner';
export type {
  BootScanPipeline,
  BootScanResult,
  BootScanRunnerOptions,
} from './lib/triggers/boot-scan-runner';
export { MemoryDiagnosticsService } from './lib/diagnostics.service';
export type {
  MemoryCuratorEvent,
  MemoryCuratorEventKind,
  MemoryDbHealth,
  MemoryDecayStats,
  MemoryDiagnosticsSnapshot,
} from './lib/diagnostics.types';
export { MemoryCuratorService } from './lib/memory-curator.service';
export type {
  CuratorRunStats,
  MemoryCuratorEventListener,
} from './lib/memory-curator.service';
export type {
  ICuratorLLM,
  ExtractedMemoryDraft,
  ResolvedMemoryDraft,
} from './lib/curator-llm/curator-llm.interface';
export { EmbedderWorkerClient } from './lib/embedder/embedder-worker-client';
export { MEMORY_TOKENS } from './lib/di/tokens';
export type { MemoryDIToken } from './lib/di/tokens';
export { registerMemoryCuratorServices } from './lib/di/register';
export {
  MemoryWriterAdapter,
  sha256Hex,
  formatSeedPrefix,
  parseSeedPrefix,
} from './lib/memory-writer.adapter';
export {
  deriveWorkspaceFingerprint,
  deriveGitHeadSha,
} from './lib/workspace-fingerprint';
export type {
  FingerprintResult,
  FingerprintSource,
} from './lib/workspace-fingerprint';
export { IndexingControlService } from './lib/control/indexing-control.service';
export { KnowledgeAgentService } from './lib/knowledge-agents/knowledge-agent.service';
export type {
  PrimeCorpusResult,
  QueryCorpusResult,
  RebuildCorpusResult,
  DeleteCorpusResult,
} from './lib/knowledge-agents/knowledge-agent.service';
export { CorpusStore } from './lib/knowledge-agents/corpus.store';
export type {
  CorpusChangeEvent,
  CorpusChangeListener,
} from './lib/knowledge-agents/corpus.store';
export type {
  BuildCorpusParams,
  CorpusRef,
  CorpusListEntry,
  CorpusRecord,
} from './lib/knowledge-agents/corpus.types';
export type {
  IndexingStatus,
  SymbolsCursor,
  IndexingProgressEvent,
  IndexingState,
  IndexingPipeline,
  IndexingRunDeps,
} from './lib/control/indexing-control.service';
