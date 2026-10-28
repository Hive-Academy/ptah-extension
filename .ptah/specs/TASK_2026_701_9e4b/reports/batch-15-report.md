# Batch 15 report: wizard-view preview modal and pack install prompt (F2 + F4)

Executor: frontend-developer (Claude subagent). Worktree:
`D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment`. No git commands were run.
Batch 17 ran in parallel in the same lib. No Batch 17 file was touched.

## Task 15.1: `GenerationPreviewModalComponent` and token-bound submit (F2): done

| Requirement | Where | Spec evidence |
| --- | --- | --- |
| Modal body moved out of `agent-selection` and built from the F1 components | `generation-preview-modal.component.ts`: presentational, wraps `ptah-native-modal` (lg). It composes C5 target choice, C4 bulk bar, C2 rows with C1 and C3 (wizard mode is "unavailable"), and C6 model note | modal spec, all 15 cases |
| Every existing file starts on Keep. Confirm reads "Confirm Generate" or "…, replace N file(s)". Summary reads "k kept, r to replace" | `buildWizardRows` + `nextSnapshot(null, …)` in the owner; `confirmLabel('wizard-modal', n)` | "starts every existing file on Keep…", "counts a Replace…" |
| Rival-CLI and conditional files are information only (C12): "Also copied for other CLIs (information only; not controlled by Keep or Replace)". "May also write, if <condition>" is kept | `blocks()` computed | "lists rival-CLI and conditional files as information only" |
| Three exclusive rival states (R1-5): listed (rows, no warning), harness-unavailable and cli-detection-failed (warning, no rival rows) | `blocks()` keeps only claude files unless `rivalStatus` is `listed` or absent | `it.each` R1-5 |
| The sub-folder warning shows only for the opened-folder target | `warning()` hides the `opened-folder-elsewhere` warning unless the selected target is `opened-folder` | "shows the sub-folder warning only for the opened-folder target" |
| A target change re-runs the comparison and resets every choice to Keep, with a status line | owner `changeTarget` → `previewGeneration(ids, target)` → `nextSnapshot` sets `TARGET_CHANGED_STATUS` | agent-selection "re-runs the comparison for another target…"; modal "shows the target-changed status line" |
| Submit sends `previewToken`, `fileDecisions` (with `revision`) and `target` from the confirm-time re-preview, even when the modal shows no tabs | `submitDecisions` → `WizardRpcService.submitAgentSelection(selections, dir, decisions)` | agent-selection "submits the fresh token, the Replace with its revision and the target"; rpc spec "sends the preview token, replace decisions and target of a confirmed preview" |
| "Generate without preview" sends no token (create-only). The copy matches design section 5 | `onConfirmPreview` error branch calls `confirmGenerate()` with no decisions | agent-selection `it.each` failure case (call has 2 args); modal "offers 'Generate without preview'…" |
| exists(A) → exists(B) on confirm drops the Replace to Keep and asks for another review | `needsReview`: signature, status, or fewer replacements | agent-selection "asks for another review when a replaced file changed…" |
| A `preview-required` rejection re-previews with the target kept and every choice reset to Keep. The stale alert shows and there is no step change | `confirmGenerate` returns the rejection and calls `openPreview(true)` + `targetsChanged` | agent-selection "re-previews with choices reset and the target kept after preview-required"; rpc "returns a preview-required rejection" |
| Parity: Generate disable rules, "Checking generation targets..." (`aria-busy`, confirm disabled), stale alert, backend warnings with solid warning fill, Cancel drops late replies | modal template; owner `previewRequest` sequence guard kept | existing agent-selection cases (kept and passing) plus modal "replaces the list with the checking state…" |
| Modal keyboard trap | `ptah-native-modal` (`showModal`, Tab wrap filtered by `getClientRects`, Escape → `closed`, native focus restore). An effect puts focus back on the checked target after a reload drops it | native-modal's own specs. jsdom cannot exercise `showModal` focus |
| "Source status, model picker" | No wizard-view equivalent exists in `agent-selection.component.ts` (they live in the sidebar, Batch 16). Nothing was removed | n/a |

## Task 15.2: `PackInstallPromptComponent` on every pack path (F4): done

