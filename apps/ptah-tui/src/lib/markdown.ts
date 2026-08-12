/**
 * A focused, streaming-safe markdown parser for terminal rendering.
 *
 * Why not a library: every ink markdown renderer on npm parses a *complete*
 * document and throws on the half-written one that a streaming turn produces
 * ninety-nine frames out of a hundred. An unterminated ``` fence has to render
 * as an open code block, not as three literal backticks that snap into a block
 * once the closing fence arrives — otherwise the whole transcript reflows on
 * every chunk. The same goes for a dangling `**`. So the parser is ours, it is
 * line-based, and it is total: every input produces blocks, no input throws.
 *
 * Deliberately not supported (out of scope for a terminal transcript): tables,
 * reference links, HTML, setext headings, nested block quotes, lazy
 * continuation lines.
 *
 * Ink-free on purpose so it is unit-testable.
 */

export type InlineSpan =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold'; readonly text: string }
  | { readonly kind: 'italic'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

export type MarkdownBlock =
  | {
      readonly kind: 'heading';
      readonly level: number;
      readonly spans: readonly InlineSpan[];
    }
  | { readonly kind: 'paragraph'; readonly spans: readonly InlineSpan[] }
  | {
      readonly kind: 'list-item';
      readonly ordered: boolean;
      readonly marker: string;
      readonly depth: number;
      readonly spans: readonly InlineSpan[];
    }
  | {
      readonly kind: 'code';
      readonly language: string;
      readonly lines: readonly string[];
      /** False while the closing fence has not arrived yet. */
      readonly closed: boolean;
    }
  | { readonly kind: 'quote'; readonly spans: readonly InlineSpan[] }
  | { readonly kind: 'rule' };

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*([A-Za-z0-9_+#.-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UNORDERED_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

/*
 * Terminal control stripping.
 *
 * This parser's input is ASSISTANT-GENERATED, and a model can be induced to
 * emit raw escape sequences by anything it reads - a file, a web page, a tool
 * result. Ink's `<Text>` does not filter them, so whatever survives here is
 * written to the user's terminal and interpreted by the emulator: screen and
 * cursor manipulation, a rewritten window title, and on emulators that honour
 * OSC 52 (iTerm2, kitty, recent xterm, tmux with set-clipboard on) a write to
 * the system clipboard.
 *
 * The strip lives in the parser rather than at the render boundary in
 * `components/chat/Markdown.tsx` because that boundary is not a single
 * chokepoint: fenced code content never becomes an `InlineSpan` at all. It is
 * pushed to `lines` verbatim and rendered through `highlightLine`, so
 * sanitising spans alone would leave a fenced block - the easiest thing in the
 * world for a model to emit - fully exposed. Sanitising the input on the way in
 * covers every block kind, every span, and link hrefs, in one place.
 *
 * Written as a scanner over character codes rather than as regexes full of
 * escapes: it keeps literal control bytes out of this file entirely, and it
 * handles the sequence that a streaming turn cut in half, which is the case a
 * regex alternation gets wrong most often.
 *
 * Not a defence against a malicious local user, who owns the terminal anyway.
 * It is a defence against injected content reaching the emulator unread.
 */

const ESC = 0x1b;
const BEL = 0x07;
/** The `\` of `ESC \`, the 7-bit string terminator. */
const ST_TAIL = 0x5c;
const CSI_INTRODUCER = 0x5b; // '['
const OSC_INTRODUCER = 0x5d; // ']'

/**
 * True for control characters that must never reach the emulator.
 *
 * TAB (0x09) and LF (0x0a) are deliberately spared: this parser is line-based
 * and splits on LF, and `depthFromIndent` reads TAB as indentation, so
 * stripping either would flatten every list and merge every block - it would
 * destroy the structure this module exists to produce. CR (0x0d) is NOT spared:
 * on its own it returns the cursor to column zero, which is a line-overwrite
 * primitive, and nothing here needs it.
 *
 * The 0x80-0x9f range is C1, where a single byte means what a two-byte ESC
 * sequence means in 7-bit form - 0x9b is CSI and 0x9d is OSC.
 */
function isStrippableControl(code: number): boolean {
  if (code === 0x09 || code === 0x0a) return false;
  return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

/**
 * Index just past the escape sequence beginning at `start`, where
 * `text.charCodeAt(start)` is ESC.
 *
 * An unterminated sequence consumes the rest of the input on purpose. Half an
 * OSC is still an OSC to a real terminal, so emitting the tail as visible text
 * would be worse than dropping it.
 */
function endOfEscapeSequence(text: string, start: number): number {
  const introducer = text.charCodeAt(start + 1);

  if (introducer === CSI_INTRODUCER) {
    let i = start + 2;
    // Parameter bytes, then intermediate bytes, then one final byte.
    while (
      i < text.length &&
      text.charCodeAt(i) >= 0x30 &&
      text.charCodeAt(i) <= 0x3f
    ) {
      i += 1;
    }
    while (
      i < text.length &&
      text.charCodeAt(i) >= 0x20 &&
      text.charCodeAt(i) <= 0x2f
    ) {
      i += 1;
    }
    return i < text.length ? i + 1 : i;
  }

  if (introducer === OSC_INTRODUCER) {
    let i = start + 2;
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (code === BEL) return i + 1;
      if (code === ESC && text.charCodeAt(i + 1) === ST_TAIL) return i + 2;
      i += 1;
    }
    return i;
  }

  // Any other escape: ESC plus at most one more character.
  return Number.isNaN(introducer) ? start + 1 : start + 2;
}

/** Cheap pre-scan so clean text - almost every frame - allocates nothing. */
function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (isStrippableControl(text.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * Remove terminal control sequences and stray control characters, preserving
 * TAB and LF. Total and idempotent: every input produces a string, and running
 * it twice changes nothing.
 */
export function stripTerminalControls(text: string): string {
  if (!hasControlCharacters(text)) return text;

  let out = '';
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === ESC) {
      i = endOfEscapeSequence(text, i);
      continue;
    }
    if (isStrippableControl(code)) {
      i += 1;
      continue;
    }
    out += text.charAt(i);
    i += 1;
  }
  return out;
}

/** Two leading spaces per nesting level, matching CommonMark's loosest reading. */
function depthFromIndent(indent: string): number {
  const width = indent.replace(/\t/g, '  ').length;
  return Math.min(3, Math.floor(width / 2));
}

export function parseMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  // The one chokepoint. Everything downstream - spans, code-block lines, link
  // hrefs - is derived from these lines, so nothing reaches Ink unsanitised.
  const lines = stripTerminalControls(text).split('\n');

  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const joined = paragraph.join(' ').trim();
    paragraph = [];
    if (joined.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: parseInline(joined) });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushParagraph();
      const marker = fence[2] ?? '```';
      const language = fence[3] ?? '';
      const body: string[] = [];
      let closed = false;
      i += 1;
      for (; i < lines.length; i += 1) {
        const inner = lines[i] ?? '';
        const closer = FENCE_RE.exec(inner);
        // Only a fence of the same character closes the block, so a ~~~ line
        // inside a ``` block stays content.
        if (closer && (closer[2] ?? '').charAt(0) === marker.charAt(0)) {
          closed = true;
          break;
        }
        body.push(inner);
      }
      // A block still being streamed loses its trailing blank line so the
      // rendered height does not flicker by one row per chunk.
      if (!closed && body.length > 0 && body[body.length - 1] === '') {
        body.pop();
      }
      blocks.push({ kind: 'code', language, lines: body, closed });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }

    if (RULE_RE.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        spans: parseInline((heading[2] ?? '').replace(/\s*#+\s*$/, '')),
      });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushParagraph();
      blocks.push({ kind: 'quote', spans: parseInline(quote[1] ?? '') });
      continue;
    }

    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      flushParagraph();
      blocks.push({
        kind: 'list-item',
        ordered: true,
        marker: `${ordered[2] ?? '1'}.`,
        depth: depthFromIndent(ordered[1] ?? ''),
        spans: parseInline(ordered[3] ?? ''),
      });
      continue;
    }

    const unordered = UNORDERED_RE.exec(line);
    if (unordered) {
      flushParagraph();
      blocks.push({
        kind: 'list-item',
        ordered: false,
        marker: '',
        depth: depthFromIndent(unordered[1] ?? ''),
        spans: parseInline(unordered[2] ?? ''),
      });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

interface InlineRule {
  readonly open: string;
  readonly close: string;
  readonly build: (inner: string) => InlineSpan;
}

// Order matters: `**` must be tried before `*`, or bold parses as two italics.
const INLINE_RULES: readonly InlineRule[] = [
  { open: '`', close: '`', build: (t) => ({ kind: 'code', text: t }) },
  { open: '**', close: '**', build: (t) => ({ kind: 'bold', text: t }) },
  { open: '__', close: '__', build: (t) => ({ kind: 'bold', text: t }) },
  { open: '*', close: '*', build: (t) => ({ kind: 'italic', text: t }) },
  { open: '_', close: '_', build: (t) => ({ kind: 'italic', text: t }) },
];

const LINK_RE = /^\[([^\]]*)\]\(([^)\s]+)\)/;

