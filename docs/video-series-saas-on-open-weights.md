# Video Series — Build a SaaS on Open Weights with Ptah

> **Flagship series.** One continuous build: ship a real, multi-tenant Task Manager SaaS
> using **Ptah Desktop (Electron)** driven entirely by **open-weight models**, while
> demonstrating every Ptah feature, every shipped skill, and the full orchestration workflow.
> The emotional spine: _"You can build and ship a production SaaS in your free trial — on open weights."_

---

## The Series Bible (constant across every episode)

**Runtime:** Ptah Desktop (Electron) only. (Memory/Skills/Schedules/Gateway are Electron-only — perfect fit.)

**Models & agents:**

- **Orchestrator (main chat):** Kimi K2 (open weight) via **Ollama Cloud** — configured as an
  Anthropic-compatible provider (base URL + tier mapping). This is the brain that plans and reviews.
- **Tier-3 CLI delegates (grunt work):** `codex`, `copilot`, `ptah-cli` via `ptah_agent_spawn`
  (Spawn → Poll → Read). Priority `ptah-cli > codex > copilot`.

**Skills used (all shipped in the extension):**

- `ptah-core`: `/orchestrate`, `/review-code|logic|security`, `ddd-architecture`,
  `skill-creator`, `technical-content-writer`, `ui-ux-designer`
- `ptah-nx-saas`: `/initialize-workspace`, `nx-workspace-architect`, `nestjs-backend-patterns`,
  `resilient-nestjs-patterns`, `saas-platform-patterns`, `webhook-architecture`, `nestjs-deployment`
- `ptah-angular`: `angular-frontend-patterns`, `angular-gsap-animation-crafter`, `angular-3d-scene-crafter`

**The product being built:** **TaskFlow** _(working name)_ — a multi-tenant SaaS task manager:
projects, tasks, teams, real-time updates, freemium + paid subscriptions with webhook-driven billing.

**Stack:** Nx monorepo + NestJS API + Angular web + Prisma/Postgres + SOLID/DDD, exactly the
patterns the shipped skills encode.

**Recurring on-screen rituals (brand consistency):**

- Every episode opens on the Ptah Desktop chat with the **open-weight model badge** visible.
- Every milestone ends green (build/test passes) before cutting.
- A running **"Days into trial"** counter + **"$ spent on closed models: $0"** lower-third.

---

## ⚠️ Pre-flight (verify BEFORE recording Episode 00)

These are real capabilities, but confirm the exact **desktop UI** flow on camera first:

1. In Ptah Desktop settings, point the provider at **Ollama Cloud** (base URL) and map the
   tier slot to the **Kimi** model; confirm a chat turn completes and the model badge shows it.
2. Confirm `ptah_agent_spawn` reaches `codex` / `copilot` / `ptah-cli` from inside the desktop app.
3. Confirm the shipped skill plugins are installed/available in the desktop build used for recording.
4. Confirm the current free-trial length wording (series uses **"100-day"** framing — adjust if different).

If any of (1)–(3) needs a different path, we adjust Episode 00, not the whole arc.

---

## Episode Map (13 episodes)

| #   | Title                  | Ships (milestone)                                  | Lead skill(s)                                                   | Ptah features spotlighted                                                                     |
| --- | ---------------------- | -------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 00  | Setup & the thesis     | Working open-weight orchestra + delegates          | —                                                               | Setup wizard, provider/open-weight config, CLI-agent wiring, the "$0 closed models" thesis    |
| 01  | Idea → roadmap         | `.ptah/roadmap.md` + scope                         | `orchestration`, `saas-workspace-initializer`/`init-saas`       | `/orchestrate` workflow, reasoning effort (planning), memory seed (project goals)             |
| 02  | Scaffold the workspace | Green Nx monorepo (API + web shells, lint/test/CI) | `nx-workspace-architect`                                        | CLI delegation (scaffold grunt work), workspace intelligence indexing new repo, approval flow |
| 03  | Model the domain (DDD) | Domain layer (entities/aggregates/VOs/CQRS)        | `ddd-architecture`                                              | Canvas multi-tile (parallel bounded contexts), memory of decisions, reasoning effort          |
| 04  | Auth + multi-tenancy   | Login + tenant isolation                           | `nestjs-backend-patterns`                                       | Parallel agents (auth ∥ tenancy), security review pass, Prisma/ZenStack                       |
| 05  | The Tasks engine       | Tasks CRUD + real-time (SSE)                       | `resilient-nestjs-patterns`                                     | Background workspaces, Rewind/fork (try alt design), Monaco/xterm/git editor                  |
| 06  | Monetize               | Freemium + paid + billing webhooks                 | `saas-platform-patterns`, `webhook-architecture`                | MCP browser tool (test checkout), parallel agents, subscription state machine                 |
| 07  | The frontend           | Angular app + marketing landing                    | `angular-frontend-patterns`, `ui-ux-designer`, `angular-gsap-*` | Canvas multi-tile, design system, GSAP/3D skills                                              |
| 08  | Quality gate           | Hardened, reviewed codebase                        | `/review-code`, `/review-logic`, `/review-security`             | Triple review, code reviewers, compaction (`/compact`), MCP diagnostics, no-cost-meter beat   |
| 09  | Always-on ops          | Scheduled jobs + remote control                    | —                                                               | Cron scheduler, messaging gateway (Discord/Telegram/Slack), voice, "code from your phone"     |
| 10  | Ship it                | Deployed to cloud                                  | `nestjs-deployment`                                             | Docker multistage, migrations, production hardening, devops delegation                        |
| 11  | Teach Ptah your stack  | Custom reusable skill + curated memory             | `skill-creator`                                                 | Skill synthesis (learns from the build), Memory tab, harness builder                          |
| 12  | Finale + trial CTA     | Recap + viewer call-to-action                      | `technical-content-writer`                                      | Whole-journey montage; "$0 on closed models"; build-yours-in-your-trial CTA                   |

