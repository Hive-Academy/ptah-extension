# Batch 8m-3 report — host prompt lifecycle and MCP logs

Lane: grok. Files edited are only the two host-port files below. No tests, lint, typecheck, or git commands were run (team-leader verifies).

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-host-ports.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-host-ports.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8m-3-report.md`

## Per-task result

### A. G5 — no `PERMISSION_AUTO_RESOLVED` after a delivered user answer

Done in `codex-chat-host-ports.ts` `handlePermissionResponse`.

Claude reference (`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` `handleResponse`, around the sibling loop that calls `webviewManager.sendMessage(..., PERMISSION_AUTO_RESOLVED)`): that message is sent only for *other* pending prompts of the same tool when the user picks Always Allow. The request the user just answered is resolved and is not auto-resolved. Abort and timeout clear host attention and resolve the pending promise; they do not send `PERMISSION_AUTO_RESOLVED`.

Codex differs because `CodexChatApprovalSink.respond` always settles by calling `presentation.dismiss` (`codex-chat-approval-sink.ts` settle, dismiss at the dismissal call). `dismiss` used to find the wire id still registered and emit `PERMISSION_AUTO_RESOLVED` for the answered prompt (finding 8k-5 #2).

Fix: `settle` the wire id before `approvals.respond`. A dismiss that runs inside a delivered answer finds no wire id and sends nothing. `dismiss` with the wire id still present (timeout, Stop/abort, sink settle without a user answer) still sends exactly one. If `respond` returns false or throws, the host sends exactly one `PERMISSION_AUTO_RESOLVED` after that silent dismiss (answer not deliverable). Decision mapping is unchanged: allow → accept, always_allow → acceptForSession, deny_with_message → decline, deny → cancel.

### B. D16 — stop sending `allowedDecisions`

Done. `present` no longer sets `allowedDecisions` on `PermissionRequest`. The shared optional field is untouched (batch 8m-6). The renderer still receives Claude's permission message and answers with Claude's decision vocabulary.

### C. L3 — MCP logs

Done, wiring unchanged.

- User servers: log text is "User MCP servers are configured for Codex chat." Code `codex-user-mcp-configured`. Still names and transports only.
- Ptah attach: one info log per `profile()` call that keeps the session URL (one open; a second open logs again). Code `ptah-mcp-attached`. Field `path` is `new URL(url).pathname` only (`/session/{routingId}/workspace/...`). Host, port, userinfo, query, and hash are not logged. A user server named `ptah` still wins (`mergeMcpOverride` parity) and that case is not logged as a Ptah attach.

### D. L2b — sessions-rail preview

Not fixed. The cause is not in `codex-chat-host-ports.ts`. See the finding below.

### E. Specs

Updated in `codex-chat-host-ports.spec.ts`:

- Delivered user Allow, with `respond` calling `dismiss` the way the sink does: no `PERMISSION_AUTO_RESOLVED`. Same for Deny.
- Dismiss without an answer: exactly one, and a second dismiss does not add another.
- Answer not deliverable (`respond` dismisses, then returns false or throws): exactly one.
- Permission payload has no `allowedDecisions` key. Decision mapping specs still cover allow / always_allow / deny_with_message / deny.
- Ptah attach log: code `ptah-mcp-attached`, path matches `/session/tab-1/workspace/...`, serialized log has no token, Authorization, Bearer, localhost, port, or `http://`. A second `profile()` call logs a second attach (once per open).
- User-server log says configured (`codex-user-mcp-configured`) and the old "attached" message is not used.

## L2b finding (deferred)

The Electron sessions rail title is `ChatSessionSummary.name`.

