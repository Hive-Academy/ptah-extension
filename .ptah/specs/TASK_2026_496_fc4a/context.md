# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4, Revision 5 and Revision 6 first. They replace the earlier revisions
where they disagree.

Lane B. Depends on: none.

## Questions

1. Can Ptah get a complete server inventory? `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:916` passes only the Ptah server plus overrides. The SDK also loads servers from settings files (`settingSources`, `:942`), and `setMcpServers()` does not affect those (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2305`).
2. Can the settings-file servers be disabled or replaced without the loss of project instructions, plugins and skills?
3. Does `createSdkMcpServer` (`sdk.d.ts:463`, `type: 'sdk'` at `:1014`, `_meta` at `:3212`) keep the `mcp__<server>__<tool>` names and the `canUseTool` permission flow?
4. Does it support a tool list that changes after construction?

## Method

A fake stateful stdio server. Prove one upstream PID and one live upstream session while the two callers use it.

- The model lists and calls tools through the in-process SDK server. The SDK server exposes tools only.
- The host lists tools with `_meta`, and lists and reads resources, through the Ptah-owned client.

Test auth necessary, cancellation, reconnect, `tools/list_changed`, a resource change, and a settings-file server with the same name.

Track the session, not only the PID. The fake server records a connection ID for each `initialize`. Assert that exactly one upstream transport is live. During reconnect, assert that the old session closes before the new session starts.

## Same-name settings server

The rule is fail closed. A settings-file server can have the same name as a broker-owned server. In that case the broker-owned registration must win, or the session must refuse to start with a clear error. No other result is a pass.

For that case the spike asserts these items for list, call and read:

- server identity (the connection ID of the fake broker-owned server)
- tool metadata
- results
- permission behavior

## Exit criteria

Go, all of these:

- one process and one live upstream session
- stable tool names
- the model lists and calls tools through the SDK server
- the host lists tools with `_meta` and lists and reads resources through the Ptah-owned client
- metadata and results agree between the two paths
- permission prompts kept
- the same-name settings server case follows the fail-closed rule
- during reconnect, the old session closes before the new session starts

No-go: redesign with a loopback proxy or ask for an SDK capability. Use the current versions: `@modelcontextprotocol/sdk ^1.29.0` and `@modelcontextprotocol/ext-apps` 1.7.5. Do not migrate first.

## Deliverable

`spike-report.md` in this folder, with the decision and the evidence. Throwaway code stays on a branch.

## Source

`.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 1. `.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 4, corrections 1 and 2.
