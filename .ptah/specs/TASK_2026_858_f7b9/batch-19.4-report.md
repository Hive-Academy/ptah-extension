# Batch 19.4 report

## Files changed

- `libs/backend/worker-host/docs/worker.md` — Linux deb operator guide, command reference, generated capability table, and exit runbook.
- `libs/backend/worker-host/src/lib/worker-doc.spec.ts` — compares the table with exported `WORKER_CAPABILITIES` after loading platform-core.
- `.ptah/specs/TASK_2026_858_f7b9/batch-19.4-report.md` — this report.

## Decisions

- Used the existing task worktree and branch supplied by the caller. No separate branch or worktree was created, and no commit was made.
- Documented the deb as the supported install path. `linux.extraResources` currently also puts the launcher in AppImage resources; the guide does not promise AppImage operation.
- Kept the table renderer pure and local to the spec. The table rows were generated from the current `RPC_CAPABILITIES` list and the `worker-capabilities.ts` mapping; the spec will catch drift.
- Used decision rows 21 and 22 for provider CLI login and systemd linger.

## Claim-to-source table

| Doc claim                                                                                    | Source                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Default port 41873; port range 0–65535; active turns 1–1024, default 4                       | `libs/backend/worker-host/src/lib/dispatch.ts:129-147`; `apps/ptah-electron/worker-host/ptah-worker.service:5`                         |
| Pair TTL 300 seconds, range 60–900                                                           | `libs/worker-protocol/src/lib/pairing-code.ts:24-26`; `libs/backend/worker-host/src/lib/dispatch.ts:88-92`                             |
| Five failed exchanges close a window; three failed exchanges close a connection with backoff | `libs/backend/worker-runtime/src/lib/pairing-window.ts:80-87,125-127`; `libs/backend/worker-runtime/src/lib/connection.ts:235-246`     |
| Token file mode 0600 and no scheduled token expiry                                           | `libs/backend/worker-runtime/src/lib/token-store.ts:31-39,60-78,98-112`                                                                |
| JSONL event file mode 0600; torn tail recovery                                               | `libs/backend/worker-runtime/src/lib/session-event-log.ts:97-150`                                                                      |
| Sync at turn end and at most once per second in a turn                                       | `libs/backend/worker-runtime/src/lib/session-log-writer.ts:95-105`; `libs/backend/worker-runtime/src/lib/session-event-log.ts:176-177` |
| `timeoutAt: 0` waits indefinitely; first permission answer wins                              | `.ptah/specs/TASK_2026_858_f7b9/implementation-plan.md:462`; `libs/backend/worker-runtime/src/lib/pending-permissions.ts:44-67`        |
| User unit port, restart, signal and stop timeout                                             | `apps/ptah-electron/worker-host/ptah-worker.service:5-9`                                                                               |
| Bundled Node 22 floor and SQLite readiness                                                   | `libs/backend/worker-host/src/lib/commands/serve.ts:80-94`; `libs/backend/worker-runtime/src/lib/readiness.ts:42-67`                   |
| A1 SSH forwarding target and A10 node mode                                                   | `.ptah/specs/TASK_2026_858_f7b9/implementation-plan.md:138-142,1894-1898,2058-2063`; `apps/ptah-electron/worker-host/ptah-worker:22`   |

## Not done / Clarifications Needed

- A1 and A10 are exit-runbook steps, not executed in this documentation lane. They require the packaged deb and a real SSH worker.
- No Nx, Jest, `npm run verify`, builds, app targets, or sockets were run, per caller restriction. The orchestrator will run worker-host verification.
- Other untracked Phase D review files appeared during this lane; this lane did not edit them.

## Static checks

- `npx eslint libs/backend/worker-host/src/lib/worker-doc.spec.ts` — passed.
- `git diff --check` — passed.
- `npx tsc --noEmit -p libs/backend/worker-host/tsconfig.spec.json` — passed.
- `npx prettier --write` formatted the three changed files. The first follow-up check found a formatting issue in the spec after its table-normalization edit; it was corrected and ESLint passed again.
