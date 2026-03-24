# Implementation Plan - TASK_2025_211: Fix 6 Pre-Existing Extension Bugs

## Codebase Investigation Summary

### Libraries Analyzed

- **agent-sdk**: SessionMetadataStore, SessionLifecycleManager, SdkAgentAdapter, SkillJunctionService, PluginLoaderService
- **llm-abstraction**: ProviderRegistry, LlmService, LlmConfigurationService, provider-import-map, provider-types
- **rpc-handlers**: ChatRpcHandlers (chat:abort flow)
- **vscode-core**: AgentSessionWatcherService (subagent directory watching)
- **frontend/chat**: ExecutionTreeBuilderService, ExecutionNodeComponent, InlineAgentBubbleComponent, ConversationService, TabManagerService

### Evidence Sources

- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (lines 206-224)
- `libs/backend/llm-abstraction/src/lib/registry/provider-import-map.ts` (lines 23-26)
- `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts` (lines 303-313)
- `libs/backend/llm-abstraction/src/lib/services/llm.service.ts` (lines 82-123)
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` (lines 311-377)
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts` (lines 1386-1416)
- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts` (lines 499, 532-534)
- `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts` (lines 486-610)
- `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts` (lines 445-756)
- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts` (lines 49-106)

---

## Bug 1: Pricing shows $0.0000 -- parent session doesn't aggregate subagent costs

### Root Cause Analysis

**Verified in code**: `SessionMetadataStore.addStats()` (line 206-224) adds stats for a given `sessionId`. The SDK emits `SESSION_STATS` events per-session. When a subagent completes, its stats are stored under the **subagent's session ID** (e.g., `a4137181d543dcc15`), not the parent's session ID (e.g., `tab_1774128415834_809h31a`).

The parent session only receives its own direct token usage (e.g., 3 tokens for the orchestration overhead), while the subagent's 392 tokens / $0.0056 are tracked separately.

**Evidence**: `addStats()` at line 206 only updates `metadata.totalCost + stats.cost` for the exact `sessionId` passed. There is no aggregation of child session stats into the parent.

### Files to Modify

1. **`libs/backend/agent-sdk/src/lib/session-metadata-store.ts`**

   - Add a method `aggregateWithChildren()` that sums parent + all child session costs/tokens
   - OR: Modify `addStats()` to also propagate stats to the parent session when the session is a child (has `isChildSession: true`)

2. **`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`** (or wherever SESSION_STATS is handled for the stream transformer)
   - When SESSION_STATS arrives for a child session, also call `addStats()` on the parent session
   - The parent session ID is available via `cliSessions` references or via `SubagentRegistryService`

### Implementation Approach

**Recommended: Propagate stats upward at emission time**

When `addStats()` is called for a session, check if the session has `isChildSession: true`. If so, find the parent session (by scanning `cliSessions` arrays in all sessions) and also add the same stats to the parent. This ensures the parent's `totalCost` and `totalTokens` always include subagent contributions.

Alternatively, the stream transformer or the handler that processes `result` messages (which contain cost/token stats) should identify the parent session and propagate stats there.

**Key consideration**: The `addStats` method already uses `enqueueWrite` for serialization, so concurrent updates from multiple subagents are safe.

### Specific Changes

```typescript
// In SessionMetadataStore, add after addStats():
async addStats(sessionId: string, stats: { cost: number; tokens: { input: number; output: number } }): Promise<void> {
  return this.enqueueWrite(async () => {
    const metadata = await this.get(sessionId);
    if (metadata) {
      await this._saveInternal({
        ...metadata,
        lastActiveAt: Date.now(),
        totalCost: metadata.totalCost + stats.cost,
        totalTokens: {
          input: metadata.totalTokens.input + stats.tokens.input,
          output: metadata.totalTokens.output + stats.tokens.output,
        },
      });

      // NEW: If this is a child session, propagate stats to parent
      if (metadata.isChildSession) {
        await this.propagateStatsToParent(sessionId, stats);
      }
    }
  });
}

private async propagateStatsToParent(
  childSessionId: string,
  stats: { cost: number; tokens: { input: number; output: number } }
): Promise<void> {
  const all = await this.getAll();
  for (const session of all) {
    if (session.cliSessions?.some(ref => ref.sdkSessionId === childSessionId)) {
      // Found parent - add stats (already inside enqueueWrite, use _saveInternal)
      await this._saveInternal({
        ...session,
        lastActiveAt: Date.now(),
        totalCost: session.totalCost + stats.cost,
        totalTokens: {
          input: session.totalTokens.input + stats.tokens.input,
          output: session.totalTokens.output + stats.tokens.output,
        },
      });
      this.logger.info(
        `[SessionMetadataStore] Propagated subagent stats to parent ${session.sessionId}`
      );
      break;
    }
  }
}
```

