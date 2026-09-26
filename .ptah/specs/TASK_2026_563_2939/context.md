# Task Context - TASK_2026_563_2939

## User Request

BUGFIX — Memory quality at the source: extract prompt, semantic merge candidates, reversible sediment quarantine

Setup: worktree `D:\projects\ptah-extension-memory-quality-source` on branch `fix/memory-quality-source` from origin/main (ebfc73321). All work happens in the worktree. Never commit to main.

Evidence (read, do not redo):

- .ptah/specs/TASK_2026_471_b3d1/forensics-memory-quality.md — lines 7-9, 93-101 (extract prompt / durability), 301-330 (salience), 336-395 (retrieval, merge, corpus cleanup), 544-546 (commitlint near-duplicates)
- .ptah/specs/TASK_2026_471_b3d1/implementation-plan.md lines 185-199 (searchRich as merge-candidate source)
- .ptah/specs/TASK_2026_473_c9f4/ — Track A SHIPPED M1 (FTS stopwords + AND→OR, 12865f539) and M2 (workspace-wide merge candidates, case-folded subjects, 12865f539 + acfdcec96, migration 0046). Reuse the track-a-*.md measurement method. Do not redo Track A.
- .ptah/specs/TASK_2026_439_1310/ phase 2 (TASK_2026_443_40ec) — age lifecycle and ranking-only salience on main. Do not conflict.

Scope:

- M4 — Extract prompt `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts`. 27,354 distinct subjects, 86.7% used once; 246 rows under `ptah-video-studio`; `event` rows 100% sediment. Replace fragmenting subject examples, require stable reusable subjects, add a durability filter (no transient events, task/worktree chatter, copies of repo rules such as commitlint).
- M3 — Merge candidates in memory-curator.service.ts resolve path (~line 608) still match on subject equality. Feed candidates from hybrid `searchRich` (BM25 + vector), bounded top-k, workspace-scoped, M2 exact-subject path kept as first tier. No new network calls.
- M5 — Corpus sediment (~55% of 36,252 rows: 5,691 `event`, task/worktree rows, 222 commitlint copies). REVERSIBLE quarantine (flag/status column via new migration, excluded from retrieval and merge, restorable), never hard delete. Sample and classify more than 15 event rows before rules are picked; write the rules into the spec folder.

Out of scope: M6 salience from real use, S1-S9 skill synthesis, TASK_2026_473 Track B, 439 phase 5, Jev/TypeSafe integration.

Acceptance criteria:

1. Before/after with the TASK_2026_473 Track A method on the same real queries: relevance must not regress (baseline 16/20); merge rate for near-duplicate subjects (e.g. commitlint group) goes up. Numbers in test-report.md.
2. New extraction run over a sample of real sessions gives fewer single-use subjects than baseline; numbers shown.
3. Spec proves quarantine → excluded from search and merge → restore → included again.
4. Migration follows persistence-sqlite conventions and runs on a copy of a real DB without data loss.
5. Unit specs for every changed unit; nx test / lint / typecheck for affected projects only (memory-curator, agent-sdk, persistence-sqlite and direct dependents). No workspace-wide runs.
6. Reachability proof: production caller path for each change.

