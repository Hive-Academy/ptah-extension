# Research Report - TASK_2026_555

## Question

- Decision this supports: Redesign of Ptah's Settings > Providers and Agent Orchestration surfaces to replace the current button-heavy, multi-row scope card layout with a compact, high-density, industry-standard interface that retains all 16 core capabilities without confusing scope clutter.
- Question: How do best-in-class developer AI tools (Cursor, VS Code Copilot, Zed, Windsurf, Continue.dev, Roo Code/Cline, JetBrains AI Assistant, Raycast AI) design provider connections, model role routing, sub-agent overrides, and multi-scope provenance, and which concrete patterns should Ptah adopt?
- Bounds: Focuses on UI/UX layout patterns, settings taxonomy, and scope indicators across desktop/extension interfaces. Does not define internal RPC schemas or token encryption implementations.

---

## Answer

Best-in-class developer AI tools avoid button-heavy staged edit cards and full-width scope strips. Instead, they use a **two-tier architecture**: (1) an **Auth/Connections Tier** that displays connected providers as a compact status list (status dot + credentials badge + inline test button + kebab menu), and (2) a **Model Role Assignment Matrix** that maps consumer roles (`main-agent`, `curator`, `synthesis`, `judge`, and CLI sub-agents) to `[Provider | Model | Effort]` via inline dropdowns. Scope provenance must be decoupled from the data entry flow: adopting VS Code's native pattern of a subtle scope switch (`Global` | `App` | `Workspace`), an indicator border on modified fields, and an unobtrusive badge (`Workspace override`) with a hover action (`Reset to global`) reduces vertical height by ~75% and brings both Providers and Agent Orchestration into a single-screen view.

---

## Evidence

