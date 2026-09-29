# Providers tab UX audit (TASK_2026_555, lane GLM)

Read-only investigation. No source file was changed. Evidence uses `file:line` from the current tree plus `design-spec.md` of `TASK_2026_523_c3df` and the pre-#575 template at `7ecdefa45^1`.

Files examined:

- `libs/frontend/chat/src/lib/settings/settings.component.html`
- `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts`
- `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts`
- `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts`
- `libs/frontend/chat/src/lib/settings/providers/setting-scope-row.component.ts`
- `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts` (grep of template)
- `.ptah/specs/TASK_2026_523_c3df/design-spec.md` (sections 1-3)
- `git show 7ecdefa45^1:libs/frontend/chat/src/lib/settings/auth/auth-config.component.html`

---

## 1. Top 10 UX problems, ranked

| # | Problem | Nielsen heuristic | Evidence | User impact |
|---|---------|-------------------|----------|-------------|
| 1 | **The fold promise is broken.** "Your connections" sits roughly 700 px below the viewport top at 1024x768, because the Main-agent card grows to ~420 px. The 523 spec budgeted 64 px header + 152 px route summary + 88 px per connection row above the fold (`design-spec.md:22`). | Visibility of system status | `providers-settings.component.ts:71-156` (main card), `:158-173` (connections render after it); fold budget at `.ptah/specs/TASK_2026_523_c3df/design-spec.md:22` | The user scrolls about three screens to see connected auth. The primary question "what am I connected to?" has the slowest answer on the page. |
| 2 | **Scope-provenance UI dominates primary content.** 27 provenance strips render on one page: 5 in the Main-agent card (`providers-settings.component.ts:114-137`), 2 per background row x 6 (`provider-consumer-assignments.component.ts:262-277`), 1 per delegated CLI setting x 9 (`ptah-cli-config.component.ts:112-115`), 1 timeout (`provider-consumer-assignments.component.ts:451-459`). Each strip is ~44 px tall because its inner ghost buttons force `min-h-9` (36 px) inside a `py-1` `text-xs` strip (`setting-scope-row.component.ts:64-146`, button at `:81`). | Aesthetic and minimalist design | `setting-scope-row.component.ts:63-146`; multiplication sites above | ~1200 px of the page — more than one full screen — is provenance chrome that most users never act on. It answers a question nobody asked at this altitude. |
| 3 | **A disabled, action-free provenance row renders in the Main-agent card.** The group scope row "Mixed sources" is passed `disabled="true"` and no outputs (`providers-settings.component.ts:114-115`). It is pure decoration. | Aesthetic and minimalist design | `providers-settings.component.ts:114-115`; `setting-scope-row.component.ts:243` ("Mixed sources") | The tallest, most prominent card opens with a chip that carries no information and no action. The page reads as unplanned from the first card. |
| 4 | **"Change main provider" does not change anything — it scrolls.** The button on the Main-agent card calls `requestFocus('connections')` (`providers-settings.component.ts:91`), which focuses the connections heading. To switch, the user must then find a "Use for main agent" button on another card, then confirm in a third inline review section (`:175-192`). | Consistency and standards; recognition rather than recall | `providers-settings.component.ts:91`, `:175-192` | Three indirect steps for the single most important action on the tab. The button label promises a change; the behavior is navigation. |
| 5 | **Per-setting cards for nine CLI delegated settings.** `codexModel`, `copilotModel`, `cursorModel`, `antigravityModel`, `opencodeModel`, `piModel`, `codex/copilot/piReasoningEffort` each get a card with its own label, control, "From Global" chip and "Edit X" button (`ptah-cli-config.component.ts:111-140`, key list at `:160-163`). | Aesthetic and minimalist design; flexibility and efficiency | `ptah-cli-config.component.ts:111-140`, `:160-163` | ~1100 px of near-identical blocks. The user scans nine cards to find the one CLI they use. Grouping into one table with inline selects would cut this to ~200 px. |
| 6 | **Nine loading/retry status lines stack at the top of the page.** Every read section renders its own "Loading X…" or error line in one list before any content (`providers-settings.component.ts:60-69`, sections at `:350-360`). On first load, up to nine polite status lines push all content down ~180 px. | Visibility of system status (overdone); aesthetic and minimalist design | `providers-settings.component.ts:60-69`, `:350-360` | The page starts tall and noisy. Skeleton rows inside each section would communicate the same status without a status paragraph farm. |
| 7 | **A persistent security banner precedes the page header.** The "Runs 100% locally" / custom-endpoint banner renders above the Providers heading on every visit (`settings.component.html:82-110`), although it only matters while connecting a provider. | Aesthetic and minimalist design; match between the system and the real world | `settings.component.html:82-110` | ~40 px of always-on reassurance text the user stops reading after the first visit. It belongs in the wizard's Credential/Verify step. |
| 8 | **Connection cards repeat three text-only visual layers for one fact.** Each card shows a status badge, a status copy sentence, an optional "Last connected" line, an optional "Last check failed" line, plus a "Blocked main" badge — all in the same neutral outline style (`provider-connection-card.component.ts:109-179`, copy at `:127-148`). | Recognition rather than recall; consistency and standards | `provider-connection-card.component.ts:109-179`, status copy table at `:769-794` | The card is ~140 px tall for one provider, one modality, one status. State is carried by text alone (the spec forbade color, `design-spec.md:118`), so every state looks identical at a glance and the user must read each card. |
| 9 | **"Manage" opens the setup wizard, not the details drawer the spec promised.** The 523 spec: "Manage opens one NativeDrawerComponent ... body contains Connection, Models, and Used by sections" (`design-spec.md:88`). The implementation wires `manageRequested` to `openWizard(connection.id)` (`providers-settings.component.ts:167`), which opens the 5-step connect wizard. | Consistency and standards; user control and freedom | `providers-settings.component.ts:167`; spec at `.ptah/specs/TASK_2026_523_c3df/design-spec.md:88` | The user who wants to inspect or disconnect a working connection is dropped into a connect flow. Replace-key and disconnect are not reachable as spec'd. |
| 10 | **Header counts and workspace path consume three lines.** "15 providers · 5 configured", "Workspace: name", and the full selectable path stack vertically (`providers-settings.component.ts:41-52`). Count semantics ("providers" vs "configured" vs catalog) are also unexplained. | Aesthetic and minimalist design; recognition rather than recall | `providers-settings.component.ts:41-52` | ~100 px of header before the first card. The path is useful for copy/paste, but it does not need three always-visible lines. |

