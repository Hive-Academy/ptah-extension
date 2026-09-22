# TASK_2026_523 batch A2 — draft connection verification (backend report)

Branch: `feat/task-2026-523-a2-draft-verification` (worktree
`D:\projects\ptah-extension\.claude-worktrees\task-523-a2-draft-verification`).

## Files changed

- CREATED `libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts` —
  the draft probe service (`DraftVerificationService.verify` / `cancel`) plus the
  exported pure classifier `classifyDraftProbeFailure` with input type
  `DraftProbeFailureInput`.
- MODIFIED `libs/shared/src/lib/types/rpc/rpc-auth.types.ts` — `ProbeFailureReason`
  union (9 members, docblock names the classifier and the ten-rule precedence),
  `AuthVerifyDraftConnectionParams`, `AuthVerifyDraftConnectionResult`,
  `AuthCancelDraftVerificationParams`, `AuthCancelDraftVerificationResult`.
- MODIFIED `libs/shared/src/lib/types/rpc.types.ts` — imports of the four DTOs,
  two `RpcMethodRegistry` entries, two `RPC_METHOD_ENTRIES` boolean entries.
- MODIFIED `libs/backend/auth-providers-tokens/src/lib/tokens.ts` —
  `SDK_DRAFT_VERIFICATION: Symbol.for('SdkDraftVerification')` with docblock
  (lines 13–18). Note: this token was first written by the duplicate peer lane
  and adopted here — see Merge notes.
- MODIFIED `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts` —
  `DraftConnectionInput` interface (line 77), `buildDraftOverride(draft):
  Promise<OneShotAuthOverride>` (line 516), public `buildLaneEnv(values: AuthEnv)`
  (line 479). Never returns null; throws `ProviderQuotaError` (cooldown gate) or
  `ProviderAuthError` (draft cannot produce a credential for the mode).
- MODIFIED `libs/backend/auth-providers/src/lib/di/register.ts` —
  `registerAuthProvidersServices` now registers BOTH
  `AUTH_PROVIDERS_TOKENS.SDK_DRAFT_VERIFICATION` and
  `SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER` (Singleton).
