# Batch 55b report (frontend fixes from the final PR #631 review) and 55c (55a UI contract)

Head at start: a75417e2b; the coordinator's 2b4120164 (comment-only audit markers) landed during the batch, and my edits
to `settings-save-feedback.service.ts` sit on top of it (both kept). No commit, no batches.md edit. The session was
ended by the coordinator: the items below marked NOT DONE were not started (no half-edited file).

## DONE / NOT DONE

| Item | State |
| --- | --- |
| F1 checkbox / radio / toggle Tab ring | DONE |
| F2 provider card focus ring | DONE |
| F3 matrix cell popover during a held save | DONE (unit specs; no new Playwright scene) |
| F4 built-in Edit/Delete icons | DONE (optional tweak, opacity 50) |
| F5 "Command-line parity" summary ring | DONE |
| F6 / F7 | no action (as instructed) |
| M-7 order-strip ResizeObserver | DONE |
| m-1 Undo after a newer bypassing write | DONE |
| m-2 `@error` for the deferred wizard | DONE |
| m-3 Ultracode enable when effort is already xhigh | DONE |
| m-4 busy directive blocks copy / select-all / caret keys | DONE |
| m-5 go-vet success timer | DONE before this batch (already cleared on destroy, with a spec) |
| CS-1 inline toast | DONE |
| CS-2 output-style editor and list over 700 lines | DONE |
| CS-7 spec codes in comments | no change (see below) |
| CS-8 bare `catch (error)` | DONE for the frontend; the two app bootstraps were already fixed by 55a |
| 55c M-3 Cursor key "not removed" | DONE (UI already correct; spec added) |
| 55c M-5 `CONNECTION_IN_USE` | NOT DONE (session ended before it was started) |
| 55c M-6 `keyUnreadable` per-row state | NOT DONE (session ended before it was started) |

## Visual

### F1 (Serious): light-theme Tab ring on Settings checkboxes, radios and toggles

- **Cause:** daisyUI's `.checkbox-primary:focus-visible` (and `.radio-primary`, `.toggle-primary`) colours the outline
  primary teal, which measured 1.4:1 on anubis-light. A plain `.toggle` ring is base-content at 20 %.
- **Fix, once for Settings:** `apps/ptah-extension-webview/src/styles.css` has a new rule in the existing
  `@layer components` block, after daisyUI and before the utilities:
  ```css
  :where(ptah-settings) :is(.checkbox, .radio, .toggle):focus-visible {
    outline-style: solid; outline-width: 2px; outline-offset: 2px;
    outline-color: var(--fallback-bc, oklch(var(--bc) / 1));
  }
  ```
- **Why it wins:** it has the same specificity as `.checkbox-primary:focus-visible` (0,2,0) and comes later. An explicit
  `focus-visible:outline-*` utility still wins over it.
- **Contrast:** the ring is the full base-content colour that the review measured for the redesign's other rings.
  - Light: rgb(41,19,52) on rgb(250,247,245) is above 5.5:1; the review measured the same colour at 5.5–19:1 across
    surfaces.
  - Dark: rgb(232,230,225) on the dark base is above 3:1; the review measured 3.35:1 for the old blue ring and more for
    base-content.
  - So every Settings checkbox, radio and toggle ring is at least 3:1 in both themes. The listed sites need no
    per-site change: `web-search-config:159`, `agent-behaviour-section:132,211,236`, `mcp-port-config:141,169`,
    `output-style-parity-section:75`, `output-style-list:286`, and the editor's toggle and radios.
- **Not measured in a browser this batch:** no Playwright run (see Verification). The numbers come from the review's
  own measurement of this colour.
- **Spec:** `apps/ptah-extension-webview/src/app/settings-shared-styles.spec.ts` has the test "a Settings checkbox,
  radio or toggle Tab ring is a solid full base-content outline (Batch 55b F1)".

### F2 (Serious): provider card focus ring

