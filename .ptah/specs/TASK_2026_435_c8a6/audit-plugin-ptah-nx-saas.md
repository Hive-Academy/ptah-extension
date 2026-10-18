# Audit - ptah-nx-saas skills (TASK_2026_435 batch 2e)

Findings cite original packaged `SKILL.md` lines. Bytes are UTF-8 file sizes; KB is decimal. The packaged skills and their `.claude/skills/` copies received identical edits. Frontmatter descriptions and all `## Requires` sections were left intact.

## nestjs-backend-patterns

Original `SKILL.md:14-45` gave a generic SDK wrapper, then `:57-113` gave a second provider example. Both repeated the existing `references/third-party-integration.md` mechanism (rubric 2-4). `:115-164` embedded tenant code and a module tree already covered by tenancy and Prisma references; `:47-55`, `:165-184` repeated routing indexes (rules 1, 2). The entry now retains the failure-sensitive boundaries and one conditional link per topic. Cut the duplicate examples and second index; restored the shared/domain module placement in the entry. The five topic references hold the implementation.

## nestjs-deployment

Original `SKILL.md:14-30` was a broad deployment checklist; `:31-108` embedded a build diagram and a Dockerfile already developed in `references/docker-multistage.md` and `references/production-hardening.md` (rules 1-3). `:109-126` repeated the same reference index twice (rule 2). The entry now holds the runtime, migration, and production gates, with four task-conditioned links. Cut the duplicated image and main bootstrap examples; existing references remain the implementation home.

## nx-workspace-architect

Original `SKILL.md:19-50` carried a library roster and tree, `:52-100` an ESLint constraint example, `:101-155` workspace commands, path mapping, and tags; all have topic homes under `references/` (rules 1, 2, 7). `:156-174` listed the references twice. The new entry keeps app/library, tag, boundary, and public-entry rules; five conditional links route to the existing guides. Cut the repeated examples and duplicate index. Workspace commands remain in `workspace-setup.md`, where they can be checked against the local Nx version.

## resilient-nestjs-patterns

Original `SKILL.md:14-72` restated selection criteria from the reference set; `:73-199` loaded a long composite subscription example and dynamic-module wiring at trigger time (rules 1-4). `:200-231` added adoption narrative, anti-pattern recap, and another index. The entry now states the failure-sensitive boundaries and points directly to the five existing implementation guides. Cut the long composite code and duplicate routing; restored its sequence, adoption order, selection decisions, and all six anti-pattern routes compactly in the entry.

## saas-platform-patterns

Original `SKILL.md:14-60` loaded a model roster and architecture overview; `:61-190` carried freemium, license, and subscription examples duplicated by the four existing guides (rules 1-4, 7). `:191-248` repeated module organization, decision matrix, skill roster, and anti-patterns. The entry now keeps business-model selection, authoritative subscription state, idempotency, and separation of licensing from checkout, with four conditional links. Cut the redundant code examples; restored the model selection table, library placement, integration roles, and five anti-pattern guards in the entry.

## saas-workspace-initializer

Original `SKILL.md:14-19` repeated frontmatter trigger keywords (rule 1); `:39-131` embedded discovery questions, conditional foundation table, and verification details that belong to an on-demand Stage A workflow (rules 1, 6). `:167-191` listed companion and external skills whose availability is discovered at runtime (rules 7-8). Moved `:39-131` to `references/stage-a-workflow.md`, with the roadmap link adjusted to its new relative location. Kept the shared Stage A contract, required answer gate, roadmap/foundation gate, exact handoff shape from `:132-155`, and stop condition from `:156-166` in the entry. Removed the trigger and skill rosters. The new workflow retains the original two-round question protocol and conditional scaffold decisions.

## webhook-architecture

Original `SKILL.md:14-216` embedded an architecture diagram and a full controller/service/business implementation already covered by `references/three-layer-pattern.md` (rules 1-4). `:217-250` repeated decisions, provider roster, and bootstrap code also covered by the signature and recovery guides (rules 2, 7). The entry now states the three-layer boundary, raw-byte verification, event-ID deduplication, and failure recovery, with three conditional links. Cut the duplicate implementation and provider roster; topic references retain the detailed contract.

