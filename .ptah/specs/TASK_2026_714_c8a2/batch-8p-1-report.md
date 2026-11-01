# Batch 8p-1 report

## Task 8p-1.1: Windows read-only command classifier

- `codex-read-only-command.ts:14-38`: `unwrap` recognizes an unquoted, double-quoted, or single-quoted PowerShell executable token, with optional `-NoProfile` and optional subsequent `-NoLogo`, followed only by `-Command` or `-c` and one quoted body. Bare `powershell`/`pwsh` names remain eligible. A full path is eligible only when its case-insensitive `path.win32.normalize` result equals the PowerShell executable under a supplied absolute drive-path SystemRoot. Missing, empty, or relative SystemRoot permits only bare names. Unsupported PowerShell wrappers fail closed. The original body tokenizer, allowlist, path containment, device-name, and glob rules are unchanged.
- `codex-read-only-command.ts:150-193`: optional `systemRoot` options flow through `classifyReadOnlyCommand`, `readOnlyCommandNames`, and `isReadOnlyCommand`. Non-Windows behavior is unchanged.
- `codex-read-only-command.spec.ts:13-93`: accepted cases added: the live executable with double-quoted, single-quoted, and unquoted tokens; doubled backslashes; lowercase and uppercase path and flag spelling; no profile flag; `-NoProfile`; `-NoProfile -NoLogo`; `-c` and `-Command`; single- and double-quoted bodies; bare `powershell` without `-NoProfile`; and a `..` executable segment that normalizes to the trusted file. The `..` spelling is intentionally accepted because it resolves to the same normalized path.
- Rejected cases added: the live `Get-Item ... ; Get-Content ... -Raw` multistatement body; an `if (Test-Path ...) {...}` body; a different drive; SysWOW64; a look-alike executable; an 8.3 directory alias; a full `pwsh` path; `-EncodedCommand`, `-ExecutionPolicy Bypass`, `-File`, `-NonInteractive`, and `-NoLogo` without `-NoProfile`; missing body; unquoted body; multiple bodies; a body path outside the thread cwd; and a full executable path with undefined, empty, or relative SystemRoot. The pre-existing nested-quote rejection spec remains.

## Task 8p-1.2: approval sink

- **A2-1**, `codex-chat-approval-sink.ts:119-126`: removed the proposed exec-policy amendment exclusion. The proposed amendment is ignored; an eligible reviewed read returns the plain string `accept` for this request only. Kind, Manual `ask`, network context, environment, and proposed network amendment gates remain. `codex-chat-approval-sink.spec.ts:104-124` exercises the live joined command with a proposed amendment, verifies plain `accept`, command-name-only logging, no card, and a second identical acceptance.
- **A2-2**, `codex-chat-approval-sink.ts:93,125`: appended injectable SystemRoot with `SystemRoot`/`windir` environment fallback and passed it to the classifier. The sole adapter construction site, `codex-chat-adapter.ts:433-470`, supplies the earlier positional arguments and needs no edit for this trailing default. The sink spec injects `C:\Windows` explicitly.
- **A2-3**, `codex-chat-approval-sink.ts:109-118`: converts `file:` cwd strings using `fileURLToPath` with Windows path semantics before lexical classification and realpath checks. Conversion failure shows the card, with a degradation-audit comment. `codex-chat-approval-sink.spec.ts:126-143` covers `file:///C:/Users/x/ws` and an invalid URI.
- **M4**, `codex-chat-approval-sink.ts:130-139`: removes the `seen` key when async evaluation returns without a card, including accepted and abort/dispose declines. The existing card settlement removes its key; the duplicate-request branch still retains the in-flight key. The live-flow spec calls the same request twice and expects both to be accepted.
- **M5**, `codex-chat-approval-sink.ts:251-276`: schedules the edit follow-up with `setImmediate`, after settling the decline. The async callback still catches delivery failures and reports through `failed()`. `codex-chat-approval-sink.spec.ts:389,520` advances fake timers before checking delivery and failure reporting, and checks that delivery has not started immediately after decline.
- Additional sink reject coverage at `codex-chat-approval-sink.spec.ts:162-163`: proposed network amendments and a non-null environment ID show the card.

No tests, lint, typecheck, build, diagnostics, or git commands were run, as required by this lane. The team leader must verify. Realpath containment remains subject to the previously documented time-of-check/time-of-use window between approval and command execution.

## Files modified

1. `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-read-only-command.ts`
2. `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-read-only-command.spec.ts`
3. `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-approval-sink.ts`
4. `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-approval-sink.spec.ts`
5. `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8p-1-report.md`
