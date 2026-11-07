---
title: Installing Plugins
description: Enable and disable plugins for a project, and where PtahCode stores that choice.
---

You enable Ptah plugins for each project. A plugin that is active in your Angular app does not reach a Python service in another folder.

## Enable a plugin

1. Open **Marketplace → Sources → Ptah Plugins**.
2. Select the plugins that you want.
3. Click **Save Configuration**.

PtahCode then:

1. Saves the selection for the project.
2. Updates the slash commands so that the commands of the plugin show in `/` autocomplete.
3. Copies the plugin skills into the skill folder of each detected AI tool, for example `.claude/skills/`. It copies command files into `.claude/commands/`.

You do not have to restart PtahCode.

:::note
Enabling a plugin does not download it. Plugin content comes from the content download. See [Plugin storage](/plugins/plugin-storage/).
:::

## Disable a plugin

1. Clear the plugin in the panel.
2. Click **Save Configuration**.

PtahCode removes the copies of its skills. The downloaded files stay in `~/.ptah/plugins/`, because other projects can still use the plugin.

## Where the configuration is stored

The plugin selection is not a file in your repository. PtahCode keeps one record for each project root in its global state, under the key `ptah.plugins.harnessConfig:<root>`. The record holds these lists:

| Field               | Meaning                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `enabledPluginIds`  | Official and external plugins that you turned **on**                          |
| `disabledPluginIds` | Harness and skills.sh plugins that you turned **off**                         |
| `disabledSkillIds`  | Skills that you turned off. See [Skill toggles](/plugins/skill-toggles/)      |
| `enabledSkillIds`   | The skills that you picked for this project. See [Skill selection](/plugins/skill-selection/) |
| `disabledAgentIds`  | Agents that you turned off                                                    |

Older versions stored the selection for each opened folder under `ptah.plugins.config`. PtahCode reads those records to import a first configuration.

Teammates who clone the repository start with an empty selection.

## When two plugins have the same skill

Skill folder names are one flat namespace. When two sources supply the same skill name, the first one wins. PtahCode does not rename skills. It reports the collision. Give your own skills distinctive names.

## Next steps

- [Turn off individual skills](/plugins/skill-toggles/)
- [Plugin storage](/plugins/plugin-storage/)
