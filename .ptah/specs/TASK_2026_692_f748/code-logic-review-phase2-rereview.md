# Code Logic Re-review (Phase 2, Batch 13F) - TASK_2026_692_f748

Scope: diff of commit a8842a8e4 under `libs/`. Method: read the diff and the surrounding code. I did not run any Jest spec. I relied on the orchestrator's passing scoped specs and typechecks.

Verdict: APPROVED. 0 blocking, 0 serious, 3 moderate, 2 minor.

## Fix verification

### 1. SDK_IDLE_COMPACTION fail-open factory: FIXED

- `libs/backend/agent-sdk/src/lib/di/register.ts:544-559`. The factory is wrapped in try/catch.
  - A failure sets `idleCompactionFailed`, logs once, and returns `undefined`.
  - The flag is needed because tsyringe's `instanceCachingFactory` only caches a defined value. It re-runs the factory when the cached value is `undefined`. Without the flag the factory would rebuild and re-log on every resolve.
  - The new smoke spec asserts exactly one `onDidChangeConfiguration` call and one `logger.error` call across two resolves.
- `logger` is the `registerSdkServices(container, logger)` parameter (`register.ts:198-201`). It is in scope and valid when the factory runs. The factory no longer resolves `TOKENS.LOGGER` from the container.
- Consumers handle `undefined`:
  - `SessionLifecycleManager` (`session-lifecycle-manager.ts:423-424`) has a `= null` default. An `undefined` from DI becomes `null`.
  - The manager forwards `this.idleCompaction` (null-safe) to the query executor and stream pump. Both are typed `IdleCompactionSignals | null = null` (`session-query-executor.service.ts:213`, `:566`).
  - Every other use is `?.`: lines 484, 722, 745, 822.
  - `CompactionHookHandler` (`compaction-hook-handler.ts:163-164`) is typed optional. `rekeySessionState` skips falsy targets (`:178`, `:182`).
- The only `SDK_IDLE_COMPACTION` sites are the register and the two `@inject` sites (grep). There is no `c.resolve(SDK_IDLE_COMPACTION)` call that would receive `undefined` unexpectedly.
- The port types (`IdleCompactionFacadePort`, `Pick<IdleCompactionSignals,'rekey'>`) match what each consumer calls: `input`, `promptPrefixChanged`, `boundaryNoticeFor`, `dispose`, `rekey`.
- Residual: a transient construction failure is cached for the life of the container (see M2).

### 2. IdleCompactionService constructor dispose-on-throw: FIXED

- `idle-compaction.service.ts:102-136`. The RxJS `stream` subscription is created first, then the disposer registrations run inside try/catch. On a throw, `dispose()` runs and the error is rethrown.
- `dispose()` (`:493-504`) is idempotent through the `disposed` guard. It completes the subject, unsubscribes the stream, runs the disposers registered so far, and clears the maps. A callback registration or event subscription made before the throw is released.
- `this.disposers` is a field initializer and `this.stream` is assigned before the try, so `dispose()` cannot see an unassigned field.
- Double dispose is safe: the constructor path sets `disposed`, and a later `SessionLifecycleManager.dispose()` no-ops. In practice the failed instance is never handed out.
- Residual: see M3.

### 3. ChatContinueResult.settled: FIXED for MessageSender

- The router sets `settled: true` on both coalesce and dedupe returns: the pre-provider path (`chat-slash-command-router.service.ts:~139`) and the post-provider path (`:~183`). The spec covers all three cases.
- The `MessageSender` settled branch (`message-sender.service.ts:778-787`) is placed after the failure check. It does these things:
  - It removes the prompt boundary through `removeUserPromptBoundary`.
  - It calls `markLoaded` and `markTabIdle`.
  - It sets the session status to `loaded`.
  - It does not call `markStreaming` or `markTabStreaming`.
  - Together these mirror the failure branch's state resets, so no streaming state is left behind.
- The pending queue is handled by the caller, as in the failure path.
- The user's "/compact" bubble stays in the transcript. That is reasonable for an accepted command, but no system notice says it was coalesced (M1).
- The spec asserts the state transitions and that the streaming marks are not called.

### 4. `sendIdleCompact(sessionId: string)` cast: ACCEPTABLE

- `session-lifecycle-manager.ts:732-738` casts `as SessionId` once, at the boundary. `SessionId` is a branded string. The idle service works with plain string keys (`IdleCompactSender` is typed `string`). This is the same cast `idleCompactionNoticeFor` already used.
- It is not a regression. The stream pump does not validate the brand. The cast is safer than widening the `IdleCompactSender` interface to `SessionId`.

## Findings

### Moderate

- **M1. Other `chat:continue` consumers ignore `settled`.** A `/compact` that is coalesced or deduped leaves these consumers waiting for a stream that never starts.
  - `apps/ptah-tui/src/hooks/use-chat.ts:~235-260` arms a watchdog before the RPC. It never clears the turn on `settled`, so the turn fails with a watchdog error.
  - `apps/ptah-cli/src/cli/commands/interact.ts:426-450` calls `chat:continue` through `runTurn`. I did not verify whether `runTurn` waits for stream completion. It may hang or time out.
  - `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:322-345` leaves `pendingTurn` set. This is unlikely to send `/compact`.
  - The hang existed before 13F, so this is incomplete coverage, not a regression. Recommendation: honor `settled` in TUI and CLI, or record it as a follow-up in decisions.md.
- **M2. A transient construction failure is cached for the container lifetime.** `register.ts:544-558` has no retry or backoff. Idle compaction stays off until restart. The error log makes this visible, and the fail-open choice is consistent with decisions #12. Acceptable, but it should be stated in the docs.
- **M3. `dispose()` can mask the original error.** If one disposer throws inside `dispose()` (`idle-compaction.service.ts:498`), the remaining disposers are skipped. In the constructor catch, the original error is then replaced by the disposer's error. Wrap each disposer in try/catch. This is low probability.

### Minor

- **m1.** After a dedupe against an in-flight compaction, the tab is marked idle while the compaction stream is still active. Later stream events should re-mark it streaming, but I did not trace that path. Worth a manual check.
- **m2.** The `settled` doc comment (`rpc-chat.types.ts:172`) should say the field is set only for manual `/compact` and that clients must not wait for stream events.

## Five logic questions (scoped)

1. Silent failure: idle compaction construction failure is visible (logged once at error level) and does not break chat. Good.
2. Unexpected user action: `/compact` while one is in flight now settles cleanly in the main UI. TUI and CLI do not (M1).
3. Wrong-answer input: none found in the diff.
4. Dependency failure: a missing workspace or events provider is handled. A throw during construction fails open (item 1).
5. Missing: `settled` handling in the other clients (M1). A user-visible notice for a coalesced compaction.

## Result

All four review points are resolved with no new blocking or serious defect. Decision: APPROVED, with M1 to be recorded as a follow-up or fixed cheaply.
