# TASK_2026_534: fix report

Worktree: `D:\projects\ptah-extension\.claude-worktrees\providers-runtime-fix` (branch `fix/providers-runtime-regressions`). Nothing is committed.
Paths below are relative to the worktree. Line numbers are the post-change positions.

Abbreviations:
- `S` = `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`
- `SS` = the spec file for `S`
- `PS` = `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`

## Verification

`npx nx run-many -t typecheck,test,lint -p chat core --output-style=static` reported "Successfully ran targets typecheck, test, lint for 2 projects".
- **core:** 33 suites and 867 tests passed.
- **chat:** 98 suites passed; 1514 tests passed and 2 were skipped.
- **Lint:** 0 errors in both projects (13 and 15 warnings). Running eslint on only the changed files gives 3 warnings:
  - `max-lines` in `S`. The file was already over the limit.
  - `preserve-caught-error` at `S:814`. This is the existing `cancelVerification` code.
  - `max-lines` in `provider-connection-card.component.ts` (715 lines against a limit of 700). This one is new, because two activation buttons were added.
- **rpc-handlers:** not run. No backend file was changed.
- **Jest:** reports "A worker process has failed to exit gracefully". This was already the case before these changes and does not fail the run.

## R1: runtime regressions

### 1. Claude API "Use for main agent" was always rejected. Status: done
- **Change:** a new `activationAuth()` helper (`S:518`) builds the `auth:saveSettings` parameters for both `connectProvider` (`S:435`) and `activateConnection` (`S:505`):
  - Claude API (`anthropic`) sends `{authMethod:'apiKey', [anthropicApiKey], applyTo}`.
  - Claude subscription (`cli` auth mode or `claude-cli`) sends `{authMethod:'claudeCli', applyTo}`.
  - A third-party provider sends `{authMethod:'thirdParty', anthropicProviderId, applyTo}`.
- The save guard `authWritable()` (`S:525`) now needs `anthropicProviderId` to be writable only when that field is actually sent.
- **Trace (key, scope, value, env):**
  - `auth:saveSettings` is handled at `auth-rpc.handlers.ts:924`.
  - `AuthSettingsSchema.parse` (`auth-rpc.schema.ts:45-57`): `anthropicProviderId` is refined by `getAnthropicProvider(id) !== undefined`. `'anthropic'` is the virtual `ANTHROPIC_DIRECT_PROVIDER_ID` (`provider-registry.ts:503`) and is not in the registry, so the old request always threw.
  - With the field left out:
    - `authMethod` is written to `applyTo` and more specific scopes are cleared (`:954-960`).
    - `anthropicApiKey` goes to the secrets store (`:961-970`).
    - The block at `:987-1000` (write `anthropicProviderId` plus `autoMapProviderTiers`) is skipped. `sdkAdapter.reset()` follows.
  - The runtime reader `resolveEffectiveAuthRoute` (`effective-route.ts:83-91`) derives the driver as `'claude-cli'` for `claudeCli` and as `defaultProvider ?? 'anthropic'` for `apiKey`. Neither reads `anthropicProviderId`, so there is no need to send it.
  - `'claude-cli'` is a registry id (`entries/claude-cli-provider-entry.ts:24`), so it was never rejected. Before this fix, though, it overwrote the user's stored third-party `anthropicProviderId` and ran `autoMapProviderTiers('claude-cli')`, which pinned env tiers (see item 2). The pre-#575 UI never sent it.
- **Tests (`SS`):**
  - `R1.1/R1.2: activating %s sends no anthropicProviderId and writes no main-agent tier` (runs for `anthropic` and `claude-cli`; `anthropicProviderId` is not a writable scope in this fixture).
  - `R1.1/R1.2: %s setup activation sends no provider id and writes no tiers` (runs for `claude-cli` and `anthropic`).
  - The existing test `stores direct Anthropic credentials only with explicit activation…` still passes.

### 2. Activating Claude (subscription or API) pinned main-agent tiers. Status: done
- **Change:**
  - `activateConnection` no longer writes any tier (`S:505-516`).
  - `connectProvider` skips main-agent tier writes when `nativeAnthropic` is true (`S:480`, `S:488`).
  - `NATIVE_ANTHROPIC_IDS` is defined near the top of `S` as `anthropic` and `claude-cli`.
- **Trace:**
  - `provider:setModelTier` (`provider-rpc.handlers.ts:564-591`) calls `ProviderModelsService.setModelTier` (`provider-models.service.ts:538-560`).
  - That persists `provider.<id>.mainAgent.modelTier.<tier>`. When `scope === 'mainAgent'` it also sets `authEnv[...]`, `process.env.ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` and tier metadata (`:547-551`). This is process-global and ignores which provider is active.
  - After the fix, neither activation path sends `provider:setModelTier` for `anthropic` or `claude-cli`. Because item 1 also removed `anthropicProviderId`, `autoMapProviderTiers('claude-cli')` (`auth-rpc.handlers.ts:1605-1645`) no longer runs either.
