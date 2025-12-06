# TASK_2025_044: Claude Agent SDK Migration (SDK-Only)

**Created**: 2025-12-04
**Updated**: 2025-12-06 (Strategy change: Dual-mode → SDK-only)
**Status**: In Progress
**Type**: Feature Implementation (Core Architecture Migration)
**Owner**: team-leader

---

## 🎯 User Intent

**STRATEGIC PIVOT**: Completely replace Claude CLI integration with Claude Agent SDK to gain full backend control and eliminate correlation bugs.

**Key Decision**: After analyzing the root cause of agent message display issues (timestamp correlation, slug filtering, JSONL parsing fragility), we determined that the CLI's external process architecture is fundamentally incompatible with our need for reliable parent-child message relationships.

**SDK-Only Benefits**:

1. **Explicit parent-child relationships**: No more timestamp guessing
2. **Full data structure control**: We define the storage format
3. **30-50% performance improvement**: In-process vs CLI spawn
4. **Eliminates entire class of bugs**: No JSONL parsing, no correlation logic
5. **Enables unlimited UI features**: Custom metadata, persistent state, tags, annotations

**Authentication**: Users provide `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` via VS Code settings (both CLI and SDK require API access anyway).

---

## 📊 Context from Previous Tasks

### TASK_2025_041: Agent SDK Research

- Comprehensive 55K word research report completed
- SDK provides programmatic session management, structured outputs, custom tools
- Hybrid approach rejected: dual-mode adds complexity without benefit
- Research validates SDK-only approach as superior

### Current Bug Investigation

- **Issue**: Agent messages not showing in UI despite backend having data
- **Root Cause**: `buildAgentDataMap()` filters agents without "slug" field
- **Deeper Issue**: CLI writes agents to separate `.jsonl` files with NO parent reference
- **Correlation Logic**: Fragile timestamp matching (within 60 seconds)
- **Conclusion**: CLI architecture is fundamentally flawed for our use case

---

## 🏗️ Architecture Overview

### **BEFORE** (CLI-based - Current)

```
VS Code Extension Process
  ├── Webview (Angular SPA)
  │   ├── ChatInputComponent
  │   ├── MessageListComponent
  │   └── AppStateManager (signal-based state)
  ├── Extension Host (Node.js)
  │   ├── SessionProxy (spawns CLI processes)
  │   ├── ClaudeCliAdapter (stdio communication)
  │   ├── SessionReplayService (correlation logic ← FRAGILE!)
  │   └── PermissionManager (UI coordination)
  └── Claude CLI Process(es)
      ├── Session state (.claude_sessions/ ← EXTERNAL)
      ├── Agent files (agent-XXXXX.jsonl ← NO PARENT LINK!)
      └── JSONL parsing (correlation bugs)
```

**Communication**: Webview → RPC → Extension → stdin → CLI → stdout → Extension → RPC → Webview

**Problems**:

- ❌ Separate process spawning (500ms latency)
- ❌ Agents in separate files (no parent reference!)
- ❌ Timestamp correlation (fragile, breaks easily)
- ❌ Slug filtering (filters valid agents)
- ❌ Black box (no control over data structure)

### **AFTER** (SDK-only - Target)

```
VS Code Extension Process
  ├── Webview (Angular SPA) [NO CHANGE!]
  ├── Extension Host (Node.js)
  │   ├── SdkAgentAdapter (direct Anthropic API)
  │   ├── SessionManager (OUR storage format)
  │   ├── PermissionHandler (canUseTool callbacks)
  │   ├── MCPServerRegistry (custom tools)
  │   └── [NO CLI PROCESS!]
```

**Communication**: Webview → RPC → Extension → SDK → Anthropic API → Stream → Extension → RPC → Webview

**Benefits**:

- ✅ In-process (50ms latency, 10x faster!)
- ✅ Explicit parent-child links (agentToolUseId field)
- ✅ NO correlation logic (direct references!)
- ✅ NO slug filtering (we control validation)
- ✅ Full control (our data format, our rules)

---

## 📁 Custom Storage Format

