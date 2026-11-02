# Phase B review fix round 2 - TASK_2026_857_f660

Scope: the three findings in `code-logic-review-phase-b-round2.md`. No git write was run. Root
`$WT` = `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing`.

## Claims checked before the fix

- **F1 confirmed.** `file-settings-manager.ts:144` writes the in-memory value synchronously, and
  `:151` awaits persistence. The Electron provider fires its event only after that await
  (`electron-workspace-provider.ts:218-225`; non-file keys `:231-239`). Writes that use the
  settings store (`platform-electron/src/settings/file-settings-store.ts:44-46`) never fire a
  provider event.
- **F2 confirmed.** Before the fix, the hook called `take` (`user-prompt-submit-hook-handler.ts:97-107`),
  held the text across `await this.pointer(...)` (`:108-111`) and returned it without any live
  check.
- **F3 confirmed.** `disableReset` -> `discardQueued` called the unscoped `queue.discard(key)`,
  which deleted any entry at that key.

## F1 (Serious) - fixed: the configuration is tracked by its live value, not by event timing

- New file `libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing-config-tracker.ts`
  holds the `HostRoutingConfigTracker` class.
  - `observe()` reads a live stamp. A change counts from the first read that sees it.
  - `onEvent()` decides whether a change event still needs a reset:
    - the stamp differs from the last observed one: reset;
    - an earlier read already saw an unannounced change: the event only announces it, so there is
      no reset and work admitted under the current values is kept;
    - otherwise reset: an off and an on both landed before any read.
- `host-routing.coordinator.ts`
  - `configStamp()` returns `off`, or `on:<decision model selection JSON>` (`:534-538`).
  - `syncConfig()` (`:529-531`) runs:
    - at admission (`:200`);
    - in `applyAssessment` before the epoch check (`:280`);
    - in `settlePreflight` before the epoch check (`:410`).
  - When the stamp changed, `resetAll()` runs before anything else. It clears the cache, runs
    `disableReset` on every tab (which bumps the epoch) and calls `discardOwned`. The existing
    epoch guard then discards the old result before any state, cache or queue mutation.
  - `onSettingChanged()` now asks `config.onEvent()` (`:520-526`). A late event for a change that
    a read already saw no longer cancels a request admitted under the current values.
  - The header comment is updated.

## F2 (Serious) - fixed: the hook re-checks the live setting just before it returns

- `next-turn-reminder.queue.ts`
  - `gateOwner(owner, allows)` (`:80-85`) returns a release function.
  - `allows(owner)` (`:88-91`): untagged entries always pass.
  - `takeEntry(sessionId)` (`:52-58`) returns `{ text, owner }` and drops an entry whose gate
    reads false. `take` now delegates to it (`:60-62`).
  - `dispose` clears the gates.
- The coordinator gates `'host-routing'` on `setting.isEnabled()` (`host-routing.coordinator.ts:177-179`),
  and `dispose()` releases the gate.
- `user-prompt-submit-hook-handler.ts`
  - The hook drains with `takeEntry` (`:101-104`).
  - After the awaited pointer, `stillAllowed(drained)` (`:117`, `:179-195`) re-reads the owner's
    gate immediately before `additionalContext` is built. A routing reminder is withheld when
    routing is off.
  - The pointer and other producers' reminders are kept.
  - A throwing gate withholds only that reminder. It logs the error class only and carries
    `degradation-audit: reported`.
- Both review paths are closed:
  - off during the awaited pointer: the final check;
  - off visible before the delayed event: `takeEntry` drops the entry.
- No new Nx edge: agent-sdk sees only an opaque owner string and a callback.

## F3 (Moderate) - fixed: the keyed discard is owner-filtered

- `NextTurnReminderQueue.discard(sessionKey, owner)` (`next-turn-reminder.queue.ts:68-73`) removes
  an entry under the tab key or the resolved key only when its owner matches. The coordinator was
  the only caller of the unscoped form, so that form was replaced, not kept beside the new one.
- `discardQueued` passes `REMINDER_OWNER` (`host-routing.coordinator.ts:545-551`). This covers both
  the reset and the revision change (Rule 4).

## Tests added or changed