| Requirement | Where | Spec evidence |
| --- | --- | --- |
| One prompt with `scope: 'pack' \| 'file'`: title, scope line, "Nothing is written until you confirm." | `pack-install-prompt.component.ts` | prompt "opens the whole-pack prompt…", "scopes the prompt to one file…" |
| C5 always shown, including the no-conflict case | `ptah-target-root-choice` from `plan.target` | prompt "…even when no file differs"; panel "…target choice shows even though no file differs" |
| Conflicts branch: C4 (pack scope only), C2 rows for `differs`/`unreadable`, "N other files are new…" / "…already current". No-conflict branch: "No file differs. All N pack files are new…". Confirm reads "Install pack" or "Install pack, replace N file(s)" | template + computeds | prompt conflict and no-conflict cases |
| **D13** unreadable row: forced Keep, control disabled, never sent as replace | F1 `forcedKeep` row; `decisionEntries` skips it | prompt "lists conflicts on Keep, forces Keep for an unreadable file…" (click on the `aria-disabled` Replace has no effect; decisions hold only the differs file) |
| **D13** bulk: Replace all / Keep all across many rows, skipping unreadable | `setAllDecisions` | prompt "applies Replace all and Keep all across many rows and skips every unreadable row (D13)" (3 differs + 2 unreadable) |
| A target change re-plans and resets to Keep, with a status line and the "Comparing pack files…" skeleton | `changeTarget` → `load(request, choice)` → `nextSnapshot` | prompt "re-plans for another target…" (plan-2 token and `opened-folder` sent) |
| Flow: `wizard:plan-pack-install` → prompt → `wizard:install-pack-agents` with `planToken`, `decisions`, `target` | `WizardRpcService.planPackInstall` (new) and `installPackAgents(source, files, plan?)` | rpc spec `planPackInstall` and `installPackAgents` blocks; prompt and both host specs assert the exact call |
| Wizard entries: Install All, Choose location, per-file Install and Retry | `agent-selection.component.ts` `onInstallAllAgents` / `onInstallAgent`; "Install to: <path> (project root/opened folder only) Choose location" line | agent-selection "opens the install prompt for a single agent…", "…from Install All and Choose location", "…retries through the prompt" |
| Sidebar entries: Change, Install All and Retry (and per-file Install) | `community-packs-panel.component.ts` | panel "…installs one agent through the prompt", "…from Install All and from Change", "…offers Retry only for a failed one" |
| Results: Installed/Kept/Failed counters. Kept rows say "Kept" with "Your file was not changed. Origin stays Workspace file.". A failed row shows its reason and Retry. Retry never replaces a kept file (kept rows have no Retry, and a retry prompt starts on Keep) | `packFileStatuses`, `packResultCounts`; host templates | agent-selection "shows a kept file as Kept, never as Installed"; panel kept/failed case |
| Opened-folder completion notice per host | `openedFolderNotice(info, isElectron)` | panel `it.each` Electron/VS Code; prompt helper spec; agent-selection opened-folder case |
| Plan failure / primary failure | prompt alert "Could not compare the pack files…" with "Try again" and confirm disabled. A primary install failure (no per-file outcome) is reported as `primaryFailure` and shown as "Could not install the pack. <reason>" | prompt "shows a plan failure…", "reports a primary failure…" |
| Cancel drops a late plan reply | `sequence` guard | prompt "drops a plan reply that arrives after Cancel" |

## Files

