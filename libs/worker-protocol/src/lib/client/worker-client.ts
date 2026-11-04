/**
 * Isomorphic worker protocol client (plan C1, W1, W2).
 *
 * One `WorkerClient` drives one WebSocket connection at a time. The host
 * supplies the socket through a {@link WebSocketFactory}: Electron main wraps a
 * `ws` socket over the SSH transport, a browser wraps its own `WebSocket`. This
 * file imports neither, so it runs unchanged in both.
 *
 * Responsibilities:
 *
 * - **Request/response correlation.** Every `call` gets a client-generated
 *   id; the matching `res` frame settles exactly that call. Params are checked
 *   against the method table before sending, results after receiving.
 * - **In-flight cap.** At most {@link WORKER_LIMITS.maxInFlightRequests} calls
 *   wait at once. A call over the cap fails at once with
 *   `TOO_MANY_IN_FLIGHT`; nothing is queued.
 * - **Per-call timeout.** A call with no answer after
 *   {@link WORKER_LIMITS.callTimeoutMs} fails with `CALL_TIMEOUT`. The same
 *   limit bounds the time to open the socket.
 * - **Liveness.** When the socket can send transport pings, the client pings
 *   every {@link WORKER_LIMITS.pingIntervalMs} and drops the connection when no
 *   pong arrives within {@link WORKER_LIMITS.pongTimeoutMs}. One timer serves
 *   both phases.
 * - **Malformed inbound frames** (not text, over 1 MiB in UTF-8 bytes, not
 *   JSON, wrong shape) close the connection with 4400 `protocol-error`.
 * - **Transport failures.** A socket whose `send` or `ping` throws has lost
 *   the connection: every pending call fails and the close is reported once.
 *   A throwing `close` is ignored, since the client has already detached.
 * - **Callbacks.** `evt` and `ctl` frames go to {@link WorkerClientCallbacks};
 *   the end of an opened connection is reported once through `onClose`, with
 *   a fixed reason for its code (never the text a peer sent).
 *
 * Reconnection, backoff and re-attach belong to the host: after `onClose` it
 * may call {@link WorkerClient.connect} again on the same instance, which
 * opens a new socket from the factory.
 */

import {
  WORKER_CLOSE_CODES,
  WORKER_CLOSE_REASONS,
  WORKER_ERROR_MESSAGES,
  isWorkerCloseCode,
  sanitizeErrorDetail,
  type WorkerErrorCode,
} from '../errors';
import {
  FRAME_VERSION,
  WORKER_LIMITS,
  encodeFrame,
  parseWorkerFrame,
  type ControlFrame,
  type ErrorFrame,
  type EventFrame,
  type ResultFrame,
} from '../frames';
import {
  parseParams,
  parseResult,
  type WorkerMethod,
  type WorkerMethodParams,
  type WorkerMethodResult,
} from '../methods';

// ---------------------------------------------------------------------------
// Socket seam.
// ---------------------------------------------------------------------------

export interface WebSocketMessageEventLike {
  readonly data: unknown;
}

export interface WebSocketCloseEventLike {
  readonly code: number;
  readonly reason: string;
}

/**
 * The part of a WebSocket the client uses. The host adapts its socket to this
 * shape. `ping` and `onpong` are optional: a transport that cannot send pings
 * (the browser `WebSocket`) leaves them out and the client runs no liveness
 * timer for that connection.
 */
