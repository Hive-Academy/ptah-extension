import { RouteDecideArgsSchema } from './route-decide-args.schema';
import {
  GateResultSchema,
  PreflightResultSchema,
  RouteDecideResultSchema,
} from './route-decide-result.schema';

const usage = {
  requests: 0,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
};

const gateArgs = {
  stage: 'gate-0.1',
  request: 'Implement and review the feature',
  taskType: 'FEATURE',
  depth: 'Full',
  phases: [
    { id: 'implement', kind: 'implement' },
    { id: 'review', kind: 'review', reviews: ['implement'] },
  ],
};

const unavailable = {
  phaseId: 'implement',
  status: 'unavailable',
  executor: 'unavailable',
  exclusionReason: 'no-eligible-candidate',
  excludedBy: [{ candidate: 'codex', rule: 'at-limit' }],
  pinRule: null,
  needsDisclosedFallback: false,
  source: 'ranking',
  model: null,
  provenance: null,
  score: null,
  confidence: null,
  fallbackCause: null,
  reason: 'All candidates are at limit',
};

const chosen = {
  phaseId: 'review',
  status: 'chosen',
  executor: { kind: 'lane', id: 'claude', cli: 'claude', family: 'anthropic' },
  model: 'sonnet',
  provenance: 'reported',
  score: 80,
  source: 'ranking',
  taskKind: 'review',
  confidence: null,
  fallbackCause: null,
  modelProposal: null,
  reason: 'Highest eligible score',
};

describe('route-decide arguments', () => {
  it('accepts the two strict stage shapes', () => {
    expect(RouteDecideArgsSchema.safeParse({ stage: 'pre-flight', request: 'Plan it' }).success).toBe(true);
    expect(RouteDecideArgsSchema.safeParse(gateArgs).success).toBe(true);
    expect(RouteDecideArgsSchema.safeParse({ stage: 'pre-flight', request: 'Plan it', phases: [] }).success).toBe(false);
    expect(RouteDecideArgsSchema.safeParse({ ...gateArgs, extra: true }).success).toBe(false);
  });

  it('names duplicate and unknown phase references at their fields', () => {
    const result = RouteDecideArgsSchema.safeParse({
      ...gateArgs,
      phases: [
        { id: 'implement', kind: 'implement', reviews: ['missing'] },
        { id: 'implement', kind: 'review' },
      ],
      pins: [{ phaseId: 'absent', executor: 'codex' }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining([
        'phases.1.id', 'phases.0.reviews.0', 'pins.0.phaseId',
      ]),
    );
  });

  it('rejects invalid task types, depths, phase kinds, and extra pin fields', () => {
    expect(RouteDecideArgsSchema.safeParse({ ...gateArgs, taskType: 'UNKNOWN' }).success).toBe(false);
    expect(RouteDecideArgsSchema.safeParse({ ...gateArgs, depth: 'Deep' }).success).toBe(false);
    expect(RouteDecideArgsSchema.safeParse({ ...gateArgs, phases: [{ id: 'x', kind: 'unknown' }] }).success).toBe(false);
    expect(RouteDecideArgsSchema.safeParse({ ...gateArgs, pins: [{ phaseId: 'review', executor: 'codex', extra: true }] }).success).toBe(false);
  });
});

describe('route-decide results', () => {
  it('accepts a pre-flight fallback with null answers', () => {
    const result = {
      stage: 'pre-flight',
      taskType: { value: null, source: 'skill-table', confidence: null, fallbackCause: 'timeout', modelProposal: null },
      depth: { value: null, source: 'skill-table', confidence: null, fallbackCause: 'timeout', modelProposal: null },
      overallConfidence: null,
      reasons: ['Decision model timed out'],
      usage,
    };
    expect(PreflightResultSchema.safeParse(result).success).toBe(true);
    expect(RouteDecideResultSchema.safeParse(result).success).toBe(true);
  });

  it('accepts a zero-candidate result without a model request', () => {
    const result = {
      stage: 'gate-0.1', roster: [unavailable],
      overallSource: 'ranking', overallConfidence: null,
      excluded: [{ phaseId: 'implement', candidate: 'codex', rule: 'at-limit' }],
      reasons: ['No eligible candidate'],
      usage,
    };
    expect(GateResultSchema.safeParse(result).success).toBe(true);
    expect(RouteDecideResultSchema.safeParse(result).success).toBe(true);
  });

  it.each(['not-listed', 'at-limit', 'reviewer-family'] as const)(
    'accepts an unavailable pin excluded by %s', (rule) => {
      const entry = {
        ...unavailable,
        exclusionReason: 'pin-unavailable',
        source: 'pin',
        pinRule: rule,
        excludedBy: [{ candidate: 'pinned-lane', rule }],
      };
      expect(GateResultSchema.safeParse({
        stage: 'gate-0.1', roster: [entry], overallSource: 'ranking',
        overallConfidence: null, excluded: [], reasons: [], usage,
      }).success).toBe(true);
    },
  );

  it('accepts a reviewer-family unavailable entry requiring disclosed fallback', () => {
    expect(GateResultSchema.safeParse({
      stage: 'gate-0.1',
      roster: [{ ...unavailable, exclusionReason: 'reviewer-family', needsDisclosedFallback: true }],
      overallSource: 'ranking', overallConfidence: null,
      excluded: [], reasons: [], usage,
    }).success).toBe(true);
  });

  it.each(['exclusionReason', 'model', 'provenance', 'score', 'confidence', 'fallbackCause'] as const)(
    'rejects unavailable entries with invalid %s', (field) => {
      const entry = { ...unavailable };
      const invalid = field === 'exclusionReason'
        ? Object.fromEntries(Object.entries(entry).filter(([key]) => key !== field))
        : { ...entry, [field]: field === 'score' || field === 'confidence' ? 1 : 'invalid' };
      expect(GateResultSchema.safeParse({
        stage: 'gate-0.1', roster: [invalid], overallSource: 'ranking',
        overallConfidence: null, excluded: [], reasons: [], usage,
      }).success).toBe(false);
    },
  );

  it('rejects a chosen entry with unavailable executor and requires taskKind', () => {
    const base = {
      stage: 'gate-0.1', overallSource: 'ranking',
      overallConfidence: null, excluded: [], reasons: [], usage,
    };
    expect(GateResultSchema.safeParse({ ...base, roster: [chosen] }).success).toBe(true);
    expect(GateResultSchema.safeParse({ ...base, roster: [{ ...chosen, executor: 'unavailable' }] }).success).toBe(false);
    expect(GateResultSchema.safeParse({ ...base, roster: [{ ...chosen, executor: { ...chosen.executor, id: 'unavailable' } }] }).success).toBe(false);
    const withoutTaskKind = Object.fromEntries(Object.entries(chosen).filter(([key]) => key !== 'taskKind'));
    expect(GateResultSchema.safeParse({ ...base, roster: [withoutTaskKind] }).success).toBe(false);
  });
});
