# Frontend implementation — `TASK_2026_712_5d7c`, batch 31

**Task completed**: 31.1. A controlled account chooser and a label-only Add account dialog (phase P1-F, Electron first).

## Files

- CREATED `libs/frontend/chat/src/lib/settings/providers/accounts/account-chooser.component.ts`. `ptah-account-chooser` is a presentational chooser for one scope.
- CREATED `libs/frontend/chat/src/lib/settings/providers/accounts/add-account-dialog.component.ts`. `ptah-add-account-dialog` asks for a label only.
- CREATED `libs/frontend/chat/src/lib/settings/providers/accounts/account-chooser.component.spec.ts`. 12 tests.
- CREATED `libs/frontend/chat/src/lib/settings/providers/accounts/add-account-dialog.component.spec.ts`. 11 tests.

All paths are relative to the worktree `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e`. No other file was touched.

## Component API

### `AccountChooserComponent` (`ptah-account-chooser`)

| Kind | Name | Type | Meaning |
| --- | --- | --- | --- |
| input (required) | `open` | `boolean` | Visibility, owned by the parent |
| input (required) | `scope` | `ProviderAccountScope` (`'main' \| 'lane'`) | The future route this chooser writes |
| input (required) | `accounts` | `readonly ProviderAccountSummary[]` | Authoritative profiles from the snapshot |
| input (required) | `selection` | `ProviderAccountSelection` | The scope's stored selection. `omitted` and `ambient` both mark "Use existing default" as current |
| input | `pending` | `boolean` (default `false`) | A selection write for this scope is in flight. Choices are disabled |
| input | `error` | `string \| null` | Safe result sentence. Text that fails `isSafeProviderAccountSummary` is replaced by fixed copy |
| output | `chose` | `AccountChoiceIntent = { scope, choice: ProviderAccountChoice }` | Ambient or named profile ID, tagged with the chooser's scope |
| output | `closed` | `void` | Cancel, Escape or backdrop |

`AccountChoiceIntent` is exported from the component file.

### `AddAccountDialogComponent` (`ptah-add-account-dialog`)

| Kind | Name | Type | Meaning |
| --- | --- | --- | --- |
| input (required) | `open` | `boolean` | Visibility, owned by the parent |
| input | `pending` | `boolean` | The Add write is in flight. Submit is disabled |
| input | `error` | `ProviderAccountActionResult \| null` | Refusal. A safe `summary` is shown as is; any other text becomes fixed copy |
| output | `add` | `string` | The trimmed label, checked against `isSafeProviderAccountLabel` and `maxlength = PROVIDER_ACCOUNT_LABEL_MAX_LENGTH` (64) |
| output | `closed` | `void` | Cancel, Escape or backdrop |

Neither component has an RPC call, an injected state service, a path chooser, a login, or a process. The only injections are `DOCUMENT` and `ElementRef`, used to restore focus to the opener. Neither component has a selection output that fires on Add.

## Dialog pattern reused

- The shared `NativeModalComponent`: `libs/frontend/ui/src/lib/native/modal/native-modal.component.ts`. It provides the native `<dialog>` with `showModal()`, the Tab wrap, Escape through the `cancel` event, and a backdrop close request. Its parent controls `isOpen`.
- Layout and focus classes follow the sibling `libs/frontend/chat/src/lib/settings/providers/add-cli-instance-modal.component.ts`: the `surface-3` header, `text-base-content` / `text-base-content-muted`, the `FOCUS` ring string, and `btn btn-outline btn-sm` / `btn btn-primary btn-sm`. The sibling's spec technique is also reused: a host component, and `HTMLDialogElement.showModal/close` stubbed with `??=`.
- Focus restore: each component records the element that had focus outside it when `open` turns true, and focuses that element again when `open` turns false. This covers Cancel, Escape and a parent close after success. It also works under jsdom. In browsers the native dialog does the same thing, and the two restores agree.

## Copy taken from the design

- §3.2:
  - "Use existing default" is the first option, always enabled, and marked current when the scope has no named selection. A row is never selected implicitly.
  - Signed-in profiles come first, then all other profiles, each labelled with its state.
  - "No named Claude accounts yet." is the empty text.
- Prototype `#chooser`, which is the reference for §3.2:
  - The title is "Choose account for next main session" or "Choose account for next Claude lane".
  - The subtitle is "This changes only the selected future route."
  - The ambient row's secondary text is "Existing runner resolution".
  - Each row's secondary text is "`<state>` · `<last 4 of id>`".
  - The `stateCopy` sentence "Sign in before using this profile." appears on every profile that is not signed in. §3.2 requires that the status explain sign-in is needed before use.
