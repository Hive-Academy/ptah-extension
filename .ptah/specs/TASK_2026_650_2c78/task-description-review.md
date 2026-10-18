# Gate 1 cross-side review: task-description.md + parity-inventory.md

Reviewer: Claude (in-process). Author: codex lane, project-manager role. Date: 2026-10-16.
Inputs read: task `context.md` and `decisions.md`, epic `TASK_2026_647_1b0f/context.md`, epic research
`research/setup-wizard-analysis.md`, plus the code at the cited lines in this worktree (base `6c0490f1f`).

## Verdict

**REVISE**. Score: **7/10**.

The documents follow the fixed user decisions. They keep and fix, they make both generators
self-gather context with a freshness check, they put both workflows on normal chat tabs with a
workflow tag, they leave the Hub home design alone, and they hand the analysis phases and the
manifest to 651. 680 and 682 stay out of scope. Most code claims hold.

They cannot pass Gate 1 yet for four reasons:

- The parity inventory leaves out several user-visible capabilities and entry points without
  saying so (F1 to F4). The review rule treats a silent omission as a silent removal.
- The prompt path has a freshness bypass that the documents say does not exist (F5).
- The agent-recommendation input when there is no analysis is not specified (F6).
- Concurrency, migration and host-difference behaviour have no requirements (F7 to F9).

## Verified claims

| # | Claim (document) | Code | Result |
|---|---|---|---|
| 1 | `analysis-freshness.service.ts:19` has a 7-day limit; `:147-206` checks lifecycle, verified phases, age `:170-174`, fingerprint `:176-182`, hashes `:183-205` | Same lines | **Holds.** Two points the documents do not state: age is measured from `manifest.updatedAt`, not `analyzedAt` (`:170`), and only the **latest** run by `analyzedAt` is qualified (`findLatestRun` `:93-145`). See F10. |
| 2 | `orchestrator.service.ts:372-399/410` is a no-precomputed-analysis path that detects the project and selects templates | `:372-399` calls `analyzeWorkspace`; `:400-411` calls `selectAgents` | **Holds.** |
| 3 | `wizard-generation-rpc.handlers.ts:251-355` authorizes the workspace and directory, checks freshness, and passes a fresh matching directory or falls back | `:252-263` workspace and `authorizeAnalysisDir`; `:273-308` `getStatus`; `:335-355` `trustedDir`; `:987,992` gates `preComputedAnalysis` and `analysisDir` on `trustedDir` | **Holds.** The response does not return the freshness status to the UI. AC3 and AC4 therefore need a contract change; the documents should say so. |
| 4 | `enhanced-prompts.service.ts:402-500` does workspace discovery, `:496-500` enrichment, `:541-574` writes the trace before state | Same lines | **Holds** for the service. It is incomplete for the RPC; see F5. |
| 5 | `enhanced-prompts.service.ts:980-1014` enriches only from a fresh matching analysis | `:981-1000` | **Holds.** |
| 6 | `prompt-enhancement.component.ts:269-307` auto-starts and errors without `multiPhaseResult` | `:273-278` effect auto-trigger; `:290-298` gate | **Holds.** |
| 7 | `wizard-phase-generation.ts:88-113` advances to enhance on completion | `:112` → `setup-wizard-state.service.ts:280-284` sets `'enhance'` | **Holds.** |
| 8 | `setup-hub.component.ts:1295-1297` opens the monolithic wizard | `:1296` `setCurrentView('setup-wizard')` | **Holds.** |
| 9 | `wizard-view.component.ts:83-134` renders the step sequence | `:84-137` | **Holds.** |
| 10 | `wizard-analysis-runner.service.ts:176-213,245-279`: discovery, deep-analyze, then recommend | Same lines | **Holds.** |
| 11 | `workflow-tab-launcher.service.ts:1-20`, `session-embed.component.ts:34-47` | Same lines | **Holds.** `WorkflowKind` already has `'setup-agent-generation'` and `'setup-project-prompt'` (`chat-types.ts:873-878`), but the documents do not name them. `open()` always creates a new tab (`:40`); it has no "return to existing tab" behaviour. |
| 12 | `enhanced-prompts-rpc.handlers.ts:223-243` binds the workspace | `:224-241` | **Holds.** |
| 13 | `wizard-generation-rpc.handlers.ts:978-1030` = "safe validated agent writes and sync/propagation" (parity row 24) | `:974-997` is `buildOptions`, `:1003-1019` is `authorizeAnalysisDir`, `:1021-1037` is the stream broadcaster. Propagation and consent are at `:492-520` (`afterSettled`) and `:1077-1140` | **Drifted** (copied from the research). |
| 14 | `orchestrator.service.ts:929-1012` = validated writes; the row-24 test says "invalid output rejected" | `:929-1014` is content resolution and validation. Invalid or unsafe output falls back to the authored template (`:1006-1014`). A validator error still writes the generated content (`:983-992`) | **Partly wrong.** Nothing is "rejected". The test wording would fail against current behaviour. |
| 15 | Completion uses `setup-wizard:open-agents-folder` (parity row 32) | `completion.component.ts:522-526` posts only `SETUP_WIZARD_COMPLETE`. The open-folder constant exists (`message-constants.ts:199`) but this component does not use it | **Drifted** (Minor). |

