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
import {
  sessionHandoffSeed,
  type SessionHandoffDocument,
} from './session-handoff-builder';
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
  /** The stats owner's `leaseOf`: `null` = no run owns the session. */
  ownerLease: jest.Mock;
  applyWindow: jest.Mock;
  getWorkspace: jest.Mock;
  /** Session control's `find`: the lifecycle record, idle by default. */
  findSession: jest.Mock;
  build: jest.Mock;
  write: jest.Mock;
  /** The writer's `read`: the handoff file on disk, `null` by default. */
  read: jest.Mock;
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
  const ownerSnapshot = jest.fn((): SessionStatsEntry | null => null);
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
  const getWorkspace = jest.fn((): string | undefined => '/workspace');
  const findSession = jest.fn(
    (_id: string): { turnInFlight: boolean } | undefined => undefined,
  );
  const build = jest.fn(async () => ({ document: document() }));
  const write = jest.fn(async (sessionId: string) => ({
    path: `/home/.ptah/handoffs/${sessionId}.md`,
  }));
  const read = jest.fn(
    async (
      _sessionId: string,
    ): Promise<{ path: string; content: string } | null> => null,
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
    {
      snapshot: ownerSnapshot,
      leaseOf: ownerLease,
    } as unknown as SessionBudgetStatsSource,
    {
      applySessionAutoCompactWindow: applyWindow,
      getSessionWorkspace: getWorkspace,
      find: findSession,
    } as unknown as SessionBudgetSessionControl,
    { build } as unknown as SessionBudgetHandoffBuilder,
    { write, read } as unknown as SessionBudgetHandoffWriter,
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
    ownerSnapshot,
    ownerLease,
    applyWindow,
    getWorkspace,
    findSession,
    build,
    write,
    read,
    getLast,
    notices,
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
    const state = h.service.observe(at(86, 2));
    expect(state?.handoff?.readStatus).toBe('workspace-unknown');
  });

  it('remembers the workspace: a preview after the lifecycle forgot the session still reads the transcript', async () => {
    const h = harness();
    h.getWorkspace.mockReturnValue('/remembered');
    h.service.observe(at(10, 1));
    h.getWorkspace.mockReturnValue(undefined);

    const result = await h.service.act(SID, 'preview-handoff');

    expect(result.success).toBe(true);
    expect(h.build).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SID, workspacePath: '/remembered' }),
    );
    const warns = h.logger.warn.mock.calls.filter(([m]) =>
      String(m).includes('handoff-read'),
    );
    expect(warns).toHaveLength(0);
  });

  it('keeps the first known workspace and prefers the live lookup', async () => {
    const h = harness();
    h.getWorkspace.mockReturnValue(undefined);
    h.service.observe(at(10, 1));
    h.getWorkspace.mockReturnValue('/first');
    h.service.observe(at(11, 2));
    h.getWorkspace.mockReturnValue('/second');
    h.service.observe(at(12, 3));

    h.getWorkspace.mockReturnValue('/live');
    await h.service.act(SID, 'preview-handoff');
    expect(h.build).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspacePath: '/live' }),
    );

    h.getWorkspace.mockReturnValue(undefined);
    h.service.observe(at(13, 4));
    await h.service.act(SID, 'preview-handoff');
    expect(h.build).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspacePath: '/first' }),
    );
  });

  it('a workspace never known still reports workspace-unknown on preview', async () => {
    const h = harness();
    h.getWorkspace.mockReturnValue(undefined);
    h.service.observe(at(10, 1));

    const result = await h.service.act(SID, 'preview-handoff');

    expect(result.success).toBe(true);
    expect(h.build).not.toHaveBeenCalled();
    expect(result.handoff?.content).toContain(SID);
  });

  it('a transcript read error marks the handoff read-failed and keeps the error out of the state', async () => {
    const h = harness();
    // Not a literal: the builder mock is typed from its default (no readError).
    const unreadable = {
      document: document(),
      readError: 'EACCES: /home/u/.claude/projects/x.jsonl',
    };
    h.build.mockResolvedValue(unreadable);
    h.service.observe(at(85, 1));
    await flush();
    const state = h.service.observe(at(86, 2));
    expect(state?.handoff?.readStatus).toBe('read-failed');
    expect(JSON.stringify(state)).not.toContain('EACCES');
    const warns = h.logger.warn.mock.calls.filter(([m]) =>
      String(m).includes('handoff-read'),
    );
    expect(warns).toHaveLength(1);
  });

  it('a transcript that was read leaves readStatus unset', async () => {
    const h = harness();
    h.service.observe(at(85, 1));
    await flush();
    const state = h.service.observe(at(86, 2));
    expect(state?.handoff).toBeDefined();
    expect(state?.handoff).not.toHaveProperty('readStatus');
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
      reason: 'restore-failed',
    });
    const failed = await h.service.act(SID, 'restore-window');
    expect(failed.success).toBe(false);
    expect(failed.error).toBe('Could not restore the auto-compact window');
    expect(failed.state?.window).toEqual({
      target: 200_000,
      applied: true,
      reason: 'restore-failed',
    });
  });

  it('restore-window succeeds when the window left in place is not a restore failure', async () => {
    const h = harness({ tightenWindowTokens: 200_000 });
    h.service.observe(at(60, 1));
    // A lowering failure (`applied: false, failed`) is not a restore failure.
    h.applyWindow.mockResolvedValueOnce({
      target: 200_000,
      applied: false,
      reason: 'failed',
    });
    const result = await h.service.act(SID, 'restore-window');
    expect(result.success).toBe(true);
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
    h.service.observe(at(10, 1));
    const result = await h.service.act(SID, 'preview-handoff');
    expect(result).toMatchObject({
      success: true,
      handoff: { content: '# Handoff', seed: 'seed:# Handoff', path: null },
    });
    expect(h.write).not.toHaveBeenCalled();
  });

  it('M5: write-handoff and preview-handoff for an unknown session fail and touch nothing', async () => {
    const h = harness();
    for (const action of ['write-handoff', 'preview-handoff'] as const) {
      expect(await h.service.act(OTHER, action)).toEqual({
        success: false,
        error: 'No budget state for this session',
        errorCode: 'NO_SESSION_BUDGET_STATE',
      });
    }
    // No transcript read, no file written (so the writer's prune never ran);
    // preview only looked for a handoff file and found none.
    expect(h.build).not.toHaveBeenCalled();
    expect(h.getWorkspace).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenCalledWith(OTHER);
  });

  // TASK_2026_627 6F S1: the rotate fallback runs after the session ended and
  // `release` dropped its entry; the handoff file written at the stage survives.
  it('preview-handoff for a released session returns the persisted handoff file', async () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.release(SID);
    const path = `/home/.ptah/handoffs/${SID}.md`;
    h.read.mockResolvedValue({ path, content: '# Persisted' });

    const result = await h.service.act(SID, 'preview-handoff');

    expect(result).toEqual({
      success: true,
      handoff: {
        content: '# Persisted',
        seed: sessionHandoffSeed('# Persisted'),
        path,
      },
    });
    expect(result.handoff?.seed).toContain('# Persisted');
    expect(h.read).toHaveBeenCalledWith(SID);
    expect(h.build).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });

  it('preview-handoff for a released session with no handoff file reports no state', async () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.release(SID);

    expect(await h.service.act(SID, 'preview-handoff')).toEqual({
      success: false,
      error: 'No budget state for this session',
      errorCode: 'NO_SESSION_BUDGET_STATE',
    });
    expect(h.build).not.toHaveBeenCalled();
  });

  it('preview-handoff for a live session never reads the file', async () => {
    const h = harness();
    h.service.observe(at(10, 1));
    await h.service.act(SID, 'preview-handoff');
    expect(h.read).not.toHaveBeenCalled();
  });

  it('M5: write-handoff for a released session fails and writes nothing', async () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.release(SID);
    expect(await h.service.act(SID, 'write-handoff')).toEqual({
      success: false,
      error: 'No budget state for this session',
      errorCode: 'NO_SESSION_BUDGET_STATE',
    });
    expect(h.write).not.toHaveBeenCalled();
  });

  it('D.6: preview-handoff reuses the kept copy while no newer snapshot was observed', async () => {
    const h = harness();
    h.service.observe(at(10, 1));
    await h.service.act(SID, 'write-handoff');
    h.build.mockResolvedValue({ document: document('# Newer') });
    const preview = await h.service.act(SID, 'preview-handoff');
    expect(preview.handoff).toEqual({
      content: '# Handoff',
      seed: 'seed:# Handoff',
      path: `/home/.ptah/handoffs/${SID}.md`,
    });
    expect(h.build).toHaveBeenCalledTimes(1);
  });

  it('D.6: preview-handoff builds afresh (not written) once a newer snapshot was observed', async () => {
    const h = harness();
    h.service.observe(at(10, 1));
    await h.service.act(SID, 'write-handoff');
    h.service.observe(at(20, 2));
    h.build.mockResolvedValue({ document: document('# Newer') });
    const preview = await h.service.act(SID, 'preview-handoff');
    expect(preview.handoff).toEqual({
      content: '# Newer',
      seed: 'seed:# Newer',
      path: null,
    });
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('D.6: preview-handoff builds afresh after the limit was extended', async () => {
    const h = harness();
    h.service.observe(at(85, 1));
    await flush();
    h.service.observe(at(100, 2));
    await flush();
    expect(h.write).toHaveBeenCalledTimes(2);
    expect((await h.service.act(SID, 'extend')).success).toBe(true);
    h.build.mockResolvedValue({ document: document('# Extended') });
    const preview = await h.service.act(SID, 'preview-handoff');
    expect(preview.handoff).toMatchObject({
      content: '# Extended',
      path: null,
    });
  });

  it('actions needing a state fail without one', async () => {
    const h = harness();
    for (const action of ['dismiss', 'extend', 'restore-window'] as const) {
      expect(await h.service.act(SID, action)).toEqual({
        success: false,
        error: 'No budget state for this session',
        errorCode: 'NO_SESSION_BUDGET_STATE',
      });
    }
  });

  it('a throwing collaborator gives success false and logs an error', async () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.build.mockRejectedValue(new Error('disk'));
    const result = await h.service.act(SID, 'write-handoff');
    expect(result).toMatchObject({
      success: false,
      error: 'The write-handoff action failed',
    });
    expect(h.logger.error).toHaveBeenCalled();
  });
});

