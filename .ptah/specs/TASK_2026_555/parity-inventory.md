# TASK_2026_555: parity inventory (Providers tab + Agent Orchestration tab)

- **Old surface:** `7ecdefa45^1`, before PR #575. Read with `git show 7ecdefa45^1:<path>`.
- **New surface:** `main` at `722d921ab`.
- Line numbers are the positions in each revision.
- **The "16 removed capabilities":** TASK_2026_533 (`task.md:12,22`) and TASK_2026_534 state the number 16, but neither folder lists them. I searched every `*.md` in `.ptah/specs/TASK_2026_533*` and `.ptah/specs/TASK_2026_534*`. So this inventory was built from the code, not from an earlier list. It finds more than 16 missing capabilities, because it also counts ones that #581 did not restore and small ones such as help text.

## Path abbreviations

Old paths are relative to `libs/frontend/chat/src/lib/settings/` at `7ecdefa45^1`.

| Abbrev | Old file |
|---|---|
| `OS` | `settings.component.html` |
| `OST` | `settings.component.ts` |
| `AC` | `auth/auth-config.component.html` |
| `ACT` | `auth/auth-config.component.ts` |
| `CPF` | `auth/custom-provider-form.component.html` |
| `PMS` | `auth/provider-model-selector.component.ts` |
| `AOC` | `ptah-ai/agent-orchestration-config.component.ts` |
| `PCC` | `ptah-ai/ptah-cli-config.component.ts` |

New paths are on `main`.

| Abbrev | New file |
|---|---|
| `NS` | `libs/frontend/chat/src/lib/settings/settings.component.html` |
| `NST` | `libs/frontend/chat/src/lib/settings/settings.component.ts` |
| `PS` | `…/settings/providers/providers-settings.component.ts` |
| `CARD` | `…/settings/providers/provider-connection-card.component.ts` |
| `WIZ` | `…/settings/providers/provider-setup-wizard.component.ts` |
| `NPCC` | `…/settings/ptah-ai/ptah-cli-config.component.ts` (now mounted inside Providers, `PS:211`) |
| `NAOC` | `…/settings/ptah-ai/agent-orchestration-config.component.ts` |
| `STATE` | `libs/frontend/core/src/lib/services/providers-settings-state.service.ts` |
| `PICK` | `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts` |

## 1. Providers / auth

