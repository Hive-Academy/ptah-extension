# Task Context - TASK_2025_051

## User Intent

Migrate from CLI-based integration to Agent SDK only:

1. Wire SDK RPC handlers to replace CLI handlers
2. Remove `claude-domain` library dependency completely
3. Migrate UI session loading from `.claude` folder to SDK session management
4. Complete CLI removal

## Investigation Findings

### Current Session Loading Architecture

```
Frontend → RPC (session:list, session:load) → SessionDiscoveryService → ~/.claude/projects/*.jsonl
```

**Key Files**:

- `vscode-core/services/session-discovery.service.ts` - Reads from `.claude` folder
- `claude-domain/session/jsonl-session-parser.ts` - Parses JSONL format
- `vscode-core/messaging/rpc-method-registration.service.ts` - RPC handlers

### Current Backend Wiring

**ACTIVE (CLI-based)**:

- `chat:start` → ClaudeProcess (spawns CLI)
- `chat:continue` → ClaudeProcess
- `chat:abort` → kills CLI process
- `session:list` → SessionDiscoveryService (reads `.claude`)
- `session:load` → SessionDiscoveryService

**READY BUT NOT WIRED (SDK-based)**:

- `SdkAgentAdapter` - Ready with streaming input mode
- `SdkSessionStorage` - Has save/load but not wired to RPC
- `SdkRpcHandlers` - Methods exist but NOT registered

### Migration Requirements

1. **Replace Chat RPC Handlers**:

   - `chat:start` → `SdkAgentAdapter.startChatSession()`
   - `chat:continue` → `SdkAgentAdapter.sendMessageToSession()`
   - `chat:abort` → `SdkAgentAdapter.interruptSession()`

2. **Replace Session RPC Handlers**:

   - `session:list` → `SdkSessionStorage.listSessions()`
   - `session:load` → `SdkSessionStorage.getSession()`

3. **Remove Dependencies**:
   - `claude-domain` library (JSONL parsing, CLI process management)
   - `SessionDiscoveryService` (reads from `.claude`)
   - `ClaudeProcess` class

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-07
- Type: REFACTORING
- Complexity: Complex

## Execution Strategy

REFACTORING with full agent sequence
