# TASK_2026_350 — chat:continue must intercept slash commands before the idle resume

## Evidence

Baseline: `tmp/logs/log.log`, one `chat:continue` for `/orchestrate  asset-audit`
against session `b5399ba8-…` that was NOT active.

| line | log                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 2292 | `RpcHandler: Handling method "chat:continue"`                                                                 |
| 2295 | `[RPC] Session b5399ba8-… not active, attempting resume...`                                                   |
| 2313 | `[SessionLifecycle] Executing query for session … {"isResume":true,"hasInitialPrompt":false}`                 |
| 2317 | `Starting SDK query … {"isSlashCommand":false,"promptMode":"idle+streamInput"}` — **query #1 spawns the CLI** |
| 2319 | `[RPC] Session … resumed successfully`                                                                        |
| 2320 | `[SlashCommandInterceptor] Command intercepted: {"action":"new-query","commandName":"orchestrate"}`           |
| 2324 | `[SessionLifecycle] Ending session` — the query started 4 lines earlier is torn down                          |
| 2335 | `[SessionLifecycle] Interrupt timed out (5s)`                                                                 |
| 2336 | `Session ended` / 2337 `Stream ended: aborted`                                                                |
| 2350 | `Starting SDK query … {"isSlashCommand":true,"promptMode":"string (slash command + resume)"}` — **query #2**  |
| 2354 | `[WARN] [RPC] slow handler: {"method":"chat:continue","durationMs":8524.5}`                                   |
| 2364 | `record was replaced before stream exit — leaving the newer query alone`                                      |

Two CLI spawns (each ~1.6 s of event-loop cost even off-thread, see
TASK_2026_341) plus a hard 5 s interrupt timeout = the 8.5 s handler.

Second defect, line 2376:

```
[WARN] [SdkMessageTransformer] Unknown message type: {"type":"user","message":{"role":"user",
"content":"<command-message>orchestrate</command-message>\n<command-name>/orchestrate</command-name>\n<command-args>asset-audit</command-args>"},
…,"isReplay":true}
```

## Root cause

**Defect 1 — order of two decisions in one method.**
`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:561`
awaits `autoResumeIfInactive(...)`, and only at **:581** does it call
`slashCommandRouter.routeFollowUpSlashCommand(...)`. The resume is therefore
decided with no knowledge of whether the prompt is a slash command.

`autoResumeIfInactive` → `SdkAgentAdapter.resumeSession` (`sdk-agent-adapter.ts:732`)
→ `SessionQueryExecutor.executeQuery` with **no `initialPrompt`** (the `prompt`
field on the resume config is never forwarded), so
`session-query-executor.service.ts:282` picks the `isResume && !isSlashCommand`
branch and starts an `idle+streamInput` query. Milliseconds later the router
reaches `SdkAgentAdapter.executeSlashCommand` →
`SessionLifecycleManager.executeSlashCommandQuery`
(`session-lifecycle-manager.ts:528`), whose first act is
`await this._control.endSession(sessionId)` — which finds the freshly-registered
record, calls `rec.query.interrupt()` and loses the 5 s race at
`session-control.service.ts:181-189`.

The executor already handles "slash command + resume" correctly in ONE query
(`session-query-executor.service.ts:277-281`). Nothing downstream needs fixing;
the caller simply asks the wrong question first.

Note `executeSlashCommandQuery` is already correct for a session that does not
exist: `registry.find` returns `undefined`, `realSessionId` falls back to the
id argument, and `SessionControl.endSession` returns immediately on
`if (!rec)` (`session-control.service.ts:120-125`) — no interrupt, no 5 s wait.
So skipping the resume needs no new code in `agent-sdk`.

**Defect 2 — a type guard that excludes replays, and its counterpart nobody calls.**
`libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:370-372`:

```ts
export function isUserMessage(msg: SDKMessage): msg is SDKUserMessage {
  return msg.type === 'user' && !('isReplay' in msg && msg.isReplay);
}
```

`isReplayMessage` is defined right below it (`:374-376`) and is referenced
**nowhere in the repo**. So every `type:'user'` message with `isReplay:true`
falls past all twelve narrowing branches in
`sdk-message-transformer.ts:143-258` and lands on the
`'[SdkMessageTransformer] Unknown message type'` warn at **:260**. The
`<command-message>` payload is only the visible instance — the resumed query
replays the whole prior transcript, and any replayed user turn hits the same warn.
The messages are already dropped (`return []`), and dropping is correct: Ptah
renders history from JSONL via `chat:resume`, so re-emitting a replayed turn
would double-render it. Only the classification is wrong.

