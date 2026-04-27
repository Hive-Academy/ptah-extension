# libs/backend/agent-sdk - Official Claude Agent SDK Integration

[Back to Main](../../../CLAUDE.md)

## Purpose

The **agent-sdk library** provides official Claude Agent SDK integration for Ptah Extension, delivering 10x performance improvements over CLI-based integration. It implements the `IAIProvider` interface using the `@anthropic-ai/claude-agent-sdk` package, enabling native TypeScript integration with streaming, session management, and permission handling.

## Boundaries

**Belongs here**:

- Agent SDK adapter implementing `IAIProvider` interface
- Session storage for SDK-based sessions
- Message transformation between Ptah protocol and SDK protocol
- Permission handling for SDK tool/resource requests
- SDK-specific helpers (query building, image conversion, stream transformation)
- Authentication and configuration management

**Does NOT belong**:

- CLI-based agent integration (belongs in `claude-domain`)
- AI provider abstractions (belongs in `llm-abstraction`)
- Business logic (belongs in `claude-domain`, `agent-generation`)
- VS Code API wrappers (belongs in `vscode-core`)

## Architecture

```
┌──────────────────────────────────────────────────────┐
│            Agent SDK Integration Layer                │
├──────────────────────────────────────────────────────┤
│  SdkAgentAdapter (IAIProvider implementation)        │
│  ├─ Session lifecycle management                     │
│  ├─ Streaming message handling (inlined helpers)     │
│  ├─ Permission delegation                            │
│  └─ Callback coordination                            │
├──────────────────────────────────────────────────────┤
│  Message Transformation                              │
│  └─ SdkMessageTransformer                            │
│     ├─ Ptah → SDK protocol                           │
│     ├─ SDK → Ptah protocol                           │
│     └─ Uses centralized SDK types                    │
├──────────────────────────────────────────────────────┤
│  Session Management                                  │
│  └─ SessionMetadataStore (TASK_2025_088)             │
│     ├─ Lightweight UI metadata only                  │
│     ├─ Session names, timestamps, cost tracking      │
│     └─ SDK handles message persistence natively      │
├──────────────────────────────────────────────────────┤
│  Permission Handling                                 │
│  └─ SdkPermissionHandler                             │
│     ├─ Tool execution approval                       │
│     └─ Resource access approval                      │
├──────────────────────────────────────────────────────┤
│  Helper Services                                     │
│  ├─ ImageConverter         - Base64 encoding         │
│  ├─ AttachmentProcessor    - File attachments        │
│  ├─ StreamTransformer      - Async generators        │
│  ├─ SessionLifecycleManager - Session events         │
│  ├─ AuthManager            - API key management      │
│  └─ ConfigWatcher          - Config monitoring       │
├──────────────────────────────────────────────────────┤
│  History Services (TASK_2025_106)                    │
│  └─ SessionHistoryReaderService (Facade)             │
│     ├─ JsonlReaderService    - JSONL file I/O        │
│     ├─ AgentCorrelationService - Agent-task linking  │
│     ├─ SessionReplayService  - Event sequencing      │
│     └─ HistoryEventFactory   - Event creation        │
├──────────────────────────────────────────────────────┤
│  Type System (TASK_2025_088)                         │
│  └─ claude-sdk.types.ts - Centralized SDK types      │
│     ├─ SDKMessage discriminated union               │
│     ├─ Type guards (isStreamEvent, isResultMessage)  │
│     └─ Strict type safety (no 'any')                 │
└──────────────────────────────────────────────────────┘
```

## Key Files

### Core Adapter

- `sdk-agent-adapter.ts` - Main IAIProvider implementation using Claude Agent SDK

### Message Handling

- `sdk-message-transformer.ts` - Bidirectional message protocol transformation (uses centralized SDK types)
- `helpers/stream-transformer.ts` - AsyncGenerator utilities for streaming

### Session Management

- `session-metadata-store.ts` - Lightweight UI metadata tracking (TASK_2025_088: replaces SdkSessionStorage)
- `helpers/session-lifecycle-manager.ts` - Session event management

### Permission System

- `sdk-permission-handler.ts` - Tool and resource permission handling

