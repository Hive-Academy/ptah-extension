# Batches — TASK_2026_650_2c78

## Execution contract

Approved source: `implementation-plan.md` (Gate 2 revision 1), `decisions.md` D1–D11, 20 acceptance criteria in `task-description.md`, 35 rows in `parity-inventory.md`, and the approved visual contract in `design-spec.md` with D11's architect deviations. The static `prototype/` illustrates the UI; it is not an implementation target. This document is a decomposition, not an implementation report. All batches below are **PENDING**; no executor has been started.

Use a codex lane for each batch, with the indicated specialist role. At most three lanes run together, and only the B09–B11 group may overlap. Commit each batch only after its scoped typecheck, lint and tests pass; the team-leader verifies disk changes and owns the commit. Run checks serially, typecheck/lint before tests, `--parallel=1` for Nx and `--coverage=false --maxWorkers=2` for direct Jest. For a multi-project `run-many -t test`, confirm the header says `Running target test for N projects` with the expected N. No build, serve, dev, e2e, package, or Electron launch. Existing Settings drawer, `apps/ptah-cli` prompts/setup/wizard commands and router, and the webview e2e fixture are protected regression callers: inspect and test them, do not edit them to add tab binding. No analysis-phase or manifest-v4 changes.

All paths below are workspace-relative. `M` means modify an existing file; `N` means create it. A path in a verification-only list is not an edit assignment. Projects in commands use their actual `project.json` names (`@ptah-extension/*` for libraries). Commit subjects shown are within 72 characters and use `.commitlintrc.json` scopes.

## Plan issues found

1. `implementation-plan.md:253` treats `libs/backend/rpc-handlers/src/lib/host-profile/manifest.spec.ts` as existing, but file search found no manifest spec. B03 creates it. The same handoff references new supervisor/checkpoint specs; B02/B03 explicitly create them. `implementation-plan.md:254,257` also imply host command/service and widget/card specs exist; B06 and B09–B11 create those four specs (review N1).
2. `implementation-plan.md:84` closes the old panel on `WebviewManager.sendMessage === true`, which only proves transport delivery, not acceptance by `ptah.main` (`implementation-plan-review.md:573-585`). B06 uses the allowed **no automatic close** choice; Close remains an explicit user action. A failed push leaves the landing and retry available.
3. `implementation-plan.md:89-90` does not fully isolate generator events from the real chat session (`implementation-plan-review.md:550-571`). B05 strips every forwarded generator `sessionId`, avoids raising the real session's turn-state revision floor, and proves a subsequent normal chat turn streams and clears. B12 repeats that regression gate.
4. `implementation-plan.md:254` is roughly nine projects in one executor sitting. B04–B06 split the work into serial compiling commits: generic tab/chat/routing substrate, then main shell/consumer, then host push. New RPC names remain atomic in B03 as required by `implementation-plan.md:248,253`; no intermediate commit exposes an unhandled name.
5. `implementation-plan.md:257` permits several entry units to overlap, but the lane cap is three. B09–B11 form the only three-lane group; B12 follows. `implementation-plan.md:257` leaves `WelcomeComponent`/`AnalysisResultsComponent` ownership conditional; B12 owns them, so B07 does not edit those files.
6. `implementation-plan.md:252,258` mentions the e2e fixture's project test gate. `libs/frontend/webview-e2e-harness/project.json` has typecheck and lint targets but no unit `test` target; Phase 7 inspects its contract and typechecks it, without an e2e run.
7. `implementation-plan.md:83` needs a failure branch when a background target workspace partition is unloaded: `TabWorkspacePartitionService.addTabToWorkspace` needs `afterTabId` and can refuse creation (`implementation-plan-review.md:594-599`). B04 returns `failed`; B07/B08 fall back to manual Continue/Skip. No cross-workspace tab is silently created.

None blocks decomposition. In all cases, keep every consuming project compiling and its scoped tests green at each commit. If a staged batch cannot do that, leave it uncommitted and repair within that batch.

## Decisions

| Decision | Options, evidence | Reversible |
| --- | --- | --- |
| Use seven ordered phases, with Phase 7 a verification gate. Split the large Phase 2 and 3 units into serial commits; parallelize only B09–B11. | One integrated backend/UI commit versus serial compatible commits. `implementation-plan.md:248-258` fixes the order and requires atomic RPC registry addition; serial boundaries lower first-batch risk and fit one sitting. | Yes |
| Keep the VS Code panel open after the main-webview push. | Acknowledgement protocol or no auto-close. `sendMessage` is only a transport receipt (`implementation-plan-review.md:573-585`); no auto-close needs no new protocol and preserves Close. | Yes |
| Use the plan's workspace effective provider and composer behaviour. | Per-tab provider picker / unchanged composer versus workspace route / blocked Send during a bound run. D11 and `implementation-plan.md:55,90` make the latter authoritative; global provider fallback is read-only. | Yes |
| No removal or public breaking change is authorized. | D10 preserves tabless awaited calls, including tabless `wizard:cancel` aborting the active run; D11 accepts the plan. A tabless cancel may end a bound run on the same host and must be reflected by bound lookup. | Yes |

## Phase 1 — Additive shared compatibility

### B01 — Types and typed host push

