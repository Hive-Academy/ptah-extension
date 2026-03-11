# TASK_2025_102: SDK Agent Adapter Bug Fix & Refactoring

## Overview

This task addressed a critical bug in new session creation and performed a refactoring of `SdkAgentAdapter` to reduce complexity by extracting focused services.

---

## Bug Fix: New Session Creation Not Working

### Symptom

- New chat sessions showed blurred placeholder boxes instead of streaming content
- Existing/resumed sessions worked correctly
- UI was stuck waiting for content that never arrived

### Root Cause

In `startChatSession()`, the initial `prompt` from config was never queued to the session's `messageQueue`. The SDK query started with an empty user message stream and hung waiting for a message that never arrived.

### Code Flow Before Fix

```
startChatSession(config)
  → preRegisterActiveSession()      // Session created with empty messageQueue
  → createUserMessageStream()        // Stream created, waiting for messages
  → buildQueryOptions()              // Query config built
  → query(prompt, options)           // SDK query starts
  → SDK waits for message...         // HANGS - no message ever arrives!
```

### Fix Applied

Added code to queue the initial prompt BEFORE creating the user message stream:

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (lines 576-594)

```typescript
// TASK_2025_102 FIX: Queue the initial prompt BEFORE creating user message stream
if (config.prompt && config.prompt.trim()) {
  const session = this.sessionLifecycle.getActiveSession(trackingId);
  if (session) {
    const sdkUserMessage = await this.messageFactory.createUserMessage({
      content: config.prompt,
      sessionId: trackingId,
      files: config.files,
    });
    session.messageQueue.push(sdkUserMessage);
  }
}
```

### Why `chat:continue` Worked

The `sendMessageToSession()` method properly queued messages to the `messageQueue`, which is why continuing an existing session worked fine.

---

## Refactoring: Service Extraction

### Problem

`SdkAgentAdapter` was becoming a "god service" with ~1200 lines and too many responsibilities.

### Solution

Extracted two focused services to reduce complexity:

### 1. SdkMessageFactory

**File**: `libs/backend/agent-sdk/src/lib/helpers/sdk-message-factory.ts`

**Responsibility**: Create SDK-compatible user messages with optional file attachments

**Before** (duplicated in 2 places):

- `startChatSession()` - manual message creation (~30 lines)
- `sendMessageToSession()` - manual message creation (~30 lines)

**After**:

```typescript
const sdkUserMessage = await this.messageFactory.createUserMessage({
  content: config.prompt,
  sessionId: trackingId,
  files: config.files,
});
```

**Key Features**:

- Processes file attachments via `AttachmentProcessorService`
- Generates unique message IDs via `MessageId.create()`
- Creates properly typed SDK message structure

### 2. SdkQueryOptionsBuilder

**File**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`

**Responsibility**: Build SDK query configuration (system prompt, MCP servers, permissions, hooks)

**Before**: `buildQueryOptions()` private method (~137 lines) in SdkAgentAdapter

**After**:

```typescript
const queryOptions = await this.queryOptionsBuilder.build({
  userMessageStream,
  abortController,
  sessionConfig: config,
  resumeSessionId: sessionId, // optional, for resume
});
```

**Key Features**:

- System prompt construction (preset + optional append)
- MCP server configuration (Ptah HTTP server on port 51820)
- Permission callback creation via `SdkPermissionHandler`
- Subagent lifecycle hooks via `SubagentHookHandler`
- Environment variable passthrough
- stderr capture for debugging

---

## Files Modified

### New Files Created

| File                                                                    | Purpose                  | Lines |
| ----------------------------------------------------------------------- | ------------------------ | ----- |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-message-factory.ts`         | Message creation service | ~118  |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`   | Query config builder     | ~265  |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts`           | SDK import caching       | ~112  |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`           | Model fetching/caching   | ~137  |
| `libs/backend/agent-sdk/src/lib/helpers/user-message-stream-factory.ts` | Async message streams    | ~129  |

### Modified Files

| File                                                  | Changes                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` | Removed `buildQueryOptions()`, use new services          |
| `libs/backend/agent-sdk/src/lib/di/tokens.ts`         | Added `SDK_MESSAGE_FACTORY`, `SDK_QUERY_OPTIONS_BUILDER` |
| `libs/backend/agent-sdk/src/lib/di/register.ts`       | Register new services as singletons                      |
| `libs/backend/agent-sdk/src/lib/helpers/index.ts`     | Export new services                                      |

### Type Fix

| File                     | Issue                                                           | Fix                                                        |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------- |
| `sdk-message-factory.ts` | Duplicate `SDKUserMessage` interface conflicting with re-export | Removed local interface, import from `claude-sdk.types.ts` |

---

## DI Registration

New tokens added to `SDK_TOKENS`:

```typescript
// Phase 1
SDK_MESSAGE_FACTORY: 'SdkMessageFactory',
SDK_QUERY_OPTIONS_BUILDER: 'SdkQueryOptionsBuilder',

// Phase 2
SDK_MODULE_LOADER: 'SdkModuleLoader',
SDK_MODEL_SERVICE: 'SdkModelService',
SDK_USER_MESSAGE_STREAM_FACTORY: 'UserMessageStreamFactory',
```

Services registered in `registerSdkServices()`:

```typescript
container.register(SDK_TOKENS.SDK_MESSAGE_FACTORY, { useClass: SdkMessageFactory }, { lifecycle: Lifecycle.Singleton });

container.register(SDK_TOKENS.SDK_QUERY_OPTIONS_BUILDER, { useClass: SdkQueryOptionsBuilder }, { lifecycle: Lifecycle.Singleton });
```

---

## Lines Reduced

### Phase 1 Extractions

