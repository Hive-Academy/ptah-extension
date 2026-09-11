# TASK_2026_411 — B4 report: stats projection, cache, and RPC

Date: 2026-09-11. Worktree `D:/projects/ptah-extension/.claude-worktrees/task-411-b4-b5`,
branch `fix/task-411-b4-b5` (base `47bd2cf64`). Executor: backend-developer subagent
(workflow override authorised by the user: subagents, parallel worktrees, commits per batch).

## Outcome

`session:stats-batch` no longer touches the history reader. A new stats-only reader streams
each transcript line by line, keeps only usage/timestamp/model/identity/compact-boundary
fields, caches the per-file projection on an exact `(size, mtimeMs)` token, and prices tokens
at serve time from the transcript's own model id. Pages are capped at 20 UUIDs, two parent
files and three subagent files at once, with yielding reads and an abort budget.

## Files changed (commit `e72604346`)

Created — `libs/backend/agent-sdk/src/lib/session-stats/`:

- `session-usage-ledger.ts` — Zod-validated line projection + `SessionUsageLedgerBuilder`
  (dedupe per `message.id`, compact boundary index, init model, first session id).
- `session-usage-aggregator.ts` — pure scope selection, totals, per-model breakdown, cost,
  coverage flags; `emptySessionStats` / `failedSessionStats`.
- `session-usage-ledger-cache.ts` — LRU (512 entries / 16 MiB estimated) + in-flight
  coalescing; no TTL; failures never stored.
- `session-stats-reader.service.ts` — `SessionStatsReaderService` (DI singleton): validation,
  sessions dir, nested/legacy subagent membership, concurrency limits, abort.
- `index.ts` — barrel.
- Specs: `session-usage-aggregator.spec.ts`, `session-usage-ledger-cache.spec.ts`,
  `session-stats-reader.service.spec.ts`.

Modified:

- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts` — new
  `projectJsonlLines(filePath, visit, { signal?, byteLength? })`; `parseJsonlStream` now shares
  one `scanJsonlLines` scanner (same yield budget, CRLF/blank handling, abort at each yield).
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.streaming.spec.ts` — projection specs.
- `libs/backend/agent-sdk/src/lib/helpers/history/index.ts`, `libs/backend/agent-sdk/src/index.ts` —
  exports.
- `libs/backend/agent-sdk/src/lib/di/tokens.ts` — `SDK_SESSION_STATS_READER = Symbol.for('SdkSessionStatsReader')`.
- `libs/backend/agent-sdk/src/lib/di/register.ts` — singleton registration.
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` — history reader
  injection removed; `SDK_SESSION_STATS_READER` injected; stats handler rewritten; `cliAgentsFor`.
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.schema.ts` — `SessionStatsBatchParamsSchema`.
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts` — harness + stats specs
  + source-level regression.
- `libs/shared/src/lib/types/rpc/rpc-session.types.ts` — contract below.

No app DI manifest edit was needed: `expected-resolvable.ts` lists handler classes only, and the
container smoke specs call the real `registerSdkServices`. No `project.json` edit, so no `nx reset`.
No new RPC method or prefix (`session:` already allowed).

## RPC / types contract (B5 depends on this)

All in `@ptah-extension/shared` (`rpc-session.types.ts`, re-exported by `rpc.types.ts`):

```ts
export type SessionStatsCoverage = 'complete' | 'partial';
export type SessionStatsPricingCoverage = 'full' | 'partial' | 'none';
export type SessionStatsScope = 'current-context' | 'range';
export const SESSION_STATS_BATCH_MAX_IDS = 20;

export interface SessionStatsBatchParams {
  readonly sessionIds: string[];          // 0..20 UUIDs (UUID_REGEX)
  readonly workspacePath: string;
  readonly scope?: SessionStatsScope;     // default 'current-context'
  readonly since?: number;                // epoch ms, inclusive; required iff scope === 'range'
  readonly until?: number;                // epoch ms, exclusive; required iff scope === 'range'
}

export interface SessionStatsBatchResult {
  readonly sessionStats: SessionStatsEntry[]; // request order
  readonly scope?: SessionStatsScope;         // always set by B4 handler
  readonly since?: number;                    // echoed for 'range'
  readonly until?: number;                    // echoed for 'range'
}

