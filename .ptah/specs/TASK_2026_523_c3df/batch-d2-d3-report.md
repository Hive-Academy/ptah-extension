# Batch D-ii + D-iii - atomic Providers mount and editor replacement

## Files changed

- ADDED `libs/frontend/core/src/lib/services/effort-settings-change.service.ts` - value-free revision/pending-write invalidation shared by runtime writers and Providers.
- MODIFIED `libs/frontend/core/src/lib/services/effort-state.service.ts` - bracket existing writes with invalidation; preserve persistence, optimistic runtime UI and live-session synchronization.

- MODIFIED `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts` - Honor a supplied local draft URL without changing resolve(); retain cooldown and tier construction.
- MODIFIED `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.spec.ts` - Four draft URL selection and persisted fallback cases.
- MODIFIED `libs/frontend/core/src/lib/services/app-state.service.ts` - Providers tab and field-target navigation contract.
- MODIFIED `libs/frontend/core/src/lib/services/providers-settings-state.service.ts` - Connection setup reads, CLI test/key facade, truthful activation/external actions, and runtime effort invalidation with effective-value readback.
- MODIFIED `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts` - Direct activation/connect-only boundary, non-secret setup reads, and three runtime effort freshness regression cases.
- MODIFIED `libs/frontend/chat/src/lib/settings/settings.component.ts` - Mount coordinator, normalize old deep links, remove old imports.
- MODIFIED `libs/frontend/chat/src/lib/settings/settings.component.html` - Providers replaces authentication/model editors; CLI manager moves out of orchestration.
- MODIFIED `libs/frontend/chat/src/lib/settings/settings.component.spec.ts` - Providers mount/deep-link assertions replace obsolete auth-editor assertions.
- MODIFIED `libs/frontend/chat/src/lib/settings/index.ts` - Remove obsolete exports from the already-existing barrel.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` - Compose CLI manager; provider-aware wizard setup/auth/context/readback.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts` - Update service and wizard seam stubs for integration.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts` - Existing setup input, provider-aware actions, context/error inputs, draft credential requirement and direct-key activation-only flow.
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.spec.ts` - Require draft credentials and assert provider-aware external outcomes.
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts` - Rework existing manager as Providers CLI section using host registry and state owner.
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts` - Remove model/effort/key editors; retain concurrency/execution policy and navigation.
- MODIFIED `libs/frontend/chat/src/lib/settings/pro-features/vscode-lm-config.component.ts` - Remove stale deleted-component reference from comment.
- MODIFIED `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts` - Read-only curator summary and Providers link; preserve trigger controls.
- MODIFIED `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.spec.ts` - Verify summary/link and absence of curator writes.
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts` - Remove four lane pickers and judge text field; preserve policy controls and add links.
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.spec.ts` - Verify replacement links and retained policy controls.
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts` - Remove lane persistence/form ownership; exclude Providers fields from policy saves.
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts` - Update policy-only form expectations.
- MODIFIED `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts` - Replace persisted global-model editor with Providers navigation.
- DELETED `libs/frontend/chat/src/lib/settings/auth/auth-config.component.ts` - obsolete editor or its now-unused child/test/template.
- DELETED `libs/frontend/chat/src/lib/settings/auth/auth-config.component.html` - obsolete editor or its now-unused child/test/template.
- DELETED `libs/frontend/chat/src/lib/settings/auth/auth-config.component.spec.ts` - obsolete editor or its now-unused child/test/template.
- DELETED `libs/frontend/chat/src/lib/settings/auth/provider-model-selector.component.ts` - obsolete editor or its now-unused child/test/template.
- DELETED `libs/frontend/chat/src/lib/settings/auth/custom-provider-form.component.ts` - obsolete editor or its now-unused child/test/template.
- DELETED `libs/frontend/chat/src/lib/settings/auth/custom-provider-form.component.html` - obsolete editor or its now-unused child/test/template.
- DELETED `libs/frontend/chat/src/lib/settings/auth/custom-provider-form.component.spec.ts` - obsolete editor or its now-unused child/test/template.
- DELETED `libs/frontend/chat/src/lib/settings/ptah-ai/llm-providers-config.component.ts` - obsolete editor or its now-unused child/test/template.
- DELETED `libs/frontend/chat/src/lib/settings/ptah-ai/llm-providers-config.component.html` - obsolete editor or its now-unused child/test/template.
- REWRITTEN `.ptah/specs/TASK_2026_523_c3df/batch-d2-d3-report.md` - this report.

