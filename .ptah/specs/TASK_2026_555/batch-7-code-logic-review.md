# Code Logic Review — `TASK_2026_555` Batch 7 (`auth:deleteStoredKey` RPC, S1c)

## Round 2

**Verdict: APPROVED.** Both Round 1 moderate findings are fixed and pinned by new specs; no regression found.

- Scope: `auth-rpc.handlers.ts` `registerDeleteStoredKey` (~:1274-1341) and
  `auth-rpc.handlers.delete-stored-key.spec.ts` (11 specs, up from 9 — both new files are untracked, so
  `git diff` shows nothing; read and diffed against the Round 1 content directly instead).
- Ran myself in the foreground: `npx nx test @ptah-extension/rpc-handlers --testFile=auth-rpc.handlers.delete-stored-key.spec.ts`
  → **11 passed, 11 total** (9.3s; 1/1 Nx cache hit on a second run), matching the report.

1. **Cache-invalidation throw after a successful delete still returns success, no leak.** The handler now
   splits the secret call and the cache calls into two separate inner `try/catch` blocks
   (`auth-rpc.handlers.ts:~1305-1318`). `providerModels.clearCache`/`invalidateAuthStatusCache` throwing is
   caught, logged as `logger.warn('RPC: auth:deleteStoredKey cache invalidation failed')` — a fixed string,
   no error object, no key value or path — and the handler still returns `{ success: true }`. Confirmed by
   reading the diff and by the new spec `returns { success: true } even if cache invalidation throws after
   successful key deletion` (`:400-421`), which seeds a real provider key, forces
   `providerModels.clearCache` to throw, and asserts both the `{success:true}` result and the exact warn-log
   call. This is a genuine fix, not a report claim taken on faith: the inner cache `try` is now provably
   disjoint from the secret-deletion `try` that precedes it, so a throw there can no longer overwrite an
   already-successful deletion's result.
2. **Every invalid `providerId` returns the fixed `'Unknown provider id'` text.** The handler no longer
   reads `parsed.error.issues[0]?.message`; on any `safeParse` failure it now returns the literal string
   unconditionally (`auth-rpc.handlers.ts:~1288-1294`). Confirmed for both the pre-existing "unknown id"
   case (`:292-308`, `result.error` now asserted with `.toBe('Unknown provider id')` rather than
   `.toContain`) and the new empty-string case (`:310-326`). Checked whether collapsing every schema failure
   into one message could mislead about a *different* kind of malformed request: `AuthDeleteStoredKeySchema`
   validates exactly one field, `providerId: z.string().min(1).refine(...)`, and the object schema is not
   `.strict()`, so extra/unknown keys are silently ignored rather than rejected. Every possible `safeParse`
   failure for this schema — missing `providerId`, non-string `providerId`, empty string, or an
   id absent from the merged registry — is definitionally "the given/missing provider id is not a usable
   one." There is no other failure class this schema can produce, so the fixed text is accurate for 100% of
   its rejection paths, not just a convenient generalisation that happens to hide something else. No
   misleading collapse found.
3. **No other regression.** The three-tier structure (outer `try` → schema parse → secret-op `try/catch` →
   cache `try/catch` → return) preserves every Round 1 guarantee: no `sdkAdapter.reset()` call anywhere in
   the branch (still asserted at `:328-345`), the Anthropic/provider secret-key split is untouched, the
   absent-key idempotency path is untouched (`:423+`), and the secret-store rejection paths still return the
   fixed `'Could not delete the stored key.'` text without leaking the caught error (`:347-385`). The two
   Round 1 minor items (no direct assertion that `invalidateAuthStatusCache` incremented its counter; no
   type-mismatch-shape test beyond empty string) remain open but were not in scope for this round's fix and
   are not reintroduced defects.

Updated score: **9/10** (both moderate findings closed with direct evidence; only pre-existing minor
observability gaps remain, unchanged from Round 1).

## Scope

- Diffs reviewed (via `git diff -- <path>`, worktree left untouched):
  - `libs/shared/src/lib/types/rpc/rpc-auth.types.ts` (+`AuthDeleteStoredKeyParams`/`Result`)
  - `libs/shared/src/lib/types/rpc.types.ts` (registry entry + `RPC_METHOD_ENTRIES`)
  - `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.schema.ts` (`AuthDeleteStoredKeySchema`)
  - `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts` (`registerDeleteStoredKey`, METHODS/debug list)
