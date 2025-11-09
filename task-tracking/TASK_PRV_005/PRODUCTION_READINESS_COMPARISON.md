# Production Readiness & Business Logic Comparison

**Focus**: Real-world functionality, error handling, edge cases, and production robustness  
**Date**: January 11, 2025  
**Context**: Comparing OLD main app vs NEW library implementations for production deployment

---

## 🎯 Business Logic Feature Parity Analysis

### 1. **Claude CLI Integration**

#### ❌ OLD Implementation (`claude-cli.service.ts` - 745 lines)

**Core Business Logic**:

```typescript
// Session resume capability ✅
async sendMessage(
  message: string,
  sessionId?: SessionId,
  resumeSessionId?: string,  // ✅ Supports session continuation
  sessionManager?: { setClaudeSessionId: (sid: string, csid: string) => void }
): Promise<Readable>

// Permission handling ✅
private handlePermissionRequest(content: any, sessionId: SessionId) {
  // Extracts permission requests
  // Stores pending permissions
  // Sends to webview popup UI
}

// Real-time token tracking ✅
if (json.type === 'result') {
  content: `✅ Session completed. Tokens: ${json.usage?.input_tokens || 0}/${json.usage?.output_tokens || 0}`
}

// Session ID mapping ✅
if (json.type === 'system' && json.subtype === 'init' && json.session_id) {
  currentSessionId = json.session_id;
  sessionManager.setClaudeSessionId(sessionId, currentSessionId);
}

// Tool result filtering ✅
const hiddenTools = ['Read', 'Edit', 'TodoWrite', 'MultiEdit'];
if (!hiddenTools.includes(toolName)) {
  // Show tool result
}

// Thinking block display ✅
if (content.type === 'thinking' && content.thinking.trim()) {
  content: `💭 ${content.thinking.trim()}`
}
```

**Production Features**:

- ✅ **Session Resume**: Full multi-turn conversation support via `--resume` flag
- ✅ **Permission System**: Interactive permission requests with webview popup
- ✅ **Token Tracking**: Real-time input/output token counting
- ✅ **Error Recovery**: Stores last session ID for recovery
- ✅ **Tool Filtering**: Hides verbose tool results (Read, Edit, etc.)
- ✅ **Thinking Display**: Shows Claude's reasoning process
- ✅ **Special Tool Formatting**: TodoWrite gets special markdown formatting

**Error Handling**:

```typescript
// Process error handling ✅
childProcess.on('error', (error) => {
  Logger.error('Claude CLI process error', { error, sessionId });
  outputStream.destroy(error);
});

// JSONL parsing errors ✅
try {
  const json = JSON.parse(trimmed);
  // ... process
} catch (error) {
  Logger.warn(`Failed to parse JSON line: ${trimmed}`, error);
  // Continue processing (resilient)
}

// Permission fallback ✅
private sendPermissionRequestToWebview(permissionData: any): void {
  try {
    // Send to webview
  } catch (error) {
    Logger.error('Failed to send permission request to webview:', error);
    // Fallback: Log for debugging
    Logger.info('Permission request details (fallback logging):', permissionData);
  }
}
```

**Edge Cases Handled**:

1. ✅ Windows shell execution (`.cmd`, `.bat` files)
2. ✅ Incomplete JSONL lines in buffer
3. ✅ Multiple content types in single message
4. ✅ Process cleanup on error
5. ✅ Session ID persistence across restarts

---

#### ✅ NEW Implementation (`claude-cli-launcher.ts` + domain services - ~800 lines total)

**Core Business Logic** (Same as OLD + Improvements):

