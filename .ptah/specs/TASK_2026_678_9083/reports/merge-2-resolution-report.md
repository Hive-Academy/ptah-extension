# PR #735 merge resolution: Setup Hub

Resolved the two conflicted Setup Hub files against `MERGE_HEAD` (`origin/main`, 3c153c574). The final file diff from main contains only the Electron Command Center entry and its two tests, plus the imports and test providers they need.

## Conflict hunks

| Hunk | Main changed | Branch changed | Resolution and reason |
| --- | --- | --- | --- |
| Component, injected services | Removed direct `HarnessRpcService` and `HarnessWorkflowService` injection as the Hub now delegates builder entry to `HarnessWorkflowRequestService`. | Added `VSCodeService` for the Electron gate beside the old workflow injection. | Kept main's service removal and request adapter. Added only `VSCodeService`; the Command Center route remains a direct `AppStateManager.setCurrentView` navigation like Tribunal. |
| Spec 1, imports | Replaced the old intake-focused dependencies with the compact adapter test dependencies. | Added `ChangeDetectorRef` and `VSCodeService` to the old dependencies. | Kept main's imports and added the two Command Center dependencies. Old RPC, workflow, router, and profile test imports were not restored. |
| Spec 2, suite state | Introduced running/resumable signals and an adapter stub with hub warning/error methods. | Added an Electron host stub to the old suite state. | Kept main's adapter signals/stub and added a host stub and navigation spy for the card tests. |
| Spec 3, setup | Reset main's adapter mode signals and initialized its adapter stub. | Initialized the Electron host in the old setup. | Preserved the signal resets and adapter initialization; initialized the host and navigation spy alongside them. |
| Spec 4, providers | Registered main's request service stub and a lightweight `AppStateManager` stub. | Added a `VSCodeService` provider to the former router-based fixture. | Kept main's providers and supplied the host stub; exposed its `setCurrentView` mock for routing assertions. |
| Spec 5, test body | Replaced the old intake suite with tests for adapter handoff, cancellation/failure alerts, validated intake, confirmation, resume, and dismissible errors. | Added two Electron Command Center card tests to the old intake suite. | Kept every main test intact and inserted the two card tests into main's fixture. No old tests that assert obsolete direct start behavior were restored. |

## Main change preservation checklist

From the main-side diff against the merge base:

- [x] Removed Hub injection/imports of `HarnessRpcService` and `HarnessWorkflowService`.
- [x] Added persistent hub warning and error alerts with dismiss buttons and matching service-backed fields/methods.
- [x] Updated the conflicting-run confirmation wording and action to open builder leave choices (Save as draft, Discard, Cancel).
- [x] Derived New Project resumability, running label, and Configure Harness conflict from request-service mode queries.
- [x] Routed Configure Harness entry and New Project resume through `requestAndNavigate`, with shared landed/resumed/cancelled/failed outcome reporting.
- [x] Passed validated intake directly through the request adapter for both normal start and conflicting-run confirmation; retained the new failure and loading behavior and removed direct `startNewProject`/agent abort calls.
- [x] Retained main's compact spec fixture, running/resumable signals, adapter stub, alerts, and all nine main tests: Configure handoff, cancelled switch, failed navigation, validated intake, conflict confirmation, confirm cancellation, resume, stale-error dismissal, and persistent alert dismissal.
- [x] Kept main's card grid, existing cards, configuration section, markup, and styles. The final diff from main contains only Command Center additions and necessary imports/fixture wiring.

## Command Center adaptation

The Electron-only card sits after Tribunal in main's primary card grid. It uses the existing gradient/card classes, microphone icon, accessible button role and Enter handling, and `data-testid="command-center-card"`. `VSCodeService.isElectron` controls its visibility. `openCommandCenter()` uses `AppStateManager.setCurrentView('command-center')`, matching main's direct navigation for non-builder pages. The tests cover click and Enter navigation, card text/accessibility, and hiding in VS Code; `ChangeDetectorRef.markForCheck()` refreshes the OnPush component after changing the host stub.

## Verification

`npx jest -c libs/frontend/harness-builder/jest.config.ts libs/frontend/harness-builder/src/lib/components/setup-hub.component.spec.ts --coverage=false --maxWorkers=2`: **Test Suites: 1 passed, 1 total; Tests: 11 passed, 11 total.** One run only. `git diff MERGE_HEAD --check` found no whitespace errors; a marker search found no conflict markers.

## Decisions

- Used main's files as the resolution baseline so every main change remains present.
- Preserved main's builder navigation through the adapter; Command Center is a page route and uses the existing direct page navigation method.
- Kept the report separate from the two requested source edits.

## Not done

No staging or commit was performed; the orchestrator handles those steps. No Nx, TypeScript, build, serve, or other Jest run was performed, per task constraints.
