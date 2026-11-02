# Code Logic Review — TASK_2026_ONBOARDING, batch B3a (Analyze A1 + A2)

**Verdict: REVISE** — score 6.5/10 — 0 blocking, 3 serious, 5 moderate/minor.

Review family: reviewer Claude (in-process); implementers Codex (L1, L3) + Grok (L2, L4).

Scope: uncommitted diff vs HEAD plus untracked files listed in the request. All files were read; nothing was run (per instruction). Paths below are relative to `libs/frontend/`.

## What was checked and holds

- Preview store (`setup-wizard/.../generation-preview.store.ts`): bound `open()` always runs a fresh tab-bound compare (`:84-97`, `load` `:134-146`). `Keep` is the default (`nextSnapshot`). Target change resets decisions and the changed flag (`changeTarget`). Confirm re-compares and submits only when `needsReview` is false. Submit carries token, Replace entries and target (`submitDecisions`). Superseded or cancelled replies are dropped via the `request` counter, and `cancel()` bumps it. The bound error branch retries with `load(ids, false)` and has no create-only return (PR-R1). The unbound branch is unchanged, so legacy callers are intact. The `retryOnError` input defaults to false, so the legacy dialog copy is unchanged.
- `previewGeneration` only adds `tabBinding` when provided (`wizard-rpc.service.ts`, spec added).
- Step link: agent→guidance never copies `run` and always writes `gen` (falls back to `tab`). guidance→done and guidance→generate match the A2 table. Within-owner copying is preserved.
- Match %: `matchPercent` implements the 0–100 decision (`agent-recommendation-list.component.ts:34`).
- Raw backend text: all page error paths go through `safeFailureCopy` or fixed copy. `ChooseAgentsPage` uses fixed copy for rejections.
- Harness: the ready suite still writes to `screenshots/ready` (`ONBOARDING_CAPTURE_DIR` is unchanged; analyze has its own dir). Fixtures answer `list-analyses`, `get-resumable-run`, `get-generation-run-state`, `recommend-agents`, `list-agent-packs`, `preview-generation` and `submit-selection`. These are the RPCs the pages call. `wizard:load-analysis` and `wizard:deep-analyze` are supplied per scenario or deliberately left unanswered.
- Route wiring: `analyze` and `analyze/agents` are registered before `**`.

## Findings

### 1. SERIOUS — Interrupted panel hides a loaded saved analysis and its Choose-agents action (Owner: L3 Codex)

- File: `onboarding/src/lib/analyze/analyze-workspace.page.ts:34` vs `:43`; set at `:105-109`.
- Scenario: the user opens A1 with `?analysis=<slug>` or clicks Use on a saved analysis, and an unfinished run also exists. `ngOnInit` loads the saved analysis, then sets `interrupted=true` from `getResumableRun`.
- Failure: the template checks `interrupted()` before `store.loaded()`. The Interrupted panel renders and the completed state, with the Continue-to-agents action (`chooseAgents()`), is not shown. The only exits are "Continue previous run" or "Start fresh", and Start fresh calls `clearSelection()`. The user cannot proceed with the analysis they just chose. The plan says an unfinished run must never be substituted for a selection, and this hides the selection behind it.
- Fix: gate `interrupted` on `store.selected() === null`, or order the `store.selected()` branch before `interrupted()`. Add a page test for selected plus resumable.

### 2. SERIOUS — Async navigations after destroy can pull the user back to A2/A3 (Owner: L3 Codex)

- File: `onboarding/src/lib/analyze/choose-agents.page.ts:160-163` (after `await launcher.open`), `:253-254` (`goToRun`), and the early-forward `goToRun` in `ngOnInit`.
- Scenario: the user leaves the page (stepper link, Back to chat) while `launcher.open`, `generation.refresh()` or `store.submit()` is pending. When the promise resolves, `router.navigate([], {relativeTo: this.route, ...})` or `goToRun` runs on the destroyed page. That re-navigates to A2 or A3 over the user's newer navigation. A second hazard: the tab is created and bound after the user left.
- Fix: add a `DestroyRef`-backed `destroyed` flag. Check it after each `await` in `ngOnInit`, `confirmPreview` and `goToRun`, and skip navigation. `AnalyzeWorkspacePage.useSaved()` and `startFresh()` have the same shape but are lower risk.