| # | Capability (user-visible) | Old location | Setting key / RPC | Present on main? | New location | Notes (UX better/worse) |
|---|---|---|---|---|---|---|
| 1 | Every provider visible at once in one picker: Claude, registry providers and custom tiles | AC:7-162 | `auth:getAuthStatus`, provider registry | partial | PS:158-172 (configured only); PS:213-235 (collapsed "More providers"); WIZ:461-522 | Worse. Providers that are not configured are hidden in a closed `<details>`, so there is no single overview. |
| 2 | Per-provider configured/active marker (dot, ring, "Active: X") | AC:26-35, 78-116, 175-185 | derived from auth status | yes | PS:78 ("Next request uses: …"); CARD:168-179 status badge | Better: explicit states and a route line. The at-a-glance dot for unconfigured providers is gone. |
| 3 | Switch main provider (select tile, then Save & Test) | AC:9-21, 776-798; ACT:414-444 | `auth:saveSettings {authMethod, anthropicProviderId, applyTo}` + `auth:testConnection` | yes | CARD:210-221, 354-364, 387-397 → PS:175-191 → STATE:527 | Same when the card is Connected. For a checkable provider in Not checked, "Use for main agent" is hidden until Check connection passes. |
| 4 | Claude: API key vs Claude CLI (subscription) toggle | AC:189-219 | `authMethod` `apiKey` / `claudeCli` | yes | Separate "Claude API" and "Claude (Subscription)" connections; WIZ:461-500 | Neutral. |
| 5 | Enter and save an Anthropic API key | AC:221-295 | `auth:saveSettings.anthropicApiKey` | yes | WIZ:647-715 (Connect provider / Add API key) | Worse: goes through the 5-step wizard with a mandatory probe (see click counts). |
| 6 | Masked stored key with "Replace" | AC:244-285, 600-641 | – | partial | WIZ:649-674 ("Key stored", Replace key, Verify stored key) | The Claude API card has `canManage` false (PS:165). A working Anthropic key cannot be replaced from its card, only through "Connect provider". |
| 7 | Remove the stored Anthropic API key | AC:260-269; auth-state `deleteApiKey` | `auth:saveSettings` (clear key) | **no** | – | No way to delete a stored key. |
| 8 | Remove a stored third-party provider key | AC:616-625; auth-state `deleteProviderKey` | `auth:saveSettings` (clear key) | **no** | – | Same as #7. |
| 9 | Key help: Anthropic Console link, "Keys start with sk-ant-api", provider help-URL link, key prefix | AC:296-310, 685-711 | registry `helpUrl`, `keyPrefix` | partial | WIZ:710-714 (`keyPrefixHint`, WIZ:1617) | No "Get a key at …" link anywhere. |
| 10 | Claude CLI Detected / Not found badge, plus install and login commands (`npm install -g @anthropic-ai/claude-code`, `claude login`, "Works with Max, Pro, Team") | AC:315-388 | `auth:getAuthStatus.claudeCliInstalled` | partial | WIZ:758-793; CARD:310-329 ("Installation instructions" is an external action) | The commands are no longer shown inline. |
| 11 | GitHub Copilot sign-in (OAuth), showing the username | AC:395-455 | `auth:copilotLogin`, `auth:copilotStatus` | yes | WIZ:717-757; CARD:256-277 | Better: adds "Cancel sign-in". |
| 12 | GitHub Copilot sign out / disconnect | AC:426-434 | `auth:copilotLogout` | **no** | – | No logout control. The RPC is only referenced by the unused `auth-state.service.ts`. |
| 13 | Codex: auth-file status (`~/.codex/auth.json`), "Token Expired" badge and alert, "Open Codex Login" / "Re-authenticate in Terminal" | AC:467-537 | `auth:codexLogin`; `codexAuthenticated` / `codexTokenStale` | partial | WIZ:758-793 ("Open login"); CARD unauthenticated state | No explicit token-expired copy and no auth-file path. |
| 14 | Local provider (Ollama, LM Studio): "no key needed" and default endpoint | AC:539-570 | registry `baseUrl` | yes | WIZ:794-854 (editable Server URL); STATE:476 `llm:setProviderBaseUrl` | Better: the endpoint is editable. |
| 15 | Ollama Cloud optional key with explanation (static catalogue and $0 cost without a key; link to ollama.com/settings/keys) | AC:572-670 | `supportsOptionalApiKey` | partial | WIZ:822-853 ("API key (optional)") | The explanation and link are gone. |
| 16 | Apply to: Global default / This workspace | AC:717-759; ACT:130-154, 451-456 | `auth:saveSettings.applyTo` | partial | Wizard save target is fixed to global (PS:257 `globalTarget`). Workspace is reachable only through a scope-row "override", then the activation review (PS:128-135, 175-191). | Better: adds an App scope. Worse: the workspace target is hidden and the wizard cannot save to it. |
| 17 | Scope badge (Workspace override / Global default / Inherited) | AC:720-736 | `auth:getScope` | yes | PS:114-137 (`ptah-setting-scope-row` ×5) | More detail, but five stacked scope rows in the main card add clutter. |
| 18 | Clear the workspace override | AC:760-773; ACT:462-465 | `auth:clearWorkspaceOverride` | yes | PS:193-204; STATE:745 `config:clearScopeOverride` | Adds "Use global" (clears every layer above global). |
| 19 | Save & Test with saving, testing, success and error states | AC:776-872 | `auth:testConnection` | yes | WIZ:989-1125 Verify step (draft probe, latency, diagnostics, cancel); PS:93 Check connection | Better diagnostics. Worse: verification is mandatory for every edit, including tier-only edits. |
| 20 | 401 / invalid-key tips (console link) | AC:832-859 | – | partial | WIZ failure copy and "Diagnostic details" | No link to get a key. |
| 21 | "Reload" (window) button after a successful save | AC:807-815; ACT:544-552 | `command:execute workbench.action.reloadWindow` | **no** | – | Probably unnecessary: the backend runs `sdkAdapter.reset()`. **Proposed removal; needs user approval.** |
| 22 | Security copy: "Runs 100% locally" vs "Your own endpoint <host>" | OS:149-181 | `authState.isCustomProviderSelected` | yes | NS:82-110 | Unchanged. |
| 23 | Add custom provider: name, base URL, lane (OpenAI/Anthropic), key | AC:150-161; CPF:20-162 | `provider:addCustomEntry` | yes | WIZ:501-598, 916-977; STATE:451-467 | Lane help copy is shorter; "(safest choice)/(fastest)" guidance is gone. |
| 24 | Edit custom provider (pencil on its tile) | AC:129-140; CPF | `provider:updateCustomEntry` | partial | CARD Manage → wizard; STATE:465 | Needs a full re-verify to change anything. |
| 25 | Delete custom provider (with "Delete for good" confirmation) | CPF:407-439 | `provider:removeCustomEntry` | **no** | – | A custom connection can never be removed. |
| 26 | Test custom provider (latency) | CPF:343-373, 392-405 | `provider:testCustomEntry` | yes | WIZ Verify step (`auth:verifyDraftConnection`) | Equivalent. |
| 27 | Custom provider: models endpoint | CPF:170-189 | `CustomProviderEntry.modelsEndpoint` | **no** | – | Without it the user cannot enable live model listing for a gateway. |
| 28 | Custom provider: help URL | CPF:191-204 | `CustomProviderEntry.helpUrl` | **no** | – | |
| 29 | Custom provider: tier model mapping (sonnet, opus, haiku) | CPF:206-248 | `CustomProviderEntry.defaultTiers` | yes | WIZ:1126-1176 (Models step) | |
| 30 | Custom provider: price per 1M tokens (input/output), with the "cost unavailable" hint | CPF:250-290 | `CustomProviderEntry.pricing` | **no** | – | Session cost for custom gateways cannot be configured. |
| 31 | Custom provider: host security note, validation errors, backend error shown verbatim | CPF:294-341 | – | yes | WIZ:816-821, 938-943 (destination); WIZ:543-551 (name error); PS:241-249 (commit detail) | |

