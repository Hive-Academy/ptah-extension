# Event Relay System - Implementation Plan

**Date**: 2025-01-18
**Status**: READY FOR IMPLEMENTATION
**Prerequisite**: Read EVENT_SYSTEM_GAP_ANALYSIS.md first

---

## 🎯 Implementation Strategy

### Phased Approach (5 Layers)

We'll implement fixes in dependency order, ensuring each layer builds on the previous:

```
Layer 1: Type Foundations (MESSAGE_TYPES + Payload Interfaces)
         ↓
Layer 2: EventBus Relay (Backend bridge)
         ↓
Layer 3: Frontend Subscriptions (ChatService)
         ↓
Layer 4: UI Components (Visual display)
         ↓
Layer 5: Testing & Validation
```

---

## 📦 Layer 1: Type Foundations

### 1.1 Add Missing MESSAGE_TYPES

**File**: `libs/shared/src/lib/constants/message-types.ts`

**Changes**:

```typescript
export const CHAT_MESSAGE_TYPES = {
  // ... existing types ...

  // Streaming events (backend → frontend)
  MESSAGE_CHUNK: 'chat:messageChunk', // ✅ Already exists
  THINKING: 'chat:thinking', // ⭐ ADD - Claude reasoning display

  // Tool execution events
  TOOL_START: 'chat:toolStart', // ⭐ ADD
  TOOL_PROGRESS: 'chat:toolProgress', // ⭐ ADD
  TOOL_RESULT: 'chat:toolResult', // ⭐ ADD
  TOOL_ERROR: 'chat:toolError', // ⭐ ADD

  // Permission events
  PERMISSION_REQUEST: 'chat:permissionRequest', // ✅ Already exists
  PERMISSION_RESPONSE: 'chat:permissionResponse', // ✅ Already exists

  // Agent lifecycle events
  AGENT_STARTED: 'chat:agentStarted', // ✅ Already exists
  AGENT_ACTIVITY: 'chat:agentActivity', // ✅ Already exists
  AGENT_COMPLETED: 'chat:agentCompleted', // ✅ Already exists

  // Session lifecycle
  SESSION_INIT: 'chat:sessionInit', // ⭐ ADD - CLI session initialized
  SESSION_END: 'chat:sessionEnd', // ⭐ ADD - CLI session ended

  // System events
  HEALTH_UPDATE: 'chat:healthUpdate', // ⭐ ADD - CLI health changed
  CLI_ERROR: 'chat:cliError', // ⭐ ADD - CLI error occurred
} as const;
```

**Summary**: Add 7 new message type constants (4 tool types, 2 session types, 1 health type)

---

### 1.2 Add Payload Interfaces

**File**: `libs/shared/src/lib/types/message.types.ts`

**Changes**:

```typescript
// Add these payload interfaces to MessagePayloadMap

/**
 * Thinking event payload (Claude's reasoning process)
 */
export interface ChatThinkingPayload {
  readonly sessionId: SessionId;
  readonly content: string; // Thinking text
  readonly timestamp: number;
}

/**
 * Tool execution payloads
 */
export interface ChatToolStartPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly tool: string; // Tool name (e.g., "Read", "Bash")
  readonly args: Record<string, unknown>;
  readonly timestamp: number;
}

export interface ChatToolProgressPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly message: string; // Progress message
  readonly timestamp: number;
}

export interface ChatToolResultPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly output: unknown; // Tool output (can be string, object, etc.)
  readonly duration: number; // Milliseconds
  readonly timestamp: number;
}

export interface ChatToolErrorPayload {
  readonly sessionId: SessionId;
  readonly toolCallId: string;
  readonly error: string; // Error message
  readonly timestamp: number;
}

/**
 * Session lifecycle payloads
 */
export interface ChatSessionInitPayload {
  readonly sessionId: SessionId;
  readonly claudeSessionId: string; // CLI's internal session ID
  readonly model?: string; // Model name
  readonly timestamp: number;
}

export interface ChatSessionEndPayload {
  readonly sessionId: SessionId;
  readonly reason?: string; // Exit reason (e.g., "completed", "error", "killed")
  readonly timestamp: number;
}

/**
 * Health update payload
 */
export interface ChatHealthUpdatePayload {
  readonly available: boolean;
  readonly version?: string;
  readonly responseTime?: number; // Health check latency in ms
  readonly error?: string;
  readonly timestamp: number;
}

/**
 * CLI error payload
 */
export interface ChatCliErrorPayload {
  readonly sessionId?: SessionId;
  readonly error: string;
  readonly context?: Record<string, unknown>; // Additional error context
  readonly timestamp: number;
}
```

