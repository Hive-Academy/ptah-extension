export type MermaidTextPart =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'diagram'; readonly source: string; readonly ordinal: number };

const OPENER = '```mermaid';

/** Complete fences become diagrams; incomplete ones remain ordinary markdown. */
export function segmentMermaidFences(text: string): readonly MermaidTextPart[] {
  const parts: MermaidTextPart[] = [];
  let cursor = 0;
  let ordinal = 0;
  let opener = findFenceLine(text, OPENER, 0);

  while (opener !== -1) {
    const bodyStart = lineEnd(text, opener) + 1;
    const closing = findFenceLine(text, '```', bodyStart);
    if (closing === -1) break;
    if (opener > cursor) parts.push({ kind: 'markdown', text: text.slice(cursor, opener) });
    parts.push({ kind: 'diagram', source: text.slice(bodyStart, closing).replace(/\r?\n$/, ''), ordinal: ordinal++ });
    cursor = lineEnd(text, closing) + 1;
    opener = findFenceLine(text, OPENER, cursor);
  }

  if (cursor < text.length || parts.length === 0) parts.push({ kind: 'markdown', text: text.slice(cursor) });
  return parts;
}

function findFenceLine(text: string, marker: string, from: number): number {
  let index = text.indexOf(marker, from);
  while (index !== -1) {
    if (index === 0 || text[index - 1] === '\n') {
      const rest = text.slice(index + marker.length, lineEnd(text, index));
      if (/^[ \t]*\r?$/.test(rest)) return index;
    }
    index = text.indexOf(marker, index + 1);
  }
  return -1;
}

function lineEnd(text: string, from: number): number {
  const index = text.indexOf('\n', from);
  return index === -1 ? text.length : index;
}
