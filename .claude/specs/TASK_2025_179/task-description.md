# Requirements Document - TASK_2025_179: Ptah CLI TUI Application

## Introduction

Ptah currently provides a single user interface: an Angular webview embedded in the VS Code sidebar. While effective, this forces all interaction through a graphical panel that competes for screen real estate and requires mouse-driven navigation. Power users and terminal-native developers prefer staying in the terminal for AI interactions (similar to Claude Code, Aider, or GitHub Copilot CLI).

This task delivers a **terminal user interface (TUI)** for Ptah, built with Ink (React for CLIs), that connects to the already-running VS Code extension backend via IPC. The TUI reuses 100% of existing RPC handlers -- zero backend changes required. It is a new **consumption surface** for the same backend, not a standalone application.

**Business Value**: Expands Ptah's addressable user base to terminal-centric developers who avoid GUI panels; provides a differentiated feature vs. competitors that only offer webview UIs; enables future headless/CI usage patterns.

---

## Architecture Overview

```
VS Code Extension Host (Node.js)
+------------------------------------------+
| DI Container (tsyringe)                  |
| +--------------------------------------+ |
| | RpcHandler (existing)                | |
| |   19 domain handler classes          | |
| |   ~60 registered RPC methods         | |
| +--------------------------------------+ |
|          |                               |
|    [webview.postMessage]   [IPC Server]  |  <-- NEW
|          |                      |        |
+----------|----------------------|--------+
           v                      v
    Angular Webview         Ptah CLI TUI    <-- NEW
    (existing)              (Ink/React)
```

The IPC bridge uses `node:net` named pipes (Windows: `\\.\pipe\ptah-{workspaceId}`) or Unix domain sockets (`/tmp/ptah-{workspaceId}.sock`). Messages use the same JSON-RPC format as the existing webview RPC protocol (`RpcMessage` / `RpcResponse` from `libs/backend/vscode-core/src/messaging/rpc-types.ts`).

---

## Requirements

### Requirement 1: IPC Bridge Library (`libs/backend/cli-ipc`)

**User Story:** As a developer building the CLI TUI, I want a shared IPC transport library so that the extension can expose its RPC handlers over named pipes and the CLI can connect to them with zero knowledge of VS Code internals.

#### Acceptance Criteria

1. WHEN the extension activates THEN the IPC server SHALL create a named pipe at a deterministic path derived from the workspace folder hash (Windows: `\\.\pipe\ptah-{hash}`, Unix: `/tmp/ptah-{hash}.sock`).
2. WHEN a CLI client connects to the pipe THEN the server SHALL accept the connection and begin processing length-prefixed JSON-RPC messages.
3. WHEN the server receives a valid `RpcMessage` (with `method`, `params`, `correlationId`) THEN it SHALL route the message to `RpcHandler.handleMessage()` and return the `RpcResponse` over the same connection.
4. WHEN the extension pushes a broadcast message (e.g., `CHAT_CHUNK`, `SESSION_STATS`, `AGENT_MONITOR_*`) THEN the IPC server SHALL forward these events to all connected CLI clients as push notifications with a distinct message type (e.g., `{ type: 'broadcast', messageType: string, payload: unknown }`).
5. WHEN a client disconnects THEN the server SHALL clean up resources for that client without affecting other clients or the extension.
6. WHEN the extension deactivates THEN the IPC server SHALL close all connections and remove the pipe/socket file.
7. WHEN messages exceed the pipe buffer THEN the protocol SHALL use length-prefix framing (`4-byte BE length + JSON payload`) to handle message boundaries correctly.

#### Technical Specifications

- **Server** (`IpcServer`): Wraps `node:net.createServer()`, manages client connections, handles framing.
- **Client** (`IpcClient`): Wraps `node:net.createConnection()`, provides `request(method, params): Promise<RpcResponse>` and `onBroadcast(handler)` APIs.
- **Protocol**: Length-prefixed JSON. Each message is `[4-byte big-endian length][UTF-8 JSON payload]`. JSON payload matches existing `RpcMessage` / `RpcResponse` types.
- **Pipe Path Resolution**: Shared function `getPipePath(workspacePath: string): string` used by both server and client. Hash the workspace path (e.g., first 8 chars of SHA-256) for uniqueness.
- **Reconnection**: Client should support auto-reconnect with exponential backoff (3 retries, 1s/2s/4s).
- **Library exports**: `IpcServer`, `IpcClient`, `getPipePath`, protocol types.

#### Estimated Size

- ~300 lines across 4-5 files.

---

### Requirement 2: Extension Integration (~200 lines in `ptah-extension-vscode`)

