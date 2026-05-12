# Dashboard

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

Home/dashboard surface for Ptah. Renders a responsive grid of cards: session analytics (cost/tokens/sessions) and a Thoth pillar status card (memory · skills · cron · gateway) with click-through to the matching Thoth tab.

## Boundaries

**Belongs here**: dashboard grid layout, analytics card composition, Thoth status aggregation, session analytics state.
**Does NOT belong**: charting libraries / real-time metric pipelines (this lib is currently card-only — no Chart.js), per-feature tab UIs (each lives in its own `*-ui` lib).

## Public API

From `src/index.ts`:

- Components: `DashboardGridComponent`, `AnalyticsCardComponent`, `ThothStatusCardComponent`.
- Services: `ThothStatusService`, `SessionAnalyticsStateService`.
- Types: `ThothStatusSummary`, `ThothMemorySummary`, `ThothSkillsSummary`, `ThothCronSummary`, `ThothGatewaySummary`, `ThothGatewayPlatformSummary`, `ThothGatewayBadge`, `DashboardSessionEntry`, `AggregateTotals`.

## Internal Structure

- `src/lib/components/dashboard-grid/` — top-level page layout
- `src/lib/components/analytics-card/` — session analytics card
- `src/lib/components/thoth-status-card/` — Thoth pillar summary card
- `src/lib/components/session-analytics/` — detail view sub-components
- `src/lib/services/` — `thoth-status.service.ts`, `session-analytics-state.service.ts`
- `src/lib/utils/`

## Key Files

- `src/lib/components/dashboard-grid/dashboard-grid.component.ts:32` — page chrome; navigates back to chat via `AppStateManager.setCurrentView('chat')`.
- `src/lib/services/thoth-status.service.ts:1` — aggregates state from `MemoryRpcService`, `SkillSynthesisRpcService`, `CronRpcService`, `GatewayRpcService` to compute pillar summaries with `available: false` fallbacks (`'desktop-only' | 'error'`).
- `src/lib/services/session-analytics-state.service.ts` — signal state for session aggregate totals.

## State Management

Signals + `computed`. `ThothStatusService` is a fan-in: it depends on RPC services exported by each Thoth feature lib (memory-curator, skill-synthesis, cron-scheduler, messaging-gateway).

## Dependencies

**Internal**: `@ptah-extension/core` (`AppStateManager`, `VSCodeService`), `@ptah-extension/shared` (DTOs), `@ptah-extension/memory-curator-ui`, `@ptah-extension/skill-synthesis-ui`, `@ptah-extension/cron-scheduler-ui`, `@ptah-extension/messaging-gateway-ui`.
**External**: `lucide-angular`.

## Angular Conventions Observed

Standalone, OnPush, signals + `inject()`, external `.html` templates for the grid.

## Guidelines

- The Thoth status card must degrade gracefully when a pillar is desktop-only or errors out — surface `available: false` rather than throwing.
- Don't add chart libraries here speculatively; keep the dashboard card-driven until a real need lands.
- Cross-lib RPC composition is intentional here — this is the one place that fans out across all Thoth pillars.