**Then add to MessagePayloadMap**:

```typescript
export interface MessagePayloadMap {
  // ... existing mappings ...

  // ⭐ ADD these mappings:
  'chat:thinking': ChatThinkingPayload;
  'chat:toolStart': ChatToolStartPayload;
  'chat:toolProgress': ChatToolProgressPayload;
  'chat:toolResult': ChatToolResultPayload;
  'chat:toolError': ChatToolErrorPayload;
  'chat:sessionInit': ChatSessionInitPayload;
  'chat:sessionEnd': ChatSessionEndPayload;
  'chat:healthUpdate': ChatHealthUpdatePayload;
  'chat:cliError': ChatCliErrorPayload;
}
```

**Validation**: Run `nx run shared:typecheck` to ensure no TypeScript errors

---

## 📡 Layer 2: EventBus Relay Service

### 2.1 Create Relay Service

**File**: `apps/ptah-extension-vscode/src/services/claude-event-relay.service.ts` (NEW)

**Implementation**:

```typescript
/**
 * Claude Event Relay Service
 *
 * Purpose: Bridge CLAUDE_DOMAIN_EVENTS (EventBus) to CHAT_MESSAGE_TYPES (Webview)
 *
 * Architecture:
 * - Subscribes to all 15 CLAUDE_DOMAIN_EVENTS
 * - Maps claude:* events → chat:* messages
 * - Forwards to webview via WebviewManager.postMessage()
 *
 * This service fills the critical gap identified in EVENT_SYSTEM_GAP_ANALYSIS.md
 */

import { injectable, inject } from 'tsyringe';
import { Subscription } from 'rxjs';
import { TOKENS, EventBus } from '@ptah-extension/vscode-core';
import { CLAUDE_DOMAIN_EVENTS } from '@ptah-extension/claude-domain';
import type { ClaudeContentChunkEvent, ClaudeThinkingEventPayload, ClaudeToolEventPayload, ClaudePermissionRequestEvent, ClaudePermissionResponseEvent, ClaudeAgentStartedEvent, ClaudeAgentActivityEventPayload, ClaudeAgentCompletedEvent, ClaudeSessionInitEvent, ClaudeSessionEndEvent, ClaudeHealthUpdateEvent, ClaudeErrorEvent } from '@ptah-extension/claude-domain';
import { CHAT_MESSAGE_TYPES, type ChatMessageChunkPayload, type ChatThinkingPayload, type ChatToolStartPayload, type ChatToolProgressPayload, type ChatToolResultPayload, type ChatToolErrorPayload, type ChatPermissionRequestPayload, type ChatPermissionResponsePayload, type ChatAgentStartedPayload, type ChatAgentActivityPayload, type ChatAgentCompletedPayload, type ChatSessionInitPayload, type ChatSessionEndPayload, type ChatHealthUpdatePayload, type ChatCliErrorPayload } from '@ptah-extension/shared';

export interface IWebviewManager {
  postMessage(message: { type: string; payload: unknown }): boolean;
}

@injectable()
export class ClaudeEventRelayService {
  private subscriptions: Subscription[] = [];

  constructor(@inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus, @inject(TOKENS.WEBVIEW_MANAGER) private readonly webviewManager: IWebviewManager, @inject(TOKENS.LOGGER) private readonly logger: any) {}

  /**
   * Initialize all EventBus → Webview subscriptions
   */
  initialize(): void {
    this.logger.info('[ClaudeEventRelay] Initializing event relay subscriptions...');

    // 1. Content streaming chunks
    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeContentChunkEvent>(CLAUDE_DOMAIN_EVENTS.CONTENT_CHUNK).subscribe((event) => {
        const payload: ChatMessageChunkPayload = {
          sessionId: event.payload.sessionId,
          messageId: event.payload.chunk.messageId || MessageId.create(), // Fallback if missing
          content: event.payload.chunk.delta,
          isComplete: false,
          streaming: true,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.MESSAGE_CHUNK,
          payload,
        });
      })
    );

    // 2. Thinking events
    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeThinkingEventPayload>(CLAUDE_DOMAIN_EVENTS.THINKING).subscribe((event) => {
        const payload: ChatThinkingPayload = {
          sessionId: event.payload.sessionId,
          content: event.payload.thinking.content,
          timestamp: event.payload.thinking.timestamp,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.THINKING,
          payload,
        });
      })
    );

    // 3. Tool events (start, progress, result, error)
    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeToolEventPayload>(CLAUDE_DOMAIN_EVENTS.TOOL_START).subscribe((event) => {
        const payload: ChatToolStartPayload = {
          sessionId: event.payload.sessionId,
          toolCallId: event.payload.event.toolCallId,
          tool: event.payload.event.tool || 'unknown',
          args: event.payload.event.args || {},
          timestamp: event.payload.event.timestamp,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.TOOL_START,
          payload,
        });
      })
    );

    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeToolEventPayload>(CLAUDE_DOMAIN_EVENTS.TOOL_PROGRESS).subscribe((event) => {
        const payload: ChatToolProgressPayload = {
          sessionId: event.payload.sessionId,
          toolCallId: event.payload.event.toolCallId,
          message: event.payload.event.message || '',
          timestamp: event.payload.event.timestamp,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.TOOL_PROGRESS,
          payload,
        });
      })
    );

    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeToolEventPayload>(CLAUDE_DOMAIN_EVENTS.TOOL_RESULT).subscribe((event) => {
        const payload: ChatToolResultPayload = {
          sessionId: event.payload.sessionId,
          toolCallId: event.payload.event.toolCallId,
          output: event.payload.event.output,
          duration: event.payload.event.duration || 0,
          timestamp: event.payload.event.timestamp,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.TOOL_RESULT,
          payload,
        });
      })
    );

    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeToolEventPayload>(CLAUDE_DOMAIN_EVENTS.TOOL_ERROR).subscribe((event) => {
        const payload: ChatToolErrorPayload = {
          sessionId: event.payload.sessionId,
          toolCallId: event.payload.event.toolCallId,
          error: event.payload.event.error || 'Unknown tool error',
          timestamp: event.payload.event.timestamp,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.TOOL_ERROR,
          payload,
        });
      })
    );

    // 4. Permission events
    this.subscriptions.push(
      this.eventBus.subscribe<ClaudePermissionRequestEvent>(CLAUDE_DOMAIN_EVENTS.PERMISSION_REQUESTED).subscribe((event) => {
        const payload: ChatPermissionRequestPayload = {
          id: event.payload.request.toolCallId,
          tool: event.payload.request.tool,
          action: JSON.stringify(event.payload.request.args), // Serialize args as action
          description: event.payload.request.description,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.PERMISSION_REQUEST,
          payload,
        });
      })
    );

    this.subscriptions.push(
      this.eventBus.subscribe<ClaudePermissionResponseEvent>(CLAUDE_DOMAIN_EVENTS.PERMISSION_RESPONDED).subscribe((event) => {
        const payload: ChatPermissionResponsePayload = {
          requestId: event.payload.response.toolCallId,
          response: event.payload.response.decision,
          timestamp: event.payload.response.timestamp,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE,
          payload,
        });
      })
    );

    // 5. Agent lifecycle events
    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeAgentStartedEvent>(CLAUDE_DOMAIN_EVENTS.AGENT_STARTED).subscribe((event) => {
        const payload: ChatAgentStartedPayload = {
          sessionId: event.payload.sessionId,
          agentId: event.payload.agent.agentId,
          subagentType: event.payload.agent.subagentType,
          description: event.payload.agent.description,
          timestamp: event.payload.agent.timestamp,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.AGENT_STARTED,
          payload,
        });
      })
    );

    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeAgentActivityEventPayload>(CLAUDE_DOMAIN_EVENTS.AGENT_ACTIVITY).subscribe((event) => {
        const payload: ChatAgentActivityPayload = {
          sessionId: event.payload.sessionId,
          agentId: event.payload.agent.agentId,
          toolName: event.payload.agent.toolName,
          timestamp: event.payload.agent.timestamp,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.AGENT_ACTIVITY,
          payload,
        });
      })
    );

    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeAgentCompletedEvent>(CLAUDE_DOMAIN_EVENTS.AGENT_COMPLETED).subscribe((event) => {
        const payload: ChatAgentCompletedPayload = {
          sessionId: event.payload.sessionId,
          agentId: event.payload.agent.agentId,
          duration: event.payload.agent.duration,
          result: event.payload.agent.result,
          timestamp: event.payload.agent.timestamp,
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.AGENT_COMPLETED,
          payload,
        });
      })
    );

    // 6. Session lifecycle
    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeSessionInitEvent>(CLAUDE_DOMAIN_EVENTS.SESSION_INIT).subscribe((event) => {
        const payload: ChatSessionInitPayload = {
          sessionId: event.payload.sessionId,
          claudeSessionId: event.payload.claudeSessionId,
          model: event.payload.model,
          timestamp: Date.now(),
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.SESSION_INIT,
          payload,
        });
      })
    );

    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeSessionEndEvent>(CLAUDE_DOMAIN_EVENTS.SESSION_END).subscribe((event) => {
        const payload: ChatSessionEndPayload = {
          sessionId: event.payload.sessionId,
          reason: event.payload.reason,
          timestamp: Date.now(),
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.SESSION_END,
          payload,
        });
      })
    );

    // 7. Health updates
    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeHealthUpdateEvent>(CLAUDE_DOMAIN_EVENTS.HEALTH_UPDATE).subscribe((event) => {
        const payload: ChatHealthUpdatePayload = {
          available: event.payload.health.available,
          version: event.payload.health.version,
          responseTime: event.payload.health.responseTime,
          error: event.payload.health.error,
          timestamp: Date.now(),
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.HEALTH_UPDATE,
          payload,
        });
      })
    );

    // 8. CLI errors
    this.subscriptions.push(
      this.eventBus.subscribe<ClaudeErrorEvent>(CLAUDE_DOMAIN_EVENTS.CLI_ERROR).subscribe((event) => {
        const payload: ChatCliErrorPayload = {
          sessionId: event.payload.sessionId,
          error: event.payload.error,
          context: event.payload.context,
          timestamp: Date.now(),
        };

        this.webviewManager.postMessage({
          type: CHAT_MESSAGE_TYPES.CLI_ERROR,
          payload,
        });
      })
    );

    this.logger.info(`[ClaudeEventRelay] Initialized ${this.subscriptions.length} event relay subscriptions`);
  }

  /**
   * Clean up all subscriptions
   */
  dispose(): void {
    this.logger.info('[ClaudeEventRelay] Disposing event relay subscriptions...');
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }
}
```

