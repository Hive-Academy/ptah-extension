# TASK_2026_555: write-path trace (Task 37.2)

Every persisted-settings write the task touched: control, RPC, handler, store key, runtime reader, read-back, and the
effect on a running session. Written at Batch 37 against head `68dc462cb` (+ the Batch 37 working tree), track A with
track B merged.

## How to read this

- **V** = I opened the file at this head and the `file:line` is current. **P** = taken from `implementation-plan.md` §3 or
  a batch report and not re-read at its original line (the line may have drifted; the symbol is what to search for).
- **Read-back** = the UI-side check that runs after the write (`ProvidersCommitService.settle`,
  `libs/frontend/core/src/lib/services/providers-commit.service.ts:381-407`, V). A write is `saved` only when the RPC
  acknowledged it **and** the read-back matched. A rejected write is `unsaved`; a throw, a context change or a failed
  read-back call is `unconfirmed`. RPC error text never enters the state (`:389-392`, V).
- Backend-side evidence for every row: the handler's own spec in `libs/backend/rpc-handlers/src/lib/handlers/`.
- Paths: `RH` = `libs/backend/rpc-handlers/src/lib/handlers`, `CORE` = `libs/frontend/core/src/lib/services`.

## 1. Persistence layer (TASK_2026_553, Batches 1-2b)

| Step | Evidence |
|---|---|
| `set()` keeps the old value in memory, restores it when the queued persist rejects, calls listeners only after success | `libs/backend/platform-core/src/file-settings-manager.ts:113-131` (V) |
| `persist()` throws `SettingsPersistError` carrying only the fs code and fixed text | `file-settings-manager.ts:571-595` (V) |
| The queue keeps accepting writes after a failure | `file-settings-manager.ts:127-129` (V); spec `set() recovers when a prior persist() in the chain rejected` |
| Specs | `file-settings-manager.error-paths.spec.ts`: `persist() logs and rejects with SettingsPersistError when writeFile fails`, `carries only the fs code and fixed text, never the value`, `leaves the previous value unchanged in memory and on disk`, `removes a key that did not exist before the failed write`, `accepts the next set() after a failure and persists it`, `does not call listeners on failure and calls them on the next success`, `flushSync() keeps swallowing write errors` (V, run in the Batch 37 test run) |
| Startup survives a rejecting write | `bootstrap.cursor-key.spec.ts` (vscode, electron), `with-engine.spec.ts` (cli-engine); full survey in `TASK_2026_553/fix-report.md` "Startup survives a rejecting write" |
| Frontend effect | a rejected handler write returns `success:false` / an error envelope; `runCommit` records the field as `unsaved`, and the toast shows "Not saved: ..." (D15) |

## 2. Providers tab (Batches 8-28d)

