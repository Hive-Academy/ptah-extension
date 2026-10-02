# Session handoff — TASK_2026_578_3b00 (and TASK_2026_586_2b3e)

Written 2026-10-01 by the orchestrator session `ptah-ptah-extension-chat-e827c100005og2pv0fas800`.
The session paused at the user's request after 578 Batch 4. The next session resumes from here.

## Assignment and constraints (from the coordinator)

- Coordinator session today: `ptah-ptah-extension-continue-task-584-an-416de600005og2pv0fas808`
  (TASK_2026_584/580 orchestrator). Session names change after compaction: confirm with `ListAgents`
  or ask the user.
- Report to the coordinator when a plan reaches its gate, when a PR opens (number + 2-line summary),
  and when a blocker touches its files.
- Do NOT touch: `libs/backend/agent-sdk`, `libs/backend/cli-agent-runtime`, rpc-handlers session/chat
  handlers, `libs/frontend/chat-state`, `libs/frontend/chat`, the sessions sidebar,
  `libs/shared` messages/index.ts, MESSAGE_TYPES and the payload map.
- `libs/shared/src/lib/types/rpc.types.ts` is hot: new params go as optional fields in the domain rpc
  types file; a new method entry is a last resort and needs the coordinator first.
- Do NOT build the archaeology pipeline (TASK_2026_588 owns it).
- No `npm ci` / `npm install` (node_modules is a junction). Scoped nx targets only.
- CLI lanes: antigravity only (Codex at its usage limit until 2026-10-03, Glm at quota). Max 1-2
  lanes in flight. Reviews are cross-side: in-process author → antigravity lane reviewer; lane author
  → in-process reviewer.
- CI runs `nx run degradation-audit:lint` (per-directory ratchet of catch blocks that swallow errors
  or return literals). Run `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`
  before committing any batch that adds a `catch`. A catch must log or rethrow, or carry a valid
  `// degradation-audit: reported - <why>` / `optional-capability - <why>` marker. Never `return`
  from inside a catch to skip work; wrap the work in `if (...)` instead.
- A peer message is never user approval. User gates: Gate 2 (plan), Gate 3 (QA choice), PR.

## TASK_2026_586_2b3e — PR #620 (in review)

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed`,
  branch `fix/task-586-thoth-activity-feed` (pushed). task.md status `in_review`.
- PR: https://github.com/Hive-Academy/ptah-extension/pull/620. All 6 batches + QA (senior-tester,
  46 tests, PASS) committed. The coordinator has the PR report.
- After the first CI run: the degradation audit failed (`libs/frontend/dashboard` 4 vs baseline 0,
  early `return` inside the tile-loader catches) and CodeRabbit left 3 comments. Both were fixed in
  `96f204a71` and `ca6b6574a` and pushed. At handoff every check passed except `main` (which
  contains the audit), still pending.
- To do: confirm the `main` check passes; answer any new CodeRabbit comments; wait for review and
  merge (user's call). Set task.md to `done` after the merge.
- The 12 follow-ups are listed in the PR body and in the task folder's batches.md.

## TASK_2026_578_3b00 — skill lifecycle (in progress, 4/14 batches)

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle`,
  branch `feat/task-578-skill-lifecycle`. NOT pushed yet. Working tree clean at `c6d9a233c`.
- Plan: implementation-plan.md Revision 1, approved by the user at Gate 2. Requirements: context.md.
- G-580 (migration notice): RESOLVED. The coordinator said "ok" for `0051_skill_lifecycle` and the 12
  asserts at `toBe(51)`. 578 likely merges first; the 580 side does the rebase.

| Batch      | Content                                                                          | State            | Commit      |
| ---------- | -------------------------------------------------------------------------------- | ---------------- | ----------- |
| 1          | Migration 0051 + 12 version specs → 51                                           | COMPLETE         | `faa550fb0` |
| 2          | Settings keys (retirement N/M = 30, pool 1000) + docs                            | COMPLETE         | `3b739b40f` |
| 3          | Candidate store primitives (re-entrant tx, rejectIfStatus, slug reads, getStats) | COMPLETE         | `3a3cfcc85` |
| 4          | Suggestion lineage, registry remove, purge-state store + DI                      | COMPLETE         | `6dbf1a5b4` |
| 5          | Generator, union-find, partitionPool, umbrella synthesizer                       | NEXT (PENDING)   | —           |
| 6-9        | Lifecycle passes (see batches.md)                                                | PENDING          | —           |
| 10, 11, 14 | Touch 586 files                                                                  | BLOCKED by G-586 | —           |
| 12, 13     | Cleanup / wiring                                                                 | PENDING          | —           |