- §3.5: the state labels are Not signed in / Signing in… / Sign-in cancelled / Sign-in failed / Disconnected / Signed in / Signed out. "Signed in" is shown only when the input state is `signed-in`, so named admission (release-held, D7) is never implied.
- §3.1 / §3.6 and prototype `#addDialog`:
  - The title is "Add a named Claude account" and the helper text is "Enter a local label only.".
  - The field is "Local label". The buttons are "Cancel" (`btn-outline`) and "Add profile" (`btn-primary btn-sm`, the only primary action).
  - The duplicate refusal is the exact `PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY` ("This local account directory is already represented by another profile. Rename that profile instead."). It is rendered from the host result in `role="alert"`, with `aria-invalid` and `aria-describedby` set on the field.

## States and accessibility

- **Pending**: each dialog has its own polite `aria-live` status region ("Saving selection…" / "Adding profile…"). Regions outside the dialog are inert under `showModal()`. While pending, choices and submit are disabled.
- **Error**: `role="alert"` with a safe sentence or the fixed fallback "This action did not complete. Refresh and try again." This is the state service's `FALLBACK_SUMMARY` copy. The error is hidden while pending.
- **Empty**: only the ambient choice, plus the exact empty text.
- **Keyboard**: every choice and control is a native `<button type="button">`. Add submits the form, so Enter works. Escape works through the native modal. The focus ring is `outline-base-content` 2px with a 2px offset. Light `base-content` is dark (13:1, §5).
- **Theme**: only DaisyUI semantic classes are used (`base-content`, `surface-3`, `badge-outline`, `btn-*`), so Anubis and Anubis Light both apply.

## Specs written

The tests run with Angular TestBed and a host component. They use no production mock-outcome selector, no `jest.spyOn` on a module, and no `process.cwd()`.

- **Chooser**:
  - The empty state shows ambient only plus the exact text.
  - Ordering, and state text that never implies sign-in.
  - The current marking, with no implicit choice.
  - A newly added profile is not selected.
  - Main-scoped ambient and named intents; lane-scoped intent.
  - Native button semantics.
  - Focus returns to the opener on Cancel, on Escape (the `cancel` event), and after a committed choice.
  - Pending announcement and blocking.
  - The safe error, and an unsafe error replaced by fixed copy.
- **Add dialog**:
  - The dialog has a single label field and the exact copy.
  - Label validation (blank, control character).
  - Enter submits the trimmed label.
  - A duplicate label is allowed.
  - The exact duplicate-directory alert.
  - An unsafe refusal is replaced.
  - Pending announcement, including blocking Enter.
  - Focus returns to the opener on Cancel, on Escape, and after a committed Add.
  - Each open starts with an empty label.

## Verification

- `ptah_get_diagnostics` scoped to the 4 files: **no diagnostics in the requested files** (typescript-compiler, coverage clean).
  - The same project has existing sibling errors in older spec files (e.g. `agent-card-truncation.spec.ts`, `send-message-chip.component.spec.ts`). They were not touched.
  - Angular template type-checking is not part of this check.
- I ran no Jest, Nx, lint or typecheck, as the batch instructed. The orchestrator owns `Verify-ProviderAccountsBatch -Projects @('@ptah-extension/chat')`.

## Decisions

1. **Labels need not be unique.** Options were to block duplicate labels on the client, or to allow them and show the host's refusal. Evidence: `provider-account.store.ts` rejects only a duplicate canonical route (`conflict` with `PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY`), and has no label uniqueness. So the dialog allows a duplicate label and shows the host's secret-free refusal. Reversible.
2. **Pending copy.** Neither the design nor the prototype names a pending sentence, so I chose "Saving selection…" and "Adding profile…". Reversible; Batch 35 design review may replace them.
3. **Empty label on open.** The prototype prefills "New local profile". The dialog instead starts empty and keeps Add disabled, so a default-named profile cannot be created by accident. Reversible.
4. **Same chooser for both scopes.** The chooser emits `{ scope, choice }` and leaves closing to the parent. It does not close itself on choose, so the parent can close on the committed result. This matches the "selection clears only committed result" rule in Batch 29.
5. **Claude-only copy.** "No named Claude accounts yet." and "next Claude lane" are Claude-specific. A provider input waits for the Phase 2 Codex readiness the plan names; adding one now would be speculative.
6. **Focus ring.** The ring uses the sibling's `outline-base-content`, which is dark in Anubis Light, rather than a new `--focus-ring` token. No such token exists in `styles.css`. Batch 33 owns the light-neutral focus pass.

## Open items

- Rendered dark and light Electron evidence is still held, as the plan states. Batch 33 does the wiring into `AccountsSection`.
