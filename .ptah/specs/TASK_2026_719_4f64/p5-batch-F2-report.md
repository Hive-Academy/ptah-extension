## Frontend implementation - `TASK_2026_719`, phase P5, batch F2

**Tasks completed**: plan §7 (account presentation module), §8 (`AmbientAccountRowComponent`), §9 (`AddAccountFormComponent`). Six files created. No existing file was modified or deleted.

**Files** (all under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/`):

- CREATED `account-presentation.ts`: pure rules with no DOM. It exports:
  - `STATE_LABEL`, `ATTENTION_STATES` and `accountInitial`.
  - `useForModel(snapshot, ambientView)`: one `{ value, options[] }` per scope. Values are `'ambient' | 'named:<id>' | 'unavailable'`.
  - `assignmentChips(snapshot)`: a map from row key (`'ambient'` or a profileId) to its "Used for" chips.
  - `orderedAccounts`, `validateAccountName(raw, accounts, excludeProfileId?)` and `ambientRowModel(view, now)`.
  - `ambientAge`: `checkedAgo` banding with this row's own copy.
  - `connectedAccountCount(accountsView, ambientView)`.
  - Copy constants: `UNAVAILABLE_ACCOUNT_OPTION`, `UNAVAILABLE_ACCOUNT_MESSAGE`, `UNSAFE_ACCOUNT_NAME_MESSAGE` (P5-D7) and `AMBIENT_ROW_KEY`.
  - The ambient answer is used only when `status === 'ready' && !localFailure`.
- CREATED `account-presentation.spec.ts`: 33 cases.
- CREATED `ambient-account-row.component.ts`: `ptah-ambient-account-row`.
  - Contract: `ambient = input.required<ClaudeAmbientStatusView>()`, `chips = input<readonly string[]>([])`, `checkRequested = output<void>()`.
  - Content: avatar "E", the name, the explainer, a status line (`role=status`, `aria-live=polite`, `tabindex=-1`), extra text, an age line, chips, and "Check again".
  - Status is a dot plus text, using the `bg-state-*` tokens. While checking, the spinner is `aria-hidden` and uses `animate-spin motion-reduce:animate-none`.
  - One 30 s `setInterval`, started outside the zone and cleared in `DestroyRef`.
- CREATED `ambient-account-row.component.spec.ts`: 10 cases.
- CREATED `add-account-form.component.ts`: `ptah-add-account-form`.
  - Contract: `accounts = input.required<readonly ProviderAccountSummary[]>()`, `pending = input(false)`, `refusal = input<string|null>(null)`, `submitted = output<string>()`, `cancelled = output<void>()`.
  - The label is "Name this account" with the design hint. `maxlength` is 64 (`PROVIDER_ACCOUNT_LABEL_MAX_LENGTH`). `aria-describedby` points to both the hint and the alert, and `aria-invalid` is set.
  - Validation messages and the host refusal share one `role=alert` slot. A host refusal is re-checked with `isSafeProviderAccountSummary`; an unsafe sentence becomes fixed fallback copy.
  - While pending: the buttons read "Adding…", all controls are disabled and the form has `aria-busy`.
  - Escape and Cancel emit `cancelled`. Escape also calls `preventDefault` and `stopPropagation`, so it never reaches the drawer.
  - Focus goes to the input on creation. At submit the value is re-read from the input element (R4).
- CREATED `add-account-form.component.spec.ts`: 13 cases.

**Stack observed**:
- Angular standalone, OnPush, `input()`/`output()`, signals and `inject()`, as in `add-account-dialog.component.ts`.
- The 30 s timer follows `overview-tab.component.ts:303-313`.
- Zoneless TestBed, from `libs/frontend/chat/src/test-setup.ts`.
- Tailwind and DaisyUI, with the `state-*` colour tokens from `apps/ptah-extension-webview/tailwind.config.js:32-36`. Dark and light themes are covered by the `--state-ink-*` theme variables. No raw `success`/`error` colours are used for text or dots, per design §5.
- Types come from `@ptah-extension/core` (`ClaudeAmbientStatusView` and `ProviderAccountsView`, re-exported via `providers-settings-state.service.ts`) and from `@ptah-extension/shared`.

**Design fidelity**: built from `design-spec-p5.md` §3.2, §3.5, §3.7 and §5, plus the prototype's `ambRow()` and `addForm()`.
- The unsafe-name copy follows P5-D7, not the prototype's 40-character stand-in.
- `maxlength` is 64, not the prototype's 40.

**States covered**:
- Ambient row: Connected, Not signed in, Could not check (host `unknown`), Could not check (local failure, no age line), Checking (disabled, spinner, no Connected or age), idle/inert ("Not checked yet").
- Add form: empty, invalid (duplicate, reserved, unsafe), valid, pending, host refusal (safe and unsafe sentence), cancel and Escape.
- Accessibility: focus rings use the `base-content` 2px outline with 2px offset, and buttons are at least 30px high. Every label, name and chip is a text node.

**Spec cases**:
- `account-presentation.spec.ts` (33):
  - Labels and initial.
  - `useForModel`: omitted and ambient both select the existing login. Option order and the "(sign in first)" disabling. Ambient suffix only from a ready host answer, never while checking or after a local failure. Present named account. An absent named id shows the unavailable placeholder in that scope only. Removal: host-omitted shows the existing login; a kept removed id shows unavailable.
  - Chips: omitted and ambient go to the ambient row; named chips go to that account; an unchanged snapshot gives unchanged chips (R2).
  - Ordering.
  - Validation: trim, empty gives no message, unsafe (length and control character) gets the P5-D7 copy, slashes and colons are allowed, duplicates are caught case-insensitively, the reserved name is refused, rename of its own name and a clash with another account.
  - `ambientRowModel`: all states. No age for `checkedAt: null` or a local failure. Banding.
  - Badge table with two signed-in named accounts: idle, inert, checking, local failure and `unknown` give null; `signed-out` gives 2; `connected` gives 3. Accounts loading, error or stale give null. Zero signed-in plus `signed-out` gives 0. Recovery gives 3, and a pushed sign-out gives 2.
- `ambient-account-row.component.spec.ts` (10):
  - Text for each of the four states, plus local failure.
  - Never Connected while checking; disabled while checking.
  - Emits once per press.
  - Rule B-2, both branches: focus returns to the button, or stays elsewhere while the polite status shows the result.
  - The 30 s age refresh under fake timers, with no timer left after destroy.
  - Chips rendered as text nodes.
- `add-account-form.component.spec.ts` (13):
  - Initial state: focus, label, maxlength, describedby, disabled Add.
  - Duplicate, reserved and unsafe names.
  - Trimmed emit.
  - Pending: Adding…, disabled controls, `aria-busy`, focus on the status, and a second submit is ignored.
  - A refusal keeps the value, focus returns to the input (B-2), and the refusal clears on edit.
  - Rule B-2, focus-elsewhere branch.
  - An unsafe refusal is replaced by fallback copy.
  - Escape and Cancel emit; Escape is not propagated.
  - Escape is ignored while pending.

**Verification**:
- `node scripts/verify.mjs --exec --task f2-jest -- npx jest -c libs/frontend/chat/jest.config.ts <3 specs>` gave `Test Suites: 3 passed, 3 total; Tests: 56 passed, 56 total` (lock exit code 0).
- `ptah_get_diagnostics` on the 6 files reported no errors. It listed errors only in unrelated sibling spec files that already existed.
- Lint, typecheck targets and `npm run verify` were not run, per the batch instruction. The team-leader's F2 verify (`-p @ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode`, N = 4) is still due.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| `idle`/`inert` ambient views render "Not checked yet" (idle tone, Check again enabled), a phrase not in the copy table | Show Checking; show Could not check; neutral "Not checked yet" | Design §3.2 has four states and none fits "no read yet". Checking would leave Check again disabled with nothing in flight. "Could not check" would claim a failed read. | yes (one string in `ambientRowModel`) |
| "Last checked <age>" is also shown for `signed-out`, not only for Connected | Connected only (design table); also signed-out | The prototype's `ambRow()` shows the age for every non-checking state; it is real host `checkedAt` provenance | yes |
| Age copy: "just now" / "N minute(s) ago" / "N hour(s) ago" / "on <date>" | Reuse `checkedAgo` text verbatim; own copy with the same banding (P5-D9) | P5-D9, and the design example "Last checked 2 minutes ago" | yes |
| `validateAccountName` returns `{ ok:false, message:null }` for an empty name | Show an error for an empty field; no message | The prototype shows no error while the field is blank; Add stays disabled | yes |
| The unavailable placeholder is the first option, before "Existing Claude login" | First; last | A selected disabled placeholder conventionally comes first; the design does not place it | yes |
| The status line in the ambient row is a polite live region in every state, not only during Checking | Checking only (plan §8); always | Rule B-2 needs the completion announced when focus is elsewhere; the prototype also keeps `role=status` permanently | yes |
| Focus moves to the status line when "Check again" is pressed, or when the add form submits, before the parent disables the control | Move after the disabled render; move in the click handler | Chromium blurs a focused control when it is disabled, so moving after render would find focus already on `body` (busy rule §3.7 c). An `afterRenderEffect` fallback also covers a check started elsewhere. | yes |
| While the add form is pending, Cancel and Escape are disabled | Allow cancel mid-write; block | Cancelling would destroy the form while the write is unconfirmed; the design says "form inputs disabled" | yes |

**Plan deviations**: none to the component boundaries or contracts. The extra exported copy constants (`UNAVAILABLE_ACCOUNT_MESSAGE`, `AMBIENT_ROW_KEY`) were added so F3/F4 can use them.

**Open points for F3-F5**:
- F3 (`account-use-for`): use `useForModel(snapshot, ambientView).<scope>` and bind `[value]` to `model.value`. Map the select's `named:<id>` back to `{kind:'named', profileId}`; `'ambient'` becomes `{kind:'ambient'}`. Never write `'unavailable'`. Show `UNAVAILABLE_ACCOUNT_MESSAGE` when `value === 'unavailable'`. Rename must call `validateAccountName(raw, accounts, profileId)`.
- F4 (`accounts-tab`):
  - Render `<ptah-ambient-account-row [ambient]="ambientService.view()" [chips]="chips().get('ambient') ?? []" (checkRequested)="ambientService.read(true)">`. The `read()` call must start synchronously, so the view turns to `checking` in the same task.
  - Create and destroy `ptah-add-account-form` with `@if`, so each open starts empty.
  - On `cancelled`, focus "Add another account".
  - Pass `refusal` as the host `result.summary` of a failed Add, and clear it when the form reopens.
  - Order the list with `orderedAccounts`. Use `ATTENTION_STATES` for the `border-l-4 border-state-err` spine and `accountInitial` for the avatars.
- F5 (card badge): show `connectedAccountCount(accountsView, ambientView)` as "N connected" only when the value is not null and greater than 0.
- `STATE_LABEL` and `ATTENTION` still also live in `accounts-section.component.ts`. F6 deletes that copy.

**Out-of-scope observations**: `ptah_get_diagnostics` reports TypeScript errors that already exist in unrelated chat specs, for example `chat-transcript.ptah-ui.spec.ts:7` and `compact-session-card.component.spec.ts:319`. This may be the tool's tsconfig rather than the lib's. They were not touched.