### 3. SERIOUS — `submit()` classifies "start was a no-op" using stale rejection state (Owner: L3 Codex)

- File: `onboarding/src/lib/analyze/analysis-step.store.ts:110-119`, with `generation-workflow.store.ts:104-115`.
- Scenario: `startAgents` returns early before clearing `rejectionValue`/`startError` (`binding` invalid, `isBound()`, or `!canStartInChat`). `submit()` then reads `generation.rejection()`, which can still hold an earlier `blocked` or `preview-required` rejection. It returns that stale rejection as if this submit produced it. The page then shows the owner banner or reopens "Targets need another review" for a request that never reached the host. Also, `generation.bind(binding)`'s result (`invalid-tab`, `workspace-mismatch`) is ignored and ends in the generic error.
- Fix: check the `bind()` result and bail out with a fixed error. Clear or compare rejection identity around the call. Prefer `startAgents` returning a result, or reset the rejection before the call.
- Tests: `analysis-step.store.spec.ts:63` covers only the stale accepted run, not the stale rejection.

### 4. MODERATE — A1 timer keeps ticking after the run ends (Owner: L3 Codex)

- File: `analyze-workspace.page.ts:136-139`, `stop()` at `:131`.
- The 1 s `setInterval` is cleared only in `ngOnDestroy`. After completion, failure or stop it keeps writing `now` for as long as the page stays open. It is cheap, but it is an unbounded timer. Clear it when `runner.isRunning()` ends or in `stop()`.

### 5. MODERATE — Catalog payload is cast, not validated (Owner: L3 Codex, with L2 Grok for the row component)

- File: `analysis-step.store.ts:104-109` (`response.data as AgentRecommendation[]`); `agent-recommendation-list.component.ts:141` (`row.agent.matchedCriteria.length`).
- If the host returns a non-array or rows without `matchedCriteria`, `selectRecommended()` or the template throws. The page maps it to "Recommendations unavailable" (acceptable), but a row with only `matchedCriteria` missing breaks the whole list render. Add `Array.isArray` plus a defensive `(matchedCriteria ?? [])`.

### 6. MODERATE — `listAnalyses()` swallows RPC failure (Owner: shared setup-wizard; surfaces in L3 pages)

- File: `setup-wizard/.../wizard-rpc.service.ts:633-647` (pre-existing, returns `[]`).
- Effects: A1 `savedError` can never be true for an RPC failure, so the Retry UI is effectively dead. A2 with `?analysis=` reports "That analysis is no longer available" when the list call failed. This is a failure-looks-like-empty result. Either have the onboarding store use a throwing variant, or accept and document the limitation.

### 7. MINOR — Test gaps against the plan's list (Owners: L1/L3)

- No page-level tests for: Interrupted panel Continue/Start fresh, Stop confirmation, Manual adjust modal, Phase header ("Phase n of N"), saved list hide, all five phase statuses (`phase-list.component.spec.ts` is 14 lines).
- `generation-preview.store.spec.ts` has four cases only. Missing: confirm with changed targets (changed flag, stays open), Replace reset on revision change, target change resetting decisions, and the preview-required reopen keeping the root. "Preview refresh-before-confirm" is only indirectly covered by the first case.
- Step-link spec additions are present (Grok L2) and cover the `run` and `gen` rule.

### 8. MINOR — `viewState` passed as a literal `null` on all A1 run panels (Owner: L3 Codex)

- File: `analyze-workspace.page.ts:23, 28, 31, 45`.
- It satisfies the B2 carry formally (the input is bound). Analysis has no stop-unconfirmed state, so there is no behavioural gap. Noted so the carry is not read as proving stop recovery for A1: a failed `runner.cancel()` shows only the `selectError` text, not the panel recovery.

## Five logic questions (summary)

1. Silent failures: `listAnalyses` returns `[]` on error (finding 6); stale rejection reused as the result of a submit that never started (finding 3).
2. Unexpected user action: leaving mid-request re-navigates the user back (finding 2); choosing a saved analysis while a resumable run exists hides it (finding 1).
3. Wrong answer from input: a catalog row without `matchedCriteria` or a non-array reply (finding 5). Scores outside 0..100 hide the match, as designed.
4. Dependency failure: the preview error path retries only and shows fixed copy; the supersede and cancel races are handled by the request counter. Gaps are in the page-level post-await handling (finding 2).
5. Missing: no destroy guard and no timer stop. Loaded-analysis-versus-resumable precedence was never specified.

