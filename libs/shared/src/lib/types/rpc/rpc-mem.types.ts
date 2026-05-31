/**
 * RPC types — Progressive disclosure memory search (`mem:` namespace).
 *
 * Compact-row contract designed for token-budget-aware LLM consumption:
 * the `MemoryIndexRow` shape DELIBERATELY excludes `content` so that
 * search results fit inside a tight context window. Full memory content
 * is fetched on-demand via `mem:getObservations`.
 *
 * Three methods:
 *   - `mem:searchIndex`     — hybrid BM25 + vec ranking with filters,
 *                             returning compact rows. Empty `query` ⇒
 *                             pure-filter listing (skips BM25/vec).
 *   - `mem:timeline`        — `before/after` neighbours of an anchor
 *                             memory in workspace creation order.
 *   - `mem:getObservations` — full 5-field memory payload plus the
 *                             read-only observation queue rows grouped
 *                             by session.
 */

export type MemoryTypeWire =
  | 'bugfix'
  | 'feature'
  | 'decision'
  | 'discovery'
  | 'refactor'
  | 'change';

export interface MemoryIndexRow {
  readonly id: string;
  readonly subject: string | null;
  readonly type: MemoryTypeWire;
  readonly concepts: readonly string[];
  readonly files: readonly string[];
  readonly capturedAt: number;
  readonly score: number;
  readonly workspaceRoot: string | null;
}

export interface MemSearchIndexDateRange {
  readonly fromMs?: number;
  readonly toMs?: number;
}

export interface MemSearchIndexParams {
  readonly query?: string;
  readonly topK?: number;
  readonly workspaceRoot?: string;
  readonly project?: string;
  readonly type?: readonly MemoryTypeWire[];
  readonly concepts?: readonly string[];
  readonly files?: readonly string[];
  readonly dateRange?: MemSearchIndexDateRange;
}

export interface MemSearchIndexResult {
  readonly rows: readonly MemoryIndexRow[];
  readonly bm25Only: boolean;
}

export interface MemTimelineParams {
  readonly anchorId: string;
  readonly before?: number;
  readonly after?: number;
  readonly workspaceRoot?: string;
}

export interface MemTimelineResult {
  readonly rows: readonly MemoryIndexRow[];
  readonly anchorIndex: number;
}

export interface MemGetObservationsParams {
  readonly ids: readonly string[];
  readonly includeQueueRows?: boolean;
}

export interface MemMemoryFull {
  readonly id: string;
  readonly subject: string | null;
  readonly content: string;
  readonly type: MemoryTypeWire;
  readonly request: string | null;
  readonly investigated: string | null;
  readonly learned: string | null;
  readonly completed: string | null;
  readonly nextSteps: string | null;
  readonly concepts: readonly string[];
  readonly files: readonly string[];
  readonly sessionId: string | null;
  readonly workspaceRoot: string | null;
  readonly capturedAt: number;
}

export interface MemObservationRow {
  readonly id: number;
  readonly kind: string;
  readonly toolName: string | null;
  readonly filePath: string | null;
  readonly capturedAt: number;
}

export interface MemGetObservationsResult {
  readonly memories: readonly MemMemoryFull[];
  readonly observationsBySession: Readonly<
    Record<string, readonly MemObservationRow[]>
  >;
}
