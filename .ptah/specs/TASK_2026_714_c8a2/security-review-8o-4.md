# Security review 8o-4 (Codex Manual-mode read-only auto-accept)

Reviewer: Anthropic-family independent review. Scope: codex-read-only-command.ts (+spec), codex-chat-approval-sink.ts (+spec), codex-chat-adapter.ts (+spec). Static review only; nothing was run.

Score: 5/10. Verdict: NEEDS_REVISION.

The parser itself is a strong deny-by-default design. One gating gap (F1) lets a command run in an arbitrary directory be auto-accepted, which defeats the "inside the thread cwd" constraint of P8 D20.

## Findings

### 1. Blocking: the cwd boundary is the command's cwd, not the thread cwd
- File: codex-chat-approval-sink.ts:105-110 (`readOnlyCommandNames(details['command'], details['cwd'], ...)`); codex-chat-adapter.ts:464-465 passes no thread cwd.
- `details['cwd']` is the working directory Codex reports for that command. The model controls it (shell tool `workdir`). Nothing compares it with the thread/workspace cwd. `insideCwd` therefore only proves that the path is inside the command's own cwd.
- Bypass: command `cat id_rsa` with cwd `C:\Users\me\.ssh` (or `/home/me/.ssh`, `/etc`, `C:\Windows\System32\config`) is classified read-only and auto-accepted, and the content goes to the model. This is an out-of-cwd read. D20 requires rejecting "a path outside the thread cwd".
- Fix: pass the authoritative thread cwd (session/profile cwd that the adapter already knows) as a third argument. Require `details.cwd` to resolve inside or equal to the thread cwd (win32 case-insensitive, same drive and UNC rules). Run the path checks against the thread cwd as well. If the thread cwd is unknown, reject. Add specs: command cwd outside thread cwd -> card; command cwd a subdirectory -> accept.

### 2. Serious: symlinks and junctions are not resolved
- File: codex-read-only-command.ts:58-76 (lexical `path.resolve/relative` only).
- A repository can contain a symlink or junction (`link -> ~/.ssh`, `link -> C:\Users\me`). `cat link/id_rsa`, `rg token link`, `Get-ChildItem link` and `ls link` pass the lexical check and read outside cwd. Malicious or untrusted repos are the threat model for a coding agent, so this is a real exfiltration path, not just a theoretical one.
- Fix: the sink returns a Promise, so make the final decision async. `fs.realpath` each path argument that exists, and `realpath` the cwd. Re-run the containment check on the real path. If realpath fails for an existing path, reject. A nonexistent path needs no realpath, since its parent chain is checked. For `rg`/`ls`/`Get-ChildItem` with no path, the cwd itself is the target. A junction inside the tree that `-Recurse`-style traversal would follow is not reachable, because those flags are rejected. State the remaining TOCTOU window in the report.

### 3. Moderate: POSIX unquoted glob in the `rg` pattern slot
- File: codex-read-only-command.ts:94-97 (pattern is not checked), tokenizer 31-55.
- Only path slots reject `* ? [ ]`. The pattern slot does not. In bash/sh an unquoted `rg *.txt` is expanded by the shell, so a repo file named like `--pre=x.txt` becomes an option (`--pre` runs a program on every searched file). The `bash -lc` wrappers are currently rejected (name `bash` is not allowed), so this is latent, but the POSIX non-wrapped branch is accepted and the spec covers it (`rg TODO .` on linux).
- Fix: on non-win32, reject an unquoted token containing `* ? [ ]` anywhere (track "quoted" in the tokenizer), and also reject any glob-looking token in the rg pattern and path slots. On win32, PowerShell does not glob native-command arguments, so the issue does not apply there.

### 4. Moderate: Windows reserved device names are accepted as in-cwd files
- File: codex-read-only-command.ts:62-69.
- `cat CON`, `Get-Content NUL`, `Get-Content COM1`, `Get-Content AUX` resolve to devices in any directory. This gives a hang (denial of service for the turn) and, for serial or other devices, a read of non-file data. No write.
- Fix: on win32 reject any path segment whose base name (before the first dot) matches `/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i`. Also reject a trailing dot or space segment. On POSIX, optionally `lstat` to refuse FIFOs and devices (same async step as F2).

