import { TestBed } from '@angular/core/testing';
import type {
  SkillSuggestionSummary,
  SkillSynthesisDrainRun,
  SkillSynthesisQueueItem,
  SkillSynthesisStageSpend,
} from '@ptah-extension/shared';

import { SkillSynthesisStateService } from './skill-synthesis-state.service';
import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

function suggestion(
  overrides: Partial<SkillSuggestionSummary> = {},
): SkillSuggestionSummary {
  return {
    id: 'sg-1',
    name: 'scaffold-nest-module',
    description: 'Scaffold a NestJS feature module with tests',
    clusterSize: 3,
    technologyFingerprint: 'nestjs,jest',
    judgeScore: 8.2,
    memberSessionIds: ['a', 'b', 'c'],
    status: 'pending',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeRpc(): jest.Mocked<
  Pick<
    SkillSynthesisRpcService,
    'listSuggestions' | 'acceptSuggestion' | 'dismissSuggestion' | 'stats'
  >
> {
  return {
    listSuggestions: jest.fn(async () => [suggestion()]),
    acceptSuggestion: jest.fn(async () => ({
      accepted: true,
      filePath: '/skills/sg-1/SKILL.md',
    })),
    dismissSuggestion: jest.fn(async () => true),
    stats: jest.fn(async () => ({
      totalCandidates: 4,
      totalPromoted: 2,
      totalRejected: 1,
      totalInvocations: 7,
      activeSkills: 2,
    })),
  } as unknown as jest.Mocked<
    Pick<
      SkillSynthesisRpcService,
      'listSuggestions' | 'acceptSuggestion' | 'dismissSuggestion' | 'stats'
    >
  >;
}

describe('SkillSynthesisStateService — candidate scope', () => {
  function setup() {
    const rpc = {
      listCandidates: jest.fn(async () => []),
    } as unknown as jest.Mocked<
      Pick<SkillSynthesisRpcService, 'listCandidates'>
    >;
    TestBed.configureTestingModule({
      providers: [{ provide: SkillSynthesisRpcService, useValue: rpc }],
    });
    const svc = TestBed.inject(SkillSynthesisStateService);
    return { svc, rpc };
  }

  it('defaults to the current workspace', async () => {
    // The narrow default is the fix: every project on the machine shares one
    // database, so an unscoped list showed a freshly opened project every
    // other project's pending captures.
    const { svc, rpc } = setup();
    expect(svc.scopeFilter()).toBe('workspace');

    await svc.refreshCandidates();

    // `status: 'all'` is the status filter's own default, untouched here.
    expect(rpc.listCandidates).toHaveBeenCalledWith({
      status: 'all',
      scope: 'workspace',
    });
  });

  it('setScopeFilter widens to all projects and reloads', async () => {
    const { svc, rpc } = setup();

    await svc.setScopeFilter('all');

    expect(svc.scopeFilter()).toBe('all');
    expect(rpc.listCandidates).toHaveBeenCalledWith({
      status: 'all',
      scope: 'all',
    });
  });

  it('the scope travels with a status change, not just with a scope change', async () => {
    const { svc, rpc } = setup();
    await svc.setScopeFilter('all');
    rpc.listCandidates.mockClear();

    await svc.setStatusFilter('promoted');

    expect(rpc.listCandidates).toHaveBeenCalledWith({
      status: 'promoted',
      scope: 'all',
    });
  });
});

describe('SkillSynthesisStateService — suggestions', () => {
  function setup(rpc = makeRpc()) {
    TestBed.configureTestingModule({
      providers: [{ provide: SkillSynthesisRpcService, useValue: rpc }],
    });
    const svc = TestBed.inject(SkillSynthesisStateService);
    return { svc, rpc };
  }

  it('refreshes suggestions and computes the pending count', async () => {
    const rpc = makeRpc();
    rpc.listSuggestions.mockResolvedValueOnce([
      suggestion(),
      suggestion({ id: 'sg-2', status: 'dismissed' }),
    ]);
    const { svc } = setup(rpc);

    await svc.refreshSuggestions();

    expect(svc.suggestions().length).toBe(2);
    expect(svc.pendingSuggestionCount()).toBe(1);
    expect(svc.suggestionsLoading()).toBe(false);
  });

  it('coalesces missing fields to safe defaults so a computed cannot throw', async () => {
    const rpc = makeRpc();
    rpc.listSuggestions.mockResolvedValueOnce([
      { id: 'sg-x' } as unknown as SkillSuggestionSummary,
    ]);
    const { svc } = setup(rpc);

    await svc.refreshSuggestions();

    const [first] = svc.suggestions();
    expect(first.name).toBe('(unnamed skill)');
    expect(first.memberSessionIds).toEqual([]);
    expect(first.clusterSize).toBe(0);
    expect(first.status).toBe('pending');
    expect(() => svc.pendingSuggestionCount()).not.toThrow();
  });

  it('records an error when the refresh fails', async () => {
    const rpc = makeRpc();
    rpc.listSuggestions.mockRejectedValueOnce(new Error('store-unavailable'));
    const { svc } = setup(rpc);

    await svc.refreshSuggestions();

    expect(svc.error()).toBe('store-unavailable');
    expect(svc.suggestionsLoading()).toBe(false);
  });

  it('accepts a suggestion, then refreshes the list and the stats', async () => {
    const rpc = makeRpc();
    const { svc } = setup(rpc);

    await expect(svc.accept('sg-1')).resolves.toBe(true);

    expect(rpc.acceptSuggestion).toHaveBeenCalledWith('sg-1');
    expect(rpc.listSuggestions).toHaveBeenCalledTimes(1);
    expect(rpc.stats).toHaveBeenCalledTimes(1);
    // The stats read must see the accepted skill, so it follows the accept
    // and the list refresh rather than racing them.
    const acceptOrder = rpc.acceptSuggestion.mock.invocationCallOrder[0];
    const listOrder = rpc.listSuggestions.mock.invocationCallOrder[0];
    const statsOrder = rpc.stats.mock.invocationCallOrder[0];
    expect(statsOrder).toBeGreaterThan(acceptOrder);
    expect(statsOrder).toBeGreaterThan(listOrder);
    expect(svc.stats()?.totalPromoted).toBe(2);
    expect(svc.error()).toBeNull();
  });

  it('does not refresh the stats when the accept fails', async () => {
    const rpc = makeRpc();
    rpc.acceptSuggestion.mockRejectedValueOnce(new Error('accept-failed'));
    const { svc } = setup(rpc);

    await expect(svc.accept('sg-1')).resolves.toBe(false);

    expect(rpc.stats).not.toHaveBeenCalled();
    expect(svc.error()).toBe('accept-failed');
    expect(svc.suggestionsLoading()).toBe(false);
  });

  it('returns false, reloads the list but not the stats, when the backend declines the accept', async () => {
    const rpc = makeRpc();
    rpc.acceptSuggestion.mockResolvedValueOnce({
      accepted: false,
      filePath: '',
    });
    // The suggestion is no longer pending; the reload shows its real state.
    rpc.listSuggestions.mockResolvedValueOnce([
      suggestion({ status: 'dismissed' }),
    ]);
    const { svc } = setup(rpc);

    await expect(svc.accept('sg-1')).resolves.toBe(false);

    expect(rpc.acceptSuggestion).toHaveBeenCalledWith('sg-1');
    expect(rpc.listSuggestions).toHaveBeenCalledTimes(1);
    expect(svc.suggestions()[0].status).toBe('dismissed');
    expect(rpc.stats).not.toHaveBeenCalled();
    // The refresh clears `error`, so this also pins that the decline message
    // is set after the reload.
    expect(svc.error()).toMatch(/not accepted/);
    expect(svc.suggestionsLoading()).toBe(false);
  });

  it('keeps the accept when the follow-up stats read fails, and surfaces the stats error', async () => {
    const rpc = makeRpc();
    rpc.listSuggestions.mockResolvedValueOnce([
      suggestion({ status: 'accepted' }),
    ]);
    rpc.stats.mockRejectedValueOnce(new Error('stats-unavailable'));
    const { svc } = setup(rpc);

    // loadStats() catches its own failure into `error` and does not rethrow,
    // so the accept still reports success and the list refresh stands.
    await expect(svc.accept('sg-1')).resolves.toBe(true);

    expect(rpc.acceptSuggestion).toHaveBeenCalledWith('sg-1');
    expect(rpc.listSuggestions).toHaveBeenCalledTimes(1);
    expect(svc.suggestions()[0].status).toBe('accepted');
    expect(svc.stats()).toBeNull();
    expect(svc.error()).toBe('stats-unavailable');
    expect(svc.suggestionsLoading()).toBe(false);
  });

  it('dismisses a suggestion with a reason and refreshes the list', async () => {
    const rpc = makeRpc();
    const { svc } = setup(rpc);

    await svc.dismiss('sg-1', 'not-reusable');

    expect(rpc.dismissSuggestion).toHaveBeenCalledWith('sg-1', 'not-reusable');
    expect(rpc.listSuggestions).toHaveBeenCalledTimes(1);
  });
});

function queueItem(
  overrides: Partial<SkillSynthesisQueueItem> = {},
): SkillSynthesisQueueItem {
  return {
    id: 'q-1',
    sessionId: 'sess-1',
    workspaceRoot: '/w',
    stage: 'archaeology',
    status: 'queued',
    attemptCount: 1,
    enqueuedAt: 1_700_000_000_000,
    notBefore: 0,
    finishedAt: null,
    lane: null,
    reason: null,
    candidateId: null,
    ...overrides,
  };
}

function drainRun(
  overrides: Partial<SkillSynthesisDrainRun> = {},
): SkillSynthesisDrainRun {
  return {
    id: 'run-1',
    jobId: '@ptah/skills-drain-nightly',
    tier: 'nightly',
    scheduledFor: 1_700_000_000_000,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_003_000,
    status: 'succeeded',
    durationMs: 3_000,
    summary: null,
    ...overrides,
  };
}

describe('SkillSynthesisStateService — drain queue', () => {
  function setupQueue(
    result: {
      items: SkillSynthesisQueueItem[];
      recentRuns: SkillSynthesisDrainRun[];
      stageSpend?: SkillSynthesisStageSpend[];
    } = { items: [], recentRuns: [] },
  ) {
    const rpc = {
      queue: jest.fn(async () => result),
    } as unknown as jest.Mocked<Pick<SkillSynthesisRpcService, 'queue'>>;
    TestBed.configureTestingModule({
      providers: [{ provide: SkillSynthesisRpcService, useValue: rpc }],
    });
    const svc = TestBed.inject(SkillSynthesisStateService);
    return { svc, rpc };
  }

  it('writes all three parts of the payload from one call', async () => {
    const { svc, rpc } = setupQueue({
      items: [queueItem(), queueItem({ id: 'q-2', stage: 'judge' })],
      recentRuns: [drainRun(), drainRun({ id: 'run-2', tier: 'frequent' })],
      stageSpend: [
        {
          stage: 'judge',
          inputTokens: 700,
          outputTokens: 300,
          totalTokens: 1_000,
          costUsd: 0.02,
        },
      ],
    });

    await svc.refreshQueue();

    expect(rpc.queue).toHaveBeenCalledWith({});
    expect(svc.queueItems().length).toBe(2);
    expect(svc.drainRuns().length).toBe(2);
    // The ledger rides the same response so the cost strip can never be read
    // against a queue snapshot from a different tick.
    expect(svc.stageSpend()).toEqual([
      {
        stage: 'judge',
        inputTokens: 700,
        outputTokens: 300,
        totalTokens: 1_000,
        costUsd: 0.02,
      },
    ]);
    expect(svc.queueLoading()).toBe(false);
    expect(svc.error()).toBeNull();
  });

  it('forwards the limits it was given', async () => {
    const { svc, rpc } = setupQueue();

    await svc.refreshQueue({ limit: 25, runLimit: 5 });

    expect(rpc.queue).toHaveBeenCalledWith({ limit: 25, runLimit: 5 });
  });

  it('sums attempts across every queued stage', async () => {
    const { svc } = setupQueue({
      items: [
        queueItem({ id: 'q-1', attemptCount: 3 }),
        queueItem({ id: 'q-2', stage: 'judge', attemptCount: 2 }),
        queueItem({ id: 'q-3', stage: 'digest', attemptCount: 0 }),
      ],
      recentRuns: [],
    });

    await svc.refreshQueue();

    expect(svc.queuedAttemptTotal()).toBe(5);
  });

  it('keeps the last good snapshot when the refresh fails', async () => {
    const { svc, rpc } = setupQueue({
      items: [queueItem()],
      recentRuns: [drainRun()],
    });
    await svc.refreshQueue();

    rpc.queue.mockRejectedValueOnce(new Error('queue-store-unavailable'));
    await svc.refreshQueue();

    expect(svc.error()).toBe('queue-store-unavailable');
    expect(svc.queueItems().length).toBe(1);
    expect(svc.drainRuns().length).toBe(1);
    expect(svc.queueLoading()).toBe(false);
  });

  it('tolerates a payload missing any of the three parts', async () => {
    const { svc } = setupQueue(
      {} as unknown as {
        items: SkillSynthesisQueueItem[];
        recentRuns: SkillSynthesisDrainRun[];
      },
    );

    await svc.refreshQueue();

    expect(svc.queueItems()).toEqual([]);
    expect(svc.drainRuns()).toEqual([]);
    expect(svc.stageSpend()).toEqual([]);
    expect(svc.queuedAttemptTotal()).toBe(0);
  });

  it('keeps the last good ledger when the refresh fails', async () => {
    const { svc, rpc } = setupQueue({
      items: [queueItem()],
      recentRuns: [],
      stageSpend: [
        {
          stage: 'archaeology',
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
          costUsd: 0,
        },
      ],
    });
    await svc.refreshQueue();

    rpc.queue.mockRejectedValueOnce(new Error('queue-store-unavailable'));
    await svc.refreshQueue();

    // Blanking the strip on a failed poll would read as "today cost nothing".
    expect(svc.stageSpend()).toHaveLength(1);
  });
});

/**
 * B4.8 — `refreshDigest` resolves the money flag and always sends it.
 *
 * The backend sweep may author its description rewrite on an LLM lane, and that
 * call sits under no budget: the `digest` queue stage has no registered handler
 * and no producer, so the drain's daily token gate never sees a digest item.
 * This method is the funnel every UI refresh goes through — the tab's
 * `ngOnInit` and `SkillSynthesisLiveService`'s debounced event sweep — so the
 * safe value has to be what a caller gets by saying nothing.
 */
describe('SkillSynthesisStateService — weekly digest', () => {
  function setupDigest() {
    const rpc = {
      digest: jest.fn(async () => ({ items: [] })),
    } as unknown as jest.Mocked<Pick<SkillSynthesisRpcService, 'digest'>>;
    TestBed.configureTestingModule({
      providers: [{ provide: SkillSynthesisRpcService, useValue: rpc }],
    });
    const svc = TestBed.inject(SkillSynthesisStateService);
    return { svc, rpc };
  }

  it('sends allowRewrite:false when the caller said nothing', async () => {
    // THE GUARD. Both automatic callers reach this method, and this is the
    // assertion that stops "refresh the panel" from meaning "buy an LLM call".
    const { svc, rpc } = setupDigest();

    await svc.refreshDigest();

    expect(rpc.digest).toHaveBeenCalledWith({
      limit: undefined,
      allowRewrite: false,
    });
  });

  it('sends allowRewrite:false for an explicit false', async () => {
    const { svc, rpc } = setupDigest();

    await svc.refreshDigest({ allowRewrite: false });

    expect(rpc.digest).toHaveBeenCalledWith(
      expect.objectContaining({ allowRewrite: false }),
    );
  });

  it('sends allowRewrite:true ONLY for an explicit true', async () => {
    // The contrast case: without it, the two tests above would still pass
    // against a method that had hard-coded `false` and made an explicit user
    // refresh impossible — a silent product regression rather than a cost one.
    const { svc, rpc } = setupDigest();

    await svc.refreshDigest({ allowRewrite: true });

    expect(rpc.digest).toHaveBeenCalledWith(
      expect.objectContaining({ allowRewrite: true }),
    );
  });

  it('carries limit through beside the flag', async () => {
    const { svc, rpc } = setupDigest();

    await svc.refreshDigest({ limit: 5 });

    expect(rpc.digest).toHaveBeenCalledWith({ limit: 5, allowRewrite: false });
  });

  it('keeps the last good digest when a refresh fails', async () => {
    const { svc, rpc } = setupDigest();
    rpc.digest.mockResolvedValueOnce({
      items: [
        {
          kind: 'win-rate',
          title: 'lint-fixer loses every run',
          rationale: 'Measured over 6 invocations.',
          score: 0.44,
          evidence: { sessionIds: ['s-1'], counts: {}, winRate: 0 },
        },
      ],
    });
    await svc.refreshDigest();
    expect(svc.digestItems()).toHaveLength(1);

    rpc.digest.mockRejectedValueOnce(new Error('sweep-failed'));
    await svc.refreshDigest();

    // Blanking would read as "swept, nothing to look at" — a false statement
    // about a sweep that never completed.
    expect(svc.digestItems()).toHaveLength(1);
    expect(svc.error()).toBe('sweep-failed');
    expect(svc.digestLoading()).toBe(false);
  });
});

describe('SkillSynthesisStateService — Skills pause switch', () => {
  function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
  } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  function setup(enabled = true) {
    const rpc = {
      getSettings: jest.fn(async () => ({ enabled })),
      updateSettings: jest.fn(async () => undefined),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: SkillSynthesisRpcService, useValue: rpc }],
    });
    const svc = TestBed.inject(SkillSynthesisStateService);
    return { svc, rpc };
  }

  it('reads skillSynthesis.enabled through getSettings; unknown until then', async () => {
    const { svc } = setup(false);
    expect(svc.skillsEnabled()).toBeNull();
    expect(svc.skillsPaused()).toBe(false);

    await svc.refreshSkillsEnabled();

    expect(svc.skillsEnabledCommitted()).toBe(false);
    expect(svc.skillsPaused()).toBe(true);
  });

  it('writes only { enabled } so the curator is not restarted', async () => {
    const { svc, rpc } = setup();
    await svc.refreshSkillsEnabled();

    await svc.setSkillsEnabled(false);

    expect(rpc.updateSettings).toHaveBeenCalledTimes(1);
    expect(rpc.updateSettings).toHaveBeenCalledWith({ enabled: false });
    expect(svc.skillsEnabledCommitted()).toBe(false);
    expect(svc.skillsPaused()).toBe(true);
  });

  it('moves the switch at once and keeps the committed value until the write lands', async () => {
    const { svc, rpc } = setup();
    await svc.refreshSkillsEnabled();
    const write = deferred<undefined>();
    rpc.updateSettings.mockReturnValue(write.promise);

    const pending = svc.setSkillsEnabled(false);
    expect(svc.skillsEnabled()).toBe(false);
    expect(svc.skillsSwitchSaving()).toBe(true);
    expect(svc.skillsEnabledCommitted()).toBe(true);

    write.resolve(undefined);
    await pending;
    expect(svc.skillsSwitchSaving()).toBe(false);
    expect(svc.skillsEnabledCommitted()).toBe(false);
  });

  it('rolls back and re-reads the host value when the write fails', async () => {
    const { svc, rpc } = setup();
    await svc.refreshSkillsEnabled();
    rpc.getSettings.mockClear();
    rpc.updateSettings.mockRejectedValue(new Error('disk full'));

    await svc.setSkillsEnabled(false);

    expect(svc.skillsEnabled()).toBe(true);
    expect(svc.skillsPaused()).toBe(false);
    expect(svc.skillsSwitchError()).toBe(
      'Could not change the Skills switch. It shows the saved setting.',
    );
    expect(rpc.getSettings).toHaveBeenCalledTimes(1);
  });

  it('drops a read that a write overtook (stale-GET guard)', async () => {
    const { svc, rpc } = setup();
    const staleRead = deferred<{ enabled: boolean }>();
    rpc.getSettings.mockReturnValueOnce(staleRead.promise);

    const read = svc.refreshSkillsEnabled(); // will answer "on"
    await svc.setSkillsEnabled(false);
    staleRead.resolve({ enabled: true });
    await read;

    expect(svc.skillsEnabledCommitted()).toBe(false);
  });

  it('does not read while a write is in flight', async () => {
    const { svc, rpc } = setup();
    const write = deferred<undefined>();
    rpc.updateSettings.mockReturnValue(write.promise);

    const pending = svc.setSkillsEnabled(false);
    await svc.refreshSkillsEnabled();
    expect(rpc.getSettings).not.toHaveBeenCalled();

    write.resolve(undefined);
    await pending;
  });

  it('markSkillsPaused() shows the paused state after a PAUSED refusal', async () => {
    const { svc } = setup();
    await svc.refreshSkillsEnabled();

    svc.markSkillsPaused();

    expect(svc.skillsPaused()).toBe(true);
    expect(svc.skillsEnabledCommitted()).toBe(false);
  });
});
