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

import { createHash } from 'crypto';
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
  GO_VET_CONSENT_DIR,
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

  /** An enabling SET carrying `confirmToken` (from a GET the caller showed). */
  const grant = (workspaceRoot: string, confirmToken?: string) => ({
    enabled: true,
    workspaceRoot,
    ...(confirmToken !== undefined ? { confirmToken } : {}),
    source: 'settings-ui',
  });
  const revoke = (workspaceRoot: string) => ({
    enabled: false,
    workspaceRoot,
    source: 'cli',
  });

  /** GET, then an enabling SET with exactly the root and token it showed. */
  async function enable(
    h: Harness,
    workspaceRoot?: string,
  ): Promise<DiagnosticsGoVetConsentSetResult> {
    const shown = await get(h);
    return set(
      h,
      grant(
        workspaceRoot ?? shown.workspace?.root ?? 'none',
        shown.confirmToken,
      ),
    );
  }

  /** The consent record file of `root` (the store's naming, pinned here). */
  function recordFile(root: string): string {
    const key =
      process.platform === 'win32'
        ? path.resolve(root).toLowerCase()
        : path.resolve(root);
    return path.join(
      userData,
      GO_VET_CONSENT_DIR,
      `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`,
    );
  }

  /** The consent record as it sits on disk for `root`, or `undefined`. */
  function onDisk(root: string): unknown {
    const file = recordFile(root);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  }

  /** Every file under the user-data dir or a root holding a consent record. */
  function filesHoldingConsent(): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (fs.readFileSync(full, 'utf-8').includes('rootRealpath')) {
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

  /** A checker over `h`'s storage whose spawner getter marks the spawn stage. */
  function checkerFor(h: Harness): {
    checker: GoVetChecker;
    getSpawner: jest.Mock;
    goFile: string;
  } {
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
    return { checker, getSpawner, goFile };
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
    jest.restoreAllMocks();
    process.env['PATH'] = savedPath;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('1. a grant lands in the root’s own record file under the user-data dir only (no workspace-state, global or settings key)', async () => {
    const h = await buildHost();

    expect(await enable(h)).toEqual({
      success: true,
      state: 'on',
      goBinary,
    });

    expect(onDisk(rootA)).toMatchObject({
      v: 1,
      rootRealpath: rootA,
      goBinary: { path: goBinary },
    });
    expect(filesHoldingConsent()).toEqual([recordFile(rootA)]);
    expect(await get(h)).toEqual({
      supported: true,
      workspace: { root: rootA },
      state: 'on',
      goBinary,
      confirmToken: expect.stringMatching(/^[0-9a-f]{24}\.[0-9a-f]{24}$/),
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
    await enable(await buildHost());

    const restarted = await buildHost();

    expect((await get(restarted)).state).toBe('on');
  });

  it('3. consent is per root: A on, B off; revoking B leaves A on', async () => {
    const h = await buildHost();
    await enable(h);

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

  it('4. revoke deletes the record, GET answers off, and the next checker run spawns nothing', async () => {
    const h = await buildHost();
    const { checker, getSpawner, goFile } = checkerFor(h);
    await enable(h);

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

  it('closing review 1: a revoke by another host process ends consent for a host that is still running, and its later unrelated writes never restore it', async () => {
    const running = await buildHost();
    const { checker, getSpawner, goFile } = checkerFor(running);
    await enable(running);
    expect(
      (await checker.check({ workspaceRoot: rootA, files: [goFile] })).reason,
    ).toBe('no-spawner');

    // A second CLI invocation over the same user-data directory revokes.
    const other = await buildHost();
    expect(await set(other, revoke(rootA))).toEqual({
      success: true,
      state: 'off',
    });

    // The running host sees it at its next decision.
    expect((await get(running)).state).toBe('off');
    const next = await checker.check({ workspaceRoot: rootA, files: [goFile] });
    expect(next.reason).toBe('no-consent');
    expect(getSpawner).toHaveBeenCalledTimes(1);

    // An unrelated state write from the running host re-persists nothing.
    await (
      running.storage.getStorageForWorkspace(rootA) as IStateStorage
    ).update('some.other.key', 1);
    expect(onDisk(rootA)).toBeUndefined();
    expect((await get(running)).state).toBe('off');
  });

  it('5. no active or registered root: GET has no workspace, SET is no-workspace and writes nothing', async () => {
    const h = await buildHost();

    active = undefined;
    expect(await get(h)).toEqual({
      supported: true,
      workspace: null,
      state: 'off',
    });
    expect(await set(h, grant(rootA, 'a.b'))).toEqual({
      success: false,
      error: 'no-workspace',
    });

    const unregistered = path.join(tmp, 'ws-c');
    fs.mkdirSync(unregistered);
    active = unregistered;
    expect((await get(h)).workspace).toBeNull();
    expect(await set(h, grant(unregistered, 'a.b'))).toEqual({
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
    expect(await set(h, grant(rootA, 'a.b'))).toEqual({
      success: false,
      error: 'unsupported',
    });
    expect(plain.keys()).toEqual([]);
    expect(filesHoldingConsent()).toEqual([]);
    expect(capabilities({}).goVetDiagnostics).toBe(false);
  });

  it.each([
    ['an extra key', { ...grant('x', 'a.b'), extra: 1 }],
    [
      'a non-boolean enabled',
      { enabled: 'yes', workspaceRoot: 'x', source: 'cli' },
    ],
    ['a missing workspaceRoot', { enabled: true, source: 'cli' }],
    [
      'an unknown source',
      { enabled: true, workspaceRoot: 'x', confirmToken: 'a.b', source: 'mcp' },
    ],
    ['an enable without a confirmToken', grant('x')],
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

  it('8 / closing review 2: a grant whose durable write really fails is persist-failed and never effective (GET off, checker never spawns)', async () => {
    const h = await buildHost();
    const { checker, getSpawner, goFile } = checkerFor(h);
    // A file where the record directory must go: the write fails on disk.
    fs.writeFileSync(path.join(userData, GO_VET_CONSENT_DIR), 'blocker');

    expect(await enable(h)).toEqual({
      success: false,
      error: 'persist-failed',
    });

    expect((await get(h)).state).toBe('off');
    const result = await checker.check({
      workspaceRoot: rootA,
      files: [goFile],
    });
    expect(result.reason).toBe('no-consent');
    expect(getSpawner).not.toHaveBeenCalled();
    expect(auditLines(h.logger)).toEqual([]);
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain(
      JSON.stringify(tmp).slice(1, -1),
    );
  });

  it('8. a read-back that disagrees is persist-failed for grant and for revoke', async () => {
    const h = await buildHost();
    const swallow = jest
      .spyOn(GoVetConsentStore.prototype, 'grant')
      .mockResolvedValue(undefined);

    expect(await enable(h)).toEqual({
      success: false,
      error: 'persist-failed',
    });

    swallow.mockRestore();
    await enable(h);
    h.logger.info.mockClear();
    jest
      .spyOn(GoVetConsentStore.prototype, 'revoke')
      .mockResolvedValue(undefined);

    expect(await set(h, revoke(rootA))).toEqual({
      success: false,
      error: 'persist-failed',
    });
    expect(onDisk(rootA)).toBeDefined();
    expect(auditLines(h.logger)).toEqual([]);
  });

  it('9. stale UI: the active root changed to B or to none after GET on A → refused, nothing changed', async () => {
    const h = await buildHost();
    const shown = await get(h);
    expect(shown.workspace).toEqual({ root: rootA });

    active = rootB;
    expect(await set(h, grant(rootA, shown.confirmToken))).toEqual({
      success: false,
      error: 'workspace-changed',
    });
    expect(filesHoldingConsent()).toEqual([]);

    active = undefined;
    expect(await set(h, grant(rootA, shown.confirmToken))).toEqual({
      success: false,
      error: 'no-workspace',
    });

    // Same for revoke: A's grant survives a revoke aimed at a stale view.
    active = rootA;
    await enable(h);
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
    const token = (await get(h)).confirmToken;

    expect(await set(h, grant(rootB, token))).toEqual({
      success: false,
      error: 'workspace-changed',
    });
    expect(await set(h, grant(path.join(tmp, 'elsewhere'), token))).toEqual({
      success: false,
      error: 'workspace-changed',
    });
    expect(filesHoldingConsent()).toEqual([]);
  });

  it('11. no Go binary on PATH → no-go-binary, nothing written', async () => {
    const h = await buildHost();
    const token = (await get(h)).confirmToken;
    process.env['PATH'] = emptyBinDir;

    expect(await set(h, grant(rootA, token))).toEqual({
      success: false,
      error: 'no-go-binary',
    });
    expect(await get(h)).toEqual({
      supported: true,
      workspace: { root: rootA },
      state: 'off',
      confirmToken: expect.any(String),
    });
    expect(filesHoldingConsent()).toEqual([]);
  });

  it('Decision 25: a changed Go binary makes the consent stale/go-changed until re-enabled', async () => {
    const h = await buildHost();
    await enable(h);

    fs.appendFileSync(goBinary, ' upgraded');

    expect(await get(h)).toEqual({
      supported: true,
      workspace: { root: rootA },
      state: 'stale',
      staleReason: 'go-changed',
      goBinary,
      confirmToken: expect.any(String),
    });
    expect(await enable(h)).toEqual({ success: true, state: 'on', goBinary });
    expect((await get(h)).state).toBe('on');
  });

  describe('closing review 4: the grant binds the root and binary the GET displayed', () => {
    it('a binary that changed after the GET is refused go-changed; nothing is written', async () => {
      const h = await buildHost();
      const shown = await get(h);

      fs.appendFileSync(goBinary, ' replaced');

      expect(await set(h, grant(rootA, shown.confirmToken))).toEqual({
        success: false,
        error: 'go-changed',
      });
      expect(filesHoldingConsent()).toEqual([]);
    });

    it('a folder replaced at the same path after the GET is refused workspace-changed; nothing is written', async () => {
      const h = await buildHost();
      const shown = await get(h);
      const before = fs.statSync(rootA, { bigint: true }).ino;

      fs.rmSync(rootA, { recursive: true, force: true });
      fs.mkdirSync(rootA);
      const after = fs.statSync(rootA, { bigint: true }).ino;

      const answer = await set(h, grant(rootA, shown.confirmToken));
      if (before === after || after === BigInt(0)) {
        // The volume reused the id or reports none (O2 §1.2 limitation).
        expect(answer.success).toBe(true);
      } else {
        expect(answer).toEqual({ success: false, error: 'workspace-changed' });
        expect(filesHoldingConsent()).toEqual([]);
      }
    });

    it('a folder re-pointed (junction) after the GET is refused workspace-changed', async () => {
      const targetOne = path.join(tmp, 'target-one');
      const targetTwo = path.join(tmp, 'target-two');
      fs.mkdirSync(targetOne);
      fs.mkdirSync(targetTwo);
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.symlinkSync(targetOne, rootA, 'junction');
      const h = await buildHost();
      const shown = await get(h);

      fs.rmSync(rootA, { recursive: true, force: true });
      fs.symlinkSync(targetTwo, rootA, 'junction');

      expect(await set(h, grant(rootA, shown.confirmToken))).toEqual({
        success: false,
        error: 'workspace-changed',
      });
      expect(filesHoldingConsent()).toEqual([]);
    });

    it('a binary that changes while the grant is being written is refused go-changed and the record is removed', async () => {
      const h = await buildHost();
      const shown = await get(h);
      const realGrant = GoVetConsentStore.prototype.grant;
      jest
        .spyOn(GoVetConsentStore.prototype, 'grant')
        .mockImplementation(async function (
          this: GoVetConsentStore,
          ...args: Parameters<GoVetConsentStore['grant']>
        ) {
          await realGrant.apply(this, args);
          fs.appendFileSync(goBinary, ' swapped mid-write');
        });

      expect(await set(h, grant(rootA, shown.confirmToken))).toEqual({
        success: false,
        error: 'go-changed',
      });
      expect(onDisk(rootA)).toBeUndefined();
      expect(auditLines(h.logger)).toEqual([]);
    });
  });

  (process.platform === 'win32' ? it : it.skip)(
    'win32: the displayed root matches the active root case-insensitively',
    async () => {
      const h = await buildHost();

      expect(await enable(h, rootA.toUpperCase())).toEqual({
        success: true,
        state: 'on',
        goBinary,
      });
    },
  );
});
