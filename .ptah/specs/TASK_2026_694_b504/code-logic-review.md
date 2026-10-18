# Code Logic Review — `TASK_2026_694_b504`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 4              |
| Moderate issues     | 6              |
| Failure modes found | 9              |

Scope: read `session-coordinator.ts`, `command-center-start.component.ts`, the page template and
`command-center-workspace-binding.ts` in full, plus the persona diff, the controller `open()` /
`requestStatus()` paths, and `createCommandCenterTab`. Ran no tests (orchestrator reports them green).
The green tests do not cover the paths below: pagination, timeout, restore failure, workspace switch
during load, `chooseCurrentTab`, and toast visibility in the start view.

## Five logic questions

### 1. How does this fail silently?

- Every start-state error is invisible. The toast (`command-center-page.component.ts:262`) is rendered
  inside the `@else` scene region (opened at `:201`). `fail()` in the coordinator
  (`session-coordinator.ts:326`) sets a toast, but while the start view shows, nothing renders it.
  "Already open in another tab" (`:169`), "Could not restore" (`:153`, `:193`) and "Open a workspace"
  (`:59`, `:221`) all vanish. The user clicks a card and nothing happens.
- The no-workspace case leaves `listStatus` at its initial `'loading'`, because `refreshSessions`
  returns early at `:84`. The start view then shows "Loading sessions…" indefinitely.
- A workspace switch during `openStart` leaves `listStatus` at `'loading'` forever. See Serious 2.

### 2. What user action produces unexpected behaviour?

- Double-click on a card: the first click creates and attaches a tab (`:174-176`) and awaits restore.
  The start view is still showing, so the second click hits `findTabBySessionId` (`:166`). It reports
  "already open in another tab" (invisible, see above) and switches to the half-restored tab. The old
  `opening` single-flight guard was removed with `openOrResume`.
- Clicking two different cards quickly creates two Command Center tabs. The last restore to finish wins
  `store.setSession`.
- A failed restore leaves an orphan tab. Clicking the same card again then hits the "already open in
  another tab" guard.
- "New session" while a Current tab exists orphans the old tab. It may still be streaming with no UI.
  Probably acceptable, but it is unstated.

### 3. What input data produces a wrong answer?

- A workspace with more than 50 sessions in All mode, on a slow RPC, hits the single 5 s abort. The
  whole list becomes an error and all fetched pages are discarded (`:88`, `:116`).
- `showAll()` is re-read on each loop iteration (`:103`). Toggling "Recent sessions" mid-load truncates
  the list.
- A Current tab whose session is older than the newest 10 sessions gets the fallback name "Command
  Center" (`start.component.ts:66`), because the name lookup only searches the fetched list.
- The "Command Center" badge appears only for the single `readLastSession` record. Other past Command
  Center sessions are not marked, because the records hold only one.

### 4. What happens when a dependency fails?

- `session:list` failure or timeout gives an error card with Retry. This is handled correctly, but
  Retry is not available for the no-workspace case.
- A `chat.switchSession` failure in the current-tab branch (`:151`) leaves the store bound to the broken
  tab (`:145`). The scene shows with an error status and an empty conversation.
- A `chat.switchSession` failure in the new-tab branch leaves the orphan tab (Serious 3).
- `records.setActiveTabId` failures are not surfaced here (pre-existing behaviour).

### 5. What is missing that the requirements never mentioned?

- A way back to the start view without leaving the page. After a card or "New session" there is no
  "Sessions" control in the scene; only a page re-entry or a workspace change returns to start. The user
  said "always show start state", so this may be intended. It is worth confirming.
- Voice-session deactivation in `openStart`: the controller's `voiceSessions.deactivate(tab)` is not
  called, only `stopVoiceLocally`.
- Any tests for the above.

## Failure modes

### Start-state errors are invisible

- Trigger: restore failure, "already open elsewhere", or no workspace while the start view shows.
- Symptom: a click does nothing; the header badge flips to "error" at most.
- Evidence: `command-center-page.component.ts:262` (toast inside `@else`), `session-coordinator.ts:169,153,193,59`.
- Current handling: `fail()` sets a toast and an error status.
- Recommendation: render the toast, or an inline `role="alert"` message, outside the `@if/@else`.

### Stuck loading after a workspace switch during openStart

