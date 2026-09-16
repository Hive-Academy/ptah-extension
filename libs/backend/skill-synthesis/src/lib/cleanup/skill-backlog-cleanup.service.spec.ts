import 'reflect-metadata';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionVerdictStore } from '../archaeology/session-verdict.store';
import type { ForegroundActivityTracker } from '../queue/foreground-activity.tracker';
import type { SkillQueueStore } from '../queue/skill-queue.store';
import type { TrajectoryExtractor } from '../trajectory-extractor';
import { SkillBacklogCleanupService } from './skill-backlog-cleanup.service';
import type { SkillBacklogCleanupStore } from './skill-backlog-cleanup.store';
import type {
  BacklogCleanupCandidate,
  BacklogCleanupState,
} from './skill-backlog-cleanup.types';

const baseState = (overrides: Partial<BacklogCleanupState> = {}): BacklogCleanupState => ({
  version: 1,
  cutoffCreatedAt: 1_000,
  cursorCreatedAt: null,
  cursorId: null,
  startedAt: 1_000,
  finishedAt: null,
  lastRunAt: 1_000,
  lastOutcome: 'started',
  lastReason: null,
  examined: 0,
  keptEvidence: 0,
  keptVerdict: 0,
  keptDegradedVerdict: 0,
  rejectedNoEvidence: 0,
  rejectedTranscriptUnreadable: 0,
  invocationsDeleted: 0,
  ...overrides,
});

const row = (
  overrides: Partial<BacklogCleanupCandidate> = {},
): BacklogCleanupCandidate => ({
  id: 'candidate-1',
  createdAt: 10,
  sourceSessionIds: ['session-1'],
  workspaceRoot: '/workspace',
  ...overrides,
});

function logger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeHarness(settings: Record<string, unknown> = {}) {
  let state = baseState();
  const pageCandidates = jest.fn() as jest.MockedFunction<
    SkillBacklogCleanupStore['pageCandidates']
  >;
  pageCandidates.mockReturnValue([]);
  const store = {
    readState: jest.fn(() => state),
    initialize: jest.fn((_version: number, now: number) => {
      state = baseState({ cutoffCreatedAt: now, startedAt: now });
      return state;
    }),
    pageCandidates,
    rejectBatch: jest.fn(() => 0),
    deleteFakeInvocations: jest.fn(() => 0),
    writeProgress: jest.fn((input) => {
      state = {
        ...state,
        cursorCreatedAt: input.cursorCreatedAt,
        cursorId: input.cursorId,
        finishedAt: input.finishedAt,
        lastRunAt: input.lastRunAt,
        lastOutcome: input.lastOutcome,
        lastReason: input.lastReason,
        ...input.counters,
      };
      return state;
    }),
  };
  const findBySession = jest.fn() as jest.MockedFunction<
    SessionVerdictStore['findBySession']
  >;
  findBySession.mockReturnValue(null);
  const findBySessionStage = jest.fn() as jest.MockedFunction<
    SkillQueueStore['findBySessionStage']
  >;
  findBySessionStage.mockReturnValue(null);
  const extract = jest.fn() as jest.MockedFunction<
    TrajectoryExtractor['extract']
  >;
  extract.mockResolvedValue(null);
  const verdicts = { findBySession };
  const queue = { findBySessionStage };
  const extractor = { extract };
  const foreground = {
    start: jest.fn(),
    msSinceLastActivity: jest.fn(() => Number.POSITIVE_INFINITY),
  };
  const workspace = {
    getConfiguration: jest.fn(
      <T>(_section: string, key: string, fallback?: T): T | undefined =>
        key in settings ? (settings[key] as T) : fallback,
    ),
  };
  const log = logger();
  const service = new SkillBacklogCleanupService(
    log,
    store as unknown as SkillBacklogCleanupStore,
    verdicts as unknown as SessionVerdictStore,
    queue as unknown as SkillQueueStore,
    extractor as unknown as TrajectoryExtractor,
    foreground as unknown as ForegroundActivityTracker,
    workspace as unknown as IWorkspaceProvider,
  );
  return { service, store, verdicts, queue, extractor, foreground, log };
}

const live = (): AbortSignal => new AbortController().signal;

const conversationTrajectory = (sessionId: string) => ({
  hash: sessionId,
  canonicalText: 'text',
  turnCount: 2,
  sessionTurnCount: 2,
  shortDescription: 'desc',
  slug: 'desc',
  editCount: 0,
  toolUseCount: 0,
  bashTestPassed: false,
  charLength: 4,
  hasSuccessMarker: false,
});

