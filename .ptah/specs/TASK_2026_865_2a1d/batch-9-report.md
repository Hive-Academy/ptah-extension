# Batch 9 report: bounded native Codex tail read (codex-runtime)

Task: TASK_2026_865_2a1d, Batch 9 (Tasks 9.1 and 9.2). Executor: backend-developer subagent.
I did not run any git commands, so the working tree is still uncommitted.

## Files changed

All paths are under
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/codex-runtime/src/lib/`.

- MODIFIED `codex-session-history.ts`
  - New exported `readCodexSessionTail(rootThreadId, request, assertOpen, bound)`, which returns
    `CodexHistoryTail`. The read works like this:
    - It reads the root once, metadata only (`thread/read { threadId }`), and checks the root id.
    - It then pages newest first with `thread/turns/list { sortDirection: 'desc', itemsView: 'full',
      limit: 25, cursor? }`. Every `historyMode` (`paginated`, `legacy` or absent) takes this
      path, with no branch on the mode.
    - It hydrates each non-complete turn with `thread/items/list { sortDirection: 'desc', limit: 25 }`.
      All turns share one `maxItemPages` budget. The item checks are the same as in the full read,
      and items come back in ascending order.
    - The byte bound is a module constant, `TAIL_READ_MAX_BYTES` (8 MiB). After each page the
      read adds `Buffer.byteLength(JSON.stringify(result.data))` to a running total. No new page
      is requested once the total reaches the constant, but the page that crosses it is still used.
    - Plan F3: a turn that cannot finish inside the budget is dropped, and the read stops there.
      If no turn was accepted and the result does not cover the whole history, the read throws
      `pageLimitExceeded`.
    - Cursor checks: a repeated or blank cursor throws `stalledCursor`. A repeated turn or item id
      throws `malformedPage`.
    - `coversWholeHistory` follows the plan's rule.
    - The read never calls `thread/list`, never sends `includeTurns`, and never calls a non-read
      method.
    - A8 fallback: it runs only when the first `desc` request is rejected with RPC -32602
      (invalid params). It then pages `asc` inside the same page cap (the refused request counts
      as one page) and the same byte cap. It keeps the newest `maxTurns` turns and sets
      `coversWholeHistory = false`. See Decisions for the case where this fallback fails closed.
  - Behaviour-preserving extraction:
    - The nested `call` is now the module helper `guardedHistoryRequest`.
    - The item-entry checks are now the module helper `assertItemEntriesMatchTurn`.
    - `readCodexSessionHistory` uses both helpers, and its behaviour is unchanged. All of its
      existing specs pass unedited.
- MODIFIED `codex-runtime.types.ts`
  - New `CodexHistoryTailBound { maxTurns, maxTurnPages, maxItemPages }`.
  - New `CodexHistoryTail { thread, coversWholeHistory }`.
  - `CodexHistoryReader` gains `readHistoryTail(profile, resume, bound, signal?)`.
- MODIFIED `codex-runtime.ts`
  - New `readHistoryTail`.
  - `readHistory` and `readHistoryTail` both delegate to one private
    `runHistoryRead<T>(profile, resume, signal, read)`. It owns the closed and aborted checks,
    the abort wiring and the `historyReads` tracking.
  - `runHistoryRead` calls `readHistoryProcess<T>(…, read)`, which owns the home check, the
    spawn, verification of the Codex home, rejection of server requests, error mapping and
    `close()` in `finally`. The read function has the type
    `HistoryProcessRead<T> = (request, assertOpen) => Promise<T>`.
  - `readHistory`'s error messages and order of steps are unchanged.
- MODIFIED `codex-session-history.spec.ts`
  - New tail fixture (`tailServer`). It records each request's method, its params and the
    serialized byte size of each page it returns.
  - New `describe('readCodexSessionTail')` block (see the test list).
- MODIFIED `codex-runtime.spec.ts`
  - New `describe('readHistoryTail')` block inside `CodexRuntime`.
- NOT MODIFIED: `src/index.ts`. See Decisions.

## Tests

`codex-session-history.spec.ts`, `readCodexSessionTail`:

1. Turn cap (AC 3.10 Codex half, AC 3.9), one case each for a `paginated` thread, a `legacy`
   thread and a thread with `historyMode` absent. Each thread has 2,000 turns. The checks:
   - exactly 8 `thread/turns/list` calls, all `desc`, `itemsView: 'full'` and `limit: 25`;
   - at most 25 requests and exactly 1 `thread/read`;
   - 0 `includeTurns` and 0 `thread/list`;
   - the result holds turns t1800..t1999 in ascending order, with the last fixture turn last;
   - `coversWholeHistory === false`.
2. Byte bound (row 41): 1,500 turns of about 60 KB each. The checks:
   - fixture checks: the fixture is more than 10 x 8 MiB, and every page is under 16 MiB;
   - exactly 6 turn-list calls and 7 requests in total, with nothing after the sixth turn page;
   - the bytes received are at most the constant plus the largest page;
   - the result holds t1350..t1499 in ascending order, with `coversWholeHistory === false`;
   - the read does not throw.
3. F1 (a): when the server rejects turn paging for a `legacy` thread, the read throws
   `requestRejected`. The requests are exactly `thread/read` and then `thread/turns/list`, with
   no `includeTurns`.
4. A8 fallback: when the server refuses `desc`, the read pages `asc`. The sort directions are
   `['desc', 'asc', 'asc']`, all turns come back in ascending order, and
   `coversWholeHistory === false`.
5. A8 fallback with `maxTurns: 10`: the read keeps the newest 10 turns.
6. A8 fallback on a 2,000-turn thread: the read throws `pageLimitExceeded` after 8 turn-list
   calls and at most 25 requests.
7. F3: the newest turn needs 17 item pages. The read makes exactly 16 `thread/items/list` calls,
   all `desc` and `limit: 25`, then throws `pageLimitExceeded`.
8. F3: the second-newest turn is over the remaining item budget. The result holds only the
   newest turn, complete, with its items in ascending order, and `coversWholeHistory === false`.
   None of the dropped turn's items appear, and no older turn is hydrated.
9. F3, byte variant: a turn whose item pages cross 8 MiB is dropped, and no further item page is
   requested.
10. A short thread gives `coversWholeHistory === true` with 1 turn-list call.
11. When `maxTurns` is met exactly by the last turn, `coversWholeHistory === true`.
12. When `maxTurns` is reached in the middle of a page, the read requests no further page and
    `coversWholeHistory === false`.
13. An empty thread gives `turns: []` with `coversWholeHistory === true`.
14. A summary turn is hydrated newest first, and its items come back in ascending order with
    `itemEntries`.
15. A repeated cursor or a blank cursor throws `stalledCursor`. A duplicate turn, a duplicate
    item or a root id mismatch throws `malformedPage`.
16. Only read methods are requested (A7, AC 6.1).
17. An `assertOpen` failure stops the read with no further request.

`codex-runtime.spec.ts`, `readHistoryTail`:

- A successful read requests only read methods, its turn page is `desc`/`full`/`25`, and the
  process is closed afterwards.
- On error the process is closed, both for `requestRejected` (turn page rejected) and for
  `pageLimitExceeded` (`maxTurnPages: 0`).
- On abort through the signal, the process is closed.
- When the runtime closes during a read, the read is aborted and the process is closed.
- A read under a different home is refused before anything is spawned.

All existing `readHistory` and `readCodexSessionHistory` cases are unchanged and pass.

## Verification

- `ptah_get_diagnostics`, scoped to the 5 changed files, was unavailable. Three attempts each
  reported "TypeScript check still running after 45s", so no diagnostics result exists.
- Jest ran once under the lock:
  `node scripts/verify.mjs --exec --task batch9-jest -- npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-session-history.spec.ts libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`
  Result: `Test Suites: 2 passed, 2 total; Tests: 189 passed, 189 total`, lock released with
  exit code 0.
  - ts-jest runs with diagnostics enabled, ignoring only code 151002. It therefore typechecks
    the two specs and the sources they import.
  - This is not a full `tsc` run of the project.
- Not run: `npm run verify`, lint and the project typecheck target. The user decided that heavy
  verify runs in CI.

## Decisions

- **legacy threads.** Decision: never send `includeTurns`; `legacy` threads are paged the same
  way as `paginated` ones.
  - Options: one `includeTurns` read for a `legacy` thread, or paging.
  - Evidence: the instruction for this batch, and `batches.md` Task 9.1, both say a legacy
    thread gets one `includeTurns` read. `implementation-plan.md` Rev 3 (F1, lines 857-860,
    933-935 and 975-977) supersedes that. Its spec requires zero `includeTurns` for `legacy` and
    absent-mode threads, and it states that the frame limit is not a bound.
  - Reversible: yes.
- **Trigger for the A8 fallback.** Decision: only RPC -32602 (invalid params) on the first `desc`
  turn page triggers the fallback. Any other rejection fails closed as `requestRejected` with no
  retry, which is plan F1 (a).
  - Evidence: plan A8 (line 195) and F1 (a) (lines 861-869).
  - Reversible: yes.
- **When the A8 fallback fails closed.** Decision: the fallback returns
  `coversWholeHistory = false`, as instructed. If the `asc` pages cannot reach the end of the
  thread inside the page or byte caps, it throws `pageLimitExceeded` instead of returning turns.
  - Reason: those turns would be the oldest ones, not the newest tail. Component 4 maps the
    throw to the fixed `HISTORY_UNREADABLE` result.
  - Evidence: the plan's invariant that the result is "always a contiguous newest tail" (lines
    915-916), and the F3 fail-closed rule.
  - Reversible: yes.
- **`index.ts` not edited.** Plan line 952 makes the export conditional on the Electron port
  naming the type.
  - Batch 10 can type the result as
    `Awaited<ReturnType<CodexHistoryReader['readHistoryTail']>>` and the bound as
    `Parameters<CodexHistoryReader['readHistoryTail']>[2]`.
  - Or Batch 10 can add `CodexHistoryTail` and `CodexHistoryTailBound` to the existing
    type-export list.
- **Request cap during the fallback.** The refused `desc` request counts as one turn page, so a
  fallback read still makes at most 25 requests.

## Out-of-scope observations (not touched)

- `apps/ptah-electron/src/di/codex-runtime-composition.ts:520-524`: `hasHistoryReader` checks
  only `readHistory`, but its type guard narrows to the whole `CodexHistoryReader`.
  - `readHistoryTail` is now a required member of that interface, so the guard claims a method
    it never checks.
  - Batch 10 should check `readHistoryTail` separately. Plan line 947 says a runtime without it
    maps to `runtimeFailed`.
  - This still compiles today because the deps type uses `Partial<CodexHistoryReader>`.
- A8 and A10 (manual Electron reads of a long native thread and of a `legacy` thread) are still
  open, as P5.

## Not done

- Nothing in the Batch 9 scope is left undone.
- The project-scoped `npm run verify -- -p @ptah-extension/codex-runtime` (Batch 9 verification)
  was not run, by the user's decision. CI covers it.
