# E03 — Model the Domain (DDD) — Full Script

**Length:** 10–12 min · **Trial day:** Day 4 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Design TaskFlow's domain layer — bounded contexts, entities, aggregates, value objects, domain events, CQRS — using the `ddd-architecture` skill, with multiple bounded contexts modeled in parallel on the Canvas.
**Controlling thesis:** Skipping domain modeling is borrowing technical debt at a very high interest rate.

## Pre-record checklist

- E02 green state: Nx monorepo scaffolded, lint/test/build green, workspace intelligence indexed.
- Memory tab populated with roadmap goals, stack, model constraint, and domain context names (Identity/Tenancy, Projects, Tasks, Billing).
- Canvas tile layout pre-arranged: four tiles, one per bounded context. [VERIFY how to pre-arrange Canvas tiles in Ptah Desktop before recording — manual drag or layout preset.]
- Reasoning effort control accessible and tested.
- Pre-decide the ubiquitous language for each context so on-camera tiles don't contradict each other (prepare a one-page cheat sheet off-camera).
- Identify the "hardest aggregate" for the reasoning effort demo — use Task lifecycle (Created → InProgress → Blocked → Done) with its invariants.
- A CLI agent smoke-tested for delegating boilerplate value-object and test generation.
- Keep context count to four: Identity/Tenancy, Projects, Tasks, Billing. Do not expand on camera.

## Assets / overlays

- Trial-day counter: "Day 4 / 100".
- Bounded-context map overlay (static diagram, four contexts with explicit boundaries and integration points).
- Canvas multi-tile split-screen capture label: "Modeled in parallel."
- Reasoning effort callout: "Effort → High (aggregate design)."
- Event-flow animation: Task context emits `TaskMoved` → Projects context reacts → Billing context checks quota.
- Memory-save callout: "Domain decision saved to memory."

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat, Kimi badge visible. Green Nx workspace file tree from E02 in the background. Model badge prominent.
- **VO:** "Day four. The workspace is green. Before we write any endpoint logic, I want to model the domain — bounded contexts, aggregates, domain events — so the code has something to build against."
- **ON-SCREEN:** "Day 4 / 100"

### [00:20–01:10] Why domain modeling before code

- **VISUAL:** Hold on the workspace file tree — mostly empty domain libs. Camera lingers.
- **VO:** "These domain lib folders are empty. We could start filling them with services and controllers right now. But in a multi-tenant SaaS, the shape of the domain — what's a tenant, what's a member, how a task moves through its lifecycle — affects the data model, the permissions layer, and the billing logic. The `ddd-architecture` skill forces those questions before any of that is written."
- **ON-SCREEN (lower-third):** "Skill: ddd-architecture"

### [01:10–02:15] Invoke `ddd-architecture` — agree the bounded contexts

- **VISUAL:** In chat, invoke the `ddd-architecture` skill. [VERIFY how this skill is triggered from Ptah Desktop chat — slash command, skill panel, or prompt-driven.]
- **VO:** "I'm invoking `ddd-architecture`. The first thing it does is pull from memory — the goals and constraints we seeded in episode one. Watch."
- **VISUAL:** Kimi references the memory-seeded product goal and stack decisions in its opening response.
- **VO:** "There it is: it already knows we're building a multi-tenant task manager on NestJS and Angular with a Postgres-backed Prisma layer. We don't re-explain the project. Memory carries it."
- **VISUAL:** Kimi proposes the four bounded contexts and the ubiquitous language for each.
- **VO:** "Four bounded contexts. Identity and Tenancy — everything about who someone is and which organization they belong to. Projects — the container concept, permissions, membership. Tasks — the core work model, state machine, assignments. Billing — subscriptions, quotas, trial limits. Each context owns its language. A 'user' in Identity is not the same concept as a 'member' in Projects. The skill enforces that separation."
- **ON-SCREEN:** Bounded-context map overlay — four boxes with explicit boundaries.

### [02:15–03:00] Open the Canvas — one tile per context

