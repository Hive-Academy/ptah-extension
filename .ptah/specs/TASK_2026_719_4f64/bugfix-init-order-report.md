# Bugfix report: init order of the named Claude final child (D68)

Status: **IMPLEMENTED, NOT VERIFIED GREEN.** The source change is in place. `cli-agent-runtime:test` still fails: one compile error in the new spec block and two adapter specs that expect the old order. I hit the 45-tool-call cap before I could fix them. The exact fixes are listed under "Open items".

## 1. Hypothesis: CONFIRMED

Evidence from the bundled CLI `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` (package 0.3.278). I grepped small windows only.

- **The init builder.** `function aqe(e){... g={type:"system",subtype:"init",cwd:e.cwd,session_id:e.sessionId,tools:...}`.
- **The headless session (SDK stream-json host).** It creates the engine with `Be=dMe({run:z0,queryParams:async()=>{if(de===null)throw Error("headless session: turn picked up without prepared params")...}})` and passes no `ambient`. Its input feeds only the turn queue: `streamInput:async(_e)=>{for await(let Ie of _e){...uo({type:"turn",...bt})}}`. In `dMe`, `mt()` returns `null` when `ambient` (X) is absent, so the engine's `system/init (first)` yield is skipped on this path.
- **Where headless init is built: inside the per-turn function, after the user input.**
  - `Mo=id(An,{phase:"input",messages:s,...});po=Ie?.orphanedPermission?.initFirst===!0||Ie?.handedOffTurn!==void 0;if(po)yield await Ln(An,To,$n.fastMode);`
  - later, at the query phase: `Ro=id(rn,{phase:"query",...});if(!po)yield await Ln(rn,ts,$n.fastMode);`
  - Here `Ln` is `async function Ln(Ye,Ie,He){... return await Lg({session:Ye.session,tools:Ye.tools,...})}`, and `Lg` calls `aqe(...)`.
- **Result.** In stream-json input mode, `system/init` is yielded per turn, only after a user message has been picked up and processed. The only exceptions are an orphaned-permission or handed-off turn, which are still per turn.

Ptah side:
- `ClaudeNamedLaneAdmission.launch` looped on `child.query.next()` waiting for init before `released = true`.
- The task was pushed only afterwards, by `claude-cli.adapter.ts` calling `named.enqueue(input.task, …, true)` after `launch` returned.

This is a deadlock. It matches the live log `phase: final, step: init-wait, interrupt: deadline`.

## 2. Fix (D68)

`libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`:

- **New `launch` parameter.** `launch(queryFn, options, metadata, firstTurn: { message; sessionId? }, onBinding?)`.
- **Release after the identity proof.** The final child proves the account (`readIdentity()` + `sameIdentity`). Then the new step `released` pushes and commits the first turn on the final gate. Then the existing `init-wait` → `init-version` → `init-key-source` → `resume` checks run unchanged, with the same refusal codes.
- **Tools.** `canUseTool` denies with `Account admission pending.` until init is verified. Between a verified init and the release, it waits for the launch outcome: it resolves on `released` or on abort/dispose, then delegates or denies. This keeps a legitimate tool call in the binding window from being denied.
- **Order after init.** Binding commit, binding checks, SDK session attach, metadata, reference, `onBinding` and the final identity re-read all stay after the init verification.
- **No output before verification.** Messages read before verification, including init and any early model output, stay in `buffered`. They replay in order through the existing `query` proxy, which is set only after release. On any refusal the proxy is never set, so nothing is forwarded. The caller's existing dispose path handles abort, child close and the lease.
- **First turn.** `admittedTurns` no longer re-validates the first turn: no binding exists yet, and the same child proved the account just before. Later turns still run `validateTurn()`.
- **`enqueue`.** It loses its `initial` flag, because the first turn now goes through `launch`. The message builder moved into a private `userTurn()`.
- **Diagnostics.** The step word `released` was added to `ClaudeLaneLaunchStep`. A stale comment ("before any task text") was updated.

`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`: passes `{ message: input.task, sessionId: input.resumeSessionId }` to `launch` and drops the post-launch `enqueue(..., true)`.

## 3. Tests

