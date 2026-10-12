# Batch 17 report: C2 live source adapters (`$agents`, `$limits`)

Executor: frontend-developer. All three tasks are implemented, and every check below passed. I ran no git commands.

## Files

- CREATED `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-agents.source.ts` (Task 17.1)
- CREATED `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-agents.source.spec.ts` (Task 17.1)
- CREATED `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts` (Task 17.2)
- CREATED `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.spec.ts` (Task 17.2)
- MODIFIED `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.ts` (Task 17.3: root factory and doc comment)
- MODIFIED `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.spec.ts` (Task 17.3)

Unchanged:

- `src/index.ts`, the main barrel. It exports neither the adapters nor the token.
- `src/ptah-ui.ts`, the lazy entry.
- the `chat` lib.
- the shared lib.

## Task 17.1: `$agents` adapter — COMPLETE

`PtahUiAgentsSource` (`providedIn: 'root'`) has one method, `agentsInput(hostSources, turnIndex)`. It returns a
`computed` over three inputs:

- `AgentMonitorStore.subagents()` and `agentsOwnedBySession(sessionId)`;
- the host's `turnFacts`, `sessionId` and `capacities`.

The result follows the store, which satisfies R5.4.

- **Subagent facts.** It keeps only records whose `parentSessionId === sessionId`. Each fact is built field by field
  from the allow-list:
  - identity: `parentToolUseId`, `agentId`, `teammateName`, `agentType`, `status`;
  - tokens: `totalTokens`, plus `inputTokens` and `outputTokens` from `usage`. The resolver applies the
    "input + output" rule from decision #30;
  - `cost` and `contextTokens`, from `subagentUsageView(R, now)`;
  - `durationMs`, and `model` from `usage.model`.
- **Lane facts.** Built from `agentsOwnedBySession`:
  - `tokens` is the totals' `totalTokens`, else input + output when both are known, else `null`;
  - `cost` is `costUsd`, else `null`;
  - `durationMs` is `completedAt - startedAt` for a finished run. It is unset for a running run, because that would
    need a clock.
- **Excluded fields.** The facts never carry task, prompt, summary, stdout, stderr, error text or output file path.
- **Evidence.** `ptah-ui-agents.source.spec.ts` has 8 tests:
  - exact key sets of the subagent and lane facts;
  - session filtering;
  - null rather than 0 for unknown lane usage;
  - no session gives empty lists;
  - live updates from the store and the host;
  - the R5.1 sentinel. The spec seeds `task`, `description`, `agentPrompt`, `latestSummary`, `stdout`, `stderr`,
    `errorMessage` and `outputFile` with a sentinel value. The sentinel appears in no fact, no resolved value, and
    neither the text nor any attribute (accessible names included) of a `ptah-ui-block` rendered through the root
    token.

## Task 17.2: `$limits` adapter — COMPLETE

`PtahUiLaneLimitsSource` (`providedIn: 'root'`) exposes `acquire()` and `release()`, with a reference count.

- **Initial read.** The first acquire of a burst (count 0 → 1) calls
  `rpc.call('agent:getLanePlanLimits', {}, { timeout: 10_000 })` once. Later acquires return the same read-only
  signal and make no call.
- **Re-reads.** While the count is above 0, one `effect` on `PlanLimitsStore.snapshot()` (created with the root
  injector) re-reads once per change. Reads are single-flight: changes during a read queue exactly one follow-up.
  When the count reaches 0, the effect is destroyed. A release with no holder is ignored.
- **Signal states.**
  - It starts at `{kind:'pending'}`.
  - A valid read maps 1:1 onto `{kind:'available', rows, lanes, atLimit, nearLimit, unknown, asOf}`. The adapter
    builds new objects and copies only the five cells of each row.
  - A later burst keeps the previous `available` rows until its own read lands. Any other state goes back to
    `pending`.
- **Type guard (R10.4).** The response must have exactly the six result keys, and each row exactly the five string
    cells. The four counts must be finite and at least 0, and `asOf` must be finite. An extra key rejects the whole
    result.
- **Failure.** An RPC error, a timeout, a malformed payload or a thrown call all set `{kind:'unavailable'}` and log one
  `console.warn`. The warning never includes the payload or the RPC error text. A thrown call logs only the error's
  `name`, and the catch carries the repo's `degradation-audit:` comment.
