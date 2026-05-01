#!/usr/bin/env node
/**
 * TASK_2026_104 Batch 1 — TUI → CLI rename helper
 *
 * Performs the mechanical pivot of `apps/ptah-tui` → `apps/ptah-cli`:
 *   1. Directory rename (apps/ptah-tui → apps/ptah-cli)
 *   2. File renames (tui-adapters.ts → cli-adapters.ts, etc.)
 *   3. In-file symbol renames (Tui* → Cli*, TUI_* → CLI_*, [TUI ...] → [CLI ...])
 *   4. Cross-project string updates (root package.json scripts, app package.json name,
 *      agent-sdk/rpc-handlers `'tui'` discriminator → `'cli'`)
 *
 * Usage:
 *   node scripts/rename-tui-to-cli.mjs --dry-run   # preview changes (default)
 *   node scripts/rename-tui-to-cli.mjs --apply     # actually mutate
 *   node scripts/rename-tui-to-cli.mjs --apply --skip-git   # skip `git mv`, use plain fs.rename
 *
 * Safe to re-run; if the rename has already happened, the script reports "no-op"
 * and exits 0.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { readdirSync, renameSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

const args = new Set(process.argv.slice(2));
const DRY_RUN = !args.has('--apply');
const SKIP_GIT = args.has('--skip-git');

const TUI_DIR = join(REPO_ROOT, 'apps', 'ptah-tui');
const CLI_DIR = join(REPO_ROOT, 'apps', 'ptah-cli');

// -----------------------------------------------------------------------------
// Symbol replacement table (applied INSIDE files, post-directory-rename)
// Order matters: longer/more-specific patterns first to avoid partial overlap.
// -----------------------------------------------------------------------------
const SYMBOL_REPLACEMENTS = [
  // Class / type names
  ['TuiOutputManagerAdapter', 'CliOutputManagerAdapter'],
  ['TuiLoggerAdapter', 'CliLoggerAdapter'],
  ['TuiRpcMethodRegistrationService', 'CliRpcMethodRegistrationService'],
  ['TuiBootstrapOptions', 'CliBootstrapOptions'],
  ['TuiBootstrapResult', 'CliBootstrapResult'],
  ['TuiDIContainer', 'CliDIContainer'],
  ['TuiContext', 'CliContext'], // only used inside the deleted React shell, but safe
  // Constants
  ['TUI_EXCLUDED_RPC_METHODS', 'CLI_EXCLUDED_RPC_METHODS'],
  // Log prefixes
  ['[TUI Main]', '[CLI Main]'],
  ['[TUI DI]', '[CLI DI]'],
  ['[TUI RPC]', '[CLI RPC]'],
  // Comment markers
  ['TUI CLI app', 'CLI app'],
  ['TUI application', 'CLI application'],
  ['TUI components', 'CLI components'],
  // Path strings
  ['apps/ptah-tui', 'apps/ptah-cli'],
  ['ptah-tui', 'ptah-cli'],
  // Platform discriminator (D2 — agent-sdk/rpc-handlers union)
  ["platform: 'tui'", "platform: 'cli'"],
  ["'tui' | 'electron' | 'vscode'", "'cli' | 'electron' | 'vscode'"],
  ["'electron' | 'tui' | 'vscode'", "'cli' | 'electron' | 'vscode'"],
  ["'vscode' | 'electron' | 'tui'", "'vscode' | 'electron' | 'cli'"],
];

// -----------------------------------------------------------------------------
// File renames (relative to apps/ptah-cli AFTER directory rename)
// -----------------------------------------------------------------------------
const FILE_RENAMES = [
  ['src/di/tui-adapters.ts', 'src/di/cli-adapters.ts'],
  [
    'src/services/tui-rpc-method-registration.service.ts',
    'src/services/cli-rpc-method-registration.service.ts',
  ],
];

// -----------------------------------------------------------------------------
// Cross-project string updates (specific files outside apps/ptah-cli)
// -----------------------------------------------------------------------------
const CROSS_PROJECT_STRING_UPDATES = [
  {
    file: 'package.json',
    edits: [
      ['"tui:build": "nx build ptah-tui"', '"cli:build": "nx build ptah-cli"'],
      ['"tui:dev": "nx dev ptah-tui"', '"cli:dev": "nx dev ptah-cli"'],
      [
        '"tui:serve": "nx build ptah-tui && node dist/apps/ptah-tui/main.mjs"',
        '"cli:serve": "nx build ptah-cli && node dist/apps/ptah-cli/main.mjs"',
      ],
    ],
  },
];

// -----------------------------------------------------------------------------
// app-local package.json updates (D7 — flip private:false)
// -----------------------------------------------------------------------------
const APP_PACKAGE_JSON_UPDATES = {
  file: 'package.json', // relative to apps/ptah-cli
  edits: [
    ['"@ptah-extension/ptah-tui"', '"@ptah-extensions/cli"'],
    ['"private": true', '"private": false'],
  ],
};

// -----------------------------------------------------------------------------
// Driver
// -----------------------------------------------------------------------------

const stats = {
  dirRenamed: false,
  filesRenamed: 0,
  filesEdited: 0,
  totalReplacements: 0,
  skipped: 0,
  errors: [],
};

function log(level, msg) {
  const tag = DRY_RUN ? '[DRY-RUN]' : '[APPLY]';
  console.log(`${tag} ${level} ${msg}`);
}

function runGit(cmd) {
  if (DRY_RUN || SKIP_GIT) return null;
  try {
    return execSync(cmd, { cwd: REPO_ROOT, stdio: 'pipe' }).toString();
  } catch (err) {
    stats.errors.push(`git failed: ${cmd}\n${err.message}`);
    return null;
  }
}

function gitMv(from, to) {
  const fromRel = relative(REPO_ROOT, from).split(sep).join('/');
  const toRel = relative(REPO_ROOT, to).split(sep).join('/');
  log('MOVE', `${fromRel} → ${toRel}`);
  if (DRY_RUN) return;
  if (SKIP_GIT) {
    renameSync(from, to);
    return;
  }
  // git mv preserves history; falls back to plain rename if not tracked
  const out = runGit(`git mv "${fromRel}" "${toRel}"`);
  if (out === null && existsSync(from) && !existsSync(to)) {
    renameSync(from, to);
  }
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml|html)$/i;

function applyReplacementsToFile(filePath, replacements) {
  if (!TEXT_EXT.test(filePath)) {
    stats.skipped++;
    return 0;
  }
  let src;
  try {
    src = readFileSync(filePath, 'utf8');
  } catch {
    stats.skipped++;
    return 0;
  }

  let updated = src;
  let count = 0;
  for (const [from, to] of replacements) {
    const before = updated;
    updated = updated.split(from).join(to);
    if (updated !== before) {
      const occurrences = before.split(from).length - 1;
      count += occurrences;
    }
  }

  if (count === 0) return 0;

  const rel = relative(REPO_ROOT, filePath);
  log('EDIT', `${rel} (${count} replacement${count === 1 ? '' : 's'})`);
  if (!DRY_RUN) writeFileSync(filePath, updated, 'utf8');
  stats.filesEdited++;
  stats.totalReplacements += count;
  return count;
}

// -----------------------------------------------------------------------------
// Step 1: Rename apps/ptah-tui → apps/ptah-cli
// -----------------------------------------------------------------------------
function step1RenameAppDir() {
  if (existsSync(CLI_DIR) && !existsSync(TUI_DIR)) {
    log('NOOP', 'apps/ptah-cli already exists, apps/ptah-tui already gone');
    return;
  }
  if (!existsSync(TUI_DIR)) {
    stats.errors.push(`apps/ptah-tui not found at ${TUI_DIR}`);
    return;
  }
  if (existsSync(CLI_DIR)) {
    stats.errors.push(`apps/ptah-cli already exists at ${CLI_DIR}; refusing to overwrite`);
    return;
  }
  gitMv(TUI_DIR, CLI_DIR);
  stats.dirRenamed = true;
}

// -----------------------------------------------------------------------------
// Step 2: Rename specific files inside apps/ptah-cli
// -----------------------------------------------------------------------------
function step2RenameFiles() {
  // In dry-run the directory move did not actually happen; fall back to TUI_DIR.
  const root = existsSync(CLI_DIR) ? CLI_DIR : TUI_DIR;
  for (const [from, to] of FILE_RENAMES) {
    const fromAbs = join(root, from);
    const toAbs = join(root, to);
    if (!existsSync(fromAbs)) {
      if (existsSync(toAbs)) {
        log('NOOP', `${from} already renamed to ${to}`);
        continue;
      }
      stats.errors.push(`expected file not found: ${fromAbs}`);
      continue;
    }
    gitMv(fromAbs, toAbs);
    stats.filesRenamed++;
  }
}

// -----------------------------------------------------------------------------
// Step 3: Apply symbol replacements across apps/ptah-cli
// -----------------------------------------------------------------------------
function step3SymbolReplacements() {
  const root = existsSync(CLI_DIR) ? CLI_DIR : TUI_DIR;
  const files = walkFiles(root);
  for (const f of files) {
    applyReplacementsToFile(f, SYMBOL_REPLACEMENTS);
  }
}

// -----------------------------------------------------------------------------
// Step 4: Apply app-local package.json updates
// -----------------------------------------------------------------------------
function step4AppPackageJson() {
  const root = existsSync(CLI_DIR) ? CLI_DIR : TUI_DIR;
  const file = join(root, APP_PACKAGE_JSON_UPDATES.file);
  if (existsSync(file)) {
    applyReplacementsToFile(file, APP_PACKAGE_JSON_UPDATES.edits);
  }
}

// -----------------------------------------------------------------------------
// Step 5: Apply cross-project string updates (root package.json, etc.)
// -----------------------------------------------------------------------------
function step5CrossProjectUpdates() {
  for (const target of CROSS_PROJECT_STRING_UPDATES) {
    const file = join(REPO_ROOT, target.file);
    if (existsSync(file)) {
      applyReplacementsToFile(file, target.edits);
    }
  }
}

// -----------------------------------------------------------------------------
// Step 6: Sweep agent-sdk + rpc-handlers for `'tui'` platform discriminator
// (handled by SYMBOL_REPLACEMENTS — but those run only on apps/ptah-cli).
// We need an explicit pass on libs/backend/.
// -----------------------------------------------------------------------------
function step6PlatformDiscriminator() {
  const targets = [
    join(REPO_ROOT, 'libs', 'backend', 'agent-sdk'),
    join(REPO_ROOT, 'libs', 'backend', 'rpc-handlers'),
  ];
  // Only the platform-related replacements (avoid renaming unrelated TUI strings in libs)
  const PLATFORM_ONLY = SYMBOL_REPLACEMENTS.filter(
    ([from]) =>
      from.includes("'tui'") ||
      from.includes("platform: 'tui'") ||
      from === '[TUI Main]' ||
      from === '[TUI DI]' ||
      from === '[TUI RPC]',
  );
  for (const dir of targets) {
    if (!existsSync(dir)) continue;
    for (const f of walkFiles(dir)) {
      applyReplacementsToFile(f, PLATFORM_ONLY);
    }
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
function main() {
  console.log('═'.repeat(72));
  console.log(`  TASK_2026_104 — TUI → CLI rename helper`);
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no changes written)' : 'APPLY'}`);
  console.log(`  Git:  ${SKIP_GIT ? 'plain rename' : 'git mv (history-preserving)'}`);
  console.log('═'.repeat(72));
  console.log();

  step1RenameAppDir();
  step2RenameFiles();
  step3SymbolReplacements();
  step4AppPackageJson();
  step5CrossProjectUpdates();
  step6PlatformDiscriminator();

  console.log();
  console.log('─'.repeat(72));
  console.log('  Summary');
  console.log('─'.repeat(72));
  console.log(`  Directory rename:     ${stats.dirRenamed ? 'apps/ptah-tui → apps/ptah-cli' : 'no-op'}`);
  console.log(`  Files renamed:        ${stats.filesRenamed}`);
  console.log(`  Files edited:         ${stats.filesEdited}`);
  console.log(`  Total replacements:   ${stats.totalReplacements}`);
  console.log(`  Files skipped (binary/non-text): ${stats.skipped}`);
  if (stats.errors.length > 0) {
    console.log();
    console.log(`  ⚠ Errors (${stats.errors.length}):`);
    for (const err of stats.errors) console.log(`    - ${err}`);
  }
  console.log();
  if (DRY_RUN) {
    console.log('  Run with --apply to perform the changes.');
  } else {
    console.log('  Done. Recommended next steps:');
    console.log('    1. npm install                   # refresh lockfile if package.json changed');
    console.log('    2. nx build ptah-cli             # verify build');
    console.log('    3. npm run typecheck:all         # verify types');
    console.log('    4. npm run lint:all              # verify lint');
    console.log('    5. git status                    # review the rename diff');
  }
  process.exit(stats.errors.length > 0 ? 1 : 0);
}

main();
