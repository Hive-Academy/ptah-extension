/**
 * `CuratorActivityLog` — reason codes and fixed sentences (TASK_2026_878).
 *
 * A pass that did not run cleanly carries a reason and a table sentence. Raw
 * provider text, causes, URLs and key fragments reach the warn log and
 * nothing the renderer can read: returned stats, `lastRunInfo`, or any pushed
 * event.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { AuthRequiredError } from '@ptah-extension/agent-sdk';
import {
  CuratorActivityLog,
  curatorRunMessage,
  type CuratorRunReason,
} from './curator-activity-log';
import type { MemoryCuratorEvent } from '../diagnostics.types';

const SENTINEL = 'upstream 401 key=sk-SENTINEL-7f3a https://internal.example';

/** Same name and shape as the agent-sdk adapter's wrapper error. */
class CuratorLlmQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CuratorLlmQueryError';
  }
}

function makeLogger(): Logger & {
  warn: jest.Mock;
  info: jest.Mock;
  debug: jest.Mock;
} {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger & {
    warn: jest.Mock;
    info: jest.Mock;
    debug: jest.Mock;
  };
}

function setup() {
  const logger = makeLogger();
  const log = new CuratorActivityLog(logger);
  const events: MemoryCuratorEvent[] = [];
  log.onEvent((ev) => events.push(ev));
  return { logger, log, events };
}

describe('curatorRunMessage', () => {
  const kept: readonly CuratorRunReason[] = [
    'provider-cooling-down',
    'provider-unreachable',
    'no-output',
    'concurrency-slot-timeout',
    'curator-queue-wait-timeout',
    'caller-aborted',
    'network-backoff',
    'host-shutdown',
  ];

  it.each(kept)('%s ends with the kept-observations sentence', (reason) => {
    expect(curatorRunMessage(reason)).toMatch(
      / Observations are kept for the next pass\.$/,
    );
  });

  it('names the setting to change for an unsupported provider', () => {
    expect(curatorRunMessage('provider-unsupported')).toBe(
      'The memory curator cannot run on OpenAI Codex. Choose another provider for Memory curator in Settings > Background model roles.',
    );
  });

  it('has fixed sentences for auth-required and curator-error', () => {
    expect(curatorRunMessage('auth-required')).toBe(
      "The memory curator's provider is not signed in or its sign-in expired. Check it in Settings > Background model roles, then run again.",
    );
    expect(curatorRunMessage('curator-error')).toBe(
      'The curator run failed. See the logs for details.',
    );
  });
});

