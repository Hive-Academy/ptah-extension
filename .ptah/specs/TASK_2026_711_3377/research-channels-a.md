# Per-run instruction channels (research)

Research date: 2026-10-21. Sources are official docs, changelogs, and doc pages fetched that day. A CLI semver is cited only when an official page names one. Anything not stated by those pages is marked **UNCONFIRMED**.

Docs hosts: Codex pages are published at `developers.openai.com/codex` and currently render on `learn.chatgpt.com` with the same paths. Citations use the `developers.openai.com` URLs.

---

## 1. OpenAI Codex CLI

Doc set read 2026-10-21. Changelog excerpt lists **Codex CLI 0.142.0** (2026-06-22) as a named release. A release newer than 0.142.0 was **not confirmed** in this pass.
https://developers.openai.com/codex/changelog

### 1. System / developer channel (headless)

`codex exec "<prompt>"` is the non-interactive entry. CLI flags and `-c` / `--config` overrides are the highest config layer (above project `.codex/config.toml`, profiles, user `~/.codex/config.toml`, and system config).
https://developers.openai.com/codex/noninteractive
https://developers.openai.com/codex/config-basic
https://developers.openai.com/codex/config-advanced

| Key | Effect | Replace or append | Size limit |
| --- | --- | --- | --- |
| `developer_instructions` (string) | "Additional developer instructions injected into the session." Sample config: "Additional user instructions are injected before AGENTS.md." | **Appends** in front of `AGENTS.md`. Does not replace the built-in base prompt. | No byte cap documented. **UNCONFIRMED** whether a hidden cap exists. |
| `model_instructions_file` (path) | Sample: "Override built-in base instructions with a file path." Reference table: "Replacement for built-in instructions instead of AGENTS.md." | **Replaces** the built-in base instruction text. Whether it also suppresses `AGENTS.md` is **UNCONFIRMED** (the two sentences disagree in emphasis). | No cap documented. |
| `instructions` | "Reserved for future use; prefer `model_instructions_file` or `AGENTS.md`." | Not a usable channel. | — |

https://developers.openai.com/codex/config-reference
https://developers.openai.com/codex/config-sample

Per-run (no user-global write). Values are TOML:

```text
codex exec -c 'developer_instructions="…3–5 KB…"' "task"
codex exec -c 'model_instructions_file=".ptah/lane-system-prompt.md"' "task"
```

`-c` may be repeated. `--ignore-user-config` skips `$CODEX_HOME/config.toml` for that run; `-c` still wins.
https://developers.openai.com/codex/config-advanced
https://developers.openai.com/codex/noninteractive

No `--append-system-prompt` flag, env var, or first stream-json system message is documented. App-server / SDK field for the same key was **not confirmed** beyond config.toml. Subagent files have their own required `developer_instructions` string; that is the subagent prompt, not the parent `codex exec` session.
https://developers.openai.com/codex/subagents

### 2. Instruction files

Built once per run (once per TUI launch):

1. **Global:** `$CODEX_HOME` (default `~/.codex`): `AGENTS.override.md` if non-empty, else `AGENTS.md`. One file only.
2. **Project:** from the Git root down to the cwd (cwd only if no root). In each directory: `AGENTS.override.md`, then `AGENTS.md`, then `project_doc_fallback_filenames` in order. At most one file per directory.
3. **Merge:** concatenated root-down, blank line between files. Closer to cwd appears later and overrides earlier guidance.

Empty files are skipped. Combined size stops at `project_doc_max_bytes` (default **32768**). There is no flag that points at one arbitrary instruction file. A per-run path is `model_instructions_file` via `-c` (base-prompt replacement, see above), or raising `project_doc_max_bytes` via `-c` if the lane text is placed on the AGENTS discovery path. `CODEX_HOME` retargets the global file and the rest of Codex state; that is broader than an instruction override.
https://developers.openai.com/codex/guides/agents-md
https://developers.openai.com/codex/config-sample

### 3. Skills

A skill is a directory with `SKILL.md` (`name` and `description` required) plus optional `scripts/`, `references/`, `assets/`.

Discovery (repo scan is cwd up to the repo root; same `name` is not merged):

| Scope | Path |
| --- | --- |
| Repo | `$CWD/.agents/skills`, parents up to `$REPO_ROOT/.agents/skills` |
| User | `$HOME/.agents/skills` |
| Admin | `/etc/codex/skills` |
| System | Bundled with Codex |

