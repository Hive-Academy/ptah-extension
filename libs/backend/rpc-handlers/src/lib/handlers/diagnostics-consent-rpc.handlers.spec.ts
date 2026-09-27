/**
 * `diagnostics:go-vet-consent-*` handler spec — TASK_2026_559 Batch 37b1c,
 * O2 §3 (GET/SET shapes, check order 1-7), §6 (audit line) and §7.3 handler
 * cases 1-11, plus the Decision 25 `go-changed` staleness.
 *
 * Real stores throughout: `WorkspaceAwareStateStorage` + `WorkspaceContextManager`
 * (vscode-core) register each root the way both hosts do, over a temp
 * user-data directory; the real `GoVetConsentStore`, `resolveGoBinary` and
 * `GoVetChecker` (workspace-intelligence) judge the record. The per-root
 * delegate is `JsonFileStateStorage` below: a line-for-line copy of the CLI
 * host's `CliStateStorage` (`platform-cli`), which this `scope:extension`
 * library may not import (eslint `@nx/enforce-module-boundaries`).
 *
 * A fake Go toolchain is a plain file named `go.exe` (win32) / `go` (POSIX,
 * mode 755) in a temp PATH directory: the resolver only stats it; nothing is
 * ever executed.
 */

// The workspace-intelligence barrel reaches its tree-sitter loader, whose
// `wasm-bundle-dir` reads `import.meta.url` (unparseable under CommonJS
// ts-jest). This spec never parses, so the module is replaced by a stub; the
// go vet store, resolver and checker below are the real ones.
jest.mock('../../../../workspace-intelligence/src/ast/wasm-bundle-dir', () => ({
  BUNDLE_DIR: '',
  resolveWasmPath: (filename: string) => filename,
}));

import 'reflect-metadata';

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  WorkspaceAwareStateStorage,
  WorkspaceContextManager,
} from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import type {
  IPlatformInfo,
  IStateStorage,
  IWorkspaceLifecycleProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  GO_VET_CONSENT_KEY,
  GoVetChecker,
  GoVetConsentStore,
} from '@ptah-extension/workspace-intelligence';
import type {
  DiagnosticsGoVetConsentGetResult,
  DiagnosticsGoVetConsentSetResult,
} from '@ptah-extension/shared';

import { DiagnosticsConsentRpcHandlers } from './diagnostics-consent-rpc.handlers';
import { capabilities } from '../host-profile/host-profile';

