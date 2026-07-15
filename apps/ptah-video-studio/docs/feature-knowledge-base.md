# Ptah Feature Knowledge Base — "Scalable SaaS From Day One"

> Script source-of-truth for the next promo video (working title: **"From Cold Clone to Scalable SaaS"**).
> Every claim here traces to source code read on 2026-07-14. Facts marked ✅ are on-screen-safe.
> Successor to the _Speed vs. Scale — Dyad vs. Ptah_ video; same dark indigo/amber cinematic-tech grammar.

---

## The thesis (one sentence)

**Ptah turns a cold `git clone` into a project-aware AI orchestra that scaffolds, builds, and reviews a production SaaS on an architecture that never has to be retrofitted.**

The narrative arc is a build sequence, not a feature list:

1. **Setup Wizard** — power on: a cold workspace becomes a configured orchestra of specialists.
2. **Orchestration + subagents + CLI agents** — the conductor delegates; specialists build in parallel; adversarial review gates every commit.
3. **Nx + SaaS-from-day-one skills** — the roadmap-driven foundation: hexagonal monorepo, enforced boundaries, licensing/webhooks land _with_ the domain that needs them.
4. **Proof** — Ptah itself is a shipping product on this exact spine.

---

## Pillar 1 — The Setup Wizard (power-on)

**What:** A premium-gated **7-step** onboarding (`libs/frontend/setup-wizard`) that scans the codebase, runs LLM-assisted analysis, lets the user pick specialists, and a backend pipeline (`libs/backend/agent-generation`) _writes_ those agents to disk — plus mirrored copies for rival CLIs.

**The 7 steps** (confirmed in `wizard-view.component.ts:150-171`, `wizard-computeds.ts:89-97`):
Welcome → Scan → Analysis → Selection → **Enhance** → **Generation** → Completion.

**How it works:**

- **4-phase deep analysis** feeds generation: Project Profile → Architecture Assessment → Quality Audit → Elevation Plan (`content-generation.service.ts:822-844`).
- **Generation pipeline** (`orchestrator.service.ts:245-512`): Analysis (0-20%) → Selection (20-30%) → Rendering (30-95%) → Writing (95-100%), + optional **Phase 5** multi-CLI fan-out. One structured-output LLM call per template fills `<!-- LLM:ID -->` markers with project-specific content; safe authored fallback if a safety validator trips — a selected agent is **never** silently dropped.
- Files land in `.claude/agents/{id}.md` (path-traversal-locked to `.claude/`). Premium + rival CLIs detected → transformed copies to `.github/agents/*.agent.md`, `.codex/agents/*.toml`, `.cursor/agents/*.md`.
- Provider keys/model tier flow through `~/.ptah/settings.json` (not `package.json` — Marketplace trademark rule).

**Why SaaS-from-day-one:** the difference between "an empty AI extension" and "an orchestra that already knows your stack." Every downstream workflow depends on these generated, analysis-derived agent files existing and being accurate.

**On-screen facts:**

- ✅ **7 wizard steps**, one premium gate.
- ✅ **15 built-in agent templates** on disk (`templates/agents/*.template.md`). ⚠️ In-app upsell copy still says "13" — **use 15**; it's the truth on disk.
- ✅ **3 rival CLI targets**: Copilot, Codex, Cursor.

**Visual metaphors:** (1) **Assembly conveyor** — 7 glass podiums light up as a "workspace crystal" rides through, gathering modules. (2) **Control-panel power-on** — a wall of 15 hex agent-badges flips from gray to backlit color; duplicates peel off toward Copilot/Codex/Cursor doors. (3) **Pre-flight rocket** — license badge greens, radar sweep (scan), blueprint pages assemble the nose cone, engines ignite at Completion.

---

## Pillar 2 — Orchestration, subagents & the 3-tier CLI hierarchy (the conductor)

**What:** A development-workflow OS baked into the plugin. The `orchestration` skill makes the primary session a **conductor that never writes code itself** — it classifies, picks a depth, and delegates.

**How it works:**

- **8 task types** auto-detected (FEATURE, BUGFIX, REFACTORING, DOCUMENTATION, RESEARCH, DEVOPS, SAAS_INIT, CREATIVE) via a weighted matrix (`SKILL.md:30-39, 108-113`).
- **3 workflow depths**: Full (PM → Architect → Team-Leader → QA) / Partial / Minimal (`SKILL.md:273-280`).
- **3-tier hierarchy** (`references/cli-agent-delegation.md:7-28`):
  - **Tier 1 — Claude (orchestrator/CTO):** sole spawn authority, owns all user interaction, never implements.
  - **Tier 2 — subagents (senior leads):** 14-15 specialists (`references/agent-catalog.md`) that retain full reasoning.
  - **Tier 3 — CLI agents (junior helpers):** `ptah-cli`, `codex`, `copilot` — **no shared context**, fully self-contained prompts.
- **Spawn → Poll → Read** via real MCP tools (`ptah_agent_spawn/status/read/list/steer/stop`). Interrupted agents **resume** via `resume_session_id` (ptah-cli + copilot; codex ephemeral). **Max 3 concurrent** CLI agents; priority **ptah-cli > codex > copilot**.
- **Multi-vendor `tribunal`** rides `agent-sdk`'s single `IAIProvider` adapter: **Council** (debate → cited verdict), **Forge** (per-vendor git worktrees → cross-review → merge winner), **Race** (N attempts, verify winner before commit), **Relay** (plan→architect→implement→review across vendor lanes).

