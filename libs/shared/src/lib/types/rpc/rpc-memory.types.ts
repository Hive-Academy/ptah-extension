/**
 * RPC types — Memory Curator (TASK_2026_HERMES Track 1).
 *
 * 8 memory.* methods: list / search / get / pin / unpin / forget /
 * rebuildIndex / stats. Mirrors `@ptah-extension/memory-curator` domain
 * types over the structured-clone wire boundary, so all `Memory` /
 * `MemoryChunk` fields are plain (non-branded) JSON-friendly types.
 */

export type MemoryTierWire = 'core' | 'recall' | 'archival';
export type MemoryKindWire = 'fact' | 'preference' | 'event' | 'entity';

export interface MemoryWire {
  readonly id: string;
  readonly sessionId: string | null;
  readonly workspaceRoot: string | null;
  readonly tier: MemoryTierWire;
  readonly kind: MemoryKindWire;
  readonly subject: string | null;
  readonly content: string;
  readonly sourceMessageIds: readonly string[];
  readonly salience: number;
  readonly decayRate: number;
  readonly hits: number;
  readonly pinned: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastUsedAt: number;
  readonly expiresAt: number | null;
}

export interface MemoryChunkWire {
  readonly id: string;
  readonly memoryId: string;
  readonly ord: number;
  readonly text: string;
  readonly tokenCount: number;
  readonly createdAt: number;
}

// ---- memory:list ----
export interface MemoryListParams {
  readonly workspaceRoot?: string | null;
  readonly tier?: MemoryTierWire;
  readonly limit?: number;
  readonly offset?: number;
}
export interface MemoryListResult {
  readonly memories: readonly MemoryWire[];
  readonly total: number;
}

// ---- memory:search ----
export interface MemorySearchParams {
  readonly query: string;
  readonly topK?: number;
  readonly workspaceRoot?: string;
}
export interface MemorySearchHitWire {
  readonly memory: MemoryWire;
  readonly chunk: MemoryChunkWire;
  readonly score: number;
  readonly bm25Rank: number | null;
  readonly vecRank: number | null;
}
export interface MemorySearchResult {
  readonly hits: readonly MemorySearchHitWire[];
  readonly bm25Only: boolean;
}

// ---- memory:get ----
export interface MemoryGetParams {
  readonly id: string;
}
export interface MemoryGetResult {
  readonly memory: MemoryWire | null;
  readonly chunks: readonly MemoryChunkWire[];
}

// ---- memory:pin / memory:unpin ----
export interface MemoryPinParams {
  readonly id: string;
}
export interface MemoryPinResult {
  readonly success: boolean;
  readonly pinned: boolean;
}

// ---- memory:forget ----
export interface MemoryForgetParams {
  readonly id: string;
}
export interface MemoryForgetResult {
  readonly success: boolean;
}

// ---- memory:rebuildIndex ----
export interface MemoryRebuildIndexParams {
  readonly mode?: 'fts' | 'vec' | 'both';
}
export interface MemoryRebuildIndexResult {
  readonly rebuiltFts: boolean;
  readonly rebuiltVec: boolean;
}

// ---- memory:stats ----
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface MemoryStatsParams {
  readonly workspaceRoot?: string | null;
}
export interface MemoryStatsResult {
  readonly core: number;
  readonly recall: number;
  readonly archival: number;
  readonly lastCuratedAt: number | null;
}

// ---- memory:purgeBySubjectPattern ----
export interface MemoryPurgeBySubjectPatternParams {
  readonly pattern: string;
  readonly mode: 'substring' | 'like';
  readonly workspaceRoot?: string | null;
}
export interface MemoryPurgeBySubjectPatternResult {
  readonly deleted: number;
}
