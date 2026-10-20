# PR 2 backend fix round 1

## Review items

1. **FIXED** — `libs/backend/usage-analytics/src/lib/sources/codex.source.ts:64` keys by session ID and event-content digest; `grok.source.ts:61` keys by session directory ID, prompt ID, and model. Tests: `keeps a stable event key when a session is copied to another rollout file`; `uses the session and prompt when copied workspace files have different paths`.
2. **FIXED (verified disjoint input)** — `opencode.source.ts:50` retains `tokens.input` as uncached and reads `tokens.cache.read` separately. Test: `reads assistant messages with provider costs and workspace filter` asserts 12 uncached plus 8 cached. See OpenCode evidence below.
3. **FIXED** — `usage-summary.service.ts:40-86` returns completed sources and marks the interrupted source `partial` with `time-budget`; later sources are `unavailable` with the same reason. `session-stats-reader.service.ts:125-170` accepts 10,000-file and 100,000-record bounds, used by `claude-ledger.source.ts:15`; a limit yields `partial`. Test: `returns finished sources and a time-budget partial status on abort`; agent SDK `session-stats-reader.service.spec.ts` passes.
4. **FIXED** — `libs/backend/usage-analytics/project.json:22` externalizes `better-sqlite3`. `opencode.source.ts:30,56-57` already loads it lazily inside a catch and reports `unavailable` on failure. Test: `reports missing database`; OpenCode source spec passes.
5. **FIXED** — `expected-resolvable.ts` in Electron, VS Code, and CLI lists `AnalyticsRpcHandlers` (lines 15, 12, 10). Each `container.smoke.spec.ts` registers the analytics service and resolves its token (lines 266, 225, 227). Tests: `resolves AnalyticsRpcHandlers` and `resolves the usage analytics service token` in each host smoke suite. The existing RPC surface suites derive the method list from the manifest.
6. **FIXED** — `file-facts.ts:56` excludes unknown roots under a workspace filter; Grok marks undecodable workspace roots partial before filtering (`grok.source.ts:26-27`). Test: OpenCode `reads assistant messages with provider costs and workspace filter` includes a null-directory row and asserts it is excluded with partial status.
7. **FIXED** — `grok.source.ts:37` counts unreadable update logs and marks partial. Covered by the Grok source suite for malformed logs; an unreadable-file-specific fixture remains absent.
8. **DEFERRED** — no file-identity-based summary memo, persisted daily rollup, or measured 90-day fixture was added. A TTL-only summary would serve stale facts after file changes; implementing an identity-keyed memo and benchmark exceeds this fix-round budget. The Claude scan now has hard caps (item 3), but the warm latency target remains unproven.
9. **FIXED** — `rpc-analytics.types.ts:23` adds finite nonnegative nullable `cacheSavingsUsd`; `usage-pricing.service.ts:22-37` computes it from cache reads and input/read rates for priced models, including provider-reported costs, and returns null for unknown pricing. `usage-summary.service.ts:68` aggregates it. Tests: `computes cache savings for priced reported usage`; `rejects inconsistent unknown costs and unsafe counters`.
10. **DEFERRED** — OpenCode's positive local estimate remains `provider-reported` under the review brief's accepted provenance rule. The implementation plan calls it `model-priced`; changing that label requires settling the contract meaning across clients.
11. **PARTIAL** — `usage-pricing.service.ts:19` now passes the qualified model ID to the bundled lookup. The bundled lookup itself strips provider prefixes, so cross-vendor same-ID collision prevention remains unproven; deferred to pricing-catalog work.
12. **FIXED** — `usage-summary.service.ts:70-76` stops before a 100,001st group and marks the offending source partial with `fact-limit`, preserving a consistent bounded summary. No dedicated overflow fixture was added.
13. **DEFERRED** — legacy Claude ledger rows without a message ID still use their ledger location as a fallback identity. Changing historical dedup requires a stable legacy content identity and a fixture from those records.
14. **FIXED** — `codex.source.ts:51,60` counts schema-invalid payloads and token usage as malformed. Existing Codex source spec checks malformed status; a schema-specific fixture remains absent.
15. **FIXED** — `opencode.source.ts:57` names database, native driver, and possible WAL metadata failure in its unavailable reason. The module stays lazy.
16. **FIXED** — `opencode.source.ts:53` evicts one oldest cache entry rather than clearing the entire cache. No eviction fixture was added.
17. **DEFERRED** — `pricing.asOf` remains generation time. Catalog version/as-of metadata is not exposed by the current pricing lookup contract; changing it needs upstream pricing metadata.
18. **FIXED** — `usage-summary.service.ts:86` records the actual failing source ID instead of `unknown`. The timeout regression test also asserts named source statuses.
19. **DEFERRED** — Ollama Cloud and Antigravity sources remain unavailable. Building an authenticated Ollama usage API source is outside this repair round and requires an API contract and credential boundary.

