# Implementation Plan - TASK_2025_179: Ptah CLI TUI Application

## Codebase Investigation Summary

### Libraries Discovered

- **vscode-core** (`libs/backend/vscode-core/`): Infrastructure layer with RpcHandler, WebviewManager, TOKENS, Logger. All exports verified in `src/index.ts`.
- **shared** (`libs/shared/`): Foundation types including `RpcMessage`, `RpcResponse` (from `messaging/rpc-types.ts`), `MESSAGE_TYPES` (from `message.types.ts`), `FlatStreamEventUnion` (from `execution-node.types.ts`).
- **agent-sdk** (`libs/backend/agent-sdk/`): SDK integration with session management, streaming, permission handling.

### Patterns Identified

**DI Token Pattern** (Evidence: `libs/backend/vscode-core/src/di/tokens.ts`):

- All tokens use `Symbol.for('DescriptiveName')` pattern
- Tokens collected in `TOKENS` const object
- Injected via `@inject(TOKENS.X)` decorators

**Library Registration Pattern** (Evidence: `apps/ptah-extension-vscode/src/di/container.ts`):

- Each library exports `registerXxxServices(container)` function
- Container orchestrator calls all registration functions in order
- App-level services registered directly in container.ts

**RPC Method Pattern** (Evidence: `libs/backend/vscode-core/src/messaging/rpc-handler.ts:44-67`):

- Methods validated against `ALLOWED_METHOD_PREFIXES` whitelist
- Currently: `session:`, `chat:`, `file:`, `workspace:`, `config:`, `auth:`, `license:`, `llm:`, `agent:`, `ptahCli:`, etc.
- Need to add `ipc:` prefix for IPC-specific methods (e.g., `ipc:ping`)

**Broadcast Pattern** (Evidence: `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:317-345`):

- `WebviewManager.broadcastMessage(type, payload)` sends to all active webview panels and views
- All broadcast callers use `this.webviewManager.broadcastMessage(MESSAGE_TYPES.X, payload)`
- Callers inject `WebviewManager` via `@inject(TOKENS.WEBVIEW_MANAGER)`
- The `WebviewManager` interface used by handlers (Evidence: `rpc-method-registration.service.ts:64-67`):
  ```typescript
  interface WebviewManager {
    sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
    broadcastMessage(type: string, payload: unknown): Promise<void>;
  }
  ```

**Broadcast Message Types** (Evidence: `libs/shared/src/lib/types/message.types.ts:309-350`):

- `CHAT_CHUNK` ('chat:chunk') - Streaming text/tool/agent events
- `SESSION_STATS` ('session:stats') - Token counts, cost, duration
- `SESSION_ID_RESOLVED` ('session:id-resolved') - Real session ID after SDK resolves
- `AGENT_SUMMARY_CHUNK` ('agent:summary-chunk') - Agent summary streaming
- `AGENT_MONITOR_SPAWNED/OUTPUT/EXITED` - Agent process lifecycle
- `AGENT_MONITOR_PERMISSION_REQUEST/RESPONSE` - Permission flows

**Extension Activation Sequence** (Evidence: `apps/ptah-extension-vscode/src/main.ts:302-738`):

- Step 1: Minimal DI for license check
- Step 2: License verification (blocking)
- Step 3: Full DI setup
- Step 4: Logger resolution
- Step 5: RPC method registration
- Step 6: Autocomplete watchers
- Step 7: SDK auth, plugin loader, CLI sync, pricing, CLI detection
- Step 8: Session import
- Step 9-11: PtahExtension init, registerAll
- Step 12: MCP server (Pro only)
- Step 13: License watcher
- **IPC server should start between Step 5 (RPC registered) and Step 8**

**Nx Library project.json Pattern** (Evidence: `libs/backend/agent-sdk/project.json`):

- esbuild executor for CJS backend libraries
- Targets: build, test, typecheck, lint
- External dependencies listed explicitly
- Tags: `scope:extension`, `type:feature`

### Integration Points

**RpcHandler.handleMessage()** (Evidence: `libs/backend/vscode-core/src/messaging/rpc-handler.ts:219-266`):

- Accepts `RpcMessage { method, params, correlationId }`
- Returns `RpcResponse { success, data?, error?, errorCode?, correlationId }`
- Includes license validation middleware
- This is exactly what the IPC server needs to call for incoming messages

**WebviewManager Broadcast Interception** (Evidence: `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:317-345`):

- `broadcastMessage()` iterates `activeWebviews` Map and `activeWebviewViews` Map
- To forward broadcasts to IPC clients, we need a **decorator/wrapper** around WebviewManager
- Strategy: Create `BroadcastForwardingWebviewManager` that wraps the real WebviewManager, calls original + forwards to IPC server

---

## Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Decorator pattern for broadcast forwarding + shared IPC transport library

**Rationale**:

1. The existing `WebviewManager` is injected via `TOKENS.WEBVIEW_MANAGER` throughout the codebase. By replacing the DI registration with a decorator that wraps the real WebviewManager, all 28+ `broadcastMessage()` call sites automatically forward to IPC clients with zero code changes.
2. The IPC transport library (`cli-ipc`) is a pure Node.js library with no VS Code dependencies, making it usable by both the extension (server) and CLI app (client).
3. The CLI app uses Ink (React) which is completely separate from Angular -- no build conflicts.