/**
 * Split a line into styled spans.
 *
 * An unterminated delimiter is emitted as literal text rather than swallowing
 * the rest of the line — that is the whole point of being streaming-safe. Code
 * spans win over emphasis, so `**` inside backticks stays literal.
 */
export function parseInline(rawText: string): InlineSpan[] {
  // `parseMarkdown` has already sanitised everything it passes here, so this is
  // defence in depth for direct callers. The strip is idempotent and returns
  // clean input unchanged, so the second pass costs a scan and no allocation.
  const text = stripTerminalControls(rawText);
  const spans: InlineSpan[] = [];
  let buffer = '';

  const flush = (): void => {
    if (buffer.length === 0) return;
    spans.push({ kind: 'text', text: buffer });
    buffer = '';
  };

  let i = 0;
  outer: while (i < text.length) {
    const rest = text.slice(i);

    const link = LINK_RE.exec(rest);
    if (link) {
      flush();
      spans.push({
        kind: 'link',
        text: link[1] ?? '',
        href: link[2] ?? '',
      });
      i += link[0].length;
      continue;
    }

    for (const rule of INLINE_RULES) {
      if (!rest.startsWith(rule.open)) continue;
      const searchFrom = rule.open.length;
      const closeAt = rest.indexOf(rule.close, searchFrom);
      if (closeAt < 0) continue;
      const inner = rest.slice(searchFrom, closeAt);
      // `** **` is not emphasis, and `____` is not bold — an empty body means
      // the delimiters are literal.
      if (inner.length === 0) continue;
      flush();
      spans.push(rule.build(inner));
      i += closeAt + rule.close.length;
      continue outer;
    }

    buffer += text.charAt(i);
    i += 1;
  }

  flush();
  return spans;
}

/** Flatten spans back to plain text — used for width measurement and specs. */
export function spansToPlainText(spans: readonly InlineSpan[]): string {
  return spans.map((span) => span.text).join('');
}
