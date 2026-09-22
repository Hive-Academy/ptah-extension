# Consolidated Providers settings

Task: `TASK_2026_523_c3df` · Desktop Angular specification · 22 September 2026

## Information architecture

**One destination: Settings → Providers.** It answers, in order: what will run the next main-agent request, which connections are available, what background work uses, and how to connect something else. Connecting a provider, assigning a background consumer, and making a route active are three distinct actions.

Apply the existing Ptah design system from `.agents/skills/technical-content-writer/DESIGN-SYSTEM.md`, using its deployed desktop realization in `apps/ptah-extension-webview/tailwind.config.js`. Use the existing Inter/system font, daisyUI surfaces, blue primary actions, and restrained gold identity accent. The marketing reference's display typography, glows, and large section spacing do not belong in this settings surface. The content-driven repeated-item pattern comes from `.agents/skills/ui-ux-designer/LAYOUT-PATTERNS.md`; implementation detail follows `DEVELOPER-HANDOFF.md`. No new palette or design system is required.

Order:

1. Providers heading, workspace context, and **Connect provider** action.
2. **Main agent**: effective route, readiness, concrete model when known, authentication source, and scope provenance.
3. **Your connections**: active connection first, then connected idle connections, then previously configured connections needing attention.
4. **Background models**: memory curator; Archaeologist, Synthesis, Judge, and Replay lanes; Judging & enhancement.
5. **CLI agents**: named agent instances, enabled status, provider references, and orchestration model assignments.
6. **More providers**: remaining catalog entries, initially collapsed; Connect provider opens the same catalog in wizard step 1.

For the requested 11-provider / 2-configured example, show “2 configured · 11 available” under the heading, two compact connection rows, and “More providers (9)”. If both are healthy, one row says **Active for main agent** and one says **Connected · Available**. The nine unconfigured entries are an invitation, never nine warnings. Failed configured connections remain in Your connections and do not disappear into the catalog. Catalog and configured counts count provider entries, not CLI instances or authentication modes; count ready connections separately when useful. Derive inventory from the merged registry and host capabilities, not the nine-entry constant currently embedded in `PtahCliConfigComponent`. Custom entries add to the catalog; 11 is the example, not a hard-coded limit.

At a 1024×768 desktop viewport at 100% text scale, keep the Providers heading, workspace line, main-agent summary, and both connection rows above the fold. Budget approximately 64 px for the page header, 152 px for the route summary, and 88 px per connection row, plus the documented spacing. These are content budgets, not fixed heights: errors, zoom, long names, and translated text may expand them. Move the license promotion and data-portability panels currently preceding provider controls out of this panel; retain access in their existing settings destinations. At narrow widths, preserve reading order and allow vertical scrolling rather than compressing text.

### Replace existing editors

| Current surface / source | Consolidated owner | Treatment of previous entry point |
| --- | --- | --- |
| `settings/auth/auth-config.component.ts` and `.html`; `authMethod`, `anthropicProviderId` | Main agent and connection wizard | Replace strategy-radio/tile editor with Providers content. No user-facing `authMethod` enum. |
| `settings/auth/provider-model-selector.component.ts`; selected model and tier mappings | Main-agent model editor and connection Models detail | Replace its independent autocomplete UI with the shared picker composition; preserve established tier persistence. |
| `settings/ptah-ai/ptah-cli-config.component.ts`; `ptahCliAgents[]` | CLI agents section | Move/rework the existing instance editor here; remove the previous mounted editor. |
| `settings/ptah-ai/agent-orchestration-config.component.ts`; `agentOrchestration.*Model` and provider credentials | CLI agents section | Move provider/model/credential controls here. Concurrency and execution policy can remain under Agent Orchestration, with a link to the selected CLI row. |
| Memory diagnostics; `memory.curatorProvider`, `memory.curatorModel` | Background models → Memory curator | Replace selector with resolved read-only summary and **Manage in Providers** link. |
| `skill-settings-panel.component.ts`; four `skillSynthesis.<lane>.provider/model` pairs | Background models → four separately named lanes | Remove those picker mounts from Skills settings; link to the relevant row. Retain unrelated synthesis policy there. |
| Skills “Judge model ('inherit' = workspace default)”; `skillSynthesis.judgeModel` | Background models → **Judging & enhancement** | Remove free-text editor. Add shared picker and explicit explanation of enhancement usage. |
| `LlmProvidersConfigComponent` key/default/model cards | Connections or the relevant named consumer above | Its read implementation was verified, but it is not imported by the current `SettingsComponent`. Do not mount it as another editor. Audit remaining consumers before deleting unused implementation. |

Old deep links resolve to the matching Providers section and focus its heading or edit button. Dashboard and execution-time summaries can display status and link here; they must not gain another persisted provider selector. Existing per-run model choices, if retained by execution UX, must be explicitly transient and must not silently change Providers defaults.

## Section-by-section spec

### Shared layout and interaction tokens

Paths below are workspace-relative. Real styling sources: `settings.component.html`, the Native components named below, `ProviderModelPickerComponent`, and the webview Tailwind configuration. All numeric layout values below use Tailwind 3's existing scale, not new custom tokens.

