# PI adapter upgrade: RPC mode (continuation + mid-run steering)

**Decision**: Deliver the user-approved "SDK-grade continuation + mid-run steer"
via PI's **`--mode rpc`** (persistent-during-run spawn + JSON-RPC over stdin),
NOT the in-process `@earendil-works/pi-coding-agent` SDK.

**Why not the SDK**: This repo already abandoned the in-process Copilot SDK —
`@github/copilot-sdk` throws `ERR_MODULE_NOT_FOUND` in any Node/Electron context
(see `copilot-sdk.adapter.ts:5-13`); the "SDK" Codex adapter actually spawns a
native binary. RPC mode gives the same capabilities over a killable subprocess,
a documented protocol (docs/rpc.md), zero new deps, and no esbuild/bundling risk.

## Protocol facts (from pi.dev docs/rpc.md, verified)

- Launch: `pi --mode rpc [--provider <p>] [--model <provider/id[:effort]>] [--session-dir <d>]`.
  Resume a session: PI RPC has `switch_session`, but for continuation we simply
  **re-spawn** with the prior session — confirm the exact resume flag
  (`--session <id>` per the CLI flag table; verify `--mode rpc` honors it, else
  send a `{"type":"switch_session","sessionFile":<path>}` request after spawn).
- Requests = JSONL on **stdin**, one object per line, LF-delimited:
  `{"type":"prompt","message":"...","id":"p1"}`.
  Key request types: `prompt`, `steer`, `follow_up`, `abort`, `get_state`,
  `set_thinking_level` ({level}), `set_model`.
- `prompt` while streaming errors unless `streamingBehavior` set — the INITIAL
  prompt is fine (agent idle). Use the dedicated `steer`/`follow_up` types for
  mid/post-run messages, never a bare `prompt`.
- Responses (stdout): `{"type":"response","command":"get_state","success":true,"id":"...","data":{...}}`.
- Events (stdout): same `AgentSessionEvent` union as `--mode json`
  (`agent_start`/`turn_start`/`message_update`(+`assistantMessageEvent`
  text_delta|thinking_delta)/`tool_execution_start|update|end`/`turn_end`/
  `agent_end`{willRetry}/`queue_update`{steering,followUp}), PLUS RPC-only
  `agent_settled` = fully idle, nothing queued.
- Session id: send `{"type":"get_state","id":"s0"}` right after spawn; capture
  `response.data.sessionId` (+ `sessionFile`). Also parse a `type:"session"`
  header line if emitted.
- Steering semantics: `steer` message delivered "after current turn's tool
  calls, before the next LLM call" — it EXTENDS the run, so more events follow
  before `agent_settled`.

## Changes

### 1. `cli-adapter.interface.ts` — extend `SdkHandle` (additive, optional)

```ts
/** Send a mid-run steering message to a still-running agent that owns a live
 *  input channel (e.g. Pi RPC mode writes a {"type":"steer"} request to the
 *  child's stdin). AgentProcessManager.steer() routes SDK-based agents here.
 *  No-op / throw if the run is no longer active. */
readonly steer?: (message: string) => void;
```

### 2. `agent-process-manager.service.ts` — `steer()` (line 671)

After the `adapter?.supportsSteer()` guard and BEFORE the `!tracked.process`
throw, insert:

```ts
const sdkSteer = tracked.sdkHandle?.steer;
if (sdkSteer) {
  sdkSteer(instruction);
  return;
}
```

Leave the existing stdin-process path untouched as the fallback.

### 3. `pi-cli.adapter.ts` — rewrite `runSdk()` to RPC mode

- `supportsSteer(): true`; `detect()` returns `supportsSteer: true`.
- Reuse the EXISTING event→segment mapping (message*update text/thinking,
  tool_execution*\*). Keep `supportsMcp=false`, ignore `mcpPort`, autoApprove no-op.
- `runTurn(message, resumeSessionId?)` (mirror copilot-sdk.adapter's runTurn):
  - Spawn `pi --mode rpc` + provider/model/thinking + resume flag (verify).
    Keep a mutable `activeChild` ref (steer targets the current child).
  - Do NOT `stdin.end()`. Write initial `{"type":"prompt","message,id:"p1"}\n`.
    Immediately write `{"type":"get_state","id":"s0"}\n` to capture session id.
  - Parse stdout JSONL: dispatch events to segments; capture session id from the
    `get_state` response and/or `type:"session"` header.
  - Resolve the turn's promise on `agent_settled` (final idle). Ignore
    `agent_end` with `willRetry:true`. On resolve → `killProcess`-friendly:
    kill `activeChild` (send `{"type":"abort"}` best-effort then `child.kill()`),
    so no persistent process leaks (stop() won't kill a non-running agent).
  - stderr / nonzero-exit / `child.on('error')` → `error` segment, resolve 1.
- `onAbort` (AbortController): send `{"type":"abort"}\n` best-effort, then kill
  the active child. Wired via `abortController.signal` (killProcess calls abort).
- Handle: return
  ```ts
  { abort, done, onOutput, onSegment, getSessionId: () => capturedSessionId,
    steer: (m) => activeChild?.stdin?.writable && activeChild.stdin.write(JSON.stringify({type:'steer',message:m})+'\n'),
    supportsContinuation: () => capturedSessionId != null,
    continue: (m) => Promise.resolve({ done: runTurn(m, capturedSessionId) }) }
  ```
  (continue re-spawns with the captured session id, and its new child re-points
  `activeChild` so steering works on the continued turn too.)

### 4. `pi-cli.adapter.spec.ts` — update for RPC mode

Mock spawn stdin (writable) + stdout. Cover: initial prompt + get_state written
to stdin; session id captured from get_state response; event→segment mapping;
`agent_settled` resolves done and kills child; `steer()` writes a
`{"type":"steer"}` envelope to stdin; `continue()` re-spawns with `--session`;
abort writes `{"type":"abort"}` + kills.

### 5. (optional) `agent-process-manager.service.spec.ts`

Add a case: SDK agent whose handle exposes `steer` — `steer()` routes to
`sdkHandle.steer()` instead of throwing.

## Out of scope / unchanged

- No npm dependency, no esbuild externals, no `.vscodeignore` changes.
- Detection model unchanged (`resolveCliPath('pi')`).
- `supportsMcp=false`, no approval gate — unchanged limitations.

## Verify

- `npx nx test cli-agent-runtime` (updated pi spec + any manager spec).
- `npx nx run-many -t typecheck -p shared cli-agent-runtime cli-engine ptah-extension-vscode ptah-electron` clean
  (only the pre-existing `editor/monaco-loader.service.ts` error is acceptable, and only if `chat` is in the set).
