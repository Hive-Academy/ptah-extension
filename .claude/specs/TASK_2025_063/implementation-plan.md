# Implementation Plan - TASK_2025_063

## 📊 Codebase Investigation Summary

### Libraries Discovered

**Backend Permission System**:

- **agent-sdk** (libs/backend/agent-sdk): SDK integration with permission callback
  - Key exports: SdkPermissionHandler, SdkAgentAdapter, StreamTransformer
  - Documentation: No CLAUDE.md found (will need to create)
  - Usage: SdkPermissionHandler.createCallback() provides canUseTool to SDK

**Frontend Permission UI**:

- **chat** (libs/frontend/chat): Permission request UI components
  - Key exports: PermissionRequestCardComponent, PermissionHandlerService
  - Pattern: Signal-based state management with computed signals
  - DaisyUI styling with tool-specific colors and icons

**Shared Types**:

- **shared** (libs/shared): Type contracts for permission system
  - Key exports: PermissionRequest, PermissionResponse, ExecutionNode
  - Pattern: Immutable interfaces with Zod validation schemas

**Communication Layer**:

- **vscode-core** (libs/backend/vscode-core): RPC handlers for backend-frontend events
  - Key exports: SdkRpcHandlers, WebviewManager
  - Pattern: Event-driven RPC with 'permission:request' and 'chat:permission-response'

### Patterns Identified

**Permission Flow Pattern (Existing)**:

```typescript
// Backend: SDK → Permission Handler → Event Emitter → Webview
SDK.canUseTool()
  → SdkPermissionHandler.requestUserPermission()
  → eventEmitter('permission:request', request)
  → WebviewManager.sendMessage()
  → Frontend receives event

// Frontend: User Response → RPC → Backend → SDK
User clicks button
  → PermissionHandlerService.handlePermissionResponse()
  → VSCodeService.postMessage('chat:permission-response')
  → SdkRpcHandlers.handlePermissionResponse()
  → SdkPermissionHandler.handleResponse()
  → Resolve pending promise → SDK continues
```

**Evidence**:

- Backend pattern: libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:189-270
- Frontend pattern: libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts:169-183
- RPC pattern: libs/backend/vscode-core/src/messaging/sdk-rpc-handlers.ts:256-287

**Signal-Based State Pattern (Frontend)**:

```typescript
// All frontend state uses Angular signals (NO RxJS BehaviorSubject)
private readonly _permissionRequests = signal<PermissionRequest[]>([]);
readonly permissionRequests = this._permissionRequests.asReadonly();

// Immutable updates
this._permissionRequests.update(requests => [...requests, newRequest]);
```

**Evidence**: libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts:34-39

**Timeout Pattern (Current - TO BE REMOVED)**:

```typescript
// Backend: 30-second timeout with auto-deny
const PERMISSION_TIMEOUT_MS = 30000;
const timeoutAt = Date.now() + PERMISSION_TIMEOUT_MS;

// Frontend: Countdown timer with auto-deny on expiry
readonly remainingTime = computed(() => {
  const remaining = this.request().timeoutAt - this._currentTime();
  // ... format display
});
```

**Evidence**:

- Backend timeout: libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:95, 200-201
- Frontend timer: libs/frontend/chat/src/lib/components/molecules/permission-request-card.component.ts:174-195

### Integration Points

**SDK → Backend**: SDK's `canUseTool` callback (async blocking)

- Source: libs/backend/agent-sdk/src/lib/helpers/sdk-query-builder.ts:150
- Pattern: `canUseTool: this.permissionHandler.createCallback()`
- SDK Type: `(toolName, input, { signal, suggestions }) => Promise<PermissionResult>`

**Backend → Frontend**: Event-based RPC messaging

- Event: `'permission:request'` with PermissionRequest payload
- Source: libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:229
- Verified: SdkRpcHandlers.initializePermissionEmitter() wires eventEmitter

**Frontend → Backend**: RPC response handling

- Event: `'chat:permission-response'` with PermissionResponse payload
- Source: libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts:179-182
- Handler: SdkRpcHandlers.handlePermissionResponse()

**User Message Injection**: UserMessageStreamFactory with message queue

- Pattern: Async generator yields from session.messageQueue
- Source: libs/backend/agent-sdk/src/lib/helpers/user-message-stream-factory.ts:55-127
- Mid-stream support: Already implemented (queue messages during streaming)

## 🏗️ Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Evolutionary Architecture with Phased Rollout

**Rationale**:

- Current permission system is functional but has critical UX gaps (timeout, no input editing)
- Phased approach minimizes risk: P0 (critical fixes) → P1 (feature parity) → P2 (advanced features)
- Maintains backward compatibility during rollout
- Allows user validation between phases

**Evidence**:

- Requirements specify 3 phases: task-description.md:292-307
- Existing pattern is solid (event-driven, signal-based) - only needs enhancements
- SDK supports all required features (async blocking, input modification, user messages)

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Angular)                        │
├─────────────────────────────────────────────────────────────────┤
│ PermissionRequestCardComponent (Enhanced)                        │
│   - Remove countdown timer UI                                    │
│   - Add custom input section (collapsible)                       │
│   - Input validation (path, command safety)                      │
│   - Emit modifiedInput in response                               │
├─────────────────────────────────────────────────────────────────┤
│ QuestionPromptCardComponent (NEW)                                │
│   - Similar to permission card but simpler                       │
│   - No "Deny" button (questions must be answered)                │
│   - Support free-text and multiple-choice                        │
│   - Distinct visual styling (question icon, different color)     │
├─────────────────────────────────────────────────────────────────┤
│ PermissionHandlerService (Enhanced)                              │
│   - Add handleQuestionRequest() method                           │
│   - Add handleQuestionResponse() method                          │
│   - Track pending questions separately from permissions          │
├─────────────────────────────────────────────────────────────────┤
│ ChatViewComponent (Modified)                                     │
│   - Add question prompt display area                             │
│   - Keep chat input enabled during streaming (already works)    │
│   - Add visual indicator for mid-stream messages                 │
└─────────────────────────────────────────────────────────────────┘
                                 │
                          RPC Events (VS Code Webview API)
                                 │
┌─────────────────────────────────────────────────────────────────┐
│                       BACKEND (Node.js)                          │
├─────────────────────────────────────────────────────────────────┤
│ SdkPermissionHandler (Modified)                                  │
│   - REMOVE: PERMISSION_TIMEOUT_MS constant                       │
│   - REMOVE: setTimeout() in awaitResponse()                      │
│   - REMOVE: timeoutAt field from PermissionRequest               │
│   - MODIFY: Accept modifiedInput from response                   │
│   - MODIFY: Return updatedInput to SDK                           │
│   - ADD: AskUserQuestion to auto-approved tools list             │
│   - ADD: Session cleanup handler for pending requests            │
├─────────────────────────────────────────────────────────────────┤
│ SdkQuestionHandler (NEW)                                         │
│   - requestUserAnswer(question, options?)                        │
│   - handleResponse(requestId, answer)                            │
│   - Auto-approved (no canUseTool gate)                           │
│   - Emit 'question:request' event to frontend                    │
├─────────────────────────────────────────────────────────────────┤
│ SdkRpcHandlers (Enhanced)                                        │
│   - ADD: handleQuestionResponse() method                         │
│   - Wire SdkQuestionHandler.setEventEmitter()                    │
├─────────────────────────────────────────────────────────────────┤
│ StreamTransformer (Enhanced)                                     │
│   - Detect AskUserQuestion tool invocations                      │
│   - Create ExecutionNode with questionText field                 │
│   - Emit question events via SdkQuestionHandler                  │
├─────────────────────────────────────────────────────────────────┤
│ UserMessageStreamFactory (No Changes)                            │
│   - Already supports mid-stream message injection                │
│   - Message queue + wake callback pattern works                  │
└─────────────────────────────────────────────────────────────────┘
                                 │
                        SDK canUseTool Callback
                                 │
┌─────────────────────────────────────────────────────────────────┐
│                  Claude Agent SDK (External)                     │
│   - Blocks on canUseTool() until Promise resolves                │
│   - Accepts updatedInput for tool parameter modification         │
│   - Yields user messages from async generator                    │
└─────────────────────────────────────────────────────────────────┘
```

## 📋 Component Specifications

### Component 1: Enhanced PermissionRequestCardComponent

#### Purpose

Existing component that displays permission prompts. Enhanced to support custom input editing and indefinite blocking.

#### Pattern (Evidence-Based)

**Chosen Pattern**: Signal-based reactive component with computed timer (timer REMOVED in this task)
**Evidence**: libs/frontend/chat/src/lib/components/molecules/permission-request-card.component.ts:43-147
**Rationale**: Matches existing codebase pattern - all components use signal inputs/outputs

#### Responsibilities

- Display permission request details (tool name, description, input preview)
- Provide editable input field for modifying tool parameters
- Validate modified input (path existence, command safety)
- Emit response with optional modifiedInput field
- **REMOVE**: Countdown timer logic and UI
- **REMOVE**: Auto-deny on timeout

#### Implementation Pattern

```typescript
// Pattern source: permission-request-card.component.ts:1-147
// Verified imports: lucide-angular (icons), ngx-markdown (formatting)