The initial catalog is name, description, and path, capped at **2% of the context window** or **8,000 characters** when the window is unknown (descriptions shortened first). `skills.max_context_tokens` raises that budget up to **10,000** tokens. Selecting a skill still loads the full `SKILL.md`.

Invocation: explicit `$skill` or `/skills` in the CLI; implicit when the task matches `description`, unless `agents/openai.yaml` sets `policy.allow_implicit_invocation: false`. `[[skills.config]]` can disable a skill by path (that write is config, not per-run, unless passed with `-c`).

An older create-skill page (2026-01-30) still documents `~/.codex/skills` and `.codex/skills`. The current skills page does not list those paths. Whether they still load is **UNCONFIRMED**.
https://developers.openai.com/codex/skills
https://developers.openai.com/codex/skills/create-skill

### 4. MCP allow / deny (per run)

Per server, in config (overridable with `-c` for one run):

- `mcp_servers.<id>.enabled_tools` — allow list
- `mcp_servers.<id>.disabled_tools` — deny list, **applied after** the allow list
- `mcp_servers.<id>.enabled` — server on/off
- `default_tools_approval_mode`: `auto` | `prompt` | `approve`

Plugin servers use `plugins.<plugin>.mcp_servers.<server>.enabled_tools` and per-tool `approval_mode`.

```text
codex exec -c 'mcp_servers.ptah.enabled_tools=["ptah_agent_report"]' \
  -c 'mcp_servers.ptah.disabled_tools=["ptah_agent_spawn"]' "task"
```

Server `instructions` from MCP initialize are used as server-wide guidance. Codex keeps the first **512 characters** self-contained when deciding how to use the server. That is not a substitute for the lane prompt.
https://developers.openai.com/codex/mcp
https://developers.openai.com/codex/config-reference
https://developers.openai.com/codex/config-sample

### 5. Recommendation

**Native:** `codex exec -c developer_instructions=…` (appends before `AGENTS.md`, leaves the vendor base prompt in place). 3–5 KB is under the 32 KiB AGENTS cap and has no documented cap of its own.

**Fallback:** `-c model_instructions_file=.ptah/lane-system-prompt.md` when the lane text must replace the built-in base instructions. **Fallback 2:** argv prompt text to `codex exec`.

---

## 2. GitHub Copilot CLI

Docs fetched 2026-10-21. Changelog names **CLI 1.0.94-0** (2026-10-07) for local-model discovery. The command reference itself has no version stamp.
https://github.blog/changelog/2026-10-07-discover-local-models-in-github-copilot-cli/
https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference

Headless: `copilot -p "…"`, or a prompt on stdin (stdin is ignored when `-p` is also set).
https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically

### 1. System / developer channel

**CLI:** no `developer_instructions` key, no `--append-system-prompt`, and no documented stream-json system message. `--no-custom-instructions` turns instruction files off for the session (including subagents that set `include-custom-instructions: true`). `--allow-all-mcp-server-instructions` puts every MCP server's initialize instructions into the system prompt; by default only allowlisted server instructions are included up front.

**SDK (headless via the CLI the SDK drives):** `createSession({ systemMessage })`.

- Default shape `{ content }` **appends** instructions.
- `mode: "customize"` edits sections: `replace`, `remove`, `append`, `prepend`, `preserve`.
- Section ids: `preamble`, `identity`, `tone`, `tool_efficiency`, `environment_context`, `code_change_rules`, `guidelines`, `safety`, `tool_instructions`, `custom_instructions`, `runtime_instructions`, `last_instructions`. `identity` and `tool_instructions` are groups.
- Unknown section ids: replace/append/prepend content is appended to additional instructions; `remove` is ignored.
- No size limit documented.

`onSessionStart` may return `additionalContext` (append context, not a system-prompt replace). Resume accepts `systemMessage` again ("Override or extend the system prompt").

A custom agent selected with `--agent` (file `.github/agents/*.agent.md` or the SDK `customAgents[].prompt`) supplies that agent's instructions. The session agent still receives repository instruction files. Whether the markdown body **replaces** the vendor system prompt or is appended is **UNCONFIRMED**.
https://docs.github.com/en/copilot/get-started/sdk-quickstart
https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/session-persistence
https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/custom-agents
https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference

### 2. Instruction files

All matching files are **merged**. Identical copies of user-level `copilot-instructions.md`, repository-wide instructions, and agent instructions are deduped. There is **no general precedence** between the remaining files. Path-specific files apply only when `applyTo` matches a file the CLI is working on.

