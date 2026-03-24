# TASK_2025_215: Remove Permission/Question Timeout — Block Indefinitely Like Claude CLI

## Task Type: BUGFIX

## Workflow: Minimal (backend-developer direct)

## Status: Active

## Problem

`SdkPermissionHandler` uses a hard 5-minute `setTimeout` for both permission requests (`awaitResponse`) and AskUserQuestion requests (`awaitQuestionResponse`). When the user doesn't respond within 5 minutes, the request auto-denies with `interrupt: true`, killing the entire session.

Claude Code CLI blocks **indefinitely** on stdin — there's no timeout. Users expect the same behavior from Ptah.

## Root Cause

- `PERMISSION_TIMEOUT_MS = 5 * 60 * 1000` (line 106)
- `awaitResponse()` (line 1014): `setTimeout → resolve(null) → auto-deny`
- `awaitQuestionResponse()` (line 964): same pattern
- The SDK's `canUseTool` callback provides an `AbortSignal` in `options.signal` but it's never used

## Evidence (from log)

```
[SdkPermissionHandler] AskUserQuestion timed out: perm_1774214332637
[SdkPermissionHandler] Permission response received: totalLatency:300003, decision:"timeout"
[SdkPermissionHandler] Permission request perm_1774214712217 timed out after 300000ms
[SdkPermissionHandler] Received response for unknown request: perm_1774214712217  // late user response rejected
```

## Solution

1. Remove `PERMISSION_TIMEOUT_MS` constant and all `setTimeout`-based timeouts
2. Pass `AbortSignal` from SDK's `canUseTool` options through to `awaitResponse`/`awaitQuestionResponse`
3. Listen for `signal.abort` to cancel pending promises (handles session abort, webview close)
4. Keep `cleanupSessionRequests()` for session-scoped cleanup
5. Add cleanup on `dispose()` for extension deactivation

## Files to Modify

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` — primary changes

## Acceptance Criteria

- Permission requests block indefinitely until user responds
- AskUserQuestion requests block indefinitely until user responds
- AbortSignal from SDK properly cancels pending requests
- Session cleanup still works (no orphaned promises)
- No memory leaks from unresolved promises