| Control | RPC and handler | Store key / scope | Runtime reader | Read-back (UI) | Running-session effect |
|---|---|---|---|---|---|
| Main Agent popover: provider (D6 confirm) | `auth:saveSettings {authMethod, anthropicProviderId?, applyTo}`: `RH/auth-rpc.handlers.ts:1039`; scope writes `:1065-1071` (authMethod), `:1100-1112` (anthropicProviderId, then `autoMapProviderTiers`) (V) | `authMethod`, `anthropicProviderId` in `~/.ptah/settings.json`, scope global/app/workspace via `scopeResolver.write` + `clearMoreSpecific` (V) | `libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts` (P) | none on the write itself (the page refresh re-reads the route); `activationAuth` goes through `commits.operations({auth})` (`providers-commit.service.ts:74-82`, V) | **Ends every live chat session**: `sdkAdapter.reset()` at `auth-rpc.handlers.ts:1115` (V), see section 5 |
| Main Agent popover: model | `config:model-switch {model, applyTo}`: `RH/config-rpc.handlers.ts:185` (V) | `provider.<authKey>.selectedModel`, file store, scoped (`libs/backend/settings-core/src/repositories/model-settings.ts:42-45`, V) | `chat-session.service.ts` (`libs/backend/rpc-handlers/src/lib/chat/session/`) (P) | `config:model-get` equals the written model: `providers-commit.service.ts:92-93` (V) | Next session |
| Main Agent popover: effort (also Advanced "Chat reasoning effort", same setting, G9) | `config:effort-set {effort, applyTo}`: `config-rpc.handlers.ts:667` (V) | `provider.<authKey>.reasoningEffort` (`reasoning-settings.ts:42-47`, P) | `agent-spawn-environment.service.ts:136-143` (V); chat send passes the frontend value (`chat-session.service.ts:568`, P) | `config:effort-get` equals the written value: `providers-commit.service.ts:104-106` (V) | Next session / spawn |
| Scope badge: Clear override / Use global | `config:clearScopeOverride {key, target}`: `RH/config-scope-rpc.handlers.ts:101-146` (V) | removes the nearest override, or everything above global | per key | `providers-settings-state.service.ts:630-652` (`clearScopeOverride`, read-back at `:652`, V) | **Ends every live session** for `authMethod`, `anthropicProviderId` and `provider.*` keys: `config-scope-rpc.handlers.ts:120-145`, `reset()` at `:141` (V). Other keys: none |
| Workspace override clear | `auth:clearWorkspaceOverride`: `auth-rpc.handlers.ts:1684`, `sdkAdapter.reset()` at `:1703` (V) | removes the workspace layer | resolver | `providers-settings-state.service.ts:617` (`clearWorkspaceOverride`, V) | **Ends every live session** (section 5) |
| Drawer Models and Tiers (mainAgent) | `provider:setModelTier` / `provider:clearModelTier {scope:'mainAgent'}`: `RH/provider-rpc.handlers.ts:593`, `:688` (V) | `provider.<id>.mainAgent.modelTier.<tier>`, file store, global (P, `provider-models.service.ts`) | `buildTierEnvDefaults` at query start: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1240` (V) | `provider:getModelTiers` equals the value: `providers-commit.service.ts:254-263` (`mainAgentTierOperation`, V) | Active provider: used by the next query. Inactive: stored until activation |
| Drawer Credentials: Replace key (verify, then save) | `auth:verifyDraftConnection`, then `auth:setApiKey`: `auth-rpc.handlers.ts:1349` (V), key via `setProviderKey` / `setCredential` | SecretStorage `ptah.auth.provider.<id>` / `ptah.auth.anthropicApiKey` (P) | strategies at configure (`api-key.strategy.ts`, P) | status re-read after the commit | no `reset()` in the handler (`:1349-1394`, V), **but the secret write fires `ConfigWatcher`, which ends every live session**: section 5 (indirect trigger) |
| Drawer Credentials: Delete key (D4, restores #7/#8) | `auth:deleteStoredKey {providerId}`: `auth-rpc.handlers.ts:1399`; `anthropic` -> `setCredential('apiKey','')` `:1416-1417`, else `deleteProviderKey` `:1419`; clears the check cache `:1422`, model cache and auth-status cache `:1435-1436` (V) | the same SecretStorage keys | the same strategies | `auth:getAuthStatus.hasApiKey !== true` / `auth:getApiKeyStatus` entry: `providers-connection-setup.service.ts:344-351` (V) | no `reset()` in the handler (`:1399-1445`, V), **but the secret delete fires `ConfigWatcher`, which ends every live session** (section 5). If this key drives the main agent the route shows needs-key (confirm copy says so) |
| Drawer Credentials: Copilot sign out (restores #12) | `auth:copilotLogout`: `auth-rpc.handlers.ts:1268-1292`, awaits `copilotAuth.logout()` (tombstone persist) (V) | `provider.github-copilot.loggedOut` (P, `copilot-auth.service.ts`) | Copilot auth service | `auth:getAuthStatus.copilotAuthenticated !== true`: `providers-connection-setup.service.ts:353-358` (V) | none; no reset in this handler (V) |
| Drawer Advanced: base URL / models endpoint (verified probe first) | `provider:updateCustomEntry {changes:{baseUrl?, modelsEndpoint?}}`: `provider-rpc.handlers.ts:800` (V) | `provider.custom.entries`, file store, global (`libs/backend/settings-core/src/repositories/custom-provider-store.ts`, P) | strategy configure; `provider-models.service.ts` (P) | entry re-read, fields equal: `providers-connection-setup.service.ts:418-425` (V) | Next configure or model fetch; no reset |
| Drawer: local server base URL (verified) | `llm:setProviderBaseUrl`: `RH/llm-rpc-app.handlers.ts` (P) | `provider.<id>.baseUrl` | `local-native.strategy.ts`, `api-key.strategy.ts` (P) | `llm:getProviderBaseUrl` equals: `providers-connection-setup.service.ts:436-439` (V) | Next configure |
| Drawer Advanced: help URL, pricing | `provider:updateCustomEntry {changes:{helpUrl, pricing}}`: `provider-rpc.handlers.ts:800` (V) | same entry | help URL: drawer/wizard links only. **Pricing has no runtime reader**; stored and displayed (UI copy says so) | entry re-read, `samePricing`: `providers-connection-setup.service.ts:389-396` (V) | none (metadata) |
| Drawer Advanced: Delete connection (restores #25) | `provider:removeCustomEntry {id}`: `provider-rpc.handlers.ts:834` (V) | removes the entry and its secret | registry republish | entry is gone: `providers-connection-setup.service.ts:372-375` (V). Refused while the connection drives the main agent (`:368-371`, V) | Blocked for the active driver; otherwise none |
| Wizard connect (unchanged flow) | `provider:addCustomEntry` `:772`, `auth:setApiKey`, `llm:setProviderBaseUrl`, tier writes, then `auth:saveSettings` | as above | as above | per-stage read-backs at `providers-connection-setup.service.ts:202-255` (V); tiers use compare-and-set with a `conflict` outcome (`:236-246`, V; TASK_2026_552) | the activation step ends sessions (`auth:saveSettings` `:1115`) |

## 3. Agent Orchestration tab (Batches 29-36d)

All `agent:setConfig` fields go through one operation loop, `providers-commit.service.ts:181-205` (V): write
`agent:setConfig {<field>: value}` and read back with `sameSetting(agent:getConfig[field], value)`. Handler:
`RH/agent-rpc.handlers.ts:272` (V). Writer helper: `setAgentCfg` -> `workspace.setConfiguration('ptah', 'agentOrchestration.<key>', value)`
at `agent-rpc.handlers.ts:1046-1052` (V). File routing: the keys listed at `libs/backend/platform-core/src/file-settings-keys.ts:162-174` (V).

| Control | RPC / field | Store key | Runtime reader | Running-session effect |
|---|---|---|---|---|
| Policy bar: max concurrent agents | `agent:setConfig {maxConcurrentAgents}` | `agentOrchestration.maxConcurrentAgents` | `agent-spawn-environment.service.ts:228` (V) | next spawn |
| Policy bar: preferred order | `{preferredAgentOrder}` | `agentOrchestration.preferredAgentOrder` | `agent-spawn-environment.service.ts:254` (V) | next spawn |
| Matrix: system CLI on/off | `{disabledClis}` (`agent-rpc.handlers.ts:379-380`, V) | `agentOrchestration.disabledClis` | `agent-spawn-environment.service.ts:247` (V) | next spawn (hard disable) |
| Matrix: system CLI model (codex, copilot, cursor, antigravity, opencode, pi) | `{<cli>Model}` | `agentOrchestration.<cli>Model` | **`resolveModel`, `agent-spawn-environment.service.ts:165-179` (V), after D8** | next spawn. Before D8: dead read (section 4) |
| Matrix: effort (codex, copilot, pi) | `{<cli>ReasoningEffort}` | `agentOrchestration.<cli>ReasoningEffort` | **`resolveReasoningEffort`, `:118-153` (V), after D8**. Codex and Copilot: the in-chat effort wins when set (`:139-143`) | next spawn |
| Copilot auto-approve | `{copilotAutoApprove}` plus a live push to the permission bridge (`agent-rpc.handlers.ts:339-351`, P) | `agentOrchestration.copilotAutoApprove` | bridge push (live); spawn read **`resolveAutoApprove`, `:155-163` (V), after D8** | live for the bridge, next spawn for the env |
| Cursor credential set / clear (TASK_2026_551) | `agent:setConfig {cursorApiKey}`; handler `agent-rpc.handlers.ts:319-338` (P) (an empty string deletes the secret) | SecretStorage `ptah.auth.provider.cursor` | `cursor-cli.adapter.ts:187` `resolveCursorApiKey`, env `CURSOR_API_KEY` wins (V) | next run; none while the env var is set (UI note). **The secret write (`ptah.auth.provider.cursor`) fires `ConfigWatcher` and ends every live session** (section 5) |
| Cursor read-back | `agent:getConfig` adds `cursorApiKeyStored` and `cursorApiKeyEnvSet`: `agent-rpc.handlers.ts:205-206` (V) | n/a | n/a | UI read-back: `providers-settings-state.service.ts:292-295` `saveCursorCredential`, `cursorApiKeyStored === stored` (V) |
| Ptah instance on/off, model, name, key | `ptahCli:update`: `RH/ptah-cli-rpc.handlers.ts:176` (V) | `ptahCliAgents` (file), key `ptah.auth.provider.ptahCli.<id>` | `ptah-cli-registry.ts:438`, `:654` (via `resolveEffectiveTiers`, V) | next spawn. A key replace is a `ptah.auth.provider.ptahCli.<id>` secret write: **ends every live session** (section 5) |
| Tier mapping modal (D5) | `ptahCli:update {tierMappings}` | `ptahCliAgents[id].tierMappings` | `resolveEffectiveTiers`, `ptah-cli-registry.ts:1604` (V): instance > provider cliAgent > defaults | next spawn; read-back `settings:get ptahCliAgents`, `providers-commit.service.ts:270-293` (V) |
| Add / delete instance | `ptahCli:create` `:133`, `ptahCli:delete` `:235` (V); Copilot instances also `auth:copilotLogin` | `ptahCliAgents` + secret | registry | next spawn. `auth:copilotLogin` itself resets the SDK (`auth-rpc.handlers.ts:1233`, V). An instance created with a key writes a `ptah.auth.provider.ptahCli.<id>` secret: section 5 |
| Background roles: memory curator provider / model | `memory:setTriggers`: `RH/memory-rpc.handlers.ts:721` (V) | `memory.curatorProvider` / `memory.curatorModel` via `setConfiguration('ptah')` | `memory-trigger.service.ts` (P) | read per call (effectively live); read-back `memory:getTriggers`, `providers-commit.service.ts:109-123` (V) |
| Background roles: lanes | `skillSynthesis:setLanes`: `RH/skills-synthesis-rpc.handlers.ts:883` (V) | `skillSynthesis.<lane>.<field>` | `lane-resolver.service.ts` (P) | next lane run; read-back `skillSynthesis:getLanes`, `providers-commit.service.ts:125-148` (V) |
| Background roles: judging provider / model / enhance timeout | `skillSynthesis:updateSettings`: `skills-synthesis-rpc.handlers.ts:562` (V) | `skillSynthesis.judgeProvider|judgeModel|enhanceTimeoutMs` | `lane-resolver.service.ts:107` (`JUDGE_MODEL_KEY`, V), `skill-enhancer.service.ts` (P) | next read; read-back `skillSynthesis:getSettings`, `providers-commit.service.ts:149-180` (V). The picker's `''` is written as `'inherit'` (`:156-160`, V) |
| Undo (any row) | the same RPC with the previous value | same | same | same effect as the row |

## 4. D8: the orchestration reader and the file store

- **Writer** (unchanged): `agent:setConfig` -> `setAgentCfg` -> `workspace.setConfiguration('ptah', 'agentOrchestration.<key>', value)`
  (`agent-rpc.handlers.ts:1046-1052`, V). Keys in the file-routed set (`file-settings-keys.ts:162-174`, V) land in `~/.ptah/settings.json`.
- **Before D8** (`git show 50c773767^:libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-spawn-environment.service.ts`):
  the three readers called `getConfiguration('ptah.agentOrchestration', '<key>')`: section `'ptah.agentOrchestration'`, bare key
  (`piReasoningEffort`, `copilotAutoApprove`, `<cli>ReasoningEffort`, `<cli>Model`). That pair never matches the file-routed
  key `agentOrchestration.<key>` under section `'ptah'`, so it fell through to the host (VS Code) configuration. On Electron and
  CLI, and on VS Code for these file-routed keys, the saved model, effort and Copilot auto-approve **never reached the spawn**:
  a dead read, the default always won.
- **After D8** (Batch 4, `50c773767`): `getConfiguration('ptah', 'agentOrchestration.<key>', default)` at
  `agent-spawn-environment.service.ts:124-127` (pi effort), `:146-151` (codex/copilot effort), `:158-162` (Copilot auto-approve),
  `:172-177` (model) (V). Same form as the sibling reads at `:199`, `:228`, `:247`, `:254` and the writer.
- **The one regression test**: `agent-spawn-environment.settings-routing.spec.ts` with a workspace-provider fake that honours the real
  section rule: `reads a model written with the writer key form through the file store`, `reads the per-CLI effort key the writer writes
  when no UI effort is set`, `still prefers the UI effort selection over the file-stored value`, `reads pi effort raw from the file store
  and ignores the UI selection`, `reads copilot auto-approve from the file store`, `keeps the defaults when the file store has no value`,
  `does not read the host configuration for these file-routed keys` (V).

## 5. Finding: what ends a running chat session

`SdkAgentAdapter.reset()` (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:625`) runs `doReset()` (`:649`), which calls `dispose()`
(`:661`), which calls `sessionLifecycle.disposeAllSessions()` (`:550-551`), then re-initialises. Every live chat session ends.
Settings writes that reach it (V, each line read at this head):

