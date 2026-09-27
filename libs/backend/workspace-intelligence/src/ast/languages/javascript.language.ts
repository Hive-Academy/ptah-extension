/**
 * JavaScript language module: extensions, grammar, queries and the
 * capabilities implemented outside the parser. The function, import and export
 * queries are shared with TypeScript (`typescript.language.ts` imports them);
 * only the class query differs (see `JS_CLASS_QUERY`).
 */
import type { LanguageModule } from './types';
import type { GraphEdgesCapability } from '../language-registry';

/**
 * JavaScript/TypeScript function query
 * Captures: function declarations, function expressions, arrow functions, methods
 */
export const JS_TS_FUNCTION_QUERY = `
; Function declarations: function foo() {}
(function_declaration
  name: (identifier) @function.name
  parameters: (formal_parameters) @function.params) @function.declaration

; Generator function declarations: function* foo() {}
(generator_function_declaration
  name: (identifier) @generator.name
  parameters: (formal_parameters) @generator.params) @generator.declaration

; Arrow functions assigned to variables: const foo = () => {}
(lexical_declaration
  (variable_declarator
    name: (identifier) @arrow.name
    value: (arrow_function
      parameters: (formal_parameters)? @arrow.params))) @arrow.declaration

; Arrow functions in variable declarations: var/let foo = () => {}
(variable_declaration
  (variable_declarator
    name: (identifier) @arrow_var.name
    value: (arrow_function
      parameters: (formal_parameters)? @arrow_var.params))) @arrow_var.declaration

; Method definitions in classes/objects
(method_definition
  name: (property_identifier) @method.name
  parameters: (formal_parameters) @method.params) @method.declaration
`;

/**
 * JavaScript class query — class_heritage directly contains the base expression;
 * the extends_clause wrapper node only exists in the TypeScript grammar.
 */
const JS_CLASS_QUERY = `
; Class declarations: class Foo {}
(class_declaration
  name: (_) @class.name
  (class_heritage
    (_) @class.extends)?) @class.declaration

; Class expressions assigned to variables: const Foo = class {}
(lexical_declaration
  (variable_declarator
    name: (identifier) @class_expr.name
    value: (class
      (class_heritage
        (_) @class_expr.extends)?))) @class_expr.declaration
`;

/**
 * JavaScript/TypeScript import query
 * Captures: import statements with default, named, and namespace imports
 */
export const JS_TS_IMPORT_QUERY = `
; Default imports: import Foo from 'module'
(import_statement
  (import_clause
    (identifier) @import.default)
  source: (string) @import.source) @import.default_statement

; Named imports: import { Foo, Bar } from 'module'
(import_statement
  (import_clause
    (named_imports
      (import_specifier
        name: (identifier) @import.named)))
  source: (string) @import.source) @import.named_statement

; Namespace imports: import * as Foo from 'module'
(import_statement
  (import_clause
    (namespace_import
      (identifier) @import.namespace))
  source: (string) @import.source) @import.namespace_statement

; Side-effect imports: import 'module'
(import_statement
  source: (string) @import.source) @import.side_effect
`;

/**
 * JavaScript/TypeScript export query, decoded by `extractExportsFromMatches`
 * (`export-extraction.ts`), which documents every capture name.
 * Every declaration pattern also captures its whole statement as
 * `@export.statement`: the decoder reads the `default` keyword and the
 * re-export source from that node's children, so one pattern per form is
 * enough and a re-exported specifier is never matched twice.
 * Only node types present in BOTH grammars appear here; TypeScript-only
 * declarations live in TS_EXPORT_QUERY_SUFFIX (the JavaScript grammar rejects
 * a query naming a node type it does not have).
 */
