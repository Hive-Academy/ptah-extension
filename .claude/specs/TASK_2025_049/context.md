# TASK_2025_049: SDK Integration Review & Critical Fixes

## Context

TASK_2025_044 implemented a new `agent-sdk` library wrapping the official Claude Agent SDK. However, after code review, critical issues were identified that indicate we may have incorrectly mapped our backend to the frontend's ExecutionNode tree rather than properly understanding the SDK's message model.

## Problems Identified

### Critical Implementation Gaps

1. **Multi-Turn Conversation Broken**: `sendMessageToSession()` stores messages but never sends them to SDK
2. **Role Assignment Bug**: All messages marked as 'assistant' regardless of actual role
3. **SDK Message Model Misunderstanding**: We're force-fitting SDK messages into our ExecutionNode model instead of finding proper mapping
4. **Streaming Input Mode Not Used**: SDK supports `AsyncIterable<SDKUserMessage>` for continuous conversation but we're not using it

### Key SDK Features We May Be Missing

From `claude-agent-sdk.md`:

1. **Prompt can be AsyncIterable** (line 20):

   ```typescript
   function query({
     prompt,
     options,
   }: {
     prompt: string | AsyncIterable<SDKUserMessage>; // We're not using AsyncIterable
     options?: Options;
   }): Query;
   ```

2. **Resume/Fork Sessions** (lines 103-104):

   ```typescript
   resume: string; // Session ID to resume
   forkSession: boolean; // Fork to new session ID
   ```

3. **SDK Message Types** (lines 387-529):

   - `SDKAssistantMessage` - has `parent_tool_use_id` for linking
   - `SDKUserMessage` - has `parent_tool_use_id`
   - `SDKResultMessage` - final result with usage stats
   - `SDKSystemMessage` - init message with session_id
   - `SDKPartialAssistantMessage` - streaming partial messages

4. **Tool Types Already Defined** (lines 794-1186):

   - All tool input/output types are documented
   - We should use these, not reinvent them

5. **Query Object Methods** (lines 117-140):
   - `interrupt()` - interrupt streaming input mode
   - `setPermissionMode()` - change permission mode mid-session
   - These are only available in streaming input mode!

## Root Cause Analysis

We tried to map SDK messages directly to our `ExecutionNode` tree without considering:

1. **SDK's parent_tool_use_id** is the native way to link messages - we should USE this directly
2. **Session management is built into SDK** via `resume` option - we don't need custom storage format
3. **Streaming input mode** (`AsyncIterable<SDKUserMessage>`) is required for multi-turn - we're not using it
4. **SDK provides its own message hierarchy** - we should adapt our UI to it, not force-fit

## Goal

Systematically review and fix the agent-sdk implementation to:

1. **Properly use SDK features** rather than reinventing them
2. **Map SDK messages to ExecutionNode** without losing SDK capabilities
3. **Implement streaming input mode** for multi-turn conversation
4. **Use SDK's native session management** (resume, fork)
5. **Preserve all SDK metadata** (parent_tool_use_id, usage, cost)

## Files to Review/Fix

### Core Implementation

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`
- `libs/backend/agent-sdk/src/lib/sdk-session-storage.ts`
- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`

### Reference

- `task-tracking/TASK_2025_044/claude-agent-sdk.md` - Official SDK documentation
- `task-tracking/TASK_2025_044/implementation-plan.md` - Original plan (may need revision)

## Success Criteria

- [ ] Multi-turn conversation works (streaming input mode)
- [ ] SDK's parent_tool_use_id used for message linking
- [ ] Session resume/fork works via SDK options
- [ ] All SDK message types properly transformed to ExecutionNode
- [ ] Role assignment correct (user, assistant, system)
- [ ] Usage stats (tokens, cost) preserved and displayed
- [ ] No silent failures or data loss
- [ ] Existing UI continues to work (ExecutionNode compatibility)
