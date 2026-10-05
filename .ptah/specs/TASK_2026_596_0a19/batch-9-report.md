# Backend implementation — `TASK_2026_596_0a19`, batch 9

**Tasks completed**: 9.1 `PlanUsageService` (+ DI + quota barrel), 9.2 Claude and Codex readers.

## Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\`.

- CREATED `quota\plan-usage.service.ts`: dispatcher, 30 s per-owner cache, single flight, abort handling, stale rule, ledger merge, credential boundary.
- CREATED `quota\plan-usage.service.spec.ts`: 24 tests. It uses the real `PlanLimitLedgerService` and mocks the probe, the Codex service and the credential source. No network.
- CREATED `quota\readers\claude-plan-usage.reader.ts`: maps `probe.readPlanUsage` to windows. It validates the payload with zod and logs a sanitised diagnostic.
- CREATED `quota\readers\claude-plan-usage.reader.spec.ts`: 7 tests.
- CREATED `quota\readers\codex-plan-usage.reader.ts`: adapts `ICodexAccountUsageService` and keeps the primary/secondary positions.
- CREATED `quota\readers\codex-plan-usage.reader.spec.ts`: 9 tests.
- MODIFIED `di\register.ts`: registers `PLAN_USAGE_SERVICE` through an `instanceCachingFactory`, the same as the ledger, because the trailing clock is a test seam. It resolves lazily.
- MODIFIED `di\register.spec.ts`: asserts that `PLAN_USAGE_SERVICE` resolves lazily as a singleton `PlanUsageService`. This is the colocated spec of `register.ts`.
- MODIFIED `quota\index.ts`: exports `PlanUsageService`, `PLAN_USAGE_CACHE_TTL_MS` and `PlanUsageRequestOptions`. The root barrel `src\index.ts` is unchanged at **149 lines**, because it already has `export * from './lib/quota'`.

Never-touch files: none touched. The only changes outside auth-providers in `git status` are the pre-existing Batch 16 rename files.

## Stack observed

- **DI**: tsyringe `@injectable` / `@inject`, with factory registration when there is a trailing test-seam parameter (`register.ts:214-225`, ledger precedent).
- **Tokens**: `AUTH_PROVIDERS_TOKENS.PLAN_USAGE_SERVICE` already existed (`auth-providers-tokens/src/lib/tokens.ts:26`).
- **Validation**: zod 4.6.5 (`libs/backend/auth-providers/package.json:18`), the same as `codex-account.schemas.ts`.
- **Logging**: `Logger` from vscode-core only.
- **Single flight**: follows `codex-account-usage.service.ts:106-131` (`readInFlight` plus `joinWithCallerAbort`).

## AS5 check (done before the session-owner path): FALSE

I read `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:83-130` without editing it. `resolveCapacityRoute` never yields `providerId:'ollama-cloud'`:

- **Cloud-direct**: `local-native.strategy.ts:213-220` sets `ANTHROPIC_BASE_URL = OLLAMA_CLOUD_DIRECT_BASE_URL = 'https://ollama.com'` (`local-provider-entry.ts:17`).
  - That URL is not direct Anthropic (`auth-env.utils.ts:3-6`) and not local, so the code reaches the registry match at `:110-121`.
  - The registry entry's `baseUrl` is `http://127.0.0.1:11434` (`local-provider-entry.ts:117`). No entry matches, so the route is `{kind:'proxy', providerId:null}`.
- **Daemon mode**: the base URL is `http://127.0.0.1:11434/`, and the auth token is not one of the three placeholders handled at `:99-109`.
  - Both `ollama` (`:37`) and `ollama-cloud` (`:117`) match that URL, so `matches.length === 2` and `providerId` stays `null`.

What this means:

- **For this batch**: none. `PlanUsageService` dispatches only on `target.providerId`, which the discovery service or the resolver supplies, and it never infers a provider from a session route.
- **Downstream**: `ProviderOwnerResolver.ownerForSession` (`provider-owner.resolver.ts:357-360`) returns `unknown#unknown:<fp(session:<id>)>` for an Ollama Cloud main session. That session's ledger evidence and owner therefore do not match the `ownerForProviderKey('ollama-cloud')` target that discovery builds (plan table, `implementation-plan.md:995`).
  - The fix cannot go into `session-query-executor.service.ts`, which is 597-deferred and on the never-touch list.
  - It belongs to the resolver or to Batch 13 discovery, for example by mapping a proxy route with no provider id through the active provider when that provider is `ollama-cloud`.
  - **Team-leader decision needed** (see Out-of-scope observations).

## Per-task evidence

### 9.1 `PlanUsageService`

**API.** `getOwnerSnapshot(target: PlanOwnerTarget, {refresh?, signal?}): Promise<PlanLimitOwnerSnapshot>`. It never rejects, except with an `AbortError` when the caller's own signal fires.

**Dispatch.** A plain record `{anthropic, 'openai-codex'}` of reader functions, keyed by `normaliseOwnerProviderId(target.providerId)`.