### Current CLI Format (External, Uncontrolled)

```
Main: b916d11a-4174-44a4-93a9-37b0e3ce8b1c.jsonl
Agent1: agent-04691798.jsonl ← NO LINK TO PARENT!
Agent2: agent-05c53fe3.jsonl ← NO LINK TO PARENT!

Must correlate by timestamp ± 60 seconds 🤞
```

### New SDK Format (Internal, Controlled)

```typescript
interface SessionMessage {
  id: string;
  parentId: string | null; // ✅ Direct parent reference!
  agentToolUseId?: string; // ✅ Links to Task tool_use!
  agentType?: string; // ✅ workflow-orchestrator, etc.
  role: 'user' | 'assistant';
  content: ContentBlock[];
  timestamp: number;
  model: string;
  tokens?: { input: number; output: number };
  cost?: number;

  // UI-specific metadata (impossible with CLI!)
  ui?: {
    isCollapsed: boolean;
    isPinned: boolean;
    tags: string[];
    userNotes: string;
  };
}
```

**Storage**: VS Code workspace state (JSON array), easily queryable

**Benefits**:

- ✅ Tree structure explicit (no guessing!)
- ✅ Agent type known immediately
- ✅ Cost tracking built-in
- ✅ UI metadata persistent
- ✅ No JSONL parsing overhead

---

## 🚀 Migration Plan (3-Week Timeline)

### **Week 1: POC + Core Implementation**

**Day 1-3: Proof of Concept**

- Install SDK: `npm install @anthropic-ai/claude-agent-sdk`
- Create `SdkAgentAdapter` class
- Implement basic message streaming
- Test: "Hello Claude" → response works ✅
- Test: Ask Claude to read a file → tool execution works ✅
- Test: Store conversation in custom format → reload works ✅

**Success Criteria**:

- SDK processes basic queries
- Tool execution (Read) works
- Storage/replay works with NO correlation bugs

**Day 4-5: Tool Integration**

- Implement all VS Code tools (Read, Write, Edit, Glob, Grep, Bash)
- Port tool handlers from CLI adapter
- Test each tool individually

**Day 6-7: Agent Spawning**

- Implement Task tool (agent spawning)
- Store parent-child relationships explicitly
- Test: Spawn workflow-orchestrator agent → verify parent link ✅

### **Week 2: Feature Completion**

**Day 8-9: Session Management**

- Implement session storage (workspace state)
- Session list, load, delete, export
- Migration tool (convert old CLI sessions - optional)

**Day 10-11: Permission System**

- Implement `canUseTool` callbacks
- Permission UI (reuse existing webview components)
- Test all permission modes

**Day 12-13: Streaming & Error Handling**

- Streaming message processing
- Error handling & retry logic
- Cost tracking & token usage

**Day 14: Integration Testing**

- End-to-end tests
- Agent spawning tests
- Multi-turn conversation tests

### **Week 3: Deprecation & Polish**

**Day 15-16: Remove CLI Code**

- Delete `ClaudeCliAdapter`
- Delete `SessionReplayService` correlation logic
- Delete JSONL parsing code
- Remove CLI process spawning

**Day 17-18: Optimization**

- Performance tuning
- Memory optimization
- Message streaming pipeline

**Day 19-20: Documentation & Migration Guide**

- Update user documentation
- Write migration guide
- Update developer docs

**Day 21: Final Testing & Deployment**

- QA testing
- User acceptance testing
- Deploy to production

---

## 🎯 Success Criteria

### Must Have

- ✅ SDK adapter handles all message types
- ✅ All tools implemented (Read, Write, Edit, Glob, Grep, Bash, Task)
- ✅ Agent spawning with explicit parent-child links
- ✅ Session storage in custom format
- ✅ Permission system via callbacks
- ✅ Streaming support
- ✅ Cost tracking & token usage
- ✅ NO correlation bugs (parent-child explicit!)
- ✅ CLI code completely removed

### Nice to Have (Post-MVP)

