/**
 * Template key extraction (7.2) with `@angular/compiler` `parseTemplate`.
 *
 * The walk is reflective over the parsed tree rather than a hand-listed
 * visitor, so every place an expression can sit (interpolations, bound
 * attributes, event handlers, `@if`/`@for`/`@switch`/`@let`/`@defer`
 * expressions, ICUs) is reached without naming each node type, including node
 * types a later compiler version adds.
 *
 * Template comments holding markers (`i18n-keys:`, `i18n-ignore:`,
 * `rtl-exempt:`, `i18n-format-exempt:`) cover the full source span of their
 * next sibling node (see `markers.ts`). The template is parsed once, by
 * `parseTemplateSource`, and the tree is shared with the RTL and formatting
 * rules.
 */
import {
  AST,
  BindingPipe,
  Call,
  KeyedRead,
  LiteralPrimitive,
  NonNullAssert,
  ParenthesizedExpression,
  PropertyRead,
  SafeCall,
  SafeKeyedRead,
  SafePropertyRead,
  ParseSourceSpan,
  TmplAstText,
  TmplAstTextAttribute,
  parseTemplate,
} from '@angular/compiler';
import { parseMarkerComment, type Marker } from './markers';
import type { Violation } from './report';

/** One key argument found in a template or in TypeScript. */
export interface KeyUse {
  file: string;
  line: number;
  /** File offset of the argument, used to decide which markers cover it. */
  offset: number;
  /** `literal`: `key` is the key. `computed`: `key` is the argument's source text. */
  form: 'literal' | 'computed';
  key: string;
  /** For a computed argument such as `STATUS_I18N_KEYS[s]`, the receiver identifier. */
  receiver: string | null;
  /** `object` for `translateObjectSignal`, whose key must name a non-empty group. */
  target: 'leaf' | 'object';
}

/** A string literal or static text, subject to the own-scope literal scan. */
export interface ScannedString {
  file: string;
  line: number;
  offset: number;
  value: string;
}

export interface TemplateScan {
  uses: KeyUse[];
  strings: ScannedString[];
  markers: Marker[];
}

/** Where a template's text sits inside its file. */
export interface TemplateSource {
  text: string;
  /** Workspace-relative path used in reports. */
  file: string;
  /**
   * File offset of the character at `index` in `text` (`text.length`: the
   * end). Exact for an inline template with escape sequences too.
   */
  offsetAt(index: number): number;
  /** 1-based file line of a file offset. */
  lineAt(offset: number): number;
}

/** A whole `.html` file: text index and file offset coincide. */
export function fileTemplateSource(text: string, file: string): TemplateSource {
  const lineAt = lineLocator(text);
  return { text, file, offsetAt: (index) => index, lineAt };
}

interface Span {
  start: number;
  end: number;
}

/** The parsed nodes and comments of one template. */
export type TemplateTree = Pick<
  ReturnType<typeof parseTemplate>,
  'nodes' | 'commentNodes'
>;

/**
 * Parses a template once for every template rule. A parse that throws or
 * reports errors is a failure of this one file, returned as violations; the
 * scan goes on with the other files.
 */
