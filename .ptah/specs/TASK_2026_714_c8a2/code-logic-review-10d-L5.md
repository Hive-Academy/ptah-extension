# Code Logic Review - batch 10d.L5

Score: 6/10. Verdict: REVISE. Blocking 1, Serious 2, Moderate 3.

Scope: the 11 modified files (git diff), the lane report, and the lane-outcomes store, register and start code. No tests, lint, build or diagnostics were run, as instructed.

## Blocking

### B1. "Last segment wins" usage is wrong for every per-step adapter, and the report says other lanes are unaffected

- `agent-process-manager.service.ts:1260` overwrites `tracked.outcomeUsage` with every segment that carries `usage`. The branch is generic: it runs for any handle that has `onSegment`, not only the native Codex lane.
- Native Codex emits one usage segment at turn end (`codex-lane-events.ts:152-164`), so last-wins is correct there.
- OpenCode emits a usage segment on every `step_finish` (`opencode-cli.adapter.ts:1065`, `usage: {inputTokens, outputTokens, costUsd}`). Copilot (`copilot-sdk.adapter.ts:722`), Antigravity (`antigravity-cli.adapter.ts:1351`), Cursor and Pi also stream through `onSegment`.
- A multi-step OpenCode lane now records only its final step as the lane total. Before this change those columns were null. The row now looks valid and is understated.
- The spec at `agent-process-manager.service.spec.ts:1452-1457` emits `inputTokens: 12000`, then `0`, then the final value, and asserts the last one. This pins the overwrite as intended behaviour, so no test would catch the undercount.
- `LANE_OUTCOME_READER` feeds lane-routing, so the wrong values flow into routing decisions.
- Fix: either restrict capture to adapters whose usage is a terminal total (a flag on the segment or handle), or accumulate per-step usage by summing. Add a spec for the multi-step case. Correct the "legacy lanes unaffected" claim.

## Serious

### S1. G5c root cause is not proven, and no behavioural test covers the fix

- The report states the original error is unrecoverable (`{}`), then asserts a cause: "premature resolution can throw". That is a hypothesis.
- The new `container.smoke.spec.ts:766-778` only checks the text order of `container.ts`: `indexOf` of the start call is greater than `indexOf` of `registerPhase4Handlers`. No test resolves the recorder at the new point or proves it no longer throws.
- A plausible mechanism exists and the report does not name it. `register.ts:35-43` builds the store lazily with `instanceCachingFactory`, choosing Sqlite or KeyValue depending on `isRegistered(SQLITE_CONNECTION)`. The pipeline and recorder are also cached. Eager resolution at the old position could freeze whichever store existed then. Electron registers SQLite at `phase-2-libraries.ts:380`, after `registerLaneOutcomeServices` at `:294`, and the old start was at about `:422`, after both. So this particular ordering does not obviously explain the throw. The real cause could be elsewhere (classifier / SDK graph resolution).
- Next step: run the live Electron app and confirm `Lane outcomes start failed` is gone from app.log. Keep the new message/stack logging.

### S2. VS Code and CLI roots still start early, so the fix is Electron-only and the root cause is unchecked there

- `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:268` starts lane outcomes in phase 2.
- `libs/backend/cli-engine/src/lib/lane-outcomes-wiring.ts:27` starts it with its own ordering.
- If the true cause is ordering, those hosts may log the same warning. If it is not ordering, the Electron move did nothing.
- Per CLAUDE.md, Electron is the priority host, so I do not block on this. The report should say the other hosts were not examined.

## Moderate

- M1. `apps/ptah-electron/src/di/container.ts:47` is a bare statement with no comment on why it must follow phase 4. A later refactor can move it back, and only the string-order spec guards it. Add a short comment. The spec's `indexOf` calls depend on exact call text (`'startAndRegisterLaneOutcomes(root, logger,'`) and break on reformatting.
- M2. Callbacks (`SUBAGENT_STOP`, `BUDGET_STOP`, `subagentEnded`) now subscribe after phase 4 instead of phase 2. Within `ElectronDIContainer.setup` nothing can spawn a lane before it returns, so I found no event loss. `shutdown.ts:323` resolves the disposer at quit, and the disposer is registered by `container.ts:47`. This is OK. It would break only if some phase 3/4 eager singleton starts a lane, which I did not see.
- M3. `libs/backend/lane-outcomes/src/lib/di/start.ts:199-205` now logs the message as a string plus `stack`, which fixes the `{}` problem. The sibling warnings in the same file (`start.ts:~65` cleanup failure, `~134` callback registration failure, `~151` drain failure) still pass `{ error: asError(error) }`, so they will serialize as `{}` too. Apply the same treatment.

## Requirement checks

| Item | Result |
| --- | --- |
| G5a: Codex usage reaches the row | OK. Input and output tokens are copied at `lane-completion-outcome.ts:68-70`, cost only if reported (else null). Partial usage gives null for missing fields. Cache-read is dropped because the schema has no column, as the report states. |
| Double counting (Codex) | OK. One usage segment per turn, cleared at `agent-process-manager.service.ts:2256` on continuation, so a resumed lane does not inherit the previous turn. Spec at `:2070-2075`. |
| Under-counting (other adapters) | Not OK, see B1. |
| G5b: receipts empty by design | Confirmed. The receipts INSERT is at `sqlite-lane-outcome.store.ts:176`, inside `applyInTransaction` (`:146`). It runs only after a held report is applied to an existing row and an effect resolves (`:151-175`). Plain `ptah_agent_report` sends a peer message and submits no structured report (`agent-report-router.service.ts:339-379`), so zero receipts is expected. No code change is the right call. |
| Claude lanes | Claude CLI also has `onSegment` (`claude-cli.adapter.ts:254`). If it streams usage per segment it falls under B1 as well. The SDK chat path does not use this branch. |
| Phased-DI guard specs | `rpc-surface.spec.ts`, `surface-composition.spec.ts` and `expected-resolvable.ts` do not reference the start call (only classifier tokens at `expected-resolvable.ts:43`), so they are unaffected. The updated smoke spec reads files with `path.join(__dirname, ...)`, fine on Windows and Linux. Not run, per rules. |
| Types, `any`, casts | None added. `CliOutputSegment['usage']` is used directly. `tracked.outcomeUsage` is optional and cleared on continuation. |
| Degradation-audit comments | No new swallowing introduced. |
| MCP | Untouched. |

## Five logic questions

1. Silent failure: B1 writes plausible but understated tokens/cost. A start failure is still non-fatal and logged, and registers a no-op drain (`start.ts:196-209`).
2. User action: running a multi-step OpenCode lane, then viewing outcome or routing stats.
3. Wrong-answer input: a lane whose adapter streams more than one usage segment.
4. Dependency failure: recorder resolution failing at start is logged and does not block the app. OK.
5. Missing: a behavioural test for start order, a multi-segment usage test, and the same logging fix for sibling warnings.

## Verdict

REVISE. Fix B1 (limit capture to total-reporting adapters or sum steps, with a spec), soften or prove the G5c root-cause claim, and apply the message/stack logging to the sibling warnings. The G5b conclusion is correct, and the Codex path of G5a is correct.
