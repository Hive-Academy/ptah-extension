/**
 * The stdio agent tools' `structuredContent`, held to the tool's result
 * budget (TASK_2026_559, reviews r3 R3-05 and r4 R4-02).
 *
 * A host may read `structuredContent` instead of `content` (VS Code's MCP
 * host serialises it into the model's input and skips the text), so the
 * text budget alone does not bound what the model receives. A value whose
 * JSON fits the budget is returned unchanged. A larger one becomes a smaller
 * plain object — valid JSON, never a cut JSON string — that keeps:
 *
 * - every number, boolean, null and short string at the top level (the
 *   agent id, status, mode, counts);
 * - the first items of each array, each item reduced to those same scalar
 *   fields, shortest array first;
 * - a prefix of each long string, in the room left;
 * - a `ptah_truncation` note: which fields were omitted or cut, how many
 *   items of each array are shown, and the spool files holding the full
 *   structured value (as JSON) and the full text.
 *
 * The returned object's JSON satisfies BOTH limits of the budget, disclosure
 * metadata included: a long string is listed in `omittedFields` before any
 * value is filled (so dropping it later never grows the note), and the final
 * object is measured again before it is returned. When it does not fit with
 * absolute spool paths, the paths are shown relative to the spool root
 * (bounded whatever the root's length); when even the fields' skeleton cannot
 * fit, only the recovery note is returned, itself measured, down to a bare
 * `{ truncated, limitChars }` note (and `{}` for a budget too small even for
 * that).
 */
import {
  fitsBudget,
  type TextBudget,
} from '@ptah-extension/tool-output-reducers';
import {
  relativeSpoolLocator,
  type SpoolOutcome,
} from '../mcp-core/tool-result-budget';

/** The key of the truncation note; `ptah_` keeps it apart from tool fields. */
export const STRUCTURED_TRUNCATION_KEY = 'ptah_truncation';

/** Longest string kept whole; a longer one is cut to the room left, or omitted. */
const MAX_WHOLE_STRING_CHARS = 128;
/** A cut string shorter than this carries nothing useful and is omitted instead. */
const MIN_CUT_STRING_CHARS = 32;

export interface StructuredRecovery {
  /** Where the full structured value was saved as JSON, or why it could not be. */
  readonly structured: SpoolOutcome;
  /** The spool file of the full text result, when the text budget wrote one. */
  readonly textSpoolPath?: string;
  /** The root both spool files were written under (`spoolToolText`'s `spoolRoot`). */
  readonly spoolRoot: string;
}

interface Shown {
  shown: number;
  total: number;
}

/** What every note carries: the limit and where the full value is. */
interface RecoveryNote {
  readonly truncated: true;
  readonly limitChars: number;
  readonly fullStructuredContent?: string;
  readonly spoolFailure?: string;
  readonly fullText?: string;
}

interface TruncationNote extends RecoveryNote {
  readonly omittedFields: string[];
  readonly cutFields: Record<string, Shown>;
  readonly lists: Record<string, Shown>;
}

type Locator = 'absolute' | 'relative';

/** Whether `value`'s JSON is within `budget` (chars and tokens). */
export function structuredContentFits(
  value: Record<string, unknown>,
  budget: TextBudget,
): boolean {
  return fitsBudget(JSON.stringify(value), budget);
}

/**
 * `value` reduced to fit `budget` as JSON, with a truncation note naming the
 * recovery files. Call only for a value that does not fit.
 */
export function boundStructuredContent(
  value: Record<string, unknown>,
  budget: TextBudget,
  recovery: StructuredRecovery,
): Record<string, unknown> {
  const notes = (['absolute', 'relative'] as const).map((locator) =>
    recoveryNote(budget, recovery, locator),
  );
  for (const note of notes) {
    const bounded = fillWithin(value, budget, note);
    if (bounded !== undefined && structuredContentFits(bounded, budget)) {
      return bounded;
    }
  }
  for (const note of notes) {
    const only = {
      [STRUCTURED_TRUNCATION_KEY]: { ...note, allFieldsOmitted: true },
    };
    if (structuredContentFits(only, budget)) {
      return only;
    }
  }
  const bare = {
    [STRUCTURED_TRUNCATION_KEY]: { truncated: true, limitChars: budget.chars },
  };
  return structuredContentFits(bare, budget) ? bare : {};
}

