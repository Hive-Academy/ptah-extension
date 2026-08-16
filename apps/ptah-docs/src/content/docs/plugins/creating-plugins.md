---
title: Creating Plugins
description: Build your own Ptah plugin — structure, metadata, and publishing.
---

A Ptah plugin is a plain folder with two well-known subdirectories and a `plugin.json` manifest. If you can write Markdown, you can write a plugin.

What you cannot do is install one yourself. Plugins reach users through the published content manifest, and `~/.ptah/plugins/` is managed against that manifest — so authoring a plugin means opening a pull request, not copying a folder. **Testing locally** below explains what to do in the meantime.

## The manifest

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

`plugin.json` is the Claude Code plugin convention and every bundled Ptah plugin carries one, but Ptah's own loader never parses it — a plugin is identified by its **directory name**. The manifest is metadata for humans and for other tools, not the thing that makes your plugin work. What makes it work is the content below.

## Full structure

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── my-framework-patterns/
│       ├── SKILL.md
│       └── references/
│           └── architecture.md
└── commands/
    └── my-command.md
```

| Folder                   | Contents                                  | Surfaces as                                               |
| ------------------------ | ----------------------------------------- | --------------------------------------------------------- |
| `skills/<name>/SKILL.md` | Skill definition + optional `references/` | A junction at `<workspace>/.claude/skills/<name>/`        |
| `commands/*.md`          | Slash command definitions                 | A file copied to `<workspace>/.claude/commands/<name>.md` |

Those are the only two directories Ptah reads out of a plugin. An `agents/` or `templates/` directory is not a plugin contribution — nothing in the loader or the junction pass looks for either, and none of the five bundled plugins ships one. Custom agents are authored separately; see [Custom agents](/agents/custom-agents/).

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

:::danger[There is no sideloading]
Ptah does **not** load arbitrary folders you place in `~/.ptah/plugins/`. There is no "load from folder" command, no reload command, and no **Local** badge. A hand-dropped folder sits there and is ignored. Use the harness wizard instead — see below.
:::

**Only two kinds of directory are ever resolved.** When a session starts, Ptah maps your enabled plugin IDs to directories and keeps an ID only if it is one of the five bundled plugin IDs or the name of a `ptah-harness-*` directory that exists on disk. Anything else is dropped with a log-only warning — nothing appears in the UI, and nothing tells you why. That is the whole reason sideloading does not work: the folder is never resolved, so its skills are never junctioned.

The folder does survive on disk. Ptah's stale-file pruning is scoped to the directories the published manifest populates, so a name the manifest never mentions is left alone — see [Plugin storage](/plugins/plugin-storage/). It simply does nothing.

### Author it through the harness instead

The supported way to create a plugin locally is the harness, which writes to a name Ptah already recognises:

```text
~/.ptah/plugins/ptah-harness-<slug>/
└── skills/
    └── <slug>/
        └── SKILL.md
```

Use the [AI Team Builder](/setup/ai-team-builder/) wizard, or ask an agent in chat to call `ptah_harness_create_skill`. The directory appears in **Marketplace → Plugins → Configure** under **Your Skills** with a **Yours** badge, and it is active the moment it exists — no ticking required. [Harness plugins](/plugins/harness-plugins/) covers the whole model, including the same pruning caution, which applies to these too.

### Iterating on a skill without a plugin

If you only want to test a `SKILL.md`, skip `~/.ptah/plugins/` altogether and write it straight into `<workspace>/.claude/skills/<skill-name>/SKILL.md`. That directory is your workspace's, not Ptah's: the junction pass leaves a real directory it finds there untouched, and nothing prunes it. See [Creating skills](/mcp-and-skills/creating-skills/).

## Publishing to the official marketplace

Official plugins are maintained in the [ptah-extension repository](https://github.com/Hive-Academy/ptah-extension) under `apps/ptah-extension-vscode/assets/plugins/`. To submit one:

1. Fork the repository.
2. Add your plugin folder under `assets/plugins/<your-plugin>/`.
3. Run `node scripts/generate-content-manifest.js` to regenerate the manifest.
4. Open a pull request with a short description and a link to usage examples.

Step 3 is not optional housekeeping. Ptah downloads only what the manifest enumerates, and inside the plugin directories the manifest owns it deletes files the manifest omits. So a plugin absent from the manifest is invisible — and dropping a file from a plugin that is still listed removes it from every user on the next refresh. CI enforces it: the `content-manifest` workflow runs `npm run manifest:check`, which writes nothing and fails the build on drift.

:::note
There is no private or third-party plugin channel today. Ptah's plugin catalog is exactly the set published in that manifest, so an installer script that copies a folder into `~/.ptah/plugins/` will not work — the folder is neither resolved nor kept. To share internal skills, distribute the `SKILL.md` files themselves and have each person drop them into their workspace's `.claude/skills/`, or commit them to the repository everyone already checks out.
:::

## Style guide

- **Keep skills narrow.** One skill per topic; break broad topics into multiple skills with a shared prefix.
- **Trigger phrases matter.** The `description` field is how the orchestrator decides when to invoke a skill. Include concrete verbs and nouns ("Use when writing Angular forms", not "Angular stuff").
- **Cite sources.** Put long-form reference material under `references/` and link from `SKILL.md` — skills load lazily.

## Next steps

- [Harness plugins](/plugins/harness-plugins/) — the only plugins you can author on your own machine
- [Plugin storage internals](/plugins/plugin-storage/) — what the manifest owns, and what it prunes
- [Creating skills](/mcp-and-skills/creating-skills/)