| Element | Concrete class intent and source |
| --- | --- |
| Page | Existing `h-full overflow-y-auto bg-base-100`; inner `max-w-4xl mx-auto px-3 py-3 md:px-6 lg:px-8 space-y-4`. Keep the current 896 px maximum content width. |
| Type | `font-sans text-sm text-base-content`; page title `text-lg font-semibold`; section title `text-sm font-semibold`; helper/source lines `text-xs text-base-content-muted`. No opacity-based text hierarchy. |
| Groups | `space-y-3`; controls `flex flex-wrap items-center gap-2`; paired fields `grid grid-cols-1 sm:grid-cols-2 gap-3`; all flexible text containers `min-w-0`, paths `break-all`. Tailwind `sm` = 640 px, `md` = 768 px, `lg` = 1024 px. |
| Card shell | `NativeCardComponent`, `density="compact"` gives `p-3 gap-2`, `rounded-xl border border-base-300` and existing `bg-base-200/40`. Use non-clickable shells with explicit buttons. On this tinted surface, use `text-base-content`; put muted scope/help lines on an opaque `bg-base-100` inset. |
| Primary action | `btn btn-primary btn-sm min-h-9 px-3`, exactly one primary action per local edit region. In garden/winter themes use the neutral treatment below because their current primary text pairs fail AA. |
| Secondary action | `btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content`; hover remains `bg-base-100 text-base-content` with underline. Override daisyUI's inversion so contrast is preserved. |
| Tertiary action | `btn btn-ghost btn-sm min-h-9 text-base-content`, transparent background, underline on hover. Destructive action uses a `Trash2` icon and explicit words, with inline confirmation; red is supplementary. |
| Inputs/selects | Existing `input input-bordered input-sm` / `select select-bordered select-sm`, plus `w-full min-h-9 bg-base-100 text-base-content border-base-content-muted`. Labels remain outside fields. |
| All focus targets | `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content`; place on `bg-base-100` for the measured focus pair. Do not suppress native focus without this replacement. |
| Status labels | `badge badge-outline text-xs font-medium gap-1 bg-base-100 text-base-content border-base-content-muted`; allow multiline copy outside the badge. Colored icons/spines supplement the text. |

The focus and neutral-control rules apply inside reused components as well as on their host wrappers; inherited primitive styles are not proof of accessibility. See the measured exceptions below.

### 1. Page header and workspace context

Keep Settings navigation; use verified `NativeTabGroupComponent` for the settings tab strip when replacing its current hand-written tab buttons. Providers is one tab, without provider-specific sub-tabs. Header is `flex flex-wrap items-start justify-between gap-3`. Show **Providers**, configured/catalog counts, and Connect provider with `Plus`.

Immediately below, show **Workspace: ptah-extension** and the full path as selectable, wrapping text. If no workspace is open: “No workspace open. Workspace overrides are unavailable.” The context line is not a write-scope selector. Source and target are explicitly separate below.

Loading: “Loading providers…” in a polite status region; do not render a default active provider. Failure: “Providers could not be loaded. Your saved settings have not changed.” with **Retry**. If only one section fails, keep successfully loaded sections usable and place Retry in the failed section.

### 2. Main agent

Use a compact `NativeCardComponent` with `tone="secondary"`, `spine=true`, and no card activation. Header **Main agent**, badge **Active for main agent**, then human-readable route identity: for example **Claude · CLI subscription** or **Claude · API key**. Never collapse these to “Anthropic” solely because their `activeProviderId` matches. A “Connected” badge elsewhere cannot establish this identity.

Body shows **Next request uses: {provider} · {auth source} · {model or tier}**, plus explicit source lines for route/provider/model. If no concrete model can be resolved, use “Default {tier} tier · model resolved when the request starts”; do not name an inferred model. Model change uses the shared picker with this route's provider fixed. The UI description concerns the next request; any running session stays identified separately until the host confirms it has adopted the change.

Actions: **Change main provider**, **Edit model**, **Check connection**. Change main provider opens an inline selection of existing connection identities, each with health and scope, then a review row: “Use {route} for new main-agent requests.” Background rows set to inherit are named in the impact preview; pinned rows stay pinned. Save only after the route is ready and the destination scope is explicit. Selecting a row or browsing a wizard step never changes the active route.

There is one effective main-agent route, never one per connection. A not-configured install has no active route; a blocked route remains the one selected route, labeled **Main agent · Needs attention**, with the relevant health state. It never gets the healthy Active badge. The old route remains active while a replacement is drafted or a switch fails. No automatic fallback to another connected provider.

Read route truth through a shared RPC snapshot backed by `resolveEffectiveAuthRoute`; do not import the backend resolver into frontend code. Its existing result only contains `route`, `ready`, and `blockers`, and currently treats some unknown/skipped probe statuses permissively. Implementation must combine it with explicit successful probe evidence and resolved provider/auth identity. `auth:getEffectiveRoute` is a required new contract, not an existing callable RPC. Failure to resolve truth displays “Main-agent route unavailable. Check connection to refresh.” rather than trusting `persistedTileId` or an API-key default.

If an API key takes precedence over a CLI subscription, report the effective API-key route and show “Your API key currently takes precedence over the CLI login.” **Use CLI subscription** opens the reviewed route change. This is not a logout or key deletion action.

### 3. Your connections

Each compact non-clickable Native card has a 24 px mark, provider name, explicit auth modality, status label, source line, and actions. Wide view: identity on the left, status and actions on the right; narrow view: `flex-col` with wrapping actions. Provider identity and auth modality never truncate; model IDs and paths wrap.

Active row: secondary spine plus **Active for main agent**. Connected idle row: neutral border, `CheckCircle` icon, **Connected · Available**, **Use for main agent**, and **Manage**. The copy “Available for main agent and compatible background work” can be narrowed by host capability; do not offer main-agent activation for a CLI-only integration. Disabled is not a synonym for idle.

