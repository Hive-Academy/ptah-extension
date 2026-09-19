# Child process spawn audit

Scope: every production (non-spec, non-test, non-`node_modules`, non-`dist`,
non-`.nx`) call site in the worktree that creates an OS child process.
`libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.ts`,
`libs/backend/agent-sdk/src/lib/di/`, `libs/backend/agent-sdk/src/index.ts` and
`libs/backend/agent-sdk/src/lib/helpers/index.ts` were NOT opened — another agent
owns them — so the already-confirmed stdio MCP leak is not re-derived here.

Every path below is a file I opened.

## Summary

| Class | Count |
| --- | --- |
| SAFE | 12 |
| SUSPECT | 6 |
| LEAK | 3 |

A note on the key signal. **No production call site in this repository uses
`shell: true` except one** (`cli-user-interaction.ts:79`). The repo standard is
`cross-spawn`, which is not a shell on POSIX but IS one on Windows: for a
`.cmd` / `.bat` target it executes `cmd.exe /d /s /c "<wrapper>"`, so the direct
child is `cmd.exe` and the real CLI is a grandchild. A plain `child.kill()` on a
cross-spawn handle therefore has exactly the Windows failure mode described in
the brief. That is what separates SAFE from SUSPECT below: the SAFE sites either
tree-kill (`taskkill /T /F`, `process.kill(-pid)`) or never need a kill at all
because the child is a short, self-exiting, non-shell binary.

## LEAK

### `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:43-48`

Spawns `cmd /c start "" <url>` (win32), `open <url>` (darwin), `xdg-open <url>`
(linux) for `openExternal`. Literal commands.

No kill, terminate or dispose path exists anywhere in the class — the only
listeners are `close` and `error`, both of which merely resolve the promise.
There is no timeout, so a browser launcher that never exits (a `start` that
blocks on a misconfigured file association, an `xdg-open` waiting on a desktop
portal) holds the promise and the process forever. On win32 the direct child is
`cmd.exe` and the browser is its grandchild, so even a hypothetical
`child.kill()` added here would not reach it. `openExternal` is user-driven and
retryable, so repeated failures accumulate.

### `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:79-82`

    const child = require('child_process').spawn(command, {
      shell: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    });

Spawns `clip` (win32) / `pbcopy` (darwin) / `xclip -selection clipboard` (linux)
for `writeToClipboard`. **The one `shell: true` in production code**, and the
command string for linux carries arguments only a shell can split — so the shell
is load-bearing and cannot simply be removed.

No kill path, no timeout. `xclip` is well known to stay resident owning the X
selection; with stdout and stderr set to `ignore` and only `close`/`error`
handlers, nothing here ever ends it. A `shell: true` spawn with no termination
path at all is the worst combination in this audit.

### `apps/ptah-cli/src/cli/oauth/browser-launching-oauth-url-opener.ts:49-53`

    const child = this.spawner(command, args, { detached: true, stdio: 'ignore' });
    child.unref();

Spawns `cmd /c start "" <url>` / `open <url>` / `xdg-open <url>`.

`detached: true` + `unref()` is a deliberate fire-and-forget, and for a browser
launch that is defensible — the intent is that the browser outlives the CLI. I
still classify it LEAK rather than SAFE because the class holds no handle after
`unref()` and has no dispose path: if the `start` builtin fails to hand off (the
failure mode the file's own comment at lines 60-66 documents for a quoted URL),
the detached `cmd.exe` is unreachable by anything in this process. It sits on the
OAuth retry path — each re-attempt at authorization spawns another one. Lower
severity than the two above because the process is normally short-lived; the
defect is the absence of any handle, not the `detached` flag.

## SUSPECT

### `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts:115-131`

`crossSpawn(binary, args, …)` where `binary` comes from `STACK_PROFILES` — `node`,
`dotnet`, `python` and friends, exactly the class of command that is a `.cmd`
shim on Windows. Termination exists and is on a timeout:

    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);

`child.kill()` is a single-process kill. Under cross-spawn on Windows the handle
is `cmd.exe`; the probed toolchain is the grandchild and survives. This is a
timeout path by construction, so every wedged probe leaves an orphan, and the
probe re-runs per stack profile. What I could not determine: whether any shipped
`STACK_PROFILES` entry actually resolves to a `.cmd` on a real machine — if every
probe binary is a true `.exe`, cross-spawn passes it through unwrapped and this
is SAFE.

