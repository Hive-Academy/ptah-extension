# HANDOFF — TASK_2026_858_f7b9 (Ptah remote workers)

Written 2026-11-05 by the orchestrator session (75M tokens used). Supersedes every earlier HANDOFF.md.

## Goal

Control Ptah on the LAN machines Horus, Anubis and Chappie from the Electron desktop (later a
mobile PWA). The worker exposes WS `/rpc` on loopback port 41873, reached through an `ssh -W`
client; JSONL event log. Libs: worker-protocol, worker-runtime, remote-machines, machines-ui,
worker-host (headless Electron worker = desktop binary in Node mode via the `ptah-worker`
launcher). User decisions: `decisions.md` rows 12–24 (row 21: provider CLI logins only on
workers; row 22: systemd user unit + `loginctl enable-linger`).

## Done

- PR #927 (Phases A–C) MERGED into main (7e0b461c8).
- PR #928 https://github.com/Hive-Academy/PtahCode/pull/928 — DRAFT, branch
  `feat/remote-workers-phase-d`, base `main`. Worktree
  `/home/amun/ptah-extension/.claude-worktrees/remote-workers-phase-d`. Pushed head **e8d5a89b9**,
  **CI success** (run 41917824789). Commits since the last handoff:
  - 941a66adc merge origin/main
  - 52d50c3a3 Task 19.2 round 2 (real lock status, file locks)
  - d125b68fc Task 19.2 round 3 (remote session composition, Claude)
  - 3b7fbb05c Task 19.3 packaging (`build-worker-host`, launcher, systemd unit, validate-deps)
  - d1d527ef7 Task 19.4 `libs/backend/worker-host/docs/worker.md` + Phase D review records
  - aeda764fb fix plan + handoff
  - 9ef234807 Batch 20 turn-lifecycle fixes (Claude)
  - e8d5a89b9 Batch 21 security/store fixes (Claude): autopilot-level refusal, `grants revoke`,
    live revocation, shared file lock + atomic writes, connection cap 64, admin identity check,
    admin handlers split out of serve.ts
- Last orchestrator verify at e8d5a89b9: worker-protocol 186, worker-runtime 127, worker-host 43
  tests pass; lint/typecheck pass; degradation audit exit 0. ptah-electron 1623 tests passed at
  3b7fbb05c (not re-run since; Batches 20–21 did not touch apps/).
- Phase D reviews: `phase-d-code-logic-review.md`, `phase-d-code-style-review.md`,
  `phase-d-security-review.md`, `phase-d-codex-review.md` → `phase-d-fix-plan.md`.
- Codex re-review of Batches 20–21: `phase-d-fixes-codex-review.md` (UNCOMMITTED file) —
  CHANGES REQUESTED 5/10, six new findings (1 High live lock theft after 60 s; 2 High revocation
  misses a connection in auth; 3 High shutdown releases lock after refused abort; 4 Moderate
  held permission lost on late-resolved start; 5 Moderate admin key sent to any listener with
  the machine ID → challenge-response HMAC; 6 Low `lastUsedAt` debounce set before write).

## In progress — revise round 1 (of max 2), PARTIAL and UNCOMMITTED

A Claude backend-developer subagent was fixing findings 1–6 and was stopped by Ptah's subagent
budget monitor (not the user). Its last note: "Now the admin client (finding 5)". Uncommitted
edits (not reviewed, not verified):

- libs/worker-protocol/src/lib/methods.ts, methods.spec.ts
- libs/backend/worker-runtime/src/lib/{admin-key,connection,file-lock,process-state,token-store}.ts
  and specs admin-key, file-lock, token-store
- libs/backend/worker-host/src/lib/commands/admin-client.ts, admin-client.spec.ts (and possibly
  serve.spec.ts — it changed on disk at the end)

Likely state: findings 1, 6 and part of 2 and 5 in progress; 3 and 4 (remote-sessions.ts,
session-driver.ts) probably not started. Confirm with `git diff`.

