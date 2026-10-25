# TASK_2026_715_6cba — context

## Origin

Split from TASK_2026_712_5d7c on 2026-10-22 at the user's request: "work on the multiple
accounts for claude first then work on the codex changes later on by first unifying it to use
app server then allow multi account for it".

## Order

1. TASK_2026_712_5d7c Phase 1 (Batches 1–35): Claude multi-account, account store, RPC, Electron Accounts UI.
2. TASK_2026_714_c8a2: unify Codex chat and lanes on the Codex App Server.
3. This task: Codex multi-account on the App Server route.

## Inputs (not an approved plan)

- Former TASK_2026_712 Batches 36–43 in ../TASK_2026_712_5d7c/batches.md (Codex commands/store admission,
  per-home resolver pool, scoped usage, owner aggregation, lane home, main route, Accounts UI reuse,
  parity matrix). They target the legacy Codex resolver and must be re-planned on the App Server.
- TASK_2026_712 implementation-plan.md Codex sections and task-description.md Codex acceptance criteria.
- TASK_2026_714 CodexHomeAuthReader takes a normalized home path; cache, refresh flight, write lock and
  watcher are keyed per home (peer agreement 2026-10-22). Use that seam for per-account CODEX_HOME.

## Start condition

Start only after TASK_2026_712 Phase 1 and TASK_2026_714 are merged to main. Begin with a fresh
architect pass (implementation-plan.md) against the merged code.
