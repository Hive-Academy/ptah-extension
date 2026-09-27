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
import type { LanguageModule } from './types';

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
 * anonymous keyword; the import kind itself is Batch 32a's extraction
 * contract.
 */
const JAVA_IMPORT_QUERY = `
(import_declaration
  [(identifier) (scoped_identifier)] @import.source .)

(import_declaration
  [(identifier) (scoped_identifier)] @import.source
  (asterisk) @import.named)
`;

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
