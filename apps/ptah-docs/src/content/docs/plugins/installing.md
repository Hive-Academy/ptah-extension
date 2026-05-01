---
title: Installing Plugins
description: Enable and disable plugins per workspace and understand how configuration persists.
---

Ptah plugins are **enabled per workspace**. A plugin that's active in your Angular app won't clutter a Python service next door — and each workspace carries its own list of enabled plugins.

## Enabling a plugin

1. Open the **Plugins** panel.
2. Select a plugin from the marketplace.
3. Click **Enable for this workspace**.

Ptah will:

1. Download the plugin into `~/.ptah/plugins/<plugin-name>/` (if not already cached).
2. Register its agents, skills, templates, and commands with the current workspace session.
3. Create skill junctions (symlinks) under `<workspace>/.claude/skills/` so third-party AI clients can discover them too.

![Enable plugin toggle](/screenshots/plugin-enable-toggle.png)

:::tip
Enabling a plugin does **not** restart Ptah. Contributions become available immediately in the next chat turn.
:::

## Disabling a plugin

Disabling keeps the plugin on disk but removes its contributions from the current workspace:

1. Open **Plugins → Installed**.
2. Toggle the plugin **off**.

Skill junctions under `.claude/skills/` are removed, and the orchestrator stops listing the plugin's agents and commands.

## Where the configuration lives

Per-workspace enabled-plugin state is persisted to:

```text
<workspace>/.ptah/workspace-settings.json
```

Example:

```json
{
  "enabledPlugins": ["ptah-core", "ptah-angular"]
}
```

Global plugin cache (the downloaded files themselves) lives in:

```text
~/.ptah/plugins/
```

:::note
Commit `.ptah/workspace-settings.json` to version control if you want teammates to share the same active plugin set. Do **not** commit `~/.ptah/plugins/` — it's a reproducible cache.
:::

## Conflicts between plugins

If two plugins contribute skills or commands with the same name, Ptah resolves them in this order:

1. Workspace-local `.claude/skills/` (author overrides win)
2. Plugin load order (alphabetical by plugin name)

Ptah will surface a warning in the **Problems** panel when a conflict is detected.

## Next steps

- [Manage updates and uninstalls](/plugins/managing/)
- [Plugin storage internals](/plugins/plugin-storage/)
