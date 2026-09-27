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
 *   `module.exports.a = v`) or `commonjs_defined_name`
 *   (`Object.defineProperty(exports, 'a', ...)`).
 * - `export.commonjs_reference`: any other `exports` / `module.exports`.
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

/** Decode export-query matches into unique export records, in source order. */
export function extractExportsFromMatches(
  matches: readonly QueryMatch[],
): ExportExtraction {
  const exportedPatterns = capturesNamed(matches, 'export.binding_pattern');
  const exports: ExportInfo[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const captures = new Map<string, QueryCapture>();
    for (const capture of match.captures) {
      captures.set(capture.name, capture);
    }
    const info = decodeMatch(captures, exportedPatterns);
    if (!info) {
      continue;
    }
    const key = `${info.name}\u0000${info.kind}\u0000${info.source ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      exports.push(info);
    }
  }

  return { exports, unextracted: unextractedCommonJs(matches) };
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

function decodeMatch(
  captures: ReadonlyMap<string, QueryCapture>,
  exportedPatterns: readonly QueryCapture[],
): ExportInfo | undefined {
  const statement = captures.get('export.statement')?.node;

  for (const [captureName, kind] of DECLARATION_CAPTURES) {
    const declared = captures.get(captureName);
    if (!declared) {
      continue;
    }
    const namespaceSource = captures.get('export.source');
    if (namespaceSource) {
      return {
        name: nameOf(declared.node),
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
      : undefined;
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
): ExportInfo | undefined {
  const assignment = captures.get('export.assignment_value');
  if (assignment) {
    return decodeValueExport(EXPORT_ASSIGNMENT_NAME, assignment);
  }

  const globalNamespace = captures.get('export.global_namespace_name');
  if (globalNamespace) {
    return { name: nameOf(globalNamespace.node), kind: 'namespace' };
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
      : undefined;
  }

  const definedName = captures.get('export.commonjs_defined_name');
  if (definedName) {
    const name = nameOf(definedName.node);
    return name === ES_MODULE_MARKER ? undefined : { name, kind: 'unknown' };
  }

  const commonJsValue = captures.get('export.commonjs_value');
  if (commonJsValue) {
    const name =
      captures.get('export.commonjs_name')?.text ?? EXPORT_ASSIGNMENT_NAME;
    return decodeValueExport(name, commonJsValue);
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
): ExportInfo {
  const names = specifier.children
    .filter(
      (child) =>
        child.type !== 'comment' &&
        !(!child.isNamed && (child.type === 'as' || child.type === 'type')),
    )
    .map(nameOf);
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

/** Uses of `exports` / `module.exports` not covered by a decoded form. */
function unextractedCommonJs(matches: readonly QueryMatch[]): string[] {
  const decoded = capturesNamed(matches, 'export.commonjs_target');
  const lines = new Map<number, string>();
  for (const reference of capturesNamed(matches, 'export.commonjs_reference')) {
    const row = reference.startPosition.row;
    if (!lines.has(row) && !decoded.some((t) => contains(t, reference))) {
      lines.set(row, `line ${row + 1}: ${reference.text}`);
    }
  }
  return [...lines.values()].map((line) =>
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

/** A name node's value: a string literal's contents, otherwise its text. */
function nameOf(node: GenericAstNode): string {
  if (node.type !== 'string') {
    return node.text;
  }
  return node.children
    .filter((child) => child.isNamed)
    .map((child) => child.text)
    .join('');
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
