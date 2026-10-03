# Design-spec review — `TASK_2026_555/design-spec.md`

## Round 2 (re-review of the revised spec)

### Verdict

**REVISE**

| Metric | Value |
| --- | --- |
| Verdict | REVISE |
| Round-1 findings re-checked | 17 — 16 fixed, 1 partially fixed |
| New blocking issues | 0 |
| New serious issues | 2 |
| New minor issues | 4 |

The revision addressed every round-1 finding, and the fixes are honest: the persistence table's RPC claims were all verified against the actual contract and state service, and the false "already searchable" claim is gone. Two new problems remain, both localized: the matrix's named data source does not contain the fields the matrix needs, and §2.4 contradicts §4.2 on the verify gate for custom endpoint fields.

### (a) Round-1 findings — status

| # | Round-1 severity | Status | Spec line (revised) | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Blocking | **Fixed** | :90, :153-164, :439-440, :486-488 | §2.4 now states the component has neither capability today, with accurate line citations (provider-model-picker.component.ts:189-206, :467-472 — verified round 1), and specifies the extension: `NativeAutocompleteComponent` (exists, `libs/frontend/ui/src/lib/native/autocomplete/native-autocomplete.component.ts`), `ProviderModelInfo.supportsToolUse` (the type is imported at provider-model-picker.component.ts:63, and the field is read by the existing warning logic at :467-472). Every dependent row now says "as extended in §2.4". |
| 2 | Serious | **Fixed** (one new contradiction, see NEW-2) | :142-151 | Every RPC claim verified: `AuthSaveSettingsParams` has no clear-key field (rpc-auth.types.ts:30-38 — fields are authMethod, anthropicApiKey, providerApiKey, anthropicProviderId, applyTo), no dedicated delete RPC exists (grep of `libs/shared/src/lib/types/rpc` finds only `license:clearKey`, a different domain), `auth:copilotLogout` exists (rpc-auth.types.ts:72-78) and `performExternalAuth` only calls `auth:copilotLogin`/`auth:codexLogin` (providers-settings-state.service.ts:421-423), `provider:removeCustomEntry` exists (rpc-providers.types.ts:243-248) and `connectProvider` only calls add/update (:465-466), `ProviderTierScope` includes `'cliAgent'` (rpc-providers.types.ts:47) with only `mainAgent` wired (:499-502), `saveCursorCredential` exists (:360-363). The "needs backend method" verdict on key deletion is honest. |
| 3 | Serious | **Fixed** | :94, :347 | New `detailsRequested` output wired to `NativeCardComponent`'s `activated` with `[clickable]="true"` (native-card.component.ts:150-178, verified round 1); §4.1 cites the wiring. No contradiction remains. |
| 4 | Serious | **Fixed** | :90, :241-245 | `hasBackdrop=true` everywhere, with the real default correctly cited (native-popover.component.ts:136) and the outside-click reasoning stated. |
| 5 | Serious | **Fixed** (two new minor false claims in §2.5, see NEW-4, NEW-5) | :499-511, :166-209 | User rejected deviations 1/2; §6 records the rejection with the corrected premise (the repo's centered dialog pattern existed). The command-palette modal + wizard flow is restored with a new `NativeModalComponent`. |
| 6 | Serious | **Fixed** | :359-379 | The `123c84c25` rule is now stated, with correct code citations (providers-settings-state.service.ts:485-489 and :510-513 — both verified verbatim) and an explicit exemption list. The "same as today's `saveModel()`/`saveEffort()` flow" claim is accurate (providers-settings.component.ts:515-534 call `state.saveSettings`). |
| 7 | Serious | **Fixed** | :107, :477-482 | Cursor-only Credentials action on the matrix row, persistence via `saveCursorCredential` (verified :360-363, and ptah-cli-config.component.ts:190-194 confirms the field lives there today with no verify probe). #64 and #67 now have concrete locations. |
| 8 | Serious | **Fixed** | :104, :150 | `editInstanceRequested`/`deleteInstanceRequested` restore #50/#55. The wiring claim verified: `saveEdit()`/`removeCli()` call `state.saveSettings({cli:[…]})` (ptah-cli-config.component.ts:185-188, :201-204), which dispatches `ptahCli:update`/`ptahCli:delete` (providers-settings-state.service.ts:1004-1009). The confirm-then-act removal pattern exists (:96-100). |
| 9 | Minor | **Fixed** | :90 | "5 buttons, one per `effortLevels` entry" with the five values listed (verified round 1 at providers-settings.component.ts:288). |
| 10 | Minor | **Fixed** | :61-74 | §1.2 now has an explicit FAIL clause and per-row arithmetic for other installed-CLI counts. |
| 11 | Minor | **Fixed** | :520-523 | Deviation 4 withdraws the backwards citation and keeps the fold-budget justification. |
| 12 | Minor | **Fixed** | :524-532 | Up/down chevron buttons with `aria-label`s, no grip icon, #581 decision respected. |
| 13 | Minor | **Fixed** | :533-543, :551-554 | Contrast rule is deviation 6, pending user sign-off; §7 no longer claims it is settled. |
| 14 | Minor | **Fixed** | :314 | Both ratios now cited correctly: 5.29:1 for `anubis` at tailwind.config.js:96-98 (verified — the `--bcm` comment block) and 5.01:1 for `anubis-light` at :161, with the TASK_2026_186 deferral. |
| 15 | Minor | **Partially fixed** — the fix introduces a new false claim (NEW-1) | :104 | The revision correctly stops citing `AgentOrchestrationConfigComponent`'s private computed, but now claims `state.orchestration()` includes `detectedClis`/`disabledClis`. It does not — see NEW-1. |
| 16 | Minor | **Fixed** | :383-386 | "Saves the pre-change value back through the same `state.saveSettings(...)` path" — `saveSettings` exists (providers-settings-state.service.ts:709) and is the actual save path for model/effort (:852-876 dispatch `config:model-switch`/`config:effort-set` inside it). |
| 17 | Minor | **Fixed** | :355 | The confirm-then-act shape is described generically, `clearKey()` is named only as the pattern precedent with the scope-override caveat, and §2.4 carries the actual writes. |

### (b) New problems introduced by the revision

#### NEW-1. SERIOUS — §2.2 claims `state.orchestration()` includes `detectedClis`/`disabledClis`; the view returns neither field

- Spec line: design-spec.md:104 — "reads both system-CLI and Ptah-instance rows from `ProvidersSettingsStateService`: `state.orchestration()` (system-CLI config incl. `detectedClis`/`disabledClis`, `refreshOrchestration()` already exists, `providers-settings-state.service.ts:641`)"
- Evidence: `refreshOrchestration()` returns exactly nine scalar fields — `codexModel`, `copilotModel`, `cursorModel`, `antigravityModel`, `opencodeModel`, `piModel` and three reasoning efforts (providers-settings-state.service.ts:642-656). No `detectedClis`, no `disabledClis`. Those fields exist only on the raw `agent:getConfig` response, which `AgentOrchestrationConfigComponent` reads through its own injected `ClaudeRpcService` into its own private signal (agent-orchestration-config.component.ts:332, :337, :344, :361) — the exact private data the revision says it is avoiding. (Also: the cited line :641 is off by one — the method is at :642.)
- Impact: the matrix is the central new component of §2.2, and its named data source cannot populate its installed/uninstalled rows. An implementer follows the spec, reads `state.orchestration()`, and finds no CLI list — the same dead-end class as round-1 finding 2.
- Fix: the fix is small and the spec should say it: extend `refreshOrchestration()`'s return to pass through `config.detectedClis`/`config.disabledClis` (the RPC already returns them — `AgentOrchestrationConfigComponent` proves it), and correct the line citation. One sentence in §2.2 naming this extension as new work closes the finding.

#### NEW-2. SERIOUS — §2.4 and §4.2 contradict each other on whether custom endpoint fields require a connection check

- Spec lines: design-spec.md:147 (§2.4 `customFieldSaved` row) vs design-spec.md:376-379 and :387-390 (§4.2)
- Evidence: §2.4 says `updateCustomEntryFields` calls `provider:updateCustomEntry` directly "without re-running the verify-draft gate — these fields do not affect connectivity, so gating them behind a fresh connection probe is not required". §4.2 says the opposite twice: "Credentials (API key add/replace/delete, **custom endpoint fields**, sign-out) … require a passing connection check before the value is even persisted" (:376-379) and "Credentials (API key add/replace, **custom endpoint fields**): unchanged existing rule — a passing `Check connection` / verify-draft probe is required before the value is persisted" (:387-390).
- Impact: an implementer cannot resolve which rule applies to editing an existing custom connection's endpoint, help URL or pricing. Also, the §2.4 premise "these fields do not affect connectivity" is itself doubtful for the models endpoint (#27), which the prototype's README describes as "used for capability detection and model discovery" — changing it changes where models are fetched from.
- Fix: pick one rule and state it once. If the no-probe rule wins for non-auth metadata, §4.2 must carve out endpoint/help-URL/pricing explicitly, and §2.4 should acknowledge that the models endpoint alters discovery behavior even if it does not alter the stored credential. If the probe rule wins, §2.4's row must require the gate.

#### NEW-3. MINOR — §2.2's permission-copy citation points at code that is not permission copy

- Spec line: design-spec.md:106 — "content sourced from the old `agent-orchestration-config.component.ts` copy at `AOC:350-359` etc., not invented"
- Evidence: AOC:350-373 is the `orderedAgents` computed (agent-orchestration-config.component.ts:350-373). A grep of the current file for "Full auto", "auto-approve", "Sandboxed" and "permission" finds only the Copilot auto-approve toggle (:278-290, :466-564) — no per-CLI permission-note copy. #70 is a missing capability; its copy last existed in the pre-redesign UI, which is not the current file.
- Impact: a developer sent to AOC:350-359 finds reorder logic, not copy, and the "not invented" safeguard fails.
- Fix: cite the actual source — a commit hash or the old file path in git history — or state that the copy is written fresh and requires user review of the wording.

#### NEW-4. MINOR — §2.5's "unlike the drawer/popover" CDK claim is false

- Spec line: design-spec.md:195-196 — "there is no CDK dependency to remove here, unlike the drawer/popover"
- Evidence: a grep for `@angular/cdk` across `libs/frontend/ui/src/lib/native` returns zero matches. The drawer implements its own Tab trap (native-drawer.component.ts:253-255, :266+) and the popover its own keydown handling; neither has a CDK dependency to remove.
- Impact: a false contrast that misdescribes sibling primitives — the same claim class this review exists to catch.
- Fix: delete the parenthetical, or reword to "the drawer/popover implement their own focus handling; `<dialog>.showModal()` provides it natively".

#### NEW-5. MINOR — §2.5 attributes `showModal()`/`close()` to the existing dialog pattern, which never calls them, and mixes two open mechanisms

- Spec lines: design-spec.md:175-176 ("built on the same native `<dialog>` element and the same `showModal()`/`close()` browser API") and :189-196 (structure line `<dialog class="modal" [class.modal-open]="isOpen()">` + effect calling `showModal()`/`close()`)
- Evidence: `ConfirmationDialogComponent` never calls `showModal()` or `close()`; it toggles `[class.modal-open]` (confirmation-dialog.component.ts:21). The class-toggle exists precisely because that component does not use the browser API. The spec's structure line copies the class-toggle while the Focus bullet adds an `effect()` with `showModal()`/`close()` — two mechanisms for one job. The backdrop-form citation (:57-59) is accurate; the API attribution is not.
- Impact: the two mechanisms are redundant rather than broken, but an implementer who ships only the class-toggle (following the existing pattern the spec points at) loses the promised focus trap, Esc-cancel behaviour and focus restore — the whole accessibility claim of §2.5 rests on `showModal()` being called.
- Fix: state one mechanism: `showModal()`/`close()` via `effect()` (recommended — it delivers the focus trap), and drop the `[class.modal-open]` binding from the structure template. Keep the `modal-backdrop` form pattern as cited.

#### NEW-6. MINOR — the tier-mapping modal's state is named "verify-required" while the same cell says there is no verify gate

- Spec line: design-spec.md:109 — "States: saving, verify-required (tier changes are model, not credential, edits — save on selection per §4.2, no verify gate)"
- Evidence: the state label contradicts its own parenthetical. §4.2 correctly places tier changes under save-on-selection with no verify gate; the label will be read as a requirement.
- Impact: minor confusion; a test written against the state name would assert the wrong behaviour.
- Fix: rename the state (e.g. "saving, saved-toast" or just "saving, error") and delete the "verify-required" label.

### Checks performed with no findings

- §2.4's every RPC-contract claim was opened and verified (see the finding-2 row above for the full list). The `disconnectCopilot` proposal's "refresh exactly as `performExternalAuth` already does after a login" matches providers-settings-state.service.ts:436.
- §2.1's wizard claim verified: `deepLinkProviderId` pre-applies the selection "without displaying the step" (provider-setup-wizard.component.ts:1895-1908), so the modal → wizard hand-off does not double-render the catalog step. `openWizard` exists (providers-settings.component.ts:447).
- §2.3's `connectionKind` derivation is real: `ProvidersConnection` carries `authMode` ('cli' | 'oauth' | 'local-proxy' | 'local-native' | 'apiKey') plus a `custom` flag and `id === 'anthropic'` (providers-settings-state.service.ts:386-395) — every kind in the table is derivable from those inputs.
- §2.5's Esc citation (native-drawer.component.ts:243-255) and the `NativeAutocompleteComponent` existence claim both verified.

### Verdict rationale and what approval needs

The revision is a genuine fix pass, not a cosmetic one: the round-1 blocking claim is replaced by an honest extension plan, the persistence table's contract facts all check out, and the user decisions (modal flow kept, chevrons, contrast rule as deviation 6) are recorded with corrected premises. The verdict is REVISE only because NEW-1 leaves the matrix's primary data source unusable as specified and NEW-2 is a direct internal contradiction on a save rule — both are one-sentence fixes. Fix those two plus the four minor items and the spec is approvable without another full round.

---

# Round 1 (superseded by Round 2 above where corrected)

## Verdict

**REVISE**

| Metric | Value |
| --- | --- |
| Verdict | REVISE |
| Blocking findings | 1 |
| Serious findings | 7 |
| Minor findings | 8 |
| Files reviewed | design-spec.md; task.md; parity-inventory.md; investigation/synthesis.md; prototypes/final/{index.html, orchestration.html, README.md}; libs/frontend/chat settings components; libs/frontend/ui native primitives; providers-settings-state.service.ts; tailwind.config.js |

## Review questions answered

1. **All 17 restored capabilities + Regressed UX located?** All 17 capabilities (#7, #8, #12, #25, #27, #28, #30, #34, #38, #43, #44, #47, #49, #53, #54, #70, #71) have a row in the spec's capability map (design-spec.md:293-312), and #21 is correctly recorded as dropped per the user decision (design-spec.md:312; task.md:67). Of the 13 Regressed UX items, 11 have concrete structural fixes; item 10 is incomplete (#64/#67 have no real location — finding 7) and item 13 is correctly declared out of scope per the Gate-1.7 decision (task.md:74-75). The two blocking/serious defects below mean two of the "restored" capabilities are not actually restored by the spec as written.
2. **False component/claim check.** One blocking false claim (finding 1) and four lesser false claims (findings 3, 4, 5, 15). Everything else the spec names was verified to exist with the stated API: `NativePopoverComponent` (`isOpen`/`placement`/`hasBackdrop`/`closed`, `handleHostKeyDown`, trigger/content slots — native-popover.component.ts:116-154, 228-234), `NativeDrawerComponent` (side default `right`, `[drawer-header]`/`[drawer-footer]`, focus trap, Esc, backdrop — native-drawer.component.ts:175-205, 258-302), `NativeTabGroupComponent` (`tabs`, `activeId`, per-tab `disabled`, roving tabindex — native-tab-group.component.ts:136-166, 205-235), `NativeCardComponent` (`density="compact"`, tones incl. `neutral`/`secondary`/`warning`/`error`, `clickable` — native-card.component.ts:56-94, 150-178), `ProviderMarkComponent`, `ProviderSetupWizardComponent` (is a `NativeDrawerComponent`, provider-setup-wizard.component.ts:45, 309; first step is a searchable catalog, :449-498; `ProviderWizardTierMappings`, :106), `SettingScopeRowComponent` inputs/outputs (setting-scope-row.component.ts:155-209), `ProviderConsumerAssignmentsComponent` (`makeRow`, :100; `disabled`/`initialEditingConsumerId`/`setupProviderRequested`/`assignmentSaved`/`timeoutSaved`, providers-settings.component.ts:207-208), `effortLevels`, `FIELD`/`CONTROL` (providers-settings.component.ts:27-28, 288), `openWizard` (:447), `moveAgentUp`/`moveAgentDown` (agent-orchestration-config.component.ts:426, 435), `beginCliCreate`/`createCli`/`delegatedOptions` (ptah-cli-config.component.ts:42, 57, 205, 209, 237), state signals `route()`/`mainSources()`/`cliAgents()`/`cliModels()` and `writeScopes`/`modelTargets`/`effortTargets` (providers-settings.component.ts:120, 328-329, 351-360), `verifyDraftConnection` (:457-463), `PS:211` ptah-cli mount (:211), `canManage` false for `anthropic` (:165), the 10 `ResolvedConnectionState` states (provider-connection-card.component.ts:52-62), `uncheckable()` (:656), and the `anubis`/`anubis-light` themes with `--bcm` (tailwind.config.js:70, 128, 159-161).
3. **§6 deviations.** #3 (per-tab footer save) and #4 (roles collapsed) are justified; #4's supporting citation is wrong (finding 11). #5 (up/down instead of drag) is justified by existing code but its grip-icon affordance contradicts parity #73 (finding 12). #1 and #2 are NOT justified by the code: the repo already has a centered daisyUI `<dialog class="modal">` pattern (confirmation-dialog.component.ts:21), so "no modal primitive exists" is overstated, and the command-palette modal was an explicit part of the user-approved save model (task.md:70). See finding 5.
4. **Fold budget.** §1.1 is a measurable pass/fail line for the Providers tab (design-spec.md:35-42, explicit PASS and FAIL conditions). §1.2 states a 660 px line but no explicit FAIL clause, and it is defined only for exactly 5 installed + 2 uninstalled CLIs (finding 10).
5. **Save model.** Popover save-on-selection with toast + Undo and credentials verify-then-save are both specified (design-spec.md:250-259). But the spec never states the 123c84c25 running-session rule, and the code it relies on contradicts the rule's blanket form for main-agent tier saves (finding 6).
6. **Contradictions / vague rules / lane-introduced constraints.** Findings 1, 3, 8, 9, 14, 16. §7's "None" claim is contradicted by the spec's own text-primary/text-error rule (finding 13).

## Findings

### 1. BLOCKING — The spec claims `ProviderModelPickerComponent` "already provides search + tool-use badges"; it provides neither, so #34 and #38 are not restored by the spec as written

- Spec line: design-spec.md:81 ("existing, reused as-is, already provides search + tool-use badges — see #34/#38 in §5"), :302-303 (§5 rows #34/#38: "existing, already searchable"), :344 (item 12: "already supports search (#34)")
- Evidence: provider-model-picker.component.ts:189-206 — the model control is a native `<select>` over `modelOptions()`; there is no search input anywhere in the component. Tool-use handling is a single conditional warning shown only when the consumer sets `requiresToolUse` and the selected model reports `supportsToolUse: false` (provider-model-picker.component.ts:321, 467-472) — there are no tool-use badges, no per-model icons and no "N models · M support tool use" summary. parity-inventory.md:169-170 records exactly this (#34 "**no** — PICK:187-206 (native `<select>`, no search)"; #38 "**no** — PICK:467-471 warns only when `requiresToolUse` is set").
- Impact: #34 and #38 are two of the 17 capabilities this task exists to restore, and the strongest candidates per parity-inventory.md:180. Implemented as specified ("reused as-is"), both remain missing, failing the task's acceptance criterion "no capability that is missing without the user's approval" (task.md:52).
- Fix: the spec must add explicit new work: extend `ProviderModelPickerComponent` (or add a searchable autocomplete variant — `NativeAutocompleteComponent` exists in libs/frontend/ui/src/lib/native/autocomplete/) with model search and always-on tool-use indicators, and move #34/#38 from "Reused as-is" to "New content, reuse primitive" with the component named.

### 2. SERIOUS — The four destructive capabilities (#7, #8, #12, #25) and existing-custom-entry edits (#27, #28, #30) have drawer outputs but no persistence path; the state service exposes none of the required writes

- Spec line: design-spec.md:86 (`deleteKeyRequested`, `disconnectRequested`, `deleteConnectionRequested` outputs), :112-116 (§2.3 Credentials/Advanced tab rows), :256-259 ("reuses the existing `verifyDraftConnection` callback … it is not a new backend contract")
- Evidence: `ProvidersExternalAuthAction = 'sign-in' | 'sign-in-cancel' | 'cli-login' | 'cli-check'` — no sign-out action (providers-settings-state.service.ts:133). Grep of the state service finds no method for deleting a stored key, Copilot logout, or `provider:removeCustomEntry`; the only custom-entry writes are add/update inside `connectProvider` (providers-settings-state.service.ts:453-468), which requires a verified draft and `saveTo === 'global'` (:442-447). `verifyDraftConnection` (providers-settings.component.ts:457-463) verifies only — it never deletes. The old RPCs exist per parity-inventory.md (#7/#8 `auth:saveSettings` clear key, #12 `auth:copilotLogout`, #25 `provider:removeCustomEntry`, rows at parity-inventory.md:47-48, 52, 65).
- Impact: an implementer cannot wire "Delete stored key", "Sign out / Disconnect" or "Delete connection" from the spec; the drawer would render dead controls — the exact defect class (PR #575's dead controls) this task was filed to prevent.
- Fix: for each drawer write, name the RPC and the state-service method that will carry it (new methods wrapping `auth:saveSettings` clear-key, `auth:copilotLogout`, `provider:updateCustomEntry`, `provider:removeCustomEntry`), or explicitly declare the new backend contract in the spec instead of implying everything reuses existing ones.

### 3. SERIOUS — "Click a connection card" (§4.1) cannot be implemented with the card's "inputs/outputs unchanged" (§2.1)

- Spec line: design-spec.md:85 (card row: "inputs/outputs unchanged", "`manageRequested` now opens the new Connection Drawer"), :240 (§4.1: "Click a connection card → Connection detail drawer")
- Evidence: `ProviderConnectionCardComponent` has no whole-card click output — its outputs are per-button intents only (provider-connection-card.component.ts:544-561). The approved prototype's cards are whole-card `role="button"` triggers (prototypes/final/index.html:286, 309, 332, 355, 379: `onclick="openConnDrawer(...)"` with `onkeydown` Enter handling).
- Impact: either the §4.1 trigger is unimplementable, or the card must gain a card-level output (e.g. `NativeCardComponent`'s `activated`, native-card.component.ts:178) plus clickable wiring — contradicting "unchanged". A developer gets two contradictory instructions.
- Fix: amend the card row: keep the existing inputs/outputs, add one new `detailsRequested` output wired to the card's `NativeCardComponent` `(activated)`, and state that the card becomes `[clickable]="true"`.

### 4. SERIOUS — §3.2 states `hasBackdrop=false` is "the component's documented default for lightweight menus"; the actual default is `true`, and with no backdrop the popover has no outside-click dismissal at all

- Spec line: design-spec.md:153-154
- Evidence: `hasBackdrop = input<boolean>(true)` and `backdropClass = 'dark'` (native-popover.component.ts:136, 143). The component closes only on Esc (`handleHostKeyDown`, :228-234), on backdrop click (:219-222), or via the parent — there is no document-level outside-click handler.
- Impact: every popover built per §3.2 (scope badge, matrix cells, "Follows main agent" chips, permission info) stays open when the user clicks elsewhere in the page; the only escape is Esc. The prototype's popovers close on outside interaction.
- Fix: keep `hasBackdrop=true` for these popovers (matching the component's real default), or specify an explicit outside-click close path (host document listener + `closed` emit) as new work.

### 5. SERIOUS — Deviation #1/#2's justification "no modal primitive exists" is contradicted by the repo's existing centered daisyUI dialog pattern; the dropped command-palette modal was an explicit user-approved decision

- Spec line: design-spec.md:355-369 (§6 deviations 1 and 2), :358-359 ("add a primitive (`NativeModalComponent`) the project does not have")
- Evidence: the repo renders centered modals with daisyUI's `<dialog class="modal">` — confirmation-dialog.component.ts:21 (`<dialog #dialog class="modal" …>` with `modal-box`, `modal-action`, `modal-backdrop`). No `NativeModalComponent` exists in libs/frontend/ui (directory listing confirms), but a centered dialog is an established repo pattern, not a missing capability. The command-palette modal + wizard flow is part of the user's approved save-model decision: task.md:70 "connect flow in a command-palette modal + wizard", and the approved prototype implements it (`modalPalette`, index.html:744-748; centered `.modal-backdrop-custom` add/tier modals, orchestration.html:688, 751).
- Impact: the deviation reads as forced by a technical gap when it is a product choice; the user sign-off it asks for is being made against a false premise. Keeping the single drawer is defensible on duplication grounds, but the decision belongs to the user with accurate information.
- Fix: rewrite deviations 1-2 to (a) acknowledge the existing `<dialog class="modal">` pattern and the option to build the palette on it without a new primitive, and (b) present the single-drawer flow as the recommendation, requiring explicit user re-approval since it reverses a recorded Gate-1.7 decision. Do not justify it by "no modal primitive exists".

### 6. SERIOUS — The 123c84c25 running-session rule is never stated, and the save-on-selection path can write to the running session for the active provider

- Spec line: design-spec.md:250-263 (§4.2, the whole save section)
- Evidence: investigation/synthesis.md:56-57 records the constraint ("`123c84c25` keeps provider edits off the running session"). The spec routes main-agent tier saves through the existing `provider:setModelTier` path, whose own code comment says it "persists provider.<id>.mainAgent.modelTier.<tier> and **changes the running env only when <id> is the active provider**" (providers-settings-state.service.ts:485-489).
- Impact: a save-on-selection in the Main Agent popover for the currently active provider touches the running session. Whether that is allowed under the 123c84c25 rule is exactly the question an implementer needs answered, and the spec is silent; the acceptance criterion "No setting write changes runtime behavior without a trace in the report" (task.md:54) cannot be checked against an unstated rule.
- Fix: add a §4.2 preamble stating the 123c84c25 rule, and state explicitly whether main-agent model/tier saves on the active provider are exempt (with the trace requirement that follows) or must be deferred to next-session like credentials.

### 7. SERIOUS — Regressed-UX item 10 maps #64 (Cursor key help) and #67 (opencode format hint) to locations that do not exist in the new UI, and the Cursor API-key field has no home

- Spec line: design-spec.md:338-339 ("restored verbatim in the drawer's Credentials tab per connection kind (§2.3) and in the Add Ptah CLI instance overlay"), :112-116 (§2.3 table)
- Evidence: §2.3's connection kinds are `claude-cli`, `api-key`, `oauth`, `local`, `custom` — none covers system-CLI credentials (Cursor). The CLI matrix's declared columns are On/off, Agent/Instance, Status, Provider, Model, Effort, Permissions & Safety, Actions (design-spec.md:52-54) — no credentials cell — and the Add-instance overlay's field list is name, provider, key, Copilot login, show/hide (design-spec.md:98), which covers new Ptah CLI instances, not the delegated Cursor key. Today the Cursor key input lives in `ptah-cli-config` (NPCC:105-109 per parity-inventory.md:114) and persists via `saveCursorCredential` (providers-settings-state.service.ts:360), which this spec's matrix would replace.
- Impact: implementing the spec as written removes the delegated Cursor API key input and its help text — a regression created by the fix for a regression.
- Fix: give system-CLI credentials a concrete location (e.g. a Credentials action/popover on the Cursor matrix row, or a Credentials tab in a per-CLI popover), and place #64/#67 help copy there.

### 8. SERIOUS — The CLI matrix replaces `PtahCliConfigComponent`'s cards but does not enumerate the actions those cards own today (edit name/replace key #50, delete with confirm #55)

- Spec line: design-spec.md:95 (matrix row: outputs are only `addInstanceRequested`, `tierModalRequested`), :52-54 (column list)
- Evidence: parity-inventory.md:100 (#50 "Edit name / replace key inline … yes NPCC:87, 90-95") and :105 (#55 "Delete with a confirmation dialog … yes NPCC:96-101") are present on main today. The spec merges `PtahCliConfigComponent`'s "flat agent cards" into the matrix (design-spec.md:51) and only its Add form survives (design-spec.md:98); no row-level edit or delete output is declared.
- Impact: retiring the flat cards without declaring these actions in the matrix loses two working capabilities — again the exact defect class this task exists to fix.
- Fix: enumerate the Actions column contents per row type, adding `editRequested`/`deleteRequested` (Ptah instances) to the matrix outputs, and reference the existing `ptahCli:update`/`ptahCli:delete` paths.

## Minor findings

9. **Contradiction — "effort as 4 buttons" vs five effort levels.** design-spec.md:81 says "effort as 4 buttons (reuse `effortLevels`)", but `effortLevels` has five values `['low','medium','high','xhigh','max']` (providers-settings.component.ts:288). A developer following the "4" silently drops a level. Fix: "5 buttons, one per `effortLevels` entry".
10. **§1.2 fold budget lacks an explicit FAIL clause and a row-count rule.** design-spec.md:61-65 gives the 660 px line and a collapsed-summary requirement but, unlike §1.1 (:38-40), no FAIL condition, and the arithmetic assumes exactly 5 installed + 2 uninstalled CLIs. Fix: state the FAIL clause (e.g. "any of header, policy bar, CLI matrix header or collapsed roles summary requires scrolling at 1024×768") and what the budget is at other installed-CLI counts.
11. **Deviation #4 misquotes synthesis.** design-spec.md:379 claims synthesis's IA table "lists it under the CLI table, not above it"; investigation/synthesis.md:43 lists the model-roles table before the CLI agents table. The fold-budget argument alone justifies the deviation; the citation does not. Fix: delete or correct the citation.
12. **Deviation #5's grip icon contradicts the recorded #581 decision.** design-spec.md:386 reintroduces "a grip icon that triggers the same up/down actions" while parity-inventory.md:128 records that #581 deliberately removed the decorative grip. A grip that is not draggable misleads users, and this re-opens a settled decision. Fix: use up/down chevron buttons with `aria-label`s, not a grip.
13. **The text-primary/text-error rule is an unlisted deviation and a lane-introduced constraint; §7's "None" is inaccurate.** The approved prototype uses `text-primary` for matrix cell text (orchestration.html:206, 293) and status text; the spec replaces it everywhere (design-spec.md:216-226) while §6 claims "These are the only points where this spec does not literally reproduce prototypes/final/" (:352-353) and §7 claims no lane-introduced constraints (:392-399). The measurement itself is honest — `#2563eb` on `#131317` recomputes to ≈3.6:1, failing 4.5:1 — but WCAG AA 4.5:1 for these elements is not a rule in the brief/decisions; it is this document's own addition. Fix: move the rule into §6 for user sign-off, and correct §7.
14. **§3.6 citation imprecision.** design-spec.md:209 says base-content-muted is "5.29:1 (documented in tailwind.config.js)"; the config documents 5.01:1 for `anubis-light` (tailwind.config.js:159-161) and defers the per-theme ratio table to TASK_2026_186 (tailwind.config.js:21-22). Fix: cite both numbers to their actual sources.
15. **§2.2 data-source description is wrong in kind.** design-spec.md:95 says the matrix "reads system-CLI rows from `AgentOrchestrationConfigComponent`'s existing `detectedClis`/`disabledClis` signals" — these are fields of the `agentConfig` data and derived Sets inside AOC's private computed (agent-orchestration-config.component.ts:344, 361), not public signals a sibling can read. Fix: the matrix reads `state.orchestration()` via `ProvidersSettingsStateService` (refreshOrchestration exists, providers-settings-state.service.ts:642), same as the Ptah-instance rows.
16. **Undo wording is ambiguous.** design-spec.md:253-255: "re-invokes the prior save call" could mean re-applying the same value (a no-op). The intent is to save the *previous* value back through `state.saveSettings`. Fix wording.
17. **`clearKey()` cited as the delete-confirmation pattern is a different concern.** design-spec.md:247 says the drawer's delete confirm "reuses `ProvidersSettingsComponent`'s existing `clearKey()`/confirm-then-act pattern"; `clearKey` there reviews clearing a scope *override* (providers-settings.component.ts:193-204, 558-565), not a stored credential. The confirm-then-act shape is real; the named function will not guide the implementer to the right write. Fix: reference the pattern generically and pair it with the persistence path from finding 2.

## Checks performed with no findings

- §3.6 contrast arithmetic spot-checked: `#2563eb` vs `#131317` ≈ 3.6:1 and `#16a34a` vs `#131317` ≈ 5.6:1 both recompute correctly; the graphical-vs-text threshold reasoning is sound.
- Deviation #3 (per-tab footer actions instead of one "Save Changes") is justified: the prototype's footer save is index.html:734, and the spec's verify-then-save vs save-on-selection conflict (§4.2) makes a single button incoherent.
- The per-connection drawer table (§2.3) does fix the prototype's known defect the task decision named (task.md:66), and hides non-applicable tabs rather than disabling them, consistent with `NativeTabGroupComponent`'s `tabs()` input being computable (native-tab-group.component.ts:136).
- §1.1's Providers fold budget is measurable (explicit PASS/FAIL, grid rule `sm:grid-cols-2 lg:grid-cols-3`, :35-42) and correctly refuses to accept the prototype's own arithmetic.
- `ProviderSetupWizardComponent` claim verified: it already renders inside `NativeDrawerComponent` (provider-setup-wizard.component.ts:45, 309) with a searchable first-step catalog (:449-498), so §2.1's reuse claim about the wizard is accurate.

## What a 10/10 version would do differently

- Name the persistence path (RPC + state-service method) for every write the new UI introduces, instead of outputs alone.
- Correct or remove every "already provides" claim by opening the cited component first.
- List the text-primary rule as deviation 6 with user sign-off, and make §6's "only points" claim true.
- State the 123c84c25 rule and the active-provider exception in §4.2.
- Give §1.2 the same explicit FAIL clause as §1.1.