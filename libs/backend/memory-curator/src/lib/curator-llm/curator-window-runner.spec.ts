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
import { CURATOR_MAX_WINDOWS } from './transcript-windows';
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