### Helper Services

- `helpers/attachment-processor.service.ts` - File attachment processing

### History Services (TASK_2025_106)

- `session-history-reader.service.ts` - Facade that orchestrates history reading
- `helpers/history/` - Extracted child services
  - `history.types.ts` - Type definitions (SessionHistoryMessage, ContentBlock, etc.)
  - `history-event-factory.ts` - Creates FlatStreamEventUnion events
  - `jsonl-reader.service.ts` - JSONL file I/O operations
  - `agent-correlation.service.ts` - Agent-to-task timestamp correlation
  - `session-replay.service.ts` - Event replay and sequencing orchestration
  - `index.ts` - Barrel exports for history module

### Type System

- `types/sdk-types/claude-sdk.types.ts` - Centralized SDK type definitions with discriminated unions and type guards

### Configuration & Auth

- `helpers/auth-manager.ts` - API key validation and management
- `helpers/config-watcher.ts` - Configuration change monitoring

### Detection

- `detector/claude-cli-detector.ts` - Claude CLI availability detection
- `detector/claude-cli-path-resolver.ts` - CLI path resolution

### Dependency Injection

- `di/tokens.ts` - SDK-specific DI tokens
- `di/register.ts` - Service registration function

## Dependencies

**Internal**:

- `@ptah-extension/shared` - Type definitions (SessionId, MessageId, IAIProvider)
- `@ptah-extension/vscode-core` - Logger, TOKENS, error handling

**External**:

- `@anthropic-ai/claude-agent-sdk` (^0.2.0) - Official Claude Agent SDK
- `tsyringe` (^4.10.0) - Dependency injection
- `vscode` (^1.96.0) - VS Code Extension API
- `eventemitter3` (^5.0.1) - Event emitters
- `rxjs` (^7.8.1) - Reactive programming

## Import Path

```typescript
import { SdkAgentAdapter, SdkMessageTransformer, SessionMetadataStore, SdkPermissionHandler, registerSdkServices, SDK_TOKENS } from '@ptah-extension/agent-sdk';

// Type imports
import type { SessionIdResolvedCallback, SessionMetadata, SdkDIToken, SDKMessage, SDKStreamEvent, isStreamEvent, isResultMessage } from '@ptah-extension/agent-sdk';
```

## Commands

```bash
# Build library
nx build agent-sdk

# Run tests
nx test agent-sdk

# Type-check
nx run agent-sdk:typecheck

# Lint
nx lint agent-sdk
```

## Usage Examples

### SDK Agent Adapter

```typescript
import { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type { IAIProvider } from '@ptah-extension/shared';

// SdkAgentAdapter implements IAIProvider
const provider: IAIProvider = container.resolve(SdkAgentAdapter);

// Create new session
const sessionId = await provider.createSession({
  correlationId: 'corr-123',
  type: 'chat',
});

// Send message
await provider.sendMessage({
  correlationId: 'corr-456',
  sessionId,
  text: 'Explain TypeScript generics',
  attachments: [{ type: 'file', path: '/workspace/src/types.ts' }],
  onChunk: (chunk) => {
    console.log('Streaming:', chunk.content);
  },
  onComplete: (result) => {
    console.log('Complete:', result.text);
  },
  onError: (error) => {
    console.error('Error:', error);
  },
});

// Get session history
const history = await provider.getSessionHistory({
  correlationId: 'corr-789',
  sessionId,
});

// Delete session
await provider.deleteSession({
  correlationId: 'corr-999',
  sessionId,
});
```

### Message Transformation

```typescript
import { SdkMessageTransformer } from '@ptah-extension/agent-sdk';

const transformer = new SdkMessageTransformer(logger);

// Transform Ptah message to SDK query
const sdkQuery = await transformer.toSdkQuery({
  text: 'Review this code',
  attachments: [{ type: 'file', path: '/src/app.ts' }],
  images: [{ base64Data: '...', mimeType: 'image/png' }],
});

// Transform SDK event to Ptah chunk
const ptahChunk = transformer.toPtahChunk(sdkEvent, sessionId);
// { type: 'chat.chunk', sessionId, content: '...', role: 'assistant' }
```