- **Goal / executor:** Add optional tab binding, bound lifecycle/source/result types and typed `SETUP_GENERATION_OPEN` payload without publishing the three new RPC names. `backend-developer`; recommended executor: codex lane. Depends on nothing. Serial.
- **Files:** M `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`, `libs/shared/src/lib/types/wizard/phase.ts`, `libs/shared/src/lib/types/messages/message-constants.ts`, `libs/shared/src/lib/types/messages/message-type.ts`, `libs/shared/src/lib/types/messages/payload-map.ts`, `libs/shared/src/lib/types/webview-surface.types.spec.ts`; N `libs/shared/src/lib/types/messages/setup-generation-open.contract.spec.ts`, `libs/shared/src/lib/types/rpc/rpc-setup-generation.contract.spec.ts`. Review `libs/shared/src/lib/types/webview-surface.types.ts` without changing its existing `setup-wizard` surface ID. **Do not edit** `rpc.types.ts` yet.
- **Projects / acceptance:** `@ptah-extension/shared`; compile contract consumers: `@ptah-extension/chat`, `@ptah-extension/chat-ui`, `@ptah-extension/setup-wizard`, `@ptah-extension/harness-builder`, `@ptah-extension/rpc-handlers`, `@ptah-extension/agent-generation`, `@ptah-extension/cli-engine`, `ptah-cli`, `ptah-extension-webview`, `ptah-extension-vscode`, `ptah-electron`, `@ptah-extension/webview-e2e-harness`. AC2/4/5/13/14/18/19; parity 3,5,18,21,22,31,34. Optional `tabBinding` changes none of today's tabless request or awaited response semantics; bound events carry tab/workspace/workflow/run ID; payload is host-to-main only. Tests prove old envelopes parse, new shapes are typed, and `setup-wizard` route ID is unchanged.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/shared" "@ptah-extension/chat" "@ptah-extension/chat-ui" "@ptah-extension/setup-wizard" "@ptah-extension/harness-builder" "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" "@ptah-extension/cli-engine" ptah-cli ptah-extension-webview ptah-extension-vscode ptah-electron "@ptah-extension/webview-e2e-harness" --parallel=1`; then `npx nx test "@ptah-extension/shared" --parallel=1`.
- **Commit boundary:** `feat(shared): add optional generation tab contracts`.

**Phase 1 review:** types/specs only; no code-logic review under the risk-based exemption. Check contract compile results and the exact diff before committing B01.

## Phase 2 — Backend generation and atomic RPC registry

### B02 — Agent run ownership and freshness

- **Goal / executor:** Implement the tab-bound agent path using existing registered methods only; prepare lookup internally but do not expose a new RPC name until B03. `backend-developer`; codex lane. Depends on B01; serial before B03.
- **Files:** M `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`, `wizard-generation-rpc.schema.ts`, `wizard-generation-run.supervisor.ts`, `wizard-generation-checkpoint.service.ts`, `wizard-generation-rpc.handlers.spec.ts`, `wizard-generation-rpc.schema.spec.ts`, `wizard-generation.preview-fidelity.spec.ts`; M `libs/backend/agent-generation/src/lib/types/generation-checkpoint.types.ts`; N `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-run.supervisor.spec.ts`, `wizard-generation-checkpoint.service.spec.ts`. All relative paths after the first handler are in `libs/backend/rpc-handlers/src/lib/handlers/`.
- **Projects / acceptance:** `@ptah-extension/rpc-handlers`, `@ptah-extension/agent-generation`. AC3–5,7,8,13–16,20; parity 7,16–19,22–26,35. Authorize canonical host/tab workspace before I/O; reject foreign directory, fall back from stale/not-latest/unreadable/lookup-failed to discovery, prefer server-verified phase content over altered client data. Preserve version-1 old checkpoint parsing and final outcomes; bind old checkpoint only on authorized resume. Snapshot effective workspace provider, supported model and guidance used at each new/resume submit; retry reuses snapshot, re-previews changed definite targets. Exact-run cancel and same-workspace safe owner `tabId` only; tabless cancel retains legacy active-run meaning, including a bound run. No success before checkpoint/finalization and validated writes/propagation.
- **Specs:** The listed handler/schema/preview specs plus new supervisor/checkpoint specs cover missing/fresh/stale/foreign source matrix, altered client payload, lost response lookup logic, duplicate/late terminal, tabless semantics, old resume, target renewal, counts and safe fallback.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" --parallel=1`; then `npx nx run-many -t test -p "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" --parallel=1` (header: `Running target test for 2 projects`).
- **Commit boundary:** `feat(agent-generation): bind agent runs to workspace tabs`.

### B02G - Guidance execution behind existing methods

- **Goal / executor:** Add tab-bound accepted guidance execution, lock ownership, cancellation machinery and freshness handling behind the existing `runWizard`/`regenerate` methods. Do not publish new RPC names; B03 exposes cancel and lookup atomically with the registry. `backend-developer`; codex lane. Depends on B02; serial before B03.
- **Files:** M `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`, `enhanced-prompts-rpc.schema.ts`, `enhanced-prompts-rpc.handlers.spec.ts`, `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts`, `enhanced-prompts.service.spec.ts`; N `libs/backend/rpc-handlers/src/lib/handlers/guidance-generation-run.supervisor.ts`, `guidance-generation-run.supervisor.spec.ts`, `enhanced-prompts-rpc.schema.spec.ts`. All relative handler spec paths are under `libs/backend/rpc-handlers/src/lib/handlers/`.
- **Projects / acceptance:** `@ptah-extension/rpc-handlers`, `@ptah-extension/agent-generation`; typecheck `ptah-cli`, `@ptah-extension/chat`, `ptah-extension-vscode`, `ptah-electron` as contract consumers. AC3-5,10,11,13-15,18,19; parity 29-31,34. Existing service lock is acquired atomically before accepted and released in `finally`; supervisor records binding and abort without second lock. Tabless calls still await completion. Bound starts authorize host/tab workspace and directory before client analysis, resolve effective provider and supported model, gate latest verified phase data, and return accepted metadata. Abort threads through discovery, stream and pre-commit; no success before trace and state commit, no late progress after verified cancellation. Internal cancel/lookup is ready for B03 registration.
- **Specs:** Existing and new handler/schema/supervisor/service specs cover fresh/stale/foreign data, lock owned by another tab/workspace or Settings/CLI, stream/pre-commit abort, trace-write failure, unsupported-model fallback and tabless awaited semantics.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" ptah-cli "@ptah-extension/chat" ptah-extension-vscode ptah-electron --parallel=1`; then `npx nx run-many -t test -p "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" --parallel=1` (header: `Running target test for 2 projects`).
- **Commit boundary:** `feat(agent-generation): bind guidance execution to tabs`.