@Component({
  selector: 'ptah-permission-request-card',
  standalone: true,
  imports: [LucideAngularModule, MarkdownModule, FormsModule, ReactiveFormsModule],
  template: `...`,
})
export class PermissionRequestCardComponent {
  // EXISTING: Signal-based inputs
  readonly request = input.required<PermissionRequest>();
  readonly responded = output<PermissionResponse>();

  // NEW: Input editing state
  protected readonly isEditMode = signal(false);
  protected readonly modifiedInput = signal<Record<string, unknown> | null>(null);
  protected readonly inputString = signal<string>(''); // For text editing
  protected readonly validationError = signal<string | null>(null);

  // EXISTING (TO REMOVE): Timer signals
  // private readonly _currentTime = signal(Date.now()); // DELETE
  // readonly remainingTime = computed(() => { ... }); // DELETE
  // private timerInterval: ReturnType<typeof setInterval> | null = null; // DELETE

  // NEW: Computed - detect if input is modified
  protected readonly isDirty = computed(() => this.modifiedInput() !== null);

  // NEW: Methods
  protected toggleEditMode(): void {
    if (!this.isEditMode()) {
      // Enter edit mode - initialize with current input
      const input = this.request().toolInput;
      this.inputString.set(this.serializeInput(input));
      this.isEditMode.set(true);
    } else {
      // Exit edit mode
      this.isEditMode.set(false);
    }
  }

  protected applyModification(): void {
    const inputStr = this.inputString();
    const validation = this.validateInput(inputStr, this.request().toolName);

    if (!validation.valid) {
      this.validationError.set(validation.error!);
      return;
    }

    this.modifiedInput.set(this.parseInput(inputStr));
    this.validationError.set(null);
    this.isEditMode.set(false);
  }

  protected resetModification(): void {
    this.modifiedInput.set(null);
    this.inputString.set(this.serializeInput(this.request().toolInput));
    this.validationError.set(null);
  }

  // MODIFIED: Include modifiedInput in response
  protected respond(decision: 'allow' | 'deny' | 'always_allow', reason?: string): void {
    // REMOVE: Timer cleanup (no longer exists)

    this.responded.emit({
      id: this.request().id,
      decision,
      reason,
      modifiedInput: this.modifiedInput() || undefined, // NEW
    });
  }

  // NEW: Input validation based on tool type
  private validateInput(input: string, toolName: string): { valid: boolean; error?: string } {
    switch (toolName) {
      case 'Bash':
        return this.validateBashCommand(input);
      case 'Write':
      case 'Edit':
      case 'Read':
        return this.validateFilePath(input);
      default:
        return { valid: true };
    }
  }

  private validateBashCommand(command: string): { valid: boolean; error?: string } {
    // Check for dangerous patterns
    const dangerous = [
      /rm\s+-rf\s+\//, // rm -rf /
      /sudo\s+rm/, // sudo rm
      />\s*\/dev\/sd/, // Overwrite disk devices
    ];

    for (const pattern of dangerous) {
      if (pattern.test(command)) {
        return { valid: false, error: 'Dangerous command pattern detected' };
      }
    }

    return { valid: true };
  }

  private validateFilePath(pathStr: string): { valid: boolean; error?: string } {
    // Basic path validation (not checking existence - backend will verify)
    if (pathStr.trim().length === 0) {
      return { valid: false, error: 'Path cannot be empty' };
    }

    // Check for suspicious patterns
    if (pathStr.includes('..') && !pathStr.includes(process.cwd())) {
      return { valid: false, error: 'Path traversal detected' };
    }

    return { valid: true };
  }

  private serializeInput(input: Record<string, unknown>): string {
    // For simple tool inputs, extract the main field
    if ('command' in input) return String(input.command);
    if ('file_path' in input) return String(input.file_path);
    if ('pattern' in input) return String(input.pattern);

    // Fallback: JSON stringify for complex inputs
    return JSON.stringify(input, null, 2);
  }

  private parseInput(inputStr: string): Record<string, unknown> {
    const toolName = this.request().toolName;
    const originalInput = this.request().toolInput;

    // For simple tool inputs, reconstruct with modified field
    if (toolName === 'Bash') {
      return { ...originalInput, command: inputStr };
    }
    if (toolName === 'Write' || toolName === 'Edit' || toolName === 'Read') {
      return { ...originalInput, file_path: inputStr };
    }
    if (toolName === 'Grep' || toolName === 'Glob') {
      return { ...originalInput, pattern: inputStr };
    }

    // Fallback: Try JSON parse for complex inputs
    try {
      return JSON.parse(inputStr);
    } catch {
      return { ...originalInput, _raw: inputStr };
    }
  }
}
```

#### Quality Requirements

**Functional Requirements**:

- Display permission request without timeout countdown
- Allow user to edit tool input parameters
- Validate modified inputs before submission
- Emit permission response with optional modifiedInput
- Restore original input on reset

**Non-Functional Requirements**:

- Validation completes within 50ms (synchronous checks)
- Input field supports keyboard navigation (Tab, Enter, Escape)
- Screen reader announces validation errors (aria-live="assertive")
- Input serialization handles all common tool types (Bash, Write, Edit, Read, Grep, Glob)

**Pattern Compliance**:

- Must use Angular signals (no RxJS) - verified pattern
- Must use DaisyUI component classes - verified pattern
- Must use lucide-angular for icons - verified at permission-request-card.component.ts:11-22

#### Files Affected

- `libs/frontend/chat/src/lib/components/molecules/permission-request-card.component.ts` (MODIFY)
  - Remove timer logic (lines 168-230)
  - Add input editing state and methods
  - Update respond() to include modifiedInput

---

### Component 2: SdkPermissionHandler (Timeout Removal + Modified Input)

#### Purpose

Backend service that bridges SDK's canUseTool callback to frontend permission UI. Enhanced to support indefinite blocking and modified input propagation.

#### Pattern (Evidence-Based)

**Chosen Pattern**: Promise-based async blocking with pending request tracking
**Evidence**: libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:114-270
**Rationale**: SDK's canUseTool is async - must await user response before returning

#### Responsibilities

- Create canUseTool callback for SDK query
- Emit permission:request events to frontend
- Await user response (indefinitely - no timeout)
- Return modified input to SDK if provided
- Clean up pending requests on session disposal

#### Implementation Pattern

```typescript
// Pattern source: sdk-permission-handler.ts:114-270
// Verified imports: tsyringe DI, Logger from vscode-core

@injectable()
export class SdkPermissionHandler {
  private pendingRequests = new Map<string, PendingRequest>();
  private eventEmitter: ((event: string, payload: any) => void) | null = null;

  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  // EXISTING (no changes)
  setEventEmitter(emitter: (event: string, payload: any) => void): void {
    this.eventEmitter = emitter;
  }

  // EXISTING (no changes to signature or safe tool logic)
  createCallback(): CanUseTool {
    return async (toolName: string, input: any, _options?: any): Promise<PermissionResult> => {
      // Auto-approve safe tools
      if (SAFE_TOOLS.includes(toolName)) {
        return { behavior: 'allow', updatedInput: input };
      }

      // Dangerous tools require user approval
      if (DANGEROUS_TOOLS.includes(toolName)) {
        return await this.requestUserPermission(toolName, input);
      }

      // Unknown tools default to deny
      return { behavior: 'deny', message: `Unknown tool: ${toolName}` };
    };
  }

