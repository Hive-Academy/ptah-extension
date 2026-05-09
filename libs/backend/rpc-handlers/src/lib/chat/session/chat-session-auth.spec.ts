/**
 * ChatSessionService — workspace authorization gate specs (PR-267 Fix #1).
 *
 * Surface under test: the `isAuthorizedWorkspace` guard added to
 * `startSession`, `continueSession`, and `resumeSession`.
 *
 * Strategy: instantiate `ChatSessionService` directly with minimal stubs
 * for all constructor params. Tests only exercise the early-return paths
 * triggered by an unauthorized `workspacePath`. Service-level business
 * logic is not tested here (it has many dependencies that would require
 * heavy mocking).
 *
 * Mocking posture: explicit IWorkspaceProvider stubs with concrete folder
 * lists — the gate logic is actually exercised.
 */

import 'reflect-metadata';

import type {
  Logger,
  ConfigManager,
  SentryService,
  LicenseService,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  ChatStartParams,
  ChatContinueParams,
  ChatResumeParams,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';

import { ChatSessionService } from './chat-session.service';

const OPEN_FOLDER = '/c/projects/my-repo';
const EVIL_PATH = '/tmp/evil-directory';

function makeService(
  workspaceProvider: IWorkspaceProvider,
  logger: MockLogger,
): ChatSessionService {
  const noop = jest.fn();
  const stub = { then: undefined } as unknown;

  return new ChatSessionService(
    logger as unknown as Logger,
    { broadcastMessage: noop } as never,
    {
      get: noop,
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as ConfigManager,
    stub as never,
    { captureException: jest.fn() } as unknown as SentryService,
    stub as never,
    stub as never,
    stub as unknown as SubagentRegistryService,
    {
      verifyLicense: jest
        .fn()
        .mockResolvedValue({ valid: false, tier: 'free' }),
    } as unknown as LicenseService,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    stub as never,
    workspaceProvider,
    stub as never,
    {
      handleStart: jest.fn().mockResolvedValue({ result: { success: false } }),
    } as never,
    stub as never,
    stub as never,
    stub as never,
  );
}

describe('ChatSessionService — workspace authorization gate', () => {
  const logger = createMockLogger();

  describe('startSession (chat:start)', () => {
    it('returns success:false with Access denied when renderer supplies unauthorized workspacePath', async () => {
      const provider = createMockWorkspaceProvider({ folders: [OPEN_FOLDER] });
      const svc = makeService(
        provider as unknown as IWorkspaceProvider,
        logger,
      );

      const params: ChatStartParams = {
        prompt: 'Hello',
        tabId: 'tab1',
        workspacePath: EVIL_PATH,
      };

      const result = await svc.startSession(params);
      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toMatch(/Access denied/);
    });

    it('does not gate when workspacePath is absent (backend fallback is trusted)', async () => {
      const provider = createMockWorkspaceProvider({ folders: [OPEN_FOLDER] });
      const svc = makeService(
        provider as unknown as IWorkspaceProvider,
        logger,
      );

      const params: ChatStartParams = {
        prompt: 'Hello',
        tabId: 'tab1',
      };

      const result = await svc.startSession(params);
      // Must not be an "Access denied" error — may fail for other reasons
      // (license, Ptah CLI dispatch) but not authorization.
      if (!result.success) {
        expect((result as { error: string }).error).not.toMatch(
          /Access denied/,
        );
      }
    });
  });

  describe('continueSession (chat:continue)', () => {
    it('returns success:false with Access denied when renderer supplies unauthorized workspacePath', async () => {
      const provider = createMockWorkspaceProvider({ folders: [OPEN_FOLDER] });
      const svc = makeService(
        provider as unknown as IWorkspaceProvider,
        logger,
      );

      const params: ChatContinueParams = {
        prompt: 'More',
        sessionId: 'sess-1' as never,
        tabId: 'tab1',
        workspacePath: EVIL_PATH,
      };

      const result = await svc.continueSession(params);
      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toMatch(/Access denied/);
    });
  });

  describe('resumeSession (chat:resume)', () => {
    it('returns success:false with Access denied when renderer supplies unauthorized workspacePath', async () => {
      const provider = createMockWorkspaceProvider({ folders: [OPEN_FOLDER] });
      const svc = makeService(
        provider as unknown as IWorkspaceProvider,
        logger,
      );

      const params: ChatResumeParams = {
        sessionId: 'sess-1' as never,
        tabId: 'tab1',
        workspacePath: EVIL_PATH,
      };

      const result = await svc.resumeSession(params);
      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toMatch(/Access denied/);
    });
  });
});
