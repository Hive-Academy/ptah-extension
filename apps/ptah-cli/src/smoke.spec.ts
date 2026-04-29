/**
 * Smoke tests — built dist binary boots and responds to the basic CLI surface.
 *
 * SAFETY NET against future bootstrap regressions. Even if `--help` and
 * `--version` don't go through `withEngine`, validating that the bundle
 * launches at all catches a class of bugs (missing dependency, ESM resolution
 * failure as in cli-shift.md "Bug B", broken main.mjs shebang).
 *
 * Tests are SKIPPED automatically when `dist/apps/ptah-cli/main.mjs` is not
 * present (i.e. local dev mode without a build) so the dev-loop test runs
 * stay fast. After `nx build ptah-cli`, the suite runs and asserts on stdout.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

// Resolve repo root from this test file: apps/ptah-cli/src/smoke.spec.ts
// → ../../../  is the repo root (D:/projects/ptah-extension).
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST_BIN = path.join(REPO_ROOT, 'dist', 'apps', 'ptah-cli', 'main.mjs');

const distExists = existsSync(DIST_BIN);

const describeIfBuilt = distExists ? describe : describe.skip;

describeIfBuilt('ptah-cli smoke (dist/apps/ptah-cli/main.mjs)', () => {
  it('--version exits 0 and prints a semver-shaped string', () => {
    const result = spawnSync(process.execPath, [DIST_BIN, '--version'], {
      encoding: 'utf8',
      timeout: 30_000,
      // Disable color so output is deterministic on Windows terminals.
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    // commander prints `<version>\n` for `--version`. Accept anything that
    // looks vaguely semver-shaped (digits and dots) without locking on the
    // exact value; we only care that the bundle launched.
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('--help exits 0 and prints a usage banner mentioning subcommands', () => {
    const result = spawnSync(process.execPath, [DIST_BIN, '--help'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    // Standard commander help shape — assert on the broad usage line and at
    // least one of the headline subcommands. Loose so the test survives
    // future help-text edits.
    expect(result.stdout.toLowerCase()).toContain('usage');
    // 'session' is one of the most stable subcommand names in the CLI.
    expect(result.stdout.toLowerCase()).toContain('session');
  });

  it('unknown command exits non-zero (commander rejects)', () => {
    const result = spawnSync(
      process.execPath,
      [DIST_BIN, 'this-command-does-not-exist'],
      {
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      },
    );
    expect(result.error).toBeUndefined();
    // Non-zero exit. We don't lock the exact code (commander uses 1, our
    // dispatcher may map to 2 — either is acceptable).
    expect(result.status).not.toBe(0);
  });
});
