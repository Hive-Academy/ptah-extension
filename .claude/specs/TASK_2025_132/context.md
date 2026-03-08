# TASK_2025_132: Subagent Model Info, Token Stats & Pricing Display

## User Request

Investigate and implement showing the model used by subagents, token statistics, and pricing/cost information in the Ptah UI. Currently, when subagents (frontend-developer, backend-developer, etc.) are launched via the Task tool, the UI shows the agent cards but lacks:

1. Which model each subagent is using
2. Token usage statistics per subagent
3. Pricing/cost information

## Strategy

**Type**: RESEARCH -> FEATURE
**Flow**: Researcher -> [Architect if needed] -> Implementation

## Phase

Research - Understanding current data flow and available information

## Context

- The screenshot shows subagent cards in the chat UI without model/token/cost details
- Related tasks: TASK_2025_047 (Token Count & Cost Display), TASK_2025_080 (SDK Permission Handler & Result Stats)
- The extension uses Claude Agent SDK for communication
- Frontend uses Angular with signal-based state management
