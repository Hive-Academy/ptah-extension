/**
 * Mandate manifest (TASK_2026_559, Batch 21, Task 21.2).
 *
 * Every tool the mandatory-substitution prompt (`PTAH_MCP_SUBSTITUTION_SECTION`,
 * `ptah-core-prompt.ts`) tells an agent to prefer over a built-in must have a
 * NAMED, RUNNABLE regression guard somewhere in the repo: a spec file that
 * exists on disk, containing an ACTIVE test declaration (`it`/`test`/`maybe`,
 * optionally `.each`) whose title matches EXACTLY — never a bare substring,
 * which a stale comment or a deleted-but-quoted title would also satisfy. A
 * title that appears only inside a `.skip`/`.todo` call, or inside a `//`/`*`
 * comment line, does not count. A tool with no guard and no explicit,
 * reasoned exemption fails this suite.
 *
 * The manifest is read from the real exported constant (never edited here);
 * only the MAPPING below — which guard(s) cover which tool — is
 * hand-maintained, same as any coverage map.
 *
 * r1 revision (reviews/batch-21-code-logic-review-r1.md defects 6, 7):
 * replaced substring matching with the exact-title/active-declaration check
 * above; corrected the `ptah_code_search_symbols` mapping (it pointed at a
 * SQL-preparation unit test, not the actual recall benchmark); `ptah_get_diagnostics`
 * now requires BOTH the Batch 19 provider contract AND the Batch 1 formatter
 * cap test (batches.md:2854 names both), plus proof that the contract is
 * actually invoked with `createSecondCheckout` (not just defined).
 *
 * r3 revision (reviews/batch-21-code-logic-review-r3.md R3-03, R3-04): the
 * invocation proof is an AST call to the factory with the option as a real
 * object-literal property (comment/string mentions and disabled contexts no
 * longer count); a conditional alias with a constant condition resolves to
 * the branch it selects; `session_submit` maps to its owning app's real
 * oversized-result guard.
 */
import 'reflect-metadata';

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { PTAH_MCP_SUBSTITUTION_SECTION } from '@ptah-extension/agent-sdk';

/** Repo root: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core` is 7 levels down. */
const REPO_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
);

/** A tool name inside a `| ptah_xxx |` mandate table cell, or a numbered workflow step. */
const TOOL_NAME_PATTERN = /\bptah_[a-z0-9_]+\b/g;

/** Parse every distinct mandated tool name out of `section`. */
function parseMandatedToolNames(section: string): string[] {
  const found = section.match(TOOL_NAME_PATTERN) ?? [];
  return Array.from(new Set(found)).sort();
}

interface Guard {
  readonly kind: 'guard';
  /** Repo-root-relative (or absolute) path to the spec/contract file holding the test. */
  readonly file: string;
  /** The test's EXACT title — not a substring, not a comment, not a `.skip`/`.todo`. */
  readonly title: string;
  /**
   * A second file that must hold an ACTIVE call to `call` whose arguments
   * declare `option` as an object-literal property (AST-checked, r3 R3-04 —
   * a comment or string mentioning it is not proof), proving the guard is
   * actually EXERCISED (not merely defined) — for shared contract factories
   * (`run-*-contract.ts`) that only run when a `*.spec.ts` calls them with a
   * real implementation.
   */
  readonly invokedBy?: { file: string; call: string; option: string };
}

interface Exempt {
  readonly kind: 'exempt';
  readonly reason: string;
}

type Mapping = Guard | readonly Guard[] | Exempt;

function guard(
  file: string,
  title: string,
  invokedBy?: Guard['invokedBy'],
): Guard {
  return { kind: 'guard', file, title, invokedBy };
}

function exempt(reason: string): Exempt {
  return { kind: 'exempt', reason };
}

