/**
 * Source markers shared by the TypeScript and template scans.
 *
 * - `i18n-keys: <key> <prefix>.* …` declares the keys a computed key argument
 *   can take.
 * - `i18n-ignore: <reason>` silences a literal-scan false positive. It never
 *   silences a `transloco` pipe or a `translate(` argument.
 *
 * A marker attaches by syntax, not by line count, so Prettier's wrapping
 * never detaches it:
 * - a template comment (`<!-- i18n-keys: … -->`) covers the full source span
 *   of its next sibling node (see `template-keys.ts`);
 * - a TS comment on its own line covers the full span of the node it leads:
 *   the next statement, class member, object property or argument.
 * A marker with nothing after it covers nothing, but its keys are still
 * validated.
 */
import * as ts from 'typescript';

export interface Marker {
  kind: 'keys' | 'ignore';
  file: string;
  line: number;
  /** `keys`: listed keys (`core.a.b`) and prefixes (`core.checkout.*`). */
  tokens: string[];
  /** `ignore`: the stated reason, '' when missing. */
  reason: string;
  /** File offsets `[start, end)` the marker covers, or null when it attaches to nothing. */
  covers: { start: number; end: number } | null;
}

export type MarkerBody = Pick<Marker, 'kind' | 'tokens' | 'reason'>;

const KEYS_RE = /i18n-keys:(.*?)(?:-->|\*\/|$)/s;
const IGNORE_RE = /i18n-ignore:(.*?)(?:-->|\*\/|$)/s;

/** Reads the marker in one comment's text, or null when it holds none. */
export function parseMarkerComment(text: string): MarkerBody | null {
  const keys = KEYS_RE.exec(text);
  if (keys) {
    const tokens = keys[1]
      .trim()
      .split(/\s+/)
      .filter((t) => t !== '');
    return { kind: 'keys', tokens, reason: '' };
  }
  const ignore = IGNORE_RE.exec(text);
  if (ignore) {
    return { kind: 'ignore', tokens: [], reason: ignore[1].trim() };
  }
  return null;
}

export function coversOffset(marker: Marker, offset: number): boolean {
  return (
    marker.covers !== null &&
    offset >= marker.covers.start &&
    offset < marker.covers.end
  );
}

/**
 * Markers in the comments of one TypeScript file. Comments inside template
 * literals are not comments here; inline templates are scanned separately.
 */
export function tsMarkers(source: ts.SourceFile, file: string): Marker[] {
  const text = source.text;
  const comments = new Map<number, ts.CommentRange>();
  /** Comment position → the outermost node that it leads. */
  const leads = new Map<number, ts.Node>();

  const visit = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
      comments.set(range.pos, range);
      if (
        !leads.has(range.pos) &&
        // The file itself would cover everything; end-of-file covers nothing.
        !ts.isSourceFile(node) &&
        node.kind !== ts.SyntaxKind.EndOfFileToken &&
        onOwnLine(text, range.pos)
      ) {
        leads.set(range.pos, node);
      }
    }
    for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) {
      comments.set(range.pos, range);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  visit(source.endOfFileToken);

  const markers: Marker[] = [];
  for (const range of [...comments.values()].sort((a, b) => a.pos - b.pos)) {
    const body = parseMarkerComment(text.slice(range.pos, range.end));
    if (!body) continue;
    const node = leads.get(range.pos);
    markers.push({
      ...body,
      file,
      line: source.getLineAndCharacterOfPosition(range.pos).line + 1,
      covers: node
        ? { start: node.getStart(source), end: node.getEnd() }
        : null,
    });
  }
  return markers;
}

/** True when only whitespace precedes `pos` on its line (not a trailing comment). */
function onOwnLine(text: string, pos: number): boolean {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  return text.slice(lineStart, pos).trim() === '';
}
