---
title: Theme
description: Switch between light and dark appearance.
---

Ptah ships with a light and dark theme. The choice is stored globally in `~/.ptah/settings.json` and applies to every workspace.

## Changing the theme

- **Settings → Appearance → Theme**, or
- Edit `~/.ptah/settings.json`:

```json
{ "theme": "dark" }
```

| Value    | Behavior                                                            |
| -------- | ------------------------------------------------------------------- |
| `light`  | Always use the light theme                                          |
| `dark`   | Always use the dark theme                                           |
| `system` | Follow the OS appearance preference and update live when it changes |

![Theme toggle](/screenshots/theme-toggle.png)

## High-contrast mode

High-contrast variants of both themes are derived automatically when your OS reports a high-contrast preference. No additional setting is required.

## Accent color

The brand accent is fixed in the current release. Custom accent colors are on the roadmap.
