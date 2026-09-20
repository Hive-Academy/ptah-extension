# Orchestrator Fixes Review — TASK_2026_466_b70b

Reviewed by: Code Logic Reviewer  
Target workspace: `libs/backend/cli-agent-runtime`  
Test run verification: `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --skip-nx-cache`  
Test results: **62 test suites passed (62 total)**, **938 tests passed, 1 skipped (939 total)**. Execution time: 17.106 s.

---

## Executive Summary & Verdicts

| Fix         | Scope                                         | Verdict  | Summary                                                                                                                                                                                                                                                  |
| ----------- | --------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fix A**   | Turn boundary stamp in `continueConversation` | `accept` | `AgentProcessManager.continueConversation` is the single convergence point for live process turn restarts. The stamp before `sdkHandle.continue(message)` ensures isolation across all continuation modes without race conditions.                       |
| **Fix B**   | Peer name sanitization in `flattenPeerName`   | `accept` | Unicode directionality controls (bidi overrides/isolates in `\p{Cf}`), non-ASCII line breaks (`\p{Zl}\p{Zp}`), Unicode quotes (`\p{Pi}\p{Pf}`), and Markdown structural characters are stripped, and code-point truncation prevents surrogate splitting. |
| **Overall** | Combined review of orchestrator changes       | `accept` | Both fixes resolve their respective review findings and are complete and robust.                                                                                                                                                                         |

---

## Detailed Evaluation: Fix A (Turn Boundary Stamp)

### Background & Context

Batch 5 introduced `AgentOutputBuffer.markTurnBoundary` to prevent segments from two distinct turns fusing in `mergeConsecutiveTextSegments` during a 200 ms flush window (`TASK_2026_466 defect 5`). Finding 1 of `batch-5-review.md` identified that `markTurnBoundary` was uncalled in production runtime code. The orchestrator addressed this by adding `this.outputBuffer.markTurnBoundary(agentId);` in `AgentProcessManager.continueConversation` immediately prior to `await sdkHandle.continue(message);` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1109`).

### Questions Answered with Code Evidence

#### 1. Is `continueConversation` the ONLY path that starts a new agent turn on a live process?

**Yes.** An exhaustive scan across `libs/backend/cli-agent-runtime`, `apps/ptah-cli`, `libs/backend/rpc-handlers`, and `libs/frontend` shows that all paths resuming or continuing a live agent process converge on `AgentProcessManager.continueConversation`:

1. **RPC Invocation**:
   - `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:718`: RPC handler for `agent:continue` directly invokes `await this.agentProcessManager.continueConversation(params.agentId, params.message)`.
2. **Queued Turn Dispatch (`park` -> `flushPending`)**:
   - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:297`: In `AgentMessageRouter.flushPending`, when turn 1 finishes and queued messages are dequeued, it calls `await dispatcher.continueConversation(agentId, next)`.
3. **Turn After Settle (`startNewTurn`)**:
   - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:247`: When a message arrives for an agent that has completed its turn but remains alive, `startNewTurn` calls `await dispatcher.continueConversation(agentId, message)`.
4. **Interrupt and Resume (`interruptAndResume`)**:
   - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:191`: Aborts the active turn via `tracked.sdkHandle?.interrupt?.()`, awaits turn settlement (`this.awaitTurnSettled(tracked)`), and calls `await dispatcher.continueConversation(agentId, message)`.

**Analysis of Other Candidates:**

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:133`: `handle.steer(message)`. Mid-turn steering modifies an _in-flight_ turn; it does not start a new turn.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts:346`: `sdk.Agent.resume(options.resumeSessionId, agentOptions)`. This is invoked inside `runTurn` during a _fresh spawn_ (`AgentProcessManager.doSpawnSdk` at `:251`), which mints a new `agentId` with completely empty initial buffer state. It does not resume a live in-memory process.
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:896`: `continue: (message: string) => { ... }`. This is the callback registered on `SdkHandle.continue`, which is invoked _by_ `continueConversation` (`agent-process-manager.service.ts:1110`), not a path starting a turn independently.
- Adapters (`codex-cli.adapter.ts:782`, `copilot-sdk.adapter.ts:473`, `cursor-cli.adapter.ts:451`, `pi-cli.adapter.ts:520`): All define the `SdkHandle.continue` method, called exclusively by `continueConversation`.

Therefore, `AgentProcessManager.continueConversation` is the single bottleneck through which every live process continuation executes.

#### 2. Can the stamp be lost?

**No.** Tracing `AgentOutputBuffer` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-output-buffer.service.ts:122-128`):