- New file read in full: `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.delete-stored-key.spec.ts` (395 lines, 9 specs)
- Supporting source read: `libs/backend/vscode-core/src/services/auth-secrets.service.ts:180-310` (setCredential/deleteCredential/deleteProviderKey), `libs/backend/auth-providers/src/lib/provider-models.service.ts:1049-1055` (`clearCache`), `auth-rpc.handlers.ts:660-675` (`invalidateAuthStatusCache`), the three host DI registrations (`apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:69`, `apps/ptah-electron/src/di/phase-4-handlers.ts:93`, `libs/backend/cli-engine/src/lib/container.ts:800`), and the test doubles (`auth-secrets-service.mock.ts`, `rpc-handler.mock.ts`).
- Cross-checked against `batches.md` "## Batch 7" (lines 450-491), `implementation-plan.md:290-332` (Component 4, D4), `batch-6-report.md` and `batch-6-code-logic-review.md` (carry-forward persist-rejection finding).
- Ran myself: `npx nx test @ptah-extension/rpc-handlers --testFile=auth-rpc.handlers.delete-stored-key.spec.ts` → **9 passed, 9 total** (7.2s), matching the report.
- `ptah_get_diagnostics` timed out (background TS check still warming); not blocking given the spec run above type-checks the same files through ts-jest and passed.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 2        |

## Five logic questions

### 1. How does this fail silently?

No case where the RPC reports success while the key survives. One narrow inverted case exists: the
secret deletion succeeds, but a *subsequent, unrelated* statement throws before the handler returns
`{success:true}` — the outer `try/catch` (`auth-rpc.handlers.ts:1274-1339`) wraps `providerModels.clearCache`
and `invalidateAuthStatusCache` in the same block as the secret call, so a throw there is reported to the
caller as `{success:false, error:'Could not delete the stored key.'}` even though the key is already gone
on disk. Both callees are synchronous `Map` operations (`provider-models.service.ts:1049-1055`,
`auth-rpc.handlers.ts:666-675`) that do not throw in the code as written, so this is a low-probability path,
not a demonstrated bug — flagged as a moderate finding below because a client retrying on `success:false`
would re-issue an already-idempotent delete, which is harmless, but a *user-facing* "delete failed" toast
would be wrong.

### 2. What user action produces unexpected behaviour?

None found. Deleting the active Anthropic key, a provider key, or an already-absent key all behave as
specified (verified below in Data flow). Deleting the Anthropic key does not touch `authMethod` storage or
call `sdkAdapter.reset()` — confirmed both from the diff (no such calls exist in `registerDeleteStoredKey`)
and from `setCredential`/`deleteCredential` in `auth-secrets.service.ts:192-229`, which only call
`this.context.secrets.store`/`.delete`.

### 3. What input data produces a wrong answer?

An empty-string `providerId` fails Zod's `.min(1)` check before reaching the custom `.refine`, so its error
message is Zod's default ("String must contain at least 1 character(s)") rather than the fixed
`'Unknown provider id'` text the plan and the other four rejection specs assume. The handler still returns
`{success:false, error:<that message>}` — no crash, no key leak, just a different (still safe, still
generic) string than the rest of the suite pins. Not exercised by any of the 9 specs. Minor, not moderate:
no value or path ever appears in that message either.

### 4. What happens when a dependency fails?

Handled correctly and pinned by two specs (`auth-rpc.handlers.delete-stored-key.spec.ts:329-367`). Both
`setCredential` and `deleteProviderKey` rejections are caught by the inner `try/catch`
(`auth-rpc.handlers.ts:1298-1306`), logged with `logger.error('...secret deletion failed')` — deliberately
without the caught error's message or stack, per the comment "Secret-store errors can carry credentials;
discard their details" — and converted to the fixed `{success:false, error:'Could not delete the stored
key.'}`. This directly closes the Batch 6 carry-forward finding (`electron-secret-storage.ts:108-112`: a
`persist()` rejection propagating as a throw from `delete()`), since `deleteProviderKey`/`deleteCredential`
sit directly on top of `context.secrets.delete`, which resolves to `ElectronSecretStorage.delete` on the
Electron host.

### 5. What is missing that the requirements never mentioned?

- No spec exercises the empty-string `providerId` path (finding above) or a `providerId` that is a
  non-string (e.g. `null`/number) sent over the wire — Zod would reject it with a type-mismatch message,
  still generic, still safe, just untested.
