const OPENER = '```mermaid';

/** Cheap local gate for the Mermaid lazy component. */
export function hasMermaidFenceLine(text: string): boolean {
  let from = text.indexOf(OPENER);
  while (from !== -1) {
    if (from === 0 || text[from - 1] === '\n') {
      let end = from + OPENER.length;
      while (text[end] === ' ' || text[end] === '\t') end += 1;
      if (text[end] === '\r') end += 1;
      if (end === text.length || text[end] === '\n') return true;
    }
    from = text.indexOf(OPENER, from + 1);
  }
  return false;
}