---

## Feature-Coverage Matrix (proof every feature is demoed)

| Ptah feature                                                              | Episode(s)                 |
| ------------------------------------------------------------------------- | -------------------------- |
| Open-weight / Ollama provider config                                      | 00                         |
| Setup wizard                                                              | 00                         |
| Orchestrator main chat                                                    | all                        |
| `/orchestrate` workflow                                                   | 01, 04, 05, 06             |
| Shipped skills (each)                                                     | 01–07, 10, 11              |
| 3-tier CLI delegation (codex/copilot/ptah-cli)                            | 02, 04, 06, 10             |
| Canvas multi-tile (parallel agents)                                       | 03, 07                     |
| Background workspaces                                                     | 05                         |
| Rewind / transparent fork                                                 | 05                         |
| Persistent memory                                                         | 01, 11                     |
| Skill synthesis                                                           | 11                         |
| skill-creator (author a skill)                                            | 11                         |
| Harness builder                                                           | 11                         |
| Cron scheduler                                                            | 09                         |
| Messaging gateway + voice + "from your phone"                             | 09                         |
| Reasoning effort control                                                  | 01, 03                     |
| Compaction (`/compact`)                                                   | 08                         |
| `/context` + `/cost` (Anthropic-only — noted, not demoed on open weights) | 08                         |
| Triple review + code reviewers                                            | 08                         |
| Workspace intelligence (AST/symbol index/search)                          | 02, 03                     |
| MCP tools (browser / deps / diagnostics)                                  | 06, 08                     |
| Editor (Monaco / xterm / git)                                             | 05 (spotlight), throughout |
| Approval / permission flow                                                | 02, 04                     |

---

## Per-Episode Planning Template

```
### E<nn> — <Title>
- Length / format:
- Trial-day badge:
- Goal (what's shipped + what viewer learns):
- Hook (0:00–0:10):
- Pre-record setup (repo state, seeded data, accounts):
- Beat-by-beat (narration ↔ on-screen action):
- Skills invoked (exact slash/skill names):
- Ptah features spotlighted:
- CLI delegations shown (which agent, what task):
- Payoff line:
- CTA / next episode tease:
- Pitfalls to avoid on camera:
- Assets needed:
```

---

## Episode 00 — Setup & the Thesis

- **Length / format:** Long-form, 8–10 min.
- **Trial-day badge:** Day 1.
- **Goal:** Viewer installs Ptah Desktop, wires an **open-weight orchestrator (Kimi via Ollama Cloud)** + **codex/copilot/ptah-cli delegates**, and believes "I can build a real SaaS with this, for $0 in closed-model fees."
- **Hook (0:00–0:10):** Black screen, one line types out: _"What if you could ship a real SaaS — without paying a cent to a closed AI lab?"_ Cut to the Ptah Desktop chat, open-weight model badge glowing.
- **Pre-record setup:** Clean machine/profile; Ollama Cloud account + Kimi access ready; codex/copilot/ptah-cli installed; throwaway folder for TaskFlow.
- **Beat-by-beat:**
  1. Install + first launch → the **Setup wizard** (premium-gated onboarding) end to end.
  2. **Provider config:** point at Ollama Cloud, select Kimi as the orchestrator tier; send a "hello, what model are you?" turn — badge confirms open weights.
  3. **Wire the delegates:** show codex / copilot / ptah-cli available to the orchestrator; explain the 3-tier model (orchestrator plans, CLIs do grunt work).
  4. State the **series contract** on screen: Electron only · open weights only · ship a real SaaS · every feature demoed.
