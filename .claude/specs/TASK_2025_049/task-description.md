# Requirements Document - TASK_2025_049

## Introduction

### Business Context

The Ptah extension implemented `libs/backend/agent-sdk` to integrate the official Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), replacing the CLI-based integration with in-process SDK communication. However, during code review of TASK_2025_048 Batch 1, critical architectural misunderstandings were discovered that prevent multi-turn conversation and misuse the SDK's native capabilities.

**Root Cause**: The implementation **incorrectly mapped our backend ExecutionNode tree architecture onto the SDK** rather than understanding and using the SDK's native message model and session management.

**Business Impact**:

- Multi-turn conversation is completely broken (users can only send one message per session)
- Message parent-child relationships use custom logic instead of SDK's native `parent_tool_use_id`
- SDK's streaming input mode (AsyncIterable) is not used, preventing continuous conversation
- Role assignment is hardcoded incorrectly (all messages marked as 'assistant')

### Value Proposition

Fix critical SDK integration bugs by:

1. Using SDK's native session management (resume, forkSession, continue options)
2. Using SDK's streaming input mode for multi-turn conversation
3. Preserving SDK's native parent linking via `parent_tool_use_id`
4. Implementing correct role assignment for messages
5. Exposing SDK capabilities (interrupt, setModel, setPermissionMode) to UI

**Success Metric**: Users can have continuous multi-turn conversations with Claude via the SDK, with proper message threading and full SDK feature access.

---

## SDK Architecture Analysis

### What the SDK Actually Provides

Based on comprehensive review of the 2029-line SDK documentation:

#### 1. Query Function - Two Modes of Operation

```typescript
function query({
  prompt: string | AsyncIterable<SDKUserMessage>,
  options?: Options
}): Query;
```

**String Mode** (currently using - incorrect for multi-turn):

- Single prompt string → SDK runs agent → returns result
- No way to send additional messages after initial prompt
- Session ends when result arrives

**Streaming Input Mode** (should be using):

- `AsyncIterable<SDKUserMessage>` → SDK continuously consumes user messages
- Agent responds to each message
- Session remains active until iterator completes
- **This is how multi-turn conversation works!**

#### 2. Session Management (Built into SDK)

SDK provides native session management via Options:

- `resume: string` - Resume existing session by session_id
- `forkSession: boolean` - Fork to new session_id instead of continuing
- `continue: boolean` - Continue most recent conversation

**Our Mistake**: We created SdkSessionStorage to manually track sessions, but SDK already handles this internally.

#### 3. Message Parent Linking (Native SDK Feature)

Every SDK message has `parent_tool_use_id` field:

```typescript
SDKAssistantMessage {
  parent_tool_use_id: string | null;  // SDK's native linking
}

SDKUserMessage {
  parent_tool_use_id: string | null;  // SDK's native linking
}
```

**Our Mistake**: We created custom `parentId` tracking in SdkSessionStorage instead of using SDK's native `parent_tool_use_id`.

