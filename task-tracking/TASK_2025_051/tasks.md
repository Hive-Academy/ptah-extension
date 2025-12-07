# Development Tasks - TASK_2025_051: SDK-Only Migration (Revised)

**Total Tasks**: 14 | **Batches**: 5 | **Status**: 0/5 complete

**Key Principles**:

- ✅ **Clean break** - No backward compatibility layers
- ✅ **No legacy code** - Complete removal of CLI-specific code
- ✅ **Fresh start** - SDK handles everything cleanly

---

## Revised Scope (Based on Analysis)

### What We Discovered

The `JsonlMessageProcessor` contains ~250 lines of **CLI-specific workarounds** that are NOT needed with SDK:

| CLI Workaround                  | Lines | SDK Status                              |
| ------------------------------- | ----- | --------------------------------------- |
| `stripSystemReminders()`        | ~10   | ❌ SDK doesn't inject these             |
| `stripLineNumbers()`            | ~15   | ❌ SDK returns clean output             |
| `isPermissionRequest` detection | ~20   | ❌ SDK has `SdkPermissionHandler`       |
| JSONL format parsing            | ~100  | ❌ SDK returns `ExecutionNode` directly |
| Delta streaming handling        | ~50   | ❌ SDK sends complete nodes             |

### What We Keep

- **Tab routing** (~20 lines) - Multi-tab support
- **Node registration** (~10 lines) - Agent/tool correlation via SessionManager
- **Tree merging** (~15 lines) - Append nodes to execution tree

### New Approach

**Frontend**: Add `processExecutionNode()` method (~30-50 lines) + remove `JsonlMessageProcessor`
**Backend**: Wire SDK RPC handlers + remove `claude-domain` library

---

## Batch 1: Frontend - Add ExecutionNode Handler ✅ IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Add processExecutionNode() to ChatStore ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Purpose**: Handle ExecutionNode directly from SDK (bypass JSONL processing)

**Implementation**:

```typescript
/**
 * Process ExecutionNode directly from SDK
 *
 * This replaces processJsonlChunk() for SDK-based sessions.
 * SDK returns clean ExecutionNode objects - no CLI formatting to strip.
 */
processExecutionNode(node: ExecutionNode, sessionId?: string): void {
  try {
    // 1. Find target tab by session ID
    let targetTab: TabState | null = null;
    let targetTabId: string | null = null;

    if (sessionId) {
      targetTab = this.tabManager.findTabBySessionId(sessionId);
      if (targetTab) {
        targetTabId = targetTab.id;
      }
    }

    // Fall back to active tab
    if (!targetTab) {
      targetTabId = this.tabManager.activeTabId();
      targetTab = this.tabManager.activeTab();
    }

    if (!targetTabId || !targetTab) {
      console.warn('[ChatStore] No target tab for ExecutionNode processing');
      return;
    }

    // 2. Merge node into execution tree
    const currentTree = targetTab.executionTree;
    const updatedTree = this.mergeExecutionNode(currentTree, node);

    // 3. Update tab state
    this.tabManager.updateTab(targetTabId, {
      executionTree: updatedTree,
    });

    // 4. Register in SessionManager for agent/tool correlation
    if (node.type === 'agent' && node.id) {
      this.sessionManager.registerAgent(node.id, node);
    } else if (node.type === 'tool' && node.toolCallId) {
      this.sessionManager.registerTool(node.toolCallId, node);
    }

    // 5. Track streaming state
    if (node.status === 'streaming' && !targetTab.currentMessageId) {
      this.tabManager.updateTab(targetTabId, {
        currentMessageId: node.id,
      });
    }

  } catch (error) {
    console.error('[ChatStore] Error processing ExecutionNode:', error, node);
  }
}

/**
 * Merge ExecutionNode into existing tree
 */
private mergeExecutionNode(
  currentTree: ExecutionNode | null,
  node: ExecutionNode
): ExecutionNode {
  if (!currentTree) {
    // First node becomes the root
    return node;
  }

  // Check if this node should replace an existing node (by ID)
  const existingNode = this.findNodeById(currentTree, node.id);
  if (existingNode) {
    // Replace existing node (update scenario)
    return this.replaceNodeInTree(currentTree, node.id, node);
  }

  // Append as new child
  return {
    ...currentTree,
    children: [...currentTree.children, node],
  };
}

/**
 * Find node by ID in tree (recursive)
 */
private findNodeById(tree: ExecutionNode, id: string): ExecutionNode | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = this.findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Replace node in tree by ID (recursive, immutable)
 */
private replaceNodeInTree(
  tree: ExecutionNode,
  nodeId: string,
  replacement: ExecutionNode
): ExecutionNode {
  if (tree.id === nodeId) return replacement;
  if (tree.children.length === 0) return tree;

  const updatedChildren = tree.children.map((child) =>
    this.replaceNodeInTree(child, nodeId, replacement)
  );

  const hasChanges = updatedChildren.some((child, i) => child !== tree.children[i]);
  return hasChanges ? { ...tree, children: updatedChildren } : tree;
}
```