- **Skills invoked:** none yet (this is the rig).
- **Ptah features spotlighted:** setup wizard, provider/open-weight config, CLI-agent wiring.
- **CLI delegations shown:** a trivial smoke task to one delegate to prove the wiring (e.g. "print the Node version").
- **Payoff line:** _"No closed models. No lock-in. Just an open-weight brain and a team of CLI hands — let's build a SaaS."_
- **CTA:** Next: turn a one-line idea into a real roadmap.
- **Pitfalls:** Don't show API keys/endpoints on screen; pre-test the exact Kimi model id and badge; keep the wizard tight (cut dead air).
- **Assets:** "$0 on closed models" lower-third, 3-tier diagram (orchestrator → CLI delegates), trial-day counter intro.

## Episode 01 — Idea → Roadmap

- **Length / format:** Long-form, 9–11 min.
- **Trial-day badge:** Day 2.
- **Goal:** Turn "I want a task-manager SaaS" into a concrete, phased `.ptah/roadmap.md` and seed Ptah's memory with the project's goals/constraints — using the orchestration workflow + SaaS initializer skill.
- **Hook:** _"Most projects die in the 'where do I even start' phase. Watch Ptah skip it."_
- **Pre-record setup:** Empty TaskFlow workspace open in Ptah Desktop; orchestrator = Kimi.
- **Beat-by-beat:**
  1. Kick off **`/orchestrate`** (or the SaaS initializer skill); answer the discovery questions (framework, scope, tenancy, billing).
  2. Bump **reasoning effort** up for the planning turn — show the trade-off.
  3. Ptah produces a **phased roadmap** (`.ptah/roadmap.md`) — walk the phases that become the next episodes.
  4. **Seed memory:** save the product goals, stack decisions, and "open weights only" constraint to the Memory tab; show it recall them.
- **Skills invoked:** `orchestration` (`/orchestrate`), `saas-workspace-initializer` / `init-saas`.
- **Ptah features spotlighted:** orchestration workflow, reasoning effort, persistent memory (seed + recall).
- **CLI delegations shown:** none (planning stays with the orchestrator).
- **Payoff line:** _"From one sentence to a phased build plan — and Ptah will remember every decision."_
- **CTA:** Next: scaffold the whole Nx workspace from that roadmap.
- **Pitfalls:** Keep discovery answers crisp/pre-scripted so the roadmap is clean; don't let the planning turn ramble — trim.
- **Assets:** roadmap overlay (phases → episodes map), memory-seed callout.

## Episode 02 — Scaffold the Workspace

- **Length / format:** Long-form, 9–11 min.
- **Trial-day badge:** Day 3.
- **Goal:** Turn roadmap Phase 0 into a **green Nx monorepo** — NestJS API shell + Angular web shell, shared libs, module boundaries, lint/test/CI — and show CLI delegates doing the repetitive scaffolding while the orchestrator supervises.
- **Hook (0:00–0:10):** A timer overlay. _"Scaffolding a clean Nx monorepo by hand: an afternoon. With Ptah:"_ → smash-cut to a passing `nx run-many` matrix.
- **Pre-record setup:** Empty TaskFlow workspace + `.ptah/roadmap.md` from E01 present; Node/Nx prereqs installed; orchestrator = Kimi; codex/copilot/ptah-cli reachable.
- **Beat-by-beat:**
  1. Open `/initialize-workspace` (or drive `nx-workspace-architect`); orchestrator reads the roadmap and proposes the lib/app layout (apps vs libs, domain libs, tags).
  2. **Approval flow on camera:** the first workspace-mutating tool call prompts for approval — show accepting it, explain the safety model.
  3. **Delegate the grunt work:** orchestrator spawns CLI agents (`ptah_agent_spawn`) to generate the app/lib skeletons in parallel — narrate Spawn → Poll → Read; results stream back.
  4. Enforce **module boundaries** (Nx tags / lint rules) — show a deliberate cross-boundary import getting flagged.
  5. **Index the new repo:** trigger workspace intelligence so symbol search lights up on freshly generated code; do a quick semantic symbol lookup to prove it.
  6. Close green: `nx run-many -t lint test build`.
