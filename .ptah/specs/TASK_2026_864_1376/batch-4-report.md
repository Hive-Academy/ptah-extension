# Batch 4 report

## Files written

- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/codex-readiness.reader.ts` — lazy Codex binary selection and independent sign-in classification, 20-second deadline, 60-second successful cache, single-flight reads with one queued refresh, fixed-field logging.
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/auth-providers/src/lib/providers/codex/codex-readiness.reader.spec.ts` — fake-based behavioral tests.
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/.ptah/specs/TASK_2026_864_1376/batch-4-report.md` — this report.

## Tests

- Lazy bundled selection with signed-out auth; stale auth while binary remains found.
- Both explicitly empty-home forms preserve the found binary and return `unreadable/home`; an unreadable auth file returns `unreadable/auth-file`.
- Selector unavailable error becomes `missing`; other selector errors become `unknown/local`.
- Stalled sign-in reaches `timeout` while preserving the binary, and the next read probes again.
- Ordinary reads join; refreshes queue one follow-up; a completed result is cached.
- Each answer logs fixed fields without a binary path.

## Decisions

- The reader accepts a lazy `() => Promise<CodexSelection>` callback. This follows the plan's lazy snapshot requirement and the codex-runtime `CodexSelection` contract; Batch 5 can supply the host snapshot. Reversible by changing this constructor at integration.
- An explicitly empty home produces `unreadable/home` for onboarding while retaining the selected binary. The task description's AC 1.9 and plan Component 4 specify this. The separate lane detect result remains `installed:false` and is outside Batch 4. Reversible within this reader.
- Any fact timing out clears the completed cache. This prevents a later ordinary read from serving an older result after a timeout. Reversible within this reader.
- Each caller has a 20-second answer timer, including callers queued for refresh. A probe also has a 20-second timer and ignores late results. This applies decision row 21 and the Claude reader's bounded-read pattern. Reversible within this reader.

## Risks and unfinished work

- No Jest, Nx, or `npm run verify` command was run, as instructed. The orchestrator owns the scoped verification.
- `ptah_get_diagnostics` was called three times for both changed TypeScript files; each call reported the TypeScript compiler still running after 45 seconds and left both files unchecked. `ptah_ast_analyze` parsed both files with zero syntax errors.
- No index exports or other source files were changed. Batch 5 owns registration and exports.

## Fix round 1

- `codex-readiness.reader.ts`: annotated the sign-in callback with the auth service's promise return type or `CodexReadinessSignIn`, so TypeScript accepts both branches without changing behavior.
- `codex-readiness.reader.spec.ts`: loaded `reflect-metadata` before the runtime barrel import, matching sibling Codex specs and satisfying tsyringe at test startup.
- Verification commands were left to the orchestrator as requested.

## Fix round 2

- `codex-readiness.reader.ts`: gave the first sign-in `.then` an explicit resolved union type, `Awaited<ReturnType<ICodexAuthService['getSignInOutcome']>> | CodexReadinessSignIn`. This lets its object and promise branches share the intended result type without changing runtime behavior.
- Confirmed the following `.then(outcome => ...)` still uses `typeof outcome === 'string'` to distinguish the string and object branches without casts.
- Scoped `ptah_get_diagnostics` was unavailable because its TypeScript check was still running after 45 seconds; no compiler result was obtained. No Nx, npm, Jest, tsc, or git command was run.
