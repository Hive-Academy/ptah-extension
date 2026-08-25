# Follow-up Research: Cross-Platform Process-Tree Kill for the Pi Adapter

TASK_2026_160 · researched 2026-07-17 · target "current as of ~June 2026"

## Executive verdict

**The Pi adapter's `killChild()` orphan risk is real, and it is worse on Windows than the
task description assumed — but the fix is not "call the manager's tree-kill", because
that code path is currently dead.** Concretely:

1. `AgentProcessManager.killProcess()`'s Windows `taskkill /T /F` / POSIX
   `process.kill(-pid)` branch (`agent-process-manager.service.ts:1146-1220`) is **unreachable
   code today**. `TrackedAgent.process` is hard-coded to `null` in `trackSdkHandle()`
   (line 500) and nothing in this codebase ever sets it to a real `ChildProcess` — every
   adapter (`codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`) is routed through
   `runSdk()`/`doSpawnSdk()`, which only ever populates `sdkAbortController`. The
   `killProcess()` early-return for that branch (`sdkAbortController.abort()` + blind
   `setTimeout(500)`) is the _only_ code that runs for **all six adapters**, and it does no
   tree-kill of any kind — it just fires each adapter's own `abort` listener and waits half
   a second.
2. Every SDK adapter's own `abort` listener (`pi-cli.adapter.ts:344-349`,
   `antigravity-cli.adapter.ts:419`, `opencode-cli.adapter.ts:493`,
   `copilot-sdk.adapter.ts:305`) does the same thing: `child.kill('SIGTERM')` on the
   immediate child only. None of them touch descendants. So the orphan risk described in
   the task (Pi → bash → dev server/long command survives abort/timeout) applies
   identically to antigravity and opencode today, not just Pi.
