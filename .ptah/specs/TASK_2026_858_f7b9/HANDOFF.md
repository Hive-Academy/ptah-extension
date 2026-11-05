# HANDOFF — TASK_2026_858_f7b9 (Ptah remote workers)

Written 2026-11-04 by the orchestrator session (updated after Phase C). Supersedes the 2026-11-02 HANDOFF.

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

PR #927 (draft): https://github.com/Hive-Academy/PtahCode/pull/927 — branch `feat/remote-workers-v2`.

| Item | Commit(s) | Review |
| ---- | --------- | ------ |
| Batches 1–7 (cherry-picked) + Phase B fixes + 7.9 | c9e71a634 … 17ade5466 | Codex; 7.9 APPROVED 8/10 |
| Round 6 plan (headless Electron worker) | dda41e36c | orchestrator spot-check |
| Batch 8 driver lock port, kernel/null lock | e9874ed73 | Phase C |
| Batch 9 control endpoint, local lock client | e7d767ddf | Phase C |
| Batch 10 registry lifecycle notifications | 88f2a7721 | Phase C |
| Batch 11 host lock bindings | 0ca2270d6 | Phase C |
| Audit fix | 3f0d133a7 | — |
| Batch 12 lock coordinator + call sites | d7e3871ef | Phase C |
| Batch 13 native Codex driver gate | 446c5f38b | Phase C |
| Phase C fixes (2 Codex rounds + Claude spec correction) | c50e62b4d, 8cdb176b7 | style APPROVED 8/10; logic REVISE 7/10 → N1 |
| CI fix (lock spec log folder) | c95822034 | in Batch 13.9 review |
| Batch 13.9 (N1 + lock races) | 03dfe507b, 518cb5d17 | Codex APPROVED 8/10 |

Phase C implementers: Codex lanes (they cannot run Nx or sockets in their sandbox; the orchestrator
ran every verify). Phase C reviewers: Claude subagents. Batch 13.9: Claude implementer, Codex reviewer.

Open minor follow-ups (decision row 24): `console.warn` in `create-session-driver-lock.ts`, temp-home
leak on spawn error in `spawn-driver-lock-holder.ts`, shared ChatSessionService spec factory,
`SessionRegistry` exported from the agent-sdk barrel only for a spec.

Known load flakes (pass alone): mcp-bench `snapshot-audits`, platform-core `file-settings-manager.bench`
and `agent-pack-download` A2, ptah-electron `git-watcher.real-git`.

Temporary worktree `.claude-worktrees/rw2-ci-merge` (detached, uncommitted merge of origin/main for an
e2e check): waits for the user's permission to remove it.

## Decision model (Gatsby)

Ptah 2.0.0 reaches Gatsby; probes pass; a direct valid request answers in ~14 s. Live calls
timed out at 30 s. `~/.ptah/settings.json` now says 60000 (backup
`settings.json.bak-20261104-timeout`), but the running app did NOT reload the external edit
(calls at 05:38–05:48 UTC still 30000). The user must set the timeout in the Ptah UI
(Settings → Providers → Decision model). Do not restart Ptah only for this (row 15).

## PR state (checked 2026-11-04, end of session)

- PR #927 draft, head 5b71f8bfa (docs commit with this HANDOFF on top), 38 commits over main.
  CI 18 pass / 4 skipped / 0 fail. mergeable=MERGEABLE, mergeStateStatus=BLOCKED (draft +
  review required). 0 reviews; one CodeRabbit "Draft PR not reviewed" comment.
- origin/main is 67 commits ahead; `git merge-tree --write-tree HEAD origin/main` is clean.
- No lanes, subagents or child sessions are running.

## Open question to the user (asked, NOT yet answered)

The user asked "the pr is a draft, where are we now?". I offered two options:
1. Keep PR #927 a draft and continue Phase D on the same branch (handoff plan).
2. Mark PR #927 ready now (Phases A–C add no user-visible behavior; CodeRabbit then reviews),
   and start Phase D on a new branch from main.
Wait for the answer before doing either. Also still waiting: decision-model UI timeout (user
action), permission to remove `.claude-worktrees/rw2-ci-merge`, fleet ops O1–O5 and G-M.

## Next steps

1. Get the user's answer to the question above. Watch PR #927 CI and reviews
   (`gh pr view 927 --json statusCheckRollup,reviews,comments`); fix task-related failures.
   If option 2: `gh pr ready 927`, then watch CodeRabbit and address findings.
2. Phase D (Batches 14–19) per batches.md (Round 6), one executor at a time; Phase D review after
   Batch 19 by a different family than the implementer. Ask the user before starting Phase D.
3. Fleet operations O1–O5 and G-M: still unanswered; ask before any fleet change.
