/**
 * EnhancedPromptsRpcHandlers — unit specs.
 *
 * Surface under test: six RPC methods exposing the Enhanced Prompts feature
 * to the webview (`getStatus`, `runWizard`, `setEnabled`, `regenerate`,
 * `getPromptContent`, `download`). We lock in:
 *
 *   - Registration: `register()` wires all six methods into the mock
 *     RpcHandler.
 *   - Path resolution: `.` and `./` are resolved via `IWorkspaceProvider`;
 *     absolute paths pass through unchanged. Missing workspacePath returns a
 *     structured error (never throws).
 *   - License gating: `runWizard` and `regenerate` both verify the license
 *     with a timeout. A `null` (timeout) result produces a user-facing
 *     timeout message; a non-premium tier produces the "upgrade to Pro"
 *     message.
 *   - Premium pass-through: a `pro` tier status makes runWizard/regenerate
 *     dispatch into EnhancedPromptsService.
 *   - Download: missing content returns a "generate first" error; a real
 *     content buffer is handed to `ISaveDialogProvider.showSaveAndWrite`
 *     with the expected filename/filters/title; user-cancelled save
 *     surfaces as a structured error, not a throw.
 *   - Never throws to the RPC boundary: handler surfaces errors as response
 *     objects (otherwise `handleMessage` would serialize them as generic
 *     failures — the UI relies on the structured `error` field).
 *
 * Mocking posture: direct constructor injection, no tsyringe container.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`
 */

import 'reflect-metadata';