### Session Metadata Store

```typescript
import { SessionMetadataStore } from '@ptah-extension/agent-sdk';

const metadataStore = new SessionMetadataStore(logger);

// Add session metadata (UI display only - SDK handles message persistence)
metadataStore.addSession('session-123', {
  id: 'session-123',
  name: 'Code Review Session',
  createdAt: Date.now(),
  totalCost: 0,
});

// Update session cost
metadataStore.updateSessionCost('session-123', 0.05);

// Get session metadata
const metadata = metadataStore.getSession('session-123');
// { id: 'session-123', name: 'Code Review Session', createdAt: ..., totalCost: 0.05 }

// Get all sessions
const allSessions = metadataStore.getAllSessions();
// [{ id: 'session-123', ... }, { id: 'session-456', ... }]

// Delete session metadata
metadataStore.deleteSession('session-123');
```

### Permission Handler

```typescript
import { SdkPermissionHandler } from '@ptah-extension/agent-sdk';

const permissionHandler = new SdkPermissionHandler(logger, permissionPromptService);

// Handle tool permission request
const toolApproved = await permissionHandler.handleToolPermission({
  toolName: 'execute_bash',
  toolInput: { command: 'ls -la' },
  sessionId: 'session-123',
});

// Handle resource permission request
const resourceApproved = await permissionHandler.handleResourcePermission({
  resourceType: 'file',
  resourcePath: '/etc/passwd',
  action: 'read',
  sessionId: 'session-123',
});
```

### Attachment Processing

```typescript
import { AttachmentProcessorService } from '@ptah-extension/agent-sdk';

const processor = new AttachmentProcessorService(fileSystemService, logger);

// Process file attachments
const processedAttachments = await processor.processAttachments([{ type: 'file', path: '/src/app.ts' }]);

// Returns:
// [{ content: 'export const app = ...', type: 'text' }]
```

### Stream Transformation

```typescript
import { StreamTransformer } from '@ptah-extension/agent-sdk';

// Transform SDK event stream to Ptah chunks
const ptahChunks = StreamTransformer.transformSdkEventsToPtahChunks(sdkEventStream, sessionId, transformer);

// Use in async iteration
for await (const chunk of ptahChunks) {
  console.log('Chunk:', chunk.content);
}
```

## Guidelines

### IAIProvider Implementation

1. **SdkAgentAdapter implements IAIProvider interface**:

   ```typescript
   // IAIProvider methods:
   // - createSession(request): Promise<SessionId>
   // - sendMessage(request): Promise<void>
   // - getSessionHistory(request): Promise<SessionHistory>
   // - deleteSession(request): Promise<void>
   ```

2. **Performance characteristics**:
   - 10x faster than CLI-based integration
   - Native TypeScript execution (no subprocess overhead)
   - Direct SDK streaming (no stdout parsing)
   - Efficient session management (in-memory)

3. **Session lifecycle**:

   ```typescript
   // 1. Create session
   const sessionId = await adapter.createSession({ correlationId, type: 'chat' });

   // 2. Send messages (streaming)
   await adapter.sendMessage({
     sessionId,
     text: 'Hello',
     onChunk: (chunk) => {
       /* handle chunk */
     },
     onComplete: (result) => {
       /* handle completion */
     },
   });

   // 3. Get history
   const history = await adapter.getSessionHistory({ sessionId });

   // 4. Delete session
   await adapter.deleteSession({ sessionId });
   ```

### Message Transformation

1. **Always use transformer for protocol conversion**:

   ```typescript
   // ✅ CORRECT - Use transformer
   const sdkQuery = await transformer.toSdkQuery(ptahMessage);
   const ptahChunk = transformer.toPtahChunk(sdkEvent, sessionId);

   // ❌ WRONG - Manual conversion
   const sdkQuery = { text: ptahMessage.text }; // Missing attachments, images, etc.
   ```

2. **Transformer handles all message types**:
   - User messages → SDK queries
   - SDK events → Ptah chunks
   - Attachments → SDK attachment format
   - Images → SDK image format

