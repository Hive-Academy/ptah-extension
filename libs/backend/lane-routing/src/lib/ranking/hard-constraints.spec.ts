import {
  SUBAGENT_FAMILY,
  type CliDetectionResult,
} from '@ptah-extension/shared';
import {
  GateResultSchema,
  UnavailableEntrySchema,
} from '../contracts/route-decide-result.schema';
import {
  toLaneCandidate,
  toSubagentCandidate,
  type LaneCandidate,
  type RoutingCandidate,
} from './candidate.types';
import {
  constrainPhase,
  type ConstrainPhaseInput,
  type KnownPhaseExecutor,
  type PhaseConstraintResult,
} from './hard-constraints';

const usage = {
  requests: 0,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
};

const chosen = {
  phaseId: 'implement',
  status: 'chosen',
  executor: { kind: 'lane', id: 'grok', cli: 'grok', family: 'grok' },
  model: 'grok-4',
  provenance: 'reported',
  score: 80,
  source: 'ranking',
  taskKind: 'implement',
  confidence: null,
  fallbackCause: null,
  modelProposal: null,
  reason: 'only eligible candidate',
};

function lane(
  fields: Omit<
    LaneCandidate,
    'kind' | 'family' | 'installed' | 'disabled' | 'limitState'
  > &
    Partial<
      Pick<
        LaneCandidate,
        | 'family'
        | 'installed'
        | 'disabled'
        | 'limitState'
        | 'ptahCliId'
        | 'preferredRank'
      >
    >,
): LaneCandidate {
  return {
    kind: 'lane',
    id: fields.id,
    cli: fields.cli,
    family: fields.family ?? fields.cli,
    installed: fields.installed ?? true,
    disabled: fields.disabled ?? false,
    limitState: fields.limitState ?? 'confirmed-room',
    ...(fields.ptahCliId !== undefined ? { ptahCliId: fields.ptahCliId } : {}),
    ...(fields.preferredRank !== undefined
      ? { preferredRank: fields.preferredRank }
      : {}),
  };
}

function implementer(
  family: string,
  phaseId = 'implement',
): KnownPhaseExecutor {
  return { phaseId, kind: 'implement', family };
}

function reviewOf(
  family: string,
  candidates: readonly RoutingCandidate[],
): ConstrainPhaseInput {
  return {
    phase: { id: 'review', kind: 'review', reviews: ['implement'] },
    candidates,
    knownExecutors: [implementer(family)],
  };
}

function ids(result: PhaseConstraintResult): readonly string[] {
  return result.status === 'eligible'
    ? result.eligible.map((candidate) => candidate.id)
    : [];
}

describe('constrainPhase requirement 3.2', () => {
  it('excludes an at-limit lane with rule at-limit and keeps the other lane', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      candidates: [
        lane({ id: 'codex', cli: 'codex', limitState: 'at-limit' }),
        lane({ id: 'grok', cli: 'grok' }),
      ],
    });

    expect(result.status).toBe('eligible');
    expect(ids(result)).toEqual(['grok']);
    expect(result.excluded).toEqual([{ candidate: 'codex', rule: 'at-limit' }]);
  });

  it('excludes a disabled lane with rule disabled', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      candidates: [
        lane({ id: 'codex', cli: 'codex', disabled: true }),
        lane({ id: 'grok', cli: 'grok' }),
      ],
    });

    expect(ids(result)).toEqual(['grok']);
    expect(result.excluded).toEqual([{ candidate: 'codex', rule: 'disabled' }]);
  });

  it('excludes a not-installed lane with rule not-installed', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      candidates: [
        lane({ id: 'codex', cli: 'codex', installed: false }),
        lane({ id: 'grok', cli: 'grok' }),
      ],
    });

    expect(ids(result)).toEqual(['grok']);
    expect(result.excluded).toEqual([
      { candidate: 'codex', rule: 'not-installed' },
    ]);
  });

  it('reports at-limit when that lane is also disabled and not installed', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      candidates: [
        lane({
          id: 'codex',
          cli: 'codex',
          limitState: 'at-limit',
          disabled: true,
          installed: false,
        }),
      ],
    });

    expect(result.status).toBe('unavailable');
    expect(result.excluded).toEqual([{ candidate: 'codex', rule: 'at-limit' }]);
  });

  it('keeps confirmed-room, near-limit and unknown lanes in input order', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      candidates: [
        lane({ id: 'grok', cli: 'grok', limitState: 'near-limit' }),
        lane({ id: 'codex', cli: 'codex', limitState: 'unknown' }),
        lane({ id: 'copilot', cli: 'copilot', limitState: 'confirmed-room' }),
      ],
    });

    expect(ids(result)).toEqual(['grok', 'codex', 'copilot']);
    expect(result.excluded).toEqual([]);
  });

  it('returns no-eligible-candidate when every lane is at-limit', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      candidates: [
        lane({ id: 'codex', cli: 'codex', limitState: 'at-limit' }),
        lane({ id: 'grok', cli: 'grok', limitState: 'at-limit' }),
      ],
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      exclusionReason: 'no-eligible-candidate',
      pinRule: null,
      needsDisclosedFallback: false,
      excluded: [
        { candidate: 'codex', rule: 'at-limit' },
        { candidate: 'grok', rule: 'at-limit' },
      ],
    });
  });
});

