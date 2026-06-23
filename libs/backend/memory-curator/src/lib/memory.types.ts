/**
 * Memory Curator domain types.
 *
 * All time fields are integer epoch milliseconds, matching the existing Ptah
 * convention (`compaction-hook-handler.ts`, `session-metadata-store.ts`).
 *
 * Branded `MemoryId` / `ChunkId` types prevent string-cross-pollination at
 * compile time, mirroring the `SessionId` / `MessageId` pattern in
 * `libs/shared/src/lib/types/branded.types.ts`.
 */

import type { MemoryType } from '@ptah-extension/memory-contracts';

export type { MemoryType };

declare const MEMORY_ID_BRAND: unique symbol;
declare const CHUNK_ID_BRAND: unique symbol;

/** ULID, branded so callers cannot mix it with raw strings or `ChunkId`. */
export type MemoryId = string & { readonly [MEMORY_ID_BRAND]: 'MemoryId' };
/** ULID, branded so callers cannot mix it with raw strings or `MemoryId`. */
export type ChunkId = string & { readonly [CHUNK_ID_BRAND]: 'ChunkId' };

/** Unsafe brand cast — use only when constructing IDs from a known ULID source. */
export const memoryId = (value: string): MemoryId => value as MemoryId;
export const chunkId = (value: string): ChunkId => value as ChunkId;

export type MemoryTier = 'core' | 'recall' | 'archival';
export type MemoryKind = 'fact' | 'preference' | 'event' | 'entity';

export interface Memory {
  readonly id: MemoryId;
  readonly sessionId: string | null;
  readonly workspaceRoot: string | null;
  readonly tier: MemoryTier;
  readonly kind: MemoryKind;
  /** Normalized entity key (lowercase, trimmed). */
  readonly subject: string | null;
  readonly content: string;
  /** JSON-serialized array of source jsonl message ids; empty array when unknown. */
  readonly sourceMessageIds: readonly string[];
  readonly salience: number;
  readonly decayRate: number;
  readonly hits: number;
  readonly pinned: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastUsedAt: number;
  /** `null` = no auto-expiry. */
  readonly expiresAt: number | null;
  /** claude-mem 5-field summary: what the user asked for. */
  readonly request: string | null;
  /** claude-mem 5-field summary: what was investigated/inspected. */
  readonly investigated: string | null;
  /** claude-mem 5-field summary: what was learned. */
  readonly learned: string | null;
  /** claude-mem 5-field summary: what was completed/changed. */
  readonly completed: string | null;
  /** claude-mem 5-field summary: suggested next steps. */
  readonly nextSteps: string | null;
  /** Classification taxonomy; defaults to 'discovery' on legacy rows. */
  readonly type: MemoryType;
  /** Short-form concept tags (claude-mem max 5); empty array when unknown. */
  readonly concepts: readonly string[];
  /** File paths touched by the episode; empty array when unknown. */
  readonly files: readonly string[];
}

export interface MemoryChunk {
  readonly id: ChunkId;
  readonly memoryId: MemoryId;
  readonly ord: number;
  readonly text: string;
  readonly tokenCount: number;
  readonly createdAt: number;
}

/** Insert payload for a new memory; `id`/`createdAt`/`updatedAt`/`lastUsedAt` are auto-filled. */
export interface MemoryInsert {
  readonly sessionId?: string | null;
  readonly workspaceRoot?: string | null;
  readonly tier: MemoryTier;
  readonly kind: MemoryKind;
  readonly subject?: string | null;
  readonly content: string;
  readonly sourceMessageIds?: readonly string[];
  readonly salience?: number;
  readonly decayRate?: number;
  readonly pinned?: boolean;
  readonly expiresAt?: number | null;
  readonly request?: string | null;
  readonly investigated?: string | null;
  readonly learned?: string | null;
  readonly completed?: string | null;
  readonly nextSteps?: string | null;
  readonly type?: MemoryType;
  readonly concepts?: readonly string[];
  readonly files?: readonly string[];
}

/** Insert payload for a chunk; `id` and `createdAt` auto-filled. */
export interface ChunkInsert {
  readonly memoryId: MemoryId;
  readonly ord: number;
  readonly text: string;
  readonly tokenCount: number;
  /** Optional pre-computed embedding (Float32Array of length `dim`). */
  readonly embedding?: Float32Array;
}

/** Result of a hybrid memory search query. */
export interface MemorySearchHit {
  readonly memory: Memory;
  readonly chunk: MemoryChunk;
  /** Fused RRF score; higher is better. */
  readonly score: number;
  /** BM25 raw rank (1-indexed) when present in the BM25 result set. */
  readonly bm25Rank: number | null;
  /** Vector distance rank (1-indexed) when present in the vec result set. */
  readonly vecRank: number | null;
}

export interface MemorySearchResponse {
  readonly hits: readonly MemorySearchHit[];
  /** True iff the result set was constructed without sqlite-vec contributions. */
  readonly bm25Only: boolean;
}

/** Response shape for `memory:list`. */
export interface MemoryListResponse {
  readonly memories: readonly Memory[];
  readonly total: number;
}

/** Response shape for `memory:stats`. */
export interface MemoryStatsResponse {
  readonly core: number;
  readonly recall: number;
  readonly archival: number;
  readonly lastCuratedAt: number | null;
}
