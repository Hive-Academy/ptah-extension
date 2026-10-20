# PR 2 backend batch A2 report

## Files changed

- `libs/backend/usage-analytics/src/lib/sources/claude-ledger.source.ts` (moved from `src/lib/claude-ledger.source.ts`)
- `libs/backend/usage-analytics/src/lib/sources/file-facts.ts`
- `libs/backend/usage-analytics/src/lib/sources/codex.source.ts` and `.spec.ts`
- `libs/backend/usage-analytics/src/lib/sources/opencode.source.ts` and `.spec.ts`
- `libs/backend/usage-analytics/src/lib/sources/grok.source.ts` and `.spec.ts`
- `libs/backend/usage-analytics/src/lib/usage-source.types.ts`
- `libs/backend/usage-analytics/src/lib/usage-summary.service.ts` and `.spec.ts`
- `libs/backend/usage-analytics/src/lib/usage-pricing.service.ts`
- `libs/backend/usage-analytics/src/lib/cli-session.source.ts`
- `libs/backend/usage-analytics/src/lib/di/registration.ts`
- `libs/backend/usage-analytics/src/index.ts`
- Removed `libs/backend/usage-analytics/src/lib/usage-rollup-cache.ts`.

## Per-source status and evidence

- **Claude:** the existing `scanDatedUsage` ledger remains the source. Narrowing `entry.kind === 'usage'` before accessing `entry.record` fixes TS2339. Its existing agent SDK ledger cache uses transcript file identity; no source schema was changed.
- **Codex:** reads `CODEX_HOME` or `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` only for requested UTC day folders. Each `event_msg` `token_count` contributes `last_token_usage`, with cached tokens subtracted from input. File/line is the dedup key. `session_meta` and `turn_context` supply cwd and model. A missing store returns unavailable; missing cwd under a workspace filter makes status partial. Fixture covers range, UTC boundary, cache split, malformed line, and append invalidation.
- **OpenCode:** reads `XDG_DATA_HOME/opencode/opencode.db` or `~/.local/share/opencode/opencode.db` through a read-only `better-sqlite3` connection. SQL filters assistant JSON rows by `time.created`, joins session directory for workspace filtering, and caps results at 100,000. The message id is the dedup key. Positive message `cost` is provider reported; zero cost proceeds to model pricing. Invalid JSON in the range is counted. The native module loaded on this machine; fixture uses a real temporary SQLite database.
- **Grok:** reads `GROK_HOME` or `~/.grok/sessions/<encoded-cwd>/<session-id>/updates.jsonl`. `turn_completed` modelUsage entries supply dated per-model tokens and `costUsdTicks`. Session file, prompt id, and model form the dedup key. Missing timestamps fall back to file mtime and mark status partial. A missing store returns unavailable. Fixture covers ticks, cache split, range, duplicate key, and malformed line.
- **Antigravity and Ollama Cloud:** explicitly unavailable because neither has a dated local per-model token history in this batch.

All sources return malformed counts or partial/unavailable status instead of propagating file errors. The summary deduplicates and groups by UTC day, provider, model, source, and cost source. The service fixture verifies duplicate suppression, grouping, partial status, and null unpriced cost.

## Tick unit decision

xAI documents **10,000,000,000 ticks per USD** in its [cost tracking documentation](https://docs.x.ai/developers/cost-tracking). Grok model `costUsdTicks` is divided by this value; 2,000,000,000 ticks becomes $0.20 in the fixture. Model entries without ticks fall through to model pricing or unpriced status.

## Cache design and warm time

The 30-second whole-summary snapshot was removed. JSONL projections are cached in memory under path, size, and `mtimeMs`; changed files are reparsed. The OpenCode result cache uses database and WAL sizes and `mtimeMs`, plus range and workspace. JSONL reads are capped at 64 MiB per file and 1 MiB per line; source scans cap at 10,000 successfully read files, OpenCode at 100,000 rows. The file cache holds up to 4,000 entries and 100,000 facts. An optional disk warm start was not implemented.

Expected 90-day warm behavior: unchanged cached JSONL files incur directory enumeration and metadata checks, with no JSON parsing; OpenCode incurs two metadata checks and a map lookup. No wall-clock 90-day benchmark was run, so no measured latency is claimed. Files evicted by the memory bound are reparsed. Claude retains the agent SDK's own file identity cache, but its ledger scan still enumerates transcript records.

## Verification

- `ptah_get_diagnostics` scoped to changed files: 0 errors, clean coverage.
- `npx jest -c libs/backend/usage-analytics/jest.config.ts --coverage=false --maxWorkers=1`: **5 suites passed, 10 tests passed**. Tail: `Test Suites: 5 passed, 5 total` / `Tests: 10 passed, 10 total`.
- `NX_NO_CLOUD=true npx nx typecheck usage-analytics --parallel=1`: **passed**. Tail: `Successfully ran target typecheck for project @ptah-extension/usage-analytics`.

## Decisions

- Use read-only `better-sqlite3` for OpenCode rather than the Ptah persistence service. The latter owns Ptah's database connection, while OpenCode's database is a separate external store. The workspace already depends on the native module, and a real fixture loaded it successfully. Reversible: yes.
- Prefer per-model Grok tick costs over turn totals to avoid double counting. Evidence: the observed `turn_completed` log carries both aggregate usage and `modelUsage` with per-model ticks; xAI documents the tick conversion. Reversible: yes.
- Keep bounded in-memory file projections and remove the short-lived summary snapshot. This makes source changes visible on the next request and avoids stale 30-second summaries. Reversible: yes.

## Clarifications Needed

None. A measured 90-day warm latency and a persistent per-file warm start remain follow-up performance work; the current cache is memory only.