- Trigger: workspace A to B while `refreshSessions(A)` is in flight.
- Symptom: "Loading sessions…" forever, with the store bound to the stale workspace.
- Evidence: `workspace-binding.ts:33-35`. `openStart()` always returns `null`, so `if (!result || ...) break`
  exits after one pass and the rebind loop is dead. The effect's `open()` returns the in-flight promise
  (`:23`). `refreshSessions` returns without setting the status at `:107-111` when the workspace
  mismatches.
- Recommendation: make `openStart` return a truthy marker (for example the workspace) so the loop works.
  Or have the stale branch re-trigger a refresh. Never leave `'loading'` on a stale return.

### Orphan tab after a failed restore

- Trigger: `switchSession` rejects in the new-tab path.
- Evidence: `session-coordinator.ts:174-195`. The tab is created, attached and set as the records'
  `activeTabId` (`tab-manager.service.ts:1050`), but never closed on failure.
- Symptom: a later retry says "already open in another tab"; the next `openStart` shows an empty
  "Current" card.
- Recommendation: close or detach the tab in the catch.

### Double activation and a missing in-flight guard in chooseSession

- Evidence: `session-coordinator.ts:133-196`, with no `opening`-style guard.
- Recommendation: keep a per-coordinator `choosing` promise or flag, and disable the cards while
  choosing. Show a busy state.

### Single 5 s timeout across the whole pagination loop

- Evidence: `:87-98`. Partial pages are discarded on timeout.

### Stale chooseSession binding across a workspace switch

- Evidence: `:181` uses the workspace captured at `:134`. No `request`-style guard after the await.
- Symptom: a scene for the old workspace appears briefly. `canSend` then rebinds on the next action.

### Current-tab restore failure leaves the scene bound

- Evidence: `:145-156`. The store is bound before the awaited restore, and the failure return leaves it.

### requestStatus silently no-ops after rebind

- Evidence: `command-center-page.component.ts:488`. `page.open()` now always returns `null`, so
  "Status" returns without sending when the binding was stale. Not reachable from the start view, but
  reachable after a workspace switch race.

### chooseCurrentTab fire-and-forget

- Evidence: `:209-210`. The only caller is the template, which ignores the return value, so nothing
  relies on the early id. `chooseSession` catches its own errors, so there is no unhandled rejection.
  Low risk; the return type is misleading.

## Blocking issues

None.

## Serious issues

### S1. Toast not rendered in the start state

- File: `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:262` (inside the `@else` that starts at `:201`)
- Scenario: any failure triggered from the start view, as listed above.
- Impact: the new flow's main failure paths (restore failed, already open, no workspace) give the user no feedback. A silent failure that misleads.
- Fix: hoist the toast block out of the conditional, or surface `store.toast()` inside the start component.

### S2. Workspace-switch rebind loop is dead, and the stale refresh leaves 'loading'

- File: `command-center-workspace-binding.ts:33-35`, `session-coordinator.ts:78,107-111`
- Scenario: switch workspace while the first list load is in flight (very likely on cold start and on a slow RPC).
- Impact: "Loading sessions…" never resolves and the store keeps the old workspace until the user acts. `canSend` can recover it, but the start view has no composer.
- Fix: as in the failure mode above. Add a test with a workspace change mid-`refreshSessions`.

### S3. Failed restore leaves an orphan Command Center tab and blocks retry

- File: `session-coordinator.ts:174-195`
- Scenario: `chat.switchSession` rejects, for example a deleted session or an RPC error.
- Impact: the next click on the same card gives a misleading "already open" error. A phantom "Current" card appears on the next entry. The records' `activeTabId` points at a broken tab.
- Fix: on failure, close the new tab and clear its record (or re-point it).

### S4. No in-flight guard on chooseSession

- File: `session-coordinator.ts:133-196`
- Scenario: double-click, or two cards in quick succession.
- Impact: a spurious "already open" error, or duplicate tabs. The final binding is non-deterministic.
- Fix: serialise the call or ignore it while one is pending; disable cards during the restore.

## Moderate and minor issues

