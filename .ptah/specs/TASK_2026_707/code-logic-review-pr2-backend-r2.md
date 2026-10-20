# Code logic review round 2 — TASK_2026_707 PR 2 backend fixes

Review family: ptah-cli (Ollama Cloud). Implementer family: codex. Scope: the fix round for the 5 major and 4 moderate defects in `code-logic-review-pr2-backend.md`, the new `cacheSavingsUsd` contract, and regressions. `libs/frontend/**` is out of scope (another lane edits it).

## Verdict

**APPROVE WITH FIXES — score 8/10**

Tally: 0 blocking, 0 major, 2 minor new defects, 5 minor residuals. All five majors are fixed with code, tests, or verified external evidence. Three of four moderates are fixed; the fourth (summary memoization) is deferred and I judge the deferral acceptable because the new hard caps bound the worst case and the budget timeout now degrades to an honest partial instead of a hard failure. The two new minors are a status-completeness gap on the fact-limit overflow path and a duplicated source-id literal. What separates 8 from 9: the fact-limit overflow drops later sources from `sources` entirely, and the bundled pricing lookup still resolves a qualified id back to any vendor's bare id (item 11, honestly deferred).

## Checks run

- `npx jest -c libs/backend/usage-analytics/jest.config.ts --coverage=false --maxWorkers=1` → 5 suites, 14 tests, all passed (independent rerun).
- `npx jest -c apps/ptah-electron/jest.config.ts src/di/container.smoke.spec.ts --coverage=false --maxWorkers=1` → 31 tests passed (the two new analytics assertions included).
- Read in full: `codex.source.ts`, `grok.source.ts`, `opencode.source.ts`, `claude-ledger.source.ts`, `file-facts.ts`, `usage-summary.service.ts`, `usage-pricing.service.ts`, `usage-source.types.ts`, `rpc-analytics.types.ts`, `analytics-rpc.handlers.ts`, `usage-analytics/project.json`; the `scanDatedUsage` section of `session-stats-reader.service.ts` (lines 110-189); `lookupPricingEntry` in `pricing.utils.ts` (lines 323-353); the guard additions in all three hosts.
- Not run: the VS Code and CLI smoke suites and the agent-sdk reader spec (one-heavy-check rule; the Electron guard spec was run as the representative, and the fix report's tails for the others are consistent with the code I read).

## Per-item status

### Majors

1. **Stable Codex/Grok dedup identity — FIXED.** Codex keys a fact `${sessionId}:${eventId}` where `sessionId` comes from `session_meta.id` and `eventId` is a sha256 of `[timestamp, model, usage]` (`codex.source.ts:63-64`) — the file path is gone from the key, so a copied or resumed rollout collapses. Grok keys `${sessionDir}:${prompt_id}:${model}` (`grok.source.ts:61`) — the workspace path is gone, so copied workspace files with different paths collapse. Tests exist and pass in the suite I ran: `keeps a stable event key when a session is copied to another rollout file` (`codex.source.spec.ts:39`), `uses the session and prompt when copied workspace files have different paths` (`grok.source.spec.ts:27`).

   Residuals (minor, not blocking):
   - A rollout with no parseable `session_meta.id` falls back to `path.basename(file)` (`codex.source.ts:64`), so a copy of such a file still double counts. `session_meta` is the first line of every known rollout, so the edge is narrow.
   - Two `token_count` events in one session with an identical timestamp, model, and usage quadruple hash to the same `eventId` and collapse (undercount). Rare in real streams.

2. **OpenCode input normalization — FIXED (verified disjoint, evidence cited).** `opencode.source.ts:50` keeps stored `tokens.input` as the uncached count and reads `tokens.cache.read` separately. The fix report cites the OpenCode source: `getUsage()` stores `input − cacheRead − cacheWrite` as `tokens.input`, with cache in separate fields, so subtracting again would undercount. I could not re-fetch the upstream link (web search is outside this role's tools), so I accept the implementer's citation; the fixture asserts 12 uncached plus 8 cached (`opencode.source.spec.ts:18`, passing), which pins the disjoint reading. The two CLI sources now agree by design instead of contradicting.

   Residual (minor): OpenCode v1.3.4/v1.3.5 rows written under the cited AI SDK v6 double-count issue can still overcount, and the row schema carries no version to detect it. Document the caveat; not fixable in this layer. `time.created` in seconds instead of ms also stays silently out of range rather than miscounted (`opencode.source.ts:9`).

3. **Time-budget partial + Claude scan caps — FIXED.** `usage-summary.service.ts` now degrades instead of throwing: pre-source abort pushes `partial`/`time-budget` for the current source and `unavailable`/`time-budget` for the rest (`:41-45`), a mid-source abort breaks the contribution loop and marks the source `partial`/`time-budget` while keeping its own counts (`:50`, `:74`), and the per-source catch checks `signal.aborted` before mapping a failure (`:79-84`). `claude-ledger.source.ts:15` passes `maxFiles: 10_000, maxRecords: 100_000` to `scanDatedUsage`, enforced at `session-stats-reader.service.ts:143,158,169` with a `limit` yield that becomes a `partial`/`scan-limit` status (`claude-ledger.source.ts:16,34-35`). Test `returns finished sources and a time-budget partial status on abort` (`usage-summary.service.spec.ts:28`) passes. The handler's `PERSISTENCE_UNAVAILABLE` mapping (`analytics-rpc.handlers.ts:94-102`) now only fires on real failures.

   Note: Codex, Grok, and OpenCode take only three `read` parameters (`codex.source.ts:17`, `grok.source.ts:18`, `opencode.source.ts:19`) and ignore the optional `signal` (`usage-source.types.ts:25`), so an in-flight CLI scan cannot be interrupted — degradation happens after it returns, bounded by the 10,000-file and 100,000-row caps. Acceptable; worth knowing when the budget fires.

4. **`better-sqlite3` build externals — FIXED.** `usage-analytics/project.json:22` lists `better-sqlite3` in `external`, matching the cron-scheduler pattern. The module is still lazy-required inside the try (`opencode.source.ts:30`), and a load or open failure returns `unavailable` with a reason that names the driver and possible WAL metadata (`opencode.source.ts:56-57`). Test `reports missing database` passes in the suite I ran.

5. **DI guards — FIXED.** `AnalyticsRpcHandlers` is in `EXPECTED_RESOLVABLE` for Electron (`expected-resolvable.ts:15`), VS Code (`:12`), and CLI (`:10`), so each `it.each` smoke assertion resolves the handler class. Each `container.smoke.spec.ts` calls `registerUsageAnalytics(c)` and resolves `USAGE_ANALYTICS_TOKENS.USAGE_ANALYTICS_SERVICE` (Electron `:254,267`, VS Code `:213,226`, CLI `:215,228`). I ran the Electron smoke spec: 31 tests pass. The smoke spec builds its own minimal container, so it proves the registration function resolves, not that the production root calls it — that is the same convention every other handler in the list follows, and the production wiring was verified in round 1.

### Moderates

6. **Unknown-workspace exclusion — FIXED.** `workspaceMatches` returns `false` when the recorded root is missing and a filter is active (`file-facts.ts:54-56`), and each CLI source flags the case partial: Codex `codex.source.ts:34`, Grok `grok.source.ts:26` (plus the undecodable-name flag at `:25`), OpenCode `opencode.source.ts:45`. The workspace-filter test with a null-directory row passes. Another workspace's spend no longer enters the displayed workspace.

7. **Unreadable Grok files — FIXED.** The per-session catch now sets `partial` and increments `malformed` (`grok.source.ts:37`). No unreadable-file-specific fixture exists, but the malformed-logs fixture covers the same counter path and passes.

8. **Summary memoization / persisted rollup / benchmark — DEFERRED; acceptable for this PR.** Judgment: the original defect had two parts. The dangerous part — an unbounded Claude scan meeting a hard RPC failure — is now impossible: the scan is capped (`claude-ledger.source.ts:15`), and a budget overrun yields a named partial summary (`usage-summary.service.ts:41-45`) instead of `PERSISTENCE_UNAVAILABLE`. What remains is cost, not correctness: every request still re-prices and re-groups each in-range contribution (per-file caches skip only re-parsing), and the plan's warm ≤2 s / cold ≤10 s measurement and persisted daily rollup are unmet. The OpenCode cache key now also includes WAL size and mtime (`opencode.source.ts:24`), which closes the stale-after-append concern for that source. Defer, but keep the rollup and the measured fixture scheduled before warm performance is called done.

9. **`cacheSavingsUsd` — FIXED as recommended.** `rpc-analytics.types.ts:23` declares `cacheSavingsUsd: usd.nullable()` (finite nonnegative or null), additive on `UsageFact`. `usage-pricing.service.ts:22-25` computes `cacheReadTokens × (inputCostPerToken − cacheReadCostPerToken)` clamped at 0, returns a legitimate 0 only when cache reads are 0 and the input rate is known, and returns `null` when either rate or the whole card is missing. The unpriced branch returns null savings with null cost (`:33-35`), and the model-priced branch keeps savings null whenever cost is null (`:36-37`) — unknown is never a fabricated 0. `usage-summary.service.ts:68` sums it per group exactly like `costUsd`. Because the group key contains model and costSource (`:58`), every contribution in one group shares one pricing lookup, so savings nullness cannot mix inside a group. Test `computes cache savings for priced reported usage` (`usage-pricing.service.spec.ts:30`) passes.

   Note: for `provider-reported` facts the savings uses card rates while the spend is the provider's number — an estimate, disclosed as a decision in the fix report. Defensible; the frontend should label it an estimate.

### Minors from round 1

10. **OpenCode `cost > 0` stays `provider-reported` — DEFERRED by orchestrator decision; accepted.** Per the re-review instruction I checked only for double counting: there is none. The pricing service takes exactly one branch (`usage-pricing.service.ts:26-28` reported vs `:29-37` card), so a reported cost is never summed with a card price. The label means "the number came from the source", which OpenCode's own estimate satisfies. Record the settled meaning in the contract docs; no code change.

11. **Qualified bundled lookup — NOT FIXED (deferred), minor stands.** `usage-pricing.service.ts:15,19` now passes the qualified id to both lookups, but `lookupPricingEntry` tries `stripProviderPrefix(lowerId)` as a candidate (`pricing.utils.ts:332-337`), so `codex/gpt-5` resolves back to any vendor's bare `gpt-5` card — behaviourally identical to round 1. The fix report labels this PARTIAL and defers it to pricing-catalog work, which is honest. Impact stays small (cross-vendor bare-id collisions are rare, and for Codex/Grok the intended card is plausibly the same bare id). Keep the round-1 recommendation: map `codex → openai`, `grok → xai` before both lookups.

12. **`MAX_FACTS` overflow — FIXED, with one new residual (defect N1 below).** The loop stops before the 100,001st group and marks the offending source `partial`/`fact-limit` (`usage-summary.service.ts:71,74`); state is now consistent. See N1 for the status gap.

13. **Legacy Claude rows without a message id — DEFERRED; acceptable.** The fallback key stays `${sessionId}:${ledgerName}:${i}` (`session-stats-reader.service.ts:179`). A correct fix needs a real legacy fixture to derive a content identity; older transcripts only; the effect is a possible duplicate of a null-id record across parent and member ledgers. Not blocking.

14. **Codex schema failures counted — FIXED.** `codex.source.ts:51` (payload), `:60` (usage), `:62` (timestamp and cached>input) all increment `malformed`. No schema-specific fixture, but the malformed-status assertions cover the counter.

15. **WAL-named unavailable reason — FIXED.** `opencode.source.ts:57`: "OpenCode database or native SQLite driver could not be read (possibly WAL metadata)".

16. **OpenCode cache eviction — FIXED.** `opencode.source.ts:53` deletes the oldest-inserted entry (Map iteration order) instead of clearing; the new result is then stored. Bounded and correct for a 12-entry cache.

17. **`pricing.asOf` — DEFERRED; acceptable.** Generation time remains (`usage-summary.service.ts:95`). Cosmetic metadata; needs upstream catalog versioning.

18. **Named source in failure status — FIXED.** The per-source catch pushes the named id from the loop (`usage-summary.service.ts:40,86`) instead of `'unknown'`; the time-budget regression test asserts named statuses. The `logger.warn` at `:85` still omits the source id — the status now carries it, which is what the frontend needs, so this is a nit only.

19. **Ollama Cloud / Antigravity sources — DEFERRED; acceptable.** Both stay honest `unavailable` statuses, so the dashboard does not imply zero usage. The plan's Ollama `/api/usage` source (7/30-day windows, top-ten split) remains unmet and must stay scheduled; it needs an API contract and credential boundary outside this PR.

## New defects this round

- **N1 (minor) — fact-limit overflow drops later sources from `sources` entirely.** On the overflow path the loop breaks without pushing statuses for the sources after the offending one (`usage-summary.service.ts:75-78` — the `unavailable` fill loop runs only `if (signal?.aborted)`, never for `overflow`). A user whose Codex scan trips the 100,000-group limit sees `codex: partial/fact-limit` and no row at all for grok, antigravity, or ollama-cloud, so the panel cannot say whether they were scanned. Fix: push `{ status: 'unavailable', reason: 'fact-limit' }` for the remaining sources on the overflow path, mirroring the time-budget fill. Also, the triggering contribution is added to `seen` (`:54`) before the overflow check (`:71`) — harmless today because the scan stops entirely, but move the check above the `seen.add` if you touch the loop.
- **N2 (minor) — the source-id literal is duplicated four times.** The same six-element array is written inline at `usage-summary.service.ts:40`, `:43`, `:76`, `:82`. `this.sources` (`:25`) and the literals must stay in sync by hand; adding a seventh source without editing all four mislabels every later status silently. Fix: derive one `const SOURCE_IDS` next to the constructor list and index it.

## Residual risks accepted

- Codex/Grok/OpenCode scans are not abort-aware mid-scan (see item 3); bounds make this acceptable.
- OpenCode historical v1.3.4/v1.3.5 rows can overcount with no version signal (item 2).
- Codex digest collisions and missing-`session_meta` fallback (item 1).
- Per-request re-pricing cost without a persisted rollup (item 8) — schedule the rollup and the measured 90-day fixture.

Review family: ptah-cli (Ollama Cloud); implementer family: codex