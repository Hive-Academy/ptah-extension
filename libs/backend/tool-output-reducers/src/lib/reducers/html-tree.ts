/**
 * HTML scanner and element-tree builder for the in-house extractor
 * (`html.reducer.ts`; TASK_2026_559, User Decision 7: no DOM dependency).
 *
 * One forward pass tokenises the input with the browser tokenizer's rules for
 * tags (attributes in start and end tags are quote-aware), comments, raw text
 * and RCDATA, and builds a small tree with the implicit-close rules that
 * decide where text lands. Each element records whether the browser would
 * render it: removed elements (`script`, `head`, `template`, `svg`, …, and
 * any element hidden by `hidden`, a closed `dialog`, or an inline style that
 * resolves to `display:none`, `visibility:hidden|collapse` or
 * `content-visibility:hidden`) and boilerplate (`nav`, `aside`, `form`, page
 * `header`/`footer`).
 *
 * Wherever this simplified model could place text outside a hidden element
 * that the browser puts inside it, or cannot resolve whether an element is
 * hidden, parsing stops with an {@link HtmlRefusal}; the reducer then returns
 * its input unchanged. See {@link TreeBuilder} for the invariant.
 */

/** Deeper element nesting is refused: it bounds recursion and marks input this scanner cannot model. */
export const MAX_DEPTH = 512;

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr', 'basefont', 'bgsound', 'frame', 'keygen',
]);
/** Content is raw text up to the matching end tag; none of it is ever shown. */
const RAW_TEXT = new Set([
  'script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript',
]);
/** Content is text (entities decoded) up to the matching end tag. */
const RCDATA = new Set(['textarea', 'title']);
/** Never rendered: `display: none` in the HTML UA stylesheet, or not text. */
const REMOVED = new Set([
  ...RAW_TEXT, 'template', 'head', 'title', 'datalist', 'rp', 'svg', 'math',
  'canvas', 'object', 'audio', 'video',
]);
/** Elements allowed in `head`; any other start tag closes an open `head`. */
const HEAD_CONTENT = new Set([
  'base', 'link', 'meta', 'noscript', 'script', 'style', 'template', 'title',
]);
/** Hidden by `display: none` in the HTML UA stylesheet, which an inline `display` overrides. */
const UA_DISPLAY_NONE = new Set([
  'head', 'title', 'script', 'style', 'datalist', 'rp', 'noembed', 'noframes', 'noscript',
]);
const BOILERPLATE = new Set(['nav', 'aside', 'form']);
const PAGE_CHROME = new Set(['header', 'footer']);
/**
 * A start tag of one of these closes an open `p` in every document mode.
 * `table` is left out: it closes `p` only in no-quirks mode, and keeping the
 * table inside the paragraph can only hide more text, never less.
 */
const CLOSES_PARAGRAPH = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div',
  'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav',
  'ol', 'p', 'pre', 'section', 'summary', 'ul',
]);
/** A start tag of one of these closes an open element of the same name directly above. */
const CLOSES_SAME = new Set(['p', 'li', 'dt', 'dd', 'tr', 'option']);
/** Shared by every tag without a read attribute (most tags), so none allocates a map. */
const NO_ATTRIBUTES: ReadonlyMap<string, string> = new Map();
/** Attributes the extractor reads; every other attribute is skipped without storing it. */
const READ_ATTRIBUTES = new Set(['href', 'role', 'hidden', 'style', 'open', 'class', 'alt', 'start']);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ',
  emsp: ' ', thinsp: ' ', shy: '', zwj: '', zwnj: '', copy: '©',
  reg: '®', trade: '™', hellip: '…', mdash: '—',
  ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“',
  rdquo: '”', laquo: '«', raquo: '»', bull: '•',
  middot: '·', times: '×', divide: '÷', deg: '°',
  euro: '€', pound: '£', yen: '¥', cent: '¢',
  sect: '§', para: '¶', rarr: '→', larr: '←',
  uarr: '↑', darr: '↓', harr: '↔', minus: '−',
};
/**
 * A character reference. Numeric ones take every digit and an optional `;`,
 * as the browser does; named ones need the `;`. Each alternative is a single
 * run of one class after a fixed prefix, so a scan is linear.
 */
