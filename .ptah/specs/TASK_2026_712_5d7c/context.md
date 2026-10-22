# Task Context — TASK_2026_712_5d7c

## User request
User requested investigation of Claude as a CLI lane comparable to Codex and multiple accounts per provider, Claude first and Codex next. After research and a T3 Code comparison: `/orchestrate can we now implement these ?`

## Strategy
FEATURE, Full. PM and parity inventory → cross-side requirements review → Electron design/prototype and review → architecture and review → bounded implementation batches → independent review and scoped verification. No commits or pushes authorized.

## Workspace
All task edits and checks: D:/projects/ptah-extension/.claude-worktrees/provider-accounts on feat/provider-accounts, based on main 0fc0c3a09. Main has unrelated user changes; leave them alone. Task-create MCP allocated the carrier in the main checkout; moved only that newly created folder into this worktree immediately. MCP workspace-root operations can still target main: use absolute worktree paths and verify scope before writing.

## CLI lanes — Gate 0.1
Preference: memory favors lanes-first, cross-side review, lane-review approvals. Most recent general preference uses CLI implementers and in-process reviewers. Specialized design/visual work uses subagents. Mode: enabled. Approval: lane-review. All removals, licensing/security policy decisions and outward actions remain user-reserved.

Live roster at start:
| Agent | Type | Status | Messaging | Limit |
| codex | cli | disabled (installed) | queue | confirmed room |
| copilot | cli | disabled (installed) | queue | unknown |
| cursor | cli | not installed | interrupt | unknown |
| antigravity | cli | installed | queue | reader failed; actual quota exhaustion confirmed earlier in this conversation |
| opencode | cli | installed | queue | AT LIMIT, resets 2026-11-04 11:44 UTC |
| pi | cli | not installed | steer | unknown |
| grok | cli | installed | queue | confirmed room, weekly 51% |
| Glm | ptah-cli | available | queue | unknown, no windows reported |
Glm ID: pc-355b645d-35af-4974-84cf-9cf961ea0164, family Ollama Cloud. Antigravity output reported quota reset ~105 hours after 2026-10-22 15:03 UTC; reader reset unknown, exclude for this run. Never force-spawn disabled/exhausted lanes.

## Research evidence
- SYSTEM_CLI_TYPES in libs/shared/src/lib/types/agent-process.types.ts:74 lacks claude. Adapter registration: libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:57.
- Existing SDK-backed claude-cli provider already supports native authentication. ptah-cli-registry.ts:1537-1552 returns empty authEnv for nativeAuth. build-safe-env.ts:46-86 spreads per-run authEnv after an allowlist.
- Claude quota owner already uses email and organization: libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:523. Codex current owner follows singleton home at :553.
- CodexHomeResolver resolves one path: libs/backend/auth-providers/src/lib/providers/codex/codex-home-resolver.ts:15. Auth, usage App Server, CLI spawn and resume state must share selected home.
- T3 Code current ClaudeAdapterV2 uses Agent SDK query and instance env, SDK permissions/interrupt/MCP APIs. Do NOT assume independent stream-protocol implementation is required for first-class lane UX.
- Official Claude supports CLAUDE_CONFIG_DIR per account; keyless Console Anthropic profiles are an exception. Auth env precedence can override selected login.
- Official Codex supports CODEX_HOME and file/keyring/auto/ephemeral credential stores; isolation of each supported store needs verification.

Sources: https://code.claude.com/docs/en/authentication ; https://code.claude.com/docs/en/agent-sdk/overview ; https://code.claude.com/docs/en/cli-reference ; https://learn.chatgpt.com/docs/auth ; https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md ; https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-codex.md ; https://github.com/pingdotgg/t3code/blob/main/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts

## Proposed implementation boundaries
Expose Claude as first-class selectable lane, prefer reuse of SDK runner after verifying contracts. Named account metadata separate from provider definitions; select account for main sessions and lanes. Claude first, Codex subsequent phase. Per-child configuration environment, never process-global switching or credential copying. Stable account ID bound to run/resume, account-scoped usage/caches/watchers. Preserve existing default login without moving credentials. No shadow-home sharing, silent account failover, or cross-account conversation migration initially. Electron-first UI and tests; keep other hosts compiling with minimal necessary changes.

## Open release question
Anthropic docs restrict third-party claude.ai login/subscription limits without approval. User has not stated approval. Technical work does not establish approval. PM must identify the user-reserved release/onboarding boundary rather than assume permission or remove existing behavior.

## Verification constraints
Only changed projects and dependent host projects required by shared changes. Nx --parallel=1, Jest --maxWorkers=2, one heavy check at a time across lanes. No workspace-wide checks. No build/serve/dev/e2e/package without user authorization. No live account login/logout or paid inference probes without authorization. Visual review must be Electron dark/light; identify any launch permission needed before it runs.
