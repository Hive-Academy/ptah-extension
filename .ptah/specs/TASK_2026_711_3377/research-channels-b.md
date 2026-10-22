# Research — per-run system/dev instruction channels for agent runtimes (part B)

**Date:** 2026-10-21 · **Method:** official docs / release pages / npm + GitHub APIs only. Versions verified live on 2026-10-21.
**Scope note:** the task names `sst/opencode` and `badlogic/pi-mono`; both projects have since moved (opencode → `anomalyco/opencode`, pi → `earendil-works/pi`, previously badlogic/pi-mono). The four runtimes investigated: opencode CLI, pi coding agent, xAI **Grok Build** (the official `grok` CLI), and `@anthropic-ai/claude-agent-sdk` (TypeScript).

---

## 1. opencode CLI (opencode-ai 1.19.3)

**Sources** (all pages "Last updated: Oct 20, 2026"; accessed 2026-10-21):
- Docs: https://opencode.ai/docs/agents/ · https://opencode.ai/docs/rules/ · https://opencode.ai/docs/skills/ · https://opencode.ai/docs/config/ · https://opencode.ai/docs/cli/
- Config schema: https://opencode.ai/config.json (accessed 2026-10-21)
- Version: npm `opencode-ai@1.19.3`; GitHub `anomalyco/opencode` tag `v1.19.3` released 2026-10-16 (registry/GitHub API, 2026-10-21). Note: an **OpenCode v2** line exists (`https://opencode.ai/v2/docs`) — findings below cite the `/docs` line that 1.19.x uses; the shared `config.json` schema already marks several v1 keys deprecated in favor of v2 forms (noted inline).

