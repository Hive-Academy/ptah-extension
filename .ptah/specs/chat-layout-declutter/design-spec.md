# Electron chat layout declutter

Specification only. Companion: [capability inventory](parity-inventory.md). No production code, new libraries or generated assets. All five supplied screenshots were viewed. Revision 1 addresses the independent review. Visual acceptance uses before/after Electron implementation screenshots described below.

## Current state

- Screenshot 1 has a title/status/action row and a useful compact agent selector. Its sources are `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts` and `canvas-detail/canvas-lane-tabs.component.ts`.
- Screenshots 2–3 duplicate identity/usage in `libs/frontend/chat/src/lib/components/organisms/session-inspector/`; the long agent list competes with Plan limits, Lanes, Todos and Git. The current template also includes Task, which must survive.
- Screenshots 3/5 show the per-lane `ptah-execution-header`, not `session-stats-summary`: H/`components/molecules/execution-header/execution-header.component.ts:36,63,71` projects stats, Details and actions. H/`components/molecules/agent-card/agent-card.component.ts:85` and H/`components/organisms/subagent-lane/subagent-lane.component.ts:64` supply stats; C/`canvas-detail/canvas-lane-view.component.ts:182,232` mounts them. The green play control is CLI Resume (`agent-card.component.ts:112–129`) and stays. This is request #3's active-agent usage relocation; the separate summary component is unchanged.
- Screenshot 4's left rail is 56px (`canvas-rail.component.ts:94`). Screenshot 5's large margins result from `--chat-content-max-width: 758px` in `libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.ts:16`; the composer already consumes that variable.
- Reuse the implemented Electron theme, not the community-site palette in `docs/design-system/panel-theme-spec.md`. That document discusses operator-member/operator-admin themes; Electron uses the theme mappings in `apps/ptah-extension-webview/tailwind.config.js` and surfaces in `src/styles.css:149`. `docs/design-system/designs-systems.md` is background guidance, not a reason to restyle this surface.

## Target layout

Header after change — one row; no passive metric strip:
```text
Session title…       [needs you, only if urgent] [Stop*] [view] [Details] […] [×]
──────────────────────────────────────────────────────────────────────────────
Messages                                      * Stop only while stoppable; Details only in split/compact-sheet layouts
```
When the inspector is compact, retain the existing avatar selector immediately below this row. When expanded (dock or sheet), render that selector only inside the inspector through mutually exclusive `@if` branches. The title remains as orientation in split panes and is not another stats card.

Expanded stats sidebar — preserve resize width and one vertical scroll region:
```text
Session details                            [compact] [×]
Full session title (wrap)                     idle
Workflow if present                            […]
[Orchestrator] (a) (b✓) (c!)       [12 agents ›]
Requests needing an answer, if any              [Open/Answer]
SESSION
[ Context 42% ] [ Tokens 84k  ⓘ ]
[ Cost $1.24 ⓘ] [ Time 04:12    ]
Cache if known                 Models ›
ACTIVE SUBAGENTS  2
(a) reviewer       running      [8k] [$0.12] […]
(b) tester         needs you    [—]         [Answer]
PLAN LIMITS        Account / windows ›
LANES              3 lanes · 11 runs
  ...compact lane rows...
TASK (when linked) ›
TODOS               2/5        [Show more]
GIT                 branch    +8 −0 [Review changes]
```
Numbers illustrate data, not new fixtures or default values. Inspector header stays outside the scroll region; identity, roster and sections scroll together. No nested always-on agent-list scrollbar.

Compact stats rail — 56px, matching the left rail's width:
```text
┌──────┐
│  ‹   │ Expand session details
│ Ctx  │
│ 42%  │ Context details
│ Tok  │
│ 84k  │ Token details
│ Cost │
│$1.24 │ Cost details
│ Time │ optional when known
│04:12 │
│ Run  │
│  2   │ Active agents; needs-you badge when present
│ Todo │ optional when data exists
│ 2/5  │
└──────┘  Git remains its own existing dock tab
```
Each tile is a button to expand and focus its section; no separate compact-only metric calculations. Unknown tiles keep `—`; no explanatory paragraphs. With no session, show only expand control; do not imply a zero-agent session.