---

### 2.2 Register Relay Service

**File**: `apps/ptah-extension-vscode/src/core/ptah-extension.ts`

**Changes**:

```typescript
import { ClaudeEventRelayService } from '../services/claude-event-relay.service';

export class PtahExtension {
  private claudeEventRelay?: ClaudeEventRelayService;

  async initialize(context: vscode.ExtensionContext): Promise<void> {
    // ... existing initialization ...

    // Initialize Claude event relay (after webview provider)
    this.claudeEventRelay = this.container.resolve(ClaudeEventRelayService);
    this.claudeEventRelay.initialize();

    this.logger.info('Ptah Extension initialization complete');
  }

  dispose(): void {
    // ... existing dispose ...

    // Dispose event relay
    if (this.claudeEventRelay) {
      this.claudeEventRelay.dispose();
    }
  }
}
```

**File**: `apps/ptah-extension-vscode/src/core/di-container.ts`

**Changes**:

```typescript
import { ClaudeEventRelayService } from '../services/claude-event-relay.service';

// Register service in DI container
container.register(ClaudeEventRelayService, { useClass: ClaudeEventRelayService });
```

---

## 🎯 Layer 3: Frontend Subscriptions

### 3.1 Add ChatService Subscriptions

**File**: `libs/frontend/core/src/lib/services/chat.service.ts`

