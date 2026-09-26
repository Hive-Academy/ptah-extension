/**
 * `ptah_agent_read` / `agent_read` rendering, held to the tool's result
 * budget before anything else sees it (TASK_2026_559 Batch 13, reviews r1-r2).
 *
 * `readOutput` windows each stream on its own (the last `tail` lines, or
 * `tail` lines starting at `offset`). A window of long lines can be several
 * times the result budget, and the budget step cuts from the end, so the
 * newest line — the one a read-once-at-the-end caller needs — was the one
 * lost. Here the window is narrowed first, per stream:
 *
 * - a tail keeps the newest lines that fit, a forward page its first lines;
 * - each stream's edge line (newest for a tail, first for a page) is kept
 *   whole whenever it fits on its own, so a huge line in one stream never
 *   clips the other stream's final line;
 * - a line too long for the budget is shown in part (its end for a tail, its
 *   start for a page), after the other stream's lines have their room.
 *
 * Each stream states the exact range it shows. When a stream's window is
 * narrowed at all, the whole window is saved with the tool-result spool and
 * the notice names the file (User Decision 7: nothing is lost; line paging
 * cannot reach the middle of a clipped line). The rendered text fits the
 * budget, so the budget step returns it unchanged.
 *
 * Shared by the HTTP and the stdio surfaces.
 */

import json2md from 'json2md';
import type { AgentOutput } from '@ptah-extension/shared';
import {
  fitsBudget,
  type TextBudget,
} from '@ptah-extension/tool-output-reducers';
import type { SpoolOutcome } from './tool-result-budget';

/** Saves a narrowed stream's whole window; never throws. */
export type AgentReadSpool = (text: string) => Promise<SpoolOutcome>;

/** What one stream section shows. Line numbers are 1-based. */
export interface AgentReadStreamView {
  /** Parsed lines in the stream before any windowing. */
  readonly totalLines: number;
  /** Whole lines shown. */
  readonly shownLines: number;
  /** First and last whole line shown (both 0 when none is). */
  readonly firstLine: number;
  readonly lastLine: number;
  /** Set when a single line was too long and only part of it is shown. */
  readonly partialLine?: {
    readonly line: number;
    readonly shownChars: number;
    readonly totalChars: number;
  };
  /** Where the whole window was saved, when this stream's window was narrowed. */
  readonly spooled?: SpoolOutcome;
}

export interface AgentReadView {
  readonly text: string;
  /** Lines shown across both streams, a partly shown line counting as one. */
  readonly shownLines: number;
  readonly stdout: AgentReadStreamView;
  readonly stderr: AgentReadStreamView;
}

type StreamName = 'stdout' | 'stderr';

/** One stream's window as `readOutput` returned it. */
interface StreamWindow {
  readonly name: StreamName;
  /** The window text exactly as returned: what a spool file holds. */
  readonly text: string;
  readonly lines: readonly string[];
  /** 0-based index of `lines[0]` in the whole stream. */
  readonly start: number;
  readonly total: number;
}

/** How much of one stream's window to show. */
interface StreamPick {
  /** Whole lines, from the edge inward. */
  readonly keep: number;
  /** When `keep` is 0: chars of the edge line to show (0: none). */
  readonly partialChars: number;
}

type Saved = Partial<Record<StreamName, SpoolOutcome>>;

/**
 * Shortest part of an over-long edge line reserved before the other stream's
 * lines are sized, so a clipped stream still shows its end (or start).
 */
const PARTIAL_LINE_FLOOR_CHARS = 512;

/**
 * Render `result` within `budget`. `offset` is the one the read was made
 * with: undefined means a tail window (keep the newest lines), a number a
 * forward page (keep the first lines). `spool` saves the whole window of each
 * stream the view narrows.
 */
export async function renderAgentRead(
  result: AgentOutput,
  offset: number | undefined,
  budget: TextBudget,
  spool: AgentReadSpool,
): Promise<AgentReadView> {
  const tail = offset === undefined;
  const streams = [
    streamWindow('stdout', result.stdout, result.stdoutTotalLines, offset),
    streamWindow('stderr', result.stderr, result.stderrTotalLines, offset),
  ] as const;
  const saved: Saved = {};
  // A spool notice takes room, which can narrow the other stream too: at
  // most one more pass per stream.
  for (;;) {
    const view = fitView(result, streams, tail, budget, saved);
    const unsaved = streams.filter(
      (s) => narrowed(s, view[s.name]) && saved[s.name] === undefined,
    );
    if (unsaved.length === 0) {
      return view;
    }
    for (const stream of unsaved) {
      saved[stream.name] = await spool(stream.text);
    }
  }
}