Active-subagent section and selected-agent details:
```text
ACTIVE SUBAGENTS 2
(avatar) name…     running       8k · $0.12     […]
         model    elapsed 1:23
(avatar) name…     needs you     —             [Answer]
Selected finished agent › model / usage / duration / actions
```
Active means the existing roster's running or waiting/needs-input states, not merely all non-completed records. Completed/error/stopped agents remain in the full-roster menu and selected-agent details. Pending requests stay visible regardless of this filter. With no active agents, show `No active subagents` on one line; no empty card grid.

Lane rows:
```text
LANES           3 lanes · 11 runs        Not in session totals
Codex           18k · $0.24              Done · 3 runs       ›
Antigravity     ≥12k · ≥$0.10            Running · 2 runs    ›
Ptah CLI        —                       Done · 4 runs       ›
Known subtotal  ≥30k · ≥$0.34            Partial usage      ⓘ
```
Unknown row expanded: `Usage unavailable` once, then labeled detail fields only as needed. Known cost with unknown tokens remains `$0.24` in the compact row; do not hide known data. Near/at-limit warnings remain visible beside the row status. Preserve restored/provisional provenance in expanded detail.

Wide-screen chat column:
```text
56px left | remaining main pane                          | 56px rail
          |        centered column, max 1100px           |
          |        messages: flex-1, scroll              |
          |        composer: same width, bottom         |
```
An expanded right dock consumes its actual width first; center within the remaining main pane, not the entire window.

## Changes

Path shorthand here and in batches: C=`libs/frontend/canvas/src/lib/`, H=`libs/frontend/chat/src/lib/`, U=`libs/frontend/chat-ui/src/lib/`. These are existing source roots, not new packages.

1. **[user-requested] Consolidate header metadata in Session details.** Files: C/`canvas-rail/{canvas-focus-header,canvas-focus-area,canvas-rail-board}.component.ts`; H/`components/organisms/session-inspector/session-inspector.component.{ts,html}`. Keep title, Stop, view-mode and pane/session controls in the header; full title, passive status, workflow/branch and session actions move into expanded inspector identity. Retain header action fallback when compact. Keep the existing Details condition (`canvas-focus-header.component.ts:190`: split or compact-sheet); single-focus Details entry is rail expand. Reuse `text-sm`, `text-xs text-base-content-muted`, `min-w-0 truncate`, existing ghost buttons and inspector surfaces. Preserve existing warnings/attention cues and all capabilities in the inventory.

2. **[user-requested] Replace the vertical roster with the existing avatar strip.** Files: C/`canvas-detail/{canvas-lane-tabs,agent-dock-menu}.component.ts`, `canvas-detail/dock-overflow.ts`, C/`canvas-rail/{canvas-focus-area,canvas-rail-board}.component.ts`; H/inspector template and agents section. Inspector expanded → board projects `<ptah-canvas-lane-tabs inspectorSection>` through the existing slot (`session-inspector.component.html:42`); otherwise focus-area renders the strip below the header (`canvas-focus-area.component.ts:67`). Use plain mutually exclusive `@if` branches, with exactly one strip per pane/session. Selection stays in the existing detail store (`:70–71`), not the component. Restore focus to the strip after mode toggle. No moving live components or importing canvas into chat. Reuse 38px circles/pills, 140px named chip, 180px selected maximum, `gap-0.5 rounded-full`, status overlays and measured overflow (`canvas-lane-tabs.component.ts:43–45,145,182`). Preserve selected/orchestrator priority, full roster menu, hover/focus details, keyboard navigation and lane actions.

3. **[user-requested] Move passive per-lane usage into active/selected-agent inspector details.** Files: C/`canvas-detail/canvas-lane-view.component.ts`; H/`components/organisms/session-inspector/inspector-agents-section.component.ts`, `components/molecules/agent-card/agent-card.component.ts`, `components/organisms/subagent-lane/subagent-lane.component.ts`, `components/molecules/execution-header/execution-header.component.ts`; U/`molecules/agent-lane-stats/agent-lane-stats.component.ts`. Add `showStats = input(true)` to agent-card and subagent-lane; canvas-lane-view sets it false only for the Electron canvas composition (retain true in other hosts and consumers). Gate only `executionHeaderStats` content; execution-header retains its progress/meta, `Details` disclosure and `executionHeaderActions`, without empty stats-only spacing. Resume, Stop, Background and Close column stay with their existing eligibility/loading states. Details still discloses task/status/CLI session/parent metadata; it is not a duplicate inspector opener. Agent-monitor-panel and single-chat-subagent-view keep their stats through the default true input. Reuse lane-stats adapters without altering attribution. Active rows use `px-3 py-2 gap-2 text-xs tabular-nums`, `min-w-0 truncate` and existing `size-7` action buttons. Selected-agent details retain context/model/cache/token/cost explanations for active or finished agents; transcript, task, parent navigation, composer, history, requests and steering survive. Never add CLI totals to session totals or sum inclusive counters without attribution.