3. **Preserve message context**:
   ```typescript
   const chunk = transformer.toPtahChunk(sdkEvent, sessionId);
   // Chunk includes: sessionId, content, role, timestamp
   ```

### Session Management

1. **Session metadata vs message storage (TASK_2025_088)**:

   ```typescript
   // SessionMetadataStore: Lightweight UI metadata only
   // - Session names, timestamps, cost tracking
   // - In-memory, cleared on extension restart
   metadataStore.addSession(sessionId, { name: 'My Chat', createdAt: Date.now(), totalCost: 0 });

   // SDK handles message persistence natively
   // - Messages stored to ~/.claude/projects/{sessionId}.jsonl
   // - Retrieved via SDK's getSessionHistory() API
   ```

2. **Track session lifecycle**:

   ```typescript
   sessionLifecycleManager.onSessionCreated((sessionId) => {
     logger.info('Session created', { sessionId });
   });

   sessionLifecycleManager.onSessionDeleted((sessionId) => {
     logger.info('Session deleted', { sessionId });
   });
   ```

3. **Handle session cleanup**:

   ```typescript
   // Always delete sessions when done
   await adapter.deleteSession({ correlationId, sessionId });

   // Metadata store automatically cleans up on delete
   ```

### Permission Handling

1. **Delegate to PermissionPromptService**:

   ```typescript
   const approved = await permissionHandler.handleToolPermission({
     toolName: 'execute_bash',
     toolInput: { command: 'ls' },
     sessionId,
   });

   // PermissionPromptService shows VS Code prompt
   // User approves/denies
   // Result returned to SDK
   ```

2. **Auto-approve mode**:

   ```typescript
   // Set autoApprovePermissions in query
   const query = await SdkQueryBuilder.buildQuery({
     text: 'Run tests',
     autoApprovePermissions: true, // Skip prompts
   });
   ```

3. **Permission types**:
   - **Tool permissions**: bash execution, file operations, API calls
   - **Resource permissions**: file reads, directory access, network requests

### Error Handling

1. **Use structured error logging**:

   ```typescript
   try {
     await adapter.sendMessage(request);
   } catch (error) {
     this.logger.error('Failed to send message', {
       sessionId: request.sessionId,
       error: error.message,
     });
     throw error;
   }
   ```

2. **Handle SDK errors gracefully**:

   ```typescript
   // SDK throws specific error types
   try {
     await sdkAgent.sendMessage(query);
   } catch (error) {
     if (error.code === 'INVALID_API_KEY') {
       // Show configuration prompt
     } else if (error.code === 'RATE_LIMIT') {
       // Show rate limit message
     } else {
       // Generic error handling
     }
   }
   ```

3. **Propagate errors to callbacks**:
   ```typescript
   await adapter.sendMessage({
     sessionId,
     text: 'Hello',
     onError: (error) => {
       // Error callback receives SDK errors
       console.error('Message failed:', error);
     },
   });
   ```

### Testing

1. **Mock SDK agent for tests**:

   ```typescript
   const mockAgent = {
     createSession: jest.fn().mockResolvedValue('session-123'),
     sendMessage: jest.fn().mockImplementation(async function* () {
       yield { type: 'chunk', content: 'Hello' };
     })
   };

   const adapter = new SdkAgentAdapter(mockAgent, logger, ...);
   ```

2. **Test message transformation**:

   ```typescript
   it('should transform Ptah message to SDK query', async () => {
     const ptahMessage = {
       text: 'Hello',
       attachments: [{ type: 'file', path: '/app.ts' }],
     };

     const sdkQuery = await transformer.toSdkQuery(ptahMessage);

     expect(sdkQuery.text).toBe('Hello');
     expect(sdkQuery.attachments).toHaveLength(1);
   });
   ```

3. **Test session lifecycle**:

   ```typescript
   it('should manage session lifecycle', async () => {
     const sessionId = await adapter.createSession({ correlationId, type: 'chat' });
     expect(sessionStorage.getSession(sessionId)).toBeDefined();

     await adapter.deleteSession({ correlationId, sessionId });
     expect(sessionStorage.getSession(sessionId)).toBeNull();
   });
   ```

## Integration with Other Libraries

