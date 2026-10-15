import {
  buildDecisionPayload,
  formatDecisionOptionLabel,
  REQUEST_TEXT_MAX_CHARS,
  type DecisionPayloadInput,
} from './decision-payload';
import { SystemOneRequestBodySchema } from './system-one.schema';

const codex = {
  laneId: 'codex',
  family: 'openai',
  model: 'gpt-5',
  limitState: 'unknown',
  score: 80,
} as const;

const glm = {
  laneId: 'glm',
  family: 'zhipu',
  model: 'glm-5.3',
  limitState: 'unknown',
  score: 75,
} as const;

const input: DecisionPayloadInput = {
  request: 'Fix the flaky auth e2e test and add a regression test',
  questions: [
    {
      kind: 'lane-choice',
      phaseId: 'implement',
      instructions:
        'Which executor should implement? Choose only from these options.',
      options: [codex, glm],
    },
  ],
  outcomeFigures: [
    { laneId: 'codex', taskKind: 'implement', delivered: 12, failed: 1 },
  ],
};

describe('decision payload', () => {
  it('emits the pinned key set and nothing else (NFR Security)', () => {
    const payload = buildDecisionPayload(input);

    expect(Object.keys(payload).sort()).toEqual(['questions', 'state']);
    expect(Object.keys(payload.state).sort()).toEqual([
      'availableExecutors',
      'pastOutcomes',
      'request',
    ]);
    expect(
      Object.keys(payload.state.availableExecutors['codex']).sort(),
    ).toEqual(['family', 'limitState', 'model', 'score']);
    expect(
      Object.keys(payload.state.pastOutcomes['codex/implement']).sort(),
    ).toEqual(['delivered', 'failed']);
    expect(Object.keys(payload.questions['implement']).sort()).toEqual([
      'criteria',
      'instructions',
      'type',
    ]);
  });

  it('labels lane options o1..oN in the given order and pins the label text', () => {
    const payload = buildDecisionPayload(input);

    expect(Object.keys(payload.questions['implement'].criteria)).toEqual([
      'o1',
      'o2',
    ]);
    expect(payload.questions['implement'].type).toBe('choice');
    expect(payload.questions['implement'].instructions).toBe(
      'Which executor should implement? Choose only from these options.',
    );
    expect(payload.questions['implement'].criteria['o1']).toBe(
      'lane codex, family openai, model gpt-5, limit state unknown, score 80',
    );
    expect(payload.questions['implement'].criteria['o2']).toBe(
      formatDecisionOptionLabel(glm),
    );
  });

  it('adds a roster entry on first appearance and keeps the criteria authoritative', () => {
    const payload = buildDecisionPayload({
      ...input,
      questions: [
        {
          kind: 'lane-choice',
          phaseId: 'implement',
          instructions: 'Implement?',
          options: [codex],
        },
        {
          kind: 'lane-choice',
          phaseId: 'docs',
          instructions: 'Document?',
          options: [{ ...codex, score: 65 }],
        },
      ],
    });

    expect(payload.state.availableExecutors['codex'].score).toBe(80);
    expect(payload.questions['docs'].criteria['o1']).toBe(
      'lane codex, family openai, model gpt-5, limit state unknown, score 65',
    );
  });

  it('keys outcome figures by lane id and task kind', () => {
    const payload = buildDecisionPayload(input);

    expect(payload.state.pastOutcomes['codex/implement']).toEqual({
      delivered: 12,
      failed: 1,
    });
    expect(Object.keys(payload.state.pastOutcomes)).toEqual([
      'codex/implement',
    ]);
  });

  it('passes fixed criteria through unchanged (pre-flight task type and depth)', () => {
    const payload = buildDecisionPayload({
      request: 'Plan it',
      questions: [
        {
          kind: 'fixed-criteria',
          phaseId: 'task_type',
          instructions: 'Which Ptah task type fits this request?',
          criteria: {
            BUGFIX: 'A test or feature is broken',
            FEATURE: 'A new capability',
          },
        },
      ],
      outcomeFigures: [],
    });

    expect(payload.state.availableExecutors).toEqual({});
    expect(payload.state.pastOutcomes).toEqual({});
    expect(payload.questions['task_type'].criteria).toEqual({
      BUGFIX: 'A test or feature is broken',
      FEATURE: 'A new capability',
    });
  });

  it('caps request text at the boundary', () => {
    expect(REQUEST_TEXT_MAX_CHARS).toBe(8000);
    const payload = buildDecisionPayload({
      ...input,
      request: 'a'.repeat(9000),
    });

    expect(payload.state.request).toBe('a'.repeat(8000));
  });

  it('round-trips through the request wire schema and rejects unknown fields', () => {
    const payload = buildDecisionPayload(input);

    expect(
      SystemOneRequestBodySchema.safeParse({ model: 'nimble', ...payload })
        .success,
    ).toBe(true);
    expect(
      SystemOneRequestBodySchema.safeParse({
        model: 'nimble',
        state: { ...payload.state, userPreferences: ['lanes first'] },
        questions: payload.questions,
      }).success,
    ).toBe(false);
  });

  it('lets nothing outside the pinned set leave the machine', () => {
    const leaky = { ...input, userPreferences: ['leak-me'], apiKey: 'leak-me' };
    const payload = buildDecisionPayload(leaky);

    expect(JSON.stringify(payload)).not.toContain('leak-me');
  });
});