All application edits are inside this worktree. No install, stage, commit, push or history change. The mount and all eight named treatments coexist in this working tree; do not commit them separately. The orchestrator explicitly exempted the four existing runtime effort writers; the mitigation and source evidence are below.

## The eight treatments

| # | Named treatment | Implemented outcome |
|---|---|---|
| 1 | REPLACE | Deleted authentication strategy/tile editor and its spec/template. Wizard owns credential variants and external-auth actions. |
| 2 | REPLACE UI, PRESERVE persistence | Deleted provider model selector. Wizard model mappings use the shared picker and the unchanged provider:getModelTiers/provider:setModelTier RPC family through the state service. |
| 3 | MOVE and REWORK in place | Existing PtahCliConfigComponent is mounted under Providers and uses merged host inventory; instance create/update/delete, model, credential and connection-test controls remain together. |
| 4 | MOVE provider/model/credential controls | Delegated model/effort and Cursor credential editing moved into the Providers CLI manager. Orchestration retains concurrency, enabled/order and execution policy, with Manage links. |
| 5 | REMOVE editor | Memory retains trigger policy plus a read-only curator summary and Manage link. A pinned provider without a model reports its provider tier rather than incorrectly showing the main-agent model. |
| 6 | REMOVE four mounts | Skills lane pickers and parent lane save path removed; links target archaeologist, synthesis, judge and replay. |
| 7 | REMOVE free text | Judge text control removed; policy save explicitly excludes judgeModel, judgeProvider and enhanceTimeoutMs. Background assignments own those edits. |
| 8 | AUDIT, then DELETE | Deleted obsolete provider component and HTML. No colocated spec or barrel export existed. Removed both stale source comment references. |

## Single-writer evidence

The single-writer gate is satisfied for the settings editors in the target key map, with the deliberate reasoning-effort exception documented under Accepted limitations. Runtime controls are preserved; they are not replaced to satisfy a source-count check. This reflects the orchestrator's interpretation of the invariant in batches.md and Decision 9's eight-entry scope.

Both chat selectors are restored exactly to their committed blobs. No formatting-only or behavior changes remain in either file. Workflows, Tribunal preview and Ultracode files were left untouched.

Owners after the eight treatments (all saves delegate to ProvidersSettingsStateService):

| Target key | Intended editor / observed path | Status |
|---|---|---|
| authMethod | ProvidersSettingsComponent activation and wizard commit -> connectProvider/activateConnection -> auth:saveSettings | Old authentication editor removed |
| anthropicProviderId | Same main-agent activation path | Old authentication editor removed |
| provider.<authKey>.selectedModel | ProvidersSettingsComponent model save; Welcome settings shortcut links here; existing chat runtime model control is unchanged | Old mapped-model editor removed |
| provider.<authKey>.reasoningEffort | ProvidersSettingsComponent effort save | **Deliberate runtime exception:** four preserved writers; fresh effective-value readback mitigates stale settings |
| provider.<id>.modelTier.{opus,sonnet,haiku} | Wizard emits mappings; coordinator -> connectProvider -> provider:setModelTier | Old selector deleted; RPC family preserved |
| ptahCliAgents | PtahCliConfigComponent -> state.saveSettings(cli) -> ptahCli:create/update/delete | Old standalone mount removed |
| agentOrchestration.*Model / *ReasoningEffort | PtahCliConfigComponent delegated editor -> state.saveSettings(orchestration) | Orchestration editor removed |
| memory.curatorProvider | ProviderConsumerAssignmentsComponent memory patch | Memory tab is read-only for this field |
| memory.curatorModel | Same memory patch | Memory tab is read-only for this field |
| skillSynthesis.<lane>.provider (four lanes) | ProviderConsumerAssignmentsComponent lane patch | Skills picker mounts/save path removed |
| skillSynthesis.<lane>.model (four lanes) | Same lane patch | Skills picker mounts/save path removed |
| skillSynthesis.judgeModel | ProviderConsumerAssignmentsComponent judging patch, preserving inherit sentinel | Skills free text removed |
| skillSynthesis.judgeProvider | Same judging patch | Policy save omits field |
| skillSynthesis.enhanceTimeoutMs | ProviderConsumerAssignmentsComponent timeout patch | Policy save omits field |

Source-only deleted-symbol check performed earlier in this batch:

```text
git grep LlmProvidersConfigComponent -- apps/ libs/
(no output; exit 1 = no matches)
```

