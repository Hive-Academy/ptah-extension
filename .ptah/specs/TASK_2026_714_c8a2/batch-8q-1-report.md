# Batch 8q-1 report

## Changes

- 8q-1.1 — codex-read-only-command.ts:96,115,180: added an exact, case-insensitive PowerShell parameter grammar for Get-Content, Get-ChildItem, and Test-Path. Parameters are allowed once. TotalCount, Head, and First share one slot; integers match ^\d{1,6}$. The parser consumes values by grammar position and passes only path values to containment and realpath checks. -Path and positional paths reject *, ?, [, ]; -LiteralPath rejects * and ? while allowing literal brackets. Portable commands, Select-String, pipes, wrapper handling, and forbidden characters were left unchanged.
- 8q-1.2 — codex-chat-approval-sink.ts:69,118,148,155,159: every route to presentRequest emits one info line with the closed reason and only the three required non-null booleans. Non-command requests use not-command. Accepted requests retain the existing names-only log; accept and decline decisions are unchanged.

## Specs added or updated

- codex-read-only-command.spec.ts:15,35,69: "accepts bounded Windows PowerShell read %s with path values only" and "rejects unsafe Windows PowerShell parameter grammar %s". All new cases use the live Windows PowerShell -Command wrapper; existing rejection cases remain.
- codex-chat-approval-sink.spec.ts:99,121,146: "logs names-only %s reason on card fall-through" covers level-not-ask, not-command, details-gate, cwd-uri-invalid, and not-classified. "logs path-not-inside when a realpath escapes and never logs its path" covers path-not-inside. "accepts the live TotalCount wrapper against a real temporary README" checks real filesystem acceptance and the existing names-only accept log. Existing escape-path expectation was updated for the required new info log. Privacy assertions inspect serialized logger arguments for command text, path, and cwd.

## Head and First source

Retained -Head and -First. Microsoft Learn [Get-Content for Windows PowerShell 5.1](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/get-content?view=powershell-5.1), under -TotalCount, lists First and Head as aliases of TotalCount.

## Rejected parameters

- -Wait, -Stream, -Filter, -Include, -Exclude, -Credential, -ReadCount, -Delimiter, and -Encoding are absent from the Get-Content allowlist and rejected as unknown parameters.
- -Recurse, -Depth, and -Force are absent from the Get-ChildItem allowlist and rejected.
- Every other parameter or abbreviation, including -Tot, is rejected by exact matching. Duplicate parameters and duplicate TotalCount aliases are rejected. Invalid, missing, signed, or seven-digit integer values, extra paths, and wildcard paths are rejected.

## Scope and verification

The real temporary folder spec runs on Windows because the live wrapper and path classifier are Windows specific; it is skipped elsewhere. No other deviation. No verification, tests, lint, typecheck, Nx, or diagnostics ran. All four edited source/spec files and this report are UTF-8 without BOM.

## Absolute paths written

- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-read-only-command.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-read-only-command.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-approval-sink.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-approval-sink.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8q-1-report.md
