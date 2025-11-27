# RPC Migration TODO Inventory - Complete Checklist

**Generated**: 2025-01-24
**Total TODO Comments**: 150+
**Total Files Affected**: 25+

---

## Summary by File

| File                       | TODO Count | Priority    | Category                |
| -------------------------- | ---------- | ----------- | ----------------------- |
| **claude-cli-launcher.ts** | 15         | 🔴 CRITICAL | Streaming               |
| **command.service.ts**     | 8          | 🔴 CRITICAL | Commands                |
| **provider-manager.ts**    | 9          | 🟡 HIGH     | Provider Events         |
| **file-system-manager.ts** | 14         | 🟡 HIGH     | Analytics               |
| **output-manager.ts**      | 12         | 🟡 HIGH     | Analytics               |
| **webview-manager.ts**     | 9          | 🟡 HIGH     | Analytics + RPC Routing |
| **command-manager.ts**     | 3          | 🟡 HIGH     | Analytics               |
| **status-bar-manager.ts**  | 6          | 🟢 MEDIUM   | Analytics               |
| **claude-cli.service.ts**  | 4          | 🟢 MEDIUM   | Injection               |
| **claude-cli-adapter.ts**  | 4          | 🟢 MEDIUM   | Session Management      |
| **chat.service.ts**        | 4          | 🟢 MEDIUM   | Frontend RPC Calls      |
| **chat.component.ts**      | 2          | 🟢 MEDIUM   | Permission Handling     |
| **analytics.service.ts**   | 2          | 🟢 MEDIUM   | Frontend RPC Calls      |
| **app.ts**                 | 2          | 🟡 LOW      | Initialization          |
| **Other Files**            | 60+        | 🟡 LOW      | Various                 |
| **TOTAL**                  | **150+**   | -           | -                       |

---

## 🔴 CRITICAL Priority (Blocks Core Features)

### 1. libs/backend/claude-domain/src/cli/claude-cli-launcher.ts (15 TODOs)

**Impact**: User cannot see streaming responses

#### Dependencies (Lines 23, 26)

```typescript
readonly sessionManager?: any; // TODO: Phase 2 RPC - Remove SessionManager dependency
readonly eventPublisher?: any; // TODO: Phase 2 RPC - EventBus deleted, use RpcHandler
```

#### Streaming Event Callbacks (Lines 321-431)

```typescript
Line 321: onSessionInit: (claudeSessionId, model) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.sessionManager?.setClaudeSessionId?.(sessionId, claudeSessionId);
  this.deps.eventPublisher?.emitSessionInit?.(sessionId, claudeSessionId, model);
}

Line 334: onContent: (chunk) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.sessionManager?.touchSession?.(sessionId);
  this.deps.eventPublisher?.emitContentChunk?.(sessionId, chunk.blocks);
}

Line 341: onThinking: (thinking) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.eventPublisher?.emitThinking?.(sessionId, thinking);
}

Line 347: onTool: (toolEvent) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.eventPublisher?.emitToolEvent?.(sessionId, toolEvent);
}

Line 358: onError: (error, rawLine) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.eventPublisher?.emitError?.(error.message, sessionId, { rawLine });
}

Line 365: onAgentStart: (event) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.eventPublisher?.emitAgentStarted?.(sessionId, event);
}

Line 370: onAgentActivity: (event) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.eventPublisher?.emitAgentActivity?.(sessionId, event);
}

Line 375: onAgentComplete: (event) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.eventPublisher?.emitAgentCompleted?.(sessionId, event);
}

Line 397: onResult: (result) => {
  // TODO: Phase 2 RPC - Restore via RPC
  if (result.usage) {
    this.deps.eventPublisher?.emitTokenUsage?.(sessionId, { ... });
  }
}

Line 409: // TODO: Phase 2 RPC - Restore via RPC
this.deps.eventPublisher?.emitStreamingEnd?.(sessionId, result);

Line 431: onInvalid: (line) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.eventPublisher?.emitParseError?.(sessionId, line);
}
```

#### Process Lifecycle Events (Lines 463, 483, 487)