## 2. Main-agent model and tiers

| # | Capability | Old location | Setting key / RPC | Present on main? | New location | Notes |
|---|---|---|---|---|---|---|
| 32 | Model-mapping editor inline on the Providers tab, below auth (third-party provider with a key) | OS:184-198; PMS | `provider:getModelTiers` / `provider:setModelTier` (`scope: 'mainAgent'`) | partial | WIZ:1126-1176, only inside Manage → wizard | Worse: there is no inline editor. It sits behind 3 wizard steps. |
| 33 | Per-tier change saved immediately on selection | PMS:473-479, 558-586 | `provider:setModelTier` | partial | Wizard commit after re-verify; STATE:490-505 | Worse: each tier change needs a real (billable) probe request and a commit. |
| 34 | Searchable model autocomplete (filter by name or id, 50 results, "Search N models…") | PMS:186-217, 354-370 | `provider:listModels` | **no** | PICK:187-206 (native `<select>`, no search) | Much worse for OpenRouter-sized catalogues (200+ models). |
| 35 | Enter a custom model ID per tier | PMS:219-266, 544-552 | `provider:setModelTier` | yes | PICK:249-277 ("Not listed? Enter a model ID") | |
| 36 | Clear a tier back to the default | PMS:148-158, 484-509 | `provider:clearModelTier` | partial | Choose "provider default" in the wizard; STATE:501 | Only through the full wizard. |
| 37 | Current mapping badge / "Using default Anthropic X" per tier | PMS:161-184 | – | partial | WIZ:1155-1160 (`tierSource`, inside the wizard only); PS:80-84 (resolved model only) | Tier mappings are not visible on the page. |
| 38 | Tool-use compatibility: "No tool use" badge, per-model wrench/warning icon, "N models • M support tool use" | PMS:167-178, 272-303 | `ProviderModelInfo.supportsToolUse` | **no** | PICK:467-471 warns only when `requiresToolUse` is set, and the wizard does not set it | The user can map a model that cannot use tools without any warning. |
| 39 | Refresh the model list (hidden for static lists) | PMS:95-106 | `provider:listModels` | partial | PICK:237-245 (Retry, only on error) | |
| 40 | (new) Main-agent model, with a save scope | – (old: the chat model selector) | `auth:saveSettings.model` | new | PS:92, 140-155 | New on main. |
| 41 | (new) Main-agent reasoning effort, with a save scope | – | `auth:saveSettings.effort` | new | PS:95-113 | New on main. |

