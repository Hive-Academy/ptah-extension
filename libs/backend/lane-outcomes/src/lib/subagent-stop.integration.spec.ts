import { mkdtempSync, rmSync } from 'node:fs';
import { realpath as fsRealpath, stat as fsStat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { container as rootContainer } from 'tsyringe';
import {
  SDK_TOKENS,
  SdkAdapterEvents,
  SubagentStopCallbackRegistry,
  type SdkAdapterSubagentEndedEvent,
  type SubagentStopPayload,
} from '@ptah-extension/agent-sdk';
import {
  FileType,
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { SUBAGENT_LANE_ID } from '@ptah-extension/shared';
import { LANE_OUTCOME_PIPELINE, registerLaneOutcomeServices } from './di/register';
import { startLaneOutcomes } from './di/start';
import { LANE_OUTCOME_TOKENS } from './di/tokens';
import { LaneOutcomeRecorder } from './lane-outcome-recorder.service';
import { InMemoryLaneOutcomeStore } from './store/in-memory-lane-outcome.store';
import { outcomeRow } from './store/store.test-support';
import { subagentRunId } from './subagent-join';
import { MemoryState, testLogger } from './write/pipeline.test-support';
import { hostDeliverablesReportId } from './write/report-effect';
import { OutcomeWritePipeline } from './write/outcome-write-pipeline';

function fixture(
  fileSystem?: Pick<IFileSystemProvider, 'stat' | 'realpath'>,
) {
  const logger = testLogger();
  const container = rootContainer.createChildContainer();
  const store = new InMemoryLaneOutcomeStore();
  container.registerInstance(PLATFORM_TOKENS.STATE_STORAGE, new MemoryState());
  if (fileSystem)
    container.registerInstance(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, fileSystem);
  registerLaneOutcomeServices(container, logger);
  container.registerInstance(LANE_OUTCOME_TOKENS.STORE, store);

  // The SDK registries only call the logger's public methods in this fixture.
  const sdkLogger = logger as ConstructorParameters<typeof SdkAdapterEvents>[0];
  const stops = new SubagentStopCallbackRegistry(sdkLogger);
  const events = new SdkAdapterEvents(sdkLogger);
  container.registerInstance(SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY, stops);
  container.registerInstance(SDK_TOKENS.SDK_ADAPTER_EVENTS, events);
  const dispose = startLaneOutcomes(container, logger, {
    observeSubagentEnded: true,
  });
  const pipeline = container.resolve<OutcomeWritePipeline>(LANE_OUTCOME_PIPELINE);
  const recorder = container.resolve<LaneOutcomeRecorder>(
    LANE_OUTCOME_TOKENS.RECORDER,
  );
  return { store, pipeline, recorder, stops, events, dispose };
}

function stop(agentId: string): SubagentStopPayload {
  return {
    agentId,
    agentType: null,
    subagentSessionId: null,
    parentSessionId: null,
    workspaceRoot: null,
    transcriptPath: null,
    timestamp: Date.now(),
  };
}

function ended(agentId: string): SdkAdapterSubagentEndedEvent {
  return {
    agentId,
    agentType: 'general-purpose',
    sessionId: 'parent-session',
    cwd: 'workspace',
    lastAssistantMessage: 'transient brief',
    backgroundTasks: [],
    timestamp: Date.now(),
  };
}

describe('subagent stop producers', () => {
  it.each(['hook first', 'event first'])(
    'writes one unclassified row with incomplete metadata (%s)',
    async (order) => {
      const run = fixture();
      try {
        const agentId = `agent-${order}`;
        expect(run.stops.size).toBe(1);
        if (order === 'hook first') {
          run.stops.notifyAll(stop(agentId));
          run.events.emitSubagentEnded(ended(agentId));
        } else {
          run.events.emitSubagentEnded(ended(agentId));
          run.stops.notifyAll(stop(agentId));
        }
        await run.pipeline.flush();
        await new Promise<void>((resolve) => setImmediate(resolve));
        await run.pipeline.flush();

        const rows = await run.store.listByLane(SUBAGENT_LANE_ID, 0);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          runId: subagentRunId(agentId),
          taskKind: null,
          taskKindSource: 'unclassified',
          telemetryJoin: 'unavailable',
          parentSessionId: 'parent-session',
          workspaceRoot: 'workspace',
        });
      } finally {
        await run.dispose();
        expect(run.stops.size).toBe(0);
      }
    },
  );

  it('joins a held deliverables report when the stop arrives', async () => {
    const run = fixture();
    try {
      const agentId = 'held-agent';
      const runId = subagentRunId(agentId);
      expect(
        await run.recorder.declareSubagentDeliverables(
          { runId },
          [{ exists: true, bytes: 8, mtimeMs: Date.now() }],
        ),
      ).toMatchObject({ ok: true, state: 'held' });
      run.stops.notifyAll(stop(agentId));
      await run.pipeline.flush();
      expect(await run.store.get(runId)).toMatchObject({
        deliverablesDeclaredAt: expect.any(Number),
      });
      expect(await run.store.listHeldReports(Date.now())).toHaveLength(0);
    } finally {
      await run.dispose();
    }
  });

  it('captures a review from the SDK stop message only when it names a target', async () => {
    const run = fixture();
    try {
      const target = 'lane:review-target';
      await run.store.insertIfAbsent({
        ...outcomeRow(target),
        executorKind: 'cli',
        laneId: 'lane-target',
        agentId: 'target-agent',
      });
      run.events.emitSubagentEnded({
        ...ended('review-agent'),
        agentType: 'code-logic-reviewer',
        lastAssistantMessage: `Reviewed-Run: ${target}\nVerdict: APPROVED`,
      });
      await run.pipeline.flush();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await run.pipeline.flush();
      expect(await run.store.get(target)).toMatchObject({
        finalReview: 'approved',
      });

      run.events.emitSubagentEnded({
        ...ended('review-without-target'),
        agentType: 'code-logic-reviewer',
        lastAssistantMessage: 'Verdict: REJECTED',
      });
      await run.pipeline.flush();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await run.store.get(target)).toMatchObject({
        finalReview: 'approved',
      });
    } finally {
      await run.dispose();
    }
  });
});

