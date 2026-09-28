/**
 * C# language module. C# has no export statements: its public symbols are
 * the `public` declarations `csharp-public-symbols.ts` decodes from
 * {@link CSHARP_EXPORT_QUERY}, and its dependency graph has namespace edges
 * through {@link CSHARP_IMPORT_RESOLVER} (Batch 34).
 */
import type { GenericAstNode } from '../ast.types';
import { CSHARP_IMPORT_RESOLVER } from '../import-resolution/csharp-import-resolver';
import type { GraphEdgesCapability } from '../language-registry';
import type { ExtractedImport, LanguageModule } from './types';

/**
 * C# queries. Node and field names were verified against the actual
 * `tree-sitter-c-sharp.wasm` grammar shipped by @vscode/tree-sitter-wasm 0.3.1
 * (a wrong node name produces zero captures and no error, so this must not be
 * written from memory).
 * Reuses the JS/TS capture names so the extraction layer is shared.
 *
 * Family assignment, and why:
 * - Type-bound members (`method_declaration`, `constructor_declaration`,
 *   `property_declaration`) use @method.*; free functions nested in a body
 *   (`local_function_statement`) use @function.*. Both land in
 *   `CodeInsights.functions` — the same split Go uses for methods vs functions.
 * - Properties have no parameter list, so they capture a name and a declaration
 *   only. `extractFunctionsFromMatches` treats params as optional.
 * - Every type-ish declaration (class/interface/struct/record/enum) uses
 *   @class.*, mirroring how Go maps structs and interfaces onto @class.*.
 * - Namespaces are also @class.*: they are the only other named container in
 *   the file and the extraction layer has no fifth family. This makes
 *   "which file declares namespace Acme.Billing" answerable from the symbol
 *   index, which is worth more than the small label inaccuracy.
 *
 * Deliberately NOT captured: destructors, operator/conversion declarations,
 * indexers, events, delegates and fields. They are rare enough that indexing
 * them costs more noise than the recall is worth; add them here (not in the
 * extraction layer) if that judgement turns out to be wrong.
 *
 * Known limitation: C# writes the type before the parameter name
 * (`(Guid id)`), and the shared `extractParamsFromText` splits on commas and
 * keeps the first token of each part. C# signatures therefore render their
 * parameter TYPES where JS/TS render names, and a generic argument list gets
 * split on its own comma (`Func<Invoice, T> selector` -> `Func<Invoice`, `T>`).
 * That is still useful in a signature summary, and fixing it would mean making
 * the shared extractor language-aware. Pinned by
 * `csharp-grammar.integration.spec.ts` so it stays a known cost.
 */
const CSHARP_FUNCTION_QUERY = `
; Methods (also interface members): public Task<T> Foo(int x) { }
(method_declaration
  name: (identifier) @method.name
  parameters: (parameter_list) @method.params) @method.declaration

; Constructors: public Invoice(ILogger logger) { }
(constructor_declaration
  name: (identifier) @method.name
  parameters: (parameter_list) @method.params) @method.declaration

; Properties, auto or expression-bodied: public int Count { get; set; }
(property_declaration
  name: (identifier) @method.name) @method.declaration

; Local functions declared inside a method body
(local_function_statement
  name: (identifier) @function.name
  parameters: (parameter_list) @function.params) @function.declaration
`;

/**
 * `record_declaration` covers `record`, `record class` and `record struct`.
 *
 * partial-class policy: ACCEPT one symbol entry per part, do not merge.
 * A partial type split across N files yields N @class.declaration matches, so
 * the symbol index gets N entries for one type. Merging them is not possible
 * at this layer without breaking a stronger invariant: the symbol sink keys
 * entries by absolute file path and invalidates them per file
 * (`deleteSymbolsForFile`), so a merged entry would be owned by one file while
 * describing another, and re-indexing either part would corrupt or drop it.
 * Multiple entries are also the more useful answer — each points at a real
 * declaration site with real line numbers, which is what "go to this type"
 * needs when the type is genuinely spread across files.
 */
const CSHARP_CLASS_QUERY = `
(class_declaration
  name: (identifier) @class.name) @class.declaration

(interface_declaration
  name: (identifier) @class.name) @class.declaration

(struct_declaration
  name: (identifier) @class.name) @class.declaration

(record_declaration
  name: (identifier) @class.name) @class.declaration

(enum_declaration
  name: (identifier) @class.name) @class.declaration

; Block-scoped: namespace Foo.Bar { ... }
(namespace_declaration
  name: (_) @class.name) @class.declaration

; File-scoped: namespace Foo.Bar;
(file_scoped_namespace_declaration
  name: (_) @class.name) @class.declaration
`;

/**
 * `using_directive` puts the imported name in an unnamed child, and uses the
 * `name` field for the ALIAS instead. The `!name` negation is therefore what
 * separates a plain/static using from an alias using — without it, an alias
 * directive reports the alias as a second, bogus import source.
 */
