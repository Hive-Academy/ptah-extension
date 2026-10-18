# Implementation Plan - TASK_2026_679_45ff

"Previous sessions" button and modal. The always-visible session sidebar is removed, and the Rail cards gain Rename and Organize (D9).

Prefixes used below: T = `libs/frontend/chat/src/lib/components/templates`, M = `libs/frontend/chat/src/lib/components/molecules`,
O = `libs/frontend/chat/src/lib/components/organisms`, S = `libs/frontend/chat/src/lib/services`,
CV = `libs/frontend/canvas/src/lib`, E = `apps/ptah-electron-e2e/src`, H = `libs/frontend/webview-e2e-harness/src/lib/scenarios`,
W = `apps/ptah-extension-webview/src`. The worktree root is `D:/projects/ptah-extension/.claude-worktrees/previous-sessions-modal`.
Line numbers come from direct reads of this worktree (base `851846797`) on 2026-10-16.

## Inputs and constraints

- Requirements used: `context.md`, `decisions.md` (D1-D12), `task-description.md` (Req 1-10, NFRs, Risks),
  `parity-inventory.md` (A-F, Proposed Removals, E2E section), `design-spec.md` (approved, D11, with amendment D12),
  `design-spec-review.md` (findings 1-5), `prototype/index.html`, `prototype/assets/app.js`, `prototype/assets/modal.css`.
- Corrections applied:
  - D12 overrides the prototype and design-spec 3.6/3.7. The current and open-tab fill and the left accent go on the
    row's `li`, which wraps both the row button and the chips line, not on the row button.
  - Design-spec-review findings 1 and 2 (Moderate) are resolved in components 4, 6, 7 and 9 below.
- Design handoff used: `design-spec.md` §1-§13 and the prototype. The component name `PreviousSessionsModalComponent` and
  the test ids `previous-sessions-modal` and `previous-sessions-list` are used exactly as the design names them.
- Missing decision-critical input: one user decision, Rail Organize availability (Gate 2 review finding 2). It may
  add backend scope, so it is not settled here. See "## Gate 2 choice: Rail Organize availability". Components 1-13
  work under every option; the parts that depend on the choice are marked **[choice-dependent]**. Three places where
  the design differs from the source are settled under Decisions (DP-3, DP-4 and DP-6), and both positions are
  recorded.
- Revision: Gate 2 round 1 (`implementation-plan-review.md`) is applied:
  - finding 1: the organization editor joins the focus-wrap change (component 6, batch B2);
  - finding 2: DP-7 is replaced by the Gate 2 choice section;
  - finding 3: the removed-symbol grep gate is limited to `apps/` and `libs/`.
- Project rules applied: Angular 22.1.7 standalone with OnPush, `inject()`, `input()`/`output()` and signals. Imports
  only through `src/index.ts` aliases. No `class=""` together with `[class]=""` on one element. No `any` or
  `as unknown as`. No `console.*` in libs: moved code that logs today switches to `LoggingService`. Dead code is
  deleted, not shimmed. Scoped checks only.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `canvas` imports `@ptah-extension/chat` (29 import sites), e.g. the Rail card imports `TabManagerService`, `CompactSessionCardComponent`, `SESSION_CARD_ACTIONS` | `CV/canvas-rail/canvas-rail-card.component.ts:13-20`; `CV/orchestra-canvas.component.ts:26` | The dependency direction is canvas → chat. The Rail may inject root services exported by `@ptah-extension/chat`. Chat must never import canvas. |
| The shell renders the canvas through a DI token and `*ngComponentOutlet` because of that cycle | `T/app-shell.component.ts:225-245`; `T/app-shell.component.html:811` | The shell cannot bind outputs of the canvas tree. Rail → shell communication must go through a chat root service, not through outputs. |
| Both libs are tagged `scope:webview`, `type:feature` | `libs/frontend/chat/project.json`, `libs/frontend/canvas/project.json` (tags) | No new edge between libs. The existing canvas → chat edge is reused, so module boundaries are unchanged. |
| Sidebar state and handlers live in the shell: open state, width, resize, search/date signals, filtering, grouping, organizer id, rename, delete | `T/app-shell.component.ts:247-279, 306-320, 327-443, 451-455, 497-653, 787-982` | This is the extraction target. Query state moves to a root store so it outlives the modal (A-11, Req 2.9). |
| The sidebar markup and the `Sessions` tab | `T/app-shell.component.html:99-547` (aside), `:549-556` (tab) | Deleted. The row, states and pagination markup are re-homed in new components. |
| The shell row is retained, never destroyed, and is the inert target | `T/app-shell.component.html:88-98` (`#shellRow`, `*ptahRetainWhile`) | `[attr.inert]` goes on this row while the modal is open. The modal renders outside it, at the shell root. |
| The organization editor and the confirm dialog render at the shell root and are deferred | `T/app-shell.component.html:1-26` | The modal follows the same pattern (`@defer (when …; prefetch on idle)`) and stays out of the eager bundle (`ptah-extension-webview` has a `verify-eager-bundle` target). |
| The organizer state is a `linkedSignal` that keeps the last copy when the row leaves the list | `T/app-shell.component.ts:409-432` | Moved verbatim into `SessionOrganizerService`. |
| Layout-aware open: grid uses `requestCanvasSession` and single uses `switchSession` | `T/app-shell.component.ts:859-865`; `libs/frontend/core/src/lib/services/app-state.service.ts:1247` | Kept unchanged inside `SessionRowActionsService.openSession` (D-1). |
| Rename and delete flows, including the workspace path captured before the confirm | `T/app-shell.component.ts:882-982` | Moved into `SessionRowActionsService`, which the modal rows and the Rail rename both use. |
| `setListQuery` is a no-op for an equal query | `S/chat-store/session-loader.service.ts:475-478` | Remounting the filter bar on reopen sends no `session:list` (Req 2.9, B-13). |
| ChatStore session-list API | `S/chat.store.ts:105-110, 172, 203, 211-217, 220, 243, 247` | The stores read and write only through `ChatStore`. |
| Tab API: `findTabBySessionId`, `findTabByIdAcrossWorkspaces`, `setNameAndTitle`, `closeTab`, `workflowForSession`, `forgetWorkflowSession`, `activeWorkspacePath`; `TabState.claudeSessionId: SessionId \| null` | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:567, 672, 2614, 1341, 963, 970, 860`; `libs/frontend/chat-types/src/lib/chat-types.ts:610, 633, 636` | The Rail resolves tab → session id itself (`claudeSessionId`). A `null` id means the draft is not yet persisted (design 8.5). |
| `ptah-native-popover`: on open it stores `document.activeElement`. On close, and on destroy, it focuses that element if it is still connected. Escape on the host calls `stopPropagation`. The panel uses `position: fixed` | `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:166-178, 236-243, 249-255, 302-309`; `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:152-153` | Basis of the Rail menu → Rename handoff (component 9). The modal panel must not create a containing block. |
| The Rail menu closes by `closeMenu()` (set false, then focus the trigger synchronously) and lists items through `[role="menuitem"]` | `CV/canvas-rail/canvas-rail-card.component.ts:180-240, 341-381, 393-398` | New items reuse this. The Rename form must not use `role="menuitem"`. |
| The organization editor captures `document.activeElement` on open and restores it synchronously in an effect on close. Escape emits `closed` | `M/session-organization-editor/session-organization-editor.component.ts:107-128, 544-575, 752-769` | When the editor closes over an inert panel, that restore can be a silent no-op. The owner of the open must restore focus after render (component 4). |
| The confirm dialog has no role, no initial focus, no Escape handling, no trap and no focus return | `M/confirmation-dialog.component.ts:20-60` | Required a11y additions (design §4.2, §11.2; review finding 1). |
| `ConfirmationDialogService` API: `isOpen`, `options`, `confirm()`, `handleCancel()` | `libs/frontend/chat-state/src/lib/confirmation-dialog.service.ts:27-35, 91` | The modal reads `isOpen` to set its panel `inert`. |
| `afterNextRender` accepts any injector that provides `AfterRenderManager` and `DestroyRef`, including the root environment injector | `node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:4447-4477` (Angular 22.1.7, main checkout `node_modules`) | Root services can schedule focus restore after the render that removed `inert`. This survives the destruction of the modal. |
| Existing in-repo Tab-wrap and inert pattern | `CV/canvas-rail/canvas-rail-board.component.ts:37-55, 83, 735-751` | Same technique (tabbable filter, wrap at the ends). A small chat-local helper serves the modal and the confirm dialog. |
| Document-level Escape listeners exist in canvas | `CV/canvas-rail/canvas-rail-board.component.ts:77`; `CV/canvas-detail/canvas-lane-tabs.component.ts:79, 366-370` | The modal's Escape handler and the inline-rename Escape must call `stopPropagation()` so a background layer does not also close. |
| The Rail footer is presentational (outputs only). The board wires it and owns `newSession()` | `CV/canvas-rail/canvas-rail.component.ts:231-251, 257-342`; `CV/canvas-rail/canvas-rail-board.component.ts:82-112, 265-273, 809-815` | Add one output and one input to the Rail. The board injects the dialog service. |
| The Electron divider resizes the sessions sidebar through the shell's external-resize API | `T/electron-shell.component.ts:51, 290-301, 377-419` | Deleted together with `beginExternalSidebarResize`, `applyExternalSidebarResize` and `commitExternalSidebarResize`. |
| `.sidebar-item-active` is also used by the Workspaces sidebar | `O/workspace-sidebar.component.ts:64`; `W/styles.css:2268-2276, 2289-2298` | It must NOT be deleted (this conflicts with design §3.7 and §7; see DP-3). Only the session-only rules go. |
| Session-only global CSS: `.sidebar-item-open-tab` (both themes), `.sidebar-scroll` and the `aside:not(:hover)` rules | `W/styles.css:2278-2281` (inside `[data-theme='anubis-light']`, opened at 2153), `2300-2338` | Deleted (Req 7.3). |
| `LoggingService.error(context, message, data?)` is exported from core and already used in chat | `libs/frontend/core/src/lib/services/logging.service.ts:74, 180`; `libs/frontend/chat/src/lib/settings/ptah-ai/lane-guards-settings.component.ts:9, 174` | Replaces the shell's `console.error` in the moved rename and delete code. |
| Chat services are exported by name | `S/index.ts:1-15`; `libs/frontend/chat/src/index.ts:15` | New services are added to `S/index.ts`. Canvas imports them from `@ptah-extension/chat`. |
| `session-row-groups.ts` imports the chips labels from components | `T/session-row-groups.ts:9-36` | It moves next to the modal (component layer), not into services. Grouping is computed in the modal. |
| `lucide-angular` ships `History` | `node_modules/lucide-angular/src/icons/icons/history.d.ts` (main checkout) | Icon for both entry buttons and the modal title. |
| On organization hosts every listed row carries an `organization` summary. Defaults are used when no stored row exists. Only the returned page is enriched | `libs/backend/session-organization/src/lib/session-organization.service.ts:144-170` (`toSessionOrganizationSummary(undefined, …)`); `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:386-391, 420-424, 500` | Every persisted session on an organization host effectively "has a record". A row missing from `ChatStore.sessions()` only means paging or filters, not a missing record (review finding 2). |
| `session:setOrganization` cannot serve as a read. It needs at least one of priority, status or pinned, and it writes (upsert) | `libs/backend/session-organization/src/lib/session-organization.service.ts:407-440`; `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts:76-89` | There is no read-through mutation. The Gate 2 options are a new read RPC or a client-side lookup. |
| The organization handler has building blocks for an exact-id read: `authorizeSession(sessionId)` (metadata → workspace root), `withMissingTasks`, and the service methods `queryWorkspace(root)` and `countChildren(root)`. There is no single-session store or service read | `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts:298-311, 318-347`; `libs/backend/session-organization/src/lib/session-organization.service.ts:538-549`; `libs/backend/session-organization/src/lib/session-organization.store.ts:467, 685` | Option (a) needs no new store method. The handler composes the existing service reads. |
| Organization handler methods are listed in `METHODS` and the manifest entry has `requires: []`, so every host serves the namespace and answers `organization-unavailable` on VS Code | `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts:95-113, 143-176`; `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:288-297` | A new method in `METHODS` is served on all three hosts. The rpc-surface partition specs need no list edit, but they must be run. |
| `session:` is already an allowed prefix | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:44-45` | Option (a) needs no `ALLOWED_METHOD_PREFIXES` change. `rpc-allowlist.spec.ts:58-110` must still pass. |
| RPC registries: `RpcMethodRegistry` (params/result types) and `RPC_METHOD_ENTRIES`, from which `RPC_METHOD_NAMES` is derived | `libs/shared/src/lib/types/rpc.types.ts:760, 825, 3749-3764, 4213`; `libs/shared/src/lib/types/rpc/rpc-session.types.ts:133-160` | Option (a) adds one entry to each, plus param and result types. |
| The host-source baseline only guards names that match `/turn\|recap\|ptah-?ui\|change-?set\|host-?source\|turn-?tests\|usage/i` | `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts:17-21, 48-55`; `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:2-4` | `session:getOrganization` does not match, so it needs no baseline change and no TASK_2026_610 exception. |
| Organization pushes carry ids only and trigger the debounced list refresh | `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:192-197`; `libs/shared/src/lib/types/messages/payload-map.ts:304-308` | Under options (a) and (c), an editor showing a not-loaded session must refetch on this push. That is one added call in this case branch. |
| The editor reads only `id`, `name` and `organization` from its `session` input | `libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.ts:107-120, 485, 515, 533`; `ChatSessionSummary` at `libs/shared/src/lib/types/execution/node.ts:229-240` | Under (a) and (c), a not-loaded session can be shown by building the editor input from the tab name plus the fetched summary. |
| e2e helper and specs that reach the sidebar | `E/support/perf-session-fixture.ts:433-460, 475-490`; `E/support/perf-page-capture.ts:204-211, 461-470`; parity-inventory "E2E specs that target the sidebar" | Helper rewrite plus caller updates (component 13). |
| `canvas.spec.ts` focuses `ptah-canvas-rail footer button`, which becomes two buttons and fails strict mode | `E/specs/canvas/canvas.spec.ts:215-220` | This spec must be updated as well. It is not in D7's run list (see Clarifications). |
| Docs shots write tracked PNGs | `E/docs-screenshots/_harness/shooter.ts:12-17, 123` (`apps/ptah-docs/public/screenshots`) | The D7 run regenerates tracked images. Revert them after the run (DP-12). |

