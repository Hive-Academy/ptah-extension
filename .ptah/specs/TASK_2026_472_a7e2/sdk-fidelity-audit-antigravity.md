# SDK Fidelity Audit: `@anthropic-ai/claude-agent-sdk` (0.3.150) vs Fake SDK

## Bottom line

**FAITHFUL WITH DIVERGENCES.** The fake SDK in `session-query-executor.slash-persistence.spec.ts` faithfully models the exact mechanics of `@anthropic-ai/claude-agent-sdk` v0.3.150: `isSingleUserTurn` is strictly derived from `typeof prompt === "string"`, the first `result` message unconditionally closes transport input for single-turn queries, and subsequent writes to an ended transport are silently dropped without error. The identified divergences (e.g., omitting `endInput()` on completion of a finite iterable and simulating subprocess turn results in-memory) are operational simplifications that cannot make the spec falsely pass under Ptah's perpetual stream architecture. A test suite passing against this fake provides real, verified evidence regarding the installed SDK.

---

## Evidence

### 1. Is `isSingleUserTurn` really derived from `typeof prompt === "string"`?

**Yes.** The SDK's top-level entry point `query()` explicitly checks `typeof prompt === "string"` and forwards that boolean down to the query manager class `RU`, which assigns it directly to `this.isSingleUserTurn`.

**Source Excerpts (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`):**

* **Query entry point (`tj$` / `query`)** — *Line 116, Col 1339 (Char offset 845895)*:
```javascript
let{queryInstance:J,transport:Y,abortController:X}=yz(Q,typeof $==="string");return fz(J,Y,$,X),J
```
*(Also in the `sessionStore` branch at Line 116, Col 468 / Char offset 845024: `let{queryInstance:W,transport:G,abortController:U,processEnv:H}=yz({...Q},typeof $==="string",void 0,!0)`)*.
Here `$` is the caller-supplied `prompt` argument (`{prompt: $, options: Q}`).

* **Query instance factory (`yz`)** — *Line 115, Col 4888 (Char offset 843778)*:
```javascript
NG=new RU(az,Q,A,UX,N,tz,rz,y_,HX,cz,pz);
```
Parameter `Q` (the boolean `typeof prompt === "string"`) is passed as the 2nd argument to constructor `RU`.

* **Constructor of class `RU`** — *Line 60, Col 15805 (Char offset 315887)*:
```javascript
constructor($,Q,J,Y,X,W=new Map,G,U,H,q,V){this.transport=$;this.isSingleUserTurn=Q;this.canUseTool=J;this.hooks=Y;this.abortController=X;this.jsonSchema=G;this.initConfig=U;this.onElicitation=H;this.getOAuthToken=q;this.getHostAuthToken=V}
```
Here `this.isSingleUserTurn = Q;` stores the boolean flag directly on the query instance.

*(Note: The alternative warm-session method `startup().query(N)` at Line 116, Col 2486 / Char offset 847042 reinforces this pattern: `if(typeof N==="string")V.setIsSingleUserTurn(!0);`)*.

---

### 2. On the first `result` message, does a single-turn query really call `transport.endInput()`?

**Yes.** Upon encountering any message with `type: "result"` in `readMessages()`, if `this.isSingleUserTurn` is true, the SDK unconditionally invokes `this.transport.endInput()`.

**Source Excerpt (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`):**

* **`RU.prototype.readMessages`** — *Line 60, Col 18518–18655 (Char offset 318600–318740)*:
```javascript
if($.type==="result"){if(this.transcriptMirrorBatcher)await this.transcriptMirrorBatcher.flush();if(this.lastErrorResultText=$.is_error?$.subtype==="success"?$.result:$.errors.join("; "):void 0,this.firstResultReceived=!0,this.firstResultReceivedResolve)this.firstResultReceivedResolve();if(this.isSingleUserTurn)X$("[Query.readMessages] First result received for single-turn query, closing stdin"),this.transport.endInput()}else if(!($.type==="system"&&$.subtype==="session_state_changed"))this.lastErrorResultText=void 0;this.inputStream.enqueue($)}
```

