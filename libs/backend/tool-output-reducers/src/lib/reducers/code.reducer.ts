/**
 * Source-code outline reducer (TASK_2026_559, User Decision 7: code →
 * tree-sitter outline over the existing parser services).
 *
 * This lib is `type:util` and must not import the tree-sitter services
 * (workspace-intelligence is `type:feature`). It defines the
 * {@link CodeOutliner} port instead; a host that owns a parser supplies an
 * adapter (vscode-lm-tools: `TreeSitterCodeOutliner`), a host without one
 * supplies nothing and every call takes the fallback.
 *
 * The port returns LINE SPANS, not text. The outliner says which lines hold
 * nothing but declaration-body content and which lines belong to the focus
 * symbol; this reducer alone renders the result. So the safety contract holds
 * by construction, whatever an adapter does:
 * - every emitted line is an input line, verbatim (the input is split on
 *   `\n` only, the row separator tree-sitter uses, so a `\r` stays part of its
 *   line); the only additions are `… N lines omitted …` notes and, when the
 *   outliner reports one, a first `… approximations: … …` line (a C file
 *   outlined with the C++ grammar says so in the served text);
 * - lines keep their input order, and two lines are never merged or edited;
 * - focus-symbol lines are never omitted, so the focus declaration is kept in
 *   full even inside an omitted enclosing body;
 * - non-empty input never yields empty text.
 *
 * When unsure, it does not outline: no outliner, no language hint, input over
 * {@link MAX_OUTLINE_CHARS}, an outliner that returns `null` or throws, a span
 * outside the input, or an outline that omits nothing all fall back to the
 * log reducer (head, tail, error lines), and the result's `reducer` names the
 * fallback (`code-fallback:<log reducer>`) with the reason as the first note.
 * This reducer never throws for an outliner failure.
 *
 * Cost: one split, one pass per span list (difference arrays, so nested spans
 * cost O(lines + spans), not O(lines × depth)) and one render pass.
 */
import { reduceLog } from './log.reducer';
import type {
  AsyncOutputReducer,
  ReduceContext,
  ReduceResult,
} from '../reducer.types';

/**
 * Inputs above this size are not outlined. Parsing 256 KiB of TypeScript with
 * the shipped web-tree-sitter grammar took ~150 ms plus ~60 ms of querying on
 * the development machine; the parse runs on the host's main thread, and an
 * outline of a larger file would still be far over any tool-result budget.
 */
const MAX_OUTLINE_CHARS = 262_144;

/** Longest caller-supplied name echoed in a note. */
const MAX_NOTE_NAME_CHARS = 80;

/** A 0-based, inclusive range of lines of the source as split on `\n`. */
export interface CodeLineSpan {
  readonly startLine: number;
  readonly endLine: number;
}

/** What an outliner found in one source text. */
export interface CodeOutline {
  /**
   * Spans that hold nothing but declaration-body content (never a line that
   * also carries a signature, a closing delimiter shared with other code, or
   * any other declaration's header). The reducer may omit these lines.
   * Spans may nest and overlap.
   */
  readonly omittable: readonly CodeLineSpan[];
  /**
   * Full declaration spans of the requested focus symbol (every declaration
   * with that name). Kept verbatim even where they overlap an omittable span.
   * Empty when no focus symbol was requested or none was found.
   */
  readonly focus: readonly CodeLineSpan[];
  /**
   * Approximations the outline rests on (`c:parsed-as-cpp` for C outlined
   * with the C++ grammar). Rendered as the first line of the outline, so a
   * served answer never hides them. Only short `[a-z0-9:.-]` codes are kept.
   */
  readonly approximations?: readonly string[];
}

/** Longest approximation code rendered, and how many at most. */
const MAX_APPROXIMATION_CHARS = 40;
const MAX_APPROXIMATIONS = 4;

/** The adapter's approximation codes that are safe to echo (checked, not trusted). */
function approximationCodes(outline: CodeOutline): string[] {
  const codes = Array.isArray(outline.approximations)
    ? outline.approximations
    : [];
  return codes
    .filter(
      (code): code is string =>
        typeof code === 'string' &&
        code.length <= MAX_APPROXIMATION_CHARS &&
        /^[a-z0-9][a-z0-9:.-]*$/.test(code),
    )
    .slice(0, MAX_APPROXIMATIONS);
}

/**
 * Port to a syntax-aware outliner. Resolves `null` when it cannot outline
 * this source (unsupported language, grammars unavailable on the host, a
 * parse with syntax errors). It may also reject; the reducer treats a
 * rejection like `null`.
 *
 * @param source - the exact text to outline; spans index its `\n`-separated lines
 * @param language - a language id (`typescript`) or a file extension (`.ts`)
 * @param focusSymbol - declaration name whose full span to report in `focus`
 */
export interface CodeOutliner {
  outline(
    source: string,
    language: string,
    focusSymbol?: string,
  ): Promise<CodeOutline | null>;
}

/**
 * Builds the code reducer over `outliner`. Pass `undefined` on a host with no
 * parser: every call then takes the log-reducer fallback.
 */
export function createCodeReducer(
  outliner: CodeOutliner | undefined,
): AsyncOutputReducer {
  return (input, ctx) => reduceCode(input, ctx, outliner);
}

