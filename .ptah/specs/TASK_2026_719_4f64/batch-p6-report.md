## Frontend implementation - `TASK_2026_719_4f64`, batch P6 (Accounts tab list; delete Use-for)

**Tasks completed**: plan component 6 (AT), the UF deletion, and the AT/UF test moves from "Deletions, removed copy and moved tests".

**Files** (worktree `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`):

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts`: the list is calmer, every outcome is a toast, and B-2 focus handling is in place.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.spec.ts`: rewritten, 39 tests.
- DELETED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-use-for.component.ts` (removed from the file system, not with `git rm`).
- DELETED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-use-for.component.spec.ts`.

**Importer check before the deletion**: I searched `libs/` and `apps/` (`*.ts`, `*.mjs`, `*.json`, `*.html`) for `account-use-for`, `AccountUseForComponent`, `USE_FOR_HEADING_ID`, `UseForSelection` and `UseForScopeText`. The only hits were in the AT component and the AT spec, which are my own files. After the change, a search for the old AT exports (`ACCOUNT_ADDED_TOAST`, `SELECTION_REFUSED_FALLBACK`, `SIGN_IN_STARTED_FEEDBACK`), the old testids (`accounts-tab-toast`, `accounts-tab-alert`) and `Add another account` finds nothing outside AT. That includes the e2e harness.

### Per plan item (component 6)

- **Removed**: the UF import and mount, `select()`, `pendingScopes`, `scopeMessages`, `scopeAlerts`, `SELECTION_REFUSED_FALLBACK`, `SCOPE_NAME`, `USE_FOR_HEADING_ID`, the toast `<p>`, the alert `<p>` and `DETAIL_WAITING_TARGET`. Also gone: the old exported feedback constants (`ACCOUNT_ADDED_TOAST`, `SIGN_IN_*_FEEDBACK`, `SIGNED_OUT_FEEDBACK`, `STATUS_CHECKED_FEEDBACK`), the DV copy imports (`ACCOUNT_NAME_SAVED`, `ACCOUNT_STATUS_UNAVAILABLE`, `ACCOUNT_UNCONFIRMED_WARNING`), `AccountDetailTab`/`initialTab`, the `detailOutcome` refusal/feedback plumbing, `useForModel`/`assignmentChips` usage, and the row `role=button` body with its `rowKey` (P6-A6).
- **Region**: always `aria-label="Claude accounts"`, `space-y-6 text-sm text-base-content`, with `aria-busy` working as before.
- **Header**: `h3` `Accounts` (`tabindex=-1`, testid `accounts-tab-heading`). When the data is stale it shows an `Out of date` badge (`role=status`, `TriangleAlert` icon) plus `Try again` (`ptahBusyDisabled` while loading). `Add account` uses `btn-outline btn-sm min-h-8`, testid `accounts-tab-add`. It is `aria-disabled` while there is no snapshot or while held (P6-A8), and it has `title="Not available on this host"` when held.
- **Body states**:
  - First-load failure: an alert row "Could not load accounts" with Try again.
  - No snapshot yet: `ul aria-busy="true"` with one row, either spinner plus `Loading…` or `Open a workspace` when idle.
  - The Add form replaces the list.
- **List**: `ul role=list aria-label="Claude accounts" class="space-y-3"` with no margin. The ambient row comes first, in an unstyled `li` (AR draws its own box, as frontend-p8 told me).
  - Named rows: `px-4 py-3`, avatar, truncated name with `title`, dot plus `STATE_LABEL` word (pending shows a spinner instead of the dot), and "Used by" plus chips from `usedByChips`. The "Used by" label is left out when the account is unused.
  - Row actions: `Sign in` (`btn-primary btn-sm min-h-8`, `ptahBusyDisabled` while busy) for not-signed-in, failed and cancelled. Every named row has a 32x32 icon `Manage` chevron (`aria-label="Manage {name}"`, `title="Manage"`, testid `accounts-tab-row-manage`).
  - The "N active runs" row line is removed (P6-A5).
- **Feedback**: every outcome goes through `SettingsSaveFeedbackService.announce` with `ACCOUNT_COPY` text or a safe host sentence (`isSafeProviderAccountSummary`). There are no inline lines.
  - saved: `Signed out`, `Sign-in cancelled`, `Name saved`, `Account removed`, `Status checked`, `Account added`.
  - failed: the safe host sentence, otherwise `That did not work. Try again.`
  - unavailable: `That did not work. Try again.`
  - unconfirmed: `May not have saved. Accounts reloaded.` (alert).
  - release-held: the host sentence, otherwise `Named accounts are not available on this host.`, and Add is held (P6-A8).
  - Push removal of the open account: `That account is no longer in the list`.
  - Ambient Check: `Status checked`, or the action-failed alert on a local failure.
