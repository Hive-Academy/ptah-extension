/**
 * Tool-result budget (TASK_2026_559, User Decisions 2 and 7).
 *
 * Every text result an MCP tool returns goes through
 * {@link applyToolResultBudget}:
 *
 * 1. Under the tool's budget → the raw text, byte-for-byte. Nothing is
 *    spooled, because nothing was withheld.
 * 2. Over it → `reduceOutput` (content detection + the per-kind reducer; the
 *    per-tool hint in {@link TOOL_CONTENT_HINTS} wins over sniffing).
 * 3. Still over either limit (reducers may return more than the budget) →
 *    cut at the last line break inside the window, or at the limit itself
 *    when the window's last 20% has no line break (single-line JSON). The
 *    log reducer fits the window itself, keeping failures and the summary
 *    before the head, so a log reaches this cut only when one line is over.
 * 4. Whenever the returned text differs from the raw text, the raw text is
 *    spooled to `<spoolRoot>/.ptah/tmp/mcp-out/<id>-<epoch ms>-<4 hex>.txt`
 *    and a trailer names the reducer, the token counts and the spool path
 *    (or the reason the spool failed). A spool path too long for a quarter
 *    of the budget is shown relative to its root instead.
 *
 * The returned text, trailer included, satisfies BOTH limits of the tool's
 * budget: the final string is measured with the upper-bound token count and
 * the cut is repeated with a smaller window until it fits, down to the
 * trailer alone. The write path is the spool file only; no setting or config
 * file is written. This function never throws: a spool failure is reported
 * in the trailer, and an unexpected error (or a throwing output channel)
 * falls back to a plain char cut. Error details never reach the text or the
 * log: only a built-in error name or a validated errno code does.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import { SURFACE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  countTokensPiecewise,
  fitsBudget,
  fittingPrefixLength,
  reduceOutput,
  type CodeOutliner,
  type ContentKind,
  type TextBudget,
} from '@ptah-extension/tool-output-reducers';

/** Default token budget: the token equivalent of User Decision 2's 8,000 chars (~4 chars/token). */
export const DEFAULT_TOOL_RESULT_BUDGET_TOKENS = 2000;
/** Default hard char ceiling; what `_meta['anthropic/maxResultSizeChars']` declares. */
export const DEFAULT_TOOL_RESULT_BUDGET_CHARS = 8000;

/** Chars per token used to express a char-denominated override in tokens. */
const CHARS_PER_TOKEN = 4;

/**
 * `formatBrowserContent` caps the page text at 32 KiB
 * (`mcp-response-formatter.ts`, `MAX_TEXT_LENGTH`); 1 KiB more covers its
 * Markdown header, fences and truncation marker. The text section comes
 * first, so the cut keeps the whole capped text.
 */
const BROWSER_CONTENT_CHARS = 32 * 1024 + 1024;

function charBudget(chars: number): TextBudget {
  return Object.freeze({ tokens: Math.ceil(chars / CHARS_PER_TOKEN), chars });
}

/**
 * Tools whose own description documents a larger bound. Nothing else is
 * overridden. `ptah_surface_get_state` promises that the whole answer stays
 * within `maxStateReadBytes` UTF-8 bytes; a UTF-16 length never exceeds the
 * UTF-8 byte length of the same text, so the byte bound is a valid char bound.
 */
export const TOOL_RESULT_BUDGET_OVERRIDES: Readonly<
  Record<string, TextBudget>
> = Object.freeze({
  ptah_browser_content: charBudget(BROWSER_CONTENT_CHARS),
  ptah_surface_get_state: charBudget(SURFACE_LIMITS.maxStateReadBytes),
});

/**
 * Tools whose formatter already owns a documented reduction: no content
 * reducer runs on them, only the cut (so the diagnostics requested-files-first
 * order of Batch 1 is never undone by a generic reducer). The paged tools keep
 * their own page unit.
 */
export const TOOL_CONTENT_HINTS: Readonly<Record<string, ContentKind>> =
  Object.freeze({
    ptah_get_diagnostics: 'preformatted',
    ptah_get_symbol_index: 'preformatted',
    ptah_agent_read: 'preformatted',
    ptah_task_list: 'preformatted',
  });

const DEFAULT_BUDGET: TextBudget = Object.freeze({
  tokens: DEFAULT_TOOL_RESULT_BUDGET_TOKENS,
  chars: DEFAULT_TOOL_RESULT_BUDGET_CHARS,
});

