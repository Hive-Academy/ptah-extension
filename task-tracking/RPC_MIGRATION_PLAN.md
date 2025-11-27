# RPC Architecture Migration Plan - Next Session

## 📊 Current Status (Session End)

**Branch**: `feature/TASK_2025_010`
**Commits Ahead**: 109 commits
**Last Commit**: `bc0ca56` - Backend event cleanup complete

### ✅ Completed Phases

**Phase 0: Event-Based Code Purge** (COMPLETE)

- ✅ Deleted EventBus, WebviewMessageBridge, MessageHandlerService
- ✅ Deleted 4 orchestration services (chat, provider, analytics, config)
- ✅ Deleted SessionManager, SessionProxy (caching hell)
- ✅ Deleted message-types.ts, message-registry.ts (94 message types)
- ✅ Deleted provider abstraction (18 files, 3,616 lines)
- ✅ Removed all `.onMessageType()` subscriptions from frontend
- ✅ Removed all `eventBus.publish()` calls from backend
- ✅ **Total Deleted**: ~14,000 lines of event-based code

**Commits**:

1. `44d116f` - Backend event infrastructure purge
2. `fa82b80` - Frontend event subscription purge
3. `05e8dcb` - Provider abstraction deletion
4. `bc0ca56` - Backend/frontend cleanup (EventBus dependencies removed)

---

## 🚧 Known Issues (Must Fix)

### Issue 1: Pre-Existing Lint Errors

**Files with Lint Errors** (pre-existing, not caused by migration):

**Backend Libraries**:

- `libs/shared/src/lib/utils/json.utils.ts` - 1 warning
- `libs/shared/src/lib/utils/result.ts` - 6 warnings
- `libs/shared/src/lib/utils/retry.utils.ts` - 2 warnings
- `libs/backend/vscode-core/src/api-wrappers/*` - MESSAGE_TYPES rule violations
- `libs/backend/claude-domain/` - Various lint errors
- `libs/backend/vscode-lm-tools/` - Lint errors
- `libs/backend/template-generation/` - Lint errors

**Frontend Libraries**:

- (No frontend-specific errors - our changes pass linting)

**Resolution**: Fix after RPC migration complete (separate cleanup task)

---

### Issue 2: Build Compilation Status

**Status**: Unknown - need to verify in next session

**Expected Errors**:

- Frontend components calling deleted service methods (ProviderService, etc.)
- Backend services missing EventBus, SessionManager, orchestrations
- Type errors from deleted message types

**Resolution**: Phase 2 (CREATE) will restore functionality via RPC

---

## 🎯 Remaining Work (Next Session)

### Phase 1: VERIFY & FIX BUILD (1-2 hours)

**Objective**: Get codebase to compile with zero errors

**Tasks**:

1. Run `npm run build:all` and document all compilation errors
2. For each error, determine:
   - **Type A**: Missing method calls → Remove/comment with `// TODO: Phase 2 RPC`
   - **Type B**: Missing imports → Remove import statements
   - **Type C**: Missing types → Replace with `any` temporarily or remove usage
3. Iterate until build succeeds with zero errors
4. Commit: `fix(vscode): resolve compilation errors after event purge`

**Success Criteria**:

- ✅ `npm run build:all` completes successfully
- ✅ Zero TypeScript compilation errors
- ⚠️ Extension may not launch (expected - fixed in Phase 2)

---

### Phase 2: CREATE RPC SYSTEM (4-6 hours)

**Objective**: Build minimal RPC-based communication between frontend/backend

#### Component 1: Backend RPC Handler

**File**: `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (~200 lines)

**Responsibilities**:

- Register RPC method handlers (Map<string, handler>)
- Route incoming messages to correct handler
- Return responses with correlation IDs
- Handle errors gracefully

**Pattern**:

```typescript
@injectable()
export class RpcHandler {
  private handlers = new Map<string, RpcMethodHandler>();

  registerMethod(name: string, handler: RpcMethodHandler) {
    this.handlers.set(name, handler);
  }

