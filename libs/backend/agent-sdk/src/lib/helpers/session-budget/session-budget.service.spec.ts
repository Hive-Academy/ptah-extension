/**
 * SessionBudgetService (TASK_2026_597 N7) — the advisory stage machine with
 * fakes for the config provider, the stats owner and session control.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type {
  SessionBudgetConfig,
  SessionBudgetWindow,
  SessionStatsEntry,
} from '@ptah-extension/shared';
import { SESSION_BUDGET_DEFAULT_CONFIG } from './session-budget-config.provider';
import {
  SESSION_BUDGET_NO_WINDOW_TARGET,
  SessionBudgetService,
  type SessionBudgetConfigSource,
  type SessionBudgetSessionControl,
  type SessionBudgetStatsSource,
} from './session-budget.service';
import type { ContextUsageReading } from '../compaction/context-usage.port';
import {
  SessionRotationAdvisor,
  type SessionRotationConfigSource,
} from '../compaction/session-rotation-advisor';
import { MainThreadNoticeQueue } from '../main-thread-notice-queue';

const SID = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-2222-4333-8444-555555555555';
const LIMIT = 50_000_000;

function snapshot(
  tokenCount: number | undefined,
  revision: number | undefined,
  overrides: Partial<SessionStatsEntry> = {},
): SessionStatsEntry {
  return {
    sessionId: SID,
    model: 'claude-test',
    totalCost: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    messageCount: 1,
    status: 'ok',
    ...(tokenCount !== undefined ? { tokenCount } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...overrides,
  };
}

/** `percent` of the 50M default limit. */
function at(
  percent: number,
  revision: number,
  sessionId = SID,
): SessionStatsEntry {
  return snapshot((LIMIT * percent) / 100, revision, { sessionId });
}

function live(percent: number, revision: number): SessionStatsEntry {
  return { ...at(percent, revision), provisional: true };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

interface Harness {
  service: SessionBudgetService;
  logger: MockLogger;
  setConfig(overrides: Partial<SessionBudgetConfig>): void;
  getConfig: jest.Mock;
  /** The stats owner's `leaseOf`: `null` = no run owns the session. */
  ownerLease: jest.Mock;
  applyWindow: jest.Mock;
  /** The context-usage port's `getLast`. */
  getLast: jest.Mock;
  notices: MainThreadNoticeQueue;
}

const ROTATION_THRESHOLD = 300_000;

function harness(initial: Partial<SessionBudgetConfig> = {}): Harness {
  let config: SessionBudgetConfig = {
    ...SESSION_BUDGET_DEFAULT_CONFIG,
    ...initial,
  };
  const logger = createMockLogger();
  const getConfig = jest.fn(() => config);
  const ownerLease = jest.fn(
    (): { generation: number; epoch: number } | null => null,
  );
  const applyWindow = jest.fn(
    async (
      _id: string,
      window: number | null,
    ): Promise<SessionBudgetWindow | undefined> =>
      window === null ? undefined : { target: window, applied: true },
  );
  const getLast = jest.fn(
    (_sessionId: string): ContextUsageReading | undefined => undefined,
  );
  const notices = new MainThreadNoticeQueue(logger as unknown as Logger);
  const advisor = new SessionRotationAdvisor(
    logger as unknown as Logger,
    {
      getConfig: () => ({ rotationSuggestTokens: ROTATION_THRESHOLD }),
    } as unknown as SessionRotationConfigSource,
    { getLast },
  );

  const service = new SessionBudgetService(
    logger as unknown as Logger,
    { getConfig } as SessionBudgetConfigSource,
    { leaseOf: ownerLease } as unknown as SessionBudgetStatsSource,
    {
      applySessionAutoCompactWindow: applyWindow,
    } as unknown as SessionBudgetSessionControl,
    advisor,
    notices,
  );
  return {
    service,
    logger,
    setConfig: (overrides) => {
      config = { ...config, ...overrides };
    },
    getConfig,
    ownerLease,
    applyWindow,
    getLast,
    notices,
  };
}

/** A port reading of `totalTokens` context. */
function reading(totalTokens: number): ContextUsageReading {
  return { totalTokens, maxTokens: 1_000_000, source: 'sdk-getContextUsage' };
}

/** INFO calls logging a live stage change. */
function liveStageLogs(h: Harness): unknown[][] {
  return h.logger.info.mock.calls.filter(([m]) =>
    String(m).startsWith('[SessionBudget] Live stage'),
  );
}

describe('SessionBudgetService.observe', () => {
  it('an absent snapshot returns undefined (the consumer keeps its state)', () => {
    const h = harness();
    expect(h.service.observe(undefined)).toBeUndefined();
    expect(h.service.observeLoaded(null)).toBeUndefined();
  });

  it('keys by snapshot.sessionId and reports the displayed tokenCount', () => {
    const h = harness();
    const state = h.service.observe(snapshot(1_234_567, 1));
    expect(state).toMatchObject({
      sessionId: SID,
      stage: 'normal',
      used: 1_234_567,
      limit: LIMIT,
      revision: 1,
    });
    expect(h.service.observe(at(10, 1, OTHER))?.sessionId).toBe(OTHER);
  });

  it('logs one INFO line per stage change', async () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.observe(at(20, 2));
    h.service.observe(at(60, 3));
    await flush();
    const stageLines = h.logger.info.mock.calls.filter(([message]) =>
      String(message).startsWith('[SessionBudget] Stage'),
    );
    expect(stageLines.map(([message]) => message)).toEqual([
      `[SessionBudget] Stage unknown -> normal for ${SID}`,
      `[SessionBudget] Stage normal -> tighten for ${SID}`,
    ]);
  });

  it('ignores a lower revision', () => {
    const h = harness();
    h.service.observe(at(60, 5));
    const state = h.service.observe(at(10, 4));
    expect(state).toMatchObject({
      stage: 'tighten',
      used: LIMIT * 0.6,
      revision: 5,
    });
  });

  it('no figure before the first one is unknown', () => {
    const h = harness();
    expect(h.service.observe(snapshot(undefined, 1))).toMatchObject({
      stage: 'unknown',
      used: null,
    });
  });

  it('the handoff stage at 80% and the limit stage past 100% are advisory only', () => {
    const h = harness();
    expect(h.service.observe(at(80, 1))?.stage).toBe('handoff');
    const state = h.service.observe(at(120, 2));
    expect(state?.stage).toBe('limit');
    expect(state).not.toHaveProperty('blocked');
  });
});

