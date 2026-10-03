# Batch 32 report: add-instance and tier-mapping modals (S6)

Executor: frontend-developer, Orchestration owner (in-process subagent; resumed after a rate-limit interruption).
Date: 2026-10-02. Base: HEAD `c04a85a4e` (31). Track A worktree only. Nothing is staged or committed.

- No `git stash`, restore, checkout, reset or clean was used.
- Only `current-orchestration-*` captures were retaken. Every other `current-*` file was copied to `%TEMP%\b32-shots-backup`
  before the visual run and copied back afterwards; `git status` shows 0 modified non-orchestration captures.

| Requirement | State |
| --- | --- |
| `AddCliInstanceModalComponent`, testid `add-cli-instance-modal`, create mode → `saveSettings({cli:[{action:'create',…}]})` | Done |
| Edit mode (#50) → `saveSettings({cli:[{action:'update', params:{id, name?, apiKey?}}]})` | Done. `PtahCliUpdateParams` carries name and key, so the RISK stop did not trigger. The provider is shown read-only (the update contract has no provider). |
| Create disabled for `github-copilot` until `externalAuth.signInState === 'signed-in'` (#47) | Done; inline "Login with GitHub" |
| Show/hide on the CLI form key (#49 carry-in from Batch 21) | Done; #49's reach extended to the add form |
| `CliTierMappingModalComponent`, testid `cli-tier-mapping-modal` (#53, D5) | Done |
| Tier modal always sends the full `{sonnet?,opus?,haiku?}`; "Use inherited" drops the key | Done (unit + Gate G #53 assert the full object) |
| Inherited placeholder from the provider-level `cliAgent` tier | Done (`provider:getModelTiers {scope:'cliAgent'}`, else "provider default") |
| Matrix: Add (header + no-instance row), Tiers, Edit | Done |
| Toast inside the modal footer (plan :542-544); dismissed mid-save still reported by the page toast | Done |
| Batch 14 finding 3: focus in on open, Tab trapped, focus back to opener after Esc / backdrop / submit | Done (`settings-orchestration.e2e.spec.ts`, both hosts) |
| Reachability: flip #47, #53 | Done; both `restored`, no `pending` entry remains. `EXPECTED_CAPABILITY_COUNT` stays 96 |

## 1. What changed

- **Modals** (`libs/frontend/chat/src/lib/settings/providers/`): both are on the shared `NativeModalComponent` and live in
  the matrix's lazy chunk. Writes go through `SettingsSaveFeedbackService` (Batch 17 constraint: each `write`/`undo` is
  one state call). The typed key lives only in the add modal and is cleared on every open and close.
- **Tier modal fields:** each tier is the compact `ProviderModelSearchFieldComponent` over the instance provider's
  catalogue (`PROVIDER_MODELS_LOADER`), with "Enter a model ID…" as the pinned last row that swaps in a model-ID field.
- **Matrix** (`cli-orchestration-matrix.component.ts`): "Add Ptah CLI Instance" in the header and in an empty-state row,
  Tiers and Edit on each instance row (actions wrap two by two to stay inside the VS Code box), and the two modal hosts.
- **`NativeModalComponent`** (ui): Tab / Shift+Tab now wrap at the panel's first and last control. `showModal()` makes
  the page inert but is not a trap: Chromium moves focus from the last control to browser UI. Found by the finding 3
  scene; unit-tested in `native-modal.component.spec.ts`.
- **Harness:** `throughVariantBoot` moved from the table to `settings-drawer.reach.ts` so the matrix entries can use it.
  #47, #49 and #53 now live in `settings-cli-matrix.entries.ts`. The table's `notYetBuilt` placeholder is gone.

## 2. Gate G #53: deviation from the first draft

The #53 entry first drove the full picker's "Not listed?" disclosure. The tier modal uses the **compact** field, which
has no such disclosure; its route to an unlisted id is the pinned "Enter a model ID…" row. The entry now opens the opus
field, picks that row, asserts focus moves to `cli-tier-manual-opus`, applies `glm-4.7` and asserts `ptahCli:update`
with the full object `{sonnet:'glm-5.3:cloud', opus:'glm-4.7', haiku:'glm-5.3:cloud'}`. The fixture's `settings:get` is
static, so the read-back cannot confirm the write; the entry asserts that the toast does not claim "Saved" (D15).

## 3. Defects found and fixed while verifying

1. **Hidden duplicate toasts (Gate G run 1: 7/9, both hosts failed).** Both modals rendered `<ptah-settings-toast>` in
   their footer even while closed (a closed `<dialog>` stays in the DOM). This left three `settings-toast-undo` buttons
   in the page, which broke #63 and RUX-8 (strict-mode locator) and cascaded into #70 (the Undo never ran, so the
   Copilot badge stayed "Auto-approve: On"). **Fix:** the footer toast renders only while the modal is open
   (`@if (open())` in both templates). The regression test in each modal spec checks one toast while open and none
   once closed.
2. **Finding 3 scene, tier modal, Esc (both hosts).** After 14 Tabs, focus sits on a tier field. That field opens its
   list on focus, and the shared search field's Esc closes only the list (its documented rule: Esc must not also reach
   an enclosing popover or drawer). **This is the product behaviour, not a defect.** The scene now presses Esc once to
   close the list (and asserts the dialog is still open, `aria-expanded="false"`), then presses Esc again to close the
   dialog and return focus to Tiers.

## 4. Verification

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --skip-nx-cache` | Successfully ran typecheck and lint for 5 projects, 0 errors. The warnings already existed. `eslint` on the 7 changed source files is clean. Re-run for chat and the harness after the fixes: green. |
| `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui ptah-extension-webview --skip-nx-cache -- --maxWorkers=2` (before fix 1) | chat **2176 passed + 2 skipped** (131 suites; Batch 31 2149, +27); core 1109/1109; ui **623/623** (+4, modal Tab wrap); webview 224/224 |
| `npx jest -c libs/frontend/chat/jest.config.ts …add-cli-instance-modal …cli-tier-mapping-modal …cli-orchestration-matrix --maxWorkers=2` (after fix 1) | 3 suites, **59/59** (+2 regression tests) |
| `npx nx build ptah-extension-webview --skip-nx-cache` | No budget error. Initial total **3.48 MB**, unchanged (981.33 kB over the 2.5 MB warning). `cli-orchestration-matrix-component` lazy chunk: **68.87 kB raw / 15.81 kB transfer** (Batch 31: 45.65 / 11.29) |
| Gate G: `playwright test settings-reachability.e2e.spec.ts --reporter=list --workers=2` (after fix 1) | **9/9 passed** (3.0 m) |
| `playwright test settings-orchestration.e2e.spec.ts settings-visual.e2e.spec.ts --reporter=list --workers=2` (after fix 2) | **18/18 passed** (1.5 m). An earlier run had one `page.goto` 15 s boot timeout in a backdrop scene, with no assertion failure; it did not recur. |

### Captures (retaken: only `current-orchestration-*`, 1024×768, both hosts × both themes)

All in `.ptah/specs/TASK_2026_555/screenshots/angular/`:

- `current-orchestration-{vscode,electron}-{anubis,anubis-light}-1024x768.png`: the header now has Add, and Glm has
  Tiers, Edit, Test and Delete.
- `current-orchestration-popover-{model,effort,permission,copilot,cursor}-{host}-{theme}-1024x768.png` (retaken)
- **new:** `current-orchestration-modal-add-{host}-{theme}-1024x768.png`, with Moonshot chosen and the key masked with
  show/hide (prototype `interactions/orchestration-1`)
- **new:** `current-orchestration-modal-tiers-{host}-{theme}-1024x768.png` (Glm Tier Model Mapping)

## 5. Open defects (not fixed in this batch)

1. **The tier field shows the hint instead of the model when the saved id is not in the catalogue.** The closed compact
   field displays the option's `name`. For an own id missing from the catalogue, the modal's option is
   `{id, name: 'saved, not in the current list'}`, so all three Glm fields read "saved, not in the current list"
   (visible in `current-orchestration-modal-tiers-*`). The line under each field does name the model ("This instance:
   glm-5.3:cloud").
   - The cleaner fix is in the shared `ProviderModelSearchFieldComponent`: in `compact` mode, show the closed value
     with `compactLabel` (the id), matching the compact rows.
   - That field is also the Batch 30 matrix model popover's, so the change needs the orchestrator's decision. The
     local alternative is to put the id in that option's name.
2. **The tier field opens its list on focus,** so keyboard users need two Esc presses to leave the tier dialog from a
   field (§3.2). This is the shared field's existing behaviour, recorded for the Gate V 36 review.

## 6. Copy for user review (new)

- Modal titles: "Add Ptah CLI Agent Instance", "{name} Tier Model Mapping".
- Buttons: "Create Instance", "Save changes".
- The key help: "Enter this instance's own key. Keys stored for the provider connection are not copied."
- The tier intro: "Models for this Ptah CLI instance only, from {provider}. A tier without its own model uses the
  provider's CLI-agent tier, else the provider default. Each choice saves at once."
- Empty state: "No Ptah CLI instance yet."
- Copilot sign-in state: "Awaiting sign-in" / "Signed in".

## Files

- CREATED `libs/frontend/chat/src/lib/settings/providers/add-cli-instance-modal.component.ts` and `.spec.ts`
- CREATED `libs/frontend/chat/src/lib/settings/providers/cli-tier-mapping-modal.component.ts` and `.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts` and `.spec.ts`
- MODIFIED `libs/frontend/ui/src/lib/native/modal/native-modal.component.ts` and `.spec.ts` (Tab wrap)
- CREATED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-orchestration.e2e.spec.ts`
  (finding 3 scenes, create, Done, edit #50)
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-cli-matrix.entries.ts` (#47, #49, #53)
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-drawer.reach.ts` (`throughVariantBoot`)
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts`
- MODIFIED `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts` (modal captures)
- CREATED `.ptah/specs/TASK_2026_555/batch-32-report.md` (this file)

The batch named 6 files; this one touches 16 (counting specs). The extras are:

- the ui modal fix (a defect the required scene found)
- the matrix spec
- the scene spec the batch's validation notes require
- the entries, reach and visual harness files (the Batch 31 layout)
