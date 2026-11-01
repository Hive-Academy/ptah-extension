# Code Logic Review: B4b (proposal pages)

Score: 5/10. Verdict: REVISE.

Scope: all files in `libs/frontend/onboarding/src/lib/proposal/*`, plus `onboarding.routes.ts` and its spec. I also read `harness-session.controller.ts`, `harness-proposal-hydration.service.ts#bind`, `builder-apply-section.component.ts` (apply and emit path) and `harness-workflow-utils.ts#canonicalHarnessRoot`. I ran no checks. Paths below are relative to `libs/frontend/onboarding/src/lib/proposal/` unless stated.

Claims in `b4b-report.md` that I checked and found true:
- The route-scoped store is wired in `onboarding.routes.ts`.
- The "Your brief" section and the Details log are present.
- Intake facts are gated on `readStackProfile`.
- The cancelled-navigation discard fires only for a freshly created session.
- Health refresh comes from the apply section (`builder-apply-section.component.ts:304`).

Several acceptance items are weaker than claimed, as the findings below show.

## Blocking

### 1. Review gate compares a raw workspace path to a canonical one, so Review can never enable on Windows or with a trailing slash
- Evidence:
  - `proposal-flow.store.ts:54` (`reviewEligible`) requires `record.workspacePath === this.workspaceRoot()`.
  - `record.workspacePath` is the output of `canonicalHarnessRoot`: it turns backslashes into `/`, strips trailing slashes, and lowercases drive-letter paths (`harness-session.controller.ts:startInternal`, `harness-workflow-utils.ts:8-16`).
  - `workspaceRoot()` (`proposal-flow.store.ts:66`) is the raw `tabs.activeWorkspacePath` or `vscode.config().workspaceRoot`.
  - `restore` at `proposal-flow.store.ts:148` has the same raw `===` comparison.
