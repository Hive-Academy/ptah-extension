# Context — TASK_2026_433

## User intent (2026-09-13)

"Rely on an intuitive way for subagents and also CLI agents — rather than running
the subagent (frontend) directly, the CLI (antigravity) could act as that subagent."

The goal is one mental model: **a role is what the work needs; a lane is who runs
it.** `frontend-developer` can run as a Claude subagent, as `agy`, as `codex`, or as a
ptah-cli provider, and the workflow text does not change.

## What exists

- `ptah_agent_spawn` (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:494`)
  takes `task`, `cli`, `ptahCliId`, `model`, `modelTier`, `workingDirectory`,
  `files`, `taskFolder`, `resume_session_id`. No role.
- harness-sync already writes generated agents per target
  (`libs/backend/harness-sync/src/lib/targets/rival-targets.ts` matrix):
  codex `.codex/agents/*.toml`, copilot `.github/agents/*.agent.md`,
  cursor `.cursor/agents/*.md`; **antigravity agents: unsupported** (no documented
  subagent format). Claude: `.claude/agents/*.md`.
- `agy --help` lists `--agent` ("Agent for the current CLI session") and `agy agents`.
  Whether that reads a workspace file Ptah could write is unverified — research item.
- Agents are keyed per workspace (TASK_2026_365).

## Proposed shape (architect to confirm)

1. `ptah_agent_spawn({ role?: string, ... })`. Unknown role → hard error listing the
   roles generated for this workspace (never silently spawn role-less).
2. Resolution: the workspace's generated agent definition for that role (single
   source: the agent-generation output, not the plugin templates).
3. Delivery per adapter capability, reported in the spawn result as
   `roleDelivery: "native" | "preamble"`:
   - native: CLI flag/agent-file selection where the adapter supports it;
   - preamble: role body injected ahead of the task (system prompt where the adapter
     accepts one, otherwise a delimited prefix).
4. `ptah_agent_list` reports per lane which roles it can take natively.
5. The Tribunal UI is redesigned around `role` as needed; its current `(role)` token
   grammar (`vendor-panel.md` §0) is not a compatibility constraint.
6. Skill side (lands with TASK_2026_431 `agent-lanes`): one routing rule —
   pick lane by user pin, else by fit; pass `role`; never paste templates into `task`.

## Research first

- Per CLI: can a spawn select an agent definition non-interactively? (codex exec,
  copilot, cursor-agent, agy `--agent`, opencode/pi — ties into TASK_2026_284.)
- Prompt size: preamble delivery costs the whole template per lane; the TASK_2026_432
  trims directly reduce this.

## Constraints

- Both MCP surfaces (HTTP and stdio) must expose the parameter identically.
- New RPC namespaces, if any, need the dual registration (`rpc.types.ts` +
  `ALLOWED_METHOD_PREFIXES`).
- Do not hardcode a CLI → capability table in skills or tool descriptions; it comes
  from `ptah_agent_list`.

## Acceptance

- `ptah_agent_spawn({ cli: "antigravity", role: "frontend-developer", task })`
  produces a lane whose first turn follows the frontend-developer contract (writes
  its deliverable into `taskFolder`), and the result says `roleDelivery`.
- Same call for a native-capable CLI reports `native`.
- Unit specs per adapter; one e2e with a real installed CLI recorded in this folder.
