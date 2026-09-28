/**
 * `container-diagnostics-override.spec.ts` — the CLI diagnostics wiring.
 *
 * TASK_2026_299 Task 6.5: Phase 2 replaces the Phase 0 `CliDiagnosticsProvider`
 * stub under `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER`.
 *
 * TASK_2026_559 Batch 37b1d (O2 §2 "DI timing", §3, §7.3 "Host wiring"): this
 * host attaches the opt-in `go vet` checker (the lazy `SDK_PROCESS_SPAWNER`
 * getter) and serves the `diagnostics:go-vet-consent-*` RPC through its
 * `goVetDiagnostics` capability, on both the stdio CLI and the TUI. Consent is
 * off until the user grants it.
 *
 * Why `CliDIContainer.setup()` is not called: it is the whole CLI bootstrap
 * (persistence-sqlite, memory-curator, messaging-gateway, voice-providers,
 * licensing), and `with-engine.spec.ts` mocks it for the same reason. So the
 * call site is pinned by reading its source, and the rest runs for real over
 * the REAL `registerPlatformCliServices` and vscode-core registration, plus the
 * workspace storage `container.ts` puts over them (`WorkspaceAwareStateStorage`
 * of `CliStateStorage`, the same construction as its Phase 1).
 */

import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import {
  TOKENS,
  WorkspaceAwareStateStorage,
  WorkspaceContextManager,
  registerVsCodeCorePlatformAgnostic,
  type Logger,
  type RpcHandler,
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
import {
  CliDiagnosticsProvider,
  CliStateStorage,
  registerPlatformCliServices,
} from '@ptah-extension/platform-cli';
import {
  deriveRpcSurface,
  resolveRpcHandlerPlan,
} from '@ptah-extension/rpc-handlers';
import type { DiagnosticsGoVetConsentGetResult } from '@ptah-extension/shared';

import { createCliRpcHostProfile } from './rpc/cli-host-profile';

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

interface HostHarness {
  readonly c: DependencyContainer;
  readonly logger: Logger;
  readonly manager: WorkspaceContextManager;
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

/** The CLI's Phase 0 + the Phase 1 pieces this wiring reads, over `root`. */
function buildHostContainer(userDataPath: string, root: string): HostHarness {
  const c = rootContainer.createChildContainer();
  hostContainers.push(c);
  registerPlatformCliServices(c, {
    appPath: userDataPath,
    userDataPath,
    workspacePath: root,
  });
  const logger = buildLogger();
  c.register(TOKENS.LOGGER, { useValue: logger });
  registerVsCodeCorePlatformAgnostic(c, logger, {
    includeLicensingAndAuth: false,
  });
  // As `container.ts` Phase 1: the workspace-aware store over CliStateStorage,
  // and the FILE_SYSTEM_MANAGER shim workspace-intelligence needs.
  const storage = new WorkspaceAwareStateStorage(
    path.join(userDataPath, 'workspace-storage', 'default'),
    (dir) => new CliStateStorage(dir, 'workspace-state.json'),
  );
  c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, { useValue: storage });
  c.register(TOKENS.FILE_SYSTEM_MANAGER, {
    useValue: c.resolve(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER),
  });
  return {
    c,
    logger,
    manager: new WorkspaceContextManager(userDataPath, storage),
  };
}

describe('CLI Phase 2 — DIAGNOSTICS_PROVIDER override and go vet wiring', () => {
  let tmp: string | undefined;
  let userData: string;
  let root: string;
  let watched: WatchedStreams | undefined;

  beforeEach(() => {
    tmp = undefined;
    watched = watchWriteStreams();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-cli-govet-'));
    userData = path.join(tmp, 'user-data');
    root = path.join(tmp, 'workspace');
    fs.mkdirSync(userData, { recursive: true });
    fs.mkdirSync(root, { recursive: true });
  });

  // The platform output channel opens a log stream under `user-data/logs`,
  // and both its open and its `dispose()` (`end()`) finish asynchronously. So
  // the channel is disposed and every stream settles before the directory
  // goes (removing it earlier fails the pending open); the restore and
  // removal run whatever happens before them.
  afterEach(async () => {
    const seen = watched;
    watched = undefined;
    const disposed = await releaseHost(hostContainers.splice(0), seen, tmp);
    // Each disposed channel's stream was seen, or the wait proved nothing.
    expect(seen?.streams.length ?? 0).toBeGreaterThanOrEqual(disposed);
  });

  it('resolves to the Phase 0 CliDiagnosticsProvider stub before the override runs', () => {
    const { c } = buildHostContainer(userData, root);

    expect(c.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER)).toBeInstanceOf(
      CliDiagnosticsProvider,
    );
  });

  it('container.ts passes the lazy SDK_PROCESS_SPAWNER getter to the one diagnostics registration', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'container.ts'),
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

  it.each([['cli'], ['tui']] as const)(
    '%s enables goVetDiagnostics and serves both consent methods',
    (host) => {
      const profile = createCliRpcHostProfile(host);

      expect(profile.capabilities.goVetDiagnostics).toBe(true);
      expect(deriveRpcSurface(profile).registered).toEqual(
        expect.arrayContaining(CONSENT_METHODS),
      );
      const step = resolveRpcHandlerPlan(profile).find(
        (s) => s.key === 'diagnosticsConsent',
      );
      expect(step?.libOwned).toBe(true);
    },
  );

  it('answers GET with supported:true and consent off for the open workspace', async () => {
    const { c, manager } = buildHostContainer(userData, root);
    const created = await manager.createWorkspace(root);
    expect(created.success).toBe(true);

    const step = resolveRpcHandlerPlan(createCliRpcHostProfile('cli')).find(
      (s) => s.key === 'diagnosticsConsent',
    );
    if (step === undefined) throw new Error('consent handler not planned');
    c.resolve(step.ctor).register();

    const response = await c
      .resolve<RpcHandler>(TOKENS.RPC_HANDLER)
      .handleMessage({
        method: 'diagnostics:go-vet-consent-get',
        params: {},
        correlationId: 'cli-go-vet-get',
      });

    expect(response.success).toBe(true);
    const data = response.data as DiagnosticsGoVetConsentGetResult;
    expect(data.supported).toBe(true);
    expect(data.workspace).toEqual({ root: path.resolve(root) });
    expect(data.state).toBe('off');
  });
});

describe('CLI wiring spec teardown (Batch 38a review r1, R38A-01)', () => {
  it('restores the spy and removes the directory after a stream error and a missing channel', async () => {
    const coreFs = jest.requireActual<typeof fs>('node:fs');
    const original = coreFs.createWriteStream;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-cli-govet-'));
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
