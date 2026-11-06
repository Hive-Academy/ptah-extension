import { Duplex } from 'node:stream';
import WebSocket from 'ws';
import {
  WorkerClient,
  WorkerClientError,
  SUPPORTED_PROTOCOL_RANGE,
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
  ptahVersion: string;
  port?: number;
  createTransport?: (alias: string) => Duplex;
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
  private client: WorkerClient;
  private transport?: Duplex;
  private timer?: Timer;
  private attempts = 0;
  private disposed = false;
  private connecting?: Promise<void>;
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
    this.state = options.token ? 'offline' : 'unpaired';
    this.client =
      options.createClient?.({
        onEvent: (frame) => this.event(frame),
        onClose: (code) => this.closed(code),
      }) ??
      new WorkerClient({
        createSocket: () => this.socket(),
        callbacks: {
          onEvent: (frame) => this.event(frame),
          onClose: (close) => this.closed(close.code),
        },
      });
  }

  private socket(): WebSocketLike {
    const transport = this.options.createTransport
      ? this.options.createTransport(this.alias)
      : createSshStdioTransport(this.alias, this.options.port ?? 41873);
    this.transport = transport;
    const ws = new WebSocket(
      `ws://127.0.0.1:${this.options.port ?? 41873}/rpc`,
      {
        createConnection: () => transport,
      },
    );
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
      socket.onclose?.({ code, reason: reason.toString() });
    });
    ws.on('error', (error) => socket.onerror?.(error));
    ws.on('pong', () => socket.onpong?.());
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
  private closed(code: number): void {
    this.transport?.destroy();
    this.transport = undefined;
    if (this.disposed) return;
    if (code === 4409) {
      this.cancelTimer();
      this.state = 'version-mismatch';
      this.emit();
      return;
    }
    if (code === 4401 || code === 4410) {
      this.cancelTimer();
      this.state = 'unpaired';
      this.emit();
      return;
    }
    this.schedule();
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
      void this.connect().catch(() => undefined);
    }, delay);
    this.emit();
  }
  private event(frame: EventFrame): void {
    this.lastSeenAt = (this.options.now ?? Date.now)();
    const previous = this.sessions.get(frame.sessionId);
    if (
      previous &&
      (previous.epoch !== frame.epoch || frame.seq > previous.seq)
    )
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
  async connect(): Promise<void> {
    if (this.disposed || !this.token) return;
    if (this.connecting) return this.connecting;
    this.cancelTimer();
    this.state = 'reconnecting';
    this.emit();
    this.connecting = this.open();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }
  private async open(): Promise<void> {
    try {
      await this.client.connect();
      const hello = await this.client.call('hello', {
        protocol: SUPPORTED_PROTOCOL_RANGE,
        client: { name: 'Ptah Electron', version: this.options.ptahVersion },
      });
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
      const token = this.token;
      if (!token) throw new WorkerClientError('NOT_CONNECTED');
      await this.client.call('auth', { token });
      this.state = 'connected';
      this.attempts = 0;
      this.lastSeenAt = (this.options.now ?? Date.now)();
      this.emit();
      for (const [sessionId, cursor] of this.sessions)
        await this.client.call('session.attach', {
          sessionId,
          afterSeq: cursor.seq,
          ...(cursor.epoch ? { epoch: cursor.epoch } : {}),
        });
    } catch (error) {
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
      } else if (this.state !== 'version-mismatch' && this.state !== 'unpaired')
        this.schedule();
      this.client.close();
      this.transport?.destroy();
      throw error;
    }
  }
  async exchange(code: string) {
    this.cancelTimer();
    await this.client.connect();
    try {
      await this.client.call('hello', {
        protocol: SUPPORTED_PROTOCOL_RANGE,
        client: { name: 'Ptah Electron', version: this.options.ptahVersion },
      });
      return await this.client.call('pair.exchange', {
        code,
        clientName: 'Ptah Electron',
      });
    } finally {
      this.client.close();
      this.transport?.destroy();
    }
  }
  clearToken(): void {
    this.token = undefined;
    this.cancelTimer();
    this.state = 'unpaired';
    this.client.close();
    this.transport?.destroy();
    this.emit();
  }
  setToken(token: string): void {
    this.token = token;
    this.state = 'offline';
    this.attempts = 0;
    this.emit();
  }
  retry(): Promise<void> {
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
    return this.client.call(method, params);
  }
  async attach(sessionId: string, afterSeq = 0) {
    const result = await this.call('session.attach', { sessionId, afterSeq });
    if (result.mode === 'log')
      this.sessions.set(sessionId, { epoch: result.epoch, seq: afterSeq });
    return result;
  }
  detach(sessionId: string): Promise<unknown> {
    this.sessions.delete(sessionId);
    return this.call('session.detach', { sessionId });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTimer();
    this.client.close();
    this.transport?.destroy();
  }
}