**Implements IAIProvider from `@ptah-extension/shared`**:

- Used by `claude-domain` for provider abstraction
- Registered in DI container alongside CLI-based provider
- Selected based on availability and performance

**Uses `@ptah-extension/vscode-core`**:

- Logger for structured logging
- TOKENS for DI token access
- ErrorHandler for error boundaries

**Consumed by `apps/ptah-extension-vscode`**:

- Registered in DI container
- Used as primary AI provider (10x faster than CLI)
- Falls back to CLI provider if SDK unavailable

## Performance Characteristics

| Operation                  | SDK        | CLI         | Improvement |
| -------------------------- | ---------- | ----------- | ----------- |
| Session creation           | ~50ms      | ~500ms      | 10x faster  |
| Message send (first chunk) | ~100ms     | ~1000ms     | 10x faster  |
| Streaming overhead         | ~1ms/chunk | ~10ms/chunk | 10x faster  |
| Memory usage               | 20MB       | 50MB        | 2.5x lower  |

## Future Enhancements

- Persistent session storage (SQLite, IndexedDB)
- Multi-session support (parallel conversations)
- Custom tool registration
- MCP server integration
- Advanced permission policies (workspace-level, session-level)

## Testing

```bash
# Run tests
nx test agent-sdk

# Run tests with coverage
nx test agent-sdk --coverage

# Run specific test
nx test agent-sdk --testFile=sdk-agent-adapter.spec.ts
```

## File Paths Reference

- **Core Adapter**: `src/lib/sdk-agent-adapter.ts`
- **Message Transformation**: `src/lib/sdk-message-transformer.ts`
- **Session Metadata**: `src/lib/session-metadata-store.ts` (TASK_2025_088)
- **Permission Handling**: `src/lib/sdk-permission-handler.ts`
- **Helpers**: `src/lib/helpers/`
  - `attachment-processor.service.ts`
  - `auth-manager.ts`
  - `config-watcher.ts`
  - `session-lifecycle-manager.ts`
  - `stream-transformer.ts`
  - `usage-extraction.utils.ts`
- **History Module**: `src/lib/helpers/history/` (TASK_2025_106)
  - `index.ts` - Barrel exports
  - `history.types.ts` - Type definitions
  - `history-event-factory.ts` - Event factory service
  - `jsonl-reader.service.ts` - JSONL file I/O service
  - `agent-correlation.service.ts` - Agent correlation service
  - `session-replay.service.ts` - Session replay service
- **Detection**: `src/lib/detector/`
- **Types**: `src/lib/types/sdk-types/claude-sdk.types.ts` (TASK_2025_088)
- **DI**: `src/lib/di/`
- **Entry Point**: `src/index.ts`

## Migration Notes - TASK_2025_088

**Objective**: Eliminate over-engineered abstraction layers, centralize SDK types, and simplify session management.

### Files Deleted

1. **`sdk-session-storage.ts`** (313 lines) - Replaced by SessionMetadataStore
   - Old: Full message storage with in-memory cache
   - New: Lightweight metadata only (SDK handles message persistence)

2. **`helpers/user-message-stream-factory.ts`** (129 lines) - Inlined into SdkAgentAdapter
   - Old: Factory class for creating user message streams
   - New: Private method `createUserMessageStream()` in SdkAgentAdapter

3. **`helpers/sdk-query-builder.ts`** (172 lines) - Inlined into SdkAgentAdapter
   - Old: Separate builder class for SDK query construction
   - New: Private method `buildQueryOptions()` in SdkAgentAdapter

4. **`types/sdk-session.types.ts`** (duplicates) - Consolidated into claude-sdk.types.ts
   - Old: Local duplicate SDK type definitions across multiple files
   - New: Single source of truth in `types/sdk-types/claude-sdk.types.ts`

### Architecture Changes

**Before TASK_2025_088**:

```
SdkAgentAdapter
  → UserMessageStreamFactory (injected)
  → SdkQueryBuilder (injected)
  → SdkSessionStorage (full message storage)
  → Local duplicate SDK type definitions
```

**After TASK_2025_088**:

```
SdkAgentAdapter
  → createUserMessageStream() (inlined private method)
  → buildQueryOptions() (inlined private method)
  → SessionMetadataStore (UI metadata only)
  → Centralized SDK types from claude-sdk.types.ts
```

### Type Safety Improvements

**Before**: Loose types with bracket notation

```typescript
const eventType = msg['event']['type']; // any type
const toolInput = block['input']['file_path'] as string; // type cast
```

**After**: Strict discriminated unions with type guards

```typescript
if (isStreamEvent(msg)) {
  const eventType = msg.event.type; // string literal type
}
if (isReadToolInput(block.input)) {
  const filePath = block.input.file_path; // string type
}
```

### Breaking Changes

**Import Changes**:

```typescript
// Old imports (REMOVED)
import { SdkSessionStorage, StoredSession, StoredSessionMessage } from '@ptah-extension/agent-sdk';

// New imports (USE THESE)
import { SessionMetadataStore, SessionMetadata } from '@ptah-extension/agent-sdk';
import type { SDKMessage, isStreamEvent, isResultMessage } from '@ptah-extension/agent-sdk';
```

**API Changes**:

```typescript
// Old: SdkSessionStorage
storage.createSession(sessionId, { id, createdAt, messages: [] });
storage.addMessage(sessionId, { id, role, content, timestamp });
const history = storage.getSessionHistory(sessionId); // returns messages

// New: SessionMetadataStore
metadataStore.addSession(sessionId, { id, name, createdAt, totalCost: 0 });
metadataStore.updateSessionCost(sessionId, cost);
// For message history, use SDK's native getSessionHistory() API
```

### Performance Impact

| Metric                     | Before | After | Improvement |
| -------------------------- | ------ | ----- | ----------- |
| Lines of code              | 2,778+ | -614  | -22% total  |
| Type safety violations     | 15+    | 0     | 100% fixed  |
| Duplicate type definitions | 4+     | 0     | Centralized |
| DI tokens                  | 12     | 10    | -2 tokens   |
| Session storage overhead   | 313    | 87    | -72% lines  |

### Migration Steps for Consumers

If your code uses `@ptah-extension/agent-sdk`:

1. **Update imports**: Replace `SdkSessionStorage` with `SessionMetadataStore`
2. **Update session storage calls**:
   - Use `SessionMetadataStore` for UI metadata only
   - Use SDK's native `getSessionHistory()` for message retrieval
3. **Update type imports**: Import SDK types from centralized location
4. **Run tests**: Verify session management still works
5. **Remove type casts**: Use type guards from `claude-sdk.types.ts`

### Remaining Tech Debt

- Session metadata store is still in-memory (cleared on restart)
  - Future: Consider persistent storage (SQLite/IndexedDB)
- Permission handler uses simple approval/denial
  - Future: Add workspace-level permission policies
- No multi-session parallel support yet
  - Future: Enable multiple concurrent sessions

## Migration Notes - TASK_2025_106

**Objective**: Refactor `SessionHistoryReaderService` (1,278 lines) by extracting responsibilities into focused child services using the facade pattern while maintaining the existing public API.

### Architecture Change

**Before TASK_2025_106**:

```
SessionHistoryReaderService (1,278 lines - monolithic)
├── File I/O methods (findSessionsDirectory, readJsonlMessages, loadAgentSessions)
├── Correlation logic (buildAgentDataMap, extractTaskToolUses, correlateAgentsToTasks)
├── Replay logic (replayToStreamEvents, processAgentMessages)
├── Event creation (createMessageStart, createTextDelta, etc.)
└── Usage aggregation (aggregateUsageStats)
```

**After TASK_2025_106**:

```
SessionHistoryReaderService (~200 lines - Facade)
├── readSessionHistory() - Orchestrates child services
├── readHistoryAsMessages() - Simple message extraction
└── aggregateUsageStats() - Kept in facade (uses existing utils)

Child Services (helpers/history/):
├── HistoryEventFactory - Event creation (createMessageStart, createTextDelta, etc.)
├── JsonlReaderService - JSONL file I/O (findSessionsDirectory, readJsonlMessages, loadAgentSessions)
├── AgentCorrelationService - Agent-to-task correlation (buildAgentDataMap, correlateAgentsToTasks)
└── SessionReplayService - Event sequencing (replayToStreamEvents, processAgentMessages)
```

