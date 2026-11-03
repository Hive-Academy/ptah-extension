# Review 8q-fix-wire-level

Verdict: APPROVE
Score: 8/10
Review family: grok (implementer: codex)

Reviewed the uncommitted `libs/backend/codex-runtime` diff against finding 1 in `code-logic-review-8q.md` and `batch-8q-fix-wire-level-report.md`. No tests or builds were run.

Finding 1 is closed. An idle `turn/started` now snapshots the level whose policy was last sent. `updateNextTurn` still does not send a policy and does not move that level. The idle `turnPermissionLevel` getter still returns the staged next-turn level. No new production defect.

## Finding 1

CLOSED — `libs/backend/codex-runtime/src/lib/codex-context.ts:404` (was the settings read at the old `:401-405`). The idle branch assigns `activeTurnPermissionLevel` from `wirePermissionLevel`.

Sends and writes:

- `thread/start` and `thread/resume` send `profile.approvalPolicy` and `profile.sandboxPolicy.mode` (`codex-context.ts:231-250`). `wirePermissionLevel` is set from `profile.permissionLevel` at construction (`:124`) and is not written again in `open()`. `start()` and `updateNextTurn` cannot run while `state` is `opening`.
- `turn/start` sends `levelPolicy` for `settings.permissionLevel` and assigns that same level at `:530`, after the params are built and before `request`.
- `thread/compact/start` sends only the thread id (`:902-904`) and does not write the wire level. Compaction leaves `state` idle until `turn/started`, so the idle branch snapshots the last sent level. That is the original compact repro.
- `turn/steer` and `turn/interrupt` send no policy and do not write the wire level. Interrupt keeps the active snapshot. A rejected interrupt restores `running` and a new `AbortController` (`:767-774`) and leaves both the snapshot and the wire level alone.

Rejection and other start failures:

- `CodexRequestRejectedError` with no `activeTurn` restores the previous wire level, returns to `idle`, and clears the snapshot (`:550-555`). `settings` and `levelPolicy` stay on the staged level, so the idle getter still shows the next turn. `activeTurn` is set only by `turn/started` (`:405`) or by a successful `turn/start` result (`:536`), so this branch is "rejected before a turn started".
- The same rejection after `turn/started` does not restore. `start()` has already set `state` to `running` (`:526`), so the notification does not overwrite the snapshot taken from the level in that request (`:525`). Keeping the sent level matches a turn the server has already announced. `start()` still rejects the caller while leaving the turn `running`; that control flow was already there.
- Any other start error calls `onFailure()` (`:558`), which closes. The wire level is left at the sent value. `onNotification` returns immediately once `state` is `closed` (`:362`), so the stale value is not used for a later idle snapshot.

`close()` still clears `activeTurnPermissionLevel` and does not read the wire level. The getter was not changed (`:209-216`): `running` and `interrupting` use the active snapshot; every other state, including idle, uses `settings`. The new specs assert the idle value before the notification and again after `turn/completed`.

Specs:

- `:1633` fails if the idle path reads `settings` again. Open `plan`, stage `ask`, idle `turn/started` must stay `plan` and decline `Get-Content`. With the accept sink, `codexPermissionPolicy` declines only `plan` for a command (`codex-permission-policy.ts:20`); `ask`, `auto-edit`, and `yolo` would accept. After completion the idle getter is `ask`, and the next `turn/start` sends `untrusted` plus `workspaceWrite`.
- `:1701` is the corrected hold spec. The old body staged `plan` before the notification and expected `plan`, which was the bug. The opening profile is `ask`, no `turn/start` has been sent, and the in-turn stage to `plan` must not move the snapshot. `echo hello` is accepted on that turn. After completion the idle getter is `plan`, and the next user turn declines. Those expectations match the bridge.
- `:1671` and `:1685` lock the other direction against the opening `ask` profile: staging `plan` does not move the wire level, and a rejected `turn/start` does not either.

## New findings

1. **minor** — `libs/backend/codex-runtime/src/lib/codex-context.ts:530` and `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:1671`. Removing the successful `turn/start` assignment does not fail the new specs. `:1671` completes a turn that sends the opening `ask` level, then expects `ask`. `:1685` expects the opening `ask` level after a rejected `turn/start`; if `:530` never runs, the restore at `:552` is a no-op and the expectation still passes. `:1633` and `:1701` also stay on the opening level until the user turn under test. The original repro (stage a level, compact before any user `turn/start`) is locked. The later cycle is not: open `plan`, complete a user turn that sent `ask`, stage `plan`, then an idle `turn/started` would snapshot `plan` again and the three new specs would still pass.
