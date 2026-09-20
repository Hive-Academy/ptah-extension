# TASK_2026_484 — process-tree reaping implementation report

| file:line | defect | change | spec that pins it |
| --- | --- | --- | --- |
| `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts:48,132,170` | The `npx skills` timeout killed only cross-spawn's direct `cmd.exe`, orphaning the npm/skills/fetcher descendants on Windows. | Added a boundary-local mirror of the repository tree reaper, made POSIX children process-group leaders, and changed timeout cleanup to wait for the PID before reaping the tree. A local mirror avoids an internal cross-library import from `rpc-handlers` into a non-public CLI adapter module. | `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.spawn.spec.ts:111` asserts timeout invokes `taskkill /pid 2468 /T /F` and does not use single-process `child.kill()`. |
| `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:26-60,74-108,121-156` | Browser launchers and shell-backed clipboard helpers had no timeout or termination path; a stuck `cmd`, `xdg-open`, or resident `xclip` could live indefinitely. | Added a 5-second operation cap, a platform-local tree reaper (required because `scope:cli` must not import the concrete `cli-agent-runtime` adapter library), and POSIX process-group spawning. Both promises retain existing success/error behavior and now settle after bounded cleanup. | `libs/backend/platform-cli/src/implementations/cli-user-interaction.spec.ts:286` and `:323` assert the browser and clipboard timeout paths invoke `taskkill /T /F` for the spawned PID. |
| `apps/ptah-cli/src/cli/oauth/browser-launching-oauth-url-opener.ts:32,59-66` | Detached browser launch handles were immediately discarded after `unref()`, making retry-path launcher processes unreachable while still running. | Retained every detached launcher in a set and released each handle on `close` or `error`; `detached: true` and `unref()` remain unchanged. | `apps/ptah-cli/src/cli/oauth/browser-launching-oauth-url-opener.spec.ts:139` asserts the handle remains retained until `close`. |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:446-454` | `probeCliVersion` timed out with a single-process `child.kill()`, which misses a CLI behind a Windows `.cmd` wrapper. | Requested detached process-group spawning on POSIX and replaced the timeout kill with the repository's `whenSpawned` + `killProcessTree` pattern. | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.spec.ts:546` and `:639` pin both injected-spawner and inline cross-spawn timeout paths to `taskkill /T /F`. |

## Verification

Exact required typecheck command:

```text
NX   Running target typecheck for 4 projects:

- @ptah-extension/rpc-handlers
- @ptah-extension/platform-cli
- @ptah-extension/cli-agent-runtime
- ptah-cli

NX   Successfully ran target typecheck for 4 projects
```

Exact required test command (current final run):

```text
NX   Running target test for 4 projects and 32 tasks they depend on:

- @ptah-extension/rpc-handlers
- @ptah-extension/platform-cli
- @ptah-extension/cli-agent-runtime
- ptah-cli
```

Observed totals from that run:

- `@ptah-extension/cli-agent-runtime:test`: 60/60 suites passed; 907 passed, 1 skipped, 908 total.
- `@ptah-extension/rpc-handlers:test`: 103/103 suites passed; 3,128 passed, 4 skipped, 3,132 total.
- `@ptah-extension/platform-cli:test`: 14 passed and 1 failed suites; 218 passed, 1 failed, 3 todo, 222 total. The failure was the unrelated `cli-workspace-watcher.spec.ts` seeded nested-repository event timeout. Immediate standalone rerun: 15/15 suites passed; 219 passed, 3 todo, 222 total.
- `ptah-cli:test`: not run by Nx because its `copy-wasm` dependency failed before the test target: `WASM file not found: ...node_modules\web-tree-sitter\web-tree-sitter.wasm`.
- Overall exact command: failed because of the unrelated watcher timeout and missing dependency asset above.

Focused regression evidence:

- Skills CLI spawn + affected handler specs: 2/2 suites, 35/35 tests passed.
- CLI user interaction spec: 1/1 suite, 26/26 tests passed; complete platform-cli rerun: 15/15 suites, 219 passed, 3 todo.
- Browser-launching OAuth opener spec: 1/1 suite, 6/6 tests passed.
- CLI adapter utilities spec: 1/1 suite, 65/65 tests passed.
- `git diff --check`: passed with no whitespace errors.

## Deviations

