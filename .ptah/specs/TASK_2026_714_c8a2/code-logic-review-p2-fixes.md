# Code Logic Review, P2 fixes (revise round 1 of 2), TASK_2026_714_c8a2

Review family: Claude reviewer, Codex implementer.

Score: 7/10. Verdict: APPROVED, with the numbered Moderate items to be fixed or explicitly deferred in the decisions log. No Blocking or Serious issue remains.

Checks run: `jest libs/backend/codex-runtime/src` gave 13 suites and 528 tests, all passing. Runtime and process specs under `--runInBand --detectOpenHandles` reported no open handle. A full `--maxWorkers=2` run showed no "force exit" or "did not exit" text. The earlier worker warning did not reproduce; see the timer audit below.

Lane C validator split is a pure move. A line-set comparison of the old validator against validator + schemas + methods shows only `export` added and no schema line changed. Fixtures contain method/itemType only.

## Previous findings

| # | Status | Evidence |
| --- | --- | --- |
| S1 fingerprint | Fixed | `codex-execution-profile.ts:255-279` hashes thread invariants only. Model, effort, enhancedPrompt and attachments are excluded. Permission, sandbox, approval policy, MCP set, prompts, instruction sources and lane stay in. |
| S2 RPC error kills context | Fixed (see N2) | `CodexRequestRejectedError` (`codex-app-server-process.ts:54`). `codex-runtime.ts` start, steer, interrupt and compact rethrow it without `onFailure`. Transport and protocol failures still close. |
| S3 `grantRoot` auto-accept | Fixed for auto-edit (see N3) | `codex-permission-policy.ts:21-38`: `grantRoot`, missing details or unknown keys give `present`. The bridge passes `request.details` (`codex-approval-bridge.ts:203`). `startedAtMs` is in the allowed keys. |
| S4 Windows usage | Fixed | `codex-home-path.ts` is the single canonicalizer. The profile, the client key, the `fromProfiles` equality check and `verifiedCodexHome` all use it. `createProcess` receives `{...profile, normalizedHome: home}`. |
| S5 lazy events | Fixed | `events()` registers synchronously (`codex-runtime.ts:304-324`). Queued events are still delivered after `close()`, because `closed` only ends the stream once the queue is empty. |
| (a) experimentalApi | Fixed | Profile field removed. The wire value stays a constant `true`. |
| (b) DI | Mostly fixed | Lazy `instanceCachingFactory`, duplicate-registration guard, `ParityGate` token, and `resolveGatedCodexRuntime` (always throws while the gate is disabled). The raw `Runtime` token is still exported (`index.ts` exports `CODEX_RUNTIME_TOKENS`). The gate remains advisory, documented as "lifecycle/tests only". `close()` versus `dispose()` is documented, not enforced. See N7. |
| (c) extraEnv | Not addressed | No `extraEnv` in `codex-app-server-process.ts`. Neither lane's report (including lane A's decisions) records a deferral. Needs a decisions-log row. |
| M6 approval during interrupting | Fixed | `onRequest` allows `running` and `interrupting`. The bridge sees `isCurrent` false and the aborted turn signal, so the reply is `cancel`. There is no accept path. |
| M7 unknown server request | Fixed | -32601 reply, bounded by the outbound queue cap. Client-direction method names still fail closed (`codex-app-server-process.ts:279-300`). |
| M8 watchdogs | Fixed, with caveats (N1) | Interrupt timer 30 s. Compact timer 30 s. |
| M9 close hang | Fixed (N4) | 1 s ceiling in `close()` then `cleanup()` and `finishClose()`. |
| M11 slow subscriber | Fixed (N5) | Only the overflowing subscriber is detached, with a `codexSubscriberOverflow` error event. Other subscribers continue and the context stays alive. |
| M13 home mismatch | Fixed | `CodexHomeMismatchError` is rethrown from `open()`. The home check is now strict: `verifiedCodexHome !== profile.normalizedHome` throws. |
| M10 usage `last` | Deferred silently | The translator is unchanged. |
| Minors 16, 17, 19 | Deferred (lane B notes rule-store pruning) | Rule store never pruned; MCP accept of an unsupported form still returns decline; `excludeSlashTmp` unset. |
| M18 refresh | Fixed | A refresh caller waits for the in-flight read, then reads again. |

