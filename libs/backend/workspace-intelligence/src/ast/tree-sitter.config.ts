import { SupportedLanguage } from './ast.types';
export type { SupportedLanguage };

export const EXTENSION_LANGUAGE_MAP: Readonly<
  Record<string, SupportedLanguage>
> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.go': 'go',
};

export interface LanguageQueries {
  /** Query for function declarations, expressions, and arrow functions */
  functionQuery: string;
  /** Query for class declarations */
  classQuery: string;
  /** Query for import statements */
  importQuery: string;
  /** Query for export statements */
  exportQuery: string;
}

/**
 * JavaScript/TypeScript function query
 * Captures: function declarations, function expressions, arrow functions, methods
 */
const JS_TS_FUNCTION_QUERY = `
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
const JS_TS_IMPORT_QUERY = `
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
 * JavaScript/TypeScript export query
 * Captures: export statements including default and named exports
 */
const JS_TS_EXPORT_QUERY = `
; Default export: export default foo
(export_statement
  "default" @export.is_default
  value: (_) @export.value) @export.default_statement

; Named exports: export { foo, bar }
(export_statement
  (export_clause
    (export_specifier
      name: (identifier) @export.named))) @export.named_statement

; Export declarations: export function foo() {}
(export_statement
  declaration: (function_declaration
    name: (identifier) @export.func_name)) @export.func_declaration

; Export class: export class Foo {}
(export_statement
  declaration: (class_declaration
    name: (_) @export.class_name)) @export.class_declaration

; Export variable: export const foo = ...
(export_statement
  declaration: (lexical_declaration
    (variable_declarator
      name: (identifier) @export.var_name))) @export.var_declaration

; Re-exports: export { foo } from 'module'
(export_statement
  (export_clause
    (export_specifier
      name: (identifier) @reexport.name))
  source: (string) @reexport.source) @reexport.statement
`;

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

/**
 * Language-specific query configurations.
 * Function/import/export queries are shared across JS/TS. Class queries differ
 * because tree-sitter-typescript wraps the base class in an extends_clause node
 * that does not exist in tree-sitter-javascript. Python and Go have no export
 * statements, so their exportQuery is empty (skipped by analyzeSource).
 */
export const LANGUAGE_QUERIES_MAP: Readonly<
  Record<SupportedLanguage, LanguageQueries>
> = {
  javascript: {
    functionQuery: JS_TS_FUNCTION_QUERY,
    classQuery: JS_CLASS_QUERY,
    importQuery: JS_TS_IMPORT_QUERY,
    exportQuery: JS_TS_EXPORT_QUERY,
  },
  typescript: {
    functionQuery: JS_TS_FUNCTION_QUERY,
    classQuery: TS_CLASS_QUERY,
    importQuery: JS_TS_IMPORT_QUERY,
    exportQuery: JS_TS_EXPORT_QUERY,
  },
  python: {
    functionQuery: PYTHON_FUNCTION_QUERY,
    classQuery: PYTHON_CLASS_QUERY,
    importQuery: PYTHON_IMPORT_QUERY,
    exportQuery: '',
  },
  go: {
    functionQuery: GO_FUNCTION_QUERY,
    classQuery: GO_CLASS_QUERY,
    importQuery: GO_IMPORT_QUERY,
    exportQuery: '',
  },
};
