/**
 * The output budget engine (TASK_2026_559, moved here by TASK_2026_597 D8 so
 * that every capper shares one engine): takes a tool's text to a given
 * {@link TextBudget}.
 *
 * 1. Under the budget → the raw text, byte-for-byte. Nothing is spooled,
 *    because nothing was withheld.
 * 2. Over it → the caller's `reduce` step (normally `reduceOutput` with the
 *    caller's content hints). A Markdown outline is followed by a labelled
 *    prefix of the raw text in the room it leaves (reducer
 *    `markdown-outline+prefix`): the outline keeps late headings and
 *    answers, the prefix keeps the body the outline dropped.
 * 3. Still over either limit (reducers may return more than the budget) →
 *    cut at the last line break inside the window, or at the limit itself
 *    when the window's last 20% has no line break (single-line JSON).
 * 4. Whenever the returned text differs from the raw text, the raw text is
 *    spooled ({@link writeSpoolFile}) and a trailer names the reducer, the
 *    token counts and the spool path (or the reason the spool failed). A
 *    spool path too long for a quarter of the budget is shown relative to its
 *    root instead.
 *
 * The returned text, trailer included, satisfies BOTH limits of the budget:
 * the final string is measured with the upper-bound token count and the cut
 * is repeated with a smaller window until it fits, down to the trailer alone.
 * The write path is the spool file only. This function never throws: a spool
 * failure is reported in the trailer, and an unexpected error (or a throwing
 * output channel) falls back to a plain char cut. Error details never reach
 * the text or the log: only a built-in error name or a validated errno code
 * does.
 */
import * as path from 'node:path';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import type { ReduceOutputResult } from '../reduce-output';
import {
  countTokensPiecewise,
  fitsBudget,
  fittingPrefixLength,
  type TextBudget,
} from '../token-measure';
import {
  errorName,
  relativeLocator,
  spoolFileName,
  spoolLocation,
  writeSpoolFile,
  type SpoolLocation,
  type SpoolOutcome,
  type SpoolRequestId,
} from './spool';

/** The body the trailer is appended to, and how it was made. */
export type OutputReduction = Pick<
  ReduceOutputResult,
  'text' | 'reducer' | 'reduced' | 'rawTokens'
>;

export interface ApplyOutputBudgetInput {
  /** The tool's text. */
  readonly text: string;
  /** Both limits the returned text, trailer included, must satisfy. */
  readonly budget: TextBudget;
  /** Call id; only names the spool file. */
  readonly requestId: SpoolRequestId;
  /**
   * Absolute directory the spool tree goes under. A relative or empty value
   * falls back to `os.tmpdir()`.
   */
  readonly spoolRoot: string;
  /**
   * Reduces the raw text to fit `limit` (without cutting it). The caller
   * owns the content policy: its per-tool hints, preserved keys, language
   * and outliner. The engine may call it twice (a second, smaller request
   * for a dense Markdown outline).
   */
  readonly reduce: (limit: TextBudget) => Promise<OutputReduction>;
  /** Names the caller and the tool in the failure log line (`[tool-result-budget] ptah_x`). */
  readonly logLabel: string;
  /** Receives one line when the budget step fails. */
  readonly output?: IOutputChannel;
}

export interface OutputBudgetOutcome {
  /** What the model gets: the raw text, or the reduced/cut text plus the trailer. */
  readonly text: string;
  /** A content reducer changed the text. */
  readonly reduced: boolean;
  /** The text was cut to fit. */
  readonly truncated: boolean;
  /** Reducer applied, or `'none'`. */
  readonly reducer: string;
  /**
   * Token count of the raw text: the piece-wise upper bound, exact for
   * ordinary text (a pre-token over 1,024 chars counts as its bytes); 0 when
   * counting failed.
   */
  readonly rawTokens: number;
  /** Token count of `text`, trailer included (the same upper bound). */
  readonly returnedTokens: number;
  /** Length of the raw text (the full output, before any reduction). */
  readonly totalChars: number;
  /** Spool file holding the raw text, when one was written. */
  readonly spoolPath?: string;
}