/** The budget of `toolName`: its override, else the default. */
export function getToolResultBudget(toolName: string): TextBudget {
  return Object.hasOwn(TOOL_RESULT_BUDGET_OVERRIDES, toolName)
    ? TOOL_RESULT_BUDGET_OVERRIDES[toolName]
    : DEFAULT_BUDGET;
}

export interface ApplyToolResultBudgetInput {
  /** The tool's formatted success text. */
  readonly text: string;
  readonly toolName: string;
  /** JSON-RPC id of the call; only names the spool file. */
  readonly requestId: string | number | null | undefined;
  /**
   * Absolute directory the spool tree goes under (the caller's workspace
   * root, else the workspace root, else `os.tmpdir()`, resolved by the
   * caller). A relative or empty value falls back to `os.tmpdir()`.
   */
  readonly spoolRoot: string;
  readonly outliner?: CodeOutliner;
  /** Receives one line when a reducer throws or the budget step fails. */
  readonly output?: IOutputChannel;
}

export interface ToolResultBudgetOutcome {
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

/** Relative location of the spool directory under the spool root. */
const SPOOL_SUBDIR = path.join('.ptah', 'tmp', 'mcp-out');
/** Spool files older than this are deleted when a new one is written. */
const SPOOL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A directory is pruned at most this often (a day of spools can be many files). */
const SPOOL_PRUNE_INTERVAL_MS = 10 * 60 * 1000;
/** Spool directories whose last prune time is remembered; the map is cleared past this. */
const MAX_PRUNE_ENTRIES = 64;
/** Fresh names tried when one already exists. */
const SPOOL_NAME_ATTEMPTS = 8;
/** Longest id part of a spool file name. */
const MAX_ID_CHARS = 64;
/** Names this module writes; pruning never touches anything else. */
const SPOOL_FILE_NAME = /^[A-Za-z0-9_-]{1,64}-\d{1,16}-[0-9a-f]{4}\.txt$/;

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
/** Cut passes with a smaller window when the final text still measures over the budget. */
const MAX_FIT_PASSES = 4;
/**
 * Upper bound of byte-level BPE tokens per UTF-16 unit (a BMP char is at most
 * 3 UTF-8 bytes, a surrogate pair 4 bytes over 2 units), for the last resort.
 */
const WORST_TOKENS_PER_CHAR = 3;

/**
 * Error names a trailer or log line may print. A custom `name` is arbitrary
 * text (a path, content), so anything else prints as `Error`.
 */
const REPORTED_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
  'AggregateError',
]);

/** Last prune time per spool directory, for {@link SPOOL_PRUNE_INTERVAL_MS}. */
const lastPruneByDir = new Map<string, number>();

type CutKind = 'none' | 'line' | 'mid-line';
type SpoolOutcome = { readonly path: string } | { readonly failure: string };

/** Where spool files go, and how a relative locator names the root. */
interface SpoolLocation {
  readonly dir: string;
  readonly rootLabel: 'workspace root' | 'system temp directory';
}

/** How the trailer names the spooled file. */
type Locator = 'absolute' | 'relative';

export async function applyToolResultBudget(
  input: ApplyToolResultBudgetInput,
): Promise<ToolResultBudgetOutcome> {
  const budget = getToolResultBudget(input.toolName);
  try {
    return await budgetText(input, budget);
  } catch (error) {
    logLine(
      input.output,
      `[tool-result-budget] ${input.toolName} budget step failed with ` +
        `${errorName(error)}; returning a plain cut`,
    );
    return plainCut(input.text, budget, error);
  }
}