describe('host-observed deliverables at the subagent stop', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ptah-stop-wrote-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const nodeFs: Pick<IFileSystemProvider, 'stat' | 'realpath'> = {
    realpath: (target) => fsRealpath(target),
    stat: async (target) => {
      const stat = await fsStat(target);
      return {
        type: FileType.File,
        ctime: stat.ctimeMs,
        mtime: stat.mtimeMs,
        size: stat.size,
      };
    },
  };

  it('keeps an explicit report held before the stop over the host report', async () => {
    const run = fixture(nodeFs);
    try {
      const agentId = 'explicit-first';
      const runId = subagentRunId(agentId);
      expect(
        await run.recorder.declareSubagentDeliverables({ runId }, [
          { exists: true, bytes: 8, mtimeMs: Date.now() },
        ]),
      ).toMatchObject({ ok: true, state: 'held' });
      // The host sees a missing file, which alone would be no-deliverable.
      run.events.emitSubagentEnded({
        ...ended(agentId),
        cwd: dir,
        lastAssistantMessage: 'WROTE: missing.md',
      });
      run.stops.notifyAll(stop(agentId));
      for (let i = 0; i < 500; i += 1) {
        await run.pipeline.flush();
        if (await run.store.hasReceipt(hostDeliverablesReportId(runId))) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
      }
      expect(await run.store.hasReceipt(hostDeliverablesReportId(runId))).toBe(
        true,
      );
      expect((await run.store.get(runId))?.verdict).toBe('delivered');
    } finally {
      await run.dispose();
    }
  });
});
