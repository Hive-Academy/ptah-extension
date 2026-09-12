# Batch 3 report — TASK_2026_402_a5c7 (Component 5: `sendToAgent`)

Executor: `backend-developer`. Worktree
`D:\projects\ptah-extension\.claude-worktrees\agent-messaging`, branch
`feat/agent-two-way-messaging`. Nothing committed, no stash, no checkout, no `nx reset`,
no edit to `batches.md`.

Status: **BATCH_3_DONE**. Tasks 3.1, 3.2, 3.3 implemented with real code — no stubs, no
`TODO`, no skipped or deleted assertions.

---

## Files

### CREATED

- `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-message-router.service.ts`
  — `AgentMessageRouter` (R-8 extraction): mode selection, the `interrupt-resume` settle
  wait, the bounded pending queue and its flush, plus `AgentMessageError` and
  `MAX_PENDING_MESSAGES = 8`.
- `D:\projects\ptah-extension\.claude-worktrees\agent-messaging\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-message-router.service.spec.ts`
  — 12 unit tests against fake handles and fake records: handle-beats-adapter capability
  resolution, adapter fallback, released-subprocess, the settle-before-resume race, a
  failing resume, and six queue behaviours.

### MODIFIED

- `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
  — `steer()` **deleted**; `sendToAgent(agentId, message): Promise<AgentMessageOutcome>`
  added and delegating to the router; `TrackedAgent.currentTurnDone` and
  `TrackedAgent.pendingMessages` added and written in `trackSdkHandle` /
  `continueConversation`; `handleExit` flushes one queued message; `releaseSubprocess`
  discards the queue; the router injected as the last constructor parameter.
- `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.spec.ts`
  — the two `steer()` tests replaced by a `sendToAgent()` describe with 11 tests (one per
  capability shape, the three unroutable states, the queue cap, the flush, and the
  info-level mode log).
- `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.restore.spec.ts`
  — the restored-record refusal test now drives `sendToAgent` and asserts
  `code: 'restored'` in addition to all three original message assertions.
- `...\libs\backend\cli-agent-runtime\src\lib\cli-agents\index.ts`
  — barrel exports `AgentMessageRouter`, `AgentMessageError`, `MAX_PENDING_MESSAGES` and
  the three router types.
- `...\libs\shared\src\lib\types\agent-process.types.ts`
  — adds `AgentMessageOutcome` **only** (`{ mode: AgentMessagingMode; detail?: string }`).
- `...\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.ts`
  — one-line compile fix: `agentProcessManager.steer(...)` → `await
  agentProcessManager.sendToAgent(...)`. The PtahAPI method name and the
  `ptah_agent_steer` tool name are unchanged, so **no dispatcher needed an edit** (both
  `protocol-dispatcher.ts` and `agent-tool.dispatcher.ts` call `ptahAPI.agent.steer`,
  which still exists). Batch 5 owns the rename.
- `...\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\agent-namespace.builder.spec.ts`
  — the process-manager mock's `steer` jest.fn became `sendToAgent`, and the delegation
  test asserts the call reached `sendToAgent`. Assertion rewritten, never removed.

Nothing else was touched. Batch 6's files (`libs\shared\src\lib\types\execution\*`,
`chat-streaming\**`, the message bubble) show as modified in `git status` — those are the
concurrent executor's.

---

## Task 3.1 — `sendToAgent` replaces `steer`

`AgentProcessManager.steer()` is gone from the class; nothing re-exports it and no
compatibility shim was added.

Split of responsibility (the facade, R-8 — see below): `sendToAgent` owns the three
states of the **map**, the router owns the mechanism.

- `!tracked` → `AgentMessageError('not_found', noSuchAgentMessage(agentId))` — the
  existing "this host holds no record" wording, which is strictly better than the bare
  `Agent not found: <id>` the old `steer` threw, and keeps the load-bearing prefix.
- `tracked.restored` → `AgentMessageError('restored', restoredRecordMessage(...))`,
  carrying the `resume_session_id: <cliSessionId>` recovery hint.
- not running **and** the handle cannot start a new turn →
  `AgentMessageError('not_running', ...)`, opening with the preserved
  `Agent <id> is not running (status: <status>)` phrasing and then naming the resume
  recovery. The second half of that condition is `canStartNewTurn`, read from
  `supportsContinuation()` + `continue` + `!subprocessReleased` — which is what makes a
  **completed-but-alive continuation-capable agent not an error**; it falls through to the
  router and comes back `queue-next-turn` with a detail saying the message starts a new
  turn.

Selection order in `AgentMessageRouter.select`, exactly as specified, from
`caps = handleCaps ?? adapterCaps`:

1. turn in flight + `caps.steer` + `handle.steer` → `handle.steer(message)` → `'steer'`.
2. turn in flight + `caps.interrupt` + `handle.interrupt` → `interrupt()`, await the
   settle, `continueConversation` → `'interrupt-resume'`.
3. `caps.continuation` → in flight: park → `'queue-next-turn'`; otherwise
   `continueConversation` directly → `'queue-next-turn'`.
4. otherwise `'unsupported'` with a `detail` naming the CLI and saying nothing was
   delivered.

`handleCaps` is derived in `resolveCapabilities` from the handle's own declarations
(`typeof handle.steer === 'function'`, `supportsInterrupt?.() === true && typeof
handle.interrupt === 'function'`, `supportsContinuation?.() === true && typeof
handle.continue === 'function' && !subprocessReleased`); the adapter's `capabilities()`
is consulted only when there is no handle. `continueConversation()` and its
`AgentContinueError` codes are byte-for-byte unchanged apart from the one appended
`currentTurnDone` assignment described under Task 3.2.

**Zero vendor branching.** Verified below.

## Task 3.2 — current-turn tracking and the settle race

`TrackedAgent.currentTurnDone: Promise<number>` is written in `trackSdkHandle` from
`sdkHandle.done` and re-written in `continueConversation` from `outcome.done`.

Two details that are the whole point of the field:

- **Registration order.** In both places the assignment is made *after* the
  `done.then(handleExit)` registration, not in the tracked-record literal. Both are
  continuations of the same promise and run in registration order, so a router awaiting
  `currentTurnDone` resumes only once `handleExit` has already moved the record out of
  `running`. Registered first, it would resume before the exit handling and
  `continueConversation` would refuse the resume as `busy` — the exact race the task
  names.
- **Rejection folded, not propagated.** It is stored as
  `done.then((code) => code, () => 1)`. The exit handler above it owns the error
  reporting; a promise nobody may ever await must not be able to raise an unhandled
  rejection.

Belt and braces on top of the ordering guarantee, `awaitTurnSettled` drains up to 20
microtask ticks after the await, exiting on the first tick where `info.status` is no
longer `running`. It is bounded, so a handle that never settles cannot hang the caller —
the resume is then attempted and refused honestly as `unsupported` carrying
`continueConversation`'s own reason, never a false `interrupt-resume`. The router spec
asserts the settle *inside* the fake dispatcher (`expect(tracked.info.status).toBe(
'completed')`), so the assertion fails if the race is ever reintroduced.

## Task 3.3 — the bounded pending queue

`TrackedAgent.pendingMessages: string[]`, in-memory, never persisted, capped at
`MAX_PENDING_MESSAGES = 8`.

- **Park:** a continuation-only agent mid-turn gets the message pushed and
  `'queue-next-turn'` with the position in the detail.
- **Flush:** `handleExit` — the single settle point, reached from both the first turn and
  a continued turn — calls `router.flushPending` as its last statement, after the status
  has gone terminal, so `continueConversation` cannot refuse it as `busy`. **One entry per
  settle**: the turn that flush starts settles again and drains the next, so a queue never
  becomes a burst of overlapping continuations.
- **Refuse over cap:** at 8 waiting, the caller gets `mode: 'unsupported'` with a reason
  naming the limit and stating the message was NOT queued. Pinned in both specs, including
  an assertion that the refused message is absent from the queue afterwards.
- **Teardown:** `releaseSubprocess` calls `discardPending`, which clears and logs a
  warning naming the count. `flushPending` on an already-released record drops the queue
  with an `error` log rather than pretending. A delivery that throws is logged at `error`
  and not re-queued — retrying it at every settle would loop forever on the same failure.

**Observability:** `AgentMessageRouter.route` logs
`'[AgentMessageRouter] Message routed'` at `info` with `{ agentId, cli, mode, pending }`
for every outcome, including refusals. Asserted in both spec files.

## R-8 — how the 700-line ceiling was handled

`agent-process-manager.service.ts` was **already 2180 raw lines (1490 by the lint rule's
count) before this batch**, so the extraction was mandatory rather than marginal.
`AgentMessageRouter` was created with that exact name as an injected collaborator. The
facade rule holds: `AgentProcessManager.sendToAgent` keeps its name and signature and
delegates; no lifecycle method moved; no `helpers`/`utils` file was created.

Three wiring decisions worth recording:

- **No module cycle.** The router does not import the manager. It declares
  `MessageRoutableAgent` (the six-field slice of `TrackedAgent` it touches) and
  `ContinuationDispatcher` (the one manager method it calls); `TrackedAgent` and
  `AgentProcessManager` satisfy both structurally, and the manager passes `this`.
- **The router is stateless.** Every per-agent field it reads or writes lives on the
  tracked record, so an extra instance is harmless.
- **Registration.** It is `@injectable()` and injected via `@inject(AgentMessageRouter)`,
  which tsyringe resolves from the class token without a `register.ts` entry — and I did
  not add one, because `register.ts` is outside this batch's file list and nothing breaks
  without it. Because the parameter also carries a default
  (`new AgentMessageRouter(logger, cliDetection)`), the four places that construct
  `AgentProcessManager` by hand (three spec files and `wiring/sdk-callbacks.spec.ts`)
  compile and run unchanged. **Note for the team leader:** if a later batch prefers the
  explicit form, one `container.registerSingleton(AgentMessageRouter)` line in
  `libs\backend\cli-agent-runtime\src\lib\di\register.ts` is the whole change.

---

## Verification (verbatim)

### `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime @ptah-extension/shared @ptah-extension/vscode-lm-tools --skip-nx-cache`

```
 NX   Running target test for 3 projects:
