# Batch 19 report — Settings card sibling draft and write timeout; keep-key pruning (F.3, G.8)

Executor: frontend-developer (Opus). Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g`. No git run.

## Tasks

| Task | State |
| --- | --- |
| 19.1 Only a blurred sibling draft is committed (F.3, A4) | DONE |
| 19.2 `settings:set` has a timeout (F.3) | DONE |
| 19.3 Prune kept keys for closed sessions (G.8, review B FM7) | DONE |

## Files changed

- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.ts`
  - 19.1: number inputs bind `(focus)` / `(blur)` to a plain `focusedKey` field (not rendered, so no signal). After a
    percent is saved, the new `commitPartner` commits the other percent's draft only when that field is not focused;
    a focused partner draft is only re-validated (its error updates against the new partner value) and waits for its
    own blur / Enter. The cross-field re-validation stays (A4).
  - 19.2: `write` passes `SETTINGS_WRITE_TIMEOUT_MS` (5 s, same as reads) to `rpcCall`. A timeout resolves
    `{success:false, error:'RPC timeout: …'}` (`rpc-call.util.ts:132`), so `busy` is cleared and the field gets an
    error. Because a timed-out write may still land on the host, its message is "Could not confirm saving <label>.
    Reopen settings to see the saved value." instead of the "saved setting is unchanged" text used for a refused write
    (detected by the `RPC timeout` prefix `rpcCall` sets).
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.spec.ts` — three specs:
  focused partner not saved and only re-validated, then saved on its own commit; every write carries the 5 s timeout;
  a timed-out write frees the card (no `aria-disabled`), shows the unconfirmed message, and the next edit is written.
- MODIFIED `libs/frontend/chat/src/lib/services/session-rotation-keep.service.ts` — 19.3: the root store subscribes to
  `TabManagerService.onTabClosed` (synchronous per-event delivery; teardown on `DestroyRef`). On a `close`,
  `forceClose` or `reset` event with a session id, the session's keys are forgotten unless an open tab still holds it
  (`claudeSessionId` or `sessionBudget.sessionId`). Event-driven rather than an effect over `tabs()`, because `tabs()`
  holds only the active workspace's tabs and a workspace switch must not drop keys of tabs that are still open.
- MODIFIED `libs/frontend/chat/src/lib/services/session-rotation-keep.service.spec.ts` — stubbed `TabManagerService`;
  specs: last tab closed → keys dropped (others kept); reset in place → dropped; another tab still holds the session
  (by `claudeSessionId` or by `sessionBudget.sessionId`) → kept; null-session close → same set instance; listener
  removed on injector destroy.
- MODIFIED (outside the batch file list) `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.spec.ts`
  — added a `TabManagerService` stub provider. Required by 19.3: the banner injects the keep store, which now injects
  `TabManagerService`, whose `MODEL_REFRESH_CONTROL` dependency has no provider in that spec (27 tests failed with
  NG0201 before the stub). Test-only, no assertion changed. No parallel batch owns this file.

## Checks (scoped, exit codes)

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p @ptah-extension/chat --parallel=2` (cache 0/3, all three ran) | 0 |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 |

No baseline PNGs were rewritten. No TASK_2026_609_c495 files touched.

## Open notes

- The timeout message keys off the `RPC timeout` prefix of `rpcCall`'s error string (pinned by
  `rpc-call.util.spec.ts:183`). A typed timeout flag on `RpcCallResult` would be cleaner; that is a core-lib change,
  not made here.
- The "Reopen settings to see the saved value" copy is new user-facing text (not covered by Decision F-B); adjust in
  Batch 33 if the wording should change.
- Keys of a session open only in another workspace's tab are pruned only if a close event for that session fires in
  this webview; this matches "no open tab holds it" within the panel's own store.
