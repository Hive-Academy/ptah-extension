# Code Logic Review: TASK_2026_465 Phase A (Antigravity Two-Way Messaging)

**Reviewer note on test execution:** The test, typecheck, and lint verification figures quoted in this report were supplied by the orchestrator and not run directly during this review pass:

- `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --skip-nx-cache`: 62 suites passed, 62 total; 946 passed, 1 skipped, 947 total; exit code 0.
- `npx nx typecheck @ptah-extension/cli-agent-runtime`: exit code 0.
- `npx nx lint @ptah-extension/cli-agent-runtime`: exit code 0, 0 errors, 39 warnings (38 pre-existing across the project, 1 new `max-lines` warning at 707 counted lines against the 700 soft cap).

---

## Verdict

**`accept`**

The implementation correctly fulfills the protocol requirements discovered during live probing of `agy` 1.2.7 (`.ptah/specs/TASK_2026_465_a25a/agy-stream-json-probe.md`). Multi-turn execution operates over a single persistent process with stdin kept open, turns settle on per-turn `result` events, and stdin closes cleanly to trigger process exit when no continuations are queued. Usage accumulation issues are avoided by discarding cumulative `result.usage` and emitting per-turn `step_update.usage`. Security and stability boundaries are preserved: input is validated prior to every stdin write, non-JSON output falls back to raw text, unknown events are surfaced as informational segments rather than crashing, and MCP configuration restoration remains strictly bound to process exit.

---

## Detailed Findings with `file:line` Evidence

### 1. Turn Accounting

#### Promise Bookkeeping & Settle Mechanics

Turn lifecycle is represented by `TurnDeferred` ([`antigravity-cli.adapter.ts:175-195`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L175-L195)), which encapsulates a promise, an idempotent `resolve` closure, and a `settled` boolean flag:

```ts
resolve: (exitCode) => {
  if (deferred.settled) return;
  deferred.settled = true;
  resolvePromise(exitCode);
};
```

At spawn, `currentTurn` is instantiated and captured as `firstTurn` ([`antigravity-cli.adapter.ts:619-620`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L619-L620)). The returned `SdkHandle.done` is mapped to `useStreamInput ? firstTurn.done : done` ([`antigravity-cli.adapter.ts:788`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L788)).

#### Can a `result` settle the WRONG turn?

**No.**

1. `continue()` explicitly checks `if (!currentTurn.settled)` before advancing state ([`antigravity-cli.adapter.ts:797-801`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L797-L801)). It throws synchronously if the active turn is still processing.
2. `agy` executes turns sequentially in stream-json mode (one turn per NDJSON input line, terminating with a `result` event).
3. When `handleLine` parses `event === 'result'`, it invokes `settleTurn?.(event.result.status === 'SUCCESS' ? 0 : 1)` ([`antigravity-cli.adapter.ts:885`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L885)).
4. `settleTurn` resolves `settledTurn = currentTurn` ([`antigravity-cli.adapter.ts:707-708`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L707-L708)).
5. Only after `currentTurn.settled` is `true` can `continue()` be called, which points `currentTurn` to `nextTurn` ([`antigravity-cli.adapter.ts:803-804`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L803-L804)).
   Because turn switching is synchronous and locked to turn settlement, a `result` cannot resolve any turn other than the one currently executing.

#### Can two turns be in flight at once?

**No.**
`continue` is synchronous up to returning `{ done: nextTurn.done }` ([`antigravity-cli.adapter.ts:796-812`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L796-L812)). When a caller invokes `continue()`, `currentTurn.settled` must be `true`. It immediately reassigns `currentTurn = nextTurn` (which has `settled === false`). Any immediate concurrent call to `continue()` in the same or subsequent tick checks `!currentTurn.settled` and immediately throws `'Antigravity is still processing the current turn'` ([`antigravity-cli.adapter.ts:798-800`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L798-L800)).

#### Can a turn's promise hang on spawn error, process error, non-zero close, or kill mid-turn?

**No.** All failure and exit channels resolve the active turn:

