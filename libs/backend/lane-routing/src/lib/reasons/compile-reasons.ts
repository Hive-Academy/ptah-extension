/**
 * Reason compiler (Requirements 13.1-13.4).
 *
 * Pure: no clock, no I/O, no randomness. The same facts return the same
 * text. Clauses are joined with `'; '` in the order below. A value that
 * must stay inside one clause cannot contain a semicolon or a newline.
 *
 * Chosen entry (`compileChosenReason`), clauses:
 * 1. `phase <phaseId>`
 * 2. `executor <lane|subagent> <id>`
 * 3. `model <model>`
 * 4. `score <integer>`
 * 5. matrix provenance, from the cell's `source` (`seed` | `user` | `local`),
 *    never from `sourceRef` or `note`:
 *    - unknown cell: `no profile`
 *    - seed: `provenance seed, asOf <asOf>, stale <true|false>`
 *    - user: `provenance user`
 *    - local: `provenance local, sample count <n>`
 * 6. `limit state <LaneLimitState>`
 * 7. `rotation changed the choice` or `rotation did not change the choice`
 * 8. `preference changed the choice` or
 *    `preference did not change the choice`, then
 *    `, preference source <source>` when the caller passed a source
 * 9. model-sourced with a number: `model probability <digits>`;
 *    model-sourced with null: `no confidence reported`;
 *    ranking or pin: `model probability not applicable`
 * 10. `fallback cause <cause>` or `fallback cause none`
 *
 * Unavailable entry (`compileUnavailableReason`), clauses:
 * `phase`, `exclusion reason`, `pin rule <rule|none>`,
 * `disclosed fallback <true|false>`, then either `no candidate excluded`
 * or one `candidate <id> excluded by <rule>` per candidate.
 *
 * Top-level `reasons`: one element per excluded candidate
 * (`phase <id> candidate <id> excluded by <rule>`). `compileGateReasons`
 * takes `excluded` first, then any unavailable `excludedBy` pair not already
 * listed, then one `phase <id> pin unavailable, pin rule <rule>` per
 * pin-unavailable entry, then one phrase per missing input. `not-listed`
 * may name a pin that is not an input row. Every other named candidate is
 * an input row.
 *
 * `discardedModelText` and `modelProposalOption` are accepted and never
 * copied (Requirement 13.1). This function does not decide fallbacks; it
 * prints the cause it is given.
 */
import type { LaneLimitState } from '@ptah-extension/shared';
import {
  EXCLUSION_RULES,
  FALLBACK_CAUSES,
} from '../contracts/route-decide-result.schema';
import type { MatrixCell, ValueMatrixCell } from '../matrix/matrix.types';
import {
  MINIMUM_SAMPLE_COUNT,
  SCORE_MAX,
  SCORE_MIN,
} from '../routing-constants';
import { formatConfidence } from './confidence';

export const ROSTER_EXCLUSION_REASONS = [
  'no-eligible-candidate',
  'reviewer-family',
  'pin-unavailable',
] as const;

export type RosterExclusionReason = (typeof ROSTER_EXCLUSION_REASONS)[number];

export type FallbackCause = (typeof FALLBACK_CAUSES)[number];

export type ExclusionRule = (typeof EXCLUSION_RULES)[number];

export type ChoiceSource = 'model' | 'ranking' | 'pin';

export const NO_CONFIDENCE_REPORTED = 'no confidence reported';

export const MISSING_INPUTS = [
  'agent-list',
  'limits',
  'roles',
  'model-lists',
  'matrix-file',
  'outcome-history',
  'rotation-store',
] as const;

export type MissingInput = (typeof MISSING_INPUTS)[number];

/**
 * Phrases Requirement 4.5 / the failure table name in `reasons`.
 * `agent-list-unavailable` is F10. `models unknown` is the model-list
 * failure in data-flow step 4. `no outcome history` is SC-2
 * (`isPersistent() === false`). The others are F11.
 */
export const MISSING_INPUT_REASON: Readonly<Record<MissingInput, string>> = {
  'agent-list': 'agent-list-unavailable',
  limits: 'limits unavailable',
  roles: 'roles unavailable',
  'model-lists': 'models unknown',
  'matrix-file': 'matrix file unreadable',
  'outcome-history': 'no outcome history',
  'rotation-store': 'rotation store unavailable',
};

