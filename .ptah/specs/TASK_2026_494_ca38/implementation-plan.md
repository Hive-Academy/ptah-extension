# Implementation Plan - TASK_2026_494 - Revision 2 (contract v2)

Apps page for Electron: one surface id, its own agent conversation on an interactive streaming surface, a catalog
renderer for all 13 contract-v2 kinds (v1 content still renders), client-side sort, filter and page, and two-way
UI/agent state through the `surface:*` RPC methods that TASK_2026_538 delivered.

All paths are relative to the worktree root
`D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772` (branch `feat/task-494-apps-page`,
at `origin/main` `9afac1aa2`). Labels: **V** = verified by opening the cited line on this branch. **A** = assumption,
with the check that resolves it.

## Revision 2 changes

Each item maps to `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md` (Revision 1 of that note applies).

| # | Change | Handoff section |
| --- | --- | --- |
| R1 | D3 intake: `dashboard:spec-proposed` replaced by `MESSAGE_TYPES.SURFACE_UPDATED`. The inbox becomes a generic, zod-free routing-id dispatcher, `SurfaceUpdateInbox`, in `@ptah-extension/chat-routing`, so TASK_2026_539 can claim chat-tab routing ids on the same inbox without depending on the Apps lib. Claim/release and the drop rules are unchanged | (a) item 1 |
| R2 | Component 4: `intakeDashboardSpec` becomes a per-surface reducer over `SurfaceChange`. The state is `Map<surfaceId, entry>`, at most `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId` (8). Each entry has a materialized revision. Ops are applied with `applySurfaceOps`, then re-validated fail-closed. Gaps are recovered and state is hydrated with `surface:read`. An eviction delete is terminal | (a) item 2; (c) Eviction |
| R3 | D4 / Components 5 and 8: `dashboard:select` and `DashboardSessionStore` are replaced by `surface:read/change/select/action/operation`. Every host file in old Component 8 is dropped. `ChatDashboardSelectionInjectorService` is **not built**. `APPS_SYSTEM_PROMPT` instead tells the agent to call `ptah_surface_get_state` and to build with `ptah_surface_update` | (b) |
| R4 | Renderer: the view model and catalog renderer are extended to 13 kinds. Added: the form flow (draft check, change on commit or debounce, submit through `surface:action`), the operation state table, operation id generation, `surface:operation` polling, acknowledgement-versus-state Rules 1-4 with per-operation overlays, and the six reconciliation cases the specs must pin | (c) |
| R5 | Component 7 deleted (delivered) | (d) |
| R6 | Component 2: the Apps tab replaces the single slot comment at `electron-shell.component.ts:136`. Every file:line re-verified against `9afac1aa2` | context.md 2026-09-25 |
| R7 | D7: `libs/shared/src/mcp-apps-contracts/surface*.ts` added to the "not in any initial output" assertion. The `@ptah-extension/mcp-apps-page/services` subpath and its eslint exemption are removed (R1 moved the eager handler into an eager lib) | "Unaffected" D7 |
| R8 | Trust boundary: `trust-boundary.spec.ts` covers every v2 text field with the 538 fixture | (c) Markup duty |
| R9 | Component 11: render cases added at the `SURFACE_LIMITS` values the handoff lists | (c) Budgets |
| R10 | `surface:release` (Q3): **not built in 494**. Left to a follow-up (reason in D4) | Open items, Q3 |
| R11 | Manual QA item A2 (MCP permission prompt for the surface tools in Electron) recorded | Open items, A2 |

D1, D2, D5 and D6 are kept. D1 and D6 change only in what they contain (see each).

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_494_ca38/context.md` (Conversation Summary, binding),
  `task-description.md` (Gate 1 approved), the previous `implementation-plan.md` (v1, `34dd972f8`),
  `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md` (binding for this revision). The design and research inputs of
  Revision 1 are unchanged (`TASK_2026_492_0bcc/design-spec.md`, `TASK_2026_493_9f58/implementation-note.md`,
  `TASK_2026_490_583c/research-report.md` Revisions 4-6).
- Corrections applied (source wins over earlier documents):
  1. The route/id lock-step test is `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:313-320`, not
     `app.spec.ts` (task-description 1.3). **V**
  2. The VS Code host never sends `SWITCH_VIEW`. Only Electron does (`apps/ptah-electron/src/ipc/ipc-bridge.ts:486`).
     `AppStateManager.handleMessage` accepts it on both hosts (`app-state.service.ts:307-317`). Req 1.4's two paths are
     therefore tested at the webview. **V**
  3. The routing id is the Apps correlation id (tabId). The MCP URL uses
     `routingId = sessionConfig?.tabId ?? sessionId` (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:835`),
     and `SurfaceUpdatedPayload.routingId` is that same value (`libs/shared/src/lib/types/messages/payload-map.ts:250-251`). **V**
  4. The old Correction 4 (Electron delivery throws) is fixed on `main`:
     `ElectronWebviewManagerAdapter.getActiveWebviews()` (`apps/ptah-electron/src/ipc/webview-manager-adapter.ts:74-76`)
     and `CliWebviewManagerAdapter.getActiveWebviews()` (`libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:51-53`). **V**
  5. Req 9.3 names `34dd972f8` as the baseline. The branch now starts at `9afac1aa2`, which includes 538 and 540. The
     gate compares against `9afac1aa2`, so the only difference measured is 494's. Comparing against `34dd972f8` would
     charge 538/540 growth to this task.
  6. Req 6.2 and 6.3 ("the agent turn shall receive the current selection") are met by the pull model in D4, not by
     injecting text into the turn. The ACs are re-mapped in "Architecture-level quality requirements". The project
     manager should update the wording of `task-description.md` 6.2 and 6.3. This document does not edit that file.
- Design handoff used: `design-spec.md` "Catalog components", "Accessibility", "Surface ids and mount policy", "Focus
  ownership under retention". The design spec predates v2 and has no form kinds. The input and layout kinds use
  daisyUI form and card primitives under the same accessibility rules (Component 10). Nothing in the design is
  overridden.
- Handoff and source conflict, resolved (unchanged from Revision 1): the design spec wants `apps` to stay mounted, but
  it forbids a second `[class.hidden]` block, and `retain: true` is not on `main` (`app.routes.ts:37-38`). `apps` is a
  normal lazy route, and all state lives in a root service (D1).
- Missing decision-critical input: TASK_2026_539 has no task folder on this branch or in the main checkout. The
  inbox shape (R1) is derived from the handoff's recommendation, not from a 539 design. It is generic by
  construction: no field or rule in it is Apps-specific.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| V: `ViewType`, `SURFACE_ROUTE_IDS`, `ACCEPTED_INITIAL_VIEWS` are the one id list | `libs/shared/src/lib/types/webview-surface.types.ts:39-50, 60-71, 94-97` | `'apps'` is added once. The analytics id is now `'analytics'` (`:41`) |
