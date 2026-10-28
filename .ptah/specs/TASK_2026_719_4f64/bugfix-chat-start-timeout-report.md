# Bugfix report: named main-chat `chat:start` RPC timeout (D72)

## Verdict

Fix A is done. The host now enforces a total named-admission budget (90 s), and the renderer
timeout for the admission RPCs is derived from that budget (90 s + 30 s = 120 s). Fix B made no
change: none of the serial waits in the slow steps is clearly redundant (see below).

## Root cause

- Renderer: `ClaudeRpcService.call` defaulted every method to 30 s
  (`libs/frontend/core/src/lib/services/claude-rpc.service.ts`, previously line ~135).
  `chat:start` callers passed no timeout:
  - `libs/frontend/chat/src/lib/services/message-sender.service.ts:464` passes `{ signal }` only
  - `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:242` passes no options
- Host: the named admission (`NamedAccountQueryAdmission`,
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`)
  had only a per-await deadline (`deadlineMs = 15_000`, line 708, applied in `wait()`). There was
  no bound on the whole admission. With about 20 serial `wait()` steps, plus a `query.next()` loop
  of up to 64 reads, the worst case was minutes. The renderer therefore could not hold any
  timeout that was guaranteed to exceed it.

## Serial-wait breakdown (named NEW main chat, live log 20:15:56-20:16:31 UTC)

Log timestamps are from `Ptah Electron-2026-10-27.log` lines ~29320-29380. I read only timestamps
and logger tags.

| Window | Duration | Code path (file:line) | Deadline |
| --- | --- | --- | --- |
| 20:15:56.528 `chat:start - session config` to 20:15:56.538 `Starting NEW chat session` | 10 ms | `gateMainSessionAccount` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:~91`), store reads only | none |
| 20:15:56.538 to 20:16:11.914 `Created user message` | **15.4 s** | `session-query-executor.service.ts:1098` `named.wait(getQueryFunction())`; then `:1099` `named.bootstrap`: `:759` `admitClaudeRoute`, which runs `ClaudeRouteCertifier.certify` (`libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.ts:191`): policy scan (`reg.exe` probes, `:186`/`:281`), executable `--version`, then the `claude auth status` probe child (`:201`); then `assertRouteCurrent`; `:791` `checkBoundary('bootstrap')`, which re-runs `checkLaunch` with a `reg.exe` re-scan (`claude-route-certifier.ts:249-256`); then the bootstrap SDK child: `:796` `accountInfo()`, `:801` `wait(child.terminated)`; then `createUserMessage` | 15 s per `wait()`; no total before this fix |
| 20:16:11.915 `Queued initial prompt` to 20:16:12.001 `SDK call with model` | 0.1 s | `:1266` policy, `:1274` harness sync, plugin paths | 15 s per `wait()` |
| 20:16:12.001 to 20:16:20.532 `System prompt assembled` | **8.5 s** | `sdk-query-options-builder.ts:1181` `validateModelAvailability`: for a named route, `SdkModelService.getSupportedModels(route, signal, launch)` (`sdk-model-service.ts:632`) starts a certified model-catalog probe child (`SDK_MODELS_TIMEOUT_MS = 15_000`, `:221`). The result is cached per route/epoch/executable/env (`:425-434`). Then `buildSystemPrompt` (`:1201`: memory and code-symbol blocks; `CodeSymbolIndexer` finished at 20:16:12.780, competing for CPU) | 15 s probe + 15 s per `wait()` on `buildOptions` (`:1340`) |
| 20:16:20.537 `Starting SDK query with options` to 20:16:24.747 first `Yielding message` | 4.2 s | `:1359` `named.launch`: `:850` `checkBoundary('final')` (third `reg.exe` scan), final child spawn, `verifyIdentity` (`assertRouteCurrent` + `accountInfo`), `releaseFirst` | 15 s per `wait()` |
| 20:16:24.747 to 20:16:31.576 `Staged metadata` | 6.8 s | `:863` `wait(query.next())` until `system/init` (CLI 2.1.278 reads the first turn first), `:882` `commitRunBinding`, `:888` `attachSdkSession`, `:891` `saveAccountBound`, final `verifyIdentity` | 15 s per `wait()` |
| 20:16:31.578 `Query started` to 20:16:31.584 `[RPC] slow handler` (35 056.8 ms) | <10 ms | handler return | none |

