# Code Logic Review, Phase 2 — TASK_2026_627 (Batch 0 `f0882e60d`, Batch 6 `0917b8074`)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 2 |
| Moderate issues | 3 |
| Minor issues | 2 |

Scope: `git show` of both commits and the whole of the Batch 6 files (actions service, banner, message sender). Read the coordinator (`libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts`), the RPC handler, the budget service `previewHandoff`, and the shared contract. I did not run the specs. The two serious issues come from reading the code. The specs mock the RPC layer and so cannot catch them.

No TODO, STUB or PLACEHOLDER markers in the touched sources (grep clean). No empty bodies.

## Risk checklist

1. Stale `waitingFor` (627-L2): PASS. `waitingFor` is read only when `phase === 'waiting-for-turn-end'` (banner `:489-499`), and the counts are validated with `isCount`. Cancelled and failed states cannot render it. A zero total falls back to the plain copy.
2. Reachability of `awaiting-confirmation` at the handoff stage: PASS for the RPC path, with the gap in Serious 2.
   - "Continue now" calls `session:beginHandover` with reason `successor` (`rpc-handlers ... :92`).
   - `begin()` refuses only on a missing host or a missing source snapshot (coordinator `:241-247`). Otherwise `request()` finds the live `budget-auto` operation (`isRestartable` is false for `awaiting-confirmation`, `:266-271`) and `confirmBudgetOperation` moves it to `writing-handoff` (`:478-482`). This works whatever `turnInFlight` is.
   - "Cancel (keep working)" calls `session:cancelHandover` with the operation id. `awaiting-confirmation` is in `CANCELLABLE_PHASES` (`:163`). `cancel()` records `cancelledAutomaticSources` so the automatic handover does not re-arm.
3. Dismissed-banner override: correct (`banner :457-468`). The override applies only to `handoff`. A `limit` stage is never dismissible, which is unchanged.
4. `console.info` vs `console.error` (`message-sender :745-758`): correct. Info is used only when `!authFailed && (budgetReached || handoverHeld)`. Auth failures, plain failures and the `catch` branch stay `console.error`. The return value and the rollback are unchanged.

## Five logic questions

### 1. How does this fail silently?

- Rotate fallback with a released budget entry. See Serious 1 (`session-budget-actions.service.ts:287-294`, `:356-376`).
- Retry on a failed handover with no budget on the tab. `runAction` returns null with no error when `!budget` (`:358`), so the Retry click does nothing visible.

### 2. What user action produces unexpected behaviour?

- Pressing Retry twice on a "source session unavailable" failure opens two new tabs. See Moderate 1.
- Extending or compacting while an `awaiting-confirmation` handover is open. See Serious 2.

### 3. What input data produces a wrong answer?

- A `waitingFor` with non-integer counts is handled (`isCount`).
- A mismatched error string in the failed state falls through to a normal `beginHandover`. This is acceptable, but the match is a string equality on a free-form backend error (`SOURCE_UNAVAILABLE_FAILURE`, `:48`). Any wording change in `fail(operation, 'source session unavailable')` (coordinator `:548`) silently disables the Retry fallback. See Minor 1.

### 4. What happens when a dependency fails?

- `begin` throws: `showError`, no rotate (correct, the source may be alive).
- `begin` refuses with `unavailable`: error shown, no rotate (correct).
- `preview-handoff` fails inside the rotate: `runAction` shows "Budget action failed ..." and no tab opens. The user is told, but there is no way forward (see Serious 1).

### 5. What is missing that the requirements never mentioned?

- Clearing or cancelling the failed handover after a successful rotate.
- Any banner for an `awaiting-confirmation` handover when the budget is no longer at the handoff or limit stage.
- A cancel affordance at the `limit` stage while awaiting confirmation. The Cancel button exists only in the `handoff` branch (`banner :311-319`).

## Serious issues

### S1. The rotate fallback probably cannot produce a seed in the case it exists for

- File: `session-budget-actions.service.ts:196-253`, `:287-294`, `:356-376`. Backend: `sdk-agent-adapter.ts:970-975`, `session-budget.service.ts:785`.
- Scenario: `source-unavailable` means `sourceSnapshot` found no live session record. Two causes exist: the session ended (the record is gone) or it has no `projectPath` (`session-lifecycle-manager.ts:465-469`). When a session ends, `releaseBudget` runs and the budget entry is dropped. `rotateSession` then calls `session:budgetAction preview-handoff`, and `previewHandoff` returns `noState()` (`:785`) with `NO_SESSION_BUDGET_STATE`. `runAction` swallows that quietly and clears the tab budget (`:370-376`).
- Impact: for the ended-session case, "Continue now" or Retry produces no new tab, no seed and no message. The budget card disappears. For a failed handover, the failed banner stays and Retry becomes a silent no-op (`!budget` at `:358`). The user is back to "stuck", which is what 6.1 sets out to prevent. Where the entry survives, for example when the record lacks `projectPath`, it works. The spec (`session-budget-actions.service.spec.ts`) mocks `claudeRpc` and never exercises the real ordering.
- Fix:
  - Check against the real budget service whether an entry survives in the `source-unavailable` cases, and add an integration-style test of that path.
  - If it does not survive, use a seed source that does not need the live entry (a history-based handoff), or show an explicit message such as "This session has ended; start a new chat" instead of dismissing silently.
  - At minimum, surface a message when `rotateSession` is entered from the fallback and no seed is returned.

