/**
 * In-house HTML main-content extractor (TASK_2026_559, User Decisions 7 and
 * 12: no DOM, readability or conversion dependency; plain-text output).
 *
 * `html-tree.ts` scans the input into a small element tree and marks what
 * the browser does not show (script, head, template, svg, hidden elements,
 * inline styles resolving to hidden, comments) and page boilerplate (`nav`,
 * `aside`, `form`, and `header`/`footer` outside `main`/`article`).
 *
 * The main content is, in order: every top-level `main` / `[role=main]`, else
 * every top-level `article` — each group only if it holds at least
 * {@link MIN_CANDIDATE_SHARE} of the page's non-link text — else the block
 * reached by descending from `body` while one child holds at least
 * {@link DENSE_CHILD_SHARE} of the body's non-link text. When boilerplate
 * removal alone would keep less than MIN_CANDIDATE_SHARE of the visible text
 * (an unclosed `<nav>` swallowing the page), the whole visible body is kept
 * instead.
 *
 * The output is PLAIN TEXT (User Decision 12), never Markdown, so nothing is
 * escaped: character references are decoded to the characters they stand
 * for, and every other char is the page's own. Layout:
 * - blocks (paragraphs, headings, block quotes, `pre`, lists, tables) are
 *   separated by one blank line; a heading is its own block, with no prefix;
 * - inline whitespace collapses to one space, except in code (`code`, `kbd`,
 *   `samp`), whose raw text is kept exactly and joined to its neighbours;
 * - a `pre` block keeps its text verbatim (only the newline the HTML parser
 *   drops after `<pre>` is gone, and line endings are LF);
 * - list items are lines starting with `- ` or `N. `; a nested item's lines
 *   are indented by two spaces;
 * - a link is `text (url)`, or just `text` when the url equals the text or is
 *   an in-page, script, data or oversized target;
 * - an image with a non-empty alt is `[image: alt]`;
 * - a table is one line per row, cells joined by ` | `, after any caption and
 *   any content the browser moves out of the table.
 *
 * Its safety contract is about what it must not do:
 * - it never throws: malformed HTML is scanned with the browser tokenizer's
 *   rules, and any unexpected failure returns the input unchanged
 *   (`html-unchanged`) with the reason;
 * - it never makes hidden text visible: where the tree cannot be trusted to
 *   match the browser's (see `html-tree.ts`), the input is returned
 *   unchanged instead;
 * - it never invents text: apart from the layout above (line breaks, list
 *   markers, the ` | ` cell separator, ` (url)` and `[image: …]`), every char
 *   is visible text, a link target or an image alt from the input;
 * - it never returns empty text for non-empty input: no elements, no visible
 *   text, nesting deeper than 512 elements, input over
 *   {@link MAX_HTML_CHARS}, or output no shorter than the input → unchanged.
 * Content hidden only by a stylesheet class, or by visual tricks (opacity,
 * clipping, off-screen positioning), cannot be seen without a browser and is
 * kept, as in any extractor that does not run one.
 *
 * Cost: the scanner only moves forward, the tree is walked a constant number
 * of times, and nested lists and tables are laid out only down to
 * {@link MAX_RENDER_NESTING} levels — below that their content is rendered
 * as plain blocks — so each char is re-processed a bounded number of times
 * and the work is linear.
 */
import type { OutputReducer, ReduceResult } from '../reducer.types';
import {
  decodeEntities,
  HtmlRefusal,
  isTagSpace,
  parseHtml,
  type ElementNode,
  type HtmlNode,
} from './html-tree';

/** Larger inputs are left to the pipeline's cut (the pipeline caps reducer input at 2 MiB). */
const MAX_HTML_CHARS = 2 * 1024 * 1024;
/** A `main`/`article` group, or the boilerplate-free body, must keep at least this share of the text. */
const MIN_CANDIDATE_SHARE = 0.2;
/** Density descent enters a child only while it holds at least this share of the body's text. */
const DENSE_CHILD_SHARE = 0.8;
/** Longer link targets (data URIs, tracking blobs) are dropped; the link text stays. */
const MAX_HREF_CHARS = 2048;
/** Lists and tables nested deeper than this are rendered as plain blocks (no markers, indent or cells). */
const MAX_RENDER_NESTING = 8;

