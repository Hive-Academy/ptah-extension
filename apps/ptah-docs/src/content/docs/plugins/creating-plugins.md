---
title: Creating Plugins
description: Build a plugin — structure, metadata, and how to share it.
---

A Ptah plugin is a folder with a `.claude-plugin/plugin.json` manifest, a `skills/` folder, and a `commands/` folder.

## Structure

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

| Folder                   | Contents                                    | Becomes                                                     |
| ------------------------ | ------------------------------------------- | ----------------------------------------------------------- |
| `skills/<name>/SKILL.md` | A skill and optional `references/`          | A copy in the skill folder of each detected AI tool         |
| `commands/*.md`          | Slash command definitions                   | A copy in `.claude/commands/`                               |

```json title="plugin.json"
{
  "name": "my-plugin",
  "description": "One-line description of what this plugin does",
  "version": "0.1.0",
  "author": { "name": "Your Name" },
  "license": "MIT"
}
```

`plugin.json` follows the Claude Code plugin convention. PtahCode identifies a plugin by its folder name.

### Skill file

```markdown title="skills/my-framework-patterns/SKILL.md"
---
name: my-framework-patterns
description: Patterns and conventions for MyFramework apps. Use when writing MyFramework components, services, or tests.
---

# My Framework Patterns
```

### Command file

```markdown title="commands/my-command.md"
---
description: Runs a custom workflow.
---

Steps to perform when `/my-command` is invoked...
```

## No sideloading

PtahCode does not load a folder that you copy into `~/.ptah/plugins/`. It uses only these plugins:

- The official plugins in the content manifest.
- `ptah-harness-*` plugins. See [Harness plugins](/plugins/harness-plugins/).
- Skills that you install from **Marketplace → Community** (skills.sh).
- Plugins that you install from an external marketplace and approve.

## Test a skill locally

Create the skill with the harness. Use the [AI Team Builder](/setup/ai-team-builder/) or ask an agent to call `ptah_harness_create_skill`. The plugin shows under **Your Skills** and is active at once.

## Share a plugin through a marketplace

PtahCode can install plugins from any GitHub repository that has a `.claude-plugin/marketplace.json` file.

1. Publish your plugins in a GitHub repository with `.claude-plugin/marketplace.json`.
2. In PtahCode, open **Marketplace → Sources → Marketplaces**.
3. Type the repository as `owner/repo` and click **Add**.
4. Browse its plugins and install one. PtahCode shows what it will write to disk before the install.

## Submit an official plugin

Official plugins are in the [PtahCode repository](https://github.com/Hive-Academy/PtahCode) under `plugins/`.

1. Fork the repository.
2. Add your plugin folder under `plugins/<your-plugin>/`.
3. Run `node scripts/generate-content-manifest.js` to make the manifest again.
4. Open a pull request.

PtahCode downloads only the files in the manifest, so step 3 is necessary.

## Style guide

- Keep skills narrow. Write one skill for each topic.
- Write a clear trigger in `description`, for example "Use when writing Angular forms".
- Put long material in `references/` and link it from `SKILL.md`.

## Next steps

- [Harness plugins](/plugins/harness-plugins/)
- [Plugin storage](/plugins/plugin-storage/)
- [Creating skills](/mcp-and-skills/creating-skills/)