> nx run @ptah-extension/shared:test
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
Test Suites: 57 passed, 57 total
Tests:       1369 passed, 1369 total
> nx run @ptah-extension/cli-agent-runtime:test
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
Test Suites: 52 passed, 52 total
Tests:       1 skipped, 690 passed, 691 total
> nx run @ptah-extension/vscode-lm-tools:test
A worker process has failed to exit gracefully and has been force exited. This is likely caused by tests leaking due to improper teardown. Try running with --detectOpenHandles to find leaks. Active timers can also cause this, ensure that .unref() was called on them.
Test Suites: 46 passed, 46 total
Tests:       1008 passed, 1008 total
 NX   Successfully ran target test for 3 projects
```

Header reads **3 projects**. `cli-agent-runtime` is 52 suites / 690 passing, up from
Batch 2's 51 / 669 — the new router spec plus 20 net new tests. The 1 skipped test is
pre-existing; this batch skipped nothing. The "worker process has failed to exit" warning
appears in all three projects including `shared` (which this batch barely touched) and
does not appear when the router spec is run alone — it is pre-existing environment noise,
not a leak introduced here.

### `npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared @ptah-extension/vscode-lm-tools`

```
 NX   Running target typecheck for 3 projects:

- @ptah-extension/cli-agent-runtime
- @ptah-extension/shared
- @ptah-extension/vscode-lm-tools

