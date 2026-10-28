# Batch P7 report: flat account detail (TASK_2026_719, plan P6 component 7)

Executor: frontend-developer. No git writes.

## Changed files

- REWRITTEN `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-detail-view.component.ts`
- REWRITTEN `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/account-detail-view.component.spec.ts`

## Final public contract (binding for AT)

- Selector `ptah-account-detail-view`. Standalone, OnPush.
- Inputs:
  - `account: ProviderAccountSummary` (required)
  - `accounts: readonly ProviderAccountSummary[]` (default `[]`)
  - `operation: ProviderAccountOperation | null`
  - `fallback: ProviderAccountSignInFallback | null`
  - `busy: ProviderAccountActionKind | null`
- Outputs:
  - `back: void`
  - `signIn`, `cancelSignIn`, `signOut`, `checkStatus`, `remove`: each emits a profile id (`string`)
  - `rename: AccountRenameRequest` (`{ profileId, label }`)
- Exports: `AccountDetailViewComponent` and `AccountRenameRequest`.
- Removed: the `refusal`, `feedback` and `initialTab` inputs; `AccountDetailTab`; `ACCOUNT_NAME_SAVED`, `ACCOUNT_UNCONFIRMED_WARNING` and `ACCOUNT_STATUS_UNAVAILABLE`.
  - The current `accounts-tab.component.ts` still binds `[refusal]`, `[feedback]` and `[initialTab]`, and it may import the removed names. AT will not compile until P6 lands.
- New injection: `SettingsSaveFeedbackService`. AT's spec and any host spec must provide it or stub it.
- Testids:
  - Kept: `account-detail`, `-back`, `-heading` (h3, `tabindex=-1`), `-state`, `-runs`, `-resume-unavailable`, `-sign-in`, `-cancel-sign-in`, `-sign-out`, `-check-status`, `-rename-input`, `-rename-submit`, `-locked`, `-remove`, `-remove-confirm`, `-remove-cancel`, `-fallback`, `-fallback-script`, `-copy-script`.
  - New: `-terminal-toggle`.
  - Removed as the plan lists. `-rename-form` and `-rename-error` are gone as well.

## What each plan item does

- **Header**
  - Shows `← Accounts`, the avatar (`accountInitial`), and the h3 name with truncation and a `title`.
  - The state is a dot plus `STATE_LABEL`. While pending it is a spinner plus "Waiting for Claude window".
  - Failed and disconnected get the attention bar (`border-l-4 border-l-state-err`).
  - The `{n} running` badge (`badge badge-ghost badge-sm`) is absent at 0.
  - The `Cannot resume` badge appears when the account is not signed in and has bound runs. It has a warning icon, a `title` and an `sr-only` copy of `ACCOUNT_COPY.resumeUnavailable`.
- **Action row**
  - Labels are unchanged: Sign in, Try again (failed), Cancel sign-in (pending), Sign out (signed in), and Check status.
  - While busy, every control uses `ptahBusyDisabled`: it is `aria-disabled` and stays focusable, and `act()` keeps its own busy guard.
- **Use terminal**
  - A ghost button with `aria-expanded` and `aria-controls`.
  - It shows only when the account is pending, the operation is `sign-in`, and the script is not empty.
  - It opens a `pre` (`tabindex=0`, `aria-label="Sign-in script"`) and an icon button `Copy script` (`aria-label` and `title`).
  - The disclosure closes when the script goes away or the account changes.
  - The copy result is announced directly (P6-A9): status `ACCOUNT_COPY.copied` or alert `ACCOUNT_COPY.copyFailed`.
- **Name**
  - A label `Name` and an input. `Save` (submit) shows only when the trimmed draft is non-empty and differs from the committed label, so a case-only change counts.
  - Validation runs on Save through `validateAccountName`. The duplicate message maps to `ACCOUNT_COPY.nameTaken` (D60); the unsafe message is announced as it is. Both are alert toasts, and nothing is emitted.
  - A committed rename resets the draft.
- **Pending lock**
  - The Name input becomes readonly and `aria-disabled` through `ptahBusyDisabled(locked)`. Remove becomes `aria-disabled`. Both stay focusable.
  - Both have `aria-describedby` pointing to an `sr-only` "Locked while sign-in is in progress.".
  - A lock icon wrapped in a `title` sits in the Name label (testid `-locked`).
- **Remove**
  - `Remove account` (`btn-outline btn-error btn-sm`) opens `NativeModalComponent` "Remove {name}?" with no body copy, and Cancel gets focus.
  - Cancel, Escape and the backdrop close only the dialog; the modal stops the Escape keydown. Focus then returns to `Remove account`.
  - Confirm closes the dialog and emits `remove` once. Nothing is assigned locally (B-1).
- **Removed**
  - Tabs, the live line, refusal and held blocks, every helper sentence, the copy-status line, and the old live-region B-2 focus dance.
  - Focus after a host write now belongs to AT (component 6 B-2), because busy controls no longer drop focus.
- **Kept behaviour**: the heading gets focus when a different account opens; the draft resets and the dialog and disclosure close.
- Each tab instance and catch block: there is no new catch block.

## Jest

- Command, run from the worktree root (2 runs, the allowed maximum):
  `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=account-detail-view`
- Run 1: my grep filter matched nothing, so it printed no output and I could not see a result.
- Run 2: exit 0.
  - Nx reported "1 task: 1 succeeded", "Cache: 0/1 hit", run duration 6.2 s, and "lock released after 13.4s, exit code 0".
  - Nx hid the Jest lines ("Re-run with --output-style=static to inline logs"), so the pass/total counts are not visible.
  - `@ptah-extension/chat` sets `passWithNoTests: true` in `project.json`. Exit 0 alone therefore does not prove the 30 spec cases ran.
- `ptah_get_diagnostics` (scoped to both files) was unavailable 3 times: "TypeScript check still running after 45s".
- **Open:** the team-leader should re-run once with `--output-style=static` and confirm the case count. It should also run P6's jest with AT bound to this contract.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| `Use terminal` shows only while the account is pending with a `sign-in` operation. | Also show it for failed (design table text). | `provider-accounts-state.service.ts:509-512` keeps fallbacks for pending profiles only, so a failed account never has one. | yes |
| `Save` is hidden for an empty or whitespace-only draft. | Show it and announce nothing. | `validateAccountName` returns `message: null` for empty, and the design has no empty-name copy. | yes |
| DV still focuses its heading when a different account opens. | Leave all focus to AT. | Parity with the old DV. AT's P6-9 "focusing the detail heading" then needs no DOM query. A duplicate focus by AT is harmless. | yes |
| Confirm Remove moves no focus itself. | Focus a live line (old). | The live line is removed. AT B-2 targets the `Accounts` heading. | yes |

## Open points

- AT (P6, in parallel) must drop `[refusal]`, `[feedback]` and `[initialTab]` and any import of the removed copy exports. It must also announce host refusals and "Name saved" itself.
- Jest pass counts are not confirmed (see Jest above).
