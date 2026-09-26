# Batch 3 executor report — TASK_2026_559_8ca9

Executor: backend-developer (sub-agent). Batch: 3 (Tasks 3.1, 3.2). Plan-free BUGFIX; inputs were batches.md
(Batch 3, "Notes for Batch 3", Batch 2f behaviour notes, plan validation), context.md User Decisions 5 and 6,
research-report.md:170-181 and :290-304, research/cross-cutting.md:275-291.

`<WT>` = `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`,
`<MC>` = `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core`.

## Files

- CREATED `<MC>/mcp-caller.ts`: `McpCallerKind`, `McpCaller`, `resolveMcpCaller(request)`
- CREATED `<MC>/mcp-caller.spec.ts`: 21 cases (each kind, precedence, empty/whitespace/non-string, params ignored,
  verbatim values, statelessness)
- MODIFIED `<MC>/mcp-request-context.ts`: `callerAgentId` on `McpRequestContext`, `getCallerAgentId()`
- MODIFIED `<MC>/mcp-request-context.spec.ts`: `getCallerAgentId` describe (inside/outside, independence from the
  other fields, concurrency isolation, no leak)
- MODIFIED `<MC>/protocol-dispatcher.ts`: `buildToolSet(caller, deps)`, caller resolution in `tools/list` and
  `tools/call`, `callerAgentId` in the context, `callerKind` in telemetry, `ptah_agent_report` reads the context
- MODIFIED `<MC>/protocol-dispatcher.spec.ts`: `callerKind` in the two exact telemetry assertions, 3 new
  `ptah_agent_report` cases, new describe `caller identity (TASK_2026_559 Batch 3)` (5 cases)

## Task 3.1 — `McpCaller` resolution and `callerAgentId` in the context — COMPLETE

- `resolveMcpCaller(request: Pick<MCPRequest, '_callerSessionId' | '_callerAgentId' | '_callerWorkspaceRoot'>): McpCaller`.
  Pure: no I/O, no module state. It reads only the three URL-derived fields, never `params`.
- Kind precedence: agent > session > workspace > anonymous. A value that is not a string, or is empty or
  whitespace only, counts as absent. Present values are kept verbatim (not trimmed), so the identity equals what
  the transport decoded.
- Shape as recorded for TASK_2026_560 in batches.md: `{ kind; sessionId?; agentId?; workspaceRoot? }`. Every
  present field is carried; absent fields are omitted (not set to `undefined`).
- `McpRequestContext.callerAgentId?` and `getCallerAgentId()` follow the `getCallerSessionId`/`getCallerWorkspaceRoot`
  pattern.
- stdio/CLI check: `handleMCPRequest` has exactly one production caller, `http-mcp-server.service.ts:371`. The stdio
  surface (`mcp-stdio/stdio-mcp-server.service.ts`) has its own `tools/list`/`tools/call` and never reaches the
  dispatcher. In the HTTP path, a URL with no identity segment stamps all three fields `undefined`
  (`http-server.handler.ts:379-381`), and an in-process request with no fields resolves to `anonymous`. Both
  are pinned in `mcp-caller.spec.ts`.

## Task 3.2 — thread the caller into tools/list, tools/call and telemetry — COMPLETE

- `handleToolsList`: `buildToolSet(resolveMcpCaller(request), deps)` → `markEagerTools` → `declareResultBudgets`.
  This is the Batch 2f order. `buildToolSet` returns `buildToolDefinitions(deps)` for every caller kind (User
  Decision 6). Its doc comment names it as the composition point that TASK_2026_560 keys on
  `(caller.kind, caller.workspaceRoot, caller.agentId)`. `registeredToolNames` still derives from
  `buildToolDefinitions({ hasIDECapabilities: true })`, so it matches the full list.
- `tools/call`: the caller is resolved once. The context gets `callerAgentId: caller.agentId`, and
  `handleToolsCall(request, deps, caller.kind)` passes the kind to the telemetry.
- Telemetry: `ToolResultTelemetry.callerKind`, set in `toolResultTelemetry`. It is still the one `debug` line inside
  `runObserver` in `handleToolsCall`'s `finally`. Only the kind is logged, never an id or the root.
- `ptah_agent_report`: reads `getCallerAgentId()` only (one source). Blank ids are already absent, so the check is
  `=== undefined`.

## Deviations

