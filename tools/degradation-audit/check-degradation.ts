#!/usr/bin/env npx ts-node
/**
 * degradation-audit — AST-based inventory of silently swallowed failure sites.
 *
 * Detects (TASK_2026_383 component 4):
 *   1. catch-return-sentinel: a `catch` block with no `throw`, no `.error(...)`
 *      call, that reaches a `return` of a literal (null/false/true/undefined/
 *      []/{}/a string literal).
 *   2. promise-catch-sentinel: a `.catch(fn)` whose handler returns one of the
 *      same literals, or has an empty body.
 *   3. empty-catch: a `catch` block with zero statements (the `no-empty`
 *      overlap; kept for completeness).
 *   4. floating-promise: a bare call-expression statement (not `await`ed, not
 *      `void`-marked, not chained with `.then`/`.catch`/`.finally`) whose
 *      callee name matches an `async` function/method declared in the SAME
 *      file. Structural, not type-aware — the fallback named in
 *      `implementation-plan.md` component 4 after a type-aware
 *      `@typescript-eslint/no-floating-promises` block (scoped to these same
 *      three directories) measured ~70s to type-check one project's `src/`
 *      alone and broke outright on every `*.spec.ts` in it (`apps/ptah-electron`
 *      references only `tsconfig.app.json`, never `tsconfig.spec.json`, so
 *      `projectService` cannot resolve spec files). Scoped to the boot-critical
 *      surface: `apps/ptah-electron/src`, `libs/backend/thoth-runtime/src`,
 *      `libs/backend/persistence-sqlite/src` — where an un-awaited promise is a
 *      boot defect and `wire-runtime.ts:325` already produced one.
 *
 * Suppression: a `// degradation-audit: <kind> [separator] <reason>` comment,
 * where `<kind>` is `optional-capability` or `reported` and the separator is
 * an ASCII hyphen (`-`), en dash (`–`), or em dash (`—`). Revision 2
 * (TASK_2026_383 code-logic-review B-1 / S-3) widens WHERE that comment may
 * sit, because real production usage (Batch 2's
 * `cli-master-key-provider.ts:156-171`) writes multi-line wrapped
 * justifications, not the single-line examples this header used to imply. A
 * marker attaches to a flagged `CatchClause` or `.catch(...)` call if it
 * appears in ANY of:
 *   1. The contiguous run of `//` comment lines directly above the
 *      construct's own start line — any line of that run, not only the one
 *      immediately adjacent (a two-line wrapped comment must work).
 *   2. The leading comment lines inside the construct's own body: right
 *      after `catch (...) {` / `catch {` opens, or right after a `.catch(fn)`
 *      handler's block body opens.
 *   3. For a `.catch(...)` call specifically, also the contiguous comment run
 *      directly above the STATEMENT that contains the call — `await
 *      x.catch(...)` is usually one line, with the marker above the whole
 *      statement rather than wedged mid-expression.
 * A `degradation-audit:` marker that does not fully parse in whichever zone
 * it was found — no reason, an unrecognised kind, or a malformed separator —
 * is ALWAYS a violation (`bare-suppression`) and NEVER silently drops the
 * site it annotates. A marker that does not attach to ANY flagged
 * `CatchClause` or `.catch(...)` call in any of its three zones — e.g. a
 * comment orphaned by a later refactor, or one written several lines away
 * from anything it could annotate — is reported as `orphaned-suppression` at
 * its own line, so a misplaced comment is never silent either. Revision 1
 * (S-1) accepted all three dash separators but still only checked the single
 * line immediately above the node; Revision 2 widens the search without
 * relaxing the "never silent" guarantee.
 *
 * Baseline is a per-directory ratchet in baseline.json. A directory's count
 * may only go down (via --update-baseline) or stay flat; any increase over
 * its baseline fails the run.
 *
 * A file that fails to parse is a tool failure (non-zero exit), never a
 * silently skipped file — the same defect class this tool audits.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import fg from 'fast-glob';

type ViolationKind =
  | 'catch-return-sentinel'
  | 'promise-catch-sentinel'
  | 'empty-catch'
  | 'floating-promise'
  | 'bare-suppression'
  | 'orphaned-suppression';

interface Violation {
  file: string;
  line: number;
  kind: ViolationKind;
  detail: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'baseline.json');
const FIXTURES_DIR = path.join(__dirname, '__fixtures__').replace(/\\/g, '/');

const SCAN_GLOBS = ['libs/**/src/**/*.ts', 'apps/**/src/**/*.ts'];

