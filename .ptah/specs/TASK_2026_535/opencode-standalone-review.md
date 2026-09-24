# Code Logic Review — `TASK_2026_535`

## Verdict

REVISE: The fix correctly probes `--standalone` via `run --help` and sets the flag before positional prompt args, but caches abnormal non-zero exits as permanent negatives, risks unhandled rejection in the probe promise chain, and silently degrades to omitting `--standalone` on probe timeout without observability.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 6/10                                 |
| Assessment          | NEEDS_REVISION                       |
| Blocking issues     | 0                                    |
| Serious issues      | 2                                    |
| Moderate issues     | 1                                    |
| Minor issues        | 3                                    |
| Failure modes found | 3                                    |

Evidence separating score: The implementation is functional and cleanly addresses the primary defect (passing `--standalone` to OpenCode 2.x when supported so `OPENCODE_CONFIG_CONTENT` reaches private session instances). However, caching `outcome.exitCode !== 0` as a definitive negative decision (rather than a transient error) permanently disables `--standalone` for all subsequent runs in that process session if the initial help probe exits abnormally. Coupled with unhandled rejection risk on the probe Promise and silent failure when the 8 s probe times out, the logic requires refinement before merge.

---

## Five logic questions

### 1. How does this fail silently — where does a failure produce a success-looking result?
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:503-515` and `576-578`:
  When `probeCommandOnce(binary, ['run', '--help'])` times out (8000 ms) or encounters a spawn error, `supportsStandalone(binary)` quietly settles to `false`. Inside `runSdk`, `if (await this.supportsStandalone(binary))` evaluates to `false` and skips adding `--standalone`. The child process spawns cleanly, returning an `SdkHandle` to `agent-process-manager.service.ts` without error. However, on OpenCode 2.x, omitting `--standalone` causes `opencode run` to connect to the shared background service which does not inherit `OPENCODE_CONFIG_CONTENT`. The agent runs its entire lifecycle with zero `ptah_*` tools, cannot call `ptah_agent_report`, and reports 0 deliverables. Neither caller nor user is alerted that `--standalone` was dropped due to a probe timeout.

### 2. What user action produces unexpected behaviour?
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:247`:
  If a user starts Ptah with OpenCode 1.x installed, `supportsStandalone` probes `run --help`, finds no `--standalone` flag, and caches `false`. If the user updates OpenCode to 2.x in the same VS Code/desktop session, `CliDetectionService.detectAll()` or `refreshCliTokens()` will detect version 2.x, but `OpencodeCliAdapter` retains the cached `false` in `this.standaloneSupport`. All subsequent lane runs continue without `--standalone`, failing to connect to MCP tools until the entire host application is restarted.

### 3. What input data makes this produce a wrong answer rather than an error?
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:508-510`:
  If `opencode run --help` exits with an abnormal code (e.g. exit code 1 or 2 due to a corrupted configuration, locked database, or missing system library) or is killed by a signal (`exitCode: null`), `outcome.exitCode === 0` evaluates to `false`. Because `outcome.timedOut` and `outcome.errored` are both `false`, `supportsStandalone` does NOT delete the binary from the cache map. The promise resolves to `false` and is permanently cached. It treats an abnormal exit as confirmation that `--standalone` is unsupported.

### 4. What happens when a dependency fails, times out, or returns a shape it should not?
- If `this.spawner?.spawnProcess` throws synchronously, `probeCommandOnce` rejects the returned promise. `supportsStandalone` has no `.catch()` handler on the cached promise, causing an unhandled promise rejection in `runSdk` and permanently locking the cache with a rejected promise for that binary path.
- If `opencode run --help` hangs, the 8-second timer kills the child process via `child.kill()`. On Windows with a `.cmd` wrapper without `resolveDirectSpawn`, `child.kill()` only terminates `cmd.exe`, potentially orphaning the underlying `node.exe`/`opencode.exe` process.

### 5. What is missing that the requirements never mentioned?
- Cache invalidation when CLI version or detection results change.
- Observability/logging when `--standalone` fallback triggers on an installed CLI.
- Tree-kill on timeout inside `probeCommandOnce` when spawning Windows `.cmd` wrappers.

---

## Failure modes

### Failure Mode 1: Permanent Caching of Abnormal Probe Exit
- **Trigger**: `opencode run --help` exits with non-zero exit code (e.g. 1) or is terminated by OS/signal (`exitCode: null`) on its first invocation.
- **Symptom**: `--standalone` is permanently disabled for that binary across all subsequent agent runs in the session. All future OpenCode 2.x lanes fail to load MCP tools.
- **Evidence**: `opencode-cli.adapter.ts:504-511`
- **Current handling**: Deletes cache only on `outcome.timedOut || outcome.errored`. A non-zero exit code leaves `false` in `standaloneSupport` permanently.
- **Recommendation**: Invalidate the cache whenever `outcome.exitCode !== 0` (or `null`). Only cache negative results when `outcome.exitCode === 0` and the flag is absent.

### Failure Mode 2: Unhandled Rejection Stuck in Probe Cache
- **Trigger**: Process spawner throws synchronously or `probeCommandOnce` throws an unexpected runtime exception.
- **Symptom**: `runSdk()` fails with unhandled rejection. Subsequent calls to `runSdk()` instantly fail because `this.standaloneSupport.get(binary)` re-throws the rejected promise.
- **Evidence**: `opencode-cli.adapter.ts:502-514`
- **Current handling**: No `.catch()` on the stored promise chain.
- **Recommendation**: Add a `.catch()` block to clear the map entry and resolve `false`.

### Failure Mode 3: Silent MCP Degradation on Probe Timeout
- **Trigger**: Machine CPU or I/O bottleneck causes `opencode run --help` to exceed 8000 ms.
- **Symptom**: The agent spawns looking healthy, but runs without `--standalone`, failing all MCP calls and sending 0 reports.
- **Evidence**: `opencode-cli.adapter.ts:576-578`
- **Current handling**: Silently drops `--standalone` from `args`.
- **Recommendation**: Emit an error or warning log indicating that the capability probe timed out and fallback mode was engaged.

---

## Findings

### Finding 1: Non-zero exit code or signal termination cached permanently as `false`
- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:504-511`
- **Severity**: Major (Serious)
- **Scenario**: If `opencode run --help` encounters a transient failure (e.g., config file lock, memory pressure, AV scan, or SIGTERM/cancellation) and exits with code 1 or `null`, `outcome.timedOut` is `false` and `outcome.errored` is `false`. The entry is NOT deleted from `this.standaloneSupport`. The returned promise permanently resolves to `false`. Every subsequent lane run in the application lifecycle skips `--standalone`.
- **Impact**: OpenCode 2.x lanes connect to the shared background service without `OPENCODE_CONFIG_CONTENT`, stripping MCP tools for all subsequent tasks.
- **Fix**: Invalidate the cache on any non-zero or null exit code:
```typescript
if (outcome.timedOut || outcome.errored || outcome.exitCode !== 0) {
  this.standaloneSupport.delete(binary);
}
```

