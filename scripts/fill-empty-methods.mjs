#!/usr/bin/env node
/**
 * fill-empty-methods.mjs
 *
 * Finds methods on classes that `implements` one or more interfaces where the
 * method body is empty (zero statements; comment-only bodies count as empty)
 * and injects a `console.log('ClassName.methodName called')` so the no-op is
 * observable at runtime.
 *
 * Scope:
 *   - Only `class X implements Y { ... }` declarations are touched.
 *   - Only `MethodDeclaration` members - constructors, getters/setters, and
 *     abstract/overload signatures are skipped.
 *   - Only methods with a body whose statement list is empty are filled.
 *
 * Default mode is dry-run. Pass `--apply` to write. Pass `--verbose` to print
 * full insertion previews. Pass `--all` to include test files.
 *
 * Usage:
 *   node scripts/fill-empty-methods.mjs              # dry run
 *   node scripts/fill-empty-methods.mjs --apply      # rewrite files
 *   node scripts/fill-empty-methods.mjs --verbose    # show snippets
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose');
const INCLUDE_TESTS = args.has('--all');

const TEST_FILE_RE = /\.(spec|test|integration\.spec)\.ts$/;

function listTypescriptFiles() {
  const out = execSync('git ls-files "*.ts"', { cwd: rootDir, encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((rel) => !rel.startsWith('node_modules/') && !rel.includes('/node_modules/'))
    .filter((rel) => !rel.startsWith('dist/') && !rel.startsWith('tmp/'))
    .filter((rel) => INCLUDE_TESTS || !TEST_FILE_RE.test(rel));
}

function getLineCol(sourceFile, pos) {
  const lc = sourceFile.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, col: lc.character + 1 };
}

function getIndentBefore(text, pos) {
  let i = pos - 1;
  while (i >= 0 && text[i] !== '\n') {
    if (text[i] !== ' ' && text[i] !== '\t') return null;
    i--;
  }
  return text.slice(i + 1, pos);
}

function classImplementsAny(node) {
  if (!node.heritageClauses) return false;
  return node.heritageClauses.some((h) => h.token === ts.SyntaxKind.ImplementsKeyword);
}

function isFillableMethod(member) {
  if (!ts.isMethodDeclaration(member)) return false;
  if (!member.body) return false; // abstract or overload signature
  if (member.body.statements.length !== 0) return false;
  // Skip computed-name methods - we cannot synthesize a clean log label.
  if (member.name && ts.isComputedPropertyName(member.name)) return false;
  return true;
}

function methodNameText(member) {
  const name = member.name;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function findFills(sourceFile) {
  const fills = [];
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && classImplementsAny(node)) {
      const className = node.name ? node.name.text : '<anonymous>';
      for (const member of node.members) {
        if (!isFillableMethod(member)) continue;
        const methodName = methodNameText(member);
        if (!methodName) continue;
        fills.push({ classNode: node, className, member, methodName });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return fills;
}

function buildInsertion(sourceFile, member, className, methodName) {
  const text = sourceFile.text;
  const body = member.body;
  const openBrace = body.getStart(sourceFile);
  const closeBrace = body.getEnd() - 1;

  const methodIndent = getIndentBefore(text, member.getStart(sourceFile)) ?? '';
  const stmtIndent = methodIndent + '  ';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const logLine = `console.log('${className}.${methodName} called');`;

  // Replace whatever is between `{` and `}` with a freshly indented line.
  // This normalises comment-only and whitespace-only bodies the same way.
  const replacement = `{${eol}${stmtIndent}${logLine}${eol}${methodIndent}}`;
  return { start: openBrace, end: closeBrace + 1, replacement };
}

const summary = {
  filesScanned: 0,
  filesWithFills: 0,
  fillsInserted: 0,
};

const files = listTypescriptFiles();
for (const rel of files) {
  summary.filesScanned++;
  const abs = join(rootDir, rel);
  const text = readFileSync(abs, 'utf8');
  const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fills = findFills(sourceFile);
  if (fills.length === 0) continue;

  summary.filesWithFills++;
  summary.fillsInserted += fills.length;

  fills.sort((a, b) => b.member.getStart(sourceFile) - a.member.getStart(sourceFile));

  let updated = text;
  for (const fill of fills) {
    const { line, col } = getLineCol(sourceFile, fill.member.getStart(sourceFile));
    const { start, end, replacement } = buildInsertion(sourceFile, fill.member, fill.className, fill.methodName);
    const originalSnippet = updated.slice(start, end);
    updated = updated.slice(0, start) + replacement + updated.slice(end);

    console.log(`[fill] ${rel}:${line}:${col} ${fill.className}.${fill.methodName}`);
    if (VERBOSE) {
      console.log('--- before ---');
      console.log(originalSnippet);
      console.log('--- after ---');
      console.log(replacement);
      console.log('--------------');
    }
  }

  if (APPLY) {
    writeFileSync(abs, updated, 'utf8');
    console.log(`[write] ${rel} (${fills.length} fill${fills.length === 1 ? '' : 's'})`);
  }
}

console.log('\nSummary:');
console.log(`  files scanned       : ${summary.filesScanned}`);
console.log(`  files with fills    : ${summary.filesWithFills}`);
console.log(`  methods filled      : ${summary.fillsInserted}`);
if (APPLY) {
  console.log('  mode                : APPLY');
} else {
  console.log('  mode                : DRY RUN (pass --apply to rewrite)');
}