| Location | Behavior |
| --- | --- |
| `$HOME/.copilot/copilot-instructions.md` (or `$COPILOT_HOME`) | User, all repos |
| `$HOME/.copilot/instructions/**/*.instructions.md` | User, modular |
| `.github/copilot-instructions.md` | Repo-wide. Standard locations: repo root, cwd, directories between them, and directories on the path of a file being worked on |
| `.github/instructions/**/*.instructions.md` | Path-specific. Standard locations **except** intermediate directories |
| `AGENTS.md` | Standard locations |
| `CLAUDE.md` and `.claude/CLAUDE.md` | Standard locations |
| `GEMINI.md` | Standard locations. `@path` imports are **not** expanded here |
| `.claude/rules/**/*.md` | Same mechanism as `.github/instructions/**/*.instructions.md` (`paths` or `applyTo`) |
| `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` | Comma-separated extra directories. Loads additional `AGENTS.md` and `*.instructions.md` only |

`@relative-path` imports (in `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`) are inlined immediately, recursively, with a depth limit and cycle and size guards. Absolute paths and `~/` are not loaded. The numeric size cap is **UNCONFIRMED**.

Per-run path **without** writing user-global config: set `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` to a workspace directory such as `.ptah/lane` that contains `AGENTS.md` or `*.instructions.md`. That appends; it does not replace the vendor prompt. `--no-custom-instructions` is the off switch. Subagents do not inherit `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`.
https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions
https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference

### 3. Skills

`SKILL.md` directory. First matching name wins:

1. `.github/skills/` (project)
2. `.agents/skills/` (project)
3. `.claude/skills/` (project)
4. Parent `.github/skills/` (monorepo)
5. `~/.copilot/skills/`
6. `~/.agents/skills/`
7. Installed plugins
8. `COPILOT_SKILLS_DIRS` (comma-separated extra directories)
9. Skills bundled with the CLI (lowest; any other source overrides)
10. Org/enterprise skills via the AHP relay (fetched when invoked)

Invocation: `/SKILL-NAME` when `user-invocable` is true (default). The model may invoke a skill unless `disable-model-invocation: true`. `allowed-tools` auto-approves tools while the skill is active. `copilot skill` can list/add/enable/disable (enable/disable persists; not a pure per-run switch). SDK `skillDirectories` adds directories for that session; `disabledSkills` turns names off for that session.
https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/custom-skills

### 4. MCP allow / deny (per run)

Permission flags (deny wins over allow, including over `--allow-all`):

- `--allow-tool='My MCP(create_issue)'` / `--deny-tool='My-MCP-Server(tool_name)'`
- Server-wide: `--allow-tool='github'` or `--deny-tool='github'`
- `--available-tools` restricts the model to the listed tools; `--excluded-tools` removes tools

Session-only server (does not write `~/.copilot/mcp-config.json`):

```text
copilot -p "task" --additional-mcp-config=@.ptah/mcp.json
```

`@file` is resolved from the session cwd. Same server name overrides an installed server. Config `tools` is `["*"]` or a name list (`""` means none on `copilot mcp add --tools`). SDK session config has `mcpServers`, `availableTools`, and `excludedTools`.

Tool names sent to the model are sanitized; `serverName-toolName` is capped at **64** characters.
https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
https://docs.github.com/copilot/how-tos/copilot-cli/allowing-tools
https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference

### 5. Recommendation

**If the host is the SDK:** `systemMessage.content` (append). Use `mode: "customize"` only when a named section must be replaced.

**If the host is the CLI:** `COPILOT_CUSTOM_INSTRUCTIONS_DIRS=.ptah/lane` with `.ptah/lane/AGENTS.md` (per-run, appends, no user-global write).

**Fallback:** argv text via `copilot -p`.

---

## 3. Cursor CLI (`agent` / cursor-agent)

Docs fetched 2026-10-21. Changelog latest heading: **v2026.10.08**. Check the binary with `agent --version`.
https://cursor.com/docs/cli/changelog

Headless: `agent -p` / `--print` (alias `--print`). `--force` / `--yolo` applies edits. `--output-format text|json|stream-json`.
https://cursor.com/docs/cli/headless
https://cursor.com/docs/cli/reference/parameters

### 1. System / developer channel

The parameters page lists no system-prompt, developer-instructions, or append-system-prompt flag, and no matching env var. Retrieved global options: `--api-key`, `-H/--header`, `-p/--print`, `--output-format`, `--stream-partial-output`, `--resume`, `--continue`, `--model`, `--mode`, `--plan`, `--list-models`, `-f/--force`, `--yolo`, `--sandbox`, `--approve-mcps`, `--trust`, `--workspace`, `--plugin-dir`, `-w/--worktree`.

