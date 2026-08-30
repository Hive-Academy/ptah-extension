/**
 * The hard ceiling on what the memory curator may send to an LLM, and the
 * deterministic shape it cuts an oversized transcript down to.
 *
 * ## Why this exists
 *
 * The curator had no cap at all. `MAX_JSONL_BYTES` in
 * `triggers/memory-trigger.service.ts` clamps the JSONL excerpt inside
 * `composeTranscript`, but `composeTranscript` is only on the LIVE trigger
 * path — the boot scan called `transcriptReader.read()` with no `tailBytes`
 * and handed the whole formatted session straight to `curate()`. A 268-turn
 * session produced a 170 655-character prompt (`tmp/logs/log.log:1017`) on one
 * boot. Nothing below that point defends: the curator adapter forwards `prompt`
 * verbatim and `SdkQueryRunner` only logs its length.
 *
 * The clamp therefore lives at the pipeline's single chokepoint
 * (`MemoryCuratorService.doCurate`) rather than at any one call site, so a
 * future caller cannot reintroduce the fault by forgetting a parameter.
 *
 * ## Why head AND tail, weighted to the tail
 *
 * A tail-only window — which is what `composeTranscript` does — is right for a
 * COMPACTION transcript, where the caller already knows the head was
 * summarised. It is wrong for a whole session: the opening turns carry the
 * user's stated goal and constraints, which is precisely the durable knowledge
 * `EXTRACT_SYSTEM_PROMPT` asks for, and a tail-only cut throws them away first.
 * The tail keeps the larger share because it holds the outcome AND the
 * already-summarised `# Structured observations` / `# Episode summary` sections
 * that `composeTranscript` appends after the excerpt — material that is bounded
 * by construction and denser per character than the transcript around it.
 *
 * ## Why the marker is not optional
 *
 * The model is told it is reading a transcript. Splicing two disjoint halves
 * together with no seam invites it to infer a causal link across the join that
 * the session never contained. The marker says, in the transcript's own
 * language, that material is missing and how much.
 */

/**
 * Maximum characters of transcript the curator will send.
 *
 * 32 KB, deliberately the same figure as `MAX_JSONL_BYTES` on the live trigger
 * path: the two paths feed the same prompt to the same model, and a boot-scan
 * transcript is not more valuable than a compaction one. Matching them means
 * there is one number to reason about rather than two that drift.
 */
export const CURATOR_TRANSCRIPT_MAX_CHARS = 32 * 1024;

/**
 * Share of the budget given to the head. The remainder, minus the marker, is
 * the tail. See the file docblock for why the split is not 50/50.
 */
const HEAD_SHARE = 0.25;

/**
 * Records are joined with a blank line by both producers —
 * `SdkTranscriptReaderAdapter.read` (`ROLE: content` joined on `\n\n`) and
 * `composeTranscript` (sections joined on `\n\n`). Cutting on that boundary is
 * what keeps a kept fragment readable instead of ending mid-word.
 */
const RECORD_SEPARATOR = '\n\n';

/**
 * How far back from a budget edge a record boundary may be to be worth using.
 * Beyond this the boundary cut would throw away more signal than the ragged
 * edge costs, so the exact character budget wins.
 */
const BOUNDARY_SEARCH_CHARS = 2_000;

export interface ClampedTranscript {
  /** The text to send. Never longer than the requested cap. */
  readonly text: string;
  /** Length of the input. */
  readonly originalChars: number;
  /** Length of {@link text}. */
  readonly keptChars: number;
  /** Characters of the input that are not represented in {@link text}. */
  readonly droppedChars: number;
  /** Records (blank-line-separated blocks) fully elided. */
  readonly droppedRecords: number;
  /** Whether anything was removed at all. */
  readonly clamped: boolean;
}

function buildMarker(droppedChars: number, droppedRecords: number): string {
  return `${RECORD_SEPARATOR}[… ${droppedChars} characters (${droppedRecords} records) elided by the memory curator …]${RECORD_SEPARATOR}`;
}

/**
 * The widest cut at or before `limit` that lands on a record boundary, or
 * `limit` itself when no boundary sits within {@link BOUNDARY_SEARCH_CHARS}.
 */
