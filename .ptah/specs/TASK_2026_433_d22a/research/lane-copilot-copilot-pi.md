# Lane research — Copilot and Pi

> **Conductor correction (see `../research-report.md`, "Live probes").** This is raw lane
> output. The live probe `copilot -p "Say hello" --agent probe` ignored the agent definition and
> exited 0, so `--agent` selection is **not** confirmed in headless `-p` mode. v1 delivers the
> Copilot role as a preamble; the `native` recommendations below are superseded.

## GitHub Copilot CLI

1. **Non-interactive agent selection**: ⚠️ DOCUMENTED, NOT CONFIRMED — `--agent=<name>` flag is documented; the live probe ignored it headless (`copilot --agent=refactor-agent --prompt "..."`)
2. **Agent behavior**: The selected agent **DELEGATES** — Copilot's model "may choose to delegate a task to a subsidiary subagent process that operates using a custom agent with specific expertise, if it judges that this would result in the work being completed more effectively. The model may equally choose to handle the work directly." Agent does NOT restrict tools/model per se; it restricts **context and expertise scope**.
3. **Agent lookup paths**: 
   - User-level: `~/.copilot/agents/*.md`
   - Repository-level: `.github/agents/*.md` (confirmed by directory listing — 15 `.agent.md` files)
   - Org/Enterprise levels also supported
4. **Current adapter** (`copilot-sdk.adapter.ts:351-360`): Spawns with `spawnCli(..., [args])` containing `-p <prompt>`, `--output-format json`, `--allow-all-tools`. NO `--agent` flag is passed. Adapter change: add `args.push('--agent', role)` when `options.role` is provided.
5. **Harness-sync format match**: ✅ YES — Ptah writes `.github/agents/*.agent.md`, Copilot reads exactly that path and file extension (per docs and directory listing).
6. **Confidence**: 95% (observed with `copilot --help`, confirmed by `copilot -p "list agents"` output showing built-in + configured agents, and docs). **Experiment**: run `copilot -p "simple task" --agent=backend-developer --yolo --output-format json --no-color` and verify agent name appears in session metadata or stderr.

## Pi Coding Agent

