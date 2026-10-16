# Batch 40b report: P4 fix round, Decision model row

Executor: frontend-developer subagent. Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`.
No git command was run. No Nx, Jest, tsc, build or e2e command was run. `ptah_get_diagnostics` (TypeScript), scoped to
the two changed files, reports no diagnostics in them. `npx prettier --write` left both files unchanged.

## Changed files

- MODIFIED `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts`
- MODIFIED `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.spec.ts`

`provider-consumer-rows.ts` and `libs/backend/**` were not touched.

## Items

| # | Item | Fix (file:line in `decision-model-row.component.ts`) |
| --- | --- | --- |
| 1 | S-3 UI part: no raw error to `LoggingService.warn` | The three catches log a fixed message plus `{ errorType }`: `agent:getConfig failed` (:518-520), `agent:setConfig failed` (:639-641), `model suggestions failed` (:668-670). `errorTypeOf` (:694-697) returns the constructor name or `typeof`, never the message, stack or fields. This is the sibling convention in `providers-settings.component.ts:1009-1014`. Nothing caught is rendered. The toast keeps the fixed `SAVE_FAILED` / `KEY_REMOVE_FAILED` text, and a failed listing shows fixed help text. |
| 2 | M-4: structured suggestion filter and help text | The `supportsToolUse` filter is gone, so the list is unfiltered (:658-666). The help text (:471) now says "Suggestions list this provider's models. Pick one that supports structured output (JSON schema); not every listed model does." The class doc (:67-70) states the reason. |
| 3 | Visual S1: control border 1.21:1 in light | `CONTROL_INK = '!border-base-content-muted'` (:45-50) is used on `SELECT` (:51) and `INPUT` (:52). |
| 4 | Visual S2: placeholder 3.28:1 in light | `INPUT` adds `placeholder:!text-base-content-muted` (:52). |
| 5 | 40a note: an `unset` + `unreachable` selection means "not read" | In `reload()` (:503-524), `selectionNotRead` (:686-692) maps that pair to `status = null`. The row then shows the existing not-read state: the cell says "Status not reachable", the badge says "not reachable", and the message and Retry button appear. `save()` (:583-602) builds Undo only from a read `status`, so no Undo can write `unset` over the real stored selection. |
| 6 | Minor: "Remove stored key" always shown | The button is now inside `@if (keyMayBeStored())` (:290-301), and the rule is in `keyMayBeStored` (:473-484). After a successful removal, focus moves to the key field (:604-622), because the button disappears. |
| 7 | Minor: the footer promises "with Undo" for a key write | The footer is `footer()` (:316-321, :485-495). It promises only the Undo the next save will offer. It has three variants: Undo with the status read; Jev, where a key change has no Undo; and status not read, where no save has Undo. |

### Root cause for items 3 and 4

The `border-base-content-muted` utility was already on the controls, but it did not apply in the light theme.

- `apps/ptah-extension-webview/src/styles.css:2129-2141` is nested in `[data-theme='anubis-light']` (:2062).
- That rule sets `.input/.select { border-color: oklch(var(--b3)) }` and
  `.input::placeholder { color: oklch(var(--bc) / 0.5) }` at specificity (0,2,0). It beats the (0,1,0) utilities.
- In the dark theme this rule does not exist, so the utility already applied there.

I did not edit `styles.css`, which is app-level and outside this batch. The row forces the colour with Tailwind's
important modifier. The repository already does this for the same light-theme rule:
`advanced-settings-group.component.ts:269-274` (`!border-[color:var(--ptah-error-ink,...)]`).

### Expected contrast (token `base-content-muted` = `--bcm`, values from `tailwind.config.js` and `base-content-muted.spec.ts`)

| Element | Theme | Foreground | Background or adjacent colour | Expected ratio | Needed |
| --- | --- | --- | --- | --- | --- |
| Control border (select, model input, key input) | anubis-light | `--bcm` `oklch(48.96% 0.045 348.5)` | control fill base-100 / popover base-100 | 6.03:1 | 3:1 |
| Control border | anubis-light | same | if the surround is base-200 / base-300 | 5.39:1 / 5.01:1 | 3:1 |
| Control border | anubis (dark) | `--bcm` `oklch(66.51% 0.0074 31.1)` | control fill base-100 `#131317` | 6.06:1 | 3:1 |
| Control border | anubis (dark) | same | surround base-200 `#1a1a20` / base-300 `#242430` | 5.66:1 / 5.01:1 | 3:1 |
| Placeholder ("jev-1.13.0", "Enter a new key to store it") | anubis-light | `--bcm` | input fill base-100 (`#faf7f5`) | 6.03:1 (was 3.28:1) | 4.5:1 |
| Placeholder | anubis (dark) | `--bcm` | input fill base-100 `#131317` | 6.06:1 | 4.5:1 |

These ratios are the ones `base-content-muted.spec.ts` computes and enforces (at least 4.5:1 on every base). I did not
measure the rendered ratios here. The visual re-check in `646-after-shots` should confirm them.

## Spec cases (`decision-model-row.component.spec.ts`)

Changed:
- `:298` Ollama test also asserts the footer "... Other choices save with Save. Undo puts the previous choice back."
- `:323` `Structured: a configured provider, then any model of its catalogue, with help text that matches the list (P4 M-4)`.
  It expects the suggestions `['with-tools', 'no-tools']` and the exact new help text, with no "tool use" in it.
- The `LoggingService` double is now the `warn` mock, so the new cases can assert on it.

Added:
- `:433` `hides Remove stored key when the host reports no stored key, and says a key change has no Undo (P4 visual Minors)`.
  Uses Jev with `no-credential`.
- `:449` `offers Remove stored key while the key state is unknown, then hides it once removed and focuses the key field`.
  The saved selection is Ollama. It sends exactly `{ decisionModelJevApiKey: '' }` with no Undo, then the button is gone
  and focus is on `decision-jev-key`.
- `:507` `treats an unset selection the host could not read as not read: Retry, and a save offers no Undo that writes unset (40a D1)`.
  It checks the not-reachable badge, cell and message, the Retry button, and the footer sentence. A save writes only the
  new choice with `canUndo: false`. Calling `undo()` writes nothing, and `{ kind: 'unset' }` is never written.
- `:539` describe `logs carry a fixed message and an error type, never the raw error (P4 S-3)`:
  - `:543` a status read that throws. `warn` gets `{ errorType: 'Error' }`, and the secret appears in neither the logs
    nor the DOM.
  - `:557` a save that throws a `TypeError`. `warn` gets `{ errorType: 'TypeError' }`, the toast shows the fixed
    `SAVE_FAILED`, and no secret is logged.
  - `:575` a model listing that throws an `Error`, then one that rejects with a string. `warn` gets
    `{ errorType: 'Error' }`, then `{ errorType: 'string' }`, and the help text is fixed.
- `:602` `forces a readable control border and placeholder over the light-theme input rule (P4 visual S1, S2)`. The
  class check covers the select, the model input and the key input. jsdom cannot compute colours, so the ratio check
  belongs to the visual re-check.

## Decisions

- **D1: when "Remove stored key" is shown (item 6).**
  - What the status knows: `DecisionModelStatusDto` has no key-present flag. The host knows about the key only for a
    saved Jev selection (`lane-routing/.../decision-model.config.ts:386-414`): `ready` means a key is stored,
    `no-credential` means none is stored, and `unreachable` means the credential store failed.
  - Options:
    - (a) Show the button only for a saved Jev selection that is `ready`.
    - (b) Hide it when the host says no key is stored (Jev with `no-credential`), and also after this row has removed
      the key. Show it when the key state is unknown.
  - Chose (b). This is also the reviewer's suggestion ("disabling or hiding it when the state is `no-credential`").
  - Why not (a): with Ollama, structured or not-read saved, the user could not delete a stored key without first
    saving Jev as the decision model. Saving Jev sends request text to TypeSafe Jev, so the only way to delete the key
    would cost the user privacy.
  - Rule order: a later key save clears the local flag, and a host status that knows the key state always wins.
  - Reversible: yes. The rule is the one computed at :473-484.
- **D2: what the row shows for an unread selection (item 5).** It reuses the existing "status not reachable" row from
  `buildDecisionRow(null)`, not a new state. That row already says that saving stays open, and it offers Retry.
  - I made no change to `provider-consumer-rows.ts`.
  - The host's fixed detail ("The saved decision model could not be read. It is unchanged.") is not shown, because the
    null row has no detail. The badge and the message still say the status was not read.
  - Reversible: yes.
- **D3: M-4 removes the filter instead of adding a capability filter.** `ProviderModelInfo`
  (`libs/shared/.../rpc-providers.types.ts:57-87`) and `ModelCapability` (`auth-env.types.ts:43-50`) carry no
  structured-output or JSON-schema flag.
  - The adapter needs `outputFormat: { type: 'json_schema' }` and a `structured_output` result
    (`libs/backend/agent-sdk/src/lib/lane-routing/structured-decision.adapter.ts:134, 209-216`). It has nothing to do
    with tool use (`toolAccess: 'none'`).
  - So no honest filter exists. The list is unfiltered, and the help text says the user must pick a model that
    supports structured output.
  - Note: the adapter lives in `agent-sdk`, not in `lane-routing`. `lane-routing` holds only the port
    (`structured-decision.port.ts`).

## Out-of-scope observations (not touched)

- The same light-theme border and placeholder failure applies to every sibling Settings control that relies on a
  plain `border-base-content-muted`, for example `main-agent-reassign-popover.component.ts:26`,
  `providers-settings.component.ts:235`, the `provider-setup-wizard.component.ts` inputs and
  `provider-consumer-assignments.component.ts:429`.
  - Cause: the (0,2,0) rule at `apps/ptah-extension-webview/src/styles.css:2129-2141`.
  - A shared fix belongs in `styles.css` (lower that rule's specificity or use `--bcm` there). That is outside this
    batch.
- Visual Minor 6: in the dark theme, the focus ring of "Remove stored key" touches the "Save decision model" button.
  It was not in this batch's list, so I did not change it. A `mt-1` on the Save button, or a gap wrapper, would fix it.
- Visual Moderate 1 (raw "Detail: fetch failed") is Batch 40c, host side. The row still renders `detail` as
  interpolated plain text.