const SCAN_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/*.spec.ts',
  '**/*.test.ts',
  'apps/*-e2e/**',
  'libs/frontend/webview-e2e-harness/**',
];

// Any line starting with the marker, regardless of whether the rest parses —
// used to decide "is this suppression-shaped at all" before validating it.
const SUPPRESSION_MARKER_RE = /^\/\/\s*degradation-audit:\s*(.*)$/;
// The marker's body: a known kind, optionally followed by a separator
// (ASCII hyphen, en dash, or em dash) and a reason. Revision 1 (S-1): accepts
// all three separators, not just the em dash.
const SUPPRESSION_BODY_RE =
  /^(optional-capability|reported)(?:\s*[-–—]\s*(.*))?$/;

// Boot-critical surface for the floating-promise fallback detector (see file
// header). Matched against the repo-relative path with forward slashes.
const FLOATING_PROMISE_SCOPE = [
  'apps/ptah-electron/src/',
  'libs/backend/thoth-runtime/src/',
  'libs/backend/persistence-sqlite/src/',
];

function inFloatingPromiseScope(relFile: string): boolean {
  return FLOATING_PROMISE_SCOPE.some((prefix) => relFile.startsWith(prefix));
}

// --- literal-argument detection --------------------------------------------

function isLiteralOfInterest(expr: ts.Expression | undefined): boolean {
  if (!expr) return true; // bare `return;` === undefined
  switch (expr.kind) {
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
      return true;
    default:
      break;
  }
  if (ts.isIdentifier(expr) && expr.text === 'undefined') return true;
  if (ts.isStringLiteralLike(expr)) return true;
  if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 0) {
    return true;
  }
  if (ts.isObjectLiteralExpression(expr) && expr.properties.length === 0) {
    return true;
  }
  return false;
}

// --- scoped traversal (does not cross a nested function boundary) ---------

function isFunctionBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  );
}

// Revision 1 (S-2): a nested `try { ... } catch (inner) { ... }` is NOT a
// function boundary, but its `inner` catch handles a DIFFERENT exception than
// the one the outer catch is being judged on. Without this, a nested catch's
// `.error(...)` call (or `throw`, or literal `return`) satisfied the OUTER
// catch's own check, letting a genuinely swallowed outer error hide behind
// unrelated cleanup logging. `scopedFind` now also stops at a nested
// `CatchClause` (never at the root itself, so the outer catch's own block is
// still walked in full).
function scopedFind(
  root: ts.Node,
  predicate: (node: ts.Node) => boolean,
): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (predicate(node)) {
      found = node;
      return;
    }
    if (node !== root && (isFunctionBoundary(node) || ts.isCatchClause(node))) {
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function isErrorCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'error'
  );
}

function findLiteralReturn(root: ts.Node): ts.ReturnStatement | undefined {
  const hit = scopedFind(
    root,
    (n) => ts.isReturnStatement(n) && isLiteralOfInterest(n.expression),
  );
  return hit as ts.ReturnStatement | undefined;
}

// --- floating-promise (structural fallback, see file header) --------------

function hasAsyncModifier(
  node: ts.FunctionLikeDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
}