#### 4. Dynamic Session Control (Only in Streaming Input Mode)

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>; // Stop agent mid-execution
  setPermissionMode(): Promise<void>; // Change autopilot mode
  setModel(): Promise<void>; // Switch Claude model
  setMaxThinkingTokens(): Promise<void>; // Adjust thinking budget
}
```

**Critical**: These methods are **ONLY available when using AsyncIterable<SDKUserMessage> input mode**!

#### 5. Usage Statistics and Cost Tracking (Automatic)

SDK automatically tracks and reports via SDKResultMessage:

```typescript
SDKResultMessage {
  total_cost_usd: number;
  usage: NonNullableUsage;
  modelUsage: { [modelName: string]: ModelUsage };
  duration_ms: number;
  num_turns: number;
}
```

**Our Mistake**: We created manual token/cost tracking in SdkSessionStorage, but SDK provides this automatically.

---

## Current Implementation Gaps

### Gap 1: Multi-Turn Conversation Broken

**Current Code** (sdk-agent-adapter.ts:224-254):

```typescript
const sdkQuery = query({
  prompt: '', // ❌ Empty string - no way to send messages!
  options: { ... }
});
```

**sendMessageToSession()** (lines 347-398):

```typescript
async sendMessageToSession(sessionId, content, options) {
  // ❌ Stores message but NEVER sends it to SDK!
  await this.storage.addMessage(sessionId, userMessage);

  // TODO: Implement streaming input mode for SDK
  // ❌ Not implemented - messages just sit in storage
}
```

**Result**: First message never sent, subsequent messages ignored. Multi-turn completely broken.

### Gap 2: Role Assignment Bug

**Current Code** (sdk-agent-adapter.ts:284):

```typescript
const storedMessage: StoredSessionMessage = {
  role: node.type === 'message' ? 'assistant' : 'assistant', // ❌ Always 'assistant'!
};
```

**Result**: All messages (including user messages) are marked as 'assistant' role.

### Gap 3: SDK's Streaming Input Mode Not Used

**Current Code**: Uses `prompt: ''` string mode
**Should Use**: `prompt: AsyncIterable<SDKUserMessage>` for continuous conversation

**Result**: Cannot send messages after session starts, cannot use interrupt/setModel/setPermissionMode.

### Gap 4: SDK's Native Parent Linking Ignored

**Current Code** (sdk-agent-adapter.ts:267-297):

```typescript
let currentParentId: MessageId | null = null;
// ... custom parent tracking logic
currentParentId = messageId; // ❌ Manual tracking
```

**SDK Provides** (every SDKMessage has `parent_tool_use_id`):

```typescript
sdkMessage.parent_tool_use_id; // ✅ Native linking
```

**Result**: Duplicate parent tracking, potential correlation bugs, ignoring SDK's built-in feature.

### Gap 5: SDK Session Management Not Used

**Current Code**:

- Created SdkSessionStorage (380 lines)
- Manual session persistence to VS Code state
- Custom compaction logic
- In-memory fallback

**SDK Provides**:

- Native session management via `resume`, `forkSession`, `continue` options
- Automatic session storage (where? needs investigation)

**Result**: Complex custom storage layer that duplicates SDK functionality.

---

## Correct Architecture

### Requirement 1: Multi-Turn Conversation via Streaming Input

**User Story**: As a user using the SDK-based provider, I want to send multiple messages in a conversation, so that I can have a continuous dialogue with Claude.

#### Acceptance Criteria

1. WHEN user starts a new session THEN create AsyncIterable<SDKUserMessage> generator
2. WHEN user sends first message THEN yield first SDKUserMessage to SDK via iterator
3. WHEN SDK responds THEN transform SDKAssistantMessage to ExecutionNode and yield to UI
4. WHEN user sends follow-up message THEN yield next SDKUserMessage to SDK via same iterator
5. WHEN SDK responds THEN transform next SDKAssistantMessage to ExecutionNode
6. WHEN error occurs in iterator THEN SDK receives completion, session ends gracefully

#### Implementation Approach

Replace string prompt with AsyncIterable generator:

```typescript
async startChatSession(sessionId, config) {
  // Create message queue for user input
  const messageQueue: SDKUserMessage[] = [];
  let resolveNext: (() => void) | null = null;

  // AsyncIterable generator that yields user messages
  const userMessageStream: AsyncIterable<SDKUserMessage> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        // Wait for next message to be queued
        if (messageQueue.length === 0) {
          await new Promise<void>(resolve => { resolveNext = resolve; });
        }

        const message = messageQueue.shift();
        if (!message) break;

        yield message;
      }
    }
  };

  const sdkQuery = query({
    prompt: userMessageStream, // ✅ Use streaming input mode
    options: { ... }
  });

  // Store queue for sendMessageToSession
  this.activeSessions.set(sessionId, {
    query: sdkQuery,
    messageQueue,
    resolveNext: () => resolveNext?.(),
  });
}