### `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts:98-105, 136-143`

    const child = crossSpawn('npx', ['skills', ...args], { … });
    …
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle({ stdout, stderr: `CLI timed out after ${timeout}ms`, exitCode: 124 });
    }, timeout);

**`npx` — the exact shell-wrapper signal named in the brief.** On Windows `npx`
is `npx.cmd`, so cross-spawn runs `cmd.exe /d /s /c npx.cmd skills …`; the tree
is cmd.exe -> node (npx) -> node (skills) -> whatever `skills add` fetches with.
`child.kill('SIGTERM')` reaches only `cmd.exe`. The default timeout is 15 s and
the install path stages a network fetch, so the timeout fires in normal use on a
slow connection. This is a three-deep tree killed at the root — the same
arithmetic as the confirmed MCP leak (roughly three orphans per failed attempt).
The file header at lines 80-82 explicitly documents that cross-spawn routes
through `cmd.exe /d /s /c`, so the shell wrapper is known and the kill was simply
not adjusted for it.

### `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:438-467` (`probeCliVersion`)

    const child = spawnCli(binary, args, { spawner });
    const timer = setTimeout(() => { child.kill(); resolve(undefined); }, timeoutMs);

`spawnCli` deliberately omits `detached` for probes — "short-lived probes omit it
to avoid gaining orphan risk for no tree-kill benefit" (lines 385-389) — but the
consequence is that the probe has no tree-kill available either. `binary` is a
rival CLI name (`codex`, `copilot`, `agy`, `opencode`, `pi`), all npm `.cmd`
shims on Windows. Timeout path, 5 s default, run on every detection sweep. The
reasoning in that comment is sound for POSIX and does not hold on Windows, where
the wrapper exists regardless of `detached`.

### `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts:707-727`

    const child = crossSpawn(command, args, { stdio: 'pipe', windowsHide: true });
    …
    const timeoutId = setTimeout(() => { … child.kill(); … }, timeout);

Probes `claude --version` (and `wsl`). 30 s timeout, `child.kill()` only. The
file header at line 6 records that the previous version used `shell: true` and
that cross-spawn replaced it — so the Windows wrapper is understood here too, but
the kill is still single-process. Mitigated by the coalescing this lib's
CLAUDE.md documents (single-flight detection plus a 30 s version-probe TTL),
which bounds how many can be in flight; that bounds the leak rate, it does not
remove it.

### `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts:222-245`

    const child = spawn(command, [commandName], { stdio: 'pipe', shell: false });

Spawns `where` (win32) / `which` (posix). `shell: false` is explicit and both are
real executables, so there is no wrapper. But there is **no timeout and no kill
path at all** — only `close` and `error` resolve the promise. SUSPECT rather than
LEAK because `where`/`which` are trivially short-lived OS binaries that
essentially cannot hang; the missing termination path is a latent gap, not an
observed one. What I could not determine: whether a network-mounted PATH entry
can make `where` block indefinitely on Windows.