1. The context's `callerSessionId` and `callerWorkspaceRoot` keep the transport's RAW values. They are not taken
   from the normalised `McpCaller`; only `callerAgentId` is. Reason: the existing consumers already judge those two
   fields, and normalising them would change pinned behaviour outside this batch. For example,
   `McpCallerWorkspaceResolver` refuses a declared root that is not open, by name. A whitespace root such as
   `/workspace/%20` would silently become "anonymous" and resolve to the single open folder. The Batch 2f spool
   root also treats the declared root only as a candidate that must match a provider folder. A comment at the
   `tools/call` case records this.
2. `ptah_agent_spawn` still passes `request._callerSessionId` as `parentSessionId`. The batch did not ask for a
   change there, and the raw value equals the context's session field (Deviation 1), so there is still one value.

## Risk and edge-case handling

| Risk / edge case | Handling | Evidence |
| --- | --- | --- |
| `tools/list` byte-identical across all four caller kinds and repeated calls (prompt cache) | `buildToolSet` ignores the caller in 559; spec follows the Batch 2f byte-stability pattern | `caller identity` describe: `JSON.stringify(result)` for agent/session/workspace/anonymous, each called twice, equals the no-caller reference, in 3 configs (default; IDE+SQLite; IDE + `browser`,`git` disabled) |
| Malformed URL field never borrows another caller's identity | Resolver reads only the request's own three fields, has no state, and treats a blank or non-string value as absent (it can only make the caller less specific) | `mcp-caller.spec.ts` malformed/params/stateless cases; dispatcher spec: blank/non-string callers get the reference list byte-for-byte; the context test shows `_callerAgentId:'  '` + session → `agent: undefined` |
| `anonymous` gets the default set | No narrowing | Spec: an anonymous list contains a tool from every namespace and core group, with no duplicates, and equals every other kind's list byte-for-byte |
| `ptah_agent_report` has one agent-id source | `getCallerAgentId()` only | Existing URL-identity and forged-`agentId` specs still pass; new: `''`/`'   '` → `unattributed-caller`; session+workspace caller with no agent → `unattributed-caller`, `report` not called |
| Telemetry logs only the kind, stays `debug` in `runObserver` | `callerKind` field added in `toolResultTelemetry`; no other log change | Spec: for each kind the line has `callerKind`; debug/info/warn/error calls contain neither `agent-secret-id`, `session-secret-id` nor the root; the Batch 2f "never at info" assertion is unchanged and passes |
| Spool root stays host-owned (Batch 2f F1) | Not touched. `resolveSpoolRoot` still takes `getCallerWorkspaceRoot()` only as a candidate that must match `deps.workspaceProvider` | The `spool root trust (review F1)` specs pass unchanged |
| Shared signature changes | `ptah_lsp_references` on `McpRequestContext`: only the `mcp-core/index.ts` barrel and its own file use it. The field is additive and optional. `handleToolsCall`, `toolResultTelemetry` and `handleToolsList` are module-private | ptah-cli and ptah-electron typecheck pass |

## Verification

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`
  → exit 0, "Successfully ran targets test, lint, typecheck for project @ptah-extension/vscode-lm-tools". Run twice,
  the second time after the Prettier pass.
- Targeted: `jest -c libs/backend/vscode-lm-tools/jest.config.ts` on the three touched specs → 3 suites, 153 tests passed.
- `node_modules/.bin/nx run-many "-t=typecheck" -p ptah-cli ptah-electron --skip-nx-cache --parallel=2` → exit 0.
- ESLint on the six touched files: 0 errors. There is 1 warning, the existing `max-lines` warning on
  `protocol-dispatcher.ts` (the file was already far over 700 lines before this batch; it now has 2,103).
  `prettier --check` is clean after `--write` on the two spec files; the diff shows only added lines.
- No TODO/FIXME/stub markers were added.

## Out-of-scope observations

- `http-server.handler.ts` `extractCaller*` call `decodeURIComponent` without a guard. A malformed escape
  (`/agent/%E0%A4%A`) throws, and the request becomes a `-32700 Parse error` instead of an `anonymous` caller. It
  never borrows an identity, but the error message is misleading. That file is not in this batch.
- `mcp-core/index.ts` does not re-export `getCallerAgentId` or `resolveMcpCaller`/`McpCaller`. Nothing outside
  mcp-core needs them yet, so the barrel was left alone (it is not in the batch file list). TASK_2026_560 may add
  them.
