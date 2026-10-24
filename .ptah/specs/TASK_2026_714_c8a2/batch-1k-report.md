# Batch 1k report

## Summary

User-approved addition: raised `USAGE_TURN_LIMIT` from 15,000 to **30,000**; cumulative usage remains **100,000**. The existing boundary assertions and fake-child breach scenarios reference `USAGE_TURN_LIMIT` and therefore now exercise 30,000/30,001. Renamed the boundary spec to state the new limit. Both JSON usage-bound outputs and Markdown output already interpolate the constant and now report 30,000. The unrelated 15,000 ms RPC timeout and timestamp fixtures remain unchanged.

Implemented bounded item/startup summaries and replaced the nonexistent MCP approval request with `mcpServer/elicitation/request`. The MCP case sets `mcp_servers.marker.default_tools_approval_mode="prompt"`, requires that setting in `config/read`, holds a validated request for 200 ms with no marker effect, accepts once without persistence content, and uses the existing marker/interrupt/outcome gates.

Scoped `ptah_get_diagnostics` on both changed files returned **0 errors, 0 warnings** after fixing a missing spec import. No tests, standalone typecheck, lint, formatter, build, model, App Server, installation, or git command ran.

## Files changed (line ranges)

- `libs/backend/codex-runtime/tools/evidence-harness.ts`: 43 (30,000 per-turn usage limit), 342?423 (summary types, elicitation validation/evidence), 564?565 and 601?674 (notification summaries and request tracking), 744?755 (schema-correct decline even during failure), 1123?1169 and 1211?1246 (removed dead MCP approval branches), 1320 (MCP-only config), 1460?1496 (elicitation gate), 1721?1730 (fixed MCP tool identity/arguments), 1833?1841 (effective config check).
- `libs/backend/codex-runtime/tools/evidence-harness.spec.ts`: 7 (filesystem import), 1215 (updated per-turn boundary spec title), 1051?1061 (old helper now rejects elicitation; handling belongs to runCase), 2155?2291 (new fake-child and summary specs).
- `.ptah/specs/TASK_2026_714_c8a2/batch-1k-report.md`: this deliverable.
- `evidence-cases.json` and `evidence-failure-notes.ts` unchanged. Existing allowlisted failure literals suffice.

## Schema evidence (quote params/response)

Source: `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json`, definitions inspected directly.

`McpServerElicitationRequestParams` has top-level `"required": ["serverName", "threadId"]`; `turnId` is `["string", "null"]`. Its description says: ?Active Codex turn when this elicitation was observed, if app-server could correlate one.? The harness intentionally requires a non-null current turn for this experiment.

The form union requires `"message", "mode", "requestedSchema"`. Modes are `"form"`, `"openai/form"`, `"openaiForm"`; the URL branch requires `"elicitationId", "message", "mode", "url"` and uses mode `"url"`. `_meta` is unconstrained wire metadata. `McpElicitationSchema` requires `"properties", "type"`; `required` is an optional nullable array. Its description: ?Typed form schema for MCP `elicitation/create` requests.?

`McpServerElicitationRequestResponse`: `"required": ["action"]`, with `action` referencing `McpServerElicitationAction`, whose enum is `["accept", "decline", "cancel"]`. `content` is structured accepted input and `_meta` is optional. Responses implemented: `{ "action": "accept", "content": {} }` and `{ "action": "decline" }`. Forms requiring input fields are rejected rather than fabricating values or persistent consent.

`ThreadItem` / `McpToolCallThreadItem` requires `"arguments", "id", "server", "status", "tool", "type"`; the discriminator is `"mcpToolCall"`. This is **tool**, not the guardian-review action's **toolName**. Optional `error` accepts `McpToolCallError` or null; optional `result` accepts `McpToolCallResult` or null.

`McpServerStatusUpdatedNotification` requires `"name", "status"`; status references `McpServerStartupState` (`starting`, `ready`, `failed`, `cancelled`). Optional fields include error, failureReason, threadId. The manifest notification is `mcpServer/startupStatus/updated`.

