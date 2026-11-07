# Context — TASK_2026_889_d57a

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\docs-evidence-sweep`
- Branch: `docs/docs-evidence-sweep` from origin/main 460a24e78
- Gate 0.1: lane preference from memory `cli-lane-selection-preference` (spread across lanes);
  current request names the claude CLI → mode `enabled`, approval `lane-review`.
- `ptah_agent_list` rows (2026-11-07): codex near limit (98% weekly), copilot disabled,
  cursor/pi not installed, antigravity/opencode/grok/claude installed (limits unknown),
  Glm AT LIMIT (resets 2026-11-09), kimi code AT LIMIT.

- First `claude` spawns without `accountSelection` failed: "Claude account refused
  (unsupported-source)". Spawns with `accountSelection: {kind: "ambient"}` succeeded.
- Lane ids: L1 f45d0608, L2 e92c18d7, L3 779f5460.

## Work split

| Executor | Scope |
| -------- | ----- |
| L1 claude lane | docs app: index.mdx, getting-started, setup, providers, settings, troubleshooting, reference |
| L2 claude lane | docs app: chat, sessions, agents, tribunal, tasks, canvas, workspace, git, memory |
| L3 claude lane | docs app: automation, browser-automation, mcp-and-skills, marketplace, plugins, skill-synthesis, templates |
| S1 subagent | root *.md, .github/copilot-instructions.md, docs/**, apps/ptah-docs/SCREENSHOTS.md, apps/ptah-electron*/**/*.md |
| S2 subagent | libs/**/README.md, tools/**/*.md, scripts/**/*.md |
| Orchestrator | apps/ptah-docs/astro.config.mjs sidebar |

## Lane limits this run

- grok (family grok): usage-limit, "Grok Build usage balance exhausted" (HTTP 402), reset unknown.
  Skipped for the rest of the run. Repository-docs review moved to antigravity.
- opencode (family opencode): usage-limit after 24 min, "Free usage limit reached", reset unknown.
  Only a 234-byte skeleton written. Docs-app review moved to antigravity.
