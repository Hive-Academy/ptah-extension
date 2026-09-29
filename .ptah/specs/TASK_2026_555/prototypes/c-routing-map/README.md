# Prototype Variant C — "Routing Map"

## Concept in 5 Lines
Variant C answers the user's primary mental question: **"Which model does what?"**.
Instead of isolated stacks of cards with repetitive "Edit" buttons, the Providers tab opens with a compact, live **Routing Map** connecting each execution tier (Main Agent, 6 Background Roles, and CLI Agents) directly to its backing provider and model.
Editing model assignments, reasoning effort, or scopes occurs instantly via **popovers** with undo toasts, eliminating navigation churn.
Connection management is consolidated into compact tiles (≤ 80 px) opening a tabbed **Connection Details Modal** (Credentials, Models & Tiers, Used By, Advanced), while adding new connections utilizes a fast **Command-Palette**.
On the Agent Orchestration tab, system CLIs and Ptah instances are organized in an interactive **matrix** where status, models, efforts, and safety permissions are directly editable in place without an "Edit" column.

---

## Information Architecture (IA)

### Tab 1: Providers (`index.html`)
- **Prototype Toolbar**: Dedicated top helper strip (`<aside class="proto-toolbar">`) housing prototype-only evaluation controls (1024×768 toggle, theme switcher, tab jump links, demo shortcuts), visually decoupled from product UI.
- **Product Header & Context**: Back button (`← Back to Chat`), title ("Settings"), version pill (`v2.4.0`), workspace context (`Workspace: ptah-extension · App: Desktop`), and settings tab bar.
- **Section 1 — Live Routing Map (Fold Top)**:
  - **Main Agent Node**: Current provider (`Claude Subscription` [App override]), model (`Default`), effort (`medium` [Workspace override]), status (`Active`). Click opens popover to reassign provider/model/effort or adjust scope override.
  - **Background Roles Node (Collapsed)**: Summary count ("6 roles active"), quick previews (Memory → Codex, Judge → Moonshot, Lanes → Claude). Click opens roles preview popover or deep-links to Orchestration matrix.
  - **CLI Agents Node**: Active summary (4 active CLIs, 1 quota alert), preferred order preview. Click jumps to Orchestration tab.
- **Section 2 — Connections Grid (≤ 80 px cards)**:
  - Header with connection filter search and primary blue action button: `+ Connect provider` (opens command-palette).
  - 5 Configured Provider Cards:
    1. *Claude (Subscription)*: CLI auth, Active for main agent, Used by 4.
    2. *Moonshot (Kimi)*: API key, Connected, Used by 1 (Judge).
    3. *OpenAI Codex*: OAuth session, Connected, Used by 2.
    4. *Ollama Cloud*: API key, Check failed with inline Retry button, Used by 1 (Glm).
    5. *sovereigneg*: Custom gateway, Connected, Used by 0 (Idle).
  - Quick catalog summary bar listing the 10 unconfigured providers with one-click connect.

### Tab 2: Agent Orchestration (`orchestration.html`)
- **Prototype Toolbar**: Same dedicated helper strip as Providers tab.
- **Product Header & Tabs**: Consistent product UI shell with active "Agent Orchestration" tab.
- **Policy Header Bar**:
  - Max concurrent agents slider (1–20, default 3) with live badge.
  - Preferred agent order chips (`Codex → Antigravity → Glm → Copilot`).
  - "Re-detect CLIs" action button with live detection feedback.
- **CLI Agents & Ptah Instances Matrix**:
  - Compact table rows: Codex, Copilot, Antigravity, OpenCode, Glm (Ptah CLI instance).
  - Distinct uninstalled section for Cursor and Pi with "Not installed" nowrap badges and install guides.
  - Columns: On (toggle), Agent/Version, Status, Provider, Model (popover trigger), Effort (popover trigger), Permissions & Safety notes (nowrap badge + `ℹ️` detail popover), Actions.
  - Action button: `+ Add Ptah CLI Instance`.
- **Background Model Roles Matrix (Collapsible & No "Edit" Column)**:
  - Collapsible `<details>` container with 6 autonomous background roles: Memory curator, Archaeologist lane, Synthesis lane, Judge lane, Replay lane, Judging & enhancement.
  - In-place popover triggers on Assigned Provider & Model cells (`matrix-cell-interactive`) to reassign models/tiers immediately without dedicated Edit buttons.
  - Columns: Role, Purpose, Assigned Provider & Model (popover), Tier/Fallback, Scope/Timeout.

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

