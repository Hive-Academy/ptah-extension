# Agent Orchestration tab / Providers boundary — UX audit

Task: TASK_2026_555 · read-only investigation · scope: Agent Orchestration tab and the
Providers/Orchestration boundary created by PR #575 (TASK_2026_523). Providers-tab-internal
layout is covered by a separate audit; this file cross-references it only where the boundary
itself is the problem.

Sources: current `agent-orchestration-config.component.ts`, `ptah-cli-config.component.ts`,
`providers-settings.component.ts`, `settings.component.html`; pre-#575 versions read via
`git show 7ecdefa45^1:...`; `.ptah/specs/TASK_2026_523_c3df/design-spec.md`.

## 1. Current Agent Orchestration tab — full control inventory

File: `libs/frontend/chat/src/lib/settings/ptah-ai/agent-orchestration-config.component.ts`

| # | Label / control | Setting key | Type | Location |
|---|---|---|---|---|
| 1 | "Re-detect" button | `agent:detectClis` RPC | button (spinner while loading) | :55-67 |
| 2 | Static description ("Headless agents...") | — | text | :70-73 |
| 3 | Error line | `agentConfigError` | text | :76-78 |
| 4 | Loading line | `agentConfigLoading` | text | :81-88 |
| 5 | **Preferred Agent Order** — reorderable list, one row per installed agent (system CLI or Ptah-CLI instance), each row: name, "Off"/"Custom" badge, up-arrow, down-arrow | `AgentOrchestrationConfig.preferredAgentOrder` | ordered list + 2 buttons/row | :101-167 |
| 6 | **Max Concurrent Agents** — range slider 1–20 with live value and 1/10/20 tick labels | `AgentOrchestrationConfig.maxConcurrentAgents` | `<input type=range>` | :169-200 |
| 7 | **System CLIs** section heading | — | heading | :207-211 |
| 8 | Per-CLI row (×6: codex, copilot, cursor, antigravity, opencode, pi): name, provider badge, install/status badge (Configured/Installed/Needs API key/Not Found), version | `AgentOrchestrationConfig.detectedClis[]` | card row | :213-266 |
| 9 | Per-CLI **Enable/Disable toggle** (only when `cli.installed`) | `AgentOrchestrationConfig.disabledClis[]` | toggle | :255-264 |
| 10 | **Auto-approve Copilot tool calls** toggle — Copilot row only, plus inline error text and a "Check saved setting again" recovery button when the write's outcome is unconfirmed | `AgentOrchestrationConfig.copilotAutoApprove` | toggle + conditional button | :268-295 |
| 11 | **"Manage provider, model and credentials in Providers"** button — on every CLI row, navigates away to Providers tab, `section: 'cli-agents'` | — (navigation) | button | :296 |
| 12 | "No CLI agents found" help block with `npm install -g @openai/codex` / `@github/copilot` snippets | — | conditional block | :302-321 |

Everything in this tab reads/writes the RPC channel `agent:getConfig` / `agent:setConfig` against
`AgentOrchestrationConfig`. There is **no model, no reasoning-effort, and no per-CLI credential
control anywhere on this tab** — those were all removed in #575.

## 2. CLI-agent controls now on the Providers tab

File: `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-config.component.ts`, mounted inside
`providers-settings.component.ts` under the "CLI agents" (`data-focus="cli-agents"`) heading.

| # | Label / control | Setting key | Type | Location |
|---|---|---|---|---|
| 1 | "Add CLI agent" button + inline create form (agent name, provider-connection select, API key) | `cli: [{action:'create', ...}]` | form | :42-60 |
| 2 | Per Ptah-CLI-**instance** card (arbitrary user-named agents bound to a provider connection): name · providerName, model count, enabled text | `state.cliAgents()` | card | :62-104 |
| 3 | Model display + **Edit {agent} model** → picker → **Save**/**Cancel** | `cli: [{action:'update', params:{selectedModel}}]` | 3-step inline editor | :67-79 |
| 4 | **Enable {agent} for delegated work** toggle | `cli: [{action:'update', params:{enabled}}]` | toggle | :81-86 |
| 5 | Edit name/key, Test connection, Remove (with confirm) | `cli:[{action:'update'/'delete'}]` | buttons | :87-101 |
| 6 | **Cursor API key** field + "Save Cursor credential" | `saveCursorCredential` | field + button | :105-109 |
| 7 | **"Delegated CLI models and reasoning effort"** — 9 separate one-setting cards, each: value line, scope-source row, **Edit {name}** → select → **Save**/**Cancel**: Codex model, Copilot model, Cursor model, Antigravity model, OpenCode model, Pi model, Codex reasoning effort, Copilot reasoning effort, Pi reasoning effort | `AgentOrchestrationConfig.{codexModel,...,piReasoningEffort}` | 9× 4-step inline editor | :110-144 |

