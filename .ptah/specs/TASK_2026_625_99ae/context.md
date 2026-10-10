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

## Acceptance

- Every production spawn site in `libs/` and `apps/` either sets
  `windowsHide: true`, routes through `OffThreadProcessSpawner` without
  `needsConsole`, or documents why it cannot (with the chosen mitigation).
- Copilot and Antigravity runs keep a working console with no visible window.
- A guard spec (like `agent-sdk/src/lib/detector/no-shell-spawn.guard.spec.ts`)
  fails when a new production spawn omits `windowsHide`.
- Manual check on Windows: run an Electron session with agent runs, git activity
  and a cancelled agent, and see no console flashes.