| Trigger | Where | Behind a confirm in the new UI? |
|---|---|---|
| Provider change / activation (`auth:saveSettings`) | `auth-rpc.handlers.ts:1115` | Yes: Main Agent popover D6 confirm; wizard activation step |
| Clearing an auth / provider scope override (`config:clearScopeOverride` for `authMethod`, `anthropicProviderId`, `provider.*`) | `config-scope-rpc.handlers.ts:139-141` | Yes: scope badge confirm |
| `auth:clearWorkspaceOverride` | `auth-rpc.handlers.ts:1703` | Yes: "Use global" |
| GitHub Copilot sign-in (`auth:copilotLogin`) | `auth-rpc.handlers.ts:1233` | **No.** Reached from the wizard's sign-in step and the Add instance modal (#47). Not widened by this task |
| Codex login (`auth:codexLogin`) | `auth-rpc.handlers.ts:1586` | **No.** Reached from the wizard "Open login". Not widened by this task |

**Indirect trigger found in this trace (V, read at this head):** `ConfigWatcher` (`libs/backend/agent-sdk/src/lib/helpers/config-watcher.ts`) is
resolved at startup (`libs/backend/agent-sdk/src/lib/di/register.ts:633`). It watches the config keys `authMethod` and `anthropicProviderId`
(`:57`) and **every SecretStorage change whose key starts with `ptah.auth.`** (`:66-71`). A hit calls `events.emitConfigChanged` (`:121`), and the
adapter's own listener (`sdk-agent-adapter.ts:230-239`) runs `disposeAllSessions()` and `initialize()`. The Electron secret store fires
`onDidChange` on every `store()` (`libs/backend/platform-electron/src/implementations/electron-secret-storage.ts:102`). So these writes **also
end every live session**, with no `reset()` call in their handler and no confirm in the UI:

