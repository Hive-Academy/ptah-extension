# Code Logic Review — CodeRabbit PR #881 fixes

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 3 (all minor/handled) |

Scope: the uncommitted diff under `apps` and `libs` in the codex-removal-a worktree, read against the
surrounding code. No tests, lint or typecheck were run (per instruction).

## Per-fix verification

### (1) malformedPage reaches the client as HISTORY_MALFORMED — correct

Chain, each hop read:
- `libs/backend/codex-runtime/src/lib/codex-session-history.ts` throws `CodexSessionHistoryError('malformedPage')` (lines 41, 89, 102-149).
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:671-674` now rethrows it as `ElectronCodexHistoryError('malformedPage')`. The `error instanceof ElectronCodexHistoryError` early-rethrow at line 666 is unaffected. The `finally` still disposes the scope and decrements `activeReads`.
- `libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:103-104` passes any error named `ElectronCodexHistoryError` through unchanged.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:30-62` (`nativeHistoryRpcError`) matches by `error.name === 'ElectronCodexHistoryError'` and reads `.code`. The `malformedPage` entry maps to `HISTORY_MALFORMED`, and `HISTORY_MALFORMED` is in the shared union (`rpc-error-codes.types.ts:44`).

The message text is fixed and carries no path or payload. The spec asserts the exact code and scope disposal. It does not go through the router or `nativeHistoryRpcError`, but every hop above is plain pass-through, so I accept it.

### (2) openai-codex refusal guards — correct, no collateral

- All three guards compare the exact id `'openai-codex'`, so other providers are untouched.
- The message comes from one module-local constant, equal to the shared `CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE` text in `auth-providers/.../codex-native-runtime-refusal.ts:4`. The registry cannot import it (cli-agent-runtime depends only on agent-sdk and shared here), so there is a duplicated literal. Drift is possible but covered by the specs' literal assertions.
- `spawnAgent` throws `AuthRequiredError({ providerId: 'openai-codex' })`. This is the same error type the old placeholder-token check threw (`ptah-cli-registry.ts:840`), now raised before `resolveAgentCredential` and any proxy or SDK work.
  - Behaviour change: a Codex agent with no credential previously returned a "no API key" status result and now throws. This is intended, because Codex never works in this registry.
  - The guard sits after the not-found and disabled checks, so those statuses keep priority.
- `getProfile` returns `undefined` with a warn log. The only caller, `chat-ptah-cli.service.ts:98`, already handles `undefined`.
- `testConnection` returns `{ success: false, error: <shared message> }` inside the existing try, before the proxy is built, so no proxy needs `stopProxy`.
- No legitimate native Codex path uses these methods. Native Codex runs through `codex-runtime`, and no other `openai-codex` reference exists in `ptah-cli-registry.ts`.
- The old placeholder-token checks stay as defence in depth.
- Specs assert the error type, provider id, the testConnection result, `getProfile === undefined` and that the SDK is never loaded. The `ensureMigrated` mock addition is needed for the new flow.

### (3) frame-buffer shrink — safe

Ordering in `onData` (`codex-app-server-process.ts:326-368`):
1. The frame bytes are copied from `chunk` into `frameBuffer`, and `frameBytes += length`.
2. `bytes = frameBuffer.subarray(0, frameBytes)` and `frameBytes = 0`.
3. `JSON.parse(decode(bytes))` completes, so the decoded value no longer references the buffer.
4. Only then, if `frameBuffer.length > OUTBOUND_FRAME_BYTES`, is it replaced by `Buffer.alloc(1 MiB)`. Initial size is the same constant (line 141).
5. `offset = end + 1`, and the next iteration reads the following (possibly partial) frame from `chunk`, not from `frameBuffer`, and writes at `frameBytes = 0` into the fresh buffer.

A partial frame that follows in the same chunk is therefore never read from the old buffer, so nothing is dropped or corrupted. A partial frame left from an earlier chunk cannot exist at this point, since a newline just terminated a complete frame. If `JSON.parse` throws, the shrink is skipped, but `fail()` tears the process down (line 651 zeroes the buffer).

Residual concerns:
- Trade-off: each completed frame larger than 1 MiB now costs a zero-filled 1 MiB allocation, and a stream of large frames repeats the grow-then-shrink pattern. This is bounded and acceptable.
- Test gap (Moderate, see below).

### (4) overflow log-once flag — correct

`codex-context.ts`:
- Declared at line 97, set once at 511-512, so the log is emitted once while the overflow condition holds.
- Reset at 550, in the root-terminal branch, right next to the `earlyChildEvents.clear()` and `earlyChildCount = 0` resets.
  - The child-terminal branch returns before reaching it, so a child turn ending does not re-arm the flag.
  - Reset and clear stay paired at both sites.
- Reset at 1115 in `finishClose`, again paired with the clear.
- Linkage drain at 497-499 decrements the count but leaves the flag set. That matches "once per root turn", and a repeat overflow in the same turn stays quiet.
- The count stays at 64 after the 80 attempts, so the cap behaviour is unchanged.
- The spec asserts the log count (1, then 2 after a root terminal), the cleared map and the count, so it checks behaviour.

## Five logic questions (brief)

1. Silent failure: none new. Refusals are explicit, and the Codex malformed-page defect is now surfaced rather than reported as a generic failure.
2. Unexpected user action: a user who configured an `openai-codex` Ptah CLI agent and tests or spawns it gets the shared refusal message, as intended.
3. Wrong-answer data: none identified.
4. Dependency failure: the history scope still disposes on every error branch. The buffer shrink does not alter the failure path.
5. Missing: the registry message constant duplicates the auth-providers constant (no single source).

## Issues

### Moderate
- `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts` (shrink test): the "partial bytes survive" check splits the next frame across two chunks after the shrink has already happened. It does not cover the risky case, which is a large frame and a partial next frame in the same chunk (`largeFrame + "\n" + first N bytes of next`, then the rest). The code is correct by my trace, but the spec would not catch a regression that reordered the copy and the realloc. Add that case.

### Minor
- `ptah-cli-registry.ts` (about line 1639): the Codex message literal is duplicated from `codex-native-runtime-refusal.ts:4`. Consider exporting it from a shared lib if a dependency edge allows.
- `codex-context.ts:550`: the flag resets on any root terminal, including a stale turn id, so a rare re-log is possible. This is harmless.

## Verdict

- Recommendation: APPROVE (add the same-chunk test when convenient)
- Confidence: HIGH for fixes 1, 3 and 4; MEDIUM-HIGH for fix 2 (the caller audit covered `getProfile` and the registry only)
- Top risk: the frame-buffer regression test does not exercise the same-chunk partial-frame scenario.
