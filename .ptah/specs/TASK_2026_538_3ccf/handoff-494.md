# Handoff to TASK_2026_494 - what contract v2 changes in your plan

From TASK_2026_538_3ccf (Req 12), cited at `feat/task-538-surface-contract-v2` HEAD `7eaceb503`. Paths are repo-relative.
The 494 plan read is
`.claude-worktrees/feat-task-494-apps-page-98c5a1802772/.ptah/specs/TASK_2026_494_ca38/implementation-plan.md`
(the `feat-task-494-apps-page` folder named in the brief does not exist). Sections below map to that plan's D3, D4,
Components 3-5, 7, 8, 10 and 11.

## 0. Entry points (use these three import paths only; never deep-import)

| Import path | File | Use for |
| --- | --- | --- |
| `@ptah-extension/shared` | `libs/shared/src/index.ts:35` (`export type * from './mcp-apps-contracts/surface.types'`) | Plain v2 types, `MESSAGE_TYPES`, `SurfaceUpdatedPayload`, the `surface:*` params/results. Safe for eager code |
| `@ptah-extension/shared/mcp-apps-contracts/surface` | `libs/shared/src/mcp-apps-contracts/surface.index.ts` (zod-bearing, importer must be `strict: true`) | v2 constants, schemas, `applySurfaceOps`, `readSurfacePath`, `checkDraftValue`, `checkSubmitValues`, `collectSubmitScope`, `validateSurfaceDocument`. Lazy code only |
| `@ptah-extension/shared/mcp-apps-contracts` | `libs/shared/src/mcp-apps-contracts/index.ts` | v1 `validateDashboardSpec`, `DASHBOARD_*` (still needed for v1 content) |

The v2 subpath is declared in `libs/shared/package.json:30` and `tsconfig.base.json:183`. It is the same Nx project,
so D6 needs no tag change. The renderer lib simply adds this path to its allowed imports. The `@ptah-extension/shared/testing`
barrel does NOT export the v2 fixtures in `libs/shared/src/testing/fixtures/surface.ts` (`makeSurfaceEnvelope`,
`makeSurfaceComponents`, `makeSurfaceTextInput`, `makeSurfaceDataAtDepth`). 494 adds them to
`src/testing/index.ts` if its specs need them.

## (a) D3 intake: replace `dashboard:spec-proposed` with `surface:updated`

What was delivered:
- Push type `MESSAGE_TYPES.SURFACE_UPDATED = 'surface:updated'` (`libs/shared/src/lib/types/messages/message-constants.ts:182`).
  Payload `SurfaceUpdatedPayload` (`libs/shared/src/lib/types/messages/payload-map.ts:249-264`):
  `routingId`, `surfaceId`, `revision`, `origin: 'agent' | 'ui' | 'host'`, `change: SurfaceChange`, `toolCallId?`,
  `operationId?`.
- `routingId` is the same value D3 matched as `DashboardSpecProposedPayload.sessionId`: the Apps correlation id (tabId).
- v1 bridge: `createDashboardSurfaceBridge` (`libs/backend/vscode-lm-tools/src/lib/surface/dashboard-surface-bridge.ts`)
  is wired in `ptah-api-builder.service.ts:858-863`. A `ptah_dashboard_propose_spec` call from a scoped caller is
  stored through `SurfaceStateService.recordV1Proposal` under the id `v1:<specId>` (`SURFACE_V1_ID_PREFIX`,
  `surface-agent-mutations.ts:120-122`), with `content: { contract: 'dashboard-spec/1', spec }`, and pushed as
  `surface:updated`. The agent's envelope `revision` is kept verbatim inside `spec`. The host `revision` on the
  payload is a separate counter.
- `dashboard:spec-proposed` now reaches a webview only through the defensive fallback when `SurfaceStateService` is
  not registered (`ptah-api-builder.service.ts:863`; comment corrected at `message-constants.ts:166-177`). Every host
  that runs `registerVsCodeLmToolsServices` registers it (`libs/backend/vscode-lm-tools/src/lib/di/register.ts:122-132`).