const ENTITY = /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([A-Za-z][A-Za-z0-9]{1,31});)/g;
/**
 * A newline as the first character token: `\n`, `\r\n` or a lone `\r` (the
 * input stream normalises both to LF), or a decimal/hex reference to U+000A
 * with any leading zeros and an optional `;` — but not a longer number.
 */
const INITIAL_NEWLINE = /^(?:\r\n?|\n|&#(?:0*10(?![0-9])|[xX]0*[aA](?![0-9a-fA-F]));?)/;
const ASCII_UPPER = /[A-Z]/;
const ASCII_UPPER_ALL = /[A-Z]/g;

/**
 * Inline-style declarations that hide an element, with the single-keyword
 * values the extractor models for them (multi-keyword `display` forms are
 * checked by {@link isMultiKeywordDisplay}). When a value outside this
 * grammar would win — valid but unlisted, a custom property, or invalid
 * (the browser would ignore it) — whether the element shows cannot be told
 * here, so the extraction is refused rather than guessing either way.
 */
const GLOBAL_VALUES = ['inherit', 'initial', 'unset', 'revert', 'revert-layer'];
const STYLE_VALUES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    'display',
    new Set([
      ...GLOBAL_VALUES, 'none', 'contents', 'block', 'inline', 'inline-block',
      'flow-root', 'list-item', 'flex', 'inline-flex', 'grid', 'inline-grid',
      'table', 'inline-table', 'table-row-group', 'table-header-group',
      'table-footer-group', 'table-row', 'table-cell', 'table-column-group',
      'table-column', 'table-caption', 'ruby', 'ruby-base', 'ruby-text',
      'ruby-base-container', 'ruby-text-container', 'run-in', 'math',
      '-webkit-box', '-webkit-inline-box',
    ]),
  ],
  ['visibility', new Set([...GLOBAL_VALUES, 'visible', 'hidden', 'collapse'])],
  ['content-visibility', new Set([...GLOBAL_VALUES, 'visible', 'auto', 'hidden'])],
]);
const DISPLAY_OUTSIDE = new Set(['block', 'inline', 'run-in']);
const DISPLAY_INSIDE = new Set(['flow', 'flow-root', 'table', 'flex', 'grid', 'ruby']);
/** Marks a winning declaration whose value is outside the modelled grammar. */
const UNMODELLED_VALUE = '\u0000unmodelled';
const IMPORTANT = /!\s*important\s*$/i;

/**
 * The CSS Display 3 multi-keyword forms: `<outside> || <inside>` in either
 * order, or `list-item` with at most one outside keyword and an inside
 * keyword of `flow`/`flow-root`. Single keywords are in {@link STYLE_VALUES}.
 */
function isMultiKeywordDisplay(value: string): boolean {
  const tokens = value.split(' ');
  if (tokens.length < 2 || tokens.length > 3) {
    return false;
  }
  let outside = 0;
  let inside: string | undefined;
  let listItem = 0;
  for (const token of tokens) {
    if (DISPLAY_OUTSIDE.has(token)) {
      outside++;
    } else if (DISPLAY_INSIDE.has(token) && inside === undefined) {
      inside = token;
    } else if (token === 'list-item') {
      listItem++;
    } else {
      return false;
    }
  }
  if (outside > 1 || listItem > 1) {
    return false;
  }
  if (listItem === 1) {
    return inside === undefined || inside === 'flow' || inside === 'flow-root';
  }
  return tokens.length === 2 && outside === 1 && inside !== undefined;
}
/** CSS the declaration splitter does not model: escapes and blocks. */
const UNMODELLED_CSS = /[\\{}]/;

export interface TextNode {
  readonly kind: 'text';
  readonly text: string;
}

