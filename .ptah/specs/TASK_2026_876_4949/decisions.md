# Decisions — TASK_2026_876_4949

| # | Decision | Source / evidence |
|---|----------|-------------------|
| 1 | Type FEATURE, depth Full | Request adds behavior + a new sidebar UI section; orchestration rules |
| 2 | Old session: stop after its turn ends, mark Handed off, nest under new session; no delete | User answer (AskUserQuestion) |
| 3 | Sidebar: Linked sessions section with full handoff chain, clickable | User answer (AskUserQuestion) |
| 4 | Lanes enabled, approval mode lane-review | Memory `orchestration-executor-preference`; CLAUDE.md user prefs (save Claude usage) |
| 5 | Executors: grok / antigravity / opencode; never codex/copilot; Glm, kimi at limit | Memory `cli-lane-executor-preferences`; ptah_agent_list |
| 6 | Cross-side doc review done by a different-vendor lane, not a Claude subagent | User global CLAUDE.md: prefer lanes over subagents (Claude usage limit). Weaker-evidence label: lane-vs-lane review |
| 7 | PM + investigation combined in one lane to save calls | Token economy |
| 8 | Task folder moved from main checkout into the worktree (`diff -rq` identical, then removed from main) | CLAUDE.md worktree rule; `.ptah/specs/**` is tracked (`.gitignore:127`); user asked "are we working on the main checkout" |
| 10 | Gate 2 APPROVED by user. No "Handed off" group in the session sidebar in this task; possible follow-up | User approval 2026-11-04; recommendation accepted implicitly (user asked "should we"); keeps decision #9 (no grouping/ordering change) |
| 11 | No separate team-leader lane: batches.md derived from the approved plan's Team-leader handoff section | Token economy; plan already lists file-disjoint batches and order |
| 12 | antigravity confirmed limit (`RESOURCE_EXHAUSTED 429`, resets in 164h12m, ~2026-11-11). Skip for this run. Batch 4 frontend → Claude frontend-developer subagent; ALL code reviews (phase + final) → codex lane | ptah_agent_read output of b9770149; user answer 2026-11-04 ("claude subagent, and codex review"). Subagent reason: user choice |
| 9 | SCOPE CHANGE (supersedes #2 nesting and #3 placement): no change to the session list, canvas rail, nesting or ordering. Linked sessions show ONLY in the stats sidebar. The old session is still stopped after its turn ends (so it no longer shows Running); it keeps its normal place in the list. | User message 2026-11-04: "i don't want to affect our ordering mechanisms ... only on the stats sidebar would be sufficient" |