**Quality Requirements**:

- Must handle multi-tab routing (find tab by sessionId)
- Must register agents/tools in SessionManager
- Must support node updates (replace existing by ID)
- Must be immutable (no tree mutation)

---

### Task 1.2: Update VSCodeService to Route ExecutionNode ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts
**Purpose**: Route `chat:chunk` messages with ExecutionNode payload to new handler

**Implementation**:

Find the `chat:chunk` handler (~line 173-186) and update:

```typescript
// Route chat:chunk messages to ChatStore
if (message.type === 'chat:chunk') {
  if (message.payload && this.chatStore) {
    const { sessionId, message: nodeOrJsonl } = message.payload;

    // SDK sends ExecutionNode directly (has 'type' and 'status' fields)
    // CLI sent JSONLMessage (has 'type' but different structure)
    if (this.isExecutionNode(nodeOrJsonl)) {
      // SDK path - direct ExecutionNode
      this.chatStore.processExecutionNode(nodeOrJsonl, sessionId);
    } else {
      // Legacy CLI path - keep for now, will be removed in Task 2.2
      this.chatStore.processJsonlChunk(nodeOrJsonl, sessionId);
    }
  }
}

// Type guard for ExecutionNode vs JSONLMessage
private isExecutionNode(obj: unknown): obj is ExecutionNode {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'type' in obj &&
    'status' in obj &&
    'children' in obj &&
    Array.isArray((obj as any).children)
  );
}
```

**Note**: This maintains backward compatibility temporarily. Task 2.2 removes the legacy path.

---

**Batch 1 Verification**:

- `processExecutionNode()` method added to ChatStore
- VSCodeService routes ExecutionNode to new handler
- Build passes: `npm run typecheck:all`

---

## Batch 2: Backend - Wire SDK RPC Handlers ✅ IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: Batch 1

### Task 2.1: Replace registerChatMethods() with SDK ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-method-registration.service.ts
**Purpose**: Replace CLI-based chat handlers with SDK calls

**Key Change**: Send `ExecutionNode` in `chat:chunk` events (not JSONLMessage)

