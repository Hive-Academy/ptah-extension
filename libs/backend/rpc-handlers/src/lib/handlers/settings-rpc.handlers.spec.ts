/**
 * SettingsRpcHandlers — integration specs.
 *
 * Surface under test: the `settings:get`, `settings:set`, `settings:export` and
 * `settings:import` RPC methods wired through `SettingsRpcHandlers.register()`.
 *
 * Design notes:
 *   - Direct constructor injection (no tsyringe container).
 *   - `createMockRpcHandler` from @ptah-extension/vscode-core/testing drives
 *     the real register-then-handleMessage wiring end-to-end.
 *   - `settings:import` reads a file via `node:fs/promises`; that dynamic
 *     import is intercepted through `jest.mock('node:fs/promises', ...)` so
 *     no real FS I/O occurs.
 *   - `userInteraction.showOpenDialog` is stubbed to control the "open dialog"
 *     branch without touching the file system.
 *   - Fake timers are used where `setTimeout` appears (license-import path).
 *
 * Behavioral contracts locked in:
 *   - register() wires all four methods.
 *   - settings:get: an unwritten file-based key answers with its registry
 *     default; a missing key is refused without reaching the provider.
 *   - settings:set: a file-based key is written through the provider; a key
 *     outside FILE_BASED_SETTINGS_KEYS is refused and nothing is written.
 *   - settings:set: `agentOrchestration.decisionModel` is refused (it is saved
 *     through the validating `agent:setConfig`) and nothing is written.
 *   - settings:set: a key with an ADVANCED_SETTINGS descriptor is written only
 *     when its validator accepts the value; a wrong type or an out-of-range
 *     value is refused with the validator's message and nothing is written.
 *   - settings:export: happy path returns exported:true with counts; cancelled
 *     dialog returns exported:false, cancelled:true.
 *   - settings:import: no showOpenDialog → cancelled:true.
 *   - settings:import: user cancels dialog → cancelled:true.
 *   - settings:import: malformed JSON → error envelope, no mutations.
 *   - settings:import: Zod schema failure (missing `auth`) → error envelope,
 *     no mutations.
 *   - settings:import: wrong field type (`auth: 42`) → error envelope.
 *   - settings:import: version too high → error envelope with "Unsupported
 *     settings export version" message, no mutations.
 *   - settings:import: version === current → passes.
 *   - settings:import: version < current → passes (backward compat).
 *   - settings:import: license key imported, verify succeeds → reloadWindow
 *     scheduled.
 *   - settings:import: license key imported, verify fails → reloadWindow NOT
 *     called; result still reports import success.
 *   - settings:import: config values applied via workspaceProvider.setConfiguration.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts`
 */

import 'reflect-metadata';

// Mock node:fs/promises BEFORE the handler module is loaded.
// The handler does a dynamic `await import('node:fs/promises')` inside the
// method body; Jest resolves that against the module registry, so this mock
// intercepts it correctly.
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
}));

import type {
  Logger,
  LicenseService,
  LicenseStatus,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import type {
  ISaveDialogProvider,
  IUserInteraction,
  IWorkspaceProvider,
  IPlatformCommands,
} from '@ptah-extension/platform-core';
import { FILE_BASED_SETTINGS_DEFAULTS } from '@ptah-extension/platform-core';
import type {
  SettingsExportService,
  SettingsImportService,
  PtahSettingsExport,
  SettingsImportResult,
} from '@ptah-extension/agent-sdk';
import { SETTINGS_EXPORT_VERSION } from '@ptah-extension/agent-sdk';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SettingsRpcHandlers } from './settings-rpc.handlers';
import { CURRENT_SETTINGS_EXPORT_VERSION } from './settings-export.schema';

// Pull the mocked fs module so individual tests can configure readFile.
import * as fsMock from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Mock type aliases
// ---------------------------------------------------------------------------

type MockSettingsExportService = jest.Mocked<
  Pick<SettingsExportService, 'collectSettings'>
>;

type MockSettingsImportService = jest.Mocked<
  Pick<SettingsImportService, 'importSettings'>
>;

type MockSaveDialogProvider = jest.Mocked<
  Pick<ISaveDialogProvider, 'showSaveAndWrite'>
>;