### S2. A held `awaiting-confirmation` handover is invisible once the budget leaves the handoff or limit stage

- File: `session-budget-banner.component.ts:446-469`. Backend: `HELD_SOURCE_PHASES` includes `awaiting-confirmation` (coordinator `:128-135`).
- Scenario: the automatic handover reaches `awaiting-confirmation` after the 15-minute wait. The user then runs `/compact` or extends the budget, or usage otherwise drops. `budget.stage` becomes normal or warn. `stage()` returns null at `:455-457`, because the `awaiting-confirmation` check only guards the dismissal branch. The banner disappears while the coordinator still holds the source: sends return `SESSION_HANDOVER_HELD`, and nothing offers Continue now or Cancel.
- Impact: the same "waits unseen" trap the dismissed-banner override was added to close, reached by another route. Every later message is held with only a `console.info` and no UI.
- Fix:
  - Return `'handoff'` for `awaiting-confirmation` before the budget-stage check. This needs a `budget` for the amount copy, or a copy path that does not use it.
  - Alternatively, have the backend cancel `awaiting-confirmation` when the budget returns to normal.

## Moderate issues

- M1. Double rotation. After the Retry fallback or the begin-refused fallback, the handover stays `failed` with `error: 'source session unavailable'`. `rotateSession` does not call `cancelHandover` or clear it (`:287-294`). The banner still shows Retry (`banner :274-281`), and each click opens another tab with the same seed. In the begin-refused path there is no failed state, but the budget card stays, so each "Continue now" repeats the rotate. Fix: after a successful rotate, cancel the failed operation via `session:cancelHandover` (failed is cancellable), or dismiss the card.
- M2. The Retry fallback skips the busy guard around the pre-check and any queued composer text. `queuedContent` is left in the old tab (correct, nothing is lost), but the user is not told. The seed lands in a new tab's composer while the queued input stays behind.
- M3. `awaitingConfirmation()` is true only at the `handoff` stage, so at `limit` stage with an `awaiting-confirmation` handover only "New session" shows and there is no Cancel (`banner :321-345`). The backend never gates the blocking limit, so this is unlikely. Verify before accepting.

## Minor issues

- m1. `SOURCE_UNAVAILABLE_FAILURE` duplicates a backend string literal (`actions.service.ts:48`, coordinator `:548`). Add it to the shared contract, or a reason code, so a change cannot silently break the fallback.
- m2. The pre-check in `continueInNewSession` reads the handover state before the busy check's effects. This is harmless, but the early `return` after `await this.rotateSession()` bypasses the `queuedInput` logic by design. Add a short comment.

## Batch 0 (`f0882e60d`)

Logic is sound. `visibleCompactionMarker` hides the chip while compacting and after any user message with `timestamp > marker.completedAt` (`chat-view.component.ts:994-1002`).

- Residual risk 1: `completedAt` is the host's `payload.timestamp` (`compaction-lifecycle.service.ts:634`). User messages carry webview `Date.now()`. A skew between host and webview (remote host, or a clock change) can show or hide the chip wrongly. In the Electron and same-machine case this is negligible.
- Residual risk 2: restored markers use `Date.now()` at restore (`:511`, `:757`), so older user messages never count as "after". That is the intended behaviour.
- The removed pre/post token plumbing has no remaining references in the diff. Not re-verified across the repo.

## Data flow (Continue now at awaiting-confirmation)

Banner button -> `continueInNewSession.emit` -> chat-view -> `SessionBudgetActionsService.continueInNewSession` -> `session:beginHandover` -> `coordinator.begin` -> `request` -> `confirmBudgetOperation` -> `writing-handoff` -> `complete()` -> state broadcast -> `handoverClient.record`. OK, except the hidden-banner gap (S2) and the `accepted:false, source-unavailable` fallback (S1).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 6.1 rotate on source-unavailable / failed Retry | PARTIAL | S1 (no seed once the entry is released), M1 (double rotate) |
| 6.2 waiting counts only when waiting, valid counts | COMPLETE | None |
| 6.2 awaiting-confirmation offers Continue now and Cancel, even when dismissed | PARTIAL | S2, M3 |
| 6.3 info vs error classification | COMPLETE | None |
| Batch 0 card only while compacting, chip hides after next user message | COMPLETE | Clock-skew risk only |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| waitingFor on cancelled/failed | YES | Read only in `waiting-for-turn-end` | None |
| waitingFor `{0,0}` or NaN | YES | `isCount` plus zero total gives plain copy | None |
| Dismissed plus awaiting-confirmation | YES | Override in `stage()` | S2 when the budget stage drops |
| Double click on Continue now | YES | `_busy` guard; rotate runs after `finally` | None |
| Retry twice on source-unavailable | NO | Each click rotates | M1 |
| Source gone, budget entry released | NO | `NO_SESSION_BUDGET_STATE` swallowed | S1 |
| Auth failure with a budget refusal | YES | Stays `console.error` | None |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (S1 depends on whether the budget entry survives each `source-unavailable` cause; the code reading points to it being released)
- Top risk: the "never stuck" rotate fallback may silently do nothing when the source session has truly ended.
- What a robust implementation would add:
  - A seed path that does not need the live budget entry, or an explicit user message.
  - Cancel or clear the failed operation after a successful rotate.
  - A banner for any held `awaiting-confirmation` handover regardless of budget stage.
  - A shared constant or code for the `source session unavailable` failure.
  - An integration test that runs the real ordering of `begin` refusal, then `preview-handoff`.
