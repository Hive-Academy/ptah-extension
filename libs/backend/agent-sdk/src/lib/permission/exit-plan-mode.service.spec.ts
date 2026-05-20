import 'reflect-metadata';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { PermissionResult } from '../types/sdk-types/claude-sdk.types';
import type { WebviewManagerLike } from './ask-user-question.service';
import { ExitPlanModeService } from './exit-plan-mode.service';

interface SentMessage {
  viewType: string;
  type: string;
  payload: Record<string, unknown>;
}

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

function makeService(
  requestUserPermission: jest.Mock<Promise<PermissionResult>, unknown[]>,
): {
  service: ExitPlanModeService;
  logger: MockLogger;
  sent: SentMessage[];
} {
  const logger = createMockLogger();
  const sent: SentMessage[] = [];

  const webviewManager = {
    sendMessage: jest.fn(
      async (
        viewType: string,
        type: string,
        payload: Record<string, unknown>,
      ) => {
        sent.push({ viewType, type, payload });
        return true;
      },
    ),
  };

  const service = new ExitPlanModeService(
    webviewManager as unknown as WebviewManagerLike,
    asLogger(logger),
    requestUserPermission as unknown as ConstructorParameters<
      typeof ExitPlanModeService
    >[2],
  );

  return { service, logger, sent };
}

describe('ExitPlanModeService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns deny when input is missing plan field', async () => {
    const delegate = jest.fn<Promise<PermissionResult>, unknown[]>();
    const { service, logger } = makeService(delegate);

    const result = await service.handleExitPlanMode(
      { not_plan: 'oops' },
      'tool-1',
    );

    expect(result.behavior).toBe('deny');
    expect(delegate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid ExitPlanMode input'),
      expect.anything(),
    );
  });

  it('delegates to requestUserPermission with toolName ExitPlanMode and forwards routing context', async () => {
    const delegate = jest.fn<Promise<PermissionResult>, unknown[]>(
      async () => ({
        behavior: 'allow',
        updatedInput: { plan: 'do it' },
      }),
    );
    const { service } = makeService(delegate);

    const SESSION_ID = '11111111-2222-4333-8444-555555555555';
    const TAB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    await service.handleExitPlanMode(
      { plan: 'do it' },
      'tool-2',
      SESSION_ID as never,
      undefined,
      TAB_ID as never,
    );

    expect(delegate).toHaveBeenCalledTimes(1);
    const args = delegate.mock.calls[0]!;
    expect(args[0]).toBe('ExitPlanMode');
    expect(args[1]).toEqual({ plan: 'do it' });
    expect(args[2]).toBe('tool-2');
    expect(args[3]).toBe(SESSION_ID);
    expect(args[7]).toBe(TAB_ID);
  });

  it('broadcasts PLAN_MODE_CHANGED active:false on approval', async () => {
    const delegate = jest.fn<Promise<PermissionResult>, unknown[]>(
      async () => ({
        behavior: 'allow',
        updatedInput: { plan: 'do it' },
      }),
    );
    const { service, sent } = makeService(delegate);

    await service.handleExitPlanMode({ plan: 'do it' }, 'tool-3');

    await Promise.resolve();
    await Promise.resolve();

    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.PLAN_MODE_CHANGED,
    );
    expect(broadcast).toBeDefined();
    expect(broadcast!.payload).toEqual({ active: false });
  });

  it('does not broadcast PLAN_MODE_CHANGED when denied', async () => {
    const delegate = jest.fn<Promise<PermissionResult>, unknown[]>(
      async () => ({
        behavior: 'deny',
        message: 'nope',
      }),
    );
    const { service, sent, logger } = makeService(delegate);

    const result = await service.handleExitPlanMode(
      { plan: 'do it' },
      'tool-4',
    );

    expect(result.behavior).toBe('deny');
    const broadcast = sent.find(
      (m) => m.type === MESSAGE_TYPES.PLAN_MODE_CHANGED,
    );
    expect(broadcast).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('ExitPlanMode denied'),
    );
  });
});
