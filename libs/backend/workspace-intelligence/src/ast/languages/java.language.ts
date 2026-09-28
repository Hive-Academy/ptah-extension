/**
 * Java language module (Batch 30). `.java` parses with the shipped
 * `tree-sitter-java.wasm` (@vscode/tree-sitter-wasm 0.3.1). Every node and
 * field name below is proven against that grammar by
 * `java-rust-grammar.integration.spec.ts` (a wrong name gives zero captures
 * and no error, so it must not be written from memory).
 *
 * `exportQuery` is empty: public-declaration extraction and graph edges
 * (`publicSymbols`, `graphEdges`) belong to Batch 34, so this module claims
 * neither.
 */
import type { GenericAstNode } from '../ast.types';
import type { ExtractedImport, LanguageModule } from './types';

/**
 * Methods (interface members included), constructors and record compact
 * constructors are type-bound, so they use @method.* (the C# split). A
 * compact constructor has no parameter list; the extractor treats params as
 * optional.
 */
const JAVA_FUNCTION_QUERY = `
(method_declaration
  name: (identifier) @method.name
  parameters: (formal_parameters) @method.params) @method.declaration

(constructor_declaration
  name: (identifier) @method.name
  parameters: (formal_parameters) @method.params) @method.declaration

(compact_constructor_declaration
  name: (identifier) @method.name) @method.declaration
`;

const JAVA_CLASS_QUERY = `
(class_declaration
  name: (identifier) @class.name) @class.declaration

(interface_declaration
  name: (identifier) @class.name) @class.declaration

(enum_declaration
  name: (identifier) @class.name) @class.declaration

(record_declaration
  name: (identifier) @class.name) @class.declaration

(annotation_type_declaration
  name: (identifier) @class.name) @class.declaration
`;

/**
 * The imported name is an unnamed child of `import_declaration`. A
 * single-type or static import ends with that name (the `.` anchor: it is
 * the last named child); an on-demand import ends with `asterisk`, reported
 * as the package with the imported symbol `*`. The static flag is an
 * anonymous keyword, read by `extractJavaImport` (Batch 32a).
 */
const JAVA_IMPORT_QUERY = `
(import_declaration
  [(identifier) (scoped_identifier)] @import.source .)

(import_declaration
  [(identifier) (scoped_identifier)] @import.source
  (asterisk) @import.named)

; Whole declarations for the Batch 32a extraction contract (\`extractImports\`).
(import_declaration) @import.statement
`;

/** The file's package; it covers the rest of the file. */
const JAVA_DECLARATION_QUERY = `
(package_declaration
  [(identifier) (scoped_identifier)] @declaration.name) @declaration.package.file
`;

/**
 * `static` is an anonymous keyword child; an on-demand import ends with an
 * `asterisk` child and reports its container with `importedSymbols: ['*']`.
 * A nested type (`a.b.C.D`) stays one path: the resolver (Batch 34) maps it
 * to `C`'s file. `import static a.b.C.*` is `static` (precedence).
 */
function extractJavaImport(declaration: GenericAstNode): ExtractedImport[] {
  const target = declaration.children.find(
    (c) => c.type === 'scoped_identifier' || c.type === 'identifier',
  );
  if (!target) return [];
  const isStatic = declaration.children.some(
    (c) => !c.isNamed && c.type === 'static',
  );
  const onDemand = declaration.children.some((c) => c.type === 'asterisk');
  return [
    {
      source: target.text,
      kind: isStatic ? 'static' : onDemand ? 'wildcard' : 'module',
      ...(isStatic ? { isStatic: true as const } : {}),
      ...(onDemand ? { importedSymbols: ['*'] } : {}),
    },
  ];
}

export const JAVA_LANGUAGE: LanguageModule = {
  id: 'java',
  extensions: ['.java'],
  recognitionOnlyExtensions: [],
  grammarFile: 'tree-sitter-java.wasm',
  queries: {
    functionQuery: JAVA_FUNCTION_QUERY,
    classQuery: JAVA_CLASS_QUERY,
    importQuery: JAVA_IMPORT_QUERY,
    exportQuery: '',
  },
  extraction: {
    extractImports: extractJavaImport,
    // Java packages do not nest in a file; the separator is never applied.
    declarations: { query: JAVA_DECLARATION_QUERY, scopeSeparator: '.' },
  },
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: null,
    // The Electron index-free declaration scan has no Java query.
    definitionFallback: false,
    syntaxDiagnostics: true,
  },
};
