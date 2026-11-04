# Code Logic Review — TASK_2026_864_1376, Phase B bounded correction

Reviewer: independent (different family). Read-only; no checks were run.

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED (with Moderate/Minor residuals, none blocking) |
| Blocking / Serious / Moderate / Minor (new) | 0 / 0 / 1 / 2 |

## Closure table

| Finding | Closed? | Evidence |
| --- | --- | --- |
| N1 (Serious) Check again cannot clear banner holding a failure line | CLOSED | `chat-view.component.ts:1380-1384` effect no longer gates on `codexReauthFailure`; it re-runs `completeCodexReauth()` (`:292-309`). That method reads `codexSignIn.confirmation()` and the auth signals synchronously inside the effect, so each service transition (`checking` -> `confirmed`/`failed`, `codex-sign-in.service.ts:132-147`) retriggers it. The `checking` branch clears the failure line, and `confirmed` plus authenticated and not stale clears the failure, the banner and the started flag. Block "Check again" calls `service.checkAuthStatus()`, so the path is connected end to end. |
| N2 (Moderate) double refresh / two sources of truth | CLOSED | Chat no longer calls `refreshAuthStatus()`. The only read is `CodexSignInService.checkAuthStatus` (`:131-148`), guarded by `refreshing` against concurrent reads. The chat banner and the block derive from the same `confirmation` signal. Resets on `launch` (`:59-61`) and on any non-`succeeded` status (`:114-118`) prevent stale `confirmed` leaking into a new attempt. `onAuthReauth` sets `codexReauthStarted` before `start()`, but `start()` resets `confirmation` synchronously before the effect flush, so a stale `succeeded`/`confirmed` cannot clear the banner early. |
| N3 (Moderate) can clear an unrelated banner | CLOSED for the stated case | `completeCodexReauth` requires `authRequiredBanner() === codexReauthBanner` (`:293`), and the effect checks the same (`:1383`). Dismiss nulls the captured banner and the started flag (`:386-390`). A later different-provider banner is a different object, so it is not touched. Covered by the spec "does not clear a later unrelated banner". |

## New findings

### M-1 (Moderate): object-identity banner match strands a legitimately refreshed Codex banner
- `chat-view.component.ts:293,1383`. If a second failed send re-sets the Codex banner (a new object with the same provider) while sign-in is in flight, identity no longer matches. `completeCodexReauth` returns early and the effect never clears or reports. `codexReauthStarted` stays true. The user finishes sign-in successfully, Codex is authenticated, yet the banner and the embedded block stay until they click Try again or dismiss. This is the safe direction (it wrongly keeps a banner rather than wiping one), but it is a silent stuck state. Fix: compare `providerId === 'openai-codex'` plus the captured `message`, or refresh the capture when the banner is re-set.

### m-1 (Minor): two "Try again" controls and a divergent message
- `chat-view.component.html:158-161` adds a chat-level "Try again" (restarts OAuth) next to the block's own Try again/Check again. When `confirmation === 'confirmed'` but Codex is still unauthenticated or stale, the block shows no failure (`refreshFailed` is false) while chat shows "still not ready". That is a mild disagreement of the kind N2 was meant to remove, but both are now derived from one read, so it is consistent in data and only slightly confusing in copy.

### m-2 (Minor): tests drive a re-implemented service stub
- `chat-view.component.spec.ts` (`codexCheckAuthStatusMock`) reimplements the service's confirmation transitions in the harness. The N1/N2/N3 chat tests therefore prove chat-view's reaction to the signals, not the real service wiring. The real transition logic is covered separately by `codex-sign-in.service.spec.ts` ("exposes a failed confirmation and retries the auth read"). Together this is adequate, but there is no integration test of the two. The test sets `codexAuthenticatedSig` by hand rather than via a real refresh.

## Other checks (no defect)
- `checkAuthStatus` catches rejections and maps them to `failed`, so no unhandled rejection or endless spinner. The `generation` guard drops stale results, and `launch` resets `refreshing`, so the in-flight guard cannot stay stuck after a restart.
- The effect writes signals and reads only synchronous signals in `completeCodexReauth`. No new listeners or timers are added, so there is no disposal gap.
- Not verified: no tests or diagnostics were run. The report says diagnostics timed out.