| Write | Secret key |
|---|---|
| Drawer Credentials: Replace key (`auth:setApiKey`) | `ptah.auth.provider.<id>` / `ptah.auth.anthropicApiKey` |
| Drawer Credentials: Delete key (`auth:deleteStoredKey`) | the same keys |
| Cursor credential set / clear (`agent:setConfig {cursorApiKey}`) | `ptah.auth.provider.cursor` |
| Ptah instance key replace, Add instance with a key (`ptahCli:update` / `ptahCli:create`) | `ptah.auth.provider.ptahCli.<id>` |

Not verified here: VS Code's own firing of `secrets.onDidChange` for a change made by the same extension host (the Electron implementation is
verified), and no live run exercised this path. Plan §3 recorded these rows as "None now"; **that was wrong for the secret writes** and should be
corrected in the plan's trace and in the confirm copy decision.

Not triggers (V: no `reset()` in the handler, and no `ptah.auth.*` secret or `authMethod` / `anthropicProviderId` write): `auth:copilotLogout`
(writes `provider.github-copilot.loggedOut`), tier writes, base-URL writes, every `agent:setConfig` field except `cursorApiKey`, `memory:*`,
`skillSynthesis:*`, and every Advanced and Search & Voice write below (web search keys are `ptah.webSearch.apiKey.*`, the ElevenLabs key is
`voice.elevenlabs.apiKeyCipher`, neither under `ptah.auth.`). Plan §3 named the first three direct triggers; Copilot and Codex login (direct) and
the secret writes (indirect) are additions from this trace. The reset itself is out of this task (user decision R1). **For the final report:** the
confirm copy covers the three settings paths the plan named; two login flows and four secret writes still end sessions without a confirm.

