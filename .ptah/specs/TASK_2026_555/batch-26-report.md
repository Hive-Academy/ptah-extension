# Batch 26 report: Main Agent popover (D6)

Executor: Providers owner (in-process frontend-developer). Worktree
`D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign`, on top of 08c64663a.

- Nothing committed; no git stash / restore / checkout / reset / clean.
- No PowerShell find-and-replace: all edits used the edit tool.
- No `ui`, `core`, `shared` or backend edits.
- `ProviderSetupWizardComponent` is untouched: its `git diff HEAD --stat` is empty.

Paths are relative to `libs/frontend/chat/src/lib/settings/providers/` unless prefixed `HARNESS/`
(`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/`).

| Abbreviation | File |
|---|---|
| `O` | `main-agent-reassign-popover.component.ts` |
| `PS` | `providers-settings.component.ts` |

## Files

| Status | File | Lines | Role |
|---|---|---|---|
| CREATE | `main-agent-reassign-popover.component.ts` (+ spec) | 289 | The popover: provider (D6 confirm), model, effort, Save-to, Check connection |
| MODIFY | `providers-settings.component.ts` (+ spec) | **555** (was 700) | Old main-agent block and page-level provider review removed. The node, a card and `main-*` deep links open the popover |
| MODIFY | `routing-map.component.ts`, `routing-map-node.component.ts` | 272 / 102 | `[main-agent-popover]` slot, anchored at the Main Agent node's bottom-left edge (`N:76`, `M:100`); doc updated |
| MODIFY | `HARNESS/settings-reachability.table.ts` | — | #3, #16, #35, #37 and RUX-5 re-pointed to the popover or map. Helpers moved out to stay under `max-lines` |
| MODIFY | `HARNESS/settings-drawer.reach.ts` | — | `openMainAgentPopover`, `closeMainAgentPopover`; `orchestrationTab`, `cliConfigSection` and `throughDelegatedEdit` moved here unchanged |
| MODIFY | `HARNESS/settings-visual.e2e.spec.ts` | — | New popover capture `current-main-agent-popover-*` |

`settings.component.ts` and its spec needed **no change**. The `main-agent|main-model|main-effort` routing rows already
send these sections to Providers (Batch 18: `settings.component.ts:51-53`, spec `:170`). This batch makes them *land* on
the popover (`PS:385-388`), pinned by the page spec below.

## Old main-agent control → new place (D14)

| Old control (`PS` at 08c64663a) | New place |
|---|---|
| "Next request uses: {provider} · {modality}", "Needs attention", the model text (`:114-128`) | Routing map Main Agent node: provider, model, status "Active / Needs attention / Not set" (Batch 25). The modality is in the popover's provider option label |
| "Change main provider" (focused the cards) (`:130`) | Popover **Provider connection** select (`O:57-63`) with its D6 confirm |
| "Edit model" + picker + "Save to" + Save / Cancel (`:131`, `:161-176`) | Popover **Model**: searchable picker, saved on selection with Undo (`O:94-97`), plus "Save model and effort to" (`O:110-116`) |
| "Check connection" (`:132`) | Popover **Check connection** (`O:117-121`). The drawer Overview keeps its own |
| Interim "Save provider to…" (`main-provider-save-to`, `:133-138`) | **Removed**, as the Batch 23 carry-forward requires. Replaced by the popover's provider **Save to** radios (`O:65-74`); choosing another scope shows the D6 confirm. `git grep main-provider-save-to -- libs` is empty |
| Effort select + "Save reasoning effort to" + Save / Cancel (`:140-158`) | Popover **Reasoning effort** buttons (Default + low…max), saved on selection with Undo (`O:98-107`), to the shared Save-to |
| Page-level "Review main provider change" panel for a card's "Use for main agent" (`:199-216`), incl. the uncheckable note | The card's "Use for main agent" opens the popover preselected on that provider, straight into the confirm (`PS:123`, `O:139`). The uncheckable note (`activation-unchecked-note`) and the buttons "Use for main agent" / "Cancel provider change" are kept (`O:76-88`) |
| `data-focus="main-agent" / "main-model" / "main-effort"` targets | The same `data-focus` markers inside the popover. A deep link opens it focused on that control (`O:275`, `PS:385-388`) |
| The "Main agent" heading and card | Gone: the routing map is the main-agent surface |

