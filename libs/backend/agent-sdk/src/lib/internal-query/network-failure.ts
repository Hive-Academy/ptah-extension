/**
 * Which failures of a one-shot SDK query are NETWORK-class — TASK_2026_437
 * C14 (f).
 *
 * ## Why the answer lives beside the internal query
 *
 * On 2026-09-14 (`Ptah Electron-2026-09-14.log:1037-1180`) DNS for the Codex
 * upstream failed. The translation proxy answered every forward with HTTP 500,
 * the `claude` subprocess retried each request on its own ladder (0.5 s
 * doubling to ~30 s), and 41 forwards failed in six minutes. None of that
 * surfaced as a throw: the subprocess ends a request it has given up on with a
 * synthetic assistant message (`SDKAssistantMessage.error`) and an `is_error`
 * result. A caller that reads only the text treats that message as the model's
 * answer — the curator's first window counted as "completed" and the next
 * window was dispatched straight into the same dead endpoint.
 *
 * The stream carries the evidence, typed by the SDK itself:
 * `system/api_retry` (`error_status: null` for a connection error with no HTTP
 * response), `assistant.error`, and `result.is_error` / `api_error_status`.
 * This module reads those, and walks a thrown error's `cause` chain for Node
 * socket codes, so the memory curator's adapter and skill-synthesis's lane
 * runner answer "was that the network?" identically.
 *
 * ## The classifier, exactly
 *
 * NETWORK-class: connection refused / reset / aborted / unreachable, DNS
 * (`ENOTFOUND`, `EAI_AGAIN`), socket and connect timeouts, HTTP 408, 429 and
 * every 5xx — from the provider or from a local proxy in front of it.
 *
 * NOT network-class: authentication and authorization (401, 403,
 * `authentication_failed`, `oauth_org_not_allowed`, `billing_error`), request
 * validation (400, 404, 413, 422, `invalid_request`, `model_not_found`,
 * `max_output_tokens`), a reply that does not parse, and an abort. Those are
 * not fixed by waiting, so backing off on them would only delay the report.
 */

/**
 * The kind of network fault. Diagnostic only — every member is backed off the
 * same way; the value rides the back-off log line.
 */
export type NetworkFailureSignal =
  | 'connection'
  | 'dns'
  | 'timeout'
  | 'http-5xx'
  | 'http-429';

const NODE_ERROR_CODE_SIGNALS: ReadonlyMap<string, NetworkFailureSignal> =
  new Map<string, NetworkFailureSignal>([
    ['ECONNREFUSED', 'connection'],
    ['ECONNRESET', 'connection'],
    ['ECONNABORTED', 'connection'],
    ['EPIPE', 'connection'],
    ['ENETUNREACH', 'connection'],
    ['ENETDOWN', 'connection'],
    ['EHOSTUNREACH', 'connection'],
    ['EHOSTDOWN', 'connection'],
    ['UND_ERR_SOCKET', 'connection'],
    ['ENOTFOUND', 'dns'],
    ['EAI_AGAIN', 'dns'],
    ['ETIMEDOUT', 'timeout'],
    ['ESOCKETTIMEDOUT', 'timeout'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['UND_ERR_HEADERS_TIMEOUT', 'timeout'],
    ['UND_ERR_BODY_TIMEOUT', 'timeout'],
  ]);

/**
 * `SDKAssistantMessageError` members that are network-class. `'unknown'` is
 * deliberately absent: it is network-class only when the same stream already
 * showed a network retry (see {@link QueryNetworkObserver}).
 */
const API_ERROR_SIGNALS: ReadonlyMap<string, NetworkFailureSignal> = new Map<
  string,
  NetworkFailureSignal
>([
  ['server_error', 'http-5xx'],
  ['rate_limit', 'http-429'],
]);

/** How far down a `cause` chain a socket code is looked for. */
const MAX_CAUSE_DEPTH = 8;

/** The network signal an HTTP status carries, or `null` when it carries none. */
export function networkSignalForHttpStatus(
  status: unknown,
): NetworkFailureSignal | null {
  if (typeof status !== 'number' || !Number.isInteger(status)) return null;
  if (status === 429) return 'http-429';
  if (status === 408) return 'timeout';
  if (status >= 500 && status <= 599) return 'http-5xx';
  return null;
}

/**
 * Whether `error`, or anything it wraps, is a network-class failure.
 *
 * Reads the Node `code` and an HTTP `status` / `statusCode` at every level.
 * The walk is depth-bounded because an error chain is caller-supplied data and
 * a cycle in it must not hang the caller.
 */
export function classifyThrownNetworkFailure(
  error: unknown,
): NetworkFailureSignal | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return null;
    const fields = current as {
      readonly code?: unknown;
      readonly status?: unknown;
      readonly statusCode?: unknown;
      readonly cause?: unknown;
    };
    if (typeof fields.code === 'string') {
      const fromCode = NODE_ERROR_CODE_SIGNALS.get(fields.code);
      if (fromCode) return fromCode;
    }
    const fromStatus =
      networkSignalForHttpStatus(fields.status) ??
      networkSignalForHttpStatus(fields.statusCode);
    if (fromStatus) return fromStatus;
    current = fields.cause;
  }
  return null;
}