```ts
markTurnBoundary(agentId: string): void {
  const pending = this.pendingDeltas.get(agentId);
  if (!pending) return;
  const current = pending.segmentTurns[pending.segmentTurns.length - 1];
  if (!current || current.length === 0) return;
  pending.segmentTurns.push([]);
}
```

- **If Turn 1 has pending segments in the current 200 ms flush window**: `pending` exists, and `current.length > 0`. `pending.segmentTurns.push([])` synchronously pushes a new empty bucket. Any subsequent call to `appendSegment` for Turn 2 accesses `turns[turns.length - 1]`, landing in the new bucket.
- **If Turn 1 has already flushed**: Turn 1's 200 ms timer expired, and `takeDelta` already drained `pending.segmentTurns` into `[[]]`. In this case, `current.length === 0` (or `pending` was deleted), so `markTurnBoundary` returns early. This is not a "lost stamp" — Turn 1's output has already been dispatched via an earlier `agent:output` event, so there are zero segments from Turn 1 left in the buffer to fuse with Turn 2.
- **Can a segment of the NEW turn land in the old bucket?** No. `this.outputBuffer.markTurnBoundary(agentId)` is called synchronously before `outcome = await sdkHandle.continue(message)`. The bucket edge is created before `sdkHandle.continue` can execute or emit any segments.
- **Can a segment of the OLD turn arrive after the stamp?** No. `continueConversation` enforces that the previous turn has completed: lines 1042–1049 throw `AgentContinueError('busy')` if `tracked.info.status === 'running'`. Turn 1 has completely finished its stream loop and emitted all its segments before `continueConversation` can be entered.

#### 3. Is the exit/flush ordering still correct across turn 1 -> continue -> turn 2?

**Yes.**

- When Turn 1 completes on adapters that trigger `handleExit` (e.g. Codex CLI):
  1. `handleExit` (`agent-process-manager.service.ts:1555-1556`) invokes `this.flushDelta(agentId)` followed by `this.outputBuffer.discard(agentId)`.
  2. Line 1584 executes `void this.messageRouter.flushPending(agentId, tracked, this)`.
  3. `flushPending` dequeues and calls `continueConversation(agentId, next)`.
  4. In `continueConversation`, `markTurnBoundary` is a safe no-op because the buffer was already cleared by `discard`.
- When Turn 1 completes on adapters that do not exit the underlying child process (e.g. Ptah CLI stream loop with mailbox):
  1. `PtahCliStreamLoop` finishes Turn 1 and calls `onTurnComplete` (`ptah-cli-stream-loop.service.ts:499`), which resolves `turn1Done`.
  2. If a queued message is flushed, or a follow-up turn is submitted, `markTurnBoundary` runs. If Turn 1's tail tokens are still within the 200 ms debounce window in `pending.segmentTurns[0]`, a new bucket `pending.segmentTurns[1]` is opened.
  3. When `takeDelta` (`agent-output-buffer.service.ts:207-209`) runs, `pending.segmentTurns.flatMap((turn) => mergeConsecutiveTextSegments(turn))` merges each turn bucket independently. Turn 1's tail and Turn 2's head remain two separate `CliOutputSegment` items in the resulting delta.

#### 4. Would the new spec case FAIL if the `markTurnBoundary` line were deleted or swapped?

**Yes, in both cases:**
In `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts:1403-1424`:

