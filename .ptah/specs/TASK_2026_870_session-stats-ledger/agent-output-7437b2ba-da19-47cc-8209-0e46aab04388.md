# Phase 2 frontend cleanup

## Changes

- Preserved the known priced portion of mixed SQL usage groups through an optional `knownCostUsd` fact field. The dashboard displays that amount as a lower bound and retains the unpriced marker for totals, providers, models, days, and charts.
- Exposed the ledger's first capture day through an optional source-status field and displayed it beside the partial badge. An empty partial summary now says that historical coverage is partial.
- Kept backend session/message counts and top sessions as the dashboard source of truth. Presentation-only grouping remains necessary for provider series, model rows, and day rows because the existing RPC has day/model facts, not those display shapes. Legacy session cost estimation remains in place because its readers have not moved to `session_stats`.
- Updated the chat vitals cache timeout comment to reflect the current SQL ledger plus external-source reads. Its cache and live chat behavior are unchanged.
- Added a view-model regression test for mixed priced/unpriced SQL facts, lower-bound markers, and coverage start.

## Decisions

- Add optional `knownCostUsd` and `coverageStart` fields rather than replace the v1 RPC response. The SQL group has `known_cost_micro_usd` and `has_unpriced`, but the prior fact projection discarded the known cost for mixed groups. Existing clients remain compatible. Reversible.
- Keep chart-oriented folding because SQL supplies grouped facts but does not supply provider chart series or day/model presentation rows. Reversible if the RPC later exposes those shapes.

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-analytics.types.ts`
- `libs/backend/usage-analytics/src/lib/usage-summary.service.ts`
- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary-fold.ts`
- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary.view-model.ts`
- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary.view-model.spec.ts`
- `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.html`
- `libs/frontend/dashboard/src/lib/services/analytics-usage.store.ts`
- `libs/frontend/chat/src/lib/services/vitals/usage-vitals.cache.ts`

## Verification and gaps

- No git, test, build, or verify command was run, as requested.
- Scoped Ptah diagnostics were unavailable after 45 seconds with six TypeScript files unchecked. The changed template was not rendered or screenshot inspected because serving the app is outside this lane's allowed commands.
- The host exposes no skill-loading tool. The matching `angular-frontend-patterns` skill exists on disk, but could not be loaded as an invokable skill.
- No JSONL backfill or Phase 2 report was written.