/** A provisional in-turn snapshot at `percent` of the 50M limit. */
function live(percent: number, revision: number): SessionStatsEntry {
  return { ...at(percent, revision), provisional: true };
}

/** INFO calls logging a live stage change. */
function liveStageLogs(h: Harness): unknown[][] {
  return h.logger.info.mock.calls.filter(([m]) =>
    String(m).startsWith('[SessionBudget] Live stage'),
  );
}

describe('SessionBudgetService.observeLive', () => {
  it('S5: 81% returns handoff and raises stageFor without a refusal, a handoff write or a notice; logs once per rank', async () => {
    const h = harness();
    const post = jest.spyOn(h.notices, 'post');
    h.service.observe(at(10, 1));

    expect(h.service.observeLive(live(81, 2))).toBe('handoff');
    await flush();

    expect(h.service.stageFor(SID)).toBe('handoff');
    expect(h.service.canSend(SID)).toEqual({ ok: true });
    expect(h.write).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(h.notices.take(SID)).toBeUndefined();
    expect(h.logger.info).toHaveBeenCalledWith(
      `[SessionBudget] Live stage normal -> handoff for ${SID}`,
      expect.objectContaining({ used: 40_500_000, percent: 81 }),
    );

    expect(h.service.observeLive(live(85, 3))).toBe('handoff');
    expect(liveStageLogs(h)).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('S5: 105% returns limit, never blocks and posts nothing; authoritative 105% blocks', () => {
    const h = harness();
    const post = jest.spyOn(h.notices, 'post');
    h.service.observe(at(10, 1));

    expect(h.service.observeLive(live(105, 2))).toBe('limit');

    expect(h.service.stageFor(SID)).toBe('limit');
    expect(h.service.canSend(SID)).toEqual({ ok: true });
    expect(post).not.toHaveBeenCalled();

    h.service.observe(at(105, 3));
    expect(h.service.canSend(SID)).toMatchObject({ ok: false });
    expect(post).not.toHaveBeenCalled();
  });

  it('does not log a stage the authoritative figure already acted on, and still reports it', () => {
    const h = harness();
    const post = jest.spyOn(h.notices, 'post');
    h.service.observe(at(85, 1));

    expect(h.service.observeLive(live(90, 2))).toBe('handoff');

    expect(liveStageLogs(h)).toHaveLength(0);
    expect(post).not.toHaveBeenCalled();
    expect(h.service.stageFor(SID)).toBe('handoff');
  });

  it('onTurnTerminal clears the live stage and pending notices; the next turn logs again', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.observeLive(live(81, 2));
    h.notices.post(SID, 'pending');

    h.service.onTurnTerminal(SID);

    expect(h.service.stageFor(SID)).toBe('normal');
    expect(h.notices.take(SID)).toBeUndefined();
    expect(h.service.observeLive(live(82, 3))).toBe('handoff');
    expect(liveStageLogs(h)).toHaveLength(2);
  });

  it('S21: an accepted estimate below handoff returns null (clear)', () => {
    const h = harness();
    h.service.observe(at(10, 1));

    expect(h.service.observeLive(live(50, 2))).toBeNull();
    expect(h.service.observeLive(live(75, 3))).toBeNull();
  });

  it('S21: a fresh estimate after a settings change is re-staged; below handoff it returns null', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    expect(h.service.observeLive(live(81, 2))).toBe('handoff');

    h.setConfig({ tokens: LIMIT * 2 });

    expect(h.service.observeLive(live(82, 3))).toBeNull();
  });

  it('a newer authoritative snapshot replaces the estimate; an older live one is ignored', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.observeLive(live(81, 2));

    h.service.observe(at(20, 3));
    expect(h.service.stageFor(SID)).toBe('normal');

    expect(h.service.observeLive(live(90, 2))).toBeUndefined();
    expect(h.service.stageFor(SID)).toBe('normal');
  });

  it('S21: an estimate older than the authoritative figure returns undefined and keeps the retained estimate', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    expect(h.service.observeLive(live(81, 3))).toBe('handoff');
    // Authoritative revision 2: accepted, but older than the retained estimate.
    h.service.observe(at(12, 2));
    expect(h.service.stageFor(SID)).toBe('handoff');

    expect(h.service.observeLive(live(10, 1))).toBeUndefined();

    expect(h.service.stageFor(SID)).toBe('handoff');
  });

  it('S21: a non-provisional snapshot and a released session return undefined; a disabled budget returns null', () => {
    const h = harness();
    const post = jest.spyOn(h.notices, 'post');
    h.service.observe(at(10, 1));
    expect(h.service.observeLive(at(90, 2))).toBeUndefined();
    expect(h.service.stageFor(SID)).toBe('normal');

    h.service.release(SID);
    expect(h.service.observeLive(live(90, 3))).toBeUndefined();
    expect(h.service.stageFor(SID)).toBeUndefined();

    const disabled = harness({ enabled: false });
    expect(disabled.service.observeLive(live(90, 1))).toBeNull();
    expect(disabled.service.stageFor(SID)).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  it('S21: disabling the budget mid-turn returns null and drops the live figure', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.observeLive(live(81, 2));

    h.setConfig({ enabled: false });

    expect(h.service.observeLive(live(82, 3))).toBeNull();
    expect(h.service.stageFor(SID)).toBe('normal');
  });

  it('S21: an estimate measured differently (A3) returns undefined and keeps the retained estimate', () => {
    const h = harness({ unit: 'cost', usd: 10 });
    const post = jest.spyOn(h.notices, 'post');
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

    expect(h.service.stageFor(SID)).toBe('handoff');
    expect(post).not.toHaveBeenCalled();
    expect(h.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining(
        'measured as cost-lower-bound (authoritative cost)',
      ),
    );
  });

  it('S21: never throws; a failure returns undefined, keeps the retained estimate and is WARNed once', () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.service.observeLive(live(81, 2));
    h.getConfig.mockImplementation(() => {
      throw new Error('config unreadable');
    });

    let result: ReturnType<SessionBudgetService['observeLive']> = 'limit';
    expect(() => {
      result = h.service.observeLive(live(95, 3));
    }).not.toThrow();
    expect(result).toBeUndefined();
    expect(h.service.observeLive(live(96, 4))).toBeUndefined();

    expect(h.service.stageFor(SID)).toBe('handoff');
    const warns = h.logger.warn.mock.calls.filter(([m]) =>
      String(m).includes('observe-live'),
    );
    expect(warns).toHaveLength(1);
  });

  it('remembers the workspace for a preview after the lifecycle forgot it', async () => {
    const h = harness();
    h.getWorkspace.mockReturnValue('/live-ws');
    h.service.observeLive(live(10, 1));
    h.getWorkspace.mockReturnValue(undefined);

    await h.service.act(SID, 'preview-handoff');

    expect(h.build).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspacePath: '/live-ws' }),
    );
  });
});

