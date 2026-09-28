/**
 * Markdown heading outline (TASK_2026_559, User Decisions 7, 9, 10 and 11).
 *
 * Block structure comes from the `marked` lexer (top-level tokens only; the
 * inline pass is never run). Every top-level heading is kept in document
 * order; the budget is then filled with the head of each section, one block
 * per section per pass, so every section gets its first block before any
 * section gets its second.
 *
 * Output contract: an optional BOM, then the exact `raw` of every kept token
 * in input order, plus omission notes and only the `\n` terminators and blank
 * lines that keep each note its own paragraph. No raw is ever split, merged
 * with another, or edited. A blank-line (`space`) token is kept exactly when
 * the token before it is kept, so every separator after kept content
 * survives. A run of omitted blocks becomes one note line; a code block,
 * table, list or block quote that does not fit is replaced by a typed note
 * and its section continues.
 *
 * The input is returned unchanged (original bytes, CRLF included) with a note
 * naming the reason when it is larger than 256 KiB, has container nesting too
 * deep or block-quote continuation too costly to lex safely, makes the lexer
 * throw, lexes to tokens that do not reproduce it, or holds block HTML (any
 * HTML block, comments included, or a block-level tag in any non-code block;
 * User Decisions 10 and 11). It is also
 * returned unchanged when there is nothing to omit or nothing would be kept.
 * When the headings alone exceed the budget, every heading is kept anyway
 * (the pipeline's cut handles the rest). Non-empty input never yields empty
 * text. A reduced output uses LF line endings.
 */
import { Lexer, getDefaults, type Token } from 'marked';
import { countTokens, countTokensPiecewise } from '../token-measure';
import type { OutputReducer, ReduceResult } from '../reducer.types';

/** Larger inputs are left to the pipeline's cut: lexing cost grows fast on list-heavy text. */
const MAX_OUTLINE_CHARS = 262_144;

/** A leading container-prefix run longer than this is not lexed (deep nesting can exhaust the heap). */
const MAX_CONTAINER_PREFIX = 64;

/**
 * Bound on {@link quoteRestartCost}, so a guarded input never enters the
 * super-linear block-quote path. Measured with blockTokens, Node 24, at the
 * 262,144-char cap before this guard: `> x\nx\n` 7.2 s, `> > x\n> x\n`
 * 2.5 s, `> - x\nx\n` 74.7 s (about 80 ns per unit of cost, the worst
 * family). The largest `> - x\nx\n` quote under this bound (4,244 chars,
 * cost about 997,000) lexed in about 20 ms; the guarded families now return
 * in under 20 ms at the cap. Plain quotes, lists with lazy lines, quote-lists
 * and tables stay linear (at most 162 ms at the cap) and are not affected.
 */
const MAX_QUOTE_RESTART_COST = 1_000_000;

/** U+FEFF byte-order mark; stripped before lexing and re-emitted first. */
const BOM = '﻿';

/** Block types replaced by a typed note when they do not fit; the section then continues. */
const TYPED_NOTES: Readonly<Record<string, string>> = {
  code: 'code block',
  table: 'table',
  list: 'list',
  blockquote: 'block quote',
};

/**
 * An opening or closing tag, anywhere in a raw (inside code spans too: they
 * are not parsed, on purpose), of a CommonMark 0.31.2 type-6 block element or
 * a type-1 raw-text / preformatted element (`pre script style textarea`).
 */
const BLOCK_TAG = new RegExp(
  '<\\/?(?:' +
    'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|' +
    'dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|' +
    'frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|' +
    'nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|' +
    'tfoot|th|thead|title|tr|track|ul|' +
    'pre|script|style|textarea' +
    ')(?=[\\s/>]|$)',
  'i',
);

interface Section {
  /** Index of the heading token; `undefined` for the text before the first heading. */
  readonly heading: number | undefined;
  /** Indices of the section's non-`space` tokens, in order. */
  readonly blocks: readonly number[];
}

/** How the fill decided each block: kept whole or replaced by a typed note. */
type Decision = 'keep' | 'note';

