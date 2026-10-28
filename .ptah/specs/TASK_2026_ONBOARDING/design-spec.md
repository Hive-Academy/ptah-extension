# Onboarding module: design specification (revision 2)

Host: Electron webview first. Stack: Angular signals, Tailwind + DaisyUI, existing tokens. Scope addition 2026-10-28: "Get ready" pre-steps before Home are specified in section 12 (prototype views `Get ready 1` and `Get ready 2`, plus the Home warning banner). Prototype: `prototype/index.html` (Home, Analyze generating, New project proposal, Team builder start and review, state gallery, dark/light toggle; `narrow.html` frames any view at a chosen width).

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

Flag: `ptah.onboarding.v1 = { shownAt?, dismissedAt?, completedAt?, ready? }` (the optional `ready` object and the guard's redirect target for first run are defined in section 12.4), try/catch wrapper. `dismissedAt`: Home "Skip for now" or "Back to chat". `completedAt`: Analyze reaches Done, or a harness Apply succeeds. In-flight work after an automatic entry is recovered from the Home resume banner. Re-entry (configuration menu item and Settings row "Run onboarding again") calls `setCurrentView('onboarding')` (readiness-gated) and ignores the flag; the menu keeps the stable selector `config-menu-item-setup-hub` with the label "Setup". VS Code: no automatic onboarding; its launcher opens Onboarding Home (1.3). TUI has no Angular surface and is unaffected.

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

## 12. Get ready pre-steps (scope addition 2026-10-28)

Source: `context.md`, "Scope addition: Get ready pre-steps", user decisions **D10** (install is guided, no backend) and **D11** (warn, but allow skip). Prototype: `prototype/index.html` views "Get ready 1: Claude Code", "Get ready 2: Settings", Home (warning banner), and the state switch "Claude Code state" (checking, ready, missing, signed out, error/timeout). `narrow.html?view=ready&state=missing&w=400` frames any of them. Screenshots: `prototype/screenshots/get-ready-*.png` (dark and light; narrow 400px in dark and light).

Rules: Electron first (the whole section is gated by `vscodeService.isElectron`; VS Code and TUI unchanged). No backend change: only existing RPCs. Tokens are the ones already in this spec (section header); no new token, no new colour.

### 12.1 Flow

| Stage | Route | What the user does | Exit |
|---|---|---|---|
| 1 Claude Code | `/onboarding/ready` | Sees whether `claude` is installed (path, version) and signed in; installs or signs in by copying a command; presses Re-check | Continue (ready) or Continue anyway (not ready) |
| 2 Providers and tools | `/onboarding/ready/settings` | Connects providers and reviews detected CLI tools in the existing settings components; may skip | Continue to setup or Skip for now |
| 3 Choose a path | `/onboarding` (existing Home, 3.1) | Picks Analyze, New project or Team builder | existing flows |

Stage 3 is the approved Home, unchanged apart from the strip (12.6) and the warning banner (12.3). Both pre-steps are skippable (D11); nothing blocks Home. "Back" on stage 2 goes to stage 1; the first crumb ("Onboarding") on both goes to Home, which is the skip path.

### 12.2 Claude Code check (stage 1)

**Data (existing RPCs only).**
- Installed, path, version: `agent:detectClis` returns `CliDetectionResult[]` (`libs/shared/src/lib/types/agent-process.types.ts:414`). Use the row whose `cli` is the Claude CLI: `installed`, `path?`, `version?`. Re-detect goes through the same call the settings page already uses (`ProvidersSettingsStateService.redetectClis()`, `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`; `agent-orchestration-config.component.ts:578` calls it).
- Signed in: `ClaudeAmbientStatusService.read(refresh)` (`libs/frontend/core/src/lib/services/claude-ambient-status.service.ts`) wrapping `provider:getAmbientClaudeStatus`. View: `status` (`inert|idle|checking|ready`), `result.state` (`connected|signed-out|unknown`), `result.reason` (`cli-missing|timeout|unreadable`), `localFailure`. `unknown` is never read as signed out (`provider-account.types.ts:264-281`). Enter: `read(false)` (host cache); Re-check: detect plus `read(true)` (fresh probe; the service allows 30 s).
- Host `inert` (not Electron): the stage is not shown at all.

**State derivation** (first match wins):

| UI state | When |
|---|---|
| checking | detect call in flight, or ambient `status` is `checking` or `idle` with a read pending |
| missing | Claude row `installed === false`, or ambient `unknown` with `reason: 'cli-missing'` |
| error | detect call failed, or ambient `localFailure`, or ambient `unknown` with `reason` `timeout` or `unreadable` |
| signed-out | `installed` and ambient `state: 'signed-out'` |
| ready | `installed` and ambient `state: 'connected'` |

**Layout.** One status panel (`panel`, 3.7 chips): header (title, one-line subtitle, state chip), a definition list (Installed, Version, Signed in), then one state-specific block, then the action row. State is always shown as chip text plus a line, never colour alone.

**Copy per state** (exact strings; the prototype shows them):

| State | Chip | Installed / Version / Signed in lines | Block | Actions (one primary) |
|---|---|---|---|---|
| checking | "Checking" (pulsing dot) | skeleton bars (`sr`: "Checking") | none | left text "Checking your computer..."; "Continue anyway" (ghost) |
| ready | "Ready" | path in mono, version in mono, "Yes. Your Claude account is connected." | none | **Continue** (primary) |
| missing | "Not installed" | "No `claude` command was found." / "Not available" / "Install Claude Code first." | Install block (below) | **Re-check** (primary), "Continue anyway" (ghost) |
| signed-out | "Not signed in" | path / version / "No. Sign in to use Claude Code." | Sign-in block (below) | **Re-check**, "Continue anyway" |
| error / timeout | "Could not check" | "Unknown" / "Not available" / "Claude Code did not answer in time (30 s). Your sign-in could not be read." | "Ptah could not read Claude Code": "The check timed out. This is not the same as being signed out. Press Re-check. If it keeps failing, run `claude doctor` in a terminal." plus disclosure "Install or sign in by hand" with the docs link | **Re-check**, "Continue anyway" |

Error copy variants (same layout, one sentence changes): `timeout` "...did not answer in time (30 s)."; `unreadable` "Ptah could not read the Claude Code sign-in."; `localFailure` or detect failure "Ptah could not ask this computer about Claude Code."

Under the panel in missing, signed-out and error: "You can continue without it. A warning stays on the next screens until Claude Code is ready." (D11).

**Install block (missing, D10, no backend).** Heading "Install Claude Code"; line "Open a terminal, paste the command for your system, press Enter. The installer prints nothing while it downloads. When the prompt returns, press Re-check." A tablist ("Operating system"): **macOS / Linux** (default; the tab preselected from the OS Electron reports, user can switch), **Windows**, **npm**. Each command is a `cmd` row: mono `code` (wraps, never scrolls sideways) and a Copy button (label "Copy", becomes "Copied" for 2 s; `aria-label` names the command; a polite status region announces "Command copied"). Commands are the official ones (verified 2026-10-28, see Sources):

| Tab | Label | Command |
|---|---|---|
| macOS / Linux | macOS, Linux, WSL (Terminal) | `curl -fsSL https://claude.ai/install.sh \| bash` |
| Windows | Windows PowerShell (prompt starts with PS) | `irm https://claude.ai/install.ps1 \| iex` |
| Windows | Windows CMD (prompt has no PS) | `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` |
| npm | Any system with Node.js 22 or later (do not use sudo) | `npm install -g @anthropic-ai/claude-code` |

Below the tabs: "Still not found after installing? Open a new terminal, and if Re-check keeps failing, restart Ptah so it picks up the updated PATH." and a ghost link "Open the official install guide" to `https://code.claude.com/docs/en/setup`, opened in the system browser through the external-link path the settings drawers already use (`kimi-code-login-progress.component.ts` `installUrl`). Homebrew, WinGet and Linux package managers are in the docs and deliberately not repeated here (Decision 12.D3).

**Sign-in block (signed-out).** The existing settings path for the ambient Claude login is the Claude CLI card in the connection drawer, Credentials tab: it shows the CLI command with Copy and a "Check again" button (`libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts:91`, `:126-140`, `:412`; the card is rendered by `providers-settings.component.ts`). Onboarding reuses that path: same copy-the-command pattern, same re-check (`ClaudeAmbientStatusService.read(true)`). Heading "Sign in to Claude Code"; line "Run this in a terminal and follow the browser prompts. Claude Code needs a Pro, Max, Team, Enterprise or Console account. Then press Re-check."; command `claude` (official docs: "log in by running `claude` and following the browser prompts"). Secondary line: "Prefer a separate Claude account for Ptah? Add a named account in Providers. The check above still reads your main Claude Code login." The link goes to stage 2, Providers tab, and the implementation opens the Claude (Subscription) drawer on its Accounts tab, as `ProvidersSettingsComponent.openAccountSignIn()` does (`providers-settings.component.ts:1220`; Accounts UI: `providers/accounts/accounts-tab.component.ts`, RPCs `provider:addAccount` and `provider:startAccountSignIn` through `ProviderAccountsStateService`). Named accounts do not change the stage-1 verdict (Decision 12.D5).

**Re-check.** Disabled and relabelled "Checking..." while in flight; the panel gets `aria-busy`; state returns to the derived state. A late reply is ignored if a newer check started (the ambient service already drops stale replies). Focus stays on the Re-check button; the result is announced in the `status` region ("Claude Code is ready" / "Claude Code is still not installed" / "Claude Code is still not signed in").

### 12.3 Persistent warning (D11)

Component `ClaudeReadinessBanner` (`role="status"`, not `alert`: it is not an interruption). Shown on **Get ready 2** and **Home** whenever the derived state is `missing`, `signed-out` or `error`; hidden for `checking` and `ready`. Full 1px border in the `--need` tint with a 10% `--need` background wash over `surface-1`, a filled "!" glyph (not colour alone), no side stripe. Text: bold lead "Claude Code is not installed." / "Claude Code is not signed in." / "Ptah could not check Claude Code." then "Analysis and agent generation may fail until it is ready. You can still pick a path." (Home) or "You can keep going; some steps may fail until it is ready." (stage 2). One action button: "Install Claude Code" / "Sign in" / "Check again" on Home, "Fix Claude Code" on stage 2; it goes to stage 1. It cannot be dismissed (persistent) and clears itself the moment a re-read returns `ready`. State is re-read (`read(false)` plus detect) each time Home or stage 2 mounts, so the banner is never stale. Not added to chat or other surfaces (Lane-introduced constraint L3).

### 12.4 Routing, persistence and re-entry

Keep one storage key. `ptah.onboarding.v1 = { shownAt?, dismissedAt?, completedAt?, ready?: { claudeAt?, settingsAt?, skippedAt? } }`, same try/catch wrapper and same storage-failure rule (failure means no redirect, never a loop). `ready.claudeAt` is written when stage 1 is left with state `ready`; `ready.settingsAt` when stage 2 is left by Continue; `ready.skippedAt` when either stage is left by Continue anyway or Skip for now. The Claude state itself is never persisted: it is re-derived live (12.2), so a user who fixes Claude later sees the banner disappear without any flag write. No sibling key (Decision 12.D1).

| Case | Result |
|---|---|
| First run: `shownAt` absent (existing guard, 1.2) | The guard's `UrlTree` target changes from `/onboarding` to `/onboarding/ready` when `ready` has no `claudeAt` and no `skippedAt`; otherwise `/onboarding`. Everything else in 1.2 (eligibility, `shownAt` commit on `NavigationEnd` to any `/onboarding...` URL, supersession, storage failure) is unchanged. |
| Upgrading user (flag `v1`, no `shownAt`) | Same rule: sees stage 1 once. |
| Home reached by menu "Setup", by Settings "Run onboarding again" or by a resume banner (1.2 re-entry) | Always lands on `/onboarding` (Home); the flag is ignored. Home shows the strip (12.6) and the banner. "Review Claude Code and settings" in the Home footer re-opens stage 1 at any time. |
| Stage 1 or 2 opened directly (deep link, reload) | Allowed. Reload re-derives state; no recovery screen is needed because nothing in the stages is session-bound. |
| Stage 1 Continue or Continue anyway | `navigate('/onboarding/ready/settings')`. |
| Stage 2 Continue to setup or Skip for now | `navigate('/onboarding')`. |
| "Back to chat" | Home only, as 3.1; the stages offer the "Onboarding" crumb (to Home). `dismissedAt` semantics are unchanged. |
| Re-entry from Settings | Settings keeps "Run onboarding again" (1.2); it goes to Home, never to stage 1, so a returning user does not repeat the pre-steps. Settings may add a second row, "Check Claude Code" to `/onboarding/ready` (Lane-introduced L4). |
| Legacy URL normalisation (1.3) | `/onboarding/ready*` is a new child; the alias map still sends retired ids to Home. |

Surface registry: add the two child paths to the `onboarding` entry in `libs/shared/src/lib/types/webview-surface.types.ts` alongside 1.1 (route table rows below); focus router and stepper treat them as the `ready` flow.

| Path | Screen | Identity in URL |
|---|---|---|
| `/onboarding/ready` | Stage 1 Claude Code | none |
| `/onboarding/ready/settings` | Stage 2 Providers and tools | optional `?tab=providers` or `?tab=cli` (so the stage-1 named-account link opens the Providers tab) |

### 12.5 Providers and tools (stage 2): reuse, not new UI

Survey of `libs/frontend/chat/src/lib/settings/**` and the decision. Embed two existing components unchanged, each as one tab of a tablist ("Settings area"); everything else stays in Settings (linked, not embedded).

| Tab | Existing component (embedded as is) | File | Why this is the minimum |
|---|---|---|---|
| Providers | `ptah-providers-settings` | `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts` | Already the single place for connection cards, the detail drawer (Credentials, Accounts, Models), named Claude accounts, catalog and Kimi login. Its Claude card carries the ambient badge. |
| CLI tools | `ptah-cli-orchestration-matrix` | `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts` | Lists every detected CLI (Codex, Gemini, Copilot, Cursor, Claude and the rest) with installed, version and "use" state, and ptah-cli provider instances. It already hosts `ptah-agent-orchestration-config` (`agent-orchestration-config.component.ts`, Re-detect via `state.redetectClis()`) and `ptah-add-cli-instance-modal` (`providers/add-cli-instance-modal.component.ts`, the "Add a Ptah CLI instance" flow with its Copilot inline sign-in). Do not embed `orchestration-settings.component.ts`: it adds budgets, TTL, lane guards and voice that are not first-run decisions. |

Not embedded, reachable later from the footer line "More options (voice, search, lane guards) are in Settings after setup.": Advanced, Search and voice, License, Output style, Pro features, Feedback, and the orchestration extras (`orchestration-settings`, `lane-guards-settings`, `session-budget-settings`, `voice-config`).

The prototype draws both tabs as specimens (a dashed note on the page says so); the production stage mounts the real components with no new inputs, outputs or services. Whatever each component loads on mount (connections list, `agent:detectClis`) is the existing behaviour. Because `ptah-providers-settings` and the matrix are deferred chunks in settings, the stage mounts them in `@defer (on immediate)` with the same `aria-busy` placeholder and Reload-on-error fallback the settings page uses (`settings.component.html:162-200`).

Layout: tablist ("Providers", "CLI tools"; arrow keys move, roving tabindex), then the tabpanel. Action row: "Back" (ghost, left), "Skip for now" (ghost) and **Continue to setup** (primary). Skipping and continuing differ only by the flag write (12.4). Warning banner above the tabs when Claude is not ready (12.3).

States inside the embedded components (loading, empty, error, drawers, modals) are those of the settings page and are not redesigned here. Dialog focus restore: the embedded drawer and modal already return focus to their openers.

### 12.6 Stepper and progress with the existing home and guard

The approved vertical `OnboardingStepper` (section 2) is per flow (Analyze, New project). The pre-steps get the same component in a horizontal "strip" mode with three labelled items shown on all three screens: **1 Claude Code**, **2 Providers and tools**, **3 Choose a path**. It is a progress and orientation aid, not a lock: items are not links; navigation is by the screen's own buttons. Each item carries a state word under its label: item 1 shows the live state ("Checking", "Ready", "Needs install", "Needs sign-in", "Could not check"); item 2 shows "Next" before, "Done" after (`settingsAt`) or "Skipped" (`skippedAt`); item 3 shows "Next". Markers: current = gold ring (as 3.2), ready/done = filled green with a check, needs attention = filled `--need` with "!" , so status survives without colour. `aria-label="Setup progress"`, current item `aria-current="step"`, hidden text is not used for state (the small text is real text). Below 720px non-current items collapse to their number marker, the current item keeps its label (same collapse rule as the vertical stepper at 720px, section 8).

On Home (stage 3) the strip appears above the h1; the Analyze, New project and Team builder flows keep their own steppers and do not show the strip. The Home resume banner (3.1) and the Claude banner can show together: resume banner first (work in progress) below the Claude banner.

### 12.7 Accessibility

- One h1 per screen ("Check Claude Code", "Connect providers and tools"), focused on route entry like every other route (section 8); status text and chips never rely on colour alone.
- Result announcements: one polite `status` region (`aria-live="polite"`) for checking start, finished and "Command copied"; the panel carries `aria-busy` while checking. The banner is `role="status"`.
- Command rows: the command is selectable text; Copy has a specific accessible name ("Copy macOS and Linux install command"); focus stays on the button after copy.
- Tablists (OS and Settings area): `role=tablist/tab/tabpanel`, `aria-selected`, `aria-controls`, roving `tabindex`, Left/Right arrows wrap; tabpanels are focusable (`tabindex=0`).
- Hit targets 32px minimum (Copy, list buttons) and 36px for page buttons; focus ring is the existing `:focus-visible` gold ring.
- Reduced motion: only the existing view fade and chip pulse; both already neutralised by the global `prefers-reduced-motion` rule.
- Contrast (criterion WCAG 2.2 AA, text 4.5:1, large 3:1, UI glyphs 3:1). Measured with the prototype token values on `surface-1` (the panel and banner base): dark, body 14.0, muted 7.4, need 6.2, "bc on need-wash banner" 12.3, err 4.65, done 5.3, run 4.8, idle 6.9, white on primary 5.2, `surface-0` on the `--need` marker 6.6. Light (oklch tokens converted to sRGB, approximate): body 14.8, muted 6.2, need 5.3, "bc on need-wash banner" 12.9, err 5.5, done 5.1, run 5.5, idle 4.8, white on primary above 6. All pairs pass 4.5:1. Implementation gate: Playwright plus axe per state and theme (not run here).

### 12.8 Narrow layout (400px, docked sidebar)

Checked at 400px in `narrow.html` (screenshots `get-ready-1-missing-narrow-dark.png`, `get-ready-2-providers-narrow-light.png`). Page padding 14px (existing 720px rule). Strip collapses to the current label plus numbered markers. The state chip drops under the panel title. The definition list becomes one column (label above value) below 480px. Command rows stack: code on its own full-width line (wraps at any character), Copy button right-aligned beneath it. The OS tablist stays one row (three short labels). Provider and CLI list rows wrap: name block, then chip and action. Action row: buttons share a full-width group; primary last. Banner: text then button, stacked. The 52px docked answer bar from the harness flows does not apply (no dock on these screens).

### 12.9 Component additions and reuse

New (lib `libs/frontend/onboarding`, standalone, OnPush): `ClaudeReadinessStore` (derives the state in 12.2 from `ProvidersSettingsStateService` detect results and `ClaudeAmbientStatusService.view()`), `ReadyClaudeStep`, `ReadySettingsStep`, `ClaudeReadinessBanner`, `CommandCopyRow` (code plus Copy, clipboard with a visible failure fallback "Select the text and copy it"), `ReadyStrip` (horizontal stepper mode of `OnboardingStepper`), and a `ready` slice in `OnboardingFlagService`. Reused unchanged: `ProvidersSettingsComponent`, `CliOrchestrationMatrixComponent` (with its embedded `AgentOrchestrationConfigComponent` and `AddCliInstanceModalComponent`), `ClaudeAmbientStatusService`, `ProvidersSettingsStateService`, `ProviderAccountsStateService` and the Claude connection drawer (Credentials and Accounts tabs).

### 12.10 Decisions

| # | Decision | Options | Evidence | Reversible |
|---|---|---|---|---|
| 12.D1 | Pre-step progress lives in the existing `ptah.onboarding.v1` object as `ready: {claudeAt, settingsAt, skippedAt}`; no sibling key | (a) nested object in v1 (chosen); (b) sibling `ptah.onboarding.ready.v1` | One wrapper and one storage-failure rule already exist (1.2); the guard reads one place; a sibling doubles the failure paths | Yes, a flag shape change |
| 12.D2 | Home reached by menu or Settings re-entry never repeats the pre-steps; only the first-run guard targets `/onboarding/ready` | (a) re-entry to Home (chosen); (b) re-entry to stage 1 | 1.2 already states re-entry ignores the flag and opens Home; the Home footer link covers a deliberate re-check | Yes |
| 12.D3 | Show only the three user-requested install tabs (macOS/Linux, Windows, npm); Homebrew, WinGet and apt/dnf/apk stay in the docs link | (a) three tabs (chosen); (b) all methods | User asked for the three; the docs list the package managers, which do not auto-update and need more caveats | Yes |
| 12.D4 | Sign-in command is `claude`, per the current official docs. The settings Credentials tab still shows `claude login` and the install command `npm install -g @anthropic-ai/claude-code` (`credentials-tab.component.ts:91-93`). The implementation takes both strings from one shared constant, so settings and onboarding cannot drift | (a) `claude` per docs (chosen); (b) copy `claude login` from settings | Docs "Authenticate": "log in by running `claude` and following the browser prompts"; I could not verify that `claude login` still exists, so I did not copy it. Needs confirmation from the owner of settings copy | Yes |
| 12.D5 | Stage 1 verdict reads the ambient (unnamed) Claude login only; a named account signed in through Providers does not turn the banner off | (a) ambient only (chosen); (b) any connected Claude account | `provider:getAmbientClaudeStatus` is ambient by contract (`provider-account.types.ts:264`); named accounts are separate routes. Choosing (b) needs a rule that is not in the contracts | Yes |
| 12.D6 | Embed the full `ptah-providers-settings` and `ptah-cli-orchestration-matrix` instead of building a reduced onboarding subset | (a) embed both (chosen); (b) new compact lists; (c) only link to Settings | The brief says reuse; a reduced list would duplicate sign-in, drawer and add-instance logic. The cost is a heavier second screen, mitigated by skip and deferred loading | Yes, pending visual review of the real embed |
| 12.D7 | A timeout or unreadable result is an error state, never "signed out" | (a) separate error state (chosen); (b) fold into signed-out | The contract states `unknown` is never read as signed out | No (contract) |
| 12.D8 | Continue anyway is available in every non-ready state including checking (D11) | (a) always (chosen); (b) wait for the first result | D11: warn but allow skip; a slow probe can last 30 s and must not trap the user | Yes |
| 12.D9 | Re-check runs both detect and a fresh ambient read (`read(true)`); entry uses the cached read | (a) as stated (chosen); (b) always fresh | The service documents `refresh:false` for host cache and `true` for a new probe; entering with cache is fast | Yes |

Sources for the install section (read 2026-10-28): Claude Code docs "Advanced setup" `https://code.claude.com/docs/en/setup` (native installer commands for macOS/Linux/WSL, PowerShell and CMD; npm requires Node.js 22 or later and no sudo; verify with `claude --version`; "Authenticate": run `claude` and follow the browser prompts; account types Pro, Max, Team, Enterprise or Console).

### 12.11 Lane-introduced constraints

Nothing here was asked for by the user beyond D10 and D11; these are the lane's own and need confirmation before implementation:

- **L1 `[lane-proposed]`** The first-run guard redirects to `/onboarding/ready` (not Home) until a pre-step flag exists, so every new and upgrading user sees stage 1 once. Alternative: keep redirecting to Home and show only the banner.
- **L2 `[lane-proposed]`** The `ready` sub-object in `ptah.onboarding.v1` (12.D1).
- **L3 `[lane-proposed]`** The persistent warning appears on stage 2 and Home only; it is not added to chat, the status bar or other surfaces. D11 says "persistent"; a chat-level banner would be a separate, user-visible change.
- **L4 `[lane-proposed]`** An optional second Settings row "Check Claude Code" linking to stage 1.
- **L5 `[lane-proposed]`** Copy text, state words and the PATH/restart hint ("restart Ptah so it picks up the updated PATH") are proposals; the restart hint is a plausible cause, not a measured one, and should be checked against how Electron resolves `PATH` before shipping.
- **L6 `[lane-proposed]`** Settings-copy alignment (12.D4) touches `credentials-tab.component.ts` strings, a change outside the onboarding lib.
- **L7 `[lane-proposed]`** Both pre-steps also appear to users who already have Claude Code ready; for them stage 1 is a one-click "Continue" screen. Alternative: auto-skip stage 1 when the first check returns `ready`.

### 12.12 Revision log

| Date | Change |
|---|---|
| 2026-10-28 | Section 12 added; cross-references in the page header and in 1.2 (flag shape, guard target). Prototype: two views, Home banner and strip, Claude state switch, `narrow.html` `state` parameter. Approved sections otherwise unchanged. |


## 13. Visual revision: icons and glass (user request 2026-10-28)

Scope: visual layer only. Layout, copy, states, routes and every decision in sections 1-12 are unchanged. The prototype (`prototype/index.html`) now defaults to `ptah-glass`; the bar switches between the four themes below. Electron is the reference host.

### 13.1 Themes covered

| Prototype label | `data-theme` | `data-glass` / `data-glass-mode` | Real source |
|---|---|---|---|
| Glass dark | `ptah-glass` | `on` / `dark` | `tailwind.config.js:225` (palette), `theme.service.ts:101` (`DAISYUI_THEMES`, `glass: true`) |
| Glass light | `ptah-glass-light` | `on` / `light` | `tailwind.config.js:270`, `theme.service.ts:102` |
| Plain dark | `anubis` | absent | `tailwind.config.js:80`, `theme.service.ts:103` (the app's own non-glass dark; `dark` and `light` are stock DaisyUI themes and are not the product pair) |
| Plain light | `anubis-light` | absent | `tailwind.config.js:149`, `theme.service.ts:104` |

`ThemeName`, `DAISYUI_THEMES`, `ACCENT_COLORS` (accents `gold|rose|moonstone`) and scenes (`aurora|ember|tide|horizon`) live in `libs/frontend/core/src/lib/services/theme.service.ts:19-106`. Onboarding adds no theme and no token: it only sets `data-glass-surface` on its own elements and uses the existing `--glass-*`, `--b1..b3`, `--bc`, `--bcm` and `--state-ink-*` variables. Measurements below are for the default gold accent and the default `aurora` scene (`DEFAULT_ACCENT`, `DEFAULT_SCENE`, `theme.service.ts:68,71`).

### 13.2 Icons

Library: `lucide-angular` 1.0.0 (root `package.json:185`). Every name below was checked against `node_modules/lucide-angular/icons`. Size is `1.1em` inline (16px at 14px body), larger where stated; stroke is the Lucide default 2 (3 inside a status badge). In the app the icons register through the app's existing Lucide provider; the prototype inlines the same path data as `<symbol>`s.

Aria rule for all icons: decorative, `aria-hidden="true"` and not focusable, because a visible text label always sits next to the icon. The only icon-only meaning is state, and state always also has a text word (chip text, `Needs install`, `Ready`), so no icon carries information alone. No icon-only buttons are introduced.

| Surface | Lucide name | Size / treatment | Aria |
|---|---|---|---|
| Stepper, step 1 Claude Code | `terminal` | 24px ring `.n`; ring colour follows state | decorative; step label + state word is the name |
| Stepper, step 2 Providers and tools | `plug-zap` | same | same |
| Stepper, step 3 Choose a path | `route` | same | same |
| Stepper state badge (corner, 17px) | `check` (ready/done), `triangle-alert` (needs action), `loader` (checking, spins) | stroke 3, state-ink fill | decorative; the state word under the label carries it |
| Page title tile (h1) | same glyph as its step (`terminal`, `plug-zap`, `route`; `layers` Proposal, `shield-check` Review, `message-square` Intake, `list-checks` States) | 44px tile (38px at 480px), glyph 1.35rem | decorative |
| Home card Analyze | `scan-search` | 48px tile, glyph 1.35rem | decorative; the h2 is the link name |
| Home card New project | `folder-plus` | same | same |
| Home card AI team builder | `users` | same | same |
| Analyze card checklist | `scan-search`, `list-checks`, `wand-sparkles`, `book-open` | 1.1em | decorative |
| Card CTA affordance | `arrow-right` | 1.1em after label | decorative |
| Warning banner (D11) | `triangle-alert`; action `download` (missing), `log-in` (signed out), `refresh-cw` (error) | 1.1em | decorative; banner is `role="status"` with the sentence |
| Fix / Re-check / Copy / Open guide | `terminal`, `refresh-cw`, `copy` (`check` after copy), `external-link` | 1.1em inside the button | decorative; button text is the name |
| Resume strip | `loader` (chip), `play` (Resume) | 1.1em | decorative |
| Status chips | `circle-check` Connected / Installed / Ready; `unplug` Not connected; `log-in` Signed out; `download` Not installed; `circle-alert` error; `clock` queued; `loader` running; `ban` cancelled; `pause` paused; `circle-x` failed; `circle-dashed` pending | 1.1em at 12px text | decorative; chip text names the state |
| Analyze / New project / Team sections | Agents `bot`, Skills `sparkles`, MCP `plug-zap`, Plugins `puzzle`, Toolchain `wrench`, reply panel `message-square`, send `send`, Review `shield-check`, Launch `rocket`, add `plus`, rollback `rotate-ccw`, files `file-text`, edit `pencil`, settings `settings`, specimen `cpu`/`server` | 1.1em | decorative |

Dark/light/plain: icon colour is `currentColor`, taken from `--bc` on neutral tiles and the `--state-ink-*` tokens on state icons (same tokens as the text they sit beside, so icon contrast equals the text pairs in 13.5). In forced-colors mode icon tiles fall back to `CanvasText` on `Canvas` with a 1px border (prototype `@media (forced-colors:active)`).

#### Provider icons and fallback

Finding that changes the earlier assumption: **the repo already ships provider artwork.** `ptah-brand-mark` (`libs/frontend/ui/src/lib/native/brand-mark/brand-mark.component.ts`), its monogram fallback `ptah-monogram-tile`, the slug table `PROVIDER_BRAND_SLUGS` (`brand-slugs.ts:74-95`) and `ptah-provider-mark` (`libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.ts:67`) are vendored from theSVG with per-icon licences recorded in `provider-brand-art.vendored.ts:5-8`, and shipped notices in `brand-icons-notices.txt`. Onboarding must reuse them and must not vendor or hand-draw any logo. The prototype `m-*` symbols are the same vendored path data, drawn on the existing tile rule (`tileFor`: theme tile, or a white tile when the mark needs one).

| Row | Provider id -> slug (`brand-slugs.ts`) | Artwork | Fallback if the slug has no art |
|---|---|---|---|
| Claude (subscription) / Claude Code tool | `claude-cli` -> `claude` | vendored mark, CC0-1.0 | monogram tile `C` |
| OpenAI Codex | `codex` / `openai-codex` -> `codex` | vendored mark; licence "brand-use, nominative use only" (`provider-brand-art.vendored.ts:8`) | monogram `C` |
| GitHub Copilot | `github-copilot` | vendored, MIT | monogram `G` |
| OpenRouter | `openrouter` | vendored, CC0-1.0 | monogram `O` |
| Kimi Code | `kimi-code` -> `moonshot` | vendored, MIT | monogram `K` |
| Anthropic API key | `anthropic` | vendored, CC0-1.0 | monogram `A` |
| Gemini, Ptah CLI instances, any provider without a slug | none | none | `ptah-monogram-tile` with the first letter, deterministic tint (`monogramTintClass`); for CLI tools without a slug the prototype uses the Lucide `terminal` glyph on a neutral tile |

Treatment: the prototype draws a 38px tile; production uses `ptah-brand-mark size="md"` (`MARK_TILE_BOX_CLASS`: 32px tile, 20px art; `lg` is 56px and too large for a list row), so 32px is the implementation value and the 6px difference is accepted; tile corner `--glass-radius-sm` (10px), tile fill `--glass-fill-tile` plus an 18% tint of the provider accent and a 45% accent hairline. The accent is decoration only; brand colours never carry state. The provider name is the visible text next to the tile; `ptah-brand-mark` already sets `aria-hidden="true"`.

Licensing and trademark rules (from the repo's own notices, to keep): (1) use only marks already in `brand-marks.vendored.ts` / `provider-brand-art.vendored.ts`, regenerated with `npm run vendor:brand-icons`, never edited by hand; (2) nominative use only: the mark appears only next to the product name it identifies, never as Ptah branding and with no implied endorsement; (3) no `.svg` files and no vendor names in non-JS files (VS Code Marketplace scanner guard stated in both vendored headers), so the marks stay TypeScript path data; (4) `ptah-brand-mark` pulls the full artwork table, so render it only from lazy routes: the onboarding routes are lazy; eagerly loaded hosts use `ptah-monogram-tile` or the small `PROVIDER_BRAND_ART` subset via `ptah-provider-mark`. Open: Codex is "brand-use, nominative only" while the others are MIT or CC0; confirm that the legal reading matches the existing Providers screen, which already shows it.

### 13.3 Glass recipe

Onboarding adds no CSS tokens. It tags surfaces, and `styles.css` section 2 (`styles.css:2585-2588` documents the surface roles) supplies the recipe. Values in the table are the real ones, "dark" from the `data-glass-mode='dark'` block (`styles.css:2659-2694`), "light" from the base block (`styles.css:2598-2656`).

| Onboarding element | `data-glass-surface` | Fill | Blur | Border | Shadow |
|---|---|---|---|---|---|
| Top bar, stepper current pill, warning banner, resume strip, dock | `chrome` (banner and dock add a 70% state-colour border) | dark `--glass-fill` = `bc` 6% (`:2665`); light `b1` 44% (`:2618`) | `--glass-blur` 16px, saturation 1.16 / 1.15, brightness 1.06 dark (`:2605`, `:2660`) | 1px `--glass-line`: dark white 12% (`:2680`), light white 85% (`:2642`); top edge highlight `--glass-edge-top` 38% dark (`:2678`) / 80% light (`:2640`) | `--glass-shadow` dark `0 18px 46px -20px rgb(5 8 14 / .38)` (`:2684`); light `0 18px 44px -20px rgb(86 68 132 / .24)` (`:2646`) |
| Panels, path cards, provider list, command box | `content` | stable fill, no blur (`:2936`): `--glass-fill-raised` dark `bc` 20% (`:2666`), light `b1` 72% (`:2619`) | none | `--glass-line` | `--glass-shadow` |
| Nested tiles: icon tiles, chips, agent/skill cards, log | `tile` | `--glass-fill-tile`, light 50% of `b1`; no blur (`:2943`, light variant `:2950`) | none | `--glass-line-strong` (`bc` 28-30%) | none; 1px inset `--glass-glint` on icon tiles |
| Reply dock opened over content | `overlay` | `--glass-fill-overlay` dark `b2` 88%, light `b1` 90% | `--glass-blur-overlay` 22px | `--glass-line` | `--glass-shadow-overlay` |

Radii: panels and cards `--glass-radius` 22px, banner/resume/dock `--glass-radius-inner` 14px, tiles `--glass-radius-sm` 10px, chips and tabs pill. Page backdrop: the shared scene layer (`:root[data-glass='on']::before`, `styles.css:2800-2820`) with `--glass-tint` (alpha 0.7 dark, 0.5 light); onboarding does not paint its own background, so blur always has local light behind it. Primary buttons use the existing gold gradient with dark ink (`--g-gold-a/b`, `--g-gold-ink`, `styles.css:3217-3224`). Focus uses `--g-ptah-focus` / `--glass-focus`, unchanged.

Plain themes (`anubis`, `anubis-light`): no `data-glass`, so every `--glass-*` rule is dormant; the same markup renders on `--b1..b3`, 1px `--line` borders and no blur, exactly as sections 1-12 specified. The glass look is purely additive.

### 13.4 Fallbacks

- `prefers-reduced-transparency: reduce` or `prefers-contrast: more`: `styles.css:2716-2745` and `:3352` make every glass fill opaque (`--glass-fill` = `b1`, raised = `b2`, tile = `b2`), set `--glass-filter` to `none`, hide the scene (`:root[data-glass='on']::before { display: none }`), drop shadows and glint, and raise borders to `bc` 35% (60% for `more`). Onboarding inherits it with no rule of its own. Specimen: the bar's "Reduced transparency" switch and `?rt=reduce`; screenshots `v2-providers-missing-reduced-transparency-glass-*.png`.
- `forced-colors: active`: `styles.css:2757-2770` turns every `[data-glass-surface]` into `Canvas` / `CanvasText` with a 1px border; icons use `forced-color-adjust: auto`.
- No `backdrop-filter` support: the fill alphas above are high enough that text stays readable on `--glass-tint` alone (the measurements in 13.5 include the scene and tint, not a flat colour).
- Plain themes: see 13.3.
- Reduced motion: the only motion added is the 1.6s `loader` spin on the checking badge and chips. The global rule at `styles.css:2775-2781` (and the app's `:839` rule) collapses animation and transition durations to 0.01ms, so the spinner becomes static while the text "Checking" remains. No blur, parallax or entrance animation was added.

### 13.5 Measured contrast

Method: the prototype was rendered in headless Google Chrome (Playwright, 1280px, default accent, `aurora` scene). For each visible element (up to 3 per selector, four views: Home with banner, Get ready stage 1 missing, stage 2 providers, New project proposal), its own text was made transparent and the element's inner area (inset 8px horizontally, 22% vertically, to exclude borders and rounded corners) was screenshotted, which includes the real blur, scene, tint and fill. The text colour was resolved to RGB (alpha composited) and the contrast ratio per WCAG 2.2 (relative luminance, `(L1+0.05)/(L2+0.05)`) was computed against the 3rd-percentile darkest and 97th-percentile lightest pixel; the lower ratio is reported. 100 samples per theme (56 selector-and-view combinations). Criterion: WCAG 2.2 AA, 4.5:1 for text under 24px (or under 18.66px bold), 3:1 for large text and UI glyphs.

| Theme | Headings (min) | Body and muted text (min) | Status chips (min) | Buttons, tabs (min) | Failures |
|---|---|---|---|---|---|
| Glass dark | 7.18 | 5.75 (card checklist) | 7.45 | 7.81 | 0 |
| Glass light | 12.34 | 5.19 (card checklist) | 5.48 | 5.38 (ghost "Skip for now") | 0 |
| Plain dark | 11.15 | 5.84 | 4.76 ("In progress") | 5.17 (primary "Resume") | 0 |
| Plain light | 12.52 | 5.45 | 4.80 | 6.28 | 0 |

Icons: neutral icons are `--bc` on `--glass-fill-tile`, the same pair as the headings row (7.18 or higher); state icons share colour with their chip text (4.76 or higher), and the state ink tokens are independently guarded on all four themes over base-100..300 by `apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts`. Brand marks are identification, not information, and the name is always beside them.

Limits: only the `aurora` scene was measured; `ember`, `tide` and `horizon` shift `--glass-tint-alpha` (`styles.css:2830-2835`) and were not re-measured for onboarding screens. Because text sits on `content`/`tile` surfaces with 20%-72% fills plus the 0.5-0.7 tint, not directly on the scene, the margin (at least 0.7 above the 4.5 floor in the worst case) is the evidence; a scene sweep belongs in the implementation visual gate. Measured values are pixel samples of a prototype, not guarantees for production; the implementation gate repeats them on the real components.

### 13.6 Decisions

| # | Decision | Options | Evidence | Reversible |
|---|---|---|---|---|
| 13.D1 | Plain pair is `anubis` / `anubis-light` | (a) anubis pair (chosen); (b) stock `dark` / `light` | `theme.service.ts:103-106`: `dark` is glass-flagged and stock; anubis is the product's own non-glass themes | Yes |
| 13.D2 | Reuse `ptah-brand-mark`, `ptah-monogram-tile`, `ptah-provider-mark`; no new logos | (a) reuse (chosen); (b) new brand SVGs; (c) Lucide only | Artwork, notices and licence records exist in `libs/frontend/ui/.../brand-mark`; a second set would split licence tracking | Yes |
| 13.D3 | No icon-only meaning and no icon-only buttons; all icons `aria-hidden` | (a) as stated (chosen); (b) labelled icons | Every icon has an adjacent text label in sections 3 and 12 | Yes |
| 13.D4 | No new tokens or components for glass; tag surfaces only | (a) tag only (chosen); (b) onboarding-specific glass CSS | `styles.css` section 2 already covers all four surface roles, fallbacks and forced colours | Yes |
| 13.D5 | Measure on the default scene and accent only | (a) default (chosen); (b) 4 scenes x 3 accents now | Cost; scene sweep deferred to implementation visual gate (recorded as risk in 13.5) | Yes |

### 13.7 Lane-introduced constraints

None beyond section 12.11. Everything in this section restyles with existing tokens; it adds no behaviour, copy or rule.

### 13.8 Screenshot index

All in `prototype/screenshots/`, 1280px wide unless noted, suffix `-glass-dark`, `-glass-light`, `-plain-dark`, `-plain-light`:

- Stage 1: `v2-get-ready-checking`, `v2-get-ready-ready`, `v2-get-ready-missing`, `v2-get-ready-signed-out`, `v2-get-ready-error`
- Stage 2: `v2-providers-missing` (provider rows with Claude warning), `v2-cli-tools-ready` (CLI tools tab)
- Home: `v2-home-ready` (three cards, progress strip, resume), `v2-home-missing` (warning banner)
- Step UIs: `v2-analyze-generating`, `v2-project-proposal`, `v2-review-apply`, `v2-team-start`, `v2-team-proposal`, `v2-states`
- Narrow 400px, glass dark and glass light only: `v2-get-ready-missing-narrow`, `v2-providers-narrow`
- Reduced transparency, glass dark and light: `v2-providers-missing-reduced-transparency`

### 13.9 Revision log

| Date | Change |
|---|---|
| 2026-10-28 | Section 13 added. Prototype: glass default, four-theme switch, reduced-transparency specimen, icon system, vendored provider marks. |
