# Requirements Document - TASK_2025_022

## Introduction

### Business Context

During the RPC migration (TASK_2025_021), a critical architectural insight emerged: **EventBus was fundamentally wrong for streaming Claude CLI responses**. The EventBus split unified messages into separate event types (content, thinking, tools, agents), which destroyed the cohesive message structure that makes Ptah's GUI powerful.

**Core Philosophy**: The whole purpose of this extension is to make a beautiful GUI for Claude's message stream. Every message from Claude CLI contains content blocks (text, thinking, tool_use, tool_result) as a unified array. The GUI's power comes from rendering these content blocks together in real-time.

This documentation task captures the correct architecture pattern to prevent future implementations from repeating the EventBus mistake.

### Project Overview

Create comprehensive documentation that:

1. Explains **why** the message-centric architecture is correct
2. Shows **how** to preserve unified messages during streaming
3. Provides **templates** for implementing streaming in Phase 3.5 (RPC Migration Gap)
4. Demonstrates **anti-patterns** to avoid (like EventBus)
5. References **existing correct implementations** (JSONLStreamParser, ContentBlocks)

This documentation will be the authoritative guide for:

- Developers continuing RPC migration Phase 3.5 (streaming gap)
- Future contributors understanding streaming architecture
- Stakeholders validating that GUI capabilities (thinking, tools, agents) are preserved

---

## Requirements

### Requirement 1: Streaming Architecture Philosophy Document

**User Story**: As a developer continuing RPC migration, I want a clear explanation of the message-centric vs event-centric architecture, so that I understand why EventBus was wrong and what pattern to follow.

#### Acceptance Criteria

1. WHEN reading the philosophy document THEN it SHALL explain the fundamental difference between message-centric and event-centric architectures with clear examples
2. WHEN reviewing architecture patterns THEN it SHALL demonstrate why splitting messages into events destroys real-time streaming UX
3. WHEN evaluating streaming requirements THEN it SHALL explain how content blocks (text, thinking, tool_use) exist within unified messages, not as separate events
4. WHEN understanding GUI purpose THEN it SHALL clearly state: "The whole purpose of this extension is to make a beautiful GUI for Claude's message stream"
5. WHEN comparing approaches THEN it SHALL provide side-by-side comparison of WRONG (EventBus) vs CORRECT (message forwarding) architectures

---

### Requirement 2: Claude CLI Streaming Format Reference

**User Story**: As a developer implementing streaming, I want documentation of Claude CLI's stdout formats (JSONL streams vs .jsonl files), so that I know what data structures to expect and how to parse them.

#### Acceptance Criteria

1. WHEN learning streaming formats THEN it SHALL document both stdout real-time streams and .jsonl file formats with examples
2. WHEN understanding message structure THEN it SHALL show example JSONL lines with content blocks arrays (text, thinking, tool_use, tool_result)
3. WHEN parsing streams THEN it SHALL explain JSONLStreamParser's role and show its callback interface
4. WHEN handling different message types THEN it SHALL document all JSONL message types (system, assistant, tool, permission, stream_event, result) with examples
5. WHEN detecting agents THEN it SHALL explain how Task tool events create agents (tracked in activeAgents Map), while regular tools with parent_tool_use_id are NOT agents

---

### Requirement 3: JSONLStreamParser Integration Guide

**User Story**: As a developer wiring streaming, I want documentation showing how to use JSONLStreamParser callbacks, so that I can forward content chunks without splitting them into separate events.

#### Acceptance Criteria

1. WHEN integrating parser THEN it SHALL show complete code example of ClaudeCliLauncher spawning CLI with parser attached
2. WHEN handling callbacks THEN it SHALL demonstrate all parser callbacks (onContent, onThinking, onTool, onPermission, onAgentStart, onAgentActivity, onAgentComplete, onMessageStop, onResult, onError)
3. WHEN forwarding to frontend THEN it SHALL provide template for simple postMessage forwarding: `onContent: (chunk) => postMessage('content-chunk', chunk)`
4. WHEN understanding architecture THEN it SHALL explain parser outputs unified ClaudeContentChunk with blocks array, NOT separate events
5. WHEN handling message completion THEN it SHALL document onMessageStop callback for detecting end of streaming (message_stop event)

