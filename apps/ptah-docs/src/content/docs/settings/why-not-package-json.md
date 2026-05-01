---
title: Why not package.json?
description: Why provider settings live in ~/.ptah/settings.json and not in your project's package.json.
---

import { Aside } from '@astrojs/starlight/components';

Some editor integrations store provider configuration alongside project metadata — for example, in `package.json` or an editor-specific config section. Ptah deliberately does **not** do this. Provider settings live in `~/.ptah/settings.json` for three reasons.

## 1. Security

API keys are secrets. Storing them in `package.json` means they end up in:

- Your team's Git history the first time someone commits
- Any CI job that prints the file
- Every fork and clone of the project

Keeping keys in `~/.ptah/settings.json` — encrypted by the OS keychain — keeps them on the machine that owns them and off every other surface.

## 2. Portability

A `package.json` belongs to a project. A provider preference belongs to **you**. Moving provider config into your user folder means:

- You can switch projects without re-entering keys
- Cloning a new repo works immediately
- Team members can use different providers in the same repo without stepping on each other

## 3. Marketplace and ecosystem hygiene

Provider configuration that mentions trademarked AI product names in a shared project file causes friction with several distribution channels — app scanners, code-review bots, and license tools. Keeping that configuration in a user-scoped, file-based location avoids the problem entirely.

<Aside type="tip">
If a project truly needs a provider-specific override — for example, "always use deep effort for release-notes tasks" — put it in `.claude/settings.json` as a per-workspace override. That file can be committed safely because it references settings, not secrets.
</Aside>

## Migrating from older setups

If you've been carrying provider config in `package.json` from a previous tool, copy the values into **Settings → Providers** once and delete them from `package.json`. Ptah will never read provider keys from `package.json`, now or in the future.
