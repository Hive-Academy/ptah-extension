# Follow-up — chat sessions without a workspace override ride the shared AuthEnv

## Status

Done in PR #688 (user approved the full fix). Not committed.

- **Every chat session gets a snapshot.** `WorkspaceProviderProfileResolver.resolveProviderProfileForWorkspace` (`workspace-provider-profile-resolver.ts:99`) no longer has the "explicit override" gate: it builds the profile for the provider the workspace resolves to (own override, else app, else global). The explicit-override output is unchanged. `buildProfileForPath` (`:156`) keeps its contract for one-shot callers.
- **All chat paths use it:** `chat:start`, child sessions and the handover successor (`launchSdkSession`, `chat-session.service.ts:858`); the `chat:continue` / `chat:resume --activate` / rewind resume (`autoResumeIfInactive`, `:1578`); and the slash-command relaunch, which used no profile at all before (`chat-slash-command-router.service.ts:133` → `SlashCommandRunConfig.providerProfile`, `agent-adapter.types.ts:219` → `SdkAgentAdapter.executeSlashCommand` `sdk-agent-adapter.ts:1474`, `authEnvOverride` at `:1535` → `SessionLifecycleManager.executeSlashCommandQuery` `session-lifecycle-manager.ts:889`).
- **Fail closed.** With no snapshot, the resolver compares the workspace's `{ authMethod, providerId }` with what the shared AuthEnv is configured for. Same provider → `undefined`, the shared env is used (logged at info). Different provider, or no configuration → `AuthRequiredError` (`:136`). The chat paths map it to `errorCode: 'AUTH_REQUIRED'` + `providerId` (the existing re-auth banner path; resume and slash catch blocks now include it).
  - Deviation: the comparison reads `AuthManager.getConfiguredAuth()` (`auth-manager.ts:146`), not the adapter's private `lastConfiguredAuth`. `AuthManager` is the only writer of the shared env; its record is set only when a configuration succeeds (`:213`) and cleared while one runs, after a failure and on `clearAuthentication` (`:173`, `:245`). `lastConfiguredAuth` is set before `configureAuthentication` returns, even when it fails. The resolver (auth-providers) cannot read adapter state without depending on the adapter.
- **Proxy pool shares by configuration.** `ProviderProxyPool` keys entries by `${providerId}::${credentialKey}` (`provider-proxy-pool.ts:173`), not by workspace. Workspaces with the same effective config share one proxy and port. Concurrent acquires share one start (`startEntry`, `:257`). Each entry tracks its bound workspaces. A workspace that acquires a newer fingerprint of the same provider moves to it (`bindScope`, `:326`). `disposeForScope` (`:543`) unbinds the workspace and stops a proxy only when no workspace is left on it. Credentials and `provider.<id>.baseUrl` are machine-wide, so this cannot serve a workspace from another workspace's configuration.
- **Kept:** `initialize()` for global/app saves, `applyWorkspaceAuthChange` and the workspace-switch reconfigure. They keep the shared env current for model listing, CLI detection and auth status. After `auth:clearWorkspaceOverride`, the next session in that workspace resolves to the global/app provider through the snapshot.
- **`disposeAllSessions`** now notifies `handoverCoordinator.sourceEnded` for each session with a token before teardown (`session-lifecycle-manager.ts:747`, shared helper `notifyHandoverSourcesEnded` `:772`, also used by `disposeSessionsForWorkspace`).
- **VS Code / single-provider users:** the VS Code active path is the workspace root (`bootstrap.ts:130`), so `resolveActiveAuthForPath(root)` resolves the same provider as the shared env's `resolveActiveAuth()`. Non-proxy providers: the snapshot holds the same credentials, base URL and tiers as the shared env. Proxy providers (Copilot, Codex, OpenRouter, LM Studio, Sakana, OpenCode, custom OpenAI-lane): chat now goes through ONE pooled proxy (same auth singletons, its own port) next to the strategy's proxy, which stays for the shared env's other readers. That is one extra local listener per proxy provider in use, not one per workspace. A pooled proxy survives a strategy teardown on a workspace switch; the strategy proxy did not.

- **Proxy lifecycle (Codex round 2):** a workspace that moves to a newer fingerprint keeps the old entry as "retired" (not reused, at most one retired generation per workspace + provider), so a session still streaming through it survives a credential rotation; retired entries stop on `disposeForScope` / `disposeAll`. Per-scope and pool-wide disposal epochs stop `acquire` from binding a workspace disposed during a start or during `bindScope`. A failed `start()` calls `stop()`.

Remaining: none required. Gateway-chat-bridge sessions (`gateway-chat-bridge.ts`) still pass no profile and use the shared env. That path is outside this follow-up.

## Original analysis

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