New block `named lane final child init after the first turn (D68)` in `claude-sdk-lane-runner.spec.ts`:
- **Fake CLI.** The final child's `next()` emits `system/init` only after it consumed the first prompt message.
- **Cases:**
  - init after release passes, with order `prompt, commit, attach` and in-order replay (init, then the early assistant message)
  - a wrong version refuses, with no commit, no attach and no `query`
  - a non-personal `apiKeySource` refuses
  - no init before the deadline refuses with `final/init-wait/deadline`
  - a tool call before init is denied
- **Not run.** These tests did not run yet because of the compile error below. I also did not run them against the old code. By construction the first case cannot pass there: the old `launch` never releases a prompt, so it hits the deadline.

## 4. Main-chat named path

Not inspected. I ran out of the call budget. **Open item:** check `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` and its named-account helpers for a "wait for `system/init` before committing the prompt gate" loop.

## 5. Verification

Command: `node scripts/verify.mjs -t lint,test,typecheck -p @ptah-extension/cli-agent-runtime`. Result: `NX 3 tasks: 2 succeeded, 1 failed`, with lint and typecheck passing. The test target failed. Tests: 2 failed, 1 skipped, 2613 passed, plus one suite that did not compile. Full log: `C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\13144814663817837301`.

Failures, all caused by this change:
1. **`claude-sdk-lane-runner.spec.ts` does not compile.** TS2322 at lines 1027-1028: my `releaseReservation` / `retainUnresolvedReservation` mocks `jest.fn(async () => ({ code: 'ok' as const }))` do not match the outcome types. Fix: use plain `jest.fn()`, as the other fixtures do.
2. **Two specs in `claude-cli.adapter.spec.ts` (`named Claude lane admission`) fail:**
   - `bootstraps without task options and awaits both stores and the receipt callback on a fresh final gate`
   - `revalidates queued input at consumption and retains an uncertain child exit`

   Both expect the old order, where the task is enqueued after launch and the first prompt read is the revalidated one. Around line 857, the first `prompt.next()` now yields the released task without revalidation, so the expected rejection resolves. Fix: change the fixture so child 1 emits init after it consumes the first prompt. Then read past the first turn before asserting that the queued turn is revalidated, and update the bootstrap/receipt expectations to the new order.

Degradation audit: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0 (`TOTAL 277 unsuppressed site(s)`). I added no new catch block.

## Files changed

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`

## Decisions

- **First turn travels through `launch`.** Options: (a) pass it into `launch` (chosen); (b) keep `enqueue(..., initial)` and run it concurrently before `launch` resolves. Evidence: `enqueue` requires `released`, and D68 requires the release inside the final phase. Reversible: yes.
- **Tool calls after a verified init but before the binding is committed wait instead of being denied.** Options: deny until `released` (the old behaviour), or wait. Evidence: D68 requires denial only until init is verified, and a denial in that window would reach the model as a real refusal. Reversible: yes.
- **The first turn skips `validateTurn`.** Evidence: no binding or reference exists before the commit, and the same child proved the account immediately before the release. Reversible: yes.

## Session 11 — completion

Verdict: **lane fix GREEN; main-chat named path has the same deadlock and is NOT fixed (open item below).**

### Files changed (this session)

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`: TS2322 fixed at lines 1027-1028. `releaseReservation` / `retainUnresolvedReservation` are now plain `jest.fn()`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`:
  - **Fixture.** `namedFixture` gains `initAfterFirstTurn` (opt-in). When it is set, the final child's stream reads one prompt message (recorded in `turnsBeforeInit`) and makes one tool call (answer kept in `permissionsBeforeInit`) before it emits `system/init`. This models CLI 2.1.278 streaming input.
  - **`bootstraps without task options ...`** now asserts the D68 order:
    - child-1 `accountInfo` < first turn consumed (= the task) < `commitRunBinding`
    - the pre-init tool call is denied
    - the runner was not called before the receipt callback, so no output is forwarded
    - a tool call after init stays pending until the binding is committed, then settles
    - the task travelled exactly once
  - **`revalidates queued input ...`** reads past the released first turn (asserts it is the task). The queued turn must still reject with `identity-unproved`. Retain/release expectations are unchanged.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`: **real defect found by the adapter spec and fixed.**
  - **Defect.** `admittedTurns` skipped re-validation with a per-iterator `initial` flag. Any fresh `[Symbol.asyncIterator]()` over the same gate therefore skipped `validateTurn` for the first message it saw, which could be a later queued turn. The adapter spec showed it: the queued turn resolved instead of being refused.
  - **Fix.** The skip is now keyed on the exact released message (`private releasedTurn?: SDKUserMessage`, set in `launch`, cleared when consumed). Every other turn is re-validated.
  - No new catch block was added. `dispose()` aborts `this.abort` (line ~952), so a tool call held after init is released as a deny on refusal.

