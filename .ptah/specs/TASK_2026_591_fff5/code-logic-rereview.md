# Code logic re-review — TASK_2026_591, batch 1, revise round 1

## Verdict

**Score: 8/10 — APPROVED**  
**Findings: 0 blocking, 0 serious, 0 moderate, 0 remaining failure modes.**

Both defects from the first review are addressed. This is sound rather than exemplary because the new PID tests cover normal first/continued completion and spawn error but do not directly simulate an old child's late close after a second turn starts; the identity comparison itself provides that protection. The score is above 7 because the implementation preserves the required liveness and resume invariants and scoped verification is clean, but below 9 because the adapter still relies on process-event ordering that is difficult to exercise with the present fake child.

## Defects

None found in the revised scope.

## Verification of the two fixes

1. **Active-child lifetime and PID ownership — fixed.** `opencode-cli.adapter.ts:697-706` assigns the child for each new turn and clears it only when the exiting child is still that exact active child. `runTurn` invokes that callback on both `close` (`:824-834`) and `error` (`:836-845`). Consequently, a late close/error from an older turn cannot erase a newer turn's child, while an idle completed lane exposes no stale PID through `getPid()` (`:729`). The added tests cover PID presence during each live turn, absence after completion, and the error path (`opencode-cli.adapter.spec.ts:1123-1153`).

2. **Resumed session identity — fixed.** `resumableSessionId()` is `capturedSessionId ?? options.resumeSessionId` (`opencode-cli.adapter.ts:716-717`) and is now returned by `getSessionId` (`:726-730`). This lets manager tracking retain the supplied resume ID even when the stream emits no `sessionID`. The added silent-turn test verifies the value before output and after close (`opencode-cli.adapter.spec.ts:1159-1167`).

3. **Abort remains correct.** Clearing `activeChild` does not alter the abort closure: `onAbort` retains the particular turn's `child` and waits for that child's `whenSpawned` before tree-killing its PID (`opencode-cli.adapter.ts:773-786`). While a turn is live, `getPid()` returns that same active child. The revised abort test correctly retains the assertion that `killProcessTree` receives the continued-turn PID before its close, and drops only the now-invalid post-close PID assertion (`opencode-cli.adapter.spec.ts:1107-1117`).

## Five logic questions

1. **Silent failure:** No remaining silent stale-PID or resumed-ID loss was found in the revised paths.
2. **Unexpected user action:** Stopping an idle completed lane now receives no PID from this adapter, so it cannot target the prior child's recycled PID.
3. **Wrong-answer input:** A resumed run with no session-bearing output now returns its supplied resume session ID rather than `undefined`.
4. **Dependency failure/timeout/unexpected shape:** A spawn error clears the active PID; abort still targets the captured live child through `whenSpawned`. The earlier reviewed error-shape and recovered-exit handling remain unchanged.
5. **Unspecified requirement gap:** No new material gap was found. A future regression test may explicitly fire an older child's close after a newer child has become active, but the production identity guard already enforces the required outcome.

## Scope and evidence

Reviewed revise-round report, current adapter/spec diff, targeted implementation paths, and the prior manager stop/release contract. Ran `npx nx test cli-agent-runtime --testFile=opencode-cli.adapter.spec.ts`: 68/68 tests passed. Scoped TypeScript diagnostics for the adapter and spec: 0 errors, 0 warnings.