**Guard Analysis:**
The branch `if(this.isSingleUserTurn)X$("[Query.readMessages] First result received for single-turn query, closing stdin"),this.transport.endInput()` contains **zero guards or exceptions**. It does not check whether `streamInput()` is active, whether writes are pending, or whether there was an error. If `this.isSingleUserTurn` is true, the transport input is unconditionally ended upon the first `result`.

---

### 3. What does `streamInput()` actually do when the transport input has ALREADY been ended — throw, silently drop, or buffer?

**It silently drops.** The fake SDK's behavior (`if (inputClosed) return;`) is completely faithful to the installed SDK.

**Source Excerpts (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`):**

* **`RU.prototype.streamInput` loop** — *Line 63, Col 2582 (Char offset 328680)*:
```javascript
for await(let J of $){if(Q++,X$(`[Query.streamInput] Processing message ${Q}: ${J.type}`),this.abortController?.signal.aborted)break;await Promise.resolve(this.transport.write(B$(J)+`\n`))}
```

* **`LU.prototype.write` (`ProcessTransport.write`)** — *Line 60, Col 8568–8670 (Char offset 308650–308750)*:
```javascript
write($){if(this.abortController.signal.aborted)throw new W6("Operation aborted");if(this.spawnResolve){this.pendingWrites.push($);return}if(!this.ready||!this.processStdin)throw Error("ProcessTransport is not ready for writing");if(this.processStdin.writableEnded){L6("[ProcessTransport] Dropping write to ended stdin stream");return}if(this.process?.killed||this.process?.exitCode!==null)throw Error("Cannot write to terminated process");
```

**Mechanism:**
When `transport.endInput()` is called (Line 60, Col 10696 / Char offset 310778: `if(this.processStdin)this.processStdin.end()`), Node.js marks `processStdin.writableEnded = true`. When `streamInput()` subsequently iterates and calls `this.transport.write()`, `LU.prototype.write()` hits:
```javascript
if(this.processStdin.writableEnded){L6("[ProcessTransport] Dropping write to ended stdin stream");return}
```
The SDK does not throw and does not buffer; it logs a debug trace and returns `undefined`. `streamInput()` finishes processing the iterable and its returned Promise resolves successfully. The fake's silent drop in `drain()` matches the runtime behavior exactly.

---

### 4. When the prompt is an async iterable, does the SDK call `endInput()` when that iterable COMPLETES?

**Yes.** In the real SDK, when an async iterable completes its iteration, `streamInput()` calls `transport.endInput()`. The fake never calls `endInput()` for an iterable prompt because Ptah's production stream pump iterable never completes until session abort.

**Source Excerpts (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`):**

* **Query routing for iterable prompts (`fz`)** — *Line 116, Col 11 (Char offset 844557)*:
```javascript
function fz($,Q,J,Y){if(typeof J==="string")Q.write(B$({type:"user",session_id:"",message:{role:"user",content:[{type:"text",text:J}]},parent_tool_use_id:null})+`\n`);else $.streamInput(J).catch((X)=>Y.abort(X))}
```

* **`RU.prototype.streamInput` completion handler** — *Line 64, Col 148–320 (Char offset 328980–329150)*:
```javascript
if(X$(`[Query.streamInput] Finished processing ${Q} messages from input stream`),Q>0&&this.hasBidirectionalNeeds())X$("[Query.streamInput] Has bidirectional needs, waiting for first result"),await this.waitForFirstResult();X$("[Query] Calling transport.endInput() to close stdin to CLI process"),this.transport.endInput()}catch(Q){if(!(Q instanceof W6))throw Q}
```

**Confirmation:**
When the async iterable `$` completes (i.e. the `for await` loop finishes naturally), `streamInput()` logs `[Query] Calling transport.endInput() to close stdin to CLI process` and calls `this.transport.endInput()`.
In Ptah, `SessionStreamPump` provides an open, long-lived async queue that only completes on abort. The fake SDK's omission of `endInput()` on iterable completion correctly mirrors Ptah's operational environment where the prompt stream never terminates during normal multi-turn execution.

---

### 5. Does the SDK do anything else material on the first `result` for a single-turn query — cleanup, checkpointing, aborting child controllers — that the fake omits and that would change the spec's conclusion?

**No.**

**Source Analysis (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`):**
In `RU.prototype.readMessages()` (Line 60, Col 18450–18750 / Char offset 318530–318830), the only operations executed upon receiving a message with `type: "result"` are:
1. `if(this.transcriptMirrorBatcher) await this.transcriptMirrorBatcher.flush();`
2. Setting `this.lastErrorResultText = ...`
3. Setting `this.firstResultReceived = true` and resolving `this.firstResultReceivedResolve` if registered
4. If `this.isSingleUserTurn`: invoking `this.transport.endInput()`
5. Enqueueing the `result` event to `this.inputStream.enqueue($)`

The SDK client layer does **not** call `cleanup()`, does **not** abort `cancelControllers`, and does **not** perform checkpointing on `result`.
All downstream teardown — checkpointing the session, aborting background tasks/subagents with reason `"background"`, and terminating the process — is handled **inside the Claude Code CLI child process itself** when it observes EOF on its standard input (caused by `processStdin.end()`). The SDK's own `cleanup()` is only triggered when the child process exits and stdout closes.
Therefore, `transport.endInput()` is the sole and sufficient trigger for the subagent abortion defect. The fake SDK's modeling of input closure captures the root cause without omitting any client-side intermediary steps.

---

### 6. The bottom line

The fake SDK is **faithful enough that a spec passing against it constitutes real, dependable evidence** about the installed SDK's behavior.

The audit confirms that the core hypothesis of `TASK_2026_472` is 100% accurate against the installed SDK source:
1. Passing a raw string to `query({ prompt })` causes the SDK to flag the query as single-turn (`isSingleUserTurn = true`).
2. Receiving the first `result` causes the SDK to unconditionally execute `transport.endInput()`.
3. Closing transport input causes all subsequent input messages (even via `streamInput()`) to be silently dropped by `ProcessTransport.write()`.
4. Passing an open `AsyncIterable` bypasses `isSingleUserTurn`, preventing `transport.endInput()` from being called on the first `result` and keeping the session input open for subsequent turns.

None of the divergences identified below can produce a false pass.

---

## Divergences

| What the fake does | What the SDK does | Could this make the spec falsely pass? (yes/no + why) |
| :--- | :--- | :--- |
| Sets `inputClosed = true` immediately upon the first result when `isSingleUserTurn = true`. | Calls `transport.endInput()`, which calls `processStdin.end()` and sets `processStdin.writableEnded = true`. | **No.** In both implementations, any subsequent write is rejected at the input boundary before reaching the agent core. |
| Silently ignores messages when `inputClosed = true` (`if (inputClosed) return;`), allowing `streamInput()` to resolve. | In `LU.prototype.write()`, checks `if (this.processStdin.writableEnded) { return; }`, silently dropping data and allowing `streamInput()` to resolve. | **No.** The fake's silent drop is identical to the real SDK's debug-and-return behavior in `ProcessTransport.write()`. |
| Never calls `endInput()` when an `AsyncIterable` completes. | In `RU.prototype.streamInput()`, calls `this.transport.endInput()` when the `for await` loop of a finite iterable completes. | **No.** Ptah's `SessionStreamPump` creates an infinite queue that stays open across turns until aborted. Neither the fake nor the real SDK reaches iterable completion during active sessions. |
| Simulates turns in-memory (`num_turns: text.startsWith('/') ? 0 : 1`) without spawning a child process. | Spawns a Claude Code CLI process over stdio pipes and parses slash commands internally, returning `num_turns: 0` for commands. | **No.** Spec 3 explicitly asserts `typeof promptSeen() !== 'string'`, verifying the input contract at the boundary. Specs 1 and 2 verify session routing. The slash-command execution semantics (`num_turns === 0`) were empirically verified against the live CLI subprocess in `experiment-slash-over-streaminput.md`. |
| Omits `transcriptMirrorBatcher.flush()` on `result`. | Flushes `transcriptMirrorBatcher` if configured. | **No.** Transcript mirroring is an auxiliary file persistence mechanism and does not affect query input readiness or message turn routing. |
| Does not model CLI child process exit or EOF on stdout. | Stdio EOF causes the child process to exit, terminating `readMessages()`. | **No.** The spec tests whether a second turn can be delivered and accepted after a slash command. In the defect case, input was dropped before process exit; in the fixed case, the input remains open. |