## 6. Advanced and Search & Voice tabs (Batches 39-50)

Source: the batch reports (each lists its persisted writes). Batches 39, 40, 40b, 42 (mode toggle), 46, 49, 49b, 50a-50c changed **no** RPC, key or reader; they
changed only feedback, revert and read-back handling. Rows below are the writes the tabs make.

| Control (batch) | RPC and handler | Store key | Runtime reader | Read-back / D15 | Running-session effect |
|---|---|---|---|---|---|
| Generic save entry (39) | `SettingsSaveFeedbackService.saveGeneric` (client only; returns `SettingsSaveResult`, 51.4) | n/a | n/a | "Saved" only after the write's own result | n/a |
| Membership key, log out (40) | `license:setKey` / `license:clearKey`: `RH/license-rpc.handlers.ts:185` (V) | license store | `license:getStatus` | none changed (P, batch-40-report) | none |
| Export / Import settings (40) | Electron `settings:export` / `settings:import`; VS Code `command:execute ptah.exportSettings` / `ptah.importSettings` | `~/.ptah/settings.json` (+ `config:*`, `ptah.*` secrets on import) | all | import outcome mapped to fixed sentences; N4 (50c) distinguishes per-key failure from a bad file (`advanced-settings.component.ts:27,244`, P) | Import can change auth keys; no reset in the handler |
| System prompt mode (41) | `enhancedPrompts:setEnabled {workspacePath:'.', enabled}`: `RH/enhanced-prompts-rpc.handlers.ts:397` (V) | unchanged (P) | agent prompt builder (`assemble-system-prompt.ts`, P) | unchanged | next session |
| Regenerate / Download prompt (42) | `enhancedPrompts:regenerate {force:true}` (120 s), `enhancedPrompts:download` | `.ptah/analysis/enhanced-prompt.md` / `.json`; user-chosen file | `getStatus`, `getPromptContent`, prompt builder | N1 (50c): only a client-budget timeout enters "may still be running" (`system-prompt-drawer.component.ts:457-472`, P) | none |
| Chat reasoning effort, Ultracode (41) | `config:effort-set` (`config-rpc.handlers.ts:667`, V), same key as Providers > Main Agent effort (G9) | `provider.<authKey>.reasoningEffort`, app scope | `config:effort-get` -> `EffortStateService`; `agent-spawn-environment.service.ts:136-143` (V) | read-back through `UltracodeStateService.enable()/disable()` (P, batch-41-report); effort read-back as in section 2 | next session. The Ultracode "on" flag is session-only |
| Dynamic workflows (41) | `agent:setConfig {workflowsDisabled}`: `agent-rpc.handlers.ts:395-401` (P) | `ptah.workflows.disabled` (workspace config) | `ChatSessionService.resolveWorkflowsDisabled` (`chat-session.service.ts:1364`, V) -> `sdk-query-options-builder.ts:1250-1251` sets `CLAUDE_CODE_DISABLE_WORKFLOWS=1` (V). No plan check, which confirms PR-2 | save on selection with Undo | next query |
| Output style: activate, save, delete, copy to project (43, 50c) | `outputStyle:activate` `output-style-rpc.handlers.ts:270`, `:save` `:412`, `:delete` `:461` (V), `outputStyle:copyToProject` | state key `outputStyle`; `.claude/output-styles/<name>.md` (project) or `~/.claude/output-styles/<name>.md` (user); `.claude/settings*.json` when parity is requested | prompt builder, `OutputStyleStore`, Claude CLI | `parityActivated` only after a successful activation (N3); copy over an existing project style asks first and sends `overwrite:true` only when confirmed (item 16) | next session |
| MCP port (44) | `agent:setConfig {mcpPort}` (`agent-rpc.handlers.ts:229`, `:375`, V) | `agentOrchestration.mcpPort` (clamped 1024-65535) | MCP server startup (P) | explicit Save + Undo; fixed `COULD_NOT_SAVE_PORT` | applies on MCP restart (the UI says so) |
| MCP tool namespaces (44) | `agent:setConfig {disabledMcpNamespaces}` | `agentOrchestration.disabledMcpNamespaces` (`file-settings-keys.ts:174`, V; batch-44-report states `ptah.mcp.disabledNamespaces`) | MCP tool registration | save on selection + Undo | next MCP tool listing |
| Browser Allow localhost (44; folded from `browser-settings`) | `agent:setConfig {browserAllowLocalhost}` | `ptah.browser.allowLocalhost` (P) | `browser-manager` (P) | enabling asks first (inline confirm, no Undo); disabling saves at once with Undo | next browser call |
| VS Code LM model / default provider (44, 50c N5) | `llm:setDefaultModel` `llm-rpc-app.handlers.ts:567`, `llm:setDefaultProvider` `:527` (V) | LLM configuration store | `llm:getProviderStatus`, CLI detection | `confirmedModel` linked signal: a failed status refresh does not show the old model under "Saved" (`vscode-lm-config.component.ts:176-238`, P) | next detection |
| Web search providers, max results (45) | `webSearch:setConfig`: `RH/web-search-rpc.handlers.ts:257` (V; providers via `WebSearchProvidersSchema`, clamped 1-20) | `ptah.webSearch.providers` (also clears legacy `ptah.webSearch.provider`), `ptah.webSearch.maxResults` | `WebSearchService` (`libs/backend/vscode-lm-tools/.../web-search.service.ts:376-391`, `:146-148`, P) | save on selection + Undo; at least one provider stays on | next search |
| Web search keys (45) | `webSearch:setApiKey` `:123`, `webSearch:deleteApiKey` `:158` (V) | SecretStorage `ptah.webSearch.apiKey.<provider>` | `web-search.service.ts:231` (P) | save then test; Clear behind an inline confirm, no Undo | next search |
| Voice provider choice (46) | `voice:setProviderConfig {sttProvider|ttsProvider}`: `RH/voice-rpc.handlers.ts:264`, handler body `:717-760` (P) | `ptah.voice.sttProvider` / `ptah.voice.ttsProvider` (`voice-provider-selector.ts:24-25`, P) | `activeStt()` / `activeTts()`, used by `voice:transcribe` / `voice:synthesize` and the messaging gateway (P) | save on selection + Undo | next transcription / synthesis |
| Local STT model, source, custom (47) | `voice:setConfig`: `voice-rpc.handlers.ts:217` (V), `writeConfiguration` | `ptah.voice.whisperModel`, `whisperModelSource`, `whisperCustomModel` (`voice-providers/.../local/model-settings.ts`) | `resolveWhisperModel`, `local-stt-provider.ts` (P) | revert on a failed write; "Saved" only on `isSuccess() && data.ok` (V: `local-stt-panel.component.ts:451`, P line) | next transcription |
| Local TTS voice, source, custom (47) | `voice:setTtsConfig`: `voice-rpc.handlers.ts:234` (V) | `ptah.voice.ttsVoice`, `kokoroModelSource`, `kokoroCustomModel` | `resolveTtsVoice`, `local-tts-provider.ts` (P) | **payload change:** a voice change writes `{voice}` only, so an unsaved source draft is no longer persisted as a side effect (batch-47-report deviation 1) | next synthesis |
| Model downloads (47) | `voice:downloadModel`, `voice:downloadTtsModel` | model files, not configuration | n/a | status inline | n/a |
| ElevenLabs key (48) | `voice:setApiKey`: `voice-rpc.handlers.ts:267` (V) | `voice.elevenlabs.apiKeyCipher` (`VoiceSecretStore`); empty string clears | `elevenlabs-client.ts` `getKey` (P) | verify-then-save (`voice:testConnection` probe); Clear keeps its confirm open on failure | next ElevenLabs call |
| ElevenLabs voice, models, format (48) | `voice:setProviderConfig {elevenlabs:{voiceId|ttsModelId|outputFormat|sttModelId}}` | `voice.elevenlabs.voiceId` / `.ttsModelId` / `.outputFormat` / `.sttModelId` | `elevenlabs-tts-provider.ts`, `elevenlabs-stt-provider.ts` (P) | select reverts on RPC error, `{ok:false}` or a throw | next call |
| go vet consent (48) | `diagnostics:go-vet-consent-set` (`diagnostics-consent-rpc.handlers.ts:222-224`, read back with rollback `:240-259`, P) | per-root record `<sha256(root)[0..32]>.json` | `go-vet-checker.ts` (P) | enable names the root in a confirm; stale-consent copy | next diagnostics run |

## 7. Evidence limits

- **P rows** were not re-read at this head. Their symbols are named so they can be found; the plan §3 and batch-report lines for the same rows
  were reviewed at their own batch commits.
- The `auth:copilotLogin` and `auth:codexLogin` resets and the `ConfigWatcher` secret trigger are new in this trace (section 5); no earlier batch recorded them.
  None was exercised by a test or a live run in Batch 37.
- No row in section 6 shows a persisted-key change by Batches 39-50 except the Local TTS payload narrowing (Batch 47) and the move of
  "Allow localhost" into `McpPortConfigComponent` (Batch 44, same RPC and key as the deleted `browser-settings` component).
- Backend handler specs (`auth-rpc.handlers.delete-stored-key.spec.ts`, `agent-rpc.handlers.set-config.spec.ts`, `ptah-cli-rpc.handlers.spec.ts`,
  `memory-rpc.handlers*.spec.ts`, `skills-synthesis-rpc.handlers*.spec.ts`) run in the `@ptah-extension/rpc-handlers` target of the Batch 37 test run.