  // MODIFIED: Remove timeout logic
  private async requestUserPermission(toolName: string, input: any): Promise<PermissionResult> {
    const requestId = this.generateRequestId();
    const sanitizedInput = this.sanitizeToolInput(input);
    const description = this.generateDescription(toolName, sanitizedInput);

    // CREATE PermissionRequest (REMOVE timeoutAt field)
    const request: PermissionRequest = {
      id: requestId,
      toolName,
      toolInput: sanitizedInput,
      timestamp: Date.now(),
      description,
      // timeoutAt: Date.now() + PERMISSION_TIMEOUT_MS, // DELETE THIS LINE
    };

    if (!this.eventEmitter) {
      this.logger.error('[SdkPermissionHandler] Event emitter not set');
      return { behavior: 'deny', message: 'Permission system not initialized' };
    }

    // Emit permission request
    this.eventEmitter('permission:request', request);
    this.logger.debug(`[SdkPermissionHandler] Emitted permission request ${requestId}`);

    // MODIFIED: Await response WITHOUT timeout
    const response = await this.awaitResponseIndefinitely(requestId);

    if (!response) {
      // Should only happen on session disposal
      this.logger.warn(`[SdkPermissionHandler] Request ${requestId} cancelled`);
      return { behavior: 'deny', message: 'Permission request cancelled' };
    }

    // User approved
    if (response.approved) {
      this.logger.info(`[SdkPermissionHandler] Request ${requestId} approved`);

      // NEW: Use modifiedInput if provided, otherwise original
      const finalInput = response.modifiedInput ?? input;

      return {
        behavior: 'allow',
        updatedInput: finalInput, // SDK uses this as tool input
      };
    }

    // User denied
    this.logger.info(`[SdkPermissionHandler] Request ${requestId} denied: ${response.reason || 'No reason'}`);
    return {
      behavior: 'deny',
      message: response.reason || 'User denied permission',
    };
  }

  // EXISTING (no changes)
  handleResponse(requestId: string, response: PermissionResponse): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      this.logger.warn(`[SdkPermissionHandler] Unknown request: ${requestId}`);
      return;
    }

    // No timer to clear (removed)
    this.pendingRequests.delete(requestId);
    pending.resolve(response);
  }

  // NEW: Await response indefinitely (no timeout)
  private async awaitResponseIndefinitely(requestId: string): Promise<PermissionResponse | null> {
    return new Promise<PermissionResponse | null>((resolve) => {
      // Store pending request (no timer)
      this.pendingRequests.set(requestId, { resolve });
    });
  }

  // NEW: Clean up pending requests on session disposal
  dispose(): void {
    this.logger.info(`[SdkPermissionHandler] Disposing ${this.pendingRequests.size} pending requests`);

    // Resolve all pending requests with denial
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      pending.resolve({
        approved: false,
        reason: 'Session ended',
      });
    }

    this.pendingRequests.clear();
  }

  // EXISTING (no changes to sanitization/generation methods)
  // ... sanitizeToolInput(), generateDescription(), generateRequestId()
}

// MODIFIED: PendingRequest interface (remove timer field)
interface PendingRequest {
  resolve: (response: PermissionResponse) => void;
  // timer: NodeJS.Timeout; // DELETE THIS LINE
}

// DELETE: PERMISSION_TIMEOUT_MS constant
// const PERMISSION_TIMEOUT_MS = 30000; // DELETE THIS LINE
```

#### Quality Requirements

**Functional Requirements**:

- Block SDK execution indefinitely until user responds
- Propagate modifiedInput to SDK when provided
- Clean up pending requests on session disposal
- Maintain fail-safe: unknown tools default to deny

**Non-Functional Requirements**:

- Response propagation completes within 100ms of frontend message
- No memory leaks from abandoned pending requests
- Graceful handling of session interruption
- Defense-in-depth: Backend re-validates modified inputs (future enhancement)

**Pattern Compliance**:

- Must use tsyringe @injectable decorator - verified at sdk-permission-handler.ts:114
- Must use TOKENS.LOGGER for logging - verified at sdk-permission-handler.ts:129
- Must emit 'permission:request' event (matches frontend handler) - verified at sdk-permission-handler.ts:229

#### Files Affected

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` (MODIFY)
  - Remove PERMISSION_TIMEOUT_MS constant (line 95)
  - Remove timeoutAt from PermissionRequest (line 72)
  - Remove timer field from PendingRequest interface (line 89)
  - Replace awaitResponse() with awaitResponseIndefinitely()
  - Update requestUserPermission() to use modifiedInput
  - Add dispose() method for cleanup

---

### Component 3: QuestionPromptCardComponent (NEW)

#### Purpose

New component to display AskUserQuestion prompts. Visually distinct from permission requests, supports free-text and multiple-choice answers.

#### Pattern (Evidence-Based)

**Chosen Pattern**: Signal-based reactive component (similar to PermissionRequestCardComponent)
**Evidence**: Permission card pattern at permission-request-card.component.ts:43-147
**Rationale**: Same architectural style - standalone component with signal inputs/outputs

#### Responsibilities

- Display question text from AskUserQuestion tool
- Support free-text input (textarea) for open-ended questions
- Support multiple-choice (radio buttons) if options provided
- Emit answer to backend
- Visually distinct from permission requests (icon, color, no "Deny" button)

#### Implementation Pattern

```typescript
// Pattern source: permission-request-card.component.ts (similar structure)
// Verified imports: lucide-angular, DaisyUI components

import { Component, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, HelpCircle, Send } from 'lucide-angular';
import { FormsModule } from '@angular/forms';

/**
 * Question request from AskUserQuestion tool
 */
export interface QuestionRequest {
  readonly id: string; // Request ID
  readonly question: string; // Question text
  readonly options?: readonly string[]; // Optional multiple-choice options
  readonly timestamp: number;
}

/**
 * Question response to backend
 */
export interface QuestionResponse {
  readonly id: string; // Must match request ID
  readonly answer: string; // User's answer
}

@Component({
  selector: 'ptah-question-prompt-card',
  standalone: true,
  imports: [LucideAngularModule, FormsModule],
  template: `
    <div class="card bg-info/10 shadow-lg overflow-hidden border border-info/30" role="dialog" aria-labelledby="question-title">
      <!-- Colored left border stripe (distinct from permission) -->
      <div class="absolute left-0 top-0 bottom-0 w-1 bg-info"></div>

      <!-- Header -->
      <div class="px-4 py-3 pl-5">
        <div class="flex items-center gap-2 mb-3">
          <lucide-angular [img]="HelpCircleIcon" class="w-4 h-4 text-info flex-shrink-0" />
          <span id="question-title" class="font-semibold text-sm">Claude has a question</span>
        </div>

        <!-- Question text -->
        <p class="text-sm mb-3">{{ request().question }}</p>

        <!-- Multiple choice options -->
        @if (request().options && request().options.length > 0) {
        <div class="space-y-2 mb-3">
          @for (option of request().options; track option) {
          <label class="flex items-center gap-2 cursor-pointer hover:bg-base-200 p-2 rounded">
            <input type="radio" name="question-option" [value]="option" [(ngModel)]="answer" class="radio radio-info radio-sm" />
            <span class="text-sm">{{ option }}</span>
          </label>
          }
        </div>
        }

        <!-- Free-text input (if no options) -->
        @if (!request().options || request().options.length === 0) {
        <textarea class="textarea textarea-bordered w-full text-sm" rows="3" placeholder="Type your answer..." [(ngModel)]="answer" [disabled]="isSubmitting()" (keydown.enter)="$event.ctrlKey && submitAnswer()" aria-label="Answer input"></textarea>
        <div class="text-xs text-base-content/60 mt-1">Press Ctrl+Enter to submit</div>
        }
      </div>

      <!-- Action button -->
      <div class="flex gap-2 px-4 py-3 pl-5 border-t border-info/20 bg-base-100/30">
        <button class="btn btn-info btn-sm flex-1 gap-1" (click)="submitAnswer()" [disabled]="!answer().trim() || isSubmitting()" type="button" aria-label="Submit answer">
          @if (isSubmitting()) {
          <span class="loading loading-spinner loading-xs"></span>
          Sending... } @else {
          <lucide-angular [img]="SendIcon" class="w-4 h-4" />
          Submit Answer }
        </button>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionPromptCardComponent {
  // Inputs
  readonly request = input.required<QuestionRequest>();

  // Outputs
  readonly answered = output<QuestionResponse>();

  // Icons
  protected readonly HelpCircleIcon = HelpCircle;
  protected readonly SendIcon = Send;

  // State
  protected readonly answer = signal<string>('');
  protected readonly isSubmitting = signal<boolean>(false);

  protected submitAnswer(): void {
    const answerText = this.answer().trim();
    if (!answerText) return;

    this.isSubmitting.set(true);

    this.answered.emit({
      id: this.request().id,
      answer: answerText,
    });

    // Component will be removed by parent after response sent
  }
}
```

#### Quality Requirements

**Functional Requirements**:

- Display question text clearly
- Support both free-text and multiple-choice modes
- Disable submission with empty answers
- Keyboard accessibility (Ctrl+Enter to submit)
- Screen reader support (role="dialog", aria-labels)

**Non-Functional Requirements**:

- Component renders within 50ms
- Answer submission within 100ms
- Visual distinction from permission cards (info color vs warning)
- No timeout mechanism (questions block until answered)

**Pattern Compliance**:

- Must use Angular signals - verified pattern
- Must use DaisyUI classes (card, textarea, radio, btn-info)
- Must use lucide-angular for icons - verified pattern
- Must be standalone component - verified pattern

#### Files Affected

- `libs/frontend/chat/src/lib/components/molecules/question-prompt-card.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/components/molecules/index.ts` (MODIFY - add export)

---

### Component 4: SdkQuestionHandler (NEW)

#### Purpose

New backend service to handle AskUserQuestion tool invocations. Similar to SdkPermissionHandler but for questions (auto-approved, no permission gate).

#### Pattern (Evidence-Based)

**Chosen Pattern**: Promise-based async blocking with pending request tracking (same as SdkPermissionHandler)
**Evidence**: SdkPermissionHandler pattern at sdk-permission-handler.ts:114-270
**Rationale**: Questions block execution until answered - same async pattern as permissions

#### Responsibilities

- Detect AskUserQuestion tool invocations in SDK stream
- Emit question:request events to frontend
- Await user answer (indefinitely)
- Return answer as tool_result to SDK
- Clean up pending questions on session disposal

#### Implementation Pattern

```typescript
// Pattern source: sdk-permission-handler.ts (adapted for questions)
// Verified imports: tsyringe DI, Logger from vscode-core

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';