const CSHARP_IMPORT_QUERY = `
; using System;  /  using static System.Math;
(using_directive
  !name
  (identifier) @import.source)

; using System.Collections.Generic;  /  using static System.Math;
(using_directive
  !name
  (qualified_name) @import.source)

; using Alias = System.Text.StringBuilder;
(using_directive
  name: (identifier) @import.named
  (qualified_name) @import.source)

; using Alias = Widget;
(using_directive
  name: (identifier) @import.named
  (identifier) @import.source)

; Whole directives for the Batch 32a extraction contract (\`extractImports\`).
(using_directive) @import.statement
`;

/**
 * Public-symbol candidates (Batch 34): every type and every member
 * declaration, each with its name. Visibility depends on the enclosing
 * types, so `csharp-public-symbols.ts` decides it from the captured
 * declarations (their `modifier` children and their ranges), not here. A
 * field or event field declaring several names yields one match per name.
 */
const CSHARP_EXPORT_QUERY = `
(class_declaration name: (identifier) @export.cs_name) @export.cs_type
(struct_declaration name: (identifier) @export.cs_name) @export.cs_type
(record_declaration name: (identifier) @export.cs_name) @export.cs_type
(interface_declaration name: (identifier) @export.cs_name) @export.cs_type
(enum_declaration name: (identifier) @export.cs_name) @export.cs_type
(delegate_declaration name: (identifier) @export.cs_name) @export.cs_type

(method_declaration name: (identifier) @export.cs_name) @export.cs_member
(property_declaration name: (identifier) @export.cs_name) @export.cs_member
(event_declaration name: (identifier) @export.cs_name) @export.cs_member
(field_declaration
  (variable_declaration
    (variable_declarator name: (identifier) @export.cs_name))) @export.cs_member
(event_field_declaration
  (variable_declaration
    (variable_declarator name: (identifier) @export.cs_name))) @export.cs_member
`;

/**
 * Namespace edges through {@link CSHARP_IMPORT_RESOLVER}
 * (`csharp:namespace-edges`). Not reference-complete: files of one namespace
 * use each other with no `using`, and `ImplicitUsings`, extension methods and
 * reflection are not modelled.
 */
const CSHARP_GRAPH_EDGES: GraphEdgesCapability = {
  granularity: 'namespace',
  referenceScopeComplete: false,
};

/**
 * Block namespaces nest (their names concatenate with `.`); a file-scoped
 * `namespace N;` node ends at its `;`, so it is marked to cover the rest of
 * the file.
 */
const CSHARP_DECLARATION_QUERY = `
(namespace_declaration
  name: (_) @declaration.name) @declaration.namespace

(file_scoped_namespace_declaration
  name: (_) @declaration.name) @declaration.namespace.file
`;

/**
 * `global` and `static` are anonymous keyword children of the directive;
 * `=` separates an alias (before it) from the aliased name (after it).
 * Precedence follows `ImportKind`: `global using static N.T` is `global`,
 * and `isStatic` keeps the static trait (review r1 R32A-03).
 */
function extractCSharpImport(directive: GenericAstNode): ExtractedImport[] {
  const tokens = new Set(
    directive.children.filter((c) => !c.isNamed).map((c) => c.type),
  );
  const parts = directive.children.filter(
    (c) => c.isNamed && c.type !== 'comment',
  );
  const equals = directive.children.findIndex(
    (c) => !c.isNamed && c.type === '=',
  );
  const aliasNode =
    equals >= 0
      ? directive.children
          .slice(0, equals)
          .filter((c) => c.isNamed && c.type !== 'comment')
          .pop()
      : undefined;
  const target = parts[parts.length - 1];
  if (!target || target === aliasNode) return [];
  const kind = tokens.has('global')
    ? 'global'
    : tokens.has('static')
      ? 'static'
      : aliasNode
        ? 'alias'
        : 'module';
  return [
    {
      source: target.text,
      kind,
      ...(tokens.has('static') ? { isStatic: true as const } : {}),
      ...(aliasNode ? { alias: aliasNode.text } : {}),
    },
  ];
}

export const CSHARP_LANGUAGE: LanguageModule = {
  id: 'csharp',
  extensions: ['.cs', '.csx'],
  recognitionOnlyExtensions: [],
  grammarFile: 'tree-sitter-c-sharp.wasm',
  queries: {
    functionQuery: CSHARP_FUNCTION_QUERY,
    classQuery: CSHARP_CLASS_QUERY,
    importQuery: CSHARP_IMPORT_QUERY,
    exportQuery: CSHARP_EXPORT_QUERY,
  },
  extraction: {
    extractImports: extractCSharpImport,
    declarations: { query: CSHARP_DECLARATION_QUERY, scopeSeparator: '.' },
  },
  importResolver: CSHARP_IMPORT_RESOLVER,
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: CSHARP_GRAPH_EDGES,
    definitionFallback: true,
    syntaxDiagnostics: true,
  },
};
