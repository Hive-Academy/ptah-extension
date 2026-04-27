/**
 * Setup Wizard Service (Facade) Unit Tests
 *
 * Covers the thin facade API introduced in TASK_2025_115:
 *  - launchWizard(workspacePath)
 *  - cancelWizard(sessionId, saveProgress)
 *  - getCurrentSession()
 *
 * Old postMessage handlers, step-machine, and session management have been
 * removed from this service. The Angular SPA now communicates via RPC
 * handlers — those live (and are tested) elsewhere.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock vscode-core to avoid VS Code dependency
jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: {
    LOGGER: Symbol.for('Logger'),
    SENTRY_SERVICE: Symbol.for('SentryService'),
    PLATFORM_COMMANDS: Symbol.for('PlatformCommands'),
  },
}));

import { Result, MESSAGE_TYPES } from '@ptah-extension/shared';
import { SetupWizardService } from './setup-wizard.service';
import type { WizardWebviewLifecycleService } from './wizard';

// -----------------------------------------------------------------------------
// Mock interfaces — only methods actually used by SetupWizardService
// -----------------------------------------------------------------------------

interface MockLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

interface MockPanel {
  reveal: jest.Mock;
}

interface MockWebviewLifecycle {
  getPanel: jest.Mock;
  createWizardPanel: jest.Mock;
  disposeWebview: jest.Mock;
}

interface MockPlatformCommands {
  reloadWindow: jest.Mock;
}

interface MockSentryService {
  initialize: jest.Mock;
  captureException: jest.Mock;
  captureMessage: jest.Mock;
  addBreadcrumb: jest.Mock;
  flush: jest.Mock;
  shutdown: jest.Mock;
  isInitialized: jest.Mock;
}

// -----------------------------------------------------------------------------
// Suite
// -----------------------------------------------------------------------------

describe('SetupWizardService (facade)', () => {
  let service: SetupWizardService;
  let mockLogger: MockLogger;
  let mockWebviewLifecycle: MockWebviewLifecycle;
  let mockPlatformCommands: MockPlatformCommands;
  let mockSentryService: MockSentryService;
  let mockPanel: MockPanel;

  const WORKSPACE_PATH = '/workspace/test-project';

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockPanel = {
      reveal: jest.fn(),
    };

    mockWebviewLifecycle = {
      getPanel: jest.fn(() => undefined) as unknown as jest.Mock,
      createWizardPanel: jest.fn(async () => mockPanel) as unknown as jest.Mock,
      disposeWebview: jest.fn(),
    };

    mockPlatformCommands = {
      reloadWindow: jest.fn(async () => undefined) as unknown as jest.Mock,
    };

    mockSentryService = {
      initialize: jest.fn(),
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      addBreadcrumb: jest.fn(),
      flush: jest.fn(),
      shutdown: jest.fn(),
      isInitialized: jest.fn(),
    };

    service = new SetupWizardService(
      mockLogger as never,
      mockWebviewLifecycle as unknown as WizardWebviewLifecycleService,
      mockPlatformCommands as never,
      mockSentryService as never,
    );
  });

  // ---------------------------------------------------------------------------
  // launchWizard
  // ---------------------------------------------------------------------------

  describe('launchWizard', () => {
    it('should return error when workspace path is empty', async () => {
      const result = await service.launchWizard('');

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toBe('No workspace folder open');
      expect(mockWebviewLifecycle.createWizardPanel).not.toHaveBeenCalled();
    });

    it('should return error when workspace path is whitespace only', async () => {
      const result = await service.launchWizard('   ');

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toBe('No workspace folder open');
      expect(mockWebviewLifecycle.createWizardPanel).not.toHaveBeenCalled();
    });

    it('should create a new wizard panel when none exists', async () => {
      const result = await service.launchWizard(WORKSPACE_PATH);

      expect(result.isOk()).toBe(true);
      expect(mockWebviewLifecycle.getPanel).toHaveBeenCalledWith(
        'ptah.setupWizard',
      );
      expect(mockWebviewLifecycle.createWizardPanel).toHaveBeenCalledWith(
        'Ptah Setup Wizard',
        'ptah.setupWizard',
        expect.arrayContaining([expect.any(Function)]),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Wizard launched successfully',
      );
    });

    it('should reveal existing panel instead of creating a new one', async () => {
      mockWebviewLifecycle.getPanel.mockReturnValue(mockPanel);

      const result = await service.launchWizard(WORKSPACE_PATH);

      expect(result.isOk()).toBe(true);
      expect(mockPanel.reveal).toHaveBeenCalledTimes(1);
      expect(mockWebviewLifecycle.createWizardPanel).not.toHaveBeenCalled();
    });

    it('should return error when createWizardPanel returns null', async () => {
      (mockWebviewLifecycle.createWizardPanel as jest.Mock).mockImplementation(
        async () => null,
      );

      const result = await service.launchWizard(WORKSPACE_PATH);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain(
        'Failed to create wizard webview panel',
      );
    });

    it('should wrap thrown errors and capture to Sentry', async () => {
      const boom = new Error('panel creation blew up');
      (mockWebviewLifecycle.createWizardPanel as jest.Mock).mockImplementation(
        async () => {
          throw boom;
        },
      );

      const result = await service.launchWizard(WORKSPACE_PATH);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toBe(
        'Wizard launch failed: panel creation blew up',
      );
      expect(mockSentryService.captureException).toHaveBeenCalledWith(
        boom,
        expect.objectContaining({
          errorSource: 'SetupWizardService.launchWizard',
        }),
      );
    });

    it('should reload window when wizard-complete message received', async () => {
      let capturedHandler:
        | ((msg: unknown) => boolean | Promise<boolean>)
        | undefined;
      mockWebviewLifecycle.createWizardPanel.mockImplementation(
        (..._args: unknown[]) => {
          const handlers = _args[2] as Array<
            (msg: unknown) => boolean | Promise<boolean>
          >;
          capturedHandler = handlers[0];
          return Promise.resolve(mockPanel);
        },
      );

      await service.launchWizard(WORKSPACE_PATH);

      expect(capturedHandler).toBeDefined();
      const handled = await capturedHandler!({
        type: MESSAGE_TYPES.SETUP_WIZARD_COMPLETE,
      });

      expect(handled).toBe(true);
      expect(mockWebviewLifecycle.disposeWebview).toHaveBeenCalledWith(
        'ptah.setupWizard',
      );
      expect(mockPlatformCommands.reloadWindow).toHaveBeenCalledTimes(1);
    });

    it('should ignore unrelated messages in the handler', async () => {
      let capturedHandler:
        | ((msg: unknown) => boolean | Promise<boolean>)
        | undefined;
      mockWebviewLifecycle.createWizardPanel.mockImplementation(
        (..._args: unknown[]) => {
          const handlers = _args[2] as Array<
            (msg: unknown) => boolean | Promise<boolean>
          >;
          capturedHandler = handlers[0];
          return Promise.resolve(mockPanel);
        },
      );

      await service.launchWizard(WORKSPACE_PATH);

      const handled = await capturedHandler!({ type: 'some.other.message' });

      expect(handled).toBe(false);
      expect(mockPlatformCommands.reloadWindow).not.toHaveBeenCalled();
    });

    it('should swallow concurrent launches', async () => {
      // First call resolves on the next microtask tick
      let resolveCreate: (p: unknown) => void = () => undefined;
      mockWebviewLifecycle.createWizardPanel.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      );

      const first = service.launchWizard(WORKSPACE_PATH);
      const second = service.launchWizard(WORKSPACE_PATH);

      // Second call should short-circuit with Ok and a warn log while
      // first is still pending.
      const secondResult = await second;
      expect(secondResult.isOk()).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Wizard launch already in progress'),
      );

      // Now let the first one finish
      resolveCreate(mockPanel);
      const firstResult = await first;
      expect(firstResult.isOk()).toBe(true);

      // Only the first launch should have actually created a panel
      expect(mockWebviewLifecycle.createWizardPanel).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // cancelWizard
  // ---------------------------------------------------------------------------

  describe('cancelWizard', () => {
    it('should dispose the webview and return Ok', async () => {
      const result = await service.cancelWizard('session-123', false);

      expect(result.isOk()).toBe(true);
      expect(mockWebviewLifecycle.disposeWebview).toHaveBeenCalledWith(
        'ptah.setupWizard',
      );
    });

    it('should dispose the webview even when saveProgress is true', async () => {
      const result = await service.cancelWizard('session-123', true);

      expect(result.isOk()).toBe(true);
      expect(mockWebviewLifecycle.disposeWebview).toHaveBeenCalledWith(
        'ptah.setupWizard',
      );
    });

    it('should wrap thrown errors and capture to Sentry', async () => {
      const boom = new Error('dispose went wrong');
      mockWebviewLifecycle.disposeWebview.mockImplementation(() => {
        throw boom;
      });

      const result = await service.cancelWizard('session-123', false);

      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toBe(
        'Wizard cancellation failed: dispose went wrong',
      );
      expect(mockSentryService.captureException).toHaveBeenCalledWith(
        boom,
        expect.objectContaining({
          errorSource: 'SetupWizardService.cancelWizard',
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getCurrentSession
  // ---------------------------------------------------------------------------

  describe('getCurrentSession', () => {
    it('should always return null (facade no longer tracks sessions)', () => {
      expect(service.getCurrentSession()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Sanity check: ensure Result type is used, not a POJO
  // ---------------------------------------------------------------------------

  describe('Result integration', () => {
    it('launchWizard returns a Result-like object', async () => {
      const result = await service.launchWizard(WORKSPACE_PATH);
      expect(typeof result.isOk).toBe('function');
      expect(typeof result.isErr).toBe('function');
    });

    it('Result import is available', () => {
      expect(Result).toBeDefined();
    });
  });
});