---

### Requirement 4: Frontend Rendering Examples

**User Story**: As a frontend developer, I want examples showing how ChatMessageContentComponent renders content blocks, so that I understand the unified message rendering pattern.

#### Acceptance Criteria

1. WHEN rendering messages THEN it SHALL show ChatMessageContentComponent template iterating over contentBlocks array with type discrimination
2. WHEN displaying content blocks THEN it SHALL demonstrate how single message renders multiple block types: text, thinking, tool_use, tool_result
3. WHEN understanding GUI capabilities THEN it SHALL show real code examples from existing components (ThinkingBlockComponent, ToolUseBlockComponent, ToolResultBlockComponent, AgentTreeComponent)
4. WHEN validating preservation THEN it SHALL confirm all GUI features (thinking display, tool timelines, agent activity trees) work from content blocks
5. WHEN comparing to EventBus THEN it SHALL show how old event-based approach duplicated/split messages vs current unified approach

---

### Requirement 5: RPC Migration Phase 3.5 Solution (Streaming Gap)

**User Story**: As a developer completing RPC migration, I want concrete templates for wiring streaming in Phase 3.5, so that I can restore real-time streaming UX without recreating EventBus mistakes.

#### Acceptance Criteria

1. WHEN implementing backend streaming THEN it SHALL provide template for RpcHandler streaming endpoint: `rpc:streamMessage` with postMessage forwarding
2. WHEN wiring ClaudeCliLauncher THEN it SHALL show code template connecting launcher.sendMessage() output to RPC postMessage
3. WHEN handling frontend THEN it SHALL provide template for ClaudeRpcService listening to streaming messages and updating ChatStoreService signals
4. WHEN updating messages THEN it SHALL demonstrate appending content chunks to existing message via signal updates
5. WHEN verifying solution THEN it SHALL include checklist: streams work, no duplication, no message splitting, thinking/tools/agents visible

---

### Requirement 6: Anti-Patterns Documentation

**User Story**: As a developer reviewing architecture, I want explicit anti-patterns documented, so that I can avoid recreating the problems EventBus caused.

#### Acceptance Criteria

1. WHEN learning mistakes THEN it SHALL document EventBus anti-pattern: splitting messages into 94 separate event types
2. WHEN understanding consequences THEN it SHALL explain how event splitting caused: message duplication, 15+ message hops, 3 caching layers, UI hallucination
3. WHEN reviewing wrong patterns THEN it SHALL list forbidden approaches: recreating EventBus, using orchestration services, creating separate streams for content/thinking/tools
4. WHEN validating solutions THEN it SHALL provide red flags: "If you find yourself creating separate handlers for content vs thinking vs tools, STOP - you're recreating EventBus"
5. WHEN comparing complexity THEN it SHALL show EventBus path: 15+ hops, 14,000 lines vs Correct path: 3 hops, ~650 lines (5x simpler)

---

## Non-Functional Requirements

### Performance Requirements

- **Documentation Load Time**: Markdown files load < 100ms in VS Code
- **Example Comprehension**: Developers understand streaming pattern within 15 minutes of reading
- **Reference Speed**: Developers find relevant code examples within 30 seconds

### Usability Requirements

- **Documentation Structure**: Clear hierarchy with table of contents in each document
- **Code Examples**: Every concept has working code example from actual codebase
- **Visual Aids**: ASCII diagrams showing message flow (EventBus vs Correct)
- **Search Optimization**: Keywords in headings for VS Code Markdown search

### Maintainability Requirements

- **Version Tracking**: All code examples reference actual file paths with line numbers
- **Update Protocol**: Documentation MUST be updated when parser or components change
- **Validation Process**: Code examples verified by running `npm run build:all` before committing docs

### Quality Requirements

- **Accuracy**: All code examples copy-pasted from working codebase (not theoretical)
- **Completeness**: Every streaming concept covered (parsing, forwarding, rendering, agents)
- **Clarity**: Non-technical stakeholders can understand philosophy document
- **Actionability**: Developers can implement Phase 3.5 using only documentation templates