// Revision 1 (moderate: floating-promise name collision). Matching purely on
// name is inherently receiver-blind, but a same-file collision between an
// `async` declaration and a NON-async declaration sharing the same name is at
// least detectable without a type checker: if both shapes exist for one name
// in the same file, that name is ambiguous and must not be used to flag a
// bare call — a false positive there is strictly worse than the false
// negative of not flagging it. `collectAsyncNames` returns only names that
// are async in EVERY same-file declaration found for them.
function collectAsyncNames(sourceFile: ts.SourceFile): Set<string> {
  const asyncNames = new Set<string>();
  const nonAsyncNames = new Set<string>();
  const record = (
    name: string,
    fn: ts.FunctionLikeDeclaration | ts.ArrowFunction | ts.FunctionExpression,
  ): void => {
    if (hasAsyncModifier(fn)) {
      asyncNames.add(name);
    } else {
      nonAsyncNames.add(name);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      record(node.name.text, node);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      record(node.name.text, node.initializer);
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      record(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  for (const name of nonAsyncNames) {
    asyncNames.delete(name);
  }
  return asyncNames;
}

function calleeName(expr: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

// --- .catch(<identifier>) resolution (Revision 1: moderate finding) -------
//
// The original detector only inspected an inline arrow/function-expression
// argument to `.catch(...)`. A named reference — `.catch(noop)`,
// `.catch(_.noop)`, `.catch(this.onRejected)` — was invisible, which is a
// straightforward ratchet-evasion path: rewriting `.catch(() => undefined)`
// as `.catch(noop)` silently drops the site from the count with no behaviour
// change. Resolves the identifier to a same-file declaration when possible;
// an identifier that cannot be resolved locally (imported, a class member
// accessed via `this.`, a third-party no-op) is flagged conservatively per
// the review's explicit guidance — better an over-broad inventory a human
// dismisses with a suppression comment than a silent blind spot.

type NamedFn =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression;

function findNamedFunctionLike(
  sourceFile: ts.SourceFile,
  name: string,
): NamedFn | undefined {
  let found: NamedFn | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found = node;
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function functionHandlesError(fn: NamedFn): boolean {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return false;
  return (
    Boolean(scopedFind(body, ts.isThrowStatement)) ||
    Boolean(scopedFind(body, isErrorCall))
  );
}

type CatchHandlerVerdict = 'sentinel' | 'handled' | 'unknown';

function resolveCatchHandlerIdentifier(
  sourceFile: ts.SourceFile,
  name: string,
): CatchHandlerVerdict {
  const fn = findNamedFunctionLike(sourceFile, name);
  if (!fn) return 'unknown';
  // "Handled" is the only escape: a resolved function that neither throws nor
  // calls `.error(...)` is flagged regardless of what else it does. This is
  // deliberately broader than the inline-arrow check (which only flags an
  // exact literal/empty-body shape) — the review's minimum bar is "any
  // `.catch(identifier)` unless it resolves to a function that logs or
  // rethrows."
  return functionHandlesError(fn) ? 'handled' : 'sentinel';
}

// --- suppression lookup (Revision 2: widened placement contract) -----------
//
// A "zone" is an array of 0-indexed line numbers, nearest-first, that a
// suppression marker for a given construct may legally occupy. `resolveSuppression`
// tries each zone in order and returns on the FIRST marker-shaped line found
// (valid or not) — that line is "consumed" so the orphan pass at the end of
// `detectInFile` doesn't also report it as unattached.

interface ParsedMarker {
  valid: boolean;
  raw: string;
}

function parseMarkerLine(text: string): ParsedMarker | null {
  const trimmed = text.trim();
  const markerMatch = SUPPRESSION_MARKER_RE.exec(trimmed);
  if (!markerMatch) return null;
  const body = (markerMatch[1] ?? '').trim();
  const bodyMatch = SUPPRESSION_BODY_RE.exec(body);
  const reason = (bodyMatch?.[2] ?? '').trim();
  return { valid: Boolean(bodyMatch && reason.length > 0), raw: trimmed };
}

function isCommentLine(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  return (
    t.startsWith('//') ||
    t.startsWith('/*') ||
    t.startsWith('*') ||
    t.endsWith('*/')
  );
}

// Zone 1 / Zone 3: the contiguous run of `//`-shaped comment lines directly
// above `belowIdx` (nearest-first). Stops at the first non-comment or blank
// line — a wrapped multi-line comment is contiguous by definition.
function commentBlockAbove(sourceLines: string[], belowIdx: number): number[] {
  const indices: number[] = [];
  let idx = belowIdx;
  while (idx >= 0 && isCommentLine(sourceLines[idx] ?? '')) {
    indices.push(idx);
    idx--;
  }
  return indices;
}

// Zone 2: the contiguous run of comment lines starting at `fromIdx` (the
// first line after a construct's own opening brace), scanning downward.
function commentBlockBelow(sourceLines: string[], fromIdx: number): number[] {
  const indices: number[] = [];
  let idx = fromIdx;
  while (idx < sourceLines.length && isCommentLine(sourceLines[idx] ?? '')) {
    indices.push(idx);
    idx++;
  }
  return indices;
}

interface SuppressionOutcome {
  suppressed: boolean;
  bareViolation?: Violation;
  consumedLine?: number;
}

function resolveSuppression(
  sourceLines: string[],
  zones: number[][],
  relFile: string,
): SuppressionOutcome {
  for (const zone of zones) {
    for (const idx of zone) {
      const parsed = parseMarkerLine(sourceLines[idx] ?? '');
      if (!parsed) continue;
      if (parsed.valid) {
        return { suppressed: true, consumedLine: idx };
      }
      // Revision 1 (S-1): a marker-shaped comment that fails to fully parse
      // — no reason, an unrecognised kind, or a malformed separator — is
      // ALWAYS surfaced as bare-suppression, never silently dropped.
      return {
        suppressed: false,
        consumedLine: idx,
        bareViolation: {
          file: relFile,
          line: idx + 1,
          kind: 'bare-suppression',
          detail: `degradation-audit suppression comment does not match a known form: "${parsed.raw}"`,
        },
      };
    }
  }
  return { suppressed: false };
}

// Statement ancestor for Zone 3 ("above the statement containing the call").
// `ts.isStatement` is public API covering every statement kind.
function nearestStatement(node: ts.Node): ts.Node {
  let cur: ts.Node = node;
  while (!ts.isStatement(cur) && cur.parent) {
    cur = cur.parent;
  }
  return cur;
}

// --- per-file detection ------------------------------------------------------

function detectInFile(filePath: string, relFile: string): Violation[] {
  const src = fs.readFileSync(filePath, 'utf8');
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      filePath,
      src,
      ts.ScriptTarget.ES2022,
      true,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`parse failure in ${relFile}: ${message}`);
  }
  // ts.createSourceFile does not throw on malformed input; surface parse
  // diagnostics explicitly so a broken file is a tool failure, not silence.
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) {
    const first = parseDiagnostics[0];
    const msg = ts.flattenDiagnosticMessageText(first.messageText, ' ');
    throw new Error(`parse failure in ${relFile}: ${msg}`);
  }

  const sourceLines = src.split(/\r?\n/);
  const violations: Violation[] = [];
  const checkFloatingPromise = inFloatingPromiseScope(relFile);
  const asyncNames = checkFloatingPromise
    ? collectAsyncNames(sourceFile)
    : undefined;

  // Revision 2 (B-1 / S-3): every `degradation-audit:` marker line in the
  // file is recorded up front. Each zone check below "consumes" the lines it
  // actually finds a marker on; whatever is left unconsumed after the whole
  // AST walk is reported as `orphaned-suppression` — a marker that never
  // attached to any flagged construct is never silent either.
  const allMarkerLines = new Set<number>();
  sourceLines.forEach((text, idx) => {
    if (parseMarkerLine(text)) allMarkerLines.add(idx);
  });
  const consumedMarkerLines = new Set<number>();

  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node)) {
      const block = node.block;
      const catchLine = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(),
      ).line;
      const openBraceLine = sourceFile.getLineAndCharacterOfPosition(
        block.getStart(),
      ).line;
      const zones = [
        commentBlockAbove(sourceLines, catchLine - 1), // Zone 1
        commentBlockBelow(sourceLines, openBraceLine + 1), // Zone 2
      ];
      const outcome = resolveSuppression(sourceLines, zones, relFile);
      if (outcome.consumedLine !== undefined) {
        consumedMarkerLines.add(outcome.consumedLine);
      }
      if (outcome.bareViolation) violations.push(outcome.bareViolation);

      const isTrulyEmpty =
        block.statements.length === 0 &&
        src.slice(block.getStart() + 1, block.getEnd() - 1).trim().length === 0;
      if (isTrulyEmpty) {
        if (!outcome.suppressed) {
          violations.push({
            file: relFile,
            line: catchLine + 1,
            kind: 'empty-catch',
            detail: 'catch block has no statements',
          });
        }
      } else {
        const hasThrow = Boolean(scopedFind(block, ts.isThrowStatement));
        const hasErrorCall = Boolean(scopedFind(block, isErrorCall));
        const literalReturn = findLiteralReturn(block);
        if (
          !hasThrow &&
          !hasErrorCall &&
          literalReturn &&
          !outcome.suppressed
        ) {
          violations.push({
            file: relFile,
            line: catchLine + 1,
            kind: 'catch-return-sentinel',
            detail: 'catch swallows error and returns a literal',
          });
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'catch' &&
      node.arguments.length >= 1
    ) {
      const handler = node.arguments[0];
      const callLine = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(),
      ).line;
      const zones: number[][] = [commentBlockAbove(sourceLines, callLine - 1)]; // Zone 1
      if (
        handler &&
        (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) &&
        ts.isBlock(handler.body)
      ) {
        const handlerOpenLine = sourceFile.getLineAndCharacterOfPosition(
          handler.body.getStart(),
        ).line;
        zones.push(commentBlockBelow(sourceLines, handlerOpenLine + 1)); // Zone 2
      }
      const statementNode = nearestStatement(node);
      const statementLine = sourceFile.getLineAndCharacterOfPosition(
        statementNode.getStart(),
      ).line;
      if (statementLine !== callLine) {
        zones.push(commentBlockAbove(sourceLines, statementLine - 1)); // Zone 3
      }
      const outcome = resolveSuppression(sourceLines, zones, relFile);
      if (outcome.consumedLine !== undefined) {
        consumedMarkerLines.add(outcome.consumedLine);
      }
      if (outcome.bareViolation) violations.push(outcome.bareViolation);

      let isSentinel = false;
      let detail = '.catch() handler swallows the rejection with a literal';
      if (
        handler &&
        (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
      ) {
        if (ts.isBlock(handler.body)) {
          if (handler.body.statements.length === 0) {
            isSentinel = true;
          } else if (
            handler.body.statements.length === 1 &&
            ts.isReturnStatement(handler.body.statements[0]) &&
            isLiteralOfInterest(
              (handler.body.statements[0] as ts.ReturnStatement).expression,
            )
          ) {
            isSentinel = true;
          }
        } else if (isLiteralOfInterest(handler.body)) {
          isSentinel = true;
        }
      } else if (handler && ts.isIdentifier(handler)) {
        // Revision 1 (moderate finding): a named-reference handler —
        // `.catch(noop)`, `.catch(externalNoop)` — is no longer invisible.
        const verdict = resolveCatchHandlerIdentifier(sourceFile, handler.text);
        if (verdict === 'sentinel') {
          isSentinel = true;
          detail = `.catch(${handler.text}) does not resolve to a handler that logs or rethrows`;
        } else if (verdict === 'unknown') {
          isSentinel = true;
          detail = `.catch(${handler.text}) — identifier not declared in this file; flagged for triage, could not verify it logs or rethrows`;
        }
      }
      if (isSentinel && !outcome.suppressed) {
        violations.push({
          file: relFile,
          line: callLine + 1,
          kind: 'promise-catch-sentinel',
          detail,
        });
      }
    }

    if (
      asyncNames &&
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression)
    ) {
      const call = node.expression;
      const name = calleeName(call.expression);
      if (name && asyncNames.has(name)) {
        const stmtLine = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(),
        ).line;
        const zones = [commentBlockAbove(sourceLines, stmtLine - 1)];
        const outcome = resolveSuppression(sourceLines, zones, relFile);
        if (outcome.consumedLine !== undefined) {
          consumedMarkerLines.add(outcome.consumedLine);
        }
        if (outcome.bareViolation) violations.push(outcome.bareViolation);
        if (!outcome.suppressed) {
          violations.push({
            file: relFile,
            line: stmtLine + 1,
            kind: 'floating-promise',
            detail: `bare call to async '${name}()' — not awaited, void-marked, or chained with .catch()`,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Revision 2 (B-1 / S-3): a marker that never attached to any flagged
  // CatchClause / .catch(...) / floating-promise site is orphaned, not silent.
  for (const idx of allMarkerLines) {
    if (consumedMarkerLines.has(idx)) continue;
    violations.push({
      file: relFile,
      line: idx + 1,
      kind: 'orphaned-suppression',
      detail: `degradation-audit marker did not attach to any flagged catch/.catch() site: "${(sourceLines[idx] ?? '').trim()}"`,
    });
  }

  return violations;
}

// --- directory grouping -------------------------------------------------

function projectDirFor(relFile: string): string {
  const segments = relFile.split('/');
  if (segments[0] === 'libs' && segments.length >= 3) {
    return segments.slice(0, 3).join('/');
  }
  if (segments[0] === 'apps' && segments.length >= 2) {
    return segments.slice(0, 2).join('/');
  }
  return segments.slice(0, Math.min(2, segments.length)).join('/');
}

// --- baseline -------------------------------------------------------------

type Baseline = Record<string, number>;

function loadBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
}

function writeBaseline(baseline: Baseline): void {
  const sorted: Baseline = {};
  for (const key of Object.keys(baseline).sort((a, b) =>
    a.localeCompare(b, 'en'),
  )) {
    sorted[key] = baseline[key];
  }
  fs.writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(sorted, null, 2)}\n`,
    'utf8',
  );
}

// --- runner -----------------------------------------------------------------

async function collectViolations(files: string[]): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const filePath of files) {
    const relFile = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
    violations.push(...detectInFile(filePath, relFile));
  }
  violations.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
  });
  return violations;
}

async function runSelfTest(): Promise<number> {
  // `__parse-failure__/` holds a deliberately malformed fixture exercised
  // separately by `--self-test-parse-guard` (Revision 1, style-review
  // Serious 1) — excluded here so the normal self-test isn't crashed by the
  // very file that proves the crash-on-malformed-input path still works.
  const files = await fg(['**/*.ts'], {
    cwd: FIXTURES_DIR,
    ignore: ['__parse-failure__/**'],
    absolute: true,
  });
  const violations = await collectViolations(files);

  if (violations.length === 0) {
    console.error(
      'degradation-audit self-test BROKEN: no violations detected in the planted fixtures (detector false-negative)',
    );
    return 2;
  }

  console.error(
    `degradation-audit self-test: ${violations.length} violation(s) detected in fixtures (expected)`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.kind}] ${v.detail}`);
  }
  return 1;
}

