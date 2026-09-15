/**
 * `CuratorPassAdmission` — governor clearance before the job queue (FU-16b-a)
 * and the network back-off (TASK_2026_437 C14 f).
 *
 * The governor is the REAL `BackgroundWorkGovernor` driven by a fake
 * foreground source, so "a chat turn is generating" is the same state the
 * product computes, and dispose rejects waiters exactly as it does at shutdown.
 */
import 'reflect-metadata';
import {
  BackgroundWorkGovernor,
  type Logger,
} from '@ptah-extension/vscode-core';
import { NetworkBackoff } from '@ptah-extension/agent-sdk';
import { CuratorPassAdmission } from './curator-pass-admission';

function makeLogger(): Logger & { info: jest.Mock } {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger & { info: jest.Mock };
}

function busyGovernor(logger: Logger) {
  const governor = new BackgroundWorkGovernor(logger);
  let busy = true;
  let notify: () => void = () => undefined;
  governor.addForegroundSource({
    isForegroundBusy: () => busy,
    onForegroundChange: (listener) => {
      notify = listener;
      return () => undefined;
    },
  });
  return {
    governor,
    endTurn: () => {
      busy = false;
      notify();
    },
  };
}

function manualBackoff() {
  let now = 5_000_000;
  const backoff = new NetworkBackoff({
    logger: makeLogger(),
    logPrefix: '[memory-curator]',
    now: () => now,
    random: () => 0.5,
  });
  return { backoff, advance: (ms: number) => (now += ms) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('CuratorPassAdmission — clearance', () => {
  it('admits at once (null) with no governor, a clear governor, or a user-initiated pass', () => {
    const logger = makeLogger();
    expect(
      new CuratorPassAdmission(logger, null).clearance('k', false, undefined),
    ).toBeNull();

    const clear = new BackgroundWorkGovernor(logger);
    expect(
      new CuratorPassAdmission(logger, clear).clearance('k', false, undefined),
    ).toBeNull();

    const { governor } = busyGovernor(logger);
    expect(
      new CuratorPassAdmission(logger, governor).clearance(
        'k',
        true,
        undefined,
      ),
    ).toBeNull();
    governor.dispose();
  });

  it('holds a background pass until the turn ends', async () => {
    const logger = makeLogger();
    const { governor, endTurn } = busyGovernor(logger);
    const admission = new CuratorPassAdmission(logger, governor);

    const wait = admission.clearance('k', false, undefined);
    expect(wait).not.toBeNull();
    let outcome: string | undefined;
    void wait?.then((value) => (outcome = value));
    await flush();
    expect(outcome).toBeUndefined();

    endTurn();
    await flush();
    expect(outcome).toBe('proceed');
    governor.dispose();
  });

  it('promote() ends the wait of the pass under that key', async () => {
    const logger = makeLogger();
    const { governor } = busyGovernor(logger);
    const admission = new CuratorPassAdmission(logger, governor);

    const wait = admission.clearance('ws::s1', false, undefined);
    expect(admission.promote('ws::other')).toBe(false);
    expect(admission.promote('ws::s1')).toBe(true);
    await expect(wait).resolves.toBe('promoted');
    // Only a waiting pass can be promoted, and only once.
    expect(admission.promote('ws::s1')).toBe(false);
    expect(admission.promote(null)).toBe(false);
    governor.dispose();
  });

  it('reports cancelled when the governor is disposed mid-wait (host shutdown)', async () => {
    const logger = makeLogger();
    const { governor } = busyGovernor(logger);
    const admission = new CuratorPassAdmission(logger, governor);

    const wait = admission.clearance('k', false, undefined);
    governor.dispose();
    await expect(wait).resolves.toBe('cancelled');
  });

  it('lets a caller-aborted pass proceed to dispatch, where it defers as caller-aborted', async () => {
    const logger = makeLogger();
    const { governor } = busyGovernor(logger);
    const admission = new CuratorPassAdmission(logger, governor);
    const caller = new AbortController();

    const wait = admission.clearance('k', false, caller.signal);
    caller.abort();
    await expect(wait).resolves.toBe('proceed');
    governor.dispose();
  });

  it('does not make a background pass wait for the governor while a back-off window is open', () => {
    const logger = makeLogger();
    const { governor } = busyGovernor(logger);
    const { backoff } = manualBackoff();
    const admission = new CuratorPassAdmission(logger, governor, backoff);
    backoff.recordFailure('dns');

    expect(admission.clearance('k', false, undefined)).toBeNull();
    governor.dispose();
  });
});

describe('CuratorPassAdmission — network back-off', () => {
  it('opens a window on a provider-unreachable stall and holds background passes only', () => {
    const { backoff } = manualBackoff();
    const admission = new CuratorPassAdmission(makeLogger(), null, backoff);

    admission.recordExtraction({
      status: 'stalled',
      reason: 'provider-unreachable',
      providerId: '',
    });

    expect(admission.networkDeferralMs(false)).toBe(30_000);
    expect(admission.networkDeferralMs(true)).toBe(0);
  });

  it('ignores a quota stall, a failure, and a silent no-output run', () => {
    const { backoff } = manualBackoff();
    const admission = new CuratorPassAdmission(makeLogger(), null, backoff);

    admission.recordExtraction({
      status: 'stalled',
      reason: 'provider-cooling-down',
      providerId: 'p',
    });
    admission.recordExtraction({ status: 'failed', error: new Error('boom') });
    admission.recordExtraction({
      status: 'no-output',
      usedTools: false,
      toolNames: [],
    });

    expect(admission.networkDeferralMs(false)).toBe(0);
    expect(backoff.currentLevel).toBe(0);
  });

  it('clears on an answered pass — drafts, or work done through tools', () => {
    const { backoff } = manualBackoff();
    const admission = new CuratorPassAdmission(makeLogger(), null, backoff);
    const unreachable = {
      status: 'stalled' as const,
      reason: 'provider-unreachable' as const,
      providerId: '',
    };

    admission.recordExtraction(unreachable);
    admission.recordExtraction({ status: 'extracted', drafts: [] });
    expect(admission.networkDeferralMs(false)).toBe(0);

    admission.recordExtraction(unreachable);
    admission.recordExtraction({
      status: 'no-output',
      usedTools: true,
      toolNames: ['ptah_memory_search'],
    });
    expect(admission.networkDeferralMs(false)).toBe(0);
  });
});
