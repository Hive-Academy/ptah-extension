import {
  formatDurationMs,
  formatUsdCost,
  type TurnChangeSet,
  type TurnChangeSetFile,
  type TurnSourceSnapshot,
  type TurnTestOutcome,
  type TurnTestRun,
  type TurnTestSummary,
} from '@ptah-extension/shared';
import { formatFileCounts } from '../change-set/change-set-card.component';

/**
 * Host-built turn summary model (TASK_2026_623, component 6; R6.1-R6.4, R6.6,
 * R6.8). Pure: no Angular, no store, no renderer. The summary chip in chat
 * and the panel's summary cards both read it.
 *
 * Every card value equals what the `$diff`, `$tests` and `$usage` sources
 * resolve to for the same snapshot (`ptah-ui-resolver.ts` `scalarValue`), so
 * an agent block and the host summary never disagree about a turn.
 */

/** A value a turn source could not produce, spelled as the resolver spells it. */
export type TurnSummaryUnavailable = 'unavailable' | 'pending';

/**
 * What the current git status says about the turn's files, passed in as
 * plain data. Structurally the chat store's `ChangeSetMarks`
 * (`change-set.store.ts:53-58`), which chat-ui cannot import.
 */
export interface TurnSummaryMarks {
  /** Files absent from the current status: no longer changed against HEAD. */
  readonly reconciled: ReadonlySet<string>;
  /** Files the current status reports as unmerged (`U`). */
  readonly conflicted: ReadonlySet<string>;
}

/** How one file row presents. Precedence: conflicted, then reconciled. */
export type TurnSummaryFileState = 'changed' | 'conflicted' | 'reconciled';

export interface TurnSummaryFileRow {
  readonly file: TurnChangeSetFile;
  readonly state: TurnSummaryFileState;
  /** `+N −N`, `binary`, or `?`: the change-set card's own formatter. */
  readonly counts: string;
}

/** Files card: the change-set card's capabilities (parity section 2). */
export interface TurnSummaryFilesCard {
  readonly kind: 'files';
  /** `$diff.files`: the file count, or `unavailable` when counts are unavailable. */
  readonly value: number | TurnSummaryUnavailable;
  /** The set the Open file and Review actions take (R6.8). */
  readonly changeSet: TurnChangeSet;
  /** Every stored file in recorded order, with its state and counts text. */
  readonly rows: readonly TurnSummaryFileRow[];
  readonly conflictedCount: number;
  readonly reconciledCount: number;
  /** Changed files past the stored bound ("+N more files not listed"). */
  readonly truncatedCount: number;
  readonly countsUnavailable: boolean;
  readonly baselineMissing: boolean;
}

/** Lines card: `$diff.additions` / `$diff.deletions`. */
export interface TurnSummaryLinesCard {
  readonly kind: 'lines';
  readonly additions: number | TurnSummaryUnavailable;
  readonly deletions: number | TurnSummaryUnavailable;
  readonly countsUnavailable: boolean;
}

/** Tokens card: `$usage.input` / `$usage.output`. */
export interface TurnSummaryTokensCard {
  readonly kind: 'tokens';
  readonly input: number | TurnSummaryUnavailable;
  readonly output: number | TurnSummaryUnavailable;
}

/** Cost card: `$usage.cost`, a USD string or `unavailable`; never a made-up `$0`. */
export interface TurnSummaryCostCard {
  readonly kind: 'cost';
  readonly value: string;
}

/** Duration card: `$usage.duration`, formatted elapsed time. */
export interface TurnSummaryDurationCard {
  readonly kind: 'duration';
  readonly value: string;
}

/** `success` passed, `error` failed, `info` running, `muted` unknown. */
export type TurnSummaryTestTone = 'success' | 'error' | 'info' | 'muted';

/** One test run as the Tests card lists it (parity section 1 run rows). */
export interface TurnSummaryTestRow {
  readonly command: string;
  readonly project?: string;
  readonly outcome: TurnTestOutcome;
  /** The run label: the Nx project, or the outcome word when there is none. */
  readonly label: string;
  /** The outcome as words, for the icon's accessible name. */
  readonly outcomeName: string;
  /**
   * The colour cue riding along with the outcome word (never colour alone),
   * precomputed per outcome as the tests row did (`TTR:39-44`).
   */
  readonly tone: TurnSummaryTestTone;
  /** Up to five failure lines, as the matcher kept them. */
  readonly failures: readonly string[];
}

