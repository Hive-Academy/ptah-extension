/**
 * Ruby language module (Batch 31). `.rb` and `.rake` parse with the shipped
 * `tree-sitter-ruby.wasm` (@vscode/tree-sitter-wasm 0.3.1). Every node and
 * field name below is proven against that grammar by
 * `php-ruby-cpp-grammar.integration.spec.ts`.
 *
 * `exportQuery` is empty: top-level class/module extraction and `require`
 * edges (`publicSymbols`, `graphEdges`) belong to Batch 36, so this module
 * claims neither.
 */
import type { LanguageModule } from './types';

/**
 * Instance methods (endless `def x = …` included) and singleton methods
 * (`def self.x`). A method is type-bound, so it is `@method.*`; the
 * parameter list is optional (`def name` has none).
 */
const RUBY_FUNCTION_QUERY = `
(method
  name: (_) @method.name
  parameters: (method_parameters)? @method.params) @method.declaration

(singleton_method
  name: (_) @method.name
  parameters: (method_parameters)? @method.params) @method.declaration
`;

/**
 * Classes and modules by the last segment of their name, so `class
 * Admin::User` is indexed as `User` (the Rust impl precedent). A reopened
 * class is one row per `class` statement.
 */
const RUBY_CLASS_QUERY = `
(class
  name: [
    (constant) @class.name
    (scope_resolution name: (constant) @class.name)
  ]) @class.declaration

(module
  name: [
    (constant) @class.name
    (scope_resolution name: (constant) @class.name)
  ]) @class.declaration
`;

/**
 * A receiver-less `require` or `require_relative` call whose only argument
 * is a literal string with no interpolation: a computed path (`require
 * File.join(…)`, `"#{dir}/x"`) is not reported as a file it is not.
 */
const RUBY_IMPORT_QUERY = `
(call
  !receiver
  method: (identifier) @import.callee
  arguments: (argument_list . (string . (string_content) @import.source .) .)
  (#match? @import.callee "^(require|require_relative)$"))
`;

export const RUBY_LANGUAGE: LanguageModule = {
  id: 'ruby',
  extensions: ['.rb', '.rake'],
  recognitionOnlyExtensions: [],
  grammarFile: 'tree-sitter-ruby.wasm',
  queries: {
    functionQuery: RUBY_FUNCTION_QUERY,
    classQuery: RUBY_CLASS_QUERY,
    importQuery: RUBY_IMPORT_QUERY,
    exportQuery: '',
  },
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: null,
    // The Electron index-free declaration scan has no Ruby query.
    definitionFallback: false,
    syntaxDiagnostics: true,
  },
};
