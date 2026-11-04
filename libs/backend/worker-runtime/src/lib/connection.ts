import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  WORKER_LIMITS,
  WORKER_CLOSE_CODES,
  parseClientFrame,
  parseMethodParams,
  workerError,
  type WorkerGrant,
  type WorkerIdentity,
  type WorkerErrorCode,
} from '@ptah-extension/worker-protocol';
import { PairingWindow } from './pairing-window';
import { TokenStore } from './token-store';
import { verifyAdminKey } from './admin-key';

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
  ) => Promise<unknown>;
  onError?: (error: unknown) => void;
}

export class WorkerConnection {
  private state: 'new' | 'hello' | 'client' | 'admin' = 'new';
  private failures = 0;
  private nextPairAt = 0;
  private readonly id = randomUUID();
  private readonly authTimer: ReturnType<typeof setTimeout>;
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private pongDue: ReturnType<typeof setTimeout> | undefined;
  private inFlight = 0;
  private pairDelay: ReturnType<typeof setTimeout> | undefined;
  private pairDelayDone: (() => void) | undefined;
  private receiving: Promise<void> = Promise.resolve();
  private grant: WorkerGrant | null = null;
  private closed = false;

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
      this.receiving = this.receiving.then(() => this.receive(data.toString()));
    });
    socket.on('close', () => this.dispose());
    socket.on('error', (error) => options.onError?.(error));
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
    if (this.inFlight >= WORKER_LIMITS.maxInFlightRequests) {
      this.reject(id, 'WORKER_BUSY');
      return;
    }
    const validated = parseMethodParams(method, params);
    if (!validated.ok) {
      this.reject(id, 'INVALID_PARAMS');
      return;
    }
    this.inFlight++;
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
        const input = params as { token?: string; admin?: string };
        if (input.admin) {
          const candidate = Buffer.from(input.admin, 'base64url');
          if (
            !this.options.adminKey ||
            !verifyAdminKey(this.options.adminKey, candidate)
          ) {
            this.close(WORKER_CLOSE_CODES.NOT_AUTHENTICATED);
            return;
          }
          this.state = 'admin';
          this.respond(id, { role: 'admin' });
        } else {
          const token = this.options.tokens.authenticate(input.token ?? '');
          if (!token) {
            this.close(WORKER_CLOSE_CODES.NOT_AUTHENTICATED);
            return;
          }
          this.grant = token.grant;
          this.state = 'client';
          this.respond(id, {
            role: 'client',
            tokenId: token.tokenId,
            grant: token.grant,
          });
        }
        clearTimeout(this.authTimer);
      } else {
        const result = await this.options.handle(
          method,
          validated.value,
          this.grant,
          this.state === 'admin',
        );
        this.respond(id, result);
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
    } finally {
      this.inFlight--;
    }
  }
}
