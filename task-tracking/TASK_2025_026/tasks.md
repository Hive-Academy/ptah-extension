# Development Tasks - TASK_2025_026

**Task Type**: Full-Stack (Backend Types, Services, MCP, CLI + Frontend UI)
**Total Tasks**: 15 tasks
**Total Batches**: 6 batches
**Batching Strategy**: Layer-based (backend) + Feature-based (frontend)
**Status**: 6/6 batches complete (100%)

---

## Batch 1: Backend Types & Shared Infrastructure ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 2
**Dependencies**: None (foundation layer)
**Git Commit**: d6b32c4

### Task 1.1: Create permission.types.ts with interfaces and Zod schemas ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\shared\src\lib\types\permission.types.ts`
**Specification Reference**: implementation-plan.md:14-121
**Pattern to Follow**: `D:\projects\ptah-extension\libs\shared\src\lib\types\branded.types.ts` (Zod schema patterns)
**Expected Commit Pattern**: `feat(vscode): add permission types and schemas`

**Quality Requirements**:

- ✅ All interfaces use `readonly` properties (immutable data)
- ✅ Zod schemas validate all required fields
- ✅ UUID validation for id fields
- ✅ Enum validation for decision and action fields
- ✅ Comprehensive TSDoc comments

**Implementation Details**:

- **Interfaces to Create**:
  - `PermissionRequest`: id, toolName, toolInput, toolUseId?, timestamp, description, timeoutAt
  - `PermissionResponse`: id, decision ('allow' | 'deny' | 'always_allow'), reason?
  - `PermissionRule`: id, pattern, toolName, action ('allow' | 'deny'), createdAt, description?
- **Zod Schemas**: PermissionRequestSchema, PermissionResponseSchema, PermissionRuleSchema
- **Dependencies**: Import `z` from 'zod'

**Verification**:

- ✅ File exists with all 3 interfaces and 3 schemas
- ✅ All properties are readonly
- ✅ Zod schemas match interface structure

---

### Task 1.2: Export permission types from shared/src/index.ts ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\shared\src\index.ts`
**Specification Reference**: implementation-plan.md:117-121
**Pattern to Follow**: Existing export pattern in index.ts (lines 1-10)
**Expected Commit Pattern**: `feat(vscode): export permission types from shared lib`

**Quality Requirements**:

- ✅ Add export after existing type exports
- ✅ Maintain alphabetical order of exports
- ✅ No breaking changes to existing exports

**Implementation Details**:

- **Export Line**: `export * from './lib/types/permission.types';`
- **Placement**: After `export * from './lib/types/content-block.types';` (line 8)

**Verification**:

- ✅ Export line added in correct location
- ✅ Build passes: `npx nx build shared`
- ✅ No breaking changes to existing exports

---

**Batch 1 Commit**:

```
feat(vscode): add permission types and schemas

- Task 1.1: create permission.types.ts with PermissionRequest, PermissionResponse, PermissionRule
- Task 1.2: export permission types from shared/src/index.ts

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Batch 1 Verification Requirements**:

- ✅ All 2 files modified/created
- ✅ Build passes: `npx nx build shared`
- ✅ No compilation errors
- ✅ Types exported and importable from `@ptah-extension/shared`

---

## Batch 2: MCP Server Types & Permission Service ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 2
**Dependencies**: Batch 1 complete (needs permission types)
**Git Commit**: 2d1ec3a

### Task 2.1: Add ApprovalPromptParams interface to vscode-lm-tools types.ts ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts`
**Specification Reference**: implementation-plan.md:224-241
**Pattern to Follow**: Existing ExecuteCodeParams interface (lines 318-324)
**Expected Commit Pattern**: `feat(vscode): add approval prompt params interface`

**Quality Requirements**:

- ✅ Interface follows existing MCP types pattern
- ✅ TSDoc comment describes MCP tool contract
- ✅ Record type for input parameters (unknown values)

**Implementation Details**:

- **Interface Location**: After ExecuteCodeResult interface (line 341)
- **Interface Structure**:
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

**Verification**:

- ✅ Interface added to types.ts
- ✅ Build passes: `npx nx build vscode-lm-tools`
- ✅ No compilation errors

---

