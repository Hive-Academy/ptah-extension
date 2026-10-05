# Backend implementation — `TASK_2026_596_0a19`, batch 8

**Tasks completed**: 8.1 `PlanLimitLedgerService`, 8.2 reader types, 8.3 `PlanCredentialSource`,
8.4 DI registration and barrels.

Worktree root: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets`. No git was run.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-limit-ledger.service.ts`: the ledger class: writes, reads, subscriptions, G2 session wiring, `onChange`, `dispose` (605 lines).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-limit-ledger.rules.ts`: the pure Decision 4 rules: allowance id, `supersedes` stamps, carry and clear rules, expiry, longest window, Claude window mapping.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-limit-ledger.persistence.ts`: the P6 codec: `PLAN_LIMIT_LEDGER_STORAGE_KEY = 'ptah.planLimits.exhaustion.v1'`, `serializeLedger`, and `restoreLedger` (zod, validated per owner).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-limit-ledger.service.spec.ts`: 38 tests.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\readers\plan-usage-reader.types.ts`: `PlanCredentialRef`, `PlanSessionHandle`, `PlanOwnerTarget`, `PlanUsageReadRequest`, `PlanUsageReading`, `PlanUsageReader`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-credential.source.ts`: `PlanCredentialSource.resolve(ref)` and `PlanSecret`, whose output is redacted in every form.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\plan-credential.source.spec.ts`: 9 tests.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\index.ts`: the quota sub-barrel, with explicit named exports only.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\di\register.ts`: `registerPlanLimitServices`, called from `registerAuthProvidersServices`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\di\register.spec.ts`: adds a lazy-resolution case.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\index.ts`: adds `export * from './lib/quota';` and moves the two OpenRouter type exports into its value block. Now **149 lines**.
- MODIFIED (minimal extension, allowed by the brief) `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\auth\provider-quota.store.ts`: optional `sourceId` on `ProviderQuotaContext` and `ProviderQuotaObservation`. It is spread in only when present, so the existing `toEqual` specs still hold.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\auth\provider-quota.store.spec.ts`: adds a pass-through case.
- MODIFIED (minimal, R5) `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.ts`: adds a `randomUUID` import, a `private readonly quotaSourceId`, and `sourceId` in the two existing ctx literals. Hunks are at original lines 32, 209, 1178 and 1237. The 966-976 region is untouched.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\translation\translation-proxy-base.spec.ts`: adds an F68 source-id case.
- MODIFIED (outside the batch list; reported) `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\backend\auth-providers\src\lib\quota\provider-owner.resolver.ts`: exports `isPlaceholderCredential` and `ptahCliKeySlot`, and the resolver now uses them itself. The credential source reuses the single placeholder set and slot name instead of copying them.

`git status` also shows the pre-existing chat-ui Context rename files and `.ptah/specs`. I did not touch them, and no never-touch file is in the diff.

## Stack observed

- **DI**: tsyringe with `Symbol.for` tokens. Tokens for Batch 8 already exist in `libs\backend\auth-providers-tokens\src\lib\tokens.ts:22-28` (Task 6.3).
- **Factory precedent**: the trailing test parameter and `instanceCachingFactory` follow `CuratorProxyManager` (`di\register.ts`).
- **Validation**: zod 4.6.5 (`auth-providers/package.json`), using `strictObject` like `quota-owner-ref.schema.ts`. Owner refs are checked with the exported `parseQuotaOwnerRef`.
- **Storage**: `IStateStorage` (`platform-core/src/interfaces/state-storage.interface.ts`, sync `get`, async `update`) under `PLATFORM_TOKENS.STATE_STORAGE`. Each platform registers it (`platform-vscode|electron|cli/src/registration.ts`).
- **Registry**: `CallbackRegistryBase` (`agent-sdk/.../callback-registry.base.ts`) dispatches synchronously, in registration order, with per-subscriber try/catch.
- **Conventions**: `CONVENTIONS.md` §3 (barrel ≤150 lines, explicit named exports), §9 (`dispose` sync and idempotent), and `max-lines` 700 as a warning (`eslint.config.mjs:514`).

## Per-task evidence

### 8.1 Ledger

- **Writes**:
  - `recordWindowEvidence(owner, window, {stale})` uses the shared `supersedes` (rules in `windowStamp`). Each `stale` flag is kept per entry, and `observedAt` is never re-stamped. A spec pins that a stale re-serve keeps its original time.
  - `recordOwnerEvidence` keeps one entry per model scope and also uses `supersedes`.
  - `recordCooldown`: the later deadline wins.
  - `recordSuccess({ownerKey, modelScopes, billing, observedAt})`. Any success clears an earlier cooldown on the same owner. Only `billing:'plan'` clears unknown-reset exhaustion, and only on `five_hour`, `weekly` and `weekly_model:<scope>` of the same owner, plus owner evidence for that scope or for all models. It never clears overage, monthly, other scopes, other owners, known resets, or evidence newer than the success.
  - `setSessionOwner(sessionId, ref|null, scope|null)`.
