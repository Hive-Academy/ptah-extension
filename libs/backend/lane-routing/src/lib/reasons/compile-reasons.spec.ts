import type { LaneLimitState } from '@ptah-extension/shared';
import {
  ChosenEntrySchema,
  EXCLUSION_RULES,
  FALLBACK_CAUSES,
  PreflightResultSchema,
  UnavailableEntrySchema,
} from '../contracts/route-decide-result.schema';
import type { MatrixCell } from '../matrix/matrix.types';
import { MINIMUM_SAMPLE_COUNT } from '../routing-constants';
import {
  MISSING_INPUT_REASON,
  MISSING_INPUTS,
  NO_CONFIDENCE_REPORTED,
  compileChosenReason,
  compileGateReasons,
  compilePreflightReasons,
  compileResultReasons,
  compileUnavailableReason,
  type ChosenExecutor,
  type ChosenReasonInput,
  type UnavailableReasonInput,
} from './compile-reasons';

const SEED_URL = 'https://datasets.example/swe-bench-verified';
const SEED_NOTE = 'MEASURES-BACKEND-ONLY';
const USER_URL = 'https://user.example/edit';
const LOCAL_URL = 'https://datasets.example/local-must-not-leak';
const MODEL_TEXT = 'MODEL-FREE-TEXT-9f3a';
const PROPOSAL = 'UNTRUSTED-PROPOSAL';

const usage = {
  requests: 0,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
};

const LIMIT_STATES = [
  'at-limit',
  'near-limit',
  'confirmed-room',
  'unknown',
] as const satisfies readonly LaneLimitState[];

function lane(id: string): ChosenExecutor {
  return { kind: 'lane', id, cli: id, family: id };
}

function seedCell(stale: boolean): MatrixCell {
  return {
    kind: 'value',
    score: 80,
    source: 'seed',
    sourceRef: SEED_URL,
    asOf: '2026-02-19',
    stale,
    note: SEED_NOTE,
  };
}

function userCell(): MatrixCell {
  return {
    kind: 'value',
    score: 70,
    source: 'user',
    sourceRef: USER_URL,
    asOf: '2026-04-02',
    stale: false,
  };
}

function localCell(sampleCount?: number): MatrixCell {
  return {
    kind: 'value',
    score: 65,
    source: 'local',
    sourceRef: LOCAL_URL,
    asOf: '2026-10-01T00:00:00.000Z',
    stale: false,
    ...(sampleCount !== undefined ? { sampleCount } : {}),
  };
}

function chosen(
  overrides: Partial<Omit<ChosenReasonInput, 'executor' | 'cell'>> & {
    readonly executor?: ChosenExecutor;
    readonly cell?: MatrixCell;
  } = {},
): ChosenReasonInput {
  const cell = overrides.cell ?? { kind: 'unknown' };
  const score = overrides.score ?? (cell.kind === 'value' ? cell.score : 50);
  return {
    phaseId: overrides.phaseId ?? 'implement',
    executor: overrides.executor ?? lane('grok'),
    model: overrides.model ?? 'grok-4',
    score,
    source: overrides.source ?? 'ranking',
    cell,
    limitState: overrides.limitState ?? 'confirmed-room',
    rotationChangedChoice: overrides.rotationChangedChoice ?? false,
    preferenceChangedChoice: overrides.preferenceChangedChoice ?? false,
    ...(overrides.preferenceSource !== undefined
      ? { preferenceSource: overrides.preferenceSource }
      : {}),
    reportedConfidence:
      overrides.reportedConfidence === undefined
        ? null
        : overrides.reportedConfidence,
    fallbackCause:
      overrides.fallbackCause === undefined ? null : overrides.fallbackCause,
    inputRowIds: overrides.inputRowIds ?? ['grok', 'codex'],
    ...(overrides.discardedModelText !== undefined
      ? { discardedModelText: overrides.discardedModelText }
      : {}),
    ...(overrides.modelProposalOption !== undefined
      ? { modelProposalOption: overrides.modelProposalOption }
      : {}),
  };
}