---

## 2. Vertical-space budget (estimated, 1024x768, 100% scale)

Estimates derive from the templates: `text-sm` line ≈ 20 px, `text-xs` ≈ 16 px, `btn-sm`/`min-h-9` = 36 px, `NativeCard` compact `p-3` = 12 px padding per side, `space-y-3` = 12 px between blocks.

| Section | Est. height | Source of the estimate |
|---|---|---|
| Settings chrome: Back row + 4-tab bar | ~76 px | `settings.component.html:19-68` |
| Security banner | ~40 px | `settings.component.html:82-110` |
| Providers page header (title + counts + workspace + path) | ~100 px | `providers-settings.component.ts:41-58` |
| Read-state status lines (initial load) | 0-180 px | `providers-settings.component.ts:60-69` |
| **Main agent card** | **~420 px** | `providers-settings.component.ts:71-156`: route + model text ~40 px; action row 36 px; effort label + full-width select ~56 px; 5 scope rows ~44 px each = 220 px; card padding 24 px; inner gaps ~44 px |
| **Your connections** (5 cards) | **~700 px** | `providers-settings.component.ts:158-173`; each card ~140 px: identity ~44 px, badges ~24 px, action buttons 36 px (often wrap to 72 px), source strip ~36 px, padding + gaps ~36 px |
| **Background models** (6 cards) | **~740 px** | `provider-consumer-assignments.component.ts:155-466`; each card ~120 px: name + summary ~36 px, 2 scope rows in a `p-2` box ~96 px, Edit button row 36 px (overlaps), padding 24 px. Enhancement time limit adds ~200 px when rendered (`:351-461`) |
| **CLI agents** (heading + instances + 9 delegated cards) | **~1100 px** | `ptah-cli-config.component.ts:40-150`; instances ~100 px each; delegated block heading + 9 cards x ~110 px |
| More providers (collapsed) | ~44 px | `providers-settings.component.ts:213-235` |
| Feedback / commit status region | 0-80 px | `providers-settings.component.ts:237-249` |
| **Total** | **~2900-3300 px** | ≈ 3.8-4.3 viewports at 768 px; matches the reported "about 3 screens" |

