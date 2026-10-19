/**
 * Prepares a typed user message for the markdown renderer.
 *
 * A user message is plain text that may contain some markdown (code, bold,
 * lists). Rendered as-is, three things go wrong:
 * - `<Tag>` is read as HTML and the sanitizer drops it, so the word vanishes.
 * - `\` before punctuation is a markdown escape, so `C:\.ptah` loses its `\`.
 * - A single newline joins the two lines into one paragraph.
 *
 * Outside code, this escapes `<` and every `\`, and turns each single
 * newline into a hard break. Fenced code, indented code and inline code
 * spans pass through unchanged, because markdown already shows them as
 * literal text.
 */
export function toUserMessageMarkdown(text: string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let fence: { char: string; length: number } | null = null;
  let previousBlank = true;
  let inIndentedCode = false;

  const flushProse = (): void => {
    if (prose.length > 0) {
      out.push(escapeProse(prose.join('\n')));
      prose = [];
    }
  };

  for (const line of text.split('\n')) {
    const blank = line.trim() === '';
    if (fence) {
      out.push(line);
      if (closesFence(line, fence)) fence = null;
    } else if (FENCE_OPEN.test(line)) {
      flushProse();
      const marker = (FENCE_OPEN.exec(line) as RegExpExecArray)[1];
      fence = { char: marker[0], length: marker.length };
      out.push(line);
    } else if (
      INDENTED_CODE.test(line) &&
      !blank &&
      (previousBlank || inIndentedCode)
    ) {
      flushProse();
      inIndentedCode = true;
      out.push(line);
    } else if (inIndentedCode && blank) {
      out.push(line);
    } else {
      inIndentedCode = false;
      prose.push(line);
    }
    previousBlank = blank;
  }
  flushProse();
  return out.join('\n');
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const INLINE_CODE = /(`+)[\s\S]*?\1(?!`)/g;

function closesFence(
  line: string,
  fence: { char: string; length: number },
): boolean {
  const match = /^ {0,3}(`+|~+)\s*$/.exec(line);
  return (
    match !== null &&
    match[1][0] === fence.char &&
    match[1].length >= fence.length
  );
}

function escapeProse(text: string): string {
  let result = '';
  let last = 0;
  for (const match of text.matchAll(INLINE_CODE)) {
    result += escapeText(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  result += escapeText(text.slice(last));
  return result.replace(/([^\n])\n(?=[^\n])/g, '$1  \n');
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/</g, '&lt;');
}