async sendMessageToSession(sessionId, content, options) {
  const session = this.activeSessions.get(sessionId);
  if (!session) throw new Error('Session not found');

  // Create SDKUserMessage
  const userMessage: SDKUserMessage = {
    type: 'user',
    uuid: MessageId.create().toString(),
    session_id: sessionId,
    message: {
      role: 'user',
      content: content,
    },
    parent_tool_use_id: null, // SDK will set this
  };

  // Queue message for iterator
  session.messageQueue.push(userMessage);
  session.resolveNext(); // Wake up iterator

  // ✅ Message is now sent to SDK!
}
```

---

### Requirement 2: Use SDK's Native Parent Linking

**User Story**: As a developer, I want message parent-child relationships to use SDK's native `parent_tool_use_id`, so that I don't duplicate SDK functionality and avoid correlation bugs.

#### Acceptance Criteria

1. WHEN SDK yields SDKAssistantMessage THEN extract `parent_tool_use_id` from message
2. WHEN transforming to ExecutionNode THEN preserve `parent_tool_use_id` as `parentId` field
3. WHEN user sends message THEN set `parent_tool_use_id: null` (SDK manages this)
4. WHEN tool result arrives THEN use SDK's `parent_tool_use_id` to link to tool_use block
5. WHEN building UI tree THEN use `parentId` from SDK instead of custom tracking

#### Implementation Approach

**Remove custom parent tracking** (sdk-agent-adapter.ts:267):

```typescript
// ❌ DELETE THIS
let currentParentId: MessageId | null = null;
// ... custom tracking
currentParentId = messageId;
```

**Use SDK's native field**:

```typescript
// ✅ Use SDK's parent_tool_use_id
const nodes = self.transformer.transform(sdkMessage, sessionId);

for (const node of nodes) {
  const messageId = MessageId.from(node.id);

  const storedMessage: StoredSessionMessage = {
    id: messageId,
    parentId: sdkMessage.parent_tool_use_id ? MessageId.from(sdkMessage.parent_tool_use_id) : null, // ✅ Use SDK's native linking
    role: sdkMessage.type === 'user' ? 'user' : 'assistant',
    content: [node],
    timestamp: Date.now(),
    model: config?.model,
    tokens: node.tokenUsage,
  };

  await self.storage.addMessage(sessionId, storedMessage);
  yield node;
}
```

---

### Requirement 3: Correct Role Assignment

**User Story**: As a user, I want user messages to be labeled as 'user' and assistant messages as 'assistant', so that the conversation history is accurate.

#### Acceptance Criteria

1. WHEN SDK yields SDKUserMessage THEN set role to 'user'
2. WHEN SDK yields SDKAssistantMessage THEN set role to 'assistant'
3. WHEN SDK yields SDKSystemMessage THEN set role to 'system'
4. WHEN SDK yields SDKResultMessage THEN set role to 'system'
5. WHEN storing message THEN verify role matches message type

#### Implementation Approach

```typescript
// Fix role assignment based on SDK message type
function getRoleFromSDKMessage(sdkMessage: SDKMessage): 'user' | 'assistant' | 'system' {
  switch (sdkMessage.type) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
    case 'result':
      return 'system';
    default:
      return 'assistant'; // fallback
  }
}

// Usage
const storedMessage: StoredSessionMessage = {
  role: getRoleFromSDKMessage(sdkMessage), // ✅ Correct role
  // ...
};
```

---

### Requirement 4: Expose SDK Dynamic Controls

**User Story**: As a user, I want to interrupt Claude's execution, change models, and toggle autopilot mode mid-conversation, so that I have full control over the agent.

#### Acceptance Criteria

1. WHEN UI requests interrupt THEN call query.interrupt() on active session
2. WHEN UI changes model THEN call query.setModel(newModel) on active session
3. WHEN UI toggles autopilot THEN call query.setPermissionMode(mode) on active session
4. WHEN UI adjusts thinking budget THEN call query.setMaxThinkingTokens(tokens)
5. WHEN session is not in streaming input mode THEN throw error (methods unavailable)

#### Implementation Approach

Add new methods to IAIProvider interface (or extend SdkAgentAdapter):

```typescript
class SdkAgentAdapter implements IAIProvider {
  // ... existing methods