What 494 changes:
1. Component 3 `AppsSpecInbox`: `handledMessageTypes = [MESSAGE_TYPES.SURFACE_UPDATED]`. Keep the claim/release map
   keyed on `payload.routingId`. The drop rules stay (non-string `routingId` or unclaimed id: drop). Stay zod-free:
   import only `MESSAGE_TYPES` and the `SurfaceUpdatedPayload` type from `@ptah-extension/shared`.
   Recommendation: TASK_2026_539 mounts chat-tab surfaces on the same push, so shape the inbox as a generic
   routing-id dispatcher rather than an Apps-only one. The routing test then asserts "the only `surface:updated`
   handler" instead of "the only `dashboard:spec-proposed` handler".
2. Component 4 intake: `intakeDashboardSpec` becomes a per-surface reducer over `SurfaceChange`
   (`libs/shared/src/mcp-apps-contracts/surface.types.ts:236-243`). The slice holds
   `Map<surfaceId, SurfaceStateView>` (at most `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId = 8`), not one spec.
   - `snapshot`: validate, then replace that surface. v2 content: `validateSurfaceDocument({ ...content.surface,
     dataModel: content.dataModel }, bytes)` (`surface.validator.ts:617`). v1 content:
     `validateDashboardSpec(content.spec, bytes)`. Keep the `TextEncoder` counter.
   - Keep one **materialized revision** per surface: the revision of the state the renderer actually holds. It
     advances ONLY when the renderer applies a validated `surface:updated` snapshot or ops, or a `surface:read`
     result, atomically with that state. An RPC result's revision never advances it (see "Acknowledgement versus
     state" in (c)).
   - `ops`: apply with `applySurfaceOps({ content, selection, lastSubmit }, ops)` (`surface-patch.ts:258`) only when
     the materialized revision equals `change.fromRevision`. Then re-validate the result, fail-closed. Otherwise treat
     it as a gap and recover with `surface:read`. Ops can include `set-selection` and `set-last-submit`
     (`SurfaceStateOp`, `surface.types.ts:229-235`). On v1 content only those two ops occur; v1 structure always
     arrives as a snapshot (`surface-patch.ts:249-257`). The host pushes exactly the committed ops, so applying them
     reaches the host state by construction (`surface-commit.ts:83-126`).
   - `deleted`: remove the view. See the eviction rule in (c).
   - Staleness: a non-delete push is discardable only when its `revision` is not above the materialized revision,
     that is, when that revision's state has already been applied. A `snapshot` above it replaces the surface.
     `ops` above it apply only from a matching `fromRevision`; any other value is a gap.
   - Hydration and gap recovery: `surface:read { routingId }` returns every surface of the tab, complete
     (`SurfaceReadResult`, `rpc-surface.types.ts:89-96`). Call it after claim-then-first-push if the page
     (re)mounts with an empty slice, and on any `fromRevision` mismatch. Host state outlives the page (in memory only).
   - A new create or replace clears the selection on the host (`surface-commit.ts:128-165`). Reset the local view
     state from the pushed `selection`, not by assumption.

## (b) D4 channel: `surface:*` replaces `dashboard:select`

Delivered: five methods, all in `RpcMethodRegistry` (`libs/shared/src/lib/types/rpc.types.ts:2220-2237`) and
`RPC_METHOD_ENTRIES` (`:3853-3857`), prefix `'surface:'` in `ALLOWED_METHOD_PREFIXES`
(`libs/backend/vscode-core/src/messaging/rpc-handler.ts:90`). The handler is `SurfaceRpcHandlers`
(`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:115-122`, manifest key `'surface'` at
`host-profile/manifest.ts:148`). Wire types are in `libs/shared/src/lib/types/rpc/rpc-surface.types.ts`.

| Method | Params | Result | Notes |
| --- | --- | --- | --- |
| `surface:read` | `SurfaceReadParams { routingId, surfaceId? }` | `SurfaceReadResult`: `found {routingId, surfaces}` or `not-found` | No revision or op id. Complete, never truncated |
| `surface:change` | `SurfaceChangeParams { routingId, surfaceId, revision, operationId, componentId, value }` | `SurfaceMutationResult` | Host resolves the input from its stored copy and writes only its bound path. Never starts a turn |
| `surface:select` | `SurfaceSelectParams { ..., selection: SurfaceSelection \| null }` | `SurfaceMutationResult` | Same target shape as your `DashboardSelectionTarget`. The component must declare `dashboard.select` |
| `surface:action` | `SurfaceActionParams { ..., actionId }` | `SurfaceActionResult` | Params come from the stored declaration only. `surface.submit` starts one turn |
| `surface:operation` | `SurfaceOperationParams { routingId, operationId }` | `SurfaceOperationResult { status, reason?, detail?, revision?, currentRevision? }` | Status of a UI op id |