- **No timers.** The only bound on a read is the RPC call's own timeout.
- **Evidence.** `ptah-ui-lane-limits.source.spec.ts` has 20 tests:
  - no call without an acquire, even when the snapshot changes (R10.1);
  - pending, then a 1:1 mapping, with the call arguments and the timeout asserted;
  - one call for two acquires;
  - a re-read on each snapshot change, and none after the last release;
  - single-flight;
  - a release without a holder is ignored;
  - RPC error and timeout give unavailable, and the warning has no payload;
  - a thrown call gives unavailable and logs only the error name;
  - 8 malformed payloads;
  - the R10.4 sentinel on the result and on a row;
  - a host without the method makes one attempt per burst (details below).

## Task 17.3: `PTAH_UI_BLOCK_LIVE_SOURCES` root factory (decision #52) — COMPLETE

- **Token.** `PTAH_UI_BLOCK_LIVE_SOURCES` now has `{ providedIn: 'root', factory }` in `ptah-ui-block.component.ts`.
  The factory returns `{ agentsInput, acquireLimits, releaseLimits }`, which delegate to `PtahUiAgentsSource.agentsInput`
  and to `PtahUiLaneLimitsSource.acquire` and `.release`.
- **Unchanged parts.** The `PtahUiBlockLiveSources` interface and the block's consuming code are unchanged. The inject
  keeps `optional: true`.
- **Doc comment.** It now says the token is provided by default, and that the absent path applies only when the token
  is provided explicitly as `null`.
- **Spec changes.**
  - `configure()` now provides a stub for the token by default, so no real store or RPC is built. A case's own
    providers come after the stub and override it.
  - The "no adapter" case now provides the token as `null`. It still shows `['unavailable', 'unavailable']` with a
    valid block.
  - One new case uses the root factory, with `PtahUiAgentsSource` and `PtahUiLaneLimitsSource` overridden by stubs. It
    asserts three things:
    - `agentsInput` receives the host sources and turn index 0;
    - a `$limits` block calls `acquire` once on mount and `release` once on destroy;
    - a `$diff`-only block calls neither adapter.
  - All 37 cases from Batch 16 still pass.
  - I also typed the Batch 16 `agentsInput` mock in the live-sources `beforeEach`. It was a type-only error
    (TS2322), reported by the workspace TypeScript diagnostics and not by Jest.

## Verification (CLAUDE.md memory-safe; one heavy check at a time)

- **Jest.** Command:
  `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-block.component.spec.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}' | tail`
  - Result: **4 suites passed, 73 tests passed**, run twice (after the final spec edit too).
  - The 73 are: 45 in the block spec and message text (44 from Batch 16 plus 1 new), 8 in the agents source and 20
    in the lane-limits source.
- **Typecheck.** `npx nx typecheck @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`: **passed** (uncached).
- **Lint.** `npx nx lint @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`: **0 errors, 10 warnings**. The
  per-file listing (`npx eslint libs/frontend/chat-ui/src`) shows all 10 in pre-existing files, the same set as the
  Batch 16 baseline. None is in a batch file. The new chat-ui → `chat-streaming` import passes the boundary rule.
- **TypeScript diagnostics** on the six batch files: no errors in the new files. The remaining errors are in
  pre-existing sibling files outside this batch.

## Risks and edge cases

- **Host without `agent:getLanePlanLimits`** (VS Code, capability false). The call fails with an RPC error or a
  10 s RPC timeout. Either way the result is `{kind:'unavailable'}`.
  - A failed read latches the burst: later snapshot pushes do not re-read, so there is no retry loop and no timer.
  - The next burst (count 0 → 1) makes exactly one new attempt.
  - Pinned by the test "makes one attempt per acquire burst on a host without the method".
- **`$limits` RPC failure (R10.7).** It renders "unavailable" and the block stays valid. The adapter test covers the
  failure states, and the block spec's null-token case covers the block.
