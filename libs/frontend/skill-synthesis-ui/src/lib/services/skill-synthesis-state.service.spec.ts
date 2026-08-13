import { TestBed } from '@angular/core/testing';
import type {
  SkillSuggestionSummary,
  SkillSynthesisDrainRun,
  SkillSynthesisQueueItem,
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

  it('writes both halves of the payload from one call', async () => {
    const { svc, rpc } = setupQueue({
      items: [queueItem(), queueItem({ id: 'q-2', stage: 'judge' })],
      recentRuns: [drainRun(), drainRun({ id: 'run-2', tier: 'frequent' })],
    });

    await svc.refreshQueue();

    expect(rpc.queue).toHaveBeenCalledWith({});
    expect(svc.queueItems().length).toBe(2);
    expect(svc.drainRuns().length).toBe(2);
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

  it('tolerates a payload missing either half', async () => {
    const { svc } = setupQueue(
      {} as unknown as {
        items: SkillSynthesisQueueItem[];
        recentRuns: SkillSynthesisDrainRun[];
      },
    );

    await svc.refreshQueue();

    expect(svc.queueItems()).toEqual([]);
    expect(svc.drainRuns()).toEqual([]);
    expect(svc.queuedAttemptTotal()).toBe(0);
  });
});
