# Thoth Shell

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

The four-tab "Thoth" hub component composing the agentic-platform features (Memory · Skills · Schedules · Messaging). Hosts the sidebar tab rail, persists the active tab via `AppStateManager`, and slots in the per-feature tab components. Each sidebar item is a clickable **status tile** that shows that pillar's live metric (facts / pending candidates / jobs / running adapters) sourced from `ThothStatusService.pillars` (`@ptah-extension/dashboard`) — there is no separate status row above the content.

## Difference from `webview-shell`

`thoth-shell` is **inner-chrome**: it's the Thoth panel rendered inside the larger webview shell. It is reused across the VS Code webview and the Electron app — but Cron and Gateway tabs are visually gated to Electron only at this level.

## Boundaries

**Belongs here**: tab strip, active-tab persistence, Electron-gating of cron/gateway tabs.
**Does NOT belong**: tab content (each feature has its own `*-ui` lib), application-level routing (`@ptah-extension/core`), Electron detection primitives.

## Public API

From `src/index.ts`: `ThothShellComponent`, `ThothActiveTabId` (`'memory' | 'skills' | 'cron' | 'gateway'`).

## Internal Structure

- `src/lib/components/` — `thoth-shell.component.ts` (the only component)

## Key Files

- `src/lib/components/thoth-shell.component.ts:35` — single composite component; OnPush; standalone; imports the four tab components from their feature libs; `electronOnly: true` flag filters cron/gateway when `!vscode.isElectron`; persists `activeTab` through `AppStateManager.thothActiveTab`; sidebar tiles read `ThothStatusService.pillars` and a one-shot `refreshIfNeeded()` fires on init.

## State Management

- Signals + `computed`.
- Tab visibility is computed from `ThothTabSpec[]` filtered by `electronOnly` vs current platform.
- Active tab read/written via `AppStateManager`.
- Live per-tile metrics come from `ThothStatusService.pillars` (keyed by tab id); the shell triggers the lazy refresh on init.

## Dependencies

**Internal**: `@ptah-extension/core` (`AppStateManager`, `VSCodeService`), `@ptah-extension/dashboard` (`ThothStatusService`, `ThothGatewayBadge`), `@ptah-extension/memory-curator-ui`, `@ptah-extension/skill-synthesis-ui`, `@ptah-extension/cron-scheduler-ui`, `@ptah-extension/messaging-gateway-ui`.
**External**: `lucide-angular`, `@angular/common`.

## Angular Conventions Observed

Standalone, OnPush, signals, control-flow `@switch / @case`, ARIA `role="tablist"` / `role="tab"` / `role="tabpanel"` on the tab strip.

## Guidelines

- This is the canonical place to add new Thoth pillars — extend `ThothActiveTabId` and `ThothTabSpec`. Each tab's content **must** live in its own `*-ui` lib.
- Cron and Gateway tabs **must** stay `electronOnly: true`; the individual tab components also gate themselves, but this shell hides them from the strip on VS Code.
- Tab persistence belongs in `AppStateManager`, not local component state — preserves user position across navigation.
