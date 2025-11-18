# Manual Test Checklist - Batch 4 UI Components

## Test Environment Setup

- [ ] Build extension: `npm run build:all`
- [ ] Launch Extension Development Host (F5)
- [ ] Open Ptah chat panel
- [ ] Start new chat session

## ThinkingDisplayComponent Tests

- [ ] Start chat with reasoning-heavy prompt
- [ ] Verify thinking display appears with 💭 icon
- [ ] Verify thinking content shows Claude's reasoning
- [ ] Verify timestamp displays correctly
- [ ] Verify component hides when thinking completes

## ToolTimelineComponent Tests

- [ ] Send message that triggers file reads
- [ ] Verify tool timeline appears
- [ ] Verify Read tool shows with 📖 icon
- [ ] Verify tool status badge (running → success)
- [ ] Verify duration displays after completion
- [ ] Test Bash tool execution (⚡ icon)
- [ ] Test Write tool execution (✍️ icon)
- [ ] Verify error state with ❌ badge

## PermissionDialogComponent Tests

- [ ] Trigger permission request (file access)
- [ ] Verify modal dialog appears
- [ ] Verify permission type displays
- [ ] Verify file path shows in details
- [ ] Click "Approve" button
- [ ] Verify dialog dismisses
- [ ] Verify permission response sent to backend
- [ ] Trigger another permission request
- [ ] Click "Deny" button
- [ ] Verify denial sent to backend

## AgentActivityTimelineComponent Tests

- [ ] Start workflow with sub-agents (use /orchestrate)
- [ ] Verify agent timeline appears
- [ ] Verify agent name displays (e.g., "workflow-orchestrator")
- [ ] Verify "Running" status with ⏳ icon
- [ ] Verify agent activity updates
- [ ] Verify completion with ✅ icon
- [ ] Verify duration calculation
- [ ] Test multiple concurrent agents

## VS Code Theme Compatibility

- [ ] Switch to Dark+ theme
- [ ] Verify all components render correctly
- [ ] Switch to Light+ theme
- [ ] Verify all components render correctly
- [ ] Verify colors use VS Code CSS variables

## Accessibility Tests

- [ ] Tab through permission dialog buttons
- [ ] Verify focus indicators visible
- [ ] Test screen reader compatibility (optional)

## Integration Tests

- [ ] Verify all 4 components can display simultaneously
- [ ] Verify components don't overlap
- [ ] Verify scrolling works with multiple components
- [ ] Verify components clear when session ends

## Test Notes

**Date**: **\*\***\_\_\_**\*\***
**Tester**: **\*\***\_\_\_**\*\***
**Build Version**: **\*\***\_\_\_**\*\***

**Issues Found**:

1. ***
2. ***
3. ***
