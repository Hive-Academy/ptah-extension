/**
 * Agent Card Utilities
 *
 * Pure functions for parsing, formatting, and merging agent output.
 */

import { isOutputTruncationNotice } from '@ptah-extension/chat-streaming';
import type { RenderSegment, StderrSegment } from '@ptah-extension/chat-ui';

/**
 * Format elapsed time in human-readable form.
 */
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  } else {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
}

/** Error keywords that indicate a real problem, even inside [stderr]-prefixed lines */
const STDERR_ERROR_KEYWORDS =
  /\b(error|fail(ed)?|exception|denied|unauthorized|refused|timeout|exhausted|abort|crash|panic|fatal|quota)\b/i;

/**
 * Parse raw agent CLI output into structured segments.
 *
 * Detects patterns:
 * - "Tool: <name> <args>" lines → tool segment
 * - "Tool result" / "► Tool result" lines → tool-result segment
 * - "Reading <file>" / "Searching" lines → tool segment
 * - "● <heading>" / "• <heading>" lines → heading segment
 * - Error/warning patterns → error segment
 * - Everything else → text segment
 *
 * Adjacent text lines are merged into a single segment.
 */
export function parseAgentOutput(stdout: string): RenderSegment[] {
  return parseAgentOutputLines(stdout.split('\n')).segments;
}

/**
 * Segments parsed from a run of lines, with the line each segment's parse
 * began on. Parsing from any of those lines with fresh state reproduces the
 * same segments from that point on, which is what lets
 * {@link createAgentOutputParser} re-parse only the tail of a growing buffer.
 */
interface ParsedLines<T> {
  readonly segments: T[];
  readonly starts: number[];
}

