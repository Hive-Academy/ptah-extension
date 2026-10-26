# Live fix 1: Claude sign-in console never appears (Windows)

## Verdict

Fixed in code and covered by specs. `ClaudeLoginConsole.launch` now starts a hidden Windows PowerShell with no stdio. That PowerShell opens `claude auth login --claudeai` in a new visible console and waits for it. The scoped checks (tsc, eslint, jest) pass. The fix has not yet been retested in the live app; that is for the orchestrator.

## Change

### `libs/backend/auth-providers/src/lib/accounts/claude-login-console.ts`
- :36-56: new export `quoteWindowsArgument`. It quotes one argument by the `CommandLineToArgvW` / MSVC CRT rules. An argument with no blank or `"` stays bare. Otherwise it is wrapped in `"…"`, each `"` becomes `\"` with the backslashes in front of it doubled, and trailing backslashes are doubled.
- :58-73: `launcherScript(context)`. It builds `$ErrorActionPreference = 'Stop'; $p = Start-Process -FilePath '<exe>' -ArgumentList '<argline>' -WorkingDirectory '<cwd>' -Wait -PassThru; exit $p.ExitCode`. Every value goes through `quotePowerShell`. `<argline>` is a single string: `[...prefixArgs, 'auth','login','--claudeai'].map(quoteWindowsArgument).join(' ')`. It is not an array, because PS 5.1 joins array elements without quoting them.
- :75-78: `encodePowerShell`, which is base64 of UTF-16LE (the `-EncodedCommand` format).
- :150-158: doc comment rewritten to describe the hidden PowerShell launcher, the tree-kill scope and why conhost failed.
- :164-173: the spawn request is now `command: %SYSTEMROOT%\System32\WindowsPowerShell\v1.0\powershell.exe`, `args: ['-NoProfile','-NonInteractive','-EncodedCommand', <b64>]`, `env: context.env`, `cwd: context.cwd`, `ignoreStdio: true` and `launchGuard: claudeAccountRouteGuard(route)`.
- Unchanged: the abort, route and `claudeAccountRouteHolds` checks, the SYSTEMROOT check, `notStarted()`, the `{started|unavailable|route-changed}` contract, `whenSpawned` handling and the fallback scripts. No output is ever read (D5).

### `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts`
- :86-94: new optional `ignoreStdio?: true` port field. All stdio is `ignore` and the handle streams are `null`. The window follows the usual rule, so it is hidden unless `needsConsole`/`userConsole` is set. It works on every platform. `userConsole` is unchanged.

### `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`
- :796-798: `noStdio = userConsole || request.ignoreStdio === true`.
- :818-819: `stdioMode`/`stderrMode` are keyed on `noStdio`. `windowsHide` stays `!userConsole && needsConsole !== true`, so an `ignoreStdio` request is hidden.
- :713-714: comment updated.
- The worker program and the inline path already support `stdioMode: 'ignore'` (worker source :243-246, inline :894-897), so neither needed a change.

### Specs
- `libs/backend/auth-providers/src/lib/accounts/claude-login-console.spec.ts`:
  - The conhost case is replaced. The new case checks the absolute powershell path, the `-NoProfile -NonInteractive -EncodedCommand <base64>` args, `ignoreStdio: true`, and that neither `userConsole` nor `needsConsole` is set.
  - A new case decodes the script and checks its structure: FilePath, ArgumentList parsed back with a reference `CommandLineToArgvW` parser, WorkingDirectory, `-Wait -PassThru` and `exit $p.ExitCode`.
  - 7 round-trip cases: spaces, `'`, typographic quotes, `"`, `& % $ $( ) \` ; | < > ^`, trailing backslashes or an empty argument, and injection attempts. Each checks that exe, args and cwd come back intact. Each also checks that the code outside the literals is exactly the fixed template, so nothing can escape a literal.
  - 8 direct cases for `quoteWindowsArgument`.
  - The local `powerShellCode` helper became the shared top-level `scriptCode`.
  - The non-win32 `unavailable` case is unchanged apart from its title.
  - Nothing runs PowerShell, conhost or claude.
- `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts`: 2 new cases in the `userConsole` describe, both using a fake worker so no child is created:
  - `ignoreStdio` on win32 gives null streams and a spawn message with `stdioMode/stderrMode: 'ignore'`, `windowsHide: true` and the guard passed through.
  - `ignoreStdio` is not refused off win32.

## Cancel path (item 4)

`provider-account-actions.service.ts:128-138` `stop()` awaits `entry.console.whenSpawned`, then calls `killProcessTree(pid, 'SIGKILL')`. On win32 that is `taskkill /pid <pid> /T /F` (`platform-core/src/utils/process-tree-reaper.ts:59-73`). The pid is now PowerShell's, and `/T` reaches its children conhost.exe and claude.exe. The orchestrator's probe confirmed that `taskkill /PID <ps> /T /F` stops the whole tree. The service code needed no change.

## Checks

- `npx tsc --noEmit -p <lib>/tsconfig.lib.json` and `tsconfig.spec.json` for auth-providers, agent-sdk and platform-core: all 6 clean, with no output.
- `npx eslint` on the 5 changed source and spec files: no findings.
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts --maxWorkers=2`: 9 suites, 359 tests passed.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts .../helpers/off-thread-process-spawner .../detector/windows-hide-spawn --maxWorkers=2`: 2 suites passed and 1 skipped. That suite was already skipped and these changes did not touch it. 61 passed, 1 skipped.
- Not run, per the rules: `npm run verify`, builds, and checks for the hosts (electron, vscode, cli, tui). The port change is one additive optional field. The other `IProcessSpawner` implementations are test fakes and the Electron stress harness `CountingProcessSpawner`, which do not need it, so they still compile.

## Decisions

- **Hidden and ignored stdio through a new port field `ignoreStdio?: true`.**
  - Options considered:
    - (a) Reuse `userConsole`. Rejected: it forces `windowsHide: false`, which would show an extra PowerShell window.
    - (b) Use a plain request with pipes and never read them. Rejected: the pipes would not be drained, PowerShell could block on a full stderr pipe, and it goes against the D5 never-read rule.
    - (c) Change `userConsole` to mean hidden. Rejected: the brief says to keep `userConsole` semantics unchanged.
    - (d) Add an additive optional field. Chosen.
  - Evidence: the port had no hidden-and-no-stdio option (`process-spawner.interface.ts`). The spawner's `windowsHide` rule is at `off-thread-process-spawner.ts:812`.
  - Reversible: yes.
- **Arguments are passed as one pre-quoted `-ArgumentList` string**, following the brief. Windows PowerShell 5.1 joins an array without quoting.
- **`-WorkingDirectory` stays in the script, and the spawn `cwd` is also set to `context.cwd`**, following the verified design.

## Not done / residual risks

- `userConsole` is no longer used by any production caller. Only the spawner spec uses it. Removing it would leave less dead code, but the brief said to keep it, so I kept it. Recommend a follow-up removal.
- PowerShell `Start-Process` resolves `-FilePath` and `-WorkingDirectory` as provider paths, not literal paths. A path containing `[` or `]` may fail to resolve, and a missing path makes PowerShell exit non-zero, so no window appears. If this happens, the launcher exits and the UI's status polling decides the outcome; nothing is injected. The specs cannot exercise this because they do not run PowerShell. A live retest with such a path is still open.
- Whether `Start-Process` handles a `.cmd` executable was not checked here. The certified executable is node.exe or claude.exe.
- No live Electron retest has been done. That is for the orchestrator.
