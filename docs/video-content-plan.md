# Ptah — Video Content Plan

A complete, demo-driven video library covering every Ptah feature across all three runtimes
(VS Code extension, Electron desktop, headless CLI).

**Format convention (mixed):**

- **Long-form** (5–12 min, narrated walkthrough + shot list): product tours, use-case journeys, flagship demos.
- **Short-form** (30–90s, one hook / one feature / fast payoff): power tips.

**Status legend:** ☐ not planned · ◐ planned (script ready) · ☑ recorded

---

## Master Catalog (29 videos)

### Path 1 — The Product Tour (on-ramp) · long-form

- ◐ P1.1 — Ptah in VS Code
- ◐ P1.2 — Ptah Desktop (the Thoth shell)
- ◐ P1.3 — Ptah CLI
- ◐ P1.4 — One brain, three faces

### Path 2 — The AI Coding Orchestra (flagship) · long-form

- ☐ P2.1 — Run 3 agents at once (Canvas multi-tile)
- ☐ P2.2 — Same task, three brains (provider-agnostic)
- ☐ P2.3 — Agents that hire agents (3-tier delegation)
- ☐ P2.4 — Keep working while they work (background workspaces)
- ☐ P2.5 — Rewind & explore alternatives (transparent fork)

### Path 3 — Memory & Self-Improvement · long-form

- ☐ P3.1 — Ptah remembers (persistent memory)
- ☐ P3.2 — Ptah learns a skill (skill synthesis)
- ☐ P3.3 — The learning loop (clone → curate → enhance)

### Path 4 — Automation & Always-On · long-form

- ☐ P4.1 — Nightly agents (cron scheduler)
- ☐ P4.2 — Drive Ptah from chat (messaging gateway)
- ☐ P4.3 — Code from your phone (gateway use case)
- ☐ P4.4 — Talk to your agent (voice)

### Path 5 — Workspace Intelligence · long-form

- ☐ P5.1 — It indexes your whole repo (AST + symbol indexer)
- ☐ P5.2 — Semantic symbol search (BM25 + vector)
- ☐ P5.3 — MCP superpowers (browser, deps, diagnostics)

### Path 6 — Real Dev Workflows (use cases) · long-form

- ☐ P6.1 — Fix a bug end-to-end
- ☐ P6.2 — Build a feature with orchestration
- ☐ P6.3 — Refactor safely (with reviewers)
- ☐ P6.4 — Onboard to an unfamiliar codebase
- ☐ P6.5 — Ship a PR

### Path 7 — Power Features (pro tips) · short-form

- ☐ P7.1 — The 7-step setup wizard
- ☐ P7.2 — Build a custom harness
- ☐ P7.3 — Dial reasoning effort
- ☐ P7.4 — Marathon sessions (compaction)
- ☐ P7.5 — Slash commands

---

## Per-Video Planning Template

```
### P<x>.<n> — <Title>
- Format / length:
- Audience / persona:
- Goal (what the viewer believes or does after):
- Hook (first 5–10s):
- Pre-record setup (repo state, accounts, data to seed):
- Beat-by-beat (narration ↔ on-screen action):
- Features shown (with surface/file refs):
- Payoff line:
- CTA / next video:
- Pitfalls to avoid on camera:
- Assets needed (overlays, lower-thirds, b-roll):
```

---

## Path 1 — The Product Tour

> Goal of the path: a clean on-ramp. One video per surface, each answers
> "what is this and why would I use it." These are the first videos a new
> viewer watches; keep them welcoming and concrete.

### P1.1 — Ptah in VS Code

- **Format / length:** Long-form, 6–8 min.
- **Audience:** Devs who live in VS Code, evaluating AI assistants.
- **Goal:** Viewer installs Ptah and runs their first workspace-aware chat + edit.
- **Hook (0:00–0:10):** Split screen — left, someone copy-pasting code into a browser chatbot and back; right, Ptah editing the file inline. "Your AI assistant shouldn't make you copy-paste. Watch this."
- **Pre-record setup:**
  - A real, modest TypeScript repo open (something viewers can relate to, not Ptah itself).
  - Ptah installed from Marketplace, signed in, model selected.
  - Clean `git status`; one small, well-defined task queued in your head (e.g. "add input validation to function X").
- **Beat-by-beat:**
  1. Open the Ptah panel in VS Code. Quick tour of the chat webview (input, message list, rich markdown).
  2. Ask a question _about the open codebase_ ("where is auth handled?") — show it answers with real `file:line` references, proving workspace awareness.
  3. Give it a real edit task. Show the file change applied inline (diff), not pasted into chat.
  4. Highlight rich rendering: code blocks with language badges, callouts, headings.
  5. Run/verify the change in the integrated terminal.
