# TASK_2026_411 — B4 review fixes report

Date: 2026-09-12. Worktree `D:/projects/ptah-extension/.claude-worktrees/task-411-b4-fixes`,
branch `fix/task-411-b4-fixes` (from `fix/task-411-b4-b5` at `af5b63968`). Executor:
backend-developer subagent. Input: `b4-code-logic-review.md` (NEEDS_REVISION, 6/10) on commit
`e72604346`.

## Outcome

Every finding in the review is fixed, and each fix has a regression spec. Each spec was run
against the HEAD (pre-fix) source and failed there. No `libs/shared` or `libs/frontend` file was
touched, so the B5 contract in `b4-report.md` is unchanged.

Commits:

- `2c23fac87 fix(agent-sdk): address b4 session stats review findings` — items 2-6 + test gap.
- `b2a92e1ee fix(cli): page session stats requests at the batch limit` — item 1.
- `docs(task-specs): record TASK_2026_411 b4 review fixes` — this report.

## Findings

### 1. SERIOUS — CLI `ptah session stats --ids` rejected for more than 20 ids — FIXED

- `apps/ptah-cli/src/cli/commands/session.ts:920` `runStats` (paging at `:941-944`).
- Change: the command splits the ids into sequential pages of `SESSION_STATS_BATCH_MAX_IDS`
  (imported from `@ptah-extension/shared`). No ids still sends one call with `[]`, as before.
  Every page is fetched before any output is written, and pages are concatenated in page order.
  Each response is already in request order, so the output keeps request order. Output format is
  unchanged: one `session.stats` notification per entry. Errors propagate as before: a rejected
  page makes `callRpc` throw, `execute` emits `task.error` and returns exit 1, and no partial
  output is written.
- Specs in `apps/ptah-cli/src/cli/commands/session.spec.ts`:
  - `:1094` 45 ids → 3 calls `[20, 20, 5]`, merged ids and emitted entries equal the request order.
  - `:1119` exactly 20 ids → one call.
  - `:1135` page 2 rejected → exit 1, 2 calls (page 3 never sent), 0 `session.stats`,
    `task.error` carries the RPC message.
  - The mock engine's `scripted` map now also accepts a responder `(params) => response`.
- Pre-fix: `:1094` and `:1135` failed.

### 2. Failure mode 1 — subagent compaction ignored under `current-context` — FIXED

- `libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts:158-167`.
- Decision: apply each subagent ledger's OWN last compact boundary under `current-context`,
  exactly as for the parent. Two reasons:
  - The ledger already computes `currentContextStart` per file.
  - A subagent compacts its own context, so its pre-compaction usage is no more "current" than
    the parent's.

  The plan's "+ every subagent record" was written without considering subagent compaction (the
  review calls it an oversight). Updated doc comments are in the aggregator and at
  `session-usage-ledger.ts` `currentContextStart`.
- Specs in `session-usage-aggregator.spec.ts`:
  - `:317` the ledger records the subagent boundary.
  - `:322` a compacted subagent counts only its post-boundary tokens and cost.
  - `:338` a subagent without a boundary is counted in full.
  - `:345` two subagents get independent boundaries.
  - `:352` `range` ignores the subagent boundary.
  - The first golden test title at `:154` is renamed; its numbers are unchanged, because its
    subagent has no boundary.
- Pre-fix: `:322` and `:345` failed.

### 3. Failure mode 2 — coalescing could hand a live caller another caller's abort — FIXED

- `libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger-cache.ts:94-135`
  (`getOrProject`), `:143` (`startShared`), `:60` (`MAX_COALESCE_ATTEMPTS`, now exported).
- Change: a waiter's outcome now depends only on its own signal.
  - When a joined projection rejects, the waiter first calls `signal.throwIfAborted()`. If the
    waiter itself was aborted, it rejects with ITS OWN reason, never with the shared error.
  - A non-abort failure is the file's failure and is shared with every waiter.
  - A foreign `AbortError` is never rethrown. The waiter re-checks the cache and joins or starts
    the next projection.
  - After `MAX_COALESCE_ATTEMPTS` (3) failed joins, the waiter stops joining. It starts a
    registered projection if none is in flight. Otherwise it runs a private, unregistered
    projection under its own signal, which nobody else can inherit.
  - The loop is bounded: at most 3 joins plus 1 projection of its own.
  - Nothing is stored except a successful ledger.
