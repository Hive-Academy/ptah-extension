# Batch 8o-4: Manual read approvals

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-read-only-command.ts` (new pure classifier)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-read-only-command.spec.ts` (new parser cases)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-approval-sink.ts` (Manual-only accept before presentation)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-approval-sink.spec.ts` (outcome and card cases)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts` (live session permission level and host platform)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.spec.ts` (mid-session level change)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8o-4-report.md` (this report)

## Allowed commands and rationale

| Command | Platform | Justification |
| --- | --- | --- |
| `Get-Content` | Windows PowerShell | Reads a named file; only one plain path or `-LiteralPath` path is accepted. |
| `Get-ChildItem` | Windows PowerShell | Lists the cwd or one path; only a plain path or `-LiteralPath` path is accepted. |
| `Select-String` | Windows PowerShell | Searches file text; requires exactly `-Pattern VALUE -Path PATH`. |
| `Test-Path` | Windows PowerShell | Checks a named path; only one plain path or `-LiteralPath` path is accepted. |
| `rg` | Windows and POSIX | Searches or lists files; only `--files`, `-n`, `--line-number`, `-i`, `--ignore-case`, `-l`, and `--files-with-matches` are accepted. `--pre` and all other flags are rejected. |
| `ls` | Windows and POSIX | Lists the cwd or named paths; flags are rejected. On Windows this is the PowerShell `Get-ChildItem` alias. |
| `cat` | Windows and POSIX | Reads at least one named path; flags and stdin-only use are rejected. On Windows this is the PowerShell `Get-Content` alias. |

No other aliases or equivalents are accepted. In particular, `gc`, `gci`, `dir`, and `sls` are omitted to keep the reviewed set small and avoid alias-specific semantics.

## Accepted grammar and behavior

The classifier receives `command`, command `cwd`, authoritative thread `cwd`, and host `platform`; it performs no I/O. The app-server schema defines `CommandExecutionRequestApprovalParams.command` as string or null and `cwd` as path string or null. The bridge copies the request parameters into `CodexApprovalRequest.details`; the sink reads those two fields. An argv array has no schema-backed form here and is rejected. The only accepted wrapper is a Windows `powershell`/`powershell.exe`/`pwsh`/`pwsh.exe` invocation with required `-NoProfile` and optional `-NoLogo`, followed by `-Command` or `-c` and one simply quoted command string. Nested quoting in the wrapper is rejected.

A direct command is one or more whitespace-separated stages joined by single `|` tokens. Each stage begins with exactly one reviewed command name and uses the argument form in the table. A path may be simply quoted to contain spaces. No shell expansion, escape, interpolation, command substitution, statement separator, redirection, wildcard path, or unrecognized option is parsed. Absolute command and thread cwd values on a known platform are required. Paths are lexically resolved with the platform's path rules and must remain at or below the thread cwd; the sink repeats containment on real paths. The sink additionally requires the live session permission level `ask`, request kind `command`, ordinary command approval kind, and no network/environment/policy-amendment context. Its response is exactly `accept` for that one request; it never returns `acceptForSession` or writes an exec-policy amendment. It logs only command names. All other requests use the existing card path.

`CodexChatAdapter` owns this sink and is the consumer-chat adapter. Gateway and lane approvals do not go through its `buildSink`; this change does not apply to them. The callback reads `session.settings.permissionLevel` for each request, including changes made mid-session. D14's `untrusted` plus workspace-write profile is unchanged.

## Reject coverage

The parser spec `rejects %s` covers output/append/input/stderr/all-stream redirection, `;`, `&`, `&&`, `||`, `$()`, backticks, `@()`, script blocks, `$` and environment variables, unknown or empty pipe stages, `rg --pre`/`--pre-glob`, unreviewed PowerShell options, unknown commands, malformed quotes, POSIX shell escapes, Windows comma arrays, and delayed expansion. `rejects path outside cwd: %s` covers parent traversal, absolute paths outside cwd, home paths, UNC, drive-relative paths, PowerShell provider paths, and Windows rooted paths. `rejects missing cwd, unknown platform and argv arrays` covers absent/relative cwd, unknown platform, and unproved argv shape. `rejects unsupported wrapper %s` covers encoded/file/cmd wrappers and nested wrapper quotes. Positive parser cases cover each of the seven commands, POSIX variants, quoted paths, pipes, and supported PowerShell wrappers.

The sink spec `accepts one Manual read request without presentation and logs names only` checks plain `accept`, no card, and argument-free logging. `keeps the approval card for %s read requests` covers auto-edit, plan, and yolo. `shows the card for %s` covers a write command, fileChange, permissions, mcpElicitation, userInput, network and stdin approvals. `reads the current permission level for each request` and adapter spec `uses the live session permission level for chat read approvals` cover a level change after session creation.

## Threat notes

- Path containment now has lexical and realpath checks. A link or junction whose real target is outside the thread cwd goes to the card. A filesystem race remains between the check and execution; the executor sandbox remains the boundary for filesystem effects.
- Shell functions, aliases, command lookup, and executable replacement can change what a command name runs. The reviewed names assume the Codex shell environment and its sandbox; the PowerShell wrapper accepts only simple `-Command` forms.
- `rg` can load arguments from an ambient ripgrep configuration, including preprocessing flags. This lexical classifier cannot inspect that configuration; the executor sandbox remains the boundary for side effects.
- The parser rejects ambiguous shell syntax by default. This can produce a card for some harmless reads, including extra read-only flags and nested quoting.
- No tests, typecheck, lint, build, or other verification command was run, per batch instruction. An independent security review before commit remains with the coordinator.

## Decisions

- Followed P8 D20: Manual chat command approvals for this reviewed read-only set receive one plain `accept`; all other approvals retain the card path.
- Kept P8 D14 unchanged: Manual remains `untrusted` with workspace-write; no runtime/profile/MCP/frontend changes.
- Used agent-sdk codex-app-server because the bridge already carries the command string and cwd in `details`, and the chat sink has the live session permission level. No codex-runtime edit was needed.
- Rejected unsupported argv and shell forms instead of guessing their execution semantics.

## Fix round

The classifier now receives the command cwd and authoritative thread/profile cwd, checks both lexically, and returns path slots to the sink. The sink resolves the thread cwd, command cwd and every named path with `realpath` before answering plain `accept`. Unknown cwd, missing paths, failed resolution or any escaped real path use the card. `CodexChatAdapter` passes `prepared.profile.cwd` and types its live getter as `TrackedSession`, fixing TS2532/TS2339 without casts. The forbidden-character regex uses plain `^`, fixing the reported lint escape. No verification, tests, build, lint, typecheck, diagnostics, commit or push was run here.

| Finding | Change | Spec names |
| --- | --- | --- |
| F1, thread boundary | Command cwd and path slots must stay inside profile cwd. | `rejects a command cwd outside the thread cwd and paths escaping from a subdirectory`; `shows the card for outside thread cwd`; `accepts a command cwd below the profile cwd after realpath containment`; `shows the card when the profile cwd is unavailable`; `shows the card for missing command cwd`. |
| F2, symlinks and junctions | Realpath every target; failed lookup takes the card path. | `shows the card for file symlink escaping the profile cwd`; `shows the card for cwd junction escaping the profile cwd`; `shows the card when realpath cannot resolve an argument`. |
| F3, POSIX glob | Reject unquoted glob tokens and glob characters in `rg` pattern and path slots. | `rejects POSIX unquoted pattern glob`; `rejects POSIX unquoted path glob`; `rejects POSIX wildcard traversal`; `rejects rg pre-glob`. |
| F4, Windows devices | Reject reserved device names, extensions and trailing dots/spaces. | `rejects path outside cwd: Windows reserved CON`; `Windows reserved NUL extension`; `Windows reserved COM9`; `Windows reserved LPT1`; `Windows trailing dot`. |
| F5, Unicode and controls | Reject any command character outside printable ASCII. | `rejects Unicode dash`; `rejects Unicode quote`; `rejects NUL character`; `rejects CR character`; `rejects LF character`. |
| F6, quote parsing | Reject adjacent and joined quoted segments. | `rejects adjacent quote segments`; `rejects malformed quote`. |
| F7, command resolution | Require `-NoProfile` for PowerShell wrappers. Bare names can still be affected by PATH or shell aliases/functions; the executor sandbox remains the boundary. | `accepts quoted, piped or supported wrapper form`; `rejects unsupported wrapper powershell.exe -Command ...`. |
| F8, usability | Full-path PowerShell and bash wrappers, extra cmdlet forms and `ls -la` still show cards. | `rejects unsupported wrapper %s`; `rejects unreviewed Get-Content option`. |
| F9, spec gaps | Added explicit redirection, path, option, quoted-pipe and plan/yolo cases. | `rejects stderr merge redirection`; `rejects clobber redirection`; `rejects path outside cwd: POSIX double slash`; `Windows extended path`; `Windows device path`; `Windows ADS`; `Windows wildcard traversal`; `rejects PowerShell stop parsing`; `rejects rg follow link`; `rg follow long`; `rg zip`; `rg search zip`; `rg ignore file`; `rg pattern file`; `rg option after pattern`; `accepts quoted, piped or supported wrapper form`; `keeps the approval card for %s read requests`. |

The exact allowed commands remain `Get-Content`, `Get-ChildItem`, `Select-String`, `Test-Path` on Windows and `rg`, `ls`, `cat` on Windows/POSIX, with only the argument and option forms above. The parser rejects all redirection, shell interpolation, unsupported wrappers, argv arrays, ambiguous quotes, unsafe flags, unknown commands and unparseable paths. Only Manual (`ask`) consumer chat requests receive the one-request `accept`; gateway and lane sinks are separate. A missing named path now asks even for harmless `Test-Path`, and a link changed between approval and execution remains a time-of-check/time-of-use risk. An ambient `rg` configuration and command lookup are outside lexical validation.

## Verify fix

- Removed the two useless escapes before `[` in the read-only classifier regex character classes. The classes still match `*`, `?`, `[` and `]`.
- Replaced `setImmediate` waits in the symlink, junction and realpath-failure specs with a promise resolved by `presentation.present`. Each spec waits for the card, disposes the sink, then checks that the pending approval declines. This works with the suite's fake timers and exercises the catch-to-card path when realpath rejects.
- Corrected the missing-profile-cwd spec: passing `undefined` to `setup` selected its default `C:\\repo`; passing an empty cwd exercises the unavailable-cwd path. It also waits for presentation before disposal.
- Production fallback already catches realpath rejection and presents the card; no sink behavior or reject rule changed. No verification, tests, builds, lint, typecheck or diagnostics were run, as instructed.
