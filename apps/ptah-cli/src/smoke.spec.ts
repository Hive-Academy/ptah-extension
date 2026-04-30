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

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

// Resolve repo root from this test file: apps/ptah-cli/src/smoke.spec.ts
// → ../../../  is the repo root (D:/projects/ptah-extension).
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST_BIN = path.join(REPO_ROOT, 'dist', 'apps', 'ptah-cli', 'main.mjs');

const distExists = existsSync(DIST_BIN);

const describeIfBuilt = distExists ? describe : describe.skip;

jest.setTimeout(60_000);

// Wait helper — polls a predicate until truthy or timeout. Returns the
// resolved value (or `undefined` if the predicate never returns a truthy
// value within the timeout window).
async function waitFor<T>(
  fn: () => T | Promise<T>,
  timeoutMs: number,
  intervalMs = 100,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return undefined;
}

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

  // ---------------------------------------------------------------------------
  // TASK_2026_108 T4 (Task 4.4) — proxy gate fail-fast (Smoke 3) and
  // registry cleanup on graceful shutdown (Smoke 4 minus the curl healthz
  // check, which is reserved for the bash smoke harness). Both scenarios
  // exercise the dist binary via `child_process.spawn`.
  // ---------------------------------------------------------------------------

  describe('proxy permission-gate fail-fast (Smoke 3)', () => {
    it('exits with AuthRequired when neither --auto-approve nor PTAH_INTERACT_ACTIVE is set', () => {
      // Strip the env-var marker so the gate trips even when a parent test
      // process happens to have it set.
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      };
      delete env['PTAH_INTERACT_ACTIVE'];

      const result = spawnSync(
        process.execPath,
        [DIST_BIN, 'proxy', 'start', '--port', '0'],
        {
          encoding: 'utf8',
          timeout: 10_000,
          env,
        },
      );

      expect(result.error).toBeUndefined();
      // ExitCode.AuthRequired === 3.
      expect(result.status).toBe(3);
      expect(result.stderr).toContain('"error":"permission_gate_unavailable"');
    });
  });

  describe('proxy registry cleanup on graceful shutdown (Smoke 4)', () => {
    const TEST_PORT = 18768;
    const REGISTRY_PATH = path.join(
      homedir(),
      '.ptah',
      'proxies',
      `${TEST_PORT}.json`,
    );

    afterEach(async () => {
      // Defensive: remove the registry file even if a previous run leaked it.
      await rm(REGISTRY_PATH, { force: true });
    });

    // POSIX-only — Node `child.kill('SIGTERM')` on Windows resolves to
    // `TerminateProcess`, which kills the child without giving the proxy's
    // `finally` block a chance to run `unregister()`. The bash smoke
    // harness covers Windows via Git Bash `kill -TERM`, which Node's
    // signal-handler shim DOES catch — different code path. Keep this Jest
    // assertion gated on POSIX so CI on `windows-latest` doesn't bounce.
    const itPosix = process.platform === 'win32' ? it.skip : it;

    itPosix('removes the registry entry after SIGTERM teardown', async () => {
      await rm(REGISTRY_PATH, { force: true });

      const child = spawn(
        process.execPath,
        [
          DIST_BIN,
          'proxy',
          'start',
          '--port',
          String(TEST_PORT),
          '--auto-approve',
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
        },
      );

      try {
        // Wait for the proxy to register itself in `~/.ptah/proxies/`.
        const registered = await waitFor(
          () => existsSync(REGISTRY_PATH),
          15_000,
          200,
        );
        // If the proxy never registered, surface stderr for diagnosis.
        if (!registered) {
          let stderrBuf = '';
          child.stderr?.on('data', (c) => {
            stderrBuf += c.toString('utf8');
          });
          await new Promise((r) => setTimeout(r, 200));
          throw new Error(
            `proxy never registered ${REGISTRY_PATH}; stderr=${stderrBuf}`,
          );
        }

        // Send SIGTERM and wait for exit.
        const exitPromise = new Promise<number | null>((resolve) => {
          child.once('exit', (code) => resolve(code));
        });
        child.kill('SIGTERM');
        await Promise.race([
          exitPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('exit timeout')), 10_000),
          ),
        ]);

        // The `finally` block in `executeStart` calls `unregister(port)` on
        // both SIGTERM and proxy.shutdown paths. Assert the registry file
        // is gone.
        expect(existsSync(REGISTRY_PATH)).toBe(false);
      } finally {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }
    });
  });
});