| # | Missing Capability | Location in Variant C | How User Reaches & Uses It |
|---|---|---|---|
| 1 | **#7: Delete stored Anthropic API key** | Connection Modal (`claude`) → Credentials Tab | Click Claude connection card → "Credentials" → "Delete key" button with confirm dialog. |
| 2 | **#8: Delete stored 3rd-party key** | Connection Modal (`moonshot`, `ollama`) → Credentials Tab | Click provider card → "Credentials" → "Delete key" button with local machine cleanup. |
| 3 | **#12: GitHub Copilot sign out / disconnect** | Connection Modal → Credentials Tab | "Sign out / Disconnect" button disconnects active OAuth session with feedback. |
| 4 | **#25: Delete custom provider** | Connection Modal (`sovereigneg`) → Advanced Tab | Red "Delete for good" button with permanent removal confirmation modal. |
| 5 | **#27: Custom provider models endpoint** | Connection Modal → Advanced Tab | Editable input for `/v1/models` path used for capability detection and model discovery. |
| 6 | **#28: Custom provider help URL** | Connection Modal → Advanced Tab | Editable Documentation / Gateway Help URL input and external link. |
| 7 | **#30: Custom provider pricing (per 1M tokens)** | Connection Modal → Advanced Tab | Input and Output price fields per 1M tokens with note on session cost estimation. |
| 8 | **#34: Searchable model autocomplete** | Connection Modal → Models Tab & Popovers | Live search box filtering 24+ models with fuzzy matching and custom ID entry. |
| 9 | **#38: Tool-use compatibility indicators** | Connection Modal → Models Tab & Popover | Wrench icons, summary pill (`24 models · 18 support tool use`), and per-model badges. |
| 10 | **#43: Ptah CLI agent status** | Orchestration Tab → Matrix Row `Glm` | Status column displays color-coded status dot + latency (`Ready (112ms)`). |
| 11 | **#44: Ptah CLI agent key status** | Orchestration Tab → Matrix Row `Glm` | Discrete badge `Key set` / `No API key` / `Cloud signin` under instance name. |
| 12 | **#47: Inline GitHub login for Copilot CLI** | Add Ptah CLI Instance Modal | Selecting Copilot reveals inline "Login with GitHub" device code button and state badge. |
| 13 | **#49: Show/hide API key toggle** | Connection Modal & Add CLI Modal | Eye icon button toggles `type="password"` and `type="text"` on all credential fields. |
| 14 | **#53: CLI-agent tier mapping modal** | Orchestration Tab → Glm Row → "Tiers" | "Tiers" button opens modal configuring Sonnet, Opus, and Haiku models for `scope: 'cliAgent'`. |
| 15 | **#54: Tier-mapping badges on CLI cards** | Orchestration Tab → Glm Row | Badges display mapped tiers directly: `[Sonnet: glm-5.3] [Opus: glm-4.7] [Haiku: glm-4.5]`. |
| 16 | **#70: Per-CLI permission & safety notes** | Orchestration Tab → Permissions Column | Nowrap badge + `ℹ️` detail popover: `Full auto` (Codex/Antigravity/Cursor), `Auto-approve: Off` (Copilot), `--auto flag` (OpenCode), `No MCP / gate` (Pi). |
| 17 | **#71: Per-CLI grouping & hiding uninstalled** | Orchestration Tab → Matrix | Installed CLIs are active; uninstalled CLIs (Cursor, Pi) are grouped in a dedicated subsection with installation instructions. |

---

## Real Fold Check Results at 1024×768 (Verified)

### 1. Providers Tab (`index.html`)
- **Prototype Toolbar**: 26 px
- **Product Header + Tabs**: 64 px
- **Routing Overview Card**: 136 px
- **Section Heading ("Connections 5 configured...")**: 30 px
- **Connections Grid (2 rows of ≤ 80 px cards)**: 168 px
- **Catalog Quick Hint Bar**: 44 px
- **Total Vertical Height**: **~468 px**
- **Fold Budget Result**: Well within the 768 px viewport. **~300 px of visible headroom** remains before the fold. All 5 connected providers and the main routing node are 100% visible on load without scrolling.

### 2. Agent Orchestration Tab (`orchestration.html`)
- **Prototype Toolbar**: 26 px
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

## Defect Resolutions Applied

1. **Overlay Visibility on Page Load (BLOCKER Resolved)**:
   - Defined `.is-hidden { display: none !important; }` in `assets/app.css` (cascades over Tailwind CDN).
   - Confirmed all modals (`#modalConnDetails`, `#modalPalette`, `#modalAddPtahCli`, `#modalTierMapping`) and popovers (`#popoverMainAgent`, `#popoverScope`, `#popoverBackgroundRoles`, `#popoverMatrixModel`, `#popoverMatrixEffort`, `#popoverPermission`, `#popoverRoleReassign`) start hidden on page load, open on trigger, and close on Esc / close button / backdrop click.
2. **Orchestration Page Height**:
   - Compact policy bar and table rows. Bottom of the CLI matrix is measured at ~384 px. The entire CLI matrix is 100% above the 768 px fold.
3. **Status Badges & Permissions Wrapping**:
   - Added `.badge { white-space: nowrap !important; }` in `app.css`.
   - Replaced wrapping 3-line red permission text with compact nowrap badges (`No MCP / gate`, `Full auto`, `--auto flag`, `Auto-approve: Off`, `Sandboxed Port`) plus a clickable `ℹ️` icon opening a discrete popover with safety detail text.
4. **Roles Matrix "Edit" Text Button Removal**:
   - Removed the `Action` column and all text "Edit" buttons from the Background Roles matrix.
   - Converted the `Assigned Provider & Model` cells into interactive popover triggers (`matrix-cell-interactive`) that open `#popoverRoleReassign` to change assignments in place.
5. **Prototype Toolbar Visual Separation**:
   - Separated the prototype evaluation strip (`<aside class="proto-toolbar">`) from the product UI header in both `index.html` and `orchestration.html`.
   - The toolbar provides clear prototype evaluation controls (Variant C label, jump links, 1024×768 frame toggle, theme switcher, demo shortcuts) on a dark neutral strip above the product UI.

---

## Lane-Introduced Constraints
`none`
*(All rules, tokens, and components adhere strictly to the project design system, daisyUI 4 + Tailwind anubis tokens, and the constraints outlined in BRIEF.md).*
