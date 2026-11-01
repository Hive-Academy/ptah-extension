Removed the invalid mcpServersOverride field from the live-resume checkOptions test.
Ambient coverage uses existing valid mcpServerRunning, workflowsDisabled, thinking, and outputStyleName fields.
Private prompt, system prompt, instructions, and style values remain covered by assertions that all logger methods stay uncalled.
Reviewed remaining checkOptions tests and adapter resume additions against AgentSessionResumeConfig and inherited AISessionConfig; no other invalid keys found (temperature is inherited).
Modified: D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts
Wrote: D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8h-4c-report.md
Adapter spec required no changes. No verify, test, typecheck, diagnostics, or git commands ran.
