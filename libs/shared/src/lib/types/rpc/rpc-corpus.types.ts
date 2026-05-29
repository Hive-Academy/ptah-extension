/**
 * RPC types — Knowledge corpus (`corpus:` namespace).
 *
 * A "corpus" is a workspace-scoped, named snapshot of memory ids derived from
 * a persisted `mem:searchIndex` filter. Corpora power priming sessions where
 * the corpus contents are pre-loaded into the system prompt for fast Q&A.
 *
 * Eight methods route through `KnowledgeAgentService`:
 *   - `corpus:list`     — workspace-scoped lookup
 *   - `corpus:get`      — single corpus by name
 *   - `corpus:build`    — create + snapshot memory ids from filter
 *   - `corpus:prime`    — open a primed session with corpus block prepended
 *   - `corpus:query`    — send question to most recent alive primed session
 *   - `corpus:reprime`  — end existing primed sessions, open a fresh one
 *   - `corpus:rebuild`  — re-run filter, diff membership, return added/removed
 *   - `corpus:delete`   — drop the corpus row (cascade clears join)
 */

import type { MemoryTypeWire } from './rpc-mem.types';

export interface CorpusEntry {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly builtAt: number;
  readonly rebuiltAt: number | null;
  readonly workspaceRoot: string | null;
}

export interface CorpusListParams {
  readonly workspaceRoot?: string;
}

export interface CorpusListResult {
  readonly corpora: readonly CorpusEntry[];
}

export interface CorpusGetParams {
  readonly name: string;
}

export interface CorpusGetResult {
  readonly corpus: CorpusEntry | null;
}

export interface CorpusBuildDateRange {
  readonly fromMs?: number;
  readonly toMs?: number;
}

export interface CorpusBuildParams {
  readonly name: string;
  readonly workspaceRoot?: string | null;
  readonly type?: readonly MemoryTypeWire[];
  readonly concepts?: readonly string[];
  readonly files?: readonly string[];
  readonly query?: string;
  readonly dateRange?: CorpusBuildDateRange;
  readonly limit?: number;
}

export interface CorpusBuildResult {
  readonly corpus: CorpusEntry;
}

export interface CorpusPrimeParams {
  readonly name: string;
}

export interface CorpusPrimeResult {
  readonly sessionId: string;
}

export interface CorpusQueryParams {
  readonly name: string;
  readonly question: string;
}

export interface CorpusQueryResult {
  readonly sessionId: string;
  readonly answer: string;
}

export interface CorpusReprimeParams {
  readonly name: string;
}

export interface CorpusReprimeResult {
  readonly sessionId: string;
}

export interface CorpusRebuildParams {
  readonly name: string;
}

export interface CorpusRebuildResult {
  readonly added: number;
  readonly removed: number;
}

export interface CorpusDeleteParams {
  readonly name: string;
}

export interface CorpusDeleteResult {
  readonly deleted: boolean;
}