## Files

- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` — decide slash before resume
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-slash-before-resume.spec.ts` — new
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` — explicit replay branch
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.replay.spec.ts` — new

Deliberately NOT touched: `SessionLifecycle*`, `SdkAgentAdapter`,
`SlashCommandInterceptor`, `ChatSlashCommandRouterService`,
`claude-sdk.types.ts`. The fix is a reordering at the one call site plus one
missing branch; every downstream path is already correct.

## Plan

1. In `continueSession`, classify the prompt with the pure static
   `SlashCommandInterceptor.isSlashCommand(prompt)` (same regex the router's
   `intercept()` uses, so the two decisions cannot disagree, and no second
   `Command intercepted` debug line is emitted).
2. When it IS a slash command, skip `autoResumeIfInactive` entirely and fall
   straight through to `routeFollowUpSlashCommand`, which is terminal for every
   non-passthrough action. `justResumed` stays `false` — it only gates the
   stop-intent interrupt, which a slash command never reaches.
3. Active session + slash: unchanged by construction —
   `autoResumeIfInactive` returns `{ justResumed: false }` with no side effects
   when `hasLiveSessionStream` is true, so removing that call from the slash path
   removes a no-op.
4. Non-slash prompts: untouched, resume exactly as before.
5. In `SdkMessageTransformer.transform`, add an `isReplayMessage(sdkMessage)`
   branch after the user-message block: debug-log and `return []`.

## Acceptance criteria

- Inactive session + `/orchestrate asset-audit` → `resumeSession` NOT called,
  `executeSlashCommand` called exactly once, no `interrupt`/`endSession`
  from the RPC layer, exactly one SDK query launched.
- Inactive session + plain text → `resumeSession` called exactly as before,
  `executeSlashCommand` not called.
- Active (live-streaming) session + slash → `executeSlashCommand` called,
  `resumeSession` not called (unchanged from today).
- Active session + plain text → no resume, `sendMessageToSession` called.
- A `type:'user'`, `isReplay:true` message with `<command-message>` content
  produces zero events and zero `logger.warn` calls.

## Test projects

`@ptah-extension/rpc-handlers`, `@ptah-extension/agent-sdk`

```
npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk
npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk
```

## Implementation notes

### What changed

**`chat-session.service.ts` — `continueSession`.** One classification hoisted
above one call:

```ts
const isSlashCommand = SlashCommandInterceptor.isSlashCommand(prompt);

let justResumed = false;
if (!isSlashCommand) {
  const resumeOutcome = await this.autoResumeIfInactive(/* … */);
  if ('error' in resumeOutcome) return resumeOutcome.error;
  justResumed = resumeOutcome.justResumed;
}
```

The **static** `SlashCommandInterceptor.isSlashCommand` is used rather than the
injected `intercept()` for two reasons: it is the same regex the router's
`intercept()` applies, so the two decisions cannot drift apart; and it is pure,
so the interceptor still emits exactly one `Command intercepted` debug line per
prompt instead of two.

`justResumed` only gates the autopilot stop-intent interrupt further down, which
a slash command can never reach — `routeFollowUpSlashCommand` returns a result
for every non-passthrough action and `continueSession` returns on it. So
initialising it to `false` on the slash path changes nothing reachable.

**`sdk-message-transformer.ts`.** `isReplayMessage` — exported since it was
written, called nowhere — now has its branch, above `isSystemInit`. Debug log,
`return []`. The events emitted are identical to before (none); only the log
level and the message change.

Nothing in `agent-sdk`'s session lifecycle was touched. It did not need to be:
`executeSlashCommandQuery` already opens with `endSession`, which returns on
`if (!rec)` when nothing is registered, and `SessionQueryExecutor` already
builds the single `string (slash command + resume)` query. Commit `07a91cda0`
(session-import / adapter-lifecycle races) was read first and touches none of
this.

### Behaviour after the fix, per quadrant

| session  | prompt           | before                                           | after                                    |
| -------- | ---------------- | ------------------------------------------------ | ---------------------------------------- |
| inactive | `/orchestrate …` | resume query → end → 5 s interrupt → slash query | slash query only                         |
| inactive | plain text       | resume + `sendMessageToSession`                  | unchanged                                |
| active   | `/orchestrate …` | no-op resume check → slash query                 | slash query (the no-op check is skipped) |
| active   | plain text       | `sendMessageToSession`                           | unchanged                                |

### One deliberate non-change

