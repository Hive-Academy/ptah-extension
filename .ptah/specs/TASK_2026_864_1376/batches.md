# Batches - TASK_2026_864_1376

Total tasks: 43 | Batches: 23 | Complete: 23/23

Worktree (every path below is inside it; lanes use it as `workingDirectory`):
`/home/amun/ptah-extension/.claude-worktrees/provider-readiness` (branch `feat/provider-readiness`).
Below, `W` = that absolute path. Plan line numbers refer to `implementation-plan.md` on disk.

Rules every executor prompt must repeat (CLAUDE.md, decisions rows 13, 34, 40):

- Verify only with the batch's `npm run verify -- -p <projects>` from `W`, run once in the
  foreground with output filtered (`| tail -40`). Never workspace-wide, never `nx run-many`,
  never build / serve / dev / e2e / package targets, never a dev server under the verify lock.
- No test, lane or agent runs a real `codex login` (R1-8). Parser and lifecycle tests use
  synthetic fake-spawner transcripts.
- Kimi's URL extraction behaviour does not change (`extractHttpsUrl` stays first candidate,
  2048 chars, `undefined` on a no-URL line; plan Component 3, decision rows 40, 42).
- Electron first. The renderer is `apps/ptah-extension-webview`. Keep `platform-cli`,
  `cli-engine` and the provider CLI lanes working (CLI runner path unchanged, decision 13).
- Executors never run git and never edit `batches.md` or `task.md`. The team-leader commits.
- Commits follow `W/.commitlintrc.json`: subject <= 72 chars, body lines <= 100, scopes from
  its enum (e.g. `shared`, `auth-providers`, `rpc-handlers`, `electron`, `webview`).

## Plan validation

Status: PASSED WITH RISKS

Gate 2 passed by user decision (decisions rows 42-43); the phase A code-logic review must
also check the two orchestrator text fixes (Batch 2 `extractHttpsUrl` no-URL path, Batch 10
AC 3.11 step 4).

Assumptions:

- Shared contract changes in Component 1 are additive (new optional fields, new methods,
  new push), so existing `auth:codexLogin` callers keep compiling until they are replaced -
  unverified; checked by the typechecks in Batches 6, 7, 12 and the final check.
- `host-source-registry.contract.spec.ts` baseline stays frozen (Kimi methods are not in it
  either) - verified in plan Component 1; re-checked by Batch 1's verify.
- `ICodexAuthService` fakes outside auth-providers are `as unknown as` casts or `Pick<>`
  (verified: `auth-rpc.handlers*.spec.ts`, `codex-account-usage.service.spec.ts`); the only
  full `jest.Mocked<ICodexAuthService>` is `oauth-proxy.strategy.spec.ts:90`, edited in Task 3.2.
- New `AuthRpcHandlers` injections are optional and appended so
  `auth-rpc.handlers.key-hint.spec.ts:169-198`, `delete-stored-key` and `check-connection`
  specs type-check without edits - unverified; checked in Task 7.1.
- Codex CLI output shape (A-1) comes from `codex login --help` and binary strings only; real
  browser behaviour is checked only in the human Electron manual check (Component 15).
- Task 1 (TASK_2026_863_3855, branch `feat/onboarding-workflow-layout`) does not edit
  `onboarding-home.component.ts` - stated by the orchestrator; Batch 22 re-checks with
  `git diff main...<task-1 head> -- <home path>` before it starts. At decomposition time that
  branch has no commits ahead of `main`.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Deleting `claude-readiness.store.ts` / `claude-readiness-banner.component.ts` while Home (Batch 22, last) still imports them breaks onboarding typecheck and tests in Batches 17-21 | HIGH | Deletions moved from plan batch F to Batch 22 (Task 22.2); Batches 17-21 leave those files untouched |
| `ReadyStripComponent` input rename (`claude` -> `connection`) breaks the Home template binding (`onboarding-home.component.ts:80`) until Batch 22 | HIGH | Task 18.2 adds `connection` and keeps `claude` as an optional input for Home only; Task 22.2 removes `claude` and its spec cases. Only file shared by two batches; recorded under Decisions |
| Removing `AuthStateService.codexLogin()` breaks `chat-view.component.ts:346` | HIGH | Removal and the chat-view switch are in the same batch (Batch 15) |
| `activateConnection` result type change and the `defaultMainConnectionTarget` move break `main-agent-reassign-popover.component.ts:634,358-363` | HIGH | Core change and popover edit in the same batch (Batch 16) |
| `ProvidersConnectionSetupService` hook type `refreshAuthStatus(): Promise<boolean>` needs `AuthStateService` to return boolean first | MEDIUM | Batch 15 before Batch 16 |
| Index-file ownership: `codex/index.ts`, `auth-providers/src/index.ts`, `core/src/index.ts`, `chat/src/index.ts` would be edited by several batches | MEDIUM | Each index file is owned by exactly one batch (5, 5, 13, 14) placed after the files it exports exist |
| Cancel reported as success (R1-4); cancel in the same tick as pid resolution | HIGH | Tasks 5.1 and 7.1 carry the R1-4 race tests; Task 13.2 the renderer race cases |
| Orphan `codex login` child on quit (R1-5) | HIGH | Batch 9 (required `QuitSequenceDeps.codexSignIn`, deferred quit, 2 s budget); Task 5.1 `dispose()` settles exactly one `cancelled` |
| Second browser tab on Linux / unvalidated URL opened (R1-1..R1-3) | HIGH | Task 5.1: `BROWSER` no-op on non-darwin/win32, `validateSignInUrl` at parse and before open; macOS/Windows duplicate tab accepted (decision 35) |
| Kimi behaviour drift from the helper move | MEDIUM | Task 2.1: new `cli-login-output.spec.ts` pins Kimi behaviour; Kimi spec cases unchanged, import line only |
| Codex CLI output leaks into the webview or logs (decision 17) | HIGH | Tasks 5.1 / 7.1 assert no output line in pushes or logs; Task 13.1 drops host `error` text |
| Batch 22 blocked by Task 1 not yet merged | MEDIUM | Batches 1-21 do not depend on it; Batch 22 waits. History rule: rebase on `main` only before the first push; if the branch is already pushed, merge `main` instead (CLAUDE.md forbids force pushes) |
| Two root readiness stores probe at once between Batch 17 and Batch 22 (Home still on the old store) | LOW | Intermediate only, never pushed; Batch 22 removes the old store |
| di-lint on push (new `@inject` tokens) | MEDIUM | Task 8.1 registers every new token in `codex-login-composition.ts`; `expected-resolvable.ts` updated |

Edge cases:

- No-URL line: `extractHttpsUrl` returns `undefined` without calling `parseHttpsUrl` - Task 2.1
- 2049 / 4096 chars accepted for Codex, 4097 rejected; valid URL after an invalid one on the same line - Task 2.1
- Earlier `unknown/unreadable` + unclosed child -> `unknown/timeout`; earlier `connected` -> `connected` (AC 5.7) - Task 2.2
- `ENOENT`/`ENOTDIR` -> signed-out; `EACCES`, invalid JSON -> unreadable; pending rotation classified (AC 1.11-1.13) - Task 3.1
- Explicitly empty Codex home (`CODEX_HOME=''`, or `HOME=''` with no `USERPROFILE`) -> not installed, no sign-in button (AC 1.9) - Tasks 3.1, 4.1, 11.1, 19.2
- Sign-in deadline -> `timeout`, not `signed-out`; timeouts not cached (AC 1.10) - Task 4.1
- `dispose()` during `starting` never spawns; `dispose()` resolves when `killTree` rejects - Task 5.1
- `openExternal` returns false or throws -> `browserOpened:false`, attempt keeps running - Task 5.1
- Bundled-only on Windows or a path with `"` -> no-command sentence (D-14) - Task 13.1 (relabelled from 12.3 at Batch 12 verify: `codexTerminalLoginCommand` lives in 13.1)
- Neither service nor runner -> `success:false`, no `openTerminal` (D-4) - Task 7.1
- Unknown `trigger` values dropped at the boundary - Tasks 6.1, 6.2
- Renderer RPC timeout counts as a timeout outcome (D-11) - Tasks 12.1, 12.2
- Stale `attemptId` dropped; final state sticky; late `running` after `cancelled` stays cancelled - Task 13.1/13.2
- 20 s "nothing seen" timer cleared on any accepted change, final state and `DestroyRef` - Task 13.2
- Old onboarding record with only `claudeAt` stays valid (AC 4.6) - Tasks 17.3, 20.3
- Not chosen provider never sets `need` / never shows a warning tone (AC 4.1, 4.4, decision 4) - Tasks 18.1, 18.2
- Fresh install, neither ready: preselect the saved connection, no automatic switch (decision 5) - Task 19.1
- VS Code renders nothing and reads nothing (AC 6.2) - Tasks 12.2, 17.2, 22.1

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Split plan batches A-H into 22 batches of at most 6 created/edited files and 2 projects | keep plan's 8 large batches / split | team-leader batch cap; plan batch C alone is 18 files | yes |
| Old store and old banner deletions move from plan batch F to Batch 22 | delete in F / delete with Home | `onboarding-home.component.ts:28-29,67,112,326` import them; Home is edited last | yes |
| `ready-strip.component.ts` (+spec) edited in Batch 18 and Batch 22 (temporary optional `claude` input for Home) | strip in F only (breaks Home specs until G) / strip in G only (stage 1 and 2 cannot bind it) / two-step | strip bound by `ready-settings-step.page.ts:86`, `ready-claude-step.page.ts:125`, `onboarding-home.component.ts:80`; Home must wait for Task 1 | yes; the shim lives only between Batch 18 and Batch 22 and never ships |
| `codexLogin()` removal paired with `chat-view.component.ts`; `activateConnection` change paired with the popover | per-lib batches / coupled batches | callers at `chat-view.component.ts:346`, `main-agent-reassign-popover.component.ts:634` | yes |
| New rpc test fakes go in a sibling `W/libs/backend/rpc-handlers/src/test-utils/codex-fakes.ts` | extend `kimi-code-fakes.ts` / sibling | plan Component 5 allows either; sibling leaves Kimi files untouched | yes |
| Renderer wiring and visual fixtures (plan H, fixtures half) run before Home (Batch 21 before 22) | after G / before G | user constraint: Home runs last; fixtures do not import Home code; e2e runs only in the visual review after Batch 22 | yes |
| Phases: A host (1-11), B renderer core and chat (12-16), C onboarding (17-22) | one phase / three | review scope stays reviewable; each phase ends at a green scoped check | yes |

## Executor and review families

- Every batch recommends `CLI lane`; the orchestrator picks the live lane at spawn time and
  records the implementer family on the batch header (`Implementer family: <family>`).
- Phase code-logic review family must differ from every implementer family recorded in that
  phase. Simplest: keep each phase's implementers in one family and pick the reviewer from
  another. If an in-process subagent implemented, the reviewer must still be another family,
  or the phase summary records the exception and the weaker-evidence label.
- Visual review (phase C) runs in Electron only, dark + light, by the visual-reviewer subagent
  (Subagent reason: rendered Electron screenshots, not a lane capability).

---

# Phase A - Host sign-in and readiness

## Batch 1: Shared contracts — COMPLETE (commit 13642d64f)

- Implementer family: codex (CLI lane)
- Verification: `npm run verify -- -p @ptah-extension/shared` run by the orchestrator from the
  worktree (lane sandbox blocked Nx sockets, EPERM) — NX 3 tasks: 3 succeeded