export interface SessionStatsEntry {
  readonly sessionId: string;
  readonly model: string | null;
  readonly totalCost: number | null;          // null exactly when pricingCoverage === 'none'
  readonly tokens: { input; output; cacheRead; cacheCreation: number };
  readonly messageCount: number;              // parent assistant messages in scope (deduped)
  readonly agentSessionCount?: number;        // member subagent files (incl. unreadable)
  readonly cliAgents?: readonly string[];     // set on 'ok' and 'empty', absent on 'error'
  readonly modelUsageList?: ReadonlyArray<{ model; inputTokens; outputTokens; costUSD: number | null }>;
  readonly status: 'ok' | 'error' | 'empty';
  readonly coverage?: SessionStatsCoverage;           // new, always set by B4
  readonly untimestampedCount?: number;               // new, always set by B4
  readonly pricingCoverage?: SessionStatsPricingCoverage; // new, always set by B4
}
```

Validation (`SessionStatsBatchParamsSchema`, a strict union): unknown keys rejected; `since`/
`until` are non-negative integers with `since <= until`; `since`/`until` on `current-context`
rejected. Failure → `RpcUserError` with `errorCode: 'INVALID_PARAMS'` before any read.
`workspacePath` outside the open folders → `workspace-not-authorized` (unchanged).

Semantics:

- `current-context`: parent records after the last `compact_boundary` + every subagent record.
  `untimestampedCount` is always 0.
- `range`: every parent and subagent usage record with timestamp in `[since, until)`; compact
  boundaries ignored. Untimestamped usage records are omitted, counted in `untimestampedCount`,
  and make `coverage: 'partial'`.
- `status`: `'empty'` when the transcript is missing or the scope holds no usage record;
  `'error'` on an I/O failure or when the page budget/abort hit before the session finished;
  otherwise `'ok'` (zero totals possible).
- `coverage: 'partial'` also when a member subagent file could not be read.
- Cost: current rate card (`findModelPricing`) applied to the transcript's model id when the page
  is served. Record with no model uses the parent `init` model; with neither, its tokens are
  unpriced. `pricingCoverage`: `'none'` if no counted model has a rate, `'partial'` if any
  unpriced tokens > 0, else `'full'`.
- Duplicates: one record per `message.id`; a later line replaces only the counters it carries
  (PR #490's per-component rule). Timestamp = first parseable timestamp for that id.
- Bounds: `PARENT_FILE_CONCURRENCY = 2`, `SUBAGENT_FILE_CONCURRENCY = 3` (page-wide), reads
  yield every 200 lines / 1 MiB; handler abort budget `STATS_PAGE_BUDGET_MS = 20_000`
  (inside the unchanged 30 s RPC timeout).

B5 note: a page with more than 20 ids is rejected. The current dashboard sends every missing id
in one call, so dashboard stats fail at runtime until B5 pages at 20.

## Tests added

- `session-usage-aggregator.spec.ts` (9): golden current-context and range totals/costs by hand,
  duplicate-id counters, malformed counter, null cost, unreadable subagent, compaction → empty,
  modelless usage.
- `session-usage-ledger-cache.spec.ts` (7): size+mtime validity, entry and byte LRU bounds,
  oversize not stored, coalescing, failure not cached, waiter retry after another caller's abort,
  pre-aborted waiter.
- `session-stats-reader.service.spec.ts` (13, real temp filesystem): nested subagents without
  `readJsonlMessages`/`loadAgentSessions`; legacy flat membership; missing/invalid/>20 ids;
  invalidation after append, same-size rewrite (mtime moved), subagent add and remove, range
  change reusing the cache; serve-time pricing without re-projection; partial coverage; abort
  before and mid-page with nothing cached; synthetic 20-id page (20 parents × 601 lines,
  40 subagents × 451 lines) asserting max 2 parents, 2..3 subagents in flight, and every
  projection's `yields` >= line budget — no wall-clock assertion; 6-subagent cap = 3.
- `jsonl-reader.streaming.spec.ts` (+4): projection visits, yield count, `byteLength`, abort.
- `session-rpc.handlers.spec.ts`: stats specs rewritten (ordering + `cliAgents`, default scope
  + abort signal, range forwarding/echo, 6 INVALID_PARAMS cases, exactly 20 ids, metadata failure)
  and the source-level regression: handler source contains none of `readSessionHistory`,
  `SessionHistoryReaderService`, `SDK_SESSION_HISTORY_READER`, and the stats method calls
  `this.statsReader.readStats(`.

## Gate results

- Focused agent-sdk (`npx jest -c libs/backend/agent-sdk/jest.config.ts …/session-stats …/jsonl-reader`):
  5 suites, 80 tests passed.
- Focused rpc-handlers (`…/session-rpc`): 2 suites, 101 tests passed.
- `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/shared --skip-nx-cache`:
  header "Running target test for 3 projects".
  - shared: 56/56 suites, 1368 passed.
  - agent-sdk: 90 passed, 1 skipped (91); 1554 passed, 2 skipped.
  - rpc-handlers: 93 passed, 1 failed (94); 2734 passed, 1 failed, 31 skipped. The failure is
    `voice-rpc.handlers.spec.ts`, which has no diff on this branch (`git diff 47bd2cf64` empty)
    and passes alone. Re-run `npx nx run-many -t test -p @ptah-extension/rpc-handlers --skip-nx-cache`:
    94/94 suites, 2735 passed, 31 skipped. An earlier 3-project run also failed
    `session-stats-reader.service.spec.ts` (70 s under load, default Jest timeout) and
    `quality-rpc.handlers.spec.ts`; both pass alone, and the stats suite now sets
    `jest.setTimeout(120_000)` (limit only, no timing assertion). Host-load flakes, recorded
    honestly rather than claimed green.
- `npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/dashboard --skip-nx-cache`:
  "Successfully ran target typecheck for 4 projects".
- ESLint on every touched file: 0 errors, 1 warning — `session-rpc.handlers.ts` `max-lines`
  (995 > 700 soft ceiling; pre-existing, the file shrank in this batch).
- Degradation audit (`tools/degradation-audit/check-degradation.ts`): `agent-sdk 4 ok (baseline 4)`,
  `rpc-handlers 1 ok (baseline 1)`, `shared/src 3 ok (baseline 3)`. The command still exits
  non-zero because of pre-existing `platform-electron 13 FAIL (baseline 4)` and
  `vscode-core 1 FAIL (baseline 0)`, both outside this batch.
- Reference-host 30 s wall-clock check: not run (secondary per batches.md; B9 owns it).

## Plan deviations (approved or recorded)

1. Cache unit (approved deviation). The plan keyed cache entries on
   workspace/session/scope/range + file tokens + rate-card revision. B4 caches the scope-free
   per-FILE ledger keyed on path with `(size, mtimeMs)`, re-lists subagent membership on every
   request, and prices at serve time. Reason: the dashboard's `until` changes every load, so a
   range-keyed result would never hit; a ledger answers every scope and range exactly. No rate-card
   revision exists or is needed because cost is not cached.
2. No active-provider fallback. The old path priced through `IModelResolver.resolveForCost`
   (tier overrides of the ACTIVE provider) and, for direct Anthropic, hydrated missing prices via
   `IPricingProvider`. The reader uses the transcript model id verbatim against the shared rate
   card and does no network hydration. Effect: a session recorded through a third-party provider
   whose transcript names a Claude tier id is now priced at that id's published rate (or null if
   unpriced) instead of the current provider's mapped model. Such cost stays nullable/partial;
   nothing is guessed. Cost telemetry beyond this remains TASK_2026_418's.
3. Duplicate lines (approved). Tokens and `messageCount` now count one record per `message.id`;
   the old path summed every content-block line, inflating both.
4. Projection reads exactly `size` bytes (`byteLength`) so a ledger matches its token even
   during an append. No 50 MB cap on this path; memory is bounded by the longest line.
5. Stats-batch no longer seeds `LiveUsageTracker` as a side effect; `chat:resume` still does.
6. `session:list.hasMore` already existed; nothing changed there.

## Out-of-scope observations

- `apps/ptah-cli/src/cli/commands/session.ts` `runStats` sends every `--ids` value in one
  `session:stats-batch` call; more than 20 ids is now rejected. Needs chunking (not in B4 ownership).
- Dashboard `session-analytics-state.service.ts` sends all missing ids (up to 200) at once —
  rejected until B5 lands.
- `libs/backend/agent-sdk/CLAUDE.md` `LiveUsageTracker` bullet still cites stats-batch as a reason
  for its 64-entry bound, and its module list does not mention `session-stats/`.

## Git state when this report was written (before the docs commit)

`git log --oneline -3`:

```
e72604346 perf(agent-sdk): project session stats without full history replay
47bd2cf64 Merge remote-tracking branch 'origin/main' into fix/task-411-profile-performance
6958f17f7 docs(task-specs): record TASK_2026_411 plan, batches and reviews
```

`git status --short`: clean (empty). The follow-up commit
`docs(task-specs): record TASK_2026_411 b4 completion` adds this report and the batches.md
heading. Nothing was pushed.
