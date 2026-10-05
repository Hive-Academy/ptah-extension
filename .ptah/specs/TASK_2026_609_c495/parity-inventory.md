Superseded by narrowed scope (context.md); kept for reference.

# Parity Inventory - TASK_2026_609_c495 (Part B)

Surface consolidated: every place a user sees or manages subagents today, gathered under a new Settings > Subagents routed area (`settings/subagents/...`). Taken from the code at worktree HEAD 21c27d17f, before design.

Paths are relative to `libs/frontend/` unless they start with `apps/` or `libs/`. "Silo: X" means the new Settings > Subagents page named in `task-description.md` (Agents, Models, Analysis, Scope). "New test" means a test the implementing batch must add; an existing spec is named where one already covers the capability.

`keep` = stays where it is (the silo may link to it or show the same data read-only). `move` = the primary home becomes the silo; the old spot keeps at most a link. `remove-proposed` = candidate for removal, needs the user's approval; stays in place until then.

## Setup wizard (route `setup-wizard`, `apps/ptah-extension-webview/src/app/app.routes.ts:80-85`)

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Launch wizard | `chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.ts:112,194-200`; `harness-builder/src/lib/components/setup-hub.component.ts:1296` | `setup-wizard:launch` | keep | Also launched from Silo: Agents and Analysis empty states and "Re-run analysis" | `harness-builder/.../setup-hub.component.spec.ts`; new test: silo empty-state launches wizard |
| Step routing welcome/scan/analysis/selection/enhance/generation/completion | `setup-wizard/src/lib/components/wizard-view.component.ts:113-131` | wizard state (`setup-wizard-state.service.ts`) | keep | unchanged | `setup-wizard/.../setup-wizard-state.service.spec.ts` |
| List saved analyses and load one into the wizard | `setup-wizard/.../welcome.component.ts:198-216,319,348-351` | `wizard:list-analyses`, `wizard:load-analysis` (`wizard-rpc.service.ts:434,457`) | remove-proposed | Silo: Analysis lists runs and opens the wizard on the matching step | `welcome.component.spec.ts` (today); new test: Silo Analysis lists runs |
| Resume interrupted analysis | `setup-wizard/.../scan-progress.component.ts:116-121,547` | `wizard:get-resumable-run` (`wizard-rpc.service.ts:204`) | keep | Silo: Analysis "Resume in wizard" deep-links here | `scan-progress.component.spec.ts`; new test: silo marks incomplete run and opens resume |
| Run deep analysis (writes `.ptah/analysis/<slug>/01..04` + `manifest.json`) | `setup-wizard/.../services/wizard-analysis-runner.service.ts`; `wizard-rpc.service.ts:181` | `wizard:deep-analyze`, `wizard:cancel-analysis` (`:159`) | keep | unchanged; silo shows its output | `wizard-analysis-runner.service.spec.ts` |
| View analysis phase results (expand per phase) | `setup-wizard/.../analysis-results.component.ts:292-308` | in-memory multi-phase result | keep | Same content also read-only on Silo: Analysis | `analysis-results.component.spec.ts`; new test: silo renders phase file |
| Resume interrupted generation | `setup-wizard/.../analysis-results.component.ts:57-60,354-355` | `wizard:get-resumable-run` | keep | Silo: Analysis "Resume in wizard" | `analysis-results.component.spec.ts` |
| Recommend agents (scores) and select/deselect | `setup-wizard/.../agent-selection.component.ts:630-711` | `wizard:recommend-agents` (`wizard-rpc.service.ts:258`), `wizard:submit-selection` (`:104`) | keep | unchanged | `agent-selection.component.spec.ts` |
| Browse and install community agent packs | `setup-wizard/.../agent-selection.component.ts:718-829` | `wizard:list-agent-packs` (`:477`), `wizard:install-pack-agents` (`:502`) | keep | Silo: Agents shows origin "community pack" for installed pack agents | `agent-selection.component.spec.ts`; new test: origin label |
| Enhanced prompts step (run/skip/retry) | `setup-wizard/.../prompt-enhancement.component.ts:319-335` | `enhancedPrompts:runWizard` (`wizard-rpc.service.ts:281`), `enhancedPrompts:regenerate` (`:361`) | keep | unchanged | No spec today; not changed by this task. Bounded regression check: in the wizard, reach the enhanced-prompts step, run Skip once and Run once, and confirm the step advances. Retry: make one run fail with a bounded failure fixture (for example, provider CLI unavailable or network disconnected during Run), confirm the step shows the failure and a Retry control, restore the dependency, press Retry, and confirm the step completes and advances. Record each result in the review |
| Generation progress and per-item retry | `setup-wizard/.../generation-progress.component.ts:469-554` | `wizard:retry-item` (`wizard-rpc.service.ts:141`), `wizard:cancel` (`:126`) | keep | unchanged | No spec today; not changed by this task. Bounded regression check: run generation for at least two agents, confirm per-item progress is shown; with a bounded failure fixture make exactly one item fail (for example, provider CLI unavailable or network disconnected during that item), confirm that item shows failed while the other completes, restore the dependency, press Retry on the failed item, and confirm it reaches completed and its agent file is written without re-running the completed item. Cancel is checked separately and is not evidence for Retry. Record each result in the review |
| Completion summary (written/unchanged/failed counts, output directory, enhanced-prompt status) | `setup-wizard/.../completion.component.ts:105-147,466-503` | `generation-complete` message (`wizard-message-dispatcher.ts:43`) | keep | Add link "Manage in Settings > Subagents" | `completion.component.spec.ts`; new test: link navigates to silo |

