---
title: Creating Plugins
description: Build your own Ptah plugin — structure, metadata, and publishing.
---

A Ptah plugin is a plain folder with a few well-known subdirectories and a `plugin.json` manifest. If you can write Markdown, you can write a plugin.

## Minimum viable plugin

```text
my-plugin/
└── .claude-plugin/
    └── plugin.json
```

```json title="plugin.json"
{
  "name": "my-plugin",
  "description": "One-line description of what this plugin does",
  "version": "0.1.0",
  "author": { "name": "Your Name" },
  "repository": "https://github.com/you/my-plugin",
  "license": "MIT"
}
```

That alone is enough to be loaded — but it won't contribute anything until you add agents, skills, templates, or commands.

## Full structure

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json
├── agents/
│   └── frontend-reviewer.md
├── skills/
│   └── my-framework-patterns/
│       ├── SKILL.md
│       └── references/
│           └── architecture.md
├── templates/
│   └── starter-component.md
└── commands/
    └── my-command.md
```

| Folder                   | Contents                                  | Surfaces as                              |
| ------------------------ | ----------------------------------------- | ---------------------------------------- |
| `agents/`                | Agent prompt files with frontmatter       | Spawnable sub-agents                     |
| `skills/<name>/SKILL.md` | Skill definition + optional `references/` | Invokable skills (with auto-junctioning) |
| `templates/`             | Prompt and scaffold templates             | Entries in the Templates panel           |
| `commands/`              | Slash command definitions                 | `/commands` in chat                      |

### Agent file

```markdown title="agents/frontend-reviewer.md"
---
name: frontend-reviewer
description: Reviews frontend changes for accessibility and performance.
tools: Read, Grep, Glob
---

You are a frontend reviewer. When invoked:

1. Read the diff.
2. Check accessibility (ARIA, keyboard nav, contrast).
3. Flag performance issues (re-renders, large bundles).
4. Return a concise bullet list of findings.
```

### Skill file

```markdown title="skills/my-framework-patterns/SKILL.md"
---
name: my-framework-patterns
description: Patterns and conventions for MyFramework apps. Use when writing MyFramework components, services, or tests.
---

# My Framework Patterns

## Components

...
```

### Command file

```markdown title="commands/my-command.md"
---
name: my-command
description: Runs a custom workflow.
---

Steps to perform when `/my-command` is invoked...
```

## Testing locally

Drop your plugin folder directly into `~/.ptah/plugins/` and restart Ptah — or use the command palette:

- **Ptah: Load Plugin From Folder…** — pick any local directory and Ptah will sideload it.
- **Ptah: Reload Plugins** — re-scan `~/.ptah/plugins/` without restarting.

Sideloaded plugins are marked **Local** in the marketplace and do not auto-update.

## Publishing to the official marketplace

Official plugins are maintained in the [ptah-extension repository](https://github.com/Hive-Academy/ptah-extension) under `apps/ptah-extension-vscode/assets/plugins/`. To submit one:

1. Fork the repository.
2. Add your plugin folder under `assets/plugins/<your-plugin>/`.
3. Run `node scripts/generate-content-manifest.js` to regenerate the manifest.
4. Open a pull request with a short description and a link to usage examples.

:::tip
For private or internal plugins, host them in your own GitHub repo and share the folder via a simple installer script — Ptah reads any well-formed plugin it finds under `~/.ptah/plugins/`.
:::

## Style guide

- **Keep skills narrow.** One skill per topic; break broad topics into multiple skills with a shared prefix.
- **Trigger phrases matter.** The `description` field is how the orchestrator decides when to invoke a skill. Include concrete verbs and nouns ("Use when writing Angular forms", not "Angular stuff").
- **Cite sources.** Put long-form reference material under `references/` and link from `SKILL.md` — skills load lazily.

## Next steps

- [Plugin storage internals](/plugins/plugin-storage/)
- [Creating skills](/mcp-and-skills/creating-skills/)