## Findings

1. **Serious: VS Code launch path and the second entry point are missing from the inventory.**
   - `setup-status-widget.component.ts:194-217` is used by `project-setup-card.component.ts` in chat. It calls `setup-wizard:launch` (`setup-rpc.handlers.ts:236-269`), which runs `SetupWizardService.launchWizard` (`setup-wizard.service.ts:53-90`). That opens a **separate VS Code webview panel** with `initialView: 'setup-wizard'` (`webview-lifecycle.service.ts:109-156`).
   - That panel is its own Angular app with its own `TabManagerService`. A "normal chat tab" opened from it would not land in the user's main chat surface.
   - Completion's Close (`completion.component.ts:522-526`) depends on this panel lifecycle.
   - None of this is inventoried. No requirement covers where the generation tabs open on VS Code compared with Electron.

2. **Serious: provider and model selection is not inventoried.**
   - `welcome.component.ts:376-412` lets the user pick the provider and model.
   - `wizard-rpc.service.ts:126` sends `modelState.currentModel()` as `model` to `wizard:submit-selection`, and the checkpoint persists it (`wizard-generation-rpc.handlers.ts:319`).
   - The inventory does not say which model each generation tab uses: the tab's own chat model, or the global one. Without a row, this is a silent removal.

3. **Serious: the generation-resume offer is not inventoried at its user-facing location.**
   - Today `discoverResumableRun` (`wizard-analysis-runner.service.ts:197-199`) finds a resumable **generation** run.
   - The offer appears on the analysis results page (`analysis-results.component.ts:57-78`, `:354-356`) through `runner.resumeGeneration()` (`wizard-analysis-runner.service.ts:132-160`).
   - Row 23 cites only the backend and the retry UI. Once generation leaves the analysis flow, nothing requires the agent workflow tab to discover and offer this checkpoint. A user who already has an in-progress checkpoint from the old wizard needs a migration rule; see F8.

4. **Moderate: smaller user-visible items on the old pages are not inventoried.**
   - Saved-analysis "Use" → load → `recommendAgents` → analysis step (`welcome.component.ts:414-440`). This is the actual hand-off path.
   - Hiding a saved analysis from the list (`welcome.component.ts:442-449`; it changes the local list only).
   - The analysis results "Continue" (`analysis-results.component.ts:337-339`) and "No, Let Me Adjust" (`:345-347`) buttons.
   - Client-side retry cap and backoff (`generation-progress.component.ts:347-369,482-548`).

   Each needs a row with keep, move or proposed removal.

