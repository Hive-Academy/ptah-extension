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
 * with errors and is refused.
 *
 * Omittable spans hold only body content, so an omitted line never carries a
 * signature or other code:
 * - a brace-delimited body (and an arrow function's expression body) gives
 *   the rows strictly between its first and last rows. Such a row lies wholly
 *   inside the body node, so the signature row with `{` and the row with `}`
 *   (with anything sharing them) stay;
 * - a Python block has no closing delimiter: it gives its rows from the first
 *   row after the header's `:` to its own last row.
 */
import * as path from 'node:path';
import type { Result } from '@ptah-extension/shared';
import {
  EXTENSION_LANGUAGE_MAP,
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
  /** Captures `@body` for every function-like body (Python adds `@colon`). */
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

/**
 * Per-grammar outline queries. Every node and field name was checked against
 * the grammars `TreeSitterParserService` loads (@vscode/tree-sitter-wasm); a
 * name the grammar lacks makes `queryMulti` fail, and the spec compiles each
 * set against its real grammar. The TSX grammar is the TypeScript grammar
 * plus JSX, so it takes the TypeScript set unchanged.
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
  const startLine =
    colon === undefined
      ? body.startPosition.row + 1
      : Math.max(body.startPosition.row, colon.endPosition.row + 1);
  const endLine =
    colon === undefined ? body.endPosition.row - 1 : lastRow(body);
  return startLine <= endLine ? [{ startLine, endLine }] : [];
}

/** The full row span of a declaration named `focusSymbol`, if this match is one. */
function declarationSpan(
  match: QueryMatch,
  focusSymbol: string,
): CodeLineSpan[] {
  const name = capture(match, 'name');
  const declaration = capture(match, 'decl');
  if (name?.text !== focusSymbol || declaration === undefined) {
    return [];
  }
  return [
    { startLine: declaration.startPosition.row, endLine: lastRow(declaration) },
  ];
}
