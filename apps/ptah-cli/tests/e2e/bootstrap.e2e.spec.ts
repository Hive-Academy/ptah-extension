/**
 * Bootstrap — version / help / interact handshake.
 *
 * Smoke-level coverage that the dist bundle launches at all.
 *
 * Important: `ptah interact` requires SDK init which fails without an
 * Anthropic auth source. To prove `session.ready` fires we inject a fake
 * `ANTHROPIC_API_KEY` so `AuthManager.configureAuthentication('apiKey')`
 * resolves `configured: true`. The fake key never makes a real upstream
 * call because the bootstrap test never calls `task.submit`.
 */

import {
  CliRunner,
  createTmpHome,
  type TmpHome,
  type RunnerHandle,
} from './_harness';

jest.setTimeout(60_000);

const FAKE_API_KEY = 'sk-ant-e2e-fake-key-not-real-do-not-call-upstream';

describe('ptah-cli bootstrap', () => {
  let tmp: TmpHome;
  let runner: RunnerHandle | undefined;

  beforeEach(async () => {
    tmp = await createTmpHome();
  });

  afterEach(async () => {
    if (runner) {
      try {
        await runner.shutdown();
      } catch {
        try {
          await runner.kill();
        } catch {
          /* swallow */
        }
      }
      runner = undefined;
    }
    await tmp.cleanup();
  });

  it('--version prints a semver and exits 0', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['--version'],
      timeoutMs: 15_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdoutRaw).toMatch(/\b\d+\.\d+\.\d+\b/);
  });

  it('--help lists subcommands and exits 0', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['--help'],
      timeoutMs: 15_000,
    });
    expect(result.exitCode).toBe(0);
    // Commander's `--help` prints to stdout for the root program.
    expect(result.stdoutRaw.toLowerCase()).toMatch(/usage|commands/);
    expect(result.stdoutRaw).toMatch(/session/);
    expect(result.stdoutRaw).toMatch(/interact/);
  });

  it('interact emits session.ready with capabilities + protocol_version', async () => {
    runner = await CliRunner.spawn({
      home: tmp,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
    });
    expect(runner.ready.protocol_version).toBe('2.0');
    expect(typeof runner.ready.session_id).toBe('string');
    expect(runner.ready.session_id.length).toBeGreaterThan(0);
    expect(runner.ready.capabilities).toEqual(
      expect.arrayContaining(['chat', 'session', 'permission', 'question']),
    );
  });

  it('EOF on stdin terminates the process with exit 0', async () => {
    runner = await CliRunner.spawn({
      home: tmp,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
    });
    runner.child.stdin.end();
    // Wait for exit without sending session.shutdown.
    const exitCode = await new Promise<number | null>((resolve) => {
      runner!.child.once('exit', (code) => resolve(code));
    });
    expect(exitCode).toBe(0);
  });
});
