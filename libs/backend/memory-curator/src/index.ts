/**
 * @ptah-extension/memory-curator — public API.
 *
 * Letta-style tiered memory (core/recall/archival) curated automatically on
 * SDK PreCompact firings. Hybrid search via FTS5 (BM25) + sqlite-vec with
 * Reciprocal Rank Fusion fallback to BM25-only.
 */

// Domain types
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

// Services
export { MemoryStore } from './lib/memory.store';
export { MemorySearchService } from './lib/memory-search.service';
export { SalienceScorer } from './lib/salience-scorer';
export type { ScoreInputs } from './lib/salience-scorer';
export { MemoryDecayJob } from './lib/memory-decay.job';
export type { DecayJobOptions } from './lib/memory-decay.job';
export { MemoryCuratorService } from './lib/memory-curator.service';
export type { CuratorRunStats } from './lib/memory-curator.service';

// Curator LLM contract (re-exported from memory-contracts)
export type {
  ICuratorLLM,
  ExtractedMemoryDraft,
  ResolvedMemoryDraft,
} from './lib/curator-llm/curator-llm.interface';

// Embedder (registered under PERSISTENCE_TOKENS.EMBEDDER)
export { EmbedderWorkerClient } from './lib/embedder/embedder-worker-client';

// DI tokens + registration
export { MEMORY_TOKENS } from './lib/di/tokens';
export type { MemoryDIToken } from './lib/di/tokens';
export { registerMemoryCuratorServices } from './lib/di/register';

// IMemoryWriter adapter (registered under PLATFORM_TOKENS.MEMORY_WRITER) and
// its prefix-line helpers — exported for unit-test consumption.
export {
  MemoryWriterAdapter,
  sha256Hex,
  formatSeedPrefix,
  parseSeedPrefix,
} from './lib/memory-writer.adapter';

// Workspace fingerprint helper (used by the wizard seeder in rpc-handlers).
export {
  deriveWorkspaceFingerprint,
  deriveGitHeadSha,
} from './lib/workspace-fingerprint';
export type {
  FingerprintResult,
  FingerprintSource,
} from './lib/workspace-fingerprint';

// Indexing control — user-controlled workspace indexing.
export { IndexingControlService } from './lib/control/indexing-control.service';
export type {
  IndexingStatus,
  BootStrategy,
  SymbolsCursor,
  IndexingProgressEvent,
  IndexingState,
  IndexingPipeline,
  IndexingRunDeps,
} from './lib/control/indexing-control.service';
