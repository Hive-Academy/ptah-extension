# Code Logic Review — B3b Phase 2 (TASK_2026_ONBOARDING)

Score: 6.5/10. Verdict: REVISE (0 blocking, 3 serious, 5 minor).

Scope: read in full `generate-agents.page.ts`, `project-guidance.page.ts` and `analyze-done.page.ts`. Read the `generation-workflow.store.ts` diff and its `bind`/`refresh` paths. Read the route and step-link diffs. Skimmed the spec titles and the key A4 specs. I ran no tests (a verify was already running).

## Findings

### Serious

1. **A4 silently drops to an idle "Start guidance" state when the authoritative lookup throws.**
   - `project-guidance.page.ts:135-139`: `catch { return; }` leaves `binding` set but never calls `bindGuidance`, and sets no recovery or error.
   - The workflow store stays unbound and idle, so the run panel shows "Ready to create guidance" with a Start button (line 39). The user sees a normal idle page, not an error.
   - If a run is in fact in flight, Start can create a second run (carry a, "never a second run").
   - Fix: set a recovery/lookup-error state with Retry, or bind with no expected run and let `lookupExhausted` handle it. Add a spec for a rejected `getBoundRunState`.

2. **A4 never adopts a handoff run that arrives after init, and the idle Start button stays live while a `manualContinue` could be in flight.**
   - `project-guidance.page.ts:133-134` reads `handoff.started()` once, and there is no effect that watches it.
   - Carry b is met only for auto-start (line 153 requires `pending`).
   - If the page loads while `started()` is momentarily null, the lookup returns no run, and a later `started()` is ignored. The page stays idle, and Start (line 39, 185) calls `startGuidance` with no check on handoff state. That can double-start.
   - The spec `does not double-start...` (spec:89-92) only asserts that render does not auto-start. It never exercises the Start button or a late `started()`.
   - Fix: guard `start()`/hide the Start button while the handoff outcome is in flight. Optionally add an effect that binds to a late `started()` for this tab when no run is bound.

3. **A3 Continue gives no feedback when `manualContinue` fails.**
   - `generate-agents.page.ts:~172-179` (`continueGuidance`): if `manualContinue` ends in `manual-recovery` or does not set `started`, nothing navigates and nothing is shown.
   - The user clicks "Continue to guidance" and nothing happens. This is a failure that looks like an inert button.
   - Also, `goGuidance` is used with a pre-existing `started()` without checking `started.workspacePath` or whether the started run belongs to this workspace.
   - Fix: on `manual-recovery`, show an error or fall back to navigating to A4 with only `tab`, so A4 can offer its own Start.

### Minor

4. **A5 "Tribunal" button is a relabelled Chat route.** `analyze-done.page.ts:81` navigates to `/chat`, and the `done-tribunal` test id sits next to Open chat.
   - Plan line 709 requires a "Tribunal" link, but the Tribunal view is retired. Falling back to chat is defensible and reversible, and the implementer documented it.
   - The button is still misleading: its label promises Tribunal, and it does not call `setCurrentView`. Either label it by what it does ("Ask the panel in chat") or drop it with a recorded plan deviation. Do not block on it.
2. **A5 reports guidance "on" when the run status is `completed`** (`analyze-done.page.ts:34`). A completed run whose saved guidance the user then disabled shows "on". Use the saved-guidance `enabled` status.
3. **A5 marks onboarding completed unconditionally in `ngOnInit`** (`analyze-done.page.ts:62`). A deep link to `/onboarding/analyze/done` without prior steps sets `completedAt`. This matches the plan wording, but it is worth a guard such as a `gen` param.
4. **`lookupExhausted` is not cleared when the page is destroyed.** The flag is cleared only on `bind`/unbind/successful lookup (`generation-workflow.store.ts:78,94,110,324`). It is set only on the expectedRunId path (`:315-321`). That path needs a bind with a run, which the pages always perform, so impact is low. It cannot trigger without `?run`, so a page without a run never shows the Retry panel for lookup failure. See finding 1.
5. **Auto-start when `accepted.tabId !== tabId` silently does nothing** (`project-guidance.page.ts:158-164`), and the page stays idle with Start available.

### Checked and fine