The Ptah subagent handoff record
`/home/amun/ptah-extension/.ptah/subagent-handoffs/20261104T214520753Z-4d26cf529e2bbba2-toolu_01MPtGuaLU9F4kZs3VESYbBz-906e2f7d.handoff.md`
is still `status: pending`. Its "original task" is Batch 21, which is already committed; the
unfinished work is revise round 1 (brief below). Set it to `consumed` when you continue.

Revise round 1 brief (give it to a fresh backend-developer with the rules below): fix findings
1–6 of `phase-d-fixes-codex-review.md`: (1) never steal a live owner's lock; owner identity that
survives PID reuse (PID + /proc start time, or nonce lease); release only your own lock; specs
for slow live owner and PID reuse. (2) recheck token state after the `recordUse` await; revoke
and grant-refresh scans cover connections in auth; spec. (3) shutdown keeps the driver lock of a
turn whose `chat:abort` failed; spec. (4) keep held tab-only permissions while a timed-out start
can still resolve; bind on late `session:id-resolved`; spec. (5) admin auth by challenge-response
HMAC-SHA256(adminKey, nonce + context), constant-time compare, key never on the wire; keep
PID/machine-ID early refusal; update worker-protocol schemas and docs/worker.md; spec with a fake
listener. (6) set the `lastUsedAt` debounce only after a successful write; spec. Also look for a
cause of the intermittent serve.spec.ts SIGTERM/SIGINT failure (2/43 once under load). Append a
"Revise round 1" section to `batch-21-report.md`.

## Open problems and decisions

- Fleet ops O1–O5 and G-M on Horus — unanswered; ask the user before Phase F.
- Decision-model 60 s permission timeout in the Ptah UI not confirmed (docs say `timeoutAt: 0`
  waits indefinitely, plan 6.3).
- Revise cap: after round 1, one Codex review. If it still finds defects, report them to the user
  and stop (no third round).
- Subagent budget: a subagent that accumulates ~3M weighted tokens is killed. Keep briefs narrow;
  split round 1 into two subagents if needed (findings 1, 2, 5, 6 in worker-runtime/protocol/
  admin-client; findings 3, 4 in remote-sessions.ts/session-driver.ts) — run them sequentially or
  ensure file-disjoint scopes.

## Key files (task folder `/home/amun/ptah-extension/.claude-worktrees/remote-workers-phase-d/.ptah/specs/TASK_2026_858_f7b9/`)

- `phase-d-fixes-codex-review.md` — the six findings of round 1 (uncommitted; commit it).
- `phase-d-fix-plan.md` — Batches 20/21 items and the deferred list.
- `future-enhancements.md` — prioritized follow-ups (uncommitted; commit it).
- `batch-20-report.md`, `batch-21-report.md` — what each fix batch did and its known limits.
- `batches.md` — Batches 14–19 COMPLETE.
- `decisions.md` — user decisions.
- `libs/backend/worker-host/docs/worker.md` (in the worktree) — operator guide; keep it in sync.

## Background work

None running. No CI lanes, child sessions or watchers. The Codex review lane (CLI session
01a1a87e-fd51-7c03-8a4d-e52f456d4597) completed; resume it with `resume_session_id` to review the
round 1 changes.

## Next steps

1. In the worktree: `git status -s` and `git diff` to see the partial round 1 edits.
2. Spawn a fresh `backend-developer` with the round 1 brief above, telling it to continue from the
   existing edits and not redo finished work. Set the Ptah handoff record to `consumed`.
3. Verify: `npm run verify -- -p @ptah-extension/worker-host,@ptah-extension/worker-runtime,@ptah-extension/worker-protocol -- --output-style=static --skip-nx-cache`
   and `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` (exit 0).
4. Commit (foreground, explicit paths, include `phase-d-fixes-codex-review.md` and
   `future-enhancements.md`); push in the background; watch CI with `gh run watch`.
5. Codex review of the round 1 commit (resume session 01a1a87e-fd51-7c03-8a4d-e52f456d4597).
   Defects left → report to the user and stop.
6. Update the PR #928 body (`## Summary`, `## Test plan` with real results, link
   `future-enhancements.md`), `gh pr ready 928`, watch CI and CodeRabbit; fix task findings.
7. Before Phase F: ask the user about fleet ops O1–O5 and G-M.
