/**
 * Agent Output Retention
 *
 * Every bound the agent-monitor card puts on a running agent's output lives
 * here: the stdout/stderr byte cap, the structured-segment cap and the
 * stream-event cap.
 *
 * ## The one rule all three obey
 *
 * **Silent truncation of a user's own content is a defect, not an
 * optimization.** A cap the user cannot see is indistinguishable from data
 * corruption, because nothing on screen says anything was ever there. So each
 * cap either FOLDS what it drops back into what survives, or it leaves a
 * marker saying what went — and the marker is emitted whether or not the fold
 * succeeded (TASK_2026_335).
 *
 * The caps themselves are not negotiable: they were measured as necessary in
 * TASK_2026_323, and raising one is not a fix for the silence.
 */

import type {
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';

// ============================================================================
// stdout / stderr byte buffer
// ============================================================================

/** Maximum stdout/stderr buffer per agent in the frontend (50KB) */
export const MAX_FRONTEND_BUFFER = 50 * 1024;

/**
 * The head-of-buffer notice `capBuffer` leaves behind, as one line.
 *
 * Written and read back by `capBuffer` itself, so the count is CUMULATIVE
 * across every trim of the same buffer rather than the size of the last one.
 * Exported as a predicate so the agent card's stdout parser can render it as a
 * distinct informational block instead of letting it read as agent prose.
 */
const BUFFER_TRUNCATION_NOTICE =
  /^… (\d+) characters of earlier output were dropped to bound this card\.\n/;

function bufferTruncationNotice(dropped: number): string {
  return `… ${dropped} characters of earlier output were dropped to bound this card.\n`;
}

/** True for the exact line {@link capBuffer} prepends to a truncated buffer. */
export function isOutputTruncationNotice(line: string): boolean {
  return BUFFER_TRUNCATION_NOTICE.test(`${line.trim()}\n`);
}

/**
 * Front-truncate a stdout/stderr buffer to `max`, snapping to a line boundary
 * where one is available, and state at the head how much was lost.
 *
 * The notice is stripped and re-issued on every call rather than being
 * truncated along with the rest of the buffer. That keeps two properties the
 * naive version had neither of: the notice always survives (it is the head of
 * the string, which is exactly the part this function eats), and its count is
 * the total dropped over the agent's life rather than whatever the most recent
 * call happened to remove.
 */
export function capBuffer(str: string, max: number): string {
  const match = BUFFER_TRUNCATION_NOTICE.exec(str);
  const alreadyDropped = match ? Number(match[1]) : 0;
  const body = match ? str.slice(match[0].length) : str;

  if (body.length <= max) return str;

  const excess = body.length - max;
  const newlineIndex = body.indexOf('\n', excess);
  const cutAt = newlineIndex > -1 ? newlineIndex + 1 : excess;

  return bufferTruncationNotice(alreadyDropped + cutAt) + body.slice(cutAt);
}

// ============================================================================
// Structured output segments (Codex / Copilot SDK adapters)
// ============================================================================

/**
 * Maximum structured output segments retained per agent card (Codex/Copilot
 * SDK adapters). Uncapped, a long agent run accumulated one segment per token
 * AND re-copied the whole array on every delta.
 */
export const MAX_AGENT_SEGMENTS = 500;

/**
 * Recent segments always kept whatever their type, so an agent's final answer
 * survives the trim. Mirrors `AGENT_STREAM_EVENTS_TAIL_RESERVE`.
 */
const AGENT_SEGMENTS_TAIL_RESERVE = 100;

/**
 * Overshoot tolerated before a re-trim runs, mirroring
 * {@link AGENT_STREAM_EVENTS_CAP_SLACK}.
 *
 * The predecessor `slice(-MAX)` re-copied the whole 500-element array on EVERY
 * delta once the cap was reached, because the array is back over the limit as
 * soon as one more segment lands. Folding does more work per trim than a slice
 * does, so without slack this would have been a real cost on a per-token path.
 * With it, one trim is amortized over this many segments — strictly cheaper
 * than what it replaces.
 */
const AGENT_SEGMENTS_CAP_SLACK = 100;

/**
 * Slots held back from the cap for the synthetic entries a trim emits: the
 * marker, plus at most one fold per foldable segment type.
 */
const MAX_SYNTHETIC_SEGMENTS = 3;

/**
 * Segment types that establish structure in `AgentMonitorTreeBuilderService`
 * and are preserved ahead of plain prose when capping.
 *
 * `info` is here because Codex and Copilot report per-turn token usage as an
 * `info` segment, and the card's stats bar is derived by re-reading them —
 * dropping the old ones silently rewrites the token totals.
 */
const LANDMARK_SEGMENT_TYPES: ReadonlySet<string> = new Set([
  'tool-call',
  'tool-result',
  'tool-result-error',
  'command',
  'file-change',
  'error',
  'info',
]);

/**
 * The head-of-card marker `capSegments` leaves behind.
 *
 * Recognised on the way back IN as well as written on the way out: a marker
 * from an earlier trim is never re-kept as an ordinary `info` landmark (which
 * would stack a fresh marker on top of it on every trim, until the head of a
 * long agent's card was nothing but markers). It is absorbed instead, and its
 * two counts roll into the new one.
 */
const SEGMENT_TRUNCATION_MARKER =
  /^… (\d+) earlier output segments were trimmed to bound this card \((\d+) preserved below, (\d+) dropped\)\.$/;

interface TruncationCounts {
  readonly trimmed: number;
  readonly preserved: number;
  readonly dropped: number;
}

function readSegmentMarker(segment: CliOutputSegment): TruncationCounts | null {
  if (segment.type !== 'info') return null;
  const match = SEGMENT_TRUNCATION_MARKER.exec(segment.content);
  if (!match) return null;
  return {
    trimmed: Number(match[1]),
    preserved: Number(match[2]),
    dropped: Number(match[3]),
  };
}

function segmentTruncationMarker(counts: TruncationCounts): CliOutputSegment {
  return {
    type: 'info',
    content:
      `… ${counts.trimmed} earlier output segments were trimmed to bound ` +
      `this card (${counts.preserved} preserved below, ${counts.dropped} dropped).`,
  };
}

/** True for a marker this module wrote on an earlier trim of the same card. */
export function isSegmentTruncationMarker(segment: CliOutputSegment): boolean {
  return readSegmentMarker(segment) !== null;
}

/**
 * Trim an agent's structured-segment list back to {@link MAX_AGENT_SEGMENTS},
 * folding the prose it drops into the surviving list and stating what is gone.
 *
 * ## Why a bare `slice(-MAX)` was wrong
 *
 * The predecessor was `segments.slice(-MAX_AGENT_SEGMENTS)`: no fold, no
 * marker, no warning. A long Codex or Copilot run's opening plan and reasoning
 * simply vanished from its card — and stayed vanished, because the card is the
 * only place those segments are rendered and the trimmed array is what a later
 * resume persists. Twenty lines away, `capStreamEventsInPlace` had already
 * established that this surface requires folding. This is the same treatment:
 *
 * 1. The most recent {@link AGENT_SEGMENTS_TAIL_RESERVE} segments are kept
 *    whatever their type.
 * 2. The remaining budget goes to the most recent LANDMARK segments before
 *    that tail, so tool calls keep their results and the stats bar keeps its
 *    usage reports.
 * 3. Any budget the landmarks did not claim goes back to the most recent
 *    segments that are still unkept. (Skipping this step is how the neighbour
 *    cap's shape would misbehave here: an adapter that emits few landmarks
 *    would throw away hundreds of recoverable segments to honour a budget
 *    nothing was using.)
 *
 * Everything dropped is then folded by type — all dropped `text` into one
 * synthetic `text` segment, all dropped `thinking` into one synthetic
 * `thinking` segment, placed ahead of the survivors in first-dropped order, so
 * the tree builder renders them as the leading prose block they were.
 *
 * Segments that cannot be folded — tool calls whose structure is gone, and any
 * type this function does not recognise — are counted, not invented. That
 * count and the folded count both go in the ONE marker segment at the head, so
 * the trim is never silent even when nothing at all could be preserved.
 */
export function capSegments(segments: CliOutputSegment[]): CliOutputSegment[] {
  const total = segments.length;
  if (total <= MAX_AGENT_SEGMENTS + AGENT_SEGMENTS_CAP_SLACK) return segments;

  const budget = MAX_AGENT_SEGMENTS - MAX_SYNTHETIC_SEGMENTS;
  const keep = new Array<boolean>(total).fill(false);
  // A marker written by an earlier trim is never re-kept — resolved once here
  // rather than per keep-pass, since three passes visit the same index.
  const isMarker = segments.map(isSegmentTruncationMarker);
  let remaining = budget;

  // 1. The recent tail, whatever its type.
  const tailStart = total - Math.min(AGENT_SEGMENTS_TAIL_RESERVE, budget);
  for (let i = total - 1; i >= tailStart && remaining > 0; i--) {
    if (isMarker[i]) continue;
    keep[i] = true;
    remaining--;
  }

  // 2. Structure before the tail, newest first.
  for (let i = tailStart - 1; i >= 0 && remaining > 0; i--) {
    if (isMarker[i]) continue;
    if (!LANDMARK_SEGMENT_TYPES.has(segments[i].type)) continue;
    keep[i] = true;
    remaining--;
  }

  // 3. Budget the landmarks left unclaimed, back to the most recent segments.
  for (let i = tailStart - 1; i >= 0 && remaining > 0; i--) {
    if (isMarker[i] || keep[i]) continue;
    keep[i] = true;
    remaining--;
  }

  return assembleCappedSegments(segments, keep);
}

function assembleCappedSegments(
  segments: readonly CliOutputSegment[],
  keep: readonly boolean[],
): CliOutputSegment[] {
  const kept: CliOutputSegment[] = [];
  const folds = new Map<string, { firstIndex: number; content: string }>();
  // Seeded from any earlier marker so the counts a user reads are the totals
  // for the whole run, not for the most recent trim.
  let trimmed = 0;
  let preserved = 0;
  let dropped = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (keep[i]) {
      kept.push(segment);
      continue;
    }

    const previous = readSegmentMarker(segment);
    if (previous) {
      trimmed += previous.trimmed;
      preserved += previous.preserved;
      dropped += previous.dropped;
      continue;
    }

    trimmed++;
    if (segment.type === 'text' || segment.type === 'thinking') {
      preserved++;
      const run = folds.get(segment.type);
      if (run) run.content += segment.content;
      else folds.set(segment.type, { firstIndex: i, content: segment.content });
    } else {
      dropped++;
    }
  }

  const folded: CliOutputSegment[] = [...folds.entries()]
    .sort((a, b) => a[1].firstIndex - b[1].firstIndex)
    .map(([type, run]) => ({
      type: type as CliOutputSegment['type'],
      content: run.content,
    }));

  return [
    segmentTruncationMarker({ trimmed, preserved, dropped }),
    ...folded,
    ...kept,
  ];
}

