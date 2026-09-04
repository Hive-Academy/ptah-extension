# TASK_2026_363 — Batch A report

Hold the no-activity watchdog while no turn is in flight and for the lifetime
of every registered subagent.

## Files changed

Source (`libs/backend/agent-sdk/src/lib/helpers/`):

- `session-lifecycle/session-registry.service.ts` — `SessionRecord.activityHold: ActivityHold | null` (initialised to `null` in `register()`). `markTurnStarted` releases on the false→true transition only. `markTurnEnded` holds on the true→false transition only. Doc comments state the invariant: the hold count owned by the turn state is 1 while no turn is in flight, 0 while one is.
- `session-lifecycle/session-query-executor.service.ts` — after the watchdog is built: `rec.activityHold = activityWatchdog`, and `activityWatchdog.hold()` once when `!isSlashCommand` (the initial idle hold). Comment cites the 2026-08-31 log (session 314c9c90, result 00:37:02Z → kill 00:40:02Z).
- `subagent-hook-handler.ts` — `createHooks(workspacePath, parentSessionId?, activityHold?)`. Closure-local `heldAgentIds: Set<string>`. `SubagentStart` holds once per non-empty `agent_id`, independent of the registry outcome. `SubagentStop` releases only when the id is in the set. Debug logs on both. Registry behaviour unchanged.
- `sdk-query-options-builder.ts` — private `createHooks(..., activityHold?)` forwards it as the third argument to `subagentHookHandler.createHooks`; the call site in `build()` passes the destructured `activityHold`.

Specs:

- `session-lifecycle/session-registry.service.spec.ts` — 6 new cases: null init, release once per false→true, hold once per true→false (double `markTurnEnded` holds once), no hold before any turn, two turns balanced, `activityHold === null` safe.
- `session-lifecycle/session-query-executor.service.spec.ts` — 3 new cases: non-slash prompt → record owns the watchdog and `isHeld === true`, then a turn cycle toggles it; empty prompt takes the idle hold; slash command takes no hold. The two existing TASK_2026_190 watchdog cases now call `startFirstTurn()` (mirrors the pump's `markTurnStarted`) before `start()`, because the record now begins held.
- `subagent-hook-handler.spec.ts` — 8 new cases: Start holds; Stop releases; Stop without Start does not release; double Stop releases once; duplicate Start holds once; hold taken even when registration is dropped; empty `agent_id` takes no hold; no `activityHold` → no throw, `continue: true`.
- `sdk-query-options-builder.spec.ts` — 2 new cases: `activityHold` forwarded as the third argument; `undefined` forwarded when absent.

Documentation:

- `libs/backend/agent-sdk/CLAUDE.md` — one Guidelines bullet (before the Compaction bullet) describing both hold owners, the measured cases, the transition guard, and the unknown-`agent_id` rule. References TASK_2026_363 and TASK_2026_190.

## Deviation from the file list

`SessionRecord.activityHold` is a required field. Two specs outside the batch
list build a `SessionRecord` literal by hand and stopped compiling:

- `libs/backend/agent-sdk/src/lib/helpers/session-fork.service.spec.ts` (line 497)
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts` (line 1097)

Each received one line: `activityHold: null,`. No other change. Neither file
is owned by the other agent (`stream-transformer.ts`,
`subagent-message-dispatcher.ts` were not touched).

## Verification

| Command                                                          | Result                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx test @ptah-extension/agent-sdk --skip-nx-cache`          | PASS — Test Suites: 82 passed, 1 skipped (82 of 83). Tests: 1343 passed, 1 skipped, 1344 total.                                                                                                                                          |
| `npx nx run @ptah-extension/agent-sdk:typecheck --skip-nx-cache` | PASS                                                                                                                                                                                                                                     |
| `npx nx run @ptah-extension/agent-sdk:lint --skip-nx-cache`      | PASS — 0 errors, 38 warnings, all pre-existing. One is in a touched file: `sdk-query-options-builder.ts` `max-lines` (847 counted lines, ceiling 700, warn-level); the file was over the ceiling before this batch, which added 7 lines. |

## Not done

- Nothing from the batch scope was left out.
- No commit was made (per instructions).