- Specs in `session-usage-ledger-cache.spec.ts` (`coalescing under interleaved aborts`):
  - `:195` 3 callers, owner aborts → both waiters resolve.
  - `:216` owners A, B, C abort in turn → waiter W resolves with its own projection, and the
    aborted callers reject with AbortError.
  - `:244` 5 callers → W projects privately while D's projection is in flight, and D's abort does
    not reach W.
  - `:265` an aborted waiter rejects with its own reason, not the owner's `EACCES`.
  - `:279` a real failure is shared with no re-projection.
- Pre-fix, run against the HEAD cache logic with only the constant exported: `:216`, `:244` and
  `:265` failed. `:216` shows the exact bug: W was rejected with C's abort.

### 4. Failure mode 3 — unsanitized error path in `session:stats-batch` — FIXED

- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:906-919`.
- Change: the `readStats` call now has a `catch (error: unknown)`.
  - An `RpcUserError` is rethrown unchanged, so it keeps its code (for example `INVALID_PARAMS`).
  - Anything else is logged through `logger.error`, with session count and scope in the message,
    and reported via `sentryService.captureException` with
    `errorSource: 'SessionRpcHandlers.registerSessionStatsBatch'`. Both follow the sibling
    handlers.
  - The handler then throws a plain `Error('Failed to read session stats')`. The transport
    returns a plain Error's message verbatim, so the internal message never reaches the client.
  - No new `RpcUserErrorCode` was added: no `INTERNAL_ERROR` exists, and adding one would be a
    `libs/shared` change.
  - The Zod `INVALID_PARAMS` branch runs before the call and is untouched.
- Specs in `session-rpc.handlers.spec.ts`:
  - `:1494` reader rejects with an `EACCES` path message → `error === 'Failed to read session
stats'`, no `errorCode`, logged and captured with the original error.
  - `:1520` reader rejects with `RpcUserError(..., 'INVALID_PARAMS')` → code and message kept,
    no Sentry capture.
- Pre-fix: `:1494` failed.

### 5. Minor — unreadable legacy flat subagent file dropped from coverage — FIXED

- `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts:77`
  (`SubagentMembership`), `:223-256` (`subagentMembers`), `:171` (seeds `unreadableSubagents`).
- Change: `subagentMembers` returns `{ owned, unreadable }`. A flat `agent-*.jsonl` that fails
  projection during the ownership scan counts as unreadable instead of disappearing, so the
  entry reports `coverage: 'partial'` and `agentSessionCount` includes it. The failure is logged
  at debug with the session id. The file is not re-read in the member phase: ownership is
  unknown, so a transient second success must not attribute another session's tokens.
- Spec: `session-stats-reader.service.spec.ts:450` → `status: 'ok'`, tokens 10,
  `coverage: 'partial'`, `agentSessionCount: 1`.
- Pre-fix: failed (`coverage` was `'complete'`, count 0).

### 6. Minor — legacy ownership scan read one file at a time — FIXED

- Same function, `session-stats-reader.service.ts:223-256`.
- Change: the scan now uses `Promise.all` over the flat files, each through the page-wide
  `subagentSlots` semaphore, so the limit of 3 still holds page-wide. `Promise.all` keeps input
  order, so `owned` stays in sorted file order. An abort still rethrows and fails the session.
- Spec: `session-stats-reader.service.spec.ts:429` → 6 legacy files of 450 lines, peak
  concurrent subagent projections `=== SUBAGENT_FILE_CONCURRENCY` (3), and never above it.
  `instrument()` now takes a child predicate; its default is unchanged, so the existing
  nested-layout bound specs are unaffected and stay green.
- Pre-fix: failed (peak 1).

### Other review items

- **`entries[1]` unasserted in the mid-page abort test** — FIXED,
  `session-stats-reader.service.spec.ts:284`. The spy now aborts on the page's FIRST projection,
  whichever worker reaches it. No projection can finish before that, so all four entries are
  pinned to `'error'`. The retry re-projects the file that actually aborted.
- **No test for two independent pages on one session, one aborted** — ADDED, `:313`. The live
  page is always `'ok'` with tokens 3. The aborted page may be `'ok'` or `'error'`, depending on
  which page owns the shared projection, and the spec accepts both on purpose. This is
  integration coverage; the cache spec at `:216` is the regression spec.