## Architecture decision

- **Chosen approach.** The work splits into four parts, each with one responsibility:
  - Four small root services in `@ptah-extension/chat` (`S/session-list/`):
    - list view state;
    - dialog open/close with focus return;
    - organizer target with focus return;
    - row actions (open, rename, delete).
  - One smart modal organism (`PreviousSessionsModalComponent`) built from two presentational molecules (toolbar and
    row). It is rendered at the shell root behind `@defer`.
  - Entry buttons:
    - in the Rail footer (canvas, through a new Rail output that the board wires to the dialog service);
    - in the shell navbar (single layout only).
  - Rail card Rename and Organize, which inject the same chat services directly.

  The sidebar code is then deleted outright.
- **Rationale.**
  - Query state must outlive the modal (A-11, Req 2.9), so it cannot be component state.
  - The Rail must open the modal and the organizer, but the shell cannot bind canvas outputs (`ngComponentOutlet`,
    `T/app-shell.component.html:811`), while canvas already depends on chat (`CV/canvas-rail/canvas-rail-card.component.ts:13-20`).
    A chat root service is therefore the established channel and adds no new lib edge.
  - Rename is needed by both the modal and the Rail, so the RPC and side-effects live once in a service.
  - Focus return after `inert` removal must survive the modal's destruction, so it is scheduled from root services with
    `afterNextRender` on the root injector.
- **Rejected alternatives.**
  1. Threading `previousSessionsRequested` / `organizeRequested(tabId)` outputs Rail → board → orchestra-canvas → shell
     (design §8.3 suggestion). The shell cannot bind outputs of a `*ngComponentOutlet` component, so this would still
     need a service at the last hop. It also adds three output hops for no benefit.
  2. Keeping query state in `AppShellComponent`. This grows a god file the task asks to shrink, and the modal would
     need it passed down as roughly 15 inputs.
  3. Native `<dialog>.showModal()`. The top layer would hide the organization editor, the confirm dialog and the Filters
     popover (design §1).
  4. A shared focus-trap service in `@ptah-extension/ui`. The repo has one canvas-local wrap handler today. The modal and
     the confirm dialog are the second and third uses, both in chat, so a chat-local util is enough. Moving the canvas
     one is out of scope.
- **Assumptions.**
  - A1. No ancestor of `ptah-app-shell` in the Electron shell sets `transform`, `filter`, `contain` or `will-change`.
    If one did, the fixed modal would be confined to the chat column. Check: the visual review at 1440 px shows the
    scrim covering the whole window and the panel centred on the window.
  - A2. `nx run-many -t test … --maxWorkers=2` forwards `maxWorkers` to `@nx/jest`. Check: the run header and the Jest
    worker count. Fallback: `npx jest -c <lib>/jest.config.ts --coverage=false --maxWorkers=2`.
  - A3. The webview harness serves the built SPA at chat with the shell row present. Check: in each updated harness
    scenario, the `#ptah-e2e-fixture-root` placeholder is absent. If it is present, scenarios keep today's defensive skip.
- **Effect on existing code.**
  - Removed: the sidebar markup, the `Sessions` tab, width/resize/persistence state, `session-sidebar-width.ts` and its
    spec, the Electron divider and external-resize API, and the session-only CSS.
  - Re-homed:
    - list filtering and grouping, rename, delete and the organizer state (move out of `AppShellComponent`);
    - the `app-shell.organization.spec.ts` tests (move to the modal and service specs).
  - Changed (additive):
    - `ConfirmationDialogComponent` gains dialog semantics, initial focus, Escape, a trap and focus return;
    - `ptah-session-filter-bar` gets class-only layout and placeholder changes;
    - the Rail footer and Rail card change.
  - The organization editor gets a Tab trap and a post-render focus restore only (component 6b); its content and
    verbs are unchanged.
  - Left alone: backend RPCs (unless the user picks Gate 2 option (a)), `SessionLoaderService`, chips, the live-phase
    marker, the workflow badge, `SidebarTabComponent` (still used for Workspaces), the canvas dock and empty-board New
    session.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| DP-1 | Rail → modal and Rail → organizer go through chat root services injected by canvas, not outputs to the shell. The Rail footer itself stays presentational; the board injects the service. | Outputs to the shell (design §8.3 "architect detail"); a new token in core | `T/app-shell.component.html:811` (`ngComponentOutlet`); `CV/canvas-rail/canvas-rail-card.component.ts:13-20` (canvas → chat already) | yes |
| DP-2 | The modal is created per open (inside `@defer` + `@if`), and all query and paging state lives in `SessionListViewStore` and `ChatStore`. The list opens at the top each time (A-11 scroll removal, approved D6). | Keep the modal mounted and hidden | design §4.1.4, §4.4; `S/chat-store/session-loader.service.ts:475-478` | yes |
| DP-3 | Keep `.sidebar-item-active` in `W/styles.css` (both themes). Delete only `.sidebar-item-open-tab`, `.sidebar-scroll` and the `aside:not(:hover)` rules. **Design position:** design §3.7 and §7 say delete it. **Source position:** the Workspaces sidebar uses it (`O/workspace-sidebar.component.ts:64`). **Resolution:** source wins, because the Workspaces sidebar is out of scope and must keep working (task-description Scope). | Delete it and restyle the workspace sidebar | `O/workspace-sidebar.component.ts:64`; task-description "Out of scope" | yes |
| DP-4 | `.session-row-current` / `.session-row-open-tab` are host classes of the row component (`li[ptah-session-list-row]`), styled in that component's `styles`, not in `styles.css`. Per D12 they paint the whole `li` (row button and chips line). **Design position:** design §3.7 adds them to `styles.css`. **Resolution:** same visual and token values, defined in the component instead. This keeps global CSS shrinking and places the D12 accent where the whole row lives. | Global rules in `styles.css` | D12; design §3.6 (chips beside the button inside the `li`) | yes |
| DP-5 | Focus return for nested dialogs happens after the render that removed `inert`. The organization editor and the confirm dialog restore their own opener in `afterNextRender`. The editor's synchronous restore at `:767` moves into `afterNextRender` (component 6). The owner of the open (organizer callback or modal delete handler) then applies the fallback when the opener no longer exists. A second focus of the same element is harmless. | Owner-only restore, with the editor's synchronous restore left as is (Gate 2 review: the editor must itself trap and restore) | design-spec-review finding 1; Gate 2 review finding 1; `M/session-organization-editor/session-organization-editor.component.ts:752-769`; Angular `afterNextRender` source above | yes |
| DP-6 | Rail Rename popover: an outer `ptah-native-popover` (Rename) whose `[trigger]` slot holds the existing menu popover. Its own `[trigger]` is the ⋮ button. This places the Rename form outside the menu content and anchors it to the trigger. Handoff: close the menu synchronously, then open Rename in `afterNextRender`. **Design position:** §8.2 says "anchored to the same trigger … closeMenu() then opens". **Resolution:** the nesting makes that literal and satisfies review finding 2. | Sibling popover with its own invisible trigger; one popover with two content modes | `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:80-84` (trigger slot), `166-178`, `236-243`, `302-309` | yes |
| DP-7 | **Withdrawn** (Gate 2 review finding 2). Rail Organize availability for a persisted session whose row is not in the loaded list is now a user choice. See "## Gate 2 choice: Rail Organize availability". The cases that do not depend on the choice stay settled: drafts show Organize disabled with "Send a first message to save this session." (design §8.5); VS Code shows no Organize (design §8.1); a loaded row opens at once. | — | — | — |
| DP-8 | Inert covers `#shellRow` only. Electron chrome outside `ptah-app-shell` stays outside `inert`, but it is covered by the scrim (pointer) and by the Tab wrap (keyboard). | `inert` on `document.body` siblings | design §4.1.1; `T/electron-shell.component.ts:303-311` | yes |
| DP-9 | The modal closes without restoring focus when the shell switches to a standalone surface while it is open (e.g. a notification route). Focus fallback when the opener is gone: the first visible `[data-previous-sessions-trigger]`. | Keep it open over the standalone surface | design §4.3 "opener gone"; `T/app-shell.component.ts:221-223` | yes |
| DP-10 | The organization filter bar renders directly in the modal (no inner `@defer (on immediate)`), so initial focus can land on its search field in the first `afterNextRender`. The modal itself is deferred. | Keep the inner defer (initial focus races the chunk) | design §4.1.2; `T/app-shell.component.html:127-132` | yes |
| DP-11 | The stale `localStorage` key `ptah.sessionSidebarWidth` is left alone. No cleanup code is added. | One-shot removal on boot | task-description Open questions ("harmless either way"); "Replace, do not accumulate" | yes |
| DP-12 | D7 docs-shot runs regenerate tracked PNGs in `apps/ptah-docs/public/screenshots`. Revert them after the run unless the user asks to publish. | Commit the new images | task-description Out of scope ("Regenerating and publishing docs images"); `E/docs-screenshots/_harness/shooter.ts:12-17` | yes |
| DP-13 | The perf spec `tile-open-longtask-budget.perf.spec.ts` stays `test.skip`-gated (`PTAH_PERF_SPECS`). Its D7 run uses the default env, so it reports skipped. Its helper change is covered by typecheck and by the three non-perf specs that share `prepareCanvasWithSessions` / `sessionRowButton`. The measured window now includes opening the modal, and this is disclosed in the spec header. | Run with `PTAH_PERF_SPECS=1` (needs an idle machine, per its own skip text) | `E/specs/chat/tile-open-longtask-budget.perf.spec.ts:267-271` | yes |
| DP-14 | Text typed in the filter bar during the last 250 ms before the modal closes is dropped (the bar releases its debounce timer on destroy, B-13 keep). This is accepted and not patched. | Flush on destroy | `M/session-filter-bar/session-filter-bar.component.ts:10-13` (parity B-13 "keep") | yes |

## Gate 2 choice: Rail Organize availability

> **USER DECISION 2026-10-16 (decisions.md D13): option (a).** Gate 2 APPROVED (D15). Two corrections from
> implementation-plan-review.md Re-review r1 apply to option (a):
> 1. Add a read-method `organization-unavailable` case for `session:getOrganization` to
>    `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts` (its static `MUTATIONS` list does
>    not cover a read) and run that spec as a scoped Jest run in B0.
> 2. The backend cost is a workspace-wide read (`queryWorkspace(root)` + `countChildren(root)`), then an ID lookup,
>    the same cost as one `session:list` page read. The response is exact; the storage read is not by-ID.
> Also D14: the one affected `canvas.spec.ts` test runs once in B6.

**Question.** Req 10.2 asks for Organize on a Rail card whose session "has an organization record". On organization
hosts every persisted session has one: rows with no stored record are reported with defaults
(`session-organization.service.ts:144-170`, `session-rpc.handlers.ts:500`). The webview only holds summaries for the
rows `session:list` returned for the current page and query (`session-rpc.handlers.ts:386-391`). A live board session
can be missing from that page because of paging or the modal's filters. How should Organize behave for such a card?