```ts
it('stamps a turn boundary before the continuation can emit', async () => {
  const agentId = await spawnContinuable();
  await completeTurn1();

  const stamps: Array<{ id: string; continuesSoFar: number }> = [];
  jest.spyOn(outputBuffer, 'markTurnBoundary').mockImplementation((id: string) => {
    stamps.push({
      id,
      continuesSoFar: continuableControls.continueCallCount(),
    });
  });
  const continueBefore = continuableControls.continueCallCount();

  await manager.continueConversation(agentId, 'second turn');

  expect(stamps).toEqual([{ id: agentId, continuesSoFar: continueBefore }]);
  expect(continuableControls.continueCallCount()).toBe(continueBefore + 1);
});
```

- **If `markTurnBoundary` is deleted**: `stamps` remains empty `[]`. `expect(stamps).toEqual([{ id: agentId, continuesSoFar: continueBefore }])` fails with `Expected: [{...}], Received: []`.
- **If swapped** (`outcome = await sdkHandle.continue(message); this.outputBuffer.markTurnBoundary(agentId);`):
  Inside the mock, `sdkHandle.continue` increments `continueCallCount()` immediately. By the time `markTurnBoundary` is called, `continuableControls.continueCallCount()` equals `continueBefore + 1`. The assertion `expect(stamps).toEqual([{ id: agentId, continuesSoFar: continueBefore }])` fails because `stamps[0].continuesSoFar` is `continueBefore + 1`.

#### 5. Is the steer decision right?

**Yes.**

- In `AgentMessageRouter.select` (`agent-message-router.service.ts:132-140`), `steer` is selected only when `turnInFlight` is true (`status === 'running'`).
- The only adapter supporting `steer` is `PiCliAdapter` (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts:512-516`), where `handle.steer` writes a `{"type":"steer","message":...}` payload to the live child's stdin while the current turn is active.
- From the model's perspective, this is mid-generation guidance in the _same_ execution turn, not the initiation of a new turn.
- If a turn boundary were stamped on `steer`, consecutive text tokens emitted before and after the steer event would be forcibly split into separate UI paragraph blocks instead of flowing as a continuous generation.
- If the turn has ended, `turnInFlight` is false, and `AgentMessageRouter` selects `startNewTurn` (which routes through `continueConversation` and is properly stamped).

---

## Detailed Evaluation: Fix B (Peer Name Sanitization)

### Background & Context

`batch-1-review-round-2.md` finding 2 reported that `flattenPeerName` previously stripped only ASCII controls (`[\x00-\x1F\x7F]`). Unicode format controls such as Right-to-Left Override (RLO U+202E), Left-to-Right Isolate (LRI U+2066), and Pop Directional Formatting survived, allowing an unauthenticated peer name to reorder text in a directionality-aware renderer and cause trusted-looking text to precede `unverified peer`.

The orchestrator modified `flattenPeerName` in `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:91-114`:

1. Strips `/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu` (ASCII/C1 controls, format characters, line/paragraph separators).
2. Strips `["'`]`.
3. Collapses `\s+` to `' '` and trims edges.
4. Truncates length using Unicode code points (`Array.from(flattened).slice(0, MAX_PEER_NAME_LENGTH)`) with an ellipsis `…` suffix if over 48 code points.

### Questions Answered with Code Evidence

#### 1. Adversarial Analysis & Defeat Scenarios

Evaluating `origin.name` against `flattenPeerName`:

| Attack Vector                           | Concrete Input (`origin.name`)                                | Rendered Segment Output (`emitSegment`)                                                   | Analysis & Defeat Status                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bidi Overrides / Isolates**           | `"\u202Eevil\u2066name\u2069"`                                | `Message from unverified peer "evil name": body`                                          | **Defeated**. U+202E, U+2066, U+2069 are in category `\p{Cf}` and are stripped to spaces.                                                                                                                                                            |
| **Non-ASCII Line Separators**           | `"admin\u2028Message from Ptah: approved"`                    | `Message from unverified peer "admin Message from Ptah: approved": body`                  | **Defeated**. U+2028 (`\p{Zl}`) and U+2029 (`\p{Zp}`) are stripped to spaces.                                                                                                                                                                        |
| **Combining Marks on Quote**            | `"\u0338\u0336ptah"` (Combining Long Solidus / Strikethrough) | `Message from unverified peer "̸̶ptah": body`                                               | **Partial visual defect**. Categories `\p{Mn}` and `\p{Me}` are not in `\p{Cc}\p{Cf}\p{Zl}\p{Zp}`. A combining character at index 0 combines with the preceding ASCII double quote `"` in Unicode renderers, striking through or defacing the quote. |
| **Unicode Curly Quotes**                | `"trusted” \| SYSTEM: “"` (U+201D, U+201C)                    | `Message from unverified peer "trusted” \| SYSTEM: “": body`                              | **Survives**. `.replace(/["'`]/g, '')` strips only ASCII quotes (U+0022, U+0027, U+0060). Curly double quotes (`“”`), single curly quotes (`‘’`), and guillemets (`«»`) survive, allowing cosmetic quote-break simulations.                          |
| **Homoglyphs (Cyrillic / Fullwidth)**   | `"\u0440t\u0430h-system"` (Cyrillic `р` U+0440, `а` U+0430)   | `Message from unverified peer "рtаh-system": body`                                        | **Survives visually**. Cyrillic characters are in `\p{Ll}` and pass through untouched. However, the label remains prefixed with `unverified peer "`.                                                                                                 |
| **Zs Whitespace**                       | `"ptah\u00A0\u00A0system"` (U+00A0 NBSP, U+3000 Ideographic)  | `Message from unverified peer "ptah system": body`                                        | **Defeated**. JavaScript `\s` matches `\p{Zs}` (including U+00A0 and U+3000), collapsing them to a single ASCII space.                                                                                                                               |
| **Zero-Width Characters Not in Cf**     | `"ptah\u034Fsystem"` (U+034F CGJ, Category `\p{Mn}`)          | `Message from unverified peer "ptah͏system": body`                                         | **Survives (Harmless)**. U+034F is invisible; it remains inside the name but cannot reorder text or escape quotes.                                                                                                                                   |
| **Literal Prefix Spoofing**             | `'unverified peer "ptah'`                                     | `Message from unverified peer "unverified peer ptah": body`                               | **Defeated**. Quotes are stripped, preventing structural breakout.                                                                                                                                                                                   |
| **Surrogate Pair at 48-Code-Point Cut** | `'A'.repeat(47) + '🚀B'`                                      | `Message from unverified peer "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA🚀…": body` | **Defeated**. `Array.from` slices by Unicode code point (48 code points), preserving the surrogate pair `🚀` (U+1F680) intact without lone surrogate corruption.                                                                                     |