ACP: `agent acp` speaks JSON-RPC. Documented `session/new` example fields are `cwd` and `mcpServers` only. A system-prompt field on `session/new` is **UNCONFIRMED** for Cursor's ACP server. BDK `bot/instructions.md` is a different product (Cloud/BDK agents), not the `agent -p` CLI.

Rules are described as included at the start of the model context. They do not replace Cursor's own system prompt. No size limit is documented on the rules page.
https://cursor.com/docs/cli/reference/parameters
https://cursor.com/docs/cli/acp
https://cursor.com/docs/rules

### 2. Instruction files

CLI "supports the same rules system as the editor."

| Kind | Where | Apply |
| --- | --- | --- |
| Project rules | `.cursor/rules/*.mdc` only. A plain `.md` in that folder is ignored | `alwaysApply`, intelligent (`description`), globs, or manual `@mention` |
| User rules | Cursor Settings → Rules (global) | All projects |
| Team rules | Dashboard (Team / Enterprise) | All team repos when enabled |
| `AGENTS.md` | Plain markdown. Root, and nested files | Nested files merge; the more specific file wins |

Precedence on the official localized rules page: **Team → Project → User**. All applicable rules are merged; earlier source wins on conflict. The English rules page lists the same four kinds; the precedence sentence was taken from `cursor.com/docs/zh-Hant/rules`.

Changelog: `.cursor/rules` and `.cursor/skills` in subdirectories are discovered, matching the IDE.

No flag or env var passes a single instruction-file path. `--plugin-dir` loads a plugin directory (repeatable). Whether a plugin's rules are injected as the lane prompt is **UNCONFIRMED**. `CURSOR_CONFIG_DIR` moves `cli-config.json` (permissions and CLI prefs), not rules.
https://cursor.com/docs/cli/using
https://cursor.com/docs/rules
https://cursor.com/docs/zh-Hant/rules
https://cursor.com/docs/cli/changelog
https://cursor.com/docs/cli/reference/configuration

### 3. Skills

Auto-loaded from:

| Path | Scope |
| --- | --- |
| `.agents/skills/`, `.cursor/skills/` | Project, including nested directories (nested skills are scoped to files under that directory) |
| `~/.agents/skills/`, `~/.cursor/skills/` | User |
| `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/` | Compatibility |

`SKILL.md` folder, plus optional `scripts/`, `references/`, `assets/`. The agent sees descriptions and loads a skill when it judges it relevant. User invocation: `/` menu or `/skill-name`. Changelog v2026.10.08: `/skills` warns when a skill breaks the Agent Skills limits (name ≤ 64 chars, lowercase-hyphen, folder name matches frontmatter, description ≤ 1,024 chars, body about ≤ 5,000 tokens).
https://cursor.com/docs/skills
https://cursor.com/docs/context/skills
https://cursor.com/docs/cli/using
https://cursor.com/docs/cli/changelog

### 4. MCP allow / deny (per run)

Durable tokens in `~/.cursor/cli-config.json` or `<project>/.cursor/cli.json`:

- Allow/deny format `Mcp(server:tool)`
- Wildcards: `Mcp(datadog:*)`, `Mcp(*:search)`, `Mcp(*:*)`
- Deny overrides allow

That is project or user config, not a per-run flag. `--approve-mcps` auto-approves **servers** (skips the approval prompt). It is not a tool allow list. `agent mcp enable|disable <id>` writes the local approved list (persists; not per-run). ACP `session/new` can pass `mcpServers` for that session (which servers, not a per-tool deny list). A per-run tool allow/deny flag is **UNCONFIRMED**.
https://cursor.com/docs/cli/reference/permissions
https://cursor.com/docs/cli/mcp
https://cursor.com/docs/cli/reference/parameters
https://cursor.com/docs/cli/acp

### 5. Recommendation

No documented native system/developer flag.

**Best effort that stays out of user-global config:** an always-apply project rule or `AGENTS.md` in the workspace. A file at `.ptah/AGENTS.md` is **not** documented as always loaded when cwd is the repo root (nested discovery exists; always-on for a root run is **UNCONFIRMED**).

**Recommended for a true per-run inject:** argv preamble on `agent -p`. **UNCONFIRMED alternative:** `--plugin-dir .ptah/cursor-plugin` if that plugin format carries rules (not confirmed).

