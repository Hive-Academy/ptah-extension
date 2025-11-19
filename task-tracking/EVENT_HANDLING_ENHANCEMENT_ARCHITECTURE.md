# Event Handling Enhancement Architecture - Intelligence-Driven Design

**Document Version**: 1.0
**Created**: 2025-11-19
**Status**: Architecture Specification

## Executive Summary

This document specifies a comprehensive event handling enhancement strategy that fixes current architectural gaps and enables IMPLEMENTATION_PLAN features for the Ptah VS Code extension.

**Critical Finding**: The current architecture has a **semantic mismatch** between event publishers and consumers:

- **ClaudeDomainEventPublisher** publishes `claude:*` events (claude-domain.events.ts:24-59)
- **WebviewMessageBridge** forwards `chat:*` events (webview-message-bridge.ts:74-125)
- **No translation layer exists** to bridge these event domains

**Impact**: Missing events never reach the frontend, causing incomplete UI updates and lost data.

---

## 1. Architectural Principles

### 1.1 Core Design Principles

1. **Event Domain Separation**: Maintain distinct event vocabularies for internal (claude:_) and external (chat:_) event domains
2. **Single Responsibility**: Each layer handles ONE event transformation concern
3. **Zero Event Loss**: 100% delivery guarantee through explicit translation and forwarding rules
4. **Type Safety First**: Compile-time verification of all event transformations
5. **Performance Conscious**: Minimal overhead, efficient pattern matching, zero duplication
6. **Evidence-Based Design**: All decisions backed by codebase investigation

### 1.2 Design Philosophy

**REJECTED APPROACH**: Unify claude:_ and chat:_ into a single event domain

**Rationale**:

- `claude:*` events are **internal domain events** (CLI integration, process lifecycle)
- `chat:*` events are **user-facing feature events** (UI interactions, session management)
- Mixing these violates separation of concerns and creates semantic confusion

**ACCEPTED APPROACH**: Explicit **Event Translation Layer** that bridges domains

**Benefits**:

- Clear semantic boundaries between backend infrastructure and frontend features
- Enables independent evolution of CLI events and UI events
- Maintains type safety through explicit translation contracts

---

## 2. Current Architecture Analysis

### 2.1 Event Flow Evidence

**Investigation Results** (claude-cli-launcher.ts:307-384):

```typescript
// JSONL Parser callbacks (line 307-384)
onContent: (chunk) => {
  this.deps.eventPublisher.emitContentChunk(sessionId, chunk);  // ← Publishes claude:content:chunk
},
onPermission: async (request) => {
  await this.handlePermissionRequest(sessionId, request, childProcess);  // ← Publishes claude:permission:requested
},
onResult: (result) => {
  this.deps.eventPublisher.emitTokenUsage(sessionId, {...});  // ← Publishes claude:token:usage
  this.deps.eventPublisher.emitSessionEnd(sessionId, reason);  // ← Publishes claude:session:end
},
```

**Evidence**: ClaudeDomainEventPublisher publishes 13 distinct `claude:*` event topics (claude-domain.events.ts:24-59)

### 2.2 Current Forwarding Rules Evidence

**Investigation Results** (webview-message-bridge.ts:74-125):

```typescript
alwaysForward: [
  // Chat streaming events
  CHAT_MESSAGE_TYPES.MESSAGE_CHUNK,      // chat:messageChunk
  CHAT_MESSAGE_TYPES.THINKING,           // chat:thinking
  CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE,   // chat:messageComplete
  // ... 30+ chat:* events
],
```

**Critical Gap Identified**:

- **Forwarding rules**: Only `chat:*` events (line 74-125)
- **EventBus receives**: Both `claude:*` and `chat:*` events
- **Missing**: Translation from `claude:*` → `chat:*`

### 2.3 Frontend Subscription Evidence

**Investigation Results** (chat.service.ts:429-510, 750-804):

```typescript
// ChatService subscribes to chat:* events
this.vscode.onMessageType(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK); // chat:messageChunk
this.vscode.onMessageType(CHAT_MESSAGE_TYPES.THINKING); // chat:thinking
this.vscode.onMessageType(CHAT_MESSAGE_TYPES.PERMISSION_REQUEST); // chat:permissionRequest
this.vscode.onMessageType(CHAT_MESSAGE_TYPES.TOOL_START); // chat:toolStart
// ... 20+ chat:* subscriptions
```

**Evidence**: Frontend expects `chat:*` events but backend publishes `claude:*` events

### 2.4 Root Cause Analysis

**Gap 1: No Event Translation**

- **Where**: Between ClaudeDomainEventPublisher and WebviewMessageBridge
- **Impact**: `claude:*` events never converted to `chat:*` events
- **Result**: Frontend subscriptions never fire

**Gap 2: Incomplete Forwarding Rules**

