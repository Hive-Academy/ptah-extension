# Batches — TASK_2026_876_4949

Source: implementation-plan.md § Team-leader handoff (approved at Gate 2). Component numbers refer to
implementation-plan.md § Component specifications.

| # | Batch | Components | Projects | Executor | Depends on | Status |
|---|-------|------------|----------|----------|------------|--------|
| 1 | Shared contracts | shared part of 2, 4, 5 (rpc types, message constants) | @ptah-extension/shared | grok | — | done |
| 2 | Runtime + tool text | 1, 2 (backend), 4, 7 | @ptah-extension/cli-agent-runtime, @ptah-extension/vscode-lm-tools, @ptah-extension/chat-streaming (broadcaster), plugins/ptah-core SKILL.md | grok | 1 | pending |
| 3 | RPC handler + guard specs | 5 | @ptah-extension/rpc-handlers, ptah-electron (rpc-surface/scenario-sanitizer specs), @ptah-extension/cli-engine (rpc-surface spec) | grok | 2 | pending |
| 4 | Frontend | 2 (store + handler), 3, 6 | @ptah-extension/chat, @ptah-extension/chat-ui | antigravity | 1 (parallel with 2) | pending |

Review: one code-logic review per phase on the combined diff by a family different from the implementer
(grok code → antigravity review; antigravity code → grok review). Final PR review before push.