- **Skills invoked:** `nx-workspace-architect` (refs: `workspace-setup`, `library-types`, `module-boundaries`), `/initialize-workspace`.
- **Ptah features spotlighted:** 3-tier CLI delegation, approval/permission flow, workspace intelligence (index + symbol search), Nx module-boundary enforcement.
- **CLI delegations shown:** `codex`/`copilot`/`ptah-cli` each generating a lib/app skeleton concurrently.
- **Payoff line:** _"A boundary-enforced Nx monorepo, scaffolded by a team of open-weight agents — green on the first run."_
- **CTA:** Next: model the domain properly with DDD before we write a single endpoint.
- **Pitfalls:** Pre-run once so Nx generator versions/prompts are known; keep terminal font large; if a delegate stalls, cut to the resume pattern rather than dead air; don't let scaffolding logs scroll unreadably — overlay a summary.
- **Assets:** apps/libs dependency-graph overlay (`nx graph`), Spawn→Poll→Read lower-third, boundary-violation red-flag callout.

## Episode 03 — Model the Domain (DDD)

- **Length / format:** Long-form, 10–12 min.
- **Trial-day badge:** Day 4.
- **Goal:** Design TaskFlow's domain layer the right way — bounded contexts (Identity/Tenancy, Projects, Tasks, Billing), entities, aggregates, value objects, domain events, CQRS — using the `ddd-architecture` skill, with **multiple bounded contexts modeled in parallel** on the Canvas.
- **Hook (0:00–0:10):** _"Most AI tools jump straight to CRUD. We're going to model the domain first — like a senior architect would."_
- **Pre-record setup:** Green workspace from E02; roadmap + memory (domain decisions) loaded; Canvas tile layout pre-arranged (one tile per bounded context).
- **Beat-by-beat:**
  1. Orchestrator invokes `ddd-architecture`; agree the **bounded contexts** and the ubiquitous language (pull from memory seeded in E01).
  2. **Canvas multi-tile:** open a tile per context and run agents **in parallel** — each models its aggregates/entities/value-objects (refs: `entities-aggregates`, `value-objects`, `repository-pattern`).
  3. Bump **reasoning effort** for the hardest aggregate (e.g. Task lifecycle invariants) and show the deeper design it produces.
  4. Wire **domain events + CQRS** seams between contexts (refs: `domain-events`, `cqrs-pattern`) — show how Tasks emits events Billing/Projects react to.
  5. **Persist decisions to memory** so later episodes (auth, tasks, billing) inherit the model automatically.
  6. Close green: domain libs compile + unit-level invariant tests pass.
- **Skills invoked:** `ddd-architecture` (refs: `entities-aggregates`, `value-objects`, `repository-pattern`, `domain-events`, `cqrs-pattern`).
- **Ptah features spotlighted:** Canvas multi-tile parallel agents, reasoning-effort control, persistent memory (decision continuity), workspace intelligence (navigate the new domain).
- **CLI delegations shown:** optional — delegate boilerplate value-object/test generation to a CLI agent while the orchestrator focuses on aggregate design.
- **Payoff line:** _"Four bounded contexts, modeled in parallel, by open-weight agents — a domain layer a senior architect would sign off on."_
- **CTA:** Next: real auth and airtight multi-tenant isolation.
- **Pitfalls:** Keep contexts to 3–4 so the Canvas stays readable; pre-decide the ubiquitous language so tiles don't contradict each other on camera; don't let the CQRS explanation balloon — one concrete event flow is enough.
- **Assets:** bounded-context map overlay, Canvas multi-tile split-screen capture, "modeled in parallel" lower-third, event-flow animation (Task → Billing).

## Episode 04 — Auth + Multi-Tenancy

- **Length / format:** Long-form, 10–12 min.
- **Trial-day badge:** Day 6.
- **Goal:** Ship real authentication + airtight tenant isolation on the domain from E03, with two agents working **in parallel** (auth ∥ tenancy) and a **security review** gate before merge.
- **Hook (0:00–0:10):** _"A multi-tenant SaaS has one unforgivable bug: tenant A seeing tenant B's data. Let's make that impossible."_
- **Pre-record setup:** Green workspace + domain layer from E03; Postgres running (`docker:db:start`); Prisma/ZenStack ready; orchestrator = Kimi.
- **Beat-by-beat:**
  1. `/orchestrate` the feature; orchestrator splits it into two tracks from `nestjs-backend-patterns` (refs: `authentication`, `authorization`, `multitenancy`, `prisma-zenstack`).
  2. **Parallel agents:** one builds auth (login/session/guards), one builds tenancy (row-level isolation, tenant context middleware) — Canvas or background tracks.
  3. Show **ZenStack/Prisma policies** enforcing tenant scoping at the data layer, not just in services.
  4. **Security review pass:** run `/review-security` on the diff; surface a deliberately-planted isolation gap and watch it get caught + fixed.
  5. Prove isolation with a cross-tenant access test that **fails closed** (403/empty), then close green.
