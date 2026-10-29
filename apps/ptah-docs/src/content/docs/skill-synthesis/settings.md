---
title: Skills Library Settings
description: Skills and telemetry switches, and manual enhancement settings.
---

# Skills Library Settings

Open **Thoth → Skills** in Ptah desktop for the Skills and Skill telemetry switches. Enhancement provider, model, and timeout are in **Settings → Providers → Background Model Roles**. These settings are stored in `~/.ptah/settings.json`.

| Key                            | What it does                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `skillSynthesis.enabled`       | The Skills switch. Turn it off to pause Library actions such as **Enhance now**.               |
| `skills.telemetry.enabled`     | The Skill telemetry switch. It defaults to on and can record skill use while Skills is paused. |
| `skills.enhancement.provider`  | Provider for manual enhancement. An empty value follows the main provider.                     |
| `skills.enhancement.model`     | Model for manual enhancement. `inherit` uses the provider's selected model.                    |
| `skills.enhancement.timeoutMs` | Time limit for a manual enhancement request, in milliseconds.                                  |

See [The Skills Tab](/skill-synthesis/the-skills-tab/) for Library actions.
