import { z } from 'zod';

const nonEmptyString = z.string().min(1);
const isoDateTime = z.string().datetime();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must use the YYYY-MM-DD form')
  .refine(isCalendarDate, 'date must be a real calendar date');
const commitSha = z
  .string()
  .regex(/^[0-9a-f]{7,40}$/, 'sourceCommit must be a lowercase git sha');

/** Lowercase hex sha256 digest, used by real-session labels and manifests. */
export const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'sha256 must be a lowercase hex digest');

function isCalendarDate(value: string): boolean {
  const iso = `${value}T00:00:00.000Z`;
  const parsed = Date.parse(iso);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === iso;
}

export const factCategorySchema = z.enum([
  'extraction',
  'multi-session',
  'update',
  'temporal',
  'abstention',
  'contradiction',
]);

/** One seeded fact of `gt-memory@v1` (design 10.1). */
export const factSchema = z.strictObject({
  id: nonEmptyString,
  source: nonEmptyString,
  sourceCommit: commitSha,
  date: isoDate,
  category: factCategorySchema,
  statement: nonEmptyString,
  keyTokens: z.array(z.array(nonEmptyString).min(1)).min(1),
  forbiddenTokens: z.array(nonEmptyString),
  question: nonEmptyString,
  expectedAnswer: nonEmptyString,
  scenarioTags: z.array(nonEmptyString),
  bait: nonEmptyString.optional(),
  labeller: nonEmptyString,
  labelledAt: isoDateTime,
});
export type Fact = z.infer<typeof factSchema>;

const mergePairSideSchema = z.strictObject({
  session: nonEmptyString,
  subject: nonEmptyString,
  statement: nonEmptyString,
});

/** One pair of `gt-merge@v1`: a paraphrase of the same fact or a lookalike of a different one. */
export const mergePairSchema = z
  .strictObject({
    id: nonEmptyString,
    kind: z.enum(['should-merge', 'should-not-merge']),
    factIds: z.tuple([nonEmptyString, nonEmptyString]),
    left: mergePairSideSchema,
    right: mergePairSideSchema,
    source: nonEmptyString,
    sourceCommit: commitSha,
    labeller: nonEmptyString,
    labelledAt: isoDateTime,
  })
  .superRefine((pair, ctx) => {
    const [leftFact, rightFact] = pair.factIds;
    if (pair.kind === 'should-merge' && leftFact !== rightFact) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a should-merge pair must cite one fact on both sides',
        path: ['factIds'],
      });
    }
    if (pair.kind === 'should-not-merge' && leftFact === rightFact) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a should-not-merge pair must cite two different facts',
        path: ['factIds'],
      });
    }
  });
export type MergePair = z.infer<typeof mergePairSchema>;

const updateValueSchema = z.strictObject({
  value: nonEmptyString,
  at: isoDate,
});

/** One update case of `gt-memory@v1`: (v1 at t1, v2 at t2) plus a bait value. */
export const updateCaseSchema = z
  .strictObject({
    id: nonEmptyString,
    slot: nonEmptyString,
    v1: updateValueSchema,
    v2: updateValueSchema,
    bait: nonEmptyString,
    question: nonEmptyString,
    expectedAnswer: nonEmptyString,
    source: nonEmptyString,
    sourceCommit: commitSha,
    labeller: nonEmptyString,
    labelledAt: isoDateTime,
  })
  .superRefine((updateCase, ctx) => {
    if (updateCase.v1.value === updateCase.v2.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'v1 and v2 must state different values',
        path: ['v2', 'value'],
      });
    }
    if (updateCase.v1.at >= updateCase.v2.at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'v1 must be dated before v2 (cases are curated in date order)',
        path: ['v1', 'at'],
      });
    }
    if (
      updateCase.bait === updateCase.v1.value ||
      updateCase.bait === updateCase.v2.value
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'the bait value must differ from both v1 and v2',
        path: ['bait'],
      });
    }
  });
export type UpdateCase = z.infer<typeof updateCaseSchema>;

/** One date-anchored question of the temporal slice. */
export const temporalCaseSchema = z
  .strictObject({
    id: nonEmptyString,
    question: nonEmptyString,
    date: isoDate,
    expectedAnswer: nonEmptyString,
    source: nonEmptyString,
    sourceCommit: commitSha,
    labeller: nonEmptyString,
    labelledAt: isoDateTime,
  })
  .superRefine((temporalCase, ctx) => {
    if (!temporalCase.question.includes(temporalCase.date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'the question must be anchored to the case date',
        path: ['question'],
      });
    }
  });
