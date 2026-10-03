# Batch 27: provider catalog modal

The provider catalog is now a command-palette modal built on `NativeModalComponent`, matching prototype `#modalPalette`. It opens from three places:

- the header "Connect provider" button;
- the new "+ Connect another provider" tile in the grid;
- the new hint strip's "Browse catalog →".

Choosing a provider closes the modal and opens the unchanged setup wizard for it. The modal loads in `@defer`. The initial bundle grew by 0.40 kB and there is no budget error. Gate G passed 27/27 with `--repeat-each=3`, and the visual spec passed 12/12.

Nothing is committed; the working tree is dirty for the team-leader.

## Files

| Change | Path | Lines | What |
| --- | --- | --- | --- |
| CREATED | `libs/frontend/chat/src/lib/settings/providers/provider-catalog-modal.component.ts` | 146 | The palette: search, list, empty state, error, loading, custom endpoint row |
| CREATED | `libs/frontend/chat/src/lib/settings/providers/provider-catalog-modal.component.spec.ts` | 130 | 9 specs |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` | 590 (≤ 700) | Openers, tile, hint strip, deferred modal, `more-providers` landing; the `<details>` catalog is removed |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts` | | Wizard tests now go through the catalog; 4 new specs |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-drawer.reach.ts` | | `catalogDialog`, `expectCatalogOpen`, `connectProviderButton`, `openCatalog`, `closeCatalog` |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts` | | `throughCatalog`, `throughBlankWizardCustomOption` and #1 re-pointed; new RUX-3; count 87 → 88 |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts` | | Catalog capture, with centring and on-screen measurements |

Checked and left unchanged:
- **`settings.component.ts`:** `more-providers` is already in `PROVIDERS_SECTIONS` (`settings.component.ts:52`), and its routing is covered by `settings.component.spec.ts:170`.
- **`ProviderSetupWizardComponent`:** `git diff --stat` on the wizard file is empty.

## Acceptance → file:line → spec

All `.ts` paths below are in `libs/frontend/chat/src/lib/settings/providers/` unless stated otherwise. The page spec is `providers-settings.component.spec.ts`; the modal spec is `provider-catalog-modal.component.spec.ts`.

