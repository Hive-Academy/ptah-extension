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

export type IndexingState =
  | 'never-indexed'
  | 'indexing'
  | 'paused'
  | 'indexed'
  | 'stale'
  | 'error';

export type IndexingPipeline = 'symbols' | 'memory';

export interface SymbolsCursor {
  readonly remainingFiles: string[];
  readonly processed: number;
  readonly total: number;
  readonly batchIndex: number;
}

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

export interface IndexingProgressEvent {
  readonly pipeline: IndexingPipeline;
  readonly percent: number;
  readonly currentLabel: string;
  readonly elapsedMs: number;
  readonly totalKnown: boolean;
}

export interface IndexingGetStatusParams {
  readonly workspaceRoot: string;
}
export interface IndexingGetStatusResult {
  readonly status: IndexingStatusWire;
}

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

export interface IndexingPauseParams {
  readonly pipeline?: IndexingPipeline;
}
export interface IndexingPauseResult {
  readonly accepted: boolean;
  readonly state: IndexingState;
}

export interface IndexingResumeParams {
  readonly workspaceRoot: string;
  readonly pipeline?: IndexingPipeline;
}
export interface IndexingResumeResult {
  readonly accepted: boolean;
  readonly state: IndexingState;
}

export interface IndexingCancelParams {
  readonly pipeline?: IndexingPipeline;
}
export interface IndexingCancelResult {
  readonly accepted: boolean;
  readonly state: IndexingState;
}

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

export interface IndexingDismissStaleParams {
  readonly workspaceRoot: string;
}
export interface IndexingDismissStaleResult {
  readonly accepted: boolean;
  /** The SHA that was recorded as dismissed. */
  readonly dismissedSha: string | null;
}

export interface IndexingAcknowledgeDisclosureParams {
  readonly workspaceRoot: string;
}
export interface IndexingAcknowledgeDisclosureResult {
  readonly accepted: boolean;
  readonly acknowledgedAt: number;
}