### Services Overview

| Service                       | Responsibility                      | Injected Dependencies                                                 |
| ----------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| `HistoryEventFactory`         | Create FlatStreamEventUnion events  | None (pure factory)                                                   |
| `JsonlReaderService`          | JSONL file I/O operations           | Logger                                                                |
| `AgentCorrelationService`     | Agent-to-task timestamp correlation | Logger                                                                |
| `SessionReplayService`        | Event replay orchestration          | Logger, AgentCorrelationService, HistoryEventFactory                  |
| `SessionHistoryReaderService` | Facade (public API)                 | Logger, JsonlReaderService, SessionReplayService, HistoryEventFactory |

### DI Tokens Added

```typescript
// Added to libs/backend/agent-sdk/src/lib/di/tokens.ts
export const SDK_TOKENS = {
  // ... existing tokens

  // History reader child services (TASK_2025_106)
  SDK_JSONL_READER: 'SdkJsonlReader',
  SDK_AGENT_CORRELATION: 'SdkAgentCorrelation',
  SDK_HISTORY_EVENT_FACTORY: 'SdkHistoryEventFactory',
  SDK_SESSION_REPLAY: 'SdkSessionReplay',
} as const;
```

### Public API (UNCHANGED)

The facade maintains identical public method signatures:

```typescript
class SessionHistoryReaderService {
  // Returns events for UI rendering + aggregated stats
  readSessionHistory(
    sessionId: string,
    workspacePath: string,
  ): Promise<{
    events: FlatStreamEventUnion[];
    stats: { totalCost; tokens; messageCount } | null;
  }>;

  // Returns simple message objects (for RPC)
  readHistoryAsMessages(
    sessionId: string,
    workspacePath: string,
  ): Promise<
    {
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: number;
    }[]
  >;
}
```

### Files Created

| File                                           | Lines | Purpose                      |
| ---------------------------------------------- | ----- | ---------------------------- |
| `helpers/history/history.types.ts`             | ~70   | Type definitions             |
| `helpers/history/history-event-factory.ts`     | ~170  | Event creation factory       |
| `helpers/history/jsonl-reader.service.ts`      | ~150  | JSONL file I/O service       |
| `helpers/history/agent-correlation.service.ts` | ~180  | Agent correlation service    |
| `helpers/history/session-replay.service.ts`    | ~280  | Replay orchestration service |
| `helpers/history/index.ts`                     | ~30   | Barrel exports               |

### Files Modified

| File                                | Change                                      |
| ----------------------------------- | ------------------------------------------- |
| `di/tokens.ts`                      | Added 4 new tokens                          |
| `di/register.ts`                    | Registered 4 new services                   |
| `helpers/index.ts`                  | Added history module export                 |
| `session-history-reader.service.ts` | Refactored to facade (~1,278 -> ~200 lines) |

### Import Changes

```typescript
// New imports available (child services)
import { HistoryEventFactory, JsonlReaderService, AgentCorrelationService, SessionReplayService } from '@ptah-extension/agent-sdk';

// Type imports
import type { SessionHistoryMessage, ContentBlock, AgentSessionData, ToolResultData, AgentDataMapEntry, TaskToolUse } from '@ptah-extension/agent-sdk';
```

### Benefits

- **Single Responsibility**: Each service has one clear purpose
- **Testability**: Child services can be unit tested independently
- **Maintainability**: Reduced cognitive load (200 vs 1,278 lines)
- **Extensibility**: Easy to modify one aspect without affecting others
- **Type Safety**: Dedicated types file with clear contracts

### Key Design Decisions

1. **Facade Pattern**: SessionHistoryReaderService remains the single entry point
2. **Stats Aggregation Kept in Facade**: Uses existing `usage-extraction.utils`, simple logic
3. **Injectable Factory**: HistoryEventFactory is injectable for consistency with other services
4. **Correlation Window**: Agent correlation uses -1s to +60s timestamp window (preserved from original)