**Where the waste is:**

1. **Provenance strips: ~1200 px (36% of the page).** 27 strips at ~44 px each. The height is driven by `min-h-9` ghost buttons inside `text-xs` strips (`setting-scope-row.component.ts:81`). One icon-only badge at ~22 px with a popover would save ~1000 px.
2. **One-card-per-setting pattern: ~1100 px** for nine delegated CLI settings that could be one table of nine rows (~200 px).
3. **Connection cards: 2x-3x taller than spec.** Spec budget: 88 px per row (`design-spec.md:22`). Shipped: ~140 px. Text-only status layers and always-visible action buttons cause the difference.
4. **Main-agent card: 2.8x the spec budget.** Spec: 152 px (`design-spec.md:22`). Shipped: ~420 px. The five scope rows (~220 px) alone exceed the entire spec budget.
5. **Full-width controls.** The effort select and the "Save to" select use `w-full` (`providers-settings.component.ts:28`, used at `:99` and `:105`), forcing each onto its own 36 px line plus a 20 px label line. Inline `select-sm` would use ~half.

Root cause: the 523 spec simultaneously promised a fold budget (`design-spec.md:22`) and mandated a persistent source strip with real text buttons under **every** editable value (`design-spec.md:138`, `:146`, `:148`: "never an overflow menu or tooltip"). Those two requirements are in direct conflict. The implementation satisfied the strip mandate and lost the fold budget. The spec conflict must be resolved before any redesign is specified.

---

## 3. Old (pre-#575) auth-config UI: better and worse

Source: `git show 7ecdefa45^1:libs/frontend/chat/src/lib/settings/auth/auth-config.component.html`.

**Better:**

- **All providers visible at once.** A 3-column tile grid put every provider on one screen (~150 px total). Configured providers carried a small dot; the active provider carried a ring and an inline "Active: {name}" line. The user answered "what am I connected to?" without scrolling.
- **Direct manipulation.** Click a tile; the matching form renders directly below it. Two-button API-key/CLI toggle. No wizards, no review sections, no scroll indirection.
- **Compactness.** `text-[10px]` labels, `btn-xs`, `py-2` tiles. The entire provider selection + auth form fit in roughly the space one connection card occupies today.

**Worse:**

- **Status was a guess, not evidence.** The green dot rendered from `hasApiKey()` or `claudeCliInstalled()` (template conditions around lines 20-28 and 78-97 of the old file) — credential presence, not a probe. The current state table (`provider-connection-card.component.ts:614-650`) is honest where the old UI was optimistic.
- **Hard-coded Claude tile.** The old template's own comment admits Claude was hard-coded, not registry-driven. Registry providers and the built-in tile had different code paths.
- **No provenance at all.** Scope layering (Global/App/Workspace) was invisible. The old "Global default" label was actively wrong about app scope (`design-spec.md:152` documents this).
- **No background-model or CLI-agent visibility.** Those settings lived scattered across Skills and ptah-ai panels with no resolved summary.
- **Save-then-test mutation.** The old `saveAndTest()` wrote the credential before checking it (`design-spec.md:198`). The current draft verification in the wizard is safer.