export interface ElementNode {
  readonly kind: 'element';
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly parent: ElementNode | undefined;
  readonly children: Array<ElementNode | TextNode>;
  /** Hidden by its own attributes (`hidden`, closed `dialog`, inline style). */
  readonly hiddenByAttributes: boolean;
  /** Not rendered by the browser, together with its subtree. */
  readonly removed: boolean;
  /** Page chrome (nav, aside, …), together with its subtree. */
  readonly boilerplate: boolean;
  /** Inside (or is) removed content. */
  readonly underRemoved: boolean;
  /** Inside (or is) an element whose own `visibility` is `hidden`/`collapse`. */
  readonly underVisibilityHidden: boolean;
  /** Inside (or is) boilerplate. */
  readonly underBoilerplate: boolean;
  /** Inside (or is) `main`, `[role=main]` or `article`. */
  readonly inContent: boolean;
  /** Inside (or is) `svg`/`math`, where `/>` closes an element. */
  readonly foreign: boolean;
  /** Non-whitespace chars outside links that the browser shows in this subtree (set by the reducer). */
  visibleChars: number;
  /** The same, without boilerplate (set by the reducer). */
  contentChars: number;
}

export type HtmlNode = ElementNode | TextNode;

export interface HtmlTree {
  readonly root: ElementNode;
  readonly body: ElementNode | undefined;
  /** `main`, `[role=main]` and `article` elements outside removed content and boilerplate, in document order. */
  readonly candidates: readonly ElementNode[];
  readonly elementCount: number;
  readonly hiddenCount: number;
  readonly boilerplateCount: number;
}

/** A deliberate decline: the reducer returns its input unchanged with this reason. */
export class HtmlRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'HtmlRefusal';
  }
}

/** Builds the element tree of `html`; throws {@link HtmlRefusal} where the model cannot be trusted. */
export function parseHtml(html: string): HtmlTree {
  const tree = new TreeBuilder();
  scan(html, tree);
  return tree;
}

export function isTagSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

/** Decodes character references; unknown named references stay as written. */
export function decodeEntities(text: string): string {
  return decodeReferences(text).text;
}

function decodeReferences(text: string): { text: string; unknown: boolean } {
  if (!text.includes('&')) {
    return { text, unknown: false };
  }
  let unknown = false;
  const decoded = text.replace(ENTITY, (match, decimal?: string, hex?: string, name?: string) => {
    if (name !== undefined) {
      if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)) {
        return NAMED_ENTITIES[name];
      }
      unknown = true;
      return match;
    }
    const digits = (decimal ?? (hex as string)).replace(/^0+/, '');
    const code = digits.length > 8 ? Infinity : digits === '' ? 0 : parseInt(digits, decimal !== undefined ? 10 : 16);
    const control = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    const invalid = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff);
    return control || invalid ? '�' : String.fromCodePoint(code);
  });
  return { text: decoded, unknown };
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function isAsciiAlpha(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** ASCII lower case; unlike `toLowerCase` it never changes a string's length. */
function asciiLower(text: string): string {
  return ASCII_UPPER.test(text)
    ? text.replace(ASCII_UPPER_ALL, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
    : text;
}

/**
 * One forward pass over the input. Tags, comments and declarations follow
 * the HTML tokenizer: `<` not followed by a letter, `/` or `!`/`?` is text;
 * an unterminated tag or comment runs to the end of the input and is dropped.
 */
function scan(html: string, tree: TreeBuilder): void {
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      tree.text(html.slice(i));
      return;
    }
    if (lt > i) {
      tree.text(html.slice(i, lt));
    }
    const next = html.charCodeAt(lt + 1);
    if (html.startsWith('<!--', lt)) {
      tree.otherToken();
      i = commentEnd(html, lt + 4);
    } else if (tree.inForeignContent() && html.startsWith('<![CDATA[', lt)) {
      // Text inside svg/math (never shown): skipped whole, so markup-looking
      // text in it cannot close the svg early.
      tree.otherToken();
      i = afterNext(html, ']]>', lt + 9);
    } else if (next === 0x21 || next === 0x3f) {
      // `<!DOCTYPE …>`, `<![CDATA[…`, `<?…>`: a bogus comment up to `>`.
      tree.otherToken();
      i = afterNext(html, '>', lt + 2);
    } else if (next === 0x2f && isAsciiAlpha(html.charCodeAt(lt + 2))) {
      i = endTag(html, lt, tree);
    } else if (next === 0x2f) {
      // `</>` is ignored, `</ x>` is a bogus comment.
      tree.otherToken();
      i = afterNext(html, '>', lt + 2);
    } else if (isAsciiAlpha(next)) {
      i = startTag(html, lt, tree);
    } else {
      tree.text('<');
      i = lt + 1;
    }
  }
}

