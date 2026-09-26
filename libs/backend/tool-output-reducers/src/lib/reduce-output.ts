/**
 * The reducer pipeline (TASK_2026_559, User Decision 7): one call that takes
 * a raw tool result over its budget to the smallest faithful text the
 * content reducers can give, without cutting it.
 *
 * - Under budget → identity: the raw text byte-for-byte, `reducer: 'none'`,
 *   and no tokenizer call beyond the one bounded pre-check count.
 * - Over budget → detect the content kind (the caller's hint wins) → run
 *   that kind's reducer. `text` and `preformatted` have no reducer: their
 *   formatter owns the shape, and only the caller's cut applies.
 *
 * The result can still be over budget (the log reducer fits both budgets but
 * keeps one line whatever it costs, the Markdown outline keeps every
 * heading, the HTML extractor is not a budget fit); cutting and spooling the
 * raw belong to the caller (`applyToolResultBudget`).
 *
 * The pipeline keeps the reducer safety contract rather than trusting it:
 * a reducer that throws, returns its input unchanged, returns blank text, or
 * does not lower the token count is refused, and the raw text is returned.
 * Input over {@link MAX_REDUCER_INPUT_CHARS} is reduced only when it is a log
 * (kind decided from the hint or the original input): the log reducer sees
 * the whole lines of the first and the last half of the cap with one omission
 * note line between them (so a failure and the summary at the end of a huge
 * log stay visible), and the same note follows the result when the reducer
 * dropped it. Any other kind over the cap is returned raw (`'none'`): a
 * structured document stitched from distant pieces would be parsed in the
 * wrong context.
 *
 * Pure except for the optional `output` line when a reducer throws; a failing
 * output channel is ignored. Token counts are piece-wise upper bounds
 * ({@link countTokensPiecewise}), so a long run of one character never
 * reaches the tokenizer's super-linear path and a count never understates.
 */
import type { IOutputChannel } from '@ptah-extension/platform-core';
import { detectContentKind } from './content-detector';
import type {
  AsyncOutputReducer,
  ContentKind,
  OutputReducer,
  ReduceResult,
} from './reducer.types';
import { createCodeReducer, type CodeOutliner } from './reducers/code.reducer';
import { reduceHtml } from './reducers/html.reducer';
import { reduceJson } from './reducers/json.reducer';
import { reduceLog } from './reducers/log.reducer';
import { reduceMarkdown } from './reducers/markdown.reducer';
import { countTokensPiecewise } from './token-measure';

/** Reducers never see more than this many chars (2 MiB) of one result. */
export const MAX_REDUCER_INPUT_CHARS = 2 * 1024 * 1024;

/** Chars kept from each end of an input over the cap; the note line fits in the rest. */
const CAP_HALF_CHARS = MAX_REDUCER_INPUT_CHARS / 2 - 64;

/**
 * Error names the output-channel line may echo. A custom `name` is arbitrary
 * text (a path, content), so anything else is logged as `Error`.
 */
const LOGGED_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
  'AggregateError',
]);

export interface ReduceOutputOptions {
  /** Token budget (gpt-tokenizer count); a finite number above zero. */
  readonly budgetTokens: number;
  /** Char budget (`string.length`); a finite number above zero. */
  readonly budgetChars: number;
  /** Content kind known to the caller (a per-tool table); wins over sniffing. */
  readonly hint?: ContentKind;
  /** Language id or file extension, for the code reducer. */
  readonly languageHint?: string;
  /** Declaration the code reducer keeps in full. */
  readonly focusSymbol?: string;
  /** Syntax-aware outliner; without one the code kind takes the log fallback. */
  readonly outliner?: CodeOutliner;
  /** Receives one line when a reducer throws. */
  readonly output?: IOutputChannel;
}

export interface ReduceOutputResult {
  /** The raw text, or the reducer's result; never cut. */
  readonly text: string;
  /** Reducer that produced `text`, or `'none'` when `text` is the raw text. */
  readonly reducer: string;
  /** Piece-wise token count of the raw text. */
  readonly rawTokens: number;
  /** Piece-wise token count of `text`. */
  readonly returnedTokens: number;
  /** Whether `text` differs from the raw text. */
  readonly reduced: boolean;
}