```typescript
Line 463: childProcess.on('error', (error) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.eventPublisher?.emitError?.(error.message, sessionId);
});

Line 483: childProcess.on('exit', (code, signal) => {
  // TODO: Phase 2 RPC - Restore via RPC
  this.deps.eventPublisher?.emitProcessExit?.(sessionId, code, signal);
});

Line 487: childProcess.on('close', (code, signal) => {
  // TODO: Phase 2 RPC - Restore via RPC
});
```

---

### 2. libs/backend/claude-domain/src/commands/command.service.ts (8 TODOs)

**Impact**: Code review, test generation, explain code features broken

#### Constructor Injection (Line 136)

```typescript
// @inject(TOKENS.SESSION_MANAGER) // TODO: Phase 2 RPC - Remove SessionManager dependency
```

#### reviewFile Method (Lines 164-186)

```typescript
Line 164: // TODO: Phase 2 RPC - Restore via RPC
Line 165: // let currentSession = await this.sessionManager.getCurrentSession();
Line 167: //   currentSession = await this.sessionManager.createSession({ name: 'Code Review' });

Line 177: // TODO: Phase 2 RPC - Restore via RPC
Line 178: // await this.sessionManager.addUserMessage({ sessionId, content, files: [filePath] });

Line 185: // TODO: Phase 2 RPC - Restore via RPC
// const stream = await this.claudeCliService.sendMessage(sessionId, content, [filePath]);
```

#### generateTests Method (Lines 226-248)

```typescript
Line 226: // TODO: Phase 2 RPC - Restore via RPC
Line 227: // let currentSession = await this.sessionManager.getCurrentSession();
Line 229: //   currentSession = await this.sessionManager.createSession({ name: 'Generate Tests' });

Line 239: // TODO: Phase 2 RPC - Restore via RPC
Line 240: // await this.sessionManager.addUserMessage({ sessionId, content, files: [filePath] });

Line 247: // TODO: Phase 2 RPC - Restore via RPC
// const stream = await this.claudeCliService.sendMessage(sessionId, content, [filePath]);
```

#### explainCode Method (Line 278)

```typescript
Line 278: // TODO: Phase 2 RPC - Restore via RPC
// const session = await this.sessionManager.createSession({ name: `Explain: ${path.basename(filePath)}` });
```

---

## 🟡 HIGH Priority (Blocks Observability & Provider Features)

### 3. libs/backend/ai-providers-core/src/manager/provider-manager.ts (9 TODOs)

**Impact**: Provider switching UI doesn't update, health monitoring broken

```typescript
Line 49: // @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus, // TODO: Phase 2 RPC - remove EventBus

Line 66: // this.setupEventListeners(); // TODO: Phase 2 RPC - remove EventBus

Line 111: // this.eventBus.publish(PROVIDER_MESSAGE_TYPES.AVAILABLE_UPDATED, { // TODO: Phase 2 RPC
Line 161: //   this.eventBus.publish(PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED, { providerId: result.providerId });

Line 238: //   this.eventBus.publish(PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED, { providerId });

Line 322: // TODO: Phase 2 RPC - remove EventBus (setupEventListeners method)

Line 382: // TODO: Phase 2 RPC - remove EventBus (setupHealthMonitoring method)

Line 424: //   this.eventBus.publish(PROVIDER_MESSAGE_TYPES.HEALTH_CHANGED, { providerId, health });

Line 467: // this.eventBus.publish(PROVIDER_MESSAGE_TYPES.ERROR, { // TODO: Phase 2 RPC
Line 516: // this.eventBus.publish(PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED, { // TODO: Phase 2 RPC
Line 523: // this.eventBus.publish(PROVIDER_MESSAGE_TYPES.ERROR, { // TODO: Phase 2 RPC
```

---

### 4. libs/backend/vscode-core/src/api-wrappers/file-system-manager.ts (14 TODOs)

**Impact**: No file operation analytics

