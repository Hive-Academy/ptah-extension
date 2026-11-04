# Batch 2 report

## Task 2.1: Shared CLI login output

Completed. Moved ANSI stripping, HTTPS extraction, and bounded line splitting into a pure shared module. `httpsUrlCandidates` returns all trimmed candidates; `parseHttpsUrl` validates one candidate under a supplied limit. `extractHttpsUrl` guards the missing first candidate, then applies Kimi's original 2048-character limit and first-candidate behavior. Kimi's two call sites and existing `extractHttpsUrl('nothing here')` case remain. The Kimi production and spec edits are import moves plus removal of the moved definitions. The new spec covers first-candidate selection, invalid and oversized first candidates, no URL, multiple URLs, punctuation, parsing limits, ANSI removal, and line splitting.

Files written:

- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/cli-login-output.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/cli-login-output.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-login.service.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-login.service.spec.ts

## Task 2.2: Unclosed child ambient answer

Completed. The unclosed-receipt branch now reuses an earlier `connected` or `signed-out` status; an earlier `unknown` status becomes `unknown/timeout` with the earlier timestamp. The separate disposal behavior is unchanged. Added cases for earlier `unknown/unreadable` and `connected` results, and updated the existing repeated blocked-read test to assert timeout semantics.

Files written:

- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.spec.ts

## Risks

- Kimi behavior drift: preserved the original URL validation and line splitter logic, moved only imports in the Kimi spec, and added focused helper cases. Source inspection confirms Kimi's call sites are unchanged. No other auth-providers imports of the moved Kimi exports were found.
- No-URL line: `extractHttpsUrl` checks `first === undefined` before `parseHttpsUrl`; both the existing Kimi case and new helper case assert `undefined`.
- Earlier unknown result on unclosed child: the new test asserts `unknown/timeout` while preserving `checkedAt`; the connected case asserts identity reuse.
- Concurrent Batch 1: no shared-library files or Batch 1 files were modified.

## Verification

Command run once, foreground from worktree root: `npm run verify -- -p @ptah-extension/auth-providers 2>&1 | tail -40` with `pipefail`.

Header: `[verify 2026-11-03T15:40:52.452Z] lock slot 1 acquired after 78s: verify lint,test,typecheck (@ptah-extension/auth-providers)`.

Summary: `[verify 2026-11-03T15:40:55.932Z] lock released after 3.5s, exit code 1`.

Result: blocked before lint, tests, or typecheck. Nx reported `connect EPERM` on its daemon socket under `/tmp/.nx/1000/sockets` and denied plugin worker socket creation. The scoped `ptah_get_diagnostics` call also returned unavailable after its 45-second TypeScript timeout. No second verify run was made. Batch 2's green verification requirement remains unmet because of the sandbox socket failure.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep `extractHttpsUrl` first-candidate-only with a no-candidate guard | Search later candidates / preserve Kimi behavior | Plan Component 3 and decisions 40, 42; Kimi's original implementation and existing spec | Yes |
| Return timeout for earlier unknown results blocked by an unclosed child | Reuse unknown / return timeout | Plan Component 7, decision 20, AC 5.7 | Yes |