/**
 * Tool → guard(s), per the Batch 21 mapping in batches.md ("Task 21.2"):
 * code_search_symbols → the Batch 5 exact-name RECALL benchmark (not the
 * store's SQL-preparation unit test — r1 defect 7); lsp_definitions → the
 * Batch 8 Electron fallback spec; get_diagnostics → BOTH the Batch 19
 * platform-core second-checkout contract (with proof it is invoked) AND the
 * Batch 1 display-cap formatter spec (batches.md:2854 names both); service
 * tools (ast_analyze, context_enrich_file, get_dependents, get_symbol_index,
 * relevance_rank_files, project_detect_monorepo, count_tokens) → the Batch 20
 * benches; formatter/generic tools with no dedicated bench → this batch's own
 * dispatcher sweep (Task 21.1). `ptah_get_dirty_files` and `ptah_lsp_references`
 * are host-only, but each has a real host-level spec (checked, not assumed),
 * so they map to those instead of an exemption. Only `ptah_web_search` is
 * exempt outright: it calls an external network, which no spec in this repo
 * is allowed to do.
 */
const MANDATE_MAP: Readonly<Record<string, Mapping>> = {
  ptah_workspace_analyze: guard(
    'libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts',
    'HTTP, IDE capabilities, anonymous caller: every tool succeeds, stays within its declared TOKEN budget, and — where the generic budget layer runs — names its reducer, spools byte-equal raw text, and keeps its marker',
  ),
  ptah_search_files: guard(
    'libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts',
    'HTTP, IDE capabilities, anonymous caller: every tool succeeds, stays within its declared TOKEN budget, and — where the generic budget layer runs — names its reducer, spools byte-equal raw text, and keeps its marker',
  ),
  ptah_get_diagnostics: [
    guard(
      'libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts',
      'a file in a second checkout gets the same diagnostics as in the primary, within the budget',
      {
        // r2 R2-06: the r1 `invokedBy` pointed at the SELF-spec's fake
        // provider (createMockDiagnosticsProvider) — checking for the word
        // "createSecondCheckout" there proved only that a fake implements
        // the contract, not that a real host provider is exercised. This
        // points at the spec that runs the contract against the REAL
        // `TypeScriptDiagnosticsProvider`.
        // r3 R3-04: an AST call to the factory with a real
        // `createSecondCheckout` property — a leftover comment or a removed
        // option no longer passes.
        file: 'libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.spec.ts',
        call: 'runDiagnosticsProviderContract',
        option: 'createSecondCheckout',
      },
    ),
    guard(
      'libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts',
      '200 diagnostics across 3 files, 1 requested: every requested entry, exact totals and summary, <= 8,000 chars',
    ),
  ],
  ptah_lsp_references: guard(
    'apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts',
    'returns word-boundary matches across scanned files',
  ),
  ptah_lsp_definitions: guard(
    'apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts',
    'finds an imported class through the import when the index returns no hits',
  ),
  ptah_get_dirty_files: guard(
    'apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts',
    'getDirtyFiles returns [] (not tracked in main process)',
  ),
  ptah_count_tokens: guard(
    'libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts',
    'matches the real gpt-tokenizer count exactly, and is far smaller than reading the file',
  ),
  ptah_web_search: exempt('external network'),
  ptah_code_search_symbols: guard(
    'libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts',
    'recall guard: every exact symbol name ranks its declaration first (recall@1 = 100%, recall@5 >= 90%)',
  ),
  ptah_ast_analyze: guard(
    'libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts',
    'the real ptah_ast_analyze MCP text is >= 40% smaller in tokens than reading the 300-line file',
  ),
  ptah_context_enrich_file: guard(
    'libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts',
    'is >= 40% smaller in tokens than the full file, inferring the language via the real production resolveEnrichLanguage',
  ),
  ptah_get_dependents: guard(
    'libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts',
    'User Decision 21: the real ptah_get_dependents MCP text for a realistic-fan-in hub (>= 10 dependents) is smaller (tokens, unaltered paths) than a fair native grep',
  ),
  ptah_memory_search: guard(
    'libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts',
    'HTTP, IDE capabilities, anonymous caller: every tool succeeds, stays within its declared TOKEN budget, and — where the generic budget layer runs — names its reducer, spools byte-equal raw text, and keeps its marker',
  ),
  ptah_relevance_rank_files: guard(
    'libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts',
    'every native-grep hit for the query outranks every non-hit, in a payload smaller than reading every candidate file',
  ),
  ptah_project_detect_monorepo: guard(
    'libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts',
    'detects the Nx monorepo and reports a valid, non-react root type',
  ),
  ptah_get_symbol_index: guard(
    'libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts',
    'the real ptah_get_symbol_index text recalls EVERY known symbol (all kinds, Batch 20.2q) EXACTLY per file, and is smaller (tokens) than a native grep for export lines',
  ),
  // Not a prompt-mandated tool: the stdio-served `session_submit`, whose
  // result contract (1 MiB aggregate cap + `truncated` disclosure) lives in
  // the owning app, which this lib must not import (r3 R3-03). Mapped here
  // so the served-tool guard is a named, active, runnable test, not the
  // routing-only stub in mcp-contract.sweep.spec.ts.
  session_submit: guard(
    'apps/ptah-cli/src/services/mcp/session-submit.service.spec.ts',
    'aggregated output over the 1 MiB cap is cut to exactly the cap, keeps the leading text in order, and discloses truncated: true',
  ),
};

