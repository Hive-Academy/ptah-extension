# Requirements - TASK_2026_494

## Context

TASK_2026_493 (PR #565, merged) shipped the declarative dashboard contract and one MCP tool. `ptah_dashboard_propose_spec` validates a spec and pushes `dashboard:spec-proposed` to every attached webview surface. It then returns the dashboard as plain text (`libs/shared/src/mcp-apps-contracts/`, `libs/shared/src/lib/types/messages/payload-map.ts:234-245`). Nothing in the webview listens for that message today (no match for `DASHBOARD_SPEC_PROPOSED` under `libs/frontend` or `apps/`). The only visible result is the tool's text answer. TASK_2026_493 left three things to this task: the renderer-side trust controls ("text binds as text", "the renderer never calls a tool or RPC directly"), the second validation point in the webview, and confirmation of seven provisional budgets (`implementation-note.md`, Decisions 2 and 3, and "Deferred"). Its `context.md` "Decisions from review" also binds this task: a spec with no `sessionId` renders nowhere, and this task needs a test for that.

The Electron shell's tab row is hand-written in `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:122-205`. The shell renders it only when `layout.hasWorkspaceFolders()` is true (`:122`). Surfaces are routes. The id list and the `ViewType` union live in `libs/shared/src/lib/types/webview-surface.types.ts:38-73`, and the VS Code host's `WebviewHtmlGenerator` validates `initialView` against the same list. Routes are declared in `apps/ptah-extension-webview/src/app/app.routes.ts`. Non-startup surfaces load with `loadComponent: () => import(...)` and provide `SURFACE_ACTIVE` through `surfaceActiveFor(id)` (`:93-151`). The harness builder is the precedent for a page that runs its own agent session on its own streaming surface. `HarnessBuilderStateService.registerWorkflowSurface` (`libs/frontend/harness-builder/src/lib/services/harness-builder-state.service.ts:566-576`) registers with `StreamingSurfaceRegistry.register(..., { interactive: true })`. The view renders the permission and question prompts that are attached to that surface (`harness-builder-view.component.ts:301-317`, `:627-637`).

The user wants an Apps page, in Electron only. The page runs its own agent conversation, receives the specs that its conversation produces, and renders them with Ptah components from the fixed five-kind catalog. Sort, filter and page work on the client without the model. The user's selection goes back to the host, so the agent knows what the user is looking at. The coding chat stays exactly as it is. The page must not affect cold start when it is not opened. This is step 2 of Revision 4 Track A (`TASK_2026_490_583c/research-report.md:298-305`) and step 1 of Revision 5 ("Add the Apps tab ... inside the current structure", `:372-376`).

## Classification

- Type: FEATURE. It adds a new user-facing surface and a new renderer.
- Estimate: L. Two new frontend libs, one new shell tab and route, an agent session on an interactive surface, a new host channel for selection (a front-to-back RPC with both registrations, per 493 Decision 6), five renderers plus nesting, and a render test for the budgets. No chart library exists yet (`design-spec.md`, Open question 3). That choice is the largest single cost driver.
- Priority: not defined here.

## Scope

In scope:

- Electron shell: one `apps` surface id, one route, one tab. VS Code cannot reach it.
- An Apps feature lib (`scope:webview`, `type:feature`) with the page, its agent conversation, and the page's own interactive streaming surface.
- A catalog renderer UI lib (`scope:webview`, `type:ui`): stat, line chart, bar chart, table and list, plus `children` nesting and the plain-text fallback. Revision 2: also the v2 layout kinds (section, stack, grid, card) and input kinds (text, select, radio-group, checkbox) with change and submit through `surface:*`.
- Intake of `surface:updated` (Revision 2; was `dashboard:spec-proposed`), scoped to the page's own routing id, with re-validation at the webview boundary.
- Sort, filter and page on the client for tables and lists.
- Sending the selection to the host (`surface:select`) so the page's agent can read it with `ptah_surface_get_state`.
- The accessibility rules in `design-spec.md` "Accessibility" that apply to rendered components.
- Confirming or replacing the provisional `DASHBOARD_LIMITS` values with a render test.
- The lazy-load cold-start gate.

Out of scope:

- VS Code webview navigation to Apps. Revision 5 and the design spec say Electron only; the constraint comes from `context.md`.
- Third-party HTML, iframes, MCP Apps hosting, and `ui://` resources. These belong to Track B (TASK_2026_496, TASK_2026_497 spikes).
- Pinning. This covers the "Pin to Home" card, the confirmation step, pin storage, the pinned-tile grid (gridstack, `AppsLayoutService`), the six tile states (Fresh, Stale, Failed, Auth necessary, Schedule stopped), and scheduled or deterministic refresh. All of it goes to TASK_2026_495_2d9f.
- The Home route, the space workspace type, and the Schedules surface. These are Revision 5 step 3 and need spaces first.
- Moving Thoth, Setup hub, Marketplace and Settings into a global dropdown. That is Revision 5 step 2, a separate navigation task.
- Implementing the `RouteReuseStrategy` / `data: { retain: true }` mechanism. It belongs to TASK_2026_524 batch 3 and is not on `main`. This task must still meet the outcome in Requirement 2.4 (see Risks).
- Rendering dashboards inside the coding chat. That is Revision 4 sequence C ("charts in the coding chat").
- Host handling for the actions `dashboard.refresh`, `dashboard.pin` (TASK_2026_495), `dashboard.drill-down` (no result store exists, 493 "Deferred"), and `dashboard.export`, `dashboard.copy`, `dashboard.open-url` (a later actions task). These actions are not active controls in this task (Requirement 4.6).
- Resolving a `DashboardDataRef.resultId` into rows. No result store exists.
- Tier 2 and Tier 3 permission components for app actions (`design-spec.md` "Permission levels"). No mutating action is in scope.
- Keeping a rendered spec after an app restart. Persistence arrives with pinning.
- The contrast audit of the `anubis-light` theme. That is TASK_2026_529_b482.

## Contract symbols the renderer must consume

The renderer consumes these as published and does not redeclare them.

- From `@ptah-extension/shared` (main barrel, zod-free):
  - `MESSAGE_TYPES.DASHBOARD_SPEC_PROPOSED`, `DashboardSpecProposedPayload`
  - `DashboardSpecEnvelope`, `DashboardComponent`, `DashboardStatComponent`, `DashboardLineChartComponent`, `DashboardBarChartComponent`, `DashboardTableComponent`, `DashboardListComponent`
  - `DashboardRichText`, `DashboardAction`, `DashboardDataRef`, `DashboardSeries`, `DashboardSeriesPoint`, `DashboardTableColumn`, `DashboardTableCell`, `DashboardListItem`
- From `@ptah-extension/shared/mcp-apps-contracts` (zod-bearing; the importing project must set `"strict": true`, see its `index.ts` header):
  - `validateDashboardSpec` with a `DashboardJsonByteCounter` based on `TextEncoder`, and its `DashboardSpecValidation`, `DashboardSpecAccepted`, `DashboardSpecRejected` results
  - `renderDashboardSpecText`
  - `DASHBOARD_LIMITS`, `DASHBOARD_COMPONENT_KINDS`, `DASHBOARD_ACTIONS` and `DashboardActionId`, `DASHBOARD_TEXT_FALLBACK_MAX_TABLE_ROWS`, `DASHBOARD_SUPPORTED_SCHEMA_VERSIONS`, `DASHBOARD_SUPPORTED_CATALOG_VERSIONS`

## Requirements

### 1. Apps entry in the Electron shell only

Requirement: Electron user: an Apps tab opens the Apps page. The VS Code host can never display it.

Acceptance criteria:

1. When a workspace folder is open in Electron, the shell shall show an "Apps" tab in the tab row directly after the Canvas (chat) tab. The order follows the code-workspace set "Chat, Apps, ..." in `design-spec.md` "Navigation sets". The tab shall use the same `role="tab"`, `tab-active` and `aria-selected` pattern as the existing tabs.
2. When the user activates the Apps tab, the system shall navigate to the `apps` surface, and `appState.currentView()` shall report `'apps'`.
3. When `'apps'` is added to the shared surface-id list, the route table and `SURFACE_ROUTE_IDS` shall remain in step. The existing `app.spec.ts` assertion shall pass, and no second list of view ids shall be introduced.
4. When the VS Code host sends `initialView: 'apps'` or a `SWITCH_VIEW` naming `apps`, the webview shall land on the default surface (`chat`). It shall request no Apps chunk and show no Apps navigation entry. A test shall cover both entry paths.
5. When no workspace folder is open, the Apps tab shall not appear. This matches the existing gate at `electron-shell.component.ts:122`.

### 2. The page's own conversation and interactive streaming surface

Requirement: Electron user: they ask for a dashboard on the Apps page, in a conversation that belongs to that page. The coding chat does not change.

Acceptance criteria:

1. When the user submits a request on the Apps page, the system shall start or continue an agent session owned by the page. It shall not open a chat tab, change the active coding-chat session, or add a message to any coding-chat transcript.
2. When the page's session starts, the page shall register its surface with `StreamingSurfaceRegistry.register(surfaceId, getState, setState, { interactive: true })`, as `registerWorkflowSurface` does. `StreamingSurfaceRegistry.isInteractive(surfaceId)` shall then return `true` for that surface.
3. When the page's agent raises a permission request or an AskUserQuestion, the prompt shall render on the Apps page, as at `harness-builder-view.component.ts:301-317`. It shall not be auto-denied or auto-answered, and it shall not render in the coding chat.
4. When the user leaves the Apps tab and returns while the page's session is idle or still streaming, the page shall show the same conversation and the latest rendered spec. The same holds for sort, filter, page and selection state. No event that arrived in between shall be lost. The mechanism shall not add a second `[class.hidden]` block for `apps` (`design-spec.md` "How 'stays mounted' must be implemented").
5. When the page's session ends or the page state is discarded, the surface shall be closed through `StreamRouter.onSurfaceClosed`, following the harness lifecycle. After that, `StreamingSurfaceRegistry.getAdapter(surfaceId)` shall return `null`.
6. When the active workspace changes, the Apps page shall not display a spec, a conversation or a selection that was created in a different workspace.
7. When no spec has been rendered yet, the page shall show an empty state with the request input. It shall not show a blank area.

### 3. Spec intake, session scoping and fail-closed validation

Requirement: Apps page: it renders only specs that its own conversation produced, and only after it re-validates them.

Acceptance criteria:

1. When a `dashboard:spec-proposed` message arrives whose `sessionId` equals the Apps page's session, the page shall re-validate `payload.spec` with `validateDashboardSpec` and a `TextEncoder`-based byte counter before it renders anything.
2. When a `dashboard:spec-proposed` message arrives with no `sessionId`, the system shall render it nowhere: not on the Apps page and not in the coding chat. A test shall assert this. The requirement is TASK_2026_493 `context.md`, Decisions from review, item 1.
3. When a `dashboard:spec-proposed` message arrives whose `sessionId` belongs to a coding-chat session or any other session, the Apps page shall not render it. The coding chat shall show that tool call exactly as it does today, with its plain-text result.
4. When a newer valid spec arrives for the same session, it shall replace the previous spec in full (atomic snapshots). No component from the old spec shall remain on screen.
5. When re-validation rejects a spec, the page shall render no component from it. This covers an unknown `schemaVersion` or `catalogVersion` (an old or newer spec), a spec over `DASHBOARD_LIMITS.maxSpecBytes`, any other budget breach, and a malformed value. Instead the page shall show a plain-text fallback in `font-mono`: a statement that the dashboard could not be shown, and the plain-text `reason` from `DashboardSpecRejected`. The conversation's tool-result text shall stay visible in the page transcript.
6. When a valid spec fails while rendering, the page shall show `renderDashboardSpecText(spec)` in `font-mono` in place of the whole spec. It shall not show a partial tree, and the failure shall not break the rest of the page. A test shall force this failure.

### 4. Catalog renderer

Requirement: Apps page: it renders each of the five catalog kinds and their nesting with Ptah components, with no route for spec text to execute.

Acceptance criteria:

1. When a spec contains a `stat`, `line-chart`, `bar-chart`, `table` or `list` component, the renderer shall render it with the visual treatment in `design-spec.md` "Catalog components":
   - stat: label, value, `unit` and `delta`
   - chart: axes labelled from `xLabel` and `yLabel`, every series named
   - table: columns in spec order with `align` honoured, and a scrollable viewport rather than every row at once
   - list: `ordered` honoured, `detail` shown as a secondary line
2. When a component has `children`, the renderer shall render them nested inside the parent, in spec order, up to `DASHBOARD_LIMITS.maxTreeDepth`.
3. When any text field contains markup or markdown syntax (for example `<img src=x onerror=alert(1)>` or `**bold**`), the renderer shall display the characters literally and create no element from them. A test shall assert that no `img` element appears. The two new libs shall contain no `innerHTML`, `bypassSecurityTrust*`, `DomSanitizer`, `<iframe`, or import of `@ptah-extension/markdown`.
4. When a chart, table or list uses `data: DashboardDataRef` instead of inline values, the renderer shall show a plain-text notice that the data is not available in this view, with `rowCount` when present. It shall not show an empty chart or an empty table.
5. When a list item carries a `url`, the renderer shall show the URL as plain text. It shall not be a clickable link in this task (see Open questions).
6. When a component carries `actions`, only `dashboard.select` shall be an active control in this task. Actions without host handling here shall not appear as enabled controls. No action shall call a tool, an RPC method or the model directly from the renderer. Every action shall leave the UI lib only as an output event that carries the `DashboardActionId`.

### 5. Sort, filter and page on the client

Requirement: Apps page user: they sort, filter and page tables and lists, with no model call and no host round trip.

Acceptance criteria:

1. When the user activates a table column header, the rows shall sort by that column. Repeated activation shall move through ascending, descending and the spec's original order. `aria-sort` shall reflect the current state.
2. When the user types in a table's or list's filter control, only rows or items whose visible text contains the query shall show. A result count shall be shown as text.
3. When the rows or items exceed one page, the renderer shall offer keyboard-reachable previous and next page controls, with the current page and total pages as text.
4. When the user sorts, filters or pages, the system shall make no RPC call, send no host message and start no agent turn. A test with a spy on the RPC and message transport shall assert zero calls.

### 6. Selection sent to the host for the agent's context

Requirement: Apps page user: when they select a stat, a table row, a list item or a chart point, the page's agent knows what is selected. This implements Revision 5 UX rule 4.

Acceptance criteria:

> Revision 2 (Gate 2, 2026-09-25): the selection travels on the TASK_2026_538 `surface:select` RPC and is host state in `SurfaceStateService`. The agent reads it with `ptah_surface_get_state`; no text is injected into the turn. Criteria 1-6 below replace the v1 wording.

1. When the user selects an item in a component that declares `dashboard.select`, the page shall send one `surface:select` with the page's routing id, the `surfaceId`, the surface's materialized revision, a fresh `operationId` and the selected item. The item is the row index in the spec's original order, the list item index, the series and point index, or the stat itself.
2. When the agent in the Apps conversation calls `ptah_surface_get_state`, it shall get the current selection. `APPS_SYSTEM_PROMPT` shall tell the agent to call that tool when the user refers to "this", "the selected row" or "the form". A spec shall pin that prompt text; the host-side read is covered by the TASK_2026_538 host tests.
3. When the user clears the selection, or a new spec or surface replaces the old one, the host shall hold no selection for that surface. The page shall reset its local selection from the pushed `selection`, not by assumption.
4. When a selection is sent, it shall not start an agent turn by itself. It shall never reach a coding-chat session or another Apps session (scoped by routing id). A test shall assert both at the page boundary.
5. The page shall add no host channel. It shall use only the `surface:*` methods that TASK_2026_538 registered.
6. When the host rejects or times out on the selection call, the page shall keep the selection shown and display a non-blocking text notice. On `stale-revision` it shall re-read and re-send the selection once with a fresh base. It shall not throw or discard the rendered surface.

### 7. Accessibility

Requirement: keyboard and screen-reader users: they can use the rendered spec. The rules come from `design-spec.md` "Accessibility".

Acceptance criteria:

1. When a component has no nested interactive control and is expandable, its container shall be the activation target (`Tab`, then `Enter` or `Space`). When it nests an interactive control, the container shall carry no `role`, `tabindex` or key handler. Expansion shall then use a header icon button named "Expand {title}" or "Collapse {title}", with `aria-expanded`.
2. When an expanded component is open and the user presses `Escape`, it shall close and focus shall return to the control that opened it.
3. When a chart renders, a keyboard-reachable toggle with `aria-pressed` shall switch it to a table of the same data. The toggle shall not be available on hover only.
4. When a chart has more than one series, each series shall carry a direct label or a pattern, not hue alone.
5. When a stat or state value is shown in colour, it shall be coloured text on a neutral surface. No readable text shall sit on a filled `badge-success` or `badge-info`, and small body text shall not use raw `text-error` or `text-info` (`design-spec.md` measured-contrast table).
6. When the user returns to the Apps tab, focus shall go back to the control inside the page that held it when they left, if that control still exists and can take focus. Otherwise focus shall go to the page host element (`tabindex="-1"`) (`design-spec.md` "Focus ownership under retention").

### 8. Budget confirmation

Requirement: contract owners: the seven provisional budgets are confirmed or replaced against the real renderer. TASK_2026_493 Decision 2 delegated this.

Acceptance criteria:

1. A render test shall render one spec at each provisional limit: 200 components, depth 8, 1,000 table rows, 50 columns, 5,000 series points, and a spec at `maxSpecBytes`. It shall record each outcome, with the render time measured, in the task folder.
2. When a budget is confirmed, its `DASHBOARD_LIMITS` doc comment in `dashboard-catalog.ts` shall say "confirmed" and name the test. When a budget is changed, the value shall change in that one constant, with the measurement as the stated reason, and `nx run-many -t test -p @ptah-extension/shared` shall pass unchanged.

### 9. Lazy load and cold start (gate)

Requirement: every Electron user: cold start does not change when the Apps page is not opened.

Acceptance criteria:

1. When the webview is built for production, no module from the two new libs shall appear in the initial chunk set. Neither shall `@ptah-extension/shared/mcp-apps-contracts`, zod pulled in through it, or any chart library. The Apps page shall load only through the `apps` route's lazy `loadComponent`.
2. When the webview starts and the user does not open Apps, the network or file log shall show no request for the Apps chunk.
3. The developer shall report the production build's "Initial total" on this branch and on `main` at 34dd972f8. Every eager byte this task adds shall be named, for example the tab, the route entry, or a zod-free push handler. Any other initial-size growth fails the gate.

## Non-functional requirements

- Compatibility: Angular 22.1.7, TypeScript 6.0.3, Electron 44.4.3, Tailwind 3 with daisyUI 4, as installed (`design-spec.md` line 7). Every new component is standalone, uses `ChangeDetectionStrategy.OnPush`, and uses signal inputs, outputs and state. Both new libs set `"strict": true`, which the contract entry point requires.
- Module boundaries: the Apps lib is tagged `scope:webview`, `type:feature`. The renderer lib is tagged `scope:webview`, `type:ui` and does not import the Apps feature lib, the host transport or `ClaudeRpcService`. `nx run-many -t lint` reports 0 errors for both. No static import of the lazy Apps lib from an eager lib. If an eager push handler is needed, it follows the `/services` narrow-barrel precedent and is recorded in `checkDynamicDependenciesExceptions` only if lint requires it.
- Security: the renderer honours contract controls 3 and 5 as stated in Requirement 4.3 and 4.6. Whatever renders charts works under the Electron shell CSP added by TASK_2026_491 (tested by `apps/ptah-electron/src/windows/shell-csp.spec.ts`) without relaxing it.
- Accessibility: WCAG 2.1 AA, as the design spec states and the project already enforces for `base-content-muted`.

## Stakeholders

| Stakeholder                                 | What they need from this change                                                               | How they will judge it                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Technical operator (Revision 4 beachhead)   | Ask for a dashboard, see it rendered, sort, filter and select without waiting on the model     | A request on the Apps page yields a rendered dashboard. Sort, filter and page respond with no agent turn |
| Coding-chat user                            | No change to chat                                                                             | Chat transcripts, tabs and tool rendering are unchanged. Specs from chat sessions do not appear on Apps  |
| VS Code extension user                      | No new surface and no cold-start cost                                                         | No Apps entry, and `initialView: 'apps'` lands on chat                                                   |
| TASK_2026_495 (pinning)                     | A renderer and page it can pin from without rework                                            | The renderer is a reusable `type:ui` lib that takes a validated envelope                                 |
| Security reviewers                          | The renderer half of the trust boundary                                                       | The tests in Requirements 3.2, 4.3 and 4.6 exist and pass                                                |

## Risks

| Risk                                                                                                                                                                                             | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The retention mechanism (TASK_2026_524 batch 3, `retain: true`) is not on `main`, so a routed Apps page is destroyed on navigate-away and loses its spec and client state (Requirement 2.4) | HIGH       | HIGH   | Software-architect: choose where the page's session, spec and client state live so they outlive the component, without a second `[class.hidden]` block, and state how this migrates to `retain: true` when batch 3 lands                                                                                              |
| The zod-bearing contract entry point or a chart library leaks into the eager graph through a barrel import                                                                                      | MEDIUM     | HIGH   | Developer: import `@ptah-extension/shared/mcp-apps-contracts` only inside the lazy libs. QA: compare initial chunks against `main` (Requirement 9.3) before review                                                                                                                                                      |
| Adding `'apps'` to the shared id list makes the VS Code `WebviewHtmlGenerator` accept it                                                                                                       | MEDIUM     | MEDIUM | Architect: decide the Electron-only guard. Tester: cover both VS Code entry paths (Requirement 1.4)                                                                                                                                                                                                                   |
| The chart library choice fails the shell CSP, OnPush or the bundle constraints                                                                                                                 | MEDIUM     | MEDIUM | Architect: verify the candidate under the shell CSP and with lazy loading before committing to it, and record the evidence in the plan                                                                                                                                                                                 |
| The selection reaches the wrong session's context                                                                                                                                              | LOW        | HIGH   | Developer: key the selection by the Apps session id at the host. Tester: add the isolation test in Requirement 6.4                                                                                                                                                                                                     |

## Open questions

- Should list-item `url` values and `dashboard.open-url` open through the host's external-link path in this task, or stay plain text as specified in Requirement 4.5? The product owner can answer this. Plain text is the default.
- Should the Apps conversation appear in the session sidebar or history, like a chat session, or stay private to the page? The architect can answer this by checking what the harness workflow session does today.
- What page size should tables and lists use? The designer or architect can decide. The requirement only fixes the behaviour.

## Handoff

- Next specialist: software-architect.
- Why: the requirements are settled. The design questions are open: how state survives navigation without retention, the Electron-only guard on a shared id list, the host channel for selection and how it reaches the agent turn, and the chart library.
