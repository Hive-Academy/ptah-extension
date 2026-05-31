/**
 * Memory push-event payload contracts.
 *
 * Backend → Frontend push messages broadcast from `wire-runtime.ts` after
 * `memoryCurator.start()`. The wire payloads intentionally exclude all bulk
 * fields (`tool_response_text`, JSONL excerpts, chunk content) so the
 * structured-clone boundary stays cheap.
 *
 * Four channels, matching `MESSAGE_TYPES.MEMORY_*`:
 *   - `memory:observationCaptured` — single observation queued by a hook.
 *   - `memory:corpusChanged`       — corpus built / rebuilt / primed / deleted.
 *   - `memory:extracted`           — curator run produced N new memories.
 *   - `memory:sessionStartInjected` — SessionStart prompt block emitted (UI badge).
 */

/**
 * Wire shape of the observation queue `kind` column. Kept in sync with the
 * backend's `ObservationKind` union but inlined here so `@ptah-extension/shared`
 * stays leaf-free of backend libs (per shared/CLAUDE.md: "must not import any
 * other `@ptah-extension/*` lib").
 */
export type ObservationKindWire =
  | 'tool-use'
  | 'tool-failure'
  | 'assistant-turn'
  | 'user-prompt'
  | 'file-read'
  | 'commit';

export interface MemoryObservationCapturedPayload {
  readonly sessionId: string;
  readonly workspaceRoot: string | null;
  readonly kind: ObservationKindWire;
  readonly timestamp: number;
}

export interface MemoryCorpusChangedPayload {
  readonly action: 'built' | 'rebuilt' | 'primed' | 'deleted';
  readonly corpusId: string;
  readonly name: string;
  readonly count: number;
  readonly timestamp: number;
}

export interface MemoryExtractedPayload {
  readonly sessionId: string;
  readonly workspaceRoot: string | null;
  readonly extracted: number;
  readonly created: number;
  readonly merged: number;
  readonly timestamp: number;
}

export interface MemorySessionStartInjectedPayload {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly observationCount: number;
  readonly corpusCount: number;
  readonly timestamp: number;
}
