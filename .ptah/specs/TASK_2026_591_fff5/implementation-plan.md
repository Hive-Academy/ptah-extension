# Implementation Plan - TASK_2026_591 (Phase 2: steer and interrupt through `opencode serve`)

Status: DESIGN ONLY. `context.md` gates Phase 2 behind user approval ("Produce an
`implementation-plan.md` and stop for approval before any code"). Nothing below
is approved until the user answers `## Open Questions for the User`.

## Inputs and constraints

- Requirements used:
  - `D:\projects\ptah-extension\.ptah\specs\TASK_2026_591_fff5\context.md` (Phase 2 section, Phase 1 scope, out-of-scope list)
  - `D:\projects\ptah-extension\.ptah\specs\TASK_2026_465_a25a\opencode-serve-probe.md` (measured v2 server, opencode 2.0.11)
  - `D:\projects\ptah-extension\.ptah\specs\TASK_2026_402_a5c7\steering-research.md` (one-shot classification, §1.5; not re-read in depth — context.md summarises it and no decision here depends on more)
  - Source in the worktree `D:\projects\ptah-extension\.claude-worktrees\task-591-opencode-messaging` (identical to `main` at `0b6686d15`; Phase 1 `continue()` has NOT landed there yet)
  - `opencode serve --help` and `opencode run --help` on the installed v2.0.12 (run read-only for this plan)
- Corrections applied: none.
- Design handoff used: none (no UI work).
- Missing decision-critical input:
  - **Phase 1 `continue()` is not in the tree yet.** This plan builds on its contract as stated in `context.md` §Phase 1 (spawn `run --session <id>` after the turn ends, `capabilities().continuation = true`, same emitters). Resolution: Phase 2 is sequenced after Phase 1 merges; the run handle is treated as a black box that satisfies `SdkHandle.continue` (`cli-adapter.interface.ts:121-122`).
  - **Event names beyond the probe** (tool calls, reasoning, errors, execution failure) were not measured. Resolution: the plan specifies a fixture-capture step and treats every unmeasured name as an Assumption.
  - **Whether `opencode serve` reads `OPENCODE_CONFIG_CONTENT` for its own sessions** could not be settled from `--help`. Resolution: strong indirect evidence (below) plus a mandatory live check that gates Batch 2.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `SdkHandle` already carries every hook needed: `done`, `onSegment`, `getSessionId`, `supportsContinuation`/`continue`, `steer(message): void`, `interrupt(): Promise<void>`/`supportsInterrupt`, `getPid` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts:97-147` | No new handle contract is needed except the `steer` return type (Component 7). |
| `steer` is typed `(message: string) => void` — fire and forget | `cli-adapter.interface.ts:128` | An HTTP POST that can fail cannot report failure through this signature. |
| Router picks steer > interrupt > continuation; reads the HANDLE first, adapter `capabilities()` only when the handle is gone; returns `mode: 'steer'` synchronously after calling `handle.steer` | `agent-message-router.service.ts:128-150`, `:336-359` | A server-backed handle that exposes `steer` is routed to steer while running and to `continue` when idle, with no router edit. `interrupt` is never chosen while `steer` exists. |
| `interruptAndResume` awaits `handle.interrupt()`, then `currentTurnDone`, then `continueConversation`; a thrown interrupt becomes `unsupported` | `agent-message-router.service.ts:170-209` | `interrupt()` must resolve only after the turn's `done` settled and must throw on a failed HTTP call. |
| `continueConversation` refuses a `running` record as busy, marks the turn boundary, awaits `sdkHandle.continue(message)`, wires `outcome.done` to `handleExit` | `agent-process-manager.service.ts:1815-1886` | Server `continue()` must return a fresh per-turn `done`; the serve process outlives each turn. |
| Lane-budget guard calls `handle.steer` inside a sync try/catch | `agent-process-manager.service.ts:1045-1070` | Must tolerate a Promise-returning `steer` (Component 7). |
| Stop path aborts the handle, then `killProcessTree(getPid())` | `agent-process-manager.service.ts:2548-2556` | Server handle's `getPid` must return the `opencode serve` pid so the existing tree-kill reaps it. |
| Cursor handle: `startTurn` tracks `activeTurn`; `interrupt` cancels only the current run, awaits the turn, rethrows failure; `continue` = `startTurn(message)` | `cursor-cli.adapter.ts:442-512` | Closest pattern for the server handle's turn bookkeeping. Reused, not shared (different transport). |
| Pi declares `{ steer: true, interrupt: false, continuation: true }`; steer writes to a live channel | `pi-cli.adapter.ts:201-205` | Precedent for a lane that steers and continues. |
| opencode run path: native `.exe` resolution, `resolveDirectSpawn` so the pid is the real process, `detached: true`, `killProcessTree` on abort, `OPENCODE_CONFIG_CONTENT` env per process | `opencode-cli.adapter.ts:568-647`, `:604-611` | The serve spawn reuses the same binary resolution, env and kill path verbatim. |
| "`--standalone` makes `run` start a private server from the child's own env" (measured on 2.0.12) | `opencode-cli.adapter.ts:32-42` | Strong evidence that a private opencode server process loads `OPENCODE_CONFIG_CONTENT` from its own env — the basis for the per-lane server answer. |
| `run` working directory = spawn `cwd`; `--dir` is rejected by 2.0.11 | `opencode-cli.adapter.ts:14-20` | `serve` gets `cwd: workingDirectory` too; no directory flag. |
| `run --help` probe cached per binary, cleared by `detect()` | `opencode-cli.adapter.ts:243-247`, `:251`, `:503-521` | Same caching shape for the serve-surface probe. |
| `ptahMcpServerUrl(port, workingDirectory, agentId)` encodes the agent id in the MCP URL | `opencode-cli.adapter.ts:528-544`; `cli-adapter.interface.ts:69-78` | MCP config is per AGENT, not per binary — a shared server cannot carry it. |
| `classifyCliStderr` already maps stderr lines to segment types | `opencode-cli.adapter.ts:679-684` | Reused for serve stderr. |
| `CliOutputSegmentType` = text, thinking, tool-call, tool-result, tool-result-error, error, info, command, file-change | `libs/shared/src/lib/types/agent-process.types.ts:400-409` | Target vocabulary for the SSE mapper; no new segment type. |
| Global `fetch` + `AbortSignal.timeout` is the established HTTP pattern in this lib, with an injectable fetch seam in one client | `mcp-directory/oauth/mcp-oauth.service.ts:252`, `mcp-directory/smithery-connections.client.ts:214`, `:332` | HTTP client uses global fetch with an injectable `fetch` for specs; no new HTTP dependency. |
| No SSE consumer exists in `cli-agent-runtime`; the only parser is inside `auth-providers` translation proxy | `auth-providers/src/lib/translation/translation-proxy-base.ts:1608` | Small local parser; do not import across libs for ~40 lines. |
| Adapter-specific submodules live in a folder beside the adapter, with `__fixtures__` | `cli-adapters/codex/` (`codex-exec-args.ts`, `codex-native-binary.ts`, `__fixtures__/`) | New opencode serve units go in `cli-adapters/opencode/`. |
| Real-TCP fake servers are an accepted spec pattern | `platform-core/src/testing/contracts/run-http-server-provider-contract.real-tcp.spec.ts`, `auth-providers/.../opencode-translation-proxy.spec.ts` | Specs may run a loopback `http.createServer` fake. |
| `opencode serve` flags on 2.0.12: `--hostname`, `--port`, `--cors`, `--service`, `--stdio`; no `--standalone`; `--print-logs` "server logs require --standalone" | `opencode serve --help` (run for this plan) | Spawn with `--hostname 127.0.0.1 --port <n>` only. `--stdio` exists but is unmeasured (Open Question 4). Never pass `--service`. |
| `run` has `--server <url>` | `opencode run --help` (run for this plan) | Not used in this design (would re-introduce one-shot turns); noted as rejected alternative. |
| Server prints `server listening on http://127.0.0.1:<port>` and `server password <pw>` on stdout; Basic auth user `opencode`; Bearer and `x-opencode-password` refused | `opencode-serve-probe.md:30-39` | Readiness and credential come from stdout lines. |
| `/openapi.json` answers JSON only with `Accept: application/json`; otherwise 200 HTML shell for every path | `opencode-serve-probe.md:44-47` | Surface probe must send the header AND validate the body is JSON with the expected paths; status alone proves nothing. |
| `POST /api/session/{id}/prompt` returns the inbox record in 8-10 ms; every prompt (including the first) goes through the inbox; `delivery` defaults to `steer` | `opencode-serve-probe.md:72-89`, `:109-113` | `done` comes from the event stream, never from the POST. |
| `steer` delivered at the next `session.step.ended`; `queue` after the last step; one `session.execution.succeeded` covers both | `opencode-serve-probe.md:91-166` | A steer/queue sent mid-execution extends the SAME execution; turn completion is the execution terminal event. |
| `POST /interrupt` → 200 `{"interrupted":true}`, then `session.step.failed`, `session.execution.interrupted` within 12 ms | `opencode-serve-probe.md:168-177` | `interrupt()` resolves on `session.execution.interrupted`. |
| Session cwd was the SERVER's cwd | `opencode-serve-probe.md:185-186` | Per-lane server spawned with `cwd = workingDirectory` gives the session the right directory. |
| Session created with `permissions: [{action:'*', resource:'*', effect:'allow'}]` | `opencode-serve-probe.md:127-128` | Candidate mapping for `autoApprove`; not equal to `--auto` (Open Question 3). |

## Answers to the open questions

### Q1. Per-lane vs shared server — **per-lane**

- The MCP entry is per agent: `ptahMcpServerUrl(port, workingDirectory, agentId)` (`opencode-cli.adapter.ts:539`) carries the agent id that makes `ptah_agent_report` attributable (`cli-adapter.interface.ts:69-78`). One server has one merged config, so a shared server could carry at most one agent's URL. A shared server would need a per-session MCP override in the API; the probe found none in `session.prompt`'s body (`opencode-serve-probe.md:72-73`) and `session.create`'s body was not inspected.
- The existing run path already pays a private server per turn (`--standalone`, `opencode-cli.adapter.ts:32-42`), so a per-lane `serve` costs no more and is cheaper across turns (one server per lane, not per turn).
- Lifetime and kill are trivial: one process per handle, `getPid()` returns it, the manager's existing tree-kill applies (`agent-process-manager.service.ts:2551-2555`).
- **How MCP reaches the session:** spawn `opencode serve` with `OPENCODE_CONFIG_CONTENT` in its env, exactly as `run` gets it today (`opencode-cli.adapter.ts:604-611`). Sessions hosted by that server load that server's config.
  - Verified indirectly: a `--standalone` private server honours the child's env (`opencode-cli.adapter.ts:32-42`, measured 2.0.12).
  - **Assumption A1** (gates Batch 2): `opencode serve` honours `OPENCODE_CONFIG_CONTENT` the same way. Check: spawn `serve` with the env set to an `mcp.ptah` entry pointing at a running Ptah MCP port, create a session, prompt "list your MCP tools", and confirm a `ptah_*` tool call appears on `GET /api/event` (or read the resolved config from whatever config operation `/openapi.json` lists). If A1 is false, the server transport is NOT shipped (a lane without `ptah_agent_report` is worse than a lane without steer) — the adapter stays on the run transport and Phase 2 stops with a report.
- Never use the user's background service (`opencode pair`, `opencode-serve-probe.md:41-43`): it does not see our env and is the user's process.

### Q2. Credential capture

- Parse two stdout lines from the spawned server, anchored: `^server listening on (http://127\.0\.0\.1:\d+)\s*$` and `^server password (\S+)\s*$` (format verified, `opencode-serve-probe.md:32-33`). Ready = both seen.
- **Assumption A2:** opencode accepts a caller-chosen password via an env var (opencode 1.x documented `OPENCODE_SERVER_PASSWORD`). Check: spawn with the env set and see whether the printed password equals it and Basic auth with it returns 200. If true, Ptah generates 32 random bytes (base64url) and still requires the stdout line only for readiness; if false, the printed value is used. Either way the code path is the same: credential = printed value.
- The password is held only in the handle's closure. It is NEVER forwarded to `output`/`segment` emitters, never logged: the stdout reader consumes the `server password` line and emits nothing for it; every other stdout/stderr line is passed through a redactor that replaces the password string before `classifyCliStderr` (`opencode-cli.adapter.ts:679-684`).
- `Authorization: Basic base64("opencode:" + password)` on every request (verified, `opencode-serve-probe.md:36-38`).

### Q3. SSE parsing and mapping to `CliOutputSegment`

- `GET /api/event` with `Accept: text/event-stream` + Basic. Opened BEFORE the first `POST /prompt`, because the first prompt emits `session.inbox.enqueued` → `session.execution.started` within ~5 ms (`opencode-serve-probe.md:85-89`).
- Incremental parser (WHATWG framing): split on blank line (`\n\n` or `\r\n\r\n`), concatenate multiple `data:` lines with `\n`, honour `event:` if present, ignore `:` comment/heartbeat lines and `id:`/`retry:`. Cap a single frame at 1 MiB (same cap and `info` notice as the JSONL path, `opencode-cli.adapter.ts:660-667`). A frame whose `data` is not JSON is skipped (same degradation rule as `handleLine`, `opencode-cli.adapter.ts:745-754`).
- Event discrimination: **Assumption A3** — the JSON carries `type` (e.g. `session.text.delta`) and a `sessionID` (or `properties.sessionID`). Check against the captured fixture. The stream is server-wide; frames for any other session id are dropped (only ours exists on a per-lane server, but the filter is cheap and makes resume/fork safe).
- Mapping (measured names in **bold**; others Assumption A4, resolved by the fixture and by the event schemas in `/openapi.json`):

| opencode event | Segment / effect |
| --- | --- |
| **`session.text.started`** | none; begin per-part buffer |
| **`session.text.delta`** | `text` with the delta (also to `onOutput`) |
| **`session.text.ended`** | none (final text already streamed; if no delta was seen for the part, emit its full text once) |
| reasoning started/delta/ended (A4; the probe saw "reasoning/text continue", `:116`) | `thinking` |
| **`session.step.started`** | none |
| **`session.step.ended`** | usage `info` segment when it carries tokens/cost (mirrors `handleStepFinish`, `opencode-cli.adapter.ts:873-896`) |
| **`session.step.failed`** | `info` "step failed: <reason>" — NOT terminal (see Q-recovered below) |
| tool call started/completed (A4) | `tool-call` + `tool-result` / `tool-result-error`; `bash` → `command` with exit code (mirrors `handleToolUse`, `opencode-cli.adapter.ts:820-867`) |
| **`session.inbox.enqueued`** / **`session.inbox.delivered`** | bookkeeping for owned inbox ids; `info` "message delivered to the running turn" on delivered for a steer we sent |
| **`session.execution.started`** | turn state → running |
| **`session.execution.succeeded`** | turn terminal, exit 0 (subject to the pending-inbox rule in Q4) |
| **`session.execution.interrupted`** | turn terminal, exit 0, `info` "turn interrupted; partial step discarded" |
| execution failed (A4; name unmeasured, likely `session.execution.failed`) | `error` segment with the message, turn terminal, exit 1 |
| error / retry events that are not execution-terminal (A4) | `info` (never `error`) |
| permission asked (A4) | `info` naming the permission; see Risk R5 |
| any other `session.*` | dropped at debug level (NOT `info` — the server-wide stream is far chattier than `run --format json`, and the JSONL fallback's "surface unknown events" rule at `opencode-cli.adapter.ts:778-781` would flood the lane view) |

- The mapper is pure: `(event, state) => { segments, outputText, transition }`, so it is unit-tested against fixtures with no I/O.

### Q-recovered. `provider.invalid-output` must not fail the lane

- Rule: **only an execution-terminal event decides the exit code.** Any error carried by `session.step.failed`, a retry event, or an error event during an execution that later reports `session.execution.succeeded` is emitted as `info` ("opencode retried after provider.invalid-output: <message>"), never `error`.
- Why `info` and not `error`: an `error` segment is rendered as a failure in the lane view and is what a reviewer reads as "the lane failed"; the turn did not fail.
- Spec pins: a fixture `step.failed(provider.invalid-output)` → `step.started` → `execution.succeeded` resolves `done` with 0 and emits zero `error` segments.
- The same rule should hold on the run transport; that is the concurrent developer's false-exit-1 fix and is not redone here (dependency, see handoff).

### Q4. Completion = execution terminal event, not process exit

- One "turn" = from the POST that starts it to the first execution-terminal event (`succeeded` | `interrupted` | failed) for our session **with no owned inbox item still undelivered**.
- **Steer race:** a steer POSTed in the last milliseconds of an execution may be enqueued after the execution ended; the server then starts a NEW execution for it (every prompt goes through the inbox, `opencode-serve-probe.md:85-89`). If `done` had already resolved, that execution's output would land on a lane the manager has marked complete. Rule: the handle tracks inbox ids it created (from the POST response) and removes them on `session.inbox.delivered`; a terminal event that arrives while an owned id is undelivered does NOT resolve `done` — the turn continues into the next execution and resolves on ITS terminal event. A steer whose POST returns after `done` already resolved is refused (Component 7: throws), so the router reports `unsupported` instead of a false `steer`.
- Process exit of `opencode serve` mid-turn → `done` resolves 1 with `error` "opencode server exited (code N) during the turn".
- SSE stream ended while the server is alive → one reconnect after 500 ms; if the reconnect fails, or a terminal event could have been missed (we reconnected mid-turn), call `GET /api/session/{id}` (**Assumption A5**: a session read returns execution status; check `/openapi.json`) and resolve from it; if that is unavailable, resolve 1 with `error` "lost the opencode event stream".

### Q5. Working directory

- Spawn `opencode serve` with `cwd: options.workingDirectory` (same rule as run, `opencode-cli.adapter.ts:14-20`, `:622-623`). The probe saw sessions take the server's cwd (`opencode-serve-probe.md:185-186`).
- **Assumption A6:** `session.create` may also accept a `directory`; if `/openapi.json` lists it, send `options.workingDirectory` too (belt and braces). If not, cwd alone.

### Q6. Process lifetime and tree-kill

- One serve process per handle, started in `runSdk`, alive across turns, killed on `abort` (same `whenSpawned` → `killProcessTree` pattern, `opencode-cli.adapter.ts:634-647`) and by the manager's stop path through `getPid()` (`agent-process-manager.service.ts:2551-2555`). The manager's idle release (`agent-process-manager.service.ts:2185-2233`) reaches it through the same abort, after which `continuation` is reported false by the router (`agent-message-router.service.ts:346-349`).
- Before killing, best-effort `POST /interrupt` with a 1 s timeout if a turn is running (so the model stops tool work cleanly); never block the kill on it.
- No session deletion: the session stays in opencode's DB so `resume_session_id` works later (resume is verified for private servers today, `context.md:16-17`).
- **Orphan guard:** `detached: true` + tree-kill covers stop/abort. A host crash leaves the server running (same exposure as today's `run` child); accepted, noted as Risk R6.

### Q7. Version floor — probe the surface

- After readiness, `GET /openapi.json` with `Accept: application/json` and Basic, 5 s timeout. Accept the surface only if ALL hold:
  1. response `content-type` is JSON and the body parses;
  2. `paths` contains `/api/session`, `/api/session/{sessionID}/prompt` (path parameter name per the document), `/api/session/{sessionID}/interrupt`, `/api/event`;
  3. the prompt request schema has a `delivery` property whose enum (directly or via `$ref` to `Session.Inbox.Delivery`) contains both `steer` and `queue` (`opencode-serve-probe.md:75-77`).
- Result cached per binary path (Map of Promise, same shape as `standaloneSupport`, `opencode-cli.adapter.ts:243-247`, `:503-521`), cleared by `detect()` (`:251`). Only a definitive answer is cached; a timeout is "unknown" and re-probed next run.
- 1.x: `opencode serve` exists with a different API; condition 2 fails → fallback. A binary where `serve` fails to start → fallback.

### Q8. Windows specifics

- Same binary: `resolveOpencodeNativeBinary(options.binaryPath)` then `resolveDirectSpawn`, so the pid is the real `opencode.exe`, not `cmd.exe` (`opencode-cli.adapter.ts:568-572`, `:613-628`); `killProcessTree` uses `taskkill /T /F` (`agent-process-manager.service.ts:2572-2574` comment).
- Bind `--hostname 127.0.0.1` explicitly: avoids the Windows Defender firewall prompt a `0.0.0.0` bind triggers, and keeps the server off the LAN.
- Port: **Assumption A7** — `--port 0` is accepted and the listening line reports the real port. Check once with the live binary. If not, allocate with `net.createServer().listen(0, '127.0.0.1')`, read the port, close, pass it (TOCTOU window accepted; a bind failure surfaces as "server exited before ready" → fallback).
- stdout from the native binary may arrive with `\r\n`; the line reader splits on `\r?\n` (as `opencode-cli.adapter.ts:658`).
- Startup timeout 20 s (cold start of opencode 2.x is seconds, TASK_2026_525 / `opencode-cli.adapter.ts:374-381`). On timeout: tree-kill, fall back to run.

### Q9. Mode mapping

| Ptah mode (router) | Server transport | Run transport (fallback) |
| --- | --- | --- |
| `steer` (lane running) | `handle.steer(msg)` → `POST /prompt {text, delivery:"steer"}`; delivered at the next step boundary in the same execution | not offered (no `steer` on handle) |
| `queue-next-turn` (lane idle) | `handle.continue(msg)` → `POST /prompt {text}` on the idle session → a new execution = new turn with its own `done` | Phase 1 `continue()` (`run --session`) |
| `queue-next-turn` (lane running, park) | unreachable while `steer` exists (router order, `agent-message-router.service.ts:132-150`) | router parks, Phase 1 `continue()` drains |
| `interrupt-resume` | `handle.interrupt()` → `POST /interrupt`, await `session.execution.interrupted` and `done`; router then calls `continue()` | not offered |

- `delivery: "queue"` is NOT used by the handle: Ptah's router already owns queueing (park + `flushPending`, `agent-message-router.service.ts:212-237`, `:271-316`), and a server-side queue item would extend the current execution so the manager would never see a turn boundary (one `succeeded` covers both, `opencode-serve-probe.md:100-104`). Using the router's queue keeps turn boundaries, output-buffer marks (`agent-process-manager.service.ts:1851`) and lane-guard resets (`:1841`) correct.
- Consequence: with `steer` present the router never selects `interrupt-resume` for opencode. The handle still implements `interrupt` (honest declaration, cheap, used by the stop path's best-effort interrupt). Whether to expose a caller-chosen mode is Open Question 2.

### Q10. Test strategy

- Pure units (no I/O): SSE parser (framing, CRLF, multi-line data, comments, split chunks at every byte boundary, frame cap); event mapper (fixtures → segments + transitions, including the recovered-error and steer-race fixtures); surface validator (openapi fixtures: 2.0.12 accepted; missing delivery enum, HTML body, 1.x paths rejected).
- Fixtures: `cli-adapters/opencode/__fixtures__/` (precedent `codex/__fixtures__/`). One captured live SSE transcript per scenario (plain turn, multi-step with tool calls, steer mid-turn, interrupt, a failed execution, a retried `provider.invalid-output` if it can be provoked, else hand-written and labelled synthetic) plus the real `/openapi.json`. Captured by the implementer from a live 2.0.12 server in Batch 1; the password is scrubbed before commit.
- Integration (real loopback TCP, precedent `run-http-server-provider-contract.real-tcp.spec.ts`): a fake opencode server built on `http.createServer` that checks Basic auth, serves `/openapi.json` only with the Accept header (HTML otherwise, reproducing `opencode-serve-probe.md:44-47`), records POST bodies, and replays a fixture over `/api/event` on command. Drives the HTTP client and the server handle end to end.
- Process seam: the serve launcher takes the existing `IProcessSpawner`/`spawnCli` path, so adapter specs keep the current `jest.mock('./cli-adapter.utils')` fake-child pattern (`opencode-cli.adapter.spec.ts:37`, `:101`) and feed `server listening …`/`server password …` lines on stdout, then point the client at the fake TCP server's port.
- Adapter-level specs: transport selection (surface accepted → server handle with steer/interrupt/continue; probe rejected, serve exit before ready, readiness timeout → run handle and an `info` segment); password never appears in any emitted output/segment; `getPid` returns the serve pid; abort tree-kills it.
- Router/manager: existing `agent-message-router.service.spec.ts` and `agent-process-manager.guard.spec.ts` gain cases for an async `steer` that rejects (→ `unsupported`, nothing reported as delivered).
- Live check (report, not CI): steer mid-turn lands at a step boundary; interrupt-resume; idle continue; MCP `ptah_agent_report` works from a server-hosted session (A1).

## Architecture decision

- Chosen approach: a second transport inside the opencode adapter. `runSdk` launches a per-lane `opencode serve`, validates its surface, and returns a server-backed `SdkHandle` exposing `steer`, `interrupt` and `continue`; on any startup or surface failure it kills the server and returns the existing `run` handle (with Phase 1 `continue()`).
- Rationale: the probe proves the v2 server offers all three mechanisms (`opencode-serve-probe.md:18-22`); the router needs no change to use them because it reads handle declarations (`agent-message-router.service.ts:336-351`); per-lane keeps the per-agent MCP URL intact.
- Rejected alternatives:
  - Shared server for all lanes — cannot carry per-agent MCP config (Q1); one crash takes down every opencode lane.
  - Using the user's background service — never sees our env, owned by the user.
  - `opencode run --server <url>` against our own server — still one process per turn and no steer channel; gains nothing over Phase 1.
  - `serve --stdio` — unmeasured transport, no evidence of its protocol; revisit only if Open Question 4 says so.
  - Separate `OpencodeServeAdapter` registered as a new CLI type — would split one CLI across two `CliType`s, duplicate detection/models/auth, and change `ptah_agent_list` rows; the transport is an internal detail of the same adapter (the probe says as much: "The capability is a property of the transport, not of the binary", `opencode-serve-probe.md:196-197`).
  - Server-side `delivery: "queue"` for `continue` while running — breaks the manager's turn boundary (Q9).
- Assumptions: A1-A7 above, each with its check; A1 is a ship/no-ship gate.
- Effect on existing code: the run transport, its JSONL mapper and Phase 1 `continue()` are kept unchanged as the fallback. `capabilities()` changes (Component 6). `SdkHandle.steer` return type widens; Pi's sync steer still satisfies it. No other adapter changes.

## Component specifications

### 1. OpencodeSseParser

- Purpose: turn a byte/text stream into SSE frames.
- Responsibilities: incremental framing per Q3; frame-size cap; no JSON parsing, no knowledge of opencode.
- Verified contracts and entry points: none external (pure); buffer-cap behaviour mirrors `opencode-cli.adapter.ts:660-667`.
- Dependencies: none.
- Integration points: consumed by the HTTP client's event subscription.
- Failure behaviour: oversize frame → dropped with a callback the caller turns into an `info` segment; never throws.
- Quality requirements: O(n) in input; no retained buffer beyond one partial frame.
- Verification seam: unit spec feeding chunked input at every split point.
- Files: CREATE `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\opencode\opencode-sse-parser.ts`, CREATE `...\opencode\opencode-sse-parser.spec.ts`

### 2. OpencodeServeClient

- Purpose: the only code that speaks HTTP to an opencode server.
- Responsibilities: `probeSurface()` (Q7 validation, returns accepted | rejected(reason) | unknown); `createSession({ resumeSessionId?, model?, permissions?, directory? })` (resume = use the given id without creating; model/permissions/directory fields only if the surface lists them, A6/A8); `prompt(sessionId, text, delivery?)` → inbox id; `interrupt(sessionId)`; `subscribe(onFrame, signal)` → resolves when the stream ends; optional `getSession(sessionId)` (A5).
- Verified contracts: paths and auth from `opencode-serve-probe.md:36-38`, `:62-70`; Accept rule `:44-47`; prompt body `:72-77`; interrupt response `:171`. Global fetch + `AbortSignal.timeout` pattern `mcp-oauth.service.ts:252`; injectable fetch seam `smithery-connections.client.ts:214`.
- Dependencies: global `fetch` (injectable), Component 1. Depends on nothing in the adapter.
- Integration points: constructed by the server launcher with `{ baseUrl, password }`.
- Failure behaviour: every non-stream call has an explicit timeout (probe 5 s, prompt/interrupt/create 10 s); non-2xx → typed error carrying status and a body excerpt with the password redacted; 401 → error "opencode server rejected the credential". Retries: none for `prompt` (not idempotent — a retried steer could deliver twice); one retry with 250 ms backoff for `probeSurface` and `getSession` (idempotent GETs). `baseUrl` is accepted only if it matches `http://127.0.0.1:<port>` (validated external input from stdout).
- Quality requirements: password never in thrown messages or logs.
- Verification seam: real-TCP fake server spec (Q10).
- Files: CREATE `...\opencode\opencode-serve-client.ts`, CREATE `...\opencode\opencode-serve-client.spec.ts`, CREATE `...\opencode\__fixtures__\openapi-2.0.12.json` (+ rejected variants)

### 3. OpencodeServeEventMapper

- Purpose: map one decoded opencode event to segments, raw output text and a turn transition.
- Responsibilities: the table in Q3; owned-inbox bookkeeping inputs (enqueued/delivered ids); recovered-error rule; session-id filter.
- Verified contracts: segment shape `agent-process.types.ts:400-438`; measured event names `opencode-serve-probe.md:95-177`; tool/usage mapping parity with `opencode-cli.adapter.ts:820-896`.
- Dependencies: `@ptah-extension/shared` types only.
- Integration points: called by Component 5 per frame.
- Failure behaviour: malformed/unknown event → no segment, no transition; never throws.
- Quality requirements: pure, deterministic.
- Verification seam: fixture-driven unit spec, including recovered-error and steer-race transcripts.
- Files: CREATE `...\opencode\opencode-serve-event-mapper.ts`, CREATE `...\opencode\opencode-serve-event-mapper.spec.ts`, CREATE `...\opencode\__fixtures__\*.sse` transcripts

### 4. OpencodeServeLauncher

- Purpose: start one `opencode serve` process and report `{ baseUrl, password, pid, exited: Promise<code>, kill() }` or a startup failure.
- Responsibilities: binary resolution and spawn identical to the run path (native exe, `resolveDirectSpawn`, `detached: true`, `cwd = workingDirectory`, env `OPENCODE_CONFIG_CONTENT` when `mcpPort`, plus the password env if A2 holds); args `serve --hostname 127.0.0.1 --port <n>`; stdout line reader for readiness/credential (Q2); stderr through redactor + `classifyCliStderr`; 20 s readiness timeout; tree-kill via `whenSpawned` + `killProcessTree`.
- Verified contracts: `spawnCli`, `resolveDirectSpawn`, `resolveOpencodeNativeBinary`, `killProcessTree`, `whenSpawned` as used at `opencode-cli.adapter.ts:568-647`; MCP config builder `:528-544`; stdout format `opencode-serve-probe.md:30-34`.
- Dependencies: `cli-adapter.utils`, `platform-core` (same as the adapter today). The MCP config string is passed in by the adapter (it keeps `buildMcpConfigContent`), so the launcher does not import the adapter.
- Integration points: called by the adapter's `runSdk`.
- Failure behaviour: exit before ready, spawn error, timeout, or a listening URL not on 127.0.0.1 → kill tree, reject with a reason the adapter turns into an `info` segment and a fallback.
- Quality requirements: password redacted from every forwarded line; no listener left on the child after kill.
- Verification seam: fake-child spec (existing `opencode-cli.adapter.spec.ts:37` pattern) emitting the two lines, an early exit, and silence (fake timers).
- Files: CREATE `...\opencode\opencode-serve-launcher.ts`, CREATE `...\opencode\opencode-serve-launcher.spec.ts`

### 5. OpencodeServeHandle

- Purpose: build the `SdkHandle` for a server-backed lane.
- Responsibilities: open the event subscription, create/resume the session, POST the first prompt (built by `buildTaskPrompt`, same as run); turn state machine (idle → running → terminal) with owned-inbox tracking (Q4); `done` for the first turn; `continue(msg)` → new turn with own `done` (refused with a thrown error while a turn is running — the manager's busy check makes this unreachable, `agent-process-manager.service.ts:1815`); `steer(msg)` → async POST with `delivery:"steer"`, rejected if no turn is running; `interrupt()` → POST, await interrupted + `done`, rethrow failure (Cursor contract, `cursor-cli.adapter.ts:467-496`), resolve immediately when idle (`cli-adapter.interface.ts:133-136`); `supportsContinuation`/`supportsInterrupt` true while the server is alive; `getSessionId`; `getPid` → serve pid; `abort` → best-effort interrupt then kill; server exit mid-turn → `done` 1.
- Verified contracts: `SdkHandle` `cli-adapter.interface.ts:97-147`; buffered emitters `createBufferedEmitter` (`opencode-cli.adapter.ts:593-594`); turn bookkeeping pattern `cursor-cli.adapter.ts:446-458`.
- Dependencies: Components 2, 3, 4 (by interface: the handle receives the client and launcher result, so specs can pass fakes).
- Integration points: returned by the adapter; consumed by `AgentProcessManager` and `AgentMessageRouter` unchanged except Component 7.
- Failure behaviour: per Q4 and Q6; every failure path emits exactly one `error` segment and resolves (never rejects) `done`.
- Quality requirements: one SSE connection per lane, released on abort/kill; no per-message timers beyond request timeouts.
- Verification seam: real-TCP fake server + fake launcher result; asserts POST bodies, segments, `done` values, steer-race behaviour, interrupt ordering.
- Files: CREATE `...\opencode\opencode-serve-handle.ts`, CREATE `...\opencode\opencode-serve-handle.spec.ts`

### 6. OpencodeCliAdapter — transport selection

- Purpose: choose server or run transport per lane; declare capabilities honestly.
- Responsibilities: in `runSdk`, if the cached surface verdict for this binary is not `rejected`, try the launcher + probe; accepted → Component 5; otherwise kill and run the existing run path, emitting one `info` segment naming why steer is unavailable. Surface cache cleared in `detect()`. `capabilities()` returns `{ steer: true, interrupt: true, continuation: true }` once a surface was accepted for the detected binary in this host, else `{ steer: false, interrupt: false, continuation: true }` (Phase 1). Header comment updated for the two transports.
- Verified contracts: `capabilities()` feeds `detect().messagingMode` (`opencode-cli.adapter.ts:258`, `:273`, `:279`) and the router fallback (`agent-message-router.service.ts:353-358`); probe cache pattern `:243-247`, `:503-521`.
- Dependencies: Components 4, 5; existing run path.
- Failure behaviour: any server-path exception before the handle is returned → fallback, never a failed lane.
- Quality requirements: fallback adds at most the 20 s readiness timeout once per binary per host (the negative verdict is cached).
- Verification seam: adapter spec — selection matrix, fallback `info`, capabilities before/after an accepted probe.
- Files: MODIFY `D:\projects\ptah-extension\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\opencode-cli.adapter.ts`, MODIFY `...\cli-adapters\opencode-cli.adapter.spec.ts`

### 7. Async steer contract

- Purpose: let a steer report failure so the router never claims a delivery that did not happen.
- Responsibilities: widen `SdkHandle.steer` to `(message: string) => void | Promise<void>`; router `await`s it inside try/catch and returns `unsupported` with the reason on rejection (consistent with `interruptAndResume`'s failure branch, `agent-message-router.service.ts:176-186`); manager `steerLane` attaches a `.catch` that logs the existing warning.
- Verified contracts: `cli-adapter.interface.ts:128`; router `:132-140`; manager `:1045-1070`; Pi's sync steer remains assignable.
- Dependencies: none new.
- Failure behaviour: rejected steer → `unsupported`, detail "steer to <cli> failed: <reason>; nothing was delivered".
- Verification seam: router spec (async steer resolves → `steer`; rejects → `unsupported`); guard spec (rejecting steer is logged, stop threshold still applies).
- Files: MODIFY `...\cli-adapters\cli-adapter.interface.ts`, MODIFY `...\cli-agents\agent-message-router.service.ts`, MODIFY `...\cli-agents\agent-message-router.service.spec.ts`, MODIFY `...\cli-agents\agent-process-manager.service.ts`, MODIFY `...\cli-agents\agent-process-manager.guard.spec.ts`

### 8. Documentation of the lane's messaging

- Purpose: keep `ptah_agent_list` / agent-lanes text truthful (Phase 1 changes it to `queue`; Phase 2 to `steer` when the server transport is available).
- Responsibilities: update only sentences that state opencode's messaging mode; mention the run fallback.
- Verified contracts: Assumption — exact files are whatever Phase 1 edits (context.md §Phase 1 last bullet); the implementer greps for "opencode" near "messaging".
- Failure behaviour: not applicable.
- Verification seam: review.
- Files: MODIFY (TBD by grep, same files Phase 1 touched)

## Integration architecture

- Data flow: `ptah_agent_spawn` → `AgentProcessManager` → `OpencodeCliAdapter.runSdk` → launcher spawns `opencode serve` (cwd, env) → stdout readiness + credential → client `probeSurface` → accepted: client opens `GET /api/event` → create/resume session → `POST /prompt` (first task) → SSE frames → parser → mapper → buffered emitters → manager output buffer; terminal event → `done`. `ptah_agent_message` → router → running: `handle.steer` → `POST /prompt delivery:steer` → delivered at step boundary, same `done`; idle: `continueConversation` → `handle.continue` → `POST /prompt` → new `done`. Stop/idle release → `abort` → best-effort interrupt → tree-kill serve.
- State or persistence: server process, credential, SSE connection, session id, owned inbox ids and turn state live in the handle closure for the lane's life. The opencode session persists in opencode's own DB (not Ptah's) so resume works. Nothing new in Ptah storage.
- External boundaries: stdout of a child process (listening URL validated to loopback; password treated as secret); HTTP responses (JSON parsed defensively; `/openapi.json` validated structurally); SSE frames (size-capped, JSON parsed defensively, filtered by session id). Server bound to 127.0.0.1 with Basic auth.
- Failure and rollback: startup/surface failure → kill + run transport (no lane failure). Mid-turn server death → `done` 1. SSE loss → one reconnect, then status read, then `done` 1. Steer/interrupt POST failure → router `unsupported`. Abort → kill regardless of HTTP outcome.
- Observability: one `info` segment for every transport decision (server chosen; fallback with reason); logger entries in the adapter for launcher failures and SSE reconnects, with the password redacted; recovered provider errors visible as `info`.

## Architecture-level quality requirements

- Functional: on opencode 2.x with the surface present, `ptah_agent_message` to a running lane returns `mode: steer` and the message reaches the model at the next step boundary; to an idle lane returns `queue-next-turn` and runs a new turn in the same session; a lane where `opencode serve` cannot start behaves exactly as Phase 1. A retried `provider.invalid-output` never yields exit 1 or an `error` segment.
- Performance: one extra process and one SSE connection per opencode lane; no polling; lane start adds the serve readiness time (seconds) in place of the run cold start.
- Security: loopback bind; Basic credential never emitted, logged or put in error text; no shell strings — argv arrays only (as today); listening URL validated.
- Maintainability: router stays CLI-agnostic (no `opencode` branch); run transport untouched; opencode serve code isolated in `cli-adapters/opencode/`; no import from `auth-providers`.
- Testability: every unit in Components 1-3 is pure and fixture-tested; Components 2 and 5 run against a real loopback fake; the adapter selection matrix is pinned.

## Risks

- R1 (high): A1 false — server-hosted sessions do not get the Ptah MCP entry. Mitigation: Batch 1 live check gates everything else.
- R2 (medium): unmeasured event names (A4) differ by opencode patch version. Mitigation: mapper ignores unknowns silently; terminal detection depends only on measured names plus the failed variant; fixtures captured from 2.0.12.
- R3 (medium): steer race (Q4) — mitigated by owned-inbox tracking; pinned by a fixture.
- R4 (medium): what the model does with a steer is the model's choice (`opencode-serve-probe.md:143-148`). The router detail text must not promise the original task is abandoned.
- R5 (medium): `autoApprove: false` — a permission request blocks the session with no Ptah UI to answer it; the inactivity watchdog (`agent-process-manager.service.ts:1842`) ends it. Same exposure as run without `--auto`; noted, not solved here.
- R6 (low): host crash orphans a serve process (same as today's run child).
- R7 (low): the allow-all permission rule is broader than `--auto` (Open Question 3).

## Team-leader handoff

- Recommended executors: backend-developer for all components (Node process/HTTP code in one backend lib); senior-tester for the fixture capture and live verification report.
- Complexity: HIGH — new transport, process lifecycle, streaming protocol, race-sensitive turn state, one cross-cutting contract change.
- Dependencies and ordering (component-level only): Phase 1 merged first. A1/A2/A5/A6/A7 live checks and fixture capture before Components 3-6 are finalised. Components 1 and 2 before 5; 3 before 5; 4 before 5; 5 before 6; 7 independent of 1-6 but must land before 6 is enabled.
- Parallel-safe work: Component 1, Component 3 (after fixtures), Component 4 and Component 7 are file-disjoint.
- Batch outline (suggested; the team-leader re-derives):
  1. Live checks A1, A2, A5, A6, A7 + fixture capture (openapi + SSE transcripts), recorded as a report in the task folder. Stop if A1 fails.
  2. Components 1, 3, 7 (pure units + contract change).
  3. Components 2, 4.
  4. Component 5.
  5. Component 6 + 8, then live verification report (steer, idle continue, interrupt via direct handle call, MCP report from a server lane, fallback with a forced bad binary).
- Files affected:
  - CREATE: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode/opencode-sse-parser.ts` (+ `.spec.ts`), `opencode-serve-client.ts` (+ `.spec.ts`), `opencode-serve-event-mapper.ts` (+ `.spec.ts`), `opencode-serve-launcher.ts` (+ `.spec.ts`), `opencode-serve-handle.ts` (+ `.spec.ts`), `opencode/__fixtures__/` (openapi JSON variants, SSE transcripts)
  - MODIFY: `cli-adapters/opencode-cli.adapter.ts`, `cli-adapters/opencode-cli.adapter.spec.ts`, `cli-adapters/cli-adapter.interface.ts`, `cli-agents/agent-message-router.service.ts`, `cli-agents/agent-message-router.service.spec.ts`, `cli-agents/agent-process-manager.service.ts`, `cli-agents/agent-process-manager.guard.spec.ts`, messaging docs touched by Phase 1 (TBD)
  - REWRITE: none
- Verification points: `SdkHandle` contract `cli-adapter.interface.ts:97-147`; router order `agent-message-router.service.ts:128-150`; manager busy/turn rules `agent-process-manager.service.ts:1815-1886`; tree-kill path `:2548-2556`. Commands: `npx nx run-many -t typecheck,test,lint -p cli-agent-runtime` (and `shared` only if a shared type is touched — none planned).

## Open Questions for the User

1. **Ship gate if the MCP check fails.** If `opencode serve` does not load `OPENCODE_CONFIG_CONTENT` for its sessions (A1), a server lane has steer but no `ptah_*` tools.
   - (Recommended) Do not ship the server transport; keep Phase 1 only and report.
   - Ship it anyway behind a setting, accepting lanes that cannot `ptah_agent_report`.
   - Write the MCP entry to a per-lane temp config file / `OPENCODE_CONFIG` path instead (needs its own probe).
2. **Caller-chosen mode.** With `steer` available the router never selects `interrupt-resume` for opencode (or Pi).
   - (Recommended) Leave the router as is; interrupt stays an internal capability.
   - Add an optional `mode` hint to `ptah_agent_message` (`steer` | `queue` | `interrupt`) — a public tool contract change, separate task.
3. **`autoApprove` mapping on the server.** `--auto` approves only what is not explicitly denied; the probe's session-level rule `{action:'*', resource:'*', effect:'allow'}` may override project denies.
   - (Recommended) Use the narrowest permission rule `/openapi.json` offers that matches `--auto` (approve the ask-by-default actions only); if none exists, fall back to the run transport when `autoApprove` is true.
   - Use the allow-all rule and accept the broader grant.
4. **`opencode serve --stdio`.** It exists on 2.0.12 but is unmeasured; it would remove the port, password and HTTP stack entirely.
   - (Recommended) Ignore it for this task; HTTP is measured.
   - Spend one probe on `--stdio` before Batch 2 and switch if it carries the same session API.

## User Decisions (2026-10-06)

1. Ship gate: if `opencode serve` does not load `OPENCODE_CONFIG_CONTENT`, do NOT ship the server transport. Keep Phase 1 only and report.
2. Router: leave as is. Interrupt stays an internal capability; no `mode` hint on `ptah_agent_message`.
3. autoApprove: use the narrowest permission rule that matches `--auto`; if none exists, use the run transport when `autoApprove` is true.
4. `--stdio`: probe `opencode serve --stdio` before Batch 2. Evidence from `~/.local/share/opencode/log/opencode.log`: `run --standalone` already spawns `opencode.exe serve --stdio --port 0` as its child, and `--standalone` honours `OPENCODE_CONFIG_CONTENT`. If `--stdio` carries the same session API, prefer it over HTTP.
