# Series Headlines — live-demo cue cards

One-glance talking points per episode for the live "Build a SaaS on open weights with Ptah" series.
You drive the app live and point out the UI yourself, so these are cue cards to riff off — not
word-for-word scripts. Full scripts live alongside in `E00`–`E12`. Tone: plain, honest, no hype —
show the work and let viewers decide.

Constant: **Ptah Desktop (Electron) · main model = Kimi (open weight, Ollama Cloud) · CLI agents = codex / copilot / ptah-cli · product = TaskFlow (Nx + NestJS + Angular).**

---

## Trailer — hook reel (13 one-liners, back to back)

1. Setting up: an open-weight model and a few CLI agents, in one desktop app.
2. Turning a one-line idea into an actual project plan.
3. Scaffolding the Nx workspace — and handing the repetitive parts to CLI agents.
4. Modelling the domain before writing any endpoints.
5. Auth, and keeping one tenant's data away from another's.
6. The tasks feature, with real-time updates.
7. Adding plans, payments, and billing webhooks.
8. Building the front end and a landing page.
9. Running the code through three review passes.
10. Scheduling jobs, and driving it from Discord — or my phone.
11. Packaging it and deploying it.
12. Turning what we learned into reusable skills.
13. What got built, what it cost, and how to try it yourself.

---

## E00 — Setup · Day 1

**Open:** "Building a SaaS on open-weight models instead of a closed one. This video is just setup."

- Install + first launch → setup wizard
- Provider → Ollama Cloud + Kimi → send a turn, badge shows the model
- The CLI agents: codex / copilot / ptah-cli, and how work gets handed off
- Why open weights — as a trade-off (cost, data, vendor lock-in), not a claim it's better
  **Close:** "That's the setup. Nothing built yet — just the bench."

## E01 — Idea → Roadmap · Day 2

**Open:** "Taking a one-line idea and turning it into a plan I can actually follow."

- `/orchestrate` discovery Q&A
- Reasoning effort up for planning (and what that trades off)
- Phased `.ptah/roadmap.md` — the plan for the rest of the series
- Save the goals + "open weights only" to Memory
  **Close:** "A one-line idea, now a plan to follow."

## E02 — Scaffold the Workspace · Day 3

**Open:** "Setting up the Nx workspace, and handing the repetitive parts to CLI agents."

- `/initialize-workspace` proposes the apps/libs layout
- Approval prompt on the first change to disk
- CLI agents generate skeletons in parallel
- Module boundaries (show one getting flagged)
- Index the repo → symbol search → `nx run-many` green
  **Close:** "A working Nx monorepo, scaffolded mostly by the agents."

## E03 — Model the Domain (DDD) · Day 4

**Open:** "Modelling the domain before writing endpoints — I find it saves rework later."

- `ddd-architecture` → agree the bounded contexts (pull language from Memory)
- Canvas multi-tile: a context per tile, worked in parallel
- Reasoning effort up for the trickiest aggregate (task lifecycle)
- Domain events + CQRS between contexts (Task → Billing)
- Save the decisions to Memory
  **Close:** "A domain model to build the rest on."

## E04 — Auth + Multi-Tenancy · Day 6

**Open:** "Adding auth, and making sure one tenant can't see another's data."

- `nestjs-backend-patterns` → auth and tenancy as two parallel tracks
- ZenStack/Prisma policies scope data at the DB layer
- `/review-security` on the diff catches a gap I left in on purpose (I'll say so)
- Cross-tenant access test returns nothing
  **Close:** "Auth in place, and cross-tenant access blocked."

## E05 — The Tasks Engine · Day 8

**Open:** "Building the tasks feature, with live updates."

- `resilient-nestjs-patterns` → layered services, domain events, SSE
- Rewind/fork to try a second design and compare
- Background workspace: start another project while the build runs, come back
- The editor: Monaco, terminal, git diff in one place
- Retry/fallback on the flaky part → two tabs update live
  **Close:** "Tasks working, with live updates across tabs."

## E06 — Monetize · Day 11

**Open:** "Adding plans, payments, and the webhooks that keep subscriptions in sync."

- `saas-platform-patterns` → tiers + subscription state machine
- `webhook-architecture` → 3-layer handler, signature check, idempotency
- MCP browser runs a test checkout → webhook updates the state on screen
- Replay the webhook → no double-charge → gate a feature behind the paid tier
- (Test-mode keys only; I'll keep them off screen)
  **Close:** "Plans and payments wired up and tested."

## E07 — The Frontend · Day 14

**Open:** "Building the front end and a landing page."

- `ui-ux-designer` → a small design system to work from
- `angular-frontend-patterns` → a task board wired to the live updates from E05
- Canvas multi-tile: auth, billing, and board screens in parallel
- `angular-gsap` → a scroll-animated landing hero
  **Close:** "A usable front end and a landing page."

## E08 — Quality Gate · Day 16

**Open:** "Running the whole thing through three review passes before moving on."

- `/review-code` → `/review-logic` → `/review-security` (real findings + one I planted, labeled)
- Hand the fixes to CLI agents, one batch per pass
- Long session → `/compact` to keep it going (UI context indicator for before/after)
- On cost: there's no `/cost` to run on open weights — `/context` and `/cost` are Anthropic-only. I'll just note what the run actually used.
- Re-run all three → clean
  **Close:** "Three review passes done, findings fixed."

## E09 — Always-On Ops · Day 19

**Open:** "Scheduling some upkeep, and driving Ptah from Discord — and my phone."

- Cron (Schedules tab): a nightly deps + tests + changelog job
- Gateway (Discord/Telegram/Slack): start a session from a channel
- Send a small fix request from my phone → the change comes back
- Voice: speak a request → it's transcribed and acted on
  **Close:** "Some upkeep automated, and remote control working."

## E10 — Ship It · Day 22

**Open:** "Packaging the app and deploying it."

- `nestjs-deployment` → multi-stage Docker + bundling
- Migration strategy for deploy time
- Production hardening pass (Helmet/CORS/throttler/validation)
- Hand the CI/CD wiring to CLI agents → live URL → smoke test
  **Close:** "Running in the cloud."

## E11 — Teach Ptah Your Stack · Day 25

**Open:** "Turning what we did into something reusable for the next project."

- Skill synthesis (Skills tab): pull a skill out of the build's history
- `skill-creator` → write a custom skill for this stack
- Tidy up the Memory tab
- Harness builder → bundle the skills + agent setup
- Quick check that a fresh project picks them up
  **Close:** "A couple of reusable skills for next time."

## E12 — Wrap-Up · Day 28 (72 left)

**Open:** "What got built, what it cost, and how to try it yourself."

- Recap mapped to the build
- The numbers: days used, what the run cost, features covered
- What it does and doesn't show about building on open weights
- If it's useful to you: how to start the trial and follow along
  **Close:** "That's the build. Try it if it fits how you work."
