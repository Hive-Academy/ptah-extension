/**
 * TypeScript/JavaScript declaration summary.
 *
 * Turns the captures of {@link DECLARATION_SUMMARY_QUERIES} (one
 * `TreeSitterParserService.queryMulti` parse) into a .d.ts-style summary of a
 * declaration-only file. Every top-level statement except comments is kept as
 * its own source text, byte for byte, apart from explicit elision spans:
 * - function, method and arrow bodies (a declaration's body is dropped and its
 *   signature ends with `;`; an expression's body becomes `{ … }` or `…`);
 * - large pure-data initialiser values of variables and class fields
 *   (`{ … }`, `[ … ]`, `"…"`): literal keys and literal values only.
 *
 * A summary is produced only for a pure declaration file; anything else is
 * refused, never represented, and the caller answers with the full file.
 * The summary is refused (`unsupported-declarations`) when:
 * - a top-level statement is not an import, an export clause or re-export,
 *   or a function / class / interface / type / enum / namespace / `declare`
 *   declaration (or its `export` / `export default` form), or a variable
 *   declaration whose initialiser is absent, a function or arrow expression,
 *   or a literal (wrappers such as `as const`, `satisfies`, parentheses and
 *   type assertions are looked through);
 * - the file anywhere refers to a runtime export channel: `exports`,
 *   `module`, `globalThis`, `window`, `self`, `global`, `prototype` /
 *   `__proto__`, `Object`/`Reflect` `.assign` / `.defineProperty` /
 *   `.defineProperties` / `.setPrototypeOf` / `.set`, or `Object` / `Reflect`
 *   used other than as the object of a member access (an alias);
 * - code runs while the module loads outside a function body, a parameter
 *   list, a decorator or an instance field initialiser: a call, `new`,
 *   `await`, a spread, a computed key or a class static block (it could run
 *   an elided body that installs API);
 * - an initialiser literal over {@link LARGE_INITIALISER_CHARS} is not pure
 *   data (methods, references, spreads, computed keys, accessors or template
 *   substitutions), so eliding it would hide API.
 * It is also refused when the parse needed error recovery (`syntax-errors`)
 * or the file declares nothing (`no-declarations`).
 *
 * Every step is a sort, a binary search or a single forward sweep over
 * sorted ranges, so the cost is linear in the number of captures plus the
 * sorts.
 *
 * Node types were checked against the grammars `TreeSitterParserService`
 * loads (@vscode/tree-sitter-wasm tree-sitter-typescript / -javascript); a
 * real-grammar spec pins them (`context-enrichment.service.spec.ts`).
 *
 * @module libs/backend/workspace-intelligence/context-analysis
 */

import type { GenericAstNode } from '../ast/ast.types';
import type {
  QueryCapture,
  QueryMatch,
} from '../ast/tree-sitter-parser.service';

/** Keys of the {@link DECLARATION_SUMMARY_QUERIES} result map. */
const SYNTAX_ERRORS = 'syntaxErrors';
const STATEMENTS = 'statements';
const BODIES = 'bodies';
const TOP_VALUES = 'topValues';
const FIELDS = 'fields';
const DATA_SHAPE = 'dataShape';
const LOAD_TIME = 'loadTime';
const DEFERRED = 'deferred';
const RUNTIME_REFS = 'runtimeRefs';

/**
 * Function bodies to elide: `signature` (a declaration or class method; the
 * signature ends with `;`, as in a .d.ts file) and `elided` (an expression
 * body; replaced with `{ … }` or `…`).
 */
const BODY_QUERY = `
(function_declaration body: (statement_block) @signature)
(generator_function_declaration body: (statement_block) @signature)
(class_body (method_definition body: (statement_block) @signature))
(method_definition body: (statement_block) @elided)
(function_expression body: (statement_block) @elided)
(generator_function body: (statement_block) @elided)
(arrow_function body: (_) @elided)
`;

