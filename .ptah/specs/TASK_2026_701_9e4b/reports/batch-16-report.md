# Batch 16 report — Sidebar preview dialog (F3)

Executor: frontend-developer (Claude subagent). Worktree:
`D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment`. No git commands run.

## Task 16.1: Sidebar dialog decisions — done

Evidence per requirement:

| Requirement | Where | Spec evidence |
| --- | --- | --- |
| Every existing-file row starts on Keep (R1-4) | list builds rows with `buildWizardRows` + `nextSnapshot(null, …)`; dialog renders `ptah-file-decision-row` | dialog "starts every existing-file row on Keep…"; list "starts every existing file on Keep…" |
| First confirm label "Confirm and generate"; "…, replace N file(s)" with replacements | `confirmLabel('sidebar-dialog', toReplace)` | dialog R1-4 case and "reports a Replace choice…" |
| Re-preview on confirm uses the shared decision-state helper | `loadPreview(true)` → `nextSnapshot(previous, buildWizardRows(fresh), target)` and `targetsSignature` (the ad-hoc `definiteTargets` method is deleted) | list "re-previews before submit…", "asks for another review when a replaced file changed…" |
| Token, decisions and target passed with the start | list → `store.startAgents(ids, {fileDecisions, previewToken, target})` → `WizardRpcService.startBoundAgents(…, false, decisions)` → `wizard:submit-selection` | list "…submits the fresh token, Replace and target"; store "passes confirmed preview decisions…"; rpc "sends the preview token, replace decisions and target…" |
| Stale token → re-preview path | `preview-required` rejection reopens with `openPreview(true)`: choices reset to Keep, chosen target kept | list "re-previews with choices reset and the target kept after preview-required" + existing reopen case |
| Unreadable = forced Keep | F1 row/control (`aria-disabled`, `tabindex=-1`); `setDecision`/`setAllDecisions` refuse it; `decisionEntries` never sends it | dialog "forces Keep for an unreadable file and the bulk bar skips it"; list "never sends Replace for an unreadable file" |
| Target line "Target: <path> (project root)" + "Change" revealing C5 with `aria-expanded`/`aria-controls`; hidden when opened folder is the root | dialog template | dialog "shows the target line and reveals…", "hides Change when…", "shows the opened-folder target and the reset status…" |
| Target change re-runs the comparison, resets every choice to Keep, status line | list `changeTarget` → `loadPreview(false)` with `target`; `nextSnapshot` sets `TARGET_CHANGED_STATUS` | list "re-runs the comparison for another target…" |
| "Writing model: <m> (writes the content)" (req 5.5) + per-agent model origin (C6) | dialog template | dialog "labels the writing model…" |
| R1-5 rival states: listed rows (no warning) / harness unavailable / CLI detection failed (warning, no rival rows) | dialog `blocks()` filters rival files unless `rivalStatus` is `listed` (or absent from an older host); backend `warning` shown as `role=alert` | dialog "lists rival-CLI files as information only…", `it.each` R1-5 cases |
| Parity: changed/loading/error alerts, Cancel, confirm disabled while loading, Escape, focus restore, Tab trap | dialog template + `onKeydown` | dialog first case, "replaces the list with the checking state…", "shows the check-failed alert", "keeps Tab inside…", "moves focus into the dialog on open…" |
| Parity: sequence guard (Cancel drops a late reply), source status and model picker untouched | list `previewSequence` unchanged; template above the list unchanged | list "drops a stale preview reply after Cancel" + existing cases |

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts` — presentational dialog composing F1 (rows, bulk bar, target choice behind "Change", model note), C12 info-only block, R1-5 states, footer summary and confirm label, trap that skips hidden and roving `tabindex=-1` buttons.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.spec.ts` — 14 cases.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/agent-selection-list.component.ts` — holds the `DecisionSnapshot` and target choice; shared-helper re-preview; passes decisions to the store.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/agent-selection-list.component.spec.ts` — existing confirm expectation updated; 6 new cases.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts` — `startAgents(ids, decisions?)`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts` — 1 new case.
- MODIFIED (out-of-list, approved as D29) `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` — `BoundAgentDecisions = Pick<WizardSubmitSelectionParams, 'previewToken' | 'fileDecisions' | 'target'>`; optional trailing `decisions` on `startBoundAgents`, spread only when defined. Existing callers unchanged.
- MODIFIED (out-of-list, D29) `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.spec.ts` — 1 new case (fields sent; absent when not given).

## Stack observed

