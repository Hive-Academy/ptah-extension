# TASK_2026_348 — DEP0190 shell:true spawn with unescaped args

## Evidence (`tmp/logs/log.log`, boot capture 2026-08-28)

- 110-114: `[SdkAgentAdapter] Initializing SDK adapter...` -> `[AuthManager] Configuring auth method: claudeCli` -> `[CliStrategy] Configuring Claude CLI authentication`. That is auth-providers `cli.strategy.ts:43` calling `ClaudeCliDetector.performHealthCheck()`.
- 115-547: one long synchronous boot segment (RPC registration, subsystem bring-up, license check) with no await yield.
- 548: `(node:20340) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true …` — printed when the microtask queue drains and the first `spawn(…, { shell: true })` with an args array runs.
- 580-587: `[CliStrategy] Claude CLI found at C:\Users\abdal\.local\bin\claude.exe (v2.1.247)` … `[SdkAgentAdapter] Claude CLI found: {"source":"which-where", …}` — the probe that fired at 548 was the `where claude` lookup.
- 887-903: `[CliDetection] Detecting installed CLI agents…` plus the `codex.CMD` / `copilot.CMD` hits. That is cli-agent-runtime's `CliDetectionService`, ~340 lines AFTER the warning, and it already routes through `cross-spawn` (`cli-adapter.utils.ts:154-178`). The carrier's hypothesis — CLI detection of Windows `.CMD` shims — is co-located in time but is not the cause.
- Node emits each deprecation code ONCE per process, so line 548 named the first offender only and silenced the rest.

## Root cause

`libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts` (`executeCommand`) computed:

```ts
const needsShell = isWindows && !isWSL && (command.endsWith('.cmd') || command.endsWith('.bat') || (!command.includes('\\') && !command.includes('/')));
const child = spawn(command, args, { stdio: 'pipe', windowsHide: true, shell: needsShell });
```

Every bare command on Windows (`where`, `npm`, `claude`, `claude-code`, `wsl`) and every `.cmd`/`.bat` install path therefore went through `cmd.exe` with the arguments concatenated unescaped. In-file call sites: `detectWithWhichWhere`, `detectNpmGlobal`, `detectInSystemPath`, `verifyInstallation`, `performHealthCheck`, `detectInWSL`. The first one reached at boot is `where claude`, via `CliStrategy.configure` and again via `SdkAgentAdapter.initialize` -> `findExecutable()`.

Two further offenders of the same class, silent because DEP0190 is one-shot:

1. `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts` — `spawn('npx', ['skills', ...args], { shell: true })`. The args are validated by three layers, but the shell+args shape is what makes those layers load-bearing.
2. `apps/ptah-cli/src/cli/oauth/browser-launching-oauth-url-opener.ts` — `spawn('start', ['""', url], { shell: platform === 'win32' })`. `start` is a cmd.exe builtin, so a shell IS required; the correct form names the shell as the executable, which `platform-cli`'s `CliUserInteraction.openExternal` already does.

Not offenders, deliberately left alone: `platform-cli` `cli-user-interaction.ts` `writeToClipboard` (`shell: true` but a single command string, no args array), `claude-cli-path-resolver.ts:221` (`shell: false`), `cli-agent-runtime` `fix-path.ts`, `apps/ptah-cli/scripts/verify-packed-wasm.cjs`, `ptah-video-studio` dev scripts.

## Implementation notes

### What changed

- **`libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts`** — `child_process.spawn` replaced by `cross-spawn`; the whole `needsShell` computation deleted, so `executeCommand` now passes only `{ stdio: 'pipe', windowsHide: true }`. `cross-spawn` gets the same Windows behaviour without a shell: bare commands resolve through PATH/PATHEXT and `.cmd`/`.bat` wrappers run via `cmd.exe /d /s /c` with each argument escaped. The now-inert `isWSL` option was removed from `executeCommand`'s signature and its two call sites rather than left as a silently ignored parameter.
- Same file, `detectWithWhichWhere` now calls `which('claude', { all: true, nothrow: true })` instead of spawning `where`/`which`. Same PATH/PATHEXT semantics, one fewer subprocess on every boot, no parsing of another process's `\r`-terminated stdout. The `source: 'which-where'` literal is unchanged because it reaches logs and the UI (acceptance criterion 1).
- **`libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts`** — `cross-spawn`, `shell: true` gone. `cross-spawn` is typed as returning a plain `ChildProcess`, so the two stream handles are now reached with `?.`; with the default `stdio: 'pipe'` both are always present at runtime. cwd/env/timeout/exit-124 behaviour is untouched.
- **`apps/ptah-cli/src/cli/oauth/browser-launching-oauth-url-opener.ts`** — win32 now spawns `cmd` `['/c', 'start', '', url]` with no `shell` option. darwin (`open`) and linux (`xdg-open`) are unchanged.
- **`libs/backend/agent-sdk/package.json`** (`cross-spawn`, `which`) and **`libs/backend/rpc-handlers/package.json`** (`cross-spawn`) — both libs now IMPORT those packages, and `@nx/dependency-checks` fails lint as an ERROR when a lib uses a package its own `package.json` does not declare. Versions copied from `cli-agent-runtime`'s manifest (`^7.0.6` / `^6.0.1`), which already declares both. Nothing was added to the root `package.json`; both were already root dependencies and are already listed as bundler externals for the Electron and CLI builds.
- **`apps/ptah-cli/src/main.ts`** — comment only. `installDep0190Filter`'s docblock blamed "the bundled SDK"; the bundled SDK only forwards a `shell` option its caller supplies, and the real emitters were the three above. The filter stays as a defensive guard against third-party dependencies, with the docblock now saying so and pointing at the guard spec.

### Tests added

