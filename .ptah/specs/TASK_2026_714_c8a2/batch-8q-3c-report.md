# Batch 8q-3c report

Specs pin a live permission-level change on an open Codex thread. No verification ran (no tests, typecheck, lint, nx, or git).

## Specs added

`native-session-controls.spec.ts`

- `applies a different permission level on an open thread and saves the autopilot chip` at line 83. `setPermission(id, 'plan')` resolves `{ timing: 'nextTurn', revision: 1 }` (lines 85-88). The adapter apply is once, `[id, 'plan']` (lines 89-91). Settings writes are `app.electron.autopilot.enabled` true and `app.electron.autopilot.permissionLevel` `'plan'` (lines 92-97).
- `rolls a failed permission save back to the previous open-thread level` at line 99. After a successful `plan`, a failing `auto-edit` save rejects with `disk` (lines 103-105). Adapter calls are `plan`, then `auto-edit`, then `plan` again (lines 106-110). The saved chip stays `plan` (lines 111-112).

`codex-chat-native-contract.spec.ts`

- `ScriptedAppServer.context` stores `updateNextTurn`'s `permissionLevel` on `turnPermissionLevel` (lines 254-272).
- `sets a different permission level on an open thread for the next turn` at line 1283. After `start()`, `setPermission(THREAD, 'plan')` resolves `{ timing: 'nextTurn', revision: 1 }` (lines 1320-1323). The opened context's next-turn level is `plan` (line 1324). The same autopilot keys are saved (lines 1325-1326).

## Findings

None. `createNativeSessionControls` already applies the new level, saves `autopilot.enabled` and `autopilot.permissionLevel`, and on a save failure applies the previous level again before rethrowing the save error (`native-session-controls.ts:138-150`, `164-207`, `229-236`). `CodexChatAdapter.setSessionPermissionLevel` already calls `context.updateNextTurn({ permissionLevel })` and then stores the level on the session (`codex-chat-adapter.ts:722-735`).

## Decisions

- The chip is the saved `app.electron.autopilot.permissionLevel`. `setPermission` still returns `AppliedSettings` (`timing: 'nextTurn'` plus `revision`). That object has no permission field. For a level other than `ask`, `autopilot.enabled` is true.
- The rollback spec follows the effort spec: one successful live value (`plan`), then a save that rejects. The second apply is that previous level, and the rejection message is the save error `disk`.
- The contract fixture writes the patched level onto `turnPermissionLevel` immediately. It does not model the real in-turn hold, where `CodexContext.turnPermissionLevel` stays on the active turn until that turn ends. The new contract test changes the level only after the start turn has finished, so the idle reading is the next-turn level.
- The contract spec covers the success path through the real adapter. The save-failure rollback stays in `native-session-controls.spec.ts`.

## Not done

No verification ran. Tests, typecheck, lint, nx, and git were not run.
