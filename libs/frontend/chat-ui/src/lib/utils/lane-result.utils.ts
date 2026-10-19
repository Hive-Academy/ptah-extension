/**
 * Lane result parsing: the `WROTE: <path> — <verdict>` lines (and the
 * optional "Reported to the spawning session" note before them) that end an
 * agent message.
 *
 * The parse runs on the RAW text, before markdown: markdown escapes eat a
 * backslash before a dot (`\.claude-worktrees` renders as `.claude-worktrees`
 * glued to the previous segment), so a path shown through markdown is wrong.
 * Paths are kept exactly as written, backslashes included.
 *
 * Only trailing lines count. A WROTE line followed by any other text stays
 * prose, and text with no trailing WROTE line parses to `null`.
 */

/** Colour family of a file's verdict pill. */
export type LaneVerdictTone = 'approved' | 'revision' | 'rejected' | 'neutral';

export interface LaneResultFile {
  /** The path exactly as the lane wrote it. */
  readonly path: string;
  /** Last path segment. */
  readonly name: string;
  /** Text after the separator; empty when the line has none. */
  readonly verdict: string;
  readonly tone: LaneVerdictTone;
}

export interface LaneResultFolder {
  /** The shared parent folder, as written in the first path. */
  readonly path: string;
  /** Its last segment. */
  readonly name: string;
}

export interface LaneResult {
  /** The message text with the result lines removed. */
  readonly body: string;
  /** The "Reported to the spawning session" text, or `null`. */
  readonly reported: string | null;
  readonly files: readonly LaneResultFile[];
  /** The parent folder every file shares, or `null` when they differ. */
  readonly folder: LaneResultFolder | null;
}

const WROTE_PREFIX = /^WROTE:\s+/;
/** An em or en dash separator; paths do not contain these. */
const DASH_SEPARATOR = /\s+[—–]\s+/;
/** An ASCII hyphen separator; the first one after the prefix wins. */
const HYPHEN_SEPARATOR = /\s+-\s+/;
const REPORTED_PREFIX = /^Reported to the spawning session:\s*/i;
const FENCE_LINE = /^(`{3,}|~{3,})\s*([\w-]*)\s*$/;

/** Parse the trailing lane result out of `text`, or `null` when there is none. */
export function parseLaneResult(text: string): LaneResult | null {
  if (!text || !text.includes('WROTE:')) return null;
  const lines = text.split(/\r\n|\r|\n/);

  const files: LaneResultFile[] = [];
  let cut = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === '') continue;
    const file = parseWroteLine(line);
    if (!file) break;
    files.unshift(file);
    cut = i;
  }
  if (files.length === 0) return null;

  const reported = findReportedBefore(lines, cut);
  const bodyEnd = reported ? reported.start : cut;
  return {
    body: lines.slice(0, bodyEnd).join('\n').trimEnd(),
    reported: reported ? reported.text : null,
    files,
    folder: sharedFolder(files),
  };
}

function parseWroteLine(line: string): LaneResultFile | null {
  if (!WROTE_PREFIX.test(line)) return null;
  const rest = line.replace(WROTE_PREFIX, '');
  const separator = DASH_SEPARATOR.exec(rest) ?? HYPHEN_SEPARATOR.exec(rest);
  const rawPath = separator ? rest.slice(0, separator.index) : rest;
  const verdict = separator
    ? rest.slice(separator.index + separator[0].length).trim()
    : '';
  const path = stripBackticks(rawPath.trim());
  if (!path) return null;
  return { path, name: lastSegment(path), verdict, tone: verdictTone(verdict) };
}

function stripBackticks(path: string): string {
  return path.length > 1 && path.startsWith('`') && path.endsWith('`')
    ? path.slice(1, -1).trim()
    : path;
}

function verdictTone(verdict: string): LaneVerdictTone {
  const upper = verdict.toUpperCase();
  if (upper.startsWith('APPROVED')) return 'approved';
  if (upper.startsWith('NEEDS_REVISION') || upper.startsWith('NEEDS REVISION'))
    return 'revision';
  if (upper.startsWith('REJECTED')) return 'rejected';
  return 'neutral';
}

function lastSegment(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.slice(
    Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1,
  );
}

function parentOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
}

function sharedFolder(
  files: readonly LaneResultFile[],
): LaneResultFolder | null {
  const parent = parentOf(files[0].path);
  if (!parent) return null;
  const key = parent.replaceAll('\\', '/');
  const shared = files.every(
    (file) => parentOf(file.path).replaceAll('\\', '/') === key,
  );
  return shared ? { path: parent, name: lastSegment(parent) } : null;
}

/**
 * The "Reported to the spawning session" note directly before line `end`
 * (blank lines between are allowed): one line, or a fenced block whose text
 * starts with the label.
 */
function findReportedBefore(
  lines: readonly string[],
  end: number,
): { start: number; text: string } | null {
  let i = end - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0) return null;

  const last = lines[i].trim();
  if (REPORTED_PREFIX.test(last)) {
    const text = last.replace(REPORTED_PREFIX, '').trim();
    return text ? { start: i, text } : null;
  }

  const close = FENCE_LINE.exec(last);
  if (!close || close[2]) return null;
  for (let open = i - 1; open >= 0; open--) {
    const opener = FENCE_LINE.exec(lines[open].trim());
    if (!opener) continue;
    if (opener[1][0] !== close[1][0] || opener[1].length > close[1].length) {
      return null;
    }
    const content = lines
      .slice(open + 1, i)
      .join('\n')
      .trim();
    if (!REPORTED_PREFIX.test(content)) return null;
    const text = content.replace(REPORTED_PREFIX, '').trim();
    return text ? { start: open, text } : null;
  }
  return null;
}
