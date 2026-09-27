/** Go language module. Visibility is by capitalisation: `exportQuery` is empty. */
import type { LanguageModule } from './types';

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
`;

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
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: null,
    definitionFallback: true,
    syntaxDiagnostics: true,
  },
};
