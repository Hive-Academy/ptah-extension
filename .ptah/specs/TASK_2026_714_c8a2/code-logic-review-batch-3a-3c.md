# Code Logic Review — TASK_2026_714_c8a2 Batches 3a and 3c

Review family: Claude reviewer, Codex implementer.
Commits: 1d54771db (3a), c6925a95f (3c). Scope: libs/backend/auth-providers.
Evidence run: scoped jest on codex-home-auth.service, codex-auth.service, auth-manager, codex-proxy-policy specs: 4 suites, 131 tests pass. (Passing specs do not cover finding 1; they only seed "Chatgpt".)

## Verdict: REVISE — 4.5/10

Blocking 1, Serious 2, Moderate 3, Minor 2.

## Findings

### 1. BLOCKING — Zod `auth_mode` enum rejects the real auth.json; Codex proxy path reports "unauthenticated"
- File: libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:21-23 (schema), :712 and :762 (`authFileSchema.parse`).
- The old code cast `JSON.parse(raw) as CodexAuthFile` (no runtime check). The new schema is `auth_mode: z.enum(['ApiKey','Chatgpt','ChatgptAuthTokens'])`. Current Codex writes lowercase `"chatgpt"`. I ran the exact schema against the real `~/.codex/auth.json` on this machine: `safeParse` fails with `auth_mode: Invalid option`. The repo's own codex-cli.adapter.tokens.spec.ts:50 also uses `auth_mode: 'chatgpt'`, and codex-cli.adapter.ts:308 types it `| string`.
- Effect: `readAuthFile` returns null, so `isAuthenticated()` is false, `getHeaders()` throws "Not authenticated", `listModels()` is `[]`, `getTokenStatus()` is `{authenticated:false}`, `ensureTokensFresh()` is false, and the refresh path can never persist (`readAuthFileFromDisk` null). Every live Codex proxy user with a normal ChatGPT login loses Codex. The log line is only "Failed to read auth file: unavailable" (the cause is hidden, so it is hard to diagnose).
- Fix: `auth_mode: z.string().optional()` (compare as today), and make the tolerant fields `.nullable().optional()` (`account_id`, `last_refresh`, `api_base_url`, token fields) since the file is written by an external tool. Prefer `safeParse` on only the fields the service uses, with `.passthrough()` kept so write-back preserves unknown keys. Add a spec seeded with lowercase `chatgpt` and with a null `account_id`.

### 2. SERIOUS — `failedRefreshToken` permanently disables refresh after any transient failure
- File: codex-home-auth.service.ts:546-549 (and field :553).
- Old: every `ensureTokensFresh()` retried the refresh. New: any `false` from `performRefresh` (network down, DNS, timeout, HTTP 5xx, as well as invalid_grant) records the refresh token; later calls return false without trying until the token changes on disk or the process restarts. The comment justifies it only for an "ambiguous rotating-token response", but it is applied to failures where nothing was sent. Offline at expiry once means the Codex proxy stays dead until the user runs `codex login` or restarts. This is a behavior regression on the live path.
- Fix: only latch when the failure happened after the request was accepted (HTTP 4xx invalid_grant/reused, or persist failure after a 2xx). Do not latch on ECONNREFUSED/ENOTFOUND/timeout/5xx. Alternatively expire the latch after a backoff (e.g. 60 s).

### 3. SERIOUS — A refresh whose persist step is rejected loses the rotated tokens without surfacing it
- File: codex-home-auth.service.ts:588 and :612-621.
- The server has rotated the refresh token before `persistRefreshedTokens` runs. If the on-disk file changed (`Auth changed during refresh`) the new tokens are dropped, which is acceptable only if the other writer holds valid ones. But the same throw fires when `readAuthFileFromDisk` returns null (malformed/partial JSON mid-write by codex, schema reject as in finding 1). The old token is then dead server-side and nothing was saved. The log claims a plain refresh failure and then latches (finding 2).
- Fix: on a null disk read, retry once after a short delay, and log a distinct "refresh succeeded but could not be persisted" warning. Do not latch silently.

### 4. MODERATE — Strict parse changes behavior for any unexpected-but-harmless file shape
- File: codex-home-auth.service.ts:21-38.
- `tokens.*` fields typed `z.string().optional()` reject `null`; any single bad field disqualifies the whole credential (all-or-nothing). Old code tolerated these. Same root cause as finding 1; fixing 1 should cover it.

