import type { z } from 'zod';
import { MAX_DECISION_REQUESTS } from '../routing-constants';
import { RouteDecideArgsSchema } from './route-decide-args.schema';
import {
  GateResultSchema,
  PreflightResultSchema,
  RouteDecideResultSchema,
  UnavailableEntrySchema,
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
    expect(
      RouteDecideArgsSchema.safeParse({
        stage: 'pre-flight',
        request: 'Plan it',
      }).success,
    ).toBe(true);
    expect(RouteDecideArgsSchema.safeParse(gateArgs).success).toBe(true);
    expect(
      RouteDecideArgsSchema.safeParse({
        stage: 'pre-flight',
        request: 'Plan it',
        phases: [],
      }).success,
    ).toBe(false);
    expect(
      RouteDecideArgsSchema.safeParse({ ...gateArgs, extra: true }).success,
    ).toBe(false);
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
        'phases.1.id',
        'phases.0.reviews.0',
        'pins.0.phaseId',
      ]),
    );
  });

  it('rejects invalid task types, depths, phase kinds, and extra pin fields', () => {
    expect(
      RouteDecideArgsSchema.safeParse({ ...gateArgs, taskType: 'UNKNOWN' })
        .success,
    ).toBe(false);
    expect(
      RouteDecideArgsSchema.safeParse({ ...gateArgs, depth: 'Deep' }).success,
    ).toBe(false);
    expect(
      RouteDecideArgsSchema.safeParse({
        ...gateArgs,
        phases: [{ id: 'x', kind: 'unknown' }],
      }).success,
    ).toBe(false);
    expect(
      RouteDecideArgsSchema.safeParse({
        ...gateArgs,
        pins: [{ phaseId: 'review', executor: 'codex', extra: true }],
      }).success,
    ).toBe(false);
  });
});

describe('route-decide results', () => {
  it('accepts a pre-flight fallback with null answers', () => {
    const result = {
      stage: 'pre-flight',
      taskType: {
        value: null,
        source: 'skill-table',
        confidence: null,
        fallbackCause: 'timeout',
        modelProposal: null,
      },
      depth: {
        value: null,
        source: 'skill-table',
        confidence: null,
        fallbackCause: 'timeout',
        modelProposal: null,
      },
      overallConfidence: null,
      reasons: ['Decision model timed out'],
      usage,
    };
    expect(PreflightResultSchema.safeParse(result).success).toBe(true);
    expect(RouteDecideResultSchema.safeParse(result).success).toBe(true);
  });

  it('accepts a zero-candidate result without a model request', () => {
    const result = {
      stage: 'gate-0.1',
      roster: [unavailable],
      overallSource: 'ranking',
      overallConfidence: null,
      excluded: [
        { phaseId: 'implement', candidate: 'codex', rule: 'at-limit' },
      ],
      reasons: ['No eligible candidate'],
      usage,
    };
    expect(GateResultSchema.safeParse(result).success).toBe(true);
    expect(RouteDecideResultSchema.safeParse(result).success).toBe(true);
  });

  it.each(['not-listed', 'at-limit', 'reviewer-family'] as const)(
    'accepts an unavailable pin excluded by %s',
    (rule) => {
      const entry = {
        ...unavailable,
        exclusionReason: 'pin-unavailable',
        source: 'pin',
        pinRule: rule,
        excludedBy: [{ candidate: 'pinned-lane', rule }],
      };
      expect(
        GateResultSchema.safeParse({
          stage: 'gate-0.1',
          roster: [entry],
          overallSource: 'ranking',
          overallConfidence: null,
          excluded: [],
          reasons: [],
          usage,
        }).success,
      ).toBe(true);
    },
  );

  it('accepts a reviewer-family unavailable entry requiring disclosed fallback', () => {
    expect(
      GateResultSchema.safeParse({
        stage: 'gate-0.1',
        roster: [
          {
            ...unavailable,
            exclusionReason: 'reviewer-family',
            needsDisclosedFallback: true,
          },
        ],
        overallSource: 'ranking',
        overallConfidence: null,
        excluded: [],
        reasons: [],
        usage,
      }).success,
    ).toBe(true);
  });

  it.each([
    'exclusionReason',
    'model',
    'provenance',
    'score',
    'confidence',
    'fallbackCause',
  ] as const)('rejects unavailable entries with invalid %s', (field) => {
    const entry = { ...unavailable };
    const invalid =
      field === 'exclusionReason'
        ? Object.fromEntries(
            Object.entries(entry).filter(([key]) => key !== field),
          )
        : {
            ...entry,
            [field]:
              field === 'score' || field === 'confidence' ? 1 : 'invalid',
          };
    expect(
      GateResultSchema.safeParse({
        stage: 'gate-0.1',
        roster: [invalid],
        overallSource: 'ranking',
        overallConfidence: null,
        excluded: [],
        reasons: [],
        usage,
      }).success,
    ).toBe(false);
  });

  it('rejects a chosen entry with unavailable executor and requires taskKind', () => {
    const base = {
      stage: 'gate-0.1',
      overallSource: 'ranking',
      overallConfidence: null,
      excluded: [],
      reasons: [],
      usage,
    };
    expect(
      GateResultSchema.safeParse({ ...base, roster: [chosen] }).success,
    ).toBe(true);
    expect(
      GateResultSchema.safeParse({
        ...base,
        roster: [{ ...chosen, executor: 'unavailable' }],
      }).success,
    ).toBe(false);
    expect(
      GateResultSchema.safeParse({
        ...base,
        roster: [
          { ...chosen, executor: { ...chosen.executor, id: 'unavailable' } },
        ],
      }).success,
    ).toBe(false);
    const withoutTaskKind = Object.fromEntries(
      Object.entries(chosen).filter(([key]) => key !== 'taskKind'),
    );
    expect(
      GateResultSchema.safeParse({ ...base, roster: [withoutTaskKind] })
        .success,
    ).toBe(false);
  });
});