---

## Content Outline

### Document 1: `streaming-architecture-philosophy.md`

```markdown
# Streaming Architecture Philosophy

## Core Principle: Message-Centric vs Event-Centric

### The GUI's Purpose

"The whole purpose of this extension is to make a beautiful GUI for Claude's message stream"

### What EventBus Got Wrong

[Explain: Split unified messages → separate events → destroyed cohesion]

### What's Correct: Unified Message Forwarding

[Explain: Parser outputs ClaudeContentChunk with blocks[] → forward as-is → frontend renders blocks]

### Architecture Comparison

[ASCII diagram: EventBus (15 hops) vs Correct (3 hops)]

### Real-Time Streaming Requirements

[Explain: Content blocks arrive together in stream, must preserve structure]

### The ContentBlocks Type System (TASK_2025_009)

[Show: ContentBlock union type, how it preserves message structure]
```

---

### Document 2: `claude-cli-streaming-formats.md`

```markdown
# Claude CLI Streaming Formats Reference

## Two Output Modes

### 1. Stdout Real-Time Stream (--output-format stream-json)

[Example JSONL lines from stdout]

### 2. Session Files (.jsonl format)

[Example stored message format]

## JSONL Message Types

### System Messages (initialization)

[Example with session_id, model]

### Assistant Messages (content + thinking)

[Example showing contentBlocks array: text, thinking, tool_use]

### Tool Messages (execution lifecycle)

[Example: start, progress, result, error subtypes]

### Permission Messages (tool permission requests)

[Example with tool, args, description]

### Stream Events (--include-partial-messages)

[Example: message_start, content_block_delta, message_stop]

### Result Messages (final metrics)

[Example with cost, usage, duration]

## Agent Detection Special Case

[Explain: Only Task tool creates agents (activeAgents Map)]
[Show: Regular tools with parent_tool_use_id are NOT agents]
```

---

### Document 3: `jsonl-stream-parser-integration.md`

````markdown
# JSONLStreamParser Integration Guide

## Parser Overview

[Purpose: Parse JSONL → typed callbacks, preserve content blocks]

## Callback Interface

```typescript
export interface JSONLParserCallbacks {
  onSessionInit?: (sessionId: string, model?: string) => void;
  onContent?: (chunk: ClaudeContentChunk) => void; // ← Unified content
  onThinking?: (event: ClaudeThinkingEvent) => void;
  onTool?: (event: ClaudeToolEvent) => void;
  onPermission?: (request: ClaudePermissionRequest) => void;
  onAgentStart?: (event: ClaudeAgentStartEvent) => void;
  onAgentActivity?: (event: ClaudeAgentActivityEvent) => void;
  onAgentComplete?: (event: ClaudeAgentCompleteEvent) => void;
  onMessageStop?: () => void; // NEW: Message streaming complete
  onResult?: (result: JSONLResultMessage) => void; // NEW: Final metrics
  onError?: (error: Error, rawLine?: string) => void;
}
```
````

## Integration Example (ClaudeCliLauncher)

[Code example: spawn CLI, create parser, attach to stdout]

## Simple Forwarding Pattern

```typescript
const parser = new JSONLStreamParser({
  onContent: (chunk) => postMessage('content-chunk', chunk),
  onThinking: (event) => postMessage('thinking', event),
  // ... simple forwarding, NO transformation
});
```

## What NOT to Do

[Show: EventBus pattern that splits chunks into events - WRONG]

````

---

### Document 4: `frontend-content-blocks-rendering.md`

```markdown
# Frontend Content Blocks Rendering

## Unified Message Structure

### ProcessedClaudeMessage (Wrapper)
[Show: extends StrictChatMessage, adds contentBlocks array]

### ContentBlock Union Type
```typescript
type ContentBlock = TextContentBlock | ThinkingContentBlock | ToolUseContentBlock | ToolResultContentBlock;
````

## ChatMessageContentComponent Example

### Template Pattern (Single Message Iteration)

