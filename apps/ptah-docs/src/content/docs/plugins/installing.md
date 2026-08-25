---
title: Installing Plugins
description: Enable and disable plugins per workspace and understand where that choice is stored.
---

Ptah plugins are **enabled per workspace**. A plugin that's active in your Angular app won't clutter a Python service next door — each workspace carries its own selection.

## Enabling a plugin

1. Open **Marketplace → Plugins** and click **Configure**.
2. Tick the checkbox on the plugins you want. Clicking anywhere on the row toggles it.
3. Click **Save Configuration**.

Ptah then:

1. Persists the selection for the current workspace.
2. Resolves each enabled plugin ID to its directory under `~/.ptah/plugins/` — unknown IDs and missing directories are dropped, not guessed at.
3. Invalidates the slash-command cache so the plugin's commands appear in `/` autocomplete.
4. Creates skill junctions under `<workspace>/.claude/skills/` and copies command files into `<workspace>/.claude/commands/`, so third-party AI clients discover them too.

:::tip
Enabling a plugin does **not** restart Ptah. Junctions are rebuilt during the save, so contributions are available on the next chat turn.
:::

:::note
Enabling a plugin does not download it. Plugin content arrives from GitHub on Ptah's own content check — see [Plugin storage](/plugins/plugin-storage/). If a plugin's directory isn't on disk yet, its ID is skipped when junctions are built and picked up once the download lands.
:::

## Disabling a plugin

Reopen the same modal, untick the plugin, and save. The junctions for its skills are removed and the orchestrator stops offering its commands. The downloaded files stay in `~/.ptah/plugins/` — see [Managing plugins](/plugins/managing/).

## Where the configuration lives

Your enabled-plugin selection is **not a file in your repository**. It is stored in the host's per-workspace state store — VS Code's `workspaceState` Memento, and the equivalent store in the desktop app — under the key:

```text
ptah.plugins.config
```

The persisted record holds three lists plus a timestamp:

| Field               | Meaning                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `enabledPluginIds`  | Bundled plugins you explicitly turned **on** (opt-in)                             |
| `disabledPluginIds` | Harness plugins you explicitly turned **off** (opt-out)                           |
| `disabledSkillIds`  | Individual skills you switched off — see [Skill toggles](/plugins/skill-toggles/) |
| `lastUpdated`       | ISO timestamp of the last save                                                    |

Because this lives in host state and not in your working tree, there is nothing to commit and nothing to gitignore. Teammates who clone the repository start with an empty selection and pick their own plugins. If you want a shared baseline for a project, put it in the project's onboarding notes — Ptah has no mechanism today for sharing a plugin selection through version control.

The downloaded plugin files themselves are global, not per workspace:

```text
~/.ptah/plugins/
```

## When two plugins define the same skill

Skill directory names form a single flat namespace under `.claude/skills/`. If two enabled plugins both ship a `skills/orchestration/`, Ptah resolves it like this:

1. The **first plugin path that supplies the name wins**. Enabled bundled plugins are walked first, in the order held in your saved selection, then your harness-authored plugins.
2. Later plugins offering the same name are **skipped**, and the collision is written to the Ptah logs as a warning.
3. If `.claude/skills/<name>` is already a **real directory** — something you or another tool created — Ptah leaves it alone and does not overwrite it. Your own file wins over any plugin.

There is no conflict UI. Nothing is surfaced in the app when a collision happens, so the logs are the only place it shows up. Give your own skills distinctive directory names and this stays theoretical.

## Next steps

- [Change your selection later](/plugins/managing/)
- [Turn off individual skills](/plugins/skill-toggles/)
- [Plugin storage internals](/plugins/plugin-storage/)
