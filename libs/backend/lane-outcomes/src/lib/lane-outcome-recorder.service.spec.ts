import type { LaneFailureClassifier } from '@ptah-extension/shared';
import { InMemoryLaneOutcomeStore } from './store/in-memory-lane-outcome.store';
import { outcomeRow } from './store/store.test-support';
import { OutcomeWritePipeline } from './write/outcome-write-pipeline';
import {
  LaneOutcomeRecorder,
  type LaneCompletionOutcomeInput,
} from './lane-outcome-recorder.service';
import type { LaneOutcomeLogger } from './lane-outcome-logger';

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

function harness(classifier?: LaneFailureClassifier) {
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
  );
  return { store, pipeline, recorder, warn };
}

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