**User Story:** As a Ptah user, I want the VS Code extension to automatically start an IPC server when I open a workspace so that I can connect the CLI TUI without any manual setup.

#### Acceptance Criteria

1. WHEN the extension activates (after license validation, Step 5 in `main.ts`) THEN it SHALL start the `IpcServer` from `cli-ipc` and bind it to the workspace-specific pipe path.
2. WHEN the IPC server receives an `RpcMessage` THEN the extension SHALL pass it directly to `RpcHandler.handleMessage()` and return the response -- reusing all 19 existing handler classes with zero modifications.
3. WHEN the extension broadcasts a message via `WebviewManager.broadcastMessage()` THEN it SHALL also forward the broadcast to all connected IPC clients. This requires a thin adapter that intercepts or wraps the broadcast path.
4. WHEN the extension deactivates THEN the IPC server SHALL be disposed (added to `context.subscriptions`).
5. WHEN no CLI client is connected THEN the IPC server SHALL have negligible resource overhead (idle `net.Server` listening on a pipe).

#### Technical Specifications

- Add IPC server startup as a new step in `main.ts` activation sequence (after RPC registration, before session import).
- The broadcast forwarding adapter should implement the same interface as `WebviewManager` or decorate it, so that `RpcMethodRegistrationService` broadcasts reach both webview and IPC clients.
- Register `ipc:` as an allowed method prefix in `RpcHandler` if needed for IPC-specific methods (e.g., `ipc:ping` for health checks).
- The IPC server instance should be registered in the DI container under a new `TOKENS.IPC_SERVER` token.

#### Estimated Size

- ~200 lines: IPC startup in `main.ts`, broadcast adapter, DI registration.

---

### Requirement 3: Ink TUI Application (`apps/ptah-cli`)

**User Story:** As a terminal-native developer, I want a beautiful terminal UI that connects to Ptah's backend so that I can chat with AI, view streaming responses, monitor agents, and manage sessions -- all without leaving my terminal.

#### Acceptance Criteria

**Connection & Lifecycle:**

1. WHEN the CLI starts THEN it SHALL auto-detect the workspace pipe path from the current working directory and connect via `IpcClient`.
2. WHEN the CLI cannot connect (extension not running) THEN it SHALL display a clear error message: "Ptah extension not running. Open VS Code with a workspace first."
3. WHEN the connection drops THEN the CLI SHALL attempt auto-reconnect and display a "Reconnecting..." status indicator.

**Chat View:** 4. WHEN the user types a message and presses Enter THEN the CLI SHALL send a `chat:start` or `chat:continue` RPC call and display the streaming response in real-time. 5. WHEN the backend sends `CHAT_CHUNK` broadcast events THEN the CLI SHALL render streaming text with markdown formatting (bold, code blocks, lists). 6. WHEN a tool call event arrives in the stream THEN the CLI SHALL display the tool name, input summary, and result with visual indicators (spinner while running, checkmark on success, X on failure). 7. WHEN an `agent_start` event arrives THEN the CLI SHALL display an agent card with agent type, description, and progress indicator.

**Session Management:** 8. WHEN the user presses a keyboard shortcut (e.g., Ctrl+L) THEN the CLI SHALL display a session list from `session:list` RPC and allow selection to resume. 9. WHEN the user selects a session THEN the CLI SHALL load session history via `session:getHistory` and display past messages.

**Status Bar:** 10. WHEN session stats arrive (`SESSION_STATS` broadcast) THEN the CLI SHALL update a persistent status bar showing: token count, cost, model name, session duration.

**Input:** 11. WHEN the user types `/` THEN the CLI SHALL show command autocomplete from `autocomplete:getCompletions`. 12. WHEN the user types `@` THEN the CLI SHALL show agent/file autocomplete.

**Rendering:** 13. WHEN rendering messages THEN the CLI SHALL use Ink components with proper terminal colors, box drawing, and responsive layout that adapts to terminal width. 14. WHEN the terminal is less than 80 columns THEN the CLI SHALL gracefully degrade (hide status bar details, truncate long lines).

#### Technical Specifications

**Framework**: Ink 5.x (React for terminals) with `ink-text-input`, `ink-spinner`, `ink-select-input`.

**Component Architecture** (Atomic Design):

