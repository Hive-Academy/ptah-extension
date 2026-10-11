## Round 2 — shared AuthEnv fix

### Round 2 re-review

Score: **8/10**  
Verdict: **REVISE**

| Prior finding | Status | Evidence |
|---|---|---|
| 1. Superseded proxy stopped while an older session still uses it | **FIXED** | `provider-proxy-pool.ts:412-460` moves a superseded, unbound entry into `retired` and retains the workspace in `retiredFor`; it releases the prior retired generation on the next rotation (`:429-435`). The focused tests retain the old proxy through one rotation (`provider-proxy-pool.spec.ts:718-730`) and stop the first retired generation on the second (`:732-745`). |
| 2. Disposal during a pending start leaks/binds a closed scope | **FIXED** | `provider-proxy-pool.ts:239-240` snapshots scope/pool epochs before awaits, verifies them before binding (`:291-299`), and `disposeForScope`/`disposeAll` advance those epochs (`:667-671,700-705`). Focused gated-start specs cover scope disposal, pool disposal, reopening, and a sharing workspace (`provider-proxy-pool.spec.ts:429-491`). |
| 3. Failed `start()` does not clean up a partially allocated listener | **FIXED** | The start catch calls `await proxy.stop()` and logs a cleanup failure separately (`provider-proxy-pool.ts:355-383`); `provider-proxy-pool.spec.ts:493-506` asserts `stop()` is called after a rejected start. |

1. **Minor — disposal can still return a stopped proxy in the third-rotation bind interleaving.** `bindScope` records the new scope before awaiting cleanup of the prior retired generation (`provider-proxy-pool.ts:416-435`). If `disposeForScope(workspacePath)` runs during that `await`, it removes and stops the newly bound entry (`:672-685`). The original `acquire` performs no epoch/disposed recheck after `await bindScope` and returns that entry's URL at `:306-307`. Scenario: workspace A has rotated provider credentials twice, starts a third acquire, and the workspace closes while the first retired proxy is stopping; the caller receives a profile pointing to a stopped proxy instead of `undefined`. Suggested fix: after `await bindScope`, re-check the captured epochs and that the entry remains live/bound to the scope; if not, return `undefined` (and release only any still-held entry). Add a gated-stop test that disposes the scope during the `olderRetired` cleanup await.

The retired-entry model is otherwise bounded: at most one retired holder per workspace/provider is retained (`provider-proxy-pool.ts:429-435`), retired entries are not present in `entries` (`:452-460`), and both disposal methods include `liveEntries()` (`:672-705`). The identity guard in `stopEntry` prevents an old retired generation from deleting a newer same-key entry (`:720-725`); the return-to-an-old-fingerprint test exercises that collision (`provider-proxy-pool.spec.ts:747-767`). The re-acquire branch is finite under normal state changes (`:300-304`): it only retries after another disposer removed the exact just-started map entry, and the sharing-start test covers that observable path (`provider-proxy-pool.spec.ts:477-491`).

### Round 2 — final correction check

**Verdict: APPROVED**

1. **FIXED — disposal during the older-retired stop can no longer return the newly stopped proxy.** `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:306-315` re-checks both captured disposal epochs and `entry.scopes.has(workspacePath)` immediately after the only awaited cleanup within `bindScope`. `disposeForScope` advances the scope epoch and removes that scope from every held entry before stopping it (`provider-proxy-pool.ts:675-693`); `disposeAll` advances the pool epoch (`:708-713`). Thus the interleaving returns `undefined`, not the stopped entry URL. No entry is leaked by that return: disposal has already removed/stopped or retired each held entry, and the post-bind guard does not add a new holder. The check cannot return `undefined` absent disposal in this path: a successful bind retains the scope, and epochs are unchanged. `bindScope` has no other await after its pre-cleanup mutation (`provider-proxy-pool.ts:420-448`).

The regression test exercises the race: after two rotations, it gates the oldest retired proxy's `stop()` (`provider-proxy-pool.spec.ts:747-760`), begins the third acquire, disposes the workspace while that stop is pending, releases the gate, and asserts both an `undefined` result and that the third proxy is stopped (`:762-770`).

No new findings.

Score: **6/10**  
Verdict: **REVISE**