`ChatSlashCommandRouterService` still reads `mcpServerRunning` from
`sdkContext.isMcpServerRunning()` and ignores the `ensureRegisteredForSubagents`
result that `continueSession` computes for the resume path (TASK_2026_332). That
gap predates this task and closing it would alter the ACTIVE-session slash path,
which this fix is required to leave alone. Left for its own task.

### Verification

`npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk`
— header `Running target test for 2 projects`; **rpc-handlers 91/91 suites,
2530 passed; agent-sdk 81/81 suites (1 skipped file), 1244 passed**. Green.

`npx nx run-many -t typecheck -p …` — 2 projects, clean.
`npx nx run-many -t lint -p …` — 2 projects, 0 errors (pre-existing warnings only).

Two earlier runs failed on files owned by concurrent agents mid-edit
(`vscode-core/git-info.service.ts` missing `cachedRead`, then
`agent-sdk/internal-query.service.ts` missing `resolveLane`). Both cleared on
their own without any change from this task; the final run above is clean.

New specs:

- `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-slash-before-resume.spec.ts` — 8 tests over all four quadrants, plus "no teardown of its own" and "does not fall through to `sendMessageToSession`".
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.replay.spec.ts` — 4 tests: the literal log.log:2376 payload, an ordinary replayed turn, a NON-replayed turn that must still transform, and a genuinely unknown type that must still warn.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.spec.ts` — 2 appended tests pinning that `endSession` on an unregistered id arms no timer, with a non-vacuity partner proving a registered record DOES arm the 5 s one. Fake timers, never a wall-clock budget.

## Follow-up (judge round 1)

The judge found a fifth state my classification gate had silently taken over:
**registered but not streaming** — the dead record / corpse. Finding upheld, and
the test gap was the worse half of it.

### The gap

`autoResumeIfInactive` has a corpse-cleanup branch (`chat-session.service.ts`,
`isSessionActive === true && hasLiveSessionStream === false`). My gate skips that
whole method for a slash command, so for a dead record the only teardown left
was `executeSlashCommandQuery`'s unconditional `endSession`, which finds a real
`rec` and can run the full interrupt race. And the new spec's harness drove
`isSessionActive` and `isStreaming` from one `opts.live` boolean, so the state
was **unrepresentable** — no test could have caught it.

The state is genuinely reachable: `SessionRegistry.find` is
`byTabId.get(id) ?? bySessionId.get(id)` (`session-registry.service.ts:212`), so
a corpse registered under a tabId is found by the SDK UUID `chat:continue`
carries.

### The fix, and the trap in it

New private `endDeadRecordBeforeSlashCommand(sessionId, tabId)`, called only on
the slash branch. It returns immediately unless the record exists AND is not
streaming, so both judged slash quadrants are untouched by construction.

The non-obvious part is **which teardown it calls**. The natural move — reuse
`sdkAdapter.endSession`, as the corpse branch in `autoResumeIfInactive` does —
is wrong here: `IAIProvider.endSession` returns **`void`**
(`ai-provider.types.ts:280`), and `SdkAgentAdapter.endSession` fires the
lifecycle teardown with a bare `.catch()`. The `await` on it awaits `undefined`.
The corpse would therefore still be registered when
`executeSlashCommandQuery` ran its own `endSession`, and the same record would
be torn down **twice concurrently** — two interrupt races for one query, i.e.
worse than the bug being fixed.

`interruptSession` is the awaitable teardown (`Promise<void>` →
`await sessionLifecycle.endSession`). With it, the registry is empty by the time
the router runs and the slash query's `endSession` returns on `if (!rec)`:
exactly one teardown, exactly one query.

Two things this does NOT claim. It does not make a wedged corpse tear down
faster — one interrupt race remains, and shortening it means changing
`SessionControl.endSession` (agent-sdk, all callers), which is outside this
task's blast radius. What it removes is the possibility of a _second_ race, and
it fixes a real drop: `executeSlashCommandQuery` reaches
`SessionControl.endSession` directly, bypassing the adapter wrapper that calls
`flushPendingUserActivityFor`, so the dead session's buffered user activity was
being discarded. Routing through `interruptSession` restores that flush.

### Tests

Harness now takes `SessionState { registered, streaming }` with three named
constants (`NO_RECORD`, `LIVE`, `DEAD_RECORD`) instead of one `live` boolean, so
the third combination is expressible. Four tests added (26 → 30 in `chat/session`):

- dead record + slash → `interruptSession` once, `endSession` **not** called
  (asserting the void/awaitable distinction directly), no resume, router once
- dead record + slash → teardown completes **before** the router runs (ordering
  is the point; a late teardown means a second race)