**Changes** (in `initializeMessageHandling()` or constructor):

```typescript
/**
 * Initialize all message type subscriptions
 */
private initializeMessageHandling(): void {
  // ✅ Already exists - MESSAGE_CHUNK
  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleMessageChunk(payload));

  // ⭐ ADD - Thinking events
  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.THINKING)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleThinking(payload));

  // ⭐ ADD - Tool execution events
  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.TOOL_START)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleToolStart(payload));

  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.TOOL_PROGRESS)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleToolProgress(payload));

  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.TOOL_RESULT)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleToolResult(payload));

  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.TOOL_ERROR)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleToolError(payload));

  // ⭐ ADD - Permission events
  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.PERMISSION_REQUEST)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handlePermissionRequest(payload));

  // ⭐ ADD - Agent lifecycle events
  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.AGENT_STARTED)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleAgentStarted(payload));

  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.AGENT_ACTIVITY)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleAgentActivity(payload));

  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.AGENT_COMPLETED)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleAgentCompleted(payload));

  // ⭐ ADD - Session lifecycle
  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.SESSION_INIT)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleSessionInit(payload));

  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.SESSION_END)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleSessionEnd(payload));

  // ⭐ ADD - Health/error events
  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.HEALTH_UPDATE)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleHealthUpdate(payload));

  this.vscode
    .onMessageType(CHAT_MESSAGE_TYPES.CLI_ERROR)
    .pipe(takeUntilDestroyed(this.destroyRef))
    .subscribe((payload) => this.handleCliError(payload));
}
```