> nx run @ptah-extension/shared:typecheck
> tsc --noEmit --project libs/shared/tsconfig.lib.json

> nx run @ptah-extension/cli-agent-runtime:typecheck
> tsc --noEmit --project libs/backend/cli-agent-runtime/tsconfig.lib.json

> nx run @ptah-extension/vscode-lm-tools:typecheck
> tsc --noEmit --project libs/backend/vscode-lm-tools/tsconfig.lib.json

 NX   Successfully ran target typecheck for 3 projects
```

Header reads **3 projects**.

### `npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools`

```
✖ 37 problems (0 errors, 37 warnings)     # @ptah-extension/cli-agent-runtime
✖ 21 problems (0 errors, 21 warnings)     # @ptah-extension/vscode-lm-tools

 NX   Successfully ran target lint for 2 projects
```

**0 errors.** No warning originates in the new router or its spec. The two warnings on
`agent-process-manager.service.ts` are both pre-existing:

```
libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts
  1049:1   warning  File has too many lines (1490). Maximum allowed is 700  max-lines
  1378:37  warning  Unexpected empty arrow function                         @typescript-eslint/no-empty-function
```

All files touched were run through the repository's prettier before linting.

### Vendor-name grep inside the routing logic

```
$ grep -niE "codex|copilot|cursor|antigravity|opencode|\bpi\b" libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts
exit=1

