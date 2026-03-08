# Task Context - TASK_2025_101

## User Intent

Fix scrolling behavior that doesn't properly wait for ExecutionNode tree building to finish before scrolling to the bottom. The scroll happens before recursive child components finish rendering, causing content to appear below the scroll position.

## Conversation Summary

Investigation completed with Explore agent - identified root cause:

1. **Primary Issue**: `afterNextRender()` in ChatViewComponent fires BEFORE recursive child component rendering completes
2. **Secondary Issue**: InlineAgentBubbleComponent has identical problem with agent content scrolling
3. **Tertiary Issue**: StreamingHandlerService batches events with `requestAnimationFrame`, delaying signal updates
4. **Race Condition**: Two independent scroll effects (main container + agent container) can fire simultaneously with incomplete DOM

### Key Files Identified

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (lines 148-208)
- `libs/frontend/chat/src/lib/components/organisms/inline-agent-bubble.component.ts` (lines 197-235)

### User Constraints

- No page reloads or global subscriptions
- No impact on other business logic
- Follow Angular 21 lifecycle best practices

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-01-01
- Type: BUGFIX
- Complexity: Medium

## Execution Strategy

BUGFIX strategy - software-architect → team-leader (3 modes) → QA