  /**
   * Interrupt active session (stop agent mid-execution)
   * Only available when using streaming input mode
   */
  async interruptSession(sessionId: SessionId): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    await session.query.interrupt();
    this.logger.info(`[SdkAgentAdapter] Interrupted session: ${sessionId}`);
  }

  /**
   * Change model mid-conversation
   * Only available when using streaming input mode
   */
  async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    await session.query.setModel(model);
    this.logger.info(`[SdkAgentAdapter] Changed model to ${model} for session: ${sessionId}`);
  }

  /**
   * Change permission mode (autopilot toggle)
   * Only available when using streaming input mode
   */
  async setSessionPermissionMode(sessionId: SessionId, mode: PermissionMode): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    await session.query.setPermissionMode(mode);
    this.logger.info(`[SdkAgentAdapter] Changed permission mode to ${mode} for session: ${sessionId}`);
  }
}
```

---

### Requirement 5: Simplify Session Storage

**User Story**: As a developer, I want to use SDK's native session management instead of duplicating it, so that the codebase is simpler and more maintainable.

#### Acceptance Criteria

1. WHEN starting new session THEN do NOT create custom storage record
2. WHEN resuming session THEN use SDK's `resume: sessionId` option
3. WHEN forking session THEN use SDK's `forkSession: true` option
4. WHEN continuing last session THEN use SDK's `continue: true` option
5. WHEN SDK provides usage stats THEN use SDKResultMessage values directly

#### Implementation Approach

**Option A: Minimal Storage (Recommended)**

- Keep SdkSessionStorage only for UI-specific needs (session list, names, favorites)
- Remove message storage (SDK handles this)
- Remove token/cost tracking (SDK provides this)
- Simplify to 50-100 lines (vs current 380 lines)

**Option B: Remove Storage Completely**

- Investigate where SDK stores sessions
- Use SDK's session management exclusively
- Add methods to SdkAgentAdapter to query SDK session list

**Recommended: Option A** (maintains some control for UI while leveraging SDK)

```typescript
// Simplified storage - only UI metadata
interface SessionMetadata {
  id: SessionId;
  name: string;
  createdAt: number;
  lastActiveAt: number;
  isFavorite: boolean;
  // Remove: messages[], totalTokens, totalCost (SDK provides these)
}

class SdkSessionStorage {
  async saveMetadata(metadata: SessionMetadata): Promise<void> {
    // Store only UI metadata, not messages
  }

  async getSessionList(workspaceId: string): Promise<SessionMetadata[]> {
    // Return session list for UI
  }