3. On **Windows**, this is not just "grandchildren survive" — it can be "the kill call
   does nothing useful at all." `spawnCli()` (`cli-adapter.utils.ts:48-61`) calls
   `cross-spawn` with no `detached` option. When the resolved binary is an npm-global
   `.cmd` shim (the normal Windows install shape for `pi`, `opencode`, antigravity's CLI),
   cross-spawn detects the file isn't `.exe`/`.com` and wraps it: `command = cmd.exe`,
   `args = ['/d','/s','/c', '"<real pi.cmd> <args>"']` (confirmed against cross-spawn
   7.0.6's `lib/parse.js`, unpkg, fetched 2026-07-17). `child.pid` is therefore **the
   `cmd.exe` PID**, not the real `node.exe` process running Pi. `child.kill('SIGTERM')`
   kills `cmd.exe` and orphans the actual Pi process — and by extension its bash
   grandchildren — every single time, not just on abort races. `copilot-sdk.adapter.ts`
   already works around this for a different reason (argv length via `resolveDirectSpawn`,
   `cli-adapter.utils.ts:192-212`) but **Pi, antigravity, and opencode do not call
   `resolveDirectSpawn` and are exposed**.
4. POSIX group-kill (`process.kill(-pid, signal)`) **requires `detached: true` at spawn**
   (Node docs, `setsid(2)`) — confirmed below. `spawnCli()` doesn't set it, so even if the
   dead `killProcess()` branch were reachable, `process.kill(-childPid)` would throw
   `ESRCH` (no process group with that PGID exists) and silently fall back to
   `child.kill(signal)` — single-process kill, same gap as Windows.

**Confidence: high** on all four numbered claims — verified directly against this
repo's source, not inferred from general practice. The external best-practice material
below (tree-kill package status, Node semantics, `taskkill` behavior) is separately
well-sourced but is the _supporting_ evidence, not the headline.

---

## Q1 — Cross-platform process-tree kill in Node.js, mid-2026

Four approaches compared:

### (a) `tree-kill` npm package

- Latest published version is **1.2.2, released 2018-12-11** — no release in 7+ years
  ([npm](https://www.npmjs.com/package//tree-kill), fetched 2026-07-17). Still an
  "Influential" package by download count (~22M/week) because it's a transitive
  dependency of huge tools (npm/pnpm's spawn layers, VS Code tasks, etc.), but the
  project itself is unmaintained — no PR/issue activity in the trailing 12 months per
  Snyk's health analysis.
- Mechanism: Windows → shells out to `taskkill /pid <PID> /T /F`; POSIX → walks
  `ps -o pid --no-headers --ppid <PID>` (Linux) or `pgrep -P <PID>` (Darwin) recursively,
  then signals each PID individually — i.e. it does **not** rely on process groups at
  all, so it works even on non-detached children, at the cost of a `ps`/`pgrep` shell-out
  per level of the tree (slower, and a known source of past CVEs — 1.2.2's changelog
  entry is literally "security fix: sanitize `pid` parameter to fix arbitrary code
  execution vulnerability").
- Already present in this repo's `package-lock.json` as a **transitive** dependency
  (pulled in by something else, not a direct `package.json` entry) — not currently
  installable-and-usable without adding it as a direct dependency.
- A promise-wrapping fork, `tree-kill-promise`, is more recently published but is a thin
  wrapper around the same unmaintained core — doesn't change the underlying risk profile.
- **Unverifiable claim, flagged**: I could not confirm from primary sources whether
  `tree-kill`'s POSIX `ps`-walk path has a documented TOCTOU race (new grandchild spawned
  between enumeration and kill) — plausible given the algorithm, but not something I
  found stated by the maintainers.

### (b) Native `taskkill /pid <pid> /T /F` on Windows

- This is the approach this repo's `AgentProcessManager.killProcess()` already uses
  (`agent-process-manager.service.ts:1158-1180`) — and it's the approach the ecosystem
  converged on independently. A **June 2026** pnpm issue
  ([pnpm#12406](https://github.com/pnpm/pnpm/issues/12406), fetched 2026-07-17) documents
  pnpm moving _away_ from `pidtree`-style enumeration (which was shelling out to
  `wmic`/PowerShell and causing 20-46s hangs before a defensive 500ms timeout that then
  silently skipped cleanup) _to_ `taskkill /F /T /PID` at the spawn layer, explicitly
  citing that this matches what npm's `@npmcli/promise-spawn` and `tree-kill` already do
  on Windows. This is the strongest, most current signal available: **as of mid-2026 the
  ecosystem's Windows answer is native `taskkill /T /F`, not a `ps`-walk equivalent.**
  `wmic` itself is deprecated/removed on newer Windows builds, which further pushes
  tooling toward `taskkill`.
- Caveat surfaced by the same issue thread: `taskkill /T /PID` can discard/replace the
  original process's exit code with the killer's exit status — irrelevant for us since we
  already treat `stop()`/timeout as "we killed it", but worth knowing if exit-code
  fidelity is ever added to the manager's `handleExit`.

### (c) POSIX process groups: `spawn(..., {detached:true})` + `process.kill(-pid, sig)`

- Node's own `child_process` docs (fetched 2026-07-17, v26.5.0 docs page) state plainly:
  > "On non-Windows platforms, if `options.detached` is set to `true`, the child process
  > will be made the leader of a new process group and session."
  > and separately document the negative-PID convention as targeting that whole group.
  > This is **the** POSIX-native mechanism, no extra dependency, no shell-out — but it is
  > conditional on `detached: true` at spawn time (see Q2).
- Documented gotcha directly from the Node docs, verbatim: _"On Linux, child processes of
  child processes will not be terminated when attempting to kill their parent. This is
  likely to happen when running a new process in a shell or with the use of the shell
  option of `ChildProcess`."_ — i.e. detached-group-kill only reaches processes that
  stayed in the group; a grandchild that calls `setsid()`/starts its own session (some
  daemonizing dev servers do) can still escape. This is the one gap `taskkill /T /F` on
  Windows and `tree-kill`'s ps-walk don't have (they walk actual parent/child PID
  ancestry, not process-group membership) — worth naming as the residual risk of (c)
  specifically.

### (d) Anything newer for 2026 (Node core additions / Bun / Deno)

- `child_process`'s `signal`/`AbortController` integration
  (`spawn(cmd, args, {signal})` → `controller.abort()`) is **not** a tree-kill mechanism —
  Node's own docs confirm it is exactly equivalent to calling `.kill()` on the direct
  child, nothing more. `subprocess[Symbol.dispose()]` (stable since Node 24.2, per docs
  fetched today) is the same: single-process `SIGTERM`, no descendant awareness.
- I found **no Node.js core addition in 2025-2026** that adds first-class process-tree
  termination (no cgroup-based reap, no native tree-walk in `child_process`). This
  remains userland's problem in Node, same as it's been for years.
- Bun/Deno tree-kill APIs: **not researched in depth** — out of scope (this repo targets
  Node/Electron), flagged as unverified/not investigated rather than claiming they don't
  exist.

### Recommendation for an Electron/VS Code-host on Windows + macOS + Linux

Layered, not single-mechanism:

- **Windows**: `taskkill /pid <realPid> /T /F` — already what this repo does in
  `killProcess()`, and independently confirmed (pnpm, June 2026) as the current ecosystem
  default. The only fix needed is making sure it's invoked with the **real** PID (see
  Q2/Q3 — currently it's unreachable for SDK adapters, and even if reachable would often
  receive a `cmd.exe` shim PID for `.cmd`-installed CLIs).
- **POSIX (macOS/Linux)**: spawn with `detached: true`, kill with
  `process.kill(-pid, 'SIGTERM')` escalating to `'SIGKILL'` after a grace period — also
  already what `killProcess()` does. Fine as the primary mechanism; accept the
  "grandchild started its own session" edge case as a known residual gap rather than
  pulling in unmaintained `tree-kill` for defense-in-depth, given its dependency risk
  (see (a)) outweighs the marginal coverage it adds over the two native mechanisms above.
- Do **not** adopt `tree-kill` as a direct dependency solely for this — it duplicates
  logic this repo already has in native form on both platforms, and its own maintenance
  posture (0 releases since 2018) is worse than "roll your own 30-line helper using
  built-in `taskkill`/`process.kill`". Use it only if the grandchild-escapes-session edge
  case above becomes an actual observed bug, as a targeted POSIX-only fallback.

---

## Q2 — Does POSIX group-kill require `detached:true`? Confirmed against our `spawnCli`

**Yes — confirmed, and confirmed our code does not set it.**

- Node docs (quoted above): `detached:true` is what makes the child "the leader of a new
  process group and session" on POSIX. Without it, the child inherits the parent's
  (i.e. the Electron/VS Code extension host's) process group. `process.kill(-childPid)`
  targets the process group whose PGID equals `childPid` — if the child was never made a
  group leader, no such group exists, and the call throws `ESRCH`, which is exactly what
  `killProcess()`'s POSIX branch already defends against with its `try { process.kill(-childPid) } catch { child.kill(signal) }` fallback (`agent-process-manager.service.ts:1183-1190`) — but that fallback is single-process only, so the net effect on POSIX today, for every SDK adapter, is the same as Windows: **no tree-kill actually happens**, just a same-process `SIGTERM`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:48-61`
  (`spawnCli`) passes `{cwd, stdio, env, ...(needsConsole && win32 ? {windowsHide:false} : {})}`
  to `crossSpawn` — **no `detached` key at all**, on either platform.
- **Minimal fix**: add `detached: process.platform !== 'win32'` to the options `spawnCli`
  passes through (Windows doesn't need it — `detached` on Windows only affects whether the
  child survives the parent's exit, per Node docs, and is orthogonal to `taskkill /T`
  which walks real Win32 process ancestry, not POSIX process groups). Guard: a detached
  child on POSIX is disconnected from the parent's controlling terminal/session — verify
  this doesn't change stdio behavior for the interactive CLIs (`stdio` is still `pipe`
  for all three streams here, so should be unaffected, but worth a smoke test since
  `detached` + inherited stdio can behave surprisingly on some platforms).

### Windows caveats (ConPTY / node-pty / shim PID)

- **The shim-PID problem is the dominant Windows risk for this codebase**, bigger than
  the detached/group-kill question (which is POSIX-only). See the Executive Verdict
  section: `cross-spawn` silently reparents through `cmd.exe` for `.cmd`-suffixed
  binaries, so `child.pid` for `pi`, `antigravity`, and `opencode` on a typical Windows
  npm-global install is **not** the real node/binary PID. `taskkill /pid <that PID> /T /F`
  would actually still work correctly in this specific case (taskkill's `/T` walks real
  Win32 parent-PID ancestry starting from `cmd.exe`, so it would reach the real `pi`
  process and beyond) — but `child.kill('SIGTERM')`, which is what every current
  `killChild`/abort handler does, only ever reaches `cmd.exe` and stops there,
  orphaning everything below it. This is the single highest-leverage fix available.
- `spawnCli`'s existing `needsConsole` option (`windowsHide:false`) exists specifically
  because "CLIs that use node-pty/ConPTY internally for shell command execution... require
  a console for `AttachConsole()`" (comment at `cli-adapter.utils.ts:43-46`) — Pi shelling
  out to bash for tool execution is exactly this scenario. I could not find primary-source
  documentation (Microsoft or `node-pty` maintainers) quantifying "orphaned ConPTY handle"
  behavior specifically for 2025-2026 node-pty releases — the GitHub issues found
  (`microsoft/node-pty#437`, `#461`) describe kill/exit-code inconsistencies on Windows PTYs
  generally but are not dated to 2025-2026 and don't specifically confirm a handle-leak on
  abort. **Flagged as unverified**: treat "orphaned ConPTY handles survive `taskkill /T /F`
  on the parent" as a plausible-but-unconfirmed risk, not a proven one — `taskkill /T /F`
  forcefully terminates by PID tree regardless of what I/O subsystem a process uses, so a
  real ConPTY handle leak would more likely show up as a lingering _kernel object_ even
  after the process is gone, which is a different (and lower-severity) problem than the
  live-orphan-process risk this task is about.

---

## Q3 — Recommended fix for the Pi adapter

**Recommendation: (a) extract a shared tree-kill helper both the manager and the
adapters call, NOT (b) adopt the `tree-kill` npm package, NOT (c) "spawn `pi` detached and
group-kill" as a Pi-specific special case.** Reasoning:

- (b) is unnecessary per Q1 — this repo already has both native mechanisms
  (`taskkill /T /F`, POSIX group-kill) written correctly in `killProcess()`; they're just
  wired to a dead branch.
- (c) would fix Pi alone but leave antigravity/opencode/copilot-sdk with the identical gap
  (see Executive Verdict #2) — a per-adapter fix doesn't address the systemic issue that
  `killProcess()`'s real tree-kill logic is unreachable for the entire SDK-handle
  architecture, which is now 100% of adapters.
- (a) is the shape that matches this repo's own conventions (`cli-adapter.utils.ts` is
  already the shared-helpers file every adapter imports from) and fixes the bug at its
  root for every current and future SDK adapter in one place.

### Concrete plan

1. **Add a `killProcessTree(pid: number): Promise<void>` helper** to
   `cli-adapter.utils.ts`, lifting the existing Windows `taskkill`/POSIX
   `process.kill(-pid)`-then-`SIGKILL`-after-`KILL_GRACE_PERIOD` logic out of
   `AgentProcessManager.killProcess()` (`agent-process-manager.service.ts:1146-1220`) so
   both the (currently dead) manager branch and every adapter's abort handler call the
   _same_ code:
   ```ts
   // cli-adapter.utils.ts
   export async function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
     if (process.platform === 'win32') {
       try {
         await execFileAsync('taskkill', ['/pid', String(pid), '/T', '/F']);
       } catch {
         /* already exited, or taskkill unavailable — best-effort */
       }
       return;
     }
     try {
       process.kill(-pid, signal); // process-group kill — requires detached:true at spawn
     } catch {
       try {
         process.kill(pid, signal);
       } catch {
         /* already exited */
       }
     }
   }
   ```
   `AgentProcessManager.killProcess()` should be updated to call this same helper on
   `tracked.sdkHandle`'s underlying child PID (once adapters expose it — see step 3) so
   the manager-level branch stops being dead code, rather than leaving two divergent
   implementations.
2. **Add `detached: process.platform !== 'win32'` to `spawnCli()`** (Q2) so the POSIX
   branch of the new helper actually has a process group to target.
3. **Route Pi (and antigravity/opencode) through `resolveDirectSpawn()`** the way
   `copilot-sdk.adapter.ts` already does, so `child.pid` is the real interpreter/binary
   PID on Windows, not a `cmd.exe` shim PID — this is required for `taskkill /T /F` (or
   even correct `child.kill()`) to reach the right process on a typical Windows
   npm-global install.
4. **Update `PiCliAdapter.killChild()`** (`pi-cli.adapter.ts:344-349`) to call
   `killProcessTree(child.pid)` after the best-effort `{"type":"abort"}` write, instead of
   `child.kill('SIGTERM')`:
   ```ts
   const killChild = (child: ReturnType<typeof spawnCli>): void => {
     writeRequest(child, { type: 'abort' });
     if (child.pid && !child.killed) {
       void killProcessTree(child.pid);
     }
   };
   ```
   Apply the identical pattern to `antigravity-cli.adapter.ts:419`,
   `opencode-cli.adapter.ts:493`, and `copilot-sdk.adapter.ts:305` for consistency — all
   four have the exact same shape of bug.

### Interaction with the settle-then-kill lifecycle

- Keep the existing order: write `{"type":"abort"}` first, _then_ tree-kill. Pi's RPC
  protocol is documented (adapter header comment, `pi-cli.adapter.ts:39-45`) as
  distinguishing `agent_settled` (fully idle) from `agent_end` (may retry) specifically so
  the caller doesn't kill mid-retry — that logic is orthogonal to _how_ the eventual kill
  is performed and doesn't need to change.
- **Does killing the `pi` parent reliably make Pi tear down its bash children first?**
  Unverified — I found no Pi/Earendil documentation (checked the two doc URLs cited in
  the adapter header, `pi.dev/docs/latest/rpc` and `.../json`) describing signal
  propagation to its own tool-execution subprocesses. The adapter's own header comment
  calls the abort "best-effort", which is the honest framing: **do not assume the
  graceful `{"type":"abort"}` write reaps bash children — always tree-kill regardless**,
  exactly as the current code already does with `child.kill()` immediately after the
  abort write with no wait in between. The fix in step 4 doesn't change that race, it just
  makes the "regardless" kill actually reach the whole tree instead of one process.
- The 500ms blind wait in `AgentProcessManager.killProcess()`'s SDK branch
  (`agent-process-manager.service.ts:1150-1151`) should probably become
  "wait for `sdkHandle.done` to settle, capped at `KILL_GRACE_PERIOD` (5000ms)" once the
  manager actually needs to confirm the tree-kill landed — flagged as a secondary
  improvement, not blocking the adapter-level fix above.

---

## Q4 — 2026 gotchas

- **`taskkill` exit codes when the process already exited**: `taskkill` returns a non-zero
  exit code / "ERROR: The process ... could not be terminated" or "There is no running
  instance of the task" when the PID is already gone. This repo's `killProcess()` already
  wraps the call in `try/catch` and treats failure as best-effort (falls back to
  `child.kill()`, reports to Sentry) — correct defensive posture; the new shared helper in
  Q3 preserves that (swallow-and-continue, since "already exited" is the success case in
  disguise).
- **Orphaned ConPTY handles on Windows**: plausible but _unverified_ from primary sources
  as of this research (see Q2) — don't over-invest here without a reproduced case.
- **SIGTERM → SIGKILL escalation timing**: this repo already has this right for the
  reachable POSIX path — `KILL_GRACE_PERIOD = 5000ms`
  (`agent-process-manager-helpers.ts:28`) between `SIGTERM` and `SIGKILL` on the group.
  Windows has no equivalent escalation because `taskkill /F` is already the forceful
  terminal option — consistent with Node's own docs statement that Windows signals other
  than `SIGKILL`/`SIGTERM`/`SIGINT`/`SIGQUIT` are ignored and termination is "always...
  abrupt (similar to `SIGKILL`)" regardless of what's requested.
- **`taskkill` PATH resolution hardening** (lower-priority, single non-authoritative
  source): a June-2026-era commit in the `openclaw/openclaw` project
  ([commit a192b2e](https://github.com/openclaw/openclaw/commit/a192b2ea52b3166a7d190bf5f60f3feb030306bb),
  fetched 2026-07-17 — an unofficial third-party repo, not a primary/authoritative source,
  flagged accordingly) resolves `taskkill.exe`'s full `System32` path before spawning it
  rather than relying on `execFile('taskkill', ...)` finding it on `PATH`, to avoid
  PATH-hijacking/resolution failures in constrained shells. This repo's current
  `execFileAsync('taskkill', [...])` (`agent-process-manager.service.ts:1160`) relies on
  PATH; worth a defense-in-depth follow-up (`%SystemRoot%\System32\taskkill.exe`) but not
  a correctness blocker for this task — `taskkill` on `PATH` is the standard case on every
  Windows install this extension targets.

---

## Sources

- [tree-kill — npm](https://www.npmjs.com/package//tree-kill) (fetched 2026-07-17; last publish 2018-12-11)
- [tree-kill package health — Snyk Advisor](https://snyk.io/advisor/npm-package/testarmada-tree-kill)
- [node-tree-kill — GitHub (pkrumins)](https://github.com/pkrumins/node-tree-kill) (fetched 2026-07-17)
- [pnpm#12406 — Windows: kill spawned process trees at the run/exec layer](https://github.com/pnpm/pnpm/issues/12406) (June 2026, fetched 2026-07-17)
- [Node.js `child_process` docs, v26.5.0](https://nodejs.org/api/child_process.html) (fetched 2026-07-17)
- [cross-spawn 7.0.6 `lib/parse.js` — unpkg](https://unpkg.com/cross-spawn@7.0.6/lib/parse.js) (fetched 2026-07-17)
- [willsmythe/orphaned-node-process-test — GitHub](https://github.com/willsmythe/orphaned-node-process-test) (fetched 2026-07-17)
- [openclaw/openclaw commit a192b2e — fix(windows): resolve taskkill in core spawns](https://github.com/openclaw/openclaw/commit/a192b2ea52b3166a7d190bf5f60f3feb030306bb) (third-party, non-authoritative, flagged)
- [azimi.me — How to kill child processes that spawn their own child processes in Node.js](https://azimi.me/2014/12/31/kill-child_process-node-js.html)
- In-repo (this workspace, read 2026-07-17):
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`,
  `.../cli-adapters/pi-cli.adapter.ts`, `.../cli-adapters/cli-adapter.utils.ts`,
  `.../cli-adapters/antigravity-cli.adapter.ts`, `.../cli-adapters/opencode-cli.adapter.ts`,
  `.../cli-adapters/copilot-sdk.adapter.ts`, `agent-process-manager-helpers.ts`