The continuation also checked `rg -n LlmProvidersConfigComponent apps libs`: no output. Planning history remains unchanged. The exact requested per-key git-grep suite is not supplied: current role instructions prohibit running git. The following are actual source-search commands and their output, not claimed git output.

```text
rg -n authMethod|anthropicProviderId|saveSettings|connectProvider|activateConnection libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts
126:                  <ptah-setting-scope-row [fieldName]="key === 'authMethod' - 'Authentication' : 'Provider'"
129:                    [fallbackValueLabel]="key === 'authMethod' - authenticationLabel(entry.fallbackPreview?.value) : null"
185:              @for (target of state.writeScopes('authMethod'); track target) { <option [value]="target">{{ scopeLabel(target) }}</option> }
189:              <button type="button" [class]="control" (click)="activate()" [disabled]="saving() || !state.writeScopes('authMethod').includes(saveTarget())">Use for main agent</button>
272:  protected readonly mainKeys = ['authMethod', 'anthropicProviderId'];
383:    return key === 'authMethod' - 'authentication' : key === this.state.mainSources().data?.model?.key - 'main agent model'
420:    await this.state.connectProvider(draft, context);
457:    await this.state.saveSettings({ model: { model, applyTo: this.saveTarget() } }, this.modelContext);
472:    await this.state.saveSettings({ effort: { effort: effort || undefined, applyTo: this.effortTarget() } }, this.effortContext);
489:    this.saveTarget.set(scope ?? this.state.writeScopes('authMethod')[0] ?? 'global');
494:    await this.state.activateConnection(id, this.saveTarget(), this.draftContext);
```

```text
rg -n curatorProvider:|curatorModel:|lanes:|judgeProvider:|judgeModel:|enhanceTimeoutMs: libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts
722:      patch = { memory: { curatorProvider: draft.provider, curatorModel: draft.model } };
724:      patch = { judging: { judgeProvider: draft.provider, judgeModel: toBackendJudgeModel(draft.model) } };
727:      patch = { lanes: { [laneId]: { provider: draft.provider, model: draft.model } } };
767:    const patch: ProvidersSettingsPatch = { judging: { enhanceTimeoutMs: sec * 1000 } };
```

```text
rg -n saveSettings|saveCursorCredential libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts
159:    await this.state.saveSettings({ cli: [{ action: 'update', params: { id, name: this.editName().trim(), ...(this.editKey().trim() - { apiKey: this.editKey() } : {}) } }] }, this.editContext);
164:    await this.state.saveCursorCredential(this.cursorKey(), context);
183:    await this.state.saveSettings({ cli: [{ action: 'create', params: {
193:    await this.state.saveSettings({ cli: [{ action: 'update', params: { id: draft.id, selectedModel: draft.model } }] }, this.cliModelContext);
206:    await this.state.saveSettings({ orchestration: { [draft.key]: draft.value.trim() } }, this.delegatedContext);
210:    const context = this.state.reviewContext(); if (context) await this.state.saveSettings(patch, context);
```

```text
rg -n auth:saveSettings|provider:setModelTier|ptahCli:create|ptahCli:update|ptahCli:delete|agent:setConfig|skillSynthesis:setLanes|memory:setTriggers|skillSynthesis:updateSettings libs/frontend/core/src/lib/services/providers-settings-state.service.ts
93:    Pick<RpcMethodParams<'agent:setConfig'>, OrchestrationField>
95:  readonly tiers?: readonly RpcMethodParams<'provider:setModelTier'>[];
97:    | { action: 'create'; params: RpcMethodParams<'ptahCli:create'> }
98:    | { action: 'update'; params: RpcMethodParams<'ptahCli:update'> }
99:    | { action: 'delete'; params: RpcMethodParams<'ptahCli:delete'> }
338:    await this.runCommit([{ fields: ['Cursor credential'], write: async () => (await this.require('agent:setConfig', { cursorApiKey: apiKey })).success,
456:    const tiers = Object.entries(mappings) as [RpcMethodParams<'provider:setModelTier'>['tier'], string][];
463:      write: async () => (await this.require('provider:setModelTier', {
470:        write: async () => (await this.require('provider:setModelTier', { providerId: draft.providerId, tier,
489:    const mappings = (Object.entries(tiers.data) as [RpcMethodParams<'provider:setModelTier'>['tier'], string | null][])
490:      .filter((entry): entry is [RpcMethodParams<'provider:setModelTier'>['tier'], string] => entry[1] !== null);
796:          (await this.require('auth:saveSettings', params)).success,
830:            await this.require('memory:setTriggers', {
852:              await this.require('skillSynthesis:setLanes', {
881:            await this.require('skillSynthesis:updateSettings', { settings })
912:            (await this.require('agent:setConfig', { [field]: value })).success,
924:          (await this.require('provider:setModelTier', params)).success,
948:              return (await this.require('ptahCli:create', { ...command.params,
952:              return (await this.require('ptahCli:update', command.params))
955:              return (await this.require('ptahCli:delete', command.params))
```