- **Tests:** the same two `R1.1/R1.2` groups assert that there are no `provider:setModelTier` calls.
- **Not done:** existing `provider.claude-cli.*` or `provider.anthropic.*` main-agent tier keys written by #575 builds are not cleaned up. That would need a migration or a host-side change, which is outside this task.

### 3. Third-party activation overwrote the user's main-agent tiers. Status: done
- **Change, `activateConnection` (`S:505`):** it no longer reads `cliAgent` tiers or copies them into `mainAgent`. It sends only `auth:saveSettings`.
- **Change, `connectProvider` with "use for main agent" (`S:488-497`):** for each tier, it reads the stored main-agent tier first. It writes only when the wizard value is non-empty and differs from the stored value.
  - A tier left on "Provider default" (`''`) never writes. The old code wrote `defaults[tier]`.
  - Because the wizard is now prefilled from the stored main-agent tiers (see item 4), a differing value is either an unset tier being filled or an explicit user edit. It is never an implicit copy.
- **Trace:**
  - `auth:saveSettings` with `anthropicProviderId` calls `autoMapProviderTiers` (`auth-rpc.handlers.ts:999`, `:1605-1645`).
  - That reads `getModelTiers(providerId,'mainAgent')` and calls `setModelTier(...,'mainAgent')` only where `!currentTiers[tier] && defaultTiers[tier]` (`:1620-1631`). So I confirmed it fills only unset tiers, and it is skipped for providers without `defaultTiers`.
  - On `sdkAdapter.reset()`, `applyPersistedTiers` (`provider-models.service.ts:697-727`) sets the env from user tier, then registry `defaultTiers`, then the live-derived catalogue. So a provider left at its defaults still resolves at runtime without a frontend write.
- **Tests (`SS`):**
  - `R1.3: activates a third-party connection without copying any tier over the main-agent tiers`
  - `R1.3: setup activation writes only main-agent tiers that are unset or explicitly changed`
  - `R1.3: a provider-default ("") wizard tier never writes over the stored main-agent tier`

### 4. Connecting or managing a provider changed CLI sub-agent tiers. Status: done
- **Change:**
  - `connectProvider` no longer writes `provider:setModelTier` with `scope:'cliAgent'` (`S:478`).
  - `refreshConnectionSetup` now prefills the wizard from `mainAgent` tiers instead of `cliAgent` (`S:329`).
  - `refreshConnections` no longer reads `cliAgent` tiers to decide whether Claude CLI is "configured". It uses `auth:getAuthStatus.claudeCliInstalled` (`S:380`). Without that change a Claude CLI connection would disappear from "Your connections", because the `cliAgent` tier write was its only saved marker.
- **Trace:**
  - The `cliAgent` key is `provider.<id>.cliAgent.modelTier.<tier>`. It sets no env, because the env branch applies only to `mainAgent` (`provider-models.service.ts:547`).
  - The reader is `PtahCliRegistry.resolveEffectiveTiers` (`ptah-cli-registry.ts:1479-1493`): per-agent `tierMappings`, then `getModelTiers(providerId,'cliAgent')`, then registry defaults, then the first static model. So any CLI agent on that provider without its own mapping picked up the wizard's choices.
  - After the fix, only the CLI agent editor (`ptahCli:update` `tierMappings`, or an explicit `patch.tiers` with `scope:'cliAgent'` through `saveSettings`) writes that scope.
- **Tests (`SS`):**
  - `connects without writing main-route settings, main-agent tiers or CLI sub-agent tiers`
  - `R1.4: activating from setup writes no cliAgent tier`
  - `reads existing connection endpoint and models…` now also asserts the `mainAgent` read and that there is no `cliAgent` read.
  - `treats an installed Claude CLI as a configured connection without reading CLI sub-agent tiers`
- **Consequence:** for a non-custom provider with "Connect only", the Models step choices are no longer saved anywhere. There is no side-effect-free store: a `mainAgent` write pins `process.env`, and `cliAgent` is the bug. Custom endpoints still save them as the entry's `defaultTiers`. Hiding or relabelling the step for connect-only is left to the redesign task.

## R2: controls that did nothing or blocked

