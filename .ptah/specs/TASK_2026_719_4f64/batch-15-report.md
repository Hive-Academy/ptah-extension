# Backend implementation: `TASK_2026_719_4f64`, batch 15

**Verdict**: COMPLETE. Task 15.1 is done in the 6 assigned files, and every requested check passes. I did not run `npm run verify`, a build or any git state change, and I edited no file outside the 6.

**Tasks completed**: Task 15.1. It lifts the live-resume and slash-command holds, and makes the router gate resolve the selection and forward it.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
  - `:1166-1190`: new private `assertLiveAccountSelection(sessionId, live, selection)`.
  - `:1208-1214`: the live-resume hold (old `:1182-1185`) is replaced by that check.
  - `:1678-1701`: the `executeSlashCommand` hold (old `:1653`) is removed. A named selection is now spread into `sessionConfig`, so `executeSlashCommandQuery` -> `executeQuery` builds the certified named lifecycle on resume. An ambient config is passed through as the same object.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`
  - Adds `ProviderAccountSelection` to the type import.
  - Appends the describe block `account selection on live and relaunched runs (B15)`: 14 tests.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`
  - `:78-79`: new exported type `ResolvedMainAccountSelection`, the named variant of the selection.
  - `:81-98`: `gateMainSessionAccount` now returns `ResolvedMainAccountSelection | undefined`. Its `accounts` Pick is narrowed to `selection | lookupBySdkSession`.
  - Bound branch: returns the stored binding's profile. The fresh branch returns the explicit or default named profile.
  - The admit/release/`release-held` tail (old `:118-134`) is deleted, together with the `runId` local and the `randomUUID` import.
  - `:196-201`: the slash route keeps the resolved selection. `:341` forwards it to `executeSlashCommand` for named only.
  - The slash `catch` maps an account refusal through `mainSessionAccountFailure`, so it does not come back as a raw or AUTH_REQUIRED error.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.accounts.spec.ts`
  - It tests the precedence table and the router forwarding.
  - `reflect-metadata` is the first import.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
  - `gateAccount` returns the resolved selection (`:1778-1795`). `gateSessionAccount` stays `Promise<void>`.
  - `SdkSessionLaunch.accountSelection` added (`:210-211`). `launchSdkSession` spreads it into `startChatSession` for named only (`:944-945`).
  - Start, agent-child and handoff capture the gate result and pass it on (`:598/640`, `:690/714`, `:785/808`).
  - `autoResumeIfInactive` forwards it into `resumeSession` (`:1546-1548`, `:1671-1672`). Its catch maps an account refusal to a typed `accountRefusal` instead of `String(error)`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts`
  - The HELD admission mocks are gone. `admitClaudeRoute` and `releaseReservation` remain only as tripwires: `expectNoRouteReservation`.
  - Run refusals now come from the SDK mock (`REFUSED(code)`).
  - Cases are rewritten as real outcomes (see below).

## Acceptance evidence

| Bullet | Code | Spec evidence |
| --- | --- | --- |
| Omitted / same / conflicting / ambient selection on fresh runs | gate fresh branch | router accounts spec, "precedence on a fresh run": explicit named over default; ambient over default gives `undefined` with no account, auth or storage call; omitted and absent with a default give the default; omitted with no default is ambient; `apiKey`/`thirdParty` keep the ambient result; a host with no account service refuses named with `unavailable-storage`. Binding spec: "fresh omitted selection forwards only the main default to the SDK run"; "explicit named selection bypasses the default"; "explicit ambient ..." with no `accountSelection` key in the start args |
| Same, on bound runs | gate bound branch | router accounts spec, "precedence on a bound run": absent, omitted or same profile gives the stored profile and the default is never read; a different profile or ambient refuses `conflict`; an unbound legacy session stays ambient and refuses a retroactive named selection (`invalid-bound`). Binding spec: inactive bound resume `it.each(absent, omitted, same)` -> `resumeSession(SESSION, {accountSelection: named(ORIGINAL)})`; "refuses switching an existing binding to ambient/named" |
| Live session: omitted or same continues the owner's lease; different or ambient refuses `conflict` | `assertLiveAccountSelection` | Adapter spec (B15 block): live named record with absent, omitted or same selection -> the existing query is streamed and `executeQuery` is not called. Different named or ambient -> `conflict`; no transform and no `executeQuery`. A stored binding on another route -> `invalid-bound`. A live ambient record with explicit named -> `conflict`. Live ambient with absent or ambient selection -> the existing path, and the metadata store is not read |
| Live resume without a second binding or lease | the adapter live branch never calls `executeQuery`; the gate never admits | Adapter spec: the live-continue cases assert `executeQuery` is not called. Binding spec: "live bound session continues on the owner without a resume, binding or lease" (`resumeSession`/`startChatSession` not called, `admitClaudeRoute`/`releaseReservation` not called); "rewind of a live bound session returns active without a second run". The inactive named resume passes `resumeSessionId` and the selection to one executor run. That executor reuses the stored binding without `commitRunBinding` (pinned in B13) |
| Ambient resume and slash cases unchanged | ambient forwards no key; the slash ambient config is the same object | Adapter spec "an ambient slash relaunch (absent/ambient) passes its session config unchanged" (`toBe`). Router accounts spec "an unbound session relaunch keeps the ambient argument shape". Binding spec "incompatible provider keeps its existing launch arguments" (call args are equal across the inherited and fresh paths). `chat-rpc.handlers.spec.ts` passes unchanged (63/63) |
| HELD admission mocks become real outcomes | as above | Every `accountRefusal: HELD` expectation is replaced. Run refusals (`missing-profile`, `route-changed`, `identity-mismatch`, `identity-unproved`, `unavailable-storage`) come from the SDK resume or start and keep their typed code, and nothing is sent to the conversation. The handoff and child paths inherit `named(ORIGINAL)` and start. The D22 host test keeps a typed `identity-unproved` refusal from the SDK. The old "future successful preflight ... lease transfer" and "releases only the child preflight reservation" cases are replaced by "the gate resolves a named selection without reserving a route" |
| Named slash relaunch | adapter `executeSlashCommand` | Adapter spec "a named slash relaunch runs the named lifecycle with the resolved selection". Router accounts spec "a bound session relaunch carries the stored named selection", "a conflicting selection refuses before any relaunch", and "a named relaunch refusal keeps its typed code instead of AUTH_REQUIRED" |

