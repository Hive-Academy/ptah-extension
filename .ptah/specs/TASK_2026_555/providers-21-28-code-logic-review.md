# Code Logic Review — Providers tab, Batches 21-28 (`TASK_2026_555`)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Minor issues        | 2        |
| Failure modes found | 3        |

Scope reviewed: the committed diff `36384ace1..HEAD` (Batches 21-27b) plus the uncommitted Batch 28 working-tree changes, production code only — `providers-settings.component.ts`, `routing-map.component.ts`, `routing-map-node.component.ts`, `main-agent-reassign-popover.component.ts`, `provider-catalog-modal.component.ts`, `provider-connection-card*.ts`, `setting-scope-row.component.ts`, `app-scope-label.ts`, the four connection-drawer tabs, `drawer-write.ts`, `settings-save-feedback.service.ts`, and the core write-path services `providers-commit.service.ts`, `providers-settings-state.service.ts`, `providers-connection-setup.service.ts`. Specs and the e2e harness were read to confirm that claimed behaviour is really asserted. Accepted carry-forwards listed in `batches.md` and the Batch 28 report deviations are not re-flagged. The Electron fold failure (Q-extra-1) is an escalated visual-budget decision with two red-on-purpose tests, not a logic defect, and is not counted here.

The verdict line: **APPROVED, 8/10.**

## Five logic questions

### 1. How does this fail silently?

The one real case is Finding M1: while `mainSources` is not `ready`, the Main Agent popover's "Save to" falls back to `'global'` and the model and effort saves stay enabled, so a write can land in the Global store while the user's effective value comes from a workspace or app override. D15 catches the mismatch after the write (`config:model-get` read-back, `providers-commit.service.ts:92-93`), so the user sees "Not saved: Main agent model" — but the global store was still mutated by a save the UI reported as not saved. Everything else examined fails loudly: every write path routes through `ProvidersCommitService.run` (`providers-commit.service.ts:300-374`), which refuses while saving, re-checks the edit context before and after each write and each read-back, and never promotes a failed write to `saved`.

### 2. What user action produces unexpected behaviour?

- Clicking Undo while another save is in flight: the toast is dismissed first (`settings-save-feedback.service.ts:103`), then `save()` refuses (`:59-62`), so the Undo request is gone and the previous value is not restored (Finding m1).
- Typing a filter, then adding a connection through the catalog → wizard: the new connection does not match the filter text and stays hidden until the user clears the filter (Finding m2). The filter input still shows the text, so the state is visible, but nothing resets it on reload.
- Opening the Main Agent popover during the page's first reads (or after a failed sources read) and changing the model: the Save-to select shows "Global" as a fallback rather than the actual source scope (Finding M1).

### 3. What input data makes this produce a wrong answer rather than an error?

- A wrong or missing effort value is not possible from the popover buttons (fixed `efforts` list, `main-agent-reassign-popover.component.ts:136-138`).
- Custom connection drafts are validated before any write: `CustomProviderEntryInputSchema` (`providers-connection-setup.service.ts:156-163`) and the endpoint schemas (`:345`, `:369`), with `block()` fixed copy, never raw schema text.
- Host data shapes are guarded: `refreshCliModels` throws on a malformed store entry rather than rendering it (`providers-settings-state.service.ts:436-458`); `cliInstanceTiersOperation` treats a missing instance as not saved (`providers-commit.service.ts:284-285`); routing-map previews null-safe-read host lists (`routing-map.component.ts` `backgroundRolesPreview` / `cliAgentsPreview`, `detectedClis ?? []`, `preferredAgentOrder ?? []`).
- No case was found where malformed input yields a silent wrong answer. Invalid inputs produce `blocked` commits with fixed copy.

### 4. What happens when a dependency fails?