/** Whether the view shows less of the stream than its window holds. */
function narrowed(stream: StreamWindow, view: AgentReadStreamView): boolean {
  return (
    view.partialLine !== undefined || view.shownLines < stream.lines.length
  );
}

/** The largest per-stream picks whose rendering fits `budget`. */
function fitView(
  result: AgentOutput,
  streams: readonly [StreamWindow, StreamWindow],
  tail: boolean,
  budget: TextBudget,
  saved: Saved,
): AgentReadView {
  const render = (picks: readonly [StreamPick, StreamPick]): AgentReadView =>
    renderView(result, streams, tail, picks, saved);
  const fits = (picks: readonly [StreamPick, StreamPick]): boolean =>
    fitsBudget(render(picks).text, budget);
  const none: StreamPick = { keep: 0, partialChars: 0 };

  const all = [
    { keep: streams[0].lines.length, partialChars: 0 },
    { keep: streams[1].lines.length, partialChars: 0 },
  ] as const;
  if (fits(all)) {
    return render(all);
  }

  // Streams whose edge line fits on its own get whole lines; the rest a part.
  const withLines = [0, 1].filter((i) => streams[i].lines.length > 0);
  const alone = (i: number): readonly [StreamPick, StreamPick] =>
    i === 0
      ? [{ keep: 1, partialChars: 0 }, none]
      : [none, { keep: 1, partialChars: 0 }];
  let whole = withLines.filter((i) => fits(alone(i)));
  let partial = withLines.filter((i) => !whole.includes(i));
  const pickFor = (i: number, lines: number, chars: number): StreamPick => {
    if (whole.includes(i)) {
      return {
        keep: Math.min(lines, streams[i].lines.length),
        partialChars: 0,
      };
    }
    return partial.includes(i) ? { keep: 0, partialChars: chars } : none;
  };
  const picks = (
    lines: number,
    chars: number,
  ): readonly [StreamPick, StreamPick] => [
    pickFor(0, lines, chars),
    pickFor(1, lines, chars),
  ];
  if (whole.length > 1 && !fits(picks(1, 0))) {
    // Each edge line fits alone but not both: show both in part.
    partial = withLines;
    whole = [];
  }

  const longestEdge = Math.max(
    0,
    ...partial.map((i) => edgeLine(streams[i], tail)?.length ?? 0),
  );
  const wholeLines = whole.length > 0 ? 1 : 0;
  const floor = largestFitting(
    Math.min(PARTIAL_LINE_FLOOR_CHARS, longestEdge),
    (n) => fits(picks(wholeLines, n)),
  );
  const mostLines = Math.max(0, ...whole.map((i) => streams[i].lines.length));
  const lines =
    whole.length > 0
      ? Math.max(
          1,
          largestFitting(mostLines, (n) => fits(picks(n, floor))),
        )
      : 0;
  const chars = largestFitting(longestEdge, (n) => fits(picks(lines, n)));
  return render(picks(lines, chars));
}

function streamWindow(
  name: StreamName,
  text: string,
  total: number,
  offset: number | undefined,
): StreamWindow {
  const lines = text === '' ? [] : text.split('\n');
  if (text.endsWith('\n')) {
    lines.pop();
  }
  // The same normalisation `readOutput` applies to its offset.
  const start =
    offset === undefined
      ? total - lines.length
      : Number.isFinite(offset)
        ? Math.max(0, Math.floor(offset))
        : 0;
  return { name, text, lines, start, total };
}

/** The line a partial view shows part of: the newest for a tail, else the first. */
function edgeLine(stream: StreamWindow, tail: boolean): string | undefined {
  return tail ? stream.lines[stream.lines.length - 1] : stream.lines[0];
}

function renderView(
  result: AgentOutput,
  streams: readonly [StreamWindow, StreamWindow],
  tail: boolean,
  picks: readonly [StreamPick, StreamPick],
  saved: Saved,
): AgentReadView {
  const views = streams.map((stream, i) =>
    streamView(stream, tail, picks[i], saved[stream.name]),
  );
  const shownLines = views.reduce(
    (sum, v) => sum + v.view.shownLines + (v.view.partialLine ? 1 : 0),
    0,
  );
  const blocks: json2md.DataObject[] = [
    { h2: `Agent Output: ${result.agentId}` },
    {
      p: `**Lines:** ${shownLines} of ${
        streams[0].total + streams[1].total
      } | **Truncated:** ${result.truncated ? 'Yes' : 'No'}`,
    },
  ];
  for (const [i, stream] of streams.entries()) {
    if (stream.total === 0) continue;
    const { view, content } = views[i];
    blocks.push({ h3: stream.name });
    const notice = windowNotice(stream, view, tail);
    if (notice) blocks.push({ p: notice });
    if (content) blocks.push({ code: { language: '', content } });
  }
  if (streams[0].total === 0 && streams[1].total === 0) {
    blocks.push({ p: '*No output yet.*' });
  }
  return {
    text: json2md(blocks),
    shownLines,
    stdout: views[0].view,
    stderr: views[1].view,
  };
}

