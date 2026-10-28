# P3 fix report — main chat, findings 4, 6 and 7 (TASK_2026_719_4f64)

Verdict: all three findings are fixed with tests. The scoped checks pass. No type in auth-providers or shared changed.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.cli-notice.spec.ts` (this is the builder spec that already drives the real `stderr` callback)

## Finding 4: certify and run in the project directory

- `session-query-executor.service.ts:709`: `NamedAccountQueryAdmission.bootstrap(queryFn, selection, workingDirectory, resumeSessionId?, forkSession)` now takes the project directory as a required argument.
- `:719`: the directory goes into the `admitClaudeRoute` request as `workingDirectory`. This happens before certification, so `provider-account.service.ts:132` certifies the project directory, and its policy scan and launch `cwd` cover that directory. The admission request type already had the field, so no type changed.
- `:735`: if the returned certified launch has `launch.cwd !== workingDirectory`, the run is refused with `identity-unproved`. The refusal comes before any boundary check or child. The final query already uses `launch.cwd` (builder `:1161`), and the existing final `assertCertifiedLaunch` pins it. Only the request was changed; the final options were not patched.
- `:1031-1035`: the executor passes `sessionConfig.projectPath`. A missing or blank project path is refused with `conflict` before admission. That is the same code the admission port returns for a malformed request.
- Tests (`session-query-executor.accounts.spec.ts`, describe "named main chat certifies and runs in the session project directory"). Both directories come from `os.tmpdir()`, and the project directory differs from the account directory:
  - The test asserts that the admission request carries `workingDirectory` equal to the project directory. It also asserts that `certifiedLaunch.cwd`, the launch passed to both boundary checks (the certified policy scan) and the final query options `cwd` all equal the project directory.
  - A launch certified for the account directory is refused with `identity-unproved`. No `invokeNamedQuery` call or boundary check happens, and the reservation is released once.
  - A fixture change supports these tests: `projectDir` and `certifiedCwd` settings, and `bootstrap` now passes the project directory. The existing cases still use `/certified-workspace` and behave as before.
  - An executor-level test covers a missing project path (below).

## Finding 6: named stderr carries no CLI text

- `sdk-query-options-builder.ts:1458-1474`: on a named route, `stderr` logs only fixed text. An `[ERROR]` chunk logs `warn('[SdkQueryOptionsBuilder] Named account child reported an error diagnostic.')`; any other chunk logs a fixed `debug` line. On this path nothing is interpolated, nothing is parsed by MCP back-off and no notice reaches `mcpStatus.notifyAll`. The notice would have carried the raw chunk over RPC. This matches the lane's named-child handler in `claude-sdk-lane-options.ts:150-154`.
- The ambient callback body is unchanged and only sits in the other arm of the ternary.
- Prettier: running `prettier --write` on this file also re-wrapped four hunks from earlier batches (around `:951`, `:963`, `:1151`, `:1749`). The changes are whitespace only, and the file at HEAD was already not prettier-clean.
- Tests (`sdk-query-options-builder.cli-notice.spec.ts`, describe "named account stderr is never echoed"):
  - A named build receives adversarial chunks: a credentials path, an email, an org ID, an `sk-ant-oat01-…` token, the connectors notice and an MCP server name. None of them appears in any info, warn, error or debug call. No notice is published, `checkStderrForFailure` is not called, only the fixed lines are written, and there are no error-level lines.
  - Ambient pin: the old interpolated `error` line still appears and back-off is still called.
- Executor side ("during failed admission"), `session-query-executor.accounts.spec.ts`, describe "named admission failure logs only fixed text": failures injected at `admit`, `bootstrap-identity`, `final-identity` and `attach` throw provider text. The test asserts that this text, plus a path, an email, an org ID and a token, appears in no logger call and not in the returned refusal.
- The existing ambient builder specs pass unchanged. One harness default in `cli-notice.spec.ts` changed: `getSupportedModels` now resolves `[]`, which the named build needs. Ambient builds never call it.

## Finding 7: missing ports refuse `unavailable-storage`

- `session-query-executor.service.ts:1029`: a missing `accountAdmission` or `accountPersistence` now refuses `unavailable-storage`. Before, it refused `release-held`. `release-held` is still used for real lifecycle and settlement cases (`wait` abort/timeout, init stream end or overflow, failed attach, `namedRefusalCode` fallback).
- Tests (describe "SessionQueryExecutor named run without account ports") build a real `SessionQueryExecutor` from injected fakes:
  - Three cases: admission missing, persistence missing, both missing. Each rejects with `unavailable-storage`. None calls `admitClaudeRoute`, `getQueryFunction`, `build`, `invokeNamedQuery` or `invokeWithLoadedQuery`, and the registry entry is removed once.
  - A named run with no project path is refused `conflict` without admission.

## Specs that mock or pin the changed members (rule 5)

- `NamedAccountQueryAdmission.bootstrap`: only `session-query-executor.accounts.spec.ts`, whose fixture I updated.
- The builder `stderr` callback: `sdk-query-options-builder.cli-notice.spec.ts`. Its ambient pins are unchanged and pass.
- The named branch of `executeQuery`: no other spec has a named selection. The executor specs `service`, `harness-preflight`, `idle-signals`, `input-channel-failure` and `slash-persistence` are ambient and pass unchanged.

## Checks

- `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.lib.json`: no output (pass).
- `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.spec.json`: no output (pass).
- `npx eslint` on the 4 files: 0 errors. There are 2 `max-lines` warnings; both files were already over the limit.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers --maxWorkers=2`: 120 suites passed and 1 skipped; 2621 tests passed and 1 skipped.
- After the prettier run, `jest … sdk-query-options-builder --maxWorkers=2`: 9 suites and 197 tests passed.
- Not run (rule 12): `npm run verify`, builds, git.

## Decisions

- **Missing project path on a named run → `conflict`.** The other option was to omit `workingDirectory`, which is the bug. `conflict` is what the admission port returns for a malformed request (`provider-account.service.ts:111`), and the ambient builder throws on a missing `projectPath` anyway. Reversible.
- **Named stderr also skips the MCP back-off parse and the connectors notice.** Both read raw CLI text, and the notice sends that text over RPC (rule 11). A certified named route has no third-party auth source, so the notice cannot apply to it. The cost is that MCP back-off is not recorded from a named child's stderr. Reversible.
- **Certified `launch.cwd` must equal the requested directory (refuse `identity-unproved`).** This is defence in depth, so the account directory can never be accepted without anyone noticing. Reversible.

## Out-of-scope observations

- None.
