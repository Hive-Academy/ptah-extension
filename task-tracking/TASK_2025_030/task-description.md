# TASK_2025_030: Enhanced Streaming UX

## Overview

Improve the streaming user experience to feel more real-time and interactive. Current implementation shows text in chunks and lacks visual feedback during long operations.

## Problem Statement

1. **Text appears in chunks**: Claude CLI sends complete JSONL lines, so text appears in batches rather than flowing character-by-character
2. **No activity feedback during operations**: When Claude is executing tools or thinking, users see a static bubble
3. **Streaming indicator logic flaw**: The "Claude is responding..." indicator disappears as soon as the execution tree starts, even though streaming continues
4. **No typing cursor**: Users have no visual cue that text is being added to the response

## Requirements

### Must Have (P0)

1. **Fix streaming indicator logic**: Show activity feedback whether execution tree exists or not
2. **Add typing cursor**: Animated cursor at the end of streaming text
3. **Tool activity status**: Show what tool is doing (e.g., "Reading src/lib/utils.ts...")
4. **Pulsing activity indicator**: Visual feedback during pauses in streaming

### Should Have (P1)

5. **Typewriter animation**: Animate text appearing character-by-character (even if chunks arrive in batches)
6. **Skeleton placeholder**: Show placeholder content when streaming starts but no content yet
7. **Avatar activity indicator**: Pulsing ring or animation on assistant avatar during streaming

### Nice to Have (P2)

8. **Smooth scroll sync**: Improve auto-scroll to feel more natural during streaming
9. **Progress estimation**: Show estimated completion for long operations

## Affected Components

| Component                          | Changes Needed                        |
| ---------------------------------- | ------------------------------------- |
| `chat-view.component.html`         | Fix streaming indicator logic         |
| `message-bubble.component.ts/html` | Add typing cursor, activity indicator |
| `execution-node.component.ts`      | Add streaming text animation          |
| `tool-call-item.component.ts`      | Enhance streaming status display      |
| `status-badge.component.ts`        | Potentially add pulsing animation     |
| New: `typing-cursor.component.ts`  | Animated cursor component             |
| New: `streaming-text.directive.ts` | Typewriter animation directive        |

## DaisyUI Components to Leverage

- `loading loading-dots` - Already used
- `loading loading-spinner` - Already used in tools
- `skeleton` - For placeholder content
- `animate-pulse` - For pulsing effects
- CSS `@keyframes` - Custom cursor blink animation

## Acceptance Criteria

1. Users see continuous visual feedback during streaming (no static pauses)
2. Text appears with a typing cursor that blinks at the insertion point
3. Tools show what they're doing during execution ("Reading...", "Writing...")
4. Streaming indicator visible throughout streaming, not just at start
5. All animations use DaisyUI/Tailwind utilities where possible
6. Performance: No jank or lag from animations (use CSS over JS)

## Out of Scope

- Backend changes to Claude CLI integration
- Changes to JSONL parsing logic
- Session management changes
- Tool execution logic changes

## Dependencies

- DaisyUI 5.x (already installed)
- Tailwind CSS 4.x (already installed)
- Angular 20+ signals (already using)

## References

- DaisyUI Loading: https://daisyui.com/components/loading/
- DaisyUI Skeleton: https://daisyui.com/components/skeleton/
- Tailwind Animation: https://tailwindcss.com/docs/animation
