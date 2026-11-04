# SQL analytics / RPC lane handoff

## Produced

- Updated `libs/backend/usage-analytics/src/lib/usage-summary.service.ts` to use `SessionStatsRepository` grouped SQLite rows for Ptah facts, while retaining Codex, OpenCode, Grok, Antigravity, and Ollama Cloud adapters. It no longer scans Claude JSONL in the production path when the repository is injected.
- Preserved the existing `analytics:spendSummary` v1 request and output boundary. No shared contract change was needed for the grouped facts.
- Did not edit persistence, agent SDK, DI roots, tests, or the task report.

## Integration needed

- Requested exact query API from the parent: `getWorkspaceUsageSummary(workspaceKey, fromMs, untilMs)` returning SQL grouped facts, exact distinct counts and top five complete session DTO fields; `getSessionStatsBatch(workspaceKey, ids, scope)` returning only scope-correct entries and omitting missing/unsupported IDs for bounded JSONL fallback. The repository must register its class token in the session-store registration function. Range/workspace parameters remain bound in static SQL, and estimated rows must yield to live usage.
- Persistence registration must bind `SessionStatsRepository` as a class token with the instance created in `registerSessionStoreServices`. It currently creates and returns `stats` but does not register that token, so `UsageAnalyticsService` will not resolve in production until this is done.
- Current repository top-session rows omit title, provider, model, last-active time, cache tokens, and message count. Its grouped rows omit global distinct session/message counts. The analytics adapter marks the Ptah source `partial` when it has facts and does not fabricate Ptah ranking rows; global counts still reflect external sources only. Add complete SQL query results to finish those fields. The repository must also exclude `estimated` rows when live usage exists to avoid billed total inflation.
- `session:stats-batch` was not changed. Its default scope is post-compaction `current-context`; `getSessionStats(sessionId)` is a full-lifetime aggregate and cannot safely answer that scope or arbitrary ranges. Add a scope-aware repository query (workspace-scoped, per-turn time range and compaction awareness) before switching it to SQL-first. JSONL fallback can then be limited to IDs the query cannot cover. No JSONL backfill should be added.

## Verification

- Ran `npm run verify -- -p @ptah-extension/usage-analytics` once in the foreground. Nx failed before lint/test/typecheck: plugin process spawn returned `EPERM` under this sandbox.
- Called `ptah_get_diagnostics` after the final edit; it reported zero TypeScript errors and warnings with clean coverage. Earlier calls timed out while the compiler warmed up.
- On the latest instruction, no further verify or test command was run; the parent owns the single foreground scoped verification after integration. Tests have not run in this lane.

## Decisions

- Use the public `SessionStatsRepository` alias and shared `normalizeWorkspaceRoot` for the SQL path. Evidence: repository methods use normalized workspace key; shared key function is exported publicly. Reversible.
- Keep the existing `SessionUsageSink` port in `@ptah-extension/platform-core`; this lane defines no duplicate. The current source names its argument `SessionUsageContribution`. `usage-analytics` is tagged `type:feature` and `persistence-sqlite` is `type:util`, so the public persistence alias is the permitted dependency direction. Reversible.
- Preserve the existing v1 RPC contract and external adapters. Evidence: the dashboard already consumes v1 and non-Ptah sources have separate readers. Reversible.
