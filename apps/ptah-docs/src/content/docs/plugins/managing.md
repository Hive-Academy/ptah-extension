---
title: Managing Plugins
description: Update, refresh, and uninstall plugins from your Ptah installation.
---

Plugins evolve independently of the Ptah desktop app. The **Installed** tab of the Plugins panel gives you full control over what's cached on disk and which version is active.

## Updating a plugin

Ptah checks `content-manifest.json` on every app launch and surfaces updates in the Plugins panel.

1. Open **Plugins → Installed**.
2. Plugins with available updates show an **Update** badge.
3. Click **Update** to download the new version.

:::tip
Ptah compares the manifest's `contentHash` against your local cache, so you only re-download files that actually changed.
:::

### Auto-update

Enable automatic background updates in **Settings → Plugins**:

```json
{
  "plugins.autoUpdate": true,
  "plugins.checkInterval": "24h"
}
```

## Refreshing the marketplace

If the marketplace list looks stale (new plugin just released, or you know the manifest changed), trigger a manual refresh:

- **Plugins panel → ⟳ Refresh**, or
- Command palette → **Ptah: Refresh Plugin Marketplace**

This re-fetches the manifest from GitHub and re-indexes local plugins.

## Uninstalling a plugin

Uninstall removes the plugin from disk entirely:

1. Open **Plugins → Installed**.
2. Click the **⋯** menu on the plugin row.
3. Select **Uninstall**.

Ptah deletes:

- `~/.ptah/plugins/<plugin-name>/`
- Any skill junctions under every workspace's `.claude/skills/`
- The plugin entry from workspace-settings files on next load

:::caution
Uninstall is workspace-wide in scope — it removes the plugin everywhere, not just from the current workspace. Use **Disable** if you only want to turn it off for one project.
:::

## Rolling back to a previous version

Ptah keeps the last two versions of each plugin under `~/.ptah/plugins/<plugin-name>/.versions/`. To roll back:

1. Open the plugin detail view.
2. Click **Version history**.
3. Select a previous version and click **Use this version**.

## Clearing the plugin cache

If the plugin cache becomes corrupted (rare), clear it from the command palette:

- **Ptah: Clear Plugin Cache** — deletes `~/.ptah/plugins/` and re-downloads enabled plugins on next launch.

## Next steps

- [How plugin storage works](/plugins/plugin-storage/)
- [Create your own plugin](/plugins/creating-plugins/)