1. **Major — rotating a proxy-provider credential can kill a still-running session in that same workspace.** `WorkspaceProviderProfileResolver` acquires a pool entry for every start/resume at `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:362-366`. Once a new fingerprint is acquired, `ProviderProxyPool.bindScope` adds only the workspace identity to the replacement then removes that identity from every older entry for the same provider and immediately stops an unreferenced older entry at `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:326-342`. The pool has no session identifier or active-query reference count (`ProxyPoolEntry.scopes` is only `Set<string>` at `:95-120`). Scenario: workspace A is streaming through the Sakana/OpenCode proxy built with key K1; the key rotates to K2 and a child session, handover successor, or second tab starts/resumes. Acquiring K2 unbinds A from K1 and stops K1, even though the first session still has K1's `ANTHROPIC_BASE_URL` snapshot. That live turn fails mid-stream. Suggested fix: retain proxy leases per SDK session/query and release them from the session end/dispose path; only stop a superseded entry after its final session lease ends, not when a workspace rebinds.

2. **Major — close/shutdown racing an in-flight proxy start leaks a listener and leaves a closed scope bound.** `disposeForScope` enumerates only materialized `entries` at `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:543-554`, while starts are held separately in `starting` at `:148-155,257-269`. If the workspace is removed (or `disposeAll` runs at `:567-580`) after `acquire` begins but before `createAndStartEntry` inserts the entry at `:304-318`, disposal sees nothing. When `proxy.start()` completes, `acquire` then binds the now-closed workspace at `:252`, so neither disposal call stops the port. Scenario: immediately close a folder/app after starting chat for a proxy provider, especially on a slow OAuth/readiness or port start. The orphan proxy remains until process exit; in a long-lived Electron host this accumulates ports. Suggested fix: track pending acquisitions by scope plus a pool disposal generation/cancellation state; after awaiting `startEntry`, reject and stop an entry whose scope was released or whose pool has been disposed. `disposeForScope`/`disposeAll` must also settle or cancel matching `starting` operations.

3. **Minor — proxy construction failures after partially allocating a server are not cleaned up.** On `proxy.start()` rejection, `createAndStartEntry` logs and returns at `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts:287-302`; it does not call `proxy.stop()`. The code cannot assume every proxy implementation rolls back a partially bound listener on every failure. Scenario: a proxy binds its port, then throws during late initialization; retrying chat can consume additional ports. Suggested fix: best-effort `await proxy.stop()` in the catch, logging a separate cleanup failure, before returning `undefined`.

## Decisions

- Static-only review: per instruction, no diagnostics, tests, builds, typechecks, lint, or Nx/Jest command was run. The score is therefore logic-evidence based.
- The existing file has no H1 title; this Round 2 section was inserted at its actual top without deleting the Round 1 content.
- A 6/10 reflects that the requested provider snapshot and error-routing paths are wired, but proxy lifetime is keyed to a workspace rather than the sessions that still hold a proxy URL. Removing those two major lifecycle failures would support the adjacent 7/10 band; the remaining cleanup gap prevents an 8/10 assessment.

## Verified OK