- **B-2**: `captureWait` captures the focused element inside the tab at intent. At completion, after the next render:
  - If focus is still on the target, nothing moves.
  - If the target vanished and focus fell to the body, the fallback takes focus: the detail heading for detail actions, the `Accounts` heading for list actions and for a successful Remove.
  - If focus moved, the view was replaced, or the tab was destroyed, nothing moves.
  - Add success opens the new account's detail and focuses its heading only when focus is still inside the Add form and the view has not changed (P6-9). Otherwise only the toast appears.
  - Push removal of the open account: the toast appears, and the heading takes focus only if focus was inside that detail.
  - Our own Remove is tracked (`ownRemovals`), so its snapshot does not also announce "no longer in the list".
- **DV binding**: only the component 7 contract. Inputs `account`, `accounts`, `operation`, `fallback`, `busy`; outputs `back`, `signIn`, `cancelSignIn`, `signOut`, `checkStatus`, `rename`, `remove`. The detail heading is found by the kept testid `account-detail-heading`. **AR**: `ambient`, `chips`, `(checkRequested)`. **AF**: `accounts`, `pending`, `(submitted)`, `(cancelled)`; the `refusal` input is no longer bound.
- **B-1**: no selection write exists in AT any more. Removal never calls `setSelection` (tested), and chips change only from the host snapshot.

### Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| A sign-in start that saves announces the account's state word from the response snapshot: `Signing in…` (`STATE_LABEL.pending`), or `Signed in` if the snapshot already shows signed-in. If the snapshot has neither, nothing is announced. | invent "Sign-in started" (not in the design copy); no announcement (breaks acceptance 20, "sign-in announced") | design-spec-p6 "Copy" lists no started toast; `Signing in…` and `Signed in` are design strings | yes |
| Outcomes are still announced after the tab or drawer closed; only focus is suppressed. | drop the announcement on destroy | the page toast outlives the drawer (`settings-save-feedback.service.ts:204-210`); plan "A closed/destroyed tab gets no programmatic focus" restricts focus only | yes |
| The header `Add account` button is hidden while the Add form is open, and Cancel focuses it again after the render. | keep a no-op button visible | design A6 "list replaced by" the form, which has its own Cancel; a visible no-op button is poor a11y | yes |
| The detail replaces the whole body including the header row, as before (no Accounts heading in detail view). | keep the header above the detail | design "Detail ... one flat panel" with `← Accounts`; previous AT behaviour | yes |
| Manage moves focus to the detail heading after the render. AT does this itself rather than relying on DV. | rely on DV to focus on init | the Manage chevron is removed with the list; the DV contract does not say it self-focuses; a double focus on the same heading is harmless | yes |
| `ROW_DOT` stays local in AT. | move it into AP | AP exports no `ROW_DOT` today; P6 scope does not add AP exports | yes |

### Verification

- Command: `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=accounts-tab`, run from the worktree root.
- I ran it 3 times, not once:
  - **Run 1**: my output filter matched nothing, so I had no result.
  - **Run 2**: the same command with the log saved. 1 failed, 38 passed. The failure was my own assertion "no `<p>` in the tab": the rewritten P8 ambient row already in the tree uses `<p data-testid="ambient-name">` for its name. I scoped the assertion to the tab's own markup, outside `ptah-ambient-account-row`.
  - **Run 3**: `Test Suites: 1 passed, 1 total`, `Tests: 39 passed, 39 total`. Nx printed "1 task: 1 succeeded" with "Cache: 0/1 hit", so this was a real run against the files in the tree.
- **P7/P8 dependency**: the passing run used whatever DV, AR and AF files were in the tree at the time. AR had already been rewritten by P8. The specs only touch the child contracts (DV/AF/AR outputs emitted through `componentInstance`, plus the kept testids `account-detail-heading` and `ptah-add-account-form input`). If P7 changes the DV heading testid or its input names, the detail-focus and binding tests will need re-checking. Nothing failed for that reason here.
- Not run, per the batch rules: lint, typecheck, and the drawer and providers specs that mount AT (`connection-detail-drawer.component.spec.ts` already provides `SettingsSaveFeedbackService`). These are for the final verify after P9.

### Open points

- **For P9**: AT no longer imports `useForModel`, `assignmentChips`, `UseForValue`/`UseForOption`/`UseForScopeModel`, `UNAVAILABLE_ACCOUNT_OPTION`/`MESSAGE` or the `Used for:` chip map. Their remaining importers are now only whatever P7/P8 still use.
- AT now injects `SettingsSaveFeedbackService` (not optional). It is provided by `SettingsComponent`, which is where the drawer lives. Any other mount of `ptah-accounts-tab` would need that provider too; none exists today.
- frontend-p8 sent me the AR/AF contract notes. They match what I bound, so no reply is needed.