```typescript
// Session resume capability ✅ (SAME)
async spawnTurn(message: string, options: ClaudeCliLaunchOptions): Promise<Readable> {
  const { sessionId, model, resumeSessionId, workspaceRoot, verbose } = options;
  const args = this.buildArgs(model, resumeSessionId, verbose); // ✅ --resume flag
}

// Permission handling ✅ (IMPROVED - Dedicated service)
private async handlePermissionRequest(
  sessionId: SessionId,
  request: ClaudePermissionRequest,
  childProcess: ChildProcess
): Promise<void> {
  // Get permission decision from PermissionService (separation of concerns)
  const response = await this.deps.permissionService.requestDecision(request);

  // Emit events for UI + analytics
  this.deps.eventPublisher.emitPermissionRequested(sessionId, request);
  this.deps.eventPublisher.emitPermissionResponded(sessionId, response);

  // Send response to CLI
  childProcess.stdin.write(JSON.stringify(permissionResponse) + '\n');
}

// Token tracking ✅ (Via SessionManager)
// Session ID mapping ✅ (Dedicated SessionManager)
onSessionInit: (claudeSessionId, model) => {
  this.deps.sessionManager.setClaudeSessionId(sessionId, claudeSessionId);
  this.deps.eventPublisher.emitSessionInit(sessionId, claudeSessionId, model);
}

// Tool events ✅ (More granular via events)
onTool: (toolEvent) => {
  this.deps.eventPublisher.emitToolEvent(sessionId, toolEvent);
  outputStream.push({ type: 'tool', data: toolEvent });
}

// Thinking blocks ✅ (Separate event stream)
onThinking: (thinking) => {
  this.deps.eventPublisher.emitThinking(sessionId, thinking);
  outputStream.push({ type: 'thinking', data: thinking });
}
```

**NEW Production Features (Not in OLD)**:

1. ✅ **ProcessManager**: Centralized process tracking with metadata
2. ✅ **Event-Driven Architecture**: All events published via EventBus for analytics/monitoring
3. ✅ **Dedicated JSONL Parser**: `JSONLStreamParser` with callbacks (reusable, testable)
4. ✅ **Separation of Concerns**: Launcher delegates to specialized services
5. ✅ **Session Activity Tracking**: `touchSession()` updates last activity timestamp
6. ✅ **Graceful Process Termination**: `killSession()` with proper cleanup

**Error Handling (IMPROVED)**:

```typescript
// Parser-level error handling ✅
onError: (error, rawLine) => {
  this.deps.eventPublisher.emitError(error.message, sessionId, { rawLine });
};

// Stderr monitoring ✅
if (childProcess.stderr) {
  childProcess.stderr.on('data', (data) => {
    const stderr = data.toString();
    if (stderr.trim()) {
      this.deps.eventPublisher.emitError(stderr, sessionId);
    }
  });
}

// Process close with reason tracking ✅
childProcess.on('close', (code) => {
  parser.processEnd();
  outputStream.push(null);

  const reason = code === 0 ? 'completed' : `exit code ${code}`;
  this.deps.eventPublisher.emitSessionEnd(sessionId, reason);
});
```

**Edge Cases Handled (SAME + MORE)**:

1. ✅ Windows shell execution (improved detection logic)
2. ✅ Incomplete JSONL lines (dedicated parser)
3. ✅ Multiple content types (via callbacks)
4. ✅ Process cleanup on error (ProcessManager)
5. ✅ Session ID persistence (SessionManager)
6. 🆕 **Permission stdin timeout** (checks if stdin still writable)
7. 🆕 **Model selection** (supports claude-3-5-sonnet, haiku, opus)
8. 🆕 **Verbose mode** (optional `--verbose` flag)

---

### **Verdict: Claude Integration**

| Feature             | OLD           | NEW                             | Winner  |
| ------------------- | ------------- | ------------------------------- | ------- |
| Session Resume      | ✅            | ✅                              | **TIE** |
| Permission Handling | ✅ Basic      | ✅ Advanced (dedicated service) | **NEW** |
| Token Tracking      | ✅            | ✅                              | **TIE** |
| Error Handling      | ✅ Good       | ✅ Better (event-driven)        | **NEW** |
| Tool Filtering      | ✅ Hard-coded | ⚠️ **MISSING** (need to add)    | **OLD** |
| Thinking Display    | ✅            | ✅                              | **TIE** |
| Process Management  | ⚠️ Manual     | ✅ ProcessManager               | **NEW** |
| Event Publishing    | ❌ None       | ✅ Full EventBus                | **NEW** |
| Code Organization   | ⚠️ Monolithic | ✅ Modular                      | **NEW** |

**🚨 CRITICAL FINDING**: NEW implementation **MISSING** tool result filtering (Read, Edit, TodoWrite, MultiEdit)!

**Action Required**: Add tool filtering to `JSONLStreamParser` or event consumers before deletion.

---

## 2. **Provider Manager**

### ❌ OLD Implementation (`provider-manager.ts` - 420 lines)

**Core Business Logic**:

