import type {
  LaneFailureClassifier,
  LaneTaskKindClassificationInput,
  LaneTaskKindClassifier,
  OutcomeTaskKind,
} from '@ptah-extension/shared';
import type {
  SdkAdapterSubagentEndedEvent,
  SubagentStopPayload,
} from '@ptah-extension/agent-sdk';
import { InMemoryLaneOutcomeStore } from './store/in-memory-lane-outcome.store';
import { outcomeRow } from './store/store.test-support';
import { OutcomeWritePipeline } from './write/outcome-write-pipeline';
import {
  LaneOutcomeRecorder,
  reportedSubagentStopRow,
  type LaneCompletionOutcomeInput,
} from './lane-outcome-recorder.service';
import type { LaneOutcomeLogger } from './lane-outcome-logger';
import { taskKindForRole } from './task-kind-mapping';

const logger: LaneOutcomeLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const pipelines: OutcomeWritePipeline[] = [];

function laneInput(
  runId: string,
  overrides: Partial<LaneCompletionOutcomeInput> = {},
): LaneCompletionOutcomeInput {
  return {
    ...outcomeRow(runId),
    executorKind: 'cli',
    laneId: 'lane-a',
    agentId: 'agent-a',
    family: 'claude',
    verdict: 'failed',
    status: 'failed',
    failureKind: 'quota',
    exitCode: 1,
    ...overrides,
  };
}

function harness(
  classifier?: LaneFailureClassifier,
  taskKindClassifier?: LaneTaskKindClassifier,
) {
  const store = new InMemoryLaneOutcomeStore();
  const warn = jest.fn();
  const testLogger = { ...logger, warn };
  const pipeline = new OutcomeWritePipeline(
    store,
    testLogger,
    undefined,
    undefined,
    (row) => recorder.onLaneRecordInserted(row),
  );
  pipelines.push(pipeline);
  const recorder = new LaneOutcomeRecorder(
    pipeline,
    store,
    testLogger,
    classifier,
    taskKindClassifier,
  );
  return { store, pipeline, recorder, warn };
}