| Test                                                                                                                          | File                                                          |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| The value reads off before its event: an old pre-flight settling in that window changes nothing, and routing resumes after on | `host-routing.coordinator.spec.ts`, `deferred setting events` |
| A late "on" event keeps a new same-revision request admitted after the value read on; the old BUGFIX result is discarded      | same                                                          |
| Both events late, with an off read in between: the old result is discarded and the new request survives both events           | same                                                          |
| A decision model change before its event discards an old pre-flight                                                           | same                                                          |
| A reset keeps another producer's entry at the routing tab's session key (F3)                                                  | same, `owner-scoped keyed discard`                            |
| A revision change keeps another producer's entry at the same key (F3)                                                         | same                                                          |
| Routing turned off while the handoff pointer is pending: the reminder is withheld and the pointer is kept                     | `user-prompt-submit-hook-handler.spec.ts`, `owner gate`       |
| A still-queued routing reminder is dropped once the setting reads off, before any event                                       | same                                                          |
| Another producer's reminder is kept while routing is off                                                                      | same                                                          |
| A throwing final check withholds the reminder and logs only `RangeError`                                                      | same                                                          |
| A keyed discard keeps another producer's entry at the same resolved key; an untagged entry also stays                         | `next-turn-reminder.queue.spec.ts`                            |
| Gate withholds an owner's entries (drained, not kept) until released                                                          | same                                                          |
| The existing keyed-discard test now passes the owner; the hook fakes use `takeEntry`/`allows`                                 | both specs                                                    |

The existing round-1 tests still pass unchanged, including "a write that keeps the switch on
still cancels work started before it" (the coalesced case, handled by `onEvent`'s third branch).

## Verification (run once each, foreground)

| Command                                                                                   | Result                                                            |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk`             | `6 tasks: 6 succeeded` (2 projects x lint/test/typecheck), exit 0 |
| `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` | 4 tasks (`Cache: 0/4`), lock released with exit code 0            |
| `npm run verify -- -t lint -p degradation-audit`                                          | `1 task: 1 succeeded`, exit 0                                     |
| `npx prettier --check` on the 7 changed files                                             | All matched files use Prettier code style, exit 0                 |

The dynamic Nx output prints no "Running target" header line. The counts come from the summary
lines and match the requested project x target counts. `ptah_get_diagnostics` was not used; the
typecheck targets cover it. lane-routing was not changed, so it was not re-verified.

## Decisions

- **Value-based tracker instead of a platform write generation.**
  - Options:
    - fire the Electron provider event at the in-memory mutation;
    - expose `PtahFileSettingsManager` write generations through a new port;
    - live-value stamp in rpc-handlers.
  - Evidence: the task prefers a fix in rpc-handlers. Some writes never fire a provider event at
    all (`file-settings-store.ts:44-46`), so even an atomic event would not be complete.
  - Reversible: yes.
- **A decision model change while routing stays on now resets.** This reverses round 1's "model
  write resets only when routing ends off".
  - Evidence: the task asks for a generation derived from both keys. An old-model result is stale.
  - Reversible: yes. Drop the selection from `configStamp()`.
- **A withheld routing entry is drained, not kept.** It must never reach a later prompt after an
  off, and re-enabling starts a fresh revision.

## Residual limits (documented, not fixed)

- **An off and an on that both land before any read, with an old result settling between them.**
  The stamp reads the same, so the result is applied. The first trailing event then resets, which
  clears the cache, drops the reminder and bumps the epoch. A hook drain inside that window could
  still see the reminder.
  - Closing this needs a write-time signal from the platform (see the first decision).
  - The settings UI serializes writes behind `saving()` (`host-routing-setting.component.ts:188-205`),
    so this needs overlapping non-UI writes or an RPC timeout during a pending persist.
- **A change that fires no event leaves an unannounced count behind.** Examples are a write through
  the settings store or a failed persist that restores the old value. A later coalesced off/on
  pair is then consumed without a reset.
- `HostRoutingSettingChange.switchChanged` (lane-routing) is no longer read by the coordinator. The
  lane-routing API was left unchanged to keep this round out of that lib.

## Files changed (absolute)

- CREATED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\rpc-handlers\src\lib\chat\host-routing\host-routing-config-tracker.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\rpc-handlers\src\lib\chat\host-routing\host-routing.coordinator.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\rpc-handlers\src\lib\chat\host-routing\host-routing.coordinator.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\helpers\next-turn-reminder.queue.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\helpers\next-turn-reminder.queue.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\helpers\user-prompt-submit-hook-handler.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\agent-sdk\src\lib\helpers\user-prompt-submit-hook-handler.spec.ts`
- CREATED this report.