/** Index after `needle` searched from `from`, or the input length when it is missing. */
function afterNext(html: string, needle: string, from: number): number {
  const at = html.indexOf(needle, from);
  return at === -1 ? html.length : at + needle.length;
}

/** A comment ends at `-->` or `--!>`; `<!-->` and `<!--->` end at once. */
function commentEnd(html: string, from: number): number {
  if (html.startsWith('>', from)) {
    return from + 1;
  }
  if (html.startsWith('->', from)) {
    return from + 2;
  }
  let at = from;
  for (;;) {
    const dashes = html.indexOf('--', at);
    if (dashes === -1) {
      return html.length;
    }
    if (html.startsWith('>', dashes + 2)) {
      return dashes + 3;
    }
    if (html.startsWith('!>', dashes + 2)) {
      return dashes + 4;
    }
    at = dashes + 1;
  }
}

/** Reads a tag name from `from`; returns the lower-cased name and the index after it. */
function readTagName(html: string, from: number): [string, number] {
  let j = from;
  while (j < html.length) {
    const code = html.charCodeAt(j);
    if (isTagSpace(code) || code === 0x2f || code === 0x3e) {
      break;
    }
    j++;
  }
  return [asciiLower(html.slice(from, j)), j];
}

interface TagBody {
  /** Index after the closing `>`. */
  readonly end: number;
  readonly selfClosing: boolean;
  readonly attributes: ReadonlyMap<string, string>;
}

/**
 * The attributes and closing `>` of a tag, from just after its name. Quoted
 * values are skipped whole, so a `>` inside quotes never ends the tag, in
 * start and end tags alike. Undefined at EOF inside the tag (dropped).
 */
function readTagBody(html: string, from: number): TagBody | undefined {
  const n = html.length;
  let attributes: Map<string, string> | undefined;
  let j = from;
  let selfClosing = false;
  for (;;) {
    while (j < n && (isTagSpace(html.charCodeAt(j)) || html[j] === '/')) {
      selfClosing = html[j] === '/';
      j++;
    }
    if (j >= n) {
      return undefined;
    }
    if (html[j] === '>') {
      return { end: j + 1, selfClosing, attributes: attributes ?? NO_ATTRIBUTES };
    }
    selfClosing = false;
    const read = readAttribute(html, j);
    if (read === undefined) {
      return undefined;
    }
    const [attribute, value, after] = read;
    if (READ_ATTRIBUTES.has(attribute)) {
      attributes ??= new Map<string, string>();
      if (!attributes.has(attribute)) {
        attributes.set(attribute, value);
      }
    }
    j = after;
  }
}

function endTag(html: string, lt: number, tree: TreeBuilder): number {
  const [name, afterName] = readTagName(html, lt + 2);
  const body = readTagBody(html, afterName);
  if (body === undefined) {
    return html.length; // EOF in tag: dropped
  }
  tree.end(name);
  return body.end;
}

function startTag(html: string, lt: number, tree: TreeBuilder): number {
  const n = html.length;
  const [name, afterName] = readTagName(html, lt + 1);
  const body = readTagBody(html, afterName);
  if (body === undefined) {
    return n; // EOF in tag: dropped
  }
  const j = body.end;
  if (name === 'xmp' || name === 'plaintext') {
    // Visible raw text (no tags, no references: `xmp` up to its end tag,
    // `plaintext` to the end of the input). The tree stores decoded text
    // only, so it cannot show this faithfully; decline rather than drop or
    // re-decode it.
    throw new HtmlRefusal('xmp or plaintext raw text is not modelled');
  }
  tree.start(name, body.attributes, body.selfClosing);
  if (RAW_TEXT.has(name) || RCDATA.has(name)) {
    const close = rawTextEnd(html, j, name);
    if (name === 'script' && mayDoubleEscape(html, j, close)) {
      throw new HtmlRefusal('script body may be double-escaped');
    }
    if (RCDATA.has(name)) {
      tree.text(html.slice(j, close));
    }
    return close; // the end tag itself is scanned next, if there is one
  }
  return j;
}

