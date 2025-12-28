# Task Context - TASK_2025_035

## User Intent

Implement Model Selector & Autopilot Integration - Wire the existing ChatInputComponent UI controls to backend RPC handlers.

## Source Reference

- **Origin Document**: `docs/future-enhancements/TASK_2025_023_FUTURE_WORK.md`
- **Category**: Category 2: Model Selector & Autopilot Integration
- **Priority**: High (Core UX Feature)
- **Estimated Effort**: 2-3 days

## Technical Context

- **Branch**: TBD
- **Created**: 2025-12-01
- **Type**: FEATURE
- **Complexity**: Medium
- **Status**: Planned

## Problem Statement

The ChatInputComponent has UI for model selection and autopilot toggle (lines 230-241), but these are not wired to the backend.

### Current Code (Stubs)

```typescript
// Line 230-233
selectModel(model: string): void {
  this._selectedModel.set(model);
  // TODO: Integrate with backend model selection when implemented
}

// Line 238-241
toggleAutopilot(): void {
  this._autopilotEnabled.update((enabled) => !enabled);
  // TODO: Integrate with backend autopilot feature when implemented
}
```

## Implementation Requirements

### Model Selector

1. Create `ModelStateService` in frontend core
2. Create backend RPC handler `model:switch`
3. Wire ChatInputComponent to ModelStateService
4. Pass model to ClaudeProcess via `--model` flag

### Autopilot Integration

1. Create `AutopilotStateService` in frontend core
2. Create backend RPC handler `autopilot:toggle`
3. Support permission levels: `ask`, `auto-edit`, `yolo`
4. Wire to ClaudeProcess flags

## Files to Create/Modify

- `libs/frontend/core/src/lib/services/model-state.service.ts` (NEW)
- `libs/frontend/core/src/lib/services/autopilot-state.service.ts` (NEW)
- `libs/backend/claude-domain/src/lib/services/rpc-method-registration.service.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`

## Acceptance Criteria

1. Model dropdown selection persists and affects Claude CLI invocation
2. Autopilot toggle changes permission behavior
3. State syncs between frontend and backend
4. No breaking changes to existing chat functionality