- **Where**: WebviewMessageBridge.forwardingRules (webview-message-bridge.ts:72-144)
- **Impact**: Even if translated, some events missing from forwarding rules
- **Result**: Events dropped at bridge layer

**Gap 3: Missing Result Events**

- **Where**: ClaudeCliLauncher.onResult callback (claude-cli-launcher.ts:363-384)
- **Impact**: Token usage and session end events published but never forwarded
- **Result**: UI never updates token counts or final costs

---

## 3. Proposed Architecture

### 3.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ JSONL Parser (11 callbacks)                                              │
│ ├── onContent → emitContentChunk(claude:content:chunk)                   │
│ ├── onThinking → emitThinking(claude:thinking)                           │
│ ├── onTool → emitToolEvent(claude:tool:*)                                │
│ ├── onPermission → emitPermissionRequested(claude:permission:requested)  │
│ ├── onResult → emitTokenUsage(claude:token:usage)                        │
│ └── onMessageStop → emitMessageComplete(claude:message:complete)         │
└──────────────────────────────────────────────────────────────────────────┘
                                   ↓
┌──────────────────────────────────────────────────────────────────────────┐
│ ClaudeDomainEventPublisher (claude-domain)                               │
│ - Publishes 13 claude:* event topics to EventBus                         │
└──────────────────────────────────────────────────────────────────────────┘
                                   ↓
┌──────────────────────────────────────────────────────────────────────────┐
│ EventBus (vscode-core)                                                    │
│ - Central pub/sub (event-bus.ts)                                         │
│ - Emits all events to subscribers                                        │
└──────────────────────────────────────────────────────────────────────────┘
                                   ↓
┌──────────────────────────────────────────────────────────────────────────┐
│ ⭐ NEW: EventTranslationService (vscode-core/messaging)                  │
│                                                                            │
│ RESPONSIBILITY: Translate claude:* → chat:* events                       │
│                                                                            │
│ subscribe(EventBus, 'claude:*') → {                                      │
│   const chatEvent = translateClaudeToChatEvent(claudeEvent);            │
│   EventBus.publish(chatEvent.type, chatEvent.payload);                  │
│ }                                                                         │
│                                                                            │
│ PATTERN: Observer pattern - listens to claude:* events                   │
│ OUTPUT: Publishes equivalent chat:* events                               │
└──────────────────────────────────────────────────────────────────────────┘
                                   ↓
┌──────────────────────────────────────────────────────────────────────────┐
│ ⚡ ENHANCED: WebviewMessageBridge (vscode-core/messaging)                │
│                                                                            │
│ ENHANCEMENT: Updated forwarding rules to include ALL chat:* events       │
│                                                                            │
│ forwardingRules: {                                                        │
│   alwaysForward: [                                                        │
│     ...CHAT_MESSAGE_TYPES (all 40+ types),                               │
│     ...PROVIDER_MESSAGE_TYPES,                                            │
│     ...CONTEXT_MESSAGE_TYPES,                                             │
│   ],                                                                      │
│   patterns: [(type) => type.endsWith(':response')]                       │
│ }                                                                         │
└──────────────────────────────────────────────────────────────────────────┘
                                   ↓
┌──────────────────────────────────────────────────────────────────────────┐
│ WebviewManager (vscode-core/api-wrappers)                                │
│ - sendMessage(viewType, messageType, payload)                            │
│ - webview.postMessage({ type, payload })                                 │
└──────────────────────────────────────────────────────────────────────────┘
                                   ↓
┌──────────────────────────────────────────────────────────────────────────┐
│ Angular VSCodeService (frontend/core)                                    │
│ - window.addEventListener('message')                                     │
│ - Observable streams per message type                                    │
└──────────────────────────────────────────────────────────────────────────┘
                                   ↓
┌──────────────────────────────────────────────────────────────────────────┘
│ ChatService (frontend/core)                                              │
│ - Subscribes to chat:* events                                            │
│ - Updates signal-based state                                             │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Event Translation Strategy

**Design Decision**: **1:1 Translation** (not N:1 aggregation)

**Rationale**:

- Preserves semantic clarity (one claude:_ event = one chat:_ event)
- Simplifies debugging (direct event traceability)
- Enables independent event evolution
- Maintains type safety through explicit mappings

**Translation Mapping Table**:

| Claude Domain Event           | Chat Domain Event         | Payload Transformation                                                        |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `claude:content:chunk`        | `chat:messageChunk`       | { sessionId, chunk } → { messageId, sessionId, content, isComplete }          |
| `claude:thinking`             | `chat:thinking`           | { sessionId, thinking } → { content, timestamp }                              |
| `claude:tool:start`           | `chat:toolStart`          | { sessionId, event } → { toolCallId, tool, args, timestamp }                  |
| `claude:tool:progress`        | `chat:toolProgress`       | { sessionId, event } → { toolCallId, message, timestamp }                     |
| `claude:tool:result`          | `chat:toolResult`         | { sessionId, event } → { toolCallId, output, duration, timestamp }            |
| `claude:tool:error`           | `chat:toolError`          | { sessionId, event } → { toolCallId, error, timestamp }                       |
| `claude:permission:requested` | `chat:permissionRequest`  | { sessionId, request } → { id, tool, action, description, timestamp }         |
| `claude:permission:responded` | `chat:permissionResponse` | { sessionId, response } → { requestId, response, timestamp }                  |
| `claude:session:init`         | `chat:sessionInit`        | { sessionId, claudeSessionId, model } → { sessionId, claudeSessionId, model } |
| `claude:session:end`          | `chat:sessionEnd`         | { sessionId, reason } → { sessionId, reason }                                 |
| `claude:message:complete`     | `chat:messageComplete`    | { sessionId } → { messageId?, sessionId }                                     |
| `claude:token:usage`          | `chat:tokenUsageUpdated`  | { sessionId, usage } → { sessionId, tokenUsage }                              |
| `claude:health:update`        | `chat:healthUpdate`       | { health } → { available, version, error? }                                   |
| `claude:error`                | `chat:cliError`           | { sessionId?, error, context } → { error, context }                           |
| `claude:agent:started`        | `chat:agentStarted`       | { sessionId, agent } → { agent }                                              |
| `claude:agent:activity`       | `chat:agentActivity`      | { sessionId, agent } → { agent }                                              |
| `claude:agent:completed`      | `chat:agentCompleted`     | { sessionId, agent } → { agent }                                              |

**Evidence**: Mapping derived from:

- CLAUDE_DOMAIN_EVENTS constants (claude-domain.events.ts:24-59)
- CHAT_MESSAGE_TYPES constants (message-types.ts:18-68)
- ChatService subscriptions (chat.service.ts:429-804)

---

## 4. Component Design

### 4.1 EventTranslationService (NEW)

**Location**: `libs/backend/vscode-core/src/messaging/event-translation.service.ts`

**Responsibility**: Subscribe to all `claude:*` events and publish equivalent `chat:*` events

**Pattern**: Observer pattern with EventBus double-publish

**Interface**:

```typescript
/**
 * Event Translation Service - Bridges claude:* and chat:* event domains
 *
 * PURPOSE: Translate internal CLI events to user-facing feature events
 * PATTERN: Observer (subscribes to claude:*) + Publisher (emits chat:*)
 * INTEGRATION: Initializes in DIContainer.setup() BEFORE WebviewMessageBridge
 */
@injectable()
export class EventTranslationService {
  private subscriptions: Subscription[] = [];
  private isInitialized = false;
  private translatedEventCount = 0;
  private failedTranslationCount = 0;

  constructor(@inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus) {}

  /**
   * Initialize translation subscriptions
   * MUST be called AFTER EventBus registration, BEFORE WebviewMessageBridge
   */
  initialize(): void {
    if (this.isInitialized) return;

    // Subscribe to all claude:* events
    this.subscriptions.push(
      this.eventBus.subscribe('claude:content:chunk').subscribe({
        next: (event) => this.translateContentChunk(event),
        error: (error) => this.handleTranslationError('content:chunk', error),
      }),

      this.eventBus.subscribe('claude:thinking').subscribe({
        next: (event) => this.translateThinking(event),
        error: (error) => this.handleTranslationError('thinking', error),
      })

      // ... 15 more subscriptions for each claude:* event type
    );

    this.isInitialized = true;
  }

  /**
   * Translate claude:content:chunk → chat:messageChunk
   */
  private translateContentChunk(event: TypedEvent<'claude:content:chunk'>): void {
    const claudePayload = event.payload as ClaudeContentChunkEvent;

    const chatPayload: ChatMessageChunkPayload = {
      messageId: MessageId.create(), // FIXME: Need messageId from session context
      sessionId: claudePayload.sessionId,
      content: claudePayload.chunk.content,
      isComplete: claudePayload.chunk.isComplete || false,
    };

    this.eventBus.publish('chat:messageChunk', chatPayload, 'extension');
    this.translatedEventCount++;
  }

  /**
   * Translate claude:tool:* → chat:tool*
   */
  private translateToolEvent(event: TypedEvent<string>): void {
    const claudePayload = event.payload as ClaudeToolEventPayload;
    const toolEvent = claudePayload.event;

    // Determine target chat event type
    const chatEventType = toolEvent.type === 'start' ? 'chat:toolStart' : toolEvent.type === 'progress' ? 'chat:toolProgress' : toolEvent.type === 'result' ? 'chat:toolResult' : 'chat:toolError';

    // Transform payload structure
    const chatPayload = {
      toolCallId: toolEvent.toolCallId,
      tool: toolEvent.tool,
      args: toolEvent.args || {},
      timestamp: Date.now(),
      ...(toolEvent.type === 'progress' && { message: toolEvent.message }),
      ...(toolEvent.type === 'result' && { output: toolEvent.output, duration: toolEvent.duration }),
      ...(toolEvent.type === 'error' && { error: toolEvent.error }),
    };

    this.eventBus.publish(chatEventType, chatPayload, 'extension');
    this.translatedEventCount++;
  }

  /**
   * Translate claude:token:usage → chat:tokenUsageUpdated
   * CRITICAL FIX: This event was missing from translation!
   */
  private translateTokenUsage(event: TypedEvent<'claude:token:usage'>): void {
    const claudePayload = event.payload as ClaudeTokenUsageEvent;

    const chatPayload: ChatTokenUsageUpdatedPayload = {
      sessionId: claudePayload.sessionId,
      tokenUsage: {
        input: claudePayload.usage.inputTokens,
        output: claudePayload.usage.outputTokens,
        total: claudePayload.usage.inputTokens + claudePayload.usage.outputTokens,
        percentage: 0, // Calculate based on session context limit
        cacheRead: claudePayload.usage.cacheReadTokens,
        cacheCreation: claudePayload.usage.cacheCreationTokens,
        totalCost: claudePayload.usage.totalCost,
      },
    };

    this.eventBus.publish('chat:tokenUsageUpdated', chatPayload, 'extension');
    this.translatedEventCount++;
  }

  /**
   * Get translation metrics for monitoring
   */
  getMetrics() {
    return {
      isInitialized: this.isInitialized,
      translatedEventCount: this.translatedEventCount,
      failedTranslationCount: this.failedTranslationCount,
      activeSubscriptions: this.subscriptions.length,
    };
  }

  /**
   * Error handling for translation failures
   */
  private handleTranslationError(eventType: string, error: unknown): void {
    console.error(`EventTranslationService: Failed to translate ${eventType}:`, error);
    this.failedTranslationCount++;
  }

  /**
   * Cleanup subscriptions on deactivation
   */
  dispose(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
    this.isInitialized = false;
  }
}
```