Request bytes are checked against `SURFACE_LIMITS.maxRpcRequestBytes` (16 KiB), then a `.strict()` zod schema.
Either failure is an RPC error with `INVALID_PARAMS`, and nothing changes. An unknown routing id or surface gives
`not-found` with no revision and never creates state. If the service is missing, every method throws
`SURFACE_STATE_UNAVAILABLE_MESSAGE` ("surface state unavailable on this host", `surface-rpc.handlers.ts:88`).

What 494 changes:
- Component 8 is dropped almost entirely: no `rpc-dashboard.types.ts`, no `'dashboard:'` prefix, no
  `DashboardRpcHandlers`/schema, no `DashboardSessionStore`, no `recordDelivered` hook, and no `PtahAPIBuilder` or
  `ChatSessionService` constructor edits. The host store is `SurfaceStateService`
  (`libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.ts:138`, token
  `VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE`). It is keyed by routing id (tabId) and bounded by
  `SURFACE_STORE_LIMITS` (32 routing ids, 8 surfaces each, 24 MiB, LRU), not by an LRU of 16.
- `ChatDashboardSelectionInjectorService`: recommended NOT built (plan Q2). The agent pulls the selection and form
  values with `ptah_surface_get_state`. `APPS_SYSTEM_PROMPT` should drop the `[SYSTEM CONTEXT - DASHBOARD SELECTION]`
  sentence. Instead it should tell the agent to call `ptah_surface_get_state` when the user says "this", "the selected
  row" or "the form", and to build UIs with `ptah_surface_update` (or `ptah_dashboard_propose_spec` for v1).
  494 confirms or overrides this.
- Component 5 `AppsSelectionSync` calls `surface:select` with `routingId`, `surfaceId`, the surface's materialized
  `revision` and a fresh `operationId`. On `rejected: stale-revision`, re-read and re-apply the user's intent. An
  `applied` result is an acknowledgement only; the selection becomes host state in the view when its echo is applied.
- MCP tools the agent now has: `ptah_surface_update` / `ptah_surface_get_state` (`SURFACE_UPDATE_TOOL_NAME`,
  `SURFACE_GET_STATE_TOOL_NAME`, `mcp-core/surface-tools.ts:39-40`), always on (`protocol-dispatcher.ts:317-318`,
  cases `:1677-1678`). `ptah_dashboard_propose_spec` is kept unchanged (name, schema and text result) and bridged into
  the store. Deprecating it is a later task.
- Scope source: the HTTP MCP transport now drops body-supplied `_callerSessionId`, `_callerAgentId` and
  `_callerWorkspaceRoot`, and sets them only from the request URL (`mcp-http/http-server.handler.ts:369-381`). This
  fixes a defect that predated 538. So the Apps correlation id in the MCP URL is the only thing that scopes an agent
  write to your page.
- Anonymous callers (no session id in the MCP URL). Input is validated first for every caller; invalid input is
  `rejected` (`isError: true`) whatever the scope (`surface-namespace.builder.ts:102-106`, `:186-187`). A valid
  anonymous request never stores state:

  | Tool and operation | Outcome (`surface-namespace.builder.ts`) | Tool reply (`surface-tool-handlers.ts:49-84`) |
  | --- | --- | --- |
  | `ptah_surface_update` `create` / `replace` | `render-only`: the snapshot as text at uncommitted revision 0 (`:108-116`, `:69-82`) | `isError: false` |
  | `ptah_surface_update` `patch` / `delete` | `unavailable`, "surface state unavailable for this caller" (`:117-120`) | `isError: true` |
  | `ptah_surface_get_state` (any view) | `not-found`, "no surface state for this caller" (`:188-192`) | `isError: false` (an answer, not a failure) |
  | `ptah_dashboard_propose_spec` (v1) | Bridge returns `no-surface` without storing (`dashboard-surface-bridge.ts:9`); the tool reports `accepted` with delivery `no-surface` and its text (`dashboard-namespace.builder.ts:320-327`) | unchanged v1 text result |

