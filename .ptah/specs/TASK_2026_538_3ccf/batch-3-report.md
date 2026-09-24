# Batch 3 report: idle admission in the SDK stream pump

Executor: backend-developer subagent. No CLI lanes were used. Every file in this batch was written by the subagent,
so under standing rule 1 the cross-review goes to a CLI lane of any family.

Stack I checked before editing:
- `SessionStreamPump` is a plain class that the facade constructs. It is not registered with tsyringe (header of
  `session-stream-pump.service.ts`), so I added no DI registration.
- Errors follow the `SdkError` subclass pattern. I copied `session-not-active.error.ts` and
  `internal-query-queue-timeout.error.ts`, which shows a readonly field set in the constructor.
- The public error re-exports are listed by name in `libs/backend/agent-sdk/src/index.ts:93-99`.

## Task 3.1: `AIMessageOptions.admission`

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\lib\types\ai-provider.types.ts`
- Added `readonly admission?: 'require-idle'` after `origin`. Its doc comment says that when the field is absent,
  every existing caller keeps today's behaviour: a message sent mid-turn is held and runs as the next turn.
  `'require-idle'` accepts the message only onto a live, idle session, checked atomically just before the enqueue.
  Otherwise the call throws a typed `busy` or `session-ended` refusal and queues nothing.
- Evidence: shared typecheck passes, and agent-sdk typechecks against the new field (the pump, the manager and the
  adapter all use `AIMessageOptions['admission']`).

## Task 3.2: `SessionAdmissionRefusedError` and its exports

- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\agent-sdk\src\lib\errors\session-admission-refused.error.ts`
  - `class SessionAdmissionRefusedError extends SdkError`
  - `readonly reason: 'busy' | 'session-ended'`
  - Constructor: `(reason, sessionId, options?: ErrorOptions)`. It builds a message for each reason and sets `name`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\agent-sdk\src\lib\errors\index.ts`
  - Adds the barrel export.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\agent-sdk\src\index.ts`
  - Adds the error to the named error export, so rpc-handlers can import it (R6).
- Evidence: the spec imports the error from `../../errors` and checks it with `instanceof`. agent-sdk typecheck
  passes.

## Task 3.3: Enforce `require-idle` in `SessionStreamPump.sendMessage`

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.ts`
  - The options type widens to `{ origin?, admission? }`.
  - When `admission === 'require-idle'`:
    - A missing record throws `SessionAdmissionRefusedError('session-ended')` instead of the generic `SdkError`.
    - The pump runs a fail-fast `assertAdmissible` before `await createUserMessage(...)`. This is cheap and means a
      doomed submit never builds a message.
    - After the await, `assertAdmissible` runs again synchronously, immediately before `messageQueue.push`.
  - `assertAdmissible` makes these checks, in this order:
    1. `registry.find(id) !== session` (removed or displaced) or `abortController.signal.aborted` refuses with
       `session-ended`.
    2. `turnInFlight || messageQueue.length > 0` refuses with `busy`.
    3. A refusal throws before any push, so nothing is enqueued and `resolveNext` is not woken.
  - One ordering difference applies to the `require-idle` path only: `registry.markActive` runs after admission,
    between the post-await check and the push. A refused submit therefore does not update `lastActivityAt`.
  - Default path (no `admission`): the statements and their order are unchanged. The only addition is one
    `requireIdle` boolean check at each of three branch points. Missing record still throws
    `SdkError('Session not found: ...')`, `markActive` still runs before the await, the log payload is identical,
    and a message sent mid-turn is still held.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-stream-pump.service.spec.ts`
  - The existing v1 cases are unedited.
  - The only other change is an added import line.
  - New cases are appended in a new block, `describe('SessionStreamPump — require-idle admission (TASK_2026_538)')`.
  - The new cases use a deferred `createUserMessage` factory.
  - 16/16 tests pass: 6 existing and 10 new.
- Evidence: the new spec cases.
  1. Admits a message onto a live, idle session and yields it (the positive path).
  2. Refuses a missing session with `SessionAdmissionRefusedError`, reason `session-ended`.
  3. Without `admission`, a missing session still throws `SdkError` and NOT `SessionAdmissionRefusedError`.
  4. Refuses `busy` up front while a turn is in flight. `createUserMessage` is not called and the queue is untouched.
  5. **Race 1:** the record is removed during the await. The submit is refused `session-ended` and the record's queue
     stays empty.
  6. The record is displaced by a re-registration during the await. The submit is refused `session-ended`, and both
     the old and the replacement queues stay empty.
  7. **Race 2:** a competing default-path message is pushed during the await. The submit is refused `busy` and the
     queue holds only `competing`.
  8. A competing message is pushed and drained by the iterator during the await, so a turn is in flight and the queue
     is empty again. The submit is refused `busy` and nothing is pushed.
  9. **Race 3:** the session aborts during the await. The submit is refused `session-ended` and the queue stays empty.
  10. **Default path:** with no `admission`, a message sent mid-turn through the deferred factory resolves and is held
      (`turnInFlight` is true and the queue is `['follow-up']`), as today.

