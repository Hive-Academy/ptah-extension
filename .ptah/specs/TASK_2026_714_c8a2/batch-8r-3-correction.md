# Batch 8r-3 correction

## What changed

- `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:39,130-131`: removed the workspace profile resolver import and constructor dependency.
- `config-rpc.handlers.ts:522,676-717`: `config:models-list` now captures the requested provider and saved model, then makes one shallow snapshot of `SDK_AUTH_ENV` synchronously before catalog awaits for either scope. The removed `workspaceResolutionEnv` method no longer starts a workspace profile resolution. The existing scope-specific settings read, cached IDs, tier overrides, subscription check, and reply path remain.
- `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.spec.ts:69-72,177-272`: removed the profile mock type, helpers, harness option and field, and constructor argument. Removed every profile resolver call assertion.

## Specs removed, changed, or added

- Removed `refuses a workspace path when no profile resolver is registered` (formerly around `config-rpc.handlers.spec.ts:1253`).
- Changed `appends a saved Claude id the catalog omits when the null-scope env is native Claude CLI` (`:1341`) and `resolves a null-scope saved alias from the live-derived tier on the shared auth env` (`:1429`) only to remove obsolete profile mock assertions.
- Changed `appends a saved Claude id for an explicit claude-cli workspace with empty native auth env` (`:1384`): the requested workspace still supplies `claude-cli` and saved `claude-haiku-4-5`, and the empty shared env allows the saved static option to be appended.
- Changed `resolves an explicit-scope saved alias from the shared env snapshot before the catalog await` (`:1490`): gates the catalog, mutates the shared env during the wait, and checks the original tier, scoped provider, saved alias, and subscription env.
- Changed `resolves and prices an explicit workspace alias from the shared env while the ambient model differs` (`:1559`): checks scoped provider and saved alias with shared-env resolution and subscription pricing.
- Changed `uses the shared auth env and ambient model for a null scope` (`:1625`) and `uses the shared auth env for an explicit workspace scope` (`:1693`) to remove profile-specific expectations and terminology.
- Added no separate spec; the existing explicit-scope cases now cover the replacement behavior.

## Anything not done

- No verify, build, test, lint, typecheck, or diagnostics were run, per the batch instructions. No commit or other Git mutation was made.
- Skill discovery was available, but returned no matching invocable local skill for this scoped RPC correction.

## Coordinator correction 2 (after review-8r-3-correction.md REVISE 6/10)

Defect 1 (a same-scope read that started before the workspace auth refresh used the previous
workspace's auth env, and the post-auth `refreshModels()` joined it) is fixed on the frontend,
without backend proxy or credential side effects:

- `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts`
  `refreshWorkspaceProviderState` now calls `modelState.refreshModels({ fresh: true })` after
  auth resolves. A fresh read never joins an in-flight read and takes a newer generation, so the
  pre-auth reply is dropped by the generation check in `ModelStateService.fetchModels`
  (already pinned by `model-state.service.spec.ts` "a fresh refresh does not join a pre-switch
  read, and the late pre-switch answer is dropped"). Stale doc comment replaced.
- `workspace-coordinator.service.spec.ts` asserts the `{ fresh: true }` call.
- `config-rpc.handlers.ts` doc comment no longer mentions the removed explicit-scope profile.
Cost: up to one extra models-list RPC per workspace switch (the coordinator read never joins;
a provider-changing switch can also start the fresh read in auth-state.service.ts).
Independent review: review-8r-3-correction-2.md APPROVE 9/10 (Kimi), no defects.