- **Reads**: `snapshotFor(ownerKey)`, `knownOwners()` (owners with evidence plus current session owners), `sessionOwners()` (the shape of `PlanLimitsSnapshot.sessionOwners`), and `onChange(listener) → unsubscribe`.
- **G2 wiring**: on `turn-start`, the ledger calls `resolver.ownerForSession(sessionId)`. On a native route that runs `probe.readAccount(sessionId)` → `ownerForClaudeAccount(account, 'session:<id>')` (`provider-owner.resolver.ts:350-354`), then `setSessionOwner`.
  - Each session's signals are serialised on a promise chain, so a turn's evidence and its S1 success land under that turn's owner. Earlier evidence keeps its owner (F79).
  - The chain starts in a `then`, after the synchronous fan-out. This guarantees that the probe's own `turn-start` handler has already dropped the previous turn's cached account before the ledger reads it, whatever the subscriber order.
  - Evidence that arrives before any `turn-start` resolves the owner once.
- **Proxy observers**:
  - A 429 records a cooldown with `until = gateUntil` (the clamped gate) and `rawUntil = parseRetryAfterDeadline(retryAfterRaw)`, which is not clamped, so a 7-day value stays 7 days.
  - With `ownerKey:null` the owner is `unknownOwnerKey(providerId, 'proxy:' + sourceId)`.
  - A 2xx with an owner calls `recordSuccess` with billing `'unknown'`, which clears only the cooldown. A 2xx with a null owner is ignored.
- **Lifetime**:
  - There are no timers; a spec asserts `jest.getTimerCount() === 0`.
  - Expiry is checked on access. A known reset expires at the reset. An unknown reset expires once the provider's longest window has passed: `opencode*` 30 d, Codex its largest `durationMins`, otherwise 7 d.
  - Owners with nothing left are dropped. There is no owner cap.
- **Persistence**: only known-reset exhaustion and owner evidence are persisted. Each owner is validated separately on load, and evidence past its reset is pruned. A write runs only when the serialized payload changes. A failed write is logged at debug level, and memory stays authoritative.
- **`dispose()`**: synchronous and idempotent. It calls the three unsubscribes (registry, `onRateLimit`, `onSuccess`) and clears the listeners.
- **Listener isolation**: each `onChange` listener runs in its own try/catch and is logged at debug level.
- **Logging**: every log is `logger.debug`, with only ids or kinds as payload. A spec asserts that `warn` and `error` are never called.

### 8.2 Reader types

- These match Component 6 `:710-726`. `credentialRef` and `sessionHandle` are separate fields; a session handle is never a credential.
- `PlanUsageReading` is the snapshot without `owner`, `ownerEvidence`, `cooldown` and `staleSince`, because the service adds those.

### 8.3 Credential source (AS7 checked first)

- **AS7 confirmed**:
  - `local-native.strategy.ts:77-78, 167-168` reads `getProviderKey('ollama-cloud')`.
  - `api-key.strategy.ts:356` reads `getProviderKey(providerId)`.
  - The Ptah CLI slot is `ptahCli.<id>` (`provider-owner.resolver.ts`, now `ptahCliKeySlot`).
- **Status mapping**: missing or blank → `unsupported-config`; a placeholder → `unsupported-auth`; a store failure → `service-unavailable`. A failure is logged at debug level with only `{refKind, id}`.
- **No caching**: every call reads the store again (spec: changed key).
- **`PlanSecret`**: the value lives in a `#private` field. `toJSON`, `toString` and `util.inspect` all return `[redacted]`, and only `reveal()` returns the secret.

### 8.4 DI and barrels

- The resolver, the credential source and the ledger are registered in `registerAuthProvidersServices` through `registerPlanLimitServices`.
- **Registration order**: on all three hosts, `registerAuthProvidersServices` runs before `registerSdkServices` (`apps/ptah-electron/src/di/phase-2-libraries.ts:196/201`, `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:151/152`, `libs/backend/cli-engine/src/lib/container.ts:651/655`).
  - Every one of the three registrations resolves lazily: two singleton `useClass` registrations and one `instanceCachingFactory` for the ledger. Nothing resolves them during registration.
  - `register.spec.ts` registers the registry, probe and storage *after* `registerAuthProvidersServices`. It then resolves all three services and checks that the ledger is a singleton.
- **Barrels (R1)**: `quota/index.ts` lists explicit named exports. The root barrel has one `export * from './lib/quota';` line. `wc -l libs/backend/auth-providers/src/index.ts` = **149**.

## Fixtures covered (ledger side)

