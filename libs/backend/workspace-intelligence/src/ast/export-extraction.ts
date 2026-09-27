/**
 * Decodes the JS/TS export query (`JS_TS_EXPORT_QUERY`, plus the TypeScript
 * suffix, in `tree-sitter.config.ts`) into {@link ExportInfo} records.
 *
 * Shared by `AstAnalysisService.analyzeSource` (ptah_ast_analyze and the
 * dependency graph's symbol index) and the `ptah.ast.queryExports` namespace
 * method, so both read the same captures the same way.
 *
 * Capture names:
 * - `export.func_name` / `class_name` / `var_name` / `interface_name` /
 *   `type_name` / `enum_name` / `namespace_name`: a declared export's name.
 *   `namespace_name` together with `export.source` is `export * as ns`.
 * - `export.statement`: the whole export statement; its `default` keyword
 *   child marks a default export, its `string` child is a re-export source.
 * - `export.binding_pattern` / `export.binding`: an exported destructuring
 *   pattern's range and every binding name found inside any pattern; only the
 *   bindings inside an exported pattern are exports.
 * - `export.default_value`: the expression of `export default <expression>`.
 * - `export.specifier`: one export-clause entry, decoded from its child nodes
 *   (comments skipped, string names read as their value), never from text.
 * - `export.wildcard_source`: the module of a plain `export *`.
 * - `export.assignment_value`: the value of TypeScript `export = value`.
 * - `export.global_namespace_name`: `export as namespace Name`.
 * - `export.import_alias_name` with `import_alias_target` (`export import X =
 *   N.Y`) or `import_alias_source` (`export import X = require(<module string>)`).
 * - `export.commonjs_target` with `commonjs_value` and optionally
 *   `commonjs_name` (`module.exports = v`, `exports.a = v`,
 *   `module.exports.a = v`, each also with a constant-string bracket key:
 *   `module["exports"]`, `exports["a"]`) or `commonjs_defined_name`
 *   (`Object.defineProperty(exports, 'a', ...)`).
 * - `export.commonjs_reference`: any other `exports` / `module.exports` /
 *   `module["exports"]`.
 *
 * - `export.module_key` / `export.module_reference_key`: the index of a
 *   `module[<key>]` access. Its WHOLE semantic value decides: a constant
 *   string that decodes to `exports` is the export object, any other constant
 *   is not, and a computed or undecodable key is unknown (disclosed).
 *
 * String names (`export { a as "x-y" }`, `exports["a"]`, `defineProperty`)
 * are their semantic value: escape sequences are decoded, legacy octal ones
 * included. A name that cannot be decoded exactly is never guessed: its
 * statement is reported in `unextracted` instead.
 *
 * Naming: `export = value` and `module.exports = value` replace the whole
 * module export; they are recorded under TypeScript's own symbol name
 * `export=`, with the value's kind (and `localName` for an identifier).
 *
 * Records are unique by name, kind and source: overload signatures collapse to
 * one function, while TypeScript declaration merging (an interface and a
 * namespace sharing a name) keeps one record per kind.
 */

import type { ExportInfo } from './ast-analysis.interfaces';
import type { CodePosition, GenericAstNode } from './ast.types';
import type { QueryCapture, QueryMatch } from './tree-sitter-parser.service';

/** Decoded exports plus the export forms the decoder could not represent. */
export interface ExportExtraction {
  exports: ExportInfo[];
  /**
   * `line N: <source>` for each `exports` / `module.exports` use outside a
   * decoded CommonJS form (e.g. `exports[key] = v`). Non-empty means
   * `exports` may be incomplete.
   */
  unextracted: string[];
}

/** Name TypeScript gives a whole-module export assignment. */
const EXPORT_ASSIGNMENT_NAME = 'export=';

/** Emitted by compilers to mark an ES module; not an exported symbol. */
const ES_MODULE_MARKER = '__esModule';

