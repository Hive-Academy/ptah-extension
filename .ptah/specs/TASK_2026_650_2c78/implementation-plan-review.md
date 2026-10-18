# Gate 2 cross-side review: implementation-plan.md — TASK_2026_650_2c78

Reviewer: Claude (in-process, read-only). Plan author: codex lane. No build, test or git command
was run. Plan line numbers refer to `implementation-plan.md` (237 lines).

## Verdict

**REVISE — 6/10.**

Most of the plan is strong:

- The cited evidence is accurate.
- All 35 parity rows are mapped and nothing is removed.
- The four Gate 1 minor items are resolved.
- C1 is accepted with a safe fallback.
- The run-bound Stop, lost-start and late-completion contracts follow design §2.9.

Three problems block approval:

- **Blocking.** The new RPC contracts are required and asynchronous. They silently break existing
  callers that have no tab: the Settings regenerate drawer and the published CLI.
- **Serious.** The model snapshot assumes each tab has its own provider. It does not.
- **Serious.** The entry-point launcher and the VS Code panel-to-main handoff have no named
  contract. A launcher placed in the obvious library would create an import cycle.

## Verified

These citations were opened in the worktree and hold:

**Shared RPC types and registry**

- `rpc-setup.types.ts:50-65` is `AnalysisStatus` with 7 reasons. Its `:187-202` is
  `WizardSubmitSelectionParams` with no tab or run fields. Its `:294-307` is `WizardCancelParams`,
  which is `{ saveProgress? }` only.
- `rpc.types.ts:1028-1035` and `:1193-1201` are the registry entries.
- The methods proposed as new do not match the host-source baseline pattern
  (`host-source-registry.contract.spec.ts:17-18`), so that baseline needs no exception.

**Agent generation backend**

- `wizard-generation-rpc.handlers.ts`:
  - `:240-249` is the process-wide lock.
  - `:252-355` contains `getWorkspaceRoot()`, the freshness lookup (its catch maps a failure to
    `unreadable`), and `trustedDir`.
  - `:373-390` is the background launch, so the start already returns before the run ends.
  - `:726-790` is `wizard:cancel`, which calls `this.runs.abort()` with no binding.
  - `:912-936` reads saved guidance at submit.
  - `:974-997` is `buildOptions`.
- `wizard-generation-run.supervisor.ts:172-205` holds a single `activeController`.
- `generation-checkpoint.types.ts:22-38` is checkpoint version 1. It already has `runId` and
  `analysisRunId`, and stores `input.model` with no provider.
- `analysis-freshness.service.ts:19` sets 7 days. In `:49-91`, `getStatus` catches its own
  errors and returns `unreadable`.

**Guidance backend**

- `enhanced-prompts-rpc.handlers.ts:75-82` lists METHODS with no cancel. In `:209-249`,
  `isAuthorizedWorkspace` checks the folder and `analysisData` is used without a freshness check.
- `enhanced-prompts.service.ts`:
  - `:309-335` and `:389-394` are a separate `isGenerating` lock.
  - `:406-418` is where precomputed input skips discovery.
  - `:541-577` writes the trace before the state.
  - `:828-855` holds the internal `AbortController`.

**Chat**

- `session-context.token.ts:49-53` defines `SESSION_START_GUARD`, a synchronous `() => string | null`.
- `session-embed.component.ts:60,66,84,89-91` and `index.ts:40-41` match the cited lines.
- `chat-input.component.ts`: `:487` shows Stop only while the tab streams, `:638-649` is the
  predicate, and `:1718-1725` is `handleStop` calling `abortWithConfirmation()`.
- `chat-types.ts:603-607` is `TabState.workflow` and `:873-887` holds both tags.
  `tab-manager.service.ts:949-961` is `setWorkflow` across workspaces.

**Builder pattern and routes**

- `harness-builder-view.component.ts:244` embeds with `chrome="bare"`.
- `harness-builder-view.component.ts:320-379` is the tab and workspace validation.
- `app.routes.ts:97-102` is the eager `setup-wizard` route. `app.routes.ts:118-128` is the lazy
  builder route.
- `setup-hub.component.ts:1335-1337` is `openSetupWizard()`.

**Hosts and DI**

- `MESSAGE_HANDLERS` is at `message-router.types.ts:46-51`. The router accepts several handlers
  per message type (`message-router.service.ts:104,138-142`).
