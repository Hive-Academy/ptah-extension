# Live fix 1b — Start-Process wildcard paths (codex finding 1)

Builds on the uncommitted live fix 1 (`live-fix-1-report.md`). Fixes finding 1 of
`code-logic-review-live-fix-1.md`. Finding 2 (test/harness spawners ignore `ignoreStdio`) is
recorded only, per the brief; not fixed.

## Change

### `libs/backend/auth-providers/src/lib/accounts/claude-login-console.ts`

- :56-80 `launcherScript` now emits the .NET form the orchestrator verified, instead of
  `Start-Process -FilePath ... -ArgumentList ... -WorkingDirectory ... -Wait -PassThru`:

  ```
  $ErrorActionPreference = 'Stop'; $i = New-Object System.Diagnostics.ProcessStartInfo; $i.FileName = '<exe>'; $i.Arguments = '<argstring>'; $i.WorkingDirectory = '<cwd>'; $i.UseShellExecute = $true; $p = [System.Diagnostics.Process]::Start($i); $p.WaitForExit(); exit $p.ExitCode
  ```

  Every value is still a `quotePowerShell` literal. The argument string is still built with
  `quoteWindowsArgument`. `WindowStyle` is not set, so it stays Normal and the console is visible.
- :56-66 doc comment rewritten. It drops the Start-Process and 5.1 array-join wording and states
  why Start-Process is avoided (`[`/`]` wildcards in `-WorkingDirectory` and in its `$PWD`
  fallback). It keeps the `CommandLineToArgvW` reason, because `Arguments` is one string.
- Unchanged from fix 1: `ignoreStdio: true`, the hidden launcher, `-NoProfile -NonInteractive
  -EncodedCommand`, the absolute `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`,
  `launchGuard`, and the `ClaudeLoginConsoleStart` contract.

### `libs/backend/auth-providers/src/lib/accounts/claude-login-console.spec.ts`

- :225-241 the shape test asserts the new prefix and suffix. It also asserts that the script
  contains no `Start-Process` and no `WindowStyle`, and reads the values back through the
  `$i.FileName = `, `$i.Arguments = ` and `$i.WorkingDirectory = ` markers.
- :243-268 the round-trip table now reads the same three markers. The fixed-code assertion
  (`scriptCode`, literals blanked) matches the new script. The `injection` row's argument now
  tries to forge `'; $i.FileName = 'x`.
- :253 a new row, `wildcard brackets and backticks`:
  - exe `C:\Users\Jane[work] x\`bin`\claude.exe`
  - args `C:\a[1]`b\cli.js` and `[*]`
  - cwd `C:\Users\Jane[work] x\it`s `$x`

  Each value round-trips as one literal inside its property assignment, and the code outside
  the literals is unchanged.

## Checks

- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.lib.json`: exit 0.
- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.spec.json`: exit 0.
- `npx eslint` on the 2 files: exit 0, no output.
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts --maxWorkers=2`:
  9 suites passed, 360 tests passed.
- I did not run PowerShell, conhost or claude, per the brief. Runtime behaviour rests on the
  orchestrator's probe table.

## Decisions

- **Marker strings in the spec.** Options: keep `-FilePath`-style markers, or use the property
  assignments. I chose `$i.<Property> = `, which is the only form the new script has. Reversible.
- **The `injection` row's argument.** It used to forge `' -ArgumentList 'x`. It now forges
  `'; $i.FileName = 'x`, a breakout aimed at the new script's own syntax. The `scriptCode`
  assertion shows it stays inside the literal. Reversible.
- **Asserting no `WindowStyle`.** The brief requires the default Normal window. A
  `not.toContain('WindowStyle')` check guards against a regression to a hidden console.
  Reversible.