function namedCandidates(text: string): string[] {
  const names: string[] = [];
  for (const clause of text.split('; ')) {
    const executor = /^executor (?:lane|subagent) (\S+)$/.exec(clause);
    if (executor?.[1] !== undefined) {
      names.push(executor[1]);
      continue;
    }
    const excluded = /^candidate (.+) excluded by [a-z-]+$/.exec(clause);
    if (excluded?.[1] !== undefined) {
      names.push(excluded[1]);
    }
  }
  return names;
}

function namedTopLevel(line: string): string | null {
  const excluded = /^phase \S+ candidate (.+) excluded by [a-z-]+$/.exec(line);
  return excluded?.[1] ?? null;
}

function expectProvenance(cell: MatrixCell, reason: string): void {
  if (cell.kind === 'unknown') {
    expect(reason).toContain('no profile');
    expect(reason).not.toContain('provenance seed');
    expect(reason).not.toContain('provenance user');
    expect(reason).not.toContain('provenance local');
    return;
  }
  expect(reason).toContain(`provenance ${cell.source}`);
  if (cell.source === 'seed') {
    expect(reason).toContain(`asOf ${cell.asOf}`);
    expect(reason).toContain(`stale ${cell.stale}`);
  } else {
    expect(reason).not.toContain('asOf');
    expect(reason).not.toContain(cell.asOf);
  }
  if (cell.source === 'local') {
    expect(reason).toContain(`sample count ${cell.sampleCount}`);
  }
  if (cell.sourceRef !== undefined) {
    expect(reason).not.toContain(cell.sourceRef);
  }
  if (cell.note !== undefined) {
    expect(reason).not.toContain(cell.note);
  }
}

function expectChosenFacts(input: ChosenReasonInput): void {
  const reason = compileChosenReason(input);
  expect(reason).toContain(`phase ${input.phaseId}`);
  expect(reason).toContain(
    `executor ${input.executor.kind} ${input.executor.id}`,
  );
  expect(reason).toContain(`model ${input.model}`);
  expect(reason).toContain(`score ${input.score}`);
  expect(reason).toContain(`limit state ${input.limitState}`);
  expect(reason).toContain(
    input.rotationChangedChoice
      ? 'rotation changed the choice'
      : 'rotation did not change the choice',
  );
  expect(reason).toContain(
    input.preferenceChangedChoice
      ? 'preference changed the choice'
      : 'preference did not change the choice',
  );
  if (
    input.preferenceSource !== undefined &&
    input.preferenceSource.trim() !== ''
  ) {
    expect(reason).toContain(
      `preference source ${input.preferenceSource.trim()}`,
    );
  }
  expectProvenance(input.cell, reason);
  if (input.source === 'model') {
    if (input.reportedConfidence === null) {
      expect(reason).toContain(NO_CONFIDENCE_REPORTED);
      expect(reason).not.toContain('model probability');
    } else {
      expect(reason).toContain(
        `model probability ${JSON.stringify(input.reportedConfidence)}`,
      );
      expect(reason).not.toContain(NO_CONFIDENCE_REPORTED);
    }
  } else {
    expect(reason).toContain('model probability not applicable');
    expect(reason).not.toContain(NO_CONFIDENCE_REPORTED);
    if (input.reportedConfidence !== null) {
      expect(reason).not.toContain(JSON.stringify(input.reportedConfidence));
    }
  }
  expect(reason).toContain(`fallback cause ${input.fallbackCause ?? 'none'}`);
  if (input.discardedModelText !== undefined) {
    expect(reason).not.toContain(input.discardedModelText);
  }
  if (input.modelProposalOption !== undefined) {
    expect(reason).not.toContain(input.modelProposalOption);
  }
  expect(namedCandidates(reason)).toEqual([input.executor.id]);
  for (const id of namedCandidates(reason)) {
    expect(input.inputRowIds).toContain(id);
  }
}

