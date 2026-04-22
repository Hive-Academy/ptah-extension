---
title: Popular Skills
description: Pre-curated catalog of high-signal skills shipped by the official Ptah plugins.
---

This page indexes the skills that ship with the official plugins. Enable the parent plugin from the [marketplace](/plugins/marketplace/) and all its skills are junctioned into your workspace automatically.

## Core workflow skills (`ptah-core`)

| Skill                      | What it does                                                                                                                                  | When it triggers                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `orchestration`            | Full development-workflow orchestrator with 8 task types (FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, SAAS_INIT, CREATIVE) | Any implementation task — default entry point for engineering work |
| `orchestrate-help`         | Quick reference for `/orchestrate` — task types, workflow modes, agent catalog                                                                | User asks how orchestration works                                  |
| `ddd-architecture`         | Domain-driven design guardrails for library boundaries, aggregates, and bounded contexts                                                      | Designing new domains or refactoring library structure             |
| `technical-content-writer` | Author marketing pages, blog posts, technical docs, and video scripts with codebase-verified claims                                           | Producing external-facing content                                  |
| `ui-ux-designer`           | Visual design discovery, design systems, production-ready asset specs                                                                         | Landing pages, brand identity, visual specs                        |
| `skill-creator`            | Guide for authoring effective skills (structure, triggers, references)                                                                        | Creating or updating a skill                                       |

## Review skills (triple-review protocol)

| Skill             | Phase                                                | Weight |
| ----------------- | ---------------------------------------------------- | ------ |
| `review-code`     | Code quality — adapts to the detected tech stack     | 40%    |
| `review-logic`    | Business logic — dummy data, placeholders, tech debt | 35%    |
| `review-security` | OWASP-based security assessment                      | 25%    |

Use them individually or chain them for a complete review.

## Harness & config skills

| Skill                      | What it does                                                                         | When it triggers                                         |
| -------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `update-config`            | Configure the Claude Code harness via `settings.json` — permissions, hooks, env vars | Anything touching `settings.json` or automated behaviors |
| `fewer-permission-prompts` | Scan transcripts and add a prioritized allowlist to reduce permission prompts        | User frustrated by repeated permission asks              |
| `keybindings-help`         | Customize keyboard shortcuts, add chord bindings                                     | Rebinding keys, modifying `~/.claude/keybindings.json`   |
| `loop`                     | Run a prompt or slash command on a recurring interval                                | Polling, recurring checks, continuous tasks              |
| `schedule`                 | Create/manage scheduled remote agents via cron                                       | Cron-scheduled automation                                |

## Angular skills (`ptah-angular`)

| Skill                            | What it does                                                                   | When it triggers                                        |
| -------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `angular-frontend-patterns`      | Modern Angular with signals: components, services, state, RxJS, forms, routing | Writing Angular components or services                  |
| `angular-gsap-animation-crafter` | Scroll-based animations with GSAP + ScrollTrigger in Angular                   | Designing scroll experiences, parallax, pinned sections |
| `angular-3d-scene-crafter`       | Three.js scenes integrated into Angular components                             | 3D hero sections, interactive WebGL backgrounds         |

## Claude API skill

| Skill        | What it does                                                                                          | When it triggers                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `claude-api` | Build, debug, and optimize Claude API apps; includes prompt caching; handles model-version migrations | Code imports `@anthropic-ai/sdk`; user works with the Claude API |

## React & Nx SaaS (planned)

The `ptah-react` and `ptah-nx-saas` plugins ship additional skills tailored to their stacks. Browse the [marketplace](/plugins/marketplace/) for the current list.

## `simplify`

A general-purpose refactor companion — reviews changed code for reuse, quality, and efficiency, then fixes any issues found. Pairs well with the three review skills as a post-edit cleanup pass.

## Next steps

- [Create your own skill](/mcp-and-skills/creating-skills/)
- [Browse plugins that bundle these skills](/plugins/marketplace/)