- `invalidateAuthStatusCache()` is not asserted directly by any Batch 7 spec (only `providerModels.clearCache`
  is, at `:369-380`); it is exercised implicitly (the function runs without throwing) but no spec asserts the
  cache generation actually bumped. Low risk — the call site is a one-line, unconditional invocation
  identical to every other mutating handler in this file.

## Failure modes

### Inverted success signal if cache invalidation throws after a real delete

- Trigger: `providerModels.clearCache(providerId)` or `invalidateAuthStatusCache()` throws after the secret
  store has already deleted the key.
- Symptom: caller receives `{success:false, error:'Could not delete the stored key.'}` while the key is in
  fact gone; a UI that shows "delete failed" and re-offers the action is misleading (though a retry is safe,
  since delete is idempotent).
- Evidence: `auth-rpc.handlers.ts:1274-1339` — the outer `try` spans both the secret call and the two cache
  calls; only the secret call has a scoped inner `try/catch`.
- Current handling: none; both callees are synchronous Map operations that do not throw today.
- Recommendation: move `clearCache`/`invalidateAuthStatusCache` inside (or after) the same inner try that
  already isolates the secret call, or accept the current ordering explicitly in the report since neither
  callee can presently throw. Moderate, not blocking.

### Zod's `.min(1)` message diverges from the fixed `'Unknown provider id'` text for empty string

- Trigger: `providerId: ''` sent to `auth:deleteStoredKey`.
- Symptom: `{success:false, error:'String must contain at least 1 character(s)'}` instead of the documented
  fixed error text.
- Evidence: `auth-rpc.schema.ts` — `.string().min(1).refine(...)`; `.min(1)` short-circuits before `.refine`
  runs.
- Current handling: none; not tested.
- Recommendation: minor — no security or data exposure impact (no value/path in the message either way);
  worth a one-line spec or a `.refine` that also excludes empty string with the same message, for
  consistency with the four other rejection cases.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate — `auth-rpc.handlers.ts:1274-1339`: cache-invalidation calls share the outer try/catch with the
  secret-deletion call, so a (currently theoretical) throw from `clearCache`/`invalidateAuthStatusCache`
  after a successful delete is reported as `success:false`. See failure mode above.
- Minor — `auth-rpc.schema.ts`: empty-string `providerId` produces Zod's default message instead of the
  fixed `'Unknown provider id'` text; untested, no security impact.
- Minor — no spec asserts `invalidateAuthStatusCache` was actually invoked (only `providerModels.clearCache`
  is asserted); low risk given the call is unconditional and one line.

## Data flow

1. RPC message `auth:deleteStoredKey` arrives at whichever host's shared `RpcHandler` — OK. All three hosts
   (`apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:69`, `apps/ptah-electron/src/di/phase-4-handlers.ts:93`,
   `libs/backend/cli-engine/src/lib/container.ts:800`) register `AuthRpcHandlers` as a DI singleton and call
   its single shared `register()` method, which now also calls `registerDeleteStoredKey()`
   (`auth-rpc.handlers.ts:289-291`). There is no separate per-host registration list to miss — confirmed by
   grep across all three DI phase files; the check the batch-7 report and the review brief both call for is
   satisfied by construction, not by a duplicated list.
2. Zod validation (`AuthDeleteStoredKeySchema.safeParse`, `auth-rpc.handlers.ts:1283`) — OK for
   `'anthropic'` and any id resolved by `getAnthropicProvider(id)` (merged registry, call-time lookup,
   matching the existing `AuthSettingsSchema.anthropicProviderId` pattern exactly). Gap: empty string (see
   Minor finding above).
3. Branch on `providerId === 'anthropic'` (`:1298-1302`) — OK: routes to `setCredential('apiKey','')` for the
   Anthropic slot (`ptah.auth.anthropicApiKey`) vs `deleteProviderKey(id)` for `ptah.auth.provider.<id>`
   (confirmed disjoint secret-key namespaces at `auth-secrets.service.ts:198,256-257,301`). No cross-talk.