## Settings page (route `settings`, `libs/frontend/chat/src/lib/settings/settings.component.ts`)

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Tab switching and deep links by section (`cli-agents`, `main-model`, ...) | `chat/.../settings.component.ts:33-44,158-193`; `core/src/lib/services/app-state.service.ts:145,1391-1407` | `AppStateManager.requestSettingsTab` | keep | Add a Subagents entry and sub-routes; existing sections unchanged | `chat/.../settings.component.spec.ts` |
| CLI lane matrix (which CLIs run lanes, per-CLI model/effort) | `chat/.../ptah-ai/cli-orchestration-matrix.component.ts:68`; `cli-model-effort-popover.component.ts:40-51` | `agent:listCliModels`, settings save via `ProvidersSettingsStateService` | keep | unchanged (lane runtime, not subagent definitions); Silo: Models reuses the model list for validation only | `cli-orchestration-matrix.component.spec.ts`, `cli-model-effort-popover.component.spec.ts` |
| Ptah CLI instance tier mapping | `chat/.../providers/cli-tier-mapping-modal.component.ts:41-51` | settings save (`provider.<id>.cliAgent.modelTier.*`) | keep | unchanged | `cli-tier-mapping-modal.component.spec.ts` |
| Main-agent model tiers per connection | `chat/.../providers/connection-drawer/models-tiers-tab.component.ts:22-36` | `provider:listModels`, settings save | keep | unchanged (main session, not subagents) | `models-tiers-tab.component.spec.ts` |
| Agent orchestration policy (max concurrent, preferred order) | `chat/.../ptah-ai/agent-orchestration-config.component.ts:36-45` | `agent:getConfig` / `agent:setConfig` | keep | unchanged | `agent-orchestration-config.component.spec.ts` |
| Agent behaviour (system prompt mode, enhanced prompts on/off) | `chat/.../pro-features/agent-behaviour-section.component.ts:76-85,386-441` | `agent:getConfig`, `agent:setConfig`, `enhancedPrompts:getStatus`, `enhancedPrompts:setEnabled` | keep | unchanged | `agent-behaviour-section.component.spec.ts` |

## Thoth (route `thoth`, Electron-only tabs, `thoth-shell/src/lib/components/thoth-shell.component.ts:240-241`)

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Library: list agent clones for this workspace scope | `skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:86,102,234` | `skillSynthesis:listClones` (workspace-scoped via `agentScope()`, `libs/backend/rpc-handlers/.../skills-synthesis-rpc.handlers.ts:949-995`) | keep | Silo: Agents links to it (Electron) | `skill-clones-view.component.spec.ts`; new test: silo link opens Library on Agents kind |
| Edit agent body | `skill-synthesis-ui/.../clones/clone-body-editor.component.ts` | `skillSynthesis:saveCloneBody` | keep | unchanged; silo links | `clone-body-editor.component.spec.ts` |
| Rebase agent onto newer shipped version / keep local | `skill-synthesis-ui/.../clones/clone-detail-drawer.component.ts:211-218`; `bulk-rebase-confirm.component.ts` | `skillSynthesis:rebaseClone`, `skillSynthesis:keepClone` | keep | unchanged; Silo: Agents links to the Library entry (Req 2.7). No update-available badge in this task (deferred by user, round 0) | `clone-detail-drawer.component.spec.ts`, `bulk-rebase-confirm.component.spec.ts`; new test: silo link opens the Library entry |
| Enhance agent (preview/apply/revert) | `skill-synthesis-ui/.../clones/clone-detail-drawer.component.ts:186-193`; `enhance-preview-drawer.component.ts` | `skillSynthesis:previewEnhancement`, `applyProposal`, `revertEnhancement` | keep | unchanged | `clone-detail-drawer.component.spec.ts` |
| Skill candidates: list with status filter and project-scope filter (this project / all) | `skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:185` (candidates case), filters `:193-232`, table `:327` (`skill-candidates-table.component.ts`) | `skillSynthesis:listCandidates` | keep | unchanged; Silo shows a read-only workspace summary of the candidates recorded for the active workspace only, excluding the unknown-project captures this filter also returns (`:235-239`), and links here (Req 6.3) | `skill-synthesis-tab.component.spec.ts`, `skill-candidates-table.component.spec.ts`; new test: silo trajectory fixture (Req 6.3) |
| Skill candidates: per-row promote / reject, pin, candidate detail | `skill-synthesis-tab.component.ts:333-336,341`; `skill-candidates-table.component.ts` | `skillSynthesis:promote`, `skillSynthesis:reject` (pin RPC per `onTogglePin`) | keep | unchanged; not offered in the silo | `skill-candidates-table.component.spec.ts`, `skill-synthesis-tab.component.spec.ts` |
| Skill candidates: bulk select, promote selected, reject selected, clear | `skill-synthesis-tab.component.ts:283-319,337-338` | `skillSynthesis:promote`, `skillSynthesis:reject` (bulk) | keep | unchanged; not offered in the silo | `skill-synthesis-tab.component.spec.ts` |
| Skill candidates: reject all pending, reject by name pattern (`*` wildcard) | `skill-synthesis-tab.component.ts:251-281` | maintenance reject RPCs behind `onRejectAllPending` / `onRejectByPattern` | keep | unchanged; not offered in the silo | `skill-synthesis-tab.component.spec.ts` |