## 3. CLI agents (Ptah CLI instances and delegated system-CLI settings)

| # | Capability | Old location | Setting key / RPC | Present on main? | New location | Notes |
|---|---|---|---|---|---|---|
| 42 | List Ptah CLI agents with name and provider badge | PCC:364-400 | `ptahCli:list` | yes | NPCC:62-66 | Moved from the Orchestration tab to Providers. |
| 43 | Agent status (Ready / Error / Init / No Key) and colour-coded icon | PCC:375-413 | `PtahCliSummary.status` | **no** | – | Only "Enabled/Disabled" is shown. |
| 44 | Key status ("Key set" / "No API key" / "Cloud (signin)") | PCC:470-484 | `hasStoredKey` | **no** | – | |
| 45 | Model count | PCC:486-491 | `modelCount` | yes | NPCC:66 | |
| 46 | Add agent: name, provider, key | PCC:186-361, 835-881 | `ptahCli:create` | yes | NPCC:42-60 | The provider list is now every connection (broader than the old 9). |
| 47 | Inline "Login with GitHub" in the Add form for Copilot (status, retry) | PCC:295-344, 896-948 | `auth:copilotLogin`, `auth:copilotStatus` | **no** | – | The user must sign in on the Copilot card first. The form does not check sign-in. |
| 48 | Keyless and optional-key hints (Claude subscription, Ollama, `ollama signin`) | PCC:277-293 | – | partial | NPCC:56 (one generic paragraph) | |
| 49 | Show/hide API key (eye toggle) in add and edit | PCC:259-272, 448-461 | – | **no** | – | |
| 50 | Edit name / replace key inline (Enter saves, Esc cancels) | PCC:384-463, 950-996 | `ptahCli:update` | yes | NPCC:87, 90-95 | The keyboard shortcuts are gone. |
| 51 | Enable/disable agent toggle | PCC:415-425, 998-1031 | `ptahCli:update.enabled` | yes | NPCC:81-86 | |
| 52 | Test connection with latency ("Connected (N ms)") or the error text | PCC:495-580, 1069-1106 | `ptahCli:testConnection` | partial | NPCC:88-89 | Shows only "Connection checked." or "Connection check failed.", without latency or reason. |
| 53 | CLI-agent tier mapping modal (Layers button; `scope: 'cliAgent'`) | PCC:512-519, 637-663, 1151-1160 | `provider:get/setModelTier` (`scope: 'cliAgent'`) | **no** | Replaced by one per-instance model (NPCC:67-80, `ptahCli:update.selectedModel`). STATE:608-623 reads `tierMappings` but nothing edits them. | Loss of per-tier control for CLI agents. |
| 54 | Tier-mapping badges on each agent card | PCC:582-611 | – | **no** | – | |
| 55 | Delete with a confirmation dialog | PCC:550-557, 1033-1067 | `ptahCli:delete` | yes | NPCC:96-101 (inline confirm) | |
| 56 | Success and error messages next to the list | PCC:161-174 | – | partial | PS:241-249 (bottom of the Providers page) | Feedback is far from the control. |
| 57 | Empty state with an "Add" link | PCC:617-635 | – | yes | NPCC:61 (text only) | |
| 58 | Tribunal "Configure" deep link opens Add CLI agent with the provider preselected | OS:209; OST:125-130; PCC:757-768 | `pendingSettingsTab.providerId` | partial | PS:362-380 (opens the setup wizard instead) | Behaviour changed by #581 (item 8). |
| 59 | Codex model | AOC:292-321 | `agent:setConfig.codexModel`; `agent:listCliModels` | yes | NPCC:110-144 | Edit → select → Save instead of one select, and on another tab. |
| 60 | Codex reasoning effort | AOC:323-348 | `codexReasoningEffort` | yes | NPCC:110-144 | Same as #59. |
| 61 | Copilot model | AOC:364-393 | `copilotModel` | yes | NPCC | Same as #59. |
| 62 | Copilot reasoning effort | AOC:395-422 | `copilotReasoningEffort` | yes | NPCC | Same as #59. |
| 63 | Copilot auto-approve toggle | AOC:424-440 | `copilotAutoApprove` | yes | NAOC:268-295 | Better: read-back and error handling. |
| 64 | Cursor API key: input, Save, "Set" badge, help ("cursor.com → Dashboard → Integrations", stored in `~/.ptah/settings.json`, `CURSOR_API_KEY`) | AOC:445-498, 903-921 | `agent:setConfig.cursorApiKey` | partial | NPCC:105-109; STATE:360 | No "stored" indicator and no help text. |
| 65 | Cursor model (disabled until a key is set) | AOC:500-528 | `cursorModel` | yes | NPCC | |
| 66 | Antigravity model | AOC:546-578 | `antigravityModel` | yes | NPCC | |
| 67 | opencode model, plus the `provider/model` format hint | AOC:596-629 | `opencodeModel` | partial | NPCC | The format hint is gone. |
| 68 | Pi model | AOC:646-673 | `piModel` | yes | NPCC | |
| 69 | Pi reasoning effort (off…max) | AOC:675-699 | `piReasoningEffort` | yes | NPCC:21, 238-242 | Restored by #581. |
| 70 | Permission notes per CLI: Codex, Cursor and Antigravity run "full auto"; opencode `--auto`; Pi has no approval gate and no MCP | AOC:350-359, 530-540, 580-590, 631-641, 701-711 | – | **no** | – | Safety-relevant information is gone. |
| 71 | Settings grouped per CLI and shown only for installed / configured CLIs | AOC:286-289 | – | **no** | NPCC:110-144 | Worse: a flat list of 9 fields for every CLI, installed or not. One CLI's settings are split across two tabs: the toggle and auto-approve on Orchestration, model/effort/key on Providers. |