5. **Serious: the prompt RPC has a freshness bypass the documents do not mention.**
   - `enhancedPrompts:runWizard` accepts `params.analysisData`. It turns that into `preComputedInput` with no freshness or workspace check (`enhanced-prompts-rpc.handlers.ts:248-330`).
   - The service then skips workspace discovery entirely (`enhanced-prompts.service.ts:406-417`, with `dependencies: []`).
   - The agent path does gate the same field (`wizard-generation-rpc.handlers.ts:987`).
   - The task description says the prompt "enriches only from a fresh matching analysis" (Current behavior; Self-gather). That is true only for `analysisDir`. Scope item 2 and AC4 need an explicit rule: gate `analysisData` behind the same freshness result, or stop accepting it. A proving test is also needed.

6. **Serious: the recommendation input without analysis is not specified, so AC6 is not testable.**
   - `wizard:recommend-agents` throws when there is no input (`setup-rpc.handlers.ts:502-506`).
   - For a multi-phase result (the only path today) it returns a **static catalog**, all at score 100 (`:509-648`).
   - Otherwise it needs a Zod-valid `ProjectAnalysisResult` (`:651-665`). The orchestrator's self-discovery produces `AgentProjectContext`, not that type.
   - The documents must choose one:
     - (a) a no-analysis call returns the same static catalog as today, or
     - (b) a new backend path builds a scored `ProjectAnalysisResult` from workspace discovery.
   - AC6 says "relevant", which no one can verify. Replace it with the chosen observable rule.

7. **Serious: no requirement covers concurrency.**
   - The agent run guard is process-wide (`runs.isActive || submitReserved`, `wizard-generation-rpc.handlers.ts:240-249`). The prompt has its own process-wide lock (`enhanced-prompts.service.ts:389-394`).
   - So both generators can run at once in one workspace. A run in one workspace also blocks the same generator in another workspace (Electron multi-workspace).
   - Agent generation reads the enhanced prompt once at submit (`resolveRuntime`, `:921-936`; reported as `enhancedPromptsUsed`). A prompt generated during an agent run is therefore not used.
   - Add an AC covering three things:
     - both workflows may run at once;
     - a second start of the same workflow returns to the existing tab or shows the running state, not a raw error;
     - completion data states whether the project guidance was used.
   - Ordering note: agents consume the prompt, but the old order made the prompt **after** agents. Say whether the UI recommends running project guidance first.

8. **Serious: migration has no requirement.**
   - Several kinds of existing state need defined behaviour: a `generation-manifest.json` checkpoint written by the old wizard (it has no chat tab or session), the persisted `'setup-wizard'` current view, and the VS Code wizard panel.
   - Add an AC: on first open of the agent workflow, `wizard:get-resumable-run` is queried and a resumable checkpoint is offered there. Resuming it creates or binds a workflow tab without losing completed outcomes. The old wizard route still lands on a working page.

9. **Moderate: the chat-tab execution model is ambiguous, which makes AC2, AC14 and parity row 21 hard to test.**
   - Generation runs today through the orchestrator's own SDK queries and broadcasts `setup-wizard:generation-stream` (`wizard-generation-rpc.handlers.ts:1021-1037`). It is not a chat session, and its stream is not persisted.
   - Row 21 requires the stream to be "present after reopen". AC14 talks about a "chat generation turn".
   - Say whether generation output must be persisted chat-session history, or a live mirror with outcomes recovered from the checkpoint. Otherwise leave the choice explicitly to the architect and make the ACs hold under either model.

10. **Moderate: "fresh" means "latest" and the documents do not say so.**
    - `getStatus` qualifies only the newest manifest. Both backends trust a requested directory only when it **equals** that latest fresh directory (`wizard-generation-rpc.handlers.ts:336-339`; `enhanced-prompts.service.ts:989-1000`).
    - A user who loads an older saved analysis (AC12, scope 5) and then starts a generator gets workspace discovery silently.
    - AC5 should say "the latest completed analysis". AC4 should name this case: the selected analysis is not the latest.

