import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type { WithEngineOptions } from '@ptah-extension/cli-engine';
import type { WorkerPaths } from '@ptah-extension/worker-runtime';
import type {
  ReadinessReport,
  WorkerGrant,
} from '@ptah-extension/worker-protocol';

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
  const { PROTOCOL_VERSION } = await import('@ptah-extension/worker-protocol');
  const { ClaudeCliDetector } = await import('@ptah-extension/agent-sdk');
  const { resolveEffectiveAuthRoute } =
    await import('@ptah-extension/auth-providers');
  const { listLocalDriverLocks } =
    await import('@ptah-extension/platform-core');
  const logger = {
    error: (message: string) => process.stderr.write(`${message}\n`),
  };
  const pushAdapter = new CliWebviewManagerAdapter({
    tap: () => undefined,
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
    async () => {
      const registry = new runtime.WorkspaceRegistry(options.paths);
      const tokens = new runtime.TokenStore(options.paths);
      const machineId = `machine_${createHash('sha256').update(hostname()).digest('hex').slice(0, 16)}`;
      const identity = { machineId, displayName: hostname(), ptahVersion };
      const pairing = new runtime.PairingWindow(registry, machineId);
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
      let openPairing: { expiresAt: number; attemptsLeft: number } | undefined;
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
            const health = await detector.performHealthCheck();
            const route = resolveEffectiveAuthRoute(
              {
                authMethod: 'claude-cli',
                defaultProvider: null,
                anthropicProviderId: null,
              },
              [
                {
                  id: 'claude-cli',
                  type: 'local-native',
                  status: health.available ? 'connected' : 'missing',
                },
              ],
            );
            return {
              ready: route.ready,
              detail: route.ready
                ? 'Claude CLI route is ready.'
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
      const handle = async (
        method: string,
        params: unknown,
        grant: WorkerGrant | null,
        admin: boolean,
      ): Promise<unknown> => {
        if (!admin) {
          if (!grant || grant.machineId !== machineId)
            throw new Error('Authentication required');
          if (method === 'machine.info')
            return {
              ...identity,
              protocol: PROTOCOL_VERSION,
              grant,
              readiness,
            };
          if (method === 'workspaces.list')
            return registry
              .list()
              .filter((item) => grant.workspaceIds.includes(item.workspaceId));
          throw new Error('Remote session handler composition is unavailable');
        }
        if (method === 'admin.pairing.open') {
          const input = params as {
            ttlSeconds?: number;
            workspaces?: string[];
          };
          const available = registry.list();
          const ids = input.workspaces?.map((value) => {
            const found = available.find(
              (item) => item.workspaceId === value || item.path === value,
            );
            if (!found) throw new Error('Unknown workspace');
            return found.workspaceId;
          });
          const opened = pairing.open(input.ttlSeconds, ids);
          openPairing = { expiresAt: opened.expiresAt, attemptsLeft: 5 };
          return {
            ...opened,
            workspaces: available
              .filter((item) => opened.workspaces.includes(item.workspaceId))
              .map((item) => ({
                workspaceId: item.workspaceId,
                name: item.name,
                path: item.path,
              })),
          };
        }
        if (method === 'admin.grants.list')
          return tokens.list().map((item) => ({
            tokenId: item.tokenId,
            clientName: item.clientName,
            createdAt: Date.parse(item.createdAt),
            lastUsedAt: item.lastUsedAt ? Date.parse(item.lastUsedAt) : null,
            grant: item.grant,
            ...(item.revokedAt
              ? { revokedAt: Date.parse(item.revokedAt) }
              : {}),
          }));
        if (method === 'admin.grants.add') {
          const input = params as { tokenId: string; workspaces: string[] };
          const known = registry.list();
          const ids = input.workspaces.map((value) => {
            const found = known.find(
              (item) => item.workspaceId === value || item.path === value,
            );
            if (!found) throw new Error('Unknown workspace');
            return found.workspaceId;
          });
          const records = tokens.list();
          const record = records.find(
            (item) => item.tokenId === input.tokenId && !item.revokedAt,
          );
          if (!record) throw new Error('Unknown token');
          record.grant.workspaceIds = [
            ...new Set([...record.grant.workspaceIds, ...ids]),
          ];
          const temporary = `${options.paths.tokens}.${process.pid}.tmp`;
          await writeFile(temporary, JSON.stringify(records), { mode: 0o600 });
          await rename(temporary, options.paths.tokens);
          await tokens.load();
          return { tokenId: record.tokenId, grant: record.grant };
        }
        if (method === 'admin.status')
          return {
            ...identity,
            protocol: PROTOCOL_VERSION,
            readiness,
            pairing:
              openPairing && Date.now() < openPairing.expiresAt
                ? { open: true, ...openPairing }
                : { open: false },
            grants: await handle('admin.grants.list', {}, null, true),
            locks: [],
          };
        throw new Error('Unsupported admin method');
      };
      const service = new runtime.WorkerService({
        paths: options.paths,
        registry,
        workspacePaths: [],
        argv: options.argv,
        autoApprove: options.autoApprove,
        driver: { onAppendFailed: async () => undefined },
        releaseLocks: async () => undefined,
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
