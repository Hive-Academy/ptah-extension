import { readdir, rm } from 'node:fs/promises';
import {
  WORKER_CLOSE_CODES,
  type ReadinessReport,
  type WorkerGrant,
} from '@ptah-extension/worker-protocol';
import { writeJsonAtomic } from './atomic-file';
import { SessionEventLog } from './session-event-log';
import { SessionFanOut } from './fan-out';
import { SessionLogWriter } from './session-log-writer';
import type { SessionDriver } from './session-driver';
import { assertManualApproval } from './pending-permissions';
import { ensureWorkerDirectory, type WorkerPaths } from './paths';
import type { WorkerPeer } from './connection';
import {
  createWorkerServer,
  type WorkerServer,
  type WorkerServerOptions,
} from './worker-server';
import type { WorkspaceRegistry } from './workspace-registry';

export interface WorkerServiceOptions extends Omit<
  WorkerServerOptions,
  'handle'
> {
  paths: WorkerPaths;
  registry: WorkspaceRegistry;
  workspacePaths: readonly string[];
  argv?: readonly string[];
  autoApprove?: string;
  driver: Pick<SessionDriver, 'onAppendFailed'>;
  handle: (
    method: string,
    params: unknown,
    grant: WorkerGrant | null,
    admin: boolean,
    peer: WorkerPeer,
  ) => Promise<unknown>;
  /**
   * Runs after the listener has closed and before the logs close: stops
   * pending admissions and aborts admitted turns while their logs are open.
   */
  drainTurns?: () => Promise<void>;
  releaseLocks: () => Promise<void>;
  readiness: () => Promise<ReadinessReport>;
  onSigterm?: boolean;
}

/** `endpoint.json`: where the running worker listens, and who it is. */
export interface WorkerEndpointRecord {
  host: string;
  port: number;
  pid: number;
  machineId: string;
}

export class WorkerService {
  private server: WorkerServer | undefined;
  private readonly logs = new Map<string, SessionEventLog>();
  private readonly writers = new Map<string, SessionLogWriter>();
  private stopping: Promise<void> | undefined;
  private endpointWritten = false;
  private readonly onTermination = (): void => {
    void this.stop();
  };

  constructor(private readonly options: WorkerServiceOptions) {}

  get endpoint(): { host: string; port: number } | undefined {
    return this.server
      ? { host: this.server.host, port: this.server.port }
      : undefined;
  }

  async start(): Promise<void> {
    assertManualApproval(
      this.options.argv ?? process.argv,
      this.options.autoApprove,
    );
    await ensureWorkerDirectory(this.options.paths);
    await this.options.registry.load();
    await this.options.tokens.load();
    try {
      await this.recoverLogs();
      for (const path of this.options.workspacePaths)
        await this.options.registry.register(path);
      const readiness = await this.options.readiness();
      if (!readiness.ready)
        throw new Error(
          `Worker is not ready: ${readiness.checks
            .filter((check) => check.status === 'fail')
            .map((check) => check.id)
            .join(', ')}`,
        );
      this.server = await createWorkerServer(this.options);
      // The PID and machine ID let an operator command confirm that the
      // listener is this worker before it sends the admin key.
      const endpoint: WorkerEndpointRecord = {
        host: this.server.host,
        port: this.server.port,
        pid: process.pid,
        machineId: this.options.identity.machineId,
      };
      await writeJsonAtomic(this.options.paths.endpoint, endpoint);
      this.endpointWritten = true;
      if (this.options.onSigterm !== false)
        process.on('SIGTERM', this.onTermination);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /**
   * Closes every live connection authenticated with `tokenId` with REVOKED,
   * after a goodbye. `exceptConnectionId` is a caller that closes itself
   * after its reply. Returns how many connections were closed.
   */
  closeTokenConnections(tokenId: string, exceptConnectionId?: string): number {
    let closed = 0;
    for (const connection of this.server?.connections ?? []) {
      if (
        connection.authenticatedTokenId !== tokenId ||
        connection.connectionId === exceptConnectionId
      )
        continue;
      connection.sendControl('goodbye', { reason: 'revoked' });
      connection.close(WORKER_CLOSE_CODES.REVOKED);
      closed++;
    }
    return closed;
  }

  /** Applies a changed grant to the live connections of `tokenId`. */
  refreshGrant(tokenId: string, grant: WorkerGrant): void {
    for (const connection of this.server?.connections ?? [])
      if (connection.authenticatedTokenId === tokenId)
        connection.refreshGrant(grant);
  }

  writer(sessionId: string): SessionLogWriter {
    const writer = this.writers.get(sessionId);
    if (!writer) throw new Error('Session log is not open');
    return writer;
  }

  /** The open writer for a logged session, or undefined when it has no log. */
  findWriter(sessionId: string): SessionLogWriter | undefined {
    return this.writers.get(sessionId);
  }

  async openSession(sessionId: string): Promise<SessionLogWriter> {
    if (this.writers.has(sessionId)) return this.writer(sessionId);
    const log = await SessionEventLog.open(this.options.paths, sessionId);
    this.logs.set(sessionId, log);
    const writer = new SessionLogWriter(log, new SessionFanOut(), {
      onAppendFailed: (id) => this.options.driver.onAppendFailed(id),
    });
    this.writers.set(sessionId, writer);
    return writer;
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.shutdown();
    return this.stopping;
  }

  private async recoverLogs(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.options.paths.events);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return;
      throw error;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      await this.openSession(name.slice(0, -6));
    }
  }

  private async shutdown(): Promise<void> {
    process.off('SIGTERM', this.onTermination);
    this.options.pairing.close();
    for (const connection of this.server?.connections ?? [])
      connection.sendControl('goodbye', { reason: 'shutdown' });
    if (this.server) await this.server.close();
    await this.options.drainTurns?.();
    for (const log of this.logs.values()) {
      await log.sync();
      await log.close();
    }
    this.logs.clear();
    this.writers.clear();
    await this.options.releaseLocks();
    if (this.endpointWritten)
      await rm(this.options.paths.endpoint, { force: true });
  }
}
