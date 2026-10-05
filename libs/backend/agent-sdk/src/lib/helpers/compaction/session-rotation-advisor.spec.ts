/**
 * SessionRotationAdvisor (TASK_2026_597 A6) — one advisory per upward
 * crossing of `compaction.rotationSuggestTokens`, re-armed below it.
 *
 * R-W4 (accepted): the budget may observe a result before the turn-end port
 * read lands, so `getLast` can still hold the previous turn's reading and the
 * advisory can arrive one turn late. These specs drive `getLast` directly.
 */
import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { ContextUsageReading } from './context-usage.port';
import {
  SessionRotationAdvisor,
  type SessionRotationConfigSource,
} from './session-rotation-advisor';

const SID = 's1';
const THRESHOLD = 300_000;

function reading(totalTokens: number): ContextUsageReading {
  return { totalTokens, maxTokens: 1_000_000, source: 'sdk-getContextUsage' };
}

interface Harness {
  advisor: SessionRotationAdvisor;
  logger: MockLogger;
  getLast: jest.Mock;
  setThreshold(value: number): void;
}

function harness(withPort = true): Harness {
  const logger = createMockLogger();
  let threshold = THRESHOLD;
  const getLast = jest.fn(
    (_sessionId: string): ContextUsageReading | undefined => undefined,
  );
  const config = {
    getConfig: () => ({ rotationSuggestTokens: threshold }),
  } as unknown as SessionRotationConfigSource;
  const advisor = new SessionRotationAdvisor(
    logger as unknown as Logger,
    config,
    withPort ? { getLast } : undefined,
  );
  return {
    advisor,
    logger,
    getLast,
    setThreshold: (value) => {
      threshold = value;
    },
  };
}

/** INFO lines that announced a raised advisory. */
function raisedLines(logger: MockLogger): unknown[][] {
  return logger.info.mock.calls.filter(([message]) =>
    String(message).includes('Rotation suggested'),
  );
}

describe('SessionRotationAdvisor', () => {
  it('stays quiet below the threshold', () => {
    const h = harness();
    h.getLast.mockReturnValue(reading(THRESHOLD - 1));
    expect(h.advisor.evaluate(SID, undefined)).toBeUndefined();
    expect(h.advisor.current(SID)).toBeUndefined();
    expect(raisedLines(h.logger)).toHaveLength(0);
  });

  it('fires once per crossing: raised at the threshold, one INFO line while it stays above', () => {
    const h = harness();
    h.getLast.mockReturnValue(reading(THRESHOLD));
    expect(h.advisor.evaluate(SID, undefined)).toEqual({
      contextTokens: THRESHOLD,
      threshold: THRESHOLD,
    });
    h.getLast.mockReturnValue(reading(340_000));
    expect(h.advisor.evaluate(SID, undefined)).toEqual({
      contextTokens: 340_000,
      threshold: THRESHOLD,
    });
    expect(h.advisor.current(SID)?.contextTokens).toBe(340_000);
    expect(raisedLines(h.logger)).toHaveLength(1);
  });

  it('re-arms when the context drops below the threshold (after compaction) and fires again on the next crossing', () => {
    const h = harness();
    h.getLast.mockReturnValue(reading(320_000));
    h.advisor.evaluate(SID, undefined);
    h.getLast.mockReturnValue(reading(60_000));
    expect(h.advisor.evaluate(SID, undefined)).toBeUndefined();
    expect(h.advisor.current(SID)).toBeUndefined();
    h.getLast.mockReturnValue(reading(301_000));
    expect(h.advisor.evaluate(SID, undefined)?.contextTokens).toBe(301_000);
    expect(raisedLines(h.logger)).toHaveLength(2);
  });

  it('the port reading wins over the fallback; the fallback is used when the port has none', () => {
    const h = harness();
    h.getLast.mockReturnValue(reading(100_000));
    expect(h.advisor.evaluate(SID, 400_000)).toBeUndefined();
    h.getLast.mockReturnValue(undefined);
    expect(h.advisor.evaluate(SID, 400_000)).toEqual({
      contextTokens: 400_000,
      threshold: THRESHOLD,
    });
  });

  it('with no figure at all the previous answer stands', () => {
    const h = harness();
    h.getLast.mockReturnValue(reading(350_000));
    h.advisor.evaluate(SID, undefined);
    h.getLast.mockReturnValue(undefined);
    expect(h.advisor.evaluate(SID, undefined)?.contextTokens).toBe(350_000);
    expect(h.advisor.evaluate(SID, Number.NaN)?.contextTokens).toBe(350_000);
  });

  it('reads the threshold from the compaction settings on each evaluation', () => {
    const h = harness();
    h.getLast.mockReturnValue(reading(350_000));
    h.advisor.evaluate(SID, undefined);
    h.setThreshold(500_000);
    expect(h.advisor.evaluate(SID, undefined)).toBeUndefined();
  });

  it('keeps sessions apart and release drops one session only', () => {
    const h = harness();
    h.getLast.mockReturnValue(reading(350_000));
    h.advisor.evaluate('a', undefined);
    h.advisor.evaluate('b', undefined);
    h.advisor.release('a');
    expect(h.advisor.current('a')).toBeUndefined();
    expect(h.advisor.current('b')).toBeDefined();
  });

  it('port absent: no advisory and exactly one log line', () => {
    const h = harness(false);
    expect(h.advisor.evaluate(SID, 900_000)).toBeUndefined();
    expect(h.advisor.evaluate(SID, 900_000)).toBeUndefined();
    expect(h.advisor.current(SID)).toBeUndefined();
    expect(h.logger.info).toHaveBeenCalledTimes(1);
    expect(h.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Context usage port not registered'),
    );
    expect(h.logger.warn).not.toHaveBeenCalled();
  });
});