| Requirement | Where | Proven by |
| --- | --- | --- |
| **Command-palette modal on `NativeModalComponent`** | `provider-catalog-modal.component.ts:29` | Modal spec `:54` |
| — `ariaLabelledby` points to the sr-only h2 "Connect a provider" | same | same |
| — `size="md"`, which is `max-w-lg` as in the prototype | same | same |
| **`data-testid="provider-catalog-modal"`** | `provider-catalog-modal.component.ts:30` | Modal spec `:54` |
| **Search with the catalog count** ("Type provider name (N in catalog)…"), filtering by name or id | `:33-35`, rows computed at `:125-137` | Modal spec `:54`, `:68` |
| **"Available in catalog (N unconfigured)" and rows** (initials avatar, name, detail) | `:54-78` | Modal spec `:54` |
| — The detail line is modality · registry description · "Default models available" | same | same |
| **No match: "No matching providers." with "Clear search"** | `:79-84` | Modal spec `:68`; Gate G RUX-3 |
| **"Sign in to X" kept for sign-in and CLI entries only** | `:69-72` | Modal spec `:78` |
| — It closes the modal, then calls `externalAction(id, 'sign-in')` | page `catalogSignIn` `:570` | Page spec `:560` |
| **`providerChosen` closes the modal, then calls `openWizard(id)`** | page `chooseCatalog` `:564-569`; binding `:161-165` | Page spec `:560` |
| **Custom endpoint calls `openWizard('')`** | modal `:88-100`; page binding `customChosen` → `chooseCatalog('')` | Page spec `openWizardThroughCatalog` `:154`; used by 7 wizard specs |
| **Setup gating: Connect and Configure are disabled when setup cannot start** | modal `:73`, `:97` | Modal spec `:86` |
| — The openers themselves stay enabled: opening is a read, so a failed read is reachable inside the modal | page `:61`, `:131`, `:158` | Page spec `:573`, which opens it through "Browse catalog" during a failed read |
| **Loads in `@defer`** | page `:161` (`@defer (on immediate)`) | Build: lazy chunk `provider-catalog-modal-component` 8.81 kB |
| **Batch 2b carry-forward: a load error is shown with Retry** | modal `:41-46`; page `catalogStatus` `:290` | Modal spec `:92`; page spec `:573` |
| — The error signal is `state.connections()` status `error`, and that read includes `provider:listCustomEntries` | same | same |
| — Copy: "Custom providers could not be loaded. Your saved settings have not changed." | same | same |
| — Retry calls `state.refreshConnections()` | same | same |
| **Loading skeleton with `aria-busy`** | modal `:47-52` | Modal spec `:102` |
| **Every opening starts from the full catalog** | modal `:139-142` | Modal spec `:107` |
| **Esc and the backdrop close the modal** | `NativeModalComponent` `(closed)` → `catalogOpen.set(false)` | Modal spec `:125`; Gate G RUX-3 |
| **Batch 14 finding 3: focus moves into the dialog on open** | The search is the dialog's first focusable control, so `showModal()` focuses it. No `autofocus`: the lint rule `no-autofocus` forbids it. | Modal spec `:54`; Gate G `openCatalog` asserts the search is focused |
| **Batch 14 finding 3: Tab stays inside the dialog** | native `<dialog>` | Gate G RUX-3: 12 Tab presses, and `dialog.contains(activeElement)` after each |
| **Batch 14 finding 3: Esc closes and focus returns to "Connect provider"** | native `<dialog>` | Gate G `closeCatalog` (RUX-3 and #1) |
| **Batch 14 finding 3: the backdrop closes and focus returns** | same | Gate G RUX-3: a click at (5,5), then "Connect provider" is focused |
| — After a wizard opened from the catalog closes, focus returns to the catalog's opener | page `:568` (`returnFocus = catalogOpener`) | Page spec `:623` |
| **The `more-providers` route lands on the modal** | page `:404-408`: focuses "Browse catalog →", then opens the modal | Page spec `:540`, `:577` ("honours a new parent focus target") |
| **"+ Connect another provider" tile** (prototype `:402-405`) | page `:129-133` | Page spec `:547` |
| **"Browse catalog →" hint strip** (prototype `:410-416`) | page `:153-159`, `catalogHint` `:295` | Page spec `:547`, `:573` |
| — The hint never says "0 providers" for a failed or pending read, and uses the singular for one provider | same | same |
| **Harness RUX-3 entry** | `settings-reachability.table.ts:807` | Gate G 27/27 |
| **Control size and focus ring** | modal and page | Modal spec `:115`: every palette control is `min-h-6` with `focus-visible:outline-2`. Page spec "36px…" now covers the tile (80 px) and the hint button (`btn-xs`). |

## Old entry points → new place

| Before (Batch 26 tree) | Now |
| --- | --- |
| Header "Connect provider" opened the wizard blank | Opens the catalog modal. The blank wizard is its "Custom endpoint gateway → Configure". |
| `<details>` "More providers" disclosure (`summary[data-focus="more-providers"]`) | The hint strip's "Browse catalog →" (`data-focus="more-providers"`), which opens the modal |
| `#providers-catalog-search` inside the disclosure | The modal's search (`data-testid="provider-catalog-search"`) |
| "Set up {name}" per catalog row | "Connect" per modal row (aria-label "Connect {name}") |
| "Sign in to {name}" per catalog row | The same action and aria-label in the modal row, for oauth and cli entries |
| "Custom endpoint · choose Custom in setup" | Modal row "Custom endpoint gateway", button "Configure" (aria-label "Configure a custom endpoint") |
| `more-providers` deep link opened and focused the disclosure | Focuses "Browse catalog →" and opens the modal. Closing returns focus to it. |
| Page-level `search` signal, `FIELD` and `field`, `inputValue`, `modalityLabel` | Removed. Filtering and modality labels live in the modal. |

## Write-path trace

The catalog modal performs no writes itself:

- **Connect X:** `providerChosen(id)` → `chooseCatalog(id)` → `catalogOpen.set(false)` → `openWizard(id)`. The unchanged wizard's `commitRequested` → `state.connectProvider(draft, context)`. This is the same path as before, and page specs `:593` and `:607` still assert it.
- **Configure:** `customChosen` → `chooseCatalog('')` → `openWizard('')`, then the same wizard commit path.
- **Sign in to X:** `signInRequested(id)` → `catalogSignIn(id)` → `externalAction(id, 'sign-in')` → `state.performExternalAuth(id, 'sign-in')` (page spec `:560`).
- **Retry:** `retryRequested` → `state.refreshConnections()`. This is a read (page spec `:573`).

## Verification

1. **Unit, type and lint checks.** `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2` exited 0 ("Successfully ran targets typecheck, test, lint for 5 projects"). Log: `%TEMP%\b27-verify.log`.
   - Tests: core 1083/1083; ui 610/610; chat **1976 passed + 2 skipped** (1978; Batch 26 had 1965); webview 224/224.
   - Lint: 0 errors. Warnings are unchanged: core 11, chat 30, harness 41.
   - The first run failed chat lint on `@angular-eslint/template/no-autofocus` (the search input's `autofocus`). I removed the attribute rather than waiving the rule: the search is the dialog's first focusable control, so `showModal()` focuses it, and Gate G asserts that.
   - After the last harness-only edits, `nx run-many -t typecheck,lint -p @ptah-extension/webview-e2e-harness` exited 0, still 41 warnings (`%TEMP%\b27-harness-lint.log`). The table raised no new `max-lines` warning.
2. **Build.** `npx nx build ptah-extension-webview --skip-nx-cache` exited 0 with **no budget error** (`%TEMP%\b27-build.log`).
   - Initial total: **before 971.59 kB over the 2.5 MB warning budget; now 971.99 kB over (3.47 MB)**. That is +0.40 kB eager, for the openers, the hint strip and the `@defer` stub.
   - The modal is its own lazy chunk: `provider-catalog-modal-component` **8.81 kB** (3.00 kB transferred).
3. **Gate G.** Final `settings-reachability.e2e.spec.ts --reporter=list --repeat-each=3` gave **27 passed (2.0m)**, exit 0. Log: `%TEMP%\b27-gateG.log`. One earlier red run, diagnosed before any re-run:
   - **Run 1: 6 failed / 21 passed**, all "every present/restored capability is reachable" with a 180 s timeout (`%TEMP%\b27-gateG-first-fail.log`).
   - **Cause:** daisyUI's `.modal` keeps a *closed* `<dialog>` laid out at opacity 0, so Playwright's `toBeHidden()` never passes.
     - `throughCatalog` threw after "Connect" but before its `try/finally`, so the wizard it had opened was never closed. Every later entry then stalled on the wizard's discard review.
     - A JSON-reporter step dump (`%TEMP%\b27-gateG-steps.json`) showed #5-#15 at 15-25 s each.
   - **Fix:** the open state is now asserted on the dialog's `open` attribute (`expectCatalogOpen`), not on visibility. A single vscode run then passed in 64 s, and the final `--repeat-each=3` run passed 27/27.
   - There was no worker crash (0xC0000409) in this batch.
4. **Captures.** Final `settings-visual.e2e.spec.ts --reporter=list --repeat-each=3` gave **12 passed (47.0s)**, exit 0 (`%TEMP%\b27-visual.log`).
   - New files: `current-provider-catalog-{vscode,electron}-{anubis,anubis-light}-1024x768.png`.
   - Measured: **512×461 at y=154** on every host and theme. That is `max-w-lg`, centred in its dialog to within 1 px, and fully on screen.
   - Two red runs, both caused by my measurements and both fixed (`%TEMP%\b27-visual-first-fail.log`):
     - **Centring was off by 5 px.** The fixed full-screen dialog excludes the host's scrollbar gutter, so centring is now checked against the dialog's own box, not the window.
     - **Sizes varied between 490 and 512 px.** daisyUI's scale-in transition was still running; the measurement now waits for the box's animations to finish.
   - `git status --short -- .ptah/specs/TASK_2026_555/screenshots/angular/ | grep -c baseline` gives **0**: no `baseline-*` file was touched.
5. **Jest (targeted):** the catalog-modal and page specs pass, 59/59, and are included in the chat count above.

## Capture comparison (prototype `#modalPalette`, `index.html:743-826`; hint strip `:410-416`; tile `:402-405`)

These match the prototype:

- **Palette layout:** a centred `max-w-lg` panel. Its header strip is `bg-base-200` with a bottom border and holds, in order: a primary-coloured search icon, a transparent `input-xs`, and an `ESC` kbd.
- **Placeholder:** "Type provider name (10 in catalog)…" (the fixture has 10 unconfigured providers).
- **Body:** a `max-h-[50vh]` scrolling body with the uppercase 10 px "Available in catalog (10 unconfigured)" label.
- **Rows:** each row has a 2-letter avatar, a bold name, a muted 10 px detail line, and an outline `btn-xs` "Connect" on the right.
- **Custom row:** "Custom endpoint gateway" sits in a `bg-base-200` row under a top border, with an outline "Configure".
- **Page:** the dashed "+ Connect another provider" tile sits in the grid after the cards. The `bg-base-200` hint strip below the grid reads "10 catalog providers ready to add: Claude API, OpenRouter, …" with "Browse catalog →".
- **Themes:** light and dark both render correctly (`current-provider-catalog-electron-anubis-light` checked).

Deliberate differences:

- **Button colour.** The prototype's Connect is `btn-outline btn-primary`, which gives primary-coloured text. Here it has a primary border with base-content text, because of deviation 6: colour only on icons, dots and badges, and text stays base-content. The "Browse catalog →" text is base-content for the same reason.
- **Row detail text** comes from the registry (modality · description · "Default models available"), not the prototype's sample copy.
- **The sign-in row** keeps "Sign in" next to "Connect" for sign-in and CLI entries (a requirement; the prototype has no such button).
- **The tile uses a primary dot** where the prototype has a plus-circle icon. The eager page imports no icon module, and I did not add one to the budget-bound eager bundle.
- **The search input shows the visible focus ring** where the prototype has `focus:outline-none`. That is intentional for keyboard users, and it matches every other control in this redesign.

## Deviations and notes

1. **The openers are no longer disabled when setup cannot start.** Before, "Connect provider" was disabled on `!canStartSetup()`, which includes a failed connections read. That would have made the Batch 2b error and Retry unreachable. The openers now always open the modal; Connect and Configure inside it carry the `canSetUp` gate.
2. **`autofocus` removed** (lint rule `no-autofocus`). Initial focus comes from `showModal()` choosing the first focusable control, which is the search.
3. **Modal size is `md` (`max-w-lg`)**, per the prototype, not `lg`.
4. **The hint strip and tile were added now**, because the prototype's openers need somewhere to live. Batch 28 (the page fold) may reorder them. The hint strip currently sits after the clear-override review section, which is directly below the grid when that section is closed.
5. **The Batch 14 finding 3 assertions live in Gate G RUX-3** and the `openCatalog` and `closeCatalog` helpers (the reachability spec), as instructed for now. jsdom has no `showModal`, so the Jest specs polyfill it and assert only events and markup.
6. **Out of scope, observed and not touched:** `NativeModalComponent`'s backdrop button has no accessible name beyond "close" and no focus ring (`native-modal.component.ts:78-80`). It is a shared primitive owned by `ui`.
