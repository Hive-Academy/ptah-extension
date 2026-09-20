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
 * COST. One test, one CLI spawn, one slow turn. The whole file is deliberately
 * a single `it` rather than two: turn 1 costs the invalid-key retry envelope
 * (~183s) and both signals can be read from it, so splitting them would pay
 * that envelope twice inside a 20-minute `cli-e2e.yml` job shared with fifteen
 * other spec files. Turn 2 is submitted but never awaited to completion.
 *
 * No DURATION is asserted anywhere in this file. The one time bound is
 * `SECOND_QUERY_PROBE_MS`, which is unavoidable: proving an event never
 * happens requires a window to not see it in. It is a detection window, not a
 * performance budget, and the spec does not fail because something was slow.
 */

import {
  CliRunner,
  createTmpHome,
  InteractRpcClient,
  waitFor,
  type RunnerHandle,
  type TmpHome,
} from './_harness';

jest.setTimeout(600_000);

const FAKE_API_KEY = 'sk-ant-e2e-fake-key-not-real-do-not-call-upstream';

/**
 * Budget for turn 1 ONLY. A turn driven by an invalid key settles on the
 * bundled CLI's own retry envelope, measured at ~183s elsewhere in this suite,
 * and nothing on the Ptah side ends a silent turn before
 * `NO_ACTIVITY_TIMEOUT_MS` (180s). Turn 1 must genuinely reach its `result`,
 * because `endInput()` fires on the first result — that IS the mechanism under
 * test, so this wait cannot be shortened.
 *
 * This is a CEILING, not a spend. Measured in CI run 35537910407, a `/context`
 * turn settled in ~13.7s, far short of the envelope. Do NOT read that as
 * confirmation that the turn did the work: that same run counted zero query
 * starts, and the two facts have not yet been told apart. The diagnostic throw
 * on the first assertion exists to separate them on the next run.
 */
const FIRST_TURN_BUDGET_MS = 240_000;

/**
 * Budget for the SECOND-QUERY probe. Turn 2 is never waited on to completion,
 * which would cost another retry envelope for no added signal.
 * `autoResumeIfInactive` starts its replacement SDK query during the
 * `chat:continue` preflight, before any model call — see the comment at
 * `chat-session.service.ts` ("`autoResumeIfInactive` on an inactive session
 * starts a full SDK query in `idle+streamInput` mode"). So on the broken path
 * the second query-start line appears within seconds of the submit. This
 * window only has to outlast that preflight, not the model.
 */
const SECOND_QUERY_PROBE_MS = 20_000;

/**
 * The one production log line that names the mechanism, emitted once per SDK
 * query by `SessionQueryExecutor.executeQuery`. Its `promptMode` field is the
 * shape under test.
 */
const QUERY_START_LINE = '[SessionLifecycle] Starting SDK query with options';

/**
 * Where that line actually lands. NOT stderr — the first version of this spec
 * read `handle.stderr()` and counted zero occurrences in CI, because the CLI
 * logger never writes there:
 *
 *   - `CliLoggerAdapter.logWithContext` always writes to the `IOutputChannel`,
 *     which `platform-cli/src/registration.ts:91` binds to
 *     `new CliOutputChannel('Ptah CLI', logsPath)` — a FILE stream at
 *     `<userDataPath>/logs/Ptah CLI.log`, i.e. `$HOME/.ptah/logs/` (`:45-46`).
 *   - It mirrors to the console only when `logToConsole` is set, which needs
 *     `NODE_ENV=development` or `PTAH_LOG_LEVEL=debug`.
 *   - And even then `info` goes to `console.log`, i.e. STDOUT — which in
 *     `interact` mode is the NDJSON JSON-RPC channel. `interact.ts` installs no
 *     console redirection, so forcing the debug level here would inject
 *     non-JSON lines into the protocol stream. That is why this spec reads the
 *     log file and does NOT set `PTAH_LOG_LEVEL`.
 *
 * The tmp HOME is per-test, so this file belongs to exactly one CLI process.
 */
