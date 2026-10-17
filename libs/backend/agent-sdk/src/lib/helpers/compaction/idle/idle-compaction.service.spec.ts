import { VirtualTimeScheduler } from 'rxjs';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SessionAdmissionRefusedError } from '../../../errors/session-admission-refused.error';
import type { CompactionCallbackRegistry } from '../../compaction-callback-registry';
import type { CompactionConfigProvider } from '../../compaction-config-provider';
import type { SdkAdapterEvents } from '../../sdk-adapter-events.service';
import type { SessionTurnStateRegistry } from '../../session-turn-state.registry';
import { CompactionCoordinator } from '../compaction-coordinator';
import { COMPACTION_MAX_DWELL_MS, CompactionState } from '../compaction-state.types';
import { IDLE_CACHE_TTL_MS, IDLE_CLAIM_TIMEOUT_MS, IDLE_COMPACT_ORIGIN,
  type IdleCompactSender } from './idle-compaction.types';
import { IdleCompactionService } from './idle-compaction.service';

const DUE = IDLE_CACHE_TTL_MS * 0.9;
const request = { requestKey: 'request-1', anchorAt: 0, ttl: '1h' as const };

function harness(send?: IdleCompactSender['sendIdleCompact']) {
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
    setTimeout: callback => {
      const id = ++nextTimeout;
      coordinatorTimeouts.set(id, callback);
      return id;
    },
    clearTimeout: handle => { coordinatorTimeouts.delete(handle as number); },
  });
  coordinator.register('s', { codexProxy: false, e2Passed: true });
  let enabled = true;
  let autoEnabled = true;
  let minimum = 200_000;
  let phase = 'idle';
  let onConfig: ((event: { affectsConfiguration(section: string): boolean }) => void) | null = null;
  let onPre: ((data: { sessionId: string }) => void) | null = null;
  let onPost: ((event: { sessionId: string }) => void) | null = null;
  const offConfig = jest.fn();
  const offPre = jest.fn();
  const offPost = jest.fn();
  const config = {
    getIdleCompactionConfig: () => ({ enabled, minTokens: minimum }),
    getConfig: () => ({ enabled: autoEnabled }),
  } as CompactionConfigProvider;
  const turns = { get: () => ({ phase }) } as unknown as SessionTurnStateRegistry;
  const callbacks = { register: (listener: typeof onPre) => {
    onPre = listener;
    return offPre;
  } } as unknown as CompactionCallbackRegistry;
  const events = { onCompactionComplete: (listener: typeof onPost) => {
    onPost = listener;
    return offPost;
  } } as unknown as SdkAdapterEvents;
  const workspace = { onDidChangeConfiguration: (listener: typeof onConfig) => {
    onConfig = listener;
    return { dispose: offConfig };
  } } as unknown as IWorkspaceProvider;
  const sender = { sendIdleCompact: jest.fn(send ?? (async (_id, before) => before())) };
  const service = new IdleCompactionService(logger, coordinator, config, turns, sender,
    callbacks, events, workspace, { scheduler, now: () => now });
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
  const change = (section: string) => onConfig?.({ affectsConfiguration: key => key === section });
  return {
    service, scheduler, sender, coordinator, arm, advance, info, warn, debug,
    fireCoordinatorTimeouts: () => {
      for (const callback of [...coordinatorTimeouts.values()]) callback();
    },
    setEnabled: (value: boolean) => { enabled = value; },
    setAutoEnabled: (value: boolean) => { autoEnabled = value; },
    setMinimum: (value: number) => { minimum = value; },
    setPhase: (value: string) => { phase = value; },
    change, preCompact: (id = 's') => onPre?.({ sessionId: id }),
    postCompact: (id = 's') => onPost?.({ sessionId: id }),
    offConfig, offPre, offPost,
  };
}

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('IdleCompactionService', () => {
  it('arms, fires once at the due time, and claims before a require-idle coordinator send', async () => {
    const h = harness();
    h.arm();
    h.advance(DUE - 1);
    expect(h.sender.sendIdleCompact).not.toHaveBeenCalled();
    h.advance(DUE);
    await settle();
    expect(h.sender.sendIdleCompact).toHaveBeenCalledTimes(1);
    expect(h.sender.sendIdleCompact).toHaveBeenCalledWith('s', expect.any(Function));
    expect(h.coordinator.getIdleClaim('s')).toEqual(expect.stringContaining(':claim'));
    expect(IDLE_COMPACT_ORIGIN).toEqual({ kind: 'coordinator' });
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('maps busy admission to not-idle-at-send without retaining a claim', async () => {
    const h = harness(async () => { throw new SessionAdmissionRefusedError('busy', 's'); });
    h.arm();
    h.advance(DUE);
    await settle();
    expect(h.info).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ reason: 'not-idle-at-send' }));
    expect(h.coordinator.getIdleClaim('s')).toBeUndefined();
    h.service.dispose();
    h.coordinator.dispose();
  });

  it('vetoes an idle send when a manual compact reserved the session first', async () => {
    let reserveManual = () => {};
    const h = harness(async (_id, before) => { reserveManual(); before(); });
    reserveManual = () => {
      expect(h.coordinator.admitManualCompact('s').decision.action).toBe('send');
    };
    h.arm();
    h.advance(DUE);
    await settle();
    expect(h.info).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ reason: 'manual-compact-reserved' }));
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
    expect(h.warn).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ reason: 'claim-timeout' }));
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
    expect(backoff.info).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ reason: 'compaction-state' }));
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
    expect(inFlight.warn).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ reason: 'dwell-timeout' }));
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
    expect(failure.warn).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ reason: 'send-failed' }));
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
    expect(h.info).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ reason: 'lapsed' }));
    h.service.dispose();
    h.coordinator.dispose();
  });

  it.each(['input', 'request', 'prefix', 'precompact', 'settings', 'auto-settings', 'new-run'] as const)(
    'cancels a pending attempt on %s', async kind => {
      const h = harness();
      h.arm();
      switch (kind) {
        case 'input': h.service.input('s'); break;
        case 'request': h.service.requestStarted('s'); break;
        case 'prefix': h.service.promptPrefixChanged('s'); break;
        case 'precompact': h.preCompact(); break;
        case 'settings':
          h.setEnabled(false);
          h.change('ptah.compaction.idleCompactionEnabled');
          break;
        case 'auto-settings':
          h.setAutoEnabled(false);
          h.change('ptah.compaction.enabled');
          break;
        case 'new-run': h.service.sessionBound('s', 'run-2', false); break;
      }
      expect(h.scheduler.actions).toHaveLength(0);
      h.advance(DUE);
      await settle();
      expect(h.sender.sendIdleCompact).not.toHaveBeenCalled();
      h.service.dispose();
      h.coordinator.dispose();
    },
  );

  it('releases a session, drops late feedback and does not resurrect its group', async () => {
    let finish!: () => void;
    const h = harness(() => new Promise<void>(resolve => { finish = resolve; }));
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
});
