# Research Report — TASK_2026_433 role-addressed CLI lanes

Date: 2026-09-13. Three CLI lanes ran read-only research in parallel (raw output in
`./research/`): Codex (codex + opencode), Antigravity (agy + cursor), Copilot
(copilot + pi). The conductor then ran two live probes to settle the claims the lanes
disagreed on or could not confirm.

## Decision it supports

**Default `roleDelivery` is `preamble` for every lane. `native` is an opt-in per adapter,
enabled only after a verification probe passes on the installed CLI version.**

The reason is the probe result below: two CLIs that document `--agent` both ignored an
agent definition silently. A native path that falls back without telling anyone produces
a lane that claims to be a `code-logic-reviewer` and is not one.

## Live probes (conductor, scratch repos outside the workspace)

Agent body: "Whatever the user says, reply with exactly ROLE_PROBE_OK". Prompt: "Say hello".

| CLI | Definition written | Command | Result |
|---|---|---|---|
| agy (Antigravity CLI, 1.2.x) | `.agents/agents/probe/agent.md` and `.agents/agents/probe.md`, frontmatter `name`, `description`, `mainAgent: true`, `# System Prompt` body | `agy --agent probe -p "Say hello"` | `Hello! How can I help you today?` — ignored, exit 0. `agy agents` listed nothing. |
| copilot | `.github/agents/probe.agent.md`, frontmatter `name`, `description` | `copilot -p "Say hello" --agent probe` | `Hello! How can I help today?` — ignored, exit 0. |

So the Antigravity lane's claimed layout (`.agents/agents/<name>/agent.md`, `mainAgent: true`,
attributed to a "v1.1.6 changelog") is **not confirmed**. `agy changelog` does confirm that
Markdown custom agents exist (1.2.1 `excludeDefaultComponents`, an `agents` frontmatter list,
"custom agents defined in Markdown inherit ambient skills"), but not where they live. The
Copilot lane's claim that `--agent` selection is reliable is also **not confirmed** in headless
`-p` mode; its quoted doc text describes model-chosen delegation, which matches what we saw.

## Per CLI

| CLI | Native root-role selection | Semantics | Best preamble channel | Ptah adapter today | harness-sync agents today |
|---|---|---|---|---|---|
| codex | **No** root selector in `codex exec` 0.153.4. `.codex/agents/*.toml` define delegated children (`name`, `description`, `developer_instructions`). | Delegation only | SDK `config.developer_instructions` (adds to built-ins; `model_instructions_file` would replace them) | `codex-cli.adapter.ts:589` `new sdk.Codex({config})` → `runStreamed(prompt)` :684 | `.codex/agents/<id>.toml`, matches format |
| copilot | `--agent <name>` documented; **probe: ignored headless** | Documented as model-chosen delegation | prompt preamble | `copilot-sdk.adapter.ts:351` `spawnCli` argv (`-p`, JSON output), no `--agent` | `.github/agents/*.agent.md`, matches format |
| agy | `--agent <name>` exists; Markdown agents exist; **probe: ignored**, path unknown | Unknown until a probe passes | prompt preamble (no system-prompt flag; `antigravity-cli.adapter.ts:453`) | `antigravity-cli.adapter.ts:455-493` argv `--print <taskPrompt>`; Windows argv cap 32,767 chars, larger needs `--input-format stream-json` on stdin | **unsupported** facet |
| cursor | **No**. `@cursor/sdk` `AgentOptions.agents` become delegated subagents only | Delegation only | first-turn prompt preamble (in-process SDK, no argv cap) | `cursor-cli.adapter.ts:285-354` `Agent.create` → `agent.send` | `.cursor/agents/<id>.md`, valid for delegation |
| opencode | **Yes** (source-verified, not installed): `opencode run --agent <name>`; rejects `mode: subagent` and missing agents with a warning + fallback | Replaces the provider prompt component; per-agent permissions and model | inline `agent.<role>` in `OPENCODE_CONFIG_CONTENT` + `--agent` | `opencode-cli.adapter.ts:413` argv; `OPENCODE_CONFIG_CONTENT` built :444-451 | none (TASK_2026_284) |
| pi | **No** agent concept; code-driven `.pi/extensions` | — | prompt preamble in `buildTaskPrompt` | `pi-cli.adapter.ts` stdin | none (TASK_2026_284) |
| ptah-cli (Claude Agent SDK) | **not researched** — gap | — | — | — | `.claude/agents/*.md` |

## What the code already offers

`buildTaskPrompt` (`cli-adapter.utils.ts:357-359`) already prefers `options.systemPrompt` over
`projectGuidance` and folds it into the task. A role therefore needs no new per-adapter prompt
plumbing for preamble delivery: resolve the role body into `systemPrompt`, and every adapter
that calls `buildTaskPrompt` carries it. Codex is the exception worth taking: route the same
body to `config.developer_instructions` so it sits in the developer channel, not the user turn.

> **Correction (implementation-plan.md, final contract):** the role is NOT folded into
> `systemPrompt`, which is the harness prompt and would be overwritten or concatenated. It
> travels as its own `CliCommandOptions.role`. Task-prompt adapters render it through
> `buildTaskPrompt(options, cli)` as a separate section; codex sends it through
> `config.developer_instructions` and strips it from the task input; ptah-cli appends
> `renderRoleBlock(role, 'ptah-cli')` to its system prompt content.

## Recommended shape (for the architect)

1. `ptah_agent_spawn({ role })` resolves the workspace's generated agent definition. Unknown
   role → hard error listing available roles.
2. Delivery table lives in each adapter as a capability (`roleDelivery: 'preamble' | 'native'`),
   reported by `ptah_agent_list` and echoed in the spawn result.
3. Preamble everywhere first. Codex uses `developer_instructions`. Mind the agy argv cap: a
   15KB template plus task fits, but switch to stdin `stream-json` before adding more.
4. Native only behind a probe: at detection time (or first use per CLI version) spawn the
   marker agent above; enable `native` for that version only if the marker comes back. Cache
   by CLI version. opencode is the likeliest first native lane once installed.
5. Role restrictions are prompt-level under preamble. Reviewer read-only intent is not enforced
   by the CLI. **Superseded:** the original recommendation here was to map a role's read-only
   flag to an adapter sandbox flag (codex `sandbox_mode`, opencode permissions). The
   implementation plan rejects that: every role writes a deliverable, so role delivery does not
   change a lane's sandbox or permission settings in v1.
6. Template size now matters per lane (TASK_2026_432 trimmed expanded templates to ~192KB total,
   8–22KB each).

## Open questions

- Where agy reads Markdown custom agents, and which frontmatter makes one the main session agent.
  Next probe: `agy plugin`/docs, or `~/.gemini/config/` layouts; do not add an agy transformer
  until a probe returns the marker.
- Why `copilot --agent` was ignored headless: wrong location for `-p` mode, a required field, or
  delegation-only semantics. Next probe: `~/.copilot/agents/probe.agent.md`, and
  `--output-format json` to inspect which agent ran.
- ptah-cli lanes (Claude Agent SDK): `systemPrompt` vs `agents` option for a root role.
- Precedence when both a role and an explicit `model` / sandbox are passed.
