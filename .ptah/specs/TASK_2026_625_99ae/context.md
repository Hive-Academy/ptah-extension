# Context: hide console windows for every Windows child-process spawn

## Symptom

On Windows, console windows repeatedly flash open and closed while Ptah works,
most visibly in the Electron app.

## Cause

Electron's main process (and its `utilityProcess` workers) have no console. Each
console-subsystem child (`git.exe`, `taskkill.exe`, `codex`, `ffmpeg`, `cmd.exe`
for `.cmd` shims, ...) started without `windowsHide: true` gets a new visible
console that closes when the child exits.

Most spawns route through `OffThreadProcessSpawner`
(`libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`), which
hides the window unless the caller passes `needsConsole: true`. The sites below
bypass it, opt out of hiding, or live inside third-party SDKs.

## Already fixed (PR #696)

- `libs/backend/platform-core/src/utils/process-tree-reaper.ts` — `taskkill /T /F`
  had no options. Every tree kill runs it: git timeouts and cancels
  (`exec-git.ts` `terminate()`), agent stops, and timed-out CLI and version probes.
- `libs/backend/vscode-core/src/utils/exec-git.ts` — the inline `crossSpawn(git)`
  path used when no spawner is injected (MCP git and worktree tools via
  `git-namespace.builder.ts:139`, the VS Code and CLI `GitInfoService`).

## Remaining sites

### Needs design

Phase 2 status: items 2–4 are fixed by a postinstall patch (D1–D3 below).
Item 1 is not fixed; see D4 for the options and the manual check.

1. **Copilot and Antigravity agent runs** — `copilot-sdk.adapter.ts:373` and
   `antigravity-cli.adapter.ts:723` pass `needsConsole: true`, which becomes
   `windowsHide: false` (`off-thread-process-spawner.ts:731`,
   `cli-adapter.utils.ts:339-341`). The window stays visible for the whole run.
   These CLIs need a real console (ConPTY) for their shell tools, so the fix is
   a console that exists but has a hidden window, not `windowsHide: true`. The
   comment at `cli-adapter.utils.ts:290` wrongly calls the console "(hidden)".
2. **`@openai/codex-sdk`** — `dist/index.js` spawns `codex exec` with only
   `{ env, signal }`, once per turn (called from `codex-cli.adapter.ts:198`).
   There is no spawn hook. Options: `patch-package`, or point `codexPathOverride`
   at a launcher that hides its window.
3. **`@cursor/sdk` local runtime** — `git rev-parse`, `git check-attr`, the shell
   tool executor, `ffmpeg` and a detached `binaryPath` spawn have no
   `windowsHide` (`dist/cjs/index.js`, `222.js`). Called in-process from
   `cursor-cli.adapter.ts:154`. No hook, so this needs a patch.
4. **`chrome-launcher`** — `spawnSync('taskkill /pid N /T /F', { shell: true })`
   on browser close (`dist/chrome-launcher.js:334`), used via
   `chrome-launcher-browser-capabilities.ts:22`. Patch, or kill through
   `killProcessTree` ourselves before calling its `kill()`.

### Direct fixes (add `windowsHide: true` or route through the spawner)

- `libs/backend/voice-providers/src/lib/worker/ffmpeg-decode.ts` (~78-90) —
  ffmpeg per decoded clip, in a console-less utilityProcess.
