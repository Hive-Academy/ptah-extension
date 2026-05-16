/**
 * Headless task lifecycle business guardrails.
 *
 * Three guardrails are exercised here, each tied to a production invariant
 * documented in `apps/ptah-cli/src/cli/commands/interact.ts`:
 *
 *   1. TERMINAL NOTIFICATION on every settle path (chat-bridge.ts:212).
 *      A fake `ANTHROPIC_API_KEY` reaches `session.ready` (SDK init does not
 *      validate the key) but the first upstream call fails. The guardrail is
 *      that chat-bridge MUST emit a `task.error` notification with
 *      `params.command === 'task.submit'` so headless consumers (--once, CI
 *      loops, A2A bridges) can detect end-of-turn without polling.
 *
 *   2. SINGLE-TURN CONCURRENCY (interact.ts:515-522). The interact loop
 *      rejects a second `task.submit` with JSON-RPC code -32603 and message
 *      `turn already in flight` while `currentTurnId !== null`. This protects
 *      backend turn state from interleaved chat:start/chat:continue calls.
 *
 *   3. CANCEL IDEMPOTENCY (interact.ts:594-596). `task.cancel` against an
 *      unknown turn_id resolves `{ cancelled: false, reason: 'no matching
 *      turn' }` instead of throwing, so retried cancels from flaky peers
 *      never crash the session.
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

  it('task.submit emits a terminal task.complete | task.error notification with required envelope fields (chat-bridge terminal-event guardrail)', async () => {
    runner = await CliRunner.spawn({
      home: tmp,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY, PTAH_AUTO_APPROVE: 'true' },
    });
    const client = new InteractRpcClient(runner);

    // The load-bearing guardrail is that chat-bridge ALWAYS emits a terminal
    // envelope (`task.complete` OR `task.error`) so headless consumers — A2A
    // bridges, --once loops, CI runners — can detect end-of-turn without
    // polling. Which kind lands depends on whether the SDK accepts the fake
    // key locally (some providers return synthetic responses, others reject)
    // — the bridge's contract is kind-agnostic. Either is acceptable, but the
    // envelope shape must satisfy the schema in docs/jsonrpc-schema.md § 1.10.
    const requestPromise = client
      .submitTask({ task: 'ping' }, 60_000)
      .catch(() => undefined);

    const terminal = await client.awaitTaskTerminal(60_000);
    expect(['complete', 'error']).toContain(terminal.kind);
    expect(terminal.params.command).toBe('task.submit');

    if (terminal.kind === 'error') {
      const errParams = terminal.params;
      expect(errParams.code).toBe(-32603);
      expect(typeof errParams.message).toBe('string');
      expect((errParams.message ?? '').length).toBeGreaterThan(0);
      expect(typeof errParams.ptah_code).toBe('string');
      // duration_ms is nested under `details` for errors (chat-bridge.ts:232).
      const details = errParams.details as
        | { duration_ms?: unknown }
        | undefined;
      expect(typeof details?.duration_ms).toBe('number');
    } else {
      const okParams = terminal.params;
      expect(typeof okParams.duration_ms).toBe('number');
      expect(okParams.duration_ms).toBeGreaterThanOrEqual(0);
      expect(okParams.summary).toBeDefined();
      expect(typeof okParams.summary?.session_id).toBe('string');
      expect((okParams.summary?.session_id ?? '').length).toBeGreaterThan(0);
      expect(typeof okParams.summary?.turn_id).toBe('string');
      expect((okParams.summary?.turn_id ?? '').length).toBeGreaterThan(0);
    }

    // The request itself must also resolve — proving the bridge releases the
    // turn slot AND the handler's response is paired with the notification.
    const result = (await requestPromise) as
      | { turn_id?: string; complete?: boolean }
      | undefined;
    expect(result).toBeDefined();
    expect(typeof result?.turn_id).toBe('string');
    expect(typeof result?.complete).toBe('boolean');
  });

  it('rejects a second task.submit while the first is in flight with -32603 "turn already in flight"', async () => {
    runner = await CliRunner.spawn({
      home: tmp,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY, PTAH_AUTO_APPROVE: 'true' },
    });
    const client = new InteractRpcClient(runner);

    // Cork stdin so both writes coalesce into one OS-pipe chunk. Without cork,
    // Linux delivers them separately and handler 1 settles + clears
    // currentTurnId before handler 2 dispatches, defeating the guardrail under
    // test. Cork buffers; uncork-on-nextTick flushes the buffered queue in one
    // chunk after both write() calls have been issued.
    runner.child.stdin.cork();
    const firstP = client.submitTask({ task: 'first turn' }, 60_000);
    const secondP = client.submitTask({ task: 'second turn' }, 60_000);
    process.nextTick(() => runner.child.stdin.uncork());
    const [first, second] = await Promise.allSettled([firstP, secondP]);

    // Exactly one of the two must reject: the one that lost the race for
    // `currentTurnId`. The first turn's handler returns a result envelope on
    // upstream failure (see interact.ts:568-576) so it fulfils, not rejects.
    const rejected = [first, second].filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    expect(rejected).toHaveLength(1);
    expect(fulfilled).toHaveLength(1);

    const err = rejected[0].reason as { code?: number; message?: string };
    expect(err.code).toBe(-32603);
    expect(String(err.message ?? '').toLowerCase()).toContain(
      'turn already in flight',
    );
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