- `register-shared-rpc-handlers.ts:52-58` is reached from VS Code `phase-3-handlers.ts:92`,
  Electron `phase-4-handlers.ts:105` and CLI `container.ts:863`.
- `AnalysisFreshnessService` is registered at `agent-generation/di/register.ts:103-107`.
- The supervisor is injected by class token (`wizard-generation-rpc.handlers.ts:196`). A new
  guidance supervisor written the same way needs no change in any host composition root.
- `angular-webview.provider.ts:70,87` registers `ptah.main`.

**Other checks**

- `generation-progress.component.ts:350-369` holds the cap of 3, the 1 s base delay and the
  duplicate guard. `wizard-phase-generation.ts:94-113` holds the auto-advance.
- Nx tags hold. `setup-wizard`, `chat`, `chat-ui` and `harness-builder` are
  `scope:webview,type:feature`. `eslint.config.mjs:297-298` constrains scope only. `setup-wizard`
  already imports `@ptah-extension/chat` and `chat-state`.
- **Parity.** All 35 inventory rows (`parity-inventory.md:7-41`) map to keep or move
  (plan:95-131). Plan:201-203 lists no removals.
- **Gate 1 minor items.** AC5, AC9, AC18 and AC19 are resolved at plan:185-190, apart from the
  provider gap in Finding 2.
- **Design notes.** The architect notes at `design-spec-review.md:115-116` and the minor issues
  at `:100-101` are addressed at plan:195-197.

## Findings

### 1. Blocking — required, asynchronous contracts break callers that have no tab

The plan changes these contracts:

- plan:50 makes `{tabId, workflow, ...}` mandatory on `wizard:submit-selection`, `wizard:cancel`,
  `enhancedPrompts:runWizard` and `:regenerate`.
- plan:62 makes `runWizard` and `regenerate` "return accepted `{runId,source,effectiveModel}`
  promptly".

These callers have no tab, and several wait for the final result:

- **Settings > System prompt drawer.** `libs/frontend/chat/src/lib/settings/pro-features/system-prompt-drawer.component.ts:443-475`
  awaits `enhancedPrompts:regenerate` with `{ workspacePath, force }`. It treats
  `result.data.success` as "regenerated" and then reloads the status. Under the new contract it
  would report success before anything was generated. Parity row 34 requires regenerate to
  "continue to work".
- **Published CLI.**
  - `apps/ptah-cli/src/cli/commands/prompts.ts:167-178` (`ptah prompts regenerate`) treats the
    RPC result as completion.
  - `apps/ptah-cli/src/cli/commands/setup.ts:232-236` and `apps/ptah-cli/src/cli/commands/wizard.ts:217,292,323`
    send submit-selection, cancel and retry-item without a tab.
  - `router.ts:2543` documents cancel as "idempotent, always exits 0".
- **E2E harness fixture.** `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-advanced-search-voice.fixtures.ts:190`.

None of these files appear in the handoff (plan:228-237). This is a silent behaviour change and a
breaking change to a public, headless contract. It also makes Phase 1 commit a tree that does not
compile: the required fields break typecheck in `setup-wizard`, `chat` and `ptah-cli` until later
phases, and `ptah-cli` is never updated.

### 2. Serious — the "tab provider/model" snapshot has no per-tab provider

Where the plan relies on a tab provider:

- plan:42 says "snapshot effective provider/model" and cites `chat-types.ts:751-760`.
- plan:50 and plan:155 rely on the same assumption.
- plan:190 says "effective tab provider/model".

What the code does:

- **The tab stores only a model.** `TabState` has `sessionModel` and `overrideModel` and no
  provider (`chat-types.ts:750-761`). The composer selector writes only `setOverrideModel`
  (`model-selector.component.ts:248-257`). The effective model is override, then session, then
  global (`:192-203`).
- **The provider is a connection activated for the whole workspace or globally.**
  `welcome.component.ts:376-408` calls `activateConnection(providerId, 'workspace' | 'global')`,
  so it ends sessions in other tabs.
- **Guidance resolves auth from the workspace and drops a requested model the provider lacks**
  (`enhanced-prompts.service.ts:822-827`).

Three consequences:

- A sidebar Provider select in one generation tab would change the provider of every tab.
- The countdown's "will use <provider, model>" (design §2.9.2) is not a per-tab value.
- The accepted-start "effective provider/model" can only be known after the host resolves it.

AC19 and the design's single-source snapshot invariant (design-spec.md:383) depend on this.