- dead record + slash → a rejecting teardown is non-fatal, command still runs
- dead record + plain text → unchanged: helper does not fire, the resume path's
  own `endSession` cleanup handles it

Plus a regression assertion on live + slash: neither `interruptSession` nor
`endSession` fires, because tearing down a live record would kill the stream the
user is watching.

### Verification (round 1)

`npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk`
— header `Running target test for 2 projects`; **rpc-handlers 91/91 suites,
2534 passed; agent-sdk 81/81 suites, 1251 passed**. `typecheck` 2 projects clean;
`lint` 2 projects, 0 errors.

## Follow-up (judge round 2)

Landed after `2b83f9219`. Both recommendations taken; the second turned out to
fix a race rather than tidy a call.

### 1. `endRecord` now deregisters unconditionally

`SessionControl.endRecord` reached `registry.remove(rec)` only after
`cleanupPendingPermissions` → `beginSessionTeardown` → `markAllInterrupted`, and
the first two sat outside ANY `try`. A synchronous throw from any of them
rejected the teardown **with the record still registered** — so
`interruptSession` rejected, the id stayed live, and
`executeSlashCommandQuery`'s own `endSession` then found a live `rec` and paid a
second full interrupt race. The stall this task removes, reachable through the
error path.

Abort + removal moved into a `deregister()` closure, called at its normal place
and again from an outer `finally`. Happy-path call order is byte-identical
(`cleanupPendingPermissions → markAllInterrupted → interrupt → abort → removal
→ endSessionTeardown → notifyAll`); only the throwing path changes.

Two ordering properties deliberately preserved:

- **The SessionEnd notification stays outside the `finally`**, after the
  try/finally, so a failed teardown rethrows WITHOUT announcing a clean session
  end. Making removal unconditional does not mean making the notification
  unconditional.
- **`deregister` is once-only rather than relying on idempotence.**
  `registry.remove` deletes by `rec.tabId` with no identity check, so a second
  call is only harmless while no NEW record holds that key. Running it once
  removes the question instead of depending on the answer.

### 2. The plain-text corpse branch — done, and it closed a real race

`autoResumeIfInactive`'s corpse cleanup did `await this.sdkAdapter.endSession(...)`.
`IAIProvider.endSession` returns **`void`** (`ai-provider.types.ts:280`) and the
adapter fires the lifecycle teardown with a bare `.catch()`, so that `await`
awaited `undefined` and returned immediately.

That is not merely a slow-path cosmetic. `resumeSession` runs next and registers
the replacement under the **same tabId**, while the corpse's teardown is still in
flight — and `SessionRegistry.remove` deletes by `rec.tabId` with **no identity
check**. The corpse's late removal therefore evicts the REPLACEMENT: a live
session absent from the registry. That is precisely the hazard
`endSessionIfTokenMatches` exists to prevent on the slash path, unguarded here.

One line — `endSession` → `interruptSession` (`Promise<void>`, genuinely awaits
`sessionLifecycle.endSession`). Scope did not widen: the branch's `try/catch`,
its warn, and every caller signature are unchanged, and both corpse paths now
kill the record the same way and differ only in what they do afterwards.

Cost accepted: `chat:continue` on a dead record now waits for that teardown
instead of racing it. Correctness over latency — and the session was already in
a degraded state by construction.

### Tests (+5; agent-sdk `session-control` 7 → 10, `chat/session` 30 → 31)

`session-control.service.spec.ts`:

- throwing `cleanupPendingPermissions` → registry empty, controller aborted, AND
  still rejects. Both halves asserted together: "registry empty" alone would
  pass if the method swallowed the error, and swallowing is not wanted.
- throwing `markAllInterrupted` (the deepest of the three) → same
- happy path deregisters **exactly once** — the guard against the new `finally`
  double-removing

`chat-continue-slash-before-resume.spec.ts`:

- dead record + plain text now asserts `interruptSession`, with `endSession`
  asserted NOT called on either corpse path
- new ordering test: the teardown is fully complete **before** `resumeSession`
  registers the replacement. Written with a real `await` boundary inside the
  teardown mock, so a fire-and-forget implementation fails it.

### Verification (round 2)

`npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/agent-sdk`
— header `Running target test for 2 projects`; **rpc-handlers 91/91 suites,
2535 passed; agent-sdk 81/81 suites (1 file skipped), 1263 passed**.
`typecheck` 2 projects clean; `lint` 2 projects, 0 errors.

One run also printed Jest's "a worker process has failed to exit gracefully"
warning. It did not reproduce on a re-run and comes from the real worker threads
the `off-thread-process-spawner` specs start (TASK_2026_341), not from anything
here.
