# Prototype Final — Merged "Routing Map" & Calm Drawer Architecture

## Concept in 5 Lines
The merged Final Prototype answers the user's primary mental question: **"Which model does what?"**.
It unites the high-clarity **Routing Map** structure of Variant C with the **calm, focused visual discipline and sliding side drawer** of Variant A.
At a glance, the Providers tab displays the active execution topology (Main Agent, Background Roles, and CLI Agents) followed by compact connection cards and a fast Command-Palette catalog.
Deep provider inspection, credential deletion, model tier configuration, and custom endpoints glide in via a right-side **sliding drawer** featuring an explicit "Used by" route breakdown.
On the Agent Orchestration tab, system CLIs and Ptah instances form an interactive matrix where models, reasoning efforts, and safety permissions are adjusted directly in-place via popovers without navigation churn or repetitive "Edit" buttons.

---

## Information Architecture (IA)

### Tab 1: Providers (`index.html`)
- **Prototype Evaluation Toolbar**:
  - Distinct dark neutral strip (`<aside class="proto-toolbar">`) visually decoupled from product UI.
  - Controls: Prototype Final status badge, tab jump links, 1024×768 viewport frame toggle, light/dark theme switcher (`anubis`), and quick demo trigger dropdown.
- **Product Header & Context**:
  - Back action (`← Back to Chat`), title ("Settings"), workspace & app scope indicators (`Workspace: ptah-extension · App: Desktop`).
  - Navigation tab bar: active **Providers**, **Agent Orchestration**, and disabled placeholder tabs (**Advanced**, **Search & Voice**).
- **Section 1 — Live Routing Map (Top of Fold)**:
  - **Main Agent Node**: Displays active provider (`Claude Subscription`), model (`Default`), reasoning effort (`medium`), and operational health status. Uses a clean two-line layout preventing text truncation. Clicking opens the reassign popover. Discrete scope badges (`[App override]`, `[Workspace override]`) appear only when values deviate from defaults.
  - **Background Roles Node**: Live summary ("6 roles active") with routing previews (Memory → Codex, Judge → Moonshot, Lanes → Claude). Click opens preview popover or deep-links to Orchestration.
  - **CLI Agents Node**: Active summary (4 active CLIs, 1 quota alert) and preferred fallback sequence preview (`Codex → Antigravity → Glm → Copilot`).
- **Section 2 — Configured Connections Grid (≤ 80 px compact cards)**:
  - Header with connection search filter and primary blue action: `+ Connect provider` (opens command-palette catalog).
  - 5 Configured Provider Cards:
    1. *Claude (Subscription)*: CLI auth, Active for main agent, Used by 4 routes.
    2. *Moonshot (Kimi)*: API key, Connected, Used by 1 (Judge lane).
    3. *OpenAI Codex*: OAuth session, Connected, Used by 2 routes.
    4. *Ollama Cloud*: API key, Check failed with inline Retry button, Used by 1 (Glm instance).
    5. *sovereigneg*: Custom gateway, Connected, Used by 0 (Idle).
  - Quick Catalog summary bar listing 10 unconfigured providers with one-click connect triggers.
- **Sliding Connection Management Drawer (`#drawerConnDetails`)**:
  - Right-side sliding panel (460 px wide) preserving background page context.
  - 4 Focused Tabs:
    1. **Overview & Used By**: Real-time status dot, verification test button, auth mode summary, and complete breakdown of active routes with "Follows main agent →" link chips.
    2. **Credentials**: Stored credential status, show/hide API key visibility toggle, delete stored key button with confirmation dialog, and OAuth disconnect action.
    3. **Models & Tiers**: Searchable autocomplete model picker, tool-use capability icons/badges, and Sonnet/Opus/Haiku tier assignments.
    4. **Advanced**: Custom provider models endpoint path (`/v1/models`), documentation URL, pricing fields (input/output per 1M tokens), and permanent provider deletion action.

### Tab 2: Agent Orchestration (`orchestration.html`)
- **Prototype Evaluation Toolbar**: Consistent evaluation controls with 1024×768 toggle, theme switcher, and demo triggers.
- **Product Header & Tabs**: Unified product shell with active **Agent Orchestration** tab.
- **Policy Header Bar**:
  - Max concurrent agents slider (1–20 lanes, live badge readout).
  - Drag-reorderable preferred agent sequence chips (`Codex → Antigravity → Glm → Copilot`).
  - "Re-detect CLIs" action button with live detection feedback toast.
