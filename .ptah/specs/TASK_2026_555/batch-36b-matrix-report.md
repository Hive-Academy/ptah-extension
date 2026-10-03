# Batch 36b, stream 1: CLI matrix, popovers, modals and shared ui (Gate V 36 fixes)

Worktree `task-555-settings-redesign`, base head `e75a1cf31`. In-process `frontend-developer`, same-side. No git writes, no
stash, no `batches.md` edit. Stream 2 (roles: agent-orchestration-config, orchestration-settings,
provider-consumer-*) ran at the same time; no file overlap. The coordinator approved the `save()` return value. It also
passed the user's Gate V 36 decisions 1-3, which are applied below.

## Finding, fix and spec

Paths are relative to `libs/frontend/`. `matrix` = `chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts`,
`add` = `chat/.../providers/add-cli-instance-modal.component.ts`, `tier` = `chat/.../providers/cli-tier-mapping-modal.component.ts`,
`state` = `core/src/lib/services/providers-settings-state.service.ts`, `feedback` = `chat/.../feedback/settings-save-feedback.service.ts`.

| Finding | Fix (file:line) | Spec |
| --- | --- | --- |
| S1 failed/timed-out Test shown as an earlier pass | `state:268` clears the store before the call and reads with `retainOnError=false`. The RPC timeout is 45 s (`state:76`), above the host's 30 s abort. `matrix:559` `testResult` shows nothing while this row runs. | state spec "S1: a new Test drops the earlier pass…", "S1: the Test RPC timeout…"; matrix spec "S1: a failed or timed-out run never shows the earlier pass…" |
| S2 key kept across a provider switch | `add:276` `selectProvider` clears the key (and its visibility and the sign-in action). `add:304`: a hidden key field sends `''`. | add spec "S2: switching provider drops the typed key; a hidden key field is never submitted" |
| M1 host text in "Test failed: {reason}" | `matrix:44` fixed `The connection test failed.`. `state:78` maps only the registry's FIXED strings (`API key not configured`, `No response received from provider`, `Agent configuration not found`) to fixed copy. Anything else becomes `reason: null`, so host text never enters state. | state spec "keeps the test latency; a failure reason is fixed copy…"; matrix spec "M1: a failure is a fixed sentence…" |
| M2 success read from shared `commit()` | `feedback:29` `save()` returns `'saved' \| 'failed' \| 'refused'` (additive). Callers use it: `add:308`, `tier:257` (and `saveTier` returns it), `cli-model-effort-popover:238`, `matrix:617`. `commit()` is read only after `'failed'`, where it is this save's own, for the blocked-context refresh. | feedback spec "M2: resolves this call's own outcome…"; "M2" cases in the add, tier, popover and matrix specs (refused write while an earlier commit says saved) |
| M3 Cursor confirmation and focus lost when the row moves | `feedback:142` `announce()` (page toast, no Undo). `cursor-credential-popover:157` announces every outcome, which survives the popover being destroyed. `matrix:498` `closeCredentials` returns focus to the row's Credentials trigger after render, wherever the row is. | cursor spec "M3: the confirmation survives the popover being destroyed mid-save"; matrix spec "M3: after the Cursor row moves groups…" |
| M4 credentials stored, not checked | Cursor outcome `Key stored, not verified.` (decision 3: accepted deviation, the real check stays a follow-up). Add: `add:29`. A create with a key reads `Created {name}. Key stored, not verified. Testing the connection.`, and a key replace reads `Saved {name} instance. Key stored, not verified.`. `add` emits `created(name)`, and `matrix:468` `onCreated` runs that instance's Test, whose result shows inline. | cursor spec (save text, toast); add spec "creates through saveSettings…" (toast + `created`); matrix spec "M4 / Minor 2…" |
| M5 tier modal loads forever | `tier:80` shows a fixed alert "This instance's tier mapping could not be loaded." with Retry (`tier:260`, `state.refreshCliModels()`) when `cliModels` errored, or finished without this instance. | tier spec "M5: a failed mapping read…", "M5: a read that finished without this instance…" |
| M6 stale Copilot "Signed in"; panel in Edit | `add:224`: only this open's own check or login counts. Choosing Copilot runs `performExternalAuth('github-copilot','cli-check')`, so it re-reads `auth:getAuthStatus`, labelled "Checking sign-in…". `add:240`: in Edit the panel shows only when the Copilot connection reads signed out (`configured === false`), and then it does not gate Save. | add spec "M6: an earlier Copilot sign-in…", "M6: a reopened form forgets…", "M6: editing a Copilot instance…" |
| M7 "Not saved" after the rename landed | `add:324` sends the rename and the key as two `ptahCli:update` operations in one commit, so the commit reports each field. `add:350` uses fixed copy: `Name saved. The key was not saved.` (or `… Could not confirm whether the key was saved…`), through the request's `failureMessage`. | add spec "M7: name and key are two writes…"; feedback spec "uses the request's fixed failure and success copy…" |
| M8 last Test outlives a key/name/tier change | `state:281` `clearCliTest(id)` drops that instance's result and discards its in-flight run. It is called in the write (and Undo) closures of every edit (`add:327`) and tier write (`tier:289`). | state spec "M8: clearCliTest…"; add spec (key replace, M7); tier spec "M8: every tier write (and its Undo)…" |
| M9 duplicate names, any manual tier id | `add:215`: case-insensitive duplicate against every other instance, fixed inline alert "Another Ptah CLI instance already uses this name.", Create/Save disabled, `maxlength=80`. `tier:168`: the manual id has no whitespace and is 200 characters at most, with a fixed alert "Enter a model ID without spaces, up to 200 characters." and `aria-invalid`. | add spec "M9…" (create and edit); tier spec "M9: rejects a manual id…" |
| Minor 1 unused `hasStoredKey` | Removed from `CliInstanceEditTarget` and `matrix` `openEdit` | add/matrix specs compile without it |
| Minor 2 focus after a create from the empty state | `matrix:357` `openAdd('empty')`. `onCreated` focuses the new row's Tiers after render. | matrix spec "M4 / Minor 2…" |
| Minor 3 raw field keys in failure toasts | `feedback:32` drops dotted settings keys (`ptahCliAgents.<id>.tierMappings`, `agentOrchestration.*`) from "Not saved / Not confirmed". The label sentence leads, and an unconfirmed raw key becomes "It may have been saved; check the current value before retrying." Human field names still show. | feedback spec "Minor 3…" |
| Minor 4 Undo overwrites `disabledClis` | `matrix:595`: write and Undo each compute this one CLI's entry against the list at the time they run | matrix spec "Minor 4…" |
| Minors 5, 6 | Not changed (accepted) | — |
| V36-1 closed modal in the Tab order | `ui/.../native-modal.component.ts:143` sets `inert` while closed (lifted before `showModal()`). `:101` `dialog.modal:not([open]){display:none}`. `visibility` was tried first, but `.modal` transitions it, so `showModal()` focused a still-hidden dialog: stream 2 caught 22 focus failures, fixed before the final run. | ui spec "keeps a closed dialog inert…", "lifts inert before showModal…". Browser: probe Tab walk, 0 stops in closed Settings dialogs, both hosts. Every NativeModal dialog computes `none/inert` closed. Providers catalog/wizard: the visual smoke's catalog-focus step and Gate G pass. |
| V36-2 helper text < 12 px | `text-xs` on the matrix subtitle (`matrix:95`), version and provider sublines (including the Electron provider line), the Uninstalled header (now a 12 px button), the Test result line, the permission/install popover text, the Copilot toggle copy, the tier-source line and the add-form key hint | matrix spec "V36-2: helper text is 12 px…" (asserts no `text-[10px]` left), "V36-2: the Test result line…" |
| V36-4 picker pill coloured text | `ui/.../provider-model-picker.component.ts:246`: label `text-base-content`, `border-info/40 bg-info/10`, `text-info` only on the icon | picker spec "V36-4…" (shared; the Providers drawer specs still pass) |
| V36-7 actions wrap to 3 lines | `matrix:271`: Tiers and Test inline, `flex-nowrap`. Edit ("Edit name or key") and Delete are in a `NativePopover` "More actions for {name}" (`cli-matrix-more-<id>`, 24x24, Esc and focus return). Delete moves focus to the confirm's Cancel, and Cancel returns it to More. All testids kept. | matrix spec "V36-7…", "cancels a delete…"; probe: Tiers, Test and More on one y in both hosts |
| V36-9 placeholder clipped | `cli-model-effort-popover:89` `Search models` (92 px of text in a 206 px field, both hosts) | popover spec (placeholder) |
| Decision 1 Electron fold | `matrix:122`: the Uninstalled group is collapsed by default behind a disclosure button `Uninstalled CLI agents (N)` (`aria-expanded`, keyboard). It stays open while a popover's row is in it (Cursor key removal). Harness: `expandUninstalled()` in the entries, the #77 table entry and the visual Cursor capture. | matrix spec "decision 1…" (both) |
| Decision 2 two-step Esc in the tier modal | `ui/.../provider-model-search-field.component.ts:181` adds `openOnFocus` (default `true`, so the Providers popovers are unchanged). The tier modal passes `false` (`tier:117`). | search-field spec "with openOnFocus off…" (two cases); tier spec "decision 2…" |