11. **Moderate: there is no AC for workspace binding between the tab and the RPC.**
    - Workflow tabs are workspace-scoped (`tabs.activeWorkspacePath`, `workflow-tab-launcher.service.ts:49`).
    - `wizard:submit-selection` uses `workspaceProvider.getWorkspaceRoot()` (`:252`), while `enhancedPrompts:runWizard` uses `params.workspacePath` (`:223-224`). The old UI derived the path from the analysis directory (`prompt-enhancement.component.ts:301-304`).
    - AC13 covers foreign directories but not a tab whose workspace differs from the host's current root. Require the generator to use the tab's workspace, or reject on mismatch.

12. **Moderate: project-guidance cancellation has no stated position.** There is no `enhancedPrompts` cancel RPC (`enhanced-prompts-rpc.handlers.ts:76-81`), but a chat tab shows a Stop control. AC8 covers agents only. State whether project guidance becomes cancellable (a new capability) or what Stop does today.

13. **Moderate: AC4 asks for "user-facing terms" with no mapping.** Require a mapping for each `AnalysisStatus.reason`: `no-analysis`, `unreadable`, `legacy-v3`, `incomplete`, `expired`, `workspace-changed`, `output-mismatch` (`analysis-freshness.service.ts:63-206`), plus "not the latest" (F10) and "freshness lookup failed" (`wizard-generation-rpc.handlers.ts:287-301`).

14. **Minor: where the Hub starts go is ambiguous against D10/D12.** Scope item 1 says "Setup Hub/wizard experience" and AC1 says the Hub offers both starts. If new controls go on the Hub home, say they reuse the existing card and button styles with no new layout. The alternative is to put the choice on the internal wizard landing page, where new design is allowed.

15. **Minor: the documents do not name the existing workflow tags** `'setup-agent-generation'` and `'setup-project-prompt'` (`chat-types.ts:873-878`). Naming them prevents a second tag set. AC7 says "rejected outcomes", but the payload reports `rejectedSections` (sections), not rejected files (`wizard-phase-generation.ts:95-108`).

16. **Minor: line drift.** See Verified claims rows 13 to 15. Also `setup-rpc.handlers.ts:272-276` is the docblock; registration is at `:279`.

## Lane-introduced constraints (lane-proposed; neither the user nor the project rules required them)

- **lane-proposed**: "Do not add a second time threshold or a model-change rule" (Freshness definition). This is reasonable, but it is a product decision. Note that analysis **resume** already treats a model change as a fresh start (research §B).
- **lane-proposed**: "Show the status returned by the service, without exposing raw paths or errors."
- **lane-proposed**: "Workspace identity comes from the authorized host workspace, not a chat message or a previously selected analysis directory." It conflicts with today's prompt flow, which derives the workspace from the analysis directory (F11).
- **lane-proposed**: "Run prompt generation only when the user starts that workflow". The user asked for independence, not for auto-chaining to stop. Removing the auto-start after agents follows from that, but it is the lane's interpretation, and it interacts with F7's ordering note.
- **lane-proposed**: "Chat text and errors must use the shared safe rendering path."
- **lane-proposed**: "Existing generated files... must not be overwritten by merely opening/reopening a tab".
- Repository convention, not lane-introduced: Angular standalone, OnPush and signals. Taken from the orchestration flow: the designer phase. Taken from the carrier: estimate L.

## Required changes for REVISE

1. **parity-inventory.md: add rows**, each with file:line, RPC, decision, new location and a proving test:
   - (a) `setup-wizard:launch`, the separate VS Code wizard panel and the setup-status-widget/project-setup-card entry (`setup-status-widget.component.ts:194-217`; `setup-rpc.handlers.ts:236-269`; `setup-wizard.service.ts:53-90`; `webview-lifecycle.service.ts:109-156`);
   - (b) provider/model selection (`welcome.component.ts:376-412`; `wizard-rpc.service.ts:126`);
   - (c) the generation-resume offer (`wizard-analysis-runner.service.ts:132-160,197-199`; `analysis-results.component.ts:57-78,354-356`);
   - (d) saved-analysis Use→recommend hand-off and hide (`welcome.component.ts:414-449`);
   - (e) analysis results Continue and "Let Me Adjust" (`analysis-results.component.ts:337-347`).