### 3. Serious — the entry launcher and the panel-to-main handoff have no contract; the obvious placement is a cycle

The plan covers entries only in prose: plan:67, plan:84 ("Legacy panel delegates this action to
the main host") and plan:236. It names no launcher service, no library for it and no handoff
message.

**Import cycle.** The current imports are `setup-wizard → chat`
(`analysis-transcript.component.ts:17`) and `chat → chat-ui` (`project-setup-card.component.ts:9`).
A launcher in `setup-wizard` therefore cannot be called from the chat card or the chat-ui widget
without a cycle. Phase 7 modifies both of them.

**The existing launcher does not fit.** `WorkflowTabLauncherService`
(`libs/frontend/chat/src/lib/services/workflow-tab-launcher.service.ts:26-58`) always creates a
new tab and lands on the `chat` surface. It has no find-or-focus step (needed for AC15) and no
routed page.

**Entry points the plan omits:**

- The Electron override `ElectronSetupWizardService.launchWizard`
  (`apps/ptah-electron/src/services/electron-setup-wizard.service.ts:63`, registered at
  `apps/ptah-electron/src/di/phase-2-libraries.ts:321-323`). This is the Electron path behind
  `setup-wizard:launch`.
- The VS Code command `apps/ptah-extension-vscode/src/commands/setup-agents-command.ts:46`.

**No handoff message.** The panel-to-`ptah.main` handoff that AC2 and AC17 rely on, and that
risk row plan:217 calls out, needs an RPC method or push message plus a consumer in the main
webview. None appears in the Phase 1 contract or the registry list.

### 4. Moderate — the new route needs a new surface id that no phase owns

plan:37 and plan:77 add `/setup-generation/:workflow/:tabId`. Route surfaces are typed by
`ViewType` and `SURFACE_ROUTE_IDS` in `libs/shared/src/lib/types/webview-surface.types.ts:49,70`.
`surfaceActiveFor(surface: ViewType)` reads them (`libs/frontend/core/src/lib/routing/surface-active.ts:8`),
and so do the core surface router and route persistence (`surface-routes.ts:25-31`).

- Phase 1 does not own `webview-surface.types.ts`.
- Phase 6 owns only `app.routes.ts`.

Either nest the page under the existing `setup-wizard` surface, or add the surface-id files and
specs to Phase 1. Also state whether a persisted `/setup-generation` route is restored on reload
(AC2).

### 5. Moderate — the transcript adapter and composer behaviour during a run are undefined

plan:72 converts generator events "to the shared chat message rendering path" but names no API.

The only verified way to put events into a tab is
`StreamingHandlerService.processStreamEvent(event, tabId)` (`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:190-207`).
That call also drives tab status, turn state and queued-send flushes. The composer queues sends
while busy and relies on Stop to drain them (`chat-input.component.ts:485-487`).

The plan does not define:

1. which write API the adapter uses, and how the tab's busy state ends at the run's terminal
   event;
2. what a composer send does in a generation tab during a run (a normal SDK chat reply, a queued
   send, or a disabled send);
3. what C1 does when a chat reply, not a generator run, is streaming in that tab. As written
   (plan:38), the handler could swallow the Stop for a chat reply.

### 6. Moderate — countdown store scope and reload behaviour are ambiguous

plan:79 and plan:196 say the deadline lives in "page/host state". The routed shell, like the
builder's (`app.routes.ts:118-128`), is destroyed when the user moves to another surface. Design
§2.9.2 requires the countdown to keep running while the user looks at another tab, and treats
closing the agents tab as Skip.

The plan should state:

- the store is root-provided and keyed by tab;
- it watches TabManager for tab removal so that a closed tab counts as Skip;
- what happens after a webview reload during the countdown. Recommendation: no automatic start;
  show the manual "Continue to project guidance" / "Skip guidance" pair.

### 7. Moderate — the guidance supervisor and the service each hold a lock

The plan has two lock holders:

- **Supervisor.** It "returns accepted start before awaiting service" (plan:62, 87, 218).
- **Service.** It keeps its own `isGenerating` lock (`enhanced-prompts.service.ts:309-324,389-394`),
  which the Settings regenerate path also takes.

An accepted start can therefore fail later with "Generation already in progress". In that case
blocked is never reported synchronously and a `runId` is never satisfied.

Name one lock owner: the supervisor reserves the slot through the service's own acquire. Define
what tab lookup reports while a run started from Settings or the CLI holds the lock (a blocked
state with no binding).

### 8. Moderate — retry and preview are not bound to the tab or run

`wizard:retry-item` takes `{ itemId }` only (`wizard-rpc.service.ts:159`) and replays the
process-wide `lastGenerationOptions` and `lastCheckpoint` (`wizard-generation-rpc.handlers.ts:364-365`).
The plan binds start and cancel but is silent on retry-item and `wizard:preview-generation`.

AC13 and AC15 ("generator workspace shall equal the tab workspace"; never act on another
workspace's run) apply to retry as well. Bind them, or state why they are exempt.

### 9. Moderate — AC15 for a second tab in the same workspace

plan:43 and plan:151 cover two cases: a duplicate in the same tab focuses, and a start from
another workspace is blocked. The case they miss is a second tab with the same workflow in the
same workspace.

- The entry's find-or-create step must focus the existing tab.
- The backend lookup or blocked answer must carry the owning `tabId` so the page can show or
  focus it.

### 10. Moderate — AC9's guidance-first advice is missing from the AC row

AC9 (`task-description.md:51`) requires the UI to recommend running project guidance first.
Design §2.3.1:130 and §2.4:233 specify the copy and the "Generate project guidance first"
button. That needs the agent page to read `enhancedPrompts:getStatus` before submit.

The AC9 row (plan:145) and spec map (plan:172) cover only the countdown. Add the advice and a
spec case.

### 11. Moderate — handoff sequencing leaves project tests red

Two problems:

- **Registry totality fails between phases.** Phase 1 adds the new names to `RpcMethodRegistry`
  and `RPC_METHOD_NAMES`. The manifest's "Total" invariant
  (`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:14-19`, asserted by
  `manifest.spec.ts` and `rpc-allowlist.spec.ts`) then fails for `rpc-handlers` until the METHODS
  of both Phase 2 and Phase 3 land.
- **Parallel phases share projects.** Phases 2 and 3 run in parallel on the same two Nx projects
  (`rpc-handlers`, `agent-generation`). "Then its tests" (plan:231-232) would run red or race.

Fix one of these ways:

- move the METHODS additions into one unit together with the registry;
- serialize Phase 2 before Phase 3;
- limit Phases 2 and 3 to focused Jest specs and run the project tests once, after both.

Combined with Finding 1, Phase 1 must not make fields required that later phases' consumers
still omit.

### 12. Minor — notes for the team-leader

- **Method count.** plan:233 says "both new RPC methods", but the plan adds three:
  `wizard:get-generation-run-state`, `enhancedPrompts:cancel` and `enhancedPrompts:getRunState`.
- **Spec map.** The AC7 row (plan:170) calls `completion.component.spec.ts` new. It already
  exists at `libs/frontend/setup-wizard/src/lib/components/completion.component.spec.ts`.
- **CLI guard files.** The CLI has its own guard files: `apps/ptah-cli/src/di/expected-resolvable.ts`,
  `apps/ptah-cli/src/di/container.smoke.spec.ts` and `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`.
  Phase 4 omits them. Prefer injection by class token, as `@inject(GenerationRunSupervisor)` does,
  so that no host root changes are needed.
- **Stop handler signature.** `SessionStopHandler` is unspecified. `SESSION_START_GUARD` is
  synchronous. State whether the handler is `(tabId) => 'handled' | 'not-handled'` with the
  cancel dispatched asynchronously, or returns a Promise.
- **Effective model.** Returning `effectiveModel` in the accepted guidance start means calling
  `workspaceLlm.resolveForPath` (`enhanced-prompts.service.ts:824-827`) before discovery.
- **Guidance used on resume.** `resolveRuntime` runs again on resume (`:309`, `:912-936`). Define
  `enhancedPromptsUsed` for a resumed run: the original snapshot, or what was saved at resume.
- **Phase 6 size.** Phase 6 holds about 14 new components, two stores, a route and the old
  components. Split it, for example into stores and shell, agent page, guidance page, and landing.
- **Builder shell.** State that `GenerationWorkflowShellComponent` re-implements the builder
  shell inside `setup-wizard` and imports nothing from `harness-builder` (design §3:412, §10.6).

## User-reserved items

- **Contingent.** Finding 1 can be resolved by keeping the existing callers that have no tab
  working: binding stays optional and regenerate and runWizard keep their awaited result. That
  needs no user decision. Changing the result semantics of `enhancedPrompts:regenerate` or
  `runWizard`, or requiring tab binding for `ptah prompts regenerate`, `ptah setup` or
  `ptah wizard ...`, is a breaking change to a public, headless contract. If chosen, it must go
  under `## Proposed Removals` for the user.
- Otherwise none. The plan proposes no removal, and every parity row is kept or moved.

## Lane-introduced constraints

These are lane-proposed: no input required them. The first five come from plan:205-211.

1. Every start response and generator event carries `{tabId, workflow, workspacePath, runId}`.
2. Run lookup is a first-class RPC and never returns another tab's run.
3. Client `analysisData` is structurally validated, treated as unverified, and ignored on every
   fallback.
4. There is one absolute 5-second deadline with a cleanup path.
5. Guidance has an in-memory run registry. After a reload it shows neutral wording.

Also lane-proposed, found elsewhere in the plan:

6. A separate `lookup-failed` source reason, distinct from `unreadable` (plan:56). It matches
   the AC4 table row "Freshness lookup failed", so accept it.
7. "Prefer server-read verified phase files as authoritative" over client `analysisData` for
   agents (plan:41, 220). Today `buildOptions` passes the client data as `preComputedAnalysis`
   under a trusted directory (`wizard-generation-rpc.handlers.ts:987`). This changes agent
   inputs, and the spec map has no test for it.
8. Re-preview definite targets immediately before the write, and require renewed confirmation
   (plan:56). This is a new backend step beyond the UI confirmation of AC7.
9. Guidance answers `committedState: 'unknown'` when the host has not verified that the prompt is
   unchanged (plan:62). It follows design §2.9.4.
10. An old checkpoint with no tab binds to the first authorized agent tab, after a workspace
    comparison (plan:55).
11. The accepted start carries `status: 'starting'` and the effective provider/model (plan:50).
    See Finding 2.

## Required changes for REVISE

1. **Compatibility (Finding 1).** Keep tab binding optional on `wizard:submit-selection`,
   `wizard:cancel`, `wizard:retry-item`, `enhancedPrompts:runWizard` and `:regenerate`. A call
   with no tab keeps today's semantics, including the awaited regenerate and runWizard result
   used by the Settings drawer and the CLI. The alternative is new tab-bound start methods.
   List every existing caller and its spec in the handoff:
   - the Settings drawer;
   - `apps/ptah-cli` prompts, setup and wizard;
   - the e2e fixtures.

   Make sure Phase 1 leaves every consuming project compiling.
2. **Provider (Finding 2).** Define the provider as the workspace's effective route, resolved by
   the host at submit and returned in the accepted response. Say whether the generation sidebar
   offers a provider change, and if so its scope and a warning that it affects other tabs.
   Define the "will use" value of the countdown accordingly. Keep the per-tab model as
   `overrideModel ?? sessionModel ?? global`.
3. **Entry contract (Finding 3).** Name the find-or-create-and-navigate launcher and put it in
   `chat` or a lower library, so that Hub, chat card, widget and landing can all call it without
   a cycle. Define the panel-to-`ptah.main` handoff (RPC or push message plus a `MESSAGE_HANDLERS`
   consumer) in Phase 1 and the registry. Add `electron-setup-wizard.service.ts` and
   `setup-agents-command.ts` to the file lists.
4. **Route surface (Finding 4).** Choose the surface and route shape, and assign the
   `webview-surface.types.ts`, core router and persistence files to a phase.
5. **Chat behaviour (Findings 5 and 6).** Specify:
   - the adapter's write API and how the tab's busy state ends;
   - what a composer send does during a run;
   - that C1 answers not-handled when no bound run is active;
   - that the countdown store is root-scoped, how tab close is detected, and what happens on
     reload during the countdown.
6. **Locks and binding (Findings 7-9).** Name a single guidance lock owner and say how a start
   from Settings or the CLI appears in lookup. Bind or explicitly exempt retry-item and preview.
   Cover a second tab in the same workspace for AC15.
7. **AC9 and sequencing (Findings 10-11).** Add the guidance-first advice to the AC9 row and spec
   map. Re-sequence Phases 1-3 so that registry totality and project tests are green at each
   commit.

## Re-review (round 1)

Scope: the round 1 revision only. That is the changelog at plan:3-14, Decisions (plan:50-59),
components 1-6 (plan:63-98), Integration (plan:100-107), the AC table and spec map
(plan:151-201), the Gate 1 and design notes (plan:203-217), Deferred review notes (plan:219-221)
and the handoff (plan:246-260). D10 (`decisions.md:13`) was read: tab binding stays optional on
the existing RPCs. This was a read-only review; nothing was built or tested.

### Verdict

**APPROVED — 8/10.**

- All seven required changes are resolved.
- The new launcher placement has no import cycle.
- The commit sequence keeps every consuming project compiling. The registry stays total at each
  commit.
- The revision adds no removal and no breaking change.

Two new Moderate issues and several Minor notes remain. They are implementation-level and go to
the team-leader as acceptance criteria for the relevant batches. They are not plan blockers.

### Per required change

**1. Tabless compatibility — resolved.**

- **Contract.** D10 is applied at plan:57 and plan:65. The optional atomic `tabBinding` covers all
  five existing methods. Today's required result fields (`success`, `cancelled`) are kept. The
  `accepted` payload exists only on calls with a tab, and tabless `runWizard`/`regenerate` still
  wait for the final result (plan:78).
- **Retry.** A tabless `retry-item` keeps the old path (plan:72).
- **Callers.** Phase 7 makes the existing callers a regression gate and forbids editing them for
  binding (plan:258). All of them exist:
  - `system-prompt-drawer.component.ts:443-475` and its `.spec.ts`;
  - `apps/ptah-cli/src/cli/commands/prompts.ts:167-178`, `setup.ts:232`, `wizard.ts:217,292,323`
    and their three `.spec.ts` files;
  - `settings-advanced-search-voice.fixtures.ts:190` and its `.e2e.spec.ts`.
- **Commit safety.** Phase 1 adds only optional types and typechecks every consuming project one
  at a time, including `ptah-cli`, `cli-engine` and the e2e harness (plan:252).

**2. Provider from the workspace route — resolved.**

plan:55 states the verified facts:

- `TabState` stores only `overrideModel` and `sessionModel` (`chat-types.ts:750-761`).
- The model precedence is in `model-selector.component.ts:192-203`.
- The provider comes from workspace activation (`welcome.component.ts:376-408`).

The revised contract follows from those facts:

- The sidebar offers only workspace-scoped activation, with a warning that it affects other tabs.
  A global route is shown read-only.
- The host resolves the effective provider and model before the accepted answer and snapshots
  both.
- The countdown previews the guidance tab's model and the workspace route. The host re-resolves
  at submit (plan:97).

AC19 (plan:173) and its specs (plan:200) follow. The design drift is recorded honestly (plan:221);
see note N4.

**3. Launcher and panel handoff — resolved.**

- **Launcher.** `GenerationWorkflowLauncherService` lives in `chat-ui` (plan:58, 83), with
  find-or-create, background creation for the automatic start, and focus for duplicates. The
  narrow `TabManagerService` additions are backed by real anchors: `createTab` at
  `tab-manager.service.ts:979`, and `findBackgroundTabIds` and `addTabToWorkspace` at
  `tab-workspace-partition.service.ts:353,422`.
- **Panel handoff.** A typed `SETUP_GENERATION_OPEN` push is added next to the existing
  constants: `message-constants.ts:199-204` (alongside the `HARNESS_OPEN_WORKFLOW` precedent),
  `message-type.ts:95` and `payload-map.ts:402`. The host side uses `focusChat()`, which is on
  the platform-core port (`platform-abstractions.interface.ts:36`; VS Code at
  `vscode-platform-commands.ts:26`). It then calls `WebviewManager.sendMessage('ptah.main', …)`,
  which returns a delivery boolean (`webview-manager.ts:192-222`).
- **Other entry points.** The Electron override is covered at
  `electron-setup-wizard.service.ts:63-92`; its `SWITCH_VIEW` landing is kept. The VS Code
  command is covered at `setup-agents-command.ts:34-51`. Both are in Phase 3 (plan:254).
- **Naming.** The new message name does not match the host-source pattern
  (`host-source-registry.contract.spec.ts:17-18`), so no baseline exception is needed.

**4. Route surface — resolved.**

The route is a child of the existing surface: `/setup-wizard/generation/:workflow/:tabId`
(plan:50, 95). `navigateToSurface(id, subPath)` already supports sub-paths
(`surface-router.service.ts:110-155`, with marketplace as the precedent). So `ViewType` and
`SURFACE_ROUTE_IDS` (`webview-surface.types.ts:49,70`) need no change, and Phase 1 owns that
file's spec as a reviewed surface that does not change.

The route and persistence files exist (`libs/frontend/core/src/lib/routing/surface-routes.ts`,
`surface-router.service.ts`, `surface-route-persistence.ts` and their specs) and are owned by
Phase 3. Restore re-validates the tab, workspace and tag (plan:50). With no
`RouteReuseStrategy` (`app.routes.ts:44`), the routed page is destroyed on navigation. That is
why the root handoff store below is required.

**5. Transcript, composer, C1 and countdown lifetime — resolved, with new issue 1.**

- **Transcript.** The adapter names
  `StreamingHandlerService.processStreamEvent(event, tabId, undefined, {fanOut:false})`
  (`streaming-handler.service.ts:190-207`).
- **Composer.** Sends are blocked during a bound run, nothing is queued, and a lost terminal
  event is recovered through lookup (plan:90).
- **C1.** `SessionStopHandler` is synchronous and returns `'handled' | 'not-handled'`; it returns
  `not-handled` when no bound run exists (plan:51, 89).
- **Countdown.** The deadline lives in the root, tab-keyed `GenerationHandoffStore`. Closing the
  tab counts as Skip, and a reload never starts guidance automatically; it shows manual
  Continue/Skip (plan:97, 214).

**6. Single lock owner, retry/preview binding, second tab in the same workspace — resolved.**

- **Lock.** The service stays the only owner of the guidance lock. An atomic acquire runs before
  the accepted answer and hands the reservation to the run, which releases it in `finally`. A
  run from Settings or the CLI shows as blocked with no binding (plan:56, 78).
- **Retry.** Tab-bound `retry-item` requires the owner tab, workspace and run ID, and stops
  depending on `lastGenerationOptions` (plan:72).
- **Preview.** Preview is exempt from run binding with a stated reason (it runs before any run)
  but keeps workspace authorization (plan:72).
- **Second tab.** A second tab in the same workspace gets `ownerTabId` only and is focused by the
  launcher (plan:73, 169, 196).

**7. Guidance-first advice and safe staging — resolved.**

- **AC9 advice.** It is in the AC9 row (plan:163), the spec map (plan:190) and plan:206. It
  matches the design's guidance hint (`design-spec.md:130`, §2.3.1a).
- **Phases 1-3.**
  - Phase 1 is additive only and adds no registry names.
  - Phase 2 lands all three names, every handler `METHODS` list, the manifest and the guard specs
    in one serial backend commit. This satisfies the totality invariant
    (`host-profile/manifest.ts:14-19`).
  - Phase 3 lands the runnable shell.
- **Later phases.** Phases 4 and 5 share `setup-wizard` and run serially. Phase 6 is the only
  parallel unit and its projects are disjoint (`harness-builder`, `chat`, `chat-ui`) (plan:248-257).

**Cycle check under Nx tags.**

- `eslint.config.mjs:297-298` constrains scope only, and all the projects involved are
  `scope:webview`.
- `chat-ui` today imports `chat-streaming`, `chat-types`, `core`, `ui`, `shared`, `markdown` and
  `declarative-dashboard`. The new edge `chat-ui → chat-state` is acyclic: `chat-state` imports
  only `chat-types` and `shared`, and no project in `chat-ui`'s dependency closure imports
  `chat-ui`.
- `harness-builder → chat-ui` already exists. The new edge `setup-wizard → chat-ui` is safe
  because `chat-ui` does not import `setup-wizard`.
- No `chat-ui → chat` or `chat-ui → setup-wizard` edge is introduced.

**Deferred review notes (plan:219-221).** The only item deferred is the correction of the
per-tab Provider select in `design-spec.md` §2.9.3. The reason holds: the lane was authorized to
write only `implementation-plan.md`, and the plan's Decision governs in the meantime. No required
or Moderate finding was deferred.

### New issues

**1. Moderate — synthetic turn state and session id can corrupt later chat in the tab.**

Location: plan:89-90.

Synthetic busy and terminal turn-state events go through `TurnStateApplier`, which keeps a
per-tab and per-session revision floor (`turn-state-applier.service.ts:22-34,87-140,175-185`). A
synthetic revision can then cause the first real chat turn's non-terminal events in that tab to
be dropped as stale.

Separately, `processStreamEvent` sets `claudeSessionId` from the first streamed event
(`tab-manager.service.ts:998`). If a forwarded flat event still carries the generator's internal
SDK `sessionId`, the tab would bind to that session, and later composer sends would continue the
generator's internal query. The plan forbids attaching the run ID, but not this internal session
id.

Acceptance criteria for the team-leader:

- the adapter strips or replaces `sessionId` on every forwarded event;
- synthetic turn states use a revision scheme that cannot raise the floor for the tab's real chat
  session, or the busy state is held by the generator store and surfaced through C1 and the
  existing `SESSION_START_GUARD`;
- a spec proves that a normal chat turn after a generator run streams and clears correctly.

**2. Moderate — the panel closes on transport delivery, not on main-app acceptance.**

Location: plan:84.

`WebviewManager.sendMessage` returns the `postMessage` result (`webview-manager.ts:218-222`). That
only shows the webview was live. It does not show that the Angular `MESSAGE_HANDLERS` consumer
received or acted on the message. Right after `focusChat()` resolves the view, the app may not
have bootstrapped yet. `WebviewManager` does not buffer messages until ready, so the push can be
lost after `true` and the panel then closes, which strands the user.

Acceptance criterion: either keep the panel open until the main consumer acknowledges (for
example through a small acknowledgement message or RPC handled by `SetupWizardService`), or never
close the panel automatically and leave Close to the user.

**3. Minor — notes for the team-leader.**

- **N1. Specs that do not exist yet.** These are listed as if they exist but must be created:
  - `apps/ptah-electron/src/services/electron-setup-wizard.service.spec.ts`
  - `apps/ptah-extension-vscode/src/commands/setup-agents-command.spec.ts`
  - `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.spec.ts`
  - `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.spec.ts`
- **N2. Provider scope wording.** plan:208 (AC19) says provider activation has "workspace/global
  scope". plan:55 says only workspace activation is offered and global is read-only. Use plan:55.
- **N3. Background tab creation can fail.** `addTabToWorkspace` refuses when the target
  partition is not loaded, and it needs `afterTabId` (`tab-workspace-partition.service.ts:417-425`).
  `createWorkflowTabForWorkspace` must report `failed`, and the handoff must then fall back to the
  manual Continue/Skip.
- **N4. Design drift.** The orchestrator should route the §2.9.3 provider wording correction to
  the design owner. The new composer rule (Send blocked during a bound run; chat Stop visible
  for the whole run through the busy state) also departs from `design-spec.md:423` ("no change
  to ChatInput visibility rules"). Record both as accepted architect deviations.
- **N5. Reuse the start guard.** The composer block can use the existing `SESSION_START_GUARD`
  input. Its reason is shown at send time and checked before queueing (`chat-input.component.ts:1641-1642`).
  The only chat-input change then remains C1.
- **N6. Tabless cancel.** A tabless `wizard:cancel` keeps its legacy "abort the active run"
  meaning, as D10 requires. State in the handler that this can also stop a bound run in the same
  host, and show it on the page through run lookup as `cancelled`.
- **N7. Phase 3 size.** Phase 3 is one integrated commit across about 9 projects. Keep its checks
  strictly serial, typecheck before tests, as plan:254 already says.

### User-reserved items

None. D10 keeps every existing caller's semantics, the plan proposes no removal, and the revision
introduces no breaking change to a public or headless contract.

### Lane-introduced constraints

These are lane-proposed in this revision, beyond the inputs and D10:

1. Provider activation from the generation sidebar is workspace-scoped only, with a warning that
   it affects other tabs. A global route is read-only (plan:55).
2. A generation start requires the tab's chat turn to be idle with no queued content. Normal Send
   is disabled during a bound run (plan:90).
3. `SessionStopHandler` is synchronous and returns `'handled' | 'not-handled'` (plan:51).
4. A webview reload during the countdown never starts guidance automatically (plan:97). This
   fills a design gap and is accepted as reversible.
5. A blocked start in the same workspace exposes `ownerTabId` only and never the owner's run ID
   (plan:67, 73).
6. `wizard:preview-generation` is exempt from run binding but keeps the workspace check (plan:72).
7. `enhancedPromptsUsed` is recomputed at a resume submit, while an item retry reuses the
   snapshot (plan:72).
8. The panel closes only after `sendMessage` returns `true` (plan:84). See new issue 2.

### Required changes for round 2

None. Fold new issues 1 and 2 into the acceptance criteria of the relevant batches: Phase 3 for
the adapter and the panel handoff, Phase 7 for the chat regression check.
