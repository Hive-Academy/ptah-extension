# Inventory of authored agent assets

## Table 1 - Authored agents

| File                        | Name                     | Description                                                                                          | Lines |
| --------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- | ----- |
| backend-developer.md        | backend-developer        | Writes and changes server-side code in this repository — services, request and message handlers, dat | 264   |
| code-logic-reviewer.md      | code-logic-reviewer      | Reviews implemented work for behavioural correctness: silent failures, unhandled error paths, race c | 313   |
| code-style-reviewer.md      | code-style-reviewer      | Reviews implemented work for structure and consistency with this repository: layer and import bounda | 303   |
| devops-engineer.md          | devops-engineer          | Maintains this repository's build and delivery surface — its build, test, lint and packaging targets | 226   |
| frontend-developer.md       | frontend-developer       | Writes and changes user-interface code in this repository — components, templates, view state, styli | 280   |
| modernization-detector.md   | modernization-detector   | Scans an implemented codebase and the task folder's deliverables for modernization opportunities the | 189   |
| project-manager.md          | project-manager          | Turns a request into a scoped, testable task-description.md: what is in scope, what is explicitly ou | 275   |
| researcher-expert.md        | researcher-expert        | Answers a bounded technical question with cited evidence and writes research-report.md: the options, | 196   |
| senior-tester.md            | senior-tester            | Writes and runs the tests that prove a task's acceptance criteria hold, then records the evidence in | 295   |
| software-architect.md       | software-architect       | Designs the architecture for one task and writes implementation-plan.md: component boundaries, verif | 302   |
| team-leader.md              | team-leader              | Stress-tests an implementation plan, decomposes it into file-disjoint batches in batches.md with a r | 539   |
| technical-content-writer.md | technical-content-writer | Writes landing pages, blog posts, API and user documentation, video scripts and case studies whose e | 386   |
| ui-ux-designer.md           | ui-ux-designer           | Produces design systems, section-by-section visual specifications, asset briefs and developer handof | 181   |
| video-director.md           | video-director           | Marketing-video specialist for the showcase pipeline (Playwright capture, Remotion render). Authors  | 165   |
| visual-reviewer.md          | visual-reviewer          | Drives a real browser against a running build to find responsive breakage, contrast and focus failur | 335   |

## Table 2 - Authored skills