### 5. Gating on `lastSuccessfulProbeAt`; local and unknown providers could not be activated. Status: done
- **Change:**
  - `activeProviderId` (`S:237`) now needs only: route ready, route resolved, a `driverProviderId`, not saving, and a driver whose status is in `ACTIVATABLE_STATUSES` (connected, reachable, unknown, skipped). No probe timestamps are required and none are invented.
  - Connection card:
    - A new `uncheckable` computed (`provider-connection-card.component.ts:656`) covers raw status `unknown` or `skipped`.
    - "Use for main agent" is now offered in the Not checked (`:354`) and Check unavailable (`:387`) states for those statuses only. `connected` with `positiveProbeEvidence=false` still does not offer it.
  - Providers page (`PS`):
    - `hasProbeEvidence` returns `null` for uncheckable providers (`PS:412`), so an active local server shows as Active and not as "Needs attention".
    - The activation review shows a note (`PS:180`, `data-testid="activation-unchecked-note"`).
  - Background assignments (`provider-consumer-assignments.component.ts:625-718`):
    - The readiness result gains a `blocking` flag.
    - `unknown` and `skipped` give a non-blocking note with `role="status"`.
    - Save is disabled only by blocking readiness.
    - "Follow main agent" now works because `activeProviderId` is non-null.
- **Tests:**
  - `SS`:
    - `R2.5: marks an uncheckable (%s) driver of a ready route active`
    - `R2.5: derives the active provider from the effective route, which never carries probe timestamps`
    - `never marks a %s driver active` (for the failing statuses)
  - Card spec: the `unknown` and `skipped` tests now expect the activation button; added `does not offer activation for uncheckable status when activation is disabled`.
  - Consumer spec: `keeps an uncheckable (unknown/skipped) provider saveable with an advisory note…`, `allows "Follow main agent" to save…`, and `emits setupProviderRequested…` (now uses the blocking `ollama`/needs-key case).
  - `PS` spec: `offers main-agent activation for an uncheckable local provider with a note`

### 6. `existingCredentialPresent` was never bound. Status: done, with a limit
- **Change:** a new `wizardCredentialStored` computed (`PS:298`) is bound on the wizard (`PS:253`). It is the `hasKey` of the connection selected in the wizard. For third-party providers that comes from `auth:getApiKeyStatus`; for Claude API it comes from `auth:getAuthStatus.hasApiKey`.
- **Test (`PS` spec):** `tells the wizard whether the selected provider already has a stored key`.
- **The fix does not remove key re-entry.** The wizard now shows "Key stored" and "Replace key", but verification still needs the key typed in:
  - `auth:verifyDraftConnection` rejects a draft with no key (`provider-auth-resolver.ts:571-593`).
  - `connectProvider` requires a verified probe.
  - The wizard's own copy already says "Verification requires entering the credential, even when a key is already stored".

  Saving a stored-key edit without a probe would mean changing the verification gate, and the task says not to invent probe data. That decision needs to be made separately.

### 7. Agent Orchestration. Status: done
- **"Manage provider, model and credentials in Providers" did nothing while Settings was open:** `SettingsComponent` now has a constructor `effect` on `appState.pendingSettingsTab()` that consumes the request through a shared `applyPendingTab()` (`settings.component.ts:122-138`). `ngOnInit` uses the same method. Test: `R2.7: reacts to a pending tab raised while Settings is already open` in `settings.component.spec.ts`.
- **Codex auto-approve:** the control is removed. `AgentSpawnEnvironment.resolveAutoApprove` returns `undefined` for codex (`agent-spawn-environment.service.ts:155-156`).
- **Copilot auto-approve:** it is now a daisyUI `toggle` checkbox bound to the saved `copilotAutoApprove` (`agent-orchestration-config.component.ts:~266-279`) and calls `toggleCopilotAutoApprove` (`:455`). The element is restored if the write fails.
- **Removed as dead code:**
  - The row chevron and click-to-expand handler, together with `expandedClis`, `toggleCliExpand`, `isCliExpanded` and the `stopPropagation` wrapper.
  - The empty `<ng-content>` "Ptah CLI Agents" section.
  - The grip icon. The up/down arrows stay.
  - The unused `KeyRound` import.
- **Tests:** new file `agent-orchestration-config.component.spec.ts`:
  - `renders no Codex auto-approve control…`
  - `binds the Copilot auto-approve toggle to the saved value…`
  - `restores the Copilot toggle when the write fails`
  - `has no expand chevron or click-to-expand row, and no drag grip`
  - `routes "Manage provider…" to the Providers CLI agents section`

### 8. Deep links now open the setup wizard. Status: done
- **Change:** a constructor `effect` in `PS` (`PS:354`) opens the wizard once per requested provider id, as soon as setup can start. The id goes to the wizard's `deepLinkProviderId`.
- The old forward to `PtahCliConfigComponent` (`[autoOpenProviderId]`, which opened "Add CLI agent") is removed. So are its `autoOpenProviderId` input, effect and `openedProvider` field. The comment in `settings.component.ts` is updated to match.
- **Test (`PS` spec):** `opens the setup wizard for a deep-linked provider once`.

