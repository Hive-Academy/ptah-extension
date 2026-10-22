# Task Context — TASK_2026_713_e067

## User request
Improve implicit skill selection across workspaces. Angular is only an example. Scope enhancements to plugin skills shipped under apps/ptah-extension-vscode/assets/plugins. Add a general skill-use rule to agent-generation templates, preserving setup-wizard placeholders. Execute with /orchestrate in a separate worktree.

## Strategy
REFACTORING, Partial: architect → independent cross-side plan review → team-leader decomposition → implementation → scoped verification and representative routing evaluation. No UI changes.

## Scope
- Shipped plugin skill descriptions: clear WHAT/WHEN, implicit task triggers and boundaries, no repository-specific stack assumptions.
- Agent-generation templates: shared generic rule for assigned and discovered relevant skills, actual loading rather than name recognition, permitted fallback and blocked-skill reporting.
- Directly related validation/tests proving template expansion preserves the rule and placeholders.
- Preserve existing skill capabilities, names and invocation identifiers. Body trigger relocation only where necessary, without deleting capability instructions.

## Exclusions
No local .claude/skills copies, generated workspace agents, session prompt/discovery/capability runtime changes, UI, or broad refactors. No commit, push, or PR without explicit user request.

## Worktree
D:/projects/ptah-extension/.claude-worktrees/skill-routing
Branch: refactor/skill-routing; base: main at 0fc0c3a09.
Main checkout existing changes belong to other work and remain untouched.

## CLI lanes — Gate 0.1
Preference from memory: lanes first, cross-family reviews. Enabled. Approval: lane-review.
Live roster: codex disabled (confirmed room), copilot disabled, cursor/pi absent; opencode AT LIMIT monthly 100%, reset 2026-11-04 11:44 UTC; antigravity installed but limit unknown (reader failed); grok installed, confirmed room weekly 55%; Glm available ptah-cli pc-355b645d-35af-4974-84cf-9cf961ea0164 provider Ollama Cloud, limit unknown.
Planning lane: grok/software-architect. Plan reviewer: independent in-process software-architect (required opposite execution side). Subsequent assignments announced before spawning.
Initial planning: one lane call plus one review call. At most two revision pairs per document if required, announce before use. Maximum 40 tool calls per lane.

## Review recovery
Glm review agent 4b2a4d91-c02b-4f23-8ef2-77ed8d512428 produced no review artifact. Output ended with provider 429 session usage limit. Live roster confirms ptahCliId pc-355b645d-35af-4974-84cf-9cf961ea0164 (family Ollama Cloud) AT LIMIT, reset unknown. Skip that lane for the rest of this run unless fresh confirmed room overrides it. Antigravity is installed with unknown limit (reader failed) and is the next different-family review candidate. No review verdict claimed.
Antigravity review agent b4d48d9e-7eee-43cc-be5d-4eed802dbcf3 failed before work: Individual quota reached, RESOURCE_EXHAUSTED 429, reset interval 103h54m15s at 2026-10-22 approximately 16:17 UTC. This is quota evidence, not a timeout. Skip this lane until reset clears. Subagent reason: all alternative different-family CLI reviewers are disabled, absent, or confirmed quota-blocked. Independent in-process code-logic-reviewer fallback uses OpenAI Codex family versus implementer grok; record workflow weaker-evidence label for subagent fallback. Review still pending.

## Verification rules
Electron first even though plugin sources live under the extension assets path. No VS Code/TUI feature or polish work. Keep shared hosts compiling. Only changed-project checks, Nx --parallel=1, Jest --maxWorkers=2; one heavy check at a time across all lanes. No workspace-wide checks and no build/serve/dev/e2e/package unless requested.

## Prior evidence
Read-only investigation identified missing role skill-use instructions and potentially weak description delivery. Delivery defects are excluded from implementation scope and must be reported separately. Description changes alone are not proof of automatic loading. Distinguish static validation, routing evaluation, and observed real skill invocation.
