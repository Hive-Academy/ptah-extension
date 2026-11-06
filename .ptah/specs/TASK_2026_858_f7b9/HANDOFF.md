# HANDOFF — TASK_2026_858_f7b9 (Ptah remote workers)

Written 2026-11-06 at the end of Phase E. Supersedes every earlier HANDOFF.md.

## Goal

Control Ptah on the LAN machines Horus, Anubis and Chappie from the Electron desktop (later a
mobile PWA). The worker exposes WS `/rpc` on loopback port 41873, reached through `ssh -W`.
Libs: worker-protocol, worker-runtime, remote-machines, machines-ui, worker-host. User decisions:
`decisions.md` rows 12–26.

## Done

- Phases A–C: PR #927 (merged). Phase D: PR #928 (merged, e9ca7046c).
- Phase E (Batches 20–22): branch `feat/remote-workers-phase-e`, worktree
  `/home/amun/ptah-extension/.claude-worktrees/remote-workers-phase-e`. Commits:
  - 453c53edb Batch 20 (C8a): ssh alias, ssh status/pair commands, `ssh -W` Duplex transport,
    atomic registry, token store, `WORKER_REMOTE_COMMAND`. Task-spec housekeeping (Batch 19
    COMPLETE; Phase D fix reports renamed `phase-d-fix-20/21-report.md`).
  - 3fae1cb71 Batch 21 (C8b): MachineConnection, MachinesService, MachinesRpcHandlers, A1
    integration spec over a real `createWorkerServer`.
  - dc3d5e425 Batch 22 (C9): Electron wiring (capability, handlers, startup connect, dispose on
    quit, surface spec "excludes nothing", tsconfig.build.json aliases).
  - 63a580fb7 revise round 1, b971ca4ca revise round 2 (worker identity binding, remote argv
    allowlist, reconnect/backoff races, removal order, replay cursor).
- Reviews (Claude, implementer Codex): `phase-e-code-logic-review.md` REVISE 5.5,
  `phase-e-security-review.md` REVISE 6, `phase-e-fix-round-1-review.md` REVISE 7,
  `phase-e-fix-round-2-review.md` APPROVED 8 (4 Minor findings recorded in
  `future-enhancements.md`).
- Verification at b971ca4ca: `npm run verify -- -p @ptah-extension/remote-machines,ptah-electron`
  green (remote-machines 63 tests, ptah-electron 1662 passed / 8 skipped). Batch 20 also verified
  worker-protocol 188, worker-runtime 142, worker-host 48.

## Environment notes

- The worktree needs `node_modules -> /home/amun/ptah-extension/node_modules` (git-ignored), or
  Jest cannot map `marked`.
- A stray `/tmp/.ptah` (not owned by this task) makes
  `apps/ptah-electron/src/di/phase-2-libraries.config-home.spec.ts` fail. Run Electron checks with
  `TMPDIR=/home/amun/.cache/ptah-phase-e-tmp`.

## Open before Phase F (Batches 23–26, Machines view) — ask the user

- Fleet ops O1–O5 and G-M on Horus.
- Confirm the 60 s permission timeout (decision row 20; docs say `timeoutAt: 0` waits forever).
- Phase F also owns: the `machines:state` reason field, a rebind flow, and payload sanitizing
  (`future-enhancements.md` "Phase E follow-ups").

## Next steps

1. Watch the Phase E PR (CI and CodeRabbit); fix task findings; do not merge.
2. After the merge and the user's answers: Phase F from `batches.md` Batch 23.