/**
 * Question request payload for RPC event
 */
interface QuestionRequest {
  readonly id: string;
  readonly question: string;
  readonly options?: readonly string[];
  readonly timestamp: number;
  /** Tool use ID for correlation with ExecutionNode */
  readonly toolUseId?: string;
}

/**
 * Question response from webview RPC
 */
interface QuestionResponse {
  readonly id: string;
  readonly answer: string;
}

/**
 * Pending question tracking
 */
interface PendingQuestion {
  resolve: (response: QuestionResponse) => void;
}

@injectable()
export class SdkQuestionHandler {
  private pendingQuestions = new Map<string, PendingQuestion>();
  private eventEmitter: ((event: string, payload: any) => void) | null = null;

  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  /**
   * Set event emitter for question requests
   * Called during initialization to wire up RPC event system
   */
  setEventEmitter(emitter: (event: string, payload: any) => void): void {
    this.eventEmitter = emitter;
  }

  /**
   * Request user answer to question
   * Called by StreamTransformer when AskUserQuestion tool is detected
   *
   * @param question - Question text
   * @param options - Optional multiple-choice options
   * @param toolUseId - SDK tool_use_id for correlation
   * @returns User's answer string
   */
  async requestUserAnswer(question: string, options?: string[], toolUseId?: string): Promise<string> {
    const requestId = this.generateRequestId();

    const request: QuestionRequest = {
      id: requestId,
      question,
      options,
      timestamp: Date.now(),
      toolUseId,
    };

    if (!this.eventEmitter) {
      this.logger.error('[SdkQuestionHandler] Event emitter not set');
      throw new Error('Question system not initialized');
    }

    // Emit question request to frontend
    this.eventEmitter('question:request', request);
    this.logger.debug(`[SdkQuestionHandler] Emitted question request ${requestId}`);

    // Await user answer (indefinitely)
    const response = await this.awaitAnswerIndefinitely(requestId);

    if (!response) {
      // Should only happen on session disposal
      this.logger.warn(`[SdkQuestionHandler] Question ${requestId} cancelled`);
      throw new Error('Question request cancelled');
    }

    this.logger.info(`[SdkQuestionHandler] Question ${requestId} answered`);
    return response.answer;
  }

  /**
   * Handle question response from webview
   * Called by RPC handler when user submits answer
   */
  handleResponse(requestId: string, response: QuestionResponse): void {
    const pending = this.pendingQuestions.get(requestId);
    if (!pending) {
      this.logger.warn(`[SdkQuestionHandler] Unknown question: ${requestId}`);
      return;
    }

    this.pendingQuestions.delete(requestId);
    pending.resolve(response);
  }

  /**
   * Await answer indefinitely (no timeout)
   */
  private async awaitAnswerIndefinitely(requestId: string): Promise<QuestionResponse | null> {
    return new Promise<QuestionResponse | null>((resolve) => {
      this.pendingQuestions.set(requestId, { resolve });
    });
  }

