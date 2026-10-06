# Code Logic Review — `TASK_2026_617` (Phase 1, Batches 1-4)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 4        |
| Failure modes found | 5        |

Scope read in full: `acp-session-handle.ts`, `acp-process-transport.ts`, `acp-session-update-mapper.ts`, `acp-permission-policy.ts`, `acp-vendor-profile.ts` (all in `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/acp/`). Also read the plan amendments, batches.md results, and `spawnCli` (`cli-adapter.utils.ts:296-338`). The loader, fake agent, barrel and manifests were not line-audited (loader contract taken from Batch 1 results). Scoped run `nx test cli-agent-runtime --testPathPattern=cli-adapters/acp --skip-nx-cache`: 101 suites passed, 2053 tests passed, 1 skipped. That is the whole project, because the pattern flag was not honoured.

Caveat: the Grok profile (`describeError` rows, `sessionConfig`, `buildSpawn`) does not exist yet. The -32003, -32000 and -32602 messages are produced by the spec's test profile (`acp-session-handle.spec.ts:51-53`). The runner's generic fallback is `<Name> <method> failed: <msg> (<detail>) [code N]` (`acp-session-handle.ts:284-293`). It is clear but not the amended wording until the Grok profile lands in Phase 2.

## Five logic questions

### 1. How does this fail silently?

- Refused permission where the agent keeps going and ends `end_turn`: exit 0 with only an `info` (`acp-session-handle.ts:263`, `acp-permission-policy.ts:111-118`). This is acceptable because the info names the title.
- Transport `onChildError` on a live child (for example a failed signal) sets `processGone`, so `getPid()` returns `undefined` and `stopProcess` is a no-op (`acp-session-handle.ts:213`). The process may be left running with no handle to kill it (`acp-process-transport.ts:223-227`). See M2.
- `setSessionConfigOption` is skipped with only an `info` when the id is not advertised (`acp-session-handle.ts:392-397`). The model silently falls back to the default and the turn succeeds. This is intentional per the amendment, and it is visible as an info.

### 2. What user action produces unexpected behaviour?

- Abort during the handshake: `onAbort` calls `stopProcess`, setup rejects, `reportFailure` returns 1 silently (`:513`). This is correct.
- Abort when a prompt is in flight: `cancel` is written, then the child is killed immediately (`:225`). Grok gets no ~21 ms window to reap its shell child, so the tree-kill backstop does the work. This is consistent with the plan ("cancel, then kill").
- `continue()` during a turn rejects with an Error (`:617-619`). The router queues messages, so this is OK.

### 3. What input data produces a wrong answer?

- Permission options with no `allow_once` and only `allow_always` select the persistent grant (with an info). This is documented and tested.
- `stopReason` `cancelled` with a refusal recorded only counts while `promptInFlight` (`:264`). A request arriving between turns is not attributed. This is fine.
- Malformed agent payloads are handled defensively: `readConfigOptions`, `isRecord` guards, a mapper that never throws, and a policy that never throws.

### 4. What happens when a dependency fails?

- Handshake timeout (30 s): error segment, kill, return 1. The timer is cleared in `finally` (`:491-509`). OK.
- `AcpUnavailableError` (SDK missing): `reportFailure` emits the error, the child is killed, and `done` is 1 (`:514-519`, `:589-594`). OK.
- Process exit mid-turn: relies on stdout `close` to end the readable and so the connection (`acp-process-transport.ts:228-233`). If `close` never fires, see M1.
- `session/resume` failure (including -32000): swallowed into an info, then falls back to `session/new` (`:369-374`, `:460-462`). The -32000 then surfaces from `session/new`. OK.
- Rate limit (-32003) on a prompt: the turn fails, and the session and child stay up for the next message (`:567-572`). OK (deviation 5).

### 5. What is missing that the requirements never mentioned?

- No watchdog tying child `exit` to the connection or the in-flight prompt (M1).
- Stdin `write()` backpressure is ignored (`acp-process-transport.ts:288-295`), so large prompts are buffered unbounded in the stream. Minor.
- No test over a real child for exit-without-close. The transport spec uses a `node -e` echo child only.

## Failure modes

### M1. Child exits but stdout `close` never fires (grandchild holds the pipe)

- Trigger: the agent crashes or is killed while a descendant still holds the inherited stdout pipe. `exit` fires but `close` does not.
- Symptom: `session/prompt` never settles, so `done` hangs until the outer inactivity watchdog. The `exited.then` handler only sets flags (`acp-session-handle.ts:232-238`).
- Evidence: `acp-process-transport.ts:219-222` (`onChildExit` does not `closeReadable`), `:228-233`.
- Current handling: relies on `close` alone.
- Recommendation: on `exit`, close the readable after a short grace (or on a microtask after draining). Alternatively, in the handle, fail the in-flight prompt when `exited` resolves. Likelihood is low, since Grok's children use their own stdio.

### M2. `onChildError` on a live child

- Trigger: Node emits `error` after a successful spawn (a kill or IPC failure).
- Symptom: `processGone = true`, `exited` is settled with `signal: 'error'`, and `stopProcess` never kills (`processExit` is set). The process is orphaned. Listeners are also never detached unless `close` fires (the query in the brief). After a failed spawn, `close` indeed does not fire; the listeners sit on a dead emitter and are garbage collected with it, so this is a leak in form only.
- Evidence: `acp-process-transport.ts:223-227`; `acp-session-handle.ts:212-214`.
- Recommendation: in `onChildError`, run the detach list (or at least when `child.pid` was never obtained). Attempt `killProcessTree` if `pid` is known and `!child.killed`.