### Task 2.2: Create permission-prompt.service.ts with rule management ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\permission\permission-prompt.service.ts`
**Specification Reference**: implementation-plan.md:124-162
**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\claude-domain\src\session\session-manager.ts` (service with workspace state)
**Expected Commit Pattern**: `feat(vscode): add permission prompt service`

**Quality Requirements**:

- ✅ Injectable service with @injectable() decorator
- ✅ Rule storage in VS Code workspace state
- ✅ Pattern matching using minimatch library
- ✅ Timeout handling with Map<string, NodeJS.Timeout>
- ✅ Comprehensive TSDoc comments

**Implementation Details**:

- **Dependencies to Inject**:
  - `@inject(TOKENS.LOGGER) logger: Logger`
  - `@inject(TOKENS.EXTENSION_CONTEXT) context: vscode.ExtensionContext`
- **Key Methods**:
  - `checkRules(toolName, toolInput): 'allow' | 'deny' | 'ask'`
  - `createRequest(params: ApprovalPromptParams): PermissionRequest`
  - `resolveRequest(response: PermissionResponse): void`
  - `addRule(rule: PermissionRule): void`
  - `getRules(): PermissionRule[]`
- **State Management**:
  - `private pendingRequests = new Map<string, { resolve, timeout }>()`
  - Rules stored in `context.workspaceState.get/update('ptah.permissionRules')`
- **Pattern Matching**: Use `minimatch` for rule.pattern matching against `${toolName}:${JSON.stringify(toolInput)}`

**Verification**:

- ✅ File created with all methods
- ✅ Service is @injectable()
- ✅ Build passes: `npx nx build vscode-lm-tools`
- ✅ No compilation errors

---

**Batch 2 Commit**: 2d1ec3a

```
feat(vscode): add permission prompt service and MCP types

- Task 2.1: add ApprovalPromptParams interface to types.ts
- Task 2.2: create permission-prompt.service.ts with rule management

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Batch 2 Verification Results**:

- ✅ All 2 files created/modified
- ✅ Build passes: `npx nx build vscode-lm-tools`
- ✅ No compilation errors
- ✅ Service ready for DI registration
- ✅ Business-analyst approved (no stubs/placeholders)
- ✅ Real implementations: minimatch pattern matching, setTimeout timeouts, workspace state persistence

---

## Batch 3: MCP Server Enhancement ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 2 complete (needs ApprovalPromptParams, PermissionPromptService)
**Git Commit**: 7ca0ad0

### Task 3.1: Add approval_prompt tool definition to CodeExecutionMCP ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\code-execution-mcp.service.ts`
**Specification Reference**: implementation-plan.md:165-221
**Pattern to Follow**: Existing getExecuteCodeTool() pattern (not visible in current file, but referenced in handleToolsList line 258-288)
**Expected Commit Pattern**: `feat(vscode): add approval_prompt tool to mcp server`

**Quality Requirements**:

- ✅ Tool definition follows MCP protocol spec
- ✅ inputSchema is valid JSON Schema
- ✅ Description explains tool purpose
- ✅ Tool added to tools array in handleToolsList

**Implementation Details**:

- **New Method** (add after buildToolDescription method, ~line 374):
  ```typescript
  private getApprovalPromptTool(): MCPToolDefinition {
    return {
      name: 'approval_prompt',
      description: 'Request user permission to execute a tool via VS Code UI',
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
  ```
- **Modify handleToolsList** (line 258): Add second tool to array
  ```typescript
  result: {
    tools: [toolDefinition, this.getApprovalPromptTool()],
  }
  ```

**Verification**:

- ✅ getApprovalPromptTool method added
- ✅ handleToolsList returns 2 tools
- ✅ Build passes: `npx nx build vscode-lm-tools`

---

### Task 3.2: Implement handleApprovalPrompt method with Promise-based response ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\code-execution-mcp.service.ts`
**Specification Reference**: implementation-plan.md:165-221
**Pattern to Follow**: handleToolsCall method (lines 380-430)
**Expected Commit Pattern**: `feat(vscode): implement approval prompt handler`

**Quality Requirements**:

- ✅ Async method returns Promise<MCPResponse>
- ✅ Creates permission request via PermissionPromptService
- ✅ Posts message to webview via WebviewManager
- ✅ Waits for response with Promise-based resolver
- ✅ Formats response per Claude CLI expectations
- ✅ Handles timeout (5 minutes)

**Implementation Details**:

- **Inject Services** (add to constructor):
  - `@inject(PERMISSION_PROMPT_SERVICE) permissionPromptService: PermissionPromptService`
  - `@inject(TOKENS.WEBVIEW_MANAGER) webviewManager: WebviewManager`