### 3.2 Add Handler Methods

```typescript
// ⭐ ADD - Thinking handler
private handleThinking(payload: ChatThinkingPayload): void {
  this.logger.debug('Thinking event received', 'ChatService', {
    sessionId: payload.sessionId,
    contentLength: payload.content.length,
  });

  // Store in signal for UI display
  this._currentThinking.set(payload.content);
}

// ⭐ ADD - Tool handlers
private handleToolStart(payload: ChatToolStartPayload): void {
  this.logger.debug('Tool execution started', 'ChatService', {
    tool: payload.tool,
    toolCallId: payload.toolCallId,
  });

  // Store in tool execution state
  this._toolExecutions.update((executions) => ({
    ...executions,
    [payload.toolCallId]: {
      tool: payload.tool,
      args: payload.args,
      status: 'running',
      startTime: payload.timestamp,
    },
  }));
}

private handleToolProgress(payload: ChatToolProgressPayload): void {
  this._toolExecutions.update((executions) => {
    const existing = executions[payload.toolCallId];
    if (!existing) return executions;

    return {
      ...executions,
      [payload.toolCallId]: {
        ...existing,
        progress: payload.message,
      },
    };
  });
}

private handleToolResult(payload: ChatToolResultPayload): void {
  this._toolExecutions.update((executions) => {
    const existing = executions[payload.toolCallId];
    if (!existing) return executions;

    return {
      ...executions,
      [payload.toolCallId]: {
        ...existing,
        status: 'completed',
        output: payload.output,
        duration: payload.duration,
      },
    };
  });
}

private handleToolError(payload: ChatToolErrorPayload): void {
  this._toolExecutions.update((executions) => {
    const existing = executions[payload.toolCallId];
    if (!existing) return executions;

    return {
      ...executions,
      [payload.toolCallId]: {
        ...existing,
        status: 'error',
        error: payload.error,
      },
    };
  });
}

// ⭐ ADD - Permission handler
private handlePermissionRequest(payload: ChatPermissionRequestPayload): void {
  this.logger.info('Permission request received', 'ChatService', {
    id: payload.id,
    tool: payload.tool,
  });

  // Store in signal for UI dialog
  this._currentPermissionRequest.set(payload);
}

// ⭐ ADD - Agent handlers
private handleAgentStarted(payload: ChatAgentStartedPayload): void {
  this._agentTimeline.update((timeline) => [
    ...timeline,
    {
      agentId: payload.agentId,
      type: payload.subagentType,
      description: payload.description,
      status: 'running',
      startTime: payload.timestamp,
    },
  ]);
}

private handleAgentActivity(payload: ChatAgentActivityPayload): void {
  // Update agent timeline with tool usage
  this._agentTimeline.update((timeline) =>
    timeline.map((agent) =>
      agent.agentId === payload.agentId
        ? {
            ...agent,
            lastActivity: {
              tool: payload.toolName,
              timestamp: payload.timestamp,
            },
          }
        : agent
    )
  );
}

private handleAgentCompleted(payload: ChatAgentCompletedPayload): void {
  this._agentTimeline.update((timeline) =>
    timeline.map((agent) =>
      agent.agentId === payload.agentId
        ? {
            ...agent,
            status: 'completed',
            duration: payload.duration,
            result: payload.result,
          }
        : agent
    )
  );
}

// ⭐ ADD - Session lifecycle handlers
private handleSessionInit(payload: ChatSessionInitPayload): void {
  this.logger.info('CLI session initialized', 'ChatService', {
    sessionId: payload.sessionId,
    model: payload.model,
  });
}

private handleSessionEnd(payload: ChatSessionEndPayload): void {
  this.logger.info('CLI session ended', 'ChatService', {
    sessionId: payload.sessionId,
    reason: payload.reason,
  });
}

// ⭐ ADD - Health/error handlers
private handleHealthUpdate(payload: ChatHealthUpdatePayload): void {
  this._cliHealth.set({
    available: payload.available,
    version: payload.version,
    responseTime: payload.responseTime,
    error: payload.error,
  });
}

private handleCliError(payload: ChatCliErrorPayload): void {
  this.logger.error('CLI error occurred', 'ChatService', {
    error: payload.error,
    context: payload.context,
  });

  // Display error to user via notification or error banner
  this._lastError.set(payload.error);
}
```