- **Skills invoked:** `nestjs-backend-patterns` (`authentication`, `authorization`, `multitenancy`, `prisma-zenstack`), `orchestration`, `/review-security`.
- **Ptah features spotlighted:** parallel agents, security review, approval flow on schema/migration writes.
- **CLI delegations shown:** delegate the auth e2e test suite to a CLI agent while the orchestrator hardens tenancy.
- **Payoff line:** _"Auth and tenant isolation, built in parallel and security-reviewed — cross-tenant access fails closed."_
- **CTA:** Next: the heart of the app — the Tasks engine, with realtime.
- **Pitfalls:** Pre-seed two tenants with data so the isolation test is visual; never show real secrets/JWT contents; keep the planted-bug reveal honest (label it as an intentional demo).
- **Assets:** two-track split capture, tenant-isolation diagram, `/review-security` findings card, "fails closed" green-check overlay.

## Episode 05 — The Tasks Engine

- **Length / format:** Long-form, 11–13 min.
- **Trial-day badge:** Day 8.
- **Goal:** Build Tasks CRUD + real-time updates (SSE) on a resilient service architecture — and use this episode to spotlight **background workspaces**, **Rewind/fork**, and the **in-app editor** (Monaco/xterm/git).
- **Hook (0:00–0:10):** _"This is the feature users actually touch. So we build it to survive production — retries, events, realtime, the works."_
- **Pre-record setup:** Auth + tenancy from E04 merged + green; a second throwaway workspace folder ready to demo background switching.
- **Beat-by-beat:**
  1. Orchestrator applies `resilient-nestjs-patterns` (refs: `domain-service-layering`, `service-orchestration`, `event-driven-architecture`, `retry-and-fallback`, `dynamic-modules`) to design the Tasks module.
  2. Build CRUD with the Controller → Service → DbService layering; wire **domain events** (TaskCreated/TaskMoved) to an **SSE** stream for realtime board updates.
  3. **Rewind/fork:** at a design fork (optimistic vs server-authoritative updates), fork the conversation to try the alternative, compare, keep the winner — same tab/tile.
  4. **Background workspaces:** kick off the long build/test run, switch to the second workspace to start planning E06, then switch back — the Tasks run kept streaming.
  5. **In-app editor spotlight:** open a generated file in Monaco, tweak in the integrated xterm terminal, review the diff via the git panel.
  6. Add **retry + fallback** around the flaky bit (e.g. notification side-effect); close green with realtime working in two browser tabs.
- **Skills invoked:** `resilient-nestjs-patterns` (all five refs above).
- **Ptah features spotlighted:** background-workspace streaming, Rewind/transparent fork, Monaco/xterm/git editor, event-driven + SSE.
- **CLI delegations shown:** delegate repetitive DTO/validation + unit tests to a CLI agent.
- **Payoff line:** _"A production-grade Tasks engine with realtime — and Ptah never dropped a beat when I switched projects mid-build."_
- **CTA:** Next: turn this into a business — billing and webhooks.
- **Pitfalls:** Pre-stage two browser tabs for the realtime reveal; keep the fork comparison short (one screen each); make sure the background run is genuinely long enough to switch away and back.
- **Assets:** realtime two-tab capture, fork before/after split, background-workspace "still streaming" badge, editor close-up.

## Episode 06 — Monetize: Billing + Webhooks

- **Length / format:** Long-form, 11–13 min.
- **Trial-day badge:** Day 11.
- **Goal:** Add freemium + paid tiers, a webhook-driven subscription state machine, and a pre-checkout/portal flow — then **test the live checkout in-app with the MCP browser tool**.
- **Hook (0:00–0:10):** _"A SaaS isn't a SaaS until someone can pay you. Let's wire money — the resilient way."_
- **Pre-record setup:** Tasks engine from E05 merged; a sandbox payment provider account (test mode) + webhook endpoint reachable; orchestrator = Kimi.
- **Beat-by-beat:**
  1. `saas-platform-patterns` (refs: `freemium-model`, `subscription-state-machine`, `license-lifecycle`, `checkout-and-portal`) to design tiers + the trial→paid→past-due→canceled state machine.
  2. **Parallel agents:** one builds the subscription state machine, one builds the webhook ingress.
  3. `webhook-architecture` (refs: `three-layer-pattern`, `signature-verification`, `resilience-and-recovery`) for the 3-layer handler — signature verification + idempotency on the webhook path.
  4. **MCP browser tool:** drive the checkout in a real browser from inside Ptah — complete a test purchase, watch the webhook flip the subscription state live.
  5. Prove **idempotency**: replay the same webhook, show no double-charge/double-grant; gate a premium feature behind the paid tier.
  6. Close green with a tier-gated Tasks limit enforced.
