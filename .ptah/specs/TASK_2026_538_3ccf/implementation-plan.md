# Implementation Plan - TASK_2026_538

Declarative surface contract v2: layout and input primitives, a data model with bound paths, incremental patches,
host-owned two-way surface state, two MCP tools, a `surface:*` RPC namespace and the submit-to-turn path.

All `file:line` references are to the worktree
`D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2` at `origin/main` 2f798f0d5, and
were opened by the architect unless marked otherwise.

## Inputs and constraints

- Requirements used: `task-description.md` (Gate 1 approved, fixed scope: 12 requirements, NFRs, open questions,
  lane disposition), `context.md`, `task.md`.
- Corrections applied: none. `task-description.md` already carries the codex lane disposition.
- Design handoff used: none. This task renders nothing.
- Read-only references: TASK_2026_494 `implementation-plan.md` (D1-D7, D3 at L143-170, D4 at L172-217, Component 7
  at L464-484, Component 8 at L486-542), `research-property-hub-agent-ui.md` section 6 (L109-125),
  `research-chat-visual-output-history.md`; TASK_2026_490 `research-report.md` Revision 6 (L384-438); property-hub
  `ui-node.types.ts` (L48-68, L119-170), `surface-form.store.ts`, `ui-action.format.ts` (L29-46).
- Repository instruction files: there is no `CLAUDE.md` in the tree. `CONVENTIONS.md` is the authority (library
  shape section 2, barrel rule section 3 at 150 lines, tokens in `src/di/tokens.ts` section 4, one
  `register{Lib}Services` per library section 5, naming suffixes section 6, `{Lib}Error` and `Result` section 7).