### M3. Cancel then immediate kill

- Evidence: `acp-session-handle.ts:225`. It is not a defect, since the tree-kill covers shell children, but the 21 ms graceful reap is never actually awaited. A short bounded wait for the prompt response (for example 1-2 s, a timer to add) would let Grok exit cleanly and keep the session file flushed. A hard kill may skip flushing a resumable session; this is unverified.

### M4. Session id emitted before config applied

- Evidence: `acp-session-handle.ts:484-485`. If `set_config_option` then fails (-32602) the caller already persisted the id, and the child is killed. The session is still resumable, so this is acceptable. No fix required, but worth a doc line.

### M5. Spawn env

- `buildSpawn` returns argv only and no `env` is passed (`acp-session-handle.ts:197-208`). `spawnCli` always merges `process.env` and `CLI_CLEAN_ENV` (`cli-adapter.utils.ts:308`), so `XAI_API_KEY` and `HOME` are inherited. Other lanes pass env only for: antigravity (`:692`, an optional spawnEnv), codex (`:494`) and opencode (`:604`). Cursor and Pi pass none. Nothing is lost for Grok. The Ptah MCP URL and token travel through `mcpServers` (`profile.buildMcpServers`), not env. A future vendor that needs a per-lane env (an API key from Ptah's secret store) cannot supply one through the profile. Batch 9 must confirm and either add `buildEnv?` or accept it.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- M1 above: `acp-process-transport.ts:219-233`.
- M2 above: `acp-process-transport.ts:223-227`.
- Moderate: the profile contract has no env hook (M5), so there is a future gap but no present loss.
- Moderate: the real Grok `describeError` is absent from the Phase 1 diff, so its error rows are only verified against a spec stub (`acp-session-handle.spec.ts:51-53`).
- Minor: ignored stdin backpressure, `acp-process-transport.ts:288`.
- Minor: `extMethod` is intentionally absent. The SDK answers -32601.

## Data flow

1. Spawn: `spawnAcpProcess` returns synchronously, with the Windows `.cmd` resolve async and writes queued. OK.
2. `connectAcp` then `initialize` (protocol version check) then resume/new then config. OK, inside the 30 s timeout.
3. Resume carries `mcpServers` (`:358-362`). OK (R7). The load path drops replay by `_meta.isReplay` (`:140-149`, `:254`). OK.
4. Config applied only for advertised ids (`:390-396`). A -32602 becomes `AcpTurnFailure`, then the child is killed, then 1 before any prompt (`:589-594`). OK (R6).
5. Prompt: `refusedThisTurn` reset per turn. `cancelled` plus refusal plus not aborted maps to 1 with the error "<name> stopped the turn: permission refused for <title>" (`acp-session-update-mapper.ts:291-303`). OK (R5). The user stop (aborted) is silent. OK.
6. Exit: the exit code is always 0 or 1, and `done` never rejects (`.catch(() => 1)`, `:623`, `:620`). OK.

## Requirements fulfilment

| Requirement                                          | Status   | Gap                                                          |
| ---------------------------------------------------- | -------- | ------------------------------------------------------------ |
| R5 refused permission is a named failed turn         | COMPLETE | Spec-verified in the runner and the mapper                   |
| R6 model and effort through `set_config_option`      | COMPLETE | Grok profile entries come in a later batch                   |
| R7 `mcpServers` on resume, replay dropped on load    | COMPLETE |                                                              |
| -32003, -32000 and unavailable as failed turns       | PARTIAL  | Amended wording lives in a stub profile until Phase 2        |
| SdkHandle contract (no steer or interrupt, live pid) | COMPLETE | `getPid` has the M2 caveat                                   |
| Stop = cancel then tree-kill                         | COMPLETE | M3                                                           |
| Process exit mid-turn                                | PARTIAL  | Depends on `close` firing (M1)                               |
| Handshake timeout                                    | COMPLETE |                                                              |
| Works whether MCP calls prompt for permission or not | COMPLETE | The policy only reacts to requests; nothing assumes a prompt |

Implicit requirements not addressed: a bounded wait after cancel (M3), and a transport watchdog on exit (M1).

## Edge cases

| Case                            | Handled | How                                            | Concern                       |
| ------------------------------- | ------- | ---------------------------------------------- | ----------------------------- |
| Abort before spawn resolves     | YES     | `kill` flag replayed in `attachChild` (`:367`) |                               |
| Failed spawn                    | YES     | `exited` is `error`, writes are dropped        | Listeners were never attached |
| Empty or oversized stderr line  | YES     | Truncated to 64 KiB                            |                               |
| Repeated `kill()`               | YES     | Idempotent                                     |                               |
| `continue` after exit or abort  | YES     | Rejects with a resume hint                     |                               |
| Unknown extension notifications | YES     | Capped at 32 distinct infos                    |                               |
| Resume fails then new session   | YES     | Info plus `session/new`                        |                               |
| Child exit without stdout close | NO      | Hangs                                          | M1                            |

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH (the loader and fake agent were not line-audited; tests pass)
- Top risk: a mid-turn child exit that never closes stdout leaves the prompt pending (M1), and an `error` event on a live child orphans the process (M2).
- What a robust implementation would add: `closeReadable()` on child `exit` after a short grace; detach listeners and tree-kill in `onChildError`; a bounded (1-2 s) wait for the cancel response before the kill; an optional `buildEnv` on the profile before a vendor that needs it; and a transport spec using a real child that exits while a grandchild holds the pipe.
