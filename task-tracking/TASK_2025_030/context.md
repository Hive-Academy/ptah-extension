# TASK_2025_030: Enhanced Streaming UX - Typewriter Effect & Activity Indicators

## User Intent

User wants to improve the streaming UX to feel more real-time and interactive. Current implementation feels "laggy" and "detached" - text appears in chunks rather than flowing naturally, and users feel disconnected during long operations.

## Key Insight from User

> "Why do we check for the execution tree? Shouldn't we show streaming whether the tree exists or not?"

Current logic in `chat-view.component.html`:

```html
<!-- Shows message bubble only when tree exists -->
@if (chatStore.isStreaming() && streamingMessage(); as msg) {
<ptah-message-bubble [message]="msg" />
}

<!-- Shows indicator only when tree does NOT exist -->
@if (chatStore.isStreaming() && !chatStore.currentExecutionTree()) {
<span class="loading loading-dots loading-sm"></span>
Claude is responding... }
```

**Problem**: The streaming indicator disappears as soon as the tree starts building. But during streaming, even WITH a tree, there can be long pauses where the bubble just sits there looking static - no visual feedback that Claude is working.

## Background: Claude CLI JSONL Streaming

Claude CLI sends complete JSONL lines, not character-level deltas. While `JSONLMessage` has a `delta` field for streaming text, large messages often arrive as complete blocks. The system buffers until newlines, so users see text appear in chunks rather than character-by-character.

## Current System Evaluation

### What We Already Have (Excellent Foundation)

| Feature                           | Status | Location                              |
| --------------------------------- | ------ | ------------------------------------- |
| Tool header with icon & status    | ✅     | `tool-call-item.component.ts:72-86`   |
| Tool streaming spinner            | ✅     | `tool-call-item.component.ts:126-130` |
| Tool input/output with syntax     | ✅     | `tool-call-item.component.ts:146-221` |
| Collapsible tools                 | ✅     | `tool-call-item.component.ts:352-354` |
| Agent cards with colored badges   | ✅     | `agent-card.component.ts`             |
| Status badges (streaming spinner) | ✅     | `status-badge.component.ts:27-29`     |
| Thinking blocks                   | ✅     | `thinking-block.component.ts`         |
| Basic streaming indicator         | ✅     | `chat-view.component.html:17-23`      |
| Text delta processing             | ✅     | `jsonl-processor.service.ts:212-214`  |
| DaisyUI loading components        | ✅     | Available via `loading-*` classes     |

### What's Missing

| Feature                       | Status | Impact                                |
| ----------------------------- | ------ | ------------------------------------- |
| Typewriter animation for text | ❌     | Text appears in chunks, not flowing   |
| Typing cursor indicator       | ❌     | No visual cue text is being typed     |
| "Working on X..." tool status | ❌     | Users don't know what Claude is doing |
| Skeleton placeholders         | ❌     | Empty bubble during initial streaming |
| Pulse/activity during pauses  | ❌     | Bubble looks static during processing |
| Avatar activity indicator     | ❌     | No feedback on assistant avatar       |

## Conversation Summary

1. User asked to evaluate how Claude sends chunks and make streaming feel more real-time
2. Initial analysis suggested Claude CLI sends complete JSONL lines, not character deltas
3. User requested full evaluation of current rendering system before proposing changes
4. Comprehensive evaluation revealed strong foundation but missing animation/activity UX
5. User identified a key issue: streaming indicator logic is wrong (hides when tree starts)
6. Task created to document findings and plan enhancements

## Technical Constraints

- Build upon existing system, no major refactoring
- Use Angular signals and DaisyUI components
- Maintain OnPush change detection
- Keep recursive ExecutionNode architecture intact