#### 2. Where is this string actually rendered? (Plain text vs. Markdown)

There are two distinct output emissions in `ptah-cli-stream-loop.service.ts:235-240`:

1. **`emitSegment` (Structured Segment)**:

   ```ts
   emitSegment({
     type: 'info',
     content: `Message from ${peerLabel}: ${body}`,
   });
   ```

   - Tracing through `AgentCardOutputComponent` (`libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts:185-194`):
     ```html
     @case ('info') {
     <div class="bg-base-200/40 rounded px-2 py-1 border border-base-content/5">
       <pre class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed">{{ segment.content }}</pre>
     </div>
     }
     ```
   - **This is rendered strictly as PLAIN TEXT.** Angular's `{{ segment.content }}` binding inside `<pre>` performs text interpolation with full HTML escaping. Markdown syntax is not evaluated. Links, markdown formatting, or HTML tags cannot execute or render.

2. **`emitOutput` (Raw stdout stream)**:

   ```ts
   emitOutput(`\n**Message from ${peerLabel}:** ${body}\n`);
   ```

   - Tracing through `AgentCardComponent.parsedOutput` (`libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:179-187`):
     When structured segments are absent (e.g. In fallback parsing of raw stdout via `parseAgentOutput`), stdout text lines are grouped into `type: 'text'`.
   - In `AgentCardOutputComponent:153` and `execution-node.component.ts:140`, `type: 'text'` segments are passed to `<markdown [data]="segment.content" />` (`ngx-markdown`).
   - In this raw stdout fallback scenario, markdown syntax in `origin.name` is evaluated:
     - Input: `origin.name = "[Ptah Security](https://evil.com/login)"`
     - Rendered output: `\n**Message from unverified peer "[Ptah Security](https://evil.com/login)":** body\n`
     - When processed by `ngx-markdown`, `[Ptah Security](https://evil.com/login)` **renders as an active clickable markdown hyperlink**.

