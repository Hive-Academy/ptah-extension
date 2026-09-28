/**
 * `CodeOutliner` adapter over the host's existing tree-sitter parser
 * (TASK_2026_559 Batch 2d, User Decision 7: code → tree-sitter outline, reuse
 * the existing parser services).
 *
 * It runs ONE `TreeSitterParserService.queryMulti` call — the service's cached
 * parser and preloaded grammars, one parse — and turns the captures into the
 * line spans the code reducer renders. It never builds text itself, so the
 * reducer's verbatim-lines contract cannot be broken here.
 *
 * Why not `ContextEnrichmentService.generateStructuralSummary` /
 * `AstAnalysisService.analyzeSource`: the summary is synthesised `.d.ts` text
 * (signatures re-printed from parameter names), not input lines, and the
 * insights drop the body positions an outline needs. Both sit on this same
 * `TreeSitterParserService`, so no second parser instance exists either way.
 *
 * Refuses (resolves `null`) when unsure: an unknown language, a parser that
 * errs or throws (a VS Code host without the WASM grammars fails
 * `initialize()`), or a parse containing an ERROR or MISSING node — error
 * recovery can stretch a body node over code that is not in it, and hiding
 * real declarations is worse than no outline. `.tsx` has its own grammar
 * (TypeScript plus JSX, Batch 29b) and `.jsx` parses with the JavaScript
 * grammar, which has JSX; JSX forced onto the TypeScript grammar still parses
 * with errors and is refused. Java and Rust have their own grammars since
 * Batch 30; PHP (HTML around `<?php` included), Ruby and C/C++ since Batch 31
 * (`.c`/`.h` parse with the C++ grammar, and C it cannot parse is refused).
 * Kotlin (`.kt`, `.kts`) since Batch 30k, with the vendored grammar. That
 * grammar needs error recovery for a class body whose last member shares the
 * closing brace's line (upstream issues #12, #13): when it only inserts its
 * zero-width hidden member separator, no ERROR or MISSING node is visible and
 * the spans are exact, so the file is outlined; when it builds an ERROR node
 * (a nested one-line body), the file is refused.
 *
 * Omittable spans hold only body content, so an omitted line never carries a
 * signature or other code:
 * - a brace-delimited body (and an arrow function's expression body) gives
 *   the rows strictly between its first and last rows. Such a row lies wholly
 *   inside the body node, so the signature row with `{` and the row with `}`
 *   (with anything sharing them) stay;
 * - a Python block has no closing delimiter: it gives its rows from the first
 *   row after the header's `:` to its own last row;
 * - a Ruby method body ends before its `end`: it gives its rows from the
 *   first row after the header (the parameters, or the name when there are
 *   none) to its own last row, and never the row of the method's `end` (a
 *   body sharing that row, `x; end`, keeps it).
 */
import * as path from 'node:path';
import type { Result } from '@ptah-extension/shared';
import {
  EXTENSION_LANGUAGE_MAP,
  cDeclaratorName,
  isCParsedAsCpp,
  type QueryCapture,
  type QueryMatch,
  type SupportedLanguage,
  type TreeSitterParserService,
} from '@ptah-extension/workspace-intelligence';
import type {
  CodeLineSpan,
  CodeOutline,
  CodeOutliner,
} from '@ptah-extension/tool-output-reducers';

/** Node types that only exist when the parse needed error recovery. */
const SYNTAX_ERROR_QUERY = '(ERROR) @error (MISSING) @missing';

interface OutlineQueries {
  /**
   * Captures `@body` for every function-like body (Python adds `@colon`;
   * Ruby adds `@colon` and the `@owner` whose `end` closes the body).
   */
  readonly bodies: string;
  /** Captures `@name` and `@decl` for every named declaration. */
  readonly declarations: string;
}

const JS_TS_BODIES = `
(function_declaration body: (_) @body)
(generator_function_declaration body: (_) @body)
(function_expression body: (_) @body)
(generator_function body: (_) @body)
(arrow_function body: (_) @body)
(method_definition body: (_) @body)
`;

const TS_OUTLINE_QUERIES: OutlineQueries = {
  bodies: JS_TS_BODIES,
  declarations: `
(function_declaration name: (_) @name) @decl
(generator_function_declaration name: (_) @name) @decl
(function_signature name: (_) @name) @decl
(class_declaration name: (_) @name) @decl
(abstract_class_declaration name: (_) @name) @decl
(interface_declaration name: (_) @name) @decl
(type_alias_declaration name: (_) @name) @decl
(enum_declaration name: (_) @name) @decl
(internal_module name: (_) @name) @decl
(method_definition name: (_) @name) @decl
(method_signature name: (_) @name) @decl
(abstract_method_signature name: (_) @name) @decl
(public_field_definition name: (_) @name) @decl
(variable_declarator name: (identifier) @name) @decl
`,
};