- **`type: 'user'` record with `usage` counted in tokens but not `messageCount`** — SKIPPED. The
  review marks it deliberate and pinned by the existing golden test ("correct-per-spec"). It is
  not a defect.
- **Edge-case table** — the three non-YES rows are covered above: subagent boundary (item 2),
  3+ callers (item 3), unreadable legacy file (item 5). The >20-id row is covered by item 1.

## Semantics updates for B5 / B9 (supersede `b4-report.md` where they differ)

- `current-context`: parent records after the parent's last `compact_boundary`, plus each
  subagent's records after THAT subagent's own last `compact_boundary` (all of its records when
  it has none). Previously: "+ every subagent record". `range` is unchanged and ignores every
  boundary.
- `coverage: 'partial'` is also set when a legacy-layout (flat `agent-*.jsonl`) file cannot be
  read during the ownership scan. Its owner cannot be proven, so EVERY legacy-layout session in
  that page reports it: `coverage: 'partial'`, and `agentSessionCount` includes it. Nested-layout
  sessions are unaffected.
- `session:stats-batch` failure shapes:
  - An invalid request stays `INVALID_PARAMS`.
  - A deliberate `RpcUserError` from the reader keeps its code.
  - Any other unexpected reader rejection is `success: false`, with
    `error: 'Failed to read session stats'` and no `errorCode`.

  Per-session failures are still `status: 'error'` rows, not page errors.
- A caller aborting (for example a page budget or a stale generation) can no longer turn another
  concurrent page's row into `'error'`. Only the aborted caller's own rows fail.
- CLI: `ptah session stats --ids` accepts any count and pages at 20 internally.
- Wire types, `SESSION_STATS_BATCH_MAX_IDS`, and the B5 contract are unchanged. B5 needs no edit.

## Gate results

The machine was shared with other parallel gate runs. All numbers below are from this branch at
`b2a92e1ee`, the content that was committed.

Focused specs (post-fix):

- agent-sdk, `npx nx test @ptah-extension/agent-sdk --skip-nx-cache --testPathPatterns=session-stats`:
  3 suites, 42 tests passed (29 before plus 13 new).
- rpc-handlers, `npx jest -c libs/backend/rpc-handlers/jest.config.ts …/session-rpc`: 2 suites,
  103 tests passed.
- CLI, `npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/session.spec.ts`:
  1 suite, 44 tests passed.
- A direct `npx jest -c libs/backend/agent-sdk/jest.config.ts` run twice printed only the config
  warning and exited 127 with no test output. That looks like the process being killed under host
  load; the Nx target run above is the evidence used.

Pre-fix proof: the five changed sources were replaced with their `git show HEAD:` versions,
focused suites were run, and the sources were restored (verified with `cmp`).

- agent-sdk: the aggregator spec had 2 failures, the reader spec 2, and the cache suite failed to
  compile because `MAX_COALESCE_ATTEMPTS` is not exported at HEAD.
- Cache re-run on the HEAD cache logic with only the constant exported: 3 failed, 9 passed.
- rpc-handlers: 1 failed, 93 passed.
- CLI: 2 failed, 42 passed.

Project test gate:

- `NX_TUI=false npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/shared ptah-cli --outputStyle=static`:
  - The header read "Running target test for 4 projects and 31 tasks they depend on".
  - `@ptah-extension/shared` ran: 56/56 suites, 1368/1368 tests passed.
  - The process then exited 127 with no output from the other three projects. An earlier
    background attempt died the same way after the header. Neither run reported a spec failure;
    the processes died. Each remaining project was therefore run alone:
- `NX_TUI=false npx nx test @ptah-extension/agent-sdk --outputStyle=static --maxWorkers=2`:
  90 suites passed, 1 skipped (91); 1567 tests passed, 2 skipped (1569). "Successfully ran target
  test".
- `NX_TUI=false npx nx test @ptah-extension/rpc-handlers --outputStyle=static --maxWorkers=2`:
  94/94 suites passed; 2737 tests passed, 31 skipped (2768). "Successfully ran target test". The
  `voice-rpc.handlers.spec.ts` flake from `b4-report.md` did not recur.