- **CLI Agents & Ptah Instances Matrix**:
  - Compact table rows: OpenAI Codex, GitHub Copilot, Antigravity, OpenCode, and Glm (Ptah CLI instance).
  - Uninstalled subsection: Cursor and Pi with "Not installed" nowrap badges and instant installation guide modals.
  - Interactive cells: Clicking model or effort cells opens instant popovers with carets.
  - Permissions column: Compact nowrap safety badges (`Full auto`, `Auto-approve: Off`, `--auto flag`, `Sandboxed Port`, `No MCP / gate`) paired with a clickable `ℹ️` detail popover.
  - Custom Ptah CLI instance (`Glm`): Status indicator with latency (`Ready (112ms)`), key status badge (`Key set`), tier mapping badges (`[Sonnet: glm-5.3] [Opus: glm-4.7] [Haiku: glm-4.5]`), and tier configuration modal trigger.
- **Background Model Roles Matrix (Collapsible `<details>`)**:
  - Houses 6 autonomous roles: Memory curator, Archaeologist lane, Synthesis lane, Judge lane, Replay lane, Judging & enhancement.
  - Replaced all redundant "Edit" column buttons with interactive table cells (`matrix-cell-interactive`) and Variant A's `Follows main agent →` link chips.
  - Clicking any assigned role cell opens the in-place role reassignment popover.

---

## Borrowed from Variant A

1. **Calm Visual Tone & Spacing**:
   - Significantly reduced monospace font density and saturated multi-color pill badges.
   - Secondary metadata is softened to muted tones (`text-base-content-muted`), keeping visual focus on primary system statuses.
   - Enforced strict action hierarchy: exactly one primary blue button per visual region.
2. **Right-Side Sliding Drawer for Connection Details**:
   - Replaced Variant C's centered blocking modal with a sleek right-side drawer (`.drawer-panel`).
   - Retains visible background context while viewing connection details, credentials, or custom model endpoints.
   - Organized into 4 distinct tabs: **Overview & Used By**, **Credentials**, **Models & Tiers**, and **Advanced**.
3. **"Follows main agent →" Link Chips**:
   - Background roles inheriting models from the main agent feature explicit `Follows main agent →` chips instead of ambiguous duplicate dropdowns.
   - Clicking a chip in either the drawer or the Background Roles matrix allows instant rebinding to a dedicated model or keeping inheritance.
4. **Clear "Used by" Route Breakdown**:
   - The drawer's Overview tab provides an itemized list of all agent roles, lanes, or CLI instances backed by that specific provider, eliminating guesswork before modifying credentials.

---

## Save Model

1. **Model, Effort, and Role Routing Changes**:
   - **Save on selection**: Modifying a model or reasoning effort in a popover applies immediately.
   - **Feedback**: A floating bottom toast appears (`Saved [setting] to [scope]`) with an immediate **Undo** action button.
   - **Rationale**: Keeps model switching frictionless (1 click to open popover, 1 click to pick model = 2 clicks total), matching user expectations and eliminating billable probe delays.
2. **Credential & Connection Changes**:
   - **Verified Save**: Entering an API key, replacing a credential, or updating custom endpoints requires a passing **Connection Check** before committing to disk.
   - **Feedback**: Inline latency feedback (`Connected (84ms)`) and clear diagnostic details on failure.
3. **Scope Provenance Badges**:
   - Inherited values show **nothing** (no clutter).
   - Overridden values display a discrete badge (e.g. `[Workspace override]`, `[App override]`).
   - Clicking the badge opens the Scope Popover displaying the 3-tier provenance cascade with "Clear override" and "Use global default" options.

---

## Restored Capabilities (17 of 17)

All 17 capabilities removed or missing in prior revisions are fully restored (with the post-save Reload button intentionally omitted per user decision):