- **VISUAL:** Switch from the main chat to the Canvas view in Ptah Desktop. Four tiles are arranged — one per bounded context. [VERIFY exact navigation to Canvas in Ptah Desktop Electron and how to open/arrange tiles before or during recording.]
- **VO:** "This is the Canvas — Ptah's multi-tile view. Each tile is an independent agent session. I've opened one per bounded context. They're all running through Kimi but working on separate problems in parallel."
- **ON-SCREEN (lower-third):** "Canvas multi-tile · Modeled in parallel"

### [03:00–05:30] Parallel modeling — entities, aggregates, value objects

- **VISUAL:** All four Canvas tiles active. Each starts generating its context's aggregate and entity model. Show the tiles running concurrently — text streaming in each one.
- **VO:** "Identity/Tenancy is modeling the Tenant aggregate — an immutable value object for the tenant identifier, a TenantSettings entity for mutable config. Projects is settling on the Project aggregate root, the ProjectMember value object, and the Membership role enumeration. Tasks is the most complex — I'll come back to it. Billing is modeling the Subscription aggregate, the Plan value object, and the trial state."
- **VISUAL:** Slow pan across tiles. Pause briefly on each to show its output.
- **VO:** "The key is that they share the ubiquitous language we agreed at the start. A 'tenant ID' in the Identity context is the same semantic concept referenced by Projects and Billing — each context represents it differently in code, but no tile invents its own term."
- **ON-SCREEN:** Bounded-context map overlay reappears briefly — highlight integration points.

### [05:30–06:50] Reasoning effort — Task lifecycle invariants

- **VISUAL:** Focus on the Tasks tile. Show the Task aggregate, but pause before modeling the state machine. Locate and bump the reasoning effort control to its highest setting. [VERIFY exact reasoning effort UI location and control name.]
- **VO:** "Here's where I slow down on purpose. The Task lifecycle has constraints that are easy to get wrong: you can't move a Task to Done if it has unresolved blockers; you can't archive an InProgress task; a Blocked task must reference its dependency. If the aggregate doesn't enforce these, they end up as runtime checks scattered across services."
- **ON-SCREEN (callout):** "Effort → High (aggregate design)"
- **VO:** "I'm bumping reasoning effort to high for this one — I want Kimi to work through the state-transition edge cases, not just the common path."
- **VISUAL:** Kimi produces a detailed Task aggregate design: state machine with explicit invariant checks, the `move()` command, the `TaskStateException` value object.
- **VO:** "The invariant checks end up as guard clauses on the aggregate's command methods — not in service logic. That's where they belong: the Task enforces its own rules."

### [06:50–08:00] Domain events + CQRS seams between contexts

- **VISUAL:** Back to the main chat or a dedicated tile for cross-context wiring. Kimi models the domain events and CQRS integration seams.
- **VO:** "Now we wire the contexts together — but loosely. Contexts don't call each other's services. They communicate through domain events."
- **ON-SCREEN:** Event-flow animation — Task context emits `TaskMoved` event → Projects context receives it → Billing context checks quota on `TaskCreated`.
- **VO:** "When a Task is moved to Done, the Tasks context emits a `TaskMoved` domain event. The Projects context listens — it may update project progress. The Billing context listens to `TaskCreated` — it checks whether the tenant is within their plan quota. Each context reacts independently. Neither depends on the other's internals."
- **VISUAL:** Code sketches of the event definitions — `TaskMoved`, `TaskCreated`, as plain value objects with a timestamp and context ID.
- **VO:** "The CQRS seam is here: commands go in through aggregate methods, events come out. Read-model projections will be a separate concern — episode four's auth layer and episode five's realtime engine both depend on this separation being real."
- **ON-SCREEN (lower-third):** "Domain events · CQRS seams · context isolation"

### [08:00–08:45] Persist decisions to memory

- **VISUAL:** Navigate to the Memory tab. [VERIFY exact navigation path to Memory tab.]
- **VO:** "Before we close out, these decisions go into memory — the bounded context boundaries, the ubiquitous language, the Task aggregate state machine, the event names. Future sessions will pull these in automatically without re-explaining them."
- **VISUAL:** Save two or three key decisions to memory: the bounded context list, the Task state machine invariants, the domain event names.
- **ON-SCREEN (callout):** "Domain decision saved to memory."
- **VO:** "When the frontend agent in episode seven needs to know what a 'Task' is, it'll have this context available."