- 🔮 Session forking UI
- 🔮 Structured outputs (Zod schemas)
- 🔮 Custom VS Code tools (LSP, editor context, git info)
- 🔮 UI metadata (tags, notes, highlights)
- 🔮 Session search & filtering

---

## 🔗 Dependencies

**NPM Packages**:

- `@anthropic-ai/claude-agent-sdk` - Agent SDK
- `zod` - Schema validation (for structured outputs later)

**VS Code APIs**:

- `vscode.workspace.fs` - File operations
- `vscode.workspace.state` - Session storage
- `vscode.window.activeTextEditor` - Editor context

**Internal Dependencies**:

- `libs/backend/claude-domain` - `IAgentProvider` interface (no changes!)
- `libs/shared` - Message types (already provider-agnostic!)
- `libs/frontend/chat` - UI components (no changes!)

**Key Insight**: ExecutionNode abstraction means ZERO UI changes required!

---

## 📁 Files to Create/Modify

### New Files

```
libs/backend/claude-domain/src/sdk/
  ├─ sdk-agent-adapter.ts          # Main SDK adapter
  ├─ sdk-session-manager.ts        # Session storage
  ├─ sdk-tools.ts                  # Tool implementations
  └─ sdk-auth.ts                   # Dual auth support

libs/backend/claude-domain/src/storage/
  └─ session-storage.service.ts    # Custom storage format
```

### Modified Files

```
apps/ptah-extension-vscode/package.json
  • Add SDK dependency
  • Add VS Code settings:
    - ptah.anthropicApiKey
    - ptah.claudeOAuthToken

libs/backend/claude-domain/src/services/agent-provider.factory.ts
  • Replace CLI adapter with SDK adapter

apps/ptah-extension-vscode/src/extension.ts
  • Remove CLI process management
  • Initialize SDK adapter
```

### Deleted Files

```
libs/backend/claude-domain/src/cli/
  └─ claude-cli-adapter.ts         # DELETE (replaced by SDK)

libs/frontend/chat/src/lib/services/
  └─ session-replay.service.ts     # DELETE (no correlation needed!)
```

---

## 📌 Key Constraints

1. **Zero UI Changes**: ExecutionNode abstraction works for SDK (already proven)
2. **Dual Auth Support**: API key OR OAuth token
3. **Performance**: Must be faster than CLI (target: <200ms response time)
4. **Data Migration**: Optional tool to convert old CLI sessions
5. **No Dual Mode**: SDK-only, no CLI fallback (simplicity over complexity)

---

## 🎯 Risk Mitigation

**Risk**: What if SDK has unknown issues?
**Mitigation**: 3-day POC validates core functionality before full migration

**Risk**: What if users have old CLI sessions?
**Mitigation**: Optional migration tool, clear user communication

**Risk**: What if performance is worse than expected?
**Mitigation**: POC measures real-world latency before proceeding

**Risk**: What if we miss important CLI features?
**Mitigation**: Research report documents all SDK capabilities (comprehensive)

---

## 📊 Expected Outcomes

**Performance**:

- ✅ 10x faster session start (50ms vs 500ms)
- ✅ 30-50% lower tool execution overhead
- ✅ 5x lower memory per session

**Reliability**:

- ✅ ZERO correlation bugs (explicit parent-child)
- ✅ NO slug filtering issues
- ✅ NO timestamp matching failures

**Maintainability**:

- ✅ 50% less code (single adapter vs dual-mode)
- ✅ Simpler architecture (no CLI process management)
- ✅ Better debuggability (our code, not black box)

**User Experience**:

- ✅ Faster responses
- ✅ More reliable agent nesting
- ✅ Future: Custom UI features (tags, notes, search)

---

## 🎯 Next Steps

1. **Immediate**: Start 3-day POC (validate SDK approach)
2. **Week 1**: Core SDK implementation
3. **Week 2**: Feature completion
4. **Week 3**: Deprecation & polish
5. **Deployment**: Production rollout with user communication

**Go/No-Go Decision**: After Day 3 POC completion

- If POC succeeds → Proceed with full migration
- If POC fails → Re-evaluate (90% confidence in success)
