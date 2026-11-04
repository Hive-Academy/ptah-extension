# HANDOFF — TASK_2026_858_f7b9 (Ptah remote workers)

Written 2026-11-04 by the orchestrator session. Supersedes the 2026-11-02 HANDOFF.

## Goal

Control Ptah on the LAN machines Horus, Anubis and Chappie from the Electron desktop (later a
mobile PWA). The worker exposes WS `/rpc` on port 41873, reached through an `ssh -W` client;
JSONL event log. Libs: worker-protocol, worker-runtime, remote-machines, machines-ui
(+ Round 6: worker-host). Gatsby only serves the d3:4b decision model (tunnel 127.0.0.1:11435).

## Branch and worktree

- ACTIVE: `feat/remote-workers-v2`, worktree `.claude-worktrees/remote-workers-v2`, base main
  c5e5c704b (decision row 18). The 9 Batch 1–7 commits were cherry-picked from the old branch.
- BACKUP: `feat/remote-workers` (worktree `.claude-worktrees/remote-workers`) — untouched, unpushed.
- The v2 worktree has a `node_modules` symlink to the main checkout (needed by the `marked`
  mapping in `jest.preset.js`).

## User decisions (decisions.md)

- Rows 12–17 as before (Gate 2, Round 5 plan, native Codex lock, watch-only Phase 1, G-D).
- Row 18 fresh branch + cherry-pick. Row 19 worker = headless Electron (Round 6: desktop binary in
  Node mode via a `ptah-worker` launcher + new `scope:cli` lib `worker-host` on cli-engine).
- Row 20 decision model timeout 60 s. Row 21 workers use provider CLI logins (no key storage).
  Row 22 systemd user service + `loginctl enable-linger` on Horus, Anubis, Chappie (Phase F).
- Row 23 draft PR with one open Major defect, fixed first in Phase C as Batch 7.9.
- Fleet ops O1–O5 and G-M (Horus): still UNANSWERED. Ask first; back up; confirm Ptah not running.

## Done

| Item | Commit(s) |
| ---- | --------- |
| Batches 1–7 (cherry-picked) | c9e71a634 … 69ddaf697 |
| Round 6 plan (headless Electron worker), batches 8–26 revised | dda41e36c |
| Phase B fix round 1 (L1–L8, S1–S3) | 846ff1c0a, 0284679e4, 42c6b8cf5 |
| Fix round 2 (resync until head, attach tokens) | da747eecf |
| Bounded correction (snapshot attach shown in view) | 40028bdea |

Reviews (Codex, implementer Claude): `fix-round-1-review.md` REVISE 6/10 → `fix-round-2-review.md`
REVISE 6/10 → `fix-bounded-correction-review.md` REVISE 6/10 with ONE open Major defect
(late frames after snapshot). Revise cap used. Codex lane session `01a1a55c-5f60-7611-95e3-0c9ff2cbf329`.

Verify on the rebuilt branch: Batch 1–7 project list all lint/typecheck pass; tests pass except
load-flaky specs that pass alone (ptah-electron `git-watcher.real-git`, mcp-bench
`snapshot-audits` mem.liveness.audit and `launchBenchHost` exit classification).

## Decision model (Gatsby)

Ptah 2.0.0 reaches Gatsby; probes pass; a direct valid request answers in ~14 s. Live calls
timed out at 30 s. `~/.ptah/settings.json` now says 60000 (backup
`settings.json.bak-20261104-timeout`), but the running app did NOT reload the external edit
(calls at 05:38–05:48 UTC still 30000). The user must set the timeout in the Ptah UI
(Settings → Providers → Decision model). Do not restart Ptah only for this (row 15).

## Next steps

1. Watch the draft PR CI and reviews; fix task-related failures.
2. Batch 7.9 (fence late frames after snapshot) → verify → Codex review.
3. Phase C Batches 8–13 per batches.md (Round 6), one executor at a time; Phase C review after
   Batch 13 by a different family than the implementer.
