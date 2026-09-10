# Context — Scale the Orchestra Canvas beyond nine tiles

## What the user asked for

The user opened this work with a question about the current Gridstack and canvas
implementation. They wanted three things:

1. Better performance.
2. Zoom in and out.
3. A way to go beyond the `MAX_TILES = 9` cap.

Across the conversation the intent sharpened:

- The user wants a **clear sweet spot between UI and UX**, not only a raw tile
  count. Many tiles are useless if each one costs a screen of scrolling.
- The user wants **collapsed, compacted and folded states** so a tile can cost
  very little when it is not the one being read.
- The user stated plainly that the **current compact view looks and feels bad**,
  and supplied a screenshot. This is the highest-priority item to them.
- The user wants **persistence to survive workspace switches** while many
  sessions are open.
- The user wants a **notification center**: a bell near the theme toggle that
  surfaces finished sessions, pending permission requests and pending
  `AskUserQuestion` prompts, with a short sound, and a click that focuses the
  session.

## Decisions the user made

| Decision | Value | Consequence |
|---|---|---|
| Host priority | **Electron first.** VS Code may hide a capability if it is a blocker. | The webview CSP stops being a hard constraint on the sound. Per-host gating follows the existing `@if (!isElectron)` convention. |
| Session target | **Many running at once**, not merely many open. | The renderer plan alone is insufficient. A concurrency track is required. |
| This task | **Write the specification only.** No production code yet. | This folder is the deliverable. Implementation is a follow-up. |

## How the analysis was produced

Two passes, both by a Codex CLI agent working in parallel with the assistant,
then reconciled against the code.

1. `codex-canvas-investigation.md` — a read-only investigation of performance,
   zoom options and the tile cap, with a file-and-line evidence table.
2. `codex-plan-review.md` — an adversarial review of the resulting plan,
   including the notification center design.

The review corrected four assistant claims. Those corrections are recorded in
`task-description.md` under "Claims that were wrong", because each one had
already influenced the plan and must not be reintroduced by a later reader.

## Task-id history

This task was first written to `.ptah/specs/TASK_2026_392/`. That was an id
collision: `origin/main` already carried a different `TASK_2026_392` (a CI and
outage task). A branch checkout on 2026-09-09 at 03:02 replaced this task's
`task.md` and `context.md` with main's, and the remaining files were lost.

Re-minted here as `TASK_2026_404_6fcd` under the interim collision protocol:
`404` is above the highest id known across `origin/main` (400), the current
branch (401) and the `agent-messaging` worktree (402, 403), and the `6fcd`
suffix makes the folder distinct even if another branch also mints 404.

Do not renumber this folder. Do not "fix" the `id` field.

## The one thing a reader should carry away

Bound the **Live** population, not the tile count.

Six to nine full chat surfaces is the readable maximum on any real monitor.
Above that number, more tiles help navigation and awareness, not reading. So the
product should let a user open fifty sessions, keep a handful alive, and make
the rest cost a header strip each.

The same idea already governs geometry in this library: geometry is derived and
never stored. This work extends that idea to fidelity.
