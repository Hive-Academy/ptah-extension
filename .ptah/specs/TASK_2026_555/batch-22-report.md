# Batch 22 report: drawer Models & Tiers + Advanced tabs, and the Batch 21 review findings

Executor: Providers owner (in-process frontend-developer). A previous owner instance was interrupted mid-batch. This
instance took over from the working tree as it was left, and did not redo any finished work.

- Nothing was committed, and no git stash / restore / checkout / reset / clean was used.
- No `libs/frontend/ui`, `libs/frontend/core`, `libs/shared` or backend edits.
- `ProviderSetupWizardComponent` is untouched: `git diff HEAD --stat -- …/provider-setup-wizard.component.ts` is empty.
- Worktree `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign`, on top of 2cb1a107a.

Paths below are relative to `libs/frontend/chat/src/lib/settings/providers/`, unless they start with `HARNESS/`
(`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/`). Abbreviations:

| Abbreviation | Path |
|---|---|
| `CT` | `connection-drawer/credentials-tab.component.ts` |
| `MT` | `connection-drawer/models-tiers-tab.component.ts` |
| `AT` | `connection-drawer/advanced-tab.component.ts` |
| `DW` | `connection-drawer/drawer-write.ts` |
| `DD` | `connection-detail-drawer.component.ts` |
| `PS` | `providers-settings.component.ts` |

A `*spec` suffix means the matching `.spec.ts` file.

## What this instance did vs. what it found

The interrupted run had written almost everything:

- all of Part A;
- the two tabs;
- `drawer-write.ts`;
- the harness flips.

Its typecheck/test/lint and Gate G had not been run. This instance:

1. Read every changed file and checked every state method, RPC and store key the tabs use against source.
2. **Fixed a stale-address bug in the Advanced tab.**
   - The problem: after a saved base-URL change, the Credentials tab would check a replacement custom key against
     the *old* address. `connectionSetup` is read only when the drawer opens.
   - The fix: `AT:279` re-reads the connection setup after a saved base URL.
   - Specs: `AT.spec:133` (re-read) and `AT.spec:136` (a models endpoint alone does not re-read).
3. **Added a connection guard to Advanced writes.** An outcome that lands after another connection opened in the tab
   is dropped (`AT:309-314`, spec `AT.spec:230`). This matches the parent's per-session guard for the Credentials tab.
4. **Fixed a new `max-lines` lint warning in the harness.**
   - The Batch 22 entries took `settings-reachability.table.ts` to 760 counted lines, which added a new warning. At
     HEAD the file was under the limit.
   - The fix: the shared and drawer reach helpers moved unchanged into a new `HARNESS/settings-drawer.reach.ts`.
     `credentialsOf` is now `drawerTabOf(…, 'Credentials', 'connection-credentials')`, with the same assertions.
   - Harness lint is back to 41 warnings, the same as Batch 21.
5. **Fixed an intermittent hang in the visual capture spec** (below, under "Verification").

## Files

| Status | File | Lines | Role |
|---|---|---|---|
| CREATED | `connection-drawer/models-tiers-tab.component.ts` (+ spec) | 154 | Tier pickers, saved on selection with Undo |
| CREATED | `connection-drawer/advanced-tab.component.ts` (+ spec) | 336 | Custom endpoint (verified), help URL, pricing, delete |
| CREATED | `connection-drawer/drawer-write.ts` (+ spec) | 44 | `runDrawerWrite`: one drawer write, its own outcome, rejection guard |
| MODIFIED | `connection-detail-drawer.component.ts` (+ spec) | 266 | Mounts both tabs; `isDriver` input; new D14 footer matrix |
| MODIFIED | `connection-drawer/credentials-tab.component.ts` (+ spec) | 511 | Part A M1 and minor 5 |
| MODIFIED | `providers-settings.component.ts` (+ spec) | 681 | Part A M1, M2, minor 3 and minor 4; drawer z-order |
| MODIFIED | `HARNESS/settings-reachability.table.ts` | 957 raw / under 700 counted | Flips, and reaches moved off the wizard |
| CREATED | `HARNESS/settings-drawer.reach.ts` | 129 | Reach helpers extracted from the table |
| MODIFIED | `HARNESS/settings.fixtures.ts` | — | Stateful custom entries (`provider:updateCustomEntry`), `provider:listModels` catalogue |
| MODIFIED | `HARNESS/settings-visual.e2e.spec.ts` | — | Models & Tiers + Advanced captures; drawer-animation wait narrowed |

