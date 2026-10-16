# Implementation plan review (Gate 2)

Verdict: REVISE
Score: 7/10
Reviewer: codex

## Findings

1. **Serious — batch ownership contradicts the single-owner contract.** The plan says each file has exactly one owning batch (`implementation-plan.md:118`), but `chat-ui/src/index.ts` belongs to C-1 and A1-1, `chat/src/lib/services/index.ts` to C-2 and B-3, and `chat/src/index.ts` to C-2, B-3 and B-4 (`implementation-plan.md:138-145,157-168`). The only stated shared-file exception is CV-1 → CV-2 → CV-3 (`:120-130`). Give each barrel one owner with prerequisites ready, or explicitly revise the ownership contract and serialize every shared barrel. Other listed dependencies follow their order (`:204-225`).
2. **Serious — the session-switch stagger omits required turn items.** The design calls for the user bubble, disclosure, answer, chips and actions as individual DOM-order items, with turns beyond the eighth sharing the capped delay (`design-spec.md:745-757`; `task-description.md:503`). A2 animates whole `.chat-msg-slot` wrappers only for `:nth-last-child(-n+8)`; earlier slots receive no animation (`plan-part-a2-header.md:65-79`; `implementation-plan.md:341`). Revise D-A2-2 and its CSS plan. The `resolvedTabId` trigger has a sound first-send rationale (`chat-view.component.ts:798-807`).
3. **Moderate — the canonical requirement still contradicts the settled empty-TASK behavior.** Row 44 says render nothing, and the plan adopts it (`decisions.md:49`; `implementation-plan.md:243-245`), while requirement 17.6 explicitly requires an empty-state message and its risk text repeats it (`task-description.md:640,852`). Update the PM-owned requirement and risk text before implementation so verification has one result.

Checked source claims hold for compact-card switching, live timestamp assignment, git-state shape, lane-owner imports, Rail details control, the assistant time line and transcript agent-node keys (`chat-view.component.ts:974-978`; `message-finalization.service.ts:215-242`; `session-git-stats.store.ts:55-69`; `canvas-lane-tabs.component.ts:21`; `canvas-focus-header.component.ts:57-64`; `message-bubble.component.html:22-31`; `chat-transcript.component.ts:181-192`). The §2.2 avatar, roster, inspector-store and shell contracts align with the cited parts; dot precedence and overlay closure apply row 38 (`implementation-plan.md:58-113,249-258`; `decisions.md:42`). The registry token is compatible with 648's `ngComponentOutlet` and child injector, whose template does not project into ChatView (`implementation-plan.md:293-323`; 648 `session-embed.component.ts:40-44,76-98`). Planned imports preserve canvas → chat and public aliases; prohibited host files are excluded (`implementation-plan.md:19-23,320-323`). Angular, icon, mark, changed-project verification and the single authorized build placement are specified (`implementation-plan.md:19-23,157-171,224-225,356-381`). Parity keep/move rows have documented destinations; no other unflagged removal was found.

The eighth source spot check confirms the old todo aggregation to be moved exists at `canvas-session-details.component.ts:125-143` (`implementation-plan.md:197`).

## Deviation rulings

| ID | Ruling | Evidence |
| --- | --- | --- |
| D-A2-1 | ACCEPT | Sidebar control stays in app-shell; the new header cannot own its private state (`implementation-plan.md:340`; `plan-part-a2-header.md:11-25`). |
| D-A2-2 | REJECT | Whole last-eight slots omit earlier turns and the specified per-element stagger (`design-spec.md:750-757`; `plan-part-a2-header.md:76-79`). |
| D-A1-1 | ACCEPT | Live finalization omits a timestamp; message start aligns saved and history timing (`message-finalization.service.ts:227-240`; `implementation-plan.md:343`). |
| D-A1-2 | ACCEPT | Duration sits on the last new root; max over finite message terms follows the requirement (`message-finalization.service.ts:215-239`; `task-description.md:910`). |
| D-C-1 | ACCEPT | Neutral `Workflow` is the specified fallback while no authoritative provider field exists (`design-spec.md:1092`; `task-description.md:857`). |
| D-C-2 | ACCEPT | CLI display name follows the compact-lane fallback (`implementation-plan.md:345`; cited `compact-lane-rows.ts:68`). |
| D-C-3 | ACCEPT | Pending/paused → queued is documented; waiting stays tied to open requests (`plan-part-c-agents.md:111-113,132-144`). |
| D-C-4 | ACCEPT | `ownedBySession` moves with importer preserved (`canvas-lane-tabs.component.ts:21`; `implementation-plan.md:347`). |
| D-C-5 | ACCEPT | No exposed live background-command source exists in scope (`decisions.md:13`; `implementation-plan.md:348`). |
| D-B-1 | ACCEPT | Tasks-board path uses `FILE_LINK_OPENER` with artifact-list validation (`tasks-store.service.ts:1351-1376`). |
| D-B-2 | ACCEPT | Rail board owns its aside; old details capabilities move to inspector (`implementation-plan.md:51,166-171,350`; `parity-inventory.md` D-1–D-11). |
| D-B-3 | ACCEPT | Formal requirement selects latest link when none is primary (`task-description.md:61,617`). |
| D-B-4 | ACCEPT | User row 44 supersedes old empty-state text (`decisions.md:49`; `implementation-plan.md:243-245`). |
| D-M-4 | ACCEPT | 648 hosts ChatView through `ngComponentOutlet`; registry reaches both hosts and keeps slot positions (`implementation-plan.md:281-318`; 648 `session-embed.component.ts:40-44`). |

## Proposed Removals

- **R1, already routed to the user:** assistant avatar, “Claude” and per-message time line are removed; single-message turns lose that separate time display (`implementation-plan.md:354`; `message-bubble.component.html:22-31`). No ruling here. No other unflagged removal was found in the keep/move inventory.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Require one owner per shared barrel, or document serialized shared-barrel ownership as an explicit exception | One final barrel batch; documented serialization | `implementation-plan.md:118,138-145,157-170` | Yes |
| Reject D-A2-2 until DOM-order stagger is restored | Per-element capped stagger; seek a spec change for whole-slot motion | `design-spec.md:750-757`; `plan-part-a2-header.md:76-79` | Yes |
