# Review 10b-1 revise 1 — Codex App Server lane adapter

Verdict: REVISE
Score: 7/10
Review family: ollama-cloud/Glm vs codex

## Fix check

1. OK — TS7030 is gone. The late-open callback (`codex-app-server-lane.adapter.ts:238`) is typed
   `void`, contains no `return` statement on any path, and handles the close promise inside itself
   with `.catch` (`:240-243`); the rejection handler returns `undefined` on its only path (`:245`).
2. OK — one close on startup abort. `closeContext` (`:215-218`) memoizes a single close promise
   (`Promise.resolve().then` also converts a synchronous `close()` throw into a rejection). The
   abort listener's `close()` (context still unset), the late-open handler (`:240`) and the
   startup-abort branch (`:248`) share that one promise, and all three pass the same context
   (exactly one `runtime.open` per run). A close failure is not swallowed: `close()` logs and
   emits an error segment (`:228-232`), the late path logs (`:240-243`), and a failure awaited at
   `:248` surfaces through the outer catch. The race spec pins one `close` call and zero pending
   timers (`spec:310-311`).
3. OK — an idle stream end is fatal. `:305` throws whenever the stream ends and `!closed`; the
   catch (`:306-312`) emits the error segment, rejects any in-flight turn, and closes the lane, so
   `supportsContinuation()` turns false (`:370`) and a later `continue` rejects (`:372`). The
   abort path stays quiet (both sides re-check `closed`). The idle-end spec pins the error
   segment, one close, false continuation, and the rejected continue (`spec:317-330`).
4. OK in the adapter — `roleDelivery` flips only in the turn-start success path: `onStarted`
   (`:336`) runs after `startTurn` settled and `active` is set, and the continuation supplies the
   flip only when the role prefix is non-empty (`:387-389`). A refused continuation
   (`:372-373`) leaves it at `developer-instructions`.

## New defects

1. **blocking** — `codex-app-server-lane.adapter.spec.ts:219-220`: the new refused-continuation
   assertion runs before the first turn is active. When `runSdk` resolves it has only queued the
   turn-start chain; `active` is set only after `startTurn`'s receipt settles
   (`codex-app-server-lane.adapter.ts:321-336`), which is still in flight at that await.
   Scenario: the test calls `continue('refused while active')` one await after `runSdk`;
   `active` is undefined, so `continue` does not reject — it builds the prompt, starts a second
   turn on the same context, and returns a fulfilled promise; the `.rejects` matcher fails
   ("Received promise resolved instead of rejected") and the lane is left with two concurrent
   turns. Confirmed with a standalone Node probe mirroring the exact call chain (async `runSdk`
   starting the turn before returning, `continue` guarded on `active`): `active` is unset at that
   await and becomes set only after a microtask flush; the refused `continue` proceeded and did
   not reject. Fix: flush microtasks before the refused call (for example
   `await new Promise((resolve) => setImmediate(resolve));` before spec line 219), then assert
   the rejection; `getRoleDelivery` stays `developer-instructions` as line 221 expects.

Note (not a defect): reading `getRoleDelivery()` right after
`await handle.continue?.('second task')` (`spec:227`) passes — the probe shows the `task-prompt`
flip lands inside that same await window — but the margin is microtask-tight (the flip is three
microtask hops behind the `continue` call). A flush there would make the assertion robust against
engine scheduling changes.