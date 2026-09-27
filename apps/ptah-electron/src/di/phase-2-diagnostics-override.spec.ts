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

/** The real phase 0 + phase 1 container, with `root` as the open folder. */
function buildHostContainer(
  userDataPath: string,
  root: string,
): { c: DependencyContainer; logger: Logger } {
  const c = rootContainer.createChildContainer();
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
  let tmp: string;
  let userData: string;
  let root: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-electron-govet-'));
    userData = path.join(tmp, 'user-data');
    root = path.join(tmp, 'workspace');
    fs.mkdirSync(userData, { recursive: true });
    fs.mkdirSync(root, { recursive: true });
  });
  // No cleanup: phase 0's output channel keeps a log stream open under
  // `user-data/logs`, and removing the directory under it fails that stream
  // after the test (the sibling DI specs leave their OS-temp dirs the same way).

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
