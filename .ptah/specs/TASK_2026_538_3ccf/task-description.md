# Requirements - TASK_2026_538

## Context

TASK_2026_493 (PR #565) shipped the declarative dashboard contract in `libs/shared/src/mcp-apps-contracts/`. It is
read-only and snapshot-only. It has one envelope version `dashboard-spec/1` and one catalog version
`dashboard-catalog/1` (`dashboard-catalog.ts:30-47`). It has five display kinds: stat, line chart, bar chart, table and
list (`dashboard-catalog.ts:56-62`). It has seven `dashboard.*` action ids (`dashboard-catalog.ts:75-90`) and one set
of provisional budgets (`DASHBOARD_LIMITS`, `dashboard-catalog.ts:163-171`). A spec "is always whole: there is no
partial or incremental form" (`dashboard-spec.types.ts:193-196`). There is no data model, no input component and no
way for the UI to send a value back. The agent emits a spec through one MCP tool, `ptah_dashboard_propose_spec`
(`mcp-core/dashboard-propose-spec.tool.ts:32`, dispatched at `protocol-dispatcher.ts:1619`). That tool validates the
spec, returns a plain-text rendering and pushes `dashboard:spec-proposed` to every attached webview through
`createDashboardBroadcast` (`dashboard-namespace.builder.ts:112-148`). The push payload's `sessionId` is the routing id
(`tabId`), not the SDK session id (`payload-map.ts:234-245`; `sdk-query-options-builder.ts:835`). The host remembers
nothing after the push.

Two runtime defects block that push today. `createDashboardBroadcast` calls `host.getActiveWebviews()`
(`dashboard-namespace.builder.ts:125`). Only the VS Code `WebviewManager` has that method
(`vscode-core/src/api-wrappers/webview-manager.ts:280`). `ElectronWebviewManagerAdapter`
(`apps/ptah-electron/src/ipc/webview-manager-adapter.ts:30-79`) does not have it, and neither does
`CliWebviewManagerAdapter` (`libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:20-78`). So the
push throws on the Electron host, which is the one that has the Apps page, and on the CLI host, which has no page.

The user wants the agent to "truly be able to build forms, sections with lists and select, and a way to send back and
forth communication between the UI state and the agent state, to elevate both the Apps dashboard and also the coding
agent". The decision on 2026-09-23 was to build contract v2 first and then revise TASK_2026_494 on top of it.
TASK_2026_494's plan would otherwise lock three v1 assumptions into code that v2 would then rewrite: the
snapshot-only intake (D3), the selection-only `dashboard:select` channel with a 16-entry `DashboardSessionStore` (D4,
Component 8), and the five-kind view model. The Claude Agent SDK has no LangGraph-style shared state object and no
resume command. Two-way state must therefore be owned by the host. The agent reaches it through MCP tools and the UI
reaches it through RPC (`TASK_2026_494_ca38/research-property-hub-agent-ui.md` section 6). This task delivers the
contract, the host state, the tools and the RPC channel. It does not render anything.

## Classification

- Type: FEATURE. It adds new capability to the shared contract, the backend host and the MCP tool surface.
- Estimate: L (as on the carrier). The size comes from breadth, not from a single hard algorithm. The work spans one
  shared contract that grows from five kinds to about thirteen, with per-kind schemas and budgets. It also adds a data
  model with path binding, incremental patches, a bounded host store, two MCP tools and a new RPC namespace with
  registration on three hosts. Submit has to start a turn through the existing chat path. There are adapter fixes on
  two hosts. Operation-id tracking with pending and indeterminate outcomes, and the conflict policy, add real depth.
  It is the top of L: if the architect keeps selection injection (see Open questions) in this task, it becomes XL.
  The team-leader should then split it into (a) the contract and the pure patch functions in `libs/shared`, (b) the
  store, the tools and the adapter fixes, and (c) the RPC and the submit-to-turn path.
- Priority: not defined here. There is no repository priority scale. TASK_2026_494 and TASK_2026_539 are blocked on
  it (`context.md`, "Depends on / unblocks").

## Scope

In scope:

- Contract v2 in `libs/shared/src/mcp-apps-contracts/`, versioned alongside v1. It has layout primitives (section,
  stack, grid, card), input primitives (text, select, radio group, checkbox) and the five v1 display kinds, each with its
  own Zod schema and budgets.
- A data model with bound paths. Inputs read and write named values, with `updateDataModel`-style semantics (set and
  remove values at paths).
- Stable surface ids, full snapshots and incremental patches (surface structure and data model), with a revision for
  each surface.
- Actions: `submit` starts an agent turn and `change` updates host state without a turn. The v1 `dashboard.*` actions
  are kept. Every action is on an allowlist, is bound to routing id + surface id + revision, carries an operation id
  when it mutates, and is mediated by the host.
- A host-owned, bounded surface state store keyed by routing id (`tabId`). It holds the surface, data model, form
  values and selection, and generalizes 494's `DashboardSessionStore`.
- MCP tools `ptah_surface_update` (agent to UI) and `ptah_surface_get_state` (the agent reads UI state), plus a
  decision on `ptah_dashboard_propose_spec` (Requirement 8).
- A host push message for surface changes, typed in `libs/shared` messages.
- A `surface:*` RPC namespace (UI to host): typed in `rpc.types.ts` (`RpcMethodRegistry` and `RPC_METHOD_ENTRIES`),
  with `'surface:'` added to `ALLOWED_METHOD_PREFIXES` (`vscode-core/src/messaging/rpc-handler.ts:44`) and a handler in
  the host-profile manifest (`rpc-handlers/src/lib/host-profile/manifest.ts`).
- Delivery fixes: `getActiveWebviews()` on the Electron adapter (required) and on the CLI adapter (required, because
  this task names CLI as a supported runtime).
- A handoff note in the task folder for the TASK_2026_494 architect (Requirement 12).

Out of scope:

- All webview rendering, including the renderer lib, the Apps page, form widgets, focus handling and pending/unknown
  UI states. These belong to TASK_2026_494, which renders v2.
- Mounting surfaces in the coding chat transcript. That is TASK_2026_539 (it follows 494). This task only makes sure
  the host side works for any `tabId`, including coding chat tabs.
- Persisting surface state across a host restart, and replaying it from session history. The store is in memory,
  as 494 D1 and D4 already assume. Persistence is a follow-up, if a user need appears.
- Markdown in any v2 text field. `DASHBOARD_TEXT_FORMATS` stays `['plain']` (`dashboard-catalog.ts:103-138` records
  the proven `data:` URL bypass and the two conditions for restoring markdown, and neither condition is met).
- Agent-supplied regular expressions as validation hints. A host-evaluated agent regex is a ReDoS vector, and the
  fixed hints (required, length bounds, option membership) cover the requested forms.
- Free-form component kinds, HTML, templates, scripts, file or image inputs, date pickers, multi-step wizards and
  approval or permission screens. The approval and permission screens are "never agent-driven"
  (`TASK_2026_490_583c/research-report.md` section 3 table). Each other item would be a new catalog version.
- Adopting CopilotKit, AG-UI or the A2UI SDK. Angular 22.1.7 removes only the old version objection. The
  transport/runtime-fit and security reasons still apply (research-property-hub section 6).
- Removing or renaming `ptah_dashboard_propose_spec`. A deprecation, if wanted, is a later task.
- Editing TASK_2026_494's plan files. This task writes a handoff note, and 494's own architect revises the plan.

## Requirements

### 1. Contract v2 versioning

Requirement: the shared contract accepts a new surface envelope/catalog version beside v1, so that existing v1 specs
and their tests keep working unchanged while v2 adds layout, input and state.

Acceptance criteria:

1. When a v1 envelope (`dashboard-spec/1`, `dashboard-catalog/1`) that passes on `main` today is validated after this
   task, the system shall accept it with an identical parsed result. The existing
   `dashboard-spec.contract.spec.ts`, `dashboard-budgets.spec.ts` and `dashboard-trust-boundary.spec.ts` shall pass
   without edits to their assertions.
2. When a v2 envelope names the new schema and catalog versions, the system shall validate it against the v2 schemas.
   Both new version strings shall appear in `DASHBOARD_SUPPORTED_SCHEMA_VERSIONS` /
   `DASHBOARD_SUPPORTED_CATALOG_VERSIONS`, or in v2 equivalents exported from the same entry point.
3. When an envelope names an unknown schema or catalog version, or pairs a v1 envelope with the v2 catalog (or the
   other way round) in a combination the contract does not define, the system shall reject the whole envelope with a
   reason that names the version field.
4. When a v1-catalog envelope contains a v2-only kind (for example a `select`), the system shall reject it.
5. When `libs/shared/src/index.ts` (the main barrel) is imported, it shall not pull `zod` into the import graph. The v2
   plain types shall live in a zod-free module, following the `dashboard-spec.types.ts` / `.schemas.ts` split.

### 2. Layout primitives

Requirement: an agent can group content into section, stack, grid and card, so that a form or a dashboard has a
readable structure.

Acceptance criteria:

1. When a v2 surface uses `section`, `stack`, `grid` or `card` with children, the system shall accept it. Each kind
   shall have its own Zod schema in the discriminated union, with unknown keys rejected (`.strict()` or equivalent).
2. When a layout node exceeds its budget (children per node, grid column count, total components, tree depth), the
   system shall reject the whole surface with the offending path. Each budget shall be a named constant in the catalog
   module. A test shall assert acceptance at the limit and rejection at limit + 1.
3. When a layout node carries a presentational field (for example grid columns or stack direction), only values from
   a fixed enum or a bounded integer range shall be accepted. No free-form CSS, class name or style string shall be
   accepted.

### 3. Input primitives

Requirement: an agent can place text, select, radio group and checkbox inputs, each with a label, bounded options and
validation hints, so that the user can fill in a form the agent built.

Acceptance criteria:

1. When a v2 surface contains `text`, `select`, `radio-group` (name at the architect's choice) or `checkbox`, the
   system shall validate each against its own schema. The schema requires a plain-text label and exactly one bound
   data-model path.
2. When a `select` or radio group declares options, the system shall accept only a bounded, non-empty list of options
   with unique values and plain-text labels. A test shall assert acceptance at the option budget and rejection at
   budget + 1, and rejection of duplicate option values.
3. When an input declares validation hints, only the fixed set the contract defines shall be accepted: at least
   required, and minimum/maximum length for text. Any key such as `pattern` or `regex` shall be rejected.
   Contradictory hints (for example a minimum length greater than the maximum) shall be rejected. The contract shall
   say what `required` means for a checkbox (present, or checked).
4. When an input's bound path already holds a value of the wrong type in the data model (for example a number at a
   checkbox's path, or a value that is not one of a select's options), the system shall reject the surface or patch.
5. When any text value, label or option string is longer than `DASHBOARD_LIMITS.maxStringLength` (or a stricter v2
   budget), the system shall reject it.
6. When a form is created or changed, the system shall treat draft values and submit-valid values differently. Each
   input kind shall have one documented empty value. An empty required field, or text shorter than its minimum, shall
   be storable as a draft. A wrong type, or a non-empty value outside the declared options, shall be rejected at
   every write. Required and length hints shall be enforced at submit (Requirement 10.2).
7. When two or more inputs bind to the same path, or to overlapping ancestor and descendant paths, the system shall
   apply one documented compatibility rule and reject incompatible bindings atomically. Inputs that validly share a
   path shall read one canonical value.

### 4. Data model and bound paths

Requirement: each surface has a data model of named values that inputs are bound to, so that the agent and the UI
read and write the same state by path.

Acceptance criteria:

1. When a surface or a patch names a path, the system shall accept only the path syntax the contract defines, with a
   bounded segment count and length. It shall reject the segments `__proto__`, `prototype` and `constructor`. A test
   shall show that a patch using any of these leaves `Object.prototype` untouched and is rejected.
2. When a data-model value is written, the system shall accept only JSON scalars and bounded arrays or objects of
   them. It shall reject functions, `undefined`, non-finite numbers and nesting deeper than the data-model depth budget.
3. When a surface's structure plus its data model, serialized as UTF-8 JSON, exceeds the byte budget, the system shall
   reject the write that would cause it, and the rejection names the budget. In addition, every MCP and RPC request
   shall be checked before any operation is applied, against named request-byte, operation-count, collection-width
   and nesting limits (`jsonUtf8Bytes`, as v1 measures the request as received, `dashboard-catalog.ts:159-162`).
   Tests shall cover a large patch whose operations cancel out to a small result, and an oversized RPC write.
4. When an input component is bound to a path that the data model does not contain, the system shall behave as the
   contract documents (either reject, or treat it as the type's empty value), and a test shall pin that behaviour.
5. When a data-model patch sets or removes a value, the result shall be equal to applying the same operations in order
   to the previous model, as a pure function in `libs/shared`, with unit tests for set, replace, remove and
   remove-missing.

### 5. Surface identity, snapshots and incremental patches

Requirement: a surface has a stable id within its routing id, and the agent can replace it whole or patch its
structure or data model, so that small updates do not resend and reset the whole surface.

Acceptance criteria:

1. When the agent creates a surface with id S for routing id T, and later sends a patch for (T, S), the system shall
   apply the patch to that surface and increase its revision by one. The same S under a different routing id shall be a
   different surface.
2. When a patch is applied, the system shall validate the whole resulting surface against every v2 schema and budget
   before it commits. If the result is invalid, the patch shall be rejected as a whole, the stored surface and its
   revision shall be unchanged, and nothing shall be pushed.
3. When a patch names a component id or a surface id that does not exist, the system shall reject it with a reason
   that names the missing id.
4. When the agent sends a patch with an expected base revision that is not the stored revision, the system shall
   reject it with a stale-revision reason that includes the current revision. Nothing is applied.
5. When the agent deletes a surface, the system shall remove it from the store and push the deletion. A later
   `ptah_surface_get_state` for it shall report that it does not exist.
6. When the host pushes a surface change to the UI, the message shall carry routing id, surface id and the new
   revision. A receiver that sees a gap in revisions can then detect it and re-read the state (Requirement 9,
   criterion 5).
7. When an existing surface is mutated through either channel (agent replace, patch or delete; UI change,
   selection or submit), the host shall check the base revision and commit atomically, producing exactly one next
   revision. Conflicting writes shall follow one documented conflict policy that never silently overwrites an
   accepted write. A create for an id that already exists shall be rejected (replace is a separate, explicit
   operation). Tests shall race a UI change against an agent patch, a replace and a delete.
8. When a surface is deleted or evicted and later created again with the same id, a request that names the old
   incarnation (its revision or operation id) shall not be accepted against the new one. Revisions must not restart,
   or surfaces must carry an incarnation marker; the architect chooses.
9. When a committed update removes, reorders or changes the component or row/point that the current selection
   points at, the host shall revalidate the selection against the new copy and clear it (or remap it under a
   documented rule) before any read or submit exposes it. An old index shall never select different data.

### 6. Actions, allowlist and host mediation

Requirement: every action a surface can trigger is an allowlisted id that the host maps and authorizes, bound to the
surface it came from. An agent-authored surface can then never name a tool, an RPC method or a command.

Acceptance criteria:

1. When a surface declares an action, the system shall accept only ids from the v2 action allowlist. That is the v1
   `dashboard.*` ids plus the v2 submit id (and a change id, if the architect models change as an action). Any other
   string, including a tool name or an RPC method name, shall be rejected.
2. When the UI invokes an action or reports a change, the call shall carry routing id, surface id, the revision the UI
   rendered and, for every mutation, an operation id. A call that is missing any of these shall be rejected as
   invalid parameters.
3. When a call names a revision that the staleness rule marks stale, on a surface that exists, the system shall
   reject it with stale-revision and the current revision, and apply nothing. When the surface does not exist, or
   is outside the caller's routing scope, the system shall return the same not-found result, with no revision, and
   apply nothing.
4. When a mutation arrives with an operation id, the host shall reserve that id, scoped to the routing id, before
   any side effect. An identical retry, whether concurrent or later, shall observe the same operation and its
   outcome and shall not apply it again. Reusing an operation id with different request content shall be rejected.
   Operation records shall have their own documented retention bound, separate from surface LRU. A record that is
   still in flight shall not be evicted. A retry after its record expired shall fail closed (rejected, not
   re-applied). This satisfies the TASK_2026_490 Revision 6 item 3 timeout rule within that retention window. No
   outcome is promised across a host restart.
5. When the UI asks for the outcome of an operation id, the host shall return one of the following:
   - pending: received, not yet terminal;
   - applied or rejected (with the reason): terminal, and consistent with the side effects that actually happened;
   - indeterminate: the side effect cannot be determined, which does not mean failure;
   - unknown: no record, meaning never received or retention expired.
   Unknown shall not authorize rollback or replay. A test shall query the outcome while the original submit is still
   unresolved.
6. When `dashboard.open-url` or any v2 field carries a URL, the system shall apply `isAllowedDashboardUrl`
   (`dashboard-catalog.ts:195`) unchanged.
7. When an action or an input change arrives from the UI, the host shall resolve the component and the declared
   action or input from its stored copy at the accepted revision. It shall reject actions the component did not
   declare, changes to components that are not inputs, and writes outside the input's bound path. It shall take
   action parameters and URLs from the stored declaration, never from the renderer, and it shall authorize the
   resulting operation before any side effect.
8. When a retained `dashboard.*` action has no host behaviour in this task, invoking it on a v2 surface shall return
   an explicit "unsupported" result with no side effect. A test shall assert this for each action.

### 7. Host-owned surface state store

Requirement: the host keeps the single authoritative copy of each surface, its data model, form values and
selection, keyed by routing id and bounded. Both directions then read and write one state, and memory cannot grow
without limit.

Acceptance criteria:

1. When a surface is created, patched, changed by the UI, selected or submitted, the store shall reflect the result
   and its revision before the tool or RPC call returns success.
2. When the number of routing ids, the number of surfaces per routing id, or the bytes held exceed the store's
   documented bounds, the system shall evict the least recently used entries. A test shall show the bound holds and
   the evicted entries read as not existing. The byte accounting shall include every retained copy: data model, form
   values, selection, last-submit snapshot and operation records. The worst-case memory shall be written in the
   store's doc comment.
6. When eviction removes a surface that may still be mounted, the host shall notify the attached surfaces that it
   was removed, and later reads and mutations shall return not-found. Eviction shall not remove in-flight operation
   records (Requirement 6.4).
7. When a UI change or selection is committed, the host shall return the committed revision and push the
   authoritative update to the surfaces attached for that routing id, without starting a turn. A second mounted view
   then converges without waiting for the agent.
3. When a coding-chat tab (a session started without `surfaceMode`) calls `ptah_surface_update`, the store shall
   hold that tab's surface exactly as it holds an Apps session's surface. The store has no `surfaceMode` precondition.
4. When VS Code, Electron or CLI starts in a supported configuration, the MCP tools and the `surface:*` RPC handlers
   shall share one registered store. A composition test on each host shall write through MCP and read through RPC,
   and the other way round. On the CLI, state is kept even though delivery reports `no-surface`. Only as a defensive
   failure case (the store is missing through misconfiguration): the MCP tools return a plain-text "surface state
   unavailable on this host" result with `isError: true`, the RPC methods return an error, and neither throws. A
   supported host shall never ship in that state.
5. When the UI records a selection, the store shall validate it against the host's own copy (component exists, kind
   matches, indexes in range, same surface and revision) before storing it, as 494 D4 specified for `dashboard:select`.

### 8. MCP tools for the agent

Requirement: the agent can push surface changes and read the current UI state on demand through MCP tools, with a
plain-text answer on every host.

Acceptance criteria:

1. When the agent calls `ptah_surface_update` with a valid create, replace or patch, the tool shall validate, commit
   to the store, push to attached surfaces and return a plain-text rendering of the resulting surface plus its
   surface id and revision. This is the mandatory text fallback of Revision 6 item 8. A successful delete shall
   return text that names the deleted surface and the deletion revision.
2. When `ptah_surface_update` input is invalid, the tool shall return `isError: true` with a reason that names the
   offending path and the relevant limit. It shall push nothing and change nothing in the store.
3. When the agent calls `ptah_surface_get_state`, the tool shall return that routing id's surfaces, or a named
   surface: revision, data-model values, form values, current selection resolved from the host copy, and the last
   submit if any. The output shall be bounded in bytes, with truncation marked. When the output is truncated, the
   agent shall be able to get complete state per surface (for example by listing surface ids and then reading one
   surface at a time) within the same bound.
4. When a tool is called, the routing scope shall come from trusted request context (`getCallerSessionId()`,
   `protocol-dispatcher.ts:1628`), never from a tool argument. A call that names a surface outside the caller's
   scope shall get the same not-found result as a surface that does not exist. Tests shall try another tab's
   surface id for each tool.
5. When a tool is called by an anonymous MCP caller (no `/session/{id}`, so no routing id):
   - `ptah_surface_update` with a valid self-contained snapshot shall validate it and return its text rendering,
     noting that no interactive surface is attached, and shall store and push nothing;
   - an anonymous patch or delete shall return a plain-text "surface state unavailable for this caller" error;
   - `ptah_surface_get_state` shall return "no surface state for this caller".
   Invalid input is still rejected first, as in criterion 2.
6. When a committed mutation reaches only some of the attached surfaces, or none, the tool result shall report the
   committed state and the delivery outcome separately. It shall keep the committed revision and include the text
   fallback and the delivery-failure detail, and the retry path shall not apply the mutation twice. `delivered` shall
   never be reported for a failed send. Tests shall cover sends that return false, throw or reject, partial delivery,
   and disposal between enumeration and send, with no unhandled rejection (v1 precedent:
   `dashboard-namespace.builder.ts:84-148`, `protocol-dispatcher.ts:1640-1650`).
6. When either tool's input schema and description are generated, they shall come from the contract module (the
   `z.toJSONSchema` precedent in `dashboard-propose-spec.tool.ts:45-56`). A test shall assert that every v2 kind name,
   action id and budget value appears in the tool description.
