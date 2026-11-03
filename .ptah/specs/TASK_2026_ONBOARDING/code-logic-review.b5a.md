# Code Logic Review, B5a (TASK_2026_ONBOARDING)

Score: 8/10. Verdict: APPROVE. 0 blocking, 0 major, 7 minor.

Scope: all B5a diffs read, with the new files (focus router, resume store) read in full. Checks run: none (read-only). The implementer's verification was unfinished. Runs 2-4 in its report were still pending, and run 1 had failures it fixed without a recorded rerun. Do not read this review as proof the specs pass. The coordinator must run verify.

## Verified against the focus list

- **Alias resolution and the three normalisation points.**
  - `resolveSurfaceAlias` (`libs/shared/src/lib/types/webview-surface.types.ts:117`) is the single mapper.
  - Point 1: `AppStateManager.normalizeView` / `normalizeInitialView` (`app-state.service.ts:642`, `:792`). `handleMessage` accepts the legacy ids through `isAcceptedInitialView` (`:366`) and `setCurrentView` normalises (`:985`).
  - Point 2: `SurfaceRouterService.navigateToSurface` resolves the alias (`surface-router.service.ts:152`) and `navigateToUrl` runs `normalizeRestoredRoute` (`:194`, `:231`).
  - Point 3: `initial-navigation.ts:122-128` compares the settled segment against the mapped one.
  - No loop: the legacy route maps to `/onboarding`, and the first-run guard only fires from `/chat`.
- **Query params on legacy restores.** They are dropped on purpose. This matches the plan (A6) and the implementer's decision.
- **Host allow-lists.** `ACCEPTED_INITIAL_VIEWS = [...SURFACE_ROUTE_IDS, ...LEGACY_SURFACE_ALIASES]` still contains the three ids. The VS Code generator reads this list.
- **Host launchers.** `electron-setup-wizard.service.ts:76` and `webview-lifecycle.service.ts:153` now send `onboarding`. The other Electron `SWITCH_VIEW` senders use `orchestra-canvas`, which is unchanged.
- **Notification focus.**
  - `OnboardingFocusRouter` resolves the target from the tab's workflow, using `onboardingGenerationTarget` / `onboardingHarnessTarget` with `tab` identity (`onboarding-focus-router.service.ts:56-77`).
  - It switches workspace first, then navigates, then switches tab.
  - A legacy wire `surfaceKind` maps through `focusRouterKindFor` at both lookup sites in the host handler (`chat-attention-host-message-handler.service.ts:277`, `:409`).
  - The dispatcher and source services look up by `canFocus` only, so they are unaffected.