- **Eager closure (D6, decision #52).**
  - The adapters are imported only by `ptah-ui-block.component.ts`, which is reachable only through the lazy
    `@ptah-extension/chat-ui/ptah-ui` entry.
  - Neither barrel changed.
  - The adapters' type imports from `shared/.../surface` are type-only. `chat-streaming` and `core` are imported only
    from the lazy files.
- **Spec isolation.** The block spec stubs the token by default. The message-text spec renders blocks without a stub,
  so it reaches the root factory. That factory resolves an adapter only on first use (see the deviation below).
  Because no message-text body names `$agents` or `$limits`, no store or RPC is built there.

## Plan deviations / gaps (flagged, not silently worked around)

1. **The factory resolves the adapters lazily.** Task 17.3 says the factory calls `inject(PtahUiAgentsSource)` and
   `inject(PtahUiLaneLimitsSource)`. My factory instead captures `inject(Injector)` and calls `injector.get(...)` the
   first time each adapter is used.
   - Why: every block injects the token at construction, including `$diff`-only and literal blocks. Eager injects
     would build `AgentMonitorStore` (with `TabManagerService`, `VSCodeService` and RPC) and `PlanLimitsStore` for
     any block, including in the message-text spec.
   - Everything else is unchanged: the result, the delegation and the spec seam (overriding either adapter class
     still works, as the new case shows).
2. **The capacity list comes from the host.** Plan:685 says the capacity list is the tab's
   `[liveModelStats.contextCapacity]`. Component 9's `PtahUiHostSources` already exposes `capacities()` for exactly
   this ("the only source of a limit"), so the adapter reads the host's list and does not reach into tab state. The
   transcript provider in Task 23.2 must fill `capacities` accordingly.
3. **Fact types are derived locally.** `surface.index.ts` exports only `PtahUiAgentsInput`, not `SubagentFact` or
   `CliLaneFact`. The adapter derives them as `PtahUiAgentsInput['records'][number]` and `['lanes'][number]`, so the
   shared barrel is not widened (the shared lib is outside this batch).
4. **One failure blocks re-reads until the next burst** (decision needed only if you disagree). A transient failure on
   Electron (for example, one timeout) keeps `$limits` "unavailable" until every holder releases and a block acquires
   again. This is the trade-off for the required "one attempt per acquire burst, no retry loop" on a host without the
   method. The client cannot tell "method missing" from "transient": no frontend capability flag for `lanePlanLimits`
   exists, and the RPC error codes do not distinguish the two.
5. **Lane duration.** A running CLI lane has no `durationMs`, so it renders "unavailable". Only a finished run gets
   `completedAt - startedAt`. A live duration would need a clock, and the batch forbids timers.

## Out-of-scope observations

- `PTAH_UI_BLOCK_LIVE_SOURCES` is not exported from the lazy `ptah-ui.ts` entry. Today a host can provide `null` only
  through a deep import. No batch asks for this export; I left it unchanged.

## Fix round (decision #56): `burstFailed` latch removed

This section replaces two parts of the first round: plan deviation 4 and the first bullet under "Risks and edge
cases". The failure behaviour is now as follows.

- A failed, timed-out or malformed read sets `{kind:'unavailable'}`. It warns as before, without the payload.
- The snapshot watcher stays armed. The next `PlanLimitsStore.snapshot()` change re-reads once, and a successful read
  restores "available".
- With no change, no further call is made.
- These are unchanged: single-flight, the one queued follow-up per push (also honoured after a failed read), the
  teardown when the count reaches 0, and no timers.

### Files changed

- MODIFIED `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.ts`:
  - removed the `burstFailed` field, its reset in `startBurst()`, its check in `reread()` and the latch in `read()`;
  - rewrote the class doc comment to describe the new failure behaviour.

  `grep burstFailed` over `sources/` now returns nothing.
- MODIFIED `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/sources/ptah-ui-lane-limits.source.spec.ts`: replaced
  "makes one attempt per acquire burst on a host without the method" with two cases:
  - (a) "makes no further call after a failed read when no push arrives": two acquires and two effect flushes after a
    failed read leave 1 call and "unavailable";
  - (b) "re-reads once on a push after a failed read, and a success there shows \"available\"": 1 failed call, then
    one push gives exactly 2 calls and `{kind:'available', ...FIXTURE}`.

No other file changed.

### Evidence

- **Jest:** the Batch 17 command, with the `--moduleNameMapper` override on the command line only. Result: **4
  suites passed, 74 tests passed**. The lane-limits spec now has 21 tests (20 − 1 + 2), and every other case still
  passes.
- **Typecheck:** `npx nx typecheck @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`: **passed**.
- **Lint:** `npx nx lint @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`: **0 errors, 10 warnings**. This is the
  same baseline set as before. None is in a batch file; the only `ptah-ui` file listed is the pre-existing
  `services/ptah-ui-live-window.ts`.