### 9. Duplicate "Sign in to X / Check X sign-in" row. Status: done
- **Change:** the row between the cards is removed in `PS`, in the connections `@for`. The "Sign in" button on the "More providers" catalogue stays, because catalogue entries have no card.
- **Test (`PS` spec):** `renders no duplicate sign-in row between connection cards`.

### 10. "Model has not been resolved." wording. Status: done
- **Change:** the text now reads "Default model (chosen by Claude)" (`PS:83`). That branch renders only on a resolved route, where `resolvedModel.kind === 'unresolved'` means the SDK's `default` (`auth-rpc.handlers.ts:514-525`).
- **Test (`PS` spec):** `renders each resolvedModel arm of the route switch` was updated.

## R3: CLI model lists

### 11. Delegated model pickers called `provider:listModels`. Status: done
- **State (`S:337-348`):** a new `delegatedModelOptions` section, loaded on demand by `refreshDelegatedModelOptions()` through `agent:listCliModels`. Loading on demand matches the old UI's RPC without adding a read to every refresh.
- **Component (`ptah-cli-config.component.ts`):** all six delegated models (codex, copilot, cursor, antigravity, opencode, pi) now use a native `<select>` (`:110`). It has a "Provider default" (`''`) option plus the list from `agent:listCliModels` (`DELEGATED_CLI` at `:21`, `delegatedOptions()` at `:217`).
  - A saved value that is not in the list stays selectable with the label "(saved)".
  - There are loading and error states with a retry.
  - Opening the editor starts the fetch (`:214`).
  - `delegatedProvider()` is removed.
- **Tests:**
  - New `ptah-cli-config.component.spec.ts`: `R3.11: lists Cursor models from agent:listCliModels and never asks provider:listModels` and `R3.11: saves the chosen delegated model through the state owner`.
  - `SS`: `R3.11: loads delegated CLI model lists from agent:listCliModels on demand, never provider:listModels`.

### 12. Reasoning effort was free text. Status: done
- **Change:** reasoning effort is now a `<select>`:
  - Codex and Copilot: `CLI_EFFORT_OPTIONS` = `''`, minimal, low, medium, high, xhigh. These are the values `mapEffortToCli` accepts (`agent-spawn-environment.service.ts:85-98`).
  - Pi: `PI_EFFORT_OPTIONS` = `''`, off, minimal, low, medium, high, xhigh, max. Pi's value goes raw to `--thinking` (`:119-130`, `pi-cli.adapter.ts:377`), and this matches the pre-#575 UI's `piReasoningEffortOptions`.
- **Tests (`ptah-cli-config.component.spec.ts`):** `R3.12: Codex reasoning effort is a select of the mapEffortToCli values` and `R3.12: Pi reasoning effort offers the --thinking scale and keeps the saved value`.

## Files changed
- MODIFIED `libs/frontend/core/src/lib/services/providers-settings-state.service.ts` and its `.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` and its `.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts` and its `.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts` and its `.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/settings.component.ts` and its `.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.spec.ts`
- CREATED `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.spec.ts`

## Out of scope, not touched
- Stale `provider.{claude-cli,anthropic}.*.modelTier.*` and `cliAgent` tier keys written by #575 builds remain in user config.
- For providers without defaults, the wizard still requires explicit tiers even for "Connect only", although those tiers are no longer saved (see item 4).
- `provider-connection-card.component.ts` is now over the `max-lines` warning threshold. `providers-settings-state.service.ts` was already over it.

