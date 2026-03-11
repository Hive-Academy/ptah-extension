# TASK_2025_136: AskUserQuestion Tool Investigation

## User Request

Investigate why the AskUserQuestion tool is not working - the agent keeps loading/stuck after calling the tool. The SDK permission handler sends the request to webview but the response flow seems broken.

## Task Type

RESEARCH

## Complexity

Medium

## Key Observations from Log

### What Works

1. `[SdkPermissionHandler] canUseTool invoked: AskUserQuestion` (line 236)
2. `[SdkPermissionHandler] Handling AskUserQuestion tool request` (line 237)
3. `[SdkPermissionHandler] Sending AskUserQuestion request` (line 238)
4. `[SdkPermissionHandler] AskUserQuestion request sent to webview` (line 239)

### What's Broken

- After sending to webview, the UI shows the tool is "Executing AskUserQuestion..." but never renders the actual question UI
- The screenshot shows "Analyzing the" text appearing (partial streaming?) while tool still shows loading
- The agent appears stuck waiting for a response that never comes

## Related Tasks

- TASK_2025_063: SDK Permission & AskUserQuestion Implementation (SUPERSEDED)
- TASK_2025_080: SDK Permission Handler & Result Stats (In Progress)
- TASK_2025_097: Permission System UX & Performance (In Progress)

## Investigation Scope

1. **Claude Agent SDK Best Practices**: How should AskUserQuestion be implemented according to official SDK docs?
2. **Permission Handler Flow**: Trace the full request/response cycle in SdkPermissionHandler
3. **Webview Integration**: How does the webview receive and display the question UI?
4. **Response Flow**: How does the user response get back to the SDK?
5. **Third-Party Provider Impact**: Does using Moonshot (Kimi) instead of native Anthropic affect this tool?

## Files to Investigate

- `libs/backend/agent-sdk/src/lib/helpers/sdk-permission-handler.ts` - Permission handler
- `libs/frontend/chat/src/lib/components/` - Question UI components
- `apps/ptah-extension-vscode/src/services/rpc/handlers/` - RPC handlers
- `libs/frontend/core/src/lib/services/` - Frontend services handling permission messages

## Created

2026-02-03

## Owner

orchestrator → researcher-expert
