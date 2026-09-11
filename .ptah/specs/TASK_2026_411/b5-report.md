# TASK_2026_411 — B5 report: progressive analytics UI

Date: 2026-09-11. Worktree `D:/projects/ptah-extension/.claude-worktrees/task-411-b4-b5`,
branch `fix/task-411-b4-b5` (on top of B4 `e72604346` / `af5b63968`). Executor:
frontend-developer subagent. Code commit: `d0d89cf08`.

## Outcome

The runtime break B4 left is fixed. Before, the dashboard sent up to 200 ids in one
`session:stats-batch` call, and the host now rejects any call with more than 20. Now each load:

1. Captures ONE `until = Date.now()` and `since = until - range`.
2. Calls `session:list` (limit 200, `since`), then calls `session:stats-batch` with
   `scope: 'range'`, `since`, `until`, in pages of at most `SESSION_STATS_BATCH_MAX_IDS` (20,
   imported from `@ptah-extension/shared`). The pages run one after another, and each page
   merges into the signals as it arrives.
3. Gets a new generation number and its own `AbortController`. A range change, a
   workspace change (a service `effect`) or `cancelLoad()` (card destroy) aborts the load.
   A response writes only if its generation, workspace and range are all still current.
4. Stores stats under a `workspace\u0000range\u0000since\u0000until\u0000session` key.
   `displayedSessions` reads only the active load's prefix.

Stack observed: Angular 21.2.6 (`package.json`), standalone + OnPush + signals/`inject()`
(dashboard `CLAUDE.md` and the existing components), daisyUI/Tailwind classes, Jest via
`jest-preset-angular` zone env (`src/test-setup.ts`). Frontend imports only
`@ptah-extension/core` and `@ptah-extension/shared`. It imports no backend lib.

## Files changed (commit `d0d89cf08`)

All under `libs/frontend/dashboard/src/lib/`:

- MODIFIED `services/session-analytics-state.service.ts`: paged, generation- and abort-guarded
  loads. New public signals: `isLoadingStats`, `statsProgress`, `hasMoreSessions`,
  `sessionCap`, `workspacePath`. New `cancelLoad()`. `DashboardSessionEntry` gains
  `status: 'pending' | …`, `coverage`, `untimestampedCount`, `pricingCoverage`.
  `AggregateTotals` gains pending/error/partial/untimestamped/unknown-cost/partially-priced
  counts. The old `if (_isLoading) return` guard is gone. It used to drop a range change made
  during a load and leave the wrong range on screen. A same-scope call now joins the load in
  flight instead.
- MODIFIED `utils/format.utils.ts`: `formatEstimatedCost` (null → "Unknown"),
  `formatSessionCost` (per status), `sessionCoverageNotes` (reasons, one sentence each).
- MODIFIED `components/analytics-card/analytics-card.component.{ts,html}`: an effect loads on
  mount and on each workspace change. `DestroyRef` cancels the load. The range selector stays
  mounted during loads, so the clicked button keeps focus. A `role="status"` `aria-live`
  list shows progress, the cap, partial coverage, failed sessions and unknown or partial
  pricing, with a Retry button for failed sessions.
- MODIFIED `components/session-analytics/metrics-cards.component.ts`: the tile is now
  "Est. Total Cost" with an estimate title. A null total shows "…" while pages are pending,
  then "Unknown".
- MODIFIED `components/session-analytics/session-stats-card.component.{ts,html}`: shows a
  pending loader with `aria-busy`, "Stats unavailable", a "Partial" badge (title gives
  the reasons), and "Est. Cost" per status. A null per-model cost shows "Unknown".
- MODIFIED `components/session-analytics/session-detail-modal.component.{ts,html}`: shows the
  same states, the estimate label and a list of coverage notes.
