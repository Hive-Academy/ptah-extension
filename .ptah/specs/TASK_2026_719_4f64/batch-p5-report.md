# Batch P5 report: lane account cell (TASK_2026_719, plan P6 component 5)

Executor: frontend-developer. Scope: the 4 files of plan "### P5". No git writes.

## Changed files

- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/ptah-ai/claude-lane-account-cell.component.ts`
  - `ptah-claude-lane-account-cell`: a standalone OnPush component that uses `inject()`, signals, `computed` and `linkedSignal`.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/ptah-ai/claude-lane-account-cell.component.spec.ts`
  - 26 cases: visibility, cell states, menu and keyboard, commit, outcomes and B-2.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts`
  - Adds the import and the `imports[]` entry.
  - Adds `@if (row.kind === 'system' && row.cli === 'claude' && row.installed) { <ptah-claude-lane-account-cell /> }` directly under the `cli-name-line` div.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.spec.ts`
  - Stubs `VSCodeService`, `ProviderAccountsStateService` and `ClaudeAmbientStatusService` in the shared `beforeEach`.
  - New `describe('P6 lane account cell (L1, acceptance 8)')` with 4 cases.

## Plan items (component 5, acceptance 8-12)

- **Gated injection (evidence 19).**
  - `inject(VSCodeService).isElectron` decides whether `ProviderAccountsStateService` and `ClaudeAmbientStatusService` are injected at all. This is the same pattern as `providers-settings.component.ts:562-569`.
  - On construction: `void accounts?.open('claude')` and `void ambient?.read(false)`, once per mount.
  - Off Electron nothing renders and nothing is read.
- **Visibility (P6-1).** `model = accountSelectorModel(state('claude')(), ambient.view(), 'lane')`. The cell is shown only when `visible` is true.
- **Markup (Surface 2).**
  - Container `mt-0.5 flex flex-wrap items-center gap-1`, holding the muted `Account` label and the trigger.
  - The trigger uses the matrix `CELL` classes, copied because the constant is module-private. That includes `max-w-[13rem]`; the text span uses `truncate`. A ChevronDown icon follows the text.
  - Trigger attributes:
    - `aria-label="Claude account: {selectedText}. Change"`
    - `aria-haspopup="menu"` and `aria-expanded`
    - `[title]` set to the full name
    - `ptahBusyDisabled` while saving, which keeps it focusable with `aria-disabled`
  - The trigger text reads "Saving…" while saving.
- **Menu.**
  - `ptah-native-popover placement="bottom-start" [hasBackdrop]="true" backdropClass="transparent"`.
  - Body classes come from evidence 23: `surface-3 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl p-3 text-left text-xs`, width 17rem.
  - Header: h3 `Account` and a Close button (`aria-label="Close"`).
  - `role="menu"` with `aria-labelledby` pointing at the h3 id.
  - One `menuitemradio` button per option:
    - `aria-checked` marks the stored value.
    - Disabled items get `aria-disabled="true"` and stay focusable.
    - A 14 px check slot.
    - Item classes come from the design: `flex min-h-8 w-full items-center gap-2 rounded-lg px-2 ...`.
  - The removed item carries `sr-only` `ACCOUNT_COPY.removedAccount`.
  - Tabindex: the checked item has 0 and every other item has -1. The checked item takes focus on `opened`.
- **Keys.**
  - ArrowUp and ArrowDown wrap. Home and End move focus only.
  - Enter, Space or click on an enabled item that differs from the stored value commits. Disabled items and the stored value do nothing.
  - Escape, Tab and Shift+Tab call `preventDefault` and `stopPropagation`, close the menu and focus the trigger (P6-A7).
- **Commit.**
  - Ignored while `saving`. `saving` is set before the first await.
  - The menu closes and the trigger takes focus first, so the trigger is the waiting target.
  - Then `setSelection('claude','lane', choice)` runs.
  - The result is announced with `selectionFeedback(outcome,'lane',{providerSaved:false})`. A `null` result shows no toast (D60).
  - Nothing changes locally (B-1): the cell text always comes from the held snapshot.
  - The result never moves focus, so acceptance 12 (async focus discard) holds by construction.
- **Menu state.** `open` is a `linkedSignal` that resets when the cell hides. A menu cannot reopen by itself when the snapshot returns.
- **LM wiring.** Done as planned, with one instance per matrix. No timers and no observers.

## Decisions

- **The cell is created directly under `cli-name-line`, inside the name `td`.** The other option was an extra row line. Evidence: the plan places it there and the spec says "wraps under the name". It sits outside the bold name line, so the text is `font-normal`. Reversible: yes.
- **The tabindex stays on the checked item instead of following focus.** The other option was to move tabindex with focus. Evidence: the design says "checked item `tabindex=0`, others `-1`", and Tab closes the menu (P6-A7), so a moving tabindex would never be observable. Reversible: yes.
- **The `CELL` classes are copied, not exported from the matrix.** The other option was to export the constant. Evidence: the plan says "LM `CELL` classes copied", and exporting would widen the matrix module's API. Reversible: yes.
- **The toast is still announced when the cell is destroyed mid-save.** The other option was to drop it. Evidence: the toast is page-level, and its text is the user's only evidence of a write that already ran. Only focus is discarded (acceptance 12). Reversible: yes.

## Jest

Command, run twice (the allowed maximum):
`node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- "--testPathPatterns=claude-lane-account-cell|cli-orchestration-matrix"`

- **Run 1:** the filtered pipe printed nothing, so there is no result to report.
- **Run 2:** `Test Suites: 1 failed, 1 passed, 2 total`; `Tests: 1 failed, 85 passed, 86 total`.
  - `claude-lane-account-cell.component.spec.ts`: PASS, all cases.
  - `cli-orchestration-matrix.component.spec.ts`: 1 failure, in "P6 lane account cell › renders nothing and reads nothing off Electron".
    - Cause: the `VSCodeService` stub used `useFactory: () => ({ isElectron: electron })`. Another matrix child had already created the service when the matrix was built, before the test set `electron = false`, so the cell read `true`.
    - Fix: the stub now exposes `isElectron` as a getter over the variable, which every reader evaluates when it reads.
    - This fix is **not jest-verified**, because the run cap was reached. `ptah_get_diagnostics` on all four files: 0 errors.
  - The other 85 cases passed, including every existing matrix case and the other three new matrix cases.

## Open points

- **Re-run needed.** The team-leader should run the P5 jest command once to confirm the getter fix (expected 86/86).
- **Width checks not done here.** The geometry checks (acceptance 9: 360/320/260/245 px with long names) need a visual review in Electron. Jest in jsdom cannot measure layout.
  - The structure supports the requirement: the cell sits in a wrapping row under the name, the trigger has `max-w-[13rem]` and the text is truncated.
- **Pre-existing errors outside the batch.** `ptah_get_diagnostics` reports errors in other chat spec files, such as `agent-card-truncation.spec.ts` and `compact-session-card.component.spec.ts`. They are not in this batch and were not touched.
