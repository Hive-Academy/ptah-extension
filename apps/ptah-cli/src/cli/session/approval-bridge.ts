/**
 * `ApprovalBridge` — backend permission/question requests ↔ JSON-RPC stdio.
 *
 * TASK_2026_104 Sub-batch B10b. Closes the round-trip gap for
 * `permission:request` and `ask-user-question:request`: backend `SdkPermissionHandler`
 * emits these as push-adapter events; this bridge re-emits them as JSON-RPC
 * notifications on stdout, registers `permission.response / question.response`
 * inbound handlers on the JSON-RPC server, and calls back into
 * `permissionHandler.handleResponse / handleQuestionResponse` to unblock the
 * SDK side.
 *
 * Key behaviors
 * -------------
 *   - PTAH_AUTO_APPROVE — when `process.env['PTAH_AUTO_APPROVE'] === 'true'`
 *     the bridge short-circuits BEFORE touching JSON-RPC: it calls
 *     `permissionHandler.handleResponse(id, { id, decision: 'allow', reason:
 *     'PTAH_AUTO_APPROVE=true' })` and returns. No notification emitted; no
 *     timer started. The flag is read PER REQUEST so the user can flip it
 *     between turns.
 *   - 300_000 ms timeout — every emitted permission/question request starts
 *     a per-id timer. On expiry the bridge:
 *       1. Emits `task.error { ptah_code: 'auth_required', request_id, message }`
 *          as a JSON-RPC notification on stdout.
 *       2. Calls `permissionHandler.handleResponse(id, { id, decision: 'deny',
 *          reason: 'timeout' })` so the SDK side unblocks.
 *       3. Calls `process.exit(ExitCode.AuthRequired = 3)`.
 *     This is the spec § "Blocker 6" exit-3 contract.
 *   - Concurrent requests are tracked by id in two maps (permission, question).
 *     A response unblocks ONLY the matching id; siblings continue to wait.
 *   - `attach()` is idempotent — calling it twice does nothing on the second
 *     call. `detach()` removes both push-adapter listeners, unregisters both
 *     JSON-RPC handlers, and clears every pending timer.
 *
 * No DI imports — wired manually by the upcoming `interact.ts` (B10e). Tests
 * pass a vanilla `EventEmitter`, a fake `JsonRpcServer`, and a fake
 * `ISdkPermissionHandler` whose `handleResponse / handleQuestionResponse` are
 * `jest.fn()`s.
 */

import type { EventEmitter } from 'node:events';