```
apps/ptah-cli/
  src/
    index.tsx                    # Entry point, CLI arg parsing
    app.tsx                      # Root <App /> component
    hooks/
      use-ipc.ts                 # IPC connection hook (connect, request, onBroadcast)
      use-chat.ts                # Chat state management (messages, streaming)
      use-session.ts             # Session list/resume
      use-status.ts              # Status bar state (tokens, cost, model)
    components/
      chat-view.tsx              # Main chat interface (messages + input)
      message-bubble.tsx         # Single message (user/assistant with markdown)
      tool-call-item.tsx         # Tool execution display
      agent-card.tsx             # Agent status card
      status-bar.tsx             # Bottom status bar
      session-list.tsx           # Session picker overlay
      input-bar.tsx              # Chat input with autocomplete
      connection-status.tsx      # Connection indicator
    utils/
      markdown.ts                # Terminal markdown rendering
      pipe-path.ts               # Re-export from cli-ipc
```

**Key React Hooks:**

- `useIpc()`: Manages `IpcClient` lifecycle, exposes `request()` and broadcast event subscriptions.
- `useChat(ipc)`: Manages message array, streaming state, sends `chat:start`/`chat:continue`.
- `useSession(ipc)`: Session listing, selection, history loading.
- `useStatus(ipc)`: Listens for `SESSION_STATS` broadcasts, computes display values.

**Nx Integration:**

- New app project in `apps/ptah-cli/project.json`.
- Build target: esbuild to single CJS bundle.
- Binary entry: `#!/usr/bin/env node` shebang for direct execution.
- No Angular dependency -- pure React/Ink.

#### Estimated Size

- ~1500-2000 lines across 15-20 files.

---

## Non-Functional Requirements

### Performance Requirements

- **IPC Latency**: RPC round-trip via named pipe SHALL be under 10ms for non-streaming calls (p95).
- **Streaming Throughput**: CLI SHALL render streaming text chunks within 16ms of receipt (one frame at 60fps terminal refresh).
- **Startup Time**: CLI SHALL connect and render first frame within 500ms.
- **Memory**: CLI process SHALL use less than 50MB RSS during normal operation.

### Reliability Requirements

- **Connection Recovery**: CLI SHALL auto-reconnect within 5 seconds if the pipe connection drops.
- **Graceful Degradation**: If a broadcast event has an unknown type, the CLI SHALL ignore it (no crash).
- **Error Isolation**: A malformed IPC message SHALL NOT crash the extension's IPC server; log and skip.

### Security Requirements

- **Pipe Permissions**: On Unix, the socket file SHALL be created with mode 0600 (owner-only access).
- **No Remote Access**: IPC uses local pipes/sockets only. No TCP sockets exposed.
- **License Enforcement**: The IPC bridge routes through `RpcHandler`, which already enforces license validation. No additional license checks needed in the CLI.

### Compatibility Requirements

- **Windows**: Named pipes (`\\.\pipe\ptah-*`). Tested on Windows 10/11.
- **macOS/Linux**: Unix domain sockets (`/tmp/ptah-*.sock`). Tested on macOS 14+ and Ubuntu 22+.
- **Node.js**: Requires Node.js 18+ (same as VS Code extension runtime).
- **Terminal**: Supports any terminal emulator that supports ANSI escape codes (VS Code integrated terminal, iTerm2, Windows Terminal, Alacritty).

---

## Dependencies

### Existing Code Reused (Zero Modifications)

| Component                          | Location                                                | Usage                                          |
| ---------------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| `RpcHandler`                       | `libs/backend/vscode-core/src/messaging/rpc-handler.ts` | Routes IPC messages to handlers                |
| 19 RPC handler classes             | `apps/ptah-extension-vscode/src/services/rpc/handlers/` | All domain logic (chat, session, config, etc.) |
| `RpcMessage` / `RpcResponse` types | `libs/backend/vscode-core/src/messaging/rpc-types.ts`   | Wire protocol types                            |
| RPC param/result types             | `libs/shared/src/lib/types/rpc.types.ts`                | Type-safe method signatures                    |
| `FlatStreamEventUnion`             | `libs/shared/src/lib/types/execution-node.types.ts`     | Streaming event types                          |
| `MESSAGE_TYPES` constants          | `libs/shared/src/lib/types/message.types.ts`            | Broadcast message type identifiers             |

### New Code Required

| Component                 | Location                          | Estimated Lines |
| ------------------------- | --------------------------------- | --------------- |
| IPC Bridge Library        | `libs/backend/cli-ipc/`           | ~300            |
| Extension IPC integration | `apps/ptah-extension-vscode/src/` | ~200            |
| Ink TUI Application       | `apps/ptah-cli/`                  | ~1500-2000      |

### New NPM Dependencies

