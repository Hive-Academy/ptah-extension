# OpenCode Context & Tooling Probe

Probe of what the Ptah host injected into this spawned OpenCode CLI session. Evidence was gathered with the harness's own tools (shell, read, execute-code catalog search) in this session on 2026-09-22.

## 1. Tools

**Direct top-level tools visible to me (no `ptah_*`, no `mcp__ptah*`, no `execute_code` as a top-level name):** `edit`, `glob`, `grep`, `read`, `shell`, `skill`, `subagent`, `webfetch`, `websearch`, `execute`.

**Inside the `execute` (Code Mode) catalog:** `search`, plus namespaces `browser` (45 tools, 7 shown in the header — e.g. `browser.back`, `browser.forward`, `browser.preview`, `browser.reload`, `browser.stop`, `browser.tabs.list`, `browser.tabs.open`), `opencode` (3: `opencode.models`, `opencode.session_move`, `opencode.session_rename`), and `ptah` (52 tools, 6 shown: `ptah_agent_list`, `ptah_browser_close`, `ptah_browser_status`, `ptah_get_dirty_files`, `ptah_get_symbol_index`, `ptah_task_check`).

- Tool whose name starts with `ptah_`: **yes** — but only as `tools.ptah.ptah_*` reachable through `execute`, not as a direct top-level tool. Catalog search for "workspace analyze" returned path `tools.ptah.ptah_workspace_analyze`.
- Tool named `execute_code`: **yes** — as `tools.ptah.execute_code` inside the `ptah` namespace of the `execute` catalog (description: "Execute TypeScript/JavaScript against the global `ptah` API for multi-step workflows only... `ptah.files` is read-only.").
- Name starting with `mcp__ptah`: **not present** anywhere I can see — the MCP server surfaces under the plain namespace `ptah`, not an `mcp__` prefix.

I called `tools.ptah.ptah_workspace_analyze()` once. First 5 lines of its result:

```text
## Workspace Analysis


**Project Type:** react  
```

## 2. MCP servers

**Server names:** exactly one — `ptah`.

**Config source:** the environment variable `OPENCODE_CONFIG_CONTENT` (not a project `opencode.json`; the user-level `~/.config/opencode/opencode.jsonc` contains only `{"$schema": ...}` and no `mcp` key).

Single shell command output:

```text
OPENCODE_CONFIG_CONTENT EXISTS:
{"mcp":{"ptah":{"type":"remote","url":"http://localhost:51820/agent/31ae7da1-baad-447b-ac1e-92502b34ecbc/workspace/D%3A%5Cprojects%5Cptah-extension","enabled":true}}}
```

So `ptah` is a **remote** MCP server at `http://localhost:51820/agent/31ae7da1-baad-447b-ac1e-92502b34ecbc/workspace/...`, injected via env var by the Ptah host that spawned this session.

## 3. System / role prompt

- `## Role: researcher-expert` section: **yes present.** The prompt contains `## Role: researcher-expert` followed by the full role definition ("You are running as the `researcher-expert` role...").
- Line starting `Tool policy:`: **yes present.** Exact text: `Tool policy: prefer direct \`ptah_*\` tools over \`execute_code\`. \`ptah.files\` is read-only; use native CLI write/edit tools for file creation or edits, never \`execute_code\`.`
- `Two-way messaging:`: **yes present.** Exact lead-in: `Two-way messaging: you are a spawned agent and the session that spawned you can reach you.` followed by `ptah_agent_report` / `ptah_agent_spawn` / `ptah_agent_message` instructions.
- Ptah project-specific guidance BEFORE the role section: **yes present.** The prompt opens with `## Project-Specific Guidance` / `### Project Context` describing "Ptah (`@ptah-extension/source`)" as an "AI coding orchestra" monorepo, then Framework Guidelines / Coding Standards / Architecture Notes — all before `## Role: researcher-expert`. Marker check: the exact string `Ptah Extension` is **not present** (it is written `Ptah (\`@ptah-extension/source\`)`), `ptah_workspace_analyze` appears only *inside* the role section (Tooling precedence), and `MANDATORY Substitutions` is **not present** anywhere in my prompt.

## 4. Instruction files

**Did OpenCode load a project instruction file (AGENTS.md / CLAUDE.md / opencode.json / .opencode/)?** No such file exists at the repo root, so none could be loaded from there. Single shell command result:

```text
MISSING: AGENTS.md
MISSING: CLAUDE.md
MISSING: opencode.json
MISSING: opencode.jsonc
MISSING: .opencode
EXISTS: .agents/skills
EXISTS: .codex/agents
EXISTS: .claude/agents
EXISTS: .claude/skills
```

User-level config `C:\Users\abdal\.config\opencode\opencode.jsonc` exists but is empty except `$schema`. The instruction-like content I received (project guidance, role, tool policy) came **in the prompt text itself**, not from an AGENTS.md/CLAUDE.md file.

## 5. Skills and subagents

**Skills: yes.** The harness exposes a `skill` tool and an `<available_skills>` list in my system context: `agent-lanes`, `angular-3d-scene-crafter`, `angular-frontend-patterns`, `angular-gsap-animation-crafter`, `ddd-architecture`, `execute-phase-gated-task`, `extract-and-relocate-angular-component-feature`, `fleet-orchestration`, `humanize-library`, `hyperframes`, `hyperframes-animation`, `hyperframes-audio`, `hyperframes-cli`, `hyperframes-core`, `hyperframes-creative`, `hyperframes-keyframes`, `hyperframes-registry`, `impeccable`, `media-use`, `motion-graphics`, `nestjs-backend-patterns`, `nestjs-deployment`, `nx-workspace-architect`, `opencode`, `orchestration`, `ptah-cli-usage`, `report`, `resilient-nestjs-patterns`, `saas-platform-patterns`, `saas-workspace-initializer`, `skill-creator`, `technical-content-writer`, `tribunal`, `typesafe-ai`, `ui-ux-designer`, `video-showcase`, `webhook-architecture`.

**From `.claude/skills` / `.agents/skills`: yes.** Directory listing shows `.claude/skills/` and `.agents/skills/` mirror each other (same 24–25 names) — and `fleet-orchestration` exists in `.claude/skills/` but **not** in `.agents/skills/`, yet it is exposed as an available skill. That pins at least `.claude/skills/` as a live source. The `hyperframes*`, `media-use`, `motion-graphics` skills correspond to the user-level `C:\Users\abdal\.claude\skills\` and `C:\Users\abdal\.agents\skills\` directories (both exist with those 10 names).

**Subagents: yes, but none from `.claude/agents`.** The `subagent` tool description lists exactly two: `explore` ("Fast agent specialized for exploring codebases") and `general` ("General-purpose agent for researching complex questions"). These are built-in OpenCode agents. The repo's `.claude/agents/` contains 15 role files (`backend-developer.md`, `researcher-expert.md`, `team-leader.md`, `visual-reviewer.md`, ...) and `.codex/agents/` the same 15 as `.toml` — **none of these appear as spawnable subagents** in my session; the researcher-expert role reached me as prompt text, not as an agent definition.

## 6. Model

**Yes.** From my system prompt's Model section:

- Name: `MiMo-V2.6-Flash Free`
- Provider ID: `opencode`
- Model ID: `mimo-v2.6-flash-free`