### `libs/backend/agent-sdk/src/lib/peer-sessions/process-start-time.probe.ts:269-281`

    const child = crossSpawn(command, [...args], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    …
    child.on('error', reject);
    child.on('close', () => resolve(stdout));

Spawns `wmic`/`powershell` (win32) or `ps -o pid=,lstart= -p …` (posix). No
timeout, no kill. Same reasoning as above — real OS binaries, not wrappers, and
they exit promptly — but a `powershell.exe` probe that hangs on a
constrained-language-mode policy has nothing that will ever end it. The caller at
lines 250-255 swallows the failure, so a hang is invisible.

## SAFE

- `libs/backend/persistence-sqlite/src/lib/integrity/db-worker-runner.ts:144`
- `libs/backend/memory-curator/src/lib/embedder/embedder-worker-client.ts:208`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:44` (`killProcessTree`, the shared helper)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1639, 1658`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:480-484`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:521-525`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts:342-344`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts:299-303`
- `libs/backend/vscode-core/src/utils/exec-git.ts:518-556, 657-667`
- `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.ts:91`
- `libs/backend/voice-providers/src/lib/local/voice-worker-client.ts:373-389`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/fix-path.ts:68`

Why these earn it, briefly:

- The five `cli-agent-runtime` sites all await `child.whenSpawned` and then call
  `killProcessTree(pid)`, which is `taskkill /pid <pid> /T /F` on Windows — `/T`
  walks real Win32 PID ancestry, so it reaches the CLI behind the cross-spawn
  `cmd.exe` shim. On POSIX it is `process.kill(-pid)` with `detached: true`
  requested at spawn (`spawnCli`, line 390), escalating to `SIGKILL` after the
  grace period, with a liveness poll so it resolves as soon as the process is
  actually gone. This is the correct shape; the rest of the repo should look like
  it.
- `exec-git.ts` does the same inline: `terminate()` calls `child.kill('SIGTERM')`,
  then awaits `child.whenSpawned` before `killProcessTree(pid)`, whose Windows
  branch at line 545 is `taskkill /F /T /PID`, then arms a grace timer that
  escalates to `SIGKILL`. It also holds its concurrency-gate slot until the child
  is genuinely gone rather than until the promise settles.
- `cli-workspace-watcher.ts` forks a bundled Node host (not a wrapper), unrefs
  the child, the IPC channel and stderr, and guards `kill()` on
  `exitCode !== null || signalCode !== null`; the `error` handler calls `kill()`
  and synthesises an exit when the spawn never produced a pid. A `fork` child is
  a direct Node process, so there is no grandchild to miss.
- `voice-worker-client.ts` mirrors the embedder: idle timer, `dispose` message
  then `worker.kill()`, failure logged rather than swallowed.
- `fix-path.ts` is `spawnSync` with `timeout: 5000`. A synchronous spawn cannot
  leak a handle — the call does not return until the child is reaped. Worth
  noting that it spawns the user's login shell with `-ilc`, so it would be a leak
  candidate if it were async. It is not, and it is POSIX-only.
- `chrome-launcher-browser-capabilities.ts` (`libs/backend/vscode-lm-tools/src/lib/code-execution/services/`)
  is a boundary case: it does not spawn directly, it delegates to the
  `chrome-launcher` package, and it calls `await this.chrome.kill()` on both the
  CDP-connect failure path (line 432) and in `dispose()` (line 537). It is
  excluded from the count above because the spawn itself is in a dependency, not
  at a call site in this repository.

## Reference implementations

### `libs/backend/persistence-sqlite/src/lib/integrity/db-worker-runner.ts` — earns SAFE

It earns it, and for a reason worth copying: the kill is in the **settle**
function, not on each individual exit path.

    const settle = (response: TResponse | null, aborted = false): void => {
      if (isSettled) return;
      isSettled = true;
      signal?.removeEventListener('abort', onAbort);
      if (budgetTimer) { clearTimeout(budgetTimer); budgetTimer = null; }
      try { worker?.kill(); } catch (error: unknown) { /* debug log */ }
      resolve({ aborted, response });
    };

Four things enter `settle` — a reply (`message`), an `exit`, the budget timer and
the caller's `AbortSignal` — and there is exactly one `worker?.kill()` for all
four. That is the property the leaky sites lack: they kill on the timeout path
and forget the abort path, or the reverse. Three further details are right: the
abort listener is a **named** function so `removeEventListener` can name the same
reference (an anonymous listener would outlive every settled run — the comment at
lines 134-135 says so); `budgetTimer.unref()` so a pending run cannot hold the
host open at quit; and the `worker?.kill()` is wrapped and degraded to a debug
log, because a failing kill is not a reason to fail the run.

One honest caveat: the safety is partly structural rather than earned. The child
is an Electron `utilityProcess` forked from a bundled `.mjs` — a direct process
with no shell wrapper and no grandchild — so `kill()` is sufficient by
construction. The discipline is still the right model; the Windows grandchild
problem simply does not arise on this path.

### `libs/backend/memory-curator/src/lib/embedder/` — earns SAFE

`embedder-worker-client.ts` has all four properties the brief names, and they are
genuinely independent of each other:

- **Lazy spawn** — `ensureWorker()` (line 194) spawns only on the first request;
  a host with no `IEmbedderWorkerProcessFactory` registered throws a clear error
  instead of half-starting something.
- **Idle teardown** — `armIdleTimer()` (line 274) is re-armed by `settle()` on
  every completed request and fires `teardownWorker()` after `idleMs` if
  `inFlight === 0`. The timer is unrefd, with the comment "Do not keep the event
  loop alive purely for the idle timer" — the mirror-image defect (a cleanup
  mechanism that itself prevents shutdown), and it is handled.
- **Respawn on exit** — `handleExit()` (line 228) nulls `this.worker`, rejects
  every pending request with a retryable message, and explicitly declines to set
  a permanent failure flag (lines 250-251), so the next request respawns.
- **Crash-loop guard** — `recentExits` is filtered to `CRASH_LOOP_WINDOW_MS` and,
  at `CRASH_LOOP_MAX_EXITS`, sets `refuseSpawnUntil` to now plus
  `CRASH_LOOP_BACKOFF_MS`; `ensureWorker` refuses during that window.

`teardownWorker()` posts a `dispose` message first and then `worker.kill()`, so a
clean shutdown is attempted before the hard one. Same caveat as above: this is a
`utilityProcess` with no shell wrapper, so `kill()` reaches everything there is
to reach. What makes it the better reference of the two is the **lifecycle**
rather than the kill — it is the only client here that bounds how many times it
will re-create a failing child.

Neither reference is a template for the Windows grandchild problem. For that, the
model in this repository is
`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:44`
(`killProcessTree`) together with the `await child.whenSpawned` rule the four
rival-CLI adapters follow — off-thread, the pid does not exist when the handle is
returned, and `killProcessTree(undefined)` silently orphans the whole subtree.

## Method

Run from the worktree root
`D:\projects\ptah-extension\.claude-worktrees\perf-task-478-process-and-retention-fleet-5891e3e00c97`.

Pass 1 — every spawn-family call and every `child_process` import, repo-wide.
Patterns searched: `\bspawn\s*\(`, `\bspawnSync\s*\(`, `\bexecSync\s*\(`,
`\bexecFileSync\s*\(`, `\bexecFile\s*\(`, `\bfork\s*\(`, `utilityProcess`,
`node-pty`, `from 'child_process'` / `from 'node:child_process'`. Globs excluded:
`**/node_modules/**`, `**/dist/**`, `**/.nx/**`, `**/*.spec.ts`, `**/*.test.ts`;
globs included: `*.ts`, `*.js`, `*.mjs`, `*.cjs`. Results piped through an
inverse filter for `RegExp`, `.exec(`, `linkRegex` and `pattern.exec`, which
otherwise dominate a bare `exec(` search in this repo.

Pass 2 — the same call patterns narrowed to shipping source only:
`libs/backend`, `apps/ptah-cli/src`, `apps/ptah-electron/src`, still excluding
`**/node_modules/**` and `**/*.spec.ts`.

Pass 3 — the termination surface, to pair each spawn with its kill. Patterns:
`\.kill\(`, `taskkill`, `killProcessTree`, `whenSpawned`, over `libs` and `apps`.

Pass 4 — the shell-wrapper signal specifically, over
`libs/backend/cli-agent-runtime/src` and `libs/backend/agent-sdk/src`. Patterns:
`spawnCli`, `crossSpawn\(`, `spawnProcess\(`, `shell: true`, `windowsHide`,
`detached`.

Pass 5 — MCP stdio transports, to confirm the known leak's neighbourhood was not
duplicated elsewhere. Patterns: `StdioClientTransport`, `execFileAsync`,
`promisify\(exec`, over `libs` and `apps`. No `StdioClientTransport` exists
outside the excluded files; the only `execFileAsync` hit is `killProcessTree`'s
own `taskkill` call.

Deliberately excluded from classification, all confirmed non-shipping: `tools/`
(`extract-domain.ts`, `di-lint`, `degradation-audit`), repo-root `scripts/`,
`apps/ptah-video-studio/scripts/` (the only `node-pty` / `pty.spawn` sites in the
repo live here, at `record-tui.mjs:284` and `probe-tui.mjs:63`; both do call
`child.kill()`, and neither ships), `*.stress.harness.ts`, the `*-e2e` apps and
`tests/e2e/**`.