4. Secret-store call — OK: `setCredential`/`deleteCredential`/`deleteProviderKey` only call
   `context.secrets.store`/`.delete`; none read or write any auth-method or SDK-adapter state
   (`auth-secrets.service.ts:192-229,300-310`, read in full). Confirms plan requirement D4 ("no
   `sdkAdapter.reset()`, no auth-method rewrite") holds at every layer, not just at the RPC handler.
5. Secret-store rejection — OK: caught by the inner `try/catch` (`:1298-1306`), mapped to the fixed error
   text, no error detail logged or returned. This is the direct fix for the Batch 6 carry-forward
   (`electron-secret-storage.ts:108-112`).
6. Cache invalidation (`providerModels.clearCache(providerId)`, `invalidateAuthStatusCache()`) — OK on the
   happy path; theoretical gap noted above (Moderate finding) if either throws.
7. Absent-key idempotency — OK: `ElectronSecretStorage.delete` (and the VS Code SecretStorage equivalent)
   early-return without a `persist()` call or `onDidChange` when the key is already absent (per Batch 6's
   review), and the handler never waits on a change event — it only awaits the promise the secret call
   returns, so absence resolves to `{success:true}` regardless. Spec `:382-394` pins this.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Contract type in shared RPC types (`AuthDeleteStoredKeyParams/Result`) | COMPLETE | None |
| Registered in `RpcMethodRegistry` + `RPC_METHOD_ENTRIES` | COMPLETE | None |
| Registration reaches every host (VS Code, Electron, CLI) | COMPLETE | Single shared `register()`, called from all three DI containers — verified by grep, not assumed |
| Deleting Anthropic key does not rewrite auth method or reset SDK | COMPLETE | Verified at both the handler and the `AuthSecretsService` layer |
| Provider keys vs Anthropic key kept in separate slots | COMPLETE | Disjoint secret-key namespaces confirmed |
| Unknown/invalid provider id rejected, fixed error, no value/path leaked | PARTIAL | Empty-string id produces a different (still safe) message than the documented fixed text; not tested |
| No key value or path in any error or log | COMPLETE | Inner catch discards error detail entirely; outer catch only occurs on non-secret failures |
| Failed persist returns `{success:false,error}` | COMPLETE | Two dedicated specs, one per call site (Anthropic slot, provider slot) |
| Absent key → success, no wait on change event | COMPLETE | Handler never subscribes to `onDidChange`; spec pins idempotent absence |
| Specs exercise the real handler, not a mock of the unit under test | COMPLETE | `createMockRpcHandler` records real closures and dispatches through `handleMessage`; `createMockAuthSecretsService` is a faithful in-memory double of the dependency, not the RPC handler itself |

Implicit requirements not addressed: cache-invalidation failure isolation (Moderate finding above); empty-
string provider-id message consistency (Minor finding above).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Delete Anthropic slot | YES | `setCredential('apiKey','')`, spec `:256-272` | None |
| Delete provider slot | YES | `deleteProviderKey(id)`, spec `:274-290` | None |
| Unknown provider id | YES | Schema refine rejects before any secret call, spec `:292-308` | Empty string gives a different message (Minor) |
| SDK reset suppression | YES | Spec `:310-327` asserts `reset` never called across both branches | None |
| Secret-store rejection (Anthropic) | YES | Spec `:329-347` | None |
| Secret-store rejection (provider, e.g. Electron persist failure) | YES | Spec `:349-367`, closes Batch 6 carry-forward | None |
| Cache invalidation | YES (partial) | `providerModels.clearCache` asserted `:369-380`; `invalidateAuthStatusCache` only exercised, not asserted | Minor — no direct assertion |
| Absent-key idempotency | YES | Spec `:382-394` | None |
| Cache-invalidation throwing after a successful delete | NO | N/A | Moderate — see failure mode above |
| Concurrent deletes for the same providerId | NO | N/A | Low risk (idempotent delete + in-process secret-store serialization); not proven by a test, same open item Batch 6's review left forward |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking — the two moderate/minor findings are narrow, low-probability, and neither leaks a
  credential or misreports a security-relevant outcome; they affect only a rarely-hit success/failure signal
  and one error-message string.
- What a robust implementation would add: (1) scope the cache-invalidation calls under the same
  failure-isolated block as the secret call, or add a one-line note accepting the current ordering; (2) a
  spec for empty-string `providerId` so the fixed-error-text guarantee is pinned for every rejection path,
  not just the four covered today; (3) a direct assertion that `invalidateAuthStatusCache` incremented its
  generation counter, mirroring the existing `providerModels.clearCache` assertion.
