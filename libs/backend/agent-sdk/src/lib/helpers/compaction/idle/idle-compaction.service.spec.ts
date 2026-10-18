import 'reflect-metadata';
import { VirtualTimeScheduler } from 'rxjs';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SessionAdmissionRefusedError } from '../../../errors/session-admission-refused.error';
import type { CompactionCallbackRegistry } from '../../compaction-callback-registry';
import type { CompactionConfigProvider } from '../../compaction-config-provider';
import type { SdkAdapterEvents } from '../../sdk-adapter-events.service';
import type { SessionTurnStateRegistry } from '../../session-turn-state.registry';
import { SessionStatsOwnerService } from '../../../session-stats/session-stats-owner.service';
import { CompactionCoordinator } from '../compaction-coordinator';
import {
  COMPACTION_MAX_DWELL_MS,
  CompactionState,
} from '../compaction-state.types';
import {
  IDLE_CACHE_TTL_MS,
  IDLE_CLAIM_TIMEOUT_MS,
  IDLE_COMPACT_ORIGIN,
  type IdleCompactSender,
} from './idle-compaction.types';
import { IdleCompactionService } from './idle-compaction.service';

const DUE = IDLE_CACHE_TTL_MS * 0.9;
const request = { requestKey: 'request-1', anchorAt: 0, ttl: '1h' as const };