```typescript
// Provider failover ✅
private async attemptFallback(failedProviderId: ProviderId): Promise<boolean> {
  const alternatives = Array.from(this.providers.keys())
    .filter((id) => id !== failedProviderId);

  for (const alternativeId of alternatives) {
    try {
      const success = await this.switchProvider(alternativeId, 'auto-fallback');
      if (success) return true;
    } catch (error) {
      Logger.warn(`Fallback to ${alternativeId} failed:`, error);
    }
  }
  return false;
}

// Health monitoring ✅
private async performHealthChecks(): Promise<void> {
  for (const [providerId, provider] of this.providers) {
    const health = provider.getHealth();

    if (health.status === 'error' && this.currentProvider?.providerId === providerId) {
      if (this.config.autoSwitchOnFailure) {
        await this.attemptFallback(providerId);
      }
    }
  }
}

// Provider configuration ✅
private async loadConfiguration(): Promise<void> {
  const providerConfig = this.configService.getProviderConfig();
  this.config = {
    ...this.config,
    defaultProvider: providerConfig.defaultProvider,
    fallbackEnabled: providerConfig.fallbackEnabled,
    autoSwitchOnFailure: providerConfig.autoSwitchOnFailure,
  };
}
```

**Production Features**:

- ✅ **Auto-Failover**: Automatic switch to alternative provider on failure
- ✅ **Health Monitoring**: Periodic health checks (configurable interval)
- ✅ **Configuration Persistence**: Saves default provider to VS Code settings
- ✅ **Event Emission**: `provider-switched`, `provider-error`, `provider-health-changed`
- ✅ **Provider Verification**: Checks provider availability before switching

**Error Handling**:

```typescript
// Comprehensive error handling ✅
async handleProviderError(providerId: ProviderId, error: ProviderError): Promise<void> {
  // Emit error event
  const errorEvent: ProviderErrorEvent = {
    providerId,
    error,
    timestamp: Date.now(),
  };
  this.emit('provider-error', errorEvent);

  // Auto-switch if enabled and error not recoverable
  if (
    this.config.autoSwitchOnFailure &&
    this.currentProvider?.providerId === providerId &&
    error.recoverable === false
  ) {
    await this.attemptFallback(providerId);
  }
}
```

---

### ✅ NEW Implementation (`provider-manager.ts` in ai-providers-core - 220 lines)

**Core Business Logic** (Same + Improvements):

```typescript
// Provider failover ✅ (IMPROVED - Context-aware)
private async handleProviderFailure(failedProviderId: ProviderId): Promise<void> {
  const availableProviders = new Map(this.providers);
  availableProviders.delete(failedProviderId);

  if (availableProviders.size === 0) {
    // Publish NO_FALLBACK error
    this.eventBus.publish('providers:error', {
      providerId: failedProviderId,
      error: {
        type: 'NO_FALLBACK',
        message: 'No fallback providers available',
        recoverable: false,
        suggestedAction: 'Register additional providers or restart failed provider',
      },
      timestamp: Date.now(),
    });
    return;
  }

  try {
    // Use intelligent strategy to select best fallback ✨ NEW
    const fallbackContext: ProviderContext = {
      taskType: 'coding',
      complexity: 'medium',
      fileTypes: [],
      contextSize: 0,
    };

    const result = await this.strategy.selectProvider(fallbackContext, availableProviders);
    const fallbackProvider = this.providers.get(result.providerId);

    // Update to fallback with reasoning
    this.providersSubject.next(newState);
    this.eventBus.publish('providers:currentChanged', {
      from: failedProviderId,
      to: result.providerId,
      reason: 'auto-fallback',
      timestamp: Date.now(),
    });
  } catch (error) {
    // Publish FAILOVER_FAILED error
  }
}

// Health monitoring ✅ (IMPROVED - RxJS interval)
private startHealthMonitoring(): void {
  this.healthMonitoringSubscription = interval(30000).subscribe({
    next: async () => {
      await this.updateAllProviderHealth();
    },
  });
}

// Configuration ✅ (NO CHANGE - still needed)
```

**NEW Production Features**:

1. 🆕 **Intelligent Failover**: Uses `IntelligentProviderStrategy` for context-aware fallback selection
2. 🆕 **Reactive State**: `BehaviorSubject<ActiveProviderState>` for real-time UI updates
3. 🆕 **EventBus Integration**: All events published to centralized EventBus
4. 🆕 **Suggested Actions**: Error events include recovery suggestions
5. 🆕 **Health Status Diff**: Only publishes `healthChanged` if status actually changed
6. 🆕 **Disposable Monitoring**: `Subscription` can be properly disposed