describe('constrainPhase requirement 3.3', () => {
  it('returns reviewer-family when the only spawnable reviewer shares the implementer family', () => {
    const result = constrainPhase(
      reviewOf('codex', [
        lane({ id: 'codex', cli: 'codex', family: 'codex' }),
        lane({ id: 'also-codex', cli: 'copilot', family: 'codex' }),
      ]),
    );

    expect(result).toMatchObject({
      status: 'unavailable',
      exclusionReason: 'reviewer-family',
      pinRule: null,
      needsDisclosedFallback: true,
      excluded: [
        { candidate: 'codex', rule: 'reviewer-family' },
        { candidate: 'also-codex', rule: 'reviewer-family' },
      ],
    });
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') {
      return;
    }
    expect(
      UnavailableEntrySchema.safeParse({
        phaseId: result.phaseId,
        status: 'unavailable',
        executor: 'unavailable',
        exclusionReason: result.exclusionReason,
        excludedBy: result.excluded,
        pinRule: result.pinRule,
        needsDisclosedFallback: result.needsDisclosedFallback,
        source: 'ranking',
        model: null,
        provenance: null,
        score: null,
        confidence: null,
        fallbackCause: null,
        reason: 'same family as the implementer',
      }).success,
    ).toBe(true);
  });

  it('keeps a different-family lane and excludes the implementer family with rule reviewer-family', () => {
    const subagent = toSubagentCandidate('code-logic-reviewer');
    const result = constrainPhase(
      reviewOf('claude', [
        lane({ id: 'claude', cli: 'copilot', family: 'claude' }),
        subagent,
        lane({ id: 'grok', cli: 'grok', family: 'grok' }),
      ]),
    );

    expect(ids(result)).toEqual(['grok']);
    expect(result.excluded).toEqual([
      { candidate: 'claude', rule: 'reviewer-family' },
      { candidate: subagent.id, rule: 'reviewer-family' },
    ]);
  });

  it('uses only the implement phases named by reviews', () => {
    const result = constrainPhase({
      phase: { id: 'review', kind: 'review', reviews: ['implement'] },
      knownExecutors: [
        implementer('codex'),
        implementer('grok', 'implement-b'),
      ],
      candidates: [
        lane({ id: 'codex', cli: 'codex' }),
        lane({ id: 'grok', cli: 'grok' }),
      ],
    });

    expect(ids(result)).toEqual(['grok']);
    expect(result.excluded).toEqual([
      { candidate: 'codex', rule: 'reviewer-family' },
    ]);
  });

  it('forbids every implement phase family when reviews is omitted', () => {
    const result = constrainPhase({
      phase: { id: 'review', kind: 'review' },
      knownExecutors: [
        implementer('codex'),
        implementer('grok', 'implement-b'),
      ],
      candidates: [
        lane({ id: 'codex', cli: 'codex' }),
        lane({ id: 'grok', cli: 'grok' }),
      ],
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      exclusionReason: 'reviewer-family',
      needsDisclosedFallback: true,
    });
  });

  it('excludes the author family on document-review with rule reviewer-family', () => {
    const result = constrainPhase({
      phase: {
        id: 'doc-review',
        kind: 'document-review',
        reviews: ['implement'],
      },
      knownExecutors: [implementer('codex')],
      candidates: [
        lane({ id: 'codex', cli: 'codex' }),
        lane({ id: 'grok', cli: 'grok' }),
      ],
    });

    expect(ids(result)).toEqual(['grok']);
    expect(result.excluded).toEqual([
      { candidate: 'codex', rule: 'reviewer-family' },
    ]);
  });

  it('returns reviewer-family when the other family is at-limit and a same-family lane is spawnable', () => {
    const result = constrainPhase(
      reviewOf('codex', [
        lane({ id: 'codex', cli: 'codex', limitState: 'confirmed-room' }),
        lane({ id: 'grok', cli: 'grok', limitState: 'at-limit' }),
      ]),
    );

    expect(result).toMatchObject({
      status: 'unavailable',
      exclusionReason: 'reviewer-family',
      needsDisclosedFallback: true,
      excluded: [
        { candidate: 'codex', rule: 'reviewer-family' },
        { candidate: 'grok', rule: 'at-limit' },
      ],
    });
  });

  it('returns no-eligible-candidate when the same-family reviewer is at-limit', () => {
    const result = constrainPhase(
      reviewOf('codex', [
        lane({ id: 'codex', cli: 'codex', limitState: 'at-limit' }),
      ]),
    );

    expect(result).toMatchObject({
      status: 'unavailable',
      exclusionReason: 'no-eligible-candidate',
      needsDisclosedFallback: false,
      excluded: [{ candidate: 'codex', rule: 'at-limit' }],
    });
  });

  it('does not apply reviewer-family when deferReviewerFamily is set', () => {
    const result = constrainPhase({
      ...reviewOf('codex', [lane({ id: 'codex', cli: 'codex' })]),
      deferReviewerFamily: true,
    });

    expect(ids(result)).toEqual(['codex']);
    expect(result.excluded).toEqual([]);
  });
});

