/** Go language module. Visibility is by capitalisation: `exportQuery` is empty. */
import type { GenericAstNode } from '../ast.types';
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

/** The file's package; it covers the rest of the file. */
const GO_DECLARATION_QUERY = `
(package_clause
  (package_identifier) @declaration.name) @declaration.package.file
`;

/**
 * One import per spec. The path is the spec's last named child, quoted with
 * `"` or a backtick (raw string). A name before it binds the package: `.`
 * imports every exported name (`wildcard`), any other name, `_` included, is
 * an `alias`.
 */
function extractGoImport(spec: GenericAstNode): ExtractedImport[] {
  const parts = spec.children.filter((c) => c.isNamed && c.type !== 'comment');
  const path = parts[parts.length - 1];
  if (!path) return [];
  const source = path.text.slice(1, -1);
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
    exportQuery: '',
  },
  extraction: {
    extractImports: extractGoImport,
    // Go packages do not nest; the separator is never applied.
    declarations: { query: GO_DECLARATION_QUERY, scopeSeparator: '.' },
  },
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: null,
    definitionFallback: true,
    syntaxDiagnostics: true,
  },
};