const gateOf = (roster: readonly unknown[]) => ({
  stage: 'gate-0.1',
  roster,
  overallSource: 'ranking',
  overallConfidence: null,
  excluded: [],
  reasons: [],
  usage,
});

const issuePaths = (schema: z.ZodType, input: unknown): string[] => {
  const result = schema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join('.'));
};

const withoutKey = <T extends object>(value: T, key: keyof T) =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

describe('route-decide arguments, P1-C5 hardening', () => {
  it('raises one issue at the second pin for a phase pinned twice', () => {
    expect(
      issuePaths(RouteDecideArgsSchema, {
        ...gateArgs,
        pins: [
          { phaseId: 'implement', executor: 'codex' },
          { phaseId: 'implement', executor: 'grok' },
        ],
      }),
    ).toEqual(['pins.1.phaseId']);
  });

  it('accepts one pin per phase', () => {
    expect(
      RouteDecideArgsSchema.safeParse({
        ...gateArgs,
        pins: [
          { phaseId: 'implement', executor: 'codex' },
          { phaseId: 'review', executor: 'grok', model: 'grok-4' },
        ],
      }).success,
    ).toBe(true);
  });

  const boundedFields = {
    'pins.0.executor': (text: string) => ({
      ...gateArgs,
      pins: [{ phaseId: 'implement', executor: text }],
    }),
    'pins.0.model': (text: string) => ({
      ...gateArgs,
      pins: [{ phaseId: 'implement', executor: 'codex', model: text }],
    }),
    'preferences.prefer.0': (text: string) => ({
      ...gateArgs,
      preferences: { prefer: [text] },
    }),
    'phases.1.reviews.0': (text: string) => ({
      ...gateArgs,
      phases: [
        { id: 'implement', kind: 'implement' },
        { id: 'review', kind: 'review', reviews: [text] },
      ],
    }),
  } as const;
  type BoundedField = keyof typeof boundedFields;

  it.each(Object.keys(boundedFields) as BoundedField[])(
    'rejects %s longer than 200 characters at that field',
    (field) => {
      const result = RouteDecideArgsSchema.safeParse(
        boundedFields[field]('x'.repeat(201)),
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues
          .filter((issue) => issue.code === 'too_big')
          .map((issue) => issue.path.join('.')),
      ).toEqual([field]);
    },
  );

  it.each(['pins.0.executor', 'pins.0.model', 'preferences.prefer.0'] as const)(
    'accepts %s of exactly 200 characters',
    (field) => {
      expect(
        RouteDecideArgsSchema.safeParse(boundedFields[field]('x'.repeat(200)))
          .success,
      ).toBe(true);
    },
  );

  it.each(['pre-flight', 'gate-0.1'] as const)(
    'rejects a whitespace-only %s request at request',
    (stage) => {
      const request = ' \t\n ';
      const args =
        stage === 'pre-flight' ? { stage, request } : { ...gateArgs, request };
      expect(issuePaths(RouteDecideArgsSchema, args)).toEqual(['request']);
    },
  );

  it('trims the request before checking it', () => {
    const result = RouteDecideArgsSchema.safeParse({
      stage: 'pre-flight',
      request: '  Plan it  ',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.request).toBe('Plan it');
  });
});

describe('route-decide results, P1-C4 cross-field rules', () => {
  const unavailableFixtures = {
    'no-eligible-candidate': unavailable,
    'reviewer-family': {
      ...unavailable,
      phaseId: 'review',
      exclusionReason: 'reviewer-family',
      excludedBy: [{ candidate: 'codex', rule: 'reviewer-family' }],
      needsDisclosedFallback: true,
      reason: 'Only same-family reviewers are eligible',
    },
    'pin-unavailable': {
      ...unavailable,
      exclusionReason: 'pin-unavailable',
      excludedBy: [{ candidate: 'ghost-lane', rule: 'not-listed' }],
      pinRule: 'not-listed',
      source: 'pin',
      reason: 'The pinned lane is not listed',
    },
  } as const;
  type FixtureReason = keyof typeof unavailableFixtures;

  it.each(Object.keys(unavailableFixtures) as FixtureReason[])(
    'accepts an unavailable entry with exclusion reason %s',
    (exclusionReason) => {
      const entry = unavailableFixtures[exclusionReason];
      expect(entry.exclusionReason).toBe(exclusionReason);
      expect(UnavailableEntrySchema.safeParse(entry).success).toBe(true);
      expect(GateResultSchema.safeParse(gateOf([entry])).success).toBe(true);
    },
  );

  it('rejects a pin-unavailable entry whose source is ranking', () => {
    const entry = {
      ...unavailableFixtures['pin-unavailable'],
      source: 'ranking',
    };
    expect(issuePaths(GateResultSchema, gateOf([entry]))).toEqual([
      'roster.0.source',
    ]);
  });

  it.each(['no-eligible-candidate', 'reviewer-family'] as const)(
    'rejects a %s entry whose source is pin',
    (exclusionReason) => {
      const entry = { ...unavailableFixtures[exclusionReason], source: 'pin' };
      expect(issuePaths(GateResultSchema, gateOf([entry]))).toEqual([
        'roster.0.source',
      ]);
    },
  );

  it('rejects a pin-unavailable entry that does not name its pin rule', () => {
    const entry = { ...unavailableFixtures['pin-unavailable'], pinRule: null };
    expect(issuePaths(GateResultSchema, gateOf([entry]))).toEqual([
      'roster.0.pinRule',
    ]);
  });

  it('rejects a reviewer-family entry without the disclosed fallback', () => {
    const entry = {
      ...unavailableFixtures['reviewer-family'],
      needsDisclosedFallback: false,
    };
    expect(issuePaths(GateResultSchema, gateOf([entry]))).toEqual([
      'roster.0.needsDisclosedFallback',
    ]);
  });

  it('rejects a lane executor with neither cli nor ptahCliId', () => {
    const executor = withoutKey(chosen.executor, 'cli');
    expect(
      issuePaths(GateResultSchema, gateOf([{ ...chosen, executor }])),
    ).toEqual(['roster.0.executor.cli']);
    expect(
      GateResultSchema.safeParse(
        gateOf([
          { ...chosen, executor: { ...executor, ptahCliId: 'ptah-cli-1' } },
        ]),
      ).success,
    ).toBe(true);
  });

  it('rejects a subagent executor without a role', () => {
    const executor = { kind: 'subagent', id: 'subagent', family: 'anthropic' };
    expect(
      issuePaths(GateResultSchema, gateOf([{ ...chosen, executor }])),
    ).toEqual(['roster.0.executor.role']);
    expect(
      GateResultSchema.safeParse(
        gateOf([
          { ...chosen, executor: { ...executor, role: 'code-logic-reviewer' } },
        ]),
      ).success,
    ).toBe(true);
  });

  it.each(['taskType', 'depth'] as const)(
    'rejects a null %s answer whose source is model',
    (field) => {
      const answer = {
        value: null,
        source: 'skill-table',
        confidence: null,
        fallbackCause: 'timeout',
        modelProposal: null,
      };
      const preflight = {
        stage: 'pre-flight',
        taskType: answer,
        depth: answer,
        overallConfidence: null,
        reasons: [],
        usage,
      };
      expect(PreflightResultSchema.safeParse(preflight).success).toBe(true);
      const modelNull = { ...answer, source: 'model', fallbackCause: null };
      expect(
        issuePaths(PreflightResultSchema, { ...preflight, [field]: modelNull }),
      ).toEqual([`${field}.value`]);
    },
  );

  it('bounds usage requests by MAX_DECISION_REQUESTS', () => {
    const gate = (requests: number) => ({
      ...gateOf([unavailable]),
      usage: { ...usage, requests },
    });
    expect(
      GateResultSchema.safeParse(gate(MAX_DECISION_REQUESTS)).success,
    ).toBe(true);
    expect(
      GateResultSchema.safeParse(gate(MAX_DECISION_REQUESTS + 1)).success,
    ).toBe(false);
  });
});
