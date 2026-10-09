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
