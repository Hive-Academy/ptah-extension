/**
 * `phase-2-diagnostics-override.spec.ts` — the Electron diagnostics wiring.
 *
 * TASK_2026_299 Task 6.5: Phase 2 replaces the Phase 0
 * `ElectronDiagnosticsProvider` stub under `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER`.
 *
 * TASK_2026_559 Batch 37b1d (O2 §2 "DI timing", §3, §7.3 "Host wiring"): this
 * host attaches the opt-in `go vet` checker (the lazy `SDK_PROCESS_SPAWNER`
 * getter) and serves the `diagnostics:go-vet-consent-*` RPC through its
 * `goVetDiagnostics` capability. Consent is off until the user grants it.
 *
 * Why `registerPhase2Libraries` is not called: it transitively imports
 * `persistence-sqlite` (better-sqlite3), `memory-curator`, `messaging-gateway`
 * and more, and `require('./phase-2-libraries')` throws at module evaluation
 * under Jest (`container.smoke.spec.ts` works around the same constraint). So
 * the call site is pinned by reading its source, and the rest runs for real
 * against the REAL phase 0 + phase 1 container: the host's `PLATFORM_INFO`,
 * `WorkspaceAwareStateStorage`, `RpcHandler` and workspace provider.
 */

import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import {
  TOKENS,
  type Logger,
  type RpcHandler,
  type WorkspaceContextManager,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IOutputChannel,
  type IProcessSpawner,
} from '@ptah-extension/platform-core';
import {
  LanguageAwareDiagnosticsProvider,
  registerTypeScriptDiagnosticsProvider,
  registerWorkspaceIntelligenceServices,
} from '@ptah-extension/workspace-intelligence';
import { ElectronDiagnosticsProvider } from '@ptah-extension/platform-electron';
import {
  deriveRpcSurface,
  resolveRpcHandlerPlan,
} from '@ptah-extension/rpc-handlers';
import type { DiagnosticsGoVetConsentGetResult } from '@ptah-extension/shared';

import { registerPhase0Platform } from './phase-0-platform';
import { registerPhase1Infra } from './phase-1-infra';
import { createElectronRpcHostProfile } from '../rpc-host-profile';

const CONSENT_METHODS = [
  'diagnostics:go-vet-consent-get',
  'diagnostics:go-vet-consent-set',
];

function buildLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Logger;
}

/** Every host container a test built; teardown disposes its output channel. */
const hostContainers: DependencyContainer[] = [];

/** File streams opened through the core `fs` since `watchWriteStreams()`. */
interface WatchedStreams {
  readonly streams: fs.WriteStream[];
  readonly spy: jest.SpyInstance;
}

/**
 * Record every write stream opened from now on (the output channel's log
 * stream). The spy sits on the core module itself: an `import * as`
 * namespace is not spyable, and the channel's own namespace reads through
 * to this object.
 */
function watchWriteStreams(): WatchedStreams {
  const streams: fs.WriteStream[] = [];
  const coreFs = jest.requireActual<typeof fs>('node:fs');
  const createWriteStream = coreFs.createWriteStream;
  const spy = jest
    .spyOn(coreFs, 'createWriteStream')
    .mockImplementation((...args: Parameters<typeof createWriteStream>) => {
      const stream = createWriteStream(...args);
      streams.push(stream);
      return stream;
    });
  return { streams, spy };
}

/**
 * Resolves once `stream` has closed, or failed (an async open or write
 * error); never rejects, and never waits on a stream already closed. The
 * `error` listener also keeps a late failure from escaping as unhandled.
 */
function streamSettled(stream: fs.WriteStream): Promise<void> {
  if (stream.closed) return Promise.resolve();
  return new Promise<void>((resolve) => {
    stream.once('close', () => resolve());
    stream.once('error', () => resolve());
  });
}

/**
 * Dispose each container's output channel, wait for every watched stream to
 * settle, then ALWAYS restore the spy and remove `dir`, however the steps
 * before went. A container whose channel cannot be resolved or disposed (a
 * partial setup) is skipped. Returns how many channels were disposed.
 */
async function releaseHost(
  containers: readonly DependencyContainer[],
  watched: WatchedStreams | undefined,
  dir: string | undefined,
): Promise<number> {
  let disposed = 0;
  try {
    for (const c of containers) {
      try {
        c.resolve<IOutputChannel>(PLATFORM_TOKENS.OUTPUT_CHANNEL).dispose();
        disposed++;
      } catch (error: unknown) {
        // Tolerated: a partial setup may not have registered the channel;
        // the spy restore and removal below still run.
        void error;
      }
    }
    await Promise.all((watched?.streams ?? []).map(streamSettled));
  } finally {
    watched?.spy.mockRestore();
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
  }
  return disposed;
}

/** The real phase 0 + phase 1 container, with `root` as the open folder. */
function buildHostContainer(
  userDataPath: string,
  root: string,
): { c: DependencyContainer; logger: Logger } {
  const c = rootContainer.createChildContainer();
  hostContainers.push(c);
  const options = {
    appPath: userDataPath,
    userDataPath,
    logsPath: path.join(userDataPath, 'logs'),
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
    dialog: {} as never,
    getWindow: () => null,
    initialFolders: [root],
  };
  const { logger } = registerPhase0Platform(c, options);
  registerPhase1Infra(c, options, logger);
  return { c, logger };
}

