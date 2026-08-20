---
title: Managing Plugins
description: Change your plugin selection after the fact, refresh the downloaded content, and understand what the cache does.
---

There is no separate "installed plugins" screen in Ptah. The modal you used to turn plugins on is the same one you use to turn them off, reorder your mind, or switch off a single skill. Managing plugins means reopening **Configure Ptah Skills**.

## Reopening the configuration modal

1. Click **Marketplace** in the navigation rail.
2. Select the **Plugins** provider.
3. The **Ptah Skills** panel shows a compact status line — `3/6 enabled`, or **Not configured** if you have never saved a selection.
4. Click **Configure**.

The modal loads the current catalog and your saved configuration every time it opens, so it always reflects what is actually on disk right now.

## What the modal gives you

| Control                | What it does                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Search box             | Filters the list by plugin name, description, or keywords                                    |
| Category groups        | Core Tools, Backend Tools, Frontend Tools, Creative Tools, Your Skills — in that fixed order |
| Plugin checkbox        | Enables or disables the whole plugin for this workspace                                      |
| Chevron (enabled only) | Expands the plugin's skill list so you can disable individual skills                         |
| **Cancel**             | Closes without writing anything                                                              |
| **Save Configuration** | Persists the selection and rebuilds skill junctions immediately                              |

The footer counts what you have selected — `4 of 6 selected · 2 skills disabled` — so you can see the shape of your configuration without scrolling.

## Turning a plugin off

Unchecking is the whole uninstall story:

1. Reopen the modal.
2. Uncheck the plugin.
3. Click **Save Configuration**.

Ptah persists the new selection, invalidates the slash-command cache, and rebuilds the junctions under `<workspace>/.claude/skills/`. Junctions for skills that are no longer supplied by an enabled plugin are removed in the same pass, so the plugin's skills and commands stop being offered right away. No restart, no reload.

The plugin's files **stay in `~/.ptah/plugins/`**. Nothing in the modal deletes a downloaded plugin from disk, and that is deliberate — the cache is shared by every workspace, and another project may still have the plugin enabled. Disabling is per workspace; the download is global.

## Refreshing downloaded content

Ptah fetches `content-manifest.json` from GitHub and compares its `contentHash` against `~/.ptah/.content-cache.json`. If the two match, nothing is downloaded. If they differ, **every file in the manifest is re-downloaded** and any local file no longer listed in the manifest is deleted.

:::caution[The cache is all-or-nothing]
There is exactly one hash, and it covers the whole manifest. Ptah cannot tell which individual file changed, so a one-character fix in one `SKILL.md` re-downloads the entire plugin and template tree. This is cheap — they are small markdown files — but it means "only changed files are downloaded" is not how it works.
:::

There is no per-plugin update button, no update badge, and no scheduled auto-update setting. Content is checked when Ptah asks for it, and the manifest hash decides.

## Recovering from a bad cache

If `~/.ptah/plugins/` ends up in a state you do not trust, delete the cache metadata file:

```text
~/.ptah/.content-cache.json
```

With no metadata to compare against, the next content check treats the manifest as new and re-downloads everything. Deleting `~/.ptah/plugins/` itself works too — the next download recreates it. Your enabled-plugin selection is not stored in either location, so it survives both.

## Next steps

- [Turn off individual skills](/plugins/skill-toggles/)
- [How plugin storage works](/plugins/plugin-storage/)
- [Skills you authored yourself](/plugins/harness-plugins/)
- [Create your own plugin](/plugins/creating-plugins/)