### B03 — Guidance, catalog and complete RPC registry

- **Goal / executor:** Make tab-bound guidance cancellable while preserving tabless awaited calls; publish all three new RPC names, handler `METHODS`, manifest/allowlist and host guards **in this same commit**. `backend-developer`; codex lane. Depends on B02G; serial.
- **Files:** M `libs/shared/src/lib/types/rpc.types.ts`, `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`, `enhanced-prompts-rpc.schema.ts`, `enhanced-prompts-rpc.handlers.spec.ts`, `wizard-generation-rpc.handlers.ts`, `wizard-generation-rpc.handlers.spec.ts`, `setup-rpc.handlers.ts`, `setup-rpc.handlers.spec.ts`, `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, `host-profile/manifest.ts`, `rpc-allowlist.spec.ts`; N `libs/backend/rpc-handlers/src/lib/host-profile/manifest.spec.ts`; M guard specs `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`, `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `apps/ptah-electron/src/di/expected-resolvable.ts`, `container.smoke.spec.ts`, `rpc-surface.spec.ts`, `surface-composition.spec.ts`, `apps/ptah-cli/src/di/expected-resolvable.ts`, `container.smoke.spec.ts`, `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`. Relative handler/host-profile/spec paths after the first full prefix are under `libs/backend/rpc-handlers/src/lib/`; relative DI paths are under their stated app `src/di/` directories. Review host registration files `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `phase-3-handlers.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, `phase-4-handlers.ts`, `libs/backend/cli-engine/src/lib/container.ts`; edit only if the class-token supervisor cannot resolve, and include any such edit in this batch/commit.
- **Projects / acceptance:** `@ptah-extension/shared`, `@ptah-extension/rpc-handlers`, `@ptah-extension/agent-generation`, `@ptah-extension/cli-engine`, `ptah-cli`, `ptah-extension-vscode`, `ptah-electron`. AC3–6,10,11,13–15,18,19; parity 13,29–31,34. Guidance's existing service owns one atomic lock; supervisor tracks binding, abort and state only. Tab-bound accepted response precedes background work; tabless `runWizard`/`regenerate` still await final result. Exact-run cancel/lookup, foreign-workspace rejection before `analysisData`, trace-before-state success, unknown committed state when unverified, independent agent/guidance locks. Catalog mode returns existing IDs/categories/score-100 and leaves tabless recommendation mode intact. Registry totality and all three methods are tested in every host. Settings drawer and CLI prompts/setup/wizard calls retain their tabless contract; protected files are read-only.
- **Specs:** Listed backend specs plus manifest/allowlist, container smoke and RPC surface guards; focused Settings drawer and CLI prompts/setup/wizard specs run as a regression check. Include same-workspace second tab, cross-workspace and tabless lock owner, stop during stream/before trace, no late progress, fresh-only enrichment and stale client bypass.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/shared" "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" "@ptah-extension/cli-engine" ptah-cli ptah-extension-vscode ptah-electron "@ptah-extension/chat" --parallel=1`; then `npx nx run-many -t test -p "@ptah-extension/shared" "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" --parallel=1` (header: `Running target test for 3 projects`); then `npx jest apps/ptah-extension-vscode/src/di/container.smoke.spec.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts apps/ptah-electron/src/di/container.smoke.spec.ts apps/ptah-electron/src/di/rpc-surface.spec.ts apps/ptah-electron/src/di/surface-composition.spec.ts apps/ptah-cli/src/di/container.smoke.spec.ts libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.spec.ts apps/ptah-cli/src/cli/commands/prompts.spec.ts apps/ptah-cli/src/cli/commands/setup.spec.ts apps/ptah-cli/src/cli/commands/wizard.spec.ts --coverage=false --maxWorkers=2`.
- **Commit boundary:** `feat(rpc-handlers): register bound generation methods`.

**Phase 2 code-logic review:** after B03 commit, review combined B02–B02G–B03 diff with an independent **Claude-family** reviewer (codex implementer; reviewer family recorded as Claude). Check security, lock/abort/finalization and D10 compatibility. One blocking/serious fix round at most, then one scoped re-review; record any weaker-evidence exception if a different family is unavailable.

## Phase 3 — Chat substrate, main shell and host handoff

### B04 — Workspace tab launcher and generic chat hooks

