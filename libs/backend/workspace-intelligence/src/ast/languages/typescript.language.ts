/**
 * TypeScript language module. `.tsx` has its own grammar (`tsx.language.ts`,
 * Batch 29b), which reuses these queries. Function, import and export queries
 * are JavaScript's (`javascript.language.ts`); TypeScript adds its own class
 * query and the TS-only export suffix.
 */
import type { LanguageModule } from './types';
import {
  FILE_EDGES,
  JS_TS_EXPORT_QUERY,
  JS_TS_FUNCTION_QUERY,
  JS_TS_IMPORT_QUERY,
} from './javascript.language';

/**
 * TypeScript class query — uses extends_clause which TS grammar adds on top of JS.
 */
const TS_CLASS_QUERY = `
; Class declarations: class Foo {}
(class_declaration
  name: (_) @class.name
  (class_heritage
    (extends_clause
      value: (_) @class.extends))?) @class.declaration

; Class expressions assigned to variables: const Foo = class {}
(lexical_declaration
  (variable_declarator
    name: (identifier) @class_expr.name
    value: (class
      (class_heritage
        (extends_clause
          value: (_) @class_expr.extends))?))) @class_expr.declaration
`;

/**
 * TypeScript-only export declarations, appended to JS_TS_EXPORT_QUERY for the
 * TypeScript entry only: interface, type alias, enum (incl. const enum),
 * abstract class, overload signature, namespace, every `export declare`,
 * `export =`, `export as namespace` and `export import`.
 */
const TS_EXPORT_QUERY_SUFFIX = `
(export_statement
  declaration: [
    (function_signature name: (_) @export.func_name)
    (abstract_class_declaration name: (_) @export.class_name)
    (interface_declaration name: (_) @export.interface_name)
    (type_alias_declaration name: (_) @export.type_name)
    (enum_declaration name: (_) @export.enum_name)
    (internal_module name: (_) @export.namespace_name)
  ]) @export.statement

; export declare ...
(export_statement
  declaration: (ambient_declaration [
    (function_signature name: (_) @export.func_name)
    (class_declaration name: (_) @export.class_name)
    (abstract_class_declaration name: (_) @export.class_name)
    (interface_declaration name: (_) @export.interface_name)
    (type_alias_declaration name: (_) @export.type_name)
    (enum_declaration name: (_) @export.enum_name)
    (internal_module name: (_) @export.namespace_name)
    (lexical_declaration (variable_declarator name: (identifier) @export.var_name))
    (variable_declaration (variable_declarator name: (identifier) @export.var_name))
  ])) @export.statement

; export = value
(export_statement
  "="
  (_) @export.assignment_value) @export.statement

; export as namespace GlobalName (UMD global)
(export_statement
  "as"
  "namespace"
  (_) @export.global_namespace_name)

; export import X = N.Y
(export_statement
  declaration: (import_alias
    (identifier) @export.import_alias_name
    [(nested_identifier) (identifier)] @export.import_alias_target)
  (#not-eq? @export.import_alias_target "require"))

; export import X = require(<module string>): this grammar ends the alias at "require" and
; parses ('m') as the next statement (with a MISSING ";", so the parse is
; reported as recovered); the pair is matched as siblings.
((export_statement
  declaration: (import_alias
    (identifier) @export.import_alias_name
    (identifier) @_require))
  .
  (expression_statement
    (parenthesized_expression (string) @export.import_alias_source))
  (#eq? @_require "require"))
`;

export const TYPESCRIPT_LANGUAGE: LanguageModule = {
  id: 'typescript',
  extensions: ['.ts'],
  recognitionOnlyExtensions: ['.mts', '.cts'],
  grammarFile: 'tree-sitter-typescript.wasm',
  queries: {
    functionQuery: JS_TS_FUNCTION_QUERY,
    classQuery: TS_CLASS_QUERY,
    importQuery: JS_TS_IMPORT_QUERY,
    exportQuery: JS_TS_EXPORT_QUERY + TS_EXPORT_QUERY_SUFFIX,
  },
  capabilities: {
    outline: true,
    enrichSummary: true,
    codeIndex: true,
    graphEdges: FILE_EDGES,
    definitionFallback: true,
    syntaxDiagnostics: false,
  },
};
