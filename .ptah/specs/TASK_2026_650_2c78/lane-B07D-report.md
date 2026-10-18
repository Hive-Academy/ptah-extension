# B07D implementation report

## Status
Implemented the B07B frontend follow-ups in the assigned worktree. The bound agent page displays verified result facts, bound interrupted Resume, and a combined guidance countdown. Scoped typecheck, lint, focused Jest and the three changed-project test targets pass. No backend or shared files were edited.

## Files changed and final line counts

| File (workspace relative) | Lines |
| --- | ---: |
| `apps/ptah-extension-webview/src/app/app.config.ts` | 402 |
| `apps/ptah-extension-webview/src/app/webview-routing.spec.ts` | 885 |
| `libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.ts` | 87 |
| `libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.spec.ts` | 92 |
| `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` | 561 |
| `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts` | 301 |
| `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.spec.ts` | 305 |
| `libs/frontend/setup-wizard/src/lib/services/setup-generation-open.handler.ts` | 52 |
| `libs/frontend/setup-wizard/src/lib/services/setup-generation-open.handler.spec.ts` | 65 |
| `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts` | 339 |
| `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts` | 357 |
| `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts` | 540 |
| `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.ts` | 346 |
| `libs/frontend/setup-wizard/src/lib/components/analysis-results.component.spec.ts` | 170 |
| `libs/frontend/setup-wizard/src/lib/components/agent-run-card.component.spec.ts` | 19 |
| `libs/frontend/setup-wizard/src/lib/components/agent-generation-progress.component.spec.ts` | 27 |
| `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.spec.ts` | 28 |
| `libs/frontend/setup-wizard/src/lib/components/generation-errors.component.spec.ts` | 18 |
| `libs/frontend/setup-wizard/src/lib/components/generation-stop-control.component.spec.ts` | 24 |
| `libs/frontend/setup-wizard/src/lib/components/generation-stop-control.component.ts` | 29 |
| `libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts` | 143 |
| `libs/frontend/setup-wizard/src/lib/components/community-packs-panel.component.ts` | 160 |
| `libs/frontend/setup-wizard/src/lib/components/generation-model-picker.component.ts` | 63 |
| `libs/frontend/setup-wizard/src/lib/components/agent-selection-list.component.ts` | 363 |
| `libs/frontend/setup-wizard/src/lib/components/generation-source-status.component.ts` | 60 |
| `libs/frontend/setup-wizard/src/lib/components/wizard-landing.component.ts` | 282 |
| `libs/frontend/setup-wizard/src/lib/components/workflow-card.component.ts` | 47 |

All line references below are to the final files; prefixes are abbreviated only in this report.

## Gaps 1–6

1. **Verified result panel:** `generation-workflow-shell.component.ts:107-166,245` renders counts (including total/rejected), per-agent basename or ID/status, rejected/tailored sections, propagation/consent and guidance-used only from `run.result`. If detailed facts are absent it states that results are unavailable and offers manual Continue/Skip (`:169-180`). The event adapter already re-reads the bound run when the verified completion push arrives; `run.result` also comes from lookup. Existing `completion.component.ts` keeps the old completion screen. Specs: `generation-workflow-shell.component.spec.ts` combined verified-terminal case; `generation-workflow.store.spec.ts` terminal monotonicity; existing completion specs.
2. **Origin/countdown:** `generation-workflow-launcher.service.ts:25-35,66-89` stores a validated one-time origin keyed by tab ID before foreground navigation and rechecks the active workspace afterward. `generation-workflow-shell.component.ts:297-335` consumes it, schedules the absolute five-second deadline once for a verified completed run, and cancels on page destruction. `generation-handoff.store.ts:38-109` already owns timer, background guidance-tab creation/start, busy-target and failed-launch manual recovery. Independent origins offer only the CTA. Specs: `generation-workflow-launcher.service.spec.ts` one-time intent/workspace-change cases; `generation-workflow-shell.component.spec.ts` one-schedule case; existing `generation-handoff.store.spec.ts` timer/close/recovery cases.
3. **Terminal reads/watchdog:** `generation-workflow.store.ts:204-230,274-301` retains terminal state and verified details against absent, nonterminal or incomplete stale reads for the same run, retries a failed active-run lookup at 1/2/4 seconds (three retries), and releases timers on unbind/terminal. Specs: `generation-workflow.store.spec.ts:33,65` fake-timer watchdog and stale-read cases.
4. **Interrupted bound Resume:** `generation-workflow-shell.component.ts:56,95-108` calls `GenerationWorkflowStore.resumeBoundAgents`, displays blocked owner and preview-required rejection. `generation-workflow.store.ts:133-151` submits bound `resume:true`; `wizard-rpc.service.ts:118-132` sends `tabBinding` and empty IDs. Tabless checkpoint Resume remains for a tabless checkpoint offer. Spec: `generation-workflow.store.spec.ts:90` bound rejection case.
5. **Phase 3 moderates:** `setup-generation-open.handler.ts:20-39` debug-logs a workspace mismatch without a path and records a failed launcher result; `generation-progress.component.ts:50` and `analysis-results.component.ts:48` show its nonblocking retry notice. `generation-workflow-launcher.service.ts:80-88` refuses a workspace change after navigation. `app.config.ts:41-58,212-216` validates a restored tab across partitions before active-workspace selection; `TabManagerService` restores tab state synchronously at construction, and later selection is checked. Specs: `setup-generation-open.handler.spec.ts:43`, `generation-workflow-launcher.service.spec.ts` workspace-change case, `webview-routing.spec.ts:226` restore-before-selection case, `analysis-results.component.spec.ts` component creation with handler notice provider.
6. **Behavior specs:** run-card Resume emits only for interrupted runs; progress Retry emits and disables at zero; next-steps countdown emits Start/Skip and retains five examples; errors show three before disclosure; Stop stays available while active. These are in the matching component specs listed above. Existing `agent-generation.store.spec.ts` verifies checkpoint discovery without submit, preserved written outcome after Resume, three retry attempts with 1/2/4-second backoff and duplicate guard. Existing `generation-workflow.store.spec.ts:216-243` verifies stop-unconfirmed after a lost cancel response. The full test run exposed the webview contrast ratchet; the eight setup-wizard components above now use `text-base-content-muted` in place of alpha-modified text.

