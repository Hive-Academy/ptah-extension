# TASK_2025_178: Detailed Task Checklist

## Phase 1: `no-unused-vars` (115 warnings)

### Batch 1A: agent-sdk (30 warnings)
- [ ] `sdk-permission-handler.ts` — Remove unused `_toolUseId`, `_options` params
- [ ] `sdk-message-transformer.ts` — Remove unused imports: `MessageTokenUsage`, `UUID`, `UserMessageContent`, `SDKResultMessage`, `SDKSystemMessage`, `ToolUseBlock`
- [ ] `compaction-hook-handler.ts` — Remove unused `_options` param
- [ ] `subagent-hook-handler.ts` — Remove unused `_options` param
- [ ] `prompt-cache.service.ts` — Remove unused `QueryFunction` import
- [ ] `prompt-designer-agent.ts` — Remove unused `INVALIDATION_TRIGGER_FILES`
- [ ] `prompt-designer-agent.spec.ts` — Remove unused `PromptDesignerOutput`, `PromptDesignerResponseSchema`
- [ ] `internal-query.service.ts` — Remove unused imports: `QueryFunction`, `isStreamEvent`, `isUserMessage`, `isAssistantMessage`
- [ ] `sdk-agent-adapter.ts` — Remove unused `_explicitModel`
- [ ] `history-event-factory.ts` — Remove unused `msg`
- [ ] `stream-transformer.ts` — Remove unused `segmentBuffer`, `segmentCallbacks`, `streamEventBuffer`, `streamEventCallbacks`
- [ ] `sdk-query-options-builder.ts` — Remove unused imports: `ContentBlock`, `ToolUseBlock`, `isToolUseBlock`, `SharedPermissionRequest`
- [ ] `session-lifecycle-manager.ts` — Remove unused `requestId`

### Batch 1B: ptah-extension-vscode (21 warnings)
- [ ] `assets/.../scene-template.component.ts` — Remove 13 unused 3D component imports
- [ ] `assets/.../bubble-dream-hero.component.ts` — Remove unused `signal` import
- [ ] `webview-html-generator.ts` — Remove unused `_context`, `_token` params
- [ ] `setup-rpc.handlers.ts` — Remove unused `recommendationService`
- [ ] `wizard-generation-rpc.handlers.ts` — Remove unused `ProjectAnalysisResult` import
- [ ] `rpc-method-registration.service.ts` — Remove unused `SessionId` import
- [ ] `ptah-extension.ts` — Remove unused `error` in catch
- [ ] `angular-webview.provider.ts` — Remove unused `context` param

### Batch 1C: vscode-core (19 warnings)
- [ ] `file-system-manager.ts` — Remove unused `writeOptions`, `error` (x2), `watcherId`, `eventType`, `uri`, `errorCode`
- [ ] `output-manager.ts` — Remove unused `error` (x5)
- [ ] `status-bar-manager.ts` — Remove unused `error` (x5), `command`
- [ ] `agent-session-watcher.service.ts` — Remove unused `_sessionId`

### Batch 1D: chat (14 warnings)
- [ ] `agent-card-output.component.ts` — Remove unused `signal` import
- [ ] `chat-input.component.ts` — Remove unused `SlashTriggerEvent` import
- [ ] `chat-input.component.ts` — Remove unused `_` assignments (x3)
- [ ] `execution-tree-builder.service.ts` — Remove unused `_originalType`
- [ ] `chat-input.component.spec.ts` — Remove unused `_event`
- [ ] `streaming-handler.service.ts` — Remove unused `effect` import
- [ ] `plugin-status-widget.component.ts` — Remove unused `PluginInfo`, `PluginConfigState` imports
- [ ] `tool-output-display.component.ts` — Remove unused `TodoWriteInput`, `EditToolOutput` imports
- [ ] `chat.store.ts` — Remove unused `ChatSessionSummary` import
- [ ] `conversation.service.ts` — Remove unused `computed` import