- A thrown RPC is caught in `settle` and reported as `unconfirmed` ("Not confirmed"), never as saved, and the error object is discarded before it can enter UI state (`providers-commit.service.ts:387-393`, comment at `:390`: RPC errors may contain credentials). `commit.message` is only ever the fixed conflict/refresh strings (`:366-371`) or caller-supplied fixed copy — no raw RPC text reaches the UI.
- The post-save refresh always runs, even after a rejection (`:346-347`), and a failed refresh surfaces as `refreshFailed` with "Some settings could not be refreshed. Retry those sections." (`:370`).
- Per-region read failures show their own "Retry {label}" wired to that section's refresh method only (`providers-settings.component.ts` `mainReadErrors` / `retryControl`; routing-map `retryBackground()` re-reads only the failed sections). The catalog error path shows "Custom providers could not be loaded. Your saved settings have not changed." with Retry → `refreshConnections()` (`provider-catalog-modal.component.ts`, `provider-catalog-error`).
- Probe and sign-in generations are guarded: a superseded `auth:verifyDraftConnection` result throws before it can publish (`providers-connection-setup.service.ts:273-277`), and a failed cancel cannot publish a stale result (`:296-303`).

### 5. What is missing that the requirements never mentioned?

- No gate on the popover model/effort saves while the source scopes are unknown (M1) — the requirements pin D15 (no false "Saved") but do not state what the Save-to default must be while the sources are still loading or in error.
- The effort "default" option sends `effort: undefined` (`main-agent-reassign-popover.component.ts:368`), which serialises to an absent field; the host's `config:effort-set` clear semantics could not be verified from the webview side (see Residual uncertainty).
- Both `test.fixme` scenes were judged justified: the `main-model` deep link's only in-app trigger lives on the Setup Wizard's separate webview surface (`apps/ptah-extension-webview/src/app/app.routes.ts:45,80`) which the settings harness does not boot, and the behaviour is unit-covered (`settings.component.spec.ts:170`, `providers-settings.component.spec.ts:428`); the popover model search is the accepted Batch 26 carry-forward (plain `<select>`, compact picker flagged for the ui owner). Neither hides a defect.

## Failure modes

### M1 — Model/effort save can write to Global while the real scope is unknown

- Trigger: The user opens the Main Agent popover while `mainSources` is still loading, or after its read failed ("Retry model and effort sources" is shown under the map). `targets()` returns `[]` (`main-agent-reassign-popover.component.ts:209-214`) and `target()` falls back to `'global'` (`:215-220`). The model select and effort buttons are gated only on `busy()` (`:262`, `:353-354`, `:363-365`), not on `targets()` being non-empty.
- Symptom: The Save-to select shows "Global". A model change is written with `applyTo: 'global'` (`saveModel`, `:352-361`). If the effective value comes from a workspace or app override, the read-back (`config:model-get`) mismatches and the toast says "Not saved: Main agent model" — but the Global store value was still changed by a save the UI reported as failed.
- Evidence: `main-agent-reassign-popover.component.ts:209-220`, `:352-361`, `:363-372`; read-back at `providers-commit.service.ts:92-93`.
- Current handling: D15 catches the effective-value mismatch, so the user is told the save did not take effect. The out-of-scope Global mutation is not mentioned.
- Recommendation: Disable the model select and effort buttons (or the whole "save" region) while `targets()` is empty, the same way `activate()` refuses when `pending.writable` is false (`:315-317`). At minimum, keep the Save-to control in a disabled/unknown state until the source scope is known.

### m1 — Undo is lost when another save is in flight

- Trigger: The user clicks Undo on the toast while another save is running (the previous toast is not cleared when a new save starts, so the Undo button stays clickable during the in-flight save).
- Symptom: `undo()` calls `this.dismiss()` before `save()` (`settings-save-feedback.service.ts:103-104`). `save()` refuses while `saving()` (`:59-62`) and shows "Another change is still saving." — but the dismiss already destroyed the undo request, so the previous value is never restored and the Undo option is gone.
- Evidence: `settings-save-feedback.service.ts:100-105`, `:59-62`, `:113-118`.
- Current handling: The user sees the refusal alert and can restore the value manually.
- Recommendation: In `undo()`, run `save(request)` first and dismiss only when the request was accepted or the refusal was shown; or capture the request locally and re-show the toast with Undo if the undo write was refused.

### m2 — The connections filter is not reset when connections reload

- Trigger: The user types a filter (e.g. "moon"), then adds a connection whose name/id does not match it (catalog → wizard, or a sign-in that completes in the background via `performExternalAuth` → `refreshConnections`).
- Symptom: The new connection does not appear in the grid because `shownConnections` still applies the old filter text (`providers-settings.component.ts:374-377`). The empty state ("No connections match") appears only when the filtered list is empty (`:135-138`), so with other matches the new connection is silently absent.
- Evidence: `providers-settings.component.ts:373-377`, `:135-138`.
- Current handling: The filter input still shows the text, so the cause is visible to an attentive user.
- Recommendation: Reset the filter when a save that changes the connection list completes, or clear it when the list of connection ids grows.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