---

## 4. Google Antigravity CLI (`agy`)

Docs fetched 2026-10-21 from `antigravity.google/docs/cli`. No CLI semver is printed on the headless or settings pages. **Version UNCONFIRMED.**

Headless: `agy -p` / `--print` / `--prompt`. Stdout is the answer; diagnostics go to stderr. `--output-format text|json|stream-json`. `--dangerously-skip-permissions` sets permission mode to `always-proceed` and approves every tool call.
https://antigravity.google/docs/cli/headless

### 1. System / developer channel

The retrieved headless flag table includes `-p` / `--print` / `--prompt`, `--output-format`, `--json-schema`, `--model`, `--effort`, `--agent`, `--continue` / `-c`, and `--conversation` (table continues on the page). **No** `--system-prompt`, `--append-system-prompt`, or `developer_instructions` key appears in the rows retrieved. A later row with such a flag is **UNCONFIRMED**. Stream-json input accepts `text` blocks only; there is no documented system-message event. Settings live in `~/.gemini/antigravity-cli/settings.json`; documented CLI overrides are flags such as `--sandbox` and `--model`, not a system prompt.

`--agent <name>` selects a custom agent for that run (`agy agents` lists them). The markdown body after the YAML frontmatter of `agent.md` **is that agent's system prompt**. Whether it replaces the product system prompt or is appended is **UNCONFIRMED** (docs call it the system prompt for that agent).
https://antigravity.google/docs/cli/headless
https://antigravity.google/docs/cli/commands/agents
https://antigravity.google/docs/subagents

### 2. Instruction files

On startup the agent reads workspace **`GEMINI.md` or `AGENTS.md`** in the active directory, and global **`~/.gemini/GEMINI.md`**. Migration notes say Gemini CLI and Antigravity CLI share this workspace context behavior. A full directory walk, override filename, and merge order are **UNCONFIRMED**. No byte cap is documented. No flag or env var points at an arbitrary file (so `.ptah/lane.md` is not on a documented read path unless it is named `GEMINI.md` or `AGENTS.md` in a directory the CLI actually scans).

Plugin `rules/` under `~/.gemini/antigravity-cli/plugins/<name>/rules/` are loaded with the plugin. Installing a plugin writes user-global state.
https://antigravity.google/docs/cli/best-practices
https://antigravity.google/docs/cli/gcli-migration

### 3. Skills

Workspace: `.agents/skills/` at the project root. The plugins page shows a **single `*.md` file** (example `format-tests.md`) with `name` and `description` frontmatter, not a `SKILL.md` directory. Global: `~/.gemini/antigravity-cli/skills/`. Gemini CLI's `.gemini/skills/` is **not** read until moved to `.agents/skills/`.

Invocation documented: compiled to a **slash command** (`/format-tests`) in the TUI. Implicit model invocation is **UNCONFIRMED**. Plugin `skills/` are discovered with the plugin.
https://antigravity.google/docs/cli/plugins
https://antigravity.google/docs/cli/gcli-migration

### 4. MCP allow / deny (per run)

Servers: global `~/.gemini/antigravity-cli/mcp_config.json` (plugins page also mentions `~/.gemini/config/mcp_config.json`; which file wins is **UNCONFIRMED**) and workspace `.agents/mcp_config.json`. Remote servers use `serverUrl` (`url` / `httpUrl` are not supported). A `tools` allow list inside `mcp_config.json` is **UNCONFIRMED**.

Permission rules in `~/.gemini/antigravity-cli/settings.json` (not a per-run flag):

- `mcp(linter/*)`, `mcp(sql/execute_mutation)`
- Precedence: **Deny > Ask > Allow**
- Headless cannot prompt. Tools that need approval are soft-denied (exit 0, notice on stderr) unless allowed in settings or the run uses `--dangerously-skip-permissions` (approves everything, not a tool filter).

A per-run MCP allow/deny flag other than "approve all" is **UNCONFIRMED**.
https://antigravity.google/docs/cli/permissions
https://antigravity.google/docs/cli/headless
https://antigravity.google/docs/cli/plugins

### 5. Recommendation

**Native:** `agy -p --agent <name>` where the agent file is workspace `.agents/agents/<name>/agent.md` and the body is the lane prompt. That does not write user-global config. It does not read `.ptah/` by itself. Treat replace-vs-append as **UNCONFIRMED**.

**If the prompt must be a file the CLI is told to read under `.ptah/`:** no such flag is documented.

