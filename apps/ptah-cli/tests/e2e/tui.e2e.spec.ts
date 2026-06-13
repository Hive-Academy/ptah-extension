/**
 * TUI smoke — installed-bundle contract for `ptah tui`.
 *
 * These specs exercise the dist `main.mjs tui` entry exactly as an end user
 * would after `npm install -g @hive-academy/ptah-cli`. They are the regression
 * tripwires for the three load-bearing TUI invariants:
 *
 *   1. No-TTY (piped stdin) refuses to run: exit != 0, an explanatory TTY
 *      message on stderr, and ZERO bytes on stdout (the TUI must never leak
 *      output to a pipe — it would corrupt downstream NDJSON consumers).
 *   2. A missing `tui.mjs` produces an actionable bundle error rather than an
 *      opaque crash. We build a hermetic temp install (main.mjs + package.json
 *      WITHOUT tui.mjs) and invoke it with PTAH_TUI_SMOKE=1 so the TTY guard
 *      does not short-circuit before the dynamic import is attempted. The temp
 *      dir gets a `node_modules` junction to the repo root so `main.mjs`'s
 *      externalized deps (reflect-metadata, ink, …) still resolve — otherwise
 *      `main.mjs` would die at module load before the tui loader ever runs. The
 *      real dist is never touched.
 *   3. `PTAH_TUI_SMOKE=1 node main.mjs tui` boots the full engine, renders one
 *      frame, disposes, and exits 0 — and crucially emits NO JSON-RPC NDJSON
 *      frames on stdout while the TUI owns the terminal, and the process
 *      actually terminates (no lingering native handle hang on Windows).
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

import { CliRunner, createTmpHome, type TmpHome } from './_harness';

jest.setTimeout(120_000);

interface SpawnResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function cleanEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['ANTHROPIC_API_KEY'];
  delete env['ANTHROPIC_AUTH_TOKEN'];
  delete env['OPENAI_API_KEY'];
  delete env['COPILOT_TOKEN'];
  delete env['GITHUB_TOKEN'];
  env['FORCE_COLOR'] = '0';
  env['NO_COLOR'] = '1';
  env['HOME'] = home;
  env['USERPROFILE'] = home;
  env['APPDATA'] = path.join(home, 'AppData', 'Roaming');
  env['LOCALAPPDATA'] = path.join(home, 'AppData', 'Local');
  return env;
}

/**
 * Spawn `node <mainMjs> tui` directly (no harness oneshot wrapper) so we can
 * pipe stdin, capture raw stdout/stderr, and assert on the exact exit signal.
 * stdin is a pipe that is ended immediately, emulating a non-TTY invocation.
 */
function spawnTui(opts: {
  mainMjs: string;
  home: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(process.execPath, [opts.mainMjs, 'tui'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.home,
      env: { ...cleanEnv(opts.home), ...(opts.env ?? {}) },
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: string) => (stdout += c));
    child.stderr.on('data', (c: string) => (stderr += c));

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new Error(
          `spawnTui timed out after ${opts.timeoutMs}ms — process did not ` +
            `terminate. stderr tail: ${stderr.slice(-400)}`,
        ),
      );
    }, opts.timeoutMs);

    child.stdin.end();

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, signal, stdout, stderr });
    });
  });
}

describe('ptah tui smoke', () => {
  let tmp: TmpHome;

  beforeEach(async () => {
    tmp = await createTmpHome('ptah-tui-e2e-');
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('piped stdin (no TTY) exits non-zero with a TTY message and zero stdout', async () => {
    const result = await spawnTui({
      mainMjs: CliRunner.DIST_BIN,
      home: tmp.path,
      timeoutMs: 30_000,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.toLowerCase()).toMatch(/interactive terminal|tty/);
  });

  it('missing tui.mjs yields an actionable bundle error', async () => {
    const fakeDist = path.join(tmp.path, 'fake-dist');
    await fsp.mkdir(fakeDist, { recursive: true });

    const realDir = path.dirname(CliRunner.DIST_BIN);
    await fsp.copyFile(CliRunner.DIST_BIN, path.join(fakeDist, 'main.mjs'));
    await fsp.copyFile(
      path.join(realDir, 'package.json'),
      path.join(fakeDist, 'package.json'),
    );
    await fsp
      .copyFile(
        path.join(realDir, 'embedder-worker.mjs'),
        path.join(fakeDist, 'embedder-worker.mjs'),
      )
      .catch(() => undefined);

    const repoRoot = path.resolve(realDir, '..', '..', '..');
    await fsp.symlink(
      path.join(repoRoot, 'node_modules'),
      path.join(fakeDist, 'node_modules'),
      'junction',
    );

    const result = await spawnTui({
      mainMjs: path.join(fakeDist, 'main.mjs'),
      home: tmp.path,
      env: { PTAH_TUI_SMOKE: '1' },
      timeoutMs: 30_000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Unable to load the Ptah TUI bundle/);
    expect(result.stderr.toLowerCase()).toMatch(
      /reinstall|@hive-academy\/ptah-cli|nx build ptah-tui/,
    );
  });

  it('PTAH_TUI_SMOKE=1 boots, renders one frame, exits 0 with no NDJSON on stdout', async () => {
    const result = await spawnTui({
      mainMjs: CliRunner.DIST_BIN,
      home: tmp.path,
      env: { PTAH_TUI_SMOKE: '1' },
      timeoutMs: 90_000,
    });

    expect(result.signal).toBeNull();
    expect(result.exitCode).toBe(0);

    const ndjsonFrames = result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l) => l.includes('"jsonrpc"'));
    expect(ndjsonFrames).toEqual([]);
  });
});