```text
rg -n setEffort\( libs/frontend/tribunal-panel/src/lib/wizard/step-panel-preview.component.ts libs/frontend/chat/src/lib/settings/pro-features/workflows-config.component.ts libs/frontend/chat/src/lib/services/ultracode-state.service.ts libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts
libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts:306:        this.effortState.setEffort(effortValue, tileSessionId);
libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts:312:    this.effortState.setEffort(effortValue, sessionId);
libs/frontend/chat/src/lib/services/ultracode-state.service.ts:47:    await this.effortState.setEffort('xhigh');
libs/frontend/chat/src/lib/services/ultracode-state.service.ts:57:    await this.effortState.setEffort(this.previousEffort);
libs/frontend/chat/src/lib/settings/pro-features/workflows-config.component.ts:7: *     `setEffort()`. No direct RPC here.
libs/frontend/chat/src/lib/settings/pro-features/workflows-config.component.ts:225:    this.effortState.setEffort(value === '' - undefined : value);
libs/frontend/tribunal-panel/src/lib/wizard/step-panel-preview.component.ts:341:    void this.effortState.setEffort(value - (value as EffortLevel) : undefined);
```

The residual calls are real persisted writes: EffortStateService.setEffort calls config:effort-set, and config-rpc.handlers.ts:677 persists reasoningSettings.effort before optionally syncing a session. A sessionId does not make that call transient. The chat effort selector remains unchanged, including its live-session synchronization. Last-write-wins for these runtime controls is intentional.

## Deep links

| Existing entry | New destination |
|---|---|
| claude-auth / providers tab | Main agent |
| Old orchestration provider-specific request | Providers CLI agents; requestedProviderId opens the instance flow |
| Plain orchestration request | Retained execution-policy tab |
| Memory Manage | providers / memory-curator |
| Skills archaeologist, synthesis, judge, replay | Corresponding background row |
| Skills judging/enhancement | providers / judging-enhancement |
| Welcome model settings shortcut | providers / main-model |
| Chat model/effort runtime controls | Unchanged; not redirected or removed |

SettingsComponent forwards section targets to ProvidersSettingsComponent.focusTarget and provider ids to requestedProviderId. The coordinator retains its focus-after-render behavior. No duplicate Providers-folder barrel was created.

## Wizard wiring

The coordinator supplies the required verifyDraftConnection and cancelDraftVerification callbacks from the state owner. Verification calls auth:verifyDraftConnection; cancellation calls auth:cancelDraftVerification and returns its actual cancellation result. Components do not call these RPCs directly.

Actual draft params are probeId, providerId, authMode, optional credential { kind: 'apiKey', value }, optional baseUrl, and timeoutMs. The source does not send customProtocol or probeLimitSeconds. The wizard emits externalActionRequested { providerId, action }; coordinator delegates to performExternalAuth. Existing setup comes from non-secret base URL/model-tier reads, with custom name/protocol metadata when available. Workspace-context changes block commit until reviewed; commit detail names saved, unsaved and unconfirmed fields. The state owner rereads before reporting success or changing active badges.

For local-native/local-proxy drafts, a nonempty draft.baseUrl now supplies both the override baseUrl and ANTHROPIC_BASE_URL. The cooldown gate and tier values remain. With no draft URL, existing persisted resolution remains. OAuth intentionally uses persisted resolution because there is no editable OAuth draft endpoint. resolve() is unchanged. Four new resolver cases cover both supplied-URL modes and both missing-URL fallbacks. These are resolver tests, not a live local-server/protocol compatibility test; supplying a local-proxy draft URL targets that endpoint directly rather than the persisted proxy.

## Verification

All 21 required targets passed (exit 0); 4 used cached output, as Nx explicitly reports. The command ran entirely from this worktree:

```powershell
$env:NX_DAEMON='false'
$env:NX_CACHE_DIRECTORY='D:\projects\ptah-extension\.nx\verify-cache-d2'
npx nx run-many --projects=@ptah-extension/chat,@ptah-extension/core,@ptah-extension/shared,@ptah-extension/auth-providers,@ptah-extension/memory-curator-ui,@ptah-extension/skill-synthesis-ui,@ptah-extension/setup-wizard --targets=typecheck,lint,test --parallel=2 --outputStyle=static
```

