#!/usr/bin/env node
/**
 * Run Jest under ELECTRON'S BUNDLED NODE instead of the system Node.
 *
 * ## Why this exists
 *
 * `better-sqlite3` is a native addon. `postinstall` rebuilds it against
 * Electron's ABI (currently 143) because Electron is where it actually runs in
 * production. The system Node in this repo is v24.x, which is ABI 137, so the
 * module cannot load under a plain `nx test` — and the SQLite suites in
 * `persistence-sqlite` and `task-specs` detect that and SKIP themselves rather
 * than fail. A skipped suite is green, so a full gate reports success while the
 * SQL that persists a user's task metadata has never executed once.
 *
 * That misread the gate three times across TASK_2026_181 (gating note G1).
 * Electron's bundled Node is ABI 143 — the exact ABI the addon was built for —
 * so running the same Jest config through `electron` with
 * `ELECTRON_RUN_AS_NODE=1` loads the addon AS IT ALREADY IS. Nothing is
 * rebuilt, reinstalled, or repointed; `npm run test:native` and `nx test` read
 * the same sources and the same configs.
 *
 * ## Why a script rather than an inline npm script
 *
 * `ELECTRON_RUN_AS_NODE=1 electron …` is POSIX shell syntax and `npm run` uses
 * `cmd.exe` on Windows, where it is a syntax error. `cross-env` would fix that
 * but is only a TRANSITIVE dependency here, and a committed script that leans
 * on an undeclared package is a break waiting for an unrelated `npm install`.
 * Node sets the variable on the child directly and works identically on every
 * platform.
 *
 * ## Usage
 *
 *   npm run test:native                      # every project whose suite self-skips
 *   npm run test:native -- persistence-sqlite
 *   npm run test:native -- ptah-electron -t 'wizard-seed'
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const NATIVE_ABI_PROJECTS = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'scripts', 'native-abi-projects.json'),
    'utf8',
  ),
);

const args = process.argv.slice(2);
const requested = args.filter((arg) => !arg.startsWith('-'));
const jestArgs = args.filter((arg) => arg.startsWith('-'));
const projects = requested.length > 0 ? requested : NATIVE_ABI_PROJECTS;

function resolveJestConfig(project) {
  const candidates = [
    path.join(repoRoot, 'libs', 'backend', project, 'jest.config.ts'),
    path.join(repoRoot, 'apps', project, 'jest.config.ts'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** `electron`'s main export is the absolute path to its executable. */
const electronPath = require('electron');

const jestBin = (() => {
  try {
    return require.resolve('jest/bin/jest.js');
  } catch {
    return path.join(repoRoot, 'node_modules', 'jest', 'bin', 'jest.js');
  }
})();

if (!existsSync(jestBin)) {
  console.error(`[test:native] cannot find jest at ${jestBin}`);
  process.exit(1);
}

let exitCode = 0;

for (const project of projects) {
  const config = resolveJestConfig(project);
  if (!config) {
    console.error(`[test:native] no jest config for '${project}'`);
    exitCode = 1;
    continue;
  }

  console.log(`\n[test:native] ${project} — electron-as-node (ABI-matched)`);

  const cacheDir = path.join(
    repoRoot,
    'node_modules',
    '.cache',
    'test-native',
    project,
  );
  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(cacheDir, { recursive: true });

  const result = spawnSync(
    electronPath,
    [
      jestBin,
      '--config',
      config,
      '--cacheDirectory',
      cacheDir,
      ...jestArgs,
    ],
    {
      stdio: 'inherit',
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    },
  );

  if (result.error) {
    console.error(`[test:native] ${project} failed to start:`, result.error);
    exitCode = 1;
    continue;
  }
  if (result.status !== 0) exitCode = result.status ?? 1;
}

process.exit(exitCode);