- Row: `libs/frontend/chat/src/lib/components/molecules/session-list-row/session-list-row.component.ts` (title binding on `session().name`, `data-testid="session-row-title"`).
- Display: `libs/frontend/chat/src/lib/services/session-display-utils.service.ts` `getSessionDisplayName` (about line 65). A UUID name becomes `Session <first 8 hex>...`.
- List RPC: `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` `session:list` sets `name: s.name` (about line 551) from `SessionMetadataStore`.
- Native writer: `CodexChatAdapter.persistMetadata` (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts` about lines 70 and 349–358) passes `config.sessionTitle ?? config.sessionName` into `metadata.save`. The port comment says the title is not persisted. `createCodexChatMetadataPort` (`libs/backend/agent-sdk/src/lib/wiring/codex-chat-metadata-port.ts` lines 10–23) ignores that argument and calls `updateCodexExecution`. `updateCodexExecution` (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts` about lines 1030–1033) sets `name: existing?.name ?? sessionId`. A new native session is therefore labeled with the thread id. Later opens keep that name. `codex-chat-host-ports.ts` only forwards `deps.metadata`; it never writes `name`.

Related, same row, also not this file: `messageCount` comes only from the Claude JSONL transcript (`session-message-count.ts` header; `session-rpc.handlers.ts` about lines 497–554). A native Codex thread has no such file, so the rail stays at a hidden "0 msgs" as well.

Proposed fix (later batch; do not do it in the host ports): pass the title into `updateCodexExecution`. When the title is non-empty and the stored name is missing or equal to the session id, store the title. Do not overwrite a name the user renamed. Count rollout turns for `providerId` of the native runtime in `session:list` if the "0 msgs" half should move too.

## Decisions

### Settle the wire id before `approvals.respond`

- Decision: drop the wire id before the bridge `respond`, so an in-answer `dismiss` cannot emit `PERMISSION_AUTO_RESOLVED`. On reject or throw, send one afterwards.
- Options: (1) settle first, as implemented. (2) a "user answered" flag that `dismiss` checks. (3) stop sending the message from `dismiss` and have every non-answer path send it itself.
- Evidence: `CodexChatApprovalSink` settle always calls `dismiss` (`codex-chat-approval-sink.ts`). Claude's `handleResponse` does not send `PERMISSION_AUTO_RESOLVED` for the answered id (`sdk-permission-handler.ts`). Existing cancel-then-dismiss specs expect no auto-resolve after `cancelPrompt` has already settled the id.
- Reversible: yes. Restoring the old order brings the double message back; the flag alternative is a local edit in the same function.

### Log Ptah attach only when the session URL survives

- Decision: log `ptah-mcp-attached` only if the `ptah` map entry is still the session URL after user servers are merged.
- Options: (1) log only the surviving entry, as implemented. (2) always log the computed URL even when a user server named `ptah` replaces it.
- Evidence: the host already documents Claude `mergeMcpOverride` parity (user server named `ptah` wins). Logging the replaced URL would claim an attach that did not happen.
- Reversible: yes. Move the log to before the user-server loop.

### Pathname only, via `URL.pathname`

- Decision: log `new URL(ptahSessionUrl).pathname`, not the absolute URL.
- Options: (1) pathname, as implemented. (2) a hand-sliced string that keeps percent-encoding. (3) log the full URL with query stripped.
- Evidence: `ptahMcpSessionUrl` is `http://localhost:{port}/session/{routingId}/workspace/{cwd}`. Pathname drops host, port, userinfo, query, and hash. Routing ids stay in the path, which the task allows. `URL` parsing of our own URL does not throw.
- Reversible: yes.

## Not done

- No test/lint/typecheck run (batch rule: team-leader verifies).
- Shared `PermissionRequest.allowedDecisions` and the dead frontend readers stay until batch 8m-6.
- L2b not patched; cause is the metadata port and `updateCodexExecution`, outside this lane's files.
- `codex-chat-native-contract.spec.ts`, codex-runtime, and frontend files were not edited.

## Review fix 1

`chat-session.native.spec.ts` lines 333–336 expected the old user-MCP log (`'User MCP servers are attached to Codex chat.'`, code `codex-user-mcp-attached`). They now expect `'User MCP servers are configured for Codex chat.'` and code `codex-user-mcp-configured`. No other `codex-user-mcp-attached` assertion remains in that file. The expectation is `toHaveBeenCalledWith`, not an ordered `logger.info` list, so the new `ptah-mcp-attached` log was left unasserted there. The negative check at lines 374–376 (`'User MCP servers are not attached to Codex chat.'`) is unchanged.