// ============================================================================
// Rich stream events (ptah-cli adapter)
// ============================================================================

/**
 * Maximum rich stream events retained per agent card.
 *
 * `stdout`/`stderr` have been capped at {@link MAX_FRONTEND_BUFFER} since the
 * agent-monitor store was written; `streamEvents` was not capped at all, and it
 * is the one that grows per TOKEN on the ptah-cli path. Three chatty agents in
 * one session put hundreds of thousands of event objects in the renderer heap,
 * each of which the agent card's execution-tree build walks.
 *
 * Deliberately far below the backend's own 50 000
 * (`MAX_ACCUMULATED_STREAM_EVENTS`): that cap bounds what is PERSISTED for
 * resume, this one bounds what a live card renders.
 */
const MAX_AGENT_STREAM_EVENTS = 2000;

/**
 * Recent events always kept regardless of type, so streaming text/thinking near
 * the tail (an agent's final answer) survives capping. Mirrors the backend's
 * `STREAM_EVENTS_TAIL_RESERVE`.
 */
const AGENT_STREAM_EVENTS_TAIL_RESERVE = 400;

/**
 * Overshoot tolerated before a re-cap runs. Capping the instant the array
 * exceeds the limit would make every subsequent event pay the rebuild — the
 * defect being fixed, in a new place. The slack amortizes each rebuild over
 * this many events.
 */
