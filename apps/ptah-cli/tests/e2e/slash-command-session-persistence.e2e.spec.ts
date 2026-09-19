/**
 * A slash-command session must keep its SDK input open (TASK_2026_472).
 *
 * The defect: a slash command was handed to the SDK as a finite raw string.
 * The SDK derives `isSingleUserTurn` from `typeof prompt === "string"` and calls
 * `transport.endInput()` on the first `result`, which closes the CLI child's
 * stdin. Claude Code reacts to that EOF by checkpointing the session and
 * aborting every background subagent with reason `background` — rendered as the
 * canned user-denial string although no permission gate ever ran.
 *
 * WHY THIS IS AN E2E SPEC AND NOT A UNIT SPEC. The unit coverage
 * (`session-query-executor.slash-persistence.spec.ts`) models the two SDK rules
 * in a hand-written fake. That fake was audited against the installed
 * `sdk.mjs` 0.3.150 and found faithful, but it is still our own model of the
 * SDK. This spec runs the REAL SDK and a REAL Claude Code child, so it cannot
 * be wrong about the SDK in the way a fake can.
 *
 * WHY IT ASSERTS QUERY COUNT AND NOT "THE SECOND TURN WORKED". This is the
 * trap, and a spec that misses it is a FALSE PASS that also passes on `main`.
 * A non-slash follow-up runs `autoResumeIfInactive`
 * (`chat-session.service.ts`), which starts a whole new SDK query when the
 * session is dead. So the second turn SUCCEEDS either way — Ptah silently heals
 * the closed session by resuming it, and the user never learns the input died.
 * The same masking is why the original diagnosis found a working resumed
 * control case beside the failing slash case
 * (`.ptah/specs/TASK_2026_471_b3d1/diagnosis-subagent-permissions.md`,
 * evidence 11).
 *
 * The discriminating signal is therefore HOW MANY SDK QUERIES SERVE THE TWO
 * TURNS:
 *
 *   - broken: turn 1's string query closes its input on its own `result`;
 *     turn 2 finds a dead session and auto-resumes => TWO query starts.
 *   - fixed: turn 1's queued message rides an open stream that stays open;
 *     turn 2 is delivered into the SAME query => ONE query start.
 *
 * NO CREDENTIALS AND NO COST. Like every spec in this suite it runs on a fake
 * API key in an isolated HOME. The key is never valid and the model is never
 * reached. That does not weaken the assertion: `endInput()` is called from the
 * `result` branch with NO `is_error` guard, so an auth-failure result closes
 * stdin exactly as a successful one does. The mechanism under test fires on any
 * first result.
 *
 * WHAT THIS SPEC DOES NOT PROVE. It does not spawn a real background subagent,
 * because that needs a real model turn. It proves the Ptah half — the input
 * stays open, so the CLI child never sees the stdin EOF that triggers
 * `checkpointAgents`. Acceptance item 5 (a live subagent surviving a real
 * slash-command turn) remains a separate manual check.
 *
 * No timing is asserted anywhere in this file.
 */

import {
  CliRunner,
  createTmpHome,
  InteractRpcClient,
  type RunnerHandle,
  type TmpHome,
} from './_harness';

jest.setTimeout(600_000);

const FAKE_API_KEY = 'sk-ant-e2e-fake-key-not-real-do-not-call-upstream';

/**
 * Per-turn budget. A turn driven by an invalid key settles on the bundled CLI's
 * own retry envelope, measured at ~183s elsewhere in this suite, and nothing on
 * the Ptah side ends a silent turn before `NO_ACTIVITY_TIMEOUT_MS` (180s). Two
 * turns therefore need well clear of that, twice.
 */
const TURN_BUDGET_MS = 240_000;

/**
 * The one production log line that names the mechanism, emitted once per SDK
 * query by `SessionQueryExecutor.executeQuery`. Its `promptMode` field is the
 * shape under test.
 */
const QUERY_START_LINE = '[SessionLifecycle] Starting SDK query with options';

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

describe('slash-command session keeps its SDK input open (TASK_2026_472)', () => {
  let tmp: TmpHome;
  let handle: RunnerHandle | undefined;

  beforeEach(async () => {
    tmp = await createTmpHome();
  });

  afterEach(async () => {
    if (handle) {
      await handle.kill();
      handle = undefined;
    }
    await tmp.cleanup();
  });

  it('serves a slash command and a following turn from ONE SDK query, never two', async () => {
    handle = await CliRunner.spawn({
      home: tmp,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY, PTAH_AUTO_APPROVE: 'true' },
    });
    const rpc = new InteractRpcClient(handle);

    // Turn 1 — the slash command. `/context` is handled inside the CLI and
    // needs no model call, which is why an invalid key does not matter here.
    await rpc.submitTask({ task: '/context' }, TURN_BUDGET_MS);
    await rpc.awaitTaskComplete(TURN_BUDGET_MS).catch(() => undefined);

    const afterFirstTurn = countOccurrences(handle.stderr(), QUERY_START_LINE);
    expect(afterFirstTurn).toBe(1);

    // Turn 2 — an ordinary prompt in the SAME session. On a closed input this
    // is the turn that triggers `autoResumeIfInactive` and mints a second
    // query; on an open one it is delivered into the first query's stream.
    await rpc.submitTask({ task: 'say ping' }, TURN_BUDGET_MS);
    await rpc.awaitTaskComplete(TURN_BUDGET_MS).catch(() => undefined);

    const afterSecondTurn = countOccurrences(handle.stderr(), QUERY_START_LINE);

    // THE ASSERTION. Two starts means turn 1's input closed and Ptah healed it
    // by resuming — the defect, merely hidden. One start means the stream
    // stayed open across the slash result, so the CLI child never saw the
    // stdin EOF that makes Claude Code checkpoint its background agents.
    expect(afterSecondTurn).toBe(1);
  });

  it('starts the slash-command query on the persistent stream, never on a raw string', async () => {
    handle = await CliRunner.spawn({
      home: tmp,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY, PTAH_AUTO_APPROVE: 'true' },
    });
    const rpc = new InteractRpcClient(handle);

    await rpc.submitTask({ task: '/context' }, TURN_BUDGET_MS);
    await rpc.awaitTaskComplete(TURN_BUDGET_MS).catch(() => undefined);

    const stderr = handle.stderr();
    expect(stderr).toContain(QUERY_START_LINE);

    // The two prompt shapes the executor can no longer produce. Either one in
    // this log is the raw-string path resurrected, which is the single-turn
    // flag and therefore the closed input.
    expect(stderr).not.toContain('string (slash command)');
    expect(stderr).not.toContain('string (slash command + resume)');
  });
});
