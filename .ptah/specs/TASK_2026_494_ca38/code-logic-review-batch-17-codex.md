# Batch 17 independent logic review

Score: 10/10.

Verdict: APPROVED.

Reviewed the uncommitted component/config-gate diff and the new Apps-tab spec against Task 17.1, the approved config-gate deviation, the B16 late-host-config ruling, implementation-plan.md:335-357, batch-17-report.md (including its superseding follow-up), and prototype/README.md. Paths below are relative to the worktree root.

| Check | Ruling and file:line evidence |
| --- | --- |
| 1. Scope and placement | PASS. `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:124` gates the tab row on workspace folders; the new button at `:137` occupies only the former comment slot between Chat and Tasks. The production diff otherwise adds only the icon import (`:39`), icon field (`:394`), and handler (`:415`). No existing markup or behavior moved. |
| 2. Tab contract and actual navigation | PASS. `electron-shell.component.ts:137` (same directory) mirrors Tasks at `:148`: role, classes, active/selected bindings, title, icon dimensions, and click pattern. `:415` calls `setCurrentView('apps')`. `libs/frontend/core/src/lib/services/app-state.service.ts:902` delegates through `requestSurface` (`:513`), as does the SWITCH_VIEW receiver (`:307`, `:958`). `libs/frontend/core/src/lib/routing/surface-router.service.ts:116` resolves the registered ID and calls `navigateByUrl` (`:131`). Apps is registered in `libs/shared/src/lib/types/webview-surface.types.ts:76`; `apps/ptah-extension-webview/src/app/app.routes.ts:161` matches it and lazily imports `AppsPageComponent` at `:167`. The workspace shell's outlet is `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:48`, visible for non-chat surfaces via `app-shell.component.ts:165`. Existing routing specs explicitly cover Electron SWITCH_VIEW landing/loading (`apps/ptah-extension-webview/src/app/webview-routing.spec.ts:468`) and actual lazy-export resolution (`:630`). |
| 3. Non-vacuous spec pins | PASS. `libs/frontend/chat/src/lib/components/templates/electron-shell.apps-tab.spec.ts:118` retains the real shell template while stubbing child components. `:134` checks exact titles, visible text and five tabs; `:156` removes folders, checks both tablist and Apps absence, then restores folders and checks presence; `:167` clicks the rendered button and asserts exactly one call with apps and no layout change; `:174` drives the signal through chat/apps/tasks, checking aria-selected and exclusive active class. Missing elements fail these assertions; the tests do not replace the handler or template. |
| 4. Approved config-gate edit | PASS. `libs/frontend/chat/src/lib/components/templates/electron-shell.config-gate.spec.ts:197` is the only changed test. At `:207`, `:214`, `:221`, and `:228`, the exact assertions retain order/text/selection/count coverage with Apps second, five selected-state entries (one true, four false), and length five. This matches the approved deviation's intended array, without weakening assertions. The other 13 tests are unchanged in the diff. |
| 5. No alpha base-content regression | PASS. No numeric `text-base-content/NN` class occurs in the component. Added button/icon classes are at `electron-shell.component.ts:139` and `:145`; the rendered-class assertion is at `electron-shell.apps-tab.spec.ts:147` (both under the templates directory above). The source ratchet uses this numeric pattern at `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts:52` and excludes spec files at `:108`. The new spec's regex cannot cause a ratchet failure. |
| 6. Host refusal, failures and missing requirements | PASS. `apps/ptah-extension-webview/src/app/app.html:54` renders the shell only when `isElectron()` is true; `app.ts:58` derives that flag from the same service used by `electron-only-surface.guard.ts:20`. `apps/ptah-electron/src/preload.ts:34` synchronously exposes configuration with `isElectron: true` at `:36`; `libs/frontend/core/src/lib/services/vscode.service.ts:171` reads it. Thus the non-Electron refusal cannot be triggered by this shell's Apps button. Existing connectivity/loading gating remains at `app-state.service.ts:639`; failed lazy navigation is caught/logged at `surface-router.service.ts:136`, and selection follows settled NavigationEnd (`:77`, `app-state.service.ts:580`), not an optimistic Apps flag. No new silent failure or missing Batch 17 requirement found. |

## Numbered findings

None. No correctness defects requiring severity or corrective file:line findings were identified.

## Exact fix list

None.

## Verification

Ran `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/templates/electron-shell --maxWorkers=2`, with output tailed: **4 suites passed, 24 tests passed**. No source, spec, or config edits and no writing git commands were performed. Navigation integration and the alpha ratchet were inspected, not rerun. The documented 249-error chat spec-tsc baseline was accepted, not independently rerun. Rendered dark/light visual review remains the separately assigned review; this verdict covers logic and correctness only.

Summary: Batch 17 correctly adds the workspace-gated Electron Apps tab, preserves existing navigation behavior, and provides meaningful regression coverage.