2. **parity-inventory.md: fix drifted rows.**
   - Row 24: cite `wizard-generation-rpc.handlers.ts:492-520,1077-1140` for propagation and consent. Change the test to "invalid or unsafe content falls back to the authored template; validator error still writes; outcome counts reflect it" (`orchestrator.service.ts:983-1014`).
   - Row 32: remove `setup-wizard:open-agents-folder` or mark it unused.
3. **task-description.md, Current behavior and Self-gather:** document the `enhancedPrompts:runWizard` `analysisData` → `preComputedInput` bypass (`enhanced-prompts-rpc.handlers.ts:248-330`). Add to scope item 2 and AC4: client-supplied analysis data on either generator is used only when the same freshness result trusts it; otherwise it is ignored.
4. **task-description.md, AC6:** replace "relevant agent recommendations" with the chosen rule for `wizard:recommend-agents` without analysis (static catalog parity, or scored from workspace discovery), and name the input contract.
5. **Add ACs:**
   - (a) concurrency (F7): both generators at once, a duplicate start of the same workflow, a cross-workspace block, the enhanced prompt captured at agent submit;
   - (b) migration (F8): an old in-progress generation checkpoint is offered in the agent workflow; the old wizard view and VS Code panel still land on a working page;
   - (c) host parity (F1, F11): VS Code and Electron both open the generation tabs in the main chat surface; the generator workspace equals the tab workspace or is rejected;
   - (d) project-guidance Stop/cancel behaviour (F12).
6. **Freshness section and AC4/AC5:** state latest-run-only semantics and the `updatedAt` basis. Add a reason-to-message mapping table covering every `AnalysisStatus.reason`, "not the latest" and "lookup failed".
7. **Execution model (F9):** state whether generation output must survive reopen as chat history, or be recovered from checkpoint outcomes. Rephrase AC2, AC14 and parity row 21 to match, or defer the choice to the architect with ACs that hold under both models.
8. **Name the workflow tags** `setup-agent-generation` and `setup-project-prompt`. Clarify that Hub-home starts reuse existing styles, or move the choice to the internal wizard landing page. Change AC7 "rejected" to "rejected sections".
9. **Add a "Lane-proposed constraints" note** to the task description that lists the items above, so Gate 1 can accept or drop each one explicitly.

## Re-review (round 1)

Scope: only the revision. That is task-description.md (20 ACs, `## Lane-proposed constraints`,
`## Revision log`) and parity-inventory.md (35 data rows).

**Verdict: APPROVED. Score: 9/10.**

### New citations spot-checked (all hold)

- `enhanced-prompts-rpc.handlers.ts:248-348` builds `preComputedInput` from `params.analysisData`
  and passes it to `runWizard` at `:342-348`. It runs no freshness check.
- `enhanced-prompts-rpc.handlers.ts:76-81,107-125` register no cancel method. The service already
  has an internal `AbortController` for its timeout (`enhanced-prompts.service.ts:828-854,939`), so
  a Stop path is feasible.
- `setup-rpc.handlers.ts:502-648`: the static catalog has score 100 for every agent and
  `video-director` is not pre-selected. The RPC throws when there is no input.
- `project-setup-card.component.ts:108` hosts `<ptah-setup-status-widget />`.
- `wizard-generation-rpc.handlers.ts:492-520,1077-1140` (propagation and consent) and
  `orchestrator.service.ts:980-1014` (validation, fallback and still-write) match the corrected
  row 32 test wording.
- `completion.component.ts:522-526` posts only `SETUP_WIZARD_COMPLETE`. The open-folder claim was
  dropped.

### Resolved items

1. **Missing parity rows: resolved.** New rows cover:
   - the chat widget and project-setup-card;
   - the VS Code panel and its Close;
   - provider and model choice;
   - saved-analysis Use and Hide;
   - results-page Continue and Let Me Adjust;
   - the old-wizard resume offer;
   - the retry cap and backoff;
   - prompt `analysisData`.

   Each row has file:line, RPC, decision, new location and test. All 26 original rows are still
   present, so the revision added no silent removal.
