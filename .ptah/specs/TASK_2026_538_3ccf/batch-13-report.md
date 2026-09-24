# Batch 13 report — MCP tools, dispatcher and API wiring

Task: TASK_2026_538_3ccf, declarative surface contract v2.
Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2`.
Executor: backend-developer subagent.

## Task 13.1: `PtahAPI.surface` and the builder wiring (COMPLETE)

- `types.ts`: added `surface: SurfaceNamespace` beside `dashboard`. It is non-optional, for the same reason as
  `dashboard`: it answers usefully on every host.
- `ptah-api-builder.service.ts` has wiring lines only:
  - `@inject(VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE, { isOptional: true })` is the last constructor parameter.
  - `surface: this.buildNamespaceSafe('surface', () => buildSurfaceNamespace({ service, logger }))`.
  - The dashboard `broadcast` is `createDashboardSurfaceBridge(service)` when the service is present. When it is
    absent, it falls back to `createDashboardBroadcast(() => webviewManager, logger)`.
  - The builder wraps the logger in `nonThrowingSurfaceLog` itself (`surface-namespace.builder.ts:86`), so the
    wiring passes `this.logger`.
  - As the handoff says, a bridge `refused` result already reaches the agent as `rejected`, so no extra branch was
    added.
- Evidence: `ptah-api-builder.service.spec.ts` gained two cases. The test helper takes an optional last argument for
  the surface service; nothing else in the file changed.
  - With the service, `buildSurfaceNamespace` receives it, `createDashboardBroadcast` is never called, and the
    dashboard broadcast forwards `(sessionId, spec, toolCallId)` to `recordV1Proposal`. It returns that call's
    delivery.
  - Without the service, the fallback `createDashboardBroadcast` is used and `ptah.surface` gets
    `service: undefined`.
- Message-constants checklist: the comments needed correcting, and Batch 13 corrected them.
  - The defensive fallback, used when `SURFACE_STATE_SERVICE` is not registered, still posts
    `dashboard:spec-proposed` to webviews. The comment at `:170-172` ("No longer posted to webviews since
    TASK_2026_538") was therefore not strictly true.
  - The comment at `:175` ("v1 proposals included") was only conditionally true.
  - Both comments now say what happens:
    - `surface:updated` is used whenever the service is registered, which is every host that runs
      `registerVsCodeLmToolsServices` (`di/register.ts:127-130`).
    - `dashboard:spec-proposed` is still posted by the `PtahAPIBuilder` fallback.
  - The change is to comments only.
  - `message-constants.ts` is not a Batch 11 file. Batch 11 owns `rpc.types.ts`, `rpc-surface.types.ts`, the
    rpc-handlers files and `manifest.ts`.

## Task 13.2: `surface-tools.ts` and `surface-tool-handlers.ts` (COMPLETE)

### Schemas

- Both schemas are generated with `z.toJSONSchema(…, { io: 'input', target: 'draft-7' })`, with `$schema` removed.
- `ptah_surface_get_state` is the generated fragment unchanged. The spec asserts `toEqual` against the zod output.
- `ptah_surface_update` needed one step the plan did not cover:
  - `SurfaceUpdateInputSchema` is a discriminated union, and zod emits it as a top-level `oneOf`.
  - `MCPToolDefinition.inputSchema` requires `type: 'object'` plus `properties`
    (`mcp-core/types/mcp-protocol.types.ts:111-115`). MCP clients such as the Anthropic API also reject a top-level
    `oneOf`, `anyOf` or `allOf`.
  - `flattenOperationUnion` merges the generated branches into one closed object:
    - `operation` becomes an `enum` of the four operations.
    - Every other branch field keeps its generated schema unchanged, with a description added that names the
      operations requiring it.
    - `definitions` (the recursive `SurfaceComponent`) is kept, so every `$ref` still resolves.
    - `required: ['operation']` and `additionalProperties: false`.
  - The validator behind the namespace stays authoritative. The spec proves that each branch property, minus the
    added description, equals the zod output, and that `definitions` is unchanged.

### Descriptions

Nothing in the descriptions is hardcoded.

- Values interpolated from the contract:
  - schema and catalog versions;
  - layout, input and display kinds;
  - `SURFACE_ACTIONS` and `SURFACE_HOST_SUPPORTED_ACTIONS`;
  - `SURFACE_INPUT_EMPTY_VALUES`;
  - `describeSurfaceLimits()`, which covers every `SURFACE_LIMITS` budget;
  - the store budgets `maxSurfacesPerRoutingId`, `maxRoutingIds` and `maxStoreBytes`;
  - the v1 id prefix.
- The update tool's text also states:
  - Staleness rule: `baseRevision` must equal the CURRENT revision, otherwise the write is rejected as stale and
    nothing changes; revisions also move on user edits; re-read, then resend.
  - Anonymous rules: they quote the namespace's own strings, and the spec checks them against the real namespace
    output.
  - Batch 4 choices: `set-title` replaces the whole header; an `add-component` index past the end is rejected; select
    and radio-group are empty only at `null`; required text is checked after trimming; data-reference components
    cannot be selected by index. Each choice was checked against source, for example `surface-patch.ts:170-174` and
    `:201-202` and `checkSurfaceSelection` at `:367-370`.
  - Delivery-failed rule: "states the committed revision: do not resend".
- Read limits:
  - The limit is `formatKiB(SURFACE_LIMITS.maxStateReadBytes)`, which gives "548 KiB (561152 UTF-8 bytes)".
  - `ptah_surface_get_state` also gives the configurable reader floor,
    `formatKiB(SURFACE_READER_MIN_STATE_READ_BYTES)`, which gives "40 KiB (40960 UTF-8 bytes)".
  - The spec asserts that both constants hold the architect's values and that the text contains the interpolated
    strings.
- Annotations: update `{ destructiveHint: false }`; get_state `{ readOnlyHint: true, destructiveHint: false }`.

### Handlers

- `surfaceUpdateReply` and `surfaceGetStateReply` map outcomes to `{ isError, text }`.
- These outcomes become errors, which the dispatcher turns into a `toolErrorResponse`:
  - `rejected` and `unavailable`;
  - `delivery-failed`, as its reason (which carries the committed revision and "do not resend") followed by the
    state text, so no content is lost.
- These outcomes are successes:
  - `accepted`, as a header line with the committed revision and delivery, then the text;
  - `render-only`;
  - `found` and `not-found`.
- `handleSurfaceToolCall(name, args, surface, caller)` passes the arguments through unchanged and never reads scope
  from them.

### Spec

`surface-tools.spec.ts` has 16 tests. It covers:

- the schema checks and the Req 8.6b interpolation, over every kind, every action id and every budget;
- the Batch 4 wording, the anonymous wording and the read limit;
- the reply mapping;
- two cases through the real `SurfaceStateService` and namespace:
  - A committed but undelivered patch is an error that names `committed revision 2` and "do not resend". The retry
    is rejected, and no second push is sent.
  - The anonymous wording matches the tool description.

## Task 13.3: Dispatcher cases (COMPLETE)

- `protocol-dispatcher.ts` received wiring lines only:
  - two imports;
  - `buildSurfaceUpdateTool()` and `buildSurfaceGetStateTool()` in the always-on list, directly after
    `buildDashboardProposeSpecTool()`;
  - one case block with two case labels. It builds the caller only from `getCallerSessionId()`, which is set by
    `runWithMcpRequestContext` from `_callerSessionId`, and from `request.id`. It then maps the reply to
    `toolErrorResponse` or `createToolSuccessResponse`.
- The handler returns a plain reply and the dispatcher builds the JSON-RPC envelope. This keeps the dispatcher's
  private `toolErrorResponse` and `createToolSuccessResponse` from being exported, and avoids an import cycle.
- `mcp-core/index.ts` is unchanged (A5).
- `protocol-dispatcher.spec.ts` gained one appended `describe` with 5 tests. No existing line was edited.
  - Both tools are listed with every namespace toggle off.
  - A scoped caller comes from `_callerSessionId`, never from the arguments. A forged `sessionId` argument is
    forwarded unchanged to the validator and never becomes the caller.
  - An anonymous caller is covered for both tools.
  - The get_state `found` result is a success; `rejected` and `unavailable` are errors.
  - An update that fails delivery is an error that keeps the revision, "do not resend" and the text.

## Verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --outputStyle=static
  --skip-nx-cache`. Output was captured, U+2028/U+2029 were escaped, and the result was filtered. It **exited 0**.
  - Typecheck passed.
  - **63/63 suites and 1,380/1,380 tests** passed, against a baseline of 62 and 1,357. This batch added the new
    suite plus 23 tests.
  - Lint: **0 errors and 44 warnings**, the same as the baseline. The only warning in a touched file is the existing
    `max-lines` warning on `protocol-dispatcher.ts`.
