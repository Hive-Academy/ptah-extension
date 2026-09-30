# TASK_2026_555 - Pattern map: Advanced and Search & Voice tabs

Status: DRAFT for one user approval (task.md "## Decisions", 2026-09-30: no new prototype, no Gate 1.7 for these two tabs).
Author: ui-ux-designer lane. Document only: no code, no tree changes, no build, no Playwright.

Inputs read: `settings.component.ts/.html`, every component mounted on the two tabs (listed per tab below),
`design-spec.md` (all sections), `prototypes/final/index.html`, `orchestration.html`, `assets/app.css`, `README.md`,
the shipped Providers drawer (`credentials-tab.component.ts`), `SettingsSaveFeedbackService`, `batches.md` (Batches 21-38),
the harness reachability table and `apps/ptah-electron-e2e` settings specs.

**Correction to the brief:** `investigation/tabs-advanced-search-voice-audit.md` never existed (checked in the worktree and in the main checkout; the folder holds only
`forensics-523-vs-shipped`, `lane-agy-pattern-research`, `lane-glm-providers-ux-audit`, `orchestration-ux-audit`,
`synthesis`). This map is therefore built from the code itself; every control below cites `file:line` from the
current worktree.

---

## 1. Intro and rules

The rule is one sentence: **these tabs reuse the approved patterns of `prototypes/final/` and `design-spec.md`; nothing
here introduces a new visual language, token, colour, or component look.** Where a control has no matching approved pattern,
it is listed under `## Gaps` with the closest existing pattern and is marked `needs user OK`; it is not built until the
user says yes.

Tags used on every rule (as required):

- **[UR]** user-requested: stated by the user in task.md "## Decisions", the brief, or a rejected/approved deviation.
- **[PR]** project-rule: already a rule of this repo or of the approved design-spec/BRIEF (D15, `base-content` text, `table-xs`,
  Native primitives, existing `data-testid`s).
- **[LP]** lane-proposed: my addition. All are collected in `## Lane-introduced constraints`.

Approved pattern vocabulary used in the tables (each resolves to a prototype element and a design-spec section):

| Code | Pattern | Prototype element / class | Spec |
|---|---|---|---|
| P1 | Shell: header, workspace/app line, tab bar | `index.html:82-115`, `.tabs.tabs-bordered` | §1.1 item 1; shell already shipped in `settings.component.html:19-98` |
| P2 | Section card: heading + optional single primary action + body | `orchestration.html:153-156` (`card bg-base-200 border border-base-300 p-3`, `h2 text-xs font-bold uppercase tracking-wider text-base-content`); shipped equivalent `ptah-native-card density="compact" tone="neutral"` | §3.1, §3.5 |
| P3 | Policy bar: one dense row with label, slider and badge readout, actions right | `orchestration.html:107-113` (`routing-flow-card py-2 px-3`, `range range-xs range-primary`, readout badge) | §1.2 item 2 |
| P4 | Matrix table: `table table-xs`, interactive cell = button + chevron, status/permission badges | `.matrix-table`, `.matrix-cell-interactive`, `orchestration.html:187` (`checkbox checkbox-xs checkbox-primary` "On" column) | §3.5 |
| P5 | Popover for a short choice: save on selection, toast + Undo | `#popoverMainAgent` (`index.html:829-880`, effort buttons `popover-effort-btn`), `NativePopoverComponent hasBackdrop=true` | §3.2, §4.1, §4.2 |
| P6 | Side drawer for details (right, 460 px); tabs via `NativeTabGroupComponent`; per-tab footer action, no blanket Save | `#drawerConnDetails` (`index.html:426-520`), `.drawer-tab` | §3.4, §6 #3 |
| P7 | Centered modal (`NativeModalComponent`) for create/choose flows | `#modalPalette`, `#modalAddPtahCli`, `#modalTierMapping` | §2.5, §3.6 |
| P8 | Inline destructive confirm (no Undo) | shipped `credentials-tab.component.ts:234-249` (`role="group"`, `rounded border border-base-300 p-3`, `btn btn-outline btn-sm border-error text-base-content`) | §4.1 last row |
| P9 | Collapsed-by-default `<details>` section | `orchestration.html:482` (`details#rolesDetails.card`) | §6 #4 |
| P10 | Status badge: `badge badge-outline badge-sm`, colour on dot/icon only, text `text-base-content` | `orchestration.html:197` etc.; spec §3.5 | §6 #6 |
| P11 | Toast with Undo, `role="status"` | `#toastContainer`, shipped `SettingsToastComponent` | §4.2, §4.4 |
| P12 | Credential entry in a popover (single field, show/hide, help link) | Cursor Credentials popover | §2.2 row "System-CLI Credentials action" |

Design-spec deviations in force on these tabs: **#3** per-tab actions, no blanket Save [UR]; **#4** heavy detail collapsed by
default [UR]; **#5** chevron buttons, no grip/drag, only if any ordering appears (none does here) [UR]; **#6** colour only
on icons/dots/badges, text stays `text-base-content` [UR]. **#1/#2 rejected** [UR]: any create/choose overlay is the centred
`NativeModalComponent`, never a side drawer stand-in.

Save-model shorthand used in tables (all from task.md "## Decisions" 2026-09-29 [UR]):