export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: WebSocketMessageEventLike) => void) | null;
  onclose: ((event: WebSocketCloseEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping?(): void;
  onpong?: (() => void) | null;
}

/** Opens a new socket for one connection attempt. */
export type WebSocketFactory = () => WebSocketLike;

// ---------------------------------------------------------------------------
// Errors and callbacks.
// ---------------------------------------------------------------------------

/** Failures the client produces itself, beside the worker's wire codes. */
export const WORKER_CLIENT_LOCAL_ERROR_CODES = [
  'NOT_CONNECTED',
  'CONNECTION_CLOSED',
  'CALL_TIMEOUT',
  'TOO_MANY_IN_FLIGHT',
] as const;

export type WorkerClientLocalErrorCode =
  (typeof WORKER_CLIENT_LOCAL_ERROR_CODES)[number];

export type WorkerClientErrorCode =
  WorkerErrorCode | WorkerClientLocalErrorCode;

const LOCAL_ERROR_MESSAGES: Readonly<
  Record<WorkerClientLocalErrorCode, string>
> = {
  NOT_CONNECTED: 'Not connected to the machine.',
  CONNECTION_CLOSED: 'The connection to the machine closed.',
  CALL_TIMEOUT: 'The machine did not answer in time.',
  TOO_MANY_IN_FLIGHT: 'Too many requests are waiting for the machine.',
};

/**
 * Error a `call` or `connect` rejects with. For a worker code the message is
 * this build's fixed copy for the code (W12), not the text the peer sent, and
 * `detail` is filtered through the same allow list the worker uses.
 */
export class WorkerClientError extends Error {
  readonly code: WorkerClientErrorCode;
  readonly ref?: string;
  readonly detail?: unknown;

  constructor(
    code: WorkerClientErrorCode,
    options: {
      readonly ref?: string;
      readonly detail?: unknown;
      readonly cause?: unknown;
    } = {},
  ) {
    super(
      isLocalCode(code)
        ? LOCAL_ERROR_MESSAGES[code]
        : WORKER_ERROR_MESSAGES[code],
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'WorkerClientError';
    this.code = code;
    if (options.ref !== undefined) {
      this.ref = options.ref;
    }
    if (options.detail !== undefined) {
      this.detail = options.detail;
    }
  }
}

function isLocalCode(
  code: WorkerClientErrorCode,
): code is WorkerClientLocalErrorCode {
  return (WORKER_CLIENT_LOCAL_ERROR_CODES as readonly string[]).includes(code);
}

/** How an opened connection ended. */
export interface WorkerClientClose {
  readonly code: number;
  /**
   * Fixed text for `code` ({@link peerCloseReason} for a peer close). A peer's
   * own close reason is never passed on.
   */
  readonly reason: string;
  /** `true` when this client ended it (local close, 4400, pong timeout, socket error). */
  readonly local: boolean;
}

export interface WorkerClientCallbacks {
  onEvent?(frame: EventFrame): void;
  onControl?(frame: ControlFrame): void;
  /** Called once per opened connection, after every pending call has failed. */
  onClose?(close: WorkerClientClose): void;
}

export interface WorkerClientOptions {
  readonly createSocket: WebSocketFactory;
  readonly callbacks?: WorkerClientCallbacks;
}

export type WorkerClientState = 'idle' | 'connecting' | 'open' | 'closed';

/** Close code reported when the client drops a connection that stopped answering pings. */
export const PONG_TIMEOUT_CLOSE: WorkerClientClose = Object.freeze({
  code: 1006,
  reason: 'pong-timeout',
  local: true,
});

const SOCKET_ERROR_CLOSE: WorkerClientClose = Object.freeze({
  code: 1006,
  reason: 'socket-error',
  local: true,
});

const PROTOCOL_ERROR_CLOSE: WorkerClientClose = Object.freeze({
  code: WORKER_CLOSE_CODES.PROTOCOL_ERROR,
  reason: WORKER_CLOSE_REASONS[WORKER_CLOSE_CODES.PROTOCOL_ERROR],
  local: true,
});

/** Reasons for the standard close codes a peer or transport reports (RFC 6455). */
const STANDARD_CLOSE_REASONS: Readonly<Record<number, string>> = {
  1000: 'normal-closure',
  1001: 'going-away',
  1006: 'abnormal-closure',
  1009: 'message-too-big',
  1011: 'internal-error',
};

/**
 * The reason reported for a close the peer or transport made: the worker's
 * fixed reason for a 44xx code, a fixed name for a standard code, otherwise
 * `connection-closed`. The peer's own reason text is untrusted and dropped.
 */
export function peerCloseReason(code: number): string {
  if (isWorkerCloseCode(code)) {
    return WORKER_CLOSE_REASONS[code];
  }
  return STANDARD_CLOSE_REASONS[code] ?? 'connection-closed';
}

/**
 * Ask the transport to close a socket the client already detached from. A
 * transport that throws here has nothing left for the client to clean up.
 */
function closeSocket(
  socket: WebSocketLike,
  close?: { readonly code: number; readonly reason: string },
): void {
  try {
    if (close === undefined) {
      socket.close();
    } else {
      socket.close(close.code, close.reason);
    }
  } catch {
    // The client detached and failed every pending call before this call;
    // a close that throws leaves no client state to repair or report.
  }
}

// ---------------------------------------------------------------------------
// Client.
// ---------------------------------------------------------------------------

type Timer = ReturnType<typeof setTimeout>;

interface PendingCall {
  readonly method: WorkerMethod;
  readonly timer: Timer;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: WorkerClientError) => void;
}

interface PendingOpen {
  readonly timer: Timer;
  readonly resolve: () => void;
  readonly reject: (error: WorkerClientError) => void;
}

export class WorkerClient {
  private readonly createSocket: WebSocketFactory;
  private readonly callbacks: WorkerClientCallbacks;

  private socket: WebSocketLike | null = null;
  private currentState: WorkerClientState = 'idle';
  private pendingOpen: PendingOpen | null = null;
  private readonly pending = new Map<string, PendingCall>();
  private nextId = 0;

  /** The single liveness timer: waits for the next ping, or for its pong. */
  private livenessTimer: Timer | null = null;
  private awaitingPong = false;

  constructor(options: WorkerClientOptions) {
    this.createSocket = options.createSocket;
    this.callbacks = options.callbacks ?? {};
  }

  get state(): WorkerClientState {
    return this.currentState;
  }

  /** Number of calls waiting for an answer. */
  get inFlight(): number {
    return this.pending.size;
  }

  /**
   * Open a new socket from the factory. Resolves when it opens; rejects with
   * `CONNECTION_CLOSED` if it closes or errors first, or `CALL_TIMEOUT` if it
   * does not open within the call timeout. Allowed from `idle` and `closed`.
   */
  connect(): Promise<void> {
    if (this.currentState === 'connecting' || this.currentState === 'open') {
      return Promise.reject(new WorkerClientError('CONNECTION_CLOSED'));
    }
    let socket: WebSocketLike;
    try {
      socket = this.createSocket();
    } catch (cause) {
      // The host factory failed before any socket existed (bad endpoint,
      // transport not ready). The caller sees a closed connection; the cause
      // stays attached for the host's own log.
      this.currentState = 'closed';
      return Promise.reject(
        new WorkerClientError('CONNECTION_CLOSED', { cause }),
      );
    }

    this.socket = socket;
    this.currentState = 'connecting';
    this.awaitingPong = false;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOpen = null;
        this.teardown(socket);
        reject(new WorkerClientError('CALL_TIMEOUT'));
        closeSocket(socket);
      }, WORKER_LIMITS.callTimeoutMs);
      this.pendingOpen = { timer, resolve, reject };

      socket.onopen = () => this.handleOpen(socket);
      socket.onmessage = (event) => this.handleMessage(socket, event.data);
      socket.onclose = (event) =>
        this.handleSocketGone(socket, {
          code: event.code,
          reason: peerCloseReason(event.code),
          local: false,
        });
      socket.onerror = () => this.dropConnection(socket, SOCKET_ERROR_CLOSE);
      if (socket.ping) {
        socket.onpong = () => this.handlePong(socket);
      }
    });
  }

  /**
   * Send one request and wait for its answer. Rejects with the worker's code
   * for an error frame, `INVALID_PARAMS` for params the method table refuses
   * (nothing is sent), `INTERNAL` for a result that does not match the table,
   * or one of the local codes.
   */
  call<M extends WorkerMethod>(
    method: M,
    params: WorkerMethodParams<M>,
  ): Promise<WorkerMethodResult<M>> {
    const socket = this.socket;
    if (this.currentState !== 'open' || socket === null) {
      return Promise.reject(new WorkerClientError('NOT_CONNECTED'));
    }
    if (this.pending.size >= WORKER_LIMITS.maxInFlightRequests) {
      return Promise.reject(new WorkerClientError('TOO_MANY_IN_FLIGHT'));
    }
    const checked = parseParams(method, params);
    if (!checked.ok) {
      return Promise.reject(new WorkerClientError('INVALID_PARAMS'));
    }

    this.nextId += 1;
    const id = String(this.nextId);
    return new Promise<WorkerMethodResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WorkerClientError('CALL_TIMEOUT'));
      }, WORKER_LIMITS.callTimeoutMs);
      this.pending.set(id, {
        method,
        timer,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      try {
        socket.send(
          encodeFrame({
            v: FRAME_VERSION,
            kind: 'req',
            id,
            method,
            params: checked.value,
          }),
        );
      } catch (cause) {
        // A socket that throws on send has lost the connection, and may
        // never emit a close event. This call fails with the cause attached;
        // the connection-loss path fails the rest and reports the close once.
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new WorkerClientError('CONNECTION_CLOSED', { cause }));
        this.dropConnection(socket, SOCKET_ERROR_CLOSE);
      }
    });
  }

  /** Close the connection. Pending calls fail with `CONNECTION_CLOSED`. */
  close(code = 1000, reason = 'client-close'): void {
    const socket = this.socket;
    if (socket === null) {
      return;
    }
    this.handleSocketGone(socket, { code, reason, local: true });
    closeSocket(socket, { code, reason });
  }

  // -------------------------------------------------------------------------
  // Socket events.
  // -------------------------------------------------------------------------

  private handleOpen(socket: WebSocketLike): void {
    if (socket !== this.socket || this.currentState !== 'connecting') {
      return;
    }
    this.currentState = 'open';
    const open = this.pendingOpen;
    this.pendingOpen = null;
    if (open) {
      clearTimeout(open.timer);
      open.resolve();
    }
    this.scheduleNextPing(socket);
  }

  private handleMessage(socket: WebSocketLike, data: unknown): void {
    if (socket !== this.socket || this.currentState !== 'open') {
      return;
    }
    if (typeof data !== 'string') {
      this.protocolError(socket);
      return;
    }
    const parsed = parseWorkerFrame(data, WORKER_LIMITS.maxPayloadBytes);
    if (!parsed.ok) {
      this.protocolError(socket);
      return;
    }
    const frame = parsed.frame;
    switch (frame.kind) {
      case 'res':
        this.settle(frame);
        return;
      case 'evt':
        this.callbacks.onEvent?.(frame);
        return;
      case 'ctl':
        this.callbacks.onControl?.(frame);
        return;
    }
  }

  private settle(frame: ResultFrame | ErrorFrame): void {
    const call = this.pending.get(frame.id);
    if (call === undefined) {
      // No waiting call with this id: the call already timed out and the
      // answer arrived late. Its caller has its CALL_TIMEOUT already.
      return;
    }
    this.pending.delete(frame.id);
    clearTimeout(call.timer);
    if (frame.ok) {
      const result = parseResult(call.method, frame.result);
      if (result.ok) {
        call.resolve(result.value);
      } else {
        call.reject(new WorkerClientError('INTERNAL'));
      }
      return;
    }
    const { code, ref, detail } = frame.error;
    call.reject(
      new WorkerClientError(code, {
        ref: code === 'PAIRING_REJECTED' ? undefined : ref,
        detail: sanitizeErrorDetail(code, detail),
      }),
    );
  }

  private protocolError(socket: WebSocketLike): void {
    this.handleSocketGone(socket, PROTOCOL_ERROR_CLOSE);
    closeSocket(socket, PROTOCOL_ERROR_CLOSE);
  }

  /** The client ends the connection itself: fail everything, then close the socket. */
  private dropConnection(
    socket: WebSocketLike,
    close: WorkerClientClose,
  ): void {
    this.handleSocketGone(socket, close);
    closeSocket(socket);
  }

  /** The connection ended (any cause). Idempotent per socket. */
  private handleSocketGone(
    socket: WebSocketLike,
    close: WorkerClientClose,
  ): void {
    if (socket !== this.socket) {
      return;
    }
    const wasOpen = this.currentState === 'open';
    const open = this.pendingOpen;
    this.pendingOpen = null;
    this.teardown(socket);
    if (open) {
      clearTimeout(open.timer);
      open.reject(new WorkerClientError('CONNECTION_CLOSED'));
    }
    if (wasOpen) {
      this.callbacks.onClose?.(close);
    }
  }

  /** Detach from the socket, stop the liveness timer and fail every pending call. */
  private teardown(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    if (socket.ping) {
      socket.onpong = null;
    }
    this.socket = null;
    this.currentState = 'closed';
    this.stopLiveness();
    const calls = [...this.pending.values()];
    this.pending.clear();
    for (const call of calls) {
      clearTimeout(call.timer);
      call.reject(new WorkerClientError('CONNECTION_CLOSED'));
    }
  }

  // -------------------------------------------------------------------------
  // Liveness (W1): ping every 20 s, pong within 10 s, one timer.
  // -------------------------------------------------------------------------

  private scheduleNextPing(socket: WebSocketLike): void {
    if (!socket.ping) {
      return;
    }
    this.stopLiveness();
    this.livenessTimer = setTimeout(
      () => this.sendPing(socket),
      WORKER_LIMITS.pingIntervalMs,
    );
  }

  private sendPing(socket: WebSocketLike): void {
    this.livenessTimer = null;
    if (socket !== this.socket || this.currentState !== 'open') {
      return;
    }
    this.awaitingPong = true;
    this.livenessTimer = setTimeout(() => {
      this.livenessTimer = null;
      this.dropConnection(socket, PONG_TIMEOUT_CLOSE);
    }, WORKER_LIMITS.pongTimeoutMs);
    try {
      socket.ping?.();
    } catch {
      // A transport that cannot send a ping has lost the connection. This
      // runs in a timer callback, so nothing may escape it.
      this.dropConnection(socket, SOCKET_ERROR_CLOSE);
    }
  }

  private handlePong(socket: WebSocketLike): void {
    if (socket !== this.socket || !this.awaitingPong) {
      return;
    }
    this.awaitingPong = false;
    this.scheduleNextPing(socket);
  }

  private stopLiveness(): void {
    if (this.livenessTimer !== null) {
      clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
  }
}