- `npx eslint libs/shared/src/lib/types/messages/message-constants.ts` exited 0. The change there is to comments
  only.
- `git diff --check` is clean.
- The three created files were formatted with Prettier.
  - `protocol-dispatcher.spec.ts` was Prettier-clean at HEAD, so Prettier only formatted the appended block.
  - The other modified files were not Prettier-clean at HEAD. They were hand-formatted, and a Prettier dry-run diff
    shows no remaining hunk in a changed line.
- Sizes of the new files: `surface-tools.ts` 236 lines, `surface-tool-handlers.ts` 92, `surface-tools.spec.ts` 371.
- Growth of existing files: `protocol-dispatcher.ts` +23 (already over the ceiling), `protocol-dispatcher.spec.ts`
  +197 (1,837 → 2,034, append-only), `ptah-api-builder.service.ts` +38, `types.ts` +7.
- The new files contain no `as any`, `@ts-ignore` or TODO. Every new `catch` in them uses `unknown`; the new code
  adds no catch.
- The Nx Cloud artifact upload returned 401, which does not affect the result.

## Risks and how each was handled

- **Scope forgery (R12).**
  - The caller is built only in the dispatcher, from the async-local request context and the request id.
  - Arguments are forwarded unchanged. The namespace's strict schemas reject a forged `sessionId` or `tabId`.
  - The dispatcher spec asserts that a forged argument never becomes the caller.
