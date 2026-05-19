#!/usr/bin/env node
/**
 * fix-empty-catches.mjs
 *
 * Finds `try { ... } catch (...) { /* empty or comment-only *\/ }` and unwraps
 * the try-statement so its body executes without swallowing errors. The catch
 * was masking failures; removing it lets errors propagate.
 *
 * Default mode is dry-run: it lists every match and shows the replacement
 * preview. Pass `--apply` to rewrite files. Pass `--verbose` to print full
 * replacement diffs. Pass `--all` to include test files (skipped by default
 * because the workspace-intelligence quality rules and their fixtures contain
 * intentionally empty catch blocks).
 *
 * Usage:
 *   node scripts/fix-empty-catches.mjs              # dry run
 *   node scripts/fix-empty-catches.mjs --apply      # rewrite files
 *   node scripts/fix-empty-catches.mjs --verbose    # show diffs
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

const SKIP_PATH_FRAGMENTS = [
  // Quality rule that documents the empty-catch pattern via examples.
  ['libs', 'backend', 'workspace-intelligence', 'src', 'quality', 'rules', 'error-handling-rules.ts'].join(sep),
];

const TEST_FILE_RE = /\.(spec|test|integration\.spec)\.ts$/;

function listTypescriptFiles() {
  const out = execSync('git ls-files "*.ts"', { cwd: rootDir, encoding: 'utf8' });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((rel) => !rel.startsWith('node_modules/') && !rel.includes('/node_modules/'))
    .filter((rel) => !rel.startsWith('dist/') && !rel.startsWith('tmp/'))
    .filter((rel) => INCLUDE_TESTS || !TEST_FILE_RE.test(rel))
    .filter((rel) => !SKIP_PATH_FRAGMENTS.some((frag) => rel.split('/').join(sep).endsWith(frag)));
}

function isEffectivelyEmptyBlock(sourceFile, block) {
  if (block.statements.length > 0) return false;
  // Even with zero statements, the block may contain comments. Treat
  // comment-only catches as empty too - they swallow errors just the same.
  return true;
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

function dedentLines(snippet, dedentAmount) {
  if (dedentAmount <= 0) return snippet;
  return snippet
    .split('\n')
    .map((line) => {
      let strip = 0;
      while (strip < dedentAmount && strip < line.length && (line[strip] === ' ' || line[strip] === '\t')) {
        strip++;
      }
      return line.slice(strip);
    })
    .join('\n');
}

/**
 * Compute the replacement text for a TryStatement whose catch is empty and
 * which has no finally block. Returns null if we cannot safely rewrite.
 */
function buildReplacement(sourceFile, tryStatement) {
  if (tryStatement.finallyBlock) return null;
  const text = sourceFile.text;
  const tryBlock = tryStatement.tryBlock;
  const statements = tryBlock.statements;
  if (statements.length === 0) {
    // try {} catch (e) {} -> just delete the whole thing.
    return '';
  }

  const tryIndent = getIndentBefore(text, tryStatement.getStart(sourceFile)) ?? '';
  const firstStmt = statements[0];
  const firstIndent = getIndentBefore(text, firstStmt.getStart(sourceFile));
  if (firstIndent === null) return null;
  if (!firstIndent.startsWith(tryIndent)) return null;
  const dedentAmount = firstIndent.length - tryIndent.length;

  const innerStart = firstStmt.getFullStart();
  const lastStmt = statements[statements.length - 1];
  const innerEnd = lastStmt.getEnd();
  const innerText = text.slice(innerStart, innerEnd);

  // The leading whitespace of innerText is the newline + indent of the first
  // statement. Skip the leading newline so dedent can operate per-line.
  let leading = '';
  let body = innerText;
  const newlineIdx = innerText.indexOf('\n');
  if (newlineIdx !== -1 && innerText.slice(0, newlineIdx).trim() === '') {
    leading = innerText.slice(0, newlineIdx + 1);
    body = innerText.slice(newlineIdx + 1);
  }

  const dedented = dedentLines(body, dedentAmount);
  return leading + dedented;
}