export const reduceMarkdown: OutputReducer = (input, ctx) => {
  if (input.length > MAX_OUTLINE_CHARS) {
    return unchanged(input, 'input larger than 256 KiB; not outlined');
  }
  // The guards read exactly the text the lexer sees; every unchanged path
  // still returns the original input.
  let text = input.replace(/\r\n?/g, '\n');
  const bom = text.startsWith(BOM) ? BOM : '';
  text = text.slice(bom.length);
  if (hasDeepContainerPrefix(text)) {
    return unchanged(input, 'container nesting too deep to outline safely');
  }
  if (quoteRestartCost(text) > MAX_QUOTE_RESTART_COST) {
    return unchanged(
      input,
      'block quote continuation too costly to outline safely',
    );
  }
  let tokens: Token[];
  try {
    tokens = lexBlocks(text);
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    return unchanged(input, `markdown lexer failed: ${name}`);
  }
  if (tokens.map((token) => token.raw).join('') !== text) {
    return unchanged(input, 'lexer tokens do not reproduce the input');
  }
  if (tokens.some(hasHtmlBlock)) {
    return unchanged(input, 'HTML blocks present; not outlined');
  }

  const sections = splitSections(tokens);
  const bodyLines = sections.reduce(
    (sum, section) =>
      sum +
      section.blocks.reduce((n, i) => n + lineCount(tokens[i].raw), 0),
    0,
  );
  if (bodyLines === 0) {
    return unchanged(input, 'no section text to omit');
  }
  const budget = ctx.budgetTokens;
  const noteCost = lineTokens('(99999 lines omitted)', Infinity) + 2;
  const headingCost = countTokens(bom) + headingTokens(tokens, sections, budget);
  const withBlocks = sections.filter((section) => section.blocks.length > 0);
  const room = budget - headingCost - noteCost * withBlocks.length;
  if (!(room >= 0)) {
    return headingsOnly(input, bom, tokens, sections, bodyLines);
  }
  const decisions = fillSections(tokens, sections, room, noteCost);
  return render(input, bom, tokens, decisions, bodyLines);
};

function unchanged(input: string, note: string): ReduceResult {
  return { text: input, reducer: 'markdown-unchanged', notes: [note] };
}

/**
 * Top-level block tokens. A fresh options object per call: the Lexer writes
 * its tokenizer into the object it is given, and the process-global `marked`
 * instance (which `use()` elsewhere in the host can change) is never touched.
 */
function lexBlocks(text: string): Token[] {
  return new Lexer({ ...getDefaults(), gfm: true, pedantic: false }).blockTokens(
    text,
    [],
  );
}

/**
 * Whether any line starts with a run of container-prefix characters (spaces,
 * tabs, `>`, list markers, digits, `.`, `)`) longer than
 * {@link MAX_CONTAINER_PREFIX} that holds at least one non-whitespace char.
 * A pure-whitespace indent is indented code, which is cheap to lex. One
 * linear pass over LF-only text.
 */
function hasDeepContainerPrefix(text: string): boolean {
  let run = 0;
  let marker = false;
  let atLineStart = true;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\n') {
      atLineStart = true;
      run = 0;
      marker = false;
      continue;
    }
    if (!atLineStart) {
      continue;
    }
    if (char === ' ' || char === '\t') {
      run++;
    } else if (isContainerChar(char)) {
      run++;
      marker = true;
    } else {
      atLineStart = false;
      continue;
    }
    if (marker && run > MAX_CONTAINER_PREFIX) {
      return true;
    }
  }
  return false;
}

function isContainerChar(char: string): boolean {
  return (
    '>-+*.)'.includes(char) || (char >= '0' && char <= '9')
  );
}

/**
 * Estimated work in marked's block-quote tokenizer. Inside one quote, every
 * group of `>` lines that follows a lazy continuation line (or a shallower
 * line) restarts its loop, and each restart copies all remaining lines of the
 * quote, so the work is about restarts × lines per run of non-blank lines.
 * A blank line ends every quote; a column-0 bullet item (which interrupts a
 * paragraph) ends a top-level one. The sum over runs is returned; one linear
 * pass over LF-only text.
 */
function quoteRestartCost(text: string): number {
  let total = 0;
  let runLines = 0;
  let restarts = 0;
  let previousDepth = 0;
  const endRun = (): void => {
    total += restarts * runLines;
    runLines = 0;
    restarts = 0;
  };
  for (const line of text.split('\n')) {
    if (/^[ \t]*$/.test(line)) {
      endRun();
      continue;
    }
    if (/^[*+-][ \t]+\S/.test(line)) {
      endRun();
    }
    let depth = 0;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '>') {
        depth++;
      } else if (char !== ' ' && char !== '\t' && !isContainerChar(char)) {
        break;
      }
    }
    if (runLines > 0 && depth > previousDepth) {
      restarts++;
    }
    runLines++;
    previousDepth = depth;
  }
  endRun();
  return total;
}

