/**
 * `surface:*` RPC handlers (TASK_2026_538, plan Component 15, Req 6, 9, 10).
 *
 * The webview's only channel to host-owned surface state:
 *
 *  - `surface:read`      complete state of a routing id, or of one surface.
 *  - `surface:change`    write one input's bound path; never starts a turn.
 *  - `surface:select`    set or clear the selection, checked on the host copy.
 *  - `surface:action`    invoke a DECLARED action: `surface.submit` starts one
 *                        agent turn; the retained `dashboard.*` ids are
 *                        `unsupported` (Req 6.8).
 *  - `surface:operation` the outcome of a UI operation id (Req 6.5).
 *
 * ## Boundary
 *
 * Every call measures `jsonUtf8Bytes(params)` against
 * `SURFACE_LIMITS.maxRpcRequestBytes` first, then runs the `.strict()` schema;
 * either failure is `INVALID_PARAMS` with nothing changed (Req 9.2). An
 * unknown routing id or surface is `not-found` with no revision, and nothing
 * here ever creates state (Req 6.3, 9.6): only the agent path creates surfaces.
 *
 * ## Submit ordering (plan :708-711)
 *
 * `beginSubmit` (validate, reserve the operation id, staleness, scoped values,
 * frozen snapshot and formatted message) -> the operation reads `pending` to
 * `surface:operation` -> `SurfaceSubmitTurnService.dispatch` -> `settleSubmit`.
 * A replayed operation id answers from the ledger and never dispatches again
 * (Req 10.5). `dispatch` is bounded by `SURFACE_SUBMIT_DISPATCH_DEADLINE_MS`:
 * a send that does not answer in time settles `indeterminate` (never resent),
 * so no reservation or ticket is held forever. A submit whose surface was deleted, evicted or recreated before
 * settlement keeps its terminal outcome; its `surfaceState` is
 * `not-recorded`: the host never invents a revision and never redispatches
 * because one is absent.
 *
 * ## Missing collaborators
 *
 * The surface state service is registered on every supported host. If it is
 * absent (misconfiguration only), every method throws "surface state
 * unavailable on this host", which the RPC layer returns as an error response.
 * A missing submit-turn service settles the submit as `rejected:
 * session-unavailable`, so the operation still reaches a terminal state.
 */

