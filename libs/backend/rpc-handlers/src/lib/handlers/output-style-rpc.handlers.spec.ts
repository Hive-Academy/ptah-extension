/**
 * OutputStyleRpcHandlers — unit specs (plan §13, TASK_2026_197 B4).
 *
 * Coverage:
 *   METHODS               — the six names, and the manifest entry claims them
 *   register()            — wires all six
 *   every method          — malformed params → INVALID_PARAMS via RpcUserError
 *   every named method    — traversal / reserved device names rejected with
 *                           ZERO filesystem calls
 *   Req 7.6               — no absolute host path, no raw exception text
 *   Req 4.4               — save with a changed name rebinds the selection in
 *                           the SAME call
 *   Req 4.6               — delete of the active style clears it
 *   Req 2.4               — activating `default` / `null` clears the selection
 *   E5                    — diagnose reports an orphaned selection
 *
 * The output-styles services are the REAL ones over a mock filesystem, not
 * stubs. The two behaviours this batch actually owns — rebind and clear — are
 * decisions made from what the writer reports, so a stubbed writer would let
 * the spec agree with itself about a contract it invented.
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/output-style-rpc.handlers.ts
 */

// ---------------------------------------------------------------------------
// Importing the manifest pulls in every handler class. Same stubs as
// `rpc-allowlist.spec.ts` — see `test-utils/heavy-module-mocks.ts`.
// ---------------------------------------------------------------------------
jest.mock('@ptah-extension/workspace-intelligence', () =>
  require('../../test-utils/heavy-module-mocks').workspaceIntelligenceMock(),
);

jest.mock('@ptah-extension/memory-curator', () => ({
  ...jest.requireActual('@ptah-extension/memory-curator'),
  deriveWorkspaceFingerprint: jest.fn(),
}));

import 'reflect-metadata';
import * as path from 'path';

