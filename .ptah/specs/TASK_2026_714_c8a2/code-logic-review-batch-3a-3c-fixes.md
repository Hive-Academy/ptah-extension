# Code Logic Review — Batches 3a/3c fixes (revise round 1)

Review family: Claude reviewer, Codex implementer. Scope: uncommitted `git diff -- libs/backend/auth-providers` (3d strategy files excluded).

## Verdict: APPROVED — 8/10

Evidence: jest on providers/codex + auth specs (integration spec excluded): 24 suites, 557 tests pass. Degradation audit: `auth-providers: 19 ok (baseline 24)`. Real-file schema check: PASS (no values printed).

## Status of earlier findings

1. Blocking (auth_mode enum): FIXED. codex-home-auth.service.ts:20-37 now has `auth_mode: z.string().nullable().optional()` and all token fields nullable. I re-ran the new schema against this machine's real `~/.codex/auth.json`: pass=true; top-level keys `auth_mode, OPENAI_API_KEY, tokens, last_refresh`; token keys `access_token, refresh_token, id_token, account_id`. An ApiKey file with `tokens: null` also parses.
2. Serious (permanent latch): FIXED. The latch is set only in the catch of performRefresh (codex-home-auth.service.ts ~627-640) when HTTP 401, or 4xx with body `error: invalid_grant`. Network errors, timeouts, 5xx and 429 do not latch. It is cleared on any successful token response. `checkAndRefresh` (line ~567-581) compares against the latch only for the same refresh token.
3. Serious (rotated tokens lost): FIXED. A successful response is kept in `pendingPersist` and `readAuthFile` serves it (so `getHeaders` keeps working even if the disk write fails). `retryPendingPersist` tries twice, 25 ms apart, merges onto the current disk file, and runs again at the start of every `ensureTokensFresh` (`checkAndRefresh` first line). An external login (different refresh token or API key) drops the pending tokens. A sanitized warning is logged when persistence stays unavailable.
4. Moderate (strict parse): FIXED with 1.
5. Moderate (policy ordering / native teardown): FIXED. The mismatch check is skipped for `native-return` (auth-manager.ts ~139-141) and now throws `SdkError` rather than `Error`. In `doConfigureAuthentication`, native-return returns early only if there is no active strategy; otherwise the previous strategy is torn down and then it returns `configured:false`. The spec at auth-manager.spec.ts:961 covers legacy to native to legacy; 808 covers teardown.
6. Moderate (forHost logger): PARTLY FIXED, see N1 below.
7. Minor (raw ZodError): FIXED, now `SdkError('Invalid auth operation context')` with no input echo.
8. Minor (real-shape tests): the lowercase `chatgpt` fixture and nullable cases are now covered in the updated specs, and I confirmed the real file passes.

## New findings

- N1 Minor, codex-home-auth.service.ts:~72-107: `forHost` adds every distinct caller logger to a per-provider Set that is never removed. If the facade is constructed with fresh logger objects repeatedly (tests, re-created containers), lines are duplicated and loggers are retained for the provider's lifetime. Harmless in production (one container logger, deduped by Set), but note it for 5c when the owner becomes a DI singleton.
- N2 Minor, codex-home-auth.service.ts readAuthFile: while `pendingPersist` is set, every `readAuthFile` re-reads auth.json from disk (the cache is bypassed). Only active during a persistence failure, so the cost is bounded.
- N3 Minor, performRefresh catch (~line 627): the warning logs only the HTTP status. For network failures (no status) it logs nothing about the cause (`error.code` such as ECONNABORTED/ENOTFOUND is credential-free and would help users).

## Degradation-audit suppressions (7 comments, no executable change)

| Site | Decision |
| --- | --- |
| isAuthenticated catch returns false (~line 380) | Acceptable. Fail-closed probe; `readAuthFile` already logs the underlying read failure. |
| listModels catch returns [] (~line 470) | Intended degrade, but not truly "reported": a network error, a TLS failure or a non-OK response (`!response.ok` returns [] too) leaves no trace. Pre-existing behavior (old code identical), so I do not block, but add a `logger.debug('[CodexAuth] Model discovery unavailable')` (no URL or token) so a 401 or outage is diagnosable. Recommended before 5c, not required now. |
| ensureTokensFresh `.catch` (~line 553) | Acceptable. Warns, returns false per contract; cause omitted on purpose. |
| performRefresh catch (~line 623) | Acceptable. Warns with status; latch rules are explicit. See N3. |
| readAuthFile catch (~line 811) | Acceptable. Missing file is debug-logged, other failures warn. Suggest logging zod issue paths (keys only) to avoid another finding-1-style invisible failure. |
| readAuthFileFromDisk catch returns null (~line 860) | Acceptable. Callers handle null (retry then warn in retryPendingPersist; readAuthFile keeps pending tokens). |
| unlink catch in persistRefreshedTokens (~line 690) | Acceptable. Best-effort cleanup that must not mask the write result. |

None of the suppressions hides a defect that must be fixed now; listModels (above) is the only one where the "reported" claim does not hold, and it is recommended, not blocking.

## Remaining uncertainty
Not exercised against a live OAuth endpoint; the `invalid_grant`/401 classification is inferred from standard OAuth responses. Cross-process contention with a running `codex` CLI is covered only by the refresh-token compare, not by a file lock.