```typescript
Line 132: // TODO: Phase 2 - Restore analytics via RPC (file read operation completed)
Line 174: // TODO: Phase 2 - Restore analytics via RPC (file write operation completed)
Line 214: // TODO: Phase 2 - Restore analytics via RPC (file delete operation completed)
Line 255: // TODO: Phase 2 - Restore analytics via RPC (file copy operation completed)
Line 296: // TODO: Phase 2 - Restore analytics via RPC (file move/rename operation completed)
Line 323: // TODO: Phase 2 - Restore analytics via RPC (file stat operation completed)
Line 364: // TODO: Phase 2 - Restore analytics via RPC (directory read operation completed)
Line 417: // TODO: Phase 2 - Restore analytics via RPC (file watcher created)
Line 421: // TODO: Phase 2 - Restore error reporting via RPC
Line 445: // TODO: Phase 2 - Restore analytics via RPC (file watcher disposed)
Line 449: // TODO: Phase 2 - Restore error reporting via RPC
Line 488: // TODO: Phase 2 - Restore analytics via RPC (file system manager disposed)
Line 490: // TODO: Phase 2 - Restore error reporting via RPC
Line 583: // TODO: Phase 2 - Restore analytics via RPC (file watcher event)
Line 602: // TODO: Phase 2 - Restore error reporting via RPC
```

---

### 5. libs/backend/vscode-core/src/api-wrappers/output-manager.ts (12 TODOs)

**Impact**: No output channel analytics/errors

```typescript
Line 130: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 135: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 158: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 177: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 183: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 224: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 228: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 253: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 257: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 281: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 285: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 355: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 359: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 376: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 378: // TODO: Phase 2 - Restore analytics/error reporting via RPC
```

---

### 6. libs/backend/vscode-core/src/api-wrappers/webview-manager.ts (9 TODOs)

**Impact**: No webview analytics + RPC routing not implemented

```typescript
Line 158: // TODO: Phase 2 - Restore analytics via RPC (webview created)
Line 192: // TODO: Phase 2 - Restore analytics via RPC (webview disposed)
Line 195: // TODO: Phase 2 - Restore analytics via RPC (webview created)
Line 232: // TODO: Phase 2 - Restore error reporting via RPC
Line 247: // TODO: Phase 2 - Restore error reporting via RPC
Line 344: // TODO: Phase 2 - Route to RPC handler for message processing
Line 350: // TODO: Phase 2 - Restore error reporting via RPC
Line 367: // TODO: Phase 2 - Restore analytics via RPC (webview ready)
Line 389: // TODO: Phase 2 - Restore analytics via RPC (webview disposed)
Line 402: // TODO: Phase 2 - Restore analytics via RPC (webview visibility changed)
```

**CRITICAL NOTE (Line 344)**: This is the RPC message routing point - must wire to RpcHandler!

---

### 7. libs/backend/vscode-core/src/api-wrappers/command-manager.ts (3 TODOs)

**Impact**: No command execution analytics

```typescript
Line 64: // TODO: Phase 2 - Restore analytics via RPC (command execution started)
Line 74: // TODO: Phase 2 - Restore analytics via RPC (command executed successfully)
Line 81: // TODO: Phase 2 - Restore analytics via RPC (command execution error)
```

---

## 🟢 MEDIUM Priority (Backend Services)

### 8. libs/backend/vscode-core/src/api-wrappers/status-bar-manager.ts (6 TODOs)

```typescript
Line 151: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 156: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 175: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 212: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 220: // TODO: Phase 2 - Restore analytics/error reporting via RPC
Line 250: // TODO: Phase 2 - Restore analytics/error reporting via RPC
```

---

### 9. libs/backend/claude-domain/src/cli/claude-cli.service.ts (4 TODOs)

```typescript
Line 45: // @inject(TOKENS.SESSION_MANAGER) // TODO: Phase 2 RPC - Inject RpcHandler instead
Line 51: // @inject(TOKENS.CLAUDE_DOMAIN_EVENT_PUBLISHER) // TODO: Phase 2 RPC - EventBus deleted, use RpcHandler
Line 83: _sessionManager?: any // TODO: Phase 2 RPC - Remove SessionManager parameter
Line 189: // sessionManager: this.sessionManager, // TODO: Phase 2 RPC - Remove
Line 192: // eventPublisher: this.eventPublisher, // TODO: Phase 2 RPC - Remove
```

---

### 10. libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.ts (4 TODOs)

