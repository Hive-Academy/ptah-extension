# Implementation Tasks - TASK_2025_044

## Strategy: Core Implementation First (Simplified)

**Architecture Decision**: Keep existing RPC handlers, focus on SDK integration only.

---

## Task 1: Library Setup & Package Installation

**Assignee**: backend-developer (Batch 1)
**Status**: Pending
**Priority**: P0 (Must complete first)

**Objective**: Generate Nx library and install official SDK package

**Deliverables**:

1. Generate `libs/backend/agent-sdk` library via Nx
2. Install `@anthropic-ai/claude-agent-sdk` package
3. Configure TypeScript with strict mode
4. Add tsconfig path mapping
5. Verify library builds

**Acceptance**:

- Library generated successfully
- SDK package installed
- `nx build agent-sdk` passes
- Import path `@ptah-extension/agent-sdk` works

---

## Task 2: Core SDK Wrapper (SdkAgentAdapter)

**Assignee**: backend-developer (Batch 1)
**Status**: Pending
**Priority**: P0

**Objective**: Wrap SDK's query() function and implement IAIProvider

**Deliverables**:

1. Create `SdkAgentAdapter` class implementing `IAIProvider`
2. Use SDK's `query()` function for streaming
3. Configure preset tools: `tools: { type: 'preset', preset: 'claude_code' }`
4. Basic streaming via AsyncGenerator
5. DI injectable with @injectable() decorator

**Files**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

**Acceptance**:

- Implements IAIProvider interface
- Can call `query()` and stream responses
- Uses SDK's built-in tools via preset
- TypeScript compiles without errors

---

## Task 3: Message Transformation Layer

**Assignee**: backend-developer (Batch 1)
**Status**: Pending
**Priority**: P0

**Objective**: Transform SDK messages to ExecutionNode format for UI compatibility

**Deliverables**:

1. Create `SdkMessageTransformer` class
2. Map SDK message types to ExecutionNode:
   - `SDKAssistantMessage` → ExecutionNode with assistant role
   - `SDKToolUse` → ExecutionNode with tool_use type
   - `SDKToolResult` → ExecutionNode with tool_result type
   - `SDKAgentMessage` → Nested ExecutionNode for sub-agents
3. Preserve parent-child relationships via `parent_tool_use_id`
4. Handle streaming partial messages

**Files**:

- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`

**Acceptance**:

- SDK messages transform to ExecutionNode
- All SDK message types handled
- Sub-agent messages map correctly
- Tool usage transforms properly

---

## Task 4: Session Storage with Parent-Child Links

**Assignee**: backend-developer (Batch 2)
**Status**: Pending
**Priority**: P0

**Objective**: Custom session storage following SDK recommendations

**Deliverables**:

1. Create `SdkSessionStorage` class
2. Store sessions in VS Code workspace state (Memento API)
3. Implement explicit parent-child message relationships via `parent_tool_use_id`
4. Support session CRUD operations (create, read, update, delete)
5. Implement session resume via SDK
6. Handle storage quota with graceful fallback to in-memory

**Files**:

- `libs/backend/agent-sdk/src/lib/sdk-session-storage.ts`
- `libs/backend/agent-sdk/src/lib/types/sdk-session.types.ts`

**Acceptance**:

- Sessions persist across VS Code restarts
- Can resume existing sessions
- Parent-child relationships explicit and queryable
- Quota handling works with in-memory fallback
- O(n) tree reconstruction (no correlation needed)

---

## Task 5: Permission Handler Integration

**Assignee**: backend-developer (Batch 2)
**Status**: Pending
**Priority**: P0

**Objective**: Bridge SDK's canUseTool callback to existing VS Code permission UI

**Deliverables**:

1. Create `SdkPermissionHandler` class
2. Implement `canUseTool(toolName, input, options)` callback
3. Auto-approve safe tools (Read, Grep, Glob)
4. Bridge dangerous tools to existing permission UI via EventBus
5. Handle permission approvals/denials via RPC
6. Implement 30-second timeout with auto-deny

**Files**:

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`

**Acceptance**:

- SDK permission requests trigger VS Code UI
- Safe tools auto-approved instantly
- User can approve/deny dangerous tools
- Timeout handling works (30s auto-deny)
- Integrates with existing permission system

---