- **Throwing logger.**
  - The new handlers and the dispatcher case do not log.
  - The namespace wraps its logger in `nonThrowingSurfaceLog`.
  - The v1 bridge does not log.
  - A logger failure therefore cannot change an outcome.
- **Top-level `oneOf` schema.** The update schema is flattened as described under Task 13.2. This is a deviation the
  plan did not anticipate, recorded below.
- **R8 import rule.**
  - v2 values come from `@ptah-extension/shared/mcp-apps-contracts/surface`, and plain types from
    `@ptah-extension/shared`.
  - There is no cross-library deep import, and no barrel change was needed.
  - One intra-library import reaches into `surface/surface-state-reader.ts` for `SURFACE_READER_MIN_STATE_READ_BYTES`.
    This follows the precedent of `surface-namespace.builder.ts` importing `surface/surface-log`, and it avoids
    widening the facade barrel for one constant.
- **Files over the ceiling.** `protocol-dispatcher.ts`, `types.ts` and `ptah-api-builder.service.ts` received wiring
  lines only. The case logic is in the new handler file.
- **Concurrency with Batch 11.**
  - No file in `libs/backend/rpc-handlers`, `rpc.types.ts`, `rpc-surface.types.ts` or an app registration file was
    edited.
  - The one file outside vscode-lm-tools is `libs/shared/src/lib/types/messages/message-constants.ts`, a comment-only
    change that the Task 13.1 checklist allows. It is not a Batch 11 file.