- `opencode`, `opencode-go` and `opencode-zen` return `no-usage-source`.
- Every other provider returns `provider-unsupported`.
- Batch 10 adds `ollama-cloud` and `antigravity` to the same record.

**Credentials (F71).**

- A `credentialRef` is resolved through `PlanCredentialSource.resolve` only when the provider has a reader. No-source providers never read their key (F31 test asserts `resolve` is not called).
- An `unavailable` resolution maps its `status` directly.
- An available `PlanSecret` goes in the reader request as `credential` and is never stored, cached, logged or returned.
- The spec checks that neither the snapshot JSON nor any logger call contains the secret.

**Cache.**

- Keyed by `ownerRef.key`, TTL `PLAN_USAGE_CACHE_TTL_MS = 30_000`.
- `refresh` bypasses it but still joins an in-flight read, as the Codex service does.
- It caches only definitive readings: `available` and the eligibility/configuration statuses.
- Transient failures and `no-open-session` are not cached, so the next call retries.

**Single flight.**

- One flight per owner key. A caller's signal ends only that caller's wait.
- The shared read gets its own `AbortController`. It is aborted only when every signal-bearing waiter has aborted and no signal-less waiter joined.
- A cancelled flight leaves the map before it aborts. A caller arriving in that gap starts a fresh read instead of joining the doomed one; a spec covers this.
- A result produced under cancellation that is not `available` is discarded, never treated as an owner failure.

**Stale rule (Req 2.9).**

- These count as transient:
  - a thrown reader;
  - a zod parse failure;
  - a credential-store `service-unavailable`;
  - a `service-unavailable` reading other than `no-open-session`;
  - a source's own `stale` answer.
- A transient failure re-serves the owner's last `available` reading, or the source's own stale reading.
  - It is marked `status:'stale'`, and `staleSince` is the first failure in the current run of failures; a success clears it.
  - `fetchedAt` and each window's `observedAt` keep their **original** values.
- Each re-served window goes to `ledger.recordWindowEvidence(owner, window, {stale:true})`, never re-stamped.
- Eligibility statuses (`unsupported-auth`, `unsupported-config`, `provider-unsupported`, `cli-unavailable`, `cli-version-unsupported`) replace the cached reading and carry `windows: []` and `windowSetEstablished: false`.
  - So a later transient failure for that owner is not stale.
- A changed account or key is a different owner key, so an old owner's cache is never consulted (Req 4.3).

**Merge.**

- Fresh `available` windows are recorded in the ledger (`recordWindowEvidence`, using `supersedes`).
- The snapshot's `windows`, `ownerEvidence` and `cooldown` come from `ledger.snapshotFor(owner.key)`. That includes stream-event, error-derived and proxy evidence, which gives F27 and F32.
- `account`, `activity`, `fetchedAt` and `unavailableReason` come from the reading.

**Isolation.**

- Every reader call is wrapped. A failure is logged at debug level with `{providerId, reason: error.name}` only.
- Cache, flight and failure state are all per owner key.
- The spec runs a failing Codex read and a Claude read in parallel and checks that Claude is unaffected.

### 9.2 Readers

**Claude** (`createClaudePlanUsageReader(probe, logger, now)`).

- It calls `probe.readPlanUsage(target.sessionHandle?.sessionId)` on demand only. `sessionHandle` is a probe handle, not a credential.
- The payload is validated with zod against `sdk.d.ts:4012-4104`.
- Window mapping:

| SDK field | Window key | Duration |
| --- | --- | --- |
| `five_hour` | `five_hour` | 300 min |
| `seven_day` | `weekly` | 10 080 min |
| `seven_day_opus` | `weekly_model:opus` | — |
| `seven_day_sonnet` | `weekly_model:sonnet` | — |
| `seven_day_oauth_apps` | `other:oauth_apps` | — |
| `model_scoped[]` | `weekly_model:<display_name lowercased>` | — |
| `extra_usage` (only when enabled) | `overage` | — |

- Model-scoped labels read `Weekly · <name>`. The first window per key wins, so a `model_scoped` "Opus" row cannot override `seven_day_opus`.
- `extra_usage` is the amount `used_credits` of `monthly_limit` in `currency` (default `credits`), or the percentage when the amount is unknown.
- Labels match the ledger's for the same keys.
- `utilization:null` leaves `used` absent, never 0. `resets_at` goes through `normaliseInstant`. The source is `provider-api`, `windowSetEstablished:true`, and `account.planType` comes from `subscription_type`.
- Statuses:
  - `rate_limits_available:false` gives `unsupported-auth`.
  - A probe returning `null` gives `service-unavailable` with `unavailableReason:'no-open-session'`.
  - A malformed payload, or available limits with a `null` table, logs a warn `{providerId, fieldPath, reason}` (Req 2.7, no body) and throws `PlanUsageParseError`.

**Codex** (`createCodexPlanUsageReader(usage, now)`).

