# Ptah integration seams

Read-only code survey, 2026-09-20. Condensed from the in-process Explore agent.
The orchestrator spot-checked the rows marked (checked).

## 1. Stream events against AG-UI

Source: `libs/shared/src/lib/types/execution/stream.ts:34` (`StreamEventType`, 20 kinds) and
`stream-background.ts:288` (`FlatStreamEventUnion`).

| Ptah kind                                                                                                                            | Closest AG-UI event                    | Gap                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------- |
| `message_start`                                                                                                                      | `TEXT_MESSAGE_START` (+ `RUN_STARTED`) | `inboundPeer` has no counterpart  |
| `text_delta`                                                                                                                         | `TEXT_MESSAGE_CONTENT`                 | `blockIndex` has no field         |
| `message_complete`                                                                                                                   | `TEXT_MESSAGE_END` | `message_complete` can occur more than one time in a run. `RUN_FINISHED` needs a separate run-terminal signal (closest: `turn_state` with a terminal phase). Cost, tokens and model need `CUSTOM`. |
| `thinking_start` / `thinking_delta`                                                                                                  | `REASONING_*`                          | `signature` has no field          |
| `tool_start` / `tool_delta` / `tool_result`                                                                                          | `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` + `TOOL_CALL_RESULT` | Ptah emits no separate end-of-arguments event. An encoder must synthesize `TOOL_CALL_END` before `TOOL_CALL_RESULT` when `tool_result` arrives. |
| `turn_state`                                                                                                                         | `STATE_SNAPSHOT`                       | best match, revision-stamped      |
| `agent_status`                                                                                                                       | `STATE_DELTA`                          | a hand-made patch                 |
| `compaction_complete`                                                                                                                | none (`CUSTOM`) | `MESSAGES_SNAPSHOT` requires `messages`. This event carries none. |
| `message_delta`, `signature_delta`, `agent_start`, `agent_progress`, `agent_completed`, `background_agent_*` (3), `compaction_start` | none                                   | all become `CUSTOM`               |

`parentToolUseId` and `blockIndex` have no AG-UI field. This agrees with the recorded verdict in
`.ptah/specs/TASK_2026_298/context.md:199`.

## 2. Agent adapter seam

- Wide contract: `IAgentAdapter`, `libs/shared/src/lib/types/agent-adapter.types.ts:190`, approximately 28 members. One
  implementation (`SdkAgentAdapter`), bound by a fixed factory at `libs/backend/agent-sdk/src/lib/di/register.ts:587`.
  Four RPC handler classes inject the concrete `SDK_TOKENS.SDK_AGENT_ADAPTER`.
- Narrow contract: `CliAdapter`, `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts:152`.
  Registration is one line in `cli-detection.service.ts:51-61`. `SdkHandle.onStreamEvent` (`:76-79`) carries
  `FlatStreamEventUnion`.
- Best template for a remote AG-UI endpoint: `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1389-1440`
  (out-of-process JSON-RPC to flat events). Second: `copilot-sdk.adapter.ts`.

## 3. Human-in-the-loop UI

All cards are hand-built. No generic card exists.

- `PermissionRequestCardComponent`, `libs/frontend/chat-ui/src/lib/molecules/permissions/permission-request-card.component.ts:52`
- `QuestionCardComponent`, `libs/frontend/chat-ui/src/lib/molecules/question-card.component.ts:46` (fixed `AskUserQuestionRequest` shape)
- Plan approval has no component. It uses the permission card.
- Mount points: `chat-view.component.html:136,148`, `tool-call-item.component.ts:87-89`,
  `compact-session-activity.component.ts:393,401`, `harness-builder-view.component.ts:306,315`.

## 4. Tool-result rendering

No registry. `@switch` and `@if` chains on string literals:

- `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:118` and `:443-452` (`sdkCardKind`)
- `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-output-display.component.ts:56-63`, `:124`, `:135`, `:145`
- `tool-input-display.component.ts:218-225`, `:257-258`

## 5. MCP surface

- Third-party MCP servers: the vendor SDK owns the connection. Ptah sees only `{ name, status }`
  (`libs/backend/agent-sdk/src/lib/helpers/session-mcp-status-callback-registry.ts:8`). Tool `_meta` and resource
  contents do not reach Ptah.
- The Ptah MCP server: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`. It handles
  `initialize` (`:177`), `tools/list` (`:180`), `tools/call` (`:183`) only (checked). Capabilities are `{ tools: {} }`
  (`:222-234`). No `resources/*`.

## 6. Setup wizard, harness builder, marketplace

- Setup wizard: steps are a literal array, `libs/frontend/setup-wizard/src/lib/services/setup-wizard/wizard-computeds.ts:84-105`.
  View is a `@switch`, `wizard-view.component.ts:112-133`.
- Harness builder: the one existing agent-to-UI push. `ptah_harness_propose_config`
  (`tool-description.builder.ts:1521`) -> `harness-namespace.builder.ts:934-959` -> `harness:config-proposed`
  (`message-constants.ts:165`) -> `harness-builder-state.service.ts:84` -> `harness-config-preview.component.ts:189-264`.
- Marketplace: `JsonSchemaFormComponent`, `libs/frontend/ui/src/lib/native/form/json-schema-form.component.ts:45`
  (checked). Flat objects, five controls. One consumer: `smithery-surface.component.ts:614` (checked).
- Hand-built screens:
  - Consent dialog: `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:62`. Security contract in the
    header, `:22-58`: verbatim command line, no truncation, no `innerHTML`.
  - OAuth: `oauth-surface.component.ts` (chips at `:44-50`).
  - Non-Smithery MCP install: **no env-var form exists**. This is the clearest gap.

## 7. Host constraints

VS Code webview CSP, `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:269-278` (checked):

```
default-src 'none';
script-src 'nonce-${nonce}';
connect-src 'self' ${webview.cspSource};
frame-src 'none';
```

- No iframe exists in the product. The only `iframe` token is a DOMPurify denial,
  `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:43`.
- Electron: `apps/ptah-electron/src/windows/main-window.ts:122-128` (`contextIsolation`, `sandbox`, no `nodeIntegration`).
  No runtime CSP on the app shell.

## 8. Markdown chokepoint

`libs/frontend/markdown` forbids `script, iframe, object, embed, form, input, textarea, select, button`. Markdown cannot
carry a form. Host behavior attaches only through an opt-in attribute that agent HTML cannot forge (`:64-69`).

## Seams summary

| Candidate       | Plug-in point                                                                        | Exists                                                   | Missing                                                                | Blast radius                  |
| --------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| AG-UI consume   | new `CliAdapter` + `cli-detection.service.ts:51-61`                                  | flat-event seam, `ptah-cli-registry.ts` template         | AG-UI to flat-event transformer, HTTP/SSE transport                    | small, backend only           |
| AG-UI expose    | encoder beside `http-mcp-server.service.ts`                                          | 20 typed events, `turn_state`                            | encoder, 10 kinds become `CUSTOM`                                      | small to medium, backend only |
| A2UI renderer   | `json-schema-form.component.ts`, `execution-node.component.ts:443`, new push message | harness propose-config chain, schema form, question card | component catalog, action channel, component registry                  | large, highest value          |
| MCP Apps host   | new iframe host, CSP line `:276`, MCP interception                                   | nothing                                                  | blocked by `frame-src 'none'` and by no view of third-party MCP frames | very large, security policy   |
| MCP Apps author | `protocol-dispatcher.ts:177-183`, `:222-234`                                         | MCP server on HTTP and stdio                             | `resources/list`, `resources/read`, `ui://` assets                     | small, low value alone        |