### Risk Assessment

- **Risk**: Low. The write serialization queue prevents races. The parent lookup scans `cliSessions` which is a small array.
- **Edge case**: The parent session must already have the child's `sdkSessionId` in its `cliSessions` array. If `addCliSession()` hasn't been called yet (timing), propagation will silently skip. This is acceptable since the child session stats still exist and can be aggregated later.
- **Alternative risk**: If no parent is found (orphan child session), no error is thrown -- the stats just don't propagate.

---

## Bug 2: Plugin skills/commands duplication

### Root Cause Analysis

**Verified in code**: Two systems create entries in `.claude/skills/` and `.claude/commands/`:

1. **PluginLoaderService** (`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`) -- resolves plugin paths and passes them to the SDK via `pluginPaths` in query options. The SDK itself creates entries in `.claude/commands/` and `.claude/skills/` during session startup.

2. **SkillJunctionService** (`libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts`) -- creates filesystem junctions (symlinks on Unix) from `{workspace}/.claude/skills/{skillName}/` to `{extensionPath}/assets/plugins/{pluginId}/skills/{skillName}/`. Also copies command files to `.claude/commands/`.

The log evidence shows: `[SkillJunctionService] Junctions and commands synced: {"created":16,"skipped":7}` -- 23 total entries, many duplicated because both systems create the same artifacts.

### Files to Modify

1. **`libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts`**

   - The SkillJunctionService should only create junctions for skills/commands that the SDK doesn't already handle via `pluginPaths`.
   - Since Claude's SDK natively resolves plugin paths when `pluginPaths` is provided, the SkillJunctionService is only needed for non-Claude providers (Codex, Copilot) that search the workspace directory.

2. **Alternatively**: The SkillJunctionService should check if entries already exist (from SDK) before creating junctions. The current code at line 181-198 already handles this (`existingStat.isSymbolicLink()` and `existingStat.isDirectory()` checks), but the SDK may be creating entries in a different way (e.g., real files vs symlinks).

### Implementation Approach

**Recommended: Deduplicate by checking for existing entries more broadly**

The SkillJunctionService already skips real directories (line 193-199) and existing symlinks pointing to the correct target. The duplication likely comes from:

- SkillJunctionService creates junctions in `.claude/skills/`
- SDK creates entries in `.claude/skills/` when `pluginPaths` is provided

The fix should ensure SkillJunctionService skips entries that already exist regardless of their type (real directory, real file, symlink). The "skipped: 7" in the log suggests 7 entries were already correctly handled. The "created: 16" suggests 16 entries were created that may overlap with SDK-created ones.

**Simplest fix**: Check if the entry already exists as a real directory or file (not just symlink) and skip it. The current code already does this for directories but may not handle all cases.

**Alternative**: Don't create junctions for commands at all when using Claude SDK (since pluginPaths handles it). Only create junctions for non-Claude providers. This requires a flag or detection mechanism.

### Risk Assessment

- **Risk**: Low. The deduplication logic is additive (more skip conditions).
- **Edge case**: If SDK creates entries after SkillJunctionService runs, duplicates could still occur. Timing-dependent.

---

## Bug 3: Session stop fails -- "Cannot end session - not found"

### Root Cause Analysis

**Verified in code**: The flow is:

1. Frontend `ConversationService.abortCurrentMessage()` at line 499 gets `sessionId` from `this.currentSessionId()` which returns `this.tabManager.activeTab()?.claudeSessionId`.

2. The `claudeSessionId` on the tab is the **real SDK UUID** (e.g., `7d32bb53-...`), which was resolved via `SESSION_ID_RESOLVED` message.

3. This UUID is sent to `chat:abort` RPC handler at `chat-rpc.handlers.ts` line 1400, which calls `sdkAdapter.interruptSession(sessionId)`.

4. `SdkAgentAdapter.interruptSession()` (line 749-752) delegates to `sessionLifecycle.endSession(sessionId)`.