export function parseTemplateSource(
  source: TemplateSource,
):
  | { tree: TemplateTree; violations: [] }
  | { tree: null; violations: Violation[] } {
  const lineAt = (index: number): number =>
    source.lineAt(source.offsetAt(index));
  const parseError = (index: number, detail: string): Violation => ({
    file: source.file,
    line: lineAt(index),
    kind: 'parse-error',
    key: '',
    detail,
  });

  let parsed: ReturnType<typeof parseTemplate>;
  try {
    parsed = parseTemplate(source.text, source.file, {
      // Collapsing whitespace rewrites text before its interpolations are
      // parsed, which shifts their spans; keep the source text as written.
      preserveWhitespaces: true,
      collectCommentNodes: true,
    });
  } catch (error: unknown) {
    return {
      tree: null,
      violations: [
        parseError(
          0,
          `template parser threw: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }
  if (parsed.errors && parsed.errors.length > 0) {
    return {
      tree: null,
      violations: parsed.errors.map((error) =>
        parseError(error.span.start.offset, error.msg.split('\n')[0]),
      ),
    };
  }
  return { tree: parsed, violations: [] };
}

export function extractTemplateKeys(
  source: TemplateSource,
  parsed: TemplateTree,
): TemplateScan {
  const { file, offsetAt } = source;
  const scan: TemplateScan = { uses: [], strings: [], markers: [] };
  const lineAt = (index: number): number => source.lineAt(offsetAt(index));

  const nodeSpans: Span[] = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    const nodeSpan = (value as { sourceSpan?: unknown }).sourceSpan;
    // Whitespace between nodes is not a sibling a marker attaches to.
    const isBlankText =
      value instanceof TmplAstText && value.value.trim() === '';
    if (nodeSpan instanceof ParseSourceSpan && !isBlankText) {
      nodeSpans.push({
        start: nodeSpan.start.offset,
        end: nodeSpan.end.offset,
      });
    }

    if (value instanceof BindingPipe && value.name === 'transloco') {
      scan.uses.push(useOf(value.exp, source, lineAt));
    } else if (value instanceof LiteralPrimitive) {
      if (typeof value.value === 'string') {
        scan.strings.push({
          file,
          line: lineAt(value.sourceSpan.start),
          offset: offsetAt(value.sourceSpan.start),
          value: value.value,
        });
      }
    } else if (
      value instanceof TmplAstText ||
      value instanceof TmplAstTextAttribute
    ) {
      scan.strings.push({
        file,
        line: lineAt(value.sourceSpan.start.offset),
        offset: offsetAt(value.sourceSpan.start.offset),
        value: value.value.trim(),
      });
    }

    for (const [key, child] of Object.entries(value)) {
      // Spans carry the whole source file; i18n metadata duplicates nodes.
      if (/span$/i.test(key) || key === 'i18n') continue;
      visit(child);
    }
  };
  visit(parsed.nodes);

  for (const comment of parsed.commentNodes ?? []) {
    const body = parseMarkerComment(comment.value);
    if (!body) continue;
    const span: Span = {
      start: comment.sourceSpan.start.offset,
      end: comment.sourceSpan.end.offset,
    };
    const sibling = nextSibling(span, nodeSpans);
    scan.markers.push({
      ...body,
      file,
      line: lineAt(span.start),
      covers: sibling
        ? { start: offsetAt(sibling.start), end: offsetAt(sibling.end) }
        : null,
    });
  }
  return scan;
}

/**
 * The node that follows a comment at the same nesting level: among the nodes
 * inside the comment's innermost enclosing node (or the root), the first one
 * that starts after the comment. Comments are not part of the node tree, so a
 * comment followed by another comment still reaches the next real node.
 */
function nextSibling(comment: Span, nodes: readonly Span[]): Span | null {
  let parent: Span | null = null;
  for (const node of nodes) {
    if (node.start <= comment.start && node.end >= comment.end) {
      if (!parent || node.end - node.start < parent.end - parent.start) {
        parent = node;
      }
    }
  }
  let next: Span | null = null;
  for (const node of nodes) {
    if (node.start < comment.end) continue;
    if (parent && node.end > parent.end) continue;
    if (
      !next ||
      node.start < next.start ||
      (node.start === next.start && node.end > next.end)
    ) {
      next = node;
    }
  }
  return next;
}

/** Maps a character offset in `text` to its 1-based line. */
export function lineLocator(text: string): (offset: number) => number {
  const newlines: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) newlines.push(i);
  }
  return (offset: number): number => {
    let low = 0;
    let high = newlines.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (newlines[mid] < offset) low = mid + 1;
      else high = mid;
    }
    return 1 + low;
  };
}

function useOf(
  exp: AST,
  source: TemplateSource,
  lineAt: (offset: number) => number,
): KeyUse {
  const file = source.file;
  const line = lineAt(exp.sourceSpan.start);
  const offset = source.offsetAt(exp.sourceSpan.start);
  const inner = unwrap(exp);
  if (inner instanceof LiteralPrimitive && typeof inner.value === 'string') {
    return {
      file,
      line,
      offset,
      form: 'literal',
      key: inner.value,
      receiver: null,
      target: 'leaf',
    };
  }
  return {
    file,
    line,
    offset,
    form: 'computed',
    key: source.text.slice(exp.sourceSpan.start, exp.sourceSpan.end).trim(),
    receiver: receiverName(inner),
    target: 'leaf',
  };
}

function unwrap(exp: AST): AST {
  let current = exp;
  while (
    current instanceof ParenthesizedExpression ||
    current instanceof NonNullAssert
  ) {
    current = current.expression;
  }
  return current;
}

/** `X[k]`, `X.k`, `this.X[k]`, `X()[k]` → `X`. */
function receiverName(exp: AST): string | null {
  if (
    exp instanceof KeyedRead ||
    exp instanceof SafeKeyedRead ||
    exp instanceof PropertyRead ||
    exp instanceof SafePropertyRead
  ) {
    return nameOf(unwrap(exp.receiver));
  }
  return null;
}

function nameOf(exp: AST): string | null {
  if (exp instanceof PropertyRead || exp instanceof SafePropertyRead) {
    return exp.name;
  }
  if (exp instanceof Call || exp instanceof SafeCall) {
    return nameOf(unwrap(exp.receiver));
  }
  return null;
}
