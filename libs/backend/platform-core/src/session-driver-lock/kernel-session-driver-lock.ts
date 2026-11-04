import * as net from 'node:net';
import type {
  DriverHolder,
  DriverLockAcquisition,
  DriverLockReleaseGate,
  HeldDriverLock,
  ISessionDriverLock,
} from '../interfaces/session-driver-lock.interface';
import { sessionDriverEndpoint } from './endpoint-names';
import { ControlEndpoint } from './control-endpoint';

type Entry = HeldDriverLock & {
  server: net.Server;
  closing?: Promise<'released' | 'stranded'>;
};
const RETRY_DELAYS = [100, 400, 1600];
const HOLDER_SOCKET_TIMEOUT_MS = 500;
const UNKNOWN_HOLDER: DriverHolder = {
  kind: 'desktop',
  hostname: 'unknown',
  pid: 0,
  label: 'another Ptah process (not responding)',
  acquiredAt: '',
  responding: false,
};

/** Owns one OS socket/pipe per session. The kernel arbitrates every bind. */
export class KernelSessionDriverLock implements ISessionDriverLock {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<DriverLockAcquisition>>();
  private nextNonce = 0;
  private control?: ControlEndpoint;
  private controlPending?: Promise<ControlEndpoint>;
  constructor(
    private liveRecordCheck: (
      sessionId: string,
    ) => boolean | Promise<boolean> = () => true,
  ) {
    process.on('exit', this.onExit);
  }
  hasLiveRecord(sessionId: string): boolean | Promise<boolean> {
    return this.liveRecordCheck(sessionId);
  }
  setLiveRecordCheck(
    check: (sessionId: string) => boolean | Promise<boolean>,
  ): void {
    this.liveRecordCheck = check;
  }
  /** Without a gate no owner can appear between the check and the release. */
  private releaseGate: DriverLockReleaseGate = async (sessionId, release) =>
    (await this.liveRecordCheck(sessionId)) ? 'in-use' : release();
  setReleaseGate(gate: DriverLockReleaseGate): void {
    this.releaseGate = gate;
  }
  /** Operator release: the gate decides liveness and releases in one step. */
  releaseIfIdle(
    sessionId: string,
    nonce: string,
  ): Promise<'in-use' | 'released' | 'stranded'> {
    return this.releaseGate(sessionId, () => this.release(sessionId, nonce));
  }
  private disposed = false;
  private readonly onExit = (): void => {
    for (const entry of this.entries.values()) {
      try {
        entry.server.close();
      } catch {
        /* process is exiting */
      }
    }
  };

  async acquire(
    sessionId: string,
    owner: DriverHolder,
    purpose: 'drive' | 'refresh' = 'drive',
  ): Promise<DriverLockAcquisition> {
    await this.retryStranded();
    if (this.disposed)
      return { ok: false, unavailable: 'Session driver lock disposed' };
    const own = this.entries.get(sessionId);
    if (own) {
      if (own.state !== 'held')
        return {
          ok: false,
          unavailable: 'Session driver lock release in progress',
        };
      return { ok: true, nonce: own.nonce };
    }
    const pending = this.pending.get(sessionId);
    if (pending) return pending;
    const attempt = this.bind(sessionId, owner, purpose);
    this.pending.set(sessionId, attempt);
    try {
      return await attempt;
    } finally {
      this.pending.delete(sessionId);
    }
  }