/** Lets fire-and-forget classification and enrichment chains settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

function kindClassifier(result: OutcomeTaskKind | null = 'implement') {
  const classify = jest.fn(
    async (
      _input: LaneTaskKindClassificationInput,
    ): Promise<OutcomeTaskKind | null> => result,
  );
  return { classify };
}

function stopPayload(
  overrides: Partial<SubagentStopPayload> = {},
): SubagentStopPayload {
  return {
    subagentSessionId: 'session-a',
    parentSessionId: 'parent',
    workspaceRoot: '/workspace',
    agentId: 'agent-a',
    agentType: 'backend-developer',
    transcriptPath: '/transcript',
    timestamp: 100,
    ...overrides,
  };
}

function endedEvent(
  overrides: Partial<SdkAdapterSubagentEndedEvent> = {},
): SdkAdapterSubagentEndedEvent {
  return {
    sessionId: 'parent-ended',
    cwd: '/workspace-ended',
    agentId: 'agent-a',
    agentType: 'backend-developer',
    lastAssistantMessage: null,
    backgroundTasks: [],
    timestamp: 200,
    ...overrides,
  };
}

// Type-level: callers can never supply the provenance the recorder owns.
const inputOmitsTaskKindSource: 'taskKindSource' extends keyof LaneCompletionOutcomeInput
  ? false
  : true = true;

describe('LaneOutcomeRecorder', () => {
  afterEach(async () => {
    await Promise.all(
      pipelines.splice(0).map((pipeline) => pipeline.dispose()),
    );
  });

  it('retains a budget stop that precedes the subagent stop row', async () => {
    const { store, recorder, pipeline } = harness();
    recorder.markSubagentBudgetStop('agent-a');
    recorder.recordSubagentStop({
      subagentSessionId: 'session-a',
      parentSessionId: 'parent',
      workspaceRoot: '/workspace',
      agentId: 'agent-a',
      agentType: 'review',
      transcriptPath: '/transcript',
      timestamp: 100,
    });
    await pipeline.flush();
    expect(await store.get('subagent:agent-a')).toMatchObject({
      budgetStopped: true,
      role: 'review',
    });
  });

  it('classifies one new failed row, updates once, and never stores classification inputs', async () => {
    const classify = jest.fn().mockResolvedValue('crash');
    const { store, recorder, pipeline } = harness({ classify });
    const update = jest.spyOn(store, 'update');
    recorder.recordLaneCompletion(laneInput('lane:once'));
    await pipeline.flush();
    await Promise.resolve();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith({
      runId: 'lane:once',
      executorKind: 'cli',
      family: 'claude',
      status: 'failed',
      verdict: 'failed',
      failureKind: 'quota',
      exitCode: 1,
      durationMs: null,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('lane:once', {
      failureClass: 'crash',
    });
    const stored = await store.get('lane:once');
    expect(stored?.failureClass).toBe('crash');
    expect(stored).not.toHaveProperty('status');
    expect(stored).not.toHaveProperty('failureKind');
    expect(stored).not.toHaveProperty('exitCode');

    recorder.recordLaneCompletion(laneInput('lane:once'));
    await pipeline.flush();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['preset class', { failureClass: 'timeout' }],
    ['delivered', { verdict: 'delivered' }],
    ['unverified', { verdict: 'unverified' }],
    ['stopped', { status: 'stopped' }],
  ] as const)('skips classification for %s', async (name, overrides) => {
    const classify = jest.fn().mockResolvedValue('crash');
    const { recorder, pipeline } = harness({ classify });
    recorder.recordLaneCompletion(laneInput(`lane:${name}`, overrides));
    await pipeline.flush();
    expect(classify).not.toHaveBeenCalled();
  });

  it('does not classify when no classifier is registered', async () => {
    const { recorder, pipeline, store } = harness();
    recorder.recordLaneCompletion(laneInput('lane:no-classifier'));
    await pipeline.flush();
    expect((await store.get('lane:no-classifier'))?.failureClass).toBeNull();
  });

  it('does not update for a null classification', async () => {
    const classify = jest.fn().mockResolvedValue(null);
    const { recorder, pipeline, store } = harness({ classify });
    const update = jest.spyOn(store, 'update');
    recorder.recordLaneCompletion(laneInput('lane:null'));
    await pipeline.flush();
    await Promise.resolve();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('warns with identifiers only when classification rejects', async () => {
    const classify = jest.fn().mockRejectedValue(new Error('secret detail'));
    const { recorder, pipeline, store, warn } = harness({ classify });
    const update = jest.spyOn(store, 'update');
    recorder.recordLaneCompletion(laneInput('lane:reject'));
    await pipeline.flush();
    await Promise.resolve();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Outcome classification failed', {
      runId: 'lane:reject',
      code: 'Error',
    });
  });
});

describe('LaneOutcomeRecorder task-kind resolution', () => {
  afterEach(async () => {
    await Promise.all(
      pipelines.splice(0).map((pipeline) => pipeline.dispose()),
    );
  });

  const unclassifiedLane = {
    taskKind: null,
    role: 'freeform-helper',
    verdict: 'delivered',
    status: 'completed',
  } as const;

  it('keeps taskKindSource out of the caller input type', () => {
    expect(inputOmitsTaskKindSource).toBe(true);
  });

  it('records an explicit kind with zero classification calls', async () => {
    const tasks = kindClassifier();
    const { store, recorder, pipeline } = harness(undefined, tasks);
    recorder.recordLaneCompletion(
      laneInput('lane:explicit', { taskKind: 'review', role: 'senior-tester' }),
      { brief: 'Review the change' },
    );
    await pipeline.flush();
    await settle();
    expect(await store.get('lane:explicit')).toMatchObject({
      taskKind: 'review',
      taskKindSource: 'explicit',
    });
    expect(tasks.classify).not.toHaveBeenCalled();
  });

  it('records a mapped role kind with zero classification calls', async () => {
    const tasks = kindClassifier();
    const { store, recorder, pipeline } = harness(undefined, tasks);
    recorder.recordLaneCompletion(
      laneInput('lane:mapped', { taskKind: null, role: 'Senior-Tester' }),
      { brief: 'Write the tests' },
    );
    await pipeline.flush();
    await settle();
    expect(await store.get('lane:mapped')).toMatchObject({
      taskKind: 'tests',
      taskKindSource: 'mapped',
    });
    expect(tasks.classify).not.toHaveBeenCalled();
  });

  it('inserts unclassified first, then classifies once with a bounded brief', async () => {
    let release: (kind: OutcomeTaskKind | null) => void = () => undefined;
    const classify = jest.fn(
      (input: LaneTaskKindClassificationInput) =>
        new Promise<OutcomeTaskKind | null>((resolve) => {
          expect(input.brief.length).toBeLessThanOrEqual(4000);
          release = resolve;
        }),
    );
    const { store, recorder, pipeline } = harness(undefined, { classify });
    recorder.recordLaneCompletion(
      laneInput('lane:classified', unclassifiedLane),
      { brief: 'b'.repeat(5000) },
    );
    expect(classify).not.toHaveBeenCalled();
    await pipeline.flush();
    expect(await store.get('lane:classified')).toMatchObject({
      taskKind: null,
      taskKindSource: 'unclassified',
    });
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify).toHaveBeenCalledWith({
      runId: 'lane:classified',
      executorKind: 'cli',
      role: 'freeform-helper',
      brief: 'b'.repeat(4000),
    });
    release('docs');
    await settle();
    expect(await store.get('lane:classified')).toMatchObject({
      taskKind: 'docs',
      taskKindSource: 'classified',
    });
    expect(JSON.stringify(await store.get('lane:classified'))).not.toContain(
      'bbbb',
    );

    recorder.recordLaneCompletion(
      laneInput('lane:classified', unclassifiedLane),
      { brief: 'again' },
    );
    await pipeline.flush();
    await settle();
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it('makes zero calls without a classifier (decision model unset)', async () => {
    const { store, recorder, pipeline } = harness();
    recorder.recordLaneCompletion(laneInput('lane:no-model', unclassifiedLane), {
      brief: 'Do the thing',
    });
    await pipeline.flush();
    await settle();
    expect(await store.get('lane:no-model')).toMatchObject({
      taskKind: null,
      taskKindSource: 'unclassified',
    });
  });

  it.each([
    ['no brief', undefined],
    ['a blank brief', '   \n '],
  ])('makes zero calls with %s', async (_name, brief) => {
    const tasks = kindClassifier();
    const { recorder, pipeline } = harness(undefined, tasks);
    recorder.recordLaneCompletion(
      laneInput('lane:no-brief', unclassifiedLane),
      brief === undefined ? undefined : { brief },
    );
    await pipeline.flush();
    await settle();
    expect(tasks.classify).not.toHaveBeenCalled();
  });

  it('leaves the row unclassified for a null kind', async () => {
    const tasks = kindClassifier(null);
    const { store, recorder, pipeline } = harness(undefined, tasks);
    const setKind = jest.spyOn(store, 'setClassifiedTaskKind');
    recorder.recordLaneCompletion(laneInput('lane:null-kind', unclassifiedLane), {
      brief: 'Something',
    });
    await pipeline.flush();
    await settle();
    expect(tasks.classify).toHaveBeenCalledTimes(1);
    expect(setKind).not.toHaveBeenCalled();
    expect((await store.get('lane:null-kind'))?.taskKindSource).toBe(
      'unclassified',
    );
  });

  it('warns with identifiers only when task-kind classification rejects', async () => {
    const classify = jest.fn().mockRejectedValue(new TypeError('secret brief'));
    const { store, recorder, pipeline, warn } = harness(undefined, { classify });
    recorder.recordLaneCompletion(laneInput('lane:kind-reject', unclassifiedLane), {
      brief: 'secret brief',
    });
    await pipeline.flush();
    await settle();
    expect(warn).toHaveBeenCalledWith('Task kind classification failed', {
      runId: 'lane:kind-reject',
      code: 'TypeError',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    expect((await store.get('lane:kind-reject'))?.taskKindSource).toBe(
      'unclassified',
    );
  });

  it('keeps at most 200 briefs and drops the oldest', async () => {
    const tasks = kindClassifier();
    const { recorder, pipeline } = harness(undefined, tasks);
    for (let i = 0; i < 201; i += 1)
      recorder.recordLaneCompletion(laneInput(`lane:b${i}`, unclassifiedLane), {
        brief: `brief ${i}`,
      });
    // The pipeline drains in batches of 25; drain until every row is in.
    for (let round = 0; round < 12; round += 1) {
      await pipeline.flush();
      await settle();
    }
    expect(tasks.classify).toHaveBeenCalledTimes(200);
    const runIds = tasks.classify.mock.calls.map(([input]) => input.runId);
    expect(runIds).not.toContain('lane:b0');
    expect(runIds).toContain('lane:b200');
  });
});

describe('taskKindForRole', () => {
  it.each([
    ['plan', 'plan'],
    ['architecture', 'plan'],
    ['implement', 'implement'],
    ['review', 'review'],
    ['document-review', 'review'],
    ['visual-review', 'review'],
    ['plan-review', 'review'],
    ['research', 'research'],
    ['tests', 'tests'],
    ['docs', 'docs'],
    ['design', 'docs'],
    ['project-manager', 'plan'],
    ['software-architect', 'plan'],
    ['team-leader', 'plan'],
    ['backend-developer', 'implement'],
    ['Frontend-Developer', 'implement'],
    ['DEVOPS-ENGINEER', 'implement'],
    ['code-logic-reviewer', 'review'],
    ['code-style-reviewer', 'review'],
    ['visual-reviewer', 'review'],
    ['researcher-expert', 'research'],
    ['senior-tester', 'tests'],
    ['technical-content-writer', 'docs'],
    ['ui-ux-designer', 'docs'],
  ])('maps %s to %s', (role, kind) => {
    expect(taskKindForRole(role)).toBe(kind);
  });

  it.each([
    'general-purpose',
    'Explore',
    'unknown',
    'backend',
    'backend-developer-2',
    '',
  ])('returns null for "%s"', (role) => {
    expect(taskKindForRole(role)).toBeNull();
  });

  it('returns null for a null role', () => {
    expect(taskKindForRole(null)).toBeNull();
  });
});

describe('LaneOutcomeRecorder subagent producers', () => {
  afterEach(async () => {
    await Promise.all(
      pipelines.splice(0).map((pipeline) => pipeline.dispose()),
    );
  });

  it('builds the ended-event row with its own join shape', async () => {
    const { store, recorder, pipeline } = harness();
    recorder.recordSubagentEnded(endedEvent({ agentType: 'senior-tester' }));
    await pipeline.flush();
    expect(await store.get('subagent:agent-a')).toMatchObject({
      runId: 'subagent:agent-a',
      executorKind: 'subagent',
      agentId: 'agent-a',
      parentSessionId: 'parent-ended',
      workspaceRoot: '/workspace-ended',
      subagentSessionId: null,
      role: 'senior-tester',
      taskKind: 'tests',
      taskKindSource: 'mapped',
      verdict: 'unverified',
      telemetryJoin: 'unavailable',
      endedAt: 200,
    });
  });

  it('keeps a stop row whose metadata is incomplete', async () => {
    const { store, recorder, pipeline } = harness();
    recorder.recordSubagentStop(
      stopPayload({
        subagentSessionId: null,
        parentSessionId: null,
        workspaceRoot: null,
        transcriptPath: null,
        agentType: null,
      }),
    );
    await pipeline.flush();
    expect(await store.get('subagent:agent-a')).toMatchObject({
      subagentSessionId: null,
      parentSessionId: null,
      workspaceRoot: null,
      role: null,
      taskKind: null,
      taskKindSource: 'unclassified',
      telemetryJoin: 'unavailable',
    });
  });

  it('writes one row when the stop payload arrives first', async () => {
    const { store, recorder, pipeline } = harness();
    const insert = jest.spyOn(store, 'insertStopWithHeldReports');
    recorder.recordSubagentStop(stopPayload());
    recorder.recordSubagentEnded(endedEvent());
    await pipeline.flush();
    await settle();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(await store.get('subagent:agent-a')).toMatchObject({
      subagentSessionId: 'session-a',
      parentSessionId: 'parent',
      workspaceRoot: '/workspace',
      endedAt: 100,
    });
  });

  it('writes one row and fills missing joins when the ended event arrives first', async () => {
    const { store, recorder, pipeline } = harness();
    const insert = jest.spyOn(store, 'insertStopWithHeldReports');
    recorder.recordSubagentEnded(endedEvent());
    await pipeline.flush();
    recorder.recordSubagentStop(stopPayload());
    await pipeline.flush();
    await settle();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(await store.get('subagent:agent-a')).toMatchObject({
      subagentSessionId: 'session-a',
      parentSessionId: 'parent-ended',
      workspaceRoot: '/workspace-ended',
      endedAt: 200,
    });
  });

  it('classifies an unmapped subagent once from the later producer brief', async () => {
    const tasks = kindClassifier('research');
    const { store, recorder, pipeline } = harness(undefined, tasks);
    recorder.recordSubagentStop(stopPayload({ agentType: 'general-purpose' }));
    recorder.recordSubagentEnded(
      endedEvent({
        agentType: 'general-purpose',
        lastAssistantMessage: 'm'.repeat(4500),
      }),
    );
    await pipeline.flush();
    await settle();
    expect(tasks.classify).toHaveBeenCalledTimes(1);
    expect(tasks.classify).toHaveBeenCalledWith({
      runId: 'subagent:agent-a',
      executorKind: 'subagent',
      role: 'general-purpose',
      brief: 'm'.repeat(4000),
    });
    expect(await store.get('subagent:agent-a')).toMatchObject({
      taskKind: 'research',
      taskKindSource: 'classified',
    });
  });

  it('classifies a first-producer brief from the insert callback', async () => {
    const tasks = kindClassifier('plan');
    const { store, recorder, pipeline } = harness(undefined, tasks);
    recorder.recordSubagentEnded(
      endedEvent({ agentType: 'Explore', lastAssistantMessage: 'notes' }),
    );
    await pipeline.flush();
    await settle();
    expect(tasks.classify).toHaveBeenCalledTimes(1);
    expect((await store.get('subagent:agent-a'))?.taskKind).toBe('plan');
  });

  it('does not classify a mapped subagent even with a message', async () => {
    const tasks = kindClassifier();
    const { recorder, pipeline } = harness(undefined, tasks);
    recorder.recordSubagentEnded(
      endedEvent({ lastAssistantMessage: 'implemented it' }),
    );
    await pipeline.flush();
    await settle();
    expect(tasks.classify).not.toHaveBeenCalled();
  });

  it('builds an unclassified external-caller row', () => {
    expect(reportedSubagentStopRow('agent-x', 42)).toMatchObject({
      runId: 'subagent:agent-x',
      agentId: 'agent-x',
      executorKind: 'subagent',
      taskKind: null,
      taskKindSource: 'unclassified',
      verdict: 'unverified',
      telemetryJoin: 'unavailable',
      endedAt: 42,
    });
  });
});

describe('LaneOutcomeRecorder review capture', () => {
  afterEach(async () => {
    await Promise.all(
      pipelines.splice(0).map((pipeline) => pipeline.dispose()),
    );
  });

  async function withTarget() {
    const h = harness();
    h.recorder.recordLaneCompletion(
      laneInput('lane:target', {
        taskKind: 'implement',
        verdict: 'delivered',
        status: 'completed',
      }),
    );
    await h.pipeline.flush();
    return h;
  }

  it('applies a review subagent verdict from its last message once', async () => {
    const { store, recorder, pipeline } = await withTarget();
    const event = endedEvent({
      agentId: 'reviewer-1',
      agentType: 'code-logic-reviewer',
      lastAssistantMessage:
        '## Summary\n- Reviewed-Run: lane:target\nVerdict: REVISE',
    });
    recorder.recordSubagentEnded(event);
    await pipeline.flush();
    await settle();
    expect((await store.get('lane:target'))?.reviseRounds).toBe(1);

    recorder.recordSubagentEnded(event);
    await pipeline.flush();
    await settle();
    expect((await store.get('lane:target'))?.reviseRounds).toBe(1);
    expect(
      await store.hasReceipt('review:lane:target|subagent:reviewer-1'),
    ).toBe(true);
  });

  it('sets the final review for an approved lane review', async () => {
    const { store, recorder } = await withTarget();
    const result = await recorder.captureReview({
      reviewerRunId: 'lane:reviewer',
      text: 'Reviewed-Run: lane:target\n**Verdict:** APPROVED',
    });
    expect(result.ok).toBe(true);
    expect((await store.get('lane:target'))?.finalReview).toBe('approved');
  });

  it.each([
    ['no-target', 'Verdict: APPROVED'],
    ['no-verdict', 'Reviewed-Run: lane:target\nLooks great to me'],
    [
      'ambiguous',
      'Reviewed-Run: lane:target\nVerdict: APPROVED\nVerdict: REJECTED',
    ],
    ['self-review', 'Reviewed-Run: lane:reviewer\nVerdict: APPROVED'],
  ])(
    'refuses %s, changes no row and logs identifiers only',
    async (refusal, text) => {
      const { store, recorder, warn } = await withTarget();
      const before = await store.get('lane:target');
      const result = await recorder.captureReview({
        reviewerRunId: 'lane:reviewer',
        text,
      });
      expect(result.ok).toBe(false);
      expect(warn).toHaveBeenCalledWith('Review capture refused', {
        reviewerRunId: 'lane:reviewer',
        refusal,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('Verdict');
      expect(await store.get('lane:target')).toEqual(before);
    },
  );

  it('does not capture from a subagent that is not a review kind', async () => {
    const { store, recorder, pipeline } = await withTarget();
    const before = await store.get('lane:target');
    recorder.recordSubagentEnded(
      endedEvent({
        agentId: 'worker',
        agentType: 'backend-developer',
        lastAssistantMessage: 'Reviewed-Run: lane:target\nVerdict: REJECTED',
      }),
    );
    await pipeline.flush();
    await settle();
    expect(await store.get('lane:target')).toEqual(before);
  });
});
