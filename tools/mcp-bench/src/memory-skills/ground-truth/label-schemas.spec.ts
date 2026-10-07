import {
  abstentionCaseSchema,
  adjudicationRowSchema,
  committedTriggerLabelSchema,
  factSchema,
  knownFailureEntrySchema,
  matcherSampleRowSchema,
  mergePairSchema,
  panelMatcherLabelSchema,
  panelMemoryAdjudicationSchema,
  panelMemoryDecisionSchema,
  panelSessionLabelSchema,
  panelTriggerLabelSchema,
  privateRubricScoreRowSchema,
  realSessionLabelSchema,
  rubricScoreRowSchema,
  temporalCaseSchema,
  updateCaseSchema,
} from './label-schemas';

const LABEL = {
  source: 'docs/synthetic-notes.md:12',
  sourceCommit: 'e94159db7',
  labeller: 'rater-a',
  labelledAt: '2026-10-06T09:00:00.000Z',
};

const FACT = {
  id: 'gt-m-001',
  ...LABEL,
  date: '2026-08-17',
  category: 'extraction',
  statement: 'The demo deployment serves traffic on port 4173.',
  keyTokens: [
    ['demo', 'deployment'],
    ['port', '4173'],
  ],
  forbiddenTokens: ['staging'],
  question: 'Which port does the demo deployment use?',
  expectedAnswer: '4173',
  scenarioTags: ['seeded'],
};

const SHOULD_MERGE = {
  id: 'gt-merge-001',
  kind: 'should-merge',
  factIds: ['gt-m-001', 'gt-m-001'],
  left: {
    session: 'seed-session-001',
    subject: 'demo deployment port',
    statement: 'The demo deployment serves traffic on port 4173.',
  },
  right: {
    session: 'seed-session-002',
    subject: 'port for the demo site',
    statement: 'Demos are served from port 4173.',
  },
  ...LABEL,
};

const SHOULD_NOT_MERGE = {
  ...SHOULD_MERGE,
  id: 'gt-merge-002',
  kind: 'should-not-merge',
  factIds: ['gt-m-001', 'gt-m-002'],
};

const UPDATE_CASE = {
  id: 'gt-u-001',
  slot: 'default test runner',
  v1: { value: 'jest 29', at: '2026-08-01' },
  v2: { value: 'jest 30', at: '2026-09-01' },
  bait: 'vitest 3',
  question: 'Which test runner does the repository use by default?',
  expectedAnswer: 'jest 30',
  ...LABEL,
};

const TEMPORAL_CASE = {
  id: 'gt-t-001',
  question: 'What was decided on 2026-08-17 about the demo port?',
  date: '2026-08-17',
  expectedAnswer: 'The demo deployment moved to port 4173.',
  ...LABEL,
};

const ABSTENTION_CASE = {
  id: 'gt-a-001',
  statement: 'Task TASK_2026_999 ran in a worktree for 90 seconds.',
  baitKind: 'sediment',
  question: 'Which task ran in the worktree?',
  ...LABEL,
};

const MATCHER_ROW = {
  id: 'gt-match-001',
  factId: 'gt-m-001',
  subject: 'demo deployment port',
  content: 'The demo deployment serves traffic on port 4173.',
  chunk: 'demo deployment: port 4173',
  humanMatch: true,
  labeller: 'rater-a',
  labelledAt: '2026-10-06T09:00:00.000Z',
};

const PASSING_ROW = {
  opaqueId: 'doc-0d1',
  raterId: 'rater-a',
  c1: 8,
  c2: 8,
  c3: 8,
  c4: 8,
  c5: 8,
  c6: 8,
  c7: 8,
  c8: 8,
  total: 64,
  pass: true,
  ratedAt: '2026-10-06T09:30:00.000Z',
};

const FAILING_ROW = {
  ...PASSING_ROW,
  c8: 4,
  total: 60,
  pass: false,
};

const ADJUDICATION_ROW = {
  opaqueId: 'doc-0d1',
  adjudicatorId: 'adjudicator-c',
  c1: 8,
  c2: 8,
  c3: 8,
  c4: 8,
  c5: 8,
  c6: 8,
  c7: 8,
  c8: 8,
  total: 64,
  pass: true,
  triggers: ['pass-fail-differs', 'totals-differ'],
  decidedAt: '2026-10-06T09:35:00.000Z',
};