const SESSION_LOG_REL = '.ptah/logs/Ptah CLI.log';

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

  /**
   * The session log for THIS test's CLI process. Returns '' until the process
   * has created the file, so a caller can poll it without special-casing the
   * cold start.
   */
  const readSessionLog = async (): Promise<string> =>
    (await tmp.readFile(SESSION_LOG_REL)) ?? '';

  afterEach(async () => {
    if (handle) {
      await handle.kill();
      handle = undefined;
    }
    await tmp.cleanup();
  });

  it('serves a slash command and a following turn from ONE SDK query, never two', async () => {
    // `cli` is the narrowed local the assertions read; `handle` is the
    // module-scoped optional that `afterEach` kills. Same object, but the local
    // spares every read a non-null assertion.
    const cli = await CliRunner.spawn({
      home: tmp,
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY, PTAH_AUTO_APPROVE: 'true' },
    });
    handle = cli;
    const rpc = new InteractRpcClient(cli);

    // Turn 1 — the slash command. Settle on EITHER terminal envelope: with an
    // invalid key the turn may well end in `task.error`, and that is fine.
    // What matters is that a `result` arrived, because that is what closes the
    // input on the broken path. `awaitTaskTerminal` is used instead of
    // `awaitTaskComplete(...).catch(() => undefined)` so that a turn which
    // never settles fails the spec here, loudly, rather than letting the
    // assertions below run on a premise that never held.
    await rpc.submitTask({ task: '/context' }, FIRST_TURN_BUDGET_MS);
    await rpc.awaitTaskTerminal(FIRST_TURN_BUDGET_MS);

    // The log file is an append stream, so it can lag the terminal envelope by
    // a tick. Wait for the line rather than sampling once.
    await waitFor(
      async () => countOccurrences(await readSessionLog(), QUERY_START_LINE) >= 1,
      { timeoutMs: 15_000, label: 'first SDK query start in the session log' },
    );

    const afterFirstTurn = countOccurrences(
      await readSessionLog(),
      QUERY_START_LINE,
    );
    // Thrown rather than `expect`ed so the failure carries the log that proves
    // WHY. The first CI run of this spec counted 0 and reported only
    // "Expected: 1, Received: 0", which named the symptom and nothing else.
    // Reading the cause needed a separate investigation; this makes the next
    // failure self-explaining.
    if (afterFirstTurn !== 1) {
      throw new Error(
        `Expected exactly 1 SDK query start after the slash command, saw ` +
          `${afterFirstTurn}.\nSession log tail:\n` +
          `${(await readSessionLog()).slice(-4000)}`,
      );
    }

    // Second signal, asserted here rather than in a test of its own so that the
    // ~183s first turn is paid ONCE for this file. The two prompt-shape
    // literals below are what the executor can no longer produce. Either one in
    // this log is the raw-string path resurrected, which is the single-turn
    // flag and therefore the closed input.
    const afterFirstTurnLog = await readSessionLog();
    expect(afterFirstTurnLog).not.toContain('string (slash command)');
    expect(afterFirstTurnLog).not.toContain('string (slash command + resume)');

    // Turn 2 — an ordinary prompt in the SAME session. On a closed input this
    // is the turn that triggers `autoResumeIfInactive` and mints a second
    // query; on an open one it is delivered into the first query's stream.
    // Deliberately NOT awaited to completion: the discriminating event happens
    // in the preflight, long before the model would answer.
    await rpc.submitTask({ task: 'say ping' }, FIRST_TURN_BUDGET_MS);

    // THE ASSERTION, expressed as "the failure never appears". A second start
    // means turn 1's input closed and Ptah healed it by resuming — the defect,
    // merely hidden. One start means the stream stayed open across the slash
    // result, so the CLI child never saw the stdin EOF that makes Claude Code
    // checkpoint its background agents.
    //
    // `waitFor` resolves as soon as a second start appears, so the broken path
    // fails fast; the passing path costs the full probe window and nothing
    // more. The polarity is inverted on purpose — waiting for the ABSENCE of
    // an event needs a bounded window, and this makes that window explicit.
    const sawSecondQuery = await waitFor(
      async () =>
        countOccurrences(await readSessionLog(), QUERY_START_LINE) >= 2,
      { timeoutMs: SECOND_QUERY_PROBE_MS, label: 'second SDK query start' },
    ).then(
      () => true,
      () => false,
    );

    expect(sawSecondQuery).toBe(false);
    expect(countOccurrences(await readSessionLog(), QUERY_START_LINE)).toBe(1);
  });

});
