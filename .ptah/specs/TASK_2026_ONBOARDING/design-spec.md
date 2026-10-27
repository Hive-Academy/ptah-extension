# Onboarding module: design specification (revision 2)

Host: Electron webview first. Stack: Angular signals, Tailwind + DaisyUI, existing tokens. Prototype: `prototype/index.html` (Home, Analyze generating, New project proposal, Team builder start and review, state gallery, dark/light toggle; `narrow.html` frames any view at a chosen width).

Tokens (nothing invented): `apps/ptah-extension-webview/tailwind.config.js` (themes `anubis`, `anubis-light`; `--state-ink-*`), `apps/ptah-extension-webview/src/styles.css` (`--ptah-ease-soft`, `--ptah-motion-in/out`, `--surface-0..3`, `--surface-border*`, `--ptah-gold*`). Use `bg-surface-1`, `border-surface-border`, `text-base-content-muted`, `text-state-run|need|err|done|idle`. The prototype copies token values into CSS variables only because it is static.

Register: product UI. Color strategy: restrained; gold marks the primary tile, the current step and a revision change (always paired with a text tag). No eyebrows, no hero metrics, no side stripes, no gradient text.

**Specimen rule.** Every number in the prototype ("9 selected", "6 of 9", "Attempt 2 of 3", "4 phases") is a specimen. Section 3 gives the source of each field. When a source is absent (for example elapsed time after reload) the UI hides the fact; it never estimates.

## 1. Information architecture, boot and routes

### 1.1 Route map
New surface id `onboarding` (base URL `/onboarding`) replaces `setup-hub`, `setup-wizard`, `harness-builder` in `libs/shared/src/lib/types/webview-surface.types.ts` (the single registry; `surface-routes.ts:21` re-exports it).

| Path | Screen | Identity carried in the URL |
|---|---|---|
| `/onboarding` | Home | none |
| `/onboarding/analyze` | A1 Analyze workspace | optional `?analysis=<savedFilename>` (validated against the saved list; absent means resolve from `list-analyses`) |
| `/onboarding/analyze/agents` | A2 Choose agents | `?analysis=` (verified analysis) or `?source=catalog` (agent-only path, section 3.3) |
| `/onboarding/analyze/generate` | A3 Generate agents | `?tab=<genTab>&run=<runId>` (`run` after accept) |
| `/onboarding/analyze/guidance` | A4 Project guidance | `?tab=<guidanceTab>&run=<runId>&gen=<genTab>` |
| `/onboarding/analyze/done` | A5 Done | `?gen=<genTab>&tab=<guidanceTab>` (optional, for fact lookup) |
| `/onboarding/guidance` | Guidance-only entry (same screen as A4, own stepper with 2 steps) | `?tab=&run=` |
| `/onboarding/new-project` | Intake | `?draft=<id>` when resuming a local draft |
| `/onboarding/new-project/workspace` | Proposal workspace | `?tab=<tabId>` |
| `/onboarding/new-project/review` | Review & apply | `?tab=<tabId>` (+`&rev=<n>` for the revision shown) |
| `/onboarding/team-builder`, `/workspace`, `/review` | Same shape, mode `configure-harness` | same |

Rule: the `tab` query value is a validated hidden session binding, never shown to the user, and **every step transition copies the query** (`tab`, `run`, `gen`, `rev`). Missing or foreign `tab` shows the recovery screen (section 3.6). Workspace is never in the URL; it is the pinned active workspace and a mismatch is a recovery state (`workspace-mismatch`, `rpc-setup.types.ts` rejection reasons).

### 1.2 First-install entry (route guard on the chat surface)
Boot navigation and the Electron preload stay **unchanged**. `preload.ts:47` always sends `initialView: startupConfig?.initialView || 'chat'`, so `resolveBootNavigation` (`boot-navigation.ts:58`) returns the host surface before any first-run branch could run. `resolveBootNavigation` therefore gets **no** `firstRun` input and `initial-navigation.ts` remains the single boot owner. First run is enforced where every path to chat ends: an Angular guard on the **chat surface route**.

