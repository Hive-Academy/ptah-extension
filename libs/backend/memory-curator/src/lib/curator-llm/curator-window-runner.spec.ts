/**
 * `clampWindowBudget` — the guarantee that makes `windowForModel` still the one
 * place a transcript is bounded (TASK_2026_374).
 *
 * A caller may LOWER the window budget for one pass. It may not raise it, and
 * it may not reach zero: a pass that plans no windows curates nothing while
 * reporting a clean empty run, which is the failure mode the whole windowing
 * design is built to avoid.
 */
import {
  clampWindowBudget,
  CuratorWindowRunner,
} from './curator-window-runner';
import { CURATOR_MAX_WINDOWS, type CuratorWindow } from './transcript-windows';
import {
  QueueSlotRetryBudget,
  QUEUE_SLOT_TIMEOUT_ERROR_NAME,
} from './queue-slot-timeout';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ICuratorLLM } from './curator-llm.interface';

describe('clampWindowBudget', () => {
  it('defaults to the full budget when nothing is asked for', () => {
    expect(clampWindowBudget(undefined)).toBe(CURATOR_MAX_WINDOWS);
  });

  it('honours a narrower budget', () => {
    expect(clampWindowBudget(1)).toBe(1);
    expect(clampWindowBudget(3)).toBe(3);
  });

  it('refuses to be widened past the ceiling', () => {
    expect(clampWindowBudget(CURATOR_MAX_WINDOWS + 1)).toBe(
      CURATOR_MAX_WINDOWS,
    );
    expect(clampWindowBudget(1_000)).toBe(CURATOR_MAX_WINDOWS);
    expect(clampWindowBudget(Number.POSITIVE_INFINITY)).toBe(
      CURATOR_MAX_WINDOWS,
    );
  });

  it('never plans fewer than one window', () => {
    expect(clampWindowBudget(0)).toBe(1);
    expect(clampWindowBudget(-5)).toBe(1);
    expect(clampWindowBudget(0.4)).toBe(1);
  });

  it('treats a non-finite request as no request at all', () => {
    expect(clampWindowBudget(Number.NaN)).toBe(CURATOR_MAX_WINDOWS);
  });
});

describe('CuratorWindowRunner.planWindows', () => {
  function makeRunner(): {
    runner: CuratorWindowRunner;
    logger: { info: jest.Mock; warn: jest.Mock };
  } {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    return {
      logger,
      runner: new CuratorWindowRunner(
        logger as unknown as Logger,
        {} as unknown as ICuratorLLM,
      ),
    };
  }

  const bigTranscript = Array.from(
    { length: 400 },
    (_, i) => `USER: turn ${i} ${'x'.repeat(1_000)}`,
  ).join('\n\n');

  it('plans the full budget by default and one window when narrowed', () => {
    const { runner } = makeRunner();

    expect(runner.planWindows(bigTranscript, 's')).toHaveLength(
      CURATOR_MAX_WINDOWS,
    );
    expect(runner.planWindows(bigTranscript, 's', 1)).toHaveLength(1);
  });

  it('ignores a request to widen the budget', () => {
    const { runner } = makeRunner();

    expect(runner.planWindows(bigTranscript, 's', 99)).toHaveLength(
      CURATOR_MAX_WINDOWS,
    );
  });
});

/**
 * A window that loses its concurrency slot is congestion, not a failed
 * curation — TASK_2026_376 F4.
 */
