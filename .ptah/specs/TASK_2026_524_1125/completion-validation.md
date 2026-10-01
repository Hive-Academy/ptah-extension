# Completion Validation — TASK_2026_524_1125

## Verdict: INCOMPLETE

TASK_2026_524_1125 ("Enable Angular Router in the shared webview behind an in-memory PlatformLocation, and make a session addressable") is partially complete. Only **Batch 1** (PR #564, commit `96e3a01d0`) and **Batch 2** (PR #574, commit `11654e367`) have merged to `origin/main`. **Batch 3** (`RouteReuseStrategy` replacing `[class.hidden]`) and **Batch 4** (addressable session/sub-state, `vscode.setState` URL persistence, and `registerWebviewPanelSerializer`) have not been implemented or merged.

## Batches and Acceptance Criteria Status

| Batch / Criterion | Status | Evidence (file:line) |
| :--- | :---: | :--- |
| **Batch 1: Router foundation** | DONE | `apps/ptah-extension-webview/src/app/app.config.ts:150,156`, `apps/ptah-extension-webview/src/app/app.routes.ts:68-175`, `libs/frontend/core/src/lib/routing/memory-platform-location.ts:1-200` (PR #564) |
| **Batch 2: Activity contract (`SURFACE_ACTIVE`)** | PARTIAL | `libs/shared/src/angular/index.ts:15`, `libs/frontend/core/src/lib/routing/surface-active.directive.ts:16`, `libs/frontend/chat-streaming/src/lib/batched-update.service.ts:42,257` (PR #574; canvas consumer deferred to TASK_2026_531_c4a8) |
| **Batch 3: Detach (`RouteReuseStrategy`)** | NOT DONE | 0 occurrences in repo; `apps/ptah-extension-webview/src/app/app.routes.ts:40` notes Batch 3 pending; `app-shell.component.html:47,53,608,637` still relies on `[class.hidden]` |
| **Batch 4: Addressable sub-state & persistence** | NOT DONE | `apps/ptah-extension-webview/src/app/app.routes.ts:73` (`path: 'chat'` component-less, no `chat/:tabId`); `app.routes.ts:124` (Thoth flat route); 0 `registerWebviewPanelSerializer` in VS Code extension |
| **AC 1: Standalone surface navigation in memory** | DONE | `libs/frontend/core/src/lib/routing/memory-platform-location.ts:1-200`, `apps/ptah-extension-webview/src/app/app.config.ts:150`, `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:160-180` |
| **AC 2: Router back/forward in session** | DONE | `libs/frontend/core/src/lib/routing/memory-platform-location.ts:153-180`, `libs/frontend/core/src/lib/routing/surface-router.service.spec.ts:70-90` |
| **AC 3: Webview reload restores surface & active tab** | NOT DONE | `apps/ptah-extension-webview/src/app/app.ts:131-149` only reads host `initialView`; no logical URL saved to `vscode.setState`; `tabId` is not in route |
| **AC 4: VS Code restart restores panel & route** | NOT DONE | `apps/ptah-extension-vscode` has 0 occurrences of `registerWebviewPanelSerializer` |
| **AC 5: One list of surface IDs, allow-lists removed** | DONE | `libs/shared/src/lib/types/webview-surface.types.ts:43-77`, `libs/frontend/core/src/lib/routing/surface-routes.ts:21-31` (`SURFACE_ROUTE_IDS`) |
| **AC 6: Separate chunks for deferred surfaces** | DONE | `apps/ptah-extension-webview/src/app/app.routes.ts:44-66,80-160` |
| **AC 7: CanvasStore survives within chat surface** | DONE | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:51-53,604-611` (retained via `[class.hidden]`) |
| **AC 8: Touched projects pass test/lint/typecheck** | DONE | Verified in PR #564 (`pr564-review-fixes.md:58`) and PR #574 (`coderabbit-pr574-fixes.md`) |

## Remaining Work

1. **Batch 3 — Workspace-keyed `RouteReuseStrategy`:**
   - Implement `PtahReuseStrategy` keyed by normalized workspace root (`normalizeWorkspaceRoot`).
   - Replace CSS hiding (`[class.hidden]`) in `app-shell.component.html` so detached views leave DOM and change detection while keeping DI/store alive.
2. **Batch 4 — Addressable Sub-State & Session Routing:**
   - Introduce `chat/:tabId` route parameters to make sessions addressable via Angular Router.
   - Introduce Thoth sub-tab child routes.
3. **Batch 4 — State Persistence & Panel Restoration:**
   - Persist logical URL to `vscode.setState()` and restore it upon webview bootstrap.
   - Implement `registerWebviewPanelSerializer` in `apps/ptah-extension-vscode` to restore webview panel and route across VS Code restarts.
4. **Deferred Activity Gating:**
   - Complete canvas activity gating (split off to `TASK_2026_531_c4a8`).

## Recommended Registry Status

- **Status:** `in_progress`
- **Labels:** `partial`
- **Rationale:** The task scope explicitly encompasses both enabling the router behind `MemoryPlatformLocation` AND making sessions addressable / persistent across reloads and restarts. While the routing foundation and activity contracts shipped, session addressability (AC3, AC4, Batch 3, Batch 4) remains incomplete.
