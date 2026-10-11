/**
 * Model-panel ground truth for U1–U4 (design addendum, Part B).
 *
 * A lane is its resolved model family, never its CLI name. The panel is two
 * distinct non-OpenAI rater families plus an adjudicator from a third family.
 * Invalid or declined output is `unresolved-model-panel` and stays in the
 * frozen-population denominator. More than 10% unresolved marks the activity
 * ground-truth-untrusted.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  CODEX_DEFAULT_TIERS,
  COPILOT_DEFAULT_TIERS,
  OPENCODE_GO_DEFAULT_TIERS,
  OPENCODE_MODEL_ROUTES,
  OPENCODE_ZEN_DEFAULT_TIERS,
  isOpenCodeProviderId,
} from '@ptah-extension/shared';

import type { GroundTruthMethod } from '../../scorecard/suite-kinds';
import {
  abstentionCaseSchema,
  committedTriggerLabelSchema,
  factSchema,
  matcherSampleRowSchema,
  mergePairSchema,
  realSessionLabelSchema,
  rubricScoreRowSchema,
  sha256HexSchema,
  temporalCaseSchema,
  updateCaseSchema,
  type AbstentionCase,
  type CommittedTriggerLabel,
  type Fact,
  type MatcherSampleRow,
  type MergePair,
  type PanelMatcherAdjudication,
  type PanelMatcherLabel,
  type PanelMemoryAdjudication,
  type PanelMemoryDecision,
  type PanelSessionAdjudication,
  type PanelSessionLabel,
  type PanelTriggerAdjudication,
  type PanelTriggerLabel,
  type RealSessionLabel,
  type RubricScoreRow,
  type TemporalCase,
  type UpdateCase,
} from '../ground-truth/label-schemas';

/** Exclusion recorded on a second invalid or declined answer. */
export const PANEL_UNRESOLVED_REASON = 'unresolved-model-panel' as const;

/**
 * More than this share of the frozen population is ground-truth-untrusted.
 * Exactly 10% stays trusted. Compared as `unresolved * 10 > population`.
 */
export const PANEL_UNRESOLVED_SHARE_CAP = 0.1;

/** Committed U1 columns. Headerless panel CSV uses the same order. */
export const RUBRIC_PANEL_COLUMNS = [
  'opaqueId',
  'raterId',
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'c7',
  'c8',
  'total',
  'pass',
  'ratedAt',
] as const;

const INTEGER_COLUMNS = new Set<string>([
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'c7',
  'c8',
  'total',
]);

export class PanelImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PanelImportError';
  }
}

/** One rater or the adjudicator, identified by the resolved model family. */
export interface PanelLaneIdentity {
  readonly raterId: string;
  /** Declared family. Must match the family derived from provider and model. */
  readonly family: string;
  readonly provider: string;
  readonly model: string;
  /**
   * Ignored. Two CLIs of one family are one family; one CLI name on two
   * families does not make them the same lane.
   */
  readonly cliName?: string;
}

export interface PanelEligibilityInput {
  readonly raters: readonly [PanelLaneIdentity, PanelLaneIdentity];
  readonly adjudicator: PanelLaneIdentity;
}

export type PanelEligibility =
  | {
      readonly ok: true;
      /** 619 `GroundTruthMethod` token. The family spelling is `panel`. */
      readonly method: 'model-panel';
      /** `<raterA>+<raterB>; adjudicator=<family>`, in verified rater order. */
      readonly panel: string;
      readonly raterCount: 2;
      readonly families: readonly [string, string];
      readonly adjudicatorFamily: string;
    }
  | { readonly ok: false; readonly reason: string };

/** One lane entry of the private panel manifest. */
export const panelLaneManifestSchema = z.strictObject({
  raterId: z.string().min(1),
  family: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  promptSha256: sha256HexSchema,
  packetCount: z.number().int().nonnegative(),
  responseCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});
export type PanelLaneManifest = z.infer<typeof panelLaneManifestSchema>;

/**
 * Private manifest: two raters, one adjudicator, and the unresolved share of
 * the frozen population. `unresolvedShare` must equal the count ratio.
 */