- Four requested source locations do not exist under the authorized `libs/backend/cli-agent-runtime/src/lib/...` tree in this worktree. Their actual locations are outside the explicit edit allowlist and outside the four-project verification set: `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts`, `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts`, `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts`, and `libs/backend/agent-sdk/src/lib/peer-sessions/process-start-time.probe.ts`. They were not edited.
- `platform-cli` uses a local reaper mirroring the existing implementation because importing the concrete `cli-agent-runtime` library would violate the repository's platform-adapter dependency boundary.
- The firecrawl MCP orphan case remains untouched as explicitly out of scope. No process sweeper or timer-based system-process enumeration was added.
- The required full test command is not green for the unrelated watcher flake and missing `web-tree-sitter.wasm` asset detailed above; no out-of-scope files were changed to conceal either failure.

## Round 2 — relocated suspects

| file:line | defect | change | spec that pins it |
| --- | --- | --- | --- |
| `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts:32,143,157` | A timed-out cross-spawn toolchain probe called single-process `child.kill()`, orphaning a toolchain behind a Windows `.cmd` wrapper. | Added a boundary-local `killProcessTree` mirror, POSIX process-group spawning, and PID-aware timeout reaping. A direct import is illegal because `workspace-intelligence` is upstream of `cli-agent-runtime`; importing downstream would invert the graph. | `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.spawn.spec.ts:37` asserts a timeout uses `taskkill /T /F` for the spawned PID and never calls `child.kill()`. |
| `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts:38,735,747` | The Claude version probe timed out with `child.kill()`, which reaches only cross-spawn's `cmd.exe` wrapper on Windows. | Added an agent-sdk-local reaper mirror, POSIX process-group spawning, and `whenSpawned`-equivalent PID waiting before tree reaping. Importing `cli-agent-runtime` is illegal because that library already consumes `agent-sdk`. | `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.spec.ts:246` asserts the 10-second timeout invokes `taskkill /T /F` and not the direct child kill. |
| `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts:14,17,251,283` | `where`/`which` lookup had no timeout or termination path. Although normally short-lived, `where` can block on a network-backed PATH entry, so the promise was not safely bounded. | Added a 5-second cap, POSIX process-group spawning, and an agent-sdk-local tree reaper that resolves the optional optimization as `null` after cleanup. The local mirror avoids the `agent-sdk` → `cli-agent-runtime` cycle. | `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.spec.ts:36` drives a wedged `where.exe`, asserts bounded `null`, and pins `taskkill /T /F`. |
| `libs/backend/agent-sdk/src/lib/peer-sessions/process-start-time.probe.ts:41,44,301,326` | PowerShell/`ps` start-time probes had no timeout or termination path. PowerShell policy/startup can wedge even though the ordinary command is short-lived. | Added a 5-second cap, POSIX process-group spawning, and an agent-sdk-local tree reaper; timeout rejects the runner so the existing probe contract returns an empty “liveness unverified” map. The local mirror avoids the same dependency cycle. | `libs/backend/agent-sdk/src/lib/peer-sessions/process-start-time.probe.spawn.spec.ts:33` drives a wedged OS probe, asserts the empty-map contract, and pins `taskkill /T /F`. |

### Verification

Exact required test command:

```text
NX   Running target test for 2 projects:

- @ptah-extension/workspace-intelligence
- @ptah-extension/agent-sdk

NX   Successfully ran target test for 2 projects
```

Observed test totals:

- `@ptah-extension/agent-sdk:test`: 113 passed suites, 2 skipped suites (115 total); 1,986 passed tests, 3 skipped tests (1,989 total); 0 failed.
- `@ptah-extension/workspace-intelligence:test`: 44/44 suites passed; 1,117/1,117 tests passed; 0 failed.
- Focused post-format regression rerun: workspace-intelligence 1/1 test passed; agent-sdk 44/44 tests passed across 4 suites.

Exact required typecheck command:

```text
NX   Running target typecheck for 2 projects:

- @ptah-extension/workspace-intelligence
- @ptah-extension/agent-sdk

NX   Successfully ran target typecheck for 2 projects
```

Formatting/whitespace verification: Prettier check passed for all eight Round 2 source/spec files, and `git diff --check` passed.

### Deviation

- None for Round 2. The earlier relocation deviation is superseded by the extended allowlist: all four relocated suspects are now fixed and regression-tested. No forbidden `agent-events.ts` or `platform-electron` file was touched.

## Round 3 — review defects

### Defect 1 — POSIX mirrors lacked canonical escalation

Changed all boundary-local reapers to match the canonical POSIX lifecycle: signal the detached process group with `SIGTERM`, poll positive-PID liveness every 100 ms, return immediately when liveness reports exit, and send `SIGKILL` after the canonical 5,000 ms grace period if the process is still alive.