/** One attribute at `from`: [lower-cased name, raw value, index after it], or undefined at EOF in a quoted value. */
function readAttribute(html: string, from: number): [string, string, number] | undefined {
  const n = html.length;
  let j = from + 1; // the first char is part of the name even when it is `=`
  while (j < n) {
    const code = html.charCodeAt(j);
    if (isTagSpace(code) || code === 0x2f || code === 0x3e || code === 0x3d) {
      break;
    }
    j++;
  }
  const name = asciiLower(html.slice(from, j));
  while (j < n && isTagSpace(html.charCodeAt(j))) {
    j++;
  }
  if (html[j] !== '=') {
    return [name, '', j];
  }
  j++;
  while (j < n && isTagSpace(html.charCodeAt(j))) {
    j++;
  }
  const quote = html[j];
  if (quote === '"' || quote === "'") {
    const close = html.indexOf(quote, j + 1);
    return close === -1 ? undefined : [name, html.slice(j + 1, close), close + 1];
  }
  const start = j;
  while (j < n && !isTagSpace(html.charCodeAt(j)) && html[j] !== '>') {
    j++;
  }
  return [name, html.slice(start, j), j];
}

/** Whether `html[at…]` is `<name` or `</name` (per `slash`) followed by a tag delimiter or the end. */
function isTagAt(html: string, at: number, name: string, slash: boolean): boolean {
  const start = at + (slash ? 2 : 1);
  const after = start + name.length;
  return (
    asciiLower(html.slice(start, after)) === name &&
    (after >= html.length || isTagSpace(html.charCodeAt(after)) || html[after] === '/' || html[after] === '>')
  );
}

/** Start of the `</name` end tag that closes raw text begun at `from`, or the input length. */
function rawTextEnd(html: string, from: number, name: string): number {
  let at = from;
  for (;;) {
    const candidate = html.indexOf('</', at);
    if (candidate === -1) {
      return html.length;
    }
    if (isTagAt(html, candidate, name, true)) {
      return candidate;
    }
    at = candidate + 2;
  }
}

/**
 * Whether a script body may be in the tokenizer's double-escaped state:
 * after `<!--`, a `<script` start makes the browser skip the next
 * `</script>`, so the end found by {@link rawTextEnd} may be wrong. This
 * scanner does not model those states; such a body is refused. A plain
 * legacy `<!-- … //-->` wrapper has no inner `<script` and passes.
 *
 * Only `<` positions inside [from, end) are visited. `end` is the start of
 * the candidate `</script` (a `<`) or the input end, so every `indexOf`
 * stops inside this script's own body and the scans of all scripts together
 * are linear in the input.
 */
function mayDoubleEscape(html: string, from: number, end: number): boolean {
  let commentSeen = false;
  let at = from;
  for (;;) {
    const lt = html.indexOf('<', at);
    if (lt === -1 || lt >= end) {
      return false;
    }
    if (html.startsWith('<!--', lt)) {
      commentSeen = true;
    } else if (commentSeen && isTagAt(html, lt, 'script', false)) {
      return true;
    }
    at = lt + 1;
  }
}

// ---------------------------------------------------------------------------
// Inline style
// ---------------------------------------------------------------------------

/**
 * Splits a decoded style attribute into declarations at `;` outside strings
 * and parentheses; comments become a space (a separator, as in CSS). One
 * forward pass. Strings that do not close on their line, and unbalanced
 * parentheses, are refused rather than guessed.
 */