describe('SessionBudgetService — tighten', () => {
  it('advisory only by default: window reason disabled, nothing sent', async () => {
    const h = harness();
    h.service.observe(at(50, 1));
    await flush();
    const state = h.service.observe(at(51, 2));
    expect(state?.window).toEqual({
      target: SESSION_BUDGET_NO_WINDOW_TARGET,
      applied: false,
      reason: 'disabled',
    });
    expect(h.applyWindow).not.toHaveBeenCalled();
  });

  it('applies the configured window once per stage entry', async () => {
    const h = harness({ tightenWindowTokens: 200_000 });
    h.service.observe(at(55, 1));
    h.service.observe(at(60, 2));
    await flush();
    expect(h.applyWindow).toHaveBeenCalledTimes(1);
    expect(h.applyWindow).toHaveBeenCalledWith(SID, 200_000);
    expect(h.service.observe(at(61, 3))?.window).toEqual({
      target: 200_000,
      applied: true,
    });
  });

  it('a jump straight to limit still tightens once', async () => {
    const h = harness({ tightenWindowTokens: 200_000 });
    h.service.observe(at(105, 1));
    await flush();
    expect(h.applyWindow).toHaveBeenCalledTimes(1);
  });

  it('a window the runtime did not honour is reported and WARNed once per session', async () => {
    const h = harness({ tightenWindowTokens: 200_000 });
    h.applyWindow.mockResolvedValue({
      target: 200_000,
      applied: false,
      reason: 'not-honoured',
    });
    h.service.observe(at(55, 1));
    await flush();
    expect(h.service.observe(at(56, 2))?.window?.reason).toBe('not-honoured');
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('a throwing apply gives failed, WARNs, and the stage still advances', async () => {
    const h = harness({ tightenWindowTokens: 200_000 });
    h.applyWindow.mockRejectedValue(new Error('boom'));
    h.service.observe(at(55, 1));
    await flush();
    const state = h.service.observe(at(85, 2));
    expect(state?.window).toEqual({
      target: 200_000,
      applied: false,
      reason: 'failed',
    });
    expect(state?.stage).toBe('handoff');
    expect(h.logger.warn).toHaveBeenCalledWith(
      `[SessionBudget] tighten:failed failed for ${SID}`,
      { error: 'boom' },
    );
  });
});

describe('SessionBudgetService.recordCompaction', () => {
  it('handoffAfterCompactions compactions raise the stage to handoff', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.recordCompaction(SID);
    h.service.recordCompaction(SID);
    expect(h.service.observe(at(11, 2))?.stage).toBe('normal');
    h.service.recordCompaction(SID);
    expect(h.service.observe(at(12, 3))).toMatchObject({
      stage: 'handoff',
      compactions: 3,
    });
  });

  it('counts compactions seen before the first figure', () => {
    const h = harness();
    h.service.recordCompaction(SID);
    h.service.recordCompaction(SID);
    h.service.recordCompaction(SID);
    expect(h.service.observe(at(1, 1))?.stage).toBe('handoff');
  });
});

describe('SessionBudgetService — settings', () => {
  it('disabled: no stage on the next figure', () => {
    const h = harness();
    expect(h.service.observe(at(120, 1))?.stage).toBe('limit');
    h.setConfig({ enabled: false });
    expect(h.service.observe(at(121, 2))).toMatchObject({
      stage: 'unknown',
      used: null,
    });
  });

  it('a changed config recomputes the stage without the floor', () => {
    const h = harness();
    expect(h.service.observe(at(120, 1))?.stage).toBe('limit');
    h.setConfig({ tokens: 120_000_000 });
    expect(h.service.observe(at(120, 2))).toMatchObject({
      stage: 'tighten',
      limit: 120_000_000,
    });
  });

  it('a changed config resets the sticky weighted-fallback measure', () => {
    const h = harness({ unit: 'cost' });
    expect(
      h.service.observe(snapshot(1, 1, { pricingCoverage: 'none' }))?.measure,
    ).toBe('weighted-fallback');
    const priced = { totalCost: 3, pricingCoverage: 'full' as const };
    expect(h.service.observe(snapshot(1, 2, priced))?.measure).toBe(
      'weighted-fallback',
    );
    h.setConfig({ usd: 40 });
    expect(h.service.observe(snapshot(1, 3, priced))).toMatchObject({
      measure: 'cost',
      used: 3,
      limit: 40,
    });
  });

  it('a throwing config read during observe returns undefined and WARNs once', () => {
    const h = harness();
    h.getConfig.mockImplementation(() => {
      throw new Error('store down');
    });
    expect(h.service.observe(at(10, 1))).toBeUndefined();
    expect(h.service.observe(at(10, 2))).toBeUndefined();
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('SessionBudgetService.observeLoaded', () => {
  it('accepts a resume snapshot without revision only when no state exists', () => {
    const h = harness();
    expect(
      h.service.observeLoaded(snapshot(LIMIT * 0.6, undefined))?.stage,
    ).toBe('tighten');
    h.service.observe(at(10, 3));
    expect(h.service.observeLoaded(snapshot(LIMIT, undefined))).toMatchObject({
      stage: 'tighten',
      used: LIMIT * 0.1,
      revision: 3,
    });
  });

  it('recomputes the stage without running actions; the first live figure runs them', async () => {
    const h = harness({ tightenWindowTokens: 200_000 });
    const state = h.service.observeLoaded(at(105, 4));
    await flush();
    expect(state).toMatchObject({ stage: 'limit' });
    expect(h.applyWindow).not.toHaveBeenCalled();
    h.service.observe(at(106, 5));
    await flush();
    expect(h.applyWindow).toHaveBeenCalledTimes(1);
  });
});

describe('SessionBudgetService.observeLive', () => {
  it('81% returns handoff without posting a notice; logs once per rank', () => {
    const h = harness();
    const post = jest.spyOn(h.notices, 'post');
    h.service.observe(at(10, 1));

    expect(h.service.observeLive(live(81, 2))).toBe('handoff');
    expect(h.logger.info).toHaveBeenCalledWith(
      `[SessionBudget] Live stage normal -> handoff for ${SID}`,
      expect.objectContaining({ used: 40_500_000, percent: 81 }),
    );

    expect(h.service.observeLive(live(85, 3))).toBe('handoff');
    expect(liveStageLogs(h)).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('105% returns limit', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    expect(h.service.observeLive(live(105, 2))).toBe('limit');
  });

  it('does not log a stage the authoritative figure already acted on, and still reports it', () => {
    const h = harness();
    h.service.observe(at(85, 1));
    expect(h.service.observeLive(live(90, 2))).toBe('handoff');
    expect(liveStageLogs(h)).toHaveLength(0);
  });

  it('onTurnTerminal clears pending notices; the next turn logs again', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.observeLive(live(81, 2));
    h.notices.post(SID, 'pending');

    h.service.onTurnTerminal(SID);

    expect(h.notices.take(SID)).toBeUndefined();
    expect(h.service.observeLive(live(82, 3))).toBe('handoff');
    expect(liveStageLogs(h)).toHaveLength(2);
  });

  it('an accepted estimate below handoff returns null (clear)', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    expect(h.service.observeLive(live(50, 2))).toBeNull();
    expect(h.service.observeLive(live(75, 3))).toBeNull();
  });

  it('a fresh estimate after a settings change is re-staged; below handoff it returns null', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    expect(h.service.observeLive(live(81, 2))).toBe('handoff');
    h.setConfig({ tokens: LIMIT * 2 });
    expect(h.service.observeLive(live(82, 3))).toBeNull();
  });

  it('an estimate older than the authoritative figure returns undefined', () => {
    const h = harness();
    h.service.observe(at(20, 3));
    expect(h.service.observeLive(live(90, 2))).toBeUndefined();
  });

  it('a non-provisional snapshot and a released session return undefined; a disabled budget returns null', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    expect(h.service.observeLive(at(90, 2))).toBeUndefined();

    h.service.release(SID);
    expect(h.service.observeLive(live(90, 3))).toBeUndefined();

    const disabled = harness({ enabled: false });
    expect(disabled.service.observeLive(live(90, 1))).toBeNull();
  });

  it('an estimate measured differently (A3) returns undefined', () => {
    const h = harness({ unit: 'cost', usd: 10 });
    h.service.observe(
      snapshot(1_000, 1, { totalCost: 1, pricingCoverage: 'full' }),
    );
    expect(
      h.service.observeLive({
        ...snapshot(2_000, 2, { totalCost: 9, pricingCoverage: 'full' }),
        provisional: true,
      }),
    ).toBe('handoff');

    expect(
      h.service.observeLive({
        ...snapshot(3_000, 3, {
          totalCost: null,
          knownCost: 9.5,
          pricingCoverage: 'partial',
        }),
        provisional: true,
      }),
    ).toBeUndefined();
    expect(h.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        'measured as cost-lower-bound (authoritative cost)',
      ),
    );
  });

  it('never throws; a failure returns undefined and is WARNed once', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.getConfig.mockImplementation(() => {
      throw new Error('config unreadable');
    });

    let result: ReturnType<SessionBudgetService['observeLive']> = 'limit';
    expect(() => {
      result = h.service.observeLive(live(95, 3));
    }).not.toThrow();
    expect(result).toBeUndefined();
    expect(h.service.observeLive(live(96, 4))).toBeUndefined();

    const warns = h.logger.warn.mock.calls.filter(([m]) =>
      String(m).includes('observe-live'),
    );
    expect(warns).toHaveLength(1);
  });
});

