# Fix report: reset or Stop between chat:start and the session binding

Scope: `libs/frontend/mcp-apps-page/src` only. No page component change. No `innerHTML`. No existing assertion was changed.

## Defect

When `chat:start` had already resolved successfully but the surface's session binding had not yet arrived, `sessionFor()` returned null. In that window:

- `resetConversation()` discarded the slice without calling `chat:abort`. The agent kept running as an orphan and its surface updates were dropped.
- `abort()` (Stop) returned early and did nothing. It had the same gap.

The case where `chat:start` is still in flight is a different path. `abortUnownedStart` handles it, and its behaviour is unchanged.

## Fix (file:line, all under `libs/frontend/mcp-apps-page/src/lib/services/`)

1. **The recorded start id.** The slice has a new field, `apps-workspace-slice.ts:70` `startedSessionId: SessionId | null`. It defaults to null at `:93`, so `discard()`, a failed start, a workspace removal or drop, and a new conversation all clear it: each of them replaces the slice or removes it.
2. **It is set on a successful start.** See `apps-session.service.ts:259-272`. The id is `result.data?.sessionId ?? (conversation.routingId as SessionId)`, the same expression the unowned-start abort uses, and it is now computed once for both branches:
   - If the slice is no longer owned, the call goes to `abortUnownedAppsStart` as before.
   - If it is owned and `sessionFor()` is still null, the id is recorded through `patchOwned`.
   - If the binding already arrived, nothing is recorded.
3. **The reset target.** `resetConversation()` (`:380-404`) captures the slice before any await and calls `runningSessionOf(slice)` (`:575-588`). That returns the bound head session, or else `slice.startedSessionId`, but only while a turn is pending or that session's liveness status is live. For the bound case this is the same test as the old `isProcessing()` check. Everything else is unchanged:
   - the target is captured before the await;
   - a failed abort keeps the conversation and sets the notice;
   - ownership is re-checked after the await;
   - `markIdle` runs on success.
4. **Stop.** `abort()` (`:351-371`): **yes, it had the gap**. The target is now `sessionFor(...) ?? slice.startedSessionId`. On success it clears `pendingTurn` and `startedSessionId` and calls `markIdle`. On failure it takes the existing `failTurn` path, and the id is kept so a later reset can still stop the agent.
5. **Clearing the id without aborting twice.** The pending-turn effect (`apps-session.service.ts:205-221`) now applies the pure `settleAppsSlice` (`apps-workspace-slice.ts:195-216`):
   - **The binding arrives:** `startedSessionId` is set to null and the bound session takes over. The pending-turn rule for a bound session is unchanged.
   - **The turn ends before the binding:** once liveness reports the started session in a status that is not live (`idle` or `failed`), both `startedSessionId` and `pendingTurn` end.
   - **Stop succeeds:** the id is cleared, so a later reset does not abort again.
   - **Precedence:** Stop and reset always check `sessionFor()` first, so an id that has not been cleared yet is never used once the binding exists.
6. **Moves made to stay at or under 700 lines, with no behaviour change:**
   - `abortUnownedStart` became `abortUnownedAppsStart` in `apps-session-rpc.ts:39-53`. It logs the same messages.
   - `sessionFor` moved to `AppsConversationClaims.sessionFor` (`apps-conversation-claims.ts:48-58`), together with its `TabSessionBinding` and `ConversationRegistry` injections. The claim step already owns the surface's conversation binding.
   - `isLiveAppsStatus` (`apps-workspace-slice.ts:183`) replaces the inline live-status test in `isProcessing`.

A note on the reset condition: after a Stop that fails before the binding, `failTurn` clears `pendingTurn`, as it already did. A later reset then aborts the recorded id only if liveness reports that session as live. This is the "pending turn or live status" condition the brief specified.

## New specs

They are in `apps-session.service.spec.ts:845-942`, in the describe block "stop between chat:start and the session binding". The start result is `{ success: true, sessionId: 'host-session' }` and there is no binding.

| # | Spec | Proves |
|---|------|--------|
| 1 | "New conversation" aborts the session chat:start returned, then discards | `chat:abort` is called with `host-session`, `markIdle` runs, the slice is discarded and the inbox released |
| 2 | a failed abort keeps the conversation and shows the notice | the abort goes to `host-session`, no `markIdle`, the conversation and claim are kept, and the notice is `APPS_RESET_KEPT_NOTICE + " Reason: Agent busy."` |
| 3 | Stop aborts the started session (routing-id fallback) once; a reset after it does not abort again | Stop sends `chat:abort` with the routing id, the id is cleared, and the reset sends no second abort |
| 4 | once the binding arrives, Stop and reset use the bound session and abort once | the effect clears the id, only `session-1` is aborted, and it is aborted exactly once |
| 5 | a reset right after the binding arrives aborts the bound session, not the started one | `sessionFor` wins over an id that has not been cleared yet |
| 6 | drops the started session once liveness reports its turn ended; a reset then aborts nothing | the id is cleared when the turn ends, and the reset sends no `chat:abort` |

The existing in-flight specs are unchanged and still green: `aborts a successful pending start after %s ...` (×3) and `keeps a newer slice unchanged when late-start abort fails by %s` (×2). So are the page-level specs in `apps-page-conversation.spec.ts` for New conversation, including the abort-failure one and "no chat:abort when no turn is running".

## Red/green evidence

For each check, one source hunk was changed on a scratch copy, the session spec was run, and the file was restored byte-for-byte (confirmed with `cmp`). No git command was used.