- DestroyRef `destroyed` guards follow every await in all three pages. `A3 retryRun`/`resume` and `A4 loadContent`/`download` have no guard after the final await, but they do nothing after it.
- Section roots are `<section aria-labelledby>`.
- `lookupExhausted` resets on `bind`, `unbind` and a successful lookup, and is set on the fourth failure (`failures<3` branch then else). Retry (`refresh`) re-runs the lookup. It is not blocked, since `runMismatch` is false.
- The URL `?run` is mismatch-checked via `expectedRunId`; the stale-run recovery is shown. The mismatch path is covered by specs.
- Route identity: A3 to A4 uses `tab` = guidance tab, `gen` = agent tab, `run` = handoff run (`generate-agents.page.ts:goGuidance`). A4 persists `run` into the URL with `replaceUrl` (`:148`).
- The A3 navigation effect is deduplicated by `navigatedRun`.

## Acceptance checklist

| Item | Status | Evidence |
| --- | --- | --- |
| A3 lifecycle rows on reload (8 states) | met | `it.each` at generate-agents spec:62; `runTitle` covers every state |
| Stop enabled during `starting` | met | `generate-agents.page.ts:39-41` |
| Cards from `agentOutcomes`/`counts` with `fileName` | met | `:51-57`, spec:78 |
| Countdown Start now / Skip | met | `:64-72`, spec:98 |
| Handoff routes to A4 with `tab`/`run`/`gen` | met | `goGuidance`, spec:107 |
| A4 rebind order `?run`, `started`, authoritative | met | `project-guidance.page.ts:132-139`, specs:60-79 |
| A4 auto-start only when none exists and outcome is not `manual-recovery` | met | `:153-154`, spec:85 |
| Skip to A5, Retry on failure, Continue on done | met | `:36-37,196-197`, spec:128,147 |
| Stop, reload and owner conflict for every guidance run | met | `:35,42-44`, spec:117 |
| Detected stack from status | met | `:45,171-172` |
| Summary card with four rows, "N of 4", no tokens/fallback | met | `:54-64`, spec:97 |
| Counts hidden in the specified cases | partial | The `sections` computed (`:100-106`) gates on run state, same run, `committed` and `enabled`. The read-before/after and `generatedAt` conditions live in the Phase 1 store. Spec:105 covers 4 cases |
| A5 sets `completedAt`, Open chat posts `SETUP_WIZARD_COMPLETE` | met | `analyze-done.page.ts:62,79`, spec:32-45 |
| Routes (`analyze/generate`, `analyze/guidance`, `analyze/done`, `guidance`) | met | `onboarding.routes.ts`, routes spec |
| Carry (a) rebind order, never a second `runWizard` | met | The matching-`started` path calls no `runWizard` (spec:66). Finding 2 notes a gap through the Start button |
| Carry (b) cleared `started()` not treated as no run | partial | Auto-start is blocked (`:152-154`). Start button and late-`started` handling are not (findings 1 and 2) |
| Carry (c) `lookupExhausted` after 3 failed lookups, 4th failure sets it, Error + Retry | met | `generation-workflow.store.ts:315-321`, store spec:111, page specs |

## Verdict

REVISE. Findings 1 to 3 are likely-path user-visible failures, with a possible duplicate run in finding 1 and finding 2. They are small fixes. No blocking issues. Fix 1 to 3 and add specs for the rejected lookup and the late `started()`; the rest is acceptable.

## Re-review (round 1 fixes)

Score: 8/10. Verdict: APPROVE (0 blocking, 0 serious, 4 minor). Read-only: I ran no tests or verify. The implementer's own verify never ran (it timed out in the lock queue), so the green state of the new specs is unconfirmed by me. Only the coordinator's scoped verify can confirm it.

### Original findings

1. **Lookup failure silently idle: FIXED.**
   - `project-guidance.page.ts:156-157` now sets `lookupError` and clears `lookupPending` on a throw. The template shows an error and Retry (spec:96-105).
   - `retryLookup` (`:205-208`) re-runs the whole sequence. `start()` is blocked while `lookupError` or `lookupPending` is set (`:230`).
   - The spec asserts the error panel, no Start button, a second `getBoundRunState` call and the re-bind. It exercises the real path.
