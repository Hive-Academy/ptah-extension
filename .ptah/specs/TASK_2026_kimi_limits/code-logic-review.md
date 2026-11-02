# Code Logic Review — `TASK_2026_kimi_limits`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Verdict | APPROVE WITH FIXES |
| Blocking issues | 0 |
| Serious issues | 2 |
| Minor issues | 1 |
| Failure modes found | 3 |

The fixed endpoint matches Ptah's Kimi provider host and one official Kimi host. The reader keeps credential owners separate and prevents redirects. The main-session owner path does not use the new shared Kimi resolver. The contradiction guard also rejects some valid responses.

## Five logic questions

### 1. How does this fail silently?

A main session that uses Kimi OAuth receives an unknown provider-key owner. The reader then returns `service-unavailable` before HTTP. The user sees no current plan limits even though the shared OAuth credential works.

- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:743-748`
- `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts:92-97`

The failure is fail-closed. It does not attribute one credential's usage to another owner.

### 2. What user action produces unexpected behaviour?

The user opens plan limits for a main Kimi OAuth session. The selected-provider card can work, but the session-specific owner cannot be read.

A user can also lose all four windows when the response has positive legacy usage and one unrelated zero window. The code treats every zero window as contradictory.

- `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts:124-126`

### 3. What input data produces a wrong answer?

A response with positive `usage.used` and an unused monthly-code window is valid under the distinct-window model. The reader rejects the complete response.

Malformed legacy values such as `usage.used: null`, `usage.used: ''`, or `usage.used: false` pass through `z.coerce.number()` as zero. This violates the malformed-value requirement and can disable the contradiction guard.

- `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts:24`
- `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts:124-126`

### 4. What happens when a dependency fails?

The reader handles the main dependency failures without secret exposure:

- A failed lane-slot read returns `service-unavailable` and does not use the shared credential (`kimi-code-plan-usage.reader.ts:73-83`).
- A credential or owner mismatch returns before HTTP (`kimi-code-plan-usage.reader.ts:92-97`).
- OAuth 401 or 403 triggers one forced refresh and one retry (`kimi-code-plan-usage.reader.ts:113-120`).
- Network errors, timeouts, malformed JSON, invalid schemas, and non-success responses return `service-unavailable` (`kimi-code-plan-usage.reader.ts:120-135`).
- Redirects use `redirect: 'error'` (`kimi-code-plan-usage.reader.ts:103-111`).
- The service logs only the provider id and error name when a reader throws (`plan-usage.service.ts:363-370`).

The eight-second controller covers both HTTP attempts. It starts after credential selection. The outer snapshot and lane deadlines remain separate.

### 5. What is missing that the requirements never mentioned?

The main-session `ownerForSession` branch needs the same Kimi shared-connection rule as selected-provider discovery. The new tests cover selected providers and lanes, but they do not cover a Kimi main session.

Live acceptance of a stored Kimi API key by `/usages` remains unverified. The implementation notes disclose this limitation. No authenticated live request ran during this review.

## Findings

### Serious — Main Kimi sessions bypass shared-connection owner resolution

- **File:** `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:743-748`
- **Failure scenario:** A Kimi OAuth main session has `routeKind: 'proxy'` and `providerId: 'kimi-code'`. `ownerForSession` calls `ownerForProviderKey('kimi-code')`. With no provider API key, it returns an unknown owner. The reader selects OAuth but requires a `cli-store` owner at `kimi-code-plan-usage.reader.ts:92-97`. It returns `service-unavailable` without a request.
- **Impact:** Main-session plan limits stay unavailable for the standard OAuth configuration. Selected-provider and lane paths can work for the same login, so the UI is inconsistent.
- **Concrete fix:** Route the Kimi proxy case through `ownerForKimiCode()`. Keep the Codex branch unchanged. Add owner-resolver tests for Kimi OAuth and API-key proxy sessions. Add one session-discovery test that reaches an available reader result.

### Serious — The contradiction guard rejects unrelated zero windows

- **File:** `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts:124-126`
- **Failure scenario:** The response contains positive `usage.used`, nonzero five-hour and weekly ratios, and `limit_month_code.used_ratio: 0`. Monthly-code is a distinct allowance and can be unused. `some(entry => entry?.used_ratio === 0)` rejects the whole response.
- **Impact:** A valid response becomes `service-unavailable`. The user loses all current windows and receives only stale or ledger evidence.
- **Concrete fix:** Encode only the evidenced legacy-field contradiction. Do not infer that positive legacy usage contradicts every zero window. Add a test with positive legacy usage and an unrelated zero monthly-code window. Keep the known contradictory weekly case as a rejection test.

### Minor — Legacy and ratio parsing diverges from the boundary contract

- **File:** `libs/backend/auth-providers/src/lib/quota/readers/kimi-code-plan-usage.reader.ts:11-12,24`
- **Failure scenario:** `z.coerce.number()` converts `null`, an empty string, and `false` to zero. The response passes validation instead of failing as malformed. The ratio regex also rejects finite numeric strings such as `.5` and `1e-1`, which the official client's `Number(value)` conversion accepts.
- **Impact:** Some malformed responses pass, and some valid official responses fail closed.
- **Concrete fix:** Replace coercion with an explicit finite-number or numeric-string schema. Align numeric-string acceptance with the official conversion and retain the 0-to-1 range check. Add tests for `null`, empty strings, booleans, `.5`, and exponent notation.

## Data flow

1. **Selected-provider discovery — OK.** Kimi calls `ownerForKimiCode()` at `plan-limit-owner-discovery.service.ts:435-437`.
2. **Lane discovery and lookup — OK.** Enabled Kimi lanes call `ownerForPtahCli` at `plan-limit-owner-discovery.service.ts:597-610` and `lane-limit-lookup.service.ts:252-260`.
3. **Main-session discovery — GAP.** `ownerForSession` uses the provider-key path for every non-Codex proxy at `provider-owner.resolver.ts:743-748`.
4. **Read-plan construction — OK.** Kimi lane targets carry `ptah-cli-key`; main targets use shared auth at `plan-owner-read.ts:168-178`.
5. **Credential selection — OK.** A real direct lane key wins. Missing and placeholder slots use shared auth. Failed slot reads do not fall back at `kimi-code-plan-usage.reader.ts:72-91`.
6. **Owner re-check — OK.** API keys must match the credential fingerprint. OAuth must match the Kimi home's CLI-store owner at `kimi-code-plan-usage.reader.ts:92-97`.
7. **HTTP — OK.** The URL is fixed, headers contain only Bearer and Accept, redirects fail, and the request has an abort signal at `kimi-code-plan-usage.reader.ts:99-121`.
8. **Parsing — PARTIAL.** Zod validates required windows and optional monthly entries. The contradiction and coercion issues remain at `kimi-code-plan-usage.reader.ts:11-24,122-126`.
9. **Cache and fallback — OK for owner-safe targets.** `PlanUsageService` caches by owner key and retains stale evidence only for that owner at `plan-usage.service.ts:377-420`.

## Requirements fulfilment

| Requirement | Status | Evidence or gap |
| --- | --- | --- |
| Official endpoint | COMPLETE | `kimi-code-plan-usage.reader.ts:9` uses `https://api.kimi.ai/coding/v1/usages`. The pinned official client defines both `api.kimi.com/coding/v1` and `api.kimi.ai/coding/v1`, then appends `/usages`. Ptah's provider base is `https://api.kimi.ai/coding/` at `kimi-code-provider-entry.ts:123-142`. |
| Custom base URL safety | COMPLETE | The reader never reads a configured base URL and never sends credentials to it. It always uses the fixed official URL at `kimi-code-plan-usage.reader.ts:9,103`. |
| Owner separation and race checks | PARTIAL | Direct, shared-key, and shared-OAuth checks are fail-closed in the reader. Main-session owner resolution is missing. |
| Token safety | COMPLETE | Bearer and Accept are the only headers. Redirects fail. Reader catches do not log errors. Service logs contain only provider id and error name. |
| Parsing and window mapping | PARTIAL | Required windows, optional monthly entries, reset parsing, and percentage bounds exist. Contradiction and malformed legacy handling need fixes. |
| Discovery, lane lookup, spawn ownership, and DI | PARTIAL | Selected-provider, lane, spawn, and shared DI wiring exist. Main-session wiring is incomplete. |
| Electron, VS Code, and CLI hosts | COMPLETE for the changed shared registration | `register-providers.ts:111-122` binds the existing Kimi auth singleton. `di/register.ts:335-347` passes it to plan usage. The implementation notes record passing VS Code and CLI host tests and typechecks. |
| Focused tests | PARTIAL | Tests cover the reader, selected provider, lanes, spawn ownership, and Electron DI. They miss the main-session path and the false-rejection case. |
| Project rules | COMPLETE in the changed code | No new `any`, `@ts-ignore`, or `as unknown as` appears in the new reader or changed production code. Cross-library imports use public package entry points. The reader does not log. Other services use injected loggers. |

