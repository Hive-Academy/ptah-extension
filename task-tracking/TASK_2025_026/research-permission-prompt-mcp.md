# Research: MCP Permission Prompt Tool Integration

## Task Context

- **Task ID**: TASK_2025_026
- **Objective**: Integrate Claude CLI's `--permission-prompt-tool` with our MCP server to show permission requests in the VS Code webview UI
- **Status**: Research Complete, Ready for Implementation Planning

---

## 1. How Claude CLI Permission Prompt Works

### The `--permission-prompt-tool` Flag

When Claude CLI runs with this flag, it delegates permission decisions to a specified MCP tool instead of prompting in the terminal:

```bash
claude -p "run tests" \
  --output-format stream-json \
  --permission-prompt-tool mcp__ptah__approval_prompt
```

### Expected MCP Tool Contract

**Input Parameters** (received by `approval_prompt` tool):

```typescript
interface ApprovalPromptInput {
  tool_name: string; // e.g., "Bash", "Write", "Read"
  input: object; // Tool parameters (command, file_path, etc.)
  tool_use_id?: string; // Unique identifier for this tool call
}
```

**Output Format** (returned by `approval_prompt` tool):

```typescript
// Allow execution
{ "behavior": "allow", "updatedInput": { /* original or modified input */ } }

// Deny execution
{ "behavior": "deny", "message": "User rejected the request" }
```

### Permission Check Order

1. Check static rules (`settings.json`, `--allowedTools`, `--disallowedTools`)
2. If no rule matches → call `--permission-prompt-tool`
3. MCP tool returns allow/deny decision

---

## 2. Current Ptah Extension Infrastructure

### MCP Server (CodeExecutionMCP)

- **Location**: `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts`
- **Port**: 51820 (configurable via `ptah.mcpPort`)
- **Protocol**: HTTP + JSON-RPC 2.0
- **Current Tool**: `execute_code` (workspace intelligence APIs)

### Claude Process Spawning

- **Location**: `libs/backend/claude-domain/src/cli/claude-process.ts`
- **Current Args**: `-p`, `--output-format stream-json`, `--verbose`, `--allowedTools mcp__ptah`
- **Missing**: `--permission-prompt-tool` flag

### MCP Configuration

- **Location**: `libs/backend/claude-domain/src/cli/mcp-config-manager.service.ts`
- **File**: `.mcp.json` in workspace root
- **Format**: `{ "mcpServers": { "ptah": { "command": "http", "args": ["http://localhost:51820"] } } }`
- **Tool Prefix**: `mcp__ptah__` (all tools prefixed with server name)

### Frontend Permission UI (Partial)

- **Location**: `libs/frontend/chat/src/lib/components/molecules/tool-call-item.component.ts`
- **Current State**: Detects permissions POST-HOC from error messages containing "permission"
- **Buttons**: Allow, Always Allow, Deny (UI exists but backend stub)

---

## 3. Reference Implementation Analysis

### Source: [claude-code-chat](https://github.com/andrepimenta/claude-code-chat)

Their approach uses:

1. **Separate MCP Server** for permissions (runs as separate Node.js process)
2. **File-based IPC**: `.request` and `.response` files
3. **FileSystemWatcher** in VS Code extension to detect permission requests

**Flow**:

```
Claude CLI → MCP Server (writes .request file) → VS Code (watches files) →
Webview (shows UI) → VS Code (writes .response file) → MCP Server (reads, returns to CLI)
```

**Why we won't use this approach**:

- Our MCP server runs IN-PROCESS (extension host)
- File-based IPC adds latency and complexity
- Direct EventBus communication is cleaner

---

## 4. Proposed Architecture (In-Process Integration)

### Overview

Extend our existing `CodeExecutionMCP` server with an `approval_prompt` tool that communicates directly with the webview via VS Code's postMessage API.

### Flow Diagram

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude Code    │────▶│  CodeExecution  │────▶│  VS Code        │────▶│  Webview UI     │
│  CLI            │     │  MCP Server     │     │  Extension      │     │  (Chat Panel)   │
│                 │◀────│  (in-process)   │◀────│                 │◀────│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Detailed Flow

1. **Claude CLI** calls `mcp__ptah__approval_prompt` when permission needed
2. **CodeExecutionMCP** receives JSON-RPC request, creates pending Promise
3. **Extension** posts message to webview: `{ type: 'permission:request', payload: {...} }`
4. **Webview** shows PermissionRequestCard component with Allow/Deny buttons
5. **User** clicks button, webview posts response message
6. **Extension** receives response, resolves pending Promise
7. **CodeExecutionMCP** returns JSON-RPC response to Claude CLI
8. **Claude CLI** proceeds or aborts tool execution