Every non-spec file is at most 700 lines, except the reachability table. That is a data table, over 700 raw lines since
Batch 16 and accepted there; its `max-lines` counted lines are now under the limit.

Notes on the files:

- `.ptah/specs/TASK_2026_555/task.md` shows as modified (the "Pattern map APPROVED" decision). That edit is not from
  this batch.
- `batch-21-code-logic-review.md` is untracked and is to be committed with this batch (batches.md Batch 22 carry-in).

## Part A: Batch 21 review findings → fix → spec

| Finding | Fix (file:line) | Spec |
|---|---|---|
| **M1**: Open login / Check again have no in-drawer in-flight or failure feedback, and are not disabled during a slow sign-in RPC | **Parent.** `PS:534` `drawerExternalAction` records which connection the drawer started a sign-in for. `PS:381` `drawerExternalAuth` maps `state.externalAuth()` to `loading` / `error` / settled message, only for that connection and only for this drawer session (`PS:529` resets it on open and close). The stale message that `retainOnError` keeps is never shown on error.<br>**Tab.** `CT:364` `externalBusy`: Open login (`CT:163`, `CT:170`) and Check again (`CT:120`) are disabled and relabelled "Waiting for sign-in…" / "Checking…". `CT:274` shows a fixed `role="alert"` "Sign-in could not be checked. Retry." | `CT.spec:307` (describe), `:310` running → disabled, `:317` failure → fixed alert, no stale message, re-enabled, `:325` Check again; `PS.spec:328` end to end through the parent |
| **M2**: `isActiveDriver` derives from `activeId()`, null while saving or when the route is not ready, so the anthropic Replace guidance is wrong exactly when the stored key is broken | `PS:380` `knownDriverId`, set at `PS:421` from every **loaded** route's `driverProviderId`, whatever `route.data.ready` says. It survives a save and a re-read. `PS:256` binds it to the drawer's new `isDriver` input (`DD`). `DD` passes it to Credentials (`isActiveDriver`, which drives the anthropic rule and the delete warning) and to Advanced (delete block). `activeId()` still drives only the card highlight. | `PS.spec:301` (a not-ready route with the anthropic driver still offers Replace; it holds while a save runs) |
| **Minor 3**: `drawerWrite` has no rejection guard | `DW:34-41`: a rejected `write` publishes `blocked` with the fixed "The save could not be completed. Retry.", never staying at `saving`. `PS:549-551` uses it. | `DW.spec:30`; `PS.spec:269` |
| **Minor 4**: mid-flight interleavings are not pinned | `PS:549-551`: the session counter drops an outcome that lands after the drawer closed or reopened. | `PS.spec:279` (write running at close → the reopened drawer shows no outcome); `PS.spec:293` (page save running → drawer write controls disabled); `PS.spec:260` (refused → "Another save is in progress", from Batch 21); `AT.spec:230` (connection switched mid-write, Advanced) |
| **Minor 5**: a failed setup read empties the Replace draft tiers | `CT:369` `setupMissing`: for any non-`anthropic` connection, Save waits for the setup read. On failure it stays disabled and says why ("Could not read the stored models… Close and reopen this panel to retry."). `CT:375` `canSave` requires it. `PS` passes `[credentialsSetupError]` from `state.connectionSetup().status === 'error'`. | `CT.spec:335` (describe), `:343` (waits, and a failure explains), `:356` (the Claude API key writes no tiers, so it does not wait); `PS.spec:314` |

