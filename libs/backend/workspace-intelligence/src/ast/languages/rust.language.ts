/**
 * Rust language module (Batch 30). `.rs` parses with the shipped
 * `tree-sitter-rust.wasm` (@vscode/tree-sitter-wasm 0.3.1). Every node and
 * field name below is proven against that grammar by
 * `java-rust-grammar.integration.spec.ts`.
 *
 * `exportQuery` is empty: `pub` item extraction and module-graph edges
 * (`publicSymbols`, `graphEdges`) belong to Batch 35, so this module claims
 * neither.
 */
import type { LanguageModule } from './types';

/**
 * Every `fn` with a body, free or inside an `impl`/`trait` block. Bodiless
 * trait signatures (`function_signature_item`) are not indexed, as the plan's
 * query table lists only `function_item`.
 */
const RUST_FUNCTION_QUERY = `
(function_item
  name: (identifier) @function.name
  parameters: (parameters) @function.params) @function.declaration
`;

/**
 * Structs, enums and traits by name. An `impl` block has no name of its own:
 * it is indexed under the last segment of the type it implements, with the
 * path, generic arguments and one reference stripped (`impl Draw for Shape`,
 * `impl<T> Point<T>`, `impl nested::Foo`, `impl<T> Tr for path::Type<T>`,
 * `impl Tr for &'a mut m::Baz<'a>` give `Shape`, `Point`, `Foo`, `Type`,
 * `Baz`), so a search for a type finds its impl blocks too (Batch 30 r1
 * R30-04). Array, tuple, slice and `dyn` self types name no single type and
 * are not indexed as impl blocks; their functions still are.
 */
const RUST_CLASS_QUERY = `
(struct_item
  name: (type_identifier) @class.name) @class.declaration

(enum_item
  name: (type_identifier) @class.name) @class.declaration

(trait_item
  name: (type_identifier) @class.name) @class.declaration

(impl_item
  type: [
    (type_identifier) @class.name
    (scoped_type_identifier name: (type_identifier) @class.name)
    (generic_type
      type: [
        (type_identifier) @class.name
        (scoped_type_identifier name: (type_identifier) @class.name)
      ])
    (reference_type
      type: [
        (type_identifier) @class.name
        (scoped_type_identifier name: (type_identifier) @class.name)
        (generic_type
          type: [
            (type_identifier) @class.name
            (scoped_type_identifier name: (type_identifier) @class.name)
          ])
      ])
  ]) @class.declaration
`;

/**
 * `use` trees are reported whole (`std::collections::{HashMap, HashSet}`);
 * an alias (`use a::b as c`) reports its path with the alias as the imported
 * name. `mod x;` (a module declared in another file) and `extern crate x;`
 * report the module or crate name. Splitting grouped trees and resolving
 * `crate::`/`self::`/`super::` is Batch 32a/35's work.
 */
const RUST_IMPORT_QUERY = `
(use_declaration
  argument: [
    (identifier)
    (scoped_identifier)
    (scoped_use_list)
    (use_list)
    (use_wildcard)
    (crate)
    (self)
    (super)
  ] @import.source)

(use_declaration
  argument: (use_as_clause
    path: (_) @import.source
    alias: (identifier) @import.named))

(mod_item
  !body
  name: (identifier) @import.source)

(extern_crate_declaration
  name: (identifier) @import.source)
`;

export const RUST_LANGUAGE: LanguageModule = {
  id: 'rust',
  extensions: ['.rs'],
  recognitionOnlyExtensions: [],
  grammarFile: 'tree-sitter-rust.wasm',
  queries: {
    functionQuery: RUST_FUNCTION_QUERY,
    classQuery: RUST_CLASS_QUERY,
    importQuery: RUST_IMPORT_QUERY,
    exportQuery: '',
  },
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: null,
    // The Electron index-free declaration scan has no Rust query.
    definitionFallback: false,
    syntaxDiagnostics: true,
  },
};