**Evidence**:

- WebviewManager injected via `TOKENS.WEBVIEW_MANAGER` (rpc-method-registration.service.ts:80, chat-rpc.handlers.ts:64)
- All broadcast calls go through `this.webviewManager.broadcastMessage()` (28 occurrences across 4 handler files)
- DI container allows re-registration to override (tsyringe pattern)

---

## Component Specifications

### Component 1: IPC Bridge Library (`libs/backend/cli-ipc`)

**Purpose**: Shared IPC transport providing server (extension side) and client (CLI side) over named pipes/Unix sockets. Zero VS Code dependencies.

**Pattern**: Pure Node.js library using `node:net`, `node:crypto` for pipe path hashing.

**Evidence**: Follows same esbuild library pattern as `libs/backend/agent-sdk/project.json`

#### Files

##### 1. `libs/backend/cli-ipc/src/index.ts` (CREATE)

**Purpose**: Barrel exports for the library.
**Key Exports**: `IpcServer`, `IpcClient`, `getPipePath`, protocol types
**Dependencies**: Re-exports from internal modules
**Estimated Lines**: ~15

##### 2. `libs/backend/cli-ipc/src/lib/protocol.ts` (CREATE)

**Purpose**: Defines the IPC wire protocol types and length-prefix framing utilities.
**Key Exports**:

```typescript
/** IPC message wrapper for RPC calls */
export interface IpcRpcMessage {
  type: 'rpc';
  payload: RpcMessage; // from @ptah-extension/shared or inline
}

/** IPC message wrapper for broadcast push notifications */
export interface IpcBroadcastMessage {
  type: 'broadcast';
  messageType: string; // e.g., 'chat:chunk', 'session:stats'
  payload: unknown;
}

/** Union of all IPC message types (client -> server) */
export type IpcClientMessage = IpcRpcMessage;

/** Union of all IPC message types (server -> client) */
export type IpcServerMessage = IpcRpcResponse | IpcBroadcastMessage;

/** IPC RPC response wrapper */
export interface IpcRpcResponse {
  type: 'rpc-response';
  payload: RpcResponse; // from @ptah-extension/shared or inline
}

/** RPC message shape (duplicated to avoid vscode-core dependency) */
export interface RpcMessage {
  method: string;
  params: unknown;
  correlationId: string;
}

/** RPC response shape (duplicated to avoid vscode-core dependency) */
export interface RpcResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
  correlationId: string;
}

/** Encode a message to length-prefixed buffer */
export function encodeMessage(msg: unknown): Buffer;

/** Decode length-prefixed messages from a buffer, returns [decoded[], remainingBuffer] */
export function decodeMessages(buffer: Buffer): [unknown[], Buffer];
```

**Dependencies**: None (pure Node.js Buffer operations)
**Estimated Lines**: ~80

**Framing Protocol Detail**:

- Each message: `[4-byte big-endian uint32 length][UTF-8 JSON payload]`
- `encodeMessage`: JSON.stringify -> Buffer.from(utf8) -> prepend 4-byte length header
- `decodeMessages`: Read 4-byte length, extract that many bytes as JSON, repeat until buffer exhausted. Return partial buffer remainder for next chunk.

##### 3. `libs/backend/cli-ipc/src/lib/pipe-path.ts` (CREATE)

**Purpose**: Deterministic pipe path generation from workspace folder path. Used by both server and client.
**Key Exports**:

```typescript
/**
 * Generate deterministic pipe path from workspace folder.
 * Windows: \\.\pipe\ptah-{hash8}
 * Unix: /tmp/ptah-{hash8}.sock
 *
 * @param workspacePath - Absolute path to workspace folder
 * @returns Platform-specific pipe/socket path
 */
export function getPipePath(workspacePath: string): string;
```

**Dependencies**: `node:crypto` (SHA-256), `node:os` (platform detection)
**Estimated Lines**: ~25

##### 4. `libs/backend/cli-ipc/src/lib/ipc-server.ts` (CREATE)

**Purpose**: Named pipe server that accepts CLI client connections, routes RPC messages to a handler callback, and pushes broadcast events to all connected clients.
**Key Exports**:

```typescript
export interface IpcServerOptions {
  pipePath: string;
  /** Called when an RPC message arrives from a client */
  onRpcMessage: (message: RpcMessage) => Promise<RpcResponse>;
  /** Optional logger */
  logger?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; debug: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

export class IpcServer {
  constructor(options: IpcServerOptions);

  /** Start listening on the named pipe */
  start(): Promise<void>;

  /** Send a broadcast message to all connected clients */
  broadcast(messageType: string, payload: unknown): void;

  /** Get count of connected clients */
  get clientCount(): number;

  /** Stop server and clean up */
  dispose(): void;
}
```

**Dependencies**: `node:net`, `node:fs` (stale socket cleanup), `./protocol`, `./pipe-path`
**Estimated Lines**: ~120

**Implementation Notes**:

- `start()`: If socket file exists on Unix, attempt connect to detect stale file. If ECONNREFUSED, delete and recreate. On Windows, named pipes auto-cleanup.
- Each client connection gets its own `Buffer` accumulator for partial message handling via `decodeMessages()`.
- `broadcast()`: Iterates all connected sockets, calls `encodeMessage()` + `socket.write()` for each. Fire-and-forget (errors logged, socket removed from set).
- `dispose()`: Close all client sockets, close server, unlink socket file on Unix.
- Unix socket created with mode `0o600` (owner-only) for security.

