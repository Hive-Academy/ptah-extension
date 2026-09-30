# Completion Validation — TASK_2026_439_1310 (Thoth rework umbrella)

**Verdict: INCOMPLETE** — Phases 1-3 are merged on main. Phases 4-6 are not implemented, and no
child task exists for phases 4 and 6. Phase 5 is only partially covered by follow-up tasks that
are still in backlog.

Checked against origin/main at `7c8271e4a` (worktree `main-latest`, clean).

## Evidence table

| Item | Status | Evidence |
| --- | --- | --- |
| Phase 1 — stop disk growth (TASK_2026_440_834c, PR #513, `dbffc1938`) | DONE | `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts:31` (`processedDays: 7` purge); `libs/backend/thoth-runtime/src/lib/memory-retention-job.ts:40` (`jobId: '@ptah/memory-retention'`); `MemoryRetentionService` at `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:149`; reachability spec `libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts:928` |
| Phase 2 — memory age lifecycle (TASK_2026_443_40ec, PR #521, `5ebebee76`) | DONE | `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts:37` (`MemoryLifecycleStepResult` with `archived`/`deleted`/`evicted`); `libs/backend/persistence-sqlite/src/lib/migrations/0044_memory_lifecycle.ts`; reachability spec `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:566` ("registers memory:retention once") |
| Phase 3 — skills unblock (TASK_2026_461_639c, PR #526, `06b08e6c5`) | DONE | Manual promote gate at `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts:206` (`'manual'` mode in the gate pipeline); backlog cleanup at `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.types.ts:1`; child carrier `.ptah/specs/TASK_2026_461_639c/task.md:3` (`status: done`) |
| Phase 4 — activity feed correctness (newest-first, real event ids, grouping, overlapping summary, tile refresh) | NOT DONE | No child task filed (`context.md:76` still says "File a child task"). The only activity surfaces are the TASK_2026_380 ticker (`libs/frontend/chat-ui/src/lib/molecules/activity-ticker/activity-ticker.component.ts:16`) and the in-memory emitter `libs/backend/thoth-runtime/src/lib/activity-emitter.ts`. No phase-4 rework code found |
| Phase 5 — evidence-first skills pipeline (archaeology before authoring, cross-session clustering, promotion from real `skill_invocation_events`) | PARTIAL / MOVED-TO-FOLLOW-UP | Promotion part moved to **TASK_2026_578_3b00** (`.ptah/specs/TASK_2026_578_3b00/task.md:3`, `status: backlog`, "578 candidates, 0 promoted"). Clustering code exists (`libs/backend/skill-synthesis/src/lib/skill-clustering.service.ts:26`) but no phase-5 child task was filed for archaeology-before-authoring or cross-session clustering |
| Phase 6 — Thoth Overview (Health / Needs attention / Recent outcomes) + durable bounded activity ledger | NOT DONE | No "Needs attention" or Thoth Overview code (grep hits only in marketplace/admin UIs, e.g. `libs/frontend/marketplace/src/lib/ui/needs-attention.component.ts`). No durable ledger in thoth-runtime — only the in-memory `activity-emitter.ts`; the only "ledger" in the tree is the unrelated surface-operation ledger (`libs/backend/vscode-lm-tools/src/lib/surface/surface-operation-ledger.ts`). `context.md:78` still says "File a child task" |
| Umbrella close criterion ("close when phases 4-6 are merged, each with its reachability proof", `context.md:80`) | NOT MET | Phases 4-6 have no merged code |

## Follow-up tasks filed from this umbrella (commit `bd0a2b5e7`)

- **TASK_2026_577_cbfb** (backlog) — scheduled, reversible merge of near-duplicate memories.
- **TASK_2026_578_3b00** (backlog) — skill lifecycle: umbrella merge, judge gate, promote on
  accept, usage-based retirement. Covers the phase-5 "promotion from real invocation events" item.
- **TASK_2026_579_f2e2** (backlog) — curator provider fallback on rate limit or unreachable
  provider.

## Branch check

`origin/docs/thoth-curation-tasks` has **zero commits** ahead of origin/main
(`git log origin/main..origin/docs/thoth-curation-tasks` is empty). Its PR #606 merge commit
`94a3ea24b` is an ancestor of HEAD. The branch holds nothing this task still needs.

## Batch / pending-work check

The umbrella folder has no `batches.md` — each phase ran as its own child task with its own
branch. No pending batch records exist in the umbrella folder. The phase-3 child
(TASK_2026_461_639c) carrier reads `status: done`. The 2026-09-30 status audit in
`context.md:64-80` itself records: "Status: PARTIAL. Phases 1-3 are merged on main. Phases 4-6
have no task and no code."

## Remaining work

1. Phase 4 — file a child task and implement activity feed correctness (newest-first, real
   event ids, grouping, overlapping summary removal, tile refresh).
2. Phase 6 — file a child task and implement the Thoth Overview (Health, Needs attention,
   Recent outcomes) and a durable, bounded activity ledger.
3. Phase 5 — drive **TASK_2026_578_3b00** to done for promotion from real invocation events;
   decide whether archaeology-before-authoring and cross-session clustering need their own
   child task or are covered by 578's umbrella-merge scope.
4. Curation follow-ups **TASK_2026_577_cbfb** and **TASK_2026_579_f2e2** (both backlog).

## Recommended registry status

**in_progress** (keep label `partial`). The user-visible disk-growth, memory-lifecycle and
skills-unblock problems are fixed on main, but the umbrella's own close criterion is not met.
Do not mark `done` until phases 4-6 are merged, each with its reachability proof.