function splitDeclarations(style: string): string[] {
  const declarations: string[] = [];
  let current = '';
  let depth = 0;
  let i = 0;
  while (i < style.length) {
    const char = style[i];
    if (char === '/' && style[i + 1] === '*') {
      const close = style.indexOf('*/', i + 2);
      current += ' ';
      i = close === -1 ? style.length : close + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      let close = i + 1;
      while (close < style.length && style[close] !== char && style[close] !== '\n') {
        close++;
      }
      if (style[close] !== char) {
        throw new HtmlRefusal('inline style uses CSS syntax this extractor does not model');
      }
      current += style.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';' && depth === 0) {
      declarations.push(current);
      current = '';
      i++;
      continue;
    }
    current += char;
    i++;
  }
  if (depth !== 0) {
    throw new HtmlRefusal('inline style uses CSS syntax this extractor does not model');
  }
  declarations.push(current);
  return declarations;
}

/**
 * The winning value of each modelled property in an inline style: the last
 * valid declaration wins, except that a normal declaration never overrides
 * an `!important` one. Character references are decoded first; an unknown
 * named reference, a CSS escape or a block is refused.
 */
function resolveStyle(raw: string): ReadonlyMap<string, string> {
  const { text, unknown } = decodeReferences(raw);
  if (unknown) {
    throw new HtmlRefusal('inline style has an unknown character reference');
  }
  if (UNMODELLED_CSS.test(text)) {
    throw new HtmlRefusal('inline style uses CSS syntax this extractor does not model');
  }
  const winning = new Map<string, { value: string; important: boolean }>();
  for (const declaration of splitDeclarations(text)) {
    const colon = declaration.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const property = asciiLower(declaration.slice(0, colon).trim());
    const valid = STYLE_VALUES.get(property);
    if (valid === undefined) {
      continue;
    }
    let value = declaration.slice(colon + 1);
    const important = IMPORTANT.test(value);
    value = asciiLower((important ? value.replace(IMPORTANT, '') : value).trim()).replace(/\s+/g, ' ');
    if (winning.get(property)?.important === true && !important) {
      continue; // a normal declaration never overrides an !important one
    }
    const known = valid.has(value) || (property === 'display' && isMultiKeywordDisplay(value));
    winning.set(property, { value: known ? value : UNMODELLED_VALUE, important });
  }
  if ([...winning.values()].some((entry) => entry.value === UNMODELLED_VALUE)) {
    // A value outside the modelled grammar (a custom property, a keyword this
    // list lacks, or an invalid one the browser would ignore) decides the
    // element's visibility: which way cannot be told without a browser.
    throw new HtmlRefusal('inline style value this extractor does not model');
  }
  return new Map([...winning].map(([property, entry]) => [property, entry.value]));
}

interface Visibility {
  /** Hidden by its own attributes: `hidden`, a closed `dialog`, or an inline style resolving to hidden. */
  readonly hiddenByAttributes: boolean;
  /** Under (or is) an element whose own `visibility` is `hidden`/`collapse`. */
  readonly underVisibilityHidden: boolean;
}

/**
 * How an element's own attributes hide it. Two states the tree cannot model
 * are refused (User Decision 12), because the browser shows content that
 * the tree would drop with its subtree: an inline `display` other than
 * `none` on an element the `hidden` attribute, a closed `dialog`, or the UA
 * stylesheet hides (the inline style overrides that `display: none`); and a
 * `visibility` other than `hidden`/`collapse` under an ancestor whose
 * visibility is `hidden`/`collapse` (visibility is inherited, so a child can
 * set it back to visible).
 */