- **Spawn error (`child.on('error')`):** Sets `processClosed = true` and resolves `currentTurn.resolve(1)` ([`antigravity-cli.adapter.ts:766-770`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L766-L770)).
- **Process error / non-zero exit (`child.on('close')`):** Sets `processClosed = true` and resolves `currentTurn.resolve(exitCode)` ([`antigravity-cli.adapter.ts:738, 752-755`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L738-L755)).
- **Kill mid-turn (`abortController.abort()`):** `onAbort` initiates `killProcessTree(pid)` ([`antigravity-cli.adapter.ts:660-672`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L660-L672)). The process terminates, emitting `close`, which triggers `currentTurn.resolve(exitCode)` ([`antigravity-cli.adapter.ts:754`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L754)).
- **Trailing partial line before close:** Handled by flushing `lineBuf` before evaluating exit codes ([`antigravity-cli.adapter.ts:741-750`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L741-L750)).

---

### 2. The Stdin Close Race

#### Mechanism Analysis

Closure after a settled turn is handled by `closeAfterSettledTurn` ([`antigravity-cli.adapter.ts:646-658`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L646-L658)):

```ts
const closeAfterSettledTurn = (settledTurn: TurnDeferred): void => {
  setImmediate(() => {
    if (!processClosed && !stdinClosed && currentTurn === settledTurn && settledTurn.settled) {
      child.stdin?.end();
      stdinClosed = true;
    }
  });
};
```

#### Can a message be queued AFTER `setImmediate` is scheduled but BEFORE it runs?

**Yes, and it is handled correctly without message loss or writing to a closing stream:**

