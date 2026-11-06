import { randomBytes, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  WORKER_LIMITS,
  WORKER_CLOSE_CODES,
  parseClientFrame,
  parseMethodParams,
  workerError,
  type ControlFrame,
  type EventFrame,
  type WorkerGrant,
  type WorkerIdentity,
  type WorkerErrorCode,
} from '@ptah-extension/worker-protocol';
import { PairingWindow } from './pairing-window';
import { TokenStore } from './token-store';
import { verifyAdminProof } from './admin-key';

/** The calling connection, as an authenticated method handler sees it. */
export interface WorkerPeer {
  readonly id: string;
  /** The authenticated client token; null on the admin channel. */
  readonly tokenId: string | null;
  /** Pushes an event or control frame; a closed connection drops it. */
  send(frame: EventFrame | ControlFrame): void;
  /** Runs after this request's successful response frame has been sent. */
  afterReply(task: () => void): void;
  /** Runs once when the connection closes. */
  onClose(listener: () => void): void;
  close(code?: number): void;
}

export interface ConnectionOptions {
  identity: WorkerIdentity;
  pairing: PairingWindow;
  tokens: TokenStore;
  adminKey?: Uint8Array;
  handle: (
    method: string,
    params: unknown,
    grant: WorkerGrant | null,
    admin: boolean,
    peer: WorkerPeer,
  ) => Promise<unknown>;
  onError?: (error: unknown) => void;
}

const CONCURRENT_METHODS: ReadonlySet<string> = new Set([
  'session.stop',
  'permission.respond',
]);
/** Their params are small; a larger frame is never one of them. */
const CONCURRENT_MAX_BYTES = 8 * 1024;

function concurrent(text: string): boolean {
  if (text.length > CONCURRENT_MAX_BYTES) return false;
  const parsed = parseClientFrame(text, CONCURRENT_MAX_BYTES);
  return parsed.ok && CONCURRENT_METHODS.has(parsed.frame.method);
}

export class WorkerConnection {
  private state: 'new' | 'hello' | 'client' | 'admin' = 'new';
  private failures = 0;
  private nextPairAt = 0;
  private readonly id = randomUUID();
  /** Fresh per connection; an admin answers it with an HMAC of the admin key. */
  private readonly adminChallenge = randomBytes(32).toString('base64url');
  private readonly authTimer: ReturnType<typeof setTimeout>;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private pongDue: ReturnType<typeof setTimeout> | undefined;
  private inFlight = 0;
  private pairDelay: ReturnType<typeof setTimeout> | undefined;
  private pairDelayDone: (() => void) | undefined;
  private receiving: Promise<void> = Promise.resolve();
  private grant: WorkerGrant | null = null;
  private tokenId: string | null = null;
  private closed = false;
  private readonly closeListeners: (() => void)[] = [];

  constructor(
    private readonly socket: WebSocket,
    private readonly options: ConnectionOptions,
  ) {
    this.authTimer = setTimeout(
      () => this.close(WORKER_CLOSE_CODES.NOT_AUTHENTICATED),
      WORKER_LIMITS.authTimeoutMs,
    );
    this.pingTimer = setInterval(() => {
      if (this.pongDue || this.closed) return;
      socket.ping();
      this.pongDue = setTimeout(
        () => this.close(WORKER_CLOSE_CODES.NOT_AUTHENTICATED),
        WORKER_LIMITS.pongTimeoutMs,
      );
    }, WORKER_LIMITS.pingIntervalMs);
    socket.on('pong', () => {
      if (this.pongDue) clearTimeout(this.pongDue);
      this.pongDue = undefined;
    });
    socket.on('message', (data, binary) => {
      if (binary) {
        this.close(WORKER_CLOSE_CODES.PROTOCOL_ERROR);
        return;
      }
      const text = data.toString();
      // The count covers queued and running requests, so the receive queue
      // is bounded: past the cap a frame is refused, never buffered.
      if (this.inFlight >= WORKER_LIMITS.maxInFlightRequests) {
        this.refuseBusy(text);
        return;
      }
      this.inFlight++;
      const run = async (): Promise<void> => {
        try {
          await this.receive(text);
        } finally {
          this.inFlight--;
        }
      };
      // Stop and permission answers must not wait behind a long call on the
      // same connection (a `session.start` can wait 30 s for its session ID).
      // They address an existing turn, so arrival order against other calls
      // carries no meaning; every other call keeps its order.
      if (this.state === 'client' && concurrent(text)) {
        void run();
        return;
      }
      this.receiving = this.receiving.then(run);
    });
    socket.on('close', () => this.dispose());
    socket.on('error', (error) => options.onError?.(error));
  }

