# Gate 1.7 design re-review — round 2 and Delta 1

**Verdict: APPROVED. Score: 9/10.** No Blocking or Serious design finding remains. The prototype check exits 0, and the theme audit reports 34 pass, 0 fail. This approval covers the round-2 and Delta-1 design; the later Delta-2 thread-switcher options are outside this review.

## Round-1 new findings

| # | Result | Evidence |
| --- | --- | --- |
| 1 — lane navigation | **Fixed** | `design-spec.md:499-505,1119-1123`; `prototype/ROUND-2-NOTES.md` finding 1; `dark-lane-opened.png` shows the concrete lane view with focus on `h2#laneTitle`, and `capture.mjs checks` passes row selection, Open lane, overlay closure and return. Electron omits the lane action. |
| 2 — other themes' contrast | **Fixed as a specification** | `design-spec.md:804-807,1124` gives the generated theme tokens and implementation guard; `node prototype/assets/contrast-check.mjs themes` exits 0 with **34 themes, 34 pass, 0 fail**. The script measures status text and meaningful focus/UI pairs against the specified 4.5:1 and 3:1 criteria. Installing those tokens and the guard is an implementation check. |
| 3 — missing question card | **Fixed** | `design-spec.md:503-504,1125`; `prototype/ROUND-2-NOTES.md` finding 3; `dark-question-card-missing.png` shows the retained request, error and Retry. Checks pass for Electron and Rail at wide and 400 px, including focus after recovery. |
| 4 — resize/session-switch closure | **Fixed** | `design-spec.md:1126`; `prototype/ROUND-2-NOTES.md` finding 4; `dark-resize-closed.png` shows the closed sheet and focused opener. Checks pass for width-band transition, missing opener fallback and session switch. |
| 5 — multi-message activity | **Fixed as a specification** | `design-spec.md:353-362,1127` keeps labelled per-message duration, tokens and cost, plus an aggregate. Persisted message fields remain an architect check. The single-message `Message duration` correction is also present at `:353-355`. |
| 6 — live line | **Fixed** | `design-spec.md:1128`; `prototype/ROUND-2-NOTES.md` finding 6. Checks pass for reference, streaming and answered states, with and without pending requests. |

## TASK section review

`design-spec.md:521-597` defines the section between AGENTS and TODOS. The linked, multi, loading, error, partial, notfound, openfail, live and none states are exercised in `capture.mjs checks` at wide and 400 px; the checks report native document buttons, ordered Tab stops, targets at least 24 px, focus ring, no horizontal overflow, Retry and in-place live update. `dark-task-linked.png` and `light-task-error.png` show the principal visual states. The section uses the measured status/link tokens (`design-spec.md:546-552`) and keeps the Tasks board out of the chat bundle (`:592-595`).

The underlying contracts support a frontend reader: `SessionOrganizationSummary.tasks[]` contains task links with `taskId` and `role` (`libs/shared/src/lib/types/session-organization.types.ts:91-100,115-126`); `session:linkTask` accepts a task ID and role (`rpc/rpc-session.types.ts:156-174`); `tasks:get` returns `TaskSpecDetail | null` (`rpc/rpc-tasks.types.ts:55-60`, `rpc.types.ts:2348-2353`), whose `artifacts` are filenames (`task-spec.types.ts:192-197`). `tasks:changed` includes workspace root and optional folder names (`rpc/rpc-tasks.types.ts:749-757`). The board store ignores that push while its surface is closed (`libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1120-1129`), so the proposed inspector consumer is necessary.

## New findings

None at Blocking or Serious severity. The contract and host details below need resolution during architecture; they do not require a different visual design.

## Architect checks

1. **Link read path and host coverage:** `design-spec.md:526` calls the organization field `taskIds`; the actual wire summary has `organization.tasks[]` with `taskId`, `role`, `createdAt` and `missing` (`session-organization.types.ts:91-100,115-126`; `execution/node.ts:259-261`). Use that shape, select the primary link, and decide how an unavailable organization source is handled. `rpc-session.types.ts:118-128` says VS Code may report `organizationAvailable: false`; `apps/ptah-extension-vscode/src/di/session-organization-unavailable.spec.ts` covers the unavailable host. Verify link-change refresh as well as initial read.
2. **Editor open path:** `editor:openFile` exists (`rpc.types.ts:872-875`). The git launcher calls it with `{target, workspaceRoot, path}` (`libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts:138-149`); `EditorOpenFileParams` requires `target` and `path` and defaults to workspace path scope (`rpc/rpc-editor.types.ts:71-86`). Choose the editor target and verify registered-workspace path authorization and Electron/Rail/VS Code behavior before wiring TASK buttons. The prototype's silent success and row-level failure remain the intended UX.
3. **Live reader and bundle:** Subscribe to `tasks:changed` independently of `TasksStoreService.surfaceOpen`; filter by workspace/folder, refresh the lead and any displayed related status as appropriate, and expose presentation helpers through a narrow entry point. Confirm the lazy inspector does not pull the Tasks board into chat (`design-spec.md:569-576,592-595`).
4. **Implementation contrast and data:** Install the per-theme tokens and extend the contrast guard described at `design-spec.md:804-807`; verify per-message fields after reload (`:356-362`), the Stage helper location (`:553-556`), and the effective contrast of the existing reduced-opacity user-turn time (`:1150`).

## Removals / visibility changes for the user

- No capability removal is proposed (`design-spec.md:1133,1148`).
- B-8/B-11/B-12 move behind **Show activity**, with per-message values preserved; the user approved this (`decisions.md:27`, `design-spec.md:347-362`).
- B-16 **You** and time remain visible at rest (`design-spec.md:1142`; `capture.mjs checks` passes both turns).
- B-14/B-15 Branch/Rewind retain today's hover reveal. The existing invisible keyboard-focus state is a user-accepted limitation, not a newly approved focus behavior (`decisions.md:27`, `design-spec.md:337-345`; capture checks opacity 0 at rest/focus and 1 on hover).
- The TASK section is a new capability; TODOS remains below it (`design-spec.md:521-524`).

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Approve Gate 1.7 for round 2 plus Delta 1. | APPROVED; REVISE. | Six earlier findings are closed above; requested browser checks pass; all 34 theme checks pass; no new Blocking or Serious defect is supported. | Yes. |
| Keep integration uncertainties as architect checks. | Treat unchosen target/read path as a Serious design defect; resolve against actual RPC and host contracts during implementation. | `design-spec.md:563-577,592-595` already marks these `[verify]`; `rpc-editor.types.ts:71-86` and `session-organization.types.ts:115-126` supply the concrete contracts. | Yes. |
| Honor the user's visibility decisions and record the keyboard-focus limitation. | Reinstate focus reveal; retain today's hover behavior. | `decisions.md:27`, `design-spec.md:337-345,1142-1144`; capture checks match the selected behavior. | Yes. |

## Verification scope

Ran `node prototype/assets/capture.mjs checks` (exit 0; all reported PASS) and `node prototype/assets/contrast-check.mjs themes` (exit 0; 34 pass, 0 fail) from this worktree with `NODE_PATH=D:\projects\ptah-extension\node_modules`. Viewed five PNGs: `dark-task-linked.png`, `light-task-error.png`, `dark-lane-opened.png`, `dark-question-card-missing.png`, `dark-resize-closed.png`. The symbol index had zero symbols, so a targeted `rg` fallback was used to inspect RPC and store contracts.