## Requirements fulfilment (B3a acceptance)

| Item | Status | Gap |
| --- | --- | --- |
| Four phase rows, five statuses, "Phase n of N", no percent, counters only attached | COMPLETE | phase-list test thin |
| Saved list use/hide, Interrupted panel, Stop modal, Manual adjust | PARTIAL | finding 1 |
| A2 grouped list, match %, select recommended/clear/count | COMPLETE | finding 5 hardening |
| Preview refreshed on open and before confirm, Keep default, token+Replace+target | COMPLETE | store tests short |
| Owner-conflict banner, community packs, agent-only banner with "Analyze first" | COMPLETE | |
| Submit navigates to A3 with `tab` and `run` | COMPLETE | finding 2 |
| Furthest-step forward respects `explicitBack` | COMPLETE | tested at `choose-agents.page.spec.ts:93` |
| Step link never emits agent `run` on agent→guidance, always `gen` | COMPLETE | |

## Verdict

Recommendation: REVISE. Score 6.5/10. Findings 1–3 should be fixed before B3a is committed; 4–8 can be fixed in the same pass.

Owner summary:

- Codex (L1/L3): findings 1, 2, 3, 4, 5, 7, 8.
- Grok (L2/L4): no defects in step-link, recommendation list row logic (finding 5 touches the template) or the harness scenarios.

## Re-review (revision 1)

Scope: read-only; code read in full for `analyze-workspace.page.ts`, `analysis-step.store.ts`, `choose-agents.page.ts`, `agent-recommendation-list.component.ts` (changed parts), `wizard-rpc.service.ts` `listAnalyses`, the capture spec locator and the revision notes of both lanes. Nothing was run. Paths relative to `libs/frontend/`.

### Status of findings 1-8

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Interrupted hides loaded analysis | FIXED | `onboarding/src/lib/analyze/analyze-workspace.page.ts:36` (`store.loaded()`) now precedes `:50` (`interrupted()`). Render test `analyze-workspace.render.spec.ts:39` selects plus resumable and asserts Continue navigates. |
| 2 | Navigation after destroy | FIXED | `choose-agents.page.ts` `destroyed` flag via `DestroyRef`; checked after launcher, URL writeback, refresh, `listAnalyses`, `selectAnalysis`, `confirm`, `submit`, preview reopen, and at the top of `goToRun`. Spec `choose-agents.page.spec.ts:114-130`. A1 `useSaved`/`startFresh` still unguarded (was flagged lower risk). |
| 3 | Stale rejection used as submit result | FIXED | `analysis-step.store.ts:122-135`: binding verified after `bind()`; rejection and error compared by identity against pre-call values. The `bind()` result is `void`, so the binding check is a valid substitute. |
| 4 | Timer never stops | FIXED | `analyze-workspace.page.ts:142-146` clears on the first tick after the run ends; `stop()` and `ngOnDestroy` also clear. Test `render.spec.ts:122`. |
| 5 | Catalog payload cast | FIXED | Store `analysis-step.store.ts:104-120` validates array and rows and normalises `matchedCriteria`. Template now uses `criteriaOf` (`agent-recommendation-list.component.ts:41,192`). Note: the `source === 'analysis'` branch still trusts `rpc.recommendAgents`'s result, but the row component is now safe either way. |
| 6 | `listAnalyses` swallowed failure | PARTIAL | Service: opt-in `throwOnError` (`wizard-rpc.service.ts:631-644`). Legacy callers `setup-wizard/.../welcome.component.ts:374` and `wizard-landing.component.ts:243` call it with no option and get `[]` on failure exactly as before. Both are the only other callers (grep). The one behaviour change is a non-array `analyses` now yields `[]` rather than `undefined`; that is only safer. A1 Retry now works. A2 still has defects, see N1 and N2. |
| 7 | Test gaps | FIXED | `analyze-workspace.render.spec.ts` covers interrupted Continue/Start fresh, saved Hide/Retry, Stop confirm, Manual adjust, phase header and recovery; preview store cases at `generation-preview.store.spec.ts:51-74` per notes. I did not re-read every assertion. |
| 8 | `viewState` literal `null` | FIXED | `analyze-workspace.page.ts:102-104` derives `idle/running/cancelling/failed/completed/stop-unconfirmed` from runner signals, all values valid members of `GenerationViewState` (`generation-workflow.store.ts:15-26`). Panel gets `stop-unconfirmed` only through `stopRecovery` (set in `stop()` catch). `WizardAnalysisRunner.cancel()` resets runner state in `finally` and rethrows (`wizard-analysis-runner.service.ts:227-238`), so after a failed cancel the local flag is what keeps the recovery panel visible. Correct. |

