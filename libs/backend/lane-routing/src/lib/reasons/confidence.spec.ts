import { CONFIDENCE_THRESHOLD } from '../routing-constants';
import { GateResultSchema } from '../contracts/route-decide-result.schema';
import {
  NO_CONFIDENCE_REPORTED,
  compileChosenReason,
  compilePreflightReasons,
  type ChosenReasonInput,
} from './compile-reasons';
import {
  NULL_CONFIDENCE_MARK,
  appliesLowConfidenceFallback,
  compileStageConfidence,
  formatConfidence,
  overallConfidence,
  overallRosterConfidence,
  resolveAnswerConfidence,
  rosterEntryConfidence,
  type SourcedConfidence,
} from './confidence';

const usage = {
  requests: 0,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
};

function modelAnswer(reportedConfidence: number | null): SourcedConfidence {
  return { source: 'model', reportedConfidence };
}

function chosenModel(reportedConfidence: number | null): ChosenReasonInput {
  return {
    phaseId: 'implement',
    executor: { kind: 'lane', id: 'grok', cli: 'grok', family: 'grok' },
    model: 'grok-4',
    score: 50,
    source: 'model',
    cell: { kind: 'unknown' },
    limitState: 'unknown',
    rotationChangedChoice: false,
    preferenceChangedChoice: false,
    reportedConfidence,
    fallbackCause: null,
    inputRowIds: ['grok'],
    discardedModelText: 'MODEL-FREE-TEXT-9f3a',
  };
}

