# Batches — TASK_2026_317

## Batch 1 — the prompt carries the real session id ✅

- `SdkPermissionHandler.createCallback` gains `sessionIdResolver`; a
  `resolveSessionId()` helper prefers the live SDK id and falls back to the
  build-time routing id. Applied to the permission, AskUserQuestion and
  ExitPlanMode branches.
- `SdkQueryOptionsBuilder`: `QueryOptionsInput.sessionIdResolver`, threaded to
  `createCallback`.
- `SessionQueryExecutor.executeQuery`: binds it to `rec.realSessionId`.
- `PermissionHandlerService.cleanupSession` (frontend) widened to match on
  `tabId` as well as `sessionId`, mirroring the backend's
  `PendingResponseRegistry.cleanupBySession`. Without this, aborting a surface
  workflow left its cards on screen and answerable.

Tests: 5 new in `sdk-permission-handler.spec.ts` (live resolution for both
prompt kinds, `listPendingQuestions` findable by real id AND correlation id,
pre-`init` fallback, non-UUID rejection); 1 in
`sdk-query-options-builder.spec.ts`; 1 in `permission-handler.service.spec.ts`.

## Batch 2 — the router understands correlation ids ✅

- `StreamRouter.interactiveSurfaceOwning` — resolver over
  `WorkflowSessionClaimService`, gated on `surfaceRegistry.isInteractive`.
- Consulted by `routeQuestionPrompt` and `routePermissionPrompt` after the tab
  lookup and before the session lookup.
- `ChatViewComponent.isClaimedByWorkflowSurface` delegates to that same method
  so the active-tile fallback stands down for — and only for — prompts an
  interactive surface owns.

Tests: 4 new in `stream-router.service.spec.ts` — question and permission by
correlation id alone, non-interactive claim still auto-answers, and a live
bound tab still beats a claim.

## Batch 3 — the watchdog stops charging thinking time ✅

- `NoActivityWatchdog.hold()` / `release()` / `isHeld`, reference-counted;
  `arm()` is a no-op while held; `release()` starts a FULL fresh window; both
  inert after `stop()`; a `start()`-less release cannot arm anything.
- `ActivityHold` interface exported from `helpers/`.
- `SdkQueryOptionsBuilder` wraps `canUseTool` in hold/`finally`-release when a
  hold is supplied; unchanged identity when it is not.
- `SessionQueryExecutor` passes the watchdog as the hold.

Tests: 7 new in `no-activity-watchdog.spec.ts`; 3 in
`sdk-query-options-builder.spec.ts` (hold spans the call, releases on throw,
no wrapper without a hold).

## Batch 4 — one source of truth for the current view ✅

- `WebviewNavigationService.currentView` → `computed(appState.currentView)`.
- `updateNavigationState` records `previousView` from the live view.

Tests: 4 new in `webview-navigation.service.spec.ts`, including the exact
Resume-New-Project sequence.

## Batch 5 — stress pass over EVERY Setup Hub workflow ✅

Raised after the report that this hit "all the workflows in our setup page",
not just New Project. Audit first, then a suite per shape.

**Audit.** Four cards, and they are four genuinely different shapes:

| card               | host                      | claims a correlation id          | surface       |
| ------------------ | ------------------------- | -------------------------------- | ------------- |
| New Project        | `HarnessWorkflowService`  | yes (not a tab)                  | interactive   |
| AI Team Builder    | `HarnessWorkflowService`  | yes (not a tab)                  | interactive   |
| Workspace Analysis | `SetupWizardStateService` | no                               | background    |
| Tribunal           | `TribunalRunService`      | yes — its **conductor TAB's** id | never adapted |

Findings:

- **Both harness modes** share one code path (`surfaceMode: true` appears
  nowhere else in the frontend), so New Project and AI Team Builder had the
  identical prompt defect. Both fixed by batches 1–2.
- **Workspace Analysis is correct as-is.** Its phases run through
  `SdkQueryRunner`'s `oneShot` mode — `bypassPermissions`, no `canUseTool`
  (`sdk-query-runner.service.ts:9`) — so they cannot raise a prompt at all.
  Registering the phase surfaces non-interactive is right, and auto-answering
  a stray prompt is the intended full-auto behaviour.
- **Tribunal was a live hazard in the first cut of batch 2.** It claims its
  conductor TAB's id against a `SurfaceId` it never registers an adapter for —
  the claim is a marker, and the conductor is a normal chat tab. A raw
  "is it claimed?" check in `chat-view` would have suppressed the conductor's
  own prompts on every tile but the one matching by id. Fixed by promoting the
  router's interactive-gated resolver to public and having `chat-view` call it
  instead of reading the claim map itself — one rule, one implementation.
- **All four cards navigate through `WebviewNavigationService`**, and all four
  are reachable from the navbar's Setup tab, so the stale mirror broke every
  one of them. That is the "all the workflows" symptom.

New suite `stream-router.setup-surfaces.spec.ts` (18 tests) walks all four
shapes: harness pre-`init` / post-`init` / permission / reload-with-stale-
correlation-id / no-leak-onto-a-stranger-tab (×2 modes), wizard keeps
auto-answering and auto-denying even with a stray claim, Tribunal routes to its
TAB and is explicitly NOT reported as surface-owned, plus two cross-talk cases
(two workflows live at once; a released claim stops routing).
`webview-navigation.service.spec.ts` gained a `describe.each` over all four
cards × two ways of leaving the view (navbar tab, host `switchView`).

## Verification

`nx run-many -t typecheck` across `agent-sdk`, `chat-routing`, `chat-streaming`,
`chat`, `core`, `harness-builder`, `setup-wizard`, `tribunal-panel`,
`rpc-handlers`, `cli-agent-runtime` — clean.
`nx run-many -t test` across the eight touched/adjacent libs — 3629 passed,
3 skipped, 0 failed. `nx lint` — 0 errors.

**Mutation-tested** — every fix was reverted in place to confirm the new tests
actually fail without it:

| reverted                   | failures                                                  |
| -------------------------- | --------------------------------------------------------- |
| claim lookup in the router | 7 — exactly the pre-`init` correlation-id cases           |
| `sessionIdResolver`        | 3 — both prompt kinds + `listPendingQuestions` by real id |
| `canUseTool` hold wrapper  | 2 — hold spans the call, releases on throw                |
| `hold()` → no-op           | 5 of the 7 watchdog cases                                 |
| nav `currentView` mirror   | 12 — **all four Setup Hub cards, both exit routes**       |

## Not done — needs a device

End-to-end confirmation in the running Electron app: start a New Project, let
the question sit past three minutes, answer it in the New Project panel; then
repeat for AI Team Builder. Everything above is unit-level.
