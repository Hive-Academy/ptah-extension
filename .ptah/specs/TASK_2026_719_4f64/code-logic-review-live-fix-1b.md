APPROVED — 9/10

Review family: codex (reviewer) / claude (implementer)

Scoped re-review of the correction to finding 1 in live fix 1. No new behavioral or security defect found.

## Findings

1. **Moderate — CLOSED: bracket-containing cwd could prevent launch.** `libs/backend/auth-providers/src/lib/accounts/claude-login-console.ts:72` and `:74`.

   Previous failure scenario: Start-Process resolved a cwd such as `Jane[work] x` through PowerShell's wildcard path handling, leaving no visible child and a pending login. The correction assigns FileName and WorkingDirectory directly to System.Diagnostics.ProcessStartInfo and calls Process.Start. These assignments do not invoke the PowerShell path provider or interpret brackets/backticks as wildcard syntax. The supplied Windows PowerShell 5.1 probes confirm exact cwd handling for plain, bracket-containing, and apostrophe/backtick/dollar paths. Fix suggestion: none further required for this finding; retain this literal property-assignment approach. Executable-path handling is supported by code inspection, not a separately supplied bracket-executable runtime probe.

2. **Minor — retained, nonblocking: test/harness spawners ignore the no-pipes contract.** `apps/ptah-electron/src/services/git-watcher.stress.harness.ts:149`; `libs/backend/workspace-intelligence/src/diagnostics/external-checkers/go-vet-hostile.integration.spec.ts:107`.

   Carried forward from the prior review, as requested; not re-audited in this scoped correction. Failure scenario: these implementations create pipes even when ignoreStdio is supplied; a caller relying on that option may leave output undrained and eventually block a noisy child. Neither serves production login. Fix suggestion: honor ignoreStdio or reject unsupported requests. This remains recorded only.

## Checked and fine

- All three dynamic property values pass through quotePowerShell (`claude-login-console.ts:72–74`). Apostrophes are doubled; brackets, backticks, dollar signs and statement separators remain literal data. No new script escape or argument splitting found.
- Arguments remains one string built by individually applying the unchanged quoteWindowsArgument helper (`:68`). Empty strings, embedded double quotes, backslashes before quotes and trailing backslashes preserve argument boundaries for the certified native executable route. FileName stays separate from Arguments.
- EncodedCommand remains UTF-16LE base64 (`:83–84`). No additional shell parsing layer was introduced. Microsoft's [UseShellExecute documentation](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.useshellexecute?view=netframework-4.8) distinguishes the Windows graphical shell from a command interpreter; this does not turn argument metacharacters into cmd.exe syntax.
- UseShellExecute is explicitly true (`:75`); no redirected streams, hidden WindowStyle, alternate credentials or custom ProcessStartInfo environment are configured. The child uses the launcher's environment, which is supplied through the existing spawner request. The correction does not replace it with an independent environment or introduce profile loading. The new visible console and avoidance of inherited NUL standard handles are supported by the supplied real-Claude Windows probe, not by Jest assertions alone.
- WaitForExit precedes exit with the child's ExitCode (`:77–78`), preserving the launcher's lifetime and normal exit-code passthrough. Start failures terminate under ErrorActionPreference Stop. The existing launchGuard, hidden ignored-stdio launcher, status-poll completion policy, cancellation handle and non-Windows behavior are unchanged by this correction. The supplied taskkill probe confirms that tree cancellation still removes Claude.
- Specs at `claude-login-console.spec.ts:225` check the new script structure, wait/exit sequence and property values; the table at `:253` covers brackets and backticks in executable, prefix arguments and cwd. The injection row targets the new assignment syntax. These are useful serialization/regression tests, but do not execute PowerShell or prove console visibility, environment inheritance or Windows path resolution. The literal parser partly shares quotePowerShell for cursor advancement; the independent argument parser and explicit expected quoting strings provide additional checks.

## Validation

Ran exactly one scoped Jest invocation:

`npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts/claude-login-console.spec.ts --maxWorkers=2 --silent`

**1 suite passed; 38 tests passed.** A config module-loading warning was emitted; the command exited 0. Reviewed the current diff, implementation report and previous review. No source/spec edits, build, install, workspace-wide checks, or PowerShell/conhost/Claude execution. Runtime conclusions explicitly rely on the orchestrator evidence provided in the task; those probes were not independently repeated. Implementer-reported broader checks were not repeated.

## Decisions

- Close finding 1 and approve the scoped correction. Wildcard escaping is unnecessary at these direct .NET property assignments and could corrupt literal paths.
- Retain finding 2 as Minor maintenance only, per the brief.