### 3.3 Add Signal State

```typescript
// ⭐ ADD - New signals for event state
private readonly _currentThinking = signal<string | null>(null);
private readonly _toolExecutions = signal<Record<string, ToolExecution>>({});
private readonly _currentPermissionRequest = signal<ChatPermissionRequestPayload | null>(null);
private readonly _agentTimeline = signal<AgentTimelineEntry[]>([]);
private readonly _cliHealth = signal<CliHealthStatus | null>(null);
private readonly _lastError = signal<string | null>(null);

// Public readonly accessors
readonly currentThinking = this._currentThinking.asReadonly();
readonly toolExecutions = this._toolExecutions.asReadonly();
readonly currentPermissionRequest = this._currentPermissionRequest.asReadonly();
readonly agentTimeline = this._agentTimeline.asReadonly();
readonly cliHealth = this._cliHealth.asReadonly();
readonly lastError = this._lastError.asReadonly();
```

---

## 🎨 Layer 4: UI Components

### 4.1 Permission Dialog Component

**File**: `libs/frontend/chat/src/lib/components/permission-dialog/permission-dialog.component.ts` (NEW)

**Template**:

```html
@if (permissionRequest(); as request) {
<div class="permission-dialog-overlay" (click)="handleDeny()">
  <div class="permission-dialog" (click)="$event.stopPropagation()">
    <div class="permission-header">
      <h3>Permission Required</h3>
      <span class="tool-name">{{ request.tool }}</span>
    </div>

    <div class="permission-body">
      <p class="permission-description">{{ request.description || 'Claude wants to execute this tool' }}</p>

      <div class="permission-action">
        <code>{{ request.action }}</code>
      </div>
    </div>

    <div class="permission-footer">
      <button class="btn btn-secondary" (click)="handleDeny()">Deny</button>
      <button class="btn btn-primary" (click)="handleAllow()">Allow Once</button>
      <button class="btn btn-primary-alt" (click)="handleAlwaysAllow()">Always Allow</button>
    </div>
  </div>
</div>
}
```

**Component**:

```typescript
import { Component, inject, computed } from '@angular/core';
import { ChatService } from '@ptah-extension/core';
import { VSCodeService } from '@ptah-extension/core';
import { CHAT_MESSAGE_TYPES } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-permission-dialog',
  standalone: true,
  templateUrl: './permission-dialog.component.html',
  styleUrls: ['./permission-dialog.component.scss'],
})
export class PermissionDialogComponent {
  private readonly chatService = inject(ChatService);
  private readonly vscode = inject(VSCodeService);

  readonly permissionRequest = this.chatService.currentPermissionRequest;

  handleAllow(): void {
    const request = this.permissionRequest();
    if (!request) return;

    this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE, {
      requestId: request.id,
      response: 'allow',
      timestamp: Date.now(),
    });

    this.chatService.clearPermissionRequest();
  }

  handleAlwaysAllow(): void {
    const request = this.permissionRequest();
    if (!request) return;

    this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE, {
      requestId: request.id,
      response: 'always_allow',
      timestamp: Date.now(),
    });

    this.chatService.clearPermissionRequest();
  }

  handleDeny(): void {
    const request = this.permissionRequest();
    if (!request) return;

    this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE, {
      requestId: request.id,
      response: 'deny',
      timestamp: Date.now(),
    });

    this.chatService.clearPermissionRequest();
  }
}
```

