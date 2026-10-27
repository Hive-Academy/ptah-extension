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