$ sed -n '/async sendToAgent(/,/^  }$/p;/private static canStartNewTurn/,/^  }$/p' \
    libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts \
  | grep -niE "codex|copilot|cursor|antigravity|opencode|\bpi\b"
exit=1
```

Zero hits in the whole router file and zero in `sendToAgent` / `canStartNewTurn`. Every
CLI name that reaches a caller does so as the interpolated `tracked.info.cli` value, never
as a branch.

### `git status --short` — this batch's files

```
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.restore.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts
 M libs/backend/cli-agent-runtime/src/lib/cli-agents/index.ts
 M libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts
 M libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts
 M libs/shared/src/lib/types/agent-process.types.ts
?? libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.spec.ts
?? libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts
```

The tree also shows Batch 6's files (`libs/frontend/chat-streaming/**`,
`libs/frontend/chat/**`, `libs/shared/src/lib/types/execution/**`). Those are the
concurrent executor's; I did not touch them.

---

## Deviations

1. **Two extra files beyond the named list, both because `steer()` disappeared.**
   `agent-process-manager.restore.spec.ts` (a spec of the service I own) asserted on
   `manager.steer` for a restored record, and
   `agent-namespace.builder.spec.ts` mocked `steer` on the process manager. Both are
   assertion rewrites, not deletions, and both now assert strictly more than before (the
   restore test additionally pins `code: 'restored'`).
2. **Only one of the two predicted compile fixes was needed.** The task predicted edits to
   the PtahAPI namespace builder *and* the MCP dispatcher case for `ptah_agent_steer`.
   Keeping the PtahAPI method named `steer` means both dispatchers
   (`protocol-dispatcher.ts:814`, `agent-tool.dispatcher.ts:342`) still compile untouched —
   the minimal fix, and it leaves the tool name unchanged for Batch 5 as instructed.
3. **"Refuse over size" was implemented as the count cap only.** The Task 3.3 test list
   names "refuse over cap, refuse over size"; the contract defines exactly one limit (8
   entries) and no per-message byte limit anywhere in the plan. I did not invent one — a
   fabricated length ceiling would start refusing legitimate long instructions with a
   number nobody chose. If a size limit is wanted, it needs a number from the architect.
4. **The three record-state refusals live in `sendToAgent`, not in the router.** The plan
   assigns them to Component 5 as a whole; they read the agents map and reuse the manager's
   two private static message builders (`noSuchAgentMessage`,
   `restoredRecordMessage`), and moving them would have meant either exporting those
   builders or duplicating their wording. The facade therefore rejects, and the router
   routes.

## Out-of-scope observations

- `system-namespace.builders.ts:299` still documents the tool as
  `steer(agentId, instruction) - Send instruction to agent stdin`, which was already
  inaccurate for SDK agents and is now wrong about the mechanism. Batch 5 owns the tool
  surface; not touched.
- `SdkHandle.steer`'s doc comment in `cli-adapter.interface.ts:78` still says
  "AgentProcessManager.steer() routes SDK-based agents here". That file is Batch 2's;
  the sentence should read `sendToAgent`. Not touched.
- `agent-process-manager.service.ts` remains far past the soft ceiling (1490 counted
  lines) even after this extraction. The next natural collaborator is the output-buffer
  accumulation and flush group (`appendBuffer` / `accumulate*` / `flushDelta` /
  `cleanupFlushTimer`), which is nameable and self-contained. Out of scope here.