const TRAILER_SEPARATOR = '\n\n';
/** Longest reducer name a trailer prints. */
const MAX_REDUCER_CHARS = 48;
/** Widest token count a trailer is reserved for. */
const WIDEST_COUNT = 999_999_999_999;
/** Tokens a concatenation can add at the body/trailer boundary; kept free in the window. */
const BOUNDARY_TOKEN_SLACK = 8;
/** Largest share of the budget an absolute spool path trailer may take; longer paths are shown relative. */
const MAX_TRAILER_SHARE = 0.25;
/** The cut prefers a line break inside this last share of the window. */
const LINE_BREAK_WINDOW_SHARE = 0.2;
/** Name of the Markdown heading-outline reducer (`markdown.reducer.ts`). */
const OUTLINE_REDUCER = 'markdown-outline';
/** Trailer name of an outline followed by a labelled prefix of the raw text. */
const OUTLINE_WITH_PREFIX_REDUCER = 'markdown-outline+prefix';
/** Separates the outline from the raw prefix and says what follows. */
const PREFIX_LABEL = '\n\n[the full output from its start, cut to fit:]\n\n';
/**
 * Share of the window kept for the raw prefix: an outline that leaves less
 * is requested again within the rest of the window.
 */
const PREFIX_RESERVE_SHARE = 0.2;
/** Cut passes with a smaller window when the final text still measures over the budget. */
const MAX_FIT_PASSES = 4;
/**
 * Upper bound of byte-level BPE tokens per UTF-16 unit (a BMP char is at most
 * 3 UTF-8 bytes, a surrogate pair 4 bytes over 2 units), for the last resort.
 */
const WORST_TOKENS_PER_CHAR = 3;

type CutKind = 'none' | 'line' | 'mid-line';

/** How the trailer names the spooled file. */
type Locator = 'absolute' | 'relative';

export async function applyOutputBudget(
  input: ApplyOutputBudgetInput,
): Promise<OutputBudgetOutcome> {
  try {
    return await budgetText(input);
  } catch (error) {
    logLine(
      input.output,
      `${input.logLabel} budget step failed with ` +
        `${errorName(error)}; returning a plain cut`,
    );
    return plainCut(input.text, input.budget, error);
  }
}

async function budgetText(
  input: ApplyOutputBudgetInput,
): Promise<OutputBudgetOutcome> {
  const { budget } = input;
  const raw = input.text;
  if (raw.length <= budget.chars) {
    const tokens = countTokensPiecewise(raw, budget.tokens);
    if (tokens <= budget.tokens) {
      return {
        text: raw,
        reduced: false,
        truncated: false,
        reducer: 'none',
        rawTokens: tokens,
        returnedTokens: tokens,
        totalChars: raw.length,
      };
    }
  }

  const location = spoolLocation(input.spoolRoot);
  const samplePath = path.join(
    location.dir,
    spoolFileName(input.requestId, '0000'),
  );
  const locator = chooseLocator(budget, samplePath, location);
  const window = trailerWindow(budget, samplePath, location, locator);

  const reducedOutput = await input.reduce(window);
  const result =
    reducedOutput.reducer === OUTLINE_REDUCER
      ? await outlineWithPrefix(raw, reducedOutput, window, input.reduce)
      : reducedOutput;

  const spool = await writeSpoolFile(raw, location.dir, input.requestId);
  const where = describeSpool(spool, location, locator);
  const { text, tokens, cut } = fitWithTrailer(
    result.text,
    window,
    budget,
    (body, cutKind) =>
      renderTrailer({
        reducer: result.reducer,
        cut: cutKind,
        shownTokens: countTokensPiecewise(body),
        totalTokens: result.rawTokens,
        where,
      }),
  );
  return {
    text,
    reduced: result.reduced,
    truncated: cut !== 'none',
    reducer: result.reducer,
    rawTokens: result.rawTokens,
    returnedTokens: tokens,
    totalChars: raw.length,
    ...('path' in spool ? { spoolPath: spool.path } : {}),
  };
}