Net judgment: the old UI won on density and glanceability; the new UI wins on truthfulness (probe evidence, provenance, honest states). The failure of #575 is not that it added truth — it is that it gave truth a full-width row and a 36-px button every time.

---

## 4. Proposed information architecture for the Providers tab

### Design principle

Primary content answers three questions above the fold: *what runs the next request*, *what am I connected to*, *what can I add*. Everything else — provenance, per-setting editors, background assignments, the catalog — is progressive disclosure.

### Sections, in order

1. **Header (one line, ~48 px).** "Providers" + two count chips ("15 available" · "5 configured") + workspace chip whose popover shows the full path + primary button "Connect provider". "Refresh settings" moves into a kebab/overflow; it is a maintenance action, not a peer of Connect. The security banner moves into the wizard (Credential/Verify step) and the custom-endpoint form.
2. **Main agent (one strip card, ~120 px).** One line: mark + "Claude · CLI subscription · Default model". Second line: reasoning effort as an **inline** `select-sm` + buttons "Change provider", "Edit model", "Check connection". "Change provider" opens a **popover listing the user's existing connections** (name + health + scope); picking one opens the same review that exists today (`providers-settings.component.ts:175-192`), rendered inside the popover — no scrolling to connections.
3. **Your connections (list rows, not cards; ~44 px per row).** Per row: 24 px mark, name + modality, status badge (color tone restored for glance: keep text, add the semantic tone the state table already computes in `cardTone()`, `provider-connection-card.component.ts:682-698`), "Last connected" collapsed into the badge popover, one kebab menu: *Use for main agent · Manage · Check connection · Remove*. "Credential: stored on this machine" moves into the Manage drawer. Rows keep the ordering rule already implemented (active first, `providers-settings.component.ts:336-341`).
4. **Manage drawer (per 523 spec, not yet shipped).** Implement the spec'd `NativeDrawerComponent` with Connection / Models / Used-by sections (`design-spec.md:88`) so "Manage" stops opening the setup wizard.
5. **Background models (collapsed by default, one row per consumer).** Each of the six consumers is one compact row: name + resolved summary ("OpenAI Codex · gpt-5.6-luna" / "Follows main agent → Claude") + Edit. Edit expands an inline editor with the shared picker. Scope provenance per row is one small badge (below).
6. **CLI agents.** One compact row per agent instance: name, provider, enabled toggle, inline model select. The nine delegated orchestration settings leave this tab (section 5 below).
7. **More providers (collapsed `details`, as today).** Two-column grid of one-line entries: mark, name, "Set up". Keep `:213-235` structure; drop per-entry paragraph lines.

### Compact scope provenance: badge + popover

Replace every `ptah-setting-scope-row` strip with a **16 px icon-only badge** (`Globe`/`Cpu`/`Folder`/`Layers` for mixed) placed inline next to the value it describes. Clicking (or Enter on focus) opens a popover that contains, verbatim, today's strip content: source line, override/clear/use-global buttons, fallback preview, credential line. The buttons inside the popover stay real buttons, so the accessibility intent of `design-spec.md:148` is kept — only the "always visible" part is amended. Only overridden values get a highlighted badge variant (e.g. filled background); inherited values get the quiet outline. This is the single change that recovers ~1000 px. It requires a recorded amendment to `TASK_2026_523_c3df/design-spec.md` (the strip mandate at `:138`, `:146`, `:148`).

### Grouping of per-CLI model/effort settings

The nine `agentOrchestration.*` settings (`ptah-cli-config.component.ts:160-163`) become one compact table — one row per CLI agent (Codex, Copilot, Cursor, Antigravity, OpenCode, Pi): agent name + inline model select + inline effort select + scope badge. One "Edit" affordance per row at most; inline selects remove the need for per-card Edit buttons entirely. This block lives on the **Agent Orchestration** tab (section 5 below), so the Providers tab sheds ~1100 px.