| V: literal id-list assertion | `libs/shared/src/lib/types/webview-surface.types.spec.ts:25-34` | Gains `'apps'` |
| V: route table ↔ id list lock-step; jest-unresolvable list | `webview-routing.spec.ts:313-320`; `:75` (`['tribunal']`) | `apps` must resolve under jest (verification point) |
| V: lazy route shape with `SURFACE_ACTIVE` | `apps/ptah-extension-webview/src/app/app.routes.ts:144-151`; fallbacks `:155-156` | `apps` goes after `tasks`. A refused `canMatch` falls through to `**` → `chat` |
| V: no route guard exists in the webview app | `apps/ptah-extension-webview/src/app/*.ts` has no `canMatch`/`canActivate` | The guard is new and app-local |
| V: `initialView` path | `app.ts:131-149`; `app-state.service.ts:724-734` | Ends in `navigateToSurface` |
| V: `SWITCH_VIEW` path | `app-state.service.ts:293, 307-317, 958-962, 513-522` | Ends in `navigateToSurface`. One guard covers both paths |
| V: `navigateToSurface` returns `'navigated'` for a redirected navigation | `libs/frontend/core/src/lib/routing/surface-router.service.ts:115-142` | A refused `apps` match settles as navigated to `/chat`. See D2 "inert slice stamp" |
| V: 540 made view slices workspace-scoped. Only the four configuration surfaces are global | `app-state.service.ts:57-73, 760-769, 789-865` | `apps` is a workspace surface: a switch restores each workspace's own surface. That matches D1's per-workspace slices. No 540 change is needed for `apps` |
| V: 540's `remountActiveSurface` runs only in the configuration-surface stay-branch | `surface-router.service.ts:145-173`; `app-state.service.ts:842-849` | Not reached for `apps`. The Apps page is destroyed and re-created by a normal navigation, as D1 already assumes |
| V: `currentView` derives from the Router | `app-state.service.ts:580-582` | A refused match reports `'chat'` |
| V: Electron detection | `libs/frontend/core/src/lib/services/vscode.service.ts:171-173` | Guard predicate |
| V: Apps slot comment | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:136` (`<!-- Apps tab (TASK_2026_494) renders between Chat and Tasks -->`), between the Chat button `:125-135` and the Tasks button `:137-147`, inside `@if (layout.hasWorkspaceFolders())` `:123` | Component 2 replaces this one line |
| V: tab click handlers and icon fields | `electron-shell.component.ts:378-401`; icons imported `:32-39` | `openApps()` and `AppWindowIcon` follow the same pattern |
| V: `AppWindow` lucide icon exists | `node_modules/lucide-angular/icons/icons/app-window.d.ts` | Tab icon |
| V: harness session path | `libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts:271-329` (`chat:start` with `prompt`, `tabId`, `surfaceMode: true` `:304-314`), `:358-390` (`chat:continue`), `:422-440` (abort), `:454-471` (dispose), rollback `:340-356` | Apps reuses this path unchanged |
| V: root-provided on purpose | `harness-workflow.service.ts:98` | D1 precedent |
| V: claim + interactive surface | `harness-workflow.service.ts:294-296`; `harness-builder-state.service.ts:567-575`; `StreamingSurfaceRegistry` `libs/frontend/chat-routing/src/lib/streaming-surface-registry.service.ts:66, 92, 101, 121` | Same calls for Apps |
| V: `StreamingState` slot needs `equal: () => false` | `harness-builder-state.service.ts:112-120` | Same for each Apps slice |
| V: surfaceMode chunk routing | `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:431-453` | Claimed chunks go to the surface. Unclaimed surfaceMode chunks are dropped |
| V: claim service lives in `chat-routing` and is root | `libs/frontend/chat-routing/src/lib/workflow-session-claim.service.ts:4-29` | `SurfaceUpdateInbox` sits beside it (R1) |
| V: `chat-routing` is `scope:webview`, `type:feature`, `strict: true`, and is eager | `libs/frontend/chat-routing/project.json:7`; `tsconfig.json:6`; imported by chat, harness-builder | Adding the inbox moves no lib into the initial bundle |
| V: `chat-routing` may import `@ptah-extension/core` without a cycle | `chat-streaming` already imports core (`libs/frontend/chat-streaming/src/lib/permission-handler.service.ts`); `chat-routing` specs import core (`__tests__/surface-vs-tab-parity.spec.ts`); nothing in `libs/frontend/core/src` imports `chat-routing` | `SurfaceUpdateInbox implements MessageHandler` |
| V: message dispatch map built once at bootstrap; fan-out; guarded dispatch | `libs/frontend/core/src/lib/services/message-router.service.ts:89, 125-136, 229-236` | A lazy lib cannot subscribe later. The eager inbox is required |
| V: handler registration | `apps/ptah-extension-webview/src/app/app.config.ts:170` (`ChatMessageHandler`) | One `MESSAGE_HANDLERS` entry for the inbox |
| V: no frontend consumer of `surface:updated` yet | no match for `SURFACE_UPDATED`/`surface:updated` under `libs/frontend`, `apps/ptah-extension-webview` | The inbox is the only handler |
| V: push type and payload | `libs/shared/src/lib/types/messages/message-constants.ts:182`; `payload-map.ts:249-264, 386` | Inbox handles `SURFACE_UPDATED` |
| V: `dashboard:spec-proposed` is now only a no-store fallback | `message-constants.ts:166-177` | No webview handler, so it renders nowhere (Req 3.2) |
| V: anonymous v1 proposal never stores or pushes | `libs/backend/vscode-lm-tools/src/lib/surface/dashboard-surface-bridge.ts:9` | Req 3.2 holds on the host side |
| V: v2 plain types on the main barrel (type-only) | `libs/shared/src/index.ts:35` | Eager code may import types at zero bytes |
| V: v2 zod-bearing entry point | `libs/shared/src/mcp-apps-contracts/surface.index.ts:1-118`; `libs/shared/package.json:30`; `tsconfig.base.json:183-184` | Lazy libs only |
| V: v2 shapes | `libs/shared/src/mcp-apps-contracts/surface.types.ts:24-48` (layouts), `:49-90` (inputs), `:91-111` (display), `:122-130` (envelope), `:174-186` (selection), `:187-196` (`SurfaceContent`), `:211-217` (`SurfaceStateView`), `:229-243` (`SurfaceStateOp`, `SurfaceChange`), `:244-258` (status, reject reasons) | View model input |
| V: kinds, actions, empty values, op-id pattern, budgets | `surface-catalog.ts:23-40, 41-48, 61-66, 76, 83-120, 123-133` | Renderer and reducer constants |
| V: data binding | `readSurfacePath` `surface-data-model.ts:79-104` | Input values |
| V: draft and submit checks | `checkDraftValue` `surface-bindings.ts:201-238`; `checkSubmitValues` `:297-331`; `findSurfaceAction` `:334`; `collectSubmitScope` `:374-406` | Form flow |
| V: ops application, atomic, never throws | `applySurfaceOps` `surface-patch.ts:258-322`; `checkSurfaceSelection` `:371` | Reducer |
| V: document validation, never throws | `validateSurfaceDocument` `surface.validator.ts:617-658` | Snapshot and post-ops re-validation |
| V: v1 validation and text fallback | `dashboard-spec.validator.ts:42, 182`; `dashboard-text-fallback.ts:181` | v1 content path unchanged |
| V: v2 text fallback | `renderSurfaceText` `surface-text-fallback.ts:35` | Render-failure fallback for v2 |
| V: `surface:*` wire types | `libs/shared/src/lib/types/rpc/rpc-surface.types.ts:33-73` (params), `:90-96` (read), `:99-103` (applied), `:105-114` (rejected), `:117-126`, `:136-140` (unsupported), `:153-173` (submit state), `:176-189` (unions), `:195-206` (operation) | Frontend client contract |
| V: registry and prefix | `libs/shared/src/lib/types/rpc.types.ts:2220-2237, 3853-3857`; `libs/backend/vscode-core/src/messaging/rpc-handler.ts:90` | No RPC registration work in 494 |
| V: request errors are `RpcUserError('INVALID_PARAMS')`; a missing service is a plain `Error` | `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:354-375, 323-328` | Client distinguishes "host refused" (has `errorCode`) from "no answer" |
| V: action refusal order: stale revision first | `surface-rpc.handlers.ts:441-465` | UI handles `stale-revision` before `unsupported`/`undeclared` |
| V: submit requires `base === current`; change/select accept an older non-conflicting base | `libs/shared/src/mcp-apps-contracts/surface-concurrency.ts:164-195` (`:175-178`) | Submit waits until the view is current (form flow step 4) |
| V: select requires a declared `dashboard.select` | `libs/backend/vscode-lm-tools/src/lib/surface/surface-ui-mutations.ts:331-350` | Items are selectable only when their component declares it |
| V: busy rule: one pending submit per routing id | `surface-state.service.ts:258-265`; runtime `require-idle` `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:1-26` | Disable submit while the Apps session is processing |
| V: submit dispatch deadline 120 s | `surface-submit-turn.service.ts:98-103` | Polling window |
| V: RPC default timeout 30 s, no `errorCode` on timeout | `libs/frontend/core/src/lib/services/claude-rpc.service.ts:135, 154-167`; `RpcResult` `:43-65` | Timeout is not a result |
| V: commit revision and pushed `fromRevision` | `libs/backend/vscode-lm-tools/src/lib/surface/surface-commit.ts:103, 124` | An own echo may show a gap |
| V: single push site, synchronous with the commit, sends deferred by a microtask, failures logged only | `surface-state.service.ts:567-591, 594-623, 675-690`; `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.ts:162-170`; `surface-push.ts:17-26` | Reply and push are unordered at the renderer (Rules 1-4) |
| V: eviction delete carries the store high-water revision | `surface-state.service.ts:655-668` | Eviction is terminal whatever its revision |
| V: agent tools always on | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:317-318, 1677-1678`; names `mcp-core/surface-tools.ts:39-40` | D4 pull model is available to every Apps turn |
| V: host read of selection and form values | `libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.spec.ts:208` ("returns one complete state: data model, form values, selection and last submit") | Covers Req 6.2 in the pull model |
| V: text is plain only; no markdown field exists | `libs/shared/src/mcp-apps-contracts/dashboard-catalog.ts:138` (`DASHBOARD_TEXT_FORMATS = ['plain']`) and the comment `:120-137` | The renderer never parses text. Markdown in the transcript only goes through `libs/frontend/markdown` inside `ExecutionNodeComponent` |
| V: markup fixture | `libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts:605` | R8 fixture |
| V: fixtures (v2 not on the testing barrel) | `libs/shared/src/testing/fixtures/surface.ts:10, 26, 42, 157`; `libs/shared/src/testing/index.ts:44` (v1 only) | Component 11 adds v2 fixtures to the barrel |
| V: v1 fixtures | `libs/shared/src/testing/fixtures/dashboard-spec.ts:36-160` | Budget tests |
| V: prompt target lookups; harness filters on "any surface" | `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:360-376, 575`; `harness-builder-view.component.ts:612-622` | Component 9 unchanged in intent, lines updated |
| V: transcript precedent | `harness-builder-view.component.ts:28-30, 297-313, 566-600`; `buildTree(state, cacheKey)` `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:251-254` | Apps page reuses it |
| V: Tribunal workspace-sliced root service in a lazy lib | `libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts:83, 144-168` | D1 slice pattern |
| V: workspace signals | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:734, 741` | Req 2.6 |
| V: `type:ui` / `type:feature` constraints; `scope:webview` | `eslint.config.mjs:365-381, 263-266` | Renderer cannot reach core or RPC |
| V: narrow `/services` exemption list | `eslint.config.mjs:227-253` | **No longer extended** (R7) |
| V: frontend strict tsconfig template | `libs/frontend/harness-builder/tsconfig.json:6` | Both new libs |
| V: Electron shell CSP | `apps/ptah-electron/scripts/copy-renderer.js:156-169`; `apps/ptah-electron/src/windows/shell-csp.spec.ts` | Inline SVG and plain form controls need no relaxation |
| V: production build config | `apps/ptah-extension-webview/project.json:57-70` | D7 measurement |
| V: `text-base-content/NN` banned in `libs/frontend/**` | `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts` | Renderer styles pass the ratchet |

## Architecture decision

### D1 - State survival without `retain: true` (Req 2.4, 7.6) - kept, contents updated

- Chosen approach (unchanged): the routed `AppsPageComponent` holds no state. All state lives in
  `AppsSessionService`, which is `@Injectable({ providedIn: 'root' })` but defined in the lazy lib. It is
  partitioned by workspace path, as in Tribunal. A slice now holds:
  - the conversation: correlation id (= routing id), surface id, `StreamingState` signal, user bubbles;
  - the **surface state**: `ReadonlyMap<surfaceId, AppsSurfaceEntry>` (R2), the active surface id, and tombstones;
  - the **operation state**: the per-surface mutation queue, the pending overlays keyed by operation id, the
    expected revision per surface, and the submit status per action id;
  - the **client view state**: per surface and component, the sort, filter, page, chart-as-table, expanded state
    and the unsent text drafts;
  - notices (selection not shared, evicted, change refused) and the last-focused control key.
- 540 check: `apps` is not a configuration surface (`app-state.service.ts:57-73`), so it is workspace-scoped. A
  workspace switch while on Apps navigates to the incoming workspace's own surface (`:862-864`), and returning
  restores `apps` from that workspace's view slice. That is exactly the Apps slice switch. 540's remount path
  (`:842-849`) is not taken for `apps`. No change is needed.
- Focus memory, rejected alternatives and effect on existing code: unchanged from Revision 1.

### D2 - Electron-only guard (Req 1.1-1.5) - kept

- Unchanged: `'apps'` is added once to `ViewType` and `SURFACE_ROUTE_IDS`. The `apps` route carries
  `canMatch: [electronOnlySurface]` (`inject(VSCodeService).isElectron`). On VS Code the match is refused before
  `loadComponent`, and `**` redirects to `chat`.
- Inert slice stamp, recorded (new, found in the re-verification): after a refused match, `navigateToSurface('apps')`
  resolves `'navigated'` (`surface-router.service.ts:131-133`, the redirected navigation succeeds). `recordSettledSurface`
  then stamps `'apps'` into the VS Code view slice (`app-state.service.ts:541-557`). The effect is inert:
  - the slice's `currentView` is read only by `switchWorkspace`, which is Electron-only (`:342-350`);
  - `openViews()` has no template consumer under `libs/frontend`;
  - `currentView()` reads the Router and reports `'chat'` (`:580-582`).
  The Req 1.4 test asserts `currentView() === 'chat'` and that `loadComponent` was never called. Fixing the stamp
  would mean editing `AppStateManager`, which is outside this task's need.

### D3 - The page's own session, and generic surface intake (Req 2.1-2.3, 3.1-3.3) - REVISED

- Session (unchanged): reuse the harness path. `TabId.create()` (correlation id = routing id), `SurfaceId.create()`,
  `WorkflowSessionClaimService.claim`, `StreamingSurfaceRegistry.register(..., { interactive: true })`,
  `StreamRouter.onSurfaceCreated`. Then `chat:start { prompt, tabId, name: 'Apps', workspacePath, surfaceMode: true,
  options: { model, effort, systemPrompt: APPS_SYSTEM_PROMPT } }` (`harness-workflow.service.ts:304-314`;
  `systemPrompt` is on `ChatStartParams.options`, `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:63`, and is read at
  `sdk-query-options-builder.ts:1406`). Later turns use `chat:continue` (`:372-377`). The session appears in the session
  sidebar as "Apps" (Revision 1, Open question 2).
- Intake: `SurfaceUpdateInbox` (new, `libs/frontend/chat-routing`, root, eager, zod-free) is the **only**
  `MESSAGE_HANDLERS` entry for `MESSAGE_TYPES.SURFACE_UPDATED`. It is a generic routing-id dispatcher:
  ```ts
  type SurfaceUpdateListener = (payload: unknown) => void;
  claim(routingId: string, listener: SurfaceUpdateListener): void; // throws Error on a routing id already claimed
  release(routingId: string): void;                                 // no-op when unclaimed
  isClaimed(routingId: string): boolean;
  ```
  Drop rules, and the inbox does nothing else:
  - the payload is not a non-null object: drop;
  - `routingId` is missing, not a string, or empty: drop;
  - the routing id is unclaimed: drop.
  A claimed id calls exactly its listener with the raw payload. The listener receives `unknown`: the inbox validates
  only the routing key, so typing the value as `SurfaceUpdatedPayload` would claim a check nobody made. Each consumer
  runs its own structural guard in lazy code.
- Why `chat-routing` (the generic shape the handoff asks for):
  1. TASK_2026_539 mounts chat-tab surfaces from `@ptah-extension/chat`. `chat` cannot import the Apps lib, because
     the Apps lib imports `chat` (a cycle). Both already depend on `chat-routing`.
  2. `chat-routing` already owns the claim precedent `WorkflowSessionClaimService` (`workflow-session-claim.service.ts:4-29`)
     and is eager, so no `/services` subpath and no eslint exemption are needed.
  3. The inbox imports only `@angular/core`, `MessageHandler` from `@ptah-extension/core` (no cycle, see evidence),
     and `MESSAGE_TYPES` from `@ptah-extension/shared`.
- Ordering: the claim happens synchronously in `start()` before `chat:start`, so nothing can arrive unclaimed
  (unchanged). The listener runs in the lazy `AppsSessionService` and feeds the Component 4 reducer.
- Rejected alternatives:
  1. Keep the inbox in `@ptah-extension/mcp-apps-page/services`. That blocks 539 through the dependency cycle, and
     it needs an eslint exemption.
  2. Put the inbox in `@ptah-extension/core`. Core is generic transport and app state. Routing of streaming
     surfaces is `chat-routing`'s responsibility, and the claim precedent is there.
  3. Buffer unclaimed pushes. That is unnecessary for Apps (claim precedes session). A consumer that needs catch-up
     calls `surface:read`, which is complete (`rpc-surface.types.ts:89-96`).
  4. Validate in the eager handler. That puts zod into the initial bundle (Req 9.1).

### D4 - Host channel: `surface:*` replaces `dashboard:select` (Req 6.1-6.6) - REVISED

- No new host code. The five methods exist, with registry, allowlist and handler (evidence table). Old Component 8 is
  dropped in full: no `rpc-dashboard.types.ts`, no `'dashboard:'` prefix, no `DashboardRpcHandlers`, no schema, no
  `DashboardSessionStore`, no `recordDelivered` hook, and no `PtahAPIBuilder` or `ChatSessionService` edits. The host
  store is `SurfaceStateService` (`libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.ts:138`).
- Selection reaching the agent. **Decision: adopt the handoff recommendation. `ChatDashboardSelectionInjectorService`
  is not built.**
  - The agent pulls state with `ptah_surface_get_state`, which is always registered
    (`protocol-dispatcher.ts:317-318`) and scoped by the routing id from the MCP URL. It returns the data model, form
    values, selection and last submit together (`surface-state-reader.spec.ts:208`).
  - Form values reach the agent anyway: a submit turn carries the host-frozen values
    (`surface-state.service.ts:238-244`).
  - The code offers no reason to push the selection. Injecting would add a hot-path edit to
    `ChatSessionService.continueSession`, and it would describe the selection from a second formatter, while
    `describeSurfaceSelection` already exists for tool reads (`surface.index.ts:118`). A pushed prefix would also be
    stale for a submit-started turn, which does not go through `chat:continue` (`surface-submit-turn.service.ts:1-26`).
  - Cost, recorded: the agent must choose to call the tool. `APPS_SYSTEM_PROMPT` makes that the stated rule, and
    Component 4 pins the prompt text with a spec. If manual QA shows that the agent ignores it, the fallback is the
    injector on the host. That would be a separate task.
- `APPS_SYSTEM_PROMPT` content (Component 4). It tells the agent:
  - to build interactive UIs with `ptah_surface_update` (create, then patch). Forms are layouts that declare a
    `surface.submit` action. Selectable items declare `dashboard.select`;
  - that `ptah_dashboard_propose_spec` stays valid for read-only dashboards;
  - to call `ptah_surface_get_state` whenever the user refers to "this", "the selected row", "these values" or "the
    form", and never to ask the user to paste values the page already holds;
  - that a submit arrives as a user message formatted by the host;
  - to keep conversation replies short and text-first.
  It does not contain the `[SYSTEM CONTEXT - DASHBOARD SELECTION]` sentence.
- `surface:release` (handoff Q3). **Decision: not built in 494. Left to a follow-up, recommended for TASK_2026_539.**
  - Scope: it is a new RPC method, which means shared params, the registry and compile-time twin, a `.strict()`
    schema, a handler branch, a new `SurfaceStateService` operation that must interact with the operation ledger and
    pending submits, and host tests on three hosts. That is the host footprint that dropping Component 8 just removed.
  - Need: the host store is bounded (`SURFACE_STORE_LIMITS`: 32 routing ids, 8 surfaces each, 24 MiB, LRU,
    `surface-catalog.ts:123-133`). "New conversation" on the Apps page releases the claim, so the old routing id's
    later pushes and evictions are dropped by the inbox. They are never shown.
  - Where it pays off: chat-tab close (539) is far more frequent than "New conversation" on one page, so the release
    belongs with that trigger. Until then, the old tab's surfaces stay in memory until LRU eviction. That is the
    behaviour the handoff documents.
- Rejected alternatives: build the injector (above); keep `dashboard:select` (duplicates a delivered channel);
  add `surface:release` now (above).

### D5 - Chart rendering: hand-rolled SVG, no dependency - kept

Unchanged. It applies to `line-chart` and `bar-chart` in both v1 and v2 content. v2 display components are the v1
shapes without `children` (`surface.types.ts:91-100`).

### D6 - Two new Nx libs - kept, public API renamed and one subpath dropped

| Lib | Path | Import path | Tags | Public API |
| --- | --- | --- | --- | --- |
| Renderer | `libs/frontend/declarative-dashboard` | `@ptah-extension/declarative-dashboard` | `scope:webview`, `type:ui`, `platform:angular` | `SurfaceRendererComponent` (`ptah-surface-renderer`), `SURFACE_VIEW_MODEL_BUILDER`, `SurfaceRenderable` (the validated input union), view-state types (`SurfaceViewState`, `SurfaceComponentViewState`), interaction types (`SurfaceInteractionState`, `SurfaceInputCommit`, `SurfaceActionInvoke`, `SurfaceSelectionChange`), `SURFACE_PAGE_SIZE` |
| Apps feature | `libs/frontend/mcp-apps-page` | `@ptah-extension/mcp-apps-page` (lazy only) | `scope:webview`, `type:feature`, `platform:angular` | `AppsPageComponent`, `AppsSessionService` |

- The renderer depends on `@ptah-extension/shared`, `@ptah-extension/shared/mcp-apps-contracts` (v1 limits and
  types), `@ptah-extension/shared/mcp-apps-contracts/surface` (v2 constants, `readSurfacePath`, `checkDraftValue`),
  and `lucide-angular`. It does not import `@ptah-extension/markdown`.
- The Apps lib depends on `core`, `chat`, `chat-state`, `chat-routing`, `chat-streaming`, `declarative-dashboard`,
  `shared`, `shared/mcp-apps-contracts` and `shared/mcp-apps-contracts/surface`.
- `@ptah-extension/mcp-apps-page/services` and its `checkDynamicDependenciesExceptions` entry are **dropped** (R7).
- Both libs use the harness-builder tsconfig (`"strict": true`), jest and eslint templates. Both are non-buildable.

### D7 - Lazy-load gate measurement (Req 9) - kept, extended

- Build `npx nx build ptah-extension-webview --configuration=production` on this branch and in a throwaway worktree
  at `9afac1aa2` (Correction 5). Record both "Initial total" lines and both initial chunk tables in
  `.ptah/specs/TASK_2026_494_ca38/lazy-load-gate.md`.
- Module attribution with `--stats-json` (**A:** the `@angular/build:application` `statsJson` option; the check is
  that `dist/apps/ptah-extension-webview/stats.json` exists). Assert that no input under the following paths is in any
  initial output:
  - `libs/frontend/mcp-apps-page/`
  - `libs/frontend/declarative-dashboard/`
  - `libs/shared/src/mcp-apps-contracts/surface*.ts` (**new**)
  - `libs/shared/src/mcp-apps-contracts/dashboard-spec.schemas.ts`, `dashboard-spec.validator.ts`,
    `dashboard-text-fallback.ts`
  Also assert that the set of `node_modules/zod` inputs in initial outputs equals the set at `9afac1aa2`. The main
  barrel already reaches zod through three pre-existing modules (handoff "Open items"), so "no zod" is not the
  criterion. "No new zod input" is.
- Fallback without stats: search the initial chunks for the strings `ptah-apps-page`, `ptah-surface-renderer`,
  `dashboard-catalog/2`, `applySurfaceOps`.
- Named eager additions, and the only permitted growth:
  - `SurfaceUpdateInbox` plus its `app.config.ts` provider;
  - the `apps` route entry plus the `electronOnlySurface` guard;
  - the Apps tab button, `openApps()` and the `AppWindow` icon;
  - the `'apps'` literal.
- Req 9.2: QA confirms in Electron DevTools (Network, file protocol) that no Apps chunk loads before the tab is
  clicked, and records a screenshot in the gate file.

## Component specifications

### 1. Surface id, route and Electron-only guard

- Purpose: make `apps` addressable in Electron and unreachable in VS Code.
- Responsibilities:
  - add `'apps'` to `ViewType` (`webview-surface.types.ts:39-50`) and to `SURFACE_ROUTE_IDS` (`:60-71`), appended after
    `'tasks'`;
  - add the route `{ path: 'apps', canMatch: [electronOnlySurface], providers: [{ provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('apps') }], loadComponent: () => import('@ptah-extension/mcp-apps-page').then(m => m.AppsPageComponent) }`
    after `tasks` (`app.routes.ts:144-151`) and before the fallbacks (`:155-156`);
  - update the table's doc comment (`:40-59`) with one line for `apps`: lazy, Electron-only, `canMatch`;
  - add the guard file.
- Verified contracts: listed above, plus `vscode.service.ts:171-173`.
- Dependencies: app → core (eager), plus a dynamic import of the Apps lib.
- Failure behaviour: a refused match redirects to `chat` silently. `navigateToSurface` never rejects
  (`surface-router.service.ts:115-142`).
- Quality: 0 lazy bytes requested on VS Code.
- Verification seam (`webview-routing.spec.ts`):
  - lock-step still passes;
  - with `isElectron=false`, `initialView='apps'` through `App.handleInitialView` and `SWITCH_VIEW {view:'apps'}`
    through `AppStateManager.handleMessage` both land on `/chat`, with `currentView()==='chat'` and the route's
    `loadComponent` spy never called;
  - with `isElectron=true`, both land on `/apps`;
  - `webview-surface.types.spec.ts:25-34` gains `'apps'`.
- Files:
  - MODIFY `libs/shared/src/lib/types/webview-surface.types.ts`
  - MODIFY `libs/shared/src/lib/types/webview-surface.types.spec.ts`
  - MODIFY `apps/ptah-extension-webview/src/app/app.routes.ts`
  - CREATE `apps/ptah-extension-webview/src/app/electron-only-surface.guard.ts`
  - MODIFY `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`

### 2. Electron shell Apps tab

- Purpose: one tab in the slot TASK_2026_540 left.
- Responsibilities:
  - replace the comment at `electron-shell.component.ts:136` with one `role="tab"` button in the same pattern as
    `:137-147`: `class="tab gap-1.5 no-drag"`, `[class.tab-active]` and `[attr.aria-selected]` bound to
    `appState.currentView() === 'apps'`, `title="Apps"`, `(click)="openApps()"`, a
    `<lucide-angular [img]="AppWindowIcon" class="w-3.5 h-3.5" />` icon, and the label "Apps";
  - add `AppWindow` to the lucide import (`:32-39`) and `readonly AppWindowIcon = AppWindow;` beside `:378-382`;
  - add `openApps(): void { this.appState.setCurrentView('apps'); }` beside `openTasks()` (`:399-401`).
  Nothing else moves.
- Verified contracts: `electron-shell.component.ts:123-171, 378-401`; `AppStateManager.setCurrentView`
  (`app-state.service.ts:902-906`).
- Failure behaviour: none of its own. `requestSurface` handles navigation failure (`:513-522`).
- Verification seam: a new spec (stub pattern of `electron-shell.config-gate.spec.ts:74-129`) asserts:
  - the tab row order is Chat, Apps, Tasks, Tribunal, Analytics when folders exist (Req 1.1);
  - the Apps tab is absent when `hasWorkspaceFolders()` is false (Req 1.5);
  - a click calls `setCurrentView('apps')` (Req 1.2);
  - `aria-selected` follows `currentView`.
  The existing `electron-shell.config-gate.spec.ts` and `electron-shell.activity-placement.spec.ts` stay green.
- Files:
  - MODIFY `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
  - CREATE `libs/frontend/chat/src/lib/components/templates/electron-shell.apps-tab.spec.ts`

### 3. `SurfaceUpdateInbox` (eager, generic routing-id dispatcher)

- Purpose: the one zod-free intake point for `surface:updated`, shared by every consumer that owns a routing id.
- Responsibilities: implement `MessageHandler` with `handledMessageTypes = [MESSAGE_TYPES.SURFACE_UPDATED] as const`,
  plus `claim`, `release`, `isClaimed` and the drop rules in D3. The claim map is a plain `Map<string, listener>`.
  It is not a signal, because nothing renders from it.
- Verified contracts: `message-router.types.ts:33-51`; `message-constants.ts:182`; `payload-map.ts:249-264`.
- Dependencies: `@angular/core`, `@ptah-extension/core` (`MessageHandler`), `@ptah-extension/shared` (`MESSAGE_TYPES`).
  Exported from `libs/frontend/chat-routing/src/index.ts`. The index doc comment's "outbound deps" line gains
  `@ptah-extension/core`.
- Integration points: `app.config.ts`, `{ provide: MESSAGE_HANDLERS, useExisting: SurfaceUpdateInbox, multi: true }`
  beside `:170`. Consumer here: `AppsSessionService`. Later consumer: TASK_2026_539.
- Failure behaviour: a throwing listener propagates to `MessageRouterService.dispatchGuarded`, which reports it to
  `ErrorHandler` and continues the drain (`message-router.service.ts:229-236`). A duplicate `claim` throws
  synchronously. That is a programming error, because both ids come from `TabId.create()`.
- Quality: eager size under 1.5 kB (named in the gate). No timers.
- Verification seam:
  - unit spec: non-object payload, missing, non-string or empty `routingId`, and an unclaimed id each call no listener
    (Req 3.2, 3.3); a claimed id calls exactly its listener with the same object; a released id is dropped; a
    duplicate claim throws;
  - app-level `apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts` (precedent
    `thoth-message-routing.spec.ts`) asserts that `SurfaceUpdateInbox` is the **only** handler for `surface:updated`,
    and that **no** handler exists for `dashboard:spec-proposed` (Req 3.2 and 3.3 for the coding chat).
- Files:
  - CREATE `libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts` (+ `.spec.ts`)
  - MODIFY `libs/frontend/chat-routing/src/index.ts`
  - CREATE `apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts`

### 4. `AppsSessionService` and the per-surface reducer (lazy, root)

- Purpose: own the Apps conversation, the workspace slices, and the surface state of the page's routing id.
- Split: the facade rule applies, with nameable collaborators, each under the 700-line ceiling:
  - `AppsSessionService` (facade, root): slices, conversation lifecycle, and wiring the collaborators below;
  - `apps-surface-intake.ts` (pure): payload guard plus content validation;
  - `apps-surface-reducer.ts` (pure): the state transitions;
  - `AppsSurfaceSync` (plain class, one per slice): `surface:read` coordination and the Rule 3 grace timer;
  - `apps-workspace-slice.ts`: types and the slice factory;
  - `apps-system-prompt.ts`.
- Responsibilities, conversation (unchanged from Revision 1):
  - slices keyed by `tabManager.activeWorkspacePath$() ?? APPS_IMPLICIT_WORKSPACE`; a slice is deleted and disposed on
    `removedWorkspace$` (`tribunal-state.service.ts:144-168`);
  - `start(prompt)` / `send(prompt)` / `abort()` / `discard()` per `harness-workflow.service.ts:271-356, 358-390,
    422-440, 454-471`. `inbox.claim(correlationId, raw => this.onSurfacePush(slice, raw))` runs before `chat:start`.
    `discard()` and the failed-start rollback call `inbox.release`, `claims.release`,
    `streamRouter.onSurfaceClosed`, `AppsSurfaceSync.dispose()` and clear the slice (Req 2.5).
- Responsibilities, intake (`apps-surface-intake.ts`, pure, never throws):
  - `guardSurfacePush(raw: unknown): SurfaceUpdatedPayload | null`. It is structural and zod-free:
    - `surfaceId` is a string of at most `SURFACE_LIMITS.maxSurfaceIdLength`;
    - `revision` is a non-negative safe integer;
    - `origin` is one of three values;
    - `change.kind` is `snapshot`, `ops` or `deleted`;
    - for `snapshot`: `state.surfaceId === surfaceId` and `state.revision === revision`;
    - for `ops`: `fromRevision` is a safe integer and `ops` is an array of at most `SURFACE_LIMITS.maxPatchOps`;
    - for `deleted`: `reason` is `agent-deleted` or `evicted`.
    Anything else returns `null` and is logged with `console.warn`, with no payload text.
  - `acceptSurfaceView(view: SurfaceStateView): AppsRenderable` turns host content into what the renderer may draw:
    - `dashboard-spec/2`: `validateSurfaceDocument({ ...content.surface, dataModel: content.dataModel }, countBytes)`
      (`surface.validator.ts:617`);
    - `dashboard-spec/1`: `validateDashboardSpec(content.spec, countBytes)` (`dashboard-spec.validator.ts:182`);
    - `countBytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length`;
    - the selection is kept only if `checkSurfaceSelection(content, selection).ok` (`surface-patch.ts:371`); otherwise
      it is cleared, fail-closed, without rejecting the surface.
    It returns `{ status: 'accepted', content, selection, lastSubmit }` or `{ status: 'rejected', reason }`.
- Responsibilities, reducer (`apps-surface-reducer.ts`, pure). `AppsSurfaceEntry = { surfaceId, materializedRevision,
  renderable, lastAppliedSeq }`. Tombstones are `Map<surfaceId, revision>`. `seq` is a slice-local counter that
  increments on every applied push or read. The transitions:
  - `snapshot`: if `revision <= materializedRevision`, discard. For a tombstoned id, discard if
    `revision <= tombstone`; otherwise clear the tombstone. Else replace the entry atomically with
    `acceptSurfaceView(state)` and set `materializedRevision = revision`. A rejected content still advances the
    revision: the entry shows the text fallback for that revision, and no read is issued, because re-reading returns the
    same document. When `origin === 'agent'` and the id is new or replaced, it becomes the active surface. The
    selection and view state of that surface are reset from the pushed state, never by assumption.
  - `ops`:
    - if `revision <= materializedRevision`, discard (already applied);
    - if `fromRevision !== materializedRevision`, it is a **gap**: return `needsRead`;
    - if the entry is rejected or unknown, return `needsRead` (unknown) or discard (rejected);
    - else call `applySurfaceOps({ content, selection, lastSubmit }, ops)` (`surface-patch.ts:258`). `ok: false` →
      `needsRead`, with at most one recovery read per surface in flight. `ok: true` and the content object changed →
      `acceptSurfaceView` again, fail-closed (a rejection shows the text fallback). Then
      `materializedRevision = revision`. On v1 content only `set-selection` and `set-last-submit` occur
      (`surface-patch.ts:249-257`).
  - `deleted`: always applied, whatever its revision (an eviction can carry a revision equal to the one held,
    `surface-state.service.ts:655-668`). Remove the entry and record the tombstone at `revision`. `reason: 'evicted'`
    sets the notice "This app was removed to free memory. Ask the agent to rebuild it." If the active surface was
    removed, the next most recent surface becomes active.
  - bound: if a snapshot would create a 9th entry (`SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId`), accept it and
    return `needsRead`. The host pushes the eviction delete after the commit push (`surface-state.service.ts:567-591`),
    so the overflow is transient. After the read, if the host still reports more than 8, keep the 8 with the highest
    revisions.
  - `applyRead(result, readSeq)` for `surface:read`:
    - `found`: each view with `revision > entry.materializedRevision`, or with no entry (and above any tombstone),
      replaces or creates its entry through `acceptSurfaceView`. A view at or below the materialized revision is
      ignored, so the revision **never moves backwards**. An entry absent from the result is removed only if
      `lastAppliedSeq < readSeq` (no push was applied since the read was sent);
    - `not-found`: remove every entry with `lastAppliedSeq < readSeq`.
- Responsibilities, `AppsSurfaceSync` (one per slice; receives `ClaudeRpcService` and the slice):
  - `requestRead(reason)`: at most one `surface:read { routingId }` in flight per slice. Triggers while one is in
    flight coalesce into one follow-up read. Timeout 10 s. On `!isSuccess()`: keep the current view, set the notice
    "Could not refresh this app", and retry once on the next trigger. The read result goes through `applyRead`.
  - Triggers: a reducer `needsRead`; Rule 3 (below); a `stale-revision` result (Component 5); an `ops` or unknown-id
    push for a surface with no entry. Hydration: the root service survives page remounts, so a remount needs no read.
    A slice restored from nothing (first push is `ops`) is hydrated by the unknown-id trigger.
  - Rule 3 grace: when an operation settles `applied` with revision R, the expected revision becomes
    `max(expected, R)`. If `materializedRevision < expected` 1,500 ms later, `requestRead('echo-missing')`. There is
    **one** timer per slice, re-armed rather than multiplied, cleared when the view catches up, and released in
    `dispose()`.
- Responsibilities, `APPS_SYSTEM_PROMPT`: the text in D4.
- Verified contracts: registry and router lines in the evidence table; `SurfaceReadResult` (`rpc-surface.types.ts:90-96`);
  `ChatStartParams` (`rpc-chat.types.ts:38-146`).
- Dependencies: core, chat-state, chat-routing, chat-streaming, shared, `shared/mcp-apps-contracts`,
  `shared/mcp-apps-contracts/surface`.
- Failure behaviour:
  - `chat:start` failure: full rollback;
  - `chat:continue` failure: error signal only;
  - intake, reducer and guard never throw (the validators and `applySurfaceOps` never throw, `surface.validator.ts:655`,
    `surface-patch.ts:318-321`);
  - a rejected surface shows the mono fallback (Req 3.5);
  - a failed read keeps the last good view.
- Quality:
  - timers: at most one grace timer per slice (plus Component 5's poll), all released on `discard()` and slice removal;
  - memory: at most 8 surfaces per slice, each within `maxSurfaceBytes`;
  - validation cost: one whole-document validation per applied push.
- Verification seam:
  - `apps-surface-intake.spec.ts`: guard accept and reject cases; v2 accepted and rejected (unknown `schemaVersion`,
    oversize `maxSurfaceBytes + 1`, malformed); v1 accepted and rejected (unknown `catalogVersion`,
    `makeDashboardSpecOfExactBytes(maxSpecBytes + 1)`); an invalid selection is cleared (Req 3.1, 3.5).
  - `apps-surface-reducer.spec.ts`:
    - snapshot replaces atomically and resets view state (Req 3.4);
    - ops apply from a matching `fromRevision`; ops failure → `needsRead`; post-ops re-validation failure → fallback;
    - gap → `needsRead`;
    - eviction delete at an equal revision is applied (terminal) and tombstoned; a later snapshot above the tombstone
      recreates;
    - agent delete removes;
    - 9th surface → `needsRead`;
    - `applyRead` never lowers a materialized revision and keeps entries pushed after the read was sent;
    - the reconciliation cases 1-6 below that concern revisions (cases 1-5).
  - `apps-surface-sync.spec.ts` (jest fake timers): read coalescing; the grace read fires once; no timer after
    `dispose()`.
  - `apps-session.service.spec.ts` (`MockRpc`, real `StreamingSurfaceRegistry`, real `SurfaceUpdateInbox`):
    - `isInteractive(surfaceId)` is true after start (Req 2.2);
    - `getAdapter` returns null and the inbox is released after `discard()` (Req 2.5);
    - no `TabManagerService` mutation (Req 2.1);
    - a workspace switch exposes the other slice (Req 2.6);
    - a push for another routing id never reaches the slice (Req 3.3);
    - state survives component destroy and re-create (Req 2.4).
  - `apps-system-prompt.spec.ts`: the prompt names `ptah_surface_update`, `ptah_surface_get_state` and
    `ptah_dashboard_propose_spec`, and does not contain `SYSTEM CONTEXT - DASHBOARD SELECTION`.
- Files:
  - CREATE `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/mcp-apps-page/src/lib/services/apps-workspace-slice.ts`
  - CREATE `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-sync.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/mcp-apps-page/src/lib/state/apps-surface-intake.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/mcp-apps-page/src/lib/state/apps-surface-reducer.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts` (+ `.spec.ts`)

### 5. `AppsSurfaceOperations` and `AppsSubmitFlow` (UI mutations)

- Purpose: turn renderer events into `surface:change`, `surface:select` and `surface:action` calls that honour the
  ledger, the revision rules and Rules 1-4. It never calls `chat:*`.
- Split:
  - `AppsSurfaceOperations` (facade, root, lazy lib): the per-surface queue, change and select, overlays;
  - `AppsSubmitFlow` (plain class, created by the facade): submit and polling;
  - `surface-operation-id.ts` (pure);
  - `apps-operation-overlays.ts` (pure).
- Operation ids (`surface-operation-id.ts`):
  - `createSurfaceOperationId(now = Date.now(), random = randomAlphanumeric(16))` returns `op-${now}-${random}`;
  - `randomAlphanumeric` draws from `crypto.getRandomValues` over `[A-Za-z0-9]`;
  - the result must match `SURFACE_OPERATION_ID_PATTERN` (`surface-catalog.ts:76`); a spec asserts it for a fixed
    clock;
  - there is **one new id per user attempt**. An id is reused only for a transport retry of the identical request.
    This design makes no automatic transport retries (see polling), so in practice ids are never reused;
  - the host clock-skew bound is 5 min (`SURFACE_STORE_LIMITS.maxOperationClockSkewMs`, `surface-catalog.ts:131`). A
    renderer clock off by more is refused `operation-expired`, which the notice shows as is.
- Per-surface serialization:
  - one in-flight mutation per surface;
  - before sending, if `expectedRevision > materializedRevision`, wait for the echo; after the Rule 3 grace, read;
  - the base `revision` is always the **materialized** revision.
  Consequence: own writes never conflict with each other. That removes the only self-inflicted `stale-revision` (two
  quick changes to one path, `surface-concurrency.ts:186-193`).
- Queue coalescing: a queued, unsent `change` for the same `componentId` is replaced by the newer value, and its
  overlay is retired unsent. Queued selects collapse to the latest. The queue is bounded by the number of inputs
  (≤ `maxInputs`) plus one select.
- Change (from the renderer's `inputCommit`):
  1. `checkDraftValue(input, value)` (`surface-bindings.ts:201`). If it fails, send nothing (the renderer already
     marks it).
  2. Create an overlay `{ operationId, surfaceId, componentId, path, value }` (Rule 4).
  3. Call `rpc.call('surface:change', { routingId, surfaceId, revision, operationId, componentId, value }, { timeout: 10_000 })`.
- Select (from `selectionChange`): the same shape, with `selection` (null clears). Selectable only when the component
  declares `dashboard.select` (Component 10 enforces). The overlay is the selection.
- Result handling for change and select (`SurfaceMutationResult`, `rpc-surface.types.ts:176-180`):
  - `applied`: **Rule 1**. Settle the operation and set `expectedRevision = max(expected, result.revision)`. Do not touch
    `materializedRevision`. The overlay stays until the echo or a read reaches `revision >= result.revision`, then
    retires.
  - `rejected`:
    - `stale-revision`: `requestRead`. For **select**, after the read applies, re-send once with a new id and the new
      base (re-applying the user's intent, handoff (b)). For **change**, retire the overlay and set a per-input notice
      "This field changed while you were editing. Your value was not saved." The user re-enters it. Re-sending
      automatically would overwrite a concurrent agent write to the same path;
    - `invalid-value`, `undeclared`, `budget`: retire the overlay and show a notice with `detail` as text;
    - `too-many-operations`, `operation-expired`: retire the overlay and show a notice; no retry;
    - `operation-conflict`: cannot occur without reuse. Treat it as `invalid-value`.
  - `not-found`: retire the overlay and `requestRead` (the surface is gone; the read removes it).
  - `pending`: not expected for change and select (they settle synchronously, `surface-state.service.ts:594-623`).
    Treat it as a transport failure.
  - Transport failure (`!isSuccess()` with no `errorCode`, for example `RPC timeout: surface:change`,
    `claude-rpc.service.ts:154-167`): call `surface:operation` once. Terminal status → handle it as above. `unknown` or
    another failure → retire the overlay and `requestRead`. Never resend.
  - Host refusal (`!isSuccess()` with `errorCode`, for example `INVALID_PARAMS`, `surface-rpc.handlers.ts:354-375`):
    nothing changed. Retire the overlay and show a notice.
  - Req 6.6: when a **select** fails for any non-stale reason, the local selection stays **shown**, marked unsynced,
    with the `role="status"` notice "Selection not shared with the agent: {detail}". The mark clears on the next pushed
    selection or the next user selection.
- **Rule 2** (Component 4): only a push or a read advances the materialized revision.
- **Rule 3** (Component 4): an expected revision above the materialized one, with no echo after the grace or at the
  next interaction, triggers a read. So does any `fromRevision` gap.
- **Rule 4** (`apps-operation-overlays.ts`):
  - overlays live in `Map<operationId, overlay>`, in send order;
  - the value an input shows is: the unsent draft (renderer view state), else the **latest** unretired overlay for its
    `path` (several inputs may share a path), else `readSurfacePath(dataModel, path, kind)`;
  - `retire(operationId)` removes exactly that overlay. A newer overlay for the same input, or a pending retry, keeps
    its own;
  - `retireSettledUpTo(surfaceId, materializedRevision)` retires every settled overlay whose ack revision is at or
    below the materialized revision;
  - a read retires every settled overlay of that surface.
- Submit (`AppsSubmitFlow`, from the renderer's `actionInvoke` for an action whose `action === 'surface.submit'`):
  1. Precondition: the Apps session is not processing (`isProcessing()`). Otherwise the button is already disabled.
     This avoids a certain `busy` (`surface-state.service.ts:258-265`).
  2. Flush: the renderer commits any unsent drafts in scope first (it emits `inputCommit` before `actionInvoke`).
  3. Wait until the surface queue is empty and `materializedRevision >= expectedRevision` (read after the grace).
     Submit needs `base === current` (`surface-concurrency.ts:175-178`).
  4. Local pre-check: `collectSubmitScope(content.surface.components, actionId)` (`surface-bindings.ts:374`), then
     `checkSubmitValues(scope.inputs, content.dataModel)` (`:297`). If it fails, mark every issue and send nothing. That
     saves a ledger record (`maxOperationRecordsPerRoutingId` 128 per 10 min, `surface-catalog.ts:127-129`).
  5. Send `surface:action { routingId, surfaceId, revision: materializedRevision, operationId: new, actionId }` with
     the default 30 s timeout. The status becomes `pending`, and that submit button is disabled.
  6. Map the result to the state table below.
  7. Polling after a transport failure with no `errorCode`, including the 30 s timeout: this is **not a result**. Poll
     `surface:operation { routingId, operationId }` every 3 s, with a 10 s timeout per call, until terminal. `pending`
     keeps polling (the host allows up to 120 s, `surface-submit-turn.service.ts:98`). The polling stops at 150 s after
     the send, or after 3 consecutive poll transport failures, and settles as `unknown`. Only one poll timer exists per
     slice (the busy rule allows one pending submit per routing id). It is released on discard. Nothing is ever
     resent.
  8. On `applied` or `indeterminate`, append a user bubble "Submitted: {action label text}" to the transcript,
     because the turn was started by the host and not by `chat:continue`. When `surfaceState.kind === 'updated'`, set
     the expected revision to its `revision` (Rule 1).
- State table (the renderer shows `SurfaceInteractionState.actions[actionId]`):

  | State | Source | UI duty |
  | --- | --- | --- |
  | pending | `surface:action` or `surface:operation` `pending`; also while polling | Button disabled with "Sending…"; poll |
  | applied | `SurfaceSubmitAppliedResult` (`:158-162`); `surface:operation` `applied` | "Sent". Bubble added. Expected revision from `surfaceState` when `updated`. The view updates only from the echo or a read |
  | rejected | `SurfaceRejectedResult` (`:105-114`) | `stale-revision`: `requestRead`, re-render, button re-enabled, text "This app changed. Check the values and submit again." `submit-invalid`: mark every `issues[]` entry on its input and keep the values. `busy`: "The agent is busy; try again when it finishes." `session-unavailable`: "This conversation is not running." Other reasons: `detail` as text |
  | indeterminate | `SurfaceSubmitIndeterminateResult` (`:168-173`) | "May have been sent - do not resend." Not styled as a failure. Button re-enabled only after the session is idle |
  | unknown | `surface:operation` `unknown`, or polling gave up | "We could not confirm whether this was sent. Check the conversation before sending again." Authorizes neither rollback nor replay |
  | not-found | `SurfaceNotFoundResult` (`:117-120`), or a `deleted` push | The surface is removed through the reducer. Notice for `evicted` |
  | unsupported | `SurfaceUnsupportedResult` (`:136-140`) | Not reachable from the UI, because only `surface.submit` renders as a control. Handled defensively: `detail` as text |

- Reconciliation cases the specs must pin (handoff (c)), in `apps-surface-operations.service.spec.ts`, driving the
  real reducer with a scripted `MockRpc` and scripted pushes:
  1. **Result before echo**: an `applied` result (rev R) arrives, then the echo `ops` (from R-1, rev R). The result
     does not change `materializedRevision`. The echo is applied. The overlay retires at the echo.
  2. **Echo before result**: the echo is applied first. The later result only settles the operation and does not
     re-apply anything. `materializedRevision` stays R.
  3. **Non-conflicting agent write between base and commit**: the base is B, an agent push at B+1 is lost or delayed,
     and the own commit is B+2 with the echo `fromRevision` B+1. That is a gap: the reducer asks for a read, and the read
     result (rev B+2) replaces the view.
  4. **Newer push, then older RPC result**: a push at R+1 is applied, then a result for rev R arrives. The materialized
     revision stays R+1. The same holds for a stale `surface:read` answer.
  5. **Lost echo**: an `applied` result with no echo. After 1,500 ms (fake timers) exactly one `surface:read` is issued,
     and its result recovers the view and retires the overlay.
  6. **Older operation settles while a newer edit to the same input is pending**: overlays A (older) and B (newer)
     exist for one input. A settles and retires. B's overlay stays, and the input shows B's value.
  Also pinned:
  - eviction delete at an equal revision is terminal (reducer spec);
  - submit waits for the queue and echo before sending;
  - a 30 s timeout leads to polling, with no second `surface:action`;
  - `stale-revision` on select re-sends once with a new id; on change it does not re-send;
  - no `chat:start` or `chat:continue` call from any mutation (Req 6.4, frontend half).
- Verified contracts: the evidence rows for `rpc-surface.types.ts`, `surface-concurrency.ts`,
  `surface-rpc.handlers.ts`, `claude-rpc.service.ts` and `surface-catalog.ts`.
- Dependencies: core (`ClaudeRpcService`), `AppsSessionService` (slice access), `shared/mcp-apps-contracts/surface`.
- Failure behaviour: never throws. Every failure ends in a settled operation and a text notice. The rendered surface
  is never discarded by a failed mutation.
- Files:
  - CREATE `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/mcp-apps-page/src/lib/state/surface-operation-id.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/mcp-apps-page/src/lib/state/apps-operation-overlays.ts` (+ `.spec.ts`)

### 6. `AppsPageComponent` (routed view)

- Purpose: render the active slice. It holds no state of its own.
- Split (facade rule): `AppsPageComponent` (host, composer, layout) composes `AppsTranscriptComponent` (transcript
  and this surface's prompts) and `AppsSurfacePanelComponent` (surface switcher, renderer, fallbacks and notices).
- Responsibilities:
  - host `tabindex="-1"`, plus the focus memory directive (D1);
  - empty state with the request input when there are no surfaces and no transcript (Req 2.7);
  - transcript: `ExecutionTreeBuilderService.buildTree(slice.streamingState, 'apps:' + surfaceId)`
    (`execution-tree-builder.service.ts:251-254`), merged by time with the user bubbles (the harness precedent
    `harness-builder-view.component.ts:566-600`), rendered with `ExecutionNodeComponent`. Tool results stay visible
    (Req 3.5). Assistant markdown is rendered there by `libs/frontend/markdown`, never by the new libs;
  - prompts filtered to **this** surface: `permissionRequests().filter(p => targetTabsFor(p.id).includes(surfaceId))`
    and the question twin (`permission-handler.service.ts:360, 575`) (Req 2.3);
  - composer with send, stop and "New conversation" (`discard()`);
  - surface panel:
    - a `role="tablist"` of live surfaces by title text when more than one exists; the active one is the latest
      agent-created or agent-replaced surface unless the user picked another;
    - accepted: `<ptah-surface-renderer>` bound to `renderable`, `viewState`, `interaction`, with outputs wired to
      `AppsSurfaceOperations`;
    - rejected: a `font-mono` block "This app could not be shown." plus the reason (Req 3.5);
    - `(renderFailed)`: a `font-mono` block with `renderDashboardSpecText(spec)` (v1, `dashboard-text-fallback.ts:181`)
      or `renderSurfaceText(view)` (v2, `surface-text-fallback.ts:35`) (Req 3.6);
    - notices as `role="status"` text.
- Verified contracts: as listed.
- Dependencies: `AppsSessionService`, `AppsSurfaceOperations`, `@ptah-extension/chat` components, chat-streaming,
  declarative-dashboard.
- Failure behaviour: a render failure is contained to the surface panel. The transcript and composer stay usable.
- Quality: OnPush, signal inputs and state, standalone. No timers in components.
- Verification seam:
  - `apps-page.component.spec.ts`:
    - empty state (Req 2.7);
    - only this surface's prompts render (Req 2.3);
    - rejected → mono fallback with the transcript still present (Req 3.5);
    - `SURFACE_VIEW_MODEL_BUILDER` override throws → mono text fallback, no renderer subtree (Req 3.6);
    - destroy and re-create restores the transcript, surfaces, view state and overlays (Req 2.4);
    - sort, filter and page with `ClaudeRpcService.call` and `VSCodeService.postMessage` spies → zero calls (Req 5.4);
  - `apps-surface-panel.component.spec.ts`: the switcher appears with two surfaces; an agent snapshot activates its
    surface; eviction notice;
  - `apps-focus-memory.directive.spec.ts`: restore to the recorded key, or the host fallback (Req 7.6).
- Files:
  - CREATE `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/mcp-apps-page/src/lib/components/apps-transcript.component.ts`
  - CREATE `libs/frontend/mcp-apps-page/src/lib/components/apps-surface-panel.component.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/mcp-apps-page/src/lib/components/apps-focus-memory.directive.ts` (+ `.spec.ts`)
  - CREATE `libs/frontend/mcp-apps-page/src/index.ts`

### 7. Dashboard delivery fix on Electron - DELETED

Delivered by TASK_2026_538 (Correction 4). The four files of Revision 1 are removed from scope.

### 8. Host selection channel - DELETED

Delivered by TASK_2026_538 (D4). All the Revision 1 files are removed from scope:
- `rpc-dashboard.types.ts`, and the `rpc.types.ts` and `rpc-handler.ts` edits;
- `dashboard-session.store.ts` (+spec), and the `register.ts`, `index.ts`, `dashboard-namespace.builder.ts` (+spec)
  and `ptah-api-builder.service.ts` edits;
- `dashboard-rpc.schema.ts`, `dashboard-rpc.handlers.ts` (+spec), and the `handlers/index.ts` and `manifest.ts` edits;
- `chat-dashboard-selection-injector.service.ts` (+spec), `chat-session-dashboard-selection.spec.ts`, and the
  `tokens.ts`, `di.ts` and `chat-session.service.ts` edits.

494 adds **no backend file**. The only shared edits are the id list (Component 1), the testing barrel and the budget
doc comments (Component 11).

### 9. Harness prompt isolation

- Purpose, responsibilities and failure behaviour: unchanged. `HarnessWorkflowService` exposes
  `readonly surfaceId = this._surfaceId.asReadonly()` (field at `harness-workflow.service.ts:127`). The harness view's
  `surfacePermissions`/`surfaceQuestions` (`harness-builder-view.component.ts:612-622`) filter with
  `targetTabsFor(id).includes(surfaceId)` and `questionTargetTabsFor`, instead of `hasSurfaceTargets`.
- Verification seam: a prompt targeted at another surface id is not rendered in the harness view. The existing
  `harness-builder-view.component.spec.ts` stays green.
- Files:
  - MODIFY `libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts`
  - MODIFY `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`
  - CREATE `libs/frontend/harness-builder/src/lib/components/harness-builder-view.prompt-isolation.spec.ts`

### 10. Catalog renderer lib (`declarative-dashboard`) - extended to 13 kinds

- Purpose: render a **validated** v1 spec or v2 surface with Ptah components. It has no route for text to execute,
  and it performs no I/O.
- Input union: `SurfaceRenderable = { contract: 'dashboard-spec/1'; spec: DashboardSpecEnvelope } | { contract:
  'dashboard-spec/2'; surface: SurfaceEnvelope-without-dataModel; dataModel: SurfaceDataModel }`. It mirrors
  `SurfaceContent` (`surface.types.ts:187-196`) and is only ever built from accepted content (Component 4).
- `SurfaceRendererComponent` (`ptah-surface-renderer`):
  - inputs: `renderable`, `viewState` (client-only: sort, filter, page, chart-as-table, expanded, and **drafts** keyed
    by component id), `interaction` (host-derived: `selection`, `selectionUnsynced`, `pendingValues:
    ReadonlyMap<path, SurfaceDataValue>` from Rule 4 overlays, `issues: ReadonlyMap<componentId, readonly string[]>`,
    `actions: ReadonlyMap<actionId, SurfaceActionUiState>`, `submitDisabled: boolean`);
  - outputs: `viewStateChange`, `selectionChange` (`SurfaceSelection | null`), `inputCommit` (`{ componentId, value }`),
    `actionInvoke` (`{ actionId }`), `renderFailed`;
  - it builds the whole view model first through `SURFACE_VIEW_MODEL_BUILDER` (root default `buildSurfaceViewModel`,
    pure). If that throws, it renders nothing and emits `renderFailed` (Req 3.6 seam).
- View model (`view-model/`):
  - `view-model.types.ts`: one node union: `LayoutNode` (section, stack, grid, card: title, description, direction,
    gap, columns, children, submit actions), `InputNode` (text, select, radio-group, checkbox: id, label, path, kind,
    options, hints, placeholder, multiline, description, host value), `DisplayNode` (the five kinds, as in Revision 1,
    with optional `children` for v1 only). Each node carries `selectable: boolean`, true only when its actions include
    `dashboard.select`.
  - `dashboard-view-model.ts`: the v1 builder (Revision 1 behaviour, including `children` up to
    `DASHBOARD_LIMITS.maxTreeDepth`) and the shared display-node mapping.
  - `surface-view-model.ts`: the v2 builder. Layouts and inputs are mapped here. Display kinds reuse the shared
    display mapping. The input host value comes from `readSurfacePath(dataModel, path, kind)` (`surface-data-model.ts:79`).
    A read failure (`ok: false`) falls back to the kind's empty value from `SURFACE_INPUT_EMPTY_VALUES`
    (`surface-catalog.ts:61-66`) and marks the node with a draft error.
- Node rendering (`SurfaceNodeComponent`, recursive, `@switch` over all 13 kinds, `@default` renders nothing and emits
  `renderFailed`):
  - Layouts (`SurfaceLayoutComponent`):
    - `section`: `<section>` with an `<h3>` title and a description paragraph;
    - `card`: daisyUI `card card-bordered` with an optional title and description;
    - `stack`: flex column or row by `direction`, gap from the enum (`none|small|medium|large` → `gap-0|2|4|6`);
    - `grid`: CSS grid with `columns` (≤ `maxGridColumns` 4) that collapses to one column below `sm`;
    - children in spec order;
    - a `surface.submit` action renders as one `<button type="button" class="btn btn-primary btn-sm">` labelled with
      `action.label.text`, disabled while `submitDisabled` or while that action's state is `pending`. Its state text
      (table in Component 5) sits beside it in `role="status"`.
  - Inputs (each with a visible `<label for>`, `aria-required` from `hints.required`, `aria-invalid` and
    `aria-describedby` pointing at the draft error or submit issues, which render as text):
    - `SurfaceTextInputComponent`: `input` or `textarea` (`multiline`), with `placeholder` and `description` as text.
      Draft on every keystroke into `viewState.drafts` (local, no I/O). `checkDraftValue` marks a draft error.
      **Commit** (`inputCommit`) on blur, on `Enter` (single-line), or 600 ms after the last keystroke, and only when
      the draft passes `checkDraftValue` and differs from the displayed value. Never per keystroke. One debounce timer
      exists per component instance, active only while typing. It is cleared on commit and in `DestroyRef`. On commit
      the draft is removed from view state, and the overlay takes over.
    - `SurfaceChoiceInputComponent`: `select` (daisyUI `select select-sm`, with an empty "—" option mapping to `null`)
      and `radio-group` (`fieldset` + `legend` + radios). Commit on change.
    - `SurfaceCheckboxInputComponent`: `checkbox`. Commit on change.
    - Displayed value: `drafts[id] ?? pendingValues.get(path) ?? hostValue` (Rule 4 order).
  - Display kinds: as in Revision 1 (stat, table, list, charts per D5, `data` reference notice, pager
    `SURFACE_PAGE_SIZE = 25`, expansion with icon buttons and `Escape`). One change: row, item, stat and point
    selection is enabled **only when `selectable`** (`surface-ui-mutations.ts:331-350`). Otherwise there is no
    selection affordance.
  - Actions: only `surface.submit` (on layouts) and `dashboard.select` (as item selection) are controls. Every other
    id in `SURFACE_ACTIONS` (`surface-catalog.ts:41-44`) is **not rendered as a control**. They answer `unsupported` on
    the host (`surface-catalog.ts:45-48`) (Req 4.6).
  - Every interactive control gets `data-apps-focus-key="{surfaceId}:{componentId}:{control}"`.
  - All text is bound by interpolation or property binding (`[value]`, `[attr.placeholder]`). Nothing uses
    `innerHTML`, and nothing parses text (`dashboard-catalog.ts:138`).
- Pure modules: `table-rows.ts` and `chart-geometry.ts` (unchanged).
- Verified contracts: the `surface.types.ts`, `surface-catalog.ts`, `surface-bindings.ts` and `surface-data-model.ts`
  rows; v1 as in Revision 1.
- Dependencies: D6.
- Failure behaviour: a view-model build failure gives `renderFailed` and an empty subtree. An unknown kind cannot
  pass validation, and `@default` catches it anyway.
- Quality:
  - OnPush everywhere;
  - at most `SURFACE_PAGE_SIZE` rows in the DOM per table or list;
  - 5,000-point charts draw polylines only;
  - no timers except the active text input's debounce;
  - the no-alpha ratchet passes;
  - WCAG 2.1 AA: labels, error association, keyboard-reachable submit, visible focus.
- Verification seam:
  - per-kind component specs: Revision 1's display specs (Req 4.1, 4.2, 4.4, 4.5, 5.1-5.3, 7.1-7.5), plus layout,
    text, choice and checkbox specs. The text input spec proves: no `inputCommit` per keystroke; commit on blur, Enter
    and debounce (fake timers); an invalid draft is never committed; the timer is cleared on destroy;
  - `surface-view-model.spec.ts`: missing path → empty value; shared path → same value; `selectable` only with
    `dashboard.select`;
  - `trust-boundary.spec.ts` (R8), with fixture `'<img src=x onerror=alert(1)><script>alert(2)</script>'`
    (`dashboard-trust-boundary.spec.ts:605`). Rendered into:
    - the surface `title` and `description`;
    - `section` and `card` `title` and `description`;
    - input `label`, `options[].label`, `placeholder`, text `description`;
    - action `label`;
    - a bound data-model string shown in a text input;
    - every v1 display text field (stat label, value text, unit, column labels, cells, list text and detail, series
      names, axis labels, component titles);
    - submit `issues` messages and `detail` notices.
    Each renders literally, with no `img` or `script` element. The spec also does a comment-stripped source scan of
    `libs/frontend/declarative-dashboard/src` and `libs/frontend/mcp-apps-page/src` for `innerHTML`,
    `bypassSecurityTrust`, `DomSanitizer`, `<iframe`, and (renderer lib only) `@ptah-extension/markdown`. Finally, every
    non-submit, non-select action renders no enabled control (Req 4.3, 4.6).
- Files (all CREATE under `libs/frontend/declarative-dashboard/`):
  - scaffold: `project.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.ts`,
    `eslint.config.mjs`, `src/test-setup.ts`, `src/index.ts`
  - `src/lib/surface-view-state.ts`, `src/lib/surface-interaction.ts`
  - `src/lib/view-model/view-model.types.ts`
  - `src/lib/view-model/dashboard-view-model.ts` (+ `.spec.ts`)
  - `src/lib/view-model/surface-view-model.ts` (+ `.spec.ts`)
  - `src/lib/table/table-rows.ts` (+ `.spec.ts`)
  - `src/lib/charts/chart-geometry.ts` (+ `.spec.ts`)
  - `src/lib/components/dashboard-chart.component.ts` (+ `.spec.ts`)
  - `src/lib/components/dashboard-stat.component.ts` (+ `.spec.ts`)
  - `src/lib/components/dashboard-list.component.ts` (+ `.spec.ts`)
  - `src/lib/components/dashboard-table.component.ts` (+ `.spec.ts`)
  - `src/lib/components/dashboard-pager.component.ts`
  - `src/lib/components/surface-layout.component.ts` (+ `.spec.ts`)
  - `src/lib/components/surface-text-input.component.ts` (+ `.spec.ts`)
  - `src/lib/components/surface-choice-input.component.ts` (+ `.spec.ts`)
  - `src/lib/components/surface-checkbox-input.component.ts` (+ `.spec.ts`)
  - `src/lib/components/surface-node.component.ts` (+ `.spec.ts`)
  - `src/lib/components/surface-renderer.component.ts` (+ `.spec.ts`)
  - `src/lib/trust-boundary.spec.ts`

### 11. Budget confirmation (Req 8) - extended

- Purpose: confirm or replace the provisional v1 and v2 budgets against the real renderer.
- Responsibilities:
  - `budget-render.spec.ts` renders through `SurfaceRendererComponent`. v1 cases (Revision 1): 200 components, depth 8,
    1,000 rows, 50 columns, 5,000 points, exactly `maxSpecBytes`. **v2 cases** (`surface-catalog.ts:90-104`):
    - `maxInputs` 100 inputs;
    - `maxOptions` 50 options on one select and on one radio-group;
    - `maxChildrenPerNode` 50 children;
    - `maxGridColumns` 4;
    - a data model of `maxDataModelBytes` 64 KiB;
    - a surface of `maxSurfaceBytes` 256 KiB.
    Each case is first accepted by `validateSurfaceDocument` (so the fixture is at, not over, the limit). Then it
    renders without `renderFailed`, and the spec logs `performance.now()` deltas.
  - Add the v2 fixtures to `libs/shared/src/testing/index.ts`: `makeSurfaceEnvelope`, `makeSurfaceComponents`,
    `makeSurfaceTextInput`, `makeSurfaceDataAtDepth` (`fixtures/surface.ts:10, 26, 42, 157`). Local builders inside
    the spec cover the byte-exact and count cases.
  - Write `.ptah/specs/TASK_2026_494_ca38/budget-render-report.md` (value, outcome, jsdom ms, and Electron ms if a
    manual run is taken). Then either mark each budget "confirmed by `budget-render.spec.ts`" in the doc comments
    (`dashboard-catalog.ts` above `:163`; `surface-catalog.ts:78-82, 122`), or change a value once in its constant
    with the measurement as the reason. `nx run-many -t test -p @ptah-extension/shared` must pass unchanged, including
    `surface-budgets.spec.ts` and `dashboard-budgets.spec.ts`.
- **A:** jsdom timing is a relative signal only. The report says so.
- Failure behaviour: a budget that fails to render is lowered. The renderer is not special-cased.
- Files:
  - CREATE `libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts`
  - MODIFY `libs/shared/src/testing/index.ts`
  - MODIFY `libs/shared/src/mcp-apps-contracts/dashboard-catalog.ts` (doc comment or value)
  - MODIFY `libs/shared/src/mcp-apps-contracts/surface-catalog.ts` (doc comment or value)
  - CREATE `.ptah/specs/TASK_2026_494_ca38/budget-render-report.md`

### 12. Eager wiring and workspace config

- Responsibilities:
  - `app.config.ts`: import `SurfaceUpdateInbox` from `@ptah-extension/chat-routing` and add the provider beside `:170`;
  - `tsconfig.base.json`: two path entries (`@ptah-extension/declarative-dashboard`, `@ptah-extension/mcp-apps-page`).
    No `/services` path;
  - `eslint.config.mjs`: **no change** (R7);
  - Apps lib scaffold: `project.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.ts`,
    `eslint.config.mjs`, `src/test-setup.ts`.
- Verification seam: `nx run-many -t lint -p @ptah-extension/mcp-apps-page @ptah-extension/declarative-dashboard
  @ptah-extension/chat-routing ptah-extension-webview` shows 0 errors, and the D7 gate passes.
- Files:
  - MODIFY `apps/ptah-extension-webview/src/app/app.config.ts`, `tsconfig.base.json`
  - CREATE the scaffold files under `libs/frontend/mcp-apps-page/`

## Integration architecture

- Data flow:
  1. The user types on the Apps page. `AppsSessionService.start` claims the correlation id in
     `WorkflowSessionClaimService` and `SurfaceUpdateInbox`, registers the interactive surface, and calls `chat:start`
     (`surfaceMode`, `systemPrompt`).
  2. `chat:chunk {tabId: correlationId, surfaceMode}` is routed to the surface (`chat-message-handler.service.ts:431-453`).
  3. The agent calls `ptah_surface_update` (or `ptah_dashboard_propose_spec`). The host validates, commits in
     `SurfaceStateService`, and pushes `surface:updated {routingId: correlationId, ...}`.
  4. `MessageRouterService` → `SurfaceUpdateInbox` → the claimed listener → `guardSurfacePush` → reducer → slice.
     A gap triggers `surface:read`.
  5. `AppsPageComponent`, if mounted, renders the active surface through `SurfaceRendererComponent`. Sort, filter,
     page and drafts stay in view state. No I/O.
  6. Commit, select or submit → `AppsSurfaceOperations` → `surface:change`/`select`/`action`. The host commits and
     pushes the echo, and the reducer applies it (Rules 1-4).
  7. A submit starts one host-formatted user turn, streamed to the same surface. The agent reads selection and values
     with `ptah_surface_get_state` when it needs them.
- State or persistence:
  - frontend: one slice per workspace in the root `AppsSessionService`, for the app's lifetime. It is discarded by "New
    conversation" or workspace removal. It does not survive a restart (out of scope);
  - host: `SurfaceStateService`, in memory, bounded by `SURFACE_STORE_LIMITS`. No release on "New conversation" (D4).
- External boundaries:
  - push: routing-key check (eager), then structural guard, whole-document re-validation and selection check (lazy,
    fail-closed);
  - RPC: the host re-checks every mutation from its stored copy (`surface-rpc.handlers.ts`). The renderer sends only
    ids, a revision and a value that passed `checkDraftValue`;
  - renderer: text interpolation only, no HTML sinks, and the only controls are submit and select.
- Failure and rollback:
  - start failure: full rollback;
  - intake rejection: mono fallback;
  - render failure: text fallback;
  - lost or out-of-order push: read;
  - mutation failure: settled operation plus a notice, with the view untouched;
  - submit timeout: poll, never resend;
  - host push failure: logged on the host (`surface-state.service.ts:675-690`), recovered here by Rule 3.
- Observability:
  - host rejections go through the `RpcUserError` WARN path;
  - guard drops, intake rejections and read failures are logged with `console.warn` (surface id, revision, reason,
    and never values), as the harness handler does;
  - the operation state is visible in the UI.

## Architecture-level quality requirements

- Functional: every AC maps to a named test (table below).
- Performance: Initial total grows only by the D7 named items. Render time is recorded per budget. At most 25 rows or
  items per component are in the DOM. At most one grace timer, one poll timer and one active debounce timer exist per
  slice.
- Security: trust controls 3 and 5 are proven at the renderer (R8). Session scoping tests pass. `shell-csp.spec.ts` is
  unchanged.
- Maintainability:
  - no second id list;
  - no static import of the lazy lib from eager code;
  - the renderer stays `type:ui` with no core or transport import;
  - zod-bearing entry points are imported only by the two strict lazy libs;
  - the inbox is generic;
  - no file over 700 lines.
- Testability:

| AC | Test |
| --- | --- |
| 1.1, 1.2, 1.5 | `electron-shell.apps-tab.spec.ts` |
| 1.3, 1.4 | `webview-routing.spec.ts`, `webview-surface.types.spec.ts` |
| 2.1, 2.2, 2.4, 2.5, 2.6 | `apps-session.service.spec.ts`, `apps-page.component.spec.ts` |
| 2.3 | `apps-page.component.spec.ts`, `harness-builder-view.prompt-isolation.spec.ts` |
| 2.7 | `apps-page.component.spec.ts` |
| 3.1, 3.4, 3.5 | `apps-surface-intake.spec.ts`, `apps-surface-reducer.spec.ts` |
| 3.2, 3.3 | `surface-update-inbox.service.spec.ts`, `surface-message-routing.spec.ts`, `apps-session.service.spec.ts` |
| 3.6 | `apps-page.component.spec.ts` (`SURFACE_VIEW_MODEL_BUILDER` throws) |
| 4.1, 4.2, 4.4, 4.5 | renderer component specs |
| 4.3, 4.6 | `trust-boundary.spec.ts` + lint boundary |
| 5.1-5.3 | `table-rows.spec.ts`, table and list component specs |
| 5.4 | `apps-page.component.spec.ts` (spies, zero calls) |
| 6.1, 6.6 | `apps-surface-operations.service.spec.ts` |
| 6.2, 6.3 (pull model, Correction 6) | host: 538's `surface-state-reader.spec.ts:208` and the selection-clearing tests in `surface-state.service.spec.ts` (replace clears, `surface-commit.ts:128-160`); 494: `apps-system-prompt.spec.ts` |
| 6.4 | `apps-surface-operations.service.spec.ts` (no `chat:*`); host isolation by routing id is 538's |
| 6.5 | delivered: `rpc-allowlist.spec.ts` (538) |
| 7.1-7.5 | renderer component specs, including the input specs |
| 7.6 | `apps-focus-memory.directive.spec.ts`, `apps-page.component.spec.ts` |
| 8.1, 8.2 | `budget-render.spec.ts` + report |
| 9.1-9.3 | D7 gate file |
| Reconciliation 1-6 | `apps-surface-operations.service.spec.ts`, `apps-surface-reducer.spec.ts`, `apps-surface-sync.spec.ts` |

## Migration to `retain: true` (TASK_2026_524 batch 3)

Unchanged: add `data: { retain: true }` to the `apps` route. State already lives in the root service. The renderer's
only timer (the text debounce) is tied to `DestroyRef`. Under retention it should also flush on `SURFACE_ACTIVE`
becoming false. That is a note for the retention task, not work here.

## Open manual QA items

- **A2 (open, from 538)**: the Electron dev build must be checked for a permission prompt. In an Apps session, ask for a
  form, so the agent calls `mcp__ptah__ptah_surface_update` and `mcp__ptah__ptah_surface_get_state`. Confirm that both
  run without an unexpected permission prompt, the same way `ptah_dashboard_propose_spec` does. If a prompt appears, it
  must render on the Apps page (Req 2.3) and not in the coding chat. Record the result in `test-report.md`. An
  unexpected prompt is a finding for the permission allowlist owner, not a 494 code change.
- Req 9.2 network screenshot (D7).
- The dashboard tool result renders in the Apps transcript through `ExecutionNodeComponent` as generic MCP tool
  output (**A**, one manual run).
- The agent follows `APPS_SYSTEM_PROMPT`: after selecting a table row, ask "what is this row?" and confirm that the
  agent calls `ptah_surface_get_state` (the D4 cost check).

## Answers to the open questions

Unchanged from Revision 1:
1. `url` stays plain text.
2. The Apps session appears in the session sidebar.
3. Page size is 25.

## Team-leader handoff

- Recommended executors:
  - frontend-developer: every component. 494 now has no backend file;
  - senior-tester: the reconciliation specs review, the D7 gate, the budget report, A2 and the manual QA items;
  - visual-reviewer: contrast, focus and keyboard on the running Electron build, including the form controls.
- Complexity: HIGH. It has two new libs, a revision-reconciling client state machine with polling, 13 render kinds, a
  generic eager inbox and a measured bundle gate. The backend risk from Revision 1 is gone.
- Dependencies and ordering (component level):
  - Component 3 (inbox) precedes 4.
  - Component 12's Apps scaffold precedes 4-6. The renderer scaffold precedes 10 and 11.
  - Component 10 precedes 6 and 11.
  - Component 4 precedes 5, and 5 precedes 6.
  - Component 1 lands with or after the Apps lib's `src/index.ts` (the lock-step test and the lazy import resolve
    together).
  - The `app.config.ts` provider follows Component 3.
  - Components 2 and 9 are independent.
- Parallel-safe work: the renderer (10) and the Apps state (3, 4, 5) are file-disjoint. Components 2 and 9 are disjoint
  from everything.
- Ordered component list with files (groups of at most 6 files; `+spec` counts as a file; a lib scaffold counts as one
  generator unit):
  1. **G1 - Component 3 inbox**: `libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts`, `.spec.ts`,
     `libs/frontend/chat-routing/src/index.ts`, `apps/ptah-extension-webview/src/app/app.config.ts`,
     `apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts` (5)
  2. **G2 - renderer scaffold**: `libs/frontend/declarative-dashboard/` scaffold (`project.json`, `tsconfig*.json`,
     `jest.config.ts`, `eslint.config.mjs`, `src/test-setup.ts`, `src/index.ts`), plus `tsconfig.base.json` (both paths)
  3. **G3 - view model types and v1 builder**: `surface-view-state.ts`, `surface-interaction.ts`,
     `view-model/view-model.types.ts`, `view-model/dashboard-view-model.ts` (+spec) (5)
  4. **G4 - table and charts**: `table/table-rows.ts` (+spec), `charts/chart-geometry.ts` (+spec),
     `components/dashboard-chart.component.ts` (+spec) (6)
  5. **G5 - display components**: `dashboard-stat.component.ts` (+spec), `dashboard-list.component.ts` (+spec),
     `dashboard-pager.component.ts` (5)
  6. **G6 - v2 builder, table component and layout**: `view-model/surface-view-model.ts` (+spec),
     `dashboard-table.component.ts` (+spec), `surface-layout.component.ts` (+spec) (6)
  7. **G7 - inputs**: `surface-text-input.component.ts` (+spec), `surface-choice-input.component.ts` (+spec),
     `surface-checkbox-input.component.ts` (+spec) (6)
  8. **G8 - node and renderer**: `surface-node.component.ts` (+spec), `surface-renderer.component.ts` (+spec),
     `src/index.ts` (exports), `trust-boundary.spec.ts` (6)
  9. **G9 - budgets**: `budget-render.spec.ts`, `libs/shared/src/testing/index.ts`, `dashboard-catalog.ts`,
     `surface-catalog.ts`, `budget-render-report.md` (5)
  10. **G10 - Apps scaffold and pure state**: `libs/frontend/mcp-apps-page/` scaffold, `state/surface-operation-id.ts`
      (+spec), `state/apps-operation-overlays.ts` (+spec)
  11. **G11 - intake and reducer**: `state/apps-surface-intake.ts` (+spec), `state/apps-surface-reducer.ts` (+spec),
      `apps-system-prompt.ts` (+spec) (6)
  12. **G12 - session**: `services/apps-workspace-slice.ts`, `services/apps-surface-sync.ts` (+spec),
      `services/apps-session.service.ts` (+spec) (5)
  13. **G13 - operations**: `services/apps-surface-operations.service.ts` (+spec), `services/apps-submit-flow.ts`
      (+spec) (4)
  14. **G14 - page**: `components/apps-page.component.ts` (+spec), `components/apps-transcript.component.ts`,
      `components/apps-surface-panel.component.ts` (+spec), `src/index.ts` (6)
  15. **G15 - focus**: `components/apps-focus-memory.directive.ts` (+spec) (2). May merge with G14 if the leader's
      count allows.
  16. **G16 - Component 1**: `webview-surface.types.ts` (+spec), `app.routes.ts`, `electron-only-surface.guard.ts`,
      `webview-routing.spec.ts` (5)
  17. **G17 - Component 2**: `electron-shell.component.ts`, `electron-shell.apps-tab.spec.ts` (2)
  18. **G18 - Component 9**: `harness-workflow.service.ts`, `harness-builder-view.component.ts`,
      `harness-builder-view.prompt-isolation.spec.ts` (3)
  19. **G19 - gate**: `.ptah/specs/TASK_2026_494_ca38/lazy-load-gate.md` (senior-tester, after G16)
- Files affected:
  - CREATE:
    - `libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts` (+spec)
    - `apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts`
    - `apps/ptah-extension-webview/src/app/electron-only-surface.guard.ts`
    - `libs/frontend/chat/src/lib/components/templates/electron-shell.apps-tab.spec.ts`
    - `libs/frontend/harness-builder/src/lib/components/harness-builder-view.prompt-isolation.spec.ts`
    - all `libs/frontend/declarative-dashboard/**` files in Components 10 and 11
    - all `libs/frontend/mcp-apps-page/**` files in Components 4, 5, 6 and 12
    - `.ptah/specs/TASK_2026_494_ca38/budget-render-report.md`, `lazy-load-gate.md`
  - MODIFY:
    - `libs/shared/src/lib/types/webview-surface.types.ts` (+spec)
    - `libs/shared/src/testing/index.ts`
    - `libs/shared/src/mcp-apps-contracts/dashboard-catalog.ts`, `surface-catalog.ts`
    - `libs/frontend/chat-routing/src/index.ts`
    - `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
    - `libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts`
    - `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`
    - `apps/ptah-extension-webview/src/app/app.routes.ts`, `app.config.ts`, `webview-routing.spec.ts`
    - `tsconfig.base.json`
  - REWRITE: none. Removed from Revision 1: every Component 7 and 8 file, `libs/frontend/mcp-apps-page/src/services.ts`,
    the `eslint.config.mjs` edit, and `apps-message-routing.spec.ts` (renamed to `surface-message-routing.spec.ts`).
- Verification points:
  - **A:** the `apps` lazy route resolves under the webview jest config. The check is that `webview-routing.spec.ts`
    passes without adding `apps` to `JEST_UNRESOLVABLE_SURFACES` (`:75`). If the page's `@ptah-extension/chat` imports
    pull untransformed ESM, add `apps` there with the same justification as `tribunal`.
  - **A:** `crypto.getRandomValues` is available in the jest environment (Node `globalThis.crypto`). The check is the
    `surface-operation-id.spec.ts` run. Otherwise inject the random source.
  - The contract lines this plan relies on are unchanged: `surface.types.ts:236-243`, `rpc-surface.types.ts:89-206`,
    `surface-concurrency.ts:175-178`, `surface-catalog.ts:76, 83-133`.
  - Commands that must pass:
    - `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard @ptah-extension/mcp-apps-page @ptah-extension/chat-routing @ptah-extension/shared @ptah-extension/chat @ptah-extension/harness-builder ptah-extension-webview`
    - `npx nx build ptah-extension-webview --configuration=production` (D7)
    - `apps/ptah-electron/src/windows/shell-csp.spec.ts` unchanged; `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts`