/** Initialisers of top-level variables (`@value`) and `export default` values (`@exported`). */
const TOP_VALUE_QUERY = `
(program (lexical_declaration (variable_declarator value: (_) @value)))
(program (variable_declaration (variable_declarator value: (_) @value)))
(program (export_statement declaration: (lexical_declaration (variable_declarator value: (_) @value))))
(program (export_statement declaration: (variable_declaration (variable_declarator value: (_) @value))))
(program (export_statement value: (_) @exported))
`;

/** Class fields with an initialiser. */
const FIELD_QUERY = '(class_body (_ value: (_) @value) @field)';

/**
 * The parts of object, array and template literals that decide whether a
 * literal is pure data; see {@link isPureDataPart}.
 */
const DATA_SHAPE_QUERY = `
(object (_) @member)
(array (_) @element)
(pair key: (_) @key)
(pair value: (_) @value)
(template_string (template_substitution) @code)
(unary_expression argument: (_) @operand)
`;

/** Code that runs where it stands. */
const LOAD_TIME_QUERY = `
(call_expression) @code
(new_expression) @code
(await_expression) @code
(spread_element) @code
(computed_property_name) @code
(class_static_block) @code
`;

/** Ranges whose code runs later, not while the module loads (with the bodies and instance fields). */
const DEFERRED_QUERY = '(formal_parameters) @deferred (decorator) @deferred';

const CHANNEL_NAMES = '^(exports|module|globalThis|window|self|global)$';
const REFLECTION_OWNERS = '^(Object|Reflect)$';

/**
 * Runtime export channels (`@ref`, refused anywhere) and every `Object` /
 * `Reflect` identifier (`@owner` when it is the object of a member access,
 * `@global` always: a `@global` that is not an `@owner` is an alias).
 */
const RUNTIME_REF_QUERY = `
((identifier) @ref (#match? @ref "${CHANNEL_NAMES}"))
((shorthand_property_identifier) @ref (#match? @ref "${CHANNEL_NAMES}"))
((property_identifier) @ref (#match? @ref "^(prototype|__proto__)$"))
(member_expression object: (identifier) @owner (#match? @owner "${REFLECTION_OWNERS}") property: (property_identifier) @ref (#match? @ref "^(assign|defineProperty|defineProperties|setPrototypeOf|set)$"))
(member_expression object: (identifier) @owner (#match? @owner "${REFLECTION_OWNERS}"))
((identifier) @global (#match? @global "${REFLECTION_OWNERS}"))
`;

/** The queries to run, over one parse, for {@link summariseDeclarations}. */
export const DECLARATION_SUMMARY_QUERIES: ReadonlyArray<{
  key: string;
  queryString: string;
}> = [
  { key: SYNTAX_ERRORS, queryString: '(ERROR) @error (MISSING) @missing' },
  { key: STATEMENTS, queryString: '(program (_) @statement)' },
  { key: BODIES, queryString: BODY_QUERY },
  { key: TOP_VALUES, queryString: TOP_VALUE_QUERY },
  { key: FIELDS, queryString: FIELD_QUERY },
  { key: DATA_SHAPE, queryString: DATA_SHAPE_QUERY },
  { key: LOAD_TIME, queryString: LOAD_TIME_QUERY },
  { key: DEFERRED, queryString: DEFERRED_QUERY },
  { key: RUNTIME_REFS, queryString: RUNTIME_REF_QUERY },
];

/**
 * An initialiser value longer than this (in characters) is elided when it is
 * pure data and refused otherwise. Chosen so ordinary constants and small
 * option objects stay readable while data tables, fixtures and long embedded
 * texts do not crowd out the API.
 */
export const LARGE_INITIALISER_CHARS = 400;

/** Top-level node types that are declarations. */
const DECLARATION_TYPES: ReadonlySet<string> = new Set([
  'import_statement',
  'import_alias',
  'function_declaration',
  'generator_function_declaration',
  'function_signature',
  'class_declaration',
  'abstract_class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'lexical_declaration',
  'variable_declaration',
  'ambient_declaration',
  'module',
  'internal_module',
]);

