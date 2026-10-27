# Chat layout declutter — capability parity

Scope: Electron canvas chat. Reviewed screenshots `screenshots/1.png`–`5.png` and current checkout. Paths below are repository-relative; `:line` identifies the inspected implementation, not a future edit location. No runtime capability is approved for deletion. Presentation removals are enumerated in `design-spec.md` under `## Proposed Removals`.

Path prefixes: **C** = `libs/frontend/canvas/src/lib/`; **H** = `libs/frontend/chat/src/lib/`; **U** = `libs/frontend/chat-ui/src/lib/`. Expand these prefixes when assigning implementation work.

| Surface | Capability | Component file:line | Fate |
| --- | --- | --- | --- |
| Header | Session title, truncation, full-title tooltip | C/canvas-rail/canvas-focus-header.component.ts:133 | stays: minimal orientation label; expanded inspector owns full metadata |
| Header | Workflow association badge | C/canvas-rail/canvas-focus-header.component.ts:139 | moves to inspector identity block; available through Details in rail/sheet mode |
| Header | Branch label and full-branch tooltip | C/canvas-rail/canvas-focus-header.component.ts:140 | moves to inspector Git section; no duplicate branch chip |
| Header | Running, needs-you, error, done, idle state | C/canvas-rail/canvas-focus-header.component.ts:148 | moves to inspector identity; urgent running/needs/error cue stays by chat controls |
| Header | Stop running session | C/canvas-rail/canvas-focus-header.component.ts:157 | stays, including current enablement |
| Header | Full/compact session view toggle | C/canvas-rail/canvas-focus-header.component.ts:172 | stays; distinct from inspector compact mode |
| Header | Details open/expanded state, context ring, attention dot, limit warning | C/canvas-rail/canvas-focus-header.component.ts:190 | stays; retain split/compact-sheet condition; rail expand is single-focus entry; retain warning semantics |
| Header | More actions / send to messaging | C/canvas-rail/canvas-focus-header.component.ts:227 | moves to expanded inspector identity menu; header menu remains when inspector is compact |
| Header | Swap panes, close pane, close split | C/canvas-rail/canvas-focus-header.component.ts:249 | stays in header menu: pane actions belong to pane |
| Header | Close session | C/canvas-rail/canvas-focus-header.component.ts:280 | stays; never conflate with closing inspector |
| Header agent strip | Orchestrator pill, selected-agent named pill, avatar circles, status badges | C/canvas-detail/canvas-lane-tabs.component.ts:128 | moves to inspector roster slot when expanded; stays in header only as compact-mode fallback |
| Header agent strip | Lane selection, selected tab, associated panel, keyboard navigation | C/canvas-detail/canvas-lane-tabs.component.ts:145 | stays through same selector component; keep selection in detail store; mutually exclusive @if branches |
| Header agent strip | Responsive overflow ranking, selected agent priority | C/canvas-detail/dock-overflow.ts:52 | stays; calculate from actual inspector width |
| Header agent strip | `N agents ›`, compact count, grouped full-roster menu | C/canvas-detail/agent-dock-menu.component.ts:52 | stays in relocated strip; all agents remain discoverable |
| Header agent strip | Agent hover/focus detail card and duration | C/canvas-detail/canvas-lane-tabs.component.ts:316 | stays; do not replace accessible details with tooltip-only controls |
| In-chat execution header | Per-lane context/tokens/cost/model/cache usage | H/components/molecules/execution-header/execution-header.component.ts:36; H/components/molecules/agent-card/agent-card.component.ts:85; H/components/organisms/subagent-lane/subagent-lane.component.ts:64 | moves to inspector active/selected-agent details only in Electron canvas; passive slot → `## Proposed Removals` |
| In-chat execution header | Details disclosure: task, status, CLI session and parent metadata | H/components/molecules/execution-header/execution-header.component.ts:63; H/components/molecules/agent-card/agent-card.component.ts:151; H/components/organisms/subagent-lane/subagent-lane.component.ts:104 | stays in execution header, distinct from inspector Details entry |
| In-chat execution header | CLI Resume session (green play), pending/disabled state | H/components/molecules/agent-card/agent-card.component.ts:112 | stays in executionHeaderActions; never removed with passive stats |
| In-chat execution header | Stop, Background and Close column with eligibility/loading states | H/components/molecules/agent-card/agent-card.component.ts:91, :132; H/components/organisms/subagent-lane/subagent-lane.component.ts:70 | stays in executionHeaderActions |
| In-chat execution header | Progress peek, tool/meta counts | H/components/molecules/execution-header/execution-header.component.ts:37, :48 | stays; no empty stats-only spacing |
| Canvas lane composition | CLI/subagent mounts, other consumers retain inline stats | C/canvas-detail/canvas-lane-view.component.ts:182, :232 | stays; Electron-only showStats=false; agent-card/subagent-lane default true |
| Inspector Session | Context current/limit/percentage, compaction information, details | U/molecules/session/inspector-stats/inspector-session-stats.component.ts:63 | stays; quieter missing values |
| Inspector Session | Tokens, breakdown, estimate/budget semantics | U/molecules/session/inspector-stats/inspector-session-stats.component.ts:79 | stays; compact numeric tile opens same detail |
| Inspector Session | Cost, partial known subtotal, pricing details | U/molecules/session/inspector-stats/inspector-session-stats.component.ts:99 | stays; unknown is not zero |
| Inspector Session | Cache tile/countdown and cache information | U/molecules/session/inspector-stats/inspector-cache-tile.component.ts:1 | stays in expanded inspector; hidden from compact summary only |
| Inspector Session | Duration and turns | U/molecules/session/inspector-stats/inspector-session-stats.component.ts:102 | stays; Time tile appears in rail when known |
| Inspector Session | Agent count and explanatory details | U/molecules/session/inspector-stats/inspector-session-stats.component.ts:108 | moves to roster count; explanation stays in roster details |
| Inspector Session | Single model label, multiple-model breakdown, input/output/cache counts and total | U/molecules/session/inspector-stats/inspector-session-stats.component.ts:117 | stays behind Models disclosure |
| Inspector Agents | Loading, error and empty roster; active/finished counts | H/components/organisms/session-inspector/inspector-agents-section.component.ts:106 | stays; counts in strip summary; compact empty state |
| Inspector Agents | Provider/kind, model name/raw ID, status, elapsed time, tokens/cost, partial CLI usage | H/components/organisms/session-inspector/inspector-agents-section.component.ts:183, :235 | moves to selected-agent detail and active rows; long vertical roster → `## Proposed Removals` |
| Inspector Agents | Activate/open agent lane with session ownership | H/components/organisms/session-inspector/inspector-agents-section.component.ts:187 | moves to avatar/menu selection, preserving original routing |
| Inspector Agents | Steer, send to background, stop, contextual eligibility | H/components/organisms/session-inspector/inspector-agent-actions-menu.component.ts:38 | stays in active/selected-agent detail action menu |
| Inspector Agents | Steer editor, pending state and failure handling | H/components/organisms/session-inspector/inspector-agents-section.component.ts:325 | stays; preserve draft across mode switch |
| Inspector Agents | Permission/question request lines, answer/open, focus return, announcements | H/components/organisms/session-inspector/inspector-agents-section.component.ts:312 | stays visible above active rows; never concealed by passive empty-state rules |
| Inspector orchestration | Orchestrator-owned permission/questions and FIFO routing | H/components/organisms/session-inspector/session-inspector.component.html:29 | stays above passive statistics |
| Agent chat | Context/tokens/cost/cache/model usage | H/components/molecules/agent-card/agent-card.component.ts:85; H/components/organisms/subagent-lane/subagent-lane.component.ts:64 | moves to inspector Active subagents / selected-agent detail in Electron canvas |
| Agent chat | Task text, parent link, transcript, history/truncation notices, composer, stop/background | H/components/organisms/subagent-lane/subagent-lane.component.ts:54, :104, :137, :192, :215 | stays; relocate only passive statistics |
| Plan limits | Account/owner identity, windows, usage/reset detail and disclosure | U/molecules/session/inspector-stats/inspector-limits-lanes.component.ts:21, :41 | stays; unavailable owner explanation moves into disclosure; copy owned by plan-limit-tiles.ts:74, :237 |
| Plan limits | Near/at-limit warnings and retained-data refresh notice | U/molecules/session/plan-limits/limits-alert.component.ts:1; U/molecules/session/session-stats-summary.component.html:3 | stays; never treat failed refresh as empty |
| Lanes | Lane identity, known tokens/cost, run status/count, limit status, partial provenance | U/molecules/session/plan-limits/lane-usage-tile.component.ts:49 | stays; unknown chips → `## Proposed Removals` |
| Lanes | Owner/model subgroups, shared-plan links, separate windows, expanded detail state | U/molecules/session/plan-limits/lane-usage-tile.component.ts:22 | stays in expandable row |
| Lanes | Known subtotal and excluded-from-session-totals explanation | U/molecules/session/inspector-stats/inspector-limits-lanes.component.ts:49, :68 | stays; no known contributions becomes `—`, not zero |
| Todos | Status/progress, visible subset, show more/less, empty state | H/components/organisms/session-inspector/inspector-todos-section.component.ts:123, :168 | stays; rail opens this section |
| Git | Branch/detached HEAD, added/removed lines, review changes | H/components/organisms/session-inspector/inspector-git-section.component.ts:42, :49, :56 | stays; do not invent ahead/behind counts |
| Git | Loading/unavailable, retry failed read, no-repository distinction | H/components/organisms/session-inspector/inspector-git-section.component.ts:69, :77 | stays; real failures retain retry |
| Task (additional discovered surface) | Linked task, related tasks, document opening, loading/error/retry | H/components/organisms/session-inspector/inspector-task-section.component.ts:58, :69, :90, :138 | stays; never drop this section when reorganizing inspector |
| Dock | Expand/collapse inspector, attention badge, independent Git dock | C/canvas-rail/canvas-rail-board.component.ts:276, :314 | moves from 32px tab to 56px presentation="rail" inspector mounted by canvas-rail-board; expanded/compact only, independent Git stays |
| Dock | Resize, keyboard separator, reset/cancel and persisted preferred width | H/services/session-inspector/inspector-dock-width.store.ts:35; H/components/templates/chat-view.component.ts:569, :651 | stays; compact width must not overwrite expanded preference |
| Dock | 300–560px bounds, 336/400/448px defaults, minimum main width 360px | H/services/session-inspector/inspector-dock-width.ts:7 | stays |
| Dock | Modal/sheet, Escape, focus restoration, split-pane ownership | C/canvas-rail/canvas-rail-board.component.ts:246, :331, :929; H/components/organisms/session-inspector/session-inspector.component.html:2 | stays; same inspector contents in each presentation |
| Left compact rail | 56px width, expand/collapse, numbered sessions, status/attention, session selection/actions | C/canvas-rail/canvas-rail.component.ts:94, :125, :230; C/canvas-rail/canvas-rail-card.component.ts:137, :250 | stays unchanged; visual reference only |
| Left compact rail | New session, previous sessions, rename and session action menu | C/canvas-rail/canvas-rail.component.ts:288; C/canvas-rail/canvas-rail-card.component.ts:346 | stays unchanged |
| Chat column | Centered messages, controls and composer share max-width; full-height transcript | H/components/templates/chat-session-layout.component.ts:16; H/components/templates/chat-view.component.html:83; H/components/molecules/chat-input/chat-input.component.ts:591 | stays with one 1100px ancestor variable; preserve gutters and non-canvas fallbacks |