/** The recovery part of the note, with the spool paths shown as `locator`. */
function recoveryNote(
  budget: TextBudget,
  recovery: StructuredRecovery,
  locator: Locator,
): RecoveryNote {
  const show = (file: string): string =>
    locator === 'absolute'
      ? file
      : relativeSpoolLocator(file, recovery.spoolRoot);
  return {
    truncated: true,
    limitChars: budget.chars,
    ...('path' in recovery.structured
      ? { fullStructuredContent: show(recovery.structured.path) }
      : { spoolFailure: recovery.structured.failure }),
    ...(recovery.textSpoolPath !== undefined
      ? { fullText: show(recovery.textSpoolPath) }
      : {}),
  };
}

/**
 * `value`'s fields filled into `budget` next to a note built on `recovery`,
 * or `undefined` when not even the fields' skeleton fits. Each mutation is
 * measured; the caller measures the result once more.
 */
function fillWithin(
  value: Record<string, unknown>,
  budget: TextBudget,
  recovery: RecoveryNote,
): Record<string, unknown> | undefined {
  const note: TruncationNote = {
    ...recovery,
    omittedFields: [],
    cutFields: {},
    lists: {},
  };
  const out: Record<string, unknown> = {};
  const fits = (): boolean =>
    structuredContentFits(
      { ...out, [STRUCTURED_TRUNCATION_KEY]: note },
      budget,
    );

  const arrays: Array<[string, readonly unknown[]]> = [];
  const longStrings: Array<[string, string]> = [];
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined) {
      continue;
    }
    if (isWholeScalar(field)) {
      out[key] = field;
    } else if (Array.isArray(field)) {
      out[key] = [];
      note.lists[key] = { shown: 0, total: field.length };
      arrays.push([key, field]);
    } else if (typeof field === 'string') {
      // Reserved as omitted until a prefix of it is shown, so the room the
      // omission takes is counted before any value is filled.
      note.omittedFields.push(key);
      longStrings.push([key, field]);
    } else if (isPlainObject(field)) {
      out[key] = scalarFields(field);
    } else {
      note.omittedFields.push(key);
    }
  }

  // Fields kept whole go last-first until the skeleton fits.
  const kept = Object.keys(out).filter((key) => !(key in note.lists));
  while (!fits() && kept.length > 0) {
    const key = kept.pop() as string;
    delete out[key];
    note.omittedFields.push(key);
  }
  if (!fits()) {
    return undefined;
  }

  arrays.sort((a, b) => a[1].length - b[1].length);
  for (const [key, items] of arrays) {
    fillArray(out[key] as unknown[], note.lists[key], items, fits);
  }

  for (const [key, text] of longStrings) {
    const slot = note.omittedFields.indexOf(key);
    note.omittedFields.splice(slot, 1);
    const keepPrefix = (length: number): boolean => {
      out[key] = text.slice(0, length);
      note.cutFields[key] = { shown: length, total: text.length };
      return fits();
    };
    let length = longestFittingPrefix(text, keepPrefix);
    // The note's digit count can make the found length one step too long.
    while (length >= MIN_CUT_STRING_CHARS && !keepPrefix(length)) {
      length = safeEnd(text, length - 1);
    }
    if (length < MIN_CUT_STRING_CHARS) {
      // Back to the reserved state, which was measured to fit.
      delete out[key];
      delete note.cutFields[key];
      note.omittedFields.splice(slot, 0, key);
    }
  }

  return { ...out, [STRUCTURED_TRUNCATION_KEY]: note };
}

/** Appends `items`' representations in order while the whole still fits. */
function fillArray(
  target: unknown[],
  shown: Shown,
  items: readonly unknown[],
  fits: () => boolean,
): void {
  for (const item of items) {
    const entry = isWholeScalar(item)
      ? item
      : isPlainObject(item)
        ? scalarFields(item)
        : undefined;
    if (entry === undefined) {
      return;
    }
    target.push(entry);
    shown.shown++;
    if (!fits()) {
      target.pop();
      shown.shown--;
      return;
    }
  }
}

/**
 * The longest prefix length of `text` (never ending inside a surrogate pair)
 * for which `fits` holds, by binary search.
 */
function longestFittingPrefix(
  text: string,
  fits: (length: number) => boolean,
): number {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(safeEnd(text, mid))) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return safeEnd(text, low);
}

function safeEnd(text: string, end: number): number {
  const code = text.charCodeAt(end - 1);
  return end > 0 && end < text.length && code >= 0xd800 && code <= 0xdbff
    ? end - 1
    : end;
}

function isWholeScalar(
  value: unknown,
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.length <= MAX_WHOLE_STRING_CHARS)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value`'s top-level numbers, booleans, nulls and short strings. */
function scalarFields(value: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (isWholeScalar(field)) {
      kept[key] = field;
    }
  }
  return kept;
}