**Facts the options rest on (verified).**
- No exact-id read exists:
  - `session:load` returns no organization summary (review evidence: `rpc-session.types.ts:251-257`);
  - `session:setOrganization` needs at least one field and writes (`session-organization.service.ts:407-440`;
    `session-organization-rpc.schema.ts:76-89`).
- The store has no single-session read (`session-organization.store.ts:467` `listWorkspace`, `:685` `countChildren`).
  The service exposes `queryWorkspace(root)` and `countChildren(root)` (`session-organization.service.ts:538-549`),
  and the handler already has `authorizeSession` and `withMissingTasks` (`session-organization-rpc.handlers.ts:298-347`).
  So option (a) needs no store or service change in `libs/backend/session-organization`.
- `session:` is an allowed prefix (`rpc-handler.ts:44-45`), so no `ALLOWED_METHOD_PREFIXES` change.
- The organization manifest entry is `requires: []` (`manifest.ts:288-297`), so a new method is served on VS Code,
  Electron and CLI. VS Code answers `organization-unavailable`, and the Rail never calls it there.
- The host-source baseline does not cover `session:*` names (`host-source-registry.contract.spec.ts:17-21`).

**What does not depend on the choice.**
- Components 1-3, 5-8 and 10-13.
- In components 4 and 9: the draft case, the VS Code case, the loaded-row case, the Rename flow, and the menu
  structure and handoff.

**Option (a): a targeted read RPC `session:getOrganization { sessionId }` plus a one-entry cache.**
- **Files touched.**
  - `libs/shared/src/lib/types/rpc/rpc-session.types.ts`: `SessionGetOrganizationParams { sessionId: string }` and
    `SessionGetOrganizationResult = SessionOrganizationMutationResult` (same `{ ok: true, organization } | { ok: false, … }`
    shape, so the frontend reuses its error handling).
  - `libs/shared/src/lib/types/rpc.types.ts`: an `RpcMethodRegistry` entry (near `:825`) and an
    `RPC_METHOD_ENTRIES` entry (near `:3764`).
  - `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts`: `SessionGetOrganizationParamsSchema`
    (reuses `SessionIdParamSchema`).
  - `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts`: add the method to `METHODS`
    (`:105-112`) and add `registerGetOrganization()`. The handler runs these steps:
    1. Parse.
    2. If the store is unavailable, return `UNAVAILABLE`.
    3. Run `authorizeSession`; if that returns null, answer `NOT_FOUND`.
    4. Build the summary with `toSessionOrganizationSummary(queryWorkspace(root).get(id), countChildren(root).get(id) ?? 0, new Set())`.
    5. Run `withMissingTasks`.
    6. Sanitize errors as the mutations do (`:350-383`). There is no broadcast, because nothing changed.
  - `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.spec.ts`: new cases:
    - unavailable;
    - not found;
    - unauthorized workspace;
    - defaults when no stored row;
    - stored values plus `childCount`;
    - missing-task flag;
    - invalid params.
  - Frontend:
    - component 4 (`openForSession`, the cache and `onOrganizationChanged`);
    - `S/chat-message-handler.service.ts` (one call);
    - component 9 (Organize enablement).
  - `ClaudeRpcService.call` is typed by the registry, so `libs/frontend/core` needs no change.
- **Guard specs.** No list edit is expected; each must pass:
  - `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` (partition: the method is served);
  - `apps/ptah-electron/src/di/rpc-surface.spec.ts`;
  - `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`;
  - `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts` (manifest claims every registry method once; prefix
    allowed);
  - `libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts` (name not host-source).
  - `apps/ptah-extension-vscode/src/di/expected-resolvable.ts` needs no change: no new DI token or service; the
    handler class is already registered.
  - `rpc.types` gains the two entries listed above.
- **Projects added to the scoped checks.** `@ptah-extension/shared` and `@ptah-extension/rpc-handlers` (typecheck,
  test, lint). Run the three rpc-surface specs as scoped Jest runs in `ptah-extension-vscode`, `ptah-electron` and
  `@ptah-extension/cli-engine`; those projects are not edited. `@ptah-extension/session-organization` is not changed.
- **Batch.** A new B0 for backend-developer (shared + rpc-handlers) before B1. Component 4's (a) part goes into B1,
  and component 9 into B5.