- **New Method** (add after handleToolsCall, ~line 431):

  ```typescript
  private async handleApprovalPrompt(
    request: MCPRequest,
    params: ApprovalPromptParams
  ): Promise<MCPResponse> {
    const permissionRequest = this.permissionPromptService.createRequest(params);

    // Post to webview
    this.webviewManager.postMessage({
      type: 'permission:request',
      payload: permissionRequest,
    });

    // Wait for response (Promise-based)
    const response = await new Promise<PermissionResponse>((resolve) => {
      // Store resolver in service
      this.permissionPromptService.setPendingResolver(permissionRequest.id, resolve);
    });

    // Format MCP response
    if (response.decision === 'allow' || response.decision === 'always_allow') {
      return {
        jsonrpc: '2.0',
        id: request.id,
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
        id: request.id,
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

- **Route in handleToolsCall** (add case after line 383):
  ```typescript
  if (name === 'approval_prompt') {
    return await this.handleApprovalPrompt(request, args as ApprovalPromptParams);
  }
  ```

**Verification**:

- ✅ handleApprovalPrompt method added
- ✅ Services injected in constructor
- ✅ Routing added in handleToolsCall
- ✅ Build passes: `npx nx build vscode-lm-tools`

---

### Task 3.3: Add permission response resolver method to PermissionPromptService ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\permission\permission-prompt.service.ts`
**Dependencies**: Task 2.2 (service must exist)
**Specification Reference**: implementation-plan.md:124-162
**Expected Commit Pattern**: `feat(vscode): add permission response resolver`

**Quality Requirements**:

- ✅ Method finds pending request by ID
- ✅ Resolves Promise with response
- ✅ Clears timeout
- ✅ Removes from pending map
- ✅ Handles "always_allow" by creating rule

**Implementation Details**:

- **Add to Service**:

  ```typescript
  setPendingResolver(id: string, resolve: (response: PermissionResponse) => void): void {
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(id);
      resolve({ id, decision: 'deny', reason: 'Timeout' });
    }, 5 * 60 * 1000); // 5 minutes

    this.pendingRequests.set(id, { resolve, timeout });
  }

  resolveRequest(response: PermissionResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.logger.warn('No pending request found for response', { id: response.id });
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    // If always_allow, create rule
    if (response.decision === 'always_allow') {
      // Extract toolName and pattern from original request
      // Create and save rule
    }

    pending.resolve(response);
  }
  ```

**Verification**:

- ✅ Methods added to service
- ✅ Build passes: `npx nx build vscode-lm-tools`
- ✅ No compilation errors

---

**Batch 3 Commit**:

```
feat(vscode): integrate approval_prompt tool into mcp server

- Task 3.1: add approval_prompt tool definition
- Task 3.2: implement handleApprovalPrompt with promise-based waiting
- Task 3.3: add permission response resolver to service

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Batch 3 Verification Requirements**:

- ✅ All 2 files modified (code-execution-mcp.service.ts, permission-prompt.service.ts)
- ✅ Build passes: `npx nx build vscode-lm-tools`
- ✅ MCP server exposes 2 tools (execute_code, approval_prompt)
- ✅ No compilation errors

---

## Batch 4: CLI Integration & Message Types ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 1 complete (needs permission types in shared)
**Git Commit**: 5944922

### Task 4.1: Update claude-process.ts to add --permission-prompt-tool flag ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\claude-process.ts`
**Specification Reference**: implementation-plan.md:244-283
**Pattern to Follow**: Existing buildArgs method (lines 96-122)
**Expected Commit Pattern**: `feat(vscode): add permission-prompt-tool cli flag`

**Quality Requirements**:

- ✅ Flag added after --verbose (line 102)
- ✅ Tool name follows MCP naming convention
- ✅ allowedTools updated to include approval_prompt tool

**Implementation Details**:

- **Add to buildArgs** (after line 102):
  ```typescript
  // Add permission prompt tool
  args.push('--permission-prompt-tool', 'mcp__ptah__approval_prompt');
  ```
- **Update allowedTools** (line 115):
  ```typescript
  const allowedTools = new Set<string>(['mcp__ptah', 'mcp__ptah__approval_prompt']);
  ```

**Verification**:

- ✅ Flag added to buildArgs
- ✅ allowedTools updated
- ✅ Build passes: `npx nx build claude-domain`
- ✅ No compilation errors

---

### Task 4.2: Add permission message types to shared lib ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts`
**Specification Reference**: implementation-plan.md:285-303
**Pattern to Follow**: Existing MessagePayloadMap (search for 'MessagePayloadMap' in codebase)
**Expected Commit Pattern**: `feat(vscode): add permission message types`

