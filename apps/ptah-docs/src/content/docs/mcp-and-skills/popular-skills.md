---
title: Shipped Skills
description: Every skill that ships with the official Ptah plugin packs.
---

This page lists the skills that ship with the official Ptah plugins. Enable the
parent plugin from the [plugin catalog](/plugins/marketplace/) and Ptah copies
its skills into your workspace automatically.

Ptah ships **six plugin packs** with **25 skills** between them.

:::note[These are Ptah's skills, not your AI tool's]
Your coding assistant may also expose skills of its own. This page covers only
what the Ptah plugin packs contribute.
:::

## `ptah-core` — core workflow

The recommended default pack. Eight skills and five slash commands.

| Skill                      | What it does                                                                                                                             | When it triggers                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `orchestration`            | Development-workflow orchestrator with 8 task types (FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, SAAS_INIT, CREATIVE) | Any implementation task. The default entry point.          |
| `tribunal`                 | Multi-vendor ensemble workflows — Council, Forge, Race, Relay, Crucible                                                                  | You want several AI vendors on one problem                 |
| `ddd-architecture`         | Domain-driven design guardrails for boundaries, aggregates, bounded contexts                                                             | Designing a new domain or restructuring libraries          |
| `humanize-library`         | Behavior-preserving refactor for readability, SOLID, and file size                                                                       | "Clean this up", "split large files", "remove duplication" |
| `ptah-cli-usage`           | How to drive the headless Ptah CLI for CI, scripts, and bridges                                                                          | Any headless or scripted Ptah usage                        |
| `skill-creator`            | Guide for authoring effective skills — structure, triggers, references                                                                   | Creating or updating a skill                               |
| `technical-content-writer` | Marketing pages, blog posts, technical docs, and video scripts                                                                           | Producing external-facing content                          |
| `ui-ux-designer`           | Visual design discovery, design systems, production-ready asset specs                                                                    | Landing pages, brand identity, visual specs                |

The pack also registers five slash commands: `/orchestrate`, `/orchestrate-help`,
`/review-code`, `/review-logic`, and `/review-security`. The three review
commands form a triple-review protocol — code quality, business logic, and
security.

## `ptah-nx-saas` — Nx and NestJS backends

| Skill                        | What it does                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `nx-workspace-architect`     | Nx monorepo layout, library boundaries, tagging, generators                      |
| `nestjs-backend-patterns`    | Multi-tenancy, Prisma or ZenStack, auth, provider patterns, access control       |
| `resilient-nestjs-patterns`  | Orchestrator decomposition, retry and fallback, events with SSE, dynamic modules |
| `nestjs-deployment`          | Docker multi-stage builds, migrations, health checks, production hardening       |
| `saas-platform-patterns`     | Tiering, licensing, subscription state machines, checkout flows                  |
| `saas-workspace-initializer` | Two-stage SaaS bootstrap — discovery, roadmap, then foundation scaffolding       |
| `webhook-architecture`       | Three-layer inbound webhook handling with signature checks and idempotency       |

## `ptah-angular` — Angular frontends

| Skill                            | What it does                                                   |
| -------------------------------- | -------------------------------------------------------------- |
| `angular-frontend-patterns`      | Signals, smart and dumb components, state, RxJS interop, forms |
| `angular-gsap-animation-crafter` | Scroll animations with GSAP and ScrollTrigger                  |
| `angular-3d-scene-crafter`       | Three.js scenes as declarative Angular components              |

## `ptah-react` — React frontends

| Skill                  | What it does                                           |
| ---------------------- | ------------------------------------------------------ |
| `react-best-practices` | Idiomatic React — hooks, rendering, effects, data flow |
| `react-nx-patterns`    | React inside an Nx monorepo                            |
| `composition-patterns` | Component composition over configuration               |

## `ptah-dotnet` — .NET solutions

| Skill                         | What it does                                         |
| ----------------------------- | ---------------------------------------------------- |
| `dotnet-solution-architect`   | Solution and project structure, layering, boundaries |
| `dotnet-solution-initializer` | Scaffolding a new .NET solution                      |
| `nx-dotnet-workspace`         | Running .NET projects inside an Nx workspace         |

## `ptah-video` — marketing video

| Skill            | What it does                                                                      |
| ---------------- | --------------------------------------------------------------------------------- |
| `video-showcase` | Narrated, captioned, camera-animated demo videos from an automated UI walkthrough |

## Next steps

- [Create your own skill](/mcp-and-skills/creating-skills/)
- [Enable and disable plugin packs](/plugins/installing/)
- [Turn off individual skills](/plugins/skill-toggles/)
- [How Ptah learns new skills from your work](/skill-synthesis/)
