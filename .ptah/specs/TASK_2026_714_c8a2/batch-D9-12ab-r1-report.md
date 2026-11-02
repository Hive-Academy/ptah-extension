# D9 12a+12b revision r1

## Review findings and fixes

| Finding | Fix and evidence |
| --- | --- |
| B1 | Removed required `readHistory` from `CodexContext` and the shared `CodexRuntime` port. Added a separate `CodexHistoryReader` capability implemented by the concrete runtime, so lane context wrappers and existing fakes do not need a new member. The history spec now narrows request params before reading `threadId`. |
| S1 | `CodexRuntime.readHistory` now starts a dedicated App Server process for the requested CODEX_HOME, verifies its home, calls only `thread/read` and the list endpoints, and closes that process. It does not call `open`, `thread/resume`, `thread/start`, `persist`, or `markInactive`. The runtime spec checks a read while the chat context stays open and checks no resume, turn start, persistence, or inactive marking. |
| S2 | Embedded full turns, including legacy turns with omitted `itemsView`, keep their embedded items. For partial turns, paged items are checked against every embedded item by id and content before they are used in page order. Missing, conflicting, duplicate, or cross-turn entries raise `malformedPage`. Added focused specs. |
| S3 | Only an anchored explicit `thread/read` “Thread ... not found” server message is marked `threadNotFound`. All other JSON-RPC rejections become `requestRejected`; the original `CodexRequestRejectedError`, including RPC code, remains attached as `cause`. Invalid results, home mismatch, and process failure retain their own typed codes and causes. No raw server message enters the public error. Runtime specs cover both rejection classes. |
| M1 | Child discovery now includes only threads reachable from the requested root through parent ids. Specs cover same-session orphans, unrelated threads, and a disconnected cycle. |
| M2 | A requested sub-agent thread may have a parent; the root id check remains. A spec covers it. |
| M3 | A 100-page cap now reports `pageLimitExceeded`, distinct from a stalled cursor; blank cursors are rejected. A spec covers both. Full archived and unarchived corpus listing remains because the pinned list schema has no parent filter. The cost is still bounded by the page cap but may be high for large homes. |
| M4 | The existing non-strict Zod schemas still strip unknown thread/turn fields, including `rootTurnId`. Snapshot fidelity beyond the pinned parsed fields remains limited. |
| M5 | Added cases for explicit missing-thread rejection, item conflict, duplicate turn/item ids, blank/stalled cursors, page cap, legacy embedded items, unrelated/orphan/cyclic threads, and sub-agent root. A live pinned-binary capture and packaged Electron reload remain unconfirmed and belong to the coordinator's later integration work. |

## Files written in r1

- `libs/backend/codex-runtime/src/index.ts`
- `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts`
- `libs/backend/codex-runtime/src/lib/codex-context.ts`
- `libs/backend/codex-runtime/src/lib/codex-runtime.ts`
- `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts`
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-session-history.ts`
- `libs/backend/codex-runtime/src/lib/codex-session-history.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-D9-12ab-r1-report.md`

The worktree also retains the preceding lane's uncommitted protocol method/schema/validator edits; r1 did not modify those files.

## Checks and limits

- Tests, typecheck, lint, build, Nx, npm, and diagnostics were not run; the coordinator owns them. Specs were updated but have not been executed in this lane.
- `tr -cd '\r' < file | wc -c` returned `0` for each of the eight source/spec files above through Git Bash. All eight also have no UTF-8 BOM. The report received the same checks after writing.
- The pinned protocol schema defines the read/list request and response shapes, but does not pin a not-found JSON-RPC error code or exact message. The anchored message classifier is conservative; matching a live pinned binary remains **UNCONFIRMED**. A server that rejects read of an unloaded thread will surface `requestRejected` rather than secretly resuming it.
- A CLI skill invocation mechanism was unavailable in this lane. Local `SKILL.md` files were discoverable on disk, but none could be invoked through a skill tool. The read-only TypeSafe AI skill was unrelated to this task and was not applied.