- Scenario: the user opens `C:\Users\me\app` (Electron on Windows, the priority host). The record holds `c:/users/me/app`. The Review button on the workspace page stays disabled forever, with no message explaining why. A trailing slash or a mixed-case drive letter does the same.
- Side effect: the `restore` short-circuit never fires, so the review page always does a full `session.restore` plus `hydration.bind`. `bind` clears the revisions, so the review view flashes "Loading review…".
- The specs use `/ws` everywhere (`proposal-flow.store.spec.ts`), so none of this is covered.
- Fix: compare `canonicalHarnessRoot(a) === canonicalHarnessRoot(b)`. It is exported from harness-builder; export it if it is not already. Add a spec with `C:\Proj\` against a record holding `c:/proj`.

## Major

### 2. Apply can be attributed to the wrong revision, and a stale receipt shows against the pinned revision
- Evidence:
  - `review-apply.page.ts:41` `onApplied` reads `this.reviewed()` when the apply response arrives.
  - The apply section captures its config when apply starts and emits after the awaited RPC (`builder-apply-section.component.ts:285-304`).
  - `updateReview()` at `review-apply.page.ts:40` is not disabled while an apply is in flight.
- Scenario:
  - The user applies revision 2.
  - While the RPC runs, a newer revision arrives and the user clicks "Update review", so `reviewedId` becomes revision 3.
  - `onApplied` records `appliedRevisionId = rev 3`, but revision 2's files were written.
  - The "Changes since applied revision" line and the receipt are now wrong.
- Related: the `ptah-apply-result` block (`review-apply.page.ts:23`) renders whenever any receipt exists. It does not check `receipt.revisionId === reviewed().id`. After "Update review", the old receipt and its Done button look like the result of the new review.
- Fix:
  - Capture the revision id at apply start. The apply section would need to emit it, or the page could track a `pendingRevisionId` when the apply starts.
  - Disable "Update review" while applying.
  - Render the receipt only when `receipt.revisionId === reviewed().id`, and otherwise show a "Applied revision N; reviewing M" note.

### 3. `restoreRevision` replaces the whole user-override snapshot and pins every field
- Evidence: `proposal-flow.store.ts:180-199`.
  - It never reads the existing snapshot (`records.readSnapshot`). It builds a new `configUpdates` containing only the revision's keys and writes it with `writeSnapshot`.
  - Earlier explicit user choices on fields the revision lacks are silently dropped. The same happens for fields the revision has but the user had changed since.
  - Every field in the revision becomes `source: 'user'`, even fields the user never touched. In `reviewedConfig` (`review-apply.page.ts:33`) the snapshot is merged over the revision, so those fields stop following later agent revisions.
- Impact: this is silent loss of the user's choices, and it contradicts the plan's "user-override merge on restore".
- Fix: merge into the existing snapshot (`mergeHarnessConfigUpdates(existing.configUpdates, updates)`, and merge `fields` the same way). Mark only fields that differ from the current folded config as user-sourced. Add a spec that restores onto a snapshot that already has overrides.

### 4. "Save draft" does not stop the session, so the session disappears from cross-mode conflict detection
- Evidence:
  - `proposal-workspace.page.ts:68` `saveDraft` calls only `records.replaceDraft(...)`.
  - `activeSessionIn` skips the tab that is the draft (`harness-session.controller.ts`, `tab.id !== readDraft(...)?.tabId`).
- Scenario: the user clicks "Save draft" while the agent is busy, leaves, and starts the other mode or a new project. Detection no longer sees the still-running session, so a second harness session starts in the same workspace.
- The Leave flow does it correctly: it stops first, then marks the draft. The standalone button is inconsistent with it.
- Fix: make "Save draft" go through `store.leaveCurrent('save')`, or make it explicit that it does not stop the session. Alternatively, `replaceDraft` should be refused while the phase is busy.

### 5. An unconfirmed stop after a cancelled navigation is reported to a page that no longer exists
- Evidence:
  - `new-project-intake.page.ts:61` and the team-start `open` call `discardCancelledStart()` in `finally`.
  - `proposal-flow.store.ts:169-174` does `leave(..., 'discard')`. On `'uncertain'` it sets `stopUncertain` and `leaveOpen` on the store.
  - The usual reason `navigate()` resolves `false` is that the user navigated elsewhere, which destroys the start page. The route-scoped store may also be gone.
- Result: the user is told nothing, and the session may be left running.
- Unhandled rejection: a `leave` that throws (for example `closeTab`) rejects out of `finally`. That is an unhandled rejection from the `submit` handler, with no `actionError` set.
- Fix: wrap the discard in try/catch. On `'uncertain'`, persist a visible marker (a draft or a toast) instead of relying on a page that may be gone.

## Minor

### 6. Answer-dock sheet leaves the page inert if the viewport widens past 720px
- Evidence: `answer-dock.component.ts:22` ties `inert` to `open()`. The sheet is `min-[721px]:hidden`, so a resize above 720px hides the sheet while `open()` stays true and the background stays inert.
- The spec never resizes.
- Fix: close the sheet on a `matchMedia('(min-width: 721px)')` change, or compute inert from `open() && narrow()`.

### 7. Review can be enabled when no revision exists
- Evidence: `reviewEligible` (`proposal-flow.store.ts:54`) uses `hydration.config()`, which includes user overrides, not `revisions()`.
- If a snapshot exists but `current()` is null, the button is enabled and `review()` (`proposal-workspace.page.ts:69`) silently returns.
- Fix: also require `current() !== null`.

### 8. Receipt-save failure is invisible on the review page
- Evidence:
  - `recordApply` reports a write failure via `session.error` (`harness-session.controller.ts:105-111`).
  - The review page renders only `store.actionError` (`review-apply.page.ts:24`), not `session.error`.
- Result: files are written, but `applyReceipt` is missing, so ApplyResult and Done never appear.
- Also, the apply section's own result block and `ptah-apply-result` both show "files written", so the same result appears twice.
- Fix: render `store.session.error()`, and offer Done even when the receipt save failed.

### 9. Cross-mode rebind can create a session
- Evidence: `proposal-flow.store.ts:122` treats any `start()` outcome other than `'reused'` as a failure. If it returned `'started'`, a new tab and session were already created and are leaked.
- The `!request` branch (`:106-111`) has no try/catch and does not set `leaveSaving`. A throwing `controller.leave` rejects into the dialog handler.

### 10. Query parameters are read once
- Evidence: `ngOnInit` reads `tab` and `rev` from the snapshot (`proposal-workspace.page.ts:52`, `review-apply.page.ts:37`).
- A same-component navigation with a different `tab` is handled only by the manual `restoreDraft` path. Browser back/forward to a different tab or revision shows stale content.

### 11. Spec gaps
- No spec uses a Windows path, a trailing slash, or a mixed-case drive letter.
- The stale-revision spec (`review-apply.page.spec.ts`) asserts only the `newer()` computed, not the banner. It does not cover "Update review", the apply-pinning, or the receipt-for-other-revision case.
- The restore spec starts from a null snapshot, so it never checks that earlier overrides are preserved.
- The route spec mocks the store and pages, so the route-scoped provider wiring is unasserted.
- `new-project-intake.page.spec.ts` never asserts that `start` is called or that cancelled navigation discards. The team-start spec covers the discard.
- The dock spec has no viewport change and no Escape-while-send-in-flight case.

## Answers to the review focus questions
- Unhandled errors in async store actions: mostly contained, because the controller and `hydration.bind` catch internally. The gaps are in findings 5 and 9.
- Stale state when the revision changes during review: handled for display (the pinned id and the `newer` banner) but not for apply (findings 2 and 3).
- Escape, trap and focus return in the dock: behave as specified at ≤720px, except finding 6.
- Items claimed or required but weak: Review enablement (finding 1), user-override merge on restore (finding 3), apply-to-reviewed-revision (finding 2).

## Round 2

Scope: re-read `proposal-flow.store.ts` in full, `review-apply.page.ts` in full, `proposal-workspace.page.ts` (`ngOnInit`, `load`, `saveDraft`, `restoreDraft`), `answer-dock.component.ts`, `apply-result.component.ts`, and the new store spec cases. I did not run anything. I read the review and workspace spec case names but not every assertion in them. Paths are relative to `libs/frontend/onboarding/src/lib/proposal/`.

### Status of the original findings

| # | Original finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Review gate compared raw and canonical roots | Fixed | `proposal-flow.store.ts:56` and `:166` now compare `canonicalHarnessRoot` on both sides. The spec `compares canonical Windows and trailing-slash workspace roots` covers it. |
| 2 | Apply attributed to the wrong revision, stale receipt shown | Fixed, with a fragility (new finding N1) | `review-apply.page.ts:53` captures `pendingRevisionId` on the Apply click. `:54` uses the captured id. `:44` shows a receipt only when `receipt.revisionId === reviewedId`. `:19` disables Update review while an apply is pending. `:24` shows an "Applied revision N; reviewing M" note instead of the stale result. |
| 3 | Restore wiped overrides and pinned every field | Partial (new finding N2) | `proposal-flow.store.ts:202-218` now merges into the existing snapshot and keeps `fields` and `lastApplied`. It only writes fields that differ from the current revision. |
| 4 | Save draft did not stop the session | Fixed (minor N3) | `proposal-workspace.page.ts:71` goes through `leaveCurrent('save')`. It handles `uncertain` (opens the dialog), `save-failed` and a throw, and guards re-entry with `leaving`. |
| 5 | Unconfirmed stop after a cancelled navigation was invisible | Fixed | `proposal-flow.store.ts:70-79` and `:187-196` publish through `NotificationService`, which lives outside the route. `source` is typed `string`, so `'onboarding'` is accepted. A throwing `leave` is caught. |
| 6 | Dock stayed inert after the viewport widened | Fixed | `answer-dock.component.ts:22` closes the sheet on a `matchMedia` change and removes the listener on destroy. |
| 7 | Review enabled with no revision | Fixed | `proposal-flow.store.ts:56` requires `current() !== null`. |
| 8 | Receipt-write failure invisible | Fixed | `review-apply.page.ts:26` renders `session.error()`. `:25` shows Done when no receipt was saved or an error is set. `ApplyResultComponent.showDetails` removes the duplicate path list. |
| 9 | Cross-mode rebind could leak a session | Fixed | `proposal-flow.store.ts:139-143` accepts `started` and then stops it. The no-request branch (`:119-129`) has try/catch and `leaveSaving`. |
| 10 | Query parameters read once | Fixed | Both pages subscribe to `queryParamMap`. The workspace page serialises loads through `loadQueue` and drops superseded tabs (`proposal-workspace.page.ts:55-56`). The review page serialises restores through `restoreQueue` and updates `reviewedId` when `rev` changes (`review-apply.page.ts:49`). |
| 11 | Spec gaps | Mostly fixed | New cases exist for canonical roots, merge on restore, cancelled-stop notification, same-component query changes, stale-receipt note, receipt-save failure, and viewport widening. |

### New findings

**N2. Restore skips fields equal to the current agent value, so an existing user override survives (major)**
- Evidence:
  - `proposal-flow.store.ts:211` only adds a key to `updates` when `JSON.stringify(revision.config[key]) !== JSON.stringify(current[key])`.
  - `:218` then merges `updates` over the old `configUpdates`. An existing override for a skipped key is never removed or overwritten.
- Scenario, reachable using restore alone:
  - The user restores revision 1 (name "Old"), which creates the override `name = Old`.
  - The user later restores revision 2, whose `name` ("Now") equals the current agent value.
  - The key is skipped, so the override `name = Old` stays. The review and Apply still use "Old", although the user asked for revision 2.
- The new spec does not cover this. It restores onto an override on a different field (`persona`).
- Fix: for a key where the revision equals the current agent value and an override exists, delete the key from `configUpdates` and `fields`, so the field follows the agent again. Otherwise write the revision value. Add a spec for restoring a revision equal to the current value while an override exists.

**N1. Apply start is captured by matching button text, and the pending state can get stuck (minor)**
- Evidence:
  - `review-apply.page.ts:53` matches `/^(Apply to Workspace|Try again)$/` on the button text and sets `pendingRevisionId`.
  - `:42` clears it with a `MutationObserver` that looks for the literal "Try again".
- Failure modes:
  - If the apply section changes its copy, the capture silently stops. `onApplied` then falls back to `reviewedId()` and the race returns.
  - If the section's `apply()` returns early after the click was captured, no `applied` or error state follows. Update review stays disabled until the page is remounted.
- Fix: add an `applyStarted` output to `BuilderApplySectionComponent` (a one-line change in a read-only B4a file, needing coordinator approval). Failing that, clear `pendingRevisionId` when the apply section's `applying` state ends, and add a spec that fails if the button text changes.

**N3. Save draft gives no confirmation and leaves a stopped session on screen (minor)**
- Evidence: `proposal-workspace.page.ts:71`.
- After a successful stop and save, the page keeps showing the composer and "Ready to reply" for a session that was just stopped. There is no "Draft saved" message.
- Fix: navigate away after a successful save, or show a status line and disable the composer.

**N4. Closing the dock sheet on widen focuses a hidden element (negligible)**
- Evidence: `answer-dock.component.ts:26` focuses `bar`, which is `min-[721px]:hidden`, when `closeSheet()` runs from the media-query handler. The focus call is a no-op. Not worth a separate fix.

### Score and verdict

Score: 7/10. Verdict: REVISE.

- The earlier blocking finding and four of the five majors are genuinely fixed and tested. The restore fix is partial.
- The one remaining item that changes a user-visible result is N2: restore can silently leave an old override in place. It is a narrow, local fix (a few lines plus one spec). N1 and N3 are minor and may be deferred.
- No blocking items remain.

## Round 3

Scope: `proposal-flow.store.ts#restoreRevision`, `review-apply.page.ts` (template bindings and the pending-state methods), `proposal-workspace.page.ts#saveDraft`, the `builder-apply-section.component.ts` diff, `mergeHarnessConfigUpdates`, and the spec case names and bodies for the new tests. I ran nothing. Line numbers are post-Prettier, in files under `libs/frontend/onboarding/src/lib/proposal/` unless stated.