- **Features shown:** webview chat UI, workspace/symbol awareness, in-editor file edits, markdown rendering (`libs/frontend/markdown`).
- **Payoff:** "No copy-paste. It sees your code, edits your files, inside your editor."
- **CTA:** Install link → next: "but the desktop app unlocks a lot more."
- **Pitfalls:** Keep the repo small so context is fast; pre-test the exact prompt so the demo is deterministic; avoid showing secrets.
- **Assets:** install overlay, keyboard-shortcut lower-third, before/after diff zoom.

### P1.2 — Ptah Desktop (the Thoth shell)

- **Format / length:** Long-form, 7–9 min.
- **Audience:** Viewers who saw the VS Code video and want the full product.
- **Goal:** Viewer understands the desktop app's 4-tab cockpit and why desktop unlocks capabilities the extension can't have.
- **Hook:** "The VS Code extension is the tip. This is the whole iceberg." — pan across the Thoth shell.
- **Pre-record setup:**
  - Electron app built and running.
  - Seed real data so tabs aren't empty: a few memories, at least one synthesized skill, one schedule, a connected gateway (or screenshots of one).
- **Beat-by-beat:**
  1. Open the desktop app; orient on the shell and the chat surface (same core as VS Code).
  2. Tour the 4 inner tabs as teasers (deep dives come later): **Memory**, **Skills**, **Schedules** (cron), **Gateway**.
  3. For each tab: one sentence on what it does + one glance at real data.
  4. Frame the "why desktop": these run a local SQLite brain + embedder worker, which is why they're desktop-only by design.
- **Features shown:** Thoth 4-tab shell (`libs/frontend/thoth-shell`), Memory/Skills/Schedules/Gateway tabs.
- **Payoff:** "Desktop = the full brain: persistent memory, self-made skills, scheduling, and remote control."
- **CTA:** "We'll go deep on each of these" → Path 3 & Path 4.
- **Pitfalls:** Be honest — these four tabs are Electron-only by design; don't imply VS Code parity. Keep teasers short; resist deep-diving here.
- **Assets:** tab-label callouts, "deep dive coming" lower-thirds.

### P1.3 — Ptah CLI

- **Format / length:** Long-form, 6–8 min.
- **Audience:** Automation-minded devs, CI/pipeline owners, terminal lovers.
- **Goal:** Viewer runs a headless agent from the terminal and sees the scripting / CI potential.
- **Hook:** "Same agent. No UI. Fully scriptable." — a terminal completing a real task hands-free.
- **Pre-record setup:**
  - `@hive-academy/ptah-cli` installed, authenticated, provider configured.
  - A repo with a small scriptable task ready.
- **Beat-by-beat:**
  1. Auth + provider/model selection (`ptah auth`, `ptah provider`, model switch).
  2. Start a session and run a one-shot interaction; show output.
  3. Show the JSON-RPC stdio nature — Ptah as a programmable agent, not just a chat.
  4. A scripted refactor / batch task to hint at CI usage.
- **Features shown:** CLI commands (see `ptah-cli-usage` skill), JSON-RPC stdio, headless agent runs.
- **Payoff:** "Drop Ptah into any pipeline or script."
- **CTA:** → Path 4 (automation) and the "one brain" finale.
- **Pitfalls:** Verify exact commands against the current CLI before recording; keep output legible (font size up).
- **Assets:** terminal theme with large font, command lower-thirds.

### P1.4 — One brain, three faces

- **Format / length:** Long-form, 5–7 min.
- **Audience:** Anyone who watched 1–3; ties the suite together.
- **Goal:** Show that memory, skills, and settings live in a shared local core (`~/.ptah`) and persist across all three runtimes.
- **Hook:** "Teach it once in your terminal — it remembers in your editor."
- **Pre-record setup:** All three runtimes installed against the same machine/user; pick one fact or preference to create.
- **Beat-by-beat:**
  1. In the CLI (or desktop), create something durable — a memory/preference and/or a synthesized skill.
  2. Open the desktop app — the same memory/skill is there.
  3. Open VS Code — same model/settings, same persistent state.
  4. Explain the shared spine: `~/.ptah/ptah.db` + `~/.ptah/settings.json` are the one brain behind all three faces.
- **Features shown:** shared persistence core, cross-runtime memory/skills/settings continuity.
- **Payoff:** "One brain. Three faces. Pick the surface that fits the moment."
- **CTA:** Wrap the on-ramp → tease Path 2: "Now let's make it an _orchestra_."
- **Pitfalls:** Be accurate — this is **shared persistent state** (memory, skills, settings, model config), not live session hand-off. Don't script a live conversation continuing mid-stream across runtimes.
- **Assets:** three-up runtime montage, `~/.ptah` diagram overlay.
