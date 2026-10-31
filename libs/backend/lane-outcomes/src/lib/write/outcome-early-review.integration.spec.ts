/**
 * Early-review integration (Req 7, plan Component 7): a host-captured review
 * that lands before its reviewed lane row is held durably, joined on the
 * lane insert, deduplicated on replay, and expired into the rejected ledger
 * when its target never arrives. Real recorder, pipeline and stores.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryLaneOutcomeStore } from '../store/in-memory-lane-outcome.store';
import type { LaneOutcomeStore } from '../store/lane-outcome.store';
import { outcomeRow } from '../store/store.test-support';
import {
  LaneOutcomeRecorder,
  type LaneCompletionOutcomeInput,
} from '../lane-outcome-recorder.service';
import { OUTCOME_REJECTED_KEY } from './key-value-outcome-journal';
import { OutcomeWritePipeline } from './outcome-write-pipeline';
import { deterministicReviewReportId } from './report-effect';
import {
  MemoryState,
  sqliteFixture,
  testLogger,
} from './pipeline.test-support';

const REVIEWER = 'lane:reviewer';

interface StoreHandle {
  readonly store: LaneOutcomeStore;
  close(): void;
}

interface Kind {
  open(): StoreHandle;
  dispose(): void;
}

function memoryKind(): Kind {
  return {
    open: () => ({
      store: new InMemoryLaneOutcomeStore(),
      close: () => undefined,
    }),
    dispose: () => undefined,
  };
}

function sqliteKind(): Kind {
  let dir: string | undefined;
  return {
    open: () => {
      dir ??= mkdtempSync(join(tmpdir(), 'ptah-early-review-'));
      const fixture = sqliteFixture(join(dir, 'outcomes.sqlite'));
      return { store: fixture.store, close: () => fixture.db.close() };
    },
    dispose: () => {
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    },
  };
}

function laneInput(runId: string): LaneCompletionOutcomeInput {
  return {
    ...outcomeRow(runId),
    executorKind: 'cli',
    laneId: 'lane-a',
    agentId: 'agent-a',
    family: 'claude',
    verdict: 'delivered',
    status: 'completed',
    failureKind: null,
    exitCode: 0,
  };
}

function wire(store: LaneOutcomeStore, storage: MemoryState) {
  const pipeline: OutcomeWritePipeline = new OutcomeWritePipeline(
    store,
    testLogger(),
    storage,
    { isOpen: () => true },
    (row) => recorder.onLaneRecordInserted(row),
  );
  const recorder = new LaneOutcomeRecorder(pipeline, store, testLogger());
  return { pipeline, recorder };
}

function reviewText(target: string, word: string): string {
  return `Reviewed-Run: ${target}\nVerdict: ${word}`;
}

describe.each([
  { label: 'in-memory', make: memoryKind },
  { label: 'sqlite', make: sqliteKind },
])('early lane review ($label store)', ({ make }) => {
  let kind: Kind;
  const handles: StoreHandle[] = [];
  const pipelines: OutcomeWritePipeline[] = [];

  function open(): StoreHandle {
    const handle = kind.open();
    handles.push(handle);
    return handle;
  }

  beforeEach(() => {
    kind = make();
  });

  afterEach(async () => {
    await Promise.all(pipelines.splice(0).map((p) => p.dispose()));
    for (const handle of handles.splice(0)) handle.close();
    kind.dispose();
  });

  it.each([
    ['APPROVED', { finalReview: 'approved', reviseRounds: 0 }],
    ['REJECTED', { finalReview: 'rejected', reviseRounds: 0 }],
    ['REVISE', { finalReview: null, reviseRounds: 1 }],
  ] as const)(
    'holds a %s review before its lane row and joins it on insert',
    async (word, expected) => {
      const target = `lane:target-${word.toLowerCase()}`;
      const { store } = open();
      const storage = new MemoryState();
      const { pipeline, recorder } = wire(store, storage);
      pipelines.push(pipeline);
      const text = reviewText(target, word);

      expect(
        await recorder.captureReview({ reviewerRunId: REVIEWER, text }),
      ).toEqual({ ok: true, state: 'held', runId: target });
      expect(await store.get(target)).toBeNull();
      expect(await store.listHeldReports(Date.now())).toEqual([
        expect.objectContaining({
          reportId: deterministicReviewReportId(target, REVIEWER),
          kind: 'review',
        }),
      ]);

      recorder.recordLaneCompletion(laneInput(target));
      await pipeline.flush();
      expect(await store.get(target)).toMatchObject(expected);
      expect(
        await store.hasReceipt(deterministicReviewReportId(target, REVIEWER)),
      ).toBe(true);
      expect(await store.listHeldReports(Date.now())).toHaveLength(0);

      // Replaying the same capture after the insert is a receipt duplicate.
      expect(
        await recorder.captureReview({ reviewerRunId: REVIEWER, text }),
      ).toMatchObject({ ok: true, state: 'applied' });
      expect(await store.get(target)).toMatchObject(expected);
      expect(storage.get(OUTCOME_REJECTED_KEY)).toBeUndefined();
    },
  );

  it('expires a held review whose lane never arrives into the rejected ledger', async () => {
    const wall = Date.now();
    jest.useFakeTimers();
    try {
      const { store } = open();
      const storage = new MemoryState();
      const { pipeline, recorder } = wire(store, storage);
      pipelines.push(pipeline);
      expect(
        await recorder.captureReview({
          reviewerRunId: REVIEWER,
          text: reviewText('lane:never', 'APPROVED'),
        }),
      ).toMatchObject({ ok: true, state: 'held' });

      jest.setSystemTime(wall + 86_500_000);
      await pipeline.flush();
      await pipeline.flush();
      expect(
        storage.get<{ entries: readonly unknown[] }>(OUTCOME_REJECTED_KEY)
          ?.entries,
      ).toEqual([
        {
          kind: 'review',
          runId: 'lane:never',
          reportId: deterministicReviewReportId('lane:never', REVIEWER),
          reason: 'held-report-expired',
        },
      ]);
      expect(await store.listHeldReports(Date.now())).toHaveLength(0);
      expect(await store.get('lane:never')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('joins a bare-agent-id review held before the lane row, and only once', async () => {
    const { store } = open();
    const storage = new MemoryState();
    const { pipeline, recorder } = wire(store, storage);
    pipelines.push(pipeline);
    const first = 'implementer:2026-10-31T10:00:00.000Z';
    const second = 'implementer:2026-10-31T11:00:00.000Z';

    expect(
      await recorder.captureReview({
        reviewerRunId: REVIEWER,
        text: reviewText('implementer', 'REVISE'),
      }),
    ).toEqual({ ok: true, state: 'held', runId: 'implementer' });

    recorder.recordLaneCompletion({
      ...laneInput(first),
      agentId: 'implementer',
    });
    await pipeline.flush();
    expect(await store.get(first)).toMatchObject({
      reviseRounds: 1,
      finalReview: null,
    });
    expect(
      await store.hasReceipt(
        deterministicReviewReportId('implementer', REVIEWER),
      ),
    ).toBe(true);
    expect(await store.listHeldReports(Date.now())).toHaveLength(0);

    recorder.recordLaneCompletion({
      ...laneInput(second),
      agentId: 'implementer',
    });
    await pipeline.flush();
    expect(await store.get(second)).toMatchObject({
      reviseRounds: 0,
      finalReview: null,
    });
    expect(await store.get(first)).toMatchObject({ reviseRounds: 1 });
  });

  it('joins a bare-agent-id review held before the subagent row', async () => {
    const { store } = open();
    const storage = new MemoryState();
    const { pipeline, recorder } = wire(store, storage);
    pipelines.push(pipeline);

    expect(
      await recorder.captureReview({
        reviewerRunId: REVIEWER,
        text: reviewText('helper', 'APPROVED'),
      }),
    ).toEqual({ ok: true, state: 'held', runId: 'helper' });

    pipeline.enqueue({
      kind: 'subagent-stop',
      row: { ...outcomeRow('subagent:helper'), agentId: 'helper' },
    });
    await pipeline.flush();
    expect(await store.get('subagent:helper')).toMatchObject({
      finalReview: 'approved',
    });
    expect(await store.listHeldReports(Date.now())).toHaveLength(0);
  });

  it('applies a bare-agent-id review to a lane row that landed before it was written', async () => {
    const { store } = open();
    const storage = new MemoryState();
    const { pipeline, recorder } = wire(store, storage);
    pipelines.push(pipeline);
    const runId = 'implementer:2026-10-31T10:00:00.000Z';
    recorder.recordLaneCompletion({
      ...laneInput(runId),
      agentId: 'implementer',
    });
    await pipeline.flush();

    // The caller resolved the agent before its row landed, so the report
    // still names the bare agent id.
    const now = Date.now();
    expect(
      await pipeline.submit({
        kind: 'review',
        report: {
          reportId: deterministicReviewReportId('implementer', REVIEWER),
          runId: 'implementer',
          kind: 'review',
          payload: JSON.stringify({ verdict: 'approved' }),
          heldAt: now,
          expiresAt: now + 86_400_000,
        },
      }),
    ).toMatchObject({ ok: true });
    expect(await store.get(runId)).toMatchObject({ finalReview: 'approved' });
    expect(await store.listHeldReports(Date.now())).toHaveLength(0);
  });
});

describe('early lane review across a SQLite reopen', () => {
  it('joins a held review after the store is reopened before the lane insert', async () => {
    const kind = sqliteKind();
    const target = 'lane:reopened';
    const storage = new MemoryState();
    const first = kind.open();
    try {
      const before = wire(first.store, storage);
      expect(
        await before.recorder.captureReview({
          reviewerRunId: REVIEWER,
          text: reviewText(target, 'APPROVED'),
        }),
      ).toMatchObject({ ok: true, state: 'held' });
      await before.pipeline.dispose();
    } finally {
      first.close();
    }

    const second = kind.open();
    try {
      const after = wire(second.store, storage);
      after.recorder.recordLaneCompletion(laneInput(target));
      await after.pipeline.flush();
      expect(await second.store.get(target)).toMatchObject({
        finalReview: 'approved',
      });
      expect(await second.store.listHeldReports(Date.now())).toHaveLength(0);
      await after.pipeline.dispose();
    } finally {
      second.close();
      kind.dispose();
    }
  });
});