export async function reduceOutput(
  raw: string,
  options: ReduceOutputOptions,
): Promise<ReduceOutputResult> {
  assertBudget('budgetTokens', options.budgetTokens);
  assertBudget('budgetChars', options.budgetChars);
  const { budgetTokens, budgetChars } = options;

  // The pre-check: the only tokenizer work for an under-budget result.
  if (raw.length <= budgetChars) {
    const tokens = countTokensPiecewise(raw, budgetTokens);
    if (tokens <= budgetTokens) {
      return unreduced(raw, tokens);
    }
  }
  const rawTokens = countTokensPiecewise(raw);

  // The kind comes from the original input, never from a stitched one. Over
  // the cap only the prefix is sniffed (every sniffer but JSON reads a prefix
  // anyway, and an over-cap JSON document is not reduced).
  const overCap = raw.length > MAX_REDUCER_INPUT_CHARS;
  const kind = detectContentKind(
    overCap ? raw.slice(0, MAX_REDUCER_INPUT_CHARS) : raw,
    options.hint,
  );
  const reducer = reducerFor(kind, options.outliner);
  if (reducer === undefined) {
    return unreduced(raw, rawTokens);
  }
  // Head/tail stitching keeps meaning only for line-oriented logs (Batch 2e
  // review r2, B1): an HTML or fence opener in the omitted middle would put
  // its tail contents in the wrong context. Other kinds over the cap take the
  // caller's cut and spool.
  let capped: { input: string; note?: string } | null = { input: raw };
  if (overCap) {
    capped = kind === 'log' ? cappedLogInput(raw) : null;
  }
  if (capped === null) {
    return unreduced(raw, rawTokens);
  }
  const { input, note } = capped;

  // Room for the note the pipeline appends when the reducer drops it.
  const noteTokens = note === undefined ? 0 : countTokensPiecewise(`\n${note}`);
  const noteChars = note === undefined ? 0 : note.length + 1;
  let result: ReduceResult;
  try {
    result = await reducer(input, {
      budgetTokens: Math.max(1, budgetTokens - noteTokens),
      budgetChars: Math.max(1, budgetChars - noteChars),
      languageHint: options.languageHint,
      focusSymbol: options.focusSymbol,
    });
  } catch (error) {
    // Only the error's type is logged: a message can carry content or paths.
    logLine(
      options.output,
      `[tool-output-reducers] ${kind} reducer threw ${errorName(error)}; ` +
        'the raw output is kept',
    );
    return unreduced(raw, rawTokens);
  }
  if (result.text === input || result.text.trim() === '') {
    return unreduced(raw, rawTokens);
  }

  const text =
    note !== undefined && !result.text.split('\n').includes(note)
      ? `${result.text}\n${note}`
      : result.text;
  const returnedTokens = countTokensPiecewise(text, rawTokens);
  if (returnedTokens >= rawTokens) {
    return unreduced(raw, rawTokens);
  }
  return {
    text,
    reducer: result.reducer,
    rawTokens,
    returnedTokens,
    reduced: true,
  };
}

function unreduced(raw: string, tokens: number): ReduceOutputResult {
  return {
    text: raw,
    reducer: 'none',
    rawTokens: tokens,
    returnedTokens: tokens,
    reduced: false,
  };
}

/**
 * What the log reducer sees for a log over the cap: the whole lines inside
 * its first {@link CAP_HALF_CHARS} chars, one note line naming the chars
 * between, and the whole lines inside its last {@link CAP_HALF_CHARS} chars.
 * The reducer never holds a partial line. `null` when neither end holds a
 * whole line (a few huge lines): the raw then takes the caller's cut only.
 */
function cappedLogInput(raw: string): { input: string; note: string } | null {
  const headBreak = raw.lastIndexOf('\n', CAP_HALF_CHARS - 1);
  let headEnd = headBreak > 0 ? headBreak : 0;
  if (headEnd > 0 && raw[headEnd - 1] === '\r') {
    headEnd--;
  }
  const tailBreak = raw.indexOf('\n', raw.length - CAP_HALF_CHARS);
  const tailStart = tailBreak >= 0 ? tailBreak + 1 : raw.length;
  const head = raw.slice(0, headEnd);
  const tail = raw.slice(tailStart);
  if (head.trim() === '' && tail.trim() === '') {
    return null;
  }
  const note = capNote(tailStart - headEnd);
  return {
    input: [head, note, tail].filter((part) => part !== '').join('\n'),
    note,
  };
}

function capNote(chars: number): string {
  return `… ${chars} chars in the middle omitted (2 MiB reducer input cap) …`;
}

/** Best effort: a throwing output channel never changes the result. */
function logLine(output: IOutputChannel | undefined, line: string): void {
  try {
    output?.appendLine(line);
  } catch {
    // The diagnostic line is optional; the reduction result is not.
  }
}

function reducerFor(
  kind: ContentKind,
  outliner: CodeOutliner | undefined,
): OutputReducer | AsyncOutputReducer | undefined {
  switch (kind) {
    case 'json':
      return reduceJson;
    case 'markdown':
      return reduceMarkdown;
    case 'log':
      return reduceLog;
    case 'html':
      return reduceHtml;
    case 'code':
      return createCodeReducer(outliner);
    case 'text':
    case 'preformatted':
      return undefined;
  }
}

function assertBudget(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} must be a finite number above zero, got ${value}`,
    );
  }
}

/** A fixed classification of `error`: a built-in error name, `Error`, or the `typeof`. */
function errorName(error: unknown): string {
  try {
    if (!(error instanceof Error)) {
      return typeof error;
    }
    const name: unknown = error.name;
    return typeof name === 'string' && LOGGED_ERROR_NAMES.has(name)
      ? name
      : 'Error';
  } catch {
    // degradation-audit: reported — a throwing `name` getter is classified
    // as `Error`; the reducer failure is still logged under that name.
    return 'Error';
  }
}