The renderer logged `RPC timeout: chat:start` at 20:16:26.531, which is 30 s after the call.

## Fix A: one shared bound, enforced on the host

- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` (exported through the existing
  `rpc.types.ts` barrel):
  - `NAMED_ACCOUNT_ADMISSION_BUDGET_MS = 90_000`: the total time a named admission may take.
  - `CHAT_ADMISSION_RPC_TIMEOUT_MS = NAMED_ACCOUNT_ADMISSION_BUDGET_MS + 30_000` (120 s). The
    30 s margin covers the handler's ungated work: gate, provider resolution, and post-admission
    registration, which measured about 10 ms around the admission in the log.
- Host enforcement, `session-query-executor.service.ts`:
  - The constructor takes `admissionBudgetMs = NAMED_ACCOUNT_ADMISSION_BUDGET_MS` and records
    `admissionEndsAt` (`:713`).
  - Until the binding commits, `wait()` uses `min(deadlineMs, remaining budget)` (`:722`). When
    the budget expires, the existing path runs unchanged: abort, then `namedAccountRefusal()`, then
    `dispose()`, which settles the reservation.
  - `admitted = true` is set just before `settleAdmission(true)` (`:895`). Later per-turn
    `verifyIdentity` waits keep only the 15 s per-step deadline, so a long-lived admitted session
    is never cut off by the budget.
  - Result: once the budget expires, any `chat:start` on the named path answers within one step
    (refusal or success). The renderer waits 30 s longer than that, so it receives the host's
    answer instead of a false "Message delivery failed".
- Renderer, `libs/frontend/core/src/lib/services/claude-rpc.service.ts`:
  - New `DEFAULT_RPC_TIMEOUT_MS = 30_000`, unchanged for every other method.
  - `CHAT_ADMISSION_RPC_METHODS = {chat:start, chat:continue, chat:resume}` defaults to
    `CHAT_ADMISSION_RPC_TIMEOUT_MS`. An explicit `options.timeout` still takes precedence.
  - Putting the default in the RPC service covers every caller: `message-sender.service.ts`
    (start and continue), `apps-session.service.ts` (start and continue), and `session-loader`.
    No account UI file, route or app config was touched.

## chat:continue / chat:resume

- `chat:continue` does go through the same admission. On an inactive session it auto-resumes
  (`chat-session.service.ts:1030` `autoResumeIfInactive`, then `sdkAdapter.resumeSession` at
  `:1662`, then `executeQuery` with `resumeSessionId`, then `NamedAccountQueryAdmission.bootstrap`
  and `launch`). Its callers passed no timeout, so they had the same 30 s defect. They are now
  covered by the RPC service default.
- `chat:resume` (including `activate:true` at `chat-session.service.ts:1235`) also auto-resumes.
  Its existing renderer callers already pass `SessionLoaderService.RESUME_TIMEOUT_MS = 120_000`
  (`session-loader.service.ts:308`, used at `:1013` and `:1690`), which equals the derived bound.
  I made no change there; a future cleanup could point that constant at
  `CHAT_ADMISSION_RPC_TIMEOUT_MS`.

## Fix B: no change (report only)

This branch introduced all of the named path (base `396f0135b` is a main merge), so "introduced by
this branch" does not separate the steps. None of the slow steps is clearly redundant:

- The bootstrap `checkBoundary` and the final `checkBoundary` each re-scan policy right after
  certification. These are deliberate TOCTOU boundaries ("Both checks that must pass right before
  one SDK child starts"), and each guards a different child.
- `bootstrap` calls `persistence.assertRouteCurrent` (`:789`) immediately before
  `checkBoundary('bootstrap')`, and `checkLaunchBoundary` repeats it first
  (`claude-named-account-persistence.ts:118-123`). This duplication is real but is an in-memory
  store read, so removing it saves milliseconds, not seconds.
- The named model-catalog probe (8.5 s window) is cached per route, epoch, executable and env.
  It could start in parallel with the bootstrap identity child, but it reads the certified
  launch, which exists only after `admitClaudeRoute`. Reordering it is a design change, not a
  safe local fix. One thing to check: `getAccountModels` calls `invalidateAccountRoute(route)`
  (`sdk-model-service.ts:417`) before its cache read. If that invalidation clears the current
  epoch's entry, the cache never hits and every named start pays the probe. Worth a follow-up
  check; not changed here.
- The bootstrap identity child (spawn, `accountInfo`, close) and the final child cannot be merged
  without reopening D69 (the init-order decision).

## Tests

- `session-query-executor.accounts.spec.ts`: the fixture gains `deadlineMs` and `budgetMs`. New
  regression test "refuses when the total admission budget expires before any single step
  deadline": per-step deadline 60 s, budget 1 s, paused at `commit`. It is still pending at
  999 ms and refuses with `identity-unproved` at 1 000 ms. The run is aborted, nothing is
  attached, and no binding is saved.
- `claude-rpc.service.spec.ts`:
  - the derived bound is greater than the host budget and greater than the default;
  - `chat:start`, `chat:continue` and `chat:resume` without a timeout stay pending until
    `CHAT_ADMISSION_RPC_TIMEOUT_MS - 1` and time out exactly at the bound;
  - `session:list` keeps the 30 s default.
- No existing spec asserted the old 30 s default for `chat:*`.

## Files changed

- MODIFIED `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
- MODIFIED `libs/frontend/core/src/lib/services/claude-rpc.service.ts`
- MODIFIED `libs/frontend/core/src/lib/services/claude-rpc.service.spec.ts`

