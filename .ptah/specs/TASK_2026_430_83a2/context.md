# TASK_2026_430_83a2 — Context

## User intent

After TASK_2026_411 (PR #494) shipped in Electron v0.1.70, the Sessions sidebar
shows "No sessions yet". The user wants a proper orchestrated fix, the same way
TASK_2026_411 was run: session and sub-agent (CLI agent) data must be lazily
loaded and bounded end to end — not a one-off data patch. All historical output
must be preserved (no deletion of the last durable copy).

## Evidence

Log: `C:\Users\abdal\AppData\Roaming\Ptah\logs\Ptah Electron-2026-09-13.log`, lines 160-229.

```
RPC: session:list failed          ElectronStateWorkerCrashedError: Worker message exceeds 262144 bytes (58962 ms)
RPC: chat:resume failed           same (73728 ms)
RPC: session:cli-sessions failed  same (78213 ms)
RPC: session:list failed          same (87954 ms)
```

Profile: `C:\Users\abdal\AppData\Roaming\Ptah\workspace-storage\RDpccHJvamVjdHNccHRhaC1leHRlbnNpb24\`
(READ-ONLY for investigation; copy/back up before any test against it).

- `workspace-state.v2\values\`: 1367 value files, 412 > 256 KB.
- ~40 `{"sessionId":...}` detail records between 256 KB and 2.9 MB. One inspected
  record: 3.08 MB of 3.1 MB is `cliSessions` (28 entries, keys
  `cliSessionId,cli,agentId,task,startedAt,status,stdout`, `segments` count 0) — the
  bulk is the legacy inline **`stdout`** string.
- Many `{"agentId":...}` values 200 KB – 2.9 MB (shape to be identified by architect).
- A 158 MB `[{"sessionId"...` value (legacy all-sessions array generation).
- v1 `workspace-state.json` is 328 MB.

## Verified root causes

1. **Migration misses legacy output shape.** `SESSION_METADATA_MIGRATION`
   (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:160`) extracts only
   `cliSessions[].segments` / `streamEvents`. Legacy `cliSessions[].stdout` is never
   extracted or leaned (no `stdout` reference anywhere in `session-metadata-store*.ts`),
   so detail records stay fat.
2. **Detail reads are unpaged.** `get()` (:671) and `getCliSessionsForRestore` (:1005)
   → `ElectronStateStorage.getAsync` (`electron-state-storage.ts:117`) → worker-host
   `get` (`electron-state-storage-worker-host.ts:205`) → runtime `get` returns the whole
   value (`electron-state-storage-worker-runtime.ts:243`). Leaning happens after the
   full read.
3. **One oversized response kills the shared worker.** `electron-state-storage-worker.ts:39`
   `assertElectronStateWorkerPayloadWithinBudget(response)` runs outside the try →
   unhandled rejection → worker `error` → `onWorkerFailure` (host :645) rejects ALL
   pending operations (collateral `session:list` failure). `withRestart` does not retry
   crash errors; the next launch hits the same key → deterministic.
4. **Worker holds the entire store in memory.** Runtime `this.values` hydrates every key
   (incl. the 158 MB legacy value). Off the main thread, but not lazy.

Note: `session:list` itself reads only the lean index (`getAll`, :754); it fails as
collateral of (3).

## Strategy

- Type: BUGFIX, complexity Complex (crosses `agent-sdk` recipe + `platform-electron`
  worker protocol/runtime/host + `platform-core` ports + RPC consumers).
- Flow: Partial — software-architect → team-leader (MODE 1/2/3) → QA (senior-tester +
  code-logic-reviewer). Root-cause research already done above; no PM needed.
- CLI delegation: **disabled** — Ptah MCP server unreachable (the installed app is the
  broken one), `ptah_agent_list` failed.
- Prior art: `.ptah/specs/TASK_2026_411/`

## User decisions (after final verification, 2026-09-13)

- Add batch B7 before the PR: bound the one-time v1 → v2 split's memory. Measured peak worker
  heap 1,028 MB on a 328.6 MB v1 fixture because `loadLegacy` parses the whole v1 JSON. Every
  shipped v0.1.70 user takes this path on first upgrade boot.
- PR opens only after B7 lands and the user's real-app checklist passes.
- TASK_2026_415 (paused SQLite archive worker, branch fix/boot-readiness-timeout): re-assess
  after 430 lands by re-measuring boot on a copied large profile; not part of this task.

## User decisions (after Codex round 2, 2026-09-13)

- Fact (verified in git): the TASK_2026_411 v2 worker store (122770d90) is in NO release tag;
  `electron-v0.1.70` predates it. Only local dev builds have v2 stores.
- User: "lets just have one version and no worries about old sessions ... lets fix without
  having versioning". So: ONE storage format. No plan versions, no migration receipts, no
  resumable maintenance sweep, no downgrade/old-writer compatibility, no installed-user
  self-heal. Old-session fidelity is not a requirement.
- User: rebuilding from the retained v1 file is fine; losing sessions written after the dev
  v2 migration is acceptable. Existing dev v2 stores may be discarded and re-split from v1
  with the corrected (lean, stdout-aware) split.

## User decisions (Checkpoint 1.5)

- Storage home: **architect decides** — compare (a) keep the v2 per-key worker but make
  it lazy/paged/fault-isolated vs (b) move session index/detail/agent output into
  SQLite; recommend one with evidence against the real profile.
- Legacy `cliSessions[].stdout`: **convert to a text segment** in the agent's paged
  `ptah.agentOutput:<agentId>` sequence, then drop it from the detail record. (implementation-plan.md, b4–b9 reports,
  e2e-storage-fix-report.md).
