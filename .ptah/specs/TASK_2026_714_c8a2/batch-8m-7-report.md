# Batch 8m-7 report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-user-questions.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-user-questions.spec.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-native-contract.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\codex-runtime-composition.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8m-7-report.md`

## Results

- **A, G4 adapter:** Added a Zod-validated adapter from Codex question IDs to Claude question text and back. Repeated question text gets a unique display suffix. It calls `SdkPermissionHandler.createCallback('AskUserQuestion')`, which uses the handler's existing private `AskUserQuestionService`, pending registry, response handler, replay path and host-attention path. Electron's session thread ID and `state.tabId()` route the prompt. An aborted signal yields empty answers; the shared service clears its registry entry. The shared service handles non-delivery and idle auto-pick. Secret questions have no option to auto-pick or log; manually entered answers are not logged by the adapter.
- **B, Electron:** `codex-runtime-composition.ts:404` passes the adapter as the runtime's `requestUserInput` option. No new DI service or RPC was registered, so DI guard specs were not changed. Production registration was found in Electron and `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.ts:58`; the latter is outside this lane. No production CodexRuntime construction was found in the VS Code, CLI or TUI app trees.
- **C, MCP elicitation:** Deferred. Codex presents a permission request through `codex-tool-presentation.ts:260`, then `codex-approval-bridge.ts:365-369` accepts only a synthesized default form value or declines/cancels. URL and OpenAI form modes cannot collect user content through this path. Agent SDK has exported `OnElicitation` types (`types/sdk-types/claude-sdk.types.ts:55`), but no Ptah `OnElicitation` handler or equivalent form UI was found under `agent-sdk/src/lib`. Therefore there is no existing Claude elicitation UI contract to reuse within the allowed files.
- **D, specs:** Added focused adapter specs for mapping, duplicate text, Other-capable prompt, secret input, abort cleanup, non-delivery and idle auto-pick. The native contract spec sends a validated Codex server request through the real bridge and adapter to `ASK_USER_QUESTION_REQUEST`, checks the shared `parseAskUserQuestionRequest` guard and replay registry, then sends a Claude answer back to the Codex ID-keyed response. It also checks abort produces empty answers and clears the registry. Tests were **not run**, as instructed.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `SdkPermissionHandler.createCallback` as the shared-service entry point | New question service; new DI token; existing callback | `sdk-permission-handler.ts:176-203, 561` owns the sole `AskUserQuestionService`; `createCallback` reaches it and preserves replay through `listPendingQuestions` at :1216. | Yes |
| Suffix repeated display questions | Collapse identical text; unique display text | Claude answers are keyed by question text; Codex answers are keyed by ID. | Yes |
| Keep secret questions free-text only | Offer Codex options; remove options | `ask-user-question.service.ts:192-195` logs auto-picked answers. Removing secret options prevents an option label from entering that log. The UI's free-text field is currently plain text (`question-card.component.ts:202`); masked secret entry needs an out-of-scope frontend contract change. | Yes |
| Keep Claude's unconditional Other control | Add frontend special case; use shared UI as-is | `question-card.component.ts:181-208` always renders Other. Codex `isOther: false` cannot be enforced without changing that shared UI contract. | Yes |

## Changes needed outside this lane

1. **Idle timing / G4:** `libs/backend/codex-runtime/src/lib/codex-approval-bridge.ts:29, 324-326` uses a 240,000 ms approval timeout for user input too. Claude's idle auto-pick fires at 300,000 ms (`ask-user-question.service.ts:24`). In production the bridge cancels first, so idle auto-pick cannot reach Codex. Bridge owner should make the user-input timer longer than 300,000 ms, for example:

   ```ts
   const DEFAULT_USER_INPUT_TIMEOUT_MS = 310_000;
   // In interact(), for the timer duration:
   request.kind === 'userInput'
     ? DEFAULT_USER_INPUT_TIMEOUT_MS
     : this.approvalTimeout()
   ```

   Keep approval prompts at 240,000 ms. The existing `finish()` aborts the adapter signal, clearing the shared registry on timeout or Stop.
2. **MCP elicitation:** `libs/backend/codex-runtime/src/lib/codex-approval-bridge.ts:365-369` needs a real elicitation-response callback instead of `formContent(params)` on acceptance. A typed callback must gather and validate content for `form`, `openai/form`, `openaiForm`, and URL actions, then return `{ action, content? }` to the bridge; the current UI has no form contract to supply that content. This also requires work outside this lane in the shared elicitation UI/host surface. No MCP code was stripped or changed.
3. **Secret UI:** `libs/frontend/chat-ui/src/lib/molecules/question-card.component.ts:202` renders free text with `type="text"`; handling `isSecret` as masked input requires a shared question contract and UI change outside this lane. The current adapter avoids logging answers but cannot hide them on screen.

## Not done

- No verification, tests, lint, typecheck or build were run under the explicit task rules.
- The bridge timeout, MCP elicitation UI and masked secret input are outside the allowed edit paths.
