# TASK_2026_198 — Context

## Meta

| Field              | Value                                   |
| ------------------ | --------------------------------------- |
| Task ID            | TASK_2026_198                           |
| Type               | FEATURE (visual + interaction overhaul) |
| Primary surface    | `apps/ptah-tui` (Ink + React)           |
| Scope authored     | 2026-08-03                              |
| Folder created     | 2026-08-10                              |
| Branch at creation | ak/license-server-validation-pipe       |

## Provenance — why this task exists

This scope was authored on 2026-08-03 and written directly into
`.ptah/specs/TASK_2026_173/task.md` with a whole-file `Write`, overwriting that
task's carrier. TASK_2026_173 is an editor-panel git-diff and performance
workstream; every other file in its folder (`context.md`,
`implementation-plan.md`, `tasks.md`, `measurements.md`, `r3-triage.md`,
`amendments.md`, `task-description.md`) documents the editor work, and five
commits of it are already in `main`.

The result was that the editor task lost its carrier and this TUI scope never
got a folder of its own. The repair on 2026-08-10 restored 173's carrier to the
editor scope and re-filed this TUI scope here, preserving its body text verbatim
in the section below.

## Prerequisite status

The original scope stated a hard prerequisite:

> Prerequisite: the functional bug batch (stderr leak, duplicate chunks,
> streaming hang, file search, broken shortcuts) must land first — polish on top
> of broken flows is wasted.

That batch appears to have landed as `e30e5bb01` — _"fix: repair TUI streaming,
input focus, stderr capture, and skill discovery"_. It has no dedicated task
carrier in `.ptah/specs/`, so `depends_on` is left empty rather than pointing at
an invented ID. Confirm the prerequisite is genuinely satisfied before planning
begins; if a residual functional defect remains, file it and block this task on
it.

---

## Original scope (preserved verbatim from the TASK_2026_173 carrier)

User verdict after live testing: the TUI "feels very basic and rocky, not professional" next to Claude Code and Copilot CLI — which are built on the same stack (Ink + React). This task adopts their design language (patterns, not code). Prerequisite: the functional bug batch (stderr leak, duplicate chunks, streaming hang, file search, broken shortcuts) must land first — polish on top of broken flows is wasted.

### Reality constraint to encode in the work

Terminal FONTS are not ours to change — glyph quality comes from the user's terminal font. What IS ours: layout, spacing, border discipline, color palette, markdown rendering, motion (spinners/progress), and interaction grammar. Optionally detect Nerd Font / fall back to ASCII-safe glyphs.

### Design language to adopt (reference: Claude Code CLI, Copilot CLI)

1. **Minimal chrome, content-first.** Kill the full-height bordered side panel and full-width boxes. Chat occupies the full width; transient panels (agents, sessions) overlay or collapse instead of permanently reserving 30% of the screen showing "No active agents". Borders only where they carry meaning (the input box); everywhere else use whitespace + color.
2. **Streaming markdown rendering.** Assistant output renders as terminal markdown (headings, bold, lists, syntax-highlighted fenced code with language badge, inline code) — not raw plain text. Evaluate ink-compatible markdown renderers vs a focused custom renderer over the existing chat-types content blocks.
3. **Live activity affordances.** Spinner + elapsed time + token counter while streaming; tool-use lines rendered as compact single-line entries with status glyphs; Esc interrupts the current turn (with the interrupt actually wired to agent:stop).
4. **One coherent keymap, discoverable.** Single source of truth for bindings; `?` opens a help overlay listing everything; footer shows only the 3-4 most relevant hints for the current context. Follow CLI conventions: Esc = cancel/close topmost, Ctrl+C twice = quit with confirm, slash commands (`/model`, `/settings`, `/sessions`, `/agents`, `/help`) typed in the input as the primary navigation — reducing dependence on Ctrl-chords that terminals intercept inconsistently (this was the source of the reported confusion).
5. **@-file mentions** in the input (depends on the fixed file search): type `@` → inline fuzzy file list → attach as context, Claude Code style.
6. **Status line discipline.** One bottom status line: model, session state, token/cost, streaming state. No contradictory states (a conversation must never show "No session").
7. **Palette + theme.** Muted, consistent palette derived from the existing themes.ts; semantic colors only (user/assistant/tool/error/success); respect NO_COLOR and 16-color terminals with graceful degradation.
8. **First-run and empty states.** Purposeful welcome screen (logo line, workspace, provider status, 3 suggested actions) instead of a black void; every empty panel states what it is and how to fill it.

### Scope

- All apps/ptah-tui components and hooks touched by the above; keymap module extracted as a single registry consumed by all panels.
- No backend/protocol changes beyond wiring Esc-interrupt to the existing agent:stop RPC.
- Snapshot/ink-testing-library specs for: markdown renderer blocks, keymap registry (no duplicate bindings — enforced by a spec), help overlay contents, status line states.

### Acceptance criteria

1. Side-by-side with Claude Code in the same terminal, the TUI reads as the same generation of tool: minimal chrome, rendered markdown, live spinner/elapsed, compact tool lines.
2. `?` shows every binding; every footer hint works; a spec proves zero conflicting bindings; Esc cancels topmost surface deterministically; Ctrl+C twice quits.
3. Slash commands cover model/settings/sessions/agents/help; @-mention attaches files.
4. Status line can never show "No session" during an active conversation (state derived, not tracked separately).
5. Degrades cleanly: no Nerd Font, 16-color, 80-col terminal all remain usable (spec the layout at 80x24).
6. ptah-tui suite green; no cli-engine/protocol changes except Esc→agent:stop wiring; Electron/VS Code untouched.

### Out of scope

- New backend features, RPC namespaces, or provider changes.
- Porting the TUI to another rendering stack — Ink stays.