```html
@for (block of message().contentBlocks; track block.type) { @switch (block.type) { @case ('text') {
<div>{{ block.text }}</div>
} @case ('thinking') { <ptah-thinking-block [content]="block.thinking" /> } @case ('tool_use') { <ptah-tool-use-block [toolUse]="block" /> } @case ('tool_result') { <ptah-tool-result-block [result]="block" /> } } }
```

### Component Breakdown

- ThinkingBlockComponent: renders `<thinking>` content
- ToolUseBlockComponent: renders tool execution start
- ToolResultBlockComponent: renders tool output
- AgentTreeComponent: renders agent hierarchy from activity events

## Why This Works

[Explain: Single message contains all blocks → iterate once → render all]

## Why EventBus Failed

[Explain: Split message → multiple events → duplication + timing issues]

````

---

### Document 5: `rpc-phase-3.5-streaming-solution.md`

```markdown
# RPC Migration Phase 3.5: Streaming Gap Solution

## Problem Statement
Phase 1-3 completed RPC for session loading, but streaming messages missing.

## Solution Architecture
````

ClaudeCliLauncher (spawns CLI + parser)
↓ Parser callbacks
Backend RpcHandler (rpc:streamMessage endpoint)
↓ postMessage(type, chunk)
Frontend VSCodeService (message listener)
↓ Update signal
ChatStoreService (append content to message)
↓ Signal change detection
ChatMessageContentComponent (renders updated contentBlocks)

````

## Backend Template (RpcHandler)
```typescript
// Register streaming endpoint
rpcHandler.registerMethod('chat:sendMessage', async (params) => {
  const { sessionId, content } = params;

  // Spawn CLI with parser callbacks
  const launcher = container.get(TOKENS.CLAUDE_CLI_LAUNCHER);
  await launcher.sendMessage(sessionId, content, {
    onContent: (chunk) => {
      webview.postMessage('streaming:content', chunk); // ← Simple forwarding
    },
    onThinking: (event) => {
      webview.postMessage('streaming:thinking', event);
    },
    onTool: (event) => {
      webview.postMessage('streaming:tool', event);
    },
    // ... all callbacks
  });
});
````

## Frontend Template (ClaudeRpcService)

```typescript
// Listen for streaming messages
vscode.onMessage((message) => {
  if (message.type === 'streaming:content') {
    this.chatStore.appendContentChunk(message.data);
  }
});
```

## ChatStoreService Update Logic

```typescript
appendContentChunk(chunk: ClaudeContentChunk) {
  this._messages.update(messages => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.streaming) {
      // Append blocks to existing message
      return messages.map((msg, idx) =>
        idx === messages.length - 1
          ? { ...msg, contentBlocks: [...msg.contentBlocks, ...chunk.blocks] }
          : msg
      );
    }
    return messages;
  });
}
```

## Verification Checklist

- [ ] Messages stream in real-time (visible in UI)
- [ ] No message duplication
- [ ] Thinking blocks appear live
- [ ] Tool usage shows in timeline
- [ ] Agent activity renders correctly
- [ ] No EventBus-style event splitting

````

---

### Document 6: `anti-patterns-and-mistakes.md`

```markdown
# Streaming Anti-Patterns: What NOT to Do

## Anti-Pattern 1: EventBus Message Splitting

### What It Looked Like
```typescript
// WRONG: Split unified message into 94 event types
eventBus.publish('content:received', { text: '...' });
eventBus.publish('thinking:started', { content: '...' });
eventBus.publish('tool:executed', { name: '...', output: '...' });
````

### Why It Failed

- 15+ message hops from CLI to UI
- 3 caching layers (SessionManager, SessionProxy, frontend)
- Message duplication (same content stored 3x)
- UI hallucination (events arrive out-of-order, state inconsistency)
- Lost real-time streaming (events buffered, delayed)

### Correct Alternative

```typescript
// CORRECT: Forward unified message
onContent: (chunk: ClaudeContentChunk) => {
  postMessage('content-chunk', chunk); // chunk.blocks = [text, thinking, tool_use]
};
```

---