- **Goal / executor:** Establish same-workspace find/create navigation, route persistence and generic C1/guard hooks without importing `setup-wizard` into `chat-ui`. `frontend-developer`; codex lane. Depends on B03; serial before B05.
- **Files:** M `libs/frontend/chat-state/src/lib/tab-manager.service.ts`, `tab-workspace-partition.service.ts`, `tab-manager.service.spec.ts`, `tab-workspace-partition.service.spec.ts`, `libs/frontend/chat-state/src/index.ts`; N `libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.ts`, `generation-workflow-launcher.service.spec.ts`; M `libs/frontend/chat-ui/src/index.ts`, `libs/frontend/chat/src/lib/tokens/session-context.token.ts`, `components/templates/session-embed.component.ts`, `components/templates/session-embed.component.spec.ts`, `components/molecules/chat-input/chat-input.component.ts`, `components/molecules/chat-input/chat-input.component.spec.ts`, `libs/frontend/chat/src/index.ts`, `libs/frontend/core/src/lib/routing/surface-routes.ts`, `surface-router.service.ts`, `surface-router.service.spec.ts`, `surface-route-persistence.ts`, `surface-route-persistence.spec.ts`. Relative component paths after a full library prefix use that same library root.
- **Projects / acceptance:** `@ptah-extension/chat-state`, `@ptah-extension/chat-ui`, `@ptah-extension/chat`, `@ptah-extension/core`; typecheck `@ptah-extension/setup-wizard`, `@ptah-extension/harness-builder`, `ptah-extension-webview` as consumers. AC2,9,15,19; parity 2,5,21,22,27. Launcher returns `landed/cancelled/failed`; duplicate same-workspace tab focuses existing owner, background create leaves focus alone. Unloaded partition or missing `afterTabId` returns failed, never wrong-workspace creation. Generic synchronous Stop handler and existing `SESSION_START_GUARD` preserve ordinary chat Stop/queue when no run; child route uses existing `setup-wizard` surface ID and validates restored tab identity.
- **Specs:** Listed tab/launcher/route/chat specs; guard test covers blocked Send before queueing and C1 `not-handled` fallback; route test covers invalid persisted path. This batch need not start a generator.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/chat-state" "@ptah-extension/chat-ui" "@ptah-extension/chat" "@ptah-extension/core" "@ptah-extension/setup-wizard" "@ptah-extension/harness-builder" ptah-extension-webview --parallel=1`; then `npx nx run-many -t test -p "@ptah-extension/chat-state" "@ptah-extension/chat-ui" "@ptah-extension/chat" "@ptah-extension/core" --parallel=1` (header: `Running target test for 4 projects`).
- **Commit boundary:** `feat(chat-ui): add workspace generation tab launcher`.

### B05 — Main routed shell, stores and safe event adapter

- **Goal / executor:** Make the tab route and main-app handoff consumer runnable, with backend state as the success authority. `frontend-developer`; codex lane. Depends on B04; serial before B06.
- **Files:** N `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts`, `generation-workflow-shell.component.spec.ts`, `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts`, `generation-workflow.store.spec.ts`, `generation-handoff.store.ts`, `generation-handoff.store.spec.ts`, `generation-run-event-adapter.ts`, `generation-run-event-adapter.spec.ts`, `setup-generation-open.handler.ts`, `setup-generation-open.handler.spec.ts`; M `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts`, `wizard-rpc.service.spec.ts`, `libs/frontend/setup-wizard/src/index.ts`, `apps/ptah-extension-webview/src/app/app.routes.ts`, `app.routes.spec.ts`, `app.config.ts`, `surface-message-routing.spec.ts`.
- **Projects / acceptance:** `@ptah-extension/setup-wizard`, `ptah-extension-webview`; typecheck `@ptah-extension/chat` and `@ptah-extension/core` as consumers. AC2,8,9,14,17–19; parity 4,5,21–24,27,28,32. Shell embeds `ptah-session-embed` bare and validates tab/workspace/workflow on open/restore. `MESSAGE_HANDLERS` in app config receives only the typed host push, validates workspace and invokes B04 launcher. Store handles starting, quiet, cancelling, stop-unconfirmed/unknown and terminal; pending Stop waits for accepted or looked-up exact run ID, never falls through to `chat:abort`. Guidance/agent result recovery reads committed records; a closed stream is not success. **D11:** sanitize text/tool labels; strip generator SDK `sessionId` and run ID from every forwarded chat event; generator busy/terminal signalling must not advance the real chat session's revision floor. A normal chat turn immediately after a generator run must stream and clear normally, with no queued Send flushed into the generator. Use `SESSION_START_GUARD` for bound-run Send blocking and C1 for Stop. Design deviations D11 are accepted, not a new per-tab provider.
- **Specs:** New shell/store/handoff/adapter/consumer specs and changed RPC/route/routing specs. Adapter spec exercises nested/flat generator session IDs, wrong tab/workspace/run, terminal race, sanitized output and normal subsequent chat turn. Handoff spec uses fake clock, absolute five-second deadline, switch/close/reload and manual recovery.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/setup-wizard" ptah-extension-webview "@ptah-extension/chat" "@ptah-extension/core" --parallel=1`; then `npx nx run-many -t test -p "@ptah-extension/setup-wizard" ptah-extension-webview --parallel=1` (header: `Running target test for 2 projects`); then `npx jest libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts libs/frontend/chat/src/lib/components/templates/session-embed.component.spec.ts --coverage=false --maxWorkers=2`.
- **Commit boundary:** `feat(setup-wizard): add routed generation chat shell`.

### B06 — Legacy panel and Electron main handoff

- **Goal / executor:** Send old panel and host starts to `ptah.main` while retaining a working landing, analysis entry and user Close. `backend-developer`; codex lane. Depends on B05; serial.
- **Files:** M `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts`, `setup-wizard.service.spec.ts`, `apps/ptah-electron/src/services/electron-setup-wizard.service.ts`, `apps/ptah-extension-vscode/src/commands/setup-agents-command.ts`; N `apps/ptah-electron/src/services/electron-setup-wizard.service.spec.ts`, `apps/ptah-extension-vscode/src/commands/setup-agents-command.spec.ts`.
- **Projects / acceptance:** `@ptah-extension/agent-generation`, `ptah-electron`, `ptah-extension-vscode`. AC2,12,17; parity 3,6,8,9,12,35. VS Code `focusChat()` plus typed push goes to `ptah.main`; **do not automatically close the old panel** on `postMessage === true`. It remains usable and explicitly closable; push failure has retry. Electron retains its `SWITCH_VIEW` landing path and sends generation requests to the main consumer. No host branch enters shared frontend code. Specs verify live-but-unbootstrapped main cannot strand the user and old Close still works.
- **Specs:** Existing setup-wizard service spec and the two new host specs, plus focused main consumer spec from B05 as integration proof.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/agent-generation" ptah-electron ptah-extension-vscode ptah-extension-webview --parallel=1`; then `npx nx run-many -t test -p "@ptah-extension/agent-generation" ptah-electron ptah-extension-vscode --parallel=1` (header: `Running target test for 3 projects`); then `npx jest libs/frontend/setup-wizard/src/lib/services/setup-generation-open.handler.spec.ts --coverage=false --maxWorkers=2`.
- **Commit boundary:** `feat(vscode): hand off wizard starts to main chat`.

