---
title: Harness Plugins
description: Skills you authored yourself appear in the plugin browser as their own plugins — and they follow the opposite activation rule.
---

When you create a skill through the harness — the [AI Team Builder](/setup/ai-team-builder/) wizard, or the `ptah_harness_create_skill` tool from inside a chat — Ptah does not drop it loose into a folder. It writes a small, complete plugin:

```text
~/.ptah/plugins/ptah-harness-<slug>/
└── skills/
    └── <slug>/
        └── SKILL.md
```

The slug is your skill's name, lowercased and kebab-cased. That directory is a first-class plugin, and it shows up in the plugin browser next to the ones Ptah ships.

## Finding them in the browser

Open **Marketplace → Plugins → Configure**. Every `ptah-harness-*` directory on disk appears under the **Your Skills** category, at the bottom of the list, each row carrying a **Yours** badge.

Everything on the row is derived from the directory itself, live, with nothing cached:

- The **name** comes from the slug — `ptah-harness-release-notes` renders as _Release Notes_.
- The **description** comes from the frontmatter of the skill named after the slug, falling back to a generic line if the frontmatter can't be read.
- The **skill count** is a real count of the `skills/` tree, so a plugin gains skills as you add them.

Because nothing is persisted, a skill you create mid-session appears the next time you open the modal. There is no refresh to press.

## They are opt-out, not opt-in

This is the one rule that makes harness plugins behave differently from everything else in the modal.

| Plugin kind                | Rule                                                 |
| -------------------------- | ---------------------------------------------------- |
| Bundled (`ptah-core`, …)   | **Opt-in.** Inactive until you tick it and save.     |
| Harness (`ptah-harness-*`) | **Opt-out.** Active the moment the directory exists. |

You already said yes to a harness skill — you clicked Apply in the wizard, or asked an agent to write it. Making you go back and tick a second box to activate what you just created would be a strange thing to ask, so Ptah doesn't. A harness plugin is live on discovery and stays live until you explicitly untick it.

Unticking one records its ID in `disabledPluginIds` — a denylist, the mirror image of the allowlist used for bundled plugins. That's the only way to express "the user turned this off" for something that is on by default.

Two consequences follow:

- The status widget's "_n_ enabled" count is not simply the length of your enabled list. A harness skill is counted as enabled without ever appearing there.
- Configurations saved before harness toggling existed have no denylist at all. They load as "nothing explicitly disabled", which is exactly the behaviour they already had. Nothing needed migrating.

## Why a checked harness plugin stays out of the enabled list

Tick a harness plugin and save, and it is deliberately **not** added to `enabledPluginIds`. Absence from the denylist is the entire "enabled" signal.

This looks like an omission and isn't. `enabledPluginIds` drives a user-layer mirror — a copy of the enabled plugins' skills used as the base source when junctions are built, and mirrored entries win on collision. Mirroring a harness plugin would therefore freeze its skills at the moment of the mirror: you'd edit `SKILL.md` through the wizard afterwards, and the stale mirrored copy would keep winning. Your edits would silently stop taking effect.

Keeping harness plugins out of the mirror keeps the live directory authoritative. The junction pass overlays them additively, so their skills are still junctioned into `<workspace>/.claude/skills/` — they just come from the real directory rather than a snapshot of it.

## Per-skill toggles work here too

A harness plugin with several skills expands like any other, and its individual skills can be switched off. Ptah validates those toggles against the enabled bundled plugins **plus every harness directory**, precisely because harness plugins never appear in the enabled list — without that, disabling a harness skill would be discarded as an unknown ID. See [Skill toggles](/plugins/skill-toggles/).

## Your files are not pruned

Harness plugins live under `~/.ptah/plugins/`, the same directory Ptah's content download manages. When the manifest hash changes, Ptah sweeps files the manifest no longer lists — but only inside the directories the manifest itself populates, which means the five bundled plugins. A `ptah-harness-*` directory is never named in the manifest, so nothing in it is touched.

:::note
This was not always true. Earlier builds pruned the whole of `~/.ptah/plugins/` against the manifest, which deleted harness-authored skills on the next content refresh. Copying an irreplaceable `SKILL.md` somewhere durable — your workspace's `.claude/skills/`, or a repository of your own — is still a reasonable habit, but it is no longer a workaround for data loss.
:::

## Related

- [Skill toggles](/plugins/skill-toggles/) — switching off individual skills
- [AI Team Builder](/setup/ai-team-builder/) — the wizard that authors these plugins
- [Creating skills](/mcp-and-skills/creating-skills/) — writing a `SKILL.md` by hand
- [Skill Synthesis](/skill-synthesis/) — skills Ptah writes for you from your own sessions, stored separately under `~/.ptah/skills/`