- CREATED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/generation-preview-modal.component.ts`: presentational wizard preview modal (F2).
- CREATED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/generation-preview-modal.component.spec.ts`: 15 cases.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/pack-install-prompt.component.ts`: the pack prompt, which owns the plan → decide → install flow. It also exports the pure helpers `packFileStatuses`, `packResultCounts`, `openedFolderNotice` and `KEPT_PACK_NOTE`.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/pack-install-prompt.component.spec.ts`: 12 component cases and 3 helper cases.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts`: modal markup replaced by `<ptah-generation-preview-modal>`. Holds the `DecisionSnapshot` and the target choice, does token-bound submit and the preview-required reopen. Every pack entry opens `<ptah-pack-install-prompt>`. Adds the "Install to … Choose location" line, Kept/Failed rows and the results line. `previewFiles` and `NativeModalComponent` import removed.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/agent-selection.component.spec.ts`: existing expectations updated (submit now carries `{fileDecisions: {}}`, preview called with `(ids, undefined)`, state badge replaces "will overwrite"); 4 new preview cases; the direct-install pack cases replaced by 5 prompt cases.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/community-packs-panel.component.ts`: every entry opens the prompt. Adds the "Install to … Change" line, per-file Installed/Installing/Kept/Failed+Retry, the results line and the opened-folder notice. The intro copy no longer says agents are "added to your workspace right away".
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/components/community-packs-panel.component.spec.ts`: rewritten, 5 cases.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts`: builds on D29. A private `boundDecisionFields` is now shared by `startBoundAgents` and `submitAgentSelection(…, decisions?)`. Adds `previewGeneration(ids, target?)`, `planPackInstall(source, files, target?)`, `installPackAgents(source, files, plan?)`, the `PackInstallDecisions` type, and `AgentSelectionResponse.rejection`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.spec.ts`: 10 new cases.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| The pack prompt owns plan → install (it injects `WizardRpcService`). Hosts only open it and show results | flow in each host; a new shared service (not in the file list) | Two hosts share the same flow (plan F4). Putting it in the one prompt avoids duplicating it without adding a file outside the batch | yes |
| On confirm the prompt closes and the hosts show per-file "Installing" state and results; there is no in-prompt busy state | keep the prompt open while writing | Design 3.2 section D shows results on the host surface. Closing on confirm also avoids the native `<dialog>` closing itself on Escape during a write | yes |
| The prompt renders its `ptah-native-modal` only while open | always mounted | Keeps sibling specs that render the panel (Batch 16 `agent-selection-list` spec) working in jsdom without dialog shims, and keeps closed dialogs out of the DOM. The prompt component stays mounted, so an install that finishes after close still emits its result | yes |
| The wizard-view modal stays presentational and `AgentSelectionComponent` holds the state | state in the modal | Same shape as Batch 16 (list owns the snapshot, dialog renders it), which keeps the two surfaces consistent | yes |
| A kept pack file is shown from component-local state. The shared state service marks it `idle`, not `installed`, so Install All can offer it again on Keep | add `'kept'` to `SetupWizardStateService` | `setup-wizard-state.service.ts` is outside the batch list; its status union is `idle/installing/installed/error`. Reporting a kept file as installed would be false | yes |
| A `preview-required` submit rejection reopens the preview with the target kept, choices reset, and the existing "Targets changed since preview…" alert | new copy | Same as Batch 16 (`openPreview(true)`). The design stale copy fits the server's "your review is stale" answer | yes |
| "Choose location" opens the whole-pack prompt (same as Install All). The "Install to" line shows `.claude/agents (project root)` until an install reports the real roots | fetch a plan up front for the path | Design R1-2: every entry opens the one dialog. A plan before the user acts would download the pack just to show a path | yes |
| Plan-failure copy "Could not compare the pack files with the folder. Check your connection and try again." with "Try again" | none in design | Design section 7 lists no plan-failure string. The server reason is not shown, as in the existing preview-error handling | yes |
| Identical files: "N other files are already current." / "<file> is already current in this folder." | none in design | Design copy covers only new files; "Already current" is the design's state badge | yes |

## Deviations

- None outside the batch list. `wizard-rpc.service.ts` is in the list. D29's `startBoundAgents` decisions param was reused, and its spread logic moved into a shared private helper; its behaviour is unchanged and its spec still passes.
- The modal's old "will overwrite" / "will overwrite if written" badges were removed, as design 3.1 requires (state badge + C1 replace them). The existing spec assertion was rewritten to match.

## Out-of-scope observations

- `SetupWizardStateService.agentInstallStatus` has no `kept` status, so the "Kept" state lives in each host component and is lost when the component is re-created. Adding `'kept'` there (outside this batch) would let `installedCommunityAgentCount` and the wizard row share it.
- `ptah-native-modal` closes the native dialog on Escape even when the owner would keep it open (it emits `closed` and does not call `preventDefault`). That is why the pack prompt closes on confirm instead of showing a non-cancellable busy state.

## Verification

Run once Batch 15 was complete, scoped to my specs plus the sibling specs that render the changed panel or share the F1 helpers (`agent-selection-list`, `generation-agent-sidebar`, `agent-preview-dialog`, `preview-decisions/*`):

```
npm run verify -- -t test -p @ptah-extension/setup-wizard -- --testPathPatterns="(generation-preview-modal|pack-install-prompt|agent-selection|agent-selection-list|community-packs-panel|agent-preview-dialog|generation-agent-sidebar)\.component\.spec|wizard-rpc\.service\.spec|preview-decisions"
```

Result: `NX 1 task: 1 succeeded`; Jest `Test Suites: 15 passed, 15 total`, `Tests: 206 passed, 206 total`.

Earlier runs in this batch failed and were fixed:

1. The host specs needed a render before `whenStable` so the prompt's request effect starts.
2. `agent-selection-list.component.spec.ts` threw `dialog.close is not a function` once the panel always mounted a native modal. The fix was the "render only while open" decision above. That spec file was not edited.

- `ptah_get_diagnostics` (TypeScript) on the four changed source files: no errors in them. The sibling errors it reported (`generation-run-event-adapter.spec.ts`, BigInt targets in shared) are not in this batch's files.
- `npx prettier --write` was run on all ten files.
- Lint and typecheck targets, and `ptah-extension-webview`, were not run, as instructed. The orchestrator runs the combined `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview` afterwards.