## OpenCode evidence

OpenCode `dev` source [`session.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/session.ts) computes `adjustedInputTokens = max(0, inputTokens - cacheReadInputTokens - cacheWriteInputTokens)` in `getUsage()` and stores that as `tokens.input`, with cache read/write in separate fields. Its [`processor.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts) assigns `usage.tokens` to the assistant message persisted to the session. Thus current stored `tokens.input` is disjoint from cache reads. The local read-only `~/.local/share/opencode/opencode.db` probe found no assistant rows with positive `tokens.cache.read`, so it could not independently validate a cached local row. Historical OpenCode v1.3.4/1.3.5 had an [AI SDK v6 double-counting issue](https://github.com/anomalyco/opencode/issues/19757); importing those old rows may still overcount, and version detection is not available in the database row schema. `time.created` is used in epoch milliseconds by the local schema and fixture, but no positive local row was inspected.

## Final UsageFact contract

```ts
type UsageFact = {
  day: string;
  providerId: string;
  modelId: string;
  inputUncachedTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number | null;
  cacheSavingsUsd: number | null;
  costSource: 'provider-reported' | 'model-priced' | 'unpriced';
  requestCount?: number;
  sourceId: string;
};
```

The Zod schema requires token counts to be safe nonnegative integers and both money fields to be finite nonnegative numbers or null. Unknown cache savings is null, never a fabricated zero.

## Verification tails

- Usage analytics changed specs: `Test Suites: 5 passed, 5 total`; `Tests: 14 passed, 14 total`. Follow-up OpenCode and pricing specs after the final edits: `2 passed`; `6 passed`.
- Shared contract spec: `Test Suites: 1 passed`; `Tests: 2 passed`.
- Agent SDK session-stats reader spec: `Test Suites: 1 passed`; `Tests: 17 passed`.
- Electron DI smoke: `Test Suites: 1 passed`; `Tests: 31 passed`.
- VS Code DI smoke: `Test Suites: 1 passed`; `Tests: 46 passed`.
- CLI DI smoke: `Test Suites: 1 passed`; `Tests: 21 passed`.
- `NX_NO_CLOUD=true npx nx typecheck usage-analytics --parallel=1`: `Successfully ran target typecheck for project @ptah-extension/usage-analytics`.
- `NX_NO_CLOUD=true npx nx typecheck rpc-handlers --parallel=1`: `Successfully ran target typecheck for project @ptah-extension/rpc-handlers`.
- Scoped `ptah_get_diagnostics` twice returned unavailable after its 45-second timeout; it did not report a clean result. The requested typecheck targets above passed. Those typechecks preceded the final workspace-filter and pricing tweaks; the changed specs passed afterward.

## Decisions

- **OpenCode input:** retain stored `tokens.input` as uncached, based on current OpenCode `getUsage()` source and processor assignment; subtracting cache a second time would undercount. Options: subtract again or keep the stored split. Reversible: yes, with version-aware normalization.
- **Timeout:** return accumulated summary with named partial/unavailable source statuses. Options: reject the RPC or degrade. Evidence: the review requires partial data on budget expiry. Reversible: yes.
- **Unknown workspace:** exclude facts lacking a root from a workspace-filtered request and flag partial. Options: include in totals, separate source, or exclude. Evidence: including them attributes unrelated spend to the selected workspace. Reversible: yes.
- **Cache savings:** calculate against rate-card input/read prices even when spend is provider-reported; null when rates are unavailable. Options: assume zero or use card when known. Reversible: yes.
