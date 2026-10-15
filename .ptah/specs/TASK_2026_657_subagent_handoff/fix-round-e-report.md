# Fix round E report — TASK_2026_657 (worktree fix/subagent-handoff-notice, base 3404ddca4)

Status: DONE. B1, B2, S3 and M5 fixed, each with a regression test. M4 not touched (by decision).
No commit. The working tree is dirty with 24 modified files.

## B1 — running-dismissal clause removed

New rule everywhere: set `status: dismissed` only if you will not continue the work, or if its
subagent finished normally and returned its result. If the subagent is still running, leave the
record pending.

- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-index.ts:51-56`: `POINTER_HEADER`.
- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-record.ts:139-141`: `renderRecord` text.
- `libs/shared/src/lib/types/task-spec.contract.ts:536-538`: `SUBAGENT_HANDOFF_RULE`.
- `.claude/agents/*.md`: 15 files, line 11/12 "Task folder" rule. A literal replacement changed exactly one
  line per file (`git diff --numstat`: 15 added and 15 deleted). The text now matches `SUBAGENT_HANDOFF_RULE` word for word.
- Both orchestration SKILL.md copies: neither contains the clause (grep for `dismissed`: no hit), so they are unchanged.
  `subagent-handoff-message.ts:57-62` (`recordLine`) never carried the running clause, so it is unchanged.
- After the change, a grep for `still running or finished` outside `.ptah/` finds only the three negative test assertions.
- Tests:
  - `subagent-handoff-record.spec.ts` "never tells the reader to dismiss a record whose subagent is still running".
    The existing round-trip assertion was updated to the new wording.
  - `subagent-handoff-index.spec.ts` "never tells the parent to dismiss a record whose subagent is still running".
  - `task-spec.contract.spec.ts` "never tells an agent to dismiss a record whose subagent is still running".

## B2 — temporary write and exclusive atomic publish

- `subagent-handoff-record.ts:481` `create` now calls `publishComplete` (`:489-516`). It:
  1. opens `.<recordName>.tmp` in the same directory with `wx`. A leading `.` and a `.tmp` suffix never match
     `RECORD_NAME`/`parseRecordName`.
  2. writes the content through the handle and closes it (inner `finally`).
  3. publishes with `fs.link(temp, final)`.
  4. unlinks the temp file in an outer `finally`, on success and on every failure after the temp file was created.
- A temp file that `wx` refused (`EEXIST`) was not created by this call, so it is not removed. `removeTemp` (`:519-528`)
  logs only `errorType`/`errorCode` at debug level.
- The final name is never written directly, so it never holds a partial file.
- Why `link`: the final name appears atomically, already complete, and the call fails with `EEXIST` if the name exists.
  On POSIX this is `link(2)`. On Windows, libuv uses `CreateHardLinkW`, which fails with `ERROR_ALREADY_EXISTS` (mapped
  to `EEXIST`), and a temp name is unlinked once its handle is closed. `rename` was rejected because it replaces an
  existing target on POSIX, and on Windows libuv passes `MOVEFILE_REPLACE_EXISTING`.
- The existing EEXIST test still gets `errorCode: 'EEXIST'`, now from `link`.
- The module doc (`:15-18`) describes the new write.
- Index: `load` already keeps only names that `parseRecordName` accepts (`subagent-handoff-index.ts:218-220`), and
  deletion of resolved records only ever touches listed names. Temp files are therefore never listed and never deleted.
  Index code was not changed for this.
- Tests (`subagent-handoff-record.spec.ts`):
  - "a failure after the temporary file was written leaves neither the record nor the temporary file": `fs.promises.link`
    rejects with `EIO`. The write returns `ok:false, errorCode:'EIO'`, the directory is empty, and the warn log has no
    handoff text.
  - "the record name appears only for a complete, closed file" (the reader/write overlap check): when `link` is called,
    the directory holds only the temp name, `parseRecordName` rejects that name, and the temp content is already the
    full `renderRecord` output. Afterwards only the final name remains, with the full content.
  - The EEXIST test now also checks that the directory holds only the first record (no leftover temp file).
  - `subagent-handoff-index.spec.ts` "ignores a temporary record file, however old, and never deletes it": an 8-day-old
    `.<name>.tmp` gives no pointer and the file stays.