- **v1 regression.** When the service is absent, the v1 path keeps the pre-538 broadcast. The existing dashboard
  tool spec, `dashboard-propose-spec.tool.spec.ts`, still passes unchanged.

## Plan deviations

- The flattening of the `ptah_surface_update` input schema, as above. Everything else follows the batch as written.
- `ptah-api-builder.service.spec.ts` was not listed in the batch. It gained an optional trailing helper parameter
  and two wiring tests, as evidence for Task 13.1.

## Absolute paths written

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\surface-tools.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\surface-tool-handlers.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\surface-tools.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.spec.ts` (append only)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\types\messages\message-constants.ts` (comments only)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\.ptah\specs\TASK_2026_538_3ccf\batch-13-report.md`

Verification logs, kept outside the repository: `%TEMP%\ptah-batch13-verify2.safe.log`.

## Revision 1

This revision addresses every finding in `code-logic-review-batch-13.md`: F1–F4, reviewed 4/10 NEEDS_REVISION. The
reviewer accepted both earlier deviations.

### F1 (BLOCKING): caller identity comes from the transport only

- The fix is at `mcp-http/http-server.handler.ts:368-381`. The reserved fields `_callerSessionId`, `_callerAgentId`
  and `_callerWorkspaceRoot` are removed from the parsed JSON body. All three are then set from the URL every time;
  when the URL has no `/session/{id}`, `/agent/{id}` or `/workspace/{root}`, the field is `undefined`.
- The body can therefore never set a session, agent or workspace scope.
- **Scope addition:** this file is outside the Batch 13 file list. It is a vscode-lm-tools file, not a Batch 11 file.
- Other transports were checked:
  - The stdio server (`mcp-stdio/stdio-mcp-server.service.ts:317`) takes `callerSessionId` from the host's launch
    configuration, never from the message body.
  - The stdio server does not route to `protocol-dispatcher.ts`.
  - `handleMCPRequest` has one production caller, `http-mcp-server.service.ts:353`, which goes through the fixed
    handler.
  - No other transport needed the same rule.
- Evidence is in the new file `mcp-core/protocol-dispatcher.surface.spec.ts`. It runs the real `startHttpServer` on
  port 0, the real dispatcher, the real service and the real namespace.
  - A body forging session `victim` on `/` and on `/workspace/ws-plain` is treated as anonymous:
    - The read returns "no surface state for this caller" with no secret.
    - The delete returns "surface state unavailable for this caller".
  - `/session/attacker` with a forged body cannot read `victim`'s state, and `victim`'s state is still stored.
  - A legitimate `/session/victim` read still returns the state.
- Mutation check: the handler was temporarily changed to fall back to the body's `_callerSessionId`. The two forged
  tests then failed (2 failed, 6 passed). The source was restored and the restore verified.
- The existing `http-server.handler.spec.ts` URL-stamping tests pass unchanged.

### F2 (BLOCKING): no raw exception text reaches the agent

- Delivery failures, in `namespace-builders/surface-namespace.builder.ts`:
  - The `delivery-failed` reason no longer embeds `delivery.reason`. It reads: "Surface X committed revision N, but
    delivery to the UI failed. d of s attached surface(s) received it; do not resend; <retry guidance>."
  - The `delivery` object in the outcome carries the public `SURFACE_DELIVERY_FAILED_PUBLIC` text. That object is
    also reachable through `execute_code` as `ptah.surface`.
  - The raw reason goes only to the namespace's guarded `nonThrowingSurfaceLog` warning. The facade's own guarded
    "push not delivered" log keeps its raw detail as before.
- Unexpected exceptions, in `mcp-core/surface-tool-handlers.ts`:
  - `handleSurfaceToolCall` now catches `error: unknown` and returns the fixed `SURFACE_TOOL_UNEXPECTED_FAILURE` error.
    That text says a write may or may not have been committed, and to read with `ptah_surface_get_state` first.
  - The raw message goes only to a guarded log.
  - Surface exceptions therefore never reach the dispatcher's shared catch.
  - The dispatcher now passes its logger as a fifth argument.
- Evidence:
  - The reviewer's reproduction (`getHost` throws `review-private-host-detail`) runs through the real service and
    namespace in `surface-tools.spec.ts`, and through `handleMCPRequest` in the new spec. It asserts that the detail is
    absent from the reply, that "committed revision 1", "do not resend" and the rendered text are present, and that the
    detail is present in the internal log.
  - A throwing namespace, combined with a throwing log, returns exactly the sanitized text.
- **Follow-up, not fixed:** the shared dispatcher catch still returns raw exception text to the agent for every
  tool other than the surface tools. It is `handleIndividualTool`'s catch, "Tool X failed: <message>", and the
  top-level `handleMCPRequest` catch, which returns the JSON-RPC error with the message and stack. Changing either
  would alter all tools, which is outside this revision.

### F3 (SERIOUS): observability cannot replace an outcome

- `protocol-dispatcher.ts` gains `runObserver(fn)`, which catches `error: unknown` and drops it. Each of these calls
  is now wrapped in it independently:
  - the `MCP Request` debug log at entry;
  - the slow-tool warning in `handleToolsCall`'s `finally`;
  - the error log in the top-level catch;
  - the error log and the `onToolResult` call in `handleIndividualTool`'s catch;
  - `onToolResult` in `createToolSuccessResponse`.
- Other tools behave the same, except that a throwing observer no longer changes their response.
- Regression specs at `handleMCPRequest` in the new spec cover all three reproductions:
  - A throwing entry `debug` still gets an answer.
  - With `performance.now` spied to force the slow path, a throwing `warn` and a failed send, the response still
    carries `committed revision 1` and "do not resend".
  - A throwing `onToolResult` is called exactly once, and the response is still the committed success. The committed
    state is found in the store.

### F4 (MODERATE): structure-read wording

- `surface-tools.ts` no longer says the structure answer is "within maxSurfaceBytes". It now says:
  - "maxSurfaceBytes <n> UTF-8 bytes bounds the surface you SEND, not this answer: the returned text is escaped JSON
    and can be larger than the stored surface."
  - The next sentence names the bound on every read: maxStateReadBytes, 548 KiB (561152 UTF-8 bytes).
  - Both numbers are interpolated.
- The spec asserts the new wording, and that the old claim is absent.
- A semantic test builds 40 stats of `String.fromCharCode(0x2028).repeat(2000)`. The create is accepted. The
  structure read then returns found; its byte length is greater than `maxSurfaceBytes` and at most
  `maxStateReadBytes`, and it contains no raw U+2028.

### Verification

- Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools --outputStyle=static
  --skip-nx-cache`, with output captured and U+2028/U+2029 escaped. It **exited 0**.
  - **64/64 suites and 1,391/1,391 tests** passed, against 63 and 1,380 before this revision.
  - Lint: 0 errors and 44 warnings, the same as the baseline.
- Prettier:
  - The new spec and the changed new files were formatted.
  - `http-server.handler.ts` and `surface-namespace.builder.ts` show no Prettier diff.
  - `protocol-dispatcher.ts`'s only remaining Prettier hunk is the one at `:584`, which was already there before this
    batch.
- `git diff --check` is clean.
- Line counts:
  - `protocol-dispatcher.surface.spec.ts`: 318
  - `surface-tools.spec.ts`: 475
  - `surface-tool-handlers.ts`: 116
  - `surface-tools.ts`: 238
  - `surface-namespace.builder.ts`: 203
- `protocol-dispatcher.spec.ts` was not edited in this revision.
- No Batch 11 file was touched, and no git write command was run.

### Files written in revision 1

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-server.handler.ts` (scope addition, F1)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts` (F3 guards, handler logger argument)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\surface-tool-handlers.ts` (F2)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\surface-tools.ts` (F4)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\surface-tools.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\surface-namespace.builder.ts` (F2; a Batch 12 file inside vscode-lm-tools)
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.surface.spec.ts`