export const panelManifestSchema = z
  .strictObject({
    raters: z.tuple([panelLaneManifestSchema, panelLaneManifestSchema]),
    adjudicator: panelLaneManifestSchema,
    population: z.number().int().positive(),
    unresolvedCount: z.number().int().nonnegative(),
    unresolvedShare: z.number().min(0).max(1),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.unresolvedCount > manifest.population) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unresolvedCount cannot exceed the frozen population',
        path: ['unresolvedCount'],
      });
    } else if (
      manifest.unresolvedShare !==
      manifest.unresolvedCount / manifest.population
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'unresolvedShare must be unresolvedCount / population',
        path: ['unresolvedShare'],
      });
    }
    const eligibility = evaluatePanelEligibility(manifest);
    if (!eligibility.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: eligibility.reason,
        path: ['raters'],
      });
    }
  });
export type PanelManifest = z.infer<typeof panelManifestSchema>;

export interface PanelImportResult<T> {
  readonly rows: readonly T[];
  readonly unresolvedIds: readonly string[];
  readonly population: number;
  readonly unresolvedCount: number;
  readonly unresolvedShare: number;
  readonly trusted: boolean;
  /** Set when the unresolved share is more than 10%. */
  readonly untrustedReason: string | null;
}

export interface UnresolvedExclusion {
  readonly share: number;
  readonly trusted: boolean;
  readonly untrustedReason: string | null;
}

export type MemoryDraftKind =
  'fact' | 'merge' | 'update' | 'temporal' | 'abstention';

export type MemoryPanelImport =
  | {
      readonly status: 'accepted';
      readonly kind: 'fact';
      readonly row: Fact;
    }
  | {
      readonly status: 'accepted';
      readonly kind: 'merge';
      readonly row: MergePair;
    }
  | {
      readonly status: 'accepted';
      readonly kind: 'update';
      readonly row: UpdateCase;
    }
  | {
      readonly status: 'accepted';
      readonly kind: 'temporal';
      readonly row: TemporalCase;
    }
  | { readonly status: 'excluded'; readonly reason: 'reject' }
  | {
      readonly status: 'excluded';
      readonly reason: 'accepted-abstention';
      readonly row: AbstentionCase;
    };

type PanelMemoryLabel = PanelMemoryDecision | PanelMemoryAdjudication;

/**
 * `<raterFamilyA>+<raterFamilyB>; adjudicator=<family>`.
 * Families are the spellings the caller verified, in rater order.
 * This is `groundTruth.panel`, not the method token.
 */
export function modelPanelName(
  raterFamilyA: string,
  raterFamilyB: string,
  adjudicatorFamily: string,
): string {
  return `${raterFamilyA}+${raterFamilyB}; adjudicator=${adjudicatorFamily}`;
}

type TierName = 'sonnet' | 'opus' | 'haiku';

/**
 * Bare tier aliases from the provider registry. OpenCode, Codex, and Copilot
 * use the exported tables. The others are the registry `defaultTiers`.
 */
const TIER_ALIASES: Readonly<
  Record<string, Readonly<Record<TierName, string>>>
> = {
  'opencode-zen': OPENCODE_ZEN_DEFAULT_TIERS,
  'opencode-go': OPENCODE_GO_DEFAULT_TIERS,
  'openai-codex': CODEX_DEFAULT_TIERS,
  codex: CODEX_DEFAULT_TIERS,
  'github-copilot': COPILOT_DEFAULT_TIERS,
  'z-ai': { sonnet: 'glm-5.1', opus: 'glm-5.2', haiku: 'glm-4.7-flashx' },
  moonshot: {
    sonnet: 'kimi-k2.6',
    opus: 'kimi-k2.7-code',
    haiku: 'kimi-k2.5',
  },
  'claude-cli': {
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-8',
    haiku: 'claude-haiku-4-5',
  },
  anthropic: {
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-8',
    haiku: 'claude-haiku-4-5',
  },
};