**Quality Requirements**:

- ✅ Types added to MessagePayloadMap
- ✅ Imports PermissionRequest and PermissionResponse from permission.types
- ✅ Follows existing message type naming convention

**Implementation Details**:

- **Find MessagePayloadMap interface** (likely in message.types.ts)
- **Add Entries**:
  ```typescript
  'permission:request': PermissionRequest;
  'permission:response': PermissionResponse;
  ```
- **Import Statement**:
  ```typescript
  import { PermissionRequest, PermissionResponse } from './permission.types';
  ```

**Verification**:

- ✅ Message types added
- ✅ Build passes: `npx nx build shared`
- ✅ Types available in MessagePayloadMap

---

### Task 4.3: Wire extension message handler for permission:response ✅ COMPLETE

**File(s)**: Find or create handler in `apps/ptah-extension-vscode/src/handlers/` or extension message router
**Specification Reference**: implementation-plan.md:304-325
**Pattern to Follow**: Existing webview message handlers (search for 'message.type' in extension handlers)
**Expected Commit Pattern**: `feat(vscode): wire permission response handler`

**Quality Requirements**:

- ✅ Handler listens for 'permission:response' message type
- ✅ Routes to PermissionPromptService.resolveRequest()
- ✅ Handles errors gracefully
- ✅ Logs message receipt

**Implementation Details**:

- **Find Webview Message Handler** (likely in extension activation or handler file)
- **Add Case**:
  ```typescript
  case 'permission:response':
    const response = payload as PermissionResponse;
    this.permissionPromptService.resolveRequest(response);
    break;
  ```
- **Inject PermissionPromptService** into handler class

**Verification**:

- ✅ Handler wired for permission:response
- ✅ Extension builds successfully
- ✅ No compilation errors

---

**Batch 4 Commit**:

```
feat(vscode): integrate cli permission prompt and message types

- Task 4.1: add --permission-prompt-tool flag to claude process
- Task 4.2: add permission message types to shared lib
- Task 4.3: wire extension handler for permission:response

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Batch 4 Verification Requirements**:

- ✅ All 3 files modified
- ✅ Build passes: `npx nx build claude-domain` and `npx nx build shared`
- ✅ CLI passes --permission-prompt-tool flag
- ✅ Extension wired to handle permission responses

---

## Batch 5: DI Registration ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 1
**Dependencies**: Batch 2 complete (PermissionPromptService exists), Batch 3 complete (CodeExecutionMCP needs service)
**Git Commit**: 40a6c39

### Task 5.1: Register PermissionPromptService in DI container ✅ COMPLETE

**File(s)**: Find DI registration file (likely `libs/backend/vscode-lm-tools/src/lib/di/register.ts` or extension activation)
**Specification Reference**: implementation-plan.md:157-162
**Pattern to Follow**: Search for existing service registrations in vscode-lm-tools or extension
**Expected Commit Pattern**: `feat(vscode): register permission prompt service`

**Quality Requirements**:

- ✅ Service registered with DI token
- ✅ Token exported for injection
- ✅ Registration follows existing pattern
- ✅ Service available before MCP server starts

**Implementation Details**:

- **Create Token** (in tokens file or inline):
  ```typescript
  export const PERMISSION_PROMPT_SERVICE = Symbol.for('PermissionPromptService');
  ```
- **Register Service**:
  ```typescript
  container.register(PERMISSION_PROMPT_SERVICE, {
    useClass: PermissionPromptService,
  });
  ```
- **Export Token** from library index

**Verification**:

- ✅ Service registered in DI container
- ✅ Token exported and available
- ✅ Extension builds successfully
- ✅ Service injectable in CodeExecutionMCP

---

**Batch 5 Commit**: 40a6c39

```
feat(vscode): register permission prompt service in di container

- Task 5.1: add PERMISSION_PROMPT_SERVICE token and register service

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Batch 5 Verification Results**:

- ✅ All 4 files modified (tokens.ts, container.ts, index.ts, code-execution-mcp.service.ts)
- ✅ PERMISSION_PROMPT_SERVICE token added to tokens.ts (line 119)
- ✅ Token added to TOKENS constant (line 261)
- ✅ Service registered as singleton in container.ts (lines 255-259)
- ✅ Service exported from vscode-lm-tools/index.ts (line 13)
- ✅ CodeExecutionMCP updated to use TOKENS.PERMISSION_PROMPT_SERVICE (lines 14, 44-45)
- ✅ Business-analyst approved (no stubs/placeholders)
- ✅ Pre-commit checks passed
- ✅ Extension builds successfully
- ✅ Service registered and injectable