function findEmptyCatches(sourceFile) {
  const matches = [];
  const visit = (node) => {
    if (ts.isCatchClause(node) && isEffectivelyEmptyBlock(sourceFile, node.block)) {
      const tryStatement = node.parent;
      if (tryStatement && ts.isTryStatement(tryStatement)) {
        matches.push({ tryStatement, catchClause: node });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
}

/**
 * Keep only matches whose try-statement is not enclosed by another match's
 * try-statement. Outermost matches do not overlap each other, so they can be
 * rewritten in a single descending-position pass without offset drift. Inner
 * matches surface again on the next parse after their enclosing try is gone.
 */
function selectOutermost(matches, sourceFile) {
  return matches.filter((m) => {
    const mStart = m.tryStatement.getStart(sourceFile);
    const mEnd = m.tryStatement.getEnd();
    return !matches.some((other) => {
      if (other === m) return false;
      const oStart = other.tryStatement.getStart(sourceFile);
      const oEnd = other.tryStatement.getEnd();
      return oStart < mStart && oEnd > mEnd;
    });
  });
}

const summary = {
  filesScanned: 0,
  filesWithMatches: 0,
  matches: 0,
  rewritten: 0,
  skippedFinally: 0,
  skippedUnsafe: 0,
};

const files = listTypescriptFiles();
const MAX_PASSES = 10;

for (const rel of files) {
  summary.filesScanned++;
  const abs = join(rootDir, rel);
  const originalText = readFileSync(abs, 'utf8');
  let updated = originalText;
  let totalEdits = 0;
  let sawAnyMatch = false;
  let totalSkippedFinally = 0;
  let totalSkippedUnsafe = 0;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const sourceFile = ts.createSourceFile(rel, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const allMatches = findEmptyCatches(sourceFile);
    if (allMatches.length === 0) break;
    sawAnyMatch = true;

    // Process outermost matches only in this pass; siblings don't overlap so
    // descending-position rewrites are safe. Nested inner matches will be
    // re-parsed and picked up in the next pass.
    const outermost = selectOutermost(allMatches, sourceFile);
    outermost.sort((a, b) => b.tryStatement.getStart(sourceFile) - a.tryStatement.getStart(sourceFile));

    let progressedThisPass = false;
    for (const { tryStatement, catchClause } of outermost) {
      const { line, col } = getLineCol(sourceFile, catchClause.getStart(sourceFile));
      if (tryStatement.finallyBlock) {
        totalSkippedFinally++;
        if (pass === 0) {
          console.log(`[skip:finally] ${rel}:${line}:${col} - has finally block, cannot auto-rewrite`);
        }
        continue;
      }
      const replacement = buildReplacement(sourceFile, tryStatement);
      if (replacement === null) {
        totalSkippedUnsafe++;
        if (pass === 0) {
          console.log(`[skip:unsafe] ${rel}:${line}:${col} - inconsistent indentation, manual review`);
        }
        continue;
      }
      const start = tryStatement.getStart(sourceFile);
      const end = tryStatement.getEnd();
      const before = updated.slice(0, start);
      const after = updated.slice(end);
      const originalSnippet = updated.slice(start, end);
      updated = before + replacement + after;
      totalEdits++;
      progressedThisPass = true;

      console.log(`[match] ${rel}:${line}:${col}${pass > 0 ? ` (pass ${pass + 1})` : ''}`);
      if (VERBOSE) {
        console.log('--- before ---');
        console.log(originalSnippet);
        console.log('--- after ---');
        console.log(replacement);
        console.log('--------------');
      }
    }

    if (!progressedThisPass) break;
  }

  if (!sawAnyMatch) continue;
  summary.filesWithMatches++;
  summary.matches += totalEdits + totalSkippedFinally + totalSkippedUnsafe;
  summary.skippedFinally += totalSkippedFinally;
  summary.skippedUnsafe += totalSkippedUnsafe;

  if (APPLY && totalEdits > 0 && updated !== originalText) {
    writeFileSync(abs, updated, 'utf8');
    summary.rewritten++;
    console.log(`[write] ${rel} (${totalEdits} edit${totalEdits === 1 ? '' : 's'})`);
  }
}

console.log('\nSummary:');
console.log(`  files scanned       : ${summary.filesScanned}`);
console.log(`  files with matches  : ${summary.filesWithMatches}`);
console.log(`  matches found       : ${summary.matches}`);
console.log(`  skipped (finally)   : ${summary.skippedFinally}`);
console.log(`  skipped (unsafe)    : ${summary.skippedUnsafe}`);
if (APPLY) {
  console.log(`  files rewritten     : ${summary.rewritten}`);
} else {
  console.log('  mode                : DRY RUN (pass --apply to rewrite)');
}
