# Code Logic Review — TASK_2026_619 Batch 13i (commit 4f3578b6c)

Verdict: REVISE (0 blocking, 2 serious, 3 moderate). Read-only review; no specs were run.

Base path: `libs/backend/vscode-lm-tools/src/lib/code-execution/`

## Findings

### Serious

**S1. The cap note is wrong for `mode:"any"` and for a cancelled wait.**
- `mcp-core/agent-wait.tool.ts` `headerOf`, about lines 188-193. `capNote` fires when `cappedFromTimeoutSec !== undefined && running > 0`. It never checks that the cap is what ended the wait. That condition is only "a cap was applied and some lane is still running".
- Scenario: HTTP, `mode:"any"`, `timeoutSec:600`, two lanes. Lane A exits after 5 s, so the wait settles with `timedOut:false` and B still running.
- The reply starts "Wait capped at 45 s on the HTTP transport (requested 600 s); 1 lane(s) still running — call ptah_agent_wait again." The wait was not capped. It finished because the `any` condition was met.
- The `again` instruction is also misleading. The caller wanted the first lane to end and has it.
- The same note is prefixed to `WAIT CANCELLED` replies (`result.cancelled`). Nobody is reading the reply then, but the text is still wrong.
- Fix: emit `capNote` only on the `result.timedOut` branch, since the cap shortened the wait only if the shortened timer fired. In the other branches, drop it.
- The same failure for `mode:"all"` is unreachable, because `all` with running > 0 implies a timeout or a cancel.

**S2. The shared tool description tells stdio callers about the HTTP cap, and the schema is wrong for HTTP.**
- `mcp-core/agent-wait.tool.ts:80` adds "Over HTTP, each call waits at most 45 s". `buildAgentWaitTool()` is shared: `mcp-stdio/tool-builders.ts:121` renames it to `agent_wait` and serves it on stdio unchanged.
- `mcp-core/tool-description.builder.ts:618` (the `ptah_agent_spawn` description, also renamed at `tool-builders.ts:93`) now tells stdio callers "Over HTTP each wait call lasts at most 45 s, so repeat ptah_agent_wait". It also still says "make one ptah_agent_wait call".
- Impact: the stdio contract is confusing. A stdio caller may needlessly loop on 45 s waits, or reason about a cap that does not apply.
- The advertised schema is `timeoutSec` max 900 and "default 600" (`agent-wait.tool.ts:79` and the `timeoutSec` property description around line 104). On HTTP the enforced ceiling is 45, so the default and the max are never honoured.
- Dispatcher comments and the description do disclose it. But a model reading `maximum: 900` and `default 600` is told two things, and the note sits mid-paragraph.
- Fix: build the description per transport, for example `buildAgentWaitTool({ httpCap })`. Or word it transport-neutrally: "Some transports shorten a single wait; if the reply says capped, call again."
- The same applies to the `ptah_agent_spawn` text.

### Moderate

**M1. The specs do not prove the "only when" claims.**
- `mcp-core/agent-spawn-surface-parity.spec.ts`, added test at about lines 412-476.
- Covered: HTTP 600 caps to 45 000 ms with a note; HTTP 20 is unchanged; stdio 600 reaches 600 000 ms.
- Missing:
  - No negative assertion that the note is absent when the lanes ended and timeoutSec > 45. The default `waitApi` has an exited lane, so this is cheap to add. In the short-request case no assertion is made on the text either.
  - No `mode:"any"` case, which would have caught S1.
  - No `timeoutSec:0` case. The code is correct, since `min(0,45)=0` and it is not marked capped, but it is unpinned.
  - Nothing checks that the stdio reply has no note, or that the stdio description has no HTTP wording (S2).
  - The abort signal is asserted as `undefined` in the mocked-api cases only. That is weak evidence that the signal is unchanged.
- The test also cannot discriminate "capped" from "timedOut" because the mock returns `timedOut:true`.
- The `agent-wait.tool.spec.ts` change (+1 line) only pins the description string.

**M2. 45 s is a hard-coded constant with a thin margin and no override.**
- `mcp-core/wait-tools-args.schema.ts` adds `HTTP_MAX_AGENT_WAIT_SEC = 45`. The measured abort was about 60 s.
- 15 s of margin covers the post-wait work: `lastLinesOf` reads for exited lanes and a `statFile` per deliverable (`agent-wait.tool.ts` `describeEntry`).
- A slow disk or a large `read` could eat it, but the margin is probably adequate.
- Other MCP HTTP clients may use shorter timeouts. This is not configurable.
- Low risk, and it is the user-approved value.

**M3. A caller that follows "repeat while running" loses the `any`/`all` intent after each repeat.**
- Each repeat is a fresh wait, so no state is lost. Note that the reply for a capped timeout still says "TIMED OUT after 45s", which reads as an error.
- Clarity only.

### Checked and fine

- **HTTP only.** The cap is applied in the single `AGENT_WAIT_TOOL_NAME` case at `mcp-core/protocol-dispatcher.ts:1387-1397`. `dispatchToolsCall` is the one HTTP route for the tool.
  - I found no per-session or per-profile re-implementation of the tool.
  - The stdio path `mcp-stdio/agent-tool.dispatcher.ts:763-780` passes `parsed.data.timeoutSec` uncapped.
- **`timeoutSec` 0.** It passes through unchanged.
- **Abort signal.** `signal: getRequestAbortSignal()` is unchanged.
- **Reply bound.** `formatAgentWaitSummary` recomputes `room` from the header length, which includes the cap note, and has a final truncation to `WAIT_SUMMARY_MAX_CHARS`. The bound holds.
- **`execute_code` in-sandbox waits.** `ptah.agent.waitFor` and `waitForAgents` (`namespace-builders/agent-namespace.builder.ts:~526 and 566`) are not capped.
  - `execute_code` timeout is `Math.min(timeout, 30000)` (`protocol-dispatcher.ts:3690`), so a long wait inside it is already bounded below 60 s over HTTP.
  - A wait that outlives it is killed by the execution timeout. I did not trace whether `getExecutionAbortSignal()` stops the wait.

## Observations only: other HTTP tools that can block past 60 s

- `ptah_run_check` (`mcp-core/run-check.tool.ts:33,157-176`): `timeoutSec` 1-900, default 600 (`DEFAULT_RUN_CHECK_TIMEOUT_SEC`, `wait-tools-args.schema.ts:36`).
  - Same client abort.
  - The abort signal kills the process tree, so a 60 s client abort cancels the check. The lane report already notes this.
- `ptah_web_search` (`protocol-dispatcher.ts:~1458`): the `timeout` is passed through. I did not check its ceiling.
- Session tools (`ptah_session_start/send/status/read/stop`, `protocol-dispatcher.ts:2181+`): not traced for blocking.
- Dependency tools are already bounded by `GRAPH_BUILD_WAIT_MS` (1.5 s).

## Five logic questions (short)

1. Silent failure: S1 gives a success-looking but false "capped" claim.
2. Unexpected user action: `any` mode plus a long timeout (S1).
3. Wrong-answer input: `mode:"any"`.
4. Dependency failure: unchanged from before the commit.
5. Missing: transport-specific description (S2), negative specs (M1).

## Verdict

REVISE. The core mechanism is correct. Fix S1 (gate the note on `result.timedOut`) and S2 (transport-aware description). Add the negative-case specs from M1.