### Batch 1E: llm-abstraction (9 warnings)
- [ ] `vscode-lm.ts` — Remove unused `completionConfig`
- [ ] `vscode-lm.provider.ts` — Remove unused `error`
- [ ] `agent-process-manager.service.spec.ts` — Remove unused `result`
- [ ] `codex-cli.adapter.spec.ts` — Remove unused `sdkImportCallCount`
- [ ] `copilot-sdk.adapter.ts` — Remove unused `_options`, `_invocation` (x2)
- [ ] `cli-skill-manifest-tracker.ts` — Remove unused `_`
- [ ] `llm-secrets.service.ts` — Remove unused `trimmedKey`

### Batch 1F: workspace-intelligence (7 warnings)
- [ ] `quality-assessment.interfaces.ts` — Remove unused `AntiPatternType` import
- [ ] `code-quality-assessment.service.ts` — Remove unused `DEFAULT_SAMPLING_CONFIG`, `FileType`
- [ ] `services.spec.ts` — Remove unused `mockLogger`
- [ ] `project-intelligence.service.ts` — Remove unused `workspaceUri`
- [ ] `reporting.spec.ts` — Remove unused `AntiPattern`, `QualityGap`

### Batch 1G: vscode-lm-tools (6 warnings)
- [ ] `ide-namespace.builder.ts` — Remove unused `VisibleRange` import, `options` param
- [ ] `llm-namespace.builder.ts` — Remove unused `error`
- [ ] `system-namespace.builders.ts` — Remove unused `error` (x3)

### Batch 1H: core + template-generation + ui (9 warnings)
- [ ] `core/claude-rpc.service.ts` — Remove unused `RpcResult` import
- [ ] `core/autopilot-state.service.ts` — Remove unused `SessionListParams`, `SessionLoadParams`, `FileOpenParams` imports
- [ ] `core/model-state.service.ts` — Remove unused `RpcResult` import
- [ ] `template-generation/template-generator.service.spec.ts` — Remove unused imports
- [ ] `template-generation/content-processor.service.ts` — Remove unused imports
- [ ] `ui/autocomplete.component.spec.ts` — Remove unused `FocusTrapFactory`

---

## Phase 2: `explicit-member-accessibility` (119 warnings)

### Batch 2A: setup-wizard (111 warnings)
- [ ] Run `npx nx lint setup-wizard --fix` for auto-fix
- [ ] Verify: All 15 component/service files get `public` modifiers
- [ ] Files: wizard-view, welcome, scan-progress, analysis-results, analysis-transcript, analysis-stats-dashboard, analysis-activity-indicator, agent-selection, generation-progress, premium-upsell, confirmation-modal, enhanced-prompts-summary-card, setup-wizard-state.service, wizard-rpc.service, tool-output-formatter.service
- [ ] Spec files: welcome.spec, scan-progress.spec, completion.spec, agent-selection.spec, setup-wizard-state.service.spec, wizard-rpc.service.spec

### Batch 2B: ptah-landing-page (8 warnings)
- [ ] Run `npx nx lint ptah-landing-page --fix` for auto-fix
- [ ] Files: trial-ended-modal.component.ts, docs-collapsible-card.component.ts

---

## Phase 3: `no-explicit-any` (134 warnings)

### Batch 3A: vscode-lm-tools (34 warnings)
- [ ] `types.ts` — Replace `any` with proper execution context types
- [ ] `core-namespace.builders.ts` — Type API handler params/returns
- [ ] `ast-namespace.builder.ts` — Type AST analysis params/returns
- [ ] `ide-namespace.builder.ts` — Type IDE integration params/returns
- [ ] `llm-namespace.builder.ts` — Type LLM call params/returns
- [ ] `orchestration-namespace.builder.ts` — Type orchestration params/returns
- [ ] `system-namespace.builders.ts` — Type system namespace params/returns

### Batch 3B: workspace-intelligence (23 warnings)
- [ ] `tree-sitter-parser.service.ts` — Type parsed AST nodes
- [ ] `tree-sitter-parser.service.spec.ts` — Type test mocks
- [ ] `ast-analysis.service.ts` — Type analysis results
- [ ] `ast-analysis.service.spec.ts` — Type test mocks
- [ ] `workspace-analyzer.service.ts` — Type composite analysis
- [ ] Quality services + specs — Type assessment interfaces

