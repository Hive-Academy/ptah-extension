# P5 frontend fix round B: F2 and F3

Scope: F2 and F3 from `code-logic-review-p5-frontend.md`. I did not touch F1, F4 or F5, `accounts-tab.component.ts` or `provider-accounts-state.service.ts`. I made no commit.

## F2: Escape inside a nested modal closed the drawer

**Root cause, confirmed in source.** The drawer panel handler (`native-drawer.component.ts:272-278`) runs on Escape. It calls `preventDefault()`, then `stopPropagation()`, then emits `closed`. The modal's host keydown handler handled only Tab, so Escape bubbled up to the drawer. The drawer's `preventDefault()` also blocked the dialog's native `cancel`, so the modal never cancelled. The drawer closed instead.

**Change:** `libs/frontend/ui/src/lib/native/modal/native-modal.component.ts`.
- `onKeydown` (around lines 175-191) now checks first that the dialog is open. For Escape it then calls `event.stopPropagation()` and returns. It does not call `preventDefault()`, so the browser's default action still fires the native `cancel` event. `onCancel` then forwards that as `closed`, as before. Tab handling has not changed.
- While the modal is closed, Escape is not touched, so the drawer still closes on Escape.
- I updated the JSDoc on the class header and on the method to match.
- I did not change the drawer.

**New spec cases** in `native-modal.component.spec.ts`, in a new `describe('NativeModalComponent inside a NativeDrawerComponent')`. They use a real drawer and a real modal mounted together and dispatch a real bubbling keydown:
1. "keeps the drawer open when Escape is pressed inside the open modal": the drawer's `closed` count is 0, the drawer panel is still rendered, and `defaultPrevented` is false, so the native cancel path stays open.
2. "still closes the modal through its native cancel event": dispatching `cancel` emits the modal's `closed`, the dialog closes, and the drawer's `closed` count is 0.
3. "lets Escape close the drawer while the modal is closed": the drawer's `closed` count is 1.

**Other modal users checked.** These are the `<ptah-native-modal>` consumers:
- `provider-catalog-modal`
- `cli-tier-mapping-modal`
- `add-cli-instance-modal`
- `account-detail-view`
- `quarantined-agents-panel`
- `reconcile-guard`
- `setup-wizard/agent-selection`

Escape handlers inside the modal content run before the modal host does, so they still work. The one nested Escape consumer is `ptah-provider-model-search-field` in `cli-tier-mapping-modal`. It already calls `stopPropagation()` on Escape while its list is open (`provider-model-search-field.component.ts:340`), so nothing changes for it.

I also searched for document- or window-level Escape listeners that would no longer see an Escape from inside a modal:
- `native-autocomplete`
- `stash-popover`
- branch picker
- `skill-selection-card`
- `artifact-viewer`
- canvas

None of them is rendered inside any of the modal consumers listed above.

## F3: Accounts unreachable without an installed CLI

**Change:** `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`, `connections` computed (around lines 767-786). The filter is now:

`entry.configured || entry.id === selected || (this.accountsAvailable && this.isClaudeCli(entry))`

- `accountsAvailable` is the same `VSCodeService.isElectron` flag the page already passes to the drawer.
- `isClaudeCli` is the page's existing `connectionKind(...) === 'claude-cli'` helper.
- All other filter rules, the sort, and the D41 badge rules are unchanged; the badge still hides at 0.
- `catalog` takes the shown set from `connections()`, so the Claude card no longer appears twice in the catalog.

**New spec cases** in `providers-settings.component.spec.ts`, in `describe('with the Claude CLI not installed and another provider selected')`. The existing `setup()` takes a new optional parameter for the Claude connection, defaulting to the previous fixture. The fixture uses `configured: false` and the route driver `first`.
1. In Electron: the `first` card and the `claude-cli` card are both shown. Opening the Claude card's drawer gives `accountsAvailable() === true`.
2. Outside Electron: the `first` card is shown and the `claude-cli` card is not.

## Focused jest results (run under the verify lock)

- `npx jest -c libs/frontend/ui/jest.config.ts libs/frontend/ui/src/lib/native/modal/native-modal.component.spec.ts`: 1 suite, **19/19 passed**. The output includes a jsdom "requestSubmit not implemented" console error from the existing backdrop test, which already documents that error.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts`: 1 suite, **84/84 passed**.
- Extra check for other users of the providers page and the accounts folder: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/settings.component.spec.ts libs/frontend/chat/src/lib/settings/providers/accounts`: 7 suites, **161/161 passed**. That folder includes specs in files that the other developer is editing in parallel; they passed at the time of the run.
- `ptah_get_diagnostics` on the 4 changed files reports no diagnostics. The sibling errors it lists are pre-existing, in unrelated chat spec files.
- Not run: `npm run verify`, lint, typecheck and builds, as the brief instructed.

## Decisions

- **F2 fixed in the modal, not the drawer.** The alternatives were containing Escape in the modal or having the drawer ignore Escape from a descendant modal. The brief says to fix it in the modal, and the review offers that as the first option. This is reversible.
- **Only `stopPropagation()`, no `preventDefault()`.** Calling `preventDefault()` on Escape suppresses the dialog's native `cancel`, which is the very mechanism the modal relies on to close. This is reversible.

## Deviations

None. I changed exactly the 4 assigned files.

## Open points

- The jsdom tests prove the bubbling contract. Real Chromium firing `cancel` after an unprevented Escape is the platform's behaviour and is not exercised in jsdom. A manual Escape check of Profile → Remove account in Electron would confirm it end to end.
- The existing `account-detail-view.component.spec.ts:369` test still dispatches `cancel` directly, as the review noted. The new modal-in-drawer spec covers the keydown path in the shared component. I did not edit the account spec because it is not one of the files assigned to me.
