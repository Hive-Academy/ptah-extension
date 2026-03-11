# Task Context - TASK_2025_097

## User Intent

Fix permission system issues in SDK Permission Handler:

1. **Massive delay** in permission processing (possibly RPC-related or rendering)
2. **Duplicate permission rendering** - Both inline-permission tool AND global notification showing
3. **Global notification** should collapse to a small icon/badge (bottom right corner above text input)
4. **AskUserQuestion tool** - Verify proper implementation per SDK documentation

## Conversation Summary

User tested permission system with subsequent permission requests and found:

- Screenshot shows duplicate permission prompts: inline (correct) + global (should be collapsed)
- Global notification shows "could not match to tool" message
- 22s expiration timer visible on both prompts
- Both showing same file: `d:\projects\nestjs-ai-saas-starter\task-tracking\TASK_2025_057\task-description.md`

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-29
- Type: BUGFIX
- Complexity: Medium

## Files Involved

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` - Backend permission callback
- Frontend permission components (to be identified)
- RPC message handlers
- ChatStore permission handling

## Execution Strategy

BUGFIX strategy: Research → team-leader (3 modes) → USER CHOOSES QA → Modernization

## Key Issues from Screenshot

1. **Duplicate UI**: Same permission request shown twice

   - Inline: Shows inside tool-call-item (correct location)
   - Global: Shows at bottom (fallback for "could not match to tool")

2. **Performance Delay**: 22s timeout visible suggests rapid expiration

3. **AskUserQuestion**: Need to verify implementation matches SDK docs