- When turn N finishes, `settledTurn.resolve()` is called ([`antigravity-cli.adapter.ts:708`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L708)) and `closeAfterSettledTurn(settledTurn)` schedules a `setImmediate` macrotask ([`antigravity-cli.adapter.ts:647`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L647)).
- Resolving `settledTurn.done` queues microtasks. In `AgentProcessManager`, `outcome.done.then` or `trackSdkHandle`'s handler runs in this microtask phase, triggering `handleExit` ([`agent-process-manager.service.ts:1530`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts#L1530)), which calls `flushPending` ([`agent-process-manager.service.ts:1584`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts#L1584)).
- `flushPending` dequeues the pending message and calls `continueConversation()` ([`agent-message-router.service.ts:297`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts#L297)), which invokes `sdkHandle.continue(message)` ([`agent-process-manager.service.ts:1110`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts#L1110)).
- `sdkHandle.continue` synchronously executes:
  `currentTurn = nextTurn; writeTurn(message);` ([`antigravity-cli.adapter.ts:804, 806`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L804-L806)).
- When the Node event loop enters the `setImmediate` check callback, it checks `currentTurn === settledTurn` ([`antigravity-cli.adapter.ts:651`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L651)). Because `currentTurn` is now `nextTurn`, `currentTurn === settledTurn` evaluates to `false`!
- Stdin is NOT closed (`child.stdin.end()` is skipped). Stdin remains open for Turn N+1.

#### What happens if a message arrives AFTER `setImmediate` has executed?

- `setImmediate` ran: `child.stdin?.end()` was called, and `stdinClosed` was set to `true` ([`antigravity-cli.adapter.ts:654-655`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L654-L655)).
- If a caller now calls `sendToAgent`, `AgentProcessManager.canStartNewTurn(tracked)` calls `handle.supportsContinuation()` ([`agent-process-manager.service.ts:1026`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts#L1026)).
- `supportsContinuation()` checks `!processClosed && !stdinClosed` ([`antigravity-cli.adapter.ts:795`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L795)). Because `stdinClosed === true`, it returns `false`.
- `sendToAgent` rejects with `AgentMessageError('not_running', ...)` ([`agent-process-manager.service.ts:1003-1009`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts#L1003-L1009)), directing the user to resume the conversation instead.
- If `continue()` were directly invoked on the handle, `writeTurn` guards with `if (processClosed || stdinClosed || !child.stdin)` and throws `'Antigravity stdin is no longer writable'` ([`antigravity-cli.adapter.ts:632-634`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L632-L634)).
- Thus, messages cannot be written to a closed stdin and cannot be silently dropped.

#### Can stdin be closed while a turn is still streaming?

**No.**
`closeAfterSettledTurn` is called ONLY from `handleLine` when `header.data.event === 'result'` ([`antigravity-cli.adapter.ts:705-710, 877-887`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L705-L710)). During turn streaming, `agy` emits `step_update` events, never `result`. Stdin closure is never scheduled mid-stream.

---

### 3. Usage Double Counting

#### Verification Against Protocol Probe

The live probe (`.ptah/specs/TASK_2026_465_a25a/agy-stream-json-probe.md:92-97`) demonstrated the following token numbers:

- **Turn 1:**
  - `step_update.agent_response` (DONE): `input_tokens: 11731`, `output_tokens: 36`, `thinking_tokens: 32`, `total_tokens: 11767`.
  - `result`: `usage: { total_tokens: 11767 }`, `num_turns: 1`.
- **Turn 2:**
  - `step_update.agent_response` (DONE): `total_tokens: 11867`.
  - `result`: `usage: { total_tokens: 23634 }` (cumulative across turns 1 and 2: 11,767 + 11,867 = 23,634), `num_turns: 2`.

#### Implementation Handling

- In `handleStepUpdate` ([`antigravity-cli.adapter.ts:962-973`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L962-L973)):
  When `step.step_type === 'agent_response'` and `step.state === 'DONE'` with `step.usage`, per-turn usage is emitted:
  ```ts
  const usageStr = `Usage: ${step.usage.input_tokens ?? 0} input, ${step.usage.output_tokens ?? 0} output tokens`;
  emitOutput(`\n[${usageStr}]\n`);
  emitSegment({ type: 'info', content: usageStr });
  ```
- In `handleResult` ([`antigravity-cli.adapter.ts:980-997`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L980-L997)):
  `result.usage` is completely ignored. Only errors are emitted for non-`SUCCESS` results.
- **Consumer Total:** The consumer observes 11,767 tokens for Turn 1 and 11,867 tokens for Turn 2. The cumulative sum across both turns is 23,634. If `result.usage` had been emitted, Turn 2 would have reported 23,634 on top of Turn 1's 11,767, inflating the reported token usage to 35,401. This is pinned by unit test `antigravity-cli.adapter.spec.ts:697-719`.

---

### 4. The Capability Probe

#### Execution and Error Handling

`probeStreamJsonInput` ([`antigravity-cli.adapter.ts:265-299`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L265-L299)):

- Spawns `binary --help` with an 8-second timeout ([`antigravity-cli.adapter.ts:284-287`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L284-L287)).
- Inspects collected output on `close`: `finish(/--input-format\b/.test(help))` ([`antigravity-cli.adapter.ts:295`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L295)).
- **Probe failure / timeout / missing binary:**
  - If `resolveCliPath('agy')` fails in `detect()`, `installed: false` and `messagingMode: unsupported` are returned ([`antigravity-cli.adapter.ts:221-227`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L221-L227)).
  - If `spawnCli` errors on binary spawn, `child.on('error')` triggers `finish(false)` ([`antigravity-cli.adapter.ts:296`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L296)).
  - If the timer fires after 8 seconds, `child.kill()` is called and `finish(false)` executes ([`antigravity-cli.adapter.ts:284-287`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L284-L287)).

#### Safe Path Fallback

When `probeStreamJsonInput` evaluates to `false`:

- `capabilities().continuation` returns `false` ([`antigravity-cli.adapter.ts:257-263`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L257-L263)).
- In `runSdk`: `useStreamInput` is `false`. The argv falls back to `['--output-format', 'stream-json', ..., '--print', taskPrompt]` ([`antigravity-cli.adapter.ts:552, 575`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L552-L575)).
- Stdin is closed immediately: `child.stdin?.end(); stdinClosed = true;` ([`antigravity-cli.adapter.ts:642-643`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L642-L643)).
- `supportsContinuation` and `continue` are omitted from the returned `SdkHandle` ([`antigravity-cli.adapter.ts:793-814`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L793-L814)).
- The adapter strictly reverts to the legacy one-shot mode (`mode: unsupported`).

#### Cache Invalidation on In-Process Binary Upgrade

`this.streamJsonInputSupported` is cached indefinitely on the adapter instance once set:

```ts
if (this.streamJsonInputSupported !== undefined) {
  return this.streamJsonInputSupported;
}
```

([`antigravity-cli.adapter.ts:266-268`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L266-L268)).
`AntigravityCliAdapter` is registered as a DI singleton. If a user upgrades `agy` while the host process (e.g., VS Code extension host or Electron app) remains running, subsequent calls to `detect()` or `runSdk()` will return the cached boolean and will not re-probe `--help` until the host process restarts. This is an acceptable, minor edge case consistent with other CLI version caching in the codebase.

---

### 5. The Validation Boundary

#### Schema Definition & Coverage

The input schema is defined at [`antigravity-cli.adapter.ts:167-170`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L167-L170):

```ts
const AgyInputMessageSchema = z.object({
  event: z.literal('user'),
  message: z.object({ content: z.string() }),
});
```

Every write to `child.stdin` routes through `writeTurn`:

- First turn: [`antigravity-cli.adapter.ts:639`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L639) (`writeTurn(taskPrompt)`).
- Continuation turns: [`antigravity-cli.adapter.ts:806`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L806) (`writeTurn(message)`).
  No unvalidated raw writes to `child.stdin` exist in the file.

#### Can a Message Containing Newlines Split into Multiple NDJSON Lines?

**No.**
Inside `writeTurn` ([`antigravity-cli.adapter.ts:623-636`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L623-L636)):

```ts
const parsed = AgyInputMessageSchema.safeParse({
  event: 'user',
  message: { content: message },
});
...
child.stdin.write(`${JSON.stringify(parsed.data)}\n`);
```

Standard `JSON.stringify` automatically escapes newline characters (`\n` -> `\\n`, `\r` -> `\\r`).
For example, a prompt containing `"line1\nline2"` serializes to:
`{"event":"user","message":{"content":"line1\\nline2"}}`
There is no literal newline character (`0x0A`) inside the serialized string; the only literal newline byte is the terminal delimiter appended by `${...}\n`. `agy`'s line reader parses exactly one line and decodes the newline within the string. It cannot split into multiple NDJSON lines.

---

### 6. MCP Rules

Section "Ptah's own MCP server at spawn time" in `libs/backend/cli-agent-runtime/CLAUDE.md`:

1. **Snapshot is a LOCAL in `runSdk`:**
   - [`antigravity-cli.adapter.ts:592-599`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L592-L599):
     `let priorMcpEntry: McpServerConfig | undefined;`
     It is declared as a local variable inside `runSdk`, preventing concurrent `agy` runs from clobbering each other's snapshots.
2. **`cleanupMcpEntry` RESTORES rather than deletes:**
   - [`antigravity-cli.adapter.ts:505-516`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L505-L516):
     ```ts
     if (prior === undefined) {
       await facet.remove('', PTAH_SPAWN_MCP_KEY);
     } else {
       await facet.write('', PTAH_SPAWN_MCP_KEY, prior);
     }
     ```
     If `CodeExecutionMCP` previously wrote a persistent server entry, it is written back rather than removed.
3. **Cleanup fires exactly once across the longer-lived multi-turn process:**
   - [`antigravity-cli.adapter.ts:780-784`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L780-L784):
     ```ts
     if (options.mcpPort) {
       done.then(() => {
         this.cleanupMcpEntry(priorMcpEntry);
       });
     }
     ```
     Notice that `cleanupMcpEntry` is attached to `done` ([`antigravity-cli.adapter.ts:736-778`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L736-L778)), which is the promise created for `child.on('close')` / `child.on('error')`.
     Even though `SdkHandle.done` returns `firstTurn.done` ([`antigravity-cli.adapter.ts:788`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L788)), the MCP cleanup is intentionally NOT attached to `firstTurn.done` or any intermediate turn's promise. It fires once and only once when the underlying child process terminates.

---

### 7. File Size Decision

`AntigravityCliAdapter` has 707 counted lines (excluding comments and blanks) against a 700 soft ceiling in ESLint (`max-lines`), producing 1 lint warning.

- **Author's decision:** The author opted not to split the file, noting that 707 is only 7 lines over the soft ceiling and well below the repository's 1000-line review threshold.
- **Review assessment:** The author's decision is sound and acceptable. A 7-line overflow to keep a cohesive protocol parser adjacent to its single adapter consumer does not warrant premature fragmentation.
- **Candidate extraction (if mandated in future refactoring):**
  If extraction is desired in a future cleanup pass, the cleanest boundary would be `antigravity-stream-json.protocol.ts`, containing:
  - Zod schemas and types (`AgyUsageSchema`, `AgyToolInfoSchema`, `AgyStepUpdateSchema`, `AgyResultSchema`, `AgyInitEventSchema`, `AgyInputMessageSchema`) ([`antigravity-cli.adapter.ts:99-174`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L99-L174), ~75 lines).
  - The `TurnDeferred` interface and factory ([`antigravity-cli.adapter.ts:175-195`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L175-L195), ~20 lines).
    This would remove ~95 lines from the adapter, bringing it down to ~612 counted lines without touching the process lifecycle logic.

---

## Test Sensitivity Analysis

The accompanying unit tests in `antigravity-cli.adapter.spec.ts` are sensitive to regressions in the guarded behaviors:

1. **Attached empty print flag:** Tested at [`antigravity-cli.adapter.spec.ts:245-252`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts#L245-L252). If reverted to separate `--print <prompt>`, the assertion `expect(argsArg[0]).toBe('--print=')` fails immediately.
2. **First turn written to stdin:** Tested at [`antigravity-cli.adapter.spec.ts:265-271`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts#L265-L271). Reverting to one-shot fails the `child.stdin.write` expectation.
3. **Multi-turn promise resolution & continuation:** Tested at [`antigravity-cli.adapter.spec.ts:483-528`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts#L483-L528). If `handle.done` waited for process close rather than `result`, the first turn promise would timeout.
4. **Stdin closure on turn completion:** Tested at [`antigravity-cli.adapter.spec.ts:524-525`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts#L524-L525). If `closeAfterSettledTurn` were omitted, `stdin.end` would not be called.
5. **Cumulative result usage suppression:** Tested at [`antigravity-cli.adapter.spec.ts:697-719`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts#L697-L719). Asserts `expect(segments).toEqual([])` when receiving a `result` with usage; emitting `result.usage` fails this test.
6. **Input validation guard:** Tested at [`antigravity-cli.adapter.spec.ts:530-551`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts#L530-L551). Bypassing input validation would write malformed JSON to `stdin.write`, failing `expect(currentChild?.child.stdin.write).toHaveBeenCalledTimes(...)`.

---

## Claims I Verified

1. Argv construction attaches the empty value as `--print=` and sets `--input-format stream-json` and `--output-format stream-json` ([`antigravity-cli.adapter.ts:544-551`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L544-L551)).
2. All writes to child stdin pass through `writeTurn`, validating each turn with `AgyInputMessageSchema` ([`antigravity-cli.adapter.ts:622-636`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L622-L636)).
3. `JSON.stringify` escapes newlines and control characters, preventing line splitting across NDJSON boundaries ([`antigravity-cli.adapter.ts:635`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L635)).
4. `continue()` enforces sequential turn execution via `currentTurn.settled`, preventing overlapping turns ([`antigravity-cli.adapter.ts:797-801`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L797-L801)).
5. Settle resolution handles spawn errors, process exits, mid-turn kill aborts, and trailing lines ([`antigravity-cli.adapter.ts:660-672, 737-777`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L660-L672)).
6. `closeAfterSettledTurn` checks `currentTurn === settledTurn`, correctly aborting stdin closure if a continuation turn was queued before the `setImmediate` fires ([`antigravity-cli.adapter.ts:646-658`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L646-L658)).
7. `supportsContinuation()` checks `!stdinClosed`, preventing writes to an already-closed stdin stream ([`antigravity-cli.adapter.ts:795`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L795)).
8. Cumulative usage on `result` is ignored; only per-turn `agent_response` usage is emitted ([`antigravity-cli.adapter.ts:962-997`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L962-L997)).
9. Capability probe failures and timeouts safely fall back to legacy one-shot behavior ([`antigravity-cli.adapter.ts:265-299, 572-576`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L265-L299)).
10. MCP snapshot is a local variable in `runSdk` and cleanup is executed exactly once chained to process termination `done` ([`antigravity-cli.adapter.ts:592, 780-784`](../../../libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts#L592)).

---

## Claims I Could Not Verify

1. **Live end-to-end host execution:** Did not run a live Ptah VS Code / Electron host with an interactive `ptah_agent_message` call against a real `agy` 1.2.7 binary on disk.
2. **Behavior on historical pre-1.2.5 `agy` binaries:** Verified fallback logic through probe mocking in unit tests (`antigravity-cli.adapter.spec.ts:938-960`), but did not execute against a physical pre-stream-json binary.
3. **Phase B (opencode probe):** Opencode probe was outside Phase A scope and was not evaluated.
