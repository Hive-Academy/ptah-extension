# Implementation Plan - RPC Architecture Migration

**Task ID**: TASK_2025_021
**Created**: 2025-11-23
**Architect**: Software Architect (from RPC_MIGRATION_PLAN.md)

---

## Overview

Transform the Ptah extension's messaging architecture from a complex event-based system to a simple RPC-based pattern. This migration restores functionality after Phase 0 (Event Purge) which deleted ~14,000 lines of problematic event code.

## Architecture Design

### RPC Communication Pattern

**Frontend → Backend Communication**:

```typescript
// Frontend calls backend via RPC
const result = await claudeRpcService.call<SessionSummary[]>('session:list', {});

// Backend routes to handler
rpcHandler.handleMessage({ method: 'session:list', params: {}, correlationId })
  → sessionService.listSessions()
  → return { success: true, data: [...] }
```

**Frontend → File System** (Direct Access):

```typescript
// Frontend reads .jsonl files directly (no backend needed)
const messages = await claudeFileService.readSessionFile(sessionId);
// Uses VS Code FileSystem API: vscode.workspace.fs.readFile()
```

### Key Components

1. **Backend RpcHandler** (`libs/backend/vscode-core/src/messaging/rpc-handler.ts`)

   - Routes RPC method calls to registered handlers
   - Returns type-safe responses with correlation IDs
   - Handles errors gracefully

2. **Frontend ClaudeRpcService** (`libs/frontend/core/src/lib/services/claude-rpc.service.ts`)

   - Sends RPC calls to backend via postMessage
   - Matches responses using correlation IDs
   - Provides type-safe method wrappers

3. **Frontend ClaudeFileService** (`libs/frontend/core/src/lib/services/claude-file.service.ts`)

   - Direct .jsonl file access (no backend needed)
   - Parses JSONL format
   - Builds correct session file paths

4. **Frontend ChatStoreService** (`libs/frontend/chat/src/lib/services/chat-store.service.ts`)
   - Signal-based state management
   - Loads sessions/messages via FileService
   - Updates UI signals on state changes

---

## Phase 1: Verify & Fix Build (1-2 hours)

### Objective

Get codebase to compile with zero TypeScript errors.

### Tasks

#### Task 1.1: Run Build & Document Errors

- Execute: `npm run build:all`
- Document all compilation errors in a file
- Categorize errors:
  - **Type A**: Missing method calls → Remove/comment with `// TODO: Phase 2 RPC`
  - **Type B**: Missing imports → Remove import statements
  - **Type C**: Missing types → Replace with `any` temporarily or remove usage

#### Task 1.2: Fix Compilation Errors

For each error:

- Frontend components calling deleted methods (ProviderService, etc.) → Comment out
- Backend services missing EventBus → Remove eventBus parameters
- Type errors from deleted message types → Use `any` or remove

#### Task 1.3: Verify Build Success

- Run `npm run build:all` again
- Confirm: Zero TypeScript compilation errors
- Note: Extension may not launch (expected - fixed in Phase 3)

**Git Commit**: `fix(vscode): resolve compilation errors after event purge`

---

## Phase 2: Create RPC System (4-6 hours)

### Component 1: Backend RpcHandler

**File**: `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (~200 lines)

**Interface Design**:

```typescript
export interface RpcMessage {
  method: string;
  params: unknown;
  correlationId: string;
}

export interface RpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  correlationId: string;
}

type RpcMethodHandler = (params: unknown) => Promise<unknown>;

@injectable()
export class RpcHandler {
  private handlers = new Map<string, RpcMethodHandler>();

  registerMethod(name: string, handler: RpcMethodHandler): void;
  async handleMessage(message: RpcMessage): Promise<RpcResponse>;
}
```

**RPC Methods to Register**:

1. `session:list` - List all sessions (returns SessionSummary[])
2. `session:get` - Get session messages (returns Session)
3. `session:create` - Create new session (returns SessionId)
4. `session:switch` - Switch to session (returns void)
5. `chat:sendMessage` - Send chat message (spawns CLI, returns void)
6. `file:read` - Read .jsonl files (returns StrictChatMessage[])

**Implementation Notes**:

- Use DI to inject dependencies (ClaudeCliLauncher, etc.)
- Add to DI container with token `DI_TOKENS.RPC_HANDLER`
- Error handling: Catch all errors, return `{ success: false, error: message }`
- Logging: Use Logger service for debugging

**Task 2.1: Create RpcHandler class and register in DI**

---

### Component 2: Frontend ClaudeRpcService

**File**: `libs/frontend/core/src/lib/services/claude-rpc.service.ts` (~150 lines)

**Interface Design**:

```typescript
export interface RpcCallOptions {
  timeout?: number; // Default: 30000ms
}