- `NX_TUI=false npx nx test ptah-cli --outputStyle=static --maxWorkers=2`: exited 130 and never
  reached Jest. Its dependency task `ptah-cli:copy-wasm` failed with "WASM file not found:
  …/node_modules/web-tree-sitter/web-tree-sitter.wasm". That is an environment gap in this
  worktree's `node_modules` and is unrelated to this diff. The CLI Jest suite was therefore run
  directly:
  - `npx jest -c apps/ptah-cli/jest.config.cjs --maxWorkers=2`: 65 suites passed, 1 failed,
    1 skipped (67); 984 tests passed, 4 failed, 3 skipped (991). All 4 failures are in
    `apps/ptah-cli/src/test-utils/esm-bundle-gate.spec.ts`, and each reports "requires a build --
    run `nx run ptah-cli:build-embedder-worker` / `build-integrity-worker`". Those are
    unbuilt-artifact gates. `git diff --stat 47bd2cf64 HEAD -- apps/ptah-cli/src/test-utils/` is
    empty, so the branch has no diff there.
  - Re-run alone with the spec's documented local escape,
    `PTAH_ALLOW_SKIP_UNBUILT=1 npx jest -c apps/ptah-cli/jest.config.cjs --maxWorkers=2`:
    66 suites passed, 1 skipped (67); 984 tests passed, 7 skipped (991). Exit 0.

Typecheck gate:

- Before the commits, `npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/dashboard ptah-cli --skip-nx-cache`:
  "Running target typecheck for 5 projects" → "Successfully ran target typecheck for 5 projects".
- After the commits (foreground), the same five projects with `NX_TUI=false … --outputStyle=static`:
  "Running target typecheck for 5 projects" → "Successfully ran target typecheck for 5 projects",
  exit 0.

Other checks:

- ESLint on all 11 touched files: 0 errors, 2 `max-lines` warnings, both on files already over
  700 lines: `apps/ptah-cli/src/cli/commands/session.ts` (850) and `session-rpc.handlers.ts`
  (1007).
- Degradation audit (`npx tsx tools/degradation-audit/check-degradation.ts`): `agent-sdk 4 ok
(baseline 4)`, `rpc-handlers 1 ok (baseline 1)`, `apps/ptah-cli 29 ok (baseline 29)`. The exit
  is non-zero only because of `platform-electron 13 FAIL (baseline 4)` and
  `vscode-core 1 FAIL (baseline 0)`. Both failed before this branch, and neither was touched.

## Plan deviations

- Item 2 changes the documented `current-context` semantics (see above). The plan text did not
  consider subagent compaction, and the review recommended the symmetric reading.
- Item 4 uses a sanitized plain `Error`, not a new `INTERNAL_ERROR` code, so `libs/shared` stays
  unchanged.
- Ownership extension (approved): `apps/ptah-cli/src/cli/commands/session.ts` and its spec.

## Out-of-scope observations

- `session-usage-ledger-cache.ts` still uses literal NUL bytes as the cache-key separator
  (B4 wrote it that way). Git therefore treats the file as binary, and `git show 2c23fac87`
  prints `Bin 5389 -> 7340 bytes`. To review the item 3 diff, run
  `git show --text 2c23fac87 -- libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger-cache.ts`.
  An attempt to write the separator as an escape still produced raw NUL bytes. Runtime
  behaviour is unaffected. The fix is a one-line follow-up that writes the escape sequence
  (backslash-u-0000) explicitly.
- `ptah-cli:test` cannot run through Nx in this worktree: `copy-wasm` needs
  `node_modules/web-tree-sitter/web-tree-sitter.wasm`, which this install lacks.
- `libs/backend/agent-sdk/CLAUDE.md` still cites stats-batch in the `LiveUsageTracker` bullet
  and does not list `session-stats/` (already noted in `b4-report.md`).

## Git state when this report was written (before the docs commit)

`git log --oneline -5`:

```
b2a92e1ee fix(cli): page session stats requests at the batch limit
2c23fac87 fix(agent-sdk): address b4 session stats review findings
af5b63968 docs(task-specs): record TASK_2026_411 b4 completion
e72604346 perf(agent-sdk): project session stats without full history replay
47bd2cf64 Merge remote-tracking branch 'origin/main' into fix/task-411-profile-performance
```

`git status --short`: clean (empty). The docs commit adds only this report. Nothing was pushed.