**Phase 3 code-logic review:** after B06 commit, independent Claude-family review of combined B04–B06 diff (codex implementer). Review route/partition isolation, adapter session ID/revision handling, panel retention and no backend start on tab open. Same fix/re-review limit as Phase 2.

## Phase 4 — Agent workflow page

### B07 - Agent selection, source and target preview

- **Goal / executor:** Move the agent entry, catalog, selection, model/source and target-preview controls into the new tab while the old generation path remains usable until B07B. `frontend-developer`; codex lane. Depends on B06; serial before B07B.
- **Files:** N under `libs/frontend/setup-wizard/src/lib/components/`: `wizard-landing.component.ts`/`.spec.ts`, `workflow-card.component.ts`/`.spec.ts`, `generation-source-status.component.ts`/`.spec.ts`, `generation-model-picker.component.ts`/`.spec.ts`, `agent-selection-list.component.ts`/`.spec.ts`, `community-packs-panel.component.ts`/`.spec.ts`, `agent-preview-dialog.component.ts`/`.spec.ts`; M `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts`, `agent-selection.component.ts`, `agent-selection.component.spec.ts`, `libs/frontend/setup-wizard/src/index.ts`. All named new component pairs are exact `.ts` and `.spec.ts` files in the stated directory.
- **Projects / acceptance:** `@ptah-extension/setup-wizard`; typecheck `ptah-extension-webview`. AC2,6,7,12,19; parity 4,5,9,10,13-16. Source card distinguishes verified latest analysis from workspace discovery without claiming client data verified. Static catalog returns existing IDs/categories/score-100; toggles, lazy packs/install and preview certainty remain. Changed definite targets require renewed confirmation. Workspace provider activation warns other tabs and is workspace-scoped; global fallback is read-only. Tab model is the only model selector. The route remains usable while B07B adds run controls.
- **Specs:** New landing/card/source/model/selection/packs/preview specs and changed legacy selection spec cover no-analysis recommendations, saved-analysis entry, target renewal and D11 provider scope.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/setup-wizard" ptah-extension-webview --parallel=1`; then `npx nx test "@ptah-extension/setup-wizard" --parallel=1`.
- **Commit boundary:** `feat(setup-wizard): move agent selection to chat tab`.

### B07B - Agent run, checkpoint recovery and completion

- **Goal / executor:** Finish the agent run page, retry/Stop/recovery and verified completion while retaining all existing capability. `frontend-developer`; codex lane. Depends on B07; serial before B08.
- **Files:** N under `libs/frontend/setup-wizard/src/lib/components/`: `agent-run-card.component.ts`/`.spec.ts`, `agent-generation-progress.component.ts`/`.spec.ts`, `agent-next-steps.component.ts`/`.spec.ts`, `generation-errors.component.ts`/`.spec.ts`, `generation-stop-control.component.ts`/`.spec.ts`; N `libs/frontend/setup-wizard/src/lib/services/agent-generation.store.ts`, `agent-generation.store.spec.ts`; M `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts`, `generation-workflow-shell.component.spec.ts`, `generation-progress.component.ts`, `completion.component.ts`, `completion.component.spec.ts`, `libs/frontend/setup-wizard/src/lib/services/setup-wizard/wizard-phase-generation.ts`, `wizard-phase-generation.spec.ts`, `libs/frontend/setup-wizard/src/index.ts`. Create `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.spec.ts` only if retained old progress behaviour cannot be covered by the new progress spec; if created, it belongs solely to B07B.
- **Projects / acceptance:** `@ptah-extension/setup-wizard`; typecheck `ptah-extension-webview`. AC2,7-9,14,16,17,20; parity 17,20-27,35. First agent-tab open offers a tabless checkpoint without starting or overwriting; resume preserves completed outcomes. Stop binds exact run, lost answers use lookup, and terminal record wins over late stream. Three retry attempts, duplicate guard, remaining count and 1/2/4-second backoff; successful items stay complete. Final counts, rejected sections, propagation/consent and guidance-used marker come only from verified payload; safe errors show three then disclosure plus five Quick Start examples. If saved guidance is absent, show guidance-first advice before submit. Combined origin starts one absolute five-second guidance deadline after committed agent outcome; independent start only offers CTA. Partial outcome may continue; failed-without-payload and failed background guidance-tab creation leave manual Continue/Skip. Analysis phases remain available.
- **Specs:** New run/progress/next-steps/errors/stop/store specs and changed shell/completion/phase specs use fake timers for retry/countdown and cover old-checkpoint migration, stale events, failed write, no false completion, quiet Stop, tab close/reload and independent-versus-combined start.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/setup-wizard" ptah-extension-webview --parallel=1`; then `npx nx test "@ptah-extension/setup-wizard" --parallel=1`.
- **Commit boundary:** `feat(setup-wizard): move agent runs to chat tab`.

**Phase 4 code-logic review:** after B07B commit, independent Claude-family review of combined B07-B07B UI logic (codex implementer). Verify parity 4–27/35, safe output, checkpoint and retry/countdown timing. **Visual review required at end of Phase 6**, dark and light, wide and 360/400 px, against `design-spec.md` with D11 deviations.

## Phase 5 — Guidance workflow page

### B08 — Guidance run, Stop and committed result