### Status of round 2 findings

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| N1 | Apply start captured by button text | Fixed | The page binds `(applyStarted)="captureApplyStart()"`, and `(applyFailed)="onApplyFailed()"` (`review-apply.page.ts:118-120`). `captureApplyStart` sets `pendingRevisionId` from `reviewedId()` (`:297-298`). The MutationObserver and text matching are gone. In `builder-apply-section.component.ts`, `applyStarted.emit()` is inside `apply()` after the early-return guards and `applying.set(true)`, so it fires only when an RPC really starts. `applyFailed.emit()` is in the catch, after the destroyed check. Update review stays disabled only while `pendingRevisionId` is set (`:73`, `:277`). |
| N2 | Restore left an override when the revision equalled the agent value | Fixed | `proposal-flow.store.ts:364-371` collects `resetKeys` and deletes the field metadata. `:382` deletes those keys from `configUpdates`. `mergeHarnessConfigUpdates` returns a shallow copy (`merge-harness-config-updates.ts:16`), so the delete does not mutate the cached snapshot. The new spec `removes a restored name override when the next revision matches the agent value` asserts this. |
| N3 | Save draft left a stopped session on screen | Fixed | `proposal-workspace.page.ts:468-471` navigates to `/onboarding` after a clean save, and keeps the uncertain, save-failed and throw handling. |
| N4 | Hidden-bar focus no-op | Left as is (negligible) | |

