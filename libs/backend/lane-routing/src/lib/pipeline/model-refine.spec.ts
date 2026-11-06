import type { DecisionPayload } from '../decision-model/decision-payload';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { runFixedRequest, runLaneRequest, type LaneQuestion } from './model-refine';

const logger: LaneRoutingLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const lanes = ['codex', 'grok', 'opencode', 'fourth'].map((laneId) => ({
  laneId,
  family: laneId,
  model: 'test-model',
  limitState: 'unknown' as const,
  score: 80,
}));

const phases: LaneQuestion[] = [
  { phaseId: 'build', taskKind: 'implement', instructions: 'Choose', options: lanes },
];

function capture() {
  const payloads: DecisionPayload[] = [];
  const caller = {
    decide: async (payload: DecisionPayload) => {
      payloads.push(payload);
      return {
        ok: false as const,
        cause: 'provider-error' as const,
        notFound: false,
        detail: 'unavailable',
      };
    },
  };
  return { payloads, dispatch: { kind: 'system-one' as const, caller, model: 'nimble' } };
}

const outcomes = (laneId: string, taskKind: LaneQuestion['taskKind']) => ({
  laneId, taskKind, delivered: 2, failed: 1,
});

describe('runLaneRequest outcome figures', () => {
  it('sends only offered pairs and deduplicates repeated phase/kind pairs', async () => {
    const captured = capture();
    const result = await runLaneRequest({
      provider: 'ollama', request: 'ship',
      phases: [phases[0], { ...phases[0], phaseId: 'ship' }],
      outcomes, maxRequestBytes: 100_000,
      dispatch: captured.dispatch, logger,
    });
    expect(result.outcomeFigures).toBe(4);
    expect(Object.keys(captured.payloads[0].state.pastOutcomes)).toEqual(
      lanes.map((lane) => `${lane.laneId}/implement`),
    );
    expect(captured.payloads[0].state.pastOutcomes['codex/implement']).toEqual({
      delivered: 2, failed: 1,
    });
  });

  it('skips subagent options and other task kinds', async () => {
    const captured = capture();
    const lookedUp: string[] = [];
    await runLaneRequest({
      provider: 'ollama', request: 'ship',
      phases: [{ ...phases[0], options: [lanes[0], { ...lanes[1], laneId: 'subagent' }] }],
      outcomes: (laneId, taskKind) => {
        lookedUp.push(`${laneId}/${taskKind}`);
        return outcomes(laneId, taskKind);
      },
      maxRequestBytes: 100_000, dispatch: captured.dispatch, logger,
    });
    expect(lookedUp).toEqual(['codex/implement']);
    expect(Object.keys(captured.payloads[0].state.pastOutcomes)).toEqual(['codex/implement']);
  });

  it('looks up each phase using its own task kind', async () => {
    const captured = capture();
    const lookedUp: string[] = [];
    await runLaneRequest({
      provider: 'ollama', request: 'ship',
      phases: [
        { ...phases[0], options: lanes.slice(0, 2) },
        { ...phases[0], phaseId: 'check', taskKind: 'review', options: lanes.slice(1, 3) },
      ],
      outcomes: (laneId, taskKind) => {
        lookedUp.push(`${laneId}/${taskKind}`);
        return outcomes(laneId, taskKind);
      },
      maxRequestBytes: 100_000, dispatch: captured.dispatch, logger,
    });
    expect(lookedUp).toEqual([
      'codex/implement', 'grok/implement', 'grok/review', 'opencode/review',
    ]);
    expect(Object.keys(captured.payloads[0].state.pastOutcomes)).toEqual(lookedUp);
  });

  it('recomputes figures as option width shrinks under the byte cap', async () => {
    const wide = capture();
    await runLaneRequest({
      provider: 'ollama', request: 'ship', phases, outcomes,
      maxRequestBytes: 100_000, dispatch: wide.dispatch, logger,
    });
    const bytes = new TextEncoder().encode(JSON.stringify({
      model: 'nimble', ...wide.payloads[0],
    })).byteLength;
    const narrow = capture();
    const result = await runLaneRequest({
      provider: 'ollama', request: 'ship', phases, outcomes,
      maxRequestBytes: bytes - 1, dispatch: narrow.dispatch, logger,
    });
    expect(result.outcomeFigures).toBe(3);
    expect(Object.keys(narrow.payloads[0].state.pastOutcomes)).toEqual(
      lanes.slice(0, 3).map((lane) => `${lane.laneId}/implement`),
    );
  });

  it('includes the same figures in a structured prompt', async () => {
    const prompts: string[] = [];
    const result = await runLaneRequest({
      provider: 'structuredOutput', request: 'ship', phases,
      outcomes, maxRequestBytes: 100_000, logger,
      dispatch: {
        kind: 'structured', providerId: 'test', model: 'nimble',
        signal: new AbortController().signal,
        completer: {
          isReady: async () => true,
          complete: async (request) => {
            prompts.push(request.prompt);
            return { build: 'o1' };
          },
        },
      },
    });
    expect(result.outcomeFigures).toBe(4);
    expect(prompts[0]).toContain('past outcomes codex/implement: delivered 2, failed 1');
  });

  it('sends no figures for fixed pre-flight questions', async () => {
    const captured = capture();
    const result = await runFixedRequest({
      request: 'classify',
      questions: [{ key: 'task_type', instructions: 'Classify', criteria: { FEATURE: 'Feature' } }],
      maxRequestBytes: 100_000, dispatch: captured.dispatch, logger,
    });
    expect(result.outcomeFigures).toBe(0);
    expect(captured.payloads[0].state.pastOutcomes).toEqual({});
  });
});
