# Batch 5 report: Submit-to-turn service (rpc-handlers chat)

Executor: backend-developer subagent. No CLI lanes were used; every file below was written by this subagent.
Git was not run except read-only `git status` and `git show`.

## Task 5.1: `SurfaceSubmitTurnService`

Files:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\session\surface-submit-turn.service.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\session\surface-submit-turn.service.spec.ts`

What was done: `dispatch(routingId, content): Promise<SurfaceSubmitTurnOutcome>` never throws. It follows plan Component 16
steps 1-6:

1. `lifecycle.find(routingId)`. If there is no record, it returns `rejected: session-unavailable`.
2. Live check: `adapter.isSessionActive(routingId)` AND (`isStreaming(realSessionId)` when bound, OR `isStreaming(tabId)`).
   This is the same rule as `chat-session.service.ts:1127-1146`. If the check fails, it returns `rejected: session-unavailable`.
3. Busy fast path: `turnInFlight || messageQueue.length > 0`, or a dispatch to the same record is already in flight. Busy returns
   `rejected: busy` and sends nothing.
4. `await adapter.sendMessageToSession(routingId as SessionId, content, { admission: 'require-idle' })`. The origin is left
   unset, so the turn is the default human turn.
5. Resolved: returns `applied` and logs `observed: 'acceptance-only'`, following the `peer-session-messenger.service.ts:128-147`
   precedent.
6. `SessionAdmissionRefusedError` (checked with `instanceof`): `busy` maps to `rejected: busy`, and `session-ended` maps to
   `rejected: session-unavailable`. Any other throw returns `indeterminate` with a fixed detail string
   (`SURFACE_SUBMIT_INDETERMINATE_DETAIL`). The service never redispatches.

Outcome type:
`{ status:'applied' } | { status:'rejected'; reason:'busy'|'session-unavailable'; detail } | { status:'indeterminate'; detail }`.

Injected tokens: `TOKENS.LOGGER`, `TOKENS.AGENT_ADAPTER`, `SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER` and
`CHAT_TOKENS.STREAM_BROADCASTER`. `TOKENS.LOGGER` was added beyond the three the plan lists. It follows the sibling constructor
pattern (`chat-subagent-context-injector.service.ts:52-57`) and keeps the raw error out of the RPC result (see the risks below).

Evidence (`surface-submit-turn.service.spec.ts`, 20 cases, all pass):

- Accepted submit:
  - One send with `{ admission: 'require-idle' }`, and `applied` is returned.
  - The options object has no `origin` property.
  - Two sequential calls send twice, which shows one send per call.
  - A stream keyed only by the real session id counts as live.
  - A stream keyed only by the tab id counts as live while `realSessionId` is null.
- Session unavailable:
  - A missing record, an inactive adapter, or a record with no stream on either key each returns `session-unavailable`, and
    the send is never called.
  - An empty-string stream key is not probed while the real id is unbound.
- Busy: a turn in flight or a non-empty queue each returns `busy`, and the send is never called.
- Pending window (Req 6.5), using a deferred send promise:
  - The dispatch stays unsettled after the send is called and settles to `applied` after the send resolves.
  - A second dispatch to the same record through its OTHER key (real id versus tab id) while the first is pending returns
    `busy`. The send call count stays at 1.
  - The guard is released after a settled refusal, so the next dispatch sends.
- Typed refusal: `SessionAdmissionRefusedError('busy')` maps to `rejected: busy`, and `('session-ended')` maps to
  `rejected: session-unavailable`. Each makes exactly one send.
- Indeterminate, never resent:
  - Carried from the Batch 3 review: an untyped `Error('createUserMessage failed ...')` rejection returns
    `{ status:'indeterminate', detail: SURFACE_SUBMIT_INDETERMINATE_DETAIL }`. The send count is 1 after a microtask flush.
    The spec comment states why this conservative outcome is intended: an untyped error does not say whether a push happened.
  - A non-admission `SdkError('Session not found')` returns `indeterminate`.
  - A non-Error rejection (`'boom'`) returns `indeterminate`.
  - The raw error text appears in `logger.warn` and not in the serialized outcome.

## Task 5.2: Register the service token

Files:

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\tokens.ts`:
  added `SURFACE_SUBMIT_TURN: Symbol.for('SurfaceSubmitTurnService')` with a doc comment.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\di.ts`:
  `registerSingleton(CHAT_TOKENS.SURFACE_SUBMIT_TURN, SurfaceSubmitTurnService)` after `SESSION`. The DAG comment gained
  `SURFACE_SUBMIT_TURN <- STREAM_BROADCASTER`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\session\index.ts`:
  this barrel already re-exports the session services, so it now also exports `SurfaceSubmitTurnService`,
  `SURFACE_SUBMIT_INDETERMINATE_DETAIL`, `SurfaceSubmitTurnOutcome` and `SurfaceSubmitTurnRejectReason`. These reach the
  `chat/index.ts` barrel through `export * from './session'`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\di.spec.ts`:
  the spec checks registered chat tokens, so a new `describe('registerChatServices — SurfaceSubmitTurnService')` block was
  appended. It checks two things:
  - `SURFACE_SUBMIT_TURN` is registered.
  - With stand-ins for the logger, adapter, lifecycle manager and broadcaster, it resolves to a `SurfaceSubmitTurnService`, and
    a second resolve returns the same instance.

  The existing assertions are unedited. The only other change is three added import lines.

Evidence: `di.spec.ts` together with the service spec gives 2 suites and 30 tests, all passing.

## Risks and carried items

- A4 (`SessionRecord` not exported): the record is typed as `NonNullable<ReturnType<SessionLifecycleManager['find']>>`
  (`SessionRecordView` in the service, `RecordView` in the spec). The agent-sdk barrel was not edited.
- R9 (concurrent Batch 4 in shared): during the verification run, Batch 4's four shared files were untracked and still being
  written (`surface-bindings.ts`, `surface-concurrency.ts`, `surface-patch.ts`, `surface.validator.ts`). rpc-handlers typecheck
  passed anyway. This batch imports nothing from those files. Per standing rule 5, re-run the verification after Batch 4 commits.
- Batch 3 review carry-over: pinned by the first `indeterminate` case described above.
- Trust boundary: the `indeterminate` and `rejected` details are fixed strings. The error message is logged on the host only.
  A spec pins this.
- The busy rule (Q1) includes "a pending submit already exists": this is handled by the per-record in-flight guard. It is keyed
  by the immutable `tabId`, so routing by tab id or by real id cannot double-send. The ledger in Batch 9/10 still owns the
  operation-level pending rule.

## Plan deviations

1. `SurfaceRejectReason` is not reachable yet. The batch asks for reject reasons that reuse `SurfaceRejectReason` from
   `@ptah-extension/shared`, but `surface.types.ts` is not exported from either the main barrel or the
   `@ptah-extension/shared/mcp-apps-contracts` entry until Batch 6 Task 6.5 (checked in `libs/shared/src/index.ts` and in
   `mcp-apps-contracts/index.ts`, which has no `surface` match). A deep import is not allowed, and the barrel belongs to Batch 6.
   - The service therefore declares `SurfaceSubmitTurnRejectReason = 'busy' | 'session-unavailable'`. Both are members of
     `SurfaceRejectReason`, so the Batch 11 handler assigns it without mapping, and the compiler checks that assignment there.
   - Suggestion for Batch 6 or 11: once the barrel exports the type, redefine the alias as
     `Extract<SurfaceRejectReason, 'busy' | 'session-unavailable'>`.
2. The live check probes `isStreaming(realSessionId)` only when the id is bound, instead of `isStreaming(realSessionId ?? '')`.
   The result is the same, and it avoids probing an empty key. A spec pins this.
3. `TOKENS.LOGGER` was injected in addition to the three planned tokens (see Task 5.1).

## Verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers --skip-nx-cache 2>&1 | tail -40`

