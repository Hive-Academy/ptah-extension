# Acceptance evidence — TASK_2026_472_a7e2

Status at time of writing: **4 of 5 acceptance items closed. Item 5 is NOT
closed and is the gate before this task can move to `done`.**

## The change

Five files, one behavioural change: `SessionQueryExecutor` no longer special-cases
a slash command. Every prompt is queued as an `SDKUserMessage` and delivered
through the persistent stream — the initial iterable for a new session, the idle
iterable plus `streamInput()` for a resumed one, which is the pattern resumed
non-slash sessions already used.

| File | Change |
| --- | --- |
| `session-query-executor.service.ts` | The slash branch is gone: no raw-string prompt, no `isSlashCommand`, no `hasAttachments` bypass, `streamInput` connected on `isResume` alone |
| `sdk-query-runner.service.ts` | `InteractiveRunInput.prompt` and `invokeWithLoadedQuery` narrowed from `string \| AsyncIterable` to `AsyncIterable` — closes the door rather than leaving it merely unused |
| `slash-command-interceptor.ts` | The false premise corrected (acceptance item 4) |
| `session-lifecycle-manager.ts` | `executeSlashCommandQuery` docblock corrected |
| `chat-session.service.ts` (rpc-handlers) | Comment naming the now-deleted `isSlashCommand` and `promptMode` literal corrected |

Plus `agent-sdk/CLAUDE.md` (watchdog bullet) and two spec files.

## Item 1 — a spec that fails without the fix and passes with it

`session-query-executor.slash-persistence.spec.ts`. Measured both ways on
2026-09-19.

Against the pre-fix executor (restored from HEAD, spec unchanged): **3 of 3 fail.**

```
● a resumed slash command … accepts a second turn
  Expected length: 2      Received length: 1
  Received array: [{"num_turns": 0, "text": "/context"}]
● an initial slash command … accepts a second turn
  Expected length: 2      Received length: 1
● the SDK is never handed a raw string prompt
  expect(typeof promptSeen()).not.toBe('string')   Expected: not "string"
```

The failure is the mechanism itself: one result instead of two, because the input
closed on the first `result`. Against the fixed executor all three pass.

The spec asserts message counts, turn counts and prompt shape. It contains no
elapsed-time assertion, and it never treats `streamInput()` resolving as proof of
liveness — the proof is the second `result` in the same session, exactly as the
experiment's control case requires.

## Items 2 and 3 — typecheck and tests

- `npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers` — passes.
- `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers` — passes.
  - `agent-sdk`: **113 suites / 1994 tests** (baseline 111 / 1984; the delta is this task's two new suites).
  - `rpc-handlers`: **103 suites / 3127 tests.**

One loose end, recorded rather than hidden: a single agent-sdk test failed once
under `nx run-many`, and the output did not name it. Three consecutive full runs
afterwards were green. I checked the specific way this task could plausibly cause
it — an existing spec whose `streamInput` rejects would now be escalated to a
stop — and it cannot: the only such specs are in
`subagent-message-dispatcher.spec.ts`, which calls `streamInput` directly and
never goes through `SessionQueryExecutor`. Unreproduced and unexplained; it
should be watched on the next full run rather than assumed to be noise.

## Item 4 — the stale comment

Corrected at `slash-command-interceptor.ts`, and the sweep was widened past it,
because that one comment had already propagated the same false premise into three
more places:

- `session-lifecycle-manager.ts` — `executeSlashCommandQuery` docblock
- `agent-sdk/CLAUDE.md` — the no-activity watchdog bullet ("a slash-command string prompt never goes through the pump")
- `session-query-executor.service.spec.ts` — the idle-hold describe header
- `rpc-handlers/chat-session.service.ts` — a comment naming `isSlashCommand` and the dead `promptMode` literal

## Item 5 — NOT CLOSED

A real background subagent surviving the end of a slash-command parent turn has
**not** been demonstrated. It needs a live Ptah session, running a slash command
that spawns background subagents, against a build of this branch. No unit spec
and no source audit can stand in for it.

What the source audit DID establish (`sdk-fidelity-audit-antigravity.md`, three
quotes independently re-verified against the installed 0.3.150):

1. `isSingleUserTurn` is derived from `typeof prompt === "string"` — `yz(Q,typeof $==="string")`.
2. On the first `result` it closes stdin with no guard —
   `if(this.isSingleUserTurn)X$("[Query.readMessages] First result received for single-turn query, closing stdin"),this.transport.endInput()`.
3. A later write is silently dropped, not thrown —
   `writableEnded){L6("[ProcessTransport] Dropping write to ended stdin stream");return`.
4. The SDK client itself does nothing else on that first `result`: no `cleanup()`,
   no controller abort, no checkpoint.

Point 4 is the one that bears on item 5. It rules the SDK client OUT as the source
of the `background` abort, which narrows the remaining candidate to the Claude
Code CLI child reacting to EOF on its own stdin. If that is right, the fix removes
the trigger, because EOF is now never sent.

**Treat that last step as an inference, not a result.** The CLI binary's own
source was not read, and the live checkpoint was not reproduced. It is a reason to
expect item 5 to pass; it is not item 5 passing.

## The swallowed input-channel error — FIXED

Raised by the codex logic review (finding 1). I first recorded it as out of
scope. That was the wrong call, and the user overruled it: a session whose only
delivery channel is dead must not report success.

`SessionQueryExecutor.onInputChannelFailed` replaces the bare `logger.warn`. It
logs the provider error, resolves pending permissions, then stops the session
with a surfaced error.

**A rejection there is never normal teardown**, which is what makes stopping
safe. Verified in the installed `sdk.mjs` 0.3.150:

- `streamInput`'s own catch is `catch(Q){if(!(Q instanceof W6))throw Q}`, and
  every `new W6(...)` in the bundle is an abort message
  (`"Operation aborted"`, `"Connection aborted"`, `"Connection aborted by user"`,
  `"Claude Code process aborted by user"`). An aborted session therefore
  RESOLVES rather than rejecting.
- Two non-abort throws remain reachable from `ProcessTransport.write`:
  `ProcessTransport is not ready for writing` and
  `Cannot write to terminated process`. The second fires when the CLI child dies
  mid-session. That is the case that must not be swallowed, and it is why this
  handler is not dead code.

Three details carried over from the watchdog's abort policy, each load-bearing:

1. Pending permissions are resolved BEFORE the stop, so an in-flight
   `can_use_tool` cannot wedge the UI.
2. The stop reason contains neither "abort" nor "cancel", because
   `StreamTransformer` classifies those as benign user aborts and suppresses
   them at debug level.
3. The provider's own message goes to the log and NEVER into the stop reason —
   otherwise a provider error containing the word "abort" would silence a real
   failure through rule 2. Pinned by a spec.

Spec: `session-query-executor.input-channel-failure.spec.ts`, 7 tests. Measured
both ways: against the old `logger.warn` body, **4 of 7 fail** — the four that
assert the new behaviour. The other three are controls (a healthy resolving
channel, an already-stopped session, and the initial path which has no separate
input channel at all) and pass either way, which is the shape a real regression
spec should have.

## Reviews

| Lane | Family | Verdict | Deliverable |
| --- | --- | --- | --- |
| codex | codex | APPROVE WITH FINDINGS | `code-logic-review-codex.md` |
| ollama cloud | Ollama Cloud | APPROVE WITH FINDINGS (8/10) | `code-style-review-ollama.md` |
| antigravity | antigravity | FAITHFUL WITH DIVERGENCES | `sdk-fidelity-audit-antigravity.md` |

Three families, none of them the author. Every finding acted on except the one
recorded above.