Row 7 writes to the **same** `agentOrchestration.*` keys the old Agent Orchestration tab used
to own directly (`state.saveSettings({ orchestration: {...} })`), just rendered on a different tab
now. Row 2-6 (Ptah-CLI instances) is a structurally different data model — connection-bound, named,
user-created agents — coexisting in the same visual section with no heading break between the two
concepts beyond the "Delegated CLI models and reasoning effort" `<h3>`.

## 3. Diff against pre-#575 Agent Orchestration tab

Read via `git show 7ecdefa45^1:.../agent-orchestration-config.component.ts` (1081 lines) and
`.../ptah-cli-config.component.ts` (1172 lines, old — a different, CLI-agent-instance-only component
at that path before #575 repurposed it).

**Unchanged, confirmed present both before and after:** Preferred Agent Order (old :101-167,
same feature), Max Concurrent Agents slider, Re-detect button, System CLIs list with
install/enable state, Copilot auto-approve toggle, "No CLI agents found" help block. These are
not part of the #575 regression — flag them only as pre-existing problems below.

**Moved (old → new), with a cost the move introduced:**

- Each system CLI's **Model select** lived inside that CLI's own card, directly under its name and
  status badge (old :291-742, e.g. Codex block :291-362, Copilot :363-443, Cursor :444-543,
  Antigravity :544-593, OpenCode :594-644, Pi :645-730). Selecting a model fired
  `onModelSelect(cli, event)` immediately — **one action, no Edit/Save/Cancel gesture**.
  Now: the same field is `Edit {name} model` → open picker → `Save {name} model` → separately
  `Cancel {name} model edit`, and it lives on a different tab, disconnected from the
  install/enabled status it configures.
- Each CLI's **Reasoning Effort select** (Codex :320-362, Copilot :396-443, Pi :676-729) was
  **directly adjacent to that same CLI's model select**, inside the same card. Now: Codex's model
  and Codex's reasoning effort are two of nine cards in a flat list, separated by Copilot model,
  Cursor model, Antigravity model, OpenCode model, and Pi model in between (`delegatedModels` array
  order, ptah-cli-config.component.ts:159-164) — co-location between a CLI's own model and its own
  effort is lost.
- **Cursor API key field** was inside Cursor's own card, next to Cursor's model select (old
  :444-500). Now it is a standalone field between the instance-card list and the
  "Delegated CLI models" list (ptah-cli-config.component.ts:105-109), no longer adjacent to
  "Cursor model."

**Lost:**

- Visibility of the resolved model/effort **on the tab that shows the CLI's enable/install
  status.** Before #575, glancing at the System CLIs section told you install state, enabled
  state, model, and effort for every CLI in one screen. After #575, the Agent Orchestration tab's
  per-CLI row shows only name/status/enable toggle (plus Copilot's extra toggle); model and effort
  are entirely absent and require a tab switch to see, let alone change.
- **Deep-link precision.** `manageProviders()` (agent-orchestration-config.component.ts:415-418)
  calls `requestSettingsTab({ tab: 'providers', section: 'cli-agents' })` — a single generic
  section id, not per-CLI. Clicking "Manage provider, model and credentials in Providers" from the
  Antigravity row lands at the top of the "CLI agents" heading on Providers, not at Antigravity's
  own model/effort card; the user must scroll past "Add CLI agent," every Ptah-CLI instance card,
  the Cursor key field, and 4 of the 9 delegated cards to reach it.

**Worse (not merely moved, but structurally regressed):**

- The interaction cost per model/effort change went from 1 step (select an option) to 4 steps
  (Edit → choose → Save → the editor closes, or Cancel) — for **9 separate fields**, each gated by
  its own draft-state signal (`delegatedDraft`) so only one can be open at a time even though the
  fields describe six unrelated CLIs.
- The 9-card list is presented as one undifferentiated stack (`@for (choice of delegatedModels...)`
  at ptah-cli-config.component.ts:112-144) with no grouping by CLI, whereas the pre-#575 layout's
  grouping by CLI was the only structure the page had.

## 4. Ranked UX problems on the current Agent Orchestration tab

**1. Broken task completion / forced context switch, no return path (Nielsen #7 Flexibility and
efficiency of use; #6 Recognition rather than recall).**
Every one of the 6 CLI rows carries a "Manage provider, model and credentials in Providers"
button (agent-orchestration-config.component.ts:296) that is the *only* way to see or change that
CLI's model or effort. The button's target is a single shared section id (`cli-agents`), so it
cannot land the user on the specific CLI's own card (verified: `manageProviders()` takes no CLI
argument, :415-418). The user must remember which CLI they came from and re-locate it among 9 flat
cards on a different tab. This is the highest-severity problem because it is the one that
regresses relative to the pre-#575 build, where the same edit took zero navigation.

**2. No overview of what will actually run (Nielsen #1 Visibility of system status; #6
Recognition rather than recall).**
The tab that owns "who does the work" — enable toggles, concurrency, preferred order — cannot
answer "what model will Codex use?" or "is Pi's reasoning effort set?" without leaving the tab.
Before #575 this was visible inline per CLI. Config visibility now requires cross-referencing two
tabs by CLI name, held in the user's head.

**3. Duplicate, unexplained enable semantics across tabs (Nielsen #4 Consistency and standards;
#2 Match between system and the real world).**
"Enable/Disable toggle" for a **system CLI** (`disabledClis[]`, Orchestration tab) and "Enable
{agent} for delegated work" for a **Ptah-CLI instance** (`cli:[{action:'update',{enabled}}]`,
Providers tab) look like the same control (a `toggle` with near-identical copy) but govern
different data models with different scopes, on different tabs, with nothing on either screen
explaining the distinction between a "system CLI" and a "Ptah CLI agent instance."

**4. One-off exception control breaks the row pattern (Nielsen #4 Consistency and standards).**
Copilot's row alone gets an extra toggle ("Auto-approve Copilot tool calls"), plus its own error
text and a conditional "Check saved setting again" recovery button
(agent-orchestration-config.component.ts:268-295). A user scanning six otherwise-identical rows
hits an unexplained, structurally different row with no visual cue as to why only Copilot differs.

**5. Undocumented control (Nielsen #10 Help and documentation).**
"Max Concurrent Agents" (slider, 1–20) has no explanation of what "concurrent" means here (parallel
task execution across CLIs? per-CLI parallelism? rate-limit protection?), nor any guidance on
trade-offs (cost, rate limits, provider quotas) — just a bare label, a number, and tick marks.

**6. Inefficient reordering for a growing list (Nielsen #7 Flexibility and efficiency of use) —
pre-existing, not a #575 regression, but adjacent to this tab's core content.**
"Preferred Agent Order" only supports moving one row at a time via up/down arrow buttons
(`moveAgentUp`/`moveAgentDown`, :426-441); with 6 system CLIs plus any number of Ptah-CLI
instances, moving an item from last to first costs one click per position.

## 5. Proposed mental model for the two-tab split

**Evaluated framing:** Providers = "who can I talk to" (connections, credentials, main agent);
Agent Orchestration = "who does the work" (one table: agent row = enabled toggle, provider, model
select, reasoning-effort select, status) plus concurrency/policy.

**This framing is supported by the evidence and is the right fix.** The two data models already
observed in the code back it up:

- `ProvidersSettingsStateService.cliAgents()` (Ptah-CLI instances) are inherently a **connection**
  concept — they don't exist without a `providerId`, need credential entry/replacement, "Test
  connection," and "Remove agent, connection remains." This is squarely "who can I talk to" and
  belongs on Providers.
- `AgentOrchestrationConfig.{cli}Model` / `{cli}ReasoningEffort` are a **per-run execution**
  decision — what a CLI does when orchestration hands it a task. That is squarely "who does the
  work" and belongs with the enable toggle, concurrency, and preferred order it currently sits
  next to on paper but not on screen.

The current split instead cut along "provider mentions a model" (→ Providers) vs. "everything
else" (→ Orchestration), which is why a CLI's enable state and its model live on different tabs
while its model and its own reasoning effort also live apart from each other within Providers.

**What should move from Providers into Agent Orchestration:**

- The entire "Delegated CLI models and reasoning effort" list (ptah-cli-config.component.ts:110-144,
  the 9 cards: Codex/Copilot/Cursor/Antigravity/OpenCode/Pi model + Codex/Copilot/Pi reasoning
  effort) — collapse into two columns of the orchestration table (Model, Effort), one row per CLI,
  merged with the existing status/enable row that CLI already has on Orchestration.
- What stays on Providers: the Ptah-CLI **instance** create/edit/remove flow (name, provider
  connection, API key, Test connection) and the standalone Cursor API key field — these are
  credential/connection actions, not run-time behavior. The instance's resulting `enabled` state
  and effective model should be *read* into the same orchestration table (by shared CLI/agent id)
  rather than edited a second time there, so there is exactly one place to flip "enabled" and one
  place to pick "model," cross-linked instead of duplicated.

**ASCII wireframe — proposed Agent Orchestration tab, 1024×768:**

```
┌ Settings ▸ Agent Orchestration ─────────────────────────────────────── 1024px ┐
│ ← Back                                              Settings                  │
│ [ Providers ] [*Agent Orchestration*] [ Advanced ] [ Search & Voice ]         │
│─────────────────────────────────────────────────────────────────────────────│
│ Agent Orchestration                                        [ Re-detect ⟳ ]   │
│ Headless agents used for parallel task execution.                            │
│                                                                                │
│ ┌ Agents ──────────────────────────────────────────────────────────────────┐ │
│ │ Agent        Enabled   Provider     Model              Effort   Status   │ │
│ │ ──────────── ────────  ───────────  ─────────────────  ───────  ──────── │ │
│ │ ↕ Codex      [x]───    OpenAI ▾     gpt-5.1-codex ▾     high ▾   Installed│ │
│ │ ↕ Copilot    [x]───    GitHub ▾     copilot-4.1 ▾       med  ▾   Installed│ │
│ │              Auto-approve tool calls [x]───  (Copilot only)              │ │
│ │ ↕ Cursor     [ ]───    Cursor ▾     auto ▾              —        Needs key│ │
│ │ ↕ Antigravity[x]───    Google ▾     gemini-3-pro (High)▾ —       Installed│ │
│ │ ↕ OpenCode   [x]───    Anthropic▾   anthropic/sonnet-4.5▾ —      Installed│ │
│ │ ↕ Pi         [x]───    Pi ▾         pi-large ▾          max ▾    Installed│ │
│ │ ↕ my-cli-1   [x]───    Anthropic▾   claude-opus-4 ▾     —        Custom   │ │
│ │                                                                            │ │
│ │ Manage connections and credentials → Providers                           │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│                                                                                │
│ ┌ Concurrency & policy ─────────────────────────────────────────────────────┐│
│ │ Max Concurrent Agents            [──●─────────────] 5   (1 / 10 / 20)     ││
│ │ Runs up to 5 CLI agents in parallel across the enabled rows above.        ││
│ └────────────────────────────────────────────────────────────────────────┘ │
│                                                                                │
│ No CLI agents found? Install one to enable orchestration:                    │
│  Codex CLI:  npm install -g @openai/codex                                    │
│  Copilot:    npm install -g @github/copilot                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

Row-level model/effort selects open inline (no separate tab), matching the pre-#575 one-step
interaction; the up/down arrows collapse into the existing per-row reorder affordance so
"Preferred Agent Order" becomes this same table's row order rather than a separate list repeating
the same agent names. "Manage connections and credentials → Providers" is one link, once, at the
bottom of the table — not per-row — since it is now genuinely a different concern (credentials)
rather than the only way to reach the model field.

## Evidence not yet resolved

I could not locate a component test or e2e spec asserting the current 4-step Edit/Save/Cancel
flow is required by any downstream consumer (e.g., undo/audit trail); if one exists, the proposed
inline-select collapse should preserve it rather than reverting to onChange-fires-immediately.
