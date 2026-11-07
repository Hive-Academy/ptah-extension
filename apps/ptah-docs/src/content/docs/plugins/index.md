---
title: Plugins
description: Add skill packs and slash commands to PtahCode, enabled for each project.
---

A plugin is a set of **skills** and **slash commands** for a stack, a workflow, or a domain. You enable plugins for each project.

<video controls preload="metadata" playsinline style="width:100%;border-radius:0.5rem;border:1px solid var(--sl-color-gray-5);margin:1rem 0;">
  <source src="/assets/videos/plugins.mp4" type="video/mp4" />
</video>

## Kinds of plugin

| Kind      | Where it comes from                                                         | Active by default |
| --------- | --------------------------------------------------------------------------- | ----------------- |
| Official  | The Ptah plugin packs, downloaded from GitHub                               | No (opt-in)       |
| Harness   | Skills that you write with the harness (`ptah-harness-*`)                   | Yes (opt-out)     |
| skills.sh | Skills that you install from **Marketplace → Community**                    | Yes (opt-out)     |
| External  | Plugins from a GitHub plugin marketplace, after you approve the install     | No (opt-in)       |

## How official plugins reach your computer

The installer does not include the plugins. PtahCode reads [`content-manifest.json`](https://raw.githubusercontent.com/Hive-Academy/PtahCode/main/content-manifest.json) and downloads the plugin files into `~/.ptah/plugins/`. See [Plugin storage](/plugins/plugin-storage/).

## Official plugins

| Plugin         | Category       | Contents                                                                                     |
| -------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `ptah-core`    | Core Tools     | Orchestration, agent lanes, tribunal, design, content, and review skills, plus 5 commands    |
| `ptah-nx-saas` | Backend Tools  | Nx, NestJS, webhook, resilience, SaaS, and deployment skills, plus `/init-saas` and `/initialize-workspace` |
| `ptah-dotnet`  | Backend Tools  | .NET solution architecture, solution setup, and Nx .NET workspace skills                     |
| `ptah-angular` | Frontend Tools | Angular patterns, GSAP scroll animation, and 3D scene skills                                 |
| `ptah-react`   | Frontend Tools | React best practices, composition patterns, and React in Nx                                  |

For the full skill list, see [Shipped skills](/mcp-and-skills/popular-skills/).

## Next steps

- [Browse the catalog](/plugins/marketplace/)
- [Enable and disable plugins](/plugins/installing/)
- [Turn off individual skills](/plugins/skill-toggles/)
- [Choose which skills a project gets](/plugins/skill-selection/)
- [Skills that you wrote](/plugins/harness-plugins/)
- [Plugin storage](/plugins/plugin-storage/)
- [Create your own plugin](/plugins/creating-plugins/)