## Verification

- `node D:/projects/ptah-extension/scripts/verify.mjs -t lint,test,typecheck -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/core,ptah-electron,ptah-extension-vscode`
  printed `NX 53 tasks: 52 succeeded, 2 cached, 1 failed`. The one failure was
  `@ptah-extension/agent-sdk:test`. The run included dependency tasks. Lint, typecheck and test
  passed for shared, core, ptah-electron and ptah-extension-vscode.
- My output filter dropped the name of the failing suite. Re-running
  `verify.mjs -t test -p @ptah-extension/agent-sdk` gave `1 task: 1 succeeded` (cache hit), and
  Nx printed "Nx detected a flaky task @ptah-extension/agent-sdk:test".
- An uncached run, `verify.mjs -t test -p @ptah-extension/agent-sdk -- --skip-nx-cache --output-style=static`,
  passed: `Test Suites: 2 skipped, 183 passed, 183 of 185 total`;
  `Tests: 3 skipped, 4134 passed, 4137 total`. This includes the new budget test.
- The first failure was therefore a flaky suite that I could not identify. The same inputs pass
  uncached.
- Not run: build, serve, e2e and package targets (forbidden by the brief), and a live Electron
  check (Electron must not be started from this lane). The orchestrator should re-run the D72
  scenario: a new named Haiku main chat should no longer show "RPC timeout: chat:start" for a
  35 s admission.

## Decisions

- Enforce a total host-side admission budget rather than pick a renderer number. Options were:
  (a) renderer timeout = sum of per-step deadlines, which is not a real bound because of the
  64-read init loop; (b) a magic renderer timeout, which was rejected by the brief; (c) a host
  budget plus a derived renderer timeout. Chosen: (c). Evidence: `wait()` had only a per-await
  deadline. Reversible: yes (one constant).
- Budget 90 s: 2.5 times the observed 35 s cold named start, and it keeps the derived renderer
  bound equal to the existing 120 s `chat:resume` timeout. Reversible: yes.