export type TemporalCase = z.infer<typeof temporalCaseSchema>;

export const abstentionBaitKindSchema = z.enum([
  'sediment',
  'rejected-hypothesis',
  'corrected-claim',
]);

/** One statement that must never become a memory row. */
export const abstentionCaseSchema = z.strictObject({
  id: nonEmptyString,
  statement: nonEmptyString,
  baitKind: abstentionBaitKindSchema,
  question: nonEmptyString,
  source: nonEmptyString,
  sourceCommit: commitSha,
  labeller: nonEmptyString,
  labelledAt: isoDateTime,
});
export type AbstentionCase = z.infer<typeof abstentionCaseSchema>;

/**
 * Legacy field name for the matcher boolean. A model-panel label writes it;
 * the value is not a human rating. The committed key stays `humanMatch`.
 */
export const MATCHER_MATCH_PROVENANCE = 'panel-labelled' as const;

/**
 * One sampled (row, fact) pair of `gt-matcher@v1`.
 * `humanMatch` is panel-labelled (`MATCHER_MATCH_PROVENANCE`).
 */
export const matcherSampleRowSchema = z.strictObject({
  id: nonEmptyString,
  factId: nonEmptyString,
  subject: nonEmptyString,
  content: nonEmptyString,
  chunk: z.string(),
  humanMatch: z.boolean(),
  labeller: nonEmptyString,
  labelledAt: isoDateTime,
});
export type MatcherSampleRow = z.infer<typeof matcherSampleRowSchema>;

/**
 * The repo-side label of one held-out real session of `gt-memory-real@v1`:
 * only the opaque id, the copy's hash and the labelled line numbers.
 */
function refineSortedLineRefs(
  lineRefs: readonly number[],
  ctx: z.RefinementCtx,
): void {
  const unsorted = lineRefs.some(
    (ref, index) => index > 0 && ref <= lineRefs[index - 1],
  );
  if (unsorted) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lineRefs must be unique and sorted ascending',
      path: ['lineRefs'],
    });
  }
}

export const realSessionLabelSchema = z
  .strictObject({
    opaqueId: nonEmptyString,
    sha256: sha256HexSchema,
    lineRefs: z.array(z.number().int().positive()),
  })
  .superRefine((label, ctx) => refineSortedLineRefs(label.lineRefs, ctx));
export type RealSessionLabel = z.infer<typeof realSessionLabelSchema>;

const criterionScore = z.number().int().min(0).max(10);
const rubricTotal = z.number().int().min(0).max(80);
const RUBRIC_PASS_TOTAL = 64;
const RUBRIC_PASS_MIN_CRITERION = 6;
const CRITERION_KEYS = [
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'c7',
  'c8',
] as const;

type CriterionKey = (typeof CRITERION_KEYS)[number];

interface RubricScores extends Record<CriterionKey, number> {
  total: number;
  pass: boolean;
}

const rubricScoreFields = {
  c1: criterionScore,
  c2: criterionScore,
  c3: criterionScore,
  c4: criterionScore,
  c5: criterionScore,
  c6: criterionScore,
  c7: criterionScore,
  c8: criterionScore,
  total: rubricTotal,
  pass: z.boolean(),
};

function validateRubricScores(
  scores: RubricScores,
  ctx: z.RefinementCtx,
): void {
  const criteria = CRITERION_KEYS.map((key) => scores[key]);
  const total = criteria.reduce((sum, criterion) => sum + criterion, 0);
  if (scores.total !== total) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'total must be the sum of c1..c8',
      path: ['total'],
    });
  }
  const pass =
    total >= RUBRIC_PASS_TOTAL &&
    criteria.every((criterion) => criterion >= RUBRIC_PASS_MIN_CRITERION);
  if (scores.pass !== pass) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `pass must be total >= ${RUBRIC_PASS_TOTAL} with no criterion below ${RUBRIC_PASS_MIN_CRITERION}`,
      path: ['pass'],
    });
  }
}

/**
 * One committed rubric row of `skill-labels.v1.csv`. Notes about candidates are
 * user data and stay in the bench data dir, so the committed row rejects a
 * `note` key.
 */
export const rubricScoreRowSchema = z
  .strictObject({
    opaqueId: nonEmptyString,
    raterId: nonEmptyString,
    ...rubricScoreFields,
    ratedAt: isoDateTime,
  })
  .superRefine(validateRubricScores);
export type RubricScoreRow = z.infer<typeof rubricScoreRowSchema>;