## Anti-Pattern 2: Recreating Orchestration Services

### What It Looked Like

```typescript
// WRONG: ChatOrchestrationService with complex event routing
class ChatOrchestrationService {
  async sendMessage() {
    eventBus.publish('chat:messageStart');
    const response = await cliService.send();
    eventBus.publish('chat:messageChunk', response);
    eventBus.publish('chat:messageEnd');
  }
}
```

### Why It's Wrong

- Adds unnecessary abstraction layer
- Delays messages through orchestration logic
- Splits unified stream into lifecycle events

### Correct Alternative

```typescript
// CORRECT: Direct parser callback forwarding
const parser = new JSONLStreamParser({
  onContent: (chunk) => postMessage('content-chunk', chunk),
});
```

---

## Anti-Pattern 3: Separate Streams for Content Types

### What It Looked Like

```typescript
// WRONG: Separate handlers for each content type
contentStream$.subscribe((text) => renderText(text));
thinkingStream$.subscribe((thinking) => renderThinking(thinking));
toolStream$.subscribe((tool) => renderTool(tool));
```

### Why It's Wrong

- Destroys content block ordering
- Cannot render unified messages
- Timing issues (streams progress at different rates)

### Correct Alternative

```typescript
// CORRECT: Single message stream with content blocks array
messageStream$.subscribe((message) => {
  message.contentBlocks.forEach((block) => {
    switch (block.type) {
      case 'text':
        renderText(block);
      case 'thinking':
        renderThinking(block);
      case 'tool_use':
        renderTool(block);
    }
  });
});
```

---

## Red Flags Checklist

**STOP and rethink if you find yourself:**

- [ ] Creating more than 5 message types for streaming
- [ ] Implementing separate handlers for content vs thinking vs tools
- [ ] Adding caching layers between parser and UI
- [ ] Buffering chunks before sending to frontend
- [ ] Transforming ClaudeContentChunk into separate events
- [ ] Creating orchestration services for message routing
- [ ] Implementing "message lifecycle" events (start, progress, end)

**Ask yourself:** "Am I recreating EventBus in disguise?"

---

## Complexity Comparison

### EventBus Architecture (WRONG)

- 14,000 lines of code
- 15+ message hops (CLI → Parser → EventBus → Orchestration → SessionManager → SessionProxy → Frontend)
- 94 message types
- 3 caching layers
- 4 services involved in single message
- Real-time streaming: BROKEN

### Message-Centric Architecture (CORRECT)

- ~650 lines of code (5x simpler)
- 3 message hops (CLI → Parser → RPC → Frontend)
- 6 streaming message types
- 0 caching layers
- 1 service (parser) + simple forwarding
- Real-time streaming: WORKS

