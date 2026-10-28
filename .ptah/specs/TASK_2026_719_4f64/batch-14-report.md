# Backend implementation — `TASK_2026_719_4f64`, batch 14

**Tasks completed**: Task 14.1 (optional selection reader and Claude lane precedence in `AgentProcessManager`).

**Files** (2, both M, nothing else touched):

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts`

The working tree also shows changes in `agent-sdk/src/lib/sdk-agent-adapter.ts` and in `rpc-handlers` `chat-session.service.ts` and `chat-slash-command-router.service.ts`. Those belong to the other developer, and I did not touch them.

## Changes (file:line)

`agent-process-manager.service.ts`:

- `:11` imports `randomUUID` from `node:crypto`. Agent-sdk mints ids the same way: `session-query-executor.service.ts:24,714`.
- `:14-17` adds `import type { ClaudeAccountAdmissionRequest, ClaudeAccountSelectionReader }` from `@ptah-extension/auth-providers-tokens`.
- `:46` adds the type import `ProviderAccountSelection` from `@ptah-extension/shared`.
- `:167` `AgentContinueErrorCode` gains `'account_refused'` (plan:844). It is only a union member. B16 does the mapping.
- `:182` `SdkSpawnOptions.accountAdmission?: ClaudeAccountAdmissionRequest`.
- `:375-378` adds a trailing constructor parameter: `@inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_SELECTION_READER, { isOptional: true }) private readonly accountSelections?: ClaudeAccountSelectionReader`. The existing `AUTH_PROVIDERS_TOKENS` import from `@ptah-extension/auth-providers` re-exports the tokens package object (`auth-providers/src/lib/di/tokens.ts`). B8 registered the token at `auth-providers/src/lib/di/register.ts:213`.
- `:461-465` in `doSpawn`, the admission is resolved after `validateWorkingDirectory` and before `runHarnessPreflight`. A refused route therefore leaves no preflight side effects. `:479` forwards it to `doSpawnSdk`.
- `:500-551` adds a new `laneAccountAdmission(request, cli, workingDirectory)`:
  - `cli !== 'claude'` returns `undefined`.
  - Explicit `named` produces the admission.
  - Explicit `ambient` returns `undefined`.
  - Omitted or `{kind:'omitted'}` calls `readStoredSelection(this.spawnEnvironment.workspaceRoot(), 'lane')`. A non-null `profileId` becomes `{kind:'named', profileId}`; `null` is ambient.
  - No reader means ambient.
  - A reader rejection logs a warning carrying only the error class name and throws `new LaneAccountResumeError('unavailable-storage')`. The lane never falls back to ambient.
  - It returns `{ provider:'claude', scope:'lane', selection, operationId: randomUUID(), runId: randomUUID(), workingDirectory }`.
- `:801-805` `runSdk` receives `accountAdmission` only when it is set, through a conditional spread. Non-Claude option objects are byte-for-byte unchanged.

`agent-process-manager.account-binding.spec.ts`:

- `:13` adds `import type { ClaudeAccountSelectionReader }`. `:16` adds the import of `LaneAccountResumeError`. `reflect-metadata` is still imported first (`:1`).
- `:121-125` `harness()` gains an optional third parameter `accountSelections`. `:158` passes it as the 15th constructor argument, after three `undefined`s for the existing optional parameters. Existing callers are unchanged.
- `:625-716` adds the describe block "Claude lane account selection precedence", 9 tests:
  - explicit named → admission with `workingDirectory: ROOT`, and the reader is not called;
  - explicit ambient → no admission, and the reader is not called;
  - omitted (`undefined` and `{kind:'omitted'}`) → `readStoredSelection(ROOT,'lane')` and a named admission;
  - stored `profileId: null` → ambient;
  - no reader → ambient;
  - reader error → `LaneAccountResumeError` with `code:'unavailable-storage'`, the message contains no reader text, and there is no `runSdk`, no preflight and no tracked agent;
  - omitted resume → reader not called and no admission;
  - non-Claude (`copilot`) with a named selection → no `accountAdmission` key and the reader is not called.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Trailing optional `@inject(...SDK_PROVIDER_ACCOUNT_SELECTION_READER, { isOptional: true })` | service `:375-378` |
| Explicit named → admission request with `workingDirectory` | service `:513-514,543-550`; test "admits an explicit named selection…" |
| Explicit ambient → today's path | service `:513` (selection stays undefined); test "keeps an explicit ambient…" |
| Omitted → `readStoredSelection(workspaceRoot, 'lane')` | service `:515-525`; `it.each` "reads the stored lane selection…" |
| No reader → ambient | service `:515` guard; test "stays ambient when the host has no selection reader" |
| Reader error → `unavailable-storage` | service `:526-533`; test "refuses unavailable-storage…" |
| Non-Claude CLIs unchanged | service `:512`, `:803`; test "leaves non-Claude CLIs unchanged" |
| 7 other `new AgentProcessManager(` specs pass unchanged | `guard`, `restore`, `service`, `wait`, `workspace-scope` specs, `limits/owner-lifecycle.integration.spec.ts`, `wiring/sdk-callbacks.spec.ts`: all pass, none edited |
| Module boundary | `cli-agent-runtime` (`scope:extension`, `type:feature`) already imports `@ptah-extension/auth-providers-tokens` (`scope:extension`, `type:core`) in 9 source files, e.g. `claude-cli.adapter.ts:11` and `di/register.ts:66`. It is declared in `cli-agent-runtime/package.json:27`. ESLint reports no boundary error. |

## Specs that mock or pin changed members (rule 5)

- I changed the constructor by adding an optional trailing parameter. These specs construct the manager and were left unedited: `agent-process-manager.guard.spec.ts`, `.restore.spec.ts`, `.service.spec.ts`, `.wait.spec.ts`, `.workspace-scope.spec.ts`, `limits/owner-lifecycle.integration.spec.ts`, `wiring/sdk-callbacks.spec.ts`.
- `doSpawn` and `doSpawnSdk` are private. No spec mocks them.
- The ambient-path pins are unchanged. Every pre-existing test in the edited spec passes as written.
- DI guard: `di/register.agent-process-manager.smoke.spec.ts` ran inside the `src/lib/di` path and passed. I did not run the Electron smoke, because it belongs to the team-leader's verify (N = 2).

## Decisions

- **Resume with an omitted selection does not read the stored workspace selection.**
  - Options: (a) skip the read; (b) read and admit.
  - Evidence: `agent-spawn-args.schema.ts:53` says "a resumed lane keeps the account stored with its session; omit accountSelection when resuming". The resume gate already restores the session's bound reference. Under (b), the adapter's `prepareNamed` would refuse every legacy ambient session once a named lane selection is stored, because the lookup is not `bound`.
  - An explicit named selection on resume is still forwarded, so B16 can forward named resumes.
  - Reversible: one condition at service `:515`.
- **Reader-error refusal type is `LaneAccountResumeError('unavailable-storage')`.** Plan:848 says B16 maps `instanceof LaneAccountResumeError` to `account_refused`. That class already sanitizes its code. Reversible.
- **Ids:** `operationId` and `runId` are fresh `randomUUID()` values. The adapter replaces `runId` with the stored binding's `runId` on resume (`claude-cli.adapter.ts:327`).

## Verification

- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json`: no output (clean).
- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.spec.json`: no output (clean).
- `npx eslint` on the 2 files: 0 errors and 6 warnings. All 6 predate this batch:
  - `max-lines`, because the file was already over 700 lines;
  - `no-empty-function` at service `:2350`, which is not my code;
  - 4 `no-non-null-assertion` at spec `:264,280,296,324`, in pre-existing tests.
- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents libs/backend/cli-agent-runtime/src/lib/di --maxWorkers=2`: Test Suites 63 passed / 63; Tests 1736 passed / 1736. The first run had 1 failure in my new non-Claude test, because the harness lacks `resolveLaneBudgets` for codex. I switched that test to `copilot` and re-ran clean.
- `npx jest ... src/lib/wiring/sdk-callbacks.spec.ts --maxWorkers=2`: 17/17 passed. It is the seventh constructor spec and sits outside the path filter.
- Not run, per the rules: `npm run verify`, build, the Electron smoke, and `ptah_get_diagnostics`. The two scoped `tsc` runs cover the diagnostics for these files.

## Risks handled

- No `process.cwd()`. No `jest.spyOn` on module namespaces: the reader is an injected fake. No real CLI is spawned. No git state change.
- No path or reader text reaches logs or errors. The test pins this with a reader message that contains a path.

**Plan deviations**: none.

**Out-of-scope observations**: The account-binding spec harness has no `resolveLaneBudgets`, so a codex spawn cannot run through it. I did not change that, because a copilot spawn covers the non-Claude path.