import { inject, injectable } from 'tsyringe';
import type { z } from 'zod';
import { RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { jsonUtf8Bytes } from '@ptah-extension/platform-core';
import {
  VSCODE_LM_TOOLS_TOKENS,
  type SurfaceActionResolution,
  type SurfaceMutationOutcome,
  type SurfaceStateService,
  type SurfaceSubmitDispatchOutcome,
  type SurfaceSubmitRequest,
  type SurfaceSubmitTicket,
} from '@ptah-extension/vscode-lm-tools';
import type {
  RpcMethodName,
  SurfaceActionParams,
  SurfaceActionResult,
  SurfaceChangeParams,
  SurfaceMutationResult,
  SurfaceOperationParams,
  SurfaceOperationResult,
  SurfaceReadParams,
  SurfaceReadResult,
  SurfaceRejectedResult,
  SurfaceSelectParams,
  SurfaceSubmitSurfaceState,
} from '@ptah-extension/shared';
import { SURFACE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { CHAT_TOKENS } from '../chat/tokens';
import {
  SURFACE_SUBMIT_INDETERMINATE_DETAIL,
  type SurfaceSubmitTurnService,
} from '../chat/session/surface-submit-turn.service';
import {
  SurfaceActionParamsSchema,
  SurfaceChangeParamsSchema,
  SurfaceOperationParamsSchema,
  SurfaceReadParamsSchema,
  SurfaceSelectParamsSchema,
  type SurfaceActionInput,
} from './surface-rpc.schema';

/** The error every method returns when the host has no surface state. */
export const SURFACE_STATE_UNAVAILABLE_MESSAGE =
  'surface state unavailable on this host';

/** Settlement when the host has no chat runtime to take a submit. */
export const SURFACE_SUBMIT_NO_RUNTIME_DETAIL =
  'The chat runtime is not available on this host; the submit was not sent.';

/** `dashboard.select` has its own method; `surface:action` refuses it. */
export const SURFACE_ACTION_SELECT_DETAIL =
  'dashboard.select is not invoked through surface:action; record the selection with surface:select.';

/** At most this many schema issues are named in an INVALID_PARAMS message. */
const MAX_REPORTED_ISSUES = 5;
/** Each reported issue is cut to this many UTF-16 units. */
const MAX_ISSUE_LENGTH = 200;

/** The third argument of `SurfaceStateService.refuseAction`. */
type SurfaceActionRefusal = Parameters<SurfaceStateService['refuseAction']>[2];

type SurfaceRpcMethod =
  | 'surface:read'
  | 'surface:change'
  | 'surface:select'
  | 'surface:action'
  | 'surface:operation';

@injectable()
export class SurfaceRpcHandlers {
  static readonly METHODS = [
    'surface:read',
    'surface:change',
    'surface:select',
    'surface:action',
    'surface:operation',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE, { isOptional: true })
    private readonly surfaceState: SurfaceStateService | undefined,
    @inject(CHAT_TOKENS.SURFACE_SUBMIT_TURN, { isOptional: true })
    private readonly submitTurn: SurfaceSubmitTurnService | undefined,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<SurfaceReadParams, SurfaceReadResult>(
      'surface:read',
      async (params) => this.handleRead(params),
    );
    this.rpcHandler.registerMethod<SurfaceChangeParams, SurfaceMutationResult>(
      'surface:change',
      async (params) => this.handleChange(params),
    );
    this.rpcHandler.registerMethod<SurfaceSelectParams, SurfaceMutationResult>(
      'surface:select',
      async (params) => this.handleSelect(params),
    );
    this.rpcHandler.registerMethod<SurfaceActionParams, SurfaceActionResult>(
      'surface:action',
      async (params) => this.handleAction(params),
    );
    this.rpcHandler.registerMethod<
      SurfaceOperationParams,
      SurfaceOperationResult
    >('surface:operation', async (params) => this.handleOperation(params));

    this.safeLog('debug', '[surface] RPC handlers registered', {
      methods: SurfaceRpcHandlers.METHODS,
      surfaceState: this.surfaceState !== undefined,
      submitTurn: this.submitTurn !== undefined,
    });
  }

  // ------------------------------------------------------------ handlers

  private async handleRead(params: unknown): Promise<SurfaceReadResult> {
    const input = parseParams('surface:read', SurfaceReadParamsSchema, params);
    return this.state().read(input.routingId, input.surfaceId);
  }

  private async handleChange(params: unknown): Promise<SurfaceMutationResult> {
    const input = parseParams(
      'surface:change',
      SurfaceChangeParamsSchema,
      params,
    );
    const outcome = this.state().change(input.routingId, {
      surfaceId: input.surfaceId,
      revision: input.revision,
      operationId: input.operationId,
      componentId: input.componentId,
      value: input.value,
    });
    return toMutationResult(outcome);
  }

  private async handleSelect(params: unknown): Promise<SurfaceMutationResult> {
    const input = parseParams(
      'surface:select',
      SurfaceSelectParamsSchema,
      params,
    );
    const outcome = this.state().select(input.routingId, {
      surfaceId: input.surfaceId,
      revision: input.revision,
      operationId: input.operationId,
      selection: input.selection,
    });
    return toMutationResult(outcome);
  }

  /**
   * The action is resolved from the STORED declaration only (Req 6.7); the
   * renderer names an id and nothing else.
   *
   * Every `surface:action` operation id goes through the ledger, and an
   * existing record always answers first (replay of the recorded outcome, or
   * `operation-conflict` for other content), whatever the surface now
   * declares (Req 6.4). So a retry of a submit whose surface was deleted or
   * recreated gets its terminal outcome and never a second turn, and a
   * refusal replays identically.
   *
   *  - An absent surface or a declared `surface.submit` takes the submit path;
   *    `beginSubmit` answers `not-found`, replays and staleness itself.
   *  - Anything else is refused before any side effect and recorded as a
   *    terminal rejection (`refuseAction`): `stale-revision` with
   *    `currentRevision` when the UI rendered another revision (Req 6.3);
   *    otherwise `undeclared`, `dashboard.select` pointed at `surface:select`,
   *    or `unsupported` for a retained `dashboard.*` action (Req 6.8).
   */
  private async handleAction(params: unknown): Promise<SurfaceActionResult> {
    const input = parseParams(
      'surface:action',
      SurfaceActionParamsSchema,
      params,
    );
    const state = this.state();
    const resolution = state.resolveAction(
      input.routingId,
      input.surfaceId,
      input.actionId,
    );
    if (
      resolution.status === 'not-found' ||
      (resolution.status === 'declared' &&
        resolution.action === 'surface.submit')
    )
      return this.submit(state, input);
    return toActionResult(
      state.refuseAction(
        input.routingId,
        submitRequest(input),
        actionRefusal(input, resolution),
      ),
    );
  }

  private async handleOperation(
    params: unknown,
  ): Promise<SurfaceOperationResult> {
    const input = parseParams(
      'surface:operation',
      SurfaceOperationParamsSchema,
      params,
    );
    const status = this.state().operationStatus(
      input.routingId,
      input.operationId,
    );
    const result: {
      -readonly [K in keyof SurfaceOperationResult]: SurfaceOperationResult[K];
    } = { status: status.status };
    if (status.reason !== undefined) result.reason = status.reason;
    if (status.detail !== undefined) result.detail = status.detail;
    if (status.revision !== undefined) {
      // The ledger keeps one revision per record: the committed one for an
      // applied or indeterminate operation, the current one for a stale
      // rejection. The wire names them apart.
      if (status.status === 'rejected')
        result.currentRevision = status.revision;
      else result.revision = status.revision;
    }
    return result;
  }

  // -------------------------------------------------------------- submit

  /**
   * Reserve, dispatch, settle. `settleSubmit` runs exactly once for every
   * ticket: `dispatchTicket` never throws, so nothing can skip it.
   */
  private async submit(
    state: SurfaceStateService,
    input: SurfaceActionInput,
  ): Promise<SurfaceActionResult> {
    const begin = state.beginSubmit(input.routingId, submitRequest(input));
    if (begin.status !== 'dispatch') return toActionResult(begin);
    // The operation is now `pending` to surface:operation until settled.
    const dispatched = await this.dispatchTicket(begin.ticket);
    return toActionResult(state.settleSubmit(begin.ticket, dispatched));
  }

  /**
   * Hand the frozen, host-formatted message to the chat runtime. Resolves
   * with an outcome and never rejects: `dispatch` already never rejects, and
   * an unexpected throw is `indeterminate` (it may have followed a push), so
   * the message is never resent.
   */
  private async dispatchTicket(
    ticket: SurfaceSubmitTicket,
  ): Promise<SurfaceSubmitDispatchOutcome> {
    if (this.submitTurn === undefined)
      return {
        status: 'rejected',
        reason: 'session-unavailable',
        detail: SURFACE_SUBMIT_NO_RUNTIME_DETAIL,
      };
    try {
      return await this.submitTurn.dispatch(ticket.routingId, ticket.message);
    } catch (error: unknown) {
      this.safeLog('warn', '[surface] submit dispatch threw', {
        routingId: ticket.routingId,
        surfaceId: ticket.surfaceId,
        operationId: ticket.operationId,
        errorName: errorName(error),
      });
      return {
        status: 'indeterminate',
        detail: SURFACE_SUBMIT_INDETERMINATE_DETAIL,
      };
    }
  }

  // ------------------------------------------------------------- helpers

  private state(): SurfaceStateService {
    if (this.surfaceState === undefined)
      throw new Error(SURFACE_STATE_UNAVAILABLE_MESSAGE);
    return this.surfaceState;
  }

  /** Diagnostics are best-effort: a throwing logger never changes a result. */
  private safeLog(
    level: 'debug' | 'warn',
    message: string,
    meta: Record<string, unknown>,
  ): void {
    try {
      this.logger[level](message, meta);
    } catch (error: unknown) {
      // Deliberately dropped: the log line is the only thing lost.
      void error;
    }
  }
}

// ----------------------------------------------------------------- mapping

/**
 * Bytes first, then the strict schema (Req 9.2). A request that cannot be
 * serialized (a cycle, a BigInt) is invalid too. The message names the
 * failing paths and the budget, never a submitted value.
 */
function parseParams<S extends z.ZodType>(
  method: SurfaceRpcMethod,
  schema: S,
  params: unknown,
): z.output<S> {
  const bytes = requestBytes(params);
  if (bytes === undefined)
    throw new RpcUserError(
      `${method}: invalid params — the request is not serializable JSON.`,
      'INVALID_PARAMS',
    );
  if (bytes > SURFACE_LIMITS.maxRpcRequestBytes)
    throw new RpcUserError(
      `${method}: invalid params — the request is ${bytes} bytes, over the maxRpcRequestBytes limit of ${SURFACE_LIMITS.maxRpcRequestBytes}.`,
      'INVALID_PARAMS',
    );
  const parsed = schema.safeParse(params);
  if (!parsed.success)
    throw new RpcUserError(
      `${method}: invalid params — ${describeIssues(parsed.error)}`,
      'INVALID_PARAMS',
    );
  return parsed.data;
}

function requestBytes(params: unknown): number | undefined {
  try {
    return jsonUtf8Bytes(params);
  } catch (error: unknown) {
    // JSON.stringify throws on cycles and BigInt; either is an invalid request.
    void error;
    return undefined;
  }
}

function describeIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join('.');
    const line = `${path === '' ? '(params)' : path}: ${issue.message}`;
    return line.length <= MAX_ISSUE_LENGTH
      ? line
      : `${line.slice(0, MAX_ISSUE_LENGTH)}...`;
  });
  const more = error.issues.length - issues.length;
  return more > 0
    ? `${issues.join('; ')}; and ${more} more issue(s).`
    : issues.join('; ');
}