  // Remove: addMessage(), compactSession(), calculateSessionSize()
}
```

---

## Non-Functional Requirements

### Performance Requirements

- **Multi-Turn Latency**: Each user message → SDK response within 2 seconds (same as single-turn)
- **Memory Usage**: AsyncIterable message queue < 10MB for 100-message conversation
- **Session Resume**: Resume existing session within 500ms using SDK's `resume` option

### Reliability Requirements

- **Uptime**: 99.9% availability (SDK is in-process, no external dependencies)
- **Error Handling**: Graceful iterator completion on errors, no hanging sessions
- **Recovery Time**: Automatic session recovery via SDK's resume within 1 second

### UX Requirements

- **Real-Time Streaming**: Partial messages visible within 100ms of SDK yield
- **Interrupt Responsiveness**: Stop button interrupts agent within 500ms
- **Model Switching**: Change model mid-conversation without breaking session
- **Autopilot Toggle**: Permission mode changes apply to next tool use

---

## Out of Scope

### What We're NOT Changing

1. **ExecutionNode Format**: UI still consumes ExecutionNode tree (no frontend changes required)
2. **IAIProvider Interface**: Keep existing interface, add optional methods for SDK features
3. **Transformer Logic**: SdkMessageTransformer still converts SDK → ExecutionNode (minimal changes)
4. **Permission Handling**: SdkPermissionHandler unchanged (still uses canUseTool callback)
5. **Custom Tools**: PtahToolsServer unchanged (help, executeCode tools still work)

### Deliberate Limitations

1. **No Backward Compatibility**: Existing sessions created with string mode cannot be resumed (breaking change)
2. **No SDK Session Export**: Don't implement export/import of SDK sessions (use SDK's native format)
3. **No Custom Compaction**: Remove compaction logic, let SDK manage session size
4. **No CLI Fallback**: SDK-only implementation, no fallback to CLI integration

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder   | Impact Level | Involvement      | Success Criteria                                                     |
| ------------- | ------------ | ---------------- | -------------------------------------------------------------------- |
| End Users     | High         | Testing/Feedback | Multi-turn conversation works, can interrupt/change model            |
| Frontend Team | Medium       | API Integration  | ExecutionNode format unchanged, new features exposed via IAIProvider |
| Backend Team  | High         | Implementation   | Code reduced by 30%, SDK features fully utilized                     |

### Secondary Stakeholders

| Stakeholder | Impact Level | Involvement | Success Criteria                              |
| ----------- | ------------ | ----------- | --------------------------------------------- |
| QA Team     | Medium       | Testing     | All multi-turn scenarios pass, no regressions |
| DevOps      | Low          | Deployment  | No infrastructure changes (SDK is in-process) |

---

## Risk Analysis

### Technical Risks

| Risk                        | Probability | Impact | Score | Mitigation Strategy                                    |
| --------------------------- | ----------- | ------ | ----- | ------------------------------------------------------ |
| AsyncIterable complexity    | High        | Medium | 6     | Reference SDK examples, use generator pattern          |
| Breaking existing sessions  | High        | Low    | 3     | Document migration, acceptable for beta                |
| SDK session storage unclear | Medium      | Medium | 4     | Investigate SDK source code, contact Anthropic support |
| Iterator hang/deadlock      | Medium      | High   | 6     | Implement timeout, cleanup on session end              |

### Business Risks

| Risk                                | Probability | Impact | Score | Mitigation Strategy                  |
| ----------------------------------- | ----------- | ------ | ----- | ------------------------------------ |
| User confusion from breaking change | Low         | Medium | 3     | Clear release notes, migration guide |
| Feature parity with CLI             | Low         | Low    | 1     | SDK has all CLI features + more      |

---

## Success Metrics

### Functional Success

- [ ] User can send 10+ messages in single conversation without errors
- [ ] Role assignment correct for all message types (user/assistant/system)
- [ ] Parent-child relationships use SDK's `parent_tool_use_id` exclusively
- [ ] Interrupt button stops agent mid-execution within 500ms
- [ ] Model selector changes model mid-conversation without breaking session
- [ ] Autopilot toggle changes permission mode for next tool use

### Code Quality Success

- [ ] SdkSessionStorage reduced from 380 → ~100 lines (73% reduction)
- [ ] Custom parent tracking removed from sdk-agent-adapter.ts
- [ ] All role assignments use getRoleFromSDKMessage() helper
- [ ] AsyncIterable implemented with proper cleanup and error handling
- [ ] Zero 'any' types, strict TypeScript compliance

### Performance Success

- [ ] Multi-turn conversation latency < 2 seconds per message
- [ ] Message queue memory < 10MB for 100-message conversation
- [ ] Session resume via SDK's `resume` < 500ms

---

## Dependencies

### Technical Dependencies

- `@anthropic-ai/claude-agent-sdk` v1.0.0+ (already installed)
- No new dependencies required

### Integration Points

- **Frontend**: No changes required (ExecutionNode format preserved)
- **IAIProvider Interface**: Optional method additions for SDK features
- **SdkMessageTransformer**: Minor changes to use `parent_tool_use_id`
- **SdkSessionStorage**: Major simplification (remove message storage)

### Constraints

- Must use AsyncIterable<SDKUserMessage> for streaming input mode
- Cannot use string prompt mode for multi-turn conversation
- interrupt/setModel/setPermissionMode only available in streaming mode
- SDK session storage format is opaque (cannot directly manipulate)

---

## Implementation Phases

### Phase 1: Core Multi-Turn Fix

1. Implement AsyncIterable<SDKUserMessage> generator
2. Update sendMessageToSession() to queue messages
3. Fix role assignment bug
4. Test basic multi-turn conversation (3-5 messages)

### Phase 2: Native Parent Linking

1. Remove custom parent tracking from sdk-agent-adapter.ts
2. Update transformer to preserve `parent_tool_use_id`
3. Update storage to use SDK's native field
4. Test parent-child relationships in UI tree

### Phase 3: SDK Feature Exposure

1. Add interruptSession() method
2. Add setSessionModel() method
3. Add setSessionPermissionMode() method
4. Integrate with frontend UI controls

### Phase 4: Storage Simplification

1. Remove message storage from SdkSessionStorage
2. Remove token/cost tracking
3. Simplify to UI metadata only
4. Test session list/resume functionality

---

## Acceptance Testing Scenarios

### Scenario 1: Multi-Turn Conversation

```gherkin
Feature: Multi-Turn Conversation
  As a user
  I want to send multiple messages in a conversation
  So that I can have a continuous dialogue with Claude

  Scenario: Basic multi-turn flow
    Given I start a new SDK session
    When I send message "What is 2+2?"
    Then SDK responds with "4"
    When I send message "What about 3+3?"
    Then SDK responds with "6"
    And conversation has 4 messages (2 user, 2 assistant)
    And all parent_tool_use_id relationships are valid