- Moderate: one 5 s abort for the whole All-sessions loop; partial results are discarded (`session-coordinator.ts:88,116`). Use a per-page timeout and keep the pages loaded so far.
- Moderate: `showAll()` read inside the loop (`:91,103`). Capture it once per request.
- Moderate: `chooseSession` stale-workspace guard is missing after the awaits (`:181`).
- Moderate: current-tab restore failure keeps the store bound to a broken tab (`:145-156`).
- Moderate: `openStart` does not deactivate `voiceSessions` for the previous marked tab. Check that the grace timer and activation are cleaned up for a tab that is left.
- Moderate: no tests for pagination, timeout, error and retry in the coordinator, `chooseCurrentTab`, restore failure, the workspace-switch race, or toast visibility in the start view (`session-coordinator.spec.ts` names list). The page spec has no start-view case.
- Minor: `chooseCurrentTab` returns an id before the restore finishes; the signature misleads (`:198-216`).
- Minor: the Current card name falls back to "Command Center" when the session is outside the first 10 (`start.component.ts:66`).
- Minor: only one session carries the "Command Center" badge, so the spec's "marker for sessions that were Command Center sessions" is only partly met (record limit, `command-center-records.ts`).
- Minor: the start component has no card-level busy or disabled state. The `relativeTime` method re-evaluates on every change detection and has no tick, so the labels go stale while the page is open.
- Minor (a11y, otherwise fine): real buttons, one `h2`, `role=status` and `role=alert`, and focus rings are present. The new session cards have no accessible grouping or list semantics, and focus is not moved into the start view or the scene on a transition. Tokens are daisyUI only.

## Data flow

1. Page constructor calls `page.open()`, then `workspaceBinding.open()`, then `coordinator.openStart()`. OK, except for the workspace-change gap (S2).
2. `openStart` clears the store marker, reads the Current tab and the record, and calls `refreshSessions`. OK. The no-workspace case leaves 'loading' (Q1).
3. `refreshSessions`: pagination, sort and stale guard. A gap (timeout and showAll handling).
4. Page renders the start view when `markedTabId` is null. OK. The toast is not rendered (S1).
5. Card, "Current" or "New session" lead to `chooseSession` / `chooseCurrentTab` / `newCommandCenter`, which call `store.setSession` and show the scene. Gaps: S3, S4, the stale workspace.
6. `send()` without a marked tab calls `newCommandCenter()`. OK, but the composer is only inside the scene, so this path serves the programmatic and voice cases only.
7. Removing `openOrResume`: auto-resume of the active tab or last session is gone, as the user intended. The removed `sessionExists` check, with its retry of 3 and its 5 s abort, now surfaces as a restore failure on click instead of an up-front check. That is acceptable once S1 and S3 are fixed.

## Requirements fulfilment

| Requirement                                    | Status   | Gap                                                                |
| ---------------------------------------------- | -------- | ------------------------------------------------------------------ |
| Always open on the start state                 | COMPLETE | Workspace-switch race (S2)                                         |
| Up to 5 latest cards, Current counted in the 5 | COMPLETE | `slice(0, 4)` with a Current card. Correct (`start.component.ts:131`). |
| "All sessions" button                          | PARTIAL  | Timeout and race issues; no per-page results                       |
| "New session" button                           | COMPLETE | Orphans a previous Current tab                                     |
| Choosing a card loads it in a Command Center tab | PARTIAL | Failure feedback invisible (S1), orphan tab (S3), no guard (S4)    |
| "Command Center" marker                        | PARTIAL  | Only the one recorded session                                      |
| Persona rule (`command-center-persona.ts:30`)  | COMPLETE | Applies to all replies, including delegation acks. No conflict with the Tribunal "question text only" rule, which concerns the tool parameter. Existing sessions pick it up on resume, since the persona is re-applied. |

Implicit requirements not addressed: error visibility, double-click protection, the return path to the start view.

## Edge cases

| Case                           | Handled | How                              | Concern                             |
| ------------------------------ | ------- | -------------------------------- | ----------------------------------- |
| No workspace                   | NO      | Toast, hidden                    | Endless "Loading sessions…"         |
| Empty session list             | YES     | "No previous sessions"           | None                                |
| list RPC failure               | YES     | Error card and Retry             | Retry is unavailable with no workspace |
| Workspace switch mid-load      | NO      | Stale return                     | Stuck loading (S2)                  |
| Double-click on a card         | NO      | None                             | S4                                  |
| Restore failure                | PARTIAL | Fixed message                    | Invisible, orphan tab (S1, S3)      |
| Session already open elsewhere | PARTIAL | Switch plus message              | Message is invisible                |
| More than 50 sessions          | PARTIAL | Pagination loop                  | One 5 s budget                      |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH (code read in full; behaviour derived by tracing, not by running)
- Top risk: error feedback never renders in the start view (S1), compounded by orphan tabs (S3) and the missing in-flight guard (S4). Users see clicks that do nothing.
- What a robust implementation would add: a toast or inline alert outside the scene branch; a working rebind loop (or a re-run when stale) so 'loading' always resolves; cleanup of the new tab on a failed restore; a chooseSession in-flight guard with disabled cards; a per-page timeout that keeps partial results; tests for those paths plus a page-level test that the start view renders the error.

