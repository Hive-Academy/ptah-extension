# E11 — Teach Ptah Your Stack — Full Script

**Length:** 9–11 min · **Trial day:** Day 25 / 100 · **Runtime:** Ptah Desktop (Electron) · **Orchestrator:** Kimi (open weight, Ollama Cloud)
**Goal:** Turn everything built across the series into reusable assets — synthesize a skill from the build trajectory, hand-author a polished custom skill with `skill-creator`, curate the Memory tab, assemble a reusable harness, and prove it with a fresh scratch project.
**Controlling thesis:** The build left behind reusable artifacts — skills, curated memory, a harness — that the next project can load from day one.

## Pre-record checklist

- Completed, deployed TaskFlow from E10 is the active workspace.
- Prior session history from multiple episodes present so skill synthesis has real trajectory material to analyze. [VERIFY sessions are present in the desktop app's session list and the Skills tab can surface candidate skills from them.]
- `skill-creator` skill installed and verified.
- Memory tab populated with project-goal entries seeded in E01 and decisions saved through the series. [VERIFY memory entries are visible and non-empty in the Memory tab.]
- A second, empty scratch workspace prepared (a new folder with no code) — ready to demo the "next project" proof at the end.
- Harness builder confirmed functional for the desktop build used to record. [VERIFY harness builder is accessible and the stream runs to completion in a dry run.]
- No CLI delegation required — this episode stays in the orchestrator and the desktop tabs.

## Assets / overlays

- Skill-synthesis candidate card (extracted skill name, source trajectory, judge score).
- "clone → curate → enhance" learning-loop diagram.
- Memory tab before/after comparison (full vs curated list).
- Harness builder stream capture (skills + delegate config assembling in real time).
- Trial-day counter: "Day 25 / 100".

---

### [00:00–00:20] Cold open

- **VISUAL:** Ptah Desktop chat open; the open-weight Kimi badge is visible. The Skills tab is visible in the sidebar. Trial counter lower-third fades in.
- **ON-SCREEN (lower-third):** "Day 25 / 100"
- **VO:** "TaskFlow is deployed. That's the build done. This episode is about what the build left behind — and how to make it reusable."

### [00:20–01:00] The learning loop (concept bridge)

- **VISUAL:** The "clone → curate → enhance" loop diagram animates on screen. Three nodes labeled: Synthesis (learns from trajectory) → Skill Creator (author and polish) → Harness Builder (bundle for reuse).
- **VO:** "Three steps this episode. Ptah synthesizes a skill candidate from what happened in this build. I author a polished version with `skill-creator`. Then I bundle it all — skills, memory, delegate config — into a reusable harness. The point is to carry useful context forward, not rebuild it from scratch next time."
- **ON-SCREEN:** "clone → curate → enhance" loop diagram.

### [01:00–02:40] Step 1 — Skill synthesis

- **VISUAL:** User opens the Skills tab in Ptah Desktop. The session trajectory list is visible — multiple prior sessions from episodes across the series. [VERIFY exact Skills tab location and UI within the desktop app.]
- **VO:** "The Skills tab has the session history from this build. I'm asking it to synthesize a candidate skill from that trajectory — extract the pattern that showed up repeatedly in how we structured the multi-tenant modules and package it as a skill."
- **VISUAL:** Skill synthesis is triggered. A progress indicator runs. A candidate skill card surfaces — something like "multi-tenant NestJS module scaffold" or reflecting the actual synthesized output. [VERIFY the synthesized skill name and judge score surface correctly from the real trajectory data.]
- **ON-SCREEN:** Skill-synthesis candidate card overlay (name, source episode range, judge confidence score).
- **VO:** "There's the candidate. The judge score is high because the same pattern appeared across multiple sessions — multi-tenant isolation, Prisma scoping, the service-layering structure. It repeated often enough that the synthesis extracted a skeleton."
- **VISUAL:** User reviews the candidate card. The skill body is visible on screen — it references real patterns from the build.
- **VO:** "The synthesis extracts structure, but the authoring guidance isn't polished and the edges aren't trimmed. That's what the next step handles."

### [02:40–04:30] Step 2 — Hand-author with skill-creator

- **VISUAL:** From the chat, the user invokes `skill-creator`. The orchestrator opens a guided authoring flow. [VERIFY the exact in-chat invocation — slash command or skill name — and how the authoring flow surfaces.]
- **VO:** "I'm passing the synthesized candidate to `skill-creator`. This is where I define the trigger conditions, the reference map, and the guidance the orchestrator will follow when the skill fires on a future project."
- **VISUAL:** The authoring flow guides through: skill name, trigger description, reference sections (e.g., `multitenancy`, `prisma-scoping`, `service-layering`), and a sample invocation. User fills in the stack-specific conventions — the things that are unique to how we build in this monorepo.
- **ON-SCREEN:** Skill authoring form; reference section labels visible.
- **VO:** "The reference map is the useful part. These are the guidance blocks the orchestrator pulls when the skill fires — the layering rules, the naming conventions, the tenant-scoping invariant. Not documentation comments; guidance the orchestrator actually acts on."
- **VISUAL:** Skill authoring completes. The skill is saved. It appears in the installed skills list.
- **ON-SCREEN:** "Skill saved: [skill name]" confirmation; skill appears in the list.
- **VO:** "Done. An authored skill derived from what we actually built, with the rough edges cleaned up."

### [04:30–05:50] Step 3 — Memory tab curation

- **VISUAL:** User opens the Memory tab in Ptah Desktop. The full list of memory entries is visible — project goals, stack decisions, constraint notes from across the series. [VERIFY the Memory tab location and that entries from prior episodes appear here.]
- **VO:** "The Memory tab has accumulated entries over twenty-five days — project goals from episode one, architecture decisions from the domain modeling, security constraints from the review. Some of that carries forward. Some of it is task-specific and doesn't generalize. The curation step is just separating them."
- **VISUAL:** User reviews entries and marks or removes a few task-specific ones (e.g. a sprint note about a specific bug fix). The high-value entries — stack constraints, tenancy invariants, the open-weights-only rule — are confirmed and stay.
- **ON-SCREEN:** Memory tab before/after comparison overlay.
- **VO:** "What stays: the decisions that define how we build — the open-weights preference, the DDD bounded-context map, the tenant-isolation invariant. Anything a new session needs to understand this codebase. The sprint-specific noise gets removed."
- **VISUAL:** Memory tab after — a leaner, structured list. Milestone: memory is ready.
- **ON-SCREEN:** "Memory curated" lower-third callout.

### [05:50–07:20] Step 4 — Harness builder

- **VISUAL:** User opens the harness builder surface in Ptah Desktop. [VERIFY the exact location — how harness builder is accessed in the desktop app.]
- **VO:** "The harness builder is the bundle step. I'm putting together a harness that packages the custom skill we just authored, the curated memory, and the delegate configuration — codex, copilot, ptah-cli in the right priority order — into a single artifact a future project can load."
- **VISUAL:** The harness builder stream runs — skill references assembling, memory snapshot attaching, delegate config including. Progress visible in real time.
- **ON-SCREEN:** Harness builder stream capture (components assembling: skills + memory + delegate config).
- **VO:** "Skills binding in, memory snapshot attached, delegate priority wired up. The result is a loadable rig — load it on a new NestJS multi-tenant project and the orchestrator starts with the context we accumulated across twenty-five days."
- **VISUAL:** Harness completes and saves. Name and component summary on screen.
- **ON-SCREEN:** "Harness saved: [harness name] — [N skills / memory snapshot / delegate config]"

### [07:20–08:40] The proof — fresh project, immediate lift

- **VISUAL:** A new empty scratch workspace opens in Ptah Desktop. The harness is loaded. A new chat session starts.
- **VO:** "New project, no code. I load the harness, then ask the orchestrator to scaffold a module following the stack's tenancy conventions — without explaining any of it."
- **VISUAL:** In the new chat, the user asks the orchestrator to scaffold a new module following the stack's tenancy conventions. The orchestrator responds using the custom skill — the correct layering, the correct Prisma scoping, the correct naming conventions — without any re-explanation. [VERIFY the orchestrator demonstrably uses the new skill's guidance in its output, and that the harness loaded memory is referenced.]
- **ON-SCREEN (callout):** "Skill: [skill name] — active"
- **VO:** "The custom skill fired. The tenancy invariant is there. The layering is correct. No re-explanation — the harness carried it forward."
- **VISUAL:** Module scaffold output shown; milestone: skill-guided output is correct and uses the project's conventions.

