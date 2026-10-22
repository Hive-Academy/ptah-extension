# Task context

## User request
User approved orchestration of the discussed App Server-first integration: native Codex for main chat and eventually delegated lanes, shared configuration and execution rather than duplicate SDK/proxy paths, unchanged working Claude Agent SDK, no runtime selector exposed in UI. Immediate deliverable: reviewed requirements, parity inventory, protocol/T3 Code research, and architecture before implementation. Preserve permissions, effort, authentication/account isolation, MCP, skills/instructions, streaming, interruption/resume, usage, subagent controls and compaction. Unsupported equivalents must be explicit, never silent permission weakening. Electron first.

## Strategy
FEATURE, Full. PM/inventory -> independent review -> research -> architecture -> independent review. No application edits, commits, pushes or removals in this planning phase. Existing native-loop worktree is out of scope. Existing task worktree is D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat, branch feat/codex-sdk-main-chat, base 0fc0c3a09. Main advanced since creation; reconcile before implementation, not silently during inventory.

## CLI lanes
Preference source: workspace memory orchestration-executor-preference and lane-review-approval-mode. Lanes enabled. Approval: lane-review for document gates; removals/security policy changes escalate to user. Final reviewed architecture presented before application code.
Live roster: codex disabled(installed), confirmed room; copilot disabled(installed), unknown; cursor not installed; antigravity installed, unknown(reader failed); opencode installed AT LIMIT monthly until 2026-11-04; pi not installed; grok installed, confirmed room (72% weekly); Glm pc-355b645d-35af-4974-84cf-9cf961ea0164 available but AT LIMIT reset unknown. Use grok for bounded PM/research/architect authoring with in-process independent document reviews. No force-spawn or enable disabled lanes.
Cost cap: three authoring calls (PM, research, architecture), two initial gate reviews, at most two revision pairs per gate. Each lane max 40 tool calls. Research report is an input, not a third approval gate.

## Verified preflight inputs
- Electron phase-2-libraries.ts:328 and agent-sdk/src/lib/di/register.ts:942 bind IAgentAdapter to SdkAgentAdapter.
- rpc-handlers/src/lib/chat/session/chat-session.service.ts:863 resolves workspace provider and calls startChatSession. Preserve isolation.
- auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:166 and workspace-provider-profile-resolver.ts:344 activate Codex translation proxies.
- cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:557 hardcodes danger-full-access; codex/codex-lane-config.builder.ts:129 sets approval_policy never. These are lane policies, not universal defaults.
- Native lane contract uses SdkHandle/CliOutputSegment; main chat uses IAgentAdapter/FlatStreamEventUnion with session ownership.
- Lane abort controller spans turns; no steering or per-turn interruption advertised. Native thread resume exists. Preserve Windows terminal-event teardown workaround.
- Lane config restricts external MCP and skills; do not inherit suppression for main chat.
- CodexHomeResolver honors CODEX_HOME but adapter auth helper uses home .codex/auth.json; verify account consistency.
These are preflight claims to verify against this worktree, not sufficient implementation evidence.

## Verification constraints
Only changed projects/dependent hosts when shared code changes. No workspace-wide checks. No build/serve/dev/e2e/package unless requested. Nx --parallel=1; Jest --maxWorkers=2; one heavy check globally, coordinate with peer sessions. No heavy checks during planning. Later user-requested Electron dev validation must be coordinated. No TUI/VS Code feature work; retain host compatibility with minimal changes only. No commits without explicit user request.

## Resume 2026-10-22 (session 2)
Lane 22f5b8ed (grok, plan revision 1) completed exit 0; independent re-review APPROVED (spike + disabled route only). HANDOFF.md predates that re-review.
Roster at resume: codex installed confirmed room (weekly 22%); grok confirmed room (weekly 89%); opencode AT LIMIT monthly until 2026-11-04; Glm AT LIMIT reset unknown; copilot disabled; antigravity unknown.
Audit lane b2bb84d1-554d-43cd-99da-268e5993aa47 (codex, researcher-expert) -> plan-alignment-audit.md.

## User direction 2026-10-22 (supersedes "eventually" lanes staging)
"I don't want to end up having 3 ways for Codex." Target end state: ONE Codex runtime = App Server, shared by main chat AND CLI lanes, with no duplicated or tangled code. Today there are 2 paths: (1) main chat = Claude Agent SDK + codex-translation-proxy; (2) lanes = @openai/codex-sdk in codex-cli.adapter.ts. Both are migration sources, retired once App Server parity is proven. Follow-up after evidence: measure which Claude harness tools Codex lacks and offer them natively in Ptah (provider-neutral harness for both providers).
Plan revision round 2 (final) lane d12f02a0-ba68-498b-9af7-7e0e6d15ee42 (codex, software-architect; fresh lane, resume refused: context > 60k). Reviewer next: grok.
Revision round 2 delivered by d12f02a0 (codex): 453-line plan, new lib @ptah-extension/codex-runtime, G1-G13 register, removals A (proxy) and B (codex-sdk lanes). Gate 2 review lane 11e28d10-8f05-4da8-86fc-65ba8bf70395 (grok) -> implementation-plan-review.md.
Author lane d12f02a0 CLI Session ID 01a164f2-8253-70b0-bf7f-b01858c3dfda (for post-review fixes).
Bounded post-cap fix lane 5d425073-5ba9-4f25-9a31-a35ef05c9b6f (codex; fresh, resume refused: context > 60k). Grok now near limit (90% weekly): scoped re-check only.
Fix 5d425073 delivered (486 lines; orchestrator verified slash router owned x8, gateway owner :388, Removal A incl. proxy-pool :82/:500 and gateway :693, 8-turn cap :475). Scoped re-check lane e21544fb-d008-44ca-b525-f0f18e08a853 (grok, near limit 90%).