```typescript
Line 87: // @inject(TOKENS.SESSION_MANAGER) // TODO: Phase 2 RPC - use ClaudeRpcService
Line 250: // TODO: Phase 2 RPC - use ClaudeRpcService instead of SessionManager
Line 288: // TODO: Phase 2 RPC - use ClaudeRpcService instead of SessionManager
Line 347: // TODO: Phase 2 RPC - use ClaudeRpcService instead of SessionManager
```

---

### 11. libs/backend/claude-domain/src/events/claude-domain.events.ts (1 TODO)

```typescript
Line 113: private readonly eventBus?: IEventBus; // TODO: Phase 2 RPC - EventBus deleted, use RpcHandler
```

---

## 🟢 MEDIUM Priority (Frontend Services)

### 12. libs/frontend/core/src/lib/services/chat.service.ts (4 TODOs)

**Impact**: Frontend RPC calls not implemented

```typescript
Line 97: // TODO: Replace with RPC call when implemented
Line 123: // TODO: Replace with RPC call
Line 146: // TODO: Replace with RPC call
Line 182: // TODO: Replace with RPC call
```

---

### 13. libs/frontend/chat/src/lib/containers/chat/chat.component.ts (2 TODOs)

**Impact**: Permission approval/denial not working

```typescript
Line 620: // this.chatService.approvePermission(requestId); // TODO: Phase 2 RPC - restore permission handling
Line 625: // this.chatService.denyPermission(requestId); // TODO: Phase 2 RPC - restore permission handling
```

---

### 14. libs/frontend/core/src/lib/services/analytics.service.ts (2 TODOs)

```typescript
Line 163: // TODO: Phase 2 RPC - Restore via RPC
Line 200: // TODO: Phase 2 RPC - Restore via RPC
```

---

### 15. libs/frontend/core/src/lib/services/app-state.service.ts (1 TODO)

```typescript
Line 145: // TODO: Phase 2 RPC - Restore via RPC
```

---

## 🔵 LOW Priority (Initialization & Cleanup)

### 16. apps/ptah-extension-webview/src/app/app.ts (2 TODOs)

```typescript
Line 80: // TODO (Phase 4): Restore notifyReady or use RPC call
Line 85: // this.providerService.initialize(); // TODO: Phase 2 RPC - remove provider UI dependencies
```

---

### 17. apps/ptah-extension-vscode/src/main.ts (1 TODO)

```typescript
Line 143: // TODO: Implement proper streaming response when RPC streaming is added
```

---

### 18. libs/frontend/analytics/src/lib/containers/analytics/analytics.component.ts (1 TODO)

```typescript
Line 246: // TODO (Phase 4): Restore fetchAnalyticsData or use RPC call
```

---

### 19. libs/frontend/dashboard/src/lib/containers/dashboard/dashboard.component.ts (1 TODO)

```typescript
Line 245: // TODO: Phase 2 - Replace with RPC-based performance monitoring
```

---

### 20. libs/frontend/chat/src/lib/components/chat-input/chat-input-area.component.ts (1 TODO)

```typescript
Line 468: // TODO (Phase 4): Restore includeFile method or use RPC
```

---

### 21. libs/frontend/core/src/lib/services/claude-file.service.ts (1 TODO)

```typescript
Line 76: // TODO: Phase 2 - This will be populated via RPC (backend scans .claude directory)
```

---

### 22. libs/frontend/core/src/lib/services/chat-state.service.ts (1 TODO)

```typescript
Line 9: // TODO: Phase 2 RPC - Restore proper types for Claude messages (remove placeholder)
```

---

### 23. libs/backend/vscode-core/src/index.ts (1 TODO)

```typescript
Line 56: // TODO: Phase 2 - Restore event payload types when RPC is implemented
```

---

### 24. apps/ptah-extension-webview/src/mock/mock-data-generator.ts (2 TODOs)

```typescript
Line 157: // TODO: Phase 2 RPC - Remove mock provider data (provider UI removed in Phase 0)
Line 193: // TODO: Phase 2 RPC - Remove provider-related mock responses (provider UI removed in Phase 0)
```

---