Relevant actual output, in emitted order:

```text
> nx run @ptah-extension/shared:test  [local cache]
Test Suites: 60 passed, 60 total
Tests:       1579 passed, 1579 total
Snapshots:   0 total
Time:        12.838 s
Ran all test suites.
> nx run @ptah-extension/shared:lint  [existing outputs match the cache, left as is]
> nx run @ptah-extension/auth-providers:test  [local cache]
Test Suites: 41 passed, 41 total
Tests:       755 passed, 755 total
Snapshots:   2 passed, 2 total
Time:        58.83 s
Ran all test suites.
> nx run @ptah-extension/auth-providers:lint  [existing outputs match the cache, left as is]
> nx run @ptah-extension/shared:typecheck
> tsc --noEmit --project libs/shared/tsconfig.lib.json
> nx run @ptah-extension/core:test
Test Suites: 31 passed, 31 total
Tests:       784 passed, 784 total
Snapshots:   0 total
Time:        12.019 s
Ran all test suites.
> nx run @ptah-extension/core:typecheck
> npx ngc --noEmit --project libs/frontend/core/tsconfig.lib.json
> nx run @ptah-extension/core:lint
> nx run @ptah-extension/auth-providers:typecheck
> tsc --noEmit --project libs/backend/auth-providers/tsconfig.lib.json
> nx run @ptah-extension/skill-synthesis-ui:typecheck
> npx ngc --noEmit --project libs/frontend/skill-synthesis-ui/tsconfig.lib.json
> nx run @ptah-extension/skill-synthesis-ui:test
Test Suites: 27 passed, 27 total
Tests:       422 passed, 422 total
Snapshots:   0 total
Time:        44.919 s, estimated 73 s
Ran all test suites.
> nx run @ptah-extension/memory-curator-ui:test
Test Suites: 17 passed, 17 total
Tests:       192 passed, 192 total
Snapshots:   0 total
Time:        13.546 s, estimated 23 s
Ran all test suites.
> nx run @ptah-extension/memory-curator-ui:typecheck
> npx ngc --noEmit --project libs/frontend/memory-curator-ui/tsconfig.lib.json
> nx run @ptah-extension/skill-synthesis-ui:lint
> nx run @ptah-extension/memory-curator-ui:lint
> nx run @ptah-extension/chat:test
Test Suites: 89 passed, 89 total
Tests:       2 skipped, 1433 passed, 1435 total
Snapshots:   0 total
Time:        40.992 s, estimated 62 s
Ran all test suites.
> nx run @ptah-extension/chat:typecheck
> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json
> nx run @ptah-extension/chat:lint
> nx run @ptah-extension/setup-wizard:test
Test Suites: 12 passed, 12 total
Tests:       321 passed, 321 total
Snapshots:   0 total
Time:        16.622 s, estimated 37 s
Ran all test suites.
> nx run @ptah-extension/setup-wizard:lint
> nx run @ptah-extension/setup-wizard:typecheck
> npx ngc --noEmit --project libs/frontend/setup-wizard/tsconfig.lib.json
 NX   Successfully ran targets typecheck, lint, test for 7 projects
Nx read the output from the cache instead of running the command for 4 out of 21 tasks.
```

The targeted new regression run used the same environment:

```powershell
npx nx test @ptah-extension/core --testFile=providers-settings-state.service.spec.ts --runInBand --outputStyle=static
```

```text
Test Suites: 1 passed, 1 total
Tests:       55 passed, 55 total
Snapshots:   0 total
Time:        7.213 s
Ran all test suites matching providers-settings-state.service.spec.ts.
NX   Successfully ran target test for project @ptah-extension/core
```

Both selectors were restored from committed objects without executing a git command or changing the index/history. Byte equality was verified by hashing each file as a blob:

```text
libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts: exact committed blob e22cf2317a9daa9d09c6720f6bb92242972bc8be
libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts: exact committed blob 87798d01b9fd747ee45f3985b8c6c6a4db663aae
```

Source-only deleted-symbol check repeated in this continuation:

```text
rg -n LlmProvidersConfigComponent apps libs
(no output; exit 1 = no matches)
```

Non-failing warnings remain: existing file-size limits, optional-chain Angular template diagnostics, deprecated Nx executors, and Jest worker teardown warnings. No broad warning cleanup was included. No raw build log is retained in the task folder; relevant output is quoted here.


