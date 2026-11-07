---
id: TASK_2026_887_65e5
status: backlog
type: FEATURE
title: Finish Codex App Server leftovers (named roles, file rewind, live parity check)
description: >-
  Remaining PENDING batches of TASK_2026_714_c8a2 with no code on main: 11c Codex
  named roles, 13a-13b turn-start shadow-tree checkpoint and file rewind, and a live
  Electron check. The 14a parity-gate ledger is obsolete (gate removed in 3736b79d5).
depends_on: [TASK_2026_714_c8a2]
created: 2026-11-07T00:00:00.000Z
updated: 2026-11-07T00:00:00.000Z
---

## Description

Split out of TASK_2026_714_c8a2 by the TASK_2026_886_032a status sweep. The parent's core scope
merged in #809, #823 and #881. Batch specs are in `../TASK_2026_714_c8a2/batches.md`
(11c at about line 3716, 13a-14b at about lines 3773-3812). Remaining work:

1. 11c, Codex named roles (personas). Read-only first: check whether the Codex protocol has a
   configurable named-role mechanism. The pinned schema has `agentRole`
   (`libs/backend/codex-runtime/src/lib/codex-protocol-schemas.ts:594`). If it is supported, map
   Ptah agent files to it in `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts`. If
   not, write a gap report for a user decision. No workaround.
2. 13a-13b, file rewind for Codex sessions. At turn start, snapshot the workspace into a git
   shadow tree under a private ref (`refs/ptah/checkpoints/<threadId>/<turnId>`) with a temporary
   `GIT_INDEX_FILE`. Never touch the user's index, HEAD, branches or stash. Wire it into turn start
   in `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts` and into
   `session:rewindFiles`, which returns `SessionRewindResult`
   (`libs/shared/src/lib/types/rpc/rpc-session.types.ts:676`). A non-git workspace returns
   `canRewind: false` with an error.
3. Live Electron check (was 14b). After 13b, run the Codex chat path in the Electron app: subagents,
   history, resume, revert, rewind and approvals, in dark and light themes. Paid model turns need
   coordinator approval first.

## Current state (2026-11-07)

- 11c: no role mapping in `codex-runtime` or `codex-app-server` code.
- 13a-13b: no `refs/ptah/checkpoints` code. Today `rewindFiles` works through the Claude SDK
  (`libs/backend/agent-sdk/src/lib/helpers/session-fork.service.ts:184`), so Codex sessions have
  no file rewind.
- 14a is obsolete: `3736b79d5` ("use installed codex on every OS", 2026-11-03) deleted
  `libs/backend/codex-runtime/src/lib/codex-parity-gate.ts` and the dev route. The
  `PTAH_CODEX_RUNTIME_DEV` procedure of 14b no longer applies; item 3 replaces it.
