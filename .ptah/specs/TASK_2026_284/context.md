# TASK_2026_284 — opencode and pi harness support

Follow-up to TASK_2026_278. Raised by the user immediately after that landed: "we didn't sync our skills and subagents with opencode and pi, and is our MCP server properly registered with them?"

## Where the two CLIs actually stand

Both are first-class everywhere except the harness:

| Surface                                                                       | opencode | pi     |
| ----------------------------------------------------------------------------- | -------- | ------ |
| `SYSTEM_CLI_TYPES` (`libs/shared/src/lib/types/agent-process.types.ts:62-73`) | yes      | yes    |
| CLI detection (`cli-detection.service.ts:44-45,203`)                          | yes      | yes    |
| `ptah_agent_spawn` (`agent-tool.dispatcher.ts:29,49`)                         | yes      | yes    |
| Settings UI (`agent-orchestration-config.component.ts:71-72,592-619`)         | yes      | yes    |
| Tribunal lanes (`tribunal-discovery.service.ts`)                              | yes      | yes    |
| **Harness target** (`HARNESS_TARGET_IDS`)                                     | **no**   | **no** |
| **User-installed MCP target** (`McpInstallTarget`)                            | **no**   | **no** |

So a Ptah subagent on either receives exactly `buildTaskPrompt`'s output (`cli-adapter.utils.ts:242-263`) — system prompt or project guidance, task, files, task-folder convention. No skills, no commands, no agents.

## Ptah's own MCP server — the answer to the second half

Seven of eight spawnable lanes get it; **pi is the only one that does not**, and that is upstream-correct.

| CLI               | Mechanism                                                                                      | Ref                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| claude / ptah-cli | in-process `mcpServers.ptah` (http)                                                            | `sdk-query-runner.service.ts:414-420`, `ptah-cli-registry.ts:631`       |
| codex             | SDK `config.mcp_servers.ptah.url`                                                              | `codex-cli.adapter.ts:459-467`                                          |
| copilot           | `--additional-mcp-config`                                                                      | `copilot-sdk.adapter.ts:296-306`                                        |
| cursor            | SDK `agentOptions.mcpServers.ptah`                                                             | `cursor-cli.adapter.ts:300-307`                                         |
| antigravity       | writes `~/.gemini/config/mcp_config.json`, cleaned up after `done`                             | `antigravity-cli.adapter.ts:368-370,522-526`                            |
| **opencode**      | `OPENCODE_CONFIG_CONTENT` env, `{mcp:{ptah:{type:'remote',url,enabled:true}}}` — no disk write | `opencode-cli.adapter.ts:351-361,410-415`                               |
| **pi**            | none — `supportsMcp = false`, port never even resolved                                         | `pi-cli.adapter.ts:148,275`; `agent-process-manager.service.ts:356-357` |

pi's extensibility is code-based (`pi.registerTool()` / `registerProvider()` / `on()`), with no MCP concept documented (`.ptah/specs/TASK_2026_160/research-pi.md:150-152`). Nothing to fix there unless upstream adds MCP.

## What is not knowable from the repo

This is the reason the task starts with research rather than code.

**opencode** — the repo attests the config precedence chain and the MCP block only (`.ptah/specs/TASK_2026_160/{research,followup}-opencode.md`): remote → `~/.config/opencode/opencode.json` → `OPENCODE_CONFIG` → project `opencode.json` walked to nearest `.git` → `.opencode/` → `OPENCODE_CONFIG_CONTENT` (wins). One line says `OPENCODE_CONFIG_DIR` names an "alternate directory for agents/commands/modes/plugins". No path layout, no file format, and no mention of skills. `--agent` exists as a flag with no documented meaning here. `node_modules/opencode-ai` is not installed.

**pi** — `~/.pi/agent/{auth,settings,models}.json` and the session dir are documented (`research-pi.md:120-152`), and one line says the project-local `.pi/` carries "settings/extensions/skills". No layout, no format. `node_modules/@earendil-works` is not installed. Note the trust gate: project-local `.pi/` is honoured only with `-a`/`--approve`, which the adapter already always passes (`pi-cli.adapter.ts:51,334`).

## Scope

1. **Research** (blocking, upstream docs + a real install of each CLI): for opencode, the exact directory and file format for agents, commands, modes, plugins and skills if any, and whether project-local or `OPENCODE_CONFIG_DIR` is the right surface for Ptah. For pi, the `.pi/` layout for skills and extensions. Record findings in this folder as `research-opencode-harness.md` / `research-pi-harness.md`, in the same style as the TASK_2026_160 research files.
2. **Targets.** For each facet the research proves exists, add a target config entry in `libs/backend/harness-sync/src/lib/targets/rival-targets.ts` (plus a transformer if the agent format is novel — and it must implement `isPtahOutput`, per that lib's guidelines). A facet upstream genuinely cannot accept is declared `unsupported` with the reason written into the CLAUDE.md matrix, exactly as antigravity's gaps are. Do not invent a layout the CLI does not read.
3. **opencode MCP intents.** `McpInstallTarget` (`libs/shared/src/lib/types/mcp-directory.types.ts:24-29`) has no opencode member, so a user-installed MCP server cannot be expressed for it. opencode's own `mcp` block is documented, so this is fillable — decide the config file (project `opencode.json` vs `~/.config/opencode/opencode.json`) and add a facet in `targets/mcp/mcp-facet.registry.ts`. Note the deliberate constraint: Ptah's own server rides `OPENCODE_CONFIG_CONTENT` per-process precisely so it never touches the shared config, and TASK_2026_160 abandoned the read-merge-write on `opencode.json` because concurrent same-dir agents raced on it — a user-installed facet must not reintroduce that race.
4. **Write the rationale down.** Whatever the outcome per facet, `harness-sync/CLAUDE.md`'s "Why the unsupported cells are unsupported" section gains rows for opencode and pi. Today the exclusion is implicit — `CliTarget` narrows to four members with a one-line comment and nothing argues the case.

## Acceptance

- Each of opencode and pi is either a harness target with its supported facets reconciled, or documented `unsupported` per facet with an upstream citation.
- opencode can receive a user-installed MCP server, or the reason it cannot is written down.
- pi's lack of MCP is recorded as an upstream limit rather than left as a silent `false`.
- Specs: whatever facets land, plus the detection path (E17 — CLI absent, nothing written).