**Key Design Decisions**:

1. **Double-Publish Pattern**: Translates events by subscribing to `claude:*` and re-publishing as `chat:*`
2. **Subscription-Based**: Uses EventBus.subscribe() pattern (consistent with WebviewMessageBridge)
3. **Error Isolation**: Each translation is wrapped in error handler to prevent cascading failures
4. **Metrics Tracking**: Counts successful/failed translations for monitoring
5. **Type Safety**: Uses TypedEvent<T> for compile-time verification

**Integration Point**:

```typescript
// In libs/backend/vscode-core/src/di/container.ts

export class DIContainer {
  static setup(context: vscode.ExtensionContext): void {
    // ... existing registrations

    // Register EventTranslationService BEFORE WebviewMessageBridge
    container.registerSingleton(TOKENS.EVENT_TRANSLATION_SERVICE, EventTranslationService);

    // Initialize translation service
    const translator = container.resolve<EventTranslationService>(TOKENS.EVENT_TRANSLATION_SERVICE);
    translator.initialize(); // Start translating claude:* → chat:*

    // Register and initialize WebviewMessageBridge (depends on translation)
    const bridge = container.resolve<WebviewMessageBridge>(TOKENS.WEBVIEW_MESSAGE_BRIDGE);
    bridge.initialize(); // Now forwards translated chat:* events
  }
}
```

**Evidence**: Pattern extracted from WebviewMessageBridge (webview-message-bridge.ts:147-177)

### 4.2 WebviewMessageBridge Enhancement

**Location**: `libs/backend/vscode-core/src/messaging/webview-message-bridge.ts`

**Changes Required**: Update forwarding rules to include ALL chat:\* event types

**Current State** (webview-message-bridge.ts:74-125):

```typescript
alwaysForward: [
  // 30+ manually listed events
],
```

**Proposed Enhancement**:

```typescript
// ENHANCEMENT: Use message type constants for complete coverage
alwaysForward: [
  // Chat events (40+ types)
  ...Object.values(CHAT_MESSAGE_TYPES),

  // Provider events (10+ types)
  ...Object.values(PROVIDER_MESSAGE_TYPES),

  // Context events (7+ types)
  ...Object.values(CONTEXT_MESSAGE_TYPES),

  // System events (selective)
  SYSTEM_MESSAGE_TYPES.THEME_CHANGED,
  SYSTEM_MESSAGE_TYPES.ERROR,
  SYSTEM_MESSAGE_TYPES.INITIAL_DATA,
],

neverForward: [
  // Internal backend-only events
  'commands:executeCommand',
  'analytics:trackEvent',
  'analytics:getData',
],
```

**Rationale**:

- **Exhaustive Coverage**: All `chat:*` events automatically forwarded
- **Type Safety**: Uses constants from message-types.ts (single source of truth)
- **Maintainability**: New event types auto-forwarded (no manual updates)
- **Performance**: Identical performance to manual array (constant-time lookup)

**Evidence**: CHAT_MESSAGE_TYPES constant exports 40+ event types (message-types.ts:18-68)

### 4.3 Message Protocol Consolidation

**Current Issue**: MessagePayloadMap has 94 types spanning 7 domains (shared/CLAUDE.md:149-157)

**Proposed Enhancement**: Add missing `claude:*` event payload types to MessagePayloadMap

**Location**: `libs/shared/src/lib/types/message.types.ts`

**Changes Required**:

```typescript
// ENHANCEMENT: Add claude:* event payloads to MessagePayloadMap
export interface MessagePayloadMap {
  // ... existing 94 types

  // Claude domain events (NEW - 17 types)
  'claude:content:chunk': ClaudeContentChunkEvent;
  'claude:thinking': ClaudeThinkingEventPayload;
  'claude:tool:start': ClaudeToolEventPayload;
  'claude:tool:progress': ClaudeToolEventPayload;
  'claude:tool:result': ClaudeToolEventPayload;
  'claude:tool:error': ClaudeToolEventPayload;
  'claude:permission:requested': ClaudePermissionRequestEvent;
  'claude:permission:responded': ClaudePermissionResponseEvent;
  'claude:session:init': ClaudeSessionInitEvent;
  'claude:session:end': ClaudeSessionEndEvent;
  'claude:message:complete': ClaudeMessageCompleteEvent;
  'claude:token:usage': ClaudeTokenUsageEvent;
  'claude:health:update': ClaudeHealthUpdateEvent;
  'claude:error': ClaudeErrorEvent;
  'claude:agent:started': ClaudeAgentStartedEvent;
  'claude:agent:activity': ClaudeAgentActivityEventPayload;
  'claude:agent:completed': ClaudeAgentCompletedEvent;
}
```

**Benefit**: Enables type-safe EventBus subscriptions for `claude:*` events

**Evidence**: Payload types defined in claude-domain.events.ts:64-138

### 4.4 ChatService Optimization

**Current Issue**: Dual message collections (chat.service.ts:198-199):

```typescript
readonly messages = this.chatState.messages;        // StrictChatMessage[]
readonly claudeMessages = this.chatState.claudeMessages; // ProcessedClaudeMessage[]
```

**Analysis**:

- `messages` is the **source of truth** (StrictChatMessage[])
- `claudeMessages` is **transformed for UI display** (ProcessedClaudeMessage[])
- Both collections maintained in parallel during streaming

**Proposed Optimization**: **NO CHANGE** - dual collections are intentional

**Rationale**:

- Separation of concerns: raw messages vs. UI-formatted messages
- Performance: claudeMessages pre-computed for Angular rendering
- Evidence: MessageProcessingService.convertToProcessedMessage (chat.service.ts:574-580)

**Decision**: Maintain current architecture (no optimization needed)

---

## 5. Implementation Strategy

### Phase 1: Critical Fixes (Immediate - Week 1)

**Goal**: Fix event translation gap and restore missing events

#### Task 1.1: Create EventTranslationService

- **File**: `libs/backend/vscode-core/src/messaging/event-translation.service.ts`
- **Dependencies**: EventBus (TOKENS.EVENT_BUS)
- **Pattern**: Observer + Publisher double-publish
- **Deliverable**: 17 translation methods (one per claude:\* event)

#### Task 1.2: Register EventTranslationService in DI Container

- **File**: `libs/backend/vscode-core/src/di/container.ts`
- **Token**: `TOKENS.EVENT_TRANSLATION_SERVICE = Symbol.for('EVENT_TRANSLATION_SERVICE')`
- **Initialization Order**: AFTER EventBus, BEFORE WebviewMessageBridge

#### Task 1.3: Add claude:\* Payloads to MessagePayloadMap

- **File**: `libs/shared/src/lib/types/message.types.ts`
- **Changes**: Add 17 claude:\* event types to MessagePayloadMap
- **Verification**: Run `nx run shared:typecheck`

#### Task 1.4: Update WebviewMessageBridge Forwarding Rules

- **File**: `libs/backend/vscode-core/src/messaging/webview-message-bridge.ts`
- **Changes**: Replace manual array with `Object.values(CHAT_MESSAGE_TYPES)`
- **Verification**: Run `nx test vscode-core` (week2-integration.spec.ts)

### Phase 2: Architecture Cleanup (Week 2)

**Goal**: Eliminate technical debt and improve maintainability

#### Task 2.1: Event Deduplication System

- **Location**: EventTranslationService
- **Pattern**: Use `sessionId + eventType + timestamp` as deduplication key
- **Storage**: Map<string, number> with 5-second TTL
- **Benefit**: Prevents duplicate events if multiple subscribers exist

