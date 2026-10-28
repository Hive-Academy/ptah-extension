REVISE — 8/10

Review family: codex (reviewer) / claude (implementer)

## Findings

1. **Moderate — bracket-containing cwd can reproduce pending with no console.** libs/backend/auth-providers/src/lib/accounts/claude-login-console.ts:70 (executable lookup at :68).

   Failure scenario: a certified cwd contains brackets, for example a Windows username Jane[work]. Single-quoted PowerShell literals prevent script injection but do not suppress wildcard interpretation by Start-Process's WorkingDirectory resolver. The acknowledged resolution limitation can terminate the hidden launcher before Claude starts. The PowerShell PID suffices for started (:179), so fallback is not selected; status polling continues until deadline.

   Fix suggestion: make cwd handling literal, for example Set-Location -LiteralPath followed by Start-Process without explicit WorkingDirectory, validated on Windows PowerShell 5.1. Alternatively escape wildcard syntax at that resolver boundary. Verify executable paths separately, including bracket-containing paths and similarly named siblings. Do not blindly apply WildcardPattern.Escape everywhere: executable lookup and cwd resolution differ, and arguments must retain their bytes. Cover literal backticks too. Resolve this before acceptance because legal Windows paths can reproduce the symptom being fixed.

   Evidence limit: not independently reproduced with PowerShell. The implementation report acknowledges this risk. Microsoft's [current source](https://github.com/PowerShell/PowerShell/blob/master/src/Microsoft.PowerShell.Commands.Management/commands/management/Process.cs) corroborates explicit WorkingDirectory resolution and separate executable lookup, but does not prove all 5.1 details. The [5.1 documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1) labels FilePath as not supporting wildcards. The report's blanket FilePath explanation is not proof of executable redirection or injection.

2. **Minor — test/harness spawners ignore the no-pipes contract.** apps/ptah-electron/src/services/git-watcher.stress.harness.ts:149; libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-hostile.integration.spec.ts:107.

   Failure scenario: CountingProcessSpawner creates default pipes and NodeSpawner explicitly pipes stdout/stderr even when ignoreStdio is supplied. A caller following the new contract will not drain them; enough output can block the child. Neither serves production login. Fix suggestion: honor ignoreStdio or reject unsupported requests. The optional field introduces no structural TypeScript incompatibility; compilation was not rerun.

## Checked and fine

- Every dynamic launcher value passes through quotePowerShell. Ordinary and supported typographic single quotes are doubled. Shell expressions and separators remain literal. No script escape found.
- quoteWindowsArgument handles empty strings, whitespace, embedded quotes, backslash runs before quotes and trailing backslashes correctly. Prefix arguments are individually quoted then joined into one ArgumentList string. This assessment covers certified native executables, not arbitrary batch-file parsing.
- EncodedCommand is base64 of UTF-16LE without a BOM. Executable and cwd remain separate parameter values.
- Production OffThreadProcessSpawner maps ignoreStdio to three ignored streams and keeps windowsHide true by default. Worker and inline paths honor launchGuard before creating PowerShell. Null streams are marked drained; close does not wait for nonexistent pipes. Existing userConsole/needsConsole semantics are unchanged.
- The actions service tracks PowerShell's handle, cancels through taskkill /T /F and decides authentication only from status probes. The script waits and exits with the target's ExitCode. Window appearance and tree ancestry rely on the supplied orchestrator probes. The guard protects launcher creation, not an additional atomic check immediately before its descendant starts.
- Non-Windows launch and fallback generation are unchanged.
- Other implementations found are synthetic test spawners, including checker-runner/go-vet fakes and DelayedGuardedSpawner, with no OS pipes. The editor-merge real-test recording spawner already ignores all stdio. No second production implementation was found.
- Tests are useful, not wholly tautological: direct expected quoting strings, independent argument parsing, decoded script structure and spawner message/handle assertions catch regressions. The PowerShell literal helper partly uses production quotePowerShell for cursor advancement. None proves actual PowerShell parsing, path resolution, visibility or tree cancellation. Existing real-worker coverage exercises ignored stdio; new option tests use a fake worker.

## Validation

Scoped command: npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts/claude-login-console.spec.ts --maxWorkers=2 --silent.

**37 tests passed, 1 suite passed on both runs.** The second invocation was accidental shell command substitution during initial report writing; this report was subsequently rewritten safely. Both runs emitted a config module-loading warning and succeeded. No source/spec edits, build, install, workspace-wide checks, PowerShell, conhost or Claude execution occurred. Broader implementer checks were not repeated.

## Decisions

- Finding 1 drives REVISE; finding 2 is nonblocking maintenance.
- No evidence supports Blocking/Serious injection findings. Quoting and path resolution are separate concerns.
- Retain the hidden launcher design and additive ignoreStdio option.
