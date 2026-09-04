---
title: Plugin Catalog
description: Browse the bundled Ptah plugins from the Configure Ptah Skills modal and see what each one contributes.
---

The plugin catalog is not a separate storefront — it is a modal titled **Configure Ptah Skills**, reached from the Plugins provider in the Marketplace. Everything you can browse, search, enable, or disable happens in that one dialog.

## Opening the catalog

1. Click **Marketplace** in the navigation rail.
2. Select the **Plugins** provider. Its surface is titled **Ptah Skills**.
3. Click **Configure** on the status widget.

The modal fetches the available plugins and your saved configuration together. While that is in flight you see a spinner; if either call fails you get an error message and a **Try Again** button rather than a half-populated list.

## Categories

Plugins are grouped into five categories, always rendered in this order. A category with no matching plugins is hidden entirely, which is why you will not see **Your Skills** until you have authored one.

| Category           | Contains                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core Tools**     | `ptah-core` — orchestration, review, refactoring, docs, design                                                                              |
| **Backend Tools**  | `ptah-nx-saas` — Nx, NestJS, webhooks, resilience, SaaS platform, deployment, and `ptah-dotnet` — .NET solution layout and domain modelling |
| **Frontend Tools** | `ptah-angular` and `ptah-react`                                                                                                             |
| **Creative Tools** | `ptah-video` — the marketing-video pipeline                                                                                                 |
| **Your Skills**    | Every `ptah-harness-*` plugin you authored — see [Harness plugins](/plugins/harness-plugins/)                                               |

## Search

The search box filters the list as you type. A plugin matches if your query appears, case-insensitively, in any of three fields:

- the plugin **name**,
- the plugin **description**, or
- one of its **keywords** — so searching `prisma`, `gsap`, `remotion`, or `solid` finds the right pack even though none of those words is in a plugin's name.

Search does **not** look inside individual skill names or `SKILL.md` bodies. If nothing matches you get "No plugins match your search." The query resets each time the modal closes.

## What a plugin row shows

Each row carries the plugin name and description plus a few badges:

- **Recommended** (star) — the plugin is flagged as a sensible default. Only `ptah-core` carries it.
- **Yours** (wand) — the plugin was authored by you through the harness, not shipped by Ptah.
- **_n_ skills** and **_n_ commands** — the contribution counts.

The skill count is read from disk once the plugin has been downloaded, so it stays honest as plugins gain skills. Before the first download it falls back to the catalog's built-in number.

There is no detail pane, no README view, and no hover preview of a skill body. To read what a skill actually contains, open its `SKILL.md` under `~/.ptah/plugins/<plugin>/skills/<skill>/`.

## What's inside a plugin

A plugin is a folder with a manifest and up to two contribution directories. Those are the two Ptah actually consumes.

| Contribution | Location in plugin       | Purpose                                                                     |
| ------------ | ------------------------ | --------------------------------------------------------------------------- |
| **Skills**   | `skills/<name>/SKILL.md` | Scoped knowledge packs invoked on demand (e.g. `angular-frontend-patterns`) |
| **Commands** | `commands/*.md`          | Slash commands registered in chat (e.g. `/orchestrate`)                     |

The manifest at `.claude-plugin/plugin.json` carries the name, description, version, author, and license. It is metadata only — the modal does not display it.

### Example: `ptah-core`

```text
ptah-core/
├── .claude-plugin/
│   └── plugin.json        # name, description, version, author, license
├── commands/
│   ├── orchestrate.md
│   ├── orchestrate-help.md
│   ├── review-code.md
│   ├── review-logic.md
│   └── review-security.md
└── skills/
    ├── ddd-architecture/
    ├── humanize-library/
    ├── orchestration/
    ├── ptah-cli-usage/
    ├── skill-creator/
    ├── technical-content-writer/
    ├── tribunal/
    └── ui-ux-designer/
```

That is eight skills and five slash commands — the counts you see on the `ptah-core` row.

## Offline behaviour

The catalog itself is local: the plugin list is metadata Ptah already holds, so the modal opens and works with no network. What needs the network is the content download. If GitHub is unreachable, whatever is already in `~/.ptah/plugins/` keeps working and the download simply reports a failure. See [Plugin storage](/plugins/plugin-storage/).

## Next steps

- [Enable and disable plugins](/plugins/installing/)
- [Turn off individual skills](/plugins/skill-toggles/)
- [Create your own plugin](/plugins/creating-plugins/)