4. **[user-requested] Use two inspector states: compact and expanded.** Files: C/`canvas-rail/canvas-rail-board.component.ts`; H/inspector component/template and `services/session-inspector/{inspector-dock.controller,inspector-open-state.service,inspector-dock-width.store,inspector-dock-width}.ts`; U/inspector Session stats. B adds `presentation="rail"` and `expandRequested` to `ptah-session-inspector`, reusing the same metric model as expanded presentation; A mounts it where the Stats tab/dock is mounted today (`canvas-rail-board.component.ts:274–282`). Compact replaces the 32px Stats tab with 56px `w-14 shrink-0`; expanded replaces that rail with the dock, not an extra adjacent strip. The inspector × collapses to rail; expand restores saved dock width. Persist one expanded boolean, plus the existing separate preferred width; no third hidden state or extra mode preference. Change `INSPECTOR_TAB_WIDTH` from 32 to 56 (`inspector-dock-width.ts:32`) and update board width accounting (`:480–482`) to subtract the rail only when compact, and the actual dock only when expanded. Keep rail tiles `m-1 p-1 min-h-10 rounded-md text-xs tabular-nums`, captions `text-[10px] text-base-content-muted`; use short formatters with labeled full values accessible on focus/hover. Narrow sheets are expanded presentation, not a third state.

5. **[user-requested] Quiet missing telemetry.** Files: U/`molecules/session/session-stats-view.ts`, `plan-limits/{lane-tiles.ts,plan-limit-tiles.ts,lane-usage-tile.component.ts,lane-subtotal-tile.component.ts,plan-limit-tile.component.ts}`, `inspector-stats/{inspector-limits-lanes,inspector-session-stats}.component.ts`, U/`molecules/agent-lane-stats/agent-lane-stats.component.ts`. Apply the single copy table below. `lane-tiles.ts` owns lane/subtotal strings and `plan-limit-tiles.ts` owns plan-owner strings (including current owner-not-resolved and unknown-account text at :74,237–238); update their existing unit specs together. Session fields use the shared session-stats view, with no duplicate component-local wording. Preserve unknown/partial flags, source attribution, model/owner scope, warnings and expansion state; keep other consumers' existing presentation through scoped view formatting. Use `text-base-content-muted`, not text opacity or tinted unknown chips.

6. **[user-requested] Widen the centered chat and lane columns to 1100px.** Files: C/`canvas-rail/canvas-focus-area.component.ts`; H/`components/templates/chat-session-layout.component.ts`, `components/templates/chat-view.component.html`, `components/organisms/transcript/chat-transcript.component.css`, `components/molecules/chat-input/chat-input.component.ts`, `components/molecules/execution-header/lane-column.ts`. A declares `--chat-content-max-width: 1100px` on the Electron canvas focus-area ancestor of both chat and lanes; E removes the nested layout declaration that would override inheritance and retains 758px fallbacks for other consumers. Keep existing `min(var(--chat-content-max-width, 758px), 100%)`, centered wrappers and gutters. The lane-column consumer at :10 and transcript cap at :67 are definite scope, not optional. No breakpoint table or independent message/composer maxima; preserve full height and block-local code/table overflow.

7. **[lane-proposed] Remove only redundant Agents tile and nested roster scroller.** Files: U/`molecules/session/inspector-stats/inspector-session-stats.component.ts:108–112`; H/`components/organisms/session-inspector/inspector-agents-section.component.ts:164`. Roster count replaces the separate Agents metric tile. Remove the 260px nested agent scroller; use the inspector's existing vertical scroll. No section-padding redesign; retain current section classes and all actions/details.

8. **[lane-proposed] Retain the needs-you badge on the compact Run tile.** Files: C/`canvas-rail/canvas-rail-board.component.ts:485–489`; H/inspector component/template. Carry the existing attention cue to Run, with its accessible count, using existing status/icon tokens. Tile activation opens the active-agent section normally; no new request-priority focus or live-region behavior.