- **Change:** `libs/frontend/ui/src/lib/native/card/native-card.component.ts`. The interactive card's ring
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60` is now
  `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content`,
  which is the Retry link's ring.
- **Contrast:** it was 1.3:1 in light (primary/60) and about 2:1 in dark. It is now the full base-content outline: at
  least 5.5:1 in light and well above 3:1 in dark, from the review's base-content figures.
- **Selected cards:** a selected card keeps its `ring-2` box-shadow. The outline is separate, so focus and selection
  both show.
- **Other NativeCard users:**
  - Interactive (clickable or selectable), so they get the same outline: the provider connection card,
    `skill-synthesis-ui` clone-card (clickable) and `skill-candidates-table` (selectable).
  - All other users are not interactive and are unchanged.
  - Not captured this batch.
- **Spec:** `native-card.component.spec.ts` has the test "draws a full-opacity base-content outline as its Tab ring…".

### F3 (Moderate): matrix cell popover during a held save

- **Keyboard path.**
  - Cause: Esc closed the popover, but the cell trigger was natively `[disabled]="busy()"`, so the popover's
    restore-focus landed on `body`.
  - Fix: the Model and Effort cell triggers (`cli-orchestration-matrix.component.ts:197,221`) now use
    `[ptahBusyDisabled]="busy()"`. While the save runs they are aria-disabled and focusable, so focus returns to the
    cell.
- **Mouse path.**
  - Cause: a row of the model list has `tabindex="-1"`, so the pick moved focus onto it. The row was then removed when
    the list closed, which left focus on `body`, where Esc does not reach the popover.
  - Fix: `provider-model-search-field.component.ts` adds `keepFocusOnPick`, which cancels the mousedown on a
    `[role="option"]` row. Focus stays in the (aria-disabled) search field, Esc reaches the popover, and the click still
    selects.
  - That field is used only in Settings (the 54.2 finding).
- **Specs:**
  - matrix: "Batch 55b F3: while a cell save runs, Esc closes the popover and focus returns to the cell (aria-disabled,
    not native)";
  - search field: "a mouse pick keeps focus in the field…".
- **Not added:** a Playwright scene for F3.

### F4 (optional) and F5

- **F4:** in `output-style-list.component.ts` the built-in Edit and Delete icons use `disabled:opacity-50` instead of
  40, about 3:1 in light by the review's estimate. Spec "F4 (Batch 55b)…" in the list spec.
- **F5:** in `output-style-parity-section.component.ts` the `<summary>` gets the Settings ring
  (`focus-visible:outline … outline-base-content`, with `rounded`) and `data-testid="output-style-parity-summary"`.
  Spec in `output-style-list.component.spec.ts`.

## Logic

- **M-7** (`agent-orchestration-config.component.ts`)
  - The single lazily created observer is replaced by an effect that observes the current `orderStrip` element and
    disconnects it in `onCleanup`, which runs on re-run and on destroy. A strip re-created under `@if` is observed, and
    the old one is released.
  - The measure-on-change effect is separate. `DestroyRef` is no longer needed.
  - Spec: "M-7 (Batch 55b): an order that empties and refills makes a new strip…".
- **m-1** (`settings-save-feedback.service.ts`)
  - The service keeps the Providers commit the Undo was offered after (`undoCommit`).
  - The Undo is refused with the fixed `UNDO_STALE_MESSAGE` ("A newer change replaced this one, so it was not undone.")
    in one case: a later commit, such as a drawer `runDrawerWrite`, saved, failed or left unconfirmed one of the same
    fields.
  - A later write of other fields keeps the Undo, so the existing m1 contract still holds.
  - `announce()` already cleared the Undo.
  - Two specs.
- **m-2** (`providers-settings.component.ts`)
  - The deferred wizard has an `@error` with a fixed `role="alert"`: "The setup wizard could not be loaded. Close this
    message and try again."
  - Its Close calls `closeWizard()`, which also consumes the deep link.
  - Spec (renders `DeferBlockState.Error`).
- **m-3**
  - `EffortStateService.setEffort` (core) now resolves the write's own result (`Promise<boolean>`). Callers that ignore
    it are unaffected.
  - `UltracodeStateService.enable()` and `disable()` decide from that result, not from a read-back. So a failed pin
    while effort is already `xhigh` stays off.
  - `agent-behaviour-section` `writeEffort` uses the result the same way.
  - Specs in core (`effort-state`) and chat (`ultracode-state`, two new m-3 cases). The mocks in the message-sender and
    agent-behaviour specs return the result.
- **m-4** (`busy-disabled.directive.ts`)
  - Ctrl/Cmd+C and Ctrl/Cmd+A pass on any busy control.
  - Caret keys (arrows, Home, End) and a mousedown (to place the caret or select text) pass in a read-only text field.
  - The text-field check reads `type` lazily.
  - Two specs.
- **m-5:** already done: `go-vet-consent-config.component.ts:404` clears the timer on destroy, and spec :612 covers it.
  No change.

## Style

- **CS-1**
  - `feedback/settings-toast.component.ts` has an `inline` input that renders the same toast body in the flow of the
    panel. It has no fixed region and no shadow, and its test ids carry `-inline`.
  - The Undo is now `[ptahBusyDisabled]` in both modes; it was native `disabled` on the page toast.
  - `models-tiers-tab.component.ts` uses `<ptah-settings-toast [inline]="true" />` in place of its hand-copied markup.
  - Specs updated: the toast spec has two inline tests; models-tiers queries `settings-toast-inline*`; the harness
    `settings-reachability.table.ts` RUX-2 now uses `settings-toast-inline-undo`.
  - Visible change in the drawer (the toast look) is expected; not captured this batch.
- **CS-2** (facade rule: the selectors, inputs and outputs of the editor and the list are unchanged)
  - Editor, 789 → 682 lines. NEW `output-style-instructions-field.component.ts`
    (`ptah-output-style-instructions-field`) holds the keep-default-instructions toggle and the Instructions body with
    Edit | Preview. The editor binds `[(keepCodingInstructions)]` and `[(body)]` and owns both values.
  - List, 788 → 622 lines. NEW `output-style-notices.component.ts` (`ptah-output-style-notices`) holds the
    failed-operation alert, the missing-active, collision and fallback banners, and the copy-to-project confirm.
    "Clear the selection" emits `clearSelection`, so the list's parity flow still applies.
  - While moving it I found that the "Copy to this project" button was natively disabled while busy, although a copy is
    a save that can start from it. It is now `[ptahBusyDisabled]`, with a spec. This is a 54.1 audit miss.
  - Specs: the editor spec drives the child for the preview tests and adds a two-way binding test. The new files are in
    the `[innerHTML]` check list.
- **CS-7:** no comment rewritten. The comments I touched state the behaviour in words.
- **CS-8**
  - Frontend: the harness `settings-cli-matrix.entries.ts:279,290` and `settings-reachability.table.ts:123,129` now use
    `catch (x: unknown)`.
  - `apps/ptah-electron` and `apps/ptah-extension-vscode` bootstrap `catch (loadError: unknown)` were already fixed in
    55a.

## 55c (the 55a UI contract)

- **M-3, DONE:** the Cursor popover already says "The stored key was not removed." for a failed remove (never "not
  saved"). The commit's message is fixed copy, and the state re-reads `cursorApiKeyStored`, so the key stays shown as
  stored. New spec "55c (final review M-3)…" in `cursor-credential-popover.component.spec.ts`.
- **M-5, NOT DONE:** map `provider:removeCustomEntry` `errorCode: 'CONNECTION_IN_USE'` to "Switch the main agent
  first." This is in `providers-connection-setup.service.ts:360-376` (core): `require()` must expose the error code, or
  the write must catch it. Not started.
- **M-6, NOT DONE:** a per-row "Could not read the stored key." state with a retry for `keyUnreadable: true` (core
  connection mapping in `providers-settings-state.service.ts` `readConnections`, card and drawer), plus a harness
  fixture case. Not started.

## Verification

- `nx run-many -t typecheck,lint -p chat,ui,core,webview-e2e-harness,ptah-extension-webview`: Successfully ran
  typecheck and lint for 5 projects.
- `nx run-many -t test -p chat,ui,core,ptah-extension-webview -- --maxWorkers=2`: Successfully ran test for 4 projects.
- **Not run this batch** (the session was ended before them):
  - `nx build ptah-extension-webview`;
  - Gate G;
  - the full settings Playwright folder (not started);
  - webview-e2e-harness Jest (it has no Jest target touched; typecheck and lint pass).
  - Pending: the RUX-2 test id change and the visual changes (F1/F2 rings, the inline toast) still need the next build,
    Gate G and folder run.
- **Captures:** none rewritten in this batch. `screenshots/final-pr/` is the reviewer's untracked evidence.
- **File sizes:** editor 682, list 622, notices 232, instructions field 140; the search field is 337.