- **Goal / executor:** Implement independent guidance tab and combined continuation without an analysis prerequisite. `frontend-developer`; codex lane. Depends on B07B; serial.
- **Files:** N under `libs/frontend/setup-wizard/src/lib/components/`: `guidance-run-card.component.ts`/`.spec.ts`, `guidance-result-panel.component.ts`/`.spec.ts`; N `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts`, `guidance-generation.store.spec.ts`; M `libs/frontend/setup-wizard/src/lib/components/prompt-enhancement.component.ts`, `prompt-enhancement.component.spec.ts`, `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts`, `wizard-rpc.service.spec.ts`, `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts`, `generation-workflow-shell.component.spec.ts`, `libs/frontend/setup-wizard/src/index.ts`.
- **Projects / acceptance:** `@ptah-extension/setup-wizard`; typecheck `ptah-extension-webview`. AC2–5,9–11,14,15,18,19; parity 27–34. Standalone guidance starts without `multiPhaseResult`; source card distinguishes verified latest analysis from discovery. Run uses its guidance tab model and workspace effective provider at start, shows immutable accepted snapshot, streams safe activity/stack/summary through shared chat, and reads committed trace/state for success. Page/chat Stop cancels exact run even during quiet stream; unknown Stop rereads, no false success or raw error. Retry, regeneration, enabled/cache/content/download actions remain; Skip preserves agent outcome. Combined countdown Start now/deadline finds same-workspace guidance tab and submits; switch/close/reload and failed background create retain specified manual fallback. After reload show last committed prompt and neutral run status unless verified cancellation record exists.
- **Specs:** New guidance store/card/result specs and changed prompt/shell/RPC specs. Cover no analysis, latest-only phase enrichment, trace-write failure, cancel before commit, lost start/stop responses, own-tab lookup, tabless Settings/CLI awaited compatibility and combined versus independent start.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/setup-wizard" ptah-extension-webview --parallel=1`; then `npx nx test "@ptah-extension/setup-wizard" --parallel=1`.
- **Commit boundary:** `feat(setup-wizard): add independent guidance tab`.

**Phase 5 code-logic review:** after B08 commit, independent Claude-family review (codex implementer), focused on cancel/commit boundary, state recovery, provider/model snapshot and combined-flow exclusivity. **Visual review required at end of Phase 6**, dark and light.

## Phase 6 — Entry wiring (only parallel group)

**Parallel group G1:** B09, B10 and B11 may run concurrently in three codex lanes after B08. Their write sets and Nx projects are disjoint. Run their heavy checks and commits serially after the lanes return; if a shared file becomes necessary, stop parallel editing and assign it to B12. B12 starts after all three commits.

### B09 — Setup Hub cards

- **Goal / executor:** Wire distinct agent, guidance and analysis starts without changing the Hub home layout. `frontend-developer`; codex lane. Depends on B08; parallel G1.
- **Files:** M `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`, `setup-hub.component.spec.ts`.
- **Projects / acceptance:** `@ptah-extension/harness-builder`. AC1,2,17; parity 1,2. Existing card/button recipe and layout remain; two generation actions use B04 launcher and analysis remains accessible. Test duplicate tab focus and launcher failure copy.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/harness-builder" --parallel=1`; then `npx nx test "@ptah-extension/harness-builder" --parallel=1`.
- **Commit boundary:** `feat(harness-builder): expose generation workflows in hub`.

### B10 — Chat project setup card

- **Goal / executor:** Wire the chat card to the lower-layer launcher. `frontend-developer`; codex lane. Depends on B08; parallel G1.
- **Files:** M `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.ts`; N `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.spec.ts`.
- **Projects / acceptance:** `@ptah-extension/chat`. AC2,15; parity 2. Same-workspace tab reuse and failed landing are visible; no new `chat-ui -> chat` dependency.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/chat" --parallel=1`; then `npx nx test "@ptah-extension/chat" --parallel=1`.
- **Commit boundary:** `feat(chat): launch setup generation from project card`.

### B11 — VS Code setup status widget

- **Goal / executor:** Wire widget generation actions to the launcher while retaining analysis. `frontend-developer`; codex lane. Depends on B08; parallel G1.
- **Files:** M `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.ts`; N `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.spec.ts`.
- **Projects / acceptance:** `@ptah-extension/chat-ui`. AC2,12,17; parity 2. Main chat opens one tagged tab per workflow/workspace; duplicate focus and failure are safe.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/chat-ui" --parallel=1`; then `npx nx test "@ptah-extension/chat-ui" --parallel=1`.
- **Commit boundary:** `feat(chat-ui): open generation tabs from setup widget`.

### B12 — Old wizard landing and analysis-result continuation

- **Goal / executor:** Preserve old wizard entry and analysis controls, and route only analysis-result Continue into combined flow. `frontend-developer`; codex lane. Depends on B09–B11; serial.
- **Files:** M `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts`, `welcome.component.spec.ts`, `analysis-results.component.ts`, `analysis-results.component.spec.ts`, `libs/frontend/setup-wizard/src/lib/services/wizard-analysis-runner.service.ts`, `wizard-analysis-runner.service.spec.ts`, `libs/frontend/setup-wizard/src/lib/components/wizard-landing.component.ts`, `wizard-landing.component.spec.ts`. No edits to Settings/CLI/e2e protected callers.
- **Projects / acceptance:** `@ptah-extension/setup-wizard`; typecheck `ptah-extension-webview`. AC2,9,12,17; parity 6–12,24,27,28. Saved analysis browse/load/hide, old run resume/cancel and four phase results remain independent; Continue marks combined origin, while Hub/widget/independent starts never chain. Old persisted setup-wizard route remains a working landing with analysis plus both generation starts. Regress a normal chat turn after a generator run to catch D11 stale revision/session corruption.
- **Specs:** Changed welcome/results/runner/landing specs and `generation-run-event-adapter.spec.ts` from B05 run as a verification gate only; if it fails, fix the responsible prior batch code under the team-leader's single fix round.
- **Checks:** `npx nx run-many -t typecheck,lint -p "@ptah-extension/setup-wizard" ptah-extension-webview --parallel=1`; then `npx nx test "@ptah-extension/setup-wizard" --parallel=1`; then `npx jest libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.spec.ts libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts --coverage=false --maxWorkers=2`.
- **Commit boundary:** `feat(setup-wizard): connect analysis results to agent tab`.