/** Tests card: `$tests` counts plus every tests-row capability (parity section 1). */
export interface TurnSummaryTestsCard {
  readonly kind: 'tests';
  /** `$tests.total` / `.passed` / `.failed` / `.unknown`, plus `running`. */
  readonly summary: TurnTestSummary;
  /** "2 passed, 1 failed", or just "unknown" when nothing resolved. */
  readonly label: string;
  /** "Tests: 2 passed, 1 failed", with " (incomplete)" for an aborted turn. */
  readonly ariaLabel: string;
  /**
   * `bad` when a run failed, so a stat reading the card shows the error fill
   * (decision #51); `good` otherwise.
   */
  readonly polarity: 'good' | 'bad';
  readonly runs: readonly TurnSummaryTestRow[];
}

export type TurnSummaryCard =
  | TurnSummaryFilesCard
  | TurnSummaryLinesCard
  | TurnSummaryTokensCard
  | TurnSummaryCostCard
  | TurnSummaryDurationCard
  | TurnSummaryTestsCard;

export interface TurnSummaryModel {
  /** The turn aborted or errored before it finished (R6.3 "incomplete"). */
  readonly incomplete: boolean;
  /** A test run is still running in the background (R6.3 "running"). */
  readonly testsInBackground: boolean;
  /** `null` when the turn changed no files: the card is omitted (R6.4). */
  readonly files: TurnSummaryFilesCard | null;
  /** Omitted together with Files: a turn with no files has no lines to show. */
  readonly lines: TurnSummaryLinesCard | null;
  readonly tokens: TurnSummaryTokensCard;
  readonly cost: TurnSummaryCostCard;
  readonly duration: TurnSummaryDurationCard;
  /** `null` when the turn ran no test command: the card is omitted (R6.4). */
  readonly tests: TurnSummaryTestsCard | null;
  /** The present cards in display order: Files, Lines, Tokens, Cost, Duration, Tests. */
  readonly cards: readonly TurnSummaryCard[];
}

const NO_MARKS: TurnSummaryMarks = Object.freeze({
  reconciled: new Set<string>(),
  conflicted: new Set<string>(),
});

/** The run icon's accessible name per outcome (tests row `TTR:119-148`). */
const OUTCOME_NAME: Readonly<Record<TurnTestOutcome, string>> = {
  passed: 'passed',
  failed: 'failed',
  running: 'running in background',
  unknown: 'unknown',
};

const OUTCOME_TONE: Readonly<Record<TurnTestOutcome, TurnSummaryTestTone>> = {
  passed: 'success',
  failed: 'error',
  running: 'info',
  unknown: 'muted',
};

/**
 * The tests outcome as text (ported from the tests row, `TTR:211-223`):
 * every category present is counted, and a list where nothing resolved is
 * just "unknown" — the run rows carry the detail there.
 */
