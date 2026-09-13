# Code Logic Review — `TASK_2026_411` (Batch B7)

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 6/10                                  |
| Assessment           | NEEDS_REVISION                        |
| Blocking issues      | 0                                     |
| Serious issues       | 1                                      |
| Moderate issues      | 3                                      |
| Failure modes found  | 4                                      |

Scope reviewed: every file listed in `b7-report.md` "Files changed for B7" except
`codex-translation-proxy.spec.ts` / `oauth-proxy.strategy.spec.ts` (1-line mock-contract
additions, confirmed via `git diff --stat`) and the B6-owned `translation/**` tree, which
was explicitly out of scope. Read in full: `codex-home-resolver.ts`(+spec),
`codex-account-usage.service.ts`(+spec), `codex-account.schemas.ts`,
`codex-account.generated.ts`, `codex-auth.service.ts` (eligibility path),
`codex-provider.types.ts`, `register-providers.ts`, `tokens.ts`,
`provider-rpc.handlers.ts`(+schema+shared types), `provider-account-state.service.ts`(+spec),
`provider-account-card.component.ts`, and the `analytics-card` diff.

## Five logic questions

### 1. How does this fail silently?

- `codex-account-usage.service.ts:74` — on any App Server failure, if a prior successful
  result is cached, the service returns `{ ...this.cached, status: 'stale' }` **silently
  re-using the previous `fetchedAt`** rather than surfacing when staleness began. A user who
  opens the dashboard days after a CLI upgrade broke `account/usage/read` sees a "stale"
  banner with numbers that look current, with no indication of how stale. This is
  intentional degrade-gracefully behaviour and is a Minor concern, not a defect, but the
  caveat is not in the report.
- `provider-account-state.service.ts:22-24` — on RPC failure (`response.isSuccess()` false),
  the service resets to `{ status: 'service-unavailable', providerId }`. That's correct and
  explicit, not silent.

### 2. What user action produces unexpected behaviour?

- Rapidly clicking "Refresh" (`provider-account-card.component.ts:16`) twice within the
  Angular service's single-flight window is safely no-op'd by
  `provider-account-state.service.ts:16` (`if (this._loading()) return;`). No bug there.
- Two concurrent RPC callers hitting `provider:getAccountUsage` at the same time (e.g. two
  webview panels/tabs both rendering the dashboard, or a webview refresh racing a CLI/host
  probe) each invoke the same DI **singleton** `CodexAccountUsageService`. See Serious issue
  below — this is the main unexpected-behaviour finding.

### 3. What input data produces a wrong answer?

- `codex-account.schemas.ts:51-59` validates `lifetimeTokens`, `peakDailyTokens`,
  `dailyUsageBuckets[].tokens` etc. as `z.number().int()`, while the generated protocol
  shapes in `codex-account.generated.ts:44-52` declare the same fields as `bigint`. The
  Codex App Server's Rust `u64` counters are large enough that a long-lived power account
  could exceed `Number.MAX_SAFE_INTEGER` (2^53). If the wire representation for a `bigint`
  field is a JSON number this literally cannot be represented exactly by `z.number()`, and
  parsing would silently round rather than throw (JS `JSON.parse` already loses precision
  on a >2^53 integer before Zod ever sees it) — the UI would then show a plausible but wrong
  `lifetimeTokens`. See Moderate issue below.

### 4. What happens when a dependency fails?

- CLI absent / spawn throws → `cli-unavailable`, tested (`codex-account-usage.service.spec.ts:120-124`).
- Version mismatch / method not found → `cli-version-unsupported`, tested (lines 111-118),
  and the raw `-32601` JSON-RPC error message is never surfaced to logs or the client
  (asserted at line 117 / 123).
- Silent process (no response) + abort → times out / aborts cleanly and closes the child
  (line 133-141), tested.
- **Two concurrent `getAccountUsage()` calls** → not tested, and the implementation is
  incorrect under this condition (Serious issue below).

### 5. What is missing that the requirements never mentioned?

- No generation/staleness token on the frontend `ProviderAccountStateService.load()`
  result write — see Moderate issue below. The requirements ask explicitly for "stale
  response after provider switch cannot write"; the implementation has no guard for it,
  it is only accidentally safe today because there is exactly one Codex-shaped provider id
  and the frontend serializes its own calls.
