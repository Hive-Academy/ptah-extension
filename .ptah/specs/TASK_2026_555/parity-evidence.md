# TASK_2026_555: parity evidence (Task 37.2)

Every `keep` / `move` / restored row of `parity-inventory.md` and every row of the Advanced / Search & Voice preserve list
(`pattern-map-advanced-search-voice.md` section 4), each mapped to a test that passes in the Batch 37 run. #21 was dropped by user decision.

## How the evidence is built

- **Gate G step.** `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.e2e.spec.ts` runs the test
  `webview > settings > reachability (vscode|electron) > every present/restored capability is reachable`. It performs the real clicks of every
  entry in `REACHABILITY_TABLE` (141 entries: 94 shared + 4 + 43 from track B) inside one `test.step` per entry named `"<id> <capability>"`,
  collects failures as `"<id> (<capability>): <message>"`, and fails the test if any exist. So when that test passes in a host, every entry named
  below passed in that host. The guards `the capability count never drops (D14 rule 2)` and `every baseline id exists in the table and is present or
  restored, never pending or missing (D14 rule 3)` pin the table itself. The step name in the tables is the entry's `id` and `capability` text.
- **Unit / component spec.** Where a spec title or `describe` names the row, it is given by file and title. File paths are relative to
  `libs/frontend/chat/src/lib/settings/` unless a full path is shown. A row marked "Gate G step only" has no spec title that names it; its
  behaviour is covered by the reach entry and by the component's own spec, which this table does not claim to map one-to-one.
- Results of the run are in "Execution" below. Entries are quoted from the table files at this head
  (`settings-reachability.table.ts`, `settings-cli-matrix.entries.ts`, `settings-routing-map.entries.ts`, `settings-advanced.entries.ts`,
  `settings-search-voice.entries.ts`).

## Execution (Batch 37 run, head `68dc462cb` plus the working tree)

| Run | Result | Log |
|---|---|---|
| Gate G, `settings-reachability.e2e.spec.ts`, `--reporter=list --workers=2`, after `nx build ptah-extension-webview` (3.32 MB initial, under the 3.5 MB error budget) | **9 passed** (2 hosts x 4 tests + the count guard), including the new #39 and #79 error-branch steps | `%TEMP%\b37-gateG.log` |
| Full `src/lib/scenarios/settings` folder, `--workers=2` | **88 passed, 2 skipped (fixme), 0 failed** | `%TEMP%\b37-folder.log` |
| Marketplace, thoth, boot scenes, `--workers=2` | first run 40 passed, 2 failed: a one-off Chromium crash (marketplace, not reproducible) and a stale thoth scene (fixed); after the fix the two files pass 30 of 30 with `--repeat-each=3` | `%TEMP%\b37-other-scenes.log` |
| Wide `nx run-many -t test -p <20 projects> -- --maxWorkers=2` | 56 of 58 tasks passed. Failures: chat (1, fixed, see above) and rpc-handlers (1, unrelated, follow-up 2) | `%TEMP%\b37-test.log` |
| Chat unit tests, full | **2631 passed, 2 skipped, 0 failed** (140 suites) | `%TEMP%\b37-chat-test2.log` |

## 1. parity-inventory.md rows (87 rows: 82 old capabilities, #21 dropped, 4 new, #85 dead code)

Verdict is derived from the inventory's "Present on main?" column: yes = kept, yes (moved) = moved, partial = kept with the gap closed,
no = restored, new = new.

