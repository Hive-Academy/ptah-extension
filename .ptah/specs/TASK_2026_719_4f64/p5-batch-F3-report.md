## Frontend implementation - `TASK_2026_719`, P5 batch F3

**Tasks completed**: F3 (plan §10 `AccountUseForComponent`, §11 `AccountDetailViewComponent`).

**Files** (all CREATE under `libs/frontend/chat/src/lib/settings/providers/accounts/`; nothing else touched):

- `account-use-for.component.ts`: `ptah-account-use-for`. The "Use for" `h3` (id `USE_FOR_HEADING_ID` = `account-use-for-heading`, for the F4 tab's `aria-labelledby`), the two muted lines (row 13 note), and one native `<select>` per scope ("New chats", "Claude lanes") with label, hint, the unavailable message when `value === 'unavailable'`, a polite status line (`tabindex=-1`) and a `role=alert` line. Inputs: `model` (from `useForModel`), `pendingScopes: ReadonlySet<scope>`, `messages`, `alerts`. Output: `selectionRequested: { scope; choice: ProviderAccountChoice }`. The DOM value is re-asserted from `model` after every render. A change emits only for a different, enabled, writable value (`unavailable` is never written). Busy rule (a) and B-2 follow the F2 pattern.
- `account-use-for.component.spec.ts`: 15 cases (listed below).
- `account-detail-view.component.ts`: `ptah-account-detail-view`. The in-drawer detail, reworked from `account-details-drawer` without the drawer. Header: "All accounts" back button, `h3` name (`tabindex=-1`, focused on open and whenever a different account is shown), and dot + `STATE_LABEL`. A roving tablist "Account sections" with Overview, Access and Profile (arrows wrap, Home/End, automatic activation). One polite live status (`tabindex=-1`): "Working…" while busy, otherwise the parent's `feedback`. A refusal alert slot, with a neutral block "The status is not available right now." for `release-held`.
  - Overview: State, "Running now" (singular and plural), and a resume notice only for bound runs on an account that is not signed in.
  - Access: the per-state copy from design §3.6, the primary action (Sign in / Try again / Sign out / Cancel sign-in) and Check status in every state. Pending shows either the window note with a spinner (`motion-reduce:animate-none`) or the fallback block (`pre`, `tabindex=0`, `role=region`, label "Sign-in script", text binding; Copy script through `@angular/cdk/clipboard`, "Copied" in a polite region).
  - Profile: the pending lock text, and the rename form (`validateAccountName(raw, accounts, profileId)`, `aria-invalid`, `aria-describedby`, `role=alert` error, "Save name" disabled until the name is valid and changed). "Remove account" opens `ptah-native-modal` (`ariaLabelledby` = title "Remove <name>?", design copy, Cancel focused first; Cancel and Escape return focus to "Remove account").
  - Removed: profile id, owner block and "Set as default".
  - Exports `ACCOUNT_NAME_SAVED`, `ACCOUNT_UNCONFIRMED_WARNING`, `ACCOUNT_STATUS_UNAVAILABLE`, `AccountDetailTab` and `AccountRenameRequest`.
- `account-detail-view.component.spec.ts`: 29 cases (the Access `it.each` counts 5) (listed below).

**Stack observed**: Angular standalone + signals, `input()`/`output()`, `afterRenderEffect` for focus (same as `ambient-account-row.component.ts`); Tailwind/DaisyUI with the `state-*` ink tokens (`apps/ptah-extension-webview/tailwind.config.js:32-36`); `NativeModalComponent` from `@ptah-extension/ui` (`native-modal.component.ts`); account types from `@ptah-extension/shared`, `ProviderAccountChoice`/`ProviderAccountActionKind` from `@ptah-extension/core`.

**Design fidelity**: `design-spec-p5.md` §3.1, §3.6, §3.7, §4, §5 and the prototype (`prototype/p5/index.html` `sel()`, `detail()`, `fallbackBlock()`, `confirmDlg()`). Deviations: see Decisions (remove dialog role, rename label/hint copy, resume notice copy, dot ink).

**States covered**: use-for: stored named / omitted / explicit ambient / absent named (placeholder + message), pending (only that select `disabled` + `aria-busy` + "Saving…"), refused (alert, DOM value reverts), unconfirmed (parent message, value unchanged). Detail: all 7 account states, pending with and without fallback, busy (every action disabled, "Working…"), refusal and release-held, rename invalid/valid/saved, remove confirm/cancel/Escape. Accessibility: labelled selects with `aria-describedby` (hint, unavailable, status, alert), focus ring `outline-base-content` 2px/2px, targets `min-h-[30px]`, text bindings only (spec asserts that markup in a name or script is not parsed), no colour-only status.

**Spec cases**

- Use-for: heading/lines/labels/hints; option order, suffix and disabled; omitted shows Existing Claude login; stored named; **B-1** any absent named id (random id, not a fixture) shows the disabled placeholder + message, with no id in the DOM; **B-1** removal of the selected account keeps it unassigned and emits nothing until the host snapshot arrives, then follows the host value; emit only for a different enabled value; ambient choice mapping; pending disables only one select; refused reverts the DOM value + alert; unconfirmed keeps the value + warning; **B-2** focus returns to the select while still on its status line; **B-2** focus elsewhere stays and the status announces; focus returns at once when no write starts; names as text.
- Detail: heading focus + dot/state; back emits; initial tab Access unless signed in; explicit initial tab; tablist keyboard (ArrowRight wraps, Home, End, `aria-labelledby`); no id/owner/default text on any tab; run binding + resume notice condition; Access copy and primary action for 5 states (`it.each`); signed-in Sign out; pending window copy + Cancel sign-in; fallback as text + Copy script; fallback hidden without a sign-in operation or when not pending; refusal alert + release-held neutral block; rename disabled until valid and changed (duplicate case-insensitive, trim); own case-only rename allowed; pending locks name/removal; "Name saved." + field reset; modal Cancel focus round trip; modal Escape; **B-1** confirm emits `remove` only, focus on the live status; busy disables all actions; **B-2** focus back to the origin; **B-2** to the replacement (Sign in -> Cancel sign-in); **B-2** focus elsewhere stays + announce; **B-2** no focus move once the view is gone.

**Verification**:

- `ptah_get_diagnostics` on the 4 files: no diagnostics in the requested files. The chat lib's sibling specs have pre-existing errors in unrelated files.
- Focused jest: see the result below.
- Lint, typecheck and `npm run verify` were not run, as instructed. The batch verify belongs to the orchestrator.

Focused jest command: `node scripts/verify.mjs --exec --task f3-jest -- npx jest -c libs/frontend/chat/jest.config.ts <account-use-for.component.spec.ts> <account-detail-view.component.spec.ts>`

Result: lock acquired after 812 s. `Test Suites: 2 passed, 2 total`; `Tests: 44 passed, 44 total` (15 for use-for, 29 for the detail view); exit code 0.

**Plan deviations**:

- Use-for `pendingScope` is implemented as `pendingScopes: ReadonlySet<ProviderAccountScope>` (the plan text says "`ProviderAccountScope | null` (one per scope via a `ReadonlySet`)"; the set form is the one that allows both scopes to be pending at once).
- Detail `feedback` is a parent-provided polite string. The detail does not derive "Name saved." itself; it exports `ACCOUNT_NAME_SAVED` and `ACCOUNT_UNCONFIRMED_WARNING` for F4 to pass in. `operation` gates the fallback block (shown only for a `sign-in` operation while pending).
- The remove dialog is the native `<dialog>` of `ptah-native-modal` (role `dialog`), not `alertdialog`. The plan mandates this component, and it has no role input.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use-for re-asserts the DOM value from `model` after every render, including when a write starts, so the select shows the stored value (disabled, "Saving…") while pending | Keep the attempted value shown until completion; always show the stored value | Plan §10 "the select's value is always the authoritative `model.value`"; R2; design §3.7 "the attempted value is never applied" | yes |
| B-2 waiting target is also released when the parent starts no write (focus returns at once) | Leave focus on the status line; return | Prevents a stuck focus when a write resolves synchronously as `unavailable`; same as the F2 ambient row | yes |
| Status line and alert are two elements (`role=status` always, `role=alert` only for a refusal) | One line that swaps its role | Swapping a live-region role is announced unreliably; design §5 separates status (polite) from refusals (alert) | yes |
| Detail focus return: origin `data-action`, else the first enabled `data-action` of the open panel (the replacement) | Origin only; the heading | Design §3.7 (c) "returns to the originating control, or its replacement"; Sign in is replaced by Cancel sign-in | yes |
| After a confirmed Remove, focus goes to the live status (after the dialog's close render) | Leave it to the native close focus restore | The native restore would focus "Remove account", which the busy state then disables (busy rule c). After a successful removal, F4 owns the list focus (P5-D11 / design: "Add another account") | yes |
| Rename label "Account name", hint "Only you see this name. Each name must be different." | Old "Local label"/profile hint; add-form copy | "profile" and the old hint are retired copy (§4); the design gives no rename label | yes |
| Resume notice copy: "Resume unavailable" / "Runs bound to this account cannot resume until it is signed in again." | Old AD copy | Old copy says "profile"; design §3.6 names the notice "Resume unavailable..." only | yes |
| Dot ink: signed-in done, pending run, failed/disconnected err, others idle | Map others to need | Design §3.3 puts the attention spine only on failed/disconnected; no other mapping is given | yes |
| Refusal copy for an unsafe host sentence: the old AD fallbacks ("This action did not complete. Refresh and try again." / "Named accounts are not available on this host.") | New copy | Existing safe wording; no secret or host text is shown | yes |
| Copy failure text "Could not copy. Select the script and copy it manually." | Old curly-quote wording | Same meaning, plain ASCII | yes |

## Open points for F4/F5

- F4 must set `pendingScopes` and the detail `busy` **synchronously** in the output handler (the write call marks the operation before its first `await`). Otherwise the B-2 logic returns focus before the control is disabled. The specs model this with a host that sets them synchronously.
- F4: pass `messages[scope] = ACCOUNT_UNCONFIRMED_WARNING` for an `unconfirmed` select write, and `alerts[scope]` = the safe host summary (or the design fallback "Could not change this setting. That account is not available for Claude lanes right now.") for a failed one. Clear both when a new write starts. The saved toast "<scope> will use <name> for new sessions." belongs to the tab's toast region, not to this component.
- F4: give the detail `feedback` = `ACCOUNT_NAME_SAVED` after a saved rename, `ACCOUNT_UNCONFIRMED_WARNING` after an unconfirmed action, and the add-success toast as needed; `operation` = `state.operations('claude')()[profileId] ?? null`; `fallback` = `state.fallbacks('claude')()[profileId] ?? null`; `refusal` = the failed action's `result`.
- F4: use `[attr.aria-labelledby]="USE_FOR_HEADING_ID"` on the tab region. After the open account disappears, return to the list and apply P5-D11. The detail never reassigns a selection (B-1).
- Visual review (after F7): native select styling in Electron, and `ptah-native-modal` nested inside `ptah-native-drawer` (focus trap, Escape only closes the modal), per design §5 "Not verified".
- F6 deletes `account-details-drawer` / `account-chooser`. Their copy constants are not reused here.

**Out-of-scope observations**: none new. The chat lib's sibling specs have pre-existing TS errors (diagnostics tool), the same ones the F2 report lists.