const CPP_TYPE_NAME = `[
    (type_identifier) @name
    (qualified_identifier name: (type_identifier) @name)
    (template_type name: (type_identifier) @name)
  ]`;

const CPP_OUTLINE_QUERIES: OutlineQueries = {
  bodies: `
(function_definition body: (compound_statement) @body)
(lambda_expression body: (compound_statement) @body)
`,
  // Definitions, prototypes and other declarations (a header declares, a
  // source file defines), types with a body, typedef names, namespaces and
  // macros. A declarator is captured whole and named by walking it
  // (`cDeclaratorName`), so no pointer, parenthesis or scope depth hides a
  // name (Batch 31 r1 R31-02).
  declarations: `
(function_definition declarator: (_) @declarator) @decl
(declaration declarator: (_) @declarator) @decl
(field_declaration declarator: (_) @declarator) @decl
(class_specifier name: ${CPP_TYPE_NAME} body: (_)) @decl
(struct_specifier name: ${CPP_TYPE_NAME} body: (_)) @decl
(union_specifier name: ${CPP_TYPE_NAME} body: (_)) @decl
(enum_specifier name: ${CPP_TYPE_NAME} body: (_)) @decl
(type_definition declarator: (type_identifier) @name) @decl
(alias_declaration name: (type_identifier) @name) @decl
(namespace_definition name: (namespace_identifier) @name) @decl
(preproc_def name: (identifier) @name) @decl
(preproc_function_def name: (identifier) @name) @decl
`,
};

/**
 * Per-grammar outline queries. Every node and field name was checked against
 * the grammars `TreeSitterParserService` loads (@vscode/tree-sitter-wasm, and
 * the vendored Kotlin grammar); a
 * name the grammar lacks makes `queryMulti` fail, and the spec compiles each
 * set against its real grammar. The TSX grammar is the TypeScript grammar
 * plus JSX, so it takes the TypeScript set unchanged. Java and Rust bodies
 * are all brace-delimited, so they take the brace rule.
 */
