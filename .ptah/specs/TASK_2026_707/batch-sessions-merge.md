# Sessions merged into Usage

## Preserve list

| Item | Status | Evidence |
| --- | --- | --- |
| Total cost and total tokens | Stays in Usage | `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.html:88-151`; KPI tokens at `usage-kpi-strip.component.ts:28` |
| Sessions, messages, subagents | Moved into Usage KPI strip for the selected summary range | `usage-kpi-strip.component.ts:78-82`; `usage-summary.service.ts:40-42,125`; `usage-summary.view-model.ts:219-221` |
| Input, output, cache read/write/hit composition | Stays in Usage | `usage-kpi-strip.component.ts:38-65,105`; `usage-summary-fold.ts:98-111`; cached share at `usage-summary.view-model.ts:225` |
| 1d/2d/3d/1w/2w | Replaced with 7d/30d/90d | `usage-dashboard.component.html:9-24`; `rpc-analytics.types.ts:13` |
| Top 5 sessions by cost | Added compact table under breakdown; priced desc, unpriced after, then tokens; range and prices from same summary pass | `usage-dashboard.component.html:164`; `usage-top-sessions.component.ts:12-50`; `usage-summary.service.ts:60-80,120-125` |
| Cards, modal, toggle, Session Analytics heading | Removed from card | `analytics-card.component.ts:1-11`; `analytics-card.component.html:1-4`; regression spec `analytics-card.component.spec.ts:21-32` |

## Changes and line counts

Added: `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-top-sessions.component.ts` (54 lines).

Changed: `libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.ts` (11), `.html` (4), `.spec.ts` (34); `libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.ts` (132), `.html` (170), `.spec.ts` (838), `usage-kpi-strip.component.ts` (135), `usage-summary.view-model.ts` (298); `libs/shared/src/lib/types/rpc/rpc-analytics.types.ts` (60), `.spec.ts` (29); `libs/backend/usage-analytics/src/lib/usage-source.types.ts` (29), `usage-summary.service.ts` (142), `.spec.ts` (56), `sources/claude-ledger.source.ts` (42), `sources/codex.source.ts` (68), `sources/opencode.source.ts` (61), `sources/grok.source.ts` (66); `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts` (450). Counts are final file lengths.

Deleted: `libs/frontend/dashboard/src/lib/components/session-analytics/metrics-cards.component.ts` and `.spec.ts`; `session-stats-card.component.ts` and `.spec.ts`; `session-detail-modal.component.ts` and `.spec.ts`. Original line counts were not captured before deletion.

## Deleted symbol consumer audit

- `MetricsCardsComponent`, `SessionStatsCardComponent`, `SessionDetailModalComponent`: sole runtime imports were in `AnalyticsCardComponent`. Their component specs were removed with them. No host imports or public index exports were found.
- The card's `SessionAnalyticsStateService` usage was removed. The service and `session:stats-batch` RPC remain: the service is exported at `libs/frontend/dashboard/src/index.ts:23`, and CLI/TUI session commands still consume the RPC (`apps/ptah-cli/src/cli/commands/session.ts:964`, `apps/ptah-tui/src/hooks/use-sessions.ts`). The host-source registry baseline remains unchanged.

## Verification

- `npx jest -c libs/backend/usage-analytics/jest.config.ts libs/backend/usage-analytics/src/lib/usage-summary.service.spec.ts --coverage=false --maxWorkers=1`: 1 suite, 3 tests passed.
- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/rpc-analytics.types.spec.ts --coverage=false --maxWorkers=1`: 1 suite, 3 tests passed.
- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/analytics-card/analytics-card.component.spec.ts libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.spec.ts libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary.view-model.spec.ts --coverage=false --maxWorkers=1`: 3 suites, 56 tests passed. After the new table assertion, targeted rerun of card and dashboard specs: 2 suites, 36 tests passed.
- `ptah_get_diagnostics`: no errors in requested edited files; ten errors remain in untouched sibling files (`mock-rpc-service.ts`, `skill-selection-card.spec.ts`, `capability-id-codec.ts`, `attention-identity.ts`). A broader scoped check timed out, followed by a clean scoped result for summary service and table component.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Add session summary rows beside aggregated facts | Day/model facts lose session identity in `usage-summary.service.ts`; per-contribution aggregation retains the same pricing and dedup pass. | Yes |
| Keep session stats RPC and state service | CLI/TUI consume `session:stats-batch`; dashboard public index exports the service. | Yes |
| Show tracked counts from sources with session identity | Claude, Codex, OpenCode and Grok expose an identity; unavailable dated sources do not. The KPI wrapper tooltip states this scope. | Yes |
| Use synthetic `Session <id>` title when a source does not expose a title | OpenCode database exposes a title; Claude, Codex and Grok usage readers currently expose IDs only. Synthetic title preserves a stable useful label without reading prompt text. | Yes |

## Proposed Removals

- The exported `SessionAnalyticsStateService` and its test fixtures may be dead for dashboard runtime, but the public index and existing tests still reference them. A separate public API audit should decide their removal.
- Legacy docs, Electron showcase copy, and VS Code command titles still say “Session Analytics”; changing them is outside the assigned interface paths.

## Not done

- No build, Nx checks, e2e, or per-host compilation: explicitly prohibited for this batch. The targeted Jest specs and scoped diagnostics above are the verification performed.
- Session and message counts are counts of contributions with session identity, and message count uses source request records. Sources without identity remain in total cost and tokens but cannot contribute to session rows. Claude/Codex/Grok titles fall back to IDs. The table tooltip shows the full supplied title (bounded to 500 characters by the RPC schema).
