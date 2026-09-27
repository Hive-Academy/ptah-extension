/** Python language module. Python has no export statements: `exportQuery` is empty. */
import type { LanguageModule } from './types';

/**
 * Python queries. Methods are plain function_definition nodes inside a class
 * body, so they are captured as functions too — consistent with Python's model.
 * Reuses the JS/TS capture names so the extraction layer is shared.
 */
const PYTHON_FUNCTION_QUERY = `
(function_definition
  name: (identifier) @function.name
  parameters: (parameters) @function.params) @function.declaration
`;

const PYTHON_CLASS_QUERY = `
(class_definition
  name: (identifier) @class.name) @class.declaration
`;

const PYTHON_IMPORT_QUERY = `
; import x / import x.y
(import_statement
  name: (dotted_name) @import.source)

; import x as y
(import_statement
  name: (aliased_import
    name: (dotted_name) @import.source))

; from x import a, b
(import_from_statement
  module_name: (dotted_name) @import.source
  name: (dotted_name) @import.named)
`;

export const PYTHON_LANGUAGE: LanguageModule = {
  id: 'python',
  extensions: ['.py'],
  recognitionOnlyExtensions: ['.pyi', '.pyw'],
  grammarFile: 'tree-sitter-python.wasm',
  queries: {
    functionQuery: PYTHON_FUNCTION_QUERY,
    classQuery: PYTHON_CLASS_QUERY,
    importQuery: PYTHON_IMPORT_QUERY,
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