describe('Electron Phase 2 — DIAGNOSTICS_PROVIDER override and go vet wiring', () => {
  let tmp: string | undefined;
  let userData: string;
  let root: string;
  let watched: WatchedStreams | undefined;

  beforeEach(() => {
    tmp = undefined;
    watched = watchWriteStreams();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-electron-govet-'));
    userData = path.join(tmp, 'user-data');
    root = path.join(tmp, 'workspace');
    fs.mkdirSync(userData, { recursive: true });
    fs.mkdirSync(root, { recursive: true });
  });

  // Phase 0's output channel opens a log stream under `user-data/logs`, and
  // both its open and its `dispose()` (`end()`) finish asynchronously. So the
  // channel is disposed and every stream settles before the directory goes
  // (removing it earlier fails the pending open); the restore and removal
  // run whatever happens before them.
  afterEach(async () => {
    const seen = watched;
    watched = undefined;
    const disposed = await releaseHost(hostContainers.splice(0), seen, tmp);
    // Each disposed channel's stream was seen, or the wait proved nothing.
    expect(seen?.streams.length ?? 0).toBeGreaterThanOrEqual(disposed);
  });

  it('resolves to the Phase 0 ElectronDiagnosticsProvider stub before the override runs', () => {
    const { c } = buildHostContainer(userData, root);

    const resolved = c.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER);

    expect(resolved).toBeInstanceOf(ElectronDiagnosticsProvider);
  });

  it('phase-2-libraries passes the lazy SDK_PROCESS_SPAWNER getter to the one diagnostics registration', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'phase-2-libraries.ts'),
      'utf8',
    );

    const calls = source.match(/registerTypeScriptDiagnosticsProvider\(/g);
    expect(calls).toHaveLength(1);
    expect(source).toMatch(
      /registerTypeScriptDiagnosticsProvider\(container, logger, \{\s*getProcessSpawner: \(\) =>\s*container\.resolve<IProcessSpawner>\(SDK_TOKENS\.SDK_PROCESS_SPAWNER\),?\s*\}\);/,
    );
  });

  it('attaches go vet over the host storage without reading the spawner at registration', () => {
    const { c } = buildHostContainer(userData, root);
    const logger = buildLogger();
    const getProcessSpawner = jest.fn<IProcessSpawner, []>(() => {
      throw new Error('the spawner is read at the first run, not here');
    });

    registerWorkspaceIntelligenceServices(c, logger);
    registerTypeScriptDiagnosticsProvider(c, logger, { getProcessSpawner });

    expect(c.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER)).toBeInstanceOf(
      LanguageAwareDiagnosticsProvider,
    );
    expect(getProcessSpawner).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('opt-in go vet'),
    );
  });

  it('enables goVetDiagnostics and serves both consent methods', () => {
    const profile = createElectronRpcHostProfile(
      rootContainer.createChildContainer(),
      buildLogger(),
    );

    expect(profile.capabilities.goVetDiagnostics).toBe(true);
    expect(deriveRpcSurface(profile).registered).toEqual(
      expect.arrayContaining(CONSENT_METHODS),
    );
    const step = resolveRpcHandlerPlan(profile).find(
      (s) => s.key === 'diagnosticsConsent',
    );
    expect(step?.libOwned).toBe(true);
  });

  it('answers GET with supported:true and consent off for the open workspace', async () => {
    const { c, logger } = buildHostContainer(userData, root);
    const manager = c.resolve<WorkspaceContextManager>(
      TOKENS.WORKSPACE_CONTEXT_MANAGER,
    );
    const created = await manager.createWorkspace(root);
    expect(created.success).toBe(true);

    const profile = createElectronRpcHostProfile(c, logger);
    const step = resolveRpcHandlerPlan(profile).find(
      (s) => s.key === 'diagnosticsConsent',
    );
    if (step === undefined) throw new Error('consent handler not planned');
    c.resolve(step.ctor).register();

    const response = await c
      .resolve<RpcHandler>(TOKENS.RPC_HANDLER)
      .handleMessage({
        method: 'diagnostics:go-vet-consent-get',
        params: {},
        correlationId: 'electron-go-vet-get',
      });

    expect(response.success).toBe(true);
    const data = response.data as DiagnosticsGoVetConsentGetResult;
    expect(data.supported).toBe(true);
    expect(data.workspace).toEqual({ root: path.resolve(root) });
    expect(data.state).toBe('off');
  });
});

describe('Electron wiring spec teardown (Batch 38a review r1, R38A-01)', () => {
  it('restores the spy and removes the directory after a stream error and a missing channel', async () => {
    const coreFs = jest.requireActual<typeof fs>('node:fs');
    const original = coreFs.createWriteStream;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-electron-govet-'));
    const watched = watchWriteStreams();
    // Its open fails asynchronously (ENOENT): the stream's error path.
    const failing = coreFs.createWriteStream(
      path.join(dir, 'missing', 'x.log'),
    );
    const failed = new Promise<unknown>((resolve) =>
      failing.once('error', resolve),
    );
    // A partial setup: this container never registered the output channel.
    const partial = rootContainer.createChildContainer();

    const disposed = await releaseHost([partial], watched, dir);

    await expect(failed).resolves.toMatchObject({ code: 'ENOENT' });
    expect(disposed).toBe(0);
    expect(watched.streams).toEqual([failing]);
    expect(coreFs.createWriteStream).toBe(original);
    expect(fs.existsSync(dir)).toBe(false);
  });
});