const UNEXTRACTED_TEXT_LIMIT = 80;

const DECLARATION_CAPTURES: ReadonlyArray<
  readonly [captureName: string, kind: ExportInfo['kind']]
> = [
  ['export.func_name', 'function'],
  ['export.class_name', 'class'],
  ['export.var_name', 'variable'],
  ['export.interface_name', 'interface'],
  ['export.type_name', 'type'],
  ['export.enum_name', 'enum'],
  ['export.namespace_name', 'namespace'],
];

/** Exported values whose node type makes them functions or classes. */
const FUNCTION_VALUE_TYPES = new Set([
  'function_expression',
  'function',
  'arrow_function',
  'generator_function',
]);
const CLASS_VALUE_TYPES = new Set(['class', 'class_expression']);

/** 0-based first and last row of the statement an export record came from. */
export interface ExportRowRange {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Where each record {@link extractExportsFromMatches} returned was declared.
 * Kept beside the records, not on them: `ExportInfo` is serialised as is by
 * ptah_ast_analyze and the symbol index, and rows are not part of that wire
 * shape. Weakly held, so a record nobody references frees its entry.
 */
const EXPORT_ROWS = new WeakMap<ExportInfo, ExportRowRange>();

/**
 * The rows of the export statement `info` was decoded from, or `undefined`
 * for a record this module did not produce (or a copy of one).
 */
export function exportRowRange(info: ExportInfo): ExportRowRange | undefined {
  return EXPORT_ROWS.get(info);
}

/** Decode export-query matches into unique export records, in source order. */
export function extractExportsFromMatches(
  matches: readonly QueryMatch[],
): ExportExtraction {
  const exportedPatterns = capturesNamed(matches, 'export.binding_pattern');
  const exports: ExportInfo[] = [];
  const seen = new Set<string>();
  /** CommonJS targets whose match was understood (an export, or not one). */
  const decodedTargets: QueryCapture[] = [];
  /** Unreadable export forms by row, first text per row. */
  const unextracted = new Map<number, string>();

  for (const match of matches) {
    const captures = new Map<string, QueryCapture>();
    for (const capture of match.captures) {
      captures.set(capture.name, capture);
    }
    const decoded = decodeMatch(captures, exportedPatterns);
    const target = captures.get('export.commonjs_target');
    if (decoded === UNNAMEABLE) {
      const shown =
        captures.get('export.specifier') ??
        target ??
        captures.get('export.statement') ??
        match.captures[0];
      if (shown) addUnextracted(unextracted, shown);
      continue;
    }
    if (target) decodedTargets.push(target);
    if (decoded === NOT_AN_EXPORT) {
      continue;
    }
    const info = decoded;
    const key = `${info.name}\u0000${info.kind}\u0000${info.source ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      exports.push(info);
      EXPORT_ROWS.set(info, rowRangeOf(match));
    }
  }

  for (const reference of commonJsReferences(matches)) {
    if (!decodedTargets.some((t) => contains(t, reference))) {
      addUnextracted(unextracted, reference);
    }
  }

  return {
    exports,
    unextracted: [...unextracted.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, line]) => line),
  };
}

/**
 * Names for a symbol index: one entry per distinct exported name, with a
 * wildcard re-export written as `* from <module>` so each one stays distinct.
 */
export function exportSymbolNames(exports: readonly ExportInfo[]): string[] {
  const names = exports.map((info) =>
    info.kind === 'wildcard' ? `* from ${info.source ?? ''}` : info.name,
  );
  return [...new Set(names)];
}

/** The rows every capture of `match` spans (the whole statement when captured). */
function rowRangeOf(match: QueryMatch): ExportRowRange {
  let startLine = Number.POSITIVE_INFINITY;
  let endLine = 0;
  for (const capture of match.captures) {
    startLine = Math.min(startLine, capture.startPosition.row);
    endLine = Math.max(endLine, capture.endPosition.row);
  }
  return Number.isFinite(startLine)
    ? { startLine, endLine }
    : { startLine: 0, endLine: 0 };
}

/** A match that is understood and is not an export (`__esModule`, `module.id`). */
const NOT_AN_EXPORT = Symbol('not-an-export');
/** A match that is an export whose name cannot be read exactly. */
const UNNAMEABLE = Symbol('unnameable');
type Decoded = ExportInfo | typeof NOT_AN_EXPORT | typeof UNNAMEABLE;

function decodeMatch(
  captures: ReadonlyMap<string, QueryCapture>,
  exportedPatterns: readonly QueryCapture[],
): Decoded {
  const statement = captures.get('export.statement')?.node;

  for (const [captureName, kind] of DECLARATION_CAPTURES) {
    const declared = captures.get(captureName);
    if (!declared) {
      continue;
    }
    const namespaceSource = captures.get('export.source');
    if (namespaceSource) {
      const name = nameOf(declared.node);
      return name === undefined
        ? UNNAMEABLE
        : {
            name,
            kind,
            isReExport: true,
            source: unquote(namespaceSource.text),
          };
    }
    const isDefault = statement !== undefined && hasChild(statement, 'default');
    return { name: declared.text, kind, isDefault: isDefault || undefined };
  }

  const binding = captures.get('export.binding');
  if (binding) {
    return exportedPatterns.some((pattern) => contains(pattern, binding))
      ? { name: binding.text, kind: 'variable' }
      : NOT_AN_EXPORT;
  }

  const defaultValue = captures.get('export.default_value');
  if (defaultValue) {
    return decodeValueExport('default', defaultValue);
  }

  const specifier = captures.get('export.specifier');
  if (specifier) {
    return decodeSpecifier(specifier.node, statement);
  }

  const wildcardSource = captures.get('export.wildcard_source');
  if (wildcardSource) {
    return {
      name: '*',
      kind: 'wildcard',
      isReExport: true,
      source: unquote(wildcardSource.text),
    };
  }

  return decodeModuleSystemExport(captures);
}

/** `export =`, `export as namespace`, `export import`, and CommonJS forms. */
function decodeModuleSystemExport(
  captures: ReadonlyMap<string, QueryCapture>,
): Decoded {
  const assignment = captures.get('export.assignment_value');
  if (assignment) {
    return decodeValueExport(EXPORT_ASSIGNMENT_NAME, assignment);
  }

  const globalNamespace = captures.get('export.global_namespace_name');
  if (globalNamespace) {
    const name = nameOf(globalNamespace.node);
    return name === undefined ? UNNAMEABLE : { name, kind: 'namespace' };
  }

  const aliasName = captures.get('export.import_alias_name');
  if (aliasName) {
    const aliasSource = captures.get('export.import_alias_source');
    if (aliasSource) {
      return {
        name: aliasName.text,
        kind: 'namespace',
        isReExport: true,
        source: unquote(aliasSource.text),
      };
    }
    const aliasTarget = captures.get('export.import_alias_target');
    return aliasTarget
      ? { name: aliasName.text, kind: 'unknown', localName: aliasTarget.text }
      : NOT_AN_EXPORT;
  }

  const definedName = captures.get('export.commonjs_defined_name');
  if (definedName) {
    const name = nameOf(definedName.node);
    if (name === undefined) return UNNAMEABLE;
    return name === ES_MODULE_MARKER
      ? NOT_AN_EXPORT
      : { name, kind: 'unknown' };
  }

  const commonJsValue = captures.get('export.commonjs_value');
  if (commonJsValue) {
    const moduleKey = captures.get('export.module_key');
    if (moduleKey) {
      const key = moduleKeyClass(moduleKey.node);
      if (key === 'other') return NOT_AN_EXPORT;
      if (key === 'unknown') return UNNAMEABLE;
    }
    const nameNode = captures.get('export.commonjs_name')?.node;
    const name = nameNode ? nameOf(nameNode) : EXPORT_ASSIGNMENT_NAME;
    return name === undefined
      ? UNNAMEABLE
      : decodeValueExport(name, commonJsValue);
  }

  return NOT_AN_EXPORT;
}

/**
 * What the index of `module[<key>]` is: `exports` when it is a constant
 * whose whole value is `exports`; `other` for any other constant (a string,
 * a number, a template without substitutions); `unknown` for a computed key
 * or a string that cannot be decoded exactly.
 */
function moduleKeyClass(key: GenericAstNode): 'exports' | 'other' | 'unknown' {
  const value = constantKey(key);
  if (value === undefined) return 'unknown';
  return value === 'exports' ? 'exports' : 'other';
}

function constantKey(key: GenericAstNode): string | undefined {
  if (key.type === 'string') return nameOf(key);
  if (key.type === 'number') return key.text;
  if (
    key.type === 'template_string' &&
    key.children.every(
      (child) => !child.isNamed || child.type === 'string_fragment',
    )
  ) {
    return key.children
      .filter((child) => child.isNamed)
      .map((child) => child.text)
      .join('');
  }
  return undefined;
}

/**
 * An export whose value is an expression: kind from the expression, and the
 * local name when the value is a bare identifier.
 */
function decodeValueExport(name: string, value: QueryCapture): ExportInfo {
  const isDefault = name === 'default' || undefined;
  const type = value.node.type;
  if (type === 'identifier') {
    return { name, kind: 'unknown', isDefault, localName: value.text };
  }
  const kind: ExportInfo['kind'] = FUNCTION_VALUE_TYPES.has(type)
    ? 'function'
    : CLASS_VALUE_TYPES.has(type)
      ? 'class'
      : 'variable';
  return { name, kind, isDefault };
}

/**
 * One export-clause entry from its nodes: `a`, `a as b`, `type T`, `default`,
 * `"string name" as c`. Comments, `as` and an inline `type` modifier are
 * skipped; the first remaining node is the local name, the last the exported.
 */
function decodeSpecifier(
  specifier: GenericAstNode,
  statement: GenericAstNode | undefined,
): Decoded {
  const decoded = specifier.children
    .filter(
      (child) =>
        child.type !== 'comment' &&
        !(!child.isNamed && (child.type === 'as' || child.type === 'type')),
    )
    .map(nameOf);
  const names: string[] = [];
  for (const name of decoded) {
    if (name === undefined) return UNNAMEABLE;
    names.push(name);
  }
  const local = names[0] ?? specifier.text;
  const exported = names[names.length - 1] ?? local;
  const sourceNode = statement?.children.find(
    (child) => child.type === 'string',
  );
  const source = sourceNode ? unquote(sourceNode.text) : undefined;
  return {
    name: exported,
    kind: 'unknown',
    isDefault: exported === 'default' || undefined,
    isReExport: source !== undefined || undefined,
    source,
    localName: local !== exported ? local : undefined,
  };
}

/**
 * Every mention of the CommonJS export object: `exports`, `module.exports`,
 * and `module[<key>]` whose key is `exports` or cannot be known (a key that
 * is a different constant, `module["id"]`, is not the export object).
 */
function commonJsReferences(matches: readonly QueryMatch[]): QueryCapture[] {
  const references: QueryCapture[] = [];
  for (const match of matches) {
    for (const capture of match.captures) {
      if (capture.name === 'export.commonjs_reference') {
        references.push(capture);
      } else if (capture.name === 'export.module_reference') {
        const key = match.captures.find(
          (c) => c.name === 'export.module_reference_key',
        );
        if (key === undefined || moduleKeyClass(key.node) !== 'other') {
          references.push(capture);
        }
      }
    }
  }
  return references;
}

/** Records `capture` as an unreadable export form on its row (first one wins). */
function addUnextracted(
  lines: Map<number, string>,
  capture: QueryCapture,
): void {
  const row = capture.startPosition.row;
  if (lines.has(row)) return;
  const line = `line ${row + 1}: ${capture.text}`;
  lines.set(
    row,
    line.length > UNEXTRACTED_TEXT_LIMIT
      ? `${line.slice(0, UNEXTRACTED_TEXT_LIMIT)}…`
      : line,
  );
}

function capturesNamed(
  matches: readonly QueryMatch[],
  name: string,
): QueryCapture[] {
  return matches.flatMap((match) =>
    match.captures.filter((capture) => capture.name === name),
  );
}

/**
 * A name node's value: a string literal's contents with every escape
 * sequence decoded (`"x\u002dy"` is `x-y`), otherwise its text. `undefined`
 * when a part of the string cannot be decoded exactly (an escape with no
 * value, or a child the decoder does not know).
 */
function nameOf(node: GenericAstNode): string | undefined {
  if (node.type !== 'string') {
    return node.text;
  }
  let value = '';
  for (const child of node.children) {
    if (!child.isNamed) continue;
    const part =
      child.type === 'string_fragment'
        ? child.text
        : child.type === 'escape_sequence'
          ? decodeEscapeSequence(child.text)
          : undefined;
    if (part === undefined) return undefined;
    value += part;
  }
  return value;
}

/** Single-character escapes with a value other than the character itself. */
const SINGLE_ESCAPES: Readonly<Record<string, string>> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

const HEX_ESCAPE =
  /^(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))$/;
/** A legacy (sloppy-mode) octal escape body, as tree-sitter delimits it. */
const OCTAL_ESCAPE = /^[0-7]{1,3}$/;
const LINE_CONTINUATION = /^(?:\r\n|[\n\r\u2028\u2029])$/;

/**
 * The value of one string-literal escape sequence as tree-sitter delimits it
 * (`\u002d`, `\u{1F600}`, `\x41`, `\n`, `\'`, a line continuation, a legacy
 * octal `\141` or `\0`, a legacy `\8`), as the runtime evaluates it.
 * `undefined` for an escape with no exact value (a code point past
 * U+10FFFF, or a shape the grammar should never produce).
 */
function decodeEscapeSequence(escape: string): string | undefined {
  const body = escape.slice(1);
  const hex = HEX_ESCAPE.exec(body);
  if (hex) {
    const codePoint = parseInt(hex[1] ?? hex[2] ?? hex[3], 16);
    return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : undefined;
  }
  if (OCTAL_ESCAPE.test(body)) {
    // LegacyOctalEscapeSequence stops at \377: a three-digit body led by 4-7
    // is a two-digit escape then a literal digit (`\400` is " " + "0").
    if (body.length === 3 && body[0] > '3') {
      return String.fromCharCode(parseInt(body.slice(0, 2), 8)) + body[2];
    }
    return String.fromCharCode(parseInt(body, 8));
  }
  if (LINE_CONTINUATION.test(body)) {
    return '';
  }
  if (body.length === 1 && body !== 'x' && body !== 'u') {
    // `\8`, `\9`, `\'` and every other NonEscapeCharacter are the character.
    return SINGLE_ESCAPES[body] ?? body;
  }
  return undefined;
}

function hasChild(node: GenericAstNode, type: string): boolean {
  return node.children.some((child) => child.type === type);
}

function contains(outer: QueryCapture, inner: QueryCapture): boolean {
  return (
    !isBefore(inner.startPosition, outer.startPosition) &&
    !isBefore(outer.endPosition, inner.endPosition)
  );
}

function isBefore(a: CodePosition, b: CodePosition): boolean {
  return a.row < b.row || (a.row === b.row && a.column < b.column);
}

function unquote(text: string): string {
  const first = text.charAt(0);
  return text.length >= 2 &&
    (first === "'" || first === '"' || first === '`') &&
    text.endsWith(first)
    ? text.slice(1, -1)
    : text;
}
