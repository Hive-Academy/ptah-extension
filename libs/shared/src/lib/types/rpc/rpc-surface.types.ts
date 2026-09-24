/**
 * `surface:*` RPC wire contract (TASK_2026_538, plan Component 8, Req 6 and 9).
 *
 * The webview's only channel to host-owned surface state. Every method is
 * mediated by the host: the renderer names a surface, a revision and an
 * operation id; the host resolves inputs and actions from its STORED copy and
 * never takes a value, a parameter or a URL from the renderer that the stored
 * declaration does not allow (Req 6.7).
 *
 * `routingId` is the conversation's routing id (a tab id or a real session
 * id). An unknown routing id and an unknown surface give the same
 * `not-found`, with no revision, and never create state (Req 6.3, 9.6).
 *
 * Plain types only: this module is reached from the main `@ptah-extension/shared`
 * barrel, so it imports nothing at runtime and reaches only `surface.types`
 * (already on that barrel). It must not reach the v2 helper modules such as
 * `surface-bindings.ts`: consumers that build the barrel without
 * `strictNullChecks` cannot compile their discriminated-union narrowing.
 */
import type {
  SurfaceDataValue,
  SurfaceOperationStatus,
  SurfaceRejectReason,
  SurfaceSelection,
  SurfaceStateView,
} from '../../../mcp-apps-contracts/surface.types';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

/** `surface:read`: every surface of a routing id, or one named surface. */
export interface SurfaceReadParams {
  readonly routingId: string;
  readonly surfaceId?: string;
}

/**
 * Fields every UI mutation carries (Req 6.2): the surface, the revision the
 * UI rendered and a client-generated operation id
 * (`op-<13-digit epoch ms>-<8-40 alphanumerics>`).
 */
export interface SurfaceMutationParamsBase {
  readonly routingId: string;
  readonly surfaceId: string;
  readonly revision: number;
  readonly operationId: string;
}

/** `surface:change`: write `value` to the bound path of input `componentId`. */
export interface SurfaceChangeParams extends SurfaceMutationParamsBase {
  readonly componentId: string;
  readonly value: SurfaceDataValue;
}

/** `surface:select`: set, or clear with `null`, the surface's selection. */
export interface SurfaceSelectParams extends SurfaceMutationParamsBase {
  readonly selection: SurfaceSelection | null;
}

/**
 * `surface:action`: invoke action `actionId` as the stored surface declares it.
 * No parameters travel with it; they come from the stored declaration.
 */
export interface SurfaceActionParams extends SurfaceMutationParamsBase {
  readonly actionId: string;
}

/** `surface:operation`: the outcome of a UI operation id (Req 6.5). */
export interface SurfaceOperationParams {
  readonly routingId: string;
  readonly operationId: string;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * One failing input of a rejected submit (Req 10.2). The same shape as the
 * contract's `SurfaceSubmitIssue`, restated here for the reason above.
 */
export interface SurfaceRpcSubmitIssue {
  readonly componentId: string;
  readonly path: string;
  readonly message: string;
}

/** `surface:read` (Req 9.5): complete, never truncated. */
export type SurfaceReadResult =
  | {
      readonly status: 'found';
      readonly routingId: string;
      readonly surfaces: readonly SurfaceStateView[];
    }
  | { readonly status: 'not-found' };

/** A committed `change` or `select`: always carries its revision (Req 7.7). */
export interface SurfaceAppliedResult {
  readonly status: 'applied';
  readonly operationId: string;
  readonly revision: number;
}

export interface SurfaceRejectedResult {
  readonly status: 'rejected';
  readonly operationId: string;
  readonly reason: SurfaceRejectReason;
  readonly detail: string;
  /** Set with `stale-revision`: the revision to re-read. */
  readonly currentRevision?: number;
  /** Set with `submit-invalid`: every failing input path (Req 10.2). */
  readonly issues?: readonly SurfaceRpcSubmitIssue[];
}

/** Unknown routing id or surface, deleted or evicted: no revision (Req 6.3). */
export interface SurfaceNotFoundResult {
  readonly status: 'not-found';
  readonly operationId?: string;
}

/** Received, not yet terminal (a submit whose dispatch is unresolved). */
export interface SurfacePendingResult {
  readonly status: 'pending';
  readonly operationId: string;
}

/**
 * A retained `dashboard.*` action with no host behaviour here (Req 6.8).
 * Nothing happened. The operation id is recorded as a terminal refusal, so an
 * identical retry returns this again, other content under the same id is
 * `operation-conflict`, and `surface:operation` reports
 * `{ status: 'rejected', reason: 'unsupported' }`. `detail` names the action
 * (the renderer already holds the declaration it invoked).
 */
export interface SurfaceUnsupportedResult {
  readonly status: 'unsupported';
  readonly operationId: string;
  readonly detail: string;
}

/**
 * What a settled submit did to the surface it came from, separate from what
 * happened to the turn.
 *
 * - `updated`: the last-submit record was committed at `revision`.
 * - `not-recorded`: no revision was produced and no last submit was written.
 *   The surface was deleted, evicted or recreated before the submit settled
 *   (or, defensively, the record could not be committed). The turn outcome
 *   stands either way: the host never invents a revision and never
 *   redispatches because one is absent.
 */
export type SurfaceSubmitSurfaceState =
  | { readonly kind: 'updated'; readonly revision: number }
  | { readonly kind: 'not-recorded' };

/** A submit whose message the chat runtime accepted as the next turn. */
export interface SurfaceSubmitAppliedResult {
  readonly status: 'applied';
  readonly operationId: string;
  readonly surfaceState: SurfaceSubmitSurfaceState;
}

/**
 * A submit whose turn may or may not have started. Not a failure; the host
 * does not resend it (Req 6.5, 10.3).
 */
export interface SurfaceSubmitIndeterminateResult {
  readonly status: 'indeterminate';
  readonly operationId: string;
  readonly detail: string;
  readonly surfaceState: SurfaceSubmitSurfaceState;
}

/** `surface:change` and `surface:select`. */
export type SurfaceMutationResult =
  | SurfaceAppliedResult
  | SurfaceRejectedResult
  | SurfaceNotFoundResult
  | SurfacePendingResult;

/** `surface:action`. A replay returns the recorded outcome, never a new turn. */
export type SurfaceActionResult =
  | SurfaceSubmitAppliedResult
  | SurfaceSubmitIndeterminateResult
  | SurfaceRejectedResult
  | SurfaceNotFoundResult
  | SurfacePendingResult
  | SurfaceUnsupportedResult;

/**
 * `surface:operation` (Req 6.5). `unknown`: never received, or forgotten after
 * its retention window; it authorizes neither rollback nor replay.
 */
export interface SurfaceOperationResult {
  readonly status: SurfaceOperationStatus;
  readonly reason?: SurfaceRejectReason;
  readonly detail?: string;
  /**
   * `applied` / `indeterminate`: the revision the operation committed. Absent
   * when it committed none (a submit whose surface was gone at settlement).
   */
  readonly revision?: number;
  /** `rejected` with `stale-revision`: the revision to re-read. */
  readonly currentRevision?: number;
}
