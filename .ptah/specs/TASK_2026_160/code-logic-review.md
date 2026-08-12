# Code Logic Review - TASK_2026_160

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 1              |
| Serious Issues      | 4              |
| Moderate Issues     | 2              |
| Failure Modes Found | 6              |

## The 5 Paranoid Questions

### 1. How does this fail silently?

- `OpencodeCliAdapter.configureMcpServer()`/`cleanupMcpEntry()` fail silently by design (`catch { /* non-fatal */ }`) — if a second concurrent opencode agent's cleanup races a sibling's configure, MCP tools quietly stop being available with no error surfaced to the user, just "the tool wasn't there."
- `PiCliAdapter`'s `writeRequest()` swallows write failures (`try { child.stdin.write(...) } catch { /* EPIPE mid-write */ }`) — a steer request silently vanishes if it lands in the post-settle teardown window; the caller (`AgentProcessManager.steer()`) returns successfully with no indication the message was never delivered.
- On VS Code, saving an opencode/pi/antigravity model selection silently fails from the user's perspective in one of two ways depending on where the throw is swallowed (see Critical Issue 1) — either the RPC call rejects with an opaque error, or (if the promise rejection is caught upstream) the UI shows "saved" while the value never persists.

### 2. What user action causes unexpected behavior?

- Selecting a model for opencode, Pi, or Antigravity in Settings → Agent Orchestration on the **VS Code** target and clicking to persist it throws, because the underlying config key was never registered anywhere VS Code's `WorkspaceConfiguration.update()` can accept (see Critical Issue 1).
- Selecting `off` or `max` thinking level for Pi is **not possible** — the dropdown only offers `Default/Minimal/Low/Medium/High/Extra High`, even though the adapter's own code comment says Pi "supports the full scale (off|minimal|low|medium|high|xhigh|max)."
- Starting two opencode agents against the same repo (e.g. via Tribunal FORGE/RACE, which explicitly targets multiple vendors against the same working tree) can have one agent's completion cleanup delete the MCP config entry the other agent's run may still depend on.

### 3. What data makes this produce wrong results?

- Any Pi turn where a `steer()` call arrives in the same event-loop window as the turn's `agent_settled`-driven teardown: `activeChild` is never nulled/invalidated after `finish()` kills it, so `steer()`'s only guard is `activeChild.stdin?.writable`, which can still read `true` for a brief window after `child.kill('SIGTERM')` is issued (Node/OS teardown of child stdio is asynchronous).
- On Windows, if `resolveCliPath('opencode')`'s `.cmd`/`.ps1` wrapper hits the documented `/bin/sh.exe` breakage, `resolveOpencodeNativeBinary()` never gets a chance to rescue it, because `options.binaryPath` is always pre-populated by the manager, so the `!options.binaryPath` fallback branch never executes.

### 4. What happens when dependencies fail?

- If Pi's `pi` process crashes/hangs without ever emitting `agent_settled` and without exiting, the turn is only rescued by `AgentProcessManager`'s outer `DEFAULT_TIMEOUT`/`handleTimeout()` safety net (confirmed present) — not by anything in the adapter itself. That's an acceptable backstop, but it means a hung Pi RPC session sits fully "running" (consuming a concurrency slot) for the full timeout window with no adapter-level liveness check.
- If Pi shells out to bash to run a long-lived subprocess (dev server, background watcher) and the turn is aborted/timed out, `PiCliAdapter.killChild()` only signals the immediate `pi` process (`child.kill('SIGTERM')`), not the process tree — unlike `AgentProcessManager.killProcess()`'s `taskkill /T` (Windows) / process-group kill (POSIX) used for regular process-based agents. Orphaned children can outlive the "killed" agent.

### 5. What's missing that the requirements didn't mention?

