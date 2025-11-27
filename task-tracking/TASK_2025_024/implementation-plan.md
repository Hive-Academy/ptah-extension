# TASK_2025_024: Streaming & Session Enhancement Implementation Plan

## Overview

This plan addresses two remaining items for complete JSONL message handling in Ptah:
1. Real-time agent session file watching
2. Agent summary content integration

**Note**: Live permission grant UI has been descoped - current "grant in terminal" approach is sufficient.

---

## Background: Claude Code Tools Reference

### All Tools Available

| Tool | Input Parameters | Output | Used For |
|------|------------------|--------|----------|
| **Read** | `file_path`, `limit?`, `offset?` | File contents with line numbers | Reading files |
| **Write** | `file_path`, `content` | Success/failure | Creating/modifying files |
| **Edit** | `file_path`, `old_string`, `new_string`, `replace_all?` | Diff preview | Precise edits |
| **Bash** | `command`, `description?`, `timeout?`, `run_in_background?` | Command output | Running commands |
| **Glob** | `pattern`, `path?` | Array of file paths | Finding files |
| **Grep** | `pattern`, `path?`, `type?`, `glob?`, `output_mode?`, etc. | Search results | Searching content |
| **Task** | `description`, `prompt`, `subagent_type`, `model?` | Agent result | Spawning sub-agents |
| **WebFetch** | `url`, `prompt` | Extracted content | Fetching URLs |
| **WebSearch** | `query`, `allowed_domains?`, `blocked_domains?` | Search results | Web search |

### JSONL Message Types

| Type | Subtype | Content Blocks | What It Contains |
|------|---------|----------------|------------------|
| `system` | `init` | - | Session initialization |
| `assistant` | - | `text`, `tool_use` | Claude's response, tool calls |
| `user` | - | `tool_result` | Tool outputs, permission errors |
| `tool` | `start`/`result` | - | Tool execution (rarely seen in streaming) |
| `result` | `success`/`error` | - | Stream completion |

### Content Block Types

| Block Type | Found In | Fields | Purpose |
|------------|----------|--------|---------|
| `text` | `assistant.message.content[]` | `text` | Plain text response |
| `tool_use` | `assistant.message.content[]` | `id`, `name`, `input` | Tool invocation |
| `tool_result` | `user.message.content[]` | `tool_use_id`, `content`, `is_error` | Tool output |

### Error Types (Currently Handled)

| Error Pattern | `is_error` | Detection | UI Treatment |
|---------------|------------|-----------|--------------|
| Permission denied | `true` | `content.includes("permission")` | Warning badge, special message |
| File system error | `true` | Not permission | Error badge, error message |
| Success | `false`/`undefined` | - | Success badge, output display |

---

## Current State (Already Implemented)

### What We Handle Now

1. **Tool calls** (`assistant` → `tool_use`) - Creates pending tool nodes
2. **Tool results** (`user` → `tool_result`) - Updates tool with output
3. **Permission requests** - Shows warning UI instead of generic error
4. **Nested agent messages** - Routes to parent agent via `parent_tool_use_id`
5. **Streaming text** - Appends deltas to current text node
6. **Agent spawning** - Creates agent nodes from Task tool
7. **Interrupted agents** - Shows "interrupted" state for historical sessions without data

### Key Files Modified

- `libs/frontend/chat/src/lib/services/jsonl-processor.service.ts` - Added `handleUserMessage()` for tool_result
- `libs/frontend/chat/src/lib/components/molecules/tool-call-item.component.ts` - Added permission UI
- `libs/shared/src/lib/types/execution-node.types.ts` - Added `isPermissionRequest` field
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` - Added streaming message display

---

## Item 1: Real-time Agent Session File Watching

### Problem Statement

When a Task tool spawns an agent, Claude CLI creates a new session file:
- Location: `~/.claude/projects/{project-hash}/sessions/agent-{8-char-id}.jsonl`
- The main session only receives the final `tool_result` when the agent completes
- During execution, the agent's tools/progress are NOT visible in the main stream

### Architecture Decision

**Option A: Backend File Watcher** (Recommended)
- VS Code extension watches for new `agent-*.jsonl` files
- Parses and streams chunks to webview via existing `chat:chunk` message
- Links to parent via `parent_tool_use_id` from the Task tool

**Option B: Periodic Polling**
- Webview requests agent session content periodically
- Less efficient, more latency

### Implementation Plan (Option A)

#### Step 1: Create AgentSessionWatcher Service (Backend)

**File:** `libs/backend/claude-domain/src/services/agent-session-watcher.service.ts`

```typescript
import { injectable, inject } from 'inversify';
import { TOKENS } from '@ptah-extension/vscode-core';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

