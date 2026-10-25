# Implementation report — TASK_2026_712, Batch 33a

Executor: frontend-developer subagent (Claude). No commits and no nx/jest/tsc/lint runs (batch rule).
Only `ptah_get_diagnostics` scoped to the changed files.

## Changed files

| File | Change |
| --- | --- |
| `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts` | CREATED. `ptah-accounts-section` (:133), standalone, OnPush. Inert gate `@if (view().status !== 'inert')` (:142). Routing summary (:224), profile cards (:292), nested Manage (:358), toast (:373), container queries (:437, :453), light-theme focus ring (:424). Lifecycle `ngOnInit → open('claude')` (:555). Add (:591), scoped choice (:618), drawer action runner (:696). Exported copy `ACCOUNT_HELD_NOTE` (:71) and `ACCOUNT_API_NOTE` (:73). |
| `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.spec.ts` | CREATED. 15 tests (list below). |
| `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` | MODIFIED. `VSCodeService` import (:20), section import (:50) and `imports` entry (:89), placement block (:358), `accountsAvailable = inject(VSCodeService).isElectron` (:563). Nothing else on the page changed. |
| `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts` | MODIFIED, header comment only (:18-25). The old comment said "no row uses the Claude keys until `SYSTEM_CLI_TYPES` includes `claude`". That was stale: the tuple now includes `claude`. The comment now says where the lane account lives, and why the matrix has no account field. |
| `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts` | Not changed. The section needs nothing new: `state`, `open`, `refresh`, `addAccount`, `renameAccount`, `removeAccount`, `startSignIn`, `cancelSignIn`, `signOut`, `refreshAccountStatus`, `setSelection` and `setDefault` are already there and already gated on `isElectron`. |
| `libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts` | Not changed, because the service did not change. |

## Page placement

The Accounts block is inside the Connections `<section>`. It comes after the Connections grid (the
"+ Connect another provider" tile) and before the unchanged catalog hint strip:
`providers-settings.component.ts:356-362`.