- Default by method in `ClaudeRpcService` instead of editing callers. It covers all callers,
  including the apps surface, without touching account UI files that the frontend lane owns.

## Review fix round (D73)

Fixes the three findings of `code-logic-review-budget-timeout.md` (codex, REVISE 6/10). Builds on
`bugfix-budget-timeout.diff`. Nothing written before the last identity read (binding, link,
metadata) is rolled back. The serial MCP OAuth refresh loop is unchanged.

### F1 (Serious): one host deadline for the whole named RPC

**Deadline chain**

1. **Start, at handler entry.** `namedAdmissionDeadline()` returns
   `Date.now() + NAMED_ACCOUNT_ADMISSION_BUDGET_MS`
   (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:229`). It is the first
   statement of `startSession` (:543), `continueSession` (:991) and `resumeSession` (:1160, the
   activate path). It runs before the account gate, the MCP/OAuth overrides, the profile and the
   prompts, so all of that preparation counts against the deadline.
2. **Passed down as an absolute epoch-ms value.** No globals are used.
   - `chat:start`: `SdkSessionLaunch.admissionDeadline` (:219, set at :661), then
     `startChatSession({... accountSelection, admissionDeadline})` (:973). It is added only
     together with a named selection.
   - `chat:continue` (auto-resume, :1058) and `chat:resume` activate (:1271): the value goes
     through `AutoResumePreflight.admissionDeadline` (:146) and then
     `resumeSession({... accountSelection, admissionDeadline})` (:1709). Again only with a named
     selection.
   - In the adapter, `startChatSession` and `resumeSession` gain an optional field
     (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:908`, :1205) and forward it to
     `executeQuery` (:993, :1328).
   - `ExecuteQueryConfig.admissionDeadline` is defined in
     `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:264` and destructured
     in `session-query-executor.service.ts:1069`. It reaches
     `new NamedAccountQueryAdmission(..., operationDeadline)` (:1122) only on the named branch.
     The ambient path never reads it.
3. **Checked.** `admissionEndsAt = min(now + budget, operationDeadline)` (executor :720), so the
   admission gets `min(budget, remaining)`. `refuseIfExpired()` (:731) runs at these points:
   - before every race in `wait` (:741)
   - after every race (:758)
   - at the top of `bootstrap`, before any lookup or reservation (:775)
   - immediately before the admit/commit (:918)

   In `executeQuery` the first `wait` (`getQueryFunction`) also runs before `bootstrap`, so a
   deadline that ran out during preparation refuses before any reservation exists.
   `refuseIfExpired` refuses the same way the budget timer does: `abortController.abort()`
   (`onAbort`, then dispose: gates closed, held and later tools denied, lease/reservation
   settlement unchanged), then `namedAccountRefusal()`. That gives code `identity-unproved`
   with the fixed summary "Named account admission could not be completed.". This is the same
   code and the same path as the budget timer. `executeQuery`'s catch still disposes, removes
   the registry record and aborts.