## Empty-state rules

| Field | Visible text | Expanded detail |
| --- | --- | --- |
| Context absent | `—`; omit `No data yet` / `Window unknown` helper | `Context unavailable` |
| Tokens absent | `—` | `Tokens unavailable` |
| Cost absent | `—` | `Cost unavailable`; retain pricing explanation |
| Lane limit unknown | Omit unknown-limit chip | `Limit unavailable` |
| Lane tokens/cost absent | One `—` if both absent; otherwise only known value | `Usage unavailable` once; labeled missing fields use `—` |
| Known subtotal without contributions | `Known subtotal —` | `Usage unavailable`; never synthetic zero |
| Plan owner unresolved | `Plan usage unavailable` once; no unknown-account chip | `Account not resolved`; preserve technical reason here |

Copy ownership is defined in change 5. A dash retains a field-specific accessible name. Known zero stays zero; preserve partial/estimated markers and known contributions, pending requests, retained-data refresh warnings and existing recovery behavior. Do not turn unavailable limits into healthy/unlimited status. No additional empty-state copy changes.

## Responsive rules

One proposed value: `--chat-content-max-width: 1100px` on the Electron canvas focus-area host, covering focused chat and CLI/subagent lanes (`canvas-focus-area.component.ts:39–78`). This increases the existing 758px cap without the longer prose lines of 1280px. Remove the layout's overriding 758px declaration; retain fallback values for non-canvas consumers. Keep existing container-relative width, centered `mx-auto`/auto margins and 0.75rem gutters per side: `chat-view.component.html:83`, `chat-transcript.component.css:66–68`, `chat-input.component.ts:591`, `lane-column.ts:10`. Do not subtract gutters twice or introduce new breakpoint rules.

Preserve dock min/max 300/560px, defaults 336/400/448px at existing shell thresholds 1100/1500px, and 360px main minimum (`inspector-dock-width.ts:7–25`). Width accounting uses either compact 56px rail or expanded dock. User resize preference is independent of the expanded boolean; never save 56px as a dock width. Left rail and independent Git dock are unchanged. When dock plus main minimum cannot fit, use existing expanded overlay/sheet behavior; closing it returns to compact. The 56px rail renders under the same condition as today's Stats tab (`dockShown()`); where that condition is false, the existing header Details → sheet path is the entry point. No 32px tab/hidden state returns. At approximately 400px, expanded details uses a full-width sheet.

Keep resize pointer/keyboard/reset/cancel behavior, Escape and focus return to the actual opener, and originating-pane routing for split Details. Use existing `h-full min-h-0`, `flex-1 overflow-y-auto`, shrink-0 composer and code/table overflow. Restore focus to the strip after mode toggle.

### Tokens and accessibility

Reuse existing Electron tokens from `apps/ptah-extension-webview/tailwind.config.js`; no new colours. Existing text-token checks meet WCAG AA normal-text 4.5:1 against base-100/200/300 (base-content minimum 12.17:1; muted minimum 5.01:1 across four first-party themes). Focus uses base-content against those surfaces, exceeding 3:1. These inherited measurements do not certify translucent rendered surfaces; visual review checks actual dark/light surfaces and focus/status cues. Keep semantic text plus icons for status, existing 28px controls and 38px avatar targets.

## Proposed Removals

Presentation changes only; every affected capability is mapped in `parity-inventory.md`:
1. Duplicate full header metadata while expanded inspector owns it; retain title orientation and urgent/pane controls.
2. Long vertical Agents roster, replaced by strip/full-roster menu plus active/selected-agent details; preserve requests/actions.
3. Passive `executionHeaderStats` in Electron canvas lanes, replaced by inspector usage. Keep execution-header Details metadata, Resume, Stop, Background and Close column; do not change the shared session summary or other lane consumers.
4. Repeated unknown chips/helpers and false-looking zero subtotals; preserve diagnostic meaning in details.
5. Existing 32px Stats tab, replaced by the 56px compact inspector rail with the same entry/attention capabilities.
6. [lane-proposed] Separate Agents tile and nested roster scroller (change 7); retain count and details in roster.

## Decisions

