---
title: Plugins
description: Extend Ptah with curated plugins — skill packs and slash commands bundled together, enabled per workspace.
---

Plugins are the primary extension mechanism for Ptah. Each plugin bundles a coordinated set of **skills** and **slash commands** that target a specific stack, workflow, or domain — core orchestration, Nx SaaS backends, Angular patterns, React composition, marketing video.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/plugins.mp4" type="video/mp4" />
</video>

## Why plugins?

Out of the box Ptah ships with a lean set of defaults. Plugins let you opt into richer, opinionated capabilities without inflating the base install:

- **Curated quality** — every official plugin carries a version in its `.claude-plugin/plugin.json` and is maintained by the Ptah team.
- **Per-workspace activation** — enable only what a given project needs.
- **Live updates** — plugin content is fetched from GitHub, so fixes reach you without a Ptah release.
- **Granular** — you can enable a whole plugin and still switch off individual skills inside it.

## How plugins reach your machine

Plugins are **not bundled in the Ptah installer**. On first launch (and on demand thereafter), Ptah's `ContentDownloadService` reads the public [`content-manifest.json`](https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main/content-manifest.json) and downloads the plugin tree into `~/.ptah/plugins/`.

```text
~/.ptah/
├── plugins/
│   ├── ptah-core/
│   ├── ptah-nx-saas/
│   ├── ptah-angular/
│   ├── ptah-react/
│   └── ptah-video/
└── templates/
    └── agents/
```

:::tip
This design keeps the desktop installer small and lets the team ship plugin fixes without cutting a new Ptah build.
:::

## Official plugins

Five plugins ship with Ptah. Each one lands in the browser modal under the category shown here.

| Plugin         | Category       | What's inside                                                                                                                                                   |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ptah-core`    | Core Tools     | 8 skills — orchestration, DDD architecture, humanize-library, skill-creator, technical-content-writer, tribunal, UI/UX design, Ptah CLI usage — plus 5 commands |
| `ptah-nx-saas` | Backend Tools  | 7 skills — Nx workspace, NestJS patterns, webhooks, resilience, SaaS platform, deployment, SaaS init — plus `/init-saas` and `/initialize-workspace`            |
| `ptah-angular` | Frontend Tools | 3 skills — Angular patterns, GSAP scroll animation, 3D scene crafting                                                                                           |
| `ptah-react`   | Frontend Tools | 3 skills — React best practices, composition patterns, React + Nx                                                                                               |
| `ptah-video`   | Creative Tools | 1 skill — `video-showcase`, the Playwright-capture → Remotion-render marketing video pipeline                                                                   |

A sixth category, **Your Skills**, appears once you author your own skill — see [Harness plugins](/plugins/harness-plugins/).

## Next steps

- [Browse the catalog](/plugins/marketplace/)
- [Enable and disable plugins](/plugins/installing/)
- [Change your selection later](/plugins/managing/)
- [Turn off individual skills](/plugins/skill-toggles/)
- [Skills you authored yourself](/plugins/harness-plugins/)
- [Understand plugin storage](/plugins/plugin-storage/)
- [Create your own plugin](/plugins/creating-plugins/)