/** The bench-data-dir twin of the rubric row, the only place a note may live. */
export const privateRubricScoreRowSchema = z
  .strictObject({
    opaqueId: nonEmptyString,
    raterId: nonEmptyString,
    ...rubricScoreFields,
    note: z.string().optional(),
    ratedAt: isoDateTime,
  })
  .superRefine(validateRubricScores);
export type PrivateRubricScoreRow = z.infer<typeof privateRubricScoreRowSchema>;

export const adjudicationTriggerSchema = z.enum([
  'pass-fail-differs',
  'totals-differ',
]);

/** One adjudicated disagreement row of `skill-adjudication.v1.csv`. */
export const adjudicationRowSchema = z
  .strictObject({
    opaqueId: nonEmptyString,
    adjudicatorId: nonEmptyString,
    ...rubricScoreFields,
    triggers: z.array(adjudicationTriggerSchema).min(1).max(2),
    decidedAt: isoDateTime,
  })
  .superRefine((row, ctx) => {
    if (row.triggers.length !== new Set(row.triggers).size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'triggers must not repeat',
        path: ['triggers'],
      });
    }
    validateRubricScores(row, ctx);
  });
export type AdjudicationRow = z.infer<typeof adjudicationRowSchema>;

function rejectRepeatedTriggers(
  triggers: readonly string[],
  ctx: z.RefinementCtx,
): void {
  if (triggers.length !== new Set(triggers).size) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'triggers must not repeat',
      path: ['triggers'],
    });
  }
}

const panelDecisionSchema = z.enum(['accept', 'edit', 'reject']);

function refinePanelDecision(
  row: { decision: 'accept' | 'edit' | 'reject'; replacement: string | null },
  ctx: z.RefinementCtx,
): void {
  if (row.decision === 'edit') {
    if (row.replacement === null || row.replacement.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'edit needs a replacement',
        path: ['replacement'],
      });
    }
    return;
  }
  if (row.replacement !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'accept and reject carry no replacement',
      path: ['replacement'],
    });
  }
}

/**
 * One U2 rater line. Accept is the draft unchanged; edit carries a replacement;
 * reject drops the candidate. Abstention that is accepted stays an abstention.
 */
export const panelMemoryDecisionSchema = z
  .strictObject({
    id: nonEmptyString,
    decision: panelDecisionSchema,
    replacement: z.string().nullable(),
    raterId: nonEmptyString,
    ratedAt: isoDateTime,
  })
  .superRefine(refinePanelDecision);
export type PanelMemoryDecision = z.infer<typeof panelMemoryDecisionSchema>;

export const panelMemoryAdjudicationTriggerSchema = z.enum([
  'decision-differs',
  'replacement-hash-differs',
]);

/** U2 adjudicator line: the same decision plus who settled it. */
export const panelMemoryAdjudicationSchema = z
  .strictObject({
    id: nonEmptyString,
    decision: panelDecisionSchema,
    replacement: z.string().nullable(),
    adjudicatorId: nonEmptyString,
    triggers: z.array(panelMemoryAdjudicationTriggerSchema).min(1).max(2),
    decidedAt: isoDateTime,
  })
  .superRefine((row, ctx) => {
    rejectRepeatedTriggers(row.triggers, ctx);
    refinePanelDecision(row, ctx);
  });
export type PanelMemoryAdjudication = z.infer<
  typeof panelMemoryAdjudicationSchema
>;

/** One U3 rater line. `humanMatch` is panel-labelled. */
export const panelMatcherLabelSchema = z.strictObject({
  id: nonEmptyString,
  factId: nonEmptyString,
  humanMatch: z.boolean(),
  raterId: nonEmptyString,
  ratedAt: isoDateTime,
});
export type PanelMatcherLabel = z.infer<typeof panelMatcherLabelSchema>;

export const panelMatcherAdjudicationTriggerSchema = z.enum(['match-differs']);

/** U3 adjudicator line. Boolean disagreement uses `match-differs`. */
export const panelMatcherAdjudicationSchema = z
  .strictObject({
    id: nonEmptyString,
    factId: nonEmptyString,
    humanMatch: z.boolean(),
    adjudicatorId: nonEmptyString,
    triggers: z.array(panelMatcherAdjudicationTriggerSchema).min(1).max(1),
    decidedAt: isoDateTime,
  })
  .superRefine((row, ctx) => rejectRepeatedTriggers(row.triggers, ctx));
export type PanelMatcherAdjudication = z.infer<
  typeof panelMatcherAdjudicationSchema
>;