- It calls `getAccountUsage({refresh, signal})`.
- `quota.primary` becomes position 1 and `quota.secondary` position 2, always in that order. Each goes through `windowKindFromDuration(windowDurationMins, position)`, so an unknown duration becomes "Window 1" / "Window 2".
- `resetsAt` goes through `normaliseInstant` (seconds to ms), and `durationMins` is kept when it is numeric.
- `account.planType` and `activity` pass through (Req 2.10). `windows[0]` and `windows[1]` keep the primary/secondary meaning.
- Non-available statuses pass through with no windows.
- A Codex `stale` answer keeps the original `fetchedAt` on every window.

## Fixtures covered

| Fixture | Where |
| --- | --- |
| F26 Claude full table | reader spec "F26"; service spec "reads Claude through the probe…" |
| F27 probe null → event-only data | reader spec "F27"; service spec "F27" (ledger stream-event window attached, `no-open-session`) |
| F28 API key → `unsupported-auth` | reader spec "F28"; service spec "F28" (ledger windows withheld) |
| F29 Codex windows by duration, existing fields kept | reader spec "F29", plus position-label and secondary-only cases; service spec "F29" |
| F30 Req 2.9 matrix | service spec `F30` block, which has 9 cases. The six required cases: same-owner transient with cache → stale (original time, `{stale:true}` to the ledger, `staleSince` = first failure); transient without cache; unsupported auth; unsupported CLI version; A then B; A then sign-out. The other three: the source's own stale answer, no-open-session never stale, and a success clearing the failure start |
| F31 OpenCode with no evidence | service spec "F31" (exact snapshot; key never read) |
| F32 OpenCode with a recorded hit | service spec "F32" (`no-usage-source` plus error-derived `ownerEvidence`) |
| F71 (service side) | service spec "credentials (F71)" |

## Verification

**Command**: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers`, with no extra flags. It was run again after Prettier formatting.

- `typecheck`: passed.
- `lint`: passed. A direct `npx eslint` on every new and modified file printed nothing.
- `test`: 59 suites, of which 58 passed and 1 failed. 1485 tests, of which **1479 passed and 6 failed**.
  - All 6 failures are the known EPERM `removeTree` teardown in `translation-proxy.sdk.integration.spec.ts` (S1, S2, S3, S4, S6a, S6b). Each failure's cause is `EPERM, Permission denied … ptah-sdk-int-*`, raised from `removeTree` at `:177`.
  - On this run the `Get-CimInstance` timeout-kill case and the `translation-proxy-base.spec.ts` header-deadline timing test did not fail.
  - The first run (before formatting) gave 1481 passed and 4 failed; all four were the same EPERM S1-S4 teardowns.
- **New specs alone** (`npx jest -c libs/backend/auth-providers/jest.config.ts` on the 3 new specs plus `register.spec.ts`): 4 suites and 43 tests, all passed.
- **Root barrel**: 149 lines (≤150).

## Plan deviations

- **"Reusing Codex's cache"** (`implementation-plan.md:749`): the service keeps its own 30 s per-owner cache, keyed by owner key, because the stale and owner rules need it. Codex's 30 s cache and single flight still sit underneath, so a Codex read within 30 s costs no App Server spawn.
- **Codex stale**: a Codex `stale` answer is re-served with the service's own `staleSince` (the first failure the service saw), not Codex's per-call `Date.now()`. Windows keep Codex's original `fetchedAt`.
- **`no-open-session`**: not stale-eligible and not cached. The plan returns "service-unavailable … with ledger evidence still attached", and Req 2.2 asks for a fall back to event data. The probe also returns `null` on timeout, so a probe timeout is treated the same way.
- **Credential resolution**: credentials are resolved only for providers that have a reader. OpenCode targets carry a `provider-key` ref "for the owner only" (plan table `:994`), so resolving it would wrongly turn `no-usage-source` into `unsupported-config`.
- **Extra exports**:
  - `PLAN_USAGE_CACHE_TTL_MS` and `PlanUsageRequestOptions` (quota barrel).
  - `PlanUsageParseError`, `mapClaudePlanUsage` and `mapCodexAccountUsage` are exported from their reader modules only, not from the barrel.
- **Extra file edited**: `di\register.spec.ts`, the colocated spec of the assigned `register.ts`.

## Out-of-scope observations

1. **AS5 is false** (evidence above). An Ollama Cloud main session's owner resolves to an unknown owner, so the session never matches the `ownerForProviderKey('ollama-cloud')` target and its stream or proxy evidence lands under the unknown owner.
   - The fix needs a team-leader decision before Batch 10 or 13: either resolver-side route disambiguation, or accepting unknown-owner attribution for Ollama Cloud main sessions.
   - `session-query-executor.service.ts` is never-touch, so the fix cannot go there.
2. **Map size**: the service's cache and failure maps grow with the number of distinct owner keys, with no eviction. Owner keys are bounded by the accounts and keys configured, so this is not per-item work. There are no timers, listeners or observers, apart from per-caller abort listeners, which are removed when they settle.
3. **Codex `rateLimitReachedType`** is not yet turned into window exhaustion. Nothing in Batch 9 asks for it; the ledger's lane, proxy and error evidence covers exhaustion.
