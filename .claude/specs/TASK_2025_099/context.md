# Task Context - TASK_2025_099

## User Intent

Implement real-time subagent text streaming by wiring up the existing AgentSessionWatcherService with SDK hooks. Key requirements:

1. **SDK Hooks Integration**: Use `SubagentStart` and `SubagentStop` hooks for lifecycle management
2. **Multiple Parallel Subagents**: Support 3-5+ concurrent subagents without hardcoded limits
3. **Early Detection**: Catch subagent sessions BEFORE `transcript_path` is available (at `SubagentStart`, not `SubagentStop`)
4. **Main↔Subagent Linking**: Properly correlate parent Task tool calls with subagent sessions
5. **Real-time Text**: Stream text content from agent JSONL files to UI during execution

## Prior Investigation Summary

### Root Cause Analysis (from conversation)

- **SDK Limitation Confirmed**: Claude Agent SDK does NOT stream `text_delta` for subagents
- **Physical Evidence**: 100% of subagent messages contain only `tool_use` blocks, zero text blocks
- **GitHub Issue #164**: "TextBlock content only delivered once fully available"

### Existing Infrastructure (90% complete)

1. **AgentSessionWatcherService** (`libs/backend/vscode-core/src/services/agent-session-watcher.service.ts`)

   - Watches `~/.claude/projects/{path}/agent-*.jsonl` files
   - Tails files with 200ms polling
   - Extracts text blocks from JSONL
   - Emits `summary-chunk` events

2. **Event Handling** (`apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`)

   - Listens to `summary-chunk` events
   - Sends `MESSAGE_TYPES.AGENT_SUMMARY_CHUNK` to webview

3. **Frontend Handler** (`libs/frontend/core/src/lib/services/vscode.service.ts`)
   - Handles `AGENT_SUMMARY_CHUNK` message type

### Missing Integration

- **Nobody calls `startWatching()`** - The watcher is never activated!
- Need to integrate SDK hooks (`SubagentStart`/`SubagentStop`) to trigger the watcher

## SDK Hooks Available (TypeScript)

```typescript
// SubagentStart - fires when subagent initializes
{
  agent_id: string,           // Unique subagent ID
  agent_type: string,         // e.g., "software-architect"
  session_id: string,
  hook_event_name: 'SubagentStart'
}

// SubagentStop - fires when subagent completes
{
  agent_transcript_path: string,  // Path to JSONL (available at completion)
  tool_use_id: string,            // Links to parent Task tool
  stop_hook_active: boolean,
  hook_event_name: 'SubagentStop'
}
```

## Technical Challenges

1. **Early Detection Problem**: `transcript_path` only available at `SubagentStop`, but we need to start watching at `SubagentStart`

   - Solution: Use path pattern matching (`agent-{agent_id}.jsonl`)

2. **Multiple Parallel Agents**: Map structure to track N concurrent agents

   - Solution: Already supported via `Map<string, ActiveWatch>` in AgentSessionWatcherService

3. **Correlation**: Link subagent to correct parent Task tool
   - Solution: Use `tool_use_id` from `SubagentStop` and match during session

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-30
- Type: FEATURE
- Complexity: Medium

## Execution Strategy

FEATURE workflow: PM → Architect → Team-Leader (3 modes) → QA

## Related Tasks

- TASK_2025_096: Streaming multi-message fix (completed)
- TASK_2025_097: Permission system UX (in progress)
- TASK_2025_082: SDK streaming architecture (completed)
