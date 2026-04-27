---
title: Plugins
description: Extend Ptah with curated plugins — agents, skills, templates, and slash commands bundled together.
---

Plugins are the primary extension mechanism for Ptah. Each plugin bundles a coordinated set of **agents**, **skills**, **templates**, and **slash commands** that target a specific stack, workflow, or domain — Angular frontend patterns, Nx SaaS scaffolding, React composition, core orchestration, and more.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/plugins.mp4" type="video/mp4" />
</video>

## Why plugins?

Out of the box Ptah ships with a lean set of defaults. Plugins let you opt into richer, opinionated capabilities without inflating the base install:

- **Curated quality** — every official plugin is reviewed and versioned by the Ptah team.
- **Per-workspace activation** — enable only what a given project needs.
- **Live updates** — plugin content is fetched from GitHub, so fixes reach you without a Ptah release.
- **Composable** — plugins can contribute skills, agents, prompts, and templates independently.

## How plugins reach your machine

Plugins are **not bundled in the Ptah installer**. On first launch (and on demand thereafter), Ptah's `ContentDownloadService` reads the public [`content-manifest.json`](https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main/content-manifest.json) and downloads the requested plugin tree into `~/.ptah/plugins/`.

```text
~/.ptah/
├── plugins/
│   ├── ptah-core/
│   ├── ptah-angular/
│   ├── ptah-react/
│   └── ptah-nx-saas/
└── templates/
```

:::tip
This design keeps the desktop installer small and lets the team ship plugin fixes without cutting a new Ptah build.
:::

## Official plugins

| Plugin         | Focus                  | Highlights                                                             |
| -------------- | ---------------------- | ---------------------------------------------------------------------- |
| `ptah-core`    | Workflow orchestration | `/orchestrate`, DDD architecture, content writing, UI/UX design skills |
| `ptah-angular` | Angular frontend       | Signal patterns, GSAP scroll animations, 3D scene crafting             |
| `ptah-react`   | React frontend         | Component patterns, hooks, state management                            |
| `ptah-nx-saas` | Nx monorepo SaaS       | Scaffolds, generators, domain boundaries                               |

## Next steps

- [Browse the marketplace](/plugins/marketplace/)
- [Install and enable plugins](/plugins/installing/)
- [Update or uninstall plugins](/plugins/managing/)
- [Understand plugin storage](/plugins/plugin-storage/)
- [Create your own plugin](/plugins/creating-plugins/)