### 5. Moderate: Unicode quotes and dashes are not modelled
- File: codex-read-only-command.ts:12, 39, 111.
- PowerShell treats U+2018/2019/201C/201D as quotes and U+2013/2014/2015 as a parameter dash. The tokenizer sees them as ordinary characters. I found no escalation, because every dangerous metacharacter is rejected globally before tokenizing, and a one-token parameter on the four cmdlets cannot write or execute. It can still make PowerShell see a different argument structure than the one that was validated, for example a smart-quoted string that joins tokens, or `Get-Content -Wait` spelled with an en dash.
- Fix: deny-by-default. Reject any non-ASCII character (`/[^\x20-\x7e]/`) in the command, or at least U+2010-2015, U+2018-201F and U+00A0. Windows file names with non-ASCII characters then ask, which is acceptable. Add a spec.

### 6. Minor: doubled-quote escapes make the tokenizer and PowerShell disagree
- File: codex-read-only-command.ts:39-46. `'a''b'` is `a'b` in PowerShell but `ab` in the tokenizer (empty-string check only catches `''` at the start of a token). This only adds a character to a path component, so it cannot create traversal (I checked: it can only make PowerShell stricter). Reject two adjacent quote segments of the same kind for hygiene.

### 7. Minor: command resolution and profile
- `powershell -Command` is accepted without `-NoProfile` (codex-read-only-command.ts:16). A user profile can shadow `Get-Content`, `cat` or `ls`. It is the user's own profile, so the risk is low. Require `-NoProfile`, or document it.
- Bare `rg`/`ls`/`cat` resolve through PATH. If cwd is on PATH or a `cmd.exe` shell is used, a repo-local `rg.cmd` runs. Codex runs PowerShell, which does not search cwd, so it is low risk. Mention this in the report.

### 8. Minor: usability limits (safe, not defects)
- The quoted full-path `"C:\...\powershell.exe" -Command ...` and `/bin/bash -lc` shapes are rejected, so they always show the card. This is safe, but it may make the feature rarely fire on the real shapes. Confirm with research-8o-a-report.md what Codex actually sends. If an extra shape is added, use the same strict regex form.
- `-Path` for Get-Content/Get-ChildItem is rejected (only `-LiteralPath` or positional). `ls -la` is rejected.

