# Adversarial Behavioural Review — TASK_2026_484

**Verdict: FAIL**

Scope reviewed in full: `skills-sh-cli.ts`, `cli-user-interaction.ts`,
`browser-launching-oauth-url-opener.ts`, `cli-adapter.utils.ts` (original
reaper), `toolchain-probe.ts`, `claude-cli-detector.ts`,
`claude-cli-path-resolver.ts`, `process-start-time.probe.ts`, plus the four
associated spec files named in the brief. `agent-events.ts` and
`platform-electron` were not opened, per instruction.

---

## Defects

### 1. Every one of the six new local `killProcessTree` mirrors drops the POSIX SIGKILL escalation the canonical implementation exists for, and resolves as "done" regardless

- Files/lines:
  - `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts:48-71`
  - `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:29-52`
  - `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts:32-55`
  - `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts:38-61`
  - `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts:17-40`
  - `libs/backend/agent-sdk/src/lib/peer-sessions/process-start-time.probe.ts:44-67`
- Compare against the canonical original, `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:44-104`: POSIX branch sends SIGTERM to the group, then polls liveness every 100 ms via `process.kill(pid, 0)`, and escalates to `killGroup('SIGKILL')` if the group is still alive after `KILL_GRACE_PERIOD` (5000 ms, `agent-process-manager-helpers.ts:54`).
- All six mirrors instead do this and nothing more:
  ```ts
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Best effort
    }
  }
  ```
  No liveness check, no SIGKILL fallback, no wait — the async function returns immediately after the single signal is sent.
