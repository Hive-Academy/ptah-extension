import 'reflect-metadata';
import { container } from 'tsyringe';

import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  UserPromptSubmitCallbackRegistry,
  type UserPromptSubmitPayload,
} from './user-prompt-submit-callback-registry';
import { SDK_TOKENS } from '../di/tokens';

const makeLogger = (): jest.Mocked<Logger> =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as jest.Mocked<Logger>;

const makePayload = (
  overrides: Partial<UserPromptSubmitPayload> = {},
): UserPromptSubmitPayload => ({
  prompt: 'do the thing',
  sessionId: 'sess-1',
  workspaceRoot: '/workspace',
  timestamp: 1700000000000,
  ...overrides,
});

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('UserPromptSubmitCallbackRegistry', () => {
  it('register/dispose lifecycle works and is no-op on double-dispose', () => {
    const registry = new UserPromptSubmitCallbackRegistry(makeLogger());
    const cb = jest.fn();
    const dispose = registry.register(cb);
    expect(registry.size).toBe(1);
    dispose();
    dispose();
    expect(registry.size).toBe(0);
    registry.notifyAll(makePayload());
    expect(cb).not.toHaveBeenCalled();
  });

  it('fans out notifyAll to all subscribers with the exact payload', () => {
    const registry = new UserPromptSubmitCallbackRegistry(makeLogger());
    const a = jest.fn();
    const b = jest.fn();
    registry.register(a);
    registry.register(b);

    const payload = makePayload({ prompt: 'another' });
    registry.notifyAll(payload);

    expect(a).toHaveBeenCalledWith(payload);
    expect(b).toHaveBeenCalledWith(payload);
  });

  it('isolates a throwing sync subscriber so siblings still fire', () => {
    const logger = makeLogger();
    const registry = new UserPromptSubmitCallbackRegistry(logger);
    registry.register(() => {
      throw new Error('boom');
    });
    const survivor = jest.fn();
    registry.register(survivor);

    registry.notifyAll(makePayload());

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[UserPromptSubmitCallbackRegistry] subscriber threw',
      expect.any(Error),
    );
  });

  it('isolates a rejecting async subscriber so siblings still fire', async () => {
    const logger = makeLogger();
    const registry = new UserPromptSubmitCallbackRegistry(logger);
    registry.register(async () => {
      throw new Error('async boom');
    });
    const survivor = jest.fn();
    registry.register(survivor);

    registry.notifyAll(makePayload());
    await flushMicrotasks();

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[UserPromptSubmitCallbackRegistry] async subscriber threw',
      expect.any(Error),
    );
  });

  it('resolves via DI under SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY token', () => {
    const testContainer = container.createChildContainer();
    testContainer.registerInstance(TOKENS.LOGGER, makeLogger());
    testContainer.registerSingleton(
      SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY,
      UserPromptSubmitCallbackRegistry,
    );

    const resolved = testContainer.resolve<UserPromptSubmitCallbackRegistry>(
      SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY,
    );

    expect(resolved).toBeInstanceOf(UserPromptSubmitCallbackRegistry);
    expect(resolved.size).toBe(0);
  });
});
