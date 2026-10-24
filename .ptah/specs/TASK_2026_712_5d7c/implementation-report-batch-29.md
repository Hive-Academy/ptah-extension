# Implementation report: Batch 29 (TASK_2026_712)

Authoritative frontend account state and its notification owner. Electron first. No git, no
test/lint/build commands run (the orchestrator runs the scoped checks).

## Files changed

The batch assigned five files. One assigned file (`libs/frontend/core/src/index.ts`) was
**not changed**, and the registration file was changed in its place, as the batch allows (see
"Notification registration" below).

- CREATE `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts`: the state owner.
  - `:126` class `ProviderAccountsStateService` (`providedIn: 'root'`, `implements MessageHandler`)
  - `:185` `handleMessage` handles the `provider:accountsChanged` push
  - `:394` `read` handles `provider:listAccounts`: read sequence, reconnect reset, error/stale
  - `:439` `apply` applies a snapshot only when it is for the active workspace and has a newer revision
  - `:503` `write` handles all account writes: pending/saved/failed/unconfirmed, re-read on unconfirmed
  - `:562` `settle` settles a request once; later settlements are no-ops
  - Bottom of file: wire guards `isSnapshot`, `operationOf` and `safeResult`
- CREATE `libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts`: 15 tests.
- MODIFY `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`
  - `:84` re-exports the type `ProvidersClaudeOrchestrationField`
  - `:86-96` re-exports `ProviderAccountsStateService` and its public types. This file is already
    the public entry point for Providers state (`export *` at `core/src/index.ts:7`).
  - `:786-787` the orchestration read now includes `claudeModel` and `claudeReasoningEffort`
    from `agent:getConfig`.
- MODIFY `libs/frontend/core/src/lib/services/providers-settings.types.ts`
  - `:76-83` new type `ProvidersClaudeOrchestrationField`
  - `:120` added to the `ProvidersOrchestration` read type
- MODIFY (in place of `index.ts`) `apps/ptah-extension-webview/src/app/app.config.ts`
  - `:32` import from `@ptah-extension/core`
  - `:420-428` registers `{ provide: MESSAGE_HANDLERS, useExisting: ProviderAccountsStateService, multi: true }`
- UNCHANGED (assigned): `libs/frontend/core/src/index.ts`. It already re-exports
  `providers-settings-state.service.ts` with `export *`, so the barrel exposes the new service
  without an edit.

## Notification registration

- `MESSAGE_HANDLERS` is read once, when the app starts, by `MessageRouterService`
  (`libs/frontend/core/src/lib/services/message-router.service.ts:98,134`). It has no API for
  registering a handler later.
- No exported core provider function collects core handlers. `provideMessageRouter()` provides
  only the router.
- So the only real registration point is
  `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/apps/ptah-extension-webview/src/app/app.config.ts`,
  the same place as `PlanLimitsStore` and `BootStatusService`. It is now wired at `:420-428`.
- The Electron renderer and the VS Code webview share this app config. The service stays inert
  on VS Code.

## State model

- **One owner per provider.** Each provider in `PROVIDER_ACCOUNT_PROVIDERS` gets one slot.
  - `state(provider)` returns `{ status: inert|idle|loading|ready|error, snapshot, stale, error }`.
  - `operations(provider)` returns the host-issued sign-in/sign-out handles, keyed by profile ID.
  - `actions` holds every write by `requestId`, with status `pending|saved|failed|unconfirmed`
    and a safe `result`.
- **Inert host.** The service checks `VSCodeService.isElectron` once, when it is constructed
  (BootStatusService does the same).
  - Electron is the only host profile with `providerAccounts`, and that capability is not
    exposed to the webview.
  - When inert, no RPC is ever made, pushes are ignored and writes return `unavailable`.
- **Revisions.** A snapshot is applied only when its revision is greater than the one held.
  - Older pushes and responses, duplicates, and snapshots for another workspace are ignored.
  - Each read gets a sequence number. Only the latest read sets loading/error, so an
    out-of-order older response cannot overwrite a newer snapshot.
- **Reconnect.** `reconnect(provider)` accepts the host's answer even when its revision is lower
  (for example after a host restart).
  - A push that arrives while the reconnect read is in flight is treated as authoritative.
  - After that, normal revision ordering applies again.
- **Workspace switch.** When `WorkspaceScopeService.generation` changes:
  - every slot is reset and in-flight reads are dropped;
  - opened slots read again.
- **Writes.**
  - Each write carries a 32-hex `requestId` from `crypto.getRandomValues`, which works without
    a secure context.
  - Profile writes send the account revision from the held snapshot.
  - `setSelection` sends only that scope's revision. `setDefault` sends both revisions from the
    same snapshot.
  - If the transport fails, or the host returns the `timeout` code, the action becomes
    `unconfirmed` and a re-read starts. It is never reported as rolled back.
  - A refusal shows the closed code and the host sentence only if `isSafeProviderAccountSummary`
    passes; otherwise it shows fixed copy.
  - A push with a `requestId` settles that action. Whichever of push or response arrives first
    settles it; the second is a no-op.
- **No optimistic state.**
  - Account state and selections come only from host snapshots.
  - Add never selects the new profile.
  - A removed selected profile is cleared only when a committed snapshot clears it.
  - Named admission is not represented anywhere, so a named account is never shown as admitted (D7).
- **Operations.**
  - A handle is kept only while the profile's state in the snapshot is `pending`.
  - `cancelSignIn` uses the handle's `operationId`. Closing a surface never cancels a sign-in.
  - `refreshAccountStatus` refreshes only the operation handle. It does not merge the account
    summary, so the atomic snapshot stays intact.