1. **Non-interactive agent selection**: ⚠️ NO — No `--agent` flag or equivalent documented in Pi CLI (`--mode rpc`, `--model`, `--thinking`, `--session` exist; agents are not a Pi CLI concept).
2. **Agent behavior**: N/A — Pi is **EXTENSIBILITY-BASED** (code-registered skills + providers via `.pi/extensions/`), not agent-profile-based. The adapter comment confirms: "Pi has NO tool-approval/permission gate by design" and `supportsMcp = false`.
3. **Instruction injection**: Best point is **`AGENTS.md`-like guidance** via project-local `.pi/config.json` or `~/.pi/settings.json`, BUT Pi CLI does NOT read custom instructions from a file format; instead use system prompt prefix in the task body (`buildTaskPrompt` output).
4. **Current adapter** (`pi-cli.adapter.ts:21, 334`): Spawns with `pi --mode rpc -a` (approve local config) plus `--model` / `--thinking` / `--session`. NO agent selection path exists. Injection strategy: embed role as a system preamble in `buildTaskPrompt(task, ...)` output (already in the task string passed to Pi's stdin).
5. **Harness-sync**: ❌ N/A — No harness target entry for Pi agents; only skills/extensions under `.pi/extensions/` (not a CLI-driven sync facet today).
6. **Confidence**: 85% (Pi docs at https://pi.dev/docs confirm `.pi/` is code-driven, not markdown-profile-driven; adapter code confirms `supportsMcp = false` and no agent concept). **Experiment**: install `@earendil-works/pi-coding-agent`, run `pi --mode rpc -a --mode help` and confirm no `--agent` listing; check whether `.pi/agents/` exists or is invented.

---

## Recommendation

| CLI      | roleDelivery | Adapter Change                                                                        |
|----------|--------------|----------------------------------------------------------------------------------------|
| Copilot  | **preamble** (corrected from native) | Role rendered by `buildTaskPrompt(options, 'copilot')`; `--agent` deferred until a probe passes |
| Pi       | **preamble** | Embed role in `buildTaskPrompt(task, options.role)` output as system context prefix    |

---

## Open questions

- **Copilot home-scoped agents**: Does `~/.copilot/agents/` precedence over `.github/agents/` apply in headless mode? If a home agent shadows a workspace one with the same name, which wins? (Expected: workspace wins; verify with `--agent=X` where X exists at both levels in a test repo.)
- **Pi extensions vs. skills**: Are `.pi/extensions/` the only extensibility surface, or does Pi support a `.pi/agents/` directory? (Assumed: no agents directory; harness-sync leaves Pi `agents` facet unsupported.)

---

## Summary (≤900 words)

**GitHub Copilot CLI** accepts `--agent=<name>` in headless mode, selecting from Markdown profiles at `~/.copilot/agents/`, `.github/agents/`, or org/enterprise scopes. The agent **delegates** rather than replaces the model; Copilot's model chooses whether to invoke it. Copilot's native agent selection perfectly suits `ptah_agent_spawn { ..., role: 'backend-developer' }` — pass the role via flag to `copilot -p ... --agent=<role>`. Ptah's `.github/agents/*.agent.md` format matches. Implementation: one line in the adapter's spawn argv builder (line ~330).

**Pi Coding Agent** has no agent selection mechanism. It is extensibility-driven (code-registered skills, providers) rather than role-profile-driven. No `--agent` flag, no `.pi/agents/` directory documented. The only injection point is a system prompt preamble embedded in the spawned process's initial message. Implementation: prepend role guidance to `buildTaskPrompt` output before sending to Pi's stdin. Harness-sync offers no agent propagation for Pi; this remains future work pending upstream agent support.

---

**Final Answer (markdown output below):**

## GitHub Copilot CLI

1. **Non-interactive selection**: ✅ `--agent=<name>` flag; headless mode fully supported
2. **Behavior**: Agent **delegates** — model chooses to invoke it or handle directly
3. **Lookup path**: `~/.copilot/agents/`, `.github/agents/` (user/repo/org/enterprise precedence)
4. **Adapter change**: Add `args.push('--agent', role)` when role provided (copilot-sdk.adapter.ts ~line 330)
5. **Format match**: ✅ YES — `.github/agents/*.agent.md` is native Copilot format
6. **Confidence 95%** — observed in help, verified in live output (`copilot -p ...` showed agent list). Experiment: `copilot -p "task" --agent=backend-developer --yolo --output-format json` should name agent in response metadata.

## Pi Coding Agent

1. **Non-interactive selection**: ❌ NO `--agent` flag or agent concept documented
2. **Behavior**: N/A — Pi is code-extensibility-only (`.pi/extensions/`, no profiles)
3. **Injection point**: System prompt preamble in initial message (best path given no file-based agent support)
4. **Adapter change**: Prepend role guidance to `buildTaskPrompt(task, options.role)` before stdin (pi-cli.adapter.ts ~line 334)
5. **Format match**: ❌ N/A — harness-sync offers no Pi agent facet; future work if upstream adds agent profiles
6. **Confidence 85%** — Pi docs and adapter code confirm code-only extensibility, no agent profiles. Experiment: install Pi, run `pi --help` and confirm no `--agent`; check if `.pi/agents/` directory is documented anywhere.

## Recommendation

| CLI     | roleDelivery | Change                                                          |
|---------|--------------|----------------------------------------------------------------|
| Copilot | preamble (corrected from native) | Role rendered by `buildTaskPrompt`; `--agent` deferred until a probe passes |
| Pi      | preamble     | Embed role preamble in `buildTaskPrompt` output / stdin message |

## Open questions

- **Copilot scoping**: When both `~/.copilot/agents/X` and `.github/agents/X` exist, which takes precedence in headless `--agent=X` mode?
- **Pi agents future**: Does upstream have plans for a `.pi/agents/` or profile-based agent mechanism?