- **Risk.**
  - LOW technical risk: it composes existing reads, adds no write path, and uses the same authorization as the
    mutations.
  - The cost of `queryWorkspace(root)` is the same per-workspace read that every `session:list` already does.
  - It is a backend scope addition to a task whose Scope listed backend changes as out (task-description "Out of
    scope"). That is why the user decides.
  - The new public RPC method name must be kept.
- **Recommendation.** **Recommended.** It is exact, cheap and small (about 60 lines of backend plus tests), it fits
  the existing handler pattern, and it meets Req 10.2 literally.

**Option (b): keep the limit and disclose it.**
- **Files touched.** None beyond components 1-13 as written, with the (b) branches in components 4 and 9.
- **Guard specs.** None.
- **Projects added.** None.
- **Risk.**
  - A user-visible gap: Organize is disabled for a live Rail session whose row is outside the loaded page or the
    current filters. The reason text tells the user to use Previous sessions.
  - It does not fully meet Req 10.2 as written, so the requirement would have to be read as "in the loaded list".
- **Recommendation.** Acceptable if the user wants zero backend change. Not recommended, because the gap shows on
  exactly the sessions the Rail is meant to serve (a running session under a status filter).

**Option (c): a client-only targeted `session:list` lookup (no backend change).**
- **Mechanism.** `SessionOrganizerService.openForSession` calls `ClaudeRpcService.call('session:list', …)` directly,
  not through the loader, so the visible query and pages are untouched. Parameters:
  - `workspacePath` (the active workspace);
  - `text` = the tab's session name;
  - `status` = every value of `SESSION_WORKFLOW_STATUSES`, because query mode otherwise drops archived rows
    (`rpc-session.types.ts:93-98`);
  - `sort: 'lastActive'`, `limit: 50`.

  It then picks the row whose `id` matches. If no row matches, it returns `'unavailable'` and the item shows the
  option (b) reason.
- **Files touched.** Component 4 (`openForSession` with this lookup, the cache and `onOrganizationChanged`),
  `S/chat-message-handler.service.ts` (one call), and component 9.
- **Guard specs.** None (no new method).
- **Projects added.** None.
- **Risk.**
  - MEDIUM correctness risk: the lookup depends on the stored name (substring, case-insensitive). It misses when the
    tab name differs from the stored name (a rename that failed on the backend, or a default-named draft that got a
    generated title), when more than 50 sessions match the text, or when the name is empty.
  - Each lookup reads the whole workspace metadata and organization map plus transcript directories for up to 50
    rows (`session-rpc.handlers.ts:416-442`). That costs more than (a).
- **Recommendation.** Fallback only, if the user rejects backend scope but wants better coverage than (b).

**Not viable (checked).**
- Opening the editor with default values for a not-loaded session misreports stored values.
- Using `session:setOrganization` as a read is rejected by the schema without a field, and it writes.
- Paging `session:list` until the id appears is unbounded in cost.

**Applying the answer.**
- (a): add batch B0 and the (a) branches.
- (b): delete the (a)/(c) branches from components 4 and 9 before handing them to the developer.
- (c): use the (c) mechanism in component 4.

In every case the rest of the plan is unchanged.

## Component specifications

### 1. SessionListViewStore (query view state that outlives the modal)

- **Purpose.** Owns the client-side list view state and the rows derived from it, for the lifetime of the app.
- **Responsibilities.**
  - Signals moved verbatim from the shell (`T/app-shell.component.ts:313-320, 327-393, 790-803, 806-808, 823-836`):
    - `searchQuery`, `dateFrom`, `dateTo`, `dateFilterOpen` and their setters;
    - `toggleDateFilter()`;
    - `organizationAvailable` and `listQuery` (pass-through from `ChatStore`);
    - `setListQuery(query)`;
    - `hasClientFilters`, `hasServerFilters`, `hasActiveFilters`, `filteredSessions`;
    - `clearFilters()`, which keeps sort and grouping.
  - It does not group. Grouping depends on component-layer labels and is computed in the modal.
- **Verified contracts and entry points.**
  - `ChatStore.sessions/listQuery/organizationAvailable/setListQuery` at `S/chat.store.ts:105, 109-110, 216`.
  - `SessionListQuery` type from `S/chat-store/session-loader.service.ts` (imported today at
    `T/app-shell.component.ts` imports list).
- **Dependencies.** `ChatStore` (same lib), downward only. `providedIn: 'root'`.
- **Integration points.** `PreviousSessionsModalComponent` (reads and writes). Nothing else.
- **Failure behaviour.** Pure state. A list load error stays invisible, as today (E-5).
- **Quality requirements.**
  - `filteredSessions` stays a single `computed` over `ChatStore.sessions()`.
  - No timers, no listeners.
- **Verification seam.** `S/session-list/session-list-view.store.spec.ts`:
  - local name filter (B-1);
  - inclusive whole-day date range (B-14);
  - `clearFilters` keeps sort/groupBy and closes the date panel (B-15);
  - `hasServerFilters` false when organization is unavailable;
  - Req 2.9 / A-11 / B-16: state survives with no extra `setListQuery`.
- **Files.**
  - CREATE `S/session-list/session-list-view.store.ts`
  - CREATE `S/session-list/session-list-view.store.spec.ts`

### 2. SessionRowActionsService (open, rename, delete)

- **Purpose.** The one implementation of the three row verbs, shared by the modal rows and the Rail rename.
- **Responsibilities.**
  - `openSession(session: Pick<ChatSessionSummary, 'id' | 'name'>): void`. Logic is moved from
    `T/app-shell.component.ts:859-865`: grid uses `appState.requestCanvasSession(id, name)`, single uses
    `chatStore.switchSession(id)`.
  - `rename(sessionId: string, currentName: string, requestedName: string): Promise<'renamed' | 'unchanged' | 'failed'>`.
    - The name is trimmed and capped at `SESSION_NAME_MAX_LENGTH = 200` (exported).
    - Empty or unchanged returns `'unchanged'` with no RPC.
    - It calls `ClaudeRpcService.renameSession`. On success it calls `chatStore.updateSessionName` and
      `tabManager.setNameAndTitle` for the session's tab. Logic is moved from `T/app-shell.component.ts:910-934`.
  - `deleteSession(session: ChatSessionSummary): Promise<'deleted' | 'cancelled' | 'failed'>`. Logic is moved from
    `T/app-shell.component.ts:937-982`:
    1. Capture `activeWorkspacePath` before the confirm.
    2. Confirm through `ConfirmationDialogService.confirm` with the same title, message, labels and `error` style.
    3. On success: `forgetWorkflowSession`, `removeSessionFromList`, `organizer.closeIfShowing(id)`,
       `clearCurrentSession` when the session is current, and `closeTab`.
- **Verified contracts and entry points.**
  - `ClaudeRpcService.renameSession` / `deleteSession` (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:285, 298`, per parity D-2/D-3).
  - `AppStateManager.requestCanvasSession` (`app-state.service.ts:1247`) and `layoutMode` (`T/app-shell.component.ts:209`).
  - `TabManagerService` methods at `tab-manager.service.ts:567, 963, 970, 1341, 2614`.
  - `ConfirmationDialogService.confirm` (`confirmation-dialog.service.ts:35`).
  - `LoggingService.error` (`logging.service.ts:180`).
- **Dependencies.** `ChatStore`, `TabManagerService`, `ConfirmationDialogService` (chat-state), `ClaudeRpcService`,
  `AppStateManager`, `LoggingService` (core), and `SessionOrganizerService` (same folder). Root. The direction is
  chat → chat-state/core, which already exists.
- **Integration points.** Modal row events and Rail card Rename (component 9).
- **Failure behaviour.**
  - `ok:false` or a thrown transport error returns `'failed'`.
  - It logs `LoggingService.error('SessionRowActions', 'Failed to rename session' | 'Failed to delete session', error)`.
  - The list, tab and name are left untouched. There is no inline error UI (Req 5.6).
  - Cancel returns `'cancelled'` and sends no RPC.
- **Quality requirements.**
  - No `console.*`.
  - The caller does the double-fire guard (the modal's `editingSessionId`); the service is idempotent per call.
- **Verification seam.** `S/session-list/session-row-actions.service.spec.ts`. It migrates the two delete tests from
  `T/app-shell.organization.spec.ts:322, 345` (titles kept) and adds:
  - rename success updates store and tab;
  - unchanged or empty is a no-op;
  - more than 200 is capped;
  - failure is logged and nothing changes;
  - `openSession` per layout (D-1).
- **Files.**
  - CREATE `S/session-list/session-row-actions.service.ts`
  - CREATE `S/session-list/session-row-actions.service.spec.ts`

### 3. PreviousSessionsDialogService (open/close and opener focus)

- **Purpose.** The single owner of whether the modal is open and where focus goes when it closes.
- **Responsibilities.**
  - `isOpen: Signal<boolean>`.
  - `open(): void`. A no-op when already open. It stores `document.activeElement` (`inject(DOCUMENT)`) as the opener.
  - `close(options?: { restoreFocus?: boolean }): void`.
    - It sets the state to closed.
    - Unless `restoreFocus === false`, it schedules `afterNextRender(..., { injector })` with the root `Injector`.
    - That callback focuses the opener if it is connected, not inside `[inert]` and visible. Otherwise it focuses the
      first visible `[data-previous-sessions-trigger]`.
    - It clears the opener.
- **Verified contracts and entry points.** `afterNextRender` with an environment injector (Angular source cited above).
  The design's focus table is §4.3.
- **Dependencies.** Angular core only. Root.
- **Integration points.**
  - Rail board (open; `isOpen` for `aria-expanded`).
  - Shell navbar button (open; `aria-expanded`).
  - Shell root (`@defer`/`@if` render; `inert` on `#shellRow`; close on standalone view, DP-9).
  - Modal (close on Escape, Close, backdrop, select).
- **Failure behaviour.**
  - No opener and no visible trigger: focus is not moved, and nothing is logged.
  - Calling `close()` while closed is a no-op.
- **Quality requirements.** The `afterNextRender` ref is single-shot. There is no lingering listener.
- **Verification seam.** `S/session-list/previous-sessions-dialog.service.spec.ts`:
  - open/close toggles;
  - focus returns to the opener after render;
  - the fallback trigger is used when the opener is detached;
  - `restoreFocus:false` does nothing.
- **Files.**
  - CREATE `S/session-list/previous-sessions-dialog.service.ts`
  - CREATE `S/session-list/previous-sessions-dialog.service.spec.ts`

### 4. SessionOrganizerService (which session the organization editor shows)

- **Purpose.** Moves the organizer target out of the shell so the modal rows and the Rail cards can both open the
  one editor.
- **Responsibilities.**
  - `available` (= `ChatStore.organizationAvailable`).
  - `session` (the `linkedSignal` moved verbatim from `T/app-shell.component.ts:409-432`) and `isOpen = computed(() => session() !== null)`.
  - `rowFor(sessionId): ChatSessionSummary | null` (a loaded row with `organization`).
  - `open(sessionId, restoreFocus: () => void)`.
  - `close()`: id becomes null, then `afterNextRender(restoreFocus)` on the root injector (DP-5).
  - `closeIfShowing(sessionId)`, used by delete.
  - **[choice-dependent]** Rail entry for a session with no loaded row:
    - Option (b): nothing more. The Rail uses `rowFor` only.
    - Options (a) and (c): add
      `openForSession(sessionId, name, restoreFocus): Promise<'opened' | 'unavailable' | 'failed'>`.
      - It uses the loaded row when present.
      - Otherwise it resolves the summary (a: `session:getOrganization`; c: the targeted `session:list` lookup), keeps
        it in a small `Map<sessionId, SessionOrganizationSummary>` cache, and opens the editor.
      - The editor input is `{ id, name, organization }` plus the remaining required `ChatSessionSummary` fields set
        to neutral values (`messageCount: 0`, `createdAt: 0`, `lastActivityAt: 0`, `isActive: false`). The editor
        reads only `id`, `name` and `organization` (Codebase evidence).
      - The `session` linkedSignal source becomes loaded row ?? cached entry ?? previous copy.
      - Add `onOrganizationChanged(sessionIds)`. When the editor shows a cached (not loaded) session whose id is in
        the push, it refetches that session. It is called from `chat-message-handler.service.ts:195` next to the
        existing refresh.
      - The cache entry is dropped on `close()`, so the cache holds at most the session being shown.
- **Verified contracts and entry points.**
  - Editor input `session` and output `closed` (`M/session-organization-editor/session-organization-editor.component.ts:107-128`).
  - Shell render site `T/app-shell.component.html:19-26`.
- **Dependencies.** `ChatStore`. Root.
- **Integration points.**
  - The shell renders `<ptah-session-organization-editor [session]="organizer.session()" (closed)="organizer.close()">`
    under the existing `@if (organizationAvailable)` / `@defer (when organizer.isOpen())`.
  - The modal passes a restore callback for the row's Organize button, falling back to the search field.
  - The Rail card passes the trigger, falling back to the card's select button.
- **Failure behaviour.**
  - When the row leaves the list while open, the editor keeps the last copy (unchanged behaviour).
  - The editor's own `ok:false` errors stay inline in the editor (D-9, Req 5.6).
- **Quality requirements.** none beyond the shared rules.
- **Verification seam.** `S/session-list/session-organizer.service.spec.ts`:
  - keeps the last copy when the row leaves (migrated intent of `T/app-shell.organization.spec.ts:651`);
  - restore runs after render;
  - `closeIfShowing`;
  - **[choice-dependent, (a)/(c)]** a persisted session that is excluded from the loaded page (paging or a filter):
    - `openForSession` fetches the summary and opens the editor with the fetched values;
    - a push for that id refetches it;
    - `ok:false` or a transport failure returns `'failed'`, logs, and does not open the editor;
    - the cache is emptied on close.
- **Files.**
  - CREATE `S/session-list/session-organizer.service.ts`
  - CREATE `S/session-list/session-organizer.service.spec.ts`
  - MODIFY `S/index.ts`: add named exports for the four services plus `SESSION_NAME_MAX_LENGTH`.
  - **[choice-dependent, (a)/(c)]** MODIFY `S/chat-message-handler.service.ts`: in the
    `SESSION_ORGANIZATION_CHANGED` branch (`:195`), also call `organizer.onOrganizationChanged(payload.sessionIds)`.
    Add a case to `S/chat-message-handler.service.spec.ts`.

### 5. Focus-wrap util (Tab trap for the modal, the confirm dialog and the organization editor)

- **Purpose.** Keep Tab and Shift+Tab inside one container.
- **Responsibilities.** `wrapTabWithin(container: HTMLElement, event: KeyboardEvent): void`.
  - It ignores non-Tab keys and modified keys.
  - It filters tabbables the same way as the canvas helper: tabIndex ≥ 0, not disabled, not inside `[hidden]` or
    `[inert]`, and visible.
  - It wraps first ↔ last.
  - With no tabbables it calls `preventDefault`.
- **Verified contracts and entry points.** The pattern comes from `CV/canvas-rail/canvas-rail-board.component.ts:37-55, 735-751`.
  That copy stays where it is (out of scope, different lib).
- **Dependencies.** none.
- **Integration points.** Component 6 (confirm dialog and organization editor) and component 7 (modal). That makes
  three chat consumers.
- **Failure behaviour.** n/a.
- **Quality requirements.** O(n) over the container's tabbables per Tab press. No observers.
- **Verification seam.** `libs/frontend/chat/src/lib/utils/focus-wrap.utils.spec.ts` (jsdom):
  - wraps at both ends;
  - skips inert and disabled elements.
- **Files.**
  - CREATE `libs/frontend/chat/src/lib/utils/focus-wrap.utils.ts`
  - CREATE `libs/frontend/chat/src/lib/utils/focus-wrap.utils.spec.ts`

### 6. Nested dialog a11y: ConfirmationDialogComponent and SessionOrganizationEditorComponent

While either dialog is open over the modal, the modal panel is `inert` and that dialog is the trap root (design §4.1.3).
Both dialogs must therefore trap Tab themselves (Gate 2 review finding 1).

**6a. ConfirmationDialogComponent**

- **Purpose.** Make the global confirm dialog a proper modal layer (design §4.2, §11.2; design-spec-review finding 1).
- **Responsibilities.**
  - Panel semantics:
    - `role="dialog"`, `aria-modal="true"`;
    - `aria-labelledby` pointing at the `h3` title (unique id);
    - `aria-describedby` pointing at the message.
  - `(keydown)` on the `<dialog>`:
    - Escape (not composing) calls `onCancel()`, `preventDefault` and `stopPropagation`;
    - Tab calls `wrapTabWithin` over the `.modal-box`.
  - Focus:
    - On open (an effect on `dialogService.isOpen()` with `untracked`), store `document.activeElement`. Then, in
      `afterNextRender`, focus the Cancel button. Cancel is the safe default for a destructive confirm.
    - On close, in `afterNextRender`, focus the stored element if it is connected and not inert, then clear it.
  - Text, order, buttons and checkbox behaviour stay unchanged.
- **Verified contracts and entry points.** `M/confirmation-dialog.component.ts:20-60, 97-107`;
  `confirmation-dialog.service.ts:27-35, 91`.
- **Dependencies.** Component 5. `ConfirmationDialogService` is unchanged.
- **Integration points.** Every existing `confirm()` caller gets the a11y improvement. The modal's delete flow adds
  its own post-result focus move (component 7), which runs after this restore.
- **Failure behaviour.** If the opener is gone, focus is not moved. The caller (modal) handles fallback.
- **Quality requirements.** WCAG: the dialog has a name; focus stays visible inside it.
- **Verification seam.** CREATE `M/confirmation-dialog.component.spec.ts`:
  - role and name;
  - initial focus on Cancel;
  - Escape cancels (`handleCancel` called);
  - Tab wraps;
  - focus returns to the opener after close.
- **Files.**
  - MODIFY `M/confirmation-dialog.component.ts`
  - CREATE `M/confirmation-dialog.component.spec.ts`

**6b. SessionOrganizationEditorComponent (focus trap and post-render restore only)**

- **Purpose.** Keep focus inside the editor while it is open over the modal or over the Rail, and return it after
  `inert` has been removed (Gate 2 review finding 1). Its content, verbs and errors are unchanged.
- **Responsibilities.**
  - Add `(keydown)="onKeydown($event)"` on the `<dialog>` (`:108-114`). On Tab it calls `wrapTabWithin` over the
    `.modal-box` (`:115`), queried through a `viewChild` ref.
  - The existing `(keydown.escape)="onEscape($event)"` stays the Escape path (`:112`, `:561-564`). Add
    `stopPropagation()` to `onEscape`, so a document-level Escape listener in canvas does not also fire
    (`CV/canvas-detail/canvas-lane-tabs.component.ts:79`).
  - Focus return: in `onSessionChange(null)` (`:767-768`), replace the synchronous
    `this.returnFocus.focus()` with `afterNextRender(() => { if (target.isConnected && !target.closest('[inert]')) target.focus(); }, { injector: this.injector })`,
    capturing the target before `returnFocus` is cleared.
    - This runs after the render in which the modal panel lost `inert` (component 7 binds that `inert` to
      `organizer.isOpen()`).
    - The organizer's restore callback (component 4) still runs after it and only matters when the target is gone.
  - Initial focus on the close button is unchanged (`:762-764`).
- **Verified contracts and entry points.** `M/session-organization-editor/session-organization-editor.component.ts:107-128, 536-564, 752-769`.
  The `injector` field is already used by the existing `afterNextRender` at `:762-764`.
- **Dependencies.** Component 5.
- **Integration points.** Shell root render (component 10), opened through `SessionOrganizerService` from the modal
  rows and the Rail cards.
- **Failure behaviour.** If the target is gone or still inert, focus is not moved here, and the owner's fallback
  applies (DP-5).
- **Quality requirements.** none beyond the shared rules.
- **Verification seam.** MODIFY `M/session-organization-editor/session-organization-editor.component.spec.ts`. Add:
  - Tab on the last tabbable of the `.modal-box` wraps to the first; Shift+Tab on the first wraps to the last;
  - Escape still emits `closed` and stops propagation;
  - focus returns after the modal panel loses `inert`. The test host renders the opener button inside a container
    whose `[attr.inert]` is bound to `session !== null`. Open the editor from the focused opener, set `session` to
    null, and after the render the opener is `document.activeElement`. The existing restore assertion stays and is
    adjusted to the post-render timing.
- **Files.**
  - MODIFY `M/session-organization-editor/session-organization-editor.component.ts`
  - MODIFY `M/session-organization-editor/session-organization-editor.component.spec.ts`

### 7. PreviousSessionsModalComponent (smart organism)

- **Purpose.** The accessible dialog that hosts the session list (design §3, §4, §6).
- **Responsibilities.**
  - **Markup (design §3.1, prototype `modal.css` `.psm*`):**
    - an outer `<dialog class="modal modal-open z-[990]" role="presentation" data-testid="previous-sessions-modal">`;
    - a scrim (`aria-hidden`);
    - the panel `div role="dialog" aria-modal="true" aria-labelledby="psm-title" id="previous-sessions-dialog"`, with
      no `transform`, `filter`, `contain` or `will-change` at rest;
    - a header: title bar with History icon, `h2#psm-title`, and Close (`aria-label="Close previous sessions"`);
    - the toolbar (component 8);
    - the body `data-testid="previous-sessions-list"`, the only scroller;
    - an sr-only `role="status"` line.
  - **Sizing and motion.** Per design §3.2 and §6: dialog at ≥640 px, full sheet below. The entrance animation uses
    `fill-mode: backwards`. No exit animation. Reduced motion means `animation: none`. These live in the component's
    `styles`.
  - **List.**
    - `sessionGroups = computed(() => groupSessionRows(view.filteredSessions(), view.organizationAvailable() ? (view.listQuery().groupBy ?? 'none') : 'none'))`.
    - Group headers are sticky `h3`; the lists are `ul[aria-labelledby]`.
    - Rows are `li[ptah-session-list-row]` (component 8b).
  - **States.** Skeleton when `bootStatus.isBooting()` (`role="status" aria-label="Loading sessions"`, `aria-busy`).
    Empty, no-match with `Clear filters`, and Load More with the remaining count. All per design §3.11 and parity
    E-1..E-4, with markup moved from `T/app-shell.component.html:434-520`.
  - **Open, trap, Escape, backdrop.**
    - Initial focus: in `afterNextRender`, focus the search field. That is
      `[data-testid="session-filter-text"]` with organization, else `[data-testid="session-search-local"]`, with the
      caret at the end.
    - Panel `(keydown)`: Tab calls `wrapTabWithin(panel)`.
    - `<dialog>` `(keydown)`: Escape (not composing, not `defaultPrevented`) calls `dialog.close()`, `preventDefault`
      and `stopPropagation`.
    - Scrim: close only when both `pointerdown` and `click` land on the scrim (design §4.4).
  - **Nested layers.**
    - Panel `[attr.inert]="nestedLayerOpen() ? '' : null"`, where
      `nestedLayerOpen = organizer.isOpen() || confirmDialog.isOpen()`.
    - The Filters popover lives inside the panel and needs no inert, because its own Escape stops propagation.
  - **Row verbs.**
    - Select: `actions.openSession(session)`, then `dialog.close()`.
    - Rename (inline):
      - `editingSessionId` / `editingSessionName` live here, with the double-fire guard from
        `T/app-shell.component.ts:906-915`.
      - Enter or blur calls `actions.rename(...)`.
      - Escape cancels and stops propagation.
      - After Enter or Escape, `afterNextRender` focuses that row's `[data-action="rename"]`. After blur, focus is not moved.
    - Organize: `organizer.open(id, () => focus row [data-action="organize"] ?? search)`.
    - Delete: `const r = await actions.deleteSession(session)`, then `afterNextRender`:
      - if `'deleted'`: the next row's `[data-action="open"]`, else the previous one, else search;
      - otherwise: that row's `[data-action="delete"]`.
  - **Load More.**
    - Record the row count, then `await chatStore.loadMoreSessions()`.
    - Announce "Loaded N more sessions. R remaining."
    - If the button unmounted, focus the first newly loaded row's open button (design §3.11).
    - An effect announces "N sessions" when the filtered count changes while open (design §3.11 result count).
- **Verified contracts and entry points.**
  - `ChatStore.hasMoreSessions/totalSessions/isLoadingMoreSessions/loadMoreSessions/currentSession` at `S/chat.store.ts:106-108, 172, 211`.
  - `BootStatusService` is used by the shell at `T/app-shell.component.ts:175`.
  - `TabManagerService.workflowForSession/findTabBySessionId/activeWorkspacePath`.
  - `SkeletonBlockComponent` from `@ptah-extension/chat-ui` (`T/app-shell.component.ts` imports).
  - `groupSessionRows` (`T/session-row-groups.ts:36`, moving).
- **Dependencies.** Components 1-5 and 8. `ChatStore`, `TabManagerService`, `BootStatusService`, `ConfirmationDialogService`.
  Same lib, downward only.
- **Integration points.**
  - Rendered by the shell root: `@defer (when previousSessions.isOpen(); prefetch on idle) { @if (previousSessions.isOpen()) { <ptah-previous-sessions-modal /> } }`.
  - It has no inputs or outputs; it talks only to the services.
- **Failure behaviour.**
  - Rename and delete failures are logged by the service; the row is kept; there is no UI (Req 5.6).
  - The editor shows its own inline errors.
  - A list load error has no state (E-5).
- **Quality requirements.**
  - Contrast, focus ring and motion per design §5-§6.
  - Every pair is measured in the visual review at 1440, 760 and 400, in dark and light.
  - No timers.
  - The `role="status"` text is set via a signal and cleared after use.
- **Verification seam.** CREATE `O/previous-sessions/previous-sessions-modal.component.spec.ts`. It carries the
  `app-shell.organization.spec.ts` tests (titles kept, retargeted from `aside .sidebar-scroll` to
  `[data-testid="previous-sessions-list"]`): 298, 376, 414 (re-expressed as one surface-1 header band over one
  scrolling list, A-10), 457, 487, 515, 527, 553, 572, 607, 618, 623, 667, 690, 710. It adds:
  - **Req 2.1:** role, `aria-modal`, name "Previous sessions"; initial focus on search.
  - **Req 2.2:** Tab wraps.
  - **Req 2.3:** Escape closes.
  - **Req 2.4:** Escape in rename only cancels; Escape on the Filters popover only closes it.
  - **Req 2.5:** focus returns to the opener on Close, Escape, backdrop and select.
  - **Req 2.7:** backdrop with the `pointerdown` rule.
  - **Req 2.8:** focus after organizer close and delete cancel/confirm; panel inert while nested.
  - **Req 2.9:** close/reopen keeps state with no new `session:list`.
  - **D-1:** select calls `requestCanvasSession` (grid) or `switchSession` (single) and closes.
  - **D-10/D-11:** Tab order is open, Organize, Rename, Delete.
  - **E-1:** skeleton while booting.
  - **E-2:** empty state.
  - **E-4:** Load More states and focus.
- **Files.**
  - CREATE `O/previous-sessions/previous-sessions-modal.component.ts`
  - CREATE `O/previous-sessions/previous-sessions-modal.component.html`
  - CREATE `O/previous-sessions/previous-sessions-modal.component.spec.ts`
  - CREATE `O/previous-sessions/session-row-groups.ts` (content of `T/session-row-groups.ts`, import path to the
    labels adjusted)
  - CREATE `O/previous-sessions/session-row-groups.spec.ts` (from `T/app-shell.organization.spec.ts:734-815`)

### 8. Presentational molecules: toolbar and row

**8a. PreviousSessionsToolbarComponent**

- **Purpose.** The header query controls for both host variants (design §3.4).
- **Responsibilities.**
  - Inputs:
    - `organizationAvailable`, `listQuery`;
    - `searchQuery`, `dateFrom`, `dateTo`, `dateFilterOpen`, `hasActiveFilters`.
  - Outputs:
    - `queryChange` (`SessionListQuery`);
    - `searchChange`, `dateFromChange`, `dateToChange`;
    - `dateFilterToggled`, `cleared`.
  - Organization variant: `ptah-session-filter-bar`. Plain variant: the local search with clear X
    (`data-testid="session-search-local"`, `aria-label="Search sessions by name"`). Then the Date range row (two
    columns) and `Clear` (`aria-label="Clear all filters"`).
  - Markup moved from `T/app-shell.component.html:123-221`.
- **Verified contracts and entry points.** Filter bar `query` input and `queryChange` output
  (`T/app-shell.component.html:127-132`; `M/session-filter-bar/session-filter-bar.component.ts`).
- **Dependencies.** `SessionFilterBarComponent`, lucide. No services.
- **Integration points.** Used only by the modal.
- **Failure behaviour.** n/a.
- **Quality requirements.** none beyond the shared rules.
- **Verification seam.** Covered by the modal spec (B-1, B-2, B-14, B-15). B-2 adds a test that the local clear X
  shows only with text and clears it.
- **Files.**
  - CREATE `M/previous-sessions-toolbar/previous-sessions-toolbar.component.ts`

**8b. SessionListRowComponent** (`selector: 'li[ptah-session-list-row]'`, with the same eslint selector exception as
`CV/canvas-rail/canvas-rail-card.component.ts:41-43`)

- **Purpose.** One row (design §3.6-§3.10).
- **Responsibilities.**
  - Inputs:
    - `session`, `depth`, `organizationAvailable`, `isCurrent`, `isOpenInTab`;
    - `workflow`, `editing`, `editingName`, `expiredHint`.
  - Outputs:
    - `opened`, `organizeRequested`, `renameRequested`;
    - `renameNameChange`, `renameCommitted`, `renameCancelled`;
    - `deleteRequested`.
  - Host bindings:
    - `[class.session-row-current]`, `[class.session-row-open-tab]`;
    - `ml-3/6/9` by depth;
    - `[attr.data-depth]`, `[attr.data-session-id]`.
  - D12: the host `li` carries the fill and the 2 px inset accent, so the chips line is inside the highlight. Hover
    paints the `li` but must not override the current fill (`:host(:not(.session-row-current):hover)`).
  - The row button `data-action="open"` carries `aria-current`. Actions are `data-action="organize|rename|delete"`
    with the existing names and `data-testid="session-organize"`. The edit input has `maxlength="200"` and
    `aria-label="Edit session name"`, plus the hint `aria-describedby`. Expired title and meta follow design §3.6/§3.7.
  - Formatting via `SessionDisplayUtils` (pure, injected). Live phase, chips and workflow badge components are reused
    unchanged.
- **Verified contracts and entry points.** Moved row markup at `T/app-shell.component.html:228-393`.
  `SessionDisplayUtils` at `T/app-shell.component.ts:186, 842-852`.
- **Dependencies.**
  - Atoms `WorkflowBadgeComponent`, `SessionOrganizationChipsComponent`, `SessionLivePhaseIndicatorComponent`.
  - `SessionDisplayUtils`.
- **Integration points.** Used only by the modal.
- **Failure behaviour.** n/a.
- **Quality requirements.** 24×24 action targets. Actions are always visible on `hover: none`.
- **Verification seam.** CREATE `M/session-list-row/session-list-row.component.spec.ts`:
  - C-3: `N msgs` only when > 0;
  - C-4: expired marker and tooltip;
  - C-5/D12: current class on the `li` that contains the chips, and `aria-current` on the button;
  - C-6: open-tab class and sr-only "Open in a tab";
  - D-2: Enter, blur and Escape outputs; Escape stops propagation; maxlength 200;
  - C-10: child prefix.
- **Files.**
  - CREATE `M/session-list-row/session-list-row.component.ts`
  - CREATE `M/session-list-row/session-list-row.component.spec.ts`
  - MODIFY `M/session-filter-bar/session-filter-bar.component.ts`: class and wrapper changes only (design §3.4 D-8:
    one wrapping toolbar at ≥640, the muted placeholder `placeholder:text-base-content-muted`, and
    `max-h-[min(34rem,70dvh)] overflow-y-auto` on the popover content).
  - MODIFY `M/session-filter-bar/session-filter-bar.component.spec.ts`: add B-7 (task id debounced into `taskId`) and
    the B-2 clear-X test.

### 9. Rail: footer entry button and card Rename/Organize (canvas)

- **Purpose.** D5 entry in the Rail, and the D9 menu actions.
- **Responsibilities.**
  - **`CanvasRailComponent`** (design §2.1-§2.2):
    - Footer `h-[120px]` (expanded) / `h-[82px]` (collapsed), with `div.flex.flex-col.gap-1.5` holding New session
      (unchanged) and then the new button.
    - The new button has `type="button"`, `data-testid="rail-previous-sessions"`, `data-previous-sessions-trigger`,
      `aria-haspopup="dialog"`, `[attr.aria-expanded]="previousSessionsOpen()"`, and `aria-controls` only while open.
      Expanded it shows History + "Previous sessions". Collapsed it is icon-only with
      `aria-label`/`title="Previous sessions"`.
    - The reason `<p id="rail-new-session-reason">` moves below both buttons. It is `sr-only` when collapsed, where
      New session gets `title` set to the reason.
    - New `input previousSessionsOpen = input(false)` and `output previousSessionsRequested = output<void>()`.
    - The button is never disabled (Req 1.5).
  - **`CanvasRailBoardComponent`** injects `PreviousSessionsDialogService` from `@ptah-extension/chat` and binds
    `[previousSessionsOpen]="previousSessions.isOpen()"` and `(previousSessionsRequested)="previousSessions.open()"`.
  - **`CanvasRailCardComponent`** (design §8.1-§8.7). It injects `SessionRowActionsService`, `SessionOrganizerService`
    and `SESSION_NAME_MAX_LENGTH` from `@ptah-extension/chat`.
    - `sessionId = computed(() => tab()?.claudeSessionId ?? null)`.
    - Menu order: Open beside, Rename (`data-action="rename"`, `aria-haspopup="dialog"`), Organize
      (`data-action="organize"`, only when `organizer.available()`), separator (`role="separator"`), Move up, Move down.
    - Disabled items use `aria-disabled` plus a reason id (`rail-rename-reason-{tabId}`, `rail-organize-reason-{tabId}`)
      and no `opacity-60` (design §8.5).
    - **[choice-dependent]** Organize enablement for a persisted session:
      - Option (b): enabled only when `organizer.rowFor(sessionId)` is not null. Otherwise it is disabled with
        "Find this session in Previous sessions to organize it."
      - Options (a) and (c): always enabled for a persisted session on an organization host.
      - Under every option: drafts are disabled with "Send a first message to save this session." and VS Code shows
        no Organize.
  - **Rename popover structure (DP-6, review finding 2).** An outer
    `<ptah-native-popover [isOpen]="renameOpen()" placement="right-start" [hasBackdrop]="true" backdropClass="transparent" (opened)="onRenameOpened()" (closed)="cancelRename()" class="[&>.popover-trigger]:block">`
    sits inside `#actions`.
    - Its `trigger` slot holds the existing menu `<ptah-native-popover trigger …>`, which keeps the ⋮ `<button trigger #trigger>`.
    - Its `content` slot holds the Rename form, with no `role="menuitem"`:
      - `h3` "Rename session";
      - an input with `maxlength` set to `SESSION_NAME_MAX_LENGTH`, `aria-label="Session name"`, Enter saves;
      - Cancel and Save buttons.
    - Closing the menu destroys only the menu panel; the Rename form is never inside it.
  - **Single handoff sequence (Rename).**
    1. `startRename()`: if disabled, return.
    2. `renameDraft.set(tab().title)`, then `closeMenu()`. This sets the menu closed and focuses the trigger synchronously.
    3. `afterNextRender(() => { if (!menuOpen()) renameOpen.set(true) }, { injector })`. By now the menu's close effect
       has run and its focus restore targets the same trigger.
    4. The outer popover opens. It stores `activeElement` (the trigger) as its return target and focuses its panel.
    5. `onRenameOpened()` focuses and selects the input.
    6. Save / Enter: `await actions.rename(sessionId, tab().title, draft)`, then `renameOpen.set(false)`.
    7. Cancel, Escape (the outer host handles it and stops propagation) or backdrop: `renameOpen.set(false)`.
    8. The outer popover's close restores focus to the trigger. Then `afterNextRender` falls back to `.rc-select` /
       `.rail-collapsed` when the trigger is disconnected (design §8.4).
    9. There is no blur-save.
  - **Organize sequence.** `startOrganize()`: if disabled, return; `closeMenu()` (focus to the trigger); then:
    - Option (b): `organizer.open(sessionId, restore)`.
    - **[choice-dependent, (a)/(c)]** `const r = await organizer.openForSession(sessionId, tab().name, restore)`. On
      `'failed'` the editor stays closed, focus stays on the trigger, and the card's existing polite `announcement`
      says "Could not load this session's organization." (the service logs the failure).

    `restore` is `() => focus trigger ?? select button`. The editor focuses its close button after render (its own
    `afterNextRender`), so that runs after the menu's close restore.
  - The card host `onClick` already ignores clicks inside `#actions` (`CV/canvas-rail/canvas-rail-card.component.ts:307-317`).
    The outer popover renders inside `#actions`, so the Rename panel and its backdrop never select the card.
  - Update the comment at `CV/orchestra-canvas.component.ts:57` (the sidebar delegation no longer exists).
- **Verified contracts and entry points.**
  - Footer at `CV/canvas-rail/canvas-rail.component.ts:231-251`, outputs at `:274-288`.
  - Board wiring at `CV/canvas-rail/canvas-rail-board.component.ts:82-112`.
  - Card menu, `closeMenu` and `menuItems` at `CV/canvas-rail/canvas-rail-card.component.ts:180-240, 341-398`.
  - `TabState.claudeSessionId`, `title` at `chat-types.ts:610, 636`.
  - Native popover at the lines cited in Codebase evidence.
- **Dependencies.** canvas → chat (existing edge), canvas → ui (existing).
- **Integration points.**
  - Rename updates `ChatStore` and the tab through the service, so the card title, the open tab and later modal rows
    agree (Req 10.6).
  - Organize opens the shell-rendered editor through the service.
- **Failure behaviour.**
  - Rename `'failed'`: the popover closes, the title is unchanged, and the failure is logged by the service (design §8.7).
  - **[choice-dependent]** Organize when the row is not loaded: under (b), disabled with a reason; under (a)/(c),
    fetched, and on failure announced and logged.
  - Modal open: the Rail is inert, so both entry points never coexist.
- **Quality requirements.**
  - The footer height is fixed, so the list never jumps.
  - The collapsed-Rail reason fits as sr-only.
  - The Previous sessions focus ring is not clipped (the footer is outside the scroll container).
- **Verification seam.**
  - MODIFY `CV/canvas-rail/canvas-rail.component.spec.ts`:
    - the button is under New session;
    - its name is "Previous sessions" in both forms;
    - it is enabled when New is disabled;
    - it emits `previousSessionsRequested`;
    - `aria-expanded` follows the input;
    - the reason is below both buttons and sr-only when collapsed.
  - MODIFY `CV/canvas-rail/canvas-rail-board.component.spec.ts`: wiring calls `PreviousSessionsDialogService.open`.
  - MODIFY `CV/canvas-rail/canvas-rail-card.component.spec.ts`:
    - Rename/Organize items and order;
    - Organize absent when unavailable;
    - draft disabled with reason;
    - **[choice-dependent]** a persisted card whose session is excluded from the current loaded page:
      - (b): Organize is disabled with its reason;
      - (a)/(c): Organize calls `openForSession`, and on `'failed'` the announcement is set;
    - handoff: the menu closes, Rename opens only after render, the input is focused;
    - Enter calls `rename`; Escape cancels;
    - focus returns to the trigger;
    - Organize calls `organizer.open` with the session id.
- **Files.**
  - MODIFY `CV/canvas-rail/canvas-rail.component.ts`
  - MODIFY `CV/canvas-rail/canvas-rail.component.spec.ts`
  - MODIFY `CV/canvas-rail/canvas-rail-board.component.ts`
  - MODIFY `CV/canvas-rail/canvas-rail-board.component.spec.ts`
  - MODIFY `CV/canvas-rail/canvas-rail-card.component.ts`
  - MODIFY `CV/canvas-rail/canvas-rail-card.component.spec.ts`
  - MODIFY `CV/orchestra-canvas.component.ts` (comment only)

### 10. AppShellComponent: sidebar removal, modal host and navbar entry

- **Purpose.** The shell stops owning a session list and only hosts the modal and the editor.
- **Responsibilities.**
  - **Template (`T/app-shell.component.html`):**
    - Delete the aside `:99-547` (incl. resize handle `:523-546`) and the `Sessions` tab `:549-556`.
    - Add `[attr.inert]="previousSessions.isOpen() ? '' : null"` on `#shellRow` (`:88-98`). The `#shellRow` template
      ref becomes unused, so remove it.
    - At the root, next to the editor, add the deferred modal (component 7).
    - Retarget the editor block `:19-26` to `organizer.session()` / `organizer.close()` with
      `@defer (when organizer.isOpen(); prefetch on idle)`.
    - In the navbar Session group, directly after `</ptah-native-popover>` (`:775`), add
      `@if (!isElectron && layoutMode() === 'single')`. It holds a button with `type="button"`,
      `data-testid="navbar-previous-sessions"`, `data-previous-sessions-trigger`, `aria-haspopup="dialog"`,
      `aria-expanded`, `aria-label`/`title="Previous sessions"`, the History icon and
      `span.icon-btn-label.text-xs "Previous sessions"` (design §2.3).
  - **Class (`T/app-shell.component.ts`):**
    - Delete:
      - `_sidebarOpen` / `sidebarOpen`;
      - `chosenSidebarWidth`, `shellRowWidth`, `sidebarMaxWidth`, `sidebarWidth`, `_sidebarResizing` /
        `sidebarResizing`, `sidebarMinWidth`, `sidebarResizeStartX/Width`;
      - `expiredTranscriptHint` (moves to the modal);
      - `editingSessionId/Name`, `ptahIconUri`;
      - the search/date signals, `organizationAvailable`, `listQuery`;
      - `hasClientFilters`, `hasServerFilters`, `hasActiveFilters`, `filteredSessions`, `sessionGroups`;
      - `organizingSessionId`, `organizingSession`;
      - `editSessionInput`, `sidebarResizeHandle`, `shellRow` and the width-observer effect (`:452-455`);
      - `toggleSidebar`, every `onSidebarResize*`, `resetSidebarWidth`, `begin/apply/commitExternalSidebarResize`,
        `observeShellRowWidth`, `applySidebarWidth`, `readStoredSidebarWidth`, `persistSidebarWidth`;
      - `clearFilters`, `onListQueryChange`, `openOrganizer`, `closeOrganizer`, `toggleDateFilter`, `setSearchQuery`,
        `setDateFrom`, `setDateTo`, `formatRelativeDate`, `getSessionDisplayName`, `onSessionClick`, `isSessionOpen`,
        `startEditingSession`, `cancelEditingSession`, `saveSessionName`, `deleteSession`.
    - Delete the now-unused imports:
      - `NgClass`, `NgTemplateOutlet`, `linkedSignal`, `ElementRef`;
      - `SidebarTabComponent`, `WorkflowBadgeComponent`, `SessionFilterBarComponent`,
        `SessionOrganizationChipsComponent`, `SessionLivePhaseIndicatorComponent`;
      - `groupSessionRows`, all `session-sidebar-width` imports;
      - `SessionDisplayUtils`, `ChatSessionSummary`, `SessionListQuery`;
      - icons used only by the sidebar (CalendarDays, ChevronDown, MessageSquare, Pencil, Trash2, Search, Tag).
      - Keep X, Check and Plus (New session popover).
      - The implementer confirms each symbol with the template; `viewChild` stays for `sessionNameInputRef`.
    - Add:
      - `protected readonly previousSessions = inject(PreviousSessionsDialogService)`;
      - `protected readonly organizer = inject(SessionOrganizerService)`;
      - `openPreviousSessions(): void`;
      - an effect: when `isStandaloneView()` while open, `previousSessions.close({ restoreFocus: false })` (DP-9).
  - Delete `T/session-row-groups.ts` (moved by component 7).
  - Delete `T/app-shell.organization.spec.ts` (every test re-homed in components 2, 4 and 7).
- **Verified contracts and entry points.** All line references above. `isStandaloneView` at `T/app-shell.component.ts:221-223`.
  `layoutMode` and `isElectron` at `:209, 308`.
- **Dependencies.** Components 3, 4 and 7.
- **Integration points.** Electron shell (component 11). Canvas via the DI token (unchanged).
- **Failure behaviour.** The modal chunk load fails: `@defer` shows nothing. The button keeps `aria-expanded=true`
  until close. The user can press Escape or the button again. Accepted. The editor uses the same pattern today.
- **Quality requirements.** The eager bundle must not grow by the modal chunk (`@defer`).
- **Verification seam.**
  - CREATE `T/app-shell.previous-sessions.spec.ts`:
    - **Req 7.1:** no `aside`, no "Toggle Sessions panel", no "Resize session sidebar".
    - **Req 1.3/F-1:** the navbar button appears right after `New` only in VS Code single layout, with name
      "Previous sessions", `aria-haspopup="dialog"` and `aria-expanded`.
    - **Req 1.7:** click, Enter and Space open (service spy).
    - `#shellRow` is inert while open.
    - The modal closes without restore on a standalone view.
  - The existing app-shell specs (`app-shell.retained-chrome`, `notification-center`, `outlet-wrapper`, `auth-redirect`)
    must still pass. Their TestBed providers may lose now-unused stubs.
- **Files.**
  - MODIFY `T/app-shell.component.ts`
  - MODIFY `T/app-shell.component.html`
  - CREATE `T/app-shell.previous-sessions.spec.ts`
  - DELETE `T/session-row-groups.ts`
  - DELETE `T/app-shell.organization.spec.ts`

### 11. Electron shell divider removal

- **Purpose.** Remove the A-6 divider (approved D6).
- **Responsibilities.**
  - Delete the `@if (layout.workspaceSidebarVisible()) { <ptah-electron-resize-handle … onSessionsDivider…> }` block
    (`T/electron-shell.component.ts:290-301`).
  - Delete the import at `:51`.
  - Delete `sessionsShell`, `sessionsDividerAnchor`, `onSessionsDividerMouseDown/Drag/DragEnd` (`:377-419`).
  - Keep `ElectronResizeHandle` for the editor panel (`:319`), `viewChild`, `ElementRef` (`configurationSurfaceHost`),
    and `AppShellComponent` in `imports`.
- **Verified contracts and entry points.** As cited.
- **Dependencies.** none new.
- **Integration points.** The Workspaces sidebar and its tab are unchanged (Req 7.2).
- **Failure behaviour.** n/a.
- **Quality requirements.** none beyond the shared rules.
- **Verification seam.** MODIFY `T/electron-shell.activity-placement.spec.ts:188-215`. Replace the divider test with
  "renders no sessions divider next to a visible workspace sidebar" plus "the workspace sidebar width is untouched"
  (Req 7.2). The other tests stay.
- **Files.**
  - MODIFY `T/electron-shell.component.ts`
  - MODIFY `T/electron-shell.activity-placement.spec.ts`
  - DELETE `T/session-sidebar-width.ts`
  - DELETE `T/session-sidebar-width.spec.ts`

### 12. Global CSS cleanup

- **Purpose.** Delete the session-only global CSS (Req 7.3).
- **Responsibilities.**
  - Delete `.sidebar-item-open-tab` in the light block (`W/styles.css:2278-2281`) and in the dark block (`:2300-2304`).
  - Delete `.sidebar-scroll` and both `aside:not(:hover)` rules (`:2306-2338`).
  - Keep both `.sidebar-item-active` rules (DP-3) and retitle the section comment, because it now serves the
    Workspaces sidebar.
- **Verified contracts and entry points.** As cited. `.sidebar-scroll` users are only the deleted aside and the e2e
  helper (component 13).
- **Dependencies.** n/a.
- **Integration points.** n/a.
- **Failure behaviour.** n/a.
- **Quality requirements.** n/a.
- **Verification seam.**
  - A repo grep for `sidebar-item-open-tab|sidebar-scroll` returns only `.ptah/specs` history.
  - The visual review confirms the Workspaces sidebar active row is unchanged.
- **Files.**
  - MODIFY `W/styles.css`

### 13. E2E specs, helpers, docs shots and harness scenarios (update, never delete)

- **Purpose.** Keep every listed spec running against the modal (Req 9.2-9.3).
- **Responsibilities and selector changes.**
  - **`E/support/perf-session-fixture.ts`:**
    - Add `openPreviousSessions(page)`. It is idempotent: if `getByRole('dialog', { name: 'Previous sessions' })` is
      not visible, it clicks `[data-previous-sessions-trigger]` (first visible) and waits for the dialog.
    - Add `openSessionFromList(page, name)`: open, then click `sessionRowButton`, then expect the dialog hidden.
    - `sessionRowButton(page, name)` is rescoped to
      `[data-testid="previous-sessions-list"] li:not([data-testid="session-group"])`, filtered by name, then
      `[data-action="open"]`.
    - `prepareCanvasWithSessions` calls `openPreviousSessions` before asserting that each row is visible, and leaves
      the modal open.
    - `resolveButtonHandles` is replaced by in-page row resolution (below) and deleted.
  - **`E/support/perf-page-capture.ts`:** `openTilesWithinPage(page, rowNames: string[], markers, timeoutMs)`. Per name,
    in-page:
    1. Click the first `[data-previous-sessions-trigger]`.
    2. Wait for rAF until the row `[data-testid="previous-sessions-list"] li` with matching text exists, bounded by
       `timeoutMs`.
    3. Click its `[data-action="open"]`.
    4. Then the existing rAF/scan.
  - **`E/specs/chat/tile-load-older-history.spec.ts`:** the local `openSession` (`:37-41`) uses `openSessionFromList`.
    Tests `:340, :355, :370, :387, :407` stay intact.
  - **`E/specs/chat/tile-open-longtask-budget.perf.spec.ts`:**
    - Warm-up clicks (`:293`, `:526`) use `openSessionFromList`.
    - `resolveButtonHandles` calls are replaced by passing the names to `openTilesWithinPage`.
    - The header comment discloses that the window now includes opening the modal (DP-13).
    - Tests `:273, :443, :511, :595` stay.
  - **`E/specs/git/change-set-card.spec.ts`:** the local `openSession` (`:132-136`) uses `openSessionFromList`.
    Tests `:171, :254` stay.
  - **`E/specs/git/visual-review.spec.ts`:** `:1072` uses `openSessionFromList`.
  - **`E/specs/canvas/canvas.spec.ts:215-220`:** the locator becomes
    `railBoard(page).locator('ptah-canvas-rail [data-testid="rail-previous-sessions"]')`. The comment changes to say it
    is now the last tabbable Rail element. The test intent (Rail → pane hand-off) is unchanged.
  - **`E/docs-screenshots/sessions.shot.ts:19-41`:**
    - `openPreviousSessions(page)`.
    - `search = dialog.getByPlaceholder('Search sessions...')`.
    - The crop target is the panel `[data-testid="previous-sessions-modal"] [role="dialog"]`.
    - The date toggle is scoped to that panel.
    - Shot names stay `sessions-overview` / `sessions-history`.
    - Escape closes the modal before the canvas tile part (`:43+`).
  - **`E/docs-screenshots/editor-git.shot.ts:38-48`:** `collapseRails` iterates `['Toggle Workspaces panel']` only, and
    the doc comment is updated.
  - **Harness (`H/sessions/`).** Each step first checks that the SPA is booted (`#ptah-e2e-fixture-root` absent). If
    it is, the step opens Previous sessions (`getByRole('button', { name: 'Previous sessions' }).first()`) and asserts
    the dialog is visible as a hard expectation. Otherwise the existing defensive skip stays.
    - `session-list.e2e.spec.ts`: test "renders session list…" opens the modal.
    - `session-delete.e2e.spec.ts`:
      - every test opens the modal before searching `/delete session/i`;
      - the confirm and cancel clicks are scoped to `getByRole('dialog', { name: 'Delete Session' })` (component 6
        gives it that name), so they cannot hit row buttons named "Delete session: …".
    - `session-create.e2e.spec.ts`: after the create attempt, open the modal, assert the dialog, then press Escape.
  - Every test body and title stays. None is deleted.
- **Verified contracts and entry points.** All lines are from parity-inventory "E2E specs that target the sidebar" and
  the reads above.
- **Dependencies.** The test ids and names from components 6, 7, 8, 9 and 10.
- **Integration points.** n/a.
- **Failure behaviour.** n/a.
- **Quality requirements.** none beyond the shared rules.
- **Verification seam.**
  - `typecheck` and `lint` of `ptah-electron-e2e` and `@ptah-extension/webview-e2e-harness`.
  - The D7 runs, one at a time (Team-leader handoff).
- **Files.**
  - MODIFY `E/support/perf-session-fixture.ts`
  - MODIFY `E/support/perf-page-capture.ts`
  - MODIFY `E/specs/chat/tile-load-older-history.spec.ts`
  - MODIFY `E/specs/chat/tile-open-longtask-budget.perf.spec.ts`
  - MODIFY `E/specs/git/change-set-card.spec.ts`
  - MODIFY `E/specs/git/visual-review.spec.ts`
  - MODIFY `E/specs/canvas/canvas.spec.ts`
  - MODIFY `E/docs-screenshots/sessions.shot.ts`
  - MODIFY `E/docs-screenshots/editor-git.shot.ts`
  - MODIFY `H/sessions/session-list.e2e.spec.ts`
  - MODIFY `H/sessions/session-create.e2e.spec.ts`
  - MODIFY `H/sessions/session-delete.e2e.spec.ts`

## Integration architecture

- **Data flow.**
  1. **Open.** The user activates a Rail footer or navbar button. `PreviousSessionsDialogService.open()` stores the
     opener. In the same render, `#shellRow` gets `inert`, the triggers get `aria-expanded=true`, and the deferred
     modal mounts. The modal's `afterNextRender` focuses search.
  2. **Query.**
     - The toolbar emits a change.
     - Organization hosts: `SessionListViewStore.setListQuery`, then `ChatStore.setListQuery`. This is debounced in
       the bar and deduplicated in the loader. It sends `session:list` (unchanged contract).
     - Plain hosts: local `searchQuery` filters `ChatStore.sessions()`.
     - The date range is client-side on every host.
  3. **Select.** The row emits `opened`. `SessionRowActionsService.openSession` calls `requestCanvasSession` (grid) or
     `switchSession` (single). Then `dialog.close()` unmounts the modal and removes `inert` in the same render.
     `afterNextRender` focuses the opener.
  4. **Rename (modal).** The inline input commits, then `actions.rename`, then `session:rename`. `ChatStore` and the tab
     update. The Rail card title and later modal rows read the same store (Req 10.6).
  5. **Rename (Rail).** Menu, then the Rename popover (component 9 sequence), then the same `actions.rename`.
  6. **Organize.** From a modal row or a Rail card: `organizer.open(id, restore)`. The shell-root editor opens at z 999
     and the modal panel becomes inert. Editor mutations go through the existing organization RPCs and
     `session:organizationChanged`, which refreshes `ChatStore` (E-6). On close, `organizer.close()` drops the panel
     `inert` in the render, then the owner's restore runs.
  7. **Delete.** Row, then `actions.deleteSession`. The confirm dialog opens (panel inert, Cancel focused). On cancel it
     returns `'cancelled'` and the modal focuses Delete. On confirm it sends `session:delete`; the list, workflow
     mapping, current session, tab and organizer update. The modal focuses the next or previous row, or search.
  8. **Close.** Escape, Close or backdrop calls `dialog.close()`, and focus returns to the opener.
- **State or persistence.**
  - `SessionListViewStore` (root) owns search, date and date-panel state for the app session. It is not persisted (B-16).
  - `ChatStore` / `SessionLoaderService` own `listQuery` and loaded pages (unchanged).
  - `PreviousSessionsDialogService` owns open state and the opener.
  - `SessionOrganizerService` owns the editor target.
  - The modal component owns only transient UI: `editingSessionId`, announcements and Load More bookkeeping.
- **External boundaries.**
  - No new RPC. `session:rename` input is trimmed and capped at 200 characters client-side (the backend contract is
    unchanged).
  - No HTML injection: names render through Angular interpolation.
  - The organization editor keeps its https-only PR rule.
- **Failure and rollback.**
  - Rename and delete failures are logged by `LoggingService`. The UI is not mutated, so there is nothing to roll back.
  - Organization errors stay inline in the editor.
  - A list load failure has no UI (E-5).
  - A modal chunk load failure is handled per component 10.
  - Focus targets that no longer exist fall back as specified, never to `body` when a fallback exists.
- **Observability.** `LoggingService.error` with the context `SessionRowActions` for rename and delete failures (this
  replaces `console.error` at `T/app-shell.component.ts:927-933, 974-980`). Focus and inert behaviour are observable
  only through the specs and the visual review.

## Architecture-level quality requirements

- **Functional.**
  - Requirements 1-10 and every `move`/`keep` parity row are reachable from the modal or the Rail. Each has the test
    named in its component.
  - No `aside`, `Sessions` tab, resize separator or divider remains on any host.
- **Performance.**
  - The modal is code-split (`@defer … prefetch on idle`) and the eager bundle does not include it.
  - No per-row timers, observers or listeners.
  - One `computed` chain from `ChatStore.sessions()` to the rows.
  - Reopen sends no `session:list`.
- **Security.** No new trust boundary. Inputs are length-capped. No `innerHTML`.
- **Maintainability.**
  - `AppShellComponent` loses about 480 lines of class code and about 460 lines of template.
  - No new lib edge: canvas → chat is pre-existing and chat never imports canvas.
  - New projects: none. Tags are unchanged.
  - Every Angular file follows standalone, OnPush, `inject()`, `input()` and `output()`.
- **Testability.** The tests must prove these behaviours:
  - The query survives close/reopen with no new list request.
  - Focus wraps, Escape closes only the innermost layer, and focus returns to the opener or the specified fallback for
    every close path, including nested dialogs.
  - D12: the current-row highlight contains the chips line.
  - The Rail Rename handoff opens only after the menu has closed and returns focus to the trigger.
  - Updated e2e paths reach the list through the modal.

## Team-leader handoff

- **Recommended executors.**
  - Components 1-12: frontend-developer (Angular UI, view stores, styling).
  - Component 13: senior-tester. It is test code, and senior-tester owns the D7 runs and evidence.
  - **[choice-dependent, option (a) only]** backend-developer for the `session:getOrganization` RPC (shared types and
    rpc-handlers).
- **Complexity.** HIGH.
  - Two hosts × two layouts and three entry placements.
  - Nested-layer focus ordering across three overlay mechanisms.
  - Removal of an embedded surface from a large shell.
  - Twelve e2e files plus a spec migration.
- **Dependencies and ordering (component level).**
  - 1-5 have no prerequisites.
  - 6 needs 5.
  - 8 needs 1 (types only).
  - 7 needs 1-6 and 8.
  - 9 needs 2-4.
  - 10 needs 3, 4 and 7.
  - 11 is independent but lands with 10 (same folder, same removal).
  - 12 after 10.
  - 13 after 6, 7, 9 and 10 (test ids and names).
  - **[choice-dependent, (a)]** The (a) part of component 4 needs the new RPC type in `@ptah-extension/shared`
    (batch B0).
- **Parallel-safe work.** Component 9 (canvas files) is file-disjoint from 6-8 and 10-12 once 1-4 have landed.
- **Proposed batch split (advisory; the team-leader finalizes).** File-disjoint and ordered:
  0. **B0, backend-developer. [choice-dependent: only if the user picks option (a)]**
     - `libs/shared/src/lib/types/rpc/rpc-session.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`;
     - `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts`,
       `session-organization-rpc.handlers.ts`, `.spec.ts`.
     - It must land before B1.
  1. **B1, frontend-developer.** Components 1-5:
     - `S/session-list/*` (four services and specs);
     - `libs/frontend/chat/src/lib/utils/focus-wrap.utils(.spec).ts`;
     - `S/index.ts`;
     - **[choice-dependent, (a)/(c)]** `S/chat-message-handler.service.ts` and `.spec.ts`.
  2. **B2, frontend-developer.** Components 6a, 6b and 8a/8b plus the filter-bar changes:
     - `M/confirmation-dialog.component(.spec).ts`;
     - `M/session-organization-editor/session-organization-editor.component(.spec).ts` (Gate 2 finding 1);
     - `M/previous-sessions-toolbar/*`;
     - `M/session-list-row/*`;
     - `M/session-filter-bar/*`.
  3. **B3, frontend-developer.** Component 7: `O/previous-sessions/*`. This creates the moved `session-row-groups.ts`
     and its spec. The old `T/session-row-groups.ts` stays until B4, so the branch typechecks between commits.
  4. **B4, frontend-developer.** Components 10, 11 and 12: `T/app-shell.*`, `T/electron-shell.*`,
     `T/session-sidebar-width*` (delete), `T/session-row-groups.ts` (delete), `T/app-shell.organization.spec.ts`
     (delete), `W/styles.css`.
  5. **B5, frontend-developer.** Component 9: canvas files. It can run in parallel with B2-B4 after B1.
  6. **B6, senior-tester.** Component 13: e2e and harness files. Then the D7 runs.
- **Files affected.**
  - CREATE:
    - `S/session-list/session-list-view.store.ts`, `.spec.ts`
    - `S/session-list/session-row-actions.service.ts`, `.spec.ts`
    - `S/session-list/previous-sessions-dialog.service.ts`, `.spec.ts`
    - `S/session-list/session-organizer.service.ts`, `.spec.ts`
    - `libs/frontend/chat/src/lib/utils/focus-wrap.utils.ts`, `.spec.ts`
    - `M/confirmation-dialog.component.spec.ts`
    - `M/previous-sessions-toolbar/previous-sessions-toolbar.component.ts`
    - `M/session-list-row/session-list-row.component.ts`, `.spec.ts`
    - `O/previous-sessions/previous-sessions-modal.component.ts`, `.html`, `.spec.ts`
    - `O/previous-sessions/session-row-groups.ts`, `.spec.ts`
    - `T/app-shell.previous-sessions.spec.ts`
  - MODIFY:
    - `S/index.ts`
    - `M/confirmation-dialog.component.ts`
    - `M/session-organization-editor/session-organization-editor.component.ts`, `.spec.ts`
    - `M/session-filter-bar/session-filter-bar.component.ts`, `.spec.ts`
    - **[choice-dependent, (a)/(c)]** `S/chat-message-handler.service.ts`, `.spec.ts`
    - **[choice-dependent, (a)]**
      - `libs/shared/src/lib/types/rpc/rpc-session.types.ts`, `libs/shared/src/lib/types/rpc.types.ts`
      - `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.schema.ts`
      - `libs/backend/rpc-handlers/src/lib/handlers/session-organization-rpc.handlers.ts`, `.spec.ts`
    - `T/app-shell.component.ts`, `.html`
    - `T/electron-shell.component.ts`, `T/electron-shell.activity-placement.spec.ts`
    - `W/styles.css`
    - `CV/canvas-rail/canvas-rail.component.ts`, `.spec.ts`
    - `CV/canvas-rail/canvas-rail-board.component.ts`, `.spec.ts`
    - `CV/canvas-rail/canvas-rail-card.component.ts`, `.spec.ts`
    - `CV/orchestra-canvas.component.ts`
    - the twelve e2e/harness files in component 13
  - DELETE:
    - `T/session-sidebar-width.ts`, `T/session-sidebar-width.spec.ts`
    - `T/session-row-groups.ts`
    - `T/app-shell.organization.spec.ts` (all tests re-homed; Req 9.1)
- **Verification points.**
  - Before coding, confirm every cited `file:line` (they are from base `851846797`).
  - Grep for removed symbols. The no-match gate covers runtime source, tests, e2e helpers and styles only:
    `apps/` and `libs/` (Gate 2 finding 3). These must return nothing there:
    - `sidebarOpen`, `toggleSidebar`, `ExternalSidebarResize`;
    - `session-sidebar-width`, `SESSION_SIDEBAR_`;
    - `sidebar-scroll`, `sidebar-item-open-tab`;
    - `Toggle Sessions panel`, `Resize session sidebar`;
    - `templates/session-row-groups`.

    Matches elsewhere are informational and not a gate. Examples: `.ptah/specs` history, docs, and the
    `tools/mcp-bench` benchmark fixtures such as `tools/mcp-bench/questions/7910f34cf/symbols-exact.json:2151`.
  - No `console.` appears in new or changed lib code.
  - No element has both `class=""` and `[class]=""`.
  - No import from `@ptah-extension/canvas` exists in chat.
  - Scoped checks (one heavy check at a time; the projects are `@ptah-extension/chat`, `@ptah-extension/canvas`,
    `ptah-electron-e2e`, `@ptah-extension/webview-e2e-harness`; `ptah-extension-webview` changes CSS only and is
    covered by the visual review):
    - Iterating on one lib:
      `npx jest -c libs/frontend/chat/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`
      (same for `libs/frontend/canvas/jest.config.ts`).
    - `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas --parallel=1`
    - `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/canvas --parallel=1 --maxWorkers=2`
      (A2: confirm the header says "Running target test for 2 projects" and that two Jest workers are used).
    - `npx nx run-many -t typecheck,lint -p ptah-electron-e2e @ptah-extension/webview-e2e-harness --parallel=1`
    - **[choice-dependent, option (a) only]**
      - `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1`
      - `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 --maxWorkers=2`
      - Guard specs in unedited host projects, scoped to the spec file:
        - `npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts --coverage=false --maxWorkers=2`
        - the same for `apps/ptah-electron/src/di/rpc-surface.spec.ts` (`apps/ptah-electron/jest.config.ts`)
        - the same for `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`, whose config is
          `libs/backend/cli-engine/jest.config.cjs` (verified in its `project.json` test target)
  - D7 runs (user exception), each once, one at a time, coordinated per D10 (announce, then free):
    - `npx nx e2e ptah-electron-e2e -- src/specs/chat/tile-load-older-history.spec.ts`
    - `npx nx e2e ptah-electron-e2e -- src/specs/chat/tile-open-longtask-budget.perf.spec.ts` (skips by default, DP-13)
    - `npx nx e2e ptah-electron-e2e -- src/specs/git/change-set-card.spec.ts`
    - `npx nx e2e ptah-electron-e2e -- src/specs/git/visual-review.spec.ts`
    - From `apps/ptah-electron-e2e`: `npx playwright test --config=docs-screenshots.config.ts src/docs-screenshots/sessions.shot.ts`,
      then the same for `editor-git.shot.ts`. Revert `apps/ptah-docs/public/screenshots` changes afterwards (DP-12).
    - `npx nx e2e @ptah-extension/webview-e2e-harness -- src/lib/scenarios/sessions/session-list.e2e.spec.ts`, then
      `session-create.e2e.spec.ts`, then `session-delete.e2e.spec.ts`.
    - Confirm the harness DOM steps ran, i.e. the placeholder was absent (A3).
  - Visual review: Electron at 1440, 760 and 400 px, dark and light. It covers:
    - the Filters popover at 400 px and on a short window (design §11.3);
    - the D12 highlight including chips;
    - the Rail footer expanded and collapsed with the reason shown;
    - the Rail Rename popover;
    - the Workspaces sidebar active row unchanged (DP-3);
    - A1 (full-window scrim).

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Focus restore runs while the panel or shell row is still `inert`, so focus is lost | MEDIUM | HIGH | Every restore is scheduled with `afterNextRender` after the state change that removes `inert` (components 3, 4, 6, 7, 9). Specs assert `document.activeElement` per close path. |
| The Rail menu close effect steals focus from the Rename popover | MEDIUM | MEDIUM | DP-6 nesting plus the single `afterNextRender` handoff. The card spec asserts the input is focused after both renders. |
| A background document-level Escape listener (canvas lane tabs, rail board) also fires | MEDIUM | MEDIUM | The modal and inline-rename Escape handlers call `stopPropagation()`. The confirm dialog does the same. |
| Rail Organize for a board session not in the loaded or filtered list | MEDIUM | MEDIUM | User choice (Gate 2 choice section). The risk per option: (a) LOW; (b) a disclosed, user-visible limit; (c) misses on name mismatch. |
| The organization editor's Tab escapes to the page while the modal panel is inert | MEDIUM | HIGH | Component 6b adds the Tab wrap and the post-render restore. The editor spec covers first and last wrap and focus return after inert removal. |
| A fixed modal is confined by a transformed Electron ancestor | LOW | HIGH | A1 check in the visual review. If it fails, find the ancestor that sets `transform`/`contain` and remove it there. Do not move the modal outside the shell. |
| The perf spec semantics change (the modal opens inside the measured window) and its helper path is not executed by default | HIGH | LOW | DP-13 disclosure. The shared helpers are exercised by three other specs. |
| `canvas.spec.ts` strict-mode failure if it is left unchanged | HIGH (if missed) | LOW | It is updated in component 13. Its run is a Clarification. |
| Harness scenarios pass vacuously when the SPA placeholder is served | MEDIUM | MEDIUM | Hard expectation once booted (A3). senior-tester confirms the placeholder was absent in each run. |
| Text typed in the last 250 ms before closing is dropped | LOW | LOW | Accepted (DP-14). |
| Deleting `.sidebar-item-active` per the design would break the Workspaces sidebar | HIGH (if followed literally) | MEDIUM | DP-3: kept. |
| D7 docs-shot runs leave regenerated tracked PNGs in the diff | HIGH | LOW | DP-12: revert after the run. |

## Clarifications Needed

1. `E/specs/canvas/canvas.spec.ts` must change because the Rail footer now has two buttons. D7 approved running only
   the 4 listed Electron specs, the 2 docs shots and the 3 harness scenarios. Should the updated `canvas.spec.ts`
   test also be run once?
   - (Recommended) Yes, run only that test once: `npx nx e2e ptah-electron-e2e -- src/specs/canvas/canvas.spec.ts -g "stacked split after a swap tabs from the Rail"`.
     This is the only other spec this change edits.
   - No. Update it and rely on typecheck and lint.

   This does not block implementation. Components 1-13 proceed either way. Only the B6 run list depends on the answer.

2. Rail Organize availability for a live session whose row is outside the loaded page or filters (Gate 2 review
   finding 2). The full options, files, guard specs, risks and recommendation are in "## Gate 2 choice: Rail Organize
   availability".
   - (Recommended) (a) A new read RPC `session:getOrganization { sessionId }` plus a one-entry cache. This adds a
     small backend scope (shared + rpc-handlers, batch B0).
   - (b) Keep the limit: Organize is disabled with a reason for such sessions. No backend change.
   - (c) A client-only targeted `session:list` lookup by name. No backend change, but it misses on name mismatch.

   This blocks only the [choice-dependent] parts of components 4 and 9 and batch B0. Everything else can start.