export class RpcResult<T> {
  constructor(public readonly success: boolean, public readonly data?: T, public readonly error?: string) {}
}

@Injectable()
export class ClaudeRpcService {
  private pendingCalls = new Map<string, (response: RpcResponse) => void>();

  async call<T>(method: string, params: unknown, options?: RpcCallOptions): Promise<RpcResult<T>>;

  // Type-safe wrappers
  listSessions(): Promise<RpcResult<SessionSummary[]>>;
  getSession(id: SessionId): Promise<RpcResult<Session>>;
  createSession(): Promise<RpcResult<SessionId>>;
  switchSession(id: SessionId): Promise<RpcResult<void>>;
  sendMessage(content: string): Promise<RpcResult<void>>;
}
```

**Implementation Notes**:

- Inject VSCodeService for postMessage access
- Generate correlation IDs using `CorrelationId.create()`
- Store promise resolvers in Map keyed by correlationId
- Handle timeouts (reject after 30s default)
- Clean up pending calls on resolve/reject

**Task 2.2: Create ClaudeRpcService and add to providers**

---

### Component 3: Frontend ClaudeFileService

**File**: `libs/frontend/core/src/lib/services/claude-file.service.ts` (~100 lines)

**Interface Design**:

```typescript
export interface SessionFileInfo {
  sessionId: SessionId;
  path: string;
  exists: boolean;
  messageCount?: number;
}

@Injectable()
export class ClaudeFileService {
  async readSessionFile(sessionId: SessionId): Promise<StrictChatMessage[]>;
  async listSessionFiles(): Promise<SessionFileInfo[]>;
  private buildSessionPath(sessionId: SessionId): string;
  private parseJsonl(content: Uint8Array): StrictChatMessage[];
}
```

**Implementation Notes**:

- Use VS Code FileSystem API: `vscode.workspace.fs.readFile(Uri.file(path))`
- Path formula: `${os.homedir()}/.claude/projects/${encoded}/${sessionId}.jsonl`
  - Use WorkspacePathEncoder from shared library
- Parse JSONL: Split by `\n`, JSON.parse each line, filter valid messages
- Error handling: Return empty array if file doesn't exist

**Task 2.3: Create ClaudeFileService and add to providers**

---

### Component 4: Frontend ChatStoreService

**File**: `libs/frontend/chat/src/lib/services/chat-store.service.ts` (~200 lines)

**Interface Design**:

```typescript
@Injectable()
export class ChatStoreService {
  // Signals (read-only)
  readonly sessions: Signal<SessionSummary[]>;
  readonly currentSession: Signal<Session | null>;
  readonly messages: Signal<StrictChatMessage[]>;
  readonly isLoading: Signal<boolean>;

  // Private writable signals
  private _sessions = signal<SessionSummary[]>([]);
  private _currentSession = signal<Session | null>(null);
  private _messages = signal<StrictChatMessage[]>([]);
  private _isLoading = signal(false);

  // Public methods
  async loadSessions(): Promise<void>;
  async switchSession(sessionId: SessionId): Promise<void>;
  async sendMessage(content: string): Promise<void>;
  async createNewSession(): Promise<SessionId>;
}
```

**Implementation Notes**:

- Inject ClaudeFileService, ClaudeRpcService
- Use signals for all state (no RxJS BehaviorSubject)
- `loadSessions()`: Read .jsonl files directly via FileService
- `switchSession()`: Read session file, update `_messages` signal
- `sendMessage()`: Call RPC `chat:sendMessage`, don't update messages (CLI will write to .jsonl)
- Add to frontend/chat library providers

**Task 2.4: Create ChatStoreService and add to providers**

---

## Phase 3: Wire System (2-3 hours)

### Task 3.1: Update Extension Main Entry Point

**File**: `apps/ptah-extension-vscode/src/main.ts`

**Changes**:

- Remove MessageHandlerService initialization
- Add RpcHandler initialization
- Register all RPC methods in activate()

```typescript
// Before
const messageHandler = container.get(DI_TOKENS.MESSAGE_HANDLER);
messageHandler.initialize();

// After
const rpcHandler = container.get(DI_TOKENS.RPC_HANDLER);
rpcHandler.registerMethod('session:list', async () => {
  const launcher = container.get(DI_TOKENS.CLAUDE_CLI_LAUNCHER);
  return await launcher.listSessions();
});
// ... register other methods
```

### Task 3.2: Update DI Container

**File**: `apps/ptah-extension-vscode/src/di/container.ts`

**Changes**:

- Remove MESSAGE*HANDLER, MESSAGE_BRIDGE, ORCHESTRATION*\* tokens
- Add RPC_HANDLER token
- Bind RpcHandler to container

### Task 3.3: Update ChatComponent

**File**: `libs/frontend/chat/src/lib/components/chat/chat.component.ts`

**Changes**:

- Replace ChatService with ChatStoreService
- Use signals instead of observables
- Remove event subscriptions

```typescript
// Before
constructor(private chatService: ChatService) {}
this.chatService.messages$.subscribe(messages => ...);