- MODIFIED `libs/backend/auth-providers/src/index.ts` — barrel export of
  `DraftVerificationService`, `classifyDraftProbeFailure`, `DraftProbeFailureInput`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts` —
  METHODS entries, constructor injection, two `register*` calls in `register()`,
  debug `methods` array, `registerVerifyDraftConnection()` /
  `registerCancelDraftVerification()`.

NOT touched (verified): `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`
(the auth entry `key:'auth', methods: AuthRpcHandlers.METHODS` auto-propagates the
new names; `assertManifestInvariants` covers the union partition). Also not
touched: `ALLOWED_METHOD_PREFIXES` (rpc-handler.ts:44, `auth:` already present),
`auth:testConnection`, `file-settings-keys.ts`, `skill-enhancer.service.ts`,
`effective-route.ts`, anything under `libs/frontend/`, and no `node_modules`
operation of any kind.

## Contract

Two new RPC methods, registered by `AuthRpcHandlers.register()` alongside the
existing auth family:

- `auth:verifyDraftConnection`
  - params: `AuthVerifyDraftConnectionParams` — `probeId` (client-generated, echoed
    back), `providerId`, `authMode` ('apiKey' | 'oauth' | 'cli' | 'local-native' |
    'local-proxy' | 'custom'), transient `credential? {kind:'apiKey'; value}`,
    `baseUrl?`, `model?`, `timeoutMs?`.
  - result: `AuthVerifyDraftConnectionResult` — `{probeId, outcome
    'verified'|'failed'|'cancelled', reason: ProbeFailureReason | null, detail:
    string | null, latencyMs: number | null, modelUsed: string | null, checkedAt}`
  - failure surface: the handler rethrows only for genuine internal errors
    (invalid params, DI failure). Every probe-level outcome — including failed and
    cancelled probes — is a normal result; `reason` + sanitized `detail` carry it.
    `latencyMs` and `modelUsed` are `null` when the probe never started (pre-flight
    failure).
- `auth:cancelDraftVerification`
  - params: `{probeId}`; result: `{cancelled: boolean}`.
  - Never throws. Unknown or already-settled probeId answers `{cancelled:false}`.
    Required because the transport carries no per-request cancel token.

Safety properties (all in `draft-verification.service.ts`):

- The probe exercises the DRAFT only: `ProviderAuthResolver.buildDraftOverride`
  assembles the per-call `auth` override from the draft itself; it is passed as
  `InternalQueryConfig.auth` (read-only per-call snapshot) to
  `InternalQueryService.execute`. The persisted route is never read for the probe
  credential and nothing is written to disk, secrets, settings or `process.env`.
- The draft credential lives in the override handed to the runner only. It is
  never stored on an entry, logged, echoed back, or persisted.
- `detail` is sanitized: it is built from fixed copy plus safe facts only
  (providerId, HTTP status, Node socket code, retryAfterMs, model id,
  timeoutMs). A raw secret, an `Authorization` header, a full request URL, and a
  raw `error.message` never appear in it. Error messages are read internally only
  for rule 5's model-name match, inside `classifyDraftProbeFailure`.
- Probe lifetime: one entry per in-flight probe in `Map<probeId, entry>`; deleted
  on settle by IDENTITY (`entries.get(probeId) === entry`), the same idiom as the
  handler's `statusInFlight` finally. Supersession (re-issued probeId) retires the
  old entry. Hard cap 32 in flight, oldest dropped (insertion order). 60 s lazy
  TTL prune (no timers), backstop only. Per-probe deadline via `AbortController` +
  unref'd timer, server-side clamp 1 000–30 000 ms, default 15 000 ms.
- Probe run shape: `cwd: os.tmpdir()`, `maxTurns: 1`,
  `prompt: 'Reply with the single word: ok'`, `lane: USER_ACTION_QUERY_LANE` (never
  governed), `queueTimeoutMs: 5 000` (queue wait beyond that throws
  `InternalQueryQueueTimeoutError` → unclassified, "runtime was busy"), stream
  iterated to the `result` message then `break` (the guarded stream releases the
  slot; matches every repo caller, no explicit `close()`).
- Model fallback chain: draft `model` → `ProviderModelsService.getLiveDerivedTiers(providerId).sonnet`
  → `getAnthropicProvider(providerId)?.defaultTiers?.sonnet` → `'sonnet'`.
- DI: `DraftVerificationService` injects `TOKENS.LOGGER`,
  `AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS`, `SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER`,
  `SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE`. Host wiring:
  `registerAuthProvidersServices` registers both `SDK_DRAFT_VERIFICATION` and
  `SDK_PROVIDER_AUTH_RESOLVER`; `registerCuratorAuthServices` keeps registering the
  resolver (Electron/CLI then register it twice — same class, Singleton, harmless).
  This is load-bearing because VS Code calls ONLY
  `registerAuthProvidersServices` (apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:148)
  and never calls `registerCuratorAuthServices`, so a resolver token left only in
  the curator path would crash `AuthRpcHandlers` resolution on VS Code.

## Classification

`classifyDraftProbeFailure(input: DraftProbeFailureInput): ProbeFailureReason` —
exported, module-level, pure. Ten rules, evaluated in order, first match wins:

1. `input.cancelled` → `'cancelled'`.
2. thrown error `name === 'ProviderQuotaError'` → `'quota-exhausted'`
   (name-based discrimination per the documented convention, not `instanceof`).
3. `name === 'ProviderAuthError'` → `'credential-rejected'`.
4. `status = resultStatus ?? httpStatusFromThrown(thrown) ??
   httpStatusFromAssistantError(assistantError)`: 401 → `'credential-rejected'`,
   403 → `'permission-denied'` (read directly, deliberately bypassing the network
   classifier, which ignores 401/403).
5. 404, or a provider message naming the model (`messageNamesModel`: cause-chain
   walk over thrown errors plus `assistantError` string) → `'model-unavailable'`.
6. classifier signal `'http-429'` → `'rate-limited'`, where
   `signal = classifyThrownNetworkFailure(thrown) ?? streamSignal(verdict)`.
7. `input.timedOut` or signal `'timeout'` → `'timeout'`. Positioned after 429 so a
   429 seen before the deadline wins over the deadline itself.
8. signal `'connection'` or `'dns'` → `'unreachable'`.
9. signal `'http-5xx'` → `'unclassified'` (a 5xx is NEVER a credential verdict).
10. otherwise → `'unclassified'`.

Inputs: `thrown` (the stream/pre-flight error), `verdict` (`QueryNetworkVerdict`
from `QueryNetworkObserver` fed with the full stream, cast-free — every SDKMessage
is assignable to `NetworkObservableMessage`), `resultStatus` (the stream's
`result.api_error_status`, captured separately because the observer folds raw
evidence away), `assistantError` (last `assistant.error`), `cancelled`, `timedOut`,
`model`. Cause-chain walks (`status`/`statusCode`/`code`/message) are all
depth-bounded at 8 (`MAX_CAUSE_DEPTH`), matching the classifier's own bound.
`verdict.kind === 'answered'` with no throw and no flags is the only path to
`outcome: 'verified'`.

Sanitized detail per reason (fixed copy + safe facts only):
- pre-flight quota: cooldown copy, optional `(retry after Ns)`;
- pre-flight auth: "missing a usable credential for this mode";
- 401/403: "rejected the credential (HTTP 401)" / "denied access (HTTP 403)";
- model-unavailable: "does not offer ${model}";
- rate-limited: "rate-limited the probe (HTTP 429)";
- timeout: "did not answer within ${timeoutMs} ms";
- unreachable: "Could not reach the provider endpoint" + optional `(${socketCode})`;
- unclassified: `SdkError` → "runtime is not available; save the draft settings
  first", `InternalQueryQueueTimeoutError` → "runtime was busy; the probe never
  started", status ≥ 500 → "unexpected error (HTTP N)", else "ended without a
  verifiable answer";
- cancelled: "The probe was cancelled." Logging: debug at start (ids, mode,
  timeoutMs), info at finish (reason, latencyMs). Never the credential, never
  error messages.

## Merge notes

The plan/brief name `RpcMethodMap`; the actual interface is `RpcMethodRegistry`
(libs/shared/src/lib/types/rpc.types.ts:654) and the boolean table is
`RPC_METHOD_ENTRIES` (line 3393). Both were edited under their real names. Lane A
edits the same three places — hand-merge the following exact added lines:

1. `RpcMethodRegistry` entries (added after `'auth:clearWorkspaceOverride'`,
   before `'setup-status:get-status'`, rpc.types.ts:832-839):

```ts
  'auth:verifyDraftConnection': {
    params: AuthVerifyDraftConnectionParams;
    result: AuthVerifyDraftConnectionResult;
  };
  'auth:cancelDraftVerification': {
    params: AuthCancelDraftVerificationParams;
    result: AuthCancelDraftVerificationResult;
  };