| Decision | Options | Evidence and choice | Reversible |
| --- | --- | --- | --- |
| Roster placement (settled) | Always header; inspector only; conditional | Requests #2/#4 require navigation in both modes. Mutually exclusive `@if`: expanded inspector or header; selection remains in detail store (:70–71) | Yes |
| Header Details | Always visible; existing condition | Header :190 already limits it to split/compact-sheet. Single focus uses rail expand | Yes |
| Inspector states | Hidden/compact/expanded; two states | Left rail :94–96 and request #4 support compact/expanded, one boolean. 56px replaces 32px tab | Yes |
| Rail ownership | New canvas component; inspector presentation | Existing board mount :274 and inspector presentation input :67 support B's rail API mounted by A | Yes |
| Execution stats | Global suppression; scoped input | Canvas mounts :182,232; other consumers need stats. Default-true showStats becomes false only in Electron canvas; actions and metadata remain | Yes |
| Width | 758px; 1100px; 1280px | Screenshot 5 and shared consumers support 1100px on common ancestor: materially wider while moderating prose length | Yes |
| Active usage | Aggregate all agents; active plus selected | Existing ownership/partial attribution forbids invented totals; running/waiting rows plus historical selected details | Yes |
| Theme | New palette; existing Electron | Existing webview theme is authoritative for this host; no theme edits | Yes |

## Implementation batches

Path prefixes are defined above and in the inventory. Verified project names: C = `@ptah-extension/canvas`, H = `@ptah-extension/chat`, U = `@ptah-extension/chat-ui`. All listed files have one owner; no production work is performed in this revision.

| Batch | Exclusive files | Contract / projects |
| --- | --- | --- |
| A — Canvas composition | C/canvas-rail/{canvas-focus-header,canvas-focus-area,canvas-rail-board}.component.ts; C/canvas-detail/{canvas-lane-tabs,agent-dock-menu,canvas-lane-view}.component.ts; C/canvas-detail/dock-overflow.ts | Canvas. Mount B's rail instead of Stats tab; own width accounting, projected conditional roster, header condition and Electron-only showStats=false bindings. Set common 1100px ancestor variable; consume D's inputs |
| B — Inspector API and state | H/components/organisms/session-inspector/session-inspector.component.{ts,html}; H/services/session-inspector/{inspector-dock.controller,inspector-open-state.service,inspector-dock-width.store,inspector-dock-width}.ts | Chat. Add presentation=rail and expandRequested; expanded boolean, projection, metric destinations and saved width; 56px constant. Consume C's metric view |
| C — Metrics and copy | U/molecules/session/session-stats-view.ts; U/molecules/session/inspector-stats/{inspector-session-stats,inspector-limits-lanes}.component.ts; U/molecules/session/plan-limits/{lane-tiles.ts,plan-limit-tiles.ts,lane-usage-tile.component.ts,lane-subtotal-tile.component.ts,plan-limit-tile.component.ts}; U/molecules/agent-lane-stats/agent-lane-stats.component.ts | Chat UI. Own metric view reuse, exact strings, partial provenance, Agents tile removal; preserve separate consumers |
| D — Active agents / execution header | H/components/organisms/session-inspector/inspector-agents-section.component.ts; H/components/molecules/agent-card/agent-card.component.ts; H/components/organisms/subagent-lane/subagent-lane.component.ts; H/components/molecules/execution-header/execution-header.component.ts | Chat. Default-true showStats inputs; no empty stats row, actions and Details retained. Active/selected-agent stats, request/action/steer preservation and nested-scroller removal |
| E — Width consumers | H/components/templates/chat-session-layout.component.ts; H/components/templates/chat-view.component.html; H/components/organisms/transcript/chat-transcript.component.css; H/components/molecules/chat-input/chat-input.component.ts; H/components/molecules/execution-header/lane-column.ts | Chat. Remove nested override, preserve shared variable/gutters and non-canvas fallbacks across all consumers. Add the missing fallback `var(--chat-content-max-width, 758px)` at `chat-view.component.html:83` (non-canvas `session-embed` consumer) with a regression test; coordinate with A's ancestor declaration |

Dependency order: C → B → A and D in parallel. A/D agree the default-true showStats interface before starting; integrate both before visual review. E is file-independent and can run alongside this sequence, with A+E integrated for width verification. Existing adjacent unit specs belong to the production file's batch; C updates lane-tiles/plan-limit-tiles specs. No competing edits to shared fixtures. No TUI or VS Code-only work, left-rail edits, new libraries or theme rewrite.

