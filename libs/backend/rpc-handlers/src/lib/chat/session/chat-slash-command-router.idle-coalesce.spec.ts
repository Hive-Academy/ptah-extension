import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import type {
  IAgentAdapter,
  ChatContinueParams,
  SessionId,
} from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import {
  SDK_TOKENS,
  registerSdkServices,
  type ManualCompactAdmission,
} from '@ptah-extension/agent-sdk';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatSlashCommandRouterService } from './chat-slash-command-router.service';

type CoordinatorPort = ManualCompactAdmission & {
  register(
    sessionId: string,
    sessionClass: { codexProxy: boolean; e2Passed: boolean },
  ): unknown;
  claimIdle(sessionId: string, claimId: string): string;
  onPreCompact(sessionId: string, trigger: 'auto' | 'manual'): boolean;
  onPostCompact(sessionId: string, postCompactSessionId: string): boolean;
  onStatusCompacting(sessionId: string): boolean;
  dispose(): void;
};

const sessionId = 'session-1' as SessionId;
const params: ChatContinueParams = {
  prompt: '/compact',
  sessionId,
  tabId: 'tab-1',
};

function emptyStream(): AsyncIterable<never> {
  return (async function* () {
    /* no events */
  })();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeHarness(
  admission?: ManualCompactAdmission,
  resolveProvider = jest.fn().mockResolvedValue(undefined),
) {
  const executeSlashCommand = jest.fn().mockResolvedValue(emptyStream());
  const streamEventsToWebview = jest.fn();
  const router = new ChatSlashCommandRouterService(
    createMockLogger() as unknown as Logger,
    { broadcastMessage: jest.fn() } as never,
    createMockModelSettings() as unknown as ModelSettings,
    { executeSlashCommand } as unknown as IAgentAdapter,
    {
      intercept: jest.fn().mockReturnValue({
        action: 'new-query',
        commandName: 'compact',
        args: '',
        rawCommand: '/compact',
      }),
    } as never,
    {
      isMcpServerRunning: jest.fn().mockReturnValue(false),
      resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
    } as never,
    { streamEventsToWebview } as never,
    { resolveProviderProfileForWorkspace: resolveProvider } as never,
    admission,
  );
  const route = (routeParams: ChatContinueParams = params) =>
    router.routeFollowUpSlashCommand(
      '/compact',
      sessionId,
      'tab-1',
      undefined,
      routeParams,
    );
  return { route, executeSlashCommand, streamEventsToWebview, resolveProvider };
}

describe('manual /compact router admission', () => {
  let coordinator: CoordinatorPort;

  beforeEach(() => {
    const child = rootContainer.createChildContainer();
    const logger = createMockLogger() as unknown as Logger;
    child.register(TOKENS.LOGGER, { useValue: logger });
    child.register(TOKENS.CONFIG_MANAGER, {
      useValue: { watch: jest.fn(() => ({ dispose: jest.fn() })) },
    });
    child.register(PLATFORM_TOKENS.SECRET_STORAGE, {
      useValue: { onDidChange: jest.fn(() => ({ dispose: jest.fn() })) },
    });
    registerSdkServices(child, logger);
    coordinator = child.resolve<CoordinatorPort>(
      SDK_TOKENS.SDK_COMPACTION_COORDINATOR,
    );
    coordinator.register(sessionId, { codexProxy: false, e2Passed: true });
  });

  afterEach(() => coordinator.dispose());

  it('sends once and releases its reservation after the command resolves', async () => {
    const h = makeHarness(coordinator);
    h.executeSlashCommand.mockImplementation(() => {
      expect(coordinator.claimIdle(sessionId, 'idle-1')).toBe(
        'manual-reserved',
      );
      return Promise.resolve(emptyStream());
    });

    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).toHaveBeenCalledTimes(1);
    expect(coordinator.claimIdle(sessionId, 'idle-2')).toBe('claimed');
  });

  it('coalesces a held idle claim before provider resolution', async () => {
    expect(coordinator.claimIdle(sessionId, 'idle-1')).toBe('claimed');
    const h = makeHarness(coordinator);

    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.resolveProvider).not.toHaveBeenCalled();
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
  });

  it('coalesces an idle claim taken during provider resolution', async () => {
    const provider = deferred<undefined>();
    const h = makeHarness(
      coordinator,
      jest.fn().mockReturnValue(provider.promise),
    );
    const result = h.route();
    await Promise.resolve();
    expect(coordinator.claimIdle(sessionId, 'idle-1')).toBe('claimed');
    provider.resolve(undefined);

    await expect(result).resolves.toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
  });

  it('dedupes an open compaction before PostCompact', async () => {
    expect(coordinator.onPreCompact(sessionId, 'auto')).toBe(true);
    const h = makeHarness(coordinator);

    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
  });

  it('sends without an optional coordinator', async () => {
    const h = makeHarness();
    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).toHaveBeenCalledTimes(1);
  });

  it('fails open when the coordinator throws', async () => {
    const admission: ManualCompactAdmission = {
      requestManualCompact: jest.fn(() => {
        throw new Error('request failed');
      }),
      admitManualCompact: jest.fn(() => {
        throw new Error('admit failed');
      }),
      releaseManualReservation: jest.fn(),
    };
    const h = makeHarness(admission);

    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).toHaveBeenCalledTimes(1);
  });

  it('releases the reservation when executeSlashCommand rejects', async () => {
    const h = makeHarness(coordinator);
    h.executeSlashCommand.mockRejectedValue(new Error('runtime rejected'));

    await expect(h.route()).resolves.toMatchObject({
      success: false,
      sessionId,
    });
    expect(coordinator.claimIdle(sessionId, 'idle-1')).toBe('claimed');
  });

  it('releases the reservation when an argument throws before execution', async () => {
    const h = makeHarness(coordinator);
    const throwingParams = {
      ...params,
      get mcpToolProfile(): ChatContinueParams['mcpToolProfile'] {
        throw new Error('argument failed');
      },
    };
    const result = await h.route(throwingParams);

    expect(result).toMatchObject({ success: false, sessionId });
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
    expect(coordinator.claimIdle(sessionId, 'idle-1')).toBe('claimed');
  });

  it('clears the reservation after two overlapping manual sends settle', async () => {
    const first = deferred<AsyncIterable<never>>();
    const second = deferred<AsyncIterable<never>>();
    const h = makeHarness(coordinator);
    h.executeSlashCommand
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const one = h.route();
    const two = h.route();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.executeSlashCommand).toHaveBeenCalledTimes(2);
    expect(coordinator.claimIdle(sessionId, 'idle-1')).toBe('manual-reserved');
    first.resolve(emptyStream());
    await one;
    expect(coordinator.claimIdle(sessionId, 'idle-2')).toBe('manual-reserved');
    second.resolve(emptyStream());
    await two;
    expect(coordinator.claimIdle(sessionId, 'idle-3')).toBe('claimed');
  });

  it('sends after PreCompact, PostCompact, and a late compacting status', async () => {
    expect(coordinator.onPreCompact(sessionId, 'auto')).toBe(true);
    expect(coordinator.onPostCompact(sessionId, sessionId)).toBe(false);
    expect(coordinator.onStatusCompacting(sessionId)).toBe(true);
    const h = makeHarness(coordinator);

    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).toHaveBeenCalledTimes(1);
  });
});