- Recommended executor: CLI lane [TypeScript backend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: one library, type-only edits; every later batch depends on it
- Tasks: 1 | Depends on: none
- Phase: A | Phase review: due after Batch 11 (code-logic + style, new public RPC API)
- Scoped check: `npm run verify -- -p @ptah-extension/shared`

### Task 1.1: Add the Codex readiness, sign-in and push contracts — COMPLETE

- Files: `W/libs/shared/src/lib/types/rpc/rpc-auth.types.ts`, `W/libs/shared/src/lib/types/rpc.types.ts`,
  `W/libs/shared/src/lib/types/messages/message-constants.ts`, `W/libs/shared/src/lib/types/messages/payload-map.ts`,
  `W/libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts` (all MODIFY)
- Plan reference: implementation-plan.md:192-248; Revision 1 R1-4 (`success` rule), R1-1 (`browserOpened`)
- Pattern to follow: Kimi login types in `rpc-auth.types.ts` and the `auth:kimiCodeLogin*` entries in `rpc.types.ts`
- Quality requirements: additive only (new optional params `mode`, `restart`; response gains `state`);
  `auth:codexLoginCancel`, `auth:getCodexReadiness`, `AUTH_CODEX_LOGIN_STATUS` push and payload map entry;
  `trigger` literal union `'mount'|'follow-up'|'recheck'` on the ambient status params
- Validation notes: `host-source-registry.contract.spec.ts` must pass unchanged (frozen baseline)
- Implementation details: types and constants only, no runtime code beyond the constant value

### Batch 1 verification

- Every listed artifact exists and contains the required work
- `npm run verify -- -p @ptah-extension/shared` passes (output tailed)
- No per-batch review; phase A review covers it

## Batch 2: Shared login-output helpers, Kimi import move, ambient fix — COMPLETE (commit 8b5b51c84)

- Implementer family: codex (CLI lane)
- Verification: `npm run verify -- -p @ptah-extension/auth-providers` run by the orchestrator from
  the worktree (lane sandbox blocked Nx sockets, EPERM). Typecheck and test passed. Lint had one
  error, `@nx/dependency-checks` (persistence-sqlite unused, package.json 9:5). It is pre-existing
  and also on main (decisions.md row 46). The team-leader re-ran lint: the 10 warnings are all
  outside the Batch 2 files.
- Team-leader diff review: the Kimi diff only moves imports and definitions. `extractHttpsUrl`
  matches the old code, including the no-URL path (`first === undefined` guard). There are no
  other importers of the moved exports, and no stub or TODO markers.

- Recommended executor: CLI lane [TypeScript backend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: one library; the helper move and the independent AC 5.7 fix are both small and file-disjoint from the Codex services
- Tasks: 2 | Depends on: none (may run in parallel with Batch 1)
- Phase: A | Phase review: covered by phase A review
- Scoped check: `npm run verify -- -p @ptah-extension/auth-providers`

### Task 2.1: Extract `cli-login-output.ts` and keep Kimi unchanged — COMPLETE

- Files: CREATE `W/libs/backend/auth-providers/src/lib/providers/cli-login-output.ts`,
  `W/libs/backend/auth-providers/src/lib/providers/cli-login-output.spec.ts`;
  MODIFY `W/libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-login.service.ts` (import moved helpers),
  `W/libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-login.service.spec.ts` (import path only)
- Plan reference: implementation-plan.md:365-375 (helper move), 1478-1494 (round 2 fix 2), decisions rows 40, 42
- Pattern to follow: `kimi-code-login.service.ts:390-454` (code moved verbatim)
- Quality requirements: `httpsUrlCandidates(line)` (all matches, trailing punctuation trimmed),
  `parseHttpsUrl(candidate, maxLength)`, `extractHttpsUrl(line)` = first candidate, 2048, returns
  `undefined` when there is no first candidate (never calls `parseHttpsUrl(undefined)`); `stripAnsi`, `LineSplitter` moved
- Validation notes: Kimi spec cases unchanged (`kimi-code-login.service.spec.ts:307-325`); new spec pins Kimi's
  first-candidate and 2048 behaviour, the no-URL line, and multi-URL lines
- Implementation details: pure module, no DI; `extractUserCode` stays in Kimi

### Task 2.2: Unclosed-child ambient answer (AC 5.7) — COMPLETE

- Files: MODIFY `W/libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts`,
  `W/libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.spec.ts`
- Plan reference: implementation-plan.md:636-653; decision row 20
- Pattern to follow: existing receipt handling `claude-ambient-login-status.ts:179-182,251-253`
- Quality requirements: earlier result reused only if `connected`/`signed-out`, else `unknown/timeout`
- Validation notes: existing cases stay green; two new cases from the plan
- Implementation details: narrow change to the unclosed-receipt branch

### Batch 2 verification

- Artifacts exist; Kimi diff is import lines only (`git diff` on the two Kimi files)
- `npm run verify -- -p @ptah-extension/auth-providers` passes

## Batch 3: Codex sign-in outcome and service interfaces — COMPLETE (commit f852b2785)

- Implementer family: codex (CLI lane), including fix round 1 (cross-realm `instanceof Error`
  check at `codex-home-auth.service.ts:563` replaced by an object-shaped `code` check, plus a
  regression table for ENOENT, ENOTDIR and EACCES).
- Verification: `npm run verify -- -p @ptah-extension/auth-providers` run by the orchestrator after
  the fix round: test 2583 passed / 13 skipped / 0 failed, typecheck passed. Lint had the
  pre-existing `@nx/dependency-checks` error only (decisions.md row 46). The team-leader ran eslint
  on the five Batch 3 files: 0 errors and 0 warnings, so none of the 10 project warnings is in them.
- Team-leader diff review: no stub or TODO markers. The only log line is a fixed text with an error
  class label (`SystemError`/`SyntaxError`/`Unknown`); there is no path, message or token. The
  outcome read bypasses the cache and does not mutate it. The return type is
  `Exclude<CodexSignInOutcome,'timeout'>`, without the plan's `| 'unreadable-home'`. Shared
  `CodexSignInOutcome` has no such member, and the plan puts empty-home detection in the reader
  (Component 4: `isCodexHomeExplicitlyEmpty` -> `unreadable/home`). That is Batch 4's job, so
  this is accepted. The rpc-handlers fakes are `Pick`/`unknown` casts and need no edit.

- Recommended executor: CLI lane [TypeScript backend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: owns `codex-provider.types.ts` (all three interface changes) so later batches never touch it
- Tasks: 2 | Depends on: Batch 1
- Phase: A | Phase review: covered by phase A review
- Scoped check: `npm run verify -- -p @ptah-extension/auth-providers`

### Task 3.1: `getSignInOutcome` and `isCodexHomeExplicitlyEmpty` — COMPLETE

- Files: MODIFY `W/libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts`,
  `W/libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts`,
  `W/libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts`,
  `W/libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.spec.ts` (mock gains the method)
- Plan reference: implementation-plan.md:249-278
- Pattern to follow: `readAuthFile` classification `codex-home-auth.service.ts:785-815`; `resolveCodexHome`
- Quality requirements: one disk read, no cache mutation, never throws, fixed log text with error class only
- Validation notes: five AC 1.12 cases; `getTokenStatus` unchanged for the same fixtures (AC 1.13)
- Implementation details: `CodexAuthService.getSignInOutcome()` delegates; the helper is exported from the file (index export in Batch 5)

### Task 3.2: Add `ICodexLoginService`, `ICodexReadinessReader` and the new `ICodexAuthService` method — COMPLETE

- Depends on: Task 3.1
- File: MODIFY `W/libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts`
- Plan reference: implementation-plan.md:279-300 (login service API), 439-460 (reader API)
- Pattern to follow: Kimi login service interface in `kimi-code/` types
- Quality requirements: interface signatures exactly as the plan states; types from `@ptah-extension/shared`
- Validation notes: `codex-account-usage.service.spec.ts:196` is a cast and needs no edit
- Implementation details: type-only

### Batch 3 verification

- Artifacts exist; `npm run verify -- -p @ptah-extension/auth-providers` passes

## Batch 4: CodexReadinessReader — COMPLETE (commit c90cb3356; lint fix 297faedac)

- Recommended executor: CLI lane [TypeScript backend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: two new files, no shared files; can run in parallel with Batch 5's spec drafting only after Batch 3
- Tasks: 1 | Depends on: Batch 3
- Phase: A | Phase review: covered by phase A review
- Scoped check: `npm run verify -- -p @ptah-extension/auth-providers`

### Task 4.1: Implement the reader — COMPLETE

- Files: CREATE `W/libs/backend/auth-providers/src/lib/providers/codex/codex-readiness.reader.ts`,
  `W/libs/backend/auth-providers/src/lib/providers/codex/codex-readiness.reader.spec.ts`
- Plan reference: implementation-plan.md:439-471; decision row 21 (20 s host deadline)
- Pattern to follow: `claude-ambient-login-status.ts` (join, queue, deadline, no-cache-on-timeout)
- Quality requirements: selection snapshot resolved lazily; deadline -> `timeout` not `signed-out`;
  binary unavailable -> missing; explicitly empty home -> not installed; log line has no path
- Validation notes: AC 1.9 (host half), AC 1.10; timeout not cached
- Implementation details: not exported yet (Batch 5 owns the index files)

### Batch 4 verification

- Artifacts exist; `npm run verify -- -p @ptah-extension/auth-providers` passes
- Result: 3/3 after fix round 2 (round 1 left TS2345 at reader.ts:110; decisions row 53)
- Lint fix committed separately as 297faedac: `persistence-sqlite` removed from
  auth-providers/package.json (decisions row 49; no runtime or packaging change)

## Batch 5: CodexLoginService and auth-providers exports — COMPLETE (commit 59cb885d3)

- Implementer family: codex (CLI lane); one fix round (batch-5-fix-1-report.md)
- Verification: `npm run verify -- -p @ptah-extension/auth-providers` run by the orchestrator after
  fix 1 — 3/3 tasks succeeded (decisions row 55)

- Recommended executor: CLI lane [TypeScript backend implementation, child-process lifecycle]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: the riskiest host unit, kept alone with the two index files it needs
- Tasks: 2 | Depends on: Batches 2, 3, 4
- Phase: A | Phase review: covered by phase A review
- Scoped check: `npm run verify -- -p @ptah-extension/auth-providers`

### Task 5.1: Implement `CodexLoginService` — COMPLETE

- Files: CREATE `W/libs/backend/auth-providers/src/lib/providers/codex/codex-login.service.ts`,
  `W/libs/backend/auth-providers/src/lib/providers/codex/codex-login.service.spec.ts`
- Plan reference: implementation-plan.md:279-438; Revision 1 R1-1, R1-2, R1-3, R1-4, R1-5 (`dispose`); decisions 12, 16, 17, 27-31, 35
- Pattern to follow: `kimi-code/kimi-code-login.service.ts:99-135` (fixed argv via `IProcessSpawner`, `IUserInteraction.openExternal`, cancel)
- Quality requirements: argv `<selected path> login` or `login --device-auth`; no silent retry on another binary;
  `BROWSER` set to first existing `/usr/bin/true`/`/bin/true` on non-darwin/win32; `validateSignInUrl`
  (https, no userinfo, <= 4096) at parse and before open; `extractSignInUrl` = first valid candidate;
  open once, `browserOpened` true/false, throw -> false and attempt continues; no output line in any state or log
- Validation notes: R1-4 race tests (cancel same tick as pid -> `cancelled`); `dispose()` during `starting` never spawns,
  resolves when `killTree` rejects, settles exactly one `cancelled`; fake-spawner transcripts only (R1-8)
- Implementation details: imports `httpsUrlCandidates`, `parseHttpsUrl`, `stripAnsi`, `LineSplitter` from `../cli-login-output`

### Task 5.2: Export the new symbols — COMPLETE

- Depends on: Task 5.1
- Files: MODIFY `W/libs/backend/auth-providers/src/lib/providers/codex/index.ts`, `W/libs/backend/auth-providers/src/index.ts`
- Plan reference: implementation-plan.md:432-438, 468-471, 249-278 (helper export)
- Pattern to follow: existing Kimi exports in `src/index.ts`
- Quality requirements: export `CodexLoginService`, `CodexReadinessReader`, `isCodexHomeExplicitlyEmpty`, the two interfaces
- Implementation details: export lines only

### Batch 5 verification

- Artifacts exist; grep confirms no `codex login` spawn outside fakes in specs
- `npm run verify -- -p @ptah-extension/auth-providers` passes

## Batch 6: Tokens, readiness RPC method, ambient trigger — COMPLETE (commit 7f9cb5ced)

- Implementer family: codex (CLI lane)
- Verification: local `rpc-handlers` check showed only the 2 known manifest spec failures (decisions row 63), closed by Batch 7; CI verifies (decisions row 65)

- Recommended executor: CLI lane [TypeScript backend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: two projects, six files; leaves the auth handler files to Batch 7
- Tasks: 2 | Depends on: Batches 1, 5
- Phase: A | Phase review: covered by phase A review
- Scoped check: `npm run verify -- -p @ptah-extension/auth-providers-tokens,@ptah-extension/rpc-handlers`

### Task 6.1: Tokens and `auth:getCodexReadiness` method — COMPLETE

- Files: MODIFY `W/libs/backend/auth-providers-tokens/src/lib/tokens.ts`;
  CREATE `W/libs/backend/rpc-handlers/src/lib/handlers/auth/codex-readiness-method.ts`,
  `W/libs/backend/rpc-handlers/src/lib/handlers/auth/codex-readiness-method.spec.ts`
- Plan reference: implementation-plan.md:472-545 (tokens, `codex-readiness-method.ts`)
- Pattern to follow: `auth/kimi-code-login-methods.ts:53-91`
- Quality requirements: `SDK_CODEX_LOGIN`, `SDK_CODEX_READINESS` via `Symbol.for`; `refresh` boolean, unknown `trigger` dropped;
  absent reader -> `{binary:{state:'unknown',reason:'local'}, signIn:{outcome:'unreadable'}, ...}`
- Implementation details: registered by `AuthRpcHandlers` in Batch 7

### Task 6.2: Ambient status `trigger` param and readiness log (AC 5.8) — COMPLETE

- Files: MODIFY `W/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts`,
  `W/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts`,
  `W/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:472-545 (schema `:127-129`, handler `:391-404`)
- Quality requirements: `trigger: z.enum(['mount','follow-up','recheck']).optional()`; log `[readiness] claude {state, reason, trigger}` with no path
- Validation notes: strict schema accepts `trigger`, rejects other keys as today

### Batch 6 verification

- Artifacts exist; scoped check passes

## Batch 7: Auth RPC sign-in and cancel wiring — COMPLETE (commit 44db6eec9)

- Implementer family: codex (CLI lane)
- Verification: local check not run; verified by CI (decisions row 65); registers `auth:getCodexReadiness` and `auth:codexLoginCancel` in METHODS, closing the Batch 6 manifest failures

- Recommended executor: CLI lane [TypeScript backend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: one project; the honest `auth:codexLogin` (decision 7) and its spec in one place
- Tasks: 1 | Depends on: Batch 6
- Phase: A | Phase review: covered by phase A review
- Scoped check: `npm run verify -- -p @ptah-extension/rpc-handlers`

### Task 7.1: Wire `CodexLoginService` into `auth:codexLogin` and add `auth:codexLoginCancel` — COMPLETE

- Files: MODIFY `W/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts`,
  `W/libs/backend/rpc-handlers/src/lib/handlers/auth/interactive-login-methods.ts`,
  `W/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts`;
  CREATE `W/libs/backend/rpc-handlers/src/test-utils/codex-fakes.ts`
- Plan reference: implementation-plan.md:472-545; Revision 1 R1-4; decisions 13, 15, 24, 30
- Pattern to follow: `auth/kimi-code-login-methods.ts:53-139`; optional injection `auth-rpc.handlers.ts:152-162`
- Quality requirements: order service -> runner (unchanged `:213-243`) -> fixed failure with no `openTerminal`;
  response mapping per R1-4; push `AUTH_CODEX_LOGIN_STATUS` best effort; `succeeded` keeps clearCache/reset/invalidate;
  `{ cancelled: codexLogin?.cancel() ?? false }`; no output, path or token in any new log line
- Validation notes: cancel-during-start and cancel-same-tick (real `CodexLoginService`, fake spawner) cases; old optimistic
  success expectation replaced; key-hint / delete-stored-key / check-connection specs compile unedited (appended optional deps)
- Implementation details: `createFakeCodexLogin()`, `createFakeCodexReadiness()` in the new fakes file; add both methods to `METHODS` and the debug list

### Batch 7 verification

- Artifacts exist; `npm run verify -- -p @ptah-extension/rpc-handlers` passes; `platform-cli`/`cli-engine` runner path untouched (diff check)
- rpc-handlers manifest specs (rpc-allowlist.spec.ts, host-profile/manifest.spec.ts) must pass — closes the decision 52 gap

## Batch 8: Electron DI composition — COMPLETE (commit 314dfe114)

- Recommended executor: CLI lane [TypeScript backend implementation, DI]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: one project; registration only, quit hook left to Batch 9
- Tasks: 1 | Depends on: Batches 5, 6, 7
- Phase: A | Phase review: covered by phase A review
- Scoped check: `npm run verify -- -p ptah-electron`

### Task 8.1: Register the Codex login and readiness services in Electron only — COMPLETE

- Files: CREATE `W/apps/ptah-electron/src/di/codex-login-composition.ts`, `W/apps/ptah-electron/src/di/codex-login-composition.spec.ts`;
  MODIFY `W/apps/ptah-electron/src/di/phase-2-libraries.ts`, `W/apps/ptah-electron/src/di/expected-resolvable.ts`,
  `W/apps/ptah-electron/src/replay/scenario-sanitizer.ts`
- Plan reference: implementation-plan.md:546-635; decision 14
- Pattern to follow: `di/codex-binding-registry.ts:5-24`; snapshot registration `bootstrap.ts:590-622`
- Quality requirements: selection snapshot resolved lazily; the composition keeps the created instance and exposes
  `{ isActive(): boolean; stop(): Promise<void> }` (`created?.isActive() ?? false`, `created?.dispose() ?? Promise.resolve()`)
- Validation notes: every new `@inject` token registered (di-lint on push); sanitizer drops Codex sign-in payload text

### Batch 8 verification

- Artifacts exist; `npm run verify -- -p ptah-electron` passes
- Result: team-leader diff review — only the 5 listed files changed; no new `@inject`; both new tokens
  (`SDK_CODEX_LOGIN`, `SDK_CODEX_READINESS`) are in `EXPECTED_RESOLVABLE_TOKENS`; no stub/TODO markers.
  Scoped check NOT run locally (user decision, decisions row 65); CI on PR #916 is the gate.
  Lane diagnostics timed out (no compiler result). Committed 314dfe114 (hooks passed).

## Batch 9: Electron quit cleanup — COMPLETE (commit bbe593ffa)

- Recommended executor: CLI lane [TypeScript backend implementation, process lifecycle]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: one project, the LIFO quit contract files only
- Tasks: 1 | Depends on: Batch 8
- Phase: A | Phase review: covered by phase A review
- Scoped check: `npm run verify -- -p ptah-electron`

### Task 9.1: Required `QuitSequenceDeps.codexSignIn` — COMPLETE

- Files: MODIFY `W/apps/ptah-electron/src/activation/shutdown.ts`, `W/apps/ptah-electron/src/activation/shutdown.spec.ts`,
  `W/apps/ptah-electron/src/main.ts` (the one `codexSignIn` line), `W/apps/ptah-electron/src/main.quit-path.spec.ts`
- Plan reference: implementation-plan.md:546-635 (quit cleanup); Revision 1 R1-5; decision 31
- Pattern to follow: `killRunningChecks()` in `shutdown.ts:143-196,498-507`; `handleWillQuit` `shutdown.ts:609-660`; `main.ts:457-498`
- Quality requirements: active sign-in defers the quit; `stop()` runs beside `killRunningChecks()` under a 2 s budget; awaited
- Validation notes: `main.quit-path.spec.ts:253-370` gains the inactive fake only; its assertions unchanged

### Batch 9 verification

- Artifacts exist; `npm run verify -- -p ptah-electron` passes
- Result: team-leader diff review — only the 4 listed files changed; `main.ts` diff is the one import
  plus the one `codexSignIn: codexSignInQuitHandle` line; stop starts after `killRunningChecks()`
  under `CODEX_SIGN_IN_STOP_BUDGET_MS` (2000). Scoped check NOT run locally (user decision, row 65);
  CI on PR #916 is the gate. Committed bbe593ffa (hooks passed).

## Batch 10: AC 3.11 host routing spec — COMPLETE (commit 23a6a34ec)

- Recommended executor: CLI lane [test authoring]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (senior-tester)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: tests existing host behaviour in `chat/session/`, disjoint from Batch 7's `handlers/`
- Tasks: 1 | Depends on: Batch 1 (may run in parallel with Batches 2-9)
- Phase: A | Phase review: covered by phase A review
- Scoped check: `npm run verify -- -p @ptah-extension/rpc-handlers`

### Task 10.1: Four-step connection-switch spec — COMPLETE

- File: CREATE `W/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.connection-switch.spec.ts`
- Plan reference: implementation-plan.md:1296-1331; decisions 32, 37, 38, 41, 42
- Pattern to follow: harness in `chat-session.native.spec.ts:414-446,576-627`
- Quality requirements: real `ConnectionSettingsMethods` and `ChatRuntimeProfileService({nativeCodex:true})`;
  `it.each` over `global` (reset once) and `workspace` (`applyWorkspaceAuthChange` with path)
- Validation notes: step 3 starts `codex-app-server` / `openai-codex`, `claude-sdk` count stays 1; step 4 continuing the
  pre-switch session returns `AUTH_REQUIRED` naming the stored provider and `resumeSession` is not called.
  If a step fails against current host code, report it; do not change production code in this batch

### Batch 10 verification

- Artifact exists; scoped check passes
- Accepted: lint and typecheck pass; tests 5844 passed, 2 failed — both the manifest owner invariant for
  auth:codexLoginCancel / auth:getCodexReadiness from Batch 1 registry entries, closed by Batch 7 (decision 52);
  the new connection-switch spec passes

## Batch 11: AC 1.9 lane empty-home cases — COMPLETE (commit e3d5fa6d9)

- Verification: `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/cli-engine`
  run by the orchestrator: 5/6 targets passed. cli-agent-runtime:test had 1 failure in
  `lane-terminal-outcomes.integration.spec.ts:220` (not touched by this branch); re-run alone it
  passed 16/16, a load flake (decisions.md rows 50-51). Batch 11 specs pass.
- Team-leader diff review: test-only; existing cases unchanged; adapter harness gained an optional
  `homeResolver` (defaults to the previous `async () => home`); composition cases use a fake
  `CodexSelectionSnapshotPort` and dispose their child container.

- Recommended executor: CLI lane [test authoring]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (senior-tester)
- Subagent reason: N/A
- Review family: different from implementer (phase A review)
- Rationale: two spec files, two projects, existing behaviour; independent of all other batches
- Tasks: 1 | Depends on: none (may run in parallel)
- Phase: A (last batch) | Phase review: code-logic + style over the phase A diff once Batches 1-11 are committed
- Phase A review: DUE (Batches 1-11 all committed) — range 13642d64f^..bbe593ffa, phase A commits only:
  13642d64f (1), 8b5b51c84 (2), f852b2785 (3), c90cb3356 + 297faedac (4), 59cb885d3 (5),
  7f9cb5ced (6), 44db6eec9 (7), 314dfe114 (8), bbe593ffa (9), 23a6a34ec (10), e3d5fa6d9 (11).
  Focus per decision 67: Batches 5-9 (sign-in service, RPC, DI, quit); also the two orchestrator
  text fixes (Batch 2 no-URL path, Batch 10 step 4). Reviewer family not codex.
- Scoped check: `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/cli-engine`

### Task 11.1: Add explicitly-empty-home cases — COMPLETE

- Files: MODIFY `W/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts`,
  `W/libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.spec.ts`
- Plan reference: implementation-plan.md:1332-1348; decision 33
- Pattern to follow: detect cases `codex-app-server-lane.adapter.spec.ts:850-882`; `codex-lane-runtime-composition.spec.ts:8-23`
- Quality requirements: `detect()` exactly `{cli:'codex', installed:false, messagingMode}`; `logger.warn` "Codex home is empty";
  `runtime.open` not called; `it.each` over `{CODEX_HOME:''}` and `{HOME:''}`; non-empty `HOME` stays installed
- Validation notes: existing cases not edited; test-only

### Batch 11 verification

- Artifacts exist; header shows "Running target ... for 2 projects"; scoped check passes

---

# Phase B - Renderer core and chat

## Batch 12: Core readiness reads and connection target — COMPLETE (commit 167f08f3a)

- Recommended executor: CLI lane [Angular signals frontend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review)
- Rationale: one project, three file pairs with no consumers yet
- Tasks: 3 | Depends on: Batch 1 (may run in parallel with phase A)
- Phase: B | Phase review: due after Batch 16 (code-logic + style, new public core/chat exports)
- Scoped check: `npm run verify -- -p @ptah-extension/core`

### Task 12.1: `ClaudeAmbientStatusService` trigger and `transportTimeout` — COMPLETE

- Files: MODIFY `W/libs/frontend/core/src/lib/services/claude-ambient-status.service.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:654-744; D-11
- Quality requirements: `transportTimeout` when the error starts with `'RPC timeout:'`; `FAILED` keeps `localFailure:true`

### Task 12.2: `CodexReadinessService` — COMPLETE

- Files: CREATE `W/libs/frontend/core/src/lib/services/codex-readiness.service.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:654-744; D-10 (25 s RPC timeout)
- Pattern to follow: `claude-ambient-status.service.ts:10-125`
- Quality requirements: inert unless `VSCodeService.isElectron`; latest reply wins; every field validated against shared literals

### Task 12.3: `main-connection-target.ts` — COMPLETE

- Files: CREATE `W/libs/frontend/core/src/lib/services/main-connection-target.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:654-744; D-12
- Pattern to follow: popover rule `main-agent-reassign-popover.component.ts:341,358-363,382` (moved verbatim in Batch 16)
- Quality requirements: `defaultMainConnectionTarget`, `mainConnectionTargetWritable`, `sessionsEndedCopy`

### Batch 12 verification

- Artifacts exist; `npm run verify -- -p @ptah-extension/core` passes

## Batch 13: Core sign-in state, commands, exports — COMPLETE (commit 5e7dcd641)

- Recommended executor: CLI lane [Angular signals frontend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review)
- Rationale: one project; owns `core/src/index.ts` for every new core symbol
- Tasks: 3 | Depends on: Batch 12
- Phase: B | Phase review: covered by phase B review
- Scoped check: `npm run verify -- -p @ptah-extension/core`

### Task 13.1: `codex-login.ts` and `codex-commands.ts` — COMPLETE

- Files: CREATE `W/libs/frontend/core/src/lib/services/codex-login.ts` (+ `.spec.ts`), `W/libs/frontend/core/src/lib/services/codex-commands.ts`
- Plan reference: implementation-plan.md:654-744; D-14; design-spec.md 5.4
- Pattern to follow: `kimi-code-login.ts:1-80`; `claude-code-commands.ts`
- Quality requirements: https-only URL, enum checks, host `error` text dropped; same `attemptId`, sticky final, rank order;
  `codexTerminalLoginCommand` POSIX quoted path + ` login`, `null` on Windows or a path containing `"`

### Task 13.2: `CodexSignInService` — COMPLETE

- Depends on: Task 13.1
- Files: CREATE `W/libs/frontend/core/src/lib/services/codex-sign-in.service.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:654-744; R1-4; decision 10
- Quality requirements: response `state` goes through parse + accept like a push; `success` never read alone; no-state
  `success:false` -> local `failed`; `cancelled` -> state 9; one 20 s timer with release on `DestroyRef`; `succeeded` calls
  `authState.refreshAuthStatus()`; 15 s RPC timeout; inert outside Electron
- Validation notes: the four R1-4 race cases, fake timers

### Task 13.3: Export new core symbols — COMPLETE

- Depends on: Tasks 12.x, 13.1, 13.2
- File: MODIFY `W/libs/frontend/core/src/index.ts`
- Quality requirements: exports for Batch 12 and 13 symbols

### Batch 13 verification

- Artifacts exist; `npm run verify -- -p @ptah-extension/core` passes
- Result: 3/3 first run; index.ts exports the Batch 12 and 13 symbols only

## Batch 14: Chat sign-in block and credentials tab — COMPLETE (commit f351d3b46)

- Implementer family: codex (CLI lane)
- Verification: `npm run verify -- -p @ptah-extension/chat` run by the orchestrator — lint and
  typecheck pass; tests 5818 passed + 1 load timeout in `chat-transcript.change-set.spec.ts`
  (file untouched by this task; passes alone 3/3) — accepted as a known flake (decisions row 57)

- Recommended executor: CLI lane [Angular signals frontend implementation, accessibility]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review)
- Rationale: one project; owns `chat/src/index.ts`
- Tasks: 2 | Depends on: Batch 13
- Phase: B | Phase review: covered by phase B review
- Scoped check: `npm run verify -- -p @ptah-extension/chat`

### Task 14.1: `CodexSignInBlockComponent` — COMPLETE

- Files: CREATE `W/libs/frontend/chat/src/lib/settings/providers/connection-drawer/codex-sign-in-block.component.ts` (+ `.spec.ts`);
  MODIFY `W/libs/frontend/chat/src/index.ts`
- Plan reference: implementation-plan.md:982-1030; design-spec.md 5.5; prototype `W/.ptah/specs/TASK_2026_864_1376/prototype/stage1-signin.html`
- Pattern to follow: `kimi-code-login-progress.component.ts:36-80`
- Quality requirements: states 1, 1b, 2, 3, 4, 4b, 5, 6, 8, 9, 10; browser claim only when `browserOpened` is true/false;
  `role="alert"` only for chosen failures; device code spelled for screen readers; reduced motion; https-only link

### Task 14.2: Credentials tab Codex case — COMPLETE

- Files: MODIFY `W/libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:982-1030 (`:180-212`)
- Pattern to follow: Kimi `sign-in` / `sign-in-cancel` `credentials-tab.component.ts:203-212`
- Quality requirements: compact block, "Sign in with Codex", cancel while running

### Batch 14 verification

- Artifacts exist; `npm run verify -- -p @ptah-extension/chat` passes

## Batch 15: Auth refresh result and chat re-auth — COMPLETE (commit 8453e5162)

- Implementer family: codex (CLI lane)
- Verification: local check not run; verified by CI (decisions row 65); `chat-view.component.html` is an approved scope extension (decisions row 61); `codexLogin()` removed with no remaining caller in libs/apps

- Recommended executor: CLI lane [Angular signals frontend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review)
- Rationale: `codexLogin()` removal and its only caller change together, so chat never fails to compile
- Tasks: 2 | Depends on: Batch 14
- Phase: B | Phase review: covered by phase B review
- Scoped check: `npm run verify -- -p @ptah-extension/core,@ptah-extension/chat`

### Task 15.1: `refreshAuthStatus(): Promise<boolean>`; remove `codexLogin()` — COMPLETE

- Files: MODIFY `W/libs/frontend/core/src/lib/services/auth-state.service.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:654-744; D-13; AC 3.18
- Quality requirements: resolves true, false, and the newer read's value when superseded; `codexLogin` case at `:938` removed

### Task 15.2: Chat view re-auth starts the in-app sign-in — COMPLETE

- Depends on: Task 15.1
- Files: MODIFY `W/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:982-1030 (`chat-view.component.ts:336-352`)
- Quality requirements: `openai-codex` -> `codexSignIn.start()`, compact block in the existing banner; on `succeeded`
  `refreshAuthStatus()` then `clearAuthRequiredBanner()`; spec replaces the `codexLogin` expectation (`:526`)
- Validation notes: `workspace-coordinator.service.ts:289` ignores the boolean (no edit)

### Batch 15 verification

- Artifacts exist; header shows 2 projects; scoped check passes

## Batch 16: Activate result, Codex sign-in delegation, popover target — COMPLETE (commit 58f83c685)

- Recommended executor: CLI lane [Angular signals frontend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase B review)
- Rationale: result-type change and its only typed caller in one batch
- Tasks: 2 | Depends on: Batch 15
- Phase: B (last batch) | Phase review: code-logic + style over the phase B diff once Batches 12-16 are committed
- Scoped check: `npm run verify -- -p @ptah-extension/core,@ptah-extension/chat`

### Task 16.1: `activateConnection` result and Codex `externalAction` delegation — COMPLETE

- Files: MODIFY `W/libs/frontend/core/src/lib/services/providers-connection-setup.service.ts` (+ `.spec.ts`),
  `W/libs/frontend/core/src/lib/services/providers-settings-state.service.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:654-744; D-13; AC 3.7, 3.20
- Quality requirements: `{started, selectionReread:'ok'|'failed'|'not-run'}`; hook type `Promise<boolean>`; other
  `refreshAuthStatus` callers (`:418`, `:639`) ignore the boolean; Codex `sign-in` -> `CodexSignInService.start()`,
  `sign-in-cancel` -> `.cancel()`; the 310 s `auth:codexLogin` call at `:278` removed
- Validation notes: specs at `:124,184` keep `undefined` mocks except on the activate path; `providers-settings-state.service.spec.ts:1132` updated

### Task 16.2: Popover uses the shared target rule — COMPLETE

- Depends on: Task 16.1
- Files: MODIFY `W/libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:982-1030 (`:345-384,615-645`)
- Quality requirements: `defaultMainConnectionTarget`; `.then((r) => r.started)` inside `runDrawerWrite`; visible behaviour unchanged
- Validation notes: target spec cases unchanged; `providers-settings.component.spec.ts:132` mock still compiles (no edit expected)

### Batch 16 verification

- Artifacts exist; header shows 2 projects; scoped check passes
- Result: team-leader diff review — only the 6 listed files changed; 310 s `auth:codexLogin` call removed;
  popover uses `defaultMainConnectionTarget` and `.then((r) => r.started)`. Phase B review to confirm
  the shared rule matches the removed inline rule (chosen -> workspace -> source scope -> first).
  Scoped check NOT run locally (user decision, row 65); CI on PR #916 is the gate.
  Committed 58f83c685 (hooks passed).
- Phase B review: DUE — code-logic + style over Batches 12-16: 167f08f3a, 5e7dcd641, f351d3b46,
  8453e5162, 58f83c685 (reviewer family not codex).

---

# Phase C - Onboarding

## Batch 17: Readiness model and onboarding flag — COMPLETE (commit ebcc09ab6)

- Implementer family: codex (CLI lane)
- Verification: `npm run verify -- -p @ptah-extension/onboarding` run by the orchestrator — 3/3
  tasks succeeded (decisions row 56)

- Recommended executor: CLI lane [Angular signals frontend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase C review)
- Rationale: one project; old store left in place for Home (deleted in Batch 22)
- Tasks: 3 | Depends on: Batch 13
- Phase: C | Phase review: due after Batch 22 (code-logic; visual in Electron dark + light)
- Scoped check: `npm run verify -- -p @ptah-extension/onboarding`

### Task 17.1: `provider-readiness.derive.ts` — COMPLETE

- Files: CREATE `W/libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:745-814; design-spec.md sections 5-9
- Pattern to follow: `deriveClaudeReadiness` in `claude-readiness.store.ts`

### Task 17.2: `ProviderReadinessStore` — COMPLETE

- Depends on: Task 17.1
- Files: CREATE `W/libs/frontend/onboarding/src/lib/ready/provider-readiness.store.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:745-814; decision 21 (max 2 follow-ups per provider, 5 s apart, `refresh:true`)
- Quality requirements: repeated mounts start no extra probes (AC 5.9); a Claude failure leaves Codex untouched (AC 1.7);
  no call outside Electron (AC 6.2); `rechecking` only on recheck
- Validation notes: do NOT delete `claude-readiness.store.ts` (+spec) here

### Task 17.3: `ready.connectionAt` in the flag service — COMPLETE

- Files: MODIFY `W/libs/frontend/onboarding/src/lib/first-run/onboarding-flag.service.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:893-951; D-8; AC 4.6
- Quality requirements: schema and type gain `connectionAt`; `markReady` accepts it; old `claudeAt` record stays valid

### Batch 17 verification

- Artifacts exist; scoped check passes

## Batch 18: Connection banner, strip, stage 2 — COMPLETE (commit bf0e73c01)

- Implementer family: codex (CLI lane)
- Verification: local check not run; verified by CI (decisions row 65)

- Recommended executor: CLI lane [Angular signals frontend implementation, accessibility]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase C review)
- Rationale: presentational pieces and their stage 2 consumer together
- Tasks: 3 | Depends on: Batch 17
- Phase: C | Phase review: covered by phase C review
- Scoped check: `npm run verify -- -p @ptah-extension/onboarding`

### Task 18.1: `ConnectionReadinessBannerComponent` — COMPLETE

- Files: CREATE `W/libs/frontend/onboarding/src/lib/ready/connection-readiness-banner.component.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:815-843; design-spec.md sections 3, 4, 8; D-7
- Pattern to follow: `claude-readiness-banner.component.ts:30-131` (left in place until Batch 22)
- Quality requirements: shown only for chosen `missing`/`signed-out`/`stale`/terminal `error`; Claude copy unchanged; no dependency claim;
  `color-mix` classes; `role="status"`; ports today's it.each cases plus AC 4.1/4.2 cases

### Task 18.2: `ReadyStripComponent` `connection` input (two-step) — COMPLETE

- Files: MODIFY `W/libs/frontend/onboarding/src/lib/ready/ready-strip.component.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:815-843; design-spec.md section 9
- Quality requirements: new `connection: ChosenConnectionView` input drives item 1 ("Taking longer" uses `checking`; other/not-confirmed `idle`);
  the not-chosen provider never sets `need` (AC 4.4); items 2 and 3 unchanged
- Validation notes: keep `claude` as an optional input used only when `connection` is unset, so Home
  (`onboarding-home.component.ts:80`) keeps compiling until Batch 22; existing `claude` spec cases stay; Batch 22 removes both

### Task 18.3: Stage 2 page uses the new store, banner and strip input — COMPLETE

- Depends on: Tasks 18.1, 18.2
- Files: MODIFY `W/libs/frontend/onboarding/src/lib/ready/ready-settings-step.page.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:893-951 (`ready-settings-step.page.ts:29-32,76,83-119,268`)
- Quality requirements: lead "Choose what Ptah can use besides <chosen name>." with neutral form when nothing is chosen; tabs unchanged

### Batch 18 verification

- Artifacts exist; scoped check passes (Home spec still green)

## Batch 19: Connection choice and provider panel — COMPLETE (commit b5b480b03)

- Recommended executor: CLI lane [Angular signals frontend implementation, accessibility]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase C review)
- Rationale: one project, the two stage 1 building blocks
- Tasks: 2 | Depends on: Batches 14, 16, 18
- Phase: C | Phase review: covered by phase C review
- Scoped check: `npm run verify -- -p @ptah-extension/onboarding`

### Task 19.1: Connection choice store and component — COMPLETE

- Files: CREATE `W/libs/frontend/onboarding/src/lib/ready/connection-choice.store.ts` (+ `.spec.ts`),
  `W/libs/frontend/onboarding/src/lib/ready/connection-choice.component.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:844-892; design-spec.md section 6; prototype `stage1-choice.html`; decisions 5, 22
- Quality requirements: save target from `defaultMainConnectionTarget`; five save outcomes; `activateConnection` result used;
  renderer params-equality case with the popover path (AC 3.11 renderer half); states 1-13 rendering and focus

### Task 19.2: `ProviderPanelComponent` — COMPLETE

- Files: CREATE `W/libs/frontend/onboarding/src/lib/ready/provider-panel.component.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:893-951; design-spec.md 5.1-5.4; prototype `stage1-codex-main.html`, `stage1-states.html`
- Pattern to follow: Claude help blocks moved verbatim from `ready-claude-step.page.ts:259-403`
- Quality requirements: Codex install via `CODEX_INSTALL_COMMANDS` + `ptah-command-copy-row`, PATH hint, docs link;
  `<ptah-codex-sign-in-block layout="panel">` with `codexTerminalLoginCommand`; hidden for `unreadable/home` (D-15) and
  non-signed-out/non-stale; information role help inside closed `<details>`

### Batch 19 verification

- Artifacts exist; scoped check passes

## Batch 20: Stage 1 page, route and guard — COMPLETE (commit a17f0232d)

- Recommended executor: CLI lane [Angular signals frontend implementation, accessibility]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase C review)
- Rationale: route swap and old page deletion are one rollback unit
- Tasks: 3 | Depends on: Batch 19
- Phase: C | Phase review: covered by phase C review
- Scoped check: `npm run verify -- -p @ptah-extension/onboarding`

### Task 20.1: `ReadyConnectionStepPage` replaces `ReadyClaudeStepPage` — COMPLETE

- Files: CREATE `W/libs/frontend/onboarding/src/lib/ready/ready-connection-step.page.ts` (+ `.spec.ts`);
  DELETE `W/libs/frontend/onboarding/src/lib/ready/ready-claude-step.page.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:893-951; parity-inventory.md rows 20-38; prototype `stage1-fresh.html`, `index.html`
- Quality requirements: ports every parity row 20-38 case; AC 1.1, 1.2, 2.1-2.4, 4.5; per-provider announcements (Claude first);
  `store.refresh('mount')`; Codex `succeeded` -> `store.recheckCodex()`; Continue -> `markReady('connectionAt')`; Continue anyway -> `skippedAt`;
  focus to Continue when the chosen connection becomes ready; uses strip `connection` input

### Task 20.2: Route reference — COMPLETE

- Depends on: Task 20.1
- Files: MODIFY `W/libs/frontend/onboarding/src/lib/onboarding.routes.ts`, `W/libs/frontend/onboarding/src/lib/onboarding.routes.spec.ts`
- Plan reference: implementation-plan.md:893-951 (`onboarding.routes.ts:38-49`)

### Task 20.3: Guard honours `connectionAt` — COMPLETE

- Files: MODIFY `W/libs/frontend/onboarding/src/lib/first-run/onboarding-first-run.guard.ts` (+ `.spec.ts`)
- Plan reference: implementation-plan.md:893-951; AC 4.6
- Quality requirements: `claudeAt || connectionAt || skippedAt`; `onboarding-ready-host.guard.spec.ts` unchanged (AC 6.2)

### Batch 20 verification

- Artifacts exist; no remaining import of `ready-claude-step.page`; scoped check passes

## Batch 21: Renderer wiring and visual fixtures — COMPLETE (commit b4b467f99)

- Recommended executor: CLI lane [frontend implementation + test fixtures]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (senior-tester)
- Subagent reason: N/A
- Review family: different from implementer (phase C review)
- Rationale: two projects; push-handler registration plus e2e fixtures (e2e run only by the visual reviewer)
- Tasks: 2 | Depends on: Batches 13, 20
- Phase: C | Phase review: covered by phase C review
- Scoped check: `npm run verify -- -p ptah-extension-webview,@ptah-extension/webview-e2e-harness`

### Task 21.1: Register `CodexSignInService` as a message handler — COMPLETE

- Files: MODIFY `W/apps/ptah-extension-webview/src/app/app.config.ts`, `W/apps/ptah-extension-webview/src/app/review-shell-message-handlers.spec.ts` (only if its it.each enumerates app handlers)
- Plan reference: implementation-plan.md:1031-1052 (`app.config.ts:473-479`)
- Quality requirements: `{ provide: MESSAGE_HANDLERS, useExisting: CodexSignInService, multi: true }`

### Task 21.2: Onboarding visual fixtures and scenarios — COMPLETE

- Files: MODIFY `W/libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready.fixtures.ts`,
  `W/libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready-visual.e2e.spec.ts`
- Plan reference: implementation-plan.md:1031-1052 (`:225-502`)
- Quality requirements: fixtures for `auth:getCodexReadiness`, persisted selection in `auth:getAuthStatus`, sign-in pushes;
  scenarios for Codex chosen, bundled, signed out, slow and sign-in states; Home scenarios target the final Batch 22 markup
  (`ptah-connection-readiness-banner`, unchanged `data-testid`s)
- Validation notes: lanes do not run the e2e target; only lint/typecheck via the scoped check

### Batch 21 verification

- Artifacts exist; header shows 2 projects; scoped check passes

## Batch 22: Home readiness wiring (coordinated file) — COMPLETE (commit 8dd633f52; fix round FC commit 13ec7db9b)

- Phase C review: code-logic-review-phase-c.md (REVISE 6/10) -> fix round FC (fix-fc-report.md,
  codex lane) -> code-logic-review-phase-c-fixes.md (APPROVED 8/10, 0 Blocking / 0 Serious).
  Implementer family codex, reviewer family anthropic. Not fixed: decisions.md row 98 and Later
  work LW-B4..LW-B6. Verified by reading the diff against the findings; CI runs the checks (user
  decision). Phase C CLOSED.

- Recommended executor: CLI lane [Angular signals frontend implementation]
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase C review)
- Rationale: last batch by user constraint; switches the last consumer and removes the old Claude-only pieces
- Tasks: 2 | Depends on: Batches 18, 20, 21; EXTERNAL: TASK_2026_863_3855 (branch `feat/onboarding-workflow-layout`)
  merged to `main`, then the orchestrator/team-leader rebases `feat/provider-readiness` on `main` before this batch
  starts (lanes never run git; rebase only if the branch has not been pushed, else merge `main` - no force push).
  Re-check before starting: `git diff main...feat/onboarding-workflow-layout -- libs/frontend/onboarding/src/lib/home/onboarding-home.component.ts` is empty
- Phase: C (last batch) | Phase review: code-logic over the phase C diff once Batches 17-22 are committed; then
  visual review in Electron, dark + light, against `prototype/`
- Scoped check: `npm run verify -- -p @ptah-extension/onboarding`

### Task 22.1: Home switches to `ProviderReadinessStore` — COMPLETE

- Files: MODIFY `W/libs/frontend/onboarding/src/lib/home/onboarding-home.component.ts`,
  `W/libs/frontend/onboarding/src/lib/home/onboarding-home.component.spec.ts` (only the listed cases)
- Plan reference: implementation-plan.md:952-981 (the seven regions only)
- Quality requirements: imports `:28-29`; `imports` `:67`; strip `:80` -> `[connection]="chosen()"`; banner `:112-116` tag and
  `[chosen]`; footer `:306` "Review your connection and settings"; fields `:326,:333`; constructor `:419-421` `refresh('mount')`.
  Nothing else in the file changes (Task 1 owns the rest)
- Validation notes: spec cases per plan, including AC 5.1 timeout and AC 6.2 VS Code inert

### Task 22.2: Remove the old Claude-only pieces — COMPLETE

- Depends on: Task 22.1
- Files: MODIFY `W/libs/frontend/onboarding/src/lib/ready/ready-strip.component.ts` (+ `.spec.ts`) (drop the `claude` input and its cases);
  DELETE `W/libs/frontend/onboarding/src/lib/ready/claude-readiness.store.ts`, `claude-readiness.store.spec.ts`,
  `claude-readiness-banner.component.ts`, `claude-readiness-banner.component.spec.ts`
- Plan reference: implementation-plan.md:745-843 (deletions moved here; see Decisions)
- Validation notes: `grep -rn "claude-readiness\|ClaudeReadiness" W/libs W/apps` returns nothing afterwards

### Batch 22 verification

- Artifacts exist; Home diff limited to the seven regions; old files gone; scoped check passes
- Final check after commit (Mode 3 input):
  `npm run verify -- -p @ptah-extension/shared,@ptah-extension/auth-providers,@ptah-extension/auth-providers-tokens,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/cli-agent-runtime,@ptah-extension/platform-cli,@ptah-extension/core,@ptah-extension/chat,@ptah-extension/onboarding,@ptah-extension/webview-e2e-harness,ptah-electron,ptah-extension-webview`
  (header must say 13 projects)
- Human Electron manual check (Component 15, A-1/A-7): the only real `codex login`; one tab on Linux, cancel -> state 9,
  quit leaves no `codex login` process (`pgrep -f "codex login"`). Not run by any lane or agent

## Batch 23: Parity test gaps found at completion (tests only) — COMPLETE (74ca5a863)

- Origin: Mode 3 parity check (2026-11-04). The ported specs that replaced the deleted
  `claude-readiness.store.spec.ts` and `ready-claude-step.page.spec.ts` do not cover three keep
  rows of `parity-inventory.md`. The capabilities exist in the build; only their tests are gone.
  The plan's own seam (implementation-plan.md:799-801) says the derive spec ports every
  `claude-readiness.store.spec.ts:61-170` case.
- Recommended executor: CLI lane [Angular unit tests, Jest]
- Execution mode: sequential (one task per file, no shared files; may run as one lane)
- Fallback order: other family same capability -> same family other provider/model -> subagent (senior-tester)
- Subagent reason: N/A
- Review family: N/A (tests only; phase review none)
- Rationale: three small spec additions in one project; no production code changes
- Tasks: 1 | Depends on: Batch 22
- Phase: C fix | Phase review: none — tests only
- Scoped check: `npm run verify -- -p @ptah-extension/onboarding` — by standing user decision
  (decisions row 65) CI runs it; no local verify

### Task 23.1: Restore the three missing parity tests — COMPLETE

- Files: MODIFY `W/libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.spec.ts`,
  `W/libs/frontend/onboarding/src/lib/ready/provider-panel.component.spec.ts`,
  `W/libs/frontend/onboarding/src/lib/ready/ready-connection-step.page.spec.ts`
- Parity row 2 ("Missing beats error; detection error, missing row or local failure give
  error/local", `provider-readiness.derive.ts:58-69`): derive cases for (a) an uninstalled row
  together with an `unknown/timeout` or local-failure ambient answer -> `missing`; (b)
  `detection.status === 'error'` -> `error` with cause `local`; (c) no `claude-cli` row ->
  `error/local`; (d) `ambient.localFailure` -> `error/local`.
- Parity row 25 (OS tablist arrow keys wrap and move focus, `provider-panel.component.ts:301-315`):
  in the Claude missing panel, ArrowRight on the last tab selects and focuses the first, ArrowLeft
  on the first selects and focuses the last; the same for the Codex install tablist.
- Parity row 39 (focus moves to Continue when Re-check resolves ready,
  `ready-connection-step.page.ts:96-106,116-118`): chosen provider not ready, Re-check resolves
  ready -> the Continue button (`#continueButton`, `:48`; it has no `data-testid`) is `document.activeElement` after
  render; a Re-check that stays not ready leaves focus on Re-check.
- Rules: tests only, no production change; no real `codex login`; follow the existing helpers in
  each spec; no lane runs git or edits batches.md / task.md.

### Batch 23 verification

- The three spec files hold the new cases; CI `CI (tests ...)` passes on the new head
- Then Mode 3 re-runs; the remaining completion checks already passed (see the Mode 3 return)

## Parallelism map (max 3 lanes at once)

- Start together: Batch 1, Batch 2, Batch 11.
- After Batch 1: Batch 10 and Batch 12 may run beside the auth-providers chain (3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9).
- Phase B chain: 12 -> 13 -> 14 -> 15 -> 16. Phase C chain: 17 (after 13) -> 18 -> 19 (after 16) -> 20 -> 21 -> 22.
- Commits land in batch order within each chain; the phase review runs only after the phase's last batch commits.

## Later work

Earlier items are recorded in decisions.md: LW-B1 and LW-B2 (rows 71, 77), LW-B3 (row 82), LW-S (row 71).

- LW-B4 (Minor, Phase C review m1; decisions row 98): `slowStarted` / `_slowStarted` in
  `libs/frontend/onboarding/src/lib/ready/provider-readiness.store.ts` has no consumer in
  libs/frontend. Remove it, or give it a consumer and a style review as new public API. m2 is
  related: the `mountId` counter is shared by mount and recheck and exists only to label it.
- LW-B5 (Moderate, re-review M-a): the store's raw timeout check (`provider-readiness.store.ts`,
  `run()`, `timedOut`) ignores the derive's precedence. When the derive resolves `missing` or
  `error/local` and the raw view also shows a timeout, the cycle waits 10 s and re-reads for
  nothing. Gate the follow-up on the derived state or on the same precedence.
- LW-B6 (Moderate, re-review M-b): no spec covers the Codex `checking` -> `slow` path
  (`provider-readiness.derive.ts`, `deriveCodexReadiness`) or the Codex timeout shapes (binary
  timeout, `signIn` timeout) that start a follow-up. Add store and derive specs for them.
- Recorded only (re-review m-a, m-b): `codexReauthBanner` in `chat-view.component.ts` is a plain
  field; making it a signal removes a practically unreachable stale `codexReauthVisible`. A rejected
  Claude read reports `failedFact: 'sign-in'` even when the detection or binary read failed.