| Area                         | Lines Removed  | Notes                             |
| ---------------------------- | -------------- | --------------------------------- |
| `buildQueryOptions()` method | ~137 lines     | Moved to SdkQueryOptionsBuilder   |
| Message creation duplication | ~30 lines      | Consolidated in SdkMessageFactory |
| Unused imports               | ~10 lines      | Cleaned up after refactoring      |
| **Phase 1 Total**            | **~170 lines** |                                   |

### Phase 2 Extractions

| Area                                         | Lines Removed  | Notes                             |
| -------------------------------------------- | -------------- | --------------------------------- |
| `getSdkQueryFunction()` + `preloadSdk()`     | ~60 lines      | Moved to SdkModuleLoader          |
| `getSupportedModels()` + `getDefaultModel()` | ~75 lines      | Moved to SdkModelService          |
| `createUserMessageStream()`                  | ~85 lines      | Moved to UserMessageStreamFactory |
| **Phase 2 Total**                            | **~200 lines** |                                   |

### Final Result

| Metric                        | Before | After | Change               |
| ----------------------------- | ------ | ----- | -------------------- |
| SdkAgentAdapter LOC           | ~997   | ~797  | **-200 lines**       |
| Total reduction from original | ~1200  | ~797  | **~400 lines (33%)** |

The adapter is now a focused orchestration layer with all complex logic extracted to testable, focused services.

---

## Manual Testing Checklist

### Critical Path: New Session Creation

- [ ] **Start new chat session**

  1. Open Ptah extension
  2. Click "New Chat" or equivalent
  3. Type a message and send
  4. **Expected**: Message streams correctly, no placeholder boxes
  5. **Expected**: Assistant response appears with streaming text

- [ ] **Start new session with file attachment**
  1. Start new chat
  2. Attach a file (image or text file)
  3. Send message with attachment
  4. **Expected**: File is processed and sent to Claude
  5. **Expected**: Claude acknowledges the file content

### Session Resume (Regression Test)

- [ ] **Resume existing session**

  1. Create a new session, send a few messages
  2. Close the chat panel
  3. Reopen and select the previous session
  4. Send a new message
  5. **Expected**: Context is maintained, Claude remembers previous conversation

- [ ] **Continue session after interruption**
  1. Start a long-running task (e.g., "analyze this codebase")
  2. Interrupt with Stop button
  3. Send a follow-up message
  4. **Expected**: Session continues normally

### Permission Handling (Regression Test)

- [ ] **Tool permission requests**

  1. Ask Claude to read a file
  2. **Expected**: Permission prompt appears
  3. Approve/deny the request
  4. **Expected**: Action proceeds or is denied accordingly

- [ ] **Permission mode changes**
  1. Change permission mode (Ask → Auto-edit → YOLO)
  2. Request tool use
  3. **Expected**: Permissions respected per mode

### Multi-Tab Isolation (Regression Test)

- [ ] **Multiple tabs with different sessions**
  1. Open multiple chat tabs
  2. Start different conversations in each
  3. **Expected**: Each tab maintains its own session
  4. **Expected**: Messages don't leak between tabs

### Subagent Streaming (Regression Test)

- [ ] **Subagent task execution**
  1. Ask Claude to perform a task that spawns subagents
  2. **Expected**: Subagent summaries stream in real-time
  3. **Expected**: Main agent and subagent outputs are distinguishable

### Error Handling

- [ ] **Invalid model**

  1. Attempt to start session without model configured
  2. **Expected**: Clear error message about model not provided

- [ ] **Network interruption**
  1. Start a session, then disable network
  2. **Expected**: Graceful error handling, session recoverable

---

## Verification Commands

```bash
# Type check all libraries
npm run typecheck:all

# Build all
npm run build:all

# Lint agent-sdk
npx nx lint agent-sdk

# Run agent-sdk tests (if available)
npx nx test agent-sdk
```

---

## Architecture After Refactoring

```
SdkAgentAdapter (~797 lines - orchestration layer)
├── SdkModuleLoader (injected)           # SDK import caching
├── SdkModelService (injected)           # Model fetching/caching
│   └── SdkModuleLoader (internal)
├── UserMessageStreamFactory (injected)  # Async message streams
│   └── SessionLifecycleManager (internal)
├── SdkMessageFactory (injected)         # Message creation
│   └── AttachmentProcessorService (internal)
├── SdkQueryOptionsBuilder (injected)    # Query configuration
│   ├── SdkPermissionHandler (internal)
│   └── SubagentHookHandler (internal)
├── SessionLifecycleManager (injected)   # Session tracking
├── StreamTransformer (injected)         # Stream transformation
├── AuthManager (injected)               # Authentication
├── ConfigWatcher (injected)             # Config monitoring
├── SessionMetadataStore (injected)      # UI metadata
└── ClaudeCliDetector (injected)         # CLI detection
```

**Key Benefits**:

- SdkAgentAdapter is now a thin orchestration layer (~800 LOC vs ~1200 original)
- Each extracted service has a single responsibility
- Services are independently testable
- DI enables easy mocking for unit tests
- Complex logic is encapsulated and documented

---

## Rollback Plan

If issues are discovered:

1. Revert the extracted services by re-inlining the methods
2. The original `buildQueryOptions()` code is preserved in git history
3. DI tokens can be removed from registration without breaking other code

---

## Future Improvements

All high-value extractions have been completed. Remaining opportunities:

1. **Session orchestration methods** - `startChatSession()` and `resumeSession()` share similar patterns that could potentially be consolidated
2. **Callback management** - `sessionIdResolvedCallback` and `resultStatsCallback` could be moved to a dedicated callback registry service
3. **Health monitoring** - Health status management could be extracted to a dedicated service

These are LOW priority as the current architecture is clean and maintainable at ~800 LOC.