Manage opens one `NativeDrawerComponent` with `widthClass="w-full max-w-2xl"`; header identifies the provider, body contains Connection, Models, and Used by sections, footer has Save/Cancel only while editing. The saved view shows last successful probe time, last failed check separately, auth source without secrets, endpoint when relevant, and consumer references. **Check connection**, **Replace key** / **Sign in again**, and **Disconnect** are explicit actions. An inline disconnect review lists affected main/CLI/background consumers before confirmation; it never silently reassigns them.

A provider with both API-key and CLI credentials has explicit method rows in its details. Badge and activation are attached to route identity, not merely vendor identity. Never overwrite a working credential when testing a draft replacement.

`ProviderAccountCardComponent` is a Codex-specific read-only account widget backed by dashboard state, not a generic connection card. Keep its existing dashboard usage; link from provider details to account usage rather than importing dashboard internals into chat. Preserve its distinction between quota and historical activity. Missing account-usage data does not mark authentication broken.

### 4. Background models

Heading copy: “These assignments run background work. They do not select the main agent.” Render six rows in this fixed order: **Memory curator**, **Archaeologist lane**, **Synthesis lane**, **Judge lane**, **Replay lane**, **Judging & enhancement**. Keep all six names visible; each row has resolved provider/auth/model, separate provider/model source labels, and Edit. One inline editor expands at a time, using `ProviderModelPickerComponent`; no nested picker implementation.

For Judging & enhancement, helper copy is mandatory: “Used for judging and for Enhance now on skills, agents, and commands. The Judge lane is configured separately above.” Its provider/model are separate choices in the shared picker, with a backend contract extension required for provider persistence: the existing `skillSynthesis.judgeModel` string alone cannot store both. The legacy `'inherit'` value must map to the shared picker's empty model sentinel without losing read compatibility. No UI-only provider pin and no concatenated provider/model string masquerading as the existing key.

The picker keeps its existing “Active provider (default)” and tier default semantics. Add an adjacent resolved summary: “Follows main agent → {route} → {model/tier}”. Setting source and runtime inheritance are different facts: a global setting may itself say “follow main agent”. Show both. Selecting an unavailable provider produces an inline readiness message and **Set up {provider}** deep link, not an unexplained disabled Save. Preserve the draft through setup and revalidate on return.

`defaultTier` and `requiresToolUse` come from each consumer's DTO/capability, including the existing lane `toolUse === 'required'` rule. Known incompatible models block a tool-required assignment; unknown capability says “Tool support not verified” and requests verification, never falsely “No tool use”. Editing these rows does not mutate the active main route.

Place **Enhancement time limit** directly beneath the Judging & enhancement editor. Use a labeled numeric `input input-bordered input-sm`, seconds suffix, source row, and “Maximum time allowed for one enhancement attempt.” Current `ENHANCE_TIMEOUT_MS` is a fixed 30 seconds; exposing it and raising its default is required backend work. The UI must display the new backend-provided effective default, range, and validation message; this specification does not assert an unimplemented timeout key or approved replacement duration. Display the current effective duration even before editing. On timeout: “Enhancement stopped after {seconds} seconds. No changes were saved.” Provide **Retry** and **Change time limit** links to this row, without implying that provider setup was lost.

### 5. CLI agents

Keep named agent instances distinct from vendor connections. A row contains name, provider/auth identity, Enabled/Disabled control, model/tier summary and source, **Edit**, **Check connection**, and **Remove agent**. Reuse/rework `PtahCliConfigComponent` in place as this section's instance manager. Add agent first chooses an existing compatible connection; Connect another provider opens the same wizard. Several agents can reference one connection and do not inflate the provider count.

Display “Enabled for delegated work” beside the toggle; never “Active”. Disabled instances remain configured. Removing an instance does not disconnect its underlying account. Moving `agentOrchestration.*Model` controls includes the existing external-CLI models, not only `ptahCliAgents[]`; preserve model IDs, capabilities, and separate reasoning controls. A shared-picker catalog/loader extension is required for external CLIs that are absent from its current registry. No parallel CLI model picker.

### 6. More providers

Use a native `details`/`summary` disclosure styled `rounded-xl border border-base-300 bg-base-100`, summary `p-3 text-sm font-medium min-h-9`. Expanded catalog uses `grid grid-cols-1 sm:grid-cols-2 gap-3`. Each entry has name, mark, one auth-method line, and **Set up**. Use full-contrast text; do not dim unconfigured entries. If nothing matches a labeled provider search input, show “No providers match ‘{query}’.” and **Clear search**. Add a final **Custom endpoint** action using `Server` rather than a fabricated vendor mark. Its form preserves name, URL, compatibility protocol, optional key, models endpoint, help URL, and optional pricing from `CustomProviderFormComponent`; tier editing lives in the wizard's Models step only.

## State table (state → visual → copy)

Status is orthogonal to main-route selection, account quota, and CLI enablement. All labels/copy use `text-base-content` on `bg-base-100`; status icons use the same color where semantic contrast is insufficient. Optional colored spines are decorative. Thus the text and shape communicate every state without color.