export interface ChosenExecutor {
  readonly kind: 'lane' | 'subagent';
  readonly id: string;
  readonly family: string;
  readonly cli?: string;
  readonly ptahCliId?: string;
  readonly role?: string;
}

export interface ChosenReasonFacts {
  readonly phaseId: string;
  readonly executor: ChosenExecutor;
  readonly model: string;
  readonly score: number;
  readonly source: ChoiceSource;
  readonly cell: MatrixCell;
  readonly limitState: LaneLimitState;
  readonly rotationChangedChoice: boolean;
  readonly preferenceChangedChoice: boolean;
  readonly preferenceSource?: string;
  /** Provider confidence for the chosen option. Null means none reported. */
  readonly reportedConfidence: number | null;
  readonly fallbackCause: FallbackCause | null;
  /** Free text from a structured-output model. Never copied. */
  readonly discardedModelText?: string;
  /** Model proposal label. Kept on the result object, not in the reason. */
  readonly modelProposalOption?: string;
}

export interface ChosenReasonInput extends ChosenReasonFacts {
  readonly inputRowIds: readonly string[];
}

export interface CandidateRuleFact {
  readonly candidate: string;
  readonly rule: ExclusionRule;
}

export interface UnavailableReasonFacts {
  readonly phaseId: string;
  readonly exclusionReason: RosterExclusionReason;
  readonly excludedBy: readonly CandidateRuleFact[];
  readonly pinRule: ExclusionRule | null;
  readonly needsDisclosedFallback: boolean;
  readonly source: 'pin' | 'ranking';
  readonly discardedModelText?: string;
  readonly modelProposalOption?: string;
}

export interface UnavailableReasonInput extends UnavailableReasonFacts {
  readonly inputRowIds: readonly string[];
}

export interface ExcludedCandidateFact {
  readonly phaseId: string;
  readonly candidate: string;
  readonly rule: ExclusionRule;
}

export interface PreflightAnswerFacts {
  readonly name: 'taskType' | 'depth';
  readonly source: 'model' | 'skill-table';
  readonly reportedConfidence: number | null;
  readonly fallbackCause: FallbackCause | null;
  readonly discardedModelText?: string;
  readonly modelProposalOption?: string;
}

export interface GateReasonInput {
  readonly chosen: readonly ChosenReasonFacts[];
  readonly unavailable: readonly UnavailableReasonFacts[];
  readonly excluded: readonly ExcludedCandidateFact[];
  readonly missingInputs: readonly MissingInput[];
  readonly inputRowIds: readonly string[];
}

export interface GateReasonOutput {
  readonly chosenReasons: readonly string[];
  readonly unavailableReasons: readonly string[];
  readonly reasons: readonly string[];
}

function assertToken(label: string, value: string): void {
  if (!/^\S+$/.test(value) || value.includes(';')) {
    throw new Error(`${label} must be a single token without a semicolon`);
  }
}

function assertClause(label: string, value: string): void {
  if (value.length === 0 || /[;\r\n]/.test(value)) {
    throw new Error(`${label} must not contain a semicolon or a newline`);
  }
}

function assertScore(score: number): void {
  if (!Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) {
    throw new Error(
      `score must be an integer from ${SCORE_MIN} to ${SCORE_MAX}`,
    );
  }
}

function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  return trimmed;
}

function joinClauses(clauses: readonly string[]): string {
  return clauses.join('; ');
}

function changedPhrase(changed: boolean): string {
  return changed ? 'changed the choice' : 'did not change the choice';
}

function unexpectedMatrixSource(source: never): never {
  throw new Error(`unexpected matrix source ${String(source)}`);
}

function localSampleCount(cell: ValueMatrixCell): number {
  if (cell.sampleCount === undefined) {
    throw new Error('a local matrix cell must carry sampleCount');
  }
  if (
    !Number.isInteger(cell.sampleCount) ||
    cell.sampleCount < MINIMUM_SAMPLE_COUNT
  ) {
    throw new Error(
      `a local matrix cell sampleCount must be an integer of at least ${MINIMUM_SAMPLE_COUNT}`,
    );
  }
  return cell.sampleCount;
}