/** Top-level node types that are left out: they carry no code. */
const DROPPED_TYPES: ReadonlySet<string> = new Set([
  'comment',
  'html_comment',
  'hash_bang_line',
  'empty_statement',
]);

/** Values that can be exported (their initialiser rules: {@link isAllowedValue}). */
const FUNCTION_VALUE_TYPES: ReadonlySet<string> = new Set([
  'function_expression',
  'function',
  'arrow_function',
  'generator_function',
]);
const PRIMITIVE_TYPES: ReadonlySet<string> = new Set([
  'number',
  'true',
  'false',
  'null',
  'undefined',
  'regex',
]);
const LITERAL_TYPES: ReadonlySet<string> = new Set([
  'object',
  'array',
  'string',
  'template_string',
]);

/** Expressions that only wrap a value: `(…)`, `… as T`, `… satisfies T`, `<T>…`, `…!`. */
const WRAPPER_TYPES: ReadonlySet<string> = new Set([
  'parenthesized_expression',
  'as_expression',
  'satisfies_expression',
  'type_assertion',
  'non_null_expression',
]);

/** Parts of an `export` statement besides a declaration or a value. */
const EXPORT_PARTS: ReadonlySet<string> = new Set([
  'export_clause',
  'namespace_export',
  'string',
  'comment',
  'decorator',
  'identifier',
  'class',
  ...FUNCTION_VALUE_TYPES,
  ...PRIMITIVE_TYPES,
  ...LITERAL_TYPES,
  'unary_expression',
  ...WRAPPER_TYPES,
]);

/** Values a pure-data literal may hold. */
const DATA_VALUE_TYPES: ReadonlySet<string> = new Set([
  ...PRIMITIVE_TYPES,
  ...LITERAL_TYPES,
  'unary_expression',
]);

/** Outcome of {@link summariseDeclarations}. */
export type DeclarationSummary =
  | { kind: 'summary'; text: string }
  | { kind: 'syntax-errors' }
  | { kind: 'unsupported-declarations' }
  | { kind: 'no-declarations' };

interface OffsetRange {
  start: number;
  end: number;
}

/** A span of a kept statement that is rendered as its replacement text. */
type SpanKind =
  'signature' | 'block' | 'expression' | 'object' | 'array' | 'string';

interface Span extends OffsetRange {
  kind: SpanKind;
}

type Point = { row: number; column: number };

const REPLACEMENTS: Readonly<Record<SpanKind, string>> = {
  signature: ';',
  block: '{ … }',
  expression: '…',
  object: '{ … }',
  array: '[ … ]',
  string: '"…"',
};

const UNSUPPORTED: DeclarationSummary = { kind: 'unsupported-declarations' };

/**
 * Build the declaration summary of `content` from the captures of
 * {@link DECLARATION_SUMMARY_QUERIES}.
 *
 * @param content - The parsed source text
 * @param matches - `queryMulti` result for {@link DECLARATION_SUMMARY_QUERIES}
 * @param relativePath - Path shown in the summary header
 */