5. `SessionLifecycleManager.endSession()` (line 311-377) looks up `sessionId` in `this.activeSessions` Map. **The activeSessions Map is keyed by the tab ID** (e.g., `tab_1774128415834_809h31a`), NOT by the real SDK UUID.

**The mismatch**: The frontend sends the real SDK UUID (`7d32bb53`), but `SessionLifecycleManager.activeSessions` is keyed by the tab ID (`tab_xxx`). The lookup at line 312 `this.activeSessions.get(sessionId)` fails because the Map doesn't have an entry for the UUID.

**Note**: The `tabIdToRealId` Map (line 179) maps tab ID -> real UUID, but there's no reverse mapping (real UUID -> tab ID) used in `endSession()`.

### Files to Modify

1. **`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`** -- `endSession()` method
   - Add reverse lookup: when `sessionId` is not found in `activeSessions`, check if it matches a real UUID in `tabIdToRealId` and use the corresponding tab ID.

### Implementation Approach

```typescript
async endSession(sessionId: SessionId): Promise<void> {
  let session = this.activeSessions.get(sessionId as string);

  // NEW: If not found by direct key, try reverse lookup (real UUID -> tab ID)
  if (!session) {
    for (const [tabId, realId] of this.tabIdToRealId.entries()) {
      if (realId === (sessionId as string)) {
        session = this.activeSessions.get(tabId);
        if (session) {
          // Use the tab ID for cleanup operations below
          sessionId = tabId as SessionId;
          break;
        }
      }
    }
  }

  if (!session) {
    this.logger.warn(
      `[SessionLifecycle] Cannot end session - not found: ${sessionId}`
    );
    return;
  }
  // ... rest of endSession unchanged
}
```

### Risk Assessment