## Deviations

- The worktree already contained settings/index.ts despite the brief describing no barrel. Removed obsolete entries there; did not create a barrel.
- Welcome now forwards its model settings shortcut to Providers. Both chat selectors are restored byte-for-byte to the committed version; their runtime behavior is preserved.
- The orchestrator deliberately exempted the four pre-existing runtime effort writers from the plan's universal phrasing. This preserves runtime behavior and is mitigated by pending-write invalidation and authoritative readback in Providers.
- Named CLI component stays at its existing ptah-ai path and is composed under Providers, matching move/rework in place.

## Accepted limitations

### Verification requires a draft credential

API-key and custom connection verification requires entering the credential in the wizard. The draft verifier does not reuse stored secrets; metadata about an existing key is insufficient to verify a draft. The wizard explains this requirement and offers key entry. It does not probe the persisted route and present that result as verification of the replacement draft. Evidence: wizard credentialReady and buildProbeParams, and auth:verifyDraftConnection draft DTO.

### Direct Anthropic cannot be connected without activation

Direct Anthropic setup currently supports saving and selecting it as the main agent; it does not offer connect-only. auth:setApiKey stores provider-slot credentials (auth-rpc.handlers.ts:1233-1249), while llm:setApiKey stores the direct credential and selects authMethod (llm-rpc-app.handlers.ts:433-436). There is no host contract for storing the direct credential independently. The wizard disables that unsupported choice and the state facade rejects it.

### Existing auth save ordering can partially change routing

auth:saveSettings writes authMethod and clears more-specific scopes before storing the credential (auth-rpc.handlers.ts:954-969). A later secret-store failure can therefore leave changed routing even though credential saving failed. This pre-existing host ordering is unchanged. The UI reports partial/unconfirmed outcomes and rereads effective state; it cannot make the host operation transactional.

### Deliberate single-writer exception: four pre-existing runtime reasoning-effort writers

The single-writer settings gate is satisfied for every key in the target key map EXCEPT the reasoning-effort keys, which retain four pre-existing runtime writers:

- `libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts:306` and `:312` - chat/tile effort selection and live-session synchronization.
- `libs/frontend/chat/src/lib/settings/pro-features/workflows-config.component.ts:225` - Workflows effort control.
- `libs/frontend/tribunal-panel/src/lib/wizard/step-panel-preview.component.ts:341` - Tribunal effort control.
- `libs/frontend/chat/src/lib/services/ultracode-state.service.ts:47` and `:57` - Ultracode raises effort and restores the previous value.

This is a documented deviation from the plan's universal phrasing, explicitly decided by the orchestrator, not an oversight. The invariant addresses competing settings editors whose saved values silently override one another; Decision 9 enumerates the eight settings entry points. These runtime controls intentionally share a persisted default with last-write-wins behavior. Removing them would remove working runtime controls and immediate session synchronization. Their implementations are unchanged.

Providers must nevertheless display the effective value truthfully. On page open and explicit refresh, ProvidersSettingsStateService.refresh() calls config:effort-get and rereads the current authentication namespace's scope entries. While an existing runtime writer is pending, both effort and its source view immediately become loading with data null. The notification carries only revision/pending state, never the optimistic effort value. After the write settles (success or failure), the state owner automatically rereads effort and scope provenance. The page renders effort only when the read is ready; a failed read exposes a sanitized retry state with no old value. Revision checks suppress stale snapshots and existing request generations prevent late older reads from overwriting newer reads. No polling timer was introduced. The runtime services keep their existing persistence and live-session-sync paths.

Evidence: `effort-state.service.ts:40,60`; `providers-settings-state.service.ts:253-257,262,274-276,512-517,576-578,1067-1077`; component template `providers-settings.component.ts:93-95`. Regression cases in providers-settings-state.service.spec.ts:

- `rereads effective effort on open and refresh without exposing the cached value during loading`
- `invalidates displayed effort immediately and rereads after a runtime xhigh write settles`
- `does not restore stale effort when readback after a runtime write fails`

## Not done

- No live browser/cross-runtime or real-credential network verification; no VSIX packaging/release gate run.
- Exact per-key git-grep was not rerun under the role prohibition on running git; actual source-search evidence is supplied. The earlier source-only deleted-symbol gate had no matches.
- No host contract redesign for the accepted credential/direct-Anthropic/save-ordering limitations above.

The two task-folder build logs have been deleted. Relevant observed output is quoted in Verification. No clarification remains pending.