/** Rendered as their own block (a blank line before and after). */
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div',
  'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav',
  'ol', 'p', 'pre', 'section', 'summary', 'ul', 'table', 'body', 'html',
  'li', 'dd', 'dt', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'caption',
  'center', 'legend', 'option',
]);
/** Inline elements whose raw text is kept exactly (no whitespace collapsing). */
const RAW_INLINE = new Set(['code', 'kbd', 'samp']);
/** Roots whose own tag carries no layout; they are rendered by their children. */
const NEUTRAL_ROOTS = new Set(['#root', 'html', 'body']);
const UNSAFE_HREF_SCHEME = /^(?:javascript|vbscript|data):/i;
/** Indent of a list item's continuation lines, and of every line of a nested list. */
const ITEM_INDENT = '  ';

/** Which subtrees a rendering skips: removed content always, boilerplate in `content` mode. */
type RenderMode = 'content' | 'visible';

export const reduceHtml: OutputReducer = (input) => {
  if (input.length > MAX_HTML_CHARS) {
    return unchanged(input, 'input larger than 2 MiB; not extracted');
  }
  try {
    return extract(input);
  } catch (error) {
    if (error instanceof HtmlRefusal) {
      return unchanged(input, error.reason);
    }
    // The contract is "never throws": anything unforeseen (a stack overflow
    // on a shape the depth guard missed) keeps the input for the cut + spool.
    const name = error instanceof Error ? error.name : typeof error;
    return unchanged(input, `html extractor failed: ${name}`);
  }
};

function unchanged(input: string, note: string): ReduceResult {
  return { text: input, reducer: 'html-unchanged', notes: [note] };
}

function extract(input: string): ReduceResult {
  const tree = parseHtml(input);
  if (tree.elementCount === 0) {
    return unchanged(input, 'no HTML elements found');
  }
  const body = tree.body ?? tree.root;
  measure(body, false);
  let { roots, mode, label } = chooseContent(body, tree.candidates);
  let text = render(roots, mode);
  if (text.trim() === '' && mode === 'content') {
    // Every visible word sat in boilerplate (a links-only page): keep it.
    ({ roots, mode, label } = wholePage(body));
    text = render(roots, mode);
  }
  if (text.trim() === '') {
    return unchanged(input, 'no visible text extracted');
  }
  if (text.length >= input.length) {
    return unchanged(input, 'extraction did not shrink the input');
  }
  const notes = [`main content: ${label}`];
  if (tree.hiddenCount > 0) {
    notes.push(`skipped ${tree.hiddenCount} hidden element(s)`);
  }
  if (mode === 'content' && tree.boilerplateCount > 0) {
    notes.push(`removed ${tree.boilerplateCount} boilerplate element(s)`);
  }
  return { text, reducer: 'html-extract', notes };
}

// ---------------------------------------------------------------------------
// Measure and choose
// ---------------------------------------------------------------------------

function countVisibleChars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (!isTagSpace(text.charCodeAt(i))) {
      count++;
    }
  }
  return count;
}

/** Fills `visibleChars` / `contentChars` bottom-up; link text counts for neither. */
function measure(node: ElementNode, inLink: boolean): void {
  const link = inLink || node.name === 'a';
  let visible = 0;
  let content = 0;
  for (const child of node.children) {
    if (child.kind === 'text') {
      const chars = link ? 0 : countVisibleChars(child.text);
      visible += chars;
      content += chars;
    } else if (!child.removed) {
      measure(child, link);
      visible += child.visibleChars;
      content += child.boilerplate ? 0 : child.contentChars;
    }
  }
  node.visibleChars = visible;
  node.contentChars = content;
}

interface Choice {
  readonly roots: readonly ElementNode[];
  readonly mode: RenderMode;
  readonly label: string;
}

function wholePage(body: ElementNode): Choice {
  return { roots: [body], mode: 'visible', label: 'whole visible page' };
}

function chooseContent(body: ElementNode, candidates: readonly ElementNode[]): Choice {
  if (body.contentChars < MIN_CANDIDATE_SHARE * body.visibleChars) {
    return wholePage(body); // boilerplate removal would drop most of the page
  }
  const inBody = candidates.filter((c) => isWithin(c, body));
  const groups: Array<[ElementNode[], string]> = [
    [outermost(inBody.filter((c) => c.name === 'main' || c.attributes.get('role') === 'main')), 'main'],
    [outermost(inBody.filter((c) => c.name === 'article')), 'article'],
  ];
  for (const [group, name] of groups) {
    const share = group.reduce((sum, c) => sum + c.contentChars, 0);
    if (group.length > 0 && share > 0 && share >= MIN_CANDIDATE_SHARE * body.contentChars) {
      const label = group.length === 1 ? `<${name}>` : `${group.length} <${name}> elements`;
      return { roots: group, mode: 'content', label };
    }
  }
  let node = body;
  for (;;) {
    let best: ElementNode | undefined;
    for (const child of node.children) {
      if (
        child.kind === 'element' &&
        !child.removed &&
        !child.boilerplate &&
        child.contentChars > (best?.contentChars ?? 0)
      ) {
        best = child;
      }
    }
    if (best === undefined || best.contentChars < DENSE_CHILD_SHARE * body.contentChars) {
      break;
    }
    node = best;
  }
  const label = node === body ? 'document body' : `densest block <${node.name}>`;
  return { roots: [node], mode: 'content', label };
}

