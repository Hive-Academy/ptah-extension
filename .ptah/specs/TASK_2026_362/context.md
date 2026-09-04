# TASK_2026_362 — Native Ptah agent loop on pi-ai

## User intent (verbatim, condensed)

> What is an equivalent to the Claude Agent SDK, in the way OpenCode and Pi use
> internally? I want to build my own LLM loop and replace the Claude Agent SDK.
> I tried Deep Agents from LangChain before and did not like it, because I have
> built my own tools in the Ptah MCP server. I think we can author a more
> optimized, performant AI SDK ourselves and compare against other coding tools,
> for example the new DeepSeek Harness. Research as of Aug 2026.

> How does Deep Agents play in this? What if we did something on our own,
> similar to Deep Agents but our own way, like pi-ai? I want an authentic loop
> that is distinguishable from the other tools. Before, we had the Deep Agent
> SDK and the Claude Agent SDK as two options users could choose from.

> File a task for this. Use CLI agents, not subagents. We will install pi-ai and
> have our own MCP tools as native tools in it. What about the other features
> the Claude Agent SDK gives?

## Decisions so far

- Provider layer: `@earendil-works/pi-ai` (MIT, v0.84.4, 2026-08-28). Pin exact.
  Wrap behind an `ILlmStream` port. Do not depend on `pi-agent-core`; copy its
  shape.
- Two conductors behind the existing `IAgentAdapter` port in `libs/shared`:
  `SdkAgentAdapter` (existing, keeps Claude subscription OAuth) and a new
  `NativeAgentAdapter`. Restore a per-session runtime choice. The previous
  `ptah.runtime` selector and `libs/backend/deep-agent-sdk` were deleted on
  2026-04-23 (commit `91397c571`); the seam survives.
- Ptah `ptah_*` tools (51, in `vscode-lm-tools`) become in-process native tools
  for the native loop. The HTTP MCP server stays for external CLIs.
- Frontend contract unchanged: the loop emits `FlatStreamEventUnion`
  (`libs/shared/src/lib/types/execution/stream-background.ts:214-233`).
- Design references: DeepSeek Harness turn/step event taxonomy and the
  "model-visible means logged" session-log invariant; Pi steer/followUp inbox
  and 4-tool core; Deep Agents two-tier context management, backend-ported file
  tools, subagent spec, dangling tool-call repair.
- Eval first: add a Terminal-Bench 2.0 adapter to `ptah-cli` so the native
  conductor, the SDK conductor, Pi and DeepSeek Harness can be compared on one
  model.

## Orchestration

- Strategy: FEATURE (Full). Research phase done inline; see
  `research-report.md`.
- Execution mode: **CLI agents only** (user instruction). No `Task` subagents.
- `cli_delegation: enabled`
- Available CLI agents (2026-08-31): codex (installed), antigravity (installed),
  copilot (installed, disabled), ptah-cli "claude cli"
  (`pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d`), ptah-cli "ollama cloud"
  (`pc-85830910-3d81-4248-84c1-4fa52752dd19`). cursor, opencode, pi not
  installed.
- Next phases: project-manager → `task-description.md`; software-architect →
  `implementation-plan.md`; team-leader → `batches.md`.

## Checkpoint log

- 2026-08-31 Checkpoint 1: `task-description.md` APPROVED by user. Confirmed
  approach: native pi-ai conductor is a second, switchable path beside the SDK
  conductor. SDK stays the default until the native path is complete and
  benchmarked. Next: software-architect (CLI agent) → `implementation-plan.md`.
- 2026-08-31 Architect (CLI agent `ef3c1f8d`, session `5567c329`) wrote
  `implementation-plan.md` (Phase 1, 409 lines, 7 libs, 9 batches). Two
  deviations: JSONL session-log adapter for the VS Code host (no SQLite
  there); `'native'` added to `ProviderId`. Awaiting Checkpoint 2 approval.
- 2026-08-31 Checkpoint 2: `implementation-plan.md` APPROVED by user, both
  deviations accepted. Next: team-leader (CLI agent) → `batches.md`, then
  batch execution by CLI agents.

## Open questions for the PM / architect

1. Session log format: SQLite in `persistence-sqlite` with a JSONL export, or
   JSONL-first with the Claude layout so `skill-synthesis`, `memory-curator`
   and `session-importer` readers keep working unchanged?
2. Which SDK hook events (17 today) must exist in v1 of the native loop, and
   which map to loop events only?
3. File checkpointing / rewind: git-stash style per turn, or defer?
4. Compaction v1: prune + spill + LLM summary in-loop, or also expose the
   Anthropic server-side compaction beta on Anthropic routes?
5. Does the native loop read `~/.ptah/user/**` directly for skills/agents/
   commands, and does `harness-sync` then treat Ptah as the origin?