Visual acceptance: capture before/after **Electron implementation** screenshots in dark and light themes, covering expanded and compact inspector, split pane, CLI lane selected (Resume visible when eligible), approximately 400px pane, 1600px-or-wider pane, and all-unknown lane usage. Review alignment, retained actions, focus/resize, partial/error/request states and glass surfaces on these screenshots; do not treat this Markdown revision as screenshot evidence.

## Risks

- Canvas-to-chat projection must not become a reverse dependency; sheets must receive the same roster/actions as the dock.
- Preserve steering drafts, pending requests and selected historical agents; do not filter actionable requests by running status.
- Unknown/zero/stale/estimated/partial/unresolved-owner meanings remain distinct; never merge lane totals into session totals.
- Compact tiles need short formatters and full accessible values; no unlabeled icon-only metrics.
- The common width variable must inherit through chat-session-layout; inspect transcript, controls and composer alignment in both chat and lane screenshots.
- Scoped inputs must preserve other hosts and standalone lane consumers. Keeping execution-header Details is necessary for metadata, even after its stats move.

## Lane-introduced constraints

- [lane-proposed] Remove redundant Agents tile and nested roster scroller (change 7).
- [lane-proposed] Retain needs-you badge on compact Run tile (change 8).
- [lane-proposed] Choose 1100px for the shared wider content cap (change 6).

The two-state inspector and conditional roster implement user requests #4/#2; they are settled decisions, not extra lane constraints.

## Revision log

| Finding | Revision |
| --- | --- |
| 1 | Corrected execution-header provenance; merged passive usage relocation into change 3; preserved Resume/actions and metadata Details; corrected inventory |
| 2 | Assigned canvas-lane-view to A, execution-header to D, lane-column to E, plan-limit-tiles to C; named default-true showStats and Electron-only bindings |
| 3 | Removed prototype/approval-gate prose; defined before/after Electron screenshot acceptance in dark/light |
| 4 | Reduced inspector to compact/expanded; rail replaces 32px tab, one boolean and 56px width accounting |
| 5 | Defined B-owned presentation=rail/expandRequested and A-owned board mount; explicit dependency order |
| 6 | One 1100px common ancestor cap; all four consumers and nested override addressed, gutters/360px minimum retained |
| 7 | Plain mutually exclusive @if roster branches with selection in existing store; settled decision |
| 8 | Retained existing header Details condition; single-focus entry is rail expand |
| 9 | Shortened copy table to changed fields; identified lane-tiles/plan-limit-tiles copy and spec ownership |
| 10 | Removed padding, request-focus and live-region extras; trimmed token section and lane constraints |
| 11 | Removed obsolete screenshot-reconciliation note from width batch E |

## Revision 2 — user feedback after first Electron screenshots (2026-10-26)

All items `user-requested` unless tagged. These override earlier sections where they conflict (notably the "Roster placement" and "Header Details" decisions).

1. **No chat header row.** Remove the canvas focus header row (title, status, avatar strip, Stop, view toggle, `⋯`, Close) from the chat area at every width. The session title, status, workflow/branch and the avatar strip appear ONLY in the stats sidebar. No duplication in any layout (single, split, narrow, compact).
2. **Controls move to the sidebar.** Stop (while stoppable), view toggle (compact/fullscreen), `⋯` session actions and Close session go into the expanded sidebar's top bar; the compact rail shows the same controls as icon buttons (`size-7`, aria-labels, tooltips) at its top, under the expand `‹` button.
   - Decision (user, 2026-10-26): no top bar in the expanded sidebar; controls sit at the right of the title row; no ⋯; Hand off is an icon button. Superseded by the rev 2 decision below.
   - Decision (user, 2026-10-26, rev 2): session actions (Stop, view toggle, Hand off, Close session) live only in the session card ⋮ menu in the left Sessions sidebar; the right sidebar keeps stats and the expand/collapse control; split floating controls keep only Swap panes / Close pane / Close split.
3. **Split view.** Each pane has no header row; it shows a small floating control group (top-right of the pane, `absolute`, Close + view toggle + `⋯`, appears on pane hover/focus and is always reachable by keyboard). The sidebar shows the identity and strip of the focused pane.
   - Decision (user, 2026-10-26, rev 2): session actions (Stop, view toggle, Hand off, Close session) live only in the session card ⋮ menu in the left Sessions sidebar; the right sidebar keeps stats and the expand/collapse control; split floating controls keep only Swap panes / Close pane / Close split.
