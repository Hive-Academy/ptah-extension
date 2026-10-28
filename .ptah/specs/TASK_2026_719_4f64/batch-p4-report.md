# Batch P4 report: Main popover Account field (MP) and Sign-in route (PS)

Executor: frontend-developer. Plan: `implementation-plan-p6.md` component 4 and Revision 1 (P6-A12, P6-A13). Decisions D56-D60 applied.

## Changed files

All paths are under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/`.

- MODIFIED `main-agent-reassign-popover.component.ts`: the Account field, the account save step, the race guard and the refusal lock.
- MODIFIED `main-agent-reassign-popover.component.spec.ts`: a new top-level suite `MainAgentReassignPopoverComponent: Account (P6 MP)` with 21 cases. The existing suites are unchanged.
- MODIFIED `providers-settings.component.ts`: the Sign-in route and the drawer `initialTab` binding.
- MODIFIED `providers-settings.component.spec.ts`: one Sign-in route case. `AccountsFake` gains `operations` and `fallbacks`, because the drawer's Accounts tab now renders in that case.

## What was done, per plan item

### MP (popover)

- **Gated injection.** This copies PS (evidence 19): `accountsAvailable = inject(VSCodeService).isElectron`, and `ProviderAccountsStateService` and `ClaudeAmbientStatusService` are injected only in Electron. Outside Electron the field is absent and no account service is touched (tested).
- **Open effect.** The existing open effect now also:
  - resets the account draft, the "changed elsewhere" latch and `accountRefused`;
  - calls `void accounts.open('claude')` and `void ambient.read(false)`. Tested: one call each per open.
- **Model and visibility.**
  - `accountModel = accountSelectorModel(accounts.state('claude')(), ambient.view(), 'main')`.
  - The field shows only when `visible` is true and the draft provider is the Claude CLI (`connectionKind(entry) === 'claude-cli'` on the `state.connections()` entry).
  - It is absent before the first list read, for any other provider, and when no account is signed in and the stored value is ambient (tested).
- **Template.** The field sits after the provider block, before Model:
  - `<label for="main-agent-account">Account</label>` and `<select id="main-agent-account">` using MP's `LABEL` and `SELECT` classes, `[ptahBusyDisabled]="busy()"`, `[title]` set to the shown option's label, and testid `main-agent-account`.
  - Options come straight from the model (order, labels and the disabled flag).
  - **Signed-out stored account:** the label row is `flex items-center justify-between` and holds a `Sign in` button (`aria-label="Sign in to the saved account"`, testid `main-agent-account-sign-in`) that emits the new output `accountSignInRequested`.
  - **Removed stored account:** the select gets `aria-invalid="true"` and `aria-describedby="main-agent-account-removed"`, pointing to an `sr-only` span holding `ACCOUNT_COPY.removedAccount`.
- **DOM re-assert (B-1).**
  - `accountValue` is the draft only while that draft is an enabled option; otherwise it is the stored value.
  - An `afterRenderEffect` and the `change` handler both set the select's DOM value back to it. A disabled or `stored` pick is never kept (tested).
- **Draft vs pushed.**
  - The draft is set on `change`. Picking the stored value clears the draft.
  - With a draft held, a change in the stored *selection* (ambient, or the named profile id) announces "Account changed elsewhere" once per draft, and the draft is kept (tested).
  - A sign-in state change alone does not count as a selection change.
  - The check is skipped while a Save runs, because that write's own outcome speaks.
- **`accountChanged` and `saveReady`.**
  - `accountChanged` is true when the field is visible, the draft is not null, differs from the stored value, is enabled, and `accountChoiceOf(draft)` is not null.
  - `saveReady` is `!accountRefused()` and then either the existing predicate (when provider, model or effort is dirty) or (`accountChanged` and not `awaitingConfirm`).
  - A save that changes only the account needs no "Save to" target.
- **`save()`.**
  1. The intent `{value, choice, selectionRevision, profileRevision}` is captured synchronously before the first await (P6-A12). If `accountChanged` is false there is no intent and no account step.
  2. The provider write is unchanged. If it did not save, Save stops.
  3. Account step:
     - A popover that was closed or reopened drops the intent.
     - If a provider write ran, `intentHolds` re-reads the snapshot. It checks the scope revision, that the named account is still present, its profile revision, and that the value is still an enabled option.
     - On a mismatch the step becomes `{status:'unavailable'}` with `providerSaved: true`, which announces "Provider saved. Account not saved.".
     - Otherwise `setSelection('claude','main',choice)` is called in the same synchronous turn as the check.
  4. **`saved`:** the draft is cleared.
     - If model or effort is dirty, the account message rides on that save's `successMessage` as `Saved {label} to {scope}. Chat uses {name}.` (P6-A2), and Undo restores only model and effort.
     - Otherwise the `selectionFeedback` status toast is announced and the popover closes.
     - If `selectionFeedback` returns `null`, no toast is shown (D60c).
  5. **`failed` / `unavailable` / conflict:**
     - The alert is announced once, even if the popover was closed.
     - The draft is cleared and `accountRefused` is set, so Save stays disabled although model and effort drafts remain.
     - Model and effort are not written.
     - P6-A3 focus rule: only if focus was still on Save, focus moves to `#main-agent-account` after render.
  6. **`unconfirmed`:** only "May not have saved. Accounts reloaded." is announced and the draft is cleared. There is no lock and no focus move. Model and effort drafts stay, and Save follows the normal predicate.
- **Lock reset.** `accountRefused` is cleared only by a `change` that stores a new enabled draft, or by reopening the popover.