const MODEL_FAMILIES: readonly (readonly [RegExp, string])[] = [
  [/^grok(?:$|[-.])/, 'xAI'],
  [/^gemini(?:$|[-.])/, 'Google'],
  [/^claude(?:$|[-.])/, 'Anthropic'],
  [/^glm(?:$|[-.])/, 'GLM'],
  [/^deepseek(?:$|[-.])/, 'DeepSeek'],
  [/^kimi(?:$|[-.])/, 'Moonshot'],
  [/^qwen(?:$|[-.]|\d)/, 'Qwen'],
  [/^minimax(?:$|[-.])/, 'MiniMax'],
];

export interface ResolvedPanelModel {
  readonly provider: string;
  readonly modelId: string;
  readonly family: string;
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/** OpenAI, Codex, gpt-*, and o-series identifiers (`o1`, `o3`, `o4-mini`). */
export function isOpenAiFamily(value: string): boolean {
  const normalized = normalizeToken(value);
  if (
    normalized === 'openai' ||
    normalized.startsWith('openai-') ||
    normalized.startsWith('openai/')
  ) {
    return true;
  }
  if (
    normalized === 'codex' ||
    normalized.startsWith('codex-') ||
    normalized.endsWith('-codex') ||
    normalized.includes('-codex-')
  ) {
    return true;
  }
  if (normalized.startsWith('gpt-') || normalized.startsWith('gpt/')) {
    return true;
  }
  return /^o\d+(?:$|[.-])/.test(normalized);
}

function familyFromModel(modelId: string): string | null {
  const normalized = normalizeToken(modelId);
  if (isOpenAiFamily(normalized)) return 'OpenAI';
  for (const [pattern, family] of MODEL_FAMILIES) {
    if (pattern.test(normalized)) return family;
  }
  return null;
}

/**
 * Canonical family of a lane. Tier aliases resolve first, then an OpenCode
 * route must name the model. Unknown provider/model pairs are ineligible.
 */
export function resolveCanonicalFamily(
  provider: string,
  model: string,
): ResolvedPanelModel | null {
  const providerId = normalizeToken(provider);
  let modelId = model.trim();
  const tier = normalizeToken(modelId);
  if (tier === 'sonnet' || tier === 'opus' || tier === 'haiku') {
    const table = TIER_ALIASES[providerId];
    const resolved = table?.[tier];
    if (resolved === undefined) return null;
    modelId = resolved;
  }
  if (isOpenCodeProviderId(providerId)) {
    const routes = OPENCODE_MODEL_ROUTES[providerId];
    if (!Object.hasOwn(routes, modelId)) {
      if (isOpenAiFamily(providerId) || isOpenAiFamily(modelId)) {
        return { provider: providerId, modelId, family: 'OpenAI' };
      }
      return null;
    }
  }
  if (isOpenAiFamily(providerId) || isOpenAiFamily(modelId)) {
    return { provider: providerId, modelId, family: 'OpenAI' };
  }
  const family = familyFromModel(modelId);
  if (family === null) return null;
  return { provider: providerId, modelId, family };
}

function familyKey(family: string): string {
  return normalizeToken(family);
}

function resolveLane(
  lane: PanelLaneIdentity,
):
  | { readonly ok: true; readonly family: string }
  | { readonly ok: false; readonly reason: string } {
  const resolved = resolveCanonicalFamily(lane.provider, lane.model);
  if (resolved === null) {
    return {
      ok: false,
      reason: `lane ${lane.raterId} is ineligible: ${lane.provider}/${lane.model} does not resolve to a known family`,
    };
  }
  if (resolved.family === 'OpenAI') {
    return {
      ok: false,
      reason: `OpenAI-family lane ${lane.raterId} cannot label or adjudicate (resolved ${resolved.provider}/${resolved.modelId})`,
    };
  }
  if (familyKey(lane.family) !== familyKey(resolved.family)) {
    return {
      ok: false,
      reason: `declared family ${lane.family} disagrees with resolved family ${resolved.family} (${resolved.provider}/${resolved.modelId})`,
    };
  }
  return { ok: true, family: resolved.family };
}

/** Two distinct non-OpenAI rater families and a third-family adjudicator. */
export function evaluatePanelEligibility(
  input: PanelEligibilityInput,
): PanelEligibility {
  const [left, right] = input.raters;
  const resolved = [left, right, input.adjudicator].map(resolveLane);
  const failed = resolved.find((lane) => !lane.ok);
  if (failed !== undefined && !failed.ok) {
    return failed;
  }
  const families = resolved.map((lane) => (lane.ok ? lane.family : '')) as [
    string,
    string,
    string,
  ];
  if (familyKey(families[0]) === familyKey(families[1])) {
    return {
      ok: false,
      reason: `two raters share one family (${families[0]})`,
    };
  }
  if (
    familyKey(families[2]) === familyKey(families[0]) ||
    familyKey(families[2]) === familyKey(families[1])
  ) {
    return {
      ok: false,
      reason: `adjudicator family ${families[2]} shares a rater family`,
    };
  }
  return {
    ok: true,
    method: 'model-panel' satisfies GroundTruthMethod,
    panel: modelPanelName(families[0], families[1], families[2]),
    raterCount: 2,
    families: [families[0], families[1]],
    adjudicatorFamily: families[2],
  };
}

/** Unresolved items stay in the denominator. More than 10% is untrusted. */
export function unresolvedExclusion(
  population: number,
  unresolvedCount: number,
): UnresolvedExclusion {
  if (!Number.isInteger(population) || population < 1) {
    throw new PanelImportError('frozen population must be a positive integer');
  }
  if (
    !Number.isInteger(unresolvedCount) ||
    unresolvedCount < 0 ||
    unresolvedCount > population
  ) {
    throw new PanelImportError(
      'unresolved count must be an integer inside the frozen population',
    );
  }
  const share = unresolvedCount / population;
  const exceeds = unresolvedCount * 10 > population;
  return {
    share,
    trusted: !exceeds,
    untrustedReason: exceeds
      ? `ground-truth-untrusted: ${PANEL_UNRESOLVED_REASON} ${unresolvedCount}/${population} exceeds ${PANEL_UNRESOLVED_SHARE_CAP}`
      : null,
  };
}

export function importRubricPanelCsv(
  text: string,
  population: number,
): PanelImportResult<RubricScoreRow> {
  const lines = contentLines(text);
  const [first, ...rest] = lines;
  const data = first === RUBRIC_PANEL_COLUMNS.join(',') ? rest : lines;
  const attempts: Attempt<RubricScoreRow>[] = data.map((line, index) =>
    rubricAttempt(line, index + 1),
  );
  return finishImport(attempts, population);
}

export function importPanelJsonl<T>(
  text: string,
  schema: z.ZodType<T>,
  population: number,
  idOf: (row: T) => string,
): PanelImportResult<T> {
  const seen = new Set<string>();
  const attempts = contentLines(text).map((line, index) =>
    jsonlAttempt(line, index + 1, schema, idOf, seen),
  );
  return finishImport(attempts, population);
}

export function memoryAdjudicationTriggers(
  left: PanelMemoryDecision,
  right: PanelMemoryDecision,
): PanelMemoryAdjudication['triggers'] {
  const triggers: PanelMemoryAdjudication['triggers'][number][] = [];
  if (left.decision !== right.decision) triggers.push('decision-differs');
  if (
    replacementHash(left.replacement) !== replacementHash(right.replacement)
  ) {
    triggers.push('replacement-hash-differs');
  }
  return triggers;
}

export function matcherAdjudicationTriggers(
  left: PanelMatcherLabel,
  right: PanelMatcherLabel,
): PanelMatcherAdjudication['triggers'] {
  return left.humanMatch === right.humanMatch ? [] : ['match-differs'];
}

export function sessionAdjudicationTriggers(
  left: PanelSessionLabel,
  right: PanelSessionLabel,
): PanelSessionAdjudication['triggers'] {
  return JSON.stringify(left.lineRefs) === JSON.stringify(right.lineRefs)
    ? []
    : ['line-refs-differ'];
}

export function triggerAdjudicationTriggers(
  left: PanelTriggerLabel,
  right: PanelTriggerLabel,
): PanelTriggerAdjudication['triggers'] {
  const same =
    promptHash(left.shouldTrigger) === promptHash(right.shouldTrigger) &&
    promptHash(left.nearMiss) === promptHash(right.nearMiss);
  return same ? [] : ['prompt-array-hash-differs'];
}

/** Stamp a validated decision onto a draft and parse the committed schema. */
export function importMemoryPanelRow(
  kind: MemoryDraftKind,
  draft: Record<string, unknown>,
  decision: PanelMemoryLabel,
): MemoryPanelImport {
  if (decision.decision === 'reject') {
    return { status: 'excluded', reason: 'reject' };
  }
  const stamped = {
    ...(decision.decision === 'edit'
      ? withReplacement(kind, draft, decision.replacement ?? '')
      : { ...draft }),
    ...labelStamp(decision),
  };
  switch (kind) {
    case 'fact':
      return { status: 'accepted', kind, row: factSchema.parse(stamped) };
    case 'merge':
      return { status: 'accepted', kind, row: mergePairSchema.parse(stamped) };
    case 'update':
      return {
        status: 'accepted',
        kind,
        row: updateCaseSchema.parse(stamped),
      };
    case 'temporal':
      return {
        status: 'accepted',
        kind,
        row: temporalCaseSchema.parse(stamped),
      };
    case 'abstention':
      return {
        status: 'excluded',
        reason: 'accepted-abstention',
        row: abstentionCaseSchema.parse(stamped),
      };
  }
}

export function toMatcherSampleRow(
  label: PanelMatcherLabel | PanelMatcherAdjudication,
  packet: { subject: string; content: string; chunk: string },
): MatcherSampleRow {
  return matcherSampleRowSchema.parse({
    id: label.id,
    factId: label.factId,
    subject: packet.subject,
    content: packet.content,
    chunk: packet.chunk,
    humanMatch: label.humanMatch,
    ...labelStamp(label),
  });
}

export function toRealSessionLabel(
  label: PanelSessionLabel | PanelSessionAdjudication,
): RealSessionLabel {
  return realSessionLabelSchema.parse({
    opaqueId: label.opaqueId,
    sha256: label.sha256,
    lineRefs: label.lineRefs,
  });
}

/**
 * Commit one U4 trigger row. `panel` is the verified `PanelEligibility.panel`
 * (`modelPanelName` spelling) when the import comes from an eligible panel,
 * and `undefined` otherwise. A free-form family list is not assembled here.
 * The field is written only when `panel` is defined.
 */
export function toCommittedTriggerLabel(
  label: PanelTriggerLabel | PanelTriggerAdjudication,
  description: string,
  panel: string | undefined,
): CommittedTriggerLabel {
  return committedTriggerLabelSchema.parse({
    skillId: label.skillId,
    description,
    shouldTrigger: label.shouldTrigger,
    nearMiss: label.nearMiss,
    ...(panel === undefined ? {} : { panel }),
  });
}

function labelStamp(
  label:
    | PanelMemoryLabel
    | PanelMatcherLabel
    | PanelMatcherAdjudication
    | PanelSessionLabel
    | PanelSessionAdjudication,
): { labeller: string; labelledAt: string } {
  if ('adjudicatorId' in label) {
    return { labeller: label.adjudicatorId, labelledAt: label.decidedAt };
  }
  return { labeller: label.raterId, labelledAt: label.ratedAt };
}

function withReplacement(
  kind: MemoryDraftKind,
  draft: Record<string, unknown>,
  replacement: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...draft };
  if (kind === 'fact' || kind === 'abstention') {
    next['statement'] = replacement;
    return next;
  }
  if (kind === 'update' || kind === 'temporal') {
    next['expectedAnswer'] = replacement;
    return next;
  }
  const statements = mergeStatements(replacement);
  next['left'] = {
    ...recordField(draft['left'], 'merge.left'),
    statement: statements.left,
  };
  next['right'] = {
    ...recordField(draft['right'], 'merge.right'),
    statement: statements.right,
  };
  return next;
}