### Finding 2: Unhandled rejection and sticky failure on probe exception
- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:502-514`
- **Severity**: Major (Serious)
- **Scenario**: If `spawnCli` or `this.spawner.spawnProcess` throws synchronously, `probeCommandOnce` rejects. The rejection bypasses `.then()` and is stored in `this.standaloneSupport`. When `runSdk` awaits `supportsStandalone(binary)`, it throws. Because the deletion logic was in `.then()`, the rejected promise remains cached; every future runSdk call fails immediately.
- **Impact**: Completely halts OpenCode agent spawning until process restart.
- **Fix**: Attach `.catch()` to the probe chain:
```typescript
probe = this.probeCommandOnce(binary, ['run', '--help'])
  .then((outcome) => {
    if (outcome.timedOut || outcome.errored || outcome.exitCode !== 0) {
      this.standaloneSupport.delete(binary);
    }
    return (
      outcome.exitCode === 0 &&
      /^\s*--standalone\b/m.test(stripAnsiCodes(outcome.stdout))
    );
  })
  .catch(() => {
    this.standaloneSupport.delete(binary);
    return false;
  });
```

### Finding 3: Silent MCP drop on probe timeout without observability
- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:576-578`
- **Severity**: Moderate
- **Scenario**: When the probe takes longer than 8 s (observed execution on Windows is 3-4 s, which leaves a narrow margin under CI or test contention), the timeout triggers, returning `false`. `runSdk` omits `--standalone` without emitting any diagnostic log.
- **Impact**: Agent appears running but has no MCP tools; developer/user has no indication why tools are missing.
- **Fix**: Log a warning when probe fails or times out so the failure mode is auditable.

### Finding 4: Orphaned process risk on Windows `.cmd` probe timeout
- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:345-348`
- **Severity**: Minor
- **Scenario**: In `probeCommandOnce`, when `binary` is a Windows `.cmd` shim, `child.kill()` terminates `cmd.exe`, but may orphan the underlying process. While `runSdk` uses `killProcessTree`, `probeCommandOnce` uses simple `child.kill()`.
- **Impact**: Hanging node/exe processes left in background if help probe times out.
- **Fix**: Use `killProcessTree` or run `resolveDirectSpawn` before spawning in `probeCommandOnce`.

### Finding 5: Inability to invalidate probe cache on CLI upgrade
- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:247`
- **Severity**: Minor
- **Scenario**: `OpencodeCliAdapter.standaloneSupport` is a private Map that is never cleared when `CliDetectionService.invalidateCache()` or `detectAll()` is called.
- **Impact**: Upgrading OpenCode 1.x to 2.x during an active session retains `--standalone: false`.
- **Fix**: Clear `standaloneSupport` on `detect()` or expose a reset method.