4. **Compact rail agents.** Replace the Run count tile with the ACTIVE agents' avatar icons (running/waiting/needs-you; same avatar + status overlay as the strip; same hover tooltip as the strip). Stack vertically, max ~5 then a `+N` chip. A click on any icon expands the sidebar and selects that agent; a click on `+N` expands to the agents section. With no active agents, show the orchestrator avatar only. Keep the needs-you badge and plan-limit mark.
5. **Expanded strip on two rows.** In the sidebar the strip wraps onto up to 2 rows (orchestrator pill first, then avatars, then the "N agents ›" trigger with its label always visible). Overflow beyond 2 rows goes into the existing overflow menu. Never show a bare count without the "agents" label.
6. **Narrow widths** (visual-review defects 2, 3): when the expanded sidebar would leave the chat pane narrower than 560px, the expanded sidebar opens as an overlay sheet over the chat (existing sheet behavior) instead of a dock; below that the docked state is the compact rail. No clipping of the sidebar's right edge at 400px.
7. **Lane usage mismatch** (visual-review defect 1): the sidebar lane card shows usage (e.g. input/output tokens, $ cost) while Lanes rows, Known subtotal and Session Cost show `—`. Find why the lane tiles do not receive the usage that the lane card has, and fix the data mapping if it is in chat/chat-ui/canvas; otherwise report the owning file. Keep lane totals separate from session totals.
8. **Polish** (visual-review defects 7, 9): "Hand off" styled as a ghost `btn btn-xs` aligned with the title; the avatar hover popover must not cover the Session tiles (place it below/left inside the sidebar).
9. **Lane detail as DaisyUI structure** (user screenshot 7.png). The expanded lane row is a dense paragraph today. Rebuild it with DaisyUI components:
   - Lane row = DaisyUI `collapse collapse-arrow` (title row: lane name, usage or `—`, status `badge badge-xs badge-ghost`), aligned on a shared grid so name / usage / status columns line up across lanes.
   - Expanded body: one muted summary line only once (`Usage unavailable · Limit unavailable` when both unknown); then a `table table-xs` with columns `#`, Model, Tokens, Cost, Status (`badge badge-xs`), Started (short `d MMM HH:mm`, full timestamp in `title`). `tabular-nums`, right-aligned numbers.
   - When every run has the same unknown value, drop that column (e.g. hide Model/Tokens/Cost when all are unknown) instead of repeating `Model unknown · Tokens — · Cost —` per run.
   - Limit/owner explanation as one footnote line with an info icon (`text-xs text-base-content-muted`), never duplicated ("Limit unavailable" appears once).
   - No sentence-style "Restored · completed" repeated in each run: status is the badge.
10. **Expanded sidebar stats layout ("B+").** Mockup: `prototype/stats-ideas.html`, column "B+ — totals + agent rows with dock detail".
   - Decision (user, 2026-10-26, rev 3): B+ stats layout — session totals row with dividers; one agents list with provider avatars, status, tokens, cost; the selected row expands in place into a dock detail; no in-flow hover card; no 'N agents' chip; no ACTIVE SUBAGENTS block.
   - SESSION: one `grid-cols-3` row (Context │ Tokens │ Cost, `border-l border-surface-border` rules, no tiles). Labels are dotted-underline buttons whose `title` is the former ⓘ details text; a click shows that text under the row. Sublines: context bar, "all agents", "this session" (budget or known-subtotal lines replace them when present). Unknown values are a muted `—` titled "not reported". The plan-limit warning, Time · turns, Model(s) and the prompt-cache tile follow under the row.
   - AGENTS: header "AGENTS" with "N running · total"; column header Agent / Status / Tokens / Cost; rows = `ptah-agent-avatar` (status badge), name + type line (`CLI lane`, `Sub-agent`, Orchestrator model), status ink, `formatTokenCount` tokens, cost (`~$` for lane estimates). Order: live agents (running, waiting, queued, asking), then the Orchestrator, then the rest in the store's recency order. Six rows, then "Show N more" in place.
   - Dock detail of the selected row (disclosure button, `aria-expanded`): Context, In / out, and Turns (Orchestrator) or Duration (other agents) when known; "Open thread →". The row's tray actions menu sits in the detail. The rail keeps its floating hover card; the expanded strip and its in-flow card are removed.
