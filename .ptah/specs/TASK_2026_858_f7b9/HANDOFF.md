# HANDOFF — TASK_2026_858_f7b9 (Ptah remote workers)

Written 2026-11-04 ~20:00 UTC by the orchestrator session. Supersedes every earlier HANDOFF.md.

## Goal

Control Ptah on the LAN machines Horus, Anubis and Chappie from the Electron desktop (later a
mobile PWA). The worker exposes WS `/rpc` on port 41873, reached through an `ssh -W` client;
JSONL event log. Libs: worker-protocol, worker-runtime, remote-machines, machines-ui, worker-host
(headless Electron worker = desktop binary in Node mode via the `ptah-worker` launcher).

## State

- PR #927 (Phases A–C) is MERGED into main (7e0b461c8).
- PR #928 https://github.com/Hive-Academy/PtahCode/pull/928 — draft, branch
  `feat/remote-workers-phase-d`, base now `main`. Worktree:
  `/home/amun/ptah-extension/.claude-worktrees/remote-workers-phase-d`. Head **d1d527ef7**, pushed
  (pre-push gate passed). CI for this head not yet checked.
- Phase D Batches 14–19 are all COMPLETE (batches.md). Commits this session:
  941a66adc merge origin/main · 52d50c3a3 19.2 round 2 (Codex) · d125b68fc 19.2 round 3 (Claude
  backend-developer: remote session composition) · 3b7fbb05c 19.3 packaging (Codex + orchestrator
  fixes: launcher asar check, tsconfig paths, minify config, validate-deps dependsOn + keytar
  optional, esm-bundle-gate registration) · d1d527ef7 19.4 docs/worker.md (Codex) + review files.
- Last verify: worker-runtime 102, worker-host 25, ptah-electron 1623 tests pass; lint/typecheck pass.

## Phase D review (done) → fixes (in progress)

Reviews: `phase-d-code-logic-review.md` (5/10), `phase-d-code-style-review.md` (6.5),
`phase-d-security-review.md` (6.5, 2 High), `phase-d-codex-review.md` (Codex, 5/10). Consolidated
in **`phase-d-fix-plan.md`**: Batch 20 (turn lifecycle), Batch 21 (security + stores + serve.ts
split), deferred list.

- Batch 20 is RUNNING on the Claude backend-developer subagent that wrote round 3 (resumed via
  SendMessage). Deliverable `batch-20-report.md`. If this session ended, the subagent result is
  lost to the new session: check `git status` in the worktree for uncommitted Batch 20 edits and
  the report; verify and commit them, or re-brief a new agent from `phase-d-fix-plan.md`.
- Then Batch 21 (Claude implementer), then a Codex review of Batches 20–21 (different family),
  then write `future-enhancements.md` from the deferred list, update the PR #928 body, mark it
  ready, watch CI.

## Rules learned this session

- Specs that import the engine or runtime barrel need an explicit `60_000` Jest timeout; a
  timed-out import also breaks later tests in the same worker.
- CI runs the degradation audit (`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`);
  new swallowing catches need `// degradation-audit: reported - <reason>`.
- `ptah-electron:test` builds all ESM bundles (incl. `build-worker-host`); the esm-bundle-gate
  spec has three registries for every new target.
- Codex lanes have twice claimed static checks that did not cover the file; always run verify.

## Open user questions

- Fleet ops O1–O5 and G-M on Horus (ask before Phase F).
- Decision-model 60 s permission timeout in the Ptah UI was not confirmed (docs say `timeoutAt: 0`
  waits indefinitely, per plan 6.3).

## Next steps

1. Receive Batch 20; verify `npm run verify -- -p @ptah-extension/worker-host,@ptah-extension/worker-runtime`; commit; push in background.
2. Batch 21 per `phase-d-fix-plan.md`; verify; commit; push.
3. Codex review of Batches 20–21; fix confirmed defects (max 2 rounds).
4. `future-enhancements.md`; PR #928 body (Summary + Test plan); `gh pr ready 928`; watch CI.
5. Before Phase F: ask the user about fleet ops O1–O5 and G-M.
