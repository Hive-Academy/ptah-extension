import 'reflect-metadata';
import { container } from 'tsyringe';
import type { SessionId } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { VirtualTimeScheduler } from 'rxjs';
import { SDK_TOKENS } from '../di/tokens';
import type { CompactionCallbackRegistry } from './compaction-callback-registry';
import type { CompactionConfigProvider } from './compaction-config-provider';
import { CompactionCoordinator } from './compaction/compaction-coordinator';
import { IdleCompactionService } from './compaction/idle/idle-compaction.service';
import {
  IDLE_CACHE_TTL_MS,
  IDLE_CLAIM_TIMEOUT_MS,
} from './compaction/idle/idle-compaction.types';
import type { SessionTurnStateRegistry } from './session-turn-state.registry';
import { SessionLifecycleManager } from './session-lifecycle-manager';
import type { SessionStreamPump } from './session-lifecycle/session-stream-pump.service';
import type { SessionQueryExecutor } from './session-lifecycle/session-query-executor.service';

function resolvedManager(
  idle?: IdleCompactionService,
): SessionLifecycleManager {
  const child = container.createChildContainer();
  const required = [
    TOKENS.LOGGER,
    SDK_TOKENS.SDK_PERMISSION_HANDLER,
    SDK_TOKENS.SDK_MODULE_LOADER,
    SDK_TOKENS.SDK_QUERY_OPTIONS_BUILDER,
    SDK_TOKENS.SDK_MESSAGE_FACTORY,
    TOKENS.SUBAGENT_REGISTRY_SERVICE,
    AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV,
    AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER,
    SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY,
    SDK_TOKENS.SDK_QUERY_RUNNER,
  ];
  for (const token of required) child.registerInstance(token, {});
  if (idle) child.registerInstance(SDK_TOKENS.SDK_IDLE_COMPACTION, idle);
  return child.resolve(SessionLifecycleManager);
}

function executorIdle(
  manager: SessionLifecycleManager,
): IdleCompactionService | null {
  const executor = (
    manager as unknown as { _queryExecutor: SessionQueryExecutor }
  )._queryExecutor;
  return (executor as unknown as { idle: IdleCompactionService | null }).idle;
}

function harness() {
  const sendMessage = jest.fn<
    Promise<void>,
    [SessionId, string, string[]?, unknown[]?, object?]
  >(async () => undefined);
  const input = jest.fn();
  const promptPrefixChanged = jest.fn();
  const dispose = jest.fn();
  const boundaryNoticeFor = jest.fn();
  const setSessionModel = jest.fn(async () => undefined);
  const manager = Object.assign(
    Object.create(SessionLifecycleManager.prototype) as object,
    {
      _streamPump: { sendMessage } as unknown as SessionStreamPump,
      _registry: {
        find: jest.fn(() => undefined),
        stopEvictionSweep: jest.fn(),
      },
      idleCompaction: {
        input,
        promptPrefixChanged,
        dispose,
        boundaryNoticeFor,
      } as unknown as IdleCompactionService,
      _control: { setSessionModel },
    },
  ) as unknown as SessionLifecycleManager;
  return {
    manager,
    sendMessage,
    input,
    promptPrefixChanged,
    dispose,
    boundaryNoticeFor,
    setSessionModel,
  };
}