### Batch 3C: chat (21 warnings + 8 template `$any()`)
- [ ] `agent-card-output.component.ts` — Type segment rendering
- [ ] `chat.store.ts` — Type store state mutations
- [ ] `chat-input.component.ts` — Type event handlers
- [ ] `agent-orchestration-config.component.ts` — Type config state
- [ ] `ptah-cli-config.component.ts` — Type CLI config
- [ ] Template `$any()` casts (8) — Replace with typed expressions
- [ ] Settings components — Type config interfaces

### Batch 3D: setup-wizard (18 warnings)
- [ ] Component state types across ~10 component files
- [ ] Service method signatures

### Batch 3E: vscode-core (9 warnings)
- [ ] `file-system-manager.ts` — Type filesystem operation results
- [ ] `rpc-handler.ts` — Type RPC message payloads
- [ ] `webview-message-handler.service.ts` — Type webview messages
- [ ] `license.service.ts` — Type license API responses

### Batch 3F: agent-sdk + llm-abstraction (16 warnings)
- [ ] agent-sdk: Type SDK message/event interfaces
- [ ] llm-abstraction: Type provider responses, LLM service params

### Batch 3G: remaining (13 warnings)
- [ ] template-generation (5) — Type template processing
- [ ] shared (3) — Type utility functions
- [ ] ptah-extension-vscode (3) — Type extension handlers
- [ ] ptah-extension-webview (1) — Type app component
- [ ] ui (1) — Type component spec mock

---

## Phase 4: `no-non-null-assertion` (135 warnings)

### Batch 4A: workspace-intelligence (48 warnings)
- [ ] `tree-sitter-parser.service.ts` — Optional chaining for AST node access
- [ ] `ast-analysis.service.ts` — Null guards for analysis results
- [ ] Quality services — Safe property access on assessment data
- [ ] Specs — Safe mock access patterns

### Batch 4B: llm-abstraction (25 warnings)
- [ ] `provider-registry.ts` — Guard provider lookups
- [ ] `llm.service.ts` — Guard service chain calls
- [ ] `agent-process-manager.service.ts` — Guard process state access
- [ ] `copilot-sdk.adapter.ts` — Guard SDK response access
- [ ] `vscode-lm.provider.ts` — Guard VS Code LM API calls

### Batch 4C: vscode-lm-tools (18 warnings)
- [ ] Namespace builders — Optional chaining on VS Code API returns
- [ ] MCP handlers — Guard tool execution results

### Batch 4D: agent-sdk (14 warnings)
- [ ] `ptah-cli-registry.ts` — Guard registry lookups
- [ ] `ptah-cli-adapter.ts` — Guard adapter state
- [ ] `session-lifecycle-manager.ts` — Guard session state
- [ ] `provider-models.service.ts` — Guard model data

### Batch 4E: setup-wizard (9 warnings)
- [ ] Component templates — Safe property access with `?.`

### Batch 4F: vscode-core (8 warnings)
- [ ] `file-system-manager.ts` — Guard file operation results
- [ ] `license.service.ts` — Guard license data access
- [ ] `agent-session-watcher.service.ts` — Guard session watcher state

### Batch 4G: shared + chat + ptah-extension-vscode (13 warnings)
- [ ] `shared/result.ts` — Guard result unwrapping (6)
- [ ] `chat` services (5) — Guard store access
- [ ] `ptah-extension-vscode` (2) — Guard extension state

---

## Phase 5: Angular Template Issues (16 warnings + 1 error)

### 5A: `prefer-ngsrc` (1 ERROR)
- [ ] `chat-input.component.ts:106` — Replace `[src]` with `[ngSrc]`, import `NgOptimizedImage`

### 5B: `template/no-any` (8 warnings)
- [ ] `chat` templates — Remove `$any()` casts, use typed template expressions

### 5C: `click-events-have-key-events` (7 warnings)
- [ ] `setup-wizard` components (7 files) — Add `(keydown.enter)` to `(click)` elements

---

## Final Verification

- [ ] Run `npx nx run-many --target=lint --all` — expect 0 warnings, 0 errors
- [ ] Run `npx nx run-many --target=test --all` — expect all tests pass
- [ ] Test a commit with pre-commit hooks enabled (no `--no-verify`)
- [ ] Commit all changes in 5 phase-based commits
