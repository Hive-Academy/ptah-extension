/**
 * Caps the role block a spawned lane receives (TASK_2026_597, R3.6).
 *
 * A role file is user-owned and generated, so its heading names are not a
 * contract and no allow/deny list is applied. The condenser keeps the text
 * before the first `## ` heading (the role's identity and contract), then whole
 * `## ` sections in document order while they fit. The first unit that does
 * not fit is cut: at its last paragraph break that fits, else at its last line
 * break, else hard at a code-point boundary (a fence open at that point is
 * closed). Later sections that still fit after that cut are kept in order;
 * the rest are omitted. One closing pointer line names what was left out and
 * where the full definition lives, so the lane can read a section when its
 * task needs it instead of losing it silently.
 *
 * The cap is measured in JavaScript string length and covers the header and
 * the pointer line: the result is never longer than `maxChars`. The pointer's
 * omitted-name list is bounded by {@link OMITTED_NAMES_MAX_CHARS}, so the
 * pointer never takes room the kept text needs and the work is linear in the
 * input size. Pure: equal input gives equal output, no state is shared.
 */

/** Largest role block, header and pointer included, that any lane receives. */
export const LANE_ROLE_MAX_CHARS = 10_000;

/** Room for the omitted-name list in the pointer, before "and N more". */
export const OMITTED_NAMES_MAX_CHARS = 600;

export interface LaneRoleParts {
  /** Header placed above a body that has at least some kept text. */
  readonly header: string;
  /**
   * Header used when none of the body fits. It must not claim that a
   * definition follows; it sends the lane to the file named by the pointer.
   */
  readonly headerWithoutBody: string;
  readonly body: string;
  /** Absolute path of the full role file, named by the pointer line. */
  readonly sourcePath: string;
}

const SECTION_HEADING_PREFIX = '## ';
const OPENING_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})\s*$/;
const PIECE_SEPARATOR = '\n\n';
const POINTER_LIST_PREFIX = 'This role was condensed for the lane; omitted: ';
const NAME_SEPARATOR = '; ';

interface RoleUnit {
  readonly start: number;
  readonly end: number;
  /** Where the unit's own text begins: after its heading line, if it has one. */
  readonly contentStart: number;
  /** Length of the unit's text with trailing whitespace removed. */
  readonly length: number;
  /** How the pointer names this unit when it is dropped entirely. */
  readonly omittedName: string;
  /** How the pointer names this unit when only its start is kept. */
  readonly cutName: string;
}

export function condenseLaneRole(
  parts: LaneRoleParts,
  maxChars: number = LANE_ROLE_MAX_CHARS,
): string {
  const { header, headerWithoutBody, body, sourcePath } = parts;
  if (header.length + body.length <= maxChars) {
    return header + body;
  }

  const units = splitIntoUnits(body);
  const tail = pointerTail(sourcePath);
  // Upper bound of the pointer line whatever ends up omitted, so the kept
  // text is sized once and never re-measured against a growing pointer.
  const pointerReserve =
    POINTER_LIST_PREFIX.length +
    OMITTED_NAMES_MAX_CHARS +
    `${NAME_SEPARATOR}and ${units.length} more`.length +
    '. '.length +
    tail.length;
  // Every kept piece costs its length plus the separator after it; the last
  // separator is the one in front of the pointer.
  let remaining = maxChars - header.length - pointerReserve;

  const pieces: string[] = [];
  const omitted: string[] = [];
  let index = 0;
  for (; index < units.length; index++) {
    const cost = units[index].length + PIECE_SEPARATOR.length;
    if (cost > remaining) break;
    pieces.push(unitText(body, units[index]));
    remaining -= cost;
  }

  if (index < units.length) {
    const cutUnit = units[index];
    const later = units.slice(index + 1);
    // Later sections that fit are kept, but they may take at most half of the
    // room left, so the cut unit (often the role's identity) keeps the rest.
    let keptLater = fitInOrder(later, Math.floor(remaining / 2));
    const laterCost = costOf(keptLater);
    const piece = cutUnitText(
      body,
      cutUnit,
      remaining - laterCost - PIECE_SEPARATOR.length,
    );
    if (piece !== undefined) {
      pieces.push(piece);
      omitted.push(cutUnit.cutName);
    } else {
      omitted.push(cutUnit.omittedName);
      keptLater = fitInOrder(later, remaining);
    }
    for (const unit of later) {
      if (keptLater.has(unit)) {
        pieces.push(unitText(body, unit));
      } else {
        omitted.push(unit.omittedName);
      }
    }
  }

  const pointer = pointerLine(omitted, tail);
  const result =
    pieces.length > 0
      ? header + pieces.join(PIECE_SEPARATOR) + PIECE_SEPARATOR + pointer
      : headerWithoutBody + pointer;
  // Only a pathological header or source path can still overflow here.
  return result.length <= maxChars ? result : result.slice(0, maxChars);
}

/** Units chosen greedily in document order whose total cost fits `budget`. */
function fitInOrder(units: readonly RoleUnit[], budget: number): Set<RoleUnit> {
  const chosen = new Set<RoleUnit>();
  let used = 0;
  for (const unit of units) {
    const cost = unit.length + PIECE_SEPARATOR.length;
    if (used + cost <= budget) {
      chosen.add(unit);
      used += cost;
    }
  }
  return chosen;
}

function costOf(units: ReadonlySet<RoleUnit>): number {
  let total = 0;
  for (const unit of units) total += unit.length + PIECE_SEPARATOR.length;
  return total;
}

function unitText(body: string, unit: RoleUnit): string {
  return body.slice(unit.start, unit.end).trimEnd();
}