`onboardingFirstRunGuard` (CanActivate/CanMatch on the `chat` route in `app.routes.ts`):
1. Eligible only if the host is Electron (`vscodeService.isElectron`) and `localStorage['ptah.onboarding.v1']` has no `shownAt`.
2. If eligible: return a `UrlTree` to `/onboarding` and record the pending redirect; `shownAt` is committed when that navigation lands (point 5). Otherwise return `true`.
3. Because it sits on chat, it intercepts the default boot (host `chat`), a restored `/chat` route, and the root redirect (`app.routes.ts:231`). Deep links to other surfaces (settings, analytics, an explicit `onboarding` view, a notification focus route) never pass through it and are unaffected.
4. Readiness is already enforced: the guard runs inside the boot navigation, which `app.ts:90` starts after `connected` is set and which carries the `app-state.service.ts:710` gate. The guard does no readiness polling.
5. A superseded navigation (a host `SWITCH_VIEW` while the boot is in flight) cancels the pending navigation; the returned `UrlTree` is discarded **and `shownAt` is not set** (the pending-redirect record survives a `NavigationCancel` whose `code` is `NavigationCancellationCode.Redirect`, because Angular emits exactly that for the guard's own `UrlTree`. It is cleared on any other `NavigationCancel` code and on `NavigationError`. `shownAt` is written on `NavigationEnd` to an `/onboarding` URL when the guard issued the redirect, the single place it is committed).
6. Storage failure on read or write means **no redirect** (`true`), never a loop.

Precedence table (what the user sees on boot):
| Case | Result |
|---|---|
| DevTools override | that view (guard not involved unless it is chat) |
| Explicit host deep link to another surface | that surface; guard never runs |
| Electron default (`initialView` absent or `chat`), flag has no `shownAt` | chat route guard redirects to `/onboarding` |
| Restored `/chat` route, no `shownAt` | same redirect (**upgrading users also see onboarding once**: flag `v1` is per version, matching "install our version for the first time") |
| Restored non-chat route | restored route; onboarding not shown |
| `shownAt` present | chat as usual |
| Superseded navigation | newer navigation wins; flag untouched |
| VS Code host or any non-Electron | guard returns `true`; no automatic onboarding |

Flag: `ptah.onboarding.v1 = { shownAt?, dismissedAt?, completedAt? }`, try/catch wrapper. `dismissedAt`: Home "Skip for now" or "Back to chat". `completedAt`: Analyze reaches Done, or a harness Apply succeeds. In-flight work after an automatic entry is recovered from the Home resume banner. Re-entry (configuration menu item and Settings row "Run onboarding again") calls `setCurrentView('onboarding')` (readiness-gated) and ignores the flag; the menu keeps the stable selector `config-menu-item-setup-hub` with the label "Setup". VS Code: no automatic onboarding; its launcher opens Onboarding Home (1.3). TUI has no Angular surface and is unaffected.

### 1.3 Host and route migration (recovery, not wire compatibility)
Retired UIs are not kept. Legacy view ids and URLs are **normalised to Onboarding Home**; nothing promises a child path.
| Seam | Change |
|---|---|
| `webview-surface.types.ts:44,67` | add `onboarding`; remove `setup-hub`, `setup-wizard`, `harness-builder` from the surface ids |
| `webview-surface.types.ts:95` (host allow-list) | add a legacy alias map `{ 'setup-hub','setup-wizard','harness-builder' } to 'onboarding'` applied before validation, so an old host value is accepted and mapped, never rejected |
| `app-state.service.ts:362-364` (`SWITCH_VIEW`/initialView handling) | normalise `payload.view` through the same alias map before validating |
| Saved-route parser (`ptahRoute`, `surface-routes.ts`) | bases `/setup-hub`, `/setup-wizard`, `/harness-builder` and **all** their child URLs map to `/onboarding` (Home) |
| `surface-routes.ts:44` generation tab validator | migrate from path segments (`/setup-wizard/generation/:workflow/:tabId`) to the query binding `?tab=`, keeping workflow and workspace validation (`rpc-setup.types.ts:14`) |
| `electron-setup-wizard.service.ts:78`, `webview-lifecycle.service.ts:153` (VS Code panel) | send view / `initialView` `onboarding` only. No child-path promise, no new backend payload |
| `webview-html-generator.ts:113` and `...initial-view.spec.ts:98` | allow-list and expectations updated |
| `app.routes.ts:100,107,128,141,154` | old routes and providers deleted; `onboarding` lazy routes added |
| `generation-workflow-launcher.service.ts:78`, `harness-workflow-request.service.ts:355`, both focus routers | emit new URLs with `?tab=`/`?run=`; routers merge into `OnboardingFocusRouter` |
| `electron-shell.component.ts:617`, `global-config-actions.component.ts:84-94` | open `onboarding` |
| Backend event names and workflow discriminators (`setup-wizard:*`, `setup-generation:open`, `harness:open-workflow`, `setup-agent-generation`, `setup-project-prompt`, `harness-new-project`, `harness-configure`) | unchanged; handlers map them to new routes |
The alias map and parser mapping are recovery for upgrading users with a saved route, an old in-flight notification or an older launcher message; remove after one release.

## 2. Shared patterns

Frame (`ob-page`): max 1120px, 20px padding (14px under 720px). Top bar: breadcrumb `Onboarding / <Flow>` (first crumb is the back action) and a read-only provider/model pill during runs. "Back to chat" on Home only; "Open chat" on Done and Apply result.

Stepper: ordered list, label "Progress", current `aria-current="step"`, completed steps are links with visible focus ring and an accessible name "Analyze, completed", future steps plain text. Wide: vertical sticky rail 210px. Under 720px: horizontal strip showing the current label only. State glyph always paired with text.

Focus: on route change focus moves to the page `h1` (`tabindex=-1`). Async updates never move focus. Announcements: one small visually hidden `role=status` region (polite) receives short messages ("Agent senior-tester written", "Revision 4 received"); the card grid and proposal are **not** live regions.

Progress bars: `role=progressbar` with `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow`, and an `aria-label`.

Motion: view enter 200ms `--ptah-ease-soft`, 4px translate and opacity; bar width 400ms; dot pulse. All off under `prefers-reduced-motion: reduce`. Nothing is hidden behind an animation.

Contrast (canvas-measured on `--surface-1`, prototype): dark muted 7.34, run 4.76, need 6.24, err 4.65, done 5.31, idle 6.89; light muted 6.28, run 5.51, need 5.29, err 5.56, done 5.18, idle 4.80. Criterion WCAG 2.x AA 4.5:1 text, 3:1 non-text. State text is never placed on `surface-3` (dark run 4.17, err 4.07). These are single-surface measurements, not a route-level axe pass; axe per step and theme is an implementation gate.

## 3. Screens

### 3.1 Home `/onboarding`
h1, one-sentence lede, resume banners, three tiles, footer.
- Resume banners (one per resumable run, stacked): chip, "Agent generation for <workspace>" plus facts only from state (`written` count from checkpoint agents), primary "Resume" to the owning step with identity in the URL. Sources: `wizard:get-resumable-run`, `wizard:get-generation-run-state`, `enhancedPrompts:getRunState`, harness drafts/tab records.
- Tiles: Analyze (larger, first), New project, AI team builder. Analyze tile secondary links "Only generate agents" (`/analyze/agents?source=catalog`) and "Only regenerate guidance" (`/guidance`). Tiles disabled with an inline reason when no workspace is open; if the setup-status fetch fails only the status chips are replaced by "Status unavailable, Retry" and tiles stay usable. Skeleton tiles while loading.
- Footer: "Reopen from the configuration menu: Setup." and "Skip for now".
- Narrow: tiles stack in the same order.

### 3.2 Analyze flow (`/onboarding/analyze/*`)

Stepper: Analyze, Choose agents, Generate agents, Project guidance, Done. Reached without analysis (agent-only), step 1 shows as "Skipped" and A2 uses the workspace catalog.

**A1 Analyze workspace**
- Idle: provider/model selector (scope, refresh models), "Start analysis"; "Saved analyses" list (date, duration from `SavedAnalysisMetadata`, Use, Hide from list; hide is transient).
- Interrupted/resumable (`get-resumable-run` non-null): "Continue previous run" (primary, `deepAnalyze({resume:true})`) or "Start fresh".
- Running: **four** rows from the returned phase IDs `project-profile`, `architecture-assessment`, `quality-audit`, `elevation-plan`. Row state from `phaseStatuses` (`pending|running|completed|failed|skipped`, all five rendered, text label each); header "Phase n of N" from `currentPhaseNumber/totalPhaseCount` (N is whatever is returned, not hard-coded). No percent, no per-phase running duration. An optional session-local elapsed timer is shown with the label "since you opened this page" and hidden after reload. Stop opens the confirmation dialog.
- Stats: text/thinking/tool/error counters from the analysis stream live in the Details log header ("142 events: 31 text, 12 thinking, 88 tool, 0 errors"); counts exist only while the stream is attached.
- Done: phase accordion from the manifest (`manifest.phases[id].file`, `durationMs`, rendered markdown), total duration from `manifest.totalDurationMs`; primary "Choose agents". Failed: message from `phases[id].error` or RPC error; Retry (resume) / Start fresh.

**A2 Choose agents**
- List grouped by `category`; row: checkbox (`recommended` pre-checked), `icon`, `agentName`, `relevanceScore` as text "92% match" (derived `round(score*100)`, hidden if score is not 0..1) with meter, `description`, `matchedCriteria` chips, Preview (existing agent preview dialog). Toolbar: Select recommended, Clear, "n selected" (derived count). Catalog failure: Retry.
- Context source line from `GenerationContextSource` (verified analysis vs workspace discovery with its reason).
- Agent-only path: arrives with `source=catalog`, request `{mode:'workspace-catalog'}`; banner "No analysis is used; recommendations come from the workspace catalog" with a link "Analyze first".
- Overwrite preview (`wizard:preview-generation`): sheet listing `files[]` (`relPath`, `target`, `certainty`, `condition`, `willOverwrite` shown as a "Will overwrite" tag). Refreshed on open and before confirm; errors inline. Confirm label derived: "Generate n agents (m overwrite)".
- Conflict/owner (`rejection.reason: 'blocked'` with `ownerTabId`): banner "Another run is active" + "Open it" (focus router) + Retry. Same component is used on A3, A4, and guidance-only entry.
- Community packs: collapsible panel; install one / all; loading, installed, error per pack.
- Provider/model picker for the run (per-tab); read-only pill once accepted.

**A3 Generate agents** (prototype) as designed: state chip, phase text from run state, `percentComplete` meter, per-agent cards (`ResumableGenerationAgent.status` mapped: pending "Waiting", running "Writing", written "Written", unchanged "Unchanged", failed "Failed"; `error`, `filePath`, `tailoredSections`/`rejectedSections` counts), "Retry this agent" (`wizard:retry-item`; "Attempt a of b" only if the backend returns the budget, else hidden), facts row (files produced = count with `filePath` written; will overwrite from preview kept in the store; elapsed only from a live timer, else hidden), Details log, guidance countdown (`generation-handoff.store`; Start now / Skip; pauses while the log is focused `[lane-proposed]`).

**A4 Project guidance**
- Entry checks owner conflict first (shared banner). Idle: explanation, enable toggle (`enhancedPrompts:setEnabled`), model line, "Generate guidance"; if a saved result exists (`getStatus`) show the result view with Regenerate.
- Running: single status card with spinner, "Generating project guidance", Stop; **no section checklist** (contract: no per-section progress). Elapsed only while attached.
- Done: `summary.sections[]` (`name`, `wordCount`, `generated`), `detectedStack`, View (`getPromptContent`), Download, Regenerate, enable toggle, unchanged-result notice. Failed/cancelled: panel with Retry.
- Legacy auto-generate step: removed; its summary/retry/skip/continue are covered by this screen and the handoff (Removals 1).

**A5 Done**: facts from the two terminal run states (agents written/unchanged/failed counts, guidance on/off, next-step links). Links: Open chat (primary), command center, Tribunal, Run again. Sets `completedAt`.

### 3.3 New project (`/onboarding/new-project/*`)
**Intake**: fields as in the inventory (what to build required, audience B2B/B2C/Internal/Unsure, platform with stack reset on change, stack incl. "Recommend for me" and "Other" text, optional must-haves). Validation on blur and submit with error summary. Advanced disclosure: provider/model. "Continue your draft" banner from local drafts. Submit calls `harness:start-new-project` (returns `seedPrompt`, `intake`, `plugins`, `toolchain?`), then the headless controller (3.5) creates the tab and sends.

**Proposal workspace**
- Main pane: proposal panel with three clearly separated sources (section 4). (a) **Configuration** from `proposeConfig` revisions (`Partial<HarnessConfig>` folded in durable revision order, merged with explicit user overrides): Persona, Agents, Skills (created skills tagged "Created skill"), Prompt, MCP, CLAUDE.md. Header chip from `isConfigComplete`; "Revision n" is the display ordinal of a stable internal revision id. Items changed vs the previous folded snapshot carry the text tag **New** or **Changed** plus gold tint; diffs compare folded snapshots only, never raw partial payloads. (b) **Intake facts** (new project only): Plugins (`plugins.enabledBundled`, `missingExternal` flagged "Install required") and Toolchain from `HarnessStartNewProjectResult`, kept in session state for that session, labelled "From your intake", excluded from revision diffs, and hidden after a reload if the stored result is absent. (c) **Generated document**: output of `harness:generate-document`, labelled "Generated document (helper output)", separate from CLAUDE.md, with review and Copy.
- Section menu "Ask the agent to...": suggest config, analyze intent, design agents, generate skills, **generate document** (`harness:generate-document`, output reviewed and copied in a helper card), discover MCP, generate prompt/CLAUDE.md. Helper card: Add to proposal, Dismiss, Retry, Copy; overrides persist as today.
- Revision history: restore earlier revision (confirm). Presets: Load preset, Save preset with name, description and visible error.
- **Answer dock**: shows the latest assistant message (text of the last assistant turn, truncated with "Show full message" which opens the Details log at that message) and a generic composer ("Reply to the agent"). No question detection and no quick-reply buttons. When the agent is idle with no pending message the dock shows the composer collapsed to one line "Tell the agent what to change". Status chip: "Agent is working" (busy), "Agent replied" (idle, new message), "Not connected" (failed).
  - Desktop (above 860px): non-modal complementary region (`aside`), sticky 300px column, Tab order after the proposal sections.
  - 860px and below: placed above the proposal as the same region.
  - 720px and below: collapsed **bottom bar** showing chip + first line of the latest message + "Reply". It is a `button` with `aria-expanded`/`aria-controls`. Expanding opens a **modal bottom sheet** (`role=dialog`, `aria-modal=true`, labelled by its heading); the proposal behind gets `inert`; focus moves to the textarea; Tab is trapped in the sheet; Escape or the Close button collapses it and **returns focus to the bar button**; a sent reply collapses the sheet and announces "Reply sent" via the status region.
- Conversation log: collapsed disclosure in the proposal panel; read-only; contains session stats (statistics snapshot and live model stats) and the hidden brief shown as "Your brief".
- Bottom bar: Save draft, Save as preset, **Review** (enabled once an initialised, nonempty proposal exists).

**Review & apply** (`/review?tab=&rev=`): read-only configuration at revision n with "Changes since revision n-1" (folded config snapshots only; intake facts and the generated document are shown below, outside the diff). If a newer revision arrives: banner "Revision n+1 is available. Update review" and Apply stays tied to the revision shown. If the user applied before: "Changes since applied revision m" and "Apply again". Apply eligibility keeps the existing checks only (initialised, nonempty preview, pinned workspace, not busy/applying; `builder-apply-section.component.ts:275`); `isConfigComplete` is **not** a write gate. When the agent has not marked it complete: inline non-blocking note "The agent has not marked this complete. You are applying revision n." and the button label stays "Apply to <workspace>". Consent is never written into the agent's completeness fact. Result: `appliedPaths[]` with Copy, warnings, health refresh status, Open chat, Open health dashboard, Done (sets `completedAt`). Leave dialog (Cancel / Discard / Save draft with replacement and save errors) stays.

### 3.4 AI team builder
Same three screens under `mode=configure-harness`, tab workflow `harness-configure`. Differences only: no Plugins or Toolchain intake-fact sections (that RPC is not run; nothing is fabricated); start screen replaces intake (one textarea "Describe the team you want", workspace line, optional Load preset, provider/model under Advanced); configuration sections, helpers, generated document and answer dock identical; Review says "Changes since revision n-1" like New project. The earlier claim of a diff against installed files is dropped: no endpoint is cited for it (Decision 13).

### 3.5 Session ownership (frontend requirements; architect designs the code)

**Headless session controller** (one per harness mode, replaces the visible-embed dependency in `harness-workflow-request.service.ts:430-435`):
1. Creates or reuses the tab, binds it to the SDK session, activates it **without a mounted transcript**; sending never waits for tab visibility.
2. Sends the hidden seed preamble plus visible intake message once the session reports ready (timeout then `failed` with "Retry send"); sending is idempotent per `tab + intake hash`.
3. Exposes signals: `phase` (idle, sending, busy, cancelling, failed, done), `latestAssistantMessage`, `send(text)`, `stop()`.
4. Persists `{tabId, sessionId, mode, workspacePath, intake, sendAttempt{count, ackedAt?}, lastRevisionId, appliedRevisionId?, applyReceipt?, startResult?}` locally (extending the existing record/override machinery); before showing busy or offering Retry send it reconciles with authoritative session state, because an intake hash alone does not prove a lost send was not accepted; the proposal itself is rehydrated by `sessionId` from existing persisted proposals (`rpc-harness-proposal.types.ts:15`).
5. Restoration order on mount or after closing/reopening the webview: URL `tab` to stored record to `sessionId` to proposal hydration; conversation recovery is separate (proposal hydration does not restore the transcript). Missing record but a draft exists: offer "Restore from draft". Neither: recovery screen. Session exists but proposal unavailable: "Proposal unavailable" with "Propose again".
6. Same-mode with an active session in this workspace: reuse (Home resume banner, Intake shows "Continue"). Different mode active: dialog "AI team builder is in progress (revision 3)." Options **Save draft and stop**, **Discard and stop**, **Cancel**. The new flow starts only after the stop is confirmed (`cancelling` to idle). Uncertain stop: dialog stays with "We could not confirm the session stopped" and Retry stop / Keep current; nothing is started and no draft is deleted. Save failure keeps the old session and shows the error.

### 3.6 Reload and recovery tables
All reads are existing RPCs. "Rebind" means: validate `tab`/`run`/workspace, fetch authoritative state, then render.

**Agent generation** (`SetupGenerationRunLifecycle`, `rpc-setup.types.ts:32`)
| Lifecycle | Reload shows | Primary action | Source |
|---|---|---|---|
| starting | "Starting..." card, Stop enabled | wait/Stop | `get-generation-run-state` |
| running | live cards from run state; checkpoint agent statuses when `get-resumable-run` returns the pair | Stop | run state, `get-resumable-run` |
| cancelling | "Stopping", actions disabled, poll until terminal; uncertain result shows "Checking run state" | none | run state |
| cancelled | neutral "Stopped", written files listed | Resume only if a checkpoint exists, else Start over | resumable run |
| failed | err panel, failed agents | Retry failed, Start over (Resume only with checkpoint) | run state |
| timed-out | like failed, labelled "Timed out" | same | run state |
| completed | cards from terminal `result.agentOutcomes` and `result.counts`; no per-agent checkpoint is assumed | Continue to guidance | run state `result` |
| no state, tab missing | recovery screen | Start over | n/a |

**Guidance**: same lifecycle table. Completed: `summary.sections[]` and `detectedStack` come **only** from the final `enhancedPrompts:runWizard`/`regenerate` response, retained in session state keyed by workspace and run id when actually received. After a reload or a lost final response they are **omitted** (no fabricated names or counts) and the screen shows only what `getStatus` provides (enabled, generated, freshness, stack metadata) plus the View (`getPromptContent`), Download, Regenerate and enable controls. `cancelled`/`failed` offer Regenerate (no checkpoint concept). Owner conflict on entry as in A2.

**Analysis** (completed and unfinished are discovered separately):
- Completed result: identified by the validated `?analysis=<filename>` query, loaded with `load-analysis`. If absent, resolve the identity from `analysis-status` / `list-analyses` (latest saved, or the user's selection in A1), then `load-analysis`. `analysis-status` is freshness only.
- Unfinished run: `get-resumable-run` returns one latest eligible analysis/generation pair (not an enumeration of history; it excludes a completed analysis that has no generation checkpoint). Its result is shown only as the Interrupted panel and is **never substituted** for a selected completed analysis.
- Manifest `lifecycle` running/paused to Interrupted; failed to Failed; completed to Done.
- If the original RPC was lost but the backend may still be running (`running` manifest with a recent `updatedAt`): "Analysis may still be running in the background" with Stop (`cancel-analysis` works without the RPC) and Resume; no second run starts until Stop is confirmed.

**Proposal flows** (per mode)
| Controller phase | Reload shows | Action |
|---|---|---|
| idle, proposal present | proposal at latest revision | continue |
| sending | "Sending your brief..." | Retry send after timeout |
| busy | chip "Agent is working", proposal from last revision | Stop |
| cancelling | "Stopping" | none |
| failed | err panel with last revision kept | Retry send / Propose again |
| done (applied) | Apply result | Open chat |
| session missing | recovery screen | Restore draft / Start over |

### 3.7 Shared run states
`ob-run-status` chip + text. idle (inputs), running (pulsing dot, Stop), cancelling ("Stopping", all actions disabled), failed (message, items, Retry/Start over), resumable ("Interrupted", Resume primary), done (facts, Continue). Stop-before-accept: Stop is enabled during `starting`; a late ack is treated as cancelling and run state is re-queried. All shown in the prototype state gallery.

## 4. Field source table
| Screen field | Source / derivation | If absent |
|---|---|---|
| Phase rows | `MultiPhaseId` x4, `phaseStatuses[]` (`phase.ts:71`) | rows from manifest; else hide |
| "Phase n of N" | `currentPhaseNumber`, `totalPhaseCount` | hide |
| Phase duration | `manifest.phases[id].durationMs` (loaded completed analysis only) | hide |
| Elapsed (live) | frontend timer, labelled session-local | hide after reload |
| Text/thinking/tool/error counts | stream event counters | hide when stream detached |
| Match % | `round(relevanceScore*100)` | hide |
| Agent card (live) | run state / `ResumableGenerationAgent` | n/a |
| Agent card (completed) | terminal `result.agentOutcomes`, `result.counts` | summary only |
| Generation percent | `percentComplete` | indeterminate bar |
| Will overwrite | `wizard:preview-generation` `files[].willOverwrite` | hide tag |
| Retry budget "a of b" | backend value if returned | hide |
| Guidance sections, detected stack | final run response, kept in session state by workspace+run | omitted after reload; `getStatus` controls only |
| **Proposal configuration** (persona, agents, skills, prompt, MCP, CLAUDE.md) | `HarnessConfig` via `proposeConfig` revisions (`Partial<HarnessConfig>`), folded in revision order + user overrides | empty section |
| Revision ordinal, completeness chip | internal revision id; `isConfigComplete` | placeholder |
| New/Changed tags | diff of folded config snapshots n vs n-1 | none on first revision |
| **Intake facts** (plugins, toolchain) | `HarnessStartNewProjectResult` (`rpc-harness.types.ts:518`), new project only, kept for the session | hidden after reload if absent; never shown in team builder |
| **Generated document** | `harness:generate-document` output, labelled separately from CLAUDE.md, review + Copy | section hidden until generated |
| Latest assistant message | last assistant turn of the bound session | composer only |
| Applied paths | `appliedPaths[]`; receipt retained in controller record | hidden after reload if absent |
| Resume banner facts | latest eligible pair from `get-resumable-run`, bound tabs, local harness records (not every disk checkpoint) | generic "In progress" |

## 5. Component inventory
New (lib `libs/frontend/onboarding`, standalone, OnPush, signals): `OnboardingShell`, `OnboardingHome`, `PathTile`, `ResumeBanner`, `OnboardingStepper`, `RunStatusChip`, `RunPanel`, `StepMeter`, `ItemStatusCard`, `ItemStatusGrid`, `DetailsLog`, `PhaseList`, `AgentRecommendationList`, `OverwritePreview`, `OwnerConflictBanner`, `ProposalPanel`, `ProposalSection`, `ProposalItem` (with `ChangeTag`), `RevisionHistory`, `AnswerDock` (desktop region + mobile sheet), `ReviewSummary`, `ApplyResult`, `RecoveryScreen`, `OnboardingFlagService`, `OnboardingFocusRouter`, `HarnessSessionController`, per-flow stores. Existing reused: `generation-model-picker`, `generation-stop-control`, `generation-errors`, `generation-source-status`, `agent-preview-dialog`, `community-packs-panel`, `confirmation-modal`, `agent-next-steps`, `guidance-result-panel`, `enhanced-prompts-summary-card`, `analysis-transcript`, `harness-builder-leave-dialog`, `harness-config-preview` blocks, harness helper/preset/apply/stack-profile sections, existing RPC services and stores. Retired: `setup-hub`, `wizard-view`, `wizard-landing`, `welcome`, `generation-workflow-shell`, `generation-agent-sidebar`, `harness-builder-view`, `harness-builder-sidebar`, `scan-progress`, `analysis-activity-indicator`, `analysis-stats-dashboard`, `agent-run-card`, `guidance-run-card`, `generation-progress`, `agent-generation-progress`.

## 6. Parity map
| Capability | New location |
|---|---|
| Setup status, presets, refresh, errors | Home tile chips + Retry; presets in proposal bar |
| Independent generation, workspace-required launch | A2 agent-only path (`source=catalog`); Home disables with reason |
| Analysis provider/model, scope, refresh models | A1 selector |
| Per-tab model picker, run lock, next-step preview | A2 footer; read-only pill from accept |
| Saved analyses list/use/refresh/hide | A1 |
| Launch, single-flight, checkpoint, resume/fresh | A1, mount probe (3.6) |
| Scan phases, activity, stats incl. text/thinking | A1 PhaseList; text/thinking/tool/error counts in Details log header |
| Transcript / execution tree, scroll | `DetailsLog` on every step and workspace |
| Phase markdown, expand, duration | A1 Done accordion (manifest) |
| Continue, resume generation, manual-adjust placeholder | A1 to A2; A3 resumable; placeholder removed |
| Recommendations, categories, choice, select/clear, catalog retry | A2 |
| Context source; owner conflict; open owner | A2 line + `OwnerConflictBanner` on A2, A4, guidance-only |
| Preview, definite/conditional, refresh-before-confirm | A2 preview sheet, agent preview dialog |
| Submit, accepted/rejected, resume interrupted | A2 confirm, A3 states (3.6) |
| Per-agent progress, outcomes, retries, retry item | A3 cards |
| Completion facts, outcomes, section counts, next steps | A3 terminal, A5 |
| Combined countdown, Start now, Skip, manual recovery | A3 note, A4 entry |
| Community packs | A2 panel |
| Analysis cancel confirm, retry/back/fresh | A1 dialog and failed |
| Stop, cancelling, stop-before-accept, uncertain stop | 3.7 |
| Start/stop errors, rejection, chat-busy exclusion, refresh | Failed state, `OwnerConflictBanner` |
| Guidance generate/retry/regenerate/stop/refresh, context | A4 (incl. Refresh) |
| Saved guidance, enable, view, download, unchanged notice | A4 Done |
| Legacy enhancement auto-generate, stack summary, retry, skip, continue | A4 (stack, retry) and A3 handoff (skip/continue); auto-generate step removed |
| Intake questions, validation, other-stack, platform reset, cancel, consent | Intake; cross-mode dialog 3.5 |
| Stack profile/skills, human intake message, hidden seed, send retry | Controller step 2; "Your brief" in log; Retry send |
| Team builder conversation | Team builder workspace |
| Preview: persona, agents, subagents, skills **and created skills**, prompt, MCP, CLAUDE.md, **document**, copy | Proposal sections (Created skill tag; Document section with Copy) |
| Revision recovery, restore, unavailable/failed, propose again | Revision history, 3.6 |
| AI helpers incl. **generate-document** | Section "Ask the agent to..." menu |
| Helper output review/copy, add, dismiss/retry, overrides | Helper card |
| Presets load/save with name, description, errors | Proposal bar |
| Apply to pinned workspace, gating, paths/copy, **warnings**, health refresh | Review & apply |
| Session statistics | Details log header |
| Leave/start over/switch modes, save errors | Leave dialog, cross-mode dialog |
| Resume/rebind, drafts, pinned workspace, missing/wrong tab | 3.5, 3.6, RecoveryScreen |
| Rebind, authoritative refresh, early/stale/terminal events | existing stores behind `tab`+`run` |
| Sidebar/sheet, toggles, keyboard dismiss, inert transcript | Details disclosure; dock sheet is modal with `inert` background, Esc, focus return |
| Entry points, notification focus, open messages, exits | 1.2, 1.3, `OnboardingFocusRouter`, Back to chat / Open chat |

## 7. Proposed Removals
User decision 2026-10-27: items 3, 4, 5 and 7 are **approved**. Items 1 and 2 are **rejected** and stay as kept capabilities:
1. ~~Legacy prompt-enhancement auto-generate step~~ **Rejected, keep.** The `prompt-enhancement.component` behaviour (auto-generate, skip, summary, retry, continue) is rebuilt inside Analyze step A4 (Guidance) as its idle/pre-run state. It is not dropped.
2. ~~"Manual adjust" placeholder~~ **Rejected, keep.** The "Manual adjust" entry stays on the analysis results review (A1 completed state, today at `analysis-results.component.ts:264`), with its current coming-soon modal.
3. `setup-wizard:launch` facade method: scoped unused candidate; remove only after checking exported/public callers; active host wizard launch services are not touched.
4. Duplicate scan/welcome/wizard-landing screens: consolidated into A1; their controls survive.
5. Standalone hub cards as separate entries: agent-only and guidance-only remain as secondary Home links, so no capability is lost.
6. Chat as the visible main pane for every workflow: kept as hidden session binding plus Details log; execution/tab ownership preserved (3.5).
7. `harness:search-skills` and `harness:create-skill` facades stay unsurfaced; no deletion proposed now.
No other removal is proposed.

## 8. Responsive and accessibility
1120px content cap; collapses at 860px (dock above) and 720px (stepper strip, stacked tiles, dock bottom bar). Check widths: 1280, 640 and 360px (genuinely narrow, as in a docked sidebar). Hit targets 32px minimum; native button/link/details; dialogs trap and restore focus; one h1 per route; Playwright + axe per step and theme is an implementation gate (not verified here).

## 9. Decisions
| # | Decision | Options | Evidence | Reversible |
|---|---|---|---|---|
| 1 | One `onboarding` surface, lazy child routes | keep three surfaces | user decision 2; shared registry | Yes |
| 2 | Vertical stepper rail wide, strip under 720px | top stepper | webview often narrow | Yes |
| 3 | Analysis shows returned phases, no percent, no per-phase live duration | fake percent/9 phases | `multi-phase.types.ts:20`, `phase.ts:67-71` | Yes |
| 4 | Guidance run shows spinner only | fake checklist | backend-contract | Yes |
| 5 | Proposal workspace with docked reply and folded log | chat main pane | user decision 3 | Yes |
| 6 | Agent-only and guidance-only stay as secondary Home links and routes | remove | inventory I:39,48 | Yes |
| 7 | Review is separate from Apply; completeness never gates write | gate on completeness | `builder-apply-section.component.ts:275` | Yes |
| 8 | First run = `onboardingFirstRunGuard` on the chat route; boot-navigation and preload unchanged; no `firstRun` input | boot-plan branch | `preload.ts:47`, `boot-navigation.ts:58` (host `chat` always wins) | Yes |
| 9 | Restrained color; gold for primary path, current step, changed items (with text tags) | full palette | Anubis tokens | Yes |
| 10 | `tab` (+`run`, `gen`, `rev`) query params on every step | `run` only | `rpc-setup.types.ts:14,20` | Yes |
| 11 | Check at 1280, 640, 360; browser tool accepts a viewport, iframe harness is supplementary | iframe only | review note 3 | Yes |
| 12 | Keep selector `config-menu-item-setup-hub`; upgrading users also see onboarding once (flag v1 is per version) | exempt users with a saved route | orchestrator ruling; user wording "first time install our version" | Yes |
| 13 | Review diffs revision to revision only | diff vs installed files | no cited endpoint | Yes |
| 14 | Dock shows latest assistant message + generic composer, no option detection | parse questions | no structured question source | Yes |
| 15 | Legacy ids and URLs normalise to Onboarding Home at both host validation boundaries and the route parser; no child-path promise | wire compatibility, new backend payload | `app-state.service.ts:362-364`, `webview-surface.types.ts:95` | Yes |
| 16 | Guard is Electron-only; VS Code keeps a launcher to Home, no auto-run | auto in both | CLAUDE.md Electron first | Yes |
| 17 | Intake facts and helper document are separate sources from proposal config; diffs cover config snapshots | one merged panel source | `rpc-harness.types.ts:518`, `rpc-harness-proposal.types.ts:6` | Yes |

## 10. Lane-proposed rules (reviewer soundness notes applied)
| Rule | Sound? | Note applied |
|---|---|---|
| One `onboarding` surface with lazy flows | Conditional | host/parser migration table 1.3; ownership lives in the controller and stores outside destroyed routes |
| `tab`/`run`/`gen`/`rev` query identity | Fixed | run-only binding dropped (Decision 10) |
| Analyze redirects to furthest valid step | Conditional | valid = workspace matches and (analysis loaded or `source=catalog`); explicit backward clicks are never overridden |
| Versioned flag (`shownAt`, `dismissedAt`, `completedAt`) | Yes | exact triggers and storage failure behaviour in 1.2 |
| First-run via chat-route guard, Electron only, upgrading users see it once | Intent sound | ruling; boot owner untouched; superseded navigation never sets the flag |
| Versioned flag (`shownAt` set on the guarded redirect, committed on arrival) | Yes | shown means redirected-and-landed; storage failure means no redirect |
| Menu/Settings re-entry, label "Setup" | Yes | selector kept |
| Larger Analyze tile, step preview, stacked resume banners | Yes | counts sourced |
| Skeleton tiles; status failure leaves launch usable | Yes | distinguishes no-workspace from fetch failure |
| Guidance countdown pauses while Details log focused | Lane-proposed | optional |
| Review separate from Apply; "Update review" banner; revision tied apply | Lane-proposed | write checks stay existing |
| Modal bottom-sheet dock under 720px | Lane-proposed | semantics in 3.2 |
| Legacy id/URL normalisation to Home for one release | Conditional | applied before each validation boundary (1.3); removal: next release |
| `shownAt` prevents repeated auto-entry | Accepted | in-flight work recovered via Home banner; ordinary restored routes may still reopen onboarding only before `shownAt` |

## 11. Revision log
| Blocker | What changed |
|---|---|
| 1 Boot | 1.2 rewritten around `resolveBootNavigation`; precedence, readiness, cancellation, host eligibility, flag schema and updates, VS Code and TUI stance; Decision 8, 12, 16 |
| 2 Identity/reload | 1.1 `tab`/`run`/`gen`/`rev` on every step; 3.6 per-lifecycle reload tables for generation, guidance, analysis, proposals; analysis lost-RPC behaviour; lifecycle mapping |
| 3 Headless session | 3.5 controller requirements, restoration order, same-mode reuse and cross-mode stop/save/discard/uncertain-stop outcomes; 3.6 proposal table |
| 4 Unsupported data | 3.2 A1 four phases with five statuses, no live durations; 3.3 dock = latest message + generic composer; section 4 field-source table; specimen rule |
| 5 Parity | A2 agent-only path; counters in Details log; Document/created-skill/generate-document in 3.3; owner banner on A4 and guidance-only; dock modal semantics; parity map rows updated; Removal 5 |
| 6 Migration | 1.3 host/route/launcher/focus-router/menu table; old-route translation; events unchanged; VS Code destination |
| 7 Completeness | 3.3 Review vs Apply separation, stale revision handling, non-blocking note; Decision 7; section 10 |
| 8 Prototype | prototype: bottom-bar dock with modal sheet, New/Changed tags, team-builder start and review, state gallery, 360px check; spec 3.2/3.3/3.4/8 |
| NB1-5 | specimen rule and hidden facts; polite status region, labelled progressbar; Decision 11 corrected; selector kept, guidance-only link in Home; presentation choices kept apart from data defects |

### Round 2
| Residual blocker | What changed |
|---|---|
| 1 First run | 1.2 rewritten: `onboardingFirstRunGuard` on the chat route, boot-navigation/preload unchanged, `firstRun` input removed; precedence table covers absent/default chat, restored chat, restored other, deep link, `shownAt`, superseded, non-Electron; upgrading users see it once; Decisions 8, 12, 16; lane-proposed table |
| 2 Migration | 1.3 rewritten as recovery: alias map at `webview-surface.types.ts:95` and `app-state.service.ts:362-364`, saved-route bases and children to Home, launchers open Home only, `surface-routes.ts:44` validator moved to `?tab=`; Decision 15 |
| 3 Reload sources | 3.6: analysis completed via `?analysis`/`list-analyses` + `load-analysis`, unfinished discovery separate and never substituted; guidance sections only from the retained final response, omitted after reload; completed generation cards from `result.agentOutcomes`/`counts`; resume banner limited to the latest pair |
| 4 Field sources | section 4 split into proposal config, intake facts (new project only, session-retained, hidden after reload and in team builder), generated document labelled separately; 3.3/3.4 updated; diffs over folded config snapshots; controller record extended; Decision 17; prototype: team-builder proposal hides plugins/toolchain, Document labelled |
