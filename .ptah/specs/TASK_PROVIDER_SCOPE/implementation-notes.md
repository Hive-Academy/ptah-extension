# TASK_PROVIDER_SCOPE — implementation notes

Worktree: `.claude-worktrees/workspace-provider-scope` (branch `fix/workspace-provider-scope-isolation`), uncommitted.

## Batch 1 — foundation

- `agent-sdk/src/lib/auth/workspace-llm-resolver.port.ts` (new), `index.ts`, `di/tokens.ts`: `IWorkspaceLlmResolver.resolveForPath(root, { requestedModel })` → `{ providerId, model, auth?, cooldownMs? }`; token `SDK_WORKSPACE_LLM_RESOLVER`. Port in agent-sdk, implementation in auth-providers (same split as `IProviderAuthResolver`).
- `auth-providers/src/lib/auth/workspace-llm-resolver.ts` (new, registered in `di/register.ts`, exported): provider from `resolveActiveAuthForPath(path)`, model from `readForPath('provider.<authKey>.selectedModel', path)`, credentials from `WorkspaceProviderProfileResolver.buildProfileForPath` (the chat snapshot builder). `''`/undefined root → app then global, explicitly.
- `workspace-provider-profile-resolver.ts`: `buildProfileForPath` split out of `resolveProviderProfileForWorkspace` (no "explicit override" gate), so a workspace without an override gets an explicit global/app snapshot instead of the process-wide `authEnv`.
- `provider-models.service.ts`: `getCachedModelIds(providerId)`. Stale-model pre-flight: a model not in the provider's cached list → first tier (opus/sonnet/haiku) the list contains, warn; no list → keep. A `requestedModel` is kept only if the snapshot's provider offers it (catalogue for third-party; `claude-*`/tier alias for direct Anthropic).
- `rpc-handlers/.../harness-llm-runner.service.ts`: uses the port; `model` became an optional request. The four harness services no longer read ambient `ModelSettings`.
- `settings-core/.../computed-setting-handle.ts` + `workspace-scope-resolver.ts` (`scopedKeys`): `watch` subscribes to every candidate key (all scopes) of `authMethod`, `anthropicProviderId` and the model key, and re-derives the set after each change, so hashed workspace writes re-target the model watcher (finding 4).
- `rpc-handlers/.../auth/workspace-scope-methods.ts`: `auth:clearWorkspaceOverride` uses `applyWorkspaceAuthChange` when a workspace is active (reset only for the app-level case); provider key derived with `normalizeAuthMethod`/`DEFAULT_PROVIDER_ID`.

## Batch 2 — setup wizard + enhanced prompts

- `agent-generation`: `multi-phase-analysis.service.ts`, `content-generation.service.ts`, `enhanced-prompts.service.ts`, `agentic-analysis.service.ts` resolve `{ model, auth }` for their workspace root and pass both to every `execute`; caller/frontend model is only a validated request. Multi-phase phases use the snapshot model, not a resumed manifest's.
- `rpc-handlers/.../setup-rpc.handlers.ts`: ambient `ModelSettings` removed (ctor + `constructor-signatures.typecheck.ts` guard updated).
- `AgentCustomizationService` deleted (service, spec, interface, token, barrel exports).
- Frontend: `prompt-enhancement.component.ts` sends the analyzed workspace root (derived from `analysisDir`, else `WorkspaceScopeService.activeWorkspacePath()`, else `.`); `system-prompt-drawer` and `agent-behaviour-section` send `WorkspaceScopeService.activeWorkspacePath() ?? '.'` (VS Code tracks none → backend resolves `.` as before).

## Batch 3 — background workflows

- `cron-scheduler/job-runner.ts`: prompt jobs resolve the snapshot for `job.workspaceRoot` (rootless → app/global) and pass `model` + `auth`.
- `agent-sdk/commit-message-generator.service.ts`: `resolveAuth(workspaceRoot)` via the port; keeps the cheap tier alias as model (resolved against the snapshot env); `cooldownMs` → `rate-limited`.
- `memory-contracts/curator-llm.port.ts` (`CuratorCallOptions.workspaceRoot`), `memory-curator.service.ts` (passes it), `agent-sdk/curator-llm-adapter/sdk-internal-query.curator-llm.ts`: with no pinned curator provider the pass inherits the curated workspace's snapshot (cooldown → stalled); cwd is the curated root, rootless → home dir (no longer the active workspace). A pinned curator provider keeps the existing `IProviderAuthResolver` path.

## Decisions / skipped

- `WorkspaceScopeResolver.write(…, 'workspace')` still falls back to global without an active path (output-style selection relies on it); the auth handlers guard instead.
- No snapshot → the query rides the process-wide auth (logged). Happens only when credentials are missing / unknown provider / proxy start failure.
- Curator provider/model config (`memory.curatorProvider/Model`) is still read from the host configuration (global), not per workspace.
- `effective-route-method.ts` still derives its diagnostic model key from the raw stored authMethod.
- Not run: app-level DI/e2e specs, workspace-wide checks.
