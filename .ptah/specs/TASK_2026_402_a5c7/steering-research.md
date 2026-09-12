# Research: Mid-Turn Steering / Parent-to-Child Messaging for Rival CLI Adapters

Date: 2026-09-09. Scope: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/`.
Does not investigate: pricing, auth/OAuth flows, or the Claude Agent SDK side
(already described correctly in the task context) beyond what is needed to
contrast it with the rival CLIs.

Versions checked in this repo: `@openai/codex-sdk` 0.147.0
(`node_modules/@openai/codex-sdk/package.json`), `@cursor/sdk` 1.0.13
(`node_modules/@cursor/sdk/package.json`), `@github/copilot-sdk` — not
installed as a resolvable package here; the adapter uses the `copilot` CLI
binary instead (see Q1.2). Installed CLI binaries on this machine: `codex-cli
0.153.4`, `GitHub Copilot CLI 1.0.80`, `agy 1.1.27`. Not installed:
`cursor-agent`/`agent`, `opencode` (both UNVERIFIED by direct probe; findings
below rest on docs/source only).

## Q1 — Per-adapter mid-turn injection support (Sept 2026)

### 1.1 Codex

- **Vendor surface used by Ptah**: `@openai/codex-sdk` 0.147.0, `Thread.runStreamed()`
  (`libs/backend/cli-agent-runtime/.../codex-cli.adapter.ts:74-79,617-642`). The
  installed `.d.ts` (`node_modules/@openai/codex-sdk/dist/index.d.ts:200-275`)
  declares only `Codex.startThread/resumeThread` and
  `Thread.runStreamed(input, { signal })` — no `steer`, `interrupt`, `inject`,
  `sendMessage`, or `queue` method anywhere in the package. **Verified**: grepped
  the shipped `.d.ts`.
- **Vendor surface that DOES support it**: the separate `codex app-server`
  JSON-RPC protocol ships real methods `turn/steer` and `turn/interrupt`
  (`codex-rs/app-server-protocol/src/protocol/common.rs`,
  `codex-rs/app-server-protocol/schema/json/v2/TurnSteerParams.json`,
  confirmed via `gh search code` against `openai/codex` — **Verified**, source
  grep, not just a blog claim). `ErrorNotification.json`'s own description says
  this fires "when `turn/start` or `turn/steer` is submitted while the current
  active turn cannot accept same-turn steering, for example `/review` or manual
  `/compact`" — i.e. the happy path is same-turn (mid-turn) delivery, not a
  next-turn queue. The Python SDK (`sdk/python/src/openai_codex/client.py`)
  exposes it as `thread.steer(input)` — **Verified**, but this is the *Python*
  package (`openai-codex`), not the TypeScript `@openai/codex-sdk` this repo
  depends on. No `steer`/`interrupt` calls appear anywhere in the TS SDK's
  source tree by name.
- **Classification**: (a) true mid-turn steer — but ONLY via `codex app-server`
  (any language) or the Python SDK; (d) nothing — via the TS `@openai/codex-sdk`
  Ptah actually imports.
- `supportsSteer()` currently hardcoded `false`
  (`codex-cli.adapter.ts:473-475`), which matches the TS-SDK surface Ptah uses.

### 1.2 Copilot

- **Vendor surface used by Ptah**: the `copilot` CLI binary spawned per-turn
  with `-p "<prompt>" --output-format json --allow-all-tools`
  (`copilot-sdk.adapter.ts:1-39,297-345`). The comment block at the top of the
  file (lines 5-13) records why: `@github/copilot-sdk`'s dist imports
  `vscode-jsonrpc/node` (extensionless) which Node's ESM loader cannot resolve,
  so `await import('@github/copilot-sdk')` throws `ERR_MODULE_NOT_FOUND` in
  every Node/Electron context tested — **Verified in this repo's own doc
  comment**, and consistent with `@github/copilot-sdk` not being present under
  `node_modules` here (only an ambient `.d.ts` stub exists at
  `copilot-sdk.d.ts`, used purely to satisfy the TS compiler).
- **Vendor documentation on steering**: GitHub's own docs page,
  "Steering and queueing"
  (https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/steering-and-queueing,
  fetched 2026-09-09, undated on-page): steering is
  `session.send()` with `mode: "immediate"`; the message is placed on an
  `ImmediatePromptProcessor` queue and injected "before the next LLM request
  within the current turn"; if the turn finishes first, it silently falls back
  to the regular (next-turn) queue. The docs scope this explicitly to the
  **Copilot SDK** (TS/Python/Go/.NET/Java client objects) and make no mention
  of CLI applicability.
- **CLI-specific evidence**: `github/copilot-cli` issue #2025, "True
  non-blocking message queue for autopilot/multi-turn agent sessions" (open
  issue, undated) and #3517 "Queued user messages + system_notifications
  delivered out of send order" both describe messages sent to a running CLI
  session landing in a **queue**, not mid-turn — consistent with "steering" as
  documented being an SDK object-method concept, not something `copilot -p`
  headless mode exposes.
- **Ptah's specific spawn shape rules it out regardless of vendor capability**:
  each `runTurn()` call is a fresh child process that runs to completion and
  exits (`copilot-sdk.adapter.ts:297-441`); `continue()` re-spawns with
  `--resume=<id>` only after the previous process has closed
  (`copilot-sdk.adapter.ts:454-455`). There is no live process to steer during
  a turn, independent of whether the vendor supports it.
- **Classification**: (b) queue-for-next-turn, reachable only by switching to
  `@github/copilot-sdk`'s object API and fixing the ESM/CJS load failure first
  (see Q2); (d) nothing, as actually wired today.

### 1.3 Cursor

- **Vendor surface used by Ptah**: `@cursor/sdk` 1.0.13, in-process
  `Agent.create()` → `agent.send()` → `run.stream()`
  (`cursor-cli.adapter.ts:120-163,308-358`).
- **`.d.ts` evidence** (`node_modules/@cursor/sdk/dist/esm/agent.d.ts:12`,
  `.../run.d.ts:27-43`, `.../errors.d.ts:89-91`) — **Verified, read directly**:
  - `SDKAgent.send(message, options?)` returns a new `Run`; `Run` has
    `stream()`, `wait()`, `cancel()`, `status`. No mid-run "inject" method
    exists on `Run` or `SDKAgent`.
  - Calling `send()` again while a run is active throws `AgentBusyError`
    ("active run in progress... a conflict/state error... non-retryable
    without user intervention" per the doc comment on the class).
  - `SendOptions.local.force` is documented as: "Expire the currently active
    persisted run, if any, before starting this message as a new follow-up
    run. Recovery path for local agents left wedged after a crashed CLI
    process." This is exactly interrupt-then-resume: the old run is expired,
    a new run starts with the new message, same agent/session.
- **Classification**: (c) interrupt/abort then resume with new input — via
  `run.cancel()` (or `send(..., { local: { force: true } })`) then a fresh
  `agent.send()` on the SAME `agentId`. NOT (a): there is no way to make the
  currently streaming run see new input without ending it first.
- Ptah's adapter does not yet expose this: `onAbort` calls `run.cancel()` only
  for the whole-agent abort path (`cursor-cli.adapter.ts:283-296`); nothing
  wires a parent-driven interrupt during an active turn to a follow-up `send()`.

### 1.4 Antigravity (`agy`)

- **Vendor surface used by Ptah**: one-shot `agy --output-format stream-json
  --print "<prompt>"`, exits after the `result` event
  (`antigravity-cli.adapter.ts:8-51,420-469`). `child.stdin?.end()` is called
  immediately (line 494) — Ptah explicitly closes stdin, so nothing could be
  written mid-run even if `agy` read it.
- **Vendor docs**: Google's own headless-mode docs
  (https://antigravity.google/docs/cli/headless/, fetched via search 2026-09-09,
  undated) describe `--input-format stream-json`, which "reads one NDJSON
  message per line from stdin" and keeps a single continuous process running —
  but "each prompt executes a full turn and emits its own result event" i.e.
  each stdin line is a *complete new turn*, not an injection into a turn in
  progress.
- No vendor documentation or GitHub issue found describing any interrupt/abort
  RPC for `agy` print mode; two open issues
  (google-antigravity/antigravity-cli#318, #76) describe `-p`/`--print`
  hanging or dropping stdout in non-TTY environments — reliability concerns,
  not steering evidence either way. UNVERIFIED beyond the persistent-process
  stdin-NDJSON queue behavior above.
- **Classification**: (b) queue-for-next-turn at best, and only by switching
  from one-shot `--print` to a persistent `--input-format stream-json` process
  (Q2). (d) nothing in the shape Ptah runs it in today.

### 1.5 opencode

- **Vendor surface used by Ptah**: one-shot `opencode run --format json`,
  spawned per turn, `child.stdin?.end()` called immediately
  (`opencode-cli.adapter.ts:10-24,458-459`). No persistent process, no server.
- **Vendor docs** (https://opencode.ai/docs/server/, fetched 2026-09-09,
  undated): opencode also ships an HTTP server mode (`opencode serve`) with
  `POST /session/:id/message` ("send a message and wait for response"),
  `POST /session/:id/prompt_async` ("send a message asynchronously"), and
  `POST /session/:id/abort` ("abort a running session"). The docs do not
  describe any endpoint for injecting a message into an in-flight turn; the
  only documented way to redirect an active session is `abort` then a new
  `message`/`prompt_async` call. Open issue
  anomalyco/opencode#11424 ("while send a request by API
  `/session/:id/message` or `/session/:id/prompt_async`, always recv the
  `message.part.updated` by SSE") is about a different bug (over-broadcast),
  not evidence of mid-turn injection.
- **Classification**: (c) interrupt/abort then resume, IF Ptah switches to
  `opencode serve` (Q2) — same-session `abort` + new `message` call. (d)
  nothing in the current one-shot `run` shape, since there is no session to
  address between turns without a server.

### 1.6 Pi

- **Vendor surface used by Ptah**: `pi --mode rpc`, a persistent subprocess
  Ptah keeps alive with an open stdin (`pi-cli.adapter.ts:1-64,292-336`).
  `steer()` writes `{"type":"steer","message":...}` to the live child's stdin;
  the header comment (lines 9-11, sourced from Pi's own docs at
  https://pi.dev/docs/latest/rpc) states Pi delivers it "after the current
  turn's tool calls, before the next LLM call, extending the run" — this is
  the ONLY adapter in the set that both the vendor protocol AND Ptah's own
  wiring implement end-to-end today. `supportsSteer()` returns `true`
  (`pi-cli.adapter.ts:191-193`), matching `AgentProcessManager.steer()`'s
  routing (`agent-process-manager.service.ts:1005,1014-1017`).
- **Classification**: (a) true mid-turn steer (delivered at the next
  tool-call/LLM-call boundary within the SAME turn, not the next turn) — the
  one adapter that already ships this.

## Q2 — What Ptah would need to switch to, and the cost

| Adapter | Switch required | Cost |
| --- | --- | --- |
| Codex | `@openai/codex-sdk`'s Thread API → spawn `codex app-server` as a subprocess and speak its JSON-RPC (`turn/start`/`turn/steer`/`turn/interrupt`) directly, OR wait for/request `steer`/`interrupt` methods on the TS SDK's `Thread` class (not present in 0.147.0). Either path throws away the in-process `Codex`/`Thread` object model this adapter currently uses and rebuilds the event mapping (`handleStreamEvent` etc., ~650 lines) against a new transport. The MCP-tool-visibility workaround already required for `mcp_servers` config (`tool_search_always_defer_mcp_tools`, see `cli-agent-runtime/CLAUDE.md`) would need re-verifying against app-server's own config surface, which may differ from the SDK's `config` object. |
| Copilot | Fix the ESM/CJS load failure documented in the adapter's own header (or wait for a GitHub fix) so `@github/copilot-sdk`'s `CopilotClient`/session object can load at all, then switch from spawning `copilot -p` per turn to holding one `session` object per agent and calling `session.send(..., { mode: 'immediate' })` for steering. This is a bigger rewrite than Codex's: today's adapter has NO persistent handle to steer at all (a fresh process per turn), so this is "acquire a live handle" + "wire steering," not just "call a different method." |
| Cursor | No transport change needed — already in-process via `@cursor/sdk`. Needs: keep the `agent`/`run` handle addressable after `runTurn` returns (today `activeRun`/`agent` are closure-local per `runSdk` call and already exist as instance-adjacent locals, so this is a smaller, additive change), and implement "interrupt": on a steer request, call `run.cancel()` (or `send(msg, { local: { force: true } })`) then `agent.send(newMessage)`, re-attaching the stream consumer. Cost: moderate — mostly wiring, not a new dependency or protocol. |
| Antigravity | Move off one-shot `--print` to a persistent `--input-format stream-json` process (NDJSON-over-stdin), matching the pattern already built for Pi. Cost: rebuild the child-process lifecycle (currently `child.stdin?.end()` is called immediately — antigravity-cli.adapter.ts:494) to keep stdin open and multiplex one NDJSON line per "turn," at the cost of losing today's simpler one-shot exit-code lifecycle. Delivered mode is next-turn queue, not mid-turn — this buys continuation without respawn, not steering. |
| opencode | Move from `opencode run` (one-shot spawn) to `opencode serve` (HTTP server) and drive it with `abort` + `prompt_async`/`message` over HTTP instead of argv+stdout-JSONL. Cost: new transport (HTTP client, SSE for streaming per the docs) replacing the current stdout-JSONL parser; also needs a port allocation and lifecycle for the server process itself (today there's no server to manage). |
| Pi | No switch needed. Already the reference implementation. |

## Q3 — Proposed design

### Parent → child: `ptah_agent_message`

One MCP tool, one call shape, adapter-reported outcome:

```
ptah_agent_message({ agentId, message }) → { mode: "steer" | "interrupt-resume" | "queue-next-turn" | "unsupported", detail?: string }
```

Behavior per adapter, in preference order (best available capability wins,
grounded in Q1/Q2):

1. **`steer`** — if `adapter.steer` exists and the run is currently active,
   write the mid-turn message and return immediately. Only Pi qualifies today;
   Codex would qualify if/when it moves to `codex app-server` (`turn/steer`).
2. **`interrupt-resume`** — if `adapter.interrupt` exists (new capability,
   see interface change below), abort the current run/turn and immediately
   re-submit `message` as a new run on the SAME session/agent id, so
   conversation continuity is preserved. Cursor qualifies today
   (`run.cancel()` + `agent.send()`, same `agentId`); opencode qualifies once
   moved to `serve` (`abort` + `message`); Copilot qualifies once its SDK
   session object is reachable (`session.abort()` semantics — needs
   confirming against the SDK, flagged in Q4).
3. **`queue-next-turn`** — fall back to the EXISTING `continue()` primitive
   (already on `SdkHandle`, already implemented by Codex, Copilot, Cursor,
   Pi). The message is held and delivered as the next full turn after the
   current one ends. This is what every non-Pi adapter effectively gets today
   with zero further work, since `continue()` already exists and only needs a
   caller — the AgentProcessManager already has one at
   `continueConversation()` (`agent-process-manager.service.ts:1033`).
4. **`unsupported`** — Antigravity in its current one-shot `--print` shape (no
   session id addressable between calls without `--conversation`, and no
   `continue()` implemented on its `SdkHandle` today — confirm by re-reading
   `antigravity-cli.adapter.ts:594-601`, which returns no `continue` field).

The tool ALWAYS reports which mode fired, so a caller (or the chat UI) can
show "steered mid-turn" vs. "interrupted and restarted" vs. "queued for next
turn" rather than presenting all three as the same silent success — this
matters because mode 2 loses whatever partial work the interrupted turn was
mid-way through (a half-finished tool call), which mode 1 and 3 do not.

### Capability matrix

| Adapter | steer (mid-turn) | interrupt+resume | queue-next-turn | Current gap to close |
| --- | --- | --- | --- | --- |
| Codex | No (TS SDK has no method) | No (no interrupt-then-same-thread-resume without a fresh `resumeThread`, which already IS effectively queue-next-turn) | **Yes** (`continue()` exists) | Needs `codex app-server` migration for real steer/interrupt; queue-next-turn already works |
| Copilot | No | Possible in theory (kill process, `--resume`) but that's indistinguishable from queue-next-turn given the one-shot spawn shape | **Yes** (`continue()` exists) | No live process during a turn to interrupt meaningfully; interrupt-resume ≈ queue-next-turn here |
| Cursor | No (`AgentBusyError` on concurrent `send`) | **Yes** (`run.cancel()` + `send()`, or `local.force`) | Yes (`continue()` exists, but simply calls `runTurn` again, which is really the same interrupt-resume path since Cursor keeps one agent) | Add an explicit `interrupt` method to the adapter instead of relying on the generic `continue()` blocking until the old run naturally ends |
| Antigravity | No | No (no session id addressable mid-flight without `--conversation`, and no persistent process) | No (`SdkHandle` has no `continue` — confirm in code) | Needs persistent `--input-format stream-json` process before ANY of these tiers work |
| opencode | No | Possible after moving to `serve` (`abort` + `message`) | No (`SdkHandle` has no `continue` today — confirm in code) | Needs HTTP server mode; currently no continuation at all |
| Pi | **Yes** (already shipped) | N/A (steer supersedes it) | Yes (`continue()` exists) | None — reference implementation |

### Minimal adapter interface change

Add to `CliAdapter`/`SdkHandle` (`cli-adapter.interface.ts`):

```ts
export interface SdkHandle {
  // existing: steer?, continue?, supportsContinuation?
  /** True mid-turn interrupt: abort the CURRENT run/turn without ending the
   *  session/agent, then resolve once torn down. Distinct from `abort`
   *  (AbortController) which ends the whole handle/process. */
  readonly interrupt?: () => Promise<void>;
  readonly supportsInterrupt?: () => boolean;
}
```

`CliAdapter.supportsSteer(): boolean` should be joined by (not replaced by)
a `capabilities()` method or three boolean getters
(`supportsSteer/supportsInterrupt/supportsContinuation`) so
`AgentProcessManager` can pick a mode without special-casing adapter names —
today's `supportsSteer()` is already exactly this pattern for the single
capability it covers (`cli-adapter.interface.ts:105`), so this is additive,
not a redesign.

### Child → parent: `ptah_agent_report`

An MCP tool the CHILD's own tool list carries (so any spawned CLI that can
call MCP tools — Codex, Copilot, Cursor, Antigravity, opencode all have
`supportsMcp = true`; Pi does not, `pi-cli.adapter.ts:150`) that lands as an
inbound message in the parent's chat surface:

```
ptah_agent_report({ agentId, message }) → { delivered: boolean }
```

The natural landing spot is the SAME inbound path Claude's own
`SendMessage`-style cross-session messages use
(`ptah-cli-registry.ts:684-826`, per the task context) — i.e. the report
should be queued into the parent session's own streaming-input mailbox as an
inbound user-role (or a distinct `agent-report` role) message, tagged with the
reporting `agentId`, rather than inventing a second delivery mechanism. Pi is
excluded from receiving this tool (no MCP), but nothing stops Pi's own
existing steer-response events from being surfaced the same way through the
adapter's segment stream instead of MCP.

## Q4 — Unknowns and how to measure them

- **Whether `@github/copilot-sdk`'s ESM/CJS load failure is still true on the
  currently-installed CLI's underlying SDK version.** Probe: in a plain Node
  20+ script (not the VS Code/Electron host), run
  `await import('@github/copilot-sdk')` after `npm install @github/copilot-sdk`
  at the version pinned by `copilot 1.0.80`, and record whether
  `ERR_MODULE_NOT_FOUND` still fires. If fixed, `session.send(..., {mode:
  'immediate'})` steering becomes reachable without waiting on GitHub.
- **Whether `codex app-server`'s `turn/steer` is reachable from a
  locally-spawned subprocess without additional auth handshake overhead**
  (i.e., does it reuse `~/.codex/auth.json` the same way `Thread` does).
  Probe: `codex app-server` (installed CLI is 0.153.4, newer than the SDK's
  0.147.0 pin) then send `thread/start` → `turn/start` → `turn/steer` over its
  stdio JSON-RPC by hand and confirm a running turn visibly changes course.
- **Whether opencode's `/session/:id/message` truly queues (rather than
  erroring or racing) when POSTed while a prior call to the same session is
  still in flight.** Probe: install `opencode-ai`, run `opencode serve`, fire
  two overlapping `POST /session/:id/message` calls with a slow first prompt,
  and observe via `GET /session/status` and the SSE stream whether the second
  is queued, rejected, or interleaved.
- **Whether `agy --input-format stream-json` accepts a follow-up NDJSON line
  before the first turn's `result` event, and what happens if it does**
  (queued vs. rejected vs. undefined behavior — the two open GitHub issues on
  print-mode hangs suggest this path is not battle-tested). Probe: spawn `agy
  --input-format stream-json --output-format stream-json`, write two prompt
  lines back-to-back before reading any result, and record the event
  ordering.
- **Whether Cursor's `local.force: true` on `send()` (Q1.3) actually preserves
  conversation context from the expired run**, or whether the new run starts
  "fresh" apart from persisted history. Probe: with a `CURSOR_API_KEY`, start
  an agent, send a long-running prompt, then call `send(newMsg, {local:
  {force: true}})` mid-run and inspect whether the new run's transcript
  references the interrupted run's partial tool output.
- **Antigravity's `SdkHandle.continue` gap** — confirm by reading
  `antigravity-cli.adapter.ts:594-601` (return object has no `continue`/
  `supportsContinuation`) is not an oversight already fixed in a newer
  revision; grep the file at time of implementation to be sure the matrix row
  above is still accurate.

## Sources

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:981-1031`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.d.ts`
- `node_modules/@openai/codex-sdk/package.json` (0.147.0), `dist/index.d.ts:184-275`
- `node_modules/@cursor/sdk/package.json` (1.0.13), `dist/esm/agent.d.ts`, `dist/esm/run.d.ts`, `dist/esm/errors.d.ts`
- `libs/backend/cli-agent-runtime/CLAUDE.md` ("Codex connects to that server and then hides its tools" section — codex-cli 0.150.1 MCP behavior)
- Installed CLI version probes (this machine, 2026-09-09): `codex --version` → codex-cli 0.153.4; `copilot --version` → GitHub Copilot CLI 1.0.80; `agy --version` → 1.1.27; `cursor-agent`/`agent` not on PATH (UNVERIFIED); `opencode` not on PATH (UNVERIFIED)
- GitHub source, `openai/codex` repo, verified via `gh search code`: `codex-rs/app-server-protocol/src/protocol/common.rs` (`TurnSteer => "turn/steer"`, `TurnInterrupt => "turn/interrupt"`), `codex-rs/app-server-protocol/schema/json/v2/TurnSteerParams.json`, `codex-rs/app-server-protocol/schema/json/v2/ErrorNotification.json`, `sdk/python/src/openai_codex/client.py`, `sdk/python/docs/api-reference.md`
- [GitHub Docs — Steering and queueing](https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/steering-and-queueing) (fetched 2026-09-09, page undated)
- [github/copilot-cli#2025 — True non-blocking message queue for autopilot/multi-turn agent sessions](https://github.com/github/copilot-cli/issues/2025) (open, undated)
- [github/copilot-cli#3517 — Queued user messages + system_notifications delivered out of send order](https://github.com/github/copilot-cli/issues/3517) (open, undated)
- [OpenCode Server docs](https://opencode.ai/docs/server/) (fetched 2026-09-09, undated)
- [anomalyco/opencode#11424](https://github.com/anomalyco/opencode/issues/11424) (open, undated)
- [Antigravity headless mode docs](https://antigravity.google/docs/cli/headless/) (referenced via search 2026-09-09, undated)
- [google-antigravity/antigravity-cli#318](https://github.com/google-antigravity/antigravity-cli/issues/318), [#76](https://github.com/google-antigravity/antigravity-cli/issues/76) (open, undated) — print-mode reliability, not steering evidence
- Codex app-server guide (secondary, blog, dated 2026-04-15): https://codex.danielvaughan.com/2026/04/15/codex-app-server-complete-guide/ — used only to corroborate the `turn/steer`/`turn/interrupt` method existence already confirmed directly against `openai/codex` source; treated as a claim, not a fact, where it went beyond what the source grep confirmed (e.g. its statement that `@openai/codex-sdk` npm package is unrelated to app-server was NOT independently verified by this blog, only by this repo's own `.d.ts` read)