- F17, F18, F19, F20: one case each.
- F21: three precedence rules, one fixture each, plus the stale original-time case.
- F22: separate allowances.
- F23: unrelated-model, overage, fallback and credit (`unknown`) successes clear nothing; a same-allowance read below the limit clears; reaching the limit (100 %) does not clear; the longest window elapsing gives unknown usage, also for Codex at its largest duration.
- F24 / P6: restart with and without a known reset; after the reset nothing is left; a corrupt envelope or a corrupt owner is dropped on its own.
- F62: direct case and the full registry path.
- F63, F64, F65 (ledger side).
- F66: cooldown only; a null owner clears nothing.
- F67 / F68: two proxies give two unknown owners, separate from the keyed owner. The source id runs end to end in the proxy-base spec.
- Req 3.6: a 7-day `rawUntil` is kept while the gate is clamped.
- F71 (credential part): JSON, inspect and string forms, plus all log calls, carry neither fake secret.
- F74: 100 owners survive in memory and across a restart.
- F79 / G2: A→B across two turns; `readAccount` is called twice; A keeps its evidence; B has none of A's.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/auth-providers --skip-nx-cache` → "Successfully ran targets typecheck, lint". `npx eslint` on `quota/`, `di/` and the root barrel reports no problems. Earlier, the single ledger file reached 784 code lines and triggered the `max-lines` warning; that is why it was split into the rules and persistence files.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers --skip-nx-cache -- --maxWorkers=2`:
  - lint ✓.
  - test: 55/56 suites passed; 1439 passed and 6 failed of 1445. All 6 failures are in `translation-proxy.sdk.integration.spec.ts` (S1, S2, S3, S4, S6a, S6b). Each is an `EPERM` `removeTree` teardown error under `%TEMP%\ptah-sdk-int-*`. The log contains no `Expected` or `Received` assertion text. This is the known environment item, and nothing else failed.
  - typecheck failed only because the `--maxWorkers=2` passthrough reached `tsc` (`TS5023 Unknown compiler option`). Re-run without the flag: `npx nx run-many -t typecheck -p @ptah-extension/auth-providers --skip-nx-cache` → "Successfully ran target typecheck".
- Touched suites run alone: ledger 38/38, credential source 9/9, register 3/3, quota store 33/33, proxy base 198/198.
- No TODO, stub or timer in `quota/`. `wc -l src/index.ts` = 149.

## Plan deviations

1. **Proxy instance id**: Batch 7's ctx had no instance id. I added an optional `sourceId` (store context and observation) plus a per-instance `randomUUID()` in `TranslationProxyBase`. This stays inside auth-providers, as the brief allowed. The id is route material for `unknownOwnerKey` and is hashed there; nothing is hashed locally.
2. **G2 path**: the ledger calls `ownerForSession` rather than calling `readAccount` → `ownerForClaudeAccount` itself. On native routes that is the same chain (the resolver's D6 route table). Proxied and direct-key sessions also get their correct owner, instead of a Claude account read that does not apply to them.
3. **Owner-evidence bound**: one entry per model scope, superseded by newer evidence, instead of "last 3 per owner". A strict cap of 3 would evict active evidence once 4 scopes exist (all-models, opus, sonnet, haiku), which Decision 4's eviction rule forbids. The bound is the number of scopes.
4. **Logging level**: storage read and write failures are logged at debug level (the batch rule is "debug-only logs"), not at the "sanitized warning" level the plan text uses.
5. **`recordSuccess` signature**: `modelScopes: readonly string[]` instead of a single `modelScope`, because S1 carries a set of turn scopes (Decision 4: a multi-family turn clears each of its families).
6. **Ledger split into three files**: `.service`, `.rules` and `.persistence`. The cause was the repo `max-lines` rule, not a design change.
7. **Root barrel**: `export *` of a sub-barrel that itself has only explicit named exports, as R1 prescribes. CONVENTIONS §3 otherwise reserves `export *` for type bundles.
8. **Resolver exports**: `isPlaceholderCredential` and `ptahCliKeySlot` (a file outside this batch) are exported so that placeholder detection and the slot name have one home.

## Carry-forward and risks

- **Nothing resolves `PLAN_LIMIT_LEDGER` yet.** Until a consumer resolves it, it holds no subscriptions and captures no evidence. Batch 9 (`PlanUsageService`) or Batch 15 (RPC/broadcaster) must resolve it at host startup (eagerly, after `registerSdkServices`). Otherwise early-session evidence is missed.
- **Batch 9 readers** must:
  - pass `PlanSecret` straight through and call `reveal()` only at the request;
  - map an unavailable resolution's `status` directly;
  - feed full-table reads through `recordWindowEvidence` with each window's source observation time, plus `{stale:true}` for cached re-serves.
- **Lanes (Batches 11-13)** call `recordSuccess` with `modelScopes` and billing per S2/S3, and use `setSessionOwner` / `recordWindowEvidence` for lane evidence.
- **Memory**: the `sessions` map holds one small entry per session id seen, and there is no session-end signal to prune it. It is bounded by the sessions in one process lifetime. No timers or observers are kept per entry.
- **R4**: neither file logs or serializes credential material. Specs assert this for the credential source and its log calls.