const KNOWN_FAILURE = {
  suiteId: 'mem.extraction',
  metric: 'recall',
  direction: 'higher-is-better',
  recordedValue: 0.82,
  tolerance: 0,
  ledgerRow: 'SR-2',
  since: 'a1b2c3d4e',
};

const KNOWN_FAILURE_WITHOUT_DIRECTION = {
  suiteId: 'mem.extraction',
  metric: 'recall',
  recordedValue: 0.82,
  tolerance: 0,
  ledgerRow: 'SR-2',
  since: 'a1b2c3d4e',
};

const KNOWN_FAILURE_WITHOUT_TOLERANCE = {
  suiteId: 'mem.extraction',
  metric: 'recall',
  direction: 'higher-is-better',
  recordedValue: 0.82,
  ledgerRow: 'SR-2',
  since: 'a1b2c3d4e',
};

describe('fact schema', () => {
  it('accepts a synthetic seeded fact, with and without a bait', () => {
    expect(factSchema.parse(FACT)).toEqual(FACT);
    expect(factSchema.parse({ ...FACT, bait: 'port 3000' })).toMatchObject({
      bait: 'port 3000',
    });
  });

  it('rejects an impossible calendar date and a non-YYYY-MM-DD date', () => {
    expect(() => factSchema.parse({ ...FACT, date: '2026-02-30' })).toThrow();
    expect(() => factSchema.parse({ ...FACT, date: '2026-8-17' })).toThrow();
  });

  it('rejects a source commit that is not a lowercase sha', () => {
    expect(() =>
      factSchema.parse({ ...FACT, sourceCommit: 'not-a-sha' }),
    ).toThrow();
  });

  it('rejects an unknown key', () => {
    expect(() => factSchema.parse({ ...FACT, extra: true })).toThrow();
  });
});

describe('merge pair schema', () => {
  it('accepts both pair kinds', () => {
    expect(mergePairSchema.parse(SHOULD_MERGE)).toEqual(SHOULD_MERGE);
    expect(mergePairSchema.parse(SHOULD_NOT_MERGE)).toEqual(SHOULD_NOT_MERGE);
  });

  it('rejects a should-merge pair citing two different facts', () => {
    expect(() =>
      mergePairSchema.parse({
        ...SHOULD_MERGE,
        factIds: ['gt-m-001', 'gt-m-002'],
      }),
    ).toThrow();
  });

  it('rejects a should-not-merge pair citing the same fact twice', () => {
    expect(() =>
      mergePairSchema.parse({
        ...SHOULD_NOT_MERGE,
        factIds: ['gt-m-002', 'gt-m-002'],
      }),
    ).toThrow();
  });
});

describe('update case schema', () => {
  it('accepts a synthetic reversal pair with a bait value', () => {
    expect(updateCaseSchema.parse(UPDATE_CASE)).toEqual(UPDATE_CASE);
  });

  it('rejects v1 dated at or after v2', () => {
    expect(() =>
      updateCaseSchema.parse({
        ...UPDATE_CASE,
        v1: { value: 'jest 29', at: '2026-09-01' },
      }),
    ).toThrow();
    expect(() =>
      updateCaseSchema.parse({
        ...UPDATE_CASE,
        v2: { value: 'jest 30', at: '2026-08-01' },
      }),
    ).toThrow();
  });

  it('rejects a bait that repeats v1 or v2', () => {
    expect(() =>
      updateCaseSchema.parse({ ...UPDATE_CASE, bait: 'jest 30' }),
    ).toThrow();
    expect(() =>
      updateCaseSchema.parse({ ...UPDATE_CASE, bait: 'jest 29' }),
    ).toThrow();
  });

  it('rejects a reversal pair whose values did not change', () => {
    expect(() =>
      updateCaseSchema.parse({
        ...UPDATE_CASE,
        v2: { value: 'jest 29', at: '2026-09-01' },
      }),
    ).toThrow();
  });
});

describe('temporal case schema', () => {
  it('accepts a date-anchored question', () => {
    expect(temporalCaseSchema.parse(TEMPORAL_CASE)).toEqual(TEMPORAL_CASE);
  });

  it('rejects a question that does not carry the case date', () => {
    expect(() =>
      temporalCaseSchema.parse({
        ...TEMPORAL_CASE,
        question: 'What was decided about the demo port?',
      }),
    ).toThrow();
  });
});