- **Skills invoked:** `saas-platform-patterns`, `webhook-architecture`.
- **Ptah features spotlighted:** MCP browser automation, parallel agents, subscription state machine, idempotent webhook handling.
- **CLI delegations shown:** delegate webhook fixture/replay test generation to a CLI agent.
- **Payoff line:** _"Freemium, paid, and webhook-driven billing — signature-verified, idempotent, and tested end-to-end in the browser without leaving Ptah."_
- **CTA:** Next: give it a face — the frontend and a landing page.
- **Pitfalls:** Test-mode keys only, never on screen; pre-verify the webhook tunnel; keep the state-machine diagram on screen as the source of truth so viewers don't get lost.
- **Assets:** subscription state-machine animation, MCP-browser checkout capture, webhook-replay idempotency overlay, tier-gate callout.

## Episode 07 — The Frontend

- **Length / format:** Long-form, 11–13 min.
- **Trial-day badge:** Day 14.
- **Goal:** Build the Angular app (task board, auth, billing screens) plus a polished marketing landing page — using the Angular skills + the design-system skill, with UI pieces built **in parallel** on the Canvas.
- **Hook (0:00–0:10):** _"The backend's done. Now let's make something people actually want to look at — fast."_
- **Pre-record setup:** Full backend (E04–E06) green + running; Angular web shell from E02; brand inputs (logo/palette) ready or to be generated.
- **Beat-by-beat:**
  1. `ui-ux-designer` to lock a small **design system** (tokens, type scale, components) from the product's brand.
  2. `angular-frontend-patterns` (refs: `component-patterns`, `forms-patterns`, `rxjs-patterns`) for signal-based, OnPush, smart/dumb structure; build the **task board** wired to the SSE stream from E05.
  3. **Canvas multi-tile:** build auth screens, billing/portal screens, and the board **in parallel** tiles.
  4. **Landing page:** `angular-gsap-animation-crafter` (+ optionally `angular-3d-scene-crafter`) for a scroll-animated hero that sells TaskFlow.
  5. Close green: app builds, board updates in realtime, landing page animates.
- **Skills invoked:** `ui-ux-designer`, `angular-frontend-patterns`, `angular-gsap-animation-crafter`, `angular-3d-scene-crafter` (optional).
- **Ptah features spotlighted:** Canvas multi-tile parallel UI work, design-system generation, GSAP/3D animation skills.
- **CLI delegations shown:** delegate component scaffolding / story files to CLI agents.
- **Payoff line:** _"A signal-based Angular app and an animated landing page — designed and built in parallel by open-weight agents."_
- **CTA:** Next: stop and harden everything with a triple review.
- **Pitfalls:** Don't over-scope the UI — board + 2 screens + hero is enough; keep the design-system reveal tight; ensure realtime board demo reuses the E05 setup so it "just works."
- **Assets:** design-system board overlay, Canvas parallel-UI capture, landing-page scroll capture, before/after polish.

## Episode 08 — Quality Gate: Triple Review

- **Length / format:** Long-form, 9–11 min.
- **Trial-day badge:** Day 16.
- **Goal:** Run the full **triple-review protocol** (code → logic → security) across the codebase, fix the findings, and use this long session to spotlight **compaction** (`/compact`) and the no-cost-meter payoff. NOTE: `/context` and `/cost` are **Anthropic-only** and do not run on the open-weight orchestrator — do not script them.
- **Hook (0:00–0:10):** _"Shipping fast is easy. Shipping fast AND clean is the whole game. Three reviewers, one codebase."_
- **Pre-record setup:** Full app (E04–E07) green; intentionally leave a few real smells in (dead code, a missing validation, an N+1) for the reviewers to catch.
- **Beat-by-beat:**
  1. `/review-code` (style/standards) → `/review-logic` (stubs, dead data, tech debt) → `/review-security` (OWASP) in sequence; show each producing scored findings.
  2. Triage findings; **delegate fixes** to CLI agents in parallel, orchestrator verifies each.
  3. The session is now long — trigger **compaction** (`/compact`); use the UI context indicator (not `/context`, which is Anthropic-only) for the before/after visual, and continue without losing the thread.
  4. The no-cost-meter beat — there is **no `/cost`** to run on an open-weight provider; reframe that absence as the **"$0 to closed models"** payoff.
  5. Close green: re-run the three reviews, findings resolved.