import type { IDisposable } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { RpcUserError } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import {
  ClaudeSettingsWriter,
  OutputStyleActivationResolver,
  OutputStyleDiscoveryService,
  OutputStyleFileWriter,
} from '@ptah-extension/output-styles';
import {
  OUTPUT_STYLE_SELECTED_NAME_DEF,
  type ISettingsStore,
} from '@ptah-extension/settings-core';
import type {
  AuthEnv,
  OutputStyleActivateResult,
  OutputStyleDeleteResult,
  OutputStyleDiagnoseResult,
  OutputStyleGetResult,
  OutputStyleListResult,
  OutputStyleSaveResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import { RPC_METHOD_NAMES } from '@ptah-extension/shared';

import { RPC_HANDLER_MANIFEST } from '../host-profile';
import { OutputStyleRpcHandlers } from './output-style-rpc.handlers';

const WORKSPACE_ROOT = path.join('d:', 'tmp', 'ws-output-style-rpc');
const FAKE_HOME = path.join('d:', 'tmp', 'home-output-style-rpc');
const SELECTION_KEY = OUTPUT_STYLE_SELECTED_NAME_DEF.key;

function projectFile(name: string): string {
  return path.join(WORKSPACE_ROOT, '.claude', 'output-styles', name);
}

function userFile(name: string): string {
  return path.join(FAKE_HOME, '.claude', 'output-styles', name);
}

function styleFile(name: string, body = `Body of ${name}.`): string {
  return `---\nname: ${name}\ndescription: The ${name} style.\n---\n\n${body}\n`;
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(root: string | undefined): IWorkspaceProvider {
  return {
    getWorkspaceRoot: jest.fn(() => root),
    getWorkspaceFolders: jest.fn(() => (root === undefined ? [] : [root])),
  } as unknown as IWorkspaceProvider;
}

/** Minimal in-memory `ISettingsStore`. Only the global half is exercised. */
function makeSettingsStore(
  seed: Record<string, unknown> = {},
): ISettingsStore & {
  data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = { ...seed };
  return {
    data,
    readGlobal<T>(key: string): T | undefined {
      return data[key] as T | undefined;
    },
    async writeGlobal<T>(key: string, value: T): Promise<void> {
      if (value === undefined) delete data[key];
      else data[key] = value;
    },
    readSecret: () => Promise.resolve(undefined),
    writeSecret: () => Promise.resolve(),
    deleteSecret: () => Promise.resolve(),
    watchGlobal: (): IDisposable => ({ dispose: () => undefined }),
    watchSecret: (): IDisposable => ({ dispose: () => undefined }),
    flushSync: () => undefined,
  };
}

interface Harness {
  readonly handlers: OutputStyleRpcHandlers;
  readonly rpc: MockRpcHandler;
  readonly fs: MockFileSystemProvider;
  readonly settings: ReturnType<typeof makeSettingsStore>;
  readonly discovery: OutputStyleDiscoveryService;
  /** The REAL parity writer over the same mock filesystem, not a stub. */
  readonly settingsWriter: ClaudeSettingsWriter;
  call<T>(method: RpcMethodName, params: unknown): Promise<T>;
}

interface HarnessOptions {
  readonly selected?: string;
  readonly workspaceRoot?: string | null;
  readonly baseUrl?: string;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const fs = createMockFileSystemProvider();
  const workspace = makeWorkspace(
    options.workspaceRoot === null
      ? undefined
      : (options.workspaceRoot ?? WORKSPACE_ROOT),
  );
  const logger = makeLogger();
  const rpc = createMockRpcHandler();
  const settings = makeSettingsStore(
    options.selected === undefined ? {} : { [SELECTION_KEY]: options.selected },
  );

  const discovery = new OutputStyleDiscoveryService(fs, workspace, logger);
  const fileWriter = new OutputStyleFileWriter(fs, workspace, logger);
  const activation = new OutputStyleActivationResolver();
  const settingsWriter = new ClaudeSettingsWriter(fs, workspace, logger);
  const authEnv =
    options.baseUrl === undefined
      ? undefined
      : ({ ANTHROPIC_BASE_URL: options.baseUrl } as unknown as AuthEnv);

  const handlers = new OutputStyleRpcHandlers(
    logger,
    rpc as unknown as RpcHandler,
    discovery,
    fileWriter,
    activation,
    settingsWriter,
    settings,
    undefined,
    authEnv,
  );
  handlers.register();

  return {
    handlers,
    rpc,
    fs,
    settings,
    discovery,
    settingsWriter,
    call: <T>(method: RpcMethodName, params: unknown): Promise<T> => {
      const handler = rpc.__handlers().get(method);
      if (handler === undefined) {
        throw new Error(`Method not registered: ${method}`);
      }
      return handler(params) as Promise<T>;
    },
  };
}

describe('OutputStyleRpcHandlers', () => {
  const originalHome = process.env['HOME'];
  const originalUserProfile = process.env['USERPROFILE'];

  beforeEach(() => {
    process.env['HOME'] = FAKE_HOME;
    process.env['USERPROFILE'] = FAKE_HOME;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
    if (originalUserProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = originalUserProfile;
  });

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  describe('METHODS and registration', () => {
    it('declares exactly the six outputStyle methods', () => {
      expect(OutputStyleRpcHandlers.METHODS).toEqual([
        'outputStyle:list',
        'outputStyle:get',
        'outputStyle:activate',
        'outputStyle:save',
        'outputStyle:delete',
        'outputStyle:diagnose',
      ]);
    });

    it('declares only names the shared registry knows', () => {
      for (const method of OutputStyleRpcHandlers.METHODS) {
        expect(RPC_METHOD_NAMES).toContain(method);
      }
    });

    it('matches the manifest entry that owns them', () => {
      const entry = RPC_HANDLER_MANIFEST.find((e) => e.key === 'outputStyle');
      expect(entry).toBeDefined();
      expect(entry?.methods).toEqual(OutputStyleRpcHandlers.METHODS);
      expect(entry?.requires).toEqual([]);
      expect(entry?.handler).toBe(OutputStyleRpcHandlers);
    });

    it('register() wires every declared method', () => {
      const { rpc } = makeHarness();
      expect(rpc.getRegisteredMethods().sort()).toEqual(
        [...OutputStyleRpcHandlers.METHODS].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Boundary — INVALID_PARAMS
  // -------------------------------------------------------------------------

  describe('parameter validation', () => {
    const malformed: ReadonlyArray<readonly [RpcMethodName, unknown]> = [
      ['outputStyle:list', { workspaceRoot: 42 }],
      ['outputStyle:get', { name: 'Terse' }], // tier missing
      ['outputStyle:activate', { name: 7 }],
      ['outputStyle:save', { tier: 'builtin', name: 'Terse' }], // not writable
      ['outputStyle:delete', { name: 'Terse', tier: 'builtin' }],
      ['outputStyle:diagnose', { workspaceRoot: false }],
    ];

    it.each(malformed)(
      '%s rejects malformed params',
      async (method, params) => {
        const { call } = makeHarness();
        await expect(call(method, params)).rejects.toBeInstanceOf(RpcUserError);
        await expect(call(method, params)).rejects.toMatchObject({
          errorCode: 'INVALID_PARAMS',
        });
      },
    );

    it('rejects a save whose body is not a string', async () => {
      const { call } = makeHarness();
      await expect(
        call('outputStyle:save', {
          tier: 'project',
          name: 'Terse',
          description: '',
          keepCodingInstructions: true,
          body: { not: 'a string' },
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    });

    it('rejects a negative E8 stamp', async () => {
      const { call } = makeHarness();
      await expect(
        call('outputStyle:save', {
          tier: 'project',
          name: 'Terse',
          description: '',
          keepCodingInstructions: true,
          body: 'x',
          expectedByteLength: -1,
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
    });
  });

  // -------------------------------------------------------------------------
  // Boundary — traversal / reserved names, before any FS call
  // -------------------------------------------------------------------------

  describe('unsafe names are rejected before any filesystem call', () => {
    const unsafe = [
      '../escape',
      '..\\escape',
      '.claude/output-styles/x',
      'C:evil',
      '..',
      'CON',
      'nul.md',
      'lpt9',
    ];

    it.each(unsafe)('outputStyle:save rejects %p', async (name) => {
      const { call, fs } = makeHarness();
      await expect(
        call('outputStyle:save', {
          workspaceRoot: WORKSPACE_ROOT,
          tier: 'project',
          name,
          description: '',
          keepCodingInstructions: true,
          body: 'x',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });

      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.readFile).not.toHaveBeenCalled();
      expect(fs.readDirectory).not.toHaveBeenCalled();
      expect(fs.exists).not.toHaveBeenCalled();
      expect(fs.stat).not.toHaveBeenCalled();
      expect(fs.delete).not.toHaveBeenCalled();
    });

    it.each(unsafe)('outputStyle:delete rejects %p', async (name) => {
      const { call, fs } = makeHarness();
      await expect(
        call('outputStyle:delete', {
          workspaceRoot: WORKSPACE_ROOT,
          tier: 'project',
          name,
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });

      expect(fs.delete).not.toHaveBeenCalled();
      expect(fs.readDirectory).not.toHaveBeenCalled();
      expect(fs.exists).not.toHaveBeenCalled();
    });

    it.each(unsafe)('outputStyle:get rejects %p', async (name) => {
      const { call, fs } = makeHarness();
      await expect(
        call('outputStyle:get', {
          workspaceRoot: WORKSPACE_ROOT,
          tier: 'project',
          name,
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });

      expect(fs.readDirectory).not.toHaveBeenCalled();
      expect(fs.exists).not.toHaveBeenCalled();
    });

    it.each(unsafe)('outputStyle:activate rejects %p', async (name) => {
      const { call, fs, settings } = makeHarness();
      await expect(
        call('outputStyle:activate', {
          workspaceRoot: WORKSPACE_ROOT,
          name,
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });

      expect(fs.readDirectory).not.toHaveBeenCalled();
      expect(settings.data[SELECTION_KEY]).toBeUndefined();
    });

    it('rejects a rename whose ORIGINAL name is unsafe', async () => {
      const { call, fs } = makeHarness();
      await expect(
        call('outputStyle:save', {
          workspaceRoot: WORKSPACE_ROOT,
          tier: 'project',
          name: 'Terse',
          description: '',
          keepCodingInstructions: true,
          body: 'x',
          originalName: '../escape',
        }),
      ).rejects.toMatchObject({ errorCode: 'INVALID_PARAMS' });
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // list / get
  // -------------------------------------------------------------------------

  describe('outputStyle:list', () => {
    it('returns built-ins plus discovered files and the active state', async () => {
      const { call, fs } = makeHarness({ selected: 'Terse' });
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleListResult>('outputStyle:list', {
        workspaceRoot: WORKSPACE_ROOT,
      });

      expect(result.styles.map((s) => s.name)).toContain('Terse');
      expect(result.styles.map((s) => s.name)).toContain('default');
      expect(result.invalid).toEqual([]);
      expect(result.active).toEqual({
        name: 'Terse',
        tier: 'project',
        missing: false,
      });
    });

    it('treats an unparseable stored selection as no selection', async () => {
      const { call, settings } = makeHarness();
      settings.data[SELECTION_KEY] = { not: 'a string' };

      const result = await call<OutputStyleListResult>('outputStyle:list', {
        workspaceRoot: WORKSPACE_ROOT,
      });

      expect(result.active.name).toBeNull();
      expect(result.active.missing).toBe(false);
    });
  });

  describe('outputStyle:get', () => {
    it('returns the body plus the E8 guard stamp for a file tier', async () => {
      const { call, fs } = makeHarness();
      const content = styleFile('Terse');
      await fs.writeFile(projectFile('terse.md'), content);

      const result = await call<OutputStyleGetResult>('outputStyle:get', {
        workspaceRoot: WORKSPACE_ROOT,
        name: 'Terse',
        tier: 'project',
      });

      expect(result.style?.name).toBe('Terse');
      expect(result.style?.body).toContain('Body of Terse.');
      expect(result.style?.byteLength).toBe(
        new TextEncoder().encode(content).length,
      );
      expect(result.style?.relativePath).toBe('.claude/output-styles/terse.md');
    });

    it('returns null for a style that is not in the requested tier', async () => {
      const { call, fs } = makeHarness();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleGetResult>('outputStyle:get', {
        workspaceRoot: WORKSPACE_ROOT,
        name: 'Terse',
        tier: 'user',
      });

      expect(result.style).toBeNull();
    });

    it('returns a built-in without a guard stamp', async () => {
      const { call, fs } = makeHarness();

      const result = await call<OutputStyleGetResult>('outputStyle:get', {
        workspaceRoot: WORKSPACE_ROOT,
        name: 'Learning',
        tier: 'builtin',
      });

      expect(result.style?.editable).toBe(false);
      expect(result.style?.mtime).toBeUndefined();
      expect(fs.stat).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // activate
  // -------------------------------------------------------------------------

  describe('outputStyle:activate', () => {
    it('persists the chosen name and reports the flag path', async () => {
      const { call, fs, settings } = makeHarness();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        { workspaceRoot: WORKSPACE_ROOT, name: 'Terse' },
      );

      expect(result.success).toBe(true);
      expect(result.decision).toEqual({ path: 'flag', styleName: 'Terse' });
      expect(result.parity).toBeUndefined();
      expect(settings.data[SELECTION_KEY]).toBe('Terse');
    });

    it('injects a user-tier style on a localhost provider (Req 5.2)', async () => {
      const { call, fs } = makeHarness({ baseUrl: 'http://127.0.0.1:4000' });
      await fs.writeFile(userFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        { workspaceRoot: WORKSPACE_ROOT, name: 'Terse' },
      );

      expect(result.decision).toMatchObject({
        path: 'inject',
        styleName: 'Terse',
      });
    });

    it('clears the selection for `default` (Req 2.4)', async () => {
      const { call, settings } = makeHarness({ selected: 'Terse' });

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        { workspaceRoot: WORKSPACE_ROOT, name: 'default' },
      );

      expect(result.success).toBe(true);
      expect(result.decision).toEqual({ path: 'none' });
      expect(settings.data[SELECTION_KEY]).toBe('');
    });

    it('clears the selection for null', async () => {
      const { call, settings } = makeHarness({ selected: 'Terse' });

      await call<OutputStyleActivateResult>('outputStyle:activate', {
        workspaceRoot: WORKSPACE_ROOT,
        name: null,
      });

      expect(settings.data[SELECTION_KEY]).toBe('');
    });

    it('refuses an unknown style and leaves the previous selection intact', async () => {
      const { call, settings } = makeHarness({ selected: 'Terse' });

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        { workspaceRoot: WORKSPACE_ROOT, name: 'Ghost' },
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
      expect(settings.data[SELECTION_KEY]).toBe('Terse');
    });
  });

  // -------------------------------------------------------------------------
  // activate — opt-in CLI parity (B7 / P4b, plan §4.1, §4.2, R6, E2)
  //
  // The batch's core invariant is the last three cases: a parity write that
  // fails, in three different ways, must leave the selection exactly as the
  // user set it. Activation rides the flag tier and never depended on this
  // file, so there is nothing to roll back — these specs prove the code agrees.
  // -------------------------------------------------------------------------

  describe('outputStyle:activate — opt-in CLI parity', () => {
    const PROJECT_SETTINGS = path.join(
      WORKSPACE_ROOT,
      '.claude',
      'settings.json',
    );
    const LOCAL_SETTINGS = path.join(
      WORKSPACE_ROOT,
      '.claude',
      'settings.local.json',
    );

    function seedRaw(
      fs: MockFileSystemProvider,
      target: string,
      raw: string,
    ): void {
      fs.__state.files.set(target, new TextEncoder().encode(raw));
    }

    function readRaw(fs: MockFileSystemProvider, target: string): string {
      const bytes = fs.__state.files.get(target);
      if (bytes === undefined) throw new Error(`not written: ${target}`);
      return new TextDecoder().decode(bytes);
    }

    function settingsWasWritten(fs: MockFileSystemProvider): boolean {
      return (
        fs.__state.files.has(PROJECT_SETTINGS) ||
        fs.__state.files.has(LOCAL_SETTINGS)
      );
    }

    it('writes NOTHING when parity is not requested (default OFF, R6)', async () => {
      const { call, fs } = makeHarness();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        { workspaceRoot: WORKSPACE_ROOT, name: 'Terse' },
      );

      expect(result.success).toBe(true);
      expect(result.parity).toBeUndefined();
      expect(settingsWasWritten(fs)).toBe(false);
    });

    it('writes NOTHING when parity is explicitly disabled', async () => {
      const { call, fs } = makeHarness();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        {
          workspaceRoot: WORKSPACE_ROOT,
          name: 'Terse',
          parity: { enabled: false, tier: 'project' },
        },
      );

      expect(result.parity).toBeUndefined();
      expect(settingsWasWritten(fs)).toBe(false);
    });

    it('mirrors the chosen name into the project tier when opted in (E2)', async () => {
      const { call, fs, settings } = makeHarness();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        {
          workspaceRoot: WORKSPACE_ROOT,
          name: 'Terse',
          parity: { enabled: true, tier: 'project' },
        },
      );

      expect(result.success).toBe(true);
      expect(result.parity).toEqual({
        written: true,
        writtenPath: '.claude/settings.json',
        tier: 'project',
      });
      expect(JSON.parse(readRaw(fs, PROJECT_SETTINGS))).toEqual({
        outputStyle: 'Terse',
      });
      expect(settings.data[SELECTION_KEY]).toBe('Terse');
    });

    it('targets settings.local.json for the local tier', async () => {
      const { call, fs } = makeHarness();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        {
          workspaceRoot: WORKSPACE_ROOT,
          name: 'Terse',
          parity: { enabled: true, tier: 'local' },
        },
      );

      expect(result.parity?.writtenPath).toBe('.claude/settings.local.json');
      expect(fs.__state.files.has(PROJECT_SETTINGS)).toBe(false);
    });

    it('keeps every unrelated key in a co-owned settings file (Req 2.2)', async () => {
      const { call, fs } = makeHarness();
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));
      seedRaw(
        fs,
        PROJECT_SETTINGS,
        '{\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n',
      );

      await call<OutputStyleActivateResult>('outputStyle:activate', {
        workspaceRoot: WORKSPACE_ROOT,
        name: 'Terse',
        parity: { enabled: true, tier: 'project' },
      });

      expect(JSON.parse(readRaw(fs, PROJECT_SETTINGS))).toEqual({
        permissions: { allow: ['Bash(ls)'] },
        outputStyle: 'Terse',
      });
    });

    it('clears the key when the selection is cleared (Req 2.4)', async () => {
      const { call, fs, settings } = makeHarness({ selected: 'Terse' });
      seedRaw(fs, PROJECT_SETTINGS, '{\n  "outputStyle": "Terse"\n}\n');

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        {
          workspaceRoot: WORKSPACE_ROOT,
          name: 'default',
          parity: { enabled: true, tier: 'project' },
        },
      );

      expect(result.parity?.written).toBe(true);
      expect(JSON.parse(readRaw(fs, PROJECT_SETTINGS))).toEqual({});
      expect(settings.data[SELECTION_KEY]).toBe('');
    });

    it('does not mirror a selection that was REFUSED', async () => {
      const { call, fs, settings } = makeHarness({ selected: 'Terse' });

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        {
          workspaceRoot: WORKSPACE_ROOT,
          name: 'Ghost',
          parity: { enabled: true, tier: 'project' },
        },
      );

      expect(result.success).toBe(false);
      expect(result.parity).toBeUndefined();
      expect(settingsWasWritten(fs)).toBe(false);
      expect(settings.data[SELECTION_KEY]).toBe('Terse');
    });

    // ---- THE INVARIANT ----------------------------------------------------

    it('a MALFORMED settings file fails parity but leaves the selection active', async () => {
      const { call, fs, settings } = makeHarness({ selected: 'Explanatory' });
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));
      seedRaw(fs, PROJECT_SETTINGS, '{ this is not json');

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        {
          workspaceRoot: WORKSPACE_ROOT,
          name: 'Terse',
          parity: { enabled: true, tier: 'project' },
        },
      );

      // The selection succeeded and is persisted.
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.decision).toEqual({ path: 'flag', styleName: 'Terse' });
      expect(settings.data[SELECTION_KEY]).toBe('Terse');

      // Only the parity half failed, and the file was left untouched.
      expect(result.parity?.written).toBe(false);
      expect(result.parity?.error?.code).toBe('SETTINGS_MALFORMED');
      expect(readRaw(fs, PROJECT_SETTINGS)).toBe('{ this is not json');
    });

    it('a THROWN write failure still leaves the selection active', async () => {
      const harness = makeHarness({ selected: 'Explanatory' });
      await harness.fs.writeFile(projectFile('terse.md'), styleFile('Terse'));
      jest
        .spyOn(harness.settingsWriter, 'setOutputStyle')
        .mockRejectedValueOnce(
          new Error(`EACCES: permission denied, open '${PROJECT_SETTINGS}'`),
        );

      const result = await harness.call<OutputStyleActivateResult>(
        'outputStyle:activate',
        {
          workspaceRoot: WORKSPACE_ROOT,
          name: 'Terse',
          parity: { enabled: true, tier: 'project' },
        },
      );

      expect(result.success).toBe(true);
      expect(harness.settings.data[SELECTION_KEY]).toBe('Terse');
      expect(result.parity?.written).toBe(false);
      expect(result.parity?.error?.code).toBe('WRITE_FAILED');
    });

    it('a NO_WORKSPACE parity target still leaves the selection active', async () => {
      const { call, settings } = makeHarness({ workspaceRoot: null });

      const result = await call<OutputStyleActivateResult>(
        'outputStyle:activate',
        {
          name: 'Explanatory',
          parity: { enabled: true, tier: 'project' },
        },
      );

      expect(result.success).toBe(true);
      expect(settings.data[SELECTION_KEY]).toBe('Explanatory');
      expect(result.parity?.written).toBe(false);
      expect(result.parity?.error?.code).toBe('NO_WORKSPACE');
    });

    it('keeps absolute host paths out of every parity message (Req 7.6)', async () => {
      const harness = makeHarness();
      await harness.fs.writeFile(projectFile('terse.md'), styleFile('Terse'));
      seedRaw(harness.fs, PROJECT_SETTINGS, '{ this is not json');

      const malformed = await harness.call<OutputStyleActivateResult>(
        'outputStyle:activate',
        {
          workspaceRoot: WORKSPACE_ROOT,
          name: 'Terse',
          parity: { enabled: true, tier: 'project' },
        },
      );

      jest
        .spyOn(harness.settingsWriter, 'setOutputStyle')
        .mockRejectedValueOnce(
          new Error(`EACCES: permission denied, open '${PROJECT_SETTINGS}'`),
        );
      const thrown = await harness.call<OutputStyleActivateResult>(
        'outputStyle:activate',
        {
          workspaceRoot: WORKSPACE_ROOT,
          name: 'Terse',
          parity: { enabled: true, tier: 'project' },
        },
      );

      for (const outcome of [malformed.parity, thrown.parity]) {
        const text = `${outcome?.error?.message ?? ''} ${outcome?.error?.path ?? ''}`;
        expect(text).not.toContain(WORKSPACE_ROOT);
        expect(text).not.toContain(FAKE_HOME);
        expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // save — Req 4.4
  // -------------------------------------------------------------------------

  describe('outputStyle:save', () => {
    it('creates a new style and reports a relative path', async () => {
      const { call } = makeHarness();

      const result = await call<OutputStyleSaveResult>('outputStyle:save', {
        workspaceRoot: WORKSPACE_ROOT,
        tier: 'project',
        name: 'House Style',
        description: 'The house voice.',
        keepCodingInstructions: true,
        body: 'Write plainly.',
      });

      expect(result.success).toBe(true);
      expect(result.path).toBe('.claude/output-styles/house-style.md');
      expect(result.rebound).toBe(false);
      expect(path.isAbsolute(result.path ?? '')).toBe(false);
    });

    it('rebinds the selection when the ACTIVE style is renamed (Req 4.4)', async () => {
      const { call, fs, settings } = makeHarness({ selected: 'Terse' });
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleSaveResult>('outputStyle:save', {
        workspaceRoot: WORKSPACE_ROOT,
        tier: 'project',
        name: 'Very Terse',
        description: 'The Terse style.',
        keepCodingInstructions: true,
        body: 'Body of Terse.',
        originalName: 'Terse',
      });

      expect(result.success).toBe(true);
      expect(result.rebound).toBe(true);
      // Same call — no client-side activate follow-up.
      expect(settings.data[SELECTION_KEY]).toBe('Very Terse');
    });

    it('does NOT rebind when the renamed style was not the active one', async () => {
      const { call, fs, settings } = makeHarness({ selected: 'Explanatory' });
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleSaveResult>('outputStyle:save', {
        workspaceRoot: WORKSPACE_ROOT,
        tier: 'project',
        name: 'Very Terse',
        description: 'The Terse style.',
        keepCodingInstructions: true,
        body: 'Body of Terse.',
        originalName: 'Terse',
      });

      expect(result.rebound).toBe(false);
      expect(settings.data[SELECTION_KEY]).toBe('Explanatory');
    });

    it('does NOT rebind when an edit leaves the name unchanged', async () => {
      const { call, fs, settings } = makeHarness({ selected: 'Terse' });
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleSaveResult>('outputStyle:save', {
        workspaceRoot: WORKSPACE_ROOT,
        tier: 'project',
        name: 'Terse',
        description: 'A revised description.',
        keepCodingInstructions: true,
        body: 'Body of Terse.',
        originalName: 'Terse',
      });

      expect(result.rebound).toBe(false);
      expect(settings.data[SELECTION_KEY]).toBe('Terse');
    });

    it('surfaces a structured failure without touching the selection', async () => {
      const { call, settings } = makeHarness({ selected: 'Terse' });

      const result = await call<OutputStyleSaveResult>('outputStyle:save', {
        workspaceRoot: WORKSPACE_ROOT,
        tier: 'project',
        name: 'Terse',
        description: '',
        keepCodingInstructions: true,
        body: 'x',
        originalName: 'Ghost',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
      expect(settings.data[SELECTION_KEY]).toBe('Terse');
    });
  });

  // -------------------------------------------------------------------------
  // delete — Req 4.6
  // -------------------------------------------------------------------------

  describe('outputStyle:delete', () => {
    it('clears the selection when the deleted style was active (Req 4.6)', async () => {
      const { call, fs, settings } = makeHarness({ selected: 'Terse' });
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleDeleteResult>('outputStyle:delete', {
        workspaceRoot: WORKSPACE_ROOT,
        tier: 'project',
        name: 'Terse',
      });

      expect(result).toEqual({ success: true, clearedActive: true });
      expect(settings.data[SELECTION_KEY]).toBe('');
    });

    it('leaves an unrelated selection alone', async () => {
      const { call, fs, settings } = makeHarness({ selected: 'Explanatory' });
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleDeleteResult>('outputStyle:delete', {
        workspaceRoot: WORKSPACE_ROOT,
        tier: 'project',
        name: 'Terse',
      });

      expect(result).toEqual({ success: true, clearedActive: false });
      expect(settings.data[SELECTION_KEY]).toBe('Explanatory');
    });

    it('does not clear the selection when the delete failed', async () => {
      const { call, settings } = makeHarness({ selected: 'Terse' });

      const result = await call<OutputStyleDeleteResult>('outputStyle:delete', {
        workspaceRoot: WORKSPACE_ROOT,
        tier: 'project',
        name: 'Terse',
      });

      expect(result.success).toBe(false);
      expect(result.clearedActive).toBe(false);
      expect(settings.data[SELECTION_KEY]).toBe('Terse');
    });
  });

  // -------------------------------------------------------------------------
  // diagnose
  // -------------------------------------------------------------------------

  describe('outputStyle:diagnose', () => {
    it('reports the decision, visible tiers and a healthy selection', async () => {
      const { call, fs } = makeHarness({ selected: 'Terse' });
      await fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const result = await call<OutputStyleDiagnoseResult>(
        'outputStyle:diagnose',
        { workspaceRoot: WORKSPACE_ROOT },
      );

      expect(result.decision).toEqual({ path: 'flag', styleName: 'Terse' });
      expect(result.visibleTiers).toEqual(['builtin', 'user', 'project']);
      expect(result.activeName).toBe('Terse');
      expect(result.activeMissing).toBe(false);
    });

    it('drops the user tier on a localhost provider (E3)', async () => {
      const { call } = makeHarness({ baseUrl: 'http://localhost:11434' });

      const result = await call<OutputStyleDiagnoseResult>(
        'outputStyle:diagnose',
        { workspaceRoot: WORKSPACE_ROOT },
      );

      expect(result.visibleTiers).toEqual(['builtin', 'project']);
    });

    it('names an orphaned selection (E5)', async () => {
      const { call } = makeHarness({ selected: 'Ghost' });

      const result = await call<OutputStyleDiagnoseResult>(
        'outputStyle:diagnose',
        { workspaceRoot: WORKSPACE_ROOT },
      );

      expect(result.activeName).toBe('Ghost');
      expect(result.activeMissing).toBe(true);
      expect(result.decision).toEqual({ path: 'none' });
    });

    it('is re-resolved rather than cached (Req 5.6)', async () => {
      const harness = makeHarness({ selected: 'Terse' });
      await harness.fs.writeFile(projectFile('terse.md'), styleFile('Terse'));

      const first = await harness.call<OutputStyleDiagnoseResult>(
        'outputStyle:diagnose',
        { workspaceRoot: WORKSPACE_ROOT },
      );
      expect(first.activeMissing).toBe(false);

      await harness.fs.delete(projectFile('terse.md'));

      const second = await harness.call<OutputStyleDiagnoseResult>(
        'outputStyle:diagnose',
        { workspaceRoot: WORKSPACE_ROOT },
      );
      expect(second.activeMissing).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Req 7.6 — nothing path-shaped and nothing raw reaches a client
  // -------------------------------------------------------------------------

  describe('surfaced messages (Req 7.6)', () => {
    function assertClean(text: string): void {
      expect(text).not.toContain(WORKSPACE_ROOT);
      expect(text).not.toContain(FAKE_HOME);
      expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
    }

    it('keeps the host path out of a write failure', async () => {
      const { call, fs } = makeHarness();
      fs.writeFile.mockRejectedValueOnce(
        new Error(`EACCES: permission denied, open '${projectFile('x.md')}'`),
      );

      const result = await call<OutputStyleSaveResult>('outputStyle:save', {
        workspaceRoot: WORKSPACE_ROOT,
        tier: 'project',
        name: 'Terse',
        description: '',
        keepCodingInstructions: true,
        body: 'x',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('WRITE_FAILED');
      assertClean(result.error?.message ?? '');
      assertClean(result.error?.path ?? '');
    });

    it('keeps the host path out of an invalid-file diagnostic', async () => {
      const { call, fs } = makeHarness();
      await fs.writeFile(
        projectFile('broken.md'),
        '---\ntheme: dark\n---\n\nBody.\n',
      );

      const result = await call<OutputStyleListResult>('outputStyle:list', {
        workspaceRoot: WORKSPACE_ROOT,
      });

      expect(result.invalid).toHaveLength(1);
      assertClean(result.invalid[0].error.message);
      assertClean(result.invalid[0].relativePath);
    });

    it('replaces an unexpected internal failure with a generic message', async () => {
      const harness = makeHarness();
      const raw = `ENOENT: no such file or directory, scandir '${projectFile('')}'`;
      jest
        .spyOn(harness.discovery, 'discover')
        .mockRejectedValueOnce(new Error(raw));

      await expect(
        harness.call('outputStyle:list', { workspaceRoot: WORKSPACE_ROOT }),
      ).rejects.toThrow('Failed to list output styles.');
    });
  });
});
