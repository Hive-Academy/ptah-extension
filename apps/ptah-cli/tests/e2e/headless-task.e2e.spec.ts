/**
 * Bug 1 + Bug 4 (TASK_2026_107 commit `38536e14`).
 *
 * `chat-bridge` emits a TERMINAL `task.complete` or `task.error` notification
 * on every settle path so headless consumers can deterministically detect
 * end-of-turn. Before the fix, only the request response was sent and the
 * notification stream had no terminal envelope — `--once` and CI loops hung.
 *
 * We exercise the failure path:
 *   - inject a fake `ANTHROPIC_API_KEY` so SDK init succeeds and interact
 *     reaches `session.ready`;
 *   - submit `task.submit` with the dummy key, which causes the SDK call to
 *     fail upstream (auth/network/etc.);
 *   - assert a `task.error` notification with `params.command === 'task.submit'`
 *     lands on stdout (proving the chat-bridge terminal-event wiring runs).
 *
 * Concurrent + cancel paths are also exercised because they don't require
 * a successful upstream call.
 */

import {
  CliRunner,
  createTmpHome,
  InteractRpcClient,
  type RunnerHandle,
  type TmpHome,
} from './_harness';

jest.setTimeout(90_000);

const FAKE_API_KEY = 'sk-ant-e2e-fake-key-not-real-do-not-call-upstream';

describe('headless task lifecycle (Bug 1 + Bug 4)', () => {
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

  it('task.submit on a fake-key session settles via task.error or task.complete notification', async () => {
    runner = await CliRunner.spawn({
      home: tmp,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY, PTAH_AUTO_APPROVE: 'true' },
    });
    const client = new InteractRpcClient(runner);

    // Fire-and-forget the request — chat-bridge's terminal notification is
    // what we're proving exists. The request promise may resolve OR reject
    // depending on how the upstream failure surfaces; either way, a terminal
    // notification MUST land.
    const requestPromise = client
      .submitTask({ task: 'ping' }, 60_000)
      .catch((err) => ({
        error: err instanceof Error ? err.message : String(err),
      }));

    const terminal = await client.awaitTaskTerminal(60_000);
    expect(['complete', 'error']).toContain(terminal.kind);
    expect(terminal.params.command).toBe('task.submit');

    // Drain the request so afterEach shutdown is clean.
    await requestPromise;
  });

  it('concurrent task.submit returns -32603 internal error', async () => {
    runner = await CliRunner.spawn({
      home: tmp,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY, PTAH_AUTO_APPROVE: 'true' },
    });
    const client = new InteractRpcClient(runner);

    const first = client
      .submitTask({ task: 'first turn' }, 60_000)
      .catch(() => undefined);
    // Tiny delay to ensure the first request lands at the dispatcher first.
    await new Promise((r) => setTimeout(r, 50));

    let secondError: unknown = null;
    try {
      await client.submitTask({ task: 'second turn' }, 5_000);
    } catch (err) {
      secondError = err;
    }
    expect(secondError).toBeTruthy();
    // RpcError exposes `code` directly (see cli-runner.ts).
    const code = (secondError as { code?: number } | null)?.code;
    expect(code).toBe(-32603);
    expect(String((secondError as Error).message).toLowerCase()).toContain(
      'turn already in flight',
    );

    await first;
  });

  it('task.cancel with bogus turn_id is idempotent', async () => {
    runner = await CliRunner.spawn({
      home: tmp,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY, PTAH_AUTO_APPROVE: 'true' },
    });
    const client = new InteractRpcClient(runner);

    const result = await client.cancelTask('bogus-turn-id-not-real');
    expect(result.cancelled).toBe(false);
    expect(result.reason).toBe('no matching turn');
  });
});