## Trigger-time KB and directory bytes

| Skill | SKILL.md before B / KB | SKILL.md after B / KB | Directory before B / KB | Directory after B / KB |
| --- | ---: | ---: | ---: | ---: |
| `nestjs-backend-patterns` | 7,280 / 7.280 | 1,604 / 1.604 | 51,028 / 51.028 | 45,352 / 45.352 |
| `nestjs-deployment` | 5,992 / 5.992 | 1,359 / 1.359 | 50,817 / 50.817 | 46,184 / 46.184 |
| `nx-workspace-architect` | 7,183 / 7.183 | 1,455 / 1.455 | 40,137 / 40.137 | 34,409 / 34.409 |
| `resilient-nestjs-patterns` | 10,757 / 10.757 | 3,411 / 3.411 | 59,799 / 59.799 | 52,453 / 52.453 |
| `saas-platform-patterns` | 11,989 / 11.989 | 2,690 / 2.690 | 83,002 / 83.002 | 73,703 / 73.703 |
| `saas-workspace-initializer` | 13,706 / 13.706 | 2,155 / 2.155 | 21,715 / 21.715 | 17,693 / 17.693 |
| `webhook-architecture` | 10,452 / 10.452 | 1,448 / 1.448 | 43,532 / 43.532 | 34,528 / 34.528 |

The six pattern skills route to their existing references. The initializer gained one 95-line Stage A workflow reference; it is loaded only for Stage A work. All seven frontmatter descriptions remain byte-identical to their originals.

## Checks

- Packaged directory versus `.claude/skills/<name>` comparison for each of seven skills: zero differences.
- Every Markdown file path linked by each edited `SKILL.md` exists; all links in the new Stage A workflow resolve. Frontmatter fences and names were checked.
- Representative routes checked: an external SDK integration reaches `third-party-integration.md`; a deployment migration reaches `database-migrations.md`; a new domain library reaches `library-creation.md`; external API failure reaches `retry-and-fallback.md`; subscription transitions reach `subscription-state-machine.md`; a new SaaS foundation reaches `stage-a-workflow.md` and `roadmap-format.md`; an inbound webhook reaches `three-layer-pattern.md` and `signature-verification.md`. The required mechanisms remain in those guides.
- `npx jest -c libs/backend/harness-sync/jest.config.ts --coverage=false --maxWorkers=2 skill-sibling-links`: 1 suite passed, 11 tests passed.

## Revise round 1 — section coverage

Original headings come from `git show HEAD:<skill>/SKILL.md`. `a` means the original rule or example was already in the cited reference. `b` means the content was restored or moved to the cited location. Activation and trigger headings cite the unchanged frontmatter description as permitted. All line numbers after `a` and `b` refer to the revised packaged skill.

### nestjs-backend-patterns

| Original section | Coverage |
| --- | --- |
| `10` ## Activation scope | description:3 (activation scope already states the trigger) |
| `14` ## Core Principle: Provider Pattern for External Services | a: references/third-party-integration.md:39 |
| `47` ## Quick Reference | b: SKILL.md:16-22 (conditional index) |
| `57` ## Third-Party Integration Pattern | a: references/third-party-integration.md:7 |
| `59` ### Step 1: Provider Factory | a: references/third-party-integration.md:39 |
| `85` ### Step 2: Abstract Service Interface | a: references/third-party-integration.md:9 |
| `97` ### Step 3: Service Implementation | a: references/third-party-integration.md:122 |
| `115` ## Multitenancy Pattern (Shared Schema) | a: references/multitenancy.md:99 |
| `138` ## Module Organization | b: SKILL.md:13-14 (module placement) |
| `165` ## Decision Matrix | b: SKILL.md:16-22 (decision routes) |
| `176` ## References | b: SKILL.md:16-22 (reference index) |

### nestjs-deployment

