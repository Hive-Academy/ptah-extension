import type { LaneOutcomeRecord } from '@ptah-extension/shared';
import { LaneOutcomeReader } from './lane-outcome-reader.service';
import type { LaneOutcomeLogger } from './lane-outcome-logger';
import { InMemoryLaneOutcomeStore } from './store/in-memory-lane-outcome.store';
import type { SkillTelemetrySeam } from './skill-telemetry-seam.port';

const logger: LaneOutcomeLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const row: LaneOutcomeRecord = {
  runId: 'subagent:agent-a',
  executorKind: 'subagent',
  laneId: 'subagent',
  agentId: 'agent-a',
  family: 'claude',
  provider: null,
  model: 'lane-default',
  role: 'review',
  taskKind: null,
  taskKindSource: null,
  taskId: null,
  verdict: 'failed',
  failureClass: null,
  startedAt: null,
  endedAt: Date.now(),
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  routingSource: 'not-routed',
  reviseRounds: 0,
  finalReview: null,
  deliverablesDeclaredAt: null,
  telemetryJoin: 'unavailable',
  skillsLoaded: null,
  sessionEvidenceClass: null,
};

describe('LaneOutcomeReader', () => {
  it('joins skills and evidence by stored session id, omitting null sessions', async () => {
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent({ ...row, subagentSessionId: 'session-a' });
    await store.insertIfAbsent({
      ...row,
      runId: 'subagent:agent-b',
      agentId: 'agent-b',
      subagentSessionId: null,
    });
    const skillsLoaded = jest
      .fn<
        ReturnType<SkillTelemetrySeam['skillsLoaded']>,
        Parameters<SkillTelemetrySeam['skillsLoaded']>
      >()
      .mockResolvedValue(new Map([[row.runId, ['skill-a']]]));
    const sessionEvidence = jest
      .fn<
        ReturnType<SkillTelemetrySeam['sessionEvidence']>,
        Parameters<SkillTelemetrySeam['sessionEvidence']>
      >()
      .mockResolvedValue(new Map([['session-a', 'observed']]));
    const seam: SkillTelemetrySeam = {
      subagentRuns: async () => new Map(),
      skillsLoaded,
      sessionEvidence,
    };
    const reader = new LaneOutcomeReader(store, logger, seam);
    expect(await reader.get(row.runId)).toMatchObject({
      skillsLoaded: ['skill-a'],
      sessionEvidenceClass: 'observed',
    });
    expect(await reader.get('subagent:agent-b')).toMatchObject({
      skillsLoaded: null,
      sessionEvidenceClass: null,
    });
    expect(skillsLoaded).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'session-a',
          fromMs: 0,
          toMs: row.endedAt,
        }),
      ]),
    );
    expect(sessionEvidence).toHaveBeenCalledWith(['session-a']);
    expect(skillsLoaded).toHaveBeenLastCalledWith([]);
    expect(sessionEvidence).toHaveBeenLastCalledWith([]);
  });

  it('derives timeout from the stored budget flag at read time', async () => {
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent(row);
    await store.markBudgetStopped(row.runId, Date.now());
    const reader = new LaneOutcomeReader(store, logger);
    expect(await reader.get(row.runId)).toMatchObject({
      failureClass: 'timeout',
      telemetryJoin: 'unavailable',
    });
    expect((await store.get(row.runId))?.failureClass).toBeNull();
  });
});