---

## 5. Technical Design

### New Types (libs/shared)

```typescript
// libs/shared/src/lib/types/permission.types.ts

export interface PermissionRequest {
  /** Unique request ID (UUID) */
  id: string;

  /** Tool name (e.g., "Bash", "Write", "Read") */
  toolName: string;

  /** Tool input parameters */
  toolInput: Record<string, unknown>;

  /** Claude's tool_use_id (for correlation) */
  toolUseId?: string;

  /** Request timestamp */
  timestamp: number;

  /** Formatted description for UI display */
  description: string;
}

export interface PermissionResponse {
  /** Must match request ID */
  id: string;

  /** User's decision */
  decision: 'allow' | 'deny' | 'always_allow';

  /** Optional reason (for deny) */
  reason?: string;
}

export interface PermissionRule {
  /** Pattern to match (e.g., "Bash:npm*", "Write:*.md") */
  pattern: string;

  /** Action when matched */
  action: 'allow' | 'deny';

  /** Created timestamp */
  createdAt: number;
}
```

### MCP Server Enhancement

```typescript
// In code-execution-mcp.service.ts

// New: Pending permission requests
private pendingPermissions = new Map<string, {
  resolve: (response: PermissionResponse) => void;
  timeout: NodeJS.Timeout;
}>();

// New: Tool definition in handleToolsList
private getApprovalPromptTool(): MCPToolDefinition {
  return {
    name: 'approval_prompt',
    description: 'Request user permission to execute a tool via VS Code UI',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Tool requesting permission' },
        input: { type: 'object', description: 'Tool input parameters' },
        tool_use_id: { type: 'string', description: 'Unique tool use ID' },
      },
      required: ['tool_name', 'input'],
    },
  };
}

// New: Handle approval_prompt tool call
private async handleApprovalPrompt(params: ApprovalPromptParams): Promise<MCPResponse> {
  const requestId = crypto.randomUUID();

  const response = await new Promise<PermissionResponse>((resolve) => {
    // Store resolver with timeout
    const timeout = setTimeout(() => {
      this.pendingPermissions.delete(requestId);
      resolve({ id: requestId, decision: 'deny', reason: 'Timeout' });
    }, 5 * 60 * 1000); // 5 minute timeout

    this.pendingPermissions.set(requestId, { resolve, timeout });

    // Send to webview via EventBus → WebviewManager
    this.eventBus.publish('permission:request', {
      id: requestId,
      toolName: params.tool_name,
      toolInput: params.input,
      toolUseId: params.tool_use_id,
      timestamp: Date.now(),
      description: this.formatPermissionDescription(params),
    });
  });

  // Format response for Claude CLI
  if (response.decision === 'allow' || response.decision === 'always_allow') {
    return {
      jsonrpc: '2.0',
      id: requestId,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({ behavior: 'allow', updatedInput: params.input }),
        }],
      },
    };
  } else {
    return {
      jsonrpc: '2.0',
      id: requestId,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({ behavior: 'deny', message: response.reason || 'User denied' }),
        }],
      },
    };
  }
}
```

### Claude Process Update

```typescript
// In claude-process.ts buildArgs()

// Add permission prompt tool
args.push('--permission-prompt-tool', 'mcp__ptah__approval_prompt');

// Update allowedTools to include approval_prompt
const allowedTools = new Set<string>(['mcp__ptah', 'mcp__ptah__approval_prompt']);
```

---

## 6. Implementation Plan Summary

### Phase 1: Types & Backend (2-3 hours)

- Add permission types to shared lib
- Add `approval_prompt` tool to MCP server
- Wire EventBus for permission events

### Phase 2: CLI Integration (1 hour)

- Update ClaudeProcess args
- Test with manual CLI invocation

### Phase 3: Extension Communication (2 hours)

- Add RPC handler for permission:respond
- Wire webview message handlers

### Phase 4: Frontend UI (2-3 hours)

- Create PermissionRequestCard component
- Update ChatStore for permission state
- Handle user responses

### Phase 5: Testing & Polish (2 hours)

- Unit tests
- Integration tests
- Edge cases (timeout, concurrent requests)

**Total Estimate**: 9-11 hours

---

## 7. Sources

- [Claude Code Best Practices - Anthropic](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Claude Code Playbook - Permission Prompt Tool](https://www.vibesparking.com/en/blog/ai/claude-code/docs/cli/2025-08-28-outsourcing-permissions-with-claude-code-permission-prompt-tool/)
- [GitHub Issue #1175 - permission-prompt-tool documentation](https://github.com/anthropics/claude-code/issues/1175)
- [Reference Implementation - claude-code-chat](https://github.com/andrepimenta/claude-code-chat)
