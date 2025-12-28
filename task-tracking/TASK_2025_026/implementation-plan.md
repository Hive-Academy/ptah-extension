# Implementation Plan: MCP Permission Prompt Tool Integration

## Task Overview

- **Task ID**: TASK_2025_026
- **Title**: Integrate Claude CLI Permission Prompt with MCP Server
- **Complexity**: High (cross-cutting: backend, frontend, IPC)
- **Estimated Effort**: 9-11 hours

---

## Phase 1: Types & Backend Infrastructure

### 1.1 Create Permission Types (shared lib)

**File**: `libs/shared/src/lib/types/permission.types.ts`

```typescript
/**
 * Permission handling types for MCP approval_prompt tool
 *
 * TASK_2025_026: MCP Permission Prompt Integration
 */

import { z } from 'zod';

/**
 * Permission request sent from MCP server to webview
 */
export interface PermissionRequest {
  /** Unique request ID (UUID) */
  readonly id: string;

  /** Tool name requesting permission (e.g., "Bash", "Write", "Read") */
  readonly toolName: string;

  /** Tool input parameters */
  readonly toolInput: Readonly<Record<string, unknown>>;

  /** Claude's tool_use_id for correlation */
  readonly toolUseId?: string;

  /** Request timestamp (Unix epoch ms) */
  readonly timestamp: number;

  /** Human-readable description of the permission request */
  readonly description: string;

  /** Timeout deadline (Unix epoch ms) */
  readonly timeoutAt: number;
}

/**
 * Permission response sent from webview to MCP server
 */
export interface PermissionResponse {
  /** Must match request ID */
  readonly id: string;

  /** User's decision */
  readonly decision: 'allow' | 'deny' | 'always_allow';

  /** Optional reason (typically for deny) */
  readonly reason?: string;
}

/**
 * Permission rule for "Always Allow" patterns
 */
export interface PermissionRule {
  /** Rule ID */
  readonly id: string;

  /** Pattern to match (e.g., "Bash:npm*", "Write:src/**") */
  readonly pattern: string;

  /** Tool name this rule applies to */
  readonly toolName: string;

  /** Action when pattern matches */
  readonly action: 'allow' | 'deny';

  /** Created timestamp */
  readonly createdAt: number;

  /** Optional description */
  readonly description?: string;
}

// Zod schemas for runtime validation
export const PermissionRequestSchema = z.object({
  id: z.string().uuid(),
  toolName: z.string().min(1),
  toolInput: z.record(z.string(), z.unknown()),
  toolUseId: z.string().optional(),
  timestamp: z.number(),
  description: z.string(),
  timeoutAt: z.number(),
});

export const PermissionResponseSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(['allow', 'deny', 'always_allow']),
  reason: z.string().optional(),
});

export const PermissionRuleSchema = z.object({
  id: z.string().uuid(),
  pattern: z.string().min(1),
  toolName: z.string().min(1),
  action: z.enum(['allow', 'deny']),
  createdAt: z.number(),
  description: z.string().optional(),
});
```

**Tasks**:

- [ ] Create permission.types.ts with interfaces and schemas
- [ ] Export from libs/shared/src/index.ts

---

### 1.2 Create Permission Prompt Service

**File**: `libs/backend/vscode-lm-tools/src/lib/permission/permission-prompt.service.ts`

**Responsibilities**:

- Manage pending permission requests
- Apply "Always Allow" rules
- Handle timeouts
- Persist rules to workspace state

**Key Methods**:

```typescript
class PermissionPromptService {
  // Check if tool is pre-authorized by rules
  checkRules(toolName: string, toolInput: object): 'allow' | 'deny' | 'ask';

  // Create new permission request
  createRequest(params: ApprovalPromptParams): PermissionRequest;

  // Resolve pending request with user response
  resolveRequest(response: PermissionResponse): void;

  // Add "Always Allow" rule
  addRule(rule: PermissionRule): void;

  // Get all rules
  getRules(): PermissionRule[];
}
```

**Tasks**:

- [ ] Create permission-prompt.service.ts
- [ ] Inject Logger and ExtensionContext (for workspace state)
- [ ] Implement rule storage and matching
- [ ] Add to DI container

---

### 1.3 Enhance MCP Server with approval_prompt Tool

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts`

**Changes**:

1. Add `approval_prompt` to tool list
2. Implement `handleApprovalPrompt()` method
3. Wire permission response handling

```typescript
// In handleToolsList - add second tool
const tools = [
  this.getExecuteCodeTool(),
  this.getApprovalPromptTool(),  // NEW
];

