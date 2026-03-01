# Task Context - TASK_2025_169

## User Request

Remove the Copilot CLI adapter fallback and make Copilot SDK the only adapter. The CLI adapter runs with `--yolo --autopilot --no-ask-user` which auto-approves everything with zero permission routing. The SDK adapter has the full permission bridge (`onPreToolUse`, `onPermissionRequest`), structured events, and session resume. Having both creates user confusion and defeats the purpose of Task 162's SDK integration.

## Task Type

REFACTORING

## Complexity Assessment

Simple (~1-2 hours)

## Strategy Selected

REFACTORING (Minimal) - Direct developer invocation. Requirements fully defined from prior analysis.

## Changes Required

1. **Delete** `copilot-cli.adapter.ts` — the raw CLI spawn adapter
2. **Modify** `cli-detection.service.ts` — Remove feature flag, always register `CopilotSdkAdapter`
3. **Modify** `agent-orchestration-config.component.ts` — Remove "Use Copilot SDK" toggle from settings UI
4. **Modify** `agent-rpc.handlers.ts` — Remove `copilotUseSdk` from config get/set
5. **Modify** shared types — Remove `copilotUseSdk` from `AgentOrchestrationConfig`
6. **Modify** `package.json` — Remove `ptah.copilot.useSdk` VS Code setting contribution
7. **Clean up** barrel exports if `copilot-cli.adapter.ts` was exported

## Files Affected

### DELETE

- `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-cli.adapter.ts`

### MODIFY

- `libs/backend/llm-abstraction/src/lib/services/cli-detection.service.ts`
- `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts`
- `libs/shared/src/lib/types/rpc.types.ts` (or wherever `AgentOrchestrationConfig` is defined)
- `apps/ptah-extension-vscode/package.json` (contributes.configuration)

## Created

2026-03-01
