# P1-14 review runs UI report

## Files

- `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts`: signal store, validated RPC reads, cache and filters.
- `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.ts`: page, banners, filters, empty and loading states.
- `libs/frontend/review-runs-ui/src/lib/components/review-repositories.component.ts`: responsive repository rail.
- `libs/frontend/review-runs-ui/src/lib/components/review-runs-list.component.ts`: focusable rows and arrow-key navigation.
- `libs/frontend/review-runs-ui/src/lib/review-runs.store.spec.ts`, `components/review-runs-page.component.spec.ts`, `components/review-runs-list.component.spec.ts`: focused specs.
- `libs/frontend/review-runs-ui/src/index.ts`: public exports.

## Store API

`ReviewRunsStore` exposes `runs`, `repositories`, `state`, `repoFilter`, `stateFilter`, `lastRefreshedAt`, `selectedAttemptId`, `isRefreshing`, `hasCache`, `filteredRuns`, and `queuedCount` signals/computeds. Methods: `load`, `setRepoFilter`, `setStateFilter`, `clearFilters`, `selectRun`, and `setNoLanesAvailable`. Refresh retains validated data on failure. No raw RPC error is rendered.

## RPC for P1-16

Store calls `review:listRepositories` with parsed `ReviewRpcSchemas['review:listRepositories'].params` (`{}`) and parses its result (array of `RepositorySettingsSchema`, max one); `review:listRuns` with parsed params (`{ limit: 100 }`) and parses its result (`runs: ReviewRunSchema[]`, `nextCursor`). Both use `ClaudeRpcService` and a 5-second timeout. The shared `RpcMethodName` union does not yet contain review methods; P1-16 must add them and replace the temporary local call signature assertion. The store makes no mutations.

## State to UI

| State | UI |
| --- | --- |
| Loading without cache | Three skeleton rows and `aria-busy` |
| Ready with runs | Repository rail and responsive focusable list |
| Ready with no repositories | Repository setup explanation |
| Ready with no runs | No review runs yet and Refresh |
| Filtered empty | No matching runs and Clear filters |
| Refresh with cache | Existing content retained with `aria-busy` |
| Offline with cache | Warning, cache timestamp, Retry connection, existing rows |
| Initial error | Plain error and Retry |
| No lanes | Warning that no clean result was produced |

## Prototype parity

Inspected approved prototype in the Ptah browser at 1280 × 900. Implemented 280px rail at 900px+, stacked layout below, header icon tile, repository cards, DaisyUI filters, row badges, queue count, and visible keyboard focus. Preview state is omitted per N3. Run rows use PR number because `ReviewRunSchema` has no PR title; elapsed time and posted/suppressed counts are also absent. The static prototype was rendered; Angular was not rendered in Electron because D22 reserves that for a user-approved integration run.

## Decisions

- Represent contract `succeeded` as “Completed” and `partial` as “Partial / coverage limited”; options were prototype publication labels or contract statuses. The contract is authoritative. Reversible.
- Keep no-lanes state explicit through `setNoLanesAvailable`; options were inferring from empty fallback families or an explicit state. The list RPC has no lane availability result. Reversible.
- Treat failed refresh after successful load as offline/cached; options were replacing content or retaining validated history. Design states call for cached history. Reversible.
- Omit posting mode and global pause without settings data. Prototype sample values are not live data. Reversible in P1-15/P1-16.

## Verification and open issues

- Scoped `ptah_get_diagnostics` found zero errors in requested files. It reported five BigInt target errors in sibling `libs/shared` files.
- Nx and Jest were not run in this lane under D26. The orchestrator should run `npm run verify -- -p review-runs-ui` and relay failures.
- Contract has no `interrupted` state, PR title, posted/suppressed counts, lane availability, poll result, or offline health signal. P1-16 must define authoritative integration; this batch does not invent those values.
- No skill-loading tool was available, so `angular-frontend-patterns` could not be loaded.