// New method
private getApprovalPromptTool(): MCPToolDefinition {
  return {
    name: 'approval_prompt',
    description: 'Request user permission to execute a tool via VS Code dialog',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'Name of the tool requesting permission',
        },
        input: {
          type: 'object',
          description: 'Input parameters for the tool',
        },
        tool_use_id: {
          type: 'string',
          description: 'Unique tool use request ID',
        },
      },
      required: ['tool_name', 'input'],
    },
  };
}

// In handleToolsCall - route to approval_prompt
if (name === 'approval_prompt') {
  return await this.handleApprovalPrompt(request, args as ApprovalPromptParams);
}
```

**Tasks**:

- [ ] Add approval_prompt tool definition
- [ ] Implement handleApprovalPrompt method
- [ ] Inject PermissionPromptService and WebviewManager
- [ ] Add permission response handler method

---

### 1.4 Add MCP Types

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`

```typescript
/**
 * Parameters for approval_prompt MCP tool
 */
export interface ApprovalPromptParams {
  tool_name: string;
  input: Record<string, unknown>;
  tool_use_id?: string;
}
```

**Tasks**:

- [ ] Add ApprovalPromptParams interface

---

## Phase 2: CLI Integration

### 2.1 Update Claude Process Arguments

**File**: `libs/backend/claude-domain/src/cli/claude-process.ts`

**Changes** in `buildArgs()`:

```typescript
private buildArgs(options?: ClaudeProcessOptions): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
  ];

  // Add permission prompt tool
  args.push('--permission-prompt-tool', 'mcp__ptah__approval_prompt');

  // Update allowed tools
  const allowedTools = new Set<string>([
    'mcp__ptah',
    'mcp__ptah__approval_prompt',
  ]);
  if (options?.allowedTools) {
    options.allowedTools.forEach((tool) => allowedTools.add(tool));
  }
  args.push('--allowedTools', Array.from(allowedTools).join(','));

  // ... rest of args
  return args;
}
```

**Tasks**:

- [ ] Add --permission-prompt-tool flag
- [ ] Ensure mcp**ptah**approval_prompt in allowedTools

---

## Phase 3: Extension-to-Webview Communication

### 3.1 Add Message Types

**File**: `libs/shared/src/lib/types/messages.ts` (or similar)

```typescript
// Add to MessagePayloadMap
'permission:request': PermissionRequest;
'permission:response': PermissionResponse;
```

**Tasks**:

- [ ] Add permission message types to shared lib

---

### 3.2 Wire Extension Message Handler

**File**: `apps/ptah-extension-vscode/src/handlers/` (create new handler or extend existing)

**Responsibilities**:

- Listen for `permission:response` messages from webview
- Route to PermissionPromptService.resolveRequest()

```typescript
// In webview message handler
case 'permission:response':
  const response = payload as PermissionResponse;
  this.permissionPromptService.resolveRequest(response);
  break;
```

**Tasks**:

- [ ] Add message handler for permission:response
- [ ] Inject PermissionPromptService

---

### 3.3 Wire Webview Notification

**Location**: MCP Server → WebviewManager

When a permission request arrives, the MCP server needs to notify the webview:

```typescript
// In CodeExecutionMCP.handleApprovalPrompt
this.webviewManager.postMessage({
  type: 'permission:request',
  payload: permissionRequest,
});
```

**Tasks**:

- [ ] Inject WebviewManager into CodeExecutionMCP
- [ ] Post permission:request message to webview

---

## Phase 4: Frontend UI

### 4.1 Create Permission Request Card Component

**File**: `libs/frontend/chat/src/lib/components/molecules/permission-request-card.component.ts`

**Design**:

- Alert-style card (warning color)
- Shows: Tool name, description, timeout countdown
- Buttons: Allow, Always Allow, Deny
- Signals: input for PermissionRequest, output for response

```typescript
@Component({
  selector: 'ptah-permission-request-card',
  template: `
    <div class="alert alert-warning">
      <div class="flex items-start gap-3">
        <lucide-angular [img]="ShieldAlertIcon" class="w-6 h-6" />
        <div class="flex-1">
          <h4 class="font-semibold">Permission Required</h4>
          <p class="text-sm">{{ request().description }}</p>
          <div class="text-xs opacity-70 mt-1">Tool: {{ request().toolName }} | Expires in {{ remainingTime() }}</div>
        </div>
      </div>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-success btn-sm" (click)="respond('allow')">Allow</button>
        <button class="btn btn-info btn-sm" (click)="respond('always_allow')">Always Allow</button>
        <button class="btn btn-error btn-sm" (click)="respond('deny')">Deny</button>
      </div>
    </div>
  `,
})
export class PermissionRequestCardComponent {
  readonly request = input.required<PermissionRequest>();
  readonly responded = output<PermissionResponse>();

  // ... countdown timer logic
}
```