- **Union widening.** `'onboarding'` is added to `SurfaceFocusRouter['kind']`. The old routers still typecheck because they keep their literal kinds, and `app.config.ts` provides only `provideOnboardingFocusRouter`.
- **Eager entry.** `services.ts` adds only the focus router and its provider. The router imports `chat-state` and `core` only. The resume store is not exported from `services.ts`, so the wide `setup-wizard` and `harness-builder` barrels stay out of the eager graph.
- **Launcher and harness request.** The launcher calls `navigateToSurface('onboarding', subPath, { queryParams })` with `?tab=`. `harness:open-workflow` goes to `/onboarding/<new-project|team-builder>/workspace?tab=` through `onboardingHarnessTarget(mode, tabId, 'workspace')`.
- **Persistence and restore.**
  - `onboardingGenerationBinding` applies only when a `tab` query key is present and the path is a generation page.
  - An invalid or unvalidated binding is rejected on restore (`failed`, falls back to the host view) and not written on persist.
  - Garbage is rejected by the existing `parseWebviewRouteState` plus `isOnboardingIdentityValue`, which refuses `/`, `\`, `:`, arrays and values over 256 characters.
- **Settings and the shell.**
  - Settings has "Run onboarding again" (all hosts, `setCurrentView('onboarding')`) and "Check Claude Code" (Electron only, `openOnboardingReady`, guarded by `canSwitchViews`).
  - The Setup menu item and shell tab use `onboarding` with the `setup-hub` test id preserved and the label "Setup".
  - The coordinator's edit to `electron-shell.apps-tab.spec.ts` (lines 136 and 143, "Setup hub" to "Setup") matches the component title and text, with all six tabs asserted. This is weaker evidence: it comes from the same model family and was not run.
- **Resume store.** Sources are bounded:
  - one `get-resumable-run` pair;
  - at most one bound tab per generation workflow;
  - at most one harness record per mode, each requiring a live tab with the matching workflow.
  The Claude banner renders before the resume block in the Home template. The Home spec asserts the order with `compareDocumentPosition`.

## Findings

1. **Minor. B1 "onboarding is never a restore target" rule removed without disclosure.**
   - Evidence: `surface-route-persistence.ts` (`if (segments[0] === 'onboarding') return;` deleted); the spec `keeps the last route when the Router settles on onboarding` was inverted to `persists onboarding Home as a restorable route`.
   - Scenario: the plan needs onboarding generation URLs persisted (the "persistence validator on new URLs" test). So the change is probably required. But the implementer's Decisions table does not mention it, and it reverses a B1 invariant. A webview closed on `/onboarding/ready` now reopens there.
   - Fix: state the reversal in the report. Confirm with the coordinator that `/onboarding` and `/onboarding/ready` should persist. If not, keep the skip for `segments.length <= 2` and persist only generation and harness identity URLs.

2. **Minor. Missed entry point outside the old libs.**
   - Evidence: `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:782` still calls `setCurrentView('setup-wizard')`. B5b does not own this file in the plan.
   - Impact: it works only because the alias resolves, and it lands on Home.
   - Fix: change it to `'onboarding'` and update the stale comment at `:777-778`.

3. **Minor. Resume-store lookup takes the first tab per workflow only.**
   - Evidence: `onboarding-resume.store.ts` uses `tabs.find(c => c.workflow === workflow)`.
   - Scenario: if the first matching tab is completed or cancelled and a later one is running, no banner shows. This is unlikely, since `findResumableTab` normally keeps one.
   - Fix: iterate the tabs for that workflow and stop at the first resumable run. This stays bounded at one item per workflow.

4. **Minor. `refresh()` has no sequence guard.**
   - Evidence: `onboarding-resume.store.ts` `refresh`, sequential awaits, then `_items.set`.
   - Scenario: a workspace switch or remount during the awaits lets a slower earlier refresh overwrite a newer result with the old workspace's items.
   - Fix: capture a token (or the root) before the awaits and discard the result if it changed.

5. **Minor. `resumeItem` navigates with the raw `Router.navigate`.**
   - Evidence: `onboarding-home.component.ts` `resumeItem`, `void this.router.navigate(...)`.
   - Impact: it bypasses `SurfaceRouterService`, so there is no pending or cancel handling and no generation-tab validator before landing. A failed navigation is silent.
   - Fix: use `SurfaceRouterService.navigateToSurface('onboarding', subPath, { queryParams })` and handle a non-landed result.

6. **Minor. `initial-navigation.ts:122-128` hardcodes the three legacy names.** They duplicate `LEGACY_SURFACE_TARGETS`. Derive the mapping from `resolveSurfaceAlias` so the two cannot drift.

7. **Minor. `requestAndNavigate` pending-intent guard widened.**
   - Evidence: `harness-workflow-request.service.ts:136`, `currentSurface() === 'onboarding'` replaces `'harness-builder'`.
   - Scenario: a stale pending intent while the user is on onboarding Home (not the builder) makes new `harness:open-workflow` requests return `cancelled`.
   - Fix: also require the current URL to be a harness step, or clear the pending intent when leaving the builder pages.

Non-findings and notes:
- The prettier churn in `app.config.ts` and `chat-attention-host-message-handler.service.ts` is formatting only. I checked that the `timeout: 5000` argument was unchanged. It inflates the diff, so a reviewer should read it with `git diff -w`.
- The accepted `ptah-extension-webview:lint` circular dependency is out of scope.
- Remaining `'setup-hub'`, `'setup-wizard'` and `'harness-builder'` references in the old libs, `app.routes.ts` and the e2e support files belong to B5b.

## Specs

- Names match assertions in the `webview-routing`, `surface-router`, `surface-route-persistence`, resume store and Home specs (read in part).
- Gap: no spec covers a legacy saved route that carries a `tab` query. This is acceptable, because those routes are always rewritten to `/onboarding` before validation.

## Round 1

Read-only review of `b5a-fix-r1-report.md` against the code. No checks run. The report records the test run as passing (5/5) and the lint/typecheck run as failing only on the accepted `ptah-extension-webview:lint` circular dependency. I did not verify either.

Per-item status:

| Item | Status | Evidence |
| --- | --- | --- |
| Router "has no route" warning | Fixed | `surface-router.service.ts:152-158`. Setup aliases resolve to `onboarding`, so they do not warn. `orchestra-canvas` resolves to `chat`, and the second clause (`id !== resolved && target === DEFAULT_SURFACE_ID`) still warns, as before B5a. Non-routable ids hit the first clause. The sub-path and query are still dropped when `target !== id`. The spec asserts both cases: the warning for `orchestra-canvas`, and no warning plus `/onboarding` for the three aliases. |
| Minor 2 (clones entry) | Fixed | `skill-clones-view.component.ts:782` now calls `setCurrentView('onboarding')`. The spec asserts the new argument. The test title still says "Open setup wizard", which is only a label. |
| Minor 4 (refresh race) | Fixed | `onboarding-resume.store.ts:31-35, 147`. The sequence is taken before the first await, and only the latest call commits. The no-workspace branch runs synchronously, so it is always the latest. The latest result is not dropped: an older call finishing last is discarded, and a newer call finishing last commits. The spec exercises the older-finishes-last order and asserts the newer result survives. |
| Minor 6 (duplicated alias list) | Fixed | `initial-navigation.ts:124-127`. It uses `isAcceptedInitialView` then `resolveSurfaceAlias`. A saved `/orchestra-canvas` already fails `navigateToUrl` first, so the mapping to `chat` is not reached. |
| Minor 7 (pending intent) | Fixed, with a coverage gap (finding R1-1) | `harness-workflow-request.service.ts:136-141`. The cancel path now requires `currentSurface() === 'onboarding'`, a Router URL matching `^/onboarding/(new-project|team-builder)/`, and an existing source tab. From Home, or any other onboarding page, the stale intent is cleared and the request proceeds. The new spec asserts `resumed` and a null intent. |
| Minor 1 (persistence reversal) | Explanation accepted | The report states the reversal, the spec change, and that Home and `/onboarding/ready` now restore. That is accurate against `surface-route-persistence.ts`. Whether unbound pages should restore is a product call for the coordinator. Not a code defect. |
| Minors 3 and 5 | Unchanged by decision | Still minor. |

New findings:

- R1-1 (minor): no spec covers the in-flight cancel path. In `harness-workflow-request.service.spec.ts` the Router URL is `/onboarding` or `/onboarding` after the test sets it, and there is no `cancelled` assertion anywhere in the file. A regression in the regex or the surface check would pass. Fix: add a case with `angularRouter.url = '/onboarding/new-project/workspace?tab=old'`, a live source tab and a pending intent, asserting `cancelled` with the intent retained.
- R1-2 (minor): the second clause of the warn condition in `surface-router.service.ts:155-156` is hard to read. When the first clause is false, `target` is `resolved`, so the clause only fires for an alias that resolves to `chat`, which means `orchestra-canvas`. Simplify it to `id === 'orchestra-canvas'`, or comment why it exists.
- R1-3 (minor): the regex in `harness-workflow-request.service.ts:139` hardcodes the onboarding flow names. Derive them from `onboardingHarnessTarget`, or from a shared constant, so they cannot drift.

Score: 8.5/10. Verdict: APPROVE. 0 blocking, 0 major, 3 new minors (R1-1 to R1-3), plus minors 3 and 5 carried over.

## Round 2

Read-only review of `b5a-fix-r2-report.md` against `surface-route-persistence.ts` and the two specs. No checks run, so the report's test results are unverified.

Status of the coordinator decision (minor 1): implemented.

- **Guard.** `surface-route-persistence.ts:71-79` applies to every URL whose first segment is `onboarding`. It computes `onboardingGenerationBinding(segments, url.queryParams)` and returns without writing unless the binding is non-null and the `GENERATION_ROUTE_TAB_VALIDATOR` accepts it.
  - A valid generation or guidance tab binding persists.
  - Home, `/onboarding/ready`, start pages, a generation page with a missing, empty, repeated or colon-bearing `tab`, and harness proposal URLs all return early. The binding helper only recognises generation and guidance paths, so harness URLs are never persisted. This matches the decision.
  - A missing validator also skips the write, which is the safe default.
  - Non-onboarding routes skip the block entirely, and the shared parser, seed and `setState` path below it is unchanged.
- **Legacy normalisation.** Persistence sees `urlAfterRedirects`, which is `/onboarding` after the legacy rewrite, so it is not written. The saved record keeps the previous route, which is exactly what the decision asks for. Side effect: a saved legacy route stays in state until a later persistable navigation, so each boot lands on Home again. This is harmless.
- **R1-1.** `harness-workflow-request.service.spec.ts:196-213` asserts the right things. With a live source tab and the URL `/onboarding/team-builder/workspace?tab=old`, the second request returns `cancelled`, the intent is retained, `navigateToSurface` was called once (by the first request), and `start` was not called. The first request goes through the `findRunningTab` branch, which sets the intent and does not call `start`, so the `start` assertion is valid.
- **New specs.** Each asserts what its name says: Home keeps the last route (`/chat/tab-1`, one write); ready keeps it; a valid binding writes `/onboarding/analyze/generate?tab=valid-tab`; an empty `tab=` keeps the last route and the validator is never called, because the helper rejects the value first; a stale tab keeps `/settings`.

New findings: none. One observation, minor: there is no spec for a guidance-only URL (`/onboarding/guidance?tab=...`) or a harness URL staying unpersisted. Both follow from the helper, which has its own tests in the `core` routing specs, so I do not count this as a defect.

Final score: 9/10. Final verdict: APPROVE. 0 blocking, 0 major. Carried over unchanged by decision: minor 3 (the resume store takes the first tab per workflow), minor 5 (raw `Router.navigate` on resume), and the cosmetic R1-2 and R1-3.