## 4. Agent orchestration policy

| # | Capability | Old location | Setting key / RPC | Present on main? | New location | Notes |
|---|---|---|---|---|---|---|
| 72 | Re-detect CLIs | AOC:55-67, 1062-1080 | `agent:detectClis` | yes | NAOC:55-67, 598-624 | Also refreshes the Providers state. |
| 73 | Preferred agent order (up/down; Ptah CLI shown as "Custom"; disabled shown dimmed "Off") | AOC:101-172, 946-974 | `agent:setConfig.preferredAgentOrder` | yes | NAOC:101-167 | The decorative grip icon was removed (#581). |
| 74 | Max concurrent agents slider (1–20) | AOC:174-205 | `maxConcurrentAgents` | yes | NAOC:169-200 | |
| 75 | System CLI rows: Installed vN, Cursor "Configured" / "Needs API key", "Not Found" | AOC:219-271 | `detectedClis` | yes | NAOC:214-254 | |
| 76 | Enable/disable toggle per system CLI | AOC:272-281, 1046-1060 | `disabledClis` | yes | NAOC:255-264 | |
| 77 | "No CLI agents found" install help | AOC:720-740 | – | yes | NAOC:301-321 | |
| 78 | Ptah CLI agents managed inside the Orchestration tab | OS:206-212; AOC:743-744 | – | partial | Moved to Providers (NS:118-120; PS:211) | NAOC:296 repeats "Manage provider, model and credentials in Providers" once per system-CLI row (up to 6 identical buttons). |
| 79 | Loading and error states | AOC:75-88 | `agent:getConfig` | yes | NAOC:75-88 | |

## 5. Other

| # | Capability | Old location | Setting key / RPC | Present on main? | New location | Notes |
|---|---|---|---|---|---|---|
| 80 | License status card at the top of Settings | OS:34-35 | – | yes (moved) | NS:125-127 (Advanced tab) | Less visible. |
| 81 | Data portability: Export / Import settings | OS:37-81; OST:147-181 | `settings:export` / `settings:import` / `command:execute` | yes (moved) | NS:129-173 (Advanced tab) | Less visible. |
| 82 | Back to chat | OS:19-32 | – | yes | NS:19-32 | |
| 83 | Deep link to a Settings tab | OST:125-130 | `consumePendingSettingsTab` | yes | NST:125-149 | Better: also reacts while Settings is open (#581). |
| 84 | VS Code LM model change triggers a CLI re-detect | OS:223; OST:205-207 | – | yes | NS:180; NST:222-224 | |
| 85 | `LlmProvidersConfigComponent` (`ptah-ai/llm-providers-config.*`) | not rendered anywhere at `7ecdefa45^1` | – | n/a | deleted | Dead code; no user-visible loss. |
| 86 | (new) Background model assignments: memory curator, archaeologist, synthesis, judge, replay, judging enhancement | – | `memory:*`, `skillSynthesis:*`, `agent:setConfig` | new | PS:206-209 | New on main. |
| 87 | (new) Provider search, Check connection, per-field three-layer scope provenance | – | `auth:getEffectiveRoute`, `config:getScopes` | new | PS:56, 93, 114-137, 216-217 | New on main. |

## Counts

Old capabilities inventoried: rows 1–39, 42–79 and 80–84 (row 85 is dead code and rows 40, 41, 86 and 87 are new), 82 in total.

| Result | Count |
|---|---|
| yes (including moved) | 43 |
| partial | 21 |
| **no** | 18 |

## Missing capabilities (present in old UI, absent on main)

1. #7: Delete the stored Anthropic API key.
2. #8: Delete a stored third-party provider key.
3. #12: GitHub Copilot sign out / disconnect.
4. #21: Reload-window button after a save. **Proposed removal**, subject to user approval, because the host now resets the SDK.
5. #25: Delete a custom provider.
6. #27: Custom provider models endpoint.
7. #28: Custom provider help URL.
8. #30: Custom provider pricing (input/output per 1M).
9. #34: Searchable model autocomplete for tier mapping.
10. #38: Tool-use compatibility indicators (badge, per-model icon, counts).
11. #43: Ptah CLI agent status (Ready / Error / Init / No Key).
12. #44: Ptah CLI agent key status (Key set / No key / Cloud signin).
13. #47: Inline GitHub login when adding a Copilot-backed CLI agent.
14. #49: Show/hide API key in the CLI agent add and edit forms.
15. #53: CLI-agent tier mapping (Sonnet/Opus/Haiku per provider, `cliAgent` scope).
16. #54: Tier-mapping badges on CLI agent cards.
17. #70: Per-CLI permission and safety notes (full auto, `--auto`, Pi has no approval gate or MCP).
18. #71: Per-CLI grouping of delegated settings, and hiding them for CLIs that are not installed.

Every item except #21 should be restored unless the user approves removing it. The strongest candidates to restore are #7, #8, #12, #25, #30, #34, #38, #53 and #70.

## Regressed UX (present, but harder to use)

1. **Adding an API key** takes a 5-step drawer wizard with a mandatory live probe: 8+ clicks against 2 before (#5).
2. **Changing a main-agent tier model** is only possible inside the wizard. It needs a billable re-verify, and there is no inline editor or search (#32, #33, #36, #37).
3. **Unconfigured providers are hidden** in a collapsed "More providers" disclosure. The old tile grid showed all of them at once (#1).
4. **The Claude API key cannot be replaced from its own card** (`canManage` is false for `anthropic`, PS:165), only through "Connect provider" (#6).
5. **The workspace save target is hidden.** The wizard saves to global only (PS:257), and a workspace override is reachable only through a scope-row "override" link (#16).
6. **The main card has 5 stacked scope rows** (group row, model, effort, authentication, provider; PS:114-137). This is dense, and the rows compete with the primary actions.
7. **"Use for main agent" is hidden** for a checkable provider in the Not checked state until "Check connection" passes (#3).
8. **Delegated CLI models and efforts** need 3 clicks (Edit, choose, Save) instead of 1 select. They are a flat list of 9 fields on the Providers tab, away from each CLI's enable toggle on the Orchestration tab (#59–#71).
9. **The "Manage provider, model and credentials in Providers" button is repeated** on every system-CLI row, up to 6 identical buttons (#78).
10. **Setup help text is gone:** the Claude CLI install and login commands (#10), Codex token-expired and auth-file text (#13), Ollama Cloud optional-key explanation (#15), Cursor key help and "Set" badge (#64), and the opencode format hint (#67). Help-URL / "Get a key" links are gone too (#9, #20).
11. **CLI agent test results** no longer show latency or the failure reason (#52). Success and error feedback moved to the bottom of the page (#56).
12. **The model picker is a native `<select>`** with no search and no manual refresh (#34, #39).
13. **License and data portability moved** from the top of Settings to the Advanced tab (#80, #81).

## Click counts (old vs new)

Clicks exclude typing. Choosing from a `<select>` counts as 1.

| Task | Old UI (`7ecdefa45^1`) | New UI (`main`) |
|---|---|---|
| Switch main provider to an already-configured provider | **2**: click the provider tile (AC:9-162), then Save & Test Connection (AC:776-798). Moving from third-party to Claude subscription is 3 (tile, "Claude CLI", Save & Test). | **2**: "Use for main agent" on the card (CARD:210-221), then "Use for main agent" in the review (PS:188). **3** when the card is Not checked for a checkable provider: Check connection first. **≥8** if the provider is not connected yet (wizard). |
| Change the main-agent model (tier mapping of the active third-party provider) | **2**: focus the tier search (PMS:202-212), then click a model. It saves immediately and is visible on the Providers tab without navigation. | **8**, plus a billable probe: Manage (CARD:222-231), Continue, Verify stored key (WIZ:656-663), Continue, pick the tier model, Continue, Save (WIZ:1354-1362), Done (WIZ:1302-1309). |
| Change the main-agent single model (new setting, no old equivalent in Settings) | n/a (chat model selector) | **3**: Edit model (PS:92), choose, Save main agent model (PS:151). |
| Add an API key (third-party provider, for example OpenRouter) | **2**: click the provider tile, type the key, Save & Test Connection. The Anthropic key is also 2 (Claude tile, type, Save). | **8**: Add API key (CARD:234-243), Continue, type, Continue, Verify connection (WIZ:1114-1122), Continue, Continue, Save, Done. **+3** tier picks when the provider has no default tiers. **+1** ("More providers" → "Set up X") when the provider is not in "Your connections". |