| Directory                                      | Name                                           | Description                                                                                           | Lines |
| ---------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----- | --- |
| agent-lanes                                    | agent-lanes                                    | Contract for spawning, resuming and messaging background CLI agent lanes via the ptah*agent*\* tools. | 142   |
| angular-3d-scene-crafter                       | angular-3d-scene-crafter                       | Designs Angular 3D scenes with @hive-academy/angular-3d (declarative Three.js components). Use for 3  | 658   |
| angular-frontend-patterns                      | angular-frontend-patterns                      | Angular component and state patterns built on signals. Use when building Angular components, smart/d  | 242   |
| angular-gsap-animation-crafter                 | angular-gsap-animation-crafter                 | Designs scroll-driven Angular animations with @hive-academy/angular-gsap (GSAP, ScrollTrigger). Use   | 574   |
| caveman                                        | caveman                                        | >                                                                                                     | 88    |
| ddd-architecture                               | ddd-architecture                               | Domain-Driven Design for complex business domains. Use when deciding whether DDD is warranted, defin  | 162   |
| extract-and-relocate-angular-component-feature | extract-and-relocate-angular-component-feature | Extract a UI feature (buttons, forms, state, methods) from one Angular component into a new self-con  | 41    |
| ffmpeg-video-analysis                          | ffmpeg-video-analysis                          |                                                                                                       |       | 412 |
| fleet-orchestration                            | fleet-orchestration                            | Operating rules for running a multi-agent fix fleet through plan, implement, adversarial judge, and   | 155   |
| humanize-library                               | humanize-library                               | Behavior-preserving refactor that makes an existing library, module or folder readable — small focus  | 135   |
| impeccable                                     | impeccable                                     | Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harde  | 169   |
| nestjs-backend-patterns                        | nestjs-backend-patterns                        | NestJS backend architecture for multi-tenant SaaS. Use for third-party API providers, Prisma or ZenS  | 185   |
| nestjs-deployment                              | nestjs-deployment                              | Productionizes NestJS apps for containers. Use for multi-stage Docker builds of NestJS or Nx apps, w  | 127   |
| nx-workspace-architect                         | nx-workspace-architect                         | Nx monorepo architecture for Angular and NestJS. Use when creating a workspace, organizing or naming  | 175   |
| orchestration                                  | orchestration                                  | Default workflow for any engineering task (feature, bugfix, refactor, docs, research, devops, SaaS i  | 101   |
| ptah-cli-usage                                 | ptah-cli-usage                                 | Drives the headless Ptah CLI (@hive-academy/ptah-cli, JSON-RPC over stdio) for CI pipelines, agent-t  | 240   |
| remocn                                         | remocn                                         | >                                                                                                     | 172   |
| resilient-nestjs-patterns                      | resilient-nestjs-patterns                      | NestJS service patterns for orchestration and resilience. Use when splitting a complex service, laye  | 232   |
| saas-platform-patterns                         | saas-platform-patterns                         | SaaS monetization patterns for NestJS. Use when designing free, trial and paid tiers, license keys,   | 249   |
| saas-workspace-initializer                     | saas-workspace-initializer                     | Bootstraps a new SaaS workspace on Nx, NestJS and Angular or React — discovery, a phased roadmap and  | 192   |
| simple-english                                 | simple-english                                 |                                                                                                       |       | 327 |
| skill-creator                                  | skill-creator                                  | Creates or updates agent skills — instructions, references, scripts and assets. Use when the user wa  | 358   |
| technical-content-writer                       | technical-content-writer                       | Writes marketing and technical content grounded in the codebase. Use for landing page copy, blog pos  | 309   |
| tribunal                                       | tribunal                                       | Multi-vendor peer panel (Council, Forge, Race, Crucible) across installed CLI vendors. Use for secon  | 87    |
| typesafe-ai                                    | typesafe-ai                                    |                                                                                                       | 150   |
| ui-ux-designer                                 | ui-ux-designer                                 | Turns design intent into a visual specification — brand discovery, design tokens, component and asse  | 216   |
| video-showcase                                 | video-showcase                                 | Records and renders narrated marketing videos from automated UI walkthroughs (Playwright capture, Re  | 73    |
| webhook-architecture                           | webhook-architecture                           | Three-layer NestJS design for inbound webhooks. Use when adding a webhook endpoint, verifying signat  | 259   |

## Table 3 - Usage, all time

| skill_slug               | n   | ok  | err | first_seen              | last_seen               |
| ------------------------ | --- | --- | --- | ----------------------- | ----------------------- |
| backend-developer        | 541 | 540 | 1   | 2026-06-28 16:18:17 UTC | 2026-09-17 15:36:17 UTC |
| frontend-developer       | 330 | 329 | 1   | 2026-06-28 16:19:58 UTC | 2026-09-17 15:28:01 UTC |
| team-leader              | 293 | 293 | 0   | 2026-07-03 23:01:47 UTC | 2026-09-17 14:34:31 UTC |
| code-logic-reviewer      | 265 | 265 | 0   | 2026-07-03 22:43:38 UTC | 2026-09-17 14:30:00 UTC |
| workflow-subagent        | 232 | 232 | 0   | 2026-07-14 00:02:43 UTC | 2026-09-09 23:42:01 UTC |
| Explore                  | 195 | 195 | 0   | 2026-06-28 18:21:57 UTC | 2026-09-14 12:57:50 UTC |
| senior-tester            | 167 | 167 | 0   | 2026-07-10 00:08:18 UTC | 2026-09-16 22:48:43 UTC |
| general-purpose          | 154 | 154 | 0   | 2026-07-03 17:18:15 UTC | 2026-09-18 19:29:43 UTC |
| unknown                  | 150 | 150 | 0   | 2026-06-29 18:09:56 UTC | 2026-09-18 05:18:10 UTC |
| code-style-reviewer      | 100 | 100 | 0   | 2026-07-03 22:40:03 UTC | 2026-09-17 11:19:56 UTC |
| software-architect       | 76  | 76  | 0   | 2026-06-30 13:46:04 UTC | 2026-09-18 19:36:17 UTC |
| orchestrate              | 66  | 66  | 0   | 2026-06-10 13:10:21 UTC | 2026-09-11 19:06:13 UTC |
| researcher-expert        | 52  | 52  | 0   | 2026-07-13 19:32:05 UTC | 2026-09-18 19:29:49 UTC |
| devops-engineer          | 36  | 36  | 0   | 2026-06-30 14:55:42 UTC | 2026-09-15 19:29:18 UTC |
| technical-content-writer | 31  | 31  | 0   | 2026-07-03 22:08:10 UTC | 2026-09-12 12:33:46 UTC |
| project-manager          | 19  | 19  | 0   | 2026-06-30 13:43:05 UTC | 2026-09-12 09:51:09 UTC |
| video-director           | 19  | 19  | 0   | 2026-07-07 00:21:00 UTC | 2026-08-01 19:44:01 UTC |
| visual-reviewer          | 15  | 15  | 0   | 2026-07-11 02:02:33 UTC | 2026-08-05 09:21:20 UTC |
| ui-ux-designer           | 11  | 11  | 0   | 2026-07-03 22:20:32 UTC | 2026-09-06 18:45:23 UTC |
| Plan                     | 9   | 9   | 0   | 2026-06-28 15:57:26 UTC | 2026-08-28 19:08:20 UTC |
| agent-lanes              | 9   | 9   | 0   | 2026-09-14 18:44:05 UTC | 2026-09-18 19:49:42 UTC |
| caveman                  | 4   | 4   | 0   | 2026-08-03 16:17:37 UTC | 2026-08-04 12:57:57 UTC |
| simple-english           | 4   | 4   | 0   | 2026-08-04 11:32:59 UTC | 2026-08-12 14:25:59 UTC |
| modernization-detector   | 3   | 3   | 0   | 2026-07-13 02:03:05 UTC | 2026-09-07 19:47:38 UTC |
| review                   | 3   | 3   | 0   | 2026-06-12 09:11:03 UTC | 2026-06-23 15:54:48 UTC |
| orchestration            | 2   | 2   | 0   | 2026-09-15 15:02:30 UTC | 2026-09-16 14:12:17 UTC |
| tribunal                 | 2   | 2   | 0   | 2026-09-08 18:32:22 UTC | 2026-09-14 13:37:35 UTC |
| code-review              | 1   | 1   | 0   | 2026-09-09 14:34:47 UTC | 2026-09-09 14:34:47 UTC |
| review-logic             | 1   | 1   | 0   | 2026-08-26 01:28:44 UTC | 2026-08-26 01:28:44 UTC |

## Table 4 - Usage by source

| source           | n    | distinct_slugs |
| ---------------- | ---- | -------------- |
| subagent         | 2698 | 20             |
| prompt-expansion | 92   | 9              |

## Table 5 - Cross-reference

### Assets on disk that appear in usage data

- backend-developer.md (backend-developer)
- code-logic-reviewer.md (code-logic-reviewer)
- code-style-reviewer.md (code-style-reviewer)
- devops-engineer.md (devops-engineer)
- frontend-developer.md (frontend-developer)
- modernization-detector.md (modernization-detector)
- project-manager.md (project-manager)
- researcher-expert.md (researcher-expert)
- senior-tester.md (senior-tester)
- software-architect.md (software-architect)
- team-leader.md (team-leader)
- technical-content-writer.md (technical-content-writer)
- ui-ux-designer.md (ui-ux-designer)
- video-director.md (video-director)
- visual-reviewer.md (visual-reviewer)
- agent-lanes/SKILL.md (agent-lanes)
- caveman/SKILL.md (caveman)
- orchestration/SKILL.md (orchestration)
- simple-english/SKILL.md (simple-english)
- technical-content-writer/SKILL.md (technical-content-writer)
- tribunal/SKILL.md (tribunal)
- ui-ux-designer/SKILL.md (ui-ux-designer)

### Assets on disk that never appear in usage data

- angular-3d-scene-crafter/SKILL.md (angular-3d-scene-crafter)
- angular-frontend-patterns/SKILL.md (angular-frontend-patterns)
- angular-gsap-animation-crafter/SKILL.md (angular-gsap-animation-crafter)
- ddd-architecture/SKILL.md (ddd-architecture)
- extract-and-relocate-angular-component-feature/SKILL.md (extract-and-relocate-angular-component-feature)
- ffmpeg-video-analysis/SKILL.md (ffmpeg-video-analysis)
- fleet-orchestration/SKILL.md (fleet-orchestration)
- humanize-library/SKILL.md (humanize-library)
- impeccable/SKILL.md (impeccable)
- nestjs-backend-patterns/SKILL.md (nestjs-backend-patterns)
- nestjs-deployment/SKILL.md (nestjs-deployment)
- nx-workspace-architect/SKILL.md (nx-workspace-architect)
- ptah-cli-usage/SKILL.md (ptah-cli-usage)
- remocn/SKILL.md (remocn)
- resilient-nestjs-patterns/SKILL.md (resilient-nestjs-patterns)
- saas-platform-patterns/SKILL.md (saas-platform-patterns)
- saas-workspace-initializer/SKILL.md (saas-workspace-initializer)
- skill-creator/SKILL.md (skill-creator)
- typesafe-ai/SKILL.md (typesafe-ai)
- video-showcase/SKILL.md (video-showcase)
- webhook-architecture/SKILL.md (webhook-architecture)

### Slugs in usage data with no matching agent/skill file on disk

- workflow-subagent
- Explore
- general-purpose
- unknown
- orchestrate
- Plan
- review
- code-review
- review-logic

## Totals

- Authored agents: 15
- Authored skills: 28
- Distinct slugs with usage: 29
- Total invocation events: 2790

## Commands

Files in `.claude/commands/` (not joined against usage):

| File                    | Name | Description                                                                                          | Lines |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------------------- | ----- |
| init-saas.md            |      | Initialize a complete SaaS workspace with NestJS, Nx, and Angular/React — discovery-first Stage A bo | 39    |
| initialize-workspace.md |      | Analyze codebase architecture and generate comprehensive CLAUDE.md documentation files for the proje | 111   |
| orchestrate-help.md     |      | Quick reference guide for the /orchestrate command — shows task types, workflow modes, and agent cat | 162   |
| orchestrate.md          |      | Orchestrate development workflows with specialist agents. Supports FEATURE, BUGFIX, REFACTORING, DOC | 44    |
| review-code.md          |      | Code quality review — Phase 1 of triple review protocol. Adapts to detected tech stack with best pra | 240   |
| review-logic.md         |      | Business logic review — Phase 2 of triple review protocol. Identifies dummy data, placeholders, and  | 328   |
| review-security.md      |      | Security vulnerability review — Phase 3 of triple review protocol. OWASP-based assessment across any | 354   |

## User harness

Subdirectories in `%USERPROFILE%\.ptah\skills`: 2

Files under `%USERPROFILE%\.ptah\user` (copies of workspace assets, grouped by workspace key):

- agents/
  - .history/backend-developer/ (empty)
  - .history/code-logic-reviewer/ (empty)
  - .history/code-style-reviewer/ (empty)
  - .history/devops-engineer/ (empty)
  - .history/figma-designer/ (empty)
  - .history/frontend-developer/ (empty)
  - .history/modernization-detector/ (empty)
  - .history/project-manager/ (empty)
  - .history/researcher-expert/ (empty)
  - .history/senior-tester/ (empty)
  - .history/software-architect/ (empty)
  - .history/team-leader/ (empty)
  - .history/technical-content-writer/ (empty)
  - .history/ui-ux-designer/ (empty)
  - .history/video-director/ (empty)
  - .history/visual-reviewer/ (empty)
  - backend-developer.md
  - backend-developer.ptah-origin.json
  - code-logic-reviewer.md
  - code-logic-reviewer.ptah-origin.json
  - code-style-reviewer.md
  - code-style-reviewer.ptah-origin.json
  - devops-engineer.md
  - devops-engineer.ptah-origin.json
  - frontend-developer.md
  - frontend-developer.ptah-origin.json
  - modernization-detector.md
  - modernization-detector.ptah-origin.json
  - project-manager.md
  - project-manager.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/.history/ (empty)
  - property-hub-55b604c4f3d6cac5/backend-developer.md
  - property-hub-55b604c4f3d6cac5/backend-developer.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/code-logic-reviewer.md
  - property-hub-55b604c4f3d6cac5/code-logic-reviewer.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/code-style-reviewer.md
  - property-hub-55b604c4f3d6cac5/code-style-reviewer.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/devops-engineer.md
  - property-hub-55b604c4f3d6cac5/devops-engineer.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/figma-designer.md
  - property-hub-55b604c4f3d6cac5/figma-designer.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/frontend-developer.md
  - property-hub-55b604c4f3d6cac5/frontend-developer.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/modernization-detector.md
  - property-hub-55b604c4f3d6cac5/modernization-detector.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/project-manager.md
  - property-hub-55b604c4f3d6cac5/project-manager.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/researcher-expert.md
  - property-hub-55b604c4f3d6cac5/researcher-expert.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/senior-tester.md
  - property-hub-55b604c4f3d6cac5/senior-tester.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/software-architect.md
  - property-hub-55b604c4f3d6cac5/software-architect.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/team-leader.md
  - property-hub-55b604c4f3d6cac5/team-leader.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/technical-content-writer.md
  - property-hub-55b604c4f3d6cac5/technical-content-writer.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/ui-ux-designer.md
  - property-hub-55b604c4f3d6cac5/ui-ux-designer.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/video-director.md
  - property-hub-55b604c4f3d6cac5/video-director.ptah-origin.json
  - property-hub-55b604c4f3d6cac5/visual-reviewer.md
  - property-hub-55b604c4f3d6cac5/visual-reviewer.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/.history/ (empty)
  - ptah-extension-f3f2fa6ea9b593a6/backend-developer.md
  - ptah-extension-f3f2fa6ea9b593a6/backend-developer.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/code-logic-reviewer.md
  - ptah-extension-f3f2fa6ea9b593a6/code-logic-reviewer.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/code-style-reviewer.md
  - ptah-extension-f3f2fa6ea9b593a6/code-style-reviewer.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/devops-engineer.md
  - ptah-extension-f3f2fa6ea9b593a6/devops-engineer.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/frontend-developer.md
  - ptah-extension-f3f2fa6ea9b593a6/frontend-developer.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/modernization-detector.md
  - ptah-extension-f3f2fa6ea9b593a6/modernization-detector.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/project-manager.md
  - ptah-extension-f3f2fa6ea9b593a6/project-manager.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/researcher-expert.md
  - ptah-extension-f3f2fa6ea9b593a6/researcher-expert.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/senior-tester.md
  - ptah-extension-f3f2fa6ea9b593a6/senior-tester.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/software-architect.md
  - ptah-extension-f3f2fa6ea9b593a6/software-architect.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/team-leader.md
  - ptah-extension-f3f2fa6ea9b593a6/team-leader.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/technical-content-writer.md
  - ptah-extension-f3f2fa6ea9b593a6/technical-content-writer.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/ui-ux-designer.md
  - ptah-extension-f3f2fa6ea9b593a6/ui-ux-designer.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/video-director.md
  - ptah-extension-f3f2fa6ea9b593a6/video-director.ptah-origin.json
  - ptah-extension-f3f2fa6ea9b593a6/visual-reviewer.md
  - ptah-extension-f3f2fa6ea9b593a6/visual-reviewer.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/.history/ (empty)
  - qa3elhamor-def93a4ea641ba82/backend-developer.md
  - qa3elhamor-def93a4ea641ba82/backend-developer.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/code-logic-reviewer.md
  - qa3elhamor-def93a4ea641ba82/code-logic-reviewer.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/code-style-reviewer.md
  - qa3elhamor-def93a4ea641ba82/code-style-reviewer.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/devops-engineer.md
  - qa3elhamor-def93a4ea641ba82/devops-engineer.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/frontend-developer.md
  - qa3elhamor-def93a4ea641ba82/frontend-developer.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/modernization-detector.md
  - qa3elhamor-def93a4ea641ba82/modernization-detector.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/project-manager.md
  - qa3elhamor-def93a4ea641ba82/project-manager.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/researcher-expert.md
  - qa3elhamor-def93a4ea641ba82/researcher-expert.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/senior-tester.md
  - qa3elhamor-def93a4ea641ba82/senior-tester.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/software-architect.md
  - qa3elhamor-def93a4ea641ba82/software-architect.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/team-leader.md
  - qa3elhamor-def93a4ea641ba82/team-leader.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/technical-content-writer.md
  - qa3elhamor-def93a4ea641ba82/technical-content-writer.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/ui-ux-designer.md
  - qa3elhamor-def93a4ea641ba82/ui-ux-designer.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/video-director.md
  - qa3elhamor-def93a4ea641ba82/video-director.ptah-origin.json
  - qa3elhamor-def93a4ea641ba82/visual-reviewer.md
  - qa3elhamor-def93a4ea641ba82/visual-reviewer.ptah-origin.json
  - researcher-expert.md
  - researcher-expert.ptah-origin.json
  - senior-tester.md
  - senior-tester.ptah-origin.json
  - software-architect.md
  - software-architect.ptah-origin.json
  - team-leader.md
  - team-leader.ptah-origin.json
  - technical-content-writer.md
  - technical-content-writer.ptah-origin.json
  - ui-ux-designer.md
  - ui-ux-designer.ptah-origin.json
  - video-director.md
  - video-director.ptah-origin.json
  - visual-reviewer.md
  - visual-reviewer.ptah-origin.json
- commands/
  - .history/init-saas/ (empty)
  - .history/orchestrate/ (empty)
  - init-saas.md
  - init-saas.ptah-origin.json
  - initialize-workspace.md
  - initialize-workspace.ptah-origin.json
  - orchestrate-help.md
  - orchestrate-help.ptah-origin.json
  - orchestrate.md
  - orchestrate.ptah-origin.json
  - review-code.md
  - review-code.ptah-origin.json
  - review-logic.md
  - review-logic.ptah-origin.json
  - review-security.md
  - review-security.ptah-origin.json
- skills/
  - agent-lanes/.history/ (empty)
  - agent-lanes/.ptah-origin.json
  - agent-lanes/SKILL.md
  - angular-3d-scene-crafter/.history/ (empty)
  - angular-3d-scene-crafter/.ptah-origin.json
  - angular-3d-scene-crafter/SKILL.md
  - angular-3d-scene-crafter/assets/ (empty)
  - angular-3d-scene-crafter/references/best-practices.md
  - angular-3d-scene-crafter/references/components.md
  - angular-3d-scene-crafter/references/patterns.md
  - angular-frontend-patterns/.history/ (empty)
  - angular-frontend-patterns/.ptah-origin.json
  - angular-frontend-patterns/SKILL.md
  - angular-frontend-patterns/references/component-patterns.md
  - angular-frontend-patterns/references/effects-patterns.md
  - angular-frontend-patterns/references/forms-patterns.md
  - angular-frontend-patterns/references/rxjs-patterns.md
  - angular-gsap-animation-crafter/.history/ (empty)
  - angular-gsap-animation-crafter/.ptah-origin.json
  - angular-gsap-animation-crafter/SKILL.md
  - angular-gsap-animation-crafter/assets/animation-template.component.ts
  - angular-gsap-animation-crafter/references/best-practices.md
  - angular-gsap-animation-crafter/references/components.md
  - angular-gsap-animation-crafter/references/patterns.md
  - ddd-architecture/.history/ (empty)
  - ddd-architecture/.ptah-origin.json
  - ddd-architecture/SKILL.md
  - ddd-architecture/references/cqrs-pattern.md
  - ddd-architecture/references/domain-events.md
  - ddd-architecture/references/entities-aggregates.md
  - ddd-architecture/references/repository-pattern.md
  - ddd-architecture/references/value-objects.md
  - extract-and-relocate-angular-component-feature/.ptah-origin.json
  - extract-and-relocate-angular-component-feature/SKILL.md
  - humanize-library/.history/ (empty)
  - humanize-library/.ptah-origin.json
  - humanize-library/SKILL.md
  - humanize-library/references/discover-the-repo.md
  - humanize-library/references/quality-rubric.md
  - humanize-library/references/refactor-recipes.md
  - humanize-library/scripts/analyze_library.mjs
  - nestjs-backend-patterns/.history/ (empty)
  - nestjs-backend-patterns/.ptah-origin.json
  - nestjs-backend-patterns/SKILL.md
  - nestjs-backend-patterns/references/authentication.md
  - nestjs-backend-patterns/references/authorization.md
  - nestjs-backend-patterns/references/multitenancy.md
  - nestjs-backend-patterns/references/prisma-zenstack.md
  - nestjs-backend-patterns/references/third-party-integration.md
  - nestjs-deployment/.history/ (empty)
  - nestjs-deployment/.ptah-origin.json
  - nestjs-deployment/SKILL.md
  - nestjs-deployment/references/database-migrations.md
  - nestjs-deployment/references/docker-multistage.md
  - nestjs-deployment/references/production-hardening.md
  - nestjs-deployment/references/webpack-bundling.md
  - nx-workspace-architect/.history/ (empty)
  - nx-workspace-architect/.ptah-origin.json
  - nx-workspace-architect/SKILL.md
  - nx-workspace-architect/references/custom-generators.md
  - nx-workspace-architect/references/library-creation.md
  - nx-workspace-architect/references/library-types.md
  - nx-workspace-architect/references/module-boundaries.md
  - nx-workspace-architect/references/workspace-setup.md
  - orchestration/.history/ (empty)
  - orchestration/.ptah-origin.json
  - orchestration/SKILL.md
  - orchestration/examples/ (empty)
  - orchestration/references/agent-catalog.md
  - orchestration/references/checkpoints.md
  - orchestration/references/git-standards.md
  - orchestration/references/lane-assignment.md
  - orchestration/references/strategies.md
  - orchestration/references/task-tracking.md
  - orchestration/references/team-leader-modes.md
  - ptah-cli-usage/.history/ (empty)
  - ptah-cli-usage/.ptah-origin.json
  - ptah-cli-usage/SKILL.md
  - ptah-cli-usage/references/agent-cli.md
  - ptah-cli-usage/references/auth-and-providers.md
  - ptah-cli-usage/references/harness.md
  - ptah-cli-usage/references/internal-mcp.md
  - ptah-cli-usage/references/jsonrpc.md
  - ptah-cli-usage/references/mcp-serve.md
  - ptah-cli-usage/references/setup.md
  - qaa-elhamour-art-direction/.history/ (empty)
  - qaa-elhamour-art-direction/.ptah-origin.json
  - r3f-scene-patterns/.history/ (empty)
  - r3f-scene-patterns/.ptah-origin.json
  - resilient-nestjs-patterns/.history/ (empty)
  - resilient-nestjs-patterns/.ptah-origin.json
  - resilient-nestjs-patterns/SKILL.md
  - resilient-nestjs-patterns/references/domain-service-layering.md
  - resilient-nestjs-patterns/references/dynamic-modules.md
  - resilient-nestjs-patterns/references/event-driven-architecture.md
  - resilient-nestjs-patterns/references/retry-and-fallback.md
  - resilient-nestjs-patterns/references/service-orchestration.md
  - saas-platform-patterns/.history/ (empty)
  - saas-platform-patterns/.ptah-origin.json
  - saas-platform-patterns/SKILL.md
  - saas-platform-patterns/references/checkout-and-portal.md
  - saas-platform-patterns/references/freemium-model.md
  - saas-platform-patterns/references/license-lifecycle.md
  - saas-platform-patterns/references/subscription-state-machine.md
  - saas-workspace-initializer/.history/ (empty)
  - saas-workspace-initializer/.ptah-origin.json
  - saas-workspace-initializer/SKILL.md
  - saas-workspace-initializer/references/roadmap-format.md
  - skill-creator/.history/ (empty)
  - skill-creator/.ptah-origin.json
  - skill-creator/LICENSE.txt
  - skill-creator/SKILL.md
  - skill-creator/references/output-patterns.md
  - skill-creator/references/workflows.md
  - skill-creator/scripts/ (empty)
  - technical-content-writer/.history/ (empty)
  - technical-content-writer/.ptah-origin.json
  - technical-content-writer/BLOG-POSTS.md
  - technical-content-writer/CODEBASE-MINING.md
  - technical-content-writer/DESIGN-SYSTEM.md
  - technical-content-writer/DOCUMENTATION.md
  - technical-content-writer/LANDING-PAGES.md
  - technical-content-writer/SKILL.md
  - technical-content-writer/VIDEO-SCRIPTS.md
  - tribunal/.history/ (empty)
  - tribunal/.ptah-origin.json
  - tribunal/SKILL.md
  - tribunal/references/council.md
  - tribunal/references/crucible.md
  - tribunal/references/forge.md
  - tribunal/references/race.md
  - tribunal/references/relay.md
  - tribunal/references/vendor-panel.md
  - ui-ux-designer/.history/ (empty)
  - ui-ux-designer/.ptah-origin.json
  - ui-ux-designer/ASSET-GENERATION.md
  - ui-ux-designer/DESIGN-SYSTEM-BUILDER.md
  - ui-ux-designer/DEVELOPER-HANDOFF.md
  - ui-ux-designer/LAYOUT-PATTERNS.md
  - ui-ux-designer/NICHE-DISCOVERY.md
  - ui-ux-designer/REFERENCE-LIBRARY.md
  - ui-ux-designer/SKILL.md
  - video-showcase/.history/ (empty)
  - video-showcase/.ptah-origin.json
  - video-showcase/SKILL.md
  - video-showcase/reference/brand-and-runtime.md
  - video-showcase/reference/camera-and-render.md
  - video-showcase/reference/install.md
  - video-showcase/reference/scene-authoring.md
  - webgl-asset-pipeline/.history/ (empty)
  - webgl-asset-pipeline/.ptah-origin.json
  - webhook-architecture/.history/ (empty)
  - webhook-architecture/.ptah-origin.json
  - webhook-architecture/SKILL.md
  - webhook-architecture/references/resilience-and-recovery.md
  - webhook-architecture/references/signature-verification.md
  - webhook-architecture/references/three-layer-pattern.md