interface MockUserInteraction {
  showOpenDialog: jest.Mock | undefined;
}

type MockWorkspaceProvider = jest.Mocked<
  Pick<IWorkspaceProvider, 'setConfiguration' | 'getConfiguration'>
>;

type MockPlatformCommands = jest.Mocked<
  Pick<IPlatformCommands, 'reloadWindow'>
>;

type MockLicenseService = jest.Mocked<Pick<LicenseService, 'verifyLicense'>>;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeLicenseStatus(
  overrides: Partial<LicenseStatus> = {},
): LicenseStatus {
  return { valid: true, tier: 'community', ...overrides } as LicenseStatus;
}

/** Minimal valid export payload for the current schema version. */
function makeValidExport(
  overrides: Partial<PtahSettingsExport> = {},
): PtahSettingsExport {
  return {
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    source: 'vscode',
    auth: {},
    config: {},
    ...overrides,
  } as PtahSettingsExport;
}

function makeImportResult(
  overrides: Partial<SettingsImportResult> = {},
): SettingsImportResult {
  return { imported: [], skipped: [], errors: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: SettingsRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  exportService: MockSettingsExportService;
  importService: MockSettingsImportService;
  saveDialogProvider: MockSaveDialogProvider;
  userInteraction: MockUserInteraction;
  workspaceProvider: MockWorkspaceProvider;
  platformCommands: MockPlatformCommands;
  licenseService: MockLicenseService;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();

  const exportService: MockSettingsExportService = {
    collectSettings: jest.fn(),
  };

  const importService: MockSettingsImportService = {
    importSettings: jest.fn(),
  };

  const saveDialogProvider: MockSaveDialogProvider = {
    showSaveAndWrite: jest.fn(),
  };

  const userInteraction: MockUserInteraction = {
    showOpenDialog: jest.fn() as jest.Mock,
  };

  const workspaceProvider: MockWorkspaceProvider = {
    setConfiguration: jest.fn().mockResolvedValue(undefined),
    getConfiguration: jest.fn().mockReturnValue(undefined),
  };

  const platformCommands: MockPlatformCommands = {
    reloadWindow: jest.fn().mockResolvedValue(undefined),
  };

  const licenseService: MockLicenseService = {
    verifyLicense: jest.fn(),
  };

  const handlers = new SettingsRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    exportService as unknown as SettingsExportService,
    importService as unknown as SettingsImportService,
    saveDialogProvider as unknown as ISaveDialogProvider,
    userInteraction as unknown as IUserInteraction,
    workspaceProvider as unknown as IWorkspaceProvider,
    platformCommands as unknown as IPlatformCommands,
    licenseService as unknown as LicenseService,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    exportService,
    importService,
    saveDialogProvider,
    userInteraction,
    workspaceProvider,
    platformCommands,
    licenseService,
  };
}

/** Drive an RPC method end-to-end and return the data payload. */
async function call<TResult>(
  h: Harness,
  method: string,
  params: unknown = {},
): Promise<TResult> {
  const response = await h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
  if (!response.success) {
    throw new Error(`RPC ${method} returned error: ${response.error}`);
  }
  return response.data as TResult;
}