1. M1 — Popover model/effort save falls back to Global while source scopes are unknown (`main-agent-reassign-popover.component.ts:209-220`, `:352-372`). Moderate.
2. m1 — Undo request destroyed before the refusal is known (`settings-save-feedback.service.ts:100-105`). Minor.
3. m2 — Filter not reset on connections reload (`providers-settings.component.ts:373-377`). Minor.

## Write-path trace

Control → state method → RPC → store → runtime reader. "OK" = traced end to end and correct.

| # | Control (UI) | State method | RPC write (read-back) | Store key / scope | Runtime reader | Status |
| - | ------------ | ------------ | --------------------- | ---------------- | ------------- | ------ |
| 1 | Popover model select / manual field | `saveSettings({model})` → `commits.operations` model op (`providers-commit.service.ts:84-95`) | `config:model-switch` (`config:model-get`) | `provider.<authKey>.selectedModel` at `applyTo` | Main-agent model resolution | OK, except the M1 scope fallback |
| 2 | Popover effort buttons | `saveSettings({effort})` (`providers-commit.service.ts:97-108`) | `config:effort-set` (`config:effort-get`) | `provider.<authKey>.reasoningEffort` | Main-agent effort resolution | OK; `undefined` clear semantics unverified host-side |
| 3 | Popover provider change (D6 confirm → "Use for main agent") | `activateConnection` → `setup.activateConnection` (`providers-connection-setup.service.ts:229-244`) → `commits.operations({auth})` (`providers-commit.service.ts:74-83`) | `auth:saveSettings` (`authMethod`, optional `anthropicProviderId`, `applyTo`) | `authMethod` / `anthropicProviderId` at `applyTo` | `auth:getEffectiveRoute` driver selection | OK; no write on Cancel (`resetProvider`, popover `:308-312`) |
| 4 | Popover rescope offer ("Save to" ≠ provider source) | same as #3 with the same provider id | `auth:saveSettings` | same keys at the new scope | effective route + scope resolution | OK |
| 5 | Drawer Models & Tiers save | `setMainAgentTier` → `commits.mainAgentTierOperation` (`providers-commit.service.ts:254-264`) | `provider:setModelTier` / `provider:clearModelTier` (`provider:getModelTiers` scope `mainAgent`) | `provider.<id>.mainAgent.modelTier.<tier>` | main-agent tier resolution | OK; Undo writes the previous tier through the same method |
| 6 | D16 badge "Clear override" (page `clearOverride`, saved-gated) | `clearScopeOverride` (`providers-settings-state.service.ts:600-642`) | `config:clearScopeOverride` (`config:getScopes` re-read) | the scoped key at `nearest`/`global` | scope resolution | OK; `hasOverride` gate at `:640` |
| 7 | Drawer Credentials replace key (verify → save) | `connectProvider` → `setup.connectProvider` (`providers-connection-setup.service.ts:139-223`) | staged: `provider:add/updateCustomEntry`, `auth:setApiKey`, `llm:setProviderBaseUrl`, tier ops, then activation `auth:saveSettings` | custom entry, stored key, base URL, tiers, auth keys | connection catalogue + route | OK; activation last (`:212-220`); tier writes compare-and-set (`:198-205`) |
| 8 | Drawer Credentials delete key | `deleteStoredKey` (`providers-connection-setup.service.ts:307-314`) | `auth:deleteStoredKey` (`auth:getApiKeyStatus` / `auth:getAuthStatus`) | stored key only; no auth-method change (D4) | key status | OK |
| 9 | Drawer Credentials Copilot sign-out | `disconnectCopilot` (`:316-321`) | `auth:copilotLogout` (`auth:getAuthStatus`) | Copilot token | sign-in state | OK |
| 10 | Drawer Advanced base URL / models endpoint | `updateCustomEntryEndpoint` (`:366-389`) | `provider:updateCustomEntry` (`provider:listCustomEntries`) | custom entry endpoint | endpoint use | OK; D7 `verifiedFor(probeId)` gate (`:372-375`, `:406-410`) |
| 11 | Drawer Advanced local base URL | `updateLocalBaseUrl` (`:392-403`) | `llm:setProviderBaseUrl` (`llm:getProviderBaseUrl`) | local server endpoint | endpoint use | OK |
| 12 | Drawer Advanced help URL / pricing | `updateCustomEntryFields` (`:342-360`) | `provider:updateCustomEntry` (`provider:listCustomEntries`) | custom entry metadata | catalogue card | OK |
| 13 | Drawer Advanced delete connection | `removeCustomEntry` (`:324-339`) | `provider:removeCustomEntry` (`provider:listCustomEntries`) | custom entry | route + catalogue | OK; refused while the entry drives the route (`:331-334`) and while the route is not ready (`:327-330`) |
| 14 | Catalog "Connect" → wizard commit | page `commitWizard` → `state.connectProvider` | same as #7 | same as #7 | same as #7 | OK; silent return on missing/stale context and non-`saved` commit (`providers-settings.component.ts:533-542`) |
| 15 | Cursor credential (orchestration surface) | `saveCursorCredential` (`providers-settings-state.service.ts:263-268`) | `agent:setConfig {cursorApiKey}` (`agent:getConfig.cursorApiKeyStored`) | stored secret | CLI use | OK; read-back checks the store alone (TASK_2026_551) |