/** One U4 session rater line, before it is stripped to `realSessionLabelSchema`. */
export const panelSessionLabelSchema = z
  .strictObject({
    opaqueId: nonEmptyString,
    sha256: sha256HexSchema,
    lineRefs: z.array(z.number().int().positive()),
    raterId: nonEmptyString,
    ratedAt: isoDateTime,
  })
  .superRefine((row, ctx) => refineSortedLineRefs(row.lineRefs, ctx));
export type PanelSessionLabel = z.infer<typeof panelSessionLabelSchema>;

export const panelSessionAdjudicationTriggerSchema = z.enum([
  'line-refs-differ',
]);

/** U4 session adjudicator line. */
export const panelSessionAdjudicationSchema = z
  .strictObject({
    opaqueId: nonEmptyString,
    sha256: sha256HexSchema,
    lineRefs: z.array(z.number().int().positive()),
    adjudicatorId: nonEmptyString,
    triggers: z.array(panelSessionAdjudicationTriggerSchema).min(1).max(1),
    decidedAt: isoDateTime,
  })
  .superRefine((row, ctx) => {
    rejectRepeatedTriggers(row.triggers, ctx);
    refineSortedLineRefs(row.lineRefs, ctx);
  });
export type PanelSessionAdjudication = z.infer<
  typeof panelSessionAdjudicationSchema
>;

/** Skill id shape shared with `triggerLabelSchema` (trigger-human-eval.ts). */
const panelSkillIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'skill id: a lower-case slug');
const panelPromptListSchema = z.array(z.string().trim().min(1)).min(1);

/** One U4 trigger rater line. Description stays on the packet, not this row. */
export const panelTriggerLabelSchema = z.strictObject({
  skillId: panelSkillIdSchema,
  shouldTrigger: panelPromptListSchema,
  nearMiss: panelPromptListSchema,
  raterId: nonEmptyString,
  ratedAt: isoDateTime,
});
export type PanelTriggerLabel = z.infer<typeof panelTriggerLabelSchema>;

export const panelTriggerAdjudicationTriggerSchema = z.enum([
  'prompt-array-hash-differs',
]);

/** U4 trigger adjudicator line. */
export const panelTriggerAdjudicationSchema = z
  .strictObject({
    skillId: panelSkillIdSchema,
    shouldTrigger: panelPromptListSchema,
    nearMiss: panelPromptListSchema,
    adjudicatorId: nonEmptyString,
    triggers: z.array(panelTriggerAdjudicationTriggerSchema).min(1).max(1),
    decidedAt: isoDateTime,
  })
  .superRefine((row, ctx) => rejectRepeatedTriggers(row.triggers, ctx));
export type PanelTriggerAdjudication = z.infer<
  typeof panelTriggerAdjudicationSchema
>;

/**
 * Committed U4 trigger row: `skillId`, `description`, `shouldTrigger`,
 * `nearMiss`, and optional `panel`. `panel` is the verified family string
 * from `modelPanelName` / `PanelEligibility.panel`
 * (`<raterA>+<raterB>; adjudicator=<family>`). It is omitted when the row
 * was not labelled by the panel. `triggerLabelSchema` is the suite parser.
 */
export const committedTriggerLabelSchema = z.strictObject({
  skillId: panelSkillIdSchema,
  description: z.string().trim().min(1),
  shouldTrigger: panelPromptListSchema,
  nearMiss: panelPromptListSchema,
  /** Verified panel spelling. Trimmed; blank is rejected. Absent means unpanelled. */
  panel: z.string().trim().min(1).optional(),
});
export type CommittedTriggerLabel = z.infer<typeof committedTriggerLabelSchema>;

/**
 * One entry of `known-failures.v1.json`. `direction` is mandatory on every
 * entry; a non-zero tolerance needs a written `toleranceReason` so a worsening
 * cannot hide inside an unexplained band.
 */
export const knownFailureDirectionSchema = z.enum([
  'higher-is-better',
  'lower-is-better',
]);

export const knownFailureEntrySchema = z
  .strictObject({
    suiteId: nonEmptyString,
    metric: nonEmptyString,
    direction: knownFailureDirectionSchema,
    recordedValue: z.number().finite(),
    tolerance: z.number().finite().min(0).default(0),
    toleranceReason: nonEmptyString.optional(),
    ledgerRow: nonEmptyString,
    since: nonEmptyString,
  })
  .superRefine((entry, ctx) => {
    if (entry.tolerance !== 0 && entry.toleranceReason === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a non-zero tolerance requires a written toleranceReason',
        path: ['toleranceReason'],
      });
    }
  });
export type KnownFailureEntry = z.infer<typeof knownFailureEntrySchema>;