  /** This connection's ID, as its peers report it. */
  get connectionId(): string {
    return this.id;
  }

  /** The authenticated client token; null before auth and on the admin channel. */
  get authenticatedTokenId(): string | null {
    return this.tokenId;
  }

  /** Replaces the grant of an authenticated client after an operator change. */
  refreshGrant(grant: WorkerGrant): void {
    if (this.state === 'client') this.grant = grant;
  }

  sendControl(type: 'goodbye', payload: unknown): void {
    this.send({ v: 1, kind: 'ctl', type, payload });
  }

  close(code = 1000): void {
    if (this.closed) return;
    this.dispose();
    this.socket.close(code);
  }

  private dispose(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.authTimer);
    clearInterval(this.pingTimer);
    if (this.pongDue) clearTimeout(this.pongDue);
    if (this.pairDelay) clearTimeout(this.pairDelay);
    this.pairDelayDone?.();
    for (const listener of this.closeListeners.splice(0)) {
      try {
        listener();
      } catch (error) {
        this.options.onError?.(error);
      }
    }
  }

  /** The peer of one request; its reply tasks belong to that request only. */
  private peerFor(replyTasks: (() => void)[]): WorkerPeer {
    return {
      id: this.id,
      tokenId: this.tokenId,
      send: (frame) => this.send(frame),
      afterReply: (task) => {
        replyTasks.push(task);
      },
      onClose: (listener) => {
        if (this.closed) listener();
        else this.closeListeners.push(listener);
      },
      close: (code) => this.close(code),
    };
  }

  private send(frame: unknown): void {
    if (!this.closed && this.socket.readyState === this.socket.OPEN)
      this.socket.send(JSON.stringify(frame));
  }

  private respond(id: string, result: unknown): void {
    this.send({ v: 1, kind: 'res', id, ok: true, result });
  }

  private reject(id: string, code: WorkerErrorCode, detail?: unknown): void {
    this.send({
      v: 1,
      kind: 'res',
      id,
      ok: false,
      error: workerError(code, { detail }),
    });
  }

  /**
   * Answers a frame past the in-flight cap. An authenticated caller gets
   * WORKER_BUSY for its request; before auth, or for a frame that does not
   * parse, the connection closes.
   */
  private refuseBusy(text: string): void {
    if (this.state !== 'client' && this.state !== 'admin') {
      this.close(WORKER_CLOSE_CODES.THROTTLED);
      return;
    }
    const parsed = parseClientFrame(text, WORKER_LIMITS.maxPayloadBytes);
    if (!parsed.ok) {
      this.close(WORKER_CLOSE_CODES.PROTOCOL_ERROR);
      return;
    }
    this.reject(parsed.frame.id, 'WORKER_BUSY');
  }

  private async receive(text: string): Promise<void> {
    const parsed = parseClientFrame(
      text,
      this.state === 'client' || this.state === 'admin'
        ? WORKER_LIMITS.maxPayloadBytes
        : WORKER_LIMITS.maxPayloadPreAuthBytes,
    );
    if (!parsed.ok) {
      this.close(WORKER_CLOSE_CODES.PROTOCOL_ERROR);
      return;
    }
    const { id, method, params } = parsed.frame;
    if (this.state === 'new' && method !== 'hello') {
      this.close(WORKER_CLOSE_CODES.METHOD_NOT_ALLOWED);
      return;
    }
    if (
      this.state !== 'client' &&
      this.state !== 'admin' &&
      method !== 'hello' &&
      method !== 'pair.exchange' &&
      method !== 'auth'
    ) {
      this.close(WORKER_CLOSE_CODES.METHOD_NOT_ALLOWED);
      return;
    }
    const validated = parseMethodParams(method, params);
    if (!validated.ok) {
      this.reject(id, 'INVALID_PARAMS');
      return;
    }
    try {
      if (method === 'hello') {
        if (this.state !== 'new') {
          this.close(WORKER_CLOSE_CODES.PROTOCOL_ERROR);
          return;
        }
        const hello = params as {
          protocol: { min: number; max: number };
          client: { name: string; version: string };
        };
        if (
          hello.protocol.min > PROTOCOL_VERSION ||
          hello.protocol.max < PROTOCOL_VERSION
        ) {
          this.reject(id, 'VERSION_MISMATCH', {
            worker: {
              min: PROTOCOL_VERSION,
              max: PROTOCOL_VERSION,
              ptahVersion: this.options.identity.ptahVersion,
            },
            client: {
              protocol: hello.protocol,
              name: hello.client.name,
              version: hello.client.version,
            },
          });
          this.close(WORKER_CLOSE_CODES.VERSION_MISMATCH);
          return;
        }
        this.state = 'hello';
        this.respond(id, {
          protocol: PROTOCOL_VERSION,
          worker: this.options.identity,
          adminChallenge: this.adminChallenge,
        });
      } else if (method === 'pair.exchange') {
        if (this.state !== 'hello') {
          this.close(WORKER_CLOSE_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const wait = Math.max(0, this.nextPairAt - Date.now());
        if (wait)
          await new Promise<void>((resolve) => setTimeout(resolve, wait));
        if (this.closed) return;
        const input = params as { code: string; clientName: string };
        const result = await this.options.pairing.exchange(input.code, this.id);
        if (!result.ok) {
          this.failures++;
          this.reject(id, 'PAIRING_REJECTED');
          this.nextPairAt = Date.now() + 1000 * 2 ** (this.failures - 1);
          if (this.failures >= 3) this.close(WORKER_CLOSE_CODES.THROTTLED);
        } else {
          const token = await this.options.tokens.issue(
            input.clientName,
            result.grant,
          );
          this.respond(id, { ...token, grant: result.grant });
        }
      } else if (method === 'auth') {
        if (this.state !== 'hello') {
          this.close(WORKER_CLOSE_CODES.METHOD_NOT_ALLOWED);
          return;
        }
        const input = params as { token?: string; adminProof?: string };
        if (input.adminProof !== undefined) {
          // The admin key never crosses the wire: the caller proves it holds
          // the key with an HMAC over this connection's challenge.
          if (
            !this.options.adminKey ||
            !verifyAdminProof(
              this.options.adminKey,
              this.adminChallenge,
              input.adminProof,
            )
          ) {
            this.close(WORKER_CLOSE_CODES.NOT_AUTHENTICATED);
            return;
          }
          this.state = 'admin';
          this.respond(id, { role: 'admin' });
        } else {
          const secret = input.token ?? '';
          const token = this.options.tokens.authenticate(secret);
          if (!token) {
            this.close(WORKER_CLOSE_CODES.NOT_AUTHENTICATED);
            return;
          }
          // Written before the reply, so no token write outlives the
          // connection; at most once per token a minute (TokenStore). A
          // failed write is bookkeeping only: reported, never answered.
          try {
            await this.options.tokens.recordUse(token.tokenId);
          } catch (error) {
            this.options.onError?.(error);
          }
          if (this.closed) return;
          // The token may have been revoked, or its grant changed, during the
          // await; the connection scans in WorkerService could not see this
          // connection yet. Read the current record and enter `client` in the
          // same synchronous step, so a later scan reaches it.
          const current = this.options.tokens.authenticate(secret);
          if (!current) {
            this.close(WORKER_CLOSE_CODES.NOT_AUTHENTICATED);
            return;
          }
          this.grant = current.grant;
          this.tokenId = current.tokenId;
          this.state = 'client';
          this.respond(id, {
            role: 'client',
            tokenId: current.tokenId,
            grant: current.grant,
          });
        }
        clearTimeout(this.authTimer);
      } else {
        const replyTasks: (() => void)[] = [];
        const result = await this.options.handle(
          method,
          validated.value,
          this.grant,
          this.state === 'admin',
          this.peerFor(replyTasks),
        );
        this.respond(id, result);
        // The response is already sent: a failing task must not answer twice.
        for (const task of replyTasks) {
          try {
            task();
          } catch (taskError) {
            this.options.onError?.(taskError);
          }
        }
      }
    } catch (error) {
      this.options.onError?.(error);
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : null;
      const allowed: WorkerErrorCode[] = [
        'NOT_FOUND_OR_FORBIDDEN',
        'INVALID_PARAMS',
        'TURN_IN_FLIGHT',
        'SESSION_DRIVEN_ELSEWHERE',
        'DRIVER_LOCK_UNAVAILABLE',
        'NO_PROVIDER_READY',
        'WORKER_BUSY',
        'ALREADY_ANSWERED',
        'TRANSCRIPT_UNAVAILABLE',
        'SESSION_LOG_FAILED',
        'VERSION_MISMATCH',
        'PAIRING_REJECTED',
      ];
      this.reject(
        id,
        typeof code === 'string' && allowed.includes(code as WorkerErrorCode)
          ? (code as WorkerErrorCode)
          : 'INTERNAL',
      );
    }
  }
}
