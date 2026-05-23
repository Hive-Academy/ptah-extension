import 'reflect-metadata';
import { container } from 'tsyringe';

import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  SubagentStopCallbackRegistry,
  type SubagentStopPayload,
} from './subagent-stop-callback-registry';
import { SDK_TOKENS } from '../di/tokens';

const makeLogger = (): jest.Mocked<Logger> =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as jest.Mocked<Logger>;

const makePayload = (
  overrides: Partial<SubagentStopPayload> = {},
): SubagentStopPayload => ({
  subagentSessionId: 'sub-1',
  parentSessionId: 'parent-1',
  workspaceRoot: '/workspace',
  agentId: 'agent-1',
  agentType: 'backend-developer',
  transcriptPath: '/tmp/transcripts/sub-1.jsonl',
  timestamp: 1700000000000,
  ...overrides,
});

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('SubagentStopCallbackRegistry', () => {
  it('starts with zero subscribers and is a no-op without listeners', () => {
    const registry = new SubagentStopCallbackRegistry(makeLogger());
    expect(registry.size).toBe(0);
    expect(() => registry.notifyAll(makePayload())).not.toThrow();
  });

  it('invokes a registered callback with the exact payload', () => {
    const registry = new SubagentStopCallbackRegistry(makeLogger());
    const cb = jest.fn();
    registry.register(cb);

    const payload = makePayload();
    registry.notifyAll(payload);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(payload);
    expect(registry.size).toBe(1);
  });

  it('returned disposer removes only that callback and is no-op on double-dispose', () => {
    const registry = new SubagentStopCallbackRegistry(makeLogger());
    const a = jest.fn();
    const b = jest.fn();
    const disposeA = registry.register(a);
    registry.register(b);

    disposeA();
    disposeA();
    registry.notifyAll(makePayload());

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(1);
  });

  it('fans out to multiple subscribers', () => {
    const registry = new SubagentStopCallbackRegistry(makeLogger());
    const a = jest.fn();
    const b = jest.fn();
    const c = jest.fn();
    registry.register(a);
    registry.register(b);
    registry.register(c);

    registry.notifyAll(makePayload());

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(3);
  });

  it('isolates a throwing sync subscriber so siblings still fire', () => {
    const logger = makeLogger();
    const registry = new SubagentStopCallbackRegistry(logger);
    const failing = jest.fn(() => {
      throw new Error('boom');
    });
    const survivor = jest.fn();
    registry.register(failing);
    registry.register(survivor);

    registry.notifyAll(makePayload());

    expect(failing).toHaveBeenCalledTimes(1);
    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[SubagentStopCallbackRegistry] subscriber threw',
      expect.any(Error),
    );
  });

  it('isolates a rejecting async subscriber so siblings still fire', async () => {
    const logger = makeLogger();
    const registry = new SubagentStopCallbackRegistry(logger);
    const failing = jest.fn(async () => {
      throw new Error('async boom');
    });
    const survivor = jest.fn();
    registry.register(failing);
    registry.register(survivor);

    registry.notifyAll(makePayload());
    await flushMicrotasks();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[SubagentStopCallbackRegistry] async subscriber threw',
      expect.any(Error),
    );
  });

  it('resolves via DI container under SDK_SUBAGENT_STOP_CALLBACK_REGISTRY token', () => {
    const testContainer = container.createChildContainer();
    testContainer.registerInstance(TOKENS.LOGGER, makeLogger());
    testContainer.registerSingleton(
      SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY,
      SubagentStopCallbackRegistry,
    );

    const resolved = testContainer.resolve<SubagentStopCallbackRegistry>(
      SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY,
    );

    expect(resolved).toBeInstanceOf(SubagentStopCallbackRegistry);
    expect(resolved.size).toBe(0);
  });
});
