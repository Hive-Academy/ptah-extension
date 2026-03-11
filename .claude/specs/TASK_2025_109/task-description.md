# Task Description: Streamlined Subagent Resumption via Context Injection

## Summary

Replace the complex subagent resume infrastructure (dedicated RPC, UI buttons, streaming handlers) with a simple context injection approach that lets Claude naturally resume interrupted subagents through conversation.

## Requirements

### Functional Requirements

1. **FR-1: Context Injection on Parent Resume**

   - When a parent session resumes or continues with interrupted subagents
   - Inject system context listing interrupted agents with their IDs and types
   - Format: `[System: Interrupted agents available: agentId: abc123 (Explore), agentId: def456 (Plan)]`

2. **FR-2: Natural Conversation Resume**

   - Claude sees interrupted agent context and can naturally generate "Resume agent {agentId}"
   - User can also explicitly say "resume the explore agent" or "continue all interrupted work"
   - No special RPC or UI interaction required

3. **FR-3: Visual Status Preservation**

   - Keep "Stopped" badge on interrupted agent nodes in UI
   - Remove Resume button (no action needed)
   - Users see which agents were interrupted for context

4. **FR-4: Deprecate Resume Infrastructure**
   - Remove `chat:subagent-resume` RPC method and handler
   - Remove `resumeSubagent()` SDK adapter method
   - Remove Resume button from `inline-agent-bubble.component.ts`
   - Delete `resume-notification-banner.component.ts` entirely
   - Remove related types and exports

### Non-Functional Requirements

1. **NFR-1: Code Reduction**

   - Target: ~432 lines of code removed
   - Simpler architecture with fewer moving parts

2. **NFR-2: Backward Compatibility**

   - Existing session history should display correctly
   - Interrupted status marking still works

3. **NFR-3: Performance**
   - Context injection should be lightweight
   - No additional RPC calls needed for resume

## Acceptance Criteria

- [ ] AC-1: When parent session continues, Claude receives interrupted subagent context
- [ ] AC-2: Claude can resume interrupted subagents through natural conversation
- [ ] AC-3: "Stopped" badge appears on interrupted agent nodes (visual only)
- [ ] AC-4: No Resume button in UI
- [ ] AC-5: `chat:subagent-resume` RPC removed from codebase
- [ ] AC-6: `ResumeNotificationBannerComponent` file deleted
- [ ] AC-7: All tests pass after changes
- [ ] AC-8: Linting and type checking pass

## Out of Scope

- Modifying subagent tracking/registration logic
- Changing how subagents are marked as interrupted
- Multi-agent parallel resume optimization

## Technical Approach

### Phase 1: Add Context Injection

1. In `SessionLifecycleManager` or `chat:continue` handler:

   - Query `SubagentRegistry.getResumableBySession(parentSessionId)`
   - If interrupted subagents exist, create context string
   - Inject into message context before sending to SDK

2. Context injection point options:
   - Option A: Prepend to user message content
   - Option B: Add as system reminder in prompt
   - Option C: Use SDK's context mechanism if available

### Phase 2: Remove Deprecated Code

1. Backend removal (~280 lines):

   - `subagent-rpc.handlers.ts`: Remove 2 methods
   - `sdk-agent-adapter.ts`: Remove `resumeSubagent()`
   - Type definitions: Remove 2 interfaces

2. Frontend removal (~150 lines):
   - `inline-agent-bubble.component.ts`: Remove Resume UI
   - `resume-notification-banner.component.ts`: Delete file
   - `chat.store.ts`: Remove handler
   - `execution-node.component.ts`: Remove output

### Phase 3: Cleanup

1. Remove exports from index files
2. Remove from RPC registry
3. Update any tests referencing removed code

## Dependencies

- SubagentRegistry must continue tracking interrupted subagents
- `getResumableBySession()` method must remain available
- Session lifecycle management unchanged

## Risks & Mitigations

| Risk                                | Impact | Mitigation                                                |
| ----------------------------------- | ------ | --------------------------------------------------------- |
| Claude doesn't resume automatically | Medium | Clear context format, can also use explicit user commands |
| Context bloat with many agents      | Low    | Limit context to last N interrupted agents                |
| Regression in history display       | Medium | Keep status marking, only remove Resume button            |
