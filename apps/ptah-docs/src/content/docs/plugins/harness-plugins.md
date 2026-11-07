---
title: Harness Plugins
description: Skills that you write with the harness show as their own plugins, and they are active by default.
---

When you create a skill with the harness — the [AI Team Builder](/setup/ai-team-builder/) wizard or the `ptah_harness_create_skill` tool — PtahCode writes a small, complete plugin:

```text
<plugins folder>/ptah-harness-<name>/
└── skills/
    └── <name>/
        └── SKILL.md
```

For `ptah_harness_create_skill`, the plugins folder depends on `scope`:

| `scope`               | Plugins folder              |
| --------------------- | --------------------------- |
| `workspace` (default) | `{workspace}/.ptah/plugins` |
| `user`                | `~/.ptah/plugins`           |

## Find them in the catalog

Open **Marketplace → Sources → Ptah Plugins**. Each `ptah-harness-*` plugin shows in the **Your Skills** category with a **Yours** badge.

- The name comes from the folder name. `ptah-harness-release-notes` shows as _Release Notes_.
- The description comes from the frontmatter of the skill. If PtahCode cannot read it, the card shows "Custom skill you authored with the Ptah harness wizard."
- The skill count is the real number of skills in `skills/`.

## They are opt-out, not opt-in

| Plugin kind                               | Rule                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| Official (`ptah-core`, ...) and external  | **Opt-in.** Inactive until you select it and save         |
| Harness (`ptah-harness-*`) and skills.sh  | **Opt-out.** Active as soon as the folder exists          |

When you clear a harness plugin, PtahCode adds its ID to `disabledPluginIds`. A selected harness plugin is not added to `enabledPluginIds`.

## Per-skill toggles

A harness plugin with more than one skill expands like any other plugin. You can turn off its skills one by one. See [Skill toggles](/plugins/skill-toggles/).

## Your files are not pruned

Harness plugins in `~/.ptah/plugins/` are not deleted by the content download. The download prunes only the folders that the content manifest populates.

## Related

- [Skill toggles](/plugins/skill-toggles/)
- [AI Team Builder](/setup/ai-team-builder/)
- [Creating skills](/mcp-and-skills/creating-skills/)
- [Skill Synthesis](/skill-synthesis/)