/**
 * A Markdown outline followed by a labelled prefix of the raw text, filling
 * the window (review r4 R4-03). The outline keeps every heading and the head
 * of each section, but drops a block that does not fit whole (a long first
 * paragraph, table or list — often the answer). The prefix keeps the start
 * of the raw text, but drops everything after the window (late headings and
 * answers). Neither alone preserves both, and no size measure tells which
 * one lost the content, so both are returned.
 *
 * The outline comes first: it is short, names the whole document's
 * structure, and the final cut ({@link fitWithTrailer}) only ever shortens
 * the text's end — the prefix, which is recoverable from the spool — never
 * the outline. An outline that leaves less than
 * {@link PREFIX_RESERVE_SHARE} of the window is requested again within the
 * rest of it, so a dense outline still leaves room for the prefix. When no
 * prefix fits, the outline alone is returned under its own name.
 */
async function outlineWithPrefix(
  raw: string,
  outline: OutputReduction,
  window: TextBudget,
  reduceWithin: (limit: TextBudget) => Promise<OutputReduction>,
): Promise<OutputReduction> {
  const outlineRoom: TextBudget = {
    tokens: Math.max(1, Math.floor(window.tokens * (1 - PREFIX_RESERVE_SHARE))),
    chars: Math.max(1, Math.floor(window.chars * (1 - PREFIX_RESERVE_SHARE))),
  };
  let kept = outline;
  if (!fitsBudget(outline.text.trimEnd() + PREFIX_LABEL, outlineRoom)) {
    const smaller = await reduceWithin(outlineRoom);
    if (smaller.reducer === OUTLINE_REDUCER) {
      kept = smaller;
    }
  }
  const text = composeWithPrefix(kept.text, raw, window);
  return text === undefined
    ? outline
    : {
        text,
        reducer: OUTLINE_WITH_PREFIX_REDUCER,
        reduced: true,
        rawTokens: outline.rawTokens,
      };
}

/**
 * `outline`, the {@link PREFIX_LABEL}, and the longest prefix of `raw` that
 * keeps the whole within `window` (ended at a line break when one is near,
 * as {@link fitWindow} does); `undefined` when not even one char of prefix
 * fits after the outline.
 */
function composeWithPrefix(
  outline: string,
  raw: string,
  window: TextBudget,
): string | undefined {
  const head = outline.trimEnd() + PREFIX_LABEL;
  if (!fitsBudget(head, window)) {
    return undefined;
  }
  let room: TextBudget = {
    tokens: window.tokens - countTokensPiecewise(head) - BOUNDARY_TOKEN_SLACK,
    chars: window.chars - head.length,
  };
  for (let pass = 0; pass < MAX_FIT_PASSES; pass++) {
    if (room.tokens < 1 || room.chars < 1) {
      return undefined;
    }
    const { body } = fitWindow(raw, room);
    if (body === '') {
      return undefined;
    }
    const text = head + body;
    if (fitsBudget(text, window)) {
      return text;
    }
    room = {
      tokens:
        room.tokens -
        Math.max(0, countTokensPiecewise(text) - window.tokens) -
        1,
      chars: room.chars - Math.max(0, text.length - window.chars) - 1,
    };
  }
  return undefined;
}

/**
 * `text` cut to `window`, plus its trailer, measured as one string against
 * `budget`. When it measures over (the pieces meet differently where body
 * and trailer join, or the trailer differs from its reservation), the window
 * shrinks by the overshoot and the cut is repeated; the last resort is the
 * trailer alone, itself cut to the budget.
 */