import type {
  AskUserQuestionResponse,
  ISdkPermissionHandler,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';

import {
  ExitCode,
  type PtahErrorCode,
  type PtahNotification,
} from '../jsonrpc/types.js';

/** Subset of `JsonRpcServer` the bridge depends on (kept narrow for tests). */
export interface ApprovalBridgeJsonRpc {
  notify<TParams = unknown>(method: string, params?: TParams): Promise<void>;
  register(
    method: string,
    handler: (params: unknown) => Promise<unknown> | unknown,
  ): void;
  unregister(method: string): void;
}

/** Question request payload emitted on the push adapter (subset). */
interface QuestionRequestPayload {
  readonly id: string;
  readonly toolName?: string;
  readonly questions: ReadonlyArray<unknown>;
  readonly toolUseId?: string;
  readonly sessionId?: string;
  readonly tabId?: string;
}

/** Per-request bookkeeping: the timeout handle to clear on response/detach. */
interface PendingApproval {
  readonly timeoutHandle: ReturnType<typeof setTimeout>;
  readonly kind: 'permission' | 'question';
  readonly sessionId?: string;
}

const DEFAULT_TIMEOUT_MS = 300_000;

const PERMISSION_REQUEST_EVENT = 'permission:request';
const QUESTION_REQUEST_EVENT = 'ask-user-question:request';

const PERMISSION_REQUEST_NOTIFICATION: PtahNotification = 'permission.request';
const QUESTION_ASK_NOTIFICATION: PtahNotification = 'question.ask';
const TASK_ERROR_NOTIFICATION: PtahNotification = 'task.error';

const PERMISSION_RESPONSE_METHOD = 'permission.response';
const QUESTION_RESPONSE_METHOD = 'question.response';

const AUTH_REQUIRED_CODE: PtahErrorCode = 'auth_required';

/**
 * Bridges backend approval push events ↔ JSON-RPC stdio. See module-level
 * comment for the full behavior contract.
 */
export class ApprovalBridge {
  private attached = false;
  private readonly pending = new Map<string, PendingApproval>();
  private readonly timeoutMs: number;
  private readonly exitFn: (code: number) => never;

  // Bound handler references — kept on the instance so `detach()` can
  // `.off()` exactly the same function reference that `attach()` registered.
  private readonly onPermissionRequest = (payload: unknown): void => {
    void this.handlePermissionRequest(payload);
  };
  private readonly onQuestionRequest = (payload: unknown): void => {
    void this.handleQuestionRequest(payload);
  };
  private readonly onPermissionResponse = (params: unknown): unknown => {
    return this.handlePermissionResponse(params);
  };
  private readonly onQuestionResponse = (params: unknown): unknown => {
    return this.handleQuestionResponseRpc(params);
  };

  constructor(
    private readonly pushAdapter: EventEmitter,
    private readonly jsonrpc: ApprovalBridgeJsonRpc,
    private readonly permissionHandler: ISdkPermissionHandler,
    options?: {
      /** Override the 300s timeout (used in tests). */
      readonly timeoutMs?: number;
      /** Override `process.exit` (used in tests). */
      readonly exit?: (code: number) => never;
    },
  ) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.exitFn =
      options?.exit ?? ((code: number): never => process.exit(code));
  }

  /**
   * Subscribe to push-adapter events and register inbound JSON-RPC handlers.
   * Idempotent — second call is a no-op.
   */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.pushAdapter.on(PERMISSION_REQUEST_EVENT, this.onPermissionRequest);
    this.pushAdapter.on(QUESTION_REQUEST_EVENT, this.onQuestionRequest);
    this.jsonrpc.register(
      PERMISSION_RESPONSE_METHOD,
      this.onPermissionResponse,
    );
    this.jsonrpc.register(QUESTION_RESPONSE_METHOD, this.onQuestionResponse);
  }

  /**
   * Tear down all subscriptions, unregister handlers, clear every pending
   * timer. Safe to call multiple times.
   */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.pushAdapter.off(PERMISSION_REQUEST_EVENT, this.onPermissionRequest);
    this.pushAdapter.off(QUESTION_REQUEST_EVENT, this.onQuestionRequest);
    this.jsonrpc.unregister(PERMISSION_RESPONSE_METHOD);
    this.jsonrpc.unregister(QUESTION_RESPONSE_METHOD);
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutHandle);
    }
    this.pending.clear();
  }

  // ------------------------------------------------------------------
  // Permission round-trip
  // ------------------------------------------------------------------

  private async handlePermissionRequest(payload: unknown): Promise<void> {
    if (!isPermissionRequest(payload)) {
      return;
    }

    // PTAH_AUTO_APPROVE short-circuits BEFORE any JSON-RPC traffic. Read per
    // request so the user can flip the flag between turns.
    if (process.env['PTAH_AUTO_APPROVE'] === 'true') {
      const autoResponse: PermissionResponse = {
        id: payload.id,
        decision: 'allow',
        reason: 'PTAH_AUTO_APPROVE=true',
      };
      this.permissionHandler.handleResponse(payload.id, autoResponse);
      return;
    }

    const timeoutHandle = setTimeout(() => {
      this.onPermissionTimeout(payload.id, payload.sessionId);
    }, this.timeoutMs);
    this.pending.set(payload.id, {
      timeoutHandle,
      kind: 'permission',
      sessionId: payload.sessionId,
    });

    await this.jsonrpc.notify(PERMISSION_REQUEST_NOTIFICATION, {
      id: payload.id,
      session_id: payload.sessionId,
      tool_use_id: payload.toolUseId,
      tool_name: payload.toolName,
      tool_input: payload.toolInput,
      reason: payload.description,
    });
  }

  private handlePermissionResponse(params: unknown): void {
    if (!isPermissionResponseRpcParams(params)) return;
    const pending = this.pending.get(params.id);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      this.pending.delete(params.id);
    }
    this.permissionHandler.handleResponse(params.id, params);
  }

  private onPermissionTimeout(id: string, sessionId?: string): void {
    this.pending.delete(id);
    void this.jsonrpc.notify(TASK_ERROR_NOTIFICATION, {
      ptah_code: AUTH_REQUIRED_CODE,
      message: 'permission request timed out',
      request_id: id,
      session_id: sessionId,
    });
    const denyResponse: PermissionResponse = {
      id,
      decision: 'deny',
      reason: 'timeout',
    };
    this.permissionHandler.handleResponse(id, denyResponse);
    this.exitFn(ExitCode.AuthRequired);
  }

  // ------------------------------------------------------------------
  // Question round-trip (mirror of permission)
  // ------------------------------------------------------------------

  private async handleQuestionRequest(payload: unknown): Promise<void> {
    if (!isQuestionRequest(payload)) {
      return;
    }

    if (process.env['PTAH_AUTO_APPROVE'] === 'true') {
      // No defensible auto-answer for arbitrary user questions — the only
      // safe move is empty-answers, which the SDK side treats as user-cancel.
      // We MUST still call `handleQuestionResponse` to unblock the SDK.
      this.permissionHandler.handleQuestionResponse({
        id: payload.id,
        answers: {},
      });
      return;
    }

    const timeoutHandle = setTimeout(() => {
      this.onQuestionTimeout(payload.id, payload.sessionId);
    }, this.timeoutMs);
    this.pending.set(payload.id, {
      timeoutHandle,
      kind: 'question',
      sessionId: payload.sessionId,
    });

    await this.jsonrpc.notify(QUESTION_ASK_NOTIFICATION, {
      id: payload.id,
      session_id: payload.sessionId,
      tab_id: payload.tabId,
      tool_use_id: payload.toolUseId,
      questions: payload.questions,
    });
  }

  private handleQuestionResponseRpc(params: unknown): void {
    if (!isQuestionResponseRpcParams(params)) return;
    const pending = this.pending.get(params.id);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      this.pending.delete(params.id);
    }
    this.permissionHandler.handleQuestionResponse(params);
  }

  private onQuestionTimeout(id: string, sessionId?: string): void {
    this.pending.delete(id);
    void this.jsonrpc.notify(TASK_ERROR_NOTIFICATION, {
      ptah_code: AUTH_REQUIRED_CODE,
      message: 'question request timed out',
      request_id: id,
      session_id: sessionId,
    });
    const cancelResponse: AskUserQuestionResponse = {
      id,
      answers: {},
    };
    this.permissionHandler.handleQuestionResponse(cancelResponse);
    this.exitFn(ExitCode.AuthRequired);
  }
}

// ---------------------------------------------------------------------------
// Payload guards — narrow `unknown` push-adapter / JSON-RPC params onto typed
// views. Reject malformed shapes silently (consistent with B9c discipline).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPermissionRequest(value: unknown): value is PermissionRequest {
  if (!isPlainObject(value)) return false;
  return (
    typeof value['id'] === 'string' &&
    typeof value['toolName'] === 'string' &&
    isPlainObject(value['toolInput'])
  );
}

function isQuestionRequest(value: unknown): value is QuestionRequestPayload {
  if (!isPlainObject(value)) return false;
  return typeof value['id'] === 'string' && Array.isArray(value['questions']);
}

function isPermissionResponseRpcParams(
  value: unknown,
): value is PermissionResponse {
  if (!isPlainObject(value)) return false;
  if (typeof value['id'] !== 'string') return false;
  const decision = value['decision'];
  return (
    decision === 'allow' ||
    decision === 'deny' ||
    decision === 'always_allow' ||
    decision === 'deny_with_message'
  );
}

function isQuestionResponseRpcParams(
  value: unknown,
): value is AskUserQuestionResponse {
  if (!isPlainObject(value)) return false;
  return typeof value['id'] === 'string' && isPlainObject(value['answers']);
}
