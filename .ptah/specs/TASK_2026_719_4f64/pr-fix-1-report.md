# PR #827 fix 1: the PowerShell fallback runs in a child process

## Finding

CodeRabbit (Minor) on `libs/backend/auth-providers/src/lib/accounts/claude-login-console.ts`: the
PowerShell fallback ran its `& { ... }` body in the user's live session. `Remove-Item Env:` removed
every variable not on the allowlist (for example `PSModulePath`) and `Set-Location` changed the
directory. Nothing was restored afterwards. The orchestrator confirmed the finding.

## Change

`libs/backend/auth-providers/src/lib/accounts/claude-login-console.ts`
- About :41-46: new doc comment on `powerShellScript` that says why the child process is used.
- About :52: the script now starts with `powershell -NoProfile -Command {` instead of `& {`. The
  body runs in a child Windows PowerShell 5.1 process; the script-block form also works when the
  user starts it from pwsh. The child inherits the user's environment, clears it down to the
  allowlist, and changes directory. Neither change reaches the user's session.
- About :60-61: the invocation now ends with `;`, followed by `exit $LASTEXITCODE` before the closing
  `}`.
- Unchanged: the allowlist literal, `quotePowerShell` quoting, the `Set-Location -LiteralPath` cwd,
  the `NO_PROXY` and `CLAUDE_*_CONFIG_DIR` lines, the `& <invocation> auth login --claudeai` call,
  `$ErrorActionPreference = 'Stop'`, and the whole posix script.

## Decisions

- Added `exit $LASTEXITCODE` inside the child block.
  - Options: leave it out, or add it.
  - Evidence: with `-Command`, powershell.exe reports only 0 or 1, based on `$?` of the last
    statement, not the native exit code. Before this fix, `claude`'s exit code reached the user's
    `$LASTEXITCODE` directly. The `exit` passes the same code through the child, so "the same
    exit behaviour" holds.
  - Reversible: yes. It is one statement.
- Used a child process instead of save and restore, as the brief asked. With a child process,
  nothing in the user's session needs restoring, even when a statement in the block fails under
  `Stop`.

## Tests (`claude-login-console.spec.ts`)

- About :218-225: the structure test now requires the script to start with
  `powershell -NoProfile -Command { $ErrorActionPreference = 'Stop'; Set-Location -LiteralPath ` and
  end with `auth login --claudeai; exit $LASTEXITCODE }`. The cwd literal still round-trips.
- About :227-239: new helper `powerShellCode`. It replaces each single-quoted literal (all four
  quote variants) with `''`, using the existing reference parser, so a test can check the
  structure of the code outside the literals.
- About :241-264: new `it.each` with two cases, `plain` and `injection`. The injection case's
  `canonicalDir` and command contain `' }; Remove-Item Env:PATH; & { '` and `'; Set-Location C:\; '`.
  Outside the literals, each case asserts that:
  - the script starts with the child-process prefix and its block closes only at the last
    character, with braces balanced;
  - `Set-Location`, `Remove-Item`, `$env:CLAUDE_CONFIG_DIR`, `$env:NO_PROXY` and
    `exit $LASTEXITCODE` all appear inside the child body;
  - `Remove-Item` and `Set-Location` each appear exactly once, so no injected copy escapes its
    literal.
- The existing tests still pass unchanged, including the posix tests (posix unchanged), the
  allowlist literal test, the round-trip test with awkward metacharacters, and the
  no-inherited-value test.
- No test runs PowerShell, conhost or claude. The tests only check strings.

## Rule 5: existing specs that pin `fallbackScript`

- `claude-login-console.spec.ts`: updated as described above.
- `provider-account-actions.service.spec.ts` (:89, :128, :172, :596): uses a `jest.fn()` fake that
  returns a fixture string. It does not depend on the script text and is unaffected.
- No ambient-path pin was touched.

## Checks

- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.lib.json`: no output (clean).
- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.spec.json`: no output (clean).
- `npx eslint` on both files: no output (clean).
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts/claude-login-console.spec.ts --maxWorkers=2`:
  1 suite passed, 21 of 21 tests passed.
- `ptah_get_diagnostics` (scoped to the 2 files): did not run. The tool reported "TypeScript
  diagnostics worker was terminated because another run on it timed out". The `tsc` runs above
  cover the same files.
- I did not run verify, build, install or any git command.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-login-console.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-login-console.spec.ts`