##### 5. `libs/backend/cli-ipc/src/lib/ipc-client.ts` (CREATE)

**Purpose**: Named pipe client that connects to the extension's IPC server, sends RPC requests, and receives broadcast push notifications.
**Key Exports**:

```typescript
export interface IpcClientOptions {
  pipePath: string;
  /** Optional logger */
  logger?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void; debug: (...args: unknown[]) => void };
}

export type BroadcastHandler = (messageType: string, payload: unknown) => void;

export class IpcClient {
  constructor(options: IpcClientOptions);

  /** Connect to the IPC server. Throws if connection fails after retries. */
  connect(): Promise<void>;

  /** Send an RPC request and wait for the response */
  request(method: string, params?: unknown): Promise<RpcResponse>;

  /** Register a handler for broadcast messages */
  onBroadcast(handler: BroadcastHandler): () => void;

  /** Whether the client is currently connected */
  get connected(): boolean;

  /** Disconnect from the server */
  dispose(): void;
}
```

**Dependencies**: `node:net`, `./protocol`
**Estimated Lines**: ~130

**Implementation Notes**:

- `connect()`: Uses `net.createConnection()`. On failure, retries with exponential backoff (3 retries: 1s, 2s, 4s).
- `request()`: Generates a `correlationId` (UUID v4 or counter), wraps in `IpcRpcMessage`, sends via `encodeMessage()`. Returns a `Promise` that resolves when a matching `IpcRpcResponse` with same `correlationId` arrives. Timeout after 30s.
- Incoming data: Accumulated in buffer, decoded via `decodeMessages()`. `IpcRpcResponse` messages resolve pending promises. `IpcBroadcastMessage` messages dispatched to registered handlers.
- Auto-reconnect: On `'close'` event, attempt reconnect with backoff if `dispose()` hasn't been called. Emit a 'disconnected'/'reconnected' event pattern.
- `onBroadcast()`: Adds handler to Set, returns unsubscribe function.

##### 6. `libs/backend/cli-ipc/project.json` (CREATE)

**Purpose**: Nx project configuration for the cli-ipc library.
**Pattern Source**: `libs/backend/agent-sdk/project.json`

```json
{
  "name": "@ptah-extension/cli-ipc",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/backend/cli-ipc/src",
  "projectType": "library",
  "tags": ["scope:extension", "type:feature"],
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/backend/cli-ipc",
        "main": "libs/backend/cli-ipc/src/index.ts",
        "tsConfig": "libs/backend/cli-ipc/tsconfig.lib.json",
        "assets": ["libs/backend/cli-ipc/*.md"],
        "format": ["cjs"]
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit --project libs/backend/cli-ipc/tsconfig.lib.json"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

**Estimated Lines**: ~25

##### 7. `libs/backend/cli-ipc/tsconfig.json` (CREATE)

**Purpose**: Root tsconfig for the library.
**Estimated Lines**: ~7

##### 8. `libs/backend/cli-ipc/tsconfig.lib.json` (CREATE)

**Purpose**: Library build tsconfig extending base.
**Pattern Source**: Other library tsconfig patterns.
**Estimated Lines**: ~15

---

### Component 2: Extension Integration (~200 lines in `ptah-extension-vscode`)

**Purpose**: Wire the IPC server into the extension activation lifecycle and forward broadcasts to IPC clients.

**Pattern**: Decorator pattern for WebviewManager + DI token registration.

**Evidence**:

- WebviewManager injected via `TOKENS.WEBVIEW_MANAGER` (tokens.ts:53)
- Container registration in `apps/ptah-extension-vscode/src/di/container.ts`
- Activation sequence in `apps/ptah-extension-vscode/src/main.ts`

#### Files

##### 9. `apps/ptah-extension-vscode/src/services/ipc/ipc-broadcast-adapter.ts` (CREATE)

**Purpose**: Wraps the real WebviewManager to intercept `broadcastMessage()` calls and forward them to IPC clients. Implements the same `WebviewManager` interface so it's a transparent drop-in.
**Key Exports**:

```typescript
/**
 * Decorates WebviewManager to forward broadcasts to IPC clients.
 * Registered as TOKENS.WEBVIEW_MANAGER, wrapping the real WebviewManager.
 *
 * broadcastMessage() calls: original WebviewManager + IPC server broadcast
 * sendMessage() calls: pass-through to original WebviewManager only
 * All other methods: delegated to original WebviewManager
 */
export class IpcBroadcastAdapter {
  constructor(private readonly realWebviewManager: WebviewManager, private readonly ipcServer: IpcServer | null, private readonly logger: Logger);