7. Decision on `ptah_dashboard_propose_spec`: it stays, with an unchanged name, input schema and text result. A
   delivered v1 spec from a caller with a routing id shall be recorded in the same store and reach the UI through the
   same surface push as v2, so the renderer has one intake. When it is called, `ptah_surface_get_state` shall report
   that spec. The existing `dashboard-namespace.builder.spec.ts` assertions on outcome and text shall still pass.
   A documented, deterministic mapping shall define the v1 spec's surface id and what happens when it collides with
   a v2 surface. The parsed v1 envelope, including its agent-supplied `revision`, shall be kept unchanged, and the
   host revision used for state operations shall be separate from it. Tests shall repeat a v1 proposal, change its
   `revision`, reuse its `specId` across two tabs, and collide it with a v2 surface id. The resulting store state
   shall be unambiguous in each case.
   If the architect finds a stronger reason to fold it into `ptah_surface_update`, the plan shall say why, and the
   tool name shall still resolve for existing agent prompts.

### 9. UI-to-host RPC channel (`surface:*`)

Requirement: the webview reports changes, submits, selections and reads through one typed, allowlisted RPC
namespace, so that the UI never talks to the agent directly.

Acceptance criteria:

1. When the webview calls any `surface:*` method, the method shall be declared in `RpcMethodRegistry` and
   `RPC_METHOD_ENTRIES` (`libs/shared/src/lib/types/rpc.types.ts:664`, `:3413`). `'surface:'` shall be in
   `ALLOWED_METHOD_PREFIXES`. `rpc-allowlist.spec.ts` and `verify-and-report.spec.ts` shall pass.
