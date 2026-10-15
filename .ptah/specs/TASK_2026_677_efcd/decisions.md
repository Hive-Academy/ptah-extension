# Decisions — TASK_2026_677_efcd

| # | Decision point | Decision and evidence |
| --- | --- | --- |
| 1 | Gate 0.1 lanes | Enabled, review only; approval mode lane-review. Source: user instruction (Claude implements the frontend, CLI lanes only review). Reviewer: codex (confirmed room). |
| 2 | Classification | FEATURE, Full depth: new inspector surface + replacement of the compact turn view (parity-inventory.md required). |
| 3 | Testing | User postponed testing: no new spec-writing batches; T2 (R9 parity tests) postponed. Existing suites, typecheck and lint of every changed project still run (CLAUDE.md). |
| 4 | Scope | Follow-up T1 of TASK_2026_629 widened with the user's clean-turn view and the "This session" inspector (screenshots in reference/). PM and designer run in parallel because the screenshots fix the target. |
| 5 | Prototype source | The screenshot prototype is not in the repository (grep "Desktop shell redesign" / "Worked for 4m 12s": no match), so the designer rebuilds it from the screenshots on the repo's design system. |
| 6 | Design (Gate 1.7, round 0) | ui-ux-designer (Claude) wrote design-spec.md + prototype/ (anubis / anubis-light, lucide + provider marks, 14 screenshots). Codex cross-side review REVISE 5/10 (design-spec-review.md): Blocking parity/removals table missing; Serious permission/question routing, inspector data contract (needs-you de-dup, todos per item, ahead/behind), overlay focus in prototype; Moderate Review target 22 px, 6 px fidelity offset, light focus-ring row. Revise round 1 of max 2 is next. |
| 7 | PM step | pm-clean-view stopped without deliverables: its three helper explorations reported to the orchestrator, not to it, so it waited forever. Helper findings are condensed in handoff-1.md §4; the next PM run uses them instead of exploring again. |
| 8 | Handoff file name | handoff-1.md per the user's standing rule (never HANDOFF.md), although the session-budget banner asked for HANDOFF.md. |
| 9 | Backend data gaps (from helpers + designer) | No source today: numeric lane progress ("212 of 340"), live background Bash shells (only pendingBackgroundTasks after a turn), per-lane activity string for CLI lanes (derive from last `segments` entry), ahead/behind per session (GitStatusService is workspace-wide), per-item todos (summarizeTodos returns counts; parseTodoList exists), live turn start time, gemini CliType/mark. Default: hide or derive in the frontend; no backend work without a recorded decision. |
