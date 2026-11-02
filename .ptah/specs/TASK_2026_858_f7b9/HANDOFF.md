# HANDOFF — TASK_2026_858_f7b9 (Ptah remote workers)

Written 2026-11-02 by the orchestrator session, at the user's request to stop after the Phase B
review round. Supersedes earlier HANDOFF.md.

## Goal

Control Ptah running on the LAN machines Horus, Anubis and Chappie from the Electron desktop
(later a mobile PWA). `ptah worker serve` exposes WS `/rpc` on port 41873, reached through an
`ssh -W` client; JSONL event log. New libs: worker-protocol, worker-runtime, remote-machines,
machines-ui. Gatsby only serves the d3:4b decision model through an SSH tunnel (127.0.0.1:11435).

User decisions already made (see decisions.md):
- Gate 2 approved (row 12). Plan = implementation-plan.md Round 5 (row 16).
- Codex lock: HOOK NATIVE CODEX TOO (row 14) — in the plan via a driver-gate port (C4c).
- Q1 = (a) watch-only in Phase 1; C11 and U5 licensing batch not built.
- O6 (decision model custom/127.0.0.1:11435/d3:4b, 30 s) applied (row 15).
- G-D design revision APPROVED (row 17).
- Fleet ops O1–O5 and G-M (Horus): still UNANSWERED by the user. No batch depends on them.

## Done (branch feat/remote-workers, worktree /home/amun/ptah-extension/.claude-worktrees/remote-workers, base main 8ca24c134; NOT pushed, no PR yet)

| Batch | Commit | Verify |
| ----- | ------ | ------ |
| 1 C0 scaffold | `9d7e47a31` | 54/54 |
| 2 P0-1 process sampler | `8ca164796` | 32 tests |
| 3 C1a wire contract (+ nx.json lint/test include lists for the 4 new libs — Batch 1 gap) | `3b157bd05` | 4 libs 12/12, 84 tests |
| 4 C1b WorkerClient + SessionEventReducer | `9fec09b02` | worker-protocol 3/3, 134 tests |
| 5 C2 shared machines contracts | `ca94375aa` | 76/78; the 2 license-server failures were a missing Prisma client, pass after `nx run ptah-license-server:prisma:generate` |
| 6 C5 cli-engine hostProfile + push tap | `db3eb97af` | pass; mcp-bench `snapshot-audits` "mem.liveness.audit" 5 s timeout under load, passes alone (unrelated; watch in CI) |
| 7 C3 host.remoteMachines RPC surface | `7ea368e4b` | 79/79 |

All Batch 3–7 implementers: Claude backend-developer subagents. batches.md marks 1–7 COMPLETE
with "Result" notes (executor-designed shapes that the Phase B review must judge).

## In progress — Phase B review (Batches 3–7)

Two Codex lanes were spawned at 03:09 UTC (reviewer family codex ≠ implementer family claude):
- code-logic: agent `312b2892-9628-4649-880b-266169ad6176` → `code-logic-review.md`
- code-style: agent `7c9d427a-4bae-4cd9-9688-181094bf8f57` → `code-style-review.md`
Both reviewed `git diff 8ca164796..7ea368e4b -- . ':!.ptah'` and FINISHED (no lanes running).

## Review outcome (both lanes finished, verdict delivered)

Both reviews: **REVISE**. The fix round has NOT started. Revise round count used: 0 of 2.

`code-logic-review.md` — 5/10, 1 blocking, 5 major, 2 minor (Codex CLI Session ID
`01a19a3b-eb8a-72c3-81f8-49c419dfb444`):
1. Major — `frames.ts:123-138` baseline `FlatStreamEventSchema` checks only id/eventType/timestamp;
   validate a real discriminated union; test malformed baseline → 4400.
2. **Blocking (orchestrator confirmed in code)** — `session-event-reducer.ts:129-136,170-179`
   held-frame overflow clears `held` but keeps `replayFrom`; then `replay-failed` clears
   `replayFrom` and emits no attach → view stuck. Fix: overflow = resync state, fresh attach.
3. Major — `worker-client.ts:336-352` a thrown `send` rejects only that call; treat as connection
   loss (tear down, reject all pending, notify close once).
4. Major — `worker-client.ts:384-395`, `frames.ts:339-389` size counted in UTF-16 units; count
   UTF-8 bytes; parsers need a byte bound (4 KiB pre-auth / 1 MiB, gateway enforces in Phase D).
5. Major — `session-event-reducer.ts:264-275` records copied per event (O(n²)); use a chunked
   append structure, flatten at the view boundary.
6. Minor — `cli-webview-manager-adapter.ts:37-41,159-170` tap without logger fails silently;
   require logger with tap or a default name-only sink.
7. Major — `worker-client.ts:274-294,502-513` `ping()`/`close()` throws escape timer callbacks;
   guard and route to the connection-loss path.
8. Minor — `worker-client.ts:283-290,446-464` peer close reason passes to `onClose` unchanged;
   expose a fixed reason per close code.

`code-style-review.md` — 7/10, 0 blocking, 2 major, 1 minor (Codex CLI Session ID
`01a19a3c-3255-77f3-ab46-a1949238e151`):
1. Major — `rpc-machines.types.ts:50-70` tuple not proven exhaustive vs
   `MachinesRpcMethodRegistry`; copy the two-way `Exclude` proof from
   `rpc-provider-accounts.types.ts:330-346` + spec assertion.
2. Major — shared restates worker limits/result shapes with no compatibility proof; add a spec in
   worker-protocol importing both public barrels that compares them (shared stays import-free).
3. Minor — `worker-client.ts:29-31` comment names future file "C8 machine-connection.ts"; drop it.

Fix ownership: logic 1-5, 7, 8 and style 2, 3 → worker-protocol (verify
`-p @ptah-extension/worker-protocol`); style 1 → shared (verify Batch 5's list); logic 6 →
cli-engine (verify Batch 6's list).

## Open problems and decisions

- Decision model: installed app (/opt/Ptah 0.1.70) predates `decisionModelTimeoutMs`; user will
  publish a new build. Speed is hardware-bound (CPU only).
- Possible bug (offered, not started): `libs/backend/platform-core/src/file-settings-manager.ts`
  `persist()` (:629) and exit flush (:266) write the whole cache and can revert external edits.
  Only fix if the user asks.
- G-M (Horus measurement) and O1–O5: ASK THE USER first; back up, confirm Ptah is not running.
- PR #873 handoff from another session: ask the user before continuing it.
- Prisma client is git-ignored; generate it in the worktree before any license-server verify.

## Key files (task folder = W/.ptah/specs/TASK_2026_858_f7b9)

- `batches.md` — 26 batches, executors, verify commands, phase reviews (B after 7, C after 13,
  D after 19, E after 22, F after 26). Task 7.1 file list gained `rpc.types.ts` (D-B5-1).
- `implementation-plan.md` — Round 5 plan. `decisions.md` rows 12–17. `design-spec.md` + `prototype/`.

## Next steps

1. Re-read `code-logic-review.md` and `code-style-review.md` (summary above).
2. Send the findings (numbered, with `file:line`) to a Claude backend-developer subagent
   for fixes; verify with each touched batch's verify command; commit (scope per project).
   Max 2 revise rounds; the fix commit gets one more cross-family review.
3. First push (background) + `gh pr create` against main (title < 70 chars, `## Summary`,
   `## Test plan` with real results). Watch CI and reviews with `gh`.
4. Continue Batch 8 onward (Phase C: driver lock, Batches 8–13) per batches.md, one executor
   at a time; Phase C review after Batch 13 with a different family than the implementer.