## Acceptance → file:line → spec

Specs: the popover spec (`main-agent-reassign-popover.component.spec.ts`) and `PS.spec`.

| Acceptance | Implementation | Spec |
|---|---|---|
| Provider change has an explicit confirm with the exact copy, no Undo (D6) | `O:172-181` builds the copy "New main-agent requests use {name}. Changing the provider ends running chat sessions." (the same provider saved to another scope reads "…keep using {name}, saved to {scope}. Saving the provider ends running chat sessions."). Nothing is written before "Use for main agent" (`O:241`) → `state.activateConnection`. No toast and no Undo. | Popover spec "choosing another provider asks first, with the D6 copy…" (asserts no write before confirm, no Undo, no toast); "the same provider to another scope also asks (RUX-5)"; `PS.spec` "a card's 'Use for main agent' opens the popover…" |
| The uncheckable note is kept | `O:80-82` (route status `unknown` / `skipped`) | Popover spec "an uncheckable connection keeps its note…"; `PS.spec` card path |
| The provider list follows the activatable rule | `O:157-164`: configured connections whose route status is connected / reachable / unknown / skipped (the state's `ACTIVATABLE_STATUSES`, `providers-settings-state.service.ts:72`), plus the current driver | Popover spec "lists activatable connections plus the driver; a failing connection is not offered" |
| Save-to lists only `writeScopes` | Provider: `O:165` `writeScopes('authMethod')`, defaulting to the current authentication scope (`O:167-170`). Model / effort: `O:193-199`, the targets both keys allow, defaulting to the model's current source scope (plan: the current source scope). | Popover spec "Save to lists only writeScopes(authMethod)…", "Save to lists the targets both keys allow…" |
| Model saves on selection with Undo; `write` / `undo` are the state method (Batch 17 constraint) | `O:252-261`: `feedback.save({write: () => state.saveSettings({model:{model, applyTo}}, ctx), undo: () => state.saveSettings({model:{model: previous, applyTo}}, ctx)})`. Undo is a second real write. Re-selecting the current model writes nothing. | Popover spec "a model selection saves at once; Undo is a second real write…", "re-selecting the current model writes nothing" |
| Effort from `effortLevels` plus "Provider default", on selection with Undo | `O:98-107`, `O:263-272`: six buttons (Default, low, medium, high, xhigh, max); the current one has `aria-pressed`; Default sends `effort: undefined` | Popover spec "effort buttons: the current one is pressed…" |
| D15: never "Saved" after a failure; a refused write is not success | Provider: `runDrawerWrite` (Batch 22) publishes its own outcome only; `false` → "Another save is in progress" (`O:241-250`). Model / effort: `SettingsSaveFeedbackService` decides from the call's own result. | Popover spec "a refused or failed activation is never reported as saved (D15)", "a failed write is never reported as saved and offers no Undo (D15)" |
| Triggers disabled while saving (D3) | `O:206` `busy` (any commit saving, or this popover's own activation) disables the provider select, radios, confirm buttons, picker, effort buttons and Save-to | Popover spec "every trigger is disabled while a save runs (D3)" |
| A workspace switch mid-edit gives a `blocked` toast; the popover stays open with fresh values | The context is taken on open (`O` constructor effect). A write the host blocks leaves the toast with the host's message (feedback service), and `refreshContextIfBlocked` (`O:286`) takes the new context. The values are live signals, so they are already fresh. | Popover spec "a workspace switch mid-edit: the blocked write is reported, the popover stays open, the next write uses the new context" |
| Check connection | `O:117-121` → `state.checkConnection()`, disabled while the route re-reads | Popover spec "Check connection re-reads the route…" |
| "Reassign" on the node opens this popover (pattern: `backdropClass="transparent"`, `placement="bottom-start"`) | `PS:80-82`: `nodeActivated('main-agent')` → `openMainPopover()`. The popover is projected into the node (`[node-popover]`, `N:76`); `O:41` uses the Batch 23 pattern. Esc and the backdrop close it; focus returns to Reassign (`NativePopoverComponent`). | `PS.spec` "the old main-agent block is gone; the Main Agent node's Reassign opens the popover, anchored in that node"; harness #16 / #35 / RUX-5 (Esc close asserted) |
| `main-*` routing rows land here | `PS:385-388`: `main-agent` / `main-model` / `main-effort` open the popover focused on the provider select / model section / effort group (`O:275`). The shell routing is unchanged (Batch 18). | `PS.spec` "the %s deep link opens the popover focused on that control" (3 cases); `settings.component.spec.ts:170` (unchanged, passes) |
| Old block removed in the same commit (D14) | See the table above | `PS.spec` (none of the old buttons, no `#providers-main-heading`) |
| `main-provider-save-to` gone; #16 / RUX-5 green through the popover | `git grep -n main-provider-save-to -- libs` returns nothing. #16 (`HARNESS/…table.ts:375`) and RUX-5 (`:824`) reach the popover's Save-to. The two parent specs that pinned the button are dropped. | Gate G 27/27 |
| The popover loads deferred; no budget error | The popover is used only inside the routing map's `@defer` block, so it gets its own lazy chunk `main-agent-reassign-popover-component` (**13.20 kB**). The model picker left the eager page with the old block. | Build log below |
| `PS` back under 700 lines | 700 → **555** | — |

Additional fix found during Gate G, with a spec: **keyboard focus after Cancel**. The confirm (holding the focused
button) leaves the DOM, which dropped focus to `<body>`, so Esc no longer closed the popover. `resetProvider` now
returns focus to the provider select (`O:234-239`). Spec: popover spec "after Cancel the focus stays inside the popover…".

## Write-path trace (control → state method → RPC → store key / scope → runtime reader)

1. **Provider → confirm → "Use for main agent"** (D6, no Undo). Also a card's "Use for main agent", or the same
   provider saved to another scope.
   - Chain: `O activate()` → `runDrawerWrite` → `state.activateConnection(id, applyTo, ctx)`
     (`providers-connection-setup.service.ts:229-244`) → `auth:saveSettings`:
     - `{authMethod:'thirdParty', anthropicProviderId: id, applyTo}` for a third-party connection;
     - `{authMethod:'claudeCli', applyTo}` for the CLI;
     - `{authMethod:'apiKey', applyTo}` for `anthropic`.
   - It is refused unless `writeScopes('authMethod'|'anthropicProviderId')` includes the target (`authWritable`).
   - Store: `authMethod` (and `anthropicProviderId`) at the chosen scope: global in `~/.ptah/settings.json`, the App
     layer, or the workspace's settings.
   - Reader: `active-provider-resolver.ts` on the next request. **Ends running chat sessions** (SDK reset, plan §3
     row 1); the confirm copy says so.
   - Read-back and refresh: `ProvidersCommitService.run`.
2. **Model → pick** (save on selection) and **Undo**.
   - Chain: `O saveModel` → `feedback.save` → `state.saveSettings({model:{model, applyTo}}, ctx)` → `config:model-switch
     {model, applyTo}` (`providers-commit.service.ts:84-92`; handler `config-rpc.handlers.ts:185-200`).
   - Store: `modelSettings.selectedModel` at `applyTo` (`provider.<authKey>.selectedModel`, a scoped key).
   - Runtime: `sdkAdapter.setSessionModel` on the open sessions (live, no reset), and the next request.
   - Read-back: `config:model-get`.
   - Undo: the same method with the previous model and scope. There is no Undo when there was no stored model.
3. **Effort → button** and **Undo**.
   - Chain: `O saveEffort` → `state.saveSettings({effort:{effort | undefined, applyTo}}, ctx)` → `config:effort-set`
     (`providers-commit.service.ts:96-104`; handler `config-rpc.handlers.ts:667-681`).
   - Store: `reasoningSettings.effort` at `applyTo` (`provider.<authKey>.reasoningEffort`).
   - Runtime: `sdkAdapter.setSessionEffort` (live) and the next request.
   - Undo: the same method with the previous value.
4. **Scope** (the D16 badges in the node header): unchanged from Batch 23. Clear / Use global → the page's review with
   "ends running chat sessions" → `state.clearScopeOverride` → `config:clearScopeOverride` (SDK reset for these keys).
5. **Check connection** is a read: `state.checkConnection()` → `state.refresh()` → `auth:getEffectiveRoute` and the other
   reads.

## Verification

1. `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui
   @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2` exited 0 ("Successfully ran targets typecheck, test,
   lint for 5 projects"). This is the final run on the final tree. Log: `%TEMP%\b26-verify.log`.
   - Tests: core 1083/1083; ui 610/610; chat **1963 passed + 2 skipped** (1965); webview 224/224.
   - Lint: 0 errors; warnings core 11, chat 30, harness 41 (unchanged).
   - Two harness lint problems during the batch were fixed, not waived:
     - `max-lines` 703 > 700: `orchestrationTab`, `cliConfigSection` and `throughDelegatedEdit` moved to the reach-helper module.
     - An unused `gotoSettingsTab` import: removed.
2. **Build.** `npx nx build ptah-extension-webview` exited 0, **no budget error** (`%TEMP%\b26-gateg-build.log`).
   - Initial total: **before (Batch 25) 986.45 kB over the 2.5 MB warning budget, now 971.47 kB over (3.47 MB)**. That is
     15 kB smaller, because the old block left and the model picker moved out of the eager page. About 28.5 kB of
     headroom under the 3.5 MB error budget.
   - Lazy chunks: `main-agent-reassign-popover-component` 13.20 kB (deferred with the map), `routing-map-component`
     14.66 kB.
3. **Gate G.** Final `settings-reachability.e2e.spec.ts --reporter=list --repeat-each=3` gave **27 passed** (1.8m), exit 0.
   Log: `%TEMP%\b26-gateG.log`. Two earlier red runs, diagnosed before any re-run:
   - **Run 1: 6 failed / 21 passed** (log `%TEMP%\b26-gateG-first-fail.log`). Each failure was `every present/restored
     capability is reachable` (both hosts, all repeats), with `Test timeout of 180000ms exceeded`, last step #22.
     - **Cause:** the popover stayed open after #3 / #16. "Cancel provider change" removed the focused button, focus fell
       to `<body>`, Esc did not reach the popover, and its transparent backdrop blocked the following entries until the
       timeout.
     - The failure screenshot also showed the popover **flipped above the node with its top clipped**: it was about
       420 px against about 316 px of space at 1280×720.
     - **Fix:** focus now returns to the provider select, which is also a real keyboard fix, with a spec. The content is
       compacted and capped at `max-h-[18rem]` with internal scroll.
   - **Run 2: 26 passed, 1 failed** with `worker process exited unexpectedly (code=3221226505)` at 0 ms (`x 8 … (vscode)
     every present/restored capability is reachable (0ms)`), before the test body ran. Log `%TEMP%\b26-gateG-worker-crash.log`.
     - This is the same Windows 0xC0000409 worker crash recorded in Batch 25, not a test failure.
     - Per execution default 7 it was re-run with `--repeat-each=3`: 27/27. The final run on the final build is also 27/27.
4. **Captures.** `settings-visual.e2e.spec.ts --reporter=list --repeat-each=3` gave **12 passed** (50.5s), exit 0
   (`%TEMP%\b26-visual.log`).
   - New: `current-main-agent-popover-{vscode,electron}-{anubis,anubis-light}-1024x768.png`.
   - `git status --short -- …/screenshots/angular/baseline-*` is **empty**.

## Capture comparison (vs prototype `#popoverMainAgent`, `index.html:828-880`, `screenshots/interactions/index-1.png`)

| Aspect | Prototype | Ours |
|---|---|---|
| Anchor / placement | Below the Main Agent node, left-aligned, about 290 px wide | VS Code: below the node, left-aligned, 320 px (`w-80`). Electron (node lower in the page): Floating UI flips it **above** the node; fully visible, not clipped |
| Header | "Reassign Main Agent" + ✕ | "Reassign main agent" + ✕ (`aria-label="Close"`), same border-bottom |
| Provider | "Provider Connection" select, "Claude (Subscription) · CLI login" | Same label and option style ("Claude (Subscription) · CLI login"), plus an inline **Save to** radio group and the D6 confirm, both in the provider section |
| Model | Select with "[Tool: Yes]" | The searchable Batch 15 picker (plan: `[searchable]`), with the tool-use summary "3 models · 2 support tool use" and "Not listed? Enter a model ID" |
| Effort | Segmented buttons none / low / medium / high (medium primary) | Default / low / medium / high / xhigh / max (the real `effortLevels`); current one `btn-primary` + `aria-pressed` |
| Save / apply | One "Save to" select + "Apply & Save (Saves immediately)" | No Apply: model and effort save **on selection** with toast + Undo (D2); the provider saves on its **confirm** (D6). "Save model and effort to" is a select; Check connection sits at the bottom |
| Height | All visible (about 290 px) | Capped at 18 rem with internal scroll: provider and model are visible at once; effort, Save-to and Check connection are reached by scrolling inside (see deviation 2) |

## Deviations and open points

1. **One provider-change surface.** A card's "Use for main agent" now opens the popover preselected on that provider,
   instead of a separate page-level review panel.
   - Why: one D6 confirm, where the plan puts it.
   - The button names are kept, so harness #3 needed only a close step.
2. **The popover scrolls inside** (`max-h-[18rem]`).
   - Why: taller, Floating UI flipped it up and clipped its top at 720-768 px viewports. The routing map still sits
     below the page header, which Batch 28 removes.
   - Batch 28 may lift the cap once the page composition frees the space.
3. **Model and effort share one Save-to**, which lists only the targets both keys allow (the prototype has one Save-to).
4. **No "Apply & Save" button.** It is replaced by save-on-selection and a provider confirm (task.md Decisions: D2 / D6).
5. **Harness helper moves.** `orchestrationTab`, `cliConfigSection` and `throughDelegatedEdit` moved unchanged to
   `settings-drawer.reach.ts`, to keep the table under `max-lines`.
6. **Recurring infrastructure crash.** The Windows Playwright worker crash (0xC0000409) happened again (Batch 25 and
   here). It never reproduced on re-run, but it is worth watching in Batch 28's longer runs.

## Visual revise

Orchestrator capture check before commit: `current-main-agent-popover-vscode-anubis-1024x768.png` compared with
`prototypes/final/screenshots/interactions/index-1.png`. The popover was rebuilt compact. `O` =
`main-agent-reassign-popover.component.ts`, now 387 lines. The captures are `current-main-agent-popover-{vscode,electron}-{anubis,anubis-light}-1024x768.png`.

| # | Item | Fix (file:line) | Capture |
|---|---|---|---|
| 1 | Header "Reassign Main Agent" + × | `O:57-67`: title + ×, with Check connection as a small underlined ghost button in the header (item 6) | All four: one header row "Reassign main agent · Check connection · ×" |
| 2 | "Provider Connection": one select | `O:69-75`: one select ("Claude (Subscription) · CLI login"). The Save-to **radio row is gone** from this section; the D6 confirm appears under the select only when needed (`O:82-96`) | One select row, no radios |
| 3 | "Model Selection": ONE compact row, no nested Model card | The shared picker **cannot** render compactly without a `libs/frontend/ui` change: it always renders a card (header label, Provider/Model grid, summary, manual-entry disclosure; `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts:148-345`). Its one-row search field `ProviderModelSearchFieldComponent` is **not exported** from `@ptah-extension/ui` (`…/provider-model-picker/index.ts:11-17`), so a deep import would break the module boundary. Closest compact form, with no ui change: one native `<select>` over the driver's catalogue, loaded through the exported `PROVIDER_MODELS_LOADER` (`O:290-300`), labelled "{name} [Tool: Yes\|No]" like the prototype (`O:250-258`). A stored model the catalogue lacks stays listed ("· not in current catalog"). "Enter a model ID…" swaps the select for an inline field + Use / Cancel on the same row (`O:104-119`, `O:324-349`), which keeps #35. A failed catalogue read shows fixed copy + Retry | One select "Default (chosen by Claude)", no nested card |
| 4 | "Reasoning Effort": segmented group, selected in primary, saves on selection with toast + Undo | `O:131-141`: daisyUI `join` group of `join-item` buttons, default / low / medium / high / xhigh / max (the real `effortLevels`), selected `btn-primary` + `aria-pressed`. Saving is unchanged (`state.saveSettings`, toast, Undo) | One segmented row, "medium" in primary (dark) / accent (light) |
| 5 | "Save to:" compact label + select on one row, host-valid scopes only | `O:143-150`: "Save to:" + select on one row (targets = `writeScopes` of the model and effort keys; "Desktop app" in VS Code is left for Batch 27b). It is shared by model, effort and the provider confirm. Re-saving the **current** provider to that scope (the old override-link capability, RUX-5) is a small "Save provider to {scope}…" link (`O:78-81`, `O:220-224`) that opens the same D6 confirm | One row "Save to: [Global · all apps ▾]" |
| 6 | No "Apply & Save"; Check connection small or last | No Apply (D2 / D6). Check connection is the small header button (`O:60-63`) | In the header |
| 7 | No height cap / inner scroll; fully visible at 1024×768 in both hosts | `max-h` / `overflow-y-auto` removed; width `w-[19rem]` (304 px) (`O:55`). Measured in the visual spec (it asserts the popover is fully inside the viewport): **VS Code 304 × 284 px at y=478 (below the node, as the prototype)**; **Electron 304 × 284 px at y=190 (flipped above the node, fully visible)** | All four fully on screen |
| — | Deviation 6 | Labels and values are base-content / muted; colour only on the selected effort segment | — |

Keyboard fixes found during the revise's Gate G, each with a spec:
- **Focus after "Enter a model ID…".** Run 1 of the revised Gate G failed: **6 failed / 21 passed**, `Test timeout of 180000ms exceeded` at #58 / #59 (log `%TEMP%\b26b-gateG-fail.log`).
  - The diagnostic single run's error context showed the popover stuck open with the manual field unfocused, left by #35.
  - Cause: the focus call ran before the `@if` swap rendered, so it focused the outgoing select. Focus fell to `<body>`, Esc could not close the popover, and its backdrop blocked every later entry.
  - Fix: `afterNextRender` focuses the field (`O:324-331`).
  - Spec: "'Enter a model ID…' swaps in a field… (#35)" now asserts focus.
- **Focus when the field closes.** Closing the field (Cancel, or a saved Use) returns focus to the select after render (`O:344-348`). The same spec asserts it.

Harness re-points in this revise:
- #16: Save-to select → "Save provider to This workspace…" → confirm → Cancel.
- #35: model select → "Enter a model ID…" → field.
- RUX-5: Save-to options "Global · all apps / Desktop app / This workspace" → rescope link → "Saved to: This workspace." → Cancel.
- The visual spec now waits for the model select and asserts the popover is fully in the viewport.

Re-verify (final tree):
- `npx nx run-many -t typecheck,test,lint -p <5 projects> --parallel=2` exited 0 (log `%TEMP%\b26b-verify.log`).
  - Tests: core 1083; ui 610; chat **1964 passed + 2 skipped**; webview 224.
  - Lint: 0 errors, warnings 11 / 30 / 41. On the way, an `@angular-eslint/no-input-rename` error (the aliased `focus` input, renamed `initialFocus`) and an unused spec import were fixed.
- Build exited 0, **no budget error** (`%TEMP%\b26b-build.log`).
  - Initial 971.59 kB over the 2.5 MB warning budget (3.47 MB).
  - Lazy `main-agent-reassign-popover-component` 16.46 kB.
- **Gate G `--repeat-each=3`: 27 passed** (1.7m), log `%TEMP%\b26b-gateG.log`.
- **Visual `--repeat-each=3`: 12 passed**, log `%TEMP%\b26b-visual.log`. `baseline-*` status is empty.
- The `libs/frontend/ui` and wizard diffs are empty.