- Scenario: on Linux/macOS, spawn `npx skills add anthropics/skills` (the file's own header explains the tree is `cmd.exe`-equivalent → `node(npx)` → `node(skills)` → fetcher; on POSIX there is no cmd.exe hop but the descendant chain is the same). If the `skills` CLI or its fetcher installs a SIGTERM handler for graceful shutdown (common for anything doing a multi-file/atomic write, which an installer plausibly does), the process group survives SIGTERM. `killProcessTree` still resolves normally — no exception, no reported failure — and the orphan this task exists to remove is left running, indistinguishable in logs or test output from a clean kill. The same applies to `toolchain-probe.ts` against a wedged `dotnet`/`python` wrapper, and to `claude-cli-detector.ts`/`claude-cli-path-resolver.ts`/`process-start-time.probe.ts` against a wedged `where`/`which`/`ps`/`powershell.exe` that ignores or delays on SIGTERM.
- `context.md:12-20` (the task's own root-cause document) names this exact pattern as "the fix pattern — it already exists here, do not invent one" and points at `killProcessTree` in `cli-adapter.utils.ts`. The implementation report claims each of these six sites now "matches" that pattern, but none of them actually reuse or replicate its escalation behaviour — they replicate only the single-attempt Windows `taskkill` branch and a weakened POSIX branch. This is the exact "divergence between copies" the review brief calls out as the defect, and it defeats the stated purpose of the task under a real (not rare) trigger, silently.
- Fix: mirror the full original, including the liveness poll and SIGKILL escalation — or better, since six divergent boundary-local copies now exist, at minimum keep them behaviourally identical to the one they were copied from.

### 2. The divergence is untested — every new spec drives only the Windows `taskkill` branch

- Files: `skills-sh-cli.spawn.spec.ts:111-145`, `cli-user-interaction.spec.ts:286-362`, `toolchain-probe.spawn.spec.ts:37-68`. `claude-cli-detector.spec.ts`, `claude-cli-path-resolver.spec.ts`, and `process-start-time.probe.spawn.spec.ts` follow the same shape (each forces `process.platform = 'win32'` before asserting `taskkill /T /F`).
- None of the six new specs exercises the POSIX branch at all, let alone asserts a SIGKILL escalation exists. A spec asserting `taskkill` was invoked against a mocked spawner, with the platform hard-pinned to `win32`, proves only that the Windows path calls `execFile('taskkill', …)` — it says nothing about whether a stuck process is actually reaped on Linux/macOS, which is the platform where the escalation gap in Defect 1 is exploitable. This is exactly the "tests that cannot fail" pattern the review brief asks to hunt: the implementation report's "regression evidence" table (`implementation-report.md:44-49`) reports these suites green, which is true and irrelevant to the actual regression.

### 3. `process-start-time.probe.ts` and `claude-cli-path-resolver.ts` cap a Windows-native-tool probe at 5 s with no measurement behind the number, on paths where the report itself concedes the risk

- `libs/backend/agent-sdk/src/lib/peer-sessions/process-start-time.probe.ts:41` (`PROCESS_START_PROBE_TIMEOUT_MS = 5_000`) bounds a `powershell.exe -NoProfile -NonInteractive -Command …` spawn. PowerShell host startup — module autoloading, AV/AppLocker scanning, a domain-joined profile — is a documented source of multi-second cold starts independent of `-NoProfile`. `implementation-report.md:65-66` itself states "PowerShell policy/startup can wedge even though the ordinary command is short-lived" as the justification for adding a timeout, but supplies no measurement that 5 s clears a cold Windows machine; it only asserts the fallback is safe.
- `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts:14` (`COMMAND_PATH_TIMEOUT_MS = 5_000`) bounds `where`/`which`, which the same report calls out as capable of blocking on "a network-backed PATH entry."
- Effect if the cap fires early: not a crash, but a functional regression from "always eventually correct" to "sometimes wrong on a slow machine" — `ProcessStartTimeProbe.probe` returns an empty map, which the caller (by the module's own contract, `process-start-time.probe.ts:245-249`) reports as `liveness-unverified` for every pid in the batch, and `ClaudeCliPathResolver.resolve` silently falls back to the slower/legacy wrapper-spawn path or fails to resolve `cli.js` at all, losing the direct-execution optimisation `ClaudeCliDetector.runDetection` depends on (`claude-cli-detector.ts:383-393`). Neither path existed before this change — previously these probes waited unboundedly and always got a real answer.
- This is not proven to fire in practice (no evidence either way was available in this worktree), so it is reported as Moderate rather than Blocking: the failure mode degrades gracefully (an "unverified" or "unresolved" answer, not a thrown error or a wrong-answer-as-success), but the 5 s figure is asserted, not measured, on exactly the machines (`context.md`'s own "cold Windows machine" framing) where it is most likely to be wrong.

### 4. Requirement/scope note — `openExternal` on Windows is untouched by `detached`, which is correct, but the 5 s cap still covers the `cmd /c start` launch itself

- `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:79-82`: `spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore' })`, no `detached`. This is fine — `taskkill /T /F` already walks real Win32 PID ancestry regardless of `detached`, and the browser process ShellExecute'd by `start` is not a child of `cmd.exe` in the first place, so tree-killing the `cmd.exe` shim after a timeout cannot kill a browser that already launched. No regression found here; noted only because the review brief specifically asked about this path and it checks out.

---

## Five logic questions

### 1. How does this fail silently?

`killProcessTree` in all six new mirrors (Defect 1) resolves normally whether or not the target process actually died — a caller awaiting it (or firing it `void`-style, as every call site does) has no way to distinguish "reaped" from "signal sent, process still running." Combined with the missing escalation, the single largest orphan (`npx skills add`'s node/fetcher descendants — the "highest-value suspect" `context.md:32-39` names first) can survive the fix entirely while every code path reports success.

### 2. What user action produces unexpected behaviour?

A user on Linux/macOS running a skill install (`skillsSh:install`) against a slow/misbehaving source that trips the 15-30 s timeout: the RPC call still returns a clean timeout-exit-124 result, but on a machine where the fetcher process traps SIGTERM, the orphaned fetcher keeps running and (per the task's own audit) keeps accumulating exactly like before TASK_2026_484.

### 3. What input data produces a wrong answer rather than an error?

None of the changed files show a data-shape bug that produces a *wrong* answer (all timeout/error branches report a well-typed failure or `null`/`undefined`, never a fabricated success). The defect here is behavioural (a kill that doesn't kill), not a data-correctness one.

### 4. What happens when a dependency fails?

Covered by Defects 1 and 3: a dependency (spawned process) that ignores SIGTERM is treated as reaped; a dependency (PowerShell/`where`) that is merely slow is treated as failed/unverified after 5 s with no adaptive backoff or retry.

### 5. What is missing that the requirements never mentioned?

`context.md` never states an acceptance bar for "the reaper must actually kill a signal-ignoring process," but it explicitly hands the implementer a working reference (`cli-adapter.utils.ts`) that does handle it, and says not to invent a new pattern. The six mirrors invent a strictly weaker one. Nothing in the brief asked for parity to be verified by a POSIX-path test, and none of the four new spec files provide it — that gap is itself worth naming as a residual requirement.

---

## Failure modes

### Orphan survives SIGTERM on POSIX, task goal not met, no error surfaced

- Trigger: any spawned process (of the six mirrored call sites) that traps, delays on, or is unresponsive to SIGTERM, on Linux/macOS.
- Symptom: the calling RPC/probe returns its normal timeout result; the process tree is not actually terminated; nothing in logs, telemetry, or test output indicates a failed kill.
- Evidence: `skills-sh-cli.ts:62-70`, `cli-user-interaction.ts:43-51`, `toolchain-probe.ts:46-54`, `claude-cli-detector.ts:52-60`, `claude-cli-path-resolver.ts:31-39`, `process-start-time.probe.ts:58-66`, contrasted with `cli-adapter.utils.ts:58-103`.
- Current handling: single `process.kill(-pid, 'SIGTERM')` (or single-pid fallback), no verification, no escalation.
- Recommendation: replicate the full grace-period + SIGKILL escalation from `cli-adapter.utils.ts`, or factor it into a shared, imported helper if the boundary-import concern raised in the implementation report can be resolved (e.g. re-export from a lower, shared-safe location) rather than re-deriving a weaker copy six times.

### Cold-machine PowerShell/`where` probe timeout degrades a feature with no measured safety margin

- Trigger: a Windows host where `powershell.exe` startup or PATH resolution exceeds 5 s (AV scanning, domain profile, network PATH entry — scenarios the implementation report itself names as motivating the timeout).
- Symptom: peer-session liveness reports `liveness-unverified` for otherwise-live sessions; `ClaudeCliPathResolver` silently falls back to a slower resolution path.
- Evidence: `process-start-time.probe.ts:41,325-333`; `claude-cli-path-resolver.ts:14,282-290`.
- Current handling: fixed 5000 ms cap, asserted safe in prose, not measured against a cold-boot machine.
- Recommendation: either measure a real cold-start figure before committing to 5 s, or make the cap configurable/backed off so a legitimately slow (not hung) host doesn't lose functionality it had unconditionally before this change.

---

## Blocking issues

None found that meet the bar of a definite crash, data loss, or corruption in the reviewed diff. Defect 1 is reported as the primary Serious finding below rather than Blocking because the six affected code paths are all best-effort cleanup utilities whose failure degrades to "the orphan the task was trying to remove is still there" rather than corrupting state or crashing the host — but it is a direct, repo-wide failure of the task's own stated purpose and is flagged accordingly.

## Serious issues

### Escalation regression across all six new process-tree reaper mirrors (Defect 1)

- File: see the six locations listed in Defect 1.
- Scenario: any POSIX target process that ignores or delays SIGTERM.
- Impact: the process-tree leaks this task exists to fix continue to leak, with the code now reporting (via passing tests and clean timeout results) that cleanup happened.
- Fix: match the canonical escalation logic in `cli-adapter.utils.ts:44-104`.

### POSIX-path escalation is untested across all four affected spec files (Defect 2)

- File: `skills-sh-cli.spawn.spec.ts`, `cli-user-interaction.spec.ts`, `toolchain-probe.spawn.spec.ts`, plus the two agent-sdk specs (not independently reproduced above, same shape).
- Scenario: a reviewer or CI relying on these suites as evidence the reaping fix works on Linux/macOS gets no such evidence — every timeout test is Windows-pinned.
- Fix: add a POSIX-platform case per file that fakes a SIGTERM-surviving group and asserts an eventual SIGKILL (or an equivalent explicit assertion that no such escalation exists, if that is accepted as intentional scope-narrowing — which `context.md` does not indicate).

## Moderate and minor issues

- `process-start-time.probe.ts:41` and `claude-cli-path-resolver.ts:14` — unmeasured 5 s timeout on Windows-native probes; see Defect 3.
- No issue found with `detached`'s effect on stdio inheritance or signal delivery for the fast/successful path in any of the eight reviewed files — pipes remain default, `close`/`data` events fire identically to before, and Windows spawns (which never set `detached`) are unaffected. This was checked specifically per the review brief's item 1 and found clean.
- No issue found with the `Promise.resolve(child.pid ?? null).then(...)` pattern (review brief item 4): `child.pid` is already synchronously populated by the time any of these timeouts can fire (all timeouts are ≥15 ms after spawn in practice, and production timeouts are 5-30 s), and Node's `close`/`exit` events are delivered as libuv I/O callbacks, which cannot run ahead of an already-scheduled microtask — so the wrapped `.then()` callback observing the pid runs before any exit/PID-reuse event could occur. No reachable PID-reuse kill was found.
- No unhandled-rejection risk found (review brief item 6): every `killProcessTree` implementation wraps its synchronous and asynchronous operations in try/catch, and no `.then()` chain built on it can reject.

## Data flow

1. Caller spawns a process via `cross-spawn`/`spawn`, optionally `detached: true` on POSIX — OK, no behavioural change to the happy path.
2. Process completes normally within the (new, in several files) timeout window — resolves via `close`/`error` exactly as before this task — OK.
3. Process exceeds the timeout — the timer fires, `whenSpawned` (already-settled) resolves the pid, `killProcessTree(pid)` is fired `void` (fire-and-forget) while the outer promise settles immediately with a timeout/failure result — OK as a pattern, matches the pre-approved shape in `context.md`.
4. `killProcessTree` sends one SIGTERM (POSIX) or one `taskkill /T /F` (Windows) — Windows path is forceful and adequate; POSIX path is a single non-forceful signal with no verification — **gap**, see Defect 1.
5. Caller-visible result (timeout error, `null`, empty map, `liveness-unverified`) is returned regardless of whether step 4 actually terminated the process — this is consistent with the fire-and-forget design already accepted for this codebase, but it means step 4's weakness is invisible to every consumer.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Fix `skills-sh-cli.ts`'s tree-orphaning timeout kill | PARTIAL | Kills only the `cmd.exe`/direct-child layer reliably on Windows; POSIX kill can be defeated by a SIGTERM-trapping descendant, silently |
| Add timeout + kill path to `cli-user-interaction.ts` browser/clipboard helpers | PARTIAL | Same POSIX escalation gap |
| Retain handles for `browser-launching-oauth-url-opener.ts` detached launches | COMPLETE | `browserProcesses` Set correctly tracks and releases on `close`/`error`; no leak found |
| Fix `probeCliVersion`/`cli-adapter.utils.ts` timeout kill (already had it) | N/A | Original file untouched by this task and confirmed correct; used as this review's baseline |
| Fix relocated suspects (`toolchain-probe.ts`, `claude-cli-detector.ts`, `claude-cli-path-resolver.ts`, `process-start-time.probe.ts`) | PARTIAL | Same POSIX escalation gap in all four; two of four add an unmeasured 5 s cap on a previously-unbounded Windows-native probe |

Implicit requirements not addressed: parity of the "boundary-local mirror" with the behaviour of the original it mirrors (stated explicitly in `context.md` as "do not invent one" but not enforced by any test); evidence that the new 5 s timeouts are safe on a cold Windows machine (the scenario the report itself raises as the reason for adding them).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Fast successful spawn (all 8 files) | YES | Unchanged resolve path via `close` | None found |
| Windows timeout, `.cmd`-wrapped process | YES | `taskkill /T /F` reaches the real tree | None |
| POSIX timeout, cooperative process (dies on SIGTERM) | YES | Single SIGTERM sufficient | None |
| POSIX timeout, SIGTERM-trapping/ignoring process | NO | Single SIGTERM sent, no escalation, no verification | Orphan persists; see Defect 1 |
| Spawn failure (`error` event) | YES | Rejects/resolves false consistently across files | None |
| Cold-machine slow-but-not-hung Windows probe (`where`, PowerShell) | PARTIAL | Times out and degrades gracefully (no crash) | Feature works worse than before this task on a slow machine, unmeasured risk; see Defect 3 |
| PID reuse between timeout-fire and reap | YES (no bug found) | Microtask-vs-macrotask ordering makes the window unreachable in practice | None found, but noted as checked |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: all six new local process-tree reapers are missing the SIGKILL escalation the codebase's own canonical implementation uses, so the task can pass every new test and still leave orphaned process trees on POSIX whenever the target process does not die cleanly from SIGTERM alone — the exact failure class TASK_2026_484 was opened to close.
- What a robust implementation would add: reuse (or exactly replicate, including the grace-period poll and SIGKILL fallback) `cli-agent-runtime`'s `killProcessTree`; add at least one POSIX-path spec per new file that proves escalation happens against a signal-ignoring fake child; either measure or make configurable the new 5 s caps on `where`/PowerShell before relying on them as a safety net on slow Windows hosts.
