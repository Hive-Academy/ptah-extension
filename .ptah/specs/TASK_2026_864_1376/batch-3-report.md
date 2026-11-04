# Batch 3 report

## Task 3.1

- Added `isCodexHomeExplicitlyEmpty` beside `resolveCodexHome`. It detects an explicitly empty `CODEX_HOME`, or an empty `HOME` when `CODEX_HOME` and `USERPROFILE` are absent.
- Added `HomeAuthState.getSignInOutcome()`: one direct `auth.json` read per call, classification of pending rotated credentials, absent file, invalid/unreadable file, API key, absent token, stale token, and valid token. It does not mutate the existing token cache. Unexpected read errors log a fixed message with the error class only.
- Added `CodexAuthService.getSignInOutcome()` delegation.
- Added fixture cases for all five AC 1.12 outcomes, EACCES, ENOTDIR, pending rotation, explicit empty home, one read, unchanged `getTokenStatus`, and sanitized logging.
- Files modified:
  - `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts`

## Task 3.2

- Added `ICodexAuthService.getSignInOutcome`, `ICodexLoginService` (`start`, `cancel`, `isActive`, asynchronous `dispose`), and `ICodexReadinessReader.read` with shared contract types. Updated the full Codex auth mock.
- File modified: `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts`

## Risks and edge cases

- Missing `auth.json` and ENOTDIR map to `signed-out`; invalid JSON and EACCES map to `unreadable`. Pending rotated credentials take precedence while persistence is outstanding, matching the existing `readAuthFile` behavior.
- The outcome check bypasses the TTL cache and performs one read. Existing `getTokenStatus` code remains unchanged and fixtures assert its result.
- No CLI process is started and no `codex login` was run. No other lane's files were edited.

## Verification

- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.lib.json`: passed (exit 0) before the final pending rotation guard and test assertion. Those final edits are small and were not typechecked by this command.
- `ptah_get_diagnostics` after edits: unavailable; its TypeScript check exceeded the 45 second service timeout on both attempts.
- Nx and `npm run verify` were not run as instructed. The orchestrator will run scoped verify, including Jest specs.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Classify pending rotated auth when disk read fails | pending auth / unreadable | Existing `readAuthFile` returns pending credentials when `readAuthFileFromDisk` yields null; plan requires matching pending classification | Yes |
| Keep sign-in outcome separate from token-status cache | direct disk read / reuse cache | Plan requires one disk read and no cache mutation; `getTokenStatus` retains its existing behavior | Yes |

## Fix round 1

- Fixed `getSignInOutcome()` error-code detection to accept object-shaped errors regardless of the `Error` realm. ENOENT and ENOTDIR now return `signed-out`; EACCES still returns `unreadable`.
- Kept logs free of error messages and paths by logging only fixed `SystemError`, `SyntaxError`, or `Unknown` class labels.
- Added a regression table with cross-realm shaped ENOENT, ENOTDIR, and EACCES errors. Reviewed the Batch 3 additions; this was the only added `instanceof Error` plus `code` check. The similar check in the pre-existing `readAuthFile()` path was not part of Batch 3 and was left unchanged.
- Files modified in this round:
  - `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/.ptah/specs/TASK_2026_864_1376/batch-3-report.md`
- Verification: `ptah_get_diagnostics` was unavailable after its 45-second TypeScript timeout. Nx and `npm run verify` were not run as instructed; the orchestrator will rerun the scoped tests.