  // Delegates all WebviewManager methods to realWebviewManager
  // Overrides broadcastMessage to also call ipcServer.broadcast()
  async broadcastMessage(type: string, payload: unknown): Promise<void>;
  async sendMessage(viewType: string, type: string, payload: unknown): Promise<boolean>;
  // ... other WebviewManager methods delegated
}
```

**Dependencies**: `@ptah-extension/vscode-core` (WebviewManager type, Logger), `@ptah-extension/cli-ipc` (IpcServer)
**Estimated Lines**: ~80

**Implementation Notes**:

- `broadcastMessage()`: Calls `this.realWebviewManager.broadcastMessage(type, payload)` first (preserves existing webview behavior), then calls `this.ipcServer?.broadcast(type, payload)` asynchronously (fire-and-forget, errors logged).
- All other methods (`sendMessage`, `createWebviewPanel`, `registerWebviewView`, `getWebview`, etc.) delegate directly to `realWebviewManager`.
- If `ipcServer` is null (IPC startup failed), behaves identically to real WebviewManager.

##### 10. `apps/ptah-extension-vscode/src/services/ipc/index.ts` (CREATE)

**Purpose**: Barrel exports for IPC integration module.
**Estimated Lines**: ~3

##### 11. `apps/ptah-extension-vscode/src/main.ts` (MODIFY)

**Purpose**: Add IPC server startup step in activation sequence (between Step 5 and Step 8).
**Changes**:

```typescript
// After Step 5 (RPC methods registered), before Step 8 (session import):

// ========================================
// STEP 7.4: IPC SERVER START (TASK_2025_179)
// ========================================
// Start IPC server for CLI TUI connections (non-blocking)
console.log('[Activate] Step 7.4: Starting IPC server...');
try {
  const { IpcServer, getPipePath } = require('@ptah-extension/cli-ipc');
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (workspacePath) {
    const pipePath = getPipePath(workspacePath);
    const rpcHandler = DIContainer.resolve<RpcHandler>(TOKENS.RPC_HANDLER);

    const ipcServer = new IpcServer({
      pipePath,
      onRpcMessage: (msg) => rpcHandler.handleMessage(msg),
      logger,
    });

    await ipcServer.start();

    // Register in DI container for broadcast adapter
    DIContainer.getContainer().registerInstance(TOKENS.IPC_SERVER, ipcServer);

    // Replace WebviewManager with broadcast-forwarding adapter
    const realWebviewManager = DIContainer.resolve(TOKENS.WEBVIEW_MANAGER);
    const { IpcBroadcastAdapter } = require('./services/ipc/ipc-broadcast-adapter');
    const adapter = new IpcBroadcastAdapter(realWebviewManager, ipcServer, logger);
    DIContainer.getContainer().registerInstance(TOKENS.WEBVIEW_MANAGER, adapter);

    // Add to disposables
    context.subscriptions.push({ dispose: () => ipcServer.dispose() });

    logger.info(`IPC server started at ${pipePath}`);
  } else {
    logger.debug('IPC server skipped (no workspace folder)');
  }
} catch (ipcError) {
  // Non-blocking: extension works fine without IPC server
  logger.warn('IPC server startup failed (non-blocking)', {
    error: ipcError instanceof Error ? ipcError.message : String(ipcError),
  });
}
console.log('[Activate] Step 7.4: IPC server initialization complete');
```

**Estimated Lines**: ~40 added

##### 12. `libs/backend/vscode-core/src/di/tokens.ts` (MODIFY)

**Purpose**: Add `IPC_SERVER` token to the TOKENS namespace.
**Changes**:

```typescript
// Add after CLI_PLUGIN_SYNC_SERVICE section:

// ========================================
// IPC Server Token (TASK_2025_179)
// ========================================
export const IPC_SERVER = Symbol.for('IpcServer');

// Add to TOKENS object:
IPC_SERVER,
```

**Estimated Lines**: ~5 added

##### 13. `libs/backend/vscode-core/src/messaging/rpc-handler.ts` (MODIFY)

**Purpose**: Add `'ipc:'` to `ALLOWED_METHOD_PREFIXES` whitelist for IPC-specific methods (e.g., `ipc:ping`).
**Changes**:

```typescript
// Add to ALLOWED_METHOD_PREFIXES array (line ~66):
'ipc:', // TASK_2025_179: IPC health check methods
```

**Estimated Lines**: ~1 added

##### 14. `tsconfig.base.json` (MODIFY)

**Purpose**: Add path alias for the new cli-ipc library.
**Changes**:

```json
"@ptah-extension/cli-ipc": ["libs/backend/cli-ipc/src/index.ts"]
```

**Estimated Lines**: ~1 added

---

### Component 3: Ink TUI Application (`apps/ptah-cli`)

**Purpose**: Terminal user interface built with Ink (React for CLIs) that connects to the VS Code extension backend via IPC, providing chat, streaming, agent monitoring, and session management.

**Pattern**: React/Ink component architecture with custom hooks for state management. Separate Nx app project with its own build configuration. No Angular dependencies.

#### Files

##### 15. `apps/ptah-cli/src/index.tsx` (CREATE)

**Purpose**: Entry point with CLI argument parsing and Ink renderer initialization. Shebang for direct execution.
**Key Exports**: None (entry point)
**Dependencies**: `ink`, `meow` or `commander`, `react`, `./app`
**Estimated Lines**: ~40

**Implementation Notes**:

- `#!/usr/bin/env node` shebang
- Parse args: `--workspace <path>` (optional, defaults to `process.cwd()`)
- Compute pipe path via `getPipePath(workspacePath)`
- Render `<App pipePath={pipePath} workspacePath={workspacePath} />`
- Handle uncaught errors gracefully

##### 16. `apps/ptah-cli/src/app.tsx` (CREATE)