@injectable()
export class AgentSessionWatcherService {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private filePositions: Map<string, number> = new Map(); // Track read position

  constructor(
    @inject(TOKENS.Logger) private logger: Logger,
    @inject(TOKENS.EventBus) private eventBus: EventBus,
  ) {}

  /**
   * Start watching for agent session files in a project's sessions directory
   */
  watchProject(projectSessionsPath: string): void {
    // Watch directory for new agent-*.jsonl files
    const watcher = fs.watch(projectSessionsPath, (eventType, filename) => {
      if (filename?.startsWith('agent-') && filename.endsWith('.jsonl')) {
        this.handleAgentFile(path.join(projectSessionsPath, filename));
      }
    });

    this.watchers.set(projectSessionsPath, watcher);
  }

  /**
   * Handle new/updated agent session file
   */
  private handleAgentFile(filePath: string): void {
    const currentPos = this.filePositions.get(filePath) || 0;

    // Read new content from last position
    const fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);

    if (stats.size > currentPos) {
      const buffer = Buffer.alloc(stats.size - currentPos);
      fs.readSync(fd, buffer, 0, buffer.length, currentPos);

      const newContent = buffer.toString('utf8');
      const lines = newContent.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const chunk = JSON.parse(line);
          // Emit chunk via EventBus for WebviewManager to forward
          this.eventBus.emit('agent:chunk', { filePath, chunk });
        } catch (e) {
          this.logger.warn('Failed to parse agent JSONL line', e);
        }
      }

      this.filePositions.set(filePath, stats.size);
    }

    fs.closeSync(fd);
  }

  /**
   * Link agent file to parent Task tool
   */
  linkAgentToTask(agentId: string, taskToolUseId: string): void {
    // Store mapping so chunks can be routed correctly
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }
}
```

#### Step 2: Register Agent When Task Tool Starts

**File:** `libs/backend/claude-domain/src/cli/jsonl-stream-handler.ts`

When we see a Task tool_use, extract the `id` and watch for corresponding agent file:

```typescript
// In handleToolUse for Task tool
if (toolName === 'Task' && toolUseId) {
  // Agent files are named agent-{first-8-chars-of-uuid}.jsonl
  // But we don't know the agent's internal ID yet
  // We need to watch for NEW files and match by timing/content
  this.agentWatcher.watchForNewAgent(toolUseId);
}
```

#### Step 3: Forward Agent Chunks to Webview

**File:** `libs/backend/vscode-core/src/webview/webview-manager.ts`

Subscribe to `agent:chunk` events and forward:

```typescript
this.eventBus.on('agent:chunk', ({ filePath, chunk }) => {
  // Add parent_tool_use_id based on our tracking
  const linkedTaskId = this.agentWatcher.getTaskIdForAgent(filePath);

  this.postMessage({
    type: 'chat:chunk',
    sessionId: chunk.sessionId,
    message: {
      ...chunk,
      parent_tool_use_id: linkedTaskId,
    },
  });
});
```

#### Step 4: Process Agent Chunks in Frontend

The existing `JsonlMessageProcessor.handleNestedAssistantMessage()` and `handleUserMessage()` will handle these chunks since they include `parent_tool_use_id`.

### Challenges

1. **Matching agent file to Task tool**: Agent files are named `agent-{8-char-id}.jsonl` but the ID is internal. Options:
   - Watch for new files created after Task tool starts
   - Parse first line of new agent file which contains `agentId` field
   - Match by timing (file created within 100ms of Task tool)

2. **File locking on Windows**: May need to use polling instead of fs.watch

3. **Performance**: Don't want to continuously poll. Use fs.watch events.

---

## Item 2: Agent Summary Content Integration

### Problem Statement

Agent summaries come from **separate "summary session" files**:
- Main agent file: `agent-{id}.jsonl` - Contains actual execution (tools, results)
- Summary session: Created by Claude CLI for progress reporting
- Summary contains XML-like tags: `<function_calls>`, `<thinking>`, etc.

### Current State

- `AgentInfo.summaryContent` field exists but only populated during `session:load`
- During streaming, no summary is available until agent completes
- `SessionReplayService` loads summaries from history files

### Implementation Plan

#### Option A: Real-time Summary (Complex)

Summary sessions are also written to `.jsonl` files. We could:
1. Watch for summary session files (different naming pattern)
2. Parse and update `AgentInfo.summaryContent` in real-time
3. Trigger UI updates via signal

**Challenge**: Identifying which file is the summary vs execution session.

#### Option B: Post-Completion Summary (Simpler)

1. When agent completes (via `tool_result` for Task tool), trigger summary fetch
2. Call `session:load` for the agent's session
3. Extract summary content and update the agent node

**Implementation:**

```typescript
// In JsonlMessageProcessor or ChatStore
handleTaskToolResult(taskToolUseId: string, result: unknown): void {
  // Agent completed - now fetch full session data including summary
  this.rpcService.call('session:load', {
    sessionId: this.getAgentSessionId(taskToolUseId)
  }).then(response => {
    // Extract summary from response
    const summary = this.extractAgentSummary(response.data);

    // Update agent node with summary
    this.updateAgentSummary(taskToolUseId, summary);
  });
}
```

#### Option C: Hybrid Approach (Recommended)

1. During streaming: Show "Agent executing..." without summary
2. When agent completes: Fetch and display full summary
3. For history: Load summary as we do now

This matches user expectations - summary is a recap, not real-time.

---

## File Structure Summary

### New Files to Create

```
libs/backend/claude-domain/src/services/
  agent-session-watcher.service.ts    # File watcher for agent sessions

