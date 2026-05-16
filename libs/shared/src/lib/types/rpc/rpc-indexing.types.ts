/**
 * RPC types — Workspace Indexing Control.
 *
 * 8 indexing.* methods: getStatus / start / pause / resume / cancel /
 * setPipelineEnabled / dismissStale / acknowledgeDisclosure.
 *
 * All types are plain JSON-friendly (no Date objects, no branded IDs) —
 * suitable for structured-clone wire transport between extension host and
 * webview / Electron renderer.
 */

// ---- Shared union types ----

export type IndexingState =
  | 'never-indexed'
  | 'indexing'
  | 'paused'
  | 'indexed'
  | 'stale'
  | 'error';

export type IndexingPipeline = 'symbols' | 'memory';

// ---- Cursor for resumable symbol indexing ----

export interface SymbolsCursor {
  readonly remainingFiles: string[];
  readonly processed: number;
  readonly total: number;
  readonly batchIndex: number;
}

// ---- Wire representation of IndexingStatus ----
// Mirrors the backend IndexingStatus interface but with all timestamps
// as epoch-millisecond numbers (not Date objects) for JSON transport.

export interface IndexingStatusWire {
  readonly state: IndexingState;
  readonly workspaceFingerprint: string;
  readonly gitHeadSha: string | null;
  readonly currentGitHeadSha: string | null;
  readonly lastIndexedAt: number | null;
  readonly symbolsEnabled: boolean;
  readonly memoryEnabled: boolean;
  readonly symbolsCursor: SymbolsCursor | null;
  readonly disclosureAcknowledgedAt: number | null;
  readonly lastDismissedStaleSha: string | null;
  readonly errorMessage: string | null;
}

// ---- Progress event broadcast on indexing:progress push message ----

export interface IndexingProgressEvent {
  readonly pipeline: IndexingPipeline;
  readonly percent: number;
  readonly currentLabel: string;
  readonly elapsedMs: number;
  readonly totalKnown: boolean;
}

// ---- indexing:getStatus ----

export interface IndexingGetStatusParams {
  readonly workspaceRoot: string;
}
export interface IndexingGetStatusResult {
  readonly status: IndexingStatusWire;
}

// ---- indexing:start ----

export interface IndexingStartParams {
  readonly workspaceRoot: string;
  /** When true, bypasses the git-HEAD fingerprint check (Re-index / Force button path). */
  readonly force?: boolean;
  /** Restrict to a single pipeline; if absent both pipelines run. */
  readonly pipeline?: IndexingPipeline;
}
export interface IndexingStartResult {
  readonly accepted: boolean;
  /** State after the start command was processed. */
  readonly state: IndexingState;
}

// ---- indexing:pause ----

export interface IndexingPauseParams {
  readonly pipeline?: IndexingPipeline;
}
export interface IndexingPauseResult {
  readonly accepted: boolean;
  readonly state: IndexingState;
}

// ---- indexing:resume ----

export interface IndexingResumeParams {
  readonly workspaceRoot: string;
  readonly pipeline?: IndexingPipeline;
}
export interface IndexingResumeResult {
  readonly accepted: boolean;
  readonly state: IndexingState;
}

// ---- indexing:cancel ----

export interface IndexingCancelParams {
  readonly pipeline?: IndexingPipeline;
}
export interface IndexingCancelResult {
  readonly accepted: boolean;
  readonly state: IndexingState;
}

// ---- indexing:setPipelineEnabled ----

export interface IndexingSetPipelineEnabledParams {
  readonly workspaceRoot: string;
  readonly pipeline: IndexingPipeline;
  readonly enabled: boolean;
}
export interface IndexingSetPipelineEnabledResult {
  readonly applied: boolean;
  readonly symbolsEnabled: boolean;
  readonly memoryEnabled: boolean;
}

// ---- indexing:dismissStale ----

export interface IndexingDismissStaleParams {
  readonly workspaceRoot: string;
}
export interface IndexingDismissStaleResult {
  readonly accepted: boolean;
  /** The SHA that was recorded as dismissed. */
  readonly dismissedSha: string | null;
}

// ---- indexing:acknowledgeDisclosure ----

export interface IndexingAcknowledgeDisclosureParams {
  readonly workspaceRoot: string;
}
export interface IndexingAcknowledgeDisclosureResult {
  readonly accepted: boolean;
  readonly acknowledgedAt: number;
}