## Harness sync health (provider copies)

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Aggregate per-target health badge (expected/found/missing/foreign) | `marketplace/src/lib/harness/harness-health-badge.component.ts`; mounted `marketplace/.../pages/skills/skills-section-header.component.ts:43` | `harness:health`, push `harness:healthChanged` (`harness-health.store.ts:114`) | keep | Silo: Agents shows the same data per agent and per provider | `harness-health-badge.component.spec.ts`, `harness-health.store.spec.ts`; new test: per-agent status |
| Re-sync / reconcile | `marketplace/.../harness/harness-health.store.ts:164` | `harness:reconcile` | keep | Also Silo: Agents "Re-sync" | `harness-health.store.spec.ts`; new test: silo re-sync refreshes statuses |
| Repair blocked target paths | `marketplace/.../harness/harness-health-badge.component.ts:167-168`; `harness-repair-dialog.component.ts` | `harness:repairBlocked` | keep | unchanged; silo shows write failures and links | `harness-repair-dialog.spec.ts`, `harness-blocked-paths.spec.ts` |
| Dashboard harness card | `dashboard/src/lib/components/harness-card/harness-card.component.ts:25,76` | `harness:health` | keep | unchanged | `harness-card.spec.ts` |

## Other agent lists and creators

| Capability | Where today (file:line) | Backing RPC / API | Decision | New location | Test that proves it |
| --- | --- | --- | --- | --- | --- |
| Chat setup-status widget (agent count, last updated, launch wizard) | `chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.ts:94-112,159` | `setup-status:get-status` (`libs/shared/src/lib/types/rpc/rpc-setup.types.ts:13-19`) | keep | Add link to Silo: Agents | none found for this widget; new test: link navigates |
| Setup hub (status, entry to wizard / harness builder / tribunal) | `harness-builder/src/lib/components/setup-hub.component.ts:1264,1296-1317` | `setup-status:get-status`, `setup-wizard:launch` | keep | unchanged; may link to silo | `setup-hub.component.spec.ts` |
| Harness builder: AI-designed custom subagents | `harness-builder/src/lib/services/harness-rpc.service.ts:215-218`; `harness-builder-state.service.ts:449-454`; `harness-config-preview.component.ts:87-89,208` | `harness:design-agents`, `harness:apply` | keep | Silo: Agents shows origin "harness builder" | `harness-builder-view.component.spec.ts`; new test: origin label |
| @-mention agent autocomplete in chat | `core/src/lib/services/agent-discovery.facade.ts:61` | `autocomplete:agents` | keep | unchanged | `agent-discovery.facade.spec.ts` |
| Task agent picker | `tasks-ui/src/lib/services/task-agent-discovery.service.ts:43-44` | `autocomplete:agents`, `agent:detectClis` | keep | unchanged | `task-agent-discovery.service.spec.ts` |

## Not in the UI today (new in the silo, no parity row)

- Per-agent / per-provider model selection (only template `model:` today: `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:1109-1111`).
- Read-only view of `.ptah/analysis/<slug>/01..04` outside the wizard run, and what they feed.
- Per-agent per-provider sync status (only aggregate per target today).
- Quarantined agents and restore (Part A creates the quarantine).
- Workspace-level skills trajectory summary (Req 6.3). No agent-to-skill association exists today; agent-specific trajectory is out of scope.
- Per-agent origin including plugin and "unknown", and per-agent analysis-run attribution (Req 2.1, 4.3).

Verification of unchanged rows follows `task-description.md` Requirement 7: a named existing spec counts only for the capability it actually exercises; the implementing reviewer records the covering test or manual check per affected row.

## Proposed Removals

- Welcome step "saved analyses" list (`setup-wizard/src/lib/components/welcome.component.ts:198-216`): Silo: Analysis lists the same runs and can open the wizard on the matching step, so the wizard's own list becomes a second entry point to the same data. Requires explicit user approval; stays until then.