libs/backend/claude-domain/src/index.ts
  # Export AgentSessionWatcherService
```

### Files to Modify

```
libs/backend/vscode-core/src/di/tokens.ts
  # Add AgentSessionWatcher token

libs/backend/vscode-core/src/di/container.ts
  # Register AgentSessionWatcherService

libs/backend/claude-domain/src/cli/jsonl-stream-handler.ts
  # Start watching when Task tool detected

libs/backend/vscode-core/src/webview/webview-manager.ts
  # Forward agent:chunk events to webview

libs/frontend/chat/src/lib/services/chat.store.ts
  # Handle agent completion → fetch summary
```

---

## Testing Strategy

### Unit Tests

1. `AgentSessionWatcherService`
   - Test file watching triggers on new files
   - Test incremental reading (position tracking)
   - Test JSONL parsing with malformed input

2. `JsonlMessageProcessor`
   - Test agent chunks route to correct parent
   - Test summary update flow

### Integration Tests

1. Create mock agent session file
2. Verify watcher detects and parses
3. Verify chunks appear in UI under correct agent

### Manual Testing

1. Start Ptah extension in debug mode
2. Ask Claude to spawn a Task agent (e.g., "use Explore agent to find all TypeScript files")
3. Verify:
   - Agent card appears immediately when Task tool starts
   - Nested tool calls appear in real-time
   - Summary appears when agent completes

---

## Priority & Effort Estimates

| Item | Priority | Effort | Dependencies |
|------|----------|--------|--------------|
| 1. Agent Session Watching | High | 3-4 days | None |
| 2. Summary Integration | Medium | 1-2 days | Item 1 (or standalone for Option C) |

---

## Definition of Done

### Item 1: Real-time Agent Session Watching
- [ ] AgentSessionWatcherService created and registered
- [ ] File watcher correctly detects new agent-*.jsonl files
- [ ] Incremental reading works (no duplicate chunks)
- [ ] Chunks forwarded to webview with correct parent_tool_use_id
- [ ] Frontend displays nested tools in real-time
- [ ] Unit tests pass
- [ ] Manual testing confirms real-time updates

### Item 2: Summary Integration
- [ ] Summary content loads when agent completes
- [ ] Summary section renders in AgentExecutionComponent
- [ ] Historical sessions continue to work
- [ ] No regression in streaming performance

---

## Appendix: JSONL File Examples

### Main Session File (parent)
```json
{"type":"user","message":{"content":"Analyze this codebase"},"sessionId":"abc123"}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_01XYZ","name":"Task","input":{"subagent_type":"Explore","description":"Analyze codebase","prompt":"..."}}]}}
// ... time passes while agent runs ...
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_01XYZ","content":"Analysis complete: ..."}]}}
```

### Agent Session File (agent-{id}.jsonl)
```json
{"agentId":"abc12345","isSidechain":true,"type":"assistant","message":{"content":[{"type":"text","text":"I'll analyze the codebase..."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_02ABC","name":"Glob","input":{"pattern":"**/*.ts"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_02ABC","content":"Found 150 files"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_02DEF","name":"Read","input":{"file_path":"/src/index.ts"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_02DEF","content":"// index.ts contents..."}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Based on my analysis, this is a TypeScript project..."}]}}
```

### Key Fields for Linking

| Field | Location | Purpose |
|-------|----------|---------|
| `tool_use.id` | Main session | ID of Task tool that spawned agent |
| `agentId` | First line of agent file | 8-char identifier for agent session |
| `parent_tool_use_id` | Agent messages during streaming | Links back to parent Task tool |
| `isSidechain` | Agent file | Indicates this is a sub-agent session |
