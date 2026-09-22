/**
 * Pure markdown-to-plain-text stripper for compact session feed labels and detail lines.
 * Strips markdown markup and collapses all whitespace into a clean single line.
 * Uses bounded, zero-backtracking regular expressions with mutually exclusive character classes.
 */
export function stripMarkdownToPlainText(
  input: string | null | undefined,
): string {
  if (!input) return '';

  let text = input;

  // 1. Remove fenced code blocks delimiters (keep content inside)
  if (text.includes('```')) {
    text = text.replace(/```[a-zA-Z0-9_-]*\r?\n?([\s\S]*?)```/g, '$1');
  }

  // 2. Remove table separator rows like |---|---| or |:---|---:| without backtracking
  if (text.includes('--')) {
    text = text.replace(/^[ \t|:-]+$/gm, (line) =>
      line.includes('--') ? ' ' : line,
    );
    // Inline separator runs (`| a | |---|---|`) left by already-joined rows.
    text = text.replace(/\|[ \t|:-]+\|/g, (run) =>
      run.includes('--') ? ' ' : run,
    );
  }

  // 3. Headings at line start
  if (text.includes('#')) {
    text = text.replace(/^\s*#{1,6}[ \t]+/gm, '');
  }

  // 4. Blockquotes at line start
  if (text.includes('>')) {
    text = text.replace(/^\s*>[ \t]*/gm, '');
  }

  // 5. List bullets or numbers at line start
  text = text.replace(/^\s*(?:[*+-]|\d{1,9}\.)[ \t]+/gm, '');

  // 6. Image syntax ![alt](url) -> alt (bounded within single line)
  if (text.includes('![') && text.includes('](')) {
    text = text.replace(/!\[([^\]\r\n]{0,500})\]\([^)\r\n]{0,1000}\)/g, '$1');
  }

  // 7. Link syntax [text](url) -> text (bounded within single line)
  if (text.includes('[') && text.includes('](')) {
    text = text.replace(/\[([^\]\r\n]{1,500})\]\([^)\r\n]{0,1000}\)/g, '$1');
  }

  // 8. Inline code ticks
  if (text.includes('`')) {
    text = text.replace(/`([^`\n]+)`/g, '$1');
    text = text.replace(/`/g, '');
  }

  // 9. Bold/italic emphasis with word-boundary and whitespace guards
  // Using mutually exclusive ([^\s]+(?:\s+[^\s]+)*) prevents any internal backtracking.
  // Preserves snake_case, PTAH_API_KEY, globs (rm *.ts && ls *.js), and arithmetic (2 * 3 * 4).
  if (text.includes('**')) {
    text = text.replace(
      /(^|[^\w*])\*\*([^*\n\s]+(?:\s+[^*\n\s]+)*)\*\*(?![\w*])/g,
      '$1$2',
    );
  }
  if (text.includes('__')) {
    text = text.replace(
      /(^|[^\w_])__([^_\n\s]+(?:\s+[^_\n\s]+)*)__(?![\w_])/g,
      '$1$2',
    );
  }
  if (text.includes('*')) {
    text = text.replace(
      /(^|[^\w*])\*([^*\n\s]+(?:\s+[^*\n\s]+)*)\*(?![\w*])/g,
      '$1$2',
    );
  }
  if (text.includes('_')) {
    text = text.replace(
      /(^|[^\w_])_([^_\n\s]+(?:\s+[^_\n\s]+)*)_(?![\w_])/g,
      '$1$2',
    );
  }

  // 10. Table pipes -> space
  if (text.includes('|')) {
    text = text.replace(/\|/g, ' ');
  }

  // 11. Collapse all whitespace into a single line
  return text.replace(/\s+/g, ' ').trim();
}