- Needed follow-up edit: `subagent-budget-monitor.spec.ts:1719-1752` "a record write that completes after its timeout is
  unlinked and stops nothing". It gated `fs.promises.writeFile`, which the write no longer calls. It now gates
  `fs.promises.link`, and its final wait requires an empty directory (late record and temp file both removed). Its intent
  is unchanged.

## S3 — head reads raced against the remaining deadline

- `subagent-handoff-index.ts:256-294` `collect`:
  - Before each visit, including the first, it computes `remaining = deadline - now()`.
  - If `remaining <= 0` before the first visit, the result is expired (nothing was checked). After at least one visit
    it is the old behaviour: a "N more" line.
  - Each `visit` is raced against `remaining` by `raceDeadline` (`:368-386`), which clears its timer.
  - When the race returns `EXPIRED`, the loop stops without setting the cursor. The pointer is any lines already listed
    plus `timeoutLine(dir)`, which takes the place of the "more" line.
  - An abandoned visit keeps running; `visit` never rejects, and the race has already attached handlers.
- `waitUntil` (`:389-397`) now delegates to `raceDeadline` instead of repeating the timer race.
- Hook bound: `POINTER_BUDGET_MS = 600` is below `POINTER_TIMEOUT_MS = 1000` (`user-prompt-submit-hook-handler.ts:20`).
  `handoffPointer` is synchronous up to `pointerFor` (`subagent-budget-monitor.ts:669-691`), so the timeout line
  arrives before the outer race wins. Module doc updated (`:11-24`).
- Tests (`subagent-handoff-index.spec.ts`):
  - "a first head read that never settles gives the timeout line and leaves the cursor": the pointer is exactly the
    timeout line. The next prompt names both records, so the cursor did not move.
  - "a later head read that never settles keeps the listed lines and ends with the timeout line": record 1 is listed,
    the pointer ends with the timeout line and has no "more" line, and the next prompt names records 2 and 3.
  - `user-prompt-submit-hook-handler.spec.ts` "keeps the index pointer budget below the hook bound, so its timeout line
    arrives": `POINTER_BUDGET_MS < POINTER_TIMEOUT_MS`.

## M5 — callback error logging

- `user-prompt-submit-hook-handler.ts:108-120`: the fan-out catch logs `errorType` (`Error.name`, or `typeof` for a
  non-Error), `errorCode` (only a string `code`), and `sessionId`. It never logs the raw message.
- Test: the existing "registry-throw is swallowed..." test was rewritten. The callback throws a `TypeError` whose message
  contains the prompt and whose `code` is `E_CALLBACK`. The warn arguments are exactly
  `{ errorType: 'TypeError', errorCode: 'E_CALLBACK', sessionId: 'sess-1' }`, and the serialized warn calls do not contain
  the prompt text.

## Verification

- `npx jest -c libs/backend/agent-sdk/jest.config.ts <subagent-budget-monitor.spec.ts> <subagent-handoff-index.spec.ts> <subagent-handoff-record.spec.ts> <user-prompt-submit-hook-handler.spec.ts> --coverage=false --maxWorkers=2`:
  4 suites passed, 143 of 143 tests passed.
- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/task-spec.contract.spec.ts --coverage=false --maxWorkers=2`:
  1 suite passed, 98 of 98 tests passed.
- `ptah_get_diagnostics`, scoped to the 3 changed sources, the 4 changed agent-sdk specs and the contract:
  0 errors, 0 warnings (coverage clean).
- Not run, per the rules (the orchestrator runs them): nx typecheck, lint, project test, and the e2e and build targets.

## Not done

- M4 (concurrent prompts repeating a rotation window) was not fixed, by decision.
- No cleanup of orphaned `.tmp` files older than 7 days. It would need an `lstat` per non-record entry in the
  index load, which is not trivial. A temp file is orphaned only when the process dies between `open` and `unlink`.
  It is never listed or deleted.
- Observation, not changed: `fs.link` needs hard-link support. On a FAT32/exFAT volume, or on a share without hard
  links, every record write fails, and the existing failed-write path applies (no handoff stop; the accepted safety
  stop still runs). A fallback would have to give up exclusivity or atomicity, so none was added.