## Harness (click paths changed in this batch)

- `settings-cli-matrix.entries.ts`:
  - New helpers `expandUninstalled` and `openMoreActions`; `matrixRow` expands the group for Cursor and Pi.
  - #50 and #55 go through More actions, with focus asserted.
  - #71 asserts the `(2)` disclosure.
  - #47 now has two variants: a signed-in host (the re-read shows Signed in and Create is enabled), and a signed-out
    host (Login runs, the re-read still says not confirmed, and Create stays disabled).
- `settings-reachability.table.ts`: #77 opens the group, and #78 opens More then Esc.
- `settings-orchestration.e2e.spec.ts`: the edit scene goes through More, and focus returns to More.
- `settings-visual.e2e.spec.ts`:
  - The Cursor capture expands the group, then collapses it again.
  - The fold reads the reference set from the disclosure (`5+2 (collapsed)`) and asserts the group is collapsed.
  - The Electron roles-summary ratchet stays off. See the fold section.

## Verification

| Check | Result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview` | Successfully ran, 5 projects |
| `npx eslint` on the 26 files I changed | 0 errors, 0 warnings |
| Jest chat `libs/frontend/chat/src/lib/settings` (`--maxWorkers=2`) | 42 suites, 941 passed |
| Jest core `services/providers*` | 4 suites, 221 passed |
| Jest ui `lib/native` | 25 suites, 534 passed |
| `npx nx build ptah-extension-webview --skip-nx-cache` | OK. Initial 3.46 MB, under the 3.5 MB error budget. The pre-existing 2.5 MB warning remains. |
| Playwright `settings-orchestration` + `settings-visual` + `settings-reachability`, `--workers=2` | 45 passed (2.4 min) |
| Gate G `settings-reachability`, `--repeat-each=3 --workers=2` | 27 passed (3.8 min) |
| Throwaway probe (V36-1 Tab walk, V36-7 one-line actions, V36-9 placeholder fit), deleted after the run | 2 passed |

Counts: 39 new specs (chat 31, core 3, ui 5), and about 12 existing specs updated for the new copy and paths. Non-spec line
counts (raw / ESLint-counted): matrix 623 / 623, state facade 727 / 531, add 355, tier 304. All are under 700 counted.

Captures: all 96 `current-*` were backed up to `/tmp/b36b-matrix-shots`, and the 52 non-orchestration files were
restored. Only the 44 `current-orchestration-*` differ from HEAD; no `baseline-*` was touched.
`current-orchestration-vscode-anubis-light` was re-taken once: the smoke shot it while the matrix chunk was still
loading, a capture-timing flake.

## Fold (1024x768) and the Glm row

| Host | Policy bar | Matrix header | First row | Roles summary | Budget | Glm row | System rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VS Code (both themes) | 125 | 206 | 247 | **550** (was 639-643) | 660 | 95 px | 41 px |
| Electron (both themes) | 165 | 266 | 327 | **708** (was 775-779) | 660 | **131 px** (actions now one line) | 61 px (OpenCode 43) |

- Electron is still **48 px over**, so `ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED` stays `false`. The summary is logged
  and annotated, not asserted.
- What remains is the narrow Agent column, not the actions:
  - Each row's inline status badge and provider (now 12 px, per V36-2) wrap to a second line, which makes system rows
    61 px against 41 px in VS Code.
  - Glm's three tier badges stack one per line, so the Glm row is 131 px (it was 113 px with 10 px sublines).
- Experiment, reverted: giving the Agent column `min-width: 10rem` in narrow containers brought the summary to 636 px
  (Glm row 95 px). But the table then scrolled sideways by 31 px (the visual spec's no-overflow check failed). The only
  ways to get the width back are wrapping model ids or shrinking text or targets, which the user ruled out.
- Options for the user: a denser narrow layout (for example tier badges in a disclosure), or accept the Gate V 28
  precedent for Electron.

## Plan deviations and notes

- The `save()` request gained two optional fields beyond the approved `failure?: string`:
  - `failureMessage?: (commit) => string | null`. M7 needs the commit to name the field that saved; it is fixed copy
    only.
  - `successMessage?: string`, for M4.
  - Undo requests no longer inherit either field (`{label, scope, write, undo: null}`).
- `announce()` was added to the feedback service for M3.
- No other code in that file was moved or reformatted, because track B's Batch 39 edited it too.
- The cliTest state carries `reason` only as fixed copy now (`providers-settings.types.ts` doc updated).
- The first V36-1 rule (`visibility: hidden`) broke focus on open. Stream 2 reported it, and it was replaced with
  `display: none` before the final run.

## Out of scope (seen, not touched)

- Two app-shell `<dialog class="modal">` elements outside Settings stay laid out while closed, so their backdrop
  "close" buttons are Tab stops after the page end in VS Code. One is `components/molecules/confirmation-dialog.component.ts`;
  the other is in a sibling shell component. This is the same daisyUI cause as V36-1, outside this batch's files.
- V36-3 contrast (the dark "Uninstalled" header) was not in this batch's list. The header is now a `text-base-content`
  button, which removes that case.

## Fold round 2 (orchestrator decision, disclosed)

These changes apply to the narrow container layout only (Electron); VS Code is unchanged and keeps the prototype's
three tier badges.

- Tier summary (`matrix:169`, `tierSummary`/`tierList` at `matrix:558`):
  - A Ptah instance's three stacked tier badges become one summary badge: "3 tier models", "1 tier model" or
    "No tier models".
  - The full "Sonnet: …, Opus: …, Haiku: …" list is its `title` and its spoken text (an `sr-only` suffix).
  - The inline Tiers button stays the way to edit.
- Status and provider on one line (`matrix:151`, `:157`):
  - The status badge keeps its size (`shrink-0`).
  - The provider takes the remaining width (`w-0 flex-1 truncate`, full name in `title`).
  - `w-0` is required. Without it, the provider's full text width set the column's minimum, and the table scrolled
    sideways by 35 px.
- Both changes were needed: with the tier summary alone, the system rows would still wrap (about 672 px).
- Trade-off: in Electron, provider names truncate ("OpenAI …", "GitHu…"); the full name is in the tooltip.
- Text sizes and target sizes are unchanged, and there is no horizontal scroll (`overflow 0px`, both themes).
- `ORCHESTRATION_ELECTRON_ROLES_FOLD_ENFORCED = true` (`settings-visual.e2e.spec.ts:294`) passes in both themes.

| Host (both themes) | Policy bar | Matrix header | First row | Roles summary | Budget | Rows (codex, antigravity, Glm, copilot, opencode) |
| --- | --- | --- | --- | --- | --- | --- |
| VS Code | 125 | 206 | 247 | 550 | 660 | 41, 41, 95, 41, 41 |
| Electron | 165 | 266 | 309 | **600** (round 1: 708; Gate V 36: 779) | 660 | 43, 43, **77**, 43, 43 |

New specs (matrix):
- "fold round 2: narrow layout shows one tier summary badge…" (title, spoken list, wide-only badges, singular).
- "fold round 2: the narrow status and provider stay on one line…".

Re-run evidence:

| Check | Result |
| --- | --- |
| typecheck and lint, 5 projects | Pass |
| ESLint on the files I changed | 0 warnings |
| Jest, chat settings | 42 suites, 943 passed |
| Webview build | 3.46 MB initial |
| Playwright orchestration + visual + reachability, `--workers=2` | 45 passed (fold enforced in both hosts) |
| Gate G, `--repeat-each=3` | 27 passed |

Captures: the 52 non-orchestration `current-*` files were restored from the clean backup; only the 44
`current-orchestration-*` differ, and no `baseline-*` was touched.

## Follow-up recorded

- Two app-shell dialogs outside Settings (`components/molecules/confirmation-dialog.component.ts` and one sibling shell
  `<dialog class="modal">`) are Tab stops while closed (the same daisyUI `.modal` cause as V36-1). This is recorded as a
  follow-up, outside this task's scope.