Flow requested: PM → architect → STOP and show plan → team-leader batches (file-disjoint, M4/M3/M5 parallel) → developers → code-logic + code-style reviewers → senior-tester → commit per batch (`fix(memory-curator|agent-sdk|persistence-sqlite): ...`). End: push branch, PR against main (## Summary + ## Test plan), task status in_review, remove nothing from main, keep the worktree.

## Task Type

BUGFIX

## Complexity

Complex

## Strategy

BUGFIX at Full depth, per the user's explicit flow: project-manager → software-architect → Gate 2 (task-description.md and implementation-plan.md shown together; the user asked for one stop at the plan) → team-leader Mode 1/2/3 → developers → code-logic-reviewer + code-style-reviewer → senior-tester → commits → PR.

Task folder lives in the worktree only (moved from the main checkout so main stays clean). Status changes: edit the `status:` line in task.md.

## CLI Lanes

Mode: auto — delegate when it clearly helps. Required document reviews run on a CLI lane (opposite side of the in-process PM and architect).

Discovered lanes (ptah_agent_list, 2026-09-26):

| Agent       | Type     | Status               | Capabilities                                                                                                                        |
| ----------- | -------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| codex       | cli      | installed            | messaging: queue, role delivery: preamble/developer-instructions                                                                    |
| copilot     | cli      | disabled (installed) | messaging: queue, role delivery: preamble/task-prompt                                                                               |
| cursor      | cli      | not installed        | messaging: interrupt, role delivery: preamble/task-prompt                                                                           |
| antigravity | cli      | installed            | messaging: queue, role delivery: preamble/task-prompt                                                                               |
| opencode    | cli      | installed            | messaging: none, role delivery: preamble/task-prompt                                                                                |
| pi          | cli      | not installed        | messaging: steer, role delivery: preamble/task-prompt                                                                               |
| Glm         | ptah-cli | available            | provider: Ollama Cloud, ptahCliId: pc-355b645d-35af-4974-84cf-9cf961ea0164, messaging: queue, role delivery: preamble/system-prompt |

Roster: task-description.md review → codex lane; implementation-plan.md review → codex lane.

## Conversation Summary

- 2026-09-26: Worktree and task created. Task set to in_progress.
- 2026-09-26: Gate 0.1 → auto. task-description.md r0 → codex review REVISE (3 blocking, 3 minor) → r1 → REVISE (finding 7 minor; finding 2 dispositioned by orchestrator: "may run in parallel" matches the user's "can be parallel") → r2 → codex APPROVED, 2 rounds. Gate 1 folded into the single plan stop per the user's flow; user approval pending.
- 2026-09-26: implementation-plan.md + quarantine-rules.md r0 → codex REVISE (5 blocking, 6 minor) → r1 → REVISE (R1 still caught 4 durable rows; 3 minor) → r2 (R1 dropped, R4 only: 89 rows) → final codex verdict REVISE, cap reached: finding 15 (stale EV-guard/"four rules" text, plan :129 and :350-352), finding 16 (round-trip "one workspace" wording). Gate 2 presented with D1-D4 + R4 policy open.
- 2026-09-26: USER: "approved lets do the findings and dont do another recheck round just go for implementation and don't stop until we have an opened PR". Gate 1 + Gate 2 APPROVED (task-description r2, implementation-plan r2, quarantine-rules r2). No choices given for D1-D4 → orchestrator applied the plan's documented defaults: D1 yes (0049 auto-applies R4), D2 yes (fix(rpc-handlers) scope), D3 yes, D4 = B (strict; plan default "until the user answers"; replay measures A and B; a failing 8(b) is reported in the PR, not hidden), R4 policy accepted. Findings 15-16 fixed by the architect without a further review round (user waived it). Do not stop for further gates until the PR is open; Gate 3 QA = code-logic + code-style reviewers + senior-tester, per the user's flow.
- 2026-09-26: B1 87fd6c9fd, B2 f152a2793 committed (both reviews APPROVED). Glm lane dropped (Ollama weekly quota 429); reviews use codex (logic) + antigravity/codex (style). B3 logic NEEDS_REVISION (setPinned silent no-op on quarantined rows → store returns boolean; pin/unpin RPC handled in B6). B4 logic NEEDS_REVISION (unscoped cache generation not bumped by named writes → fixed in store (B3); cache key escaping; searchIndex '' scope; equivalence spec relabelled). B4 also fixes a pre-existing bm25SearchByMemory failure (MIN(bm25()) under GROUP BY) — kept in scope, disclose in PR.
- NOTE FOR SENIOR-TESTER (B7): the Track A "main" relevance baseline must run the BASE-COMMIT code (ebfc73321, e.g. a throwaway detached worktree or harness bundled from base sources) on the same DB copy — not the branch with nothing quarantined (B4 review finding 3).