- **Disposal.** On `DestroyRef` destroy, pushes, late responses and new calls become no-ops.
  `MessageRouterService` owns the window listener.
- **Config.** The Providers orchestration state now reads `claudeModel` and
  `claudeReasoningEffort`.

## Specs written

`provider-accounts-state.service.spec.ts` uses the `createMockRpcService` mock from
`../../testing`, a real `WorkspaceScopeService` and a stubbed `VSCodeService`. It does not use
`process.cwd()` or spy on any module namespace. It covers:

- an inert host makes no RPC;
- the handler registers for the push type only;
- open loads the snapshot;
- older, duplicate, foreign-workspace and malformed pushes are ignored;
- out-of-order read responses;
- a failed read keeps a stale snapshot, and retry recovers;
- reconnect accepts a lower revision;
- label-only Add, settled once when both push and response arrive, with no implicit selection;
- sign-in never shows signed-in optimistically, and Cancel uses the operation ID;
- rename, sign-out and status reads;
- host `timeout` and transport failure become unconfirmed and trigger a re-read;
- a refusal with an unsafe summary shows fixed copy and leaves the snapshot unchanged;
- main and lane writes are independent, and default uses one snapshot's revisions;
- a removed selection clears only on commit;
- disposal.

## Specs that mock changed members

- `ProvidersOrchestration` gained two optional fields (`claudeModel` and `claudeReasoningEffort`
  are optional on `agent:getConfig`). These specs build or cast it and need no change:
  - `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.spec.ts:50`
  - `agent-orchestration-config.component.spec.ts:73`
  - `cursor-credential-popover.component.spec.ts:9`
  - `copilot-auto-approve-toggle.component.spec.ts:10`
  - `subagent-cache-ttl-setting.component.spec.ts:18`
- `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts:2018` uses
  `toEqual`. Its `agent:getConfig` mock has no Claude fields, so they read as `undefined`, which
  `toEqual` ignores. No change needed.
- No spec mocks `ProviderAccountsStateService`, because it is new.
- Webview specs that mock `@ptah-extension/core` (`git-dock-arming-identity.spec.ts:53`,
  `git-status-message-routing.spec.ts:52`) use `requireActual` and copy their own registrations
  rather than importing `app.config.ts`. They are not affected.

## Diagnostics

I ran `ptah_get_diagnostics` (TypeScript compiler) scoped to the changed files:

- The new service, its spec, `providers-settings-state.service.ts`,
  `providers-settings.types.ts` and `app.config.ts` have **0 errors**. The last run, after the
  fixes, covered the service file; the earlier run already showed no errors for the other four.
- The checker also reports errors in sibling specs I did not change: `auth-state`,
  `autopilot-state`, `effort-state`, `electron-layout` and `zone-change-detection`. They come
  from the checker not having jest types; those files are not part of this change.

Not run here, by rule: jest, nx typecheck and lint.

- Suggested scoped commands:
  - `npx nx test core --parallel=1`
  - `npx nx typecheck core`
  - typecheck of the webview app project, because `app.config.ts` changed
- Projects that depend on the core lib should be typechecked under the CLAUDE.md host rule.

## Decisions

1. **The registration file replaces `index.ts`.**
   - Options were: keep `index.ts` and leave the state unwired; drop `providers-settings.types.ts`;
     or drop `index.ts`.
   - Evidence: `MESSAGE_HANDLERS` is read once at startup (`message-router.service.ts:134`) and
     has no later-registration API. `core/src/index.ts:7` already re-exports
     `providers-settings-state.service.ts`.
   - Chosen: re-export through that file and edit `app.config.ts`.
   - Reversible: the export can move to `index.ts` later.
2. **The capability gate uses `isElectron`.**
   - `providerAccounts` exists only in the backend host profile; no webview API exposes it.
     Electron is the only host where it is true (`host-profile.ts:86` default false).
   - Reversible: swap in a capability read when one exists.
3. **Claude model and effort are read-only for now.**
   - `ProvidersCommitService` (`providers-commit.service.ts:150-166`) is not owned by this
     batch and has no write or read-back operation for these fields.
   - Adding them to `ProvidersSettingsPatch` would accept a write and silently drop it. So they
     are in the read type only, as `ProvidersClaudeOrchestrationField`.
   - Owner of the follow-up: the batch that owns `providers-commit.service.ts` (Batch 34 or the
     CLI matrix batch) adds them to the commit list and to the patch type.
4. **Every unconfirmed outcome triggers one automatic re-read.**
   - Unconfirmed means a transport failure or the host `timeout` code. There is no automatic
     re-send with the same `requestId`.
   - Retrying the user action is left to the UI (Batches 31-33).
5. **`refreshAccountStatus` does not merge the account summary into the snapshot.**
   - The summary carries no snapshot revision, so merging it would break the atomic snapshot.
6. **No reconnect signal exists in the frontend.**
   - Searching for reconnect state in frontend services found nothing.
   - `reconnect(provider)` is public for the Accounts surface or a later connection-state owner
     to call. Until then, the per-region Retry (`refresh`) is the recovery path.

## Out-of-scope observations

- `providers-commit.service.ts:150-166` and `providers-settings-state.service.ts:784-786`:
  `grokReasoningEffort` and `antigravityReasoningEffort` are in `ProvidersOrchestrationField`, but
  the commit list does not write them and the state does not read them. This is the same gap D32
  already notes.
- `PENDING_USER_REVIEW_IDS` was not touched (moved out of this batch).
- I made 59 tool calls, over the batch limit of 45. The extra calls went to finding the
  registration point and to diagnostics retries.