2. When a `surface:*` call carries parameters that fail its strict Zod schema (unknown key, wrong type, oversize
   string), the handler shall return `INVALID_PARAMS` and change nothing.
3. When the host-profile manifest is resolved for VS Code, Electron and CLI, the `surface` handler entry shall resolve
   on each without throwing. `resolve-handler-plan.spec.ts` shall cover it.
4. When a `surface:change` (or equivalent) call succeeds, the store shall hold the new value, and no call to the chat
   session's send path (`sendMessageToSession`) shall be made.
5. When the webview reloads or remounts, or detects a revision gap, it shall be able to read the complete current
   state for a routing id, and for a single surface, through a read method. The result shall not be truncated,
   because it is bounded by the store's per-surface budget. It shall carry the same revisions and values that
   `ptah_surface_get_state` reports.
6. When a `surface:*` call names a routing id or surface that the store does not hold, the handler shall return the
   same not-found result as for a deleted surface. It shall never create state for an unknown routing id: only the
   agent path creates surfaces.

### 10. Submit starts one agent turn; change does not

Requirement: a submit sends the validated form values to the agent as one new turn in the session that owns the
surface. A change only updates host state.

Acceptance criteria:

1. When a submit for (T, S) is accepted, the host shall bind one immutable, validated snapshot of the values to one
   operation id and to the session resolved by the host for routing id T, and send exactly one message to that
   session. Its user content shall contain the submitted values from the host's validated copy, formatted by the
   host and not as text sent by the renderer. It shall be bounded in bytes and marked as surface-submitted data with
   host-generated delimiters. The plan shall name the point at which the chat runtime has accepted the message, and
   the operation is recorded as applied only there. A host-boundary test shall assert one dispatch
   (`sendMessageToSession` spied) and the runtime's acceptance signal.
