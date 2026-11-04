# P1 review fix round 2

| Finding | Confirmed? | Fix (files) | Regression spec |
| --- | --- | --- | --- |
| N1: changed head cancels without result status | Yes | `sqlite-review.repository.ts` records `superseded`; `review-query.repository.ts` maps legacy cancelled rows with null result to `superseded` | `sqlite-review.repository.spec.ts`; `review-query.repository.spec.ts` |
| N2: Refresh does not retry poll | Yes | `review-runs.store.ts` calls `review:refresh` then reloads; `review-runs-page.component.ts` routes header Refresh to it | `review-runs.store.spec.ts`; `review-runs-page.component.spec.ts` |

## Decisions

- Header Refresh initiates a discovery poll because the failed-poll alert directs operators to it; initial load and connection retries remain SQLite reads. Reversible by changing the header binding.
- The refresh RPC requires a repository identity although its current handler polls globally. Use the first loaded repository, then configured settings, then the existing default repository so Refresh also works before the first list load. Reversible if the RPC contract changes.
- Map only legacy `cancelled` rows with no result status to `superseded`. Other missing terminal results still fail so unrelated data errors remain visible. Reversible after legacy rows are migrated.

## Verification

- Scoped `ptah_get_diagnostics` reported no errors in the eight edited source and spec files. It reported five existing BigInt target errors in sibling `libs/shared` files.
- Nx/npm checks were not run per D26; the orchestrator owns `npm run verify`.