| Claim | Source | Date | Verified how |
| :--- | :--- | :--- | :--- |
| VS Code Copilot uses a compact model picker in chat plus a dedicated "Manage Models" modal with checkboxes to enable/disable models per provider. | [VS Code Language Models Docs](https://code.visualstudio.com/docs/copilot/customization/language-models) | 2026-01-15 | Read documentation |
| VS Code supports Bring Your Own Key (BYOK) for third-party providers with model capability tags and key status indicators. | [VS Code BYOK Announcement](https://code.visualstudio.com/blogs/2025/10/22/bring-your-own-key) | 2025-10-22 | Read official blog |
| Cursor organizes models into a toggleable list with inline "+ Add Model" inputs and separate API key inputs with an inline "Verify" button. | [Cursor Models Documentation](https://cursor.com/help/models-and-usage/available-models) | 2025-11-10 | Read documentation |
| Zed separates AI settings into sub-pages (`LLM Providers`, `External Agents`, `MCP Servers`) and binds feature models (`default_model`, `inline_assistant`, `commit_message`, `compaction`) via dedicated keys. | [Zed Agent Settings Docs](https://zed.dev/docs/ai/agent-settings) | 2026-02-18 | Read live documentation |
| Zed provider rows use a compact list layout with status dots, inline credentials inputs, and quick action icon buttons (`Configure`, `Delete`, `Toggle`). | [Zed LLM Providers Docs](https://zed.dev/docs/ai/llm-providers) | 2026-02-18 | Read live documentation |
| Continue.dev assigns models to explicit functional roles (`chat`, `edit`, `apply`, `autocomplete`, `embed`, `rerank`) configured as role tags on models. | [Continue Docs - Customize Models](https://docs.continue.dev/customize/models) | 2025-12-04 | Read documentation |
| Roo Code (Cline fork) uses "API Configuration Profiles" (named bundles of provider, key, model, thinking budget/effort) switchable per mode (`Code`, `Architect`, `Ask`). | [Roo Code API Profiles](https://docs.roocode.com/features/api-configuration-profiles) | 2026-01-23 | Read live documentation |
| Roo Code settings use vertical tabs with inline profile selectors, eliminating nested edit confirmation cards. | [Roo Code v3.16 Release Notes](https://docs.roocode.com/update-notes/v3.16) | 2025-05-12 | Read changelog |
| Raycast AI configures models per surface (`Quick AI`, `AI Chat`, `AI Commands`) and displays a small key icon when using BYOK/BYOS credentials. | [Raycast AI Manual](https://manual.raycast.com/ai/bring-your-own-key) | 2025-09-30 | Read manual |
| VS Code Settings editor indicates overrides with a blue left border, a small text link `Modified in: Workspace`, and a gear icon on hover with `Reset Setting`. | [VS Code Settings Guide](https://code.visualstudio.com/docs/configure/settings) | 2025-11-01 | Read documentation |
| Linear and GitHub settings denote inherited org/workspace values with subtle inline badges (`Inherited from Organization`) and inline toggle overrides rather than stacked rows. | [Linear SCIM Docs](https://linear.app/docs/scim) / [GitHub Repo Settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features) | 2025-08-15 | Read documentation |
| Ptah currently renders 4 full-width scope rows per setting card and requires a 3-step button dance ("Edit model" -> "Save to [select]" -> "Save main agent model") to commit changes. | `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:71-156` | 2026-09-24 | Inspected codebase |
| Ptah's `SettingScopeRowComponent` renders duplicate clear/override buttons across 5 stacked rows per card, causing high visual noise. | `libs/frontend/chat/src/lib/settings/providers/setting-scope-row.component.ts:64-147` | 2026-09-23 | Inspected codebase |

---

## Tool-by-Tool Benchmark Analysis

### 1. Cursor (Models Settings)
- **Connected Providers Listing**: Flat list in Settings > Models. Dedicated sections for OpenAI, Anthropic, Google, and Azure, alongside a generic "Override OpenAI Base URL" input. Each has a toggle switch, a masked password field for the API key, and an inline **Verify** button.
- **Default Model Selection**: Chat interface dropdown allows picking the active model directly. The settings view controls which models are enabled in the dropdown via on/off switches.
- **Per-Feature / Per-Agent Overrides**: Cursor relies on mode toggles in chat (Agent Mode vs Normal Chat). Background reasoning and indexing models are pre-routed by the host rather than user-configurable in the UI.
- **Scope / Override Indication**: Cursor stores model configs globally in User settings (`User/settings.json`). Project rules (`.cursorrules`) provide context but do not override provider API keys or models.
- **Density**: **High**. 8-12 models plus 4 provider keys fit on a single screen without vertical scrolling.
- **Key Takeaway for Ptah**: Inline verification (Verify button with instant green/red status indicator) eliminates multi-step wizards for API key validation.

### 2. VS Code Copilot (Model Picker, Manage Models, BYOK)
- **Connected Providers Listing**: Native GitHub Copilot subscription is primary. Third-party providers (Hugging Face, Azure AI, custom endpoints) appear under the "Manage Language Models" registry.
- **Default Model Selection**: Dropdown in the Chat panel footer/header (`Claude 3.7 Sonnet`, `GPT-4o`, `o3-mini`). Selection persists per session or defaults globally.
- **Per-Feature / Per-Agent Overrides**: Features (code completions vs chat vs edits) have distinct settings (`github.copilot.chat.editor.model`, `github.copilot.advanced`).
- **Scope / Override Indication**: Uses VS Code's native settings framework: `User` vs `Workspace` tabs. If set in workspace, shows a blue left-border strip and `Modified in: Workspace`. Hovering reveals the gear menu to `Reset Setting`.
- **Density**: **Very High**. Quick-pick overlays and standard native VS Code forms consume minimal chrome.
- **Key Takeaway for Ptah**: Never invent custom scope cards when the host IDE already has an established visual language (`Modified in: Workspace` badge with hover reset).

### 3. Zed (Agent & LLM Providers Settings)
- **Connected Providers Listing**: Clean sub-page under `Settings > AI > LLM Providers`. Providers are shown as clean rows: Zed-Hosted, Anthropic, OpenAI, Ollama, OpenRouter, Google AI. Each row displays connection status (`Connected`, `Signed In`, `Missing API Key`) and action buttons (`Sign In`, `Configure`, `Delete`).
- **Default Model Selection**: Explicit top-level setting `agent.default_model` with `{ "provider": "anthropic", "model": "claude-sonnet-4-5" }`.
- **Per-Feature / Per-Agent Overrides**: Dedicated granular keys in settings:
  - `agent.inline_assistant_model`
  - `agent.commit_message_model`
  - `agent.thread_summary_model`
  - `agent.compaction_model`
  - `agent.subagent_model`
- **Scope / Override Indication**: Zed uses hierarchical JSON cascading (`~/.config/zed/settings.json` overridden by `.zed/settings.json` per project). The GUI shows the effective value.
- **Density**: **Very High**. Tabbed navigation separates Providers from Agent configuration and MCP servers.
- **Key Takeaway for Ptah**: Splitting "Providers (Auth & Connections)" from "Agent Orchestration (Role & Model Assignments)" is the industry standard for uncluttering complex multi-agent apps.

### 4. Windsurf (Codeium Cascade)
- **Connected Providers Listing**: Codeium account is primary. Additional custom endpoints configured under Cascade settings.
- **Default Model Selection**: Integrated selector at the bottom of the Cascade chat input box (Claude 3.5 Sonnet, Claude 3.7 Sonnet, SWE-1).
- **Per-Feature Overrides**: Autocomplete uses Codeium's proprietary local/cloud engine; Cascade multi-step agent uses the selected high-tier model.
- **Scope / Override Indication**: Global user settings with `.windsurfrules` for workspace rules.
- **Density**: **High**. Settings live in structured tabs with no redundant save/cancel buttons.

### 5. Continue.dev
- **Connected Providers Listing**: `config.yaml` / Settings UI lists providers in a single unified list.
- **Default Model Selection**: Model dropdown in the extension sidebar header.
- **Per-Feature Overrides via Model Roles**: Continue uses explicit **Roles**:
  - `chat`: General conversation
  - `edit`: Inline code edits (Cmd+I)
  - `autocomplete`: Tab completion
  - `apply`: Fast diff application
  - `embed`: Vector database embeddings
  - `rerank`: Search reranking
  Models specify a list of supported roles: `roles: [chat, edit]`.
- **Scope / Override Indication**: Global config in `~/.continue/config.yaml` overridable by workspace `.continue/config.yaml`.
- **Density**: **High**. A single table or list displays models with badges for their assigned roles.
- **Key Takeaway for Ptah**: Role badges or a Role-to-Model mapping matrix directly solve Ptah's complex assignments (`main-agent`, `curator`, `synthesis`, `judge`).

### 6. Roo Code / Cline (API Provider Profiles)
- **Connected Providers Listing**: Dropdown/tabbed API Configuration Profiles. Each profile encapsulates: Provider, API Key, Model ID, Reasoning/Thinking Budget slider, Temperature, Base URL.
- **Default Model Selection**: The active profile in the top dropdown governs current execution.
- **Per-Feature / Per-Agent Overrides**: Modes (`Code`, `Architect`, `Ask`, `Debug`, custom modes) can each be assigned their own API Profile or set to `Inherit Default`. Sub-tasks can invoke named profiles.
- **Scope / Override Indication**: Global profiles stored in extension globalState, with workspace-specific sticky selections.
- **Density**: **High**. Vertical tabs in settings, compact input groups, inline sliders for reasoning effort/tokens.
- **Key Takeaway for Ptah**: Profile or role-based inheritance (`Inherit Default` vs explicit override) keeps background and sub-agent settings clean and intuitive.

### 7. JetBrains AI Assistant
- **Connected Providers Listing**: `Settings > Tools > AI Assistant`. Displays account status, cloud service status, and local model engines.
- **Default Model Selection**: Dropdown for "Chat Model".
- **Per-Feature Overrides**: Distinct dropdowns for "Code Completion Model" and "Agent Model".
- **Scope / Override Indication**: Standard JetBrains layer: IDE-level (Default) vs Project-level (`.idea/`). Overridden fields show a small blue dot or reset arrow.
- **Density**: **High**. Standard OS/desktop dialog layout.

### 8. Raycast AI
- **Connected Providers Listing**: `Settings > AI > Models & Providers`. Provider cards with status pills (`Active`, `Connected`, `BYOK`).
- **Default Model Selection**: Surface default section:
  - `Quick AI`: [Model Dropdown]
  - `AI Chat`: [Model Dropdown]
  - `AI Commands`: [Model Dropdown]
- **Per-Feature Overrides**: Models have toggle switches to include/exclude them from quick-switch menus. BYOK models display a subtle key icon.
- **Scope / Override Indication**: Personal preferences vs Team/Enterprise organization policy.
- **Density**: **Exceptional**. Completely fits on a single screen without clutter.
- **Key Takeaway for Ptah**: "Surface/Role Defaults" table with inline dropdowns is the cleanest way to configure default models.

### 9. Multi-Scope Override Patterns (VS Code, Linear, GitHub, 1Password)
- **VS Code Settings Editor**:
  - Top Scope Bar: `[User] [Workspace] [Folder]`.
  - Field Indicator: When viewing Workspace settings, modified settings feature a 3px blue vertical line on the left.
  - Text Affordance: `Modified in: Workspace` (or `Also modified in: User`).
  - Action on Hover: Hovering reveals a gear icon on the right edge. Clicking reveals: `Reset Setting` (removes the override and reverts to the fallback scope).
  - Immediate Persistence: Changing a value directly updates the file in the selected scope. No "Save to..." secondary dialog.
- **Linear**:
  - Clear sectioning: Account vs Workspace vs Team.
  - Inherited values display in muted text with an `Inherited from Workspace` badge. Clicking `Override` unlocks the input inline.
- **GitHub**:
  - Settings show `Default inherited from [Org Name]`. A single checkbox `Customize for this repository` enables local editing.

---

## Analysis of Ptah's Current Implementation Anti-Patterns

Ptah's current implementation in `libs/frontend/chat/src/lib/settings/providers/` exhibits 6 major anti-patterns:

```
[Current Ptah Anti-Pattern]                                    [Best-In-Class Pattern]
----------------------------------------------------------------------------------------------------------
1. Multi-Step Button Dance for Inputs                         Direct Inline Inputs
   (Click "Edit model" -> Reveals Model Picker card           (Dropdowns and selects are directly editable.
    -> Select target scope -> Click "Save main agent model")   Changes persist immediately with rollback toast)
   [Avoided by: VS Code, Zed, Cursor, Raycast]

2. Full-Width Scope Rows Stacked Vertically                   Compact Scope Indicator & Context Menu
   (SettingScopeRowComponent renders 4 stacked rows            (A small badge `Workspace override` with a
    with Clear, Use Global, Copy Global buttons)               hover reset icon or VS Code-style left-accent line)
   [Avoided by: VS Code Settings Editor, Linear]

3. Redundant Staged Action Cards                              Modal Dialogs or Inline Drawers
   (Changing provider displays activationId review card;       (Selecting a provider directly updates the route;
    clearing override displays clearKey review card)           destructive actions use a standard confirm popover)
   [Avoided by: Zed, Roo Code, JetBrains]

4. Conflating Auth with Orchestration                         Separate "Providers" from "Agent Orchestration"
   (Connections, Main Agent, Effort, Background Models,        (Tab 1: Providers & Keys; Tab 2: Agent & Role
    and CLI agents all dumped in one long page)                Assignments)
   [Avoided by: Zed, Raycast, Continue]

5. Giant Provider Catalog Disclosure                          Filtered Search Table or Quick Modal
   (Collapsible <details> containing massive cards             (Compact grid or "Add Provider" modal with a quick
    with redundant setup/sign-in buttons)                      search box and one-click Connect button)
   [Avoided by: Cursor, VS Code Manage Models, Roo Code]

6. Scattered Save Feedback Banners                            Unified Sticky Bottom Bar or Toast
   (Commit status banners rendered inline in the DOM           (Unobtrusive toast notification or status badge
    causing layout shifts)                                     `Saved to Workspace` in the header)
   [Avoided by: Linear, Raycast, VS Code]
```

---

## 10 Concrete Patterns Ranked by Fit for Ptah

### Pattern 1: Separate Tabs for "Providers" and "Agent Orchestration" (Rank: 1 - Essential)
- **Description**: Split the current monolithic Providers tab into two focused tabs:
  - **Providers (Connections & Auth)**: Connect and verify LLM credentials, OAuth subscriptions, and custom endpoints.
  - **Agent Orchestration (Models & Roles)**: Map agent roles (`main-agent`, `curator`, `synthesis`, `judge`, CLI subagents) to provider models and reasoning effort.
- **Why it fits Ptah**: Eliminates cognitive overload. Providers change rarely; model/effort experimentation happens frequently.
- **Reference**: Zed (`LLM Providers` vs `Agent Settings`), Raycast (`Models & Providers` vs `AI Commands`).

### Pattern 2: Global Scope Switcher in Header (Rank: 2 - Essential)
- **Description**: Place a segmented control in the settings header: `[Global] [App] [Workspace (my-project)]`.
- **Behavior**: All controls on the page display and write to the currently selected scope. When viewing `Workspace`, fields that inherit from `Global` show a muted `Global default` label until modified.
- **Why it fits Ptah**: Replaces the nested "Save to [scope]" dropdowns on every single field.
- **Reference**: VS Code Settings Editor (`User` | `Workspace`), Linear (`Personal` | `Workspace` | `Team`).

### Pattern 3: Compact Status List for Connected Providers (Rank: 3 - Essential)
- **Description**: Display connected providers as high-density table rows:
  `[Provider Logo/Name] | [Auth Mode Badge] | [Status Dot (Green/Yellow/Red)] | [Credentials Source] | [Actions: Test, Edit, Kebab Menu]`.
- **Height**: 40px per provider row instead of 160px cards.
- **Reference**: Zed LLM Providers list, Raycast connected providers.

### Pattern 4: Model Roles Assignment Matrix (Rank: 4 - Essential)
- **Description**: Replace the scattered cards (`Main agent`, `ptah-provider-consumer-assignments`, `ptah-cli-config`) with a unified table:
  | Consumer / Role | Provider | Model | Reasoning Effort | Scope Source | Actions |
  | :--- | :--- | :--- | :--- | :--- | :--- |
  | Main Agent | Anthropic | Claude 3.7 Sonnet | High | Workspace | ↺ Reset |
  | Memory Curator | Anthropic | Claude 3.5 Haiku | Low | Global (inherited) | ✎ Override |
  | Skill Synthesis | OpenAI | GPT-4o Mini | Provider default | Global (inherited) | ✎ Override |
  | Judge / Tribunal | Google | Gemini 2.5 Pro | High | App (inherited) | ✎ Override |
- **Why it fits Ptah**: Displays all 4 background consumers plus main agent in 180px of vertical space.
- **Reference**: Continue.dev model roles, Roo Code mode profiles, Raycast surface defaults.

### Pattern 5: Sub-Agent / CLI Configuration Grid (Rank: 5 - High)
- **Description**: Render CLI subagents (`Codex`, `Copilot`, `Cursor`, `Antigravity`, `OpenCode`, `Pi`) in a compact matrix with inline dropdowns for Model and Effort, plus a checkbox for Auto-Approve.
- **Height**: Replaces verbose card blocks with a concise 6-row table.
- **Reference**: Roo Code mode configurations.

### Pattern 6: VS Code-Style Scope Override Badge & Hover Reset (Rank: 6 - High)
- **Description**: On any setting that has a workspace override, show a small badge: `Workspace override`. Hovering reveals a reset icon `↺` (tooltip: `Reset to Global default (Claude 3.5 Sonnet)`). Clicking immediately reverts the override.
- **Why it fits Ptah**: Completely eliminates `SettingScopeRowComponent`'s 5 stacked rows of buttons.
- **Reference**: VS Code Settings Editor left border indicator + gear context menu.

### Pattern 7: Direct Inline Selects (Zero Staged Edits) (Rank: 7 - High)
- **Description**: Dropdowns for Provider, Model, and Effort are directly clickable in the table. Changing a value immediately updates the store for the active scope, accompanied by an instant undo toast.
- **Why it fits Ptah**: Removes "Edit model", "Save main agent model", "Cancel model edit" buttons and their associated draft state machines.
- **Reference**: Cursor, Zed, Raycast.

### Pattern 8: Inline Connection Probe & Verification Status (Rank: 8 - High)
- **Description**: Each provider row has a subtle `Check` icon button. Clicking tests connectivity in the background and turns the status dot green with a timestamp (`Verified 1m ago`) or red with a tooltip error.
- **Why it fits Ptah**: Retains Ptah's connection probe evidence without full-width banner alerts.
- **Reference**: Cursor "Verify" button, Raycast provider status.

### Pattern 9: "Add Provider" Flyout / Wizard Modal (Rank: 9 - Medium)
- **Description**: Clicking "+ Connect Provider" opens a focused modal with provider search, template selector, and API key input. Once completed, it closes and adds the row to the connected providers list.
- **Why it fits Ptah**: Moves the catalog `<details>` disclosure and wizard off the main settings page.
- **Reference**: Zed "Add Provider" sheet, VS Code "Manage Models" dialog.

### Pattern 10: Centralized Unsaved Changes Bar / Toast Notification (Rank: 10 - Medium)
- **Description**: If asynchronous batching is needed, display a bottom-floating pill: `Unsaved changes in Workspace: [Save] [Discard]`, or fire an automatic transient toast: `Model updated to Claude 3.7 Sonnet (Workspace) [Undo]`.
- **Why it fits Ptah**: Replaces the inline `providers-commit-feedback` error/success div that shifts layout.
- **Reference**: Linear settings, VS Code.

---

## Options Comparison

| Option | Fit here | Cost to adopt | Known failure mode |
| :--- | :--- | :--- | :--- |
| **Option A: Tabbed Split (Providers + Agent Orchestration) with Roles Table & Header Scope Switcher (Recommended)** | Perfect fit. Addresses both user complaints (flat button overload, scope confusion) and easily fits on one screen. | Medium. Refactors container template and extracts assignments into table components; reuses existing state service methods. | Scope switcher must clearly disable workspace scope when no workspace folder is open. |
| **Option B: Single Page with Collapsible Accordions** | Moderate fit. Keeps everything on one URL/tab but uses accordions to hide complexity. | Low. Minimal architectural changes. | Users still face scrolling and accordion hunting; does not fix the multi-step button dance. |
| **Option C: Roo Code-Style Named Configuration Profiles** | Moderate fit. Users create named profiles ("Fast", "Deep", "Cheap") and map consumers to profiles. | High. Requires changing backend storage schema from individual key overrides to profile objects. | Overkill for users who just want to pick Claude for Main Agent and Gemini for Judge. |
| **Option D: Raw JSON Settings Editor (Zed / Continue style)** | Poor fit. Exposes raw JSON/YAML for power users. | Low to build, but fails UX requirements for general users and members. | Syntax errors, lack of inline connection verification, poor accessibility. |

---

## Disagreements in Developer Tools Design

1. **Inline Auto-Save vs Explicit "Save" Button**:
   - *VS Code & Zed* auto-save setting changes immediately upon dropdown selection.
   - *Linear & GitHub* use a bottom floating bar (`Unsaved changes: Save / Discard`) for batch edits.
   - *Decision for Ptah*: Adopt **immediate inline update** with a transient undo toast for single-value dropdowns (Provider, Model, Effort), but keep explicit **"Save" in the Add Provider Modal** to avoid committing half-typed API keys.

2. **Per-Feature Granularity vs Profiles**:
   - *Roo Code* bundles settings into "Profiles" and assigns profiles to modes.
   - *Zed & Continue* map individual model roles directly (`default_model`, `commit_message`, `compaction`).
   - *Decision for Ptah*: Ptah already has distinct background consumers (`curator`, `synthesis`, `judge`) and CLI agents. A **direct Role Assignment Matrix** (Zed/Continue pattern) fits Ptah's existing backend architecture much better than refactoring to abstract profiles.

3. **Scope Provenance: Where does the scope selector live?**:
   - *Old Ptah*: Every single setting field had its own "Save to [Global|App|Workspace]" dropdown and 4 rows of scope management buttons.
   - *VS Code*: A top-level scope switch (`User` | `Workspace`) dictates the editing context; fields merely indicate when they override a parent.
   - *Decision for Ptah*: Adopt the **top-level scope switch**. It eliminates hundreds of repetitive dropdown items across the page.

---

## Recommended One-Screen Layouts

### 1. Tab: "Providers" (Authentication & Connections)

```
+----------------------------------------------------------------------------------------------------+
|  Settings > Providers                                           [ + Connect Provider ]  [ Refresh ]|
|  Manage API keys, OAuth subscriptions, and custom inference endpoints.                             |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  CONNECTED PROVIDERS (4)                                                                           |
|  +-----------------------------------------------------------------------------------------------+ |
|  | Provider         | Auth Mode     | Status          | Credential Source   | Actions            | |
|  |------------------+---------------+-----------------+---------------------+--------------------| |
|  | [A] Anthropic    | Subscription  | (o) Ready       | Claude CLI Token    | [Check] [•••]      | |
|  | [O] OpenAI Codex | OAuth         | (o) Ready       | Secure Keyring      | [Check] [•••]      | |
|  | [G] Google Gemini| API Key       | (o) Ready       | Machine Secret Store| [Check] [•••]      | |
|  | [K] Kimi/Moonshot| API Key       | (x) Key Expired | Machine Secret Store| [Re-auth] [•••]    | |
|  +-----------------------------------------------------------------------------------------------+ |
|                                                                                                    |
|  LOCAL & CUSTOM ENDPOINTS (1)                                                                      |
|  +-----------------------------------------------------------------------------------------------+ |
|  | [L] Ollama Local | Custom HTTP   | (o) 127.0.0.1:11434 | No Auth (Local)  | [Check] [•••]      | |
|  +-----------------------------------------------------------------------------------------------+ |
|                                                                                                    |
|  [ + Add Custom Endpoint ]                                                                         |
+----------------------------------------------------------------------------------------------------+
```

### 2. Tab: "Agent Orchestration" (Roles, Models & Sub-Agents)

```
+----------------------------------------------------------------------------------------------------+
|  Settings > Agent Orchestration                     Scope: [ Global ] [ App ] [ Workspace: ptah* ]|
|  Assign models and reasoning effort to agent consumers and CLI sub-agents.                         |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  MAIN AGENT                                                                                        |
|  +-----------------------------------------------------------------------------------------------+ |
|  | Active Provider: [ Anthropic          v ]   Model: [ Claude 3.7 Sonnet   v ]                  | |
|  | Reasoning Effort: [ High (32k tokens) v ]   Status: (o) Verified route                        | |
|  | Scope: [ Workspace Override | ↺ Reset to Global ]                                             | |
|  +-----------------------------------------------------------------------------------------------+ |
|                                                                                                    |
|  BACKGROUND WORK CONSUMERS                                                                         |
|  +-----------------------------------------------------------------------------------------------+ |
|  | Consumer Role     | Provider       | Model                 | Effort    | Provenance | Actions | |
|  |-------------------+----------------+-----------------------+-----------+------------+---------| |
|  | Memory Curator    | Anthropic    v | Claude 3.5 Haiku    v | Low     v | Global (d) | [✎] [↺] | |
|  | Skill Synthesis   | OpenAI Codex v | GPT-4o Mini         v | Default v | Global (d) | [✎] [↺] | |
|  | Judge / Tribunal  | Google Geminiv | Gemini 2.5 Pro      v | High    v | App        | [✎] [↺] | |
|  +-----------------------------------------------------------------------------------------------+ |
|                                                                                                    |
|  CLI SUB-AGENTS                                                                                    |
|  +-----------------------------------------------------------------------------------------------+ |
|  | Agent CLI   | Status      | Assigned Model            | Effort    | Auto-Approve | Actions    | |
|  |-------------+-------------+---------------------------+-----------+--------------+------------| |
|  | Codex CLI   | (o) Ready   | GPT-4o (Codex CLI default)| Default v | [x] Enabled  | [•••]      | |
|  | Copilot CLI | (o) Ready   | Claude 3.7 Sonnet (Copilot| High    v | [ ] Disabled | [•••]      | |
|  | Cursor CLI  | (o) Ready   | Claude 3.5 Sonnet         | Default v | [x] Enabled  | [•••]      | |
|  | Antigravity | (o) Ready   | Gemini 2.5 Pro            | High    v | [x] Enabled  | [•••]      | |
|  +-----------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+
```

---

## Local Consequences in Ptah Monorepo

- `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`:
  - Split template into two logical sections or tabs: Providers Connections vs Agent Orchestration.
  - Remove all inline staged edit states (`modelDraft`, `effortDraft`, `activationId`, `clearKey`).
  - Introduce top-level scope switcher binding directly to `state.writeScopes()`.
  - Replace vertical button stacks with compact table rows and inline selects.
- `libs/frontend/chat/src/lib/settings/providers/setting-scope-row.component.ts`:
  - Deprecate the 5-button full-width row template.
  - Re-implement as an ultra-compact inline pill/badge: `<ptah-scope-badge [scope]="scope" [hasOverride]="hasOverride" (reset)="onReset()" />`.
- `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts`:
  - Replace large card layout with high-density table row component (`ProviderConnectionRowComponent`) supporting inline probe indicator and kebab menu.
- `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts`:
  - Transform from a list of card items to a cohesive `ConsumerAssignmentsTableComponent` with direct inline dropdowns.
- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts`:
  - Host inside a modal dialog (`<dialog class="modal">` daisyUI) triggered by "+ Connect Provider", keeping the main page uncluttered.

---

## Unknowns

- **Workspace Portability of Custom Endpoints**: When a workspace defines a custom Ollama or LM Studio URL that is local to one developer machine, should Ptah warn if the workspace is opened in a container or remote environment? (Experiment: Test connection probe behavior on workspace load).
- **Sub-Agent Capability Inspection**: Can CLI sub-agents dynamically report their supported models over JSON-RPC, or must Ptah maintain a curated capability map? (Experiment: Run `ptah_agent_list` and check schema response).