### 1.1 System/developer instruction channels for a headless run
- **No system-prompt CLI flag.** `opencode run` flags are `--agent`, `--model`, `--command`, `--file`, `--format` (default/json), `--dir`, `--auto`, `--session/--continue/--fork`, `--title`, `--attach`… — there is no `--system-prompt`/`--append-system-prompt`, and no `--config` flag on the current CLI page (older releases had `--config`; **UNCONFIRMED** for 1.19.x). (https://opencode.ai/docs/cli/#run)
- **Agent definition with prompt (config key).** `agent.<name>.prompt` — "Specify a custom system prompt file for this agent" — accepts a string or `{file:./prompts/x.txt}` substitution (path relative to the config file). This **sets/replaces that agent's system prompt**; a custom agent's `prompt` *is* its system prompt. Treat "replaces the built-in Build/Plan prompt when set on a built-in" as **UNCONFIRMED** — docs phrase it only as "a custom system prompt for this agent". In the live schema, `agent` is deprecated in favor of `agents.<name>.system` (string) with `agents.<name>.permissions` (ordered `{action, resource, effect}` ruleset). (https://opencode.ai/docs/agents/#prompt, https://opencode.ai/config.json `$defs/Config.AgentEncoded`)
- **Per-run config without touching user-global config (env vars, merged not replaced):**
  - `OPENCODE_CONFIG` = path to a config file — precedence tier 3 (loaded between global `~/.config/opencode/opencode.json` and project `opencode.json`, i.e. a project config can override it).
  - `OPENCODE_CONFIG_CONTENT` = inline JSON config content — tier 6 "runtime overrides": **outranks project config**; only managed/MDM settings (tiers 7–8) are higher.
  - `OPENCODE_CONFIG_DIR` = custom config directory (searched for agents, commands, modes, plugins like `.opencode/`; loaded after global so it can override).
  (https://opencode.ai/docs/config/#precedence-order, https://opencode.ai/docs/cli/#environment-variables)
- Selecting the agent per run: `opencode run --agent <name>`; `default_agent` config applies to CLI runs too.
- **ACP:** `opencode acp` exists (https://opencode.ai/docs/acp/); whether ACP `session/new` can carry a system prompt is **UNCONFIRMED** (not audited).
- **Size limits:** none documented for agent prompts or `instructions` (remote instruction URLs have a 5-second fetch timeout). Practical limit is model context.

### 1.2 Instruction files
- **AGENTS.md** (primary): project file discovered by traversing up from cwd (first match wins per category), plus global `~/.config/opencode/AGENTS.md`.
- **Claude Code compatibility (fallbacks):** project `CLAUDE.md` (used only if no `AGENTS.md`), global `~/.claude/CLAUDE.md` (only if no global `AGENTS.md`); skills compat too. Disable with `OPENCODE_DISABLE_CLAUDE_CODE` / `..._PROMPT` / `..._SKILLS`. Lookup order: local files (AGENTS.md > CLAUDE.md, cwd upward) → `~/.config/opencode/AGENTS.md` → `~/.claude/CLAUDE.md`. (https://opencode.ai/docs/rules/#precedence)
- **`instructions` config array:** paths, glob patterns and remote URLs; "All instruction files are **combined** with your `AGENTS.md` files" — i.e. **additive**, stacked on whatever system prompt the active agent has. Non-deprecated in the current schema ("Additional paths or URLs supplying ambient instructions"). (https://opencode.ai/docs/rules/#custom-instructions, https://opencode.ai/docs/config/#instructions)
- **Per-run file path without user-global config: YES** — pass `instructions` (or an agent `prompt`/`system` via `{file:...}`) through `OPENCODE_CONFIG`/`OPENCODE_CONFIG_CONTENT`, e.g.
  `OPENCODE_CONFIG_CONTENT='{"instructions":[".ptah/lane-system-prompt.md"]}' opencode run "..."`.
  `{file:...}` paths resolve relative to the config file; for `OPENCODE_CONFIG` place the config file itself under `.ptah/` so relative paths resolve there. Relative-path resolution for `instructions` entries under `OPENCODE_CONFIG_CONTENT` (no config file on disk) is **UNCONFIRMED** — prefer `OPENCODE_CONFIG` with a file, or absolute paths.

### 1.3 Skills
- Locations (project paths walked up from cwd to the git worktree): `.opencode/skills/<name>/SKILL.md`, `~/.config/opencode/skills/<name>/SKILL.md`, plus Claude-compatible `.claude/skills/` & `~/.claude/skills/` and agent-compatible `.agents/skills/` & `~/.agents/skills/`. Extra sources via top-level `skills` config (paths/URLs). (https://opencode.ai/docs/skills/, https://opencode.ai/config.json `skills`)
- `SKILL.md` YAML frontmatter: `name` (required, 1–64 chars, `^[a-z0-9]+(-[a-z0-9]+)*$`, must match dir name), `description` (required, 1–1024 chars), `license`, `compatibility`, `metadata` (incl. `opencode/slash`, `opencode/autoinvoke`).
- Invocation: OpenCode lists skills (name + description) inside the **native `skill` tool description** (`<available_skills>`); the model loads one on demand by calling `skill({ name: "..." })`. `opencode/autoinvoke: "false"` hides a skill from model-facing guidance (manual load by exact name still possible). Permissions: `permission.skill` glob patterns (`allow`/`ask`/`deny`, e.g. `internal-*: deny`), overridable per agent; `tools: {skill: false}` removes the tool entirely.

### 1.4 MCP tool allow/deny per run
- Servers: `mcp` config (local `command`/remote `url`), per-server `enabled`/`disabled` (new schema form `mcp.servers.<name>` with `disabled`; the old flat map is deprecated). `opencode mcp add/list`. (https://opencode.ai/docs/config/#mcp-servers, https://opencode.ai/docs/mcp-servers/)
- Tool-level gating: the **`permission` map** (v1 docs; schema: ordered `permissions` ruleset) uses keys that are **wildcard patterns matched against tool names**, so the same syntax covers built-ins, custom tools and MCP tools: `"mymcp_*": "deny"`, `"mymcp_search": "ask"`; per-agent override via `agent.<name>.permission` (new: `agents.<name>.permissions`). Values `allow | ask | deny`; **default is allow-all**. Legacy agent `tools: {"mymcp_*": false}` still works but is deprecated. `permission.task` additionally gates which subagents an agent may invoke. (https://opencode.ai/docs/agents/#permissions)
- Per run: pass `mcp`/`permission(s)` overrides via `OPENCODE_CONFIG_CONTENT` — nothing is written to user-global config.

### 1.5 Recommendation (lane system prompt, ~3–5 KB, vendor-neutral)
- **Primary (native, additive, no user-global writes):** `OPENCODE_CONFIG=<workspace>/.ptah/opencode-lane.json` containing `{"instructions":["./lane-system-prompt.md"]}` (or absolute path), run `opencode run --agent build "…"`. `instructions` is additive on top of the built-in agent prompt + AGENTS.md, so the harness's own system prompt survives. Prefer `OPENCODE_CONFIG` (file) over `OPENCODE_CONFIG_CONTENT` (inline JSON) for a multi-KB prompt — `{file:...}` reads it from disk without JSON-escaping. Caveat: `OPENCODE_CONFIG` sits *below* project `opencode.json` in precedence; use `OPENCODE_CONFIG_CONTENT` (inline, or with absolute paths) if a project config might define conflicting keys.
- **Alternative (full control, replace semantics):** define a lane agent (`agents.lane` / v1 `agent.lane`) with `system`/`prompt: "{file:./lane-system-prompt.md}"`, `mode: "primary"`, and run `opencode run --agent lane` — replaces the built-in prompt entirely.
- **Fallback:** argv prompt preamble in `opencode run "…"`.

---

## 2. pi coding agent (@earendil-works/pi-coding-agent 1.3.0)

**Sources** (accessed 2026-10-21):
- Docs (versioned "latest"): https://pi.dev/docs/latest · cli.md · configuration.md · skills.md (e.g. https://pi.dev/docs/latest/cli.md)
- Site: https://pi.dev/ · Repo: https://github.com/earendil-works/pi (formerly `badlogic/pi-mono`, package `packages/coding-agent`)
- Version: npm `@earendil-works/pi-coding-agent@1.3.0` (registry, 2026-10-21). Pi 1.0 line; maintained by Earendil Inc.

### 2.1 System/developer instruction channels for a headless run
- **`pi --system-prompt <text|path>`** — "Replaces the default system prompt with text or the contents of an existing file." (https://pi.dev/docs/latest/cli.md#prompts-and-process)
- **`pi --append-system-prompt <text|path>`** — "Appends text or an existing file to the system prompt and is repeatable." Both flags apply **to the current process only** — the cleanest per-run channel of the four runtimes.
- **Files:** `<agent-dir>/SYSTEM.md` (replaces Pi's default system prompt) and `<agent-dir>/APPEND_SYSTEM.md` (adds instructions) at user level; `.pi/SYSTEM.md` and `.pi/APPEND_SYSTEM.md` at project level. Project `.pi` config loads only after **project trust** (`-a/--approve` trusts for this process, `-na` ignores). Trusted project file takes precedence over the agent-dir file; same-named files are **not combined**. Agent dir defaults to `~/.pi/agent` and can be relocated per process via `PI_CODING_AGENT_DIR` (or SDK `agentDir`) — a full user-config isolation lever. (https://pi.dev/docs/latest/configuration.md)
- Headless modes: `pi --print/-p "…"` (one-shot text), `--mode json` (JSONL events), `--mode rpc`, plus a TypeScript SDK. (https://pi.dev/docs/latest/cli.md#modes)
- **Size limit:** none documented.

### 2.2 Instruction files (context files)
- **AGENTS.md / AGENTS.MD / CLAUDE.md / CLAUDE.MD** loaded from the agent directory (`~/.pi/agent`), the working directory, and parent directories; a context file applies whenever Pi runs in its directory or below. `AGENTS.override.md` replaces `AGENTS.md`/`CLAUDE.md` **only in the same directory** (does not suppress other directories' files). Context-file discovery does **not** require project trust. `-nc/--no-context-files` disables discovery. (https://pi.dev/docs/latest/configuration.md#context-files)
- **Per-run instruction file path without user-global config: YES** — `--append-system-prompt <path>` / `--system-prompt <path>` (file contents, current process only).

### 2.3 Skills
- Pi implements the **Agent Skills spec** (agentskills.io). Locations: `<agent-dir>/skills/`, project `.pi/skills/`, plus spec locations `~/.agents/skills/` and `.agents/skills/` (project ones discovered from working dir through ancestors, stopping at the repo root). Directories containing `SKILL.md` are discovered recursively. (https://pi.dev/docs/latest/skills.md)
- Loading model: at startup Pi scans skill locations and adds each skill's **name, description and path to the system prompt** (not the full body — progressive disclosure); the model reads `SKILL.md` when a task matches. `/skill:name [args]` forces invocation (args are appended as a user request); `disable-model-invocation: true` makes a skill command-only. Per-run: `--skill <path>` (repeatable) loads explicit skills; `--no-skills` disables discovered/configured skills (explicit `--skill` still loads). Frontmatter: name (≤64), description (≤1024), license, compatibility, metadata, allowed-tools (experimental), disable-model-invocation.

### 2.4 MCP tool allow/deny per run
- Servers: `<agent-dir>/mcp.json` (every project) and `.pi/mcp.json` (project, trusted projects only); managed via `pi mcp add/remove/list/login` (`--local` for project scope, `--exposure` mode per server). `--no-mcp` disables all MCP for the run. (https://pi.dev/docs/latest/cli.md#mcp-commands)
- Per-run tool selection: `-t/--tools <list>` — comma-separated allowlist of tool names/patterns (`*` wildcards) that **replaces the declared tool set**. MCP tools are kept unless an entry starts with `mcp__` — e.g. `pi --tools read,bash,codemode,'mcp__radius__*'` declares only that server's MCP tools. `-xt/--exclude-tools` disables tools/patterns after all other selection (`--exclude-tools 'mcp__*'` removes all MCP tools). `+name`/`-name` entries mutate the default selection instead of replacing. MCP tools not named/matched are never declared directly; each server's **exposure** mode (declared/deferred/codemode — see https://pi.dev/docs/latest/mcp.md) sets its reach, and only `tool_search` can surface undeclared ones. (https://pi.dev/docs/latest/cli.md#tools)

### 2.5 Recommendation
- **Primary:** `pi --append-system-prompt <workspace>/.ptah/lane-system-prompt.md --print "<task>"` — native append channel, takes a file path directly, per-process only, no config writes, no trust prompt.
- **Alternative (workspace-scoped):** `.pi/APPEND_SYSTEM.md` in the workspace (append; needs project trust — combine with `-a` for unattended runs).
- **Fallback:** argv prompt preamble. Use `--system-prompt` only if full replacement is intended (loses pi's tuned default prompt).

---

## 3. xAI Grok Build (official `grok` CLI)

**Sources** (accessed 2026-10-21):
- Docs: https://docs.x.ai/build/overview · https://docs.x.ai/build/cli/headless-scripting · https://docs.x.ai/build/features/project-rules · https://docs.x.ai/build/features/skills-plugins-marketplaces · https://docs.x.ai/build/features/permissions · https://docs.x.ai/build/features/mcp-servers · https://docs.x.ai/build/settings/reference · https://docs.x.ai/build/modes-and-commands
- Announcement: https://x.ai/news/grok-build-cli (May 25, 2026) · Product: https://x.ai/build (Grok 4.7)
- Repo: https://github.com/xai-org/grok-build (exists; **no version tags/releases published** — GitHub API 2026-10-21 → version **UNCONFIRMED**; docs pages search-indexed Jul 2 – Oct 10, 2026). This is xAI's official CLI (the community `superagent-ai/grok-cli` is a different, unofficial project).

### 3.1 System/developer instruction channels for a headless run
- **`grok --rules "<text>"`** — "To add rules for a single run without editing files, pass `--rules` (Grok **appends the text to the system prompt**)". Per-run, additive. Docs show inline text only; whether a file path is accepted is **UNCONFIRMED** → inline file contents via the shell: `grok --rules "$(cat .ptah/lane-system-prompt.md)"`. (https://docs.x.ai/build/features/project-rules#session-rules)
- **`grok --system-prompt-override`** — "replace the system prompt entirely" (same page). Replacement semantics.
- **`GROK_AGENT` env** — "Built-in agent name, profile, or absolute path to an agent definition" (https://docs.x.ai/build/settings/reference). Agent definitions are managed with `/config-agents` in the TUI; whether they carry custom system prompts is **UNCONFIRMED** (not detailed in the fetched pages).
- Headless: `grok -p/--single "<prompt>"`, `--output-format plain|json|streaming-json`, `-m/--model`, `--cwd`, `--always-approve`, `--no-alt-screen`, sessions via `-s/--session-id`, `-r/--resume`, `-c/--continue` (stored in `~/.grok/sessions`), `--no-auto-update` for CI. (https://docs.x.ai/build/cli/headless-scripting)
- **ACP:** `grok agent stdio`; the documented `session/new` example passes only `{cwd, mcpServers}` — no system-prompt field shown (**UNCONFIRMED** whether ACP exposes one). (https://docs.x.ai/build/cli/headless-scripting#acp)
- **Size limits:** rules files are "loaded in full, with no size cap"; no documented limit for `--rules` text either.

### 3.2 Instruction files
- Reads the **AGENTS.md family** — `AGENTS.md`, `Agents.md`, `AGENT.md` — plus Claude files `CLAUDE.md`, `Claude.md`, `CLAUDE.local.md`, and every `*.md` in `.grok/rules/` (`.claude/rules/` and `.cursor/rules/` read for compatibility). gitignored files are skipped; nested `AGENTS.md` scopes to its subtree. (https://docs.x.ai/build/features/project-rules)
- **Lookup order:** global rules in `~/.grok/` first, then every directory from the repo root down to the working directory (deeper files take precedence on conflicts; only the working directory outside a git repo).
- **Claude Code compatibility is on by default**: "Grok automatically reads Claude Code marketplaces, plugins, skills, MCPs, agents, hooks, and instruction files … alongside `.grok/`" — toggle per-feature with `[compat.claude]`/`[compat.cursor]` in config.toml or `GROK_CLAUDE_*_ENABLED` env vars. Also discovers `~/.agents/skills/` and `~/.agents/commands/`. (https://docs.x.ai/build/features/skills-plugins-marketplaces)
- **Per-run instruction file path:** only as `--rules "<text>"` (appended to the system prompt). No documented flag points Grok at an arbitrary instruction-file path — auto-discovery covers only `.grok/rules/*.md` and the standard files — so a `.ptah/`-resident file must be inlined (e.g. `"$(cat …)"`).

### 3.3 Skills
- Discovery: `./.grok/skills/` (walked up to the repo root), `~/.grok/skills/`, any enabled plugin's `skills/` directory, and extra `[skills] paths` in `~/.grok/config.toml`; `[skills] disabled` deactivates by name. Claude-compatible skill directories are scanned too. (https://docs.x.ai/build/features/skills-plugins-marketplaces)
- `SKILL.md` YAML frontmatter: `name`, `description` (first body paragraph if omitted), `when-to-use` (extra trigger phrases), `paths` (gitignore globs — skill hidden until a matching file is touched), `allowed-tools` (explicitly "does not grant or restrict tools"), `argument-hint`, `user-invocable` (default true), `disable-model-invocation` (slash-only), `metadata`.
- Invocation: user-invocable skills double as slash commands (`/<skill-name>`, qualified `/local:name` on collision); the model invokes skills automatically based on description/when-to-use triggers. `grok inspect` lists every discovered config source, instruction file (with token counts), skill, plugin, hook, and MCP server.

### 3.4 MCP tool allow/deny per run
- Servers: `grok mcp add [--scope project]` writes `[mcp_servers.<name>]` (stdio: `command/args/env/cwd`; HTTP: `url/headers/bearer_token_env_var`; common: `enabled`, `startup_timeout_sec`, `tool_timeout_sec`, `tool_timeouts`). Project `.grok/config.toml` (walked cwd→git root) may contribute only `[mcp_servers]`, `[plugins]`, `[permission]`; a same-name project server replaces the user one. Also loads `~/.claude.json`, `.cursor/mcp.json`, and project `.mcp.json`, merged **below** config.toml in priority. (https://docs.x.ai/build/features/mcp-servers, https://docs.x.ai/build/settings/reference)
- Per-run tool rules: **`--allow` / `--deny` CLI flags** take rule patterns per invocation with filters `Bash`, `Edit`, `Read`, `Grep`, **`MCPTool`**, `WebFetch`, `WebSearch` (compact form e.g. `MCPTool(server__*)`); **deny always wins over allow**. Config `[permission]` supports `allow`/`deny`/`ask` rule arrays (or verbose `{action, tool, pattern}`); evaluation order **deny > ask > allow**. `--always-approve` auto-approves tool calls but deny rules still apply. (https://docs.x.ai/build/features/permissions)

### 3.5 Recommendation
- **Primary:** `grok --rules "$(cat <workspace>/.ptah/lane-system-prompt.md)" -p "<task>"` — the only per-run system-prompt channel that writes no config; semantically an **append** to the system prompt. Caveat: text rides on argv (no file-path form documented — **UNCONFIRMED**), so mind shell quoting/arg-length on Windows.
- **Alternative (workspace-scoped, auto-discovered, not per-run):** drop the prompt at `.grok/rules/lane.md` in the workspace — Grok loads it automatically every session (workspace config, not user-global).
- **Fallback:** argv prompt preamble. Avoid `--system-prompt-override` for a vendor-neutral lane prompt unless full replacement is intended.

---

## 4. Anthropic Claude Agent SDK for TypeScript (@anthropic-ai/claude-agent-sdk 0.3.305)

**Sources** (accessed 2026-10-21):
- TypeScript SDK reference: https://platform.claude.com/docs/en/api/agent-sdk/typescript (also served at https://code.claude.com/docs/en/agent-sdk/typescript)
- Skills: https://code.claude.com/docs/en/agent-sdk/skills · Claude Code features / settingSources: https://code.claude.com/docs/en/agent-sdk/claude-code-features
- Version: npm `@anthropic-ai/claude-agent-sdk@0.3.305` (registry, 2026-10-21). The SDK bundles the Claude Code binary; SDK version tracks the bundled Claude Code version.

### 4.1 System/developer instruction channels for a headless run
- **`options.systemPrompt`** on `query()`:
  - `string` (or `string[]` with the exported `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` to cache-split a custom prompt) → **replaces** the system prompt; default `undefined` means a *minimal* prompt, not Claude Code's.
  - `{ type: 'preset', preset: 'claude_code', append: '<string>' }` → uses **Claude Code's system prompt and appends your instructions** — the designated append channel. Extras: `excludeDynamicSections` (moves per-session context into the first user message for cache reuse), `snapshot`.
  - `{ type: 'custom', prompt, snapshot? }` (v0.3.257+).
- **Subagents:** `options.agents` → `AgentDefinition.prompt` — required field, documented as "The agent's **system prompt**" (plus per-agent `tools`, `disallowedTools`, `skills`, `mcpServers`, `permissionMode`, `omitClaudeMd`…).
- **`settingSources`** does *not* set the system prompt — it controls which filesystem settings load (default when omitted: same as the Claude Code CLI, i.e. `user` + `project` + `local`; pass `[]` to load nothing). Managed policy and `~/.claude.json` are read regardless.
- Headless surface: `query({ prompt, options })`; streaming input mode via `AsyncIterable<SDKUserMessage>`; **`verbatimPrompts: true`** (v0.3.280+) / `client_composed` marks prompt text not typed by an end user — relevant when prepending a lane preamble to prompts.
- The `system/init` stream message is **output-only** (reports `slash_commands`, `skills`, capabilities) — not an injection channel.
- **Size limit:** none documented for `systemPrompt` (model context is the practical limit).

### 4.2 Instruction files
- **CLAUDE.md + rules via `settingSources`** (all additive, no hard precedence): `'project'` → `<cwd>/CLAUDE.md` (or `<cwd>/.claude/CLAUDE.md`), `CLAUDE.md` in every parent dir, `.claude/rules/*.md` in cwd + parents (child-dir CLAUDE.md loads on demand); `'user'` → `~/.claude/CLAUDE.md` + `~/.claude/rules/*.md`; `'local'` → `CLAUDE.local.md` (cwd + parents). (https://code.claude.com/docs/en/agent-sdk/claude-code-features#project-instructions-claude-md-and-rules)
- `additionalDirectories` entries are passed as `--add-dir` and load those directories' skills/commands/subagents (CLAUDE.md still loads from `cwd`, not from added dirs).
- **Per-run instruction file path without user-global config:** there is no option that points CLAUDE.md loading at an arbitrary file. The practical channel is host code reading `.ptah/lane-system-prompt.md` and passing its contents via `systemPrompt` (preset + `append`). The `plugins` option can load skills from specific paths; `settings` accepts an inline settings object or a settings-file path.

### 4.3 Skills
- Filesystem artifacts only — `.claude/skills/<name>/SKILL.md` (project), `~/.claude/skills/` (user), `.claude/skills/` in every parent of `cwd` up to the repo root, plus each `additionalDirectories` dir; discovered through `settingSources` (with default options they load). **No programmatic registration API.** (https://code.claude.com/docs/en/agent-sdk/skills)
- **`options.skills`**: `'all'` | exact name list | `[]` (default: discovered skills enabled and the Skill tool available; when set, the Skill tool is auto-added to `allowedTools` — if you also pass an explicit `tools` list, include `'Skill'`). Exact names only; wildcards rejected (since v0.3.221). Unlisted skills are invisible to the model and rejected by the Skill tool.
- Invocation: model-invoked via the **Skill tool** when the request matches the skill's `description`; user dispatch by sending `/name` in the prompt (works even when not in the `skills` list). The init system message's `skills` array confirms what loaded. `.claude/commands/*.md` legacy command files still work.

### 4.4 MCP tool allow/deny per run
- **`options.mcpServers`** — `Record<string, McpServerConfig>` per query (in-process config). **`strictMcpConfig: true`** restricts the session to *only* these servers (ignores project `.mcp.json`, user settings, plugin servers, claude.ai connectors).
- **`allowedTools`** — auto-approve list; explicitly **not a whitelist**: "This does not restrict Claude to only these tools"; unlisted tools fall through to `permissionMode`/`canUseTool`.
- **`disallowedTools`** — deny list; a bare name (e.g. `"Bash"`) **removes the tool from Claude's context**; a scoped rule (`"Bash(rm *)"`) keeps the tool and denies matching calls in every mode including `bypassPermissions`.
- **`tools`** — the actual toolset: array of tool names or `{ type: 'preset', preset: 'claude_code' }`.
- Also: `permissionMode`, `canUseTool` callback, per-subagent `disallowedTools` accepting `mcp__server`, `mcp__server__*`, `mcp__*`.

### 4.5 Recommendation
- **Primary:** `systemPrompt: { type: 'preset', preset: 'claude_code', append: lanePrompt }` — a per-`query()` option, nothing written to disk, keeps the full Claude Code harness prompt and **appends** the vendor-neutral lane prompt. Read the 3–5 KB text from `.ptah/lane-system-prompt.md` in Ptah's host code.
- **If lanes must not inherit Claude Code harness behavior:** plain string `systemPrompt` (full replacement) — you then own the entire harness prompt.
- **Fallback:** prepend the lane text to the `prompt`/streamed user message with `verbatimPrompts: true` (or per-message `client_composed`) since the text is not end-user-typed.

---

## Summary table

| Runtime (version, date) | System/dev channel | Instruction files + per-run path | Skills | MCP allow/deny | Recommended channel | Fallback |
|---|---|---|---|---|---|---|
| **opencode 1.19.3** (docs Oct 20, 2026) | Agent system prompt via config: `agent.<n>.prompt` (string/`{file:}`; docs: "custom system prompt for this agent") → new `agents.<n>.system`. No CLI flag. Per-run env: `OPENCODE_CONFIG` (file, below project cfg) / `OPENCODE_CONFIG_CONTENT` (inline, above project cfg) / `OPENCODE_CONFIG_DIR` | `AGENTS.md` (cwd↑, then `~/.config/opencode/AGENTS.md`, CLAUDE.md fallbacks) + `instructions` array (**additive**, globs/URLs). Per-run: `instructions:["<abs>/.ptah/lane-system-prompt.md"]` via `OPENCODE_CONFIG(_CONTENT)` | `.opencode/skills`, `~/.config/opencode/skills`, `.claude(/~/.claude)/skills`, `.agents(/~/.agents)/skills` + `skills` config paths/URLs; native `skill` tool (`skill({name})`), on-demand, `permission.skill` patterns | `mcp` config, per-server `enabled`/`disabled`; `permission`/`permissions` glob rules incl. `"mymcp_*": "deny"` (allow/ask/deny), per-agent; default allow-all; per-run via env config | `OPENCODE_CONFIG=<ws>/.ptah/opencode-lane.json` with `instructions:["./lane-system-prompt.md"]` (additive; `{file:}` resolves next to the config). Use `OPENCODE_CONFIG_CONTENT` if a project config may conflict | argv preamble in `opencode run`; or dedicated lane agent (`--agent lane`, replace semantics) |
| **pi 1.3.0** (@earendil-works) | `--system-prompt <text\|path>` (**replace**), `--append-system-prompt <text\|path>` (**append**, repeatable); `SYSTEM.md`/`APPEND_SYSTEM.md` in `~/.pi/agent` or project `.pi` (trust-gated; project wins, not merged); `PI_CODING_AGENT_DIR` isolates agent dir per run | Context files `AGENTS.md`/`CLAUDE.md` (+`AGENTS.override.md`, same-dir replace) from agent dir, cwd, parents; `-nc` disables. **Per-run: `--append-system-prompt <path>`** (file, process-only) | Agent Skills spec: `<agent-dir>/skills`, `.pi/skills`, `~/.agents/skills`, `.agents/skills` (recursive `SKILL.md`); name+description+path injected at startup, model loads body on demand; `/skill:name`; `--skill <path>`, `--no-skills` | `~/.pi/agent/mcp.json` + `.pi/mcp.json` (trusted); `--tools` allowlist (`mcp__srv__*` filters MCP), `--exclude-tools 'mcp__*'`, `--no-mcp`, per-server exposure modes | `pi --append-system-prompt <ws>/.ptah/lane-system-prompt.md --print "<task>"` | `.pi/APPEND_SYSTEM.md` (workspace, needs `-a` trust) or argv preamble |
| **Grok Build** (`grok`, version UNCONFIRMED — no tags; docs accessed Oct 21, 2026) | `--rules "<text>"` (**appends to system prompt**, per run); `--system-prompt-override` (**replace**); `GROK_AGENT` env → agent definition (prompt semantics UNCONFIRMED); ACP `session/new` shows only `{cwd, mcpServers}` | `AGENTS.md`/`Agents.md`/`AGENT.md` + `CLAUDE.md`/`Claude.md`/`CLAUDE.local.md` + `.grok/rules/*.md` (compat `.claude/rules`, `.cursor/rules`); global `~/.grok` first, then repo root → cwd, deeper wins; no size cap. Per-run: `--rules` **text only** (no path form documented) | `.grok/skills` (walked to repo root), `~/.grok/skills`, plugin `skills/`, `[skills] paths`; slash commands `/name` + model invocation via description/when-to-use; `[skills] disabled`; Claude skills scanned | `grok mcp add [--scope project]` → `[mcp_servers]` (+`~/.claude.json`, `.cursor/mcp.json`, `.mcp.json` merged below); per-run `--allow`/`--deny` rules incl. `MCPTool(server__*)`; `[permission]` deny>ask>allow | `grok --rules "$(cat <ws>/.ptah/lane-system-prompt.md)" -p "<task>"` | `.grok/rules/lane.md` (workspace auto-discovery) or argv preamble; `--system-prompt-override` only if replace intended |
| **Claude Agent SDK TS 0.3.305** | `options.systemPrompt`: string (replace; default = minimal prompt) or `{type:'preset',preset:'claude_code',append}` (**Claude Code prompt + append**); `agents[].prompt` = subagent system prompt; `system/init` message is output-only | `CLAUDE.md`/`.claude/rules` via `settingSources` (omitted = user+project+local like CLI; `[]` = none; additive). No arbitrary per-run memory-file path → host reads `.ptah/` file and passes via `systemPrompt` | `.claude/skills/<n>/SKILL.md` (+ user, parents, `additionalDirectories`) via settingSources; `skills` option (`'all'`/names/`[]`, exact names); model-invoked Skill tool + `/name` dispatch | `mcpServers` per query; `strictMcpConfig` (only these); `allowedTools` (auto-approve, **not** a whitelist); `disallowedTools` (bare name removes tool; scoped denies); `tools` = toolset | `systemPrompt: {type:'preset', preset:'claude_code', append: lanePrompt}` per query | prepend to prompt with `verbatimPrompts`/`client_composed`; or string `systemPrompt` (full replace) |

---

## UNCONFIRMED items (not settled by an official source)

- **opencode:** whether `prompt`/`system` on a *built-in* agent (e.g. `build`) fully replaces its tuned prompt (docs say "custom system prompt for this agent" — treated as replace); relative-path resolution of `instructions` entries when config comes from `OPENCODE_CONFIG_CONTENT` (no on-disk config file); existence of a `--config` CLI flag in 1.19.x (present in older releases, absent from the current CLI page); ACP (`opencode acp`) `session/new` system-prompt support; the separate **v2 docs line** (opencode.ai/v2/docs) was not audited.
- **pi:** MCP exposure-mode details cited from cli.md's summary — the underlying mcp.md page was not read directly; SDK/RPC option surface (sdk.md, rpc.md) not audited.
- **Grok Build:** no published version tags/releases on github.com/xai-org/grok-build (checked 2026-10-21) — cite by doc date instead; whether `--rules` accepts a file path (docs show inline text only); whether agent definitions (`GROK_AGENT`, `/config-agents`) carry custom system prompts; ACP `session/new` fields beyond `{cwd, mcpServers}`.
- **Claude Agent SDK:** nothing material — all claims taken from the official TypeScript reference, skills page and Claude Code features page; npm latest verified as 0.3.305 on 2026-10-21.