/**
 * The fields of an SDK stream message the observer reads. Every `SDKMessage`
 * is assignable to it, and so is skill-synthesis's local stream mirror.
 */
export interface NetworkObservableMessage {
  readonly type: string;
  readonly subtype?: string;
  /** `assistant` and `system/api_retry`: an `SDKAssistantMessageError`. */
  readonly error?: unknown;
  /** `system/api_retry`: `null` for a connection error with no HTTP response. */
  readonly error_status?: number | null;
  /** `result`. */
  readonly is_error?: boolean;
  /** `result` (success subtype). */
  readonly api_error_status?: number | null;
}

/**
 * What one query's stream said about the network.
 *
 * `answered` means a result arrived that is not an API error — the endpoint
 * was reachable, which is what resets a back-off. `undetermined` covers the
 * rest: a non-network API error, or a stream that ended with no evidence
 * either way. It neither raises nor resets a back-off.
 */
export type QueryNetworkVerdict =
  | { readonly kind: 'network-failure'; readonly signal: NetworkFailureSignal }
  | { readonly kind: 'answered' }
  | { readonly kind: 'undetermined' };

/**
 * Watches ONE query's stream. Feed it every message in order, then read
 * {@link verdict}.
 */
export class QueryNetworkObserver {
  private retrySignal: NetworkFailureSignal | null = null;
  /** Raw `error` of the most recent assistant message, `undefined` if it had none. */
  private assistantError: unknown = undefined;
  private resultSeen = false;
  private resultIsError = false;
  private resultStatus: number | null = null;

  observe(msg: NetworkObservableMessage): void {
    if (msg.type === 'system' && msg.subtype === 'api_retry') {
      const signal =
        msg.error_status === null
          ? 'connection'
          : (networkSignalForHttpStatus(msg.error_status) ??
            apiErrorSignal(msg.error));
      if (signal) this.retrySignal = signal;
      return;
    }
    if (msg.type === 'assistant') {
      // The LAST assistant message decides: a retry that finally succeeded
      // ends on a normal message, which clears an earlier error message.
      this.assistantError = msg.error;
      return;
    }
    if (msg.type === 'result') {
      this.resultSeen = true;
      this.resultIsError = msg.is_error === true;
      this.resultStatus =
        typeof msg.api_error_status === 'number' ? msg.api_error_status : null;
    }
  }

  verdict(): QueryNetworkVerdict {
    const signal = this.networkSignal();
    if (signal) return { kind: 'network-failure', signal };
    if (
      this.resultSeen &&
      !this.resultIsError &&
      this.assistantError === undefined
    ) {
      return { kind: 'answered' };
    }
    return { kind: 'undetermined' };
  }

  private networkSignal(): NetworkFailureSignal | null {
    // An HTTP status on the result is the most specific evidence there is, and
    // a non-network status (401, 400) OVERRULES earlier retries: the request
    // ended on an error waiting cannot fix.
    if (this.resultIsError && this.resultStatus !== null) {
      return networkSignalForHttpStatus(this.resultStatus);
    }
    if (this.assistantError !== undefined) {
      const fromCode = apiErrorSignal(this.assistantError);
      if (fromCode) return fromCode;
      // `'unknown'` (or an unlisted code) is network-class only with network
      // retries behind it; a named non-network code never is.
      return this.assistantError === 'unknown' ? this.retrySignal : null;
    }
    if (this.resultIsError) return this.retrySignal;
    // The stream ended mid-retry, before any result.
    if (!this.resultSeen) return this.retrySignal;
    return null;
  }
}

function apiErrorSignal(code: unknown): NetworkFailureSignal | null {
  return typeof code === 'string'
    ? (API_ERROR_SIGNALS.get(code) ?? null)
    : null;
}
