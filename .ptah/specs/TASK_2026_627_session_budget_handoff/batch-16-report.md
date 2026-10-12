# Batch 16 report — Banner copy and buttons; composer draft write (F2-part)

Executor: frontend-developer. Worktree `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff`
(branch `fix/session-budget-handoff`). No git operations were run.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\molecules\notifications\session-budget-banner.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\molecules\notifications\session-budget-banner.component.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\session-budget-handoff\libs\frontend\chat\src\lib\components\molecules\notifications\session-budget-format.ts`
  (not in the batch file list; see Deviations)

## Task 16.1 — `ChatInputComponent.restoreDraftToInput`

- `restoreDraftToInput(text)`: an empty or whitespace-only composer gets `text`; a non-empty one
  gets `current + '\n\n' + text`. It does not drop or overwrite anything. It writes only
  `_currentMessage`, then focuses the textarea when it is mounted. It never calls
  `sendOrQueueMessage`, never touches `queuedContent` or `queueRestoreContent`. An empty or
  whitespace-only draft does nothing (so it cannot add a stray blank line).
- R3 (focus only on the user's Cancel/failure) depends on the caller. The Batch 17 effect calls this
  only for a peeked `cancelled`/`failed` draft.
- A throw from this method reaches the caller, so the Batch 17 effect can skip `acknowledgeDraft`
  (S20). It has no internal try/catch.
- Spec `restoreDraftToInput (handover draft, S20)`, 6 cases: empty → set and focus; whitespace-only
  → set; non-empty → appended after a blank line and focus; no send, `queuedContent` untouched,
  restore signal untouched; empty draft ignored; no mounted textarea → still written.

## Task 16.2 — `SessionBudgetBannerComponent`

- New inputs: `turnRunning`, `liveStage`, `wrapUpRequested`, `queuedMessageCarried`. New outputs:
  `requestWrapUp`, `continueNowAnyway`, `approveAgentRequest`.
- Display stage: the higher of `budget.stage` and `liveStage`, with no budget meaning no stage. When the
  live stage raised it, an `estimate` badge (`data-testid="session-budget-estimate"`) appears beside the
  title. The body states that the figures are from the last completed turn. At a live limit the pause
  sentence is replaced, because the authoritative `blocked` lags the estimate. "Allow 20% more" shows only when
  the authoritative stage is `limit`. Dismiss shows only at an authoritative, unparked handoff.
  Dismissal rules apply to the display stage, so a live limit escalates a dismissed handoff.
- The banner renders while streaming. Visibility depends only on its inputs, never on the tab status.
  Batch 17 binds `liveStage`/`turnRunning` from `SessionBudgetActionsService`.
- Stages and copy, per the state table:
  - handoff: "This session is near its budget" (replaces "Preparing to continue…"). Body: "This session
    has used X of Y …. Continue in a new session that starts from the handoff, or keep working here."
    "Waiting for handover to start at …" is removed.
  - agent request (`awaiting-confirmation` + `requestedBy: 'agent'`): "The agent asks to continue in a
    new session" with **Approve** (→ `approveAgentRequest`) and **Cancel** (→ `cancelHandover`).
  - waiting (`waiting-for-turn-end`): "Waiting to continue in a new session". Body: "Waiting for [the
    turn to end, ]N subagents, M lanes." plus "Messages you send now go to this session." **Continue now
    anyway** (→ `continueNowAnyway`) and **Cancel** always show. `lanes: null`, or an invalid lane
    count, reads "lane status unknown" and never 0. An invalid subagent count is left out. With nothing
    known: "Waiting for the turn to end."
  - parked non-agent `awaiting-confirmation` (blocking limit, P9): it keeps "New session"/"Continue in
    new session" and "Cancel handover".
  - R5: "Your queued message will be sent in the new session." shows when `queuedMessageCarried`, at
    any stage except failed.
  - "Ask agent to wrap up" shows only with `turnRunning` at display stage handoff/limit. It is disabled
    (and labelled "Wrap-up requested") once `wrapUpRequested`. The service owns the per-stage key and
    blocks repeats on its own side.
- Accessibility: each new button has an `aria-label`. Every button is disabled while `busy`. The
  role is `alert` at the limit and `status` otherwise. There are no timers, intervals or observers
  (no countdown).
- Spec: the stale `budget-auto` fixture became `reason: 'successor'`. Cases that asserted the old copy
  or buttons were rewritten, not deleted. Added cases:
  - wrap-up (S13): emits once, then disabled; offered at the limit; hidden while idle; disabled while busy.
  - live stage (S13): banner at a live handoff while streaming, with the estimate badge; a live limit
    over an authoritative handoff (alert role, no Allow 20% more); a live limit escalating a
    dismissal; a lower live stage that is not an estimate; no budget → nothing.
  - waiting (S13/S22): counts; turn-first wording; `lanes: null` with and without subagents; the
    invalid-count table (including an invalid lane count); both buttons and busy.
  - agent request (S18): copy, Approve/Cancel emits, no `continueInNewSession`; shown without a budget
    and over a dismissal; switches to waiting copy after approval; busy.
  - R5: shown while waiting and while writing the handoff; hidden when the flag is off or the handover failed.

## Verification (each command ran under `.ptah/tmp-check-lock`)

- `npx jest -c libs/frontend/chat/jest.config.ts …/chat-input.component.spec.ts …/session-budget-banner.component.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper=…`:
  2 suites, 150 tests passed.
- `npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`: succeeded.
- `npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`: 0 errors, 34 warnings (baseline
  was 35). The pre-existing unused `Gauge` import in the banner was removed. The one warning left in a
  changed file is the pre-existing `max-lines` on `chat-input.component.ts`.
- Prettier: the banner, its spec and chat-input were already unformatted at HEAD, and they were not
  reformatted here. The commit hook's lint-staged formats them.

## Deviations

- Inputs `wrapUpRequested` and `queuedMessageCarried` are added beyond the plan's
  `turnRunning`/`liveStage`. The component has no services, so "disabled after one click per stage"
  and the R5 copy need those flags as inputs. Batch 17 binds them to
  `SessionBudgetActionsService.wrapUpRequested()` and `queuedMessageCarried()`.
- New file `session-budget-format.ts` holds the pure figure formatters and the waiting line. The
  banner changes pushed `session-budget-banner.component.ts` over the repo `max-lines` warning (700).
  Moving the pure text helpers out cleared the new warning without changing behaviour. The stats row
  template also became a `@for` loop over rows (same test ids, labels and widths).
- The limit title stays "This session reached its budget". The state table's "; new messages paused"
  suffix is not in the batch's quality-requirement list, and the body already gives the pause. Change
  it in Batch 17 or the phase review if wanted.
- The progress stage keeps "Cancel (keep working)" in every progress phase, unchanged. The state table
  says "while writing-handoff". That is not in this batch's requirements.

## Notes for Batch 17

- Bind `[turnRunning]`, `[liveStage]`, `[wrapUpRequested]`, `[queuedMessageCarried]`,
  `(requestWrapUp)`, `(continueNowAnyway)`, `(approveAgentRequest)` (→ `continueInNewSession()` on the
  service, the Approve path). The banner `@if` in `chat-view.component.html` must allow streaming.