/**
 * Whether a token makes the outline unsafe: dropping one side of an HTML
 * element could detach the Markdown it wraps from its context, and reading
 * HTML context from tags (comments, attributes, code spans, raw text) is not
 * reliable, so any block HTML declines the outline. That is every `html`
 * token (comments included: HTML ends a comment early on `<!-->` or `--!>`),
 * and every other non-code token whose raw holds a block tag (code spans
 * included).
 */
function hasHtmlBlock(token: Token): boolean {
  if (token.type === 'code') {
    return false;
  }
  return token.type === 'html' || BLOCK_TAG.test(token.raw);
}

/** The preamble plus one section per top-level heading token. */
function splitSections(tokens: readonly Token[]): Section[] {
  const sections: Array<{ heading: number | undefined; blocks: number[] }> = [
    { heading: undefined, blocks: [] },
  ];
  tokens.forEach((token, i) => {
    if (token.type === 'heading') {
      sections.push({ heading: i, blocks: [] });
    } else if (token.type !== 'space') {
      sections[sections.length - 1].blocks.push(i);
    }
  });
  return sections;
}

/** Number of lines in `text`; a final line terminator does not start another line. */
function lineCount(text: string): number {
  if (text === '') {
    return 0;
  }
  let count = text.endsWith('\n') ? 0 : 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      count++;
    }
  }
  return count;
}

/**
 * Token cost of `text` plus its newline, counted piece-wise; stops once the
 * cost passes `limit` and returns the partial sum (already over the limit).
 */
function lineTokens(text: string, limit: number): number {
  return 1 + countTokensPiecewise(text, limit - 1);
}

/** Cost of a raw, line by line; stops early once it passes `limit`. */
function rawTokens(raw: string, limit: number): number {
  const lines = raw.split('\n');
  if (raw.endsWith('\n')) {
    lines.pop();
  }
  let total = 0;
  for (const line of lines) {
    total += lineTokens(line, limit - total);
    if (total > limit) {
      break;
    }
  }
  return total;
}

/** Cost of token `i` plus the blank-line token after it, which is emitted with it. */
function tokenCost(tokens: readonly Token[], i: number, limit: number): number {
  let total = rawTokens(tokens[i].raw, limit);
  const next = tokens[i + 1];
  if (total <= limit && next?.type === 'space') {
    total += rawTokens(next.raw, limit - total);
  }
  return total;
}

/** Cost of every heading with its following separator; stops early once it passes `limit`. */
function headingTokens(
  tokens: readonly Token[],
  sections: readonly Section[],
  limit: number,
): number {
  let total = 0;
  for (const { heading } of sections) {
    if (heading === undefined) {
      continue;
    }
    total += tokenCost(tokens, heading, limit - total);
    if (total > limit) {
      break;
    }
  }
  return total;
}

function typedNote(token: Token): string | undefined {
  const kind = TYPED_NOTES[token.type];
  return kind === undefined
    ? undefined
    : `(${kind}, ${lineCount(token.raw)} lines, omitted)`;
}

/**
 * Round-robin over the sections: each pass offers every open section its next
 * block. A block that fits is kept. A code, table, list or block-quote
 * block that does not fit is replaced by its typed note and the section
 * continues; any other block ends the section's head. A section taken in full
 * releases the note cost reserved for it.
 */
function fillSections(
  tokens: readonly Token[],
  sections: readonly Section[],
  room: number,
  noteCost: number,
): Map<number, Decision> {
  const decisions = new Map<number, Decision>();
  const next = sections.map(() => 0);
  const stopped = sections.map(() => false);
  let remaining = room;
  let progress = true;
  while (progress) {
    progress = false;
    sections.forEach((section, s) => {
      if (stopped[s] || next[s] >= section.blocks.length) {
        return;
      }
      const index = section.blocks[next[s]];
      const cost = tokenCost(tokens, index, remaining);
      if (cost <= remaining) {
        decisions.set(index, 'keep');
        remaining -= cost;
      } else {
        const note = typedNote(tokens[index]);
        const substitute =
          note === undefined ? Infinity : noteTokens(note, remaining);
        if (!(substitute <= remaining)) {
          stopped[s] = true;
          return;
        }
        decisions.set(index, 'note');
        remaining -= substitute;
      }
      next[s]++;
      progress = true;
      if (next[s] === section.blocks.length) {
        remaining += noteCost;
      }
    });
  }
  return decisions;
}

