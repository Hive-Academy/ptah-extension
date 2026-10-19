# TASK_2026_706_f625 - Polish the Voice canvas and give it more room

Follow-up to TASK_2026_700_dcce (PR #773, merged). Worktree:
`D:/projects/ptah-extension/.claude-worktrees/voice-canvas-polish`, branch `feat/voice-canvas-polish`.

## User request (2026-10-19)

- Replace the `P` on the root sphere with the real Ptah logo.
- Easy canvas enhancements without new dependencies: orbit cleanup, glow behind Ptah,
  flowing links (orchestrator recommendation items 1-3, user agreed).
- "Leave everything in place, reduce the panels sizes a bit and give the canvas more room."
  No full-background canvas, no floating panels.

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| E1 | Logo asset: the one the app shell uses, `VSCodeService.getPtahIconUri()` from `@ptah-extension/core` (resolves in Electron and VS Code). Draw it clipped to the root sphere; keep the Georgia `P` as the fallback until the image loads or when it fails. | orchestrator |
| E2 | Orbit guides: remove the near-duplicate ellipse (0.405 vs 0.425 width); draw only the track(s) the current layout uses; make guides fainter. | user-agreed item 1 |
| E3 | Glow: soft radial gradient behind the root, size follows the existing voice `inputLevel` / `outputLevel`; static when `prefers-reduced-motion: reduce`. | user-agreed item 2 |
| E4 | Flowing links: animate `lineDashOffset` on links and ownership tethers, direction root -> work; static when reduced motion. | user-agreed item 3 |
| E5 | Panel sizes (same positions, same breakpoints): header 78 -> 60px, gutters 22 -> 16px, deck gap 16 -> 12px, dock gap 14 -> 10px, rail 336 -> 296px (260 -> 240px at <=1000px), dock desktop row about 84px, rail and dock body text one step smaller. Stage minimums unchanged. | user request |
| E6 | Text contracts asserted by specs stay unchanged (N1 rule from TASK_2026_700). D7 and D9 stay binding. | project rule |

## Batches (file-disjoint, run in parallel, lanes run no nx/jest)

| Batch | Files | Status |
| --- | --- | --- |
| S scene | `scene/sprite-cache.ts`, `scene/command-scene-decoration.ts`, `scene/command-scene-renderer.ts`, `scene/command-scene-status.ts`, `scene/command-scene.component.ts`, `scene/scene-layout.ts` (export only) and their specs | done |
| P panels | `components/command-center-page.component.css/.html/.spec.ts`, `command-center-header.component.ts/.spec.ts`, `command-dock.component.ts/.spec.ts`, `command-session-controls.component.ts/.spec.ts`, `command-voice-hud.component.ts/.spec.ts`, `command-node-detail.component.ts/.spec.ts`, `command-work-list.component.ts/.spec.ts`, `command-session-stats.component.ts/.spec.ts` | done |

Then: orchestrator checks (typecheck, lint, test for `command-center`, alpha guard, degradation
audit 294) -> Anthropic `code-logic-reviewer` -> at most one codex fix round -> commit ->
Electron check dark + light at 1440x900, 900 and 700 -> PR.

## Status

- S and P implemented in parallel; orchestrator checks passed.
- Review NEEDS_FIXES 7/10 -> one codex fix round (frame cap, off-screen pause, layout orbit
  count, NaN clamp, tether direction, 11px rail text) -> open F1 (non-idle voice states
  bypassed the frame cap) -> one orchestrator bounded correction -> APPROVED.
- Checks: typecheck, lint 0/0, 553/553 tests, alpha guard 11/11, degradation audit 291 (main
  baseline, not raised), ptah-extension-webview typecheck pass.