export function summariseDeclarations(
  content: string,
  matches: ReadonlyMap<string, QueryMatch[]>,
  relativePath: string,
): DeclarationSummary {
  if ((matches.get(SYNTAX_ERRORS) ?? []).length > 0) {
    return { kind: 'syntax-errors' };
  }

  const toOffset = createOffsetResolver(content);
  const kept: OffsetRange[] = [];
  let importCount = 0;
  let declares = false;
  for (const capture of capturesOf(matches, STATEMENTS)) {
    const { node } = capture;
    if (DROPPED_TYPES.has(node.type)) {
      continue;
    }
    if (!isPureDeclaration(node)) {
      return UNSUPPORTED;
    }
    if (node.type === 'import_statement' || node.type === 'import_alias') {
      importCount++;
    } else {
      declares = true;
    }
    kept.push(rangeOf(capture, toOffset));
  }
  if (!declares) {
    return { kind: 'no-declarations' };
  }
  if (refersToRuntimeExports(matches, toOffset)) {
    return UNSUPPORTED;
  }

  const bodies = collectBodies(matches, toOffset);
  const inBody = createRangeLookup(bodies);
  const fields = capturesOfFields(matches, toOffset).filter(
    (field) => !inBody(field.range.start),
  );
  const inDeferred = createRangeLookup([
    ...bodies,
    ...capturesOf(matches, DEFERRED).map((c) => rangeOf(c, toOffset)),
    ...fields.filter((f) => !f.isStatic).map((f) => f.valueRange),
  ]);
  if (
    capturesOf(matches, LOAD_TIME).some(
      (capture) => !inDeferred(toOffset(capture.startPosition)),
    )
  ) {
    return UNSUPPORTED;
  }

  const literals = collectLiteralSpans(matches, toOffset, fields);
  if (literals === undefined) {
    return UNSUPPORTED;
  }

  kept.sort(byStart);
  const header = [
    `// Structural summary: ${relativePath}`,
    `// Imports: ${importCount} | Declarations: ${
      kept.length - importCount
    } | Bodies and large literal values omitted`,
    '',
  ];
  return {
    kind: 'summary',
    text: `${[...header, ...renderStatements(content, kept, outermost([...bodies, ...literals]))].join('\n')}\n`,
  };
}

function capturesOf(
  matches: ReadonlyMap<string, QueryMatch[]>,
  key: string,
): QueryCapture[] {
  return (matches.get(key) ?? []).flatMap((match) => match.captures);
}

function rangeOf(
  capture: Pick<QueryCapture, 'startPosition' | 'endPosition'>,
  toOffset: (point: Point) => number,
): OffsetRange {
  return {
    start: toOffset(capture.startPosition),
    end: toOffset(capture.endPosition),
  };
}

function byStart(a: OffsetRange, b: OffsetRange): number {
  return a.start - b.start;
}

function namedChildren(node: GenericAstNode): GenericAstNode[] {
  return node.children.filter((child) => child.isNamed);
}

/**
 * Map a tree-sitter row/column point to an index into `content`. The parser
 * works on the JavaScript string, so columns count UTF-16 code units — the
 * same unit as a string index.
 */
function createOffsetResolver(content: string): (point: Point) => number {
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }
  return ({ row, column }) => (lineStarts[row] ?? content.length) + column;
}

/**
 * Whether a top-level statement is a declaration this writer represents. An
 * `export` statement's value and a variable's initialiser are judged later,
 * from their own captures.
 */
function isPureDeclaration(node: GenericAstNode): boolean {
  if (DECLARATION_TYPES.has(node.type)) {
    return true;
  }
  const children = namedChildren(node);
  if (node.type === 'expression_statement') {
    // A TypeScript `namespace X { … }` parses as an expression statement.
    return children.length === 1 && children[0].type === 'internal_module';
  }
  return (
    node.type === 'export_statement' &&
    children.every(
      (child) =>
        DECLARATION_TYPES.has(child.type) || EXPORT_PARTS.has(child.type),
    )
  );
}

/**
 * Whether the file refers to a runtime export channel anywhere, including
 * inside a body the summary would elide.
 */
function refersToRuntimeExports(
  matches: ReadonlyMap<string, QueryMatch[]>,
  toOffset: (point: Point) => number,
): boolean {
  const owners = new Set<number>();
  const globals: number[] = [];
  for (const capture of capturesOf(matches, RUNTIME_REFS)) {
    if (capture.name === 'ref') {
      return true;
    }
    const offset = toOffset(capture.startPosition);
    if (capture.name === 'owner') {
      owners.add(offset);
    } else {
      globals.push(offset);
    }
  }
  return globals.some((offset) => !owners.has(offset));
}

