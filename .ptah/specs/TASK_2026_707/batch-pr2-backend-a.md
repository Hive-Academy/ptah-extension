# PR 2 backend batch A report

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/shared/src/lib/types/rpc/rpc-analytics.types.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/shared/src/lib/types/rpc/rpc-analytics.types.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/shared/src/lib/types/rpc.types.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/agent-sdk/src/lib/session-stats/index.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/agent-sdk/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/project.json
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/jest.config.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/tsconfig.json
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/tsconfig.lib.json
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/tsconfig.spec.json
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/src/lib/di/tokens.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/src/lib/di/registration.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/src/lib/usage-source.types.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/src/lib/claude-ledger.source.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/src/lib/cli-session.source.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/src/lib/usage-pricing.service.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/src/lib/usage-pricing.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/src/lib/usage-rollup-cache.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/libs/backend/usage-analytics/src/lib/usage-summary.service.ts
- D:/projects/ptah-extension/.claude-worktrees/analytics-dashboard/tsconfig.base.json

The shared public index already re-exports rpc.types.ts. The runtime RPC allowlist already contains analytics:.

## Final contract

```ts
type UsageRangeDays = 7 | 30 | 90;
type CostSource = 'provider-reported' | 'model-priced' | 'unpriced';
interface UsageSummaryParams { range: UsageRangeDays; workspace?: string }
interface UsageFact {
  day: string; providerId: string; modelId: string;
  inputUncachedTokens: number; cacheReadTokens: number;
  cacheWriteTokens: number; outputTokens: number;
  costUsd: number | null; costSource: CostSource;
  requestCount?: number; sourceId: string;
}
interface UsageSourceStatus {
  sourceId: string; status: 'complete' | 'partial' | 'unavailable';
  reason?: string; scannedFiles?: number; malformedRecords?: number;
}
interface UsageSummary {
  version: 1; generatedAt: string; timeZone: 'UTC';
  fromDay: string; untilDayExclusive: string;
  facts: UsageFact[]; sources: UsageSourceStatus[];
  pricing: { source: 'openrouter' | 'bundled' | 'unavailable'; asOf: string | null };
}
```

The implementation derives types from Zod schemas, with bounded IDs, UTC dates, safe token integers, finite nonnegative USD, and an invariant that unknown cost is null and unpriced.

## Coverage and cache

Claude transcript ledger: dated, uncapped scan; parent and owned subagent transcripts; message-id dedup and [since, until) filtering. Untimestamped or unreadable transcript data marks the source partial. Codex, OpenCode, Grok, and Antigravity: unavailable with explicit reason. Their public readers expose a last request or undated session/range totals, not dated per-model usage rows. No Ollama rows were added.

A host-neutral app-data path exists through IPlatformInfo.globalStoragePath. The new disk cache writes an atomic, validated summary snapshot keyed by workspace and range, with a 30-second lifetime and a 16 MB read bound. It is a short-lived rollup snapshot, not the plan's file-identity/offset daily rollup. It does not meet the planned append/truncate/rename invalidation or measured 90-day performance target. A changed transcript can remain unseen for up to 30 seconds. This gap must be closed before claiming complete warm-cache semantics.

## Test results

- Shared contract Jest spec: 2 passed.
- Usage pricing Jest spec: 3 passed.
- Agent SDK uncapped dated scan Jest test: 1 passed, 16 existing tests skipped by name filter.
- Scoped ptah_get_diagnostics was attempted twice; TypeScript compiler remained unavailable after its 45-second timeout. No typecheck result is claimed.
- No performance fixture was run. No aggregate-service fixture currently verifies grouping, partial-source propagation, or cache invalidation.

## Decisions

- Reused the existing analytics: RPC prefix. Evidence: vscode-core rpc-handler.ts allowlist. Reversible: yes.
- Exposed a public agent-sdk dated scanner and kept transcript internals inside agent-sdk. Evidence: session-stats-reader.service.ts and session-usage-ledger.ts. Reversible: yes.
- Emitted no invented CLI rows. Evidence: Grok and OpenCode readers expose aggregate local usage; Codex public reader exposes only the latest request input size. Reversible when dated public APIs exist.
- Used the existing platform app-data directory for a short-lived atomic summary cache. Evidence: platform-core IPlatformInfo.globalStoragePath. Reversible: yes; this is incomplete relative to the plan's daily rollup.

## Clarifications Needed

- No user-reserved decision blocks this batch. Remaining work is technical: implement file-identity daily rollups, dated CLI public adapters where possible, aggregate fixture tests, and obtain a successful scoped TypeScript diagnostic result.

