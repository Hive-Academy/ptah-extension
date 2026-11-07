---
title: Plugin Catalog
description: Browse the Ptah plugins in the Configure Ptah Skills panel and see what each one contributes.
---

The plugin catalog is the **Configure Ptah Skills** panel. You browse, search, enable, and disable plugins in this panel.

## Open the catalog

Use one of these paths:

- Click **Marketplace** in the chat header, then **Sources → Ptah Plugins**.
- On the Dashboard (**Analytics** in the tab bar), open the skill selection card. It opens the same panel in a dialog.

If the catalog cannot load, the panel shows an error and a **Try Again** button.

## Categories

Plugins are grouped in this order. A category without plugins is not shown.

| Category              | Contains                                                                  |
| --------------------- | ------------------------------------------------------------------------- |
| **Core Tools**        | `ptah-core`                                                               |
| **Backend Tools**     | `ptah-nx-saas` and `ptah-dotnet`                                          |
| **Frontend Tools**    | `ptah-angular` and `ptah-react`                                           |
| **Creative Tools**    | Creative plugins, when the catalog has any                                |
| **Your Skills**       | Your `ptah-harness-*` plugins. See [Harness plugins](/plugins/harness-plugins/) |
| **From Marketplaces** | Plugins that you installed from external GitHub marketplaces              |

## Search

Type in **Search plugins...** to filter the list. If nothing matches, the panel shows "No plugins match your search."

## What a plugin card shows

- The plugin name and description.
- **Recommended** — the plugin is a good default.
- **Yours** — you wrote the plugin with the harness.
- The number of skills and commands.

## What is inside a plugin

| Contribution | Location in the plugin   | Purpose                                     |
| ------------ | ------------------------ | ------------------------------------------- |
| **Skills**   | `skills/<name>/SKILL.md` | Knowledge packs that the model uses on demand |
| **Commands** | `commands/*.md`          | Slash commands in chat, for example `/orchestrate` |

The file `.claude-plugin/plugin.json` holds the name, description, version, author, and license.

## Offline use

The catalog works without a network. The content download needs the network. When GitHub is not available, the plugins already in `~/.ptah/plugins/` continue to work.

## Next steps

- [Enable and disable plugins](/plugins/installing/)
- [Turn off individual skills](/plugins/skill-toggles/)
- [Create your own plugin](/plugins/creating-plugins/)