describe('abstention case schema', () => {
  it('accepts a synthetic sediment statement', () => {
    expect(abstentionCaseSchema.parse(ABSTENTION_CASE)).toEqual(
      ABSTENTION_CASE,
    );
  });

  it('rejects an unknown bait kind', () => {
    expect(() =>
      abstentionCaseSchema.parse({ ...ABSTENTION_CASE, baitKind: 'chatter' }),
    ).toThrow();
  });
});

describe('matcher sample row schema', () => {
  it('accepts a sampled row, including an empty chunk', () => {
    expect(matcherSampleRowSchema.parse(MATCHER_ROW)).toEqual(MATCHER_ROW);
    expect(
      matcherSampleRowSchema.parse({ ...MATCHER_ROW, chunk: '' }),
    ).toMatchObject({ chunk: '' });
  });

  it('rejects an unknown key', () => {
    expect(() =>
      matcherSampleRowSchema.parse({ ...MATCHER_ROW, extra: 1 }),
    ).toThrow();
  });
});

describe('real-session label schema', () => {
  it('accepts sorted unique line refs', () => {
    expect(
      realSessionLabelSchema.parse({
        opaqueId: 'sess-7f3a',
        sha256: 'a'.repeat(64),
        lineRefs: [3, 17, 42],
      }),
    ).toMatchObject({ opaqueId: 'sess-7f3a' });
  });

  it('rejects unsorted or repeated line refs', () => {
    expect(() =>
      realSessionLabelSchema.parse({
        opaqueId: 'sess-7f3a',
        sha256: 'a'.repeat(64),
        lineRefs: [3, 42, 17],
      }),
    ).toThrow();
    expect(() =>
      realSessionLabelSchema.parse({
        opaqueId: 'sess-7f3a',
        sha256: 'a'.repeat(64),
        lineRefs: [3, 3],
      }),
    ).toThrow();
  });

  it('rejects a zero or negative line ref', () => {
    expect(() =>
      realSessionLabelSchema.parse({
        opaqueId: 'sess-7f3a',
        sha256: 'a'.repeat(64),
        lineRefs: [0],
      }),
    ).toThrow();
  });

  it('rejects a non-hex or uppercase sha256', () => {
    expect(() =>
      realSessionLabelSchema.parse({
        opaqueId: 'sess-7f3a',
        sha256: 'a'.repeat(63),
        lineRefs: [3],
      }),
    ).toThrow();
    expect(() =>
      realSessionLabelSchema.parse({
        opaqueId: 'sess-7f3a',
        sha256: 'A'.repeat(64),
        lineRefs: [3],
      }),
    ).toThrow();
  });
});

describe('rubric score row schema', () => {
  it('accepts committed passing and failing rows', () => {
    expect(rubricScoreRowSchema.parse(PASSING_ROW)).toEqual(PASSING_ROW);
    expect(rubricScoreRowSchema.parse(FAILING_ROW)).toEqual(FAILING_ROW);
  });

  it('rejects a total that is not the criterion sum', () => {
    expect(() =>
      rubricScoreRowSchema.parse({ ...PASSING_ROW, total: 63 }),
    ).toThrow();
  });

  it('rejects a pass flag that contradicts the rubric rule', () => {
    expect(() =>
      rubricScoreRowSchema.parse({ ...PASSING_ROW, pass: false }),
    ).toThrow();
    expect(() =>
      rubricScoreRowSchema.parse({ ...FAILING_ROW, pass: true }),
    ).toThrow();
  });

  it('rejects a criterion outside the 0-10 scale', () => {
    expect(() =>
      rubricScoreRowSchema.parse({ ...PASSING_ROW, c8: 11 }),
    ).toThrow();
  });

  it('rejects a note field on the committed row', () => {
    expect(() =>
      rubricScoreRowSchema.parse({ ...PASSING_ROW, note: 'looks fine' }),
    ).toThrow();
  });
});

describe('private rubric score row schema', () => {
  it('accepts a note in the bench data dir twin', () => {
    expect(
      privateRubricScoreRowSchema.parse({
        ...PASSING_ROW,
        note: 'c8 is generous',
      }),
    ).toMatchObject({ note: 'c8 is generous' });
  });

  it('still enforces the rubric integrity rules', () => {
    expect(() =>
      privateRubricScoreRowSchema.parse({ ...PASSING_ROW, total: 63 }),
    ).toThrow();
  });
});