- Missing decision-critical input: none. Each open question is answered from code below (section "Open questions
  answered"). No `## Clarifications Needed` was raised: the busy rule has an evidence-backed answer that needs no new
  chat behaviour, and no other choice changes a public contract in two equally supported ways.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| v1 versions are single-entry lists and the v1 envelope schema parses them with `z.enum` over those lists | `dashboard-catalog.ts:30-47`; `dashboard-spec.schemas.ts:432-435` | Adding v2 strings to the v1 lists would let a v1-shaped envelope claim v2. v2 gets its own constants (Req 1.2 allows "v2 equivalents exported from the same entry point"); v1 lists stay untouched |
| v1 component base carries `children` on every kind | `dashboard-spec.types.ts:125-133` | v2 moves nesting to explicit layout kinds; v2 display kinds are leaves |
| v1 tree bounds are walked iteratively before the recursive zod parse, and the validator never throws | `dashboard-spec.validator.ts:134-163`, `:182-231` | v2 validator repeats this order: bytes, iterative structural walk (tree AND data-value nesting), zod, then semantic checks |
| Byte counter is injected, not imported (shared cannot depend on platform-core; webview has no `Buffer`) | `dashboard-spec.validator.ts:12-28`, `:42` | Every v2 validator takes a `DashboardJsonByteCounter`; backend passes `jsonUtf8Bytes` (`platform-core/src/utils/json-budget.ts:44-47`) |
| Chart and data-source refinements are module-private | `dashboard-spec.schemas.ts:239-256`, `:279-298` | Export `requireOneDataSource` / `checkChart` from the v1 schemas file (not the barrel) so v2 display schemas reuse them; v1 behaviour unchanged |
| Recursive schema needs `.meta({ id })` for `z.toJSONSchema` | `dashboard-spec.schemas.ts:369-381`; `dashboard-propose-spec.tool.ts:43-55` | v2 component union carries `.meta({ id: 'SurfaceComponent' })`; tool schemas are generated the same way |
| Plain types reach the main barrel; schemas stay behind the entry point; importer must be `strict: true` | `libs/shared/src/index.ts:29-34`; `mcp-apps-contracts/index.ts:18-25` | `surface.types.ts` is zod-free and exported from the main barrel; schemas only from `@ptah-extension/shared/mcp-apps-contracts`. vscode-lm-tools and rpc-handlers are `strict: true` (their `tsconfig.json:7` / `:6`) |
| v1 text renderers are private and typed on `DashboardComponent` | `dashboard-text-fallback.ts:74-161` | Export per-kind display renderers typed on a structural subset so v2 reuses them; v1 output stays byte-identical |
| The v1 namespace validates then calls ONE injected `broadcast(type, payload)`; production wires `createDashboardBroadcast(() => webviewManager, logger)` | `dashboard-namespace.builder.ts:216-251`; `ptah-api-builder.service.ts:836-852` | The v1-to-store bridge is a different `broadcast` implementation injected at wiring time; the namespace and its spec stay unchanged |
| `createDashboardBroadcast` assumes `sendMessage` never rejects (`Promise.all`) | `dashboard-namespace.builder.ts:130-134` | Harden: each send is mapped to `false` on throw or rejection, so adapters with async bodies cannot reject the whole push |
| `DashboardSurfaceHost` needs `getActiveWebviews()`; only VS Code has it | `dashboard-namespace.builder.ts:74-81`; `webview-manager.ts:280-284`; `webview-manager-adapter.ts:30-79`; `cli-webview-manager-adapter.ts:20-78` | Add the method to both adapters (Req 11) |
| Electron `sendToRenderer` returns `void` and silently drops when no window or destroyed | `ipc-bridge.ts:155-170` | Electron `sendMessage` must report the real outcome, else "delivered" is reported for a failed send (Req 8.6) |
| No backend caller reads the boolean of any `WebviewManager.sendMessage` today | grep over `libs`/`apps` (no `= await …sendMessage(` outside specs) | Changing the Electron adapter's boolean to be truthful breaks nobody |
| `WEBVIEW_MANAGER` is registered on Electron after the DI phases, on CLI at container build | `apps/ptah-electron/src/activation/bootstrap.ts:338-348`; `cli-engine/src/lib/container.ts:376-380` | The store must resolve the push host lazily, not capture it at construction |
| Lazy resolve-through-container precedent inside `registerVsCodeLmToolsServices` | `vscode-lm-tools/src/lib/di/register.ts:83-103` (`mcpStatusShim`) | A `useValue` provider `{ getHost() }` that resolves `TOKENS.WEBVIEW_MANAGER` per push |
| vscode-lm-tools is registered on all three hosts | VS Code `phase-2-libraries.ts:116`; Electron `phase-3-storage.ts:134`; CLI `container.ts:772-774` (full mode only) | The store lives in vscode-lm-tools and is registered once per host by the existing call |
| CLI registers the RPC surface in the same full-mode branch | `cli-engine/src/lib/container.ts:874-889` | On CLI, store and `surface:*` handlers exist together or not at all |
| rpc-handlers already imports vscode-lm-tools at runtime; never the reverse | `rpc-handlers/package.json:16`; `chat-session.service.ts:46` | `SurfaceRpcHandlers` may inject a vscode-lm-tools token; vscode-lm-tools must not import rpc-handlers, so submit dispatch lives in rpc-handlers |
| Lib-local `Symbol.for` token precedent in vscode-lm-tools | `diagnostics-cache-invalidator.service.ts:67` | New tokens go in a new `vscode-lm-tools/src/lib/di/tokens.ts` (CONVENTIONS section 4); vscode-core `TOKENS` is not deepened |
| MCP routing scope comes from AsyncLocalStorage, set per `tools/call` | `mcp-request-context.ts:21-32`, `:53-55`, `:81-83` | Tools read scope from `getCallerSessionId()` only, never from args |
| MCP URL segment is the routing id `sessionConfig.tabId ?? sessionId` | `sdk-query-options-builder.ts:835`, `:925`, `:1508-1531`; resume passes `tabId` at `chat-session.service.ts:1248-1264` | Store key = routing id; it survives a resume |
| Protocol dispatcher case for v1, and the always-on tool list | `protocol-dispatcher.ts:283-303`, `:1619-1658` | Two new always-on tools; case bodies delegated to a new module (dispatcher is 2,177 lines) |
| `PtahAPI.dashboard` is non-optional; builder wraps each namespace in `buildNamespaceSafe` | `types.ts:99-105`; `ptah-api-builder.service.ts:869-893` | Add `surface: SurfaceNamespace` the same way |
| RPC method declaration steps and drift checks | `rpc.types.ts:657-664`, `:3413`, `:3819-3821`, `:3838-3852`; re-export style `:31-37` | New `rpc/rpc-surface.types.ts`, registry entries and `RPC_METHOD_ENTRIES` |
| Prefix allowlist enforced at registration | `vscode-core/src/messaging/rpc-handler.ts:44-90`, `:159-164` | Add `'surface:'` |
| Manifest entry shape and a `requires: []` lib-owned precedent | `host-profile/manifest.ts:84-96`, `:130-140` | `{ key: 'surface', methods: SurfaceRpcHandlers.METHODS, requires: [], handler: SurfaceRpcHandlers }` — served on every host, no host profile edits |
| Handler pattern: `@injectable`, `METHODS`, `registerMethod`, `.strict()` zod, `RpcUserError(..., 'INVALID_PARAMS')` | `peer-session-rpc.handlers.ts:51-56`, `:58-83`, `:108-117`; `peer-session-rpc.schema.ts:16-36`; `rpc-error-codes.types.ts:15` | Same shape for `SurfaceRpcHandlers` |
| Thrown `RpcUserError` becomes `{ success:false, error, errorCode }` | `rpc-handler.ts:218-237` | Schema failures throw `INVALID_PARAMS`; semantic outcomes are typed results |
| `sendMessageToSession` resolves once the message is pushed on the session queue; throws `Session not found` before any push | `sdk-agent-adapter.ts:1067-1082`; `session-stream-pump.service.ts:188-226` (`:195-198` throw, `:208-219` push) | Named acceptance point for Req 10.1 |
| A message sent mid-turn is HELD and delivered after the turn | `session-stream-pump.service.ts:75-76` (`while (queue.length > 0 && !session.turnInFlight)`); log at `:221-225` | Queueing needs no new chat behaviour — but see busy rule for why it is not chosen |
| `sendMessage` captures the record, then AWAITS `createUserMessage` (async even with no attachments), then pushes onto the captured record with no re-check | `session-stream-pump.service.ts:195-219`; `sdk-message-factory.ts:84-96` | A pre-dispatch busy/live check is not atomic with the push: the record can be torn down or another message can win during the await (lane finding 1). Needs an admission re-check after the await (Component 17) |
| Teardown aborts and removes the record; a restart displaces it; records carry a capability `token` and an `abortController` | `session-control.service.ts:235-240`; `session-registry.service.ts:53`, `:63`, `:576-595` | Identity (`registry.find(id) === session`) and `abortController.signal.aborted` are the synchronous admission checks |
| A successful turn interrupt ends the turn, not the session, and wakes the pump | `session-control.service.ts:50-54`, `:89-98`; `session-registry.service.ts:473-485` | Held-message loss is a teardown/retirement risk, not an ordinary-interrupt one (Q1 wording) |
| Typed SDK error precedent for instanceof checks at the RPC boundary | `agent-sdk/src/lib/errors/session-not-active.error.ts`, barrel `errors/index.ts` | New `SessionAdmissionRefusedError extends SdkError` |
| Session record exposes `tabId`, `messageQueue`, `turnInFlight`; lookup by tabId or real id | `session-registry.service.ts:42`, `:55`, `:65`, `:78`; `session-lifecycle-manager.ts:381-383`; token `agent-sdk/src/lib/di/tokens.ts:37`; export `agent-sdk/src/index.ts:121` | Host-side busy and liveness checks without touching agent-sdk |
| Registry presence is not liveness; the live check is `isSessionActive && isStreaming(realId or tabId)` | `chat-session.service.ts:1127-1146`; `chat-stream-broadcaster.service.ts:120-122` | Submit gate replicates the live check (it is private there) |
| Acceptance-only precedent for a host-composed turn | `peer-session-messenger.service.ts:128`, `:147` (`observed: 'acceptance-only'`) | Same semantics: "applied" means accepted by the runtime queue |
| Chat sub-service tokens and registration | `rpc-handlers/src/lib/chat/tokens.ts:10-24`; `chat/di.ts:62-75` | `CHAT_TOKENS.SURFACE_SUBMIT_TURN` registered in `registerChatServices` |
| Session-end fan-out carries no tabId; fires on stream exit, not on "user done" | `session-end-callback-registry.ts:21-24`; `session-control.service.ts:216` | Not a clean release hook for a tabId-keyed store |
| Closing a tab only aborts a streaming tab; idle close sends nothing | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:936-940` | No backend tab-close hook exists |
| Frontend chat already queues user text while a tab is busy | `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:137-186` (lane-reported, spot-checked by name) | A backend-held submit would interleave invisibly with the frontend queue |
| Push message constants and payload map | `message-constants.ts:166-177`; `payload-map.ts:234-245`, `:366` | New `SURFACE_UPDATED: 'surface:updated'` and `SurfaceUpdatedPayload` |
| No frontend consumer of `dashboard:spec-proposed` exists | grep over `libs`/`apps` (only backend and shared hits) | Moving v1 delivery onto `surface:updated` breaks no consumer |
| Host DI smoke specs use hand-built minimal containers | `apps/ptah-electron/src/di/container.smoke.spec.ts:12`; `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:186-212` | Per-host composition tests follow that precedent |
| Boundary lattice: rpc-handlers and vscode-lm-tools are `scope:extension, type:feature`; shared is `scope:shared, type:util`; electron/cli may depend on extension | `project.json` tags; `eslint.config.mjs:254-402` | Every new edge in this plan is already allowed; no new lib and no new tag |

## Open questions answered

### Q1. Busy rule for a submit while a turn runs: REJECT with a distinct `busy` reason

- What the chat path supports: the backend already holds a message sent mid-turn and runs it as the next turn
  (`session-stream-pump.service.ts:75-76`, `:221-225`). So queueing would NOT need new chat behaviour, and this is
  not a user decision.
- Why reject wins here anyway:
  1. A held message lives only in `SessionRecord.messageQueue` (`session-registry.service.ts:65`). Teardown aborts
     and removes the record (`session-control.service.ts:235-240`) with no per-message outcome, so a session end or
     a retired (failed or timed-out) interrupt drops it silently. A successful ordinary interrupt does not: it ends
     the turn and wakes the pump (`session-control.service.ts:89-98`). An operation already reported `applied` could
     therefore name a turn that never ran, violating Req 6.5 ("consistent with the side effects that actually
     happened").
  2. The webview queues typed chat text while busy (`message-dispatch.service.ts:137-186`). A backend-held submit
     is invisible to that queue, so the next turn could be the submit or the typed text depending on timing.
  3. Req 10.4 names reject as the assumption; the values stay in the store, so the user loses nothing.
- Rule: busy = `record.turnInFlight || record.messageQueue.length > 0` for the record found by routing id, OR a
  pending submit operation already exists for that routing id. Busy yields `rejected` with reason `busy`, no turn,
  values retained, revision unchanged. The operation id is terminal; a retry after the turn ends uses a new id.
- Atomicity (lane finding 1, accepted): a check before `sendMessageToSession` is not enough, because the pump awaits
  `createUserMessage` before pushing (`session-stream-pump.service.ts:195-219`). The busy and liveness conditions are
  therefore re-checked synchronously AFTER that await and immediately before the push, through an opt-in
  `admission: 'require-idle'` message option (Component 17). A competing chat message that wins the await makes the
  submit `rejected: busy`, never held. Default behaviour for every existing caller is unchanged, so this is a runtime
  guard, not new chat behaviour.

### Q2. 494's per-turn `[SYSTEM CONTEXT - DASHBOARD SELECTION]` injection: NOT built; `ptah_surface_get_state` replaces it

- The selection is host state and is readable on demand through `ptah_surface_get_state` (Req 8.3), resolved from
  the host copy, bounded, and routing-scoped. Submit carries values explicitly (Req 10). The injector's own plan
  records that its prefix becomes part of the stored user message and shows in history replay (494 plan L215-217).
- Recommendation to the 494 architect (handoff item b): do not build `ChatDashboardSelectionInjectorService`; add one
  sentence to the Apps system prompt telling the agent to call `ptah_surface_get_state` when the user refers to
  "this", "the selected row" or the form. 494 confirms or overrides.

### Q3. Store release: LRU only, plus explicit agent `delete`

- `SessionEndPayload` carries no tabId (`session-end-callback-registry.ts:21-24`; `sessionId` is
  `realSessionId ?? tabId`, `session-control.service.ts:216`), and it fires when a stream loop exits, after which
  `chat:continue` auto-resumes under the same tabId (`chat-session.service.ts:1248-1264`). Releasing there would drop
  surfaces the user is still looking at.
- An idle tab close sends nothing to the backend (`tab-manager.service.ts:936-940`).
- So no clean lifecycle hook exists today. The store is bounded by LRU (Component 5). A `surface:release` RPC that
  TASK_2026_539 could call on tab close is recorded as a follow-up in the handoff, not built.

### Q4. Staleness rule: path-level optimistic concurrency over a bounded write log

Every committed write appends `{ revision, footprint }` to the surface's write log. A mutation carrying base
revision `b` commits only if `b` is not newer than the stored revision, `b` is not older than the log floor, and no
logged write with `revision > b` conflicts with the mutation's footprint.

| Mutation | Footprint it writes | Commits against base `b` only if |
| --- | --- | --- |
| Agent `replace`, `delete`, `patch` (any op mix) | `structure` if any structure op, else the data paths | `b === current` (Req 5.4 is explicit; lane finding 3) |
| v1 proposal (bridge upsert, no base) | `structure` | always (v1 has no base revision; it is a whole replacement) |
| UI `surface:change` | the bound data path | no later write is `structure`, a `data:*` wildcard, or a data path equal to, an ancestor of, or a descendant of the bound path |
| UI `surface:select` | `selection` | no later write is `structure` or `selection` |
| UI `surface.submit` | `submit-record` (host-written at settlement) | `b === current` |

- Answer to the open question: a data-model-only agent patch makes a pending UI change stale ONLY when it wrote the
  same path, an ancestor or a descendant of the input's bound path. A structure change stales every pending UI mutation. A submit requires the
  exact current revision, because it authorises sending exactly what the user saw. Agent mutations always require
  the exact current revision (Req 5.4), so an agent that raced a user edit re-reads with `ptah_surface_get_state`
  and resends; this asymmetry is intended and pinned by tests (disjoint-path agent patch with an old base is
  rejected; disjoint-path UI change with an old base is accepted).
- Never silently overwrites: a conflicting write is rejected `stale-revision` with the current revision; the
  losing side re-reads (`surface:read` / `ptah_surface_get_state`) and retries.
- Bounds: the log keeps the last `SURFACE_LIMITS.maxWriteLogEntries` (32) entries; an entry naming more than
  `maxWriteLogPathsPerEntry` (16) paths is stored as the wildcard `data:*`. `b` below the floor is stale (cannot
  prove no conflict, so fail closed).
- The accepted commit always produces `current + 1`, never `b + 1`.
- Operation ids on agent mutations (lane finding 8, accepted in part): the NFR's "operation ids on every mutation"
  derives from Revision 6 item 3, which scopes them to mutations "that an app starts" (UI). Agent mutations are made
  retry-safe by the exact-base rule and by create-exists rejection, so a retried agent write is rejected, never
  applied twice. The host still stamps every agent commit with `operationId = 'mcp:' + toolCallId`, carried on the
  push payload and in the tool text for correlation; it is not reserved in the ledger and the agent never authors
  one (an agent cannot reliably produce the timestamped id format). If the reviewer or the user reads the NFR as
  requiring agent-authored ids, that is a contract change to `SurfaceUpdateInput` and is escalated, not assumed.

## Architecture decision

- Chosen approach:
  1. Contract v2 as new modules beside v1 in `libs/shared/src/mcp-apps-contracts/` (zod-free types and catalog,
     zod schemas, pure data-model / patch / binding / concurrency / text / submit-format functions). Version strings
     `dashboard-spec/2` and `dashboard-catalog/2`, exported as `SURFACE_SCHEMA_VERSION` / `SURFACE_CATALOG_VERSION`
     and `SURFACE_SUPPORTED_*` lists. v1 files change only by exporting two private helpers and the private text
     renderers.
  2. One host-owned `SurfaceStateService` (facade) over a `SurfaceStateStore` and a `SurfaceOperationLedger`, all in
     `libs/backend/vscode-lm-tools/src/lib/surface/`, registered as a singleton inside
     `registerVsCodeLmToolsServices` and therefore on all three hosts. Its token lives in a new
     `vscode-lm-tools/src/lib/di/tokens.ts`.
  3. MCP side: a `ptah.surface` namespace (`update`, `getState`) plus two always-on tools
     `ptah_surface_update` and `ptah_surface_get_state`, schemas and descriptions generated from the contract.
  4. v1 bridge: `ptah_dashboard_propose_spec` keeps its name, schema, text and namespace; production wiring injects a
     `broadcast` that records the validated v1 spec into the same store under the deterministic id `v1:<specId>` and
     pushes it through the same `surface:updated` message.
  5. UI side: `SurfaceRpcHandlers` in rpc-handlers (`surface:read`, `surface:change`, `surface:select`,
     `surface:action`, `surface:operation`) with strict zod params, delegating to the same service; submit dispatch
     through a new `SurfaceSubmitTurnService` in rpc-handlers chat that calls
     `IAgentAdapter.sendMessageToSession` with a new opt-in `admission: 'require-idle'` option, which the SDK stream
     pump enforces atomically before enqueueing (Component 17).
  6. Delivery: one hardened observed-delivery primitive (`createDashboardBroadcast`, widened to the two dashboard-family
     push types) plus `getActiveWebviews()` on the Electron and CLI adapters.
- Rationale: every placement reuses an existing registration path and an existing dependency edge (rpc-handlers to
  vscode-lm-tools, vscode-lm-tools to shared/platform-core). No new Nx project, no new tag, no edit to any host
  profile, and vscode-core gains one prefix string only.
- Rejected alternatives:
  - A new backend lib for the store (e.g. `surface-state`, `type:core`). It would be cleaner layering but needs a new
    project, tags, paths and three composition-root edits, for a service whose only consumers are vscode-lm-tools and
    rpc-handlers, which already share an edge. Loses on "prefer extending existing libs".
  - Token in vscode-core `TOKENS` (the `CODE_EXECUTION_MCP` precedent). Rejected by the "do not deepen vscode-core"
    rule; a lib-local token is equally importable by rpc-handlers.
  - Adding v2 version strings to the v1 `DASHBOARD_SUPPORTED_*` lists. The v1 schema uses `z.enum` over them
    (`dashboard-spec.schemas.ts:434-435`), so a v1-shaped envelope could claim `dashboard-catalog/2`; also changes v1
    constants that v1 specs pin.
  - Folding `ptah_dashboard_propose_spec` into `ptah_surface_update`. No stronger reason found; Req 8.7 default holds.
  - Keeping `dashboard:spec-proposed` on the wire beside `surface:updated`. Two intakes for one renderer (risk row 7).
  - A per-surface incarnation marker for Req 5.8. Chosen instead: revisions never restart. A new surface starts at
    `storeHighWaterMark + 1` (one store-wide number, no tombstones), so any revision or operation of an old
    incarnation is below the new incarnation's floor and fails the staleness rule. Keeps `(surfaceId, revision)` as
    the only identity the UI and agent carry, and still increments by exactly one per commit (Req 5.1).
  - Pushing a full snapshot on every change. Rejected for data and selection changes: the push carries the committed
    ops and the renderer applies them with the SAME pure function the host used, so both copies are equal by
    construction; create, replace and v1 proposals push snapshots.
  - Queueing submit behind a running turn: see Q1.
- Assumptions (each with the check that resolves it):
  - A1. Electron resolves `PtahAPIBuilder` before or after `bootstrap.ts:340`; unknown. The lazy push-host provider
    makes the design independent of it. Check: none needed; the composition spec proves delivery through the adapter.
  - A2. MCP tool permission handling treats `mcp__ptah__ptah_surface_*` like `ptah_dashboard_propose_spec` (no
    allowlist lists the v1 tool by name; grep found none). Check: run one tool call in an Electron dev session.
  - A3 (now Verified): `TOKENS.AGENT_ADAPTER` is a factory alias of `SDK_TOKENS.SDK_AGENT_ADAPTER`
    (`agent-sdk/src/lib/di/register.ts:595-598`, inside `wireAgentAdapterAliases`), called by VS Code
    `phase-2-libraries.ts:208`, Electron `phase-2-libraries.ts:257` and CLI `container.ts:679`. The acceptance
    classification in Component 16 relies only on the promise and the pre-dispatch checks, so it holds for any
    `IAgentAdapter`.
  - A4. `SessionLifecycleManager.find(routingId)` returns the record with `turnInFlight` and `messageQueue` readable
    (fields are public on `SessionRecord`, `session-registry.service.ts:42-78`). Check: open the interface; if they
    are not exported through the barrel type, import the `SessionRecord` type through the same path
    `ptah-api-builder.service.ts:368` uses for `SDK_SESSION_LIFECYCLE_MANAGER`.
- Effect on existing code:
  - v1 contract, tool name, input schema, text result and namespace API unchanged. `dashboard:spec-proposed` stays
    declared (the namespace-to-publisher hand-off type) but is no longer posted to webviews; its doc comment says so.
  - `createDashboardBroadcast` is hardened and widened; its existing tests keep passing.
  - Electron adapter `sendMessage` now returns the truthful boolean. No existing caller reads it.
  - `IpcBridge.sendToRenderer` returns `boolean` instead of `void` (all existing call sites ignore the value).
  - agent-sdk gains an opt-in admission check on `sendMessage`; without the option, every existing caller
    (`chat:continue`, peer messenger, report router, lane notifier) behaves exactly as today.

## Component specifications

Sizes: soft ceiling 700 lines per file. Where a unit would exceed it, the named facade stays the only public entry
and delegates to the listed helper modules (facade rule). Files already over the ceiling
(`protocol-dispatcher.ts` 2,177, `types.ts` 1,680, `ptah-api-builder.service.ts` 1,009) receive only wiring lines;
behaviour goes into new files.

### 1. Surface catalog (zod-free)

- Purpose: the fixed half of contract v2: versions, kind lists, action allowlist, budgets, empty values.
- Responsibilities:
  - `SURFACE_SCHEMA_VERSION = 'dashboard-spec/2'`, `SURFACE_CATALOG_VERSION = 'dashboard-catalog/2'`,
    `SURFACE_SUPPORTED_SCHEMA_VERSIONS`, `SURFACE_SUPPORTED_CATALOG_VERSIONS`, and
    `DASHBOARD_CONTRACT_VERSION_PAIRS` (`[v1,v1]`, `[v2,v2]`) as the one statement of legal pairs.
  - Kinds: `SURFACE_LAYOUT_KINDS = ['section','stack','grid','card']`,
    `SURFACE_INPUT_KINDS = ['text','select','radio-group','checkbox']`, `SURFACE_DISPLAY_KINDS` =
    `DASHBOARD_COMPONENT_KINDS` (re-used, not retyped), `SURFACE_COMPONENT_KINDS` = the 13.
  - `SURFACE_ACTIONS = [...DASHBOARD_ACTIONS, 'surface.submit']`. There is no change action: a change is the input
    binding itself, reached through `surface:change`.
  - `SURFACE_HOST_SUPPORTED_ACTIONS = ['surface.submit', 'dashboard.select']`; every other `dashboard.*` is
    "unsupported" in this task (Req 6.8).
  - Presentational enums: `SURFACE_STACK_DIRECTIONS = ['vertical','horizontal']`,
    `SURFACE_GAPS = ['none','small','medium','large']`; grid columns integer `1..maxGridColumns`.
  - `SURFACE_INPUT_EMPTY_VALUES`: text `''`, select `null`, radio-group `null`, checkbox `false`. A path absent from
    the data model reads as the kind's empty value (Req 4.4, documented choice). `required` on a checkbox means
    "checked" (`true`).
  - `SURFACE_PATH_DENYLIST = ['__proto__','prototype','constructor']`, path segment pattern
    `^[A-Za-z_][A-Za-z0-9_-]*$`, dot separator.
  - `SURFACE_ID_PATTERN = ^[A-Za-z0-9][A-Za-z0-9._-]*$` (no colon), `SURFACE_V1_ID_PREFIX = 'v1:'`; the v1 bridge id
    is `v1:<specId>`, which a v2 id can never equal because v2 ids cannot contain `:`.
  - `SURFACE_OPERATION_ID_PATTERN = ^op-[0-9]{13}-[A-Za-z0-9]{8,40}$`; the 13 digits are the issuing time in epoch ms
    (used only for fail-closed expiry, Component 6).
  - `SURFACE_LIMITS` (PROVISIONAL, same wording as `DASHBOARD_LIMITS`, `dashboard-catalog.ts:142-171`):
    `maxComponents 200`, `maxTreeDepth 8`, `maxStringLength 2000` (all three read from `DASHBOARD_LIMITS`),
    `maxChildrenPerNode 50`, `maxGridColumns 4`, `maxActionsPerComponent 8`, `maxInputs 100`, `maxOptions 50`,
    `maxOptionValueLength 200`, `maxSurfaceIdLength 128`, `maxComponentIdLength 128` (v2 component and action ids;
    tighter than v1 so the state read below is boundable), table/series limits read from `DASHBOARD_LIMITS`,
    `maxPathSegments 8`, `maxPathSegmentLength 64`, `maxDataModelDepth 6`, `maxDataModelArrayLength 200`,
    `maxDataModelObjectKeys 100`, `maxDataModelBytes 64 KiB`, `maxSurfaceBytes 256 KiB` (structure + data model),
    `maxUpdateRequestBytes 300 KiB`, `maxPatchOps 100`, `maxRpcRequestBytes 16 KiB`, `maxSubmitMessageBytes 32 KiB`,
    `maxStateReadBytes 320 KiB`, `maxWriteLogEntries 32`, `maxWriteLogPathsPerEntry 16`.
  - State-read budget invariant (lane finding 7): the complete single-surface state read (`view: 'state'`) is
    data model (at most 64 KiB) + form values keyed by UNIQUE path, so their values total at most the data-model bytes
    (at most 64 KiB) plus at most 100 input entries of at most 1 KiB of ids and issues (100 KiB) + selection
    description (at most 8 KiB) + last submit (values bounded by `maxSubmitMessageBytes`, 32 KiB) + fixed metadata
    (4 KiB), about 272 KiB worst case; so `maxStateReadBytes` is set to 320 KiB, and a unit test asserts the sum of
    the component budgets stays at or under it. The structure is read separately (`view: 'structure'`, bounded by
    `maxSurfaceBytes`). An all-surfaces read may truncate (marked) and lists every surface id so the agent can read
    each one completely.
  - `SURFACE_STORE_LIMITS` (PROVISIONAL): `maxRoutingIds 32`, `maxSurfacesPerRoutingId 8`,
    `maxStoreBytes 24 MiB`, `maxOperationRecordsPerRoutingId 128`, `operationRecordBytes 1024` (fixed accounting
    charge per record), `operationRetentionMs 600000`, `maxPendingOperationsPerRoutingId 4` (of which at most one
    pending submit, by the busy rule), `maxOperationClockSkewMs 300000`, `maxLedgerRoutingIds 64`.
- Verified contracts and entry points: `DASHBOARD_ACTIONS` (`dashboard-catalog.ts:75-90`),
  `DASHBOARD_COMPONENT_KINDS` (`:56-62`), `DASHBOARD_LIMITS` (`:163-171`), `isAllowedDashboardUrl` (`:195`),
  `DASHBOARD_TEXT_FORMATS` (`:138`, stays `['plain']`).
- Dependencies: imports `dashboard-catalog.ts` only. No zod.
- Integration points: every other v2 module; tool descriptions; renderer (494).
- Failure behaviour: none (constants).
- Quality requirements: every budget a named constant; test asserts each value appears in the generated tool
  descriptions (Req 8.6b).
- Verification seam: `surface-budgets.spec.ts` (limit / limit + 1 per budget).
- Files: CREATE `libs/shared/src/mcp-apps-contracts/surface-catalog.ts`.

### 2. Surface plain types (zod-free)

- Purpose: the published TS shape of v2, importable from the zod-free main barrel.
- Responsibilities (types only):
  - `SurfaceRichText` = `DashboardRichText` (re-used). `SurfaceAction { id; action: SurfaceActionId; label; url?;
    params? }` (ids unique across the surface; `url` only on `dashboard.open-url`; `params` not allowed on
    `surface.submit`).
  - Layout: `SurfaceSectionComponent { kind:'section'; title; description?; children; actions? }`,
    `SurfaceStackComponent { direction?; gap?; children; actions? }`, `SurfaceGridComponent { columns; gap?; children;
    actions? }`, `SurfaceCardComponent { title?; description?; children; actions? }`.
  - Inputs: `SurfaceTextInput { label; path; description?; placeholder?; multiline?; hints?: { required?; minLength?;
    maxLength? } }`, `SurfaceSelectInput` / `SurfaceRadioGroupInput { label; path; options: { value; label }[];
    hints?: { required? } }`, `SurfaceCheckboxInput { label; path; hints?: { required? } }`. Inputs carry no children
    and no actions.
  - Display: the five v1 kinds with v1 fields, `children` removed, `actions?: SurfaceAction[]`.
  - `SurfaceComponent` union; `SurfaceDataValue` (string | finite number | boolean | null | array | object of them);
    `SurfaceDataModel = Readonly<Record<string, SurfaceDataValue>>`.
  - `SurfaceEnvelope { schemaVersion:'dashboard-spec/2'; catalogVersion:'dashboard-catalog/2'; surfaceId; title;
    description?; components; dataModel? }`.
  - Patch ops `SurfacePatchOp`: `set-data {path,value}`, `remove-data {path}`, `add-component {parentId|null,
    index?, component}`, `replace-component {component}` (by id), `remove-component {componentId}`,
    `set-title {title, description?}`.
  - MCP inputs: `SurfaceUpdateInput` discriminated on `operation`: `create {surface}`, `replace {baseRevision,
    surface}`, `patch {surfaceId, baseRevision, ops}`, `delete {surfaceId, baseRevision}`;
    `SurfaceGetStateInput { surfaceId?; view?: 'state' | 'structure' }` (default `state`; `structure` requires
    `surfaceId`).
  - Selection: `SurfaceSelectionTarget` = 494 D4 shape (`stat`, `table-row{rowIndex}`, `list-item{itemIndex}`,
    `chart-point{seriesIndex,pointIndex}`); `SurfaceSelection { componentId; target }`.
  - Host state views: `SurfaceContent = { contract:'dashboard-spec/2'; surface: SurfaceEnvelope-without-dataModel;
    dataModel } | { contract:'dashboard-spec/1'; spec: DashboardSpecEnvelope }`; `SurfaceStateView { surfaceId;
    revision; content; selection|null; lastSubmit|null }`; `SurfaceSubmitRecord { operationId; actionId;
    scopeComponentId; baseRevision; status:'applied'|'indeterminate'; submittedAt; values: { componentId; path; value
    }[] }`; form values `SurfaceFormValues = Record<path, { value; inputs: componentId[]; submitIssues[] }>` keyed by
    unique path (one canonical value per path, Req 3.7; bounded by the data model).
  - Push: `SurfaceChange = { kind:'snapshot'; state } | { kind:'ops'; fromRevision; ops: SurfaceStateOp[] } |
    { kind:'deleted'; reason:'agent-deleted'|'evicted' }` where `SurfaceStateOp` = `SurfacePatchOp` plus host-only
    `set-selection {selection|null}` and `set-last-submit {record}`.
  - Operation outcomes: `SurfaceOperationStatus = 'pending'|'applied'|'rejected'|'indeterminate'|'unknown'`;
    `SurfaceRejectReason` (`stale-revision`, `invalid-value`, `undeclared`, `submit-invalid`, `busy`,
    `session-unavailable`, `operation-conflict`, `operation-expired`, `too-many-operations`, `budget`).
- Verified contracts: pattern of `dashboard-spec.types.ts:1-33` (types-only, imports only `import type` from the
  catalog).
- Dependencies: `import type` from Components 1 and v1 types only.
- Integration points: main barrel (Component 9), `payload-map.ts`, `rpc-surface.types.ts`, 494 renderer.
- Failure behaviour: n/a.
- Quality requirements: no zod import reachable (Req 1.5).
- Verification seam: zod-free barrel spec (Component 9); `satisfies` binding in Component 3.
- Files: CREATE `libs/shared/src/mcp-apps-contracts/surface.types.ts`.

### 3. Surface schemas (zod)

- Purpose: the only definition of valid v2 JSON.
- Responsibilities:
  - One `.strict()` schema per kind in `SurfaceComponentSchema` (discriminated union, `.meta({ id:
    'SurfaceComponent' })`, annotated `z.ZodType<SurfaceComponent>` like `dashboard-spec.schemas.ts:369`).
  - Display kinds built from the exported v1 leaf schemas (`DashboardSeriesSchema`, `DashboardTableColumnSchema`,
    `DashboardTableCellSchema`, `DashboardListItemSchema`, `DashboardDataRefSchema`, `DashboardRichTextSchema`,
    `DashboardUrlSchema`) plus `requireOneDataSource` / `checkChart` newly exported (not barrelled) from the v1 file.
  - Inputs: exactly one `path` (`SurfacePathSchema`), plain-text label, bounded unique options (`.min(1).max(
    maxOptions)`, duplicate `value` refinement), hints objects `.strict()` so `pattern`/`regex` are unknown keys, and
    `minLength <= maxLength` refinement.
  - `SurfaceActionSchema` with `z.enum(SURFACE_ACTIONS)`; `url` only and required on `dashboard.open-url` through
    `DashboardUrlSchema` (so `isAllowedDashboardUrl` applies unchanged, Req 6.6); `params` forbidden on submit.
  - `SurfaceDataValueSchema` (recursive, `.meta({ id: 'SurfaceDataValue' })`): finite numbers only, strings capped,
    arrays and objects capped, object keys must match the segment pattern and not the denylist.
  - `SurfaceEnvelopeSchema`: `schemaVersion: z.literal(SURFACE_SCHEMA_VERSION)`, `catalogVersion:
    z.literal(SURFACE_CATALOG_VERSION)` so a mixed pair fails on the named field (Req 1.3).
  - `SurfacePatchOpSchema`, `SurfaceUpdateInputSchema` (discriminated on `operation`), `SurfaceGetStateInputSchema`,
    `SurfaceSelectionSchema`, `SurfaceOperationIdSchema`, `SurfaceIdSchema`, `SurfaceAnyIdSchema` (v2 id or
    `v1:` + v1 slug; used by RPC).
  - Every schema bound with `satisfies z.ZodType<…>` to Component 2 types.
- Verified contracts: `.strict()` everywhere and no `any` / `z.unknown()` / passthrough (policed by
  `dashboard-trust-boundary.spec.ts:129-148`, which will scan the new files too).
- Dependencies: zod, Components 1-2, v1 schemas (value import).
- Integration points: validator (Component 5), tool definitions (Component 13), RPC schema (Component 15).
- Failure behaviour: parse failure only; never throws through the validator.
- Quality requirements: no unbounded array anywhere.
- Verification seam: `surface-contract.spec.ts` round-trips a populated instance of each of the 13 kinds.
- Files: CREATE `libs/shared/src/mcp-apps-contracts/surface.schemas.ts`; MODIFY
  `libs/shared/src/mcp-apps-contracts/dashboard-spec.schemas.ts` (export `requireOneDataSource`, `checkChart`; no
  behaviour change).

### 4. Pure data-model, binding and patch functions

- Purpose: the deterministic state algebra both host and renderer run.
- Responsibilities:
  - `surface-data-model.ts`: `parseSurfacePath`, `readSurfacePath`, `pathsOverlap(a, b)` (equal, ancestor or
    descendant), `applyDataModelOps(model, ops)` returning a new model (never mutates input; builds objects with
    `Object.create(null)`-free plain literals via copy-on-write and refuses denied segments). Semantics: `set` creates
    missing parent objects; `set` through a non-object parent is an error naming the path; `remove` of a missing path
    is a no-op success (documented, Req 4.5 "remove-missing").
  - `surface-bindings.ts`: `collectSurfaceInputs(components)`; `checkBindingCompatibility(inputs)` — rule: two inputs
    may share one exact path only if they are the same value type (text with text, checkbox with checkbox, select or
    radio-group with identical option value sets); any ancestor/descendant overlap between input paths is rejected
    (Req 3.7); `checkDraftValue(input, value)` (type, option membership for non-empty, string cap; draft allows empty
    required and short text, Req 3.6); `checkSubmitValues(inputs, model)` (required, min/max length); 
    `collectSubmitScope(components, actionId)` — rule: a `surface.submit` action may be declared only on a layout
    component; its scope is the bound inputs in that component's subtree, and the scope must contain at least one
    input (Req 10.6).
  - `surface-patch.ts`: `applySurfaceOps(state, ops)` for `SurfaceStateOp` (structure ops, data ops, selection and
    last-submit ops) returning `{ ok, next } | { ok:false, reason }`; missing component or parent id is an error that
    names the id (Req 5.3); `revalidateSelection(prev, next, ops)` — clears the selection when a structure op
    replaced or removed the selected component or an ancestor, when the whole surface was replaced, or when an index
    is out of range; never remaps (Req 5.9).
  - `surface-concurrency.ts`: `SurfaceWriteFootprint`, `appendWrite(log, entry)` (bounded, wildcard collapse),
    `checkSurfaceConflict(log, current, base, footprint)` implementing the Q4 table.
- Dependencies: Components 1-2 only; no zod; no platform.
- Integration points: validator, store service, renderer.
- Failure behaviour: result unions, never throws.
- Verification seam: unit specs per file; Req 4.5 set / replace / remove / remove-missing; Req 4.1
  `Object.prototype` untouched.
- Files: CREATE `libs/shared/src/mcp-apps-contracts/surface-data-model.ts`, `surface-bindings.ts`,
  `surface-patch.ts`, `surface-concurrency.ts`.

### 5. Surface validator

- Purpose: the one boundary validator for MCP input, RPC values and post-patch results.
- Responsibilities:
  - `validateSurfaceUpdateInput(input, countBytes)`: order as v1 (`dashboard-spec.validator.ts:173-181`): request
    bytes against `maxUpdateRequestBytes`; op count against `maxPatchOps` (counted on the raw array before parse);
    iterative walk bounding component tree depth, children per node, and data-value nesting and widths; zod parse;
    never throws (catch like `:214-230`).
  - `validateSurfaceDocument(doc, countBytes)`: re-runs `SurfaceEnvelopeSchema.safeParse` on the whole resulting
    document (after create AND after every patch, Req 5.2), then the semantic checks: unique component ids and
    action ids, component count and depth, input count, binding compatibility, every stored value at a bound path
    passes `checkDraftValue` (Req 3.4), data-model bytes against `maxDataModelBytes`, structure + data model against
    `maxSurfaceBytes` naming the budget (Req 4.3), submit actions only on layout kinds with non-empty scope.
  - `validateSurfaceEnvelopeVersions(input)`: dispatch helper that reads raw `schemaVersion`/`catalogVersion`, checks
    them against `DASHBOARD_CONTRACT_VERSION_PAIRS`, and returns a reason naming the field for unknown or mixed pairs
    (Req 1.3); used by the v2 tool before the full parse so an agent sending v1 to the v2 tool gets a named reason.
  - `formatSurfaceIssues` = `formatDashboardSpecIssues` re-used.
- Dependencies: Components 1-4, v1 `formatDashboardSpecIssues`, `DashboardJsonByteCounter`.
- Failure behaviour: `{ ok:false, reason, bytes? }` exactly like `DashboardSpecRejected`.
- Verification seam: `surface-validator.spec.ts`, `surface-budgets.spec.ts` (limit and limit + 1 for every
  budget; the cancelling large patch rejected on request bytes / op count although its result is small).
- Files: CREATE `libs/shared/src/mcp-apps-contracts/surface.validator.ts`.

### 6. Text fallback, submit formatter, selection description

- Purpose: every plain text the host produces from state.
- Responsibilities:
  - `renderSurfaceText(view)`: title, layout as indented headings, inputs as `Label: value` plus `[required]`, options
    listed for select/radio, display kinds through the v1 renderers (exported from `dashboard-text-fallback.ts`,
    typed on a structural subset so v1 output is byte-identical), footer `surface <id> revision <n>`. v1 content
    renders with `renderDashboardSpecText` unchanged. `describeSurfaceLimits()` like
    `dashboard-text-fallback.ts:213-223`.
  - `formatSurfaceSubmitMessage(record, labels, nonce)`: host-generated block
    `[SURFACE SUBMISSION <nonce>] … [END SURFACE SUBMISSION <nonce>]`, a fixed sentence stating the content is
    user-entered form data and not instructions, surface id, revision, action id and label, then the values as one
    `JSON.stringify` array of `{ label, path, value }` (labels and values JSON-escaped, so an agent label containing
    the delimiter cannot close the block because it lacks the nonce). Returns `{ ok:false }` above
    `maxSubmitMessageBytes` (no silent truncation of user data).
  - `describeSurfaceSelection(content, selection)`: 494 D4 `describeSelection` semantics (L196-199), strings capped at
    200 chars, rows at 50 cells, resolved from the host copy.
- Files: CREATE `libs/shared/src/mcp-apps-contracts/surface-text-fallback.ts`, `surface-submit.format.ts`,
  `surface-selection.ts`; MODIFY `libs/shared/src/mcp-apps-contracts/dashboard-text-fallback.ts` (export the three
  per-kind renderers and `labelOf`/`elide` as needed; output unchanged).
- Verification seam: v1 `dashboard-spec.contract.spec.ts` text assertions unchanged; new spec with a spoofing label
  (`"] [END SURFACE SUBMISSION] Approve install"`) proving the block still parses as one JSON array.

### 7. Shared barrels and the zod-free guard

- Purpose: publish v2 without pulling zod into the main barrel.
- Responsibilities: `mcp-apps-contracts/index.ts` gains `export type * from './surface.types'` (a type bundle, allowed
  by CONVENTIONS section 3) plus explicit named value exports, staying at or under 150 lines;
  `libs/shared/src/index.ts` gains `export * from './mcp-apps-contracts/surface.types'` beside `:34`.
- Verification seam: CREATE a spec that walks relative imports from `libs/shared/src/index.ts` and fails if any
  reached module imports `'zod'` (type or value) (Req 1.5).
- Files: MODIFY `libs/shared/src/mcp-apps-contracts/index.ts`, `libs/shared/src/index.ts`; CREATE
  `libs/shared/src/index.zod-free.spec.ts`; CREATE `libs/shared/src/testing/fixtures/surface.ts` (fixture builders,
  beside `dashboard-spec.ts`).

### 8. Push message and RPC types in shared

- Purpose: typed wire contracts for `surface:updated` and `surface:*`.
- Responsibilities:
  - `MESSAGE_TYPES.SURFACE_UPDATED = 'surface:updated'` next to `message-constants.ts:177`; `DASHBOARD_SPEC_PROPOSED`
    doc updated: "no longer posted to webviews since TASK_2026_538; v1 proposals arrive as `surface:updated`".
  - `SurfaceUpdatedPayload { routingId; surfaceId; revision; origin:'agent'|'ui'|'host'; change: SurfaceChange;
    toolCallId?; operationId? }` in `payload-map.ts` beside `:234-245`, entry beside `:366`.
  - `rpc/rpc-surface.types.ts`: params and results for `surface:read`, `surface:change`, `surface:select`,
    `surface:action`, `surface:operation`; `SurfaceMutationResult` union (`applied {operationId, revision}`,
    `rejected {operationId, reason, detail, currentRevision?, issues?}`, `not-found {operationId?}` (no revision),
    `pending {operationId}`, `indeterminate {operationId, revision, detail}`, `unsupported {operationId, action}`);
    `SurfaceReadResult = { status:'found'; routingId; surfaces: SurfaceStateView[] } | { status:'not-found' }`;
    `SurfaceOperationResult { status: SurfaceOperationStatus; reason?; revision? }`.
  - `rpc.types.ts`: re-export beside `:37`, five `RpcMethodRegistry` entries, five `RPC_METHOD_ENTRIES` entries
    beside `:3819-3820`.
- Files: MODIFY `libs/shared/src/lib/types/messages/message-constants.ts`, `messages/payload-map.ts`,
  `lib/types/rpc.types.ts`; CREATE `libs/shared/src/lib/types/rpc/rpc-surface.types.ts`.
- Verification seam: `rpc-allowlist.spec.ts`, `verify-and-report.spec.ts` and the three `rpc-surface.spec.ts` host
  specs pass unchanged (they are generic over `RPC_METHOD_NAMES`).

### 9. Delivery: adapters and the hardened broadcast

- Purpose: truthful delivery on VS Code, Electron and CLI (Req 11, Req 8.6).
- Responsibilities:
  - `ElectronWebviewManagerAdapter.getActiveWebviews()` returns `['ptah.main']` when `ipcBridge.hasLiveRenderer()`
    is true, else `[]`; `sendMessage` returns the boolean from `sendToRenderer` inside `try/catch` (false on throw).
  - `IpcBridge`: add `hasLiveRenderer(): boolean` (calls `getWindow()` and `isDestroyed?.()`, no logging);
    `sendToRenderer` returns `true` when handed to `webContents.send` or enqueued as a batched stream event, `false`
    when dropped (`:162-168`).
  - `CliWebviewManagerAdapter.getActiveWebviews()` returns `[]` with a doc comment: the CLI and TUI render no
    surfaces; `no-surface` is the honest, successful answer.
  - `createDashboardBroadcast`: widen `type` to `DashboardPushType = DASHBOARD_SPEC_PROPOSED | SURFACE_UPDATED` with
    the payload taken from `MessagePayloadMap`, widen `DashboardSurfaceHost.sendMessage` accordingly, and map each
    send through `Promise.resolve().then(() => host.sendMessage(...)).then((ok) => ok === true, () => false)` so a
    throwing or rejecting host counts as not delivered; `getActiveWebviews()` throwing yields `failed` with the
    error text, never a rejection.
- Verified contracts: `webview-manager.ts:195-227` (VS Code sendMessage returns false and catches),
  `:280-284`; adapter lines above.
- Failure behaviour: partial delivery is `failed` with `delivered` / `surfaces` counts; zero attached is
  `no-surface`.
- Verification seam: CREATE `apps/ptah-electron/src/ipc/webview-manager-adapter.spec.ts`
  (`createDashboardBroadcast(() => adapter, logger)` → `delivered, 1`, `sendToRenderer` received the payload; no
  window → `no-surface`; window destroyed between enumeration and send → `failed`; a type-level
  `const _h: DashboardSurfaceHost = adapter` check, Req 11.4); CREATE
  `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.spec.ts` (or extend if present) →
  `no-surface`, no throw, type-level check; extend `dashboard-namespace.builder.spec.ts` with throw / reject cases
  (existing assertions untouched).
- Files: MODIFY `apps/ptah-electron/src/ipc/webview-manager-adapter.ts`, `apps/ptah-electron/src/ipc/ipc-bridge.ts`,
  `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts`,
  `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.ts`.

### 10. Surface state store, operation ledger and state service (host)

- Purpose: the single authoritative, bounded copy of every surface, keyed by routing id.
- Responsibilities:
  - `SurfaceStateStore` (`*Store`, pure storage): `Map<routingId, RoutingEntry{ surfaces: Map<surfaceId,
    SurfaceRecord>, touchedAt }>`; `SurfaceRecord { content, dataModel, selection, lastSubmit, revision, writeLog,
    bytes }`; LRU touch on every read and write; eviction order: least-recently-used surface of an over-full routing
    id, least-recently-used routing id when over `maxRoutingIds`, global LRU surfaces when over `maxStoreBytes`;
    never evicts the record being committed; returns the evicted `(routingId, surfaceId)` list to the caller; keeps
    the store-wide `highWaterRevision`. Byte accounting per record = JSON bytes of content + data model + selection +
    last-submit + write log, plus `operationRecordBytes` per ledger record, plus the bytes of every pending submit
    ticket (frozen values + formatted message, reserved at `beginSubmit` before dispatch and released at settlement;
    lane finding 6). Doc comment states the worst case: `maxStoreBytes` (24 MiB) of accounted JSON, which includes
    ledger charges and pending tickets (at most one pending submit per routing id by the busy rule, each at most
    `2 * maxSubmitMessageBytes`, so at most 4 MiB across `maxLedgerRoutingIds`); a reservation that would exceed the
    byte cap after evicting every evictable surface is refused `too-many-operations`; JS heap overhead estimated at
    2-3x the accounted bytes.
  - `SurfaceOperationLedger` (lane findings 4 and 5 applied): per routing id `Map<operationId, Record{ fingerprint
    (sha-256 of canonical JSON of the validated request), kind, surfaceId, incarnation, status, reason?, revision?,
    issuedAt, createdAt, settledAt?, forgetAt? }>`.
    - Order in `reserve()`: look up the id FIRST; an existing record returns `replay` (identical fingerprint,
      pending or terminal) or `conflict` (different fingerprint), whatever its issue time. Only an absent id is then
      checked for expiry: rejected `operation-expired` when `issuedAt < now - operationRetentionMs` or
      `issuedAt > now + maxOperationClockSkewMs` (fail closed, Req 6.4).
    - Retention: a terminal record is forgotten at `forgetAt = max(settledAt, issuedAt) + operationRetentionMs`, so
      a record is never forgotten while its id could still pass the absent-id expiry check (future-dated ids
      included). Pending records are never forgotten.
    - Clock: `now` is `max(Date.now(), lastNow)` (monotonic guard against clock rollback).
    - Capacity: when a routing id holds `maxOperationRecordsPerRoutingId` unforgotten records or
      `maxPendingOperationsPerRoutingId` pending ones, a new reservation is `too-many-operations`. A whole routing
      ledger is dropped only when ALL its records are past `forgetAt`; if `maxLedgerRoutingIds` ledgers exist and
      none is droppable, a reservation for a new routing id is refused `too-many-operations`. No young record is
      ever evicted, so the fail-closed invariant holds under pressure.
    - `lookup()` returns `unknown` when absent. Ledgers outlive surface eviction.
  - Submit ticket ownership and settlement (lane finding 2): a surface's incarnation id is the revision at which it
    was created (unique, because new surfaces start at `highWaterRevision + 1`). A ticket records `(routingId,
    surfaceId, incarnation, operationId)`, a frozen copy of the scoped values and the formatted message only; it never
    holds or restores structure. Other mutations are NOT blocked while a submit is pending. At settlement the ledger
    is always settled; the `set-last-submit` commit happens only if the surface still exists with the same
    incarnation, and it is a host-written `submit-record` footprint that conflicts with nothing except a later submit
    (so it never overwrites an accepted write). If the surface was deleted, replaced by a new incarnation or evicted,
    the ledger outcome still records what happened to the turn, no last-submit is written anywhere, and a warn line
    names the case. Tests: change, replace, delete then recreate, and eviction while dispatch is unresolved.
  - `SurfaceStateService` (facade, DI singleton, token `VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE`):
    - agent writes: `applyAgentUpdate(routingId, validatedInput, toolCallId)` for create (reject existing id,
      Req 5.7), replace, patch, delete, each requiring `baseRevision === current` (Req 5.4) and stamped
      `operationId = 'mcp:' + toolCallId` on the push and result; `recordV1Proposal(routingId, spec, toolCallId)` (upsert at `v1:<specId>`,
      structure footprint, keeps the envelope's own `revision` untouched in `content.spec`; host revision separate,
      Req 8.7);
    - UI writes: `change`, `select`, `beginSubmit` (validates, reserves, freezes an immutable snapshot and the
      formatted message with a `crypto.randomUUID()` nonce), `settleSubmit(ticket, outcome)`;
    - reads: `read(routingId, surfaceId?)` (complete, for RPC), `describeForAgent(routingId, input)` (bounded text for
      MCP), `operationStatus(routingId, operationId)`;
    - every commit: conflict check (Component 4), apply ops (Component 4), full re-validation (Component 5), atomic
      swap of the record, revision `+1` (new surfaces start at `highWaterRevision + 1`), selection revalidation,
      write-log append, eviction, then push through the delivery primitive (Component 9) with the committed ops or
      snapshot; evictions push `{ kind:'deleted', reason:'evicted' }`.
    - Split (facade rule, each helper under 700 lines): `surface-state.service.ts` (facade, DI, locking order),
      `surface-agent-mutations.ts`, `surface-ui-mutations.ts`, `surface-state-reader.ts`, `surface-push.ts`.
  - Push-host provider: `VSCODE_LM_TOOLS_TOKENS.SURFACE_PUSH_HOST` registered in `registerVsCodeLmToolsServices` as
    `useValue: { getHost: () => container.isRegistered(TOKENS.WEBVIEW_MANAGER, true) ?
    container.resolve(TOKENS.WEBVIEW_MANAGER) : undefined }`, the `mcpStatusShim` precedent (`register.ts:83-103`).
- Atomicity: JS is single-threaded; each commit runs synchronously from conflict check to record swap with no
  `await` in between. Only the push and the submit dispatch are awaited, and both happen after the commit or
  reservation. The race tests in Component 16 prove "exactly one next revision".
- Revision and last-submit per submit outcome (Req 10.3): reserve → no revision change; `rejected` (validation,
  stale, busy, session unavailable, admission refused) → nothing changes; `applied` → `set-last-submit` with status
  `applied`, revision `+1`, push; `indeterminate` → `set-last-submit` with status `indeterminate`, revision `+1`,
  push, no redispatch. In both terminal-with-effect cases the write happens only on the ticket's incarnation (see
  ticket ownership above). Form values are never cleared by a submit.
- Verified contracts: `jsonUtf8Bytes` (`platform-core/src/utils/json-budget.ts:44-47`), `TOKENS.LOGGER`, delivery
  primitive, `node:crypto`.
- Dependencies: shared contract, platform-core, vscode-core `TOKENS`/`Logger` (existing edges only).
- Failure behaviour: every method returns a typed result; nothing throws to callers. Delivery failure never rolls back
  a commit; it is reported separately.
- Quality requirements: bounds as above; routing-id isolation (a surface id under another routing id is not visible);
  no `surfaceMode` precondition (Req 7.3).
- Verification seam: `surface-state.service.spec.ts` (store level: bounds, eviction pushes, cross-routing not-found,
  races), `surface-operation-ledger.spec.ts`, `surface-state.store.spec.ts`; `register.spec.ts` asserts both new
  tokens registered, service as singleton.
- Files: CREATE `libs/backend/vscode-lm-tools/src/lib/di/tokens.ts`,
  `libs/backend/vscode-lm-tools/src/lib/surface/surface-state.store.ts`, `surface-operation-ledger.ts`,
  `surface-state.service.ts`, `surface-agent-mutations.ts`, `surface-ui-mutations.ts`, `surface-state-reader.ts`,
  `surface-push.ts`, `index.ts` (folder barrel); MODIFY `libs/backend/vscode-lm-tools/src/lib/di/register.ts`,
  `libs/backend/vscode-lm-tools/src/lib/di/index.ts` (export tokens), `libs/backend/vscode-lm-tools/src/index.ts`
  (export `VSCODE_LM_TOOLS_TOKENS`, `SurfaceStateService`, `SurfacePushHostProvider` type).

### 11. v1 bridge

- Purpose: one intake for v1 and v2 (Req 8.7).
- Responsibilities: `createDashboardSurfaceBridge(service)` returns a `DashboardBroadcast`: with `payload.sessionId`
  present → `service.recordV1Proposal(sessionId, payload.spec, payload.toolCallId)` and return its delivery outcome;
  absent (anonymous) → `{ status: 'no-surface' }` with nothing stored or pushed (the v1 payload doc already says an
  absent id means "not mine", `payload-map.ts:237-243`). Wired in `ptah-api-builder.service.ts:836-852` in place of
  `createDashboardBroadcast(() => webviewManager, …)`; when the service is absent (defensive), falls back to the
  current behaviour so v1 never regresses.
- Deterministic mapping and collisions: v1 surface id `v1:<specId>`; the same `specId` in two tabs is two surfaces;
  repeating a proposal replaces (host revision `+1`, agent `revision` kept verbatim, may go down); a v2 id can never
  equal a v1 id (no `:` allowed); `ptah_surface_update` naming `v1:…` is rejected by `SurfaceIdSchema` with a reason
  saying v1 surfaces are managed by `ptah_dashboard_propose_spec`.
- Files: CREATE `libs/backend/vscode-lm-tools/src/lib/surface/dashboard-surface-bridge.ts`; MODIFY
  `ptah-api-builder.service.ts` (wiring lines only).
- Verification seam: existing `dashboard-namespace.builder.spec.ts` unchanged and green; CREATE
  `dashboard-surface-bridge.spec.ts` (repeat, changed revision, same specId two tabs, v2 collision attempt, anonymous).

### 12. Surface namespace (`ptah.surface`)

- Purpose: MCP-facing operations, mirroring `ptah.dashboard`.
- Responsibilities: `update(input: unknown, caller)` and `getState(input: unknown, caller)`; validation through
  Component 5 with `jsonUtf8Bytes`; anonymous rules (Req 8.5): create/replace validate then return text with "no
  interactive surface is attached", storing nothing; patch/delete return "surface state unavailable for this caller"
  as an error; getState returns "no surface state for this caller". `getState` with `view: 'state'` (default)
  returns the complete per-surface state within `maxStateReadBytes` by construction; without `surfaceId` it lists
  every surface id and revision first, then as many complete states as fit, with a truncation marker naming the
  omitted ids; `view: 'structure'` (with `surfaceId`) returns the component tree within `maxSurfaceBytes`.
  Invalid input rejected first (Req 8.2). Missing
  service (defensive) → outcome `unavailable` with "surface state unavailable on this host".
- Outcomes: `accepted {surfaceId, revision, text, delivery}`, `delivery-failed {…, reason}`, `rejected {reason}`,
  `unavailable {reason}`, `render-only {text}`.
- Files: CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.ts`;
  MODIFY `namespace-builders/index.ts`, `code-execution/types.ts` (`surface: SurfaceNamespace` beside `:105`),
  `ptah-api-builder.service.ts` (optional `@inject(VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE, { isOptional: true })`
  as last constructor parameter; `surface: this.buildNamespaceSafe('surface', …)`),
  `namespace-builders/system-namespace.builders.ts` (surface help; dashboard help now names `surface:updated`).
- Verification seam: `surface-namespace.builder.spec.ts` (Req 8.1, 8.2, 8.4 other-tab not-found per tool, 8.5, 8.6
  delivery matrix).

### 13. MCP tool definitions and dispatcher cases

- Purpose: `ptah_surface_update` and `ptah_surface_get_state`.
- Responsibilities: schemas generated with `z.toJSONSchema(…, { io:'input', target:'draft-7' })` and `$schema`
  stripped (`dashboard-propose-spec.tool.ts:43-55`); descriptions interpolate every kind, action id and budget from
  Component 1 plus the staleness rule and the anonymous rules; annotations `destructiveHint: false`. Dispatcher case
  bodies live in `surface-tool-handlers.ts`: read args, call `ptahAPI.surface`, map `rejected`/`unavailable`/
  `delivery-failed` to `toolErrorResponse` (delivery-failed text states the committed revision and "do not resend;
  the same patch would be stale", Req 8.6), success to `createToolSuccessResponse` with plain text.
- Files: CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.ts`,
  `mcp-core/surface-tool-handlers.ts`; MODIFY `mcp-core/protocol-dispatcher.ts` (two builders in the always-on list
  after `:303`, two `case` lines delegating), `mcp-core/index.ts` only if the barrel spec
  (`mcp-core/index.barrel.spec.ts`) requires it.
- Verification seam: `surface-tools.spec.ts` (every kind name, action id and budget value appears in the description,
  Req 8.6b; schema is a fragment without `$schema`); dispatcher spec cases for both tools with scope from
  `runWithMcpRequestContext`.

### 14. Delivery-outcome reporting to the agent

Covered by Components 9, 12 and 13; listed separately because Req 8.6 is its own acceptance group: committed
revision and delivery outcome are separate fields; `delivered` only when every attached surface's send returned
`true`; the retry of a delivery-failed patch is rejected stale by Component 4 and never applied twice.

### 15. `surface:*` RPC handlers

- Purpose: the UI's only channel to surface state.
- Responsibilities: `SurfaceRpcHandlers` (`@injectable`, `METHODS = ['surface:read','surface:change',
  'surface:select','surface:action','surface:operation']`), injecting `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`,
  `VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE` (optional), `CHAT_TOKENS.SURFACE_SUBMIT_TURN` (optional). Each
  method: measure `jsonUtf8Bytes(params)` against `maxRpcRequestBytes` → `INVALID_PARAMS` naming the budget;
  `.strict()` zod parse → `INVALID_PARAMS`; delegate. `routingId`, `surfaceId`, `revision` and, for mutations,
  `operationId` are required (Req 6.2). Unknown routing id or surface → `not-found` with no revision, never creating
  state (Req 9.6). `surface:action` resolves the action from the stored declaration only; `surface.submit` → submit
  path; `dashboard.select` → rejected `undeclared`-style reason telling the caller to use `surface:select`; any other
  `dashboard.*` → `unsupported`, no side effect, no reservation (Req 6.8). Missing service → thrown error
  "surface state unavailable on this host" (RPC error response, `rpc-handler.ts:218-237`).
- Files: CREATE `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts`,
  `handlers/surface-rpc.schema.ts` (composed from contract schemas); MODIFY `handlers/index.ts`,
  `host-profile/manifest.ts` (entry `{ key:'surface', methods, requires: [], handler }`),
  `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (`'surface:'` in `ALLOWED_METHOD_PREFIXES`).
- Verification seam: `surface-rpc.handlers.spec.ts` (unknown key, wrong type, oversize string, oversized request →
  `INVALID_PARAMS`, store unchanged; `surface:change` success with `sendMessageToSession` never called, Req 9.4;
  forged `value` for a non-input → `undeclared`; undeclared action; each unsupported action); `resolve-handler-plan`
  and `rpc-allowlist` specs green.

### 16. Submit-to-turn service

- Purpose: start exactly one agent turn from an accepted submit (Req 10).
- Responsibilities: `SurfaceSubmitTurnService.dispatch(routingId, content)`:
  1. `record = lifecycle.find(routingId)`; missing → `rejected: session-unavailable`.
  2. Live check (replicates `chat-session.service.ts:1138-1146`): `adapter.isSessionActive(routingId)` and
     `broadcaster.isStreaming(record.realSessionId ?? '') || broadcaster.isStreaming(record.tabId)`; else
     `rejected: session-unavailable` (Req 10.3).
  3. Busy (Q1): `record.turnInFlight || record.messageQueue.length > 0` → `rejected: busy` (fast path; the
     authoritative check is step 4's admission).
  4. `await adapter.sendMessageToSession(routingId as SessionId, content, { admission: 'require-idle' })` (origin
     left to the default human turn: the user pressed submit). Component 17 re-checks identity, abort and idleness
     synchronously after message preparation and immediately before the push.
  5. Resolved → `applied`. **Named runtime acceptance point**: `SessionStreamPump.sendMessage` passing its
     `require-idle` admission check and executing `session.messageQueue.push(...)` on the same, non-aborted, idle
     record (`session-stream-pump.service.ts:208-219` after Component 17), observed by the caller as the resolution of
     `IAgentAdapter.sendMessageToSession`. Because the record was idle, the pump yields the message on its next
     iteration and `markTurnStarted` runs; this is acceptance-only in the sense of
     `peer-session-messenger.service.ts:128-147`, with the pre-push race closed.
  6. `SessionAdmissionRefusedError` (thrown before any push, by construction) → `rejected` with `busy` or
     `session-unavailable` from its `reason`. Any other throw → `indeterminate` (we do not infer from error text
     whether a push happened); no redispatch.
- The handler order for `surface.submit`: `service.beginSubmit` (validate schema-level params, reserve operation,
  staleness with `read-all` footprint, `checkSubmitValues` on the scope, freeze snapshot and formatted message; a
  replayed operation returns its recorded outcome without dispatch, Req 10.5) → `pending` visible to
  `surface:operation` → `dispatch` → `service.settleSubmit`.
- Files: CREATE `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts`; MODIFY
  `libs/backend/rpc-handlers/src/lib/chat/tokens.ts` (`SURFACE_SUBMIT_TURN: Symbol.for('SurfaceSubmitTurnService')`),
  `libs/backend/rpc-handlers/src/lib/chat/di.ts` (`registerSingleton`), `chat/session/index.ts` if it barrels
  services.
- Verification seam (host boundary, Req 10.1): spy `sendMessageToSession`, a fake lifecycle record and broadcaster;
  one dispatch per accepted submit; the operation reads `pending` while the spy's promise is unresolved (Req 6.5), then
  `applied` after resolve; `rejected` for busy / not live / invalid values (form values unchanged, each failing path
  named, Req 10.2); `rejected` on `SessionAdmissionRefusedError`; `indeterminate` on any other throw; duplicate op id
  concurrent and later → one dispatch (Req 10.5); two submit actions → only the invoked scope's values in the content
  and in `lastSubmit` (Req 10.6).

### 17. Idle admission in the SDK stream pump

- Purpose: make "check busy and live, then enqueue" atomic, so an `applied` submit always names a message pushed onto
  a live, idle record (lane finding 1).
- Responsibilities:
  - `AIMessageOptions.admission?: 'require-idle'` (shared, optional; absent means today's behaviour for every
    existing caller).
  - `SdkAgentAdapter.sendMessageToSession` forwards `admission` (`sdk-agent-adapter.ts:1067-1082`);
    `SessionLifecycleManager.sendMessage` forwards it (`session-lifecycle-manager.ts:527-543`).
  - `SessionStreamPump.sendMessage` with `require-idle`: a missing record throws `SessionAdmissionRefusedError(
    'session-ended')` instead of the generic `SdkError`; after `await createUserMessage(...)` and before the push, it
    re-checks synchronously `this.registry.find(sessionId) === session`, `!session.abortController.signal.aborted`,
    `!session.turnInFlight` and `session.messageQueue.length === 0`; any failure throws
    `SessionAdmissionRefusedError` with reason `session-ended` or `busy` and pushes nothing.
  - `SessionAdmissionRefusedError extends SdkError` with a readonly `reason`, exported from the agent-sdk errors
    barrel (`errors/index.ts`) like `SessionNotActiveError`.
- Dependencies: agent-sdk internal only; rpc-handlers already depends on agent-sdk (`SDK_TOKENS` imports).
- Failure behaviour: refusal is a typed throw before any side effect; the default path is byte-for-byte unchanged.
- Verification seam: extend the stream-pump spec: with a deferred `createUserMessage`, (1) record removed during the
  await → refused `session-ended`, queue untouched; (2) a competing message pushed during the await → refused `busy`;
  (3) abort during the await → refused; (4) no `admission` → existing behaviour (message held mid-turn).
- Files: MODIFY `libs/shared/src/lib/types/ai-provider.types.ts` (`AIMessageOptions`, near `:95-101`),
  `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`,
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`,
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts`,
  `libs/backend/agent-sdk/src/lib/errors/index.ts`; CREATE
  `libs/backend/agent-sdk/src/lib/errors/session-admission-refused.error.ts`.

## Integration architecture

- Data flow, agent to UI: agent `tools/call` → HTTP handler binds `/session/{routingId}` into ALS
  (`mcp-request-context.ts:41-46`) → dispatcher → `surface-tool-handlers` → `ptah.surface.update` → validator
  (bytes, walk, zod, semantics) → `SurfaceStateService` commit (conflict check, apply, re-validate, swap, revision,
  evict) → `createDashboardBroadcast(SURFACE_UPDATED, payload)` → adapter → webview(s) → tool text result.
- Data flow, UI to host: webview RPC → `RpcHandler` prefix check → `SurfaceRpcHandlers` (bytes, zod) → service
  (`change` / `select` commit and push with `origin:'ui'`, no turn) or submit (reserve, validate, dispatch through
  `SurfaceSubmitTurnService`, settle, push) → typed result.
- v1: `ptah_dashboard_propose_spec` → unchanged namespace → bridge → `recordV1Proposal` → same push.
- State or persistence: in memory only, owned by `SurfaceStateService`; lifetime = host process; eviction by LRU and
  bytes; agent delete; no restart persistence (out of scope).
- External boundaries: MCP args (untrusted, agent-authored) validated in full before any state change; RPC params
  validated again with the same contract schemas; routing scope for MCP from ALS only; RPC scope is the routing id
  the host-owned renderer names (lane finding 1 disposition); all actions resolved from the stored declaration; URLs
  through `isAllowedDashboardUrl`; text plain only.
- Failure and rollback: validation or conflict failure changes nothing and pushes nothing; delivery failure after
  commit keeps the commit and reports; submit failure before dispatch leaves state unchanged; dispatch exception is
  `indeterminate` and never retried by the host.
- Observability: `Logger` lines at warn for rejections and delivery failures (v1 precedent
  `dashboard-namespace.builder.ts:232-234`, `:254-256`), at info for commits with routing id, surface id and revision;
  RPC refusals are already logged at warn by `rpc-handler.ts:221-228`.

## Architecture-level quality requirements

- Functional: every acceptance criterion in `task-description.md` Req 1-12 maps to a test in the table below.
- Performance: not applicable (no latency target requested). Every request is bounded before parse.
- Security (Revision 6 items 1, 3, 8): action allowlist; zod at MCP and RPC boundaries; plain text only
  (`DASHBOARD_TEXT_FORMATS` unchanged); URL allowlist unchanged; host mediation of every action and write; operation
  ids with fail-closed expiry; routing isolation; prototype-pollution denylist; submit content host-delimited with a
  nonce.
- Maintainability: no new project, tag or host-profile edit; vscode-core gains one string; v1 files change only by
  exports; facade rule on the store; barrels at or under 150 lines.
- Testability: behaviour-level tests listed per group below.

### Test plan per acceptance group

| Group | Where | What proves it |
| --- | --- | --- |
| Req 1 versioning | `surface-contract.spec.ts`; v1 specs untouched | v1 fixtures parse identical; v2 accepted; unknown and mixed pairs rejected naming `schemaVersion`/`catalogVersion`; v1 envelope with a `select` rejected; zod-free barrel walk |
| Req 2 layout | `surface-contract.spec.ts`, `surface-budgets.spec.ts` | each kind accepted; unknown key rejected; children/columns/components/depth at limit and limit + 1; free-form `style`/`className` rejected |
| Req 3 inputs | same + `surface-bindings.spec.ts` | options at budget and + 1, duplicate values; `pattern`/`regex` rejected; min > max rejected; wrong-typed stored value rejected; empty required storable as draft; shared-path compatibility and overlap rejection |
| Req 4 data model | `surface-data-model.spec.ts`, `surface-budgets.spec.ts`, RPC spec | denied segments reject and leave `Object.prototype` untouched; non-finite, depth, width; byte budget names the budget; cancelling large patch; oversized RPC; missing path reads empty; set / replace / remove / remove-missing |
| Req 5 identity and patches | `surface-state.service.spec.ts` | revision + 1; same id other routing is another surface; invalid result leaves store and revision and pushes nothing; missing ids named; stale base names current; delete then get_state not-found; push carries routing id, surface id, revision; races (UI change vs agent patch, replace, delete, both orders); recreate after delete starts above old revisions; selection cleared on replace/remove/out-of-range |
| Req 6 actions | `surface-rpc.handlers.spec.ts`, `surface-operation-ledger.spec.ts`, trust-boundary specs | allowlist; missing params `INVALID_PARAMS`; stale vs not-found shapes; op reuse identical → same outcome, different content → conflict; expired → fail closed; outcome states including pending mid-submit; URL rules; undeclared action, non-input change, forged params; unsupported per retained action |
| Req 7 store | `surface-state.store.spec.ts`, per-host composition specs | reflected before return; routing / per-routing / byte bounds hold and evicted reads not-found with eviction push; pending records survive eviction; coding-tab (no `surfaceMode`) identical; MCP write → RPC read and RPC write → MCP read on VS Code, Electron and CLI containers; defensive missing-store results; selection validated against host copy |
| Req 8 tools | `surface-namespace.builder.spec.ts`, `surface-tools.spec.ts`, dispatcher spec, `dashboard-surface-bridge.spec.ts` | text + id + revision; delete text; isError with path and limit, nothing pushed; get_state bounded with truncation marker and per-surface completeness; other tab's id not-found per tool; anonymous matrix; delivery false / throw / reject / partial / disposed, no unhandled rejection; description completeness; v1 bridge cases |
| Req 9 RPC | `surface-rpc.handlers.spec.ts`, `rpc-allowlist.spec.ts`, `verify-and-report.spec.ts`, `resolve-handler-plan.spec.ts`, host `rpc-surface.spec.ts` | registry and prefix; strict schema; manifest resolves on three hosts; change never calls send; read complete and equal to get_state; unknown routing not-found and never creates state |
| Req 10 submit | `surface-submit-turn.service.spec.ts`, `surface-rpc.handlers.spec.ts`, stream-pump spec | one dispatch and acceptance point; invalid submit names paths, no turn; not live / busy rejected; record ended or competing message during `createUserMessage` refused before push; indeterminate on other throws, no redispatch; duplicate op one turn; scope rule; settlement under change / replace / delete-recreate / eviction |
| Req 11 delivery | adapter specs, `dashboard-namespace.builder.spec.ts` | Electron delivered 1 and payload received; CLI no-surface and no throw; VS Code existing specs green; type-level `DashboardSurfaceHost` checks |
| NFR security | `dashboard-trust-boundary.spec.ts` (v2 describe blocks appended, v1 blocks untouched), `surface-trust-boundary.spec.ts` in vscode-lm-tools | unknown action; `format` other than plain; markup as inert data through validation (shared) and push (vscode-lm-tools); `javascript:`/`data:`/`http:`; prototype-pollution path; cross-routing-id read (vscode-lm-tools: shared holds no state, so this one case cannot live in the shared spec — recorded deviation from the NFR's file name, same control); spoofing label in submit content |

## Team-leader handoff

- Recommended executors: backend-developer for all components (no frontend work exists in this task);
  senior-tester for the per-host composition specs and the trust-boundary additions after the store and RPC land.
- Complexity: HIGH. Breadth across 7 projects plus real concurrency (operation ledger, write-log conflicts, submit
  pending/indeterminate).
- Dependencies and ordering (component level):
  - Components 1-3 before 4-7; Component 8 after 2; Component 9 is independent of everything except the new message
    type for the widened broadcast type (the adapter half is fully independent).
  - Component 10 after 4, 5, 6, 8, 9. Components 11-13 after 10. Component 15 after 8 and 10. Component 17 is
    independent (can start immediately). Component 16 after 15 and 17.
  - Per-host composition specs and the handoff note last.
- Batching hint (file-disjoint, at most 6 production files and 2 libs where possible; specs travel with their
  production file):
  - (a1) shared: `surface-catalog.ts`, `surface.types.ts`, `surface.schemas.ts`, `dashboard-spec.schemas.ts` export,
    `surface-data-model.ts`, fixtures.
  - (a2) shared: `surface-bindings.ts`, `surface-patch.ts`, `surface-concurrency.ts`, `surface.validator.ts`.
  - (a3) shared: `surface-text-fallback.ts`, `surface-submit.format.ts`, `surface-selection.ts`,
    `dashboard-text-fallback.ts` export, both barrels, zod-free spec.
  - (a4) shared + vscode-core: `message-constants.ts`, `payload-map.ts`, `rpc-surface.types.ts`, `rpc.types.ts`,
    `rpc-handler.ts` prefix.
  - (b0) ptah-electron + cli-engine: adapters and `ipc-bridge.ts` with specs (can start immediately, parallel-safe).
  - (c0) shared + agent-sdk: `ai-provider.types.ts` admission option, `session-admission-refused.error.ts`,
    `errors/index.ts`, `session-stream-pump.service.ts`, `session-lifecycle-manager.ts`, `sdk-agent-adapter.ts`
    (Component 17; can start immediately; touches `ai-provider.types.ts`, which no other batch touches).
  - (b1) vscode-lm-tools: `di/tokens.ts`, `surface-state.store.ts`, `surface-operation-ledger.ts`, `register.ts`,
    `di/index.ts`.
  - (b2) vscode-lm-tools: `surface-state.service.ts`, `surface-agent-mutations.ts`, `surface-ui-mutations.ts`,
    `surface-state-reader.ts`, `surface-push.ts`, `surface/index.ts`.
  - (b3) vscode-lm-tools: `dashboard-namespace.builder.ts` (hardening + widening), `dashboard-surface-bridge.ts`,
    `surface-namespace.builder.ts`, `namespace-builders/index.ts`, `types.ts`, `system-namespace.builders.ts`.
  - (b4) vscode-lm-tools: `surface-tools.ts`, `surface-tool-handlers.ts`, `protocol-dispatcher.ts`,
    `ptah-api-builder.service.ts`, `src/index.ts`.
  - (c1) rpc-handlers: `surface-rpc.schema.ts`, `surface-rpc.handlers.ts` (read/change/select/operation/unsupported),
    `handlers/index.ts`, `manifest.ts`.
  - (c2) rpc-handlers: `surface-submit-turn.service.ts`, `chat/tokens.ts`, `chat/di.ts`, submit branch in
    `surface-rpc.handlers.ts`.
  - (d) tests only: per-host composition specs (VS Code, Electron, CLI), `surface-trust-boundary.spec.ts`, v2
    blocks in `dashboard-trust-boundary.spec.ts`; then the 494 handoff note.
- Parallel-safe work: (b0) and (c0) with everything; (a3) with (a4) once (a1) lands; (c1) with (b3)/(b4) once (b2)
  lands. (a4) and (c0) both touch `libs/shared` but different files.
- Files affected:
  - CREATE: `libs/shared/src/mcp-apps-contracts/surface-catalog.ts`, `surface.types.ts`, `surface.schemas.ts`,
    `surface-data-model.ts`, `surface-bindings.ts`, `surface-patch.ts`, `surface-concurrency.ts`,
    `surface.validator.ts`, `surface-text-fallback.ts`, `surface-submit.format.ts`, `surface-selection.ts`;
    `libs/shared/src/testing/fixtures/surface.ts`; `libs/shared/src/index.zod-free.spec.ts`;
    `libs/shared/src/lib/types/rpc/rpc-surface.types.ts`; `libs/backend/vscode-lm-tools/src/lib/di/tokens.ts`;
    `libs/backend/vscode-lm-tools/src/lib/surface/{surface-state.store,surface-operation-ledger,surface-state.service,
    surface-agent-mutations,surface-ui-mutations,surface-state-reader,surface-push,dashboard-surface-bridge,index}.ts`;
    `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.ts`;
    `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/{surface-tools,surface-tool-handlers}.ts`;
    `libs/backend/rpc-handlers/src/lib/handlers/{surface-rpc.handlers,surface-rpc.schema}.ts`;
    `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts`;
    `libs/backend/agent-sdk/src/lib/errors/session-admission-refused.error.ts`; spec files named above;
    `apps/ptah-electron/src/ipc/webview-manager-adapter.spec.ts`;
    `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.spec.ts`; per-host composition specs
    `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`, `apps/ptah-electron/src/di/surface-composition.spec.ts`,
    `libs/backend/cli-engine/src/lib/surface-composition.spec.ts`; `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md`.
  - MODIFY: `libs/shared/src/mcp-apps-contracts/{dashboard-spec.schemas,dashboard-text-fallback,index}.ts`,
    `dashboard-trust-boundary.spec.ts` (append only); `libs/shared/src/index.ts`;
    `libs/shared/src/lib/types/messages/{message-constants,payload-map}.ts`; `libs/shared/src/lib/types/rpc.types.ts`;
    `libs/backend/vscode-core/src/messaging/rpc-handler.ts`;
    `libs/backend/vscode-lm-tools/src/index.ts`, `src/lib/di/{register,index}.ts`, `register.spec.ts`,
    `src/lib/code-execution/{types,ptah-api-builder.service}.ts`,
    `src/lib/code-execution/namespace-builders/{dashboard-namespace.builder,index,system-namespace.builders}.ts`,
    `dashboard-namespace.builder.spec.ts` (append only), `src/lib/code-execution/mcp-core/protocol-dispatcher.ts`;
    `libs/backend/rpc-handlers/src/lib/handlers/index.ts`, `src/lib/host-profile/manifest.ts`,
    `src/lib/chat/{tokens,di}.ts`; `apps/ptah-electron/src/ipc/{webview-manager-adapter,ipc-bridge}.ts`;
    `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts`;
    `libs/shared/src/lib/types/ai-provider.types.ts`; `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`,
    `src/lib/helpers/session-lifecycle-manager.ts`, `src/lib/helpers/session-lifecycle/session-stream-pump.service.ts`,
    `src/lib/errors/index.ts`, and the stream-pump spec.
  - REWRITE: none.
- Verification points:
  - Open before coding: A4 (`SessionRecord` type export path), the stream-pump spec file (for Component 17),
    `mcp-core/index.barrel.spec.ts` (whether new mcp-core modules must be barrelled), `rpc-types.ts:87`
    (`RpcUserError` constructor) and `chat/session/index.ts`.
  - Contracts to honour: v1 specs untouched and green; `DASHBOARD_TEXT_FORMATS` unchanged; barrels at or under 150
    lines; no `libs/frontend/**` edit and no persistence (team-leader rejects such batches).
  - Commands (scoped):
    `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-core @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-electron ptah-extension-vscode`
    and per batch the subset it touched.

## TASK_2026_494 handoff note (Req 12) — content outline

Written at the end of implementation as `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md`, with the delivered file and
symbol names filled in from the merged code:

1. (a) D3 intake: subscribe to `MESSAGE_TYPES.SURFACE_UPDATED` only (not `dashboard:spec-proposed`, which is no
   longer posted); `SurfaceUpdatedPayload` fields; filter on `routingId` (same value D3 matched as `sessionId`);
   apply `snapshot` by replacing, `ops` with `applySurfaceOps` when the local revision equals `fromRevision`, else
   treat as a gap and call `surface:read`; `deleted` removes the view (reason `evicted` vs `agent-deleted`); v1 specs
   arrive as `content.contract === 'dashboard-spec/1'` under `v1:<specId>`; re-validate with the contract validator
   and a `TextEncoder` counter as D3 already planned.
2. (b) D4 channel: `surface:select` replaces `dashboard:select` (same target shape, plus `operationId` and the
   selection must target a component that declares `dashboard.select`); `DashboardSessionStore` is not built
   (`SurfaceStateService` replaces it); `ChatDashboardSelectionInjectorService` recommended not built — agent pulls
   with `ptah_surface_get_state`; 494 confirms. Component 8 of 494 shrinks to renderer-side calls.
3. (c) Renderer view model: the 13 kinds and their fields; data-model binding (path syntax, empty values, missing
   path = empty); draft vs submit validation (what the renderer may show as invalid before submit); change vs
   submit; operation id format and generation rule (new id per user attempt, reuse only for a transport retry);
   serialize mutations per surface and send the latest known revision; states to show: pending, applied, rejected
   (with `stale-revision` re-read flow), indeterminate ("may have been sent — do not resend"), unknown; busy reason
   copy; eviction and not-found states; the renderer's duty to prove markup characters create no elements (bind as
   text, `dashboard-catalog.ts:132-137`), with the markup fixture from `dashboard-trust-boundary.spec.ts`; budgets are
   provisional and 494 confirms them against the renderer in `SURFACE_LIMITS`.
4. (d) Component 7: the Electron `getActiveWebviews()` fix (and the CLI one) is delivered here; remove it from 494
   scope.
5. Unaffected sections: D1 (state survival), D2 (Electron-only guard), D5 (inline SVG charts, which still apply to
   the two chart kinds), D6 (library split; only the renderer's public API names change), D7 (lazy-load gate).
6. Follow-ups for 494/539: `surface:release` on tab close (not built, Q3); pinned/refresh/export/copy/open-url/
   drill-down host behaviours still `unsupported`.

## Lane review disposition

The draft was reviewed adversarially by one codex lane (agent `158791db-e1d7-45d6-97d7-3ab984fc718d`, one round,
static review only). Each finding was checked against source before it was applied. The lane's scratch file was
deleted after this disposition was recorded.

| # | Severity | Finding | Disposition | Where applied |
| --- | --- | --- | --- | --- |
| 1 | BLOCKER | Pre-dispatch busy/live check is not atomic: the pump awaits `createUserMessage` before pushing onto the captured record, so a torn-down record or a competing message can slip in and a resolved send would be recorded `applied` | Accepted. Verified at `session-stream-pump.service.ts:195-219`, `sdk-message-factory.ts:84`, `session-control.service.ts:235-240`. Fixed with an opt-in `admission: 'require-idle'` re-check after the await and before the push, with a typed refusal | Q1; Component 16 steps 4-6; new Component 17; test table Req 10 |
| 2 | MAJOR | Submit settlement undefined under delete, recreate, eviction or other commits during dispatch | Accepted. Tickets bound to the surface incarnation (its creation revision); ledger always settled; last-submit written only on the same incarnation; never restores frozen state; other mutations not blocked | Component 10 "Submit ticket ownership and settlement" |
| 3 | MAJOR | Path-level staleness for agent patches contradicts Req 5.4 | Accepted. Agent mutations require exact base; path-level check kept only for UI change | Q4 table and answer |
| 4 | BLOCKER | Dropping a routing ledger with young terminal records defeats fail-closed replay | Accepted. A ledger is dropped only when every record is past `forgetAt`; otherwise new reservations are refused | Component 10 ledger |
| 5 | MAJOR | Future-dated ids can outlive terminal-record retention; lookup order unspecified | Accepted. Lookup first; `forgetAt = max(settledAt, issuedAt) + retention`; monotonic clock guard | Component 10 ledger |
| 6 | MAJOR | Pending tickets (frozen values, formatted message) missing from byte accounting | Accepted. Ticket bytes reserved before dispatch and released at settlement; at most one pending submit per routing id | Component 10 accounting |
| 7 | MAJOR | Complete single-surface MCP read not provably inside the read bound | Accepted. Form values keyed by unique path; v2 ids capped at 128; `view: 'state' | 'structure'` split; `maxStateReadBytes` raised to 320 KiB with the budget sum pinned by a test | Components 1, 2, 12 |
| 8 | MAJOR | NFR "operation ids on every mutation" not met on the MCP side | Accepted in part. Revision 6 item 3 scopes op ids to app-started mutations; agent writes are retry-safe through exact base and create-exists rejection; host stamps `mcp:<toolCallId>` for correlation. Escalation path recorded if the NFR is read as agent-authored ids | Q4, Component 10 |
| 9 | MINOR | Q1 overstated interrupt loss; A3 citation pointed at the wrong lines | Accepted. Q1 names teardown and retired interrupts only; A3 cites `register.ts:595-598` and the three host call sites | Q1; Assumptions |

## R8 barrel decision

- Decision: option (a). Add a second, documented, zod-bearing subpath entry point for v2,
  `@ptah-extension/shared/mcp-apps-contracts/surface`, backed by the flat file
  `libs/shared/src/mcp-apps-contracts/surface.index.ts`. The v1 barrel `mcp-apps-contracts/index.ts` keeps v1 and gains
  only the Req 1.2 version constants. This supersedes the Component 7 instruction to put all v2 exports in
  `mcp-apps-contracts/index.ts`, and the "no second entry point" note on Task 6.5.
- Rationale:
  - (c) cannot fit. The downstream import set listed below is 46 value names in 8 module groups plus about 18 module
    types. Prettier puts one name per line once a statement passes 80 characters, so this is at least 90 more lines
    on top of 111. That is about 200 lines, over the 150 ceiling (CONVENTIONS.md section 3).
  - (b) either repeats every name (a v1+v2 split behind one `index.ts` still lists each name again) or needs
    `export *` over value modules. Section 3 allows `export *` "only for grouping files that are themselves a type
    bundle". Rejected.
  - (a) is the path section 3 names ("a documented deep-import path … declared in `tsconfig.base.json`"). Precedent:
    `libs/shared` already ships three subpath entries the same way: `./schemas` → `src/schemas.ts`, a flat
    non-`index` file, and `./mcp-apps-contracts` (`libs/shared/package.json:9-30`; `tsconfig.base.json:177-182`).
    Current importers reach the contract ONLY through the subpath, never through the main barrel: the vscode-lm-tools
    dashboard builder and tool plus their specs, and `libs/shared/src/index.ts`, which re-exports the zod-free types
    file directly. It stays one Nx project (`shared`, `scope:shared, type:util`), so `@nx/enforce-module-boundaries`
    (`eslint.config.mjs:225-226`, `enforceBuildableLibDependency`) sees the same project edge as today. No tag or
    depConstraint changes. The `strict: true` importer constraint is the same as the v1 entry's
    (`mcp-apps-contracts/index.ts:18-25`).
- Exact edits (config first, in one task, before any consumer imports the subpath):
  1. `libs/shared/package.json` `exports`: add `"./mcp-apps-contracts/surface": { "types":
     "./src/mcp-apps-contracts/surface.index.ts", "default": "./src/mcp-apps-contracts/surface.index.ts" }` after the
     `./mcp-apps-contracts` entry.
  2. `tsconfig.base.json` `paths` (after `:180-182`): `"@ptah-extension/shared/mcp-apps-contracts/surface":
     ["./libs/shared/src/mcp-apps-contracts/surface.index.ts"]`.
  3. The three app build tsconfigs that mirror the shared subpaths add the same key with a `../../libs/...` target:
     `apps/ptah-cli/tsconfig.build.json` (beside `:35-37`), `apps/ptah-electron/tsconfig.build.json` (beside `:38-40`)
     and `apps/ptah-tui/tsconfig.build.json` (beside `:35-37`). A repository grep of non-TS files for
     `shared/mcp-apps-contracts|shared/schemas` finds only these four files.
  4. Jest: no change. The Nx preset sets `resolver: '@nx/jest/plugins/resolver'` (resolved from
     `@nx/jest/dist/preset.js`), and that resolver reads `tsconfig.base.json` paths. That is why the existing subpath
     works in `dashboard-namespace.builder.spec.ts` with no `moduleNameMapper` entry
     (`vscode-lm-tools/jest.config.ts:21-27`).
  5. ESLint: no change (same project; the path is declared).
  6. CREATE `libs/shared/src/mcp-apps-contracts/surface.index.ts`. It has a header comment in the style of
     `index.ts:1-26` (zod-bearing, strict importer, and a note to import plain types from `@ptah-extension/shared`),
     then `export type * from './surface.types';` (a type bundle, which section 3 allows), then the named exports
     below, grouped per module. Target at or under 150 lines, reported with `wc -l`.
  7. MODIFY `mcp-apps-contracts/index.ts`. Add one named export group from `./surface-catalog`:
     `SURFACE_SCHEMA_VERSION`, `SURFACE_CATALOG_VERSION`, `SURFACE_SUPPORTED_SCHEMA_VERSIONS`,
     `SURFACE_SUPPORTED_CATALOG_VERSIONS` and `DASHBOARD_CONTRACT_VERSION_PAIRS`. Req 1.2 requires the v2 version
     strings "exported from the same entry point" as the v1 lists. Add a one-line comment naming the v2 entry
     point. The result is about 120 lines. The v2 entry also exports these five names, so a v2 consumer needs one
     import. Two export sites for one binding is harmless and deliberate.
  8. `libs/shared/src/index.ts` and `index.zod-free.spec.ts`: unchanged from Task 6.5, and the main barrel stays
     zod-free.
- v2 entry export list (the symbols the later batches import, by plan component):
  - `./surface-catalog`: the five version names above, plus `SURFACE_LAYOUT_KINDS`, `SURFACE_INPUT_KINDS`,
    `SURFACE_DISPLAY_KINDS`, `SURFACE_COMPONENT_KINDS`, `SURFACE_ACTIONS`, `SURFACE_HOST_SUPPORTED_ACTIONS`,
    `SURFACE_INPUT_EMPTY_VALUES`, `SURFACE_V1_ID_PREFIX`, `SURFACE_OPERATION_ID_PATTERN`, `SURFACE_LIMITS` and
    `SURFACE_STORE_LIMITS`. Users: tool descriptions (C13), store, ledger and bridge (C10, C11), RPC handlers (C15)
    and the 494 renderer. The catalog types (`SurfaceActionId`, `SurfaceComponentKind` and so on) as `export type`.
  - `./surface.schemas`: `SurfaceAnyIdSchema`, `SurfaceOperationIdSchema`, `SurfacePathSchema`,
    `SurfaceDataValueSchema`, `SurfaceSelectionSchema`, `SurfaceUpdateInputSchema` and `SurfaceGetStateInputSchema`
    (C13 generated tool schemas, C15 RPC schema).
  - `./surface-data-model`: `readSurfacePath` (C10 form values).
  - `./surface-bindings`: `collectSurfaceInputs`, `isSurfaceInputComponent`, `findSurfaceAction`, `checkDraftValue`,
    `checkSubmitValues` and `collectSubmitScope` (C10 UI mutations and submit, C15). Types: `SurfaceSubmitValue`,
    `SurfaceSubmitIssue`, `SurfaceSubmitScope`.
  - `./surface-patch`: `applySurfaceOps`, `revalidateSelection`, `checkSurfaceSelection` and `isSurfaceStructureOp`
    (C10). Types: `SurfacePatchState`, `SurfacePatchResult`.
  - `./surface-concurrency`: `createSurfaceWriteLog`, `appendWrite`, `checkSurfaceConflict` and
    `surfaceOpsFootprint` (C10). Types: `SurfaceWriteLog`, `SurfaceWriteFootprint`, `SurfaceConflictMutation`,
    `SurfaceConflictResult`.
  - `./surface.validator`: `validateSurfaceUpdateInput`, `validateSurfaceDocument`,
    `validateSurfaceEnvelopeVersions` and `formatSurfaceIssues` (C10, C12). Types: `SurfaceValidationRejected`,
    `SurfaceUpdateInputAccepted`, `SurfaceDocumentAccepted`.
  - Batch 6 modules: `renderSurfaceText` and `describeSurfaceLimits` (`./surface-text-fallback`),
    `formatSurfaceSubmitMessage` (`./surface-submit.format`) and `describeSurfaceSelection` (`./surface-selection`)
    (C10, C12, C13).
  - Not exported: internal helpers (`parseSurfacePath`, `pathsOverlap`, `applyDataModelOps`, `visitSurfaceComponents`,
    `surfaceActionsOf`, `isSurfaceLayoutComponent`, `SURFACE_MAX_RAW_JSON_DEPTH`, the path patterns, and the per-kind
    component schemas). A later batch that needs one adds it to `surface.index.ts` with the component that needs it
    named in the commit. It never deep-imports the module file.
- Effect on batches: Task 6.5 creates `surface.index.ts` and the config edits 1-3 instead of growing `index.ts`
  past 150. Batch 6 grows by five small config/barrel files; if that breaks the batch's file budget, the team-leader
  moves edits 1-3 and 6 into a Task 6.6. Batches 8-13 import v2 values from `@ptah-extension/shared/mcp-apps-contracts/surface`
  and v1 values from `@ptah-extension/shared/mcp-apps-contracts`. The Batch 16 handoff note names both entry points
  for the 494 renderer.

## Batch 9 read-budget decision

Resolves finding 2 (MAJOR) of `code-logic-review-batch-9.md:84-143`. Supersedes the "State-read budget invariant"
bullet of Component 1 (`implementation-plan.md:267-273`), whose 8 KiB selection allowance and unescaped model terms
are both false.

### Evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| Reader escapes after serializing state and structure (3 -> 6 bytes per separator) | `surface-state-reader.ts:362`, `:367`, `:381-383` | Every string term can double |
| Form values repeat the model value per unique path | `surface-state-reader.ts:94`, `:350-351` | Model counted twice |
| Admission measures unescaped JSON bytes: model <= 64 KiB, doc <= 256 KiB | `surface.validator.ts:587-600`, `surface-catalog.ts:103-104` | Escaped model <= 128 KiB, escaped structure <= 512 KiB |
| Selection description quotes up to 50 cells + 50 column labels, each capped at 200 UTF-16 units, JSON-quoted and separator-escaped | `surface-selection.ts:13-23`, `:63-72` | Re-embedding it as a JSON string costs up to 7 bytes per unit (`\\u2028`): about 140 KiB, not 8 KiB |
| Submit message is <= 32 KiB of already-escaped text; its values are the record's values with `label` in place of `componentId` | `surface-submit.format.ts:19-23`, `:41-62` | Escaped `lastSubmit` <= 32 KiB + 100 x 134 B + metadata |
| Ids and paths are ASCII (`SURFACE_ID_PATTERN`, v1 `slug`, path pattern) | `surface-catalog.ts:74`, `surface.schemas.ts:60-64`, `:92` | Ids, paths and issue texts never expand |
| Escaping is the Batch 6 invariant "no raw U+2028/U+2029 in agent-visible text" (prompt line-spoofing class) | `code-logic-review-batch-6.md:137-170`; `surface-text-fallback.ts:61`, `surface-selection.ts:21` | Removing it from one reader breaks a four-module rule |
| MCP transport does not need it: results are JSON-RPC (RFC 8259 allows raw separators in strings); request cap only | `mcp-http/http-server.handler.ts:239` | Escaping is a content-safety choice, not a transport fix |

The "Codex SDK crashes on raw U+2028" rationale has no evidence in this repository (Assumption; not relied on).
Nothing needs it to be true: escaping stays for the Batch 6 reason above.

### Decision: option (a) - raise `maxStateReadBytes` to the proven escaped worst case of both views

- Keep `escapeLineSeparators` and the duplicated `value` in form values. No admission, validator, schema or type
  change.
- New constant: `SURFACE_LIMITS.maxStateReadBytes = 548 * 1024` (561,152 bytes). One bound still covers both views,
  the all-surfaces packing and the error texts.
- Shared-contract change (required, one line): `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:109`, with a
  comment naming this appendix. Batch 13 tool descriptions read the constant, so no further edit is needed (Req 8.6b).

Rejected:
- (b) Escaped bytes at admission: the byte counter is injected by every caller, including the webview
  (`dashboard-spec.validator.ts:14-24`), and Batch 10 is not yet written. This spreads a reader concern into the
  validator's "UTF-8 bytes" contract. It also leaves the ~140 KiB selection term, so the state read (about 420 KiB)
  still breaks 320 KiB.
- (c) Drop escaping: breaks the Batch 6 invariant, and still fails. The selection description is escaped by shared
  code, so the unescaped state is 64 + 64 + 100 + 140 + 48 + 4 = 420 KiB, over 320 KiB.
- (d) Deduplicate form values: needs `SurfaceFormValues.value` optional (`surface.types.ts:219-229`) and changes how
  Req 3.7 values are shown. The state falls to 420 KiB, but the structure view (516 KiB) sets the single bound, so the
  saving is 32 KiB. Paging needs a `SurfaceGetStateInput` schema change (Batch 13 surface) and is out of scope.

### Worst-case proof (bytes of the complete text, escaped)

State view (`view: 'state'`, v2; a v1 state is a subset):
- T1 header, keys, surfaceId (<= 2,003 ASCII for v1), revision, contract: <= 4,096.
- T2 data model: raw <= 65,536; each escape adds 3 bytes to 3 raw bytes, so escaped <= 2 x raw = 131,072.
- T3a form values, `value`: unique paths have no numeric segments, so bound values are disjoint substrings of the
  model JSON. Escaped <= 131,072 (Assumption; test 4 asserts it).
- T3b form values, keys, ids, issues and wrapper: <= 100 inputs x 1,024 = 102,400. The worst per input is about 875:
  path key 522, wrapper 44, id 131, issue about 178; all ASCII.
- T4 selection: 50 rows x (1,404 + 2 + 1,404 + 2) = 140,600, plus Component/Kind/Title/Row lines and the wrapper
  (under 2,500). Each quoted field is `"` + 200 x `\\u2028` + `"`, re-escaped as 1,404 bytes. Total <= 143,360
  (140 KiB).
- T5 lastSubmit: message <= 32,768; `componentId` instead of `label` adds <= 134 per value x 100 = 13,400; metadata
  <= 1,024. Total 47,192 <= 49,152 (48 KiB).
- Sum: 4,096 + 131,072 + 131,072 + 102,400 + 143,360 + 49,152 = **561,152 = 548 KiB**.

Structure view: the structure is the document minus the model, so raw <= 262,144. Escaped <= 524,288. The header
and wrapper add <= 4,096, for a total of **528,384 <= 561,152**.
Reviewer cases: 333,329 and 482,504 bytes, both <= 561,152.

### Developer instructions (Batch 9 fix)

Files:
- MODIFY `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:109`: set `maxStateReadBytes: 548 * 1024`, with a
  comment naming T1-T5 and the structure bound.
- MODIFY `libs/shared/src/mcp-apps-contracts/surface-budgets.spec.ts:554-567`: replace the sum with T1-T5 as named
  terms, and assert both `sum <= L.maxStateReadBytes` and `2 * L.maxSurfaceBytes + 4096 <= L.maxStateReadBytes`.
- MODIFY `libs/shared/src/mcp-apps-contracts/surface-contract.spec.ts:69-78`: delete this duplicate, stale proof.
  The budgets spec is the single home.
- MODIFY `libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.ts`: doc comments only. Update `:4-13`
  to "within maxStateReadBytes by the escaped worst case, implementation-plan.md 'Batch 9 read-budget decision'" and
  `:119-126` to "548 KiB". Do not change logic or escaping.
- MODIFY `libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.spec.ts`: add the cases below.

Specs in `surface-state-reader.spec.ts`:
- Build separators with `String.fromCharCode(0x2028)`, so no raw separator appears in source (Batch 9 rule).
- Validate every fixture with `validateSurfaceDocument({ ...surface, dataModel }, jsonUtf8Bytes)` and expect
  `ok: true`.
- Every found result must meet three checks: `Buffer.byteLength(text) <= SURFACE_LIMITS.maxStateReadBytes`; no raw
  U+2028/U+2029; and `JSON.parse` of the text after the header line deep-equals the stored model or structure
  (lossless).
1. Reviewer reproduction A (`code-logic-review-batch-9.md:94-140`), verbatim, including the `lastSubmit` that
   `formatSurfaceSubmitMessage` accepts. Expect `status: 'found'` for `view: 'state'`. It was `too-large` at 320 KiB.
2. Reviewer reproduction B (`:143`): 40 `stat` components, `id` `s<i>`, `value` 1, and `title.text` of 2,000
   separators. Expect `view: 'structure'` to be found, with a total above 327,680 (proves the old limit failed).
3. Maximal structure: add separator-titled stats until `validateSurfaceDocument` would exceed `maxSurfaceBytes`.
   Keep the last accepted document. Expect the structure view to be found.
4. Maximal state: a model of about 64 KiB of separator strings bound by all 100 text inputs (128-character ids,
   5-segment paths). Add a table of 50 columns whose labels and first-row cells are 200 separators each, with the
   selection on row 0. Add a `lastSubmit` whose `formatSurfaceSubmitMessage` result is ok and within 1 KiB of
   32,768 bytes. Expect found. Also assert that the form-value `value` bytes are <= the escaped model bytes (T3a),
   and that the JSON-embedded selection is <= 143,360 (T4).
5. Keep `surface-state-reader.spec.ts:517` (escaping) and `:506` (never partial) unchanged. `too-large` stays
   reachable only below the default bound.

Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/vscode-lm-tools`
(confirm the second project name with `npx nx show projects`), with no raw separators in the
changed files.