**Purpose**: Root `<App>` component that sets up IPC connection and routes to chat view. Manages top-level state and keyboard shortcuts.
**Key Exports**: `App` component
**Dependencies**: `react`, `ink`, `./hooks/use-ipc`, `./hooks/use-chat`, `./hooks/use-session`, `./hooks/use-status`, `./components/*`
**Estimated Lines**: ~100

**Implementation Notes**:

- Uses `useIpc(pipePath)` hook for connection lifecycle
- Renders `<ConnectionStatus>` when disconnected
- Renders `<ChatView>` + `<StatusBar>` when connected
- `Ctrl+L`: Toggle session list overlay
- `Ctrl+C`: Exit gracefully

##### 17. `apps/ptah-cli/src/hooks/use-ipc.ts` (CREATE)

**Purpose**: React hook managing IpcClient lifecycle, exposing `request()` and broadcast subscriptions.
**Key Exports**:

```typescript
interface UseIpcResult {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  request: (method: string, params?: unknown) => Promise<RpcResponse>;
  onBroadcast: (handler: BroadcastHandler) => () => void;
}

export function useIpc(pipePath: string): UseIpcResult;
```

**Dependencies**: `react`, `@ptah-extension/cli-ipc` (IpcClient, BroadcastHandler, RpcResponse)
**Estimated Lines**: ~80

**Implementation Notes**:

- Creates `IpcClient` in `useEffect`, connects on mount, disposes on unmount
- Tracks `connected`, `connecting`, `error` state
- `request()` delegates to `client.request()`
- `onBroadcast()` delegates to `client.onBroadcast()`
- Handles reconnection events (update `connected` state)

##### 18. `apps/ptah-cli/src/hooks/use-chat.ts` (CREATE)

**Purpose**: Chat state management -- message array, streaming state, send/continue/abort operations.
**Key Exports**:

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  agentCards?: AgentCardInfo[];
  isStreaming?: boolean;
}

interface ToolCallInfo {
  id: string;
  name: string;
  input: string;
  result?: string;
  status: 'running' | 'success' | 'error';
}

interface AgentCardInfo {
  id: string;
  agentType: string;
  description: string;
  status: 'running' | 'complete';
}

interface UseChatResult {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (text: string) => Promise<void>;
  abortStream: () => Promise<void>;
}

export function useChat(ipc: UseIpcResult): UseChatResult;
```

**Dependencies**: `react`, `./use-ipc` types, `@ptah-extension/cli-ipc` (RpcResponse)
**Estimated Lines**: ~150

**Implementation Notes**:

- Subscribes to `CHAT_CHUNK` broadcasts via `ipc.onBroadcast()`
- `sendMessage()`: Adds user message to array, calls `ipc.request('chat:start', { prompt, tabId })` for new conversations or `ipc.request('chat:continue', { prompt, sessionId })` for existing
- Processes `FlatStreamEventUnion` events from `CHAT_CHUNK` broadcasts:
  - `text_delta` -> append to current assistant message content
  - `tool_use_start` -> add tool call entry (status: running)
  - `tool_result` -> update tool call (status: success/error)
  - `agent_start` -> add agent card (status: running)
  - `message_complete` -> mark assistant message complete
- `abortStream()`: calls `ipc.request('chat:abort', { sessionId })`

##### 19. `apps/ptah-cli/src/hooks/use-session.ts` (CREATE)

**Purpose**: Session listing, selection, and history loading.
**Key Exports**:

```typescript
interface SessionSummary {
  id: string;
  name: string;
  createdAt: number;
  messageCount: number;
}

interface UseSessionResult {
  sessions: SessionSummary[];
  loading: boolean;
  currentSessionId: string | null;
  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<ChatMessage[]>;
}

export function useSession(ipc: UseIpcResult): UseSessionResult;
```

**Dependencies**: `react`, `./use-ipc` types
**Estimated Lines**: ~60

##### 20. `apps/ptah-cli/src/hooks/use-status.ts` (CREATE)

**Purpose**: Listens for `SESSION_STATS` broadcasts and computes display values for the status bar.
**Key Exports**:

```typescript
interface StatusInfo {
  tokens: { input: number; output: number };
  cost: number;
  duration: number;
  model: string;
  sessionId: string | null;
}