/** A note's cost including the blank lines around it. */
function noteTokens(note: string, limit: number): number {
  return lineTokens(note, limit) + 2;
}

/** Appends raws and notes; a note always stands in its own paragraph. */
class OutlineWriter {
  private text: string;
  private readonly start: number;
  /** A note was written last; the next write opens a new paragraph first. */
  private afterNote = false;

  constructor(bom: string) {
    this.text = bom;
    this.start = bom.length;
  }

  raw(raw: string): void {
    if (this.afterNote) {
      this.text += '\n\n';
      this.afterNote = false;
    }
    this.text += raw;
  }

  note(note: string): void {
    if (this.afterNote) {
      this.text += '\n\n';
    } else if (this.text.length > this.start) {
      if (!this.text.endsWith('\n')) {
        this.text += '\n\n';
      } else if (!this.text.endsWith('\n\n')) {
        this.text += '\n';
      }
    }
    this.text += note;
    this.afterNote = true;
  }

  toString(): string {
    return this.text;
  }
}

function render(
  input: string,
  bom: string,
  tokens: readonly Token[],
  decisions: ReadonlyMap<number, Decision>,
  bodyLines: number,
): ReduceResult {
  const out = new OutlineWriter(bom);
  let keptLines = 0;
  let omittedBlocks = 0;
  /** Omitted tokens not yet written as a note: blocks plus the blank tokens between them. */
  let run: number[] = [];
  /** Start of document counts as emitted, so leading blank lines are kept. */
  let previousEmitted = true;

  const flushRun = (): void => {
    const blocks = run.filter((i) => tokens[i].type !== 'space');
    if (blocks.length > 0) {
      const last = run.lastIndexOf(blocks[blocks.length - 1]);
      const omitted = run
        .slice(0, last + 1)
        .map((i) => tokens[i].raw)
        .join('');
      const typed = blocks.length === 1 ? typedNote(tokens[blocks[0]]) : undefined;
      out.note(typed ?? `(${lineCount(omitted)} lines omitted)`);
      omittedBlocks += blocks.length;
    }
    run = [];
  };

  tokens.forEach((token, i) => {
    let emit: boolean;
    if (token.type === 'heading') {
      emit = true;
    } else if (token.type === 'space') {
      emit = previousEmitted;
    } else {
      emit = decisions.get(i) === 'keep';
      if (emit) {
        keptLines += lineCount(token.raw);
      }
    }
    if (emit) {
      flushRun();
      out.raw(token.raw);
    } else {
      run.push(i);
    }
    previousEmitted = emit;
  });
  flushRun();

  if (omittedBlocks === 0) {
    return unchanged(input, 'every section fits the budget');
  }
  const headings = tokens.filter((token) => token.type === 'heading').length;
  if (keptLines + headings === 0) {
    return unchanged(input, 'budget too small for any line');
  }
  return {
    text: out.toString(),
    reducer: 'markdown-outline',
    notes: [
      `kept ${keptLines} of ${bodyLines} section lines`,
      `omitted ${omittedBlocks} block(s)`,
    ],
  };
}

/** The headings alone exceed the budget: keep every one, then a single note. */
function headingsOnly(
  input: string,
  bom: string,
  tokens: readonly Token[],
  sections: readonly Section[],
  bodyLines: number,
): ReduceResult {
  const headings = sections.flatMap((section) =>
    section.heading === undefined ? [] : [tokens[section.heading].raw],
  );
  if (headings.length === 0) {
    return unchanged(input, 'budget too small for any line');
  }
  const text = headings
    .map((raw) => (raw.endsWith('\n') ? raw : `${raw}\n`))
    .join('');
  return {
    text: `${bom}${text}\n(section text omitted, ${bodyLines} lines)`,
    reducer: 'markdown-outline',
    notes: ['headings alone exceed the token budget; kept every heading'],
  };
}