const OUTLINE_QUERIES: Readonly<Record<SupportedLanguage, OutlineQueries>> = {
  typescript: TS_OUTLINE_QUERIES,
  tsx: TS_OUTLINE_QUERIES,
  javascript: {
    bodies: JS_TS_BODIES,
    declarations: `
(function_declaration name: (_) @name) @decl
(generator_function_declaration name: (_) @name) @decl
(class_declaration name: (_) @name) @decl
(method_definition name: (_) @name) @decl
(field_definition property: (_) @name) @decl
(variable_declarator name: (identifier) @name) @decl
`,
  },
  python: {
    bodies: `(function_definition ":" @colon body: (block) @body)`,
    declarations: `
(function_definition name: (identifier) @name) @decl
(class_definition name: (identifier) @name) @decl
`,
  },
  go: {
    bodies: `
(function_declaration body: (block) @body)
(method_declaration body: (block) @body)
(func_literal body: (block) @body)
`,
    declarations: `
(function_declaration name: (identifier) @name) @decl
(method_declaration name: (field_identifier) @name) @decl
(type_spec name: (type_identifier) @name) @decl
`,
  },
  csharp: {
    bodies: `
(method_declaration body: (block) @body)
(constructor_declaration body: (block) @body)
(destructor_declaration body: (block) @body)
(operator_declaration body: (block) @body)
(conversion_operator_declaration body: (block) @body)
(local_function_statement body: (block) @body)
(accessor_declaration body: (block) @body)
(lambda_expression body: (block) @body)
`,
    declarations: `
(class_declaration name: (identifier) @name) @decl
(interface_declaration name: (identifier) @name) @decl
(struct_declaration name: (identifier) @name) @decl
(record_declaration name: (identifier) @name) @decl
(enum_declaration name: (identifier) @name) @decl
(method_declaration name: (identifier) @name) @decl
(constructor_declaration name: (identifier) @name) @decl
(property_declaration name: (identifier) @name) @decl
(local_function_statement name: (identifier) @name) @decl
`,
  },
  // Batch 30. A constructor body is a `constructor_body`, a compact record
  // constructor's a `block`; every one is brace-delimited.
  java: {
    bodies: `
(method_declaration body: (block) @body)
(constructor_declaration body: (constructor_body) @body)
(compact_constructor_declaration body: (block) @body)
(lambda_expression body: (block) @body)
(static_initializer (block) @body)
`,
    declarations: `
(class_declaration name: (identifier) @name) @decl
(interface_declaration name: (identifier) @name) @decl
(enum_declaration name: (identifier) @name) @decl
(record_declaration name: (identifier) @name) @decl
(annotation_type_declaration name: (identifier) @name) @decl
(method_declaration name: (identifier) @name) @decl
(constructor_declaration name: (identifier) @name) @decl
(compact_constructor_declaration name: (identifier) @name) @decl
(field_declaration declarator: (variable_declarator name: (identifier) @name)) @decl
`,
  },
  // Batch 30. An `impl` block is found under the last path segment of the
  // type it implements (generics and one reference stripped, as in the code
  // index's Rust query), so a focus on a struct also keeps its impl blocks,
  // qualified ones included (r1 R30-04).
  rust: {
    bodies: `
(function_item body: (block) @body)
(closure_expression body: (block) @body)
`,
    declarations: `
(function_item name: (identifier) @name) @decl
(function_signature_item name: (identifier) @name) @decl
(struct_item name: (type_identifier) @name) @decl
(enum_item name: (type_identifier) @name) @decl
(union_item name: (type_identifier) @name) @decl
(trait_item name: (type_identifier) @name) @decl
(type_item name: (type_identifier) @name) @decl
(impl_item
  type: [
    (type_identifier) @name
    (scoped_type_identifier name: (type_identifier) @name)
    (generic_type
      type: [
        (type_identifier) @name
        (scoped_type_identifier name: (type_identifier) @name)
      ])
    (reference_type
      type: [
        (type_identifier) @name
        (scoped_type_identifier name: (type_identifier) @name)
        (generic_type
          type: [
            (type_identifier) @name
            (scoped_type_identifier name: (type_identifier) @name)
          ])
      ])
  ]) @decl
(mod_item name: (identifier) @name) @decl
(const_item name: (identifier) @name) @decl
(static_item name: (identifier) @name) @decl
(macro_definition name: (identifier) @name) @decl
`,
  },
  // Batch 31. Bodies are brace-delimited; a body holding HTML between
  // `?>` and `<?php` is still body content. A property is found by its
  // name without the `$`.
  php: {
    bodies: `
(function_definition body: (compound_statement) @body)
(method_declaration body: (compound_statement) @body)
(anonymous_function body: (compound_statement) @body)
(arrow_function body: (_) @body)
`,
    declarations: `
(function_definition name: (name) @name) @decl
(method_declaration name: (name) @name) @decl
(class_declaration name: (name) @name) @decl
(interface_declaration name: (name) @name) @decl
(trait_declaration name: (name) @name) @decl
(enum_declaration name: (name) @name) @decl
(property_declaration (property_element name: (variable_name (name) @name))) @decl
(const_declaration (const_element (name) @name)) @decl
`,
  },
  // Batch 31. Ruby bodies have no opening delimiter and close with the
  // owner's `end` (see the file header). Only method bodies are omitted: a
  // block outside a method is often structure (`describe … do`,
  // `Struct.new … do` holding `def`s), and one inside a method is already in
  // its body. A class or module is found by the last segment of its name, as
  // in the code index.
  ruby: {
    bodies: `
(method name: (_) @colon !parameters body: (body_statement) @body) @owner
(method parameters: (method_parameters) @colon body: (body_statement) @body) @owner
(singleton_method name: (_) @colon !parameters body: (body_statement) @body) @owner
(singleton_method parameters: (method_parameters) @colon body: (body_statement) @body) @owner
`,
    declarations: `
(method name: (_) @name) @decl
(singleton_method name: (_) @name) @decl
(class name: [(constant) @name (scope_resolution name: (constant) @name)]) @decl
(module name: [(constant) @name (scope_resolution name: (constant) @name)]) @decl
(assignment left: (constant) @name) @decl
`,
  },
  cpp: CPP_OUTLINE_QUERIES,
  // Batch 30k (vendored grammar). A function body is a block or an `= expr`
  // expression body; both take the brace rule, so a one-row or two-row
  // expression body omits nothing. Lambdas are never omitted: outside a
  // function they are usually structure (a `.kts` build script's
  // `dependencies { … }`), and inside one they are already in its body.
  kotlin: {
    bodies: `
(function_declaration (function_body) @body)
(secondary_constructor (block) @body)
(anonymous_initializer (block) @body)
(getter (function_body) @body)
(setter (function_body) @body)
`,
    declarations: `
(function_declaration name: (identifier) @name) @decl
(class_declaration name: (identifier) @name) @decl
(object_declaration name: (identifier) @name) @decl
(companion_object name: (identifier) @name) @decl
(type_alias type: (identifier) @name) @decl
(property_declaration (variable_declaration (identifier) @name)) @decl
`,
  },
};

/** The one parser-service method this adapter needs. */
export type OutlineQueryRunner = Pick<TreeSitterParserService, 'queryMulti'>;

export class TreeSitterCodeOutliner implements CodeOutliner {
  constructor(private readonly parser: OutlineQueryRunner) {}