**Fallback:** argv preamble, `agy -p` with the lane text followed by the task. Workspace-root `AGENTS.md` / `GEMINI.md` is the automatic channel when a per-run switch is not required.

---

## Summary

| CLI | System / dev channel | Instruction files + per-run path | Skills | MCP allow / deny | Recommended channel | Fallback |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI (docs current; changelog names 0.142.0 on 2026-06-22) | `-c developer_instructions=` **appends** before AGENTS.md. `model_instructions_file` **replaces** built-in base instructions. No documented size cap on `developer_instructions`. AGENTS chain capped at 32 KiB | Global then root→cwd `AGENTS.override.md` / `AGENTS.md` / fallbacks. Per-run file: `-c model_instructions_file=.ptah/….md` (replacement) | `.agents/skills` cwd→root, `~/.agents/skills`, `/etc/codex/skills`, bundled. `$` / `/skills` or implicit | `-c mcp_servers.<id>.enabled_tools` / `disabled_tools` (deny after allow) | `-c developer_instructions` | `model_instructions_file` under `.ptah/`, then argv |
| Copilot CLI (1.0.94-0 named 2026-10-07) | CLI: none. SDK `systemMessage.content` **appends**; `mode:customize` can replace sections. `--no-custom-instructions` disables files | Merged: user copilot-instructions, `.github/copilot-instructions.md`, `.github/instructions`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/rules`. Per-run: `COPILOT_CUSTOM_INSTRUCTIONS_DIRS=.ptah/lane` | First-wins: `.github/skills`, `.agents/skills`, `.claude/skills`, parents, `~/.copilot/skills`, `~/.agents/skills`, plugins, `COPILOT_SKILLS_DIRS`, bundled. `/name` or model | `--allow-tool='Server(tool)'` / `--deny-tool` (deny wins). `--additional-mcp-config` session server + `tools` list | SDK: `systemMessage`. CLI: `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` → `.ptah/lane/AGENTS.md` | `copilot -p` preamble |
| Cursor CLI (changelog v2026.10.08) | **None documented.** ACP `session/new` system field **UNCONFIRMED** | `.cursor/rules/*.mdc`, user rules, team rules, `AGENTS.md` (nested merge). No per-run path flag. `.ptah/AGENTS.md` always-on at repo root **UNCONFIRMED** | `.agents/skills`, `.cursor/skills`, user equivalents, plus `.claude` / `.codex` skill dirs. `/skill-name` or implicit | `Mcp(server:tool)` in cli config (not per-run). `--approve-mcps` approves servers only | argv preamble on `agent -p` | Workspace `AGENTS.md` or alwaysApply `.mdc` (not per-run) |
| Antigravity CLI `agy` (semver **UNCONFIRMED**) | No system flag in the flag rows retrieved. `--agent` uses `agent.md` body as that agent's system prompt (replace vs append **UNCONFIRMED**) | Active-dir `GEMINI.md` or `AGENTS.md`, plus `~/.gemini/GEMINI.md`. No flag for an arbitrary `.ptah/` file. Walk order **UNCONFIRMED** | `.agents/skills/*.md` → slash command. Global `~/.gemini/antigravity-cli/skills/`. Implicit invoke **UNCONFIRMED** | `mcp(server/tool)` in user `settings.json` only. Per-run filter **UNCONFIRMED**. `--dangerously-skip-permissions` approves all | `agy -p --agent` with workspace `.agents/agents/<name>/agent.md` | argv preamble |

### Unconfirmed (do not treat as fact)

- Codex CLI version after 0.142.0 (2026-06-22). Byte cap on `developer_instructions`. Whether `model_instructions_file` suppresses `AGENTS.md`. Whether `~/.codex/skills` and `.codex/skills` still load.
- Copilot CLI: numeric cap on instruction imports. Whether a custom agent's markdown body replaces the vendor system prompt. No CLI flag equivalent to SDK `systemMessage`.
- Cursor: ACP `session/new` system/developer field. `--plugin-dir` as a rules channel. `.ptah/AGENTS.md` loaded for a repo-root headless run. Per-run MCP tool filter.
- Antigravity: CLI semver. Remainder of the headless flag table (a system-prompt flag past the rows retrieved). GEMINI/AGENTS walk order and size cap. Implicit skill use. `tools` allow list inside `mcp_config.json`. Which global MCP file wins (`antigravity-cli/mcp_config.json` vs `~/.gemini/config/mcp_config.json`). Per-run MCP allow/deny. Whether `--agent` body replaces the product system prompt.
