# Implementation Plan - TASK_2026_ONBOARDING

Worktree: `/home/amun/ptah-extension/.claude-worktrees/onboarding-module` (branch `feat/onboarding-module`).
All paths below are relative to that worktree root unless absolute.

## Inputs and constraints

- Requirements used: `context.md` (user decisions, design gate), `design-spec.md` (revision 2),
  `prototype/index.html` + `prototype/README.md`, `parity-inventory.md`, `backend-contract.md`,
  `design-spec-review.r2.md`.
- Corrections applied (source and user decisions outrank the spec where they disagree):
  1. Spec §3.2 A4 says "Legacy auto-generate step: removed" and §6 says "manual-adjust placeholder
     removed". Both contradict the user's design-gate ruling (`context.md:28-30`, spec §7 items 1-2:
     **kept**). This plan keeps both: the legacy enhancement step is A4's pre-run/auto-start state,
     and "Manual adjust" stays on A1's completed state with its coming-soon modal.
  2. Review r2 blocker (redirect cancel) is applied as the navigation-id tracker in Contracts §C3.
  3. Review r2 non-blocking 1 (storage availability probe + in-memory suppression) and 3 (absence
     rules; `fileName` vs `filePath`) are adopted. Non-blocking 2 is prototype-only, not applicable.
  4. Bound guidance runs are fire-and-forget: `enhancedPrompts:runWizard` with `tabBinding` delegates
     to `startBoundGuidance` (`enhanced-prompts-rpc.handlers.ts:262`) and returns only the
     `accepted` acknowledgement (`:624`), never `summary`. **User ruling D9 (2026-10-27,
     `context.md` "Plan gate")**: guidance stays bound (Stop, reload, owner conflict kept). After
     confirmed completion of the current bound run the UI reads the existing
     `enhancedPrompts:getPromptContent` RPC (`enhanced-prompts-rpc.handlers.ts:907-950`), drops
     the prepended core prompt (`enhanced-prompts.service.ts:891-901`), isolates the
     `## Project-Specific Guidance` region and counts words in the four canonical sections written
     by `buildCombinedPrompt` (`:1460-1482`) with the backend whitespace rule (`:1408-1409`).
     This replaces the spec §3.6 rule "sections only from the retained final `runWizard`
     response": the user's D9 ruling authorizes content-derived counts as the source. The spec's
     reload rule still holds (counts omitted after a webview reload, never fabricated).
     `detectedStack` comes from `enhancedPrompts:getStatus` (`rpc-setup.types.ts:481`).
     User-approved losses: `totalTokens`, the `usedFallback` badge and the Quality Guidance row.
