# Code Logic Review — D9 12d-2 (TASK_2026_714_c8a2)

Read-only review. No tests, lint or typecheck were run (prohibited); the verdict rests on static reading.

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVED with minor fixes (0 blocking, 0 serious, 2 moderate, 3 minor) |

## What was checked

- **Claude path.** `session-history-router.ts` `readSessionHistory` and `readSessionEvents` still pass `options` and the legacy call straight through when the session has no `codexExecution` with runtime `codex-app-server`. The result shape is unchanged. `ChatHistoryReadService` only adds a try/catch that rethrows the original error when `nativeHistoryRpcError` returns null (`chat-history-read.service.ts` `throw nativeHistoryRpcError(error) ?? error`). Claude behaviour is unchanged.
- **VS Code and CLI.** The port is null, so a native session gets `nativePortUnavailable`, mapped to `HISTORY_UNAVAILABLE`. A Claude session there never reaches the native path. This is an explicit coded error, not an empty success.
- **Error mapping.** The service maps every Electron port code (`busy`, `pathUnavailable`, `timeout`, `cancelled`, `runtimeFailed`, `binaryUnavailable`, `homeMismatch`, `threadNotFound`, `invalidIdentity`). It also maps the router codes `nativePortUnavailable`, `invalidNativeIdentity` and `nativeReadFailed`. Messages are fixed strings, so no native text or path reaches the response.
- **Unknown native errors.** The router `nativeHistory` and `projectHistory` collapse them to `nativeReadFailed`, and an unknown Electron code falls back to `HISTORY_FAILED`. The spec covers an unknown error carrying `D:\secret`.
- **Resume path.** `chat-session.service` `resumeSession` catch turns `RpcUserError` into `{success:false, error, errorCode}`. `codexFailure` (chat-session.service.ts:913) only matches Codex adapter errors, so it does not intercept these. The frontend resume branch (`session-loader.service.ts:~1160`) throws with the safe `error` text.
- **Older-page path.** `chat:history-page` rethrows other typed errors. `chat-rpc.handlers.ts:~314-325` handles only the stale and invalid cursor cases and passes the rest through.
- **Paging.** The router returns the same event list that `resolveHistoryCursorEndIndex` and `selectHistoryPage` consume, so the cursor logic is shared with Claude. The spec round-trips a base64url `h1:` cursor and asserts `[...older, ...tail] == full`. Block owners are not returned natively; the native result carries only `events` and `stats`. See M2.
- **session:load and session:validate.** Untouched.
- **DI census.** Adding `SESSION_HISTORY_ROUTER` to the Electron `EXPECTED_RESOLVABLE_TOKENS` and the VS Code `EXPECTED_RUNTIME_TOKENS` is consistent with the lane report's claim that `register.ts` already registers the router. I did not re-verify the registration itself.

## Frontend question: older-page errors

This is not a silent failure. `history-paging.service.ts:86-91` returns `'failed'` for any `!result.success`, and `chat-view.component.ts:~310-314` shows `showActionError('Could not load earlier messages. Please try again.')`. The user sees a generic, provider-neutral message. The specific `HISTORY_*` text is not shown. That is acceptable: no Codex special case, no leak, and the user can retry. `HISTORY_BUSY` and `HISTORY_TIMEOUT` are therefore handled by a manual retry, which fits their "Try again" intent.

A later nice-to-have is surfacing `result.error`. That is not required for this batch.

## Findings

### Blocking
None.

### Moderate

- **M1.** `session-history-router.ts` has three bare `catch {}` blocks: normalize-key failure, the `nativeHistory` catch, and the `projectHistory` catch. They convert the failure to a coded error and discard the original cause and any log. Repo rules require a `// degradation-audit:` marker on swallowing catches. There is also no log line, so a `nativeReadFailed` or projection failure cannot be diagnosed from the host logs. Fix: add the markers and log the sanitized error name, not its message, in the service or router.
- **M2.** Native history has no `includeBlockOwners` or `syntheticToolResults` equivalent. The router's native branch drops `options`, so `chat:resume` with `historyBlockOwners: true` gets none for native sessions. The 12d-2 requirement says to preserve block-owner semantics. If the projector never needs owners this is fine, but it is undocumented and untested at the RPC layer. The new spec passes `includeBlockOwners: true` and only checks events and stats. Confirm that the frontend treats `blockOwners` as optional (`result.blockOwners ?? new Map()` in chat-session.service.ts suggests yes), and note it explicitly.