describe('requirement 13.5', () => {
  it('uses the minimum of model-sourced confidences 0.9 and 0.6', () => {
    expect(overallConfidence([modelAnswer(0.9), modelAnswer(0.6)])).toBe(0.6);
    expect(overallConfidence([modelAnswer(0.6), modelAnswer(0.9)])).toBe(0.6);
  });

  it('keeps 0.8 when a ranking entry sits beside a model-sourced 0.8', () => {
    expect(
      overallConfidence([
        modelAnswer(0.8),
        { source: 'ranking', reportedConfidence: 0.1 },
      ]),
    ).toBe(0.8);
    expect(
      overallRosterConfidence([
        { status: 'chosen', source: 'model', reportedConfidence: 0.8 },
        { status: 'chosen', source: 'ranking', reportedConfidence: 0.1 },
        { status: 'unavailable' },
      ]),
    ).toBe(0.8);
    expect(
      rosterEntryConfidence({
        status: 'chosen',
        source: 'ranking',
        reportedConfidence: 0.1,
      }),
    ).toBeNull();
    expect(rosterEntryConfidence({ status: 'unavailable' })).toBeNull();
  });

  it('returns null when a model-sourced null sits beside a model-sourced 0.8', () => {
    expect(overallConfidence([modelAnswer(0.8), modelAnswer(null)])).toBeNull();
    expect(overallConfidence([modelAnswer(null), modelAnswer(0.8)])).toBeNull();
  });

  it('keeps null confidence on the structured-output path at both stages', () => {
    const preflight = compileStageConfidence('pre-flight', [
      modelAnswer(null),
      modelAnswer(null),
    ]);
    expect(preflight.answerConfidences).toEqual([null, null]);
    expect(preflight.overallConfidence).toBeNull();
    expect(preflight.lowConfidenceFallback).toBe(false);

    const preflightReasons = compilePreflightReasons({
      answers: [
        {
          name: 'taskType',
          source: 'model',
          reportedConfidence: null,
          fallbackCause: null,
        },
        {
          name: 'depth',
          source: 'model',
          reportedConfidence: null,
          fallbackCause: null,
        },
      ],
      missingInputs: [],
    });
    expect(preflightReasons).toEqual([
      `taskType source model; ${NO_CONFIDENCE_REPORTED}; fallback cause none`,
      `depth source model; ${NO_CONFIDENCE_REPORTED}; fallback cause none`,
    ]);
    expect(preflightReasons.join('\n')).not.toContain('low-confidence');

    const gate = compileStageConfidence('gate-0.1', [
      modelAnswer(null),
      { source: 'ranking', reportedConfidence: null },
    ]);
    expect(gate.stage).toBe('gate-0.1');
    expect(gate.answerConfidences).toEqual([null, null]);
    expect(gate.overallConfidence).toBeNull();
    expect(gate.lowConfidenceFallback).toBe(false);

    const reason = compileChosenReason(chosenModel(null));
    expect(NO_CONFIDENCE_REPORTED).toBe('no confidence reported');
    expect(reason).toContain('no confidence reported');
    expect(reason).not.toContain('low-confidence');
    expect(reason).not.toContain('MODEL-FREE-TEXT-9f3a');
    expect(formatConfidence(null)).toBe(NULL_CONFIDENCE_MARK);
    expect(formatConfidence(null)).toBe('\u2014');
    expect(NULL_CONFIDENCE_MARK).not.toBe('-');
  });

  it('returns null when no answer is model-sourced', () => {
    expect(overallConfidence([])).toBeNull();
    expect(
      overallConfidence([
        { source: 'ranking', reportedConfidence: 0.2 },
        { source: 'pin', reportedConfidence: 0.3 },
        { source: 'skill-table', reportedConfidence: 0.99 },
      ]),
    ).toBeNull();
    expect(overallRosterConfidence([{ status: 'unavailable' }])).toBeNull();
    expect(
      resolveAnswerConfidence({
        source: 'skill-table',
        reportedConfidence: 0.99,
      }),
    ).toBeNull();
    expect(
      resolveAnswerConfidence({ source: 'pin', reportedConfidence: 0.2 }),
    ).toBeNull();
  });

  it('treats zero as a reported confidence', () => {
    expect(overallConfidence([modelAnswer(0), modelAnswer(0.4)])).toBe(0);
    expect(resolveAnswerConfidence(modelAnswer(0))).toBe(0);
    expect(formatConfidence(0)).toBe('0');
    expect(formatConfidence(1)).toBe('1');
  });

  it('does not treat the threshold itself as low confidence', () => {
    expect(appliesLowConfidenceFallback(CONFIDENCE_THRESHOLD)).toBe(false);
    expect(appliesLowConfidenceFallback(0.49)).toBe(true);
    expect(appliesLowConfidenceFallback(null)).toBe(false);
    expect(appliesLowConfidenceFallback(0)).toBe(true);
  });

  it('does not treat a ranking number as low confidence', () => {
    const stage = compileStageConfidence('gate-0.1', [
      { source: 'ranking', reportedConfidence: 0.1 },
      { source: 'pin', reportedConfidence: 0.1 },
      { source: 'skill-table', reportedConfidence: 0.1 },
    ]);
    expect(stage.lowConfidenceFallback).toBe(false);
    expect(stage.overallConfidence).toBeNull();
    expect(stage.answerConfidences).toEqual([null, null, null]);
  });

  it('flags a reported model confidence below the threshold', () => {
    const stage = compileStageConfidence('pre-flight', [modelAnswer(0.49)]);
    expect(stage.lowConfidenceFallback).toBe(true);
    expect(stage.overallConfidence).toBe(0.49);
    expect(stage.answerConfidences).toEqual([0.49]);
  });

  it('prints the same digits in the reason and the table', () => {
    expect(formatConfidence(0.6)).toBe('0.6');
    expect(compileChosenReason(chosenModel(0.6))).toContain(
      `model probability ${formatConfidence(0.6)}`,
    );
  });

  it('does not mutate the answers', () => {
    const answers = [modelAnswer(0.9), modelAnswer(0.6)];
    const before = JSON.stringify(answers);
    overallConfidence(answers);
    expect(JSON.stringify(answers)).toBe(before);
  });

  it('rejects a confidence outside 0 to 1', () => {
    const invalid = [1.1, -0.01, Number.NaN, Number.POSITIVE_INFINITY];
    for (const value of invalid) {
      expect(() => resolveAnswerConfidence(modelAnswer(value))).toThrow(
        '0 to 1',
      );
      expect(() => formatConfidence(value)).toThrow('0 to 1');
      expect(() => appliesLowConfidenceFallback(value)).toThrow('0 to 1');
    }
    expect(
      resolveAnswerConfidence({ source: 'ranking', reportedConfidence: 1.1 }),
    ).toBeNull();
  });

  it('accepts the minimum on the published gate schema', () => {
    const overall = overallConfidence([modelAnswer(0.9), modelAnswer(0.6)]);
    expect(overall).toBe(0.6);
    const first = compileChosenReason(chosenModel(0.9));
    const second = compileChosenReason({
      ...chosenModel(0.6),
      phaseId: 'review',
      executor: { kind: 'lane', id: 'codex', cli: 'codex', family: 'codex' },
      model: 'gpt-5',
      inputRowIds: ['codex'],
    });
    const parsed = GateResultSchema.safeParse({
      stage: 'gate-0.1',
      roster: [
        {
          phaseId: 'implement',
          status: 'chosen',
          executor: { kind: 'lane', id: 'grok', cli: 'grok', family: 'grok' },
          model: 'grok-4',
          provenance: 'reported',
          score: 50,
          source: 'model',
          taskKind: 'implement',
          confidence: 0.9,
          fallbackCause: null,
          modelProposal: null,
          reason: first,
        },
        {
          phaseId: 'review',
          status: 'chosen',
          executor: {
            kind: 'lane',
            id: 'codex',
            cli: 'codex',
            family: 'codex',
          },
          model: 'gpt-5',
          provenance: 'reported',
          score: 50,
          source: 'model',
          taskKind: 'review',
          confidence: 0.6,
          fallbackCause: null,
          modelProposal: null,
          reason: second,
        },
      ],
      overallSource: 'model',
      overallConfidence: overall,
      excluded: [],
      reasons: [first, second],
      usage,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.overallConfidence).toBe(0.6);
      expect(parsed.data.roster[0]?.confidence).toBe(0.9);
      expect(parsed.data.roster[1]?.confidence).toBe(0.6);
    }
  });
});