const AGENT_STREAM_EVENTS_CAP_SLACK = 200;

/**
 * Event types that establish tree structure and are preserved ahead of plain
 * deltas when capping. Mirrors the backend `LANDMARK_EVENT_TYPES` — duplicated
 * rather than imported because a frontend lib may not depend on a backend lib.
 */
const LANDMARK_EVENT_TYPES: ReadonlySet<string> = new Set([
  'message_start',
  'tool_start',
  'tool_result',
  'agent_start',
  'thinking_start',
  'message_complete',
]);

/**
 * Trim an agent's stream-event buffer back to {@link MAX_AGENT_STREAM_EVENTS},
 * IN PLACE, once it runs {@link AGENT_STREAM_EVENTS_CAP_SLACK} past the cap.
 *
 * In place because the array reference is shared across deltas and
 * `streamRevision` — not the array identity — is the agent card's change
 * signal (see `MonitoredAgent.streamEvents`). Reassigning it here would
 * silently break that contract for any consumer holding the old reference.
 *
 * Shape mirrors the backend's `capStreamEvents`: the most recent events are
 * kept whatever their type, and the remaining budget is filled with the most
 * recent LANDMARK events before that tail, so the rendered tree keeps its
 * structure instead of losing every `tool_start` that has no `tool_result` yet.
 *
 * ## Why the dropped deltas are folded rather than simply dropped
 *
 * `AgentMonitorTreeBuilderService` does not render the events; it renders the
 * ACCUMULATORS it folds them into — text per `${messageId}-block-${blockIndex}`
 * and tool input per `${toolCallId}-input`. Keeping only landmarks therefore
 * kept the message and tool NODES while deleting everything that gives them
 * content: an agent past 2 000 events showed a card of empty message bodies and
 * tool calls with no input, and — because the builder is incremental and folds
 * each event exactly once — nothing could ever restore them.
 *
 * So the delta content that is about to disappear is folded back into the
 * surviving structure before the array is rewritten:
 *
 * - `text_delta` / `thinking_delta` → ONE synthetic delta per accumulator key,
 *   carrying the concatenation of every dropped delta for that key, placed
 *   ahead of the kept head. Any deltas for the same key that survive in the
 *   tail then append onto it exactly as they did before the trim.
 * - `tool_delta` → the concatenated partial JSON is parsed and written onto the
 *   surviving `tool_start` as its `toolInput`, which is the builder's fallback
 *   when a tool has no accumulated input string. When some of that tool's
 *   deltas DO survive in the tail, a synthetic `tool_delta` carrying the
 *   dropped prefix is emitted instead — otherwise the tail fragment would be
 *   parsed on its own as a truncated JSON document.
 *
 * The fold is bounded by the number of distinct keys, not by the number of
 * dropped events, and it runs only on the trim (once per
 * {@link AGENT_STREAM_EVENTS_CAP_SLACK} events).
 */
