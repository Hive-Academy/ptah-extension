# Context - TASK_2026_682_f705

Follow-up of TASK_2026_649_33c4 (epic TASK_2026_647_1b0f). The 649 code-logic review closed with
APPROVED (8/10) after one fix round (`66e4227d6`) and one bounded correction (`0df579dbb`). The
revise cap was used, so the user chose (2026-10-16) to move the open items here instead of
another correction in the 649 PR.

Source of truth for every item, with file:line and failure scenario:
`../TASK_2026_649_33c4/code-logic-review.md` (sections "Moderate", "Minor",
"Re-review of 66e4227d6", "Final review of 0df579dbb").

## Open items

| ID | Sev | One-line |
| --- | --- | --- |
| N5 | Moderate | `harness-proposal-hydration.service.ts` `recompute`: the N2 fix removes the field from `pending` when an unattributed revision touches it, so a later attributed revision whose turn started before the user's choice overrides the choice (D9). Keep the field pending after the early re-apply |
| N6 | Minor | `harness-workflow-request.service.ts`: the resumed-intake banner on the builder page is never cleared and has no Dismiss |
| M1 | Moderate | The attribution service is built lazily with the store, so the first proposal after app start has no turn start (check if the `ChatSessionService` injection from `66e4227d6` already fixes this) |
| M3 | Moderate | The pinned root can be the caller-declared MCP URL root, not checked against open folders |
| M4 | Moderate | `chooseLeave` ignores the `completePendingIntent` outcome; no progress while `startNewProject` runs |
| M5 | Moderate | State leaks and an init race when the route param changes on the same view instance |
| M6 | Moderate | In the hydration `error` state the preview is frozen, Apply still runs on it, "Added to preview" is announced without effect |
| M7 | Moderate | `sweepOrphans` is never called; tab close and session delete never `clearTab` |
| M9 | Moderate | The a1 abort warning and c1 relay errors only render on the Hub |
| M2 | Moderate | Partly covered by `sameWorkspaceRoot` in `0df579dbb`; re-check the attribution hook cwd compare |
| m1-m6 | Minor | See "Minor" in the review |

M8, M10 and M11 were fixed in 649 (`66e4227d6`, `0df579dbb`).

## Open visual items

Source: `../TASK_2026_649_33c4/visual-review.md` (findings 4-8 and "Minor"). Findings 1-3 were
fixed in 649 (batch F3).

| ID | Sev | One-line |
| --- | --- | --- |
| V4 | Moderate | Narrow peek bar has no status ("Ready to apply", "Needs your answer"...), no ready dot on the wide toggle; the open sheet shows two "Configuration" headers |
| V5 | Moderate | Prototype Lucide icons replaced by text and glyphs (`↻`, `×`, chevrons); Discard has no trash icon |
| V6 | Moderate | Empty AI Team Builder chat shows the generic welcome with unrelated quick prompts |
| V7 | Moderate | At 1280x480 with a question card open the composer is pushed below the viewport |
| V8 | Moderate | Sidebar "SESSION" toggle and "Expand stats" button are 18 px tall (spec 24 px) |
| v1-v7 | Minor | Config summary counts, "Hide panel" label-in-name, red "Open leave choices" (Hub style, D10), seed run-on and missing platform, leave dialog `min-h-10` ignored at 432 px, no top-nav highlight on builder pages, plain notices |
| F3-L | Moderate | Hydration (F3): a proposal lost before the app run saw it shows the neutral empty state, not "unavailable" (no durable proposal reference) |
| F3-m1 | Minor | `knownProposalSessions` is never cleared, also not in `clear()` |
| F3-m2 | Minor | `leaveTrigger` is never reset (`harness-builder-view.component.ts:344,514`), so a Hub switch dialog can return focus to "Start over" (older than F3) |
| F3-m3 | Minor | Preset select: `focus-visible:` may not match mouse focus on a `<select>`, so a clicked select can show the faint DaisyUI outline |
| F3-m4 | Minor | No spec opens the real leave dialog through the Hub switch path |

| F6-m1 | Minor | `harness-workflow-message.handler.ts`: a failed lazy-chunk load of the request or hydration service is only logged; the user sees nothing |
| F6-m2 | Minor | `vscode.service.ts`: after a swallowed `set-state` failure in the Electron main process, `getState` keeps serving the unsaved value until reload |

F6 items come from "Review of 79af325bc, 5bbb40bac, adf6aa5d6 (F5/F6)" in
`../TASK_2026_649_33c4/code-logic-review.md` (M1 was fixed in 649).

F3 items come from "Review of ff2ea4f81 (F3)" in `../TASK_2026_649_33c4/code-logic-review.md`.