/**
 * Splits the body into the opening text and its `## ` sections. A `## ` line
 * inside a fenced code block is example content, not a section boundary.
 */
function splitIntoUnits(body: string): RoleUnit[] {
  const starts: Array<{ offset: number; heading?: string }> = [];
  forEachLine(body, (line, offset, inFence) => {
    if (!inFence && line.startsWith(SECTION_HEADING_PREFIX)) {
      starts.push({
        offset,
        heading: line.slice(SECTION_HEADING_PREFIX.length).trim(),
      });
    } else if (offset === 0) {
      starts.push({ offset: 0 });
    }
  });

  const units: RoleUnit[] = [];
  starts.forEach((start, index) => {
    const end = starts[index + 1]?.offset ?? body.length;
    const length = body.slice(start.offset, end).trimEnd().length;
    if (start.heading === undefined) {
      if (body.slice(start.offset, end).trim() === '') return;
      units.push({
        start: start.offset,
        end,
        contentStart: start.offset,
        length,
        omittedName: 'the opening text',
        cutName: 'the rest of the opening text',
      });
      return;
    }
    const newline = body.indexOf('\n', start.offset);
    const name = start.heading || '(untitled section)';
    units.push({
      start: start.offset,
      end,
      contentStart: newline === -1 || newline >= end ? end : newline + 1,
      length,
      omittedName: name,
      cutName: `${name} (cut short)`,
    });
  });
  return units;
}

/**
 * The longest start of `unit` within `limit` chars that keeps some of the
 * unit's own text (never a bare heading): cut at the last paragraph break,
 * else the last line break, else hard at a code-point boundary. No cut leaves
 * a fence open. Undefined when nothing of the unit fits.
 */
function cutUnitText(
  body: string,
  unit: RoleUnit,
  limit: number,
): string | undefined {
  const text = body.slice(unit.start, unit.end);
  const contentOffset = unit.contentStart - unit.start;
  if (limit <= contentOffset) return undefined;

  let lastParagraphBreak = -1;
  let lastLineBreak = -1;
  let contentSeen = false;
  forEachLine(text, (line, offset, inFence) => {
    if (offset > limit) return;
    if (offset > contentOffset && contentSeen && !inFence) {
      lastLineBreak = offset;
      if (line.trim() === '') lastParagraphBreak = offset;
    }
    if (offset >= contentOffset && line.trim() !== '') contentSeen = true;
  });

  const softCut =
    lastParagraphBreak !== -1 ? lastParagraphBreak : lastLineBreak;
  if (softCut !== -1) {
    return text.slice(0, softCut).trimEnd();
  }

  // Hard cut. A fence left open at the cut point is closed, inside the limit.
  let end = codePointBoundary(text, limit);
  const openAtLimit = fenceOpenAfter(text.slice(0, end));
  if (openAtLimit !== undefined) {
    end = codePointBoundary(text, limit - openAtLimit.length - 1);
  }
  const kept = text.slice(0, Math.max(end, 0));
  if (kept.slice(contentOffset).trim() === '') return undefined;
  const stillOpen = fenceOpenAfter(kept);
  return stillOpen !== undefined ? `${kept}\n${stillOpen}` : kept;
}

/** `end`, stepped back one unit when it would split a surrogate pair. */
function codePointBoundary(text: string, end: number): number {
  if (end <= 0) return 0;
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}

function fenceOpenAfter(text: string): string | undefined {
  return forEachLine(text, () => undefined);
}

/**
 * Visits every line with its start offset and whether a fence is open before
 * it, and returns the fence still open after the last line (if any). A fence
 * closes only on a line holding nothing but at least as many of the same
 * marker character, so an info-string line such as "```ts" inside a fence
 * does not close it.
 */
function forEachLine(
  text: string,
  visit: (line: string, offset: number, inFence: boolean) => void,
): string | undefined {
  let offset = 0;
  let openFence: string | undefined;
  for (const line of text.split('\n')) {
    visit(line, offset, openFence !== undefined);
    if (openFence === undefined) {
      openFence = OPENING_FENCE_PATTERN.exec(line)?.[1];
    } else {
      const closing = CLOSING_FENCE_PATTERN.exec(line)?.[1];
      if (
        closing &&
        closing[0] === openFence[0] &&
        closing.length >= openFence.length
      ) {
        openFence = undefined;
      }
    }
    offset += line.length + 1;
  }
  return openFence;
}

function pointerTail(sourcePath: string): string {
  return `The full definition is at \`${sourcePath}\`; read a section only when the task needs it.`;
}

/**
 * The closing pointer. Names are listed in document order while they fit in
 * {@link OMITTED_NAMES_MAX_CHARS}; the remainder is counted as "and N more".
 */
function pointerLine(omitted: readonly string[], tail: string): string {
  if (omitted.length === 0) {
    return `This role was condensed for the lane. ${tail}`;
  }
  const listed: string[] = [];
  let used = 0;
  for (const name of omitted) {
    const cost = (listed.length > 0 ? NAME_SEPARATOR.length : 0) + name.length;
    if (used + cost > OMITTED_NAMES_MAX_CHARS) break;
    listed.push(name);
    used += cost;
  }
  const hidden = omitted.length - listed.length;
  if (hidden > 0) {
    listed.push(
      listed.length === 0
        ? `${hidden} section${hidden === 1 ? '' : 's'}`
        : `and ${hidden} more`,
    );
  }
  return `${POINTER_LIST_PREFIX}${listed.join(NAME_SEPARATOR)}. ${tail}`;
}