describe('SessionBudgetService.release / clearAll', () => {
  it("release drops the session's pending main-thread notices", () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.notices.post(SID, 'pending');
    h.notices.post(OTHER, 'other session');

    h.service.release(SID);

    expect(h.notices.take(SID)).toBeUndefined();
    expect(h.notices.take(OTHER)).toBe('other session');
  });

  it("clearAll drops every session's pending notices", () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.observe(at(10, 1, OTHER));
    h.notices.post(SID, 'one');
    h.notices.post(OTHER, 'two');

    h.service.clearAll();

    expect(h.notices.take(SID)).toBeUndefined();
    expect(h.notices.take(OTHER)).toBeUndefined();
  });

  it('release and clearAll work without a notice queue', () => {
    const service = new SessionBudgetService(
      createMockLogger() as unknown as Logger,
      {
        getConfig: () => SESSION_BUDGET_DEFAULT_CONFIG,
      } as SessionBudgetConfigSource,
      { leaseOf: () => null } as unknown as SessionBudgetStatsSource,
      {
        applySessionAutoCompactWindow: jest.fn(),
      } as unknown as SessionBudgetSessionControl,
      { evaluate: jest.fn(), current: jest.fn(), release: jest.fn() },
    );
    service.observe(at(10, 1));
    expect(() => service.release(SID)).not.toThrow();
    expect(() => service.clearAll()).not.toThrow();
  });

  it('clearAll drops every session: the next figure starts a new entry', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.recordCompaction(SID);
    h.service.clearAll();
    expect(h.service.observe(at(10, 2))?.compactions).toBe(0);
  });

  it('M7: release, then a late result, creates no entry', () => {
    const h = harness();
    h.service.observe(at(120, 1));
    h.service.release(SID);

    // The run is over: its stats owner was released with it. `null` is the
    // explicit "no budget state" marker, so the client drops the card.
    expect(h.service.observe(at(130, 2))).toBeNull();
  });

  it('M7: release, then a late compaction, creates no entry', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.release(SID);
    h.service.recordCompaction(SID);
    h.service.recordCompaction(SID);
    h.service.recordCompaction(SID);

    // A new run starts the count from zero: the late compactions were dropped.
    h.ownerLease.mockReturnValue({ generation: 2, epoch: 1 });
    expect(h.service.observe(at(10, 2))?.compactions).toBe(0);
  });

  it('M7: a new run on a released id (its stats owner exists) is tracked again', () => {
    const h = harness();
    h.service.observe(at(120, 1));
    h.service.release(SID);
    h.ownerLease.mockReturnValue({ generation: 2, epoch: 1 });

    expect(h.service.observe(at(120, 2))?.stage).toBe('limit');
    // Tracked again: a later lookup no longer needs the owner.
    h.ownerLease.mockReturnValue(null);
    expect(h.service.observe(at(121, 3))?.stage).toBe('limit');
  });

  it('M7: loading a released session tracks it again', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.release(SID);
    expect(h.service.observeLoaded(at(60, 2))?.stage).toBe('tighten');
  });

  it('M7: a compaction before the first result still counts for a never-released id', () => {
    const h = harness();
    h.service.recordCompaction(SID);
    expect(h.service.observe(at(10, 1))?.compactions).toBe(1);
  });
});