### 25. libs/backend/vscode-core/src/api-wrappers/command-manager.ts (1 TODO)

```typescript
Line 23: // TODO: Phase 2 - Restore analytics payload types when RPC is implemented
```

---

## Summary Statistics

### By Priority

- 🔴 **CRITICAL**: 23 TODOs (2 files) - **Blocks streaming & commands**
- 🟡 **HIGH**: 47 TODOs (5 files) - **Blocks analytics & providers**
- 🟢 **MEDIUM**: 21 TODOs (8 files) - **Blocks backend/frontend services**
- 🔵 **LOW**: 10 TODOs (10 files) - **Initialization & cleanup**

### By Category

- **Streaming Events**: 15 TODOs (claude-cli-launcher.ts)
- **Analytics Tracking**: 47 TODOs (file-system, output, webview, command, status-bar managers)
- **Provider Events**: 9 TODOs (provider-manager.ts)
- **Command Service**: 8 TODOs (command.service.ts)
- **Session Management**: 4 TODOs (claude-cli-adapter.ts)
- **Frontend RPC Calls**: 4 TODOs (chat.service.ts)
- **Permission Handling**: 2 TODOs (chat.component.ts)
- **Initialization**: 10 TODOs (various frontend files)

### By File Type

- **Backend Services**: 90+ TODOs
- **Frontend Services**: 20+ TODOs
- **Documentation/Tracking**: 40+ TODOs (markdown files)

---

## Critical Path to Functional Extension

**Minimum viable implementation order**:

1. **Phase 1: Streaming** (15 TODOs in claude-cli-launcher.ts)

   - Wire RpcHandler to ClaudeCliLauncher
   - Implement `rpc:stream` event emission
   - Frontend stream event handlers
   - **Result**: User can see responses

2. **Phase 2: RPC Routing** (1 TODO in webview-manager.ts line 344)

   - Wire webview messages to RpcHandler
   - **Result**: RPC calls reach backend

3. **Phase 3: Command Service** (8 TODOs in command.service.ts)

   - Uncomment SessionManager calls (already restored)
   - **Result**: Code review/tests work

4. **Phase 4: Provider Events** (9 TODOs in provider-manager.ts)

   - Emit provider stream events
   - **Result**: Provider UI updates

5. **Phase 5: Analytics** (47 TODOs in API wrappers)
   - Implement analytics RPC methods
   - **Result**: Observability restored

---

## Completion Checklist

### Phase 1: Streaming (CRITICAL)

- [ ] claude-cli-launcher.ts: 15 TODOs removed
- [ ] Frontend: Stream event handlers added
- [ ] Test: Send message, see streaming response

### Phase 2: RPC Routing (CRITICAL)

- [ ] webview-manager.ts: Line 344 wired to RpcHandler
- [ ] Test: RPC call reaches backend

### Phase 3: Command Service (HIGH)

- [ ] command.service.ts: 8 TODOs removed
- [ ] Test: Code review works
- [ ] Test: Generate tests works

### Phase 4: Provider Events (HIGH)

- [ ] provider-manager.ts: 9 TODOs removed
- [ ] Test: Provider switch updates UI

### Phase 5: Analytics (MEDIUM)

- [ ] file-system-manager.ts: 14 TODOs removed
- [ ] output-manager.ts: 12 TODOs removed
- [ ] webview-manager.ts: 8 TODOs removed
- [ ] command-manager.ts: 3 TODOs removed
- [ ] status-bar-manager.ts: 6 TODOs removed
- [ ] Test: Analytics data collected

### Phase 6: Frontend Integration (MEDIUM)

- [ ] chat.service.ts: 4 TODOs removed
- [ ] chat.component.ts: 2 TODOs removed
- [ ] analytics.service.ts: 2 TODOs removed

### Phase 7: Cleanup (LOW)

- [ ] All other TODOs removed
- [ ] Build passes
- [ ] All tests pass
- [ ] Documentation updated

---

**TOTAL ESTIMATED EFFORT**: 8-12 hours for all phases

**MINIMUM VIABLE EFFORT**: 3-4 hours for Phases 1-3 (streaming, routing, commands)

---

**END OF INVENTORY**
