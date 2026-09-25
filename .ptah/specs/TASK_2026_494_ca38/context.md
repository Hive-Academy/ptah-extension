# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4, Revision 5 and Revision 6 first. They replace the earlier revisions
where they disagree.

Lane A. Depends on: TASK_2026_492 (design), TASK_2026_493 (contract).

## Deliverables

1. Frontend feature lib for the page (`scope:webview`, `type:feature`) and a UI lib for the catalog renderer (`scope:webview`, `type:ui`). Signals, standalone, OnPush.
2. New `ViewType` and one tab in `electron-shell.component.ts`. The VS Code shell must not reach the view.
3. The page registers an interactive surface in `StreamingSurfaceRegistry`, as the harness builder does (`harness-builder-view.component.ts:306,315`).
4. Sort, filter and page operate in the component and do not call the model.
5. The app sends its selection state to the host, so the agent context has it.
6. Accessibility from the design specification. Invalid, oversized or old specs show the text fallback.

## Gate

Cold start time does not change when the page is not open (lazy load).

## Source

`.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 4 Track A and Revision 5. `.ptah/specs/TASK_2026_490_583c/ptah-integration-seams.md` sections 3, 4, 6.

## User Request

orchestrate task 494 in a new worktree of main

## Task Type

FEATURE

## Complexity

Complex

## Strategy

FEATURE, Full depth: project-manager → software-architect → team-leader → developers → QA.
Research (TASK_2026_490) and design (TASK_2026_492) are done, so researcher and designer are skipped.
Worktree: `.claude-worktrees/feat-task-494-apps-page-98c5a1802772`, branch `feat/task-494-apps-page`, based on `main` at 34dd972f8.

## CLI Lanes

Mode: enabled

| Agent | Type | Status | Capabilities |
| ----- | ---- | ------ | ------------ |
| codex | cli | installed | messaging: queue, role delivery: preamble/developer-instructions |
| copilot | cli | disabled (installed) | messaging: queue, role delivery: preamble/task-prompt |
| cursor | cli | not installed | messaging: interrupt, role delivery: preamble/task-prompt |
| antigravity | cli | installed | messaging: queue, role delivery: preamble/task-prompt |
| opencode | cli | installed | messaging: none, role delivery: preamble/task-prompt |
| pi | cli | not installed | messaging: steer, role delivery: preamble/task-prompt |
| Glm | ptah-cli | available | provider: Ollama Cloud, ptahCliId: pc-355b645d-35af-4974-84cf-9cf961ea0164, messaging: queue, role delivery: preamble/system-prompt |

## Conversation Summary

- Dependencies TASK_2026_492 (design spec) and TASK_2026_493 (contract, PR #565) are merged on `main`.
- Placement (user, Gate 1 discussion): keep the full-page Apps tab with its own conversation. A sidebar beside the coding chat (the user's earlier generative-UI idea, similar to the agent monitor) is not part of this task.
- Gate 1 APPROVED. `implementation-plan.md` written. Research lanes: `research-property-hub-agent-ui.md` (codex), `research-chat-visual-output-history.md` (Glm).
- Gate 2 reopened by the user (2026-09-23): the Apps page must let the agent build forms, sections, lists and selects with two-way UI/agent state. Decision: **contract v2 first**. This task is `blocked` on `TASK_2026_538_3ccf`. When it lands, the software-architect revises this plan (D3 intake, D4 selection channel -> general surface state channel, renderer view model for v2); D1, D2, D5, D6, D7 and the display renderers stay. Implementation has not started; no team-leader run yet.
- TASK_2026_538 Gate 1 passed (2026-09-23, other session). Worktree `.claude-worktrees/feat-task-538-surface-contract-v2`, branch `feat/task-538-surface-contract-v2`. Its `task-description.md` Requirement 12 is the handoff for this plan's revision (D3, D4, view model). Decisions there: `ptah_dashboard_propose_spec` stays and feeds the same store and push as v2; the `getActiveWebviews()` fix lands in 538 for the Electron and CLI adapters (drop Component 7 here); one in-memory store keyed by `tabId` on all three hosts. Still open in 538: the busy rule for submit, whether D4 selection injection survives, and store release on tab close or LRU.
- TASK_2026_540 Gate 2 passed (2026-09-23, other session, branch `feat/task-540-global-config-menu`). Effect on this task: the Electron tab row becomes Chat, [Apps slot], Tasks, Tribunal, Analytics ("Chat" and "Analytics" replace the labels "Canvas" and "Dashboard"). The Apps slot is ONE comment between the Chat and Tasks tab buttons in `electron-shell.component.ts`; replace that comment with the Apps tab button (plan Component 2) and move nothing else. 540 does not touch `webview-surface.types.ts` or `app.routes.ts`. Router batch 3 is not needed by 540. Merge order: 540 first, then 533 (marketplace); rebase this branch on 540 before implementation.
- 2026-09-25: TASK_2026_540 merged (PR #586) and TASK_2026_538 merged (PR #596, `9afac1aa2`). Branch fast-forwarded to
  `origin/main` at `9afac1aa2` (no own commits existed). Status blocked -> in_progress. The binding input for the plan
  revision is `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md` (Revision 1): D3 -> `surface:updated` generic routing-id
  inbox; D4 -> `surface:*` RPC (Component 8 dropped almost entirely); Component 7 delivered; renderer view model for 13
  kinds with materialized-revision reconciliation (Rules 1-4). Software-architect revision started.
- Plan Revision 2 written (1,086 lines, R1-R11). Decisions: generic `SurfaceUpdateInbox` in `@ptah-extension/chat-routing`
  (no `/services` subpath); Components 7 and 8 deleted (494 adds no backend file); no selection injector, the agent
  pulls with `ptah_surface_get_state` (prompt pinned by spec); `surface:release` deferred to 539/follow-up; a stale field
  change is not auto-resent; submit waits for pending echoes; surface switcher when >1 surface; Apps tab at
  `electron-shell.component.ts:136`. Open: task-description Req 6.2/6.3 still say the turn "receives" the selection.
  Awaiting Gate 2.
- Gate 2 (Revision 2) APPROVED by the user (2026-09-25) with "fix Req 6": orchestrator rewrote task-description.md Req 6
  criteria 1-6 and the scope bullets for v2 (selection via `surface:select`, agent reads via `ptah_surface_get_state`,
  no new host channel). Next: team-leader decomposition (Mode 1) into batches.md.
- Team-leader Mode 1 done: 19 batches in batches.md (B1 IN_PROGRESS). Plan validation PASS WITH RISKS; 4 plan defects
  fixed by ordering/task notes (routing spec restructure in 16.1, B17 after B16, B14 before B15, B3 exports types).
  Open for the user: visual source for completion (no prototype exists) and CLI lane quotas.
- User decisions (2026-09-25): (1) "Prototype first": a ui-ux-designer builds an HTML prototype of the Apps page
  (dark + light) under this task's `prototype/` folder before B15 (page); the user reviews it; completion screenshots are
  checked against it. (2) CLI lane pool: opencode, Glm, codex, antigravity, plus orchestrator subagents at discretion.
  Rotate lanes so a batch's reviewer is never its executor; if a lane hits a quota, fall back to another pool member.
- Prototype delivered (prototype/index.html, states.html, README.md, 10 screenshots). User is reviewing it (2026-09-25);
  NOT yet approved, and the two designer proposals (narrow stacking <480px, no colored small rejected-state text) are
  undecided. B15 must not start until the prototype is approved. Orchestrator notes for B15: chart "Expand" must be a
  client-only toggle (host returns unsupported for dashboard.* except select); the table must show the pager (page size 25).
- Batch 1 committed `c9b6eddd2` (code-logic APPROVED 8/10, 0 fix rounds; test-strength notes M1-M3 deferred to B12).
  Batch 2 (lib scaffolds) running with the frontend-developer subagent.
- 2026-09-25: user APPROVED the prototype ("design is approved") -> it is the visual source for B15 and completion,
  including the designer's two proposals (narrow stacking <480px; rejected-state color on icon + spine only). Commit
  prototype/ with the next batch commit.
- User addition (B15 scope): a splitter between the Apps conversation column and the surface panel. Reuse
  `ElectronResizeHandleComponent` (`ptah-electron-resize-handle`, `libs/frontend/chat-ui/src/lib/atoms/electron-resize-handle.component.ts`,
  exported from `@ptah-extension/chat-ui` index.ts:12; chat-ui is type:feature, so feature->feature import is allowed;
  used in electron-shell.component.ts:232,253). Notes: (1) the handle emits a viewport-relative width (pointer X), so
  the page subtracts its container's left offset; (2) clamp (prototype default 360px, sensible min/max so the surface
  panel stays usable); (3) Escape/blur restore is built in; (4) the handle has no keyboard resize -> page adds
  arrow-key resize and aria-valuenow/min/max on the separator if design-spec "Accessibility" requires keyboard-operable
  separators; (5) persist the width like the other Electron panel widths (ElectronLayoutService pattern,
  electron-layout.service.ts:145-196) or in the Apps page state - team-leader decides without widening B15 past 6 files;
  (6) hidden when the layout stacks below ~480px.
- Follow-ups created: `TASK_2026_539_67f5` (render surfaces in the coding chat, depends on this task), `TASK_2026_540_0940` (apply the TASK_2026_492 navigation sets, global configuration menu).

- 2026-09-25: Glm/Ollama Cloud weekly limit reached; opencode Go exhausted; lane pool = codex, antigravity, subagents.
- 2026-09-25: B13 round 2 APPROVED (code-logic-reviewer 9/10, antigravity 9/10); committed. B7 round 2: codex APPROVED 8/10, subagent pending.
- 2026-09-25: B13 committed a652f510c. B7 round 2 APPROVED (code-logic-reviewer 8/10, codex 8/10); committed; B8 IN_PROGRESS.