describe('SessionLifecycleManager idle compaction facade', () => {
  it('passes the registered idle service to the query executor', () => {
    const idle = { dispose: jest.fn() } as unknown as IdleCompactionService;
    const manager = resolvedManager(idle);
    expect(executorIdle(manager)).toBe(idle);
    manager.dispose();
  });

  it('passes null to the query executor when the idle token is unregistered', () => {
    const manager = resolvedManager();
    expect(executorIdle(manager)).toBeNull();
    manager.dispose();
  });

  it('sends /compact with coordinator origin and no input signal', async () => {
    const h = harness();
    const before = jest.fn();
    await expect(
      h.manager.sendIdleCompact('current' as SessionId, before),
    ).resolves.toBeUndefined();
    expect(h.sendMessage).toHaveBeenCalledWith(
      'current',
      '/compact',
      undefined,
      undefined,
      {
        origin: { kind: 'coordinator' },
        admission: 'require-idle',
        beforeEnqueue: before,
      },
    );
    expect(h.input).not.toHaveBeenCalled();
  });

  it('propagates pump rejection and settles the sender promise', async () => {
    const h = harness();
    h.sendMessage.mockRejectedValueOnce(new Error('claim veto'));
    await expect(
      h.manager.sendIdleCompact('current' as SessionId, jest.fn()),
    ).rejects.toThrow('claim veto');
  });

  it('forwards ordinary input and model changes to the idle service', async () => {
    const h = harness();
    await h.manager.sendMessage('current' as SessionId, 'hello');
    expect(h.input).toHaveBeenCalledWith('current');
    await h.manager.setSessionModel('current' as SessionId, 'sonnet');
    expect(h.promptPrefixChanged).toHaveBeenCalledWith('current');
    expect(h.setSessionModel).toHaveBeenCalledWith('current', 'sonnet');
  });

  it('uses the current id passed after a rekey', async () => {
    const h = harness();
    await h.manager.sendIdleCompact('new-id' as SessionId, jest.fn());
    expect(h.sendMessage).toHaveBeenCalledWith(
      'new-id',
      '/compact',
      undefined,
      undefined,
      expect.any(Object),
    );
  });

  it('delegates boundary notice and releases the idle service on dispose', () => {
    const h = harness();
    h.boundaryNoticeFor.mockReturnValue({ preTokens: 210_000 });
    expect(h.manager.idleCompactionNoticeFor('current' as SessionId)).toEqual({
      preTokens: 210_000,
    });
    h.manager.dispose();
    expect(h.dispose).toHaveBeenCalledTimes(1);
  });

  it('handles PreCompact before the send promise resolves', async () => {
    const scheduler = new VirtualTimeScheduler();
    scheduler.maxFrames = 0;
    let now = 0;
    let preCompact: ((data: { sessionId: string }) => void) | undefined;
    const warn = jest.fn();
    const logger = {
      info: jest.fn(),
      warn,
      debug: jest.fn(),
    } as unknown as Logger;
    const coordinator = new CompactionCoordinator();
    coordinator.register('current', { codexProxy: false, e2Passed: true });
    coordinator.register('new-id', { codexProxy: false, e2Passed: true });
    const config = {
      getIdleCompactionConfig: () => ({ enabled: true, minTokens: 200_000 }),
      getConfig: () => ({ enabled: true }),
    } as CompactionConfigProvider;
    const turns = {
      get: () => ({ phase: 'idle' }),
    } as unknown as SessionTurnStateRegistry;
    const callbacks = {
      register: (listener: typeof preCompact) => {
        preCompact = listener;
        return () => undefined;
      },
    } as unknown as CompactionCallbackRegistry;
    const facade = harness();
    facade.sendMessage.mockImplementation(
      async (_id, _content, _files, _images, options) => {
        (options as { beforeEnqueue: () => void }).beforeEnqueue();
        preCompact?.({ sessionId: 'new-id' });
      },
    );
    const sender = {
      sendIdleCompact: jest.fn((id: string, before: () => void) =>
        facade.manager.sendIdleCompact(id as SessionId, before),
      ),
    };
    const service = new IdleCompactionService(
      logger,
      coordinator,
      config,
      turns,
      sender,
      callbacks,
      null,
      null,
      { scheduler, now: () => now },
    );
    service.sessionBound('current', 'run', false);
    service.turnEnded('current', 'turn', {
      requestKey: 'request',
      anchorAt: 0,
      ttl: '1h',
    });
    service.turnContext('current', 'turn', 250_000);
    service.rekey('current', 'new-id');
    now = IDLE_CACHE_TTL_MS * 0.9;
    scheduler.maxFrames = now;
    scheduler.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(sender.sendIdleCompact).toHaveBeenCalledTimes(1);
    expect(facade.sendMessage).toHaveBeenCalledWith(
      'new-id',
      '/compact',
      undefined,
      undefined,
      expect.any(Object),
    );
    now += IDLE_CLAIM_TIMEOUT_MS;
    scheduler.maxFrames = now;
    scheduler.flush();
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'claim-timeout' }),
    );
    service.dispose();
    coordinator.dispose();
  });
});