function isWithin(node: ElementNode, ancestor: ElementNode): boolean {
  for (let at: ElementNode | undefined = node; at !== undefined; at = at.parent) {
    if (at === ancestor) {
      return true;
    }
  }
  return false;
}

/** The elements of `nodes` that have no ancestor in `nodes`. */
function outermost(nodes: readonly ElementNode[]): ElementNode[] {
  const set = new Set(nodes);
  return nodes.filter((node) => {
    for (let at = node.parent; at !== undefined; at = at.parent) {
      if (set.has(at)) {
        return false;
      }
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Plain-text rendering
// ---------------------------------------------------------------------------

/** A run of inline text; `raw` runs (code) keep their whitespace exactly. */
interface Segment {
  readonly text: string;
  readonly raw: boolean;
}

/** An output line; `verbatim` lines (from `pre`) are never indented or re-flowed. */
interface Line {
  readonly text: string;
  readonly verbatim: boolean;
}

/** A block of lines; blocks are separated by one blank line. */
type Block = readonly Line[];

/**
 * A chosen root keeps its own layout (a heading stays its own block, a table
 * keeps its rows); only the document wrappers are rendered by their children.
 */
function render(roots: readonly ElementNode[], mode: RenderMode): string {
  const renderer = new TextRenderer(mode, 0);
  for (const root of roots) {
    if (NEUTRAL_ROOTS.has(root.name)) {
      renderer.renderChildren(root);
    } else {
      renderer.renderNode(root);
    }
    renderer.flush();
  }
  return joinBlocks(renderer.finishBlocks());
}

function joinBlocks(blocks: readonly Block[]): string {
  return blocks.map((block) => block.map((line) => line.text).join('\n')).join('\n\n');
}

/**
 * One output line from its inline segments: whitespace in each stretch of
 * ordinary text collapses to one space (across element boundaries too), raw
 * code text is kept exactly, and ordinary whitespace at the line's two ends
 * is trimmed.
 */
function lineText(segments: readonly Segment[]): string {
  const parts: Segment[] = [];
  let pending = '';
  for (const segment of segments) {
    if (segment.raw) {
      if (pending !== '') {
        parts.push({ text: pending.replace(/\s+/g, ' '), raw: false });
        pending = '';
      }
      parts.push(segment);
    } else {
      pending += segment.text;
    }
  }
  if (pending !== '') {
    parts.push({ text: pending.replace(/\s+/g, ' '), raw: false });
  }
  const first = parts[0];
  if (first !== undefined && !first.raw) {
    parts[0] = { text: first.text.trimStart(), raw: false };
  }
  const last = parts[parts.length - 1];
  if (last !== undefined && !last.raw) {
    parts[parts.length - 1] = { text: last.text.trimEnd(), raw: false };
  }
  return parts.map((part) => part.text).join('');
}

/**
 * `marker` before the first line of an item's first block, two spaces before
 * every later non-empty line; verbatim (`pre`) lines are never indented, and
 * a verbatim first line gets the marker on a line of its own.
 */
function listItem(marker: string, blocks: readonly Block[]): Line[] {
  const lines: Line[] = [];
  blocks.forEach((block, b) => {
    if (b > 0) {
      lines.push({ text: '', verbatim: false });
    }
    for (const line of block) {
      if (lines.length === 0) {
        if (line.verbatim) {
          lines.push({ text: marker.trimEnd(), verbatim: false }, line);
        } else {
          lines.push({ text: marker + line.text, verbatim: false });
        }
      } else if (line.verbatim || line.text === '') {
        lines.push(line);
      } else {
        lines.push({ text: ITEM_INDENT + line.text, verbatim: false });
      }
    }
  });
  return lines;
}

/** A usable link target, or undefined for none, in-page, script, data or oversized targets. */
function linkTarget(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const href = decodeEntities(raw).trim();
  if (href === '' || href.startsWith('#') || href.length > MAX_HREF_CHARS || UNSAFE_HREF_SCHEME.test(href)) {
    return undefined;
  }
  return href;
}

/**
 * Renders a tree to plain-text blocks. Inline content accumulates in the
 * current paragraph (a `br` starts a new line in it); a block element
 * flushes the paragraph before and after itself. `level` counts the nested
 * list/table renderings above this one.
 */
class TextRenderer {
  private readonly blocks: Block[] = [];
  private lines: Segment[][] = [[]];

  constructor(
    private readonly mode: RenderMode,
    private readonly level: number,
  ) {}

  finishBlocks(): Block[] {
    this.flush();
    return this.blocks;
  }

  flush(): void {
    const lines = this.lines
      .map(lineText)
      .filter((text) => text.trim() !== '')
      .map((text): Line => ({ text, verbatim: false }));
    this.lines = [[]];
    if (lines.length > 0) {
      this.blocks.push(lines);
    }
  }

  renderChildren(element: ElementNode): void {
    for (const child of element.children) {
      this.renderNode(child);
    }
  }

  renderNode(node: HtmlNode): void {
    if (node.kind === 'text') {
      this.inline(decodeEntities(node.text), false);
    } else if (!this.skips(node)) {
      this.renderElement(node);
    }
  }

  private skips(element: ElementNode): boolean {
    return element.removed || (this.mode === 'content' && element.boilerplate);
  }

  private inline(text: string, raw: boolean): void {
    this.lines[this.lines.length - 1].push({ text, raw });
  }

  private block(lines: Block): void {
    this.flush();
    if (lines.some((line) => line.text.trim() !== '')) {
      this.blocks.push(lines);
    }
  }

  private renderElement(element: ElementNode): void {
    const name = element.name;
    if (name === 'br') {
      this.lines.push([]);
      return;
    }
    if (name === 'pre') {
      this.block(this.preBlock(element));
      return;
    }
    if (name === 'img') {
      this.image(element);
      return;
    }
    if (RAW_INLINE.has(name)) {
      const parts: string[] = [];
      this.rawText(element, parts);
      this.inline(parts.join(''), true);
      return;
    }
    if (name === 'a') {
      this.link(element);
      return;
    }
    if (this.level < MAX_RENDER_NESTING && this.renderLaidOut(element)) {
      return;
    }
    if (BLOCK.has(name)) {
      this.flush();
      this.renderChildren(element);
      this.flush();
    } else {
      this.renderChildren(element);
    }
  }

  /** Renders lists, list items and tables with their layout; false for the rest. */
  private renderLaidOut(element: ElementNode): boolean {
    switch (element.name) {
      case 'ul':
      case 'ol':
      case 'menu':
        this.block(this.list(element));
        return true;
      case 'li':
        this.block(listItem('- ', this.childBlocks(element))); // an item outside a list
        return true;
      case 'table':
        for (const block of this.table(element)) {
          this.block(block);
        }
        return true;
      default:
        return false;
    }
  }

  private child(): TextRenderer {
    return new TextRenderer(this.mode, this.level + 1);
  }

  /** The element's children rendered as blocks by a nested renderer. */
  private childBlocks(element: ElementNode): Block[] {
    const sub = this.child();
    sub.renderChildren(element);
    return sub.finishBlocks();
  }

  /** Text of the subtree as the browser lays it out in `pre`: whitespace kept, `br` as a newline. */
  private rawText(element: ElementNode, parts: string[]): void {
    for (const child of element.children) {
      if (child.kind === 'text') {
        parts.push(decodeEntities(child.text));
      } else if (!this.skips(child)) {
        if (child.name === 'br') {
          parts.push('\n');
        } else {
          this.rawText(child, parts);
        }
      }
    }
  }

  /**
   * A `pre` block: its text verbatim, one line per source line. The newline
   * right after `<pre>` is already dropped by the tree builder; line endings
   * become LF. Nothing is trimmed.
   */
  private preBlock(pre: ElementNode): Block {
    const parts: string[] = [];
    this.rawText(pre, parts);
    const text = parts.join('').replace(/\r\n?/g, '\n');
    if (text.trim() === '') {
      return [];
    }
    return text.split('\n').map((line): Line => ({ text: line, verbatim: true }));
  }

  private list(list: ElementNode): Block {
    const ordered = list.name === 'ol';
    const start = Number.parseInt(list.attributes.get('start') ?? '1', 10);
    let number = Number.isSafeInteger(start) && start >= 0 && start < 1e9 ? start : 1;
    const lines: Line[] = [];
    for (const child of list.children) {
      if (child.kind === 'text') {
        const text = decodeEntities(child.text).replace(/\s+/g, ' ').trim();
        if (text !== '') {
          lines.push({ text, verbatim: false });
        }
      } else if (child.name === 'li' && !this.skips(child)) {
        const blocks = this.childBlocks(child);
        if (blocks.length > 0) {
          lines.push(...listItem(ordered ? `${number++}. ` : '- ', blocks));
        }
      } else if (!this.skips(child)) {
        // A nested list or other element placed directly in the list.
        const sub = this.child();
        sub.renderNode(child);
        for (const block of sub.finishBlocks()) {
          for (const line of block) {
            lines.push(line.verbatim || line.text === '' ? line : { text: ITEM_INDENT + line.text, verbatim: false });
          }
        }
      }
    }
    return lines;
  }

  /**
   * Blocks for a table: content the browser moves out of it (text or
   * elements outside a cell: foster parenting) first, in document order;
   * then the caption; then one line per row, cells joined by ` | `, each
   * cell's content on one line.
   */
  private table(table: ElementNode): Block[] {
    const rows: string[] = [];
    const outside = this.child();
    const caption = this.child();
    const collect = (section: ElementNode): void => {
      for (const child of section.children) {
        if (child.kind === 'text') {
          outside.renderNode(child);
        } else if (this.skips(child)) {
          continue;
        } else if (child.name === 'tr') {
          const cells: string[] = [];
          for (const cell of child.children) {
            if (cell.kind === 'element' && (cell.name === 'td' || cell.name === 'th')) {
              if (!this.skips(cell)) {
                cells.push(this.cellText(cell));
              }
            } else {
              outside.renderNode(cell);
            }
          }
          if (cells.length > 0) {
            rows.push(cells.join(' | '));
          }
        } else if (child.name === 'thead' || child.name === 'tbody' || child.name === 'tfoot') {
          collect(child);
        } else if (child.name === 'caption') {
          caption.renderChildren(child);
          caption.flush();
        } else if (child.name !== 'colgroup' && child.name !== 'col') {
          outside.renderNode(child);
        }
      }
    };
    collect(table);
    const blocks = [...outside.finishBlocks(), ...caption.finishBlocks()];
    if (rows.length > 0) {
      blocks.push(rows.map((text): Line => ({ text, verbatim: false })));
    }
    return blocks;
  }

  /** A cell's content on one line. */
  private cellText(cell: ElementNode): string {
    return this.childBlocks(cell)
      .map((block) => block.map((line) => line.text).join(' '))
      .join(' ')
      .trim();
  }

  /**
   * The link text inline, then ` (url)` unless the url equals the text (or
   * the link has no text, or no usable target).
   */
  private link(anchor: ElementNode): void {
    this.renderChildren(anchor);
    const href = linkTarget(anchor.attributes.get('href'));
    if (href === undefined) {
      return;
    }
    const text = this.anchorText(anchor, href.length + 1);
    if (text !== '' && text !== href) {
      this.inline(` (${href})`, false);
    }
  }

  /**
   * The anchor's visible text, whitespace-collapsed, for comparing with its
   * url. Stops once more than `limit` chars or `limit` nodes were visited
   * (the text then cannot equal a url shorter than `limit`), so the work per
   * link is bounded by its url's length.
   */
  private anchorText(anchor: ElementNode, limit: number): string | undefined {
    const parts: string[] = [];
    let chars = 0;
    let steps = 0;
    // Depth-first with one (element, next child index) frame per level, so
    // each step visits one node and no child list is ever copied.
    const frames: Array<{ element: ElementNode; next: number }> = [{ element: anchor, next: 0 }];
    while (frames.length > 0) {
      if (chars > limit || ++steps > limit + 16) {
        return undefined;
      }
      const frame = frames[frames.length - 1];
      if (frame.next >= frame.element.children.length) {
        frames.pop();
        continue;
      }
      const node = frame.element.children[frame.next++];
      if (node.kind === 'text') {
        const text = decodeEntities(node.text);
        parts.push(text);
        chars += text.length;
      } else if (!this.skips(node)) {
        frames.push({ element: node, next: 0 });
      }
    }
    return parts.join('').replace(/\s+/g, ' ').trim();
  }

  private image(image: ElementNode): void {
    const alt = decodeEntities(image.attributes.get('alt') ?? '').replace(/\s+/g, ' ').trim();
    if (alt !== '') {
      this.inline(`[image: ${alt}]`, false);
    }
  }
}