- `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts:106` — `npx skills`
  fallback (`cmd.exe /c npx.cmd` on Windows), per search when the API fails.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:334`
  — the inline `crossSpawn` in `spawnCli` when no spawner is passed (for example
  `codex/codex-native-binary.ts:218` `probeCliVersion`).
- `libs/backend/agent-sdk/src/lib/detector/claude-cli-path-resolver.ts:225` —
  `spawn('where', ...)` during Claude CLI detection.
- `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts:115`
  — toolchain probes from the harness RPC.
- `libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts:637` —
  inline `crossSpawn('gh', ...)` when no spawner is injected.
- `apps/ptah-extension-vscode/src/rpc-host-profile.ts:39` —
  `crossSpawn('git', ['worktree', 'list', ...])`.

### Low impact (CLI host already owns a console)

- `libs/backend/cli-engine/src/lib/platform/cli-platform-commands.ts:132`
- `libs/backend/platform-cli/src/implementations/cli-user-interaction.ts:77/86/91/153`
- `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.ts:91` (fork)

Set the flag here anyway for consistency. It costs nothing on a console parent.

## Already correct (for reference)

`claude-cli-detector.ts:711`, `process-start-time.probe.ts:276`,
`claude-approval.reader.ts:106`, the quota readers (antigravity, grok,
opencode), `run-check.tool.ts:713`, the off-thread worker spawn and its inline
fallback, and the Claude Agent SDK (hides itself and also routes through the
spawner hook).

## Decisions

Phase 2 (branch `fix/task-625-remaining-console-windows`). Installed versions:
`@openai/codex-sdk` 0.155.1, `@cursor/sdk` 1.0.31, `chrome-launcher` 1.2.1,
`node-pty` 1.1.0.

### D1. Patch mechanism: a postinstall script, not `patch-package`

- **Options.** `patch-package` (not installed, new dependency, `.patch` files
  against minified one-line bundles), npm's own patching (npm has none; the
  repository uses npm, not pnpm), or a postinstall script like the existing
  `apps/ptah-electron/scripts/patch-transformers-onnx-dep.js`.
- **Choice.** `scripts/windows-hide-patch/patch-windows-hide-deps.js`, run last
  in the root `postinstall`. It follows the repository's existing mechanism.
  Each edit is exact text that must occur once, and each package is pinned to
  its installed version. A different version or a text mismatch is reported and
  the package is left untouched, so `npm install` never fails because of it.
- **Drift.** `scripts/windows-hide-patch/patch-windows-hide-deps.spec.ts`
  (`npm run test:scripts`) checks the patch against the installed packages and
  fails when a bump no longer matches. Re-pin the version and the anchors then.
- **Reversible.** Remove the `postinstall` step and run `npm ci`.

### D2. `@openai/codex-sdk` and `@cursor/sdk`: redirect `child_process`

- **Evidence.** Codex: `dist/index.js` has one `spawn(this.executablePath, ...,
  { env, signal })`. `CodexOptions` offers only `codexPathOverride`, `env` and
  config, with no spawn hook. A launcher behind `codexPathOverride` does not
  help: the launcher is itself a console program spawned without
  `windowsHide`. Cursor: a webpack bundle with about 10 spawn sites (git
  `rev-parse` and `check-attr`, the shell tool executor, ffmpeg, the sandbox
  probe, cross-spawn), and no hook. Every chunk reaches `child_process` through
  the module table in `dist/{cjs,esm}/index.js`.
- **Choice.** Point the `child_process` import (codex: 1 edit; cursor: 2 in
  CJS, 2 in ESM) at `ptah-windows-hide-child-process.{cjs,mjs}`, which the
  script copies next to the patched file. The shim wraps `spawn`, `spawnSync`,
  `exec`, `execSync`, `execFile`, `execFileSync` and `fork` to default
  `windowsHide: true`. It keeps a caller's explicit value and the
  `util.promisify` hook. A per-call-site edit of minified code was rejected as
  more fragile.
- **Why it is safe.** Neither SDK uses node-pty (checked). Codex and Cursor
  shell tools spawn with pipes, so a windowless console (`CREATE_NO_WINDOW`)
  is enough for them and their children.
- **Hosts.** Electron and the TUI/CLI keep both SDKs external (patched
  `node_modules` is packaged). VS Code bundles codex-sdk (the patched source is
  bundled) and keeps `@cursor/sdk` external. A user who installs the published
  `@hive-academy/ptah-cli` from npm does not get the patch. That host owns a
  console, so no window opens there.

### D3. `chrome-launcher`: patch the one `taskkill` call

- **Evidence.** `dist/chrome-launcher.js:334`:
  `spawnSync(\`taskkill /pid N /T /F\`, { shell: true, encoding: 'utf-8' })`.
  `kill()` runs it while `this.chromeProcess` is set, so a tree kill before
  `kill()` does not prevent it. No option disables it.
- **Choice.** Add `windowsHide: true` to that call only. The `child_process`
  redirect from D2 is wrong here: it would also pass SW_HIDE to the Chrome
  window that the launcher starts.

### D4. Copilot and Antigravity (`needsConsole`): NOT FIXED, documented

- **Facts.** On Windows `spawnCli` forces `detached: false`, so `needsConsole`
  only maps to `windowsHide: false`. The child (a console program) has no
  parent console in Electron, so Windows gives it a new, visible console. With
  `windowsHide: true`, libuv adds `CREATE_NO_WINDOW` (when no stdio slot is
  inherited) and `SW_HIDE`. The earlier failure was in node-pty's
  `conpty_console_list_agent`, which the CLI forks: it calls `FreeConsole()`
  and then `AttachConsole(shellPid)` (`node-pty/src/win/conpty_console_list.cc`).
  Both adapters already filter "AttachConsole failed" lines as noise.
- **Why not fixed now.** Every option changes how these CLIs run, and no
  option can be verified without a manual Windows run of a real Copilot or
  Antigravity shell command. This session could not run programs.
- **Options.**
  1. *Re-test `windowsHide: true` (CREATE_NO_WINDOW).* That console exists but
     has no window. In theory `FreeConsole()`/`AttachConsole()` succeed in it.
     If shell commands work, the fix is to remove `needsConsole` from
     `copilot-sdk.adapter.ts` and `antigravity-cli.adapter.ts` (one line each).
     Cheapest. It needs the manual check below.
  2. *A small GUI-subsystem launcher (native `.exe`)* that calls
     `CreateProcessW` with `STARTF_USESHOWWINDOW` + `SW_HIDE` and no
     `CREATE_NO_WINDOW`, passes the stdio pipes through, and returns the exit
     code. The child gets a real console whose window starts hidden. Cost: a
     new native binary to build, sign and ship for each Windows architecture.
  3. *Run the CLI under a ConPTY that we own (node-pty).* Real console, no
     window. Cost: stdout and stderr merge into one VT stream, and ConPTY
     re-renders output (line wraps at the column width, cursor sequences).
     That breaks the JSON-lines parsers of both adapters. It also loads a
     native module in the off-thread spawner worker. Rejected.
  4. *libuv quirk:* `CREATE_NO_WINDOW` is skipped when a stdio slot is
     `inherit`, which keeps `SW_HIDE` on a new console. It relies on an
     undocumented libuv detail and changes the child's stdio. Rejected.
  5. *`Start-Process -WindowStyle Hidden`* loses the stdio pipes. Rejected.
- **Recommendation.** Do the manual check for option 1. If shell commands
  work, remove `needsConsole` from the two adapters. If not, do option 2.
- **Manual check (Windows, Electron, packaged or `electron:serve`).**
  1. In `copilot-sdk.adapter.ts`, set `needsConsole: false`.
  2. Start a Copilot agent run with a prompt that runs a shell command (for
     example "run `git status` and report the output").
  3. Make sure that no console window opens and the command output comes back.
  4. Do steps 1–3 again for Antigravity (`antigravity-cli.adapter.ts`).

## Acceptance

- Every production spawn site in `libs/` and `apps/` either sets
  `windowsHide: true`, routes through `OffThreadProcessSpawner` without
  `needsConsole`, or documents why it cannot (with the chosen mitigation).
- Copilot and Antigravity runs keep a working console with no visible window.
- A guard spec (like `agent-sdk/src/lib/detector/no-shell-spawn.guard.spec.ts`)
  fails when a new production spawn omits `windowsHide`.
- Manual check on Windows: run an Electron session with agent runs, git activity
  and a cancelled agent, and see no console flashes.
