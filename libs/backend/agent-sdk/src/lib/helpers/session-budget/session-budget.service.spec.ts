/**
 * SessionBudgetService (TASK_2026_597 N7) — the stage machine with fakes for
 * the config provider, the stats owner, session control and the handoff
 * builder and writer.
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
import type { SessionHandoffDocument } from './session-handoff-builder';
import {
  SESSION_BUDGET_NO_WINDOW_TARGET,
  SessionBudgetService,
  type SessionBudgetConfigSource,
  type SessionBudgetHandoffBuilder,
  type SessionBudgetHandoffWriter,
  type SessionBudgetSessionControl,
  type SessionBudgetStatsSource,
} from './session-budget.service';
import type { ContextUsageReading } from '../compaction/context-usage.port';
import {
  SessionRotationAdvisor,
  type SessionRotationConfigSource,
} from '../compaction/session-rotation-advisor';

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

function document(content = '# Handoff'): SessionHandoffDocument {
  return {
    content,
    seed: `seed:${content}`,
    chars: content.length,
    truncated: false,
    builtAt: 1_700_000_000_000,
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

interface Harness {
  service: SessionBudgetService;
  logger: MockLogger;
  setConfig(overrides: Partial<SessionBudgetConfig>): void;
  getConfig: jest.Mock;
  ownerSnapshot: jest.Mock;
  applyWindow: jest.Mock;
  getWorkspace: jest.Mock;
  build: jest.Mock;
  write: jest.Mock;
  /** The context-usage port's `getLast`. */
  getLast: jest.Mock;
}

const ROTATION_THRESHOLD = 300_000;

function harness(initial: Partial<SessionBudgetConfig> = {}): Harness {
  let config: SessionBudgetConfig = {
    ...SESSION_BUDGET_DEFAULT_CONFIG,
    ...initial,
  };
  const logger = createMockLogger();
  const getConfig = jest.fn(() => config);
  const ownerSnapshot = jest.fn((): SessionStatsEntry | null => null);
  const applyWindow = jest.fn(
    async (
      _id: string,
      window: number | null,
    ): Promise<SessionBudgetWindow | undefined> =>
      window === null ? undefined : { target: window, applied: true },
  );
  const getWorkspace = jest.fn((): string | undefined => '/workspace');
  const build = jest.fn(async () => ({ document: document() }));
  const write = jest.fn(async (sessionId: string) => ({
    path: `/home/.ptah/handoffs/${sessionId}.md`,
  }));

  const getLast = jest.fn(
    (_sessionId: string): ContextUsageReading | undefined => undefined,
  );
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
    { snapshot: ownerSnapshot } as unknown as SessionBudgetStatsSource,
    {
      applySessionAutoCompactWindow: applyWindow,
      getSessionWorkspace: getWorkspace,
    } as unknown as SessionBudgetSessionControl,
    { build } as unknown as SessionBudgetHandoffBuilder,
    { write } as unknown as SessionBudgetHandoffWriter,
    advisor,
  );
  return {
    service,
    logger,
    setConfig: (overrides) => {
      config = { ...config, ...overrides };
    },
    getConfig,
    ownerSnapshot,
    applyWindow,
    getWorkspace,
    build,
    write,
    getLast,
  };
}