- **S-sel** = save on selection + toast + Undo (Undo is a real write of the previous value).
- **S-confirm** = explicit confirm first, no Undo.
- **S-verify** = verify-then-save (a passing probe before the value is persisted).
- **S-explicit** = explicit per-control Save inside its popover/drawer (text/number entry; deviation #3), toast on success, Undo only if the previous value is restorable.
- **D15** [UR/PR] = "Saved" is shown only after the write's own result says so; a failed write reverts the control and shows an alert toast.

---

## 2. Advanced tab

Container today: `settings.component.html:156-212` mounts, in order: License card, an inline Data Portability card, then
`ptah-enhanced-prompts-config`, `ptah-output-style-config`, `ptah-workflows-config`, `ptah-mcp-port-config` (which itself mounts
`ptah-browser-settings`), `ptah-vscode-lm-config`. That is **11 stacked bordered cards** with no hierarchy and 10+ inline
"success" strings; target is 5 section cards.

Legend for the notes column: "Undo = X" states the exact previous-value write.

### 2.1 Control-by-control table

Paths are relative to `libs/frontend/chat/src/lib/settings/` unless prefixed.

| # | Current control (file:line) | Writes (key / RPC) | Becomes (approved pattern, spec §) | Save model | Notes |
|---|---|---|---|---|---|
| A1 | Membership status badge Builder/Community + Active/Needs Attention (`license/license-status-card.component.ts:52-66`) | read only (`chatStore.licenseStatus()`) | P2 card "Membership & data", P10 badge; the coloured "Active" text (`:62`, `text-success`) becomes dot + `text-base-content` (§6 #6) | n/a | `text-success`/`text-warning` text at `:62-65`, `:81` must go to dot/icon colour [UR #6] |
| A2 | "Membership Key Not Active" warning + "Re-enter Membership Key" (`:69-98`) | opens key form | P2 inline alert (`index.html:472` alert shape, text `base-content`), action opens A5 | n/a | keep copy verbatim ("Ptah's local features remain available either way") |
| A3 | User profile row: initials, name, email (`:100-121`) | read only | P2 body row | n/a | |
| A4 | Log Out (`:122-129`, `removeLicenseKey :388-401`) | `license:clearKey` | P8 inline confirm (replaces `ConfirmationDialogService` modal) | S-confirm | today a modal confirm (`:389-396`); the shipped Providers pattern is inline. Risk: `ConfirmationDialogService` is a shared chat-state service used elsewhere; keeping it is acceptable, see Gap G12 |
| A5 | Enter Membership Key form: password input, Activate (`:178-234`, `submitLicenseKey :349-386`) | `license:setKey` (format check `:352`) | P12 popover (single credential field) opened from "Enter Membership Key"; error/success inline in popover | S-verify (the RPC verifies; UI already shows it only after `result.data.success`, `:368`) | "Reloading..." success copy (`:370`) is kept: the app reloads. D15 already satisfied |
| A6 | Create Account / Enter Membership Key / Explore Ptah Builders / Manage Membership (`:141-175`) | `command:execute ptah.openSignup` / `ptah.openPricing` (`:329-333`, `:407-411`) | P2 header: **one** primary (Create Account for community, Manage Membership for member), others `btn btn-ghost btn-xs` | none (opens browser) | BRIEF hard requirement #4: one primary action per region [PR] |
| A7 | Plan description (`:134-138`) | read only | P2 body text | n/a | |
| A8 | Data Portability Export (`settings.component.html:176-188`, `settings.component.ts:227-241`) | `settings:export` (Electron) / `command:execute ptah.exportSettings` | P2 header action group `btn btn-outline btn-xs` in the same card | none (file dialog) | keep `aria-label="Export settings"`: harness #81 (`settings-reachability.table.ts:778`) |
| A9 | Data Portability Import (`:189-201`, `settings.component.ts:247-261`) | `settings:import` / `command:execute ptah.importSettings` | same as A8 | S-confirm recommended (import overwrites settings) [LP] | today no confirm and no result feedback; RPC result is ignored (`:232`, `:252`). D15: surface failure. Keep `aria-label="Import settings"` |
| A10 | System Prompt Mode toggle (`pro-features/enhanced-prompts-config.component.ts:47-54`, `toggleEnhancedPrompts :278-289`) | `enhancedPrompts:setEnabled` | P4 row in "Agent behaviour" matrix: "On" checkbox column (G1) | S-sel; Undo = `setEnabled(!enabled)` | disabled until a prompt exists (`:52`), keep and say why in the row text |
| A11 | "Ptah Enhanced / Default" badge + "Active for all sessions" (`:58-75`) | read only | P10 badge in the row's Status cell | n/a | |
| A12 | "Default for new sessions" preset radios Enhanced / Default(Minimal) (`:78-112`, `setSystemPromptPreset :291-293`) | **nothing**: local signal only (`:221`), no reader anywhere in `libs`/`apps` (grep `systemPromptPreset`) | see Proposed Removals PR-1 | n/a | dead control shown as if it saved |
| A13 | Load-error text (`:115-119`) | n/a | P2 inline alert, text `base-content` | n/a | today `text-error` text |
| A14 | Generated-at, detected stack (`:122-143`) | read only | drawer D-SP body (P6) | n/a | |
| A15 | Regenerate (`:147-163`, `regenerateEnhancedPrompt :295-314`) | `enhancedPrompts:regenerate {force:true}` (120 s timeout) | drawer D-SP footer action (P6, deviation #3) | S-confirm (overwrites the generated prompt) [LP]; progress inline (Gap G5) | failure already shown in `enhancedPromptsError` |
| A16 | Download (`:164-173`, `:335-344`) | `enhancedPrompts:download` | drawer D-SP footer action | none | |
| A17 | View / Hide Generated Prompt (`:176-195`, `:316-333`) | `enhancedPrompts:getPromptContent` | drawer D-SP body: rendered markdown (`ptah-markdown-block`) | n/a | markdown sanitiser chokepoint stays (`:192`) |
| A18 | Empty state "Run the Setup Wizard..." (`:196-202`) | n/a | row Status cell + drawer empty state | n/a | copy kept |
| A19 | Output style: list of styles as radiogroup (`output-style/output-style-list.component.ts:267-408`, select `:279-290`) | `outputStyle:activate` (`output-style.store.ts:179`) | P4 matrix: columns Active (radio) / Name / Tier badge / Description / Actions; radio semantics kept (G7) | S-sel; Undo = `activate(previous)` **only when parity is not ticked** (see A24) | optimistic-with-revert already in store (`:172-186`); shadowed rows stay disabled with reason (`:288`, `:361-373`) |
| A20 | Tier badges Built-in/You/Project/Plugin, Overridden, "Drops default coding instructions" (`:301-320`) | read only | P10 badges, dot/icon colour, text `base-content`; current `badge-primary/secondary/warning` filled badges (`:303-315`) become `badge-outline` | n/a | [UR #6] |
| A21 | "New style" (`:250-258`) | opens editor | P2 header **primary action** `btn btn-primary btn-xs` | n/a | |
| A22 | Edit / Delete icon buttons per row (`:329-357`) | `outputStyle:get` (`store:271`), `outputStyle:delete` (`store:246`) | P4 Actions cell; Edit opens drawer D-OS (P6); Delete opens P8 inline confirm in the row (already an inline confirm: `:376-405`) | Edit: n/a. Delete: S-confirm, no Undo | disabled-with-reason for immutable rows stays (`:333`, `:347`, `actionTitle`) [PR Req 4.2] |
| A23 | Banners: write error, missing-active (Clear the selection), collision, fallback (Copy to this project), invalid files list with "Rewrite it here" (`:152-244`, `:410-456`) | `activate(null)`, `copyToProjectTier`, `openInvalid` | P2 inline alerts using the `index.html:472` alert shape, **text `base-content`**, colour on border/icon | as today | banner copy is R1/R5/E4/N1-load-bearing (`:9-47`): move verbatim, do not reword |
| A24 | Parity checkbox "Also apply this style when I run `claude`" + "Where to write it" select + written-path note + parity warning (`:459-549`) | `outputStyle:activate {parity}` writes `.claude/settings*.json` | P9 collapsed `<details>` inside the Output style card: "Command-line parity" (deviation #4) | S-confirm (file write outside Ptah) with the exact display path before write (R6/E2 already) | **No Undo** when parity was ticked: Undo of the style choice would not undo the file. Default remains OFF |
| A25 | Editor sub-view: Name, Description, Where to save (Just me / This project), Keep default coding instructions toggle, Instructions textarea + Preview toggle, Save style / Cancel (`output-style-editor.component.ts:94-381`; the repair banner `:94-112` and the form-error banner `:114-128` move into drawer D-OS as P2 inline alerts, text `base-content`) | `outputStyle:save` (`store:220`) | P6 drawer "Output style" (create/edit), body = same fields; footer = Save style (primary) + Cancel; replaces in-place list/editor swap (`output-style-config.component.ts:64-94`) | S-explicit (validation + overwrite conflict "Replace it / Keep both", `:130-155`) | textarea/preview needs Gap G6; "Saving does not switch to this style" note (`:378-381`) stays. Editor never activates (Req 3.7) [PR] |
| A26 | Reasoning effort segmented buttons Default/Low/Medium/High/X-High/Max (`pro-features/workflows-config.component.ts:81-94`) | `EffortStateService.setEffort` -> `config:effort-set` (`core/.../effort-state.service.ts:36-60`) | P4 matrix cell in "Agent behaviour": value button + chevron -> P5 popover with the same 6 buttons (`popover-effort-btn`, `index.html:861-864`) | S-sel; Undo = `setEffort(previous)` | **`setEffort` returns void and swallows failure** (`:49-58`): the caller must compare `currentEffort()` to the request after the await, else a failed write would toast "Saved" (D15). Label "Chat reasoning effort" with sub-note "Same value as Providers > Main Agent effort" (Gap G9, RESOLVED) |
| A27 | Dynamic workflows toggle (`:112-128`, `toggleWorkflows :228-251`) | `agent:setConfig {workflowsDisabled}` -> `workspace.setConfiguration('ptah','workflows.disabled')` (`backend/rpc-handlers/.../agent-rpc.handlers.ts:395-401`) | P4 "On" checkbox row (G1) | S-sel; Undo = write inverse | revert-on-failure already there (`:244-249`); replace the inline "Workflow preference updated." (`:137-141`) by the toast |
| A28 | "Workflows require a paid plan." (`:130-135`) | n/a | see Proposed Removals PR-2 | n/a | contradicts the Membership card copy ("local features free") |
| A29 | Ultracode toggle + explanation (`:158-183`, `UltracodeStateService.toggle`, `chat/.../ultracode-state.service.ts:44-62`) | `enable()` -> `setEffort('xhigh')`, `disable()` -> restore previous effort | P4 "On" checkbox row | S-sel; Undo = `toggle(!next)` | same swallowed-failure problem as A26 (`setEffort` void). Ultracode and A26 write the same channel: show a note in A26 row while Ultracode is on ("pinned to X-High by Ultracode") [LP] |
| A30 | MCP Server Port number input + Save (`pro-features/mcp-port-config.component.ts:47-69`, `savePort :228-260`) | `agent:setConfig {mcpPort}` -> `stateStorage 'agentOrchestration.mcpPort'`, clamped 1024-65535 (`agent-rpc.handlers.ts:373-378`) | P3 policy-bar row inside card "MCP & browser": label, number input `input input-xs w-28`, `Save` `btn btn-primary btn-xs`, range hint | S-explicit (needs restart) | toast text must carry "Restart the MCP server for the change to take effect" (today `:79-81`); D15 already satisfied (`:247-254`). Validation copy (`:215-226`) moves inline, text `base-content` |
| A31 | MCP Tool Namespaces toggles: Browser Automation, CLI Agents, Git Worktree, IDE/LSP, JSON Validation with tool counts (`:91-138`, `toggleNamespace :266-292`) | `agent:setConfig {disabledMcpNamespaces}` -> `setAgentCfg` (`agent-rpc.handlers.ts:382-387`) | P4 matrix: On (checkbox) / Namespace / Tools / Description | S-sel; Undo = write previous array | revert-on-failure exists (`:285-289`). Tool counts are hard-coded (`:164-195`); keep, flag drift risk to owner |
| A32 | Browser Settings > Allow Localhost toggle (`pro-features/browser-settings.component.ts:43-50`, `:81-103`) | `agent:setConfig {browserAllowLocalhost}` -> `workspace.setConfiguration('ptah','browser.allowLocalhost')` (`agent-rpc.handlers.ts:388-394`) | P4 row in the same "MCP & browser" card (removes the separate mounted child card) | enabling: S-confirm [LP] ("lets agents reach local network services"); disabling: S-sel + Undo | today one click, no confirm. Broadening agent network reach is the "risky" class of the save model |
| A33 | VS Code LM: provider header, Default badge, Configured badge (`pro-features/vscode-lm-config.component.ts:31-58`) | read only | P2 card "VS Code language model" (only when the provider exists, `:31`), P10 badges | n/a | `badge-primary`/`badge-success` filled badges become outline + dot |
| A34 | VS Code LM model `<select>` (`:67-84`, `onVsCodeModelSelect :166-179`) | `llm:setDefaultModel` via `LlmProviderStateService.setDefaultModel` (returns boolean) | P4 matrix cell -> P5 popover (static list, `ProviderModelPickerComponent` not needed: list is host-supplied, 1 provider) | S-sel; Undo = `setDefaultModel(previous)` | **D15 defect today:** result is ignored and `modelChanged` is emitted even when the save failed (`:174-175`), triggering `redetectClis()` (`settings.component.ts:285`). Emit only on `true`; show `llmState.error()` as an alert toast. "No models" / "Loading models..." states kept |
| A35 | Capabilities badges, "No API key required" note (`:102-118`) | read only | P10 badges + P2 body text | n/a | |
| A36 | Set as Default (`:121-130`, `:181-183`) | `llm:setDefaultProvider` | P2 header action `btn btn-outline btn-xs`, only when not default | S-sel; Undo = `setDefaultProvider(previous)` | result boolean is ignored today; D15 |
| A37 | `onModelChanged()` -> `providersState.redetectClis()` (`settings.component.ts:285-287`, wired at `settings.component.html:211`) | CLI re-detect | unchanged wiring, kept at the tab container | n/a | parity #84 (harness `settings-reachability.table.ts:797`) |

### 2.2 Layout sketch (section-card shape, P2), 1024 x 768

```
Header (P1, unchanged)  Back | Settings | Workspace: x . App: Desktop
Tabs (P1)               Providers | Agent Orchestration | [Advanced] | Search & Voice

+- MEMBERSHIP & DATA ----------------------------------------- [Manage membership]* -+   (P2, one primary*)
| (o) Builder  * Active   J. Doe  a@b.com  [Log out]                                  |
| Plan description ...                                    [Export]  [Import]          |
| (inline alert when key not active) (key form = P12 popover from "Enter key")        |
+-------------------------------------------------------------------------------------+
+- AGENT BEHAVIOUR ---------------------------------------------------------------------+ (P2 + P4 table-xs)
| On | Setting                    | Value / status                     | Details       |
| [x]| System prompt mode         | Ptah Enhanced - active             | [Details >]   |  -> drawer D-SP (P6)
|    | Reasoning effort           | [ medium v ]  (P5 popover)         |               |
| [x]| Dynamic workflows          | On                                 |               |
| [ ]| Ultracode                  | Off  (pins X-High while on)        |               |
+-------------------------------------------------------------------------------------+
+- OUTPUT STYLE ---------------------------------------- 5 available     [+ New style]* -+
| Active | Name        | Tier      | Description                     | Edit  Delete   |
|  (o)   | Concise     | (You)     | Short sentences...              |  P8 confirm    |
|  ( )   | Project doc | (Project) | ...                             |                |
| > Command-line parity (P9 <details>, closed)                                          |
| one-line footer: "Applies from your next session" (kept copy)                        |
+-------------------------------------------------------------------------------------+
+- MCP & BROWSER ------------------------------------------------------------------------+
| policy bar (P3):  MCP port [51820] [Save]   Default 51820 . Range 1024-65535          |
| On | Namespace            | Tools | Description                                       |
| [x]| Browser Automation   | 12    | Navigate, screenshot ...                          |
| ...                                                                                   |
| [ ]| Allow localhost (browser tools)          -> enabling asks P8 confirm             |
+-------------------------------------------------------------------------------------+
+- VS CODE LANGUAGE MODEL (only if present) ---------------------- [Set as default] ----+
| Model: [ gpt-x v ] (P5)   (Default) (Configured)   capabilities badges                |
+-------------------------------------------------------------------------------------+
Overlays: Drawer D-SP "System prompt", Drawer D-OS "Output style" (create/edit), popovers, toast (P11)
```

Drawer D-SP "System prompt" (P6, single body, no tabs): generated-at, detected stack, presets note (see PR-1), rendered prompt
(A17), footer = `Regenerate` (outline) + `Download` (ghost) + `Close`. Drawer D-OS "Output style" (P6): fields A25, footer =
`Save style` primary + `Cancel`.

Fold check [LP]: at 1024 x 768, header + tab bar + Membership card + Agent behaviour card heading and all 4 rows render without
scrolling (budget: 64 + 40 + 120 + 180 = ~404 px of 660 px). Lower cards scroll; each card heading is reachable in document order.
FAIL if the Membership card exceeds ~140 px in the community state (three buttons + key form closed) or any Agent behaviour row wraps.

---

## 3. Search & Voice tab

Container today: `settings.component.html:217-226`: `ptah-web-search-config`; only on Electron (`isElectron`, `:221`):
`ptah-voice-config` (which hosts up to two of `ptah-local-stt-panel`, `ptah-local-tts-panel`, `ptah-elevenlabs-panel`) and
`ptah-go-vet-consent-config`. That is 3 stacked bordered cards (Web search, Voice providers with a `divider` inside, go vet) with the
full voice controls always expanded.

### 3.1 Control-by-control table

Paths relative to `libs/frontend/chat/src/lib/settings/ptah-ai/`.

| # | Current control (file:line) | Writes (key / RPC) | Becomes (approved pattern, spec §) | Save model | Notes |
|---|---|---|---|---|---|
| V1 | Web search provider checkboxes Tavily / Serper / Exa (`web-search-config.component.ts:105-117`, `toggleProvider :377-406`) | `webSearch:setConfig {providers}` (`:539`) | P4 matrix "Web search providers": On checkbox / Provider + description / Key status / Actions | S-sel; Undo = `setConfig {providers: previous}` | keep `data-testid="settings-toggle-web-search-provider-<id>"` and `input[type=checkbox]` (used by `apps/ptah-electron-e2e/src/specs/settings/settings.spec.ts:44-91` and `showcase/settings-tour.scene.ts:246`) [PR]. "At least one provider must stay selected" (`:389-392`) stays as inline note. Revert-on-failure exists (`:402-405`) |
| V2 | Key badge "Key set / No key" (`:120-133`) | read (`webSearch:getApiKeyStatus`, `:360`) | P10 badge in Key column | n/a | `badge-success` filled -> outline + dot |
| V3 | Description + "Get API key" link (`:136-146`) | n/a | P4 provider cell sub-line + link `link link-hover text-base-content` | n/a | free-tier copy kept verbatim (`:41,48,55`) |
| V4 | Set key / Update key, inline password field + Save + Cancel (`:148-207`, `saveApiKey :427-456`) | `webSearch:setApiKey` | P12 popover per provider row | S-explicit; **not** S-verify (Gap G11) | key never rendered [PR]; after save the "Key set" badge and `testResult` reset (`:442-447`); dismissing the popover by any route (Cancel, Esc, backdrop) clears `apiKeyInput` (as `closeKeyEditor` `:414-417` does today) so a typed key never persists in the signal [PR] |
| V5 | Clear key (`:196-205`, `deleteApiKey :461-479`) | `webSearch:deleteApiKey` | P8 inline confirm in the Actions cell; button `btn btn-outline btn-xs border-error text-base-content` (today `btn-ghost text-error` text, `:198`) | S-confirm, no Undo | **no confirm today; failure is silent** (`:469-475`: non-success only skipped, no error shown). D15 + [UR #6] |
| V6 | Test Connection + per-provider result lines (`:214-247`, `testSearch :484-508`) | `webSearch:test` | P4 Status cell per provider ("works" / reason) + one `btn btn-outline btn-xs` "Test connection" in the card header | none (probe) | result lines today `text-success`/`text-error` text (`:236-237`): dot/icon colour, text `base-content` [UR #6] |
| V7 | Max Results slider 1-20 + tick labels (`:250-280`, `onMaxResultsChange :513-522`) | `webSearch:setConfig {maxResults}` | P3 policy-bar row in the Web search card: label, `range range-xs range-primary`, readout badge | S-sel on release (`change` event, already); Undo = previous value | revert-on-failure exists (`:518-521`) |
| V8 | Load / save error text (`:95-97`, `errorMessage`) | n/a | P2 inline alert, text `base-content`; write failures also as alert toast (P11) | n/a | |
| V9 | Voice: description copy (`voice-config.component.ts:55-59`) | n/a | P2 card sub-line | n/a | |
| V10 | Speech-to-Text provider `<select>` (`:90-109`, `changeProvider :284-332`) | `voice:setProviderConfig {sttProvider}` | P4 "Voice engines" matrix row STT: Provider cell -> P5 popover; unavailable options disabled **with the reason as visible text** (today only `title`, `:103`) | S-sel; Undo = `setProviderConfig {sttProvider: previous}` | optimistic-with-revert already exists (`:299-303`, `:315`); config re-read on success (`:313`). Loading / error states (`:61-74`) kept |
| V11 | Text-to-Speech provider `<select>` (`:148-167`) | `voice:setProviderConfig {ttsProvider}` | matrix row TTS, same as V10 | S-sel; Undo | |
| V12 | Voice engines status per direction | derived (`sttDownloaded`, `ttsDownloaded`, `apiKeyConfigured`) | P10 Status cell: Ready / Not downloaded / No key | n/a | new read-only summary, no new data (fields already in `VoiceProviderConfigDto`) |
| V13 | Local STT: source toggle Curated / HF repo id / Local folder (`local-stt-panel.component.ts:74-94`, `onSourceChange :298-304`) | `voice:setConfig {whisperModel, modelSource, customModel}` (`:335`) | drawer D-VOICE tab "Speech-to-text" (P6), segmented buttons as in the P5 effort buttons | S-sel when returning to Curated (already immediate, `:302`); custom sources S-explicit (V15) | |
| V14 | Local STT: Whisper model `<select>` with English-only / Multilingual optgroups (`:115-144`, `onModelChange :306-310`) | `voice:setConfig {whisperModel}` | matrix Model cell -> P5 popover (grouped list, size hints kept: "~80 MB, default") + same control inside D-VOICE | S-sel; Undo = previous model | **D15 defect:** `selectedModel` is set before `persist` and never reverted on failure (`:307-309`, `:344-349`); read back from config or revert |
| V15 | Local STT/TTS custom HF id / folder input + Save + validation hint (`:146-185`; TTS `local-tts-panel.component.ts:101-144`) | `voice:setConfig` / `voice:setTtsConfig` | D-VOICE body (P6), text field + per-control Save (Gap G3) | S-explicit; no Undo | validation regex `HF_REPO_ID_RE` stays (`:41`); hint text `text-error` (`:176`) -> `base-content` + icon |
| V16 | Local STT: Download / Downloaded status / progress bar (`:189-240`, `downloadModel :361-391`) | `voice:downloadModel` (30 min timeout) | D-VOICE body + Status badge in matrix | none (action); progress inline (Gap G5) | progress service `VoiceDownloadProgressService` unchanged |
| V17 | Local TTS: Kokoro voice `<select>` grouped by category (`local-tts-panel.component.ts:173-193`, `onVoiceChange :395-403`) | `voice:setTtsConfig {voice}` | matrix Voice cell -> P5 popover + D-VOICE | S-sel; Undo = previous voice | revert-on-failure already correct (`:401-402`) |
| V18 | Local TTS: Preview voice (`:238-246`, `previewVoice :477-503`) | `voice:synthesize` (60 s) | D-VOICE action `btn btn-ghost btn-xs` | none (action) | keep `data-testid="local-tts-preview-btn"` |
| V19 | Local TTS: Download Kokoro model (`:247-255`, `:447-475`) | `voice:downloadTtsModel` | D-VOICE body | none (action) | sentinel `'tts'` progress key unchanged |
| V20 | "Saved" chips (`local-stt-panel :104-113`, `local-tts-panel :154-162`) | n/a | removed in favour of the toast (P11) | n/a | replacement, not a capability loss |
| V21 | ElevenLabs API key: password input, Save, Clear, "Configured" / "Not configured" (`elevenlabs-panel.component.ts:82-184`, `saveKey :367-396`, `clearKey :398-425`) | `voice:setApiKey {providerId, apiKey}` (`''` = clear) | D-VOICE body: P12 credential block; Clear -> P8 confirm | Save: S-verify [LP] (Gap G13: backend already accepts a draft key in `voice:testConnection`, `:433-436`); Clear: S-confirm, no Undo | shared by both directions; one key block in the drawer serves both tabs. "Configured" text `text-success`/"Not configured" `text-warning` (`:96-109`) -> badge/dot |
| V22 | ElevenLabs Test connection + result with error category (`:151-183`, `testConnection :427-461`) | `voice:testConnection` | D-VOICE body button + Status cell reason ("Authentication: ...", parity #52 shape) | none (probe) | result `text-success`/`text-error` text -> icon colour |
| V23 | ElevenLabs Voice select (locked until key, loading, error+Retry) (`:186-241`, `loadVoices :463-487`) | `voice:setProviderConfig {elevenlabs:{voiceId}}` (`:522`) | matrix Voice cell -> P5 popover; states kept | S-sel; Undo = previous voice | **D15 defect:** local signal set before save, not reverted on failure (`:489-493`, `:513-543`) |
| V24 | ElevenLabs TTS model, Output format selects (`:243-292`) | `voice:setProviderConfig {elevenlabs:{ttsModelId|outputFormat}}` | D-VOICE body selects (P5-style cells in a `table-xs`), Model also in matrix Model cell | S-sel; Undo | same D15 defect (`:495-505`) |
| V25 | ElevenLabs STT model select (`:294-316`) | `voice:setProviderConfig {elevenlabs:{sttModelId}}` | matrix Model cell (STT row) + D-VOICE | S-sel; Undo | same D15 defect (`:507-511`) |
| V26 | go vet consent card: workspace root + Go binary readout (`go-vet-consent-config.component.ts:111-132`) | read (`diagnostics:go-vet-consent-get`, `:384`) | P2 card "Diagnostics: go vet" (Electron only, `visible()` `:314`), P4 two-row detail | n/a | keep `data-testid` set (`go-vet-consent-*`) |
| V27 | go vet toggle + state badge On / Off / Out of date / Confirm to enable (`:134-179`, badge dot already colour-only `:143-156`) | `diagnostics:go-vet-consent-set {enabled, workspaceRoot, confirmToken, source:'settings-ui'}` (`:471`) | P4 "On" checkbox (keep `role="switch"`, `min-w-6 min-h-6` hit area, WCAG 2.5.8) + P10 badge | enable: **S-confirm** (already, `:238-277`); disable: S-sel **without Undo** | already satisfies D15 (`:479-488`, `:497-502` re-read on failure) and #6. Undo of a disable would re-enable without the confirm, so none [LP] |
| V28 | go vet enable confirmation naming the exact root (`:238-277`) | `confirmToken` | P8 inline confirm block (already inline; restyle to the shipped shape, Cancel gets initial focus `:448`) | S-confirm | keep Esc handling (`:244`) and focus return (`:432`) |
| V29 | go vet stale-consent, error, success messages (`:181-236`) | n/a | P2 inline alerts; success moves to toast | n/a | stale text is safety-relevant, keep in the card, not only in a toast |

### 3.2 Layout sketch (section-card shape, P2), 1024 x 768

```
Header + Tabs (P1)            Providers | Agent Orchestration | Advanced | [Search & Voice]

+- WEB SEARCH ---------------------------------------------- [Test connection] ---------+
| On | Provider                                    | Key         | Status | Actions       |
| [x]| Tavily - AI-optimised search, 1,000 free... | (o) Key set | works  | [Update key] [Clear] [Get key] |
| [ ]| Serper - Google Search API ...              | (.) No key  |  -     | [Set key]     |
| [ ]| Exa - semantic search ...                   | (.) No key  |  -     | [Set key]     |
| policy bar (P3):  Max results [====o-----] 5                                          |
| note: at least one provider must stay selected                                        |
+---------------------------------------------------------------------------------------+
+- VOICE ENGINES (Electron; STT + TTS use the local engine or ElevenLabs) --------------+
| Direction | Provider (P5)        | Model / Voice (P5)      | Status            | Details |
| STT       | Local Whisper  v     | base.en  v              | (o) Downloaded    | [>]     |
| TTS       | ElevenLabs     v     | Rachel  v               | (o) Key set       | [>]     |
+---------------------------------------------------------------------------------------+
+- DIAGNOSTICS: go vet (Electron; hidden when host reports unsupported) -----------------+
| Workspace: /path       Go binary: /usr/bin/go                                          |
| [x] Allow go vet in this workspace   (o) On          (enable -> P8 confirm naming root)|
| stale / error alerts inline                                                           |
+---------------------------------------------------------------------------------------+
Overlays: Drawer D-VOICE (tabs: Speech-to-text | Text-to-speech), key popovers (P12), P8 confirms, toast (P11)
```

Drawer D-VOICE (P6, `NativeTabGroupComponent`, tab preselected by the row's Details button). Each tab renders exactly the active
provider's existing panel content, reflowed as `table-xs` rows: Local STT (source, model / custom path, download + progress),
Local TTS (source, voice, custom path, Preview, download + progress), ElevenLabs (key block, test, then per-direction selects).
Panel components keep their logic; only markup, feedback path, and D15 handling change. Footer: `Close` only (each control saves
itself, deviation #3); no blanket Save.

Fold check [LP]: at 1024 x 768, header + tabs + Web search card (3 provider rows + policy bar) + Voice engines matrix heading and
both rows render without scrolling (budget: 64 + 40 + 190 + 90 = ~384 px). FAIL if provider descriptions force a row above ~48 px
(clamp the description to the free-tier sentence; the full text goes in the row `title`/popover).

---

## 4. Preserve list

Every capability on the two tabs today. **stays** = same capability, restyled in place; **moves** = new location named;
**Proposed Removal** = never silent, see section 6.

| Capability | Verdict | Where |
|---|---|---|
| Membership badge, status, user identity, plan text | stays (Advanced > Membership & data) | A1, A3, A7 |
| Key-not-active warning + re-enter | stays | A2 |
| Log out (confirm) | stays; confirm becomes inline (or stays modal, G12) | A4 |
| Enter membership key + format check + server verify | moves to credential popover | A5 |
| Create Account / Manage / Explore Builders | stays (one primary) | A6 |
| Export settings / Import settings | moves from the inline card in `settings.component.html:160-204` into the Membership & data card; logic moves out of `settings.component.ts:227-261` into the Advanced tab component | A8, A9 |
| Enhanced system prompt on/off | stays (row) | A10 |
| Ptah Enhanced / Default status text | stays | A11 |
| Preset "Default for new sessions" radios | **Proposed Removal PR-1** (writes nothing) | A12 |
| Generated-at, detected stack, view prompt, regenerate, download, empty-state guidance | moves to drawer D-SP | A14-A18 |
| Output style: pick active, clear selection, new, edit, delete, invalid-file list + rewrite, collision / fallback / missing-active banners, copy to project | stays (matrix + banners) / edit and new move to drawer D-OS | A19-A25 |
| Output style CLI parity (write `.claude/settings*.json`, tier choice, written-path note, warning) | stays, collapsed (P9) | A24 |
| Reasoning effort (6 choices incl. SDK default) | stays (popover cell) | A26 |
| Dynamic workflows on/off | stays | A27 |
| "Workflows require a paid plan." sentence | **Proposed Removal PR-2** | A28 |
| Ultracode on/off (+ restore previous effort) | stays | A29 |
| MCP port edit with validation and restart note | stays (policy-bar row) | A30 |
| MCP namespace toggles (5) | stays (matrix) | A31 |
| Browser "Allow localhost" | moves into "MCP & browser" card (component folded, `browser-settings` file deleted in the batch) | A32 |
| VS Code LM model, Default / Configured badges, capabilities, set default, no-key note | stays | A33-A36 |
| CLI re-detect after LM model change | stays (tab container) | A37 |
| Web search: multi-provider select, per-provider key set/update/clear, key-status badges, signup links, test-all, max results | stays (matrix + policy bar) | V1-V8 |
| Voice: STT provider and TTS provider selection incl. unavailable-with-reason | stays (matrix popovers) | V10-V12 |
| Local STT: source (curated / HF / folder), Whisper model, custom id/path validation, download + progress + status | stays (matrix cell + drawer) | V13-V16 |
| Local TTS: source, Kokoro voice, custom id/path, preview, download + progress | stays | V15, V17-V19 |
| ElevenLabs: key set/clear, test with error category, voice list with retry, TTS model, output format, STT model | stays (drawer + cells) | V21-V25 |
| "Saved" chips and inline "...updated." strings | replaced by the toast (P11), capability preserved | V20, A27, A30, A32 |
| go vet consent: workspace/binary readout, enable with confirmation naming root, disable, stale reasons, error mapping, Electron-only visibility | stays | V26-V29 |
| Deep-link `PendingSettingsTab` tab ids `pro-features` and `tools` (`settings.component.ts:134-136`, `:208`) | stays; not renamed | tab container |
| Deleted-file safe-list for harness selectors: `ptah-license-status-card`, `aria-label="Export settings"`, `ptah-vscode-lm-config`, `ptah-web-search-config`, `aria-label="Toggle Enhanced System Prompt"`, `settings-toggle-web-search-provider-*`, `local-tts-preview-btn`, `go-vet-consent-*` | stays or is updated **in the same batch** as the rename | harness `settings-reachability.table.ts:776-798`; e2e `settings.spec.ts:7,44-91`; `settings-tour.scene.ts:246` |

---

## 5. Gaps

Controls with no matching approved pattern. Each proposes the closest existing pattern and is `needs user OK`.

| Id | Gap | Closest existing pattern proposed | Status |
|---|---|---|---|
| G1 | **On/off rows.** The prototype has no toggle switch. The only on/off is the CLI matrix "On" column: `checkbox checkbox-xs checkbox-primary` (`orchestration.html:187`). Today's tabs use `toggle toggle-xs toggle-primary`. | Use the matrix "On" checkbox inside a `table-xs` row (also keeps `input[type=checkbox]` for the existing e2e `check()` calls). Keep `role="switch"` on go vet. | needs user OK |
| G2 | **Save feedback is Providers-only.** `SettingsSaveFeedbackService.save()` decides success from `ProvidersSettingsStateService.commit()` (`feedback/settings-save-feedback.service.ts:77-89`) and its message always names a `SettingScope` (`:26-30`). None of these settings go through that state service and none has scope layers (they write `agent:setConfig`, `webSearch:setConfig`, `voice:*`, `outputStyle:*`, `config:effort-set`, `llm:*`, `enhancedPrompts:*`). | Add a second entry to the same service that takes `write: () => Promise<{ok:true}|{ok:false,message}>`, an optional Undo, and a label; toast reads "Saved {label}." (no scope words). Same toast component (P11), same 8 s timer, D3 disable-while-saving. | needs user OK |
| G3 | **Free text / number entry** (MCP port, custom HF id / folder, API keys, membership key). No prototype element outside the drawer's Advanced tab fields (`index.html:666-700`, `input input-xs`). | P12 popover (Cursor credentials popover precedent, spec §2.2) for single fields; drawer body for multi-field. Explicit Save inside, `input input-sm` classes via the existing `FIELD`/`CONTROL` constants (spec §3.4). | needs user OK |
| G5 | **Long-running action with progress** (Whisper / Kokoro download up to 30 min, prompt regenerate up to 120 s). No prototype element. | Keep the existing daisyUI `progress progress-primary` bar in the drawer row + Status badge in the matrix; feedback via the Re-detect-style live toast (`orchestration.html:145-149`). | needs user OK |
| G6 | **Markdown editor / preview surface** (output style body, generated prompt view). No prototype element. | Drawer body (P6) with `NativeTabGroupComponent` tabs "Edit | Preview" replacing the current toggle button; preview stays `ptah-markdown-block` (single DOMPurify chokepoint). | needs user OK |
| G7 | **Single-choice list with radio semantics** (active output style). | Matrix "Active" radio column, `role="radiogroup"` retained (same shape as the "On" column, G1). | needs user OK |
| G9 | **Reasoning effort exists on two tabs. RESOLVED (antigravity review).** It is the same setting: `config:effort-set` writes `reasoningSettings.effort`, read by `config:effort-get`, `AgentSpawnEnvironment` and `ChatSessionService`, and Providers > Main Agent effort is the same value. | Keep **one** Advanced popover cell (A26) labelled "Chat reasoning effort" with the sub-note "Same value as Providers > Main Agent effort" (link style `orchestration.html:525`). No write-path trace needed in Batch 41. | RESOLVED |
| G11 | **Web search key is not verify-then-save.** `webSearch:test` probes stored keys only; there is no draft-key probe (`web-search-config.component.ts:490`). | Keep save-then-test (today's behaviour). Verify-then-save needs a backend method; out of scope unless the user wants it. | needs user OK |
| G12 | **Confirm surface for Log out / Import.** Existing code uses `ConfirmationDialogService` (a centred dialog). The approved pattern for destructive actions is inline (P8), but a centred `NativeModalComponent` confirm is also approved (P7). | Recommend P8 inline in the Membership card; acceptable alternative: keep `ConfirmationDialogService` unchanged. | needs user OK |
| G13 | **ElevenLabs key: verify-then-save.** Backend already supports probing a draft key (`voice:testConnection` with `apiKey`, `elevenlabs-panel.component.ts:433-436`), matching the credential rule in task.md. Today Save does not require a passing test. | Providers Credentials-tab replace flow: Save disabled until the probe passes. | needs user OK |

(Alert banners and test-result lines are **not** gaps: they map to the drawer alert `index.html:472` shape and the CLI matrix Status
column respectively, both with text in `base-content` per deviation #6.)

---

## 6. Proposed Removals

Never silent. Neither is performed without the user's approval.

| Id | Item | Reason | Options |
|---|---|---|---|
| PR-1 | "Default for new sessions" preset radios: Enhanced (Project-specific) / Default (Minimal) (`enhanced-prompts-config.component.ts:78-112`, `systemPromptPreset` `:221`, `:291-293`) | The control writes nothing: it sets a local signal that has no reader anywhere (`grep systemPromptPreset` over `libs` and `apps` finds only this file). It shows a choice the product ignores, which contradicts D15. | (a) remove it (recommended); (b) wire it to a real setting first (needs backend work, out of scope) |
| PR-2 | Sentence "Workflows require a paid plan." (`workflows-config.component.ts:130-135`) | It contradicts the Membership card ("Ptah's local features remain available either way", `license-status-card.component.ts:87-89`), and the read path I checked (`chat-session.service.ts:1364`, `resolveWorkflowsDisabled`) applies only the `workflows.disabled` config with no plan check. Verify with the owner of the workflows slice before removing. | (a) remove the sentence (recommended if no gate exists); (b) keep it |

No other capability is removed. Inline success strings and "Saved" chips are replaced by the toast, which is a replacement, not a removal.

---

## 7. Save-model summary

| Class | Controls | Toast / Undo |
|---|---|---|
| S-sel (short choice, toggle, slider) | A10, A19, A26, A27, A29, A31, A34, A36, V1, V7, V10, V11, V14, V17, V23-V25, V13 (back to Curated) | toast "Saved {label}." + Undo (real write of the previous value); failure -> alert toast, control reverted (D15) |
| S-explicit (text / number) | A30, A25, V4, V15 | toast on success; Undo only when the previous value is restorable (port: yes; key: no) |
| S-verify | A5 (server verifies), V21 [LP, G13] | key never saved on a failed probe |
| S-confirm (destructive / risky) | A4, A9, A15, A22 delete, A24, A32 enable, V5, V21 clear, V27/V28 enable | inline confirm first; no Undo; toast on success |
| No save (action) | A6, A8, A16, V6, V16, V18, V19, V22 | progress or result inline |

---

## 8. Proposed batch split

Numbered from 39 (Batches 37 and 38 already exist in `batches.md` as the Providers/Orchestration close-out). Each batch: one
owner, at most 6 files, at most 2 libs, **Gate G after every batch** (typecheck + lint + tests of the touched projects + review),
**Gate V once, at the end (Batch 50)**. Recommended executor `frontend-developer` for all; lanes allowed per the 2026-09-30 lane
decision (Glm + antigravity). The libs named are `chat`, `webview-e2e-harness`; `apps/ptah-electron-e2e` counts as an app, not a lib.

| Batch | Scope | Files (max 6) | Depends on |
|---|---|---|---|
| 39 | Foundation: generic save entry on `SettingsSaveFeedbackService` (G2) + spec; new tab shells `AdvancedSettingsComponent` and `SearchVoiceSettingsComponent` hosting the existing children unchanged; `settings.component.ts/.html` mounts the shells and Data Portability logic moves into the Advanced shell | `feedback/settings-save-feedback.service.ts`, its `.spec.ts`, `advanced-settings.component.ts`, `search-voice-settings.component.ts`, `settings.component.ts`, `settings.component.html` (6) | 36 |
| 40 | Advanced: Membership & data card (A1-A9), key popover (A5), inline Log out confirm (A4), Import feedback (A9) | `license/license-status-card.component.ts`, new `license-status-card.component.spec.ts`, `advanced-settings.component.ts` (3) | 39 |
| 41 | Advanced: "Agent behaviour" card (A10, A11, A26, A27, A29, PR-1/PR-2 as approved); G9 resolved (one cell "Chat reasoning effort"); deletes `workflows-config` | new `agent-behaviour-section.component.ts` + spec, delete `pro-features/workflows-config.component.ts` + spec, `advanced-settings.component.ts` (5). Atomic deletion like Batch 34 (D14) | 40 |
| 42 | Advanced: System prompt drawer D-SP (A14-A18); deletes `enhanced-prompts-config` | new `system-prompt-drawer.component.ts` + spec, delete `pro-features/enhanced-prompts-config.component.ts`, `agent-behaviour-section.component.ts`, `advanced-settings.component.ts` (5) | 41 |
| 43 | Advanced: Output style (A19-A25): list -> matrix, editor -> drawer D-OS, parity `<details>` | `output-style/output-style-config.component.ts`, `output-style-list.component.ts` + `.spec.ts`, `output-style-editor.component.ts` + `.spec.ts` (5). Store unchanged | 39 |
| 44 | Advanced: "MCP & browser" card (A30-A32) and VS Code LM card with D15 fix (A33-A37); deletes `browser-settings` | `pro-features/mcp-port-config.component.ts`, delete `pro-features/browser-settings.component.ts`, `pro-features/vscode-lm-config.component.ts`, new `mcp-port-config.component.spec.ts`, new `vscode-lm-config.component.spec.ts`, `advanced-settings.component.ts` (6) | 42 (serializes `advanced-settings.component.ts` edits) |
| 45 | Search: Web search matrix (V1-V8) with confirm-on-clear and silent-failure fix; keep testids; update e2e spec selectors only if a testid changes | `ptah-ai/web-search-config.component.ts`, new `web-search-config.component.spec.ts`, `search-voice-settings.component.ts`, `apps/ptah-electron-e2e/src/specs/settings/settings.spec.ts` (4) | 39 |
| 46 | Voice: engines matrix (V9-V12) + drawer D-VOICE shell (tabs, empty panels mounting the existing panels) | `ptah-ai/voice-config.component.ts`, `voice-config.component.spec.ts`, new `ptah-ai/voice-details-drawer.component.ts` + spec, `search-voice-settings.component.ts` (5) | 45 |
| 47 | Voice: local panels reflowed for the drawer + D15 fixes (V13-V20) | `local-stt-panel.component.ts` + spec, `local-tts-panel.component.ts` + spec (4) | 46 |
| 48 | Voice: ElevenLabs panel (V21-V25, verify-then-save per G13 if approved) + go vet card restyle (V26-V29) | `elevenlabs-panel.component.ts` + spec, `go-vet-consent-config.component.ts` + spec (4) | 46 |
| 49 | Harness: reachability + scenes for both tabs (selectors from section 4 safe-list, fixtures for STT/TTS/web-search/output-style/effort failures = D15 assertions); `settings-tour.scene.ts` only if a step breaks | `libs/frontend/webview-e2e-harness/.../settings-reachability.table.ts`, `settings-reachability.e2e.spec.ts`, new scene + fixtures (4-6) | 43, 44, 48 |
| 50 | **Gate V**: visual-reviewer, both tabs x both hosts (Electron and VS Code, where go vet / voice are hidden on VS Code) x both themes vs `prototypes/final/`; fold assertions from sections 2.2 and 3.2; no `text-primary`/`text-error` text; focus visible; Esc/backdrop return focus; axe | `TASK\visual-review.md` (new section) (1) | 49 |

Sequencing note (open question for the user): Batches 37/38 are written as the whole-task close-out for two tabs. Either run 39-50
first and then 37/38 as the single final full run, or run 37/38 now and treat 50 as the delta review. Recommend the former (one
full-run, one write-path trace).

---

## 9. Lane-introduced constraints

Rules in this document that are **[LP]**, i.e. not stated by the user or an existing project/spec rule. All need the same one-time
approval as the rest of the map.

1. **G2** generic save entry on `SettingsSaveFeedbackService` and scope-less toast wording "Saved {label}." (Batch 39).
2. **G1/G7** checkbox-in-`table-xs` for on/off and radio rows instead of `toggle` switches.
3. **G3/G5/G6** popover with a text input for single fields, in-row `progress` bar for downloads, Edit|Preview tabs in the output-style drawer.
4. Confirm-before-act on controls that have none today: Import (A9), Regenerate prompt (A15), Allow localhost enable (A32), web-search Clear key (V5), ElevenLabs Clear key (V21). (The confirm-for-destructive rule is [UR]; applying it to these controls is [LP].)
5. **G13** ElevenLabs Save requires a passing `voice:testConnection` (S-verify).
6. No Undo for: parity-file write (A24), go vet disable (V27), key deletion, log out; Undo elsewhere is the exact previous-value write.
7. Consolidation of 11 cards into 5 (Membership & data, Agent behaviour, Output style, MCP & browser, VS Code LM) and 3 cards into 3 (Web search, Voice engines matrix + drawer, go vet); deletion of the `workflows-config`, `enhanced-prompts-config`, `browser-settings` component files after their content moves.
8. New tab-shell components `AdvancedSettingsComponent` / `SearchVoiceSettingsComponent` mirroring `ProvidersSettingsComponent` / `OrchestrationSettingsComponent`.
9. Fold budgets for the top of each tab (sections 2.2 and 3.2) as pass/fail lines for Gate V.
10. Preserve-by-name safe-list of harness/e2e selectors (section 4), updated in the same batch as any rename.
11. Effort read-back check (A26, A29) because `EffortStateService.setEffort` returns void: a failed write must not be toasted as saved.
12. Proposed Removals PR-1 and PR-2 (section 6).