  private async bind(
    sessionId: string,
    owner: DriverHolder,
    purpose: 'drive' | 'refresh',
  ): Promise<DriverLockAcquisition> {
    let endpoint: string;
    try {
      endpoint = sessionDriverEndpoint(sessionId);
      if (!this.control) {
        this.controlPending ??= ControlEndpoint.register(owner.kind, this);
        try {
          this.control = await this.controlPending;
        } finally {
          this.controlPending = undefined;
        }
      }
    } catch (error) {
      return { ok: false, unavailable: String(error) };
    }
    const server = net.createServer((socket) => {
      // A peer that resets or never closes must neither crash the process nor
      // hold the connection open and stall server.close() during release.
      socket.on('error', () => socket.destroy());
      socket.setTimeout(HOLDER_SOCKET_TIMEOUT_MS, () => socket.destroy());
      const entry = this.entries.get(sessionId);
      const holder = entry
        ? {
            ...entry.owner,
            label:
              entry.state === 'held'
                ? entry.owner.label
                : `${entry.owner.label} (release pending)`,
          }
        : UNKNOWN_HOLDER;
      socket.end(`${JSON.stringify(holder)}\n`);
    });
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      server.once('error', (err: NodeJS.ErrnoException) => resolve(err));
      try {
        server.listen(endpoint, () => resolve(null));
      } catch (err) {
        resolve(err as NodeJS.ErrnoException);
      }
    });
    if (error) {
      try {
        server.close();
      } catch {
        /* listen failed */
      }
      if (error.code === 'EADDRINUSE') {
        return {
          ok: false,
          holder: (await this.query(endpoint)) ?? UNKNOWN_HOLDER,
        };
      }
      return {
        ok: false,
        unavailable: `Session driver lock bind failed: ${error.code ?? error.message}`,
      };
    }
    if (this.disposed) {
      server.close();
      return { ok: false, unavailable: 'Session driver lock disposed' };
    }
    // The bind is the lock; it must not keep a finished process (e.g. the CLI
    // benchmark) alive. The OS frees the endpoint when the process exits.
    server.unref();
    const nonce = `${process.pid}-${Date.now()}-${++this.nextNonce}`;
    this.entries.set(sessionId, {
      sessionId,
      owner: { ...owner, responding: true },
      purpose,
      nonce,
      state: 'held',
      server,
    });
    return { ok: true, nonce };
  }

  private query(endpoint: string): Promise<DriverHolder | null> {
    return new Promise((resolve) => {
      let settled = false;
      let data = '';
      const socket = net.createConnection(endpoint);
      const finish = (holder: DriverHolder | null): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(holder);
      };
      socket.setTimeout(500, () => finish(null));
      socket.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.length > 4096) return finish(null);
        const newline = data.indexOf('\n');
        if (newline < 0) return;
        try {
          const value: unknown = JSON.parse(data.slice(0, newline));
          if (
            value &&
            typeof value === 'object' &&
            'pid' in value &&
            typeof value.pid === 'number' &&
            'label' in value &&
            typeof value.label === 'string'
          ) {
            finish({ ...(value as DriverHolder), responding: true });
          } else finish(null);
        } catch {
          finish(null);
        }
      });
      socket.on('error', () => finish(null));
      socket.on('end', () => finish(null));
    });
  }

  annotate(sessionId: string, nonce: string, label: string): void {
    const entry = this.entries.get(sessionId);
    if (entry?.nonce === nonce) entry.owner.label = label;
  }

  async release(
    sessionId: string,
    nonce: string,
  ): Promise<'released' | 'stranded'> {
    await this.retryStranded(sessionId);
    const entry = this.entries.get(sessionId);
    if (!entry || entry.nonce !== nonce) return 'released';
    return this.closeEntry(entry);
  }

  private async closeEntry(entry: Entry): Promise<'released' | 'stranded'> {
    if (entry.closing) return entry.closing;
    entry.state = 'releasing';
    const closing = (async (): Promise<'released' | 'stranded'> => {
      for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
        const closed = await new Promise<boolean>((resolve) => {
          try {
            entry.server.close((error?: Error) => resolve(!error));
          } catch {
            resolve(false);
          }
        });
        if (closed) {
          this.entries.delete(entry.sessionId);
          return 'released';
        }
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS[attempt]),
        );
      }
      entry.state = 'stranded';
      console.error(
        `[driver-lock] stranded session=${entry.sessionId} pid=${process.pid}`,
      );
      return 'stranded';
    })();
    entry.closing = closing;
    try {
      return await closing;
    } finally {
      entry.closing = undefined;
    }
  }

  private async retryStranded(except?: string): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.state === 'stranded' && entry.sessionId !== except)
        await this.closeEntry(entry);
    }
  }

  async holder(sessionId: string): Promise<DriverHolder | null> {
    const own = this.entries.get(sessionId);
    if (own)
      return {
        ...own.owner,
        label:
          own.state === 'held'
            ? own.owner.label
            : `${own.owner.label} (release pending)`,
      };
    let endpoint: string;
    try {
      endpoint = sessionDriverEndpoint(sessionId);
    } catch {
      // degradation-audit: optional-capability — a session ID that cannot form
      // an endpoint name cannot have a holder.
      return null;
    }
    return this.query(endpoint);
  }

  held(): HeldDriverLock[] {
    return Array.from(
      this.entries.values(),
      ({ server: _server, closing: _closing, ...entry }) => ({
        ...entry,
        owner: { ...entry.owner },
      }),
    );
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all(
      Array.from(this.entries.values(), (entry) => this.closeEntry(entry)),
    );
    process.removeListener('exit', this.onExit);
    this.control?.unregister(this);
  }
}
