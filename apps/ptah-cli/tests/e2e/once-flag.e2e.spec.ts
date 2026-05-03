/**
 * Bug 5 (TASK_2026_107 commit `07108d76`).
 *
 * `ptah session start --task ... --once` must:
 *   1. Wait for the chat-bridge terminal `task.complete` / `task.error`
 *      notification BEFORE exiting (block-then-exit, not run-then-exit).
 *   2. Drain stdout completely so the tail notification is not truncated.
 *   3. Exit with a meaningful code (0 on success; non-zero on auth/license/
 *      internal failure per ExitCode enum).
 *
 * Driven through one-shot subcommand spawn (the `--once` flag lives on
 * `session start`, not on `interact`).
 */

import { CliRunner, createTmpHome, type TmpHome } from './_harness';

jest.setTimeout(60_000);

const FAKE_API_KEY = 'sk-ant-e2e-fake-key-not-real-do-not-call-upstream';

describe('--once flag (Bug 5)', () => {
  let tmp: TmpHome;

  beforeEach(async () => {
    tmp = await createTmpHome();
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('session start --task --once exits after a terminal task notification with stdout fully drained', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        '--json',
        '--auto-approve',
        'session',
        'start',
        '--task',
        'ping',
        '--once',
      ],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 45_000,
    });

    // Block-then-exit: process must have terminated (exitCode set), not been
    // killed by our timeout.
    expect(result.exitCode).not.toBeNull();
    expect(result.signal).toBeNull();
    // Exit code must be in the documented set: success or one of the
    // structured failure codes (general / usage / auth / license / internal).
    expect([0, 1, 2, 3, 4, 5]).toContain(result.exitCode!);

    // Drain assertion: the LAST non-empty stdout line must be valid JSON
    // (no truncated tail). `hasMalformedStdout` proves at least one line
    // was unparseable; for `--json` mode every line should be NDJSON.
    expect(result.hasMalformedStdout).toBe(false);

    // A terminal envelope (`task.complete` or `task.error`) must be present
    // — proves chat-bridge fired the terminal event AND `--once` waited
    // for it before exiting (Bug 5 + Bug 1+4 interaction).
    const terminal = result.stdoutLines.find(
      (l): l is { method: string; params: unknown } =>
        isObj(l) &&
        (l['method'] === 'task.complete' || l['method'] === 'task.error'),
    );
    expect(terminal).toBeTruthy();
  });
});

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