describe('CuratorActivityLog.recordStall', () => {
  it('records an unsupported provider as the last run and pushes curator-error', () => {
    const { log, events, logger } = setup();

    const stats = log.recordStall('s1', {
      status: 'stalled',
      reason: 'provider-unsupported',
      providerId: 'openai-codex',
    });

    const sentence = curatorRunMessage('provider-unsupported');
    expect(stats).toEqual({
      outcome: 'stalled',
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
      reason: 'provider-unsupported',
      error: sentence,
    });
    const last = log.lastRunInfo();
    expect(last.at).toEqual(expect.any(Number));
    expect(last.stats).toEqual(stats);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'curator-error',
      sessionId: 's1',
      error: sentence,
      stats: { reason: 'provider-unsupported', providerId: 'openai-codex' },
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it.each(['provider-cooling-down', 'provider-unreachable'] as const)(
    '%s leaves the last run untouched and pushes rate-limited',
    (reason) => {
      const { log, events } = setup();

      const stats = log.recordStall('s1', {
        status: 'stalled',
        reason,
        providerId: 'anthropic',
      });

      expect(stats.outcome).toBe('stalled');
      expect(stats.reason).toBe(reason);
      expect(stats.error).toBe(curatorRunMessage(reason));
      expect(log.lastRunInfo()).toEqual({ at: null, stats: null });
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('rate-limited');
      expect(events[0].error).toBeUndefined();
    },
  );
});

describe('CuratorActivityLog.recordNoOutput and recordDeferral', () => {
  it('no-output carries its reason and sentence without touching last run', () => {
    const { log } = setup();

    const stats = log.recordNoOutput('s1', {
      status: 'no-output',
      usedTools: true,
      toolNames: ['search'],
    });

    expect(stats).toMatchObject({
      outcome: 'stalled',
      reason: 'no-output',
      error: curatorRunMessage('no-output'),
    });
    expect(log.lastRunInfo().stats).toBeNull();
  });

  it('a deferral carries the deferral as its reason', () => {
    const { log } = setup();

    const stats = log.recordDeferral('s1', {
      reason: 'network-backoff',
      stage: 'extract',
      completedWindows: 0,
      windows: 1,
      retriesSpent: 0,
    });

    expect(stats).toMatchObject({
      outcome: 'stalled',
      deferral: 'network-backoff',
      reason: 'network-backoff',
      error: curatorRunMessage('network-backoff'),
    });
    expect(log.lastRunInfo().stats).toBeNull();
  });
});

describe('CuratorActivityLog.recordError', () => {
  it('reports auth-required when a cause is an AuthRequiredError', () => {
    const { log, events } = setup();
    const error = new CuratorLlmQueryError('curator query failed', {
      cause: new AuthRequiredError('Not signed in to Anthropic', {
        providerId: 'anthropic',
      }),
    });

    const stats = log.recordError('s1', error, 'extract');

    expect(stats.outcome).toBe('failed');
    expect(stats.reason).toBe('auth-required');
    expect(stats.error).toBe(curatorRunMessage('auth-required'));
    expect(events[0]).toMatchObject({
      kind: 'curator-error',
      error: curatorRunMessage('auth-required'),
    });
  });

  it('finds an AuthRequiredError three causes deep', () => {
    const { log } = setup();
    const error = new Error('outer', {
      cause: new Error('middle', {
        cause: new Error('inner', {
          cause: new AuthRequiredError('expired', { providerId: 'anthropic' }),
        }),
      }),
    });

    expect(log.recordError('s1', error, 'resolve', 2).reason).toBe(
      'auth-required',
    );
  });

  it('ignores an AuthRequiredError deeper than three causes', () => {
    const { log } = setup();
    const error = new Error('l0', {
      cause: new Error('l1', {
        cause: new Error('l2', {
          cause: new Error('l3', {
            cause: new AuthRequiredError('expired'),
          }),
        }),
      }),
    });

    expect(log.recordError('s1', error, 'extract').reason).toBe(
      'curator-error',
    );
  });

  it('reports curator-error for any other failure, including a non-Error', () => {
    const { log } = setup();

    expect(log.recordError('s1', new Error('boom'), 'extract').reason).toBe(
      'curator-error',
    );
    expect(log.recordError('s1', 'plain string', 'resolve').reason).toBe(
      'curator-error',
    );
  });

  it('keeps the sentinel in the warn log and out of everything the renderer reads', () => {
    const { log, events, logger } = setup();
    const error = new CuratorLlmQueryError('curator query failed', {
      cause: new Error(SENTINEL),
    });

    const stats = log.recordError('s1', error, 'resolve', 3);

    const warnCalls = JSON.stringify(logger.warn.mock.calls);
    expect(warnCalls).toContain(SENTINEL);
    expect(warnCalls).toContain('curator query failed');

    expect(stats.error).toBe(curatorRunMessage('curator-error'));
    expect(JSON.stringify(stats)).not.toContain('sk-SENTINEL');
    expect(JSON.stringify(log.lastRunInfo())).not.toContain('sk-SENTINEL');
    expect(events.length).toBeGreaterThan(0);
    for (const ev of [...events, ...log.recent(200)]) {
      const text = JSON.stringify(ev);
      expect(text).not.toContain('sk-SENTINEL');
      expect(text).not.toContain('internal.example');
      expect(text).not.toContain('curator query failed');
    }
  });

  it('keeps a sentinel in the top-level message out of pushed events', () => {
    const { log, events } = setup();

    log.recordError('s1', new Error(SENTINEL), 'extract');

    expect(JSON.stringify(events)).not.toContain('sk-SENTINEL');
    expect(JSON.stringify(log.lastRunInfo())).not.toContain('sk-SENTINEL');
  });
});