| State | Evidence and visual treatment | Exact one-line copy | Action |
| --- | --- | --- | --- |
| active | Selected effective route, ready with positive probe evidence; secondary spine, `CheckCircle`, outlined **Active for main agent** badge | “Used for new main-agent requests.” | Change main provider |
| connected | Positive connection evidence, not selected for main; neutral card, `CheckCircle`, **Connected · Available** | “Connected and available to use.” | Use for main agent / Manage |
| needs-key | Required key absent on an attempted or existing setup; `Key`, **Needs API key**; optional warning spine | “Add an API key to connect {provider}.” | Add API key |
| unauthenticated | Required login absent/expired or a supplied key rejected; `LogOut`, **Sign-in required** or **Credential rejected** | “Your credential is missing or expired; authenticate again.” | Sign in / Replace key |
| unreachable | Actual connection probe failed due to network/endpoint/timeout; `AlertTriangle`, **Unreachable** | “Could not reach {provider}; check the connection and retry.” | Retry / Edit connection |
| not-installed | Required CLI executable confirmed absent; `Terminal`, **Not installed** | “Install {CLI} to use this connection.” | Installation instructions / Check again |
| not-configured | No saved setup or explicit route choice; neutral outline, `Plus`, **Not configured** | “Set up {provider} when you are ready.” | Set up |

No route: main-agent copy is “Choose a provider to start the main agent.” Do not reinterpret the shipped `apiKey` fallback as user configuration.

Additional operational states: **Checking…** with `Loader2` and “Checking {provider}…”; **Not checked** with “Connection has not been verified.”; **Check unavailable** with “Could not check this connection. Retry.” Unknown/skipped/not-yet-loaded evidence maps to these states, never connected. Prior success may remain as “Last connected {time}”; a new failure is shown alongside it. Loading does not erase the last saved configuration.

Classify failures by evidence: missing executable → not-installed; required credential absent → needs-key/unauthenticated; rejected credential → unauthenticated; network failure → unreachable. Rate limiting, permissions, unsupported model, and quota failures have specific probe messages below, rather than being mislabeled missing credentials. A selected blocked route displays **Main agent · Needs attention** and its exact failure. Zero healthy active badges is correct while blocked; two active badges on different routes is never correct.

## Scope affordance spec

Every editable value has a persistent source strip directly underneath it, visible when collapsed as well as editing: `flex flex-wrap items-center gap-2 rounded-md bg-base-100 px-2 py-1 text-xs`. Use a badge with `Globe`, `Cpu`, or `Folder` plus one of:

- **From Global · All Ptah apps**
- **From App · Desktop**
- **From Workspace · ptah-extension (Desktop)**, or **(All Ptah apps)** where the returned source is cross-app

When nothing is stored, show **App default · Not configured** or the explicit backend default, not “From Global”. API-key presence is not proof of scope. Credentials have a separate “Credential: stored on this machine” or verified host-supplied source description; do not pretend selecting Workspace relocates a secret into a project file.

Provider, auth method, model, each tier mapping, each background provider/model field, timeout, and CLI assignment must expose their actual provenance. If the group is mixed, show **Mixed sources** and individual field source strips; never substitute a guessed group scope. Example: provider from App, model from Workspace remains legible as two source lines.

For inherited values, show **Override for this workspace** as a visible adjacent secondary action. It opens an editor initialized from the effective value, with write target Workspace already selected. For an override, show **Clear override** beside the source badge and preview “Will use {value} from {source}.” These are real text buttons, never an overflow menu or tooltip.

Within an editor, show **Save to** as a labeled radio group with `radio radio-sm` and full clickable labels: **This workspace**, **Desktop app**, **Global · all apps**. Use only targets supported by the setting. Unsupported targets show an explanatory sentence rather than silently mapping App to Global. Default editing an existing value to its actual writable source; creating a connection defaults to Desktop app where supported and shows that choice. Inactive workspace target is disabled with “Open a workspace to save an override.” Do not rely on the resolver's current fallback-to-global behavior when a workspace is absent.

Clearing is not always returning to global. Verified resolver candidate order for app-scopable keys is app+workspace → app → cross-app workspace → global; for other keys it is workspace → global. `clearOverride` removes one winning override. `AuthConfigComponent` currently labels app as “Global default”, and its reset method can reveal another non-global layer. This page must use actual provenance from the host.

Expose **Use global value** beside Clear override when an intermediate App layer remains. Its inline review identifies every affected override and says “Use {global value}. Removes {listed overrides}; the Desktop app override also affects its other workspaces.” Only a confirmed operation that actually resolves from Global may report success. Offer **Copy global value to this workspace** when the user wants other workspaces unchanged; its result is honestly labeled From Workspace. No frontend loop calling the ambiguously named auth clear RPC to simulate a guaranteed return to global.

Changing Save to from a narrow to a broad scope previews affected overrides before Save. Host writes can clear more-specific values; never hide this effect. Save/clear states: **Saving…**, “Saved to {scope}.”, or “Could not save. Your previous value is still in use.” Re-read effective values before updating badges. If a partial save occurs, name saved and unsaved fields and refresh; do not claim all old values remain. Workspace changes during an edit retain the draft but block commit until the new path and scope are reviewed.

Contract gap: existing `auth:getScope` exposes only `authMethodScope`, `providerScope`, `activePath`, and optional `runtime`. Per-model/per-consumer provenance, supported targets, fallback preview, and precise clear behavior need shared DTO/RPC support. This is a design dependency, not a claim those capabilities already exist.

## Wizard step spec