  async handleMessage(message: RpcMessage): Promise<RpcResponse> {
    const handler = this.handlers.get(message.method);
    if (!handler) {
      return { success: false, error: 'Method not found' };
    }
    return await handler(message.params);
  }
}
```

**RPC Methods to Implement**:

1. `session:list` - List all sessions
2. `session:get` - Get session messages
3. `session:create` - Create new session
4. `session:switch` - Switch to session
5. `chat:sendMessage` - Send chat message
6. `file:read` - Read .jsonl files directly

---

#### Component 2: Frontend RPC Service

**File**: `libs/frontend/core/src/lib/services/claude-rpc.service.ts` (~150 lines)

**Responsibilities**:

- Send RPC calls to backend via postMessage
- Handle responses with correlation ID matching
- Provide type-safe method signatures
- Cache responses where appropriate

**Pattern**:

```typescript
@Injectable()
export class ClaudeRpcService {
  async call<T>(method: string, params: any): Promise<RpcResult<T>> {
    const correlationId = CorrelationId.create();

    this.vscode.postMessage('rpc:call', {
      method,
      params,
      correlationId,
    });

    return this.waitForResponse(correlationId);
  }

  // Type-safe wrappers
  listSessions() {
    return this.call<SessionSummary[]>('session:list', {});
  }
  getSession(id: string) {
    return this.call<Session>('session:get', { id });
  }
  sendMessage(content: string) {
    return this.call('chat:sendMessage', { content });
  }
}
```

---

#### Component 3: Frontend File Service

**File**: `libs/frontend/core/src/lib/services/claude-file.service.ts` (~100 lines)

**Responsibilities**:

- Direct VS Code FileSystem API access
- Read .jsonl session files
- Parse JSONL format
- No backend needed for file reads

**Pattern**:

```typescript
@Injectable()
export class ClaudeFileService {
  async readSessionFile(sessionId: string): Promise<StrictChatMessage[]> {
    const path = this.buildSessionPath(sessionId);
    const content = await vscode.workspace.fs.readFile(Uri.file(path));
    return this.parseJsonl(content);
  }

  private buildSessionPath(sessionId: string): string {
    const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const encoded = WorkspacePathEncoder.encode(workspace);
    return `${os.homedir()}/.claude/projects/${encoded}/${sessionId}.jsonl`;
  }
}
```

---

#### Component 4: Frontend Chat Store

**File**: `libs/frontend/chat/src/lib/services/chat-store.service.ts` (~200 lines)

**Responsibilities**:

- Signal-based state management for chat
- Load sessions via RPC or FileSystem
- Load messages via RPC or FileSystem
- Update UI signals on state changes

**Pattern**:

```typescript
@Injectable()
export class ChatStoreService {
  private _sessions = signal<SessionSummary[]>([]);
  private _currentSession = signal<Session | null>(null);
  private _messages = signal<StrictChatMessage[]>([]);

  readonly sessions = this._sessions.asReadonly();
  readonly currentSession = this._currentSession.asReadonly();
  readonly messages = this._messages.asReadonly();

  async loadSessions() {
    const sessions = await this.fileService.listSessions();
    this._sessions.set(sessions);
  }

