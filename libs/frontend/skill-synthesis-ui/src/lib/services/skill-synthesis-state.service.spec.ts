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
    'listSuggestions' | 'acceptSuggestion' | 'dismissSuggestion'
  >
> {
  return {
    listSuggestions: jest.fn(async () => [suggestion()]),
    acceptSuggestion: jest.fn(async () => ({
      accepted: true,
      filePath: '/skills/sg-1/SKILL.md',
    })),
    dismissSuggestion: jest.fn(async () => true),
  } as unknown as jest.Mocked<
    Pick<
      SkillSynthesisRpcService,
      'listSuggestions' | 'acceptSuggestion' | 'dismissSuggestion'
    >
  >;
}

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

  it('accepts a suggestion and refreshes the list', async () => {
    const rpc = makeRpc();
    const { svc } = setup(rpc);

    await svc.accept('sg-1');

    expect(rpc.acceptSuggestion).toHaveBeenCalledWith('sg-1');
    expect(rpc.listSuggestions).toHaveBeenCalledTimes(1);
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