| # | Capability | Verdict | Gate G step | Unit / component spec |
|---|---|---|---|---|| #1 | Every provider visible at once in one picker: Claude, registry providers and custom tiles | kept, gap closed | `#1 All providers visible (configured cards + More providers catalog)` (present, settings-reachability.table.ts) | Gate G step only |
| #2 | Per-provider configured/active marker (dot, ring, "Active: X") | kept | `#2 Per-provider configured/active marker` (present, settings-reachability.table.ts) | Gate G step only |
| #3 | Switch main provider (select tile, then Save & Test) | kept | `#3 Switch main provider` (present, settings-reachability.table.ts) | provider-setup-wizard.component.spec.ts: review #3 native Claude auth collects no tiers; main-agent-reassign-popover.component.spec.ts (provider confirm, D6) |
| #4 | Claude: API key vs Claude CLI (subscription) toggle | kept | `#4 Claude API key vs Claude CLI (subscription) as separate connections` (present, settings-reachability.table.ts) | provider-setup-wizard.component.spec.ts: review #4 records the loaded tier snapshot; providers-settings-state.service.spec.ts: review #4 sends only edited tiers |
| #5 | Enter and save an Anthropic API key | kept | `#5 Enter and save an API key (wizard credential step)` (present, settings-reachability.table.ts) | Gate G step only |
| #6 | Masked stored key with "Replace" | kept, gap closed | `#6 Masked stored key with Replace` (present, settings-reachability.table.ts) | Gate G step only |
| #7 | Remove the stored Anthropic API key | restored | `#7 Delete the stored Anthropic API key` (restored, settings-reachability.table.ts) | credentials-tab.component.spec.ts: describe 'Delete key (#7/#8)'; auth-rpc.handlers.delete-stored-key.spec.ts |
| #8 | Remove a stored third-party provider key | restored | `#8 Delete a stored third-party provider key` (restored, settings-reachability.table.ts) | credentials-tab.component.spec.ts: describe 'Delete key (#7/#8)'; auth-rpc.handlers.delete-stored-key.spec.ts |
| #9 | Key help: Anthropic Console link, "Keys start with sk-ant-api", provider help-URL link, key prefix | kept, gap closed | `#9 Key help (prefix hint)` (present, settings-reachability.table.ts) | credentials-tab.component.spec.ts: Ollama Cloud explains its optional key and links to the provider (#15, #9) |
| #10 | Claude CLI Detected / Not found badge, plus install and login commands (`npm install -g @anthropic-ai/claude-code`, `claude login`, "Works with Max, Pro, Team") | kept, gap closed | `#10 Claude CLI detected / install and login state` (present, settings-reachability.table.ts) | credentials-tab.component.spec.ts: Claude CLI shows the login and install commands with Copy, and Check again (#10) |
| #11 | GitHub Copilot sign-in (OAuth), showing the username | kept | `#11 GitHub Copilot sign-in (OAuth)` (present, settings-reachability.table.ts) | Gate G step only |
| #12 | GitHub Copilot sign out / disconnect | restored | `#12 GitHub Copilot sign out / disconnect` (restored, settings-reachability.table.ts) | credentials-tab.component.spec.ts: GitHub Copilot shows the account and signs out after an inline confirm (#12) |
| #13 | Codex: auth-file status (`~/.codex/auth.json`), "Token Expired" badge and alert, "Open Codex Login" / "Re-authenticate in Terminal" | kept, gap closed | `#13 Codex auth-file status / Open login` (present, settings-reachability.table.ts) | credentials-tab.component.spec.ts: OpenAI Codex shows token-expired copy and Open login (#13) |
| #14 | Local provider (Ollama, LM Studio): "no key needed" and default endpoint | kept | `#14 Local provider (no key needed) with editable endpoint` (present, settings-reachability.table.ts) | Gate G step only |
| #15 | Ollama Cloud optional key with explanation (static catalogue and $0 cost without a key; link to ollama.com/settings/keys) | kept, gap closed | `#15 Ollama Cloud optional key` (present, settings-reachability.table.ts) | credentials-tab.component.spec.ts: Ollama Cloud explains its optional key and links to the provider (#15, #9) |
| #16 | Apply to: Global default / This workspace | kept, gap closed | `#16 Apply to: Global / App / Workspace save target` (present, settings-reachability.table.ts) | Gate G step only |
| #17 | Scope badge (Workspace override / Global default / Inherited) | kept | `#17 Scope badge (Workspace/App override, Inherited)` (present, settings-reachability.table.ts) | Gate G step only |
| #18 | Clear the workspace override | kept | `#18 Clear the workspace override` (present, settings-reachability.table.ts) | Gate G step only |
| #19 | Save & Test with saving, testing, success and error states | kept | `#19 Save & Test with verify states` (present, settings-reachability.table.ts) | Gate G step only |
| #20 | 401 / invalid-key tips (console link) | kept, gap closed | `#20 401/invalid-key diagnostics copy` (present, settings-reachability.table.ts) | Gate G step only |
| #21 | "Reload" (window) button after a successful save | **dropped** (user decision) | none (no reach entry by design) | providers-settings.component.spec.ts: has no page title, no 'Refresh settings' and no Reload (#21); the map comes before Connections (absence asserted) |
| #22 | Security copy: "Runs 100% locally" vs "Your own endpoint <host>" | kept | `#22 Security copy (local vs custom endpoint)` (present, settings-reachability.table.ts) | Gate G step only |
| #23 | Add custom provider: name, base URL, lane (OpenAI/Anthropic), key | kept | `#23 Add custom provider (name, base URL, lane, key)` (present, settings-reachability.table.ts) | Gate G step only |
| #24 | Edit custom provider (pencil on its tile) | kept, gap closed | `#24 Edit custom provider` (present, settings-reachability.table.ts) | Gate G step only |
| #25 | Delete custom provider (with "Delete for good" confirmation) | restored | `#25 Delete a custom provider` (restored, settings-reachability.table.ts) | advanced-tab.component.spec.ts: describe 'delete connection (#25)' |
| #26 | Test custom provider (latency) | kept | `#26 Test custom provider (verify)` (present, settings-reachability.table.ts) | Gate G step only |
| #27 | Custom provider: models endpoint | restored | `#27 Custom provider models endpoint` (restored, settings-reachability.table.ts) | Gate G step only |
| #28 | Custom provider: help URL | restored | `#28 Custom provider help URL` (restored, settings-reachability.table.ts) | Gate G step only |
| #29 | Custom provider: tier model mapping (sonnet, opus, haiku) | kept | `#29 Custom provider tier model mapping (Models step)` (present, settings-reachability.table.ts) | Gate G step only |
| #30 | Custom provider: price per 1M tokens (input/output), with the "cost unavailable" hint | restored | `#30 Custom provider pricing (input/output per 1M)` (restored, settings-reachability.table.ts) | Gate G step only |
| #31 | Custom provider: host security note, validation errors, backend error shown verbatim | kept | `#31 Custom provider validation / host security note` (present, settings-reachability.table.ts) | Gate G step only |
| #32 | Model-mapping editor inline on the Providers tab, below auth (third-party provider with a key) | kept, gap closed | `#32 Model-mapping editor (Manage -> drawer Models & Tiers)` (present, settings-reachability.table.ts) | Gate G step only |
| #33 | Per-tier change saved immediately on selection | kept, gap closed | `#33 Per-tier change saved (drawer Models & Tiers, save on selection)` (present, settings-reachability.table.ts) | Gate G step only |
| #34 | Searchable model autocomplete (filter by name or id, 50 results, "Search N modelsÃ¢â‚¬Â¦") | restored | `#34 Searchable model autocomplete for tier mapping` (restored, settings-reachability.table.ts) | models-tiers-tab.component.spec.ts: renders one searchable picker per tier (#34, #35, #38); provider-model-picker.component.spec.ts (filter, cap, pinned) |
| #35 | Enter a custom model ID per tier | kept | `#35 Custom model ID per tier ("Not listed? Enter a model ID")` (present, settings-reachability.table.ts) | main-agent-reassign-popover.component.spec.ts: 'Enter a model ID...' swaps in a field on the same row (#35) |
| #36 | Clear a tier back to the default | kept, gap closed | `#36 Clear a tier to provider default (drawer Default)` (present, settings-reachability.table.ts) | Gate G step only |
| #37 | Current mapping badge / "Using default Anthropic X" per tier | kept, gap closed | `#37 Current mapping / resolved model shown` (present, settings-reachability.table.ts) | Gate G step only |
| #38 | Tool-use compatibility: "No tool use" badge, per-model wrench/warning icon, "N models Ã¢â‚¬Â¢ M support tool use" | restored | `#38 Tool-use compatibility indicators` (restored, settings-reachability.table.ts) | provider-model-picker.component.spec.ts: describe 'tool-use indicators (#38)' |
| #39 | Refresh the model list (hidden for static lists) | kept, gap closed | `#39 Refresh the model list (Retry on error)` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #40 | (new) Main-agent model, with a save scope | new | `RM-1 Routing map: Main Agent "Reassign" opens the Main Agent popover (provider, model, effort)` (restored, settings-routing-map.entries.ts) | main-agent-reassign-popover.component.spec.ts (model write with read-back); providers-commit.service.spec.ts D15 outcomes |
| #41 | (new) Main-agent reasoning effort, with a save scope | new | `RM-1` (same entry) | main-agent-reassign-popover.component.spec.ts; agent-behaviour-section.component.spec.ts: describe `Chat reasoning effort (A26, read-back)` (same setting, G9) |
| #42 | List Ptah CLI agents with name and provider badge | kept | `#42 List Ptah CLI agents with name and provider badge` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #43 | Agent status (Ready / Error / Init / No Key) and colour-coded icon | restored | `#43 Ptah CLI agent status (Ready/Error/Init/No Key)` (restored, settings-cli-matrix.entries.ts) | cli-orchestration-matrix.component.spec.ts: shows only detection states for system CLIs (D11) and the instance status with its last latency (#43); cli-matrix-rows.spec.ts |
| #44 | Key status ("Key set" / "No API key" / "Cloud (signin)") | restored | `#44 Ptah CLI agent key status (Key set/No key/Cloud signin)` (restored, settings-cli-matrix.entries.ts) | cli-matrix-rows.spec.ts: derives the key status from hasStoredKey and hasApiKey (#44) |
| #45 | Model count | kept | `#45 Model count` (present, settings-cli-matrix.entries.ts) | cli-model-effort-popover.component.spec.ts: #45 shows the instance model count |
| #46 | Add agent: name, provider, key | kept | `#46 Add agent: name, provider, key` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #47 | Inline "Login with GitHub" in the Add form for Copilot (status, retry) | restored | `#47 Inline GitHub login when adding a Copilot-backed CLI agent` (restored, settings-cli-matrix.entries.ts) | add-cli-instance-modal.component.spec.ts: holds GitHub Copilot until its inline sign-in reports signed-in (#47) |
| #48 | Keyless and optional-key hints (Claude subscription, Ollama, `ollama signin`) | kept, gap closed | `#48 Keyless / optional-key hints` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #49 | Show/hide API key (eye toggle) in add and edit | restored | `#49 Show/hide API key in CLI agent add/edit forms` (restored, settings-cli-matrix.entries.ts) | credentials-tab / add-cli-instance-modal / cursor-credential-popover specs: show/hide toggles the key field between password and text (#49) |
| #50 | Edit name / replace key inline (Enter saves, Esc cancels) | kept | `#50 Edit name / replace key inline` (present, settings-cli-matrix.entries.ts) | add-cli-instance-modal.component.spec.ts: describe 'edit (#50)'; settings-orchestration.e2e.spec.ts: edit modal (#50) |
| #51 | Enable/disable agent toggle | kept | `#51 Enable/disable agent toggle` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #52 | Test connection with latency ("Connected (N ms)") or the error text | kept, gap closed | `#52 Test connection` (present, settings-cli-matrix.entries.ts) | cli-orchestration-matrix.component.spec.ts: describe 'Test (#52, RUX-11)'; cli-matrix-rows.spec.ts: carries the last test result (#52) |
| #53 | CLI-agent tier mapping modal (Layers button; `scope: 'cliAgent'`) | restored | `#53 CLI-agent tier mapping (cliAgent scope)` (restored, settings-cli-matrix.entries.ts) | cli-tier-mapping-modal.component.spec.ts; providers-commit.service.spec.ts (cliInstanceTiersOperation full-object write) |
| #54 | Tier-mapping badges on each agent card | restored | `#54 Tier-mapping badges on CLI agent cards` (restored, settings-cli-matrix.entries.ts) | cli-matrix-rows.spec.ts: shows tier badges in Sonnet, Opus, Haiku order (#54) |
| #55 | Delete with a confirmation dialog | kept | `#55 Delete with confirmation` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #56 | Success and error messages next to the list | kept, gap closed | `#56 Success/error commit feedback` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #57 | Empty state with an "Add" link | kept | `#57 Empty state with Add link` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #58 | Tribunal "Configure" deep link opens Add CLI agent with the provider preselected | kept, gap closed | `#58 Deep link opens setup for a preselected provider` (present, settings-reachability.table.ts) | Gate G step only |
| #59 | Codex model | kept | `#59 Codex model (delegated)` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #60 | Codex reasoning effort | kept | `#60 Codex reasoning effort (delegated)` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #61 | Copilot model | kept | `#61 Copilot model (delegated)` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #62 | Copilot reasoning effort | kept | `#62 Copilot reasoning effort (delegated)` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #63 | Copilot auto-approve toggle | kept | `#63 Copilot auto-approve toggle` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #64 | Cursor API key: input, Save, "Set" badge, help ("cursor.com Ã¢â€ â€™ Dashboard Ã¢â€ â€™ Integrations", stored in `~/.ptah/settings.json`, `CURSOR_API_KEY`) | kept, gap closed | `#64 Cursor API key input + Save` (present, settings-cli-matrix.entries.ts) | cursor-credential-popover.component.spec.ts: is a titled dialog with the help copy and the stored-key status from cursorApiKeyStored (#64) |
| #65 | Cursor model (disabled until a key is set) | kept | `#65 Cursor model (delegated)` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #66 | Antigravity model | kept | `#66 Antigravity model (delegated)` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #67 | opencode model, plus the `provider/model` format hint | kept, gap closed | `#67 opencode model (delegated)` (present, settings-cli-matrix.entries.ts) | cli-model-effort-popover.component.spec.ts: shows the provider/model hint for opencode and Pi only (#67) |
| #68 | Pi model | kept | `#68 Pi model (delegated)` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #69 | Pi reasoning effort (offÃ¢â‚¬Â¦max) | kept | `#69 Pi reasoning effort (delegated)` (present, settings-cli-matrix.entries.ts) | Gate G step only |
| #70 | Permission notes per CLI: Codex, Cursor and Antigravity run "full auto"; opencode `--auto`; Pi has no approval gate and no MCP | restored | `#70 Per-CLI permission and safety notes` (restored, settings-cli-matrix.entries.ts) | cli-permission-notes.spec.ts: keeps the pre-#575 wording for Codex, Cursor, Antigravity, opencode and Pi (#70); cli-orchestration-matrix.component.spec.ts: permission note in its ? popover |
| #71 | Settings grouped per CLI and shown only for installed / configured CLIs | restored | `#71 Per-CLI grouping of delegated settings, hidden when not installed` (restored, settings-cli-matrix.entries.ts) | cli-matrix-rows.spec.ts: describe 'order and grouping (#71)' |
| #72 | Re-detect CLIs | kept | `#72 Re-detect CLIs` (present, settings-reachability.table.ts) | agent-orchestration-config.component.spec.ts: describe 'Re-detect (#72)' |
| #73 | Preferred agent order (up/down; Ptah CLI shown as "Custom"; disabled shown dimmed "Off") | kept | `#73 Preferred agent order (up/down)` (present, settings-reachability.table.ts) | agent-orchestration-config.component.spec.ts: describe 'preferred order popover (#73, plan section 3 row 892)' |
| #74 | Max concurrent agents slider (1Ã¢â‚¬â€œ20) | kept | `#74 Max concurrent agents slider` (present, settings-reachability.table.ts) | agent-orchestration-config.component.spec.ts: describe 'max concurrent agents (#74, plan section 3 row 891)' |
| #75 | System CLI rows: Installed vN, Cursor "Configured" / "Needs API key", "Not Found" | kept | `#75 System CLI rows with detection badges` (present, settings-reachability.table.ts) | Gate G step only |
| #76 | Enable/disable toggle per system CLI | kept | `#76 Enable/disable toggle per system CLI` (present, settings-reachability.table.ts) | Gate G step only |
| #77 | "No CLI agents found" install help | kept | `#77 "No CLI agents found" install help` (present, settings-reachability.table.ts) | cli-orchestration-matrix.component.spec.ts: has install copy for every system CLI, Codex and Copilot as before (#77) |
| #78 | Ptah CLI agents managed inside the Orchestration tab | kept, gap closed | `#78 Ptah CLI agents managed inside Orchestration (moved to Providers)` (present, settings-reachability.table.ts) | Gate G step only |
| #79 | Loading and error states | kept | `#79 Loading and error states` (present, settings-reachability.table.ts) | Gate G step only |
| #80 | License status card at the top of Settings | moved | `#80 License status card` (present, settings-reachability.table.ts) | Gate G step only |
| #81 | Data portability: Export / Import settings | moved | `#81 Export / Import settings` (present, settings-reachability.table.ts) | Gate G step only |
| #82 | Back to chat | kept | `#82 Back to chat` (present, settings-reachability.table.ts) | Gate G step only |
| #83 | Deep link to a Settings tab | kept | `#83 Deep link to a Settings tab (also while open)` (present, settings-reachability.table.ts) | Gate G step only |
| #84 | VS Code LM model change triggers a CLI re-detect | kept | `#84 VS Code LM model change triggers a CLI re-detect` (present, settings-reachability.table.ts) | settings.component.spec.ts: #84 a VS Code LM model change re-detects CLIs through the shared state |
| #85 | `LlmProvidersConfigComponent` (`ptah-ai/llm-providers-config.*`) | n/a (dead code, deleted) | none: no user-visible capability | absence only: no import of `LlmProvidersConfigComponent` remains (typecheck of every project passes) |
| #86 | (new) Background model assignments: memory curator, archaeologist, synthesis, judge, replay, judging enhancement | new | `RUX-12 Background role reassigned in place: a popover from its cell (or "Follows main agent ?" chip), saved on selection` (restored, settings-reachability.table.ts), `RM-2` | provider-consumer-assignments.component.spec.ts: describe `3. Reassignment Popover (save on selection, Undo)`; providers-commit.service.spec.ts |
| #87 | (new) Provider search, Check connection, per-field three-layer scope provenance | new | `RUX-6 Main agent card shows scope only as badges for overridden fields (no 5 stacked rows)` (restored), `GV28-2` (check connection latency) | setting-scope-row.component.spec.ts (`inherited values render nothing (RUX-6)`); providers-settings.component.spec.ts: shows one badge per overridden field, naming it |