export function capStreamEventsInPlace(events: FlatStreamEventUnion[]): void {
  if (
    events.length <=
    MAX_AGENT_STREAM_EVENTS + AGENT_STREAM_EVENTS_CAP_SLACK
  ) {
    return;
  }

  const reserve = Math.min(
    AGENT_STREAM_EVENTS_TAIL_RESERVE,
    MAX_AGENT_STREAM_EVENTS,
  );
  const tailStart = events.length - reserve;
  const headBudget = MAX_AGENT_STREAM_EVENTS - reserve;

  const head: FlatStreamEventUnion[] = [];
  for (let i = tailStart - 1; i >= 0 && head.length < headBudget; i--) {
    if (LANDMARK_EVENT_TYPES.has(events[i].eventType)) {
      head.push(events[i]);
    }
  }
  head.reverse();

  const tail = events.slice(tailStart);
  const folded = foldDroppedDeltas(events, tailStart, tail, head);

  // The fold is bounded by distinct accumulator keys, not by dropped events,
  // so in practice it adds a handful of entries. It is still an addition, and
  // the cap is the reason this function exists — so when the two do not both
  // fit, CONTENT WINS and the oldest STRUCTURE goes.
  //
  // Dropping folded entries first (the shape this replaces) reinstated the
  // very defect the fold exists to remove, and did it worst exactly where it
  // mattered most: `headBudget` is `MAX - reserve`, so an agent whose landmarks
  // saturate the head — 1 600 message and tool events, which a long tool-heavy
  // run reaches — made `overflow >= folded.length` and discarded EVERY folded
  // entry. That is a card of empty message bodies and tool calls with no input,
  // which is where this function started.
  //
  // A landmark dropped here takes its folded run with it: `dropUnanchoredRuns`
  // removes any synthetic delta left with no surviving message or tool to
  // attach to, so the trim never emits content for structure that is gone.
  let overflow =
    folded.length + head.length + tail.length - MAX_AGENT_STREAM_EVENTS;
  if (overflow > 0) {
    head.splice(0, Math.min(overflow, head.length));
    dropUnanchoredRuns(folded, head, tail);
    overflow =
      folded.length + head.length + tail.length - MAX_AGENT_STREAM_EVENTS;
    // Backstop for the pathological case the head cannot absorb: thousands of
    // distinct accumulator keys and almost no landmarks. Oldest folded first.
    if (overflow > 0) folded.splice(0, overflow);
  }

  events.length = 0;
  for (const ev of folded) events.push(ev);
  for (const ev of head) events.push(ev);
  for (const ev of tail) events.push(ev);
}