## (c) Renderer view model

Kinds (13, `surface-catalog.ts:23-40`): layout `section`, `stack`, `grid`, `card` (all with `children`); input
`text`, `select`, `radio-group`, `checkbox`; display: the five v1 kinds `stat`, `line-chart`, `bar-chart`, `table`,
`list`. Field shapes are in `surface.types.ts:24-111`: `grid.columns` at most 4 (`maxGridColumns`), enum
`stack.direction` and `gap`; inputs carry `id`, `label`, `path`, plus `options` (`{value,label}`) or `hints`
(`required`, and `minLength`/`maxLength` for text). v1 content keeps your existing v1 view model; v2 extends it.

Data-model binding:
- Read an input's value with `readSurfacePath(dataModel, input.path, input.kind)` (`surface-data-model.ts:79`). A
  missing path reads as the kind's empty value `SURFACE_INPUT_EMPTY_VALUES`: `''`, `null`, `null`, `false`
  (`surface-catalog.ts:61-66`).
- Paths are dot-separated segments `[A-Za-z_][A-Za-z0-9_-]*`, at most 8 segments of 64 characters each. Array indices
  are not paths. `__proto__`, `prototype` and `constructor` are denied.
- Several inputs may bind the same path. They then show one value.

Draft versus submit validation:
- Draft, checked on every write: `checkDraftValue(input, value)` (`surface-bindings.ts:201`). It rejects a wrong
  type, a non-option value and text over `maxStringLength`. An empty required field and length-hint violations are
  valid drafts. Before submit the renderer may mark only these draft errors. It must not send a value that fails this
  check.
- Submit: `collectSubmitScope(components, actionId)` (`:374`) gives the inputs in the owning layout's subtree, and
  `checkSubmitValues(inputs, dataModel)` (`:297`) names every failing path. The host re-runs both. A
  `rejected: submit-invalid` carries `issues[] {componentId, path, message}`. Mark all of them, and keep the form
  values (the host leaves them unchanged).

Change versus submit:
- `surface:change` updates host state only and never starts a turn.
- `surface:action` with a `surface.submit` action id freezes the scoped values and sends exactly one user turn.
- `surface.submit` is declarable only on layout components.
- `SURFACE_HOST_SUPPORTED_ACTIONS = ['surface.submit', 'dashboard.select']` (`surface-catalog.ts:45-48`). Every other
  `dashboard.*` id returns `unsupported` with `detail` naming the action. Render those as disabled or not at all, as
  today.
- `dashboard.select` sent through `surface:action` is refused `undeclared` with `SURFACE_ACTION_SELECT_DETAIL`
  (`surface-rpc.handlers.ts:96-97`, `:454-455`). Use `surface:select` for selection.
- Rate: the ledger keeps at most `maxOperationRecordsPerRoutingId` = 128 records per tab for
  `operationRetentionMs` = 10 min, and at most 4 pending (`surface-operation-ledger.ts:424-432`). Send `change` on
  commit (blur, enter, option pick) or debounced, never per keystroke. Otherwise the tab hits `too-many-operations`.

Operation ids and revisions:
- Format: `op-<13-digit epoch ms>-<8-40 alphanumerics>` (`SURFACE_OPERATION_ID_PATTERN`, `surface-catalog.ts:76`).
- Generate a new id per user attempt. Reuse it only for a transport retry of the same request: a replay returns the
  recorded outcome and never a second turn. Different content under the same id is `operation-conflict`.
- An absent id issued more than 10 min ago, or more than `maxOperationClockSkewMs` (5 min) in the future, is
  `operation-expired`.
- Serialize mutations per surface and send the materialized revision as the base.
- UI `change` and `select` commit if no logged write since your base touches the same path, so the host can accept
  an older base while a non-conflicting agent write sits between (`surface-ui-mutations.ts:285-292`). An accepted
  commit always produces `current + 1` (`surface-commit.ts:103`), and its push says `fromRevision: current`
  (`:124`), which may be above your materialized revision.