| Package               | Version | Purpose                     |
| --------------------- | ------- | --------------------------- |
| `ink`                 | ^5.0.0  | React renderer for terminal |
| `ink-text-input`      | ^6.0.0  | Text input component        |
| `ink-spinner`         | ^5.0.0  | Loading spinners            |
| `ink-select-input`    | ^6.0.0  | List selection              |
| `react`               | ^18.x   | Required by Ink             |
| `meow` or `commander` | latest  | CLI argument parsing        |

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder                | Impact | Involvement    | Success Criteria                                         |
| -------------------------- | ------ | -------------- | -------------------------------------------------------- |
| Terminal-native developers | High   | End users      | Can complete full chat workflow without touching webview |
| Extension maintainers      | High   | Implementation | IPC bridge adds no regression to webview flow            |
| Product team               | Medium | Requirements   | Feature differentiator for marketing                     |

### Secondary Stakeholders

| Stakeholder             | Impact | Involvement  | Success Criteria                                                  |
| ----------------------- | ------ | ------------ | ----------------------------------------------------------------- |
| CI/automation engineers | Low    | Future users | IPC protocol documented for future headless usage                 |
| QA team                 | Medium | Testing      | Both webview and CLI produce identical results for same RPC calls |

---

## Risk Assessment

| Risk                                                      | Probability | Impact   | Score | Mitigation                                                                                                      |
| --------------------------------------------------------- | ----------- | -------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| Named pipe path conflicts (multiple workspaces)           | Medium      | High     | 6     | Use SHA-256 hash of workspace path; include collision detection with error message                              |
| Broadcast forwarding adds latency to webview path         | Medium      | High     | 6     | Broadcast adapter fires IPC sends asynchronously (fire-and-forget); webview path unchanged                      |
| Ink rendering performance with large streaming output     | Medium      | Medium   | 4     | Implement virtual scrolling; batch rapid updates into 16ms frames; limit visible message history                |
| Windows named pipe permission issues                      | Low         | Medium   | 3     | Named pipes on Windows are user-scoped by default; document any antivirus considerations                        |
| React/Ink dependency conflicts with Angular webview build | Low         | High     | 4     | Separate Nx project with isolated `node_modules` via project-level `package.json` or Nx dependency isolation    |
| IPC server startup failure blocks extension activation    | Low         | Critical | 5     | Wrap IPC startup in try/catch; log warning but continue activation without IPC (graceful degradation)           |
| Stale socket files after crash                            | Medium      | Low      | 3     | On server startup, attempt to connect to existing socket; if connection refused, delete stale file and recreate |

---

## Out of Scope

The following are explicitly NOT part of this task:

1. **Standalone mode** -- The CLI requires a running VS Code extension. It does not embed its own AI provider or session storage.
2. **Settings/configuration UI** -- Users configure Ptah through the webview settings panel. The CLI does not replicate settings screens.
3. **Agent setup wizard** -- The setup wizard (Pro feature) remains webview-only.
4. **File editing/diff views** -- Terminal cannot render rich diffs. Tool call results show text summaries only.
5. **Image rendering** -- Inline images in chat are shown as `[Image: filename.png]` placeholders.
6. **Authentication flow** -- API key entry happens in VS Code settings, not in the CLI.
7. **npm publishing** -- The CLI is local-only (run from workspace). npm package distribution is a future task.
8. **Tests** -- Unit and integration tests will be a follow-up task after the initial implementation is validated.

---

## Success Metrics

| Metric                          | Target                      | Measurement                                     |
| ------------------------------- | --------------------------- | ----------------------------------------------- |
| RPC round-trip latency (IPC)    | < 10ms p95                  | Measure in IPC client hook                      |
| CLI startup to first render     | < 500ms                     | Timestamp in entry point                        |
| Streaming text render delay     | < 50ms from receipt         | Timestamp comparison                            |
| Extension activation regression | < 50ms added                | Compare activation time with/without IPC server |
| Code reuse ratio                | 100% of RPC handlers reused | No modifications to existing handler files      |
| New code volume                 | < 2500 lines total          | Line count across 3 deliverables                |

---

## Implementation Order (Suggested)

1. **Phase 1**: `libs/backend/cli-ipc` -- IPC bridge library (server, client, protocol, pipe path resolution)
2. **Phase 2**: Extension integration -- IPC server startup in `main.ts`, broadcast adapter, DI wiring
3. **Phase 3**: `apps/ptah-cli` -- Ink TUI application (start with connection + basic chat, then add session management, status bar, autocomplete)

Phases 1 and 2 can be validated independently by sending raw JSON-RPC over the pipe (e.g., with `socat` or a Node.js test script) before Phase 3 begins.
