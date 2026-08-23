---
title: Skill Toggles
description: Enable a plugin without enabling all of it — switch individual skills off and understand how that interacts with plugin enablement.
---

A plugin is a bundle, but you don't have to take all of it. Inside the **Configure Ptah Skills** modal, an enabled plugin can be expanded to reveal its individual skills, each with its own checkbox.

## Turning a skill off

1. Open **Marketplace → Plugins → Configure**.
2. Make sure the plugin is **checked**. The skill list only appears for enabled plugins.
3. Click the **chevron** next to the skill-count badge to expand the list.
4. Untick the skills you don't want.
5. Click **Save Configuration**.

Each skill row shows its display name and description, both read from the `SKILL.md` frontmatter, so you can tell `review-logic` from `review-security` without opening either file.

:::note
The chevron only renders when the plugin is enabled **and** its skills were successfully listed. A plugin whose files have not been downloaded yet shows its count badge but nothing to expand.
:::

## Skill copies reach every detected AI tool, not only Claude's

Ptah keeps one editable copy of each skill under `~/.ptah/user/skills`, then
reconciles it out to a manifest-owned copy in every AI tool it detects on your
machine — not a link, a real file. For skills, that means up to four target
directories inside the workspace:

| Target(s)             | Directory                         |
| --------------------- | --------------------------------- |
| Claude                | `.claude/skills/<slug>/`          |
| Codex and Antigravity | `.agents/skills/<slug>/` (shared) |
| Copilot               | `.github/skills/<slug>/`          |
| Cursor                | `.cursor/skills/<slug>/`          |

Only the tools you have installed get a copy — an undetected tool is not a gap.
Turning a skill off or on affects all of them together; there's no per-tool
switch.

## What a disabled skill means

Disabled skills are recorded per workspace as `disabledSkillIds`, a list of skill **directory names** — `orchestration`, `tribunal`, `ui-ux-designer`. On the next reconcile, a disabled skill drops out of the desired state: its copy is removed from every target directory listed above, and it is never recreated while it stays disabled.

The effect is that the skill stops being visible to agents in that workspace. The plugin stays enabled, its other skills stay live, and its slash commands are unaffected — command files come from `commands/`, not `skills/`, and skill toggles do not touch them.

Skill IDs are a **flat, global namespace**. `disabledSkillIds` holds a bare directory name with no plugin prefix, so disabling a name disables it wherever it comes from. In practice this doesn't bite, because two plugins can't both contribute the same skill name anyway — [the first one wins](/plugins/installing/#when-two-plugins-define-the-same-skill).

## How it interacts with plugin enablement

The two switches are independent lists in the same saved record, and they compose in one direction only:

| Plugin state | Skill state | Result                                                                 |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| Enabled      | Enabled     | The skill is copied out and available                                  |
| Enabled      | Disabled    | The skill is skipped; the rest of the plugin still works               |
| Disabled     | Enabled     | Nothing is copied out — plugin enablement is the outer gate            |
| Disabled     | Disabled    | Nothing is copied out; the toggle is remembered for when you re-enable |

Unchecking a whole plugin does **not** clear the per-skill toggles you set inside it. They stay in `disabledSkillIds` and take effect again the moment you re-enable the plugin.

There is one cleanup rule worth knowing: on save, Ptah validates your disabled-skill list against the skills it can actually find — those in the enabled plugins plus every harness-authored plugin. A name that matches nothing is dropped from the record. So if you disable a skill and then permanently remove the plugin that supplied it, the orphaned entry quietly disappears rather than lingering forever.

## Reading the counter

The modal footer shows both dimensions at once:

```text
4 of 6 selected · 2 skills disabled
```

The second half only appears when at least one skill is switched off — a quick way to notice a toggle you set months ago and forgot about.

## Next steps

- [Enable and disable plugins](/plugins/installing/)
- [Change your selection later](/plugins/managing/)
- [Skills you authored yourself](/plugins/harness-plugins/)
