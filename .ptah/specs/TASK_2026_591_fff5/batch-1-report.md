# TASK_2026_591 — batch 1 report (Part A: false exit-1, Part B: Phase 1 queue-next-turn)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-591-opencode-messaging` (branch `fix/task-591-opencode-messaging`). No git commands run.

## Part A — what opencode 2.0.12 actually does (verified from the bundle)

Source: the embedded JS in `C:\Users\abdal\AppData\Roaming\npm\node_modules\@opencode\cli\bin\opencode.exe` (v2.0.12), the `run` command's event loop. Excerpt, minified:

```js
if(t.type==="session.step.ended"){ ... D("step_finish",a,{part:{ ..., type:"step-finish", reason:t.data.finish, cost, tokens }}); continue }
if(t.type==="session.step.failed"){ if(e.compatibility==="v1"&& ...)continue; if(x||_||E)continue;
   if(P(),u=!0,process.exitCode=1,!D("error",a,{error:t.data.error}))C(t.data.error.message); continue }
if(t.type==="session.execution.failed"){ ... if(!u&&!E){ u=!0,process.exitCode=1, D("error",a,{error:t.data.error}) } return }
if(t.type==="session.execution.interrupted"){ if(reason==="user"&&x)process.exitCode=130; if(reason!=="user"&&!u){ u=!0,process.exitCode=1; D("error",a,{error:{type:"aborted",message:`Session interrupted: ${reason}`}}) } return }
if(t.type==="session.execution.succeeded")return
```

and the CLI's own failure helper: `process.stdout.write(JSON.stringify({type:"error",timestamp:Date.now(),sessionID:i??"",error:{type:"unknown",message:n}}))`.

Findings:

1. **Error shape (2.x)**: `{"type":"error","timestamp":…,"sessionID":"ses_…","error":<session error object>}`. The session error object is `{ type, message, … }` — e.g. the observed `{"type":"provider.invalid-output","message":"OpenAI Chat stream ended without finish_reason","status":200}`. There is no `error.data.message` and no `error.name`. The adapter read `error.data.message ?? error.name`, so a 2.x error fell through to `'Unknown error'`.
2. **Exit rule**: every `session.step.failed` sets `process.exitCode = 1`. Nothing clears it. `session.execution.succeeded` just returns, so a run that retried past a failed step and then finished still exits 1. That matches the DB evidence (`idle_outcome = succeeded`, Ptah reported `exited with code 1`). User interrupt gives 130. A non-user interrupt gives 1 with an `aborted` error.
3. `step_finish.part.reason` is `t.data.finish`. The final step's `reason` is `"stop"`, the same value the adapter already uses for the usage summary. I did not trace the full set of `finish` values, so I assumed `"stop"` from the existing adapter code and the 1.x behaviour.

## Part A — change

`opencode-cli.adapter.ts`:

- `describeOpencodeError(event)` reads `error.message` → `error.data.message` (1.x) → top-level `message` → `error.name` → `error.type` → `'Unknown error'`. The error segment content is still the bare message, so the 1.x spec is unchanged.
- Per-turn `OpencodeTurnState` tracks `lastErrorMessage` and `stoppedAfterLastError`. An `error` event sets the message and clears the flag. A `step_finish` with `reason: "stop"` sets the flag.
- `settleExitCode` runs at child close:
  - exit 0 or aborted → returned unchanged, so abort behaviour is the same as before.
  - non-zero, with an error seen and a final stop after it → resolves **0**, with an `info` segment plus an output line: `opencode recovered from an error and finished the turn, but exited with code 1; the turn is treated as complete. Recovered error: <message>`.
  - otherwise → failure. The error segment is now `opencode CLI exited with code N after error: <last message>` when there was an error, and the old generic text when there was not.

## Part B — Phase 1 queue-next-turn

- `capabilities()` → `{ steer: false, interrupt: false, continuation: true }`. `bestMessagingCapability` therefore gives `queue`, and `detect().messagingMode` is `'queue'`.
- `runSdk` now does the per-handle setup once: binary and native-exe resolution, base flags (`run --format json [--auto] [--model] [--standalone]`, with the `--standalone` probe result reused), `OPENCODE_CONFIG_CONTENT` env, and `resolveDirectSpawn`. A local `startTurn(prompt, sessionId)` then calls one private `runTurn(launch)`, which holds the single spawn/stream implementation: detached spawn, stdin closed, line buffer, stderr classification, a per-turn abort listener that tree-kills via `whenSpawned` + `killProcessTree`, and close/error settling. The first turn and `continue()` turns share it, so there is no duplicated spawn code.
- Handle additions: `supportsContinuation`, `continue(message)` (spawns `… --session <id> <message>` with the same flags, env, cwd and binary, into the same emitters), and `getPid` (follows the active child).
- **No-session-id behaviour (decided, pinned)**: this follows the Pi adapter, the other spawn-per-turn adapter (`supportsContinuation: () => capturedSessionId != null`). The session id used is `capturedSessionId ?? options.resumeSessionId`, as Codex does. With neither:
  - `supportsContinuation()` returns `false`, so the router reports `unsupported` and `AgentProcessManager` throws `AgentContinueError('unsupported')`.
  - `continue()` rejects with `opencode has not reported a session id yet, so there is no session to continue. The message was not delivered.` and spawns nothing.
  - It never starts a fresh session silently, because a fresh session would lose the conversation.

  In practice the id arrives on the first JSON event, so this window is only the first moments of a run, or a run that printed nothing.
