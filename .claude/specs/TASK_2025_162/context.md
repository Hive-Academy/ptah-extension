# Task Context - TASK_2025_162

## User Request

Integrate the GitHub Copilot SDK (`@github/copilot-sdk`) as an alternative to the current CLI spawn-based Copilot adapter. The SDK provides typed streaming events, programmatic permission hooks, user input routing, session management with resume, custom tool injection, and crash recovery - solving all current pain points with the CLI approach.

## Task Type

FEATURE

## Complexity Assessment

Complex (16-24 hours estimated)

## Strategy Selected

FEATURE (Partial) - Skip PM/Research (already done), start from Architect

## Research References

- `D:\projects\ptah-extension\docs\research-session-linking-and-copilot-sdk.md` (Part 2)
- `D:\projects\ptah-extension\docs\research-copilot-sdk-integration.md`

## Key Findings from Research

1. **Package**: `@github/copilot-sdk` v0.1.29 (Technical Preview)
2. **API**: CopilotClient → createSession() → send/events/resume
3. **Permission hooks**: `onPreToolUse` with allow/deny/modify decisions
4. **User input**: `onAskUserInput` for routing questions to UI
5. **Custom tools**: Zod-validated tools injected directly (bypass MCP)
6. **Session mgmt**: Custom sessionIds, resumeSession(), infinite context
7. **Streaming**: 40+ typed events via discriminated unions
8. **Auth**: VS Code GitHub auth provides tokens

## Implementation Phases

### Phase 1: SDK Adapter (keep CLI as fallback)

- Install `@github/copilot-sdk`
- Create `CopilotSdkAdapter` alongside `CopilotCliAdapter`
- Feature flag: `ptah.copilot.useSdk`
- Register in CliDetectionService based on flag + availability

### Phase 2: Permission & Input Routing

- New message types: AGENT_MONITOR_PERMISSION_REQUEST, AGENT_MONITOR_USER_INPUT_REQUEST
- Frontend: Permission dialog in agent card
- Frontend: Input field in agent card
- Route decisions back to SDK via RPC

### Phase 3: Direct Tool Injection

- Build Ptah tool definitions as Zod schemas
- Inject via SDK `tools` config
- Remove MCP server routing complexity for Copilot

### Phase 4: Session Management

- Capture session IDs from SDK
- Persist to SessionMetadata (reuse TASK_2025_161 infrastructure)
- Enable resume via `resumeSession()`

## Key Files to Create/Modify

### New Files

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts`
- `libs/shared/src/lib/types/copilot-sdk.types.ts` (permission/input types)

### Modified Files

- `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts` — Register SDK adapter
- `libs/shared/src/lib/types/agent-process.types.ts` — Permission request/input types
- `libs/shared/src/lib/types/message.types.ts` — New message types
- `libs/frontend/chat/src/lib/services/agent-monitor.store.ts` — Handle permission/input events
- `libs/frontend/chat/src/lib/components/molecules/agent-card.component.ts` — Permission UI, input UI
- `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` — Forward new events
- `package.json` — Add @github/copilot-sdk dependency

## Dependencies

- TASK_2025_161 must complete first (session linking infrastructure reused)

## Related Tasks

- TASK_2025_161: Gemini CLI Session Linking (prerequisite)

## Created

2026-02-28
