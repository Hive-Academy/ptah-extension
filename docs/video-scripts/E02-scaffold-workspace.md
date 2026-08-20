# E02 — Scaffold the Workspace — Full Script

**Length:** 9–11 min · **Trial day:** Day 3 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Turn roadmap Phase 0 into a green Nx monorepo — NestJS API shell + Angular web shell, shared libs, module boundaries, lint/test/CI — with CLI delegates handling the repetitive generation.
**Controlling thesis:** The difference between a monorepo that scales and one that tangles is module boundaries — enforced from commit one.

## Pre-record checklist

- E01 green state: `.ptah/roadmap.md` present in the TaskFlow workspace; memory seeded with goals/stack/constraint.
- Node.js, Nx CLI prerequisites installed and confirmed on the recording machine.
- `codex`, `copilot`, `ptah-cli` delegates smoke-tested and reachable.
- Orchestrator confirmed as Kimi; model badge visible.
- A deliberate cross-boundary import pre-staged in a scratch file to trigger the violation demo — remove after recording that beat. [VERIFY this can be seeded cleanly without confusing Nx state.]
- Terminal font enlarged before recording (keep scaffold logs readable).
- Know Nx generator versions in use so prompts don't surprise on camera.

## Assets / overlays

- Trial-day counter: "Day 3 / 100".
- Spawn → Poll → Read lower-third (appears whenever a CLI delegate runs).
- `nx graph` apps/libs dependency-graph overlay.
- Boundary-violation red-flag callout: "Cross-boundary import — lint fails."
- Workspace Intelligence "indexed" callout: "Symbol index live."

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat, Kimi badge visible. `.ptah/roadmap.md` in the file tree — artifact of last episode.
- **VO:** "Day three. We have a roadmap. Now we scaffold the workspace — apps, libs, boundary tags, CI. Done by hand, that's a few hours of careful setup. Let me show you how I do it here."
- **ON-SCREEN:** Timer overlay starts. "Day 3 / 100."

### [00:20–01:15] Jump cut to green — then rewind

- **VISUAL:** Jump cut — show a passing `nx run-many -t lint test build` matrix: all green. Then cut back to the start state (empty workspace).
- **VO:** "That's where we end up. Here's how."
- **VISUAL:** Back to clean workspace. Roadmap visible.

### [01:15–02:30] Orchestrator reads the roadmap → proposes the layout

- **VISUAL:** In chat, invoke `nx-workspace-architect`. [VERIFY how this skill is triggered from Ptah Desktop chat — slash command, skill panel, or prompt-driven.]
- **VO:** "I'm invoking the `nx-workspace-architect` skill. I point it at the roadmap and let it derive the layout from there — I don't pre-specify the library names. It'll propose apps, libs, and boundary tags based on what's in the roadmap."
- **ON-SCREEN (lower-third):** "Skill: nx-workspace-architect"
- **VISUAL:** Kimi responds with the proposed layout: apps (`taskflow-api`, `taskflow-web`), domain libs, shared libs, tagging conventions. Scroll through.
- **VO:** "Here's the proposed structure. Two apps — the NestJS API and the Angular web shell. Under `libs`: domain libs scoped per bounded context, a shared contracts lib, an infra lib. And tag rules: `scope:api`, `scope:web`, `scope:shared` — these are the module boundaries. Nothing crosses them without a lint failure."
- **ON-SCREEN:** Dependency-graph overlay — annotated with proposed structure.
- **VO:** "I'll accept this layout. It maps cleanly to the domain model we'll build next episode."

### [02:30–03:15] Approval flow on camera

- **VISUAL:** Kimi's first workspace-mutating tool call arrives — creating the Nx workspace or generating the first app. An approval prompt appears in the UI.
- **VO:** "Before any file gets written, Ptah asks. This is the approval flow. Every tool call that touches your file system surfaces here — you see exactly what's about to happen and you decide. Accept, deny, or tell it to always-allow this class of operation."
- **VISUAL:** Accept the operation. Show it proceeding.
- **ON-SCREEN (lower-third):** "Approval flow — file-system mutations require consent"
- **VO:** "I'm accepting. And now I want to show you what happens to the repetitive part."

### [03:15–05:30] CLI delegation — scaffold grunt work in parallel

- **VISUAL:** Orchestrator delegates to CLI agents via `ptah_agent_spawn`. Show three delegate tasks spawning — one for the API shell, one for the Angular web shell, one for the shared libs. Three agents running concurrently.
- **ON-SCREEN (lower-third):** "3-tier delegation · Spawn → Poll → Read"
- **VO:** "The orchestrator spawns CLI agents — codex, copilot, and ptah-cli — each with a self-contained task. One generates the NestJS app skeleton, one the Angular shell, one the shared library set. They run in parallel."
- **VISUAL:** Show the Poll phase — agent statuses updating. Results streaming back.
- **VO:** "Spawn: task goes out. Poll: we wait for completion. Read: results stream back into the orchestrator, which checks each one before moving on."
- **VISUAL:** Files appearing in the file tree as agents complete.