- No test exercises `CodexHomeResolver`'s `CODEX_HOME` env-var precedence or the
  `homedir()/.codex` default fallback — only the override path is covered
  (`codex-home-resolver.spec.ts`). Minor.

## Failure modes

### Concurrent App Server reads corrupt shared process-handle state

- Trigger: two overlapping calls to `CodexAccountUsageService.getAccountUsage({ refresh: true })`
  (or one call while a version-check/App Server process from a previous call is still
  in flight) reach the same singleton instance — plausible from two dashboard
  surfaces (multi-tab/canvas tiles), a manual refresh racing the auth-file-change
  cache invalidation refetch, or overlapping backend hosts.
- Symptom: one caller's `finally { await this.close(); }` (`codex-account-usage.service.ts:131-133`)
  kills the **other** caller's child process mid-request (because `close()` reads the shared
  `this.active` field, not the local `child` closure variable it was given), producing a
  spurious `service-unavailable` for that caller and leaking the first caller's own child
  process (never referenced by `this.active` again once overwritten, so never killed).
- Evidence: `codex-account-usage.service.ts:96` (`this.active = child` — shared field,
  overwritten by the second call before the first call's `finally` runs),
  `codex-account-usage.service.ts:80-91` (`close()` operates on `this.active`, never on the
  call-scoped `child`).
- Current handling: none — no per-request lock, queue, or coalescing; `close()` is the only
  place `this.active` is read.
- Recommendation: either (a) make `close()` take the specific `child` to close instead of
  reading `this.active`, or (b) single-flight `getAccountUsage` the same way
  `CodexAuthService.refreshInFlight` already does (`codex-auth.service.ts:95`) so this
  library's own established pattern is reused.

### Frontend account card has no staleness guard across a provider switch

- Trigger: `persistedProviderId()` changes while a `ProviderAccountStateService.load()`
  call is in flight (switch away from Codex and back before the pending promise settles is
  the narrowest form; a future second Codex-shaped provider id would broaden it).
- Symptom: `_result.set(response.data)` at `provider-account-state.service.ts:22-24`
  writes unconditionally — it never compares the `providerId` the request was issued for
  against the currently active one before committing.
- Evidence: `provider-account-state.service.ts:15-28`; no test covers this
  (`provider-account-state.service.spec.ts` only exercises a single synchronous-resolve
  call).
- Current handling: accidentally safe today only because (a) `_loading` fully serializes
  calls from one service instance and (b) there is exactly one Codex-recognized provider
  id, so a request issued "for Codex" is still valid Codex data even if the user briefly
  switched away and back.
- Recommendation: capture the requested `providerId` and compare it to
  `this.auth.persistedProviderId()` before `_result.set(...)`, discarding a stale response —
  this is what the review checklist explicitly asked to verify, and today's correctness is
  incidental rather than designed.

### Token-precision mismatch between generated types and runtime schema

- Trigger: any Codex account with `lifetimeTokens`/`peakDailyTokens` beyond 2^53 (a
  long-lived, high-volume subscription).
- Symptom: value silently rounds to the nearest representable double; the UI displays a
  plausible-looking but incorrect lifetime token count with no error.
- Evidence: `codex-account.generated.ts:44-52` (`bigint`) vs.
  `codex-account.schemas.ts:49-59` (`z.number().int()`).
- Current handling: none — no `z.coerce.bigint()`/string-based parsing to preserve
  precision.
- Recommendation: either confirm (and comment) that the wire format truly serializes as a
  JSON-safe integer range in practice, or validate/carry these fields as strings/bigint
  through to display.

### `assertVersion`'s own child process is untracked by `close()`

- Trigger: `close()` (public API, also called externally, e.g. via `ICodexAccountUsageService.close()`)
  is invoked by something other than `readFromAppServer`'s own `finally` while
  `assertVersion`'s `--version` child (`codex-account-usage.service.ts:147`) is still
  running (e.g., host shutdown / dispose mid-probe).
- Symptom: that child is never in `this.active`, so `close()` cannot kill it; it must exit
  on its own via its internal 10s timeout or natural close.
- Evidence: `codex-account-usage.service.ts:144-156` (spawns via `this.spawn`, return value
  discarded by `readProcessOutput`, never assigned to `this.active`).
- Current handling: none; bounded by the 10s `REQUEST_TIMEOUT_MS` so not unbounded, but not
  a clean disposal path.
- Recommendation: track the version-check child in `this.active` too, or accept and document
  the bounded-timeout justification explicitly (currently undocumented).

## Blocking issues

None found.

## Serious issues

### Shared `this.active` field is not safe under concurrent reads

- File: `libs/backend/auth-providers/src/lib/providers/codex/codex-account-usage.service.ts:96,80-91`
- Scenario: two overlapping `getAccountUsage()` calls on the shared singleton (see failure
  mode above).
- Impact: spurious failure surfaced to one caller, orphaned child process for the other —
  contradicts the review requirement "concurrent requests coalesced or bounded" and the
  "no orphan child process" requirement simultaneously.
- Fix: single-flight the read (matching `CodexAuthService.refreshInFlight`'s existing
  pattern in this same lib) or scope `close()` to the specific child handle rather than a
  shared instance field.

## Moderate and minor issues

- Moderate: `provider-account-state.service.ts:22-24` — no staleness/generation guard on
  provider switch (see failure mode above).
- Moderate: `codex-account.schemas.ts:49-59` vs `codex-account.generated.ts:44-52` — bigint
  vs `z.number().int()` precision mismatch for large token counters (see failure mode
  above).
- Moderate: `codex-account-usage.service.ts:144-156` — version-check child process not
  tracked in `this.active`, so external `close()` cannot reach it (bounded by timeout, but
  undocumented).
- Minor: `codex-home-resolver.spec.ts` covers only the override-precedence branch; no test
  for the `CODEX_HOME` env var or the `homedir()/.codex` default.
- Minor: `codex-account-usage.service.ts:102` — `initialized.codexHome !== this.codexHome.path`
  is a strict string comparison; on Windows, differing drive-letter case between what
  Node's `resolve(homedir(), '.codex')` produces and what the Rust App Server reports could
  cause a false `unavailable` (untested either way).
- Merge-conflict note (not a defect): `analytics-card.component.html` — B7 changes are two
  small, localized hunks (badge copy at the top, and a `<ptah-provider-account-card />`
  insertion immediately before `<ptah-session-metrics-cards>`). B5's progressive-paging
  work was not present in this worktree to diff against directly, but based on the
  insertion point (top of the "has sessions" branch, before the metrics cards) it is
  unlikely to collide with pagination controls further down the same template; flagging
  per instructions since the two branches were not diffed against each other here.

## Data flow

1. `ProviderAccountCardComponent.ngOnInit` → `ProviderAccountStateService.load()` — OK.
2. `load()` → `ClaudeRpcService.call('provider:getAccountUsage', {providerId, refresh})` — OK,
   but see staleness-guard gap on write-back.
3. RPC dispatch → `ProviderRpcHandlers.registerAccountUsage` (`provider-rpc.handlers.ts:154-165`)
   → Zod-validates params (`.strict()`), short-circuits non-Codex `providerId` before touching
   the Codex service — OK, matches "unsupported before upstream work".
4. `CodexAccountUsageService.getAccountUsage` → `auth.getAccountUsageEligibility()` — local-only
   file read, no spawn — OK, gap for Bedrock/apiKey/custom-endpoint modes handled correctly
   before any process work.
5. Cache check (30s TTL) → OK if not concurrent; not safe if concurrent (see Serious issue).
6. `readFromAppServer`: `assertVersion` (separate spawn) → `spawn(['app-server'])` →
   `initialize` (validated, `codexHome` cross-checked) → `initialized` notify → `account/read`
   (with `refreshToken:false`) → branch on account type → `account/rateLimits/read` and
   `account/usage/read` **with `params` key omitted entirely** (verified at
   `codex-account-usage.service.ts:224`: `...(params === undefined ? {} : { params })`) — OK,
   matches the explicit requirement.
7. All three responses Zod-parsed before use; parse failures propagate as thrown errors
   caught by the outer `try/catch` in `getAccountUsage`, mapped to `service-unavailable`, never
   surfaced raw — OK.
8. `finally { await this.close(); }` — OK in the single-caller case; unsafe under
   concurrency (Serious issue).
9. Result flows back through RPC → Angular service → component template, gated on
   `state.isCodex()` — OK; no `[innerHTML]`, plain interpolation only.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------------------------ | --------------- |
| Home resolved once, override > CODEX_HOME > homedir()/.codex | COMPLETE | Case-sensitivity edge case on Windows untested (Minor) |
| Same home for auth read/watch/App Server env | COMPLETE | — |
| Init precedes account reads | COMPLETE | — |
| `params` omitted (not `{}`/`undefined`) on rateLimits/usage reads | COMPLETE | verified by spec assertion and by code |
| Version/method gating for 0.147.0 | COMPLETE | — |
| Timeouts/abort/close always clean up | PARTIAL | Broken under concurrent calls (Serious); version-check child untracked by external `close()` (Moderate) |
| Cache invalidation on auth-file change | COMPLETE | — |
| Concurrent requests coalesced or bounded | MISSING | No lock/single-flight; shared mutable `this.active` corrupted under concurrency |
| Zod validation on every response | COMPLETE | Precision mismatch on bigint fields (Moderate) |
| No credential/token/raw-response logging | COMPLETE | Verified by spec assertions (lines 96, 117, 123) and by code review — only `status` is logged |
| Unsupported modes return before upstream work | COMPLETE | — |
| RPC dual-registration (shared types + manifest) | COMPLETE | — |
| DI tokens/registration | COMPLETE | Host smoke specs pass per report; no TypeInfo/Object defect found in reviewed constructors (all @inject-decorated explicitly) |
| Frontend card standalone/OnPush/signals/no innerHTML | COMPLETE | — |
| Quota/activity visually separate from local estimate | COMPLETE | Badge text changed to "Estimated from recorded usage and current rate card"; new card is a distinct section |
| Stale response after provider switch cannot write | MISSING | No generation/providerId check before `_result.set(...)` |
| Safety: no real account data checked in | COMPLETE | `codex-account.generated.ts` and `codex-account.schemas.ts` contain only generic type/schema shapes; no real emails, ids, tokens, or paths. Spec fixtures use synthetic homes (`resolve('synthetic-codex-home')`) and clearly-fake data (`private@example.test`, `private raw error`) |

Implicit requirements not addressed: bounding/coalescing concurrent account-usage reads
(explicit ask, not met); large-integer precision for token counters (not addressed, not
asked for explicitly either).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| API-key auth | YES | `getAccountUsageEligibility` returns `unsupported-auth` before spawn | — |
| Bedrock account | YES | App Server response mapped to `unsupported-auth` | Only detectable post-spawn, which is correct since it's not a local-file signal |
| Custom endpoint/proxy | YES | `unsupported-config` before spawn | — |
| Missing OAuth token | YES | `unsupported-auth` before spawn | — |
| CLI absent | YES | `cli-unavailable`, spawn error swallowed | — |
| CLI version mismatch | YES | `cli-version-unsupported` | — |
| Method not found (`-32601`) | YES | mapped to `cli-version-unsupported`, no raw message logged | — |
| Abort mid-request | YES | signal listener rejects all pending, child closed | — |
| Auth file changes mid-session | YES | `onAuthFileChanged` clears cache | — |
| Concurrent calls | NO | shared `this.active` field | Serious issue above |
| Provider switch mid-flight (frontend) | NO | unconditional `_result.set` | Moderate issue above |
| Very large lifetime token count | NO | `z.number().int()` vs `bigint` generated type | Moderate issue above |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: `CodexAccountUsageService`'s process-handle cleanup is not concurrency-safe —
  two overlapping account-usage reads on the shared singleton can kill each other's App
  Server child process, contradicting the batch's own "no orphan child process" and
  "concurrent requests coalesced or bounded" requirements. This is the one finding that
  should block sign-off; the rest are Moderate/Minor hardening items.
- What a robust implementation would add: single-flight (or an explicit queue) around
  `readFromAppServer`, scope `close()` to the handle it was given rather than a shared
  field, a `providerId`/generation check before the frontend commits a response, and either
  a documented rationale or a fix for the bigint/number schema mismatch on large token
  counters.