describe('requirement 13.1', () => {
  it('drops structured-output free text and the proposal label from a chosen reason', () => {
    const base = chosen({
      source: 'model',
      reportedConfidence: null,
      modelProposalOption: PROPOSAL,
    });
    const withText = compileChosenReason({
      ...base,
      discardedModelText: MODEL_TEXT,
    });
    expect(withText).toBe(compileChosenReason(base));
    expect(withText).not.toContain(MODEL_TEXT);
    expect(withText).not.toContain(PROPOSAL);
  });

  it('drops structured-output free text from an unavailable reason', () => {
    const base: UnavailableReasonInput = {
      phaseId: 'implement',
      exclusionReason: 'no-eligible-candidate',
      excludedBy: [{ candidate: 'codex', rule: 'at-limit' }],
      pinRule: null,
      needsDisclosedFallback: false,
      source: 'ranking',
      inputRowIds: ['codex'],
      modelProposalOption: PROPOSAL,
    };
    const withText = compileUnavailableReason({
      ...base,
      discardedModelText: MODEL_TEXT,
    });
    expect(withText).toBe(compileUnavailableReason(base));
    expect(withText).not.toContain(MODEL_TEXT);
    expect(withText).not.toContain(PROPOSAL);
  });

  it('drops structured-output free text from pre-flight reasons', () => {
    const reasons = compilePreflightReasons({
      answers: [
        {
          name: 'taskType',
          source: 'model',
          reportedConfidence: null,
          fallbackCause: null,
          discardedModelText: MODEL_TEXT,
          modelProposalOption: PROPOSAL,
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
    const text = reasons.join('\n');
    expect(text).not.toContain(MODEL_TEXT);
    expect(text).not.toContain(PROPOSAL);
    expect(text).toContain(NO_CONFIDENCE_REPORTED);
  });
});

describe('requirement 13.2 chosen facts', () => {
  it('states seed provenance with asOf and stale and omits the dataset URL', () => {
    const reason = compileChosenReason(chosen({ cell: seedCell(true) }));
    expect(reason).toBe(
      [
        'phase implement',
        'executor lane grok',
        'model grok-4',
        'score 80',
        'provenance seed, asOf 2026-02-19, stale true',
        'limit state confirmed-room',
        'rotation did not change the choice',
        'preference did not change the choice',
        'model probability not applicable',
        'fallback cause none',
      ].join('; '),
    );
    expect(reason).not.toContain(SEED_URL);
    expect(reason).not.toContain(SEED_NOTE);
    expect(reason).not.toContain('sourceRef');
  });

  it('states a fresh seed cell as stale false', () => {
    const reason = compileChosenReason(chosen({ cell: seedCell(false) }));
    expect(reason).toContain('provenance seed, asOf 2026-02-19, stale false');
    expect(reason).not.toContain('stale true');
    expect(reason).not.toContain(SEED_URL);
  });

  it('states user provenance and omits the dataset URL and asOf', () => {
    const reason = compileChosenReason(chosen({ cell: userCell() }));
    expect(reason).toContain('score 70');
    expect(reason).toContain('provenance user');
    expect(reason).not.toContain('provenance seed');
    expect(reason).not.toContain('provenance local');
    expect(reason).not.toContain('asOf');
    expect(reason).not.toContain('2026-04-02');
    expect(reason).not.toContain(USER_URL);
  });

  it('states local provenance with the sample count and omits asOf and sourceRef', () => {
    const reason = compileChosenReason(
      chosen({ cell: localCell(MINIMUM_SAMPLE_COUNT) }),
    );
    expect(reason).toContain(
      `provenance local, sample count ${MINIMUM_SAMPLE_COUNT}`,
    );
    expect(reason).toContain('score 65');
    expect(reason).not.toContain('asOf');
    expect(reason).not.toContain('2026-10-01');
    expect(reason).not.toContain(LOCAL_URL);
    expect(reason).not.toContain('provenance seed');
  });

  it('states no profile when the matrix cell is unknown', () => {
    const reason = compileChosenReason(
      chosen({ cell: { kind: 'unknown' }, score: 50 }),
    );
    expect(reason).toContain('score 50');
    expect(reason).toContain('no profile');
    expect(reason).not.toContain('provenance seed');
    expect(reason).not.toContain('provenance user');
    expect(reason).not.toContain('provenance local');
  });

  it('names a subagent executor and its limit state', () => {
    const reason = compileChosenReason(
      chosen({
        executor: {
          kind: 'subagent',
          id: 'subagent:backend-developer',
          role: 'backend-developer',
          family: 'claude',
        },
        inputRowIds: ['subagent:backend-developer'],
        limitState: 'unknown',
        model: 'sonnet',
      }),
    );
    expect(reason).toContain('executor subagent subagent:backend-developer');
    expect(reason).toContain('model sonnet');
    expect(reason).toContain('limit state unknown');
  });

  it('states when rotation changed the choice', () => {
    const reason = compileChosenReason(chosen({ rotationChangedChoice: true }));
    expect(reason).toContain('rotation changed the choice');
    expect(reason).not.toContain('rotation did not change the choice');
  });

  it('states when rotation did not change the choice', () => {
    const reason = compileChosenReason(
      chosen({ rotationChangedChoice: false }),
    );
    expect(reason).toContain('rotation did not change the choice');
  });

  it('states when a preference changed the choice and echoes its source', () => {
    const reason = compileChosenReason(
      chosen({
        preferenceChangedChoice: true,
        preferenceSource: '  user-note  ',
      }),
    );
    expect(reason).toContain(
      'preference changed the choice, preference source user-note',
    );
    expect(reason).not.toContain('  user-note');
  });

  it('states when a preference did not change the choice', () => {
    const reason = compileChosenReason(
      chosen({ preferenceChangedChoice: false, preferenceSource: '   ' }),
    );
    expect(reason).toContain('preference did not change the choice');
    expect(reason).not.toContain('preference source');
  });

  it('states the model probability for a model-sourced choice', () => {
    expectChosenFacts(chosen({ source: 'model', reportedConfidence: 0.75 }));
  });

  it('states no confidence reported when a model reports none', () => {
    expect(NO_CONFIDENCE_REPORTED).toBe('no confidence reported');
    expectChosenFacts(chosen({ source: 'model', reportedConfidence: null }));
  });

  it.each(['ranking', 'pin'] as const)(
    'does not treat a %s choice as no confidence reported',
    (source) => {
      expectChosenFacts(chosen({ source, reportedConfidence: 0.75 }));
    },
  );

  it.each(FALLBACK_CAUSES)('states fallback cause %s', (cause) => {
    expectChosenFacts(chosen({ source: 'ranking', fallbackCause: cause }));
  });

  it('states fallback cause none when there is no fallback', () => {
    expectChosenFacts(chosen({ fallbackCause: null }));
  });

  it.each(LIMIT_STATES)('states limit state %s', (limitState) => {
    expectChosenFacts(chosen({ limitState }));
  });

  it('returns the same chosen reason for the same facts', () => {
    const input = chosen({
      source: 'model',
      reportedConfidence: 0.6,
      rotationChangedChoice: true,
      cell: seedCell(true),
    });
    expect(compileChosenReason(input)).toBe(compileChosenReason(input));
  });

  it('accepts a chosen reason on the published chosen-entry schema', () => {
    const input = chosen({
      source: 'model',
      reportedConfidence: 0.6,
      cell: seedCell(true),
      fallbackCause: 'timeout',
    });
    const parsed = ChosenEntrySchema.safeParse({
      phaseId: input.phaseId,
      status: 'chosen',
      executor: {
        kind: input.executor.kind,
        id: input.executor.id,
        cli: 'grok',
        family: 'grok',
      },
      model: input.model,
      provenance: 'reported',
      score: input.score,
      source: input.source,
      taskKind: 'implement',
      confidence: input.reportedConfidence,
      fallbackCause: input.fallbackCause,
      modelProposal: null,
      reason: compileChosenReason(input),
    });
    expect(parsed.success).toBe(true);
  });
});

describe('requirement 13.2 unavailable facts', () => {
  it('states no-eligible-candidate when nobody was excluded', () => {
    const reason = compileUnavailableReason({
      phaseId: 'implement',
      exclusionReason: 'no-eligible-candidate',
      excludedBy: [],
      pinRule: null,
      needsDisclosedFallback: false,
      source: 'ranking',
      inputRowIds: [],
    });
    expect(reason).toBe(
      [
        'phase implement',
        'exclusion reason no-eligible-candidate',
        'pin rule none',
        'disclosed fallback false',
        'no candidate excluded',
      ].join('; '),
    );
    expect(namedCandidates(reason)).toEqual([]);
    expect(reason).not.toContain(NO_CONFIDENCE_REPORTED);
  });

  it('states reviewer-family and the disclosed fallback flag', () => {
    const reason = compileUnavailableReason({
      phaseId: 'review',
      exclusionReason: 'reviewer-family',
      excludedBy: [{ candidate: 'codex', rule: 'reviewer-family' }],
      pinRule: null,
      needsDisclosedFallback: true,
      source: 'ranking',
      inputRowIds: ['codex'],
    });
    expect(reason).toBe(
      [
        'phase review',
        'exclusion reason reviewer-family',
        'pin rule none',
        'disclosed fallback true',
        'candidate codex excluded by reviewer-family',
      ].join('; '),
    );
    expect(reason).not.toContain(NO_CONFIDENCE_REPORTED);
  });

  it('states pin-unavailable and the pin rule', () => {
    const reason = compileUnavailableReason({
      phaseId: 'implement',
      exclusionReason: 'pin-unavailable',
      excludedBy: [{ candidate: 'ghost-lane', rule: 'not-listed' }],
      pinRule: 'not-listed',
      needsDisclosedFallback: false,
      source: 'pin',
      inputRowIds: ['grok'],
    });
    expect(reason).toBe(
      [
        'phase implement',
        'exclusion reason pin-unavailable',
        'pin rule not-listed',
        'disclosed fallback false',
        'candidate ghost-lane excluded by not-listed',
      ].join('; '),
    );
  });

  it.each(EXCLUSION_RULES)(
    'states exclusion rule %s on the unavailable entry and the top-level reasons',
    (rule) => {
      const exclusionReason =
        rule === 'not-listed'
          ? 'pin-unavailable'
          : rule === 'reviewer-family'
            ? 'reviewer-family'
            : 'no-eligible-candidate';
      const candidate = rule === 'not-listed' ? 'ghost-lane' : 'codex';
      const reason = compileUnavailableReason({
        phaseId: 'review',
        exclusionReason,
        excludedBy: [{ candidate, rule }],
        pinRule: exclusionReason === 'pin-unavailable' ? rule : null,
        needsDisclosedFallback: exclusionReason === 'reviewer-family',
        source: exclusionReason === 'pin-unavailable' ? 'pin' : 'ranking',
        inputRowIds: ['grok', 'codex'],
      });
      expect(reason).toContain(`exclusion reason ${exclusionReason}`);
      expect(reason).toContain(`candidate ${candidate} excluded by ${rule}`);
      const top = compileResultReasons({
        excluded: [{ phaseId: 'review', candidate, rule }],
        missingInputs: [],
        inputRowIds: ['grok', 'codex'],
      });
      expect(top).toEqual([
        `phase review candidate ${candidate} excluded by ${rule}`,
      ]);
      const names = [
        ...namedCandidates(reason),
        ...top.flatMap((line) => {
          const id = namedTopLevel(line);
          return id === null ? [] : [id];
        }),
      ];
      for (const id of names) {
        if (rule === 'not-listed') {
          expect(id).toBe('ghost-lane');
        } else {
          expect(['grok', 'codex']).toContain(id);
        }
      }
    },
  );

  it('accepts an unavailable reason on the published unavailable-entry schema', () => {
    const input: UnavailableReasonInput = {
      phaseId: 'review',
      exclusionReason: 'reviewer-family',
      excludedBy: [{ candidate: 'codex', rule: 'reviewer-family' }],
      pinRule: null,
      needsDisclosedFallback: true,
      source: 'ranking',
      inputRowIds: ['codex'],
    };
    const parsed = UnavailableEntrySchema.safeParse({
      phaseId: input.phaseId,
      status: 'unavailable',
      executor: 'unavailable',
      exclusionReason: input.exclusionReason,
      excludedBy: input.excludedBy,
      pinRule: input.pinRule,
      needsDisclosedFallback: input.needsDisclosedFallback,
      source: input.source,
      model: null,
      provenance: null,
      score: null,
      confidence: null,
      fallbackCause: null,
      reason: compileUnavailableReason(input),
    });
    expect(parsed.success).toBe(true);
  });
});

describe('requirement 13.3', () => {
  it('lists each excluded candidate once, then the pin rule, then each missing input', () => {
    const gate = compileGateReasons({
      chosen: [
        chosen({
          source: 'model',
          reportedConfidence: null,
          rotationChangedChoice: true,
          preferenceChangedChoice: true,
          preferenceSource: 'user-note',
          limitState: 'unknown',
        }),
      ],
      unavailable: [
        {
          phaseId: 'review',
          exclusionReason: 'pin-unavailable',
          excludedBy: [{ candidate: 'ghost-lane', rule: 'not-listed' }],
          pinRule: 'not-listed',
          needsDisclosedFallback: false,
          source: 'pin',
        },
      ],
      excluded: [
        { phaseId: 'implement', candidate: 'codex', rule: 'at-limit' },
        { phaseId: 'review', candidate: 'ghost-lane', rule: 'not-listed' },
      ],
      missingInputs: ['outcome-history', 'outcome-history', 'matrix-file'],
      inputRowIds: ['grok', 'codex'],
    });
    expect(gate.reasons).toEqual([
      'phase implement candidate codex excluded by at-limit',
      'phase review candidate ghost-lane excluded by not-listed',
      'phase review pin unavailable, pin rule not-listed',
      'no outcome history',
      'matrix file unreadable',
    ]);
    expect(gate.chosenReasons).toHaveLength(1);
    expect(gate.chosenReasons[0]).toContain(NO_CONFIDENCE_REPORTED);
    expect(gate.unavailableReasons).toHaveLength(1);
    expect(gate.unavailableReasons[0]).toContain(
      'exclusion reason pin-unavailable',
    );
    expect(
      compileGateReasons({
        chosen: [
          chosen({
            source: 'model',
            reportedConfidence: null,
            rotationChangedChoice: true,
            preferenceChangedChoice: true,
            preferenceSource: 'user-note',
            limitState: 'unknown',
          }),
        ],
        unavailable: [
          {
            phaseId: 'review',
            exclusionReason: 'pin-unavailable',
            excludedBy: [{ candidate: 'ghost-lane', rule: 'not-listed' }],
            pinRule: 'not-listed',
            needsDisclosedFallback: false,
            source: 'pin',
          },
        ],
        excluded: [
          { phaseId: 'implement', candidate: 'codex', rule: 'at-limit' },
          { phaseId: 'review', candidate: 'ghost-lane', rule: 'not-listed' },
        ],
        missingInputs: ['outcome-history', 'outcome-history', 'matrix-file'],
        inputRowIds: ['grok', 'codex'],
      }),
    ).toEqual(gate);
  });

  it.each(MISSING_INPUTS)('names missing input %s', (input) => {
    expect(
      compileResultReasons({
        excluded: [],
        missingInputs: [input],
        inputRowIds: [],
      }),
    ).toEqual([MISSING_INPUT_REASON[input]]);
  });

  it('names each missing input on a pre-flight result', () => {
    const reasons = compilePreflightReasons({
      answers: [
        {
          name: 'taskType',
          source: 'model',
          reportedConfidence: 0.8,
          fallbackCause: null,
        },
        {
          name: 'depth',
          source: 'skill-table',
          reportedConfidence: 0.33,
          fallbackCause: 'timeout',
        },
      ],
      missingInputs: ['roles', 'roles'],
    });
    expect(reasons).toEqual([
      'taskType source model; model probability 0.8; fallback cause none',
      'depth source skill-table; confidence not applicable; fallback cause timeout',
      'roles unavailable',
    ]);
    expect(reasons.join('\n')).not.toContain('0.33');
  });

  it('accepts pre-flight reasons on the published pre-flight schema', () => {
    const reasons = compilePreflightReasons({
      answers: [
        {
          name: 'taskType',
          source: 'skill-table',
          reportedConfidence: null,
          fallbackCause: null,
        },
        {
          name: 'depth',
          source: 'skill-table',
          reportedConfidence: null,
          fallbackCause: null,
        },
      ],
      missingInputs: ['outcome-history'],
    });
    const parsed = PreflightResultSchema.safeParse({
      stage: 'pre-flight',
      taskType: {
        value: null,
        source: 'skill-table',
        confidence: null,
        fallbackCause: null,
        modelProposal: null,
      },
      depth: {
        value: null,
        source: 'skill-table',
        confidence: null,
        fallbackCause: null,
        modelProposal: null,
      },
      overallConfidence: null,
      reasons,
      usage,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('requirement 13.4', () => {
  it('keeps reason facts aligned for every source, cause and exclusion reason', () => {
    for (const source of ['model', 'ranking', 'pin'] as const) {
      for (const cause of FALLBACK_CAUSES) {
        expectChosenFacts(
          chosen({
            source,
            fallbackCause: cause,
            reportedConfidence: 0.75,
            discardedModelText: MODEL_TEXT,
            modelProposalOption: PROPOSAL,
          }),
        );
      }
      expectChosenFacts(
        chosen({
          source,
          fallbackCause: null,
          reportedConfidence: null,
          cell: seedCell(true),
        }),
      );
    }
    const exclusionCases = [
      {
        exclusionReason: 'no-eligible-candidate' as const,
        rule: 'at-limit' as const,
        candidate: 'codex',
      },
      {
        exclusionReason: 'reviewer-family' as const,
        rule: 'reviewer-family' as const,
        candidate: 'codex',
      },
      {
        exclusionReason: 'pin-unavailable' as const,
        rule: 'not-listed' as const,
        candidate: 'ghost-lane',
      },
    ];
    for (const entry of exclusionCases) {
      const reason = compileUnavailableReason({
        phaseId: 'review',
        exclusionReason: entry.exclusionReason,
        excludedBy: [{ candidate: entry.candidate, rule: entry.rule }],
        pinRule:
          entry.exclusionReason === 'pin-unavailable' ? entry.rule : null,
        needsDisclosedFallback: entry.exclusionReason === 'reviewer-family',
        source: entry.exclusionReason === 'pin-unavailable' ? 'pin' : 'ranking',
        inputRowIds: ['grok', 'codex'],
        discardedModelText: MODEL_TEXT,
      });
      expect(reason).toContain(`exclusion reason ${entry.exclusionReason}`);
      expect(reason).toContain(
        `candidate ${entry.candidate} excluded by ${entry.rule}`,
      );
      expect(reason).not.toContain(MODEL_TEXT);
      for (const id of namedCandidates(reason)) {
        if (entry.rule === 'not-listed') {
          expect(id).toBe(entry.candidate);
        } else {
          expect(['grok', 'codex']).toContain(id);
        }
      }
    }
  });

  it('does not name a candidate that was not supplied', () => {
    const gate = compileGateReasons({
      chosen: [chosen()],
      unavailable: [
        {
          phaseId: 'review',
          exclusionReason: 'no-eligible-candidate',
          excludedBy: [{ candidate: 'codex', rule: 'disabled' }],
          pinRule: null,
          needsDisclosedFallback: false,
          source: 'ranking',
        },
      ],
      excluded: [{ phaseId: 'implement', candidate: 'grok', rule: 'pruned' }],
      missingInputs: [],
      inputRowIds: ['grok', 'codex'],
    });
    const text = [
      ...gate.chosenReasons,
      ...gate.unavailableReasons,
      ...gate.reasons,
    ].join('\n');
    expect(text).not.toContain('invented-lane');
    expect(text).not.toContain('ghost-lane');
    const named = [
      ...gate.chosenReasons.flatMap((reason) => namedCandidates(reason)),
      ...gate.unavailableReasons.flatMap((reason) => namedCandidates(reason)),
      ...gate.reasons.flatMap((line) => {
        const id = namedTopLevel(line);
        return id === null ? [] : [id];
      }),
    ];
    for (const id of named) {
      expect(['grok', 'codex']).toContain(id);
    }
  });

  it('refuses an excluded candidate that is not an input row', () => {
    expect(() =>
      compileResultReasons({
        excluded: [
          {
            phaseId: 'implement',
            candidate: 'invented-lane',
            rule: 'at-limit',
          },
        ],
        missingInputs: [],
        inputRowIds: ['grok'],
      }),
    ).toThrow('excluded candidate invented-lane is not an input row');
  });

  it('allows a not-listed pin that is absent from the rows', () => {
    expect(
      compileResultReasons({
        excluded: [
          { phaseId: 'implement', candidate: 'ghost-lane', rule: 'not-listed' },
        ],
        missingInputs: [],
        inputRowIds: ['grok'],
      }),
    ).toEqual(['phase implement candidate ghost-lane excluded by not-listed']);
  });

  it('refuses a chosen executor that is not an input row', () => {
    expect(() =>
      compileChosenReason(
        chosen({
          executor: lane('invented-lane'),
          inputRowIds: ['grok'],
        }),
      ),
    ).toThrow('chosen executor invented-lane is not an input row');
  });

  it('refuses a chosen score that disagrees with the matrix cell', () => {
    expect(() =>
      compileChosenReason(chosen({ cell: seedCell(true), score: 50 })),
    ).toThrow('chosen score must equal the matrix cell score');
  });

  it('refuses a score outside the routing scale', () => {
    expect(() => compileChosenReason(chosen({ score: 101 }))).toThrow(
      'score must be an integer',
    );
    expect(() => compileChosenReason(chosen({ score: -1 }))).toThrow(
      'score must be an integer',
    );
    expect(() => compileChosenReason(chosen({ score: 50.5 }))).toThrow(
      'score must be an integer',
    );
  });

  it('refuses a local cell without a sample count', () => {
    expect(() => compileChosenReason(chosen({ cell: localCell() }))).toThrow(
      'a local matrix cell must carry sampleCount',
    );
  });

  it('refuses a local sample count below the minimum', () => {
    expect(() =>
      compileChosenReason(
        chosen({ cell: localCell(MINIMUM_SAMPLE_COUNT - 1) }),
      ),
    ).toThrow(`at least ${MINIMUM_SAMPLE_COUNT}`);
  });

  it('refuses a value that would break a clause', () => {
    expect(() =>
      compileChosenReason(
        chosen({ model: 'grok; candidate ghost excluded by at-limit' }),
      ),
    ).toThrow('semicolon');
    expect(() =>
      compileChosenReason(
        chosen({
          preferenceSource: 'user; candidate ghost excluded by at-limit',
        }),
      ),
    ).toThrow('semicolon');
  });

  it('refuses a pin-unavailable entry without a pin rule', () => {
    expect(() =>
      compileUnavailableReason({
        phaseId: 'implement',
        exclusionReason: 'pin-unavailable',
        excludedBy: [],
        pinRule: null,
        needsDisclosedFallback: false,
        source: 'pin',
        inputRowIds: [],
      }),
    ).toThrow('pin-unavailable requires a pin rule');
  });

  it('refuses a pin rule on a non-pin exclusion', () => {
    expect(() =>
      compileUnavailableReason({
        phaseId: 'implement',
        exclusionReason: 'no-eligible-candidate',
        excludedBy: [],
        pinRule: 'at-limit',
        needsDisclosedFallback: false,
        source: 'ranking',
        inputRowIds: [],
      }),
    ).toThrow('pin rule is set only for pin-unavailable');
  });

  it('refuses a reviewer-family entry without the disclosed-fallback flag', () => {
    expect(() =>
      compileUnavailableReason({
        phaseId: 'review',
        exclusionReason: 'reviewer-family',
        excludedBy: [{ candidate: 'codex', rule: 'reviewer-family' }],
        pinRule: null,
        needsDisclosedFallback: false,
        source: 'ranking',
        inputRowIds: ['codex'],
      }),
    ).toThrow(
      'disclosed fallback is set only for exclusion reason reviewer-family',
    );
  });

  it('refuses a disclosed-fallback flag on a non-reviewer exclusion', () => {
    expect(() =>
      compileUnavailableReason({
        phaseId: 'implement',
        exclusionReason: 'no-eligible-candidate',
        excludedBy: [],
        pinRule: null,
        needsDisclosedFallback: true,
        source: 'ranking',
        inputRowIds: [],
      }),
    ).toThrow(
      'disclosed fallback is set only for exclusion reason reviewer-family',
    );
  });
});