| Original section | Coverage |
| --- | --- |
| `10` ## Activation scope | description:3 (activation scope already states the trigger) |
| `14` ## Deployment Checklist | a: references/docker-multistage.md:87,173,337; references/webpack-bundling.md:53; references/database-migrations.md:25; references/production-hardening.md:9,165,226,277 (deployment checklist) |
| `31` ## Architecture | a: references/docker-multistage.md:87 |
| `62` ## Quick Start: Minimal Production Dockerfile | a: references/docker-multistage.md:87 |
| `103` ## Quick Start: Production main.ts | a: references/production-hardening.md:9 |
| `109` ## Decision Matrix | b: SKILL.md:15-20 (decision routes) |
| `119` ## References | b: SKILL.md:15-20 (reference index) |

### nx-workspace-architect

| Original section | Coverage |
| --- | --- |
| `10` ## Activation scope | description:3 (activation scope already states the trigger) |
| `14` ## Core Principle: Libs Over Apps | b: SKILL.md:10 (apps and libs) |
| `19` ## Library Type Quick Reference | a: references/library-types.md:7,39,63,97 (library types) |
| `31` ## Domain-Based Organization Pattern | a: references/workspace-setup.md:50 |
| `52` ## Module Boundary Rules | a: references/module-boundaries.md:19 |
| `101` ## Workspace Initialization Commands | a: references/workspace-setup.md:5,14,24,37 (workspace commands) |
| `123` ## TypeScript Path Configuration | a: references/workspace-setup.md:120 |
| `140` ## Tagging Strategy | a: references/module-boundaries.md:94 |
| `156` ## Decision Matrix | b: SKILL.md:14-21 (decision routes, including import errors) |
| `166` ## References | b: SKILL.md:14-21 (reference index) |

### resilient-nestjs-patterns

| Original section | Coverage |
| --- | --- |
| `10` ## Activation scope | description:3 (activation scope already states the trigger) |
| `14` ## When You Need These Patterns | b: SKILL.md:16-25 (problem-to-pattern selection) |
| `22` ## Pattern Quick Reference | b: SKILL.md:39-45 (reference index) |
| `32` ## Pattern Selection Guide | b: SKILL.md:16-25 (selection guide) |
| `36` ### Is the problem about code organization? | b: SKILL.md:20-21 (organization) |
| `49` ### Is the problem about reliability? | b: SKILL.md:22 (reliability) |
| `57` ### Is the problem about coupling? | b: SKILL.md:23 (coupling) |
| `65` ### Is the problem about configuration? | b: SKILL.md:24 (configuration) |
| `73` ## How Patterns Compose | b: SKILL.md:14 (composed flow) |
| `90` ### Composed Example: Subscription Domain | b: SKILL.md:14 (subscription composition summarized; mechanisms in topic references) |
| `174` ### Module Wiring with Dynamic Module | a: references/dynamic-modules.md:7 |
| `200` ## Pattern Adoption Order | b: SKILL.md:16-26 (adoption order and YAGNI gate) |
| `212` ## Anti-Patterns to Avoid | b: SKILL.md:28-37 (all six anti-pattern routes) |
| `223` ## References | b: SKILL.md:39-45 (reference index) |

### saas-platform-patterns

| Original section | Coverage |
| --- | --- |
| `10` ## Activation scope | description:3 (activation scope already states the trigger) |
| `14` ## Monetization Models | b: SKILL.md:14-23 (four models, fit, complexity, selection) |
| `25` ## Architecture Overview | b: SKILL.md:11-12,25 (components and webhook flow); trial detail: references/freemium-model.md:284 |
| `61` ## Quick Start: Freemium Model | a: references/freemium-model.md:9; references/license-lifecycle.md:7; references/subscription-state-machine.md:103 (quick start mechanisms) |
| `63` ### 1. Define Plans | a: references/freemium-model.md:9 |
| `106` ### 2. Generate License Keys | a: references/license-lifecycle.md:7 |
| `159` ### 3. Handle Subscription Webhooks | a: references/subscription-state-machine.md:103 |
| `191` ## Module Structure | b: SKILL.md:25 (licensing and payment library placement) |
| `214` ## Decision Matrix | b: SKILL.md:25,29-34 (decision routes) |
| `225` ## Integration with Other Skills | b: SKILL.md:25 (webhook, payment adapter, workspace integration) |
| `231` ## Anti-Patterns | b: SKILL.md:23-27 (all five failure guards) |
| `241` ## References | b: SKILL.md:29-34 (reference index) |