```typescript
private registerChatMethods(): void {
  // chat:start - Start new SDK session
  this.rpcHandler.registerMethod('chat:start', async (params: any) => {
    const { prompt, sessionId, workspacePath, options } = params;

    const stream = await this.sdkAdapter.startChatSession(sessionId, {
      workspaceId: workspacePath,
      model: options?.model || 'claude-sonnet-4-20250514',
      systemPrompt: options?.systemPrompt,
      projectPath: workspacePath,
    });

    if (prompt) {
      await this.sdkAdapter.sendMessageToSession(sessionId, prompt);
    }

    // Stream ExecutionNodes to webview (background)
    this.streamExecutionNodesToWebview(sessionId, stream);

    return { success: true, sessionId };
  });

  // chat:continue - Send message to existing session
  this.rpcHandler.registerMethod('chat:continue', async (params: any) => {
    const { prompt, sessionId } = params;
    await this.sdkAdapter.sendMessageToSession(sessionId, prompt);
    return { success: true, sessionId };
  });

  // chat:abort - Interrupt session
  this.rpcHandler.registerMethod('chat:abort', async (params: any) => {
    const { sessionId } = params;
    await this.sdkAdapter.interruptSession(sessionId);
    return { success: true };
  });
}

private async streamExecutionNodesToWebview(
  sessionId: SessionId,
  stream: AsyncIterable<ExecutionNode>
): Promise<void> {
  try {
    for await (const node of stream) {
      // Send ExecutionNode directly (not JSONLMessage!)
      await this.webviewManager.sendMessage('ptah.main', 'chat:chunk', {
        sessionId,
        message: node, // ExecutionNode format
      });
    }
    await this.webviewManager.sendMessage('ptah.main', 'chat:complete', {
      sessionId,
      code: 0,
    });
  } catch (error) {
    await this.webviewManager.sendMessage('ptah.main', 'chat:error', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

---

### Task 2.2: Replace registerSessionMethods() with SDK Storage ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-method-registration.service.ts

```typescript
private registerSessionMethods(): void {
  this.rpcHandler.registerMethod('session:list', async (params: any) => {
    const { workspacePath, limit = 10, offset = 0 } = params;

    const allSessions = await this.sdkStorage.getAllSessions(workspacePath);

    const sorted = allSessions
      .filter(s => s.messages.length > 0)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);

    const total = sorted.length;
    const paginated = sorted.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    const sessions = paginated.map(s => ({
      id: s.id,
      name: s.name,
      lastActivityAt: s.lastActiveAt,
      createdAt: s.createdAt,
      messageCount: s.messages.length,
      branch: null,
      isUserSession: true,
    }));

    return { sessions, total, hasMore };
  });

  this.rpcHandler.registerMethod('session:load', async (params: any) => {
    const { sessionId } = params;
    const session = await this.sdkStorage.getSession(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return {
      sessionId: session.id,
      messages: session.messages,
      agentSessions: [],
    };
  });
}
```

---

### Task 2.3: Update Constructor Dependencies ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-method-registration.service.ts

**Remove**:

- `ClaudeProcessFactory`
- `SessionDiscoveryService`
- `ClaudeCliDetector`
- `activeProcesses` Map

**Add**:

- `@inject('SdkAgentAdapter') private readonly sdkAdapter: SdkAgentAdapter`
- `@inject('SdkSessionStorage') private readonly sdkStorage: SdkSessionStorage`

---

### Task 2.4: Remove CLI Imports ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-method-registration.service.ts

**Remove imports**:

```typescript
// DELETE THESE:
import { ClaudeProcess, ClaudeProcessFactory } from '@ptah-extension/claude-domain';
import { SessionDiscoveryService } from '../services/session-discovery.service';
```

**Add imports**:

```typescript
import { SdkAgentAdapter, SdkSessionStorage } from '@ptah-extension/agent-sdk';
```

---

**Batch 2 Verification**:

- RPC handlers use SDK adapter
- No ClaudeProcess references
- Build passes

---

## Batch 3: Frontend Cleanup - Remove CLI Code ✅ IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 2

### Task 3.1: Remove processJsonlChunk() from ChatStore ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts

**Action**: Delete the entire `processJsonlChunk()` method (~70 lines)

---

### Task 3.2: Remove Legacy Path from VSCodeService ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts

**Action**: Remove the `else` branch that calls `processJsonlChunk()`:

```typescript
// BEFORE (Task 1.2):
if (this.isExecutionNode(nodeOrJsonl)) {
  this.chatStore.processExecutionNode(nodeOrJsonl, sessionId);
} else {
  this.chatStore.processJsonlChunk(nodeOrJsonl, sessionId); // DELETE THIS
}