- CREATED `services/session-analytics-state.service.spec.ts` (17 tests).
- CREATED `components/analytics-card/analytics-card.component.spec.ts` (7 tests).
- CREATED `services/session-analytics-state.testing.ts`: spec-only fakes (a deferred RPC
  client, fixtures) shared by both specs. It is not exported from `index.ts` and uses no jest
  globals, so lib typecheck compiles it. Moving it to `src/testing/` (core's precedent)
  needs a `tsconfig.lib.json` exclude, which is outside B5 ownership.

No `project.json` edit (no `nx reset`), no `libs/shared` edit, no backend and no CLI edit.

## Behavior per state

| State | What the user sees |
| --- | --- |
| Loading list | Spinner "Loading sessions..." (`role="status"`). The range selector stays usable. |
| Loading stats | Every card is visible at once. A card with no page yet shows a dots loader, "Loading stats" and `aria-busy="true"`. The status line reads "Reading usage: N of M sessions". Totals grow as pages land. A null total reads "…" while pages are pending. |
| Partial | Card badge "Partial" when `coverage: 'partial'`, `untimestampedCount > 0`, or `pricingCoverage: 'partial'`. The title and modal give the reason. Status line: "Partial coverage in N sessions (K untimestamped usage records not counted)" and "…has no rate-card price; the total is a lower bound". |
| Cap | When `session:list.hasMore`: "Showing the 200 most recent sessions in this range; totals cover only these." |
| Estimate | Card badge "Estimated from recorded usage and current rate card" (the plan's wording). It replaces "Real costs from JSONL". Cost tiles read "Est. Cost" / "Est. Total Cost" and carry the same title. |
| Unknown cost | `totalCost: null` (`pricingCoverage: 'none'`) reads "Unknown", never $0. It is left out of the total. The status line reads "Cost unknown for N sessions … the total leaves them out". The aggregate stays `null` when no session has a price. An `'empty'` session reads "No usage". |
| Error | A host `status: 'error'`, a failed or timed-out page, an id the page did not answer, or a page whose echoed scope/since/until differs from the load: those sessions become `'error'` ("Stats unavailable"). Later pages still load. After the load settles: "Stats unavailable for N sessions" + Retry. A `session:list` failure keeps the existing error alert + Retry. |

## Tests added (24)

`session-analytics-state.service.spec.ts` (17):

- Paging: 45 sessions → sequential pages 20/20/5. Each page is ≤ 20, `scope: 'range'`, same
  `since`/`until`, and the next page is requested only after the previous one lands.
  200 sessions with `hasMore` → 10 pages, cap reported. Empty range → no stats call. No
  workspace → error, no RPC.
- Progressive paint: after page 1 of 3 lands, sessions 0-19 are `ok`, sessions 20-44 are
  `pending`, progress is 20/45, the total is 10, page 2 is in flight and page 3 is not yet
  requested.
- Race: a range change aborts the in-flight page's signal. Its late answer writes nothing,
  even for the same session ids in the new range, and the old load issues no further page.
  A late `session:list` from the old range cannot replace the new list. A workspace change
  aborts the load (via the effect) and clears data. A page that lands after a workspace
  change but before the effect runs cannot write. A→B→A with a frozen `until` (only the
  generation differs) cannot write. A same-scope call joins the load. `cancelLoad` aborts
  and stops paging. A reload with a new `until` repaints from pending.
- Coverage/cost: a failed page gives `error` and later pages still load. An unanswered id
  and a mismatched echo window both give `error`. Null cost stays null; partial,
  untimestamped and partially-priced counts are checked. A total with no priced session is
  `null`, not 0.

`analytics-card.component.spec.ts` (7, real state service + fake RPC): loads on mount and shows
the estimate label. The DOM paints 20 of 25 cards before page 2 lands (pending markers go
25 → 5 → 0; progress text "0 of 25" → "20 of 25" → gone). The range selector stays mounted
through a reload. The cap notice renders. Null cost renders "Unknown" in the card and
aggregate tiles, no "$0.00" appears, and the Partial badge shows only on the partial
session. Failed stats show the notice and Retry. Destroying the card aborts the in-flight page.

## Gate results

- `npx nx run-many -t test -p @ptah-extension/dashboard --skip-nx-cache`: header "Running
  target test for project @ptah-extension/dashboard". Test Suites 6 passed / 6, Tests 67
  passed / 67, "Successfully ran target test". The new specs alone: 17/17 and 7/7.
  Jest printed "A worker process has failed to exit gracefully" when the two new suites
  shared parallel workers. Neither suite prints it alone, and neither did the pre-existing
  harness-card + thoth-status baseline (28/28). I could not attribute it to one suite, so I
  record it here and do not claim it is fixed.
  An earlier run failed 3 tests on a missing `formatEstimatedCost` import, then 1 test on a
  wrong spec expectation (Partial badge on an unknown-cost-only session). I changed the badge
  rule rather than the assertion. Both are fixed in the committed code.
- `npx nx run-many -t typecheck -p @ptah-extension/dashboard @ptah-extension/shared --skip-nx-cache`:
  header "Running target typecheck for 2 projects", "Successfully ran target typecheck for 2
  projects", exit 0.
- `npx nx run-many -t lint -p @ptah-extension/dashboard --skip-nx-cache`: "✔ All files pass
  linting", "Successfully ran target lint". One run died on the environment error "Could not
  determine Node.js install directory" before linting anything. The rerun passed.
- Race + progressive-paint specs: all pass (listed above). No page exceeds 20 ids.
- No global RPC timeout increase: `libs/frontend/core/src/lib/services/claude-rpc.service.ts`
  is unchanged (`git diff --stat HEAD` empty) and still has `const timeout = options?.timeout ??
  30000;` (line 136). The analytics service passes only `{ signal }`. Grep for `timeout` in
  `libs/frontend/dashboard/src` finds only the pre-existing skill-selection card's own
  constant and spec strings.

## Plan deviations

1. Cache scope: the key includes `until`, and each load captures a new `until`, so no entry
   from one load can ever serve another. The store therefore keeps only the active load's
   entries (reset per load). Re-reads stay cheap because of B4's host-side file ledger cache.
2. Pages are sequential, not concurrent. The host already processes two parent files per
   page, and concurrent pages would queue behind each other inside the unchanged 30 s timeout.
3. Page failures do not fail the whole load. The affected sessions become `'error'` so later
   pages still paint.
4. The frontend abort only releases the awaited call and stops further pages. The host bounds
   its own per-page work (B4 `STATS_PAGE_BUDGET_MS = 20_000`), as `RpcCallOptions.signal`
   documents.

## Out-of-scope observations

- `apps/ptah-cli` `ptah session stats` still needs >20-id chunking (handled separately).
- `libs/frontend/dashboard/CLAUDE.md` describes the state service only as "signal state for
  session aggregate totals". It does not mention paging, the 20-id cap, the 200-session cap
  or the estimate label. That doc is not in B5 ownership.
- The dashboard lib has no `src/testing/` exclude in `tsconfig.lib.json`. Adding one would let
  spec fakes follow core's layout.

## Git state when this report was written (before the docs commit)

`git log --oneline -4`:

```
d0d89cf08 perf(dashboard): page session analytics progressively
af5b63968 docs(task-specs): record TASK_2026_411 b4 completion
e72604346 perf(agent-sdk): project session stats without full history replay
47bd2cf64 Merge remote-tracking branch 'origin/main' into fix/task-411-profile-performance
```

`git status --short`:

```
?? .ptah/specs/TASK_2026_411/b4-code-logic-review.md
```

That untracked file belongs to the concurrent B4 reviewer and is not staged by B5. The
follow-up commit `docs(task-specs): record TASK_2026_411 b5 completion` adds this report and
the batches.md heading. Nothing was pushed.