/** A delta run that was dropped, keyed by the accumulator it fed. */
interface DroppedRun {
  /** The first dropped event of the run — the template for the synthetic one. */
  readonly first: FlatStreamEventUnion;
  text: string;
}

/**
 * Drop synthetic folded deltas whose anchor landmark was trimmed to make
 * room for content.
 *
 * `capStreamEventsInPlace` now drops the oldest LANDMARKS first when the cap
 * is tight, rather than the folded content. A folded text run keys itself on
 * its `messageId` and a folded tool run on its `toolCallId`; if no surviving
 * landmark in `head` or `tail` still carries that id, the run is content with
 * nowhere to attach — the empty-card defect in a different shape. Removing it
 * keeps the trim honest: what remains is always structure WITH its content, or
 * nothing at all.
 *
 * Mutates `folded` in place.
 */
function dropUnanchoredRuns(
  folded: FlatStreamEventUnion[],
  head: readonly FlatStreamEventUnion[],
  tail: readonly FlatStreamEventUnion[],
): void {
  if (folded.length === 0) return;

  const survivingMessageIds = new Set<string>();
  const survivingToolCallIds = new Set<string>();
  for (const event of head) {
    if (event.messageId) survivingMessageIds.add(event.messageId);
    if (event.toolCallId) survivingToolCallIds.add(event.toolCallId);
  }
  for (const event of tail) {
    if (event.messageId) survivingMessageIds.add(event.messageId);
    if (event.toolCallId) survivingToolCallIds.add(event.toolCallId);
  }

  for (let i = folded.length - 1; i >= 0; i--) {
    const event = folded[i];
    const hasMessage = event.messageId
      ? survivingMessageIds.has(event.messageId)
      : true;
    const hasTool = event.toolCallId
      ? survivingToolCallIds.has(event.toolCallId)
      : true;
    if (!hasMessage || !hasTool) {
      folded.splice(i, 1);
    }
  }
}