## Decisions

- **No persistence dependency in the adapter's live check.**
  - Options considered:
    - inject `SDK_NAMED_ACCOUNT_PERSISTENCE` into `SdkAgentAdapter` and call `assertRouteCurrent` plus `accountInfo` (rev1 wording);
    - compare the selection only, and leave revalidation to the owner.
  - Evidence:
    - The live owner's gate already runs `verifyIdentity()` before every user message it admits (`session-query-executor.service.ts:795-796`: `assertRouteCurrent` plus `namedIdentity` plus `sameNamedIdentity`).
    - The live record's `accountBinding` has no full `ClaudeAccountNamedRoute` to pass to `assertRouteCurrent`.
    - A new constructor dependency would change every spec that builds the adapter.
  - The adapter decides continue vs `conflict` only, from the live record's route fingerprint and the metadata binding's `profileId`. Reversible.
- **The gate forwards a named selection or nothing.** Explicit ambient and omitted are equivalent after the gate, so ambient launches carry no new key and their argument shapes stay byte-identical. Reversible.
- **Live named record vs stored metadata on another route refuses `invalid-bound`, not `conflict`.** The linkage is inconsistent; the user did not ask for a switch. Reversible.
- **The refusal mapping is extended to the resume catch (chat-session) and the slash catch (router).** Before, these paths could not receive an account refusal. Now that named runs reach the SDK, they would have turned the refusal into `String(object)` or AUTH_REQUIRED.

## Specs that mock or pin changed members

- `gateMainSessionAccount`: `chat-session.account-binding.spec.ts` (updated) and the new router accounts spec. No other caller (grep of `libs/backend/rpc-handlers/src` and `apps`).
- `SdkAgentAdapter.resumeSession` / `executeSlashCommand`: `sdk-agent-adapter.spec.ts` (existing cases unchanged, pass). The SDK mocks in `chat-session.account-binding.spec.ts` (updated). `chat-rpc.handlers.spec.ts` and the other `lib/chat` specs mock the adapter with ambient calls; they are unchanged and pass.
- `ChatSessionService.gateAccount` is private. The public `gateSessionAccount` signature is unchanged.
- The ambient pins (plan lines 943-953) are unchanged.

## Risks and safety

- **Safety (B17 persistence):** I wired no persistence. With the null `SDK_NAMED_ACCOUNT_PERSISTENCE`, a named run reaches `executeQuery`, which refuses before any child (see the first out-of-scope observation for the code).
- I added no token, registration or DI change. The adapter constructor is unchanged.

## Verification (run from the worktree)

- `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.lib.json`: exit 0.
- `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.spec.json`: exit 0.
- `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.lib.json`: exit 0.
- `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.spec.json`: exit 0.
- `npx eslint` on the 6 files: 0 errors, 3 warnings. The warnings were already there: `max-lines` on `sdk-agent-adapter.ts` and `chat-session.service.ts`, and `no-useless-assignment` at `sdk-agent-adapter.ts:454`, which I did not touch.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts --maxWorkers=2`: 1 suite, 140/140 passed.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/chat --maxWorkers=2`: 34 suites, 502/502 passed.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts --maxWorkers=2` (the ambient pin): 63/63 passed, file unchanged.
- I did not run `ptah_get_diagnostics`; the scoped `tsc` runs above cover the same projects.

## Plan deviations

- The rev1 adapter wording (`persistence.assertRouteCurrent` plus `accountInfo` in the adapter) is replaced by the owner's per-turn `verifyIdentity`; see Decisions.

## Out-of-scope observations (not touched)

- `session-query-executor.service.ts:1019` (B13) refuses `release-held` when `queryRunner.accountAdmission` or `accountPersistence` is null. Batch 15's Safety note and plan line 402 expect `unavailable-storage` for no-storage hosts. Until B17, a named main-chat run on Electron therefore refuses `release-held`. Either way it refuses before any child. The fix is one code change in the executor, which is B13's file.
- The executor's `admitClaudeRoute` request (`session-query-executor.service.ts:713-714`) does not pass `workingDirectory`. `ProviderAccountService` therefore uses `route.canonicalPath` as the certified `cwd`, not the session's `projectPath`. Rev1 Component 9 says the admission request carries `workingDirectory`. This belongs to B13's file. This batch already forwards `projectPath` in `sessionConfig`, so the executor could read it there.
- `.ptah/specs/TASK_2026_719_4f64/decisions.md` shows as modified and `batch-14-report.md` as untracked in the worktree. Neither was changed by me.
