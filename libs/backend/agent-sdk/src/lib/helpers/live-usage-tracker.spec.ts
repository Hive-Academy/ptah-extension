/**
 * LiveUsageTracker specs — the live snapshot and the resume baseline.
 *
 * The two slots exist because they hold the same QUANTITY from two sources of
 * very different authority: frames this process watched stream, and a figure
 * read off a transcript for a session it never saw. The rules pinned here are
 * the ones that keep the second from corrupting the first (TASK_2026_374).
 */

import 'reflect-metadata';

import { LiveUsageTracker } from './live-usage-tracker';
import { CompactionHookHandler } from './compaction-hook-handler';
import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

describe('LiveUsageTracker — resume baseline', () => {
  it('answers with the baseline when this process has observed nothing', () => {
    const tracker = new LiveUsageTracker();

    expect(tracker.getCumulativeTokens('resumed')).toBe(0);
    tracker.seedResumedSession('resumed', 181_500);
    expect(tracker.getCumulativeTokens('resumed')).toBe(181_500);
  });

  it('lets a live frame win, even one that sums lower than the baseline', () => {
    const tracker = new LiveUsageTracker();
    tracker.seedResumedSession('s1', 181_500);

    tracker.recordSessionUsage('s1', {
      input: 12,
      output: 8,
      cacheRead: 0,
      cacheCreation: 0,
    });

    // The baseline is never merged into the snapshot's per-field max, so a
    // stale historical figure cannot outrank live evidence for the rest of the
    // session.
    expect(tracker.getCumulativeTokens('s1')).toBe(20);
  });

  it('does not let a later seed overwrite live evidence', () => {
    const tracker = new LiveUsageTracker();
    tracker.recordSessionUsage('s1', {
      input: 100,
      output: 40,
      cacheRead: 0,
      cacheCreation: 0,
    });

    tracker.seedResumedSession('s1', 999_999);

    expect(tracker.getCumulativeTokens('s1')).toBe(140);
  });

  it('drops the baseline as well as the snapshot at compact_boundary', () => {
    const tracker = new LiveUsageTracker();
    tracker.seedResumedSession('s1', 181_500);

    tracker.clearSessionTokenSnapshot('s1');

    // A pre-compaction figure answering a post-compaction read is exactly the
    // re-poisoning clearSessionTokenSnapshot exists to prevent.
    expect(tracker.getCumulativeTokens('s1')).toBe(0);
  });

  it('ignores a blank id and any non-positive or non-finite figure', () => {
    const tracker = new LiveUsageTracker();

    tracker.seedResumedSession('', 500);
    tracker.seedResumedSession('s1', 0);
    tracker.seedResumedSession('s2', -1);
    tracker.seedResumedSession('s3', Number.NaN);

    expect(tracker.getCumulativeTokens('')).toBe(0);
    expect(tracker.getCumulativeTokens('s1')).toBe(0);
    expect(tracker.getCumulativeTokens('s2')).toBe(0);
    expect(tracker.getCumulativeTokens('s3')).toBe(0);
  });

  it('bounds the baseline map, evicting the least recently seeded session', () => {
    const tracker = new LiveUsageTracker();
    // session:stats-batch reads a whole session list in one call, so the write
    // side is not one entry per active session.
    for (let i = 0; i < 200; i++) {
      tracker.seedResumedSession(`s${i}`, 1_000 + i);
    }

    expect(tracker.getCumulativeTokens('s0')).toBe(0);
    expect(tracker.getCumulativeTokens('s135')).toBe(0);
    expect(tracker.getCumulativeTokens('s136')).toBe(1_136);
    expect(tracker.getCumulativeTokens('s199')).toBe(1_199);
  });
});

describe('CompactionHookHandler — preTokens after a resume', () => {
  it('publishes the resume baseline instead of 0 for a session that never streamed', async () => {
    const tracker = new LiveUsageTracker();
    tracker.seedResumedSession('50653b50', 333_538);
    const handler = new CompactionHookHandler(makeLogger(), tracker);

    const received: Array<{ preTokens: number; trigger: string }> = [];
    const hooks = handler.createHooks('50653b50', '/ws', (data) => {
      received.push(data);
    });
    const fn = hooks.PreCompact?.[0]?.hooks?.[0];

    const result = await fn?.(
      {
        hook_event_name: 'PreCompact',
        trigger: 'manual',
        session_id: '50653b50',
        cwd: '/ws',
      } as unknown as HookInput,
      undefined,
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({ continue: true });
    expect(received).toHaveLength(1);
    expect(received[0].preTokens).toBe(333_538);
  });

  it('still reports 0 when neither source knows anything', async () => {
    const handler = new CompactionHookHandler(
      makeLogger(),
      new LiveUsageTracker(),
    );

    const received: Array<{ preTokens: number }> = [];
    const hooks = handler.createHooks('unknown-sess', '/ws', (data) => {
      received.push(data);
    });
    const fn = hooks.PreCompact?.[0]?.hooks?.[0];

    await fn?.(
      {
        hook_event_name: 'PreCompact',
        trigger: 'auto',
        session_id: 'unknown-sess',
        cwd: '/ws',
      } as unknown as HookInput,
      undefined,
      { signal: new AbortController().signal },
    );

    expect(received[0].preTokens).toBe(0);
  });
});