**Constants** (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts`)

- `NAMED_ACCOUNT_ADMISSION_BUDGET_MS = 90_000` (:33): the host deadline, measured from handler
  entry.
- `CHAT_ADMISSION_RPC_MARGIN_MS = 30_000` (:40): new. It covers the IPC round trip, the
  handler's work after admission, and any preparation the host cannot interrupt before its
  next deadline check.
- `CHAT_ADMISSION_RPC_TIMEOUT_MS = NAMED_ACCOUNT_ADMISSION_BUDGET_MS + CHAT_ADMISSION_RPC_MARGIN_MS`
  (:47): 120 s. The comment now states the relation renderer timeout > host deadline. The
  renderer (`claude-rpc.service.ts`) is unchanged and still derives its timeout from this
  constant.

**Residual (reported, not changed per D73).** The host checks the deadline only at its own
awaits. If the pre-existing serial OAuth refresh loop on its own exceeds the 90 s + 30 s margin,
the renderer still times out first. In that case the host now refuses (no admission, no
stream, no tools) instead of admitting and streaming into the failed tab. Bounding that loop
remains the later task named in D73.

### F2 (Moderate): an expired budget never admits

An expired end no longer clamps to `setTimeout(0)`. `wait` refuses before racing (:741) and
re-checks after a resolved race (:758), so a step that settled after the end cannot advance.
The commit point re-checks right before `admitted = true` (:918).

### F3 (Moderate): Providers chunk-load error

- `settings.component.html:~172`: `@error` block with `role="alert"`,
  `data-testid="providers-settings-load-error"`, the text "The Providers page could not load.
  Reload the window to try again." and a Reload button (`providers-settings-reload`).
- `settings.component.ts:296`: `reloadWindow()` through the injected `DOCUMENT`. This is the
  same recovery as electron-shell's welcome screen and the canvas board: Angular caches a
  failed chunk, so remounting would fail again. Change detection stays OnPush.

### Tests added

- `session-query-executor.accounts.spec.ts:623`: preparation used up the operation deadline.
  The run is refused `identity-unproved` with no `admitClaudeRoute`, no child, no turn, no
  binding, no settlement, tools denied, and the run aborted (F1).
- `:641`: an operation deadline 500 ms out bounds the admission even with a 90 s budget and a
  60 s step deadline. The run is not settled at 499 ms and is refused at 500 ms, with no
  attach, no metadata and no admission (F1, `min(budget, remaining)`).
- `:662`: the clock moves past the budget (`jest.setSystemTime`, so no timer fires), then the
  paused `commit` resolves. The run is refused, with no attach, no metadata, tools denied and
  only the first turn released (F2).
- `settings.component.spec.ts:802`: manual defer, `DeferBlockState.Error`. The alert role and
  text render, and Reload calls `reloadWindow` (F3, same pattern as
  `electron-shell.view-transition.spec.ts`).

No existing assertion was weakened. The fixture gained only the optional `operationDeadline`
setting.

### Verification

- `node scripts/verify.mjs -t lint,test,typecheck -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,@ptah-extension/chat,ptah-electron,ptah-extension-vscode`
  reported `NX 56 tasks: 54 succeeded, 2 cached, 2 failed`. The failures were `chat:lint` and
  `chat:test`. Every agent-sdk, rpc-handlers, shared, ptah-electron and ptah-extension-vscode
  target passed.
  - `chat:test`: the one failure was my new spec, which assumed the default tab is
    `providers`. It is `claude-auth`, which hosts the deferred Providers page. I removed that
    line, and the rerun `verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=settings.component.spec`
    reported `NX 1 task: 1 succeeded`. On the first run the rest of chat passed: 291 of 292
    suites, 5126 tests.
  - `chat:lint`: errors only in `services/chat-attention-source.service.ts` (no-control-regex)
    and `services/attention-context.util.ts` (no-useless-escape). Both are known local-only
    errors and unchanged against `396f0135b` (`git diff --quiet` returned 0). No lint error is
    in a changed file.
- No flaky suite was observed.

### Files changed this round (9; the budget was 8)

The ninth file is `settings.component.ts`, which needed the reload handler for a recoverable
`@error`.

- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- `libs/frontend/chat/src/lib/settings/settings.component.html`
- `libs/frontend/chat/src/lib/settings/settings.component.ts`
- `libs/frontend/chat/src/lib/settings/settings.component.spec.ts`

### Decisions

- The deadline is an absolute epoch-ms value, not an `AbortSignal`. A number is the smallest
  contract through the existing configs. The admission already owns an `AbortController`, and
  expiry goes through it. Reversible: yes.
- The `chat:resume` activate path also gets the deadline. It uses the same renderer timeout
  and is cheap to cover. Reversible: yes.
- Agent-child and handoff starts pass no deadline. They are not renderer-awaited admission
  RPCs, so they keep the admission's own budget as before. Reversible: yes.
- Not added: a chat-session spec for deadline propagation (file budget). The existing
  `objectContaining` assertions remain valid. Recommended for the next round.
