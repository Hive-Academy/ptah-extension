# TASK_2026_555 — Design spec: Providers + Agent Orchestration (implementation-facing)

Visual source of truth: `prototypes/final/` (`index.html` = Providers, `orchestration.html` = Agent
Orchestration), user-APPROVED at Gate 1.7. This document translates it into the real Angular webview
system: `libs/frontend/chat/src/lib/settings/**`, `libs/frontend/core` state, `libs/frontend/ui` Native
primitives, and the project's own `anubis` / `anubis-light` daisyUI tokens
(`apps/ptah-extension-webview/tailwind.config.js`). It does not restyle Advanced or Search & Voice.

A lane is fixing, in parallel, the prototype's one known defect: the connection drawer must show
per-connection content (Claude subscription ≠ API-key provider ≠ OAuth ≠ custom gateway). §2.3 and §4
specify the per-connection variance directly so implementation does not wait on that fix.

---

## 1. Information architecture

### 1.1 Providers tab (order top → bottom)

1. Settings shell header (unchanged): Back, "Settings" title, workspace/app line, tab bar (Providers,
   Agent Orchestration, Advanced [disabled], Search & Voice [disabled]).
2. **Routing map** (new section, replaces the current "Main agent" card's scope-row stack): 3 clickable
   work nodes in a `grid-cols-3` row — **Main Agent**, **Background Roles**, **CLI Agents & Matrix**.
3. **Your connections** (existing section, restyled): search filter + "Connect provider" primary button
   + a grid of compact (≤ 80 px) connection cards, one per configured connection, plus an inline
   "+ Connect another provider" tile. A "N catalog providers ready to add" hint strip replaces today's
   always-open `<details>` "More providers" disclosure.
4. Feedback / commit status line (unchanged, `state.commit()`).
5. Overlays, not part of document flow: Connection drawer (right side, 4 tabs), Connect-provider wizard
   (right side, existing `ProviderSetupWizardComponent`), Main Agent / Scope / Background Roles popovers,
   toasts.

`ptah-cli-config` (today mounted inline on Providers, `PS:211`) moves to the Agent Orchestration tab —
parity item #78 already asks for this consolidation, and the CLI Agents node deep-links there.

**Fold budget (user-requested, pass/fail):** at 1024×768, with 5 configured connections, the header,
tab bar, routing map and all 5 connection cards render without scrolling. **PASS** condition: the sum of
header (≈64 px) + routing map card (≈150 px incl. margins) + connections header (≈40 px) + card grid
(2 rows × ~84 px = ≈176 px) ≤ 660 px, leaving ≥ 100 px headroom before 768 px. **FAIL** condition: any
of those elements requires scrolling to reach, or a 6th connection row is needed for 5 connections (grid
must be `sm:grid-cols-2 lg:grid-cols-3`, never single-column, above 640 px viewport width). The
visual-reviewer measures this directly against the running build, screenshot in hand, before sign-off —
this is not satisfied by the prototype's own arithmetic in `prototypes/final/README.md`.

### 1.2 Agent Orchestration tab (order top → bottom)

1. Settings shell header (shared, tab bar shows Agent Orchestration active).
2. **Policy bar** (existing `AgentOrchestrationConfigComponent`, restyled to one row): max-concurrent
   slider + live value, preferred-order chips (reorder via up/down controls — see §6 deviation on drag),
   Re-detect CLIs button.
3. **CLI Agents & Ptah Instances matrix** (new: merges today's system-CLI list in
   `AgentOrchestrationConfigComponent` with `PtahCliConfigComponent`'s flat agent cards into one table):
   On/off, Agent/Instance (+status subline), Status, Provider, Model, Effort, Permissions & Safety,
   Actions. Installed CLIs first, an "Uninstalled" subsection below with install-guide links; Ptah CLI
   instances interleaved by preferred-order rank, visually marked (`Ptah CLI` badge).
4. **Background Model Roles matrix** (existing `ProviderConsumerAssignmentsComponent`, restyled from
   stacked cards into a table, collapsible via `<details>`): Memory curator, Archaeologist, Synthesis,
   Judge, Replay, Judging & enhancement.
5. Overlays: matrix cell popovers (model / effort / role reassignment), permission-info popover, Add
   Ptah CLI instance overlay, CLI tier-mapping overlay, toasts.

**Fold budget (pass/fail), stated for the reference data set (5 installed CLIs/instances + 2
uninstalled, `prototypes/final/BRIEF.md`'s "Realistic data"):** **PASS** condition: header (≈64 px) +
policy bar (≈40 px) + CLI matrix header row (≈32 px) + 5 installed rows (≈32 px/row = ≈160 px) +
uninstalled subsection header (≈24 px) + 2 uninstalled rows (≈64 px) + the collapsed Background Roles
`<summary>` row (≈32 px) ≤ 660 px, leaving ≥ 100 px headroom before 768 px. **FAIL** condition: any of
the header, policy bar, CLI matrix header, or the collapsed roles `<summary>` row requires scrolling to
reach at 1024×768, or the table needs anything less dense than daisyUI's `table-xs` to fit. At other
installed-CLI counts the same per-row arithmetic applies (≈32 px per installed row, ≈32 px per
uninstalled row once collapsed into the "Uninstalled" subsection); a workspace with more than 5 installed
CLIs is expected to scroll to reach the Background Roles matrix, but the CLI matrix's own header and
first row must still land above the fold regardless of count. The Background Roles matrix renders below
the fold collapsed (`<details>` closed by default is a **deviation** from the prototype, which ships it
`open` — see §6 deviation 2); this is required to keep the PASS condition achievable together with the
CLI matrix at `table-xs` density.

---

## 2. Component inventory

Legend: **Reuse** = existing component, template/inputs may change but the class and selector stay;
**New** = a component that does not exist today. File paths are relative to
`libs/frontend/chat/src/lib/settings/` unless noted otherwise.

### 2.1 Providers tab

| Piece | Decision | Component | Key inputs | Key outputs | States |
|---|---|---|---|---|---|
| Routing map container | New | `providers/routing-map.component.ts` (`RoutingMapComponent`) | none (reads `ProvidersSettingsStateService` directly, same pattern as `ProvidersSettingsComponent`) | `nodeActivated: output<'main-agent'\|'background-roles'\|'cli-agents'>` | loading (skeleton row per node while `state.route()`/`state.mainSources()`/`state.cliAgents()` are `loading`), error (per-node retry text, no popover trigger), ready |
| Main Agent node | New | `providers/routing-map-node.component.ts` (`RoutingMapNodeComponent`, generic 3-line node shell) projected content per node | `title`, `statusDot: 'success'\|'info'\|'warning'\|'neutral'`, `scopeBadges: readonly ScopeBadgeVm[]` | `activated: output<void>` | disabled (no click handler) while `saving()` |
| Main Agent reassign popover | New content, reuse primitive **+ extend `ProviderModelPickerComponent`** | `NativePopoverComponent` (existing) hosting a new `providers/main-agent-reassign-popover.component.ts` | `[isOpen]`, `[placement]="'bottom-start'"`, `[hasBackdrop]="true"` (existing popover API) | `(closed)` (existing) | provider `<select>` uses existing connection list; model uses `ProviderModelPickerComponent` **as extended in §2.4** (search + tool-use badges are new work, not present today — see finding-1 fix in §2.4 and #34/#38 in §5); effort as **5** buttons, one per `effortLevels` entry (`['low','medium','high','xhigh','max']`, `providers-settings.component.ts:288`) |
| Background Roles node | New | `RoutingMapNodeComponent` | 3-line preview: 2 named roles + "N follow main agent" | `activated` → navigates to Agent Orchestration tab (`router` or parent-level tab switch, no full popover — matches prototype's "Inspect" → deep link, not an edit surface) | n/a |
| CLI Agents node | New | `RoutingMapNodeComponent` | quota/alert dot, preferred-order preview (first 4, `→`-joined) | `activated` → same tab switch as above | n/a |
| Scope badge + popover | Reuse (template rewrite) | `providers/setting-scope-row.component.ts` (`SettingScopeRowComponent`) — **same selector, same inputs/outputs**, template changed from full-width strip to a small badge that opens a `NativePopoverComponent` | unchanged: `scope`, `hasOverride`, `supportedTargets`, `fallbackPreview`, `workspaceName`, `credentialSource`, `disabled` | unchanged: `overrideRequested`, `clearRequested`, `useGlobalRequested`, `copyGlobalRequested` | inherited (renders nothing, per brief §3), overridden (renders the badge), disabled (badge shown, popover actions disabled with `disabledReason` text) |
| Connection card | Reuse, restyled to ≤ 80 px, **one new output** | `providers/provider-connection-card.component.ts` (`ProviderConnectionCardComponent`) — every existing input/output stays; `[clickable]` becomes `true` (`NativeCardComponent` already supports it, `native-card.component.ts:150-178`) and the card wires `(activated)` to a new `detailsRequested` output | unchanged, **plus** `[clickable]="true"` on the inner `ptah-native-card` | unchanged (`manageRequested`, `activateMainRequested`, …) **plus new** `detailsRequested: output<void>` — the whole card is now a trigger via `NativeCardComponent`'s existing `activated` output, and `ProvidersSettingsComponent` wires `detailsRequested` to open the Connection Drawer. `manageRequested` is unchanged in meaning (its per-state buttons still fire it) but the parent now routes it to the drawer too, replacing the wizard hand-off it had before | all 10 states already defined in `ResolvedConnectionState` (`active`, `connected`, `needs-key`, `unauthenticated`, `unreachable`, `not-installed`, `not-configured`, `checking`, `not-checked`, `check-unavailable`) — unchanged, this card already owns the full state table |
| Connection drawer (Overview & Used By / Credentials / Models & Tiers / Advanced) | **New** | `providers/connection-detail-drawer.component.ts` (`ConnectionDetailDrawerComponent`), built from `NativeDrawerComponent` (side="right") + `NativeTabGroupComponent` for the 4 tabs | `connectionId: input<string>`, `isOpen: input<boolean>`, per-tab data (`usedBy`, `credential`, `tierMappings`, `advanced`) each `input<X \| null>` so a tab renders its own loading/empty state independently | `closed: output<void>`, `deleteKeyRequested`, `disconnectRequested`, `deleteConnectionRequested`, `tierChangeRequested`, `customFieldSaved`, `checkConnectionRequested` (all `output<...>` — **§2.4 names the persistence path each one needs; none is assumed to exist without checking**) | loading (skeleton per tab while its data input is `null` and a sibling "loading" flag is true), error (retry line per tab), not-applicable (a tab hides irrelevant controls per §2.3 rather than showing empty inputs) |
| Connect provider (catalog modal + wizard drawer) | Reuse the wizard drawer, **new** catalog modal in front of it (reverses the earlier draft's single-drawer recommendation — see §6, former deviations 1/2 REJECTED by the user) | **New:** `providers/provider-catalog-modal.component.ts` (`ProviderCatalogModalComponent`), built on the new `NativeModalComponent` (§2.5) — hosts the search input + provider list exactly as `prototypes/final/index.html`'s `modalPalette` (`#paletteSearch`, `#paletteResults`). **Reuse, unchanged:** `providers/provider-setup-wizard.component.ts` (`ProviderSetupWizardComponent`), still a `NativeDrawerComponent`, still starting from its own first step | Catalog modal: `open: input<boolean>`, `connections: input<readonly ProvidersConnection[]>`. Wizard: unchanged (`open`, `deepLinkProviderId`, `verifyDraftConnection`, …) | Catalog modal: `closed: output<void>`, `providerChosen: output<string>` (id) — `ProvidersSettingsComponent` closes the modal and calls its existing `openWizard(id)` on `providerChosen`, exactly as `openWizard('')` already does today for the "Connect provider" button. Wizard: unchanged | Catalog modal: search-filtered list (empty-state text when no match), same states the existing `<details>` catalog block already renders. Wizard: unchanged (catalog step inside the wizard itself is no longer reachable by search — the modal is the search surface now; the wizard opens straight into provider selection because `deepLinkProviderId`/`providerChosen` already picks the provider) |
| "More providers" catalog hint strip | Reuse (template only) | `ProvidersSettingsComponent`'s existing `<details>` catalog block, restyled from an always-visible disclosure into the compact hint strip + `openWizard(id)` on click (behaviour unchanged) | — | — | — |

### 2.2 Agent Orchestration tab

| Piece | Decision | Component | Key inputs | Key outputs | States |
|---|---|---|---|---|---|
| Policy bar | Reuse (template restyle to one row) | `ptah-ai/agent-orchestration-config.component.ts` (`AgentOrchestrationConfigComponent`) | unchanged | unchanged | loading/error (existing `AOC:75-88` handling), ready |
| CLI Agents & Ptah Instances matrix | **New**, composes existing data **+ one planned state-service extension** | `ptah-ai/cli-orchestration-matrix.component.ts` (`CliOrchestrationMatrixComponent`) — reads Ptah-instance rows from `state.cliAgents()` / `state.cliModels()` (same data `PtahCliConfigComponent` reads today). **System-CLI rows are not yet readable from the state service as it stands**: `state.orchestration()` / `refreshOrchestration()` returns only nine scalar delegated-model/effort fields (`codexModel` … `piReasoningEffort`, `providers-settings-state.service.ts:642-656`) — it does not carry `detectedClis` or `disabledClis`. Those two fields exist only on the raw `agent:getConfig` response, which today only `AgentOrchestrationConfigComponent` reads, through its own injected `ClaudeRpcService`, into its own private signal (`agent-orchestration-config.component.ts:400, 567` call `agent:getConfig` directly; :344, :361, :368 read `detectedClis`/`disabledClis` off it) — component-private state a sibling cannot read. **Planned change, named explicitly rather than assumed:** extend `refreshOrchestration()`'s returned shape to pass through `config.detectedClis` and `config.disabledClis` alongside the nine existing fields (the RPC already returns both — `AgentOrchestrationConfigComponent` proves it); the matrix then reads all of it from `state.orchestration()`, and `AgentOrchestrationConfigComponent`'s own policy-bar rendering (§2.2's "Policy bar" row, unchanged) keeps reading whichever fields it still needs from the same enriched view or its own call, either is fine since both already tolerate independent refreshes. No RPC or backend contract change is required — only the state-service return shape | none beyond state-service injection (same pattern as siblings) | `addInstanceRequested`, `tierModalRequested: output<string>` (instance id), **`editInstanceRequested: output<string>`** (restores #50, opens the existing inline name/key edit that `PtahCliConfigComponent.beginEdit()` provides today), **`deleteInstanceRequested: output<string>`** (restores #55, existing confirm-then-`removeCli()` pattern), **`cursorCredentialRequested: output<void>`** (opens the Cursor row's Credentials action — see the fix to Regressed-UX item 10 in §5) | per-row: not-installed (dimmed, install-guide link, all other cells `—`), quota (error-tinted model cell + "Details" action instead of "Test"), disabled (dimmed row, checkbox unchecked), ready |
| Model / Effort matrix cell | New content, reuse primitive | `NativePopoverComponent` hosting a small model-select or effort-select (same content pattern as the Main Agent reassign popover; for system CLIs reuse `ProviderModelPickerComponent` **as extended in §2.4** where the CLI has a fixed provider, else the existing static option list from `ptah-cli-config.component.ts`'s `delegatedOptions`) | — | on selection: save immediately (see §4.2) | disabled (CLI off or not installed → cell renders as plain text, no popover trigger) |
| Permission & safety info popover | New content, reuse primitive | `NativePopoverComponent` hosting static copy keyed by CLI id (restores #70). **Citation correction:** the current `agent-orchestration-config.component.ts` has no per-CLI permission copy at all today (a grep for "Full auto"/"auto-approve"/"Sandboxed"/"permission" in that file finds only the Copilot auto-approve toggle, :278-290, :466-564) — #70's copy last existed in the pre-#575 revision `parity-inventory.md` cites (`AOC:350-359, 530-540, 580-590, 631-641, 701-711` at `7ecdefa45^1`, reachable via `git show 7ecdefa45^1:libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`), not the file on `main` today. The implementer should pull the exact wording from that old revision via `git show`; where the old wording does not cover a CLI added since (e.g. OpenCode, Antigravity), the copy is written fresh and needs the user's review before ship, not asserted here as already-approved text | — | — | — |
| System-CLI Credentials action (Cursor) | New content, reuse primitive | `NativePopoverComponent` on the Cursor row's Actions cell, hosting the existing Cursor API-key field and help copy moved from `ptah-ai/ptah-cli-config.component.ts` (`cursorKey`/`saveCursorCredential`, unchanged persistence — `state.saveCursorCredential(apiKey, context)` already exists, `providers-settings-state.service.ts:360`) plus the "Set" badge and help text parity item #64 asks for | — | saves via existing `saveCursorCredential` on submit (verify-then-save is not required for this field today — unchanged behaviour) | not shown for any other CLI row (Cursor-only, matching today's single Cursor field) |
| Add Ptah CLI instance | New content, reuse **new** `NativeModalComponent` (§2.5) — **not** a side drawer (former deviation 2 REJECTED by the user; the prototype's centered modal is kept) | `providers/add-cli-instance-modal.component.ts` hosting a form built from the existing `beginCliCreate()`/`createCli()` fields in `ptah-ai/ptah-cli-config.component.ts` (name, provider select, key, inline Copilot GitHub login block restoring #47, show/hide key restoring #49) | `open: input<boolean>` | `created: output<{name; providerId; apiKey}>` (parent calls the existing `createCli()` write), `closed: output<void>` | saving, error (inline, existing pattern), success → toast |
| CLI tier-mapping overlay | New content, reuse **new** `NativeModalComponent` (§2.5) — **not** a side drawer (former deviation 2 REJECTED by the user) | `providers/cli-tier-mapping-modal.component.ts` hosting Sonnet/Opus/Haiku model pickers (`ProviderModelPickerComponent`, `fixedProvider` = the instance's provider, `scope: 'cliAgent'`) — restores #53/#54 | `instanceId: input<string>`, `open: input<boolean>` | `saved: output<ProviderWizardTierMappings>`, `closed` | saving, error — **no verify-gate state**: tier changes are model, not credential, edits and save on selection per §4.2 with no connection check, so the modal never blocks on verification — **state-service method needed** (§2.4); no new backend contract: `ProviderTierScope` already includes `'cliAgent'` (`rpc-providers.types.ts:47`), only `mainAgent` is wired today |
| Background Model Roles matrix | Reuse (template restyle from stacked cards to a table), wrapped in `<details>` | `providers/provider-consumer-assignments.component.ts` (`ProviderConsumerAssignmentsComponent`) — inputs/outputs unchanged (`disabled`, `initialEditingConsumerId`, `setupProviderRequested`, `assignmentSaved`, `timeoutSaved`) | unchanged | unchanged | unchanged: the component already has per-row `state` or `summary`/`retryKey` handling (`makeRow(...)` in the existing file) — only its row chrome changes from an always-expanded card to a table row with a popover-triggered reassignment cell |
| "Follows main agent →" chip | New content (small, reused across both matrices) | inline `<button>` styled per §3.4, no new component needed — it is the existing role row's read-only state rendered as a link-styled trigger for the same reassignment popover | — | opens the row's reassignment popover | — |

### 2.3 Per-connection drawer content (fixes the prototype's known defect)

The drawer is one component; its **tab content is derived from the connection's `authModality` and
whether it is a custom entry**, not hard-coded to Claude. `ConnectionDetailDrawerComponent` computes a
`connectionKind` from inputs already available on `ProvidersConnection` (`authMode`, `id === 'anthropic'`
or has `CustomProviderEntry` fields):

| connectionKind | Overview & Used By | Credentials | Models & Tiers | Advanced |
|---|---|---|---|---|
| `claude-cli` (Claude subscription) | status + Used By list (unchanged shape for all kinds) | "claude login" copy block + Copy button (restores #10 help text); **no** Delete-key control (nothing is stored — it is a CLI session); no Replace | tier mapping (Sonnet/Opus/Haiku), searchable picker, tool-use badges | hidden — tab itself is not rendered (custom-only fields do not apply) |
| `api-key` (Anthropic API, Moonshot, Ollama Cloud, …) | status + Used By | masked key, show/hide toggle (#49), Replace, **Delete stored key** (#7/#8), help text + "Get a key" link (#9/#20) | tier mapping + searchable picker (#34) + tool-use badges (#38) | hidden, unless the connection is also a custom endpoint (see `custom` row) |
| `oauth` (GitHub Copilot, OpenAI Codex) | status + Used By | OAuth session summary, **Sign out / Disconnect** (#12), re-auth action ("Open login" / "Re-authenticate") | tier mapping where the provider exposes one (Codex); otherwise a "Provider default model" note | hidden |
| `local` (Ollama, LM Studio) | status + Used By | "No key needed" note; editable base URL; optional-key providers show the optional-key field + explanation (#15) | tier mapping (static or discovered list per provider) | hidden |
| `custom` (sovereigneg-style gateways) | status + Used By | key field only if the custom entry has one (Replace/Delete as in `api-key`); **base URL** lives here too and shares the key field's verify-then-save gate | tier mapping + custom model-ID entry (#35) | **models endpoint** (#27, verify-then-save like the Credentials tab — §2.4/§4.2), **help URL** (#28, saves directly, no verify), **pricing input/output per 1M** (#30, saves directly, no verify), **Delete connection** (#25) |

A tab that is not applicable is **not rendered** (not shown disabled) — `NativeTabGroupComponent`
already supports per-tab `disabled`, but hiding it entirely (via `tabs()` input being computed from
`connectionKind`) is preferred so the tab count itself communicates what this connection supports,
matching the brief's "progressive disclosure" rule rather than showing a dead tab.

### 2.4 Persistence paths for every new write, and the `ProviderModelPickerComponent` extension

Every output named in §2.1/§2.2 that is not already wired to an existing `ProvidersSettingsStateService`
method is listed here with the concrete RPC it needs, checked against the actual RPC contract in
`libs/shared/src/lib/types/rpc/*.ts` and the actual method list on `providers-settings-state.service.ts`
(not assumed). "Needs backend method" means the RPC contract itself has no parameter for this write
today and the architect must plan a contract change; "state-service method needed" means the RPC already
exists and only a thin wrapper method is missing from the frontend state service.

| Drawer/matrix output | RPC | Contract status | Fix required |
|---|---|---|---|
| `deleteKeyRequested` (Anthropic or third-party stored key, #7/#8) | none today | **needs backend method** — `AuthSaveSettingsParams` has no clear-key field (`rpc-auth.types.ts:29-38`) and there is no dedicated delete RPC in the current contract; the old `auth:saveSettings` clear-key path parity-inventory.md cites (#7/#8) does not exist in today's params shape | architect plans either a new `clearApiKey?: boolean` field on `AuthSaveSettingsParams` or a new `auth:deleteApiKey`/`auth:deleteProviderKey` RPC, then a new `ProvidersSettingsStateService.deleteStoredKey(providerId, context)` method |
| `disconnectRequested` (GitHub Copilot sign-out, #12) | `auth:copilotLogout` | **RPC contract already exists** (`AuthCopilotLogoutParams`/`Response`, `rpc-auth.types.ts:72-78`) but no state-service method calls it — `performExternalAuth` only ever calls `auth:copilotLogin`/`auth:codexLogin` (`providers-settings-state.service.ts:421-423`) | **state-service method needed**: add `ProvidersSettingsStateService.disconnectCopilot(context)` calling `this.require('auth:copilotLogout', {})`, then `refreshConnections()`/`refreshRoute()` exactly as `performExternalAuth` already does after a login |
| `deleteConnectionRequested` (custom provider delete, #25) | `provider:removeCustomEntry` | **RPC contract already exists** (`rpc-providers.types.ts:243-248`) but is never called from the frontend — `connectProvider` only calls `provider:addCustomEntry`/`provider:updateCustomEntry` (`providers-settings-state.service.ts:465-466`) | **state-service method needed**: add `ProvidersSettingsStateService.removeCustomEntry(id, context)` calling `this.require('provider:removeCustomEntry', { id })`, then `refreshConnections()` |
| `customFieldSaved` — **connection-affecting** fields: base URL, models endpoint (#27 — editing an *existing* custom entry's endpoint) | `provider:updateCustomEntry` | **RPC contract already exists and is already called**, but only from inside `connectProvider`'s verified-draft commit path (`providers-settings-state.service.ts:465`, gated on `saveTo === 'global'`) | **verify gate required, same as any credential change** (§4.2 states this once, not twice): changing the base URL or the models endpoint changes where the drawer fetches and validates models from — the prototype's own README calls the models endpoint "used for capability detection and model discovery" — so this write goes through the **existing** `verifyDraftConnection` path exactly like the wizard does, not a new no-probe method. No new state-service method: the drawer calls the same verify-then-commit flow `ProviderSetupWizardComponent` already uses for `connectProvider` |
| `customFieldSaved` — **metadata-only** fields: help URL (#28), pricing input/output per 1M (#30) | `provider:updateCustomEntry` | Same RPC as above, same call site today | **state-service method needed**: add a lighter `ProvidersSettingsStateService.updateCustomEntryFields(id, changes, context)` that calls `provider:updateCustomEntry` directly **without** the verify-draft gate — a help-URL string or a display-only price has no effect on connectivity or model discovery, unlike the endpoint fields above. The architect should still confirm the backend handler for `provider:updateCustomEntry` accepts a partial update (help URL/pricing only) without requiring the other fields a full verified draft would carry |
| `tierChangeRequested` (connection drawer Models & Tiers tab, main-agent tiers, #34-adjacent) | `provider:setModelTier` / `provider:clearModelTier`, `scope: 'mainAgent'` | **already exists and already wired** — same path `ProvidersSettingsComponent.saveModel()`/the wizard's tier commit use (`providers-settings-state.service.ts:499-502`) | no new method; the drawer calls the same state-service surface the Main Agent popover uses |
| CLI tier-mapping modal `saved` (#53/#54) | `provider:setModelTier` / `provider:clearModelTier` / `provider:getModelTiers`, `scope: 'cliAgent'` | **RPC/scope already exists** (`ProviderTierScope` includes `'cliAgent'`, `rpc-providers.types.ts:47`) but no state-service method ever passes that scope — only `mainAgent` is wired (`providers-settings-state.service.ts:499-502`) | **state-service method needed**: add `ProvidersSettingsStateService.setCliAgentTier(instanceId, tier, modelId, context)` mirroring the existing `mainAgent` write with `scope: 'cliAgent'` |
| Matrix `editInstanceRequested`/`deleteInstanceRequested` (#50/#55) | `ptahCli:update` / `ptahCli:delete` | **already exist and already wired** — `ptah-cli-config.component.ts`'s `saveEdit()`/`removeCli()` call them today | no new method; the matrix reuses the same calls, just triggered from a matrix row instead of a flat card |
| `cursorCredentialRequested` (Cursor API key) | `agent:setConfig` | **already exists and already wired** — `ProvidersSettingsStateService.saveCursorCredential(apiKey, context)` (`providers-settings-state.service.ts:360-363`) | no new method |

**`ProviderModelPickerComponent` extension (finding 1 — the component has neither capability today):**
`provider-model-picker.component.ts:189-206` renders the model control as a plain `<select>` over
`modelOptions()`; there is no search input anywhere in the file. Tool-use handling is a single
conditional warning (`toolUseWarning()`, :467-472) shown only when `requiresToolUse()` is set and the
selected model reports `supportsToolUse: false` — there is no per-model badge, icon, or "N models · M
support tool use" summary line for #34/#38. To restore #34/#38 as this spec's capability map claims,
`ProviderModelPickerComponent` needs two additions (or a sibling variant built the same way, sharing the
`PROVIDER_MODELS_LOADER` port):
1. Replace the model `<select>` with `NativeAutocompleteComponent` (exists, `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts`) filtering `modelOptions()` by name/id as the user types, keeping the existing "not in current catalog" pinned-option behaviour and the manual-entry fallback unchanged.
2. Render `ProviderModelInfo.supportsToolUse` (already on the type the component already reads, :63) as a small icon/badge per option and a "`N` models · `M` support tool use" summary line above the list, always visible — not only when `requiresToolUse()` fails a check.
This is new implementation work, not a template restyle; §2.1/§2.2/§5 mark every row that depends on it
accordingly rather than calling the component "already searchable".

### 2.5 New shared primitive: `NativeModalComponent`

The user's decision rejects the earlier draft's deviations 1/2 (side drawers standing in for centered
modals) and keeps the prototype's centered command-palette catalog, tier-mapping and add-instance
modals. The repository already has a centered daisyUI dialog pattern —
`libs/frontend/chat/src/lib/components/molecules/confirmation-dialog.component.ts:21`
(`<dialog #dialog class="modal" [class.modal-open]="dialogService.isOpen()">` with `modal-box`/
`modal-action`/`modal-backdrop`) — but that component toggles the `modal-open` CSS class and **never
calls `showModal()`/`close()`**, and it is bound to `ConfirmationDialogService`, not a reusable,
domain-free primitive. `NativeModalComponent` (new,
`libs/frontend/ui/src/lib/native/modal/native-modal.component.ts`) deliberately does **not** copy the
class-toggle mechanism: it uses the native `<dialog>` element's own `showModal()`/`close()` API instead,
because only that API delivers the focus trap, Esc-cancel behaviour and focus-restore this spec promises
— a class toggle alone gives none of those for free. This is one mechanism, chosen once, not two:

```html
<ptah-native-modal [isOpen]="isOpen()" ariaLabel="Connect a provider" (closed)="close()">
  <h3 modal-header>Connect a provider</h3>
  <div>…body…</div>
  <div modal-footer><button class="btn btn-ghost" (click)="close()">Cancel</button></div>
</ptah-native-modal>
```

- **Inputs:** `isOpen: input<boolean>` (parent owns visibility, same control contract as
  `NativeDrawerComponent`/`NativePopoverComponent`), `ariaLabel: input<string>`, `size: input<'sm' | 'md' | 'lg'>('md')` (maps to `modal-box` width, e.g. `max-w-sm`/`max-w-lg`/`max-w-2xl` — the catalog modal uses `lg`, the tier-mapping and add-instance modals use `sm`/`md`).
- **Outputs:** `closed: output<void>` — requested, not forced, exactly like the drawer/popover contract.
- **Structure:** `<dialog #dialog class="modal">` (no `[class.modal-open]` binding — visibility is driven
  entirely by `showModal()`/`close()`, not by a class) + `<div class="modal-box">` with
  `[drawer-header]`-style projection slots (`[modal-header]`, default body, `[modal-footer]`) + a
  `<form method="dialog" class="modal-backdrop"><button (click)="requestClose()">close</button></form>`,
  keeping only the backdrop-form part of `confirmation-dialog.component.ts:57-59`, not its class-toggle
  part.
- **Focus:** a `viewChild<ElementRef<HTMLDialogElement>>` + an `effect()` that calls
  `dialog.showModal()` when `isOpen()` becomes `true` and `dialog.close()` when it becomes `false`.
  `showModal()` traps focus and, on `close()`, returns it to the element that had focus beforehand — both
  per the HTML Living Standard, with no extra code. The drawer and popover, by contrast, implement their
  own Tab-trap and keydown handling in TypeScript (`native-drawer.component.ts:265-294`,
  `native-popover.component.ts:227-233`) precisely because a plain `<div>` gets none of this for free —
  neither primitive has a CDK dependency to begin with, so `NativeModalComponent` is not removing one
  either; it is simply the one Native overlay that gets focus handling from the browser instead of from
  hand-written code.
- **Esc:** native `<dialog>` fires a `cancel` event on Esc and calls `close()` itself; the component
  listens for `(cancel)` and emits `closed` so the parent's `isOpen` signal stays in sync — no manual
  keydown check, unlike the drawer's `onPanelKeydown` (`native-drawer.component.ts:243-255`), because the
  browser already does this for a `<dialog>` opened with `showModal()`.
- **Backdrop:** the `modal-backdrop` form-button pattern from `confirmation-dialog.component.ts:57-59`,
  unchanged — that part of the existing pattern is accurate and is kept as-is.
- **Aria:** native `<dialog>` opened with `showModal()` is exposed as a modal dialog to assistive tech;
  the component still sets `[attr.aria-label]="ariaLabel()"` explicitly, matching `NativeDrawerComponent`'s
  `ariaLabel` convention, since a `<dialog>` has no implicit accessible name.

This is new work in `libs/frontend/ui`, reviewed like any other Native primitive addition, before the
three consumers in §2.1/§2.2 (`ProviderCatalogModalComponent`, the Add Ptah CLI instance modal, the CLI
tier-mapping modal) can be built on it.

---

## 3. Visual spec (dark `anubis` + light `anubis-light`)

All values are the project's own daisyUI 4 utility classes over the `anubis` / `anubis-light` themes
already defined in `apps/ptah-extension-webview/tailwind.config.js` — the same tokens the prototype's
`assets/app.css` copied (`--brand-primary` = `primary` = `#2563eb` dark / `oklch(85% 0.138 181.071)`
light, etc.). No new hex values, no new token names. Prefer daisyUI's own classes (`badge`, `btn`,
`card`, `table`) over the prototype's hand-rolled `.conn-card` / `.matrix-table` / `.popover-custom`
CSS, since those already exist and are themed.

### 3.1 Routing map

- Container: `<div class="grid grid-cols-1 md:grid-cols-3 gap-3">` inside a
  `<ptah-native-card density="compact" tone="neutral" [clickable]="false">` (existing component,
  existing tones — no new tone value).
- Each node: `<button type="button" class="w-full rounded-lg border border-base-300 bg-base-100 p-2.5 text-left transition-colors hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content min-h-[88px]">` — a real `<button>`, not a `<div onclick>` (the prototype's pattern), so it is keyboard-operable and announced as a button without extra `role`/`tabindex` plumbing.
- Status dot: `<span class="h-2 w-2 rounded-full bg-success">` / `bg-info` / `bg-warning` — **graphical
  indicator only** (3:1 threshold applies, not 4.5:1 — see §3.7), never the sole carrier of meaning:
  always paired with the row's status text.
- Title: `text-xs font-bold uppercase tracking-wide text-base-content`.
- Body lines: `text-sm font-medium text-base-content` for the primary value (provider/model), `text-xs
  text-base-content-muted` for secondary lines — reuses the project's existing `base-content-muted`
  Tailwind color (already contrast-checked to ≥ 5.01:1 in both themes per `tailwind.config.js`
  comments), not the prototype's ad hoc `--brand-content-muted` variable.
- Footer action affordance ("Reassign", "Inspect", "Manage Matrix"): `text-xs font-medium text-base-content underline underline-offset-2` with a trailing chevron icon in `text-base-content-muted` — **not** `text-primary` (§3.7 measurement: fails 4.5:1 at this size; this substitution is deviation 6 in §6, approved by the user 2026-09-29, task.md "## Decisions").

### 3.2 Scope badge + popover

- Badge (replaces `SettingScopeRowComponent`'s always-visible strip): `<button type="button" class="badge badge-outline badge-sm gap-1 border-secondary/40 bg-secondary/10 text-secondary font-semibold">` for a Workspace override, `border-info/40 bg-info/10 text-info` for an App override — reuses daisyUI's `badge-outline` exactly as `ProviderConnectionCardComponent` already does for its status badge, just with the theme's `secondary` (gold) / `info` (blue) semantic slots instead of a new colour. Renders **nothing** when `hasOverride()` is false (brief §3).
- Popover content (`NativePopoverComponent`, `placement="bottom-end"`, `hasBackdrop=true` — the
  component's actual default, `native-popover.component.ts:136`, and the only way this popover closes on
  an outside click: `NativePopoverComponent` closes only on Esc, on a backdrop click, or via the parent —
  there is no document-level outside-click listener, so a transparent backdrop is required for every
  popover in this spec, not merely an option):
  three rows (Global / App / Workspace, with the active layer highlighted via
  `bg-primary/10 border border-primary/30 rounded px-2 py-1`), then the existing `Clear override` /
  `Use global value` buttons exactly as `SettingScopeRowComponent` renders them today (unchanged
  `btn btn-ghost btn-sm`), just moved from an always-visible row into the popover body.

### 3.3 Connection card (≤ 80 px)

- `<ptah-native-card density="compact" ...>` already supports a compact density; additionally cap
  height via a wrapper: `<div class="max-h-20 overflow-hidden">` is **not** used (clipping real status
  text is the opposite of parity item #22's "no truncation" fix) — instead the card's *internal*
  paddings shrink: `density="compact"` plus explicit `p-2` on the two inner rows, `gap-1` instead of
  `gap-3`, and dropping the scope row into the drawer (§2.3) rather than the card face, which is what
  actually buys back the vertical space the prototype needed.
- Grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3` (matches the fold-budget requirement in
  §1.1 that 5 cards render in 2 rows, not 5).
- Card tones already exist and already encode state (`cardTone()` → `secondary` for active, `warning`
  for needs-key/unreachable, `error` for unauthenticated, `neutral` otherwise) — reuse as-is, no new
  tone.

### 3.4 Connection drawer

- `<ptah-native-drawer [isOpen]="isOpen()" ariaLabel="{{ providerName }} connection details" (closed)="close()">` — existing component, `side` left at its default (`right`).
- Header slot (`[drawer-header]`): provider mark (`ProviderMarkComponent`, existing) + name + auth
  modality text, matching `ProviderConnectionCardComponent`'s own header row for visual consistency
  between the card and its drawer.
- Tabs: `<ptah-native-tab-group [tabs]="visibleTabs()" [(activeId)]="activeTab" ariaLabel="Connection details sections">` (existing component — no bespoke `.drawer-tabs` CSS needed).
- Body: `<div class="space-y-4 text-sm">` per tab, reusing `input`/`select input-bordered input-sm` etc.
  exactly as the rest of the settings surface already does (`FIELD`/`CONTROL` constants in
  `providers-settings.component.ts`) rather than the prototype's bespoke `.input-xs`.
- Footer slot (`[drawer-footer]`): `Close` (`btn btn-ghost btn-sm`) + a per-tab primary action where one
  applies (`Delete key`, `Save tier mapping`, …) rather than one blanket "Save Changes" button — because
  each tab's changes save independently (credential replace triggers its own verify-then-save; a tier
  change saves on selection). This is a deliberate deviation from the prototype's single footer Save —
  see §6.

### 3.5 CLI Agents & Orchestration matrices

- `<table class="table table-xs w-full">` (daisyUI's own dense table variant) inside
  `<div class="overflow-x-auto rounded-lg border border-base-300">` — replaces the prototype's bespoke
  `.matrix-table` CSS entirely; daisyUI's `table-xs` already matches the ≈32 px row height the fold
  budget assumes.
- Interactive cell trigger: `<button type="button" class="link link-hover inline-flex items-center gap-1 font-mono text-xs text-base-content">` + a small chevron icon in `text-base-content-muted` — again **not** `text-primary` text (§3.7 measurement; §6 deviation 6). The dashed-border hover affordance from the prototype's `.matrix-cell-interactive` is kept as `hover:bg-base-200 rounded px-1`.
- Status/permission badges: `badge badge-outline badge-sm` with an icon carrying the colour and the text
  staying `text-base-content` (mirrors `ProviderConnectionCardComponent`'s existing pattern — see §3.7 and §6 deviation 6).

### 3.6 Centered modals (`NativeModalComponent`)

- Catalog modal: `<div class="modal-box max-w-lg">` (matches `size="lg"`), header slot holds a search
  `<input class="input input-bordered input-sm w-full" placeholder="Search providers…">` (reuses
  `FIELD`-style classes, not the prototype's `input-xs`), body is a scrollable `<ul class="menu">` of
  provider rows (`li` per catalog entry, `Connect` as `btn btn-sm btn-outline btn-primary` — this is the
  one place `btn-primary` text is safe, because daisyUI's `btn-primary` pairs `primary-content` text on a
  `primary` background, not `text-primary` on `base-100` — see §3.7).
- Add-instance / tier-mapping modals: `<div class="modal-box max-w-md">` (`size="sm"`/`"md"`), body uses
  the same `FIELD`/`CONTROL` class constants as the rest of the settings surface, footer
  (`modal-action`) holds `Cancel` (`btn btn-ghost`) + the primary action (`btn btn-primary`).
- All three use `modal-backdrop` exactly as `confirmation-dialog.component.ts:57-59` does — no bespoke
  backdrop styling.

### 3.7 Accessibility: contrast measurements

Criterion applied: WCAG 2.2 AA (1.4.3 Contrast (Minimum), 4.5:1 for normal text; 1.4.11 Non-text
Contrast, 3:1 for graphical objects/UI components). Pairs measured (relative-luminance formula, dark
`anubis` theme; both are the project's own token values, not prototype inventions):

| Foreground | Background | Ratio | Verdict |
|---|---|---|---|
| `text-base-content` `#e8e6e1` | `bg-base-100` `#131317` | ≈ 15.6:1 | pass (body text) |
| `base-content-muted` (theme `--bcm`) | `bg-base-100` | 5.29:1 for `anubis` (`tailwind.config.js:98`), 5.01:1 for `anubis-light` (`tailwind.config.js:161`) — the full per-theme ratio table lives in TASK_2026_186, not in this config file (`tailwind.config.js:21-24` defers to it) | pass (secondary text), both themes |
| `text-success` `#16a34a` | `bg-base-100` | ≈ 5.6:1 | pass as text |
| `text-warning` `#f97316` | `bg-base-100` | ≈ 6.6:1 | pass as text |
| `text-info` `#3b82f6` | `bg-base-100` | ≈ 5.0:1 | pass as text |
| **`text-primary` `#2563eb`** | `bg-base-100` | **≈ 3.6:1** | **fails 4.5:1 as text at any size used here** (14pt-bold/18pt-regular "large text" threshold is not met by any control in this spec); passes the 3:1 graphical/UI-component threshold, so it stays valid for icons, dots, borders and badge backgrounds, not for standalone link/label text |
| **`text-error` `#dc2626`** | `bg-base-100` | **≈ 3.8:1** | same finding as `text-primary`: valid for icons/dots/borders, not for status copy text |

Rule proposed throughout this spec (§3.1, §3.5): every place the prototype rendered a value, a link, or
a status word in `text-primary` or `text-error`, this spec instead renders that text in
`text-base-content` (or `base-content-muted`) and carries the colour on an icon, dot, or badge
background/border — the exact pattern `ProviderConnectionCardComponent`'s `statusBadgeText()` /
`statusIcon()` already use today (which is why that existing component needed no visual change to its
text-colour rules). This rule is **not** in the brief or in `task.md`'s "## Decisions" — it is this
document's own addition from the measurement above, so it is recorded as deviation 6 in §6, requiring
the user's explicit sign-off like every other deviation, rather than being asserted here as settled.

Light theme (`anubis-light`) pairs were not independently computed for this spec; because the rule above
removes every small colored-text usage regardless of theme, the light theme carries no additional risk
from this change. The visual-reviewer should still spot-check `anubis-light` badge/icon pairs before
sign-off, per the project's existing practice of measuring `base-content-muted` per theme.

---

## 4. Interaction spec

### 4.1 Trigger → overlay map

| Trigger | Overlay | Component |
|---|---|---|
| Click Main Agent node | Main Agent reassign popover | `NativePopoverComponent` + new content component |
| Click Background Roles node | Navigates to Agent Orchestration tab (no popover) | tab switch |
| Click CLI Agents node | Navigates to Agent Orchestration tab | tab switch |
| Click a scope badge | Scope popover | `NativePopoverComponent` + `SettingScopeRowComponent`'s existing popover content |
| Click a connection card (anywhere on it, via the new `detailsRequested`/`activated` wiring, §2.1) | Connection detail drawer | `ConnectionDetailDrawerComponent` (`NativeDrawerComponent`) |
| Click "Connect provider" / "+ Connect another provider" / a catalog hint | Provider catalog modal, then (on `providerChosen`) the existing provider setup wizard drawer | `ProviderCatalogModalComponent` (`NativeModalComponent`, §2.5) → `ProviderSetupWizardComponent` (existing, unchanged) |
| Click a matrix model/effort cell | Small select popover | `NativePopoverComponent` + new content |
| Click a "Follows main agent →" chip | Role reassignment popover (same as a matrix cell) | `NativePopoverComponent` |
| Click the permission `ℹ️` | Permission info popover (read-only) | `NativePopoverComponent` |
| Click the Cursor row's Credentials action | Cursor credential popover | `NativePopoverComponent` |
| Click "Add Ptah CLI Instance" | Add-instance modal | `NativeModalComponent` (§2.5) |
| Click "Tiers" on a Ptah CLI row | Tier-mapping modal | `NativeModalComponent` (§2.5) |
| Click "Delete key" / "Sign out" / "Delete connection" | Inline confirm within the drawer tab (same confirm-then-act shape `ProvidersSettingsComponent` already uses for clearing a scope override, `clearKey()`/`reviewClear()`, `providers-settings.component.ts:193-204, 558-565` — that method itself clears a *scope override*, not a credential; the drawer's confirm wires to the write named for each action in §2.4, not to `clearKey()`) | same drawer |

### 4.2 Save behaviour

**The running-session rule (`123c84c25`, `investigation/synthesis.md:56-57`):** provider edits made from
Settings must not change the behaviour of the session already running, with one existing, deliberate
exception the code itself documents: `provider:setModelTier`/`clearModelTier` "persists
`provider.<id>.mainAgent.modelTier.<tier>` and changes the running env only when `<id>` is the active
provider" (`providers-settings-state.service.ts:485-489`), and editing an *inactive* provider's tiers
"never touch[es] the running env" (:510-513). This spec's save paths respect that split as follows —
none of them widens it:
- **Main Agent popover model/tier/effort** edits the currently active provider's own routing by
  definition (it is the popover for "what the main agent uses next"). A save here is expected to affect
  the running session immediately, exactly as today's existing `saveModel()`/`saveEffort()` flow already
  does (`providers-settings.component.ts:515-535`) — this is not a new exposure, and the toast that
  confirms the save is the trace the acceptance criterion in `task.md:54` asks for.
- **Connection drawer Models & Tiers tab and the CLI tier-mapping modal** edit a *specific* connection's
  or CLI instance's tiers, which only touches the running env when that connection happens to be the
  active main-agent provider (same code path, same guard) — editing any other, non-active connection's
  tiers is inert on the running session by the existing guard, with no new work required to keep it that
  way.
- **Credentials** (API key add/replace/delete, sign-out, and the custom entry's connection-affecting
  fields — base URL, models endpoint) never touch the running session directly; they require a passing
  connection check before the value is even persisted (existing rule, unchanged below and spelled out
  precisely in §2.4's split between connection-affecting and metadata-only custom fields), and the
  running session keeps using whatever it already resolved until the
  user explicitly re-activates that provider.

- **Model / effort / role-routing changes** (Main Agent popover, matrix model/effort cells, Background
  Role reassignment, CLI tier mapping): save on selection. On success: a toast
  (`role="status" aria-live="polite"`) reading "Saved {field} to {scope}." with an **Undo** button that
  saves the pre-change value back through the same `state.saveSettings(...)` path (not a client-side
  revert of the displayed text — Undo performs a real write of the previous value, so the effective
  value and the display never disagree).
- **Credentials** (API key add/replace, plus the custom entry's **base URL and models endpoint**):
  unchanged existing rule — a passing `Check connection` / verify-draft probe is required before the
  value is persisted, because those two fields change what the connection reaches and what models it
  discovers, not just how it authenticates. The drawer's Credentials tab (key) and Advanced tab (base
  URL, models endpoint) both reuse the existing `verifyDraftConnection` callback already wired through
  `ProvidersSettingsComponent` for the wizard; it is not a new backend contract. **Not** gated the same
  way: the custom entry's **help URL and pricing fields** (#28, #30) are metadata-only — they do not
  change connectivity or model discovery — and save directly through the new
  `updateCustomEntryFields` method (§2.4) with no verify step, same as a model/effort selection.
- **Scope target selection**: chosen inside the popover/drawer, exactly per brief §3 ("Save to: This
  workspace / Desktop app / All Ptah apps"), using `state.writeScopes(key)` to compute the offered list —
  the existing mechanism `ProvidersSettingsComponent.modelTargets()`/`effortTargets()` already use.

### 4.3 Keyboard and focus

- Popovers (`NativePopoverComponent`): Esc closes and returns focus to the trigger (existing component
  behaviour — `handleHostKeyDown`); no new work needed beyond wiring `trigger`/`content` slots.
- Drawers (`NativeDrawerComponent`): existing native focus trap (Tab/Shift+Tab cycle inside the panel),
  focus moves to the first focusable element on open, Esc requests close, backdrop click requests close,
  focus returns to the element that opened the drawer on close — all already implemented; the new
  `ConnectionDetailDrawerComponent` and `ProviderSetupWizardComponent` (unchanged) inherit this for free
  by being built on `NativeDrawerComponent`.
- Modals (`NativeModalComponent`, §2.5): native `<dialog>.showModal()` traps focus and returns it to the
  invoking element on close per the HTML spec, with no CDK/manual work needed; Esc fires the browser's
  own `cancel` event, which the component turns into `closed`; backdrop click closes via the
  `modal-backdrop` form-button pattern already used in `confirmation-dialog.component.ts:57-59`. The
  catalog modal, add-instance modal and tier-mapping modal all get this for free once built on
  `NativeModalComponent`.
- Matrix tables: cells that open a popover are real `<button>` elements inside the table, so native Tab
  order already reaches them; arrow-key cell navigation (a full grid pattern) is **not** implemented —
  Tab/Shift+Tab between cells is sufficient and matches the rest of the settings surface.
- `NativeTabGroupComponent`'s drawer tabs already implement the WAI-ARIA "tabs with automatic
  activation" keyboard model (ArrowLeft/Right, Home/End, roving tabindex) — reused as-is.

### 4.4 Accessible names

- Every popover/drawer trigger button carries an `aria-label` naming the field and current value (e.g.
  `aria-label="Change model for Codex, currently gpt-5.5-codex"`), matching the existing convention in
  `ProviderConnectionCardComponent` (`changeMainProviderAriaLabel()` etc.) — new components follow the
  same `computed<string>` pattern, not a static string.
- Toasts use `role="status" aria-live="polite"` (matches `ProvidersSettingsComponent`'s existing
  `state.commit()` feedback region) so Undo becomes discoverable without requiring the user to already be
  looking at the corner of the screen.

---

## 5. Capability map (17 restored + regressed UX)

| # | Capability | Lives in (new UI) |
|---|---|---|
| #7 | Delete stored Anthropic API key | Connection drawer (`claude`/`api-key` kind) → Credentials tab → Delete |
| #8 | Delete stored 3rd-party key | Connection drawer (`api-key`/`custom` kind) → Credentials tab → Delete |
| #12 | GitHub Copilot sign-out | Connection drawer (`oauth` kind, Copilot) → Credentials tab → Sign out |
| #25 | Delete custom provider | Connection drawer (`custom` kind) → Advanced tab → Delete connection |
| #27 | Custom provider models endpoint | Connection drawer (`custom` kind) → Advanced tab |
| #28 | Custom provider help URL | Connection drawer (`custom` kind) → Advanced tab |
| #30 | Custom provider pricing (input/output per 1M) | Connection drawer (`custom` kind) → Advanced tab |
| #34 | Searchable model autocomplete | `ProviderModelPickerComponent` **as extended in §2.4** (new `NativeAutocompleteComponent`-based search — not present in the component today) inside Main Agent popover, connection drawer Models tab, and matrix cells |
| #38 | Tool-use compatibility indicators | `ProviderModelPickerComponent`'s **new** per-model badge + summary line, added per §2.4 (today's component only warns when a consumer sets `requiresToolUse`, `provider-model-picker.component.ts:467-472` — there is no always-on badge to reuse), surfaced in the same three places as #34 |
| #43 | Ptah CLI agent status (Ready/Error/Init/No Key) | CLI Agents & Instances matrix → Status column |
| #44 | Ptah CLI agent key status | CLI Agents & Instances matrix → Agent/Instance column subline badge |
| #47 | Inline GitHub login for Copilot-backed CLI agent | Add Ptah CLI instance modal, provider = Copilot |
| #49 | Show/hide API key toggle | Connection drawer Credentials tab, Add Ptah CLI instance modal |
| #53 | CLI-agent tier mapping (scope: cliAgent) | CLI tier-mapping overlay (per Ptah CLI instance row's "Tiers" action) |
| #54 | Tier-mapping badges on CLI cards | CLI Agents & Instances matrix → Agent/Instance column subline |
| #70 | Per-CLI permission and safety notes | CLI Agents & Instances matrix → Permissions & Safety column + info popover |
| #71 | Per-CLI grouping, hide uninstalled from the primary list | CLI Agents & Instances matrix → installed rows first, "Uninstalled" subsection below |
| Reload button (#21) | **Dropped**, per user decision | not present anywhere |

Regressed UX items, all addressed structurally by this spec:

1. 5-step wizard for adding a key → still applies to **new** connections (credential still needs a
   verify probe, unchanged backend rule), but **existing** connections manage their key from the drawer's
   Credentials tab directly, no wizard re-entry (§2.1 connection-card row: `manageRequested` opens the
   drawer, not the wizard).
2. Tier-model editing only inside the wizard → now available directly from the Main Agent popover
   (model draft) and the drawer's Models & Tiers tab, both save-on-selection (§4.2) — no forced re-verify
   for a tier-only change.
3. Unconfigured providers hidden in a closed disclosure → replaced by the always-visible catalog hint
   strip plus the always-reachable "Connect provider" wizard catalog.
4. Claude API key `canManage=false` → the drawer's Credentials tab is reachable for every connection
   kind including `claude-cli`/`api-key`, so the card no longer needs a separate "cannot manage" path.
5. Workspace save target hidden → every popover/drawer surfaces the scope picker per §4.2.
6. 5 stacked scope rows on the main card → replaced by the routing map's compact scope **badges** (§3.2),
   rendering nothing when inherited.
7. "Use for main agent" hidden until Check connection passes for a checkable provider → unchanged
   backend gate, but this is intentional (never claim a route works before it is verified) and already
   correctly implemented in `ProviderConnectionCardComponent`'s state table (`not-checked` case already
   offers "Use for main agent" only when `uncheckable()`); this spec does not change that rule.
8. Delegated CLI models/effort 3-click / split across tabs → both settings now live in one cell,
   one tab (Agent Orchestration), and both save on selection (§4.2). The Cursor API key, which has no
   model/effort cell to live in, gets its own Credentials action on the Cursor matrix row (§2.2), so it
   is not lost in the move off `ptah-cli-config`'s flat cards.
9. Repeated "Manage provider, model and credentials in Providers" button ×6 → the CLI Agents node on
   Providers deep-links to the matrix once; individual rows no longer repeat that sentence.
10. Missing setup help text (#9, #10, #13, #15, #20) → restored verbatim in the drawer's Credentials tab
    per connection kind (§2.3). #64 (Cursor key help, "Set" badge) → the new Cursor Credentials popover
    on the CLI matrix row (§2.2), carrying the field and help text moved out of `ptah-cli-config`. #67
    (opencode `provider/model` format hint) → the opencode row's model matrix-cell popover content
    (§2.2's "Model / Effort matrix cell" row), not the Add Ptah CLI instance modal — opencode is a system
    CLI, not a Ptah CLI instance, so it never appears in that modal.
11. CLI test results without latency/reason → the matrix's Status column and "Test"/"Details" action
    show latency where available (`Ready (112ms)`) and the failure reason inline (`Details` action),
    matching parity item #52.
12. Native `<select>` model picker with no search → replaced everywhere by
    `ProviderModelPickerComponent` **once extended with search per §2.4** (#34) — not by the component
    as it stands today.
13. License/data-portability moved to Advanced → unchanged; out of scope for this task (Advanced is not
    being redesigned here).

---

## 6. Deviations from the approved prototype

These are the only points where this spec does not literally reproduce `prototypes/final/`. All need the
user's explicit sign-off before implementation proceeds past Gate 1.7.

1. ~~Connect-provider flow stays a single existing drawer, not a separate command-palette modal +
   wizard.~~ **REJECTED by the user** (revision-round-1 decision). The earlier draft of this spec argued
   no centered-modal primitive existed; that was wrong — `confirmation-dialog.component.ts:21` already
   renders a centered daisyUI `<dialog class="modal">`, and the command-palette-modal-then-wizard flow
   was itself part of the user's Gate-1.7-approved save model (`task.md:70`). The spec now keeps that
   flow: §2.1's "Connect provider" row and §2.5 specify a new `NativeModalComponent` primitive plus a
   `ProviderCatalogModalComponent` built on it, handing off to the unchanged `ProviderSetupWizardComponent`
   drawer. No deviation remains here.
2. ~~Tier-mapping overlay and Add Ptah CLI instance overlay use `NativeDrawerComponent`.~~ **REJECTED by
   the user**, same decision as #1. §2.2 now specifies both as `NativeModalComponent` dialogs, matching
   the prototype's centered `.modal-backdrop-custom` presentation. No deviation remains here either —
   what is genuinely new is the `NativeModalComponent` primitive itself (§2.5), which is scope, not a
   visual deviation from the approved prototype.
3. **Connection drawer footer has no single "Save Changes" button.** The prototype's drawer footer
   always shows one `Save Changes` action. Because credential edits need a verify-then-save round trip
   and tier/model edits save on selection (§4.2), a single footer button would either save unverified
   credentials or be a no-op on tabs with nothing pending. Each tab instead carries its own primary
   action where one applies.
4. **Background Model Roles matrix defaults to collapsed**, not `open` as in the prototype's
   `orchestration.html`. This is needed to make the fold-budget pass/fail line in §1.2 achievable without
   also asking the CLI matrix to shrink below `table-xs` density. The roles matrix is one click away
   (`<summary>`). (The earlier draft additionally cited `investigation/synthesis.md`'s IA table as
   listing the roles matrix below the CLI table — that citation was backwards: synthesis.md:43 lists the
   model-roles table *before* the CLI agents table. The fold-budget argument above is the actual and
   sufficient justification; the citation is withdrawn.)
5. **Preferred-order reordering uses up/down chevron buttons, not drag handles or a grip icon.** The
   existing `AgentOrchestrationConfigComponent.moveAgentUp/moveAgentDown` already implements exactly
   this, and TASK_2026_534 (#581) deliberately removed the decorative grip icon (parity item #73's note:
   "The decorative grip icon was removed (#581)"). The earlier draft of this deviation reintroduced a
   non-functional grip icon as a visual affordance for the same up/down actions — that reopens the #581
   decision and would mislead users into expecting drag behaviour that is not implemented. Fixed: two
   small chevron buttons (`▲`/`▼`, `aria-label="Move {agent} earlier in the preferred order"` /
   `"…later…"`) per chip, no grip icon anywhere, and no native drag-and-drop. Reintroducing draggable
   reordering remains out of this task's scope (it would need its own keyboard-equivalent design).
6. **Status, link and value text never renders in `text-primary` or `text-error` (§3.7).** The approved
   prototype uses `text-primary` for matrix cell text (`orchestration.html:206, 293`) and for status
   text elsewhere. This spec's own contrast measurement (§3.7) found `#2563eb` on `#131317` ≈ 3.6:1 and
   `#dc2626` on `#131317` ≈ 3.8:1, both below the 4.5:1 WCAG AA threshold for normal text at every size
   used in this feature. WCAG AA 4.5:1 for these specific elements is **not** a rule stated in the brief
   or in `task.md`'s "## Decisions" — it is this document's own addition, and unlike deviations 3–5 it
   changes the prototype's visual language (colour carried on icons/dots/badges instead of on the text
   itself) rather than an interaction detail. It needs the user's explicit sign-off as its own line item,
   separate from "the spec generally follows accessible-contrast practice." If rejected, the alternative
   is to keep `text-primary`/`text-error` as literal text colour and accept the measured AA shortfall
   pending a token-level fix (out of this task's scope, since "no new palette" is also a brief rule).

Everything else in §1–§5 above matches the approved prototype's structure, copy and save model.

---

## 7. Lane-introduced constraints

None. No agent lane introduced a rule not already in `task.md`'s "## Decisions", `parity-inventory.md`,
or `prototypes/final/BRIEF.md` / `prototypes/final/README.md`. The `text-primary`/`text-error` contrast
rule is this document's **own** addition, not a lane's — it is listed as deviation 6 in §6 and was
approved by the user on 2026-09-29 (task.md "## Decisions").

---

## Revision log (round 1 of 2)

| Finding | How fixed |
|---|---|
| 1 BLOCKING — `ProviderModelPickerComponent` falsely claimed to already have search + tool-use badges | §2.4 now names the two additions the component needs (`NativeAutocompleteComponent`-based search, always-on tool-use badge/summary), cites the exact lines showing today's `<select>` and single-warning behaviour, and every §2/§5 row that depended on the false claim (Main Agent popover, matrix cells, capability rows #34/#38, Regressed-UX item 12) now points at "as extended in §2.4" instead of "already provides"/"already searchable" |
| 2 SERIOUS — destructive/edit outputs with no persistence path | New §2.4 table names the RPC and contract status (exists vs. needs backend method) for every one: delete stored key (needs backend method — no clear-key param exists), Copilot sign-out (state-service method needed, RPC exists), delete custom provider (state-service method needed, RPC exists), custom-entry advanced-field edits (state-service method needed, RPC exists), CLI-agent tier mapping (state-service method needed, RPC scope already exists) |
| 3 SERIOUS — "click a connection card" contradicted "inputs/outputs unchanged" | §2.1's card row now adds one new `detailsRequested` output wired to `NativeCardComponent`'s existing `activated` output with `[clickable]="true"`, and §4.1's card-click row cites that wiring explicitly |
| 4 SERIOUS — scope popover specified `hasBackdrop=false` against the component's real default and only close path | §3.2 now specifies `hasBackdrop=true` (the actual default) for every popover in this spec, with the reasoning that there is no outside-click listener without it |
| 5 SERIOUS — deviations 1/2 justified by a false "no modal primitive exists" premise, reversing an approved decision | User rejected both; §2.1/§2.2 now specify `ProviderCatalogModalComponent` and the tier-mapping/add-instance modals on a new `NativeModalComponent` (§2.5, built on the existing `<dialog class="modal">` pattern from `confirmation-dialog.component.ts`); §6 deviations 1–2 are marked REJECTED with the corrected premise recorded, not silently deleted |
| 6 SERIOUS — the `123c84c25` running-session rule was never stated and the active-provider exception was unaddressed | New §4.2 preamble states the rule, quotes the code's own documented exception (`providers-settings-state.service.ts:485-489, 510-513`), and states explicitly which save paths are exempt (Main Agent popover, active-connection tier edits) versus inert (non-active connection tier edits, all credential writes) |
| 7 SERIOUS — Regressed-UX item 10 gave #64/#67 no real location and silently dropped the Cursor API key control | §2.2 adds a Cursor-only Credentials popover on the CLI matrix row (with its own persistence row in §2.4, reusing the existing `saveCursorCredential`), and item 10 now names that location for #64 and the opencode model-cell popover for #67, instead of the Add Ptah CLI instance modal (which only ever applies to Ptah CLI instances, not system CLIs) |
| 8 SERIOUS — CLI matrix retired `PtahCliConfigComponent`'s cards without keeping edit/delete | §2.2's matrix row adds `editInstanceRequested`/`deleteInstanceRequested` outputs restoring #50/#55, referencing the existing `ptahCli:update`/`ptahCli:delete`-backed methods, confirmed as "already exist and already wired" in §2.4 |
| 9 minor — "effort as 4 buttons" vs. 5 `effortLevels` values | §2.1's Main Agent popover row now says "5 buttons, one per `effortLevels` entry" and lists the five values |
| 10 minor — §1.2 fold budget had no FAIL clause and assumed exactly 5+2 CLIs | §1.2 now states an explicit FAIL clause and the per-row arithmetic that applies at other installed-CLI counts |
| 11 minor — deviation 4 misquoted synthesis.md's IA table ordering | §6 deviation 4 withdraws that citation and keeps only the fold-budget justification, which is sufficient on its own |
| 12 minor — deviation 5's grip icon contradicted the #581 decision it was citing | §6 deviation 5 now specifies up/down chevron buttons with `aria-label`s and explicitly no grip icon; §1.2's cross-reference is unaffected since it only names "up/down controls" |
| 13 minor — the contrast rule was an unlisted, self-contradicting "None" in §7 | Moved into §6 as deviation 6 (this round's required numbering), with its own sign-off framing; §7 rewritten to state plainly that this rule is the document's own addition, not a lane's, and point at deviation 6 rather than asserting settled-ness |
| 14 minor — imprecise base-content-muted citation | §3.7's contrast table now cites both ratios (5.29:1 `anubis` at `tailwind.config.js:98`, 5.01:1 `anubis-light` at :161) and defers the full per-theme table to TASK_2026_186 as the config file's own comment does |
| 15 minor — CLI matrix wrongly cited `AgentOrchestrationConfigComponent`'s private computed as its data source | §2.2's matrix row now reads `state.orchestration()` via `ProvidersSettingsStateService`, matching how the Ptah-instance rows already read state, with the private-computed citation corrected |
| 16 minor — ambiguous "re-invokes the prior save call" Undo wording | §4.2 now reads "saves the pre-change value back through the same `state.saveSettings(...)` path", removing the no-op reading |
| 17 minor — `clearKey()` cited for credential-delete confirm is a different (scope-override) concern | §4.1's delete/sign-out row now describes the confirm-then-act shape generically, names `clearKey()`/`reviewClear()` only as the *pattern* precedent with an explicit note that it clears a scope override rather than a credential, and points at §2.4 for the actual write each action needs |

## Revision log (round 2 of 2)

| Finding | How fixed |
|---|---|
| Round-1 #15, partially fixed — `state.orchestration()` falsely claimed to carry `detectedClis`/`disabledClis` | §2.2's matrix row now states plainly that `refreshOrchestration()` returns only nine scalar delegated-model/effort fields (`providers-settings-state.service.ts:642-656`, citation corrected from :641), that `detectedClis`/`disabledClis` exist only on the raw `agent:getConfig` response read privately by `AgentOrchestrationConfigComponent` (:400, :567, :344, :361, :368), and names the required planned change explicitly: extend `refreshOrchestration()`'s return to pass through both fields (no RPC/backend change, state-service shape only) |
| NEW-1 SERIOUS — matrix's named data source cannot populate its rows | Same fix as above — folded into the round-1 #15 correction since it is the same claim |
| NEW-2 SERIOUS — §2.4 vs §4.2 contradiction on the custom-endpoint verify gate | Resolved by splitting, not picking one blanket rule: base URL and models endpoint (#27) are **connection-affecting** (they change what is reached and how models are discovered, per the prototype's own README wording) and now require the existing verify-draft gate, same as a credential; help URL (#28) and pricing (#30) are **metadata-only** and save directly with no gate. §2.4's `customFieldSaved` row is split into two rows reflecting this, §4.2's two credential bullets are rewritten to state the split once instead of contradicting each other, and §2.3's `custom` row is annotated per field |
| NEW-3 minor — permission-copy citation pointed at reorder logic, not copy | §2.2's permission-popover row now states the current file has no per-CLI permission copy at all (verified by grep), redirects to the pre-#575 revision `parity-inventory.md` already cites (`AOC:350-359` etc. at `7ecdefa45^1`, reachable via `git show`), and flags any CLI added since that revision (OpenCode, Antigravity) as copy written fresh, needing the user's review |
| NEW-4 minor — false "no CDK dependency to remove" contrast | §2.5's Focus bullet is rewritten: the drawer/popover implement their own Tab-trap and keydown handling in TypeScript because a `<div>` gets nothing for free, and neither primitive had a CDK dependency to begin with — `NativeModalComponent` is simply the one overlay that gets focus handling from the browser instead of hand-written code, not a CDK removal |
| NEW-5 minor — `NativeModalComponent` mixed two open mechanisms (`[class.modal-open]` template binding + `showModal()`/`close()` effect) and misattributed `showModal()` to the existing dialog pattern that never calls it | §2.5 now states once, up front, that `confirmation-dialog.component.ts` toggles a CSS class and never calls `showModal()`/`close()`, and that `NativeModalComponent` deliberately does not copy that mechanism; the structure line drops `[class.modal-open]` entirely and visibility is driven only by `showModal()`/`close()` via `effect()` — one mechanism, stated once |
| NEW-6 minor — tier-mapping modal's "verify-required" state name contradicted its own "no verify gate" parenthetical | §2.2's tier-mapping row renames the state to "saving, error — **no verify-gate state**" with the explanation kept, removing the self-contradicting label |