export function turnTestsOutcomeLabel(summary: TurnTestSummary): string {
  const { passed, failed, running, unknown } = summary;
  const parts: string[] = [];
  if (passed > 0) parts.push(`${passed} passed`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (running > 0) parts.push(`${running} running in background`);
  if (unknown > 0) {
    parts.push(
      passed === 0 && failed === 0 && running === 0
        ? 'unknown'
        : `${unknown} unknown`,
    );
  }
  return parts.join(', ');
}

function rowState(path: string, marks: TurnSummaryMarks): TurnSummaryFileState {
  if (marks.conflicted.has(path)) return 'conflicted';
  if (marks.reconciled.has(path)) return 'reconciled';
  return 'changed';
}

function hasFiles(changeSet: TurnChangeSet): boolean {
  return (
    changeSet.files.length > 0 ||
    changeSet.truncatedCount > 0 ||
    changeSet.totals.files > 0
  );
}

function filesCard(
  changeSet: TurnChangeSet,
  marks: TurnSummaryMarks,
): TurnSummaryFilesCard {
  const rows = changeSet.files.map((file) => ({
    file,
    state: rowState(file.path, marks),
    counts: formatFileCounts(file, changeSet.countsUnavailable),
  }));
  return {
    kind: 'files',
    value: changeSet.countsUnavailable ? 'unavailable' : changeSet.totals.files,
    changeSet,
    rows,
    conflictedCount: rows.filter((row) => row.state === 'conflicted').length,
    reconciledCount: rows.filter((row) => row.state === 'reconciled').length,
    truncatedCount: changeSet.truncatedCount,
    countsUnavailable: changeSet.countsUnavailable,
    baselineMissing: changeSet.baselineMissing === true,
  };
}

function linesCard(changeSet: TurnChangeSet): TurnSummaryLinesCard {
  const unavailable = changeSet.countsUnavailable;
  return {
    kind: 'lines',
    additions: unavailable ? 'unavailable' : changeSet.totals.additions,
    deletions: unavailable ? 'unavailable' : changeSet.totals.deletions,
    countsUnavailable: unavailable,
  };
}

function testsCard(
  runs: readonly TurnTestRun[],
  summary: TurnTestSummary,
  incomplete: boolean,
): TurnSummaryTestsCard {
  const label = turnTestsOutcomeLabel(summary);
  return {
    kind: 'tests',
    summary,
    label,
    ariaLabel: incomplete ? `Tests: ${label} (incomplete)` : `Tests: ${label}`,
    polarity: summary.failed > 0 ? 'bad' : 'good',
    runs: runs.map((run) => ({
      command: run.command,
      project: run.project,
      outcome: run.outcome,
      label: run.project ?? run.outcome,
      outcomeName: OUTCOME_NAME[run.outcome],
      tone: OUTCOME_TONE[run.outcome],
      failures: run.failures ?? [],
    })),
  };
}

/**
 * The summary of one turn, or `null` when there is nothing to report: the
 * snapshot is not terminal (never built during streaming, R6.7), or the turn
 * changed no files and ran no test command (R6.4). A diff still loading
 * (`pending`) counts as no files until the change set arrives; the caller
 * recomputes then.
 */
export function buildTurnSummaryModel(
  snapshot: TurnSourceSnapshot | null,
  marks: TurnSummaryMarks | null = null,
): TurnSummaryModel | null {
  if (snapshot === null || snapshot.state !== 'terminal') return null;

  const changeSet =
    snapshot.diff.kind === 'available' && hasFiles(snapshot.diff.changeSet)
      ? snapshot.diff.changeSet
      : null;
  const testsSource =
    snapshot.tests.kind === 'available' && snapshot.tests.runs.length > 0
      ? snapshot.tests
      : null;
  if (changeSet === null && testsSource === null) return null;

  const files =
    changeSet === null ? null : filesCard(changeSet, marks ?? NO_MARKS);
  const lines = changeSet === null ? null : linesCard(changeSet);
  const usage = snapshot.usage;
  const tokens: TurnSummaryTokensCard =
    usage.kind === 'available'
      ? { kind: 'tokens', input: usage.input, output: usage.output }
      : { kind: 'tokens', input: usage.kind, output: usage.kind };
  const cost: TurnSummaryCostCard = {
    kind: 'cost',
    value:
      usage.kind === 'available'
        ? (formatUsdCost(usage.cost) ?? 'unavailable')
        : usage.kind,
  };
  const duration: TurnSummaryDurationCard = {
    kind: 'duration',
    value:
      usage.kind === 'available'
        ? formatDurationMs(usage.durationMs)
        : usage.kind,
  };
  const tests =
    testsSource === null
      ? null
      : testsCard(testsSource.runs, testsSource.summary, snapshot.incomplete);

  const cards: TurnSummaryCard[] = [];
  if (files !== null) cards.push(files);
  if (lines !== null) cards.push(lines);
  cards.push(tokens, cost, duration);
  if (tests !== null) cards.push(tests);

  return {
    incomplete: snapshot.incomplete,
    testsInBackground: tests !== null && tests.summary.running > 0,
    files,
    lines,
    tokens,
    cost,
    duration,
    tests,
    cards,
  };
}