### Old-code failure proof

Method:
1. Copied the current `claude-sdk-lane-runner.ts` and `claude-cli.adapter.ts` aside.
2. Wrote both from `git show d545db65a:<path>`.
3. Ran `node scripts/verify.mjs -t test -p @ptah-extension/cli-agent-runtime -- --testPathPatterns=claude-cli.adapter`.
4. Copied the new files back. `cmp` passed for both. `git diff --stat` before and after was byte-identical (4 files, 306+/52-), and the scratch copies were deleted.

The lane-runner D68 block cannot compile against the old 4-argument `launch`, so I used the adapter spec as the proof.

Result on the old code: `Tests: 2 failed, 60 passed, 62 total`.
- `named Claude lane admission › bootstraps without task options and awaits both stores and the receipt callback on a fresh final gate`: `thrown: "Exceeded timeout of 5000 ms for a test."` The old `launch` waits for init and never releases the task. This is the live deadlock.
- `named Claude lane admission › revalidates queued input at consumption and retains an uncertain child exit`: same timeout.

### Test results (new code)

- `node scripts/verify.mjs -t test -p @ptah-extension/cli-agent-runtime -- --testPathPatterns="claude-sdk-lane-runner|claude-cli.adapter"`: `Test Suites: 2 passed, 2 total`, `Tests: 124 passed, 124 total`. This includes the five D68 cases (`releases the first turn after the identity proof and passes on init`, two `it.each` init refusals, `refuses when no init arrives before the deadline`, `denies a tool call before init is verified`) and the full adapter spec.
- `node scripts/verify.mjs -t lint,test,typecheck -p @ptah-extension/cli-agent-runtime`: `NX 3 tasks: 3 succeeded`.
  - Tests: `Test Suites: 118 passed, 118 total`, `Tests: 1 skipped, 2677 passed, 2678 total`.
  - Lint: warnings only (`preserve-caught-error`); none is on a line this change touched.
- `@ptah-extension/agent-sdk` was not run because it was not changed.

### Main-chat named path: AFFECTED, NOT FIXED (open item)

`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` has the same pre-D68 order:
- `:624-641` `NamedQueryGate.stream` awaits `ready` and pulls nothing from the caller's source, including the first user message, until `commit()`.
- `:801` the final child is opened on `gate.stream(source, ...)`, and `:808` proves identity (`verifyIdentity`).
- `:812-823` then loops on `this.wait(query.next())` until `system/init`. `this.wait` has the `deadlineMs` timer at `:691`.
- `:843` `gate.commit()` runs only after init, registry bind, binding commit, attach and metadata save.

With CLI 2.1.278 streaming input, `system/init` follows the first user message (section 1). A named main chat therefore hits the same deadline refusal.

The spec also encodes the old contract:
- `session-query-executor.accounts.spec.ts:194-220` expects `yielded() === 0` at the metadata checkpoint and a deny after init. Its fake `next` (`:160-164`) returns init without consuming the prompt.
- About 20 other `expect(f.yielded()).toBe(0)` assertions (`:278-619`) cover refusals that happen after identity proof.

Fixing it means:
- giving `NamedQueryGate` a `releaseFirst()` stage (yield only the first caller turn and pull no later turn before `commit()`)
- calling it right after `:808`
- gating `canUseTool` like the lane (deny before verified init, then hold until `admitted`, released on abort or dispose)
- adding a fixture flag where `next` awaits the prompt read before it returns init, as a regression test
- re-deciding each `yielded() === 0` assertion: after D68, refusals after the identity proof yield 1, and output, tools and binding stay withheld

