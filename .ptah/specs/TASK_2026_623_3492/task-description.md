# Requirements - TASK_2026_623_3492

Revision 3.1 (2026-10-09) [rev 3.1]. Changes from revision 3 (marked "[rev 3.1]"):

- R10.1 requires a new read-only RPC whose response carries only the five row values, the four scalars and the "as of"
  time. Extending or forwarding `provider:getPlanLimits` is no longer allowed (`task-description-rev3-review.md`
  defect 1).
- decisions.md #16 is recorded: CLI lanes show `context` as "unavailable"; CLI context reporting is a follow-up task.
  The user question is closed.

Revision 3 (2026-10-09) [rev 3]. Changes from revision 2 (each changed line is marked "[rev 3]"):

- R5 gains a `context` row field (decisions.md #14), a `session` scope (`$agents session`) with its grammar delta,
  and fixtures for both (R5.10-R5.13).
- New R10: the `$limits` host source for CLI plan limits (decisions.md #15), backed by a new read-only host read.
- R8 covers the new sources and the `session` scope in the hint and the skill.
- R1.13 records the Agents-tab empty-state rule (decisions.md #11). R4.4 records the sparkline highlight colour
  (decisions.md #12). decisions.md #13 (turn summary keeps the warm gradient) is a design-only decision and needs no
  requirement change.
- Scope, NFR (Security, Tests), Stakeholders, Risks, Resolved decisions, Open questions and Handoff are amended to
  match.

Revision 2 (2026-10-09). Changes from revision 1:

- It fixes the six defects in `task-description-review.md` (round 0):
  - the pipe escape rule
  - a stated surface cap
  - the `$agents` merge key
  - full contract paths
  - the tests-row move (now user-approved, decisions.md #10)
  - observable preview visuals
- It folds in the user decisions in `decisions.md` #5-#10 (see "Resolved user decisions").
- It adds R9: collapsible and responsive chips and cards (decisions.md #9).

Rule tags (same convention as TASK_2026_610_6a10):

- **[user]**: requested or decided by the user (`context.md`, `decisions.md`).
- **[project]**: a standing rule from a cited earlier task.
- **[lane]**: proposed by this document. The user or Gate 1 may veto it.

Untagged criteria follow directly from a tagged rule.

Token figures use `gpt-tokenizer` on the Electron host, the same as TASK_2026_610 Context "Token counting". Every
measurement records the resolved package version.

## Context

### What exists on `main` (worktree `feat/task-623-display-panel`, from `70f995a56`)

**Fence channel (TASK_2026_610 PR B+C).**

- The coding agent can write a ```` ```ptah-ui ```` block in its reply.
  - `segmentPtahUi` recognises only the exact opener line ```` ```ptah-ui ````
    (`libs/shared/src/mcp-apps-contracts/ptah-ui-fence.ts:35`).
  - The eager gate is `hasPtahUiFenceLine` (`libs/frontend/chat/src/lib/components/organisms/execution/ptah-ui-fence-line.ts:18-30`).
  - The renderer loads through `@defer`
    (`libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:176-204`).
- The pipeline runs parse, convert, resolve, then validate
  (`libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.ts:20-52`).
  - The parser accepts `title stats table list chart` (`libs/shared/src/mcp-apps-contracts/ptah-ui.types.ts:7-13`),
    with caps of 8,192 bytes and 200 lines (`libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts:26-35`).
  - `note` (610 PR D) was never built.
  - Sources: `$diff`, `$tests`, `$usage` (`libs/shared/src/mcp-apps-contracts/ptah-ui-parser.ts:12-24`), resolved
    from `TurnSourceSnapshot`
    (`libs/shared/src/lib/utils/turn-sources.utils.ts:37-43,118`).
- Blocks are immutable, and at most `PTAH_UI_LIVE_CAP = 8` stay live
  (`libs/frontend/chat-ui/src/lib/services/ptah-ui-live-window.ts:13`).
- Blocks render in Electron only (`libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts:199-210`).
- `PTAH_UI_HINT` is 77 tokens against a 100-token budget (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:5`,
  `TASK_2026_610_6a10/measurement.md:47-50`). It is appended only for Electron coding sessions with `ptahUiFence`
  (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1776-1779`).
- The full grammar is in the `ptah-surface-authoring` skill
  (`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/references/ptah-ui.md`).

**Surface contract.** `dashboard-spec/2` + `dashboard-catalog/3`. All contract files are in
`libs/shared/src/mcp-apps-contracts/`.

- The versions are at `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:9-10`.
- Layout kinds are `section stack grid card` (`libs/shared/src/mcp-apps-contracts/surface-catalog.ts:22-27`). Their
  types are at `libs/shared/src/mcp-apps-contracts/surface.types.ts:24-48`.
- Display kinds are `stat line-chart bar-chart table list alert badge progress radial-progress divider text-block`
  (`libs/shared/src/mcp-apps-contracts/surface-catalog.ts:35-47`).
- `stat` has a numeric `delta` (`libs/shared/src/mcp-apps-contracts/dashboard-spec.types.ts:136-142`). It renders as
  plain "Δ +2" text (`libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.ts:18-19`).
  There is no trend pill and no sparkline.
- There is no avatar kind and no collapsible container.
- Budgets are in `SURFACE_LIMITS` (`libs/shared/src/mcp-apps-contracts/surface-catalog.ts:114-151`):
  `maxTreeDepth` 8, `maxComponents` 200, `maxChildrenPerNode` 50, `maxGridColumns` 4.
- Store budgets are in `SURFACE_STORE_LIMITS` (`libs/shared/src/mcp-apps-contracts/surface-catalog.ts:157-167`),
  including `maxSurfacesPerRoutingId: 8`.
- Patch ops are `set-data remove-data add-component replace-component remove-component set-title`
  (`libs/shared/src/mcp-apps-contracts/surface.types.ts:181-200`). They are applied by `applySurfaceOps`
  (`libs/shared/src/mcp-apps-contracts/surface-patch.ts:258`).
- The renderer's grid reacts to the viewport, not its container (`sm:grid-cols-*`,
  `libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.ts:19,127`). Inside a side panel
  the viewport is wide while the panel is narrow.

**Turn recap (610 PR A and TASK_2026_576).**

- The change-set card (`libs/frontend/chat-ui/src/lib/molecules/change-set/change-set-card.component.ts`) and the
  Electron-only tests row (`libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.ts`) are
  mounted below the turn-ending message
  (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:69-118`).
- Tokens, cost and duration are per-message footer badges
  (`libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:135-152,164-183`). They are not
  attached to the card.
- The user judged this recap "not true and doesn't look right".

**Previews.**

- Command and file previews are `ptah-tool-call-item` (`libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-item.component.ts`)
  and the chat-ui tool-execution molecules (header, input, output, `code-output`, `diff-display`).
- None has a copy action or an exit-outcome label.
- The Bash header shows the description or a 40-character command
  (`libs/frontend/chat-ui/src/lib/utils/tool-target.utils.ts:47-54`).
- The Edit diff lists every old line as `-` and then every new line as `+`
  (`libs/frontend/chat-ui/src/lib/molecules/tool-execution/diff-display.component.ts:149-163`).

**Agent data.** `AgentMonitorStore` (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`, root-provided)
holds two record types:

- `MonitoredAgent` for CLI lanes (L389-513: `cli`, `displayName`, `status`, `startedAt`/`completedAt`, `usageTotals`).
  It also holds prompt and output (`task`, `stdout`, `stderr`, `segments`).
- `SubagentRecord` for SDK subagents (L526-581: `agentType`, `teammateName`, `status`, `totalTokens`, `durationMs`,
  `usage.estimatedCostUsd`). It also holds `description` and `latestSummary`.

Foreground Task subagents are also `ExecutionNode`s of type `agent` (`libs/shared/src/lib/types/execution/node.ts:171-199`)
with `tokenUsage`, `cost`, `duration`, and also `agentPrompt`.

**Panel pattern.** `ptah-agent-monitor-panel` is mounted per `ChatViewComponent`
(`libs/frontend/chat/src/lib/components/templates/chat-view.component.html:276-299`).

- It has a pointer resize separator with a double-click reset.
- `PanelResizeService` clamps the width to 300 px to 75% of the container, kept in memory
  (`libs/frontend/chat/src/lib/services/panel-resize.service.ts:21-46`).
- It becomes an overlay under a 600 px host width
  (`libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:171,383-388`).
- It auto-opens unless the user closed it (`_userExplicitlyClosed`, same file `:485-501`).

### What the user asked for

The user asked for these things (`context.md`) [user]:

- Agent-built visuals "with daisy ui to combine a couple of elements together into a shape". The example is a
  subagent list with its usage, shown "as a beautiful component in the chat rather [than] a markdown".
- Turn data as "stats cards accordions".
- Command and file previews that look polished.
- A "display monitor panel similar to our cli agent monitor-panel component that [is] automatically controlled by the
  agent", holding "responsive containers, with rows and columns".

The visual quality target is the two reference screenshots in `references/`:

- soft cards
- large figures with trend pills
- inline bar sparklines
- generous spacing
- stat tiles with small charts

### Why it matters

610 gave the agent a compact, validated visual channel, but only inline and only as a flat list of elements. This task
adds three things:

- a dedicated room (the panel)
- composition (layout containers and richer atoms)
- the host-built turn summary in that room

It keeps the context-cost and trust rules from 610.

## Classification

- **Type:** FEATURE. It adds a new UI surface, a grammar extension, a catalog bump, a host source, and a redesign of
  three existing chat surfaces.
- **Estimate:** XL. Six things drive the size:
  - a normative grammar delta with nesting
  - `dashboard-catalog/4` (new kinds plus compatibility with `/3`)
  - a per-tab panel with open, close, pin and resize state and auto-open rules
  - a fourth host source with privacy rules
  - a fifth host source (`$limits`) with a new read-only host read, and a session scope for `$agents` [rev 3]
  - moving the turn summary, with parity for three surfaces
  - hint, skill and token measurements
- **Priority:** not defined here.

## Scope

In scope:

- **R1.** A per-chat-tab display panel in Electron, with open, close, pin and resize, auto-open rules, and an in-chat
  chip.
- **R2.** ```` ```ptah-ui display [id] ```` fences. A repeated id updates in place. Fallback and streaming rules are
  included.
- **R3.** Layout grammar: `row col grid card section accordion` with nesting, as an EBNF delta against 610's grammar.
- **R4.** Atoms: stat trend pill and sparkline (an extension of `stats`), `progress`, `badge`, `avatar`, `note`
  (folds 610 PR D), and `accordion` (R3). This needs the `dashboard-catalog/4` bump.
- **R5.** The `$agents` host source, with privacy rules, a `context` row field and a `session` scope [rev 3].
- **R10.** The `$limits` host source: CLI plan limits per lane and window, as in `ptah_agent_list` "Plan limits",
  plus the read-only host read it needs (Electron only) [rev 3].
- **R6.** The host-built turn summary in the panel as expandable stat cards, plus a per-turn chip in chat.
  - In Electron the chip replaces the in-chat change-set card (decisions.md #5).
  - In Electron, the 610 PR A tests row moves into the Tests card and the chip (decisions.md #10).
- **R7.** Visual polish of the command (Bash) and file (Read, Write, Edit) previews, with full parity, in both
  webviews (decisions.md #8).
- **R9.** Every chip and card is collapsible and responsive at named container-width breakpoints (decisions.md #9).
- **R8.** `PTAH_UI_HINT` and `ptah-surface-authoring` updates, and token measurements.
- The non-functional gates below.

Out of scope:

- **The A2UI v0.9 adapter** (610's former PR E). Parked [user]. It returns as its own task.
- **Agent-written HTML templates** (610 Part 4). Parked [user]. They also conflict with the "no agent HTML" rule
  [project: TASK_2026_490/493/494].
- **The VS Code webview and the TUI** [user, decisions.md #4]. Both keep their current behaviour:
  - A `ptah-ui display` fence renders as an ordinary code block in VS Code. The TUI prints it as raw text.
  - VS Code keeps the change-set card and the footer badges.
  - The exception is the R7 preview polish, which applies to both webviews (decisions.md #8).
- **Any new coding-profile tool**, including a "display" or "panel" tool [user, project: TASK_2026_595]. The agent
  controls the panel only through fences.
- **Partial-update syntax inside a fence** (for example "set one stat"). An update re-sends the whole block [lane].
  Revisit after the R8 measurement shows how often blocks are re-sent.
- **Agent read-back of panel state, inputs, `surface.submit` or selection from display surfaces.** These follow 610
  Req 2.17 [lane]. A fence has no channel back to the host.
- **Trend comparison of the turn summary against earlier turns.** Not requested. The summary shows this turn's values
  only.
- **Persisting panel width or pin state across app restarts.** The monitor panel does not persist either
  (`libs/frontend/chat/src/lib/services/panel-resize.service.ts`).
- **Exposing the `/4` kinds through the Apps-profile `ptah_surface_update` documentation or tooling.** The shared
  validator accepts them, but advertising them to Apps agents is a separate decision (see Risks).
- **Raw class names, DaisyUI component names or style tokens in the grammar or the catalog**
  [project: TASK_2026_594]. DaisyUI is how the renderer is built, not part of the contract.
- **Per-request context reporting for CLI lanes** [rev 3]. No lane adapter reports a per-request context today
  (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:497-501`), so CLI rows show `context` as
  "unavailable" (R5.10). Teaching the adapters to report it is a separate follow-up task [rev 3.1, user,
  decisions.md #16].
- **`$limits` beyond the five list columns** [rev 3]: the `Source` column, the "Alternatives by limit state" section,
  the account plan type, cooldown detail and history or trends. Not requested. They stay in `ptah_agent_list` and the
  dashboard.
- **A `session` scope for `$diff`, `$tests`, `$usage` or `$limits`** [rev 3]. Not requested. `session` is valid
  after `$agents` only (R5.11).

## Requirements

### R1. Display panel (Electron) [user]

**Requirement:** each chat tab in the Electron app has a side display panel, in the style of the agent monitor panel.
The agent fills it through display fences (R2) and the host fills it with the turn summary (R6). The user stays in
control of whether it is visible.

Acceptance criteria:

1. **Per tab.**
   - Each `ChatViewComponent` instance (main panel and canvas tiles) has its own panel state: open or closed, pinned,
     width, and surfaces.
   - When the user switches tabs, the panel shows that tab's state.
   - A surface created in tab A never appears in tab B.
2. **Placement.**
   - When open and the host is at least `AGENT_PANEL_OVERLAY_BREAKPOINT` (600 px) wide, the panel sits beside the
     chat column, like the monitor panel.
   - Below that width it renders as an overlay. At most one overlay (display or agent monitor) is visible at a time.
   - Escape closes the overlay and returns focus to the control that opened it.
3. **Both panels open.** When the display panel and the agent monitor panel are both open, the chat column shall not
   become narrower than the width at which the existing overlay rule would apply. The layout that achieves this is a
   design decision for Gate 1.7.
4. **Open and close.**
   - A toggle control, the same kind as the monitor's sidebar tab, opens and closes the panel.
   - The panel header has a close button.
   - Both controls are reachable by keyboard and have accessible names.
5. **Resize.**
   - A separator between the chat and the panel resizes it by pointer and by keyboard (arrow keys).
   - Double-click or Enter resets the width.
   - The width is clamped to the same minimum (300 px) and maximum (75% of the container) as `PanelResizeService`.
   - The width is kept for the tab's lifetime.
6. **Pin.**
   - When pinned, the panel stays open across turns.
   - A new or updated surface does not change the panel's scroll position or focus.
   - When unpinned, the most recently created or updated surface is scrolled into view.
   - Close is always available. Closing a pinned panel unpins it.
7. **Auto-open.** When a valid display block (R2) closes while its turn is streaming in this tab, and the panel is
   closed, the panel shall open. Auto-open never moves keyboard focus out of the chat input.
8. **User close wins for the turn.**
   - When the user closed the panel during the current turn (user send until the turn reaches a terminal state),
     later display blocks in that turn shall not reopen it.
   - The toggle shows a "new content" indicator conveyed in text or an accessible name, not by colour alone.
   - The next turn may auto-open again.
   - A spec pins this sequence: open, user close, second block in the same turn, still closed; next turn's block opens
     the panel.
9. **No auto-open on replay.**
   - Loading history, reopening a session, remounting a message (610 Req 2.7 permitted remounts) and switching tabs
     never auto-open the panel.
   - They rebuild its contents silently (R2.9).
10. **Turn summary does not auto-open [lane].** The R6 summary updates the panel when it is open. It never opens the
    panel on its own.
11. **In-chat chip.**
    - A valid display block renders in the message, at the fence position, as a compact chip. The chip shows the
      block's title (or "Display" when untitled) and an "Open in display" action.
    - Activating the chip opens the panel and scrolls that surface into view.
    - When a later block with the same id superseded the chip's version, the chip says so ("updated later").
    - Chat history shows the chip only. There is no inline snapshot [user, decisions.md #7].
12. **Surface cap [lane, bound to an existing limit].**
    - The panel holds at most `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId` agent surfaces per tab. Today that
      value is **8** (`libs/shared/src/mcp-apps-contracts/surface-catalog.ts:159`). The implementation reads the
      constant; it does not copy the number.
    - The host-owned turn summary (R6) does not count toward the cap.
    - When a new id would exceed the cap, the least recently created or updated surface leaves the panel. Its chips
      then read "no longer in display" and stay as plain chips.
    - **Boundary specs:**
      - 8 distinct ids → all 8 surfaces are in the panel.
      - A 9th distinct id → 8 surfaces. The least recently updated one is gone and its chip reads "no longer in
        display".
      - A 9th block that reuses an existing id → still 8 surfaces, none removed.
13. **Empty state.** An open panel with no surfaces and no turn summary shows an empty state that explains what
    appears there. It never shows a blank area.
    - **Agents tab [rev 3, user, decisions.md #11].** The dock's Agents tab (design-spec.md section 2) always
      controls an element with `role="tabpanel"`, including when the session has no agents. With no agents, that
      tabpanel shows its own empty state, "No agents in this session". A spec selects the Agents tab in a session
      with no agents and asserts the tabpanel exists, is labelled by the tab, and contains that text.
14. **Electron only [user].** In the VS Code webview, no panel, toggle or chip exists, and a display fence renders as
    an ordinary code block with no reason line.

### R2. `ptah-ui display` fence authoring [user]

**Requirement:** the agent sends a block to the panel by naming the `display` target in the fence info string. It can
give the block an id, and a later block with the same id updates that surface in place.

Acceptance criteria:

1. **Targets.**
   - ```` ```ptah-ui ```` keeps today's behaviour: inline in the message, immutable, live cap 8.
   - ```` ```ptah-ui display ```` and ```` ```ptah-ui display <id> ```` target the panel.
   - Both use the same body grammar (R3, R4).
   - The opener grammar is the delta in R3. Any other info string beginning `ptah-ui` (for example
     `ptah-ui sidebar`, or `ptah-ui display a b`) is an ordinary code block, as today.
2. **No id.** Each valid display block without an id creates a new panel surface.
3. **Repeated id updates in place.**
   - When a valid display block names an id that already exists in this tab's panel, that surface's content shall
     become the new block's content.
   - The rendered result shall equal what a fresh render of the new block alone produces.
4. **Update maps onto existing ops [user].**
   - The update shall be expressed as `replace` semantics or `SurfacePatchOp`s from the existing contract
     (`libs/shared/src/mcp-apps-contracts/surface.types.ts:181-218`).
   - No new patch op kind and no new update operation are added.
   - A component whose converted form is unchanged between versions keeps its view state, for example an expanded
     accordion or stat, or a table's sort and page. A spec updates a block in which one stat changes and asserts that
     an expanded accordion elsewhere stays expanded.
5. **Ids are scoped to the tab's session.**
   - The same id in another tab is a different surface.
   - Host-owned panel content (R6) uses ids an agent block cannot name. A display block that tries is invalid and
     falls back with a reason.
6. **Invalid block, atomic [project: TASK_2026_490/494, 610 Req 2.3-2.5].**
   - When any part of a display block is invalid (grammar, sources, caps, or validator), the block renders in the
     message as an ordinary code block with 610's muted reason line.
   - The panel is unchanged: an existing surface with that id keeps its previous content.
   - Nothing about the failure is sent to the agent.
7. **Streaming [user].**
   - While a display fence is open, the message shows a plain code block or a lightweight placeholder, and the panel
     is not touched.
   - When the closing fence arrives, the update applies without waiting for the turn end.
   - When the turn ends with the fence unclosed, it stays a code block and the panel is unchanged.
8. **Order.** Within one message and across messages, display blocks apply in transcript order: message order, then
   text-node order, then fence ordinal. A later block with the same id always wins.
9. **Reload and remount.**
   - On session reopen or history load, the panel is rebuilt by applying the tab's stored display blocks in R2.8
     order.
   - Sources re-resolve for each block's own turn (610 Req 3.7).
   - The rebuilt panel equals the panel before reload for turns in a terminal state.
   - No block is re-instantiated by later streaming text (610 Req 2.7 identity rules apply to the chip).
10. **Copy and storage.** Message copy, code-block copy and the stored message text contain the raw fence only. The
    same holds for the R5 and 610 Req 5.12 sentinel fixtures.
11. **Rendering scope.** As in 610 Req 2.10, display fences take effect only in top-level coding-chat assistant text.
    In user messages, subagent transcripts, thinking blocks and every other `ptah-markdown-block` consumer they are
    ordinary code blocks.
12. **View actions only.** Display surfaces allow only local view actions: expand and collapse, and sort, filter and
    page within a table (610 Req 2.17).

### R3. Layout grammar extension [user]

**Requirement:** a block can arrange atoms in rows, columns, grids, cards, sections and accordions, nested, using the
610 line grammar with indentation. Containers use semantic keywords only [project: TASK_2026_594].

#### EBNF delta (normative) [lane]

This is a delta against `TASK_2026_610_6a10/task-description.md` "Grammar (normative)". Every 610 production not
listed here is unchanged. 610's single fixed indent `IND` becomes a depth-relative indent. The architect may change
spellings only through a Gate 2 amendment to this section.

```text
(* --- opener (replaces 610 `fence`) --- *)
fence      = opener NL body "```" ;
opener     = "```ptah-ui" [ SP "display" [ SP surfaceid ] ] ;   (* after trailing-space removal; exactly one SP between parts *)
surfaceid  = idstart { idchar } ;                               (* SURFACE_ID_PATTERN; length 1..SURFACE_LIMITS.maxSurfaceIdLength *)
idstart    = letter | digit ;
idchar     = letter | digit | "." | "_" | "-" ;

(* --- body and nesting (replaces 610 `body`, `element`) --- *)
body       = { blank } [ title { blank } ] item(0) { { blank } item(0) } { blank } ;
item(d)    = container(d) | element(d) ;
container(d) = IND(d) ckw NL item(d+1) { { blank } item(d+1) } ;   (* at least one child *)
ckw        = "row"
           | "col"
           | "grid" SPS gridcols                                  (* "1" .. "4" = 1..SURFACE_LIMITS.maxGridColumns *)
           | "card" [ SPS text ]
           | "section" SPS text
           | "accordion" SPS text ;                               (* collapsed by default *)
element(d) = stats(d) | table(d) | list(d) | chart(d) | note(d)
           | progress(d) | badge(d) | avatar(d) ;
IND(d)     = d * ( SP SP ) ;                                      (* exactly 2*d spaces, then a non-space; IND(0) is column 0 *)

(* --- 610 elements re-based on depth: header at IND(d), body lines at IND(d+1) --- *)
stats(d)   = IND(d) "stats" NL statline(d+1) { statline(d+1) } ;           (* 1..8 statlines *)
statline(e)= IND(e) cell BAR value [ BAR trend [ BAR spark ] ] NL ;        (* 2, 3 or 4 cells *)
trend      = [ ( "+" | "-" ) udecimal [ "%" ] [ SPS polarity ] ] ;         (* empty allowed only when spark follows *)
polarity   = "good" | "bad" ;
spark      = number SPS number { SPS number } ;                            (* >= 2 points *)
table(d)   = IND(d) "table" NL tablerow(d+1) tablerow(d+1) { tablerow(d+1) }
           | IND(d) "table" SPS rowsource NL [ colsline(d+1) ] ;
list(d)    = IND(d) "list" NL item_(d+1) { item_(d+1) }
           | IND(d) "list" SPS rowsource NL ;
chart(d)   = IND(d) "chart" SPS ( "line" | "bar" ) SPS text NL point(d+1) { point(d+1) } ;
(* tablerow, colsline, item_ (610 `item`) and point: 610 productions with IND replaced by IND(e) *)

(* --- source references (replaces 610 `rowsource`, `scalar`) [rev 3] --- *)
rowsource  = "$" name [ SPS "session" ] ;            (* "session" only after "$agents" (R5.11) *)
scalar     = "$" name [ ".session" ] "." name ;      (* ".session" only after "$agents" (R5.11) *)
(* known source names: diff tests usage agents limits (R5, R10) *)

(* --- new atoms (single line, no body) --- *)
note(d)     = IND(d) "note" SPS ntone SPS text NL ;              (* 610 PR D, unchanged spelling *)
ntone       = "info" | "ok" | "warn" | "error" ;
progress(d) = IND(d) "progress" SPS cell BAR pct [ BAR tone ] NL ; (* label non-empty *)
pct         = udecimal ;                                         (* 0 <= value <= 100 *)
badge(d)    = IND(d) "badge" SPS tone SPS text NL ;
avatar(d)   = IND(d) "avatar" SPS cell [ BAR cell ] NL ;         (* name non-empty, optional subtitle *)
tone        = "neutral" | ntone ;

udecimal   = digit { digit } [ "." digit { digit } ] ;
letter     = "a" .. "z" | "A" .. "Z" ;
```

Lexical delta (adds to 610's lexical table):

| Item | Rule |
| ---- | ---- |
| New keywords | `row col grid card section accordion progress badge avatar note display good bad neutral info ok warn error`. They are lowercase and exact. An unknown header word at any depth makes the block invalid. |
| Indentation | A line's depth is its leading spaces divided by 2. An odd count, or a depth greater than the parent's depth + 1, is invalid. A line at depth ≤ d ends the container at depth d. |
| Element bodies | Body lines of `stats`, `table`, `list` and `chart` sit exactly one level deeper than their header. That reproduces 610's two-space body at depth 0, so every valid 610 block stays valid with identical output. |
| `title` | At most one, depth 0 only, first element (as in 610). |
| Pipes | Unchanged from 610 `BAR` and `escape`. In `progress` and `avatar` lines and in statlines, an unescaped pipe (U+007C with no backslash before it) separates cells. The two-character escape backslash-pipe stays the literal-pipe escape and decodes to one literal pipe inside a cell. In `badge`, `note`, `card`, `section` and `accordion` text, an unescaped pipe is literal (the 610 text rule) and backslash-pipe also decodes to a literal pipe. |
| Scope keyword [rev 3] | `session` is lowercase and exact. It is valid only in `$agents session` (row source) and `$agents.session.<scalar>`. After any other source name, in any other position, or misspelt, the block is invalid. |
| Sources | A scalar is valid only as a statline `value`. A row source is valid only as a `table` or `list` argument (610 rule). `trend`, `spark`, `pct`, `avatar` and `badge` are literal only. |
| Empty container | A container with no child item is invalid. |
| Numbers | `spark` points use 610 `number`. `pct` and `trend` use `udecimal`, with no exponent, thousands separator or unit other than the trailing `%` on a trend. |

Acceptance criteria:

1. **Backward compatibility.** Every case in the existing `libs/shared/src/mcp-apps-contracts/ptah-ui.corpus.ts` and the parser and converter specs
   parses and converts to a deep-equal envelope at this task's head. The one exception is the `catalogVersion`
   literal if the architect bumps it.
2. **Container mapping.**

   | Fence | Catalog kind |
   | ----- | ------------ |
   | `row` | `stack` with `direction: 'horizontal'` |
   | `col` | `stack` with `direction: 'vertical'` |
   | `grid N` | `grid` with `columns: N` |
   | `card [t]` | `card` with title `t` |
   | `section t` | `section` with title `t` |
   | `accordion t` | the R4 collapsible kind |

   A fixture per container pairs the fence with its expected envelope.
3. **Nesting limits reuse catalog budgets.** A block is invalid, and falls back with a reason naming the limit, when
   after conversion it exceeds any of these:
   - `SURFACE_LIMITS.maxTreeDepth` (8)
   - `maxChildrenPerNode` (50)
   - `maxComponents` (200)
   - `maxGridColumns` (4)
   - 610's body caps (8,192 bytes, 200 lines)

   Fixtures cover each limit at exactly the limit (valid) and one over (invalid).
4. **Parser fixtures.** At minimum, one valid and one invalid case for each lexical-delta row, plus:
   - a three-space indent
   - a depth jump of two
   - an empty `row`
   - `grid 0` and `grid 5`
   - a `title` inside a container
   - a scalar as a `progress` value
   - `pct` 100.0 (valid) and 100.1 (invalid)
   - a trend with no spark and an empty trend with a spark
   - a one-point spark (invalid)
   - CRLF line endings at depth 2
5. **Responsive by container width.**
   - Rendered in the panel or inline, `grid` and `row` adapt to the width of their container, not the viewport.
   - At the 300 px minimum panel width, every grid shows one column and nothing overflows horizontally.
   - A spec renders the same surface in a 300 px and a 900 px container inside the same viewport and asserts a
     different column count.

### R4. Atoms and `dashboard-catalog/4` [user]

**Requirement:** the atoms the reference screenshots use are available as semantic catalog kinds, rendered by
`declarative-dashboard` in the app's DaisyUI theme.

Mapping:

| Fence atom | Catalog | Status |
| ---------- | ------- | ------ |
| `note <tone> text` | `alert` (`info`→`info`, `ok`→`success`, `warn`→`warning`, `error`→`error`) | existing `/3` kind (folds 610 PR D) |
| `badge <tone> text` | `badge` (`neutral`, `info`, `ok`→`success`, `warn`→`warning`, `error`) | existing `/3` kind |
| `progress` (label, pct, optional tone; cells separated by unescaped pipes) | `progress` (`value`, `label`, `tone` default `neutral`) | existing `/3` kind |
| statline `trend` | `stat` gains a trend (value, `%` flag, optional polarity), not the bare `delta` number | **new field, `/4`** |
| statline `spark` | `stat` gains sparkline points | **new field, `/4`** |
| `avatar` (name, optional subtitle; cells separated by unescaped pipes) | new `avatar` display kind | **new kind, `/4`** |
| `accordion t` | new collapsible container (a new layout kind or a `collapsible` field on `card`; the architect decides) | **new, `/4`** |

Acceptance criteria:

1. **Catalog bump.** The contract moves to `dashboard-catalog/4` with the four `/4` items above.
   - `SURFACE_SUPPORTED_CATALOG_VERSIONS` accepts both `/3` and `/4`.
   - Every existing `/3` contract, budget and trust spec passes unchanged.
   - `dashboard-spec/1` and `/2` keep rendering on the Apps page [project: TASK_2026_594].
2. **Semantic only [project: TASK_2026_594].**
   - No new schema field accepts a class name, colour value, CSS, icon name or URL.
   - Tones and polarity are closed enums.
   - A trust spec asserts that a `class`, `style` or `url` field on each new kind is rejected.
3. **Trend pill.**
   - A stat with a trend renders a pill whose direction is conveyed by an arrow glyph and text ("up 4.2%"), never by
     colour alone.
   - `good` and `bad` select the success or error tone. With no polarity the tone is neutral.
4. **Sparkline.**
   - A stat with spark points renders an inline bar sparkline through the renderer's own chart code. No third-party
     HTML is used [project: TASK_2026_490 Rev 4 C].
   - It has a text alternative that lists the points.
   - Points count toward `maxSeriesPoints`.
   - **Highlight colour [rev 3, user, decisions.md #12].** The highlighted (latest) bar uses the theme `primary`
     colour in both the dark and the light theme, not `secondary` (gold). A failing series keeps the error fill
     (design-spec.md decision 7, highlight colour amended). A spec or visual-review screenshot shows it in both
     themes.
5. **Avatar.**
   - Initials are derived from the name, with a deterministic theme tone.
   - There is no image, no URL and no network request [project: TASK_2026_490/493/494].
   - The name is readable text, and the subtitle is plain text.
6. **Accordion.**
   - Collapsed by default.
   - The header is a button with `aria-expanded` and `aria-controls`.
   - Escape collapses and returns focus. This is the existing stat and chart expand pattern
     (`libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.ts:61`).
   - Collapsed children are not tab stops.
7. **Plain text.** Every new text field renders literally (610 Req 2.8).
8. **Inline parity.** The new atoms and containers render the same in an inline `ptah-ui` block and in the panel,
   apart from available width.

### R5. `$agents` host source [user]

**Requirement:** a block lists the session's subagents and their usage by naming `$agents`. The agent never types
names, counts or costs, and no agent prompt or output ever reaches the surface. A block can also show each agent's
last-request context and list every agent of the session, not only the turn's [rev 3, user, decisions.md #14]. The
user's example: "show list of cli tools with the usage and context stats".

| Source | Scalars | Rows (columns) | Backed by |
| ------ | ------- | -------------- | --------- |
| `$agents` | `total`, `running`, `completed`, `failed` int; `tokens` int; `cost` USD or unavailable | `name`, `status`, `tokens`, `cost`, `duration`, `context` [rev 3] | Foreground subagent `ExecutionNode`s of the block's turn (`libs/shared/src/lib/types/execution/node.ts:158,171-199`), plus `SubagentRecord` and `MonitoredAgent` records whose parent session is this tab's session and that started in the block's turn (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:389,526-581,856`) |
| `$agents session` [rev 3] | same as `$agents` | same as `$agents` | The same records, for every turn of the tab's session up to and including the block's turn (R5.11) |

There is no `context` scalar [rev 3]: a sum of per-agent last-request contexts has no meaning.

**`context` value (normative) [rev 3, user, decisions.md #14].**

- **Tokens.** The agent's last-request context tokens:
  - from R: `subagentUsageView(R).contextTokens`, which is `R.usage.lastRequestContextTokens`
    (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:134,290-300,345-362`). The backend
    `contextTokens` figure wins over the local input + cache sum (same file `:116,290-294`).
  - from M: `M.contextTokens` (same file `:501`). It is `undefined` for every CLI lane today (same file `:497-500`),
    so CLI rows read "unavailable".
  - N carries no per-request context (`libs/shared/src/lib/types/execution/node.ts:194-200`). An N-only row reads
    "unavailable".
- **Window percent, only when the limit is known.** The limit is known only when the session has capacity
  evidence for that agent's exact model id (R: `R.usage.model`, same store file `:136`) whose `source` is
  `sdk-native`, or `provider-catalog` with a non-empty `providerId`, and whose `tokens` is a positive finite number.
  This is the rule the header context badge already applies (`libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.ts:78-89`)
  to `ContextCapacity` (`libs/shared/src/lib/utils/pricing.utils.ts:444-449,514-540`), which the per-model usage
  carries (`libs/shared/src/lib/types/agent-adapter.types.ts:65-74`). The percent is
  `round(tokens / limit × 1000) / 10`, as in `session-live-stats.util.ts:98-101`.
- **Never guessed.** `getModelContextWindow` (`libs/shared/src/lib/utils/pricing.utils.ts:542-560`), which falls back
  to pricing `maxTokens` and model-family patterns, is not a source of the limit. With no capacity evidence the cell
  shows the token count without a percent. With no token count the cell shows "unavailable", never 0 and never a
  percent.

**Union key and merge rule (normative) [lane].** One logical agent is one row.

- **SDK subagents.** An `ExecutionNode` of type `agent` (N) and a `SubagentRecord` (R) can describe the same
  subagent. Their key is chosen in this order:
  1. When N has a `toolCallId`: the key is `sdk:` + `N.toolCallId`. N and R merge when
     `N.toolCallId === R.parentToolUseId` (`libs/shared/src/lib/types/execution/node.ts:158`,
     `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:528`).
  2. When N has no `toolCallId` but has an `agentId`: N merges with the R whose `agentId` equals `N.agentId`
     (`libs/shared/src/lib/types/execution/node.ts:183`,
     `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:540`). The key is then `sdk:` + `R.parentToolUseId`.
  3. When N has neither, or no R matches, N is its own row under the key `sdk-node:` + `N.id`.
  4. An R that no N matched is its own row under the key `sdk:` + `R.parentToolUseId`.
  5. When two candidates would merge into one R, the first in execution-tree order merges and the rest stay
     separate under rule 3.
- **CLI lanes.** A `MonitoredAgent` (M) has the key `cli:` + `M.agentId`. It never merges with N or R.
- **Field precedence for a merged N+R row:**
  - `status` comes from R while R is non-terminal, otherwise from N.
  - `tokens`, `cost` and `duration` come from N when N has the value (it is persisted with the turn), otherwise from
    R (`usage` input + output, `usage.estimatedCostUsd`, `durationMs`).
  - `name` comes from R `teammateName`, then R `agentType`, then N `agentType`.
  - `context` comes from R only (N has none) [rev 3].
- **Aggregates.** Each scalar is computed over the merged rows only:
  - `total`, `running`, `completed`, `failed`
  - `tokens` = sum of row tokens
  - `cost` = sum of row costs, or unavailable per R5.3

Acceptance criteria:

1. **Allowed fields only [user].** Each row exposes exactly `name`, `status`, `tokens`, `cost`, `duration`,
   `context` [rev 3].
   - `name` is `teammateName`, `agentType`, `displayName` or the CLI name. It is never `task`, `description`,
     `agentPrompt` or `latestSummary`.
   - A spec seeds records whose `task`, `description`, `agentPrompt`, `latestSummary`, `stdout`, `stderr`,
     `errorMessage` and `outputFile` contain a sentinel. It asserts the sentinel appears in no resolved value, no
     rendered DOM text and no accessible name.
2. **Status vocabulary.** Store statuses normalise to `pending`, `running`, `completed`, `failed` and `stopped`
   (`killed` and `timeout` → `stopped`; `paused` and `background` → `running`). The mapping is pinned by a spec.
3. **Unavailable, never zero.**
   - A `null` or missing cost renders "unavailable", never `$0`. The same holds for missing tokens and for duration
     while running.
   - `cost` (scalar) is unavailable when any row's cost is unavailable.
   - The other 610 Req 3.4 unavailable and pending rules apply.
4. **Live values.** For a block in the live window, values bound to `$agents` update in place while agents run, and
   settle when each agent reaches a terminal status, without re-instantiating the block (610 Req 3.2).
5. **Turn scope.** A block shows only agents started in its own turn. A block in turn N never shows turn N+1's
   agents. The one exception is `$agents session` (R5.11) [rev 3].
6. **Reload [lane, same rule as 610 Req 3.10].**
   - Rows backed by the stored execution tree rebuild on reload.
   - Rows backed only by in-memory store records ship only if the architect shows they are restorable per turn.
   - Otherwise, after reload, those values render "unavailable". They are never guessed and never filled from another
     turn.
7. **Grammar.** `$agents` is a known source name: valid in `stats` values (`$agents.<scalar>`) and as a `table` or
   `list` row source. `list $agents` lists `name`. The session forms are `$agents.session.<scalar>` and
   `table $agents session` / `list $agents session` (R5.11) [rev 3].
8. **No write-back.** The 610 Req 5.12 fixture extends to `$agents`: a sentinel agent name and the cost `0.623623`
   appear in no stored message text, no `ChatContinueParams` and no SDK query input.
9. **One row per agent (merge fixtures).** A resolver spec covers each case below and asserts both the row count and
   the scalars:
   - **(a) Same tool-use id.** N (`toolCallId: 't1'`, 1,000 tokens, cost 0.10) plus R (`parentToolUseId: 't1'`,
     running) → 1 row. `total` = 1, `tokens` = 1,000, `cost` = 0.10. Status comes from R while R is running.
   - **(b) Same agent id, no tool-use id.** N (no `toolCallId`, `agentId: 'a1'`) plus R (`agentId: 'a1'`) → 1 row.
   - **(c) No identity.** N with neither id plus an unrelated R → 2 rows, and `tokens` is the sum of both.
   - **(d) Record only.** R only (a background subagent with no node) → 1 row with values from R.
   - **(e) CLI lane.** M plus an N whose ids equal `M.agentId` → 2 rows. CLI rows never merge.
   - **(f) Duplicate candidates.** Two N with the same `agentId` and one R → the first N merges, the second is its
     own row.
   - In every case `total` equals the row count, and no agent's tokens or cost is counted twice.
10. **`context` field [rev 3, user, decisions.md #14].**
    - When a row has context tokens and a known limit (the "`context` value" rule above), the cell shall show the
      token count and the window percent with a `%` sign, both as text.
    - When a row has context tokens and no known limit, the cell shall show the token count only, with no percent,
      no "?%" and no "0%".
    - When a row has no context tokens, the cell shall show "unavailable", never 0.
    - The cell's accessible name states both parts in words (for example "50,000 context tokens, 25 percent of the
      context window").
    - Sorting a table by `context` orders by the token count; "unavailable" rows sort after known ones.
    - The R5.1 sentinel spec extends to `context`: no prompt or output text reaches it.
    - Live and settled updates follow R5.4. Reload follows R5.6: R and M context values are in-memory only, so after
      reload they render "unavailable" unless the architect shows they are restorable per turn.
11. **Session scope [rev 3, user, decisions.md #14].**
    - **Grammar.** The `rowsource` and `scalar` productions and the "Scope keyword" row of the R3 EBNF and lexical
      delta: `table $agents session`, `list $agents session`, `$agents.session.<scalar>`.
    - `$agents` stays turn-scoped (R5.5). `$agents session` shall list every agent of the tab's session that
      started in the block's turn or any earlier turn of that session. It never shows agents of a later turn, so a
      reloaded panel equals the panel before reload (R2.9).
    - The union key, merge rule and field precedence above apply unchanged across turns. An agent appears once,
      whatever turn it started in.
    - Scalars (`$agents.session.<scalar>`) are computed over all rows in that scope, including rows not displayed
      because of the row cap.
    - **Ordering.** Rows are ordered by turn (transcript order), then by start time within the turn (N `startTime`,
      `libs/shared/src/lib/types/execution/node.ts:191`; M `startedAt`,
      `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:394`; R its recorded start), then by row key.
      Rows with an unknown start time come last within their turn, ordered by key. The same order applies to
      `$agents`.
    - **Row cap [bound to an existing limit].** A table or list shows at most `SURFACE_LIMITS.maxTableRows` rows
      (`libs/shared/src/mcp-apps-contracts/surface-catalog.ts:118`, today 1,000). The implementation reads the
      constant. Omitted rows are announced as "+N more", as `$diff` and `$tests` do today
      (`libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.ts:220-251`). The first rows in the order above are kept.
    - **Live.** For a block in the live window, rows and values for agents of the block's turn update per R5.4;
      rows of earlier turns show their settled values.
    - **Reload.** Rows backed by the stored execution tree rebuild for every turn in scope. Rows backed only by
      in-memory records follow R5.6. CLI cards rebuilt from history carry `usageTotals: null`
      (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:469-472,491-496`), so their tokens and cost
      render "unavailable", never 0.
12. **`context` fixtures [rev 3].** A resolver spec covers each case and asserts the resolved value and the rendered
    text:
    - (a) R with `lastRequestContextTokens` 50,000, model `m`, and capacity evidence for `m` with source `sdk-native`
      and 200,000 tokens → "50,000" and "25%".
    - (b) As (a), but the capacity source is `unknown` → "50,000" and no percent.
    - (c) As (a), but the source is `provider-catalog` with a null `providerId` → no percent.
    - (d) As (a), but the evidence names a different model id → no percent.
    - (e) A model id for which `getModelContextWindow` returns a positive number but no capacity evidence exists →
      no percent.
    - (f) R whose last request reported neither `contextTokens` nor both cache fields → "unavailable".
    - (g) M (CLI lane) → "unavailable".
    - (h) N only → "unavailable". N merged with R from (a) → the R value.
13. **Session-scope fixtures [rev 3].** A resolver spec over three turns (agents A in turn 1, B and C in turn 2, D in
    turn 3) covers:
    - `$agents session` in turn 2 → rows A, B, C in that order, `total` = 3. D is absent.
    - `$agents` in turn 2 → rows B, C, `total` = 2.
    - An N and an R in turn 2 that merge by `toolCallId` → one row in session scope, not two.
    - `maxTableRows` + 1 agents in scope → `maxTableRows` rows, a "+1 more" note, and `total` = `maxTableRows` + 1.
    - Reload of the three turns → the turn-2 block's rows and scalars equal the values before reload for every
      field backed by the stored execution tree, and the others read "unavailable".
    - `$diff session`, `$limits session` and `$agents sessions` are invalid and fall back with a reason.

### R6. Turn summary in the panel [user]

**Requirement:** at the end of each turn that changed files or ran tests, the user can open a host-built summary of
that turn in the panel, as expandable stat cards. It costs no model tokens.

- In Electron, a per-turn chip replaces the in-chat change-set card [user, decisions.md #5].
- The 610 PR A tests row moves into the Tests card and the chip [user, decisions.md #10] (R6.10).
- VS Code is unchanged.

Acceptance criteria:

1. **Cards.** The summary for a turn shows these stat cards, with the same values the `$diff`, `$tests` and `$usage`
   sources resolve for that turn (`libs/shared/src/lib/utils/turn-sources.utils.ts:118`):

   | Card | Value | Expands to |
   | ---- | ----- | ---------- |
   | Files | count | the file list with status, rename origin, per-file +/−, binary, and open-file and review actions |
   | Lines | +A / −D | (none) |
   | Tokens | input and output | (none) |
   | Cost | USD or "unavailable" | (none) |
   | Duration | elapsed | (none) |
   | Tests | passed, failed, running, unknown | each run: outcome, project or command, full command, failure lines |

2. **Parity.** Every capability in `parity-inventory.md` marked `move` is present in the summary, and its listed test
   passes.
3. **States carry through.**
   - `countsUnavailable` → "counts unavailable"
   - `baselineMissing` → "may include changes made before this turn"
   - `truncatedCount` → "+N more files not listed"
   - null per-file counts → "?"
   - binary → "binary"
   - conflicted and reconciled marks as in the card today
   - aborted or errored turn → "incomplete"
   - a background test run → "running"
4. **Nothing to report.**
   - A turn that changed no files and ran no test command gets no chip and no summary.
   - Within a summary, a Files or Tests card with nothing to show is omitted, not shown as zero.
5. **Chip in chat.**
   - At the end of a qualifying turn, a compact chip below the turn-ending message summarises the turn (for example
     "3 files · +42 −7 · 2 tests passed").
   - Activating it opens the panel at that turn's summary.
   - **Electron [user, decisions.md #5]:** the chip replaces the change-set card at the same position, and
     `chat-transcript.component.html` mounts no `ptah-change-set-card`.
   - **VS Code:** the change-set card stays exactly as today, and there is no chip.
   - Specs assert both runtimes.
6. **Which turn.**
   - The panel shows the latest completed turn's summary by default.
   - Opening an older turn's chip shows that turn's summary.
   - The summary of a reloaded turn is rebuilt from persisted change sets and the stored execution tree (610 Req 1.8).
7. **Built at turn end.**
   - The summary is built when the turn reaches a terminal state, never during streaming (610 Req 5.8).
   - No model or tool call is made to build it. The 610 Req 5.12 sentinel fixture extends to the summary.
8. **Actions.**
   - Open file and Review behave exactly as the change-set card's do today, through `ChangeSetActionsService`
     (`libs/frontend/chat/src/lib/services/change-set/change-set-actions.service.ts:69-125`).
   - Their failures show the same inline error text as today
     (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html:84-100`), inside the
     Files card.
9. **One file listing per turn [project: 610 Req 1.12].**
   - In Electron, a turn's changed files are listed by exactly one host-built component: the panel's Files card.
   - The chip shows totals only, never a file list.
   - A `$diff` block remains exempt.
10. **Tests row moves to the panel (Electron) [user, decisions.md #10].**
    - In Electron, `chat-transcript.component.html` no longer mounts `ptah-turn-tests-row` (today at L107-118).
    - Every tests-row capability is in the Tests card (parity-inventory.md section 1, all `move`).
    - The turn chip's text includes the test outcome (for example "2 tests passed").
    - VS Code keeps its current behaviour. Today `turnTestsAnchors` is Electron-only and returns no anchors in VS Code
      (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:589-597`), so VS
      Code renders no tests row before or after this task.
    - A transcript spec asserts both runtimes: no `chat-turn-tests` element in Electron, and VS Code output unchanged.

### R7. Command and file preview polish [user]

**Requirement:** Bash, Read, Write and Edit previews in the execution tree use the same visual language as the panel
(R1, R4). They keep every current capability.

Acceptance criteria:

1. **Parity.** Every capability in `parity-inventory.md` for these components is `keep`. Its listed test passes, and
   the header gains the spec it lacks today.
2. **Command preview.**
   - When a Bash node is expanded, the full command text is visible (wrapped, monospace), not only the description
     or the 40-character form.
   - A copy action copies the exact command.
3. **Command outcome.**
   - A completed Bash node shows its outcome as text ("succeeded" or "failed") plus an icon. A running node shows
     "running".
   - The status icons gain accessible names. Today
     `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts:123-145` uses icons
     without labels.
4. **Command output.**
   - Output keeps ANSI stripping and the retention notice.
   - It is height-limited with an "expand" control that shows the full retained output.
   - A copy action copies the output text.
5. **File preview header.**
   - Read, Write and Edit show the file name prominently and the directory muted.
   - The path keeps its open action (`FILE_LINK_OPENER`; Electron dock viewer, VS Code `file:open`).
   - A language label is shown.
6. **Edit diff.**
   - The diff shows removed and added lines with a `−` or `+` gutter, so the change is readable without colour.
   - The header shows the removed and added line counts and the replacements count.
7. **Write preview.** Write content shows as a highlighted, height-limited preview with expand, without the 60-character
   parameter truncation.
8. **Visual conformance (bound to the Gate 1.7 approved visual spec).**
   - The visual-review report contains screenshots of the Bash, Read, Write and Edit previews, collapsed and expanded,
     in the dark and the light theme, at each R9 chat breakpoint.
   - Each screenshot is checked item by item against the Gate 1.7 approved visual specification (tokens, spacing,
     type sizes, colours named there). Every mismatch is listed as a defect.
   - The axe NFR also applies.
9. **Collapsed-row height baseline.**
   - Before any R7 change, the visual review records the rendered height in px of a collapsed tool-call row (Bash,
     Read, Write, Edit) in each theme on `main` at the merge base.
   - After the change, each collapsed row's height is at most that baseline, or at most the height the Gate 1.7 spec
     states, if it states one.
10. **Runtime [user, decisions.md #8].**
    - R7 applies in both the Electron and the VS Code webviews.
    - The parity specs and the R7.8 screenshots cover both hosts.
    - The VS Code file-open path (`file:open`) and the Electron dock viewer both keep working (parity-inventory.md
      section 4).

### R8. Hint, skill and authoring cost [user]

**Requirement:** the agent learns about display fences, layouts, the new atoms, `$agents` (with `context` and the
`session` scope) and `$limits` [rev 3] without a larger default prompt, and the fence stays cheaper than the markdown
it replaces.

Acceptance criteria:

1. **Hint budget [user, 610 Req 5.11].**
   - The updated `PTAH_UI_HINT` names the `display` target and the id-update rule, adds `$agents`, and points to the
     skill.
   - **[rev 3]** The hint lists `$limits` beside the other source names, because today's hint already enumerates
     the sources (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:5`) and an unlisted source would
     look unsupported. The hint does not name the `session` scope, the `context` field or any row field; those are
     in the skill only (R8.3).
   - **[rev 3]** If the measured hint exceeds 100 tokens, `$limits` leaves the hint first (skill only), and
     `measurement.md` records the omitted text and both counts. The display target, the id-update rule and `$agents`
     are never dropped.
   - It stays at most 100 tokens.
   - Its exact text, characters and count are recorded in `measurement.md`, and pinned by
     `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts`.
   - Its gating (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1776-1779`) is unchanged.
2. **No other prompt text.** The default system prompt contains no other `ptah-ui`, layout or catalog text.
3. **Skill.** `ptah-surface-authoring` gains:
   - in `references/ptah-ui.md`: the R3 EBNF delta, the lexical delta, display-target and id rules, `$agents`, and
     worked examples. The examples include a subagent-usage dashboard (`grid` of `stats` with `$agents` scalars and
     `table $agents`) and an id update.
   - **[rev 3]** in `references/ptah-ui.md`: the `context` field and its "unavailable" and no-percent rules, the
     `session` scope (`table $agents session`, `$agents.session.<scalar>`) with the turn-scope exception, and
     `$limits` with its columns, scalars and "as of" time (R10). One worked example is the user's request, "a list of
     CLI tools with the usage and context stats": a `table $agents session` with `cols name | status | tokens |
     context` beside a `table $limits`.
   - **[rev 3]** a "Common mistakes" entry for `session` after a source other than `$agents`.
   - in `references/catalog.md`: the `/4` kinds.

   Every worked example is a corpus case that the parser spec validates.
4. **Corpus and compactness [lane, 610 Req 5.13 method].**
   - The corpus gains one case per new container and atom, and one mixed nested case.
   - A spec computes the fence and the canonical JSON `gpt-tokenizer` counts, asserts the fence is smaller, and
     records them.
5. **Fence vs markdown for subagent usage [user].** A fixture holds two items for five agents with name, status,
   tokens, cost and duration:
   - (a) the display fence using `$agents`
   - (b) the equivalent GitHub-markdown table with the values typed out

   A spec asserts that (a) is smaller in `gpt-tokenizer` tokens than (b) and records both counts. No ratio target is
   set.

### R9. Collapsible and responsive chips and cards [user, decisions.md #9]

**Requirement:** every chip and card this task adds or restyles can be collapsed and expanded, and renders properly at
small and large widths in both the chat and the panel.

Covered components ("R9 components"):

- the display chip (R1.11)
- the turn-summary chip (R6.5)
- display cards in the panel: `card`, `section` and `accordion` surfaces, and stat cards (R3, R4)
- the turn-summary stat cards (R6)
- the command and file preview cards (R7)

**Named breakpoints [lane].** These are test widths of the component's container, not the viewport. They come from
existing limits and the Gate 1.7 spec may refine them.

| Name | Container | Width | Source |
| ---- | --------- | ----- | ------ |
| `chat-narrow` | chat column | 360 px | below the 600 px overlay host width (`AGENT_PANEL_OVERLAY_BREAKPOINT`), where the chat takes the full host width |
| `chat-wide` | chat column | 1024 px | a 1280 px host with the 300 px minimum panel beside it, rounded down |
| `panel-narrow` | display panel | 300 px | `PanelResizeService` minimum width |
| `panel-wide` | display panel | 960 px | 75% of a 1280 px host (`PanelResizeService` maximum ratio) |

Chips and preview cards are checked at `chat-narrow` and `chat-wide`. Panel and summary cards are checked at
`panel-narrow` and `panel-wide`. Inline `ptah-ui` blocks are checked at both chat breakpoints.

Acceptance criteria:

1. **Collapsible.**
   - Each R9 component has a toggle: a button with `aria-expanded` and `aria-controls`, operable with Enter and Space.
   - Escape collapses an expanded component and returns focus to its toggle.
2. **Collapsed state.**
   - A chip shows one line: icon, title and its totals.
   - A card shows its header and primary value only.
   - Content hidden by collapsing is not a tab stop and is not read as visible content.
3. **Expanded state.**
   - A chip shows its details wrapped on several lines:
     - turn chip: Files, Lines, Tokens, Cost, Duration and Tests values
     - display chip: title, description and the "updated later" or "no longer in display" state
   - A card shows its full content.
4. **Default states.**
   - Chips start collapsed.
   - Summary stat cards and preview cards start collapsed, except where parity requires otherwise: a change-set
     conflict forces Files open, and a pending permission forces a tool card open.
   - Agent `accordion` surfaces start collapsed (R4.6).
   - Expansion state survives an in-place id update (R2.4).
5. **No overflow at any breakpoint.** At each applicable named breakpoint, in both the collapsed and the expanded
   state, and in both the dark and the light theme:
   - the component root's `scrollWidth` ≤ `clientWidth`, so there is no horizontal scroll
   - no text is clipped: long paths, commands and names wrap, or truncate with the full text available as the
     element's accessible name and title
   - code (command text, output, diffs) wraps instead of scrolling horizontally

   The visual review runs a script that asserts the width check for every R9 component, and attaches one screenshot
   per component, state, breakpoint and theme.
6. **Layout adapts.**
   - At `panel-narrow`, summary stat cards and agent grids stack in one column.
   - At `panel-wide`, summary stat cards sit in at least two columns.
   - At `chat-narrow`, the turn chip's totals wrap under the title instead of truncating the numbers.
   - Specs or visual-review assertions pin each of these.

### R10. `$limits` host source (Electron) [rev 3, user, decisions.md #15]

**Requirement:** a block shows the plan limits of the CLI lanes by naming `$limits`: per lane and window, the window,
how much is used, the state and the reset time. These are the same values the `ptah_agent_list` "Plan limits" table
gives the agent. The agent never types them, and no account identity reaches the surface.

**What exists.**

- `ptah_agent_list` builds its "Plan limits" table from one `LaneLimitResult` per listed lane
  (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1786-1833`). The lanes are
  the listed `CliDetectionResult` rows. Results come from `LaneLimitLookupService.lookup`
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.ts:44-63,80-86,111-123`),
  reached through the agent namespace (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts:155,499-514`).
- The table text is `formatPlanLimitsSection`: columns `Agent | Window | Used | State | Reset | Source`, one row per
  lane per window, or one `(none)` row for a lane with no windows
  (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-limit.formatter.ts:69-78,80-118,185-232`).
- **The webview cannot reach these rows today.** It reads owner-keyed snapshots through `provider:getPlanLimits`
  and the `planLimits:changed` push (`libs/shared/src/lib/types/rpc/rpc-providers.types.ts:215-226`,
  `libs/shared/src/lib/types/plan-limit.types.ts:159-192`, `libs/shared/src/lib/types/messages/message-constants.ts:164`,
  `libs/frontend/core/src/lib/services/plan-limits.store.ts:74,176`). Those snapshots have no lane list, no per-lane
  classification and no list text. `LaneLimitLookupService` has no RPC consumer: only the MCP agent tools use it.
  They also carry fields this source must not show: `owner.key` (a hashed identity fingerprint) and
  `account.planType` (`plan-limit.types.ts:123-130,171`).

| Source | Scalars | Rows (columns) | Backed by |
| ------ | ------- | -------------- | --------- |
| `$limits` | `lanes`, `atLimit`, `nearLimit`, `unknown` int [lane] | `lane`, `window`, `used`, `state`, `reset` | The host's lane plan-limit lookup for the lanes `ptah_agent_list` would list on this host at that moment, through the read in R10.1 |

Scalars count lanes, not rows: `lanes` is the number of lanes, and `atLimit`, `nearLimit` and `unknown` count lanes
whose lane state is `at-limit`, `near-limit` and neither of those nor `confirmed-room` (the cases
`formatLimitColumn` prints as "AT LIMIT", "near limit" and "unknown (…)", `agent-limit.formatter.ts:147-175`).

Acceptance criteria:

1. **Host read [user; the architect designs it].**
   - The Electron webview shall be able to obtain, on request, the per-lane plan-limit rows `ptah_agent_list` would
     show at that moment, computed by the same lookup and classification. This is a **new** read-only RPC with its
     own request and response types [rev 3.1]. The architect names it.
   - **[rev 3.1]** It is not an extension of `provider:getPlanLimits`, and its response is not, does not contain and
     does not forward a `PlanLimitsSnapshot`, `PlanLimitOwnerSnapshot` or `QuotaOwnerRef`
     (`libs/shared/src/lib/types/plan-limit.types.ts:123-130,159-192`), because those carry `owner.key`,
     `providerId`, `identityKind` and `account`. `provider:getPlanLimits` and its result stay unchanged.
   - **[rev 3.1]** The response contains only: per row, `lane`, `window`, `used`, `state` and `reset` as text; the
     four R10 scalars (`lanes`, `atLimit`, `nearLimit`, `unknown`); and the "as of" time (R10.6). A contract spec
     asserts the response type's keys are exactly these.
   - [rev 3.2, user decision #18] The read uses exactly the plan-limits lookup that `ptah_agent_list` uses. On a cache
     miss that lookup may run a provider's local usage reader process (`plan-usage.service.ts:163-182`); this is
     allowed. The read never starts an agent CLI session, spawns a lane, changes a setting or writes to the ledger. It does
     not bypass reader caches (the `refresh` flag, `rpc-providers.types.ts:222-223`): an agent block is not a user's
     refresh request.
   - The read is made only when a valid `$limits` block resolves in this tab. A spec asserts that no call is made for
     a turn with no `$limits` block.
   - Its contract types live with the other RPC contracts in `libs/shared/src/lib/types/rpc/` and it is
     registered on the Electron host.
2. **Same text as the list.** For the same `LaneLimitResult[]` input and the same `now`, each `$limits` row's
   `lane`, `window`, `used`, `state` and `reset` equal the first five cells of the matching
   `formatPlanLimitsSection` row, in the same row order. This covers:
   - a lane with two windows (two rows)
   - a lane with no windows and no usage source (`(none)`, "no usage source", "unknown")
   - an owner-level limit with no window ("AT LIMIT (owner level, window unknown)")
   - `reset-usage-unknown` (used reads "unknown")
   - a failed and a timed-out lookup ("limit lookup failed", "limit lookup timed out")
   - a Ptah CLI lane with and without `ptahCliName` ("Unknown")

   A spec pins each case against the formatter's own output. The architect may move the shared text so both
   callers use one implementation; the list's output stays byte-identical (its existing specs pass unchanged).
3. **Unknown, never zero.** A missing used value, reset or state renders the list's words ("unknown", "reset
   unknown", "-"), never `0%`, an empty cell or a guessed time.
4. **Privacy [user].**
   - The rows, scalars, rendered DOM text and accessible names contain no account id, email, owner key or
     fingerprint, identity kind, credential or token, credential reference, CLI session id, provider account plan
     type, or Ptah CLI provider id.
   - The read's response carries none of the above.
   - A spec seeds `owner.key`, `owner.label`, `account.planType`, `cliSessionId`, the Ptah CLI `providerId` and an
     email-shaped string in the owner snapshot with a sentinel. It asserts the sentinel appears in no response field
     the webview receives, no resolved value, no rendered DOM text and no accessible name.
5. **No write-back.** The 610 Req 5.12 fixture extends to `$limits`: a sentinel lane name and the used value
   `62.3623%` appear in no stored message text, no `ChatContinueParams` and no SDK query input.
6. **Freshness and scope [lane].**
   - `$limits` is a current-state source, not a turn source: there is no per-turn plan-limit record. Every
     `$limits` block shows the latest read, with its "as of" time as visible text in the block's description (for
     example "as of 14:32").
   - For a block in the live window, a `planLimits:changed` push (`message-constants.ts:164`) updates the values in
     place without re-instantiating the block (610 Req 3.2).
   - On reload, a `$limits` block re-reads and shows current values with their new "as of" time. This is the one
     stated exception to R2.9's "equals the panel before reload" and 610 Req 3.7's per-turn resolution.
7. **Failure.**
   - When the read fails or times out, scalars and the row source render as unavailable, per 610 Req 3.4. The block
     is not invalid and does not fall back to code.
   - A failed lookup for one lane affects only that lane's row, as in the list.
8. **Grammar.** `$limits` is a known source name: valid as `$limits.<scalar>` in `stats` values and as a `table` or
   `list` row source. `list $limits` lists `lane`. `$limits session` is invalid (R3 lexical delta).
9. **Electron only [user, decisions.md #4].** In the VS Code webview a fence naming `$limits` is an ordinary code
   block, and no plan-limit lane read is made. A spec asserts both.
10. **Fixtures.** The corpus gains a `stats` case with `$limits` scalars and a `table $limits` case. A resolver spec
    with three lanes (one at limit with one window, one near limit with two windows, one failed lookup) asserts four rows and
    `lanes` = 3, `atLimit` = 1, `nearLimit` = 1, `unknown` = 1.

## Non-functional requirements

- **Lazy loading [project: 610 Req 5.1, 5.2, 5.9].**
  - In a production Electron webview build, no module from the panel, `declarative-dashboard`, the parser, converter
    or resolver, `@ptah-extension/shared/mcp-apps-contracts`, zod reached through these, or the R6 summary appears in
    the initial chunk set.
  - The eager code allowed is the extended fence-line check (now also recognising the `display` opener) and the
    panel toggle. Their bytes are named in the 5.1 report against the merge base.
  - With no valid block and no summary chip opened, the renderer chunk is not requested.
- **Performance.**
  - Inline blocks keep `PTAH_UI_LIVE_CAP` (8).
  - Panel surfaces obey R1.12.
  - Applying an id update re-instantiates only changed components (R2.4 spec).
  - Streaming text after a closed display fence does not re-apply it (610 Req 2.7).
- **Context budget [user, project].**
  - 610 Req 5.10: coding-profile `tools/list` has the same tool names and character count at head and at the merge
    base, on both host kinds.
  - Req 5.11: hint ≤ 100 tokens.
  - Req 5.12: sentinels, extended by R5.8, R6.7 and R10.5 [rev 3].
  - Any change to the Apps-profile `tools/list` caused by `/4` is measured and recorded in `measurement.md`.
- **Security [project: TASK_2026_490/493/494/532].**
  - The existing validator is the only trust boundary.
  - Text is plain text.
  - No agent HTML, scripts, URLs, images or network requests.
  - The `'full'` markdown preset is not loosened.
  - Imitating the mount marker or chip markup produces no surface.
  - Display surfaces stay in the webview: no new RPC, and no entry in the host surface store. The one exception is
    the R10.1 read-only plan-limit read [rev 3], which carries data to the webview and never carries a surface.
  - R5.10 and R10.4 privacy sentinels pass [rev 3].
- **Accessibility.**
  - An `axe-core` scan reports zero serious or critical violations in the dark and light themes for these fixtures:
    - the panel (empty, with surfaces, overlay)
    - each new container and atom
    - the summary cards (collapsed and expanded, including unavailable and incomplete states)
    - the chip
    - the Bash, Read, Write and Edit previews
  - Keyboard: every panel control (toggle, close, pin, resize separator) and every expandable is operable by keyboard
    in DOM order, and no surface traps focus.
  - Auto-open never moves focus (R1.7).
  - Trend, status and test outcome are conveyed in text.
- **Themes.** Every new or restyled component uses theme tokens and renders in the app's dark and light themes. A
  spec or visual-review screenshot shows each.
- **Responsive.** R3.5 and R9 (the named breakpoints `chat-narrow`, `chat-wide`, `panel-narrow` and `panel-wide`).
- **Compatibility.**
  - VS Code webview: unchanged, except the R7 previews (decisions.md #8). Its CSP is unchanged.
  - TUI: unchanged.
  - `/3` surfaces and the Apps-page renderer: unchanged behaviour (R4.1).
- **Tests.** Following the CLAUDE.md memory-safe rules, `nx test` passes for each touched project only:
  `shared`, `declarative-dashboard`, `chat-ui`, `chat`, `chat-streaming`, `markdown` if touched, and `agent-sdk`.
  R10 adds only the projects it touches [rev 3] (for example `rpc-handlers`, `core`, `cli-agent-runtime` and
  `vscode-lm-tools`), and the existing `agent-limit.formatter` and `formatAgentList` specs pass unchanged.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| ----------- | ------------------------------- | ---------------------- |
| Electron coding-chat user | Rich, readable agent visuals in a room beside the chat. A turn summary that is accurate and polished. Control over the panel. | Matches the reference screenshots' quality at Gate 1.7. The panel never reopens after they closed it in a turn. Numbers match git and the footer. |
| Coding agent (Claude SDK session) | A compact, learnable way to build and update a panel, with no new tool. | Hint ≤ 100 tokens. Grammar in the skill. Updates by id work. Invalid blocks degrade to code. |
| VS Code user | Nothing breaks, and the previews get the same polish. | Display fences are code blocks. The card and badges are unchanged. The previews match the Gate 1.7 spec. |
| Apps-profile surface callers (`ptah_surface_update`) | `/3` documents keep working. | All `/3` contract specs pass. |
| Maintainers | One grammar, one renderer, one source layer. No parallel copies. | No duplicate parser or renderer. The parity inventory is closed. |
| Electron user running CLI lanes [rev 3] | One view of agents' usage and context and of each lane's plan limits, as in the user's example. | `$limits` rows match `ptah_agent_list` at the same moment. Unknown values say "unknown" or "unavailable". No account identity is visible. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Indentation nesting makes agent blocks fail often (an off-by-one indent) | MEDIUM | MEDIUM | Architect: the reason line names the line and the expected depth. Skill: a "Common mistakes" entry and nested worked examples. Measure fallback rate in dogfooding before PR merge. |
| `/4` silently widens what Apps-profile agents can send | MEDIUM | LOW | Architect: record the Apps `tools/list` delta (NFR). Keep the Apps documentation unchanged (Out of scope) unless the user asks. |
| Two right-side panels plus the review dock squeeze the chat column | HIGH | MEDIUM | Designer: specify the coexistence layout at Gate 1.7 against R1.3. Visual reviewer: check at 1280 px and 600 px. |
| `$agents` leaks prompt or output through a name field (for example a CLI `displayName` set from a task) | LOW | HIGH | Architect: derive `name` only from the R5.1 allow-list. Tester: R5.1 sentinel spec covering every record type. |
| Reload cannot rebuild CLI-lane rows per turn | MEDIUM | LOW | Architect: decide per R5.6 and document the result. Values show "unavailable" rather than guesses. |
| Removing the in-chat change-set card in Electron (decisions.md #5) hides file changes from users who never open the panel | MEDIUM | MEDIUM | Designer: the chip shows the file and line totals in text when collapsed (R9.2). Visual reviewer: check that it is legible at `chat-narrow`. |
| R7 restyles shared molecules in VS Code too (decisions.md #8), so a VS Code-only path such as `file:open` could regress | MEDIUM | MEDIUM | Tester: run the parity-inventory section 4 specs on both hosts, and take the R7.8 screenshots in the VS Code webview. |
| Re-sending whole blocks on id updates grows context per turn | MEDIUM | MEDIUM | Architect: R8.4 records per-case cost. Skill: advise updating only when values change. Partial-update syntax stays a later task. |
| [rev 3] `$limits` text drifts from `ptah_agent_list` because the two are formatted in different processes | MEDIUM | MEDIUM | Architect: give both callers one formatting implementation, or justify two. Tester: R10.2 equality spec over every listed case. |
| [rev 3] The plan-limit read exposes owner identity, because the existing snapshot carries `owner.key` and `account.planType` | MEDIUM | HIGH | Architect: define a response that carries row values only. Tester: R10.4 sentinel spec on the response as well as the DOM. |
| [rev 3] The user's example expects CLI context figures, but CLI rows read "unavailable" today (`agent-monitor.store.ts:497-501`) | HIGH | LOW | Resolved by decisions.md #16 [rev 3.1]: follow-up task. Skill: say that CLI context is unavailable today, so agents do not promise it. |
| [rev 3] A context percent is computed from a guessed window | LOW | MEDIUM | Tester: R5.12 fixture (e) pins that a family-pattern window is never used. |

## Resolved user decisions (2026-10-09)

| # | Question | Decision | Where it applies |
| - | -------- | -------- | ---------------- |
| decisions.md #5 | In-chat change-set card in Electron | Replaced by the R6 chip in Electron. VS Code keeps the card. Removal approved for Electron only. | R6.5, R6.9; parity-inventory.md section 2 |
| decisions.md #6 | Footer token, cost and duration badges | They stay, in both runtimes. | parity-inventory.md section 3 |
| decisions.md #7 | Display blocks in chat history | A chip ("Open in display", "updated later" when superseded). No inline snapshot. | R1.11 |
| decisions.md #8 | R7 preview polish scope | Both webviews (Electron and VS Code). | R7.10 |
| decisions.md #9 | Chips and cards | All are collapsible and responsive at small and large widths. | R9 |
| decisions.md #10 | Tests row in Electron | Moves out of the chat into the panel Tests card plus the chip. VS Code is unchanged. | R6.10; parity-inventory.md section 1 |
| decisions.md #11 [rev 3] | Gate 1.7 | Approved (design-spec.md rev 3 and prototype). The Agents tab always has a tabpanel with its own empty state. | R1.13 |
| decisions.md #12 [rev 3] | Sparkline highlight colour | Theme `primary`, not gold. | R4.4 |
| decisions.md #13 [rev 3] | Turn-summary gradient | Keeps the warm gradient. | design-spec.md only |
| decisions.md #14 [rev 3] | `$agents` context and scope | A `context` field, and `$agents session` beside the turn-scoped `$agents`. | R5, R5.10-R5.13 |
| decisions.md #15 [rev 3] | CLI plan limits | A new host source, `$limits`. | R10 |
| decisions.md #16 [rev 3.1] | CLI context figures | CLI lanes show `context` as "unavailable" in this task. CLI context reporting is a separate follow-up task. | R5.10; Out of scope |

## Open Questions for the User

None open [rev 3.1].

## Open questions

- **Panel layout when both panels are open.** Resolved at Gate 1.7 [rev 3]: one dock with `Displays | Agents` tabs
  (design-spec.md section 2, decision 1).
- **Shape of the R10.1 read [rev 3.1].** The name of the new RPC and where the shared list text lives. The
  software-architect decides, within R10.1, R10.2 and R10.4.
- **Shape of `accordion`.** It is either a new layout kind or a `collapsible` field on `card`. This is the
  software-architect's choice, and both satisfy R4.

## Handoff

- **Next specialist:** software-architect [rev 3]. Gate 1.7 is approved (decisions.md #11).
- **Why:** the visual specification exists. The remaining questions are shapes: the `/4` schema, the R10.1 read and
  where the shared plan-limit text lives, and whether R5 in-memory values are restorable per turn (R5.6).