### 9. Moderate: spec gaps (a permissive implementation would still pass these)
codex-read-only-command.spec.ts has no case for:
- `2>&1`, `>|` (partly covered by the global `>` check, but not asserted)
- `//server`, `\\?\`, `\\.\`
- alternate data streams `file:stream`
- wildcard escapes `..\*`, `*\..\`
- `%X%`, `$env:X` (only one `%` case exists)
- NUL, CR/LF
- Unicode quotes and dashes
- `--%`
- rg `-L`, `--follow`, `-z`, `--search-zip`, `--ignore-file`, `-f`
- an option placed after the pattern (`rg x --pre sh`), which is the case that proves `startsWith('-')` on the path slots
- a quoted pipe (`rg 'a|b' .`) as an accept case
- reserved device names
- the cwd-outside-thread-cwd case (F1)
- a symlink case (F2)

The sink spec does cover the gating: non-ask level, per-request level read, fileChange, permissions, MCP elicitation, user input, networkApproval and writeStdin all fall through to the card. Plan and yolo are not listed separately; add them. Add a spec that cwd missing in `details` produces a card.

## Verified sound (no finding)
- Forbidden characters `; & < > \` $ @ { } ( ) # % ^ ! CR LF NUL` are rejected anywhere in the string, before quote handling. This covers all redirection forms, `&&`, `||`, `$()`, `${}`, `@()`, `@{}`, script blocks, variables, here-strings, comments, `--%` (contains `%`) and the `.`/`&` call operators in first position (not an allowed name).
- The `rg` option allowlist is exactly `-n -i -l --files` and their long forms. `--pre`, `--pre-glob`, `-z`, `-L/--follow`, `--ignore-file`, `-f`, `-e` and `--` are all rejected, including after the pattern, because path slots reject a leading `-`.
- RIPGREP_CONFIG_PATH is not passed to the Codex child (codex-app-server-process.ts:164-179 whitelists PATH, PATHEXT, SYSTEMROOT, WINDIR, COMSPEC, LANG, LC_ALL, HOME, USERPROFILE, TMP, TEMP, TMPDIR, CODEX_HOME). A config file cannot add `--pre`, unless the user's Codex shell tool env policy re-adds it; I saw no such path.
- Path rules reject `..`, absolute paths outside the command cwd, UNC, `//`, `\\?\`, `\\.\`, `C:foo`, `~`, `:` (provider paths, ADS), wildcards, `,` (arrays on win32) and `-`.
- Wrappers: only `powershell|pwsh [-NoProfile|-NoLogo]* -Command|-c '<body>'` is unwrapped, and the body may not contain the outer quote. Everything else that starts with powershell/pwsh, cmd and bash is rejected. Argv arrays are rejected (typeof string).
- Gating: `permissionLevel` is read per request through `getSession()` (codex-chat-approval-sink.ts:104, codex-chat-adapter.ts:464). Only `request.kind === 'command'` with no network, environment or amendment details is accepted. The decision is a plain `'accept'`, never accept-for-session or an amendment. The log has command names only (:114-116). An unknown cwd or platform is rejected.

## Required before approval
Fix F1 (blocking). F2, F3, F5 and the F9 specs should land in the same revision. F4, F6 and F7 can follow.

## Re-review

Static read of the fix round (codex-read-only-command.ts, codex-chat-approval-sink.ts, codex-chat-adapter.ts and their specs). Nothing was run.

Verdict: APPROVED. Score 8/10. No blocking or serious findings remain. Two Minor items are listed below.

### Findings 1-9
- F1 (thread cwd): fixed. `classifyReadOnlyCommand` takes a separate `threadCwd`. It requires the command cwd to be within it (codex-read-only-command.ts:~117-128) and checks every path slot against the thread cwd (`insideCwd`, :73-91). The adapter passes `prepared.profile.cwd` (codex-chat-adapter.ts:276, :467-469). That is the same `profile.cwd` the app-server is spawned with (codex-app-server-process.ts:160). A missing `threadCwd` fails the `typeof` check, so the card is shown. Specs exist for the outside-thread-cwd case and for the unavailable profile cwd.
- F2 (symlinks): fixed. `acceptIfRealPathsStayInside` (codex-chat-approval-sink.ts:~129-146) takes the realpath of the thread cwd and then of the command cwd and every path slot, and re-checks containment with `pathWithin`. Any exception (missing path, EACCES, ELOOP) is caught and returns false, so the card is shown. Signal abort also returns false. A mismatch in how Windows or macOS spell a canonical path fails closed. A TOCTOU window remains between realpath and execution. It is recorded in the report and is not closable in an approval sink.
- F3: fixed. Unquoted `* ? [ ]` tokens are rejected on POSIX (:59), and the rg pattern slot rejects glob characters even when quoted (:95).
- F4: fixed. Reserved device names (with an extension) and trailing dots or spaces are rejected (:78-80).
- F5: fixed. `forbidden` now starts with `[^\x20-\x7e]`, so any non-printable-ASCII character, including CR, LF, NUL and Unicode quotes or dashes, is rejected.
- F6: fixed. A quote after token content, a second quote segment, or a non-delimiter after the closing quote returns undefined (:43, :52).
- F7: `-NoProfile` is now required. The PATH/alias residual is recorded.
- F8: recorded as a usability limit.
- F9: fixed. The spec list now covers the previously missing cases (Unicode, device names, globs, symlink/junction, realpath failure, plan/yolo). I did not execute the specs.

### New-bypass check
- The realpath step shows no bypass. Fallback is always `presentRequest`, so a failed or aborted lookup shows the card. The `seen` key is added before the async step, so a duplicate request is declined rather than double-handled. `disposed` and `signal.aborted` are rechecked after the await.
- A quoted `|` is now a literal and not a pipe separator (`token.quoted`). This is correct, and the same quoted-token handling applies to the `'|'` command-name case.
- Directory arguments (`ls .`, `rg TODO .`) are resolved to the directory itself. rg and ls do not follow links found inside it, because `-L` and `-Recurse` are rejected. Symlinks inside the tree are therefore listed or skipped, not traversed.
- No other new gaps were found. The command-cwd check is stricter than before.

### Remaining findings
1. Minor: the thread cwd is whatever `profile.cwd` is. If a user opens a chat at a very broad directory (home or a drive root), "inside the thread cwd" is equally broad. Consider rejecting auto-accept when `threadCwd` is a filesystem root or the home directory. This is a product decision, so it is not blocking. (codex-chat-adapter.ts:276)
2. Minor: `Test-Path` on a missing path now shows the card (the realpath fails). This is safe, and the report records it.
