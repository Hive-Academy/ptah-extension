import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type { WithEngineOptions } from '@ptah-extension/cli-engine';
import type {
  ISessionDriverLock,
  IWorkspaceLifecycleProvider,
} from '@ptah-extension/platform-core';
import type {
  ConfigAutopilotGetResult,
  ISdkPermissionHandler,
  SessionId,
} from '@ptah-extension/shared';
import type {
  HistoryReader,
  SessionMetadataReader,
  WorkerPaths,
  WorkerPeer,
} from '@ptah-extension/worker-runtime';
import type {
  ReadinessReport,
  WorkerGrant,
} from '@ptah-extension/worker-protocol';
import type { RemoteSessions } from './remote-sessions';

export interface ServeChecks {
  nodeVersion(): string;
  sqliteMemory(): Promise<void>;
  ptahVersion(): Promise<string>;
}

export interface ServeOptions {
  port: number;
  maxActiveTurns: number;
  paths: WorkerPaths;
  argv: readonly string[];
  autoApprove?: string;
  bootstrap?: WithEngineOptions['bootstrap'];
  checks?: ServeChecks;
  readiness?: () => Promise<ReadinessReport>;
  onReady?: (endpoint: { host: string; port: number }) => void;
  shutdown?: AbortSignal;
}

export async function bundleVersion(): Promise<string> {
  const bundle = process.argv[1];
  if (!bundle) throw new Error('Worker bundle path is unavailable');
  const value: unknown = JSON.parse(
    await readFile(join(dirname(bundle), 'package.json'), 'utf8'),
  );
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    typeof value.version !== 'string' ||
    !value.version
  )
    throw new Error('Ptah package version is unavailable');
  return value.version;
}

const defaultChecks: ServeChecks = {
  nodeVersion: () => process.versions.node,
  sqliteMemory: async () => {
    const loaded: unknown = require('better-sqlite3');
    if (typeof loaded !== 'function') throw new Error('Invalid SQLite module');
    const Database = loaded as new (path: string) => { close(): void };
    const database = new Database(':memory:');
    database.close();
  },
  ptahVersion: bundleVersion,
};