**Phase 6 code-logic review:** after B12 commit, independent Claude-family review of combined B09–B12 diff (codex implementers), focused on entry parity and analysis preservation. **End visual review:** agent and guidance tabs plus Hub/landing in dark and light; wide and 360/400 px; inspect 336 px sidebar at wide width, narrow inert-chat sheet, Escape/focus restoration, distinct 32 px Stop, safe source/status copy, one primary action, reduced motion and no horizontal scroll. Record that D11 workspace provider and bound-run composer behaviour supersede the differing `design-spec.md:423`/§2.9.3 wording; route wording correction to the design owner outside this batch. No browser/e2e execution is required by this planning gate.

## Phase 7 — Compatibility and completion gate (no edit batch)

After all B01–B12, B02G and B07B commits and Phase 6 reviews, inspect all 20 ACs and all 35 parity rows against the files on disk, then run the following serial regression gate. Phase 7 changes no production, type, test or protected caller file, so it has no commit or code-logic review. Any failure returns to its owning batch before handoff; never patch a protected caller just to accept tab binding.

- Read-only caller inspection: `libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.ts`/`.spec.ts`; `apps/ptah-cli/src/cli/commands/prompts.ts`/`.spec.ts`, `setup.ts`/`.spec.ts`, `wizard.ts`/`.spec.ts`, `apps/ptah-cli/src/cli/router.ts`; `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-advanced-search-voice.fixtures.ts` and `settings-advanced-search-voice.e2e.spec.ts`. Verify awaited tabless `runWizard`/`regenerate`, legacy tabless cancel, no changed fixture contract.
- Typecheck/lint first: `npx nx run-many -t typecheck,lint -p "@ptah-extension/shared" "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" "@ptah-extension/cli-engine" "@ptah-extension/chat-state" "@ptah-extension/chat-ui" "@ptah-extension/chat" "@ptah-extension/core" "@ptah-extension/setup-wizard" "@ptah-extension/harness-builder" ptah-cli ptah-extension-webview ptah-extension-vscode ptah-electron "@ptah-extension/webview-e2e-harness" --parallel=1`.
- Then focused non-e2e tests: `npx jest libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.spec.ts apps/ptah-cli/src/cli/commands/prompts.spec.ts apps/ptah-cli/src/cli/commands/setup.spec.ts apps/ptah-cli/src/cli/commands/wizard.spec.ts libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.spec.ts libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts apps/ptah-electron/src/di/surface-composition.spec.ts --coverage=false --maxWorkers=2`.
- Confirm registry totality, all three names and handler `METHODS` in the B03 commit, all host guard specs, tabless awaited semantics, no stale first normal chat turn, and no old-panel automatic close. Record implementer family codex and reviewer family Claude for each shipping phase; if same-family review was unavoidable, state the reason and label the evidence weaker. Handoff to QA only after the final diff, tests, visual review and parity matrix agree.

## Coverage index

| Acceptance criterion | Owning batches |
| --- | --- |
| AC1 | B09 |
| AC2 | B01, B04–B12 |
| AC3 | B02, B02G, B08 |
| AC4 | B01, B02, B02G, B08 |
| AC5 | B01, B02, B02G, B08 |
| AC6 | B03, B07 |
| AC7 | B02, B07, B07B |
| AC8 | B02, B05, B07B |
| AC9 | B04, B05, B07B, B08, B12 |
| AC10 | B02G, B08 |
| AC11 | B02G, B08 |
| AC12 | B06, B07, B11, B12 |
| AC13 | B01, B02, B02G, B03 |
| AC14 | B01, B02, B02G, B05, B07B, B08 |
| AC15 | B02, B02G, B03, B04, B08, B10 |
| AC16 | B02, B07B |
| AC17 | B05, B06, B07B, B09, B11, B12 |
| AC18 | B01, B02G, B03, B05, B08 |
| AC19 | B01, B02, B02G, B03, B04, B07, B08 |
| AC20 | B02, B07B |

| Parity inventory rows | Owning batches |
| --- | --- |
| 1–3 | B09; B04/B10/B11; B01/B06 |
| 4–5 | B05/B07; B01/B04/B07/B08 |
| 6–12 | B06/B07/B12 |
| 13–16 | B03/B07 |
| 17–19 | B02/B07B |
| 20–24 | B02/B05/B07B |
| 25–26 | B02/B07B |
| 27–28 | B05/B07B/B08/B12 |
| 29–31 | B02G/B03/B08 |
| 32–34 | B01/B02G/B03/B05/B08 |
| 35 | B01/B06/B07B |

## Proposed Removals

Candidate only: unused duplicated old-generation presentation code after the new chat path proves transcript, controls and recovery parity (`implementation-plan.md:223-225`). Options: keep it temporarily, or delete only the now-unused internal code after parity; recommend the latter under the role's replace-in-place rule. This batch plan does **not** approve deletion; send this candidate to the spawner for a decision before any removal. No user-visible capability, old landing/Close, analysis-phase code, Settings/CLI contract or e2e fixture is proposed for removal. Any further removal or public breaking change likewise requires spawner decision with options and evidence.

## Status