function visibilityOf(
  name: string,
  attributes: ReadonlyMap<string, string>,
  underVisibilityHidden: boolean,
): Visibility {
  const style = attributes.get('style');
  const winning = style === undefined ? undefined : resolveStyle(style);
  const display = winning?.get('display');
  const visibility = winning?.get('visibility');
  const hiddenAttribute = attributes.has('hidden') || (name === 'dialog' && !attributes.has('open'));
  if ((hiddenAttribute || UA_DISPLAY_NONE.has(name)) && display !== undefined && display !== 'none') {
    throw new HtmlRefusal('conflicting visibility state not modelled');
  }
  const ownVisibilityHidden = visibility === 'hidden' || visibility === 'collapse';
  if (underVisibilityHidden && visibility !== undefined && !ownVisibilityHidden) {
    throw new HtmlRefusal('conflicting visibility state not modelled');
  }
  return {
    hiddenByAttributes:
      hiddenAttribute ||
      display === 'none' ||
      ownVisibilityHidden ||
      winning?.get('content-visibility') === 'hidden',
    underVisibilityHidden: underVisibilityHidden || ownVisibilityHidden,
  };
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

function createElement(
  name: string,
  attributes: ReadonlyMap<string, string>,
  parent: ElementNode | undefined,
): ElementNode {
  const { hiddenByAttributes, underVisibilityHidden } = visibilityOf(
    name,
    attributes,
    parent?.underVisibilityHidden ?? false,
  );
  const removed = REMOVED.has(name) || hiddenByAttributes;
  const boilerplate =
    BOILERPLATE.has(name) || (PAGE_CHROME.has(name) && !(parent?.inContent ?? false));
  return {
    kind: 'element',
    name,
    attributes,
    parent,
    children: [],
    hiddenByAttributes,
    removed,
    boilerplate,
    underRemoved: (parent?.underRemoved ?? false) || removed,
    underVisibilityHidden,
    underBoilerplate: (parent?.underBoilerplate ?? false) || boilerplate,
    inContent:
      (parent?.inContent ?? false) ||
      name === 'main' ||
      name === 'article' ||
      attributes.get('role') === 'main',
    foreign: (parent?.foreign ?? false) || name === 'svg' || name === 'math',
    visibleChars: 0,
    contentChars: 0,
  };
}

/**
 * Builds the element tree with the implicit-close rules that decide where
 * text lands. An end tag with no open element of its name is ignored;
 * otherwise it closes everything above that element. Open elements are
 * counted per name, so a stray end tag costs O(1) and every pop is paid for
 * by its push.
 *
 * The tree is simpler than the browser's, so it is kept to one invariant:
 * every removed (hidden) element the browser still has open is open here
 * too, so no text lands outside a hidden element that the browser puts
 * inside it. A removed element is therefore closed only the way the browser
 * surely closes it — by its own end tag while it is the current node (in
 * `svg`/`math`, by its own end tag), or by a start tag whose browser rule
 * closes the current node (`<p>` after `<p>`, a block after `<p>`, `<li>`
 * after `<li>`) — and any other close of one (an end tag while other
 * elements sit above it, where the browser may ignore the tag or reopen a
 * formatting element around later text) refuses the extraction. Where the
 * simplified rules differ otherwise, the browser closes elements earlier
 * than this builder, which can only hide more text, never show hidden text.
 */
class TreeBuilder implements HtmlTree {
  readonly root: ElementNode = createElement('#root', NO_ATTRIBUTES, undefined);
  body: ElementNode | undefined;
  readonly candidates: ElementNode[] = [];
  elementCount = 0;
  hiddenCount = 0;
  boilerplateCount = 0;
  private headSeen = false;
  /** The last token was a `<pre>`/`<listing>` start tag. */
  private afterPreStart = false;
  private readonly stack: ElementNode[] = [this.root];
  private readonly openCounts = new Map<string, number>();

  private get current(): ElementNode {
    return this.stack[this.stack.length - 1];
  }

  /** Whether the current node is inside `svg`/`math` (CDATA sections are text there). */
  inForeignContent(): boolean {
    return this.current.foreign;
  }

  text(text: string): void {
    if (this.afterPreStart) {
      // The HTML parser drops a newline character token that comes right
      // after a `<pre>`/`<listing>` start tag: a LF after CR normalisation
      // (`\n`, `\r\n`, lone `\r`) or a character reference to U+000A.
      this.afterPreStart = false;
      text = text.replace(INITIAL_NEWLINE, '');
      if (text === '') {
        return;
      }
    }
    // Text directly in head (not in its title/style/script) starts the body.
    if (this.current.name === 'head' && text.trim() !== '') {
      this.closeThrough('head', false);
    }
    if (!this.current.underRemoved) {
      this.current.children.push({ kind: 'text', text });
    }
  }

  /** Any token other than text or a tag (comment, doctype, CDATA): ends the newline rule after `<pre>`. */
  otherToken(): void {
    this.afterPreStart = false;
  }

  start(name: string, attributes: ReadonlyMap<string, string>, selfClosing: boolean): void {
    this.afterPreStart = false;
    // The browser applies every html/body tag's attributes to the one root
    // element, wherever the tag appears, so a hiding one hides text parsed
    // before it too; this tree cannot place that text, so it refuses.
    if ((name === 'html' || name === 'body') && visibilityOf(name, attributes, false).hiddenByAttributes) {
      throw new HtmlRefusal(`<${name}> tag hides the page`);
    }
    // A repeated html/body, or a head after the head or inside body, is ignored.
    const repeatedRoot =
      (name === 'html' && this.elementCount > 0) || (name === 'body' && this.body !== undefined);
    if (repeatedRoot || (name === 'head' && (this.headSeen || this.body !== undefined))) {
      return;
    }
    if (this.current.name === 'head' && !HEAD_CONTENT.has(name)) {
      this.closeThrough('head', false);
    }
    // Each close below applies only to the current node, where the browser's
    // own rule for this start tag closes the same element: a certain close.
    const top = this.current.name;
    if (CLOSES_SAME.has(name) && top === name) {
      this.pop(true);
    } else if ((name === 'td' || name === 'th') && (top === 'td' || top === 'th')) {
      this.pop(true);
    }
    if (CLOSES_PARAGRAPH.has(name) && this.current.name === 'p') {
      this.pop(true);
    }
    const element = this.append(name, attributes);
    if (VOID.has(name) || (selfClosing && element.foreign)) {
      return;
    }
    if (this.stack.length > MAX_DEPTH) {
      throw new HtmlRefusal(`element nesting deeper than ${MAX_DEPTH}`);
    }
    this.stack.push(element);
    this.openCounts.set(name, (this.openCounts.get(name) ?? 0) + 1);
    this.afterPreStart = name === 'pre' || name === 'listing';
  }

  end(name: string): void {
    this.afterPreStart = false;
    if (name === 'br') {
      this.start('br', NO_ATTRIBUTES, false); // `</br>` is a line break
    } else if (name !== 'body' && name !== 'html' && this.isOpen(name)) {
      // `</body>` and `</html>` are ignored: later text still lands in body.
      this.closeThrough(name, true);
    }
  }

  private append(name: string, attributes: ReadonlyMap<string, string>): ElementNode {
    const parent = this.current;
    const element = createElement(name, attributes, parent);
    parent.children.push(element);
    this.elementCount++;
    if (name === 'head') {
      this.headSeen = true;
    }
    if (name === 'body') {
      this.body = element;
    }
    if (!parent.underRemoved && element.hiddenByAttributes) {
      this.hiddenCount++;
    }
    if (element.boilerplate && !parent.underBoilerplate && !element.underRemoved) {
      this.boilerplateCount++;
    }
    const isContent = name === 'main' || name === 'article' || attributes.get('role') === 'main';
    if (isContent && !element.underRemoved && !element.underBoilerplate) {
      this.candidates.push(element);
    }
    return element;
  }

  private isOpen(name: string): boolean {
    return (this.openCounts.get(name) ?? 0) > 0;
  }

  /**
   * Pops up to and including the innermost open `name`. Only that element,
   * and only when its own end tag closes it cleanly (see the class comment),
   * is closed with certainty; everything popped above it is not.
   */
  private closeThrough(name: string, byEndTag: boolean): void {
    const atTop = this.current.name === name;
    while (this.stack.length > 1) {
      const element = this.current;
      const target = element.name === name;
      this.pop(target && byEndTag && (atTop || element.foreign));
      if (target) {
        return;
      }
    }
  }

  /**
   * Closes the current element. `certain`: the browser closes the same
   * element at this token. An uncertain close of a removed element refuses
   * (see the class comment); `head` is exempt, since body content closes it
   * in the browser too.
   */
  private pop(certain: boolean): void {
    const popped = this.stack.pop() as ElementNode;
    this.openCounts.set(popped.name, (this.openCounts.get(popped.name) ?? 1) - 1);
    if (!certain && popped.removed && popped.name !== 'head') {
      throw new HtmlRefusal(`hidden <${popped.name}> element closed implicitly`);
    }
  }
}