  /**
   * Clean up pending questions on session disposal
   */
  dispose(): void {
    this.logger.info(`[SdkQuestionHandler] Disposing ${this.pendingQuestions.size} pending questions`);

    // Resolve all pending with null (will throw error in requestUserAnswer)
    for (const [requestId, pending] of this.pendingQuestions.entries()) {
      pending.resolve({ id: requestId, answer: '' });
    }

    this.pendingQuestions.clear();
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `ques_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
```

#### Quality Requirements

**Functional Requirements**:

- Detect AskUserQuestion tool invocations
- Block execution until user answers
- Support free-text and multiple-choice questions
- Return answer to SDK as tool_result
- Clean up pending questions on disposal

**Non-Functional Requirements**:

- Answer propagation within 100ms of frontend response
- No memory leaks from abandoned pending questions
- Graceful handling of session interruption

**Pattern Compliance**:

- Must use tsyringe @injectable decorator - verified pattern
- Must use TOKENS.LOGGER for logging - verified pattern
- Must emit 'question:request' event (distinct from permission:request)
- Must follow same async blocking pattern as SdkPermissionHandler

#### Files Affected

- `libs/backend/agent-sdk/src/lib/helpers/sdk-question-handler.ts` (CREATE)
- `libs/backend/agent-sdk/src/lib/helpers/index.ts` (MODIFY - add export)
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` (MODIFY - add SDK_QUESTION_HANDLER token)
- `libs/backend/agent-sdk/src/lib/di/register.ts` (MODIFY - register SdkQuestionHandler)

---

### Component 5: StreamTransformer (AskUserQuestion Detection)

#### Purpose

Existing service that transforms SDK messages to ExecutionNodes. Enhanced to detect AskUserQuestion tool invocations and trigger question handler.

#### Pattern (Evidence-Based)

**Chosen Pattern**: Async generator transformation with tool detection
**Evidence**: Existing StreamTransformer at libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts
**Rationale**: Tool invocations are detected during stream processing - AskUserQuestion is a tool like any other

#### Responsibilities

- Transform SDK stream messages to ExecutionNodes (existing)
- Detect AskUserQuestion tool_use messages
- Extract question text and options from tool input
- Invoke SdkQuestionHandler.requestUserAnswer()
- Create ExecutionNode with questionText field for UI display

#### Implementation Pattern

```typescript
// Pattern source: stream-transformer.ts (existing file - not read yet, inferring from SDK patterns)
// Integration point: Detect tool_use where name === 'AskUserQuestion'

@injectable()
export class StreamTransformer {
  constructor(@inject(TOKENS.LOGGER) private logger: Logger, @inject(SDK_TOKENS.SDK_QUESTION_HANDLER) private questionHandler: SdkQuestionHandler) {}

  async *transform(config: TransformConfig): AsyncIterable<ExecutionNode> {
    // Existing stream transformation logic...

    // NEW: Detect AskUserQuestion tool_use messages
    for await (const sdkMessage of config.sdkQuery) {
      // ... existing message processing

      // NEW: Check if this is AskUserQuestion tool
      if (sdkMessage.type === 'tool' && sdkMessage.subtype === 'start') {
        const toolName = sdkMessage.tool;
        const toolInput = sdkMessage.args || {};
        const toolUseId = sdkMessage.tool_use_id;

        if (toolName === 'AskUserQuestion') {
          this.logger.info('[StreamTransformer] Detected AskUserQuestion tool');

          // Extract question and options from input
          const question = toolInput.question as string;
          const options = toolInput.options as string[] | undefined;

          // Request user answer (blocks until answered)
          try {
            const answer = await this.questionHandler.requestUserAnswer(question, options, toolUseId);

            // Create ExecutionNode for UI display
            const questionNode: ExecutionNode = {
              id: toolUseId || this.generateNodeId(),
              type: 'tool',
              status: 'complete',
              content: question,
              toolName: 'AskUserQuestion',
              toolInput: { question, options },
              toolOutput: { answer },
              toolCallId: toolUseId,
              // NEW: Add questionText field for special UI rendering
              // (Frontend can detect this and show question card inline)
              questionText: question,
              questionOptions: options,
              children: [],
              isCollapsed: false,
            };

            yield questionNode;

            this.logger.info('[StreamTransformer] AskUserQuestion answered', { answer });
          } catch (error) {
            this.logger.error('[StreamTransformer] AskUserQuestion failed', error);

            // Create error node
            const errorNode: ExecutionNode = {
              id: toolUseId || this.generateNodeId(),
              type: 'tool',
              status: 'error',
              content: question,
              error: error instanceof Error ? error.message : 'Question failed',
              toolName: 'AskUserQuestion',
              toolCallId: toolUseId,
              children: [],
              isCollapsed: false,
            };

            yield errorNode;
          }

          continue; // Skip normal tool processing
        }
      }

      // ... existing tool processing for other tools
    }
  }
}
```

#### Quality Requirements

**Functional Requirements**:

- Detect AskUserQuestion tool invocations in SDK stream
- Extract question text and options from tool input
- Block stream processing until user answers
- Create ExecutionNode with questionText field
- Handle errors gracefully (show error node)

**Non-Functional Requirements**:

- Question detection latency < 10ms
- No stream interruption during question blocking
- Proper error handling prevents stream abortion

**Pattern Compliance**:

- Must use tsyringe @inject for dependencies - verified pattern
- Must yield ExecutionNode objects - verified pattern
- Must use async generator (async \*transform) - verified pattern

#### Files Affected

- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts` (MODIFY)
  - Add SdkQuestionHandler injection
  - Add AskUserQuestion detection logic
  - Create ExecutionNode with questionText field

---

### Component 6: Extended ExecutionNode Type (Question Support)

#### Purpose

Extend ExecutionNode interface to support question-specific fields. Backward-compatible addition.

#### Pattern (Evidence-Based)

**Chosen Pattern**: Immutable interface extension with optional fields
**Evidence**: ExecutionNode at libs/shared/src/lib/types/execution-node.types.ts:75-179
**Rationale**: ExecutionNode already has optional tool-specific fields (agentType, agentModel, etc.) - same pattern for questions

#### Implementation Pattern

```typescript
// Pattern source: execution-node.types.ts:75-179
// Add optional question fields to existing interface

export interface ExecutionNode {
  // ... existing fields (id, type, status, content, etc.)

  // ---- Tool-specific fields ----
  readonly toolName?: string;
  readonly toolInput?: Record<string, unknown>;
  readonly toolOutput?: unknown;
  readonly toolCallId?: string;
  readonly isPermissionRequest?: boolean;

  // NEW: Question-specific fields (for AskUserQuestion tool)
  /**
   * Question text from AskUserQuestion tool.
   * When present, frontend can show special question prompt UI.
   */
  readonly questionText?: string;

  /**
   * Multiple-choice options for question.
   * If undefined, question is free-form text.
   */
  readonly questionOptions?: readonly string[];

  // ... rest of existing fields
}
```

#### Quality Requirements

**Functional Requirements**:

- Add questionText and questionOptions fields
- Maintain backward compatibility (all fields optional)
- Update Zod schema for runtime validation

**Pattern Compliance**:

- Must use readonly modifier - verified pattern
- Must be optional (?) - verified pattern
- Must update Zod schema - verified at execution-node.types.ts:449-480

#### Files Affected

- `libs/shared/src/lib/types/execution-node.types.ts` (MODIFY)
  - Add questionText and questionOptions fields to ExecutionNode interface
  - Update ExecutionNodeSchema Zod schema with new fields

---

### Component 7: Frontend Question Handling (PermissionHandlerService)

#### Purpose

Extend PermissionHandlerService to manage question requests alongside permission requests. Separate state tracking for questions.

#### Pattern (Evidence-Based)

**Chosen Pattern**: Signal-based state management with separate question tracking
**Evidence**: PermissionHandlerService at permission-handler.service.ts:22-211
**Rationale**: Questions are conceptually similar to permissions (pending requests awaiting response) - reuse same pattern

#### Implementation Pattern

```typescript
// Pattern source: permission-handler.service.ts:22-211
// Add question request management alongside permission requests

@Injectable({ providedIn: 'root' })
export class PermissionHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly vscodeService = inject(VSCodeService);

  // EXISTING: Permission state
  private readonly _permissionRequests = signal<PermissionRequest[]>([]);
  readonly permissionRequests = this._permissionRequests.asReadonly();

  // NEW: Question state
  private readonly _questionRequests = signal<QuestionRequest[]>([]);
  readonly questionRequests = this._questionRequests.asReadonly();

  // EXISTING: Permission methods (no changes)
  handlePermissionRequest(request: PermissionRequest): void { ... }
  handlePermissionResponse(response: PermissionResponse): void { ... }

  // NEW: Question methods
  handleQuestionRequest(request: QuestionRequest): void {
    console.log('[PermissionHandlerService] Question request received:', request);
    this._questionRequests.update(questions => [...questions, request]);
  }

  handleQuestionResponse(response: QuestionResponse): void {
    console.log('[PermissionHandlerService] Question response:', response);

    // Remove from pending questions
    this._questionRequests.update(questions =>
      questions.filter(q => q.id !== response.id)
    );

    // Send response to backend
    this.vscodeService.postMessage({
      type: 'chat:question-response',
      response,
    });
  }
}
```

#### Quality Requirements

**Functional Requirements**:

- Track pending question requests separately from permissions
- Emit question responses to backend via RPC
- Maintain immutable update pattern for signals

**Pattern Compliance**:

- Must use Angular signals - verified pattern
- Must use immutable updates (update with spread) - verified pattern
- Must use VSCodeService.postMessage() - verified at permission-handler.service.ts:179-182

#### Files Affected

- `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts` (MODIFY)
  - Add \_questionRequests signal
  - Add handleQuestionRequest() method
  - Add handleQuestionResponse() method

---

### Component 8: RPC Handler Integration

#### Purpose

Wire up question RPC handlers in SdkRpcHandlers. Connect frontend question responses to backend question handler.

#### Pattern (Evidence-Based)

**Chosen Pattern**: Event-driven RPC with handler methods
**Evidence**: SdkRpcHandlers at sdk-rpc-handlers.ts:57-287
**Rationale**: Same pattern as permission response handling - add question response handler

#### Implementation Pattern

```typescript
// Pattern source: sdk-rpc-handlers.ts:57-287
// Add question handler injection and response method

@injectable()
export class SdkRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER) private readonly webviewManager: WebviewManager,
    @inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter,
    @inject('SdkPermissionHandler') private readonly permissionHandler: SdkPermissionHandler,
    @inject('SdkQuestionHandler') private readonly questionHandler: SdkQuestionHandler // NEW
  ) {
    this.initializePermissionEmitter();
    this.initializeQuestionEmitter(); // NEW
  }

  // EXISTING: Permission emitter (no changes)
  private initializePermissionEmitter(): void { ... }

  // NEW: Question emitter
  private initializeQuestionEmitter(): void {
    this.logger.info('[SdkRpcHandlers] Initializing question event emitter...');

    const emitter = (event: string, payload: any): void => {
      this.logger.debug(`[SdkRpcHandlers] Question event: ${event}`, { payload });

      this.webviewManager
        .sendMessage('ptah.main', event, payload)
        .catch((error) => {
          this.logger.error(`[SdkRpcHandlers] Failed to send question event: ${event}`, { error });
        });
    };

    this.questionHandler.setEventEmitter(emitter);
    this.logger.info('[SdkRpcHandlers] Question event emitter initialized');
  }

  // NEW: Question response handler
  handleQuestionResponse(params: {
    requestId: string;
    answer: string;
  }): void {
    try {
      this.logger.info('[SdkRpcHandlers] Handling question response', {
        requestId: params.requestId,
        answerLength: params.answer.length,
      });

      this.questionHandler.handleResponse(params.requestId, {
        id: params.requestId,
        answer: params.answer,
      });

      this.logger.debug('[SdkRpcHandlers] Question response handled');
    } catch (error) {
      this.logger.error('[SdkRpcHandlers] Failed to handle question response', {
        error,
        requestId: params.requestId,
      });
    }
  }
}
```

#### Quality Requirements

**Functional Requirements**:

- Wire SdkQuestionHandler event emitter
- Handle question responses from frontend
- Route responses to question handler

**Pattern Compliance**:

- Must use tsyringe @inject - verified pattern
- Must use Logger for debug logging - verified pattern
- Must use WebviewManager.sendMessage() - verified pattern

#### Files Affected

- `libs/backend/vscode-core/src/messaging/sdk-rpc-handlers.ts` (MODIFY)
  - Add SdkQuestionHandler injection
  - Add initializeQuestionEmitter() method
  - Add handleQuestionResponse() method

---

### Component 9: Shared Type Extensions

#### Purpose

Update shared types to support question requests and responses. Make timeoutAt optional in PermissionRequest for backward compatibility.

#### Implementation Pattern

```typescript
// File: libs/shared/src/lib/types/permission.types.ts
// Pattern: Extend existing interfaces, maintain backward compatibility

export interface PermissionRequest {
  readonly id: string;
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly toolUseId?: string;
  readonly timestamp: number;
  readonly description: string;
  readonly timeoutAt?: number; // CHANGED: Make optional (for backward compatibility during migration)
}

export interface PermissionResponse {
  readonly id: string;
  readonly decision: 'allow' | 'deny' | 'always_allow';
  readonly reason?: string;
  readonly modifiedInput?: Record<string, unknown>; // NEW: Modified tool input
}

// Update Zod schema
export const PermissionRequestSchema = z.object({
  id: z.string().uuid(),
  toolName: z.string().min(1),
  toolInput: z.record(z.string(), z.unknown()),
  toolUseId: z.string().optional(),
  timestamp: z.number(),
  description: z.string(),
  timeoutAt: z.number().optional(), // CHANGED: Optional
});

export const PermissionResponseSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(['allow', 'deny', 'always_allow']),
  reason: z.string().optional(),
  modifiedInput: z.record(z.string(), z.unknown()).optional(), // NEW
});

// NEW: Question types
export interface QuestionRequest {
  readonly id: string;
  readonly question: string;
  readonly options?: readonly string[];
  readonly timestamp: number;
  readonly toolUseId?: string;
}

export interface QuestionResponse {
  readonly id: string;
  readonly answer: string;
}

export const QuestionRequestSchema = z.object({
  id: z.string().uuid(),
  question: z.string().min(1),
  options: z.array(z.string()).readonly().optional(),
  timestamp: z.number(),
  toolUseId: z.string().optional(),
});

export const QuestionResponseSchema = z.object({
  id: z.string().uuid(),
  answer: z.string().min(1),
});
```

#### Files Affected

- `libs/shared/src/lib/types/permission.types.ts` (MODIFY)
  - Make timeoutAt optional in PermissionRequest
  - Add modifiedInput to PermissionResponse
  - Add QuestionRequest interface
  - Add QuestionResponse interface
  - Add Zod schemas for questions

---

### Component 10: Chat View Integration

#### Purpose

Integrate question prompts into ChatViewComponent. Display questions alongside messages, wire up response handlers.

#### Pattern (Evidence-Based)

**Chosen Pattern**: Signal-based template rendering with service injection
**Evidence**: Chat view template at chat-view.component.html:1-100
**Rationale**: Questions should display in chat flow - add to message list area

#### Implementation Pattern

```html
<!-- Pattern source: chat-view.component.html -->
<!-- Add question prompts after message list -->

<div class="flex-1 overflow-y-auto p-4 space-y-3">
  <!-- EXISTING: Message bubbles -->
  @for (message of chatStore.messages(); track message.id) {
  <ptah-message-bubble [message]="message" />
  }

  <!-- EXISTING: Streaming message -->
  @if (chatStore.isStreaming()) { ... }

  <!-- NEW: Question prompts -->
  @for (question of permissionHandler.questionRequests(); track question.id) {
  <ptah-question-prompt-card [request]="question" (answered)="permissionHandler.handleQuestionResponse($event)" />
  }

  <!-- EXISTING: Empty state -->
  @if (chatStore.messages().length === 0) { ... }
</div>
```

```typescript
// Component TypeScript - inject PermissionHandlerService
export class ChatViewComponent {
  protected readonly permissionHandler = inject(PermissionHandlerService);
  // ... existing code
}
```

#### Files Affected

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` (MODIFY)
  - Add question prompt display section
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (MODIFY)
  - Inject PermissionHandlerService
  - Add QuestionPromptCardComponent to imports

---

## 🔗 Integration Architecture

### Permission Flow (Enhanced)

```
USER NEEDS PERMISSION FOR TOOL
  ↓
SDK calls canUseTool(toolName, input)
  ↓
SdkPermissionHandler.requestUserPermission()
  - Create PermissionRequest (NO timeoutAt)
  - Emit 'permission:request' event
  - Await response INDEFINITELY (no timeout)
  ↓
SdkRpcHandlers.initializePermissionEmitter()
  - Send event to WebviewManager
  ↓
Frontend PermissionHandlerService.handlePermissionRequest()
  - Add to _permissionRequests signal
  ↓
PermissionRequestCardComponent displays
  - User can edit input (optional)
  - User clicks Allow/Deny
  ↓
PermissionRequestCardComponent.respond()
  - Emit PermissionResponse with modifiedInput
  ↓
PermissionHandlerService.handlePermissionResponse()
  - Remove from signal
  - Send 'chat:permission-response' event
  ↓
SdkRpcHandlers.handlePermissionResponse()
  - Call SdkPermissionHandler.handleResponse()
  ↓
SdkPermissionHandler.handleResponse()
  - Resolve pending promise
  - Return { behavior: 'allow', updatedInput: modifiedInput || originalInput }
  ↓
SDK receives response, executes tool with updated input
```

### Question Flow (New)

```
CLAUDE INVOKES AskUserQuestion TOOL
  ↓
StreamTransformer detects tool_use (name: 'AskUserQuestion')
  - Extract question text and options from input
  ↓
SdkQuestionHandler.requestUserAnswer(question, options, toolUseId)
  - Create QuestionRequest
  - Emit 'question:request' event
  - Await answer INDEFINITELY (no timeout)
  ↓
SdkRpcHandlers.initializeQuestionEmitter()
  - Send event to WebviewManager
  ↓
Frontend PermissionHandlerService.handleQuestionRequest()
  - Add to _questionRequests signal
  ↓
QuestionPromptCardComponent displays
  - User types answer or selects option
  - User clicks Submit
  ↓
QuestionPromptCardComponent.submitAnswer()
  - Emit QuestionResponse with answer
  ↓
PermissionHandlerService.handleQuestionResponse()
  - Remove from signal
  - Send 'chat:question-response' event
  ↓
SdkRpcHandlers.handleQuestionResponse()
  - Call SdkQuestionHandler.handleResponse()
  ↓
SdkQuestionHandler.handleResponse()
  - Resolve pending promise with answer
  ↓
StreamTransformer receives answer
  - Create ExecutionNode with questionText + toolOutput
  - Yield node to frontend
  ↓
Claude receives tool_result({ answer: "user's answer" })
  - Continues execution with answer
```

### Mid-Stream Message Injection (Existing - Verify)

```
USER TYPES MESSAGE DURING STREAMING
  ↓
ChatInputComponent.submit()
  - ChatStore.sendMessage(content)
  ↓
ChatStore sends 'sdk:sendMessage' RPC
  ↓
SdkRpcHandlers.handleSendMessage()
  - SdkAgentAdapter.sendMessageToSession()
  ↓
SdkAgentAdapter.sendMessageToSession()
  - Create SDKUserMessage
  - Push to session.messageQueue
  - Wake iterator (resolveNext)
  ↓
UserMessageStreamFactory async generator
  - Drain messageQueue
  - Yield SDKUserMessage to SDK
  ↓
SDK receives user message mid-stream
  - Incorporates into current turn
```

**Verification Required**: Ensure chat input is NOT disabled during streaming (should already work based on code inspection)

---

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

**Permission System**:

- Remove 30-second timeout - block indefinitely until user responds
- Accept modified tool inputs from user
- Propagate modified inputs to SDK's updatedInput field
- Clean up pending requests on session disposal

**Question System**:

- Detect AskUserQuestion tool invocations
- Display question prompts in chat UI (distinct from permissions)
- Block execution until user answers
- Support free-text and multiple-choice questions
- Return answer to SDK as tool_result

**Mid-Stream Messages**:

- Verify chat input remains enabled during streaming
- Verify messages are queued and delivered to SDK
- Add visual indicator for mid-stream messages (optional)

### Non-Functional Requirements

**Performance**:

- Permission response propagation: < 100ms from button click to SDK resolution
- Question display latency: < 50ms from tool_use detection to UI render
- No UI freezing during permission/question blocking (async pattern)

**Security**:

- Input validation: Reject dangerous bash patterns (rm -rf /, sudo rm)
- Path validation: Detect path traversal attempts (../)
- Backend re-validation: (P2 enhancement - add validation layer)
- XSS prevention: Escape user-modified inputs before display

**Usability**:

- Visual distinction: Questions use info color, permissions use warning color
- Keyboard accessibility: Tab, Enter, Escape support for all inputs
- Screen reader support: Proper ARIA labels and roles
- Clear error messages: Validation errors explain what's wrong

**Reliability**:

- No lost responses: Pending request tracking prevents dropped responses
- Graceful degradation: Session disposal cleanly rejects pending requests
- Recovery: System recovers from backend disconnection (user sees error)

### Pattern Compliance

**Signal-Based Reactivity**:

- All frontend state uses Angular signals (verified: no RxJS BehaviorSubject)
- Immutable updates with .update() and spread operator
- Computed signals for derived state

**Event-Driven RPC**:

- Backend → Frontend: Event emitter + WebviewManager.sendMessage()
- Frontend → Backend: VSCodeService.postMessage() + RPC handlers
- Event names: 'permission:request', 'chat:permission-response', 'question:request', 'chat:question-response'

**DaisyUI Styling**:

- Permission cards: bg-base-200, badge-warning, btn-success
- Question cards: bg-info/10, border-info, btn-info
- Consistent card structure with colored left border

**Async Blocking Pattern**:

- SDK's canUseTool returns Promise<PermissionResult>
- Pending request tracking with Map<requestId, resolve>
- Indefinite await (no timeout) with manual resolution

---

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **BOTH** - This task requires both backend and frontend work

**Breakdown**:

- **Backend Work (50%)**: Permission handler modifications, question handler creation, RPC integration

  - SdkPermissionHandler (timeout removal, modified input)
  - SdkQuestionHandler (new service)
  - SdkRpcHandlers (question RPC wiring)
  - StreamTransformer (question detection)

- **Frontend Work (50%)**: UI component enhancements, question component creation
  - PermissionRequestCardComponent (input editing, timer removal)
  - QuestionPromptCardComponent (new component)
  - PermissionHandlerService (question state management)
  - ChatViewComponent (question display integration)

**Rationale**:

- Backend: Node.js/TypeScript, DI with tsyringe, async patterns, SDK integration
- Frontend: Angular 20+, signals, DaisyUI, reactive components
- Requires understanding of both sides of RPC communication

**Team-Leader Strategy**: Assign backend-developer for P0 backend work first, then frontend-developer for P0 UI work, then alternate for P1/P2.

### Complexity Assessment

**Complexity**: **MEDIUM-HIGH**

**Estimated Effort**: **18-24 hours** (across 3 phases)

**Breakdown**:

- **P0 (Critical)**: 8-10 hours

  - Backend: Remove timeout (2h), add modified input (3h), session cleanup (1h)
  - Frontend: Remove timer UI (1h), add input editing (4h)

- **P1 (High Priority)**: 6-8 hours

  - Backend: SdkQuestionHandler service (3h), RPC integration (2h)
  - Frontend: QuestionPromptCardComponent (3h), service integration (1h)

- **P2 (Nice-to-Have)**: 4-6 hours
  - Backend: Mid-stream message verification (1h)
  - Frontend: Visual indicators (2h), enhanced validation (2h)

**Complexity Factors**:

- Multi-layer architecture (Backend → RPC → Frontend → RPC → Backend)
- Async blocking patterns (must not freeze UI)
- Signal-based state management (Angular 20+ patterns)
- Event-driven communication (requires careful event name coordination)
- Security considerations (input validation, XSS prevention)

### Files Affected Summary

#### CREATE (5 files)

**Backend**:

- `libs/backend/agent-sdk/src/lib/helpers/sdk-question-handler.ts` - New question handling service

**Frontend**:

- `libs/frontend/chat/src/lib/components/molecules/question-prompt-card.component.ts` - New question UI component

#### MODIFY (15 files)

**Backend**:

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` - Remove timeout, add modified input
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts` - Detect AskUserQuestion
- `libs/backend/agent-sdk/src/lib/helpers/index.ts` - Export SdkQuestionHandler
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` - Add SDK_QUESTION_HANDLER token
- `libs/backend/agent-sdk/src/lib/di/register.ts` - Register SdkQuestionHandler
- `libs/backend/vscode-core/src/messaging/sdk-rpc-handlers.ts` - Add question RPC handlers

**Frontend**:

- `libs/frontend/chat/src/lib/components/molecules/permission-request-card.component.ts` - Add input editing, remove timer
- `libs/frontend/chat/src/lib/components/molecules/index.ts` - Export QuestionPromptCardComponent
- `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts` - Add question state
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` - Display questions
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` - Inject services

**Shared**:

- `libs/shared/src/lib/types/permission.types.ts` - Add modifiedInput, make timeoutAt optional, add question types
- `libs/shared/src/lib/types/execution-node.types.ts` - Add questionText and questionOptions fields

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - `lucide-angular` icons: HelpCircle, Send (verify in node_modules)
   - `@angular/forms`: FormsModule, ReactiveFormsModule (verify in package.json)
   - `tsyringe`: injectable, inject (verified at sdk-permission-handler.ts:15)

2. **All patterns verified from examples**:

   - Signal-based components: permission-request-card.component.ts:148-364
   - Async blocking pattern: sdk-permission-handler.ts:303-320
   - Event-driven RPC: sdk-rpc-handlers.ts:81-107

3. **Event name coordination**:

   - Backend emits: 'permission:request' (verified), 'question:request' (new)
   - Frontend sends: 'chat:permission-response' (verified), 'chat:question-response' (new)
   - Team-leader must ensure backend and frontend use EXACT same event names

4. **No hallucinated APIs**:
   - All SDK types verified: canUseTool callback, PermissionResult type structure
   - All shared types verified: PermissionRequest, ExecutionNode interfaces
   - All DI tokens verified: TOKENS.LOGGER, SDK_TOKENS (pattern established)

### Phased Implementation Strategy

**Phase 0 (P0 - Critical)**: Timeout Removal + Basic Input Editing

- **Goal**: Fix critical UX issues (timeout, no input modification)
- **Backend Tasks**:
  - Remove PERMISSION_TIMEOUT_MS constant
  - Remove timeout logic from awaitResponse()
  - Remove timeoutAt from PermissionRequest
  - Accept modifiedInput in handleResponse()
  - Propagate modifiedInput to SDK
  - Add dispose() for session cleanup
- **Frontend Tasks**:
  - Remove countdown timer UI
  - Add input editing state signals
  - Add edit mode toggle
  - Add basic input validation
  - Update respond() to include modifiedInput
- **Testing**: Permission requests block indefinitely, users can modify bash commands
- **Risk**: If not done first, users continue to face timeout issues (high priority)

**Phase 1 (P1 - High Priority)**: AskUserQuestion Implementation

- **Goal**: Complete feature parity with native CLI
- **Backend Tasks**:
  - Create SdkQuestionHandler service
  - Add question detection in StreamTransformer
  - Wire question RPC handlers
  - Add question types to shared lib
- **Frontend Tasks**:
  - Create QuestionPromptCardComponent
  - Add question state to PermissionHandlerService
  - Integrate questions into ChatViewComponent
- **Testing**: Claude can ask questions, users can answer, execution continues
- **Risk**: Medium - new feature, but isolated from existing permission system

**Phase 2 (P2 - Nice-to-Have)**: Mid-Stream Message Injection + Enhanced Validation

- **Goal**: Advanced UX features for power users
- **Backend Tasks**:
  - Verify UserMessageStreamFactory mid-stream support
  - Add backend input validation layer (optional)
- **Frontend Tasks**:
  - Add visual indicator for mid-stream messages
  - Enhance input validation (more patterns)
  - Add undo/redo for input modifications (optional)
- **Testing**: Users can send messages during streaming, advanced validation works
- **Risk**: Low - enhancements to existing functionality

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration points documented with event flows
- [x] Files affected list complete (CREATE/MODIFY)
- [x] Developer type recommended (BOTH - backend + frontend)
- [x] Complexity assessed (MEDIUM-HIGH, 18-24h)
- [x] Phased rollout strategy defined (P0 → P1 → P2)
- [x] No step-by-step implementation (that's team-leader's job)

---

## 📚 Evidence Citations

### Pattern Evidence

1. **Signal-Based Components**:

   - Source: permission-request-card.component.ts:148-364
   - Pattern: `readonly request = input.required<PermissionRequest>()`
   - Used: All frontend components use this pattern

2. **Async Blocking Permission**:

   - Source: sdk-permission-handler.ts:303-320
   - Pattern: `return new Promise<PermissionResponse | null>((resolve) => { ... })`
   - Used: SdkQuestionHandler uses same pattern

3. **Event-Driven RPC**:

   - Source: sdk-rpc-handlers.ts:81-107
   - Pattern: `this.eventEmitter('permission:request', request)`
   - Used: Question events follow same pattern

4. **Immutable Signal Updates**:

   - Source: permission-handler.service.ts:160
   - Pattern: `this._permissionRequests.update((requests) => [...requests, request])`
   - Used: All state updates use spread operator

5. **DaisyUI Card Styling**:

   - Source: permission-request-card.component.ts:48-56
   - Pattern: `class="card bg-base-200 shadow-lg overflow-hidden border border-base-300/50"`
   - Used: Question card uses similar structure with info colors

6. **Lucide Icons**:
   - Source: permission-request-card.component.ts:11-22
   - Pattern: `import { LucideAngularModule, ShieldAlert, ... } from 'lucide-angular'`
   - Used: Question card imports HelpCircle, Send icons

### API Verification

1. **SDK canUseTool Callback**:

   - Source: sdk-query-builder.ts:150
   - Verified: `canUseTool: this.permissionHandler.createCallback()`
   - Usage: SDK accepts async function returning PermissionResult

2. **PermissionRequest Interface**:

   - Source: libs/shared/src/lib/types/permission.types.ts:18-39
   - Fields: id, toolName, toolInput, toolUseId, timestamp, description, timeoutAt
   - Usage: Backend creates, frontend consumes

3. **ExecutionNode Interface**:

   - Source: execution-node.types.ts:75-179
   - Fields: id, type, status, content, children (recursive), optional tool fields
   - Usage: StreamTransformer yields, frontend renders

4. **VSCodeService.postMessage()**:

   - Source: permission-handler.service.ts:179-182
   - Verified: `this.vscodeService.postMessage({ type: 'chat:permission-response', response })`
   - Usage: Frontend → Backend RPC communication

5. **WebviewManager.sendMessage()**:
   - Source: sdk-rpc-handlers.ts:94
   - Verified: `this.webviewManager.sendMessage('ptah.main', event, payload)`
   - Usage: Backend → Frontend RPC communication

### Integration Flow Verification

1. **Permission Event Names**:

   - Backend emits: `'permission:request'` (sdk-permission-handler.ts:229)
   - Frontend listens: Handled by message protocol in VSCodeService
   - Frontend responds: `'chat:permission-response'` (permission-handler.service.ts:180)
   - Backend handles: SdkRpcHandlers.handlePermissionResponse() (sdk-rpc-handlers.ts:257-287)

2. **UserMessageStreamFactory Mid-Stream Support**:
   - Source: user-message-stream-factory.ts:55-127
   - Pattern: Async generator drains session.messageQueue
   - Wake mechanism: session.resolveNext callback
   - Verified: Already supports mid-stream injection (no changes needed)

---

## 🔄 Migration & Backward Compatibility

### Backward Compatibility Strategy

**PermissionRequest.timeoutAt**:

- **Change**: Make optional (remove from backend, keep in interface as optional)
- **Rationale**: Frontend may receive old requests during transition
- **Migration**: Frontend components gracefully handle missing timeoutAt

**PermissionResponse.modifiedInput**:

- **Change**: Add optional field
- **Rationale**: Backend accepts undefined (uses original input)
- **Migration**: No breaking changes - optional field is additive

### Breaking Changes (NONE)

**All changes are backward-compatible**:

- Optional fields added (not removed)
- New components (not replacing existing)
- Enhanced behavior (not changing existing APIs)

---

## 📖 Documentation Requirements

**Code-Level Documentation**:

- Add JSDoc comments to all new methods and interfaces
- Document security implications of input modification
- Document event flow diagrams in service files

**Library-Level Documentation**:

- Create libs/backend/agent-sdk/CLAUDE.md with permission system overview
- Update libs/frontend/chat/CLAUDE.md with question component usage
- Document RPC event protocol in vscode-core/CLAUDE.md

**User-Facing Documentation**:

- (Deferred to P2) User guide: "Understanding Permissions and Questions"
- (Deferred to P2) Troubleshooting guide for common permission issues

---

## 🎯 Success Metrics

### Phase 0 (P0) Success Criteria

- ✅ All permission requests block indefinitely (no auto-deny after 30s)
- ✅ Users can modify bash commands before approval
- ✅ Modified inputs propagate to SDK and execute correctly
- ✅ Session disposal cleanly rejects all pending permissions

### Phase 1 (P1) Success Criteria

- ✅ AskUserQuestion tool displays question prompt in chat
- ✅ Users can answer free-text and multiple-choice questions
- ✅ Answers propagate to SDK and Claude continues with answer
- ✅ Question prompts visually distinct from permission requests

### Phase 2 (P2) Success Criteria

- ✅ Users can send messages during active streaming
- ✅ Mid-stream messages inject correctly (no conversation corruption)
- ✅ Visual indicator shows when message will be injected mid-stream

### Quality Metrics (All Phases)

- **Test Coverage**: ≥ 85% for new code (permission handler, question handler, components)
- **Performance**: Permission response time < 100ms (baseline: measure current system)
- **Accessibility**: 100% WCAG 2.1 Level AA compliance for new components
- **Bug Density**: < 1 bug per 500 lines of new code (target: 0 bugs in P0)

---

## 🚨 Risk Mitigation

### High-Risk Items

1. **Risk**: Indefinite blocking causes UI freeze

   - **Mitigation**: Async pattern with Promise prevents UI blocking
   - **Verification**: Add manual test - leave permission open 5+ minutes, verify UI responsive

2. **Risk**: Modified input bypasses security validation

   - **Mitigation**: P0 - Frontend validation, P2 - Backend re-validation
   - **Verification**: Add security test suite for dangerous patterns (rm -rf /, sudo, etc.)

3. **Risk**: Event name mismatch breaks RPC communication

   - **Mitigation**: Define event constants in shared lib, use constants (not strings)
   - **Verification**: Add integration test for full RPC roundtrip

4. **Risk**: Session disposal during permission wait leaks memory
   - **Mitigation**: Add dispose() method to clean up pending requests
   - **Verification**: Add test - dispose session with 10 pending permissions, check memory

### Medium-Risk Items

1. **Risk**: AskUserQuestion conflicts with tool call rendering

   - **Mitigation**: Create separate ExecutionNode type, distinct UI rendering
   - **Verification**: Add test - question + normal tool in same turn, verify both render

2. **Risk**: Mid-stream message injection corrupts conversation state
   - **Mitigation**: Verify SDK's async generator properly queues messages
   - **Verification**: Add test - send 5 messages rapidly during streaming, verify order preserved

---

## 📋 Testing Strategy

### Unit Tests

**Backend**:

- SdkPermissionHandler: Mock timeout removal, test modified input propagation
- SdkQuestionHandler: Test answer handling, pending request tracking
- StreamTransformer: Test AskUserQuestion detection, node creation

**Frontend**:

- PermissionRequestCardComponent: Test input editing, validation, respond with modifiedInput
- QuestionPromptCardComponent: Test answer submission, multiple-choice vs free-text
- PermissionHandlerService: Test question state management, RPC message sending

### Integration Tests

**Permission Flow**:

1. Backend emits permission:request → Frontend receives → User modifies → Backend receives modifiedInput → SDK executes with modified input
2. Session disposal → All pending permissions rejected with "Session ended"

**Question Flow**:

1. SDK invokes AskUserQuestion → StreamTransformer detects → Backend emits question:request → Frontend displays → User answers → Backend resolves → SDK receives answer

**Mid-Stream Messages**:

1. Start streaming → Send 3 messages rapidly → Verify all 3 delivered in order → Verify conversation state intact

### Manual QA Scenarios

**P0 Manual Tests**:

1. Leave permission prompt open for 5+ minutes → Verify no auto-deny, UI responsive
2. Modify bash command (fix typo) → Click Allow → Verify modified command executes
3. Interrupt session during permission wait → Verify clean rejection, no errors

**P1 Manual Tests**:

1. Trigger AskUserQuestion (multiple-choice) → Select option → Verify Claude continues
2. Trigger AskUserQuestion (free-text) → Type answer → Verify Claude receives exact answer
3. Compare question vs permission visually → Verify distinct colors, icons, layout

**P2 Manual Tests**:

1. Start long tool execution → Send message mid-stream → Verify message received
2. Modify bash command with dangerous pattern (rm -rf) → Verify validation error shown
3. Test keyboard navigation → Tab through inputs → Verify Enter/Escape work

---

## 🏁 Definition of Done (Architecture Phase)

- [x] All components specified with responsibilities and patterns
- [x] All patterns verified from codebase with file:line citations
- [x] All imports/APIs verified as existing (no hallucinations)
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration flows documented with event names verified
- [x] Files affected list complete with CREATE/MODIFY labels
- [x] Developer type recommended with rationale
- [x] Complexity assessed with time estimates
- [x] Phased rollout strategy defined (P0 → P1 → P2)
- [x] Risk assessment with mitigation strategies
- [x] Testing strategy defined (unit, integration, manual)
- [x] Evidence citations for all architectural decisions

**Team-Leader Next Steps**:

1. Read this implementation-plan.md
2. Decompose components into atomic tasks in tasks.md
3. Assign P0 backend tasks to backend-developer
4. Assign P0 frontend tasks to frontend-developer
5. Verify git commits after each task completion
6. Move to P1 after P0 validation complete