function errorName(error: unknown): string {
  try {
    return error instanceof Error ? String(error.name) : typeof error;
  } catch (nameError: unknown) {
    void nameError;
    return 'unknown';
  }
}

function rejectedResult(
  outcome: Extract<SurfaceMutationOutcome, { status: 'rejected' }>,
): SurfaceRejectedResult {
  return {
    status: 'rejected',
    operationId: outcome.operationId,
    reason: outcome.reason,
    detail: outcome.detail,
    ...(outcome.currentRevision === undefined
      ? {}
      : { currentRevision: outcome.currentRevision }),
    ...(outcome.issues === undefined ? {} : { issues: outcome.issues }),
  };
}

function submitRequest(input: SurfaceActionInput): SurfaceSubmitRequest {
  return {
    surfaceId: input.surfaceId,
    revision: input.revision,
    operationId: input.operationId,
    actionId: input.actionId,
  };
}

/**
 * Why a non-submit action is refused. The revision comes first (Req 6.3):
 * a request from another rendering is `stale-revision` with the revision to
 * re-read, whatever the action, so the UI can recover. Only a current
 * request learns that the action is undeclared, `dashboard.select`, or
 * unsupported.
 */
function actionRefusal(
  input: SurfaceActionInput,
  resolution: Exclude<SurfaceActionResolution, { status: 'not-found' }>,
): SurfaceActionRefusal {
  const current = resolution.revision;
  if (current !== input.revision)
    return {
      reason: 'stale-revision',
      detail: `The surface is at revision ${current}, not ${input.revision}; re-read the surface and retry.`,
      currentRevision: current,
    };
  if (resolution.status === 'undeclared')
    return { reason: 'undeclared', detail: resolution.detail };
  if (resolution.action === 'dashboard.select')
    return { reason: 'undeclared', detail: SURFACE_ACTION_SELECT_DETAIL };
  return {
    reason: 'unsupported',
    detail: `${resolution.action} has no host behaviour here; nothing was done.`,
  };
}