export function useStatus(ipc: UseIpcResult): StatusInfo;
```

**Dependencies**: `react`, `./use-ipc` types
**Estimated Lines**: ~50

##### 21. `apps/ptah-cli/src/components/chat-view.tsx` (CREATE)

**Purpose**: Main chat interface combining message list and input bar. Scrollable message area with auto-scroll on new content.
**Dependencies**: `react`, `ink`, `./message-bubble`, `./input-bar`, `./tool-call-item`, `./agent-card`
**Estimated Lines**: ~80

##### 22. `apps/ptah-cli/src/components/message-bubble.tsx` (CREATE)

**Purpose**: Single message display (user or assistant) with terminal markdown rendering. Handles streaming indicator.
**Dependencies**: `react`, `ink`, `../utils/markdown`
**Estimated Lines**: ~60

##### 23. `apps/ptah-cli/src/components/tool-call-item.tsx` (CREATE)

**Purpose**: Tool execution display with spinner (running), checkmark (success), or X (error). Shows tool name and truncated input/result.
**Dependencies**: `react`, `ink`, `ink-spinner`
**Estimated Lines**: ~50

##### 24. `apps/ptah-cli/src/components/agent-card.tsx` (CREATE)

**Purpose**: Agent status card showing agent type, description, and progress. Box-drawn border with colored header.
**Dependencies**: `react`, `ink`, `ink-spinner`
**Estimated Lines**: ~50

##### 25. `apps/ptah-cli/src/components/status-bar.tsx` (CREATE)

**Purpose**: Persistent bottom status bar showing token count, cost, model, duration. Adapts to terminal width.
**Dependencies**: `react`, `ink`
**Estimated Lines**: ~50

##### 26. `apps/ptah-cli/src/components/session-list.tsx` (CREATE)

**Purpose**: Session picker overlay triggered by Ctrl+L. Uses ink-select-input for session selection.
**Dependencies**: `react`, `ink`, `ink-select-input`
**Estimated Lines**: ~60

##### 27. `apps/ptah-cli/src/components/input-bar.tsx` (CREATE)

**Purpose**: Chat input with basic `/` command autocomplete support. Uses ink-text-input.
**Dependencies**: `react`, `ink`, `ink-text-input`
**Estimated Lines**: ~80

**Implementation Notes**:

- On `/` prefix, fetch completions via `ipc.request('autocomplete:getCompletions', { prefix })`
- On `@` prefix, fetch agent completions
- Display completions as a small overlay above input
- Enter submits, Escape cancels autocomplete

##### 28. `apps/ptah-cli/src/components/connection-status.tsx` (CREATE)

**Purpose**: Connection indicator showing "Connecting...", "Connected", or error state with retry info.
**Dependencies**: `react`, `ink`, `ink-spinner`
**Estimated Lines**: ~40

##### 29. `apps/ptah-cli/src/utils/markdown.ts` (CREATE)

**Purpose**: Terminal markdown rendering -- converts markdown to Ink-compatible styled text. Handles bold, code blocks, lists, inline code.
**Dependencies**: `ink` (for `<Text>` styling)
**Estimated Lines**: ~80

**Implementation Notes**:

- Parse markdown blocks: headers (#), bold (\*_), inline code (`), code fences (```), lists (- or _)
- Convert to Ink `<Text bold>`, `<Text color="green">` (code), `<Box>` (code blocks)
- Keep it simple -- no full CommonMark parser, just the common patterns

##### 30. `apps/ptah-cli/project.json` (CREATE)

**Purpose**: Nx project configuration for the CLI application.

```json
{
  "name": "ptah-cli",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/ptah-cli/src",
  "projectType": "application",
  "tags": ["scope:cli", "type:application"],
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/apps/ptah-cli",
        "main": "apps/ptah-cli/src/index.tsx",
        "tsConfig": "apps/ptah-cli/tsconfig.app.json",
        "format": ["cjs"],
        "platform": "node",
        "bundle": true,
        "external": []
      },
      "configurations": {
        "development": {
          "minify": false,
          "sourceMap": true
        },
        "production": {
          "minify": true,
          "sourceMap": false
        }
      }
    },
    "typecheck": {
      "executor": "nx:run-commands",
      "options": {
        "command": "tsc --noEmit --project apps/ptah-cli/tsconfig.app.json"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

**Estimated Lines**: ~35

##### 31. `apps/ptah-cli/tsconfig.json` (CREATE)

**Purpose**: Root tsconfig for the CLI app.
**Estimated Lines**: ~7

##### 32. `apps/ptah-cli/tsconfig.app.json` (CREATE)

**Purpose**: App build tsconfig with JSX support for Ink/React.
**Key Config**:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "module": "commonjs",
    "target": "es2020",
    "jsx": "react-jsx",
    "types": ["node"],
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

**Estimated Lines**: ~15

---

## Integration Architecture

### IPC Server Lifecycle

```
Extension Activation
  |
  v
Step 5: RPC methods registered (all 60+ handlers ready)
  |
  v
Step 7.4: IPC Server Start (NEW)
  1. Compute pipe path from workspace folder
  2. Create IpcServer with onRpcMessage -> rpcHandler.handleMessage()
  3. Register IpcServer in DI container (TOKENS.IPC_SERVER)
  4. Wrap WebviewManager with IpcBroadcastAdapter
  5. Re-register wrapped adapter as TOKENS.WEBVIEW_MANAGER
  6. Add IpcServer to context.subscriptions (auto-dispose)
  |
  v
Step 8+: Normal activation continues
```

### Broadcast Event Flow

```
SDK Event (e.g., streaming chunk)
  |
  v
RPC Handler (e.g., ChatRpcHandlers)
  |
  v
this.webviewManager.broadcastMessage('chat:chunk', payload)
  |  (now points to IpcBroadcastAdapter)
  |
  +----> realWebviewManager.broadcastMessage() --> Angular Webview
  |
  +----> ipcServer.broadcast('chat:chunk', payload) --> All IPC Clients
           |
           v
         IpcClient receives IpcBroadcastMessage
           |
           v
         useChat hook processes event -> React state update -> Ink re-render
```

### RPC Request Flow (CLI -> Extension)

```
User types message in CLI
  |
  v
useChat.sendMessage(text)
  |
  v
ipc.request('chat:start', { prompt, tabId })
  |
  v
IpcClient.request() --> encodeMessage --> named pipe --> IpcServer
  |
  v
IpcServer.onRpcMessage(msg)
  |
  v
rpcHandler.handleMessage(msg)  [SAME as webview RPC path]
  |
  v
ChatRpcHandlers.register() handler executes
  |
  v
RpcResponse returned --> IpcServer --> encodeMessage --> named pipe --> IpcClient
  |
  v
Promise<RpcResponse> resolves in useChat
```

### CLI Workspace Detection Flow

```
User runs: npx ptah-cli (or ./dist/apps/ptah-cli/index.js)
  |
  v
index.tsx: workspacePath = args.workspace || process.cwd()
  |
  v
getPipePath(workspacePath) --> '\\.\pipe\ptah-a1b2c3d4' (Windows)
                           --> '/tmp/ptah-a1b2c3d4.sock' (Unix)
  |
  v
IpcClient.connect(pipePath)
  |
  v
Success: Render chat UI
Failure: "Ptah extension not running. Open VS Code with a workspace first."
```

---

## Dependencies

### New NPM Dependencies

| Package            | Version | Purpose                     | Used By             |
| ------------------ | ------- | --------------------------- | ------------------- |
| `ink`              | ^5.0.0  | React renderer for terminal | apps/ptah-cli       |
| `ink-text-input`   | ^6.0.0  | Text input component        | apps/ptah-cli       |
| `ink-spinner`      | ^5.0.0  | Loading spinners            | apps/ptah-cli       |
| `ink-select-input` | ^6.0.0  | List selection              | apps/ptah-cli       |
| `react`            | ^18.3.0 | Required by Ink             | apps/ptah-cli       |
| `react-dom`        | ^18.3.0 | Required by Ink (peer dep)  | apps/ptah-cli       |
| `meow`             | ^13.0.0 | CLI argument parsing        | apps/ptah-cli       |
| `@types/react`     | ^18.3.0 | TypeScript types            | apps/ptah-cli (dev) |

### Internal Dependencies

| Consumer                | Depends On          | Import Path               |
| ----------------------- | ------------------- | ------------------------- |
| `cli-ipc`               | None (pure Node.js) | N/A                       |
| `ptah-extension-vscode` | `cli-ipc`           | `@ptah-extension/cli-ipc` |
| `ptah-cli`              | `cli-ipc`           | `@ptah-extension/cli-ipc` |

---

## Quality Requirements

### Functional Requirements

1. **IPC round-trip < 10ms p95** for non-streaming RPC calls
2. **Streaming text renders within 50ms** of receipt
3. **CLI startup to first render < 500ms**
4. **Extension activation regression < 50ms** (IPC server startup is fast -- just `net.createServer()` + `listen()`)
5. **100% RPC handler reuse** -- zero modifications to existing handler files
6. **Graceful degradation** -- if IPC server fails to start, extension operates normally without it

### Non-Functional Requirements

- **Security**: Unix sockets with mode 0600, Windows named pipes are user-scoped by default
- **Reliability**: Auto-reconnect with backoff, malformed message handling (log and skip, no crash)
- **Memory**: CLI process < 50MB RSS during normal operation
- **Compatibility**: Windows 10/11 (named pipes), macOS 14+ and Ubuntu 22+ (Unix sockets), Node.js 18+

### Pattern Compliance

- All DI tokens use `Symbol.for()` pattern (verified: `tokens.ts:9-30`)
- Library uses esbuild CJS format (verified: `agent-sdk/project.json:9`)
- RPC methods validated against whitelist (verified: `rpc-handler.ts:44-67`)
- Broadcast adapter preserves existing WebviewManager behavior (verified: `webview-manager.ts:317-345`)

---

## Phase Breakdown

### Phase 1: IPC Bridge Library (`libs/backend/cli-ipc`) -- Can Be Tested Independently

**Deliverables**:

- Files 1-8 (protocol, pipe-path, ipc-server, ipc-client, project config)
- Path alias in tsconfig.base.json (File 14)

**Verification**: Write a simple Node.js test script that starts IpcServer and connects with IpcClient, sends an RPC message, receives a response. Test on both Windows and Unix.

**Estimated Effort**: 4-6 hours

### Phase 2: Extension Integration -- Can Be Tested With Raw Pipe Client

**Deliverables**:

- Files 9-13 (broadcast adapter, main.ts changes, token addition, RPC prefix)

**Verification**:

1. Extension activates without error (IPC server starts)
2. Connect with `socat` or raw Node.js client to the named pipe
3. Send `{"type":"rpc","payload":{"method":"session:list","params":{},"correlationId":"test-1"}}` (length-prefixed)
4. Receive valid RPC response
5. Trigger a chat message in webview, verify broadcast arrives on pipe client

**Estimated Effort**: 3-4 hours

### Phase 3: Ink TUI Application (`apps/ptah-cli`) -- Full Feature Set

**Deliverables**:

- Files 15-32 (entry point, app, hooks, components, utils, project config)
- NPM dependency installation

**Sub-phases**:

1. **P3a**: Entry point + App shell + useIpc hook + ConnectionStatus (basic connection)
2. **P3b**: useChat hook + ChatView + MessageBubble + InputBar (basic chat flow)
3. **P3c**: ToolCallItem + AgentCard (tool/agent display during streaming)
4. **P3d**: useSession + SessionList (Ctrl+L session management)
5. **P3e**: useStatus + StatusBar (persistent bottom bar)
6. **P3f**: InputBar autocomplete (`/` and `@` commands)
7. **P3g**: Markdown rendering polish, terminal width adaptation

**Estimated Effort**: 12-16 hours

---

## Files Affected Summary

### CREATE (26 files)

**cli-ipc library (8 files)**:

- `libs/backend/cli-ipc/src/index.ts`
- `libs/backend/cli-ipc/src/lib/protocol.ts`
- `libs/backend/cli-ipc/src/lib/pipe-path.ts`
- `libs/backend/cli-ipc/src/lib/ipc-server.ts`
- `libs/backend/cli-ipc/src/lib/ipc-client.ts`
- `libs/backend/cli-ipc/project.json`
- `libs/backend/cli-ipc/tsconfig.json`
- `libs/backend/cli-ipc/tsconfig.lib.json`

**Extension integration (2 files)**:

- `apps/ptah-extension-vscode/src/services/ipc/ipc-broadcast-adapter.ts`
- `apps/ptah-extension-vscode/src/services/ipc/index.ts`

**CLI app (16 files)**:

- `apps/ptah-cli/src/index.tsx`
- `apps/ptah-cli/src/app.tsx`
- `apps/ptah-cli/src/hooks/use-ipc.ts`
- `apps/ptah-cli/src/hooks/use-chat.ts`
- `apps/ptah-cli/src/hooks/use-session.ts`
- `apps/ptah-cli/src/hooks/use-status.ts`
- `apps/ptah-cli/src/components/chat-view.tsx`
- `apps/ptah-cli/src/components/message-bubble.tsx`
- `apps/ptah-cli/src/components/tool-call-item.tsx`
- `apps/ptah-cli/src/components/agent-card.tsx`
- `apps/ptah-cli/src/components/status-bar.tsx`
- `apps/ptah-cli/src/components/session-list.tsx`
- `apps/ptah-cli/src/components/input-bar.tsx`
- `apps/ptah-cli/src/components/connection-status.tsx`
- `apps/ptah-cli/src/utils/markdown.ts`
- `apps/ptah-cli/project.json`
- `apps/ptah-cli/tsconfig.json`
- `apps/ptah-cli/tsconfig.app.json`

### MODIFY (4 files)

- `apps/ptah-extension-vscode/src/main.ts` -- Add IPC server startup step (~40 lines)
- `libs/backend/vscode-core/src/di/tokens.ts` -- Add IPC_SERVER token (~5 lines)
- `libs/backend/vscode-core/src/messaging/rpc-handler.ts` -- Add `'ipc:'` prefix (~1 line)
- `tsconfig.base.json` -- Add `@ptah-extension/cli-ipc` path alias (~1 line)

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **backend-developer** for Phases 1-2, **frontend-developer** for Phase 3

**Rationale**:

- Phase 1 (cli-ipc): Pure Node.js networking with `node:net`, buffer manipulation, protocol framing -- backend work
- Phase 2 (extension integration): DI container manipulation, decorator pattern, extension lifecycle -- backend work
- Phase 3 (ptah-cli): React/Ink components, hooks, state management, terminal rendering -- frontend work (React experience required)

**Alternative**: A single fullstack developer can handle all phases if they have both Node.js networking and React experience.

### Complexity Assessment

**Complexity**: HIGH
**Estimated Effort**: 19-26 hours total

**Breakdown**:

- Phase 1 (cli-ipc library): 4-6 hours
- Phase 2 (extension integration): 3-4 hours
- Phase 3 (Ink TUI app): 12-16 hours

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `RpcHandler` from `@ptah-extension/vscode-core` (verified: `src/index.ts:66`)
   - `TOKENS` from `@ptah-extension/vscode-core` (verified: `src/index.ts:6`)
   - `WebviewManager` from `@ptah-extension/vscode-core` (verified: `src/index.ts:43`)
   - `Logger` from `@ptah-extension/vscode-core` (verified: `src/index.ts:14`)
   - `RpcMessage`, `RpcResponse` types from `vscode-core/src/messaging/rpc-types.ts` (verified: lines 13, 26)

2. **RpcHandler.handleMessage() signature**:

   - Input: `RpcMessage { method, params, correlationId }` (verified: `rpc-handler.ts:219`)
   - Output: `Promise<RpcResponse>` (verified: `rpc-handler.ts:219`)

3. **WebviewManager.broadcastMessage() signature**:

   - Input: `(type: StrictMessageType, payload: any): Promise<void>` (verified: `webview-manager.ts:317`)

4. **DI container re-registration**:

   - tsyringe `registerInstance()` overwrites previous registration for same token
   - This is how the broadcast adapter replaces the real WebviewManager

5. **No hallucinated APIs**:
   - All `node:net` APIs are standard Node.js (createServer, createConnection)
   - All Ink APIs verified against ink@5 documentation
   - All RPC method names match existing patterns in rpc-handler.ts whitelist

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (DI tokens, RPC handler, broadcast pattern)
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (latency, memory, compatibility)
- [x] Integration points documented (RPC flow, broadcast flow, pipe path resolution)
- [x] Files affected list complete (26 CREATE, 4 MODIFY)
- [x] Developer type recommended (backend for P1-P2, frontend for P3)
- [x] Complexity assessed (HIGH, 19-26 hours)
- [x] Phase breakdown with independent verification steps
- [x] No step-by-step implementation (team-leader will decompose)
