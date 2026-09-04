/**
 * Chunked map-and-reduce curation: turn one oversized transcript into a small,
 * bounded set of windows the curator model can read in full.
 *
 * ## Why windows instead of a bigger clamp
 *
 * `clampTranscript` keeps a head and a tail and elides the middle. On the worst
 * observed session that meant `originalChars: 366540, keptChars: 32336` — 8.8
 * percent of the transcript reached the model, and the 91 percent in the middle
 * was where the work happened. Raising the cap is not the fix: the cap exists
 * because the model has a context limit, not because 32 KB is a virtue.
 *
 * A window set costs one LLM call per window instead of one per session, so the
 * budget is stated in calls rather than characters: at most
 * {@link CURATOR_MAX_WINDOWS} extract calls plus the single resolve call the
 * pipeline already made. The common case — a transcript that fits after
 * {@link compressToolNoise} — produces exactly ONE window, so an ordinary
 * session costs precisely what it costs today.
 *
 * ## Why this is forked from `TranscriptWindowReader` rather than shared
 *
 * `skill-synthesis`'s reader indexes role-bearing turns read from JSONL through
 * an I/O seam. The curator is handed an already-rendered string — `ROLE:
 * content` records joined on a blank line, by
 * `SdkTranscriptReaderAdapter.read`. A shared engine would have to carry both
 * input shapes. What is shared is the PATTERN — pure, deterministic,
 * index-addressed windows with an explicit omission marker — and the two
 * truncation figures, so there is one number per concept across the two libs.
 *
 * Everything here is pure and deterministic. The same transcript always yields
 * the same windows, which is what lets a caller reason about a cost CEILING
 * rather than a cost average.
 */
import {
  clampTranscript,
  CURATOR_TRANSCRIPT_MAX_CHARS,
  type ClampedTranscript,
} from './clamp-transcript';

/**
 * Maximum characters in one window. Deliberately the clamp's own cap, imported
 * rather than re-declared: a window IS one model prompt, so the two numbers can
 * never be allowed to drift apart.
 */
export const CURATOR_WINDOW_MAX_CHARS = CURATOR_TRANSCRIPT_MAX_CHARS;

/**
 * Maximum windows per curation pass, and therefore the maximum extract calls.
 *
 * Eight covers 262 144 characters of COMPRESSED transcript, which is past the
 * worst session observed in the field (366 540 characters raw, tool-heavy). The
 * ceiling is what makes the cost bounded: a pathological transcript costs eight
 * calls, not one per 32 KB forever.
 */
export const CURATOR_MAX_WINDOWS = 8;

/**
 * Records are joined with a blank line by both producers of a curator
 * transcript — `SdkTranscriptReaderAdapter.read` and `composeTranscript`. The
 * same separator `clamp-transcript.ts` cuts on, kept in step by hand because
 * that file is the last-resort guard and does not export it.
 */
const RECORD_SEPARATOR = '\n\n';

/** Longest tool result kept. The figure `TranscriptWindowReader` uses. */
const TOOL_RESULT_CHARS = 600;

/** Longest Bash command kept. The figure `TranscriptWindowReader` uses. */
const BASH_COMMAND_CHARS = 80;

/** Appended to anything cut mid-value, so the model can see it was cut. */
const TRUNCATION_MARKER = '…';

/** One record of the transcript, addressed by its zero-based index. */
export interface TranscriptRecord {
  readonly index: number;
  readonly text: string;
}

/** A bounded, record-index-addressed slice, ready to send to the curator model. */
export interface CuratorWindow {
  /** Never longer than the requested `maxChars`. */
  readonly text: string;
  readonly recordIndices: readonly number[];
  /** Zero-based, for the omission marker. */
  readonly windowIndex: number;
  readonly windowCount: number;
}