- `rpc-handlers`: faithful local implementation in `skills-sh-cli.ts:43-97` because importing a non-public `cli-agent-runtime` adapter helper would bypass the library API.
- `platform-cli`: faithful local implementation in `cli-user-interaction.ts:28-78` because a concrete `cli-agent-runtime` dependency would violate the platform-adapter boundary.
- `workspace-intelligence`: faithful local implementation in `toolchain-probe.ts:31-81` because importing its downstream consumer would invert the dependency graph.
- `agent-sdk`: the three formerly duplicated bodies now share the private `helpers/process-tree-reaper.ts:4-57`; importing `cli-agent-runtime` would create a dependency cycle.

Specs pinning escalation at each independent implementation:

- `skills-sh-cli.spawn.spec.ts:146` — surviving POSIX `npx` group receives `SIGKILL`.
- `cli-user-interaction.spec.ts:366` — surviving POSIX launcher group receives `SIGKILL`.
- `toolchain-probe.spawn.spec.ts:70` — surviving POSIX toolchain group receives `SIGKILL`.
- `process-tree-reaper.spec.ts:26` — surviving agent-sdk process group receives `SIGKILL` after the full grace period.

### Defect 2 — POSIX escalation and fast-exit paths were untested

Added POSIX tests that force the liveness poll down both branches. `process-tree-reaper.spec.ts:26` holds the child alive for all 5,000 ms and proves `SIGTERM → liveness polls → SIGKILL`; `process-tree-reaper.spec.ts:38` makes the first liveness probe throw `ESRCH` and proves neither group nor single-PID `SIGKILL` is sent. The three other independent mirrors each have the escalation tests listed under Defect 1, so a future weakened copy fails in its owning project.

Focused post-change results:

- rpc-handlers spawn spec: 6/6 tests passed.
- platform-cli interaction spec: 27/27 tests passed.
- workspace-intelligence spawn spec: 2/2 tests passed.
- agent-sdk reaper plus affected timeout specs: 22/22 tests passed across 4 suites.

### Defect 3 — unmeasured 5-second OS-probe caps

Did not label a warm local launch measurement as a cold-machine result. Instead, raised both lower-risk native-command caps to 30 seconds: `claude-cli-path-resolver.ts:15` and `process-start-time.probe.ts:41`. Thirty seconds matches the established default command timeout in `ClaudeCliDetector.executeCommand`, leaves substantial room for AV/AppLocker/domain/network-path startup delay, and still converts a true wedge from an unbounded child into bounded cleanup. Their existing timeout specs now advance and pin the 30-second budget.

### Verification

Exact required test command header:

```text
NX   Running target test for 6 projects and 32 tasks they depend on:

- @ptah-extension/rpc-handlers
- @ptah-extension/platform-cli
- @ptah-extension/cli-agent-runtime
- @ptah-extension/agent-sdk
- @ptah-extension/workspace-intelligence
- ptah-cli
```

Observed test totals:

- `@ptah-extension/agent-sdk:test`: 114 passed suites, 2 skipped suites (116 total); 1,988 passed tests, 3 skipped tests (1,991 total); 0 failed.
- `@ptah-extension/cli-agent-runtime:test`: 60/60 suites passed; 909 passed tests, 1 skipped test (910 total); 0 failed.
- `@ptah-extension/rpc-handlers:test`: 103/103 suites passed; 3,129 passed tests, 4 skipped tests (3,133 total); 0 failed.
- `@ptah-extension/workspace-intelligence:test`: 44/44 suites passed; 1,118/1,118 tests passed; 0 failed.
- `@ptah-extension/platform-cli:test`: 15/15 suites passed; 220 passed tests, 3 todo (223 total); 0 failed.
- `ptah-cli:test`: not run because the known `ptah-cli:copy-wasm` dependency failed with `WASM file not found: ...node_modules\web-tree-sitter\web-tree-sitter.wasm`.
- Overall exact test command: failed only at the known `ptah-cli:copy-wasm` dependency; no executed test suite failed.

Exact required typecheck command header:

```text
NX   Running target typecheck for 6 projects:

- @ptah-extension/rpc-handlers
- @ptah-extension/platform-cli
- @ptah-extension/cli-agent-runtime
- @ptah-extension/agent-sdk
- @ptah-extension/workspace-intelligence
- ptah-cli

NX   Successfully ran target typecheck for 6 projects
```

Formatting and whitespace checks also passed: Prettier reported all Round 3 source/spec files formatted, and `git diff --check` produced no errors.

### Deviations

- The exact test command could not become globally green because the acknowledged missing `web-tree-sitter.wasm` dependency prevents `ptah-cli:test` from starting. No unrelated build or dependency file was edited to hide it.
- The forbidden `cli-agent-runtime/src/lib/wiring/agent-events.ts` and `platform-electron/**` changes present in the shared worktree belong to the other active agent and were not touched in this round.