- `continue()` after the handle was aborted resolves `done` = 1 and spawns nothing.
- The follow-up prompt is the raw message, since the opencode session already holds the task and its context. Codex re-wraps through `buildTaskPrompt`; that was not needed here.

## Files changed

- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts` — header notes (exit rule, messaging), 2.x error type, turn state, `runSdk` / `runTurn` / `settleExitCode`, `continue`, capabilities.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts`:
  - New block `runSdk() — opencode 2.x errors and exit code` (5 specs): 2.x shape surfaced; recovered error + stop + exit 1 → 0 with notice; error after stop + exit 1 → 1 naming the error; stop without error + exit 1 → 1; top-level `message`.
  - New block `continue() — queue-next-turn on the same session` (6 specs): same flags, env, cwd and `--session <id>`; same emitters; resumed-session fallback; no id → `supportsContinuation` false, reject, no spawn; abort of a continued turn tree-kills and resolves 1; continue after abort spawns nothing.
  - Updated: the capabilities and `detect().messagingMode` expectations (`queue`).
- MODIFIED `.claude/skills/agent-lanes/SKILL.md` §4 and its identical shipped copy `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`: "`opencode` has no messaging support at all" → "`opencode` takes a message only as a queued next turn, never mid-turn". I edited both because they were byte-identical before the change and are still in sync. `ptah-system-prompt.constant.ts` makes no opencode-specific messaging claim, so it is unchanged.
- Created the `node_modules` junction to `D:\projects\ptah-extension\node_modules`, as instructed.

## Checks

- `npx nx run-many -t typecheck,test,lint -p cli-agent-runtime --parallel=2` → `Successfully ran targets typecheck, test, lint for project @ptah-extension/cli-agent-runtime` (exit 0).
- `npx nx run cli-agent-runtime:test --skip-nx-cache` (uncached, to confirm the specs really ran) → `Test Suites: 96 passed, 96 total; Tests: 1 skipped, 1975 passed, 1976 total`.
- The message-router and process-manager specs are part of that suite and are unchanged and green. They read capabilities from the handle, so they needed no edits.

## Not done / open

- **AC 2 live check** is not run: `ptah_agent_message` to a running opencode lane returning `queue-next-turn` and the reply landing in the same session. This needs a rebuilt host. AC 1 (`messaging: queue`) is covered by the adapter's `detect()` spec but not checked live.
- The set of `step_finish.reason` values in 2.x is not traced beyond `"stop"` (see finding 3).
- Phase 2 (steer/interrupt via `opencode serve`) is out of this batch.

## Out-of-scope observations

- 2.x `session.tool.failed` is emitted as a `tool_use` with `state.status: "error"` and `state.error: <string>`. `handleToolUse` does not check `status`, so a failed tool shows as a normal `tool-result` / `command` segment. Worth a follow-up.
- When `supportsContinuation()` is false (no id yet), the router's generic `unsupported` text says the CLI "offers no mechanism … nor continuing the conversation". For opencode in that window this is slightly misleading. The router is shared, so I left it unchanged.

## Revise round 1

Source: `code-logic-review.md` (Codex lane, verdict REVISE). Both findings are fixed in `opencode-cli.adapter.ts`, with specs in `opencode-cli.adapter.spec.ts`.

1. **BLOCKING: stale PID.** `OpencodeTurnLaunch` gained `onExited(child)`. `runTurn` calls it first in both the child's `close` handler and its `error` handler. In `runSdk` it clears `activeChild` only when the exiting child is still the active one, so an older turn settling late cannot clear a newer turn's child. As a result `getPid()` returns a PID only while a turn's child is live. The manager's stop/release tree-kill can therefore no longer target a PID that may have been reused.
   - Specs:
     - `exposes a PID only while a turn child is live`: PID during the first turn, `undefined` after it, the new child's PID (5151) during a continued turn, `undefined` after that.
     - `clears the PID when the turn child fails to start`.
   - The earlier abort spec no longer asserts the PID after close.
2. **SERIOUS: resumed session id not reported.** `getSessionId` is now `resumableSessionId`, i.e. `capturedSessionId ?? options.resumeSessionId`.
   - Spec: `reports the resumed session id before any output and after a silent turn`.

Checks:
- `npx nx run-many -t typecheck,test,lint -p cli-agent-runtime --skip-nx-cache` → `Successfully ran targets typecheck, test, lint for project @ptah-extension/cli-agent-runtime`.
- The opencode spec file alone gives `Tests: 68 passed, 68 total`.