- **1. Snapshot coverage:** `launchSdkSession` supplies the resolved profile to `startChatSession` for start, child, and handover paths (`chat-session.service.ts:827-903`); inactive continue/resume resolves and supplies it (`:1572-1610`); slash relaunch does the same (`chat-slash-command-router.service.ts:123-155`). The adapter forwards it to query execution for start (`sdk-agent-adapter.ts:823-870`), resume (`:1115-1157`), and slash (`:1486-1535`); the lifecycle forwards slash `authEnvOverride` at `session-lifecycle-manager.ts:862-890`. Gateway bridge was excluded as requested.
- **2. Fail-closed routing:** absent profiles are allowed only for exact `{authMethod, providerId}` equality with `AuthManager.getConfiguredAuth()` and otherwise throw `AuthRequiredError` with provider id (`workspace-provider-profile-resolver.ts:99-142`). Start/resume return `authErrorFields` (`chat-session.service.ts:456-467, 1619-1635`), and slash maps the same error to `AUTH_REQUIRED` (`chat-slash-command-router.service.ts:160-178`).
- **3. Shared-env identity:** `AuthManager` clears `configuredAuth` before clearing/reconfiguring (`auth-manager.ts:168-175`), sets it only after a successful strategy result (`:206-214`), and clears it in `clearAuthentication` (`:244-257`). Its `apiKey`/`claudeCli` mapping uses the direct Anthropic provider and its third-party mapping delegates to `ActiveProviderResolver` (`:272-295`), matching the resolver's active-auth source (`workspace-provider-profile-resolver.ts:103-104`).
- **4. Pool sharing mechanics:** the key is provider plus fingerprint (`provider-proxy-pool.ts:140-175`), same-key starts share `starting` (`:257-269`), and same-provider fingerprint changes use `bindScope` (`:326-344`). The lifetime races above prevent this focus from being fully approved.
- **5. Single-workspace behavior:** a normal single workspace receives either a direct profile (`workspace-provider-profile-resolver.ts:232-339`) or its pooled proxy profile (`:356-393`); no new rejection occurs when profile construction succeeds. The explicit no-profile fallback only accepts the same configured provider (`:114-124`).
- **6. DI/constructor wiring:** both added resolver dependencies are token-injected (`workspace-provider-profile-resolver.ts:66-80`, `chat-slash-command-router.service.ts:48-59`), registered singleton before chat resolution (`auth-providers/src/lib/di/register.ts:98-106`), and the VS Code/Electron hosts register auth providers before handlers/chat (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:152`, `phase-3-handlers.ts:68`; `apps/ptah-electron/src/di/phase-2-libraries.ts:197`, `phase-4-handlers.ts:90`). Repository search found no `registerChatServices` or `registerAuthProvidersServices` invocation in `apps/ptah-cli`; the CLI does not resolve this RPC chat service, so its unchanged composition does not instantiate these new constructor paths.

## Round 1 re-review

APPROVED — 9/10 (static re-review of the two Round 1 fixes only). Both prior findings are fixed, and this limited pass found no new defect introduced by either change.

| Prior finding | Status | Evidence |
|---|---|---|
| Workspace-targeted model/effort save could silently fall back to global when no workspace was active | FIXED | `libs/backend/settings-core/src/repositories/computed-setting-handle.ts:66-76` validates the value, then rejects `target === 'workspace'` when `resolver.getActivePath()` is absent before `resolver.write` or `clearMoreSpecific` can run. `WorkspaceScopeResolver.getActivePath()` returns `activeNormalizedPath()` at `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:60-64,115-117`; workspace writes use that identical normalization at `:254-265`. The no-write/no-clear regression is covered at `libs/backend/settings-core/src/settings-core.spec.ts:1132-1140`, and an RPC model-switch failure response is covered at `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.spec.ts:371-388`. The UI only offers workspace where `config:getScopes` has an active path at `libs/frontend/core/src/lib/services/providers-settings-state.service.ts:852-859`; that value is the resolver’s normalized path at `libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.ts:78-90`. Host registration is present in VS Code at `apps/ptah-extension-vscode/src/activation/bootstrap.ts:126-136`, Electron at `apps/ptah-electron/src/activation/bootstrap.ts:264-277`, and CLI at `libs/backend/cli-engine/src/lib/container.ts:783-797`. |
| Disabled Save was not distinct enough in dark theme | FIXED | `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts:28-29` defines explicit disabled border, background, and foreground utilities; the Save button applies them at `:202-206` while retaining native disabled semantics. |

No new finding: the handle-level guard deliberately leaves `WorkspaceScopeResolver.write` unchanged, preserving its documented global-fallback behavior for callers such as output-style selection while making the scoped model/effort repository contract fail closed.

## Verdict

REVISE — 6/10. One high-severity silent scope-escalation remains at the backend boundary; the submitted workspace-isolation paths and all eight earlier workflow findings are otherwise addressed. This is above 5 because the new resolver and explicit snapshot propagation cover the requested workflows, but below 7 because a caller can still ask for a workspace-only model/effort write and overwrite the global default instead. A 7 would require that contract to reject absent workspace context rather than silently widening it.

## Findings

1. **high — a workspace-targeted model or effort write silently becomes a global write when no active path exists.** Evidence: `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:254-258` writes `globalKey` when `target === 'workspace'` and there is no normalized active path. `ComputedSettingHandle.set` delegates both the provider-specific selected-model and effort keys to that method at `libs/backend/settings-core/src/repositories/computed-setting-handle.ts:61-70`; the RPC handlers accept the target and call those handles without their own active-workspace guard at `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:255-259` and `:669-677`. Failure scenario: a host or stale frontend sends `{ applyTo: 'workspace' }` after its workspace has closed; the user sees a successful workspace save, but `provider.<authKey>.selectedModel` or `.reasoningEffort` is changed globally and affects other workspaces. Minimal fix: make `WorkspaceScopeResolver.write(..., 'workspace')` throw when no active path (as `writeForPath` already does at `workspace-scope-resolver.ts:216-235`), or reject the RPC before calling the repository. Keep any legacy caller that intentionally wants global fallback explicit.

2. **low — the disabled Save action is not sufficiently distinguishable in the supplied dark-theme evidence.** Evidence: the button uses only `btn btn-primary` with the framework disabled state at `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts:200-202`; in `screenshots/main-agent-popover-after-dark.png`, the disabled “Save” label is barely perceptible against the footer. Failure scenario: on initial open, where Save is deliberately disabled, a user can mistake the control for absent rather than understand that a change is required. Minimal fix: add a disabled foreground/opacity class with a tested dark-theme contrast treatment (while retaining the native disabled semantics).

## Prior findings status

| # | Status | Evidence |
|---|---|---|
| 1 | FIXED | `multi-phase-analysis.service.ts:172-176` resolves the target root snapshot and `:649-661` passes its model/auth to the query. |
| 2 | FIXED | `content-generation.service.ts:355-358,400-412` and `enhanced-prompts.service.ts:839-863` resolve and pass one path-bound snapshot; the hard-coded customization service is deleted in the diff. |
| 3 | FIXED | `prompt-enhancement.component.ts:299-307` derives the analysis workspace root instead of sending `'.'`; `analyzedWorkspaceRoot` is defined at `:26-35`. |
| 4 | FIXED | `computed-setting-handle.ts:92-126` watches all scoped auth/provider/model candidates and recreates subscriptions when a relevant key changes. |
| 5 | FIXED | `welcome.component.ts:385-398` selects `workspace` whenever it is offered, otherwise global. |
| 6 | FIXED | `job-runner.ts:257-273` resolves the job root through `workspaceLlm.resolveForPath` and passes the resulting `model` and optional `auth` to the prompt execution. |
| 7 | FIXED | `commit-message-generator.service.ts:116-123,148-161` resolves with its `workspaceRoot` and carries the resulting auth override; `:186-202` intentionally retains the cheap tier alias under that override. |
| 8 | FIXED | `memory-curator.service.ts:286` propagates `workspaceRoot`; `sdk-internal-query.curator-llm.ts:239-283,444-464` resolves/uses it for the inherited-curator path. |

## User bugs status

| Bug | Status | Evidence |
|---|---|---|
| New-folder Save to defaulted global | FIXED | The popover chooses `workspace` before stored source/first target at `main-agent-reassign-popover.component.ts:287-293`; the welcome selector applies the same policy at `welcome.component.ts:385-398`. |
| Workspace provider save ends sessions in other workspaces | FIXED for the reviewed paths | `connection-settings-methods.ts:114-130` routes workspace writes to `applyWorkspaceAuthChange`; that calls `disposeSessionsForWorkspace` only at `sdk-agent-adapter.ts:760-771`. The secret-change watcher stands down during the write at `sdk-agent-adapter.ts:276-283`, and `auth:clearWorkspaceOverride` uses the same path at `workspace-scope-methods.ts:110-123`. |
| Setup Hub sends new provider with old model | FIXED | `ComputedSettingHandle.set` clears narrower overrides after write at `computed-setting-handle.ts:61-70`; `active-provider-auth-key.ts:27-37` normalizes auth and defaults provider ID identically to UI key construction. |

## Write-path trace

| Writer file:line | Key | Scope | Value format | Runtime reader file:line (scope read) | Side effects | Verdict |
|---|---|---|---|---|---|---|
| `connection-settings-methods.ts:168-174` (`auth:saveSettings`) | `authMethod` | global / app / workspace-hashed | normalized auth enum | `active-provider-auth-key.ts:27-31` (active resolver scope); `workspace-llm-resolver.ts:66-80` (explicit root) | Clears narrower active-path overrides; workspace route disposes only matching sessions | intended |
| `connection-settings-methods.ts:175-201` | `ptah.auth.apiKey`, `ptah.auth.provider.<providerId>` secrets | process-wide secret storage | trimmed secret or deletion | `workspace-provider-profile-resolver.ts` provider profile (explicit root config, shared secret) | connection-check cache cleared, provider-model cache cleared; watcher is suppressed while workspace write is in flight | intended |
| `connection-settings-methods.ts:203-214` | `anthropicProviderId` | global / app / workspace-hashed | provider ID string | `active-provider-auth-key.ts:32-37` (active) and `workspace-llm-resolver.ts:66-76` (explicit root) | clears narrower active-path overrides; auto-maps unset tiers | intended |
| `workspace-scope-methods.ts:97-107` (`auth:clearWorkspaceOverride`) | `authMethod`, `anthropicProviderId`, `provider.<authKey>.selectedModel`, `provider.<authKey>.reasoningEffort` | nearest active workspace/app override removed | `undefined` tombstone | same readers as above | workspace path uses scoped session disposal; no path invokes full reset | intended |
| `computed-setting-handle.ts:61-70`, reached by `config:model-switch` at `config-rpc.handlers.ts:197` / `config:model-set` at `:255-259` | exact `provider.<authKey>.selectedModel` | requested global / app / workspace-hashed | validated model string | `model-settings.ts:31-40` (active); `workspace-llm-resolver.ts:73-80` (explicit root) | clears narrower active-path override; model watchers resubscribe | **BUG** when workspace is requested with no active path: it becomes global (`workspace-scope-resolver.ts:254-258`) |
| `computed-setting-handle.ts:61-70`, reached by `config:effort-set` at `config-rpc.handlers.ts:669-677` | exact `provider.<authKey>.reasoningEffort` | requested global / app / workspace-hashed | validated effort string or empty default | `reasoning-settings.ts:31-40` (active) | clears narrower active-path override; may sync the named session | **BUG** under the same missing-path fallback |
| `main-agent-reassign-popover.component.ts:484` | provider auth keys above, through `auth:saveSettings` | draft’s selected global/app/workspace target | selected connection’s auth method/provider ID | auth readers above | provider is committed first; a failed/blocked provider write stops model/effort write | intended |
| `main-agent-reassign-popover.component.ts:530-545` | `provider.<new authKey>.selectedModel` and/or `.reasoningEffort` | draft’s selected target | model ID and effort in one `state.saveSettings` patch | computed repositories above (current provider after activation) | follows provider write; Undo uses the same target | intended |
| `welcome.component.ts:394-398` | provider auth keys above | workspace if available, else global | selected provider connection | auth readers above | refreshes route/model after committed selection | intended |

## Decisions

- Static review only: no tests, builds, Nx targets, Jest, or state-changing Git commands were run. Scoped diagnostics were requested for five representative changed files but the TypeScript service did not finish within its 45-second availability window, so they are unchecked rather than treated as passing.
- The review read the changed implementation paths and their relevant runtime readers, plus the supplied handoff, implementation notes, earlier review, change status, and dark screenshot. `.ptah/specs` was not treated as source under review.
- `WorkspaceLlmResolver` deliberately logs the fallback to process-wide auth when it cannot construct a snapshot (`workspace-llm-resolver.ts:106-111`); this is observable rather than a silent-success finding. Stale-model fallback is likewise warned at `:159-175`.
- Five logic questions: (1) silent failure remains the no-active-path workspace write that becomes global; (2) closing/switching a workspace before a queued workspace model/effort save produces it; (3) any valid model/effort with `applyTo: 'workspace'` and no active path is the wrong-answer input; (4) unresolved snapshot dependencies produce a logged process-auth fallback, while popover provider failure stops the follow-up settings write at `main-agent-reassign-popover.component.ts:483-498`; (5) requirements still need an explicit contract for workspace-targeted settings with no active root, rather than relying on a global fallback.

## Clarifications Needed

None.
