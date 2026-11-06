import { Duplex } from 'node:stream';
import WebSocket from 'ws';
import {
  WorkerClient,
  WorkerClientError,
  SUPPORTED_PROTOCOL_RANGE,
  WORKER_LIMITS,
  type WorkerMethod,
  type WorkerMethodParams,
  type WorkerMethodResult,
  type EventFrame,
  type WebSocketLike,
} from '@ptah-extension/worker-protocol';
import type {
  MachineConnectionState,
  MachinesEventPayload,
  MachinesStatePayload,
  MachineVersions,
} from '@ptah-extension/shared';
import { createSshStdioTransport } from './ssh-stdio-transport';

const BACKOFF = [1000, 2000, 5000, 10000, 30000] as const;
type Timer = ReturnType<typeof setTimeout>;
export interface MachineConnectionOptions {
  machineId: string;
  alias: string;
  token?: string;
  workerMachineId?: string;
  onTokenRejected?: () => Promise<void>;
  ptahVersion: string;
  port?: number;
  createTransport?: (alias: string) => Duplex;
  createWebSocket?: (
    url: string,
    options: WebSocket.ClientOptions,
  ) => WebSocket;
  createClient?: (callbacks: {
    onEvent(frame: EventFrame): void;
    onClose(code: number): void;
  }) => WorkerClient;
  onState?: (state: MachinesStatePayload) => void;
  onEvent?: (event: MachinesEventPayload) => void;
  random?: () => number;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}

export class MachineConnection {
  readonly machineId: string;
  readonly alias: string;
  private token?: string;
  private client?: WorkerClient;
  private generation = 0;
  private closing = false;
  private workerMachineId?: string;
  reason?: string;
  private transport?: Duplex;
  private timer?: Timer;
  private attempts = 0;
  private disposed = false;
  private connecting?: Promise<void>;
  private exchanging?: Promise<{
    token: string;
    grant: WorkerMethodResult<'pair.exchange'>['grant'];
    workerMachineId: string;
  }>;
  private readonly sessions = new Map<
    string,
    { epoch?: string; seq: number }
  >();
  state: MachineConnectionState;
  nextRetryAt?: number;
  lastSeenAt?: number;
  versions?: MachineVersions;

  constructor(private readonly options: MachineConnectionOptions) {
    this.machineId = options.machineId;
    this.alias = options.alias;
    this.token = options.token;
    this.state =
      options.token && options.workerMachineId ? 'offline' : 'unpaired';
    if (options.token && !options.workerMachineId)
      this.reason = 'Re-pair this machine to verify its worker identity.';
    this.workerMachineId = options.workerMachineId;
  }