describe('adjudication row schema', () => {
  it('accepts a row carrying both disagreement triggers', () => {
    expect(adjudicationRowSchema.parse(ADJUDICATION_ROW)).toEqual(
      ADJUDICATION_ROW,
    );
  });

  it('rejects a row without a trigger and a repeated trigger', () => {
    expect(() =>
      adjudicationRowSchema.parse({ ...ADJUDICATION_ROW, triggers: [] }),
    ).toThrow();
    expect(() =>
      adjudicationRowSchema.parse({
        ...ADJUDICATION_ROW,
        triggers: ['pass-fail-differs', 'pass-fail-differs'],
      }),
    ).toThrow();
  });

  it('enforces the rubric integrity rules', () => {
    expect(() =>
      adjudicationRowSchema.parse({ ...ADJUDICATION_ROW, total: 63 }),
    ).toThrow();
  });
});

describe('known-failure entry schema', () => {
  it('accepts a deterministic CI entry with zero tolerance', () => {
    expect(knownFailureEntrySchema.parse(KNOWN_FAILURE)).toEqual(KNOWN_FAILURE);
  });

  it('rejects an entry without a direction', () => {
    expect(() =>
      knownFailureEntrySchema.parse(KNOWN_FAILURE_WITHOUT_DIRECTION),
    ).toThrow();
  });

  it('rejects an unknown direction', () => {
    expect(() =>
      knownFailureEntrySchema.parse({
        ...KNOWN_FAILURE,
        direction: 'worse-is-better',
      }),
    ).toThrow();
  });

  it('defaults an omitted tolerance to zero', () => {
    expect(
      knownFailureEntrySchema.parse(KNOWN_FAILURE_WITHOUT_TOLERANCE),
    ).toMatchObject({ tolerance: 0 });
  });

  it('rejects a non-zero tolerance without a written reason', () => {
    expect(() =>
      knownFailureEntrySchema.parse({ ...KNOWN_FAILURE, tolerance: 0.05 }),
    ).toThrow();
  });

  it('accepts a non-zero tolerance with a written reason', () => {
    expect(
      knownFailureEntrySchema.parse({
        ...KNOWN_FAILURE,
        tolerance: 0.05,
        toleranceReason: 'embedding differences between platforms',
      }),
    ).toMatchObject({ tolerance: 0.05 });
  });

  it('rejects a negative tolerance', () => {
    expect(() =>
      knownFailureEntrySchema.parse({ ...KNOWN_FAILURE, tolerance: -0.01 }),
    ).toThrow();
  });

  it('rejects an unknown key', () => {
    expect(() =>
      knownFailureEntrySchema.parse({ ...KNOWN_FAILURE, extra: true }),
    ).toThrow();
  });
});

describe('rubric pass boundaries', () => {
  const at = '2026-10-07T00:00:00.000Z';

  it('passes a total of exactly 64 when every criterion is at least 6', () => {
    const row = {
      opaqueId: 'doc-boundary',
      raterId: 'rater-a',
      c1: 6,
      c2: 8,
      c3: 8,
      c4: 8,
      c5: 8,
      c6: 8,
      c7: 9,
      c8: 9,
      total: 64,
      pass: true,
      ratedAt: at,
    };
    expect(rubricScoreRowSchema.parse(row)).toEqual(row);
  });

  it('rejects a criterion of exactly 6 when the total is below 64', () => {
    expect(() =>
      rubricScoreRowSchema.parse({
        opaqueId: 'doc-boundary',
        raterId: 'rater-a',
        c1: 6,
        c2: 8,
        c3: 8,
        c4: 8,
        c5: 8,
        c6: 8,
        c7: 8,
        c8: 8,
        total: 62,
        pass: true,
        ratedAt: at,
      }),
    ).toThrow(/pass/);
  });

  it('rejects a criterion below 6 even when the total is 64', () => {
    expect(() =>
      rubricScoreRowSchema.parse({
        opaqueId: 'doc-boundary',
        raterId: 'rater-a',
        c1: 5,
        c2: 9,
        c3: 10,
        c4: 8,
        c5: 8,
        c6: 8,
        c7: 8,
        c8: 8,
        total: 64,
        pass: true,
        ratedAt: at,
      }),
    ).toThrow(/pass/);
  });
});