describe('CuratorWindowRunner.extractAcrossWindows — queue-slot timeouts', () => {
  function queueTimeout(): Error {
    const inner = new Error(
      'Internal query waited longer than 60000ms for a concurrency slot.',
    );
    inner.name = QUEUE_SLOT_TIMEOUT_ERROR_NAME;
    const wrapped = new Error(
      'The memory curator could not complete its language-model query.',
      { cause: inner },
    );
    wrapped.name = 'CuratorLlmQueryError';
    return wrapped;
  }

  function windows(count: number): readonly CuratorWindow[] {
    return Array.from({ length: count }, (_, i) => ({
      text: `window ${i}`,
      recordIndices: [i],
      windowIndex: i,
      windowCount: count,
    }));
  }

  function makeRunner(extract: jest.Mock): CuratorWindowRunner {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    return new CuratorWindowRunner(
      logger as unknown as Logger,
      {
        extract,
        resolve: jest.fn(),
      } as unknown as ICuratorLLM,
    );
  }

  it('re-queues the window that lost its slot and keeps its drafts', async () => {
    const draft = {
      kind: 'fact',
      subject: 's',
      content: 'c',
      salienceHint: 0.5,
    };
    const extract = jest
      .fn()
      .mockRejectedValueOnce(queueTimeout())
      .mockResolvedValue({ status: 'extracted', drafts: [draft] });
    const runner = makeRunner(extract);

    const result = await runner.extractAcrossWindows(windows(1));

    expect(result).toEqual({ status: 'extracted', drafts: [draft] });
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('a sibling window still runs after the first one had to wait', async () => {
    const extract = jest
      .fn()
      .mockResolvedValueOnce({ status: 'extracted', drafts: [] })
      .mockRejectedValueOnce(queueTimeout())
      .mockResolvedValueOnce({
        status: 'extracted',
        drafts: [
          { kind: 'fact', subject: 'b', content: 'second', salienceHint: 0.5 },
        ],
      });
    const runner = makeRunner(extract);

    const result = await runner.extractAcrossWindows(windows(2));

    expect(result).toEqual({
      status: 'extracted',
      drafts: [
        { kind: 'fact', subject: 'b', content: 'second', salienceHint: 0.5 },
      ],
    });
  });

  it('defers rather than failing once the allowance is spent', async () => {
    const extract = jest.fn().mockRejectedValue(queueTimeout());
    const runner = makeRunner(extract);

    const result = await runner.extractAcrossWindows(
      windows(3),
      undefined,
      new QueueSlotRetryBudget(1),
    );

    expect(result).toEqual({
      status: 'deferred',
      reason: 'concurrency-slot-timeout',
      completedWindows: 0,
      retriesSpent: 1,
    });
    // One attempt plus one retry — the budget, and nothing more.
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('shares ONE allowance across the whole window set', async () => {
    const extract = jest
      .fn()
      .mockRejectedValueOnce(queueTimeout())
      .mockResolvedValueOnce({ status: 'extracted', drafts: [] })
      .mockRejectedValue(queueTimeout());
    const runner = makeRunner(extract);

    const result = await runner.extractAcrossWindows(
      windows(2),
      undefined,
      new QueueSlotRetryBudget(1),
    );

    // Window 1 spent the allowance, so window 2's timeout defers immediately.
    expect(result).toEqual({
      status: 'deferred',
      reason: 'concurrency-slot-timeout',
      completedWindows: 1,
      retriesSpent: 1,
    });
    expect(extract).toHaveBeenCalledTimes(3);
  });

  it('still reports a non-congestion failure as failed', async () => {
    const boom = new Error('provider returned 500');
    const extract = jest.fn().mockRejectedValue(boom);
    const runner = makeRunner(extract);

    const result = await runner.extractAcrossWindows(windows(2));

    expect(result).toEqual({ status: 'failed', error: boom });
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('does not re-queue a window whose pass was aborted', async () => {
    const controller = new AbortController();
    const extract = jest.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(queueTimeout());
    });
    const runner = makeRunner(extract);

    const result = await runner.extractAcrossWindows(
      windows(2),
      controller.signal,
    );

    expect(result).toMatchObject({ status: 'failed' });
    expect(extract).toHaveBeenCalledTimes(1);
  });
});

/**
 * A window whose model returned no JSON abandons the pass — TASK_2026_376 R1.
 */
describe('CuratorWindowRunner.extractAcrossWindows — a window that produced no output', () => {
  function windows(count: number): readonly CuratorWindow[] {
    return Array.from({ length: count }, (_, i) => ({
      text: `window ${i}`,
      recordIndices: [i],
      windowIndex: i,
      windowCount: count,
    }));
  }

  function makeRunner(extract: jest.Mock): CuratorWindowRunner {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    return new CuratorWindowRunner(
      logger as unknown as Logger,
      {
        extract,
        resolve: jest.fn(),
      } as unknown as ICuratorLLM,
    );
  }

  it('carries the arm to the caller and stops spending windows', async () => {
    const extract = jest
      .fn()
      .mockResolvedValueOnce({
        status: 'extracted',
        drafts: [
          { kind: 'fact', subject: 'a', content: 'first', salienceHint: 0.5 },
        ],
      })
      .mockResolvedValueOnce({
        status: 'no-output',
        usedTools: true,
        toolNames: ['Read'],
      })
      .mockResolvedValue({ status: 'extracted', drafts: [] });
    const runner = makeRunner(extract);

    const result = await runner.extractAcrossWindows(windows(3));

    // NOT `{ status: 'extracted', drafts: [first] }`. Window 2's content was
    // never extracted, so a union of the others is a partial extraction wearing
    // a complete one — and the caller consumes the whole session's observations
    // on a complete one.
    expect(result).toEqual({
      status: 'no-output',
      usedTools: true,
      toolNames: ['Read'],
    });
    expect(extract).toHaveBeenCalledTimes(2);
  });
});