### saas-workspace-initializer

| Original section | Coverage |
| --- | --- |
| `10` ## Shared Stage A contract | b: SKILL.md:8-13 (shared Stage A contract) |
| `14` ## Trigger Keywords | description:3 (trigger keywords already state the trigger) |
| `21` ## Contract | b: SKILL.md:8-13 (stage contract) |
| `23` ### Stage A — Roadmap + Foundation (this skill, single session) | b: SKILL.md:8-12 (Stage A gate) |
| `35` ### Stage B — Per-module implementation (other sessions, NOT this skill) | b: SKILL.md:12,20-42 (Stage B handoff and stop) |
| `39` ## Step a) Discovery — mandatory, two-round `AskUserQuestion` | b: references/stage-a-workflow.md:3 (moved discovery protocol) |
| `45` ### Round 1 — Business (ask first, always) | b: references/stage-a-workflow.md:9 (moved Round 1) |
| `55` ### Round 2 — Stack (ask after Round 1 is complete) | b: references/stage-a-workflow.md:19 (moved Round 2) |
| `67` ### Conditional (ask only when relevant) | b: references/stage-a-workflow.md:31 (moved conditional questions) |
| `76` ## Step a2) Domain + Workspace Design | b: references/stage-a-workflow.md:40 (moved design step) |
| `84` ## Step b) Roadmap | b: references/stage-a-workflow.md:48 (moved roadmap step) |
| `96` ## Step c) Foundation Scaffold | b: references/stage-a-workflow.md:60 (moved foundation step) |
| `100` ### Always include | b: references/stage-a-workflow.md:64 (moved baseline scaffold) |
| `109` ### Include only when discovery makes them load-bearing | b: references/stage-a-workflow.md:73 (moved conditional scaffold table) |
| `125` ### Verification before handoff | b: references/stage-a-workflow.md:89 (moved verification gate) |
| `132` ## Step d) Handoff | b: SKILL.md:20-40 (exact handoff block) |
| `156` ## Step e) STOP | b: SKILL.md:8-12,42 (stop condition) |
| `167` ## References | b: SKILL.md:15-18 (reference index) |
| `169` ### Stage A artifacts | b: SKILL.md:18 (roadmap schema link) |
| `173` ### Companion skills | b: SKILL.md:35-38 (Stage B companion routes) |
| `185` ### External skills | b: references/stage-a-workflow.md:21-23,44-45 (frontend and design skills); SKILL.md:35-38 (orchestration) |

### webhook-architecture

| Original section | Coverage |
| --- | --- |
| `10` ## Activation scope | description:3 (activation scope already states the trigger) |
| `14` ## Architecture | a: references/three-layer-pattern.md:33,76,199 |
| `55` ## Quick Start | a: references/three-layer-pattern.md:33 |
| `57` ### 1. Controller (HTTP Layer) | a: references/three-layer-pattern.md:33 |
| `81` ### 2. Webhook Service (Verification and Routing Layer) | a: references/three-layer-pattern.md:76 |
| `160` ### 3. Business Service (Domain Logic Layer) | a: references/three-layer-pattern.md:199 |
| `217` ## Key Design Decisions | b: SKILL.md:10-13 (response, raw bytes, idempotency, layer ownership, event routing) |
| `228` ## When to Use This Pattern | description:3 (when-to-use provider roster duplicates the trigger) |
| `239` ## NestJS Main Configuration | a: references/three-layer-pattern.md:3 |
| `252` ## References | b: SKILL.md:15-19 (reference index) |

## Decisions

- All seven entries exceeded or approached the entry budget because implementation detail loaded with routing. None stayed unchanged.
- Existing topic references remain the canonical implementation homes. Missing cross-topic guidance was restored compactly in the entries. The initializer needed one new direct reference for its detailed Stage A protocol.
- The webhook entry again states its acknowledgement and recovery rule; `resilience-and-recovery.md` keeps the detailed response policy and exceptions.
- No project files outside the seven packaged skill directories, their `.claude` copies, and this audit were edited by this batch. No build or workspace-wide check ran.