## Edge cases

| Case | Handled | Evidence | Concern |
| --- | --- | --- | --- |
| Direct lane key | YES | `kimi-code-plan-usage.reader.ts:72-76,93-97` | Fingerprint mismatch stops HTTP. |
| Missing or placeholder lane slot | YES | `kimi-code-plan-usage.reader.ts:78-84` | Shared auth is used only after a successful slot read. |
| Failed lane-slot read | YES | `kimi-code-plan-usage.reader.ts:76-77` | No shared fallback. |
| Shared provider key | YES | `kimi-code-plan-usage.reader.ts:93-96` | Owner fingerprint must match. |
| Shared OAuth login | PARTIAL | `provider-owner.resolver.ts:488-503` | Main sessions do not reach this resolver. |
| OAuth 401 or 403 | YES | `kimi-code-plan-usage.reader.ts:113-120` | One refresh and one retry. |
| Optional monthly entries | YES | `kimi-code-plan-usage.reader.ts:17-23,44-47` | Absent entries stay absent. |
| Contradictory zero | PARTIAL | `kimi-code-plan-usage.reader.ts:124-126` | The check is broader than the evidence. |
| Malformed legacy usage | NO | `kimi-code-plan-usage.reader.ts:24` | Coercion accepts null, empty, and boolean values. |
| Reset timestamps | YES | `kimi-code-plan-usage.reader.ts:13-16,53-56` | Empty values are absent. Invalid datetime strings fail. |
| Percentage bounds | YES | `kimi-code-plan-usage.reader.ts:11-12,50` | Values outside 0 to 1 fail before clamping. |
| Timeout and cancellation | YES | `kimi-code-plan-usage.reader.ts:99-102,134-139` | Timer and listener are released in `finally`. |
| Redirect | YES | `kimi-code-plan-usage.reader.ts:109` | Fetch rejects the redirect. |

## Verification

The allowed command ran:

```text
npm run verify -- -p auth-providers -t test -- --testPathPatterns=kimi-code
```

Result: 90 suites passed, one failed, and one skipped. The run recorded 2515 passed tests, four failed tests, and ten skipped tests. All four failures were `EPERM` during temporary-directory cleanup in `translation-proxy.sdk.integration.spec.ts`. The Kimi suites did not fail. This is the same unrelated Windows cleanup blocker disclosed in `implementation-notes.md`.

The official client check used `MoonshotAI/kimi-code` commit `a2afdbc7d1fa0737d45d5780cc6c2bd38e477b55`, file `packages/oauth/src/managed-usage.ts`. The Ptah symbol index returned zero hits for the DI token query, so one native text search checked the token registrations.

## Verdict

- **Recommendation:** APPROVE WITH FIXES
- **Confidence:** HIGH
- **Top risk:** Main Kimi OAuth sessions cannot obtain plan limits because their owner uses the provider-key path.
- **Required before merge:** Fix main-session owner resolution and narrow the contradiction guard. Add the corresponding regression tests.
- **Recommended parser fix:** Replace legacy coercion and add malformed-value and numeric-string boundary tests.