function headCut(text: string, limit: number): number {
  const from = Math.max(0, limit - BOUNDARY_SEARCH_CHARS);
  const boundary = text.lastIndexOf(RECORD_SEPARATOR, limit);
  return boundary >= from && boundary > 0 ? boundary : limit;
}

/**
 * The earliest cut at or after `from` that lands on a record boundary, or
 * `from` itself when no boundary sits within {@link BOUNDARY_SEARCH_CHARS}.
 */
function tailCut(text: string, from: number): number {
  const boundary = text.indexOf(RECORD_SEPARATOR, from);
  if (boundary < 0) return from;
  const cut = boundary + RECORD_SEPARATOR.length;
  return cut - from <= BOUNDARY_SEARCH_CHARS ? cut : from;
}

function countRecords(text: string): number {
  if (text.length === 0) return 0;
  return text.split(RECORD_SEPARATOR).filter((r) => r.trim().length > 0).length;
}

/**
 * Cut `text` down to at most `maxChars`, keeping the head and the tail.
 *
 * Pure and deterministic: the same input always yields the same output, which
 * is what lets a caller reason about a cost ceiling rather than a cost average.
 * The returned `text` is never longer than `maxChars`; a cap too small to hold
 * even the marker degrades to a plain tail slice rather than returning
 * something longer than the caller asked for.
 */
export function clampTranscript(
  text: string,
  maxChars: number = CURATOR_TRANSCRIPT_MAX_CHARS,
): ClampedTranscript {
  const originalChars = text.length;
  const limit =
    Number.isFinite(maxChars) && maxChars > 0
      ? Math.floor(maxChars)
      : CURATOR_TRANSCRIPT_MAX_CHARS;

  if (originalChars <= limit) {
    return {
      text,
      originalChars,
      keptChars: originalChars,
      droppedChars: 0,
      droppedRecords: 0,
      clamped: false,
    };
  }

  // The marker's own length depends on the numbers it reports, which depend on
  // where the cuts land, which depends on the marker's length. That circle is
  // broken by budgeting against an UPPER BOUND: no count the marker can carry
  // exceeds `originalChars` (a record is at least one character), so a marker
  // built from `originalChars` twice is at least as long as the real one in
  // every case. Reserving that much means the real marker always fits, so the
  // tail is never trimmed after the fact — which is what keeps the number the
  // marker PRINTS equal to the `droppedChars` this function REPORTS. It costs a
  // handful of characters of budget and buys an invariant.
  const provisional = buildMarker(originalChars, originalChars);
  if (provisional.length >= limit) {
    // No room for a seam. A bare tail is the honest degradation: it is what the
    // live trigger path already does, and it never exceeds the cap.
    const tail = text.slice(originalChars - limit);
    return {
      text: tail,
      originalChars,
      keptChars: tail.length,
      droppedChars: originalChars - tail.length,
      droppedRecords: countRecords(text.slice(0, originalChars - limit)),
      clamped: true,
    };
  }

  const contentBudget = limit - provisional.length;
  const headBudget = Math.max(1, Math.floor(contentBudget * HEAD_SHARE));
  const tailBudget = contentBudget - headBudget;

  const headEnd = headCut(text, headBudget);
  const tailStart = tailCut(text, originalChars - tailBudget);

  // Boundary snapping moves both cuts outward-safe (head only shrinks, tail
  // only shrinks), so the halves can never overlap. Guard anyway: a pathological
  // input is not worth a wrong answer.
  const safeTailStart = Math.max(tailStart, headEnd);

  const head = text.slice(0, headEnd);
  const tail = text.slice(safeTailStart);
  const elided = text.slice(headEnd, safeTailStart);

  const droppedRecords = countRecords(elided);
  const marker = buildMarker(elided.length, droppedRecords);
  const out = `${head}${marker}${tail}`;

  return {
    text: out,
    originalChars,
    keptChars: out.length,
    // Equal to `elided.length` by construction — see the upper-bound budget
    // above. Written as the difference anyway, because it is the definition
    // ("input characters represented nowhere in the output") and the identity
    // is what the spec pins.
    droppedChars: originalChars - head.length - tail.length,
    droppedRecords,
    clamped: true,
  };
}
