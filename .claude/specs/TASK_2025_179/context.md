# TASK_2025_179: Ptah CLI TUI Application

## Task Type: FEATURE

## Complexity: Complex

## Workflow: Full (PM -> Architect -> Team-Leader -> Developers -> QA)

## User Request

Build a Ptah CLI TUI (Terminal User Interface) application using Ink (React) that connects to the existing VS Code extension backend via IPC (named pipes on Windows / Unix sockets on Linux/Mac). The CLI provides a beautiful terminal UI for interacting with Ptah's AI capabilities directly from VS Code's integrated terminal.

## Three Deliverables

1. **`libs/backend/cli-ipc`** — IPC Bridge Library

   - IPC server (extension side): named pipe server using `node:net`
   - IPC client (CLI side): connects to extension's pipe
   - Shared protocol: message framing, JSON-RPC format matching existing RPC

2. **Extension Integration** (~200 lines added to `ptah-extension-vscode`)

   - IPC server startup during extension activation
   - Routes IPC messages to existing RPC handlers (zero changes to handlers)

3. **`apps/ptah-cli`** — Ink TUI Application
   - Beautiful terminal UI components using Ink (React) + ink-ui
   - Chat view with streaming text, message bubbles, tool calls
   - Agent cards with status/progress
   - Session management (list, resume)
   - Status bar (tokens, cost, model)
   - Command input with autocomplete
   - All connected via IPC to extension's RPC backend

## Key Constraints

- Users work in VS Code or Cursor (VS Code-based IDEs)
- Minimize effort: reuse ALL existing RPC handlers, zero changes to backend
- Separate app (`apps/ptah-cli`) + wrapper library (`libs/backend/cli-ipc`)
- Ink (React) for terminal UI — Angular components cannot render in terminal
- IPC bridge pattern (like Claude Code's VS Code integration)

## Technical Context

- Existing RPC system: 15 domain handler classes in `apps/ptah-extension-vscode/src/services/rpc/handlers/`
- RPC types: `libs/shared/src/lib/types/rpc.types.ts`
- DI: tsyringe with TOKENS pattern
- Streaming: FlatStreamEventUnion events over RPC
- Windows: named pipes (`\\.\pipe\ptah-{workspaceId}`)
- Unix: socket files (`/tmp/ptah-{workspaceId}.sock`)

## Estimated Size

- cli-ipc library: ~300 lines
- Extension integration: ~200 lines
- Ink CLI app: ~1500-2000 lines (15-20 components + hooks)
- Total: ~2000-2500 lines of new code
