# Batch 10d.L3 revision 1 report

## Findings

1. **Bounded tab resolution map.** `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:242,1968-1973` caps `resolvedParentSessions` at 256 entries. Each resolve deletes and reinserts its tab before evicting the oldest entry, so tab reuse replaces the session ID and refreshes its eviction position. The manager has no tab-closed or session-ended hook to remove an entry earlier; its only existing cleanup is `disposeAll` at line 2462.
2. **Resolved parent only in outcome records.** `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:359-372,402` checks the adapter's active session before enqueueing the outcome. `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts:25,44` records that active parent ID or null. A UUID-shaped, unresolved tab ID therefore persists as null. The record shape and `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts` needed no change.
3. **Claude-compatible peer options.** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:554-569` accepts additional peer-origin fields and ignores unused top-level options. Claude forwards `options?.origin`, `admission`, and `clientMessageId` without a strict peer schema, while it uses files and images and ignores options such as `model` (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1806-1827`). Codex still parses the peer fields it uses for the inbound label. No frontend change or MCP change was needed.

## Decisions

- A lane spawned in a reused tab before its new session resolves could still read the old mapping. Codex resolves the thread ID during open, before returning the turn (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:277-294`), so that interval cannot contain a model call to `ptah_agent_spawn`. Claude resolves the SDK session ID on the sequential system-init message before subsequent tool calls (`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:684-692`); a model turn cannot spawn a lane before that init is processed. The bounded map remains shared because both runtimes can spawn with a tab ID.
- The review's concern about Codex peer events using `source: 'complete'` needs no change: the Claude user-message transformer also emits that source (`libs/backend/agent-sdk/src/lib/message-transform/user-message.transformer.ts:132-170`), per the coordinator's checked note.

## Specs

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts:3759-3793`: tab reuse replaces the mapping; the 256-entry cap evicts the oldest; a re-resolved tab stays newer than another mapping.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.spec.ts:684-708`: inactive parents, including a UUID tab ID, enqueue null. Its existing delivered-parent case at lines 259-275 asserts the resolved ID.
- `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.spec.ts:131-150`: store retains a resolved parent ID and persists null when no resolved parent exists.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:233-250,455-465`: a peer origin with an additional field and a Claude-compatible unused option are accepted.

## Evidence and unmet requirements

- Inspected the edited source and contracts. All eight edited TypeScript files and this report are LF-only UTF-8 without BOM. `ptah_workspace_analyze` and `ptah_ast_analyze` were available; the Ptah symbol index had zero entries, and `rg.exe` was denied access, so targeted source search used PowerShell `Select-String` as the fallback.
- No checks, tests, typecheck, lint, build, Nx, npm, diagnostics, real Codex server, or network/model call were run, as required. Runtime results remain for the coordinator. A local skill inventory was available, but this CLI exposed no skill invocation mechanism for the backend skill; no skill was loaded.

## Files written

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts`
- `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-10d-L3-revision-1-report.md`