describe('constrainPhase requirement 3.4', () => {
  it('excludes every lane on visual-review with rule never-on-a-lane and keeps the subagent', () => {
    const subagent = toSubagentCandidate('visual-reviewer');
    const result = constrainPhase({
      phase: { id: 'visual', kind: 'visual-review' },
      candidates: [lane({ id: 'codex', cli: 'codex' }), subagent],
    });

    expect(result.status).toBe('eligible');
    if (result.status !== 'eligible') {
      return;
    }
    expect(result.eligible.map((candidate) => candidate.kind)).toEqual([
      'subagent',
    ]);
    expect(ids(result)).toEqual([subagent.id]);
    expect(result.excluded).toEqual([
      { candidate: 'codex', rule: 'never-on-a-lane' },
    ]);
  });

  it('excludes every lane on design with rule never-on-a-lane and keeps the subagent', () => {
    const subagent = toSubagentCandidate('ui-ux-designer');
    const result = constrainPhase({
      phase: { id: 'design', kind: 'design' },
      candidates: [
        lane({ id: 'codex', cli: 'codex' }),
        lane({ id: 'grok', cli: 'grok' }),
        subagent,
      ],
    });

    expect(ids(result)).toEqual([subagent.id]);
    expect(result.excluded).toEqual([
      { candidate: 'codex', rule: 'never-on-a-lane' },
      { candidate: 'grok', rule: 'never-on-a-lane' },
    ]);
  });

  it('returns no-eligible-candidate when a visual-review phase has only lanes', () => {
    const result = constrainPhase({
      phase: { id: 'visual', kind: 'visual-review' },
      candidates: [lane({ id: 'codex', cli: 'codex' })],
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      exclusionReason: 'no-eligible-candidate',
      needsDisclosedFallback: false,
      excluded: [{ candidate: 'codex', rule: 'never-on-a-lane' }],
    });
  });
});

