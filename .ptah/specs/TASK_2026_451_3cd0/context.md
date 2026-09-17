# Task Context - TASK_2026_451_3cd0

## User Request

"i would like to also do a small check on the last layout fixes work we made i want to check on the
height when we do compact the session tile currently what happen is that it doesn't loose its height
or width and doesn't chrunk and allow for fluid sizing ? is that covered"

Follow-up: "lets orchestrate a fix on latest main as i merged pr 514 already to build upon that"

## Task Type

FEATURE (behaviour TASK_2026_442 explicitly put out of scope)

## Complexity

Medium–Complex (two-dimensional placement in a pure layout function)

## Strategy

FEATURE, Partial depth. PM skipped: the three read-only investigations already scope the problem
and the user answered the open product decisions (Gate 1.5). Flow: architecture lane → Gate 2 →
implement lane → review lane (different family) → orchestrator verification (typecheck, tests,
lint). Branch `feat/task-451-compact-tile-sizing`, isolated in its task worktree and based on `origin/main`
`f1a34aa55` (includes PR #514 merge `21e8849d2`).

## CLI Lanes

Mode: enabled (user pinned the roster).

| Agent | Type | Status | Capabilities |
| ----- | ---- | ------ | ------------ |
| codex | cli | installed | messaging: queue, role delivery: preamble/developer-instructions |
| antigravity | cli | installed | messaging: none, role delivery: preamble/task-prompt |
| ollama cloud | ptah-cli | available | provider: Ollama Cloud, ptahCliId: pc-85830910-3d81-4248-84c1-4fa52752dd19 |

| Phase | Lane | Spawn args | Deliverable |
| --- | --- | --- | --- |
| Architecture | codex | `{ cli: 'codex', role: 'software-architect' }` | `implementation-plan.md` |
| Implement | ollama cloud | `{ ptahCliId: 'pc-85830910-…', modelTier: 'opus', role: 'frontend-developer' }` | code + `implementation-report.md` |
| Review | antigravity | `{ cli: 'antigravity', role: 'code-logic-reviewer' }` | `code-logic-review.md` |

Revise cap: 2 rounds.

Roster change (2026-09-15, user decision): the ollama cloud lane hit its Ollama Cloud usage limit
(HTTP 429) mid revise round 1, after fixing review defect 1 and part of defect 2. The user chose
codex (`{ cli: 'codex', role: 'frontend-developer' }`) to finish the round. Review stays on
antigravity, a different family from both implementers.

## Conversation Summary

Investigation (codex, antigravity, ollama cloud — reports in this folder as
`compact-sizing-check-*.md`) agreed: compact view is not an input to the canvas layout.
`onToggleViewMode` writes only `TabState.viewMode`; `computeLayout` gives every tile `h: 6` at
`y = rowIndex * 6`; `cellHeightFor` applies a 90%-of-viewport floor; `TileIntent` has no height;
compact card is `h-full`/`flex-1`; singleton CSS forces `100% !important`; no test covers it.

### User Decisions (Gate 1.5)

1. **Mixed rows — skyline packing.** Each compact tile shrinks on its own; tiles below move up into
   freed space even when the row also holds full tiles. Requires a deterministic 12-column
   occupancy / skyline placement in `canvas-layout-intent.ts`, not `rowIndex * 6`.
2. **Width — narrow to smallest.** A compact tile projects to the smallest span allowed at the
   current responsive capacity (1/3 when three fit, promoted at narrower widths). Returning to full
   view restores the stored width intent untouched (projection only, like layout focus).
3. **Lock — allow.** The compact toggle stays enabled under canvas lock and may reflow tiles. Lock
   still blocks drag, resize, presets, span, row and layout-focus changes. Document the exception.

### Standing constraints

- `TabManagerService` view mode stays the single authority. Do not copy it into `TileIntent` and do
  not persist it in canvas v2 records.
- Geometry flows one way: intent + derived view constraints → `canvas-layout-intent.ts` →
  `CanvasLayoutService.computeLayout()` → `CanvasWorkspaceGridComponent` `grid.update()`. No compact
  logic in Gridstack event handlers.
- `TileLayout` stays `{ x, y, w, h }` (tribunal-panel consumes it).
