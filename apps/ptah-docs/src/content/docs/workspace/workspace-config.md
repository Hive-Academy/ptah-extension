---
title: Workspace Configuration
description: Per-workspace settings in .claude/ and .ptah/ — plugins, custom agents, and overrides.
---

# Workspace Configuration

Ptah supports **per-workspace configuration** through two directories at the project root: `.claude/` and `.ptah/`. Settings here override your global app settings and apply only while that workspace is active.

Checking these directories into git is the recommended way to share AI conventions, custom agents, and enabled plugins across a team.

## Directory layout

```
my-project/
├── .claude/
│   ├── agents/              # Custom agent definitions (markdown)
│   ├── skills/              # Custom skills (markdown + assets)
│   └── settings.json        # Claude Agent SDK-level overrides
├── .ptah/
│   ├── plugins.json         # Enabled plugins for this workspace
│   ├── agents.json          # Per-workspace agent preferences
│   ├── context.md           # Pinned context (see Workspace Intelligence)
│   ├── chats/               # Local chat history (gitignored by default)
│   └── analysis/            # Analysis cache (gitignored by default)
└── ...
```

## `.ptah/plugins.json`

Enable or disable plugins for the current workspace without affecting others. Missing plugins are fetched automatically from the community registry.

```json
{
  "enabled": ["angular-frontend-patterns", "nx-monorepo-helper", "commitlint-assistant"],
  "disabled": ["react-frontend-patterns"]
}
```

## `.ptah/agents.json`

Override agent defaults — pin a specific provider or model for a given agent in this workspace only.

```json
{
  "orchestrator": {
    "provider": "anthropic",
    "model": "claude-opus-4-7"
  },
  "code-reviewer": {
    "provider": "openai",
    "model": "gpt-5"
  }
}
```

## `.claude/agents/*.md`

Drop a markdown file here to define a custom agent available **only** in this workspace. The file's frontmatter describes the agent; the body is the system prompt.

```markdown
---
name: db-migration-reviewer
description: Reviews Prisma migration SQL for safety and backward compatibility.
model: claude-opus-4-7
---

You are a database migration reviewer. For every migration you see...
```

Custom workspace agents appear in the agent picker alongside built-in and plugin agents.

## `.claude/settings.json`

Claude Agent SDK settings — permissions, hooks, env vars. See the [Claude Agent SDK docs](https://docs.claude.com/en/docs/agents/sdk) for the full schema.

## Precedence

From lowest to highest priority:

1. Ptah built-in defaults.
2. Global app settings (`~/.ptah/settings.json`).
3. Workspace config (`.claude/` and `.ptah/` in the project root).
4. Ephemeral overrides set in the current chat.

:::caution
Never commit secrets (API keys, tokens) to `.claude/` or `.ptah/`. Those directories are meant to be shared. Put secrets in your global settings or environment variables instead.
:::

## Gitignore recommendations

A sensible default for most teams:

```gitignore
# Share conventions, hide local state
.ptah/chats/
.ptah/analysis/
!.ptah/plugins.json
!.ptah/agents.json
!.ptah/context.md
```
