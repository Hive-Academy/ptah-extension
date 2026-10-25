# Task Context - TASK_2026_718_15b7

## User Request
See /orchestrate arguments: chat unit-test console hygiene (NG0914, IntersectionObserver,
ModelStateService / config:pricing-get / session:cli-sessions RPC mocks, NG0101, TabManager mock)
and the session-create e2e flake. Codex lanes implement and review; orchestrator plans, verifies,
commits. Max 3 lanes, never grok/opencode. No local e2e runs without user approval.

## Task Type
BUGFIX

## Complexity
Medium

## Strategy
BUGFIX, Partial, plan-free: orchestrator investigation -> codex implementation lanes ->
orchestrator verification -> codex review -> commit/push/PR/CI watch.

## CLI Lanes
Preference source: current user instruction (codex for implementation and review) + memory
(orchestration-executor-preference: lanes first, codex first).
Mode: enabled. Approval: lane-review (no document gates in this plan-free BUGFIX).
ptah_agent_list rows (2026-10-24):
| codex | cli | installed | messaging: queue | confirmed room (Weekly 0%) |
| copilot | cli | disabled (installed) |
| cursor | cli | not installed |
| antigravity | cli | installed | unknown (reader failed) |
| opencode | cli | installed | excluded by user |
| pi | cli | not installed |
| grok | cli | installed | excluded by user |
| Glm | ptah-cli | available | provider: Ollama Cloud | unknown |

## Conversation Summary
Worktree .claude-worktrees/chat-test-hygiene on fix/chat-test-hygiene from origin/main 47f65df38
(local main was behind).