```

2. `RPC_METHOD_ENTRIES` entries (added after `'auth:clearWorkspaceOverride': true,`,
   before `'setup-status:get-status': true,`, rpc.types.ts:3453-3454):

```ts
  'auth:verifyDraftConnection': true,
  'auth:cancelDraftVerification': true,
```

3. `AuthRpcHandlers.METHODS` entries (added after `'auth:clearWorkspaceOverride'`,
   before the `satisfies readonly RpcMethodName[]` clause, auth-rpc.handlers.ts):

```ts
    'auth:verifyDraftConnection',
    'auth:cancelDraftVerification',
```

4. rpc.types.ts type imports (added after `AuthClearWorkspaceOverrideResult`):

```ts
  AuthVerifyDraftConnectionParams,
  AuthVerifyDraftConnectionResult,
  AuthCancelDraftVerificationParams,
  AuthCancelDraftVerificationResult,
```

Duplicate-lane event and reconciliation: a peer session was assigned the same
batch A2 against the same worktree and edited files concurrently. Its duplicate
DTO set and its duplicate synchronous `buildDraftOverride` were deleted in favour
of the versions here; its DI token (`SDK_DRAFT_VERIFICATION`) was kept as the
single token, and it fixed `provider.name ?? providerId` →
`provider?.name ?? providerId` in the resolver (`getAnthropicProvider` answers
`undefined` for a draft custom-entry id). It wrote no service, no registration,
no handler changes, and ran no checks. Final state is the reconciled one above;
the token docblock and the resolver fix are its surviving contributions.

Batch A overlap: this branch does NOT contain batch A. No
`auth:getEffectiveRoute`, no `ConfigScopeRpcHandlers`, no `SCOPED_SETTING_KEYS`,
no `EffectiveRouteProvider`/`EffectiveRouteResult`/`SettingScope` was added or
promoted here. `resolveEffectiveAuthRoute` and `effective-route.ts` remain
untouched in their current location and shape.

## Verification

Environment: `NX_DAEMON=false` for every command; `node_modules` untouched
(junction to the main install).

Typecheck:

```
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/auth-providers-tokens @ptah-extension/auth-providers @ptah-extension/rpc-handlers
```

First run: FAILED — 1 error, `TS2366` at
`draft-verification.service.ts:553` (`probeDetail` switch did not cover
`'quota-exhausted'`). Fixed by adding the case (with a comment that the reason
cannot reach the stream path but the switch must stay exhaustive). Re-run:
**4/4 successful** (`Run duration: 33.0s`, `Cache: 0/4 hit`).

Lint:

```
npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/auth-providers-tokens @ptah-extension/auth-providers @ptah-extension/rpc-handlers
```

Result: **Successfully ran target lint for 3 projects**
(@ptah-extension/shared, @ptah-extension/auth-providers,
@ptah-extension/rpc-handlers). `@ptah-extension/auth-providers-tokens` has no
`lint` target — Nx printed "do not have a configuration for any of the provided
targets" for it; not applicable, not a failure.

No tests were added or run: the batch text did not assign a spec file, and no
`DraftVerificationService` spec exists. The pure classifier is exported
specifically so a follow-up spec can exercise the ten-rule table directly.

## Deviations

- Naming drift from the plan: `RpcMethodMap` → `RpcMethodRegistry`
  (rpc.types.ts:654) and the boolean table cited as :3439 is `RPC_METHOD_ENTRIES`
  at :3393 (entries now at :3453-3454). Documented in Merge notes; no
  `ALLOWED_METHOD_PREFIXES` change.
- `SDK_PROVIDER_AUTH_RESOLVER` is additionally registered in
  `registerAuthProvidersServices` (plan listed only `SDK_DRAFT_VERIFICATION`
  there). Reason in source comment: VS Code never calls
  `registerCuratorAuthServices`, the only prior registrant, so a hard injection
  into `DraftVerificationService` would have broken the whole auth RPC family on
  VS Code. Double registration on Electron/CLI is a harmless no-op.
- `InternalQueryService.execute` is called with `mcpServerRunning: false` — the
  field exists on `InternalQueryConfig` (verified) and keeps the probe free of
  MCP startup.
- The classifier additionally reads `assistantError` (the stream's last
  `assistant.error`) for rule 4's status and rule 5's model match. The
  `QueryNetworkObserver` folds raw evidence away (a 401 result yields
  `'undetermined'` because 401 is not network-class), so the service captures its
  own stream evidence in parallel with feeding the observer; without this, a 401
  on the stream path would classify as `unclassified` instead of
  `credential-rejected`.

## Not done

- No frontend work of any kind (`libs/frontend/` untouched).
- No changes to `auth:testConnection` or any existing auth method.
- No `ALLOWED_METHOD_PREFIXES` change.
- No batch-A artifacts added or promoted.
- No tests, no git staging/commit/push — the working tree is left dirty for the
  orchestrator to merge and commit.
- No `npm install` / `npm ci`; `node_modules` untouched.

## Clarifications Needed

None — not blocked.