```

---

## Acceptance Criteria

### Completeness Verification

**Documentation Coverage**:
- [ ] Philosophy document explains message-centric vs event-centric with clear examples
- [ ] Claude CLI formats documented with real JSONL examples
- [ ] JSONLStreamParser integration guide includes working code templates
- [ ] Frontend rendering examples show actual component code
- [ ] Phase 3.5 solution provides copy-paste implementation templates
- [ ] Anti-patterns document lists all EventBus mistakes with explanations

**Code Example Validation**:
- [ ] All code examples copy-pasted from actual codebase files
- [ ] File paths and line numbers referenced for every example
- [ ] Code examples compile when tested with `npm run build:all`
- [ ] Examples cover all streaming scenarios (text, thinking, tools, agents)

**Architecture Clarity**:
- [ ] ASCII diagrams show message flow for both EventBus and correct approach
- [ ] Comparison table quantifies complexity reduction (14,000 → 650 lines)
- [ ] Every anti-pattern includes "why it's wrong" and "correct alternative"

### Usability Verification

**Developer Workflow**:
- [ ] New developer reads philosophy document → understands approach in 15 minutes
- [ ] Developer uses templates → implements Phase 3.5 streaming in < 4 hours
- [ ] Developer searches "streaming" in docs → finds relevant section in < 30 seconds
- [ ] Code review uses anti-patterns doc → identifies EventBus recreation attempts

**Stakeholder Validation**:
- [ ] Non-technical stakeholders read philosophy doc → understand "beautiful GUI for Claude's message stream" mission
- [ ] Product owner validates: Thinking, tools, agents visible in documented examples
- [ ] Tech lead confirms: Templates prevent EventBus mistakes from recurring

### Technical Accuracy

**Parser Behavior**:
- [ ] Documented callbacks match JSONLStreamParser actual interface
- [ ] Agent detection logic correctly explains Task tool vs regular parent_tool_use_id
- [ ] Content chunk structure matches ClaudeContentChunk type definition
- [ ] Message types match actual Claude CLI v0.3+ JSONL format

**Frontend Rendering**:
- [ ] Component examples match actual ChatMessageContentComponent implementation
- [ ] ContentBlock union type matches shared library definition
- [ ] Rendering pattern matches existing ThinkingBlock/ToolUseBlock/ToolResultBlock components

**RPC Integration**:
- [ ] Backend template compatible with existing RpcHandler design (from Phase 2)
- [ ] Frontend template uses VSCodeService postMessage API correctly
- [ ] ChatStoreService signal updates follow Angular signal patterns

---

## Success Metrics

### Adoption Metrics

- **Phase 3.5 Implementation Time**: Developer completes streaming wiring using docs in < 4 hours (target: 4-6 hours → 4 hours with docs)
- **EventBus Recreation Prevention**: Zero attempts to recreate EventBus patterns in code reviews (validated via PR review comments)
- **Documentation Usage**: Developers reference docs at least 5 times during Phase 3.5 implementation (tracked via file access logs)

### Quality Metrics

- **Code Review Feedback**: Zero "this looks like EventBus" comments on Phase 3.5 PRs
- **Streaming Bug Rate**: Zero message duplication or splitting bugs in Phase 3.5 testing
- **GUI Capability Preservation**: All capabilities (thinking, tools, agents) work in Phase 3.5 without regression

### Clarity Metrics

- **New Contributor Onboarding**: New developer understands streaming approach after 30 minutes of documentation reading (survey-based)
- **Stakeholder Communication**: Product owner can explain message-centric architecture to users (validated via stakeholder interview)
- **Search Efficiency**: Developers find Phase 3.5 templates within 30 seconds of searching docs (timed test)

### Maintenance Metrics

- **Documentation Accuracy**: Zero outdated code examples found during Phase 3.5 implementation (developer feedback)
- **Update Frequency**: Documentation updated within 1 sprint of parser or component changes
- **Reference Completeness**: All referenced file paths remain valid after Phase 3.5 completion

---

## Dependencies

### Internal Dependencies

- **TASK_2025_009 (ContentBlocks Migration)**: COMPLETE - Content block types exist in shared library
- **TASK_2025_021 Phase 1-2 (RPC System Creation)**: COMPLETE - RPC infrastructure exists for reference
- **JSONLStreamParser**: IMPLEMENTED - Parser code available for examples

### External Dependencies

- **Claude CLI v0.3+ JSONL Format**: STABLE - Format unlikely to change
- **Existing Component Implementations**: COMPLETE - ChatMessageContentComponent, ThinkingBlockComponent, etc. all exist

### Documentation Tools

- **Markdown Support**: VS Code native support
- **Diagram Tools**: ASCII art (no external dependencies)
- **Code Highlighting**: VS Code syntax highlighting

---

## Deliverable Checklist

### Document Creation

- [ ] `streaming-architecture-philosophy.md` created with philosophy and comparison
- [ ] `claude-cli-streaming-formats.md` created with JSONL format reference
- [ ] `jsonl-stream-parser-integration.md` created with parser integration guide
- [ ] `frontend-content-blocks-rendering.md` created with rendering examples
- [ ] `rpc-phase-3.5-streaming-solution.md` created with implementation templates
- [ ] `anti-patterns-and-mistakes.md` created with EventBus mistakes documented

### Content Quality

- [ ] All documents have table of contents
- [ ] All code examples include file path references
- [ ] All diagrams clearly show message flow
- [ ] All anti-patterns include "correct alternative" examples
- [ ] All templates are copy-paste ready

### Validation

- [ ] Code examples tested by compiling referenced files
- [ ] File path references verified to exist
- [ ] Stakeholder review completed (user intent validated)
- [ ] Developer review completed (technical accuracy validated)

---

## Risk Assessment

### Technical Risks

**Risk**: Code examples become outdated if parser or components change
- **Probability**: Medium
- **Impact**: High (incorrect documentation worse than no documentation)
- **Mitigation**: Add "Last Updated" date to each document, include file path references for verification
- **Contingency**: Create automated test that validates file paths exist

**Risk**: Phase 3.5 implementation reveals documentation gaps
- **Probability**: Medium
- **Impact**: Medium (developers block on missing info)
- **Mitigation**: Include "feedback loop" section for developers to request clarifications
- **Contingency**: Create follow-up task for documentation updates based on Phase 3.5 feedback

### Adoption Risks

**Risk**: Developers skip documentation and recreate EventBus patterns
- **Probability**: Low (previous pain fresh in memory)
- **Impact**: Critical (negates entire migration)
- **Mitigation**: Make anti-patterns document required reading in PR template
- **Contingency**: Code review guidelines include "EventBus pattern detection" checklist

**Risk**: Documentation too complex for new contributors
- **Probability**: Low (philosophy document targets clarity)
- **Impact**: Medium (slows onboarding)
- **Mitigation**: Start with simple philosophy doc, progressive detail in subsequent docs
- **Contingency**: Create "quick start" summary document for impatient developers

### Maintenance Risks

**Risk**: Documentation becomes stale after Phase 3.5 completion
- **Probability**: High (common for documentation)
- **Impact**: Medium (degrades over time)
- **Mitigation**: Add documentation update to definition-of-done for parser changes
- **Contingency**: Quarterly documentation review sprint

---

## Timeline Estimate

### Documentation Creation Phase

- **Philosophy Document**: 2 hours (includes architecture diagrams)
- **CLI Formats Reference**: 2 hours (includes JSONL examples from actual output)
- **Parser Integration Guide**: 2 hours (includes code templates from launcher)
- **Frontend Rendering Examples**: 2 hours (includes component code)
- **Phase 3.5 Solution Templates**: 3 hours (includes backend + frontend templates)
- **Anti-Patterns Document**: 2 hours (includes EventBus mistake analysis)

**Subtotal**: 13 hours

### Validation Phase

- **Code Example Compilation**: 1 hour
- **File Path Verification**: 1 hour
- **Stakeholder Review**: 1 hour
- **Developer Technical Review**: 2 hours

**Subtotal**: 5 hours

### Revision Phase

- **Incorporate Feedback**: 2 hours
- **Final Polish**: 1 hour

**Subtotal**: 3 hours

---

**Total Estimated Duration**: 21 hours (3 full working days)

---

## References

### Related Tasks

- **TASK_2025_021**: RPC Migration (context for streaming gap)
- **TASK_2025_009**: ContentBlocks Migration (type system foundation)
- **TASK_2025_019**: Architecture proposal (RPC design origin)

### Codebase References

- **JSONLStreamParser**: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`
- **ClaudeCliLauncher**: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`
- **ContentBlock Types**: `libs/shared/src/lib/types/content-block.types.ts`
- **ChatMessageContentComponent**: `libs/frontend/chat/src/lib/components/chat-messages/components/chat-message-content/chat-message-content.component.ts`
- **ThinkingBlockComponent**: `libs/frontend/chat/src/lib/components/thinking-block/thinking-block.component.ts`
- **ToolUseBlockComponent**: `libs/frontend/chat/src/lib/components/tool-use-block/tool-use-block.component.ts`
- **AgentTreeComponent**: `libs/frontend/chat/src/lib/components/agent-tree/agent-tree.component.ts`

### External References

- **Claude CLI Documentation**: https://docs.anthropic.com/en/docs/claude-cli
- **Messages API Format**: https://docs.anthropic.com/en/api/messages

---

**This requirements document is ready for software-architect and documentation-specialist delegation.**
```
