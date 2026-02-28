# Task Context - TASK_2025_161

## User Request

Implement Gemini CLI session linking - capture session IDs from Gemini CLI init events, persist them to Ptah session metadata, and enable session resumption via `--resume <session_id>` flag. When a user loads a saved Ptah session, display linked CLI sessions with the ability to resume them.

## Task Type

FEATURE

## Complexity Assessment

Medium (6-8 hours estimated)

## Strategy Selected

FEATURE (Partial) - Skip PM/Research (already done), start from Architect

## Research References

- `D:\projects\ptah-extension\docs\research-session-linking-and-copilot-sdk.md` (Part 1)
- `D:\projects\ptah-extension\docs\research-cli-session-linking-architecture.md`

## Key Findings from Research

1. **GeminiCliAdapter** already parses `session_id` from JSONL init event but discards it
2. `--resume <UUID>` is compatible with `--output-format stream-json` and `--yolo`
3. Sessions stored at `~/.gemini/tmp/<project_hash>/chats/`
4. Need to extend: AgentProcessInfo, SpawnAgentRequest, SpawnAgentResult, SessionMetadata
5. Need to extend: SdkHandle with `getSessionId()`, GeminiCliAdapter to pass `--resume`
6. Frontend: Display linked CLI sessions when loading saved sessions

## Key Files to Modify

### Backend (Types)

- `libs/shared/src/lib/types/agent-process.types.ts` — Add cliSessionId, parentSessionId, resumeSessionId

### Backend (Gemini Adapter)

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts` — Capture session_id, add --resume flag
- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.interface.ts` — Extend SdkHandle

### Backend (Agent Process Manager)

- `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts` — Capture cliSessionId from SdkHandle

### Backend (Session Metadata)

- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` — Add cliSessions array

### Backend (MCP)

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts` — Pass resumeSessionId
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` — Add resume_session_id param
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts` — Thread parentSessionId

### Backend (RPC)

- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` — Forward parentSessionId in events

### Frontend

- `libs/frontend/chat/src/lib/services/agent-monitor.store.ts` — Add parentSessionId, cliSessionId
- `libs/frontend/chat/src/lib/components/molecules/agent-card.component.ts` — Show session linkage

## Related Tasks

- TASK_2025_162: Copilot SDK Integration (subsequent)

## Created

2026-02-28