## What was checked and found correct

- **D15 end to end.** `settle` runs read-back only for an acknowledged write in a matching context; a `false`/`'conflict'` write is never read back, and a thrown write is `unconfirmed` (`providers-commit.service.ts:381-407`). `commit()` is read by the UI only after its own call resolved `true` (`settings-save-feedback.service.ts:65-96`; drawer tabs via `runDrawerWrite`). No path shows "Saved" after a refused or failed write.
- **D6 provider change.** Confirm copy includes "ends running chat sessions" for both change and re-save cases (`main-agent-reassign-popover.component.ts:236-237`); `activate()` writes only after confirm, and Cancel (`resetProvider`) performs no write and keeps focus inside the popover.
- **Undo correctness.** Model and effort Undo requests write the previous value through the same state method at the same scope (`:352-372`); tier Undo likewise (`models-tiers-tab.component.ts:142-153`); provider change deliberately offers no Undo.
- **One save at a time (D3).** `run` refuses while `saving` and the refusal is synchronous up to the first `await` (`providers-commit.service.ts:306-307`); every setup method re-checks before `block()` so a blocked result can never overwrite an in-flight save's feedback (`providers-connection-setup.service.ts:145,235,325,344,368,394`); save triggers disable on `busy()`.
- **Stale state and races.** Drawer sessions are bumped on open and close, so a late outcome from a closed or reopened drawer is dropped (`providers-settings.component.ts:483-487`, `:503-506`); probe, sign-in and catalogue requests carry generation guards (`providers-connection-setup.service.ts:98,260-267`, popover `loadModels` `:292-302`); `refreshTiers` clears the store before a different provider loads (`providers-settings-state.service.ts:509-526`); tier writes are compare-and-set against the wizard snapshot so a concurrent edit from another window reports a conflict instead of overwriting (`providers-connection-setup.service.ts:198-205`); `activeProviderId` is `null` while a save runs, so the active badge cannot go stale mid-save (`providers-settings-state.service.ts:135-150`).
- **Error copy and secrets.** No raw RPC error text, host probe `detail`, or thrown error object enters UI state anywhere in the reviewed files (`providers-commit.service.ts:389-392`, `providers-connection-setup.service.ts:296-303`, credentials-tab fixed `PROBE_FAILURE_COPY`, `testCliConnection` keeps only a sanitized `reason`). The typed key stays in `keyDraft`, cleared on save, cancel, connection change and destroy, with the host probe cancelled on abandon. No `[innerHTML]` on any reviewed template. No key hint is sent across RPC (accepted Batch 21 decision).
- **Per-region Retry.** Each read error region retries only its own section (`retryControl` in `providers-settings.component.ts`; `retryBackground()` in `routing-map.component.ts` re-reads only failed sections); the route error and its Retry stay in the Main Agent node; `catalogHint` never claims "0 providers" on error or loading.
- **Stacking fix (Batch 27b deviation 6).** `has-[.popover-panel]:z-30` lifts the node that holds an open popover above sibling `z-10` badge groups (`routing-map-node.component.ts:32-34`), asserted by `assertPopoverOnTop` via `elementFromPoint` in both hosts and themes.
- **Batch 21 findings stay fixed.** External-auth feedback in the drawer (`externalAuth` input, `externalBusy()` disabling Check again / Open login, fixed error copy); `isActiveDriver` no longer flips while saving (the `knownDriverId` signal plus the `activeProviderId` saving guard); `runDrawerWrite` rejects are caught and published as broken; replace-draft tiers no longer default to `''` after a failed setup read (`setupMissing`).
- **Harness claims are real.** The Batch 28 scenes assert what the report says they assert: the delete-key scene expects `auth:deleteStoredKey { providerId: 'moonshot' }`, the Copilot scene expects `auth:copilotLogout`, the popover undo scene expects a second `config:model-switch` with the previous model, and the D6 scene asserts no `auth:saveSettings` on Cancel. `EXPECTED_CAPABILITY_COUNT` is 91 with the three routing-map entries spread in.