That touches 2 more files and about 20 assertions. It did not fit this session's budget, and a partial change would have broken `agent-sdk:test`, so I made none. The live failure so far is for lanes only (the `phase: final, step: init-wait` log). The main chat has no live log yet, so whether it is affected is inferred from the code, not observed.

### Decisions

- **Skip re-validation by message identity, not by iterator.** Options: per-iterator flag (previous) or per-admission released message (chosen). Evidence: the adapter spec's second iterator skipped validation of a queued turn. The gate yields the same object it was pushed (`named-account-prompt-gate.ts:57-62`). Reversible: yes.
- **Main chat is left unfixed and reported.** Evidence: about 20 dependent assertions, and a budget of at most 45 calls. Reversible: yes.

## Session 11 — main chat (D69)

Verdict: **main-chat named path FIXED and GREEN.** The named main chat now uses the D68 order. The regression test fails on the old code with the live deadlock.

### Files changed

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
  - `NamedQueryGate` now has a release-first stage. `releaseFirst()` hands over only the first caller turn, without `approve`, because the same child proved the account right before. After that turn is yielded, the stream awaits `commit()` before it pulls another turn from the source. Later turns still pass `approve` (`verifyIdentity`). `close()` wakes both stages and ends the stream.
  - `launch` calls `gate.releaseFirst()` right after the identity proof (`verifyIdentity`).
  - `canUseTool` is denied until the `system/init` check passes (`initVerified`). After that, the call awaits the admission promise. It is settled `true` where the binding is committed (just before `gate.commit()`) and `false` first in the `launch` catch (refusal, abort, deadline, dispose). A held call is therefore released as a deny on every failure path. No new catch block was added.
  - Output is still withheld. The init loop buffers SDK messages, and the `Query` proxy is returned only after commit. A refusal never returns it.
  - An init check failure or the `wait` deadline still throws into the existing refusal path (dispose, no binding).
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
  - **Fixture.**
    - New flag `initAfterFirstTurn`: the final child's `next` awaits the prompt read (event `turn-consumed`) and makes one tool call (kept in `preInitTools`) before it returns `system/init`. This models CLI 2.1.278.
    - The source now yields two turns and records `turn-1` and `turn-2`.
    - The prompt iterators are exposed.
    - New helpers: `toolContext`, `AFTER_PROOF` and `expectNoAdmission` (no `turn-2` pulled; a tool call is denied).
  - **New regression test** `releases the first turn after the identity proof, then admits on init (D69, CLI 2.1.278 order)`. It checks:
    - the order: identity proof < first turn consumed < init < binding commit < metadata
    - the pre-init tool call is denied
    - before commit: one turn yielded, no second pull, the run is unresolved, nothing is saved
    - after commit: init is replayed and the later turn arrives after metadata
    - `turn-1` was pulled exactly once
  - **New test** `refuses when no init arrives before the deadline, with the first turn only and no binding`.
  - **Changed test.** In the first test, the tool call after init is now held until admission and then allowed. Before, it was denied. D69 item 2 requires this change.

### Re-decided `yielded()` assertions

- **Stay 0 (refusal before the identity proof):** 9 standalone assertions.
  - boundary matrix
  - tripwire matrix
  - bootstrap deadline matrix
  - bootstrap unproved
  - launch throws (bootstrap and final)
  - final identity mismatch
  - fresh unknown identity
  - unknown resume (two tests)
  
  In the three matrices with mixed steps, these entries also stay 0:
  - `fail`: admit, current, bootstrap-identity, final-identity
  - `cancel`: lookup, admit, current, boundary, bootstrap-identity, bootstrap-close, final-identity
  - late completion: lookup, admit, current, bootstrap-identity, final-identity