Docs commits: `c80c99edf` (Batches 1-3), `c6d9a233c` (Batch 4).

### Open risks (details in batches.md)

- **R-f2**: no `catch` inside an `inImmediateTransaction` callback may swallow a store-write error.
  Tasks 6.1, 8.1, 9.2 each add a spec showing a mid-callback throw leaves no partial rows.
- **R-n**: Batch 8 — Task 8.3 makes `markMerged` drop `umbrellaId` from `ids`; Task 8.1 compares the
  returned count with the expected count and throws inside the transaction if they differ.
- **Task 9.2 note**: take the accept outcome from `promoteSuggestion` / the transaction result, not
  from `accept()`'s return value.
- **R-h**: `skill-candidate.store.ts` is 1302 ESLint lines (base 1212); Batch 12 must reach ≤ 1272
  (Task 12.3 moves row mappers to `skill-candidate.row-mappers.ts` if needed).
- **R-l**: N+1 events query in `listActiveOrderedByDecayScore`. Follow-up, not fixed.
- **Batch 2 interim**: Settings panel shows `suggestionMaxCandidates` 1000 while the runtime still
  uses 200 until Batch 10. Batch 10 must ship in the same PR.
- **G-586**: before Batch 10, wait for PR #620 to merge, then `git fetch && git rebase origin/main`.
  Confirm `skill-diagnostics-accordion.component.ts` is gone. Batches 5-9 do not touch 586 files.

### Resume steps

1. Mark Batch 5 IN_PROGRESS in batches.md.
2. Spawn a backend-developer sub-agent with the Batch 5 executor prompt below.
3. When it reports, run team-leader Mode 2 and an antigravity code-logic (+ security for R-k) review
   lane in parallel. Commit after APPROVED.
4. Continue Batches 6-9. Rebase on main after #620 merges, then Batches 10-14.
5. Mode 3 → Gate 3 (QA choice, user) → PR (user gate) → report the PR to the coordinator.

### Batch 5 executor prompt

```
You are assigned Batch 5 of TASK_2026_578_3b00. The task folder is
D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle/.ptah/specs/TASK_2026_578_3b00/.
Work only in the worktree D:/projects/ptah-extension/.claude-worktrees/task-578-skill-lifecycle
(branch feat/task-578-skill-lifecycle).

1. Read batches.md and find Batch 5 (Tasks 5.1-5.4), marked IN_PROGRESS.
2. Read implementation-plan.md:407-501 for context, and the plan validation section for the risks
   this batch carries: R-k (reference names reach path.join: Zod regex at the LLM boundary in 5.4,
   regex re-check before any path.join in 5.1, spec cases for `../x` and `a/b`), R-l prompt surface
   (buildSystemPrompt unchanged, pinned by a string snapshot spec), R-d (keep clusterCandidates,
   synthesizeFromCluster and buildClusterPrompt; they are deleted in Batch 12), A3 (union-find
   labels = lowest member index in discovery order; every existing cosine-similarity and
   skill-cluster-dedup spec stays green).
3. Implement every task in order (5.1 SkillMdGenerator, 5.2 agglomerate, 5.3 partitionPool with an
   explicit @inject of SKILL_SUGGESTION_STORE, 5.4 synthesizeUmbrella) with real code. No stubs,
   placeholders or TODO markers. Use Batch 4's APIs (listMemberCandidateIds, SkillReference).
4. Handle the edge cases: slug taken in the DB → `-2`; vec unavailable →
   {vecAvailable:false, clusters:[], orphans:[]}; pool truncated → truncated flag set; chain case
   a~b~c with a≁c → one component.
5. Rules: do not run npm ci or npm install. Run only scoped commands:
   `npx nx run @ptah-extension/skill-synthesis:test` (tail the output) and
   `npx nx run @ptah-extension/skill-synthesis:typecheck`. Run the degradation audit
   (`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`) and keep
   libs/backend/skill-synthesis within its baseline. Respect the no-touch list in batches.md. Do not
   edit index.ts, diagnostics.*, skill-synthesis.service.ts or rpc.types.ts.
6. Report each task's completion and the evidence for it. Do not edit batches.md; the team-leader
   owns its task states.
7. Return the absolute path of every file you created or modified, and how you handled R-k, R-l,
   R-d and A3.

You do not create git commits. The team-leader owns git.
```