### ASCII wireframe — 1024x768, above the fold

```
+--------------------------------------------------------------------------+
| <- Back  Settings                                                         |  28 px
| [ Providers ][ Agent Orchestration ][ Advanced ][ Search & Voice ]        |  32 px
|                                                                            |
| Providers  (15 available) (5 configured) (ws: ptah-extension)(v)  [+ Connect provider]   ~48 px
|                                                                            |
| Main agent                                                                 |
| +------------------------------------------------------------------------+ |
| | (C) Next request: Claude . CLI subscription . Default model   [G](v)   | |  ~120 px
| |     Reasoning effort: [medium v]   [Change provider] [Edit model]      | |
| +------------------------------------------------------------------------+ |
| Your connections                                                           |
| +------------------------------------------------------------------------+ |
| | (C) Claude Subscription   API key        [** Active for main **]    (v) | |  ~44 px
| | (M) Moonshot Kimi         API key        Connected                  (v) | |
| | (O) OpenAI Codex          CLI            Connected                  (v) | |
| | (O) Ollama Cloud          OAuth          Check unavailable         (v) | |
| | (S) sovereigneg           Custom          Not checked               (v) | |
| +------------------------------------------------------------------------+ |
| Background models (6) - summaries on one line each          [Expand (v)]   |  ~40 px
| CLI agents (2)                                              [Expand (v)]   |  ~40 px
| More providers (9)                                                          |  ~44 px
+--------------------------------------------------------------------------+
    Everything above fits in ~700 px: header, main agent, all 5 connections,
    and three collapsed sections are visible without scrolling.
```

`(v)` = kebab or badge popover. `[G]` = scope badge. Estimated above-fold total: ~560-660 px of content, comfortably inside 768 px even with error text or zoom expansion — the property the 523 fold budget demanded.

---

## 5. Settings that should move to the Agent Orchestration tab

The Providers tab should own **connections and model choice for Ptah's own execution**. Everything that configures *delegated agent behavior* belongs where the agents are configured.

**Move to Agent Orchestration:**

1. **The nine delegated CLI model/effort settings** — `codexModel`, `copilotModel`, `cursorModel`, `antigravityModel`, `opencodeModel`, `piModel`, `codexReasoningEffort`, `copilotReasoningEffort`, `piReasoningEffort` (`ptah-cli-config.component.ts:160-163`). These configure external CLI agents, not provider connections. The 523 spec itself split the tab this way: "Concurrency and execution policy can remain under Agent Orchestration" (`design-spec.md:31`). Model identity is execution policy for these agents. Providers keeps a one-line summary with a link.
2. **Enhancement time limit** (`provider-consumer-assignments.component.ts:349-461`, key `skillSynthesis.enhanceTimeoutMs`). It is a behavioral bound on enhancement runs, not a provider or model fact. It moves with the judging/enhancement policy, which is orchestration.

**Keep on Providers:**

- Main agent route, model, reasoning effort, and connection management (they select and authenticate providers).
- The six background-consumer assignments (memory curator, five lanes) — they pick a provider/model pair, so they stay, as collapsed compact rows. They need connection health, which lives here.
- CLI agent **instances** (name, key, enabled, per-instance selected model) — these are connection-adjacent and the setup wizard feeds them.

If the Orchestration tab later becomes too tall, the judging/enhancement consumer row can follow its timeout there, leaving Providers with only a "Manage in Orchestration" link — the same pattern the 523 spec used for memory diagnostics (`design-spec.md:32`).

---

## Summary

The page is long because the 523 spec mandated a persistent, button-bearing provenance strip under every editable value while also promising a fold budget those strips make impossible. The shipped implementation followed the strip mandate faithfully. The fix is one spec amendment (badge + popover for provenance), one grouping change (delegated CLI settings into a table on the Orchestration tab), and a density pass on connection cards (rows + kebab + drawer). Those three changes return the page to roughly one screen for primary content and restore the promised fold.