## Data flow

Model save (representative of all 15 traced writes): select change → `saveModel` (captures `previous` before the write) → `feedback.save` → `state.saveSettings` → `commits.operations` builds the operation (params copied, never retained) → `run`: refuse-if-saving → `refreshScopes` → context match → `config:model-switch` → context match → `config:model-get` read-back → outcome → `hooks.refresh()` (all sections) → context match (else saved demoted to unconfirmed) → `commit()` set → toast with Undo writes `previous` through the identical path. Each step is annotated OK except the M1 scope choice at the entry point.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| D15 — never "Saved" after failure/refused write | COMPLETE | — |
| D6 — confirm before provider change, no write on Cancel | COMPLETE | — |
| D2 — save on selection with Undo through the same state method | COMPLETE | m1: Undo can be lost to an in-flight refusal |
| D3 — busy disables triggers, one save at a time | COMPLETE | — |
| Scope Save-to with host-correct labels (27b) | PARTIAL | M1: fallback to Global while targets unknown |
| Per-region read errors with real per-region Retry | COMPLETE | — |
| Secrets never cross to the webview or RPC text | COMPLETE | — |
| Catalog error path without misleading counts | COMPLETE | — |
| Batch 27b stacking fix | COMPLETE | asserted in both hosts |

Implicit requirements not addressed: a defined Save-to default while the model/effort sources are unknown (M1); filter lifecycle across connection-list changes (m2).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Drawer closed while a write is in flight | YES | Session bump drops the late outcome | — |
| Popover reopened while a previous save settles | YES | `session` guard on the outcome (`:269`, `:316-323`) | — |
| Overlapping probe / sign-in requests | YES | Generation counters | — |
| No workspace open | YES | `writeScopes` drops the workspace target; commit blocked on workspace applyTo | The removed "No workspace open" sentence is a flagged deviation, not re-flagged |
| Host RPC throws mid-save | YES | `settle` → `unconfirmed`; refresh still runs | — |
| Custom entry removed from another window between write and read-back | YES | read-back re-lists entries | — |
| Sources not ready when the popover is used | NO | Save-to falls back to Global (M1) | Real gap |
| Undo clicked during another save | PARTIAL | Refusal alert shown, but the undo request is destroyed (m1) | Minor |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: A model or effort change can be written to the Global scope while the popover does not know the real source scope, and the resulting "Not saved" report hides that the Global store changed.
- What a robust implementation would add: (1) disable the model/effort saves while `targets()` is empty; (2) keep the Undo request alive across a refusal; (3) reset the connections filter when the connection list changes; (4) a host-side confirmation that `config:effort-set` with an absent `effort` clears the stored value (currently assumed).

## Residual uncertainty

- `config:effort-set` with an absent `effort` field (the popover "default" option) serialises to a missing key; the host's clear semantics were not verifiable from the webview side. If the host rejects the missing field, D15 converts it to "Not saved", so the failure is loud either way.
- The Electron fold failure was reviewed only as a decision record (Q-extra-1); its two red tests are intentional and out of logic scope.
- Scoped tests were not re-run for this review; the Batch 28 report's verification runs (chat 1994 passed + 2 skipped, core 1085/1085, ui 610/610, Gate G 27/27) were read as evidence, not reproduced.