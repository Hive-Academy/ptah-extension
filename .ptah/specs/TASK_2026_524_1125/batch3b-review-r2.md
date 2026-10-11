# Batch 3b cross-side review, round 2

**Verdict: REVISE**

## Round 1 disposition

1. **Resolved.** `NotificationLedgerService` is root-scoped and eagerly injected by `AppShellComponent`; its completion/prompt effects and burst timer now run outside the retained row. `NotificationAnnouncerComponent` is outside `#shellRow`, and `NotificationCenterStore` only projects ledger state and handles focus. The shell spec covers a burst before first chat and while Settings is open.
2. **Resolved.** `app-shell.retained-chrome.spec.ts` checks actual template containment with `shellRowSpan`/`inRow`, plus rendered canvas/provider identity and the outside-row notification behavior. The reduced rendered template is still a fixture, but the real-template boundary checks cover the cited regression.
3. **Resolved.** `StubCanvasComponent` now declares `ChangeDetectionStrategy.OnPush`.

## New items

A. **Resolved.** `AppShellComponent` eagerly injects `ThemeService` at `app-shell.component.ts:205`, so standalone-first boot does not depend on the row's theme toggle.
B. **Revise.** The root `AgentFollowUpQueueService` handles coalescing, unqueue, busy re-queue, fallback codes, failure retention, and pruning of queued/error/undelivered/lastSeen entries. Its root effect tracks agent-card changes without tracking its own queue writes. One resume race remains:

1. **`libs/frontend/chat/src/lib/services/agent-follow-up-queue.service.ts:148-160,178,201-215` — stale card loses the resume fallback.** `send` captures a `MonitoredAgent` before awaiting `continueAgent`, then passes that same object to `sendByResuming`. The old component read `this.agent()` after the await. Concrete scenario: the completed card initially has no `cliSessionId`; the queued follow-up flushes and its continuation RPC is pending; a later store update adds `cliSessionId` to that same card (the store merges late IDs in `agent-monitor.store.ts:1147,1387`); the RPC answers `not_found` or `released`. The current code sees the old empty ID, reports “Agent expired and has no session to resume,” and leaves a resendable draft even though the current card can resume. Resolve the latest card by `agentId` before fallback, using the snapshot only if the card is gone, and cover the interleaving in a focused spec. The same race affects a direct send if its card input changes while the RPC is pending.

Review was static. Per instruction, I ran no tests, lint, typecheck, Nx, or build; the developer reported 10 chat Jest suites / 136 tests passing, chat typecheck passing, and chat lint with 0 errors.