### Finding 6: Incomplete test coverage for timeout and concurrency
- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.spec.ts:500-558`
- **Severity**: Minor
- **Scenario**: The 5 new unit tests cover flag presence, flag absence, non-zero exit, sequential probe caching, and failed spawn retry (`emitError`). They do not test probe timeout (`timedOut: true`) or concurrent calls awaiting an in-flight probe.
- **Impact**: Edge cases in the caching state machine remain unverified by tests.
- **Fix**: Add test cases for probe timeout invalidation and concurrent `runSdk` invocations.

---

## Data flow

1. **Binary Resolution** (`runSdk`, lines 563-567):
   - `binary` initialized from `options.binaryPath ?? 'opencode'`.
   - `resolveOpencodeNativeBinary` attempts to resolve native `.exe`.
   - **Status**: [OK] Binary path is resolved prior to constructing arguments and running probes.

2. **Probe Execution** (`supportsStandalone`, lines 500-515):
   - Check `this.standaloneSupport.get(binary)`. If absent, call `probeCommandOnce(binary, ['run', '--help'])`.
   - Store pending Promise in map to deduplicate concurrent requests.
   - **Status**: [GAP: Finding 1, Finding 2] Exit code non-zero is cached permanently; unhandled rejection if spawner throws.

3. **Argument Construction** (`runSdk`, lines 569-586):
   - Await `this.supportsStandalone(binary)`.
   - If true, push `'--standalone'`.
   - Push `'--session'` if `options.resumeSessionId` present.
   - Push `taskPrompt` LAST as positional argument.
   - **Status**: [OK] Verified flag ordering and positional prompt placement.

4. **Direct Spawn & Process Execution** (`runSdk`, lines 604-614):
   - Call `resolveDirectSpawn(binary)` to bypass Windows `cmd.exe` 8 KB argument limit.
   - Spawn process with `OPENCODE_CONFIG_CONTENT` env var containing Ptah MCP server URL.
   - **Status**: [OK] With `--standalone`, OpenCode 2.x spawns private server inheriting process environment.

---

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Detect `--standalone` support via `run --help` | COMPLETE | Correctly parses stdout with ANSI stripping |
| Omit `--standalone` on OpenCode 1.x | COMPLETE | Flags parsed; 1.x without flag omits argument |
| Do not cache failed or timed-out probes | PARTIAL | Caches non-zero exit code permanently (Finding 1) |
| Position `--standalone` before prompt | COMPLETE | Prompt remains trailing positional argument |
| Correct v1-era header comment | COMPLETE | Accurately describes OpenCode 2.x background server root cause |
| Unit tests for argument construction & caching | COMPLETE | 5 tests added; all 43 tests pass (minor test gaps in Finding 6) |

---

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Help text mentions `--standalone` in description of another flag (e.g. `--print-logs`) | YES | Regex `/^\s*--standalone\b/m` matches only flag definitions at line start | None |
| ANSI color codes in `--help` output | YES | `stripAnsiCodes` called before regex matching | None |
| Concurrent `runSdk()` calls before probe settles | YES | Promise stored in `standaloneSupport` map before resolution | Concurrency safe, but rejection not caught (Finding 2) |
| Probe times out (> 8000 ms) | PARTIAL | Cache entry deleted, returns false | Silently degrades MCP (Finding 3), child kill leak (Finding 4) |
| Probe process exits with code 1 | NO | Evaluates to false and is kept in cache | Permanently disables standalone mode (Finding 1) |
| Windows `.cmd` shim vs native `.exe` | YES | `resolveDirectSpawn` applied before SDK run; probe runs through `spawnCli` | Verified both binaries work |

---

## Checks run

1. `git show b33535508`
   - Verified commit diff across `opencode-cli.adapter.ts` and `opencode-cli.adapter.spec.ts`.
2. `opencode run --help`
   - Exit code: 0. Verified `--standalone` listed under `FLAGS` and description reference under `--print-logs`.
3. `C:\Users\abdal\AppData\Roaming\npm\opencode.cmd run --help`
   - Exit code: 0. Verified probe output identical when executed through Windows `.cmd` shim.
4. `C:\Users\abdal\AppData\Roaming\npm\node_modules\@opencode\cli\bin\opencode.exe run --help`
   - Exit code: 0. Verified probe output identical when executed through native `.exe`.
5. `npx nx test @ptah-extension/cli-agent-runtime --testPathPatterns=opencode-cli.adapter --skip-nx-cache`
   - Test Suites: 1 passed, 1 total. Tests: 43 passed, 43 total. Time: 3.713 s.

---

## Lane-introduced constraints

None.

---

## Verdict Summary

- **Recommendation**: REVISE
- **Confidence**: HIGH
- **Top risk**: An abnormal exit or signal termination during the initial `opencode run --help` probe permanently locks `standaloneSupport` to `false`, causing all subsequent OpenCode 2.x lanes in that session to silently run without MCP tools.
- **What a robust implementation would add**:
  1. Invalidate probe cache when `outcome.exitCode !== 0` or `outcome.exitCode === null`.
  2. Add `.catch()` to the probe promise to handle unexpected spawner exceptions.
  3. Emit diagnostic logging when `--standalone` fallback triggers on an installed CLI.
