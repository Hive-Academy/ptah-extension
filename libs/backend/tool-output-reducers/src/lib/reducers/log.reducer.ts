/**
 * Log, test-runner and diagnostic output reducer (TASK_2026_559, User
 * Decision 7).
 *
 * The input is read as lines after ANSI escape codes are removed. A run of
 * identical consecutive non-blank lines becomes one line with a `(×N)`
 * suffix. The required set is always kept, whatever it costs (batches.md
 * Task 2c.1): the first {@link HEAD_LINES} lines, the last
 * {@link TAIL_LINES} lines (the run summary), and every line matching the
 * error pattern set with {@link ERROR_CONTEXT} lines of context on each side.
 * With budget left over, every kept region then grows outward one line per
 * pass. Each run of dropped lines becomes one `… N lines omitted …` marker
 * counting input lines. When the required set alone exceeds the budget, the
 * output exceeds it too; trimming that is the pipeline's job (Batch 2e).
 *
 * Safety contract (holds for off-kind input such as prose):
 * - every emitted line is an input line, verbatim after ANSI removal; the
 *   only additions are `(×N)` suffixes on collapsed runs and gap markers;
 * - two different lines are never merged, and lines keep their input order;
 * - non-empty input never yields empty or whitespace-only text: the head is
 *   always kept, and when nothing would be omitted, collapsed or stripped, or
 *   no text survives ANSI removal, the original input is returned
 *   byte-for-byte (`log-unchanged`).
 *
 * A reduced output uses LF line endings. Cost: one linear pass per stage.
 * Every regex here is linear (disjoint character classes, bounded or anchored
 * quantifiers), and token counting is piece-wise with an early exit at the
 * remaining budget, so a multi-megabyte line is never tokenised whole.
 */
import { countTokens } from '../token-measure';
import type { OutputReducer, ReduceResult } from '../reducer.types';

/** Lines kept from the start of the output, counted after collapsing repeats. */
const HEAD_LINES = 40;
/** Lines kept from the end of the output (the summary lives there). */
const TAIL_LINES = 80;
/** Lines of context kept on each side of an error line. */
const ERROR_CONTEXT = 3;

/**
 * Lines up to this length are counted with one `encode`; longer lines are
 * counted in pieces. gpt-tokenizer's BPE is super-linear on a long run of one
 * character, and a piece of this size stays around a millisecond. A piece
 * boundary can only prevent merges, so the piece-wise sum never undercounts.
 */
const MAX_PIECE_CHARS = 1024;

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

/**
 * ANSI escape sequences: CSI (`ESC [ params intermediates final`), OSC
 * (`ESC ] … BEL` or `ESC ] … ESC \`) and the two-byte `ESC @`…`ESC _` forms.
 * The CSI classes (0x30-0x3F, 0x20-0x2F, 0x40-0x7E) are disjoint and the OSC
 * body stops at the next ESC, so every ESC is scanned past at most once.
 * Built from char codes so no control character sits in a regex literal.
 */