function streamView(
  stream: StreamWindow,
  tail: boolean,
  pick: StreamPick,
  spooled: SpoolOutcome | undefined,
): { view: AgentReadStreamView; content: string } {
  const { lines, start, total } = stream;
  const kept = Math.min(pick.keep, lines.length);
  const withWindow = (
    view: AgentReadStreamView,
    content: string,
  ): { view: AgentReadStreamView; content: string } => ({
    view: spooled === undefined ? view : { ...view, spooled },
    content,
  });
  if (kept > 0) {
    const from = tail ? lines.length - kept : 0;
    const first = start + from + 1;
    return withWindow(
      {
        totalLines: total,
        shownLines: kept,
        firstLine: first,
        lastLine: first + kept - 1,
      },
      lines.slice(from, from + kept).join('\n'),
    );
  }
  const edge = edgeLine(stream, tail);
  if (edge === undefined || pick.partialChars <= 0) {
    return withWindow(
      { totalLines: total, shownLines: 0, firstLine: 0, lastLine: 0 },
      '',
    );
  }
  const shownChars = Math.min(pick.partialChars, edge.length);
  const content = tail
    ? edge.slice(lowSurrogateSafeStart(edge, edge.length - shownChars))
    : edge.slice(0, highSurrogateSafeEnd(edge, shownChars));
  return withWindow(
    {
      totalLines: total,
      shownLines: 0,
      firstLine: 0,
      lastLine: 0,
      partialLine: {
        line: tail ? start + lines.length : start + 1,
        shownChars: content.length,
        totalChars: edge.length,
      },
    },
    content,
  );
}

/** The paging line of one stream, or `null` when the whole stream is shown. */
function windowNotice(
  stream: StreamWindow,
  view: AgentReadStreamView,
  tail: boolean,
): string | null {
  const { totalLines, shownLines, firstLine, lastLine, partialLine } = view;
  let notice: string;
  if (partialLine) {
    notice =
      `Showing the ${tail ? 'last' : 'first'} ${partialLine.shownChars} of ` +
      `${partialLine.totalChars} chars of line ${partialLine.line} of ` +
      `${totalLines} (${totalLines - 1} other lines omitted; pass offset/tail ` +
      'to page them)';
  } else {
    const omitted = totalLines - shownLines;
    if (omitted === 0) {
      return null;
    }
    const paging = `(${omitted} omitted; pass offset/tail to page)`;
    notice =
      shownLines === 0
        ? `Showing no lines of ${totalLines} ${paging}`
        : `Showing lines ${firstLine}-${lastLine} of ${totalLines} ${paging}`;
  }
  return view.spooled === undefined
    ? notice
    : `${notice}. ${spoolNotice(stream, view.spooled)}`;
}

/** Where the whole window of a narrowed stream was saved, or why it was not. */
function spoolNotice(stream: StreamWindow, saved: SpoolOutcome): string {
  const range = `Lines ${stream.start + 1}-${stream.start + stream.lines.length}`;
  return 'path' in saved
    ? `${range} in full: ${saved.path}`
    : `${range} could not be saved in full (${saved.failure})`;
}

/**
 * Largest `n` in `[0, max]` for which `fits(n)` holds, else 0 (`fits`
 * monotone; `fits(0)` is not tested).
 */
function largestFitting(max: number, fits: (n: number) => boolean): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/** `start`, moved on one unit when the suffix would begin on a low surrogate. */
function lowSurrogateSafeStart(text: string, start: number): number {
  const first = text.charCodeAt(start);
  return start > 0 && first >= 0xdc00 && first <= 0xdfff ? start + 1 : start;
}

/** `end`, moved back one unit when the prefix would end on a high surrogate. */
function highSurrogateSafeEnd(text: string, end: number): number {
  const last = text.charCodeAt(end - 1);
  return end > 0 && last >= 0xd800 && last <= 0xdbff ? end - 1 : end;
}