Angular 22 (`package.json` `@angular/core ~22.2.0`), standalone OnPush components with
`input()`/`output()`/signals (`preview-decisions/*.component.ts`); host access only through
`ClaudeRpcService` (`wizard:preview-generation`, existing pattern in this component) and
`WizardRpcService` (`wizard:submit-selection`); host type from `VSCodeService.isElectron`
(`libs/frontend/core/src/lib/services/vscode.service.ts:182`); Tailwind/DaisyUI tokens
(`surface-border`, `surface-1`, `base-content-muted`, `alert-*`, `badge`) from
`apps/ptah-extension-webview/tailwind.config.js` and the F1 components.

## Design fidelity

Source: design-spec.md section 3.1 (sidebar), 3.5, section 5 copy, Review responses R1-4/R1-5;
`prototype/sidebar.html` sections A-C. Deviations:

- The `definite`/`conditional` certainty badge sits in the agent heading line before the
  agent id, not inside the path line: the F1 `FileDecisionRow` (Batch 14, not in this batch)
  owns its head and has no slot there. The certainty is still shown before the row.
- Warning copy comes from the backend `warning` (B11 constants), not the prototype wording
  "Harness sync is not available on this host…": parity row 54 keeps the backend warning.
- Rival files carry no "Replaces existing file" marker; the C12 block is information only
  per the prototype, and the marker moved to the Claude source row's keep/replace control
  (parity row 55).
- The expanded "Change" panel shows C5 as built in Batch 14, which also renders its own
  "Writing to" line under the two cards.

## States covered

Loading ("Checking targets..." `role=status` in an `aria-busy` region with a
`motion-safe:animate-pulse` skeleton; list hidden; confirm disabled), error (check-failed
alert), changed-targets alert, target-reset status (`role=status`), backend warning
(`role=alert`), empty (no existing files → no bulk bar, no summary, plain confirm label),
interactive keep/replace/bulk/target. Accessibility: opening focuses the first tab stop
(design 3.1); Tab/Shift+Tab wrap over enabled buttons that are not roving `tabindex=-1`
radios and not inside a `[hidden]` region, and a Tab from a non-stop (the dialog itself)
re-enters the loop; Escape cancels; focus returns to the opener. After a target change the
target buttons are disabled while reloading and focus drops to `<body>`, so an effect puts
focus back on the checked target radio (or the first stop) when loading ends.

## Risks and edge cases

- **Replace silently lost on confirm**: if the confirm-time re-preview moves a row's
  revision, `nextSnapshot` drops the Replace to Keep. `needsReview` treats a lower replace
  count as a change and shows the targets-changed alert instead of submitting.
- **Fresh token**: the submit uses the token from the confirm-time re-preview, the one the
  server last recorded.
- **Older host** (no `previewToken`/`target`/`localState`): rows fall back to forced Keep
  for existing paths (F1 rule); the submit sends `{fileDecisions: {}}` only.
- **Preview failed then confirm**: the existing behaviour stays (no previous preview →
  submit with fresh, all-Keep decisions).
- **Target change while a request is in flight**: guarded by `previewLoading` and the
  existing sequence counter.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| D29 (coordinator-approved): add optional `decisions` to `WizardRpcService.startBoundAgents` although the ledger gives the file to Batch 15 | edit file; send nothing; call ClaudeRpcService from the store | plan F3 :1222 names `wizard-rpc.service.ts:121-149`; coordinator approval | yes |
| Dialog stays presentational; the list owns the snapshot and the target choice | state in dialog; state in list | the list already owns preview, sequence guard and submit | yes |
| `preview-required` reopen keeps the chosen target, resets choices | reset target too | the user picked the root; validation note asks only for choice reset | yes |
| The store calls `startBoundAgents(binding, ids)` with no extra args when no decisions are given | always pass 4 args | keeps existing callers and their specs byte-identical | yes |

## Verification

Orchestrator combined verify for Batches 13 + 16 + 18 (session 6, 2026-10-26):
`npm run verify -- -p @ptah-extension/shared,@ptah-extension/platform-core,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/setup-wizard,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview`
-> `77 tasks: 76 succeeded, 69 cached, 1 failed`. The only failure is `ptah-extension-webview:lint`
(circular dependency webview <-> command-center), the accepted pre-existing D19 failure. The
subagent's own run did not finish (session 5 ended); no Batch 16 fixes were needed.

## Plan deviations

`wizard-rpc.service.ts` (+ spec) edited outside the batch list under D29. No other deviation.

## Out-of-scope observations

- `ptah_get_diagnostics` still reports the pre-existing sibling errors in
  `generation-run-event-adapter.spec.ts` and `libs/shared` BigInt literals (noted in the
  Batch 14 report); none are in files of this batch.
