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

/** The CLI's Phase 0 + the Phase 1 pieces this wiring reads, over `root`. */
function buildHostContainer(userDataPath: string, root: string): HostHarness {
  const c = rootContainer.createChildContainer();
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
  let tmp: string;
  let userData: string;
  let root: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-cli-govet-'));
    userData = path.join(tmp, 'user-data');
    root = path.join(tmp, 'workspace');
    fs.mkdirSync(userData, { recursive: true });
    fs.mkdirSync(root, { recursive: true });
  });
  // No cleanup: the platform output channel keeps a log stream open under
  // `user-data/logs`, and removing the directory under it fails that stream
  // after the test.

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