- **Skills invoked:** `/review-code`, `/review-logic`, `/review-security`; code-style + code-logic reviewers.
- **Ptah features spotlighted:** triple review, compaction (`/compact`), MCP diagnostics, parallel fix delegation. (`/context` + `/cost` are Anthropic-only — out of scope on open weights.)
- **CLI delegations shown:** one CLI agent per review dimension's fix batch.
- **Payoff line:** _"Three independent reviewers, every finding fixed and re-verified — and the whole marathon ran inside one compacted session."_
- **CTA:** Next: make it run itself — schedules, gateway, voice.
- **Pitfalls:** Use real (not fabricated) findings; keep the planted smells modest and honest; don't let the three reviews feel repetitive — cut to the unique catch from each.
- **Assets:** triple-review score cards, compaction "before/after context" overlay, "$0 to closed AI labs" lower-third (held on the open-weight badge — no cost command).

## Episode 09 — Always-On Ops

- **Length / format:** Long-form, 10–12 min.
- **Trial-day badge:** Day 19.
- **Goal:** Make TaskFlow's maintenance run without you — scheduled agent jobs (cron) — and drive Ptah remotely via the **messaging gateway** (Discord/Telegram/Slack) including **voice** and the "code from your phone" moment.
- **Hook (0:00–0:10):** _"What if your project kept improving while you slept — and you could ship a fix from your phone at a coffee shop?"_
- **Pre-record setup:** App green; a Discord (or Telegram/Slack) bot connected per the gateway integration kit; phone on camera/screen-mirror; microphone for voice.
- **Beat-by-beat:**
  1. **Cron scheduler (Schedules tab):** create a nightly job — dependency check + test run + changelog draft; show the slot-claim run and its output.
  2. **Messaging gateway (Gateway tab):** connect Discord; from a channel, message Ptah to start a session; it replies with progress (multi-session, per-thread).
  3. **Code from your phone:** on the phone, send a small real fix request; Ptah works it and reports back — show the commit.
  4. **Voice:** speak a request through the gateway; show transcription → action.
  5. Recap the always-on loop: scheduled upkeep + remote control + voice.