### Minor

- **m1.** `nativeHistoryRpcError` uses `mapped[code] ?? mapped.nativeReadFailed` on a plain object literal. A code like `constructor` or `toString` would hit the prototype, so `result[1]` is undefined and the `RpcUserError` message is undefined. Codes come from closed sets, so this is unlikely. Use a `Map` or `Object.hasOwn`.
- **m2.** `ElectronCodexHistoryError` is detected by `error.name` string matching, which is brittle and not type-safe. Importing the class into rpc-handlers is not possible across layers, so a shared type guard on the code would be better.
- **m3.** Each older page re-reads and re-projects the full native thread: `native.readHistory` is called twice in the spec, once for resume and once per page. That is acceptable for correctness, since the cursor is derived from root user ids and a changed thread yields `HISTORY_CURSOR_STALE`, but it is a cost per page. Note it for the release gate.
- **m4.** The spec constructs `ChatHistoryReadService` with `as never` casts. The `reflect-metadata` import, branded `SessionId.from` and win32-aware home path are present, so the spec is meaningful. The `as never` casts are a mild strictness smell. No `any` was found.

## Five logic questions (short)

1. **Silent failure.** None found. Native failures always throw a coded error. See M1 for the lost diagnostics.
2. **User action.** Scrolling to older history on a busy or timed-out native read shows the generic retry message. This is OK.
3. **Wrong answer.** The native branch ignores `includeBlockOwners` (M2). Nothing else.
4. **Dependency failure.** Port errors, a missing port and projection exceptions are all mapped. `metadata.get` rejection is unchanged from before.
5. **Missing.** Logging of sanitized failure causes. A frontend test for the `HISTORY_*` codes was not required.

## Verdict
APPROVE after M1 (add degradation-audit markers and a sanitized log). M2 should be documented or confirmed at the release gate. Confidence: MEDIUM, because nothing was executed.

## Re-review (fixes and fixes2)

Static read only; nothing was executed.

- **Claude, VS Code and CLI:** no behaviour change. The legacy delegation in `session-history-router.ts` is unchanged except that the reader now comes from `this.getLegacy()`. The null-port path still throws `nativePortUnavailable`, which maps to `HISTORY_UNAVAILABLE`.
- **Lazy getters (`register.ts:315-316`):**
  - The router itself is still `instanceCachingFactory`-cached.
  - The metadata store and legacy reader are resolved on each read. Both are singleton registrations (`register.ts:260,307`), so repeated resolves return the same instance and are cheap.
  - Construction no longer resolves `SessionMetadataStore`, which fixes the eager-resolve smoke failure. A missing registration would now surface at the first read as a raw error, not at startup. That is acceptable, and the DI census still checks resolvability.
- **Cause handling (M1 resolved):** every router catch now passes the original error as `{ cause }` to `SessionHistoryRouteError` (`session-history-router.ts` catch blocks). Nothing is swallowed. The user-facing path is `nativeHistoryRpcError`, which builds a fresh `RpcUserError` from a fixed message table and never copies `cause`, `message` or the stack. The resume catch logs `error.message` of that mapped error only, so raw native text and paths stay out of both responses and logs. Remaining note: the cause is retained but nothing logs it, so diagnosis still needs a debugger or a Sentry hook. This is minor.
- **m1 resolved:** the lookup now uses `Object.hasOwn(mapped, code)` with a `nativeReadFailed` fallback. The logger types are narrowed to `Pick<Logger,'warn'>`, which is harmless.
- **`codex-runtime-composition.ts`:**
  - The `cancelled.catch(() => undefined)` observer now has a `degradation-audit:` marker. That is valid because the race owns cancellation and the observer only prevents an unhandled rejection.
  - The `scope.dispose()` catch no longer carries a marker, but it logs through `deps.logger.error` and does not swallow. The `finally` ordering is unchanged, so the read outcome is neither masked nor replaced by a disposal failure.
  - 12d-1 semantics are intact: the `ElectronCodexHistoryError` mapping, the `activeReads--` finally, and the timer and abort cleanup are untouched.
- **Residual (M2):** block owners for native sessions are deferred to the release gate. The coordinator has accepted this, and the frontend tolerates their absence.

Score: 8/10. Verdict: APPROVED. 0 blocking, 0 serious, 1 minor (unlogged cause), M2 deferred. Confidence: MEDIUM, because it was not run.
