# Batch 8h-4

Reproduction: inspected the active-record branch, which rejected every defined key except prompt/tabId as activeResumeConfig. The renderer's projectPath alone triggered this failure after the broadcaster ended while the adapter retained its session.
Added the renderer-shaped regression spec before changing production code (codex-chat-adapter.spec.ts:551); no executable reproduction or tests were run, per the mandatory prohibition.

Fix: codex-chat-adapter.ts:88 adds the narrow checkOptions port; :213 invokes it before starting an active-session turn.
codex-chat-host-ports.ts:149 delegates to the frozen classifyCodexChatOptions classifier and throws CodexChatOptionError for the first rejected key.
Ambient inputs are discarded by classification and never passed to the turn. Supported session-level keys (model, effort, systemPrompt, etc.) are accepted but NOT reapplied to an already-open thread; only config.prompt drives this turn. This limitation is documented in code.
The new path emits no logs or notices. Existing profile() changes from batch 8h-1 remain intact.

Coverage added: renderer-shaped second send, prompt forwarding, no profile/settings reapplication, and unchanged host error propagation for temperature and mcpToolProfile='apps' (adapter spec:551, :573).
Host specs (:159, :176) cover ambient acceptance, coding profile acceptance, concrete CodexChatOptionError rejection, and absence of logs/notices (including values).

Error-code path: checkOptions throws CodexChatOptionError directly; resumeSession does not wrap it in safe(), failure(), or unsupported(). ChatSessionService.codexFailure (chat-session.service.ts:532-548) recognizes that exact class directly (also supports an adapter error cause), yielding CODEX_UNSUPPORTED_OPTION. No session-service edits.

Fake audit: the only incomplete full-port fake was codex-chat-adapter.spec.ts:129; added checkOptions: jest.fn() at :130. No other fake changes were needed.
Electron codex-runtime-composition.spec.ts:470 spreads resolved real ports and inherits checkOptions; codex-session-settings-record.spec.ts uses only the profile return type.

Every modified/written absolute path:
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8h-4-report.md

Not performed: verify/test/lint/typecheck/build, diagnostics, installations, or git commands. Regression specs are unexecuted; runtime reproduction remains for the coordinator's authorized verification lane.