| # | Missing Capability | Location in Final Prototype | How User Reaches & Uses It |
|---|---|---|---|
| 1 | **#7: Delete stored Anthropic API key** | Connection Drawer (`claude`) → Credentials Tab | Click Claude connection card → "Credentials" tab → "Delete key" button with confirm dialog. |
| 2 | **#8: Delete stored 3rd-party key** | Connection Drawer (`moonshot`, `ollama`) → Credentials Tab | Click provider card → "Credentials" tab → "Delete key" button with local machine cleanup. |
| 3 | **#12: GitHub Copilot sign out / disconnect** | Connection Drawer → Credentials Tab | "Sign out / Disconnect" button disconnects active OAuth session with feedback. |
| 4 | **#25: Delete custom provider** | Connection Drawer (`sovereigneg`) → Advanced Tab | Red "Delete for good" button with permanent removal confirmation modal. |
| 5 | **#27: Custom provider models endpoint** | Connection Drawer → Advanced Tab | Editable input for `/v1/models` path used for capability detection and model discovery. |
| 6 | **#28: Custom provider help URL** | Connection Drawer → Advanced Tab | Editable Documentation / Gateway Help URL input and external link. |
| 7 | **#30: Custom provider pricing (per 1M tokens)** | Connection Drawer → Advanced Tab | Input and Output price fields per 1M tokens with note on session cost estimation. |
| 8 | **#34: Searchable model autocomplete** | Connection Drawer → Models Tab & Popovers | Live search box filtering 24+ models with fuzzy matching and custom ID entry. |
| 9 | **#38: Tool-use compatibility indicators** | Connection Drawer → Models Tab & Popover | Wrench icons, summary pill (`24 models · 18 support tool use`), and per-model badges. |
| 10 | **#43: Ptah CLI agent status** | Orchestration Tab → Matrix Row `Glm` | Status column displays color-coded status dot + latency (`Ready (112ms)`). |
| 11 | **#44: Ptah CLI agent key status** | Orchestration Tab → Matrix Row `Glm` | Discrete badge `Key set` / `No API key` / `Cloud signin` under instance name. |
| 12 | **#47: Inline GitHub login for Copilot CLI** | Add Ptah CLI Instance Modal | Selecting Copilot reveals inline "Login with GitHub" device code button and state badge. |
| 13 | **#49: Show/hide API key toggle** | Connection Drawer & Add CLI Modal | Eye icon button toggles `type="password"` and `type="text"` on all credential fields. |
| 14 | **#53: CLI-agent tier mapping modal** | Orchestration Tab → Glm Row → "Tiers" | "Tiers" button opens modal configuring Sonnet, Opus, and Haiku models for `scope: 'cliAgent'`. |
| 15 | **#54: Tier-mapping badges on CLI cards** | Orchestration Tab → Glm Row | Badges display mapped tiers directly: `[Sonnet: glm-5.3] [Opus: glm-4.7] [Haiku: glm-4.5]`. |
| 16 | **#70: Per-CLI permission & safety notes** | Orchestration Tab → Permissions Column | Nowrap badge + `ℹ️` detail popover: `Full auto`, `Auto-approve: Off`, `--auto flag`, `No MCP / gate`. |
| 17 | **#71: Per-CLI grouping & hiding uninstalled** | Orchestration Tab → Matrix | Installed CLIs are active; uninstalled CLIs (Cursor, Pi) are grouped in a dedicated subsection with installation instructions. |

---

## Real Fold Check Results at 1024×768 (Verified)

### 1. Providers Tab (`index.html`)
- **Prototype Evaluation Toolbar**: 26 px
- **Product Header + Tabs**: 64 px
- **Routing Overview Card**: 136 px
- **Section Heading ("Configured Connections")**: 30 px
- **Connections Grid (2 rows of ≤ 80 px cards)**: 168 px
- **Catalog Quick Hint Bar**: 44 px
- **Total Vertical Height**: **~468 px**
- **Fold Budget Result**: Well within the 768 px viewport. **~300 px of visible headroom** remains above the fold. All 5 connected providers and the main routing node are 100% visible on load without scrolling.

### 2. Agent Orchestration Tab (`orchestration.html`)
- **Prototype Evaluation Toolbar**: 26 px
- **Product Header + Tabs**: 64 px
- **Policy Header Bar**: 36 px
- **CLI Agents & Instances Matrix Card**: 258 px (including 5 active rows, uninstalled header, and 2 uninstalled rows)
- **Cumulative Height to bottom of CLI Matrix**: **~384 px**
- **Fold Budget Result**: The CLI Agents Matrix sits **completely above the fold** at 1024×768, with **~384 px of headroom** remaining!
- **Background Roles Matrix**:
  - Encapsulated in a collapsible `<details>` card.
  - When expanded, adds ~180 px (total page height: **~564 px**), which is **still well within the 768 px fold**.
  - When collapsed, total page height is only **~420 px**.

---

## Defect Resolutions Applied from Variant C

1. **Text Truncation on Main Agent Node**:
   - Replaced fixed truncated single-line layout with a structured two-line layout displaying full provider and model names without truncation (e.g. `Claude (Subscription)` and `Default (chosen by Claude)`).
2. **Removed Internal Development Notes**:
   - Stripped all internal development annotations (`Restores #70`, `Restores #44`, `#71`, `v2.4.0`) from product UI text.
3. **Carets on Popover Triggers**:
   - Added subtle chevron carets (`caret` / SVG arrow) to all interactive matrix cells, popover triggers, and dropdown buttons.
4. **Background Roles In-Place Triggers**:
   - Completely eliminated the redundant "Edit" column and text buttons. Each assigned model cell or `Follows main agent →` chip triggers the popover directly.
5. **Disabled Non-Target Tabs**:
   - Kept **Advanced** and **Search & Voice** tabs present in the navigation bar as disabled labels with tooltip indicators.
6. **Overlay Visibility on Page Load**:
   - Added `.is-hidden { display: none !important; }` in `assets/app.css` to guarantee zero flash or unwanted display of drawer, modals, or popovers on initial page load.

---

## Lane-Introduced Constraints
`none`
*(All components, tokens, and interactions adhere strictly to the project design system, daisyUI 4 + Tailwind anubis tokens, and the constraints specified in the brief).*