Counts: 81 numeric ids have a Gate G entry (the 82 old capabilities minus #21); #40, #41, #86 and #87 are new and mapped to the entries named in
their rows; #85 is dead code with no capability to test.

## 2. Plan section 4 rows not numbered in the inventory (RUX-1 to RUX-13 and the 28c / 28d additions)

| Item | Gate G step | Spec evidence |
|---|---|---|
| RUX-1 Key without the 5-step wizard | `RUX-1 Replace a stored key without the 5-step wizard (verify, then save)` | credentials-tab.component.spec.ts (Replace flow, show/hide `(#49)`) |
| RUX-2 Tier edits in place | `RUX-2 Tier model edited in place, saved on selection, with Undo (no wizard, no re-verify)` | models-tiers-tab.component.spec.ts: describe `save on selection with Undo (D2)` |
| RUX-3 Unconfigured providers up front | `RUX-3 Unconfigured providers shown up front (hint strip + catalog modal)...` | provider-catalog-modal.component.spec.ts: `is the prototype palette: a named dialog, search with the catalog count, the unconfigured list, a custom endpoint row` |
| RUX-4 Claude API key manageable from its card | `RUX-4 The Claude API key is manageable from its own card` | provider-connection-card.component.spec.ts: describe `whole-card trigger (RUX-4)`; credentials-tab.component.spec.ts: describe `Claude API (plan :649-652, RUX-4)` |
| RUX-5 Workspace target visible | `RUX-5 Workspace save target offered in a visible Save-to list...` | main-agent-reassign-popover.component.spec.ts: `Save to another scope offers "Save provider to {scope}..." (RUX-5)` |
| RUX-6 No five stacked scope rows | `RUX-6 Main agent card shows scope only as badges for overridden fields...` | setting-scope-row.component.spec.ts: describe `inherited values render nothing (RUX-6)`; providers-settings.component.spec.ts: `shows one badge per overridden field, naming it...(RUX-6)` |
| RUX-7 "Use for main agent" hidden until checked (unchanged by design) | `#3 Switch main provider` | provider-connection-card.state.spec.ts (RUX-7 comment, unchanged) |
| RUX-8 CLI model/effort in 2 clicks | `RUX-8 Delegated CLI model/effort changed in place: 2 clicks...` | cli-orchestration-matrix.component.spec.ts: `saves an effort in two clicks: cell, then value (RUX-8)`; cli-model-effort-popover.component.spec.ts: `saves a pick through saveSettings with Undo, then closes (RUX-8)` |
| RUX-9 No repeated "Manage ... in Providers" | `RUX-9 No repeated "Manage ? in Providers" links on Orchestration...` | agent-orchestration-config.component.spec.ts: `keeps none of the old body: no Copilot toggle, no CLI cards, no "Manage ... in Providers" repeats (RUX-9)` |
| RUX-10 Setup help text | `RUX-10 Setup help text (claude login / install, Codex login, Get a key)` | credentials-tab.component.spec.ts: `(#10)`, `(#13)`, `(#15, #9)`; cursor-credential-popover.component.spec.ts `(#64)`; cli-model-effort-popover.component.spec.ts `(#67)` |
| RUX-11 CLI test with latency / reason | `RUX-11 CLI agent test result shown inline on its row (latency or failure reason)` | cli-orchestration-matrix.component.spec.ts: describe `Test (#52, RUX-11)` |
| RUX-12 Picker with search | `RUX-12 Background role reassigned in place...` (and `#34`) | provider-model-picker.component.spec.ts; provider-model-search-field.component.spec.ts (`libs/frontend/ui/src/lib/native/provider-model-picker/`) |
| RUX-13 License / portability on Advanced | `ADV-1`, `ADV-5` | license-status-card.component.spec.ts; advanced-settings.component.spec.ts |
| Routing map actions (Gate V 28) | `RM-1`, `RM-2`, `RM-3` | routing-map.component.spec.ts: `Reassign emits main-agent...`, `Inspect opens Agent Orchestration at the background models`, `Manage matrix opens Agent Orchestration at the CLI agents` |
| Key hint, check latency, Codex "Used by" (28c / 28d) | `GV28-1`, `GV28-2`, `GV28-3` | overview-tab.component.spec.ts; credentials-tab.component.spec.ts |
| Deep links (#83) | `#83 Deep link to a Settings tab (also while open)` | settings.component.spec.ts: describe `SettingsComponent deep-link`, `R2.7: reacts to a pending tab raised while Settings is already open`, `focuses the CLI matrix table for the cli-agents deep link` |

## 3. Advanced and Search & Voice preserve list (pattern-map section 4)

| Capability (verdict) | Gate G step | Unit / component spec |
|---|---|---|
| Membership badge, status, user identity, plan text (stays) | `ADV-1`, `ADV-3` | license/license-status-card.component.spec.ts: `shows the community card with Community and Active badges and one primary action`, `shows the member card with the Builder badge, profile row and one primary action`, `shows the Needs Attention badge when a member key has a reason` |
| Key-not-active warning + re-enter (stays) | `ADV-2` | same file: `shows the key-not-active alert with verbatim copy and opens the popover from it` |
| Log out (confirm) (stays, inline confirm) | `ADV-3` | same file: `opens the log-out confirm with Cancel focused; Esc closes it...`, `calls license:clearKey on confirmed log out and closes the confirm on success` |
| Enter membership key + format check + server verify (moves to popover) | `ADV-4` | same file: `rejects a malformed key locally without an RPC call`, `verifies a well-formed key via license:setKey and shows the success line only from the result` |
| Create Account / Manage / Explore Builders (one primary) | `ADV-1`, `ADV-3` | same file: the community and member card cases above |
| Export / Import settings (moves into Membership and data) | `ADV-5`, `#81` | advanced-settings.component.spec.ts: `keeps the Export settings aria-label and calls ptah.exportSettings in VS Code`, `keeps the Import settings aria-label and confirms before calling ptah.importSettings in VS Code`, `does not call the import RPC when the confirm is cancelled` |
| Enhanced system prompt on/off and Ptah Enhanced / Default status (stays) | `ADV-6` | pro-features/agent-behaviour-section.component.spec.ts: describe `System prompt mode (A10/A11)` |
| Preset "Default for new sessions" radios (PR-1 removal) | none (removed) | same file: `PR-1 and PR-2: neither the preset radios nor the paid-plan sentence render` |
| Generated-at, detected stack, view, regenerate, download, empty state (moves to drawer D-SP) | `ADV-7`, `ADV-8` | pro-features/system-prompt-drawer.component.spec.ts: `loads status and renders generated-at timestamp and detected stack`, describe `empty state (A18)`, describe `regenerate flow (A15, S-confirm)`, describe `download flow (A16, D15 fix, F2)` |
| Output style: pick, clear, new, edit, delete, invalid files, banners, copy to project (stays / drawer D-OS) | `ADV-12` to `ADV-18` | output-style/output-style-list.component.spec.ts (describe `delete confirm (P8, Batch 49b)`, `puts the radio back on the saved style when the parity confirm is cancelled`); output-style-editor.component.spec.ts (`switches between Edit and Preview tabs (Gap G6)`, `saves once both required fields carry text`, `seeds every field and carries the E8 guard stamp into the save`); output-style.store.spec.ts (describe `activate()`, `save()`) |
| Output style CLI parity, collapsed (stays) | `ADV-19` | output-style-list.component.spec.ts: `starts unticked and emits no parity field at all (default OFF)`, `asks for confirmation before emitting when parity is ticked (S-confirm, A24)`; output-style.store.spec.ts: describe `activate() with CLI parity` |
| Reasoning effort, 6 choices (stays, popover cell) | `ADV-9` | agent-behaviour-section.component.spec.ts: describe `Chat reasoning effort (A26, read-back)`, `D15: a write that setEffort rolled back is never toasted as saved` |
| Dynamic workflows on/off (stays) | `ADV-10` | same file: describe `Dynamic workflows (A27)` |
| "Workflows require a paid plan." (PR-2 removal) | none (removed) | same file: `PR-1 and PR-2...` |
| Ultracode on/off + restore previous effort (stays) | `ADV-11` | same file: describe `Ultracode (A29)` |
| MCP port with validation and restart note (stays) | `ADV-20` | pro-features/mcp-port-config.component.spec.ts: describe `MCP Port Policy Bar (A30, R4)` |
| MCP namespace toggles, 5 (stays) | `ADV-21` | same file: describe `MCP Tool Namespaces Matrix (A31)` |
| Browser "Allow localhost" (moves into MCP & browser) | `ADV-22` | same file: describe `Allow Localhost (A32, R3)`, `reverts allow localhost and displays fixed error on failure without leaking host text` |
| VS Code LM model, Default / Configured badges, capabilities, set default (stays) | `ADV-23`, `ADV-24` | pro-features/vscode-lm-config.component.spec.ts: `renders provider header, badges, and capabilities with outline style (A33, A35)`, describe `Set as Default (A36)`, describe `Model Selection & D15 Fix (A34, A37)` |
| CLI re-detect after LM model change (stays) | `#84` | settings.component.spec.ts: `#84: a VS Code LM model change re-detects CLIs through the shared state` |
| Web search: multi-provider, per-provider key, status badges, signup links, test-all, max results (stays) | `SV-1` to `SV-6` | ptah-ai/web-search-config.component.spec.ts: `loads config and every key status, and keeps the harness selectors`, `keeps the free-tier copy and signup links (V3)`, describe `provider selection (V1)`, `refuses to deselect the last provider...`, describe `API key popover (V4, G11)` |
| Voice: STT and TTS provider selection, unavailable with reason (stays) | `SV-8`, `SV-9`, `SV-10` | ptah-ai/voice-config.component.spec.ts: `keeps an unavailable provider disabled with its reason as visible text (V10)`, `saves a provider on selection, re-reads config, and Undo writes the previous provider (V10/V11)` |
| Local STT: source, Whisper model, custom id validation, download (stays) | `SV-11`, `SV-12`, `SV-13` | ptah-ai/local-stt-panel.component.spec.ts: `persists a curated model change and toasts it with Undo, with no Saved chip (V14/V20)`, `shows the custom input for the HF source and validates repo id shape (V13/V15)`, `downloads keyed by the curated model name and maps progress (V16)` |
| Local TTS: source, Kokoro voice, custom, preview, download (stays) | `SV-14` | ptah-ai/local-tts-panel.component.spec.ts: `persists a voice change voice-only and toasts it with Undo, with no Saved chip (V17/V20)`, `shows the custom input for the HF source and validates repo id shape (V13/V15)` |
| ElevenLabs: key set / clear, test, voice list with retry, models, format (stays) | `SV-15`, `SV-16`, `SV-17` | ptah-ai/elevenlabs-panel.component.spec.ts: `keeps Save disabled until the draft key passes the probe, then saves exactly that key`, describe `clear key (V21, S-confirm)`, describe `voices (V23)`, `saves a voice on selection with Undo writing the previous voice` |
| "Saved" chips replaced by the toast (replacement) | `SV-10`, `SV-11`, `SV-14` | the two `no Saved chip (V14/V20)` / `(V17/V20)` titles above; settings-save-feedback.service.spec.ts (`saveGeneric` result, Batch 51.4) |
| go vet consent: readout, confirm naming the root, disable, stale reasons, Electron only (stays) | `SV-7`, `SV-18`, `SV-19` | ptah-ai/go-vet-consent-config.component.spec.ts: `renders the root, state and Go binary from GET`, `shows a stale consent with its reason and never as on`, `enables only after an explicit confirm that names the displayed root, and sends that root`; search-voice-settings.component.spec.ts: `mounts web search in VS Code (voice and go vet hidden)`, `mounts web search, voice and go vet in Electron` |
| Deep-link tab ids `pro-features` and `tools` stay | `#83` (Gate G); KEPT_SELECTORS guard | settings.component.spec.ts: describe `SettingsComponent deep-link` |
| Harness / e2e selector safe-list (updated in the same batch) | test `kept selectors survive (settings-tour.scene.ts, workspace-settings.shot.ts)` in both hosts | `apps/ptah-electron-e2e/src/specs/settings/settings.spec.ts` (updated in Batch 37, see below) |

## 4. Dropped and removed by decision

- **#21 "Reload window" after a save**: dropped by user decision; absence asserted in `providers/providers-settings.component.spec.ts`
  (`has no page title, no "Refresh settings" and no Reload (#21); the map comes before Connections`). No reach entry by design.
- **PR-1 / PR-2** (preset radios, paid-plan sentence): removed with approval; absence asserted (section 3).
- **Reach entries for the #39 and #79 read-error branches** (Task 37.3): added in Batch 37, see below.

## 5. Follow-ups

### 5.1 Spec type-check gap (Task 37.4)

`npx tsc --noEmit -p libs/frontend/<lib>/tsconfig.spec.json` (logs `%TEMP%\b37-tsc-*.log`, `b37-tsc3-chat.log`):

| Lib | Errors before | Errors after | In files this task touched |
|---|---|---|---|
| chat | 262 | 215 | 0 after (59 in touched files fixed: 33 pre-existing brand errors in `message-sender.service.spec.ts`, the rest in specs this task created or edited) |
| core | 104 | 97 | 0 after (7 fixed in `providers-commit.service.spec.ts` and `providers-connection-setup.service.spec.ts`) |
| ui | 7 | 2 | 0 after (5 pre-existing `defaultTiers` errors fixed in `provider-model-picker.component.spec.ts`). The 2 left are in `libs/shared/src/lib/types/capability-id-codec.ts` (BigInt literal vs target), not touched by this task |

"Touched" = a file in `git diff --name-only $(git merge-base HEAD main)..HEAD` (198 `.ts` files). Every error left is in an untouched file
(e.g. `compaction-lifecycle.service.spec.ts` 66, `electron-layout.service.spec.ts` 63, `session-loader.service.spec.ts` 24, `chat-view.component.spec.ts` 17).

**Follow-up task proposal (owner: devops-engineer).** Add a `typecheck-spec` target (or include `tsconfig.spec.json` in `typecheck`) for
`@ptah-extension/chat`, `core`, `ui` and the other frontend libs, and fix or baseline the 215 + 97 + 2 pre-existing errors first, so the gate can be
turned on. Today `typecheck` uses `tsconfig.lib.json` and the Jest transform does not type-check, so fixture drift passes every gate (the
Batch 12 `ProvidersConnection` fields, `accountLabel` / `tokenStale`, only surfaced here).

### 5.2 Other items found in Batch 37

1. **Secret writes and two logins end running chats** (`write-path-trace.md` section 5). Needs a decision on the confirm copy and the plan's trace.
2. **`harness-skill-selection-rpc.service.spec.ts` fails in this environment** (`@ptah-extension/rpc-handlers`:
   `never writes state.json` finds a `state.json` that already exists at its precondition, `:113`). No file in `libs/backend/rpc-handlers/src/lib/harness`
   differs from `main`, and it fails in isolation, so it is not caused by this task. Cause not found; owner: whoever owns harness sync.
3. **Thoth scene `skills-lane-pickers.e2e.spec.ts` was stale** after the Batch 35 one-popover-at-a-time roles popovers (the synthesis popover's backdrop
   blocked the judge click). Fixed in Batch 37 (close the synthesis popover first); the scene passes 3 of 3 repeats.
4. **One-off Chromium crash** (`worker process exited unexpectedly (code=3221226505)`) in `marketplace/capability-toggles.e2e.spec.ts:320` and one
   showcase overlay-install race (`page.evaluate: Execution context was destroyed`, first tour attempt on the pristine profile copy). Neither reproduced
   (marketplace 30 of 30 with `--repeat-each=3`; tour passed on the second profile copy).
5. `capability-toggles.e2e.spec.ts:193` still says the auto-responder has no error envelope; `rpcError` (Batch 49) exists now. Comment only.
6. Docs prose: `browser-automation/launching-a-browser.md` still describes an executable path, headless toggle and user-data dir the app does not have
   (noted in `apps/ptah-docs/SCREENSHOTS.md`).
7. Batch 51 carry-over: the app-wide `.table :where(thead, tfoot)` header recolour also affects dashboard, marketplace and skill-synthesis tables (Batch 38).