- **Skills invoked:** none required (feature-led episode).
- **Ptah features spotlighted:** cron scheduler, messaging gateway (Discord/Telegram/Slack), multi-session gateway, voice, remote/phone control.
- **CLI delegations shown:** optional — the scheduled job delegates the dependency-bump grunt work to a CLI agent.
- **Payoff line:** _"Scheduled upkeep, remote control from Discord, and a fix shipped from my phone — all on open weights."_
- **CTA:** Next: deploy it to the cloud.
- **Pitfalls:** Pre-connect the bot (don't burn screen time on token setup — reference E-kit); never show bot tokens; have the phone shot framed and tested; keep voice clip short and clear.
- **Assets:** Schedules-tab run capture, Discord conversation capture, phone-in-frame shot, voice waveform overlay.

## Episode 10 — Ship It (Deploy)

- **Length / format:** Long-form, 10–12 min.
- **Trial-day badge:** Day 22.
- **Goal:** Take TaskFlow to production — multi-stage Docker, webpack externals bundling, database migration strategy, and production hardening — with devops grunt work delegated to CLI agents.
- **Hook (0:00–0:10):** _"localhost is a hobby. Let's make this real — live, on the internet, hardened."_
- **Pre-record setup:** Full reviewed app from E08; a target host/registry account ready (test); secrets in a vault, not on screen.
- **Beat-by-beat:**
  1. `nestjs-deployment` (refs: `docker-multistage`, `webpack-bundling`, `database-migrations`, `production-hardening`) to generate the Dockerfiles + build config.
  2. **Migrations strategy:** show the deploy-time Prisma migration flow (safe, ordered).
  3. **Production hardening:** Helmet/CORS/throttler/validation pipe checklist applied + verified.
  4. **Delegate the pipeline:** CLI agents wire the CI/CD + container build steps while orchestrator supervises.
  5. Deploy; hit the live URL; run a smoke test (sign up → create task → realtime) against production.
- **Skills invoked:** `nestjs-deployment`.
- **Ptah features spotlighted:** devops CLI delegation, MCP (live smoke check), approval flow on deploy steps.
- **CLI delegations shown:** CI/CD + Docker build wiring delegated to codex/copilot/ptah-cli.
- **Payoff line:** _"From localhost to a hardened, containerized production deploy — TaskFlow is live."_
- **CTA:** Next: teach Ptah everything we just learned so the next build is even faster.
- **Pitfalls:** Use a disposable deploy target; never expose prod secrets; pre-validate the migration on a throwaway DB; keep the deploy logs summarized on screen.
- **Assets:** multi-stage Docker diagram, "LIVE" URL reveal, production smoke-test capture, hardening checklist overlay.

## Episode 11 — Teach Ptah Your Stack

- **Length / format:** Long-form, 9–11 min.
- **Trial-day badge:** Day 25.
- **Goal:** Turn everything learned in this build into reusable assets — let Ptah **synthesize a skill** from the build trajectory, **author a custom skill** with `skill-creator`, curate the **Memory** tab, and assemble a reusable **harness** for the next project.
- **Hook (0:00–0:10):** _"The best part of this whole build: Ptah just got better at building the next one."_
- **Pre-record setup:** Completed, deployed TaskFlow; sessions/trajectories from prior episodes present so synthesis has material.
- **Beat-by-beat:**
  1. **Skill synthesis (Skills tab):** show Ptah extracting a candidate skill from the build's trajectory (e.g. "TaskFlow-style multi-tenant module") — review the judged candidate.
  2. **`skill-creator`:** hand-author a polished custom skill (your stack's conventions) and validate it.
  3. **Memory tab curation:** review/prune what Ptah learned across the build; confirm it persists for the next project.
  4. **Harness builder:** assemble a reusable harness that bundles your skills + delegate setup for the next SaaS.
  5. Quick proof: start a fresh scratch project and watch the new skill/harness kick in immediately.
- **Skills invoked:** `skill-creator` (+ the synthesized skill).
- **Ptah features spotlighted:** skill synthesis, skill-creator, Memory tab, harness builder, the clone→curate→enhance learning loop.
- **CLI delegations shown:** none required (this is the meta/learning episode).
- **Payoff line:** _"Ptah didn't just build my SaaS — it learned my stack, and the next build starts miles ahead."_
- **CTA:** Finale: the full journey + how you do this in your trial.
- **Pitfalls:** Make sure prior sessions exist so synthesis isn't empty; keep the authored skill small and real; show the "next project benefits" proof, don't just assert it.
- **Assets:** skill-synthesis candidate card, skill-creator authoring capture, Memory-tab before/after, harness-builder stream.

## Episode 12 — Finale + Trial CTA

- **Length / format:** Long-form, 6–8 min.
- **Trial-day badge:** Day 28 → "and you have 72 more."
- **Goal:** Recap the entire journey, drive home the **open-weights / $0-closed-models** thesis, and invite viewers to build _their_ SaaS in their free trial.
- **Hook (0:00–0:10):** Rapid montage of every milestone (scaffold → domain → auth → tasks → billing → frontend → deploy) under a single line: _"One trial. One open-weight brain. One real, shipped SaaS."_
- **Pre-record setup:** All episodes recorded; pull the best 2–3s beats from each; final cost/stat numbers ready.
- **Beat-by-beat:**
  1. Montage recap mapped to the episode arc.
  2. The numbers on screen: days used, `$0` to closed models, features used (tie back to the coverage matrix).
  3. What this proves: open weights + Ptah + skills = production SaaS, solo.
  4. **CTA:** start the free trial, install the skills, follow the series to build along; link the repo/roadmap template.
- **Skills invoked:** `technical-content-writer` (to draft the recap script + CTA copy).
- **Ptah features spotlighted:** the whole-journey montage (every feature, called back).
- **CLI delegations shown:** n/a.
- **Payoff line:** _"You just watched a SaaS get built and shipped on open weights. Your trial starts now — build yours."_
- **CTA:** Trial signup + "start with Episode 00" loop-back.
- **Pitfalls:** Keep it tight and earned — no new features here; make the CTA specific and single (one action).
- **Assets:** full montage, stats card, trial-CTA end screen, series playlist link.

---

## Series status tracker

| Episode            | Plan | Recorded |
| ------------------ | ---- | -------- |
| E00 Setup & thesis | ✅   | ☐        |
| E01 Idea → roadmap | ✅   | ☐        |
| E02 Scaffold       | ✅   | ☐        |
| E03 Domain (DDD)   | ✅   | ☐        |
| E04 Auth + tenancy | ✅   | ☐        |
| E05 Tasks engine   | ✅   | ☐        |
| E06 Monetize       | ✅   | ☐        |
| E07 Frontend       | ✅   | ☐        |
| E08 Triple review  | ✅   | ☐        |
| E09 Always-on ops  | ✅   | ☐        |
| E10 Ship it        | ✅   | ☐        |
| E11 Teach Ptah     | ✅   | ☐        |
| E12 Finale         | ✅   | ☐        |
