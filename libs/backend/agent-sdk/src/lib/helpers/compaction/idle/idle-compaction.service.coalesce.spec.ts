import { VirtualTimeScheduler } from 'rxjs';
import type { Logger } from '@ptah-extension/vscode-core';
import type { CompactionConfigProvider } from '../../compaction-config-provider';
import type { CompactionCallbackRegistry } from '../../compaction-callback-registry';
import type { SdkAdapterEvents } from '../../sdk-adapter-events.service';
import type { SessionTurnStateRegistry } from '../../session-turn-state.registry';
import { CompactionCoordinator } from '../compaction-coordinator';
import { CompactionState } from '../compaction-state.types';
import {
  IDLE_CACHE_TTL_MS,
  IDLE_POSTCOMPACT_GRACE_MS,
  type IdleCompactSender,
} from './idle-compaction.types';
import { IdleCompactionService } from './idle-compaction.service';

const DUE = IDLE_CACHE_TTL_MS * 0.9;
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

function harness(send?: IdleCompactSender['sendIdleCompact']) {
  let now = 0;
  let throwSettings = false;
  const scheduler = new VirtualTimeScheduler();
  scheduler.maxFrames = 0;
  const debug = jest.fn();
  const info = jest.fn();
  const warn = jest.fn();
  const logger = { debug, info, warn } as unknown as Logger;
  const coordinator = new CompactionCoordinator({
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  });
  const config = {
    getIdleCompactionConfig: () => {
      if (throwSettings) {
        throwSettings = false;
        throw new Error('settings failure');
      }
      return { enabled: true, minTokens: 200_000 };
    },
    getConfig: () => ({ enabled: true }),
  } as CompactionConfigProvider;
  const turns = {
    get: () => ({ phase: 'idle' }),
  } as unknown as SessionTurnStateRegistry;
  let pre: ((data: { sessionId: string }) => void) | undefined;
  const callbacks = {
    register: (listener: typeof pre) => {
      pre = listener;
      return () => {
        pre = undefined;
      };
    },
  } as unknown as CompactionCallbackRegistry;
  let post: ((event: { sessionId: string }) => void) | undefined;
  const events = {
    onCompactionComplete: (listener: typeof post) => {
      post = listener;
      return () => {
        post = undefined;
      };
    },
  } as unknown as SdkAdapterEvents;
  const sender = {
    sendIdleCompact: jest.fn(send ?? (async (_id, before) => before())),
  };
  const service = new IdleCompactionService(
    logger,
    coordinator,
    config,
    turns,
    sender,
    callbacks,
    events,
    null,
    { scheduler, now: () => now },
  );
  const arm = (id = 's', run = 'run-1') => {
    coordinator.register(id, { codexProxy: false, e2Passed: true });
    service.sessionBound(id, run, false);
    service.turnEnded(id, 'turn', {
      requestKey: 'request',
      anchorAt: now,
      ttl: '1h',
    });
    service.turnContext(id, 'turn', 250_000);
  };
  const advance = (frame: number) => {
    now = frame;
    scheduler.maxFrames = frame;
    scheduler.flush();
  };
  const retained = () =>
    service as unknown as {
      aliases: Map<string, string>;
      keys: Map<string, Set<string>>;
      currentIds: Map<string, string>;
      notices: Map<string, { preTokens: number }>;
    };
  return {
    service,
    sender,
    scheduler,
    coordinator,
    arm,
    advance,
    retained,
    info,
    warn,
    debug,
    pre: (id = 's') => pre?.({ sessionId: id }),
    post: (id = 's') => {
      coordinator.onPostCompact(id, id);
      post?.({ sessionId: id });
    },
    failNextSettings: () => {
      throwSettings = true;
    },
    dispose: () => {
      service.dispose();
      coordinator.dispose();
    },
  };
}