2. **Late `started()` / in-flight Start: FIXED.**
   - The `inFlight` flag (`generation-handoff.store.ts:21,113`) is set synchronously on entry to `openAndStart` and cleared in `finally`, guarded by `revision`. A superseded call cannot clear a newer call's flag.
   - A4 adds `start()` guards on `inFlight`, `pending`, `boundRunId` and a matching `started` (`:230-231`).
   - A4 also takes a second `started()` read after the lookup (`:159-160`) and a late-adoption effect (`:130-136`) that checks the tab and workspace (`:134`).
   - Specs at spec:89-95, 106-113 and 114-120 exercise the Start guard, adoption without `startGuidance`, and a foreign tab being ignored.
3. **A3 Continue feedback: FIXED.**
   - A manual recovery that landed a tab routes to A4 with `tab` and `gen` and no `run` (`generate-agents.page.ts:189-190`). A missing tab or an exception sets an inline `role="alert"` (`:184,191`).
   - A pre-existing `started` is accepted only for the same workspace (`:182,188`).
   - Specs at spec:114-135 cover all three paths.
4. **Tribunal label: FIXED.** The button reads "Ask the panel in chat" and sets the chat view and posts the completion message (`analyze-done.page.ts:90`). The spec asserts the label, `/chat` and `setCurrentView`.
5. **Guidance fact: FIXED.** Saved `enabled` takes priority over run status and falls back to the run when status fails (`analyze-done.page.ts:34,70-73`). The spec asserts "off (completed)".

### Regression check on the late-`started()` effect

- **No loop.** The effect depends on `started`, `binding` and `lookupPending`. `boundRunId` is a plain field set synchronously in `bindLateHandoff` before any await (`:195`), so the effect cannot re-fire into a second bind. Its recovery writes are not dependencies.
- **No rebind of an already-bound run.** It is skipped when `boundRunId` is truthy (`:133`). That covers `?run` and the matching-`started` paths.
- **Tab and workspace checked.** `:134`.
- **Destroyed guards.** Present after every await in `bindLateHandoff` (`:198,200,202`). The effect itself is torn down with the component.
- **Auto-start overlap (minor).** During the auto-start branch (`:176-189`), `startNow` sets `started()` while `boundRunId` is still null. The effect then binds the same run concurrently (`:192-204`) with the auto-start branch's own `bind`/`navigate`. `workflow.bind` returns early for the same expected run, so there is no second `runWizard`. The result is a redundant refresh and a duplicate replaceUrl navigate, not a defect.

### Handoff store and Phase 1 callers

- `inFlight`/`openedTab` are additive. `begin`/`skip` reset both, and `manualContinue` resets `openedTab`.
- The `try`/`catch`/`finally` now also wraps `launcher.open` and the tab-state checks. A throw there becomes `manual-recovery` instead of a rejected promise. This is a safe behaviour change for callers. It also makes A3's `catch` around `manualContinue` (`generate-agents.page.ts:184`) mostly unreachable with the real store; it is only reached by the spec's mock.
- I did not see the handoff spec diff exercised. Treat the store's own spec as unconfirmed until verify passes.

### New minor findings

1. **A3 Start now with manual recovery is silent.** `generate-agents.page.ts:176`: `startNow` clears the countdown (`pending` is cleared by the store) and navigates only if `started` landed. After a manual recovery nothing is shown. Continue still works, but the user gets no message. Route to A4 via `openedTab`, as Continue does.
2. **A3 `startNow` null-safety.** `started?.workspacePath === this.binding()?.workspacePath` is true when both are undefined, and `started.tabId` would then throw. The binding is always set before the countdown renders, so it is unreachable in practice. Diagnostics were unavailable, so confirm it compiles under strict null checks.
3. **Stuck idle with a pending handoff.** A4 hides Start while `handoff.pending()` is set (`:230`) but auto-starts only when `gen` matches (`:177`). A pending handoff for another agent tab leaves the page with no Start until the countdown fires. The store timer resolves it, so this is transient.
4. **A5 "Tribunal" calls `openChat()` then navigates `/chat`** (`analyze-done.page.ts:90`). It is redundant but harmless. A cancelled guidance run with an earlier-saved `enabled` shows "on (cancelled)".

### Updated acceptance state

Carry (a) met. Carry (b) now met: late `started()` is adopted, the Start button is guarded, and auto-start is gated on `pending`. Carry (c) met.
Recommendation: APPROVE. The next step is to confirm the coordinator's scoped verify passes for `@ptah-extension/onboarding` and `@ptah-extension/setup-wizard`, since I did not run it.