describe('SessionBudgetService — rotation advisory (A6)', () => {
  // R-W4 (accepted): `observe` can run before the turn-end port read lands, so
  // the reading here may be the previous turn's and the advisory can arrive
  // one turn late. The specs feed the port reading before `observe`.

  it('attaches `rotation` from the port reading at or above the threshold', () => {
    const h = harness();
    h.getLast.mockReturnValue(reading(250_000));
    expect(h.service.observe(at(10, 1))?.rotation).toBeUndefined();

    h.getLast.mockReturnValue(reading(310_000));
    expect(h.service.observe(at(11, 2))?.rotation).toEqual({
      contextTokens: 310_000,
      threshold: ROTATION_THRESHOLD,
    });
    expect(h.getLast).toHaveBeenCalledWith(SID);
  });

  it('falls back to the snapshot last-turn context when the port has no reading', () => {
    const h = harness();
    const state = h.service.observe(
      snapshot(LIMIT * 0.1, 1, {
        contextSnapshot: { model: 'claude-test', contextTokens: 320_000 },
      }),
    );
    expect(state?.rotation).toEqual({
      contextTokens: 320_000,
      threshold: ROTATION_THRESHOLD,
    });
  });

  it('clears after a compaction drops the context, and comes back on the next crossing', () => {
    const h = harness();
    h.getLast.mockReturnValue(reading(310_000));
    expect(h.service.observe(at(10, 1))?.rotation).toBeDefined();
    h.getLast.mockReturnValue(reading(40_000));
    expect(h.service.observe(at(11, 2))?.rotation).toBeUndefined();
    h.getLast.mockReturnValue(reading(305_000));
    expect(h.service.observe(at(12, 3))?.rotation?.contextTokens).toBe(305_000);
  });

  it('disabled budget: the advisory still rides the disabled state', () => {
    const h = harness({ enabled: false });
    h.getLast.mockReturnValue(reading(400_000));
    expect(h.service.observe(at(10, 1))).toMatchObject({
      stage: 'unknown',
      used: null,
      rotation: { contextTokens: 400_000, threshold: ROTATION_THRESHOLD },
    });
  });

  it('release drops the advisory with the session state', () => {
    const h = harness({ enabled: false });
    h.getLast.mockReturnValue(reading(310_000));
    expect(h.service.observe(at(10, 1))?.rotation).toBeDefined();
    h.service.release(SID);
    // No figure at all on the next snapshot: nothing is carried over.
    h.getLast.mockReturnValue(undefined);
    expect(h.service.observe(at(10, 2))?.rotation).toBeUndefined();
  });
});
