# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4 and Revision 5 first. They replace the earlier revisions
where they disagree.

Lane B. Depends on: none.

## Questions

1. Can Ptah get a complete server inventory? `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:916` passes only the Ptah server plus overrides. The SDK also loads servers from settings files (`settingSources`, `:942`), and `setMcpServers()` does not affect those (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2305`).
2. Can the settings-file servers be disabled or replaced without the loss of project instructions, plugins and skills?
3. Does `createSdkMcpServer` (`sdk.d.ts:463`, `type: 'sdk'` at `:1014`, `_meta` at `:3212`) keep the `mcp__<server>__<tool>` names and the `canUseTool` permission flow?
4. Does it support a tool list that changes after construction?

## Method

A fake stateful stdio server. Prove one upstream PID while the model and the host list, call and read it. Test auth necessary, cancellation, reconnect, `tools/list_changed`, a resource change, and a settings-file server with the same name.

## Exit criteria

Go: one process, stable tool names, metadata and results agree, permission prompts kept. No-go: redesign with a loopback proxy or ask for an SDK capability. Use the current versions: `@modelcontextprotocol/sdk ^1.29.0` and `@modelcontextprotocol/ext-apps` 1.7.5. Do not migrate first.

## Deliverable

`spike-report.md` in this folder, with the decision and the evidence. Throwaway code stays on a branch.

## Source

`.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 1. `.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 4, corrections 1 and 2.
