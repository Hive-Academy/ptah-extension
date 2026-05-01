/**
 * Agent Card Utilities
 *
 * Pure functions for parsing, formatting, and merging agent output.
 */

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
  const lines = stdout.split('\n');
  const segments: RenderSegment[] = [];
  let currentText = '';

  const flushText = () => {
    if (currentText.trim()) {
      segments.push({ type: 'text', content: currentText.trimEnd() });
    }
    currentText = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // [stderr] lines mixed into stdout (from CLI adapter stderr forwarding)
    if (/^\[stderr\]/i.test(trimmed)) {
      flushText();
      // Accumulate consecutive [stderr] lines
      let stderrContent = trimmed.replace(/^\[stderr\]\s*/i, '');
      while (i + 1 < lines.length && /^\[stderr\]/i.test(lines[i + 1].trim())) {
        i++;
        stderrContent += '\n' + lines[i].trim().replace(/^\[stderr\]\s*/i, '');
      }
      // Classify: error keywords → error, otherwise muted info
      const isError = STDERR_ERROR_KEYWORDS.test(stderrContent);
      segments.push({
        type: isError ? 'error' : 'stderr-info',
        content: stderrContent.trim(),
      });
      continue;
    }

    // Heading patterns: "● Plan", "• Key Principles", "## Section"
    if (/^[●•]\s+\S/.test(trimmed) || /^#{1,3}\s+\S/.test(trimmed)) {
      flushText();
      segments.push({
        type: 'heading',
        content: trimmed.replace(/^[●•#]+\s*/, ''),
      });
      continue;
    }

    // Tool call: "Tool: <name> <args>"
    const toolMatch = trimmed.match(/^Tool:\s+(\w[\w_.-]*)\s*(.*)?$/);
    if (toolMatch) {
      flushText();
      // Collect tool content (indented lines or until next segment)
      let toolContent = '';
      while (i + 1 < lines.length && !isSegmentBoundary(lines[i + 1])) {
        i++;
        toolContent += (toolContent ? '\n' : '') + lines[i];
      }
      segments.push({
        type: 'tool',
        content: toolContent.trim(),
        toolName: toolMatch[1],
        toolArgs: toolMatch[2]?.trim() || undefined,
      });
      continue;
    }

    // Tool result (error): "▶ Tool result (error)"
    if (/^[►▶]?\s*Tool result\s*\(error\)/i.test(trimmed)) {
      flushText();
      let resultContent = '';
      while (i + 1 < lines.length && !isSegmentBoundary(lines[i + 1])) {
        i++;
        resultContent += (resultContent ? '\n' : '') + lines[i];
      }
      segments.push({
        type: 'tool-result-error',
        content: resultContent.trim(),
      });
      continue;
    }

    // Tool result: "► Tool result" or "Tool result"
    if (/^[►▶]?\s*Tool result/i.test(trimmed)) {
      flushText();
      let resultContent = '';
      while (i + 1 < lines.length && !isSegmentBoundary(lines[i + 1])) {
        i++;
        resultContent += (resultContent ? '\n' : '') + lines[i];
      }
      segments.push({
        type: 'tool-result',
        content: resultContent.trim(),
      });
      continue;
    }

    // Reading/Searching actions shown as tool calls
    const actionMatch = trimmed.match(
      /^(Reading|Searching|Writing|Creating|Executing)\s+(.+)$/,
    );
    if (actionMatch) {
      flushText();
      segments.push({
        type: 'tool',
        content: '',
        toolName: actionMatch[1].toLowerCase(),
        toolArgs: actionMatch[2],
      });
      continue;
    }

    // Error patterns
    if (
      /^(Error|ERROR|✗|✘|Permission denied|FAILED)/i.test(trimmed) ||
      /^X\s+/.test(trimmed)
    ) {
      flushText();
      segments.push({ type: 'error', content: trimmed });
      continue;
    }

    // Regular text — accumulate
    currentText += (currentText ? '\n' : '') + line;
  }

  flushText();
  return segments;
}

/**
 * Classify a stderr line as informational or a real error.
 * Informational: model info, usage stats, mode messages, cache info, timestamps.
 * Error: lines with error keywords or unknown patterns.
 */
function isStderrInfoLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;

  // First pass: if the line contains obvious error keywords, it's an error —
  // regardless of any prefix like [stderr].
  if (STDERR_ERROR_KEYWORDS.test(t)) return false;

  // Model / provider info
  if (/^\[?(Model|Provider|model|provider)[:\]]/i.test(t)) return true;
  // Mode messages (YOLO, auto-accept, etc.)
  if (/yolo mode|auto.?accept|headless/i.test(t)) return true;
  // Cache / loading info
  if (/loaded cached|loading|initializ/i.test(t)) return true;
  // Usage stats (tokens, cost, input, output)
  if (/tokens?[\s:]/i.test(t) || /\bcost\b/i.test(t)) return true;
  if (/input[:\s]+\d|output[:\s]+\d/i.test(t)) return true;
  // Stderr prefix markers from CLI wrappers (only if no error keywords above)
  if (/^\[stderr\]/i.test(t)) return true;
  // Timing / duration info
  if (/\d+(\.\d+)?\s*(ms|sec|seconds|s)\b/i.test(t)) return true;
  // Version info
  if (/^v?\d+\.\d+/i.test(t)) return true;
  return false;
}

/**
 * Parse stderr into grouped informational vs error segments.
 * Adjacent lines of the same type are merged into one segment.
 */
export function parseStderr(stderr: string): StderrSegment[] {
  const lines = stderr.split('\n');
  const segments: StderrSegment[] = [];
  let currentType: 'info' | 'error' | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length > 0 && currentType) {
      const content = currentLines.join('\n').trimEnd();
      if (content) {
        segments.push({ type: currentType, content });
      }
    }
    currentLines = [];
    currentType = null;
  };

  for (const line of lines) {
    const type: 'info' | 'error' = isStderrInfoLine(line) ? 'info' : 'error';
    if (type !== currentType) {
      flush();
      currentType = type;
    }
    currentLines.push(line);
  }
  flush();

  return segments;
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