- No adapter-level watchdog for "spawned but Pi never produces the initial `session`/`get_state` response" (e.g. `pi --mode rpc` accepting the flags but silently ignoring `get_state`) — the UNVERIFIED note in the header ("that `--mode rpc` honours ... `--session`") has no runtime detection or fallback wired up despite `capturedSessionFile` being captured specifically to support a documented fallback (`switch_session`) that was never implemented.
- No synchronization/locking around opencode's per-working-directory `opencode.json` MCP read-merge-write across concurrent agents in the same repo — a first-class Ptah scenario (canvas multi-tile / Tribunal FORGE), not just "a human editing the file at the same time" as the design doc's risk note frames it.

## Failure Mode Analysis

### Failure Mode 1: New CLI model settings unregistered as file-based keys (VS Code write throws)

- **Trigger**: User opens Settings → Agent Orchestration → opencode/Pi/Antigravity → selects a model → UI calls `agent:setConfig({ opencodeModel: '...' })`.
- **Symptoms**: On the VS Code target, `VscodeWorkspaceProvider.setConfiguration('ptah', 'agentOrchestration.opencodeModel', value)` falls through to `vscode.workspace.getConfiguration('ptah').update('agentOrchestration.opencodeModel', value, Global)`, which VS Code rejects with `Error: Unable to write to User Settings because agentOrchestration.opencodeModel is not a registered configuration` (the key was never added to `package.json`'s `contributes.configuration`, and — unlike its siblings — it's also missing from `FILE_BASED_SETTINGS_KEYS`, so it never reaches the code path that would have bypassed VS Code's native settings).
- **Impact**: The user-facing "pick a model" feature this task explicitly delivers is broken on the primary distribution target (VS Code Marketplace extension) for all three new CLIs.
- **Current Handling**: None — the write path has no fallback once it reaches `vscode.workspace.getConfiguration(...).update()` on an unregistered key.
- **Recommendation**: Add `'agentOrchestration.antigravityModel'`, `'agentOrchestration.opencodeModel'`, `'agentOrchestration.piModel'` to `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS` in `libs/backend/platform-core/src/file-settings-keys.ts` (mirroring `codexModel`/`copilotModel`/`cursorModel`), and to `KNOWN_CONFIG_KEYS` in `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` so they're included in settings export/import too.

### Failure Mode 2: Late steer targets a just-killed Pi child, hitting an unguarded stdin stream

- **Trigger**: `AgentProcessManager.steer(agentId, msg)` is called in the narrow window between the Pi adapter's `finish()` (which kills the child via `killChild()` on `agent_settled`) and the manager's `handleExit()` callback flipping `tracked.info.status` away from `'running'` (that callback runs off `sdkHandle.done.then(...)`, a microtask scheduled right after `finish()`'s `resolve(code)`).
- **Symptoms**: `steer()`'s guard (`tracked.info.status !== 'running'`) hasn't yet flipped, so it reaches `sdkHandle.steer(instruction)` → `writeRequest(activeChild, {type:'steer',...})`. `activeChild` still points at the just-killed child; nothing nulls it out after `finish()`. If `child.stdin.writable` still reads `true` in that instant (Node's stdio teardown after `kill()` is asynchronous) the write proceeds against a process that is exiting.
- **Impact**: If the write triggers an async `EPIPE`/`ERR_STREAM_DESTROYED` on `child.stdin`, Node emits an `'error'` event on that stream. **No listener is attached to `child.stdin`** anywhere in `pi-cli.adapter.ts` (only `child.on('error', ...)` — the process-level error — is handled, not the stream-level one). An unhandled `'error'` event on an EventEmitter throws, which can crash the host process (VS Code extension host / Electron main / `ptah-cli`).
- **Current Handling**: `writeRequest()`'s `try/catch` only catches _synchronous_ throws from `.write()` (e.g. write-after-`end()`); it does not catch the asynchronously-emitted stream `'error'` event that EPIPE-style failures actually produce.
- **Recommendation**: (1) Attach a no-op `child.stdin?.on('error', () => {})` in `runTurn()` right after spawn, exactly like the defensive pattern already used for the process-level `child.on('error', ...)`. (2) Track child liveness explicitly (e.g. a `childAlive` flag flipped to `false` inside `finish()`/`killChild()`) and gate `steer()`/`writeRequest` on it instead of relying solely on `stdin.writable`, so a late steer is a guaranteed no-op rather than a race.

### Failure Mode 3: Orphaned subprocesses on Pi abort/timeout

- **Trigger**: A Pi turn is aborted (`stop()`), times out (`handleTimeout()`), or is interrupted while Pi is mid-way through a bash-tool call (Pi requires and shells out to bash for tool execution per its own docs, especially on Windows).
- **Symptoms**: `PiCliAdapter.killChild()` calls `child.kill('SIGTERM')` on the immediate `pi` process only — no process-tree kill.
- **Impact**: Any subprocess Pi itself spawned for a tool call (e.g. a long-running shell command, dev server, watcher) can survive the "killed" agent, unlike agents killed through `AgentProcessManager.killProcess()`'s platform-specific `taskkill /pid <pid> /T /F` (Windows) / `process.kill(-pid, signal)` process-group kill (POSIX) — that careful teardown is bypassed entirely for SDK-handle agents (`tracked.process` is `null`), so it never applies here regardless.
- **Current Handling**: None beyond a single-process SIGTERM.
- **Recommendation**: Not a regression introduced by this task specifically (Antigravity's and opencode's own `SdkHandle.abort` paths use the identical `child.kill('SIGTERM')`-only pattern), but worth flagging given Pi's heavier reliance on shelling out — consider having `killChild()` use the same tree-kill helper `AgentProcessManager.killProcess()` uses, exposed for adapter reuse.

### Failure Mode 4: Concurrent opencode agents in the same working directory race on `opencode.json`

- **Trigger**: Two or more opencode agents run against the same `workingDirectory` concurrently (e.g. Tribunal FORGE/RACE across worktrees of the same repo root, or two background canvas tiles pointed at the same folder).
- **Symptoms**: `configureMcpServer()`/`cleanupMcpEntry()` do an unsynchronized read-merge-write of `<workingDirectory>/opencode.json`. Agent A finishing and calling `cleanupMcpEntry()` (delete `mcp.ptah`, drop `mcp` key if empty) can race Agent B's `configureMcpServer()` (which is running/about to run in the same directory), potentially leaving the file without the `mcp.ptah` entry while B is still active or about to spawn and read it.
- **Impact**: Silent, unpredictable loss of MCP tool access for a sibling agent — no error surfaced (both methods `catch` and swallow failures by design).
- **Current Handling**: Design doc explicitly accepts "a concurrent **user** edit" as a risk, but doesn't address Ptah's own concurrent-agent case, which is materially more likely given this repo's explicit multi-agent features.
- **Recommendation**: At minimum, only delete the `mcp.ptah` entry in cleanup if no other tracked agent is still running against that same `workingDirectory` for `opencode`, or move to a per-agent/session-scoped MCP config mechanism if opencode supports one.

### Failure Mode 5: Reasoning-effort UI can't express Pi's documented full scale

- **Trigger**: User opens the Pi reasoning-effort dropdown.
- **Symptoms**: Options are `Default/Minimal/Low/Medium/High/Extra High` — the same shared `reasoningEffortOptions` array used for Codex/Copilot. Pi's own adapter code comment says it "supports the full scale (off|minimal|low|medium|high|xhigh|max)."
- **Impact**: Users cannot select `off` (disable thinking) or `max` (highest effort) for Pi via the UI, even though the backend wiring (`resolveReasoningEffort` → `options.reasoningEffort` → `--thinking`) would pass either value through unmodified if it were ever set.
- **Current Handling**: None — `agent-orchestration-config.component.ts` reuses the Codex/Copilot list verbatim for Pi's selector.
- **Recommendation**: Give Pi its own options array (`off, minimal, low, medium, high, xhigh, max`) instead of reusing `reasoningEffortOptions`.

### Failure Mode 6: opencode's Windows native-binary fallback is effectively dead code

- **Trigger**: opencode is detected via `resolveCliPath('opencode')` (always succeeds when the CLI is "installed"), and the manager spawns via `doSpawnSdk(..., detection.path, ...)`, which always populates `options.binaryPath`.
- **Symptoms**: `runSdk()`'s Windows-native-binary rescue is gated by `if (!options.binaryPath)`, a condition that's essentially never true given the manager always forwards `detection.path`.
- **Impact**: If the documented `.cmd`/`.ps1` → `/bin/sh.exe` breakage on Windows (research doc §10) reproduces for the resolved `.cmd` path (not just the `.ps1` the issues cite), the coded fallback (`resolveOpencodeNativeBinary()`) never actually runs to rescue it — despite being written specifically for that scenario.
- **Current Handling**: Fallback logic exists but is unreachable via the real invocation path.
- **Recommendation**: Either (a) have `runSdk()` unconditionally probe `resolveOpencodeNativeBinary(options.binaryPath)` and prefer it over `options.binaryPath` on Windows regardless of whether `binaryPath` was set, or (b) confirm empirically that the `.cmd` path never hits the bug (research flags this as unverified) and downgrade/remove the dead branch with a comment explaining why.

## Critical Issues

### Issue 1: `antigravityModel`/`opencodeModel`/`piModel` config keys unregistered — breaks persistence on VS Code

- **File**: `libs/backend/platform-core/src/file-settings-keys.ts` (missing entries), consumed by `apps/ptah-extension-vscode/src/services/rpc/handlers/agent-rpc.handlers.ts:233-241` (`setAgentCfg('antigravityModel'|'opencodeModel'|'piModel', ...)`)
- **Scenario**: User selects a model for opencode/Pi/Antigravity in the VS Code extension's settings panel.
- **Impact**: `VscodeWorkspaceProvider.setConfiguration('ptah', 'agentOrchestration.opencodeModel', value)` (`libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:92-110`) checks `isFileBasedSettingKey('agentOrchestration.opencodeModel')`, which is `false` since the key isn't in `FILE_BASED_SETTINGS_KEYS` — so it falls through to `vscode.workspace.getConfiguration('ptah').update('agentOrchestration.opencodeModel', value, Global)`. That key has no `contributes.configuration` schema entry in `apps/ptah-extension-vscode/package.json` (verified — only `preferredAgentOrder`/`maxConcurrentAgents` are registered under `ptah.agentOrchestration.*`), so VS Code throws `Unable to write to User Settings because ... is not a registered configuration`.
- **Evidence**:
  ```ts
  // file-settings-keys.ts — codexModel/copilotModel/cursorModel ARE listed…
  'agentOrchestration.codexModel',
  'agentOrchestration.copilotModel',
  'agentOrchestration.cursorModel',
  // …but antigravityModel / opencodeModel / piModel are absent from both
  // FILE_BASED_SETTINGS_KEYS and FILE_BASED_SETTINGS_DEFAULTS.
  ```
- **Fix**: Add the three missing keys (and matching `''` defaults) to `FILE_BASED_SETTINGS_KEYS`/`FILE_BASED_SETTINGS_DEFAULTS` in `file-settings-keys.ts`, and to `KNOWN_CONFIG_KEYS` in `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts` so they're covered by settings export too. (`piReasoningEffort` was correctly registered in this diff — only the three model keys were missed.)

## Serious Issues

### Issue 2: Pi's persistent `child.stdin` has no `'error'` listener — late steer can crash the host process

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts:329-349` (`writeRequest`/`killChild`), `:493-499` (`steer`)
- **Scenario**: See Failure Mode 2 above — a `steer()` call landing in the microtask-scale window after `finish()` has killed the current turn's child but before `tracked.info.status` flips away from `'running'`.
- **Impact**: Potential unhandled `'error'` event on `child.stdin`, which can crash the process hosting `AgentProcessManager` (VS Code extension host, Electron main, or `ptah-cli`).
- **Fix**: Attach `child.stdin?.on('error', () => {})` alongside the existing `child.stdout?.setEncoding`/`child.stderr?.setEncoding` setup in `runTurn()`; additionally null/flag `activeChild` liveness inside `finish()` so `steer()` becomes a guaranteed no-op post-settle rather than depending on `stdin.writable` timing.

### Issue 3: Concurrent opencode agents can clobber each other's `opencode.json` MCP entry

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:333-388` (`configureMcpServer`/`cleanupMcpEntry`)
- **Scenario**: See Failure Mode 4.
- **Impact**: Silent MCP tool loss for a concurrently-running sibling agent in the same working directory.
- **Fix**: Reference-count or otherwise coordinate cleanup so it only fires when no other opencode agent is active against the same `workingDirectory`.

### Issue 4: opencode's Windows native-binary fallback is unreachable in practice

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:475-481`
- **Scenario**: See Failure Mode 6.
- **Impact**: The specific Windows mitigation this task's own research doc called "the single biggest feasibility risk" and said should be "spike-tested... before merging" has no working code path in the common case.
- **Fix**: Probe the native binary unconditionally on Windows (independent of whether `options.binaryPath` was supplied), or verify empirically that the `.cmd` wrapper never hits the bug and document why the branch is intentionally narrow.

### Issue 5: Pi's `killChild()` doesn't kill the process tree

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts:343-349`
- **Scenario**: See Failure Mode 3.
- **Impact**: Orphaned subprocesses on abort/timeout for a CLI that documents heavy shell-out usage.
- **Fix**: Reuse `AgentProcessManager`'s tree-kill logic (or the platform primitives it wraps) instead of a bare `child.kill('SIGTERM')`. Lower urgency since this mirrors an existing accepted pattern (Antigravity/opencode do the same), but Pi's bash dependency makes it a more likely trigger.

## Data Flow Analysis

```
Settings UI (agent-orchestration-config.component.ts)
   │  onModelSelect('opencode', evt) / onReasoningEffortSelect('pi', evt)
   ▼
rpcService.call('agent:setConfig', { opencodeModel | piReasoningEffort })
   │
   ▼
AgentRpcHandlers.setAgentCfg(name, value)                     [3 near-identical impls:
   │  workspace.setConfiguration('ptah', `agentOrchestration.${name}`, value)     vscode / electron / cli-engine]
   ▼
IWorkspaceProvider.setConfiguration(section='ptah', key='agentOrchestration.X', value)
   │
   ├─ isFileBasedSettingKey('agentOrchestration.X')?
   │     • codexModel / copilotModel / cursorModel / piReasoningEffort → TRUE → PtahFileSettingsManager (~/.ptah/settings.json)  ✔ OK
   │     • antigravityModel / opencodeModel / piModel                  → FALSE (not registered)                                  ✘ GAP #1
   │
   ▼ (fallback path taken for the 3 unregistered keys)
   VS Code: vscode.workspace.getConfiguration('ptah').update('agentOrchestration.X', value, Global)
            → THROWS (key not in package.json contributes.configuration)                                                          ✘ GAP #1 (VS Code)
   Electron/CLI: this.config['ptah']['agentOrchestration.X'] = value; persistConfig()
            → "succeeds" but into a different store than the sibling keys                                                         ⚠ inconsistent
```

```
Pi turn lifecycle (pi-cli.adapter.ts)
  spawn 'pi --mode rpc -a ...'      → activeChild = child
  write {prompt} + {get_state}      → session id capture (session hdr OR get_state response)
  stdout JSONL loop                 → segments; on agent_settled → finish(0)
  finish(): settled=true (once)  →  killChild(child): write {abort} (still-writable at this instant, OK)
                                      → child.kill('SIGTERM')           [activeChild NOT cleared here]  ✘ GAP #2
                                   →  resolve(code)  (done promise settles — microtask)
  ── window ──                       AgentProcessManager.steer() guard reads tracked.info.status,
                                      which hasn't flipped away from 'running' yet (flips in the
                                      .then() callback off `done`, scheduled after finish()'s resolve)
  steer() (if called here)       →  writeRequest(activeChild, {steer}) → child.stdin?.writable check
                                      may still read true → write against a dying child, no
                                      child.stdin 'error' listener anywhere                              ✘ GAP #2
```

### Gap Points Identified:

1. `FILE_BASED_SETTINGS_KEYS`/`FILE_BASED_SETTINGS_DEFAULTS`/`KNOWN_CONFIG_KEYS` never updated for the 3 new model keys — breaks the write path on VS Code, diverges storage on Electron/CLI.
2. `activeChild` in `pi-cli.adapter.ts` is never invalidated after being killed, and `child.stdin` has no `'error'` listener — a late `steer()` can write into a teardown race with no crash-safety net.
3. `opencode.json`'s MCP entry is mutated with no coordination across concurrent same-directory runs.

## Requirements Fulfillment

| Requirement                                                      | Status   | Concern                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| opencode adapter: spawn + JSONL → segments                       | COMPLETE | Mapping matches research doc's table; text-delta dedup, bash→command, tool_use, error, unknown-event fallback all present and tested.                                                                                                                               |
| opencode: MCP config read-merge-write + cleanup                  | PARTIAL  | Works for the single-agent case; races under Ptah's own concurrent-agent usage (Issue 3).                                                                                                                                                                           |
| opencode: Windows native-binary fallback                         | PARTIAL  | Coded but effectively unreachable given how `binaryPath` is always populated (Issue 4).                                                                                                                                                                             |
| Pi adapter: RPC mode, mid-run steer, continuation                | PARTIAL  | Core settle-then-kill lifecycle and continuation re-spawn logic are correct and well-tested; the steer-after-settle race and missing `stdin` error guard are real gaps (Issue 2).                                                                                   |
| Steer routing (`AgentProcessManager.steer()`)                    | COMPLETE | Correct order: not-found → not-running → supportsSteer → sdkHandle.steer → legacy stdin fallback. Status guard closes most (not all) of the late-steer race.                                                                                                        |
| Session id capture (opencode: first event; Pi: header/get_state) | COMPLETE | Both paths implemented and unit-tested; `capturedSessionFile` is captured but never used for the documented `switch_session` fallback if `--session` isn't honoured in rpc mode (acceptable given it's explicitly flagged UNVERIFIED, but worth tracking).          |
| Reasoning-effort + model wiring reaches the adapter              | PARTIAL  | Backend wiring (`resolveReasoningEffort`/`resolveConfiguredModel` → `options.reasoningEffort`/`options.model` → `--thinking`/`--model`) is correct. Persistence is broken for the 3 model keys (Issue 1); UI can't express Pi's full effort scale (Failure Mode 5). |
| getConfig/setConfig symmetry across the 3 RPC handler files      | COMPLETE | vscode / electron / cli-engine handlers are line-for-line symmetric for all new keys.                                                                                                                                                                               |

### Implicit Requirements NOT Addressed:

1. No liveness/no-op guarantee for Pi's `steer()` beyond a single `.writable` boolean check — a real "settle vs. late-steer" race exists despite the task's explicit ask to verify this is safe.
2. No coordination for opencode's shared, project-root MCP config file across Ptah's own concurrent multi-agent features (canvas tiles, Tribunal FORGE/RACE) — only "a human might also edit this file" was considered.

## Edge Case Analysis

| Edge Case                                                                        | Handled   | How                                                                                                                                                | Concern                                |
| -------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `agent_end` with `willRetry:true` (Pi)                                           | YES       | Explicit `case 'agent_end': return false` — never settles on it; test covers this.                                                                 | None.                                  |
| Non-JSON / partial JSONL lines (both adapters)                                   | YES       | `try/catch` around `JSON.parse`, line-buffered across `data` chunks with a 1MB runaway cap.                                                        | None.                                  |
| Steer called on an agent with no `sdkHandle.steer` (e.g. opencode)               | YES       | `AgentProcessManager.steer()` falls through the `supportsSteer()` guard before reaching `sdkSteer` (opencode reports `supportsSteer() === false`). | None.                                  |
| Steer called just after Pi's turn settles (child killed, status not yet flipped) | NO        | `activeChild` still points at the dying child; `steer()` writes unconditionally if `activeChild` is truthy.                                        | Issue 2 — real, if narrow, crash risk. |
| Two opencode agents, same `workingDirectory`, concurrent                         | NO        | No locking on `opencode.json`.                                                                                                                     | Issue 3.                               |
| Windows `.cmd` opencode wrapper hitting the `/bin/sh.exe` bug                    | PARTIALLY | Native-binary fallback exists but is gated on a condition that's basically always false in the real spawn path.                                    | Issue 4.                               |
| Selecting Pi's `off`/`max` thinking level via UI                                 | NO        | `reasoningEffortOptions` doesn't include them.                                                                                                     | Failure Mode 5.                        |
| VS Code: persisting an opencode/pi/antigravity model choice                      | NO        | Unregistered config key throws.                                                                                                                    | Issue 1 (Critical).                    |

## Integration Risk Assessment

| Integration                               | Failure Probability                                                      | Impact                                                                           | Mitigation                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| VS Code settings write for new model keys | HIGH (always, on first use)                                              | User-facing feature completely broken on VS Code                                 | Needed: register the 3 keys (Issue 1)                                  |
| Pi child.stdin late-write race            | LOW (narrow timing window)                                               | Possible host-process crash                                                      | Needed: stdin error listener + liveness flag (Issue 2)                 |
| opencode concurrent-agent MCP config race | MEDIUM (real Ptah usage pattern: Tribunal FORGE/RACE, multi-tile canvas) | Silent MCP tool loss for a sibling agent                                         | Needed: coordinate cleanup (Issue 3)                                   |
| opencode Windows `.cmd`/`.ps1` breakage   | UNVERIFIED (per research doc)                                            | Complete Windows non-functionality if it reproduces, with no working rescue path | Needed: make the fallback reachable, or empirically clear it (Issue 4) |
| Pi orphaned subprocesses on kill          | LOW-MEDIUM                                                               | Lingering shell processes after abort/timeout                                    | Nice-to-have: tree-kill (Issue 5)                                      |

## Verdict

**Recommendation**: REVISE
**Confidence**: HIGH
**Top Risk**: The three new per-CLI model settings (`antigravityModel`, `opencodeModel`, `piModel`) were never registered in `FILE_BASED_SETTINGS_KEYS`/`FILE_BASED_SETTINGS_DEFAULTS`, which breaks persisting them at all on the VS Code target (the primary distribution surface) — a straightforward, mechanical fix, but it means the headline "model selectors wired end-to-end" claim does not hold as shipped.

## What Robust Implementation Would Include

- A single source of truth (or at least a lint/test check) ensuring every new `agentOrchestration.*` key added to an RPC handler's get/set surface is also registered in `FILE_BASED_SETTINGS_KEYS` — this exact class of omission is easy to make and easy to miss in review, and it silently degrades per-platform instead of failing loudly in CI.
- A liveness flag on Pi's `activeChild` (not just relying on `stream.writable`), plus defensive `'error'` handlers on any long-lived, repeatedly-written child stdio stream — standard hardening for a "persistent subprocess with a live stdin channel" design, which this explicitly is.
- Either a lock file / mutex or a reference count around opencode's shared project-root MCP config mutation, given Ptah's own concurrency model (not just "a human might edit this too") is the more likely trigger.
- A live-fire (not just mocked) Windows smoke test for the opencode native-binary fallback, since the research doc itself flagged this as the single biggest, spike-first risk before merging — the current code doesn't even reach that fallback in the common case.
