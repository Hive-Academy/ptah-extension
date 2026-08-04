# Cron Scheduler UI

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

Electron-only "Schedules" tab inside the Thoth shell. Lets users create, edit, enable/disable, and inspect cron-scheduled prompt jobs that run headless Ptah sessions on a schedule.

## Boundaries

**Belongs here**: cron tab UI, client-side cron-expression preview, signal state mirror for jobs/runs.
**Does NOT belong**: backend cron execution, validation as a trust boundary (backend `cron:create` is the authority), VS Code parity (this tab is gated to Electron at the shell level).

## Public API

From `src/index.ts`: `CronSchedulerTabComponent`, `CronRpcService`, `CronStateService`, `CronExpressionService` and `CronExpressionDescription` type.

## Internal Structure

- `src/lib/components/` — `cron-scheduler-tab.component.ts` (composite tab), `cron-job-card.component.ts` (one schedule as a `ptah-native-card`), `cron-job-detail-drawer.component.ts` (run history in a `ptah-native-drawer`), `cron-format.ts` (pure formatting helpers shared by all three)
- `src/lib/services/` — RPC client, state service, expression helper

## Key Files

- `src/lib/components/cron-scheduler-tab.component.ts:1` — tab UI; OnPush; explicit comment notes backend is the trust boundary; suggests a curated timezone list and detects user TZ via `Intl.DateTimeFormat`. Owns all `CronStateService` calls — the card and drawer are pure and emit events.
- `src/lib/components/cron-format.ts:1` — `formatTime` / `formatRelative` / `buildJobMetrics` / tone helpers. Documents the data limit: `ScheduledJobDto` has `lastRunAt` but no last-run status, so cards show WHEN a job ran, never HOW it went.
- `src/lib/components/cron-job-detail-drawer.component.ts:1` — the only surface that renders run outcomes (`cron:runs` is fetched for the selected job alone). Keeps `<section aria-label="Run history">`, which the showcase tour locates.
- `src/lib/services/cron-state.service.ts:23` — `providedIn: 'root'`; signal-based store for `jobs`, `selectedJobId`, `runs`, `loading`, `error`; client-side `stats` computed (no `cron:stats` RPC exists).
- `src/lib/services/cron-rpc.service.ts` — typed wrappers around 9 cron RPC methods.
- `src/lib/services/cron-expression.service.ts` — converts cron strings to human-readable descriptions for preview.

## State Management

Signals throughout; `computed` for `selectedJob` and aggregate `stats`. RPC types imported from `@ptah-extension/shared` (`CronCreateParams`, `CronUpdateParams`, `JobRunDto`, `ScheduledJobDto`).

## Dependencies

**Internal**: `@ptah-extension/core` (`VSCodeService`, `AppStateManager`), `@ptah-extension/shared` (cron DTOs), `@ptah-extension/ui` (`NativeCardComponent`, `NativeDrawerComponent`).
**External**: `@angular/common`, `@angular/forms`.

## Angular Conventions Observed

Standalone, OnPush, signals + `inject()`, `computed`.

## Guidelines

- Treat all client-side cron validation as preview-only — the source of truth is `cron:create` on the backend.
- Stats must be derived client-side from `jobs` (no dedicated `cron:stats` RPC). Don't fabricate one.
- Default to detected user timezone but allow override via curated list.
- Never fabricate a per-card run status. Outcome data only exists in `cron:runs`, which is loaded for the selected job — the drawer is its only home.
- `[data-testid="cron-job-card"]` is asserted by `apps/ptah-electron-e2e` (cron spec + both showcase tours). Rename it only alongside those files.