describe('IdleCompactionService ordering, coalescing and cleanup', () => {
  it('lets a manual reservation win before the idle enqueue and emits no notice', async () => {
    let beforeIdle!: () => void;
    const h = harness(async (_id, before) => {
      beforeIdle = before;
    });
    h.arm();
    h.advance(DUE);
    const manual = h.coordinator.admitManualCompact('s');
    expect(manual.decision.action).toBe('send');
    expect(manual.reservationId).toBeDefined();
    expect(() => beforeIdle()).toThrow('manual-reserved');
    await settle();
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    expect(h.service.boundaryNoticeFor('s')).toBeUndefined();
    h.dispose();
  });

  it('coalesces manual admission after the idle claim and publishes one boundary notice', async () => {
    const h = harness();
    h.arm();
    h.advance(DUE);
    await settle();
    expect(h.coordinator.getIdleClaim('s')).toBeDefined();
    expect(h.coordinator.admitManualCompact('s').decision.action).toBe(
      'coalesced',
    );
    h.coordinator.onPreCompact('s', 'manual');
    h.pre();
    h.service.compactBoundary('s', 240_000);
    expect(h.service.boundaryNoticeFor('s')).toEqual({ preTokens: 240_000 });
    h.post();
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    expect(h.sender.sendIdleCompact).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it('keeps the claim through boundary and result until PostCompact', async () => {
    const h = harness();
    h.arm();
    h.advance(DUE);
    await settle();
    h.coordinator.onPreCompact('s', 'manual');
    h.pre();
    h.service.compactBoundary('s', 230_000);
    h.coordinator.onCompactBoundary('s', {
      preTokens: 230_000,
      postTokens: 20_000,
    });
    h.service.turnEnded('s', 'result', null);
    expect(h.coordinator.admitManualCompact('s').decision.action).toBe(
      'coalesced',
    );
    expect(h.coordinator.getIdleClaim('s')).toBeDefined();
    expect(h.service.boundaryNoticeFor('s')).toEqual({ preTokens: 230_000 });
    h.post();
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    expect(h.sender.sendIdleCompact).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it.each([true, false])(
    'admits a reserved manual send immediately after PostCompact; acting=%s',
    async (acting) => {
      const h = harness();
      h.arm();
      if (!acting)
        h.coordinator.register('s', { codexProxy: false, e2Passed: false });
      h.advance(DUE);
      await settle();
      if (acting) h.coordinator.onPreCompact('s', 'manual');
      h.pre();
      h.post();
      expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
      const manualSend = jest.fn();
      const admission = h.coordinator.admitManualCompact('s');
      if (admission.decision.action === 'send')
        manualSend(admission.reservationId);
      expect(manualSend).toHaveBeenCalledWith(expect.any(String));
      expect(h.scheduler.frame).toBe(DUE);
      h.dispose();
    },
  );

  it.each([true, false])(
    'PostCompact first allows immediate manual send and scopes notice to old boundary; acting=%s',
    async (acting) => {
      const h = harness();
      h.arm();
      if (!acting)
        h.coordinator.register('s', { codexProxy: false, e2Passed: false });
      h.advance(DUE);
      await settle();
      expect(h.coordinator.getIdleClaim('s')).toBeDefined();
      if (acting) h.coordinator.onPreCompact('s', 'manual');
      h.pre();
      h.post();
      expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
      if (acting)
        expect(h.coordinator.getState('s')).toBe(CompactionState.TRIGGERED);
      else
        expect(h.coordinator.getState('s')).toBe(CompactionState.OBSERVE_ONLY);
      const manualSend = jest.fn();
      const admission = h.coordinator.admitManualCompact('s');
      if (admission.decision.action === 'send')
        manualSend(admission.reservationId);
      expect(manualSend).toHaveBeenCalledWith(expect.any(String));
      expect(h.scheduler.frame).toBe(DUE);
      h.service.compactBoundary('s', 225_000);
      expect(h.service.boundaryNoticeFor('s')).toEqual({ preTokens: 225_000 });
      h.service.sessionBound('s', 'run-2', false);
      expect(h.service.boundaryNoticeFor('s')).toBeUndefined();
      h.service.compactBoundary('s', 12_000);
      expect(h.service.boundaryNoticeFor('s')).toBeUndefined();
      h.dispose();
    },
  );

  it.each([true, false])(
    'PostCompact without a boundary allows manual send and closes quietly; acting=%s',
    async (acting) => {
      const h = harness();
      h.arm();
      if (!acting)
        h.coordinator.register('s', { codexProxy: false, e2Passed: false });
      h.advance(DUE);
      await settle();
      if (acting) h.coordinator.onPreCompact('s', 'manual');
      h.pre();
      h.post();
      const admission = h.coordinator.admitManualCompact('s');
      expect(admission).toEqual({
        decision: { action: 'send' },
        reservationId: expect.any(String),
      });
      expect(h.scheduler.frame).toBe(DUE);
      h.advance(DUE + IDLE_POSTCOMPACT_GRACE_MS);
      expect(h.service.boundaryNoticeFor('s')).toBeUndefined();
      expect(h.warn).not.toHaveBeenCalled();
      expect(h.scheduler.actions).toHaveLength(0);
      h.dispose();
    },
  );

  it('times out a boundary without PostCompact and releases its claim', async () => {
    const h = harness();
    h.arm();
    h.advance(DUE);
    await settle();
    h.pre();
    h.service.compactBoundary('s', 240_000);
    h.service.turnEnded('s', 'result', null);
    h.advance(DUE + IDLE_POSTCOMPACT_GRACE_MS);
    expect(h.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'postcompact-timeout' }),
    );
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    h.dispose();
  });

  it.each(['input-first', 'due-first'] as const)(
    'orders input and feedback in the due frame: %s',
    async (order) => {
      const h = harness();
      if (order === 'input-first') {
        h.scheduler.schedule(() => {
          h.service.input('s');
          h.pre();
        }, DUE);
      }
      h.arm();
      if (order === 'due-first') {
        h.scheduler.schedule(() => {
          h.service.input('s');
          h.pre();
        }, DUE);
      }
      h.advance(DUE);
      await settle();
      expect(h.sender.sendIdleCompact.mock.calls.length).toBeLessThanOrEqual(1);
      if (order === 'input-first')
        expect(h.sender.sendIdleCompact).not.toHaveBeenCalled();
      h.dispose();
    },
  );

  it('vetoes an unresolved send after release without recreating a group or claim', async () => {
    let finish!: () => void;
    let veto: unknown;
    const h = harness(
      (_id, before) =>
        new Promise<void>((resolve, reject) => {
          finish = () => {
            try {
              before();
              resolve();
            } catch (error) {
              veto = error;
              reject(error);
            }
          };
        }),
    );
    h.arm();
    h.advance(DUE);
    h.service.sessionReleased('s');
    finish();
    await settle();
    expect(veto).toEqual(
      expect.objectContaining({ message: 'compaction-state' }),
    );
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    expect(h.scheduler.actions).toHaveLength(0);
    expect(h.retained().aliases.size).toBe(0);
    expect(h.retained().keys.size).toBe(0);
    expect(h.retained().currentIds.size).toBe(0);
    h.dispose();
  });

  it('ignores late send and deadline feedback for a released key', async () => {
    let finish!: () => void;
    const h = harness(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    h.arm();
    h.advance(DUE);
    h.service.sessionReleased('s');
    finish();
    await settle();
    h.advance(DUE + IDLE_POSTCOMPACT_GRACE_MS);
    expect(h.retained().aliases.size).toBe(0);
    expect(h.retained().keys.size).toBe(0);
    expect(h.scheduler.actions).toHaveLength(0);
    h.dispose();
  });

  it('keeps a new group when an old unresolved send finally completes', async () => {
    let finishOld!: () => void;
    const h = harness((id, before) =>
      id === 's' && !finishOld
        ? new Promise<void>((resolve) => {
            finishOld = resolve;
          })
        : Promise.resolve().then(before),
    );
    h.arm();
    h.advance(DUE);
    h.service.sessionReleased('s');
    h.service.sessionBound('s', 'run-2', false);
    h.service.turnEnded('s', 'turn-2', {
      requestKey: 'request-2',
      anchorAt: DUE,
      ttl: '1h',
    });
    h.service.turnContext('s', 'turn-2', 250_000);
    finishOld();
    await settle();
    expect(h.retained().aliases.get('s')).toBe('s');
    expect(h.retained().currentIds.get('s')).toBe('s');
    h.advance(DUE * 2);
    await settle();
    expect(h.sender.sendIdleCompact).toHaveBeenCalledTimes(2);
    h.dispose();
  });

  it('isolates a reducer failure and frees the failed group after release', async () => {
    const h = harness();
    h.arm('healthy');
    h.service.sessionBound('failed', 'run-1', false);
    h.failNextSettings();
    h.service.turnEnded('failed', 'turn', {
      requestKey: 'request',
      anchorAt: 0,
      ttl: '1h',
    });
    h.service.sessionReleased('failed');
    expect(h.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'signal-failed', sessionId: 'failed' }),
    );
    expect(h.warn).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'group-failed' }),
    );
    expect(h.retained().aliases.has('failed')).toBe(false);
    expect(h.retained().keys.has('failed')).toBe(false);
    expect(h.retained().currentIds.has('failed')).toBe(false);
    h.advance(DUE);
    await settle();
    expect(h.sender.sendIdleCompact).toHaveBeenCalledWith(
      'healthy',
      expect.any(Function),
    );
    expect(h.scheduler.actions).toHaveLength(1);
    h.service.sessionReleased('healthy');
    expect(h.scheduler.actions).toHaveLength(0);
    h.dispose();
  });

  it('releases 1,000 armed sessions with no timer actions or retained entries', () => {
    const h = harness();
    for (let i = 0; i < 1_000; i++) h.arm(`s-${i}`);
    expect(h.scheduler.actions).toHaveLength(1_000);
    for (let i = 0; i < 1_000; i++) h.service.sessionReleased(`s-${i}`);
    expect(h.scheduler.actions).toHaveLength(0);
    expect(h.retained().aliases.size).toBe(0);
    expect(h.retained().keys.size).toBe(0);
    expect(h.retained().currentIds.size).toBe(0);
    expect(h.retained().notices.size).toBe(0);
    h.dispose();
  });

  it('keeps other sessions firing when warning logging always throws', async () => {
    const h = harness();
    h.warn.mockImplementation(() => {
      throw new Error('logger failed');
    });
    h.service.sessionBound('failed', 'run', false);
    h.failNextSettings();
    h.service.turnEnded('failed', 'turn', {
      requestKey: 'request',
      anchorAt: 0,
      ttl: '1h',
    });
    h.service.sessionReleased('failed');
    h.arm('healthy');
    h.advance(DUE);
    await settle();
    expect(h.sender.sendIdleCompact).toHaveBeenCalledWith(
      'healthy',
      expect.any(Function),
    );
    h.dispose();
  });

  it('warns with ids when a rekey collides', () => {
    const h = harness();
    h.arm('s');
    h.arm('other');
    h.service.rekey('s', 'other');
    expect(h.warn).toHaveBeenCalledWith(expect.any(String), {
      reason: 'rekey-collision',
      sessionId: 's',
      toId: 'other',
    });
    h.dispose();
  });
});
