# TASK_2025_109: Streamlined Subagent Resumption via Context Injection

## Task Overview

**Objective**: Simplify subagent resumption by injecting interrupted subagent context into parent session messages instead of maintaining separate Resume UI and RPC infrastructure.

**Created**: 2026-01-20
**Status**: Planning
**Owner**: orchestrator

## Background & Rationale

### Current Implementation (Path B - Complex)

When a parent session is interrupted with running subagents:

1. Backend marks subagents as `interrupted` in SubagentRegistry
2. `chat:resume` RPC returns `resumableSubagents[]` to frontend
3. Frontend marks agent nodes with "Resume" button
4. User clicks Resume → `chat:subagent-resume` RPC → SDK direct resume
5. Complex streaming orchestration via `streamSubagentEventsToWebview()`

**Problems**:

- When user simply clicks "Continue" on parent session, Claude doesn't know about interrupted subagents
- Claude starts fresh subagent instead of resuming existing one
- ~432 lines of dedicated resume infrastructure to maintain

### Proposed Implementation (Path A - Streamlined)

When parent session resumes with interrupted subagents:

1. Backend queries `SubagentRegistry.getResumableBySession()`
2. Inject context into message: `"[System: Interrupted agents: agentId: abc123 (Explore)]"`
3. Claude naturally sees this and can say "Resume agent abc123"
4. Normal conversation flow handles everything

**Benefits**:

- Natural conversational UX ("resume the explore agent")
- ~432 lines of code removed
- Simpler architecture
- Claude's intelligence decides how to resume

## SDK Support Verification

From official SDK docs (https://platform.claude.com/docs/en/agent-sdk/subagents#resuming-subagents):

```typescript
// SDK supports resume via parent session with message
for await (const message of query({
  prompt: `Resume agent ${agentId} and list the top 3 most complex endpoints`,
  options: {
    allowedTools: ['Read', 'Grep', 'Glob', 'Task'],
    resume: sessionId  // Resume PARENT session
  }
})) {
```

The SDK pattern is:

1. Resume the **parent session** (not subagent directly)
2. Send a prompt mentioning the agent ID
3. Claude handles resumption naturally

## Files to Modify/Remove

### PHASE 1: Add Context Injection (New Code)

**Target**: Inject interrupted subagent info when parent session continues

| File                                                                        | Change                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-message-factory.ts`             | Add method to create system context with interrupted agents |
| `libs/backend/agent-sdk/src/lib/lifecycle/session-lifecycle-manager.ts`     | Query interrupted subagents and inject context              |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` | Pass interrupted subagent context to message creation       |

### PHASE 2: Remove Deprecated Code (~432 lines)

#### Backend Files

| File                                                                            | Action                                                               | Lines |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----- |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/subagent-rpc.handlers.ts` | Remove `registerSubagentResume()`, `streamSubagentEventsToWebview()` | ~215  |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                           | Remove `resumeSubagent()` method                                     | ~60   |
| `libs/shared/src/lib/types/subagent-registry.types.ts`                          | Remove `SubagentResumeParams`, `SubagentResumeResult`                | ~15   |
| `libs/shared/src/lib/types/rpc.types.ts`                                        | Remove from `RpcMethodRegistry` and `RPC_METHOD_NAMES`               | ~5    |

#### Frontend Files

| File                                                                                      | Action                                                                 | Lines |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----- |
| `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.ts`        | Remove Resume button, `isResumable()`, `onResumeClick()`, `isResuming` | ~30   |
| `libs/frontend/chat/src/lib/components/molecules/resume-notification-banner.component.ts` | **DELETE ENTIRE FILE**                                                 | ~142  |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                                       | Remove `handleSubagentResume()`                                        | ~25   |
| `libs/frontend/chat/src/lib/components/organisms/execution-node.component.ts`             | Remove `resumeRequested` output                                        | ~5    |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`                  | Remove resume event handler                                            | ~5    |
| `libs/frontend/core/src/lib/services/claude-rpc.service.ts`                               | Remove `resumeSubagent()` wrapper                                      | ~10   |

### PHASE 3: Cleanup Exports

| File                                             | Action                                                        |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `libs/frontend/chat/src/lib/components/index.ts` | Remove `ResumeNotificationBannerComponent` export             |
| `libs/frontend/chat/src/index.ts`                | Remove banner export                                          |
| `libs/backend/agent-sdk/src/index.ts`            | Remove `SubagentResumeParams`, `SubagentResumeResult` exports |
| `libs/shared/src/index.ts`                       | Remove resume type exports                                    |

## Code That STAYS (Repurposed)

| Component                                  | Previous Purpose       | New Purpose                    |
| ------------------------------------------ | ---------------------- | ------------------------------ |
| `SubagentRegistry`                         | State for Resume RPC   | Context injection queries      |
| `getResumableBySession()`                  | Query for Resume UI    | Query for context injection    |
| `markAllInterrupted()`                     | Session abort handling | Session abort (unchanged)      |
| `status: 'interrupted'`                    | Trigger Resume button  | Show "Stopped" badge only      |
| `resumableSubagents` in `ChatResumeResult` | Populate Resume UI     | Mark nodes in UI (visual only) |

## Implementation Strategy

### Context Injection Format

When parent session continues and has interrupted subagents:

```typescript
const interruptedContext = resumableSubagents.map((s) => `agentId: ${s.agentId} (${s.agentType})`).join(', ');

const systemContext = `[System: Previously interrupted agents available for resumption: ${interruptedContext}. You can resume them by including their agentId in your response.]`;

// Prepend to user's message or inject as system message
```

### Integration Points

1. **On `chat:continue` RPC**: Check for interrupted subagents, inject context
2. **On session resume**: Same check and injection
3. **Keep UI status**: Still show "Stopped" badge on interrupted agents (visual feedback)

## Testing Requirements

1. **Context Injection**: Verify interrupted agent info appears in Claude's context
2. **Natural Resume**: Claude correctly resumes when user says "continue the explore agent"
3. **Multiple Agents**: Handle multiple interrupted agents in context
4. **Clean State**: After agent completes, it's removed from interrupted list
5. **UI Badge**: "Stopped" badge still appears on interrupted agent nodes

## Success Criteria

- [ ] Parent session resume includes interrupted subagent context
- [ ] Claude can naturally resume interrupted agents via conversation
- [ ] ~432 lines of resume infrastructure removed
- [ ] No `chat:subagent-resume` RPC
- [ ] No Resume button in UI
- [ ] "Stopped" badge still displays for visual feedback
- [ ] All existing functionality preserved

## Related Tasks

- **TASK_2025_103**: Original subagent resumption implementation (being streamlined)
- **TASK_2025_082**: SDK streaming architecture (foundation)
- **TASK_2025_089**: Session resume flow fix

## Research Sources

- SDK Docs: https://platform.claude.com/docs/en/agent-sdk/subagents#resuming-subagents
- Codebase investigation: Agent IDs a9e0079, a2aa29f, adef348