Manifest `methods.serverRequests` includes `account/chatgptAuthTokens/refresh`, `applyPatchApproval`, `attestation/generate`, `execCommandApproval`, `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/call`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`; it contains no `item/mcpToolCall/requestApproval`. The dead handler and dead denial-schema lookup were deleted.

## Binary evidence

Read-only bounded byte-context scans of `D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`; binary was not executed. Non-printable bytes were replaced with spaces and match/output counts bounded. Relevant literal sequences:

- `default_tools_approval_modeenabled_toolsdisabled_tools` adjacent to `PluginMcpServerConfig`.
- `startup_timeout_sec:        tool_timeout_sec:        default_tools_approval_mode:` in MCP server display strings.
- `approvalautopromptwritesapproveauthrequiredsupports_parallel_tool_callsomit_tools_fromstartup_timeout_sectool_timeout_secdefault_tools_approval_modeenabled_toolsdisabled_tools` in MCP configuration serialization strings.
- `default_tools_approval_modetools` and `approval_modeautopromptwritesapprove` in configuration strings.
- `codex_approval_kindpersistalwayssessiontool_titletool_descriptionsourceconnectorlink_is_implicitconnector_nameconnector_descriptiontool_params_display`.
- Nearby: `Allow`, `to run tool`, `MCP server`, `objectpropertiesuser rejected MCP tool call`.
- `elicitation/createinvalid elicitation modermcp-client\src\elicitation_client_service.rs`.
- `readOnlyHintdestructiveHintidempotentHintopenWorldHintstruct ToolAnnotations with 5 elements`.

The annotations are recognized wire fields; mere presence does not prove that declaring destructiveHint is required to prompt. The configuration key and approval-form strings support a prompt-mode experiment more directly. Binary strings alone do not establish control flow, the full generated form, or successful execution; those remain real-run evidence gaps.

## MCP approval path chosen and why

Use the manifest-supported elicitation path with a server-level prompt setting, scoped to the isolated one-tool MCP fixture. No speculative per-tool configuration key or destructive annotation was added. The fixture retains its existing exclusive marker creation (`O_EXCL`) and fixed original slot.

The request must belong to the exact current thread and turn, name server marker, be a supported object-form mode, and have no required input fields. Any supplied tool/toolName or metadata tool/toolName/tool_title must identify write_marker. A different server/case/turn/tool, a second elicitation, URL mode, or required form fields fail with `Unexpected request`. Declines use `action`, including queued requests encountered after failure. The pending request is held for 200 ms; the existing polling guard and explicit before/after checks reject marker effects during the hold. Acceptance contains no persistence choice. The normal marker observation interrupts the turn. MCP item notifications must identify the fixture tool with exactly `{slot: "original"}`; the existing one-tool limit and exclusive writer prevent repeated marker effects.

Change 2.5 was not selected: evidence supports an MCP approval mechanism and does not justify declaring that 0.155.1 cannot ask. Completion without a request retains existing unverified/gate behavior; no unsupported-capability claim was added.

## Event summary fields

- item/started and item/completed: optional itemType and itemStatus.
- MCP items: optional server and tool (sanitized, capped at 80 characters).
- Completed MCP items: hasError is true for a non-null error, false for null/absent; error contents are never retained.
- Startup notifications: optional status and name, sanitized and capped at 80.
- Types/statuses are also sanitized/capped. Arguments, results, item text and startup error contents are omitted.
- Elicitation approval evidence: sanitized parameter keys, serverName (80), message (400), requestedSchema property names only, and _meta keys only. Property and metadata values are omitted.

## Specs added

Fake-child tests cover held/absent marker ? accept ? one marker write ? observed and interrupted; wrong server, non-MCP case, second elicitation, wrong turn/tool, required form fields; marker effects during the hold; summary fields, caps, redaction, error-presence booleans and omission of payloads. Existing fixture/fake-child conventions and real pinned schema/manifest are reused. Tests were **written, not run**, as instructed.

## Decisions

User decision: 30,000 tokens per turn, cumulative 100,000 unchanged. No alternative limit was selected by the implementation lane; this is a reversible constant change explicitly requested by the user.

1. **Server-level prompt setting**, rather than annotations alone or an invented per-tool key. Evidence: binary configuration strings and one-tool fixture. Reversible: remove the one scoped override/check if real-run evidence contradicts it.
2. **Elicitation action response**, rather than decision response or dead requestApproval support. Evidence: pinned manifest and response definition. Reversible source change; no product/runtime registration changes.
3. **Require correlated turn and reject required form inputs**. Options: allow null turn or invent persistence/form values. Evidence: schema permits null turn but this experiment requires exact current-turn identity; binary contains session/always persistence choices. This deliberately fails safely if the actual form needs additional input. Reversible once a sanitized real-run shape establishes the correct answer.
4. **No annotations change and no ?no MCP approval path? fallback**. Recognized annotations and approval-form strings do not prove either annotations are necessary or approval is impossible. Keep the experiment factual and report unresolved wire behavior. Reversible after evidence.
5. **Non-null error presence**. Optional/nullable error fields use false for null/absent and true for an error object; no error body is retained. Evidence: ThreadItem schema. Reversible representation choice.

## Not done / risks

- Real App Server and paid model were not run. Binary-derived prompt behavior, effective config serialization, generated form mode/required fields, and actual approval correlation remain unverified. A run may fail at the config gate or conservatively decline a form requiring fields; the report does not claim a successful real MCP approval.
- Tests, standalone typecheck, lint, prettier and build were not run. Only allowed scoped diagnostics ran; final result was zero errors/warnings.
- The schema also supports URL elicitations and uncorrelated turns; these are intentionally outside this fixed fixture experiment.
- No changes outside the two authorized source/spec files and this report; no task state, production code, git state, or dependency changes.
