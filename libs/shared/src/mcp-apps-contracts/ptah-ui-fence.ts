import type { PtahUiSegment } from './ptah-ui.types';

interface Line {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly next: number;
}

interface Fence {
  readonly marker: '`' | '~';
  readonly length: number;
}

/** Separates complete, top-level `ptah-ui` fences from ordinary markdown. */
export function segmentPtahUi(text: string): PtahUiSegment[] {
  const lines = readLines(text);
  const segments: PtahUiSegment[] = [];
  let markdownStart = 0;
  let outer: Fence | undefined;
  let ordinal = 0;

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = removeTrailingSpaces(line.text);

    if (outer !== undefined) {
      if (isClosingFence(trimmed, outer)) outer = undefined;
      index += 1;
      continue;
    }

    if (trimmed === '```ptah-ui') {
      const closeIndex = findPtahUiClose(lines, index + 1);
      if (closeIndex === undefined) {
        index += 1;
        continue;
      }

      if (markdownStart < line.start) {
        segments.push({
          kind: 'markdown',
          key: `markdown-${segments.length}`,
          text: text.slice(markdownStart, line.start),
        });
      }
      const closing = lines[closeIndex];
      segments.push({
        kind: 'fence',
        key: `fence-${ordinal}`,
        ordinal,
        raw: text.slice(line.start, closing.next),
        body: text.slice(line.next, closing.start),
      });
      ordinal += 1;
      markdownStart = closing.next;
      index = closeIndex + 1;
      continue;
    }

    const opening = readOpeningFence(trimmed);
    if (opening !== undefined) outer = opening;
    index += 1;
  }

  if (markdownStart < text.length || segments.length === 0) {
    segments.push({
      kind: 'markdown',
      key: `markdown-${segments.length}`,
      text: text.slice(markdownStart),
    });
  }
  return segments;
}

function findPtahUiClose(
  lines: readonly Line[],
  start: number,
): number | undefined {
  const opening: Fence = { marker: '`', length: 3 };
  for (let index = start; index < lines.length; index += 1) {
    if (isTargetClosingFence(removeTrailingSpaces(lines[index].text), opening))
      return index;
  }
  return undefined;
}

function readLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\n') continue;
    const end = index > start && text[index - 1] === '\r' ? index - 1 : index;
    lines.push({ text: text.slice(start, end), start, end, next: index + 1 });
    start = index + 1;
  }
  if (start < text.length)
    lines.push({
      text: text.slice(start),
      start,
      end: text.length,
      next: text.length,
    });
  return lines;
}

function removeTrailingSpaces(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === ' ') end -= 1;
  return value.slice(0, end);
}

function readOpeningFence(line: string): Fence | undefined {
  const content = withoutCommonMarkIndent(line);
  if (content === undefined) return undefined;
  const marker = content[0];
  if (marker !== '`' && marker !== '~') return undefined;
  let length = 0;
  while (content[length] === marker) length += 1;
  return length >= 3 ? { marker, length } : undefined;
}

function isClosingFence(line: string, opening: Fence): boolean {
  const content = withoutCommonMarkIndent(line);
  if (content === undefined) return false;
  let length = 0;
  while (content[length] === opening.marker) length += 1;
  return length >= opening.length && content.slice(length).trim() === '';
}

function isTargetClosingFence(line: string, opening: Fence): boolean {
  return isClosingFence(line, opening);
}

function withoutCommonMarkIndent(line: string): string | undefined {
  let index = 0;
  while (line[index] === ' ') index += 1;
  return index <= 3 ? line.slice(index) : undefined;
}