  async switchSession(sessionId: string) {
    const messages = await this.fileService.readSessionFile(sessionId);
    this._messages.set(messages);
    this._currentSession.set({ id: sessionId, messages });
  }
}
```

---

### Phase 3: WIRE SYSTEM (2-3 hours)

**Objective**: Connect RPC system to existing components

**Tasks**:

1. Update `main.ts` to register RpcHandler instead of MessageHandlerService
2. Update ChatComponent to use ChatStoreService instead of ChatService
3. Update session list to use ClaudeFileService
4. Remove old service initialization from DI container
5. Wire RPC handlers to ClaudeCliLauncher for message sending

**Files to Modify**:

- `apps/ptah-extension-vscode/src/main.ts`
- `apps/ptah-extension-vscode/src/di/container.ts`
- `libs/frontend/chat/src/lib/components/chat/chat.component.ts`
- `libs/frontend/core/src/lib/services/app-state-manager.service.ts`

---

### Phase 4: TEST SYSTEM (2-3 hours)

**Objective**: Verify complete RPC flow works end-to-end

**Tests**:

1. **Session Loading**:

   - Extension launches
   - Session list appears
   - Clicking session loads messages
   - Messages display correctly

2. **Message Sending**:

   - Type message in input
   - Click send
   - Backend spawns Claude CLI
   - Response streams back
   - Message appears in chat

3. **File Reading**:
   - Frontend reads .jsonl files directly
   - Messages parse correctly
   - No backend needed for reads

**Success Criteria**:

- ✅ Extension launches without errors
- ✅ Session list loads
- ✅ Switching sessions loads messages
- ✅ Sending messages works
- ✅ No message duplication
- ✅ No hallucination

---

## 📋 Execution Checklist

### Next Session Startup

1. **Branch Status**:

   ```bash
   git status
   git log --oneline -10
   ```

2. **Build Status**:

   ```bash
   npm run build:all
   ```

   - Document all compilation errors
   - Create list of files to fix

3. **Create Tasks**:
   - Use TodoWrite to track Phase 1-4 tasks
   - Mark each task as completed when done

---

### Phase Execution Order

**Phase 1**: VERIFY & FIX BUILD (must complete first)
↓
**Phase 2**: CREATE RPC SYSTEM (parallel: backend + frontend)
↓
**Phase 3**: WIRE SYSTEM (connect components)
↓
**Phase 4**: TEST SYSTEM (verify end-to-end)
↓
**Phase 5**: FIX LINT ERRORS (cleanup pre-existing issues)

---

## 🎯 Success Criteria (Migration Complete)

**Functional**:

- ✅ Extension launches without errors
- ✅ Session list loads from .jsonl files
- ✅ Switching sessions loads messages
- ✅ Sending messages spawns Claude CLI
- ✅ Responses stream back and display
- ✅ No message duplication
- ✅ No UI hallucination

**Technical**:

- ✅ Zero TypeScript compilation errors
- ✅ Zero runtime errors in Extension Host console
- ✅ All lint errors fixed (including pre-existing)
- ✅ Build passes: `npm run build:all`
- ✅ Tests pass: `nx run-many --target=test`

**Code Quality**:

- ✅ No EventBus references remain
- ✅ No event subscription code remains
- ✅ RPC pattern implemented correctly
- ✅ Direct file reads working
- ✅ Signal-based state management

---

## 📊 Migration Statistics

**Code Deleted**:

- Event infrastructure: ~5,000 lines
- Frontend event subscriptions: ~2,130 lines
- Provider abstraction: ~3,616 lines
- Message types: ~700 lines
- **Total**: ~14,000 lines deleted

**Code to Create**:

- RpcHandler: ~200 lines
- ClaudeRpcService: ~150 lines
- ClaudeFileService: ~100 lines
- ChatStoreService: ~200 lines
- Wiring code: ~180 lines
- **Total**: ~830 lines created

**Net Result**: -13,170 lines (-94% reduction)

---

## 🔥 Critical Reminders

1. **DO NOT** try to restore EventBus or event subscriptions
2. **DO NOT** use orchestration services (deleted)
3. **DO NOT** use SessionManager/SessionProxy (deleted)
4. **DO** use direct .jsonl file reads (VS Code FileSystem API)
5. **DO** use RPC for backend operations (spawning CLI)
6. **DO** use signals for frontend state (no RxJS BehaviorSubject)

---

## 📝 Commit Strategy (Next Session)

**Phase 1**:

- `fix(vscode): resolve compilation errors after event purge`

**Phase 2**:

- `feat(vscode): add rpc handler backend`
- `feat(webview): add claude rpc service`
- `feat(webview): add claude file service`
- `feat(webview): add chat store service`

**Phase 3**:

- `refactor(vscode): wire rpc system in main extension`
- `refactor(webview): integrate rpc services in chat ui`

**Phase 4**:

- `test(vscode): verify rpc system end-to-end`

**Phase 5**:

- `fix(vscode): resolve pre-existing lint errors in shared library`
- `fix(vscode): resolve lint errors in backend libraries`

---

## 🎯 User Expectations

**After Next Session**:

1. Extension launches cleanly
2. Session list works (loads from .jsonl files)
3. Switching sessions works (loads messages)
4. Sending messages works (spawns Claude CLI)
5. No message duplication or hallucination
6. Build passes with zero errors
7. All lint errors fixed

**Timeline**: 10-14 hours total for all phases

---

## 📚 Reference Files

**Architecture Proposal**: See TASK_2025_019 for original RPC design
**Purge Commits**: See commits 44d116f, fa82b80, 05e8dcb, bc0ca56
**Code Review**: See TASK_2025_019/code-review-report.md for cleanup findings

---

## ✅ Ready for Next Session

This plan provides complete guidance for resuming the RPC migration in a fresh session. All context preserved, all decisions documented, all next steps clear.

**First Action in Next Session**: Run `npm run build:all` and document errors.
