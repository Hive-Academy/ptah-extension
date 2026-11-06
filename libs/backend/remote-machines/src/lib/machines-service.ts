import { randomUUID } from 'node:crypto';
import { MachineRegistry } from './machine-registry';
import { MachineTokenStore } from './machine-token-store';
import {
  MachineConnection,
  type MachineConnectionOptions,
} from './machine-connection';
import { listSshAliases, validateSshAlias } from './ssh-alias';
import { runSshWorkerCommand } from './ssh-worker-commands';
import type {
  MachineSummary,
  MachinesReadinessResult,
  MachinesSessionAttachResult,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { WORKER_METHOD_SCHEMAS } from '@ptah-extension/worker-protocol';
import { KernelSessionDriverLock } from '@ptah-extension/platform-core';
import type {
  WorkerMethod,
  WorkerMethodParams,
  WorkerMethodResult,
} from '@ptah-extension/worker-protocol';

export interface MachinesBroadcaster {
  broadcastMessage(
    type:
      typeof MESSAGE_TYPES.MACHINES_EVENT | typeof MESSAGE_TYPES.MACHINES_STATE,
    payload: unknown,
  ): Promise<unknown>;
}
export interface MachinesServiceOptions {
  registry: MachineRegistry;
  tokens: MachineTokenStore;
  webviewManager: MachinesBroadcaster;
  ptahVersion: string;
  createConnection?: (options: MachineConnectionOptions) => MachineConnection;
  sshAliases?: () => Promise<string[]>;
  sshCommand?: typeof runSshWorkerCommand;
}
export class MachinesService {
  private readonly connections = new Map<string, MachineConnection>();
  private mutation: Promise<unknown> = Promise.resolve();
  private disposed = false;
  constructor(private readonly options: MachinesServiceOptions) {}
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.catch(() => undefined);
    return next;
  }
  private connection(machineId: string): MachineConnection {
    const connection = this.connections.get(machineId);
    if (!connection) throw new Error('Machine not found');
    return connection;
  }
  private async create(
    machineId: string,
    alias: string,
  ): Promise<MachineConnection> {
    const token = await this.options.tokens.get(machineId);
    const connection = (
      this.options.createConnection ?? ((opts) => new MachineConnection(opts))
    )({
      machineId,
      alias,
      token,
      ptahVersion: this.options.ptahVersion,
      onEvent: (event) => {
        void this.options.webviewManager.broadcastMessage(
          MESSAGE_TYPES.MACHINES_EVENT,
          event,
        );
      },
      onState: (state) => {
        void this.options.webviewManager.broadcastMessage(
          MESSAGE_TYPES.MACHINES_STATE,
          state,
        );
      },
    });
    this.connections.set(machineId, connection);
    return connection;
  }
  private summary(
    connection: MachineConnection,
    displayName?: string,
  ): MachineSummary {
    return {
      machineId: connection.machineId,
      alias: connection.alias,
      displayName: displayName ?? connection.alias,
      state: connection.state,
      nextRetryAt: connection.nextRetryAt,
      versions: connection.versions,
      lastSeenAt: connection.lastSeenAt,
    };
  }
  async list(): Promise<{ machines: MachineSummary[] }> {
    const data = await this.options.registry.read();
    const machines: MachineSummary[] = [];
    for (const entry of data.machines) {
      const connection =
        this.connections.get(entry.machineId) ??
        (await this.create(entry.machineId, entry.alias));
      machines.push(this.summary(connection, entry.displayName));
    }
    return { machines };
  }
  async sshAliases(): Promise<{ aliases: string[] }> {
    return { aliases: await (this.options.sshAliases ?? listSshAliases)() };
  }
  async add(alias: string): Promise<{ machine: MachineSummary }> {
    validateSshAlias(alias);
    return this.serialize(async () => {
      const aliases = await (this.options.sshAliases ?? listSshAliases)();
      if (!aliases.includes(alias)) throw new Error('SSH alias not found');
      const data = await this.options.registry.read();
      if (data.machines.some((entry) => entry.alias === alias))
        throw new Error('Machine already added');
      const machineId = randomUUID();
      await this.options.registry.write({
        machines: [...data.machines, { machineId, alias }],
      });
      return { machine: this.summary(await this.create(machineId, alias)) };
    });
  }
  async pair(
    machineId: string,
    code: string,
  ): Promise<{ machine: MachineSummary }> {
    return this.serialize(async () => {
      const data = await this.options.registry.read();
      const entry = data.machines.find((item) => item.machineId === machineId);
      if (!entry) throw new Error('Machine not found');
      const connection = this.connection(machineId);
      // Pair exchange is allowed before authentication; open the transport first.
      const result = await connection.exchange(code);
      if (result.grant.machineId !== machineId)
        throw new Error('Pairing returned a different machine');
      connection.setToken(result.token);
      try {
        await connection.connect();
        await this.options.tokens.set(machineId, result.token);
      } catch (error) {
        connection.clearToken();
        throw error;
      }
      return { machine: this.summary(connection, entry.displayName) };
    });
  }
  async pairViaSsh(machineId: string): Promise<{ machine: MachineSummary }> {
    const data = await this.options.registry.read();
    const entry = data.machines.find((item) => item.machineId === machineId);
    if (!entry) throw new Error('Machine not found');
    const result = await (this.options.sshCommand ?? runSshWorkerCommand)(
      entry.alias,
      'pair',
    );
    const parsed =
      WORKER_METHOD_SCHEMAS['admin.pairing.open'].result.parse(result);
    return this.pair(machineId, parsed.code);
  }
  async remove(
    machineId: string,
  ): Promise<{ removed: true; revokedOnWorker: boolean }> {
    return this.serialize(async () => {
      const data = await this.options.registry.read();
      if (!data.machines.some((entry) => entry.machineId === machineId))
        throw new Error('Machine not found');
      const connection = this.connections.get(machineId);
      let revokedOnWorker = false;
      if (connection?.state === 'connected') {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            connection.call('token.revokeSelf', {}),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Revocation timed out')),
                5000,
              );
            }),
          ]);
          revokedOnWorker = true;
        } catch {
          /* Local removal still completes. */
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      await this.options.tokens.delete(machineId);
      await this.options.registry.write({
        machines: data.machines.filter(
          (entry) => entry.machineId !== machineId,
        ),
      });
      connection?.dispose();
      this.connections.delete(machineId);
      return { removed: true, revokedOnWorker };
    });
  }
  async retry(machineId: string): Promise<{ machine: MachineSummary }> {
    const connection = this.connection(machineId);
    await connection.retry();
    return { machine: this.summary(connection) };
  }
  async readiness(machineId: string): Promise<MachinesReadinessResult> {
    const connection = this.connection(machineId);
    let remote = null;
    if (connection.state === 'connected')
      remote = (await connection.call('machine.info', {})).readiness;
    return { machineId, remote, local: await localLockReadiness() };
  }
  async call<M extends WorkerMethod>(
    machineId: string,
    method: M,
    params: WorkerMethodParams<M>,
  ): Promise<WorkerMethodResult<M>> {
    return this.connection(machineId).call(method, params);
  }
  attach(
    machineId: string,
    sessionId: string,
    afterSeq = 0,
  ): Promise<MachinesSessionAttachResult> {
    return this.connection(machineId).attach(sessionId, afterSeq);
  }
  async detach(
    machineId: string,
    sessionId: string,
  ): Promise<{ detached: true }> {
    await this.connection(machineId).detach(sessionId);
    return { detached: true };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const connection of this.connections.values()) connection.dispose();
    this.connections.clear();
  }
}

export async function localLockReadiness() {
  const first = new KernelSessionDriverLock(() => false);
  const second = new KernelSessionDriverLock(() => false);
  const id = `machine-self-test-${randomUUID()}`;
  const holder = {
    kind: 'desktop' as const,
    hostname: 'localhost',
    pid: process.pid,
    label: 'Ptah self-test',
    acquiredAt: new Date().toISOString(),
    responding: true,
  };
  try {
    const initial = await first.acquire(id, holder);
    const refused = await second.acquire(id, holder);
    await first.dispose();
    const rebound = await second.acquire(id, holder);
    const ready = initial.ok && !refused.ok && rebound.ok;
    return {
      ready,
      checks: [
        {
          id: 'driver-lock',
          label: 'Local driver lock',
          status: ready ? ('pass' as const) : ('fail' as const),
        },
      ],
    };
  } catch {
    return {
      ready: false,
      checks: [
        {
          id: 'driver-lock',
          label: 'Local driver lock',
          status: 'fail' as const,
        },
      ],
    };
  } finally {
    await first.dispose();
    await second.dispose();
  }
}