/** Function bodies to elide, sorted by start. */
function collectBodies(
  matches: ReadonlyMap<string, QueryMatch[]>,
  toOffset: (point: Point) => number,
): Span[] {
  return capturesOf(matches, BODIES)
    .map((capture): Span => {
      let kind: SpanKind = 'signature';
      if (capture.name !== 'signature') {
        kind = capture.node.type === 'statement_block' ? 'block' : 'expression';
      }
      return { ...rangeOf(capture, toOffset), kind };
    })
    .sort(byStart);
}

interface ClassField {
  range: OffsetRange;
  value: GenericAstNode;
  valueRange: OffsetRange;
  isStatic: boolean;
}

function capturesOfFields(
  matches: ReadonlyMap<string, QueryMatch[]>,
  toOffset: (point: Point) => number,
): ClassField[] {
  const fields: ClassField[] = [];
  for (const match of matches.get(FIELDS) ?? []) {
    const field = match.captures.find((c) => c.name === 'field');
    const value = match.captures.find((c) => c.name === 'value');
    if (field && value) {
      fields.push({
        range: rangeOf(field, toOffset),
        value: value.node,
        valueRange: rangeOf(value, toOffset),
        isStatic: field.node.children.some(
          (child) => !child.isNamed && child.type === 'static',
        ),
      });
    }
  }
  return fields;
}

/**
 * The large pure-data initialisers to elide, or `undefined` when an
 * initialiser rules the summary out: a top-level value that is not a
 * function, a literal (or, exported, a name or class), or a large literal
 * that is not pure data.
 */
function collectLiteralSpans(
  matches: ReadonlyMap<string, QueryMatch[]>,
  toOffset: (point: Point) => number,
  fields: readonly ClassField[],
): Span[] | undefined {
  const impureStarts = collectImpureStarts(matches, toOffset);
  const spans: Span[] = [];
  const judge = (core: GenericAstNode): boolean => {
    if (!LITERAL_TYPES.has(core.type)) {
      return true;
    }
    const range = rangeOf(core, toOffset);
    if (range.end - range.start <= LARGE_INITIALISER_CHARS) {
      return true;
    }
    if (containsStart(impureStarts, range)) {
      return false;
    }
    spans.push({ ...range, kind: literalKind(core.type) });
    return true;
  };

  for (const capture of capturesOf(matches, TOP_VALUES)) {
    const core = unwrap(capture.node);
    if (
      core === undefined ||
      !isAllowedValue(core, capture.name === 'exported') ||
      !judge(core)
    ) {
      return undefined;
    }
  }
  for (const field of fields) {
    const core = unwrap(field.value);
    if (core === undefined) {
      // Wrapped deeper than the captured tree: refuse unless it is small.
      if (
        field.valueRange.end - field.valueRange.start >
        LARGE_INITIALISER_CHARS
      ) {
        return undefined;
      }
    } else if (!judge(core)) {
      return undefined;
    }
  }
  return spans;
}

/**
 * The value under its wrappers, or `undefined` when the wrappers go deeper
 * than the captured tree (captured nodes carry three levels of children).
 */
function unwrap(node: GenericAstNode): GenericAstNode | undefined {
  let current = node;
  while (WRAPPER_TYPES.has(current.type)) {
    const inner = namedChildren(current).filter((c) => c.type !== 'comment');
    // `<T>value` puts the value last; the other wrappers put it first.
    const next =
      current.type === 'type_assertion' ? inner[inner.length - 1] : inner[0];
    if (next === undefined) {
      return undefined;
    }
    current = next;
  }
  return current;
}

/** Whether a top-level initialiser (or `export default` value) keeps the file declaration-only. */
function isAllowedValue(core: GenericAstNode, exported: boolean): boolean {
  const { type } = core;
  if (
    FUNCTION_VALUE_TYPES.has(type) ||
    PRIMITIVE_TYPES.has(type) ||
    LITERAL_TYPES.has(type)
  ) {
    return true;
  }
  if (type === 'unary_expression') {
    const operands = namedChildren(core);
    return operands.length === 1 && operands[0].type === 'number';
  }
  return exported && (type === 'identifier' || type === 'class');
}

