# E01 — Idea → Roadmap — Full Script

**Length:** 9–11 min · **Trial day:** Day 2 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Turn "I want a task-manager SaaS" into a concrete, phased `.ptah/roadmap.md` and seed Ptah's memory with project goals and constraints.
**Controlling thesis:** The most expensive mistake in software is starting to build before you know what you're building.

## Pre-record checklist

- E00 green state: Ptah Desktop running, Kimi badge confirmed, CLI delegates wired.
- Empty `TaskFlow` workspace folder open in Ptah Desktop — no files yet.
- Orchestrator confirmed as Kimi; model badge visible in chat.
- Discovery answers pre-scripted (framework: Nx + NestJS + Angular; scope: multi-tenant task manager; billing: freemium + paid; open weights only constraint).
- Memory tab accessible and empty/clean for the seed demo.
- Reasoning effort control visible in the UI. [VERIFY exact location on camera.]

## Assets / overlays

- Trial-day counter: "Day 2 / 100".
- Roadmap phases → episodes map overlay (phases become the series arc).
- Memory-seed callout graphic: "Decision saved to memory."
- Reasoning effort callout: "Effort → High (planning mode)."

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat, open-weight model badge visible in the corner. Kimi badge glowing. Empty TaskFlow workspace.
- **VO:** "Day two. The rig is live. Open-weight orchestrator, CLI delegates, and a blank folder. Today I want to turn one sentence into a concrete, phased roadmap."
- **ON-SCREEN:** "Day 2 / 100"

### [00:20–01:00] The single sentence

- **VISUAL:** Chat input in focus. Typing a single line.
- **VO:** "I type one sentence: 'I want to build a multi-tenant task-manager SaaS — projects, tasks, teams, real-time updates, and freemium billing.' That's the starting point."
- **VISUAL:** Message sends. Kimi begins responding — but we're not going straight to output. Show the orchestration skill being invoked.
- **ON-SCREEN:** Typed sentence visible in chat bubble.
- **VO:** "Before Kimi runs with it, I'm going to route it through the right skill."

### [01:00–02:00] Invoking `/orchestrate` and `init-saas`

- **VISUAL:** In chat, type `/orchestrate` — the orchestration skill activates. Show the skill name appear in the UI. [VERIFY how `/orchestrate` visually surfaces in the Ptah Desktop chat.]
- **VO:** "This is the `/orchestrate` skill — a structured workflow that breaks a product idea into phases, asks discovery questions, and produces something you can build against. For a SaaS specifically, I'm pointing it at the `init-saas` path — the SaaS workspace initializer."
- **ON-SCREEN (lower-third):** "Skill: /orchestrate → init-saas"
- **VO:** "What you'll see next are discovery questions. I've thought about my answers in advance — because the quality of the roadmap tracks the quality of what you tell it."

### [02:00–03:30] Discovery questions — answering crisp

- **VISUAL:** Kimi surfaces discovery questions one by one. Viewer can read them. Pause briefly on each.
- **VO:** "Framework. Nx monorepo — NestJS for the API, Angular for the web. That's non-negotiable; we want real module boundaries."
- **VISUAL:** Answer types in.
- **VO:** "Multi-tenancy model. Full row-level isolation — tenant A cannot see tenant B's data. Hard requirement."
- **VISUAL:** Next answer.
- **VO:** "Billing. Freemium tier, then a paid subscription, webhook-driven state machine. Real money, real complexity."
- **VISUAL:** Final constraint answer.
- **VO:** "And here's the constraint that shapes everything: open-weight models only. No closed APIs. Ptah's going to remember that for the life of this project."
- **ON-SCREEN (lower-third):** "Discovery: framework · tenancy · billing · model constraint"

### [03:30–05:00] Bumping reasoning effort for the planning turn

- **VISUAL:** Before submitting the final discovery answers, locate and adjust the reasoning effort control. Dial it up to a higher setting. [VERIFY exact reasoning effort UI location and control name on camera.]
- **VO:** "Before I submit these, one more thing — the reasoning effort control. For most coding tasks, default is fine and fast. For planning, I want Kimi to work through dependencies, risks, and phase ordering more carefully, so I'm bumping it up."
- **ON-SCREEN (callout):** "Effort → High (planning mode)"
- **VO:** "It'll take a bit longer. The trade-off is a more thorough phase breakdown."
- **VISUAL:** Submit. Show Kimi working — longer generation, model token activity visible.
- **VO:** "And now we wait. Not long."

### [05:00–06:45] The roadmap arrives — walk the phases