- `libs/backend/agent-sdk/src/lib/detector/no-shell-spawn.guard.spec.ts` — source guard over `cli-agent-runtime`, `auth-providers`, `vscode-lm-tools`, `agent-sdk`, `rpc-handlers` and `apps/ptah-cli` (507 non-spec `.ts` files). It is a small scanner, not one regex, because the three offenders had three different shapes: an `args` identifier, an array literal, and an injected `this.spawner(...)`. A regex anchored on `[` misses the first, one anchored on `spawn(` misses the third, and `shell\s*:\s*(?!false)` matches ` false` by backtracking to zero width — all three failure modes were observed while writing this. The scanner splits call arguments with balanced brackets and quote tracking, then flags any call with three or more arguments whose options carry a `shell` value that is not literally `false`. `shell: needsShell` is rejected on purpose. The matcher itself is pinned by ten positive/negative samples, including verbatim copies of the three pre-fix call sites, so the scan cannot pass because the matcher broke.
- `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.spec.ts` (new; the detector had no unit spec) — `cross-spawn`, `which`, `os`, `fs` and the path resolver mocked, `child_process.spawn` replaced by a throwing mock. Covers: a configured Windows `.cmd` path probed with no `shell` key in the options; PATH lookup going through `which` with no `where`/`which` spawn; every fallback probe carrying `{ stdio: 'pipe', windowsHide: true }` and no `shell`; health-check success parsing `2.1.247`; non-zero exit and non-Claude output both yielding unavailable; and the timeout path killing the child and resolving `false` under fake timers. Every case also asserts `child_process.spawn` was never called.
- `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.spawn.spec.ts` (new file rather than an addition to `skills-sh-cli.spec.ts`, which deliberately mocks nothing) — `runSkillsCli` spawns `npx` through `cross-spawn` with no `shell` option, keeps `cwd`/`FORCE_COLOR`/`NO_COLOR`, reports a non-zero exit unchanged, SIGTERMs and reports 124 on timeout, and rejects when the child cannot be spawned.
- `apps/ptah-cli/src/cli/oauth/browser-launching-oauth-url-opener.spec.ts` (new; the class had no spec) — win32 argv is exactly `cmd /c start "" <url>` with no `shell` option, darwin/linux unchanged, no launch without a TTY or under `CI`/`NO_BROWSER`, and a throwing spawner reports `{ opened: false }`.

### Test results

`npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/auth-providers ptah-cli --skip-nx-cache` — header `Running target test for 4 projects`.

- `@ptah-extension/rpc-handlers`: `Test Suites: 90 passed, 90 total` / `Tests: 31 skipped, 2516 passed, 2547 total`.
- `ptah-cli`: `Test Suites: 1 skipped, 65 passed, 65 of 66 total` / `Tests: 3 skipped, 970 passed, 973 total`.
- `@ptah-extension/auth-providers`: `Test Suites: 35 passed, 35 total` / `Tests: 635 passed, 635 total`.
- `@ptah-extension/agent-sdk`: `Test Suites: 2 failed, 77 passed, 79 total` / `Tests: 4 failed, 1194 passed, 1198 total`. The two failing suites are `helpers/history/jsonl-reader.streaming.spec.ts` (3 tests) and `helpers/off-thread-process-spawner.spec.ts` (1 test), and all four failures are `Exceeded timeout` — both suites assert on wall-clock behaviour (a 5 000/10 000-line transcript parse; worker-thread launch latency) and both took over two minutes on a box running several agents' full suites at once. Re-run alone together with this task's detector specs: `Test Suites: 4 passed, 4 total` / `Tests: 45 passed, 45 total`. Neither suite imports anything this task changed.

Concurrent-tree note: two earlier runs of this set had suites that FAILED TO RUN — not assertion failures — on TypeScript errors inside other agents' in-flight edits to `agent-sdk` (`helpers/index.ts` exporting `PtahSpawnedProcess`/`SpawnTransport` before `off-thread-process-spawner.ts` declared them, TASK_2026_341; then `plugin-loader.service.ts:784` calling `resolveHarnessOverlayPaths(workspaceRoot)` before that parameter existed). Both were gone from the tree minutes later. Neither touches any file in this task.

Re-run of just the touched specs after formatting, `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers ptah-cli --testPathPatterns="(detector|skills-sh-cli|oauth)"`: `Successfully ran target test for 3 projects`, 8 suites / 78 tests, all passing.

`npx nx run-many -t typecheck -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/auth-providers ptah-cli` — header `Running target typecheck for 4 projects`, `Successfully ran target typecheck for 4 projects`.

`npx nx run-many -t lint -p @ptah-extension/agent-sdk @ptah-extension/rpc-handlers ptah-cli` — `Successfully ran target lint for 3 projects` (0 errors; the remaining warnings are pre-existing `max-lines` / unused-import warnings in files this task did not touch). The first lint run failed with two `@nx/dependency-checks` ERRORS, which is what added `cross-spawn`/`which` to the two lib manifests above. `npx eslint` over only this task's eight files reports zero problems.

### Verification still owed to a human

Acceptance criterion 1 is a Windows Electron boot: no `[DEP0190]` line between MCP server start and the license check, with `[CliStrategy] Claude CLI found at …` and `[SdkAgentAdapter] Claude CLI found: {"source":"which-where"}` still reporting the same path and version. That needs a real machine and a real Claude install; the specs above pin the mechanism (no `shell` option anywhere, no `child_process.spawn`, `which` instead of a `where` subprocess) but they cannot observe Node's warning.

### Not touched

`sdk-agent-adapter.ts`, `auth-rpc.handlers.ts`, `cli.strategy.ts`, and every cli-agent-runtime source — all belong to sibling tasks and cli-agent-runtime was already clean. `task.md` was edited only on its `status:` line.