const ANSI = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[@-_])`,
  'g',
);

/**
 * The error pattern set. Deliberately broad: keeping a line that merely
 * mentions an error costs budget, dropping a real one loses the answer.
 * Literal alternatives and one bounded digit run, so the scan is linear.
 */
const ERROR_WORDS =
  /error|fail|exception|fatal|panic|traceback|ERR!|\bTS\d{4,5}\b|[●✕✖✗✘]/i;
/** A JavaScript/Java stack frame (`    at fn (file:1:2)`) or a Python traceback frame. */
const STACK_FRAME = /^\s+at\s+\S|^\s+File "[^"]*", line \d/;

/** Gap marker with the widest count the marker cost is reserved for. */
const WIDEST_MARKER = gapMarker(9_999_999);

/** One output line: an input line, or a run of identical consecutive input lines. */
interface Group {
  readonly text: string;
  /** Number of input lines the group stands for. */
  readonly count: number;
}

export const reduceLog: OutputReducer = (input, ctx) => {
  if (input.length === 0) {
    return unchanged(input, 'empty input');
  }
  const stripped = input.replace(ANSI, '');
  const ansiRemoved = stripped.length !== input.length;
  if (ansiRemoved && stripped.trim() === '') {
    return unchanged(input, 'no text left after removing ANSI escape codes');
  }
  const groups = groupLines(splitLines(stripped));
  const errors = groups.flatMap((group, i) => (isErrorLine(group.text) ? [i] : []));
  const keep = selectLines(groups, errors, ctx.budgetTokens);

  const collapsedRuns = groups.filter((group) => group.count > 1).length;
  const omittedGroups = keep.reduce((n, kept) => n + (kept ? 0 : 1), 0);
  if (omittedGroups === 0 && collapsedRuns === 0 && !ansiRemoved) {
    return unchanged(input, 'nothing to omit');
  }
  const { text, keptLines, totalLines } = render(groups, keep);
  const notes = [`kept ${keptLines} of ${totalLines} lines`];
  if (errors.length > 0) {
    notes.push(`kept ${errors.length} error line(s)`);
  }
  if (collapsedRuns > 0) {
    notes.push(`collapsed ${collapsedRuns} run(s) of repeated lines`);
  }
  if (ansiRemoved) {
    notes.push('removed ANSI escape codes');
  }
  return { text, reducer: 'log-reduced', notes };
};

function unchanged(input: string, note: string): ReduceResult {
  return { text: input, reducer: 'log-unchanged', notes: [note] };
}

function gapMarker(lines: number): string {
  return `… ${lines} line${lines === 1 ? '' : 's'} omitted …`;
}

/** Lines without their terminators; a final terminator does not start another line. */
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (text.endsWith('\n')) {
    lines.pop();
  }
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * Runs of identical consecutive lines become one group. Blank lines are never
 * collapsed: a `(×N)` suffix on nothing would read as content.
 */
function groupLines(lines: readonly string[]): Group[] {
  const groups: Group[] = [];
  let i = 0;
  while (i < lines.length) {
    const text = lines[i];
    let end = i + 1;
    if (text.trim() !== '') {
      while (end < lines.length && lines[end] === text) {
        end++;
      }
    }
    groups.push({ text, count: end - i });
    i = end;
  }
  return groups;
}

function renderGroup(group: Group): string {
  return group.count > 1 ? `${group.text} (×${group.count})` : group.text;
}

function isErrorLine(text: string): boolean {
  return ERROR_WORDS.test(text) || STACK_FRAME.test(text);
}

/** Keeps the required set (see the file header), then spends any budget left; returns the kept flags. */
function selectLines(
  groups: readonly Group[],
  errors: readonly number[],
  budget: number,
): boolean[] {
  const selection = new LineSelection(groups, budget);
  const n = groups.length;
  for (let i = 0; i < Math.min(HEAD_LINES, n); i++) {
    selection.force(i);
  }
  for (let i = Math.max(0, n - TAIL_LINES); i < n; i++) {
    selection.force(i);
  }
  for (const error of errors) {
    const last = Math.min(n - 1, error + ERROR_CONTEXT);
    for (let i = Math.max(0, error - ERROR_CONTEXT); i <= last; i++) {
      selection.force(i);
    }
  }
  selection.growRegions();
  return selection.keep;
}

/**
 * Kept flags plus the budget still free. The budget always accounts for one
 * gap marker per run of dropped lines, so keeping a line pays for its own
 * tokens and for the marker change it causes: splitting a gap adds a marker,
 * closing one releases it.
 */
class LineSelection {
  readonly keep: boolean[];
  private remaining: number;
  private exhausted = false;
  private readonly markerCost = lineTokens(WIDEST_MARKER, Infinity);

  constructor(
    private readonly groups: readonly Group[],
    budget: number,
  ) {
    this.keep = new Array<boolean>(groups.length).fill(false);
    // Nothing kept yet: the whole input is one gap.
    this.remaining = budget - (groups.length > 0 ? this.markerCost : 0);
  }

  /**
   * Keeps line `i` whatever it costs (the required set). Once the budget runs out
   * here it stays out: the cost was counted only up to the limit, so a later
   * released marker must not make the partial count look like room.
   */
  force(i: number): void {
    if (!this.keep[i]) {
      this.remaining -= this.cost(i, Math.max(0, this.remaining));
      this.keep[i] = true;
      if (this.remaining < 0) {
        this.exhausted = true;
      }
    }
  }

  /** Keeps line `i` if it is in range, dropped, and fits; reports whether it is kept now. */
  tryKeep(i: number): boolean {
    if (i < 0 || i >= this.keep.length) {
      return false;
    }
    if (this.keep[i]) {
      return true;
    }
    if (this.exhausted || this.remaining < 0) {
      return false;
    }
    const cost = this.cost(i, this.remaining);
    if (cost > this.remaining) {
      return false;
    }
    this.keep[i] = true;
    this.remaining -= cost;
    return true;
  }

  /**
   * Offers every kept region the next dropped line on each side, pass after
   * pass, until nothing fits. A side retires when its line does not fit or it
   * meets another region, so every line is offered at most twice.
   */
  growRegions(): void {
    let frontiers = this.frontiers();
    while (frontiers.length > 0) {
      const next: Frontier[] = [];
      for (const { position, step } of frontiers) {
        if (this.keep[position] || !this.tryKeep(position)) {
          continue;
        }
        const after = position + step;
        if (after >= 0 && after < this.keep.length && !this.keep[after]) {
          next.push({ position: after, step });
        }
      }
      frontiers = next;
    }
  }

  /** Token cost of keeping line `i`: its own tokens plus the change in gap markers. */
  private cost(i: number, limit: number): number {
    const droppedBefore = i > 0 && !this.keep[i - 1];
    const droppedAfter = i < this.keep.length - 1 && !this.keep[i + 1];
    let markers = 0;
    if (droppedBefore && droppedAfter) {
      markers = 1; // splits its gap in two
    } else if (!droppedBefore && !droppedAfter) {
      markers = -1; // was a gap on its own
    }
    const markerDelta = markers * this.markerCost;
    return markerDelta + lineTokens(renderGroup(this.groups[i]), limit - markerDelta);
  }

  /** The dropped line on each side of every kept region. */
  private frontiers(): Frontier[] {
    const frontiers: Frontier[] = [];
    for (let i = 0; i < this.keep.length; i++) {
      if (this.keep[i]) {
        continue;
      }
      if (i > 0 && this.keep[i - 1]) {
        frontiers.push({ position: i, step: 1 });
      }
      if (i + 1 < this.keep.length && this.keep[i + 1]) {
        frontiers.push({ position: i, step: -1 });
      }
    }
    return frontiers;
  }
}

interface Frontier {
  /** The dropped line this side offers next. */
  readonly position: number;
  /** Direction the side grows in. */
  readonly step: 1 | -1;
}

function render(
  groups: readonly Group[],
  keep: readonly boolean[],
): { text: string; keptLines: number; totalLines: number } {
  const out: string[] = [];
  let keptLines = 0;
  let totalLines = 0;
  let omitted = 0;
  groups.forEach((group, i) => {
    totalLines += group.count;
    if (!keep[i]) {
      omitted += group.count;
      return;
    }
    if (omitted > 0) {
      out.push(gapMarker(omitted));
      omitted = 0;
    }
    out.push(renderGroup(group));
    keptLines += group.count;
  });
  if (omitted > 0) {
    out.push(gapMarker(omitted));
  }
  return { text: out.join('\n'), keptLines, totalLines };
}

/**
 * Token cost of `text` plus its newline. Stops once the cost passes `limit`
 * and returns the partial sum, which is then already over the limit.
 */
function lineTokens(text: string, limit: number): number {
  let total = 1;
  let start = 0;
  while (start < text.length && total <= limit) {
    let end = Math.min(text.length, start + MAX_PIECE_CHARS);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) {
      end--; // do not split a surrogate pair
    }
    total += countTokens(text.slice(start, end));
    start = end;
  }
  return total;
}