function harness(send?: IdleCompactSender['sendIdleCompact'], owner?: SessionStatsOwnerService) {
  let now = 0;
  const scheduler = new VirtualTimeScheduler();
  scheduler.maxFrames = 0;
  const debug = jest.fn();
  const info = jest.fn();
  const warn = jest.fn();
  const logger = { debug, info, warn } as unknown as Logger;
  const coordinatorTimeouts = new Map<number, () => void>();
  let nextTimeout = 0;
  const coordinator = new CompactionCoordinator({
    setTimeout: (callback) => {
      const id = ++nextTimeout;
      coordinatorTimeouts.set(id, callback);
      return id;
    },
    clearTimeout: (handle) => {
      coordinatorTimeouts.delete(handle as number);
    },
  });
  coordinator.register('s', { codexProxy: false, e2Passed: true });
  let enabled = true;
  let autoEnabled = true;
  let minimum = 200_000;
  let failSettingsOnce = false;
  let phase = 'idle';
  let onConfig:
    | ((event: { affectsConfiguration(section: string): boolean }) => void)
    | null = null;
  let onPre: ((data: { sessionId: string }) => void) | null = null;
  let onPost: ((event: { sessionId: string }) => void) | null = null;
  const offConfig = jest.fn();
  const offPre = jest.fn();
  const offPost = jest.fn();
  const config = {
    getIdleCompactionConfig: () => {
      if (failSettingsOnce) {
        failSettingsOnce = false;
        throw new Error('temporary config failure');
      }
      return { enabled, minTokens: minimum };
    },
    getConfig: () => ({ enabled: autoEnabled }),
  } as CompactionConfigProvider;
  const turns = {
    get: () => ({ phase }),
  } as unknown as SessionTurnStateRegistry;
  const callbacks = {
    register: (listener: typeof onPre) => {
      onPre = listener;
      return offPre;
    },
  } as unknown as CompactionCallbackRegistry;
  const events = {
    onCompactionComplete: (listener: typeof onPost) => {
      onPost = listener;
      return offPost;
    },
  } as unknown as SdkAdapterEvents;
  const workspace = {
    onDidChangeConfiguration: (listener: typeof onConfig) => {
      onConfig = listener;
      return { dispose: offConfig };
    },
  } as unknown as IWorkspaceProvider;
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
    workspace,
    { scheduler, now: () => now },
    owner,
  );
  const arm = (id = 's') => {
    service.sessionBound(id, 'run', false);
    service.turnEnded(id, 'turn', request);
    service.turnContext(id, 'turn', 250_000);
  };
  const advance = (frame: number, wall = frame) => {
    now = wall;
    scheduler.maxFrames = frame;
    scheduler.flush();
  };
  const change = (section: string) =>
    onConfig?.({ affectsConfiguration: (key) => key === section });
  return {
    service,
    scheduler,
    sender,
    coordinator,
    arm,
    advance,
    info,
    warn,
    debug,
    fireCoordinatorTimeouts: () => {
      for (const callback of [...coordinatorTimeouts.values()]) callback();
    },
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    setAutoEnabled: (value: boolean) => {
      autoEnabled = value;
    },
    setMinimum: (value: number) => {
      minimum = value;
    },
    failNextSettingsRead: () => {
      failSettingsOnce = true;
    },
    setPhase: (value: string) => {
      phase = value;
    },
    change,
    preCompact: (id = 's') => onPre?.({ sessionId: id }),
    postCompact: (id = 's') => onPost?.({ sessionId: id }),
    offConfig,
    offPre,
    offPost,
  };
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('IdleCompactionService', () => {
  it('projects confirmed writes, retained reads and the pending attempt, then clears the attempt on release', () => {
    const owner = new SessionStatsOwnerService();
    const lease = owner.startNew('s');
    owner.beginRun('s', lease.generation, 'run', null);
    const h = harness(undefined, owner);
    h.service.sessionBound('s', 'run', false, true);
    h.service.turnEnded('s', 'write', {
      ...request, cacheAnchorAt: 1_000, cacheWriteTokens: 12, cacheWriteTtl: '1h',
    });
    expect(owner.snapshot('s')?.cache).toEqual({
      ttl: '1h', lastRequestAt: 1_000, expiresAt: 3_601_000,
    });
    h.service.turnContext('s', 'write', 250_000);
    expect(owner.snapshot('s')?.cache?.idleCompactAt).toBe(DUE);
    h.service.input('s');
    expect(owner.snapshot('s')?.cache?.idleCompactAt).toBeUndefined();
    h.service.turnEnded('s', 'read', {
      ...request, cacheAnchorAt: 2_000, cacheReadTokens: 8,
    });
    expect(owner.snapshot('s')?.cache).toEqual({
      ttl: '1h', lastRequestAt: 2_000, expiresAt: 3_602_000,
    });
    h.service.turnEnded('s', 'ambiguous', {
      ...request, cacheAnchorAt: 3_000, cacheWriteTokens: 3,
    });
    expect(owner.snapshot('s')?.cache).toBeUndefined();
    expect(owner.getCacheTtl('s', 'run')).toBeNull();
    h.service.turnEnded('s', 'five', {
      ...request, cacheAnchorAt: 4_000, cacheWriteTokens: 1, cacheWriteTtl: '5m',
    });
    expect(owner.snapshot('s')?.cache?.expiresAt).toBe(304_000);
    h.service.sessionReleased('s');
    expect(owner.snapshot('s')?.cache?.idleCompactAt).toBeUndefined();
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('keeps the cache estimate when a turn ends without a main request', () => {
    const owner = new SessionStatsOwnerService();
    const lease = owner.startNew('s');
    owner.beginRun('s', lease.generation, 'run', null);
    const h = harness(undefined, owner);
    h.service.sessionBound('s', 'run', false, true);
    h.service.turnEnded('s', 'write', {
      ...request, cacheAnchorAt: 1_000, cacheWriteTokens: 12, cacheWriteTtl: '1h',
    });
    const before = owner.snapshot('s')?.cache;
    h.service.turnEnded('s', 'no-request', null);
    expect(owner.snapshot('s')?.cache).toEqual(before);
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('clears the cache estimate at a compact boundary and retains the confirmed TTL', () => {
    const owner = new SessionStatsOwnerService();
    const lease = owner.startNew('s');
    owner.beginRun('s', lease.generation, 'run', null);
    const h = harness(undefined, owner);
    h.service.sessionBound('s', 'run', false, true);
    h.service.turnEnded('s', 'write', {
      ...request, cacheAnchorAt: 1_000, cacheWriteTokens: 12, cacheWriteTtl: '1h',
    });
    expect(owner.snapshot('s')?.cache).toBeDefined();
    h.service.compactBoundary('s', 250_000);
    expect(owner.snapshot('s')?.cache).toBeUndefined();
    expect(owner.getCacheTtl('s', 'run')).toBe('1h');
    h.service.turnEnded('s', 'read', {
      ...request, cacheAnchorAt: 2_000, cacheReadTokens: 8,
    });
    expect(owner.snapshot('s')?.cache?.expiresAt).toBe(3_602_000);
    h.postCompact();
    expect(owner.snapshot('s')?.cache).toBeUndefined();
    expect(owner.getCacheTtl('s', 'run')).toBe('1h');
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('logs failed cache and idle projections once at debug level without payloads', () => {
    const owner = new SessionStatsOwnerService();
    const lease = owner.startNew('s');
    owner.beginRun('s', lease.generation, 'run', null);
    const h = harness(undefined, owner);
    h.service.sessionBound('s', 'run', false, true);
    owner.startNew('s');
    h.service.turnEnded('s', 'stale-1', {
      ...request, cacheAnchorAt: 1_000, cacheWriteTokens: 12, cacheWriteTtl: '1h',
    });
    h.service.turnEnded('s', 'stale-2', {
      ...request, cacheAnchorAt: 2_000, cacheWriteTokens: 12, cacheWriteTtl: '1h',
    });
    expect(h.debug).toHaveBeenCalledWith('[IdleCompactionService] Cache estimate projection was not applied');
    expect(h.debug).toHaveBeenCalledWith('[IdleCompactionService] Idle deadline projection was not applied');
    expect(h.debug).toHaveBeenCalledTimes(2);
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('hides proxy cache evidence and fences a replaced owner', () => {
    const owner = new SessionStatsOwnerService();
    const lease = owner.startNew('s');
    owner.beginRun('s', lease.generation, 'run', null);
    const h = harness(undefined, owner);
    h.service.sessionBound('s', 'run', false, false);
    h.service.turnEnded('s', 'proxy', {
      ...request, cacheAnchorAt: 1_000, cacheWriteTokens: 2, cacheWriteTtl: '1h',
    });
    expect(owner.snapshot('s')?.cache).toBeUndefined();
    h.service.sessionBound('s', 'run', false, true);
    h.service.turnEnded('s', 'native', {
      ...request, cacheAnchorAt: 2_000, cacheWriteTokens: 2, cacheWriteTtl: '1h',
    });
    expect(owner.snapshot('s')?.cache?.lastRequestAt).toBe(2_000);
    owner.startNew('s');
    h.service.turnEnded('s', 'stale', {
      ...request, cacheAnchorAt: 3_000, cacheWriteTokens: 2, cacheWriteTtl: '1h',
    });
    expect(owner.snapshot('s')?.cache).toBeUndefined();
    h.service.sessionReleased('s');
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('arms, fires once at the due time, and claims before a require-idle coordinator send', async () => {
    const h = harness();
    h.arm();
    h.advance(DUE - 1);
    expect(h.sender.sendIdleCompact).not.toHaveBeenCalled();
    h.advance(DUE);
    await settle();
    expect(h.sender.sendIdleCompact).toHaveBeenCalledTimes(1);
    expect(h.sender.sendIdleCompact).toHaveBeenCalledWith(
      's',
      expect.any(Function),
    );
    expect(h.coordinator.getIdleClaim('s')).toEqual(
      expect.stringContaining(':claim'),
    );
    expect(IDLE_COMPACT_ORIGIN).toEqual({ kind: 'coordinator' });
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('maps busy admission to not-idle-at-send without retaining a claim', async () => {
    const h = harness(async () => {
      throw new SessionAdmissionRefusedError('busy', 's');
    });
    h.arm();
    h.advance(DUE);
    await settle();
    expect(h.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'not-idle-at-send' }),
    );
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('vetoes an idle send when a manual compact reserved the session first', async () => {
    let reserveManual = () => {};
    const h = harness(async (_id, before) => {
      reserveManual();
      before();
    });
    reserveManual = () => {
      expect(h.coordinator.admitManualCompact('s').decision.action).toBe(
        'send',
      );
    };
    h.arm();
    h.advance(DUE);
    await settle();
    expect(h.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'manual-compact-reserved' }),
    );
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('releases a claim and warns when no PreCompact arrives by the claim deadline', async () => {
    const h = harness();
    h.arm();
    h.advance(DUE);
    await settle();
    h.advance(DUE + IDLE_CLAIM_TIMEOUT_MS);
    expect(h.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'claim-timeout' }),
    );
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('skips a coordinator BACKOFF and warns once on failed send', async () => {
    const backoff = harness();
    backoff.coordinator.onPreCompact('s', 'auto');
    backoff.fireCoordinatorTimeouts();
    expect(backoff.coordinator.getState('s')).toBe(CompactionState.BACKOFF);
    backoff.arm();
    backoff.advance(DUE);
    await settle();
    expect(backoff.sender.sendIdleCompact).not.toHaveBeenCalled();
    expect(backoff.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'compaction-state' }),
    );
    backoff.service.dispose();
    backoff.coordinator.dispose();

    const inFlight = harness();
    inFlight.arm();
    inFlight.advance(DUE);
    await settle();
    inFlight.coordinator.onPreCompact('s', 'auto');
    inFlight.preCompact();
    inFlight.fireCoordinatorTimeouts();
    expect(inFlight.coordinator.getState('s')).toBe(CompactionState.BACKOFF);
    inFlight.advance(DUE + COMPACTION_MAX_DWELL_MS);
    expect(inFlight.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'dwell-timeout' }),
    );
    expect(inFlight.coordinator.getIdleClaim('s')).toBeUndefined();
    inFlight.service.dispose();
    inFlight.coordinator.dispose();

    const failure = harness(async (_id, before) => {
      before();
      throw new Error('transport failed');
    });
    failure.arm();
    failure.advance(DUE);
    await settle();
    expect(failure.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'send-failed' }),
    );
    expect(failure.coordinator.getIdleClaim('s')).toBeUndefined();
    failure.service.turnContext('s', 'turn', 250_000);
    expect(failure.sender.sendIdleCompact).toHaveBeenCalledTimes(1);
    failure.service.dispose();
    failure.coordinator.dispose();
  });

  it('drops a lapsed due action after wall time jumps past expiry', () => {
    const h = harness();
    h.arm();
    h.advance(DUE, IDLE_CACHE_TTL_MS + 1);
    expect(h.sender.sendIdleCompact).not.toHaveBeenCalled();
    expect(h.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'lapsed' }),
    );
    h.service.dispose();
    h.coordinator.dispose();
  });

  it.each([
    'input',
    'request',
    'prefix',
    'precompact',
    'settings',
    'auto-settings',
    'new-run',
  ] as const)('cancels a pending attempt on %s', async (kind) => {
    const h = harness();
    h.arm();
    switch (kind) {
      case 'input':
        h.service.input('s');
        break;
      case 'request':
        h.service.requestStarted('s');
        break;
      case 'prefix':
        h.service.promptPrefixChanged('s');
        break;
      case 'precompact':
        h.preCompact();
        break;
      case 'settings':
        h.setEnabled(false);
        h.change('ptah.compaction.idleCompactionEnabled');
        break;
      case 'auto-settings':
        h.setAutoEnabled(false);
        h.change('ptah.compaction.enabled');
        break;
      case 'new-run':
        h.service.sessionBound('s', 'run-2', false);
        break;
    }
    expect(h.scheduler.actions).toHaveLength(0);
    h.advance(DUE);
    await settle();
    expect(h.sender.sendIdleCompact).not.toHaveBeenCalled();
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('releases a session, drops late feedback and does not resurrect its group', async () => {
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
    expect(h.scheduler.actions).toHaveLength(0);
    finish();
    await settle();
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('keeps one pending timer across rekey and disposes all subscriptions', () => {
    const h = harness();
    h.arm();
    h.service.rekey('s', 'new-s');
    expect(h.scheduler.actions).toHaveLength(1);
    h.service.sessionReleased('new-s');
    expect(h.scheduler.actions).toHaveLength(0);
    h.service.dispose();
    h.service.dispose();
    expect(h.offPre).toHaveBeenCalledTimes(1);
    expect(h.offPost).toHaveBeenCalledTimes(1);
    expect(h.offConfig).toHaveBeenCalledTimes(1);
    h.service.sessionBound('s', 'late', false);
    h.service.turnEnded('s', 'late', request);
    h.service.turnContext('s', 'late', 250_000);
    expect(h.scheduler.actions).toHaveLength(0);
    h.coordinator.dispose();
  });

  it('unblocks a later fire after a hung send reaches its deadline', async () => {
    let calls = 0;
    const h = harness((_id, before) => {
      before();
      return ++calls === 1 ? new Promise<void>(() => {}) : Promise.resolve();
    });
    h.arm();
    h.advance(DUE);
    expect(h.coordinator.getIdleClaim('s')).toBeDefined();
    h.advance(DUE + IDLE_CLAIM_TIMEOUT_MS);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'send-timeout' }),
    );
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    h.service.input('s');
    h.service.turnEnded('s', 'later', {
      ...request,
      anchorAt: DUE + IDLE_CLAIM_TIMEOUT_MS,
    });
    h.service.turnContext('s', 'later', 250_000);
    expect(h.scheduler.actions).toHaveLength(1);
    h.advance(DUE + IDLE_CLAIM_TIMEOUT_MS + DUE);
    await settle();
    expect(h.sender.sendIdleCompact).toHaveBeenCalledTimes(2);
    expect(h.coordinator.getIdleClaim('s')).toBeDefined();
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('normalizes old aliases for activity, turns and boundary notices', async () => {
    const h = harness();
    h.coordinator.register('new-s', { codexProxy: false, e2Passed: true });
    h.arm();
    h.service.rekey('s', 'new-s');
    h.service.input('s');
    expect(h.scheduler.actions).toHaveLength(0);
    h.service.turnEnded('s', 'later', request);
    h.service.turnContext('s', 'later', 250_000);
    expect(h.scheduler.actions).toHaveLength(1);
    h.advance(DUE);
    await settle();
    expect(h.sender.sendIdleCompact).toHaveBeenCalledWith(
      'new-s',
      expect.any(Function),
    );
    h.preCompact('s');
    h.service.compactBoundary('s', 240_000);
    expect(h.service.boundaryNoticeFor('new-s')).toEqual({
      preTokens: 240_000,
    });
    h.service.sessionReleased('s');
    expect(h.scheduler.actions).toHaveLength(0);
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('drops one signal when settings throws and keeps the session alive', async () => {
    const h = harness();
    h.service.sessionBound('s', 'run', false);
    h.failNextSettingsRead();
    h.service.turnEnded('s', 'discarded', request);
    h.service.turnContext('s', 'discarded', 250_000);
    expect(h.scheduler.actions).toHaveLength(0);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'signal-failed' }),
    );
    h.service.turnEnded('s', 'later', request);
    h.service.turnContext('s', 'later', 250_000);
    h.advance(DUE);
    await settle();
    expect(h.sender.sendIdleCompact).toHaveBeenCalledTimes(1);
    h.service.sessionReleased('s');
    expect(h.scheduler.actions).toHaveLength(0);
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('continues later effects when one effect throws', async () => {
    const h = harness();
    h.arm();
    h.advance(DUE);
    await settle();
    expect(h.coordinator.getIdleClaim('s')).toBeDefined();
    h.warn.mockImplementationOnce(() => {
      throw new Error('logger failed');
    });
    h.advance(DUE + IDLE_CLAIM_TIMEOUT_MS);
    expect(h.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'signal-failed' }),
    );
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    expect(h.scheduler.actions).toHaveLength(0);
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('vetoes a send that resumes after its deadline', async () => {
    let resume!: () => void;
    const enqueued = jest.fn();
    const h = harness(async (_id, before) => {
      await new Promise<void>((resolve) => (resume = resolve));
      before();
      enqueued();
    });
    h.arm();
    h.advance(DUE);
    h.advance(DUE + IDLE_CLAIM_TIMEOUT_MS);
    resume();
    await settle();
    expect(enqueued).not.toHaveBeenCalled();
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    expect(h.service.boundaryNoticeFor('s')).toBeUndefined();
    h.service.dispose();
    h.coordinator.dispose();
  });
});