export const JS_TS_EXPORT_QUERY = `
; export function f() {} / export function* g() {} / export default function f() {}
(export_statement
  declaration: [
    (function_declaration name: (_) @export.func_name)
    (generator_function_declaration name: (_) @export.func_name)
  ]) @export.statement

; export class C {} / export default class C {}
(export_statement
  declaration: (class_declaration name: (_) @export.class_name)) @export.statement

; export const a = 1 / export let b / export var c
(export_statement
  declaration: [
    (lexical_declaration (variable_declarator name: (identifier) @export.var_name))
    (variable_declaration (variable_declarator name: (identifier) @export.var_name))
  ]) @export.statement

; export const { a, b: c } = o / export const [x, y] = arr: the pattern's range
(export_statement
  declaration: [
    (lexical_declaration
      (variable_declarator name: [(object_pattern) (array_pattern)] @export.binding_pattern))
    (variable_declaration
      (variable_declarator name: [(object_pattern) (array_pattern)] @export.binding_pattern))
  ])

; Binding names inside any destructuring pattern, at any depth. The decoder keeps
; only those inside an exported @export.binding_pattern range.
(object_pattern (shorthand_property_identifier_pattern) @export.binding)
(object_assignment_pattern left: (shorthand_property_identifier_pattern) @export.binding)
(pair_pattern value: (identifier) @export.binding)
(pair_pattern value: (assignment_pattern left: (identifier) @export.binding))
(array_pattern (identifier) @export.binding)
(array_pattern (assignment_pattern left: (identifier) @export.binding))
(rest_pattern (identifier) @export.binding)

; export default <expression>: anonymous function/class, identifier, literal
(export_statement
  "default"
  value: (_) @export.default_value) @export.statement

; export { a, b as c } and the re-export form with a source module
(export_statement
  (export_clause (export_specifier) @export.specifier)) @export.statement

; export * as ns (always has a source module)
(export_statement
  (namespace_export (_) @export.namespace_name)
  source: (string) @export.source)

; export * (plain wildcard re-export)
(export_statement
  "*"
  source: (string) @export.wildcard_source)

; CommonJS: module.exports = value
(assignment_expression
  left: (member_expression
    object: (identifier) @_module
    property: (property_identifier) @_exports) @export.commonjs_target
  right: (_) @export.commonjs_value
  (#eq? @_module "module")
  (#eq? @_exports "exports"))

; CommonJS: module[<key>] = value. The decoder reads the WHOLE key: only a
; constant that evaluates to "exports" is the export object.
(assignment_expression
  left: (subscript_expression
    object: (identifier) @_module
    index: (_) @export.module_key) @export.commonjs_target
  right: (_) @export.commonjs_value
  (#eq? @_module "module"))

; CommonJS: exports.name = value / exports["name"] = value
(assignment_expression
  left: [
    (member_expression
      object: (identifier) @_exports
      property: (property_identifier) @export.commonjs_name)
    (subscript_expression
      object: (identifier) @_exports
      index: (string) @export.commonjs_name)
  ] @export.commonjs_target
  right: (_) @export.commonjs_value
  (#eq? @_exports "exports"))

; CommonJS: module.exports.name = value / module.exports["name"] = value
(assignment_expression
  left: [
    (member_expression
      object: (member_expression
        object: (identifier) @_module
        property: (property_identifier) @_exports)
      property: (property_identifier) @export.commonjs_name)
    (subscript_expression
      object: (member_expression
        object: (identifier) @_module
        property: (property_identifier) @_exports)
      index: (string) @export.commonjs_name)
  ] @export.commonjs_target
  right: (_) @export.commonjs_value
  (#eq? @_module "module")
  (#eq? @_exports "exports"))

; CommonJS: module[<key>].name = value / module[<key>]["name"] = value
(assignment_expression
  left: [
    (member_expression
      object: (subscript_expression
        object: (identifier) @_module
        index: (_) @export.module_key)
      property: (property_identifier) @export.commonjs_name)
    (subscript_expression
      object: (subscript_expression
        object: (identifier) @_module
        index: (_) @export.module_key)
      index: (string) @export.commonjs_name)
  ] @export.commonjs_target
  right: (_) @export.commonjs_value
  (#eq? @_module "module"))

; CommonJS: Object.defineProperty(exports, "name", ...)
(call_expression
  function: (member_expression
    object: (identifier) @_object
    property: (property_identifier) @_define)
  arguments: (arguments
    .
    (identifier) @_exports
    .
    (string) @export.commonjs_defined_name)
  (#eq? @_object "Object")
  (#eq? @_define "defineProperty")
  (#eq? @_exports "exports")) @export.commonjs_target

; Every other mention of exports / module.exports / module[<key>]. The
; decoder reports those outside a decoded CommonJS form as unextracted, so the
; answer is never a clean empty list for a module whose exports it could not read.
((identifier) @export.commonjs_reference
  (#eq? @export.commonjs_reference "exports"))
((member_expression
  object: (identifier) @_module
  property: (property_identifier) @_exports) @export.commonjs_reference
  (#eq? @_module "module")
  (#eq? @_exports "exports"))
; module[<key>]: the decoder keeps it unless the key is a constant other
; than "exports".
((subscript_expression
  object: (identifier) @_module
  index: (_) @export.module_reference_key) @export.module_reference
  (#eq? @_module "module"))
`;

/**
 * TS/JS edges are drawn from `import` statements only, so graph dependents do
 * NOT bound where a declaration can be referenced: a global script, a
 * re-export (`export { X } from`), `require`, dynamic `import()` and a path
 * alias the build did not map all reach it without an edge (Batch 26b review
 * r1 B2). Claim `referenceScopeComplete` only once the resolver models every
 * one of them (Batch 32b+).
 */
export const FILE_EDGES: GraphEdgesCapability = {
  granularity: 'file',
  referenceScopeComplete: false,
};

export const JAVASCRIPT_LANGUAGE: LanguageModule = {
  id: 'javascript',
  extensions: ['.js', '.jsx'],
  recognitionOnlyExtensions: ['.mjs', '.cjs'],
  grammarFile: 'tree-sitter-javascript.wasm',
  queries: {
    functionQuery: JS_TS_FUNCTION_QUERY,
    classQuery: JS_CLASS_QUERY,
    importQuery: JS_TS_IMPORT_QUERY,
    exportQuery: JS_TS_EXPORT_QUERY,
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