  private socket(generation: number): WebSocketLike {
    const transport = this.options.createTransport
      ? this.options.createTransport(this.alias)
      : createSshStdioTransport(this.alias, this.options.port ?? 41873);
    this.transport = transport;
    const url = `ws://127.0.0.1:${this.options.port ?? 41873}/rpc`;
    // ws accepts the SSH Duplex at runtime; its declaration restricts this hook to net.Socket.
    const socketOptions = {
      createConnection: () => transport,
      maxPayload: WORKER_LIMITS.maxPayloadBytes,
    } as unknown as WebSocket.ClientOptions;
    const ws = this.options.createWebSocket
      ? this.options.createWebSocket(url, socketOptions)
      : new WebSocket(url, socketOptions);
    const socket: WebSocketLike = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      onpong: null,
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
      ping: () => ws.ping(),
    };
    ws.on('open', () => socket.onopen?.());
    ws.on('message', (data) => socket.onmessage?.({ data: data.toString() }));
    ws.on('close', (code, reason) => {
      transport.destroy();
      if (generation === this.generation)
        socket.onclose?.({ code, reason: reason.toString() });
    });
    ws.on('error', (error) => {
      if (generation === this.generation) socket.onerror?.(error);
    });
    ws.on('pong', () => {
      if (generation === this.generation) socket.onpong?.();
    });
    return socket;
  }

  private emit(): void {
    this.options.onState?.({
      machineId: this.machineId,
      state: this.state,
      nextRetryAt: this.nextRetryAt,
      lastSeenAt: this.lastSeenAt,
      versions: this.versions,
    });
  }
  private cancelTimer(): void {
    if (this.timer !== undefined)
      (this.options.clearTimer ?? clearTimeout)(this.timer);
    this.timer = undefined;
    this.nextRetryAt = undefined;
  }
  private makeClient(generation: number): WorkerClient {
    const callbacks = {
      onEvent: (frame: EventFrame) => {
        if (generation === this.generation && !this.disposed) this.event(frame);
      },
      onClose: (code: number) => {
        if (generation === this.generation) this.closed(code);
      },
    };
    return (
      this.options.createClient?.(callbacks) ??
      new WorkerClient({
        createSocket: () => this.socket(generation),
        callbacks: {
          onEvent: callbacks.onEvent,
          onClose: (close) => callbacks.onClose(close.code),
        },
      })
    );
  }
  private closed(code: number): void {
    if (this.closing || this.disposed) return;
    this.transport?.destroy();
    this.transport = undefined;
    if (code === 4409) {
      this.cancelTimer();
      this.state = 'version-mismatch';
      this.emit();
      return;
    }
    if (code === 4401 || code === 4410) {
      this.rejectToken();
      return;
    }
    if (!this.connecting) this.schedule();
  }
  private rejectToken(): void {
    this.token = undefined;
    this.cancelTimer();
    this.state = 'unpaired';
    this.emit();
    // degradation-audit: reported - the machine is already 'unpaired' and the state
    // push reports it; a failed keyring delete leaves only a token the worker rejected.
    void this.options.onTokenRejected?.().catch(() => undefined);
  }
  private schedule(): void {
    if (
      this.disposed ||
      this.state === 'version-mismatch' ||
      this.state === 'unpaired'
    )
      return;
    this.cancelTimer();
    this.state = 'offline';
    const base = BACKOFF[Math.min(this.attempts++, BACKOFF.length - 1)];
    const delay = Math.round(
      base * (0.8 + 0.4 * (this.options.random ?? Math.random)()),
    );
    this.nextRetryAt = (this.options.now ?? Date.now)() + delay;
    this.timer = (this.options.setTimer ?? setTimeout)(() => {
      this.timer = undefined;
      // degradation-audit: reported - connect() moves the state to offline and schedules
      // the next retry itself; the machines:state push reports the failure.
      void this.connect().catch(() => undefined);
    }, delay);
    this.emit();
  }
  private event(frame: EventFrame): void {
    if (this.disposed) return;
    this.lastSeenAt = (this.options.now ?? Date.now)();
    const previous = this.sessions.get(frame.sessionId);
    if (previous && previous.epoch === frame.epoch && frame.seq <= previous.seq)
      return;
    if (previous)
      this.sessions.set(frame.sessionId, {
        epoch: frame.epoch,
        seq: frame.seq,
      });
    this.options.onEvent?.({
      machineId: this.machineId,
      sessionId: frame.sessionId,
      epoch: frame.epoch,
      seq: frame.seq,
      type: frame.type,
      payload: frame.payload,
    });
  }
  connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.exchanging || this.state === 'connected') return Promise.resolve();
    if (this.disposed || !this.token) return Promise.resolve();
    if (!this.workerMachineId) {
      this.cancelTimer();
      this.reason = 'Re-pair this machine to verify its worker identity.';
      this.state = 'unpaired';
      this.emit();
      return Promise.resolve();
    }
    this.cancelTimer();
    this.state = 'reconnecting';
    this.emit();
    const attempt = this.open();
    const tracked = attempt.finally(() => {
      if (this.connecting === tracked) this.connecting = undefined;
    });
    this.connecting = tracked;
    return tracked;
  }
  private async open(): Promise<void> {
    const generation = ++this.generation;
    const client = this.makeClient(generation);
    this.client = client;
    this.versions = {
      local: {
        ptahVersion: this.options.ptahVersion,
        protocol: SUPPORTED_PROTOCOL_RANGE,
      },
    };
    try {
      await client.connect();
      if (this.disposed) return;
      const hello = await client.call('hello', {
        protocol: SUPPORTED_PROTOCOL_RANGE,
        client: { name: 'Ptah Electron', version: this.options.ptahVersion },
      });
      if (this.disposed) return;
      this.versions = {
        local: {
          ptahVersion: this.options.ptahVersion,
          protocol: SUPPORTED_PROTOCOL_RANGE,
        },
        remote: {
          ptahVersion: hello.worker.ptahVersion,
          protocol: { min: hello.protocol, max: hello.protocol },
        },
      };
      if (
        this.workerMachineId &&
        hello.worker.machineId !== this.workerMachineId
      ) {
        this.reason = `A different worker answers on ${this.alias}.`;
        this.state = 'unpaired';
        throw new WorkerClientError('PAIRING_REJECTED');
      }
      const token = this.token;
      if (!token) throw new WorkerClientError('NOT_CONNECTED');
      await client.call('auth', { token });
      if (this.disposed) return;
      for (const [sessionId, cursor] of this.sessions) {
        try {
          await client.call('session.attach', {
            sessionId,
            afterSeq: cursor.seq,
            ...(cursor.epoch ? { epoch: cursor.epoch } : {}),
          });
        } catch {
          this.sessions.delete(sessionId);
        }
        if (this.disposed) return;
      }
      this.state = 'connected';
      this.attempts = 0;
      this.lastSeenAt = (this.options.now ?? Date.now)();
      this.emit();
    } catch (error) {
      if (!this.disposed) {
        if (
          error instanceof WorkerClientError &&
          error.code === 'VERSION_MISMATCH'
        ) {
          this.state = 'version-mismatch';
          this.cancelTimer();
          this.emit();
        } else if (
          error instanceof WorkerClientError &&
          error.code === 'PAIRING_REJECTED'
        ) {
          this.state = 'unpaired';
          this.cancelTimer();
          this.emit();
        } else if (
          this.state !== 'version-mismatch' &&
          this.state !== 'unpaired'
        )
          this.schedule();
      }
      this.closing = true;
      client.close();
      this.transport?.destroy();
      this.closing = false;
      throw error;
    }
  }
  async exchange(
    code: string,
    validate?: (
      result: WorkerMethodResult<'pair.exchange'> & { workerMachineId: string },
      revoke: () => Promise<void>,
    ) => Promise<void>,
  ): Promise<
    WorkerMethodResult<'pair.exchange'> & { workerMachineId: string }
  > {
    if (
      this.exchanging ||
      this.connecting ||
      this.state === 'reconnecting' ||
      this.state === 'connected'
    )
      throw new Error(
        'Pairing cannot start while a connection is in progress.',
      );
    const generation = ++this.generation;
    const client = this.makeClient(generation);
    this.client = client;
    this.cancelTimer();
    const operation = (async () => {
      try {
        await client.connect();
        const hello = await client.call('hello', {
          protocol: SUPPORTED_PROTOCOL_RANGE,
          client: { name: 'Ptah Electron', version: this.options.ptahVersion },
        });
        const result = await client.call('pair.exchange', {
          code,
          clientName: 'Ptah Electron',
        });
        const paired = { ...result, workerMachineId: hello.worker.machineId };
        await validate?.(paired, async () => {
          await client.call('auth', { token: result.token });
          await client.call('token.revokeSelf', {});
        });
        return paired;
      } catch (error) {
        if (
          !this.disposed &&
          this.token &&
          this.workerMachineId &&
          this.state !== 'version-mismatch' &&
          this.state !== 'unpaired'
        )
          this.schedule();
        throw error;
      } finally {
        this.closing = true;
        client.close();
        if (this.client === client) {
          this.transport?.destroy();
          this.transport = undefined;
          this.client = undefined;
        }
        this.closing = false;
      }
    })();
    this.exchanging = operation;
    // degradation-audit: reported - the caller receives the original rejection.
    void operation
      .finally(() => {
        if (this.exchanging === operation) this.exchanging = undefined;
      })
      .catch(() => undefined);
    return operation;
  }
  setWorkerMachineId(id: string): void {
    this.workerMachineId = id;
  }
  clearToken(): void {
    this.token = undefined;
    this.cancelTimer();
    this.state = 'unpaired';
    this.closing = true;
    this.client?.close();
    this.closing = false;
    this.transport?.destroy();
    this.emit();
  }
  setToken(token: string): void {
    this.token = token;
    this.state = 'offline';
    this.attempts = 0;
    this.emit();
  }
  hasToken(): boolean {
    return this.token !== undefined;
  }
  retry(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.exchanging || this.state === 'connected') return Promise.resolve();
    this.state = this.token ? 'offline' : 'unpaired';
    this.attempts = 0;
    return this.connect();
  }
  async call<M extends WorkerMethod>(
    method: M,
    params: WorkerMethodParams<M>,
  ): Promise<WorkerMethodResult<M>> {
    if (this.state !== 'connected')
      throw new WorkerClientError('NOT_CONNECTED');
    if (!this.client) throw new WorkerClientError('NOT_CONNECTED');
    return this.client.call(method, params);
  }
  async attach(sessionId: string, afterSeq = 0) {
    const previous = this.sessions.get(sessionId);
    this.sessions.set(sessionId, {
      epoch: previous?.epoch,
      seq: afterSeq,
    });
    try {
      const result = await this.call('session.attach', { sessionId, afterSeq });
      const current = this.sessions.get(sessionId);
      if (result.mode === 'log')
        this.sessions.set(sessionId, {
          epoch: result.epoch,
          seq: Math.max(afterSeq, current?.seq ?? 0),
        });
      return result;
    } catch (error) {
      this.sessions.delete(sessionId);
      throw error;
    }
  }
  detach(sessionId: string): Promise<unknown> {
    this.sessions.delete(sessionId);
    return this.call('session.detach', { sessionId });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTimer();
    this.closing = true;
    this.client?.close();
    this.closing = false;
    this.transport?.destroy();
  }
}