async function reduceCode(
  input: string,
  ctx: ReduceContext,
  outliner: CodeOutliner | undefined,
): Promise<ReduceResult> {
  if (input.length === 0) {
    return { text: input, reducer: 'code-unchanged', notes: ['empty input'] };
  }
  if (outliner === undefined) {
    return fallback(input, ctx, 'no code outliner on this host');
  }
  const language = ctx.languageHint?.trim() ?? '';
  if (language === '') {
    return fallback(input, ctx, 'no language hint');
  }
  if (input.length > MAX_OUTLINE_CHARS) {
    return fallback(input, ctx, 'input larger than 256 KiB; not outlined');
  }
  const focusSymbol = ctx.focusSymbol?.trim() || undefined;

  let outline: CodeOutline | null;
  try {
    outline = await outliner.outline(input, language, focusSymbol);
  } catch (error) {
    // Only the error's type is kept: an outliner message can carry host paths.
    return fallback(input, ctx, `outliner failed: ${errorName(error)}`);
  }
  if (outline === null) {
    return fallback(input, ctx, `no outline for language ${quoted(language)}`);
  }

  const lines = input.split('\n');
  const omit = omittedLines(lines.length, outline);
  if (omit === null) {
    return fallback(input, ctx, 'outline line spans out of range');
  }
  const rendered = render(lines, omit);
  if (rendered.omittedLines === 0) {
    return fallback(input, ctx, 'outline omits nothing');
  }

  const notes = [
    `omitted ${rendered.omittedLines} of ${lines.length} lines of declaration bodies in ${rendered.runs} run(s)`,
  ];
  const approximations = approximationCodes(outline);
  if (approximations.length > 0) {
    notes.push(`approximations: ${approximations.join(', ')}`);
  }
  if (focusSymbol !== undefined) {
    notes.push(
      outline.focus.length > 0
        ? `kept focus symbol ${quoted(focusSymbol)} in full (${outline.focus.length} declaration(s))`
        : `focus symbol ${quoted(focusSymbol)} not found`,
    );
  }
  const text =
    approximations.length > 0
      ? `… approximations: ${approximations.join(', ')} …\n${rendered.text}`
      : rendered.text;
  return { text, reducer: 'code-outline', notes };
}

function fallback(
  input: string,
  ctx: ReduceContext,
  reason: string,
): ReduceResult {
  const log = reduceLog(input, ctx);
  return {
    text: log.text,
    reducer: `code-fallback:${log.reducer}`,
    notes: [`code outline unavailable: ${reason}`, ...(log.notes ?? [])],
  };
}

/**
 * Per-line omit flags: inside at least one omittable span and in no focus
 * span. `null` when a span is malformed or outside the input, because then
 * the outline was not made for this text.
 */
function omittedLines(
  lineCount: number,
  outline: CodeOutline,
): boolean[] | null {
  const body = coverage(lineCount, outline.omittable);
  const focus = coverage(lineCount, outline.focus);
  if (body === null || focus === null) {
    return null;
  }
  return body.map((covered, i) => covered && !focus[i]);
}

/** Which lines at least one span covers, via a difference array. */
function coverage(
  lineCount: number,
  spans: readonly CodeLineSpan[],
): boolean[] | null {
  if (!Array.isArray(spans)) {
    return null;
  }
  const delta = new Array<number>(lineCount + 1).fill(0);
  for (const span of spans) {
    // The spans come from another lib's adapter: checked, not trusted.
    const startLine: unknown = span?.startLine;
    const endLine: unknown = span?.endLine;
    if (
      !isLineIndex(startLine) ||
      !isLineIndex(endLine) ||
      startLine > endLine ||
      endLine >= lineCount
    ) {
      return null;
    }
    delta[startLine]++;
    delta[endLine + 1]--;
  }
  const covered = new Array<boolean>(lineCount);
  let depth = 0;
  for (let i = 0; i < lineCount; i++) {
    depth += delta[i];
    covered[i] = depth > 0;
  }
  return covered;
}

/**
 * Kept lines verbatim; each run of omitted lines becomes one note, unless the
 * run is no longer than its note (then the lines are kept: omitting them would
 * save nothing).
 */
function render(
  lines: readonly string[],
  omit: readonly boolean[],
): { text: string; omittedLines: number; runs: number } {
  const out: string[] = [];
  let omittedLines = 0;
  let runs = 0;
  let i = 0;
  while (i < lines.length) {
    if (!omit[i]) {
      out.push(lines[i]);
      i++;
      continue;
    }
    let end = i;
    let runChars = 0;
    while (end < lines.length && omit[end]) {
      runChars += lines[end].length + 1;
      end++;
    }
    const note = omissionNote(end - i);
    if (runChars > note.length) {
      out.push(note);
      omittedLines += end - i;
      runs++;
    } else {
      for (let k = i; k < end; k++) {
        out.push(lines[k]);
      }
    }
    i = end;
  }
  return { text: out.join('\n'), omittedLines, runs };
}

function isLineIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function omissionNote(lines: number): string {
  return `… ${lines} line${lines === 1 ? '' : 's'} omitted …`;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function quoted(name: string): string {
  return JSON.stringify(
    name.length > MAX_NOTE_NAME_CHARS
      ? `${name.slice(0, MAX_NOTE_NAME_CHARS)}…`
      : name,
  );
}