## Origin carrier decision

A root launcher Map carries only the two valid origins from foreground open to the shell, keyed by tab ID and consumed once. Other existing launcher callers normalize to `independent-start`. The intent is not persisted: reload must not restart a five-second countdown. The run itself remains recoverable from the bound lookup. This is reversible and avoids adding route state to restored URLs.

## Parity rows 20, 22–27, 35

| Row | Final mapping |
| --- | --- |
| 20 progress/failure counts | Saved checkpoint progress card plus verified bound counts in the shell; old progress remains. |
| 22 cancel/duplicate completion | Bound Stop and terminal monotonicity; existing event-adapter terminal guard. |
| 23 checkpoint/resume/retry | Bound interrupted Resume and existing tabless checkpoint/failed-item retry. |
| 24 old checkpoint offer | Existing `AgentGenerationStore.discover/resume` and shell offer. |
| 25 retry cap/backoff | Existing three-attempt store and fake-timer spec; progress disables at zero. |
| 26 safe writes/propagation | Host-committed facts only; shell displays per-agent basename/status, counts and propagation/consent. |
| 27 combined continuation | One absolute deadline after verified completed agent run for analysis-result origin; independent CTA. |
| 35 completion | Bound page displays verified file labels/counts/marker/next actions; legacy completion keeps its output-directory/file actions and Close. Bound DTO deliberately provides basenames, so the new page does not invent an output directory or file-action path. |

## Checks

- Focused Jest: setup-wizard component/store specs 4 suites/12 tests; launcher 1/5; webview routing 1/77; shell 1/4; analysis results 1/8; open handler 1/2. All passed after the relevant edits.
- Nx typecheck/lint: 4 projects passed after origin normalization; final setup-wizard/chat-ui/webview rerun passed for 3 projects after the last store refinement.
- Nx test: final run passed for 3 changed projects (`@ptah-extension/setup-wizard`, `@ptah-extension/chat-ui`, `ptah-extension-webview`). First run failed the webview contrast ratchet; corrected classes and reran successfully.
- `ptah_get_diagnostics` was called after edits but its compiler timed out after 45 seconds and returned four unchecked files; Nx typecheck supplied the usable type result. Prettier was applied to changed files.

## Notes for B08

`GenerationHandoffStore.schedule(agentTabId, workspacePath)` is called only from the agent shell after a verified completed bound run with combined origin. The store's `pending()` exposes the absolute `guidanceStartDeadline`; `startNow()`, `skip()`, and `manualContinue(workspacePath)` are already wired to the next-steps card. It opens/creates a `setup-project-prompt` tab in the background and calls `WizardRpcService.startBoundGuidance` after checking target chat state. Failure sets `outcome() === 'manual-recovery'`. The guidance page can bind that tab and read its own committed state; it should not infer success from the agent countdown or stream closure.

## Decisions

- **One-time origin Map** over route query or persisted tab metadata. Evidence: launcher owns tab creation, shell needs origin once, and reload cancels countdown. Reversible.
- **Restore validator scans restored partitions until workspace selection exists**, then requires the selected workspace. Evidence: `TabManagerService` restores synchronously and boot navigation can precede active workspace selection. Reversible.
- **Use the existing muted text token** over alpha text classes. Evidence: the webview contrast ratchet failed on those classes and identifies `text-base-content-muted` as the replacement. Reversible.

## Deviations

- The bound result DTO has `fileName` but no verified output-directory or file-action path. Those remain on the legacy completion screen; the new page does not fabricate a path.
- A failed host handoff cannot write back into the separate VS Code panel from this frontend-only batch. The active setup-wizard analysis/progress views expose a nonblocking retry notice when they receive the failed launch result.

## Proposed Removals

None.
