# TASK_2026_681_738f — context

Named follow-up task "TASK_2026_677 follow-ups" from TASK_2026_677_efcd (clean session view), created at its
completion (TASK_2026_677 decisions rows 104, 106, 107, 108; handoff-8 §4.3). Every item below was triaged as
Moderate or Minor: it cannot break a lane config or lose data, so lean rule 4 moved it out of the 677 fix round.
Source reviews are in `.ptah/specs/TASK_2026_677_efcd/`.

## Items

| # | Source | Finding | Location |
| --- | --- | --- | --- |
| 1 | `code-logic-review.md` Moderate 3 (codex) | Task cache is keyed by `taskId` only | `libs/frontend/chat/.../session-task-reader.ts:60-69,101-105` |
| 2 | `code-logic-review.md` Moderate 4 (codex) | "Answer" cannot reach an unmounted question card (the 1 s miss path of row 83 works) | `chat-view.component.ts:1015-1027` |
| 3 | `code-logic-review.md` style Moderate | `SESSION_WORKFLOW_ADDONS` entry types `component: Type<unknown>` | `chat/src/lib/tokens/session-workflow-addons.token.ts` |
| 4 | D-1 review Moderate 5 | Null-session expansion key | chat-ui inspector stats (see `reports/batch-FIX-3.md`) |
| 5 | `code-logic-review-B-5.md` Minor 4 (grok) | Branch title missing in the compact sheet | `canvas-rail-board.component.ts` |
| 6 | `code-logic-review-fixes.md` Moderate 1 (grok) | Rail inspector cue `needsYou` is hard-coded to 0 | `canvas-rail-board.component.ts:338` |
| 7 | `code-logic-review-fixes.md` Moderate 2 (grok) | Sheet Tab trap queries the first `[role="dialog"]` | `canvas-rail-board.component.ts:736-741` |
| 8 | Visual review | Showcase `data-testid="canvas-tile"` missing (also on main) | canvas showcase |
| 9 | Bundle (row 107) | ~130 kB eager growth vs the 3.49 MB baseline; budget raised to 3.7 MB. Candidate: `@defer` the turn activity panel | `apps/ptah-extension-webview/project.json:61` |
| 10 | Row 71 | CSS variable `--sel` is used but never defined | chat-view styles |

Line numbers refer to the TASK_2026_677 branch tip `feat/clean-session-view`; confirm them on main after the
677 PR merges.