// ---------------------------------------------------------------------------
// AST helpers shared by the test-title matcher and the invocation proof.
// ---------------------------------------------------------------------------

function parseSource(content: string): ts.SourceFile {
  return ts.createSourceFile(
    'guard.ts',
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

/** The callee's dotted name (e.g. `it.skip`, `describe`, `maybe`), or `undefined` for anything else. */
function calleeName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    const base = calleeName(expr.expression);
    return base ? `${base}.${expr.name.text}` : undefined;
  }
  return undefined;
}

/** Unwraps a trailing `.each(...)` call so `it.each([...])('title', ...)` resolves to `it`. */
function unwrapEach(expr: ts.Expression): ts.Expression {
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === 'each'
  ) {
    return expr.expression.expression;
  }
  return expr;
}

function isDisabledCallName(name: string | undefined): boolean {
  if (name === undefined) return false;
  return (
    name === 'it.skip' ||
    name === 'test.skip' ||
    name === 'it.todo' ||
    name === 'test.todo' ||
    name === 'xit' ||
    name === 'xtest' ||
    name === 'describe.skip' ||
    name === 'xdescribe'
  );
}

/**
 * The value of a condition whose truthiness is fixed by its own syntax
 * (r3 R3-04): `true`/`false`, a numeric/string literal, `null`, `void …`,
 * `!x` and parentheses over those. `undefined` for anything decided at run
 * time — this is a bounded syntactic check, not reachability analysis.
 */
function staticTruthiness(expr: ts.Expression): boolean | undefined {
  if (ts.isParenthesizedExpression(expr)) {
    return staticTruthiness(expr.expression);
  }
  switch (expr.kind) {
    case ts.SyntaxKind.TrueKeyword:
      return true;
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
      return false;
  }
  if (ts.isNumericLiteral(expr)) return Number(expr.text) !== 0;
  if (ts.isStringLiteralLike(expr)) return expr.text !== '';
  if (ts.isVoidExpression(expr)) return false;
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const inner = staticTruthiness(expr.operand);
    return inner === undefined ? undefined : !inner;
  }
  return undefined;
}

/**
 * True when `node` sits in a context that can never run: under a disabled
 * test/describe call (`describe.skip`, `xdescribe`, `.skip`/`.todo`,
 * `xit`/`xtest`), or in the branch of an `if`/conditional whose condition is
 * a constant that selects the other branch.
 */