function provenanceClause(cell: MatrixCell): string {
  if (cell.kind === 'unknown') {
    return 'no profile';
  }
  switch (cell.source) {
    case 'seed':
      assertToken('asOf', cell.asOf);
      return `provenance seed, asOf ${cell.asOf}, stale ${cell.stale}`;
    case 'user':
      return 'provenance user';
    case 'local':
      return `provenance local, sample count ${localSampleCount(cell)}`;
    default:
      return unexpectedMatrixSource(cell.source);
  }
}

function assertKnownCandidate(
  candidate: string,
  rule: ExclusionRule,
  inputRowIds: readonly string[],
): void {
  assertToken('candidate', candidate);
  if (rule !== 'not-listed' && !inputRowIds.includes(candidate)) {
    throw new Error(`excluded candidate ${candidate} is not an input row`);
  }
}

function modelProbabilityClause(
  source: ChoiceSource | 'skill-table',
  reportedConfidence: number | null,
): string {
  if (source !== 'model') {
    return source === 'skill-table'
      ? 'confidence not applicable'
      : 'model probability not applicable';
  }
  if (reportedConfidence === null) {
    return NO_CONFIDENCE_REPORTED;
  }
  return `model probability ${formatConfidence(reportedConfidence)}`;
}

function fallbackClause(cause: FallbackCause | null): string {
  return `fallback cause ${cause ?? 'none'}`;
}

function preferenceClause(
  changed: boolean,
  preferenceSource: string | undefined,
): string {
  const change = `preference ${changedPhrase(changed)}`;
  const source = blankToUndefined(preferenceSource);
  if (source === undefined) {
    return change;
  }
  assertClause('preference source', source);
  return `${change}, preference source ${source}`;
}

function executorClause(executor: ChosenExecutor): string {
  assertToken('executor id', executor.id);
  return `executor ${executor.kind} ${executor.id}`;
}

function assertCellScore(facts: ChosenReasonFacts): void {
  if (facts.cell.kind === 'value' && facts.cell.score !== facts.score) {
    throw new Error('chosen score must equal the matrix cell score');
  }
}

function assertDisclosedFallback(facts: UnavailableReasonFacts): void {
  const expected = facts.exclusionReason === 'reviewer-family';
  if (facts.needsDisclosedFallback !== expected) {
    throw new Error(
      'disclosed fallback is set only for exclusion reason reviewer-family',
    );
  }
}

function assertPinRule(facts: UnavailableReasonFacts): void {
  if (facts.exclusionReason === 'pin-unavailable') {
    if (facts.pinRule === null) {
      throw new Error('pin-unavailable requires a pin rule');
    }
    return;
  }
  if (facts.pinRule !== null) {
    throw new Error('pin rule is set only for pin-unavailable');
  }
}

function uniqueMissing(inputs: readonly MissingInput[]): MissingInput[] {
  const seen = new Set<MissingInput>();
  const unique: MissingInput[] = [];
  for (const input of inputs) {
    if (seen.has(input)) {
      continue;
    }
    seen.add(input);
    unique.push(input);
  }
  return unique;
}

export function compileChosenReason(input: ChosenReasonInput): string {
  assertToken('phase id', input.phaseId);
  assertClause('model', input.model);
  assertScore(input.score);
  assertCellScore(input);
  if (!input.inputRowIds.includes(input.executor.id)) {
    throw new Error(`chosen executor ${input.executor.id} is not an input row`);
  }
  return joinClauses([
    `phase ${input.phaseId}`,
    executorClause(input.executor),
    `model ${input.model}`,
    `score ${input.score}`,
    provenanceClause(input.cell),
    `limit state ${input.limitState}`,
    `rotation ${changedPhrase(input.rotationChangedChoice)}`,
    preferenceClause(input.preferenceChangedChoice, input.preferenceSource),
    modelProbabilityClause(input.source, input.reportedConfidence),
    fallbackClause(input.fallbackCause),
  ]);
}