## Task 6: Custom Tools Implementation

**Assignee**: backend-developer (Batch 3)
**Status**: Pending
**Priority**: P1

**Objective**: Add ptah.help and ptah.executeCode custom tools

**Deliverables**:

1. Create in-process MCP server via `createSdkMcpServer()`
2. Implement `ptah.help` tool using `tool()` function:
   - Search CLAUDE.md documentation files
   - Return relevant documentation sections
3. Implement `ptah.executeCode` tool:
   - Execute JavaScript/TypeScript in sandbox
   - License validation integration
   - Replaces current MCP server approach
4. Integrate custom tools with SDK via `mcpServers` option

**Files**:

- `libs/backend/agent-sdk/src/lib/ptah-tools-server.ts`
- `libs/backend/agent-sdk/src/lib/tools/ptah-help-tool.ts`
- `libs/backend/agent-sdk/src/lib/tools/ptah-execute-code-tool.ts`

**Acceptance**:

- Custom tools available alongside built-in tools
- ptah.help returns documentation content
- ptah.executeCode executes code with license validation
- Tools accessible via mcp**ptah**help and mcp**ptah**executeCode names

---

## Task 7: RPC Handler Integration

**Assignee**: backend-developer (Batch 3)
**Status**: Pending
**Priority**: P0

**Objective**: Wire SDK adapter to existing RPC handlers for frontend communication

**Deliverables**:

1. Create RPC handlers in vscode-core:
   - `sdk.startSession` - Start new SDK session
   - `sdk.sendMessage` - Send user message, stream response
   - `sdk.resumeSession` - Resume existing session
   - `sdk.getSession` - Get session data
2. Stream SDK messages to frontend via existing RPC mechanism
3. Transform SDK messages to ExecutionNode format (zero UI changes)
4. Handle permission requests via RPC

**Files**:

- `libs/backend/vscode-core/src/lib/handlers/sdk-rpc-handlers.ts`
- `apps/ptah-extension-vscode/src/extension.ts` (register handlers)

**Acceptance**:

- Frontend can start SDK sessions via RPC
- Messages stream in real-time to webview
- Existing chat UI works without changes
- Sessions resume correctly
- Permission requests flow through RPC

---

## Task 8: DI Container Registration

**Assignee**: backend-developer (Batch 3)
**Status**: Pending
**Priority**: P1

**Objective**: Register all SDK services in DI container

**Deliverables**:

1. Create DI registration module
2. Add DI tokens for all SDK services:
   - SDK_AGENT_ADAPTER
   - SDK_SESSION_STORAGE
   - SDK_PERMISSION_HANDLER
3. Register services in extension.ts activation
4. Wire dependencies (storage needs Memento, permission needs EventBus, etc.)

**Files**:

- `libs/backend/agent-sdk/src/lib/di/tokens.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `apps/ptah-extension-vscode/src/extension.ts`

**Acceptance**:

- All SDK services available via DI
- Dependencies resolve correctly
- Services initialize on extension activation
- Can resolve services from container

---

## Implementation Order

**Batch 1: Core Foundation (Tasks 1-3)**

1. Task 1 - Library setup & SDK installation
2. Task 2 - Core SDK wrapper
3. Task 3 - Message transformation

**Batch 2: Storage & Permissions (Tasks 4-5)** 4. Task 4 - Session storage 5. Task 5 - Permission handler

**Batch 3: Integration (Tasks 6-8)** 6. Task 6 - Custom tools 7. Task 7 - RPC integration 8. Task 8 - DI registration

---

## Success Criteria (POC Complete)

- ✅ Can start SDK session from VS Code
- ✅ Messages stream to chat UI in real-time
- ✅ Built-in tools work (Read, Write, Edit, etc.)
- ✅ Custom tools work (ptah.help, ptah.executeCode)
- ✅ Permissions integrate with VS Code UI
- ✅ Sessions persist and resume correctly
- ✅ Sub-agent execution displays properly
- ✅ Zero changes to existing chat UI components
- ✅ Parent-child relationships explicit (no correlation bugs)

---

## Deferred (Post-POC)

- Comprehensive error handling
- Extensive test suites
- Performance optimization
- Migration tooling from CLI to SDK
- CLI code deletion
- RPC → RxJS refactoring (if needed)
