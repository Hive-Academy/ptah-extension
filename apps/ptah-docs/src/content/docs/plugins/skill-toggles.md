---
title: Skill Toggles
description: Enable a plugin but turn off some of its skills, and how this works with the other gates.
---

You do not have to use all of a plugin. In the **Configure Ptah Skills** panel, you can expand an enabled plugin and turn off its skills one by one.

## Turn off a skill

1. Open **Marketplace → Sources → Ptah Plugins**.
2. Make sure that the plugin is selected. The skill list shows only for enabled plugins.
3. Click the chevron to expand the skill list.
4. Clear the skills that you do not want.
5. Click **Save Configuration**.

Each skill row shows the display name and the description from the `SKILL.md` frontmatter.

## What a disabled skill does

PtahCode records disabled skills in `disabledSkillIds` as skill folder names, for example `orchestration`. On the next sync, PtahCode removes the copy of the skill from each AI tool folder: `.claude/skills/`, `.agents/skills/`, `.github/skills/`, and `.cursor/skills/`. There is no switch for each tool.

The plugin stays enabled. Its other skills and its slash commands are not affected.

Skill IDs are one flat namespace without a plugin prefix. A disabled name is disabled for all sources.

## Required skills

Keep `agent-lanes` enabled when you use `orchestration` or `tribunal` on CLI lanes. The panel does not enable required skills for you. See [skill dependencies](/mcp-and-skills/skills/#skill-dependencies).

## How it interacts with the other two gates

A skill reaches a project only when all three gates allow it:

1. **Per-project selection** — does this project allow the skill? See [Per-project skill selection](/plugins/skill-selection/).
2. **Plugin enablement** — is the plugin of the skill enabled?
3. **Skill toggle** — is the skill turned on?

When you disable a plugin, PtahCode keeps the skill toggles that you set in it. They apply again when you enable the plugin again.

When you save, PtahCode removes names from the disabled list that match no skill in the enabled plugins or in your harness plugins.

## Next steps

- [Per-project skill selection](/plugins/skill-selection/)
- [Enable and disable plugins](/plugins/installing/)
- [Skills that you wrote](/plugins/harness-plugins/)