/** `CliStateStorage` semantics: JSON file, atomic rename, `undefined` deletes. */
class JsonFileStateStorage implements IStateStorage {
  private data: Record<string, unknown> = {};
  private readonly filePath: string;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(storageDirPath: string, filename: string) {
    this.filePath = path.join(storageDirPath, filename);
    try {
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch (error: unknown) {
      void error;
      this.data = {};
    }
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.data[key];
    return value !== undefined ? (value as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    this.writePromise = this.writePromise.then(
      () => this.persist(),
      () => this.persist(),
    );
    await this.writePromise;
  }

  keys(): readonly string[] {
    return Object.keys(this.data);
  }

  private async persist(): Promise<void> {
    await fsPromises.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fsPromises.writeFile(tmpPath, JSON.stringify(this.data), 'utf-8');
    await fsPromises.rename(tmpPath, this.filePath);
  }
}

const GO_NAME = process.platform === 'win32' ? 'go.exe' : 'go';
const GET = 'diagnostics:go-vet-consent-get';
const SET = 'diagnostics:go-vet-consent-set';

interface Harness {
  readonly rpc: MockRpcHandler;
  readonly logger: MockLogger;
  readonly storage: WorkspaceAwareStateStorage;
}

describe('DiagnosticsConsentRpcHandlers (go vet consent)', () => {
  let tmp: string;
  let userData: string;
  let rootA: string;
  let rootB: string;
  let binDir: string;
  let emptyBinDir: string;
  let goBinary: string;
  let encoded: Map<string, string>;
  let active: string | undefined;
  let savedPath: string | undefined;

  const lifecycle = {
    getActiveFolder: () => active,
  } as unknown as IWorkspaceLifecycleProvider;
  const workspaceProvider = {
    getWorkspaceRoot: () => undefined,
  } as unknown as IWorkspaceProvider;

  /** A host over `userData`: storage, registered roots, handler. */
  async function buildHost(storageOverride?: IStateStorage): Promise<Harness> {
    const storage = new WorkspaceAwareStateStorage(
      path.join(userData, 'workspace-storage', 'default'),
      (dir) => new JsonFileStateStorage(dir, 'workspace-state.json'),
    );
    const manager = new WorkspaceContextManager(userData, storage);
    encoded = new Map();
    for (const root of [rootA, rootB]) {
      const created = await manager.createWorkspace(root);
      if (!created.success) throw new Error('fixture root not registered');
      encoded.set(root, created.encodedPath);
    }
    const rpc = createMockRpcHandler();
    const logger = createMockLogger();
    new DiagnosticsConsentRpcHandlers(
      logger as unknown as Logger,
      rpc as unknown as RpcHandler,
      workspaceProvider,
      lifecycle,
      storageOverride ?? storage,
      { globalStoragePath: userData } as unknown as IPlatformInfo,
    ).register();
    return { rpc, logger, storage };
  }

  async function get(h: Harness): Promise<DiagnosticsGoVetConsentGetResult> {
    const response = await h.rpc.handleMessage({
      method: GET,
      params: {},
      correlationId: 'get',
    });
    expect(response.success).toBe(true);
    return response.data as DiagnosticsGoVetConsentGetResult;
  }

  async function set(
    h: Harness,
    params: unknown,
  ): Promise<DiagnosticsGoVetConsentSetResult> {
    const response = await h.rpc.handleMessage({
      method: SET,
      params,
      correlationId: 'set',
    });
    expect(response.success).toBe(true);
    return response.data as DiagnosticsGoVetConsentSetResult;
  }

  const grant = (workspaceRoot: string) => ({
    enabled: true,
    workspaceRoot,
    source: 'settings-ui',
  });
  const revoke = (workspaceRoot: string) => ({
    enabled: false,
    workspaceRoot,
    source: 'cli',
  });

  /** The consent record as it sits on disk for `root`, or `undefined`. */
  function onDisk(root: string): unknown {
    const file = path.join(
      userData,
      'workspace-storage',
      encoded.get(root) ?? 'missing',
      'workspace-state.json',
    );
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf-8'))[GO_VET_CONSENT_KEY];
  }

  /** Every file under the user-data dir or a root that mentions the key. */
  function filesHoldingConsent(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (fs.readFileSync(full, 'utf-8').includes('goVet')) {
          found.push(full);
        }
      }
    };
    walk(userData);
    walk(rootA);
    walk(rootB);
    return found;
  }

  function auditLines(logger: MockLogger): unknown[][] {
    return logger.info.mock.calls.filter(
      (call: unknown[]) => call[0] === '[Diagnostics] go vet consent changed',
    );
  }

  beforeEach(() => {
    tmp = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-go-vet-consent-')),
    );
    userData = path.join(tmp, 'user-data');
    rootA = path.join(tmp, 'ws-a');
    rootB = path.join(tmp, 'ws-b');
    binDir = path.join(tmp, 'toolchain', 'bin');
    emptyBinDir = path.join(tmp, 'empty-bin');
    for (const dir of [userData, rootA, rootB, binDir, emptyBinDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    goBinary = path.join(binDir, GO_NAME);
    fs.writeFileSync(goBinary, 'not a real toolchain');
    fs.chmodSync(goBinary, 0o755);
    active = rootA;
    savedPath = process.env['PATH'];
    process.env['PATH'] = binDir;
  });

  afterEach(() => {
    process.env['PATH'] = savedPath;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('1. a grant lands in the root’s own workspace-state.json only (no global or settings key)', async () => {
    const h = await buildHost();

    expect(await set(h, grant(rootA))).toEqual({ success: true, state: 'on' });

    expect(onDisk(rootA)).toMatchObject({
      v: 1,
      rootRealpath: rootA,
      goBinary: { path: goBinary },
    });
    expect(filesHoldingConsent()).toEqual([
      path.join(
        userData,
        'workspace-storage',
        encoded.get(rootA) as string,
        'workspace-state.json',
      ),
    ]);
    expect(await get(h)).toEqual({
      supported: true,
      workspace: { root: rootA },
      state: 'on',
      goBinary,
    });
    const [audit] = auditLines(h.logger);
    expect(audit[1]).toEqual({
      workspaceHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      enabled: true,
      source: 'settings-ui',
    });
    expect(JSON.stringify(h.logger.info.mock.calls)).not.toContain(
      JSON.stringify(tmp).slice(1, -1),
    );
  });

  it('2. a restarted host over the same user-data directory reads the grant back', async () => {
    await set(await buildHost(), grant(rootA));

    const restarted = await buildHost();

    expect((await get(restarted)).state).toBe('on');
  });

  it('3. consent is per root: A on, B off; revoking B leaves A on', async () => {
    const h = await buildHost();
    await set(h, grant(rootA));

    active = rootB;
    expect(await get(h)).toMatchObject({
      workspace: { root: rootB },
      state: 'off',
    });
    expect(await set(h, revoke(rootB))).toEqual({
      success: true,
      state: 'off',
    });

    active = rootA;
    expect((await get(h)).state).toBe('on');
    expect(onDisk(rootA)).toBeDefined();
  });

  it('4. revoke deletes the key, GET answers off, and the next checker run spawns nothing', async () => {
    const h = await buildHost();
    const goFile = path.join(rootA, 'main.go');
    fs.writeFileSync(
      path.join(rootA, 'go.mod'),
      'module example.com/a\n\ngo 1.21\n',
    );
    fs.writeFileSync(goFile, 'package main\n\nfunc main() {}\n');
    const getSpawner = jest.fn(() => {
      throw new Error('spawn stage reached');
    });
    const checker = new GoVetChecker({
      consentStore: new GoVetConsentStore(h.storage, {
        userDataPath: userData,
      }),
      getSpawner,
      userDataPath: userData,
      logger: createMockLogger(),
      env: () => ({ PATH: binDir }),
    });
    await set(h, grant(rootA));

    // With consent the run gets as far as the spawner.
    const before = await checker.check({
      workspaceRoot: rootA,
      files: [goFile],
    });
    expect(before.reason).toBe('no-spawner');
    expect(getSpawner).toHaveBeenCalledTimes(1);

    expect(await set(h, revoke(rootA))).toEqual({
      success: true,
      state: 'off',
    });
    expect(onDisk(rootA)).toBeUndefined();
    expect(h.storage.getStorageForWorkspace(rootA)?.keys()).not.toContain(
      GO_VET_CONSENT_KEY,
    );
    expect((await get(h)).state).toBe('off');

    const after = await checker.check({
      workspaceRoot: rootA,
      files: [goFile],
    });
    expect(after.reason).toBe('no-consent');
    expect(getSpawner).toHaveBeenCalledTimes(1);

    // Revoke is idempotent.
    expect(await set(h, revoke(rootA))).toEqual({
      success: true,
      state: 'off',
    });
  });

  it('5. no active or registered root: GET has no workspace, SET is no-workspace and writes nothing', async () => {
    const h = await buildHost();

    active = undefined;
    expect(await get(h)).toEqual({
      supported: true,
      workspace: null,
      state: 'off',
    });
    expect(await set(h, grant(rootA))).toEqual({
      success: false,
      error: 'no-workspace',
    });

    const unregistered = path.join(tmp, 'ws-c');
    fs.mkdirSync(unregistered);
    active = unregistered;
    expect((await get(h)).workspace).toBeNull();
    expect(await set(h, grant(unregistered))).toEqual({
      success: false,
      error: 'no-workspace',
    });
    expect(filesHoldingConsent()).toEqual([]);
  });

  it('6. storage that is not workspace-scoped: GET unsupported, SET unsupported; the capability is off by default', async () => {
    const plain = new JsonFileStateStorage(
      path.join(userData, 'plain'),
      'state.json',
    );
    const h = await buildHost(plain);

    expect(await get(h)).toEqual({
      supported: false,
      workspace: null,
      state: 'off',
    });
    expect(await set(h, grant(rootA))).toEqual({
      success: false,
      error: 'unsupported',
    });
    expect(plain.keys()).toEqual([]);
    expect(capabilities({}).goVetDiagnostics).toBe(false);
  });

  it.each([
    ['an extra key', { ...grant('x'), extra: 1 }],
    [
      'a non-boolean enabled',
      { enabled: 'yes', workspaceRoot: 'x', source: 'cli' },
    ],
    ['a missing workspaceRoot', { enabled: true, source: 'cli' }],
    ['an unknown source', { enabled: true, workspaceRoot: 'x', source: 'mcp' }],
    ['no params', undefined],
  ])('7. %s is invalid-params and writes nothing', async (_label, params) => {
    const h = await buildHost();
    const withRoot =
      params && typeof params === 'object' && 'workspaceRoot' in params
        ? { ...params, workspaceRoot: rootA }
        : params;

    expect(await set(h, withRoot)).toEqual({
      success: false,
      error: 'invalid-params',
    });
    expect(filesHoldingConsent()).toEqual([]);
  });

  it('7. GET rejects unknown keys with a fixed code', async () => {
    const h = await buildHost();
    const response = await h.rpc.handleMessage({
      method: GET,
      params: { root: rootA },
      correlationId: 'get-bad',
    });
    expect(response).toMatchObject({ success: false, error: 'invalid-params' });
  });

  it('8. a throwing write is persist-failed, with no audit line and no error text logged', async () => {
    const h = await buildHost();
    const rootStorage = h.storage.getStorageForWorkspace(
      rootA,
    ) as IStateStorage;
    jest
      .spyOn(rootStorage, 'update')
      .mockRejectedValue(new Error(`disk full at ${rootA}`));

    expect(await set(h, grant(rootA))).toEqual({
      success: false,
      error: 'persist-failed',
    });
    expect(auditLines(h.logger)).toEqual([]);
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain('disk full');
  });

  it('8. a read-back that disagrees is persist-failed for grant and for revoke', async () => {
    const h = await buildHost();
    const rootStorage = h.storage.getStorageForWorkspace(
      rootA,
    ) as IStateStorage;
    const swallow = jest
      .spyOn(rootStorage, 'update')
      .mockResolvedValue(undefined);

    expect(await set(h, grant(rootA))).toEqual({
      success: false,
      error: 'persist-failed',
    });

    swallow.mockRestore();
    await set(h, grant(rootA));
    h.logger.info.mockClear();
    jest.spyOn(rootStorage, 'update').mockResolvedValue(undefined);

    expect(await set(h, revoke(rootA))).toEqual({
      success: false,
      error: 'persist-failed',
    });
    expect(onDisk(rootA)).toBeDefined();
    expect(auditLines(h.logger)).toEqual([]);
  });

  it('9. stale UI: the active root changed to B or to none after GET on A → refused, nothing changed', async () => {
    const h = await buildHost();
    expect((await get(h)).workspace).toEqual({ root: rootA });

    active = rootB;
    expect(await set(h, grant(rootA))).toEqual({
      success: false,
      error: 'workspace-changed',
    });
    expect(filesHoldingConsent()).toEqual([]);

    active = undefined;
    expect(await set(h, grant(rootA))).toEqual({
      success: false,
      error: 'no-workspace',
    });

    // Same for revoke: A's grant survives a revoke aimed at a stale view.
    active = rootA;
    await set(h, grant(rootA));
    active = rootB;
    expect(await set(h, revoke(rootA))).toEqual({
      success: false,
      error: 'workspace-changed',
    });
    active = undefined;
    expect(await set(h, revoke(rootA))).toEqual({
      success: false,
      error: 'no-workspace',
    });
    expect(onDisk(rootA)).toBeDefined();
    expect(onDisk(rootB)).toBeUndefined();
  });

  it('10. the caller value is never a write target: a registered non-active root or an unregistered path is workspace-changed', async () => {
    const h = await buildHost();

    expect(await set(h, grant(rootB))).toEqual({
      success: false,
      error: 'workspace-changed',
    });
    expect(await set(h, grant(path.join(tmp, 'elsewhere')))).toEqual({
      success: false,
      error: 'workspace-changed',
    });
    expect(filesHoldingConsent()).toEqual([]);
  });

  it('11. no Go binary on PATH → no-go-binary, nothing written', async () => {
    const h = await buildHost();
    process.env['PATH'] = emptyBinDir;

    expect(await set(h, grant(rootA))).toEqual({
      success: false,
      error: 'no-go-binary',
    });
    expect(await get(h)).toEqual({
      supported: true,
      workspace: { root: rootA },
      state: 'off',
    });
    expect(filesHoldingConsent()).toEqual([]);
  });

  it('Decision 25: a changed Go binary makes the consent stale/go-changed until re-enabled', async () => {
    const h = await buildHost();
    await set(h, grant(rootA));

    fs.appendFileSync(goBinary, ' upgraded');

    expect(await get(h)).toEqual({
      supported: true,
      workspace: { root: rootA },
      state: 'stale',
      staleReason: 'go-changed',
      goBinary,
    });
    expect(await set(h, grant(rootA))).toEqual({ success: true, state: 'on' });
    expect((await get(h)).state).toBe('on');
  });

  (process.platform === 'win32' ? it : it.skip)(
    'win32: the displayed root matches the active root case-insensitively',
    async () => {
      const h = await buildHost();

      expect(await set(h, grant(rootA.toUpperCase()))).toEqual({
        success: true,
        state: 'on',
      });
    },
  );
});
