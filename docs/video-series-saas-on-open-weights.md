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
| 08  | Quality gate           | Hardened, reviewed codebase                        | `/review-code`, `/review-logic`, `/review-security`             | Triple review, code reviewers, compaction + `/context` + `/cost`, MCP diagnostics             |
| 09  | Always-on ops          | Scheduled jobs + remote control                    | —                                                               | Cron scheduler, messaging gateway (Discord/Telegram/Slack), voice, "code from your phone"     |
| 10  | Ship it                | Deployed to cloud                                  | `nestjs-deployment`                                             | Docker multistage, migrations, production hardening, devops delegation                        |
| 11  | Teach Ptah your stack  | Custom reusable skill + curated memory             | `skill-creator`                                                 | Skill synthesis (learns from the build), Memory tab, harness builder                          |
| 12  | Finale + trial CTA     | Recap + viewer call-to-action                      | `technical-content-writer`                                      | Whole-journey montage; "$0 on closed models"; build-yours-in-your-trial CTA                   |

---

## Feature-Coverage Matrix (proof every feature is demoed)

| Ptah feature                                     | Episode(s)                 |
| ------------------------------------------------ | -------------------------- |
| Open-weight / Ollama provider config             | 00                         |
| Setup wizard                                     | 00                         |
| Orchestrator main chat                           | all                        |
| `/orchestrate` workflow                          | 01, 04, 05, 06             |
| Shipped skills (each)                            | 01–07, 10, 11              |
| 3-tier CLI delegation (codex/copilot/ptah-cli)   | 02, 04, 06, 10             |
| Canvas multi-tile (parallel agents)              | 03, 07                     |
| Background workspaces                            | 05                         |
| Rewind / transparent fork                        | 05                         |
| Persistent memory                                | 01, 11                     |
| Skill synthesis                                  | 11                         |
| skill-creator (author a skill)                   | 11                         |
| Harness builder                                  | 11                         |
| Cron scheduler                                   | 09                         |
| Messaging gateway + voice + "from your phone"    | 09                         |
| Reasoning effort control                         | 01, 03                     |
| Compaction + `/context` + `/cost`                | 08                         |
| Triple review + code reviewers                   | 08                         |
| Workspace intelligence (AST/symbol index/search) | 02, 03                     |
| MCP tools (browser / deps / diagnostics)         | 06, 08                     |
| Editor (Monaco / xterm / git)                    | 05 (spotlight), throughout |
| Approval / permission flow                       | 02, 04                     |

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
