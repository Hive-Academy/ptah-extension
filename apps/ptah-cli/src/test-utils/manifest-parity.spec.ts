/**
 * Guards `apps/ptah-cli/package.json` against version drift from the root
 * `package.json` (TASK_2026_498).
 *
 * This manifest is not generated. `ptah-cli:restore-cli-manifest` copies it
 * byte-for-byte into `dist/apps/ptah-cli/package.json`, and `npm publish`
 * ships that file verbatim to every `@hive-academy/ptah-cli` consumer. Its
 * dependency versions are therefore hand-maintained, and nothing else in the
 * build reads them back — `prune-dist-deps.js` and `validate-deps.js` check
 * dependency NAMES only, never version strings. `apps/ptah-electron` does not
 * have this problem: `generatePackageJson: true` regenerates its manifest from
 * the root-resolved graph at build time, so its versions are self-healing.
 *
 * Two real defects found on 2026-09-21 are what this file exists to prevent:
 *
 * 1. Seven packages (`zod`, `react`, `minimatch`, `picomatch`, `fast-glob`,
 *    `ulid`, `eventemitter3`) carried looser ranges here than the root pinned,
 *    so a published CLI could resolve a version the monorepo had deliberately
 *    excluded. `react` is the sharp case: the root constrains it to `~19.2.0`
 *    because `@react-three/fiber` peers `react >=19 <19.3` at EVERY published
 *    version, while this file said `^19.2.0` and would have resolved 19.3.
 * 2. `@clack/prompts` was imported by `src/cli/commands/init.ts` and
 *    `src/cli/commands/provider.ts` and declared here, but was absent from the
 *    root manifest entirely. It resolved only because `astro` — the docs app —
 *    happened to hoist it. Two CLI commands worked by accident.
 *
 * The PHANTOM check below is the one that catches defect 2, and it is the more
 * valuable of the two: a version mismatch degrades a published package, but a
 * phantom dependency breaks it the moment an unrelated app changes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const ROOT_MANIFEST_PATH = join(REPO_ROOT, 'package.json');
const CLI_MANIFEST_PATH = join(REPO_ROOT, 'apps', 'ptah-cli', 'package.json');

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const rootManifest = JSON.parse(
  readFileSync(ROOT_MANIFEST_PATH, 'utf8'),
) as Manifest;
const cliManifest = JSON.parse(
  readFileSync(CLI_MANIFEST_PATH, 'utf8'),
) as Manifest;

/**
 * The root declares a package in either section — `typescript` sits in
 * `devDependencies` at the root while the CLI ships it as a runtime
 * `dependency`. The section a package lives in is a separate question from
 * which VERSION it pins, and only the version is in scope here.
 */
const rootVersions: Record<string, string> = {
  ...(rootManifest.devDependencies ?? {}),
  ...(rootManifest.dependencies ?? {}),
};

const cliDependencies = cliManifest.dependencies ?? {};
const cliDependencyNames = Object.keys(cliDependencies);

describe('ptah-cli manifest parity (anti-vacuity)', () => {
  it('both manifests parse and declare dependencies', () => {
    expect(cliDependencyNames.length).toBeGreaterThan(0);
    expect(Object.keys(rootVersions).length).toBeGreaterThan(0);
  });

  // Without this, a future edit that emptied the CLI's `dependencies` block
  // would make every `it.each` below vacuously pass by iterating nothing.
  it('declares at least 30 dependencies', () => {
    expect(cliDependencyNames.length).toBeGreaterThanOrEqual(30);
  });
});

describe.each(cliDependencyNames)('%s', (name) => {
  it('is declared in the root package.json (not a phantom dependency)', () => {
    expect(rootVersions[name]).toBeDefined();
  });

  it('pins the same version specifier as the root package.json', () => {
    expect(cliDependencies[name]).toBe(rootVersions[name]);
  });
});
