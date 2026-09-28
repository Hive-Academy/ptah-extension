/**
 * Go language module. Visibility is by capitalisation: the public symbols
 * are the package-level declarations whose name starts upper-case (Batch 33).
 */
import type { GenericAstNode } from '../ast.types';
import { GO_IMPORT_RESOLVER } from '../import-resolution/go-import-resolver';
import type { GraphEdgesCapability } from '../language-registry';
import type { ExtractedImport, LanguageModule } from './types';

/**
 * Go queries. Go has no classes; structs and interfaces are captured via
 * type_spec under @class.* so they surface in the symbol index. Methods carry
 * a receiver and use @method.* (extracted alongside functions). Visibility is
 * by identifier capitalization, so there is no export query.
 * Reuses the JS/TS capture names so the extraction layer is shared.
 */
const GO_FUNCTION_QUERY = `
(function_declaration
  name: (identifier) @function.name
  parameters: (parameter_list) @function.params) @function.declaration

(method_declaration
  name: (field_identifier) @method.name
  parameters: (parameter_list) @method.params) @method.declaration
`;

const GO_CLASS_QUERY = `
(type_declaration
  (type_spec
    name: (type_identifier) @class.name)) @class.declaration
`;

const GO_IMPORT_QUERY = `
(import_spec
  path: (interpreted_string_literal) @import.source)

; Every spec, single or grouped, interpreted or raw string, for the Batch 32a
; extraction contract (\`extractImports\`).
(import_spec) @import.statement
`;

/**
 * Exported package-level declarations (Batch 33, `publicSymbols`):
 * functions, types (defined and alias, struct and interface alike as
 * `type`), constants and variables, grouped or not. Methods belong to their
 * receiver type and are not listed. Every name is captured, and
 * `@export.visibility_upper` makes the decoder keep it only when it starts
 * with a Unicode upper-case letter, Go's export rule (review r1 R33-05: the
 * query language's regex predicate has no Unicode classes).
 */
const GO_EXPORT_QUERY = `
(source_file
  (function_declaration
    name: (identifier) @export.func_name @export.visibility_upper) @export.statement)
(source_file
  (type_declaration
    [(type_spec name: (type_identifier) @export.type_name @export.visibility_upper)
     (type_alias name: (type_identifier) @export.type_name @export.visibility_upper)]) @export.statement)
(source_file
  (const_declaration
    (const_spec name: (identifier) @export.var_name @export.visibility_upper)) @export.statement)
(source_file
  (var_declaration
    [(var_spec name: (identifier) @export.var_name @export.visibility_upper)
     (var_spec_list
       (var_spec name: (identifier) @export.var_name @export.visibility_upper))]) @export.statement)
`;

/**
 * Package edges through {@link GO_IMPORT_RESOLVER} (`go:package-edges`).
 * Not reference-complete: files of one package need no import to use each
 * other.
 */
const GO_GRAPH_EDGES: GraphEdgesCapability = {
  granularity: 'package',
  referenceScopeComplete: false,
};

/** The file's package; it covers the rest of the file. */
const GO_DECLARATION_QUERY = `
(package_clause
  (package_identifier) @declaration.name) @declaration.package.file
`;

/** Go's simple escapes in an interpreted string. */
const GO_SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  '\\': 0x5c,
  "'": 0x27,
  '"': 0x22,
};

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8');

/**
 * The value of a Go string literal (review r1 R33-09): a raw (backtick)
 * string as written; an interpreted one with its escapes decoded (`\xNN`
 * and octal `\NNN` are bytes, `\uXXXX` / `\UXXXXXXXX` code points, and
 * the simple escapes), the bytes read as UTF-8. A malformed escape keeps
 * the text as written, which then resolves to nothing.
 */
export function goStringValue(literal: string): string {
  const inner = literal.slice(1, -1);
  if (literal.startsWith('`') || !inner.includes('\\')) return inner;
  const bytes: number[] = [];
  let i = 0;
  while (i < inner.length) {
    const char = inner[i];
    if (char !== '\\') {
      const codePoint = inner.codePointAt(i) ?? 0;
      bytes.push(...UTF8.encode(String.fromCodePoint(codePoint)));
      i += codePoint > 0xffff ? 2 : 1;
      continue;
    }
    const kind = inner[i + 1] ?? '';
    const simple = GO_SIMPLE_ESCAPES[kind];
    if (simple !== undefined) {
      bytes.push(simple);
      i += 2;
      continue;
    }
    const width = kind === 'x' ? 2 : kind === 'u' ? 4 : kind === 'U' ? 8 : 0;
    if (width > 0) {
      const hex = inner.slice(i + 2, i + 2 + width);
      if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== width) return inner;
      const value = parseInt(hex, 16);
      if (kind === 'x') bytes.push(value);
      else if (value > 0x10ffff) return inner;
      else bytes.push(...UTF8.encode(String.fromCodePoint(value)));
      i += 2 + width;
      continue;
    }
    const octal = inner.slice(i + 1, i + 4);
    if (!/^[0-7]{3}$/.test(octal) || parseInt(octal, 8) > 0xff) return inner;
    bytes.push(parseInt(octal, 8));
    i += 4;
  }
  return UTF8_DECODER.decode(new Uint8Array(bytes));
}

/**
 * One import per spec. The path is the spec's last named child, quoted with
 * `"` (escapes decoded) or a backtick (raw string). A name before it binds
 * the package: `.` imports every exported name (`wildcard`), any other name,
 * `_` included, is an `alias`.
 */
function extractGoImport(spec: GenericAstNode): ExtractedImport[] {
  const parts = spec.children.filter((c) => c.isNamed && c.type !== 'comment');
  const path = parts[parts.length - 1];
  if (!path) return [];
  const source = goStringValue(path.text);
  const name = parts.length > 1 ? parts[0] : undefined;
  if (!name) return [{ source, kind: 'module' }];
  if (name.type === 'dot') {
    return [{ source, kind: 'wildcard', importedSymbols: ['*'] }];
  }
  return [{ source, kind: 'alias', alias: name.text }];
}

export const GO_LANGUAGE: LanguageModule = {
  id: 'go',
  extensions: ['.go'],
  recognitionOnlyExtensions: [],
  grammarFile: 'tree-sitter-go.wasm',
  queries: {
    functionQuery: GO_FUNCTION_QUERY,
    classQuery: GO_CLASS_QUERY,
    importQuery: GO_IMPORT_QUERY,
    exportQuery: GO_EXPORT_QUERY,
  },
  extraction: {
    extractImports: extractGoImport,
    // Go packages do not nest; the separator is never applied.
    declarations: { query: GO_DECLARATION_QUERY, scopeSeparator: '.' },
  },
  importResolver: GO_IMPORT_RESOLVER,
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: GO_GRAPH_EDGES,
    definitionFallback: true,
    syntaxDiagnostics: true,
  },
};