/** Seed fsMock.readFile to return specific content. */
function seedFile(content: string): void {
  (fsMock.readFile as jest.Mock).mockResolvedValueOnce(content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsRpcHandlers', () => {
  describe('register()', () => {
    it('wires every settings RPC method', () => {
      const h = makeHarness();
      h.handlers.register();
      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'settings:get',
          'settings:set',
          'settings:export',
          'settings:import',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // settings:get / settings:set
  // -------------------------------------------------------------------------

  describe('settings:get', () => {
    it('returns the registry default for a key that was never written', async () => {
      const h = makeHarness();
      // Stand in for a real IWorkspaceProvider: an unwritten file-based key
      // falls back to FILE_BASED_SETTINGS_DEFAULTS.
      h.workspaceProvider.getConfiguration.mockImplementation(
        (_section: string, key: string) =>
          FILE_BASED_SETTINGS_DEFAULTS[
            key as keyof typeof FILE_BASED_SETTINGS_DEFAULTS
          ],
      );
      h.handlers.register();

      const result = await call<{ success: boolean; value?: unknown }>(
        h,
        'settings:get',
        { key: 'diff.renderSideBySide' },
      );

      expect(result).toEqual({ success: true, value: true });
      expect(h.workspaceProvider.getConfiguration).toHaveBeenCalledWith(
        'ptah',
        'diff.renderSideBySide',
      );
    });

    it('rejects a missing key without touching the provider', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'settings:get',
        {},
      );

      expect(result).toEqual({ success: false, error: 'key is required' });
      expect(h.workspaceProvider.getConfiguration).not.toHaveBeenCalled();
    });
  });

  describe('settings:set', () => {
    it('writes a file-based key through the workspace provider', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'settings:set', {
        key: 'diff.renderSideBySide',
        value: false,
      });

      expect(result).toEqual({ success: true });
      expect(h.workspaceProvider.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'diff.renderSideBySide',
        false,
      );
    });

    it('refuses a key that is not file-based and writes nothing', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'settings:set',
        { key: 'not.a.real.setting', value: 'anything' },
      );

      expect(result).toEqual({
        success: false,
        error: "Setting key 'not.a.real.setting' is not writable",
      });
      expect(h.workspaceProvider.setConfiguration).not.toHaveBeenCalled();
    });

    it.each([
      ['an unusable selection', { kind: 'ollama', model: '' }],
      ['a valid selection', { kind: 'ollama', model: 'tev1' }],
    ])(
      'refuses the decision model key with %s and writes nothing',
      async (_case, value) => {
        const h = makeHarness();
        h.handlers.register();

        const result = await call<{ success: boolean; error?: string }>(
          h,
          'settings:set',
          { key: 'agentOrchestration.decisionModel', value },
        );

        expect(result).toEqual({
          success: false,
          error:
            "Setting key 'agentOrchestration.decisionModel' is not writable through settings:set; save it from its own settings row",
        });
        expect(h.workspaceProvider.setConfiguration).not.toHaveBeenCalled();

        // The deny is exact: an unrelated file key on the same handler still saves.
        const other = await call<{ success: boolean }>(h, 'settings:set', {
          key: 'diff.renderSideBySide',
          value: true,
        });
        expect(other).toEqual({ success: true });
        expect(h.workspaceProvider.setConfiguration).toHaveBeenCalledTimes(1);
        expect(h.workspaceProvider.setConfiguration).toHaveBeenCalledWith(
          'ptah',
          'diff.renderSideBySide',
          true,
        );
      },
    );

    describe('described (advanced) keys', () => {
      it.each([
        ['memory.retention.stuckDays', 30],
        ['internalQuery.queueTimeoutMs', 1_500],
        ['agentOrchestration.codexWebSearch', false],
        ['cron.catchupWindowMs', 0],
      ])('writes a valid value for %s', async (key, value) => {
        const h = makeHarness();
        h.handlers.register();

        const result = await call<{ success: boolean }>(h, 'settings:set', {
          key,
          value,
        });

        expect(result).toEqual({ success: true });
        expect(h.workspaceProvider.setConfiguration).toHaveBeenCalledWith(
          'ptah',
          key,
          value,
        );
      });

      it.each([
        [
          'below min',
          'cron.maxConcurrentJobs',
          0,
          'Use a whole number from 1 to 16 jobs.',
        ],
        [
          'above max',
          'memory.retention.stuckDays',
          366,
          'Use a whole number from 7 to 365 days.',
        ],
        [
          'a fraction for an integer key',
          'internalQuery.maxConcurrent',
          2.5,
          'Use a whole number from 1 to 16 queries.',
        ],
        [
          'a numeric string',
          'harness.preflightTimeoutMs',
          '1500',
          'Use a whole number from 100 to 60,000 ms.',
        ],
        [
          'null',
          'compaction.toolOutputBudgetTokens',
          null,
          'Use a whole number from 100 to 200,000 tokens.',
        ],
        [
          'a missing value',
          'internalQuery.maxConcurrentPerLane',
          undefined,
          'Use a whole number from 1 to 16 queries.',
        ],
        [
          'a non-boolean for a boolean key',
          'harness.manageGitignore',
          'yes',
          'Use on or off.',
        ],
      ])(
        'refuses %s (%s) and writes nothing',
        async (_case, key, value, error) => {
          const h = makeHarness();
          h.handlers.register();

          const result = await call<{ success: boolean; error?: string }>(
            h,
            'settings:set',
            { key, value },
          );

          expect(result).toEqual({ success: false, error });
          expect(h.workspaceProvider.setConfiguration).not.toHaveBeenCalled();
          expect(h.logger.error).not.toHaveBeenCalled();
        },
      );

      it('leaves a file key without a descriptor unchecked', async () => {
        const h = makeHarness();
        h.handlers.register();

        // Far outside the session-budget card's own bounds: settings:set does
        // not check keys the advanced table does not describe.
        const result = await call<{ success: boolean }>(h, 'settings:set', {
          key: 'sessionBudget.tokens',
          value: 5,
        });

        expect(result).toEqual({ success: true });
        expect(h.workspaceProvider.setConfiguration).toHaveBeenCalledWith(
          'ptah',
          'sessionBudget.tokens',
          5,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // settings:export
  // -------------------------------------------------------------------------

  describe('settings:export', () => {
    it('happy path — exports and returns file path with counts', async () => {
      const h = makeHarness();
      const exportPayload = makeValidExport({
        auth: { apiKey: 'sk-test' },
        config: { 'model.selected': 'claude-3-5-sonnet' },
      });
      h.exportService.collectSettings.mockResolvedValue(exportPayload);
      h.saveDialogProvider.showSaveAndWrite.mockResolvedValue(
        '/tmp/ptah-settings-export.json',
      );
      h.handlers.register();

      const result = await call<{
        exported: boolean;
        filePath: string;
        secretCount: number;
        configCount: number;
      }>(h, 'settings:export');

      expect(result.exported).toBe(true);
      expect(result.filePath).toBe('/tmp/ptah-settings-export.json');
      expect(result.secretCount).toBeGreaterThan(0);
      expect(result.configCount).toBe(1);
    });

    it('returns exported:false cancelled:true when dialog is cancelled', async () => {
      const h = makeHarness();
      h.exportService.collectSettings.mockResolvedValue(makeValidExport());
      h.saveDialogProvider.showSaveAndWrite.mockResolvedValue(
        null as unknown as string,
      );
      h.handlers.register();

      const result = await call<{ exported: boolean; cancelled?: boolean }>(
        h,
        'settings:export',
      );

      expect(result.exported).toBe(false);
      expect(result.cancelled).toBe(true);
    });

    it('returns exported:false with error message on collectSettings throw', async () => {
      const h = makeHarness();
      h.exportService.collectSettings.mockRejectedValue(new Error('disk full'));
      h.handlers.register();

      const result = await call<{ exported: boolean; error?: string }>(
        h,
        'settings:export',
      );

      expect(result.exported).toBe(false);
      expect(result.error).toMatch(/disk full/);
    });
  });

  // -------------------------------------------------------------------------
  // settings:import
  // -------------------------------------------------------------------------

  describe('settings:import', () => {
    // -----------------------------------------------------------------------
    // Dialog-level cancellation / unavailability
    // -----------------------------------------------------------------------

    it('returns cancelled:true when host has no showOpenDialog (CLI / headless)', async () => {
      const h = makeHarness();
      // Remove the method to simulate a host without a native file picker.
      (h.userInteraction as Partial<MockUserInteraction>).showOpenDialog =
        undefined;
      h.handlers.register();

      const result = await call<{ cancelled: boolean }>(h, 'settings:import');

      expect(result.cancelled).toBe(true);
      expect(h.importService.importSettings).not.toHaveBeenCalled();
    });

    it('returns cancelled:true when user dismisses the open dialog', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([]);
      h.handlers.register();

      const result = await call<{ cancelled: boolean }>(h, 'settings:import');

      expect(result.cancelled).toBe(true);
      expect(h.importService.importSettings).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Schema failure — malformed JSON
    // -----------------------------------------------------------------------

    it('returns error envelope without mutations when file contains malformed JSON', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/bad.json',
      ]);
      seedFile('{ not valid json ,,, }');
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.cancelled).toBe(false);
      expect(result.result.errors.length).toBeGreaterThan(0);
      expect(result.result.errors[0]).toMatch(/malformed json/i);
      expect(result.result.imported).toHaveLength(0);
      expect(h.importService.importSettings).not.toHaveBeenCalled();
    });

    it('returns error envelope without mutations for empty file', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/empty.json',
      ]);
      seedFile('   ');
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.cancelled).toBe(false);
      expect(result.result.errors.length).toBeGreaterThan(0);
      expect(h.importService.importSettings).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Schema failure — Zod validation (missing required fields / wrong types)
    // -----------------------------------------------------------------------

    it('returns error envelope when export is missing required auth field', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/noauth.json',
      ]);
      // `auth` is required by PtahSettingsExportSchema
      const badPayload = {
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        source: 'vscode',
        config: {},
        // auth: intentionally omitted
      };
      seedFile(JSON.stringify(badPayload));
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.cancelled).toBe(false);
      expect(result.result.errors.length).toBeGreaterThan(0);
      expect(result.result.errors[0]).toMatch(/valid ptah settings export/i);
      expect(h.importService.importSettings).not.toHaveBeenCalled();
    });

    it('returns error envelope when auth field has wrong type (number instead of object)', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/wrongtype.json',
      ]);
      const badPayload = {
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        source: 'vscode',
        auth: 42, // wrong type
        config: {},
      };
      seedFile(JSON.stringify(badPayload));
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.cancelled).toBe(false);
      expect(result.result.errors.length).toBeGreaterThan(0);
      expect(result.result.errors[0]).toMatch(/valid ptah settings export/i);
      expect(h.importService.importSettings).not.toHaveBeenCalled();
    });

    it('returns error envelope when config field has wrong type (string instead of object)', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/configstr.json',
      ]);
      const badPayload = {
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        source: 'vscode',
        auth: {},
        config: 'not-an-object', // wrong type
      };
      seedFile(JSON.stringify(badPayload));
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.cancelled).toBe(false);
      expect(result.result.errors.length).toBeGreaterThan(0);
      expect(result.result.errors[0]).toMatch(/valid ptah settings export/i);
      expect(h.importService.importSettings).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Version checks (Q4 — Option B)
    // -----------------------------------------------------------------------

    it('rejects exports whose version is higher than CURRENT_SETTINGS_EXPORT_VERSION', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/future.json',
      ]);
      const futureVersion = CURRENT_SETTINGS_EXPORT_VERSION + 1;
      seedFile(
        JSON.stringify(
          makeValidExport({
            version: futureVersion as typeof SETTINGS_EXPORT_VERSION,
          }),
        ),
      );
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.cancelled).toBe(false);
      expect(result.result.errors.length).toBe(1);
      expect(result.result.errors[0]).toMatch(
        /unsupported settings export version/i,
      );
      expect(result.result.errors[0]).toContain(String(futureVersion));
      expect(h.importService.importSettings).not.toHaveBeenCalled();
    });

    it('rejects version=999 (far-future) with the version message', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/v999.json',
      ]);
      seedFile(
        JSON.stringify(
          makeValidExport({ version: 999 as typeof SETTINGS_EXPORT_VERSION }),
        ),
      );
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.result.errors[0]).toMatch(/update ptah to import it/i);
      expect(h.importService.importSettings).not.toHaveBeenCalled();
    });

    it('accepts version === CURRENT_SETTINGS_EXPORT_VERSION', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/current.json',
      ]);
      h.importService.importSettings.mockResolvedValue(makeImportResult());
      seedFile(JSON.stringify(makeValidExport()));
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.cancelled).toBe(false);
      expect(result.result.errors).toHaveLength(0);
      expect(h.importService.importSettings).toHaveBeenCalledTimes(1);
    });

    it('accepts version === 1 when CURRENT_SETTINGS_EXPORT_VERSION >= 1 (backward compat)', async () => {
      // Only meaningful once the current version is bumped.  For now
      // CURRENT_SETTINGS_EXPORT_VERSION === 1, so this is the same test as
      // "version === current" — it still documents the intent.
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/v1.json',
      ]);
      h.importService.importSettings.mockResolvedValue(makeImportResult());
      seedFile(
        JSON.stringify(
          makeValidExport({ version: 1 as typeof SETTINGS_EXPORT_VERSION }),
        ),
      );
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.cancelled).toBe(false);
      expect(h.importService.importSettings).toHaveBeenCalledTimes(1);
    });

    // -----------------------------------------------------------------------
    // Happy path — full import
    // -----------------------------------------------------------------------

    it('happy path — delegates to importService and applies config values', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/valid.json',
      ]);
      const exportPayload = makeValidExport({
        config: { 'model.selected': 'claude-opus-4-7' },
      });
      seedFile(JSON.stringify(exportPayload));
      h.importService.importSettings.mockResolvedValue(
        makeImportResult({ skipped: ['config:model.selected'] }),
      );
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.cancelled).toBe(false);
      expect(h.importService.importSettings).toHaveBeenCalledTimes(1);
      // Config entry promoted from skipped → imported by workspaceProvider
      expect(h.workspaceProvider.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'model.selected',
        'claude-opus-4-7',
      );
      expect(result.result.imported).toContain('config:model.selected');
      expect(result.result.skipped).not.toContain('config:model.selected');
    });

    // -----------------------------------------------------------------------
    // License key import path
    // -----------------------------------------------------------------------

    it('schedules reloadWindow after successful license key import + verify', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
          '/tmp/with-license.json',
        ]);
        const exportPayload = makeValidExport({ licenseKey: 'ptah_lic_abc' });
        seedFile(JSON.stringify(exportPayload));
        h.importService.importSettings.mockResolvedValue(
          makeImportResult({ imported: ['ptah.licenseKey'] }),
        );
        h.licenseService.verifyLicense.mockResolvedValue(
          makeLicenseStatus({ valid: true, tier: 'builders' }),
        );
        h.handlers.register();

        await call(h, 'settings:import');

        // reloadWindow must be deferred — not called immediately
        expect(h.platformCommands.reloadWindow).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1500);
        expect(h.platformCommands.reloadWindow).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does NOT schedule reloadWindow when license verify returns valid=false', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
          '/tmp/invalid-license.json',
        ]);
        const exportPayload = makeValidExport({ licenseKey: 'ptah_lic_bad' });
        seedFile(JSON.stringify(exportPayload));
        h.importService.importSettings.mockResolvedValue(
          makeImportResult({ imported: ['ptah.licenseKey'] }),
        );
        h.licenseService.verifyLicense.mockResolvedValue(
          makeLicenseStatus({ valid: false, tier: 'expired' }),
        );
        h.handlers.register();

        const result = await call<{
          cancelled: boolean;
          result: SettingsImportResult;
        }>(h, 'settings:import');

        jest.advanceTimersByTime(1500);
        // The import itself still reports success for the key that was written
        expect(result.cancelled).toBe(false);
        // reloadWindow must NOT fire — stale cache would lock user out
        expect(h.platformCommands.reloadWindow).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('does NOT schedule reloadWindow when license verify throws', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
          '/tmp/verify-throws.json',
        ]);
        seedFile(
          JSON.stringify(makeValidExport({ licenseKey: 'ptah_lic_xyz' })),
        );
        h.importService.importSettings.mockResolvedValue(
          makeImportResult({ imported: ['ptah.licenseKey'] }),
        );
        h.licenseService.verifyLicense.mockRejectedValue(
          new Error('network error'),
        );
        h.handlers.register();

        const result = await call<{
          cancelled: boolean;
          result: SettingsImportResult;
        }>(h, 'settings:import');

        jest.advanceTimersByTime(1500);
        expect(result.cancelled).toBe(false);
        expect(h.platformCommands.reloadWindow).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    // -----------------------------------------------------------------------
    // importSettings service failure
    // -----------------------------------------------------------------------

    it('returns error envelope when importSettings service throws', async () => {
      const h = makeHarness();
      (h.userInteraction.showOpenDialog as jest.Mock).mockResolvedValue([
        '/tmp/srv-fail.json',
      ]);
      seedFile(JSON.stringify(makeValidExport()));
      h.importService.importSettings.mockRejectedValue(
        new Error('storage unavailable'),
      );
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        result: SettingsImportResult;
      }>(h, 'settings:import');

      expect(result.cancelled).toBe(false);
      expect(result.result.errors.length).toBeGreaterThan(0);
    });
  });
});