```

### Scenario 2: Session Interrupt

```gherkin
Feature: Session Interrupt
  As a user
  I want to stop Claude mid-execution
  So that I can cancel long-running tasks

  Scenario: Interrupt during tool execution
    Given I start a new SDK session
    When I send message "Analyze this large codebase"
    And SDK starts executing Read tools
    When I click interrupt button
    Then query.interrupt() is called within 500ms
    And SDK stops execution gracefully
    And session remains active for next message
```

### Scenario 3: Model Switching

```gherkin
Feature: Model Switching
  As a user
  I want to change Claude model mid-conversation
  So that I can optimize for cost vs capability

  Scenario: Switch from Sonnet to Opus
    Given I have active SDK session with Sonnet
    When I select Opus from model dropdown
    Then query.setModel('claude-opus-4.5') is called
    And next message uses Opus model
    And conversation history is preserved
```

### Scenario 4: Parent Linking

```gherkin
Feature: Parent Linking
  As a developer
  I want message relationships to use SDK's native linking
  So that I avoid correlation bugs

  Scenario: Tool use parent linking
    Given I start a new SDK session
    When SDK yields SDKAssistantMessage with tool_use block
    Then tool_use block has id "tool_xyz"
    When SDK yields next SDKAssistantMessage with parent_tool_use_id "tool_xyz"
    Then message is correctly linked as child of tool_use
    And ExecutionNode tree reflects SDK's parent relationship
```

---

## Quality Gates

Before marking this task as complete, verify:

- [ ] All 4 acceptance testing scenarios pass
- [ ] All 6 functional success metrics met
- [ ] All 5 code quality success metrics met
- [ ] All 3 performance success metrics met
- [ ] Zero regressions in existing single-turn conversation
- [ ] Code review approval from senior developer
- [ ] Documentation updated with AsyncIterable pattern
- [ ] Migration guide written for breaking changes

---

## References

- [SDK TypeScript Reference](D:\projects\ptah-extension\task-tracking\TASK_2025_044\claude-agent-sdk.md) - Complete 2029-line API documentation
- [TASK_2025_048 Implementation](D:\projects\ptah-extension\task-tracking\TASK_2025_048\) - Current SDK integration code
- [ExecutionNode Type System](D:\projects\ptah-extension\libs\shared\src\lib\types\execution-node.types.ts) - UI message format