import type { DependencyContainer } from 'tsyringe';
import type {
  Logger,
  LicenseService,
  LicenseStatus,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type {
  ISaveDialogProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type {
  EnhancedPromptsService,
  PluginLoaderService,
} from '@ptah-extension/agent-sdk';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { EnhancedPromptsRpcHandlers } from './enhanced-prompts-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler actually touches.
// ---------------------------------------------------------------------------

type MockEnhancedPromptsService = jest.Mocked<
  Pick<
    EnhancedPromptsService,
    | 'getStatus'
    | 'runWizard'
    | 'setEnabled'
    | 'regenerate'
    | 'getFullCombinedPromptContent'
  >
>;

function createMockEnhancedPromptsService(): MockEnhancedPromptsService {
  return {
    getStatus: jest.fn(),
    runWizard: jest.fn(),
    setEnabled: jest.fn(),
    regenerate: jest.fn(),
    getFullCombinedPromptContent: jest.fn(),
  };
}

type MockLicenseService = jest.Mocked<Pick<LicenseService, 'verifyLicense'>>;

function createMockLicenseService(): MockLicenseService {
  return { verifyLicense: jest.fn() };
}

type MockPluginLoader = jest.Mocked<
  Pick<PluginLoaderService, 'getWorkspacePluginConfig' | 'resolvePluginPaths'>
>;

function createMockPluginLoader(): MockPluginLoader {
  return {
    getWorkspacePluginConfig: jest.fn().mockReturnValue({
      enabledPluginIds: [],
      disabledSkillIds: [],
    }),
    resolvePluginPaths: jest.fn().mockReturnValue([]),
  };
}

type MockSaveDialog = jest.Mocked<
  Pick<ISaveDialogProvider, 'showSaveAndWrite'>
>;

function createMockSaveDialog(): MockSaveDialog {
  return { showSaveAndWrite: jest.fn() };
}

type MockContainer = jest.Mocked<
  Pick<DependencyContainer, 'isRegistered' | 'resolve'>
>;

function createMockContainer(): MockContainer {
  return {
    // Handler probes for optional collaborators (WebviewManager,
    // CodeExecutionMCP). Default to "not registered" — the handler's
    // best-effort branches MUST tolerate absence.
    isRegistered: jest.fn().mockReturnValue(false),
    resolve: jest.fn(),
  } as unknown as MockContainer;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLicenseStatus(
  overrides: Partial<LicenseStatus> = {},
): LicenseStatus {
  return {
    valid: true,
    tier: 'community',
    ...overrides,
  } as LicenseStatus;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: EnhancedPromptsRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  enhancedPrompts: MockEnhancedPromptsService;
  license: MockLicenseService;
  pluginLoader: MockPluginLoader;
  workspace: MockWorkspaceProvider;
  saveDialog: MockSaveDialog;
  container: MockContainer;
  sentry: MockSentryService;
}

function makeHarness(opts: { workspaceRoot?: string } = {}): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const enhancedPrompts = createMockEnhancedPromptsService();
  const license = createMockLicenseService();
  const pluginLoader = createMockPluginLoader();
  const workspace = createMockWorkspaceProvider({
    folders: [opts.workspaceRoot ?? '/fake/workspace'],
  });
  const saveDialog = createMockSaveDialog();
  const container = createMockContainer();
  const sentry = createMockSentryService();

  const handlers = new EnhancedPromptsRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    enhancedPrompts as unknown as EnhancedPromptsService,
    license as unknown as LicenseService,
    pluginLoader as unknown as PluginLoaderService,
    workspace as unknown as IWorkspaceProvider,
    saveDialog as unknown as ISaveDialogProvider,
    container as unknown as DependencyContainer,
    sentry as unknown as SentryService,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    enhancedPrompts,
    license,
    pluginLoader,
    workspace,
    saveDialog,
    container,
    sentry,
  };
}

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
    throw new Error(`RPC ${method} failed: ${response.error}`);
  }
  return response.data as TResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnhancedPromptsRpcHandlers', () => {
  describe('register()', () => {
    it('registers all six enhancedPrompts RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'enhancedPrompts:download',
          'enhancedPrompts:getPromptContent',
          'enhancedPrompts:getStatus',
          'enhancedPrompts:regenerate',
          'enhancedPrompts:runWizard',
          'enhancedPrompts:setEnabled',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:getStatus
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:getStatus', () => {
    it('returns an error shape when workspacePath is missing', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ enabled: boolean; error?: string }>(
        h,
        'enhancedPrompts:getStatus',
        {},
      );

      expect(result.enabled).toBe(false);
      expect(result.error).toMatch(/workspace path is required/i);
      expect(h.enhancedPrompts.getStatus).not.toHaveBeenCalled();
    });

    it('resolves "." to the workspace root before delegating', async () => {
      const h = makeHarness({ workspaceRoot: '/real/root' });
      h.enhancedPrompts.getStatus.mockResolvedValue({
        enabled: true,
        hasGeneratedPrompt: true,
        generatedAt: '2026-01-01T00:00:00Z',
        detectedStack: null,
        cacheValid: true,
        invalidationReason: undefined,
      });
      h.handlers.register();

      await call(h, 'enhancedPrompts:getStatus', { workspacePath: '.' });

      expect(h.enhancedPrompts.getStatus).toHaveBeenCalledWith('/real/root');
    });

    it('passes absolute workspacePath through unchanged', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getStatus.mockResolvedValue({
        enabled: true,
        hasGeneratedPrompt: false,
        generatedAt: null,
        detectedStack: null,
        cacheValid: false,
        invalidationReason: undefined,
      });
      h.handlers.register();

      await call(h, 'enhancedPrompts:getStatus', {
        workspacePath: '/explicit/path',
      });

      expect(h.enhancedPrompts.getStatus).toHaveBeenCalledWith(
        '/explicit/path',
      );
    });

    it('captures service exceptions to Sentry and returns error shape', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getStatus.mockRejectedValue(new Error('boom'));
      h.handlers.register();

      const result = await call<{ enabled: boolean; error?: string }>(
        h,
        'enhancedPrompts:getStatus',
        { workspacePath: '/x' },
      );

      expect(result.enabled).toBe(false);
      expect(result.error).toBe('boom');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:runWizard
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:runWizard', () => {
    it('rejects missing workspacePath with structured error', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:runWizard',
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workspace path is required/i);
      expect(h.license.verifyLicense).not.toHaveBeenCalled();
    });

    it('surfaces a timeout error when license verification hangs past the timeout', async () => {
      // Collapse the handler's 10-second verification timeout to a micro-task
      // so the test stays under Jest's default 5s budget. The handler's
      // verifyLicenseWithTimeout() is a `Promise.race` over a setTimeout,
      // so replacing setTimeout with a 0-ms scheduler short-circuits it.
      const realSetTimeout = global.setTimeout;
      jest
        .spyOn(global, 'setTimeout')
        .mockImplementation(((fn: () => void) =>
          realSetTimeout(fn, 0)) as unknown as typeof setTimeout);

      // Late resolver wired to a Promise we can settle in `finally` so the
      // Jest worker does not hold a dangling Promise between tests.
      let resolveVerify: (() => void) | undefined;
      const pendingVerify = new Promise<never>((_, reject) => {
        resolveVerify = () => reject(new Error('teardown'));
      });

      try {
        const h = makeHarness();
        h.license.verifyLicense.mockReturnValue(
          pendingVerify as unknown as Promise<
            Awaited<
              ReturnType<
                import('@ptah-extension/vscode-core').LicenseService['verifyLicense']
              >
            >
          >,
        );
        h.handlers.register();

        const result = await call<{ success: boolean; error?: string }>(
          h,
          'enhancedPrompts:runWizard',
          { workspacePath: '/x' },
        );

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/verification timed out/i);
        expect(h.enhancedPrompts.runWizard).not.toHaveBeenCalled();
      } finally {
        // Settle the pending verify promise so Jest's unhandled-rejection
        // detector doesn't flag the worker on teardown.
        resolveVerify?.();
        // Swallow the teardown rejection.
        pendingVerify.catch(() => undefined);
        jest.restoreAllMocks();
      }
    });

    it('rejects non-premium tiers with an upgrade message', async () => {
      const h = makeHarness();
      h.license.verifyLicense.mockResolvedValue(
        makeLicenseStatus({ tier: 'community' }),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:runWizard',
        { workspacePath: '/x' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/premium feature/i);
      expect(h.enhancedPrompts.runWizard).not.toHaveBeenCalled();
    });

    it('dispatches to EnhancedPromptsService on pro tier and forwards the result', async () => {
      const h = makeHarness();
      h.license.verifyLicense.mockResolvedValue(
        makeLicenseStatus({ tier: 'pro' }),
      );
      h.enhancedPrompts.runWizard.mockResolvedValue({
        success: true,
        state: {
          enabled: true,
          generatedPrompt: 'DO NOT LEAK',
          generatedAt: '2026-01-01T00:00:00Z',
          detectedStack: null,
          configHash: 'abc',
          workspacePath: '/x',
        },
        summary: null,
      } as unknown as Awaited<ReturnType<EnhancedPromptsService['runWizard']>>);
      h.handlers.register();

      const result = await call<{
        success: boolean;
        generatedAt?: string;
        detectedStack?: unknown;
        summary?: unknown;
      }>(h, 'enhancedPrompts:runWizard', { workspacePath: '/x' });

      expect(h.enhancedPrompts.runWizard).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.generatedAt).toBe('2026-01-01T00:00:00Z');
      expect(result.detectedStack).toBeNull();
      expect(result.summary).toBeNull();
      // IP-protection: generated prompt content must NOT leak back to the UI.
      expect(result).not.toHaveProperty('generatedPrompt');
    });

    it('accepts trial_pro as premium', async () => {
      const h = makeHarness();
      h.license.verifyLicense.mockResolvedValue(
        makeLicenseStatus({ tier: 'trial_pro' }),
      );
      h.enhancedPrompts.runWizard.mockResolvedValue({
        success: false,
        error: 'some internal error',
      } as unknown as Awaited<ReturnType<EnhancedPromptsService['runWizard']>>);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:runWizard',
        { workspacePath: '/x' },
      );

      expect(h.enhancedPrompts.runWizard).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toBe('some internal error');
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:setEnabled
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:setEnabled', () => {
    it('rejects missing workspacePath', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:setEnabled',
        { enabled: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workspace path is required/i);
      expect(h.enhancedPrompts.setEnabled).not.toHaveBeenCalled();
    });

    it('rejects non-boolean enabled flag', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:setEnabled',
        { workspacePath: '/x', enabled: 'yes' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/enabled flag/i);
      expect(h.enhancedPrompts.setEnabled).not.toHaveBeenCalled();
    });

    it('delegates to the service and echoes the new state', async () => {
      const h = makeHarness();
      h.enhancedPrompts.setEnabled.mockResolvedValue(undefined);
      h.handlers.register();

      const result = await call<{ success: boolean; enabled?: boolean }>(
        h,
        'enhancedPrompts:setEnabled',
        { workspacePath: '/x', enabled: false },
      );

      expect(h.enhancedPrompts.setEnabled).toHaveBeenCalledWith('/x', false);
      expect(result.success).toBe(true);
      expect(result.enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:regenerate
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:regenerate', () => {
    it('rejects missing workspacePath', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:regenerate',
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workspace path is required/i);
      expect(h.license.verifyLicense).not.toHaveBeenCalled();
    });

    it('rejects non-premium tiers with an upgrade message', async () => {
      const h = makeHarness();
      h.license.verifyLicense.mockResolvedValue(
        makeLicenseStatus({ tier: 'community' }),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:regenerate',
        { workspacePath: '/x' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/premium feature/i);
      expect(h.enhancedPrompts.regenerate).not.toHaveBeenCalled();
    });

    it('defaults force=true when omitted and forwards to the service', async () => {
      const h = makeHarness();
      h.license.verifyLicense.mockResolvedValue(
        makeLicenseStatus({ tier: 'pro' }),
      );
      h.enhancedPrompts.regenerate.mockResolvedValue({
        success: true,
        status: {
          enabled: true,
          hasGeneratedPrompt: true,
          generatedAt: '2026-01-01T00:00:00Z',
          detectedStack: null,
          cacheValid: true,
        },
      } as unknown as Awaited<
        ReturnType<EnhancedPromptsService['regenerate']>
      >);
      h.handlers.register();

      const result = await call<{ success: boolean; status?: unknown }>(
        h,
        'enhancedPrompts:regenerate',
        { workspacePath: '/x' },
      );

      expect(h.enhancedPrompts.regenerate).toHaveBeenCalled();
      const [, request] = h.enhancedPrompts.regenerate.mock.calls[0];
      expect(request).toMatchObject({ force: true });
      expect(result.success).toBe(true);
      expect(result.status).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:getPromptContent
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:getPromptContent', () => {
    it('returns null content when workspacePath is missing', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ content: string | null; error?: string }>(
        h,
        'enhancedPrompts:getPromptContent',
        {},
      );

      expect(result.content).toBeNull();
      expect(result.error).toMatch(/workspace path is required/i);
    });

    it('returns the service content when present', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getFullCombinedPromptContent.mockResolvedValue(
        '# Generated',
      );
      h.handlers.register();

      const result = await call<{ content: string | null }>(
        h,
        'enhancedPrompts:getPromptContent',
        { workspacePath: '/x' },
      );

      expect(result.content).toBe('# Generated');
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:download
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:download', () => {
    it('rejects when workspacePath is missing', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:download',
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workspace path is required/i);
      expect(h.saveDialog.showSaveAndWrite).not.toHaveBeenCalled();
    });

    it('rejects when no generated content exists', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getFullCombinedPromptContent.mockResolvedValue(null);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:download',
        { workspacePath: '/x' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/generate enhanced prompts first/i);
      expect(h.saveDialog.showSaveAndWrite).not.toHaveBeenCalled();
    });

    it('invokes the save dialog with the expected filename/filters/title', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getFullCombinedPromptContent.mockResolvedValue(
        '# Hello',
      );
      h.saveDialog.showSaveAndWrite.mockResolvedValue('/tmp/out.md');
      h.handlers.register();

      const result = await call<{ success: boolean; filePath?: string }>(
        h,
        'enhancedPrompts:download',
        { workspacePath: '/x' },
      );

      expect(h.saveDialog.showSaveAndWrite).toHaveBeenCalledTimes(1);
      const [opts] = h.saveDialog.showSaveAndWrite.mock.calls[0];
      expect(opts.defaultFilename).toBe('enhanced-prompt.md');
      expect(opts.filters).toEqual({ Markdown: ['md'] });
      expect(opts.title).toBe('Save Enhanced Prompt');
      expect(Buffer.isBuffer(opts.content)).toBe(true);
      expect((opts.content as Buffer).toString('utf-8')).toBe('# Hello');

      expect(result.success).toBe(true);
      expect(result.filePath).toBe('/tmp/out.md');
    });

    it('surfaces a cancellation message when the user closes the save dialog', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getFullCombinedPromptContent.mockResolvedValue(
        '# Hello',
      );
      h.saveDialog.showSaveAndWrite.mockResolvedValue(null);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:download',
        { workspacePath: '/x' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cancelled/i);
    });
  });
});
