# TASK_2025_206 v2: Dashboard Redesign — Per-Session Stats Cards

## User Vision

Replace the flat table dashboard (which shows all zeros) with rich per-session stats cards for the last 5-10 sessions. Each card shows model, cost, tokens, message count, duration, and CLI agent/subagent info — all calculated from JSONL files.

## Why v1 Failed

1. `SessionMetadata.addStats()` is NEVER CALLED — stats pipeline sends to webview but never persists
2. `session:list` returns metadata with hardcoded `messageCount: 0` and empty `tokenUsage`
3. Flat table of 30 sessions with `--` everywhere is not useful

## What Works Already

- `SessionHistoryReaderService.readSessionHistory(sessionId, workspacePath)` reads JSONL files and returns:
  - `stats.totalCost` (model-aware pricing)
  - `stats.tokens` { input, output, cacheRead, cacheCreation }
  - `stats.messageCount`
  - `stats.model` (detected from init message)
- `aggregateUsageStats()` merges parent + agent sessions into unified stats
- `SDK_TOKENS.SDK_SESSION_HISTORY_READER` is injectable
- `JsonlReaderService` resolves workspace path → JSONL directory

## New Architecture

### Backend

- New RPC method `session:stats-batch` that takes N session IDs + workspacePath
- For each session, calls `readSessionHistory()` to get full stats
- Returns per-session stats array: { sessionId, model, cost, tokens, messageCount, duration, agentCount }
- Also fix `addStats()` pipeline so future sessions accumulate stats in metadata

### Frontend

- Replace flat table with card-based per-session layout
- Show last 5 sessions by default, "Show More" for next 5
- Each card: session name, model badge, date, cost, token breakdown, message count, agent info
- Aggregate summary at top (total cost, total tokens across displayed sessions)
- Design matches Ptah design system (color-coded borders, uppercase labels, semantic colors)

## Key Files

### Backend (to read/modify)

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts` — readSessionHistory()
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-metadata-store.ts` — addStats() (never called)
- `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts` — session:list handler
- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` — RPC type definitions
- `D:\projects\ptah-extension\libs\shared\src\lib\utils\pricing.utils.ts` — pricing calculations

### Frontend (to modify)

- `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\services\session-analytics-state.service.ts`
- `D:\projects\ptah-extension\libs\frontend\dashboard\src\lib\components\session-analytics\*.ts` — all dashboard components
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\tokens\session-data.token.ts` — ISessionDataProvider interface

### Key Injection Tokens

- `SDK_TOKENS.SDK_SESSION_HISTORY_READER` — SessionHistoryReaderService
- `SDK_TOKENS.SDK_SESSION_METADATA_STORE` — SessionMetadataStore
- `SESSION_DATA_PROVIDER` — frontend session data access