describe('panel memory decision schema', () => {
  const row = {
    id: 'gt-m-001',
    decision: 'accept',
    replacement: null,
    raterId: 'rater-a',
    ratedAt: '2026-10-07T00:00:00.000Z',
  };

  it('accepts accept and edit, and rejects an edit without a replacement', () => {
    expect(panelMemoryDecisionSchema.parse(row)).toEqual(row);
    expect(
      panelMemoryDecisionSchema.parse({
        ...row,
        decision: 'edit',
        replacement: 'corrected statement',
      }).decision,
    ).toBe('edit');
    expect(() =>
      panelMemoryDecisionSchema.parse({
        ...row,
        decision: 'edit',
        replacement: null,
      }),
    ).toThrow(/replacement/);
    expect(() =>
      panelMemoryDecisionSchema.parse({ ...row, replacement: 'nope' }),
    ).toThrow(/replacement/);
  });

  it('accepts an adjudication only when a trigger is present', () => {
    expect(
      panelMemoryAdjudicationSchema.parse({
        id: 'gt-m-001',
        decision: 'reject',
        replacement: null,
        adjudicatorId: 'r-glm',
        triggers: ['decision-differs'],
        decidedAt: '2026-10-07T00:00:00.000Z',
      }).triggers,
    ).toEqual(['decision-differs']);
    expect(() =>
      panelMemoryAdjudicationSchema.parse({
        id: 'gt-m-001',
        decision: 'reject',
        replacement: null,
        adjudicatorId: 'r-glm',
        triggers: [],
        decidedAt: '2026-10-07T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('panel matcher, session and trigger schemas', () => {
  it('accepts a matcher label and rejects an unknown key', () => {
    const row = {
      id: 'gt-match-001',
      factId: 'gt-m-001',
      humanMatch: false,
      raterId: 'rater-a',
      ratedAt: '2026-10-07T00:00:00.000Z',
    };
    expect(panelMatcherLabelSchema.parse(row)).toEqual(row);
    expect(() =>
      panelMatcherLabelSchema.parse({ ...row, note: 'secret' }),
    ).toThrow();
  });

  it('accepts sorted session line refs and rejects a repeat', () => {
    const row = {
      opaqueId: 'sess-1',
      sha256: 'ab'.repeat(32),
      lineRefs: [1, 4],
      raterId: 'rater-a',
      ratedAt: '2026-10-07T00:00:00.000Z',
    };
    expect(panelSessionLabelSchema.parse(row).lineRefs).toEqual([1, 4]);
    expect(() =>
      panelSessionLabelSchema.parse({ ...row, lineRefs: [4, 4] }),
    ).toThrow(/lineRefs/);
  });

  it('accepts a trigger label and the committed description row', () => {
    const row = {
      skillId: 'demo-skill',
      shouldTrigger: ['open the demo'],
      nearMiss: ['close the demo'],
      raterId: 'rater-a',
      ratedAt: '2026-10-07T00:00:00.000Z',
    };
    expect(panelTriggerLabelSchema.parse(row)).toEqual(row);
    expect(
      committedTriggerLabelSchema.parse({
        skillId: 'demo-skill',
        description: 'Serves the demo.',
        shouldTrigger: ['open the demo'],
        nearMiss: ['close the demo'],
      }).description,
    ).toBe('Serves the demo.');
    expect(
      committedTriggerLabelSchema.parse({
        skillId: 'demo-skill',
        description: 'Serves the demo.',
        shouldTrigger: ['open the demo'],
        nearMiss: ['close the demo'],
        panel: '  xAI+Google; adjudicator=GLM  ',
      }).panel,
    ).toBe('xAI+Google; adjudicator=GLM');
    expect(() =>
      committedTriggerLabelSchema.parse({
        skillId: 'demo-skill',
        description: 'Serves the demo.',
        shouldTrigger: ['open the demo'],
        nearMiss: ['close the demo'],
        panel: '   ',
      }),
    ).toThrow();
    expect(() =>
      panelTriggerLabelSchema.parse({ ...row, skillId: 'Not A Slug' }),
    ).toThrow(/skill id/);
  });
});