| Batch | Phase | Status | Executor | Commit |
| --- | --- | --- | --- | --- |
| B01 | 1 | done | codex backend-developer | 572bc762d |
| B02 | 2 | done (2 revise rounds; handler 1698 lines, follow-up) | codex backend-developer | 6aa54f8d5 |
| B02G | 2 | done (1 revise round: lock-timeout recovery, settled lookup, contract spec; long pre-existing methods grew slightly, follow-up) | codex backend-developer | 20474f335 |
| B03 | 2 | done (continuation lane after tool-call ceiling; supervisors not in expected-resolvable, resolved via handlers) | codex backend-developer | 725d982e6 |
| P2 review | 2 | APPROVE 8/10 after 1 revise round (S1, S2, M1–M9 fixed; Part B continuation lane after the first lane stopped without a report) | Claude code-logic-reviewer; codex fixes | 41c82d930 |
| B04 | 3 | done (tab-manager +58 lines; route validator token on SurfaceRouterService for B05) | codex frontend-developer | 649e7a3cc |
| B05 | 3 | done (1 revise round: transcript adapter via processStreamEvent instead of a local log, composer guard, route allowlist, deeper specs) | codex frontend-developer | f79b795ae |
| B06 | 3 | done (panel kept open after push; explicit workflow arg on ptah.setupAgents; Phase 2 N1/N3/N4 in the next commit) | codex backend-developer | ddf655a63 |
| P3 review | 3 | APPROVE 7/10 after 2 revise rounds (S1–S3, N1 shell-return path, N2 fixed; N4/N5 deferred to B07B) | Claude code-logic-reviewer; codex fixes | 9ddb2f0b7 |
| B07 | 4 | done (components exported; B07B places AgentSelectionList and source/model in the shell; old Welcome kept under "Analysis and recovery options") | codex frontend-developer | e1d173fa9 |
| B07B | 4 | part 1 done (run page, checkpoint, retry, N4/N5, pre-start buffer, handoff busy check); open: bound result facts DTO, launch origin + combined countdown, store monotonic/watchdog, bound Resume -> B07C (backend) + B07D (frontend) | codex frontend-developer | de74d39d5 |
| B07C | 4 | done (new: verified bound agent result facts from the committed checkpoint for push and lookup; tabless unchanged) | codex backend-developer | 805de7457 |
| B07D | 4 | done (new: verified result panel, one-time launch origin + combined countdown, store monotonic + watchdog, bound Resume, Phase 3 M-items in open handler/launcher/restore validator; muted text token for contrast) | codex frontend-developer | f139d318f |
| P4 review | 4 | APPROVE 7/10 after 1 revise round (Part A S1-S5, M6 frontend; Part B M7, M8 backend + store/shell; N1-N5 deferred to B08/B09) | Claude code-logic-reviewer; codex fixes | (this commit) |
| B08 | 5 | pending | codex frontend-developer | — |
| B09 | 6 | pending | codex frontend-developer | — |
| B10 | 6 | pending | codex frontend-developer | — |
| B11 | 6 | pending | codex frontend-developer | — |
| B12 | 6 | pending | codex frontend-developer | — |

## Follow-ups from the Phase 2 review

- **Done with B06 (separate commit):** N1 make `generationCommitting` a local of `runWizard` (`enhanced-prompts.service.ts:712,732-738`); N4 pass `canonicalWorkspace` to `locateBound`/`isTrusted` on bound retry; N3 treat an unparseable `updatedAt` as stale.
- **B07/B08 frontend requirements:** never render `source.analysisDir`; on `preview-required` reopen the preview; call a bound preview right before submit; hide provider/model when `unknown`; offer Resume on `interrupted`; cancel-vs-completion copy must not say "nothing was written"; rely on the terminal push for guidance `timed-out` (N2, single settled slot); persist the tab id or offer "start over" for a paused run owned by a dead tab (N5).
- **Phase 3 review follow-ups for B07/B08 (Moderate/Minor):** stream events before the start RPC returns are dropped; a stale refresh can revert a terminal state; no watchdog after a failed status lookup; `GenerationHandoffStore` skips the chat-busy check and has no caller yet; the open handler drops a mismatched workspace silently and ignores the launcher result; the launcher does not re-check the active workspace after navigation; the restored-route validator can run before tabs are restored, so restore may always fall back to chat; a failed navigation leaves an empty tagged tab (reused by the next open).
- **Phase 3 re-review deferrals, owner B07B (it owns the shell; adapter added to its scope):** N4 `ensureMessage` reuses a stale ownership entry from an earlier run on the same tab, so the new run never finalizes; treat a different runId as stale, delete the entry whenever `finish()` skips, and on tab close. N5 a terminal push for a tab the shell is not bound to is dropped, so that tab stays busy until the shell binds it again; finalize by tab when the push's tab owns a message for the same run. Acceptance: A runs, user opens B, A completes, user opens A from the tab strip, A is not busy.
- **Phase 4 review follow-ups for B08/B09 (each with a spec; M1/M3/M6 may already be closed by P4R1A, check its report):** M2 countdown shows a huge number for 250 ms; M4 leaving the page cancels the countdown, against `implementation-plan.md:97`; M5 the tabless "Resume saved run" card goes stale and shows next to the bound Resume; M9 the restore validator accepts any workspace's tab while none is active (shell still shows "unavailable"); Minor m1-m6 in `code-logic-review.md` "## Phase 4 review" (unpurged event buffer, no-op Skip button, raw path in the preview warning, and others). P4R1A closed M6 only; M1 and M3 stay open. Phase 4 re-review N1-N5 (`code-logic-review.md` "## Phase 4 re-review (round 1)"): N1 corrected finalization failure keeps an error-styled transcript message, N2 retry counter reset when the binding flips undefined/defined, N3 retry error after a failed `discover()`, N4 unavailable-model rejection shows only "Start unconfirmed", N5 marker replaces `resultDetails`.
- **Size:** `wizard-generation-rpc.handlers.ts` 1736 lines, `enhanced-prompts.service.ts` 1484 lines, long `registerRunWizard`/`runWizard`; split behind their facades in a later task.

The first assignment when execution begins is B01. No batch is marked IN_PROGRESS during this decomposition-only invocation.