// Revision 1 (style-review Serious 1): the parse-failure guard reads
// `sourceFile.parseDiagnostics`, a field that exists at runtime on
// TypeScript 5.9.3 but is not declared in the public `.d.ts`. Replacing it
// with a real `ts.Program` was rejected as disproportionate setup for this
// tool's size; instead this dedicated check proves the guard fires TODAY and
// gives an early, loud signal (a failing self-test) the moment a TypeScript
// upgrade ever stops populating the field, rather than a malformed file
// silently scoring zero violations in production. Deliberately inverted
// exit-code convention from the main self-test: exit 2 here means the guard
// correctly detected the parse failure (PASS); exit 0 means it did not
// (BROKEN) — `run-self-test.js` expects exactly that.
async function runParseGuardTest(): Promise<number> {
  const fixturePath = path.join(
    FIXTURES_DIR,
    '__parse-failure__',
    'malformed.ts',
  );
  const relFile = path.relative(REPO_ROOT, fixturePath).replace(/\\/g, '/');
  try {
    detectInFile(fixturePath, relFile);
  } catch (err: unknown) {
    console.error(
      `degradation-audit parse-guard PASS: malformed fixture correctly raised a parse failure (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return 2;
  }
  console.error(
    'degradation-audit parse-guard BROKEN: malformed fixture did NOT raise a parse failure — ' +
      'the undeclared `parseDiagnostics` field this guard depends on may have changed shape ' +
      'in this TypeScript version',
  );
  return 0;
}

async function runLint(updateBaseline: boolean): Promise<number> {
  const files = await fg(SCAN_GLOBS, {
    cwd: REPO_ROOT,
    ignore: SCAN_IGNORE,
    absolute: true,
  });
  const violations = await collectViolations(files);

  const counts = new Map<string, number>();
  for (const v of violations) {
    const dir = projectDirFor(v.file);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }

  console.log(`degradation-audit: scanned ${files.length} file(s)`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line} [${v.kind}] ${v.detail}`);
  }

  const baseline = loadBaseline();
  const dirs = Array.from(
    new Set([...counts.keys(), ...Object.keys(baseline)]),
  ).sort((a, b) => a.localeCompare(b, 'en'));

  let failed = false;
  const nextBaseline: Baseline = { ...baseline };
  console.log('\ndegradation-audit: per-directory totals');
  for (const dir of dirs) {
    const count = counts.get(dir) ?? 0;
    const base = baseline[dir] ?? 0;
    let status: string;
    if (count > base) {
      status = `FAIL (baseline ${base})`;
      failed = true;
    } else {
      status = `ok (baseline ${base})`;
    }
    // Revision 1 (moderate finding): a baseline entry for a directory the
    // current scan no longer sees at all (deleted or renamed) reports
    // `0 ok (baseline N)` forever with nothing prompting cleanup. Surfaced,
    // not auto-pruned — `--update-baseline` still does the actual cleanup.
    const isStale = !counts.has(dir) && base > 0;
    if (isStale) {
      status +=
        ' — directory not found by this scan; run --update-baseline to prune';
    }
    console.log(`  ${dir}: ${count} ${status}`);
    if (updateBaseline && isStale) {
      delete nextBaseline[dir];
      continue;
    }
    if (updateBaseline && count < base) {
      nextBaseline[dir] = count;
    }
    if (updateBaseline && !(dir in baseline)) {
      nextBaseline[dir] = count;
    }
  }

  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  console.log(`\ndegradation-audit: TOTAL ${total} unsuppressed site(s)`);

  if (updateBaseline) {
    writeBaseline(nextBaseline);
    console.log('degradation-audit: baseline.json updated (drops only)');
  }

  return failed ? 1 : 0;
}

async function main(): Promise<number> {
  const selfTest = process.argv.includes('--self-test');
  const parseGuard = process.argv.includes('--self-test-parse-guard');
  const updateBaseline = process.argv.includes('--update-baseline');

  if (parseGuard) return runParseGuardTest();
  if (selfTest) return runSelfTest();
  return runLint(updateBaseline);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(
      'degradation-audit FAILED:',
      err instanceof Error ? err.message : err,
    );
    process.exit(2);
  });
