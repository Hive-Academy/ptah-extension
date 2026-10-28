# P3 fix round, frontend part (TASK_2026_701_9e4b)

Scope: P3 logic findings L2 and L3, plus D41(c). Edits are only in `libs/frontend/marketplace`.
No changes to `libs/backend`, `libs/shared` or setup-wizard (D34).

## Files

- MODIFIED `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts`: subscribes to
  `LibraryChangeFeed` and adds the failed-pass state and `recordLibraryPass`.
- CREATED `libs/frontend/marketplace/src/lib/pages/skills/installed-library-stale-notice.component.ts`:
  the C10 child component.
- MODIFIED `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts`: mounts
  the notice (3 lines).
- MODIFIED `libs/frontend/marketplace/src/lib/pages/skills/plugin-config-home-notice.component.ts`:
  hands `libraryPass` to the store.
- MODIFIED `libs/frontend/marketplace/src/lib/external-marketplaces.component.ts`: fixed consent
  failure state.
- MODIFIED `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts`: fixed copy and a
  boolean input.
- MODIFIED `libs/frontend/marketplace/src/lib/kept-items-repair-prompt.component.ts`: has the same
  raw-error pattern (Batch 24/25 file).
- Specs MODIFIED: `marketplace-inventory.store.spec.ts`, `installed-skills-page.component.spec.ts`,
  `plugin-config-home-notice.component.spec.ts`, `external-marketplaces.component.spec.ts`,
  `external-consent-dialog.component.spec.ts`, `kept-items-repair-prompt.component.spec.ts`.

## Fix 1: L2, the inventory consumes `LibraryChangeFeed` (`marketplace-inventory.store.ts`)

- `:432` `libraryChangeEffect` reacts to each new `feed.latest()`. It follows the feed contract
  (`library-change-feed.ts:24`) and the consumer pattern of `skill-clones-state.service.ts:169`.
  - A push that the feed held before the store existed is ignored, because `seenLibraryChange` is
    captured untracked at `:317`. That push predates the visit, so the first read already
    reflects it.
  - Construction stays RPC-free.
- `:552` `onLibraryChanged` clears the `@agent` autocomplete cache, then reloads only the
  non-idle slices through `reloadRequested` (`:491`).
  - `reloadRequested` now returns a "did this read publish" promise for each slice.
  - `load` returns `true` only after it passes its existing guards (destroyed, slice generation,
    workspace generation).
  - A stale or overtaken reply publishes nothing and records nothing.
- The plugins slice data is now `LibraryCopies { clones, scopeRoot }`. `readLibraryClones` keeps
  the `scopeRoot` from `skillSynthesis:listClones` (B13). `libraryClones` is a computed signal
  over `.clones`, so its public type is unchanged.
- The failed-pass state is root-scoped: `libraryPassFailed` (`:387`).
  - It is set only when the plugins read published and the push's `workspaceRoot` equals that
    read's `scopeRoot`.
  - A same-root `failed` push sets it and a same-root `updated` push clears it (`:559`).
  - A push for another root, or a missing `scopeRoot`, leaves it unchanged.
  - A workspace switch clears it (`:421`).
  - Outside Electron it stays `false`: the feed is inert there, and `recordLibraryPass` checks
    `isElectron`.
- The store stays shell-scoped. "Visited and left" works because the page is destroyed while the
  shell's store stays alive and keeps re-reading. A visit that starts after leaving the
  Marketplace creates a fresh store, which reads fresh data.
- The page renders `<ptah-installed-library-stale-notice />` inside its existing `isElectron()`
  block (`installed-skills-page.component.ts:142`). The markup lives in the child component:
  - Text: `alert alert-warning`, `role="status"`, "The Library may be out of date until its next
    refresh."
  - This is the design-spec "library stale" Marketplace row (design-spec.md:195).
  - The same alert role and classes are used by the existing Marketplace C10 in
    `kept-items-repair-prompt.component.ts`.

## Fix 2: D41(c), C10 after a config-home choice (`plugin-config-home-notice.component.ts`)

- `:233` captures `WorkspaceScopeService.generation()` before the call.
- `:245`: on success, `inventory.recordLibraryPass(result.data.libraryPass, workspace)` runs
  before the plugins reload.
  - The store method is at `marketplace-inventory.store.ts:467`.
  - It drops an answer for a workspace that is no longer active.
  - `failed` sets the state, `updated` clears it, and `not-applicable` or an absent value
    changes nothing.

## Fix 3: L3, no raw error text in the consent dialog (D40 resolved)

- `external-marketplaces.component.ts:570`: `consentError: string | null` is replaced by
  `consentFailed = signal(false)`.
  - `:888` (failed envelope, formerly `:883`) and `:906` (thrown error, formerly `:901`) only
    set `true`.
  - The original error stays in the host log.