2. When a submit fails validation (a required value is missing, a value is outside its options, a length is out of
   bounds, or the revision is stale), no turn shall start. The error shall name each failing path, and the stored form
   values shall be unchanged.
3. When the session for T cannot receive a message (not active, or no live stream,
   `chat-session.service.ts:1125-1145`), the submit shall be rejected with a reason and no turn shall start. When
   dispatch fails after it began, the outcome shall be rejected only if no turn can have started. Otherwise it shall
   be indeterminate (Requirement 6.5), and the host shall not redispatch automatically. The plan shall define when
   the revision and the last-submit record change for each outcome.
4. When a turn is already in progress on T, the submit shall follow the documented busy rule. The assumption is that
   it is rejected with a distinct busy reason and no turn, with the values retained. It shall never be silently
   dropped or duplicated. A test shall pin the chosen rule.
5. When the same submit operation id arrives twice, at most one turn shall start (Requirement 6, criterion 4).
6. When a surface has more than one submit action or section, the submit shall include exactly the bound inputs in
   the invoked action's scope, under a documented rule (whole surface, or an explicit subtree stored with the
   action). Values outside that scope shall not enter the turn. The stored last-submit record shall name the action,
   the scope, the revision and the submitted values.

### 11. Surface delivery on VS Code, Electron and CLI