function parseAgentOutputLines(
  lines: readonly string[],
): ParsedLines<RenderSegment> {
  const segments: RenderSegment[] = [];
  const starts: number[] = [];
  let currentText = '';
  let textStart = -1;

  const push = (segment: RenderSegment, start: number) => {
    segments.push(segment);
    starts.push(start);
  };

  const flushText = () => {
    if (currentText.trim()) {
      push({ type: 'text', content: currentText.trimEnd() }, textStart);
    }
    currentText = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const start = i;
    const line = lines[i];
    const trimmed = line.trim();
    // The head-of-buffer notice `capBuffer` leaves when it front-truncates a
    // 50 KB stdout buffer. Rendered as its own informational block: as plain
    // text it would read as something the agent said (TASK_2026_335).
    if (isOutputTruncationNotice(trimmed)) {
      flushText();
      push({ type: 'info', content: trimmed }, start);
      continue;
    }
    if (/^\[stderr\]/i.test(trimmed)) {
      flushText();
      let stderrContent = trimmed.replace(/^\[stderr\]\s*/i, '');
      while (i + 1 < lines.length && /^\[stderr\]/i.test(lines[i + 1].trim())) {
        i++;
        stderrContent += '\n' + lines[i].trim().replace(/^\[stderr\]\s*/i, '');
      }
      const isError = STDERR_ERROR_KEYWORDS.test(stderrContent);
      push(
        {
          type: isError ? 'error' : 'stderr-info',
          content: stderrContent.trim(),
        },
        start,
      );
      continue;
    }
    if (/^[●•]\s+\S/.test(trimmed) || /^#{1,3}\s+\S/.test(trimmed)) {
      flushText();
      push(
        { type: 'heading', content: trimmed.replace(/^[●•#]+\s*/, '') },
        start,
      );
      continue;
    }
    const toolMatch = trimmed.match(/^Tool:\s+(\w[\w_.-]*)\s*(.*)?$/);
    if (toolMatch) {
      flushText();
      let toolContent = '';
      while (i + 1 < lines.length && !isSegmentBoundary(lines[i + 1])) {
        i++;
        toolContent += (toolContent ? '\n' : '') + lines[i];
      }
      push(
        {
          type: 'tool',
          content: toolContent.trim(),
          toolName: toolMatch[1],
          toolArgs: toolMatch[2]?.trim() || undefined,
        },
        start,
      );
      continue;
    }
    if (/^[►▶]?\s*Tool result\s*\(error\)/i.test(trimmed)) {
      flushText();
      let resultContent = '';
      while (i + 1 < lines.length && !isSegmentBoundary(lines[i + 1])) {
        i++;
        resultContent += (resultContent ? '\n' : '') + lines[i];
      }
      push(
        { type: 'tool-result-error', content: resultContent.trim() },
        start,
      );
      continue;
    }
    if (/^[►▶]?\s*Tool result/i.test(trimmed)) {
      flushText();
      let resultContent = '';
      while (i + 1 < lines.length && !isSegmentBoundary(lines[i + 1])) {
        i++;
        resultContent += (resultContent ? '\n' : '') + lines[i];
      }
      push({ type: 'tool-result', content: resultContent.trim() }, start);
      continue;
    }
    const actionMatch = trimmed.match(
      /^(Reading|Searching|Writing|Creating|Executing)\s+(.+)$/,
    );
    if (actionMatch) {
      flushText();
      push(
        {
          type: 'tool',
          content: '',
          toolName: actionMatch[1].toLowerCase(),
          toolArgs: actionMatch[2],
        },
        start,
      );
      continue;
    }
    if (
      /^(Error|ERROR|✗|✘|Permission denied|FAILED)/i.test(trimmed) ||
      /^X\s+/.test(trimmed)
    ) {
      flushText();
      push({ type: 'error', content: trimmed }, start);
      continue;
    }
    if (currentText === '') textStart = i;
    currentText += (currentText ? '\n' : '') + line;
  }

  flushText();
  return { segments, starts };
}

/**
 * Re-parses only the tail of a buffer that grows by appending.
 *
 * Everything before the line the last segment began on is final: a segment
 * only ever extends while later lines join it, and the line that ends a
 * segment begins the next one. When the last segment begins on the
 * unfinished final line, that line can still change what it is, so the
 * segment before it is re-parsed too. Any change that is not a pure append
 * (a front trim, a reset) falls back to a full parse. The result is always
 * equal to a full parse of the same buffer.
 */
class IncrementalLineParser<T> {
  private source = '';
  private result: T[] = [];
  /** Final segments, all of them before {@link stableEnd}. */
  private stable: T[] = [];
  /** Character offset in `source` where the re-parsed tail begins. */
  private stableEnd = 0;

  constructor(
    private readonly parseLines: (lines: readonly string[]) => ParsedLines<T>,
  ) {}

  parse(next: string): T[] {
    if (next === this.source) return this.result;
    if (!next.startsWith(this.source)) {
      this.stable = [];
      this.stableEnd = 0;
    }

    const lines = next.slice(this.stableEnd).split('\n');
    const { segments, starts } = this.parseLines(lines);
    this.result =
      this.stable.length > 0 ? this.stable.concat(segments) : segments;

    // Segments before `keep` become final; the tail re-parses from `keep`.
    let keep = segments.length - 1;
    if (keep >= 0 && starts[keep] === lines.length - 1) keep--;
    if (keep > 0) {
      let offset = 0;
      for (let l = 0; l < starts[keep]; l++) offset += lines[l].length + 1;
      for (let s = 0; s < keep; s++) this.stable.push(segments[s]);
      this.stableEnd += offset;
    }
    this.source = next;
    return this.result;
  }
}

/**
 * A stateful {@link parseAgentOutput} for one growing stdout buffer (one per
 * agent card). Returns segments equal to `parseAgentOutput(stdout)`.
 */
export function createAgentOutputParser(): (stdout: string) => RenderSegment[] {
  const parser = new IncrementalLineParser(parseAgentOutputLines);
  return (stdout) => parser.parse(stdout);
}

/**
 * A stateful {@link parseStderr} for one growing stderr buffer (one per agent
 * card). Returns segments equal to `parseStderr(stderr)`.
 */
export function createStderrParser(): (stderr: string) => StderrSegment[] {
  const parser = new IncrementalLineParser(parseStderrLines);
  return (stderr) => parser.parse(stderr);
}

/**
 * Classify a stderr line as informational or a real error.
 * Informational: model info, usage stats, mode messages, cache info, timestamps.
 * Error: lines with error keywords or unknown patterns.
 */
function isStderrInfoLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  // Our own truncation notice, not the agent's. It contains none of the error
  // keywords, so without this it fell through to the unknown-pattern default
  // and was painted in the red error box.
  if (isOutputTruncationNotice(t)) return true;
  if (STDERR_ERROR_KEYWORDS.test(t)) return false;
  if (/^\[?(Model|Provider|model|provider)[:\]]/i.test(t)) return true;
  if (/yolo mode|auto.?accept|headless/i.test(t)) return true;
  if (/loaded cached|loading|initializ/i.test(t)) return true;
  if (/tokens?[\s:]/i.test(t) || /\bcost\b/i.test(t)) return true;
  if (/input[:\s]+\d|output[:\s]+\d/i.test(t)) return true;
  if (/^\[stderr\]/i.test(t)) return true;
  if (/\d+(\.\d+)?\s*(ms|sec|seconds|s)\b/i.test(t)) return true;
  if (/^v?\d+\.\d+/i.test(t)) return true;
  return false;
}

/**
 * Parse stderr into grouped informational vs error segments.
 * Adjacent lines of the same type are merged into one segment.
 */
export function parseStderr(stderr: string): StderrSegment[] {
  return parseStderrLines(stderr.split('\n')).segments;
}

function parseStderrLines(
  lines: readonly string[],
): ParsedLines<StderrSegment> {
  const segments: StderrSegment[] = [];
  const starts: number[] = [];
  let currentType: 'info' | 'error' | null = null;
  let currentLines: string[] = [];
  let groupStart = 0;

  const flush = () => {
    if (currentLines.length > 0 && currentType) {
      const content = currentLines.join('\n').trimEnd();
      if (content) {
        segments.push({ type: currentType, content });
        starts.push(groupStart);
      }
    }
    currentLines = [];
    currentType = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const type: 'info' | 'error' = isStderrInfoLine(line) ? 'info' : 'error';
    if (type !== currentType) {
      flush();
      currentType = type;
      groupStart = i;
    }
    currentLines.push(line);
  }
  flush();

  return { segments, starts };
}

/**
 * Merge consecutive segments of the same streamable type (text, thinking) into a single segment.
 * SDK adapters (e.g. Copilot) emit per-token text segments, and even after
 * backend merging, cross-batch boundaries can leave adjacent text segments.
 * This collapses them for clean markdown rendering.
 */
export function mergeConsecutiveTextSegments(
  segments: readonly RenderSegment[],
): RenderSegment[] {
  if (segments.length <= 1) return segments as RenderSegment[];

  const result: RenderSegment[] = [];
  let buffer = '';
  let bufferType: 'text' | 'thinking' | null = null;

  for (const seg of segments) {
    if (seg.type === 'text' || seg.type === 'thinking') {
      if (bufferType === seg.type) {
        buffer += seg.content;
      } else {
        if (buffer && bufferType) {
          result.push({ type: bufferType, content: buffer });
        }
        buffer = seg.content;
        bufferType = seg.type;
      }
    } else {
      if (buffer && bufferType) {
        result.push({ type: bufferType, content: buffer });
        buffer = '';
        bufferType = null;
      }
      result.push(seg);
    }
  }

  if (buffer && bufferType) {
    result.push({ type: bufferType, content: buffer });
  }

  return result;
}

/** Check if a line starts a new segment boundary */
function isSegmentBoundary(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^\[stderr\]/i.test(t)) return true;
  if (/^[●•]\s+\S/.test(t)) return true;
  if (/^#{1,3}\s+\S/.test(t)) return true;
  if (/^Tool:\s+\w/.test(t)) return true;
  if (/^[►▶]?\s*Tool result/i.test(t)) return true;
  if (/^(Reading|Searching|Writing|Creating|Executing)\s+/.test(t)) return true;
  if (/^(Error|ERROR|✗|✘|Permission denied|FAILED)/i.test(t)) return true;
  if (/^X\s+/.test(t)) return true;
  return false;
}