- **VISUAL:** `.ptah/roadmap.md` is produced. Show it rendering in the chat and/or file tree. Scroll through it.
- **VO:** "There it is. A phased roadmap with explicit deliverables and a dependency order."
- **VISUAL:** Highlight the phases overlay. Camera lingers on phase names.
- **VO:** "Phase zero: scaffold the workspace — an Nx monorepo with library boundaries before any business logic. Phase one: model the domain with DDD — bounded contexts, aggregates, domain events. Phase two: auth and multi-tenancy — tenant isolation at the data layer. Then tasks, billing, frontend, quality gate, deploy. Each phase maps to an episode."
- **ON-SCREEN:** Roadmap phases → episodes map overlay appears.
- **VO:** "The constraint we gave it — open weights only — is in the document. Every agent that reads this roadmap later will see it."
- **VISUAL:** Pan to the bottom of the roadmap where constraints are listed.

### [06:45–08:10] Seed memory with decisions

- **VISUAL:** Navigate to the Memory tab in Ptah Desktop (Electron sidebar). [VERIFY exact navigation path to the Memory tab on camera.]
- **VO:** "The roadmap lives in a file — but Ptah has a second layer of persistence: the Memory tab. This is where I plant the decisions that every future session needs to inherit automatically."
- **VISUAL:** Add a memory entry. Type in the product goal.
- **VO:** "Product goal: a multi-tenant SaaS task manager. Phased build — scaffold first, domain second."
- **ON-SCREEN (callout):** "Decision saved to memory."
- **VISUAL:** Add the stack decision.
- **VO:** "Stack: Nx, NestJS, Angular, Prisma, Postgres. No negotiation."
- **VISUAL:** Add the model constraint.
- **VO:** "And the constraint: open-weight models only throughout the build. Every session that opens this project will see that."
- **VISUAL:** Show the memory entries persisted and listed.
- **VO:** "Open a fresh session, scroll back up to memory, and they're there. Kimi pulls these in automatically — decisions made on day two are available on day twenty-five."
- **ON-SCREEN (lower-third):** "Memory seeded: goals · stack · model constraint"

### [08:10–09:00] Payoff + milestone check

- **VISUAL:** Show `.ptah/roadmap.md` open in the file tree. Roadmap visible, memory tab populated.
- **VO:** "One sentence in, a phased roadmap out, memory seeded. We answered seven discovery questions — the skill did the phase ordering and constraint tracking. This ran on Kimi, an open-weight model, so there's no per-token cost to a hosted API. Whether that trade-off matters to you depends on your situation — there are steps in this series where a closed model would have handled things more smoothly."

### [09:00–09:45] CTA / End screen

- **VISUAL:** Ptah Desktop with roadmap visible, memory populated, chat idle. Cursor resting.
- **VO:** "Next episode, we take Phase zero of that roadmap and scaffold an Nx monorepo — NestJS API shell, Angular web shell, shared libs, module boundaries, lint, test, CI. The repetitive generation goes to CLI delegates. See you in episode two."
- **ON-SCREEN:** End card — "Next: Scaffold the Workspace" · "Day 3 / 100" · subscribe/playlist link.

---

## Shot list (quick capture summary)

1. Cold open: Ptah Desktop, model badge visible, empty TaskFlow workspace.
2. Single-sentence input in chat.
3. `/orchestrate` skill activation — skill name surfacing in UI.
4. Discovery questions scrolling through — pause on each answer.
5. Reasoning effort control — locate, dial up, callout overlay.
6. Kimi working (longer generation, token activity).
7. `.ptah/roadmap.md` rendering in chat / file tree — scroll through phases.
8. Roadmap phases → episodes map overlay.
9. Memory tab — navigate to it.
10. Three memory entries being added (goal, stack, constraint).
11. Memory entries persisted and listed — recalled in a fresh context.
12. End card.

## [VERIFY] flags

- Exact Ptah Desktop UI location and control name for "reasoning effort" — how it surfaces in the chat (slider, dropdown, button, etc.) and what the available levels are called.
- Exact visual behavior when `/orchestrate` (or `init-saas`) is invoked in chat — does it show a skill card, a banner, a prefix in the message? Confirm the on-screen label to reference in VO.
- How the `init-saas` discovery question flow looks on screen — does Kimi ask all questions upfront in one block, or turn-by-turn? Adjust beats 4a–4d accordingly.
- Exact navigation path to the Memory tab in Ptah Desktop Electron sidebar.
- Whether `.ptah/roadmap.md` appears in the file tree automatically after generation, or requires navigating to it — adjust VO at [05:00] accordingly.
- Current free-trial length wording — confirm "/ 100" counter framing matches production UI.