## Re-review (fix round 1)

Scope: changed code only (`session-coordinator.ts`, `command-center-workspace-binding.ts`,
`command-center-page.component.ts` toast and `requestStatus`, `command-center-start.component.ts`),
read against `fix-round-report.md` and `hang-fix-report.md`. No tests run; the orchestrator's figures
(430 tests, typecheck, lint, audit 294) are taken as given.

| Item | Result | Evidence |
| ---- | ------ | -------- |
| S1 toast invisible | FIXED | The toast block now sits before the start/scene branch (`page.component.ts:188-190`). The no-workspace case sets `_listStatus='error'` and clears the cards (`coordinator:59-66,84-87`), so "Loading…" no longer hangs. |
| S2 rebind loop and stuck loading | FIXED | The binding retries up to 3 times when the active workspace changed during `openStart` (`workspace-binding.ts:32-40`), which removes the hang. A stale list return is now covered by the retry. `page.open()` returning `null` is handled: `requestStatus` falls back to `newCommandCenter()` (`page.component.ts:494-498`). |
| S3 orphan tab | FIXED | The new-tab catch force-closes the tab, clears the send lock, clears the active record when it points at that tab, and clears the Current card (`coordinator:182-191`). A retry no longer hits the "already open" guard. |
| S4 double click | FIXED | The `choosing` guard is released in `finally` (`:192-194`), and the start controls are disabled while it is set. |
| Per-page timeout | FIXED | Each page has its own abort timer, and `showAll` is captured once (`:96-108`). |
| Stale workspace after await in `chooseSession` | FIXED | Both branches check the workspace after `switchSession` (`:142`, new-tab path). |
| Current-tab restore failure | FIXED | The failure path unbinds the store and returns to start with a toast (`:145-147`). |

### New or remaining findings (none Blocking or Serious)

- Moderate: the toast is now positioned relative to the page host, not the stage column. The host has `container-type: inline-size`, which acts as the containing block for absolutely positioned children. `top-16` therefore overlaps the 72 px header's right side (status badge and "Voice settings") instead of sitting under it (`page.component.ts:190`, `:51-53`). It is a visual overlap only; the toast is `alert` or `status` and is dismissible.
- Moderate: `choosing` has no timeout. If `chat.switchSession` never settles, every start control stays disabled until the page is re-entered (`coordinator:146-194`). Nothing here makes that hang likely, but a bound would make it robust.
- Minor: the stale-workspace early return after `switchSession` in the new-tab path (`:172-175`) leaves the restored tab in the old workspace without further state. That tab is valid and parked, so this is harmless. A workspace change during the third retry pass still leaves the loading status (very unlikely).
- Minor: with no workspace, the start view shows "Could not load sessions" with a Retry that does nothing (`refreshSessions` sets `error` again). The toast explains the cause. This is acceptable.
- Minor: `forceCloseTab` is a pop-out API ("transfer, do not abort"). It is fine here because the tab never streamed, but it is coupled to that comment. The decision is recorded in the fix report and is reversible.
- Minor: Status from the start view creates a new session (a recorded decision). After a stale-workspace rebind with an old marked tab, it also starts a new session rather than resuming one. This is consistent with the start-state model.
- Test coverage: the fix report names regression tests for each S item. I did not execute them. The first two Moderate items above have none.

### Updated verdict

- Score: 8/10
- Assessment: APPROVED
- Blocking: 0, Serious: 0, Moderate: 2 (toast position, no `choosing` timeout), Minor: 5
- Confidence: MEDIUM-HIGH (code traced, tests not executed by me)
- Recommendation: APPROVE. Both Moderate items are optional follow-ups.