It is wrapped in `@if (accountsAvailable) { @defer (on immediate) { <ptah-accounts-section/> } }`.
On a host that is not Electron, only Angular comment nodes are rendered. So the existing spec
`providers-settings.component.spec.ts:709` (the grid's `nextElementSibling` is the hint) still holds,
and `ProviderAccountsStateService` is never created there. The `@defer` follows the catalog modal's
pattern, so the eager route stays inside its bundle budget.

These parts of the page are untouched: the main routing map, the reassign popover and scope badges,
the connection cards, the connection drawer, the setup wizard, the catalog hint and modal, and the
commit feedback (parity-inventory rows).

## How the selectors reach the actual launch

- **Next main session**: the cell writes the stored `main` scope with
  `ProviderAccountsStateService.setSelection('claude','main',choice)`. The host reads it at start time
  in `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts:129-133`.
  - It only does so when the active auth is `claudeCli`, so a deliberately chosen API provider is not
    overridden.
  - Running sessions keep their binding.
  - Admission then refuses a named account as `release-held` (D7):
    `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:68-78`.
  - The UI never shows a named route as admitted. A named cell shows `ACCOUNT_HELD_NOTE`.
- **Next Claude lane**: the cell writes the stored `lane` scope the same way, and only that scope.
  **Nothing in the lane spawn reads this selection yet.** That makes it a bounded follow-up:
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:725` calls
    `runSdk({...})` with no `accountAdmission`.
  - The Claude adapter consumes `input.accountAdmission` in `ClaudeCliAdapter.prepareNamed`
    (`claude-cli.adapter.ts:275`, admits with `scope: 'lane'` at :314). No production code sets it.
  - **Follow-up (backend, outside this batch):**
    1. At `agent-process-manager.service.ts:725`, for `cli === 'claude'` with no explicit
       `accountSelection` and no resume, read the stored lane selection
       (`ProviderAccountService.selection(workspaceRoot,'lane')`).
    2. Pass it as `accountAdmission` (`provider:'claude', scope:'lane'`).
    3. Keep the D7 release hold. A spec must cover ambient/omitted being unchanged, named being
       refused as `release-held`, and resume ignoring the stored selection.
  - The Claude system row in the CLI matrix gets **no account field**, because nothing would read it.
    Model and effort stay the existing `claudeModel` / `claudeReasoningEffort` cells (33b).

## Section behaviour

- **States:**
  - Inert host: nothing is rendered.
  - Idle (no workspace): "Accounts load when a workspace is open."
  - Loading with no snapshot: progress text, `aria-busy`, and Add is disabled.
  - First read failed: a `role="alert"` with the owner's fixed sentence and a Retry button that
    calls `refresh('claude')`.
  - Re-read failed: the last snapshot stays, under a "Showing the last loaded accounts…" status
    with Retry.
  - Empty: "No named Claude accounts yet…", and both cells read "Use existing default".
- **Routing cells:** initials, name or "Use existing default", state text, a 4-character profile-ID
  suffix, the exact scope sentence, and an outline Change button. The main cell also notes that a
  chosen provider and running sessions are unaffected. Each Change opens the chooser for its own
  scope, and the write goes only to that scope.
- **Cards:**
  - A keyboard `role="button"` (Enter/Space, only when the card itself has focus).
  - Initials, label, monospace profile ID, state dot plus text, and owner evidence ("Verified
    identity" / "Unknown owner").
  - "Next main" / "Next lane" badges taken from the snapshot.
  - "Run binding · N active run(s)" only when `activeRunCount > 0`.
  - A 4px `border-l-error` spine only for `failed` and `disconnected`.
  - The nested Manage button calls `stopPropagation()` on click and keydown.
- **Drawer:** these intents go to the matching state methods: refresh status, sign in, cancel,
  sign out, rename, set default and remove. The drawer gets the pending kind, a failed result, and
  `saved` for rename. Closing the drawer does not cancel a sign-in.
- **Toast** (`role="status"`, `bg-neutral text-neutral-content`):
  - Default uses the exact `ACCOUNT_DEFAULT_TOAST`.
  - Add: "Profile added. It is not selected for any route."
  - Change: "<scope> account saved. <scope sentence>".
  - Remove: "Local profile metadata removed."
  - An unconfirmed write: "This action may not have completed. Accounts were reloaded." It is never
    reported as saved or as rolled back.
  - There is no timer: the toast clears on the next action.

## Responsive approach

Container queries in the component styles, following `routing-map.component.ts`. `:host` sets
`container-type: inline-size`, so the Settings content width decides, including the ~400 px
embedded sidebar.

| Container width | Layout |
| --- | --- |
| Under 40rem (<640) | One column. Profile and state wrap, then badges, then Manage. |
| 40rem and up (640–959) | Manage is a right rail, and the metadata wraps before it. The summary cells stay stacked. |
| 60rem and up (>=960) | The summary becomes two equal cells. |

Everything uses `minmax(0,1fr)`, `min-w-0` and `break-words`, and badges use `flex-wrap`, so there
is no horizontal overflow. This is source-level only: rendered proof is still held for the visual
review.

Focus and toast:

- **Focus ring:** 2px solid, 2px offset, through `--accounts-focus-ring`. It is `oklch(var(--bc))`
  (base-content) in dark themes and `oklch(var(--n))` (neutral) under `[data-theme-mode='light']`
  (`:host-context`).
- **Toast:** `text-neutral-content` on `bg-neutral`. That is light text on a dark neutral in both
  Anubis and Anubis Light (`tailwind.config.js:99,177`).

## Specs

`accounts-section.component.spec.ts` uses child stubs with the real input/output contracts and a
`ProviderAccountsStateService` stub. It has no `spyOn` on modules and no `process.cwd()`. The tests:

1. Opens the `claude` slot; renders nothing when inert (the Electron-only render).
2. Loading: progress text, `aria-busy`, Add disabled.
3. Error: alert, and Retry calls `refresh`.
4. Stale: the snapshot is kept, labelled, with Retry.
5. Empty: default cells and no rows.
6. Owner evidence, state text, run binding only when positive, attention spine.
7. Badges follow the selections; a named route shows the held note and never "admitted".
8. Card click and Enter open the drawer.
9. Nested Manage opens the drawer, and its click does not reach the card or the `li`.
10. Lane and main Change: each writes only its own scope through `setSelection`, never
    `setDefault`; the chooser closes; the toast shows.
11. A refused choice keeps the chooser open with the safe sentence.
12. Add writes the label only, closes, and never selects.
13. A refused Add stays open with the result.
14. Sign-in pending, then failed, reaches the drawer. Cancel, sign out, refresh status, rename
    (saved), default (exact toast) and remove all call the seam.
15. An unconfirmed write shows the unconfirmed toast and no saved or failed state.

## Specs that mock changed members

- `ProviderAccountsStateService`: its only spec is `provider-accounts-state.service.spec.ts`. Its
  members did not change, so it needs no update.
- `providers-settings.component.spec.ts` (not owned): it does not provide `VSCodeService`, so it
  gets the real root service, which defaults to `isElectron: false`. The Accounts block is then not
  rendered, and the existing assertions (including :709) are unaffected. There is no Electron-true
  page test there. The section's own spec covers the Electron-only render; a page-level test would
  belong to whoever owns that spec.
- `cli-matrix-rows` exports: `cli-matrix-rows.spec.ts` and `cli-model-effort-popover.component.spec.ts`
  import it. Only a comment changed, so neither is affected.

## Diagnostics

I ran `ptah_get_diagnostics` (errors only) on the 4 changed `.ts` files. Result: **no diagnostics in
the requested files** (coverage clean). The tool also listed sibling spec errors in the `chat` lib,
in files I did not touch, for example `agent-card-truncation.spec.ts:137` and
`chat-transcript.ptah-ui.spec.ts:7`. They come from the tool's spec-wide program and are not from
this batch.

Not run (batch rule, the orchestrator runs these): `npx nx test @ptah-extension/chat`,
`npx nx typecheck @ptah-extension/chat|core|ptah-extension-webview`, and lint. Expect the known D35
lazy-load lint debt in the new section file, because it imports values from `@ptah-extension/shared`
(`isSafeProviderAccountSummary`), like its sibling components.

## Decisions

- **Placement inside the Connections `<section>`.**
  - Options: nest it before the hint, or close Connections after the grid and move the hint.
  - Chosen: nest. The design order (Accounts before the catalog hint) and the existing spec (the
    hint is the grid's next element sibling) both hold. Moving the hint out would break that spec.
  - Cost: Accounts is a sub-region of the Connections landmark for screen readers.
  - Reversible: yes, if the providers spec owner accepts a structure change.
- **Double gate.** The page checks `VSCodeService.isElectron` (D34) so the service is never created
  elsewhere. The section also hides itself on `status === 'inert'`. Reversible.
- **Lane account wiring is a backend follow-up** (see above). The matrix has no decorative field.
- **Default toast is the section's.** The drawer's `saved` input gets only `rename`, so the default
  sentence is announced once, in the toast (design §3.6). Reversible.
- **Toast foreground** is `text-neutral-content` rather than literal `base-100`. It is the semantic
  token for text on `neutral`, and it is light in both Anubis themes (`tailwind.config.js:99,177`).
  Reversible.
- **Card as `role="button"` containing Manage**, as the design specifies (§5, `.profile[role="button"]`).
  The nested-interactive pattern may be flagged by axe. Manage and the card do the same thing, so
  the visual review can decide whether to drop the card's `role`/`tabindex`. Reversible.
- **Copy the design does not give:**
  - The idle text.
  - The held note: "Named account starts are awaiting release authorization."
  - The main API note.
  - The Add, select and remove toasts.

  None of them claims admission, deletion or a sign-in. Reversible.
- **State labels:** the section keeps a local `STATE_LABEL` map. It is the same as the chooser's,
  which is not exported and not owned by this batch. Merging the two belongs to whoever owns the
  chooser.

## Out-of-scope observations

- The child components (chooser, drawer, Add dialog) still use `focus-visible:outline-base-content`.
  In Anubis Light, base-content is dark, so they pass contrast. But design §5 asks for the neutral
  token, which belongs to their owners (D35 "focus ring light-theme token → Batch 33"). This batch
  only owns the section, so they are unchanged.
- `git status` also shows changes in files this batch does not own, which belong to other lanes:
  - `libs/shared/src/lib/types/agent-process.types.ts`
  - `libs/backend/platform-core/src/file-settings-keys*.ts`
  - `libs/backend/vscode-lm-tools/...`
  - `implementation-report-batch-34b.md`

  I did not touch them.