2. **Drifted rows: resolved** (rows 32 and 41).
3. **`analysisData` bypass: resolved.** It is documented under Current behavior. In scope 2, AC4 and
   AC5 gate client `analysisData` on the same latest-fresh result in both RPCs, and the new parity
   row has an API test.
4. **No-analysis recommendation contract: resolved.** AC6 now has an observable rule: an explicit
   `{ source: 'workspace-catalog' }` request returns the same IDs and categories at score 100, and
   the multi-phase path is retained. No `ProjectAnalysisResult` is fabricated.
5. **Concurrency, migration, hosts and Stop: resolved.**
   - AC15: both run independently; a duplicate start focuses the running tab; another workspace
     sees a clear blocked state.
   - AC16: guidance consumed is recorded at submit.
   - AC17: tabless old checkpoint and old view/panel.
   - AC2 and AC13: both hosts open the main chat; the tab workspace must equal the RPC workspace.
   - AC18: Stop.
   - AC19: model.
   - AC20: retry cap.
6. **Freshness semantics and messages: resolved.** The latest-only and `updatedAt` basis are stated.
   The mapping table covers all seven `reason` values, "not the latest", "lookup failed" and `ok`.
7. **Execution model: resolved.** The choice is deferred to the architect. AC2 and AC14 and row 27
   hold under both models and make no claim that unpersisted tokens survive.
8. **Tags, Hub style and sections: resolved** (In scope 1, AC1, AC2 and AC7, UI impact, Decisions).
9. **Lane proposals: resolved** (`## Lane-proposed constraints`).

### Scope check

- No 651 creep. Freshness reads the existing manifest, and the schema and version stay with 651.
- No 680 or 682 creep.
- One design-level addition, the project-guidance Stop/cancel backend path (AC18, NFR), is labelled
  lane-proposed. It follows from the chat-tab Stop control.

### Still open (Minor, non-blocking; fold in at architecture time or in a small PM touch-up)

1. **AC18** says "Reopening shall show ... the cancelled run status". Prompt runs have no persisted
   run record today, so this implies new storage. Required wording: "across a reload, show the last
   committed prompt state; the cancelled status needs to persist only for the open session, unless
   the architect adds a run record."
2. **AC19** says "persist the model with the run/checkpoint". Only agent runs have a checkpoint, and
   it stores the model only, not the provider. Required wording: "agent checkpoints persist the
   model; project guidance uses the effective tab provider/model at start and shows it in its
   result."
3. **AC9 and rows 33-34**: the "existing wizard's combined flow" has no entry condition, while UI
   impact says the step sequence "becomes a choice of independent workflows". Required: define the
   combined flow as analysis result → Continue → selection → generation. Only that path continues
   into project guidance.
4. **AC5**: "matching client analysis data" means only that the requested directory equals the
   latest fresh directory. The client payload itself is not checked against the verified phase
   files, which is the same as today's agent path (`wizard-generation-rpc.handlers.ts:987`). State
   this so no one assumes the payload content is verified.

### Lane-proposed constraints: recommendation to Gate 1

- **Accept:**
  - the seven-day threshold with no second age or model rule;
  - safe status text without raw paths or errors;
  - binding the RPC workspace to the tab workspace (AC13);
  - the shared safe rendering path;
  - no overwrite on open or reopen;
  - the `{ source: 'workspace-catalog' }` request shape;
  - the guidance-first recommendation (backed by the `resolveRuntime` capture at
    `wizard-generation-rpc.handlers.ts:921-936`).
- **Accept, keep-and-fix:** retaining the combined-wizard auto-continuation while independent starts
  do not chain. This reverses the round-0 removal of auto-chaining, so no behaviour is removed.
- **Accept explicitly as added scope:** project-guidance Stop/cancel (AC18). It is a new backend
  capability, not parity. If Gate 1 wants to keep the task size down, drop it and replace AC18 with
  "Stop is hidden or disabled for project guidance and the run continues to its result".