### Apply-section regression check

- `applyStarted` and `applyFailed` are additive outputs. The only other consumer is `harness-builder-sidebar.component.ts`, which binds `applied` and `openDashboard` only, so it is unaffected.
- The `preview` change in the diff is formatting only.
- The `applyStarted` emission is synchronous inside `apply()` before the awaited RPC, so the config captured by `fullConfig(this.preview(), ...)` is the same one the page pinned.

### New findings

**N5. Restoring `persona`, `agents`, `skills`, `prompt` or `mcp` merges over the previous override instead of replacing it (minor)**
- Evidence: `proposal-flow.store.ts:378-381` calls `mergeHarnessConfigUpdates(existing.configUpdates, updates)`, which deep-merges the object fields (`persona`, `agents.enabledAgents`, and so on).
- Scenario: an existing override holds `agents.enabledAgents = {a: true}`. The user restores a revision with `{b: true}`. The stored override becomes `{a: true, b: true}`, which is not that revision.
- This only applies to nested fields that already have an override and differ from the revision. The earlier top-level `name` case is exact. Acceptable to defer.
- Fix: replace the whole key (`configUpdates[key] = revision.config[key]`) instead of merging.

**N6. No spec asserts that the apply section emits `applyFailed` (minor)**
- Evidence: `builder-apply-section.component.spec.ts` has `emits applyStarted when RPC begins but not on an early exit`. I found no case for the failure emission.
- The page spec `captures apply start from the section output and clears pending state on failure` tests the page's handling with the output triggered by the test, not the real emission.
- A regression that stopped emitting `applyFailed` would leave "Update review" disabled until remount and no spec would catch it.
- Fix: add one case that rejects `rpc.apply` and expects `applyFailed` once and `applied` never.

### Final score and verdict

Score: 8/10. Verdict: APPROVE.

- The blocking Windows-path finding, all five major findings and the restore-override defect are fixed and covered by specs.
- No blocking or major items remain. N5 and N6 are minor and can be deferred.
- Visual quality, and the behaviour of `inert`, focus trap and `matchMedia` in a real Electron window, remain unverified because no run was allowed.