**Why SaaS-from-day-one:** parallelism on boilerplate (3 CLI agents at once), specialist quality gates for the SaaS-critical decisions (auth, multitenancy), **structural** adversarial review (`code-logic-reviewer` before every commit; Forge/Race add cross-vendor gates), and decomposition that scales as the team grows.

**On-screen facts:** ✅ 8 task types · 3 depths · 3-tier model · max 3 concurrent CLI agents · ptah-cli > codex > copilot · 4 tribunal moves · vendors: Codex, Copilot, Cursor, Moonshot Kimi, Z.AI GLM, Ollama Cloud, OpenRouter.

**Visual metaphors:** (1) **Conductor + orchestra pit** — podium figure (Claude), front-row lit stands (senior specialists), dimmer back-row session players (CLI vendors); baton lights 8/5/2 stands for Full/Partial/Minimal. (2) **Assembly line + 3 junior robot arms** (concurrency cap = 3 glowing slots, each with a countdown/timeout + status strip). (3) **Panel of judges / relay baton** — four frosted-glass vendor booths, each building in a sealed terrarium (worktree); gavel merges one, others dissolve.

---

## Pillar 3 — Nx workspace + SaaS-from-day-one skills (the foundation)

**What:** Interlocking skills (`apps/.../plugins/ptah-nx-saas/skills/`) that turn "start a SaaS" into a governed two-stage build: `nx-workspace-architect`, `saas-workspace-initializer`, `saas-platform-patterns`, `ddd-architecture`, `nestjs-backend-patterns`, `resilient-nestjs-patterns`, `webhook-architecture`.

**How it works:**

- **Two-stage bootstrap.** Stage A (one session): discovery → write `.ptah/roadmap.md` → scaffold _only_ foundation (Nx workspace, `apps/web`+`apps/api`, ESLint module boundaries, Jest, `libs/shared/domain`, `libs/api-interfaces`, CI, + tenant/auth/DB stubs _only if load-bearing_). Then stop. Stage B: each unchecked roadmap item is its own `/orchestrate <slug>` task. Roadmap enforces kebab slugs, 3-5 sentence charters, acyclic `Depends on:` chains.
- **Nx architecture:** 7 typed library kinds (feature, feature-api, ui, data-access, util, api-interfaces, domain), domain-folder layout, 3-dimension tags (`scope:`/`type:`/`platform:`) enforced by `@nx/enforce-module-boundaries` — the exact pattern running in Ptah's own `eslint.config.mjs`.
- **Hexagonal spine:** `libs/backend/platform-core` = **16 `I`-prefixed ports** under one `PLATFORM_TOKENS` map (`tokens.ts:11`); **3 adapter families** (`platform-cli/electron/vscode`) implement them and nothing else. "Everything imports this. This imports nothing."
- **SaaS lifecycle:** `plans.config.ts` (tiers) → `LicenseService` (key gen/verify/expire) → webhook-driven subscription state machine → checkout/portal → trial auto-downgrade. **3-layer webhook** pattern (Controller always-200 → verify+idempotency → domain). **5 resilience patterns**, ordered adoption.

**Why SaaS-from-day-one:** you get a working monorepo, enforced boundaries, and _only_ the primitives discovery requires — architecture never retrofitted; billing/webhooks/resilience land alongside the domain that consumes them.

**Proof:** `apps/ptah-license-server` — real NestJS 11 + Prisma + PostgreSQL + Paddle (signature-verified webhooks) + WorkOS PKCE + Resend, global Throttler/Audit/Sentry. Ptah runs on the exact spine the skills teach.

**On-screen facts:** ✅ 16 platform ports · 3 adapter families · 7 Nx library kinds · 2-stage bootstrap / 1 roadmap file · 3-layer webhooks · 5 resilience patterns. ⚠️ Root CLAUDE.md says 10 apps / 16 backend / 21 frontend libs; on-disk has grown further — verify exact counts at render time before putting a number on screen.

**Visual metaphors:** (1) **Blueprint-to-city** — `roadmap.md` unrolls as ink-lines; districts rise per phase only once dependency conduits are lit; pull back to a skyline that was extended, never rebuilt. (2) **Hexagonal core + snap-blocks** — 16 glowing port sockets; CLI/Electron/VS Code blocks snap to the hexagon, never to each other. (3) **Scaffold + construction crane** (`/orchestrate <slug>`) lifting one tagged crate at a time.

---

## Corrections to carry into the script (don't repeat stale copy)

- Agent templates: say **15**, not 13 (on-disk truth).
- Setup Wizard step order: **Enhance before Generation** (a stale doc-comment in `wizard-view.component.ts:16-23` reverses them; the switch/array are correct).
- App/lib counts have grown past the CLAUDE.md figures — **recount before any on-screen number**.

---

## Suggested video spine (for scripting — not final)

Cold clone (dark) → Wizard power-on (Pillar 1) → Conductor delegates, specialists + CLI agents build in parallel, review gate (Pillar 2) → Roadmap-driven hexagonal foundation rises, licensing/webhooks snap in (Pillar 3) → "Ptah is built on this" reveal (proof) → CTA. Continues the Dyad-vs-Ptah dark indigo/amber cinematic-tech look, now with real GLB props.