## Part B: Batch 22 acceptance → file:line → spec

| Acceptance | Implementation | Spec |
|---|---|---|
| Tier pickers saved on selection with toast + Undo, through the save-feedback service; `write`/`undo` are a state-service save method (Batch 17 review constraint) | `MT:142-153`:<br>- `feedback.save({ write: () => state.setMainAgentTier(id, tier, model, ctx), undo: () => state.setMainAgentTier(id, tier, previous, ctx) })`<br>- Undo is a second real write of the previous value.<br>- An empty model clears the tier, which is what "Default" (`MT:80`) sends.<br>The page toast sits outside the drawer's focus trap, so the same toast with Undo renders inline (`MT:95-103`). `PS:253` stacks the drawer above the page toast (`z-[60]`), so the toast never covers the footer Close. | `MT.spec:121` (selection → `setMainAgentTier`; Undo → second `setMainAgentTier` with the previous value); `:134` (Default clears, Undo restores); `:144` (re-selecting writes nothing); `PS.spec:322` (z-order); harness RUX-2 (`provider:setModelTier`, then Undo → `provider:clearModelTier`) |
| Pickers `[searchable]="true"`; custom model ID kept (#35); tool-use indicators (#38) | `MT:85-87`: the picker is pinned to this connection, with `[searchable]="true"` and `[defaultTier]`. #35's "Not listed? Enter a model ID" and #38's tool-use summary are the picker's own. | `MT.spec:95`; harness #34 (`:797`), #38 (`:801`), #33 (`:498`, manual ID), #36 (`:519`, Default) |
| Custom base URL / models endpoint verified before save (D7) | `AT:244` `check()`: `authMode:'custom'`. A changed base URL is checked with a typed key (the host checks a stored key only against its saved address). A models endpoint alone is checked against the current address with the stored key.<br>`AT:206` `canSaveEndpoint` needs `verified` for the current `probeId`, and any edit drops the probe.<br>`AT:266` → `state.updateCustomEntryEndpoint(id, changes, probeId, ctx)`, which re-checks `verifiedFor` itself (`providers-connection-setup.service.ts:372`).<br>The typed key is never saved and is cleared on save, switch and destroy. | `AT.spec:106`, `:120`, `:133`, `:136`, `:146` (edit after pass needs a new check), and the failure case (Save disabled, reason and latency, no host `detail`); harness #27 (`:761`: Save disabled until "Endpoint verified", then `provider:updateCustomEntry {modelsEndpoint}`) |
| Help URL (#28) | `AT:283` → `state.updateCustomEntryFields(id, {helpUrl})`. `AT:197`: an http(s) URL or empty only. Rendered by `[value]` / interpolation only. | `AT.spec` "help URL saves directly…" and "values render by interpolation only"; harness #28 (`:778`) |
| Pricing (#30), note verbatim | `AT:10` `PRICING_NOTE` = "Stored for your reference; Ptah does not use it for cost estimates yet." `AT:39` `parsePricing`: both empty → `null`; otherwise two numbers ≥ 0. `AT:288` → `updateCustomEntryFields(id, {pricing})`. | `parsePricing` table; `AT.spec` "shows the stored endpoint… pricing note verbatim", "pricing saves both…"; harness #30 (`:786`, asserts the note text) |
| Delete connection (#25), blocked with "Switch the main agent first." for the active driver | `AT:135` shows the sentence and `AT:139`/`:147` disable both buttons while `isDriver`. Inline confirm, then `AT:298` → `state.removeCustomEntry(id, ctx)`. The state blocks independently on the route's driver (`providers-connection-setup.service.ts:331-333`). | `AT.spec` "is blocked for the main agent's driver…", "asks inline, then removes…"; harness #25 (`:751`) |
| D15: never "Saved" after a failure; a refused write returns false | **Advanced.** Every write goes through `DW` `runDrawerWrite`: `saving`, then `state.commit()` only after THIS write resolved; `false` → "Another save is in progress…"; a rejection → `blocked`. `AT` shows "saved" copy only for `status === 'saved'`.<br>**Models.** `SettingsSaveFeedbackService` decides from the call's own result. | `AT.spec` "a refused or failed write is never reported as done (D15)"; `MT.spec:150`; `DW.spec:16`, `:25` |
| Busy / disabled while a save runs (D3) | `MT:117` (`feedback.saving()` or no edit context); `AT:203` | `MT.spec:163`; `PS.spec:293` |
| "Edit in setup" removed only where the tab covers every path (D14) | `DD:240-245`:<br>- **Models & Tiers** keeps it only for `custom`. Setup is the only place to edit the gateway's own `defaultTiers`. For every other kind the tab holds every tier edit: the wizard's Models step edits only main-agent tiers, and native Claude has none. The wizard edits a base URL only for `local-native` / `local-proxy` / `custom` (`provider-setup-wizard.component.ts:794-944`), so no api-key endpoint path is lost.<br>- **Advanced** (custom only) always keeps it, for the gateway's name and protocol.<br>- **Credentials** is unchanged from Batch 21.<br>The wizard's claude-cli "Open login" (`cli-login`) only publishes the two commands (`providers-connection-setup.service.ts:100-110`), which Credentials shows with Copy. | `DD.spec:175` (Models & Tiers of api-key / cli: no fallback); the "custom keeps it on Credentials, Models, Advanced" spec; `DD.spec:182` (Advanced mounted with the driver state) |
| Reachability flips | `HARNESS/settings-reachability.table.ts`:<br>- #25 `:751`, #27 `:761`, #28 `:778`, #30 `:786`, #34 `:797`, #38 `:801` → `restored` with real reaches.<br>- RUX-2 `:834` added as `restored`.<br>- `EXPECTED_CAPABILITY_COUNT` 84 → 85 (`:928`; grows only).<br>- `BASELINE_PRESENT_IDS` (64) untouched.<br>- Baseline `present` entries whose wizard route went away with the Models fallback now reach the drawer: #6 `:342`, #10 `:359`, #13 `:371`, #32 `:491`, #33 `:498`, #36 `:519`.<br>- `setupThroughDrawer` now uses Advanced; only `sovereigneg` entries still go through the wizard from Manage. | Gate G below |

## Write-path trace (control → state method → RPC → store key / scope → runtime reader)

1. **Models & Tiers → pick a model, or type an ID (#35).**
   - Chain: `MT onSelect` → `feedback.save` → `state.setMainAgentTier(id, tier, model, ctx)` →
     `commits.mainAgentTierOperation` (`providers-commit.service.ts:254`) → `provider:setModelTier {providerId, tier, modelId,
     scope:'mainAgent'}` (`provider-rpc.handlers.ts:587`) → `ProviderModelsService.setModelTier`.
   - Store: `provider.<id>.mainAgent.modelTier.<tier>` in `~/.ptah/settings.json` (global; the toast says "All Ptah apps").
   - Read-back: `provider:getModelTiers {scope:'mainAgent'}` must equal the model.
   - Readers:
     - `ProviderModelsService.applyPersistedTiers` (main-agent env; live only when `<id>` is the active provider);
     - `provider-auth-resolver.ts:407-424` (user tier → registry `defaultTiers` → live catalogue);
     - `PtahCliRegistry.resolveEffectiveTiers` (main tiers under agent tiers).
   - The handler clears the SDK model cache. No SDK reset, and no session ends.
2. **Models & Tiers → Default / Undo to an empty value.**
   - Chain: same state method with `''` → `provider:clearModelTier {…, scope:'mainAgent'}` (`provider-rpc.handlers.ts:682`).
   - Store: deletes the same key. Read-back is `''`.
   - Reader: as in 1, now falling back to registry `defaultTiers` / the live catalogue.
   - Undo is a second real write through the same method (`MT:151`).
3. **Advanced → Save endpoint (after a verified check).**
   - Chain: `AT saveEndpoint` → `state.updateCustomEntryEndpoint(id, {baseUrl?, modelsEndpoint?}, probeId, ctx)`
     (`providers-connection-setup.service.ts:366`; blocks unless `verifiedFor(id, probeId)`) → `provider:updateCustomEntry {id, changes}`
     (`provider-rpc.handlers.ts:794`) → `CustomProviderStore.update`.
   - Store: `provider.custom.entries[<id>].baseUrl` / `.modelsEndpoint` in `~/.ptah/settings.json` (non-secret; no `apiKey` sent,
     so the stored key is untouched).
   - Read-back: `provider:listCustomEntries`.
   - Readers:
     - the custom registry entry (`setCustomProviderEntries`), used by the custom translation proxy / Anthropic lane at the next
       configure;
     - `modelsEndpoint` is used when the gateway's models are listed.
   - After a saved base URL, `AT:279` re-reads `state.refreshConnectionSetup(id)` so Credentials checks against the new address.
   - The check itself (`auth:verifyDraftConnection`) persists nothing.
4. **Advanced → Save (help URL) / Save pricing.**
   - Chain: `state.updateCustomEntryFields(id, {helpUrl} | {pricing}, ctx)` (`providers-connection-setup.service.ts:342`; the strict
     schema allows only these two fields) → `provider:updateCustomEntry`.
   - Store: `provider.custom.entries[<id>].helpUrl` / `.pricing`.
   - Read-back: `provider:listCustomEntries`.
   - Readers:
     - `helpUrl`: UI only (the registry entry's `helpUrl`, rendered as the https "Get a key →" link on Credentials).
     - `pricing`: **no runtime reader** (`provider-registry.ts:703-718`), hence the verbatim note.
5. **Advanced → Delete connection → Delete for good.**
   - Chain: `state.removeCustomEntry(id, ctx)` (`providers-connection-setup.service.ts:324`) → `provider:removeCustomEntry {id}`
     (`provider-rpc.handlers.ts:825`) → `CustomProviderStore.remove`, plus `AuthSecretsService.deleteProviderKey(id)`.
   - Blocked when:
     - the route is not loaded;
     - the route's driver is this id ("Switch the main agent first.", `:331-333`).
   - Store: the entry is removed from `provider.custom.entries`, and `ptah.auth.provider.<id>` is removed from SecretStorage.
   - Read-back: the entry is absent from `provider:listCustomEntries`.
   - Readers: the registry and connections list. After the post-save refresh, a loaded list without the id closes the drawer
     (`PS` effect, Batch 20).
6. **Credentials writes (Batch 21 paths, unchanged)**:
   - Replace → `connectProvider`;
   - Delete key → `deleteStoredKey`;
   - Sign out → `disconnectCopilot`.

   They now run through `runDrawerWrite` (`PS:549-551`), which adds the rejection guard and the session guard. Store keys and
   readers are as in `batch-21-report.md`.
7. **Credentials → Open login / Check again (M1).**
   - The same RPCs as Batch 21 (`auth:codexLogin` / `auth:copilotLogin`, then `auth:getAuthStatus`).
   - Ptah writes no setting. Only the drawer's display of the in-flight and error states changed.

## Verification

1. `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui
   @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2` exited 0 ("Successfully ran targets typecheck, test,
   lint for 5 projects"). This was the final run, after all source edits except the visual-spec wait, which was then re-linted
   below. Log: `%TEMP%\b22-verify.log`.
   - Tests: core 1083/1083; ui 610/610; chat 1856 passed + 2 skipped (1858; +50 over Batch 21); ptah-extension-webview 224/224.
   - Lint: 0 errors. Warnings core 11, chat 31, harness 41, the same as Batch 21.
   - The first run gave harness 42: a new `max-lines` on the table, fixed by the helper extraction. A second run left one unused
     import, now removed.
   - After the visual-spec change: harness `typecheck,lint --skip-nx-cache` exited 0 with 41 warnings (`%TEMP%\b22-harness-lint.log`).
2. **Gate G.** `npx nx build ptah-extension-webview` exited 0 (`%TEMP%\b22-gateg-build.log`). The initial total is 3.49 MB, unchanged
   from Batch 21; the 2.5 MB warning budget was already exceeded and the 3.5 MB error budget is met.
   - Then `settings-reachability.e2e.spec.ts --reporter=list --repeat-each=3` gave **27 passed** (1.5m), exit 0. Log:
     `%TEMP%\b22-gateG.log`.
   - The run covers the flipped #25/#27/#28/#30/#34/#38, RUX-2 and the re-routed #6/#10/#13/#32/#33/#36, in both hosts.
   - Nothing else built `dist/` during the run.
3. **Captures.**
   - **First run: 2 failed / 2 passed** (log overwritten by the final run; diagnosis kept below).
     - Failing tests: `baseline smoke — both tabs (electron, anubis)` and `(electron, anubis-light)`.
     - Error: `locator.evaluate: Test timeout of 30000ms exceeded` in `waitForDrawerOpened`
       (`settings-visual.e2e.spec.ts:69`), at the `drawer-sovereigneg-models` capture.
   - **Diagnosis** (no silent re-run):
     - With `--timeout=120000` it still hung, so it is not a time budget (`%TEMP%\b22-visual-diag.log`).
     - The failure screenshot shows a fully rendered, static drawer.
     - Listing the drawer subtree's animations showed only finite ones (`%TEMP%\b22-visual-diag2.log`): the drawer's
       `ptah-drawer-fade-in` / `ptah-drawer-slide-in-right`, tab `transition-colors` transitions, and daisyUI `button-pop`.
     - Logging whatever was still unfinished after a 5 s grace gave `[]` for all 14 electron captures, and both passed
       (`%TEMP%\b22-visual-diag3.log`).
   - **Suspected cause:** an incidental transition started by the tab click, whose `finished` promise is read at once and
     sometimes never settles.
   - **Fix** (`settings-visual.e2e.spec.ts:67-76`): the wait now covers only the drawer's own `ptah-drawer-*` keyframes, which
     are what its doc comment says it waits for.
     - The screenshot already uses `animations: 'disabled'`.
     - The panel bounding-box assertion still fails on a mid-slide frame.
     - Diagnostics removed.
   - **Final:** `settings-visual.e2e.spec.ts --reporter=list` gave **4 passed** (15.4s), exit 0 (`%TEMP%\b22-visual.log`).
     `--repeat-each=3` gave **12 passed** (35.1s), exit 0 (`%TEMP%\b22-visual-repeat.log`).
   - New `current-*` captures in `.ptah/specs/TASK_2026_555/screenshots/angular/`, each for vscode/electron × anubis/anubis-light:
     - `current-drawer-moonshot-models-*` (api-key);
     - `current-drawer-sovereigneg-models-*`;
     - `current-drawer-sovereigneg-advanced-*`.
   - An api-key connection has no Advanced tab (`connection-kind.ts:23-29`: Advanced is custom-only), so there is no Moonshot
     Advanced capture.
   - `git status --short -- .ptah/specs/TASK_2026_555/screenshots/angular/baseline-*` is **empty**.

## Capture comparison (vs `prototypes/final/index.html` drawer Tab 3 `:590-663` and Tab 4 `:665-724`)

- **Models & Tiers (Moonshot, sovereigneg; both hosts and themes).**
  - **Matches:** the "Tier model mapping" heading and "Saved on selection" note; three tier rows labelled
    "Sonnet tier · General work and coding", "Opus tier · Deep reasoning" and "Haiku tier · Fast subagents and triage"; the
    "Mapped to:" line in mono; a per-tier "Default" action (shown only when the tier is set); the tool-use indicator; and
    "Not listed? Enter a model ID". The footer is Close only for Moonshot and "Edit in setup" for sovereigneg (D14).
  - **Differences:**
    - Each row embeds the searchable picker (`[searchable]`, with its "3 models · 2 support tool use" summary), where the
      prototype has one shared search box plus Change buttons. The picker is the Batch 15 component the plan prescribes. The
      rows are therefore taller: at 1024×768 the Haiku picker is below the fold and needs a scroll.
    - Mapped-to text is `text-base-content` (deviation 6), not `text-primary`.
    - The prototype's per-row "Tool use: Yes" badge is the picker's per-provider summary here.
  - **To flag for Gate V 28:** the row density.
- **Advanced (sovereigneg, both hosts and themes).**
  - **Matches:** the Base URL and Models endpoint fields (mono) with the path hint; Documentation URL; the "Token pricing (per
    1M tokens)" box with the Input/Output price grid; and the delete row separated by a top border.
  - **Differences:**
    - An "Endpoint" heading, a check-status line, and Check endpoint / Save endpoint (D7: verified before save).
    - The pricing note reads the plan's verbatim sentence, not the prototype's "Used for real-time session cost tracking".
      Pricing has no runtime reader.
    - Delete is titled "Delete connection" with an error-tone dot and border and base-content text (deviation 6), with an
      inline confirm instead of the prototype's direct handler.
    - Per-section Save buttons (deviation 3, no single drawer Save).
    - The fixture entry has no stored models endpoint, help URL or pricing, so those fields show placeholders.
  - **Light theme:** fields, disabled buttons and the error-tone border are legible; text contrast is fine.
- The prototype's "Standard Built-in Provider" notice for non-custom connections has no counterpart. The Advanced tab is
  absent for them (Batch 19/20 decision: inapplicable tabs are absent, not disabled).

## Deviations and open points

1. **Advanced is custom-only.** Built-in local servers' base-URL edits (`updateLocalBaseUrl`) stay on the Credentials footer's
   setup fallback (D14, unchanged from Batch 21). There is no Advanced tab for them.
2. **Inline toast in Models & Tiers.**
   - The page toast (Batch 17) is outside the drawer's focus trap, so the tab repeats the same feedback, with Undo, inline.
   - The drawer is lifted to `z-[60]` so the fixed page toast (z-50) cannot cover its footer.
   - Both read the same `SettingsSaveFeedbackService` state.
3. **Baseline `present` entries re-routed (#6, #10, #13, #32, #33, #36).** They used to reach the wizard through the Models
   footer's "Edit in setup", which D14 now removes for non-custom kinds. Their capability is asserted in the drawer tab that now
   holds it; the wizard is still reachable from Connect provider. The ids and `BASELINE_PRESENT_IDS` are unchanged.
4. **New harness file `settings-drawer.reach.ts`.** It is outside the listed files, and was added to keep lint warnings from
   growing (strict gate). It is a pure move of existing helpers.
5. **Visual-spec wait narrowed.** The change and its reason are given under "Verification". It is test-only.
6. **Files outside the batch list:**
   - `drawer-write.ts` (+ spec), a shared runner for Credentials and Advanced;
   - `credentials-tab.component.ts` (+ spec), `providers-settings.component.ts` (+ spec) and `connection-detail-drawer.component.spec.ts`,
     for the Part A findings;
   - the harness fixtures.
7. **Added `credentials-cli-detected` line** in the claude-cli Credentials card (by the interrupted run). It reads
   `connection().configured` (= `claudeCliInstalled`). Harness #10 now asserts it in place of the wizard's detection state.
8. **Carried over:**
   - the key hint and Overview latency (Batch 21 flagged deviations, Gate V 28);
   - the Models row density;
   - the missing "Standard Built-in Provider" notice.