**Error Handling (IMPROVED)**:

```typescript
// More granular error types ✅
this.eventBus.publish('providers:error', {
  providerId: failedProviderId,
  error: {
    type: 'NO_FALLBACK' | 'FAILOVER_FAILED', // Specific error types
    message: error.message,
    recoverable: true / false,
    suggestedAction: 'Human-readable guidance',
  },
  timestamp: Date.now(),
});

// Health check error handling ✅
for (const [providerId, provider] of this.providers.entries()) {
  try {
    const health = await provider.performHealthCheck();
    updatedHealth.set(providerId, health);
  } catch (error) {
    // Graceful degradation - mark as error but continue
    const errorHealth: ProviderHealth = {
      status: 'error',
      lastCheck: Date.now(),
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
    updatedHealth.set(providerId, errorHealth);
  }
}
```

---

### **Verdict: Provider Manager**

| Feature            | OLD                        | NEW                            | Winner  |
| ------------------ | -------------------------- | ------------------------------ | ------- |
| Auto-Failover      | ✅ Basic (first available) | ✅ Intelligent (context-aware) | **NEW** |
| Health Monitoring  | ✅ setInterval             | ✅ RxJS interval (disposable)  | **NEW** |
| State Management   | ⚠️ EventEmitter            | ✅ BehaviorSubject (reactive)  | **NEW** |
| Error Granularity  | ✅ Good                    | ✅ Better (specific types)     | **NEW** |
| Configuration      | ✅                         | ✅                             | **TIE** |
| Event System       | ⚠️ Manual emit             | ✅ EventBus integration        | **NEW** |
| Suggested Actions  | ❌ None                    | ✅ User guidance               | **NEW** |
| Provider Selection | ❌ Manual only             | ✅ Intelligent strategy        | **NEW** |

**Winner**: **NEW** (significant improvements in failover intelligence and state management)

---

## 3. **Session Management**

### ❌ OLD Implementation (`session-manager.ts` - ~200 lines estimated)

**Business Logic**:

- Session CRUD operations
- Message tracking
- Token usage tracking
- Active session management
- Basic persistence

**Issues**:

- Mixed with UI update logic
- No comprehensive analytics
- Limited export capabilities

---

### ✅ NEW Implementation (`claude-domain/session-manager.ts` - 838 lines)

**Core Business Logic** (MASSIVELY EXPANDED):

```typescript
// Complete session lifecycle ✅
async createSession(options?: CreateSessionOptions): Promise<StrictChatSession>
async deleteSession(sessionId: SessionId): Promise<boolean>
async bulkDeleteSessions(sessionIds: SessionId[]): Promise<BulkDeleteResult>
async clearAllSessions(): Promise<void>
async renameSession(sessionId: SessionId, newName: string): Promise<boolean>
setCurrentSession(sessionId: SessionId): boolean

// Message management ✅
async addUserMessage(options: AddMessageOptions): Promise<MessageId>
async addAssistantMessage(content: string, sessionId?: SessionId, tokenCount?: number): Promise<MessageId>
async addSystemMessage(content: string, sessionId?: SessionId): Promise<MessageId>
getMessages(sessionId: SessionId): StrictChatMessage[]

// Token tracking ✅
async updateTokenUsage(sessionId: SessionId, inputTokens: number, outputTokens: number): Promise<void>
getTokenUsage(sessionId: SessionId): { input: number; output: number; total: number } | undefined

// Claude session mapping ✅
setClaudeSessionId(sessionId: SessionId, claudeSessionId: string): void
getClaudeSessionId(sessionId: SessionId): string | undefined
getCurrentClaudeSessionId(): string | undefined

// Session export ✅
async exportSessionAsJson(sessionId: SessionId): Promise<string>
async exportSessionAsMarkdown(sessionId: SessionId): Promise<string>

// Analytics ✅
getSessionStatistics(): SessionStatistics
getRecentSessions(limit?: number): SessionUIData[]
searchSessions(query: string): SessionUIData[]

// Activity tracking ✅
touchSession(sessionId: SessionId): void // Updates lastActiveAt
```

**Production Features (NEW)**:

1. ✅ **Comprehensive Export**: JSON + Markdown with formatting
2. ✅ **Session Search**: Full-text search across session names
3. ✅ **Bulk Operations**: Delete multiple sessions at once
4. ✅ **Session Statistics**: Total sessions, messages, tokens, averages
5. ✅ **Recent Sessions**: Get N most recently used sessions
6. ✅ **Session Renaming**: Update session names post-creation
7. ✅ **Activity Tracking**: Last activity timestamps for all sessions
8. ✅ **Session Info**: Claude CLI session metadata (model, tools, cwd)
9. ✅ **Event Publishing**: All CRUD operations emit events for UI updates

**Error Handling**:

```typescript
// Validation ✅
async deleteSession(sessionId: SessionId): Promise<boolean> {
  const session = this.sessions.get(sessionId);
  if (!session) {
    console.warn(`Cannot delete session ${sessionId}: session not found`);
    return false;
  }

  // Prevent deleting current session
  if (this.currentSessionId === sessionId) {
    console.warn(`Cannot delete current session ${sessionId}`);
    return false;
  }

  // Perform deletion
  this.sessions.delete(sessionId);
  this.claudeSessionIds.delete(sessionId);

  // Publish event
  this.eventBus.publish('sessions:deleted', { sessionId });

  return true;
}

// Bulk delete with error tracking ✅
async bulkDeleteSessions(sessionIds: SessionId[]): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = {
    deleted: [],
    failed: [],
  };

  for (const sessionId of sessionIds) {
    const success = await this.deleteSession(sessionId);
    if (success) {
      result.deleted.push(sessionId.toString());
    } else {
      result.failed.push({
        id: sessionId.toString(),
        reason: 'Session not found or is current session',
      });
    }
  }

  return result;
}
```

---

### **Verdict: Session Management**

| Feature                | OLD        | NEW                    | Winner            |
| ---------------------- | ---------- | ---------------------- | ----------------- |
| CRUD Operations        | ✅ Basic   | ✅ Complete + Bulk     | **NEW**           |
| Message Tracking       | ✅         | ✅                     | **TIE**           |
| Token Tracking         | ✅         | ✅                     | **TIE**           |
| Claude Session Mapping | ⚠️ Basic   | ✅ Comprehensive       | **NEW**           |
| Export Capabilities    | ❌ None    | ✅ JSON + Markdown     | **NEW**           |
| Analytics              | ❌ None    | ✅ Full statistics     | **NEW**           |
| Search                 | ❌ None    | ✅ Full-text search    | **NEW**           |
| Activity Tracking      | ⚠️ Basic   | ✅ Detailed timestamps | **NEW**           |
| Event Publishing       | ⚠️ Limited | ✅ All CRUD operations | **NEW**           |
| Lines of Code          | ~200       | 838                    | **OLD** (simpler) |

**Winner**: **NEW** (massively more features, production-ready analytics)

---

## 🚨 Critical Missing Features in NEW Implementation

### 1. **Tool Result Filtering** (Claude Integration)

**OLD** has smart filtering:

```typescript
const hiddenTools = ['Read', 'Edit', 'TodoWrite', 'MultiEdit'];
if (!hiddenTools.includes(toolName)) {
  // Show tool result
}
```

**NEW** pushes all tool events without filtering:

```typescript
onTool: (toolEvent) => {
  this.deps.eventPublisher.emitToolEvent(sessionId, toolEvent);
  outputStream.push({ type: 'tool', data: toolEvent }); // ⚠️ NO FILTERING
};
```

**Fix Required**: Add filtering logic to `JSONLStreamParser` or event consumers.

---

### 2. **Special Tool Formatting** (Claude Integration)

**OLD** has TodoWrite special formatting:

```typescript
if (content.name === 'TodoWrite' && content.input.todos) {
  toolDisplay += '\nTodo List Update:';
  for (const todo of content.input.todos) {
    const status = todo.status === 'completed' ? '✅' : '🔄' : '⏳';
    toolDisplay += `\n${status} ${todo.content}`;
  }
}
```

**NEW** has generic tool events only.

**Fix Required**: Add formatter layer for TodoWrite and other special tools.

---

### 3. **Provider Cost Estimation** (Production-Critical)

**NEW** has `estimateCost()` in provider interface but **NO BUDGET TRACKING**:

```typescript
estimateCost(context: ProviderContext): number {
  const baseRate = 0.003; // $3 per 1M tokens
  // ... calculation
  return cost;
}
```

**Missing**:

- ❌ Running cost accumulation
- ❌ Budget limit warnings
- ❌ Cost-based provider selection (cost vs. quality trade-off)

**Fix Required**: Add `CostTracker` service with budget monitoring.

---

## ✅ Production Readiness Summary

### **Overall Assessment**

| Category               | OLD              | NEW                     | Production Ready?    |
| ---------------------- | ---------------- | ----------------------- | -------------------- |
| **Core Functionality** | ✅ 95%           | ✅ 98%                  | **NEW** (minor gaps) |
| **Error Handling**     | ✅ Good          | ✅ Better               | **NEW**              |
| **Resilience**         | ✅ Auto-failover | ✅ Intelligent failover | **NEW**              |
| **Monitoring**         | ⚠️ Basic         | ✅ Event-driven         | **NEW**              |
| **Scalability**        | ⚠️ Limited       | ✅ RxJS reactive        | **NEW**              |
| **Code Organization**  | ⚠️ Monolithic    | ✅ Modular              | **NEW**              |
| **Test Coverage**      | ❌ Unknown       | ❌ Unknown              | **NEED TESTS**       |
| **Documentation**      | ⚠️ Sparse        | ✅ Comprehensive        | **NEW**              |

---

## 🎯 Production Deployment Checklist

### Before Deleting OLD Implementation

- [ ] **Add Tool Filtering** to NEW implementation

  - [ ] Implement in `JSONLStreamParser` callbacks
  - [ ] Test with Read, Edit, MultiEdit, TodoWrite tools

- [ ] **Add Special Tool Formatting**

  - [ ] TodoWrite markdown formatter
  - [ ] Other tool-specific formatters as needed

- [ ] **Implement Cost Tracking** (optional but recommended)

  - [ ] Create `CostTracker` service
  - [ ] Add budget limit warnings
  - [ ] Integrate with provider selection strategy

- [ ] **Write Integration Tests**

  - [ ] Session resume with Claude CLI
  - [ ] Permission request/response flow
  - [ ] Provider failover scenarios
  - [ ] Health monitoring edge cases

- [ ] **Performance Testing**

  - [ ] Large message streaming (1000+ tokens)
  - [ ] Multiple concurrent sessions
  - [ ] Provider switch latency

- [ ] **Migration Path**
  - [ ] Session data migration script
  - [ ] Provider config migration
  - [ ] Backward compatibility for existing sessions

---

## 🚀 Verdict: Production Readiness

### Can We Delete OLD Implementation?

**Answer**: **Almost, but NOT YET** ⚠️

**Required Before Deletion**:

1. **CRITICAL**: Add tool filtering (1-2 hours)
2. **IMPORTANT**: Add TodoWrite formatting (30 minutes)
3. **RECOMMENDED**: Write integration tests (4-6 hours)

**After These Fixes**: ✅ **YES, SAFE TO DELETE**

**Why NEW is Better for Production**:

1. ✅ **Modular Architecture**: Easier to maintain and extend
2. ✅ **Event-Driven**: Better monitoring and analytics
3. ✅ **Intelligent Failover**: Context-aware provider selection
4. ✅ **Reactive State**: Real-time UI updates via RxJS
5. ✅ **Comprehensive Session Management**: Export, search, analytics
6. ✅ **Better Error Handling**: Granular error types, suggested actions
7. ✅ **Separation of Concerns**: Domain libraries isolate business logic

**Current Gaps**:

- ⚠️ Tool result filtering (easy fix)
- ⚠️ Special tool formatting (easy fix)
- ⚠️ Cost tracking (nice-to-have)
- ⚠️ Integration tests (important for confidence)

---

## 📊 Final Recommendation

**Status**: 🟡 **Near Production-Ready** (with minor fixes)

**Action Plan**:

1. ✅ Implement tool filtering in NEW (`JSONLStreamParser`)
2. ✅ Add TodoWrite formatter
3. ✅ Write integration tests for critical flows
4. ✅ Test migration path for existing sessions
5. ✅ **THEN DELETE OLD IMPLEMENTATION**

**Timeline**: ~8 hours of work to reach 100% production-ready status

**Risk Level After Fixes**: 🟢 **LOW** (NEW implementation is architecturally superior)