/** A port reading of `totalTokens` context. */
function reading(totalTokens: number): ContextUsageReading {
  return { totalTokens, maxTokens: 1_000_000, source: 'sdk-getContextUsage' };
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
      blocked: false,
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

  it('no figure before the first one is unknown and never blocks', () => {
    const h = harness();
    expect(h.service.observe(snapshot(undefined, 1))).toMatchObject({
      stage: 'unknown',
      used: null,
      blocked: false,
    });
    expect(h.service.canSend(SID)).toEqual({ ok: true });
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

describe('SessionBudgetService — handoff and limit', () => {
  it('handoff writes once on entry and publishes the result', async () => {
    const h = harness();
    h.service.observe(at(80, 1));
    h.service.observe(at(85, 2));
    await flush();
    expect(h.build).toHaveBeenCalledTimes(1);
    expect(h.build).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SID, workspacePath: '/workspace' }),
    );
    expect(h.write).toHaveBeenCalledWith(SID, '# Handoff');
    expect(h.service.observe(at(86, 3))?.handoff).toEqual({
      path: `/home/.ptah/handoffs/${SID}.md`,
      chars: '# Handoff'.length,
      truncated: false,
      writtenAt: 1_700_000_000_000,
    });
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('limit: a fresh write and the session is blocked', async () => {
    const h = harness();
    h.service.observe(at(85, 1));
    await flush();
    const state = h.service.observe(at(100, 2));
    await flush();
    expect(state).toMatchObject({ stage: 'limit', blocked: true });
    expect(h.write).toHaveBeenCalledTimes(2);
    expect(h.service.canSend(SID)).toEqual({
      ok: false,
      state: expect.objectContaining({ stage: 'limit', blocked: true }),
    });
  });

  it('a jump straight to limit tightens and writes once', async () => {
    const h = harness({ tightenWindowTokens: 200_000 });
    h.service.observe(at(130, 1));
    await flush();
    expect(h.applyWindow).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('blockAtLimit off: limit is reached but sends pass', () => {
    const h = harness({ blockAtLimit: false });
    expect(h.service.observe(at(120, 1))).toMatchObject({
      stage: 'limit',
      blocked: false,
    });
    expect(h.service.canSend(SID)).toEqual({ ok: true });
  });

  it('F7: at most the crossing turn plus one held follow-up run past 100%', async () => {
    const h = harness();
    // Turn N ends at 99.9%: the follow-up queued during it is released.
    h.service.observe(at(99.9, 1));
    expect(h.service.canSend(SID)).toEqual({ ok: true });
    // Turn N+1 (the crossing turn) ends past 100%. The held follow-up was
    // released by onTurnEnd before this figure arrived; it runs once.
    h.service.observe(at(101, 2));
    // The held follow-up's own result: still blocked, no second fresh write.
    h.service.observe(at(103, 3));
    await flush();
    expect(h.service.canSend(SID).ok).toBe(false);
    expect(h.write).toHaveBeenCalledTimes(2); // handoff entry + limit entry
  });

  it('a failed write keeps the content in memory, sets writeError, WARNs once', async () => {
    const h = harness();
    h.write.mockResolvedValue({
      path: null,
      writeError: 'Could not write (EACCES)',
    });
    h.service.observe(at(85, 1));
    await flush();
    const state = h.service.observe(at(100, 2));
    await flush();
    expect(state?.handoff).toMatchObject({
      path: null,
      writeError: 'Could not write (EACCES)',
    });
    const preview = await h.service.act(SID, 'preview-handoff');
    expect(preview.handoff).toEqual({
      content: '# Handoff',
      seed: 'seed:# Handoff',
      path: null,
    });
    const warns = h.logger.warn.mock.calls.filter(([m]) =>
      String(m).includes('handoff-write'),
    );
    expect(warns).toHaveLength(1);
  });

  it('an unknown workspace builds the handoff without the transcript', async () => {
    const h = harness();
    h.getWorkspace.mockReturnValue(undefined);
    h.service.observe(at(85, 1));
    await flush();
    expect(h.build).not.toHaveBeenCalled();
    expect(h.write).toHaveBeenCalledWith(SID, expect.stringContaining(SID));
  });
});

describe('SessionBudgetService.recordCompaction', () => {
  it('handoffAfterCompactions compactions raise the stage to handoff', async () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.recordCompaction(SID);
    h.service.recordCompaction(SID);
    expect(h.service.observe(at(11, 2))?.stage).toBe('normal');
    h.service.recordCompaction(SID);
    await flush();
    expect(h.write).toHaveBeenCalledTimes(1);
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

describe('SessionBudgetService.canSend', () => {
  it('without state, evaluates the owner snapshot on the fly', () => {
    const h = harness();
    h.ownerSnapshot.mockReturnValue(at(100, 9));
    expect(h.service.canSend(SID)).toEqual({
      ok: false,
      state: expect.objectContaining({ sessionId: SID, stage: 'limit' }),
    });
    expect(h.ownerSnapshot).toHaveBeenCalledWith(SID);

    const below = harness();
    below.ownerSnapshot.mockReturnValue(at(50, 9));
    expect(below.service.canSend(SID)).toEqual({ ok: true });
  });

  it('S-3: a refusal from the snapshot installs its figure, so extend works and the gate opens', async () => {
    const h = harness();
    h.ownerSnapshot.mockReturnValue(at(105, 9));
    const refused = h.service.canSend(SID);
    expect(refused).toEqual({
      ok: false,
      state: expect.objectContaining({
        sessionId: SID,
        stage: 'limit',
        blocked: true,
        revision: 9,
      }),
    });

    const extended = await h.service.act(SID, 'extend');
    expect(extended).toEqual({
      success: true,
      state: expect.objectContaining({
        extensions: 1,
        limit: 60_000_000,
        blocked: false,
      }),
    });
    expect(h.service.canSend(SID)).toEqual({ ok: true });
  });

  it('S-3: a figure dropped while disabled is rebuilt from the kept snapshot when re-enabled over the limit', async () => {
    const h = harness({ enabled: false });
    h.service.observe(at(120, 1));
    h.setConfig({ enabled: true });

    const refused = h.service.canSend(SID);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.state.stage).toBe('limit');
    expect((await h.service.act(SID, 'extend')).success).toBe(true);
  });

  it('S-3: extend with no stored figure builds one from the current snapshot', async () => {
    const h = harness();
    h.ownerSnapshot.mockReturnValue(at(105, 4));
    const result = await h.service.act(SID, 'extend');
    expect(result).toEqual({
      success: true,
      state: expect.objectContaining({ extensions: 1, blocked: false }),
    });
  });

  it('S-2: disabling the budget while blocked opens the gate at once; re-enabling blocks again', () => {
    const h = harness();
    expect(h.service.observe(at(120, 1))?.blocked).toBe(true);
    h.setConfig({ enabled: false });
    expect(h.service.canSend(SID)).toEqual({ ok: true });
    h.setConfig({ enabled: true });
    expect(h.service.canSend(SID).ok).toBe(false);
  });

  it('S-2: turning blockAtLimit off while blocked opens the gate with no new result', () => {
    const h = harness();
    expect(h.service.observe(at(120, 1))?.blocked).toBe(true);
    h.setConfig({ blockAtLimit: false });
    expect(h.service.canSend(SID)).toEqual({ ok: true });
  });

  it('S-2: raising the limit while blocked re-evaluates the stored figure', () => {
    const h = harness();
    expect(h.service.observe(at(120, 1))?.blocked).toBe(true);
    h.setConfig({ tokens: 120_000_000 });
    expect(h.service.canSend(SID)).toEqual({ ok: true });
    // The re-evaluated figure is the one the next result builds on.
    expect(h.service.observe(at(120, 2))).toMatchObject({
      stage: 'tighten',
      limit: 120_000_000,
    });
  });

  it('S-2: lowering the limit refuses with the re-evaluated state', () => {
    const h = harness();
    h.service.observe(at(50, 1));
    expect(h.service.canSend(SID)).toEqual({ ok: true });
    h.setConfig({ tokens: LIMIT / 4 });
    expect(h.service.canSend(SID)).toEqual({
      ok: false,
      state: expect.objectContaining({
        stage: 'limit',
        limit: LIMIT / 4,
        blocked: true,
      }),
    });
  });

  it('without state or snapshot, ok (fail-open)', () => {
    const h = harness();
    expect(h.service.canSend(SID)).toEqual({ ok: true });
  });

  it('a throwing snapshot read is ok and WARNs', () => {
    const h = harness();
    h.ownerSnapshot.mockImplementation(() => {
      throw new Error('owner down');
    });
    expect(h.service.canSend(SID)).toEqual({ ok: true });
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('disabled: the snapshot fallback never blocks', () => {
    const h = harness({ enabled: false });
    h.ownerSnapshot.mockReturnValue(at(200, 1));
    expect(h.service.canSend(SID)).toEqual({ ok: true });
  });
});

describe('SessionBudgetService — settings', () => {
  it('disabled: no stage, no block on the next figure', () => {
    const h = harness();
    expect(h.service.observe(at(120, 1))?.blocked).toBe(true);
    h.setConfig({ enabled: false });
    expect(h.service.observe(at(121, 2))).toMatchObject({
      stage: 'unknown',
      used: null,
      blocked: false,
    });
    expect(h.service.canSend(SID)).toEqual({ ok: true });
  });

  it('a changed config recomputes the stage without the floor', () => {
    const h = harness();
    expect(h.service.observe(at(120, 1))?.stage).toBe('limit');
    h.setConfig({ tokens: 120_000_000 });
    expect(h.service.observe(at(120, 2))).toMatchObject({
      stage: 'tighten',
      limit: 120_000_000,
      blocked: false,
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

  it('recomputes the stage (blocked at limit) without running actions; the first live figure runs them', async () => {
    const h = harness();
    const state = h.service.observeLoaded(at(105, 4));
    await flush();
    expect(state).toMatchObject({ stage: 'limit', blocked: true });
    expect(h.write).not.toHaveBeenCalled();
    h.service.observe(at(106, 5));
    await flush();
    expect(h.write).toHaveBeenCalledTimes(1);
  });
});

describe('SessionBudgetService.act', () => {
  it('extend: limit only, +20% per extension, INFO, unblocks', async () => {
    const h = harness();
    h.service.observe(at(85, 1));
    expect((await h.service.act(SID, 'extend')).success).toBe(false);

    h.service.observe(at(105, 2));
    const result = await h.service.act(SID, 'extend');
    expect(result).toEqual({
      success: true,
      state: expect.objectContaining({
        stage: 'handoff',
        limit: 60_000_000,
        extensions: 1,
        blocked: false,
      }),
    });
    expect(h.service.canSend(SID)).toEqual({ ok: true });
    expect(h.logger.info).toHaveBeenCalledWith(
      `[SessionBudget] Limit extended by 20% for ${SID}`,
      expect.objectContaining({ extensions: 1, limit: 60_000_000 }),
    );

    // Crossing the extended limit blocks again with a fresh write.
    const writesBefore = h.write.mock.calls.length;
    expect(h.service.observe(at(121, 3))).toMatchObject({
      stage: 'limit',
      blocked: true,
    });
    await flush();
    expect(h.write).toHaveBeenCalledTimes(writesBefore + 1);
  });

  it('dismiss records the dismissed stage', async () => {
    const h = harness();
    h.service.observe(at(60, 1));
    const result = await h.service.act(SID, 'dismiss');
    expect(result.state?.dismissedStage).toBe('tighten');
    expect(h.service.observe(at(61, 2))?.dismissedStage).toBe('tighten');
  });

  it('restore-window clears the window; a failed restore reports failure', async () => {
    const h = harness({ tightenWindowTokens: 200_000 });
    h.service.observe(at(60, 1));
    const restored = await h.service.act(SID, 'restore-window');
    expect(h.applyWindow).toHaveBeenLastCalledWith(SID, null);
    expect(restored.success).toBe(true);
    expect(restored.state?.window).toBeUndefined();

    h.applyWindow.mockResolvedValueOnce({
      target: 200_000,
      applied: true,
      reason: 'failed',
    });
    const failed = await h.service.act(SID, 'restore-window');
    expect(failed.success).toBe(false);
    expect(failed.state?.window).toEqual({
      target: 200_000,
      applied: true,
      reason: 'failed',
    });
  });

  it('write-handoff builds, writes and returns the content and seed', async () => {
    const h = harness();
    h.service.observe(at(10, 1));
    const result = await h.service.act(SID, 'write-handoff');
    expect(result).toEqual({
      success: true,
      state: expect.objectContaining({
        handoff: expect.objectContaining({
          path: `/home/.ptah/handoffs/${SID}.md`,
        }),
      }),
      handoff: {
        content: '# Handoff',
        seed: 'seed:# Handoff',
        path: `/home/.ptah/handoffs/${SID}.md`,
      },
    });
  });

  it('preview-handoff without a kept copy builds one and does not write it', async () => {
    const h = harness();
    const result = await h.service.act(SID, 'preview-handoff');
    expect(result).toEqual({
      success: true,
      handoff: { content: '# Handoff', seed: 'seed:# Handoff', path: null },
    });
    expect(h.write).not.toHaveBeenCalled();
  });

  it('actions needing a state fail without one', async () => {
    const h = harness();
    for (const action of ['dismiss', 'extend', 'restore-window'] as const) {
      expect(await h.service.act(SID, action)).toEqual({
        success: false,
        error: 'No budget state for this session',
      });
    }
  });

  it('a throwing collaborator gives success false and logs an error', async () => {
    const h = harness();
    h.build.mockRejectedValue(new Error('disk'));
    const result = await h.service.act(SID, 'write-handoff');
    expect(result).toEqual({
      success: false,
      error: 'The write-handoff action failed',
    });
    expect(h.logger.error).toHaveBeenCalled();
  });
});

describe('SessionBudgetService.release / clearAll', () => {
  it('release drops the state; canSend falls back to the owner snapshot', () => {
    const h = harness();
    h.service.observe(at(120, 1));
    h.service.release(SID);
    expect(h.service.canSend(SID)).toEqual({ ok: true });
  });

  it('clearAll drops every session', async () => {
    const h = harness();
    h.service.observe(at(120, 1));
    h.service.observe(at(120, 1, OTHER));
    h.service.clearAll();
    expect(h.service.canSend(SID)).toEqual({ ok: true });
    expect(h.service.canSend(OTHER)).toEqual({ ok: true });
    expect((await h.service.act(SID, 'dismiss')).success).toBe(false);
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
      blocked: false,
      rotation: { contextTokens: 400_000, threshold: ROTATION_THRESHOLD },
    });
  });

  it('every state composed afterwards (actions included) carries the advisory', async () => {
    const h = harness();
    h.getLast.mockReturnValue(reading(310_000));
    h.service.observe(at(60, 1));
    const dismissed = await h.service.act(SID, 'dismiss');
    expect(dismissed.state?.rotation).toEqual({
      contextTokens: 310_000,
      threshold: ROTATION_THRESHOLD,
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

  it('R-W2: preview-handoff works with the budget disabled for a session with a live stats entry', async () => {
    const h = harness({ enabled: false });
    h.getLast.mockReturnValue(reading(310_000));
    h.service.observe(at(10, 1));
    const result = await h.service.act(SID, 'preview-handoff');
    expect(result).toEqual({
      success: true,
      handoff: { content: '# Handoff', seed: 'seed:# Handoff', path: null },
    });
    // Built from the transcript (no budget figure to embed), never written.
    expect(h.build).toHaveBeenCalledWith({
      sessionId: SID,
      workspacePath: '/workspace',
    });
    expect(h.write).not.toHaveBeenCalled();
  });
});
