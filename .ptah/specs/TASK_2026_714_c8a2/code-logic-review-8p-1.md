# Code Logic Review - Batch 8p-1 (TASK_2026_714_c8a2)

## Summary

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED (two moderate items to fix or accept, no blocking or serious) |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 3 |

Scope: uncommitted diff of `codex-read-only-command.ts`, `codex-chat-approval-sink.ts` and both specs, read in full where logic was touched.
Nothing was run (no tests, no diagnostics), as instructed. Behaviour was checked by reading and by one `node -e` probe of `fileURLToPath`.

## Checks requested

1. **GAP-A closes for the live shapes.** Yes, by reading.
   - Evidence base: `batches.md:3674-3676` records `hasProposedExecpolicyAmendment: true` on spike-run-6h x3, 6j, 7a2 x2 and 7d x2. The old `proposedExecpolicyAmendment == null` gate therefore made auto-accept unreachable on every real approval. Removing it (`codex-chat-approval-sink.ts:119-126`) is necessary.
   - The sink still returns the bare string `'accept'` (`:139`), never an amendment decision or `acceptForSession`.
   - Executable shape: `unwrap` (`codex-read-only-command.ts:19-38`) accepts the quoted/unquoted `...\powershell.exe` token with or without `-NoProfile`, and `-Command` with a single- or double-quoted body. This matches the live `"C:\...\powershell.exe" -Command '<body>'` shape (`live-test-p8i.md:68-75`).
   - Caveat: the exact string join Codex produces was never captured. The batch handles that with normalisation (doubled backslashes, forward slashes and case all fold through `path.win32.normalize` + `toLowerCase`) and fails closed to the card on any other spelling. It cannot over-accept. Only a live re-test can confirm the shape; this is the batch's own stated risk A2-2.
   - Multi-statement and `if (...) {...}` bodies still prompt, by design (`forbidden` regex).
2. **Fail-closed paths.** Sound.
   - Unknown wrapper, missing/relative SystemRoot with a full path, `pwsh` full path, SysWOW64, 8.3 alias: `unwrap` returns `undefined`, so no classification and the card appears.
   - `acceptIfRealPathsStayInside` catches resolve errors and returns false (`:161-166`), so the card appears.
   - Invalid or unsupported `file:` cwd: `fileURLToPath` throws, the catch goes to `presentRequest` (`:112-117`). Probe on Node 24.15 with `{windows:true}`: `file:///C:/Users/x/ws` -> `C:\Users\x\ws`; `file://%ZZ/bad` throws `ERR_INVALID_URL`; `file://host/share/x` -> `\\host\share\x` (the classifier then rejects UNC, `classifyReadOnlyCommand`); `file:///home/x` and `%2F` throw. All of these fail closed. An uppercase `FILE:` scheme is not converted and fails the containment check, which is also closed.
3. **`seen` lifecycle (M4).** Correct.
   - Accept (`:134-139`), abort/dispose decline (`:130-133`) and card settle (`:177`) all delete the key. The in-flight duplicate branch (`:105`) keeps the key until the first request finishes.
   - `dispose()` clears `seen` (`:316`), and `disposed` blocks later requests. A later `seen.delete` is harmless.
   - Effect: a repeated identical (same correlation key) read is accepted again, which is the intended outcome and what the spec asserts at `spec:104-124`.