/**
 * Build the synthetic delta events that stand in for everything dropped from
 * `events[0, tailStart)`, and patch `head` in place where a dropped run is
 * better expressed as tool input on a surviving `tool_start`.
 *
 * Returns the synthetic events oldest-run-first, to be placed ahead of `head`
 * so the surviving tail deltas still append after them.
 */
function foldDroppedDeltas(
  events: readonly FlatStreamEventUnion[],
  tailStart: number,
  tail: readonly FlatStreamEventUnion[],
  head: FlatStreamEventUnion[],
): FlatStreamEventUnion[] {
  const kept = new Set<FlatStreamEventUnion>(head);
  const textRuns = new Map<string, DroppedRun>();
  const toolRuns = new Map<string, DroppedRun>();

  for (let i = 0; i < tailStart; i++) {
    const event = events[i];
    if (kept.has(event)) continue;

    const delta = (event as { delta?: unknown }).delta;
    if (typeof delta !== 'string' || delta.length === 0) continue;

    if (
      event.eventType === 'text_delta' ||
      event.eventType === 'thinking_delta'
    ) {
      accumulateRun(
        textRuns,
        `${event.eventType}:${event.messageId}:${event.blockIndex ?? 0}`,
        event,
        delta,
      );
    } else if (event.eventType === 'tool_delta' && event.toolCallId) {
      accumulateRun(toolRuns, event.toolCallId, event, delta);
    }
  }

  const synthetic: FlatStreamEventUnion[] = [];
  for (const [key, run] of textRuns) {
    synthetic.push(syntheticDelta(run, `folded-${key}`));
  }

  // A tool whose input still has surviving deltas must keep receiving the
  // dropped bytes as a delta, or the two halves would be parsed separately.
  const toolCallIdsInTail = new Set<string>();
  for (const event of tail) {
    if (event.eventType === 'tool_delta' && event.toolCallId) {
      toolCallIdsInTail.add(event.toolCallId);
    }
  }

  for (const [toolCallId, run] of toolRuns) {
    if (
      toolCallIdsInTail.has(toolCallId) ||
      !foldToolInputOntoStart(head, toolCallId, run.text)
    ) {
      synthetic.push(syntheticDelta(run, `folded-tool-${toolCallId}`));
    }
  }

  synthetic.sort((a, b) => a.timestamp - b.timestamp);
  return synthetic;
}

function accumulateRun(
  runs: Map<string, DroppedRun>,
  key: string,
  event: FlatStreamEventUnion,
  delta: string,
): void {
  const existing = runs.get(key);
  if (existing) {
    existing.text += delta;
    return;
  }
  runs.set(key, { first: event, text: delta });
}

/**
 * One event carrying a whole dropped run. Copied from the run's FIRST event so
 * it keeps that run's `messageId`, `blockIndex`, `toolCallId` and timestamp —
 * everything the tree builder keys on — and differs only in `id` and `delta`.
 */
function syntheticDelta(run: DroppedRun, id: string): FlatStreamEventUnion {
  return { ...run.first, id, delta: run.text } as FlatStreamEventUnion;
}

/**
 * Replace the surviving `tool_start` for `toolCallId` with a copy carrying the
 * dropped input, when it parses to a JSON object and the start has none of its
 * own. Returns false when no such landmark survived (or the bytes are not a
 * usable object), so the caller falls back to a synthetic delta.
 */
function foldToolInputOntoStart(
  head: FlatStreamEventUnion[],
  toolCallId: string,
  inputJson: string,
): boolean {
  const index = head.findIndex(
    (event) =>
      event.eventType === 'tool_start' && event.toolCallId === toolCallId,
  );
  if (index === -1) return false;

  const toolStart = head[index] as FlatStreamEventUnion & {
    toolInput?: Record<string, unknown>;
  };
  if (toolStart.toolInput && Object.keys(toolStart.toolInput).length > 0) {
    return true;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(inputJson);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return false;
  }

  head[index] = {
    ...toolStart,
    toolInput: parsed as Record<string, unknown>,
  } as FlatStreamEventUnion;
  return true;
}