describe("SessionBudgetService.act('request-wrap-up')", () => {
  const running = (h: Harness): void => {
    h.findSession.mockImplementation((id: string) =>
      id === SID ? { turnInFlight: true } : undefined,
    );
  };

  it('S6: posts once in a running turn at handoff; a repeat succeeds and posts nothing; posts again at limit', async () => {
    const h = harness();
    running(h);
    const post = jest.spyOn(h.notices, 'post');
    h.service.observe(at(10, 1));
    h.service.observeLive(live(81, 2));

    const first = await h.service.act(SID, 'request-wrap-up');

    expect(first).toMatchObject({ success: true });
    expect(first.errorCode).toBeUndefined();
    expect(post).toHaveBeenCalledTimes(1);
    expect(h.findSession).toHaveBeenCalledWith(SID);
    const notice = h.notices.take(SID) ?? '';
    expect(notice).toContain('The user asked you to wrap up');
    expect(notice).toContain('40,500,000 tokens of 50,000,000 tokens, 81%');
    expect(notice).toContain('Do not start new tasks, subagents or CLI lanes');
    expect(notice).toContain('ptah_agent_wait');
    expect(notice).toContain('The user will continue in a new session.');
    expect(notice).not.toContain('Ptah will ask');
    expect(h.logger.info).toHaveBeenCalledWith(
      `[SessionBudget] Wrap-up requested by the user for ${SID} at handoff`,
    );

    const repeat = await h.service.act(SID, 'request-wrap-up');
    expect(repeat).toMatchObject({ success: true });
    expect(post).toHaveBeenCalledTimes(1);

    h.service.observeLive(live(105, 3));
    const atLimit = await h.service.act(SID, 'request-wrap-up');
    expect(atLimit).toMatchObject({ success: true });
    expect(post).toHaveBeenCalledTimes(2);
    expect(h.notices.take(SID)).toContain('Stop now');
    expect(h.logger.info).toHaveBeenCalledWith(
      `[SessionBudget] Wrap-up requested by the user for ${SID} at limit`,
    );

    await h.service.act(SID, 'request-wrap-up');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('S6: after onTurnTerminal the next turn may post again', async () => {
    const h = harness();
    running(h);
    const post = jest.spyOn(h.notices, 'post');
    h.service.observe(at(85, 1));
    await flush();

    await h.service.act(SID, 'request-wrap-up');
    expect(post).toHaveBeenCalledTimes(1);

    h.service.onTurnTerminal(SID);
    expect(h.notices.take(SID)).toBeUndefined();

    expect(await h.service.act(SID, 'request-wrap-up')).toMatchObject({
      success: true,
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('S6: refused while the session is idle; never posts', async () => {
    const h = harness();
    const post = jest.spyOn(h.notices, 'post');
    h.service.observe(at(85, 1));

    expect(await h.service.act(SID, 'request-wrap-up')).toMatchObject({
      success: false,
      errorCode: 'WRAP_UP_UNAVAILABLE',
      state: expect.objectContaining({ stage: 'handoff' }),
    });

    h.findSession.mockReturnValue({ turnInFlight: false });
    expect(await h.service.act(SID, 'request-wrap-up')).toMatchObject({
      success: false,
      errorCode: 'WRAP_UP_UNAVAILABLE',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('S6: refused below handoff, without a budget entry and with the budget disabled', async () => {
    const h = harness();
    running(h);
    const post = jest.spyOn(h.notices, 'post');

    expect(await h.service.act(SID, 'request-wrap-up')).toEqual({
      success: false,
      error: 'The agent is not working on a turn at the handoff or limit stage',
      errorCode: 'WRAP_UP_UNAVAILABLE',
    });

    h.service.observe(at(70, 1));
    expect(await h.service.act(SID, 'request-wrap-up')).toMatchObject({
      success: false,
      errorCode: 'WRAP_UP_UNAVAILABLE',
    });

    h.service.observe(at(90, 2));
    h.setConfig({ enabled: false });
    expect(await h.service.act(SID, 'request-wrap-up')).toMatchObject({
      success: false,
      errorCode: 'WRAP_UP_UNAVAILABLE',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('refused without a notice queue', async () => {
    const service = new SessionBudgetService(
      createMockLogger() as unknown as Logger,
      {
        getConfig: () => SESSION_BUDGET_DEFAULT_CONFIG,
      } as SessionBudgetConfigSource,
      {
        snapshot: () => null,
        leaseOf: () => null,
      } as unknown as SessionBudgetStatsSource,
      {
        applySessionAutoCompactWindow: jest.fn(),
        getSessionWorkspace: () => '/workspace',
        find: () => ({ turnInFlight: true }),
      } as unknown as SessionBudgetSessionControl,
      { build: jest.fn() } as unknown as SessionBudgetHandoffBuilder,
      { write: jest.fn() } as unknown as SessionBudgetHandoffWriter,
      { evaluate: jest.fn(), current: jest.fn(), release: jest.fn() },
    );
    service.observe(at(85, 1));

    expect(await service.act(SID, 'request-wrap-up')).toMatchObject({
      success: false,
      errorCode: 'WRAP_UP_UNAVAILABLE',
    });
  });

  it('627-L19: at a blocking limit the notice names the "New session" click; a non-blocking limit does not', async () => {
    const blocking = harness();
    running(blocking);
    blocking.service.observe(at(105, 1));

    await blocking.service.act(SID, 'request-wrap-up');

    const notice = blocking.notices.take(SID) ?? '';
    expect(notice).toContain('reached its budget limit');
    expect(notice).toContain('Stop now');
    expect(notice).toContain('The user will continue in a new session.');
    expect(notice).toContain('the user will click "New session"');

    const open = harness({ blockAtLimit: false });
    running(open);
    open.service.observe(at(105, 1));

    await open.service.act(SID, 'request-wrap-up');

    const openNotice = open.notices.take(SID) ?? '';
    expect(openNotice).toContain('reached its budget limit');
    expect(openNotice).not.toContain('New session');
  });

  it('extend resets the requested rank: the lower stage may be requested again in the same turn', async () => {
    const h = harness();
    running(h);
    const post = jest.spyOn(h.notices, 'post');
    h.service.observe(at(105, 1));
    await h.service.act(SID, 'request-wrap-up');
    expect(post).toHaveBeenCalledTimes(1);

    const extended = await h.service.act(SID, 'extend');
    expect(extended.state?.stage).toBe('handoff');

    await h.service.act(SID, 'request-wrap-up');
    expect(post).toHaveBeenCalledTimes(2);
    expect(h.notices.take(SID)).toContain('near its budget');
  });

  it('a settings change resets the requested rank', async () => {
    const h = harness();
    running(h);
    const post = jest.spyOn(h.notices, 'post');
    h.service.observe(at(90, 1));
    await h.service.act(SID, 'request-wrap-up');
    expect(post).toHaveBeenCalledTimes(1);

    h.setConfig({ handoffPercent: 85 });
    h.service.observe(at(90, 2));

    await h.service.act(SID, 'request-wrap-up');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('never throws when session control fails', async () => {
    const h = harness();
    h.findSession.mockImplementation(() => {
      throw new Error('lifecycle gone');
    });
    h.service.observe(at(85, 1));

    await expect(h.service.act(SID, 'request-wrap-up')).resolves.toMatchObject({
      success: false,
    });
    expect(h.notices.take(SID)).toBeUndefined();
  });
});

describe('SessionBudgetService.release / clearAll', () => {
  it('release drops the state; canSend falls back to the owner snapshot', () => {
    const h = harness();
    h.service.observe(at(120, 1));
    h.service.release(SID);
    expect(h.service.canSend(SID)).toEqual({ ok: true });
  });

  it("release drops the session's pending main-thread notices", () => {
    const h = harness();
    h.service.observe(at(10, 1));
    h.notices.post(SID, 'wrap up');
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
      {
        snapshot: () => null,
        leaseOf: () => null,
      } as unknown as SessionBudgetStatsSource,
      {
        applySessionAutoCompactWindow: jest.fn(),
        getSessionWorkspace: () => '/workspace',
      } as unknown as SessionBudgetSessionControl,
      { build: jest.fn() } as unknown as SessionBudgetHandoffBuilder,
      { write: jest.fn() } as unknown as SessionBudgetHandoffWriter,
      { evaluate: jest.fn(), current: jest.fn(), release: jest.fn() },
    );
    service.observe(at(10, 1));
    expect(() => service.release(SID)).not.toThrow();
    expect(() => service.clearAll()).not.toThrow();
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

  it('M7: release, then a late result, creates no entry', async () => {
    const h = harness();
    h.service.observe(at(120, 1));
    h.service.release(SID);

    // The run is over: its stats owner was released with it. `null` is the
    // explicit "no budget state" marker, so the client drops the card.
    expect(h.service.observe(at(130, 2))).toBeNull();
    expect(h.service.canSend(SID)).toEqual({ ok: true });
    expect(await h.service.act(SID, 'dismiss')).toEqual({
      success: false,
      error: 'No budget state for this session',
      errorCode: 'NO_SESSION_BUDGET_STATE',
    });
    await flush();
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('M7: release, then a late compaction, creates no entry', async () => {
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

    expect(h.service.observe(at(120, 2))).toMatchObject({
      stage: 'limit',
      blocked: true,
    });
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