## Task 3.4: Forward `admission` through the lifecycle manager and the adapter

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts`
  - The `sendMessage` options widen to `{ origin?, admission?: AIMessageOptions['admission'] }` and are forwarded
    verbatim to the pump. The doc comment is updated, and `type AIMessageOptions` is added to the existing shared
    import.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
  - `sendMessageToSession` now forwards `{ origin: options?.origin, admission: options?.admission }`. Existing callers
    pass `admission: undefined`, which the pump treats exactly like an absent option.
- Evidence: the existing adapter and lifecycle-manager specs pass unedited. They are part of the green
  `@ptah-extension/agent-sdk:test` run.

## R6

`SessionAdmissionRefusedError` is exported by name from the errors barrel and from the package entry
(`libs/backend/agent-sdk/src/index.ts`). The batch has 7 production files and 1 spec:
- ai-provider.types.ts
- the new error file
- errors/index.ts
- src/index.ts
- the stream pump
- session-lifecycle-manager.ts
- sdk-agent-adapter.ts
- the stream-pump spec

## R10: the effect of `notifyActivity` on a refused admission

`notifyActivity(sessionId, 'user')` stays where it was. It is the first statement of
`SdkAgentAdapter.sendMessageToSession` and runs BEFORE the pump decides admission. I added a one-line comment there
that states this.

Effect when a `require-idle` submit is refused:
- `SessionActivityRegistry.notifyAll` still sends a `role: 'user'` activity event to every subscriber. The subscribers
  found by grep are:
  - the memory-curator trigger (`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:138`)
  - the skill-synthesis trigger (`libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:116`)
- So a refused submit resets those listeners' idle and debounce view of the session, exactly as a user message that
  was accepted would.
- Nothing else happens. No message is queued, no turn starts, and nothing is written to the transcript. Registry
  `lastActivityAt` and `_lastActiveTabId` are NOT touched, because on the `require-idle` path the pump's `markActive`
  runs only after admission.
- Assessment: this is acceptable and low-impact. A refused submit is still a real user action on that session. The
  cost is at most a deferred idle-triggered curation or synthesis run. Moving the call would change behaviour for
  existing callers, which R10 rules out. The reviewer should confirm this disposition.

## Verification

Command:
`npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk @ptah-extension/shared`

1. First run: `agent-sdk:lint` failed with 1 error, `no-unexpected-multiline`, in my new spec helper at line 208. I
   fixed it by splitting the chained `[Symbol.asyncIterator]()` access into two statements.
2. Second run: agent-sdk was all green. `shared:typecheck` and `shared:lint` failed, and I did not change anything in
   response. At that moment the concurrent Batch 1 lane was mid-edit in `libs/shared/src/mcp-apps-contracts/**` (R9).
   A standalone re-run of shared typecheck and lint straight afterwards passed with 0 errors and 5 pre-existing
   warnings.
3. Final run (tail):

```
√  nx run @ptah-extension/shared:lint  [existing outputs match the cache, left as is]
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/agent-sdk:lint
√  nx run @ptah-extension/agent-sdk:typecheck
√  nx run @ptah-extension/agent-sdk:test
 NX   Successfully ran targets typecheck, test, lint for 2 projects
```

Targeted run of the stream-pump spec
(`npx jest -c libs/backend/agent-sdk/jest.config.ts .../session-stream-pump.service.spec.ts`):
`Tests: 16 passed, 16 total`.

Because Batch 1 is still editing shared, standing rule 5 applies: the team-leader should re-run the verification
command after Batch 1 commits.

## Plan deviations

- I added a fail-fast admission check BEFORE the await. The plan requires only the missing-record check there, plus
  the post-await re-check. This addition only refuses earlier on a state the post-await check would refuse anyway,
  and it avoids building a message for a submit that is already doomed.
- On the `require-idle` path, `markActive` runs after admission rather than before the await, so a refused submit
  has no registry side effect. This supports the plan's "typed throw before any side effect". The default path is
  unchanged.

## Out-of-scope observations

None.
