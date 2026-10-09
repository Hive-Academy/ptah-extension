# Follow-up — chat sessions without a workspace override ride the shared AuthEnv

Source: CodeRabbit comment on PR #688 (`sdk-agent-adapter.ts` ~:732-754, "Keep workspace-scoped auth changes out of the shared `AuthEnv`"). Deferred by the user: the defect predates PR #688 (`reset()` called `initialize()` the same way before).

## Defect

- `chat:start` (`chat-session.service.ts:856`) and `chat:continue` (`:1574`) call `resolveProviderProfileForWorkspace`, which returns `undefined` when the workspace has no override of its own (`workspace-provider-profile-resolver.ts:97-108`). Only one-shot work (`WorkspaceLlmResolver` → `buildProfileForPath`) always gets a global/app snapshot.
- Such a session runs with `authEnvOverride = undefined` (`sdk-agent-adapter.ts` :806/:870 start, :1088/:1157 resume), so the query executor uses the shared AuthEnv (`session-query-executor.service.ts:521-523`).
- The shared AuthEnv is rewritten by:
  - a workspace-scoped save of the active workspace: `applyWorkspaceAuthChange` (:732) → `initialize()` (:443) → `doInitialize()` (:472) → `resolveActiveAuth()` (:476) / `configureAuthentication` (:481);
  - a workspace switch: `handleWorkspaceChanged` (:338) → `reconfigureAuthIfChanged` (:406, :432).
- Effect: the query in flight is safe (env copied at :521), but the NEXT query of a session in a workspace without an override (continue/resume, slash-command relaunch, new `chat:start`) can use another workspace's provider and credentials. Sessions whose snapshot build failed (unknown provider, missing key :181-186, proxy-pool acquire failure :223-228) are in the same position.

## Why the suggested minimal fix is not enough

- Skipping `initialize()` on a workspace save leaves the workspace-switch path open.
- After `auth:clearWorkspaceOverride` the active workspace has no override, so its sessions would keep the old provider.
- Readers of the shared env for the active workspace (model listing, CLI detection, auth status) would go stale.

## Proposed design

1. Drop the "explicit override" gate: `chat:start` / `chat:continue` always call `buildProfileForPath`, so every chat session carries a global/app snapshot. Cost: each workspace on a proxy provider gets its own pooled proxy and port; behavior changes for single-provider users and the VS Code host — needs a decision.
2. Fail closed: when no snapshot can be built and the workspace's provider differs from the provider in the shared env (`lastConfiguredAuth`), fail the session with a clear error instead of using the wrong credentials.
3. Keep `initialize()` for global/app saves.

## Related, not done

- `disposeAllSessions` (`session-control.service.ts:321`, global reset path) does not call `handoverCoordinator.sourceEnded`, unlike `endSession` and (since PR #688) `disposeSessionsForWorkspace`.