function isInDisabledContext(node: ts.Node): boolean {
  let child: ts.Node = node;
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const name = calleeName(unwrapEach(current.expression));
      if (isDisabledCallName(name)) return true;
    }
    if (ts.isIfStatement(current) && child !== current.expression) {
      const truth = staticTruthiness(current.expression);
      if (truth === false && child === current.thenStatement) return true;
      if (truth === true && child === current.elseStatement) return true;
    }
    if (ts.isConditionalExpression(current) && child !== current.condition) {
      const truth = staticTruthiness(current.condition);
      if (truth === false && child === current.whenTrue) return true;
      if (truth === true && child === current.whenFalse) return true;
    }
    child = current;
    current = current.parent;
  }
  return false;
}

/**
 * True when `title` appears, EXACTLY, as the string-literal (or
 * adjacent-string-literal concatenation) argument of an ACTIVE test
 * declaration (`it`/`test`, `.each(...)` included, or a local `maybe` alias
 * that resolves to the codebase's own `cond ? it : it.skip` runtime-
 * conditional pattern), whose call chain is not `.skip`/`.todo`/`xit`/`xtest`,
 * and which does not sit in a disabled context ({@link isInDisabledContext}).
 *
 * r2 revision (reviews/batch-21-code-logic-review-r2.md R2-05): a real
 * TypeScript AST walk, so a title left in a comment, inside an unrelated
 * string literal, under a skipped `describe`, or through an unconditional
 * `maybe = it.skip` alias never matches. r3 revision (R3-04): a conditional
 * alias whose condition is a constant resolves to the branch that constant
 * selects — `false ? it : it.skip` is `it.skip`, i.e. NOT active.
 */
function hasActiveTestTitled(content: string, exactTitle: string): boolean {
  const source = parseSource(content);

  function isItOrTestIdentifier(node: ts.Expression): boolean {
    return (
      ts.isIdentifier(node) && (node.text === 'it' || node.text === 'test')
    );
  }

  // Local aliases that resolve to an ACTIVE `it`/`test`: the codebase's
  // `const maybe = cond ? it : it.skip;` convention (`code-symbol.store.spec.ts`)
  // with a runtime condition, or a constant condition that selects `it`/`test`.
  // An alias bound to anything else (a bare `it.skip`, or `false ? it : …`)
  // is NOT active.
  const activeAliases = new Set<string>();
  ts.forEachChild(source, function findAliases(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isConditionalExpression(node.initializer)
    ) {
      const { condition, whenTrue, whenFalse } = node.initializer;
      const truth = staticTruthiness(condition);
      const selected =
        truth === undefined ? whenTrue : truth ? whenTrue : whenFalse;
      if (isItOrTestIdentifier(selected)) {
        activeAliases.add(node.name.text);
      }
    }
    ts.forEachChild(node, findAliases);
  });

  function isActiveCallName(name: string | undefined): boolean {
    if (name === undefined) return false;
    if (name === 'it' || name === 'test') return true;
    return activeAliases.has(name);
  }

  /** The literal string value of a title argument: a plain literal, or `'a' + 'b'` concatenation. */
  function literalStringValue(node: ts.Expression): string | undefined {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (node.kind === ts.SyntaxKind.BinaryExpression) {
      const bin = node as ts.BinaryExpression;
      if (bin.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = literalStringValue(bin.left);
        const right = literalStringValue(bin.right);
        if (left !== undefined && right !== undefined) return left + right;
      }
    }
    return undefined;
  }

  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(unwrapEach(node.expression));
      if (isActiveCallName(name) && !isDisabledCallName(name)) {
        const titleArg = node.arguments[0];
        if (
          titleArg !== undefined &&
          literalStringValue(titleArg) === exactTitle &&
          !isInDisabledContext(node)
        ) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

/** `expr` without parentheses, `as`/`satisfies`/`!` and `<T>` wrappers. */
function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current = expr;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

function isFunctionLike(
  expr: ts.Expression,
): expr is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(expr) || ts.isFunctionExpression(expr);
}

/** The statements of `fn`'s own body (a block body only). */
function ownStatements(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): readonly ts.Statement[] {
  return ts.isBlock(fn.body) ? fn.body.statements : [];
}

/**
 * The initializer of a `const` named `name` declared directly in
 * `statements` (not in a nested block or function), or `undefined`.
 */