### [05:30–06:45] Enforce module boundaries — show the violation

- **VISUAL:** File tree populated. Now open or reference the deliberate cross-boundary import in a scratch file — e.g. a `scope:web` lib importing directly from a `scope:api` lib.
- **VO:** "Here's something I want to show before we call this scaffolding done. We have boundary tags — but tags only matter if they're enforced. Let me deliberately break one."
- **VISUAL:** Show the bad import line. Run `nx lint` (or the relevant target). A lint error fires — red output on the cross-boundary violation.
- **ON-SCREEN (callout):** "Cross-boundary import — lint fails."
- **VO:** "There it is. A `scope:web` lib reaching directly into a `scope:api` lib — rejected at lint, not at code review and not in production. This is the muscle we're building in now. Fix it through the shared contracts lib, and it passes."
- **VISUAL:** Show the fix — import redirected through shared. Lint passes.
- **VO:** "That's the architecture constraint made real. The monorepo will fight you if you try to tangle it."

### [06:45–08:00] Index the workspace — symbol search lights up

- **VISUAL:** In Ptah Desktop, trigger workspace intelligence indexing on the newly generated workspace. [VERIFY the exact trigger mechanism for workspace intelligence indexing from the desktop app — manual trigger, automatic on workspace open, or post-generation hook.]
- **VO:** "Now I'm triggering workspace intelligence indexing on the generated codebase — AST analysis, symbol extraction, semantic search. This runs once now so it's available when the codebase gets larger."
- **VISUAL:** Indexing running — progress indicator. Completes.
- **ON-SCREEN (callout):** "Symbol index live."
- **VISUAL:** Do a quick symbol lookup — search for a generated class name (e.g. `AppModule`, `TasksModule` placeholder, or a generated service stub).
- **VO:** "Now I can search for any symbol and navigate straight to it. That's more useful once we have dozens of domain classes spread across bounded contexts — worth having indexed from day three."

### [08:00–08:50] Close green — full run

- **VISUAL:** Terminal or Ptah's run output. Execute `nx run-many -t lint test build`. Watch the matrix.
- **VO:** "Last check. Lint, test, build across every project in the workspace."
- **VISUAL:** Green matrix. All pass. Timer overlay stops.
- **VO:** "Green. Boundary-enforced Nx monorepo — the apps, libs, and tag rules are all in place. Everything else in the series builds on this."

### [08:50–09:30] CTA / End screen

- **VISUAL:** The populated file tree. Dependency graph rendered. Chat idle, Kimi badge glowing.
- **VO:** "Next episode, before we write any endpoint logic, we model the domain — bounded contexts, entities, aggregates, domain events, CQRS — using the `ddd-architecture` skill, with multiple contexts running in parallel on the Canvas. See you in episode three."
- **ON-SCREEN:** End card — "Next: Model the Domain / DDD" · "Day 4 / 100" · subscribe/playlist link.

---

## Shot list (quick capture summary)

1. Cold open: Ptah Desktop, model badge, roadmap in file tree.
2. Jump-cut to green `nx run-many` matrix — then rewind to start.
3. `nx-workspace-architect` skill invoked — show skill name surfacing in UI.
4. Kimi's proposed app/lib layout — scroll through response.
5. Dependency-graph overlay (annotated with proposed structure).
6. Approval flow prompt on first filesystem mutation — accept it.
7. Three CLI agents spawning concurrently via `ptah_agent_spawn`.
8. Poll phase — agent statuses updating.
9. Read phase — results streaming back; files appearing in file tree.
10. Cross-boundary import violation — lint failure callout.
11. Fix through shared lib — lint passes.
12. Workspace intelligence indexing — progress indicator + "Symbol index live" callout.
13. Quick symbol lookup — result found.
14. `nx run-many -t lint test build` — full green matrix.
15. End card.

## [VERIFY] flags

- Exact trigger mechanism for `nx-workspace-architect` skill from Ptah Desktop chat — slash command syntax, skill panel, or conversational invocation.
- Exact visual form of the approval flow prompt — what it shows, what the accept/deny/always-allow options look like and are labeled.
- How `ptah_agent_spawn` surfaces in the desktop app when multiple delegates run concurrently — does each appear as a separate tile, a list, or inline in the chat? Confirm what "Poll" looks like visually so VO matches.
- Exact trigger for workspace intelligence indexing on a newly generated workspace — automatic on folder open, manual button, or triggered by the agent? Confirm UI path. [VERIFY]
- Whether `nx run-many -t lint test build` is run in Ptah's integrated terminal (xterm) or a separate terminal window — pick one consistent approach for recording.
- Current free-trial length wording — confirm "/ 100" counter framing.