Requirement: surface pushes work, or report "no surface" honestly, on every runtime that hosts the MCP tools.

Acceptance criteria:

1. When `ptah_dashboard_propose_spec` or `ptah_surface_update` runs on Electron with the window present, the delivery
   outcome shall be `delivered` with one surface, and `IpcBridge.sendToRenderer` shall receive the payload. An adapter
   spec calling `createDashboardBroadcast(() => adapter, logger)` (or the v2 equivalent) shall prove it.
2. When the same tools run on the CLI host, the outcome shall be `no-surface` (success), and the tool shall return the
   text rendering. No exception shall be thrown. A CLI adapter spec shall prove it.
3. When they run on VS Code, the existing `WebviewManager.getActiveWebviews()` path shall deliver to every active
   webview, as today, and the existing namespace specs shall pass.
4. When `ElectronWebviewManagerAdapter` and `CliWebviewManagerAdapter` are compiled, both shall structurally satisfy
   `DashboardSurfaceHost` (`dashboard-namespace.builder.ts:74-81`) or its v2 successor, checked by the type system in a
   spec.

### 12. Handoff to TASK_2026_494

Requirement: the TASK_2026_494 architect gets a precise list of what v2 changes in their plan, so that 494 is revised
on this contract rather than on v1.

Acceptance criteria:

1. When this task reaches completion, a handoff note shall exist in this task folder (a section of the
   implementation plan or a separate `handoff-494.md`, at the architect's choice). It shall state, with the file and
   symbol names delivered here:
   - (a) D3 intake: which push message and payload replace `dashboard:spec-proposed` intake, how snapshots and patches
     are applied, and how a revision gap is recovered.
   - (b) D4 channel: which `surface:*` methods replace `dashboard:select`, that `DashboardSessionStore` is not built,
     and what happens to `ChatDashboardSelectionInjectorService`.
   - (c) Renderer view model: the v2 kind list, the data-model binding rules, draft versus submit validation, change
     versus submit, operation ids and the pending/indeterminate/unknown states the renderer must show. It shall also
     state the renderer's duty to prove that markup characters create no elements.
   - (d) Component 7: the Electron fix is already delivered here and must be removed from 494's scope.
2. When a 494 plan section is not affected by v2 (for example D1, D2, D5, D6, D7), the note shall say so, so that the
   494 architect does not re-derive it.

## Non-functional requirements

- Security (TASK_2026_490 Revision 6, items 1 and 3; `dashboard-catalog.ts:1-20`): action allowlist; Zod validation of
  every value at the MCP boundary and again at the RPC boundary; no HTML-bearing field and plain text only; URL scheme
  allowlist unchanged; host mediation of every action; operation ids on every mutation; routing-id isolation between
  tabs. `dashboard-trust-boundary.spec.ts` shall gain v2 cases for each control: an unknown action, a `format` other
  than `plain`, markup characters carried as inert data unchanged through validation and push, `javascript:` /
  `data:` / `http:` URLs, a prototype-pollution path and a cross-routing-id read. The v1 assertions stay unchanged.
  Proving that the renderer binds markup as text is TASK_2026_494's obligation (`dashboard-catalog.ts:132-137`), and
  the handoff note (Requirement 12.1c) shall say so.
- Resource bounds: every v2 budget is a named constant in the catalog module, marked provisional as v1's are
  (`dashboard-catalog.ts:142-171`), because TASK_2026_494 confirms them against the renderer. The store bound and its
  worst-case memory are documented. No latency target is set; none was requested.
- Compatibility:
  - VS Code, Electron and CLI hosts keep working, and the TUI shares the CLI adapter.
  - The v1 contract, its tool name and its text result are unchanged.
  - The `mcp-apps-contracts` entry point keeps its "importer must be `strict: true`" constraint
    (`index.ts:18-25`), and the main `@ptah-extension/shared` barrel stays zod-free.
- Verification: `npx nx run-many -t typecheck,test,lint` passes for every project this task changes (at least
  `shared`, `vscode-lm-tools`, `vscode-core`, `rpc-handlers`, `cli-engine` and `ptah-electron`).

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| Apps page users (Electron) | Agent-built forms with lists and selects whose values reach the agent | After 494 renders v2: fill a form, submit, and the agent answers with those values |
| Coding-agent users (chat tabs) | The same two-way surfaces in a coding session | After 539 mounts: a coding tab's surface and state are isolated from other tabs |
| TASK_2026_494 architect | A stable contract and a precise change list for D3, D4 and the view model | The handoff note maps every affected plan section to a delivered symbol |
| TASK_2026_539 implementer | One state channel for chat surfaces, keyed by `tabId` | No second channel is needed (539 `context.md` "Scope") |
| The agent (Claude SDK and other CLIs over MCP) | Tools that teach the contract and return usable errors and text | Tool descriptions list kinds and limits, and rejections name the path |
| Security reviewer | Revision 6 controls extended to inputs, paths and actions | Trust-boundary spec cases for every control listed above |
| CLI / headless users | No crash, and a text answer | The CLI returns `no-surface` plus text, and no exception |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Agent-controlled labels or option text spoof host UI (for example "Approve install") inside a submit turn | MEDIUM | HIGH | Architect: the submit turn content marks values as surface data with host-generated delimiters. Security reviewer: a trust-boundary case with a spoofing label |
| Prototype pollution or oversized payloads through data-model paths | MEDIUM | HIGH | Backend developer: path-segment denylist plus a byte/depth budget, with the test in Req 4.1 |
| Agent patches and user edits race on the same path, and one write is lost silently | HIGH | MEDIUM | Architect: define the staleness rule (Req 5.4, 6.3) in the plan, and test both orders |
| A duplicate submit after an RPC timeout starts two agent turns | MEDIUM | HIGH | Backend developer: reserve the operation id before dispatch and keep in-flight records from eviction (Req 6.4, 10.5), with a test |
| A renderer-supplied parameter or undeclared action reaches a host side effect | MEDIUM | HIGH | Backend developer: resolve every action from the stored declaration (Req 6.7). Security reviewer: a forged-parameter test |
| v2 envelope design diverges from what 494's renderer can express, and 494 re-opens the contract | MEDIUM | MEDIUM | Architect: review the handoff note with the 494 architect before the store and tools are built. Budgets stay provisional |
| The v1 tool and the v2 tool produce two intake paths in the webview | MEDIUM | MEDIUM | Architect: honour Req 8.7 (one push and one store for both), and name it in the handoff |
| Scope creep into rendering or persistence | MEDIUM | MEDIUM | Team-leader: reject batches that touch `libs/frontend/**` or add persistence, citing "Out of scope" |

## Open questions

- Busy rule for submit while a turn is running: reject (assumed) or queue behind the running turn. The software
  architect answers this from what the chat path already supports. The user is asked only if queueing would need new
  chat behaviour.
- Does 494 D4's per-turn `[SYSTEM CONTEXT - DASHBOARD SELECTION]` injection survive in v2, or does
  `ptah_surface_get_state` replace it? The assumption is that this task does not build the injector, and the handoff
  note says whether 494 should. The software architect answers, and the 494 architect confirms.
- When is a routing id's store entry released: tab close, session end, or LRU only? The assumption is LRU only, with
  an explicit release if the architect finds a clean lifecycle hook. The software architect answers.
- Should a data-model-only agent patch make a UI change against the prior revision stale? The software architect
  answers as part of the staleness rule.

## Lane review disposition

The first draft of this document was reviewed by an independent lane (codex, agent
`7ea08f2f-ea1f-4a6e-89cf-a26e0607d4ed`, one round). The findings were checked against the code before they were
applied. The draft was amended in place.

| # | Finding | Disposition | Where |
| --- | --- | --- | --- |
| 1 | Caller authorization: routing scope must not come from the caller | Accepted for MCP: the scope comes from `getCallerSessionId()` (checked at `protocol-dispatcher.ts:1628`) and cross-tab access returns not-found. Partly rejected for RPC: the webview is one host-owned renderer with no per-caller session identity to check against, so RPC gets "unknown routing id or surface returns not-found, and RPC never creates state" instead | Req 8.4, 9.6 |
| 2 | Host mediation: undeclared actions and renderer-supplied parameters | Accepted | Req 6.7, 6.8; Risks |
| 3 | Idempotency cannot be unconditional with a bounded store | Accepted: reservation before any side effect, routing-scoped ids, rejection of reuse with different content, a separate retention bound, no eviction while in flight, fail-closed after expiry, no promise across a restart | Req 6.4, 7.2, 7.6 |
| 4 | No truthful state for a received but unfinished operation | Accepted: pending and indeterminate added, and unknown does not authorize replay | Req 6.5 |
| 5 | A spy cannot prove a turn started; dispatch-failure gap | Accepted: a named runtime acceptance point, indeterminate instead of blind redispatch | Req 10.1, 10.3 |
| 6 | Revision and concurrency covered only agent patches | Accepted: an atomic base-revision check on every channel, duplicate create rejected, a race test | Req 5.7, 5.8 |
| 7 | No criterion for partial or failed delivery after commit | Accepted, following the v1 precedent | Req 8.6 |
| 8 | Request-size bounds only at the MCP boundary and only on the result | Accepted: per-request limits on both boundaries, the cancelling-patch test, and store accounting of every retained copy | Req 4.3, 7.2 |
| 9 | Optional store injection lets a supported host ship without state | Accepted: a shared store on all three hosts with a cross-channel composition test; "unavailable" is a defensive case only | Req 7.4 |
| 10 | An anonymous patch or delete has nothing to render | Accepted: an anonymous snapshot is rendered only, and an anonymous patch or delete is an error; delete text names the surface | Req 8.1, 8.5 |
| 11 | v1 bridge identity and revision undefined | Accepted | Req 8.7 |
| 12 | Draft values versus submit validation are ambiguous | Accepted | Req 3.3, 3.6 |
| 13 | Full-state recovery conflicts with a truncated MCP response | Accepted with a change: the RPC read is complete (it is bounded by the per-surface budget), and the MCP read may truncate but must offer complete per-surface reads | Req 8.3, 9.5 |
| 14 | "Return current revision" is impossible for a missing surface and leaks across tabs | Accepted | Req 6.3 |
| 15 | "Markup rendered as text" cannot be checked in a task with no renderer | Accepted: this task tests inert transport, and the renderer proof goes to 494 through the handoff | Non-functional Security; Req 12.1c |
| M1 | Selection invalidation after an update | Accepted | Req 5.9 |
| M2 | UI-originated changes must reach other mounted views | Accepted | Req 7.7 |
| M3 | Eviction must be visible to mounted surfaces | Accepted | Req 7.6 |
| M4 | Several inputs bound to the same or overlapping paths | Accepted | Req 3.7 |
| M5 | Scope of a submit when a surface has several submit actions | Accepted | Req 10.6 |

The lane's scratch output was deleted after this disposition was recorded. It was an input, not a task deliverable.

## Handoff

- Next specialist: software-architect.
- Why: the requirements are settled. The open questions are about the design (envelope shape, staleness rule, turn
  start path, push message shape), and no external unknowns remain.