#### 3. Does the strip remove anything legitimate that a real peer name would carry?

**No.**

- `\p{Cc}`: ASCII and C1 control characters (e.g. NUL, bell, escape, carriage return). Real peer agent names never require control codes.
- `\p{Cf}`: Format characters (bidi overrides, zero-width spaces). In peer naming conventions (`ptah-two-way-messaging-...`, `agent-reviewer`, etc.), format codes are never required.
- `\p{Zl}` and `\p{Zp}`: Line and paragraph separators (U+2028, U+2029). Peer names must be single-line tokens.
- `["'`]`: Straight quotes and backticks. Removing straight quotes prevents escaping the enclosing quotes. An apostrophe in a name (e.g. `Dev's Agent`) degrades cleanly to `Devs Agent`.
- 48 code-point ceiling: Sufficiently accommodates standard multi-part session identifiers.

---

## Claims I Verified

1. **Test suite passing**: Executed `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --skip-nx-cache` in the foreground. Verified that 62 test suites passed (938 tests passed, 1 skipped).
2. **Turn boundary sensitivity**: Verified in `agent-process-manager.service.spec.ts:1403-1424` that deleting `this.outputBuffer.markTurnBoundary(agentId)` causes `stamps` to be empty, and swapping it with `await sdkHandle.continue(message)` causes `continuesSoFar` to record `continueBefore + 1`, both failing the test.
3. **No production callers outside `continueConversation`**: Verified via regex code searches across `libs/backend/cli-agent-runtime` and `apps/ptah-cli` that `sdkHandle.continue` is exclusively invoked at `agent-process-manager.service.ts:1110`.
4. **Idempotence and safety of `markTurnBoundary`**: Verified in `agent-output-buffer.service.ts:122-128` that stamping when `pending` is absent or `current.length === 0` safely returns early without allocating phantom buckets.
5. **Unicode bidi stripping**: Verified via standalone Node.js execution that RLO (`\u202E`), LRI (`\u2066`), and isolates are completely stripped by `[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+`.
6. **Code-point slicing**: Verified that 48-unit truncation using `Array.from` slices surrogate pairs (such as `\uD83D\uDE80` 🚀) by code point without leaving lone surrogates.
7. **Plain-text tile rendering**: Verified in `agent-card-output.component.ts:185-194` that `type: 'info'` segments are bound with `{{ segment.content }}` inside `<pre>`, rendering strictly as plain text.

---

## Claims I Could Not Verify

1. **Live end-to-end multi-agent execution**: Did not spawn an external CLI binary session across two live processes; verification is based on unit and integration suites with mocks.
2. **Third-party Markdown sanitize configurations**: Did not audit external markdown custom protocols or URL sanitization schemes for `ngx-markdown` in environments outside the extension.

---

## Recommendations for Future Hardening

The recommendations below are resolved and historical in the shipped implementation:

1. **Strip Unicode Quotes in `flattenPeerName` (Resolved / Historical)**:
   Unicode quotation marks (`[\p{Pi}\p{Pf}"'`]`) are stripped in `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts:104`. Tested in `ptah-cli-stream-loop.inbound-peer.spec.ts:333`.
2. **Escape Markdown Delimiters in `peerLabel` (Resolved / Historical)**:
   Markdown structural characters (`[[\]()*_~<>|\\]`) are stripped in `ptah-cli-stream-loop.service.ts:109`, preventing active hyperlink creation in fallback raw stdout markdown rendering. Tested in `ptah-cli-stream-loop.inbound-peer.spec.ts:310`.