  async outline(
    source: string,
    language: string,
    focusSymbol?: string,
  ): Promise<CodeOutline | null> {
    const grammar = resolveLanguage(language);
    if (grammar === undefined) {
      return null;
    }
    const queries = OUTLINE_QUERIES[grammar];
    const entries = [
      { key: 'errors', queryString: SYNTAX_ERROR_QUERY },
      { key: 'bodies', queryString: queries.bodies },
    ];
    if (focusSymbol !== undefined) {
      entries.push({ key: 'declarations', queryString: queries.declarations });
    }

    let result: Result<Map<string, QueryMatch[]>, Error>;
    try {
      result = await this.parser.queryMulti(source, grammar, entries);
    } catch {
      // degradation-audit: optional-capability — the outline is optional:
      // `null` makes the code reducer keep its plain cut. The parser service
      // logs its own failures; `initialize()` can reject outright on a host
      // without the WASM grammars. No outline, no throw.
      return null;
    }
    if (result.isErr() || result.value === undefined) {
      return null;
    }
    const matches = result.value;
    if ((matches.get('errors') ?? []).length > 0) {
      return null;
    }
    return {
      ...(isCHint(language) ? { approximations: ['c:parsed-as-cpp'] } : {}),
      omittable: (matches.get('bodies') ?? []).flatMap((match) =>
        bodySpan(match),
      ),
      focus:
        focusSymbol === undefined
          ? []
          : (matches.get('declarations') ?? []).flatMap((match) =>
              declarationSpan(match, focusSymbol),
            ),
    };
  }
}

/**
 * Whether the hint names C (`c`, `.h`, `src/a.c`): C is outlined with the
 * C++ grammar, and the outline says so (User Decision 19; Batch 31 r1
 * R31-01). A C++ hint (`cpp`, `.hpp`) does not.
 */
function isCHint(hint: string): boolean {
  const key = hint.trim().toLowerCase();
  // A bare extension (`.c`) or id (`c`) is given a base name first.
  const file = key.startsWith('.')
    ? `x${key}`
    : key.includes('.')
      ? key
      : `x.${key}`;
  return isCParsedAsCpp(file);
}

/**
 * A language id (`typescript`) or a file extension or path (`.ts`, `ts`,
 * `src/a.ts`), resolved through the shared `EXTENSION_LANGUAGE_MAP`.
 */
function resolveLanguage(hint: string): SupportedLanguage | undefined {
  const key = hint.trim().toLowerCase();
  if (Object.hasOwn(OUTLINE_QUERIES, key)) {
    return key as SupportedLanguage;
  }
  // `path.extname('.ts')` is '' (a dotfile name), so a bare extension is used as is.
  const extension = key.startsWith('.')
    ? key
    : key.includes('.')
      ? path.extname(key)
      : `.${key}`;
  return Object.hasOwn(EXTENSION_LANGUAGE_MAP, extension)
    ? EXTENSION_LANGUAGE_MAP[extension]
    : undefined;
}

function capture(match: QueryMatch, name: string): QueryCapture | undefined {
  return match.captures.find((c) => c.name === name);
}

/** Last row that holds any of the node's text (a node can end at column 0 of the next row). */
function lastRow(node: QueryCapture): number {
  const { row, column } = node.endPosition;
  return column === 0 && row > node.startPosition.row ? row - 1 : row;
}

/** The rows of one body that hold nothing but body content (see the file header). */
function bodySpan(match: QueryMatch): CodeLineSpan[] {
  const body = capture(match, 'body');
  if (body === undefined) {
    return [];
  }
  const colon = capture(match, 'colon');
  const owner = capture(match, 'owner');
  const startLine =
    colon === undefined
      ? body.startPosition.row + 1
      : Math.max(body.startPosition.row, colon.endPosition.row + 1);
  const bodyEnd =
    colon === undefined ? body.endPosition.row - 1 : lastRow(body);
  // The owner's closing `end` stays, with anything sharing its row.
  const endLine =
    owner === undefined ? bodyEnd : Math.min(bodyEnd, lastRow(owner) - 1);
  return startLine <= endLine ? [{ startLine, endLine }] : [];
}

/** A match's declared name: its `@name`, or its walked C/C++ `@declarator`. */
function declaredName(match: QueryMatch): string | undefined {
  const name = capture(match, 'name');
  if (name !== undefined) return name.text;
  const declarator = capture(match, 'declarator');
  return declarator === undefined
    ? undefined
    : cDeclaratorName(declarator.node)?.name;
}

/** The full row span of a declaration named `focusSymbol`, if this match is one. */
function declarationSpan(
  match: QueryMatch,
  focusSymbol: string,
): CodeLineSpan[] {
  const declaration = capture(match, 'decl');
  if (declaredName(match) !== focusSymbol || declaration === undefined) {
    return [];
  }
  return [
    { startLine: declaration.startPosition.row, endLine: lastRow(declaration) },
  ];
}