4. **Edit follow-up (M5).** Ordering is right. `pending.settle` resolves the decline first (`:251`); the post runs in `setImmediate` (`:255`). Reason: the runtime writes the response in microtask continuations, and the only `await` after `sink.request` in the bridge is the interact at `codex-approval-bridge.ts:321`, so the check phase runs after the write. `isTurnActive` is evaluated at delivery time (`:259`), which is correct. Errors from `post` are logged and `failed()` is called, with a nested catch for `failed()` itself. The ordering matches `codex-runtime.ts:280-289`. It differs from the runtime in two ways, see M-1.
5. **Constructor and call site.** `codex-chat-adapter.ts:430-470` passes 9 positional arguments (`id, contextId, presentation, followUp, logger, permissionLevel, platform, threadCwd, resolveApprovalPath`). The new 10th `systemRoot` is a trailing default (`process.env.SystemRoot ?? windir`), so the site still matches. The adapter never injects it, so the environment is the only source in production. This is acceptable on Windows. Specs inject it.
6. **`fileURLToPath` `windows` option.** `package.json` engines `node 24.x`; `@types/node` 24.13.6 declares `windows?: boolean` (`url.d.ts:51-55`); the option exists in Node >= 20.13 / 22.1. Runtime Node here is 24.15. Available. One note: the option is `this.platform === 'win32'`, so on a Windows host with a faked posix platform it parses posix style. That is the right behaviour.
7. **Fake timers in specs.** `beforeEach(jest.useFakeTimers)` at `spec:282` is pre-existing and covers the whole describe. Modern fake timers also fake `setImmediate`, so `runOnlyPendingTimersAsync` (`spec:389, 520`) is the correct flush. The assertion that `post` is not called before the flush (`spec:388`) actually pins M5 ordering. Promise-only real-path evaluation is unaffected by fake timers.

## Findings

### Moderate

**M-1. Edit follow-up timer is untracked and ignores dispose** (`codex-chat-approval-sink.ts:255-276`).
The `setImmediate` handle is not stored and `dispose()` (`:311-317`) cannot cancel it; the callback does not test `this.disposed`. The runtime version tracks handles in `followUps`, clears them on close (`codex-runtime.ts:997-998`) and skips when `state === 'closed' || signal.aborted` (`:282`). Scenario: user edits a prompt, the session is torn down in the same tick; the callback still calls `post`. Only `session.closing` in the adapter (`codex-chat-adapter.ts:~457`) protects it, and that flag may be set later than `dispose()`. Impact is small (one extra post that throws `unavailable` and then calls `failed()`, which could show a spurious failure notice). Fix: at the top of the callback, `if (this.disposed) return;` (cheap), or track handles in a Set cleared in `dispose()`.
Related difference: a rejected steer in the runtime maps to `emitFollowUpRejected`; the sink always calls `failed()`. Acceptable if `failed()` is the desired surface; state that in a comment.

**M-2. No spec for abort/dispose during the async real-path check** (`spec` has abort/dispose cases at `:405-463`, all on the card path).
The new `seen.delete` + `'decline'` branch at `sink.ts:130-133` is untested. Fix: give `resolvePath` a deferred promise, start a classifiable read, abort (and in a second case dispose), resolve the promise, expect `'decline'`, no `present`, then (abort case) a fresh request with a new signal is not blocked by a stale key.

### Minor

- **m-1.** `this.logger.info` throwing inside `.then` (`:136`) rejects `request()` and leaves the key in `seen` (no `finally`). Unlikely; wrap the log in try/catch or delete the key before logging (the delete is already before the log, so only the rejection remains).
- **m-2.** The `file:` conversion result is used only for classification; the card still shows the original details. Fine, but a one-line comment would avoid a future "why not pass `cwd` on" question.
- **m-3.** Bare `powershell`/`pwsh` names are accepted without a path check (`unwrap` `bare`). Resolution goes through PATH on the agent side; this is the attack-surface item for the security review, noted here only because the plan states it deliberately.

## Five logic questions (short)

1. Silent failure: none found. Every unproven case falls to the card.
2. Unexpected user action: repeating an identical read gets silently accepted twice (intended per M4). Edit then immediate close: see M-1.
3. Wrong answer from data: an unusual join spelling declines to auto-accept (safe direction only).
4. Dependency failure: `realpath` failure and invalid URL both fail closed; `post` failure is reported through `failed()`.
5. Missing: live re-test for the real command join (not in this batch's reach), and the M-2 test.

## Verdict

APPROVED, score 8/10. Fix M-1 (one line) and add the M-2 spec before the round gate if cheap; neither blocks. Live Windows re-test of GAP-A2 remains the only proof of the actual string shape.