Acknowledgement versus state (the reconciliation rule):
- What the code does. A UI commit swaps the record and calls the single push site synchronously
  (`surface-state.service.ts:567-591`, called from `runUiMutation` `:609-623`), before the outcome returns to the RPC
  handler. The push enumerates the host at once but sends each message one microtask later
  (`dashboard-namespace.builder.ts:162-170`, reached through `surface-push.ts:17-26`). The RPC reply travels a
  separate path. Nothing orders the reply against the push at the renderer, and a failed push is only logged,
  never rolled back or retried (`surface-state.service.ts:675-687`).
- Rule 1: an RPC result's `revision` (change/select `applied`, submit `surfaceState.revision`,
  `surface:operation` `revision`) is an acknowledgement. Use it to settle that operation's pending status and to
  remember an "expected revision" for the surface. Never write it into the materialized revision and never treat
  the view as current because of it. The result carries no state (`rpc-surface.types.ts:99-103`).
- Rule 2: the materialized revision advances only by applying a push or a `surface:read` result (see (a)).
- Rule 3: when the expected revision is above the materialized revision and the echo does not arrive (for example
  within a short grace period, or at the next interaction), or when any push shows a `fromRevision` gap, call
  `surface:read` and replace from it.
- Rule 4: an optimistic draft may be shown in the input while the operation is pending, but it is a display
  overlay, not host state. Drop it once the echo or a read has been applied. Key each overlay by its operation id
  and retire only the overlay whose operation settled: a newer edit to the same input (a later operation) and a
  pending retry keep their own overlay.
- Cases the 494 specs should pin: result before echo (echo still applied); echo before result (result only
  settles the operation); a non-conflicting agent write committed between your base and your commit (the echo's
  `fromRevision` exposes the gap, so read); a newer push followed by an older RPC result (materialized revision
  never moves backwards); a lost echo (the read recovers it); an older operation settling while a newer edit to the
  same input is pending (the newer overlay stays).

Result shapes (as committed in Batch 11, `rpc-surface.types.ts`):
- `change` and `select` `applied` always carry `revision` (`SurfaceAppliedResult`, `:99-103`).
- Submit `applied` and `indeterminate` carry `surfaceState: { kind: 'updated', revision } | { kind: 'not-recorded' }`
  (`SurfaceSubmitSurfaceState`, `:153-155`), NOT `revision`. `not-recorded` means the surface was deleted, evicted
  or recreated before settlement. The turn outcome still stands, and the host never invents a revision or resends.
- `SurfaceUnsupportedResult` is `{ status: 'unsupported', operationId, detail }` (`:136-140`). It carries `detail`,
  not `action`.
- `SurfaceRejectReason` (`surface.types.ts:246-258`) includes `'unsupported'`. After an unsupported action,
  `surface:operation` returns `{ status: 'rejected', reason: 'unsupported', detail }`.
- `SurfaceOperationResult` carries `revision?`, not `surfaceState`. It is absent when nothing was committed.
- `stale-revision` carries `currentRevision`. A stale `dashboard.*` action returns `stale-revision` before any
  `unsupported` or `undeclared` answer (`surface-rpc.handlers.ts:441-451`).

States the renderer must show:

| State | Source | UI duty |
| --- | --- | --- |
| pending | `surface:action` or `surface:operation` `pending` | Disable that submit. Poll `surface:operation` |
| applied | `applied` | Submit: "sent". Change/select: settle the operation and record the expected revision; the view updates from the echo or a read (Rules 1-3) |
| rejected | `rejected` + `reason` | `stale-revision`: `surface:read`, re-render, let the user retry. `submit-invalid`: mark `issues`. `busy`: "The agent is busy; try again when it finishes". `session-unavailable`: "This conversation is not running" |
| indeterminate | `indeterminate` + `detail` | "May have been sent - do not resend". Not a failure and not "cancelled" |
| unknown | `surface:operation` `unknown` | Never received or forgotten. Authorizes neither rollback nor replay |
| not-found / evicted | `not-found`, or a `deleted` push | Remove the view, with a notice for `evicted` |

Timeouts (Batch 11):
- `SurfaceSubmitTurnService.dispatch` is bounded by `SURFACE_SUBMIT_DISPATCH_DEADLINE_MS = 120_000`
  (`libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:98`). After that it settles
  `indeterminate` with `SURFACE_SUBMIT_DEADLINE_DETAIL` (`:101-103`), exactly once, and never resends.
