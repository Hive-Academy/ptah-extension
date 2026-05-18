#!/usr/bin/env node
/**
 * add-ignore-deprecations.mjs
 *
 * Ensures every `tsconfig.lib.json` and `tsconfig.app.json` in the workspace
 * has `"ignoreDeprecations": "6.0"` inside its `compilerOptions` block.
 * Files that already have the key (any value) are left untouched.
 *
 * Default mode is dry-run: lists files that would be changed and prints the
 * insertion diff. Pass `--apply` to rewrite files. Pass `--verbose` to show
 * full before/after snippets for each insertion.
 *
 * Usage:
 *   node scripts/add-ignore-deprecations.mjs              # dry run
 *   node scripts/add-ignore-deprecations.mjs --apply      # rewrite files
 *   node scripts/add-ignore-deprecations.mjs --verbose    # show snippets
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VERBOSE = args.has('--verbose');

const TARGET_FILENAMES = new Set(['tsconfig.lib.json', 'tsconfig.app.json']);
const KEY = 'ignoreDeprecations';
const VALUE = '6.0';

function listTsconfigFiles() {
  const out = execSync('git ls-files "tsconfig.lib.json" "tsconfig.app.json" "**/tsconfig.lib.json" "**/tsconfig.app.json"', {
    cwd: rootDir,
    encoding: 'utf8',
  });
  return Array.from(
    new Set(
      out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((rel) => {
          const base = rel.split('/').pop();
          return TARGET_FILENAMES.has(base);
        }),
    ),
  );
}

/**
 * Detect whether the file already declares the key. We scan the raw text for
 * a quoted occurrence so we don't have to JSON-parse JSONC-with-comments.
 */
function hasKey(text) {
  return new RegExp(`"${KEY}"\\s*:`).test(text);
}

/**
 * Find the `compilerOptions` opening brace and return the index of the
 * character just after the `{`. Returns -1 if no compilerOptions block found.
 */
function findCompilerOptionsBodyStart(text) {
  const re = /"compilerOptions"\s*:\s*\{/g;
  const match = re.exec(text);
  if (!match) return -1;
  return match.index + match[0].length;
}

function detectIndent(text, insertPos) {
  // Look at the next non-blank line after insertPos to mirror existing indent.
  const after = text.slice(insertPos);
  const lineMatch = after.match(/\n([ \t]+)\S/);
  if (lineMatch) return lineMatch[1];
  // Fall back to extending the indent of the compilerOptions line by two spaces.
  const before = text.slice(0, insertPos);
  const lastNewline = before.lastIndexOf('\n');
  const lineStart = lastNewline + 1;
  const lineIndentMatch = text.slice(lineStart).match(/^[ \t]*/);
  const lineIndent = lineIndentMatch ? lineIndentMatch[0] : '';
  return lineIndent + '  ';
}

function buildInsertion(text, insertPos) {
  const indent = detectIndent(text, insertPos);
  // Mirror the newline convention of the surrounding file.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return `${eol}${indent}"${KEY}": "${VALUE}",`;
}

const summary = {
  filesScanned: 0,
  alreadyPresent: 0,
  noCompilerOptions: 0,
  toModify: 0,
  rewritten: 0,
};

const files = listTsconfigFiles();
for (const rel of files) {
  summary.filesScanned++;
  const abs = join(rootDir, rel);
  const text = readFileSync(abs, 'utf8');

  if (hasKey(text)) {
    summary.alreadyPresent++;
    continue;
  }

  const insertPos = findCompilerOptionsBodyStart(text);
  if (insertPos === -1) {
    summary.noCompilerOptions++;
    console.log(`[skip] ${rel} - no compilerOptions block found`);
    continue;
  }

  const insertion = buildInsertion(text, insertPos);
  const updated = text.slice(0, insertPos) + insertion + text.slice(insertPos);
  summary.toModify++;

  console.log(`[add] ${rel}`);
  if (VERBOSE) {
    const snippetStart = Math.max(0, insertPos - 40);
    const snippetEnd = Math.min(updated.length, insertPos + insertion.length + 80);
    console.log('--- inserting ---');
    console.log(updated.slice(snippetStart, snippetEnd));
    console.log('-----------------');
  }

  if (APPLY) {
    writeFileSync(abs, updated, 'utf8');
    summary.rewritten++;
    console.log(`[write] ${rel}`);
  }
}

console.log('\nSummary:');
console.log(`  files scanned          : ${summary.filesScanned}`);
console.log(`  already had key        : ${summary.alreadyPresent}`);
console.log(`  no compilerOptions     : ${summary.noCompilerOptions}`);
console.log(`  needing insertion      : ${summary.toModify}`);
if (APPLY) {
  console.log(`  files rewritten        : ${summary.rewritten}`);
} else {
  console.log('  mode                   : DRY RUN (pass --apply to rewrite)');
}