- **Now 1 (refusal or pause after the identity proof):**
  - init-patch matrix (2)
  - `fail` at init, registry, commit, attach and metadata (5)
  - `cancel` at init, registry, commit, attach and metadata (5)
  - late metadata after cancel
  - "keeps later turns and output pending" matrix (4)
  - late completion at init, commit, attach, metadata, current:3 and final-identity:2 (6)
  - changed identity after durable writes (2)
  - waits for final child close proof
  - retains uncertain final child
  - first test (metadata pause)

  Each refusal case also calls `expectNoAdmission`: no later turn and a denied tool. Existing `saved()` and `commitRunBinding` assertions are unchanged.
  
  The refusal matrices that contain `init` run with `initAfterFirstTurn`, so the released turn is consumed deterministically before the init step.

### Old-code failure proof

1. Copied `session-query-executor.service.ts` aside, then wrote it from `git show 72fe980e1:<path>`.
2. Ran `verify.mjs -t test -p @ptah-extension/agent-sdk -- --output-style=static --testPathPatterns=session-query-executor.accounts`.
   - Result: `Tests: 30 failed, 64 passed, 94 total`.
   - `named SDK bootstrap and final admission › releases the first turn after the identity proof, then admits on init (D69, CLI 2.1.278 order)` failed with `thrown: "Exceeded timeout of 5000 ms for a test."`, cause `{ code: "identity-unproved" }`. The old gate never releases the turn, so init never comes and the deadline refuses. This is the live deadlock.
3. Copied the new file back. `cmp` passed, and `git diff --stat` before and after was byte-identical (8 files, 573+/90-). The scratch copies were deleted.

### Verification

- `node scripts/verify.mjs -t test -p @ptah-extension/agent-sdk -- --output-style=static --testPathPatterns=session-query-executor`: `Test Suites: 6 passed, 6 total`, `Tests: 169 passed, 169 total`.
- `node scripts/verify.mjs -t lint,test,typecheck -p @ptah-extension/agent-sdk -- --output-style=static`: `Successfully ran targets lint, test, typecheck`.
  - Tests: `Test Suites: 2 skipped, 183 passed`, `Tests: 3 skipped, 4118 passed, 4121 total`.
  - Lint: warnings only. One `max-lines` warning is on the service file, which was already over 700 lines before this change.
- Host projects (`ptah-electron`, `ptah-extension-vscode`) were not run. The change is internal to a non-exported class and `launch`'s body, and no public signature changed.

### Open risks

- The first turn is not run through `approve`. This matches the lane (D68 decisions). The same child proved identity immediately before the release.
- A tool call held after init has no timeout of its own. It settles when admission settles, and every admission step is bounded by the `wait` deadline.
- Not proven live. CLI 2.1.278 ordering is modelled by the fixture only, so a live Electron named main chat is still needed.

### Decisions

- **Tool calls between init and commit wait.** Options: wait (chosen) or deny. Evidence: D69 item 2 and the lane decision in section "Decisions". Reversible: yes.
- **Refusal matrices with `init` use `initAfterFirstTurn`.** Options: flag on (chosen), or the default fixture. Evidence: with the default fixture, whether the released turn is yielded before a refusal at `init` depends on microtask timing. Reversible: yes.

## Session 11 — review fix round (D70)

Scope: fixes F1 and F2 of `code-logic-review-init-order.md` (REVISE 4/10) on top of the saved
`bugfix-init-order.diff`. This round changed six files: the shared gate helper, both named paths,
their two specs, and this report. No git action was taken.

### SDK evidence for the hook semantics (SDK 0.3.278)

- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:209`, function `bVe` (warning
  `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`): "permissionMode 'bypassPermissions' auto-approves every tool
  call (except explicit deny rules) before the callback is consulted. To gate every tool call, use a
  PreToolUse hook instead." For bare `allowedTools` and settings allow rules, the same function says
  "To gate every tool call, use a PreToolUse hook".
- `sdk.d.ts:2647-2650` `PreToolUseHookSpecificOutput { hookEventName: 'PreToolUse';
  permissionDecision?: HookPermissionDecision; permissionDecisionReason? }`. `sdk.d.ts:916`
  `HookPermissionDecision = 'allow' | 'deny' | 'ask' | 'defer'`. `sdk.d.ts:902-907`
  `HookCallbackMatcher { matcher?; hooks; timeout? /* seconds */ }`. `sdk.d.ts:1658` `Options.hooks`.
- Limit of this evidence: the SDK states the semantics, but the CLI binary enforces them. The JS
  package cannot show that enforcement. A live YOLO run that denies a tool before admission was
  not run: this session must not start Electron or read credentials. That run is an open item.

### F1 — tools could run before admission (fixed)

- One gate for both permission paths: `withNamedAccountToolGate(options, admitted)` in
  `libs/backend/agent-sdk/src/lib/helpers/named-account-prompt-gate.ts:43` (exported through the
  existing `export *` barrel). It wraps `canUseTool` and adds a `PreToolUse` matcher with no
  `matcher` (all tools) at index 0. The caller's existing `PreToolUse` matchers and every other hook
  event stay after it. Both callbacks call the same `admitted()` function. The hook denies with
  `permissionDecision: 'deny'` when `admitted()` resolves false or the CLI aborts the hook signal.
  When admitted, it returns `{}` (no decision), so the caller's mode, hooks and `canUseTool` still
  apply. The matcher timeout is `NAMED_ACCOUNT_TOOL_HOLD_SECONDS = 600` (`:15`). This is above
  the whole admission chain, where each awaited step has its own 15 s deadline. So the hold ends on
  admission, refusal, abort or dispose, not on the CLI hook timeout.
- Lane: `claude-sdk-lane-runner.ts:767-775`. `toolAdmitted` denies before init is verified. After
  init it waits on `launched`, which settles on admission or abort (dispose aborts). It admits only
  when `released && !disposed && !aborted`. The old inline `canUseTool` state is gone, so there is
  one state machine.
- Main: `session-query-executor.service.ts:831-842`. `toolAdmitted = initVerified && await admission
  && !disposed && !aborted`, passed to the same helper. It replaces the inline wrapper.
- YOLO: `claude-sdk-lane-options.ts:262-277` still maps YOLO to `bypassPermissions`. That is no
  longer a gap, because the hook runs before the mode's auto-approval.

### F2 — main-chat dispose was not terminal (fixed)

`session-query-executor.service.ts`:
- New fields: `disposed`, `childEnded`, `settleAdmission`. The admission resolver moved from a
  `launch` local to a field, so `dispose` can settle it.
- `dispose()` (`:926-932`) now sets `disposed`, settles admission false (held and later tool calls
  are denied), closes gates and the child, removes the abort listener, and aborts the session
  controller. Like the lane's dispose, that rejects every pending admission `wait`. Exception: when
  the admitted child already ended on its own (`terminated.then` sets `childEnded`, `:885`), the
  controller is not aborted, which keeps the normal end of a session unchanged.
- `wait()` (`:725`) throws when `disposed` is set, even if the awaited value resolved.
- After the final identity read (`:881-882`), the flow re-checks `disposed`/aborted before
  `settleAdmission(true)`, `gate.commit()` and returning the proxy. A late successful read after
  dispose therefore refuses. It never admits, commits later turns or returns output.
- The later-turn identity refusal (gate `stream` catch → `dispose`) now goes through the same
  terminal path.

### New tests

Main (`session-query-executor.accounts.spec.ts`, describe "named SDK bootstrap and final admission"):
1. `consumes no prompt while the same-child identity proof is still pending`: pauses
   `final-identity:1`; 0 prompts yielded until the proof succeeds, then 1. Closes the review's test
   gap.
2. `gates every tool with a PreToolUse hook under bypassPermissions, ahead of caller hooks (F1)`:
   `bypassPermissions` plus a caller `Bash` hook. Our matcher is at index 0 with no `matcher`, and the
   caller hook is kept at index 1. Pre-init → deny. Admitted → `{}`. After dispose → deny.
3. `holds a PreToolUse call after init until the binding commits, then gives no decision (F1)`:
   pending while `metadata` is paused; `{}` after admission.
4. `denies a held PreToolUse call when the run is aborted before admission (F1)`: abort while held
   → deny; the run is refused; no later turn.
5. `makes dispose terminal: a held tool is denied and a late identity success admits nothing (F2)`:
   pauses the final identity read (`final-identity:2`) and holds both `canUseTool` and the hook.
   Then `dispose()`: both are denied and the controller is aborted. Then the identity read
   succeeds: `launch` is refused (no proxy returned), no `turn-2`, and a new tool call is denied.

Lane (`claude-sdk-lane-runner.spec.ts`, describe "named lane final child init after the first turn
(D68)"; fixture gained `yolo` (permission level `yolo` → `bypassPermissions` plus a caller `Bash`
`PreToolUse` hook) and `hold: 'commit' | 'proof'`):
1. `consumes no prompt while the same-child identity proof is pending`: 0 prompts until the proof
   read resolves, then 1.
2. `denies a YOLO PreToolUse call before init is verified, ahead of caller hooks (F1)`: asserts
   `permissionMode: 'bypassPermissions'`, the matcher order, the kept caller hook, and pre-init → deny.
3. `holds a YOLO PreToolUse call after init until the binding commits (F1)`: pending while
   `commitRunBinding` is held; `{}` after admission; deny after `dispose()`.
4. `denies a held YOLO PreToolUse call when the run is aborted before admission (F1)`: deny; the run
   rejects; `attachSdkSession` is not called.

### Verification (lock script, scoped, foreground)

- `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/cli-agent-runtime,@ptah-extension/agent-sdk -- --testPathPatterns="claude-sdk-lane-runner|claude-cli.adapter|session-query-executor"`
  → `NX 2 tasks: 2 succeeded`. The first attempt failed twice, both in new test code: a TS2540
  read-only `assembly.hooks` assignment in the lane fixture, and a main abort test that asserted
  `rejects.toThrow()` against a non-Error refusal. Both were fixed in the specs and the rerun is
  green.
- `node D:/projects/ptah-extension/scripts/verify.mjs -t lint,test,typecheck -p @ptah-extension/cli-agent-runtime,@ptah-extension/agent-sdk`
  → `NX 6 tasks: 6 succeeded`. agent-sdk test: 4123 passed, 3 skipped (4126; previously 4118 passed,
  plus 5 new). cli-agent-runtime test: 2681 passed, 1 skipped (2682). Lint has 0 errors; the
  warnings are existing `max-lines`/unused-var warnings. Typecheck passes for both libs.
- The pre-push hook's VS Code and Electron typechecks were not run here. The changes are additive
  (one new export, internal fields), and both hosts consume these libs only through the barrels.

### Decisions

- **Hook returns no decision when admitted, not `allow`.** Options: `{}` (chosen) or
  `permissionDecision: 'allow'`. Evidence: `allow` from a hook would skip the caller's `canUseTool`
  and permission mode (for example ask/plan) and widen privilege. Reversible: yes.
- **One shared helper in `named-account-prompt-gate.ts`** rather than two inline wrappers. Options:
  shared helper (chosen) or a copy per path. Evidence: the brief says "no duplicated state machines".
  Each path still owns its own admission predicate. Reversible: yes.
- **Main dispose aborts the session controller unless the admitted child ended on its own.**
  Options: always abort, never abort (internal flag only), or conditional (chosen). Evidence: every
  failure call site (`:1073`, `:1095`, `:1383`) already aborts after `dispose`. A natural end
  should not look like an abort to the session's other listeners. Reversible: yes.
- **Hook timeout 600 s.** Options: the CLI default or an explicit value above the admission chain
  (chosen). Evidence: `sdk.d.ts:906`. The CLI's behaviour on a hook timeout is not visible in the
  JS package, so the gate must never depend on it. Reversible: yes.

### Open items

- Minor: a live YOLO check (named lane plus named main chat) that a tool request before admission
  is denied by the CLI. Static SDK evidence only (see above).
- Minor: in main, the binding is committed and the metadata saved before the final identity read.
  A dispose during that read refuses the run, but it does not roll back the durable binding row.
  This is unchanged from before this round and the review did not ask for it.
- Minor: the review's early-output buffering gap (assistant events before init, or while
  persistence is pending, asserted as withheld) is still not tested separately.
- Minor: the adapter spec's held-callback test (Adapter spec:789) still uses a base callback that
  denies. Not touched, to keep within the file budget.
