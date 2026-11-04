# Decisions — TASK_2026_871_0d04

| # | Decision | Evidence / source |
|---|----------|-------------------|
| D1 | Type FEATURE, depth Full. | Redesign of an existing surface with unclear scope across 5+ files; no `Routing:` reminder present. |
| D2 | Lanes `enabled`, approval mode `lane-review`. | Memory `orchestration-executor-preference`, `lane-review-approval-mode`; codex has confirmed room. |
| D3 | Frontend code is written by Claude subagents; codex lanes write documents and review code. | Memory `agent-lane-review-workflow` (frontend-specific, more specific than the general lanes-first preference). |
| D4 | TASK_2026_606_b6b7 is folded into the revamp phase. TASK_2026_358 runs as a later phase: its backend runner is independent of the restyle, and the revamp reserves the run surface. | 358 is XL backend work (persistence-sqlite, cli-agent-runtime); 606 is an XS change in tasks-ui. User asked to include both. |
| D6 | Gate 1 passed (lane-review). Author: codex PM lane. Reviewer: in-process subagent (Claude). APPROVED, minor only; findings 5-7 applied to acceptance criteria 3a, 6, 7/7a by the orchestrator. | `task-description-review.md` |
| D7 | Gate 1.7 passed (lane-review) after revision round 1. Author: codex designer lane. Reviewer: in-process subagent. Round 0 REVISE (2 Blocking, 4 Serious); round 1 APPROVED, finding 7 partial (Minor). Blue/teal primary confirmed as real `anubis`/`anubis-light` values. | `design-spec-review.md` |
| D8 | User approved the prototype explicitly (2026-11-03), in addition to the lane-review Gate 1.7 pass. | User message in session. |
| D9 | Gate 2 passed (lane-review) after revision round 2 (cap reached, closed). Author: codex architect lane. Reviewer: in-process subagent for rounds 0-1 (REVISE: port lacks lstat/realpath/bounded read; `rejected` state; B1 registration sites — then 1 partial: `MemoryFiles` missed). Round 2 fix verified by the orchestrator (in-process, opposite side) with an independent grep: the plan's B1 census is a superset of the orchestrator's list (Electron/CLI adapters, core mock + contract, `MemoryFiles`, plus 3 typed literals). No platform-vscode project exists. | `implementation-plan-review.md`, `implementation-plan.md:30-38,151` |
| D5 | Both related tasks stay as their own task folders and are linked by `relatesTo`. | Keeps their history; parentage would be invalid if either gains a parent later. |