```text
√  nx run @ptah-extension/rpc-handlers:typecheck
√  nx run @ptah-extension/rpc-handlers:lint
√  nx run @ptah-extension/rpc-handlers:test
NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/rpc-handlers
Run duration: 2m 37s
```

Targeted checks:

- `npx jest -c libs/backend/rpc-handlers/jest.config.ts <service spec> <di spec>`: 2 suites and 30 tests passed. The service
  spec alone: 20 of 20 passed.
- `npx eslint` on the six touched files: no output, meaning 0 errors and 0 warnings.

The combined jest run printed "A worker process has failed to exit gracefully". The service spec alone does not print it, so
it comes from `di.spec.ts`, which loads the full chat-service module graph through `di.ts`. It is not attributed to the new
cases, which only register and resolve with stand-ins.

## Out-of-scope observations

None.

## Revision 1 (codex logic review, `code-logic-review-batch-5.md`, findings 1-2)

Files (these two only):

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\session\surface-submit-turn.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\rpc-handlers\src\lib\chat\session\surface-submit-turn.service.spec.ts`
  (a new top-level `describe('SurfaceSubmitTurnService — outcome boundary')` was appended; the existing cases are unedited)

### Finding 1 (SERIOUS): the outcome boundary now covers the preflight and the success log

- The preflight is now a private `admit(routingId)`, which runs `lifecycle.find`, `isSessionActive`, both `isStreaming`
  probes and the busy fast path inside one `try`. A throw from any of them returns
  `rejected: session-unavailable` with the fixed detail "The chat session for this surface could not be checked.". The raw
  error goes to the host log only.
- Why `session-unavailable` rather than `indeterminate`: plan Component 16 reserves `indeterminate` for a failure where
  it is unknown whether a push happened. A preflight throw happens before `sendMessageToSession` is called, so no turn can
  have started, and the outcome is known. The host could not establish a live session to send to, which is the
  Req 10.3 `session-unavailable` case. The submit's values stay in the store, so the user loses nothing.
- The outcome is decided before any logging. `applied` is assigned right after the awaited send resolves, inside the
  `try`. The acceptance log runs only after the `try/catch/finally`, through `safeLog`, which swallows logger failures.
  A throwing logger therefore cannot turn `applied` into a rejection.
- Guard ownership: the in-flight key is added only after `admit` returns `admitted`, and it is removed in the `finally` of
  the same call. An early exit (a preflight throw, busy or not live) returns before the add. It therefore never clears
  a guard held by an earlier call that is still pending. A spec pins this.

### Finding 2 (MODERATE): classification is independent of diagnostics

- `classifySendFailure(error)` is a pure module function that decides the fixed outcome from the error's type alone.
  Its `instanceof SessionAdmissionRefusedError` test is guarded too, because a proxy's `getPrototypeOf` trap can throw.
  A throwing check yields `indeterminate`.
- Diagnostics run after the outcome is decided, in `logSendFailure`, through `safeLog`. `describeError` reads name and
  message inside a `try`. Any failure there, such as a null-prototype object or a `toString` that throws, falls back to the
  constant `{ errorName: 'unknown', error: '<unprintable thrown value>' }`.

### Specs added (11 cases, `surface-submit-turn.service.spec.ts`)

- Preflight throws from `lifecycle.find`, `isSessionActive` and `isStreaming`: each gives the exact fixed
  `rejected/session-unavailable` outcome with 0 sends.
- The preflight error text is absent from the outcome and present in `logger.warn`.
- The preflight throws AND the logger throws: the fixed outcome is still returned, with 0 sends.
- The logger throws after a successful send: `{ status:'applied' }` is still returned, with 1 send.
- The logger throws on a typed `busy` refusal: `rejected: busy` is still returned, with 1 send.
- `Object.create(null)` rejection: the exact `{ status:'indeterminate', detail: SURFACE_SUBMIT_INDETERMINATE_DETAIL }` is
  returned, with 1 send. The host log carries the constant fallback.
- A rejection whose `toString` throws: the exact fixed `indeterminate` outcome, with 1 send.
- A proxy rejection whose `instanceof` check throws: the exact fixed `indeterminate` outcome, with 1 send.
- Guard ownership:
  - The first call is pending on a deferred send.
  - A second call that fails preflight gets the fixed `session-unavailable`.
  - A third call is still `busy`, with a send count of 1.
  - The first call then resolves `applied`.

Service spec: 31 of 31 tests pass (20 original and 11 new). `npx eslint` on both files printed nothing, so 0 errors and 0 warnings.

### Verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers 2>&1 | tail -30`

```text
√  nx run @ptah-extension/rpc-handlers:test
√  nx run @ptah-extension/rpc-handlers:typecheck
√  nx run @ptah-extension/rpc-handlers:lint
NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/rpc-handlers
Run duration: 43.0s
Cache: 0/3 hit (0%)
```

R9: Batch 4's shared files are still uncommitted in the worktree (9 untracked files under
`libs/shared/src/mcp-apps-contracts/`). This batch imports none of them. Per standing rule 5, re-run the verification
after Batch 4 commits.

The residual item from the review's question 5 is unchanged: a permanently unresolved send keeps its guard. No timeout
was added, because releasing the guard while acceptance is unknown would allow a redispatch.