Other fixes: the capture locator (`onboarding-analyze-visual.e2e.spec.ts:126-131`) is filtered to one badge and asserted `toHaveCount(1)`. Not run.

### New findings

**N1. MODERATE - A2 Retry after a saved-list failure is dead** (Owner: Codex)
- File: `onboarding/src/lib/analyze/choose-agents.page.ts:193-197` with the Retry at `:69` and `loadRecommendations` at `:208-214`.
- Scenario: `?analysis=<slug>` and `wizard:list-analyses` fails. The page shows "The analysis could not be loaded. Try again." with a Retry button. Retry calls `loadRecommendations()`, which never lists or selects. `store.loaded()` is null, so `loadRecommendations` throws "Choose a completed analysis first." and the copy changes to that. The user cannot recover without leaving the page.
- Fix: make Retry re-run the load sequence (list, select, recommendations), or keep a separate retry handler for the analysis load.

**N2. MODERATE - A2 reports a load RPC failure as "no longer available"** (Owner: Codex)
- File: `choose-agents.page.ts:188-192` with `analysis-step.store.ts:74-83`.
- `selectAnalysis` returns `'failed'` on a `loadAnalysis` error and `'not-found'` when missing. The page tests `selected !== 'loaded'` and shows "That analysis is no longer available. Analyze the workspace again." for both. A transient failure sends the user to re-run a full analysis. A1 (`analyze-workspace.page.ts:79`) distinguishes the two correctly.
- Fix: map `'failed'` to the retryable copy (and have N1's Retry cover it).

**N3. MINOR - A1 `ngOnInit` has no destroy guard and drops `?analysis=` after a failed list** (Owner: Codex)
- File: `analyze-workspace.page.ts:112-117`.
- After `loadSaved()` fails, `?analysis=` is silently skipped, and Retry (`loadSaved`) does not apply it. `useSaved` can also call `router.navigate` after the page is destroyed. Low impact.

**N4. MINOR - Stop-unconfirmed Retry resumes a run that may still be live** (Owner: Codex)
- File: `analyze-workspace.page.ts:139` (`retry` -> `continuePrevious` -> `resumeAnalysis`), reached from the `stopRecovery` panel at `:23`.
- It matches the RunPanel's contract, but the host-side run may still be running. Not a defect against this plan; flagged only for the E2E pass.

No new defects found in `agent-recommendation-list.component.ts`, the step link, or the harness fixtures within what I read.

### Score and verdict

Score: 7.5/10. Findings 1-5, 7 and 8 are fixed with tests; finding 6 is fixed on the A1 path and for legacy callers, but A2 still turns a list failure into a dead Retry (N1) and a load failure into "no longer available" (N2).

Verdict: **REVISE** (Moderate N1 and N2 open, both Codex, both in `choose-agents.page.ts`). N3 and N4 are non-blocking.

## Re-review (revision 2)

Scope: N1-N3 and regression checks in `choose-agents.page.ts`, `analyze-workspace.page.ts` and their specs. These files are untracked, so `git diff` is empty; I read them whole. N4 is deferred (decisions.md). Nothing was run.

### Status

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| N1 | A2 Retry dead after saved-list failure | FIXED | `choose-agents.page.ts:182-185` stores `pendingAnalysis` before loading; `:196-199` `retryLoad` re-runs list, select, then recommendations while the slug is pending. `:222` clears it only after selection succeeds, so a later recommendations failure retries recommendations only (`:197-198`). Tests `choose-agents.page.spec.ts:132-143` (list rejects, Retry gives 2 lists, select, recommendations) and `:166-175` (no re-list after selection). |
| N2 | `failed` shown as "no longer available" | FIXED | `choose-agents.page.ts:209-213`: `not-found` gives the no-longer-available copy, `failed` gives the retryable copy. Thrown errors also get the retryable copy (`:215-218`). Tests `spec:145-164`. |
| N3 | A1 slug dropped after failed list; no destroy guard | FIXED | `analyze-workspace.page.ts:115` keeps the slug, `:125-134` applies it after a successful list, destroy guards at `:117,119,128,137`. Tests `render.spec.ts:85-110` (Retry applies the slug; no navigate after destroy). |

Regression checks: destroy guards follow every await in `ngOnInit`, `loadAnalysisAndRecommendations` (the `finally` is guarded) and `loadRecommendations`. There is no double-load: the Retry button is rendered only while `loadError()` is set, and `loadAnalysisAndRecommendations` clears it synchronously (`choose-agents.page.ts:66,203`), so a second click cannot land mid-load. The `loading` flag drops to false before the recommendations load restarts (`:220-223`), a harmless one-frame flicker. The tests assert real behaviour, including call counts and error copy. The `?analysis=` handling and Retry do not race: `ngOnInit` is awaited once and Retry only becomes available after it finishes.

### New findings

**N5. MINOR - A1 stale `?analysis=` slug survives a failed list and is applied by Start analysis** (Owner: Codex)
- File: `analyze-workspace.page.ts:115,130-132,146`.
- Scenario: the URL has `?analysis=old` and the list fails, so `pendingAnalysis` stays set. The user ignores Retry and clicks Start analysis. After the run, `startFresh` calls `loadSaved()`, which finds the slug in the list, selects the old analysis and rewrites the URL to it. This overrides the fresh result.
- Fix: clear `pendingAnalysis` in `startFresh` and `continuePrevious`.

**N6. MINOR - A1 errors from `useSaved` inside `loadSaved` show "Saved analyses could not be loaded"** (Owner: Codex)
- File: `analyze-workspace.page.ts:132-133`.
- A rejection from `router.navigate` inside the `try` is reported as a list failure, and the slug is already cleared, so Retry only re-lists. Very unlikely and low impact.

### Score and verdict

Score: 8.5/10. N1-N3 are fixed with tests that assert the behaviour. N5 and N6 are minor and non-blocking. N4 is deferred by decision.

Verdict: **APPROVED**

## Visual fix review

Scope: `git diff` against `ac13a61be` for the six onboarding components, their specs and the analyze fixtures. Read-only; no checks run. Comparison read: `GenerationPreviewStore` (`setup-wizard/.../generation-preview.store.ts`).

### Findings

**V1. MODERATE - A row Preview that is confirmed silently replaces the whole selection** (Owner: Codex)
- File: `analyze/choose-agents.page.ts:253-256` (confirmPreview), `:236-243` (openPreview).
- Scenario: the user selects 5 agents, clicks Preview on one row (selected or not), then confirms the dialog. The dialog has the row's single agent in it, so confirm generates only that agent. `store.clearAgents()` + `toggleAgent(ids[0])` run before `submit`, so the checkboxes drop to 1 agent. If submit then fails (`submitError`) or the host replies `preview-required`, the user returns to a list that no longer holds their selection. Nothing in the list says that Preview is "preview and generate this one".
- Consent: generation only starts from the dialog's confirm, so it is not started without a click. The selection change is the unconsented part, and it happens before the outcome is known.
- Fix: move the alignment to after a successful `runId` result, or restore the previous selection on failure. Better, keep the selection intact and pass the id list to `submit` instead of mutating the store. Alternatively make a row Preview read-only (confirm label "Close").

**V2. MODERATE - The row-wide click target for selecting was removed** (Owner: Codex)
- File: `analyze/agent-recommendation-list.component.ts:98-114`.
- `<label>` became `<div>`. Only the 16px checkbox now toggles; clicking the agent name or description no longer does, and `cursor-pointer` was dropped too. For a "pick agents" list this is a usability regression introduced by D8. No test asserts it either way.
- Fix: keep the name/description in a `<label>` (or `for` the checkbox) and put the Preview button outside it.

**V3. MINOR - Stale row state after a cancelled row preview** (Owner: Codex)
- File: `choose-agents.page.ts:226-227,238-239,246-248`.
- After a row preview is cancelled, `previewIds`/`previewingRow` keep the row values. The only entry points are `openPreview` (which resets both) and the owner-conflict retry `(retry)="openPreview()"` (also resets), so it is not reachable today. It is a latent trap for the next caller of `confirmPreview`. Reset in `(dismissed)`.

**V4. MINOR - `loadSaved` no longer contains `useSaved` errors, so `ngOnInit` rejects and skips `getResumableRun`** (Owner: Codex)
- File: `analyze-workspace.page.ts:128-139,112-118`.
- The N6 fix is correct (a navigate failure no longer shows the list error; `pendingAnalysis` and `savedError` stay consistent). But the rejection now propagates out of `ngOnInit` as an unhandled rejection, and the `interrupted` banner check is never reached. The new spec codifies the rejection (`rejects.toThrow`). Same for `startFresh` after the run. Low likelihood (a router rejection). Suggest catching in `useSaved` and setting `selectError`.

**V5. MINOR - Saved card is hidden until the list resolves** (Owner: Codex)
- File: `analyze-workspace.page.ts:68` (`@if (savedError() || visibleSaved().length || selectError())`).
- Correct for D-empty-state, but the card appears after the async list, so it can shift layout below the fold. Cosmetic.

**V6. MINOR - Test gaps**
- `choose-agents.page.spec.ts:77-86` asserts the alignment calls but not that selection is unchanged on cancel, on `submit.next=false` (changed preview) or on submit error. That is exactly V1, so the V1 behaviour is untested. It also does not assert `submit` receives the aligned selection.
- `onboarding-stepper.component.spec.ts` skipped-glyph test compares `svg.innerHTML` to a sibling that may be an unrelated element; it passes if both lack an svg (`undefined`). Low value.
- `agent-recommendation-list.component.spec.ts` selects `[data-agent-id] button` (first button); fine today, fragile if another button is added to the row.

### Focus answers

1. Row Preview (D8): confirm is required to generate (OK). It does not conflict with "Preview and generate": `openPreview()` resets `previewIds`/`previewingRow` every time, the overwrite-preview token is minted by the store per `open`, and `preview-required` reopens with the same `ids` and `keepTarget=true` (`:263-266`). `submit` reads `store.selection()` (aligned), consistent with `ids`. Destroy guards are present after each await (`:250,258,262,266`), and the dialog's error path (`confirm` after `error` -> `load`, "Generate without preview") works with row ids. Gap: V1, V3.
2. N5 fixed: `startFresh` and `continuePrevious` clear `pendingAnalysis` (`:142,148`), and a spec asserts `selectAnalysis` is not called. N6 fixed (V4 is a residue). N1-N3 still hold: `retryLoad` reruns the list/select/recommend chain, `'failed'` maps to the retryable copy, `?analysis=` still runs after a successful list, and the destroy guards remain after each await. No regression found.
3. Shared components: `RunPanel.continueLabel` defaults to `'Continue'`, so other callers are unchanged. In `libs/frontend/onboarding` the only users of run-panel, details-log and the stepper are the two analyze pages (grep). The details-log pluralization changes the visible count text, with its own spec updated; no other consumer matches on it. The stepper `skipped` icon only affects skipped steps.
4. Landmarks: `analyze-workspace-title` and `choose-agents-title` exist on the `<h1>` in the always-rendered header of each page, and are unique to one page at a time. `<main>` -> `<section aria-labelledby>` assumes the shell supplies `<main>`; I did not verify the shell.
5. Tests: markup-only for the agent list (button label, class) and stepper skipped; behavioural for N5, the list-error, row preview call wiring and the continue label. The gaps are in V6.

### Score and verdict

Score: 7/10. The items asked about (N5, N6, destroy guards, shared defaults, ids) are correct. The D8 row Preview mutates the user's selection before the outcome is known (V1), and the row-click target regression (V2) is a new defect from the same item.

Verdict: **REVISE** (V1 and V2 Moderate; V3-V6 non-blocking).

## Visual fix re-review (revision 1)

Scope: `git diff` against `ac13a61be` for `libs/frontend/onboarding/src/lib/` (analyze store, the three analyze components, their specs, stepper spec). Read-only; no checks run. Run results are the lane's own report (3 of 3 tasks succeeded), not re-verified.

### Status of earlier findings

| Item | Status | Evidence |
| ---- | ------ | -------- |
| V1 selection preserved | FIXED | `analysis-step.store.ts:121` adds `agentIds` defaulting to `[...selectionValue()]`; `:129` sends it to `startAgents`. `choose-agents.page.ts:258,265` pass `ids` only when `previewingRow()`; `clearAgents`/`toggleAgent` are gone from `confirmPreview`. The selection stays unchanged on confirm, dismiss, `submit:false`, returned error, thrown error and `preview-required` (`:271` reopens with the same `ids`). |
| V1 earlier submit fixes kept | OK | Binding check after `bind()` at `store.ts:122-125`, previous-run/rejection/error capture at `:126-128`, stale `acceptedRun` comparison at `:131`, identity comparison of rejection/error at `:133-135`. Only the `startAgents` argument changed. |
| V1 "Preview and generate" unchanged | OK | `openPreview()` with no id uses the selection (`page.ts:240`), `previewingRow=false`, and `submit(..., undefined)` falls back to the store selection. Destroy guards at `:260,266,272` and the `finally` guard at `:281` are intact. The thrown-error catch at `:279-281` is new and safe. |
| V2 label click target | FIXED | `agent-recommendation-list.component.ts:106-164` wraps the checkbox, icon, name and description in one `<label class="cursor-pointer">`. The Preview `<button>` is a sibling at `:165`, so no button is inside a label and the markup is valid. A label click makes one `change` on the checkbox, so there is no double toggle. |
| V3 dismiss reset | FIXED | `page.ts:113` routes `(dismissed)` to `dismissPreview` (`:250-254`), which calls `cancel()` and clears `previewIds` and `previewingRow`. |
| V4 ngOnInit after router rejection | FIXED | `analyze-workspace.page.ts:143-145` catches in `useSaved` and sets `selectError`. `savedError` is only set in `loadSaved:130`. `ngOnInit:120` still runs `getResumableRun`. The saved card still shows for `selectError()` (`:68`). |
| V6 tests | FIXED | `choose-agents.page.spec.ts` asserts the ids passed to `submit`, the unchanged selection, and that `clearAgents`/`toggleAgent` are not called, across the dismiss, error, throw and `submit:false` cases. `analysis-step.store.spec.ts:75-80` asserts `startAgents(['agent-b'])` with the selection unchanged. The list spec asserts name and description clicks toggle, Preview does not, and `label.contains(button)` is false. The stepper spec asserts the SVG path. The analyze-workspace spec asserts `selectError` set, `savedError` false and `getResumableRun` called. |

### N1-N6 and destroy guards

No regression found. `startFresh`/`continuePrevious` still clear `pendingAnalysis` (`analyze-workspace.page.ts:148,156`). Destroy guards remain after each await in `ngOnInit`, `loadSaved`, `useSaved` and `confirmPreview`.

### New findings

1. **MINOR** - `choose-agents.page.ts:255-261`: a `submit:false` result or a `preview-required` reopen leaves `previewIds`/`previewingRow` at the row values. This is correct, because the dialog stays open for the same ids. Every later entry (`openPreview`) resets them, so there is no defect today. Informational only.
2. **MINOR** - `choose-agents.page.spec.ts` (V6 cases): `store` and `preview` are mocks, so the "selection unchanged" assertions mostly prove that the page no longer calls `clearAgents`/`toggleAgent`. They do not run the real store with `GenerationWorkflowStore.startAgents` honoring the ids. The store spec covers the pass-through with a mocked generation store. This is adequate, but no end-to-end check shows that the host accepts a single-id start when the selection is different. Suggest a harness scenario if one is cheap.
3. **MINOR** - `agent-recommendation-list.component.ts:112`: the checkbox keeps `aria-label="Select <name>"`, which overrides the label text as its accessible name. That is fine. Style indentation of the nested `<span>` at `:120-163` is off; this belongs to the style reviewer.

No Blocking, Serious or Moderate findings.

### Score and verdict

Score: 9/10. All of V1-V4 and V6 are resolved with matching behavioural tests, the earlier submit fixes are intact, and the existing flow is unchanged. One point is held back because the selection-preservation tests rely on mocks (finding 2).

Verdict: **APPROVED**
