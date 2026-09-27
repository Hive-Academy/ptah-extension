/**
 * PHP language module (Batch 31). `.php` and `.phtml` parse with the shipped
 * `tree-sitter-php.wasm` (@vscode/tree-sitter-wasm 0.3.1), which is the
 * PHP-in-HTML grammar: text outside `<?php … ?>` is a `text` node, so a
 * template that mixes HTML and PHP parses cleanly and its declarations are
 * still found. Every node and field name below is proven against that
 * grammar by `php-ruby-cpp-grammar.integration.spec.ts`.
 *
 * `exportQuery` is empty: top-level declaration extraction and include
 * edges (`publicSymbols`, `graphEdges`) belong to Batch 36, so this module
 * claims neither.
 */
import type { LanguageModule } from './types';

/** Free functions are `@function.*`; class, trait, interface and enum members are `@method.*`. */
const PHP_FUNCTION_QUERY = `
(function_definition
  name: (name) @function.name
  parameters: (formal_parameters) @function.params) @function.declaration

(method_declaration
  name: (name) @method.name
  parameters: (formal_parameters) @method.params) @method.declaration
`;

const PHP_CLASS_QUERY = `
(class_declaration
  name: (name) @class.name) @class.declaration

(interface_declaration
  name: (name) @class.name) @class.declaration

(trait_declaration
  name: (name) @class.name) @class.declaration

(enum_declaration
  name: (name) @class.name) @class.declaration
`;

/**
 * A literal include argument: one `string_content` and nothing else, so an
 * interpolated (`"$dir/x.php"`) or computed (`__DIR__ . '/x.php'`) path is
 * not reported as a file it is not. The parenthesised call form is the same
 * expression.
 */
const LITERAL_PATH = `[
    (string . (string_content) @import.source .)
    (encapsed_string . (string_content) @import.source .)
    (parenthesized_expression [
      (string . (string_content) @import.source .)
      (encapsed_string . (string_content) @import.source .)
    ])
  ]`;

const INCLUDE_EXPRESSIONS = [
  'require_expression',
  'require_once_expression',
  'include_expression',
  'include_once_expression',
];

/**
 * `use` clauses report the used name; an alias (`use A\B as C`) is the
 * imported name. A group (`use A\{B, C as D}`) reports its prefix, with each
 * member (or its alias) as the imported name. Include and require
 * expressions report a literal path.
 */
const PHP_IMPORT_QUERY = `
(namespace_use_declaration
  (namespace_use_clause
    [(qualified_name) (name)] @import.source
    !alias))

(namespace_use_declaration
  (namespace_use_clause
    [(qualified_name) (name)] @import.source
    alias: (name) @import.named))

(namespace_use_declaration
  (namespace_name) @import.source
  body: (namespace_use_group
    (namespace_use_clause (name) @import.named !alias)))

(namespace_use_declaration
  (namespace_name) @import.source
  body: (namespace_use_group
    (namespace_use_clause alias: (name) @import.named)))

${INCLUDE_EXPRESSIONS.map((node) => `(${node} ${LITERAL_PATH})`).join('\n\n')}
`;

export const PHP_LANGUAGE: LanguageModule = {
  id: 'php',
  extensions: ['.php', '.phtml'],
  recognitionOnlyExtensions: [],
  grammarFile: 'tree-sitter-php.wasm',
  queries: {
    functionQuery: PHP_FUNCTION_QUERY,
    classQuery: PHP_CLASS_QUERY,
    importQuery: PHP_IMPORT_QUERY,
    exportQuery: '',
  },
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: null,
    // The Electron index-free declaration scan has no PHP query.
    definitionFallback: false,
    syntaxDiagnostics: true,
  },
};
