# Batch P8 report: ambient row and Add form (TASK_2026_719, plan P6 component 8)

Executor: frontend-developer. Worktree: `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`. No git writes.

## Changed files

- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/ambient-account-row.component.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/ambient-account-row.component.spec.ts` (rewritten, 13 tests)
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/add-account-form.component.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/accounts/add-account-form.component.spec.ts` (rewritten, 13 tests)

## Final contracts (binding for AT / P6)

- AR `ptah-ambient-account-row`: `ambient = input.required<ClaudeAmbientStatusView>()`,
  `chips = input<readonly string[]>([])`, `checkRequested = output<void>()`. Names are unchanged.
- AF `ptah-add-account-form`: `accounts = input.required<readonly ProviderAccountSummary[]>()`, `pending = input(false)`,
  `submitted = output<string>()`, `cancelled = output<void>()`. **The `refusal` input is removed.** AT must drop
  `[refusal]="addRefusal()"` and announce the host refusal itself as an alert toast. AF now injects
  `SettingsSaveFeedbackService`, so any test that mounts AF needs that provider. I sent this note to frontend-p6.

## What was done, per plan item

### AR

- The row uses `ambientStatusModel` (P2) instead of `ambientRowModel`.
- Markup, in order:
  - avatar `E`;
  - the name `Existing Claude login` as a `<p tabindex=-1>` with no focus box (`focus:!outline-none focus:!shadow-none`);
  - dot (spinner while checking) + `model().word`;
  - "Used by" + chips, omitted when `chips` is empty.
- The group is `aria-labelledby` the name.
- Row box: `rounded-box border border-base-300 bg-base-100 px-4 py-3`, which matches the design row. AR draws its own box, so AT's wrapping `<li>` should stay unstyled.
- D54 / P6-A4: the word carries `[attr.title]=hint`. A `sr-only` copy of `hint` follows the word. Both are omitted when `hint` is null. The D54 cues and the age now appear only there.
- `Check` is shown only when the word is not `Signed in`.
  - While checking it uses `[ptahBusyDisabled]`: `aria-disabled`, still focusable. Repeat presses are ignored.
  - The word shows the spinner + `Checking…`.
  - `aria-label="Check the existing Claude login"` (the visible label "Check" is in the name).
- Removed:
  - the subtitle;
  - the extra and age `<p>`s;
  - the `role=status`/`aria-live` status line;
  - the old focus-to-status logic.
- B-2: an `afterRenderEffect` notices when Check goes from shown to gone.
  - Focus moves to the row name only if Check was the last focused control and focus has fallen to `body`/null.
  - A blur with a new target, or on a still-connected button, clears the flag, so a user move is never overridden.
- The 30 s age timer is kept: one `setInterval` outside the zone, cleared on destroy.

### AF

- The form has the `Account name` label, the input, `Cancel`, and `Add`.
- `Add` uses `[ptahBusyDisabled]="pending() || empty()"`, so it reads as disabled until the trimmed value is non-empty. Its label is `Adding…` while pending.
- The input and Cancel use `ptahBusyDisabled` while pending: the input becomes readonly, and focus never drops.
- Removed: the `refusal` input, the hint, the inline `role=alert` line, the `Adding…` status line and the focus-to-status logic.
- On submit the field is re-read (R4) and run through `validateAccountName`:
  - ok: emits the trimmed label;
  - empty: nothing happens;
  - invalid or duplicate: `SettingsSaveFeedbackService.announce(message, 'alert')` (P6-A9), focus goes back to the input, and `aria-invalid="true"` is set until the next edit.
- Duplicate message (D60a): when the validator returns `PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY`, the toast is `ACCOUNT_COPY.nameTaken` ("That name is already used."). Other messages (for example `UNSAFE_ACCOUNT_NAME_MESSAGE`) are passed through.
- Escape and Cancel emit `cancelled` and close only the form (`stopPropagation`). Both are ignored while pending.
- The input still gets focus on creation.
- Form styling: `space-y-3 rounded-box border border-base-300 bg-base-100 px-4 py-3`, the same as the rows.

## Verification

- `ptah_get_diagnostics` on the 4 files: no diagnostics in the requested files. The project's existing errors are in unrelated specs.
- Jest, from the worktree root:
  `node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- "--testPathPatterns=ambient-account-row|add-account-form"`
  - Run 1: exit 0, but my grep filter printed nothing.
  - Run 2: exit 0, Nx cache hit ("1 task: 1 succeeded, 1 cached").
  - The Nx terminal output cached from run 1 (`~/.nx/8b7110c7390b9603/cache/terminalOutputs/1003537812675166911`, 21:33 local) shows `Test Suites: 2 passed, 2 total`, `Tests: 26 passed, 26 total` (13 AR + 13 AF).
- Not run: lint, typecheck target and the other suites. That is out of batch scope; the final verify covers them.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| AR draws its own row box. AT's `<li>` stays bare. | Style the `<li>` in AT | AT wraps AR in a bare `<li>` (`accounts-tab.component.ts:231`); P6 and P8 are file-disjoint | yes |
| `Add` uses `ptahBusyDisabled` also for "empty", not native `disabled` | native disabled | Plan component 8 and design A6 both say `aria-disabled` until non-empty | yes |
| AF sets `aria-invalid` after a refused submit and clears it on edit | none | Not copy, no live region; it keeps the error state available to AT users after the toast fades | yes |
| B-2 "Check vanished while focused" = Check was the last focused control and `activeElement` is body/null after render | always move; never move | Plan B-2: move only when the button disappears while focused | yes |

## Open points

- P6 (AT) must remove `[refusal]` from its `<ptah-add-account-form>` binding, or the template will not compile. It must also announce the Add refusal and "Status checked". I told frontend-p6.
- The jest runs at 21:34–21:35 local show `accounts-tab.component.spec.ts` with 1 failing test. That is P6's file, still in progress, and not part of this batch.
- No new catch block, no `process.cwd()`, no `jest.spyOn` on module namespaces.