function submitSurfaceState(revision?: number): SurfaceSubmitSurfaceState {
  return revision === undefined
    ? { kind: 'not-recorded' }
    : { kind: 'updated', revision };
}

/** A submit's outcome on the wire: the turn outcome and the surface's, apart. */
function toActionResult(outcome: SurfaceMutationOutcome): SurfaceActionResult {
  switch (outcome.status) {
    case 'applied':
      return {
        status: 'applied',
        operationId: outcome.operationId,
        surfaceState: submitSurfaceState(outcome.revision),
      };
    case 'indeterminate':
      return {
        status: 'indeterminate',
        operationId: outcome.operationId,
        detail: outcome.detail,
        surfaceState: submitSurfaceState(outcome.revision),
      };
    case 'rejected':
      // The ledger records an unsupported action as a terminal refusal; the
      // wire keeps Req 6.8's explicit `unsupported` result, first time and
      // on every replay.
      return outcome.reason === 'unsupported'
        ? {
            status: 'unsupported',
            operationId: outcome.operationId,
            detail: outcome.detail,
          }
        : rejectedResult(outcome);
    case 'pending':
      return { status: 'pending', operationId: outcome.operationId };
    default:
      return { status: 'not-found', operationId: outcome.operationId };
  }
}

/**
 * A `change` or `select` outcome. Both commit synchronously, so an applied
 * one always carries its revision, and neither can be pending or
 * indeterminate: the ledger fingerprints the operation kind, so reusing a
 * submit's id is `operation-conflict`, never that submit's outcome. The two
 * remaining branches are a host bug and fail loudly rather than report a
 * revision that was never committed.
 */
function toMutationResult(
  outcome: SurfaceMutationOutcome,
): SurfaceMutationResult {
  switch (outcome.status) {
    case 'applied':
      if (outcome.revision === undefined) break;
      return {
        status: 'applied',
        operationId: outcome.operationId,
        revision: outcome.revision,
      };
    case 'rejected':
      return rejectedResult(outcome);
    case 'pending':
      return { status: 'pending', operationId: outcome.operationId };
    case 'not-found':
      return { status: 'not-found', operationId: outcome.operationId };
    default:
      break;
  }
  throw new Error('surface state returned an inconsistent operation outcome');
}