describe('SkillBacklogCleanupService', () => {
  it('returns the six gate tokens in order without doing row work', async () => {
    const disabled = makeHarness({ 'skillSynthesis.enabled': false });
    await expect(
      disabled.service.run({ signal: live(), isOnBattery: () => false }),
    ).resolves.toEqual({ status: 'skipped', reason: 'disabled' });

    const complete = makeHarness();
    complete.store.readState.mockReturnValue(baseState({ finishedAt: 2_000 }));
    await expect(
      complete.service.run({ signal: live(), isOnBattery: () => false }),
    ).resolves.toEqual({ status: 'skipped', reason: 'complete' });

    const boot = makeHarness({
      'skillSynthesis.drain.bootDeferralMs': 60_000,
    });
    await expect(
      boot.service.run({ signal: live(), isOnBattery: () => false }),
    ).resolves.toEqual({ status: 'skipped', reason: 'boot-deferred' });

    const battery = makeHarness({
      'skillSynthesis.drain.bootDeferralMs': 0,
    });
    await expect(
      battery.service.run({ signal: live(), isOnBattery: () => true }),
    ).resolves.toEqual({ status: 'skipped', reason: 'on-battery' });

    const foreground = makeHarness({
      'skillSynthesis.drain.bootDeferralMs': 0,
      'skillSynthesis.drain.foregroundBackoffMs': 1_000,
    });
    foreground.foreground.msSinceLastActivity.mockReturnValue(10);
    await expect(
      foreground.service.run({ signal: live(), isOnBattery: () => false }),
    ).resolves.toEqual({ status: 'skipped', reason: 'foreground-active' });

    const aborted = makeHarness({
      'skillSynthesis.drain.bootDeferralMs': 0,
      'skillSynthesis.drain.foregroundBackoffMs': 0,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      aborted.service.run({
        signal: controller.signal,
        isOnBattery: () => false,
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'aborted' });
  });

  it.each([
    ['keeps a non-degraded verdict', { degradedReason: null }, 'keptVerdict'],
    [
      'keeps a degraded verdict',
      { degradedReason: 'no-query-path' },
      'keptDegradedVerdict',
    ],
  ])('%s', async (_label, verdict, counter) => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    h.store.pageCandidates
      .mockReturnValueOnce([row()])
      .mockReturnValueOnce([]);
    h.verdicts.findBySession.mockReturnValue(verdict as never);
    const report = await h.service.run({
      signal: live(),
      isOnBattery: () => false,
    });
    expect(report).toMatchObject({ status: 'completed', [counter]: 1 });
    expect(h.store.rejectBatch).toHaveBeenCalledWith([], expect.any(Number));
  });

  it('keeps work evidence and rejects readable conversation-only evidence', async () => {
    const h = makeHarness({
      'skillSynthesis.drain.bootDeferralMs': 0,
      'skillSynthesis.prefilterMinEdits': 1,
      'skillSynthesis.prefilterMinToolUses': 2,
    });
    h.store.pageCandidates
      .mockReturnValueOnce([
        row({ id: 'edit', sourceSessionIds: ['edit-session'] }),
        row({ id: 'chat', sourceSessionIds: ['chat-session'] }),
      ])
      .mockReturnValueOnce([]);
    h.extractor.extract.mockImplementation(async (sessionId: string) => ({
      hash: sessionId,
      canonicalText: 'text',
      turnCount: 2,
      sessionTurnCount: 2,
      shortDescription: 'desc',
      slug: 'desc',
      editCount: sessionId === 'edit-session' ? 1 : 0,
      toolUseCount: 0,
      bashTestPassed: false,
      charLength: 4,
      hasSuccessMarker: false,
    }));
    const report = await h.service.run({ signal: live(), isOnBattery: () => false });
    expect(report).toMatchObject({
      status: 'completed',
      examined: 2,
      keptEvidence: 1,
      rejectedNoEvidence: 1,
    });
    expect(h.store.rejectBatch).toHaveBeenCalledWith(
      [
        {
          id: 'chat',
          reason: 'backlog-cleanup: no code evidence and no verdict',
        },
      ],
      expect.any(Number),
    );
  });

  it('rejects an unreadable transcript with its distinct reason', async () => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    h.store.pageCandidates
      .mockReturnValueOnce([row()])
      .mockReturnValueOnce([]);
    const report = await h.service.run({ signal: live(), isOnBattery: () => false });
    expect(report).toMatchObject({ rejectedTranscriptUnreadable: 1 });
    expect(h.store.rejectBatch).toHaveBeenCalledWith(
      [{ id: 'candidate-1', reason: 'backlog-cleanup: transcript unreadable and no verdict' }],
      expect.any(Number),
    );
  });

  it('defers a candidate whose verdict lookup throws and continues the page', async () => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    h.store.pageCandidates
      .mockReturnValueOnce([
        row({ id: 'deferred', sourceSessionIds: ['deferred-session'] }),
        row({ id: 'processed', sourceSessionIds: ['processed-session'] }),
      ])
      .mockReturnValueOnce([]);
    h.verdicts.findBySession.mockImplementation((sessionId: string) => {
      if (sessionId === 'deferred-session') throw new Error('SQLITE_BUSY');
      return null;
    });
    h.extractor.extract.mockImplementation(async (sessionId: string) =>
      conversationTrajectory(sessionId),
    );

    const report = await h.service.run({
      signal: live(),
      isOnBattery: () => false,
    });

    expect(report).toMatchObject({
      status: 'completed',
      examined: 2,
      deferredOnError: 1,
      rejectedNoEvidence: 1,
      rejectedTranscriptUnreadable: 0,
    });
    expect(h.store.rejectBatch).toHaveBeenCalledWith(
      [
        {
          id: 'processed',
          reason: 'backlog-cleanup: no code evidence and no verdict',
        },
      ],
      expect.any(Number),
    );
    expect(h.log.warn).toHaveBeenCalledWith(
      '[skill-synthesis] backlog candidate evaluation failed',
      { candidateId: 'deferred', error: 'SQLITE_BUSY' },
    );
  });

  it('warns once with only the candidate id when no source session is usable', async () => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    h.store.pageCandidates
      .mockReturnValueOnce([row({ id: 'corrupt', sourceSessionIds: [] })])
      .mockReturnValueOnce([]);

    await h.service.run({ signal: live(), isOnBattery: () => false });

    expect(h.log.warn).toHaveBeenCalledTimes(1);
    expect(h.log.warn).toHaveBeenCalledWith(
      '[skill-synthesis] backlog candidate has no usable source sessions',
      { candidateId: 'corrupt' },
    );
  });

  it('uses the prefilter queue row when the candidate workspace is empty', async () => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    h.store.pageCandidates
      .mockReturnValueOnce([row({ workspaceRoot: '' })])
      .mockReturnValueOnce([]);
    h.queue.findBySessionStage.mockReturnValue({
      id: 'prefilter-row',
      sessionId: 'session-1',
      workspaceRoot: '/from-queue',
      transcriptPath: '/from-queue/session.jsonl',
      source: 'session-end',
      stage: 'prefilter',
      dependsOn: null,
      status: 'done',
      turnCount: 2,
      attemptCount: 1,
      enqueuedAt: 1,
      notBefore: 0,
      claimedBy: null,
      claimedAt: null,
      finishedAt: 2,
      lane: null,
      reason: null,
      lastError: null,
      candidateId: null,
      payload: {},
    });
    await h.service.run({ signal: live(), isOnBattery: () => false });
    expect(h.extractor.extract).toHaveBeenCalledWith(
      'session-1',
      '/from-queue',
      2,
      '/from-queue/session.jsonl',
    );
  });

  it('commits earlier rejections and returns partial when aborted between candidates', async () => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    const controller = new AbortController();
    h.store.pageCandidates.mockReturnValue([
      row({ id: 'first', sourceSessionIds: ['first-session'] }),
      row({ id: 'second', sourceSessionIds: ['second-session'] }),
    ]);
    h.extractor.extract.mockImplementation(async (sessionId: string) => {
      if (sessionId === 'first-session') controller.abort();
      return conversationTrajectory(sessionId);
    });

    const report = await h.service.run({
      signal: controller.signal,
      isOnBattery: () => false,
    });

    expect(report).toMatchObject({
      status: 'partial',
      reason: 'aborted',
      examined: 1,
      rejectedNoEvidence: 1,
    });
    expect(h.store.rejectBatch).toHaveBeenCalledWith(
      [
        {
          id: 'first',
          reason: 'backlog-cleanup: no code evidence and no verdict',
        },
      ],
      expect.any(Number),
    );
    expect(h.store.writeProgress).toHaveBeenCalledWith(
      expect.objectContaining({ cursorId: 'first' }),
    );
  });

  it('returns partial at the wall budget and the next run resumes to completion', async () => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    const first = row({ id: 'first', sourceSessionIds: ['first-session'] });
    const second = row({ id: 'second', sourceSessionIds: ['second-session'] });
    h.store.pageCandidates.mockImplementation(
      (_cutoff: number, _cursorCreatedAt: number | null, cursorId: string | null) => {
        if (cursorId === null) return [first, second];
        if (cursorId === 'first') return [second];
        return [];
      },
    );
    let clock = 0;
    let firstEvaluation = true;
    h.extractor.extract.mockImplementation(async (sessionId: string) => {
      if (firstEvaluation) {
        firstEvaluation = false;
        clock = 60_001;
      }
      return conversationTrajectory(sessionId);
    });

    const partial = await h.service.run({
      signal: live(),
      isOnBattery: () => false,
      now: () => clock,
    });
    expect(partial).toMatchObject({
      status: 'partial',
      reason: 'time-budget',
      examined: 1,
    });

    clock = 100_000;
    const completed = await h.service.run({
      signal: live(),
      isOnBattery: () => false,
      now: () => clock,
    });
    expect(completed).toMatchObject({ status: 'completed', examined: 2 });
    expect(h.store.pageCandidates).toHaveBeenCalledWith(
      1_000,
      first.createdAt,
      'first',
      100,
    );
  });

  it('returns row-budget after exactly 200 candidates', async () => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    const candidates = Array.from({ length: 250 }, (_, index) =>
      row({
        id: `candidate-${index}`,
        createdAt: index + 1,
        sourceSessionIds: [`session-${index}`],
      }),
    );
    h.store.pageCandidates.mockImplementation(
      (
        _cutoff: number,
        _cursorCreatedAt: number | null,
        cursorId: string | null,
        limit: number,
      ) => {
        const start =
          cursorId === null
            ? 0
            : candidates.findIndex((candidate) => candidate.id === cursorId) + 1;
        return candidates.slice(start, start + limit);
      },
    );
    h.verdicts.findBySession.mockReturnValue({
      degradedReason: null,
    } as never);

    const report = await h.service.run({
      signal: live(),
      isOnBattery: () => false,
    });

    expect(report).toMatchObject({
      status: 'partial',
      reason: 'row-budget',
      examined: 200,
      keptVerdict: 200,
    });
    expect(h.store.pageCandidates).toHaveBeenCalledTimes(2);
    expect(h.store.writeProgress).toHaveBeenCalledWith(
      expect.objectContaining({ cursorId: 'candidate-199' }),
    );
  });

  it('stops between fake-invocation delete pages without marking complete', async () => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    const controller = new AbortController();
    h.store.deleteFakeInvocations.mockImplementation(() => {
      controller.abort();
      return 500;
    });

    const report = await h.service.run({
      signal: controller.signal,
      isOnBattery: () => false,
    });

    expect(report).toMatchObject({
      status: 'partial',
      reason: 'aborted',
      invocationsDeleted: 500,
    });
    expect(h.store.deleteFakeInvocations).toHaveBeenCalledTimes(1);
    expect(h.store.writeProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ finishedAt: expect.any(Number) }),
    );
  });

  it('converts a thrown cleanup-store failure into a failed report', async () => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    h.store.pageCandidates.mockImplementation(() => {
      throw new Error('database busy');
    });
    await expect(
      h.service.run({ signal: live(), isOnBattery: () => false }),
    ).resolves.toMatchObject({
      status: 'failed',
      reason: 'unexpected-error',
      error: 'database busy',
    });
    expect(h.store.rejectBatch).not.toHaveBeenCalled();
  });

  it('reports counters committed before a later whole-run failure', async () => {
    const h = makeHarness({ 'skillSynthesis.drain.bootDeferralMs': 0 });
    h.store.pageCandidates
      .mockReturnValueOnce([row()])
      .mockImplementationOnce(() => {
        throw new Error('database busy');
      });
    h.verdicts.findBySession.mockReturnValue({
      degradedReason: null,
    } as never);

    const report = await h.service.run({
      signal: live(),
      isOnBattery: () => false,
    });

    expect(report).toMatchObject({
      status: 'failed',
      examined: 1,
      keptVerdict: 1,
      error: 'database busy',
    });
  });
});
