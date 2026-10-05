# Batch 5 report — Session quota probe and restore validation

Executor: backend-developer. Batch 5 (Tasks 5.1, 5.2, 5.3). No git operations performed.

## Files

Under `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\`:

- CREATED `libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-quota-probe.service.ts`: `SessionQuotaProbeService`, which implements `SessionQuotaProbe` (`readAccount`, `readPlanUsage`, `sessionRoute`, `dispose`).
- CREATED `libs\backend\agent-sdk\src\lib\helpers\plan-limits\session-quota-probe.service.spec.ts`
- CREATED `libs\backend\agent-sdk\src\lib\helpers\plan-limits\quota-owner-ref.schema.ts`: a strict zod schema plus `parseQuotaOwnerRef(value): QuotaOwnerRef | undefined`.
- CREATED `libs\backend\agent-sdk\src\lib\helpers\plan-limits\quota-owner-ref.schema.spec.ts`
- MODIFIED `libs\backend\agent-sdk\src\lib\session-metadata-store.ts`: `getCliSessionsForRestore` maps every reference through a module-level `restoreQuotaOwner`.
- MODIFIED `libs\backend\agent-sdk\src\lib\session-metadata-store.spec.ts`: new describe block for G3 restore validation.
- MODIFIED `libs\backend\agent-sdk\src\lib\di\tokens.ts`: `SDK_SESSION_QUOTA_PROBE: Symbol.for('SdkSessionQuotaProbe')`.
- MODIFIED `libs\backend\agent-sdk\src\lib\di\register.ts`: singleton `useClass: SessionQuotaProbeService`, registered right after `SDK_SESSION_PLAN_LIMIT_REGISTRY`.
- MODIFIED `libs\backend\agent-sdk\src\index.ts`: grew by 10 lines, from 387 to 397 (R2).

I did not touch `session-query-executor.service.ts`, `sdk-adapter-events.service.ts`, `helpers/index.ts`, `stream-transformer.ts`, any compaction file, any settings path or `batches.md`. The chat-ui Context-rename files were already modified before this batch, and I left them alone.

## Task 5.1 — `SessionQuotaProbeService` (G2, AS1, D4)

### How the stack is wired

- tsyringe `@injectable` with `@inject(token)`, registered as a singleton in `register.ts`. This follows `session-plan-limit-callback-registry.ts` and `subagent-message-dispatcher.ts:116-122`.
- The probe's dependencies:
  - `TOKENS.LOGGER`
  - `SDK_SESSION_LIFECYCLE_MANAGER`, typed as the narrow `QuotaProbeSessionSource` (`find` and `getActiveSessionIds` only)
  - `SDK_SESSION_PLAN_LIMIT_REGISTRY`
  - `SDK_ADAPTER_EVENTS`

### Turn trigger (AS1)

- The probe subscribes to `SessionPlanLimitCallbackRegistry`. On `signal.kind === 'turn-start'` it drops the account entry.
- On a `native` route only, it then starts the next `readAccount` as fire-and-forget (`void`, never awaited). `readAccount` never rejects.
- The result is one `accountInfo()` per turn, never one per message, and the stream path never waits for it.
- `turn-start` itself is Batch 4's narrowed trigger: the first turn-opening message after a `result`.

### Query replacement

- The cache is a `WeakMap` keyed by the `Query` instance.
- `SessionRegistry.setSessionQuery` (`session-registry.service.ts:395`) assigns `rec.query` to a new object. A restart that registers a new record also brings a new `Query`. Either way the lookup misses, so the old account can never be served for the new query.
- Old entries are released when the old `Query` is garbage-collected.

### Assistant auth errors

- The probe subscribes to `SdkAdapterEvents.onTurnFailed`. It drops the entry when `event.error` is `authentication_failed`, `oauth_org_not_allowed` or `account_on_hold`.
- `turnFailed` comes from the `StopFailure` hook (`stop-failure-hook-handler.ts:92-100`). Its `error` has the same `SDKAssistantMessageError` type as the assistant message (`sdk.d.ts:3484`, `StopFailureHookInput.error` at `:9053`).
- This needs no edit to `stream-transformer.ts` or to the Batch 4 signal union. The adapter-events file is only subscribed to, not edited.

### D4

- The probe does not subscribe to `authFileChanged` or `configChanged`.
- A spec asserts `listenerCount('authFileChanged') === 0` and `listenerCount('configChanged') === 0`.

### Cache-keying choice

The cache is keyed by `Query` identity. Lookup goes through `SessionLifecycleManager.find(id)`, which resolves both the tabId and the real session id to the same `SessionRecord` (`session-registry.service.ts:346-348`), and so to the same `Query`.

- A `turn-start` that still carries the tabId and a later read by real id hit the same entry.
- No re-keying on `SessionIdResolvedCallbackRegistry` is needed.
- The F77 spec drives exactly this: the first turn is signalled by tabId and the second by real id.

### Failure and timeout handling

- Every SDK call races a 3 s timer (`SESSION_QUOTA_PROBE_TIMEOUT_MS = 3_000`). The timer is cleared in `finally`.
- The call returns `null` on timeout, rejection, a synchronous throw, an unknown session, a missing query, or a query without the method.
- A failed read is not cached, so the next caller retries. A read already in flight is shared.
- An entry dropped mid-flight is not re-inserted.

### Logging

- Logger only, at debug level.
- A successful account read logs only presence flags: `hasEmail`, `hasOrganization`, `hasSubscriptionType`, `hasApiKeySource`.
- A failure logs `{sessionId, operation, failure: 'timeout'|'rejected'}`. The error text is deliberately left out, because a control-request error could echo account details.

### `readPlanUsage(sessionId?)`

- It calls `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({skipBehaviors: true})` on demand only. Nothing per turn calls it, and a spec asserts that `turn-start` never calls it.
- With no id, it uses the first entry of `getActiveSessionIds()` (most recently active first) that is direct-Anthropic and has a query.
- It returns `null` for proxy routes: a proxied CLI's `/usage` describes no Claude plan.
- On a `direct-key` route it passes `rate_limits_available=false` / `rate_limits: null` through unchanged. The reader maps that to `unsupported-auth`.

### `sessionRoute(sessionId)`

- It reads `record.capacityRoute`, which is frozen at registration and read-only here.
- Mapping:
  - `proxy` → `{providerId, 'proxy'}`.
  - `native` → `'direct-key'` when `accountingAuthEnv.ANTHROPIC_API_KEY` is set and not blank, otherwise `'native'`. This is the same OAuth-versus-key test as `sdk-model-service.ts:578`.
  - A missing route → `'unknown'`.
  - No record → `null`.
- It returns no credential or fingerprint (a spec checks this).

### SDK method typing

The registry stores the query under Ptah's structural `Query` mirror (`session-lifecycle-manager.ts:76`). That mirror does not declare `accountInfo` or `usage_*`, and editing it is outside this batch.

- The probe types the runtime object as `Partial<Pick<SdkQuery, 'accountInfo' | usage>>`, using the SDK `Query` re-exported from `claude-sdk.types.ts:73`.
- It checks `typeof method === 'function'` before each call.
- `ClaudePlanUsage` is derived from the SDK method's return type.

### Release path

- `dispose()` releases both subscriptions. A spec checks this.
- No timer outlives a call.

## Task 5.2 — `quotaOwner` validation on restore (G3, D5)

### Schema

- `z.strictObject({providerId, identityKind, key, label})`:
  - `providerId`: a lowercase slug, `/^[a-z0-9][a-z0-9._-]{0,63}$/`.
  - `identityKind`: `z.enum(['account','credential','cli-store','unknown'])`.
  - `label`: trimmed, 1-64 characters, no `@`.
- A refine requires `key === "<providerId>#<identityKind>:" + 16 lowercase hex characters` (Decision 3, `implementation-plan.md:282-283`). The key must agree with the object's own `providerId` and `identityKind`.
- `parseQuotaOwnerRef` uses `safeParse` and never throws.

### Seam

`SessionMetadataStore.getCliSessionsForRestore` is the single restore seam (D5) and now maps through `restoreQuotaOwner`:

- A reference with neither `quotaOwner` nor `quotaOwnerKey` is returned unchanged.
- Otherwise a stray legacy `quotaOwnerKey` field is always stripped. `quotaOwner` is kept only if it parses; if it does not, the field is omitted, which renders as "Unknown owner".
- Nothing ever substitutes the current owner. The store has no access to the current owner.

## Task 5.3 — DI and exports

- Token: `SDK_SESSION_QUOTA_PROBE: Symbol.for('SdkSessionQuotaProbe')`.
- Registration: a singleton, resolved lazily by consumers. Its subscriptions start at first construction, and before that it holds no cache.
- Barrel additions: these are direct imports from `plan-limits/*`, not routed through `helpers/index.ts`.
  - Mapper: `mapClaudePlanLimitMessage`, `claudeModelFamily`, `billingFromRateLimitInfo`, plus `type ClaudePlanLimitMapping`.
  - Probe: `type SessionQuotaProbe`, `type SessionQuotaRoute`, `type ClaudePlanUsage`.
  - Schema: `parseQuotaOwnerRef`.
- `AccountInfo` is already exported through `export * from './lib/types/sdk-types/claude-sdk.types'`.

## Fixtures covered

### F77, rewritten under G2

- Two consecutive turns with different `accountInfo()` results give two different reads (A then B). The first turn is signalled by tabId and the second by real id.
- Replacing the query drops the cache.
- Each of `authentication_failed`, `oauth_org_not_allowed` and `account_on_hold` drops the cache.
- Any other turn failure (`rate_limit`) keeps the cache.

### Probe cases

- A null query or unknown session returns `null`.
- A query without the method returns `null`.
- A timeout returns `null` at exactly 3 s, not before.
- A rejection returns `null`, is not cached, and its error text is not logged.
- API key: `rate_limits_available=false` is passed through, and `skipBehaviors: true` is sent.
- Plan usage on a proxy route returns `null`.
- With no id, the most recently active direct-Anthropic session is picked.
- `turn-start` prefetches on a native route only.
- Five `sessionRoute` route-kind cases, plus the unknown and no-record cases.

### F55, probe slice only

F55 as amended (two queries with different `accountInfo()` results, with no `authFileChanged` step) is an integration fixture across the ledger, the resolver and the view model. Batch 5 provides and pins the probe half: a per-turn re-read returns B after A. The rest belongs to Batches 6, 8, 11, 13 and 18.

### G3 restart fixture, store slice

- Run A is persisted with owner A and there is no ledger evidence. The store is flushed and a fresh store is created over the same storage.
- The restored run still carries A, and `ownerRelation(restoredA, B) === 'different'`.
- These restore as no owner, so `ownerRelation(..., B) === 'unknown'`:
  - a legacy key string
  - an unknown `identityKind`
  - an extra `apiKey` field
  - a malformed key
  - a wrong type
  - a stray `quotaOwnerKey`
- A valid owner next to a stray `quotaOwnerKey` keeps the owner and drops the stray field.

### Schema spec

- 4 canonical kinds are accepted unchanged.
- 20 malformed or legacy shapes become `undefined` without throwing.

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk` succeeded: lint, test and typecheck all passed (3/3, cache 0/3 hit).
- Targeted run: `npx jest -c libs/backend/agent-sdk/jest.config.ts --maxWorkers=2 plan-limits session-metadata-store.spec` gave 6 suites passed and 178 tests passed, which confirms the new specs ran.
- `npx eslint` on the changed files reported 0 errors and 1 warning. The warning is `max-lines` on `session-metadata-store.ts`, which was already over the limit (1280 lines before, about 1298 now).

## Plan deviations

- **Auth-error signal source**: Batch 4's signal union carries no auth errors, so the probe uses `SdkAdapterEvents.turnFailed`, which is the `StopFailure` hook carrying the assistant error, instead of adding a signal to `stream-transformer.ts` (outside this batch). This is not one of the D4-forbidden events.
- **Eager per-turn read**: on a native route, `turn-start` starts the next read (fire-and-forget). This matches G2's "re-reads at the start of EVERY query" and R6's "a control request per turn". On proxy and direct-key routes the cache is only dropped.
- **Failures not cached**: a transient failure does not pin "unknown" for the whole turn. Concurrent callers share one read in flight.
- **`readPlanUsage` route restriction**: it returns `null` for proxy and unknown routes.
- **Key fingerprint length**: pinned to 16 lowercase hex characters per Decision 3. Batch 6's resolver must produce exactly this, or restored owners will read as "Unknown owner". That failure mode is safe, but the owners would be lost. `parseQuotaOwnerRef` is exported so the resolver spec can assert its own output parses.

## Risk handling

- **R2**: the barrel grew by 10 lines, all direct named exports from `plan-limits/*`.
- **R4**: `accountInfo` is never logged or serialized, only presence flags. Error text is not logged. `sessionRoute` returns no credential. The schema rejects any extra field (`strictObject`) and labels containing `@`.
- **R6**: one read per turn on native routes only. It is bounded at 3 s, never awaited on the stream path, and a failure returns `null`, so the owner is unchanged.
- **R7, G3**: a malformed restore gives no owner, which `ownerRelation` maps to `unknown`. It is never the current owner.

## Out-of-scope observations

- `session-metadata-store.ts` was already over the 700-line `max-lines` limit (warning only).
- Provider ids are validated as lowercase slugs. If a user-defined provider id ever contains other characters, its persisted owner would restore as "Unknown owner", which is the safe direction. Batch 6 may want to normalise ids when building keys.