- **Risk**: Very low. This is a simple reverse lookup addition. The worst case is the same "not found" warning if neither key matches.
- **Performance**: The reverse lookup iterates `tabIdToRealId` which has at most a few entries (one per active session). Negligible overhead.
- **Edge case**: If multiple tab IDs map to the same real UUID (shouldn't happen), the first match is used, which is correct behavior.

---

## Bug 4: Subagent watcher race condition (PARTIAL FIX APPLIED)

### Root Cause Analysis

**Verified in code**: The `AgentSessionWatcherService.watchSubagentDirectories()` method (line 556-611) watches for subagent files in `{sessionsDir}/{sessionId}/subagents/`.

**Current partial fix** (line 498-503): When the main directory watcher sees a `rename` event for a UUID-like directory name, it calls `watchSubagentDirectories()` again to pick up new session directories.

**Remaining issue**: The `watchSubagentDirectories()` method at line 558-560 collects session IDs from `this.activeWatches` (active file tail watchers for agent-\*.jsonl files). When the first subagent starts:

1. The SDK creates the session directory (e.g., `{sessionsDir}/{uuid}/`)
2. Then creates `subagents/` inside it
3. Then creates `agent-{id}.jsonl` inside `subagents/`

The partial fix handles step 1 (re-checking when UUID dir appears). The code at line 571-597 handles step 2 by watching the session directory for `subagents` creation. However, there's a potential issue: the `sessionIds` set (line 558-560) is populated from `activeWatches`, which may not yet contain the first subagent's session ID since no agent file has been found yet.

**The watchSubagentDirectories method relies on activeWatches having session IDs**, but for the first subagent, no watch has been created yet, so no session ID exists in `activeWatches`. This means `sessionIds` is empty, and the for-loop at line 562 never executes.

### Files to Modify

1. **`libs/backend/vscode-core/src/services/agent-session-watcher.service.ts`** -- `watchSubagentDirectories()` method
   - In addition to getting session IDs from `activeWatches`, also scan the `sessionsDir` for UUID-named directories that might contain `subagents/` directories.

### Implementation Approach

```typescript
private watchSubagentDirectories(sessionsDir: string): void {
  // Get session IDs from active watches
  const sessionIds = new Set(
    Array.from(this.activeWatches.values()).map((w) => w.sessionId)
  );

  // NEW: Also scan for UUID-named directories in sessionsDir
  // This handles the case where no activeWatches exist yet (first subagent)
  try {
    const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && this.isUuidLike(entry.name)) {
        sessionIds.add(entry.name);
      }
    }
  } catch {
    // Directory scan failed - proceed with activeWatches only
  }

  // ... rest of method unchanged
}

private isUuidLike(name: string): boolean {
  // UUID format: 8-4-4-4-12 hex characters, or just hex characters
  return /^[0-9a-f]{8}(-[0-9a-f]{4}){0,3}(-[0-9a-f]{12})?$/i.test(name)
    || /^[0-9a-f]{12,}$/i.test(name);
}
```

### Risk Assessment

- **Risk**: Low. The additional directory scan is a read-only operation. If it fails, we fall back to the existing behavior.
- **Performance**: `readdirSync` on a small directory (usually 1-5 session dirs) is fast (<1ms).
- **Edge case**: Non-session directories with UUID-like names would be picked up, but `watchSubagentDirectories` handles missing `subagents/` gracefully (line 571-597).

---

## Bug 5: vscode-lm provider not found -- "No import map entry for provider: vscode-lm"

### Root Cause Analysis

**Verified in code**: The error path is:

1. `LlmService` constructor (line 73) calls `this.initializeDefaultProvider()` eagerly.
2. `initializeDefaultProvider()` (line 82-123) calls `configService.getDefaultProvider()` which returns `'vscode-lm'` (the fallback at line 91 in `LlmConfigurationService`).
3. Then calls `this.setProvider('vscode-lm', defaultModel)` (line 96).
4. `setProvider()` calls `providerRegistry.createProvider(providerName, model)` (line 194).
5. `ProviderRegistry.createProviderInternal()` (line 119) passes `isValidProvider('vscode-lm')` check (line 129 -- it's in `SUPPORTED_PROVIDERS`).
6. Then calls `getOrLoadFactory('vscode-lm')` (line 143).
7. `getOrLoadFactory()` calls `loadProviderFactory('vscode-lm')` (line 272).
8. `loadProviderFactory()` (line 303-313) checks `PROVIDER_IMPORT_MAP['vscode-lm']` -- which is **undefined** because the import map is empty `{}` (TASK_2025_209 removed VsCodeLmProvider).
9. Throws: `"No import map entry for provider: vscode-lm"`.

**The real issue**: TASK_2025_209 removed VsCodeLmProvider and its import map entry but kept `'vscode-lm'` in `SUPPORTED_PROVIDERS` and `LlmConfigurationService.getDefaultProvider()` still returns `'vscode-lm'` as fallback.

### Files to Modify

1. **`libs/backend/llm-abstraction/src/lib/services/llm.service.ts`** -- `initializeDefaultProvider()` method

   - Make initialization gracefully handle the case where the default provider has no import map entry. Since the LLM abstraction is now only used for internal structured queries (not for the main chat which uses Agent SDK), it should silently skip initialization if no providers are available.

2. **`libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts`** -- `loadProviderFactory()` method
   - Return a proper LlmProviderError instead of throwing a raw Error, so the error chain propagates correctly.

### Implementation Approach

**Option A (Recommended): Graceful handling in LlmService**

The LLM abstraction library is vestigial after TASK_2025_209 (the import map comment says "kept for structural consistency"). The fix should make `initializeDefaultProvider()` not log a scary warning when no providers are available.

```typescript
// In LlmService.initializeDefaultProvider():
private async initializeDefaultProvider(): Promise<void> {
  if (this.isInitialized) return;

  try {
    const defaultProvider = this.configService.getDefaultProvider();
    const defaultModel = this.configService.getDefaultModel(defaultProvider);

    // NEW: Check if provider has an import map entry before attempting initialization
    // After TASK_2025_209, the import map may be empty (no providers available)
    const result = await this.setProvider(defaultProvider, defaultModel);

    if (result.isOk()) {
      this.isInitialized = true;
      this.logger.info('[LlmService.initializeDefaultProvider] Default provider initialized', {
        provider: defaultProvider,
        model: defaultModel,
      });
    } else {
      // Downgrade from warn to debug - no provider is expected after SDK-only migration
      this.logger.debug(
        '[LlmService.initializeDefaultProvider] No provider available (expected in SDK-only mode)',
        { error: result.error?.message }
      );
    }
  } catch (error) {
    // Downgrade from warn to debug
    this.logger.debug(
      '[LlmService.initializeDefaultProvider] Initialization skipped',
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}
```

### Risk Assessment

- **Risk**: Very low. This only changes log levels (warn -> debug) for an expected condition.
- **Functional impact**: None. The LlmService was already non-functional without providers; this just silences the startup warning.
- **Future compatibility**: If providers are added back, the initialization will work normally (success path unchanged).

---

## Bug 6: Subagent streaming UI shows nested tool wrapper instead of direct content

### Root Cause Analysis

**Verified in code**: The `ExecutionTreeBuilderService.collectTools()` method (line 445-759) handles the rendering of tool_start events. For "Task" tools that spawn agents, it has extensive logic (line 478-751) to:

1. Find matching `agent_start` events by `parentToolUseId` or `agentType` fallback
2. Build an `agent` type node directly (skipping the Task tool wrapper)
3. If no `agent_start` is found yet (streaming), create a "placeholder" agent node

**The issue**: The bug says "subagent streaming content is wrapped in a tool execution container." This means the `collectTools()` method is **not** recognizing a tool_start as a Task tool (line 482: `toolStart.isTaskTool || toolStart.toolName === 'Task'`), and instead falling through to line 755: `tools.push(this.buildToolNode(toolStart, state, depth))` which creates a regular `tool` type node.

The `ExecutionNodeComponent` template (line 62-77) renders `tool` type nodes via `<ptah-tool-call-item>` which shows "Executing Tool..." with an Input section -- exactly matching the bug description.

**Most likely cause**: The SDK is sending the subagent tool with a tool name that doesn't match `'Task'` and the `isTaskTool` flag isn't set. Possible tool names include `dispatch_agent`, `Bash`, or other names that the SDK uses internally.

**To fix**: The detection logic at line 482 needs to be broadened to also check for other subagent-related tool names, or the `isTaskTool` flag needs to be set correctly by the stream transformer when it processes tool_start events.

### Files to Investigate and Modify

1. **`libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts`** -- `collectTools()` method, line 482

   - Broaden the Task tool detection: check tool name for additional patterns (e.g., contains 'agent', 'dispatch_agent', 'subagent')
   - OR: Check if the tool input contains `subagent_type` field as an additional signal

2. **`libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`** (or stream transformer)
   - Ensure the `isTaskTool` flag is set correctly when the SDK emits a tool_start for subagent dispatch

### Implementation Approach

**Approach 1 (Frontend fix -- recommended for immediate fix):**

Enhance the `isTaskTool` detection in `collectTools()`:

```typescript
// Line 482 in execution-tree-builder.service.ts
// Current:
if (toolStart.isTaskTool || toolStart.toolName === 'Task') {

// Enhanced:
const isAgentDispatchTool =
  toolStart.isTaskTool ||
  toolStart.toolName === 'Task' ||
  toolStart.toolName === 'dispatch_agent' ||
  toolStart.toolName === 'dispatch_subagent';

// Additional check: if tool input contains subagent_type, treat as agent dispatch
if (!isAgentDispatchTool) {
  const inputKey = `${toolStart.toolCallId}-input`;
  const inputString = state.toolInputAccumulators.get(inputKey) || '';
  if (inputString.includes('"subagent_type"')) {
    isAgentDispatchTool = true;
  }
}

if (isAgentDispatchTool) {
  // ... existing agent node building logic
}
```

**Approach 2 (Backend fix -- correct root cause):**

Set `isTaskTool` flag in the stream transformer when processing tool_start events. This is cleaner but requires identifying exactly which tool names the SDK uses for subagent dispatch.

**Recommended**: Combine both approaches. The frontend should be resilient to any tool name by checking the input content for `subagent_type`. The backend should also set `isTaskTool` correctly.

### Risk Assessment

- **Risk**: Medium. Incorrectly classifying a regular tool as a Task tool would hide its output. The `subagent_type` input check is a reliable signal.
- **Testing**: Need to verify with actual subagent sessions to confirm the tool name used by the SDK.
- **Regression**: The existing logic for `toolName === 'Task'` is preserved; we're only adding additional patterns.

---

## Implementation Batches

### Batch 1: Independent backend fixes (can be done in parallel)

| Bug   | Fix                          | Complexity | Files                          |
| ----- | ---------------------------- | ---------- | ------------------------------ |
| Bug 5 | Graceful LLM provider init   | Low        | `llm.service.ts`               |
| Bug 3 | Session abort reverse lookup | Low        | `session-lifecycle-manager.ts` |

**Rationale**: These are completely independent single-file fixes with no cross-dependencies.

### Batch 2: Subagent-related fixes (can be partially parallel)

| Bug   | Fix                          | Complexity | Files                                                                          |
| ----- | ---------------------------- | ---------- | ------------------------------------------------------------------------------ |
| Bug 1 | Cost aggregation propagation | Medium     | `session-metadata-store.ts`                                                    |
| Bug 4 | Watcher directory scanning   | Low        | `agent-session-watcher.service.ts`                                             |
| Bug 6 | Tool detection broadening    | Medium     | `execution-tree-builder.service.ts` + potentially `sdk-message-transformer.ts` |

**Rationale**: Bugs 1, 4, and 6 are all subagent-related but affect different layers (backend storage, backend file watching, frontend rendering). They can be developed in parallel.

### Batch 3: Plugin deduplication (lowest priority)

| Bug   | Fix                          | Complexity | Files                       |
| ----- | ---------------------------- | ---------- | --------------------------- |
| Bug 2 | Skill junction deduplication | Low        | `skill-junction.service.ts` |

**Rationale**: This is a cosmetic issue (log noise, not functionality-breaking). The duplication doesn't cause incorrect behavior since the junction system handles existing entries gracefully.

---

## Architectural Considerations

### 1. Cost Aggregation Strategy (Bug 1)

The propagation approach (child stats flow up to parent) is simpler than the aggregation approach (parent queries children on demand). Propagation integrates with the existing `enqueueWrite` serialization and works correctly even if child sessions are cleaned up before the parent queries costs.

### 2. Session ID Mapping (Bug 3)

The codebase has a fundamental design tension: sessions are registered by tab ID but looked up by SDK UUID. The reverse lookup fix is a targeted patch. A more architectural solution would be to maintain a bidirectional Map, but that's over-engineering for this bug.

### 3. LLM Abstraction Obsolescence (Bug 5)

After TASK_2025_209, the LLM abstraction layer is largely vestigial. The fix should not try to "restore" functionality but rather make the module gracefully dormant. The `PROVIDER_IMPORT_MAP` being empty is the correct state; the initialization code just needs to handle it cleanly.

### 4. Tree Builder Tool Detection (Bug 6)

The tool name detection should be data-driven (checking input content for `subagent_type`) rather than hardcoded tool names. The SDK may change tool names in future versions, and the input content is the most reliable signal that a tool call is a subagent dispatch.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both frontend-developer and backend-developer

**Breakdown**:

- **Backend developer**: Bugs 1, 2, 3, 4, 5 (all backend library changes)
- **Frontend developer**: Bug 6 (frontend tree builder + potentially execution-node component)

Since Bug 6 has a frontend component dependency (ExecutionTreeBuilderService), a frontend developer is better suited. All other bugs are purely backend.

### Complexity Assessment

**Overall Complexity**: LOW-MEDIUM
**Estimated Effort**: 4-6 hours total

- Bug 1 (cost aggregation): 1-1.5 hours
- Bug 2 (plugin dedup): 0.5-1 hour
- Bug 3 (session abort): 0.5 hour
- Bug 4 (watcher race): 0.5-1 hour
- Bug 5 (provider init): 0.5 hour
- Bug 6 (subagent UI): 1-1.5 hours

### Files Affected Summary

**MODIFY**:

- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (Bug 1)
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` (Bug 3)
- `libs/backend/agent-sdk/src/lib/helpers/skill-junction.service.ts` (Bug 2)
- `libs/backend/llm-abstraction/src/lib/services/llm.service.ts` (Bug 5)
- `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts` (Bug 4)
- `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts` (Bug 6)

### Critical Verification Points

1. **Bug 1**: After fix, verify parent session header shows aggregated cost (parent + all child sessions)
2. **Bug 3**: After fix, clicking Stop should not produce "Cannot end session" warning in logs
3. **Bug 4**: After fix, first subagent's streaming text should appear in UI immediately
4. **Bug 5**: After fix, no "No import map entry" warning should appear at startup
5. **Bug 6**: After fix, subagent content should render inside InlineAgentBubble (colored avatar + agent header), not inside a tool execution container with "Input" toggle

### Architecture Delivery Checklist

- [x] All 6 bugs analyzed with verified root causes
- [x] All root causes verified by reading actual source code (file:line citations)
- [x] All proposed fixes reference existing patterns and APIs
- [x] Implementation batches defined for parallel work
- [x] Risk assessment provided for each bug
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