Use **Connect provider** in a `NativeDrawerComponent`, `w-full max-w-2xl`. Reuse its dialog semantics, focus restoration, scrollable body, and pinned footer. Imitate the project's `WizardViewComponent` chrome: `bg-base-100`, progress region `p-3 border-b border-base-300`, daisyUI `steps steps-horizontal w-full text-xs`, body `p-3 space-y-4`. Do not reuse `SetupWizardStateService` or its project-scan/generation steps: that wizard onboards projects, not providers.

At widths below `sm`, replace the horizontal step strip with “Step {n} of 5 · {label}” and a native disclosure listing step buttons. At larger widths labels are **Provider / Credential / Verify / Models / Scope**. Use actual buttons for revisiting completed steps, not focusable clickable `li` elements. The current step gets `aria-current="step"`, bold text, and a full-contrast numbered circle; completed steps show `Check` and “Complete”; future steps are noninteractive text. Do not rely on the inherited step-primary colors for legibility. Footer uses wrapping Back, Cancel, and the current primary action; it never obscures focused controls.

| Step | Ready/current content | Working / successful state | Error and recovery |
| --- | --- | --- | --- |
| 1. Provider | Registry-driven names and auth-method summaries; search and native radio selection. Deep links preselect the provider but display this step. Custom endpoint exposes name and protocol. | Selected radio, “{provider} selected”; Continue enabled after a valid selection. Merely selecting does not connect or activate. | “Choose a provider to continue.” Invalid custom name/protocol errors appear beside their field. Changing provider clears incompatible later drafts after an inline discard choice. |
| 2. Credential | Credential form appropriate to the selected method, as detailed below. Back and Cancel available. | “Ready to verify” after required fields/session checks are present; Continue moves to Verify. A detected login is not yet a successful probe. | Required input: “Enter an API key to continue.” URL: “Enter an http:// or https:// URL.” Installation/login errors retain this step and offer the relevant action. |
| 3. Verify | Name the destination and route to test; button **Verify connection**. Explain that the small test request may incur provider usage. Do not launch a probe on every keystroke. | “Checking {provider}…” with spinner, elapsed seconds, Cancel check. Success: “Connection verified.” plus checked time and returned latency when available; Continue unlocks. | Persistent error panel with heading “Connection could not be verified”, specific reason, **Retry**, **Edit credential**, and Cancel. Models and Scope remain locked; no automatic activation or success toast. |
| 4. Models | Three uses of the existing shared picker: **Everyday · Sonnet**, **Complex work · Opus**, **Fast work · Haiku**; provider fixed to the wizard connection. Show each effective model/default and source. These tier names match existing `ProviderModelTier`, not mandatory Anthropic model IDs. | Catalog “Loading models…” then choices. Explicit **Use provider defaults** is allowed only when the host resolves those defaults. Continue requires complete valid tier mapping or valid defaults. | “Models could not be loaded. Retry, or enter a model ID supported by this provider.” Retry preserves selections; manual IDs use an extension inside the existing picker. Known incompatibility is explained per tier. An endpoint with no discoverable models requires valid explicit models before completion. |
| 5. Scope | Review provider, auth modality, masked credential presence, probe result, all three tier mappings, Save to scope, and affected consumers. Radio choice **Connect only** / **Use for main agent**. Default Connect only if a route exists; if no route exists, explicitly preselect Use for main agent. | Button **Connect provider** or **Connect and use for main agent**; while saving, “Saving connection…”. After read-back: “{provider} connected.” or “{provider} is now used for new main-agent requests.” Then Done. | “Could not save this connection. Review the error and retry.” Preserve non-secret draft and show whether any credential/setup data was saved. Never mark a route active until host read-back confirms it. |

Credential variations:

- **API key:** masked password input with labeled Show/Hide button and `aria-pressed`; allow paste and password-manager use. Existing key displays “Key stored” and Replace key, never the saved secret. An empty replacement preserves the existing key, matching the existing custom form. Key validation checks presence/format only; a live probe determines validity.
- **OAuth:** **Sign in with {provider}** opens the host-supported browser/device flow. Show “Waiting for sign-in…”, account identity after success, **Cancel sign-in**, and **Try again**. Device flow shows copyable code and **Copy code** with an announced “Code copied.” Cancel/expiry copy: “Sign-in was not completed. Try again.” Do not claim an auth file exists equals authenticated. Codex currently uses local auth-file login; present that actual mechanism rather than inventing a new browser OAuth implementation.
- **Local URL:** labeled Server URL, prefilled only from the provider's verified configured/default endpoint; optional key only where supported. “No API key required” is neutral helper text. Check endpoint reachability through Verify. Ollama Cloud remains a separate choice: its optional key enables metadata and must not force needs-key when subscription sign-in supports inference.
- **CLI login:** installed/not-installed state and host-provided installation/login action. Missing executable: “{CLI} was not found. Install it, then check again.” Installed but logged out: “Sign in to {CLI}, then verify this connection.” Provide **Open login** or copyable verified command according to actual adapter support, plus **Check again**. Do not hard-code unverified installation commands.
- **Custom endpoint:** reuse the verified custom form fields and `validateProviderBaseUrl` boundary semantics; offer OpenAI-compatible / Anthropic-compatible protocol radios with their existing explanations. State destination plainly: “Credentials and prompts are sent to {hostname}.” Optional metadata includes model-list endpoint and pricing; unknown pricing reads **Cost unavailable**. Move its tier fields and separate save/test buttons into the wizard flow; no parallel editor.

Probe failure copy by reason:

| Probe result | Visible message | Recovery |
| --- | --- | --- |
| Credential rejected / 401 | “The provider rejected this credential. Replace it or sign in again.” | Edit credential |
| Permission / 403 | “This account cannot use the requested service or model.” | Review account access; choose another model where applicable |
| Network / DNS / refused connection | “Could not reach {hostname}. Check the URL and that the service is running.” | Edit connection; Retry |
| Timeout | “No response within {probeLimitSeconds} seconds. Check the service and retry.” | Retry; keep configured enhancement timeout separate |
| Rate limited / 429 | “The provider is rate-limiting requests. Retry {when available}.” | Retry; show server retry time if provided |
| Quota exhausted | “This account has no available quota for the test.” | Review account; Retry |
| Unsupported / missing model | “{model} is not available on this connection.” | Edit model; re-run the model-specific check |
| Probe cancelled | “Connection check cancelled. Nothing was activated.” | Verify connection |
| Unclassified | “The connection check failed. Retry or review the connection details.” | Retry; expandable sanitized diagnostic details |

A failed probe stays on Verify with the entered non-secret values and masked in-memory credential draft intact. Error is not a toast. Move focus to the error heading on user-triggered failure and announce it once; Retry stays adjacent. Returning to Credentials and changing key, method, or URL invalidates prior verification and affected model results. Stale results from cancelled or superseded probes must be ignored.

Verification must exercise the proposed connection independently of the persisted active route. `AuthConfigComponent.saveAndTest()` currently saves first, and custom-form testing currently targets persisted entries; do not wire those operations directly to a supposedly non-mutating wizard. Host-side draft verification/isolated setup is required. If a model is needed before catalog retrieval, accept a provider-default or explicit probe model in Verify; Models can later refine tiers and trigger additional checks for changed models. Model-list retrieval alone is not proof that inference works.

Cancel closes immediately if there is no draft. With a draft, show an inline “Discard this setup?” choice with Keep editing / Discard; intercept drawer close, Escape, and backdrop consistently. Cancelling clears the in-memory secret; OAuth/CLI external login may persist, so say “Setup discarded. Your external sign-in is still available.” when applicable. OAuth completion does not secretly commit a main-agent route. No secrets in local storage, diagnostic copy, or error messages.

## Vendor-mark placement rules

