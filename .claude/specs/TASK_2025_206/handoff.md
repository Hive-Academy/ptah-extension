# TASK_2025_206: Session Analytics Dashboard — Handoff

## Status: FUNCTIONAL (v2) — Ready for Polish & Enhancements

The dashboard is live, loading real data from JSONL files, and displaying per-session stats cards with model badges, cost, tokens, and CLI agent info.

## What Was Built (Commits in Order)

### v1 (replaced)

1. `d9896ec4` feat(webview): add session analytics dashboard with pricing estimates — initial flat table (all zeros)
2. `ce8edfa5` chore(landing): clean up premium showcase components
3. `eb667947` fix(webview): pass token usage from metadata in session:list and restyle dashboard

### v2 (current)

4. `8aae8ee8` feat(webview): redesign dashboard with per-session stats cards from JSONL — **THE BIG ONE**: new `session:stats-batch` RPC, card layout, 5/10 toggle
5. `62bcee48` fix(webview): address dashboard review findings — concurrent JSONL reads, a11y, aggregates over all sessions, status field, NaN guards
6. `54169812` fix(webview): read workspaceInfo from ptahConfig during AppStateManager init — fixed "No workspace detected" error
7. `fc8dd896` fix(vscode): preserve model field from JSONL init messages in history reader — model badge now works
8. `a3a98c2d` feat(webview): show agent session count on dashboard cards — subagent count in footer
9. `fb958199` feat(webview): show CLI agent badges on dashboard session cards — gemini/codex/copilot/ptah-cli badges

## Architecture

### Data Flow

```
Frontend Dashboard Opens
  → SessionAnalyticsStateService.loadDashboardData()
    → RPC: session:list (metadata: IDs, names, dates)
    → RPC: session:stats-batch (real stats from JSONL files)
      → Backend: SessionRpcHandlers reads JSONL via SessionHistoryReaderService
      → Concurrent processing (5 at a time via Promise.allSettled)
      → Also reads CliSessionReference from SessionMetadata for CLI agent info
    → Merge metadata + stats into DashboardSessionEntry[]
    → Signal-based UI updates
```

### Key Files

**Backend:**

- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts` — `session:stats-batch` handler
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` — `readSessionHistory()` + `aggregateUsageStats()` (merges parent + agent sessions)
- `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts` — JSONL file I/O, `loadAgentSessions()`
- `libs/backend/agent-sdk/src/lib/helpers/history/history.types.ts` — `JsonlMessageLine`, `SessionHistoryMessage` (both now have `model` field)
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` — `SessionMetadata`, `getForWorkspace()` (filters child sessions)

**Shared Types:**

- `libs/shared/src/lib/types/rpc/rpc-session.types.ts` — `SessionStatsEntry`, `SessionStatsBatchParams`, `SessionStatsBatchResult`
- `libs/shared/src/lib/utils/pricing.utils.ts` — `calculateMessageCost()`, `formatModelDisplayName()`

**Frontend:**

- `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts` — v2 state service with `ClaudeRpcService` calls
- `libs/frontend/dashboard/src/lib/components/session-analytics/session-stats-card.component.ts` — per-session card
- `libs/frontend/dashboard/src/lib/components/session-analytics/session-analytics-dashboard-view.component.ts` — main view with card grid
- `libs/frontend/dashboard/src/lib/components/session-analytics/metrics-cards.component.ts` — aggregate summary (4 cards)
- `libs/frontend/dashboard/src/lib/utils/format.utils.ts` — `formatCost()`, `formatTokenCount()` with NaN guards
- `libs/frontend/core/src/lib/tokens/session-data.token.ts` — `ISessionDataProvider` (still exists but dashboard no longer uses it)
- `libs/frontend/core/src/lib/services/app-state.service.ts` — now reads `workspaceRoot` from `ptahConfig` during init

**Navigation:**

- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` — `@case ('analytics')` renders dashboard
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` — imports dashboard, BarChart3 icon button
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` — BarChart3 icon button for Electron
- `apps/ptah-extension-vscode/src/core/ptah-extension.ts` — `ptah.openDashboard` command
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` — `createPanel({ initialView: 'analytics' })`
- `apps/ptah-extension-vscode/package.json` — command in `contributes.commands` + `activationEvents`

## What Each Card Shows

```
┌─ "Session Name" ──────────── [Sonnet 4] ─┐
│  Mar 19, 2026, 5:29 PM                     │
│  ┌──────────┐ ┌──────────┐                 │
│  │ COST     │ │ MESSAGES │                 │
│  │ $15.69   │ │ 111      │                 │
│  ├──────────┤ ├──────────┤                 │
│  │ INPUT    │ │ OUTPUT   │                 │
│  │ 10.7K    │ │ 90.5K    │                 │
│  └──────────┘ └──────────┘                 │
│  [gemini] [copilot]  3 subagents           │
│  Cache Read: 15.7M  Cache Write: 2.6M     │
└────────────────────────────────────────────┘
```

- **Model badge** (purple): from JSONL system init message `model` field
- **Cost** (green/success): model-aware pricing via `calculateMessageCost()`
- **Messages** (blue/info): count of assistant messages
- **Input/Output tokens** (cyan/purple): from JSONL usage data, includes agent sessions
- **CLI agent badges** (blue): from `SessionMetadata.cliSessions[]` — gemini, codex, copilot, ptah-cli
- **Subagent count**: from `agent-*.jsonl` file count
- **Cache stats**: conditional, hidden when zero

## Circular Dependency Resolution

`dashboard → chat` was broken by introducing `SESSION_DATA_PROVIDER` injection token in `@ptah-extension/core`. However, the v2 dashboard no longer uses it — it calls `ClaudeRpcService` directly. The token still exists for backward compatibility.

## Known Issues / Remaining Work

### Issues

1. **Session names show raw XML** — e.g., `<command-message>ptah-core:orchestrate</...` — these are sessions where the first message was an orchestration command. Would need name sanitization.
2. **`addStats()` is never called** — `SessionMetadataStore.addStats()` exists but is never wired into the streaming pipeline. Stats in metadata are always 0. The dashboard bypasses this by reading JSONL directly.
3. **No real-time updates** — Dashboard shows stale data until user navigates away and back (which triggers `ngOnInit` → `loadDashboardData()` again).
4. **Hard-coded limit of 30** — `session:list` fetches 30 sessions max. Users with 50+ sessions won't see all.

### Enhancement Ideas

1. **Per-model cost comparison** — Group sessions by model, show cost/token breakdown per model
2. **Time-series charts** — Chart.js line charts for cost over time, token trends
3. **CSV/JSON export** — Export session stats for external analysis
4. **Session drill-down** — Click a card to see per-message cost breakdown (use `subagent-cost.utils.ts`)
5. **Fix `addStats` pipeline** — Wire `onResultStats` callback to persist to metadata, so future dashboard loads are faster
6. **Refresh button** — Explicit refresh without navigating away
7. **Loading progress** — Show "Reading 5/30 sessions..." during batch load

## Design System Reference

All cards follow the Ptah design system from `session-stats-summary.component.ts`:

- Cards: `bg-base-200/50 rounded-lg p-3 border border-{color}/20`
- Labels: `text-[10px] uppercase tracking-wider text-base-content/50`
- Values: `text-sm font-semibold tabular-nums`
- Colors: success (cost), cyan (input), purple (output/model), info (messages/agents)

## Testing

```bash
# Typecheck all affected
npx nx typecheck shared
npx nx typecheck agent-sdk
npx nx typecheck rpc-handlers
npx nx typecheck core
npx nx typecheck dashboard
npx nx typecheck chat
npx nx typecheck ptah-extension-vscode

# Run extension
npm run watch  # then F5 in VS Code
# Open command palette → "Ptah: Open Session Analytics Dashboard"
# Or click the BarChart3 icon in the chat header
```