/** Sorted starts of every literal part that is not pure data. */
function collectImpureStarts(
  matches: ReadonlyMap<string, QueryMatch[]>,
  toOffset: (point: Point) => number,
): number[] {
  return capturesOf(matches, DATA_SHAPE)
    .filter((capture) => !isPureDataPart(capture.name, capture.node.type))
    .map((capture) => toOffset(capture.startPosition))
    .sort((a, b) => a - b);
}

/**
 * Pure data: object members are `key: value` pairs with a literal key,
 * values and array elements are literals, unary operators apply to numbers,
 * and template literals have no substitutions.
 */
function isPureDataPart(captureName: string, nodeType: string): boolean {
  switch (captureName) {
    case 'member':
      return nodeType === 'pair' || nodeType === 'comment';
    case 'element':
      return DATA_VALUE_TYPES.has(nodeType) || nodeType === 'comment';
    case 'key':
      return (
        nodeType === 'property_identifier' ||
        nodeType === 'string' ||
        nodeType === 'number'
      );
    case 'value':
      return DATA_VALUE_TYPES.has(nodeType);
    case 'operand':
      return nodeType === 'number';
    default:
      return false;
  }
}

function literalKind(nodeType: string): SpanKind {
  if (nodeType === 'object') {
    return 'object';
  }
  return nodeType === 'array' ? 'array' : 'string';
}

/**
 * Returns whether an offset lies inside any of `ranges` (any order, may
 * overlap): the ranges are merged once, then each lookup is a binary search.
 */
function createRangeLookup(
  ranges: readonly OffsetRange[],
): (offset: number) => boolean {
  const merged: OffsetRange[] = [];
  for (const range of [...ranges].sort(byStart)) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  const starts = merged.map((range) => range.start);
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid] <= offset) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    const range = merged[low - 1];
    return range !== undefined && offset < range.end;
  };
}

/** Whether a sorted `starts` array has a value inside `range` (binary search). */
function containsStart(starts: readonly number[], range: OffsetRange): boolean {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (starts[mid] < range.start) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low < starts.length && starts[low] < range.end;
}

/**
 * The outermost spans, sorted by start: an inner span is gone with its outer
 * one. A class method body is captured both as `signature` and as a `block`;
 * the signature wins.
 */
function outermost(spans: Span[]): Span[] {
  const rank = (span: Span) => (span.kind === 'signature' ? 0 : 1);
  spans.sort((a, b) => a.start - b.start || b.end - a.end || rank(a) - rank(b));
  const result: Span[] = [];
  for (const span of spans) {
    const last = result[result.length - 1];
    if (!last || span.start >= last.end) {
      result.push(span);
    }
  }
  return result;
}

/**
 * Each kept statement's source text with its spans rendered. Statements and
 * spans are both sorted, so one shared cursor walks the spans once.
 */
function renderStatements(
  content: string,
  statements: readonly OffsetRange[],
  spans: readonly Span[],
): string[] {
  const rendered: string[] = [];
  let next = 0;
  for (const statement of statements) {
    while (next < spans.length && spans[next].end <= statement.start) {
      next++;
    }
    const parts: string[] = [];
    let cursor = statement.start;
    while (next < spans.length && spans[next].end <= statement.end) {
      const span = spans[next++];
      const before = content.slice(cursor, span.start);
      // Only the whitespace between a signature and its dropped body goes.
      parts.push(span.kind === 'signature' ? before.trimEnd() : before);
      parts.push(REPLACEMENTS[span.kind]);
      cursor = span.end;
    }
    parts.push(content.slice(cursor, statement.end));
    rendered.push(parts.join(''));
  }
  return rendered;
}