async function budgetText(
  input: ApplyToolResultBudgetInput,
  budget: TextBudget,
): Promise<ToolResultBudgetOutcome> {
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
  const result = await reduceOutput(raw, {
    budgetTokens: window.tokens,
    budgetChars: window.chars,
    hint: Object.hasOwn(TOOL_CONTENT_HINTS, input.toolName)
      ? TOOL_CONTENT_HINTS[input.toolName]
      : undefined,
    outliner: input.outliner,
    output: input.output,
  });

  const spool = await spoolRaw(raw, location.dir, input.requestId);
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
  const relative = path.join(SPOOL_SUBDIR, path.basename(spool.path));
  return `full output: ${relative} under the ${location.rootLabel}`;
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
 * The spool directory under an absolute `spoolRoot`, else under
 * `os.tmpdir()`, and which of the two a relative locator names.
 */
function spoolLocation(spoolRoot: string): SpoolLocation {
  const usable =
    typeof spoolRoot === 'string' &&
    spoolRoot.trim() !== '' &&
    path.isAbsolute(spoolRoot);
  const tmp = path.resolve(os.tmpdir());
  const root = usable ? path.resolve(spoolRoot) : tmp;
  return {
    dir: path.join(root, SPOOL_SUBDIR),
    rootLabel: root === tmp ? 'system temp directory' : 'workspace root',
  };
}

/**
 * `<sanitised id>-<epoch ms>-<4 hex>.txt`; the id keeps only
 * `[A-Za-z0-9_-]`, so a name never leaves the spool directory.
 */
function spoolFileName(
  requestId: ApplyToolResultBudgetInput['requestId'],
  hex = randomBytes(2).toString('hex'),
): string {
  const id =
    String(requestId ?? '')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, MAX_ID_CHARS) || 'call';
  return `${id}-${Date.now()}-${hex}.txt`;
}

/**
 * Writes `raw` to a fresh file in `dir`. The exclusive-create flag means an
 * existing file (two sessions with the same JSON-RPC id in the same
 * millisecond and the same random suffix) is never overwritten: another name
 * is tried. A partial file left by a failed write is removed. Never throws.
 */
async function spoolRaw(
  raw: string,
  dir: string,
  requestId: ApplyToolResultBudgetInput['requestId'],
): Promise<SpoolOutcome> {
  try {
    await fs.mkdir(dir, { recursive: true });
    for (let attempt = 0; attempt < SPOOL_NAME_ATTEMPTS; attempt++) {
      const file = path.join(dir, spoolFileName(requestId));
      try {
        await fs.writeFile(file, raw, { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          continue;
        }
        // degradation-audit: reported — best-effort removal of the partial
        // file; the write failure itself is rethrown on the next line.
        await fs.rm(file, { force: true }).catch(() => undefined);
        throw error;
      }
      await pruneSpoolDirectory(dir);
      return { path: file };
    }
    return { failure: 'no free spool file name' };
  } catch (error) {
    return { failure: errorCode(error) ?? errorName(error) };
  }
}

/**
 * Best effort: deletes this module's spool files older than 24 hours, at
 * most once per {@link SPOOL_PRUNE_INTERVAL_MS} per directory. Every failure
 * (a file removed concurrently, a permission error) is ignored.
 */
async function pruneSpoolDirectory(dir: string): Promise<void> {
  const now = Date.now();
  const last = lastPruneByDir.get(dir);
  if (last !== undefined && now - last < SPOOL_PRUNE_INTERVAL_MS) {
    return;
  }
  if (lastPruneByDir.size >= MAX_PRUNE_ENTRIES) {
    // Forgetting only costs an early prune of some directory.
    lastPruneByDir.clear();
  }
  lastPruneByDir.set(dir, now);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !SPOOL_FILE_NAME.test(entry.name)) {
        continue;
      }
      const file = path.join(dir, entry.name);
      try {
        const stat = await fs.stat(file);
        if (now - stat.mtimeMs > SPOOL_MAX_AGE_MS) {
          await fs.unlink(file);
        }
      } catch {
        // Removed or locked by someone else: skip it.
      }
    }
  } catch {
    // The directory could not be listed; pruning is best effort.
  }
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
): ToolResultBudgetOutcome {
  const trailer = `[reduced: none — partial, cut mid-line — full output could not be saved: ${errorName(error)}]`;
  const trailerOnly: ToolResultBudgetOutcome = {
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

/** The errno code of `error` when it is one (`EACCES`, `EROFS`…), else `undefined`. */
function errorCode(error: unknown): string | undefined {
  try {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' && /^E[A-Z0-9]{1,30}$/.test(code)
      ? code
      : undefined;
  } catch {
    // degradation-audit: reported — a throwing `code` getter only loses the
    // errno; the caller still reports the failure, by `errorName` instead.
    return undefined;
  }
}

/** A fixed classification of `error`: a built-in error name, `Error`, or the `typeof`. */
function errorName(error: unknown): string {
  try {
    if (!(error instanceof Error)) {
      return typeof error;
    }
    const name: unknown = error.name;
    return typeof name === 'string' && REPORTED_ERROR_NAMES.has(name)
      ? name
      : 'Error';
  } catch {
    // degradation-audit: reported — a throwing `name` getter is classified
    // as `Error`; the failure is still reported under that name.
    return 'Error';
  }
}