Verified source note: screenshots 3/5 show the mounted per-lane execution header, supplied by agent-card/subagent-lane through canvas-lane-view. Its green play action is Resume session. Only the passive stats slot moves; Details metadata and execution actions stay. The separate reusable session-stats-summary is outside this change, including its harness-builder consumer.

Additional ownership/capability checks:

| Surface | Capability | Component file:line | Fate |
| --- | --- | --- | --- |
| Compact inspector | Same session metrics and expansion/attention entry as existing dock/tab | C/canvas-rail/canvas-rail-board.component.ts:274, :485, :1024; H/components/organisms/session-inspector/session-inspector.component.ts:67 | moves to B-owned presentation=rail/expandRequested, mounted by A; × collapses, no hidden mode |
| Dock width | Tab footprint included in available width | H/services/session-inspector/inspector-dock-width.ts:32; C/canvas-rail/canvas-rail-board.component.ts:480 | moves from 32px tab to 56px compact rail; expanded subtracts dock width instead |
| Lane/chat width | Lane controls and transcript share centered variable cap | H/components/molecules/execution-header/lane-column.ts:10; H/components/organisms/transcript/chat-transcript.component.css:67; C/canvas-rail/canvas-focus-area.component.ts:39 | stays; A sets 1100px common ancestor, E removes nested override and maintains consumers |
| Plan owner | Unresolved account and explanation | U/molecules/session/plan-limits/plan-limit-tiles.ts:74, :237 | stays in disclosure; repeated unknown-account/owner-not-resolved text → `## Proposed Removals` |
| Lane copy | Unknown tokens/cost/limit and known subtotal | U/molecules/session/plan-limits/lane-tiles.ts:115, :124, :171, :715 | moves to quiet copy table in design spec; preserve known/partial provenance; C owns adjacent specs |

Revision 1: inventory now matches all eleven review findings through the specification's revision log and file-disjoint A–E ownership. Visual acceptance uses before/after Electron implementation screenshots, including dark/light, compact/expanded, split, CLI Resume, narrow/wide and unknown usage.