**Tasks**:

- [ ] Create PermissionRequestCardComponent
- [ ] Add countdown timer for timeout
- [ ] Style with DaisyUI classes

---

### 4.2 Update ChatStore for Permission Requests

**File**: `libs/frontend/chat/src/lib/stores/chat.store.ts`

**Add**:

```typescript
// New signals
private readonly _permissionRequests = signal<PermissionRequest[]>([]);
readonly permissionRequests = this._permissionRequests.asReadonly();

// Handle incoming permission request
handlePermissionRequest(request: PermissionRequest): void {
  this._permissionRequests.update(requests => [...requests, request]);
}

// Handle user response
handlePermissionResponse(response: PermissionResponse): void {
  // Remove from pending
  this._permissionRequests.update(requests =>
    requests.filter(r => r.id !== response.id)
  );
  // Send to backend
  this.vscode.postMessage({ type: 'permission:response', payload: response });
}
```

**Tasks**:

- [ ] Add permissionRequests signal
- [ ] Handle permission:request message from backend
- [ ] Handle user response and send back

---

### 4.3 Integrate into Chat UI

**File**: `libs/frontend/chat/src/lib/components/organisms/chat-panel.component.ts`

**Add** permission request display (above message input):

```html
@for (request of chatStore.permissionRequests(); track request.id) {
<ptah-permission-request-card [request]="request" (responded)="chatStore.handlePermissionResponse($event)" />
}
```

**Tasks**:

- [ ] Add PermissionRequestCardComponent import
- [ ] Render permission requests in chat panel
- [ ] Position above input area (visible during streaming)

---

## Phase 5: Testing & Edge Cases

### 5.1 Unit Tests

**Permission Prompt Service**:

- [ ] Rule matching logic
- [ ] Timeout handling
- [ ] Multiple concurrent requests

**MCP Server**:

- [ ] approval_prompt tool registration
- [ ] Response formatting

### 5.2 Integration Tests

- [ ] Full flow: MCP request → webview → response → MCP response
- [ ] Timeout scenario
- [ ] Always Allow rule persistence

### 5.3 Edge Cases to Handle

- [ ] **Timeout**: Auto-deny after 5 minutes
- [ ] **Extension restart**: Clear pending requests
- [ ] **Multiple requests**: Queue display, process in order
- [ ] **Webview closed**: Deny all pending requests
- [ ] **Invalid response**: Log error, deny

---

## File Changes Summary

### New Files

| File                                                                                   | Purpose            |
| -------------------------------------------------------------------------------------- | ------------------ |
| `libs/shared/src/lib/types/permission.types.ts`                                        | Type definitions   |
| `libs/backend/vscode-lm-tools/src/lib/permission/permission-prompt.service.ts`         | Request management |
| `libs/frontend/chat/src/lib/components/molecules/permission-request-card.component.ts` | UI component       |

### Modified Files

| File                                                                                | Changes                           |
| ----------------------------------------------------------------------------------- | --------------------------------- |
| `libs/shared/src/index.ts`                                                          | Export permission types           |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`                      | Add ApprovalPromptParams          |
| `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts` | Add approval_prompt tool          |
| `libs/backend/claude-domain/src/cli/claude-process.ts`                              | Add --permission-prompt-tool flag |
| `libs/frontend/chat/src/lib/stores/chat.store.ts`                                   | Add permission state              |
| `libs/frontend/chat/src/lib/components/organisms/chat-panel.component.ts`           | Render permission cards           |

---

## Dependencies Between Phases

```
Phase 1 (Types) ──┬──► Phase 2 (CLI)
                  │
                  └──► Phase 3 (Communication) ──► Phase 4 (Frontend)
                                                        │
                                                        ▼
                                                  Phase 5 (Testing)
```

**Critical Path**: Phase 1 → Phase 3 → Phase 4

---

## Success Criteria

1. **CLI Integration**: Claude CLI with `--permission-prompt-tool` correctly calls our MCP server
2. **Permission Request Display**: Request appears in chat UI with tool details
3. **User Response**: Allow/Deny buttons work and return correct response to CLI
4. **Always Allow**: Rules persist and auto-approve matching requests
5. **Timeout**: Pending requests auto-deny after timeout
6. **Error Handling**: Graceful degradation on failures

---

## Risk Mitigation

| Risk                               | Mitigation                                        |
| ---------------------------------- | ------------------------------------------------- |
| MCP tool not discovered            | Verify .mcp.json format and tool naming           |
| Response format rejected           | Test with claude --verbose to see expected format |
| Webview not receiving message      | Add debug logging at each IPC boundary            |
| Concurrent requests race condition | Use Map with request ID as key                    |
| Permission UI not visible          | Float above other content with z-index            |