function fitWithTrailer(
  text: string,
  window: TextBudget,
  budget: TextBudget,
  trailerFor: (body: string, cut: CutKind) => string,
): { text: string; tokens: number; cut: CutKind } {
  let limit = window;
  for (let pass = 0; pass < MAX_FIT_PASSES; pass++) {
    const { body, cut } = fitWindow(text, limit);
    const joined = join(body, trailerFor(body, cut));
    const tokens = measure(joined, budget);
    if (tokens !== null && tokens <= budget.tokens) {
      return { text: joined, tokens, cut };
    }
    const overTokens = tokens === null ? 0 : tokens - budget.tokens;
    const overChars = Math.max(0, joined.length - budget.chars);
    limit = {
      tokens: Math.max(0, limit.tokens - overTokens - 1),
      chars: Math.max(0, limit.chars - overChars - 1),
    };
  }
  const trailer = trailerFor('', 'mid-line');
  const alone = fitsBudget(trailer, budget)
    ? trailer
    : trailer.slice(0, fittingPrefixLength(trailer, budget));
  return { text: alone, tokens: countTokensPiecewise(alone), cut: 'mid-line' };
}

/** Upper-bound token count of `text`, or `null` when it is over the char ceiling. */
function measure(text: string, budget: TextBudget): number | null {
  if (text.length > budget.chars) {
    return null;
  }
  return countTokensPiecewise(text);
}

function join(body: string, trailer: string): string {
  return body === '' ? trailer : `${body}${TRAILER_SEPARATOR}${trailer}`;
}

/**
 * The budget left for the body once the widest trailer this call can print
 * is reserved: the longest reducer name, the widest counts, the partial
 * marker, and the spool locator (its length is fixed before the write: a
 * retry changes only the random hex) or the longest failure reason. The
 * final string is measured again, so this only has to be close.
 */
function trailerWindow(
  budget: TextBudget,
  samplePath: string,
  location: SpoolLocation,
  locator: Locator,
): TextBudget {
  const saved = widestTrailer(
    describeSpool({ path: samplePath }, location, locator),
  );
  const failed = widestTrailer(
    describeSpool({ failure: 'no free spool file name' }, location, locator),
  );
  const chars = Math.max(saved.length, failed.length);
  const tokens =
    Math.max(countTokensPiecewise(saved), countTokensPiecewise(failed)) +
    BOUNDARY_TOKEN_SLACK;
  return {
    tokens: Math.max(1, budget.tokens - tokens),
    chars: Math.max(1, budget.chars - chars),
  };
}

function widestTrailer(where: string): string {
  return (
    TRAILER_SEPARATOR +
    renderTrailer({
      reducer: 'code-fallback:log-unchanged'.padEnd(MAX_REDUCER_CHARS, 'x'),
      cut: 'mid-line',
      shownTokens: WIDEST_COUNT,
      totalTokens: WIDEST_COUNT,
      where,
    })
  );
}

/**
 * The absolute spool path while its widest trailer takes at most
 * {@link MAX_TRAILER_SHARE} of the budget, else the path relative to the
 * spool root (bounded: the sanitised id is at most 64 chars).
 */
function chooseLocator(
  budget: TextBudget,
  samplePath: string,
  location: SpoolLocation,
): Locator {
  const trailer = widestTrailer(
    describeSpool({ path: samplePath }, location, 'absolute'),
  );
  const fits = fitsBudget(trailer, {
    tokens: Math.floor(budget.tokens * MAX_TRAILER_SHARE),
    chars: Math.floor(budget.chars * MAX_TRAILER_SHARE),
  });
  return fits ? 'absolute' : 'relative';
}

function describeSpool(
  spool: SpoolOutcome,
  location: SpoolLocation,
  locator: Locator,
): string {
  if (!('path' in spool)) {
    return `full output could not be saved: ${spool.failure}`;
  }
  if (locator === 'absolute') {
    return `full output: ${spool.path}`;
  }
  return `full output: ${relativeLocator(spool.path, location)}`;
}

