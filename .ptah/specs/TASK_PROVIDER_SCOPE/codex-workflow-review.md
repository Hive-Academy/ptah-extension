## Summary

One-shot LLM work is not workspace-isolated: when a caller omits `auth`, `SdkQueryRunner` uses the process-wide `authEnv`.
Several path-bearing wizard and background workflows independently obtain the model through an ambient `ModelSettings.selectedModel`, which is keyed to the active workspace rather than their target path.
This produces provider/model mismatches and cross-workspace billing/execution whenever a shared Electron backend has a different workspace active.
The scoped model handle also does not observe scoped auth-key writes, leaving frontend model state stale after a workspace provider switch.

## Findings

1. **Setup-wizard deep analysis binds its target workspace to ambient provider/model state** — **high**

   Evidence: `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts:305-325` accepts an authorized `params.workspacePath` as `workspaceRoot`, then reads `modelSettings.selectedModel.get()` without that path; `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts:171` repeats the ambient fallback and `:641-650` calls the internal query without `auth`. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:468-480` consequently takes the injected process `authEnv` while retaining that separately supplied model.

   Failure scenario: open workspaces A and B, configure A for provider/model A, configure B for provider/model B, make B active, then resume or launch A's wizard using its authorized workspace path. Analysis is run in A but can send B's model string to the process provider (or the reverse after an active-workspace switch), causing model-not-found failures or charging/routing through the wrong connection.

   Minimal fix: create a path-aware provider/model snapshot before launching the analysis (auth method, provider id, tier/model resolved with `readForPath` for `workspaceRoot`), and pass both `model` and `auth` to every phase's `InternalQueryService.execute`. Do not re-read ambient `ModelSettings` in the phase service.

2. **Wizard agent generation, enhanced prompts, and customization issue one-shots without a target-workspace auth snapshot** — **high**

   Evidence: content generation falls back to `modelSettings.selectedModel.get()` at `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:351-353` and invokes without `auth` at `:395-406`; enhanced prompts does the same at `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:837-853`; agent customization hard-codes `gpt-4o-mini` and likewise omits `auth` at `libs/backend/agent-generation/src/lib/services/agent-customization.service.ts:192-200`. The shared runner's process-auth fallback is at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:468-480`.

   Failure scenario: start wizard analysis/generation for A, then switch the shared host's active workspace to B before generation continues. Agent sections or enhanced prompts for A run with B's process provider; they either use B's account or submit an A/provider-specific model to B. The customization route can additionally submit its fixed OpenAI model to any active non-OpenAI provider.

   Minimal fix: carry a required `{ model, auth }` snapshot, resolved for the generation `rootPath`, in the wizard/SDK config through content generation, enhanced prompts, and customization. Resolve tier aliases against that same auth override; replace the fixed customization model with a provider-compatible configured tier (or explicitly resolve an OpenAI override).

3. **Enhanced-prompts wizard changes the workspace identity to whichever workspace is active** — **high**

   Evidence: `libs/frontend/setup-wizard/src/lib/components/prompt-enhancement.component.ts:273-286` discards the analyzed workspace and sends `workspacePath = '.'`; `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:341-347` resolves its SDK config from the incoming model only, and `:698-738` has no path-aware provider/model lookup.

   Failure scenario: finish analysis for A, change active workspace to B before the auto-triggered prompt-enhancement step, then let it run. `.` resolves to B, so the call uses B's storage/configuration (and the ambient process auth) while the analysis directory belongs to A; it either rejects the directory as outside B or generates guidance under B with the wrong provider/model.

   Minimal fix: persist the canonical workspace root with the multi-phase result and send it instead of `.`. In the RPC handler resolve model and auth for that canonical root, ignoring a stale frontend model unless it is validated against the same provider snapshot.

4. **Workspace-scoped provider changes do not retarget computed model watchers** — **high**

   Evidence: `libs/backend/settings-core/src/repositories/model-settings.ts:31-42` makes the physical selected-model key depend on resolver-scoped `authMethod` and `anthropicProviderId`; `libs/backend/settings-core/src/repositories/computed-setting-handle.ts:92-99` watches only the unscoped raw keys. A workspace write instead stores a hashed workspace key at `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:242-255`, so it never invokes either subscription.

   Failure scenario: in workspace A save a workspace-scoped switch from provider P1 to P2. UI code watching `selectedModel` remains subscribed to P1's computed key and can continue displaying/sending P1's model, while a later backend lookup resolves P2. Wizard calls that include `ModelStateService.currentModel()` can therefore send an old-provider model immediately after the provider change.

   Minimal fix: make `ComputedSettingHandle.watch` subscribe to resolver-effective/scoped auth keys (and re-subscribe when their effective key changes), or expose a resolver-level change event for those logical keys. Recompute the model signal before enabling dependent RPC actions.