### PS (page)

- `(accountSignInRequested)="openAccountSignIn()"` on the popover. `openAccountSignIn()` closes the popover (`mainPopover.set(null)`) and calls `openDrawer(claudeCliId, 'accounts')`.
  - The drawer opener is the Main Agent node's Reassign button (`[data-testid="routing-node-main-agent"] [data-testid="routing-node-action"]`, A-3 checked in `routing-map-node.component.ts:76-78`). If that button is not found, the opener falls back to whatever held focus.
- `openDrawer(providerId, tab: ConnectionDrawerTabId = 'overview')` sets the new `drawerTab` signal in the same pass as `drawerId`. The drawer has `[initialTab]="drawerTab()"`.
  - Every normal open (card `detailsRequested`) passes `'overview'`, so the drawer never stays stuck on Accounts (the P3 open point).

## MP.spec cases required by Revision 1, and where they are

| Required case | Test |
|---|---|
| Race (P6-A12): pending provider write, then one of three pushes: scope revision raised, named-account revision raised, account removed | `it.each` "race (P6-A12): …": `setSelection` not called, one alert "Provider saved. Account not saved.", select back on the stored value, Save disabled, popover still open |
| Control case: no push | "control case": `setSelection` called once with the choice; the fake records the call-time snapshot, which `toBe` the click-time snapshot; provider write before the account write |
| Lock (P6-A13) with provider + account + effort | "lock (P6-A13)": `feedback.save` not called, Save disabled while effort is still drafted, a second click does nothing, picking another enabled account re-enables Save, the next Save writes the account and then the effort |
| Reopening clears the lock | "reopening the popover clears the lock" |
| B-2 with the lock | "focus still on Save -> focus lands on the Account select", "focus moved elsewhere during the await -> no focus move", "popover closed mid-write -> no focus move, the alert still announces" |
| `unconfirmed` with an effort draft | "unconfirmed with an effort draft": no lock, Save enabled, no focus move, no "not saved" text |
| Account saved + effort failed | stays open, account draft cleared, only the `feedback.save` alert |
| Account saved + effort saved | one toast `^Saved reasoning effort to .+\. Chat uses Home\.$` with Undo; Undo writes only `{effort:{effort:'medium',…}}`, and `setSelection` is still called only once |

There are also cases for:
- field absence (not Electron, no snapshot, another provider, P6-1 false);
- options, order, label, title, and the one list read plus one cached ambient read;
- a signed-out stored account with Sign in (M4a);
- a removed stored account with `aria-invalid`, `aria-describedby` and the `sr-only` text (M4b);
- a disabled pick being re-asserted;
- an account-only save ("Chat uses Home", closes, no provider or settings write);
- the ambient choice being written as is;
- "Account changed elsewhere" announced once.

PS.spec: "P6-A10: the popover "Sign in" closes it and opens the Claude drawer on Accounts; a card open is on Overview again". It checks that the popover is closed, the drawer's connection is `claude-cli`, and `initialTab()` is `'accounts'`. After closing and opening from the card, `initialTab()` is `'overview'`.

## Verification

Command, run from the worktree root (foreground):
`node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- "--testPathPatterns=main-agent-reassign-popover|providers-settings.component"`

- **Run 1:** 2 failed, 146 passed, 148 total. Both failures were in my new tests:
  - An account-only refusal announces the host's safe summary, not the fallback. I corrected the expectation.
  - The Sign-in route really renders the drawer's Accounts tab, which needs `operations` and `fallbacks` on the PS fake. I added both.
- **Run 2:** exit 0. Nx reported 1 task succeeded with a 0% cache hit, so the tests really ran. `Test Suites: 2 passed, 2 total`, `Tests: 148 passed, 148 total` (read from the Nx terminal output of that run).
- `ptah_get_diagnostics` on the 4 files: no diagnostics in the requested files. The project has 254 type errors in other spec files (agent-card, chat-input, compact-session, execution and others), none in P4 files.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| A popover closed during the provider write drops the account intent and writes nothing more. A refusal that lands after the popover closed still announces, with no focus move and no lock. | Keep writing after close (the existing model/effort behaviour) | Plan component 4: "a closed/reopened popover discards the intent and moves no focus"; failure behaviour: "toast still announces" | yes |
| "Account changed elsewhere" compares the stored *selection* (ambient vs named profile id), not the selector value. | Compare `model.value` (the `stored` placeholder hides a removed-to-removed change; a sign-out would count as a change) | Contract 3 speaks of the stored value changing; a sign-in state change is not a reassignment | yes |
| "Changed elsewhere" is not announced while a Save runs. The race is reported only as the refusal alert. | Announce both | Single toast slot; P6-A12 already reports that write | yes |
| The Sign-in route uses the Main Agent node's Reassign button as the drawer opener. | The element focused when the popover opened | A-3 check: `routing-map-node.component.ts:76-78` has a focusable action button | yes |

## Open points

- The Sign-in route case renders the drawer's real `AccountsTabComponent` in PS.spec. If P6 (Accounts tab rewrite) adds calls to other `ProviderAccountsStateService` methods at construction, the PS `AccountsFake` may need those stubs too.
- No new catch block, no `any`, no `process.cwd()`, and no `jest.spyOn` on a module namespace. `jest.spyOn` is used only on the `SettingsSaveFeedbackService` instance (`announce`, `save`).
- No git writes. Two scratch files are left in the system temp directory, outside the repo: `p4-mp-spec-add.ts` and `p4-apply.py`, plus the log `p4-run2.log`.