---

### 4.2 Tool Execution Timeline Component

**File**: `libs/frontend/chat/src/lib/components/tool-timeline/tool-timeline.component.ts` (NEW)

**Template**:

```html
<div class="tool-timeline">
  @for (execution of sortedExecutions(); track execution.toolCallId) {
  <div class="tool-execution" [class.running]="execution.status === 'running'">
    <div class="tool-header">
      <span class="tool-icon"> @switch (execution.status) { @case ('running') { ⏳ } @case ('completed') { ✅ } @case ('error') { ❌ } } </span>
      <span class="tool-name">{{ execution.tool }}</span>
      @if (execution.duration) {
      <span class="tool-duration">{{ execution.duration }}ms</span>
      }
    </div>

    @if (execution.progress) {
    <div class="tool-progress">{{ execution.progress }}</div>
    } @if (execution.error) {
    <div class="tool-error">{{ execution.error }}</div>
    }
  </div>
  }
</div>
```

---

### 4.3 Thinking Display Component

**File**: `libs/frontend/chat/src/lib/components/thinking-display/thinking-display.component.ts` (NEW)

**Template**:

```html
@if (thinking(); as content) {
<div class="thinking-display">
  <details class="thinking-details" [open]="autoExpanded()">
    <summary class="thinking-summary">
      <span class="thinking-icon">💭</span>
      <span class="thinking-label">Claude is thinking...</span>
      <span class="thinking-length">{{ content.length }} chars</span>
    </summary>

    <div class="thinking-content">
      <pre>{{ content }}</pre>
    </div>
  </details>
</div>
}
```

---

### 4.4 Agent Timeline Component

**File**: `libs/frontend/chat/src/lib/components/agent-timeline/agent-timeline.component.ts` (NEW)

**Template**:

```html
<div class="agent-timeline">
  @for (agent of timeline(); track agent.agentId) {
  <div class="agent-entry" [class.running]="agent.status === 'running'">
    <div class="agent-header">
      <span class="agent-icon">🤖</span>
      <span class="agent-type">{{ agent.type }}</span>
      @if (agent.duration) {
      <span class="agent-duration">{{ formatDuration(agent.duration) }}</span>
      }
    </div>

    <div class="agent-description">{{ agent.description }}</div>

    @if (agent.lastActivity) {
    <div class="agent-activity">Last used: {{ agent.lastActivity.tool }}</div>
    } @if (agent.result) {
    <div class="agent-result">
      <pre>{{ agent.result }}</pre>
    </div>
    }
  </div>
  }
</div>
```

---

## ✅ Layer 5: Testing & Validation

### 5.1 Manual Testing Checklist

```markdown
## Test Procedure

### Prerequisites

- [ ] Build extension: `npm run build:all`
- [ ] Launch Extension Development Host (F5)
- [ ] Have Claude CLI installed and accessible

### Test 1: Message Streaming

- [ ] Send a message to Claude
- [ ] Verify text appears progressively (typewriter effect)
- [ ] Check browser DevTools console for MESSAGE_CHUNK logs
- [ ] Verify no "Received unknown message type" warnings

### Test 2: Thinking Display

- [ ] Send complex request requiring reasoning
- [ ] Verify thinking panel appears with 💭 icon
- [ ] Expand panel and verify reasoning content displays
- [ ] Check for THINKING message type in console

### Test 3: Tool Execution Timeline

- [ ] Send request that uses Read/Edit/Bash tools
- [ ] Verify tool timeline shows each tool with status icons
- [ ] Check TOOL_START/PROGRESS/RESULT messages in console
- [ ] Verify duration and output display correctly

### Test 4: Permission Popups

- [ ] Send request requiring file write permission
- [ ] Verify permission dialog appears with Allow/Deny/Always buttons
- [ ] Click "Allow" and verify action completes
- [ ] Check PERMISSION_REQUEST/RESPONSE messages in console

### Test 5: Agent Timeline

- [ ] Use /orchestrate command to spawn agents
- [ ] Verify agent timeline shows nested agent execution
- [ ] Check AGENT_STARTED/ACTIVITY/COMPLETED messages
- [ ] Verify duration and result display after completion

### Test 6: Session Lifecycle

- [ ] Monitor console for SESSION_INIT on first message
- [ ] Stop streaming and check for SESSION_END
- [ ] Verify sessionId matches between events

### Test 7: Health Monitoring

- [ ] Check for HEALTH_UPDATE messages on startup
- [ ] Simulate CLI unavailability (rename binary)
- [ ] Verify health status badge shows error state

### Test 8: Error Handling

- [ ] Send invalid request to trigger CLI error
- [ ] Verify CLI_ERROR message appears
- [ ] Check error banner displays in UI
```