/**
 * `text` when it fits `window`; otherwise a fitting prefix
 * ({@link fittingPrefixLength}, measured to fit), ended at the last line
 * break when one lies in the window's last 20% and that shorter body still
 * measures within the window, else at the prefix end itself (never inside a
 * surrogate pair).
 */
function fitWindow(
  text: string,
  window: TextBudget,
): { body: string; cut: CutKind } {
  if (fitsBudget(text, window)) {
    return { body: text, cut: 'none' };
  }
  const end = fittingPrefixLength(text, window);
  const lineBreak = end > 0 ? text.lastIndexOf('\n', end - 1) : -1;
  if (lineBreak >= 0 && lineBreak >= end * (1 - LINE_BREAK_WINDOW_SHARE)) {
    const body =
      text[lineBreak - 1] === '\r'
        ? text.slice(0, lineBreak - 1)
        : text.slice(0, lineBreak);
    if (fitsBudget(body, window)) {
      return { body, cut: 'line' };
    }
  }
  return { body: text.slice(0, end), cut: 'mid-line' };
}

function renderTrailer(parts: {
  readonly reducer: string;
  readonly cut: CutKind;
  readonly shownTokens: number;
  readonly totalTokens: number;
  readonly where: string;
}): string {
  const reducer = parts.reducer.slice(0, MAX_REDUCER_CHARS);
  const partial =
    parts.cut === 'none'
      ? ''
      : parts.cut === 'line'
        ? ' — partial, cut at a line end'
        : ' — partial, cut mid-line';
  return (
    `[reduced: ${reducer}${partial} — showing ${parts.shownTokens} of ` +
    `${parts.totalTokens} tokens — ${parts.where}]`
  );
}

/**
 * Last resort when the budget step itself failed: the raw text's longest
 * fitting prefix plus a trailer that says nothing was saved. If measuring
 * fails too, the prefix is bounded by chars alone at the worst case of
 * {@link WORST_TOKENS_PER_CHAR} tokens per char, and if even that result
 * cannot be verified, the trailer alone is returned. Never throws.
 */
function plainCut(
  raw: string,
  budget: TextBudget,
  error: unknown,
): OutputBudgetOutcome {
  const trailer = `[reduced: none — partial, cut mid-line — full output could not be saved: ${errorName(error)}]`;
  const trailerOnly: OutputBudgetOutcome = {
    text: trailer,
    reduced: false,
    truncated: true,
    reducer: 'none',
    rawTokens: 0,
    returnedTokens: 0,
    totalChars: raw.length,
  };
  try {
    const reserve =
      Buffer.byteLength(trailer + TRAILER_SEPARATOR, 'utf8') +
      BOUNDARY_TOKEN_SLACK;
    const room: TextBudget = {
      tokens: Math.max(0, budget.tokens - reserve),
      chars: Math.max(0, budget.chars - reserve),
    };
    let end: number;
    try {
      end = fittingPrefixLength(raw, room);
    } catch {
      end = Math.min(
        raw.length,
        room.chars,
        Math.floor(room.tokens / WORST_TOKENS_PER_CHAR),
      );
      const code = raw.charCodeAt(end - 1);
      if (end > 0 && end < raw.length && code >= 0xd800 && code <= 0xdbff) {
        end--;
      }
    }
    const cut = join(raw.slice(0, end), trailer);
    const text = fitsBudget(cut, budget) ? cut : trailer;
    return {
      text,
      reduced: false,
      truncated: true,
      reducer: 'none',
      rawTokens: safeCount(raw),
      returnedTokens: safeCount(text),
      totalChars: raw.length,
    };
  } catch {
    return trailerOnly;
  }
}

function safeCount(text: string): number {
  try {
    return countTokensPiecewise(text);
  } catch {
    return 0;
  }
}

/** Best effort: a throwing output channel never changes the result. */
function logLine(output: IOutputChannel | undefined, line: string): void {
  try {
    output?.appendLine(line);
  } catch {
    // The diagnostic line is optional; the capped result is not.
  }
}