function constInitializer(
  statements: readonly ts.Statement[],
  name: string,
): ts.Expression | undefined {
  for (const statement of statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer !== undefined
      ) {
        return unwrapExpression(declaration.initializer);
      }
    }
  }
  return undefined;
}

/**
 * True when identifier `name` names a function: a function declaration, or
 * a `const` bound to an arrow/function expression, in `scopes` (innermost
 * first). `undefined` and anything else is not a function.
 */
function namesFunction(
  name: string,
  scopes: ReadonlyArray<readonly ts.Statement[]>,
): boolean {
  if (name === 'undefined') return false;
  for (const statements of scopes) {
    for (const statement of statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === name &&
        statement.body !== undefined
      ) {
        return true;
      }
    }
    const initializer = constInitializer(statements, name);
    if (initializer !== undefined) {
      return isFunctionLike(initializer);
    }
  }
  return false;
}

/**
 * r4 R4-01: whether object literal `object` gives `option` a FUNCTION value
 * — a method, an arrow/function expression, or an identifier (plain or
 * shorthand) that names a function in `scopes`. The last property of that
 * name wins, as at run time. `option: undefined`, `option: null`, any other
 * value, a spread-only source and an absent key are all rejected.
 */
function objectGivesFunction(
  object: ts.ObjectLiteralExpression,
  option: string,
  scopes: ReadonlyArray<readonly ts.Statement[]>,
): boolean {
  let last: ts.ObjectLiteralElementLike | undefined;
  for (const property of object.properties) {
    const name =
      property.name !== undefined &&
      (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
        ? property.name.text
        : undefined;
    if (name === option) last = property;
  }
  if (last === undefined) return false;
  if (ts.isMethodDeclaration(last)) return last.body !== undefined;
  if (ts.isShorthandPropertyAssignment(last)) {
    return namesFunction(last.name.text, scopes);
  }
  if (!ts.isPropertyAssignment(last)) return false;
  const value = unwrapExpression(last.initializer);
  if (isFunctionLike(value)) return true;
  return ts.isIdentifier(value) && namesFunction(value.text, scopes);
}

/**
 * r4 R4-01: whether the setup callback passed to the contract RETURNS a
 * setup object whose `option` is a function. The returned value is resolved
 * for the supported shapes only — an expression body that is an object
 * literal, or `return <object literal>` / `return <const bound to an object
 * literal>` at the callback's own top level — and EVERY such return must
 * qualify. An object that is built but not returned proves nothing.
 */
function setupReturnsOption(
  call: ts.CallExpression,
  option: string,
  source: ts.SourceFile,
): boolean {
  const callbacks = call.arguments.map(unwrapExpression).filter(isFunctionLike);
  return callbacks.some((callback) => {
    const statements = ownStatements(callback);
    const scopes = [statements, source.statements];
    const returned: ts.Expression[] = ts.isBlock(callback.body)
      ? statements
          .filter(ts.isReturnStatement)
          .map((statement) => statement.expression)
          .filter((expr): expr is ts.Expression => expr !== undefined)
      : [callback.body];
    const resolve = (expr: ts.Expression): ts.Expression | undefined => {
      const value = unwrapExpression(expr);
      return ts.isIdentifier(value)
        ? constInitializer(statements, value.text)
        : value;
    };
    return (
      returned.length > 0 &&
      returned.every((expr) => {
        const value = resolve(expr);
        return (
          value !== undefined &&
          ts.isObjectLiteralExpression(value) &&
          objectGivesFunction(value, option, scopes)
        );
      })
    );
  });
}

/**
 * r3 R3-04 / r4 R4-01: proof that a shared contract factory is REALLY
 * invoked with a required capability — an AST call expression to
 * `spec.call` (not a comment, not a string) that is not in a disabled
 * context, and whose setup callback RETURNS an object giving `spec.option`
 * a function value ({@link setupReturnsOption}). The provider spec's shape is
 * `runDiagnosticsProviderContract('Name', () => { const setup = { provider,
 * createSecondCheckout(root) {…} }; return setup; })`. A comment, a
 * `'createSecondCheckout'` string, `createSecondCheckout: undefined` and an
 * unreturned object never count.
 */
function hasActiveContractInvocation(
  content: string,
  spec: { readonly call: string; readonly option: string },
): boolean {
  const source = parseSource(content);

  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      calleeName(node.expression) === spec.call &&
      !isInDisabledContext(node) &&
      setupReturnsOption(node, spec.option, source)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

/** The invocation check {@link checkGuard} applies (kept separate so its self-tests exercise exactly it). */
function invocationProven(
  content: string,
  spec: { readonly call: string; readonly option: string },
): boolean {
  return hasActiveContractInvocation(content, spec);
}

function resolveFile(file: string): string {
  return path.isAbsolute(file) ? file : path.join(REPO_ROOT, file);
}

function checkGuard(g: Guard): string[] {
  const problems: string[] = [];
  const absoluteFile = resolveFile(g.file);
  if (!fs.existsSync(absoluteFile)) {
    problems.push(`file does not exist: ${g.file}`);
    return problems;
  }
  const content = fs.readFileSync(absoluteFile, 'utf8');
  if (!hasActiveTestTitled(content, g.title)) {
    problems.push(`no active test titled exactly "${g.title}" in ${g.file}`);
  }
  if (g.invokedBy) {
    const invokedAbsolute = resolveFile(g.invokedBy.file);
    if (!fs.existsSync(invokedAbsolute)) {
      problems.push(
        `invocation proof file does not exist: ${g.invokedBy.file}`,
      );
    } else if (
      !invocationProven(fs.readFileSync(invokedAbsolute, 'utf8'), g.invokedBy)
    ) {
      problems.push(
        `${g.invokedBy.file} has no active ${g.invokedBy.call}(…) call declaring "${g.invokedBy.option}" — the contract may be defined but never invoked with it`,
      );
    }
  }
  return problems;
}

function guardsOf(mapping: Mapping): readonly Guard[] {
  if (Array.isArray(mapping)) return mapping;
  if ((mapping as Exempt).kind === 'exempt') return [];
  return [mapping as Guard];
}

function isExempt(mapping: Mapping): mapping is Exempt {
  return !Array.isArray(mapping) && (mapping as Exempt).kind === 'exempt';
}

describe('MCP mandate manifest (TASK_2026_559 Batch 21, Task 21.2)', () => {
  const mandatedTools = parseMandatedToolNames(PTAH_MCP_SUBSTITUTION_SECTION);

  it('parses at least the tools this batch maps (sanity — the constant is not stale)', () => {
    expect(mandatedTools.length).toBeGreaterThanOrEqual(16);
    expect(mandatedTools).toContain('ptah_get_diagnostics');
    expect(mandatedTools).toContain('ptah_code_search_symbols');
  });

  it.each(
    // `it.each` with the live-parsed list — no hard-coded tool array — so a
    // tool added to the prompt later is tested by name, not skipped.
    Array.from(new Set([...mandatedTools, ...Object.keys(MANDATE_MAP)])).sort(),
  )(
    '%s maps to (a) named, active, runnable guard(s) or an explicit, reasoned exemption',
    (toolName) => {
      const mapping = MANDATE_MAP[toolName];
      expect(mapping).toBeDefined();
      if (mapping === undefined) return;
      if (isExempt(mapping)) {
        expect(mapping.reason.trim().length).toBeGreaterThan(0);
        return;
      }
      const guards = guardsOf(mapping);
      expect(guards.length).toBeGreaterThan(0);
      const problems = guards.flatMap(checkGuard);
      expect(problems).toEqual([]);
    },
  );

  it('every tool the prompt mandates is covered by MANDATE_MAP (no silent gap)', () => {
    const uncovered = mandatedTools.filter(
      (name) => MANDATE_MAP[name] === undefined,
    );
    expect(uncovered).toEqual([]);
  });

  // -- AST-lite matcher self-tests (guards against the matcher itself regressing) --

  it('hasActiveTestTitled: rejects a title left only in a comment', () => {
    const src = "// it('ghost test', () => {})\n";
    expect(hasActiveTestTitled(src, 'ghost test')).toBe(false);
  });

  it('hasActiveTestTitled: rejects .skip and .todo', () => {
    expect(hasActiveTestTitled("it.skip('x', () => {})", 'x')).toBe(false);
    expect(hasActiveTestTitled("it.todo('x')", 'x')).toBe(false);
  });

  it('hasActiveTestTitled: accepts it/test/maybe and it.each(...)(', () => {
    expect(hasActiveTestTitled("it('x', () => {})", 'x')).toBe(true);
    expect(hasActiveTestTitled("test('x', () => {})", 'x')).toBe(true);
    expect(
      hasActiveTestTitled(
        "const maybe = cond ? it : it.skip;\nmaybe('x', async () => {})",
        'x',
      ),
    ).toBe(true);
    expect(hasActiveTestTitled("it.each([1,2])('x', (n) => {})", 'x')).toBe(
      true,
    );
  });

  it('hasActiveTestTitled: rejects a `maybe` alias not bound to the cond ? it : it.skip pattern', () => {
    expect(
      hasActiveTestTitled("const maybe = it.skip;\nmaybe('x', () => {})", 'x'),
    ).toBe(false);
  });

  it('hasActiveTestTitled: rejects a skipped describe ancestor', () => {
    expect(
      hasActiveTestTitled(
        "describe.skip('group', () => {\n  it('x', () => {});\n});",
        'x',
      ),
    ).toBe(false);
  });

  it('hasActiveTestTitled: rejects a title that only appears inside a string literal', () => {
    expect(
      hasActiveTestTitled('const snippet = "it(\'x\', () => {});";', 'x'),
    ).toBe(false);
  });

  it('hasActiveTestTitled: a block comment without leading stars never matches (comments are not AST nodes)', () => {
    expect(hasActiveTestTitled("/*\nit('x', () => {});\n*/", 'x')).toBe(false);
  });

  it('hasActiveTestTitled: does not accept a substring of a longer title', () => {
    expect(hasActiveTestTitled("it('x extended', () => {})", 'x')).toBe(false);
  });

  // -- r3 R3-04 self-tests: shared-contract invocation proof and constant-false aliases --

  const DIAGNOSTICS_INVOCATION = {
    file: 'unused.spec.ts',
    call: 'runDiagnosticsProviderContract',
    option: 'createSecondCheckout',
  } as const;

  it('invocation proof: removed invocation with a leftover `// createSecondCheckout` comment is NOT an active guard', () => {
    const src = [
      "import { runDiagnosticsProviderContract } from '@ptah-extension/platform-core/testing';",
      '// runDiagnosticsProviderContract was removed here; only this note is left:',
      '// createSecondCheckout',
      "describe('TypeScriptDiagnosticsProvider', () => {",
      "  it('works', () => {});",
      '});',
    ].join('\n');
    expect(invocationProven(src, DIAGNOSTICS_INVOCATION)).toBe(false);
  });

  it('invocation proof: a real call WITHOUT the option (option only named in a comment/string) is NOT proof', () => {
    const src = [
      "runDiagnosticsProviderContract('P', () => {",
      '  // createSecondCheckout(primaryRoot) { ... } — removed',
      "  const note = 'createSecondCheckout';",
      '  return { provider };',
      '});',
    ].join('\n');
    expect(invocationProven(src, DIAGNOSTICS_INVOCATION)).toBe(false);
  });

  it('invocation proof: a call inside a skipped describe is NOT proof', () => {
    const src = [
      "describe.skip('off', () => {",
      "  runDiagnosticsProviderContract('P', () => ({ provider, createSecondCheckout: (r) => r }));",
      '});',
    ].join('\n');
    expect(invocationProven(src, DIAGNOSTICS_INVOCATION)).toBe(false);
  });

  it('invocation proof: the real provider-spec shape (option as a method of the returned setup object) IS proof', () => {
    const src = [
      "runDiagnosticsProviderContract('TypeScriptDiagnosticsProvider', () => {",
      '  const provider = new TypeScriptDiagnosticsProvider(realDirFsProvider());',
      '  const setup: DiagnosticsProviderSetup = {',
      '    provider,',
      '    createSecondCheckout(primaryRoot: string): string {',
      '      return `${primaryRoot}-worktree`;',
      '    },',
      '  };',
      '  return setup;',
      '});',
    ].join('\n');
    expect(invocationProven(src, DIAGNOSTICS_INVOCATION)).toBe(true);
  });

  // -- r4 R4-01 self-tests: the RETURNED setup must give the option a function value --

  it('invocation proof: `createSecondCheckout: undefined` in the returned setup is NOT proof (review r4 R4-01 counterexample)', () => {
    const src =
      "runDiagnosticsProviderContract('real', () => ({ provider, createSecondCheckout: undefined }));";
    expect(invocationProven(src, DIAGNOSTICS_INVOCATION)).toBe(false);
  });

  it('invocation proof: a setup object that declares the method but is NOT returned is NOT proof (review r4 R4-01 counterexample)', () => {
    const src = [
      "runDiagnosticsProviderContract('real', () => {",
      '  const unused = { createSecondCheckout(root: string) { return root; } };',
      '  return { provider };',
      '});',
    ].join('\n');
    expect(invocationProven(src, DIAGNOSTICS_INVOCATION)).toBe(false);
  });

  it('invocation proof: null, a non-function value, or a shorthand bound to undefined is NOT proof', () => {
    for (const setup of [
      '({ provider, createSecondCheckout: null })',
      "({ provider, createSecondCheckout: 'x' })",
      '({ provider, createSecondCheckout: void 0 })',
    ]) {
      const src = `runDiagnosticsProviderContract('real', () => ${setup});`;
      expect(invocationProven(src, DIAGNOSTICS_INVOCATION)).toBe(false);
    }
    const shorthand = [
      "runDiagnosticsProviderContract('real', () => {",
      '  const createSecondCheckout = undefined;',
      '  return { provider, createSecondCheckout };',
      '});',
    ].join('\n');
    expect(invocationProven(shorthand, DIAGNOSTICS_INVOCATION)).toBe(false);
    // A later `undefined` overrides an earlier method, as at run time.
    const overridden =
      "runDiagnosticsProviderContract('real', () => ({ createSecondCheckout(r) { return r; }, createSecondCheckout: undefined }));";
    expect(invocationProven(overridden, DIAGNOSTICS_INVOCATION)).toBe(false);
  });

  it('invocation proof: a returned expression-body setup with an arrow, or a shorthand bound to a function, IS proof', () => {
    expect(
      invocationProven(
        "runDiagnosticsProviderContract('P', () => ({ provider, createSecondCheckout: (r: string) => r }));",
        DIAGNOSTICS_INVOCATION,
      ),
    ).toBe(true);
    const shorthand = [
      "runDiagnosticsProviderContract('P', () => {",
      '  const createSecondCheckout = (root: string): string => root;',
      '  return { provider, createSecondCheckout };',
      '});',
    ].join('\n');
    expect(invocationProven(shorthand, DIAGNOSTICS_INVOCATION)).toBe(true);
  });

  it('hasActiveTestTitled: a constant-false conditional alias (`false ? it : it.skip`) is NOT active', () => {
    expect(
      hasActiveTestTitled(
        "const maybe = false ? it : it.skip;\nmaybe('some title', () => {});",
        'some title',
      ),
    ).toBe(false);
    expect(
      hasActiveTestTitled(
        "const maybe = 0 ? it : it.skip;\nmaybe('some title', () => {});",
        'some title',
      ),
    ).toBe(false);
    // A constant-true condition selects the active branch.
    expect(
      hasActiveTestTitled(
        "const maybe = true ? it : it.skip;\nmaybe('some title', () => {});",
        'some title',
      ),
    ).toBe(true);
  });
});