#### Task 2.2: Cleanup Registry for Subscriptions

- **Location**: EventTranslationService.dispose()
- **Pattern**: Store all subscriptions in `this.subscriptions: Subscription[]`
- **Cleanup**: Unsubscribe all on extension deactivation
- **Benefit**: Prevents memory leaks

#### Task 2.3: Translation Metrics Dashboard

- **Location**: EventTranslationService.getMetrics()
- **Metrics**: translatedEventCount, failedTranslationCount, latency histogram
- **Integration**: WebviewMessageBridge.getMetrics() (existing pattern)
- **Benefit**: Real-time monitoring of event translation health

### Phase 3: Feature Enablement (Week 3)

**Goal**: Enable IMPLEMENTATION_PLAN features through enhanced event handling

#### Task 3.1: Capability Tracking Events (Phase 1.3)

- **New Events**: `chat:capabilitiesUpdated`, `chat:capabilityToggled`
- **Translation**: `claude:capabilities:changed` → `chat:capabilitiesUpdated`
- **Frontend**: ChatService subscribes to capability events

#### Task 3.2: Cost/Token Events (Phase 4)

- **Enhancement**: Emit cost breakdown events
- **Events**: `chat:costCalculated`, `chat:tokenBreakdown`
- **UI**: Display real-time cost accumulation

#### Task 3.3: MCP Server Status Events (Phase 3)

- **New Events**: `chat:mcpServerConnected`, `chat:mcpServerDisconnected`, `chat:mcpToolDiscovered`
- **Translation**: `claude:mcp:*` → `chat:mcp*`
- **Frontend**: ProviderService subscribes to MCP events

---

## 6. Migration Path

### 6.1 Backward Compatibility Strategy

**ZERO BREAKING CHANGES** - all existing event handlers continue to work

**Evidence**:

- Existing `chat:*` subscriptions in ChatService (chat.service.ts:429-804) remain unchanged
- WebviewMessageBridge forwarding rules expanded (additive change only)
- EventTranslationService is a **new layer** (doesn't modify existing layers)

### 6.2 Migration Steps

**Step 1: Enable Translation Layer**

1. Deploy EventTranslationService (Phase 1.1-1.2)
2. Verify metrics: `translatedEventCount > 0`
3. No frontend changes needed (automatic pickup)

**Step 2: Monitor Event Flow**

1. Use EventTranslationService.getMetrics() to track translations
2. Use WebviewMessageBridge.getMetrics() to track forwarding
3. Compare counts: translatedEventCount ≈ forwardedMessageCount

**Step 3: Deprecate Direct Chat Event Emissions (Optional)**

1. Audit codebase for direct `eventBus.publish('chat:*', ...)` calls
2. Replace with `eventBus.publish('claude:*', ...)` + translation
3. Benefit: Single event source (claude-domain) instead of scattered publishers

### 6.3 Rollback Strategy

**If translation layer causes issues**:

1. **Disable Translation**: Comment out `translator.initialize()` in container.ts
2. **Restore Direct Publishing**: Revert to direct `chat:*` event emissions (if needed)
3. **Zero Data Loss**: All existing subscriptions continue to work

---

## 7. Testing Strategy

### 7.1 Unit Tests

**Location**: `libs/backend/vscode-core/src/messaging/event-translation.service.spec.ts`

**Test Coverage**:

```typescript
describe('EventTranslationService', () => {
  it('should translate claude:content:chunk to chat:messageChunk', () => {
    const eventBus = new EventBus();
    const translator = new EventTranslationService(eventBus);
    translator.initialize();

    const chatEventSpy = jest.spyOn(eventBus, 'publish');

    // Emit claude event
    eventBus.publish('claude:content:chunk', {
      sessionId: SessionId.create(),
      chunk: { content: 'Hello', isComplete: false }
    });

    // Verify chat event published
    expect(chatEventSpy).toHaveBeenCalledWith(
      'chat:messageChunk',
      expect.objectContaining({ content: 'Hello' }),
      'extension'
    );
  });

  it('should track translation metrics', () => {
    const translator = new EventTranslationService(eventBus);
    translator.initialize();

    eventBus.publish('claude:thinking', { sessionId, thinking: {...} });

    const metrics = translator.getMetrics();
    expect(metrics.translatedEventCount).toBe(1);
    expect(metrics.failedTranslationCount).toBe(0);
  });

  it('should handle translation errors gracefully', () => {
    const translator = new EventTranslationService(eventBus);
    translator.initialize();

    // Emit malformed event
    eventBus.publish('claude:content:chunk', null);

    const metrics = translator.getMetrics();
    expect(metrics.failedTranslationCount).toBe(1);
  });
});
```

### 7.2 Integration Tests

**Location**: `libs/backend/vscode-core/src/integration/event-flow-integration.spec.ts`

**Test Scenarios**:

1. **End-to-End Event Flow**:
   - Emit `claude:*` event → verify `chat:*` event forwarded to webview
2. **All Event Types**:
   - Test all 17 claude:_ → chat:_ translations
3. **Event Order Preservation**:
   - Emit 3 events in sequence → verify same order at frontend
4. **Error Handling**:
   - Inject translation error → verify other events still processed

### 7.3 Manual Testing Checklist

**Prerequisite**: Build and run extension with translation layer enabled

**Test Cases**:

- [ ] Send message → verify `chat:messageChunk` events received in frontend
- [ ] Check thinking display → verify `chat:thinking` events trigger UI update
- [ ] Trigger permission request → verify `chat:permissionRequest` dialog appears
- [ ] Complete message → verify `chat:tokenUsageUpdated` updates token count
- [ ] Monitor tools → verify `chat:toolStart/Progress/Result` events populate tool UI
- [ ] Check agent tree → verify `chat:agentStarted/Activity/Completed` build agent hierarchy

---

## 8. Performance Impact

### 8.1 Expected Performance Characteristics

**Overhead per Event**:

- **Translation**: ~0.1ms (object destructuring + reconstruction)
- **EventBus Publish**: ~0.05ms (EventEmitter emit)
- **Total**: ~0.15ms per event

**Memory Impact**:

- **Subscriptions**: 17 RxJS subscriptions (~5KB total)
- **Event Deduplication Map**: ~1KB (5-second TTL, auto-cleanup)
- **Total**: ~6KB additional memory

**Throughput**:

- **Max Events/Second**: 6,666 events/sec (at 0.15ms/event)
- **Expected Load**: ~50 events/sec (streaming chunks + tool events)
- **Headroom**: 133x capacity

### 8.2 Performance Optimizations

**Optimization 1: Pattern Matching Cache**

- Cache compiled regex patterns for event type matching
- Benefit: Reduce pattern compilation overhead

**Optimization 2: Batch Translation**

- Accumulate events in 10ms windows
- Publish batch of chat:\* events in single EventBus call
- Benefit: Reduce EventBus overhead by ~70%

**Optimization 3: Lazy Subscription**

- Only subscribe to claude:\* events when webview is active
- Unsubscribe when webview closes
- Benefit: Zero overhead when webview not in use

### 8.3 Performance Validation

**Metrics to Track**:

1. **Translation Latency**: P50, P95, P99 latency distribution
2. **Event Throughput**: Events/second processed
3. **Memory Usage**: Subscription count, deduplication map size
4. **Error Rate**: Failed translations / total translations

**Acceptance Criteria**:

- P95 latency < 1ms
- Zero event loss (translatedEventCount = claudeEventCount)
- Error rate < 0.1%

---

## 9. Risk Mitigation

### 9.1 Identified Risks

**Risk 1: Event Duplication**

- **Scenario**: Both direct `chat:*` emissions AND translated events published
- **Impact**: Frontend receives duplicate events, state corruption
- **Mitigation**: Deduplication map with sessionId+eventType+timestamp key
- **Verification**: Unit tests for duplicate detection

**Risk 2: Event Order Violation**

- **Scenario**: Translation adds latency, events arrive out-of-order
- **Impact**: UI displays messages in wrong sequence
- **Mitigation**: EventBus guarantees FIFO ordering per event type
- **Verification**: Integration tests verify event order preservation

**Risk 3: Translation Performance Bottleneck**

- **Scenario**: Translation layer adds unacceptable latency
- **Impact**: Streaming feels laggy, UI updates delayed
- **Mitigation**: Performance optimizations (batch translation, pattern cache)
- **Verification**: Performance tests (P95 < 1ms requirement)

**Risk 4: Missing Event Transformations**

- **Scenario**: claude:_ event payload incompatible with chat:_ payload
- **Impact**: Frontend receives malformed events, TypeScript errors
- **Mitigation**: Zod validation for all translated payloads
- **Verification**: Unit tests for all 17 event transformations

### 9.2 Contingency Plans

**If Translation Layer Fails**:

1. Disable EventTranslationService initialization
2. Add direct chat:\* event emissions to ClaudeDomainEventPublisher
3. Revert to pre-translation architecture (temporary)

**If Event Duplication Occurs**:

1. Enable deduplication map (enabled by default)
2. Add unique event IDs to all events
3. Frontend filters duplicates based on event ID

**If Performance Degrades**:

1. Enable batch translation (10ms windows)
2. Implement pattern matching cache
3. Profile EventBus overhead, optimize if needed

---

## 10. Success Metrics

### 10.1 Functional Success

- ✅ **Zero Event Loss**: All 17 claude:_ events translated to chat:_ events
- ✅ **100% Delivery**: All chat:\* events forwarded to active webviews
- ✅ **Type Safety**: All event payloads validated by TypeScript compiler
- ✅ **Backward Compatibility**: Existing event handlers work unchanged

### 10.2 Performance Success

- ✅ **P95 Latency**: < 1ms per event translation
- ✅ **Throughput**: > 1000 events/sec sustained
- ✅ **Memory**: < 10KB additional memory footprint
- ✅ **Error Rate**: < 0.1% failed translations

### 10.3 Maintainability Success

- ✅ **Code Clarity**: Event flow traceable in 3 jumps (Publisher → Translator → Bridge)
- ✅ **Documentation**: All 17 event mappings documented
- ✅ **Testing**: 80%+ code coverage for translation service
- ✅ **Monitoring**: Real-time metrics dashboard for event health

---

## 11. Implementation Readiness Checklist

### Architecture Design

- [x] Event translation strategy defined
- [x] Component responsibilities specified
- [x] Integration points documented
- [x] Performance impact analyzed
- [x] Risk mitigation strategies identified

### Code Specifications

- [x] EventTranslationService interface defined
- [x] Translation mapping table complete (17 events)
- [x] WebviewMessageBridge enhancement specified
- [x] MessagePayloadMap additions listed
- [x] DI container registration pattern documented

### Testing Strategy

- [x] Unit test structure defined
- [x] Integration test scenarios listed
- [x] Manual testing checklist created
- [x] Performance validation criteria specified

### Migration Plan

- [x] Phase 1 tasks defined (Critical Fixes)
- [x] Phase 2 tasks defined (Architecture Cleanup)
- [x] Phase 3 tasks defined (Feature Enablement)
- [x] Backward compatibility guaranteed
- [x] Rollback strategy documented

---

## Appendix A: Evidence Citations

### A.1 Codebase Investigation

**Evidence 1**: ClaudeDomainEventPublisher publishes 13 claude:\* events

- **Source**: libs/backend/claude-domain/src/events/claude-domain.events.ts:24-59
- **Key Finding**: CLAUDE_DOMAIN_EVENTS constant defines event topics

**Evidence 2**: WebviewMessageBridge forwards only chat:\* events

- **Source**: libs/backend/vscode-core/src/messaging/webview-message-bridge.ts:74-125
- **Key Finding**: alwaysForward array contains only CHAT_MESSAGE_TYPES

**Evidence 3**: ChatService subscribes to chat:\* events

- **Source**: libs/frontend/core/src/lib/services/chat.service.ts:429-804
- **Key Finding**: 20+ subscriptions to chat:\* events via vscode.onMessageType()

**Evidence 4**: Missing translation layer

- **Source**: Grep search for event-publisher, event-translation, event-bridge
- **Key Finding**: No EventTranslationService or similar translation component exists

**Evidence 5**: Message type constants as single source of truth

- **Source**: libs/shared/src/lib/constants/message-types.ts:1-302
- **Key Finding**: 94 message types across 7 domains, comprehensive constant definitions

### A.2 Pattern Extraction

**Pattern 1**: Observer + Publisher (WebviewMessageBridge)

- **Source**: libs/backend/vscode-core/src/messaging/webview-message-bridge.ts:163-177
- **Application**: EventTranslationService uses same subscription pattern

**Pattern 2**: Injectable Service Registration

- **Source**: libs/backend/vscode-core/src/di/container.ts
- **Application**: EventTranslationService registered as singleton

**Pattern 3**: Metrics Tracking

- **Source**: libs/backend/vscode-core/src/messaging/webview-message-bridge.ts:256-269
- **Application**: EventTranslationService.getMetrics() follows same pattern

---

## Appendix B: Glossary

**Claude Domain Events** (`claude:*`): Internal events published by claude-domain library representing CLI lifecycle and process events

**Chat Domain Events** (`chat:*`): User-facing events consumed by frontend representing UI interactions and feature state

**Event Translation**: Process of converting claude:_ events to semantically equivalent chat:_ events

**Double-Publish Pattern**: Subscribe to event source A, transform payload, publish to event source B

**Event Deduplication**: Detecting and filtering duplicate events using sessionId+eventType+timestamp keys

**EventBus**: Central pub/sub messaging system in vscode-core library

**WebviewMessageBridge**: Service that forwards EventBus events to VS Code webview panels

**MessagePayloadMap**: TypeScript interface defining all valid message types and their payloads (94 types)

---

**Document Status**: ✅ **READY FOR TEAM-LEADER DECOMPOSITION**

This architecture specification provides:

- Complete component designs with TypeScript interfaces
- Evidence-based decisions (20+ file citations)
- Clear integration points and dependencies
- Comprehensive testing strategy
- Migration path with zero breaking changes
- Performance analysis and risk mitigation

**Next Step**: Team-Leader decomposes this architecture into atomic, git-verifiable tasks in tasks.md
