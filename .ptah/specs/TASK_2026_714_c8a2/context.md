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
Planning docs committed 0c910f80c, pushed; draft PR https://github.com/Hive-Academy/ptah-extension/pull/809. Waiting for user APPROVED to start evidence spike.
Batch 1a (spike tooling, code only, no real run) lane 95acdfe0-f659-4489-a64b-ca22c218a08d (codex, backend-developer) -> batch-1a-report.md. Heavy-check slot claimed from peers 712 and 710 for its scoped checks; release when lane ends. Sequence: 1a implement -> grok harness safety review -> 1b real run (8-turn cap) -> evidence check.
Batch 1a delivered (95acdfe0): scaffold + generator + harness (536 lines) + cases (8 turns) + spec 14/14; final guard added after typecheck (re-typecheck needed before run). Slot released to 712/710/807. Safety review lane 08c9467d-346e-45bc-af37-1c80ed532f57 (grok, code-logic-reviewer) -> code-logic-review-batch-1a.md.
Batch 1a fix lane f94a05b4-2c1e-42b1-9e13-8515321f9e5b (codex, fresh; resume refused >60k). Lane runs no checks; orchestrator runs typecheck+jest under slot after. Grok 93% weekly.
Fix round f94a05b4 delivered (harness 771 lines; policy untrusted at all levels, yolo/auto-edit workspace-write, fatal handlers :705). Scoped re-review lane 9fdbec0d-4d94-4a4b-980e-82351db353c5 (grok, fresh). Heavy-check queue: 710 (holds) -> skill-routing -> 712 -> 714; wait for "released" from 712.
Generator run OK with bundled 0.155.1 (offline schema export, no auth): schema 697KB + manifest; 102 requests, 10 server requests (incl. item/tool/requestUserInput, item/permissions/requestApproval, mcpServer/elicitation/request), 82 notifications (incl. item/plan/delta); decision literals include accept, acceptForSession, decline, deny. Dry run OK (ts-node compiled harness, 8 cases listed). Remaining before --run: Jest spec under heavy-check slot (queue: 710 -> skill-routing -> 712 -> 714).
Checks passed under slot (jest 28/28, typecheck OK); slot released (710 inbox gone). Real spike run started in background (task b29h6sh0q): bundled codex 0.155.1, model gpt-5.1-codex-mini, auth copy from %USERPROFILE%/.codex/auth.json, out spike-run.md, log /tmp/spike-run.log. After: verify temp auth copy deleted (no $TEMP/ptah-codex-evidence-* left).

## Triage 2026-10-30 (premise audit)

Verdict: PARTIAL (lane codex, verified by Claude). Title unchanged: task is in_progress.

- The runtime core is on main: #809 (b73a6ff74) added `libs/backend/codex-runtime`, but its registration enables no route (`main:libs/backend/codex-runtime/src/lib/di/registration.ts:27`).
- The old `CodexCliAdapter` is still exported (`main:libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/index.ts:22`).

Remaining scope: wire the gated codex-runtime into Electron chat, session controls, gateway and CLI lanes, prove parity, then retire the proxy and SDK lane paths under the recorded rollout gates.