---

### 5.2 Automated Tests (Future)

**File**: `libs/frontend/core/src/lib/services/chat.service.spec.ts`

```typescript
describe('ChatService - Event Handling', () => {
  it('should handle MESSAGE_CHUNK events', () => {
    // Test chunk processing
  });

  it('should handle THINKING events', () => {
    // Test thinking display
  });

  it('should handle TOOL_START/PROGRESS/RESULT/ERROR events', () => {
    // Test tool timeline
  });

  it('should handle PERMISSION_REQUEST events', () => {
    // Test permission dialog display
  });

  it('should handle AGENT lifecycle events', () => {
    // Test agent timeline
  });

  it('should handle SESSION_INIT/END events', () => {
    // Test session lifecycle
  });

  it('should handle HEALTH_UPDATE events', () => {
    // Test health status badge
  });

  it('should handle CLI_ERROR events', () => {
    // Test error display
  });
});
```

---

## 📊 Implementation Progress Tracking

| Layer     | Task                       | Status     | Files Changed | Estimated Time |
| --------- | -------------------------- | ---------- | ------------- | -------------- |
| **1**     | Add MESSAGE_TYPES          | ⏳ Pending | 1             | 15 min         |
| **1**     | Add Payload Interfaces     | ⏳ Pending | 1             | 30 min         |
| **2**     | Create Relay Service       | ⏳ Pending | 1 (new)       | 1.5 hours      |
| **2**     | Register Relay Service     | ⏳ Pending | 2             | 15 min         |
| **3**     | Add Frontend Subscriptions | ⏳ Pending | 1             | 45 min         |
| **3**     | Add Handler Methods        | ⏳ Pending | 1             | 45 min         |
| **3**     | Add Signal State           | ⏳ Pending | 1             | 15 min         |
| **4**     | Permission Dialog UI       | ⏳ Pending | 3 (new)       | 1.5 hours      |
| **4**     | Tool Timeline UI           | ⏳ Pending | 3 (new)       | 2 hours        |
| **4**     | Thinking Display UI        | ⏳ Pending | 3 (new)       | 1 hour         |
| **4**     | Agent Timeline UI          | ⏳ Pending | 3 (new)       | 2 hours        |
| **5**     | Manual Testing             | ⏳ Pending | 0             | 2 hours        |
| **Total** |                            |            | **~17 files** | **~13 hours**  |

---

## 🎯 Acceptance Criteria

### Critical (Must Have)

- [ ] All 15 CLAUDE_DOMAIN_EVENTS forwarded to webview
- [ ] All 15 message types have frontend subscriptions
- [ ] Real-time streaming works without manual workarounds
- [ ] Permission dialogs display and respond correctly
- [ ] Tool execution timeline shows all tool events
- [ ] No "unknown message type" console warnings

### Important (Should Have)

- [ ] Thinking display shows Claude's reasoning
- [ ] Agent timeline shows nested agent execution
- [ ] Health status badge shows CLI availability
- [ ] CLI errors display in error banner

### Nice to Have (Could Have)

- [ ] Thinking panel auto-expands for long reasoning
- [ ] Tool timeline shows progress bars
- [ ] Agent timeline shows duration charts
- [ ] Automated end-to-end tests

---

**Next Step**: Begin Layer 1 implementation by adding missing MESSAGE_TYPES constants.