describe('constrainPhase requirement 3.5', () => {
  it('rejects a batch-size field on the gate result and on a roster entry', () => {
    const gate = {
      stage: 'gate-0.1' as const,
      roster: [chosen],
      overallSource: 'ranking' as const,
      overallConfidence: null,
      excluded: [],
      reasons: [],
      usage,
    };

    expect(GateResultSchema.safeParse(gate).success).toBe(true);
    expect(GateResultSchema.safeParse({ ...gate, batchSize: 6 }).success).toBe(
      false,
    );
    expect(
      GateResultSchema.safeParse({
        ...gate,
        roster: [{ ...chosen, batchSize: 6 }],
      }).success,
    ).toBe(false);

    const constrained = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      candidates: [lane({ id: 'grok', cli: 'grok' })],
    });
    expect(constrained).not.toHaveProperty('batchSize');
  });
});

describe('constrainPhase requirement 3.6', () => {
  it('returns pin-unavailable with rule at-limit and does not substitute another lane', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      pin: { executor: 'codex' },
      candidates: [
        lane({ id: 'codex', cli: 'codex', limitState: 'at-limit' }),
        lane({ id: 'grok', cli: 'grok' }),
      ],
    });

    expect(result).toEqual({
      phaseId: 'implement',
      status: 'unavailable',
      exclusionReason: 'pin-unavailable',
      excluded: [{ candidate: 'codex', rule: 'at-limit' }],
      pinRule: 'at-limit',
      needsDisclosedFallback: false,
    });
  });

  it('returns pin-unavailable with rule not-listed when the pin names no row', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      pin: { executor: 'missing' },
      candidates: [lane({ id: 'codex', cli: 'codex' })],
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      exclusionReason: 'pin-unavailable',
      pinRule: 'not-listed',
      needsDisclosedFallback: false,
      excluded: [{ candidate: 'missing', rule: 'not-listed' }],
    });
  });

  it('returns pin-unavailable with rule reviewer-family for a same-family pin', () => {
    const result = constrainPhase({
      ...reviewOf('codex', [
        lane({ id: 'codex', cli: 'codex' }),
        lane({ id: 'grok', cli: 'grok' }),
      ]),
      pin: { executor: 'codex' },
    });

    expect(result).toEqual({
      phaseId: 'review',
      status: 'unavailable',
      exclusionReason: 'pin-unavailable',
      excluded: [{ candidate: 'codex', rule: 'reviewer-family' }],
      pinRule: 'reviewer-family',
      needsDisclosedFallback: false,
    });
  });

  it('returns pin-unavailable with rule never-on-a-lane and does not substitute the subagent', () => {
    const subagent = toSubagentCandidate('ui-ux-designer');
    const result = constrainPhase({
      phase: { id: 'design', kind: 'design' },
      pin: { executor: 'codex' },
      candidates: [lane({ id: 'codex', cli: 'codex' }), subagent],
    });

    expect(result).toEqual({
      phaseId: 'design',
      status: 'unavailable',
      exclusionReason: 'pin-unavailable',
      excluded: [{ candidate: 'codex', rule: 'never-on-a-lane' }],
      pinRule: 'never-on-a-lane',
      needsDisclosedFallback: false,
    });
  });

  it('accepts a spawnable pin and does not keep another eligible lane', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      pin: { executor: 'grok' },
      candidates: [
        lane({ id: 'cursor', cli: 'cursor', limitState: 'at-limit' }),
        lane({ id: 'codex', cli: 'codex' }),
        lane({ id: 'grok', cli: 'grok' }),
      ],
    });

    expect(result.status).toBe('eligible');
    if (result.status !== 'eligible') {
      return;
    }
    expect(result.pinAccepted).toBe(true);
    expect(ids(result)).toEqual(['grok']);
    expect(result.excluded).toEqual([
      { candidate: 'cursor', rule: 'at-limit' },
    ]);
  });

  it('resolves a unique cli pin to that lane id', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      pin: { executor: 'ptah-cli' },
      candidates: [
        lane({
          id: 'z-ai-1',
          cli: 'ptah-cli',
          ptahCliId: 'z-ai-1',
          family: 'z-ai',
        }),
      ],
    });

    expect(result.status).toBe('eligible');
    if (result.status !== 'eligible') {
      return;
    }
    expect(result.pinAccepted).toBe(true);
    expect(ids(result)).toEqual(['z-ai-1']);
  });

  it('returns pin-unavailable with rule not-listed when the cli pin is ambiguous', () => {
    const result = constrainPhase({
      phase: { id: 'implement', kind: 'implement' },
      pin: { executor: 'ptah-cli' },
      candidates: [
        lane({ id: 'a', cli: 'ptah-cli', ptahCliId: 'a', family: 'z-ai' }),
        lane({ id: 'b', cli: 'ptah-cli', ptahCliId: 'b', family: 'moonshot' }),
      ],
    });

    expect(result).toMatchObject({
      status: 'unavailable',
      exclusionReason: 'pin-unavailable',
      pinRule: 'not-listed',
      excluded: [{ candidate: 'ptah-cli', rule: 'not-listed' }],
    });
  });
});