### [08:40–09:30] Payoff + CTA

- **VISUAL:** The desktop shows the three tabs — Skills, Memory, the active new-project chat — side by side.
- **VO:** "Skill synthesis extracted the pattern. `skill-creator` sharpened it. The Memory tab kept the decisions. The harness bundled everything. The next project loads that and skips the ramp-up."
- **VISUAL:** Trial counter animates.
- **ON-SCREEN:** "Day 25 / 100 — 75 days left."
- **VO:** "One episode left. We close the series — the full arc, the numbers, and where to go from here. See you there."
- **ON-SCREEN:** End card — "Next: Finale + Trial CTA (E12)" · playlist link.

---

## Shot list (quick capture summary)

1. Cold open — Ptah Desktop Kimi badge + Day 25 lower-third.
2. "clone → curate → enhance" loop diagram.
3. Skills tab open — session trajectory list visible.
4. Skill synthesis triggered + candidate skill card surfaces.
5. Candidate card close-up (name, source, judge score).
6. `skill-creator` invocation + authoring flow.
7. Reference section labels in the authoring form.
8. Skill saved; appears in installed skills list.
9. Memory tab — full entry list (before curation).
10. Memory tab curation — review and remove task-specific entries.
11. Memory tab after (leaner, structured list).
12. Harness builder stream (skills + memory + delegate config assembling in real time).
13. Harness saved — name and component summary.
14. New empty scratch workspace + harness loaded.
15. New chat — orchestrator uses custom skill on first module scaffold.
16. Skill-active callout; correct output visible.
17. Three-tab side-by-side (Skills + Memory + new-project chat); Day 25 counter; end card.

## [VERIFY] flags

- Exact Skills tab location and navigation path in Ptah Desktop to trigger skill synthesis from session trajectories — confirm the UI surface matches what's described.
- Whether the skill synthesis output (candidate name, judge score) is deterministic enough to script a specific example, or whether the VO should remain generic ("something like...") until a dry run confirms the output.
- Exact in-chat invocation for `skill-creator` — slash command vs skill name — and how the guided authoring flow surfaces in the desktop UI.
- Memory tab location and navigation path in Ptah Desktop (Electron); confirm entries seeded from prior episodes appear there.
- Harness builder access path — confirm how the harness builder surface is opened in the desktop app and whether it is a distinct surface or part of another tab.
- Whether the harness builder "stream" is a visible real-time assembly progress indicator or a batch operation — adjust the VO pacing accordingly.
- Confirm the "new project proof" is achievable in a short demo window: loading the harness and triggering the custom skill on a fresh workspace must be fast and reliable on camera.
- Confirm the synthesized skill's name and reference sections so the script's placeholders can be replaced with the real values before recording.