- Design handoff used: `design-spec.md` §1-§10 (component names used verbatim), prototype.
- Missing decision-critical input: none. D9 was decided by the user on 2026-10-27.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Route table lives in the app, not a lib; `chat` is component-less with `''` and `:tabId` children | `apps/ptah-extension-webview/src/app/app.routes.ts:81-98` | `onboardingFirstRunGuard` goes on this route as `canActivate`; `/onboarding` is a `loadChildren` entry in the same file |
| Old routes and their static imports | `app.routes.ts:9-12`, `:99-112`, `:127-162` | Deleted at cut-over (B5b) |
| `**` and `''` redirect to `DEFAULT_SURFACE_ID` (`chat`) | `app.routes.ts:231-232`; `webview-surface.types.ts:109` | A `canMatch` returning `false` would fall through to `**` → chat; a `canMatch` returning a `UrlTree` would also redirect. `canActivate` returning a `UrlTree` is chosen (D4) |
| Lazy libs with eager message handlers use a narrow secondary entry exempted from the dynamic-import lint | `eslint.config.mjs:258-287`; `libs/frontend/harness-builder/src/services.ts:1-31`; `tsconfig.base.json:202-206` | New lib gets `@ptah-extension/onboarding` (lazy routes) + `@ptah-extension/onboarding/services` (eager guard, flag, tracker, focus router) added to `checkDynamicDependenciesExceptions` |
| `scope:webview` libs depend only on `scope:shared`/`scope:webview`; `type:feature` may depend on feature/data-access/ui/util/core | `eslint.config.mjs:298-300`, `:408-416` | New lib tags `scope:webview`, `type:feature` (same as `setup-wizard`, `harness-builder` project.json) |
| Only the webview app imports `setup-wizard` / `harness-builder`; neither imports the other | grep of `@ptah-extension/(setup-wizard|harness-builder)` → `app.config.ts`, `app.routes.ts`, 3 app specs, 1 e2e spec | Onboarding can depend on both with no cycle as long as neither depends on onboarding |
| `setup-wizard` is eager (wide barrel in `app.config.ts`) because it hosts `MESSAGE_HANDLERS` | `app.config.ts:90-107`, `:240-248`, `:394-397` | Its stores stay where they are; onboarding reuses them |
| Surface id registry, legacy alias pattern (`orchestra-canvas`) | `libs/shared/src/lib/types/webview-surface.types.ts:44-57`, `:67-80`, `:93`, `:103-106`, `:123-128` | Legacy ids follow the existing alias pattern: kept as wire-legal `ViewType` members, removed from `SURFACE_ROUTE_IDS`, mapped by a target table (D3) |
| Host-side validation uses the shared predicate | `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:125-131` | Aliases stay accepted by the host with no host code change; only its spec changes |
| Renderer normalisation points | `libs/frontend/core/src/lib/services/app-state.service.ts:361-371` (`SWITCH_VIEW`), `:638-640` (`normalizeView`), `:788-798` (`normalizeInitialView`), `:980-991` (`setCurrentView`) | All three route through one `resolveSurfaceAlias` |
| `setup-hub` is a global configuration surface | `app-state.service.ts:60-70`, `:86-88`, `:405-413` | `onboarding` replaces `setup-hub` in `ConfigurationSurfaceId` (remounted on workspace switch, `electron-shell.component.ts:534-550`) |
| Saved-route restore rejects non-surface first segments and colons in query | `surface-router.service.ts:181-207`; `webview-route-state.ts:41-63`, `:127-142` | Legacy saved routes are rewritten to `/onboarding` before `navigateToUrl`; query ids must be colon-free (tab ids are UUIDs, `branded.types.ts:195-196`) |
| Generation tab validation is path-segment based today | `surface-routes.ts:35-65`; consumers `surface-router.service.ts:188-196`, `surface-route-persistence.ts:78-85`; validator wired `app.config.ts:232-238` | Replaced by a query-param binding parser (same validator token, same workflow/workspace rule) |
| `navigateToSurface` has no query support | `surface-router.service.ts:137-164` | Extend `extras` with `queryParams`; all onboarding navigation goes through it |
| Restored-route boot compares first segments and falls back to the host view on mismatch | `apps/ptah-extension-webview/src/app/initial-navigation.ts:117-125` (comparison at `:121`; `:78-89` is the host-surface fallback, not this branch) | Without a fix, a restored `/chat` redirected to `/onboarding` would be treated as a failed restore, re-navigate to chat after `shownAt` is committed, and hide onboarding (Risk R2). Fixed in B1 |
| Angular cancellation codes | `node_modules/@angular/router/fesm2022/_router-chunk.mjs:1879-1883` (v22.2.3) | Tracker keys on `NavigationCancellationCode.Redirect` vs others |
| Post-auth redirect to Settings only when still on chat and nothing pending | `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:290-305` | First-run redirect wins over the no-credential Settings redirect (Risk R5) |
| Focus routers: two per-surface services, token kind union | `setup-wizard-focus-router.service.ts:6-33`; `harness-builder-focus-router.service.ts:6-30`; `libs/frontend/core/src/lib/tokens/surface-focus-router.token.ts:4-8`; consumer only calls `canFocus` (`chat-attention-source.service.ts:185-187`) | Merge into one `OnboardingFocusRouter`; change token kind to `'onboarding' \| 'mcp-apps'` |
| Generation launcher navigates to the old path | `libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.ts:78-82` | Change target to the core onboarding URL builder; launcher stays the single tab-ownership entry |
| Harness first send waits for embed visibility | `harness-workflow-request.service.ts:430-441`; registration only by `session-embed.component.ts:130-135` | Headless controller registers visibility itself (precedent: `command-center-turn-status.ts:38-70`) and sends by explicit `tabId` (`message-dispatch.service.ts:181-229` resolves the target tab from `options.tabId`) |
| Harness builder navigation | `harness-workflow-request.service.ts:351-364` | Re-pointed to `/onboarding/<mode>/workspace?tab=` |
| Harness records: zod-validated localStorage records keyed by root+tab, drafts per mode, stack profile | `harness-builder-records.service.ts:13-131`, `:132-260` | Controller record is a new record kind in this service (spec §3.5.4 "extend existing machinery") |
| Proposal hydration folds revisions but exposes only the final config | `harness-proposal-hydration.service.ts:135-150`, `:155-216`, `:318-332` | Add a read-only ordered `revisions` signal with folded snapshots for "Revision n", New/Changed tags and restore |
| `HarnessProposalRevision` has a stable `id` | `libs/shared/src/lib/types/rpc/rpc-harness-proposal.types.ts:4-12` | Revision ordinal = display index of the stable id (spec §4) |
| `HarnessStartNewProjectResult` | `libs/shared/src/lib/types/rpc/rpc-harness.types.ts:518-531` | Intake facts; already persisted as the stack-profile record (`records.writeStackProfile`, `harness-workflow-request.service.ts:404-421`) |
| `HarnessWorkflowPromptParams` (`contextOnly`) | `rpc-harness.types.ts:533-546` | Team-builder preamble; user's intent is the visible first message |
| `HarnessApplyResponse { appliedPaths, warnings }` | `rpc-harness.types.ts:328-331` | Apply receipt stored on the controller record |
| Generation store binds one tab at a time and refreshes from authoritative run state | `generation-workflow.store.ts:68-85`, `:267-300` | Rebind by `?tab` on page entry; add optional expected `runId` from `?run` |
| Run lifecycle, binding, rejection with `ownerTabId`, terminal facts | `rpc-setup.types.ts:14-23`, `:32-39`, `:54-63`, `:65-96`, `:98-108` | Field sources for A3/A4 and the owner-conflict banner |
| Resumable discovery returns one latest pair | `rpc-setup.types.ts:316-341` | Resume banner limited to that pair + bound tabs + harness records |
| Guidance status carries `detectedStack` | `rpc-setup.types.ts:473-489` | Stack shown after reload |
| Handoff store auto-starts guidance in a background tab but does not expose the tab/run | `generation-handoff.store.ts:40-52`, `:68-80`, `:89-131` | Expose the started guidance binding so A3 can route to A4 with identity |
| Analysis runner owns single-flight analyze/resume/cancel | `wizard-analysis-runner.service.ts:80-120`, `:132-160`, `:220-240` | Reused by A1 |
| Scan progress payload: phase statuses and counts | `libs/shared/src/lib/types/wizard/phase.ts:51-79`, `:81` | PhaseList data |
| Setup status store (status chips, retry, folder) in `chat-ui` | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status.store.ts:9-60`, `:112-125` | Home tile chips reuse it. `setup-wizard:launch` RPC is still called here, so only the unused `WizardRpcService.launchWizard` facade is removable (removal item 3) |
| Root streaming flush is gated on the chat surface | `app.config.ts:189-191`; `batched-update.service.ts:42`, `:162-180`, `:279-286` | Off-chat, live tokens do not flush; turn-end finalization drains. The dock shows the last finalized assistant turn (spec §3.3 says exactly this) |
| Electron menu entry and selector | `electron-shell.component.ts:288-306`, `:616-618`; `global-config-actions.component.ts:84-92` | Re-point to `onboarding`, label "Setup", keep `data-test="config-menu-item-setup-hub"` |
| harness-builder main barrel exports no sidebar sections | `libs/frontend/harness-builder/src/index.ts:1-18`; sections declared at `components/sidebar/builder-session-section.component.ts:52`, `builder-stack-profile-section.component.ts:116`, `builder-apply-section.component.ts:196`, `builder-ai-helpers-section.component.ts:208`, `builder-presets-section.component.ts:148` | Additive exports land in the batch before their first consumer (Batch order table) |
| setup-wizard barrel lacks the stores/runner the pages need | `libs/frontend/setup-wizard/src/index.ts:1-52` (no `WizardAnalysisRunner`, `findBoundGenerationTab`, `GuidanceGenerationStore`, `GuidanceResultPanelComponent`); has `AnalysisTranscriptComponent`, `ConfirmationModalComponent`, `EnhancedPromptsSummaryCardComponent` (`:37-40`) | B3a/B3b add exports in the same batch as their first consumer |
| `SessionEmbedComponent` is public from `@ptah-extension/chat` | `libs/frontend/chat/src/lib/components/templates/session-embed.component.ts:53`; consumer precedent `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:11` | DetailsLog (B2) needs no new export |
| Old focus routers implement the token with legacy kinds | `setup-wizard-focus-router.service.ts:7` (`'setup-wizard'`), `harness-builder-focus-router.service.ts:7` (`'harness-builder'`); token union `surface-focus-router.token.ts:5` | B5a widens the union; B5b narrows it in the batch that deletes both routers |
| Harness request service navigates to the old surface | `harness-workflow-request.service.ts:351-364` (`navigateToSurface('harness-builder', [mode, tabId])` at `:355`) | Target switch owned by B5a, after B4b creates the pages |
| Webview routing spec asserts legacy landing | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:368-380` (`initialView: 'setup-wizard'` → `/setup-wizard`), `:90-97` loop over `SURFACE_ROUTE_IDS` | Must migrate in B5a, the batch that changes that behaviour |
| Guidance content RPC and store reset | `rpc.types.ts:1253-1256` (`{ workspacePath } → { content: string \| null; error? }`); handler `enhanced-prompts-rpc.handlers.ts:907-950`; service `getFullCombinedPromptContent` = `${PTAH_CORE_SYSTEM_PROMPT}\n\n${enhanced}` (`enhanced-prompts.service.ts:891-901`), null when disabled/absent; facade `WizardRpcService.getEnhancedPromptContent` (`wizard-rpc.service.ts:521`); `GuidanceGenerationStore.refreshCommitted` clears `content` when `generatedAt` changes (`guidance-generation.store.ts:174-200`) | D9 section counts read through the existing facade; `generatedAt` keys staleness |
| Canonical guidance layout and word rule | `buildCombinedPrompt` writes `## Project-Specific Guidance` then `### Project Context` / `### Framework Guidelines` / `### Coding Standards` / `### Architecture Notes`, each only when non-empty, joined by `\n` (`enhanced-prompts.service.ts:1460-1482`); summary rule `text.split(/\s+/).filter(Boolean).length` (`:1408-1409`), Quality Guidance only in the summary (`:1434-1440`); the core prompt has no `## Project-Specific Guidance` line (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` headings) | Pure parser spec in C6 |
| Completed-guidance status already excludes uncommitted and restored runs | `guidance-generation.store.ts:151-166` (`completed` without `committed`/`unchanged` → `failed`; restore of a terminal run → `idle`) | "Confirmed completion" = store status `completed` for the bound run id |
| Summary card shows fallback badge and tokens | `enhanced-prompts-summary-card.component.ts:43-52`, `:90-95`, input `:103` | Card narrowed to `sections` only (D9) |
| Handoff already starts guidance itself | `generation-handoff.store.ts:122-126` (`startBoundGuidance`) | A4 rebinds a started run before any auto-start |
| `verify.mjs -p` runs only the listed projects; default targets `lint,test,typecheck` | `scripts/verify.mjs:79-88` | Per-batch matrix must list every dependent project explicitly |
| Host test targets depend on builds | `npx nx show project`: `ptah-tui` test `dependsOn: ["build"]` (`apps/ptah-tui/project.json:110-121`); `ptah-electron` test → `build-main`, 4 worker builds; `ptah-extension-vscode` test → `build-esbuild`; `ptah-cli` test → `build-esbuild` + 3 worker builds; `ptah-video-studio`, `ptah-electron-e2e` have no `test`; `ptah-extension-vscode-e2e` has only `lint` | These projects get `-t lint,typecheck` only; their touched specs run as single-file Jest under the lock |
| Host launchers | `apps/ptah-electron/src/services/electron-setup-wizard.service.ts:78-80`; `libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts:153` | String-literal destination change only (permitted by spec §1.3) |
| Wizard completion closes the VS Code wizard panel | `completion.component.ts:512-516` (`SETUP_WIZARD_COMPLETE`) | A5 "Open chat" keeps posting this message so the VS Code dedicated panel still closes |
| Localstorage precedent with try/catch | `harness-builder-records.service.ts` private `read`/`write` (~`:286-320`); `app-state.service.ts:761-775` | Flag service uses the same guarded `globalThis.localStorage` pattern |

## Architecture

### A1. Library placement: NEW lib `libs/frontend/onboarding`

- **Chosen:** a new lib `@ptah-extension/onboarding` (tags `scope:webview`, `type:feature`) that owns
  routes, pages, presentational components and the per-flow stores. `setup-wizard` and
  `harness-builder` stay as the data/service libraries (and host the reused components); their view
  components are deleted.
- **Dependency direction (enforced):**
  `ptah-extension-webview (app)` → `onboarding` → {`setup-wizard`, `harness-builder`, `chat`,
  `chat-ui`, `chat-state`, `core`, `shared`}. `setup-wizard` and `harness-builder` must never import
  `onboarding`. Everything an eager handler inside those two libs needs (URL building, the harness
  session controller) therefore lives in `core` or in `harness-builder`, not in `onboarding`.
- **Two entry points** (mirrors `harness-builder/services` and the lint exemption at
  `eslint.config.mjs:279-287`):
  - `@ptah-extension/onboarding` → `src/index.ts`: exports only `ONBOARDING_ROUTES`. Reached only
    through `loadChildren` in `app.routes.ts`.
  - `@ptah-extension/onboarding/services` → `src/services.ts`, staged so it never names a file that
    does not exist yet: **B1** exports `OnboardingFlagService`, `OnboardingFirstRunTracker`,
    `onboardingFirstRunGuard`, `provideOnboardingFirstRun()`; **B5a** adds `OnboardingFocusRouter`,
    `provideOnboardingFocusRouter()` in the same batch that creates `src/lib/focus/*`. Imported
    statically by `app.routes.ts`, `app.config.ts` and `initial-navigation.ts`. Added to
    `checkDynamicDependenciesExceptions`.
- **Why not restructure `setup-wizard` + `harness-builder`:** both are eager-graph (`setup-wizard`
  via `app.config.ts:101-107`) or eager-subpath (`harness-builder/services`) libraries holding
  `MESSAGE_HANDLERS` services. Moving the new UI into either would put the whole onboarding UI into
  the initial bundle (setup-wizard) or merge two unrelated libs. A new lazy lib keeps the UI out of
  the initial bundle and leaves the handler wiring untouched. Rejected alternative recorded in D1.
- **Exception, justified by dependency direction:** `HarnessSessionController` (spec §5 lists it under
  the new lib) lives in `harness-builder` because `HarnessWorkflowRequestService` (driven by the eager
  `HarnessWorkflowMessageHandler`, `harness-workflow-message.handler.ts:62-83`) must start sessions
  for `harness:open-workflow`. Placing it in onboarding would require `harness-builder` →
  `onboarding`, a cycle. Spec §3.5 leaves the code shape to the architect.

### A2. Routes

`apps/ptah-extension-webview/src/app/app.routes.ts` (the real route file):

```ts
{ path: 'chat', canActivate: [onboardingFirstRunGuard], providers: [...existing], children: [...existing] },
{ path: 'onboarding',
  providers: [{ provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('onboarding') }],
  loadChildren: () => import('@ptah-extension/onboarding').then((m) => m.ONBOARDING_ROUTES) },
```

`libs/frontend/onboarding/src/lib/onboarding.routes.ts` (`ONBOARDING_ROUTES`), shell
`OnboardingShellComponent` as the parent component, all children lazy-free (same chunk):

| Path (under `/onboarding`) | Component | Route providers | Query identity read (via `withComponentInputBinding`, `app.config.ts:220-226`) |
| --- | --- | --- | --- |
| `''` | `OnboardingHomeComponent` | — | none |
| `analyze` | `AnalyzeWorkspacePage` (A1) | — | `analysis?` |
| `analyze/agents` | `ChooseAgentsPage` (A2) | — | `analysis?`, `source?` (`catalog`), `tab?` (lane constraint L1) |
| `analyze/generate` | `GenerateAgentsPage` (A3) | — | `tab`, `run?` |
| `analyze/guidance` | `ProjectGuidancePage` (A4) | — | `tab`, `run?`, `gen?` |
| `analyze/done` | `AnalyzeDonePage` (A5) | — | `gen?`, `tab?` |
| `guidance` | `ProjectGuidancePage` with `data: { standalone: true }` (2-step stepper) | — | `tab`, `run?` |
| `new-project` | parent, `providers: [ProposalFlowStore, { provide: HARNESS_FLOW_MODE, useValue: 'new-project' }]` | children below | — |
| `new-project` → `''` | `NewProjectIntakePage` | | `draft?` |
| `new-project` → `workspace` | `ProposalWorkspacePage` | | `tab` |
| `new-project` → `review` | `ReviewApplyPage` | | `tab`, `rev?` |
| `team-builder` | same parent shape, `HARNESS_FLOW_MODE = 'configure-harness'` | children: `''` → `TeamBuilderStartPage`, `workspace`, `review` | same |
| `**` | redirect `''` | | |

Rules carried by every page: route change focuses the page `h1` (`tabindex=-1`) through
`OnboardingFocusService`; every forward/backward step link is built by `onboardingStepLink(from, to,
identity)`, which writes an explicit, complete `queryParams` object (never
`queryParamsHandling: 'merge'`, which would carry a stale `run` across owners); `tab` is never
rendered as text. Identity rules per transition:

| Transition | Query written |
| --- | --- |
| Within one owner (A1↔A2, A2↔A3, proposal workspace↔review) | that owner's keys copied (`tab`, `run`, `rev`, `analysis`, `source`) |
| Agent → guidance (A3 → A4, handoff) | `tab` = guidance tab, `run` = guidance run id if known (else omitted), `gen` = the agent tab; the agent `run` is dropped |
| Guidance → done (A4 → A5) | `gen` kept, `tab` = guidance tab; `run` dropped |
| Backward from A4 to A3 | `tab` = `gen`, `run` omitted (A3 rebinds the authoritative run, A5 table) |

### A3. Onboarding flag service and first-run guard

- `OnboardingFlagService` (root, `services` entry) reads/writes `localStorage['ptah.onboarding.v1']`
  through a guarded `globalThis.localStorage` wrapper (same pattern as
  `harness-builder-records.service.ts`), parsed with a zod `strictObject` of three optional ISO
  datetimes. It probes storage availability once at construction (`setItem`/`removeItem` of a probe
  key, review r2 NB1). A failed probe or read makes `isFirstRunEligible()` false (no redirect, never a
  loop). A failed late `markShown()` sets an in-memory `suppressed` flag so chat stays reachable for
  the rest of the session.
- `onboardingFirstRunGuard: CanActivateFn` on `chat`: eligible only when
  `inject(VSCodeService).isElectron` (`vscode.service.ts:182-184`) and `flag.isFirstRunEligible()`.
  When eligible it records the current navigation id with `OnboardingFirstRunTracker.recordRedirect`
  and returns `router.createUrlTree(['/onboarding'])`; otherwise `true`. No readiness polling (boot
  navigation already runs after `connected`, spec §1.2.4).
- `OnboardingFirstRunTracker` (root, started by `provideOnboardingFirstRun()` =
  `provideAppInitializer(() => inject(OnboardingFirstRunTracker).start())` in `app.config.ts`)
  subscribes once to `Router.events` and implements the r2-corrected commit rule (Contracts §C3).
  `shownAt` is written in exactly one place: the tracker, on the replacement navigation's
  `NavigationEnd` whose URL is `/onboarding`.
- `initial-navigation.ts` restored-route branch (`:117-125`, the first-segment comparison at `:121`):
  a settle on segment `onboarding` when the planned segment was `chat` is accepted as landed (the guard is the only producer of that mapping).
  Without this the boot re-navigates to chat and hides onboarding (Risk R2).
- Re-entry: menu item and Settings row call `appState.setCurrentView('onboarding')`
  (readiness-gated, `app-state.service.ts:980-991`). The flag is ignored for manual entry.
  `dismissedAt`: Home "Skip for now" / "Back to chat". `completedAt`: A5 reached or a harness apply
  succeeds.

### A4. Headless session controller (harness)

`HarnessSessionController` (root, `harness-builder/services`) replaces the visible-embed dependency
(`harness-workflow-request.service.ts:430-441`):

1. Creates or reuses the tab (`TabManagerService.createTab`/`setWorkflow`/`setFirstMessagePreamble`,
   as today at `:399-403`), pins the canonical workspace root, writes the controller record before
   sending.
2. Sends without visibility: waits only for the tab to exist in the pinned workspace and not be in a
   transitional status (`switching`/`resuming`), with a 10 s timeout (same budget as today's
   `timeout({ first: 10_000 })`, `:434-440`), then calls
   `ChatStore.sendOrQueueMessage(content, { tabId })`. Idempotency key: `tabId + intakeHash`; a second
   `start()` with the same key never sends again.
3. Reconciles before showing `busy` or offering Retry send: a send is treated as accepted when the
   tab has a `claudeSessionId`, is streaming, or already holds a user message equal to the intake
   summary; only otherwise is Retry send offered (spec §3.5.4).
4. `attachView()` registers the tab in `TabManagerService.registerVisibleTab` while a proposal page is
   mounted and releases it on destroy (precedent `command-center-turn-status.ts:38-70`). Sending does
   not depend on it; it only keeps chunk delivery for the bound tab alive.
5. Stop = `chat:abort { sessionId }` (as `harness-builder-view.component.ts:548-556`), returning
   `'stopped' | 'uncertain'`; an uncertain stop never deletes a draft or starts another flow.
6. `latestAssistantMessage` is derived from the bound tab's finalized `messages` (last `assistant`
   entry). No question parsing (spec Decision 14).

`HarnessWorkflowRequestService` is reduced to entry coordination: validation, same-mode reuse,
cross-mode pending intent, and navigation. Its tab creation, first send, retry and visibility wait
move into the controller (no duplicate path left behind). Staging: **B4a** moves execution and
session ownership into the controller and keeps `navigateToBuilder` targeting `'harness-builder'`
(`:351-364`), so the old builder keeps working; **B5a** switches the target to
`navigateToSurface('onboarding', t.subPath, { queryParams: t.queryParams })` with
`t = onboardingHarnessTarget(mode, tabId, 'workspace')` and updates the spec, after B4b created the proposal pages.

### A5. Re-binding existing stores to `?tab` / `?run` / `?analysis`

| Page | Identity | Rebind sequence (all reads are existing RPCs) |
| --- | --- | --- |
| A1 | `analysis?` | `AnalysisStepStore.listAnalyses()` (`wizard:list-analyses`) → if `analysis` is in the list, `selectAnalysis(filename)` (`wizard:load-analysis`) → else resolve from `wizard:analysis-status` + list (latest) without rewriting the URL until the user acts. Unfinished run discovered separately by `WizardAnalysisRunner` (`wizard:get-resumable-run`), shown only as the Interrupted panel and never substituted for the selection (spec §3.6). |
| A2 | `analysis` or `source=catalog`, optional `tab` | Tab: `tab` if valid (`findBoundGenerationTab`) else `GenerationWorkflowLauncherService.open({ focus: false, workflow: 'setup-agent-generation' })`, which reuses the workspace's workflow tab (`generation-workflow-launcher.service.ts:56-71`) and is written back with `replaceUrl`. `GenerationWorkflowStore.bind(binding)`; if the run state is non-idle the page forwards to A3 with `tab`+`run` (furthest-valid-step rule, spec §10; never overrides an explicit backward click, tracked by navigation `state.explicitBack`). |
| A3 | `tab`, `run?` | Validate tab (exists, workflow `setup-agent-generation`, active workspace) → `GenerationWorkflowStore.bind(binding, run)` → `refresh()`; checkpoint agents via `AgentGenerationStore.discover()` only when `get-resumable-run` returns the same `runId`. Mismatched `run` (different authoritative run) → recovery screen "This run is no longer current" with Open latest. |
| A4 / guidance | `tab`, `run?`, `gen?` | Validate tab (workflow `setup-project-prompt`) → `GenerationWorkflowStore.bind` + `GuidanceGenerationStore.bind` → `refresh()` + `refreshCommitted()`. Run identity, first match wins: (1) `?run`; (2) `GenerationHandoffStore.started()` whose `tabId` equals `tab` (the handoff already called `startBoundGuidance`, `generation-handoff.store.ts:122`) → bind it and write `run` with `replaceUrl`; (3) authoritative `enhancedPrompts:getRunState` for the tab returns a run → bind it. Only when none exists, the arrival came from the handoff and the handoff outcome is not `manual-recovery` does the legacy pre-run state auto-start once (single-flight per tab); `manual-recovery` shows the pre-run state with Start and no auto-start. Section counts: `GenerationStepStore.guidanceSections(workspace, runId, generatedAt)` only (D9, C6). |
| A5 | `gen?`, `tab?` | Terminal facts from `wizard:get-generation-run-state` / `enhancedPrompts:getRunState` with those bindings; absent → summary only. |
| Proposal workspace / review | `tab`, `rev?` | `controller.session(mode).restore(tab)`: URL tab → stored controller record → `sessionId` → `HarnessProposalHydrationService.bind(root, tab, [sessionId], snapshot)`. Missing record + draft → Restore from draft; neither → recovery; session but no proposal → "Proposal unavailable" + Propose again (spec §3.5.5). |

### A6. Legacy normalisation points (spec §1.3)

| Seam | Mechanism |
| --- | --- |
| Shared registry (`webview-surface.types.ts:44-128`) | `setup-hub`, `setup-wizard`, `harness-builder` leave `SURFACE_ROUTE_IDS`, join `LEGACY_SURFACE_ALIASES`; `LEGACY_SURFACE_TARGETS` maps them to `onboarding` (and `orchestra-canvas` to `chat`); `resolveSurfaceAlias()` is the one mapping function. Host validation keeps accepting them (it already accepts aliases, `webview-html-generator.ts:129`). |
| `AppStateManager` (`app-state.service.ts:361-371`, `:638-640`, `:788-798`) | `normalizeView` and `normalizeInitialView` call `resolveSurfaceAlias`; `SWITCH_VIEW` keeps `isAcceptedInitialView` then normalises. |
| Saved route (`surface-router.service.ts:181-207`, `initial-navigation.ts:64-76`) | `SurfaceRouterService.normalizeRestoredRoute(route)` rewrites any URL whose first primary segment is a legacy alias (any children, any query) to `/onboarding`; `initial-navigation.ts` normalises before `navigateToUrl` and compares against the normalised route. |
| Generation tab validator (`surface-routes.ts:44-65`) | Replaced by `onboardingGenerationBinding(segments, queryParams)`; same `GENERATION_ROUTE_TAB_VALIDATOR` token and validator (`app.config.ts:47-60`, `:232-238`). |
| Launchers (`electron-setup-wizard.service.ts:79`, `webview-lifecycle.service.ts:153`) | Send `onboarding` (Home only, no child path). |
| Workflow/focus navigation (`generation-workflow-launcher.service.ts:78`, `harness-workflow-request.service.ts:355`, both focus routers) | Use `onboardingGenerationTarget` / `onboardingHarnessTarget`; focus routers merge into `OnboardingFocusRouter`. All three target switches happen in B5a, after B3b/B4b created the destination pages. B4a changes only session/send ownership in the request service and keeps its `'harness-builder'` target. |
| Backend event names and workflow discriminators | Unchanged (`setup-wizard:*`, `setup-generation:open`, `harness:open-workflow`, tab workflows). `surfaceKind` wire enum (`libs/shared/src/lib/types/messages/schemas.ts:24`) unchanged; no backend emitter exists for it. |

Removal of the alias rows is a next-release follow-up (spec §1.3); recorded under Risks, not done here.

## Contracts

All signatures below are new or changed. Referenced existing types are verified with file:line.

### C1. Shared surface registry (`libs/shared/src/lib/types/webview-surface.types.ts`)

```ts
export type ViewType =
  | 'chat' | 'analytics' | 'settings' | 'onboarding'
  | 'thoth' | 'marketplace' | 'tribunal' | 'tasks' | 'apps' | 'command-center'
  // legacy wire values, never routes (see LEGACY_SURFACE_ALIASES)
  | 'orchestra-canvas' | 'setup-hub' | 'setup-wizard' | 'harness-builder';

export type LegacySurfaceAlias = 'orchestra-canvas' | 'setup-hub' | 'setup-wizard' | 'harness-builder';
export const SURFACE_ROUTE_IDS: readonly ViewType[];          // 'onboarding' replaces the three legacy ids (order: after 'chat')
export const LEGACY_SURFACE_ALIASES: readonly LegacySurfaceAlias[];
export const LEGACY_SURFACE_TARGETS: Readonly<Record<LegacySurfaceAlias, ViewType>>;
//   { 'orchestra-canvas': 'chat', 'setup-hub': 'onboarding', 'setup-wizard': 'onboarding', 'harness-builder': 'onboarding' }
export function isLegacySurfaceAlias(value: unknown): value is LegacySurfaceAlias;
export function resolveSurfaceAlias(view: ViewType): ViewType;   // identity for route ids
// unchanged: ACCEPTED_INITIAL_VIEWS, DEFAULT_SURFACE_ID, isSurfaceRouteId, isAcceptedInitialView,
//            surfaceRoutePath, surfaceIdFromSegment (lines 103-152)
```

B1 only adds `'onboarding'` to the union and to `SURFACE_ROUTE_IDS` (additive). B5a performs the move
of the three ids into the alias table.

### C2. Core routing (`libs/frontend/core/src/lib/routing/`)

```ts
// surface-router.service.ts — extended signature (was :137-141)
navigateToSurface(
  id: ViewType,
  subPath?: readonly string[],
  extras?: { readonly replaceUrl?: boolean; readonly queryParams?: Readonly<Record<string, string>> },
): Promise<SurfaceNavigationResult>;                 // SurfaceNavigationResult at :43-44, unchanged
normalizeRestoredRoute(route: string): string;      // legacy first segment → '/onboarding'; parse errors return input unchanged

// onboarding-routes.ts (NEW; replaces generationRouteBinding in surface-routes.ts:44-65)
export type OnboardingHarnessMode = 'new-project' | 'configure-harness';   // same values as HarnessBuilderMode (harness-builder-records.service.ts:23)
export const ONBOARDING_QUERY = { tab: 'tab', run: 'run', gen: 'gen', rev: 'rev', analysis: 'analysis', source: 'source', draft: 'draft' } as const;
export interface OnboardingTarget {
  readonly subPath: readonly string[];
  readonly queryParams: Readonly<Record<string, string>>;
}
export function onboardingGenerationTarget(workflow: SetupGenerationWorkflow, tabId: string): OnboardingTarget;
//   'setup-agent-generation' → ['analyze','agents'] { tab }      (A2 forwards to A3 when a run exists)
//   'setup-project-prompt'   → ['guidance'] { tab }
export function onboardingHarnessTarget(mode: OnboardingHarnessMode, tabId: string, step?: 'workspace' | 'review'): OnboardingTarget;
//   'new-project' → ['new-project', step] { tab };  'configure-harness' → ['team-builder', step] { tab }
export function isOnboardingIdentityValue(value: unknown): value is string;  // non-empty, ≤256, no '/', '\\', ':'
export function onboardingGenerationBinding(
  segments: readonly string[],
  queryParams: Readonly<Record<string, unknown>>,
): { tabId: string; workflow: SetupGenerationWorkflow } | null;
//   ['onboarding','analyze','agents'|'generate'] + tab → setup-agent-generation
//   ['onboarding','analyze','guidance'] | ['onboarding','guidance'] + tab → setup-project-prompt
// GENERATION_ROUTE_TAB_VALIDATOR / GenerationRouteTabValidator (surface-routes.ts:35-42) unchanged.
```

`SetupGenerationWorkflow` verified at `rpc-setup.types.ts:11-12`.

```ts
// tokens/surface-focus-router.token.ts:4-8 — two-step change
// B5a (widen; old routers at setup-wizard-focus-router.service.ts:7 and
//      harness-builder-focus-router.service.ts:7 still compile):
  readonly kind: 'setup-wizard' | 'harness-builder' | 'onboarding' | 'mcp-apps';
// B5b (narrow, in the same batch that deletes both old routers, their providers and exports):
export interface SurfaceFocusRouter {
  readonly kind: 'onboarding' | 'mcp-apps';
  canFocus(sessionId: string): boolean;
  focus(sessionId: string): Promise<NotificationFocusResult>;
}
// B5a, kept after B5b: the wire enum (schemas.ts:24, attention.ts:7) keeps its legacy values.
export function focusRouterKindFor(
  surfaceKind: 'setup-wizard' | 'harness-builder' | 'mcp-apps',
): SurfaceFocusRouter['kind'];   // 'setup-wizard' | 'harness-builder' → 'onboarding'
```

No producer of `surfaceKind` exists today (only the schema and the type declare it). The matcher in
`chat-attention-host-message-handler.service.ts:200` and `:268` compares `router.kind` with
`surfaceKind` directly. Without the mapping, a legacy-tagged notice would stop matching once the
merged router replaces the two old ones.

```ts
// services/app-state.service.ts:60-70, :86-88, :405-413
export type ConfigurationSurfaceId = Extract<ViewType, 'thoth' | 'onboarding' | 'marketplace' | 'settings'>;
// ConfigurationSurfaceSlots: 'setup-hub' member renamed 'onboarding' (Readonly<Record<string, never>>)
```

### C3. First run (`libs/frontend/onboarding/src/lib/first-run/`)

```ts
export const ONBOARDING_FLAG_KEY = 'ptah.onboarding.v1';
export interface OnboardingFlag {
  readonly shownAt?: string;      // ISO datetime
  readonly dismissedAt?: string;
  readonly completedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class OnboardingFlagService {
  readonly flag: Signal<OnboardingFlag>;          // {} when absent or invalid
  readonly storageAvailable: Signal<boolean>;     // probe result
  isFirstRunEligible(): boolean;                  // storageAvailable && !suppressed && !flag().shownAt
  markShown(): void;                              // write failure → suppressed = true
  markDismissed(): void;
  markCompleted(): void;
}

export const onboardingFirstRunGuard: CanActivateFn;   // Electron + eligible → UrlTree('/onboarding'), else true

@Injectable({ providedIn: 'root' })
export class OnboardingFirstRunTracker {
  start(): void;                                  // idempotent; one Router.events subscription for app lifetime
  recordRedirect(navigationId: number): void;
}
export function provideOnboardingFirstRun(): EnvironmentProviders;   // provideAppInitializer(start)
```

Tracker state machine (review r2 blocker fix):

| Event | Condition | Effect |
| --- | --- | --- |
| guard `recordRedirect(id)` | — | `pending = { originId: id, replacementId: null, awaiting: false }` |
| `NavigationCancel` | `id === originId && code === NavigationCancellationCode.Redirect` | `awaiting = true` (marker kept) |
| `NavigationCancel` / `NavigationError` / `NavigationSkipped` | `id === originId` with any other code, or `id === replacementId` | clear |
| `NavigationStart` | `awaiting && url` first segment is `onboarding` | `replacementId = id; awaiting = false` |
| `NavigationStart` | `awaiting` and URL is not onboarding | clear (superseded before the redirect started) |
| `NavigationEnd` | `id === replacementId` and `urlAfterRedirects` first segment is `onboarding` | `flag.markShown()`; clear |
| `NavigationEnd` | any other id | ignored (a manual visit never commits) |

### C4. Harness session controller (`libs/frontend/harness-builder/src/lib/services/harness-session.controller.ts`)

```ts
export type HarnessSessionPhase = 'idle' | 'sending' | 'busy' | 'cancelling' | 'failed' | 'done';

export interface HarnessApplyReceipt {
  readonly revisionId: string;
  readonly appliedPaths: readonly string[];      // HarnessApplyResponse, rpc-harness.types.ts:328-331
  readonly warnings: readonly string[];
  readonly appliedAt: string;
}

/** Persisted (zod strictObject) under `${HARNESS_RECORD_PREFIX}.session.<root>.<tabId>` in HarnessBuilderRecordsService. */
export interface HarnessSessionRecord {
  readonly version: 1;
  readonly tabId: string;
  readonly sessionId?: string;                   // real SDK session id (rpc-harness-proposal.types.ts:18-19)
  readonly mode: HarnessBuilderMode;             // harness-builder-records.service.ts:23
  readonly workspacePath: string;                // canonical root (canonicalHarnessRoot)
  readonly intake?: NewProjectIntake;            // rpc-harness.types.ts:490-512 (new-project)
  readonly teamIntent?: string;                  // configure-harness start text
  readonly intakeHash: string;
  readonly sendAttempt: { readonly count: number; readonly ackedAt?: string };
  readonly lastRevisionId?: string;
  readonly appliedRevisionId?: string;
  readonly applyReceipt?: HarnessApplyReceipt;
  // startResult: NOT duplicated — the existing stack-profile record (records.readStackProfile) is the source.
}

export type HarnessSessionStart =
  | { readonly mode: 'new-project'; readonly workspaceRoot: string; readonly intake: NewProjectIntake }
  | { readonly mode: 'configure-harness'; readonly workspaceRoot: string; readonly intent: string };

export type HarnessSessionStartOutcome =
  | { readonly kind: 'started' | 'reused'; readonly tabId: string }
  | { readonly kind: 'conflict'; readonly otherMode: HarnessBuilderMode; readonly otherTabId: string }
  | { readonly kind: 'failed'; readonly error: string };

export type HarnessRestoreOutcome =
  | 'ready' | 'restore-draft' | 'missing' | 'workspace-mismatch' | 'wrong-mode' | 'proposal-unavailable';

export interface HarnessModeSession {
  readonly mode: HarnessBuilderMode;
  readonly record: Signal<HarnessSessionRecord | null>;
  readonly phase: Signal<HarnessSessionPhase>;
  readonly error: Signal<string | null>;
  readonly latestAssistantMessage: Signal<{ readonly id: string; readonly text: string } | null>;
  start(request: HarnessSessionStart): Promise<HarnessSessionStartOutcome>;
  restore(tabId: string): Promise<HarnessRestoreOutcome>;
  send(text: string): Promise<boolean>;
  retrySend(): Promise<boolean>;
  stop(): Promise<'stopped' | 'uncertain'>;
  attachView(): () => void;                      // returns the release function
  recordApply(receipt: HarnessApplyReceipt): void;
}

@Injectable({ providedIn: 'root' })
export class HarnessSessionController {
  session(mode: HarnessBuilderMode): HarnessModeSession;      // exactly two lazily created instances
  activeSessionIn(workspaceRoot: string): { mode: HarnessBuilderMode; tabId: string } | null;
  leave(mode: HarnessBuilderMode, choice: 'save' | 'discard'): Promise<'left' | 'uncertain' | 'save-failed'>;
}
```

Start sequence per mode (unchanged RPCs): new project → `harness:start-new-project`
(`HarnessRpcService.startNewProject`) → preamble = `seedPrompt`, visible message =
`formatIntakeSummary(intake)` (`new-project-intake.ts:57`), stack profile written as today. Team
builder → `harness:workflow-prompt { mode: 'configure-harness', contextOnly: true }`
(`rpc-harness.types.ts:533-546`) → preamble = `prompt`, visible message = user intent.

### C5. Proposal hydration addition (`harness-proposal-hydration.service.ts`)

```ts
export interface HarnessFoldedRevision {
  readonly id: string;                       // HarnessProposalRevision.id
  readonly sessionId: string;
  readonly ordinal: number;                  // 1-based display order of orderedRevisions()
  readonly updatedAt: string;
  readonly isConfigComplete: boolean;
  readonly config: Partial<HarnessConfig>;   // folded through this revision, WITHOUT user overrides
}
readonly revisions: Signal<readonly HarnessFoldedRevision[]>;   // recomputed in recompute()
```

### C6. Onboarding stores and helpers (`libs/frontend/onboarding/src/lib/`)

```ts
export type OnboardingRunChipState = 'idle' | 'running' | 'cancelling' | 'failed' | 'resumable' | 'done';
export function chipStateFor(view: GenerationViewState): OnboardingRunChipState;   // GenerationViewState: generation-workflow.store.ts:11-22

export interface PhaseRow {
  readonly id: string;                                   // returned phase id, never hard-coded count
  readonly label: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';   // phase.ts:71-79
  readonly durationMs?: number;                          // manifest only (completed analysis)
}
export interface StreamCounts { readonly total: number; readonly text: number; readonly thinking: number; readonly tool: number; readonly errors: number }

@Injectable({ providedIn: 'root' }) export class AnalysisStepStore {      // A1 + A2
  readonly saved: Signal<readonly SavedAnalysisMetadata[]>;               // wizard/steps.ts:9
  readonly hidden: Signal<ReadonlySet<string>>;                           // transient
  readonly selected: Signal<string | null>;
  readonly loaded: Signal<MultiPhaseAnalysisResponse | null>;             // rpc-setup.types.ts:209
  readonly phaseRows: Signal<readonly PhaseRow[]>;
  readonly phaseHeader: Signal<{ current: number; total: number } | null>;
  readonly streamCounts: Signal<StreamCounts | null>;                     // null when stream detached
  readonly recommendations: Signal<readonly AgentRecommendation[]>;
  readonly selection: Signal<ReadonlySet<string>>;
  readonly preview: Signal<WizardPreviewGenerationResponse | null>;       // rpc-setup.types.ts:395
  listAnalyses(): Promise<void>;
  selectAnalysis(filename: string): Promise<'loaded' | 'not-found' | 'failed'>;
  loadRecommendations(binding: SetupGenerationTabBinding, source: 'analysis' | 'catalog'): Promise<void>;
  refreshPreview(binding: SetupGenerationTabBinding): Promise<void>;
  submit(binding: SetupGenerationTabBinding): Promise<{ runId: string } | { rejection: SetupGenerationRejection } | { error: string }>;
}

@Injectable({ providedIn: 'root' }) export class GenerationStepStore {     // A3–A5 + guidance-only
  bindAgents(binding: SetupGenerationTabBinding, runId?: string): 'bound' | 'invalid-tab' | 'workspace-mismatch';
  bindGuidance(binding: SetupGenerationTabBinding, runId?: string): 'bound' | 'invalid-tab' | 'workspace-mismatch';
  /** D9. Triggered by this store itself (root effect on GuidanceGenerationStore) on the observed
   *  transition of run A from a non-terminal status to 'completed', whichever page is mounted.
   *  A run first seen already terminal (late bind, restore → 'idle') is never captured.
   *  Single-flight per (workspace, runId). */
  captureGuidanceSections(binding: SetupGenerationTabBinding, runId: string): Promise<'captured' | 'unavailable' | 'stale'>;
  guidanceSections(workspacePath: string, runId: string, generatedAt: string | null): GuidanceSectionCounts | null;
  readonly doneFacts: Signal<AnalyzeDoneFacts | null>;
}

// guidance-section-counts.ts — pure, no Angular (D9)
export const GUIDANCE_SECTION_NAMES = ['Project Context', 'Framework Guidelines', 'Coding Standards', 'Architecture Notes'] as const;
export type GuidanceSectionCounts = Pick<EnhancedPromptsSummary, 'sections'>;   // rpc-setup.types.ts:506-525
export function parseGuidanceSectionCounts(content: string | null): GuidanceSectionCounts | null;
```

`captureGuidanceSections(A)` sequence. All calls are existing RPCs through `WizardRpcService`, not
`GuidanceGenerationStore.loadContent()`, whose null result sets `actionFailed` for the View panel
(`guidance-generation.store.ts:217-232`). Content and status are keyed only by workspace
(`enhanced-prompts-rpc.handlers.ts:164-202`, `:907-950`) and carry no run identity
(`SetupGenerationRunState` has no content version, `rpc-setup.types.ts:98-107`). Attribution to A
is therefore established by authoritative run-state lookups on both sides of the reads:

- **Identity check `L`**: `getBoundRunState(tabBindingOf(A))` **without** a `runId`
  (`wizard-rpc.service.ts:86-102` → `enhancedPrompts:getRunState` → `getGuidanceRunState`,
  `enhanced-prompts-rpc.handlers.ts:882-897`, which passes `generationInProgress` as `serviceBusy`,
  `:895`). It passes only if the returned run's binding equals A exactly (`tabId`, `workspacePath`,
  `workflow`, `runId`), `status === 'completed'` and `committedState === 'committed'` (a completed
  settle is always `committed`, `guidance-generation-run.supervisor.ts:81-85`). A `null` result
  (rejection: `blocked`, `not-running`, `invalid-binding`), a thrown error, a different binding or
  run id, or a non-terminal status fails it.
- **Why no `runId`**: the supervisor is a container singleton
  (`register-shared-rpc-handlers.ts:68`). It holds one `current` run and one `settled` record, and
  each new settle replaces `settled` (`guidance-generation-run.supervisor.ts:15-22`, `:94-95`).
  A lookup with the explicit `runId` A returns the settled A (`:153-160`) before it checks for a
  current owner or a busy service (`:161-170`), so it cannot prove that no replacement is active.
  The runless lookup returns `current` for the same tab (`:145-152`). For another tab's active run,
  or for any in-process generation holding the service lock (`generationInProgress`,
  `enhanced-prompts.service.ts:314-319`, `:376-378`), it reports `blocked` (`:161-170`). It returns
  the settled A only when nothing is running and no later settle replaced A (`:172-178`). Any other
  run that completed after A, in any tab or workspace, therefore fails `L`.

Steps (any failure aborts with no counts):

1. `L` → else `'stale'` (`'unavailable'` if the RPC throws).
2. `getEnhancedPromptsStatus(workspace)` (`wizard-rpc.service.ts:445`) → `S1`. It must be
   `enabled`, have `hasGeneratedPrompt`, carry no `error` and have a non-null `generatedAt` (`g0`),
   else `'unavailable'`.
3. `getEnhancedPromptContent(workspace)` (`:521`) → `content`. A `null` result (disabled or absent,
   `enhanced-prompts.service.ts:891-901`) or a throw → `'unavailable'`.
4. `getEnhancedPromptsStatus(workspace)` → `S2`. It must still be `enabled` with
   `hasGeneratedPrompt`, and `S2.generatedAt === g0`, else `'stale'`.
5. `L` again, else `'stale'`. Together with step 1 this brackets the content read: no run started,
   ran or settled between the two lookups without failing one of them.
6. Local checks: `GuidanceGenerationStore.binding()` still equals A's tab binding,
   `run()?.binding.runId === A.runId` and `status() === 'completed'`, else `'stale'`.
7. `parseGuidanceSectionCounts(content)`; `null` → `'unavailable'`. Otherwise retain under
   `(workspace, A.runId, g0)`, in memory only.

`guidanceSections(workspace, runId, generatedAt)` returns the entry only while all of these hold:
its key matches, `generatedAt` equals the current `GuidanceGenerationStore.result()?.generatedAt`,
and the store's `run()` is still A with status `completed`. When the workspace result advances
(regenerate, another tab's commit, an enable/disable round trip that moves `generatedAt`), the
counts disappear even though the local run is still A. They are not recomputed for A, because the
new content belongs to another run. After a webview reload the in-memory map is empty and the
counts are omitted (spec §3.6 reload rule).

Documented residual (plan-gate item, not separately accepted by the user): a write by another
**process** (for example `ptah-cli` running guidance on the same workspace) is invisible to this
supervisor's `current`/`settled`, which are process-local (`guidance-generation-run.supervisor.ts:15-22`),
and `getPromptContent` carries no run or content version (`enhanced-prompts-rpc.handlers.ts:914-940`).
An external run that starts before A settles and finishes before the first status read can be
misattributed; there is no timing guarantee. A write that completes after the first status read is
caught by the `generatedAt` check in step 4. Recorded as R12.

Required `captureGuidanceSections` cases (store spec, mocked `WizardRpcService`):

- B, another tab in the same workspace, completes before the first read: runless `L` returns
  `not-running` (B settled in another tab and replaced A) → `'stale'`, no counts. The spec also
  asserts that `getBoundRunState` is never called with a `runId` during capture: that form would
  return A while B is active (`:153-160`).
- B is active during capture (another tab owns `current`), at step 1 or step 5: `L` → `blocked` →
  `'stale'`.
- An in-process unbound generation holds the service lock (`generationInProgress` true): `L` →
  `blocked` → `'stale'`.
- A same-tab new run starts during capture: `L` returns `current` with another `runId` or a
  non-terminal status → `'stale'`.
- B completes between steps 2 and 4: `g0 !== S2.generatedAt` → `'stale'`; and/or step 5 fails.
- The workspace result advances after capture while the local run stays A: `guidanceSections()`
  returns null.
- Guidance is disabled between steps 2 and 4: step 4 → `'stale'`. Content `null` → `'unavailable'`.
- The `getRunState` RPC throws → `'unavailable'`. The binding changes mid-capture → `'stale'`.
- A run first observed already `completed` (late bind or restore) is never captured.
- Happy path: both lookups return A completed, equal timestamps → `'captured'`, and the card shows
  4 rows.

`parseGuidanceSectionCounts` rules (mirrors `buildCombinedPrompt`, `enhanced-prompts.service.ts:1460-1482`):

- `null`, empty or whitespace-only → `null`.
- Normalise `\r\n` to `\n`. The region starts after the **first** line equal to
  `## Project-Specific Guidance` (trailing whitespace ignored). This drops the prepended
  `PTAH_CORE_SYSTEM_PROMPT`, which has no such line. If the marker is absent, return `null`. This
  covers pre-marker or hand-edited prompts and `formatAsPromptSection`'s `# Project-Specific Guidance`
  layout (`response-parser.ts:552-560`), and no counts are guessed. The region runs to the end of
  the content, because generated text may hold its own `##` headings.
- Canonical headings are searched in `GUIDANCE_SECTION_NAMES` order. Each is the first line that
  equals `### <Name>` exactly (case-sensitive, trailing whitespace ignored) and comes after the
  previous canonical heading that was found, or after the region start. A section's text runs from
  the line after its heading to the next canonical heading that was found, or to the region end.
- A heading that is not found → `{ name, wordCount: 0, generated: false }`. The builder omits empty
  sections, so absence means not generated. If no canonical heading is found at all → `null`.
- Words are `text.split(/\s+/).filter(Boolean).length` (`:1408-1409`). Non-canonical headings
  inside a section (`#### Sub`, `### Other`, `## Notes`) count as that section's words, as the
  backend counts the raw section text.
- The result always holds the 4 canonical entries in order. Quality Guidance is never produced: the
  combined prompt does not contain it (user-approved loss).

Required spec cases: the full four-section output; the core-prompt prefix excluded; the marker missing
→ null; `#`-level `formatAsPromptSection` layout → null; a missing middle section (`generated:
false`, 0); CRLF input; nested `####`/`### Other`/`## Notes` inside a section counted in it; an
earlier canonical name repeated inside a later section counted as content; a later canonical
heading appearing early inside a section splits there (documented, deterministic); `###Project
Context` (no space) and `### project context` (case) not headings; a heading with trailing spaces
accepted; the marker with no sections → null; whitespace-only section → `generated: true` with
`wordCount: 0` only if its heading line exists.

```ts

// per flow, provided on the new-project / team-builder parent route
export const HARNESS_FLOW_MODE = new InjectionToken<HarnessBuilderMode>('HARNESS_FLOW_MODE');
@Injectable() export class ProposalFlowStore {
  readonly mode: HarnessBuilderMode;
  readonly session: HarnessModeSession;
  readonly revisions: Signal<readonly HarnessFoldedRevision[]>;
  readonly changeTags: Signal<ReadonlyMap<string, 'new' | 'changed'>>;  // folded n vs n-1, config only
  readonly generatedDocument: WritableSignal<string | null>;          // harness:generate-document output
  readonly reviewEligible: Signal<boolean>;   // initialised && nonempty && pinned workspace && !busy && !applying
  restoreRevision(id: string): boolean;       // writes user snapshot overrides (records.writeSnapshot) + hydration.setSnapshot
}
export function diffHarnessConfig(prev: Partial<HarnessConfig>, next: Partial<HarnessConfig>): ReadonlyMap<string, 'new' | 'changed'>;
```

Changed existing members (setup-wizard):

```ts
// generation-workflow.store.ts:68 — optional expected run (from ?run)
bind(binding: SetupGenerationTabBinding, expectedRunId?: string): void;
// generation-handoff.store.ts — expose what the background handoff started
readonly started: Signal<SetupGenerationRunBinding | null>;     // rpc-setup.types.ts:20-23
```

`builder-apply-section.component.ts` gains `config = input<Partial<HarnessConfig> | null>(null)`
(applies the reviewed folded snapshot when set; falls back to `hydration.config()`) and
`applied = output<HarnessApplyResponse>()`. Eligibility checks at `:275` are unchanged (spec D7).

`EnhancedPromptsSummaryCardComponent` (setup-wizard, retained, already exported at
`setup-wizard/src/index.ts:40`) narrows its input to
`summary = input.required<Pick<EnhancedPromptsSummary, 'sections'>>()` (was the full summary,
`:103`). Its template drops the `usedFallback` badge (`:43-52`) and the `totalTokens` badge
(`:94`), and keeps the section grid and the "N of M sections generated" footer. M is 4 for parser
output. The old `PromptEnhancementComponent` caller still compiles (the full summary is
assignable) until B5b deletes it (D9, user-approved).

## File plan

Parity references use the capability names of `parity-inventory.md` (section "Capabilities" unless
noted). "Entry" = section "Entry points & routing"; "Coupling" = section "Chat-embed coupling".

### Create (lib `libs/frontend/onboarding`)

| File | Purpose | Parity carried |
| --- | --- | --- |
| `project.json`, `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `jest.config.ts`, `eslint.config.mjs`, `src/test-setup.ts` | Lib scaffold mirroring `libs/frontend/harness-builder` (tags `scope:webview`, `type:feature`, `typecheck` via `ngc --noEmit`) | — |
| `src/index.ts` | Exports `ONBOARDING_ROUTES` only | — |
| `src/services.ts` | Eager barrel. B1: flag, tracker, guard, first-run provider. B5a adds the focus router + provider | Entry: notification focus |
| `src/lib/onboarding.routes.ts` | Route tree (A2 table) | Entry: generation URL, builder URL |
| `src/lib/first-run/onboarding-flag.service.ts` (+spec) | Flag schema, guarded storage, probe, suppression | new (user decision) |
| `src/lib/first-run/onboarding-first-run.tracker.ts` (+spec) | r2-corrected commit rule | new |
| `src/lib/first-run/onboarding-first-run.guard.ts` (+spec) | Chat-route guard | new |
| `src/lib/first-run/provide-onboarding-first-run.ts` | App initializer provider | new |
| `src/lib/focus/onboarding-focus-router.service.ts` (+spec), `onboarding-focus-router.provider.ts` | Merged notification focus for generation + harness tabs | Entry: notification session focus |
| `src/lib/shell/onboarding-shell.component.ts` (+spec) | Frame (1120px cap), breadcrumb, provider/model pill, `role=status` announcer region, `<router-outlet>` | Entry: exits |
| `src/lib/shell/onboarding-focus.service.ts`, `onboarding-announcer.service.ts` | h1 focus on route change; polite announcements | a11y (spec §2, §8) |
| `src/lib/shell/onboarding-step-link.ts` | Query-copy helper for step links | identity rule (spec §1.1) |
| `src/lib/home/onboarding-home.component.ts` (+spec) | h1, lede, resume banners, 3 tiles, secondary links, footer, Skip | Setup status/presets/refresh; independent generation cards; hub Analysis/New Project/Team Builder cards |
| `src/lib/home/path-tile.component.ts` | Tile (disabled reason, skeleton, status chips) | Setup status, workspace-required launch |
| `src/lib/home/resume-banner.component.ts` | Stacked resume banners | Resume/rebind; resume generation |
| `src/lib/home/onboarding-resume.store.ts` (+spec) | Bounded resume discovery: `get-resumable-run`, bound workflow tabs' run state, harness controller records/drafts | Resume/rebind, drafts |
| `src/lib/shared/onboarding-stepper.component.ts` (+spec) | Stepper (vertical rail ≥720px, strip below), `aria-current="step"` | Wizard step navigation |
| `src/lib/shared/run-status-chip.component.ts`, `run-panel.component.ts`, `step-meter.component.ts` | Shared run states (spec §3.7), labelled progressbar | Stop, cancelling, stop-before-accept, uncertain stop |
| `src/lib/shared/item-status-card.component.ts`, `item-status-grid.component.ts` (+spec) | Per-agent cards (status map, error, file, section counts, Retry this agent) | Per-agent progress, outcomes, retries |
| `src/lib/shared/details-log.component.ts` (+spec) | Collapsed `<details>`; analysis mode renders `AnalysisTranscriptComponent` + stream counts; tab mode mounts `SessionEmbedComponent` (`chrome='bare'`, read-only `startGuard`, `stopHandler` → store/controller) only while open | Transcript/execution tree; session statistics (header uses `BuilderSessionSectionComponent`) |
| `src/lib/shared/recovery-screen.component.ts` | Missing/foreign tab, workspace mismatch, stale run, proposal unavailable | Missing/wrong tab recovery |
| `src/lib/shared/owner-conflict-banner.component.ts` | `rejection.reason === 'blocked'` + Open it + Retry | Context source; active-owner conflict and open owning tab; chat busy exclusion |
| `src/lib/analyze/analysis-step.store.ts` (+spec) | A1/A2 state (Contracts C6) | Saved analysis list/use/refresh/hide; analysis launch/resume/fresh; recommendations, preview, submit |
| `src/lib/analyze/analyze-workspace.page.ts` (+spec) | A1 incl. provider/model selector, saved list, interrupted panel, running PhaseList, done accordion, **Manual adjust** (coming-soon modal via `ConfirmationModalComponent`), cancel confirm, failed retry/fresh, lost-RPC "may still be running" | Analysis provider/model; scan phases/stats; phase markdown; analysis cancel; manual-adjust placeholder (kept) |
| `src/lib/analyze/phase-list.component.ts` | Phase rows, five statuses with text, "Phase n of N" | Scan phase cards/progress |
| `src/lib/analyze/choose-agents.page.ts` (+spec) | A2 incl. source line, agent-only banner, model picker, community packs, preview sheet, owner banner | Recommendations…; per-tab model picker; community packs; submit |
| `src/lib/analyze/agent-recommendation-list.component.ts` | Grouped list, match %, criteria chips, toolbar (select recommended / clear / n selected) | Agent recommendations/categories/choice |
| `src/lib/analyze/overwrite-preview.component.ts` | Preview sheet: files, certainty, condition, "Will overwrite" tag; confirm label | Agent/file preview, definite/conditional, refresh-before-confirm |
| `src/lib/analyze/generation-step.store.ts` (+spec) | A3–A5 state, D9 section capture (Contracts C6) | Generation rebind; completion facts; legacy enhancement summary (section counts) |
| `src/lib/analyze/guidance-section-counts.ts` (+spec) | Pure `parseGuidanceSectionCounts` (C6 rules and required cases) | Legacy enhancement summary (D9) |
| `src/lib/analyze/generate-agents.page.ts` (+spec) | A3: chip, percent meter, cards, retry item, facts, details log, guidance countdown (`AgentNextStepsComponent` + `GenerationHandoffStore`) | Per-agent progress; combined countdown, Start now, Skip, manual recovery |
| `src/lib/analyze/project-guidance.page.ts` (+spec) | A4 and guidance-only: owner check on entry, run rebind order (A5 table: `?run`, handoff `started`, authoritative run), **legacy enhancement pre-run state** (auto-start only when no run exists and the handoff did not end in `manual-recovery`, Skip → A5, Retry, Continue), running spinner + Stop, done view with detected stack (getStatus) and `EnhancedPromptsSummaryCardComponent` fed by `guidanceSections()` (hidden when null), `GuidanceResultPanelComponent` (enable, view, download, regenerate, unchanged notice), refresh | Guidance generate/retry/regenerate/stop/refresh; saved guidance; legacy enhancement auto-generate/stack/summary/retry/skip/continue |
| `src/lib/analyze/analyze-done.page.ts` (+spec) | A5 facts, Open chat (posts `SETUP_WIZARD_COMPLETE` then `setCurrentView('chat')`), command center, Tribunal, Run again; sets `completedAt` | Completion facts; exits |
| `src/lib/proposal/proposal-flow.store.ts` (+spec) | Per-flow store (Contracts C6), `diffHarnessConfig` | Revision recovery/restore; helper output overrides |
| `src/lib/proposal/new-project-intake.page.ts` (+spec) | Intake form, validation on blur/submit, error summary, platform→stack reset, "Recommend for me"/"Other", must-haves, Advanced provider/model, Continue-your-draft banner, cross-mode dialog | Intake questions; validation, other-stack, platform reset, cancel, consent |
| `src/lib/proposal/team-builder-start.page.ts` (+spec) | Team intent textarea, workspace line, Load preset, Advanced | AI Team Builder conversational configuration |
| `src/lib/proposal/proposal-workspace.page.ts` (+spec) | Proposal panel + answer dock + helpers menu + revision history + bottom bar (Save draft, Save as preset, Review); leave dialog reuse | Team/config preview; AI helpers; presets; leave/start over/switch modes |
| `src/lib/proposal/proposal-panel.component.ts`, `proposal-section.component.ts`, `proposal-item.component.ts` (with `ChangeTag`), `revision-history.component.ts` | Three sources separated (config / intake facts via `BuilderStackProfileSectionComponent` / generated document) | Preview incl. created skills and document; stack profile |
| `src/lib/proposal/answer-dock.component.ts` (+spec) | Desktop `aside`, ≤860 above, ≤720 bottom bar + modal sheet (`inert`, trap, Esc, focus return) | Sidebar/sheet, keyboard dismiss, inert transcript |
| `src/lib/proposal/review-apply.page.ts` (+spec), `review-summary.component.ts`, `apply-result.component.ts` | Review at rev n vs n-1, newer-revision banner, "applied revision m", non-blocking completeness note, apply via `BuilderApplySectionComponent`, result (paths/copy, warnings, health refresh, Open chat, health dashboard, Done) | Apply to pinned workspace, gating, paths/copy, warnings, health refresh |
| `apps/ptah-electron-e2e/src/specs/onboarding/onboarding.spec.ts` | Electron e2e: first-run redirect once, Skip, menu re-entry, Home tiles, recovery screen, axe per step (authored; run only on user request, CLAUDE.md) | a11y gate (spec §8) |

### Create (other libs)

| File | Purpose | Parity carried |
| --- | --- | --- |
| `libs/frontend/core/src/lib/routing/onboarding-routes.ts` (+spec) | URL builders + query binding parser (Contracts C2) | Generation URL; builder URL |
| `libs/frontend/harness-builder/src/lib/services/harness-session.controller.ts` (+spec) | Headless controller (Contracts C4) | Bootstrap stack profile, human intake message, hidden seed preamble, send retry; New-project first-turn bridge (Coupling) |

### Modify

| File | Change | Parity / reason |
| --- | --- | --- |
| `libs/shared/src/lib/types/webview-surface.types.ts` (+`.spec.ts`) | B1: add `onboarding`. B5a: alias table (C1) | Surface contract |
| `libs/shared/src/index.ts` (if it enumerates exports) | Export new symbols | — |
| `libs/frontend/core/src/lib/routing/surface-routes.ts` | Re-export new shared symbols; delete `generationRouteBinding` (B5a) | Generation URL |
| `libs/frontend/core/src/lib/routing/index.ts`, `libs/frontend/core/src/index.ts` | Export `onboarding-routes` symbols | — |
| `libs/frontend/core/src/lib/routing/surface-router.service.ts` (+spec) | `queryParams` extra (B1); `normalizeRestoredRoute`, binding parser swap (B5a) | Restore/legacy |
| `libs/frontend/core/src/lib/routing/surface-route-persistence.ts` (+spec) | Binding parser swap (B5a) | Generation rebind |
| `libs/frontend/core/src/lib/services/app-state.service.ts` (+spec) | `ConfigurationSurfaceId` rename; `resolveSurfaceAlias` at the three normalisation points (B5a) | Shared app navigation |
| `libs/frontend/core/src/lib/tokens/surface-focus-router.token.ts` | B5a: widen kind union with `'onboarding'`; add `focusRouterKindFor(surfaceKind)` (legacy → `'onboarding'`). B5b: narrow to `'onboarding' \| 'mcp-apps'` with the old routers' deletion (C2) | Notification focus |
| `libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.ts` (+spec) | Navigate with `onboardingGenerationTarget` (B5a) | Generation launcher (Coupling) |
| `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts` (+spec) | Match a legacy wire `surfaceKind` (`'setup-wizard'`/`'harness-builder'`, `schemas.ts:24`) to the `onboarding` router at `:200` and `:268` through `resolveSurfaceAlias`-style mapping in core (`focusRouterKindFor`, exported next to the token) (B5a, L11) | Notification focus |
| `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` | `openConfigurationSurface() === 'onboarding'`, `setCurrentView('onboarding')`, label/title "Setup", selector kept (B5a) | Electron Setup hub button |
| `libs/frontend/chat/src/lib/components/molecules/global-config-actions.component.ts` (+spec) | Item id `onboarding`, label "Setup" (B5a) | Global configuration actions |
| `libs/frontend/chat/src/lib/components/templates/electron-shell.config-gate.spec.ts` | Expectations for `onboarding` | — |
| `libs/frontend/chat/src/lib/settings/settings.component.ts` + `.html` | Row "Run onboarding again" → `setCurrentView('onboarding')` (B5a) | Re-entry (user decision) |
| `libs/frontend/setup-wizard/src/index.ts` | B2: add `export type { GenerationViewState }` (`generation-workflow.store.ts:12`). B3a: add `WizardAnalysisRunner`, `findBoundGenerationTab`. B3b: add `GuidanceGenerationStore`, `GuidanceResultPanelComponent`. B5b: drop deleted exports, including `provideSetupWizardFocusRouter` (`:10`) | — |
| `libs/frontend/setup-wizard/src/lib/components/cards/enhanced-prompts-summary-card.component.ts` (+spec if present) | Input narrowed to `sections`; drop `usedFallback` and `totalTokens` badges (B3b, D9) | Legacy enhancement summary |
| `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts` (+spec) | `bind(binding, expectedRunId?)` (B3b) | Generation rebind |
| `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.ts` (+spec) | Expose `started` binding (B3b) | Combined countdown |
| `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` (+spec) | Remove unused `launchWizard` facade (removal item 3, B5b) | Wizard launch facade |
| `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts` and `setup-wizard/wizard-flow-state.ts` | Remove step-navigation members left with zero callers after B5b (verify each with `ptah_lsp_references`; keep message handling) | Dead after deletion |
| `libs/frontend/harness-builder/src/index.ts` | B2: add `BuilderSessionSectionComponent` (first consumer: DetailsLog, B2). B4a: add `BuilderStackProfileSectionComponent`, `BuilderApplySectionComponent`, `BuilderAiHelpersSectionComponent`, `BuilderPresetsSectionComponent`, `HarnessSessionController` (first consumers: proposal pages, B4b). B5b: drop deleted exports (`HarnessBuilderViewComponent`, `HarnessBuilderSidebarComponent`, `SetupHubComponent`) | — |
| `libs/frontend/harness-builder/src/services.ts` | B4a: add `HarnessSessionController` and its types. B5b: drop `HarnessBuilderFocusRouter`, `provideHarnessBuilderFocusRouter` (`:30-31`) | — |
| `libs/frontend/harness-builder/src/lib/services/harness-builder-records.service.ts` (+spec) | `session` record kind (read/write/clear, included in `clearTab` and `sweepOrphans`) (B4a) | Resume/rebind, drafts |
| `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.ts` (+spec) | `revisions` signal (C5) (B4a) | Revision recovery |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts` (+spec) | B4a: delegate tab creation/first send/retry to the controller, remove the `visibleTabs$` wait; navigation target stays `'harness-builder'` (`:355`). B5a: `navigateToBuilder` targets `onboarding` via `onboardingHarnessTarget` and the spec asserts the new URL | Hub AI Team Builder / New Project; first-turn bridge |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts` (+spec) | Error copy only if it names the hub (B4a); behaviour unchanged | Backend builder-open message |
| `libs/frontend/harness-builder/src/lib/components/sidebar/builder-apply-section.component.ts` (+spec) | `config` input, `applied` output (B4a) | Apply |
| `libs/frontend/harness-builder/src/lib/components/harness-builder-leave-dialog.component.ts` (+spec) | Add "uncertain stop" state (Retry stop / Keep current) (B4a) | Leave/switch; uncertain stop (spec §3.5.6) |
| `apps/ptah-extension-webview/src/app/app.routes.ts` (+`app.routes.spec.ts`, `app.spec.ts`) | B1: guard + `onboarding` route. B5b: delete old routes/imports, update header comment, drop old-route cases in `app.routes.spec.ts` (`:31-104`) | Entry/routing |
| `apps/ptah-extension-webview/src/app/webview-routing.spec.ts` | B1: new route + guard cases. B5a: legacy `initialView`/`SWITCH_VIEW` cases (`:368-380`) now land on `/onboarding`; `SURFACE_ROUTE_IDS` loop (`:90-97`) follows the new list | Entry/routing |
| `apps/ptah-extension-webview/src/app/app.config.ts` | B1: `provideOnboardingFirstRun()`. B5a: replace two focus-router providers with `provideOnboardingFocusRouter()` | Notification focus |
| `apps/ptah-extension-webview/src/app/initial-navigation.ts` (+spec if present) | B1: accept chat→onboarding settle at the restored-route comparison (`:117-125`, `:121`). B5a: `normalizeRestoredRoute` before `navigateToUrl` (`:109`) | Boot (spec §1.2, §1.3) |
| `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts`, `no-alpha-base-content.spec.ts` | Expectations for removed views / new lib | — |
| `eslint.config.mjs` | Add `@ptah-extension/onboarding/services` to `checkDynamicDependenciesExceptions` (B1) | — |
| `tsconfig.base.json` | Paths for both entries (B1) | — |
| `apps/ptah-electron/src/services/electron-setup-wizard.service.ts:79` (+spec `:17`) | `view: 'onboarding'` (B5a) | Electron launcher |
| `libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts:153` | `initialView: 'onboarding'` (B5a; permitted launcher literal) | VS Code `ptah.setupAgents` panel |
| `apps/ptah-extension-vscode/src/services/webview-html-generator.initial-view.spec.ts:97-108` | Legacy ids asserted as accepted aliases; `onboarding` accepted (B1/B5a) | Host validation |
| `apps/ptah-electron-e2e/src/support/ui-driver.ts`, `src/showcase/_harness/config-menu.ts`, `src/specs/config-menu/*.spec.ts` (3), `src/specs/tasks/message-handlers-eager.spec.ts`, `src/docs-screenshots/workspace-settings.shot.ts`, `src/showcase/setup-wizard-tour.scene.ts`, `src/specs/harness/new-project.spec.ts`, `new-project-dotnet.spec.ts`, `new-project-question-routing.spec.ts` | Selector/surface id migration to `onboarding` and new pages; typecheck only (B5b) | — |

### Delete (B5b), each checked against parity

| # | File(s) | Parity rows it carried → new owner |
| --- | --- | --- |
| 1 | `setup-wizard/.../components/wizard-view.component.ts` | Wizard step navigation; recovery section → stepper + A1 |
| 2-3 | `wizard-landing.component.ts` (+spec) | Landing cards, analysis provider pickers, saved analyses → Home tiles, A1 (removal 4 approved) |
| 4-5 | `welcome.component.ts` (+spec) | Saved list/use/hide, start analysis → A1 (removal 4) |
| 6-7 | `scan-progress.component.ts` (+spec) | Launch/single-flight/resume/fresh, phases, cancel confirm, retry/back/fresh → A1 + `WizardAnalysisRunner` |
| 8 | `analysis-activity-indicator.component.ts` | Activity → PhaseList + DetailsLog |
| 9 | `analysis-stats-dashboard.component.ts` | text/thinking/tool/error stats → DetailsLog header counts |
| 10-11 | `analysis-results.component.ts` (+spec) | Phase markdown/expand/duration, Continue, Resume generation, **Manual adjust** → A1 done (manual adjust kept) |
| 12-13 | `agent-selection.component.ts` (+spec) | Legacy duplicate selection/preview/packs → A2 |
| 14-15 | `agent-selection-list.component.ts` (+spec) | Recommendations, catalog retry, context source, owner conflict, preview, submit, packs → A2 + `AnalysisStepStore` |
| 16-17 | `generation-workflow-shell.component.ts` (+spec) | Embed main pane, start guard, stop override, rebind, origin consumption, 336px sidebar → A3/A4 + DetailsLog (guard/stop wired there) |
| 18-19 | `generation-agent-sidebar.component.ts` (+spec) | Model picker host, next-step preview, resume, outcomes → A2/A3 |
| 20-21 | `agent-run-card.component.ts` (+spec) | Per-agent card → `ItemStatusCard` |
| 22-23 | `agent-generation-progress.component.ts` (+spec) | Per-agent progress → `ItemStatusGrid` |
| 24 | `generation-progress.component.ts` | Legacy progress, retry budgets, transcript → A3 + DetailsLog |
| 25-26 | `guidance-run-card.component.ts` (+spec) | Guidance run card → A4 RunPanel |
| 27-28 | `generation-guidance-page.component.ts` (+spec) | Guidance page wiring → A4 page + stores |
| 29-30 | `prompt-enhancement.component.ts` (+spec) | Legacy auto-generate/retry/skip/continue → A4 pre-run state (kept). Detected stack → `getStatus`. Summary → per-section word counts and "N of 4 sections generated" from `getPromptContent` in the retained `EnhancedPromptsSummaryCardComponent` (D9). `totalTokens`, `usedFallback` badge and Quality Guidance row are dropped (user-approved, D9, see the table below) |
| 31-32 | `completion.component.ts` (+spec) | Completion facts, next steps, host close message → A3 terminal + A5 (posts `SETUP_WIZARD_COMPLETE`) |
| 33-34 | `workflow-card.component.ts` (+spec) | Only used by wizard landing (grep: `wizard-landing.component.ts`) → `PathTile` |
| 35-37 | `services/setup-wizard-focus-router.service.ts` (+spec), `.provider.ts` | Notification focus → `OnboardingFocusRouter` |
| 38-39 | `harness-builder/.../components/setup-hub.component.ts` (+spec) | Status/presets/refresh, all hub cards, intake form, conflicting-run consent → Home, intake page, leave dialog (removal 5 approved) |
| 40-42 | `harness-builder-view.component.ts` (+spec, +`.prompt-isolation.spec.ts`) | Builder page, embed, initialise, leave, retry entry, open chat, canvas tab request → proposal workspace + controller |
| 43-44 | `harness-builder-sidebar.component.ts` (+spec) | Sidebar composition → proposal workspace |
| 45 | `components/sidebar/builder-preview-section.component.ts` | Preview + revision recovery/unavailable → `ProposalPanel` |
| 46-48 | `services/harness-builder-focus-router.service.ts` (+spec), `.provider.ts` | Notification focus → `OnboardingFocusRouter` |
| 49 | `apps/ptah-electron-e2e/src/specs/setup-wizard.spec.ts` | Replaced by `onboarding.spec.ts` |
| 50 | `apps/ptah-electron-e2e/src/specs/setup-wizard/wizard-dom.spec.ts` | Replaced by `onboarding.spec.ts` |
| 51 | `apps/ptah-electron-e2e/src/specs/harness/harness-builder.spec.ts` | Replaced by `onboarding.spec.ts` + migrated new-project specs |

Total: **51 files deleted** = 48 production/spec files in the two libs (rows 1-48, including the 2
focus-router services and their 2 providers; specs are counted individually) + 3 e2e specs (rows
49-51). Kept on purpose: `tool-output-formatter.service.ts`
(public export, unused-candidate only; not proven dead, inventory "Dead or duplicated code"),
`harness:search-skills`/`create-skill` facades (removal 7: stay unsurfaced, not deleted).

Specs migrated (not deleted): `generation-workflow-launcher.service.spec.ts`,
`surface-router.service.spec.ts`, `surface-route-persistence.spec.ts`, `boot-navigation.spec.ts`
(only if it names legacy ids), `app-state.service.spec.ts`, `vscode.service.spec.ts` (if it names
legacy ids), `webview-surface.types.spec.ts`, `global-config-actions.component.spec.ts`,
`electron-shell.config-gate.spec.ts`, `harness-workflow-request.service.spec.ts`,
`harness-builder-records.service.spec.ts`, `harness-proposal-hydration.service.spec.ts`,
`builder-apply-section.component.spec.ts`, `harness-builder-leave-dialog.component.spec.ts`,
`generation-workflow.store.spec.ts`, `generation-handoff.store.spec.ts`, `wizard-rpc.service.spec.ts`,
`electron-setup-wizard.service.spec.ts`, `webview-html-generator.initial-view.spec.ts`, the four
webview app specs listed above.

### User-approved capability reductions

| Capability (parity-inventory "Legacy enhancement auto-generate/stack/summary…") | Old source | Decision | Approval |
| --- | --- | --- | --- |
| `summary.totalTokens` footer badge | `enhanced-prompts-summary-card.component.ts:94`, `rpc-setup.types.ts:519-520` | Dropped. The combined prompt carries no token count | User, D9, 2026-10-27 (`context.md` "Plan gate") |
| `summary.usedFallback` "fallback" badge | `enhanced-prompts-summary-card.component.ts:43-52`, `rpc-setup.types.ts:523-524` | Dropped. Not recoverable from content | User, D9, 2026-10-27 |
| Quality Guidance section row | `enhanced-prompts.service.ts:1434-1440` (summary only; `buildCombinedPrompt` omits it, `:1460-1482`) | Dropped | User, D9, 2026-10-27 |
| Per-section word counts, "N of 4 sections generated" | was `result.summary` from the awaited unbound call (`prompt-enhancement.component.ts:305-321`) | **Kept**, now derived from `getPromptContent` (C6) | User, D9 |
| `qualityScore` | `rpc-setup.types.ts:521-522`; not rendered by the old card | No UI change (never shown) | — |

## Batches

Ordering principle: additive first, cut-over last. Old surfaces stay reachable until B5b, so every
batch leaves every host compiling and the app usable. **Batches run strictly serially, one
frontend-developer at a time, in the order B1 → B2 → B3a → B3b → B4a → B4b → B5a → B5b.** The
lists below are not file-disjoint (see the ownership table), so none of them may be dispatched in
parallel. Each batch starts only after the previous batch's verification passed and was committed.

### Batch order and shared-file ownership

Dependencies (a batch may import only what exists when it starts):

| Batch | Needs from earlier batches | Supplies to later batches |
| --- | --- | --- |
| B1 | — | onboarding lib + `/services` (first-run only), `ONBOARDING_ROUTES` (shell + Home), `onboarding-routes.ts` builders/parser, `navigateToSurface` `queryParams`, `ViewType` `'onboarding'` |
| B2 | B1 lib scaffold | shared step components; `BuilderSessionSectionComponent` export (harness-builder `index.ts`); `GenerationViewState` type export (setup-wizard `index.ts`) |
| B3a | B1, B2 | A1/A2 pages + routes; `WizardAnalysisRunner`, `findBoundGenerationTab` exports |
| B3b | B1, B2, B3a | A3/A4/A5/guidance pages + routes; `GuidanceGenerationStore`, `GuidanceResultPanelComponent` exports; narrowed summary card; parser |
| B4a | B1 (`onboarding-routes.ts` types not yet used here) | `HarnessSessionController` (+ exports in `index.ts` and `services.ts`), `revisions`, apply `config`/`applied`, leave-dialog uncertain state, section-component exports |
| B4b | B1, B2, B4a | proposal pages + `new-project` / `team-builder` routes |
| B5a | B1-B4b (all destination pages exist) | legacy normalisation, all entry points and navigation targets switched, `OnboardingFocusRouter` (+ `/services` exports), resume store, widened token union |
| B5b | B5a | deletions, narrowed token union, final barrels, e2e migration |

Shared files edited by more than one batch (each edit is additive until B5b; the owner of a later
edit must rebase on the earlier one, never rewrite it):

| File | B1 | B2 | B3a | B3b | B4a | B4b | B5a | B5b |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `libs/frontend/onboarding/src/lib/onboarding.routes.ts` | create (shell, Home) | — | + `analyze`, `analyze/agents` | + `analyze/generate`, `analyze/guidance`, `analyze/done`, `guidance` | — | + `new-project`, `team-builder` subtrees | — | — |
| `libs/frontend/onboarding/src/services.ts` | create (first-run exports) | — | — | — | — | — | + focus router + provider | — |
| `libs/frontend/onboarding/src/lib/shell/onboarding-step-link.ts` (+spec) | create (within-owner copy) | — | + cross-owner transitions (A2 table) | — | — | — | — | — |
| `libs/frontend/onboarding/src/lib/home/onboarding-home.component.ts` | create | — | — | — | — | — | wire resume banners | — |
| `libs/frontend/setup-wizard/src/index.ts` | — | + `GenerationViewState` (type) | + runner, `findBoundGenerationTab` | + guidance store, result panel | — | — | — | − deleted exports, − `provideSetupWizardFocusRouter` |
| `libs/frontend/harness-builder/src/index.ts` | — | + `BuilderSessionSectionComponent` | — | — | + 4 sections, controller | — | — | − deleted views |
| `libs/frontend/harness-builder/src/services.ts` | — | — | — | — | + controller | — | — | − focus router + provider |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts` (+spec) | — | — | — | — | controller delegation, old target kept | — | target → onboarding | — |
| `libs/shared/src/lib/types/webview-surface.types.ts` (+spec) | + `'onboarding'` | — | — | — | — | — | alias move | — |
| `libs/frontend/core/src/lib/routing/surface-router.service.ts` (+spec) | + `queryParams` | — | — | — | — | — | `normalizeRestoredRoute`, parser swap | — |
| `libs/frontend/core/src/lib/tokens/surface-focus-router.token.ts` | — | — | — | — | — | — | widen | narrow |
| `libs/frontend/core/src/lib/routing/index.ts`, `libs/frontend/core/src/index.ts` | + `onboarding-routes` exports | — | — | — | — | — | adjust for `surface-routes.ts` removals | — |
| `apps/ptah-extension-webview/src/app/app.routes.ts` (+`app.routes.spec.ts`) | guard + `onboarding` route | — | — | — | — | — | — | − old routes |
| `apps/ptah-extension-webview/src/app/webview-routing.spec.ts` | + guard/route cases | — | — | — | — | — | legacy cases → onboarding | — |
| `apps/ptah-extension-webview/src/app/app.config.ts` | + `provideOnboardingFirstRun()` | — | — | — | — | — | focus providers swapped | — |
| `apps/ptah-extension-webview/src/app/initial-navigation.ts` | settle fix | — | — | — | — | — | `normalizeRestoredRoute` | — |
| `apps/ptah-extension-vscode/src/services/webview-html-generator.initial-view.spec.ts` | accepts `onboarding` | — | — | — | — | — | legacy ids as aliases | — |

Import audit at batch start (the executor confirms each with `ptah_code_search_symbols` before
writing the importing file):

- B2: `SessionEmbedComponent` (`@ptah-extension/chat`, public), `AnalysisTranscriptComponent`
  (`@ptah-extension/setup-wizard`, `index.ts:38`), `BuilderSessionSectionComponent` (exported **in
  B2** by this batch), `GenerationViewState` (declared at `generation-workflow.store.ts:12`, not
  exported; B2 adds the type-only export to `setup-wizard/src/index.ts`).
- B3a: `ConfirmationModalComponent` (`:37`), `GenerationModelPickerComponent`,
  `CommunityPacksPanelComponent`, `AgentPreviewDialogComponent`, `GenerationSourceStatusComponent`,
  `AgentGenerationStore`, `GenerationWorkflowStore` (already exported). `WizardAnalysisRunner` and
  `findBoundGenerationTab` are exported **in B3a**. `GenerationWorkflowLauncherService` comes from
  `@ptah-extension/chat-ui` (`index.ts:2`).
- B3b: `AgentNextStepsComponent`, `GenerationHandoffStore`, `EnhancedPromptsSummaryCardComponent`
  (already exported). `GuidanceGenerationStore` and `GuidanceResultPanelComponent` are exported **in
  B3b**.
- B4b: `HarnessBuilderLeaveDialogComponent` (already exported). Sections and the controller are
  exported **in B4a**. `formatIntakeSummary` is already exported.
- B5a: `onboardingGenerationTarget` / `onboardingHarnessTarget` (B1). The proposal pages (B4b) and
  the A2/A4 pages (B3a/B3b) exist before the targets switch.
- B1, B4a: no cross-lib import that does not exist on `main`.

### Verification matrix

`scripts/verify.mjs` runs `nx run-many` over exactly the `-p` list, with default targets
`lint,test,typecheck` (`scripts/verify.mjs:79-88`). It does not add dependents. Each row therefore
lists source-impact coverage by hand: projects that import a changed library, plus implicit-only
dependents chosen explicitly (`ptah-electron` for the renderer in every row, `ptah-video-studio`
only where electron-e2e files change). The exclusions are stated below the table. Each batch runs at most two commands, both under the verify lock:

- **(F)** full targets for libraries and the renderer, whose `test` targets have no build
  prerequisite;
- **(L)** `-t lint,typecheck` for host apps whose `test` depends on a build (`ptah-tui` → `build`;
  `ptah-electron` → `build-main` + workers; `ptah-extension-vscode` → `build-esbuild`; `ptah-cli`
  → `build-esbuild` + workers), for `ptah-electron-e2e` (no `test`) and for `ptah-video-studio`
  (no `test`).

No `build`, `serve`, `e2e` or `package` target runs. A host spec that a batch edits is run as one
Jest file under the lock, with no Nx build dependency:
`npm run verify -- --exec --task <name> -- npx jest -c <app>/jest.config.<ts|cjs> --testPathPatterns=<file> --coverage=false --maxWorkers=2`
(`npm run verify` is `node scripts/verify.mjs`, `package.json:41`; `--exec` takes the shared lock
and runs the command after the second `--`, `scripts/verify.mjs:53-56`, `:197-202`).
That this works without the build output is an **Assumption**. If the file fails only because a
built artefact is missing, record it as "not run locally (needs build)" for the PR test plan
instead of running the build. The pre-push hook and CI run the full host tests. Confirm that each
header reads "Running target(s) … for N projects" with N equal to the length of the list.

| Batch | Changed projects | Dependents added | (F) command | (L) command | Single host specs |
| --- | --- | --- | --- | --- | --- |
| B1 | shared, core, onboarding (new), webview; vscode spec; root `eslint.config.mjs`, `tsconfig.base.json` | shared → vscode, electron, tui, cli, electron-e2e. core change is additive (optional `queryParams`, new exports); its frontend dependents compile through the webview typecheck | `npm run verify -- -p @ptah-extension/shared,@ptah-extension/core,@ptah-extension/onboarding,ptah-extension-webview` | `npm run verify -- -t lint,typecheck -p ptah-electron,ptah-extension-vscode,ptah-tui,ptah-cli,ptah-electron-e2e` | `webview-html-generator.initial-view.spec.ts` (vscode, `jest.config.ts`) |
| B2 | onboarding, harness-builder and setup-wizard (`index.ts` exports) | → webview → electron | `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/harness-builder,@ptah-extension/setup-wizard,ptah-extension-webview` | `npm run verify -- -t lint,typecheck -p ptah-electron` | — |
| B3a | onboarding, setup-wizard (`index.ts`) | → webview → electron | `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/setup-wizard,ptah-extension-webview` | `npm run verify -- -t lint,typecheck -p ptah-electron` | — |
| B3b | onboarding, setup-wizard (stores, card, `index.ts`) | → webview → electron | `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/setup-wizard,ptah-extension-webview` | `npm run verify -- -t lint,typecheck -p ptah-electron` | — |
| B4a | harness-builder | → onboarding (consumes its barrel), webview → electron | `npm run verify -- -p @ptah-extension/harness-builder,@ptah-extension/onboarding,ptah-extension-webview` | `npm run verify -- -t lint,typecheck -p ptah-electron` | — |
| B4b | onboarding | → webview → electron | `npm run verify -- -p @ptah-extension/onboarding,ptah-extension-webview` | `npm run verify -- -t lint,typecheck -p ptah-electron` | — |
| B5a | shared, core, chat-ui, chat, onboarding, harness-builder, agent-generation, webview, electron (service + spec), vscode spec | Token implementers: setup-wizard, harness-builder, mcp-apps-page (`apps-focus-router.service.ts`). shared → vscode, electron, tui, cli, electron-e2e. agent-generation → vscode, electron, cli, tui (via cli-engine). The edit is a literal in a `string`-typed field (`vscode-core/src/api-wrappers/index.ts:41-42`), so the backend libs between them need no separate run | `npm run verify -- -p @ptah-extension/shared,@ptah-extension/core,@ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/onboarding,@ptah-extension/harness-builder,@ptah-extension/setup-wizard,@ptah-extension/agent-generation,ptah-extension-webview` | `npm run verify -- -t lint,typecheck -p @ptah-extension/mcp-apps-page,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-electron-e2e` | `electron-setup-wizard.service.spec.ts` (electron, `jest.config.ts`); `webview-html-generator.initial-view.spec.ts` (vscode) |
| B5b | setup-wizard, harness-builder (deletions, barrels), core (token narrow), onboarding (e2e-facing selectors only, if touched), webview (routes + specs), electron-e2e (migrations, new spec, showcase scene) | Token implementers: mcp-apps-page; core consumer of `kind`: chat (`chat-attention-host-message-handler.service.ts:200`, `:268`). electron-e2e → video-studio (implicit) | `npm run verify -- -p @ptah-extension/setup-wizard,@ptah-extension/harness-builder,@ptah-extension/core,@ptah-extension/chat,@ptah-extension/onboarding,ptah-extension-webview` | `npm run verify -- -t lint,typecheck -p @ptah-extension/mcp-apps-page,ptah-electron,ptah-electron-e2e,ptah-video-studio` | — |

`ptah-extension-vscode-e2e` is left out of every row: it has only a `lint` target and imports none
of the changed libraries. `ptah-video-studio` is listed only in B5b, the one batch that edits
electron-e2e files (it has an implicit dependency on that project and no static import of any
changed library).

### B1 — Core routing, flag, guard, tracker, lib scaffold, shell + Home tiles

- Files: lib scaffold, `src/index.ts`, `src/services.ts` (first-run exports only),
  `onboarding.routes.ts` (shell + Home only), `first-run/*`, `shell/*`,
  `home/onboarding-home.component.ts`, `home/path-tile.component.ts`; `webview-surface.types.ts`
  (+spec, additive `onboarding`), `core/routing/onboarding-routes.ts` (+spec),
  `surface-router.service.ts` (+spec, `queryParams` only), `core` index exports, `app.routes.ts`
  (guard + onboarding route; old routes untouched), `app.config.ts` (`provideOnboardingFirstRun()`),
  `initial-navigation.ts` (settle fix at `:117-125`), `eslint.config.mjs`, `tsconfig.base.json`,
  `webview-html-generator.initial-view.spec.ts` (accepts `onboarding`), `app.spec.ts` /
  `app.routes.spec.ts` / `webview-routing.spec.ts` (new route + guard cases).
- Executor: frontend-developer.
- Verify: B1 row of the verification matrix.
- Acceptance:
  - Electron, empty flag: boot to `chat` (host default or restored `/chat`) lands on `/onboarding`;
    `shownAt` is written exactly once, after arrival; a second boot lands on chat.
  - Superseded boot (SWITCH_VIEW during redirect) leaves `shownAt` unset.
  - VS Code (`isElectron` false): guard returns `true`.
  - Storage probe failure or unreadable record: no redirect; late write failure: chat reachable.
  - Deep link to another surface never runs the guard.
  - `navigateToSurface('onboarding', [...], { queryParams })` serialises the query; `already-there`
    still detected with identical query.
  - `src/services.ts` names no file under `src/lib/focus/` (it does not exist yet).
- Tests: tracker state-machine table (each row), guard (Electron/VS Code/eligible/suppressed),
  flag service (probe, invalid JSON, write failure), initial-navigation restored `/chat` → onboarding
  accepted, onboarding-routes builders/parser (valid, colon, slash, unknown path).

### B2 — Shared step/status/log components

- Files: `shared/onboarding-stepper`, `run-status-chip`, `run-panel`, `step-meter`,
  `item-status-card`, `item-status-grid`, `details-log`, `recovery-screen`, `owner-conflict-banner`,
  `home/resume-banner.component.ts` (presentational only);
  `libs/frontend/harness-builder/src/index.ts` (additive export of
  `BuilderSessionSectionComponent`, the DetailsLog header); `libs/frontend/setup-wizard/src/index.ts`
  (additive `export type { GenerationViewState }`, used by `chipStateFor`).
- Executor: frontend-developer.
- Verify: B2 row of the verification matrix.
- Acceptance: all presentational (inputs/outputs only, OnPush, signals, `@if`/`@for`); stepper
  completed steps are links named "<Step>, completed"; progressbar has min/max/now/label; status
  glyph always paired with text; DetailsLog mounts the embed only while open and releases it on
  close; reduced-motion disables animation; 32px targets; DetailsLog imports
  `BuilderSessionSectionComponent` only through `@ptah-extension/harness-builder` (no relative
  cross-lib path).
- Tests: stepper a11y attributes and narrow strip; chip mapping for every `GenerationViewState`;
  item card status map (pending/running/written/unchanged/failed), "Attempt a of b" hidden without a
  budget; DetailsLog lazy mount/unmount.

### B3a — Analyze A1 + A2

- Files: `analyze/analysis-step.store.ts` (+spec), `analyze-workspace.page.ts` (+spec),
  `phase-list.component.ts`, `choose-agents.page.ts` (+spec), `agent-recommendation-list.component.ts`,
  `overwrite-preview.component.ts`; `onboarding.routes.ts` (adds `analyze`, `analyze/agents`);
  `setup-wizard/src/index.ts` (add `WizardAnalysisRunner`, `findBoundGenerationTab` exports);
  `shell/onboarding-step-link.ts` (+spec; B1 created it with within-owner copying, B3a adds the
  cross-owner transition table from A2).
- Executor: frontend-developer.
- Verify: B3a row of the verification matrix.
- Acceptance: four phase rows from returned ids, all five statuses rendered, "Phase n of N" from
  payload; no percent; elapsed only session-local; counters only while attached; saved analyses
  list/use/hide (transient); Interrupted panel with Continue/Start fresh; Stop opens confirmation;
  Manual adjust present on the completed state with the coming-soon modal; A2 grouped list, match %
  hidden outside 0..1, select recommended/clear/n selected, preview sheet refreshed on open and before
  confirm, owner conflict banner, community packs, agent-only banner with "Analyze first"; submit
  navigates to A3 with `tab` and `run`.
- Tests: store selectAnalysis (valid/not-found), unfinished run never substituted for selection,
  catalog vs analysis source, preview refresh-before-confirm, rejection → banner, furthest-step
  forward respects explicit back; `onboardingStepLink` never emits the agent `run` on an
  agent→guidance transition and always sets `gen`.

### B3b — Analyze A3, A4, A5 and guidance-only

- Files: `analyze/generation-step.store.ts` (+spec), `analyze/guidance-section-counts.ts` (+spec),
  `generate-agents.page.ts` (+spec), `project-guidance.page.ts` (+spec), `analyze-done.page.ts`
  (+spec); `onboarding.routes.ts` (adds `analyze/generate`, `analyze/guidance`, `analyze/done`,
  `guidance`); `generation-workflow.store.ts` (+spec), `generation-handoff.store.ts` (+spec),
  `cards/enhanced-prompts-summary-card.component.ts` (narrowed input, D9),
  `setup-wizard/src/index.ts` (add `GuidanceGenerationStore`, `GuidanceResultPanelComponent`).
- Executor: frontend-developer.
- Verify: B3b row of the verification matrix.
- Acceptance: every row of the spec §3.6 generation table on reload (starting, running, cancelling,
  cancelled, failed, timed-out, completed, no state); Stop enabled during `starting`; completed cards
  from `result.agentOutcomes`/`counts` with `fileName` (not `filePath`); countdown Start now/Skip;
  handoff routes to A4 with `tab` = guidance tab, `run` = handoff-started run, `gen` = agent tab;
  A4 rebinds an already-started run (`?run`, handoff `started`, authoritative run, in that order)
  and auto-starts only when none exists and the handoff did not end in `manual-recovery`; Skip → A5,
  Retry on failure, Continue on done; Stop/reload/owner conflict available for every guidance run;
  detected stack from `getStatus`; on confirmed completion of the bound run the summary card shows
  four section rows with word counts and "N of 4 sections generated", and never a token count,
  fallback badge or Quality Guidance row; counts are hidden when content is null, guidance is
  disabled, the run-state lookups before/after the read do not both return run A completed (another
  run settled or active, service busy), `generatedAt` moved between the status reads, or after a
  webview reload; A5 sets `completedAt`, Open chat posts `SETUP_WIZARD_COMPLETE`.
- Tests: rebind with mismatched `run` → recovery; reload of each lifecycle; handoff `started`
  exposure; handoff-started run rebound without a second `runWizard`; parser required cases (C6);
  every required `captureGuidanceSections` case in C6 (B completes before the first read, B active
  during capture, the service lock held, a same-tab new run, `generatedAt` moving between the
  status reads, disable mid-capture, null content, RPC throw, a late-bound completed run never
  captured, happy path); `guidanceSections()` hidden when the workspace result advances while the
  local run stays A; summary card renders without `totalTokens`/`usedFallback`.

### B4a — Harness services: controller, records, hydration, request service

- Files: `harness-session.controller.ts` (+spec), `harness-builder-records.service.ts` (+spec),
  `harness-proposal-hydration.service.ts` (+spec), `harness-workflow-request.service.ts` (+spec;
  controller delegation only, target unchanged), `harness-workflow-message.handler.ts` (+spec, copy
  only), `builder-apply-section.component.ts` (+spec), `harness-builder-leave-dialog.component.ts`
  (+spec), `harness-builder/src/index.ts` (additive: `BuilderStackProfileSectionComponent`,
  `BuilderApplySectionComponent`, `BuilderAiHelpersSectionComponent`, `BuilderPresetsSectionComponent`,
  `HarnessSessionController`), `src/services.ts` (additive: `HarnessSessionController` and its types).
- Executor: frontend-developer (frontend services; no backend change).
- Verify: B4a row of the verification matrix.
- Acceptance: first send happens with no mounted transcript; sending idempotent per tab+intake hash;
  10 s readiness timeout → `failed` + Retry send; reconcile before Retry; stop returns `uncertain` on
  abort failure and nothing else proceeds; record round-trips through zod and is cleared with the tab;
  `revisions` ordered and folded without user overrides; request service no longer waits on
  `visibleTabIds`; `navigateToBuilder` still calls `navigateToSurface('harness-builder', [mode,
  tabId])` (`:355`) and the old builder works end to end until B5b.
- Tests: controller start (new project, team builder), reuse, conflict, timeout, reconcile,
  stop/uncertain, restore outcomes (all six); records session kind; hydration revisions; apply
  section `config` input + `applied` output; request-service spec still asserts the
  `harness-builder` target.

### B4b — New project and AI team builder UI

- Files: `proposal/*` (store, intake, team start, workspace, panel, section, item, revision history,
  answer dock, review/apply, review summary, apply result); `onboarding.routes.ts` (adds
  `new-project`, `team-builder` subtrees).
- Executor: frontend-developer.
- Verify: B4b row of the verification matrix.
- Acceptance: three sources visibly separated; intake facts only in new project and hidden after
  reload when the stack record is absent; New/Changed tags compare folded snapshots only; Review
  enabled once an initialised nonempty proposal exists; Apply tied to the reviewed revision, newer
  revision banner, completeness note non-blocking; apply result with paths/copy, warnings, health
  refresh; Done sets `completedAt`; cross-mode dialog (Save draft and stop / Discard and stop /
  Cancel; uncertain stop state); answer dock modal sheet ≤720px with inert background, trap, Esc,
  focus return, "Reply sent" announcement; Details log shows "Your brief" and session stats.
  The pages are reachable by URL only; no entry point targets them until B5a.
- Tests: `diffHarnessConfig`; review stale-revision banner; dock sheet focus behaviour; intake
  validation and platform→stack reset; restore revision writes user overrides.

### B5a — Cut-over: legacy normalisation, entry points, navigation targets, focus, resume

- Files: `webview-surface.types.ts` (+spec, alias move), `surface-routes.ts`, `surface-router.service.ts`
  (+spec), `surface-route-persistence.ts` (+spec), `app-state.service.ts` (+spec),
  `surface-focus-router.token.ts` (**widen** to `'setup-wizard' | 'harness-builder' | 'onboarding' |
  'mcp-apps'`), `core` index files (removed `generationRouteBinding` export),
  `generation-workflow-launcher.service.ts` (+spec), `harness-workflow-request.service.ts` (+spec;
  target → `onboardingHarnessTarget`), `chat-attention-host-message-handler.service.ts` (+spec;
  legacy `surfaceKind` match, L11), `electron-shell.component.ts`, `electron-shell.config-gate.spec.ts`,
  `global-config-actions.component.ts` (+spec), `settings.component.ts`/`.html`,
  `focus/onboarding-focus-router.*` (+spec), onboarding `src/services.ts` (add focus router +
  provider exports), `home/onboarding-resume.store.ts` (+spec), `onboarding-home.component.ts`
  (wire resume banners), `app.config.ts` (focus providers swapped), `initial-navigation.ts`,
  `webview-routing.spec.ts` (legacy cases), `electron-setup-wizard.service.ts` (+spec),
  `webview-lifecycle.service.ts`, `webview-html-generator.initial-view.spec.ts`.
- Executor: frontend-developer (the two host literals are one-line string edits within the same
  batch; no backend logic changes).
- Verify: B5a row of the verification matrix.
- Acceptance: `SWITCH_VIEW`/`initialView` `setup-hub|setup-wizard|harness-builder` land on Home;
  saved routes `/setup-hub/...`, `/setup-wizard/generation/...`, `/harness-builder/...` land on Home;
  host allow-list still accepts them; menu opens `onboarding` with selector
  `config-menu-item-setup-hub` and label "Setup"; Settings row reopens onboarding; notification focus
  for generation and harness sessions lands on the owning step with identity; launcher navigation
  uses `?tab=`; `harness:open-workflow` lands on `/onboarding/<mode>/workspace?tab=`; resume banners
  show only the latest pair, bound tabs and harness records; the old focus-router classes still
  compile against the widened union (they are no longer provided).
- Tests: alias resolution at all three normalisation points; restored legacy route; persistence
  validator on new URLs; focus router both workflows; resume store bounded sources; request-service
  target; webview-routing legacy landing; attention handler matches a legacy `surfaceKind` to the
  onboarding router.

### B5b — Deletions, narrowed contracts, exports, spec and e2e migration

- Files: the 51 deletions (including both old focus-router services, specs and providers);
  `surface-focus-router.token.ts` (**narrow** to `'onboarding' | 'mcp-apps'`, same batch as those
  deletions); `app.routes.ts` (remove old routes/imports, comment) + `app.routes.spec.ts`,
  `unit5-message-routing.spec.ts`, `no-alpha-base-content.spec.ts`; `setup-wizard/src/index.ts`,
  `harness-builder/src/index.ts`, `harness-builder/src/services.ts`; `wizard-rpc.service.ts` (+spec,
  drop `launchWizard`); `setup-wizard-state.service.ts` / `wizard-flow-state.ts` dead members; e2e
  migrations and the new `onboarding.spec.ts`.
- Executor: frontend-developer.
- Verify: B5b row of the verification matrix. The e2e project gets lint/typecheck only. Running
  e2e needs the user's permission (CLAUDE.md).
- Acceptance: no remaining import of a deleted symbol (`ptah_lsp_references` / typecheck clean);
  every parity row of `parity-inventory.md` maps to a file in this plan (team-leader checklist);
  `harness:search-skills`/`create-skill` facades untouched; webview initial bundle no longer contains
  the harness-builder views (unit5 spec); no implementer of `SurfaceFocusRouter` uses a legacy kind.
- Tests: deleted specs removed; migrated specs green; new e2e compiles.

## Failure behaviour

| Situation | Behaviour |
| --- | --- |
| Reload on any step | Page rebinds from URL identity and authoritative RPC state (A5 table); facts without a source are hidden, never estimated (specimen rule) |
| Reload during guard redirect | Flag unchanged unless the replacement navigation ended on `/onboarding`; next boot redirects again (once-only holds because commit happens on arrival) |
| Cancel (generation/guidance) | `GenerationWorkflowStore.stop()` → `cancelling` → polls until terminal; uncertain → "Checking run state"; Stop before accept is honoured (store `pendingStop`, `generation-workflow.store.ts:296-300`) |
| Cancel (analysis) | Confirm dialog → `WizardAnalysisRunner.cancel()`; lost original RPC with running manifest → "may still be running" with Stop and Resume; no second run until Stop confirmed |
| Cancel (harness) | `stop()` → `chat:abort`; failure → `uncertain`; leave/switch dialog stays with Retry stop / Keep current; nothing started, no draft deleted |
| Conflicting workflow | Generation: backend `rejection.reason === 'blocked'` with `ownerTabId` → `OwnerConflictBanner` (Open it via launcher/focus router, Retry). Chat busy on the bound tab → store `chatTurnRejection` shown in RunPanel. Harness: cross-mode dialog; new flow starts only after stop confirmed |
| Missing tab | Recovery screen: generation "Start over" (A2/guidance entry), harness "Restore from draft" if a draft pointer exists, else "Start over" |
| Foreign tab / workspace mismatch | Tab bound to another workspace or wrong workflow → recovery `workspace-mismatch` / wrong mode; never silently rebinds to the active workspace |
| Stale run (`?run` ≠ authoritative) | Recovery "This run is no longer current" with Open latest (rewrites `run` with `replaceUrl`) |
| Session exists, proposal unavailable | "Proposal unavailable" + Propose again (prefills composer, does not auto-send, parity row) |
| First send lost | `failed` + Retry send after reconcile; idempotent per tab+intake hash |
| Storage failure (flag) | No redirect; late write failure → in-memory suppression |
| Storage failure (harness records) | Save draft / session record write returns false → dialog shows save error, old session kept (spec §3.5.6) |
| Status fetch fails on Home | Only chips replaced by "Status unavailable, Retry"; tiles stay usable; no workspace → tiles disabled with reason |
| Superseded navigation | Router cancel (`SupersededByNewNavigation`) clears the tracker; page-level async work guards with a generation counter / `DestroyRef` so a late result never writes into a newer binding (existing pattern: hydration `generation`, `harness-proposal-hydration.service.ts:155-216`) |
| Workspace switch while on onboarding | Configuration surface remount (`electron-shell.component.ts:534-550`); pages revalidate identity → mismatch recovery for bound flows; Home re-reads status |
| Notification for a session in another workspace | `OnboardingFocusRouter` switches workspace first (as both current routers do), then navigates with identity |
| Guidance section counts unattributable (D9) | Either runless `getRunState` lookup around the content read does not return run A `completed` (another run settled or active, service busy, rejection), content `null` (disabled/absent), RPC error, `generatedAt` moved between the bracketing status reads, binding or run changed, marker or all canonical headings missing, or a webview reload → the summary card is hidden; the done view still shows detected stack, View, Download, Regenerate and the enable toggle. No error banner: the absence is expected, not a failure |

## Host impact

| Host | Reference | Change | Smallest change to keep compiling/working |
| --- | --- | --- | --- |
| Electron main | `apps/ptah-electron/src/services/electron-setup-wizard.service.ts:78-80` | `view: 'setup-wizard'` → `'onboarding'` | String literal + spec `electron-setup-wizard.service.spec.ts:17` |
| Electron main | `apps/ptah-electron/src/preload.ts:47` | none (boot unchanged, spec §1.2) | — |
| Electron main | `apps/ptah-electron/src/ipc/ipc-bridge.state.spec.ts:65,75` | none (route strings are opaque test data) | — |
| Electron renderer | `electron-shell.component.ts:288-306`, `:616-618`; `global-config-actions.component.ts:84-92` | Menu → `onboarding`, label "Setup", selector kept | Covered in B5a |
| VS Code host | `libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts:153` | `initialView: 'onboarding'` (Home; no auto-run) | String literal (type is `string`, `vscode-core/src/api-wrappers/index.ts:41-42`) |
| VS Code host | `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:125-131` | none (validates via shared predicate; aliases accepted) | Spec only: `webview-html-generator.initial-view.spec.ts:97-108` |
| VS Code host | `apps/ptah-extension-vscode/src/core/ptah-extension.ts:174` (`orchestra-canvas`) | none (alias kept, now via `LEGACY_SURFACE_TARGETS`) | — |
| VS Code webview | Guard returns `true` (`isElectron` false); entry via `ptah.setupAgents` panel and the project setup card (`setup-status.store.ts:112-125` → `setup-wizard:launch` → panel) | Lands on Home | No auto-run (spec D16) |
| TUI | `apps/ptah-tui` | none (no Angular surface; no reference to surface ids; imports `@ptah-extension/shared` and `cli-engine`, which reaches `agent-generation`) | `-t lint,typecheck` in B1 and B5a (its `test` depends on `build`, `apps/ptah-tui/project.json:110-121`) |
| CLI | `apps/ptah-cli` | none (imports `shared` and `agent-generation`; no surface ids) | `-t lint,typecheck` in B1 and B5a (its `test` depends on builds) |
| Backend RPC/events | all `setup-wizard:*`, `enhancedPrompts:*`, `harness:*` | none | — |

## Risks

| # | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| R1 | Tracker misses Angular's redirect sequence (e.g. a future Router emits no `NavigationStart` for the replacement) and `shownAt` is never written → onboarding on every boot | Low / High | Unit test against real `Router` with `provideRouter` (not mocks) asserting the exact event sequence for v22.2.3; Electron e2e "redirect once" case |
| R2 | Restored `/chat` boot treated as a failed restore (`initial-navigation.ts:117-125`, comparison `:121`) | Certain without fix / High | B1 settle fix + test (already in plan) |
| R3 | Bound guidance returns no `summary`, so section counts are derived from stored content: a parse can miss sections if generated text contains a canonical `### <Name>` line out of place, and counts are hidden after a reload, when guidance is disabled, or when another run commits in between | Low / Low (user accepted the D9 tradeoff; `totalTokens`, `usedFallback`, Quality Guidance are approved losses) | Pure parser with the C6 required cases; bracketing `getStatus` reads and the `generatedAt` key; nothing is shown when attribution fails |
| R10 | Per-batch checks miss a dependent because `verify.mjs -p` adds none (`scripts/verify.mjs:79-88`) | Medium / Medium | Verification matrix lists dependents per batch; the pre-push hook and CI run the full host tests |
| R11 | Single-file host Jest runs need build output the batch may not produce | Medium / Low | Labelled an assumption; a failure caused only by a missing artefact is reported as not run, never fixed by running a build |
| R12 | Another process (e.g. `ptah-cli`) writes guidance for the same workspace around A's completion, outside this process-local supervisor's view | Low / Low | The `generatedAt` sandwich catches a write that completes after the first status read; an earlier external write cannot be detected without a backend run/content version (out of scope). Documented residual, raised at the plan gate (C6) |
| R4 | Headless send behaves differently from the embed send (e.g. a service assumes a mounted ChatView) | Medium / High | Controller test with real `ChatStore` dispatch seam; e2e new-project spec migration; `attachView()` keeps chunk delivery |
| R5 | First-run users without credentials land on onboarding, not Settings (`app-shell.component.ts:290-305` skips when not on chat) | High / Medium | Provider/model pickers exist on each start screen; recommend (not in spec) a follow-up "Connect a provider" hint on Home — listed as a lane constraint candidate, not implemented |
| R6 | Live tokens do not stream into the Details log/dock off the chat surface (root flush gate, `app.config.ts:191`) | Certain / Low | Same as today's setup-wizard surface; dock shows the finalized turn and a busy chip |
| R7 | Bound guidance resolves context itself (`GenerationContextSource`), so a user-selected older analysis may yield "workspace-discovery: not-latest" | Medium / Low | Source line shown on A4 (`GenerationSourceStatusComponent`) |
| R8 | Legacy alias table kept forever | Medium / Low | Follow-up task "remove legacy surface aliases" next release (spec §1.3) |
| R9 | Deleting e2e specs/showcase scene affects marketing pipeline | Low / Medium | Scene migrated, not deleted |

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | New lib `libs/frontend/onboarding` with `/services` secondary entry | Restructure setup-wizard + harness-builder into one lib | Spec §5; eager/lazy split rule `eslint.config.mjs:258-287`; only the app imports either lib | Yes |
| D2 | `HarnessSessionController` in `harness-builder`, not onboarding | Put it in onboarding (cycle via `HarnessWorkflowRequestService`) | `harness-workflow-message.handler.ts:62-83` drives the request service from an eager handler | Yes |
| D3 | Legacy ids stay wire-legal `ViewType` members via the existing alias pattern | Drop them from `ViewType` and add a separate string alias map | `webview-surface.types.ts:26-33`, `:93`; host validation already accepts aliases | Yes |
| D4 | Guard is `canActivate` on the `chat` parent route | `canMatch` returning a `UrlTree` (also a redirect; only a `false` result falls through to `**` → chat, `app.routes.ts:231-232`) | The repository uses `canMatch` only to keep a lazy chunk from loading on a refused match (`electron-only-surface.guard.ts:9-13`). `chat` is component-less with eager children, so that benefit does not apply. `canActivate` runs once, after recognition, for both `''` and `:tabId` children, which is where the tracker records the navigation id | Yes |
| D5 | `shownAt` committed by a navigation-id tracker | Commit in guard; commit on any onboarding `NavigationEnd` | Review r2 blocker; `_router-chunk.mjs:1879-1883` | Yes |
| D6 | `onboarding` replaces `setup-hub` as a configuration surface | Make it workspace-sliced | `app-state.service.ts:60-70`; menu items are typed `ConfigurationSurfaceId` (`global-config-actions.component.ts:94`) | Yes |
| D7 | Launcher agent target is A2 with `?tab=`; A2 forwards to A3 when a run exists | Target A3 directly | Launcher does not know the run state; one forward rule also serves focus and `setup-generation:open` | Yes |
| D8 | Details log reuses `SessionEmbedComponent` (bare, read-only guard) mounted only while open | New transcript renderer | `session-embed.component.ts:38-140`; avoids a second message renderer; mount-on-open keeps cost bounded | Yes |
| D9 | **Decided by user 2026-10-27** (`context.md` "Plan gate"). Guidance always runs bound (Stop, reload, owner conflict). After confirmed completion of the current bound run, `GenerationStepStore.captureGuidanceSections` reads `enhancedPrompts:getPromptContent`, `parseGuidanceSectionCounts` keeps only the `## Project-Specific Guidance` region, and the retained `EnhancedPromptsSummaryCardComponent` shows the 4 canonical sections with word counts and "N of 4 sections generated". Detected stack comes from `getStatus`. No counts are shown for null/disabled content, a stale or different run, or after a reload. Dropped with approval: `totalTokens`, the `usedFallback` badge, the Quality Guidance row. This overrides the design-spec §3.6 "retained final response only" source rule | (a) Legacy awaited unbound call (full summary; loses Stop/reload/owner conflict), rejected by the user. (b) No counts for bound runs, rejected as an unapproved parity loss (review r0 #6) | Bound start returns only an ack (`enhanced-prompts-rpc.handlers.ts:262`, `:624`); run attribution by runless `getRunState` (`:882-897`; supervisor `guidance-generation-run.supervisor.ts:94-95`, `:145-179`); content RPC `:907-950`; core prefix `enhanced-prompts.service.ts:891-901`; layout `:1460-1482`; word rule `:1408-1409` | Yes (frontend only; the parser and card change can be reverted) |
| D10 | Team-builder start sends the user intent as the visible first message with the `contextOnly` preamble | Use `intent` variant of `harness:workflow-prompt` | Mirrors new-project (hidden preamble + visible message), `rpc-harness.types.ts:533-546` | Yes |
| D11 | Reuse `harness-builder-leave-dialog` for the cross-mode dialog | New dialog | Already has `switch`/`new-project` contexts and save/discard/cancel (`harness-builder-leave-dialog.component.ts:123-131`) | Yes |
| D12 | Restore earlier revision writes user overrides (existing snapshot record) | New backend revert | No backend change allowed; overrides already outrank revisions in hydration | Yes |
| D13 | Remove only `WizardRpcService.launchWizard` (removal item 3) | Remove the RPC | `setup-wizard:launch` still called by `setup-status.store.ts:117` | Yes |
| D14 | Invalid flag JSON counts as absent (eligible) and is overwritten on commit | Treat as shown | A corrupt record is not a storage failure; worst case one extra showing | Yes |

## Lane-introduced constraints

Additions beyond the spec and user decisions (each is reversible and listed for the reviewer):

| # | Constraint | Why |
| --- | --- | --- |
| L1 | A2 also accepts `?tab=` (spec lists only `analysis`/`source`) | Launcher, focus router and `setup-generation:open` need a tab-carrying agent entry (D7) |
| L2 | `onboarding` added to `SURFACE_ROUTE_IDS` directly after `chat` | Ordering is asserted by `webview-surface.types.spec.ts:24-37` |
| L3 | `initial-navigation.ts` accepts a chat→onboarding settle as landed | Otherwise first run is hidden (R2) |
| L4 | Proposal flow store is route-scoped per flow; the generated document is lost when leaving the flow (same as today's builder view) | No persisted source for helper documents |
| L5 | `BuilderApplySectionComponent` gains `config` input and `applied` output | Apply must be tied to the reviewed revision (spec §3.3) |
| L6 | Leave dialog gains the uncertain-stop state | Spec §3.5.6 requires it; the dialog is reused (D11) |
| L7 | A5 Open chat posts `SETUP_WIZARD_COMPLETE` | Preserves VS Code panel close (`completion.component.ts:512-516`) |
| L8 | Focus-router token kind is widened in B5a and narrowed to `'onboarding' \| 'mcp-apps'` in B5b; wire `surfaceKind` enum unchanged | Keeps the old routers compiling until deleted (review r0 #2); the attention handler compares `kind` (`chat-attention-host-message-handler.service.ts:200`, `:268`), hence L11 |
| L9 | Electron e2e `onboarding.spec.ts` authored, run only on user request | CLAUDE.md forbids unrequested e2e runs; spec §8 names Playwright + axe as a gate |
| L10 | Candidate only (not implemented): Home hint to connect a provider when no credential exists | R5; needs user approval as it is new UI |
| L11 | `focusRouterKindFor()` maps legacy wire `surfaceKind` values to `'onboarding'` in the attention handler | Without it a legacy-tagged notice stops matching after the routers merge; no producer exists today, so this is defensive and reversible |
| L12 | Batches run strictly serially in the B1→B5b order, under the shared-file ownership table | The batch file lists overlap (review r0 #5) |
| L13 | Additive barrel exports land in the batch of their first consumer, or earlier (`BuilderSessionSectionComponent` and `GenerationViewState` in B2; four sections and the controller in B4a; onboarding `/services` focus exports in B5a) | No batch imports a symbol that does not exist at its start (review r0 #1) |
| L14 | Host apps whose `test` depends on a build get `-t lint,typecheck` only; their edited specs run as single-file Jest under the verify lock | CLAUDE.md forbids unrequested builds; `npx nx show project` target prerequisites |
| L15 | `onboardingStepLink` writes complete query objects, never `queryParamsHandling: 'merge'` | An agent `run` must never reach a guidance lookup |
| L16 | D9 counts are held in memory only, keyed by workspace + run id + `generatedAt`. They are captured only on a completion transition this session observed, and only when both runless `getRunState` lookups bracketing the content read return run A completed | Attribution to the current run; spec §3.6 reload omission |
| L17 | `EnhancedPromptsSummaryCardComponent` input narrowed to `Pick<EnhancedPromptsSummary, 'sections'>` | The card becomes content-derived (D9); the old caller still compiles until B5b |

## Revision log (r1)

Response to `implementation-plan-review.r0.md` (REVISE, 6 blockers) and the user's D9 ruling.

| Defect | Fix | Where |
| --- | --- | --- |
| 1. B2 imports harness-builder sections first exported in B4a; `/services` barrel names B5a files from B1 | `BuilderSessionSectionComponent` (and the `GenerationViewState` type) are exported in B2. The four other sections and the controller are exported in B4a, before the B4b consumers. Onboarding `/services` is staged: first-run exports in B1, focus exports in B5a. An import audit is listed per batch | A1 "Two entry points"; Codebase evidence (barrel rows); Modify rows for `harness-builder/src/index.ts`, `services.ts`, `setup-wizard/src/index.ts`; Batches → "Batch order and shared-file ownership" (dependency table, import audit); B2/B4a/B5a file lists; L13 |
| 2. B5a narrows `SurfaceFocusRouter.kind` while the old routers still compile | B5a widens the union by adding `'onboarding'`. B5b narrows it in the batch that deletes both routers, their providers and exports. The attention-handler `kind` comparison is covered by `focusRouterKindFor` | C2 token block; Modify token row; B5a/B5b files and acceptance; L8, L11 |
| 3. Harness navigation cut-over timing contradiction | B4a keeps the `'harness-builder'` target (`harness-workflow-request.service.ts:355`) and changes only execution and session ownership. B5a owns the target switch and its spec, after B4b | A4 staging paragraph; A6 navigation row; Modify request-service row; B4a acceptance/tests; B5a files/acceptance/tests; ownership table |
| 4. Verify lists miss dependents and target restrictions | A verification matrix per batch gives exact (F) and (L) commands, the dependents each one adds, and the single-file host specs. Build-dependent host tests (`ptah-tui`, `ptah-electron`, `ptah-extension-vscode`, `ptah-cli`) and the no-test projects get `-t lint,typecheck`. The webview is in every row; shared/agent-generation rows add vscode, electron, tui, cli and electron-e2e | Batches → "Verification matrix"; Codebase evidence (verify and host target rows); Host impact TUI/CLI rows; R10, R11; L14 |
| 5. Not file-disjoint, no ownership schedule | Batches run strictly serially (B1→B5b, one frontend-developer at a time). A shared-file ownership table covers every multi-batch file | Batches intro; "Batch order and shared-file ownership"; L12 |
| 6. D9 unapproved parity reduction | The user ruling is applied: guidance stays bound; content-derived counts come from `getPromptContent` through the pure, specified `parseGuidanceSectionCounts`, with bracketing staleness checks. The card is narrowed. `totalTokens`, `usedFallback` and Quality Guidance are recorded as user-approved removals. The design-spec source rule is reconciled | Inputs correction 4; Codebase evidence (guidance rows); A5 A4 row; C6 (store API, capture sequence, parser rules, required cases, card change); Create rows; deletion rows 29-30; "User-approved capability reductions"; B3b; Failure behaviour; R3; D9; L16, L17 |

Non-blocking suggestions applied: the restored-route reference is now `initial-navigation.ts:117-125`
(comparison `:121`) in evidence, A3, Modify and R2. The deletion arithmetic now reads 51 = 48 lib +
3 e2e. The D4 rationale is corrected (`canMatch` with a `UrlTree` also redirects). A4 rebinds a
handoff-started run (`generation-handoff.store.ts:122`) before any auto-start (A5 table, B3b). The
agent→guidance query rule replaces `tab`/`run` with the guidance binding and keeps the agent tab as
`gen` (A2 transition table, L15).

New finding during revision: `webview-routing.spec.ts:368-380` asserts legacy landing. Its
migration moved to B5a, the batch that changes that behaviour.

## Revision log (r2)

Response to `implementation-plan-review.md` (codex r1: defects 1-5 confirmed fixed; one blocker in
D9 run attribution).

| Change | Where |
| --- | --- |
| D9 attribution: the content read is bracketed by two runless `enhancedPrompts:getRunState` lookups (`getGuidanceRunState`, `enhanced-prompts-rpc.handlers.ts:882-897`). Both must return run A exactly, `completed` and `committed`. Missing, rejected, changed or non-terminal results give no counts. The runless form is required because the explicit-`runId` form returns the settled A before it checks for an active owner (`guidance-generation-run.supervisor.ts:153-170`). The runless form reports `blocked` for another active run or a busy service (`:161-170`, `:895`) and fails once any later settle replaces A (`:94-95`) | C6 capture sequence (identity check `L`, steps 1-7) |
| The timestamp sandwich, enabled/prompt revalidation at both status reads and the local binding/run checks are kept. Display also requires the store's run to still be A and `completed` | C6 steps 2, 4, 6; `guidanceSections()` rule |
| Capture is triggered by `GenerationStepStore` on the observed non-terminal → `completed` transition, independent of the mounted page. A completion first seen already terminal is never captured | C6 store API comment |
| New required cases: B completes before the first read; B active during capture; service lock held; same-tab new run; the workspace result advances while the local run stays A; disable mid-capture; RPC throw; late-bound run; happy path | C6 "Required `captureGuidanceSections` cases"; B3b acceptance and tests |
| Cross-process residual documented | C6 residual paragraph; R12 |
| Failure behaviour, D9 evidence and L16 updated for the lookup bracket | Failure behaviour row; Decisions D9; L16 |
| Non-blocking: `GenerationViewState` B2 export added to the Modify table; matrix wording now says source-impact coverage plus explicitly chosen implicit dependents; host-spec invocation spelled as `npm run verify -- --exec … --coverage=false --maxWorkers=2` | Modify `setup-wizard/src/index.ts` row; Verification matrix intro |