function mergeStatements(replacement: string): { left: string; right: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(replacement) as unknown;
  } catch {
    throw new PanelImportError(
      'a merge edit replacement must be JSON {"left":string,"right":string}',
    );
  }
  const record = recordField(parsed, 'merge replacement');
  const left = record['left'];
  const right = record['right'];
  if (typeof left !== 'string' || left.trim() === '') {
    throw new PanelImportError(
      'a merge edit replacement must be JSON {"left":string,"right":string}',
    );
  }
  if (typeof right !== 'string' || right.trim() === '') {
    throw new PanelImportError(
      'a merge edit replacement must be JSON {"left":string,"right":string}',
    );
  }
  return { left, right };
}

function recordField(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PanelImportError(`${label} must be an object`);
  }
  return { ...(value as Record<string, unknown>) };
}

function replacementHash(value: string | null): string {
  return sha256Hex(value === null ? 'null' : `str:${value}`);
}

function promptHash(prompts: readonly string[]): string {
  return sha256Hex(JSON.stringify(prompts));
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface Attempt<T> {
  readonly id: string;
  readonly row?: T;
}

function finishImport<T>(
  attempts: readonly Attempt<T>[],
  population: number,
): PanelImportResult<T> {
  if (!Number.isInteger(population) || population < 1) {
    throw new PanelImportError('frozen population must be a positive integer');
  }
  if (attempts.length > population) {
    throw new PanelImportError(
      `panel returned ${attempts.length} rows for a frozen population of ${population}`,
    );
  }
  const unresolvedIds = attempts
    .filter((attempt) => attempt.row === undefined)
    .map((attempt) => attempt.id);
  const missing = population - attempts.length;
  for (let index = 0; index < missing; index += 1) {
    unresolvedIds.push(`missing-${index + 1}`);
  }
  const exclusion = unresolvedExclusion(population, unresolvedIds.length);
  return {
    rows: attempts.flatMap((attempt) =>
      attempt.row === undefined ? [] : [attempt.row],
    ),
    unresolvedIds,
    population,
    unresolvedCount: unresolvedIds.length,
    unresolvedShare: exclusion.share,
    trusted: exclusion.trusted,
    untrustedReason: exclusion.untrustedReason,
  };
}

function contentLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function rubricAttempt(
  line: string,
  lineNumber: number,
): Attempt<RubricScoreRow> {
  const fallback = `line-${lineNumber}`;
  if (line.toLowerCase() === 'declined') return { id: fallback };
  if (line.includes('"')) return { id: fallback };
  const cells = line.split(',').map((cell) => cell.trim());
  if (cells.length !== RUBRIC_PANEL_COLUMNS.length) {
    return { id: cells[0] || fallback };
  }
  const record: Record<string, unknown> = {};
  for (let index = 0; index < cells.length; index += 1) {
    const column = RUBRIC_PANEL_COLUMNS[index];
    const cell = cells[index];
    if (INTEGER_COLUMNS.has(column)) {
      if (!/^\d+$/.test(cell)) return { id: cells[0] || fallback };
      record[column] = Number(cell);
    } else if (column === 'pass') {
      if (cell !== 'true' && cell !== 'false')
        return { id: cells[0] || fallback };
      record[column] = cell === 'true';
    } else {
      record[column] = cell;
    }
  }
  const parsed = rubricScoreRowSchema.safeParse(record);
  if (!parsed.success) return { id: cells[0] || fallback };
  return { id: parsed.data.opaqueId, row: parsed.data };
}

function jsonlAttempt<T>(
  line: string,
  lineNumber: number,
  schema: z.ZodType<T>,
  idOf: (row: T) => string,
  seen: Set<string>,
): Attempt<T> {
  const fallback = `line-${lineNumber}`;
  if (line.toLowerCase() === 'declined') return { id: fallback };
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    return { id: fallback };
  }
  const declined = declinedId(value);
  if (declined !== null) return { id: declined || fallback };
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { id: rawId(value) ?? fallback };
  const id = idOf(parsed.data);
  if (seen.has(id)) return { id };
  seen.add(id);
  return { id, row: parsed.data };
}

function declinedId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const declined =
    record['declined'] === true ||
    record['status'] === 'declined' ||
    record['decision'] === 'declined';
  if (!declined) return null;
  return rawId(value) ?? '';
}

function rawId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = record['id'] ?? record['opaqueId'] ?? record['skillId'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}