/** What {@link planCuratorWindows} decided, and what it had to give up. */
export interface CuratorWindowPlan {
  readonly windows: readonly CuratorWindow[];
  /** The last-resort clamp's report, or `null` when it did not fire. */
  readonly clamped: ClampedTranscript | null;
  readonly originalChars: number;
  readonly compressedChars: number;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}${TRUNCATION_MARKER}`;
}

/** Collapse every run of whitespace to one space. Never lengthens its input. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A line that opens a new part inside a record, so a tool body stops there. */
const PART_BOUNDARY =
  /^(?:\[tool_use |\[tool_result\]|\[tool_result error\]|USER: |ASSISTANT: |#{1,3} )/;

const TOOL_RESULT_LINE = /^(\[tool_result(?: error)?\])\s?([\s\S]*)$/;
const BASH_TOOL_USE_LINE = /^\[tool_use Bash\] (.*)$/;

/**
 * The Bash command inside a `tool_use` input, or `null` when the line does not
 * carry one. The producer truncates the JSON at 1 000 characters, so a parse
 * failure is expected and means "leave the line alone".
 */
function bashCommandOf(json: string): string | null {
  if (!json.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const command = (parsed as { command?: unknown }).command;
    return typeof command === 'string' ? command : null;
  } catch {
    return null;
  }
}

/**
 * Compress `tool_use` and `tool_result` bodies. Pure, idempotent, and never
 * longer than its input.
 *
 * The curator's transcript is rendered text, not content blocks, so this reads
 * the labels `HistoryEventFactory.extractContentForCuration` writes:
 * `[tool_use <name>] <json>` and `[tool_result] <body>`. A tool result body runs
 * to the next part boundary, blank lines included — the blank lines inside a
 * 2 500-character build log are exactly the bulk worth removing.
 *
 * The two figures match `TranscriptWindowReader`'s turn renderer so there is one
 * number per concept across the two libs, not two that drift.
 */
export function compressToolNoise(transcript: string): string {
  const lines = transcript.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const result = TOOL_RESULT_LINE.exec(line);
    if (result) {
      const body: string[] = [result[2]];
      i++;
      while (i < lines.length && !PART_BOUNDARY.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      // Blank lines INSIDE the body are absorbed — they are the bulk worth
      // removing. Blank lines at its END are not: a trailing blank line is the
      // record separator, and swallowing it would weld the next record onto
      // this tool result and hide a window boundary from
      // `splitTranscriptRecords`.
      const trailing: string[] = [];
      while (body.length > 1 && body[body.length - 1].trim().length === 0) {
        trailing.unshift(body.pop() as string);
      }
      const compact = collapse(body.join(' '));
      out.push(
        compact.length === 0
          ? result[1]
          : `${result[1]} ${truncate(compact, TOOL_RESULT_CHARS)}`,
      );
      out.push(...trailing);
      continue;
    }
    const bash = BASH_TOOL_USE_LINE.exec(line);
    if (bash) {
      const command = bashCommandOf(bash[1]);
      out.push(
        command === null
          ? line
          : `[tool_use Bash] ${truncate(collapse(command), BASH_COMMAND_CHARS)}`,
      );
      i++;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}

/**
 * Split on the record separator. Never splits inside a record.
 *
 * `index` is the position in the raw split, so a blank record leaves a gap
 * rather than renumbering the records around it: the indices are addresses into
 * the transcript, not a count of what survived.
 */
export function splitTranscriptRecords(transcript: string): TranscriptRecord[] {
  const out: TranscriptRecord[] = [];
  const parts = transcript.split(RECORD_SEPARATOR);
  for (let index = 0; index < parts.length; index++) {
    const text = parts[index];
    if (text.trim().length === 0) continue;
    out.push({ index, text });
  }
  return out;
}

function buildOmissionMarker(
  omittedRecords: number,
  omittedChars: number,
  windowIndex: number,
  windowCount: number,
): string {
  const noun = omittedRecords === 1 ? 'record' : 'records';
  return `${RECORD_SEPARATOR}[… ${omittedRecords} ${noun} (${omittedChars} characters) omitted by the memory curator; this is window ${windowIndex + 1} of ${windowCount} …]`;
}

/**
 * Deterministic, non-overlapping, record-boundary windows.
 *
 * Greedy fill in transcript order: every record is served by exactly one
 * window, and the windows' `recordIndices` concatenate to a strictly ascending
 * sequence. A record longer than one window's budget is CHARACTER-truncated
 * with a marker rather than dropped — an empty window burns an LLM call for
 * nothing, and a half-record is still evidence.
 *
 * Every window reserves room for the omission marker, sized against an UPPER
 * BOUND (the whole record set, the largest window number) exactly as
 * `clampTranscript` budgets its own seam. Reserving on every window rather than
 * only the last costs about a hundred characters of a 32 KB budget and removes
 * the case analysis that would otherwise decide, mid-fill, which window is
 * last.
 */
export function buildCuratorWindows(
  records: readonly TranscriptRecord[],
  options: { maxChars: number; maxWindows: number },
): CuratorWindow[] {
  const maxChars = Math.max(1, Math.floor(options.maxChars));
  const maxWindows = Math.max(1, Math.floor(options.maxWindows));
  if (records.length === 0) return [];

  const totalChars = records.reduce((sum, r) => sum + r.text.length, 0);
  const reserve = buildOmissionMarker(
    records.length,
    totalChars,
    maxWindows,
    maxWindows,
  ).length;
  const contentBudget = Math.max(1, maxChars - reserve);

  const filled: { text: string; recordIndices: number[] }[] = [];
  let cursor = 0;
  while (cursor < records.length && filled.length < maxWindows) {
    let text = '';
    const recordIndices: number[] = [];
    while (cursor < records.length) {
      const piece = truncate(records[cursor].text, contentBudget);
      const addition =
        recordIndices.length === 0 ? piece : `${RECORD_SEPARATOR}${piece}`;
      if (text.length + addition.length > contentBudget) break;
      text += addition;
      recordIndices.push(records[cursor].index);
      cursor++;
    }
    filled.push({ text, recordIndices });
  }

  const omitted = records.slice(cursor);
  const omittedChars = omitted.reduce((sum, r) => sum + r.text.length, 0);
  const windowCount = filled.length;
  return filled.map((w, windowIndex) => {
    const isLast = windowIndex === windowCount - 1;
    const text =
      isLast && omitted.length > 0
        ? `${w.text}${buildOmissionMarker(
            omitted.length,
            omittedChars,
            windowIndex,
            windowCount,
          )}`
        : w.text;
    return { text, recordIndices: w.recordIndices, windowIndex, windowCount };
  });
}

/**
 * The whole decision, in one pure call: compress, and window only if the result
 * still does not fit.
 *
 * The `<= maxChars` short-circuit is the no-regression guarantee, and is
 * written as an explicit branch rather than left to fall out of the general
 * path: an ordinary session must reach the model as ONE window, byte for byte,
 * costing exactly the one extract call it costs today.
 *
 * `clampTranscript` still runs above the chunked budget. It is the last-resort
 * guard: a session past eight windows of compressed text has defeated every
 * cheaper defence, and the warn it produces now means "this session exceeded
 * even the chunked budget" — a different and more useful signal than the one it
 * used to carry.
 */
export function planCuratorWindows(
  transcript: string,
  options?: { maxChars?: number; maxWindows?: number },
): CuratorWindowPlan {
  const maxChars = options?.maxChars ?? CURATOR_WINDOW_MAX_CHARS;
  const maxWindows = options?.maxWindows ?? CURATOR_MAX_WINDOWS;
  const originalChars = transcript.length;
  const compressed = compressToolNoise(transcript);

  if (compressed.length <= maxChars) {
    return {
      windows: [
        {
          text: compressed,
          recordIndices: splitTranscriptRecords(compressed).map((r) => r.index),
          windowIndex: 0,
          windowCount: 1,
        },
      ],
      clamped: null,
      originalChars,
      compressedChars: compressed.length,
    };
  }

  const clamp = clampTranscript(compressed, maxChars * maxWindows);
  const records = splitTranscriptRecords(clamp.text);
  return {
    windows: buildCuratorWindows(records, { maxChars, maxWindows }),
    clamped: clamp.clamped ? clamp : null,
    originalChars,
    compressedChars: compressed.length,
  };
}