**Update:** the round below changes several batch-1 points:
- Item 3: the wizard now sends only the tiers the user edited.
- Item 4: Connect only now saves the model choices as main-agent tiers (B2-2), so the "Consequence" note under item 4 and the second out-of-scope point above no longer apply.
- Item 5: the active provider is derived from the corrected route contract (#1).
- Item 6: a stored key is now verified without re-entry (B2-1).

## Revision 1 + Batch 2

This section addresses the six defects in `code-logic-review.md` (Failure modes 1–6) and batch-2 items B2-1 and B2-2. As the coordinator mapped them, review #5 is B2-1 and review #3 is B2-2. Nothing is committed. Paths are relative to the worktree. `S` still means `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`, and `W` means `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts`.

### Verification

`npx nx run-many -t typecheck,test,lint -p shared auth-providers rpc-handlers core chat --output-style=static` reported "Successfully ran targets typecheck, test, lint for 5 projects".

| Project | Tests passed | Skipped |
| --- | --- | --- |
| shared | 1796 | 0 |
| auth-providers | 874 | 0 |
| rpc-handlers | 3148 | 4 |
| core | 869 | 0 |
| chat | 1521 | 2 |

- **Lint:** 0 errors. On the files touched in this round there are 5 warnings, and none is new. Four are `max-lines` on files that were already over the limit (wizard, `S`, `provider-models.service.ts`, `agent-rpc.handlers.ts`). The fifth is the `preserve-caught-error` warning in `S` that was already there.
- **ptah-cli doctor spec:** it consumes `resolveEffectiveAuthRoute` (the route function changed for #1), so I ran it on its own with `npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/cli/commands/doctor.spec.ts`. 10 tests passed.
- **Line endings:** files edited through a Python helper were converted back to LF (`git ls-files --eol` shows `w/lf`).

### #1: Active provider identity disagreed with the runtime (Blocking). Status: done
- **Change:** `resolveEffectiveAuthRoute` (`libs/backend/auth-providers/src/lib/auth/effective-route.ts:88-101`) now resolves the driver the same way as `ActiveProviderResolver` (`active-provider-resolver.ts:25-42`):
  - `apiKey` gives `ANTHROPIC_DIRECT_PROVIDER_ID`, whatever `llm.defaultProvider` says.
  - `thirdParty` gives `anthropicProviderId ?? DEFAULT_PROVIDER_ID` ('openrouter').
  - `claudeCli` still gives `'claude-cli'`, the connection tile the UI shows for subscription auth. The runtime handles it through the CLI strategy.
  - `config.defaultProvider` stays in the input type because `ptah doctor` reports it, but it no longer picks the driver.
  - The "no provider selected" blocker is removed, because a `thirdParty` route without a selector now resolves to the runtime fallback, exactly as the runtime does.
- **Trace:** this path is read-only. `auth:getEffectiveRoute` (`auth-rpc.handlers.ts:386-502`) reads `authMethod` and `anthropicProviderId` through `scopeResolver.read(...,true)`, then calls `resolveEffectiveAuthRoute`. `llm.defaultProvider` is neither written nor used to hide the mismatch.
- **Tests:**
  - `effective-route.spec.ts` › "driver identity matches ActiveProviderResolver": apiKey with a conflicting `defaultProvider` and a stale `claude-cli` selector gives `anthropic`; thirdParty without a selector gives `openrouter`; thirdParty with a selector gives that selector.
  - `auth-rpc.handlers.spec.ts` › `auth:getEffectiveRoute driver identity`: two backend route tests through the real handler. Each asserts that `driverProviderId` equals `new ActiveProviderResolver(sameScope).resolveActiveAuth().providerId`, and that `scopeResolver.write` and `configManager.set` were never called.

### #2: A failed Copilot auto-approve write looked successful (Blocking). Status: done
- **Change** (`libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`):
  - `toggleCopilotAutoApprove` (`:469`) confirms a save only when the RPC envelope succeeded AND `data.success === true` (`:485`).
  - A rejected call is caught.
  - Every unconfirmed outcome reads back the stored value through `agent:getConfig` (`readCopilotAutoApprove`, `:512`). The component state and the checkbox are set to that value.
  - An error is shown with `role="alert"` (`:282`) unless the read-back proves the change did land.
  - `savingCopilotAutoApprove` (`:456`) disables the toggle and serialises writes.
- **Trace:** `agent:setConfig {copilotAutoApprove}` → `setAgentCfg` → `workspace.setConfiguration('ptah','agentOrchestration.copilotAutoApprove')`, plus the live `permissionBridge.setAutoApprove` (`agent-rpc.handlers.ts`, setConfig branch). A persistence throw is caught there and returned as `{success:false}` inside a successful envelope. The runtime reader is `AgentSpawnEnvironment.resolveAutoApprove('copilot')` (`agent-spawn-environment.service.ts:155-160`).
- **Tests (`agent-orchestration-config.component.spec.ts`):**
  - `rolls back and shows an error after %s`, run for three failures: `RpcResult(true,{success:false,error:'EACCES'})`, `RpcResult(false)`, and a thrown call. Each asserts the checkbox, the component state, the error text, and that the toggle is re-enabled.
  - `trusts the read-back when an uncertain write did persist`
  - `disables the toggle while a write is in flight`

### #3 / B2-2: Model choices were discarded; tier writes for a non-active provider changed the running session (Blocking). Status: done
- **Backend** (`libs/backend/auth-providers/src/lib/provider-models.service.ts`):
  - `setModelTier` always persists `provider.<id>.<scope>.modelTier.<tier>`.
  - It changes `authEnv`, `process.env.ANTHROPIC_DEFAULT_*_MODEL` and tier metadata only when `scope==='mainAgent' && providerId === resolveActiveProviderId()` (`:552`). `resolveActiveProviderId` is `ActiveProviderResolver.resolveActiveAuth()`, the same resolver the runtime uses.
  - `clearModelTier` is guarded the same way (`:619`).
- **Activation path (checked):** `auth:saveSettings` writes `anthropicProviderId`, then calls `sdkAdapter.reset()`. The auth strategies (`api-key.strategy.ts:438/575/621`, `local-native.strategy.ts:153`, `local-proxy.strategy.ts:101`, `oauth-proxy.strategy.ts:146/247`) call `switchActiveProvider(providerId)`, which runs `applyPersistedTiers` and applies the saved `mainAgent` tiers to the env. No new code was needed.
  - `autoMapProviderTiers` runs after the selector write, so it still updates the env for the provider being activated.
  - The Copilot-login auto-map (`auth-rpc.handlers.ts:1119`) no longer changes the env when Copilot is not the active provider.
- **Frontend, `connectProvider`** (`S:478-515`): "Connect only" and "Use for main agent" both persist the wizard's edited tiers as `mainAgent` tiers. There are no `cliAgent` writes, so batch-1 item 4 still holds.
  - For native Anthropic (`anthropic`, `claude-cli`, or the `cli` auth mode) nothing is collected, validated or written, and the SDK defaults are kept.
  - The "explicit models" block is skipped for native and custom connections (custom tiers are validated by the entry schema).
- **Frontend, wizard:**
  - `tiersApply` (`W:1642`) is false for native auth. The Models step then shows only "Claude chooses its own default models…" (`W:1125`); the review rows are hidden, `modelsValid` is true, and the commit carries blank tiers with `editedTiers: []`.
  - After a Connect-only save with edited tiers, the wizard says "Model choices saved — they apply when you use this provider for the main agent."
- **Tests:**
  - `provider-models.service.spec.ts` › "mainAgent scope for a provider that is not active":
    - `persists the tier but leaves process.env and authEnv untouched` compares full `process.env` and `authEnv` snapshots.
    - `applies the saved tier when that provider is activated` reads the persisted key, then runs `switchActiveProvider` and checks the env.
    - `clearing a non-active provider tier leaves the running authEnv entry`
    - The existing mainAgent env tests now run with the provider active (the `activeProvider` harness option).
  - CLI-agent tier resolution (`ptah-cli-registry.ts:1479-1493`) is unchanged, and its existing specs pass inside the rpc-handlers and auth-providers runs.
  - `S` spec, with a host-side in-memory tier store so the tests assert end state:
    - `B2-2: Connect only persists edited tiers as main-agent tiers without selecting the provider`
    - `B2-2: an edit back to the provider default clears the stored main-agent tier`
    - `R1.1/R1.2: %s setup activation…` now also passes blank tiers plus a stray edit, and asserts that nothing is blocked and no tier is written.
  - Wizard spec: `review #3: native Claude auth collects no tiers and keeps SDK defaults`

### #4: Unedited wizard tiers overwrote a newer edit from elsewhere (Blocking). Status: done
- **Change:**
  - The wizard keeps a snapshot of the stored `mainAgent` tiers it loaded (`_tierSnapshot`, set at `W:1861`, reset whenever the provider selection changes).
  - Per-tier dirty state is `editedTiers` (`W:1654`): the value differs from the snapshot. A tier changed and then changed back is not an edit.
  - The commit carries `tierSnapshot` and `editedTiers`, and `ProvidersConnectionDraft` gains the same two fields.
  - `connectProvider` sends only edited tiers; unchanged tiers are left to the host's fill-if-unset auto-map.
  - Each edited tier is written with compare-and-set: re-read the stored value, and if it no longer equals the snapshot return `'conflict'` without writing (`S:502-505`). An edit to `''` calls `provider:clearModelTier`.
  - `runCommit` records conflicted fields as not saved and adds "Changed elsewhere since setup opened, not overwritten: … Reopen setup to review the current value." (`S:1049`, `S:1113`).
- **Trace:**
  - `provider:getModelTiers {scope:'mainAgent'}` → `getModelTiers` → scoped key, then the legacy key.
  - `provider:setModelTier` / `provider:clearModelTier` → `ProviderModelsService` → `config.set(provider.<id>.mainAgent.modelTier.<tier>)`. The env changes only for the active provider (B2-2).
- **Tests:**
  - `S` spec: `review #4: sends only edited tiers; unchanged tiers keep a newer stored value` and `review #4: an edited tier whose stored value changed since setup opened is a conflict, not an overwrite`.
  - Wizard spec: `review #4: records the loaded tier snapshot and marks only changed tiers as edited`.
- **Limit:** the compare-and-set runs in the frontend (read, then write). A write landing between that read and write is not detected. A true host-side conditional write would need a new RPC parameter.

### #5 / B2-1: A stored key had to be re-entered (Serious). Status: done
- **Shared** (`libs/shared/src/lib/types/rpc/rpc-auth.types.ts`):
  - A new `DraftProbeCredential` type (`:465`) = `{kind:'apiKey',value}` | `{kind:'stored'}`.
  - `ProbeFailureReason` gains `'no-stored-credential'` (`:458`).
- **Backend** (`libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts`):
  - `DraftVerificationService` now also injects `TOKENS.AUTH_SECRETS_SERVICE`.
  - For `kind:'stored'` it reads the key on the host (`readStoredKey`, `:468`): `getCredential('apiKey')` for `anthropic`, otherwise `getProviderKey(id)`. The key joins the draft exactly like a typed key before `buildDraftOverride` (`:292`), so it exists only in that single call's override env.
  - With no stored key it returns `failed / 'no-stored-credential'` without starting the probe, instead of throwing.
  - A stored credential is allowed only for key-carrying modes (`STORED_KEY_AUTH_MODES`).
- **Frontend, wizard:**
  - `usesStoredKey` (`W:1631`) is true when a key is stored, the user has not chosen Replace key, and nothing is typed. It satisfies `credentialReady` for `apiKey` and `custom` modes.
  - The credential step offers "Verify stored key" (`W:658`, `verifyStoredKey()` at `W:2138`) and "Replace key". The probe sends `{kind:'stored'}` (`W:2191`).
  - The review shows "Stored key (unchanged)", and the commit carries `credential:null, existingKeyReused:true`, so `connectProvider` makes no credential write.
- **Trace:** this path only reads settings and secrets and writes nothing. Draft probe → `buildDraftOverride` → `InternalQueryService.execute({auth: override})`, a per-call snapshot. Because no settings key changes, `auth:getEffectiveRoute` (which reads only `authMethod` and `anthropicProviderId`) cannot change.
- **Tests:**
  - `draft-verification.service.spec.ts` › "stored credential (B2-1)":
    - The first test checks that the stored key reaches only the runner's `auth` override and never the result. Across the probe, `process.env`, the config snapshot and the provider-key store are identical before and after, and `expectNothingWritten` passes.
    - The second checks that `anthropic` reads the apiKey credential.
    - The third checks the typed `no-stored-credential` result.
    - The fourth checks that a stored credential is rejected for oauth.
  - Wizard spec (real component, no stub):
    - `B2-1: offers Verify stored key and Replace key, and a stored key needs no re-entry`
    - `B2-1: verifies the stored key on the host and saves a models-only edit without re-entry` (probe params `{kind:'stored'}`, then a verified result, then a commit with `credential:null`)

### #6: The effort select brought back arbitrary saved values (Moderate). Status: done
- **Shared** (`rpc-agents.types.ts:152`, `:165`): new `CLI_REASONING_EFFORT_VALUES` (`''`, minimal…xhigh, the `mapEffortToCli` allowlist) and `PI_REASONING_EFFORT_VALUES` (`''`, off…max, Pi's `--thinking` scale).
- **Host boundary** (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`): `invalidReasoningEffort` (`:73`) runs before any write in `agent:setConfig` (`:264`). An unsupported value returns `{success:false, error:'Unsupported <field> value'}`, and nothing in the batch is persisted.
- **UI** (`libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts`):
  - Options are built from the shared lists.
  - An unknown saved value is kept only for model ids (`delegatedOptions`, `:237`).
  - An unsupported saved effort opens as a disabled "Unsupported saved value" placeholder (`UNSUPPORTED_EFFORT`, `:23`, set in `editDelegatedModel` at `:225`), with a `role="alert"` message (`:125`).
  - Save stays disabled until a supported value, or Provider default (reset), is chosen.
- **Trace:** `agent:setConfig {…ReasoningEffort}` → `setAgentCfg` → `ptah / agentOrchestration.<key>`. The readers are `AgentSpawnEnvironment.resolveReasoningEffort` (`agent-spawn-environment.service.ts:118-153`; Pi's value goes raw to `pi-cli.adapter.ts:377` `--thinking`).
- **Tests:**
  - New `agent-rpc.handlers.set-config.spec.ts`:
    - `refuses an unsupported Pi effort and writes nothing, even with other fields in the batch` (the persisted settings map stays empty)
    - `persists the supported Pi effort %p`, for `max`, `off` and `''`
    - `refuses Pi-only values for Codex and Copilot`
  - `ptah-cli-config.component.spec.ts`: `review #6: an unsupported saved Pi effort is never offered or re-saved; a supported value or reset is required`. It asserts the option list, the message, the disabled Save, that no save call happens, and that a reset to `''` then saves.

### Files changed in this round
- **Backend:**
  - `libs/backend/auth-providers/src/lib/auth/effective-route.ts` and its `.spec.ts`
  - `libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts` and its `.spec.ts`
  - `libs/backend/auth-providers/src/lib/provider-models.service.ts` and its `.spec.ts`
  - `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  - `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.set-config.spec.ts` (new)
  - `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts`
- **Shared:**
  - `libs/shared/src/lib/types/rpc/rpc-auth.types.ts`
  - `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`
- **Frontend:**
  - `S` and its `.spec.ts`
  - `W` and its `.spec.ts`
  - `providers-settings.component.spec.ts`
  - `agent-orchestration-config.component.ts` and its `.spec.ts`
  - `ptah-cli-config.component.ts` and its `.spec.ts`

### Out of scope, not touched
- `agent:setConfig` logs its raw params at debug level, and those params include `cursorApiKey` (`agent-rpc.handlers.ts`, first line of the setConfig handler). This was already the case and should be redacted in a separate change.
- A conflict on one edited tier marks the later tier operations in the same commit as not saved, because they depend on the earlier ones. The user reopens setup and saves again.

## Item 13 — credential leaked to debug log (added at user request)

- Change: `agent:setConfig` logged raw `params` at debug level, including
  `cursorApiKey`. It now logs field names only
  (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:262-265`).
- Test: `agent-rpc.handlers.set-config.spec.ts` › "never writes a credential value
  to the log" — serialises every logger mock call and asserts the secret is absent.
  Mutation check: with the old log line restored the test fails (1 failed / 5 passed);
  with the fix, 6/6 pass. `typecheck` + `lint` for rpc-handlers pass.
- Status: done. Not in scope, reported separately: the Cursor key itself is
  persisted in plain settings (`ptah.provider.cursor.apiKey`, same file :307-312),
  not in the encrypted secrets store.

## Review round 2 fixes (orchestrator, in-process — lane revise cap of 2 reached)

| Defect | Change | Test | Mutation check |
|---|---|---|---|
| N1 Blocking — stored key could reach a caller-chosen endpoint | `DraftVerificationService.bindStoredDraft` rebuilds a `kind:'stored'` draft from host config BEFORE the key is read: direct Anthropic = `apiKey` with no URL; `custom` only for a saved custom entry, URL replaced by the saved one; any caller URL must equal the saved URL (`ProviderAuthResolver.getSavedBaseUrl`). Mismatch → typed `stored-credential-mismatch` (shared union, service detail, wizard copy). | `draft-verification.service.spec.ts` — 4 refusal cases (foreign URL, custom on registry provider, custom on Anthropic, URL on Anthropic) assert no secret read, no probe, no write; saved-URL case probes only the saved endpoint | binding disabled → 5 fail |
| N3 Blocking — clearing an active tier left `process.env` stale | `ProviderModelsService.clearModelTier` for the active provider: falls back to registry default / live-derived tier in BOTH `authEnv` and `process.env` (+ metadata); with no fallback, deletes the tier and its metadata from both. Inactive provider and `cliAgent` untouched. | `provider-models.service.spec.ts` — fallback case, no-default case, inactive-provider case, all asserting `process.env` | old behaviour → 2 fail |
| N2 Serious — first activation conflicted with its own auto-map | `connectProvider` writes edited main-agent tiers FIRST and activates LAST (`dependsOnPrevious`), so `auth:saveSettings`' fill-if-unset auto-map cannot pre-fill a snapshotted tier; a conflicting tier write stops activation. | `providers-settings-state.service.spec.ts` — auth:saveSettings mock now simulates the real auto-map; asserts call order, stored result, and that a conflict blocks activation | old order → 2 fail |

Write-path trace (N2/N3): `provider:setModelTier` / `provider:clearModelTier` →
`provider.<id>.mainAgent.modelTier.<tier>` (global) → read by
`ProviderModelsService.applyPersistedTiers` on activation and by
`ProviderAuthResolver.buildTierValues`; env side effect only when `<id>` equals
`ActiveProviderResolver.resolveActiveAuth().providerId`; the SDK launch spreads
`process.env` then `authEnv` (`sdk-query-options-builder.ts:~993`), now consistent.

Verification: `npx nx run-many -t typecheck,test,lint -p shared auth-providers rpc-handlers core chat --skip-nx-cache` — all targets pass for 5 projects.

## Round 3 verification result and N4 fix

Codex verification-only pass (appended to code-logic-review.md): N1, N2, N3 closed,
including URL bypass attempts (case, trailing slash, userinfo, path/query,
attacker-saved custom entry, local modes with a foreign URL). New N4 (Serious),
introduced by the N1 binding: for `local-native` / `local-proxy` the binding dropped
`baseUrl`, so `buildDraftOverride` took `resolveLocalNative`, which attaches no key —
a protected endpoint rejects, an anonymous one could look verified.

Fix: `bindStoredDraft` keeps the HOST-SAVED URL for every mode except `apiKey`
(which resolves the saved URL itself), so local modes take the credential-bearing
draft-URL branch against the saved endpoint. Caller URLs are still refused unless
equal to the saved one.
Test: `draft-verification.service.spec.ts` › "keeps the stored key for %s by probing
the saved endpoint" (local-native, local-proxy; real `ollama-cloud` entry).
Mutation check: old binding → 2 fail. `auth-providers` typecheck/test/lint pass.