- `external-consent-dialog.component.ts:523`: the input is now `installFailed = input(false)`.
  Nothing can pass a reason in.
  - `:458` renders fixed copy with `role="alert"` and `data-testid="external-consent-error"`:
    "Install failed. Ptah removes what it wrote for this install where it can. Check the files
    listed in the install report, then retry."
  - "Retry install" is kept (`:601`).
- The same check on the other new Batch 24-25 components (a grep of the diff against `main` for
  `.error`, `messageOf(` and `error.message`) found one more case:
  - `kept-items-repair-prompt.component.ts:667` wrote `response.error` raw.
  - It now shows the host text only when the reply carries an `errorCode`. That is the
    `RpcUserError` branch of `rpc-handler.ts:226-240`, which is deliberate user copy (for
    example "Some of these items can no longer be replaced from here. …").
  - Any other failure text is the raw exception and becomes the fixed `REPLACE_FAILED_COPY`
    (`:32`).
  - `external-install-report` and `skill-detail` render no raw error text. Per-item `error` in
    the repair prompt is only used as a flag.

## Specs added or updated

- Store, `describe('library:changed pushes')`:
  - A push before any request reads nothing.
  - Only requested slices reload, and the cache is cleared.
  - A push that predates the store is ignored.
  - Same-root failed sets the state and updated clears it.
  - A foreign-root failure leaves the state unset.
  - No `scopeRoot` records nothing.
  - **A workspace switch during the push's reload drops the stale reply** and records nothing.
  - A switch clears the state.
  - `recordLibraryPass`: current, stale-generation and non-Electron cases.
- Page, `describe('library:changed and C10')`:
  - **A push while mounted** re-reads, and the shadow mark appears.
  - C10 shows (role `status`, exact copy) and then clears.
  - **A push after the page was visited and left** re-reads while unmounted, and on return shows
    fresh data and the notice with no extra read.
  - **A foreign-root failure shows nothing.**
  - Nothing happens outside Electron.
  - **An adopt answering `libraryPass: 'failed'` shows C10**, and `updated` does not.
- Notice spec:
  - The adopt `failed` answer is recorded with the call-start generation, before the reload.
  - A failed call records nothing and leaks no sentinel.
- Consent dialog spec: "renders an error without dismissing the dialog" now asserts the exact
  fixed copy. There is also a "no failure before a failed confirm" case.
- External marketplaces spec:
  - **The sentinel path `C:\Users\secret\x`**, in a failed envelope and in a thrown error, never
    appears in the dialog.
  - Fixed copy and "Retry install" are shown.
  - The `consentError` assertions moved to `consentFailed`.
- Repair prompt spec:
  - The refusal case carries `INVALID_PARAMS`.
  - A new case shows that a raw EACCES with the sentinel path renders only fixed copy.

## Verification

Command:
`npm run verify -- -p @ptah-extension/marketplace,ptah-extension-webview`

The run waited about 460 s for a lock slot.

- Result: `NX 6 tasks: 5 succeeded, 1 failed`. Cache: 0/5 hit.
- Failed: `✖ nx run ptah-extension-webview:lint`, from
  `Circular dependency between "ptah-extension-webview" and "@ptah-extension/command-center"`.
  This is the accepted pre-existing D19 failure, not in the files changed here.
- Passed: marketplace lint, test and typecheck; webview test and typecheck.
- `ptah_get_diagnostics` on the edited sources showed no errors in the requested files. The
  errors it showed are in pre-existing sibling files: `core` testing mock, shared BigInt target,
  `harness-health.store.spec.ts:672`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| C10 copy and role on the installed page: "The Library may be out of date until its next refresh.", `role="status"`, `alert-warning` | Library page copy "Could not refresh the Library…" with `role="alert"`, or the Marketplace design row | design-spec.md:97 and :195 give the Marketplace C10 a non-fatal warning; `kept-items-repair-prompt` and `external-install-report` already use `role="status"` | yes |
| "Root-scoped" means the state is matched to the harness root (`scopeRoot`). It is held in the shell-scoped store, not a `providedIn: 'root'` service | A root singleton outliving the visit | Plan D4 rejects a root store; the Library's B13 rule compares the push root with `scopeRoot` | yes |
| A push reloads every requested slice, not only plugins | Plugins only | The brief says "reload the slices already requested"; reuses `reloadRequested` | yes |
| The repair prompt keeps `RpcUserError` text (it has an `errorCode`) and drops everything else | Fixed copy for all failures | `rpc-handler.ts:226-240` sets `errorCode` only for deliberate user errors; the backend's refusal copy carries the next step | yes |

## Open issues

- Older raw-error sites in `external-marketplaces.component.ts` predate Batches 24-25 and are not
  changed: `messageOf` at `:646`, `:697`, `:734`, `:789`, `:839` and `:1000` for load, add,
  remove, browse, plan and uninstall. They follow the same pattern and are a candidate for the
  named later cleanup.
- `installed-skills-page.component.ts` is now 706 physical lines. Lint `max-lines` passed.
- Visual review in Electron of the new notice is still due with the P3 visual pass.
