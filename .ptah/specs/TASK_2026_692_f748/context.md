# Task Context - TASK_2026_692_f748

## User Request
"idle compaction is something i wanted to include into our workflow and its now supported in claude
code can u check if that's something we can utilize in the claude agent sdk as well or we need to
build manually as its crucial for saving usage"
Follow-up: "yeah lets start that and lets build a performant multi session aware handler with rxjs
if possible"

## Task Type
FEATURE

## Complexity
Medium-Complex

## Strategy
FEATURE, Full depth: project-manager -> software-architect -> team-leader -> QA (code-logic review,
senior-tester). No UI surface is added beyond a setting and a notice, so no designer phase.

Worktree: D:\projects\ptah-extension\.claude-worktrees\idle-compaction (branch feat/idle-compaction)

## CLI Lanes
- Preference source: memory `orchestration-executor-preference` (lanes-first, cross-family review).
  Conflicting older memory `cli-lane-token-burn` (avoid big Codex quota use) noted.
- Mode: enabled. Approval: lane-review.
- Roster (2026-10-17): codex confirmed room (weekly 76%); grok near limit 94%; opencode near limit
  (monthly 93%); antigravity unknown (reader failed); Glm (ptah-cli, Ollama Cloud) unknown;
  copilot disabled; cursor, pi not installed.
- Plan: Claude subagents author documents/plans; codex lane does cross-side document review and
  implementation batches; code-logic review by a different family than the implementer.

## Conversation Summary
Research done before this task (orchestrator, 2026-10-17):
- Installed `@anthropic-ai/claude-agent-sdk` 0.3.278 (CLI 2.1.278). Latest 0.3.302 (CLI 2.1.302).
- 0.3.302 settings schema adds `idleCompaction?: boolean` — an off switch only ("Setting it to true
  does not turn idle compaction on"). No Options field, hook or control request starts it.
- Bundled CLI logic (`Z2t` class): arms after each turn only when `G2()` is true (interactive, or
  entrypoint in an allowlist: claude-vscode, claude-desktop, remote, claude-in-slack, ...; `sdk-ts`
  is NOT listed), GrowthBook flag `tengu_sunny_locket` mode != off (default off), last request used
  1h cache TTL. Fires at lastActivity + 0.9 * (expiresAt - lastActivity) (fraction clamp 0.5-0.95).
  Refuses when: auto-compact off, idleCompaction off, prompt prefix changed, TTL not 1h, fired
  >60s late or cache not warm ("lapsed"), context < minTokens (default 200K, env
  CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS, floor 100K), a newer request started, usage near limit.
  Modes: `compact` (compact while idle) and `compact_on_return` (precompute summary while idle,
  swap it in when the user returns).
- Decision: build it manually in Ptah; do not spoof CLAUDE_CODE_ENTRYPOINT.
- Existing Ptah compaction: `libs/backend/agent-sdk/src/lib/helpers/compaction/compaction-coordinator.ts`
  (threshold state machine IDLE/ARMED/TRIGGERED/COOLDOWN/BACKOFF), `compaction-hook-handler.ts`,
  `compaction-boundary-generation-registry.ts`, `compaction-config-provider.ts`.
- User asked for a performant, multi-session aware handler, with RxJS if possible.