// After
constructor(private chatStore: ChatStoreService) {}
messages = this.chatStore.messages; // Signal
```

### Task 3.4: Update Session List Component

**File**: `libs/frontend/chat/src/lib/components/session-list/session-list.component.ts`

**Changes**:

- Use ChatStoreService.sessions signal
- Call chatStore.switchSession() on click
- Remove event-based session loading

**Git Commits**:

- `refactor(vscode): wire rpc system in main extension`
- `refactor(webview): integrate rpc services in chat ui`

---

## Phase 4: Test System (2-3 hours)

### Task 4.1: Manual Testing in Extension Development Host

**Test Cases**:

1. **Extension Launch**:

   - Press F5 to launch Extension Development Host
   - Verify: No errors in Extension Host console
   - Verify: Webview loads without errors

2. **Session List Loading**:

   - Open Ptah webview
   - Verify: Session list appears
   - Verify: Sessions loaded from .jsonl files

3. **Switch Session**:

   - Click a session in the list
   - Verify: Messages load and display
   - Verify: No message duplication
   - Verify: Correct session highlighted

4. **Send Message**:

   - Type a message in input field
   - Click send
   - Verify: Backend spawns Claude CLI
   - Verify: Response streams back
   - Verify: Message appears in chat

5. **Error Scenarios**:
   - No workspace open → Verify graceful error
   - Invalid session ID → Verify error message
   - Network timeout → Verify timeout handling

### Task 4.2: Browser DevTools Inspection

**Checks**:

- Console: No JavaScript errors
- Network: Verify postMessage calls
- Performance: No memory leaks
- Signals: Verify state updates correctly

### Task 4.3: Integration Testing

**Full Workflow Test**:

1. Launch extension
2. Create new session
3. Send 3 messages
4. Switch to different session
5. Send 2 more messages
6. Verify both sessions have correct messages
7. Reload extension
8. Verify messages persist

**Expected Results**:

- ✅ Zero errors in console
- ✅ Zero message duplication
- ✅ Messages persist across reloads
- ✅ Session switching works
- ✅ No UI hallucination

**Git Commit**: `test(vscode): verify rpc system end-to-end`

---

## Phase 5: Fix Lint Errors (1-2 hours)

### Task 5.1: Fix Shared Library Warnings

**Files** (pre-existing errors):

- `libs/shared/src/lib/utils/json.utils.ts` - 1 warning
- `libs/shared/src/lib/utils/result.ts` - 6 warnings
- `libs/shared/src/lib/utils/retry.utils.ts` - 2 warnings

**Fix**: Add proper type annotations, fix ESLint violations

### Task 5.2: Fix Backend Library Errors

**Files** (pre-existing errors):

- `libs/backend/vscode-core/src/api-wrappers/*` - MESSAGE_TYPES violations
- `libs/backend/claude-domain/` - Various lint errors
- `libs/backend/vscode-lm-tools/` - Lint errors
- `libs/backend/template-generation/` - Lint errors

**Fix**: Remove MESSAGE_TYPES constants, fix ESLint violations

**Git Commits**:

- `fix(vscode): resolve pre-existing lint errors in shared library`
- `fix(vscode): resolve lint errors in backend libraries`

---

## Technical Decisions

### Decision 1: Direct File Reads (Frontend)

**Choice**: Frontend reads .jsonl files directly via VS Code FileSystem API

**Rationale**:

- No backend needed for read operations
- Faster (no IPC overhead)
- Simpler architecture
- VS Code API is stable and well-documented

**Trade-off**: Frontend needs file path calculation logic

---

### Decision 2: RPC for Write Operations Only

**Choice**: Use RPC only for operations that require backend (spawning CLI)

**Rationale**:

- Minimize backend surface area
- Reduce message passing overhead
- Simplify debugging

**Operations via RPC**:

- Send message (spawns Claude CLI)
- Create session (may need backend logic)
- Configuration changes (backend state)

**Operations via FileSystem**:

- Read sessions (direct .jsonl access)
- Read messages (direct .jsonl access)
- List sessions (scan .jsonl files)

---

### Decision 3: Signal-Based State Management

**Choice**: Use Angular signals for all frontend state (no RxJS)

**Rationale**:

- Zoneless change detection (30% performance improvement)
- Simpler mental model (no observable chains)
- Better TypeScript inference
- Aligns with Angular 20+ best practices

**Migration**:

```typescript
// Before (RxJS)
private messagesSubject = new BehaviorSubject<Message[]>([]);
messages$ = this.messagesSubject.asObservable();

// After (Signals)
private _messages = signal<Message[]>([]);
readonly messages = this._messages.asReadonly();
```

---

### Decision 4: Correlation ID Pattern

**Choice**: Use correlation IDs to match RPC requests/responses

**Rationale**:

- Handles concurrent requests correctly
- Timeout management per request
- Type-safe response routing

**Implementation**:

```typescript
const correlationId = CorrelationId.create();
this.pendingCalls.set(correlationId, resolve);
this.vscode.postMessage({ method, params, correlationId });
// ... later when response arrives
const resolver = this.pendingCalls.get(response.correlationId);
resolver(response);
this.pendingCalls.delete(response.correlationId);
```

---

## Dependencies

### New Dependencies

None - all components use existing libraries and APIs

### Removed Dependencies

- EventBus (deleted)
- MessageHandlerService (deleted)
- SessionManager / SessionProxy (deleted)
- Orchestration services (deleted)
- 94 message type definitions (deleted)

### Existing Dependencies (Reused)

- ClaudeCliLauncher (for spawning CLI)
- Logger (for debugging)
- VS Code APIs (FileSystem, postMessage)
- DI Container (for service injection)
- Angular signals (for state management)

---

## File Structure

```
libs/backend/vscode-core/src/messaging/
  ├── rpc-handler.ts              # NEW - Backend RPC router
  └── rpc-types.ts                # NEW - Shared RPC interfaces

libs/frontend/core/src/lib/services/
  ├── claude-rpc.service.ts       # NEW - Frontend RPC client
  ├── claude-file.service.ts      # NEW - Direct file access
  └── app-state-manager.service.ts # MODIFIED - Use ChatStore

libs/frontend/chat/src/lib/services/
  └── chat-store.service.ts       # NEW - Signal-based state

libs/frontend/chat/src/lib/components/
  ├── chat/chat.component.ts      # MODIFIED - Use ChatStore
  └── session-list/session-list.component.ts # MODIFIED - Use ChatStore

apps/ptah-extension-vscode/src/
  ├── main.ts                     # MODIFIED - Initialize RPC
  └── di/container.ts             # MODIFIED - Bind RpcHandler
```

---

## Validation Checklist

**Phase 1 Complete**:

- [ ] `npm run build:all` succeeds
- [ ] Zero TypeScript compilation errors
- [ ] Commit created: `fix(vscode): resolve compilation errors after event purge`

**Phase 2 Complete**:

- [ ] RpcHandler class created and tested
- [ ] ClaudeRpcService created and tested
- [ ] ClaudeFileService created and tested
- [ ] ChatStoreService created and tested
- [ ] All services added to DI/providers
- [ ] Commits created for each component

**Phase 3 Complete**:

- [ ] main.ts updated to use RpcHandler
- [ ] DI container updated
- [ ] ChatComponent uses ChatStoreService
- [ ] Session list uses ChatStoreService
- [ ] No EventBus references remain
- [ ] Commits created for wiring changes

**Phase 4 Complete**:

- [ ] Extension launches without errors
- [ ] Session list loads
- [ ] Session switching works
- [ ] Message sending works
- [ ] No message duplication
- [ ] No UI hallucination
- [ ] Commit created: `test(vscode): verify rpc system end-to-end`

**Phase 5 Complete**:

- [ ] All shared library warnings fixed
- [ ] All backend library errors fixed
- [ ] `npm run lint:all` passes
- [ ] Commits created for lint fixes

---

## Timeline

- **Phase 1**: 1-2 hours
- **Phase 2**: 4-6 hours
- **Phase 3**: 2-3 hours
- **Phase 4**: 2-3 hours
- **Phase 5**: 1-2 hours

**Total**: 10-16 hours

---

## Success Criteria

1. ✅ Extension launches cleanly in Extension Development Host
2. ✅ Session list loads from .jsonl files
3. ✅ Clicking session loads and displays messages
4. ✅ Sending message spawns Claude CLI and response appears
5. ✅ No message duplication (one source of truth: .jsonl files)
6. ✅ No UI hallucination (signals update correctly)
7. ✅ Build passes: `npm run build:all`
8. ✅ Lint passes: `npm run lint:all`
9. ✅ No EventBus references in codebase
10. ✅ Net code reduction: ~13,000 lines deleted, ~650 lines added

---

**This implementation plan is ready for team-leader decomposition into atomic tasks.**