export async function serveCommand(options: ServeOptions): Promise<void> {
  const checks = options.checks ?? defaultChecks;
  await import('@ptah-extension/platform-core');
  const { fixPath } = await import('@ptah-extension/cli-agent-runtime');
  fixPath();
  if (options.argv.includes('--auto-approve') || options.autoApprove === 'true')
    throw new Error(
      'The worker requires manual approval for remote permission requests.',
    );
  if (Number(checks.nodeVersion().replace(/^v/, '').split('.')[0]) < 22)
    throw new Error(
      'Worker requires Node 22 or newer. Update the Ptah desktop package.',
    );
  try {
    await checks.sqliteMemory();
  } catch {
    throw new Error(
      'Worker requires working better-sqlite3. Update the Ptah desktop package.',
    );
  }
  const ptahVersion = await checks.ptahVersion();
  // The engine import is deliberately after all inexpensive refusal checks.
  // Operator commands never evaluate the CLI DI graph.
  const { withEngine, CliWebviewManagerAdapter } =
    await import('@ptah-extension/cli-engine');
  const runtime = await import('@ptah-extension/worker-runtime');
  const protocolModule = await import('@ptah-extension/worker-protocol');
  const { PROTOCOL_VERSION, WORKER_CLOSE_CODES, FlatStreamEventSchema } =
    protocolModule;
  const { ClaudeCliDetector, SDK_TOKENS } =
    await import('@ptah-extension/agent-sdk');
  const { CHAT_TOKENS } = await import('@ptah-extension/rpc-handlers');
  const { PLATFORM_TOKENS, listLocalDriverLocks, requestRelease } =
    await import('@ptah-extension/platform-core');
  const { createRemoteSessions } = await import('./remote-sessions');
  const { AdminPairingStatus, createAdminHandler } =
    await import('./admin-handlers');
  const logger = {
    error: (message: string) => process.stderr.write(`${message}\n`),
  };
  // Push events reach the session composition once the engine is up; the
  // engine emits nothing a remote client drives before that.
  let remote: RemoteSessions | undefined;
  const pushAdapter = new CliWebviewManagerAdapter({
    tap: (type, payload) => remote?.tap(type, payload),
    logger,
  });
  await withEngine(
    {},
    {
      mode: 'full',
      thoth: 'off',
      hostProfile: runtime.createWorkerRpcHostProfile(),
      pushAdapter,
      ...(options.bootstrap ? { bootstrap: options.bootstrap } : {}),
    },
    async (engine) => {
      const registry = new runtime.WorkspaceRegistry(options.paths);
      const tokens = new runtime.TokenStore(options.paths);
      const machineId = runtime.workerMachineId();
      const identity = { machineId, displayName: hostname(), ptahVersion };
      const pairingStatus = new AdminPairingStatus();
      const pairing = new runtime.PairingWindow(
        registry,
        machineId,
        undefined,
        pairingStatus.changed,
      );
      // The engine applies a persisted autopilot level to every turn it
      // runs (ConfigRpcHandlers.register, the Codex profile). The worker
      // serves remote turns with manual approval only: it refuses to start
      // on an auto-approving level and re-reads the setting before each turn.
      const requireManualApproval = async (): Promise<void> => {
        const response = await engine.transport.call<
          Record<string, never>,
          ConfigAutopilotGetResult
        >('config:autopilot-get', {});
        if (!response.success || !response.data)
          throw new Error(
            'The worker requires manual approval, and the autopilot setting is unreadable.',
          );
        runtime.assertManualApprovalSettings(response.data);
      };
      await requireManualApproval();
      let adminKey: Buffer;
      try {
        adminKey = await runtime.readAdminKey(options.paths);
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        )
          throw error;
        adminKey = await runtime.createAdminKey(options.paths);
      }
      let readiness: ReadinessReport = { ready: false, checks: [] };
      const detector = new ClaudeCliDetector();
      const readReadiness = async (): Promise<ReadinessReport> => {
        readiness = await runtime.checkWorkerReadiness({
          platform: () => process.platform,
          nodeVersion: checks.nodeVersion,
          sqliteMemory: checks.sqliteMemory,
          ptahVersion: () => ptahVersion,
          listener: () => ({ host: '127.0.0.1', port: options.port }),
          workspaces: () => registry.list(),
          claudeCli: async () => {
            const health = await detector.performHealthCheck();
            return {
              available: health.available,
              detail: health.available
                ? 'Claude CLI is available.'
                : 'Claude CLI is unavailable.',
            };
          },
          authRoute: async () => {
            const response = await engine.transport.call<
              Record<string, never>,
              { ready: boolean; blockers: string[] }
            >('auth:getEffectiveRoute', {});
            if (!response.success || !response.data)
              throw new Error('Effective provider route is unavailable');
            const route = response.data;
            return {
              ready: route.ready,
              detail: route.ready
                ? 'Provider route is ready.'
                : route.blockers.join('; '),
            };
          },
          driverLock: async () => {
            const listings = await listLocalDriverLocks();
            return {
              available: listings.every((item) => item.ok),
              stranded: listings.some(
                (item) =>
                  item.ok &&
                  item.locks.some((lock) => lock.state === 'stranded'),
              ),
            };
          },
        });
        return readiness;
      };
      const container = engine.container;
      const chatHistory = container.resolve<{
        readForResume(sessionId: SessionId): Promise<{ events: unknown[] }>;
      }>(CHAT_TOKENS.HISTORY_READ);
      const history: HistoryReader = {
        readForResume: async (sessionId) => ({
          // Validated here: the baseline record schema rejects anything else.
          events: FlatStreamEventSchema.array().parse(
            (await chatHistory.readForResume(sessionId as SessionId)).events,
          ),
        }),
      };
      const sessions = createRemoteSessions({
        runtime,
        machineId,
        maxActiveTurns: options.maxActiveTurns,
        registry,
        // Called only from method handlers and the push tap, which both run
        // after the service below exists.
        logs: {
          openSession: (sessionId) => service.openSession(sessionId),
          findWriter: (sessionId) => service.findWriter(sessionId),
        },
        rpc: {
          handleMessage: ({ method, params }) =>
            engine.transport.call(method, params),
        },
        history,
        metadata: container.resolve<SessionMetadataReader>(
          SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        ),
        permissions: container.resolve<ISdkPermissionHandler>(
          SDK_TOKENS.SDK_PERMISSION_HANDLER,
        ),
        lock: container.resolve<ISessionDriverLock>(
          PLATFORM_TOKENS.SESSION_DRIVER_LOCK,
        ),
        workspaces: container.resolve<IWorkspaceLifecycleProvider>(
          PLATFORM_TOKENS.WORKSPACE_LIFECYCLE_PROVIDER,
        ),
        providerReady: () =>
          readiness.ready &&
          readiness.checks.every(
            (check) => check.id !== 'provider' || check.status === 'pass',
          ),
        machineInfo: (grant) => ({
          ...identity,
          protocol: PROTOCOL_VERSION,
          grant,
          readiness,
        }),
        revokedCloseCode: WORKER_CLOSE_CODES.REVOKED,
        clientName: (tokenId) =>
          tokens.list().find((item) => item.tokenId === tokenId)?.clientName,
        revokeToken: async (tokenId, callerId) => {
          await tokens.revoke(tokenId);
          // The caller closes itself after its reply; every other live
          // connection of the token closes now.
          service.closeTokenConnections(tokenId, callerId);
        },
        requestRelease,
        log: logger.error,
      });
      const admin = createAdminHandler({
        protocol: protocolModule,
        registry,
        tokens,
        pairing,
        pairingStatus,
        identity,
        readiness: () => readiness,
        locks: async () =>
          (await listLocalDriverLocks()).flatMap((item) =>
            item.ok
              ? item.locks.map((lock) => ({
                  sessionId: lock.sessionId,
                  state: lock.state,
                  label: lock.label,
                  acquiredAt: Date.parse(lock.acquiredAt),
                }))
              : [],
          ),
        connections: {
          closeToken: (tokenId) => service.closeTokenConnections(tokenId),
          refreshGrant: (tokenId, grant) =>
            service.refreshGrant(tokenId, grant),
        },
      });
      const handle = async (
        method: string,
        params: unknown,
        grant: WorkerGrant | null,
        isAdmin: boolean,
        peer?: WorkerPeer,
      ): Promise<unknown> => {
        if (isAdmin) return admin(method, params);
        if (!grant || !peer) throw new Error('Authentication required');
        if (method === 'session.start' || method === 'session.continue') {
          try {
            await requireManualApproval();
          } catch (error) {
            logger.error(
              error instanceof Error
                ? error.message
                : 'Manual approval check failed',
            );
            throw error;
          }
        }
        // A workspace removed from the registry leaves every grant at once.
        const effective: WorkerGrant = {
          ...grant,
          workspaceIds: grant.workspaceIds.filter((id) => registry.has(id)),
        };
        return sessions.handle(method, params, effective, peer);
      };
      const service = new runtime.WorkerService({
        paths: options.paths,
        registry,
        workspacePaths: [],
        argv: options.argv,
        autoApprove: options.autoApprove,
        // A log append failure aborts that session's turn (W7).
        driver: { onAppendFailed: sessions.onAppendFailed },
        // Shutdown order: listener closed, turns drained, logs closed, locks released.
        drainTurns: () => sessions.drain(),
        releaseLocks: () => sessions.releaseLocks(),
        readiness: async () => {
          readiness = await (options.readiness ?? readReadiness)();
          return readiness;
        },
        host: '127.0.0.1',
        port: options.port,
        identity,
        pairing,
        tokens,
        adminKey,
        handle,
        onSigterm: false,
      });
      remote = sessions;
      await service.start();
      try {
        if (service.endpoint) options.onReady?.(service.endpoint);
        await new Promise<void>((resolve) => {
          const done = () => {
            process.off('SIGTERM', done);
            process.off('SIGINT', done);
            options.shutdown?.removeEventListener('abort', done);
            resolve();
          };
          process.once('SIGTERM', done);
          process.once('SIGINT', done);
          options.shutdown?.addEventListener('abort', done, { once: true });
          if (options.shutdown?.aborted) done();
        });
      } finally {
        await service.stop();
      }
    },
  );
}