- **RED C:** in `runningSessionOf`, `?? slice.startedSessionId` replaced with `?? null`. 2 failed / 37 passed. Failures: spec 1 and spec 2.
- **RED B:** in `abort()`, `?? slice.startedSessionId` replaced with `?? null`. 1 failed / 38 passed. Failure: spec 3.
- **RED A:** `start()` records `startedSessionId: null` instead of the id. 4 failed / 35 passed. Failures: specs 1, 2, 3 and 6.
- **RED D:** `settleAppsSlice` never clears `startedSessionId`. 2 failed / 37 passed. Failures: spec 4 and spec 6.
- **GREEN:** all four files restored. 39 passed / 39 total.

## Test counts

- `apps-session.service.spec.ts`: 39 tests, 6 of them new.
- Session spec plus `apps-page-conversation.spec.ts`: 46 passed.
- Whole lib: 16 suites, **286 passed / 286 total**.

## Verification tails

```
npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page --skip-nx-cache
√  nx run @ptah-extension/mcp-apps-page:test
√  nx run @ptah-extension/mcp-apps-page:lint
√  nx run @ptah-extension/mcp-apps-page:typecheck
NX  Successfully ran targets lint, typecheck, test for project @ptah-extension/mcp-apps-page
Test Suites: 16 passed, 16 total
Tests:       286 passed, 286 total
(lint: no warnings or errors printed)
```

```
npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit   (8 errors, all baseline)
libs/frontend/core/src/testing/mock-rpc-service.ts(54,16)
libs/frontend/core/src/testing/mock-rpc-service.ts(60,24)
libs/frontend/core/src/testing/mock-rpc-service.ts(66,25)
libs/frontend/core/src/testing/mock-rpc-service.ts(69,25)
libs/frontend/git-ui/src/lib/services/monaco-loader.service.ts(113,23)
libs/frontend/git-ui/src/lib/services/monaco-loader.service.ts(151,24)
libs/frontend/git-ui/src/lib/services/monaco-loader.service.ts(171,41)
libs/frontend/git-ui/src/lib/services/monaco-loader.service.ts(187,28)
```

No webview build was run.

## Line counts (`wc -l`)

| File | Lines |
|------|-------|
| `services/apps-session.service.ts` | 698 (was 695) |
| `services/apps-workspace-slice.ts` | 236 (was 190) |
| `services/apps-session-rpc.ts` | 53 (was 37) |
| `services/apps-conversation-claims.ts` | 107 (was 87) |
| `services/apps-session.service.spec.ts` (spec) | 942 (was 840) |

## Follow-on (a)

This follows Recommendation (a) in `code-logic-review-fix-reset-binding-antigravity.md`, which approved the fix at 9/10. The host's `chat:abort` returns `{ success: true }` for running, idle and unknown sessions (`chat-rpc.handlers.ts:274-281` → `chat-session.service.ts:967-1011` → `session-control.service.ts:160-171`), so an abort before the binding is always safe.

### Change

`libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:575-588`, in `runningSessionOf`:

- **Before the binding** it now returns `slice.startedSessionId` without any condition. It no longer checks for a pending turn or a live status.
- **After the binding** it still returns the bound session only while a turn is pending or its status is live. This is unchanged.

The rest is also unchanged:

- The failed-abort notice path in `resetConversation()` (`:380-404`) is the same.
- The recorded id is still cleared when the binding arrives and when the turn ends (both in `settleAppsSlice`), on a successful Stop, and on discard or dispose (the slice is replaced or removed).
- Nothing is aborted twice. The "Stop ... does not abort again" spec and the "turn ended ... aborts nothing" spec both still pass.

This closes the residual named above: a Stop that fails before the binding clears the pending turn and liveness never reports the session, yet a reset now still aborts the recorded id.

### New spec

`apps-session.service.spec.ts:931`, "after a failed Stop with no liveness report, a reset still aborts the started session, then discards". The sequence is:

1. Stop's `chat:abort` fails.
2. The pending turn is null and `startedSessionId` is still `host-session`.
3. No liveness status is ever set.
4. `resetConversation()` resolves true. `chat:abort` has gone to `['host-session', 'host-session']`, once from the failed Stop and once from the reset. `markIdle('host-session', '/ws-a')` runs once. The slice is discarded and the inbox is released.

No existing spec was changed.

### Red/green

- **RED:** the pre-binding branch (`:585`) was replaced on a scratch copy with the old gated form (`pendingTurn !== null || live ? startedSessionId : null`). Result: 1 failed / 39 passed. The failure was the new spec above.
- **GREEN:** the file was restored and confirmed identical with `cmp`. Result: 40 passed / 40 total.

### Test count

- `apps-session.service.spec.ts`: 40 tests.
- Whole lib: 16 suites, **287 passed / 287 total**.

### Verification tails

```
npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page --skip-nx-cache
Test Suites: 16 passed, 16 total
Tests:       287 passed, 287 total
NX  Successfully ran targets lint, typecheck, test for project @ptah-extension/mcp-apps-page
(typecheck also printed two pre-existing NG8107 warnings in chat-ui
 mcp-directory-browser.component.ts:175 and chat peer-session-send-dialog.component.ts:181,
 both outside this lib and not touched)
```

```
npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit   (8 errors, all baseline)
libs/frontend/core/src/testing/mock-rpc-service.ts(54,16) (60,24) (66,25) (69,25)
libs/frontend/git-ui/src/lib/services/monaco-loader.service.ts(113,23) (151,24) (171,41) (187,28)
```

### Line counts (`wc -l`)

| File | Lines |
|------|-------|
| `apps-session.service.ts` | 698 |
| `apps-workspace-slice.ts` | 236 |
| `apps-session-rpc.ts` | 53 |
| `apps-conversation-claims.ts` | 107 |

Only `apps-session.service.ts` and its spec changed in this follow-on.