5. **Wizard welcome's provider selector always saves globally** — **medium**

   Evidence: `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts:376-396` calls `activateConnection(providerId, 'global', context)` unconditionally despite operating in an open workspace.

   Failure scenario: while setting up workspace A, choose a provider in the wizard welcome selector. The action changes the global provider instead of A's workspace setting; B and subsequently opened workspaces inherit the choice, while A's existing narrower override may continue to shadow it.

   Minimal fix: derive the target from the current workspace/save-scope context (normally `workspace` when a workspace is open), offer an explicit scope choice if global is intended, and refresh model state only after the scoped save completes.

6. **Scheduled jobs use a workspace cwd but process-global provider/model** — **high**

   Evidence: `libs/backend/cron-scheduler/src/lib/job-runner.ts:257-266` passes `job.workspaceRoot` as `cwd` but uses `model: ''` and no `auth`; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:468-480` then resolves the one-shot against its injected process auth/model services.

   Failure scenario: schedule a prompt for workspace A, switch the shared backend to B, and let the job fire. It accesses A's files but sends the task to B's provider and default tier, rather than A's configured provider/model.

   Minimal fix: make scheduled jobs retain their workspace root and resolve/pass a per-root auth/model snapshot at dispatch. Treat a missing or unresolvable root as an explicit no-workspace/global policy, not as an ambient active-workspace read.

7. **Commit-message generation ignores its explicit workspace root for provider resolution** — **high**

   Evidence: `libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts:150-159` resolves a named registered root and passes it to `generate(root)`; `libs/backend/agent-sdk/src/lib/commit-message/commit-message-generator.service.ts:146-154` calls `resolver.resolve('')`, which means the active provider, and `:189-202` executes with that auth while deliberately using `os.tmpdir()` as cwd. `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts:142-152` obtains the active provider with no workspace-path parameter.

   Failure scenario: request a commit message for A from a multi-workspace UI while B is active. The staged diff correctly comes from A, but the generated message uses B's provider/tier and credentials.

   Minimal fix: extend the provider/model resolver API with an explicit workspace path and use it in `CommitMessageGenerator.generate(workspaceRoot)`; pass the returned snapshot to the one-shot. Keep `os.tmpdir()` only as the safe execution cwd.

8. **Memory curation loses the session workspace before resolving provider/model** — **high**

   Evidence: curation inputs carry `workspaceRoot` at `libs/backend/memory-curator/src/lib/memory-curator.service.ts:128-135`, but `libs/backend/memory-curator/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:257-270` instead reads the current `IWorkspaceProvider` configuration/root. Its query uses that ambient result at `:417-445`; `resolveCuratorAuth` resolves against the active provider at `:229-234`.

   Failure scenario: a queued compaction curation for session/workspace A runs after B becomes active. It can read A's transcript but use B's curator provider/model and B's MCP workspace, so memory extraction/merging is billed and executed against the wrong workspace configuration.

   Minimal fix: add `workspaceRoot` to `ICuratorLLM` call options, propagate it from the curation input/window runner, and resolve curator config, active provider, model, cwd, and auth from that explicit root. Avoid fallback to the active workspace for queued work.

## Checked and OK

- `libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts:382-393` builds a draft-specific `auth` override and passes it together with the draft-selected probe model.
- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts:2251-2280` preserves an explicit scope selection; its defaulting logic selects app scope rather than forcing global.
- `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts:623-647` forwards the lane resolver's model and auth snapshot together for a configured lane provider (the inherited/active-provider policy still needs a path-aware resolver before lane work is made multi-workspace).

## Decisions

- Excluded the five defects named in the task statement, including the harness runner missing-auth case and `ComputedSettingHandle.set` not clearing narrower overrides.
- Counted a workflow only where source evidence showed a distinct call path or stale-state mechanism; the shared `SdkQueryRunner` fallback is cited as the common cause rather than restated as a finding.

## Open questions

- `IProviderAuthResolver` and `ActiveProviderResolver` currently have no path argument. Decide whether to add `resolveForPath`/snapshot APIs or a short-lived path-bound resolver context; implicit active-workspace mutation would reintroduce the cross-workspace race.
- Confirm whether scheduled jobs and background curator runs are intended to honor workspace overrides. Their stored `workspaceRoot` strongly indicates that they are, but the desired policy for rootless jobs/sessions should be explicit.