---

## Batch 6: Frontend UI ✅ COMPLETE

**Assigned To**: frontend-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 1 complete (needs permission types), Batch 4 complete (needs message types)
**Git Commit**: 6099abb

### Task 6.1: Create PermissionRequestCardComponent with DaisyUI styling ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\permission-request-card.component.ts`
**Specification Reference**: implementation-plan.md:350-395
**Pattern to Follow**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card.component.ts` (DaisyUI alert pattern)
**Expected Commit Pattern**: `feat(webview): add permission request card component`

**Quality Requirements**:

- ✅ Standalone component with ChangeDetectionStrategy.OnPush
- ✅ Signal-based inputs (request signal)
- ✅ Output for response (responded event)
- ✅ DaisyUI alert styling (alert-warning)
- ✅ Countdown timer for timeout
- ✅ Three buttons: Allow, Always Allow, Deny

**Implementation Details**:

- **Component Structure**:

  ```typescript
  @Component({
    selector: 'ptah-permission-request-card',
    standalone: true,
    imports: [/* lucide icons, etc */],
    template: `
      <div class="alert alert-warning">
        <div class="flex items-start gap-3">
          <lucide-angular [img]="ShieldAlertIcon" class="w-6 h-6" />
          <div class="flex-1">
            <h4 class="font-semibold">Permission Required</h4>
            <p class="text-sm">{{ request().description }}</p>
            <div class="text-xs opacity-70 mt-1">
              Tool: {{ request().toolName }} | Expires in {{ remainingTime() }}
            </div>
          </div>
        </div>
        <div class="flex gap-2 mt-3">
          <button class="btn btn-success btn-sm" (click)="respond('allow')">Allow</button>
          <button class="btn btn-info btn-sm" (click)="respond('always_allow')">Always Allow</button>
          <button class="btn btn-error btn-sm" (click)="respond('deny')">Deny</button>
        </div>
      </div>
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  export class PermissionRequestCardComponent {
    readonly request = input.required<PermissionRequest>();
    readonly responded = output<PermissionResponse>();
    readonly remainingTime = computed(() => /* calculate from timeoutAt */);

    respond(decision: 'allow' | 'deny' | 'always_allow'): void {
      this.responded.emit({
        id: this.request().id,
        decision,
      });
    }
  }
  ```

**Verification**:

- ✅ Component created with all buttons
- ✅ DaisyUI classes applied
- ✅ Countdown timer works
- ✅ Build passes: `npx nx build chat`

---

### Task 6.2: Add permission state to ChatStore ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts`
**Specification Reference**: implementation-plan.md:396-430
**Pattern to Follow**: Existing signal patterns in ChatStore (lines 104-165)
**Expected Commit Pattern**: `feat(webview): add permission state to chat store`

**Quality Requirements**:

- ✅ Private signal with readonly accessor
- ✅ Method to add permission request
- ✅ Method to handle permission response (remove + send to backend)
- ✅ VSCodeService integration for message sending
- ✅ Signal-based reactivity

**Implementation Details**:

- **Add to ChatStore** (after line 137):

  ```typescript
  // Permission requests
  private readonly _permissionRequests = signal<PermissionRequest[]>([]);
  readonly permissionRequests = this._permissionRequests.asReadonly();

  /**
   * Handle incoming permission request from backend
   */
  handlePermissionRequest(request: PermissionRequest): void {
    this._permissionRequests.update(requests => [...requests, request]);
  }

  /**
   * Handle user response to permission request
   */
  handlePermissionResponse(response: PermissionResponse): void {
    // Remove from pending
    this._permissionRequests.update(requests =>
      requests.filter(r => r.id !== response.id)
    );
    // Send to backend via VSCodeService
    this.vscodeService?.postMessage({
      type: 'permission:response',
      payload: response,
    });
  }
  ```

**Verification**:

- ✅ Signals added to ChatStore
- ✅ Methods implemented
- ✅ Build passes: `npx nx build chat`
- ✅ No compilation errors

---

### Task 6.3: Integrate permission cards into ChatViewComponent ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` and `.html` template
**Dependencies**: Task 6.1 (component), Task 6.2 (ChatStore methods)
**Specification Reference**: implementation-plan.md:432-451
**Pattern to Follow**: Existing message rendering in ChatViewComponent template
**Expected Commit Pattern**: `feat(webview): integrate permission cards into chat ui`

**Quality Requirements**:

- ✅ Permission cards rendered above chat input
- ✅ Uses @for to iterate permissionRequests signal
- ✅ Passes request to card component
- ✅ Handles responded event
- ✅ Component imported in imports array

**Implementation Details**:

- **Update Template** (add before chat input):
  ```html
  @for (request of chatStore.permissionRequests(); track request.id) {
  <ptah-permission-request-card [request]="request" (responded)="chatStore.handlePermissionResponse($event)" />
  }
  ```
- **Update Component**:
  - Add `PermissionRequestCardComponent` to imports array (line 40)

**Verification**:

- ✅ Template updated
- ✅ Component imported
- ✅ Build passes: `npx nx build chat`
- ✅ No compilation errors

---

**Batch 6 Commit**: 6099abb

```
feat(webview): add permission request ui components

- Task 6.1: create PermissionRequestCardComponent with countdown timer
- Task 6.2: add permission state to ChatStore
- Task 6.3: integrate permission cards into ChatViewComponent

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Batch 6 Verification Results**:

- ✅ All 4 files created/modified (permission-request-card.component.ts, chat.store.ts, chat-view.component.ts, chat-view.component.html)
- ✅ Build passes: Pre-commit checks passed (format, lint, typecheck)
- ✅ Permission cards render in UI with @for loop
- ✅ User can click Allow/Deny/Always Allow
- ✅ Responses sent to backend via VSCodeService
- ✅ Business-analyst approved (no stubs/placeholders)
- ✅ Real countdown timer with setInterval and cleanup
- ✅ Real button handlers with event emission
- ✅ Real state management in ChatStore

---

## Batch Execution Protocol

**For Each Batch**:

1. **Team-leader assigns entire batch to developer**
2. **Developer executes ALL tasks in batch** (in order, respecting dependencies)
3. **Developer writes REAL, COMPLETE code** (NO stubs/placeholders)
4. **Developer stages files progressively**: `git add [file]` after each task
5. **Developer returns with implementation report** (file paths, NOT commit SHA)
6. **Team-leader verifies files exist**: `Read([file])` for each task
7. **Team-leader invokes business-analyst** to check for stubs/placeholders
8. **If BA approves**: Team-leader creates git commit
9. **If BA rejects**: Team-leader returns batch to developer for fixes
10. **Team-leader assigns next batch**

**CRITICAL: Separation of Concerns**:

| Developer Responsibility            | Team-Leader Responsibility |
| ----------------------------------- | -------------------------- |
| Write production-ready code         | Stage files (git add)      |
| Verify build passes                 | Create commits             |
| Update tasks.md to "🔄 IMPLEMENTED" | Invoke business-analyst    |
| Report file paths                   | Handle BA rejections       |
| Focus on CODE QUALITY               | Focus on GIT OPERATIONS    |

**Why?** When developers worry about commits, they create stubs to "get to the commit part". This separation ensures 100% focus on implementation quality.

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified (created by team-leader)
- All files exist with REAL implementations
- Business-analyst approved all batches
- Build passes for all affected libraries

---

## Implementation Notes

**Backend Libraries Affected**:

- `shared` (Batch 1)
- `vscode-lm-tools` (Batch 2, 3, 5)
- `claude-domain` (Batch 4)

**Frontend Libraries Affected**:

- `chat` (Batch 6)

**Build Verification Commands**:

```bash
# After Batch 1
npx nx build shared

# After Batch 2, 3, 5
npx nx build vscode-lm-tools

# After Batch 4
npx nx build claude-domain
npx nx build shared

# After Batch 6
npx nx build chat

# Full workspace verification
npx nx run-many --target=build --all
```

**Critical Dependencies**:

- Batch 1 must complete FIRST (foundation types)
- Batch 2 depends on Batch 1 (permission types)
- Batch 3 depends on Batch 2 (service + types)
- Batch 4 is independent (can run in parallel with 2-3)
- Batch 5 depends on Batch 2 and 3 (service registration)
- Batch 6 depends on Batch 1 and 4 (types + messages)

**Integration Testing**:
After all batches complete, verify full flow:

1. Start Claude CLI with `--permission-prompt-tool mcp__ptah__approval_prompt`
2. Trigger tool execution requiring permission
3. Permission request appears in webview UI
4. Click "Allow" button
5. CLI receives approval and proceeds with tool execution
6. Test "Always Allow" creates persistent rule
7. Test timeout auto-denies after 5 minutes