describe('constrainPhase determinism', () => {
  it('returns the same result for the same input without mutating candidates', () => {
    const candidates = [
      lane({ id: 'codex', cli: 'codex', limitState: 'at-limit' }),
      lane({ id: 'grok', cli: 'grok' }),
    ];
    const input: ConstrainPhaseInput = {
      phase: { id: 'implement', kind: 'implement' },
      candidates,
    };
    const before = candidates.map((candidate) => candidate.id);

    expect(constrainPhase(input)).toEqual(constrainPhase(input));
    expect(candidates.map((candidate) => candidate.id)).toEqual(before);
  });
});

describe('candidate types', () => {
  const baseRow = {
    cli: 'codex',
    installed: true,
    messagingMode: 'none',
  } satisfies CliDetectionResult;

  it('uses cli as the id and unknown when the limit map is null or misses the key', () => {
    expect(toLaneCandidate(baseRow, null)).toMatchObject({
      id: 'codex',
      family: 'codex',
      limitState: 'unknown',
      disabled: false,
    });
    expect(toLaneCandidate(baseRow, new Map()).limitState).toBe('unknown');
  });

  it('uses ptahCliId, the listed family, and the limit stored under that id', () => {
    const listed = toLaneCandidate(
      {
        cli: 'ptah-cli',
        ptahCliId: 'a1',
        providerId: 'z-ai',
        family: 'custom',
        installed: false,
        disabled: true,
        preferredRank: 0,
        messagingMode: 'none',
      },
      null,
    );
    expect(listed).toMatchObject({
      id: 'a1',
      ptahCliId: 'a1',
      family: 'custom',
      installed: false,
      disabled: true,
      limitState: 'unknown',
      preferredRank: 0,
    });

    const computed = toLaneCandidate(
      {
        cli: 'ptah-cli',
        ptahCliId: 'a1',
        providerId: 'z-ai',
        installed: true,
        messagingMode: 'none',
      },
      new Map([['a1', 'confirmed-room']]),
    );
    expect(computed.family).toBe('z-ai');
    expect(computed.limitState).toBe('confirmed-room');
  });

  it('builds a subagent candidate in the subagent family and rejects a blank role', () => {
    expect(toSubagentCandidate('backend-developer')).toEqual({
      kind: 'subagent',
      id: 'subagent:backend-developer',
      role: 'backend-developer',
      family: SUBAGENT_FAMILY,
    });
    expect(() => toSubagentCandidate('  ')).toThrow(/non-empty/);
  });
});