### 5. MODERATE — AuthManager now throws for a context whose provider differs from the non-thirdParty auth method
- File: libs/backend/auth-providers/src/lib/auth/auth-manager.ts (configureAuthentication: `throw new Error('Auth operation provider does not match auth method')`).
- A host that passes `{providerId:'openai-codex', hostNativeCodex:true}` while settings still hold e.g. `apiKey` gets a thrown plain Error instead of the `native-return` result. The native-return policy is evaluated only after this check. No caller passes a context yet (sdk-agent-adapter.ts:568/617 and the agent-sdk port auth-env.port.ts:17 omit it), so this is latent. Evaluate the policy first, or document that hosts must align authMethod.

### 6. MODERATE — `native-return` leaves an existing legacy Codex proxy and Claude env in place
- File: auth-manager.ts doConfigureAuthentication early return (before the teardown block); codex-proxy-policy.ts.
- Intended ("leave the shared Claude environment alone"), but switching a session from the legacy proxy to native Codex does not stop the proxy or clear ANTHROPIC_BASE_URL set earlier. Confirm this is the designed hand-off (clearAuthentication() by the host) and add a spec for the switch case.

### 7. MODERATE — `CodexHomeAuthService.forHost` WeakMap keeps the first caller's logger
- File: codex-home-auth.service.ts:64-80. A second facade/host with the same workspaceProvider but a different logger logs through the first. Low impact until 5c registers a singleton.

### 8. MINOR — Zod error thrown raw
- auth-manager.ts: `authOperationContextSchema.parse(context)` throws a ZodError whose message embeds input (home path). No secrets, but not a coded error. Acceptable for an internal API.

### 9. MINOR — Tests do not exercise real file shape
- codex-home-auth.service.spec.ts / codex-auth.service.spec.ts seed only `'Chatgpt'`/`'ApiKey'`; add real-world fixtures (finding 1).

## Checks that came out clean

- Home resolution: old resolver was `override || CODEX_HOME || resolve(homedir(),'.codex')`; new is `resolve(trim(CODEX_HOME) || join(homedir(),'.codex'))`. Both use `os.homedir()` (HOME on POSIX, USERPROFILE on Windows), same as before; no HOME-vs-USERPROFILE change. Differences: whitespace-only or padded CODEX_HOME is now trimmed/ignored (benign). Facade keeps explicit injected homes (codex-auth.service.ts:36-39). No default-home change for existing users.
- Public API of CodexAuthService: all 9 ICodexAuthService methods plus start/stopWatching delegate with the same return types. Callers checked: provider-auth-resolver.ts:314-315, provider-proxy-pool.ts:659-660, oauth-proxy.strategy.ts:58-66,173-187, auth-status-probes.ts:144, interactive-login-methods.ts:233, connection-check.ts:187-188, provider-rpc.handlers.ts:398, cli-model-list.service.ts:154. None break at the type or call level.
- Events: old emitted `authFileChanged` on external change and suppressed self-writes; facade filters `refreshed` and emits for `changed`/`removed` (codex-auth.service.ts:72-79). Equivalent. Watcher now closes on error (improvement); facade re-arms via the idempotent start.
- Secrets in logs: none. Logs were reduced (error messages and custom endpoint URL no longer logged). No token content logged.
- Concurrency per home: `refreshInFlight` spans read through rename (:516-530), per `HomeAuthState`, one state per resolved home path (`entry()` keys on `resolve(home)`); no cross-home state sharing. Temp file is unique with `wx` and 0600 and is unlinked in `finally`; rename atomic. Abort affects only the waiter (:97-113).
- AuthManager with no context: key collapses to `[authMethod, providerId, null, null, false]`, so identical concurrent calls share one flight as before; policy returns `legacy-strategy`; `operationContext` is omitted from strategy ctx. Different concurrent keys now queue serially (`then(run, run)`) instead of the old behavior of returning the first call's result for any args; this is stricter and I see no deadlock (no re-entrancy; rejections handled by both branches; `finally` clears the key and `configInProgress`). Provider/intent are captured at submission.
- Zod boundary on the context is applied before use; default `hostNativeCodex=false`.

## Five logic questions (short)
1. Silent failure: schema reject of valid real file is logged as "unavailable" (finding 1); persist reject after server rotation (3).
2. User action: being offline at token expiry kills Codex until restart/re-login (2).
3. Input data: lowercase `auth_mode`, null fields (1, 4).
4. Dependency failure: OAuth endpoint 5xx/timeout is treated as permanent (2).
5. Missing: a spec with a real auth.json shape; a policy-switch teardown spec (6).

## Verdict
REVISE. Fix 1 and 2 before this goes further; they change live behavior of the Codex translation proxy. 3c is sound for the default path.