export function compileUnavailableReason(
  input: UnavailableReasonInput,
): string {
  assertToken('phase id', input.phaseId);
  assertPinRule(input);
  assertDisclosedFallback(input);
  const candidateClauses =
    input.excludedBy.length === 0
      ? ['no candidate excluded']
      : input.excludedBy.map((fact) => {
          assertKnownCandidate(fact.candidate, fact.rule, input.inputRowIds);
          return `candidate ${fact.candidate} excluded by ${fact.rule}`;
        });
  return joinClauses([
    `phase ${input.phaseId}`,
    `exclusion reason ${input.exclusionReason}`,
    `pin rule ${input.pinRule ?? 'none'}`,
    `disclosed fallback ${input.needsDisclosedFallback}`,
    ...candidateClauses,
  ]);
}

export function compileResultReasons(input: {
  readonly excluded: readonly ExcludedCandidateFact[];
  readonly missingInputs: readonly MissingInput[];
  readonly inputRowIds: readonly string[];
}): readonly string[] {
  const reasons: string[] = [];
  for (const fact of input.excluded) {
    assertToken('phase id', fact.phaseId);
    assertKnownCandidate(fact.candidate, fact.rule, input.inputRowIds);
    reasons.push(
      `phase ${fact.phaseId} candidate ${fact.candidate} excluded by ${fact.rule}`,
    );
  }
  for (const missing of uniqueMissing(input.missingInputs)) {
    reasons.push(MISSING_INPUT_REASON[missing]);
  }
  return reasons;
}

export function compilePreflightReasons(input: {
  readonly answers: readonly PreflightAnswerFacts[];
  readonly missingInputs: readonly MissingInput[];
}): readonly string[] {
  const reasons: string[] = [];
  for (const answer of input.answers) {
    assertToken('answer name', answer.name);
    reasons.push(
      joinClauses([
        `${answer.name} source ${answer.source}`,
        modelProbabilityClause(answer.source, answer.reportedConfidence),
        fallbackClause(answer.fallbackCause),
      ]),
    );
  }
  for (const missing of uniqueMissing(input.missingInputs)) {
    reasons.push(MISSING_INPUT_REASON[missing]);
  }
  return reasons;
}

function excludedKey(fact: ExcludedCandidateFact): string {
  return `${fact.phaseId}\u0000${fact.candidate}\u0000${fact.rule}`;
}

/**
 * Top-level lines list `excluded` first, then any unavailable `excludedBy`
 * pair that is not already there, then one pin-unavailable line per such
 * entry, then missing inputs. A pair passed both ways is listed once.
 */
export function compileGateReasons(input: GateReasonInput): GateReasonOutput {
  const chosenReasons = input.chosen.map((facts) =>
    compileChosenReason({ ...facts, inputRowIds: input.inputRowIds }),
  );
  const unavailableReasons = input.unavailable.map((facts) =>
    compileUnavailableReason({ ...facts, inputRowIds: input.inputRowIds }),
  );
  const excluded: ExcludedCandidateFact[] = [];
  const seen = new Set<string>();
  const pushExcluded = (fact: ExcludedCandidateFact): void => {
    const key = excludedKey(fact);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    excluded.push(fact);
  };
  for (const fact of input.excluded) {
    pushExcluded(fact);
  }
  for (const entry of input.unavailable) {
    for (const fact of entry.excludedBy) {
      pushExcluded({
        phaseId: entry.phaseId,
        candidate: fact.candidate,
        rule: fact.rule,
      });
    }
  }
  const reasons: string[] = [
    ...compileResultReasons({
      excluded,
      missingInputs: [],
      inputRowIds: input.inputRowIds,
    }),
  ];
  for (const entry of input.unavailable) {
    if (entry.exclusionReason === 'pin-unavailable' && entry.pinRule !== null) {
      assertToken('phase id', entry.phaseId);
      reasons.push(
        `phase ${entry.phaseId} pin unavailable, pin rule ${entry.pinRule}`,
      );
    }
  }
  for (const missing of uniqueMissing(input.missingInputs)) {
    reasons.push(MISSING_INPUT_REASON[missing]);
  }
  return { chosenReasons, unavailableReasons, reasons };
}