// AFTER:
if (message.payload && this.chatStore) {
  const { sessionId, message: node } = message.payload;
  this.chatStore.processExecutionNode(node as ExecutionNode, sessionId);
}
```

Also remove `isExecutionNode()` type guard (no longer needed).

---

### Task 3.3: Delete JsonlMessageProcessor Service ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\jsonl-processor.service.ts

**Action**: Delete entire file (~970 lines of CLI-specific code)

**Also update**:

- Remove from `libs/frontend/chat/src/index.ts` exports
- Remove injection from ChatStore constructor
- Remove import statements

---

**Batch 3 Verification**:

- No `JSONLMessage` references in frontend chat
- No `JsonlMessageProcessor` references
- Build passes: `npm run typecheck:all`

---

## Batch 4: Backend Cleanup - Remove claude-domain ✅ IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 3

### Task 4.1: Delete SessionDiscoveryService ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\backend\vscode-core\src\services\session-discovery.service.ts

**Action**: Delete file, remove exports, remove DI registration

---

### Task 4.2: Remove ClaudeProcessFactory from DI ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts

**Action**: Remove registration and imports

---

### Task 4.3: Delete claude-domain Library ✅ IMPLEMENTED

**Path**: D:\projects\ptah-extension\libs\backend\claude-domain\

**Action**: Delete entire directory (13 TypeScript files)

---

### Task 4.4: Remove claude-domain from tsconfig.base.json ✅ IMPLEMENTED

**File**: D:\projects\ptah-extension\tsconfig.base.json

**Action**: Remove path alias:

```json
// DELETE:
"@ptah-extension/claude-domain": ["libs/backend/claude-domain/src/index.ts"]
```

---

### Task 4.5: Verify No Remaining Imports ✅ IMPLEMENTED

**Action**: Run grep to verify clean removal:

```bash
Grep("@ptah-extension/claude-domain")
Grep("ClaudeProcess")
Grep("SessionDiscoveryService")
Grep("JSONLMessage")
Grep("JsonlMessageProcessor")
```

All should return zero matches in source files.

---

**Batch 4 Verification**:

- claude-domain directory deleted
- No import references remain
- Build passes

---

## Batch 5: Final Verification ⏸️ PENDING

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 4

### Task 5.1: Run Full Build ⏸️ PENDING

```bash
npm run typecheck:all
npm run lint:all
npm run build:all
```

---

### Task 5.2: Manual Testing ⏸️ PENDING

Test checklist:

1. Start new chat session → ExecutionNode streams to UI
2. Continue existing session → Messages append correctly
3. Abort session → Stream stops
4. List sessions → SDK storage returns sessions
5. Load session → Messages display correctly
6. Multi-tab → Correct tab receives messages

---

## Task Status Summary

| Task | Description                               | Status      | Developer          | Batch |
| ---- | ----------------------------------------- | ----------- | ------------------ | ----- |
| 1.1  | Add processExecutionNode() to ChatStore   | IMPLEMENTED | frontend-developer | 1     |
| 1.2  | Update VSCodeService routing              | IMPLEMENTED | frontend-developer | 1     |
| 2.1  | Replace registerChatMethods() with SDK    | IMPLEMENTED | backend-developer  | 2     |
| 2.2  | Replace registerSessionMethods() with SDK | IMPLEMENTED | backend-developer  | 2     |
| 2.3  | Update constructor dependencies           | IMPLEMENTED | backend-developer  | 2     |
| 2.4  | Remove CLI imports                        | IMPLEMENTED | backend-developer  | 2     |
| 3.1  | Remove processJsonlChunk() from ChatStore | IMPLEMENTED | frontend-developer | 3     |
| 3.2  | Remove legacy path from VSCodeService     | IMPLEMENTED | frontend-developer | 3     |
| 3.3  | Delete JsonlMessageProcessor service      | IMPLEMENTED | frontend-developer | 3     |
| 4.1  | Delete SessionDiscoveryService            | IMPLEMENTED | backend-developer  | 4     |
| 4.2  | Remove ClaudeProcessFactory from DI       | IMPLEMENTED | backend-developer  | 4     |
| 4.3  | Delete claude-domain library              | IMPLEMENTED | backend-developer  | 4     |
| 4.4  | Remove from tsconfig.base.json            | IMPLEMENTED | backend-developer  | 4     |
| 4.5  | Verify no remaining imports               | IMPLEMENTED | backend-developer  | 4     |
| 5.1  | Run full build                            | PENDING     | backend-developer  | 5     |
| 5.2  | Manual testing                            | PENDING     | backend-developer  | 5     |

---

## Batching Strategy

**Batch 1** (Frontend): Add SDK handler → Enables SDK path
**Batch 2** (Backend): Wire SDK RPC → Backend sends ExecutionNode
**Batch 3** (Frontend): Remove CLI code → Clean frontend
**Batch 4** (Backend): Remove claude-domain → Clean backend
**Batch 5** (Verification): Build + test → Confirm success

**Parallelization**: Batches 1 and 2 can potentially run in parallel (frontend + backend)

---

## Files Summary

**CREATE**: None

**MODIFY**:

- `libs/frontend/chat/src/lib/services/chat.store.ts` (Batch 1, 3)
- `libs/frontend/core/src/lib/services/vscode.service.ts` (Batch 1, 3)
- `libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts` (Batch 2)
- `apps/ptah-extension-vscode/src/di/container.ts` (Batch 4)
- `tsconfig.base.json` (Batch 4)

**DELETE**:

- `libs/frontend/chat/src/lib/services/jsonl-processor.service.ts` (~970 lines)
- `libs/backend/vscode-core/src/services/session-discovery.service.ts` (~450 lines)
- `libs/backend/claude-domain/` (entire directory, ~14 files)

**Total Lines Removed**: ~2000+ lines of CLI-specific code
**Total Lines Added**: ~100 lines of SDK integration code