## Safety invariants (re-verified)
- No accept on abort, timeout, crash or dispose. The `cancel`/`decline` defaults are unchanged. `interrupting` is not treated as live (`isCurrent` needs `running`). Disposal gives `decline`.
- One response per request: the `approvals` map and the `seen` set are unchanged. The -32601 path does not enter `approvals`, so it never double-replies.
- Decline is written before the steer: the `setImmediate` ordering is unchanged. A steer rejection no longer kills the context.
- One terminal per turn: `terminalTurns` and the translator `terminals` set are unchanged. Interrupt-rejection rollback restores `running` only if `activeTurn` is still the turn.
- The gate cannot be bypassed by the routing API (`enabled: false` is a literal type and `resolveGatedCodexRuntime` throws). It remains bypassable through the raw `Runtime` token; see N7.

## Timer audit (open handles)
- Interrupt timer: set at `codex-runtime.ts:588`. Cleared on terminal (`:423`), on rejection (`:600`), before each re-arm (`:587`), and on `close()` (`:680`). It fires only into `onFailure`. OK.
- Compact timer: local; cleared in `finally` (`:664`). It cannot leak, because it is created inside the serialized operation. OK.
- Kill timer: `killTimer` is cleared in `cleanup()`. `onClose` and `fail()` both route to `close()`/`cleanup()`. OK.
- Request, approval and bridge timers: all cleared on `close()`, `dispose()` and settle. Same as before.
- Conclusion: no timer leak path found. The earlier force-exit most likely came from specs leaving contexts open under fake or real timers. It did not reproduce here with 2 workers, nor with `--runInBand --detectOpenHandles`.

## New findings

N1 (Moderate). The compaction watchdog is 30 s, `codex-runtime.ts:652`. Compaction is a model summarization call and can exceed 30 s on a large thread. The watchdog then kills a healthy context and the server may still complete the compaction. Use a longer deadline (for example 120-300 s) or reset it on any `compaction` or item activity.

N2 (Moderate). A rejected follow-up steer is swallowed silently, `codex-runtime.ts:219-222`. After the decline of an "edit", if the steer is rejected, the replacement instruction is lost with no event or log. The user sees only a declined command. Emit a sanitized `error` event with `codexFollowUpRejected`, or at least a logger warning.

N3 (Moderate). A rule-store hit bypasses the `grantRoot` check outside auto-edit, `codex-permission-policy.ts:41`. In ask mode, a remembered file rule (same item paths) auto-accepts a later request that carries `grantRoot`. The rule target ignores `grantRoot`. Evaluate the `grantRoot`/unknown-key prompt guard before `ruleStoreHit` for all non-yolo levels.

N4 (Moderate). After the close ceiling, `cleanup()` removes the process's own child `error` listener. `finishClose` in `codex-runtime.ts` then removes the runtime's listener. A late child `error` event (for example a failed kill) has no listener and throws as an uncaught exception in the host. Keep a permanent no-op `error` listener on the child after the ceiling.

N5 (Minor). The overflow event is marked `retryable: true`, but the subscriber is detached and its stream ends with no terminal. The consumer must treat it as stream-fatal. Set `retryable: false` or document it. Other subscribers are unaffected.

N6 (Minor). The "race" classification of RPC errors is a message regex, `codex-app-server-process.ts:326-332`. A non-matching message still yields a non-fatal `codexRequestRejected`, so it fails safe. However, `retryable` is always `true`; it should be true only for the race code.

N7 (Minor, design). The gate stays advisory at the container level (raw `Runtime` token exported) until the P3 test asserting no route resolves it without `resolveGatedCodexRuntime`. Add that test in P3. Also add `dispose()` aliases or an owner hook so container disposal closes the runtime and the usage client.

N8 (Carry-over, needs a decision row). (c) extraEnv, M10 usage `last` semantics, rule-store pruning, MCP silent decline, and `excludeSlashTmp` are neither fixed nor recorded as deferred. Record each as deferred with an owner, or fix.

N9 (Minor). Fingerprint check. Resume-relevant inputs that are not in the thread identity: the binary pin version and the platform path style. The excluded inputs (model, effort, enhancedPrompt, attachments) are applied per turn from `settings` and `turn/start`, so they do not need to be in the thread identity. Instructions are re-sent on resume (`thread/resume` params). Nothing resume-critical escapes. The pinned binary version is not part of the identity; this is acceptable only if the pin is global.

## Verdict
APPROVED 7/10. Fix N1-N4 in round 2 (small edits), and record N8 decisions. Confidence: HIGH on the S1-S5 fixes, the invariants and the timer audit. MEDIUM on N1 (compaction duration is not measured) and N4 (it depends on the spawner's child stream).