- `ClaudeRpcService.call` times out at 30 s by default (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:135`).
  An RPC timeout on `surface:action` is therefore NOT a result. Poll `surface:operation` (for example every 2-5 s)
  until it is terminal. It reports `pending` for up to 120 s.
- `indeterminate` means "may still run". `require-idle` admission only guarantees no concurrent turn while one is
  queued or in flight. An older stalled send can still be accepted after a newer turn has finished. Cancellation or
  strict ordering would be new work.

Eviction (Batch 10 deviation 3):
- A `deleted` push with `reason: 'evicted'` carries the store's high-water revision
  (`surface-state.service.ts:655-668`), not the victim's revision + 1. That value can EQUAL the revision you hold.
- Treat an eviction delete as terminal for that `surfaceId`, whatever its revision. Never drop it as stale.
- An agent delete carries `current + 1` (`:501-512`).
- A recreated id starts above every revision ever issued, so a later snapshot always wins.

Markup duty (Req 12.1c, NFR security):
- The host proves only inert transport: `surface-trust-boundary.spec.ts` and the v2 blocks of
  `dashboard-trust-boundary.spec.ts`.
- The renderer must prove that markup characters create no elements. Bind every text as text
  (`dashboard-catalog.ts:132-136`). Extend your `trust-boundary.spec.ts` to every v2 text field: `label`, `options[].label`,
  `placeholder`, `description`, `section`/`card` `title`, and bound data-model strings. Use the fixture
  `'<img src=x onerror=alert(1)><script>alert(2)</script>'` (`dashboard-trust-boundary.spec.ts:605`).

Agent-visible text and read limits (context, not a renderer duty): `ptah_surface_get_state` answers within
`SURFACE_LIMITS.maxStateReadBytes = 548 * 1024` (`surface-catalog.ts:109-117`); a configured reader bound below
`SURFACE_READER_MIN_STATE_READ_BYTES = 40 * 1024` (`surface-state-reader.ts:131`) is refused. U+2028/U+2029 are
escaped in every agent-visible text (`surface-state-reader.ts:384-386`, `surface-text-fallback.ts:61`,
`surface-selection.ts:21`, `surface-submit.format.ts:22`). RPC results and pushes carry raw values; render them as text.

Budgets (Component 11): `SURFACE_LIMITS` and `SURFACE_STORE_LIMITS` (`surface-catalog.ts:78-133`) are PROVISIONAL,
like `DASHBOARD_LIMITS`. Add render cases at `maxInputs` 100, `maxOptions` 50, `maxChildrenPerNode` 50,
`maxGridColumns` 4, `maxDataModelBytes` 64 KiB and `maxSurfaceBytes` 256 KiB, then confirm or change them there.

## (d) Component 7: already delivered, remove from 494 scope

- Electron: `ElectronWebviewManagerAdapter.getActiveWebviews()` returns `['ptah.main']` only while
  `IpcBridge.hasLiveRenderer()` is true (`apps/ptah-electron/src/ipc/webview-manager-adapter.ts:72-73`,
  `ipc-bridge.ts:188`); `sendToRenderer` returns a truthful boolean (`ipc-bridge.ts:160`); a destroyed window seen by
  `createMainWindowHandleGetter` (`apps/ptah-electron/src/activation/bootstrap.ts:131`) gives `no-surface`, never
  `failed`. Specs: `webview-manager-adapter.spec.ts`, `apps/ptah-electron/src/di/surface-composition.spec.ts`.
- CLI: `CliWebviewManagerAdapter.getActiveWebviews()` returns `[]`
  (`libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:51-52`): state is kept, delivery is
  `no-surface` with no throw, tools return text (`libs/backend/cli-engine/src/lib/surface-composition.spec.ts:157-168`).
- Delete your Component 7 file list.

## Unaffected 494 sections

- D1 (slice now holds surfaces, form drafts and op status instead of one spec), D2 Electron-only guard, and D5 inline
  SVG charts (still for `line-chart`/`bar-chart`): unchanged.
- D6 two libs: unchanged apart from the extra import path in section 0 and the renderer's public API names.
- D7 lazy gate: unchanged. Add `libs/shared/src/mcp-apps-contracts/surface*.ts` to the "not in any initial output"
  assertion. The main barrel already reaches zod through three pre-existing modules (see follow-ups), so compare the
  zod input set against `main`, as your D7 already says.

## Open items and follow-ups

- A2 (open, manual QA check): whether Electron's MCP permission handling treats `mcp__ptah__ptah_surface_update` and
  `mcp__ptah__ptah_surface_get_state` like `ptah_dashboard_propose_spec`. It is unverified at runtime.
  `git grep` at HEAD finds no allowlist naming any of the three tools outside their own tool files,
  `system-namespace.builders.ts`, `message-constants.ts` and the shared schemas/validator texts. QA runs the Electron
  dev build and confirms that both tools run without an unexpected permission prompt in an Apps session.
- R10 (accepted, no change): `SdkAgentAdapter.sendMessageToSession` still calls `notifyActivity(sessionId, 'user')`
  before admission. A refused `require-idle` submit therefore still counts as user activity for the memory-curator and
  skill-synthesis idle triggers (it re-arms their idle timers). It does not queue a message, start a turn or write to
  the transcript. Evidence: `batch-3-report.md` "R10", `code-logic-review-batch-3.md` section 3. Moving the call only on
  the opt-in path is a possible later policy change.
- Q3 `surface:release` (NOT built): there is no clean tab-close hook today. The store is bounded by LRU plus an agent
  `delete`. TASK_2026_494 or 539 may add a `surface:release` RPC on tab close or "New conversation". Until then,
  "New conversation" leaves the old tab's surfaces in the host store until they are evicted.
- `dashboard.pin`, refresh, export, copy, open-url and drill-down actions have no host behaviour and return
  `unsupported`.
- Doc comment `surface-submit-turn.service.ts:128-136` still says "whichever of two live sends reaches that point
  second is refused busy". Qualify it as described in (c) Timeouts.
- Security: the shared MCP dispatcher catches still return raw exception text for every tool except the surface tools
  (`protocol-dispatcher.ts:1903`, "Tool X failed: <message>"). The top-level `handleMCPRequest` catch returns the
  message and stack (`:227`). The surface tools use fixed public texts (`SURFACE_TOOL_UNEXPECTED_FAILURE`,
  `SURFACE_DELIVERY_FAILED_PUBLIC`).
- The main `@ptah-extension/shared` barrel still reaches zod through three pre-existing modules:
  `lib/providers/provider-registry.ts:20`, `lib/types/origin-sidecar.types.ts:31` and
  `lib/utils/codex-token-freshness.ts:1`. `index.zod-free.spec.ts` covers only the closure of `surface.types.ts` and
  `surface-catalog.ts` (orchestrator decision, `context.md`).
- vscode-lm-tools barrel additions in Batch 14 (`libs/backend/vscode-lm-tools/src/index.ts:109-130`):
  `buildSurfaceNamespace`, `SurfaceNamespace`, `SurfaceCaller`, `SurfaceUpdateOutcome`, `SurfaceGetStateOutcome`,
  `handleSurfaceToolCall`, `SurfaceToolReply`, `SurfaceToolName`, `SURFACE_UPDATE_TOOL_NAME` and
  `SURFACE_GET_STATE_TOOL_NAME`. Earlier batches exported `createDashboardBroadcast`, `DashboardSurfaceHost`,
  `DashboardPushType` and `SurfaceStateService` with its request/outcome types (`:86-108`). `SurfaceRpcHandlers` is
  not exported. Host tests reach it through `RPC_HANDLER_MANIFEST` / `resolveRpcHandlerPlan`.

## Revision 1 (response to `code-logic-review-batch-16.md`)

- F1 (blocking): separated the acknowledged revision from the materialized revision. (a) now defines the
  materialized revision, which advances only when a push or `surface:read` result is applied, and restates the
  staleness rule in those terms. (c) replaces "the staleness rule handles both orders" with "Acknowledgement versus
  state" (code-cited push/reply ordering, Rules 1-4, and the cases to pin). The `applied` row no longer adopts the
  result revision. The base revision for `change`/`select` (b, c) is the materialized one.
- F2 (moderate): replaced the blanket anonymous `render-only` sentence in (b) with the exact matrix from
  `surface-namespace.builder.ts` and `surface-tool-handlers.ts`, including the v1 tool.
- Checked the rest of the note: no other place uses an RPC result revision as renderer state. Submit
  `surfaceState.revision` and `surface:operation` `revision` are covered by Rule 1.