### [08:45–09:30] Optional CLI delegation — value-object boilerplate

- **VISUAL:** In chat, spawn a CLI agent via `ptah_agent_spawn` to generate the value-object and test stubs for the domain layer while the orchestrator focused on aggregate design. [VERIFY how ptah_agent_spawn is triggered for a specific boilerplate task from the desktop chat.]
- **ON-SCREEN (lower-third):** "CLI delegate · boilerplate value-object + test generation · Spawn → Poll → Read"
- **VO:** "One more thing. While the orchestrator was deep in aggregate design, I delegated the boilerplate to a CLI agent — value-object class stubs, repository interfaces, the invariant unit test shells. Spawn, poll, read. The grunt work happened in the background while we were doing the real thinking."
- **VISUAL:** CLI agent completes. Files appear in the domain lib folders.

### [09:30–10:15] Close green — domain compiles + invariant tests pass

- **VISUAL:** Run `nx run-many -t lint test build` — focusing on the domain libs. Green.
- **VO:** "Green. Domain libs compile, invariant unit tests pass. Four bounded contexts with explicit separation, an event-driven integration model, and a Task aggregate that enforces its own state rules. Auth, billing, and the frontend all build on this."

### [10:15–11:00] CTA / End screen

- **VISUAL:** Canvas with four populated tiles. Bounded-context map overlay. Chat idle, Kimi badge glowing.
- **VO:** "Next episode, we implement auth and multi-tenant data isolation — two agents working in parallel and a security review before anything merges. The domain model from today is the spec they build against. See you in episode four."
- **ON-SCREEN:** End card — "Next: Auth + Multi-Tenancy" · "Day 6 / 100" · subscribe/playlist link.

---

## Shot list (quick capture summary)

1. Cold open: Ptah Desktop, model badge, green E02 workspace in file tree.
2. Empty domain lib folders — camera lingers.
3. `ddd-architecture` skill invoked — skill name surfacing in UI.
4. Kimi referencing memory-seeded context (project goal pulled automatically).
5. Four bounded contexts proposed — ubiquitous language listed.
6. Bounded-context map overlay — four boxes with boundaries.
7. Canvas navigation — four tiles arranged, one per context.
8. All four tiles streaming simultaneously (parallel modeling).
9. Slow pan across tiles — brief pause on each context output.
10. Focus on Tasks tile — reasoning effort control located and bumped.
11. Reasoning effort callout overlay.
12. Detailed Task aggregate output — state machine, guard clauses.
13. Event-flow animation: TaskMoved → Projects / TaskCreated → Billing.
14. Domain event code sketches on screen.
15. Memory tab — two or three domain decisions saved.
16. Memory-save callout overlay.
17. CLI agent spawned for value-object boilerplate (Spawn → Poll → Read lower-third).
18. Files appearing in domain lib folders.
19. `nx run-many -t lint test build` — green on domain libs.
20. End card.

## [VERIFY] flags

- Exact trigger mechanism for `ddd-architecture` skill from Ptah Desktop chat — slash command syntax, skill panel, or conversational invocation.
- Exact navigation path to the Canvas view in Ptah Desktop Electron and how to open, arrange, or pre-stage multiple tiles before recording.
- How Canvas tiles are labeled and whether they can display a context name — confirm what the on-screen label will look like.
- Exact reasoning effort UI location and control name, and available level names to reference in VO (e.g. "High", "Max", "xhigh", or numeric — use the real label).
- Exact navigation path to the Memory tab from inside the Canvas view (or whether returning to main chat is required first).
- How `ptah_agent_spawn` is invoked for a targeted boilerplate task from the desktop chat — confirm the invocation syntax so VO in [08:45] is accurate.
- Whether domain lib test stubs generated by the CLI delegate will compile and pass in the `nx run-many` at [09:30] without further edits — if they require stubs to pass, note this in the pre-record checklist.
- Current free-trial length wording — confirm "/ 100" counter framing.