Requested source: [theSVG](https://thesvg.org/), inspected as a catalog reference only. No assets were downloaded, license approval inferred, or catalog availability promised for any named provider. A separate research lane owns individual marks' licensing and permitted variants.

| Placement | Box / rendered size | Treatment |
| --- | --- | --- |
| Main-route summary and wizard header | `w-8 h-8` box, mark `w-6 h-6` (32 / 24 px) | Next to provider name; authentication method remains text. |
| Connection row / provider selection entry | `w-8 h-8`, mark `w-6 h-6` | Identical size for every vendor; `object-contain`, no cropping/stretching. |
| Consumer resolved summary | Optional `w-4 h-4` (16 px) | Only beside a full textual provider identity; omit if detail is illegible at this size. |
| Shared native select options | No logo | Native options remain text; do not replace the picker to accommodate artwork. |

Use an approved monochrome variant with `currentColor` / `text-base-content` by default for visual consistency. Use an official color variant only if supplied by the approved asset, allowed by its brand rules, and clear on the current theme; never recolor a multicolor asset into an invented monochrome logo. A vendor mark never turns green/red to communicate health.

For dark themes, choose an approved light monochrome variant. Never apply indiscriminate CSS inversion to a multicolor SVG. If a color mark needs a light plate and its usage terms permit one, use the existing `bg-base-100` only when it actually provides that contrast; otherwise use the fallback rather than introducing an unverified white plate rule. Preserve official clear space; the fixed box is a maximum, so shrink the artwork as needed.

Fallback for unavailable, disallowed, failed-to-load, or illegible marks: `Bot`, `Server` for endpoints/local servers, or `Terminal` for CLI routes, in the same box with `text-base-content`. Always retain provider name and method. Do not synthesize logos, substitute another vendor's mark, or hide providers pending licensing. Repeated adjacent marks are decorative (`alt=""`/`aria-hidden="true"`), never a second accessible name. Assets, when approved later, must be packaged locally; no runtime hotlinking to the catalog.

## Component inventory (reused vs new, with proposed file paths)

All imports of shared UI go through `@ptah-extension/ui` (`libs/frontend/ui/src/index.ts`), whose native barrel was checked. Every new Angular component is standalone, `ChangeDetectionStrategy.OnPush`, with signals/`computed`, `inject()`, and local draft state. Frontend code does not import backend libraries; shared DTOs cross the boundary. No production implementation is included in this deliverable.

| Classification | Verified component / proposed component | File / responsibility |
| --- | --- | --- |
| Reuse | `NativeCardComponent` | `libs/frontend/ui/src/lib/native/card/native-card.component.ts`; connection and main-route shells, compact/non-clickable. |
| Reuse | `NativeDrawerComponent` | `libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts`; connection detail and wizard, one open overlay. |
| Reuse | `NativeTabGroupComponent` | `libs/frontend/ui/src/lib/native/tab-group/native-tab-group.component.ts`; settings navigation only, not a substitute for scope radios. |
| Reuse and extend in place | `ProviderModelPickerComponent`, `PROVIDER_MODELS_LOADER` | `libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts` and `provider-models-loader.port.ts`; every provider/model selection. Verified inputs: provider, model, label, defaultTier, requiresToolUse; output selectionChange. |
| Verified, optional internal reuse | `NativeAutocompleteComponent`, `NativeOptionComponent`, `NativeDropdownComponent`, `NativePopoverComponent` | Corresponding `native/autocomplete`, `option`, `dropdown`, `popover` files. Autocomplete may power manual/catalog search inside the shared picker extension; no provider-specific second selector. No essential scope information hidden in a popover. |
| Verified, not needed | `JsonSchemaFormComponent`, `PeerSessionPickerComponent` | Exported native form and peer-session-picker directories. No verified `NativeButton`, `NativeBadge`, `NativeStepper`, or `NativeRadio` exists in this inventory; use semantic HTML and daisyUI classes. |
| Replace body in place | `SettingsComponent` | `libs/frontend/chat/src/lib/settings/settings.component.ts` and `.html`; mounts the consolidated Providers page and forwards old deep links. |
| Refactor/reuse in place | `CustomProviderFormComponent` | Existing `settings/auth/custom-provider-form.component.ts` and `.html`; staged custom metadata/credential fields, emits draft changes instead of a parallel setup commit. |
| Refactor/reuse in place | `PtahCliConfigComponent` | Existing `settings/ptah-ai/ptah-cli-config.component.ts`; CLI instances referencing connections and central model controls. |
| Reuse visual pattern only | `WizardViewComponent` | `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts`; progress/body/footer visual pattern, no project-wizard state reuse. |
| Retain outside editor | `ProviderAccountCardComponent` | Existing dashboard component; account usage only, no credentials or active-route selection. |
| New composition | `ProvidersSettingsComponent` | Proposed `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`; coordinates sections, read-back, drafts and deep-link focus. |
| New presentational composition | `ProviderConnectionCardComponent` | Proposed `.../settings/providers/provider-connection-card.component.ts`; NativeCard projections, status/actions, no account-state duplication. |
| New composition | `ProviderSetupWizardComponent` | Proposed `.../settings/providers/provider-setup-wizard.component.ts`; five-step state machine, NativeDrawer, credential content, shared picker. |
| New presentational composition | `SettingScopeRowComponent` | Proposed `.../settings/providers/setting-scope-row.component.ts`; source strips, override actions and target review used by every field. |
| New presentational composition | `ProviderConsumerAssignmentsComponent` | Proposed `.../settings/providers/provider-consumer-assignments.component.ts`; six background rows and timeout. |
| New domain state owner | `ProvidersSettingsStateService` | Proposed `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`; adapts host RPC snapshots and commits without copying persistence logic into components. |

The existing picker does **not** yet provide fixed-provider mode, externally supplied connection/CLI identities, refreshing a changed registry, catalog retry, arbitrary model entry, whole-control disabled state, or integrated per-field provenance. Specify these as extensions to the same component/loader contract and attach `SettingScopeRowComponent` in its host composition. Keep native selects unless adding searchable behavior to that shared component itself. Preserve unloaded/custom selected model IDs visibly (“{id} · not in current catalog”) instead of displaying the default when the ID is still pinned. Keep the existing stale-load generation guard.

Tier persistence continues through the existing `provider:getModelTiers` / `provider:setModelTier` family and its main-agent versus `cliAgent` routing dimension; that dimension is not configuration provenance. The new UI must never write environment variables. Preserve the backend tier writers' lockstep behavior and migrate legacy auth spellings through the established normalization seam. Remove old editor mounts and unused selector implementation after reference checks, not alongside a V2 implementation.

Implementation prerequisites to hand to architecture: truthful effective-route/readiness snapshot; per-field source/fallback/target data; non-activating credential verification; explicit route activation with read-back; shared-picker capabilities above; a persisted provider/model contract for Judging & enhancement; configurable raised enhancement timeout. New RPC types belong in `libs/shared`, and any new namespace also requires the runtime allowed-prefix registration named in context.md. Scope and probe capabilities must not be simulated by optimistic frontend labels.

## Accessibility notes

Target [WCAG 2.2 AA](https://www.w3.org/WAI/WCAG22/quickref/): normal text ≥4.5:1, large text ≥3:1 (1.4.3), essential control boundaries/state indicators ≥3:1 (1.4.11), keyboard operation (2.1.1), visible focus (2.4.7), focus not obscured (2.4.11), and target size ≥24×24 CSS px (2.5.8). This specification uses 36 px minimum control height (`min-h-9`) and at least 24 px width. It also sets a 2 px outline as a local design requirement; that thickness is not a claim that AA mandates the AAA Focus Appearance criterion.

### Measured token evidence

Computed locally with the installed `culori/require` `wcagContrast` against literal theme values in `apps/ptah-extension-webview/tailwind.config.js`, per-theme `--bcm` in `src/styles.css`, and installed daisyUI theme sources. Missing built-in foregrounds used the same 80% OKLCH toward black/white derivation as `base-content-muted.spec.ts`. Measurements concern source colors, not a rendered implementation audit.

| Pair / intended use | Anubis dark | Anubis light | Decision |
| --- | ---: | ---: | --- |
| base-content / base-100 | 14.86:1 | 15.91:1 | Body, state labels, neutral controls, focus outline: pass. |
| base-content / base-200 | 13.89:1 | 14.21:1 | Card body on the existing tinted NativeCard surface: safe in these themes; muted metadata gets its opaque inset. |
| base-content-muted / base-100 | 5.29:1 | 5.01:1 | Source/helper text and control borders: pass. |
| base-content-muted / base-200 | 4.94:1 | 4.47:1 | Light fails normal text; require base-100 backing. |
| base-content-muted / base-300 | 4.37:1 | 4.16:1 | Both fail; do not place muted text here. |
| primary-content / primary | 4.82:1 | 5.21:1 | Filled primary button: pass in these themes. |
| secondary-content / secondary | 8.81:1 | 4.14:1 | No secondary-filled small-text active badge. Use outlined badge with base-content. |
| success / base-100 | 5.62:1 | 2.41:1 | No universal green status text or essential green-only icon. |
| warning / base-100 | 6.61:1 | 2.46:1 | No universal orange warning text or essential orange-only icon. |
| error / base-100 | 3.84:1 | 3.57:1 | Error text must use base-content with explicit error words/icon. |
| primary / base-100 | 3.59:1 | 1.40:1 | Primary focus ring fails in light; use base-content outline. |
| base-300 / base-100 | 1.21:1 | 1.20:1 | Decorative separators only; interactive boundaries use base-content-muted. |

Across all 34 currently installed themes, the measured minimum base-content/base-100 and muted/base-100 is **4.73:1 (aqua)**. Filled primary text fails in **garden (4.15:1)** and **winter (3.66:1)**; use the documented neutral button treatment there, including hover/pressed states. An unmeasured future theme uses neutral controls pending verification. Do not claim all existing `btn-primary`, `badge-success`, or Native focus styles pass automatically.

Every state in the state table uses the passing base-content/base-100 pair. Colored spines and vendor marks are decorative and accompanied by text. Distinguishing active vs connected uses words, spine, and ordering, never color alone. Active-route emphasis and selected radio marks use full-contrast foreground shape when needed.

### Interactive-element requirements

| Element introduced or reused | Keyboard / focus / semantics | Contrast requirement |
| --- | --- | --- |
| Settings tabs | NativeTabGroup roving tab stops, arrows, Home/End; selected panel labeled by tab. Focus is visible independently of selection. | Base-content labels; active marker and focus outline ≥3:1; override low-contrast inherited primary marker where necessary. |
| Connect, Manage, Activate, Save, Cancel, Retry, Clear, Disconnect, Remove, Copy and inline confirmation buttons | Native buttons; Enter/Space; explicit accessible name including provider/consumer where labels repeat. Focus returns to invoking control, or new connection's Manage button if it was replaced. | Passing primary pair or neutral rule; 2 px base-content outline. No icon-only ambiguous destructive action. |
| Inputs, shared-picker selects, search and time limit | Visible labels; standard native keyboard behavior; unique IDs; hint/error linked by aria-describedby; aria-invalid on failure. Retain focus on edits and catalog refresh. | base-content on base-100, boundary base-content-muted, common focus outline; placeholders never replace labels. |
| Provider, auth method, scope and activation radios | Native radio group with fieldset/legend, arrow-key selection; whole label clickable; selected circle/check and text. | Use base-content selection glyph and boundary if theme's primary radio is below 3:1; focus outline around input/label. |
| CLI enabled control | Native checkbox styled `toggle toggle-sm`; persistent Enabled/Disabled text and accessible label “Enable {agent} for delegated work”. Space toggles. | Passing base-content thumb/outline and explicit text; do not rely on green fill. |
| Show/Hide key | Button with aria-pressed, label changes between Show API key / Hide API key; changing visibility leaves focus in place. | Neutral-control pair and common outline. |
| Catalog, optional fields and sanitized diagnostic disclosures | Native details/summary, Enter/Space; visible expanded/collapsed chevron; do not use tooltip-only explanations. | base-content summary and icon, common outline, ≥24 px target. |
| Wizard step navigation | Actual buttons only for reachable steps; aria-current on current step; move focus to new step heading after navigation, not to an arbitrary field. | Base-content text and step numbers on base-100; no low-opacity future-step text. |
| Drawer, close and external login flow | NativeDrawer trap/restoration; background inert while open; Escape participates in draft-discard flow; close button named. On browser-login return, keep focus and announce result without stealing it. | Close button neutral pair; common outline; ensure footer and drawer clipping do not cover it. |
| Setup/help/installation/deep links | Real link or button appropriate to navigation; visible destination wording; external destination announced. Never open from focus alone. | base-content underlined text, common focus outline. |

Keep read-only cards outside the tab order. Loading uses one polite live region per operation and `aria-busy`; error feedback is announced once, without reading credentials. A failed save preserves focus and offers recovery; a successful save announces the real scope and returns to its summary. Do not remove a disabled control's explanatory text. At 200% text zoom and 320 CSS px width, stack fields and actions, allow path/model wrapping, and avoid horizontal page scrolling. Verify drawer focus at 400% browser zoom as part of implementation QA.

Use the existing drawer's reduced-motion handling; no new animation is necessary. The project wizard's decorative fade and pulse need not be copied. Spinners have visible text and can become a static progress icon under reduced motion.

Acceptance checks for the implemented surface: one healthy active route maximum; no false active badge during initial load; two configured connections with nine neutral catalog options; separate Claude API-key and CLI identities; failed probe leaves prior route intact; all six background assignments editable only here; CLI instance removal preserves connection; mixed provenance visible; clear previews the real next source; global reset discloses app-wide impact; missing workspace cannot fall back to a global write; all vendor marks absent still yields a complete interface; keyboard-only wizard recovery and narrow/zoomed layouts remain usable. No source files, assets, or production tests were modified for this design-only deliverable.
