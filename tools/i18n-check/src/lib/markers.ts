/**
 * Source markers shared by the TypeScript and template scans.
 *
 * - `i18n-keys: <key> <prefix>.* …` declares the keys a computed key argument
 *   can take.
 * - `i18n-ignore: <reason>` silences a literal-scan false positive. It never
 *   silences a `transloco` pipe or a `translate(` argument.
 * - `rtl-exempt: <reason>` passes a physical-direction match of the RTL rule
 *   (`rtl-patterns.ts`).
 * - `i18n-format-exempt: <reason>` passes a locale-formatting match of the
 *   formatting rule (`format-patterns.ts`).
 *
 * A marker attaches by syntax, not by line count, so Prettier's wrapping
 * never detaches it:
 * - a template comment (`<!-- i18n-keys: … -->`) covers the full source span
 *   of its next sibling node (see `template-keys.ts`);
 * - a TS comment on its own line covers the full span of the node it leads:
 *   the next statement, class member, object property or argument;
 * - a CSS comment covers the next declaration or rule (see `rtl-patterns.ts`).
 * A marker that attaches to nothing (a trailing comment, or the last comment
 * of a block) is a `detached-marker` violation, never a silent no-op; an
 * `i18n-keys:` marker's keys are still validated.
 */
import * as ts from 'typescript';
import type { Violation } from './report';

export type MarkerKind = 'keys' | 'ignore' | 'rtl-exempt' | 'format-exempt';

/** The marker kinds that need a reason, with the text that introduces them. */
export const REASON_MARKERS: Readonly<
  Record<Exclude<MarkerKind, 'keys'>, string>
> = {
  ignore: 'i18n-ignore:',
  'rtl-exempt': 'rtl-exempt:',
  'format-exempt': 'i18n-format-exempt:',
};

export interface Marker {
  kind: MarkerKind;
  file: string;
  line: number;
  /** `keys`: listed keys (`core.a.b`) and prefixes (`core.checkout.*`). */
  tokens: string[];
  /** Every kind but `keys`: the stated reason, '' when missing. */
  reason: string;
  /** File offsets `[start, end)` the marker covers, or null when it attaches to nothing. */
  covers: { start: number; end: number } | null;
}

export type MarkerBody = Pick<Marker, 'kind' | 'tokens' | 'reason'>;

const KEYS_RE = /i18n-keys:(.*?)(?:-->|\*\/|$)/s;
const REASON_RES = Object.entries(REASON_MARKERS).map(
  ([kind, prefix]) =>
    [
      kind as Exclude<MarkerKind, 'keys'>,
      // `rtl-exempt:` must not match inside another marker name.
      new RegExp(`(?<![\\w-])${prefix}(.*?)(?:-->|\\*\\/|$)`, 's'),
    ] as const,
);

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
  for (const [kind, re] of REASON_RES) {
    const match = re.exec(text);
    if (match) return { kind, tokens: [], reason: match[1].trim() };
  }
  return null;
}

/** The label a report uses for a marker kind (`i18n-keys:`, `rtl-exempt:`, …). */
export function markerLabel(kind: MarkerKind): string {
  return kind === 'keys' ? 'i18n-keys:' : REASON_MARKERS[kind];
}

/** A violation for a marker that covers nothing, or null when it attaches. */
export function detachedMarker(marker: Marker): Violation | null {
  if (marker.covers !== null) return null;
  return {
    file: marker.file,
    line: marker.line,
    kind: 'detached-marker',
    key: '',
    detail: `this ${markerLabel(marker.kind)} marker attaches to nothing; put the marker on its own line directly above the code`,
  };
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
  // Comments that lead only a token (such as the last comment before a
  // block's closing brace) are found through every child token. They lead no
  // node, so they attach to nothing and are reported as detached.
  const find = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
      if (!comments.has(range.pos)) comments.set(range.pos, range);
    }
    for (const child of node.getChildren(source)) find(child);
  };
  find(source);

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
