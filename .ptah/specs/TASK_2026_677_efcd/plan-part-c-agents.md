# Implementation Plan - TASK_2026_677 - Part C: agent avatar, agent roster, agent dock

Part C of three (A = turn, B = inspector, C = agents). Scope: design-spec §4.7 "Agent tile and icon system", the
"Delta 2: agent tiles and thread switcher (option B)" section, design-delta-2-options.md §2-§3 (option B), decisions
D34-D40, task-description requirements 18 and 19 (PM-13..PM-16), parity rows E-1..E-18, decisions.md rows 27, 30, 31,
33, 37. Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view`. All paths below are relative to it
unless absolute.

Cross-part agreements (settled by message with architect-a-turn and architect-b-inspector, 2026-10-15):

- Part A (turn chips) and Part B (inspector AGENTS rows) consume `ptah-agent-avatar`, the status words, the status
  mappers, `formatAgentDuration` and `agentAccessibleLabel` from `@ptah-extension/chat-ui` (Component 1).
- Part B's inspector aggregate (chat lib, `libs/frontend/chat/src/lib/services/session-inspector/`) consumes
  `SessionAgentRosterService.roster(tabId)` and `requestsForTab(tabId)` (Component 2) and re-sorts the roster for the
  AGENTS order. Part B keeps the `N needs you` de-duplication by `requestId`. Part C owns the roster.
- Part A does not add a duration formatter; `formatAgentDuration` follows the design-spec §3.9 rule (Component 1).

## Inputs and constraints

- Requirements used: `context.md` (not re-read: the prompt carries the settled decisions), `task-description.md`
  §18 (lines 672-718), §19 (lines 720-778), PM-13..PM-16 (lines 63-66); `parity-inventory.md` rows E-1..E-18
  (lines 125-142); `design-spec.md` §3.5 (238-256), §4.2 (397-433), §4.7 (608-679), §9 / §9.1 (999-1048), Delta 2
  (1266-1338); `design-delta-2-options.md` §2 (23-92), §3 shared behaviour and option B (94-136); `decisions.md` rows
  27, 30, 31, 33, 37.
- Corrections applied: decisions rows 33 / 37 (displayed words `waiting` / `failed`, never `Needs you` / `Error` as a
  status word; unknown provider -> neutral lucide `Workflow`). design-delta-2-options.md §2.1 / §2.4 still say
  "needs you" / "error" / "Gemini"; design-spec §4.7 supersedes them.
- Design handoff used: design-spec.md §4.7 and Delta 2 (the handoff for this part); prototype only by reference
  (`prototype/options-delta-2.html`, `prototype/index.html?prov=unknown`), not opened.
- Missing decision-critical input: an authoritative session provider id (architect check 1). It does not exist
  (evidence in Codebase evidence rows 1-3). Resolved by requirement 18.5 / PM-14: the Orchestrator avatar always shows
  the neutral lucide `Workflow` glyph in this task; no provider input is added (Decision C1).

## Codebase evidence

| # | Evidence | Location | Architectural implication |
| --- | --- | --- | --- |
| 1 | `TabState` has `id`, `claudeSessionId`, `status: SessionStatus`, `agentOrigin`, no provider / engine / CLI field (a case-insensitive search for `provider|engine|cliType|backend` in the file finds only comments) | `libs/frontend/chat-types/src/lib/chat-types.ts:603-650`, `:543-551` | Check 1: no authoritative session provider id on the tab |
| 2 | The only `providerId` read in frontend session state is `ContextCapacity.providerId` in live model stats | `libs/frontend/chat-state/src/lib/live-context-stats.ts:36-37` | Model-stat path; not the CLI engine; not used (decisions row 33) |
| 3 | `ChatSessionSummary` block carries no provider / engine / cli field | `libs/shared/src/lib/types/execution/node.ts:229-264` | Check 1 confirmed: neutral `Workflow` glyph ships |
| 4 | `SessionStatus` = `fresh`, `draft`, `loaded`, `streaming`, `resuming`, `switching`, `awaiting-background`, `sleeping` | `libs/frontend/chat-types/src/lib/chat-types.ts:543-551` | Orchestrator status source (check 2, req. 19.15) |
| 5 | Orchestrator status is hard-coded `'running'` | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:119` | Replaced by `orchestratorStatusWord` (E-17) |
| 6 | `MonitoredAgent`: `agentId`, `cli: CliType`, `status: AgentStatus`, `startedAt`, `completedAt?`, `segments`, `parentSessionId?`, `permissionQueue`, `displayName?` | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:394-446` | CLI lane status, duration, activity, open requests |
| 7 | `AgentStatus` = `running`, `completed`, `failed`, `timeout`, `stopped` | `libs/shared/src/lib/types/agent-process.types.ts:43-44` | CLI lane mapper input |
| 8 | `CliType` = `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi`, `grok`, `ptah-cli` | `libs/shared/src/lib/types/agent-process.types.ts:70-82` | Keys of the one `cliId -> providerId` table |
| 9 | `SubagentRecord`: `parentToolUseId`, `teammateName?`, `agentType?` ("SDK agent type ... e.g. `software-architect`"), `description?`, `lastToolName?`, `status` (`pending`, `running`, `completed`, `failed`, `killed`, `stopped`, `paused`, `background`), `parentSessionId?`, `lastEventAt?`; no start time | `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:531-611` (`agentType` at `:558`, `status` at `:566-574`) | Check 3: role-icon key is `SubagentRecord.agentType`; duration omitted for sub-agents |
| 10 | `BackgroundAgentEntry`: `toolCallId`, `agentType: string`, `teammateName?`, `agentDescription?`, `sessionId?`, `status` (`running`, `completed`, `error`, `stopped`), `startedAt`, `completedAt?` | `libs/frontend/chat-streaming/src/lib/background-agent.store.ts:39-67` | Background mapper input; role icon from `agentType` |
| 11 | Store signals: `AgentMonitorStore.subagents` (Map), `.agents` (array), `BackgroundAgentStore.agents` | `agent-monitor.store.ts:758`, `:816`; `background-agent.store.ts:100-103` | Roster sources (E-3) |
| 12 | `ownedBySession(items, sessionId, owner)`: no session id -> `[]`, else strict owner equality | `libs/frontend/canvas/src/lib/canvas-detail/lane-owner.ts:1-8` | Membership rule moves with the roster (E-3) |
| 13 | `lane-owner.ts` importers: `canvas-lane-tabs.component.ts:21`, `canvas-lane-view.component.ts:35`, `canvas-needs-you-queue.ts:6` (no spec imports it) | grep over `libs/frontend` | Three import lines change when the file moves |
| 14 | Today's grouping, keys and labels: Orchestrator; sub-agents (non-background) `sub:` label `teammateName || agentType || description || 'Sub-agent'`; CLI `cli:` label `a.cli`; background: sub-agents in `background` status `bg:` plus background-store entries not matching a sub-agent's `parentToolUseId` | `canvas-lane-tabs.component.ts:98-162` | Roster preserves E-4..E-7 exactly |
| 15 | Selection fallback `sub:` <-> `bg:` else `orchestrator`; parent told the corrected key | `canvas-lane-tabs.component.ts:164-177` | Kept verbatim (E-8) |
| 16 | Keyboard: Left / Right wrap, Home / End, `preventDefault` + `stopPropagation`, emit, focus new tab | `canvas-lane-tabs.component.ts:216-239` | Kept over visible dock items (E-12); Rail handler at `canvas-rail.component.ts:201` never sees the keys |
| 17 | `laneKey(kind, id)` / `LANE_KEY_PREFIX` (`cli`, `sub`, `bg`) | `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts:21-29` | Keys unchanged |
| 18 | Existing mapper `laneStatus(status, waiting)` -> `CompactLaneStatus` (`pending`/`paused` -> `waiting`, `failed`/`timeout` -> `error`, ...) | `compact-lane-rows.ts:43-49` | Second copy of the same knowledge; delegates to the shared mapper (Component 4) |
| 19 | Parent binding: `[panelId]`, `[sessionId]="tab()?.claudeSessionId ?? null"`, `[laneKey]="detail.laneKeyFor(id)"`, `(laneSelected)="detail.selectLaneFor(id, $event)"`; lane view gets `[tabId]="id"` | `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts:56-69` | Dock gains `tabId`, loses `sessionId` (Decision C6) |
| 20 | Focus-area spec stubs `ptah-canvas-lane-tabs` with `panelId`, `sessionId`, `laneKey`, `laneSelected` | `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts:59-69` | Stub input list updated |
| 21 | e2e asserts `ptah-canvas-lane-tabs` sits below the focus header | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:150-154` | Keep selector `ptah-canvas-lane-tabs` (E-18) |
| 22 | `PermissionRequest.agentToolCallId` = the Task tool call id of the sub-agent asking; `sessionId?` | `libs/shared/src/lib/types/permission.types.ts:30-70` (`:58`, `:70`) | Sub-agent `waiting` without a new field |
| 23 | `AskUserQuestionRequest` has `id`, `sessionId?`, `tabId?`, `surfaceMode?`, no agent link | `permission.types.ts:172-195` | Questions count for the Orchestrator |
| 24 | `PermissionHandlerService` (root): `permissionRequests` `:113`, `questionRequests` `:125`, `routingTargetRevision` `:71`, `targetTabsFor(promptId)` `:382`, `questionTargetTabsFor(id)` `:605` | `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts` | Request sources; tab targeting |
| 25 | Tab targeting rule `targetsTab`: routed target tabs first, else `request.sessionId` -> `findTabBySessionIdAcrossWorkspaces` | `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:363-381`, `:622-642` | The roster service hosts the same rule (Part B request) |
| 26 | `TabManagerService.findTabByIdAcrossWorkspaces(tabId)` `:667`, `findTabBySessionIdAcrossWorkspaces(sessionId)` `:635`, both read the `_tabs` signal | `libs/frontend/chat-state/src/lib/tab-manager.service.ts` | Roster resolves session id and status from the tab id, reactively |
| 27 | `ProviderMarkComponent` `ptah-provider-mark`: inputs `providerId`, `fallback` (`Bot` default), `size` `'sm' | 'md'`; resolves `PROVIDER_BRAND_SLUGS`, then `PROVIDER_MARKS` stroke, then lucide fallback | `libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.ts` (selector, inputs `providerId` / `fallback` / `size`, `art` computed) | No new input; table membership decides provider mark vs monogram so the `Bot` fallback never shows |
| 28 | `PROVIDER_BRAND_SLUGS` keys include `claude-cli`, `codex`, `cursor`, `copilot`, `antigravity`, `opencode`, `grok` (not `claude`, not `pi`, not `ptah-cli`) | `libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts:74-95` | Six CLI ids resolve to vendored art |
| 29 | `PROVIDER_MARKS` has stroke marks `pi` and `ptah-cli` | `libs/frontend/ui/src/lib/native/provider-mark/provider-marks.data.ts:78-83` | Two CLI ids resolve to hand-authored glyphs |
| 30 | `libs/frontend/ui` is lucide-free by design ("stays free of a lucide runtime dependency") and tagged `type:ui` (may depend only on `type:ui`, `type:util`) | `provider-mark.component.ts` header comment; `libs/frontend/ui/project.json` tags; `eslint.config.mjs:421-423` | The avatar (lucide role icons, badges) cannot live in `ui` |
| 31 | `chat-ui` is `type:feature`, imports `lucide-angular` in 45 files, imports `@ptah-extension/chat-streaming` (`lib/organisms/ptah-ui/sources/ptah-ui-agents.source.ts:7`), `chat-types`, `ui`; `canvas` imports `chat-ui` (16), `chat` (26); `chat` imports `chat-ui` and `chat-state` | import counts over `libs/frontend/*/src` | `chat-ui` is the lowest lib all three consumers reach without a new edge; `chat` hosts the roster (chat never imports canvas) |
| 32 | chat-ui dependency-boundary spec forbids `BrandMarkComponent` from the main ui barrel and the artwork modules; `ptah-provider-mark` is not restricted | `libs/frontend/chat-ui/src/lib/dependency-boundaries.spec.ts:78-132` | Avatar imports `ProviderMarkComponent` from `@ptah-extension/ui`; never `ptah-brand-mark` |
| 33 | `monogramGlyph(label)`, `monogramTintClass(label)` exported from the component file, but the barrel `native/monogram-tile/index.ts` exports only `MonogramTileComponent` and `MarkTileSize` | `libs/frontend/ui/src/lib/native/brand-mark/monogram-tile.component.ts`; `libs/frontend/ui/src/lib/native/monogram-tile/index.ts` | One barrel line added so the circular avatar reuses the monogram rule |
| 34 | All lucide names used exist in lucide-angular 1.0.0: `LayoutTemplate`, `ServerCog`, `DraftingCompass`, `Users`, `ClipboardList`, `Palette`, `FlaskConical`, `SearchCheck`, `ScanEye`, `Telescope`, `Container`, `ScrollText`, `Sparkles`, `Eye`, `Bot`, `Workflow`, `LoaderCircle`, `Check`, `CircleAlert`, `Hand`, `CirclePause`, `MousePointerClick`, `ChevronDown`, `ChevronRight` | `D:\projects\ptah-extension\node_modules\lucide-angular\icons\lucide-icons.d.ts` (lines 876, 1299, 545, 1622, 402, 1098, 660, 1287, 1270, 1503, 475, 1284, 1366, 578, 218, 1681, 915, 322, 350, 776, 379, 1040, 331, 335) | Verified names; the worktree has no `node_modules`, the main checkout's is the installed set |
| 35 | lucide usage pattern: named icon imports + `<lucide-angular [img]="XIcon" />` | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:16`, `:77`, `:191` | Per-icon imports, tree-shaken individually |
| 36 | `NativeDropdownComponent` `ptah-native-dropdown`: `isOpen` (required), `placement`, `offset`, `hasBackdrop`, `closeOnBackdropClick`, `panelRole: 'listbox' | null`, outputs `opened`, `closed`, `backdropClicked`; Floating UI positioning, in-place render | `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts:61-174` | Menu container for `N agents ›` with `panelRole=null` and an inner `role="menu"` |
| 37 | `FloatingUIService.position(referenceEl, floatingEl, options)` / `cleanup()`; component-provided | `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:85`, `:125-129`, `:188` | Hover-card placement and clamping (flip / shift) |
| 38 | State ink tokens `state-run`, `state-need`, `state-err`, `state-done`, `state-idle`, `surface-0..3`, `surface-border` exist, themed per anubis / anubis-light | `apps/ptah-extension-webview/tailwind.config.js:32-41`, `:111-115`, `:185-189` | No new token; contrast pairs already measured (§8.2) |
| 39 | Existing per-lib duration formatters (`formatDuration` in chat-ui `session-stats-format.ts:34`, `formatBoardDuration` `compact-session-lanes.component.ts:51`) give `12.5s` / `2m 5s` shapes, not the §3.9 rule | as cited | `formatAgentDuration` is new and is the one formatter for avatar views and Part A's turn label |
| 40 | Existing spec of the strip: cases at `:27`, `:75`, `:101`, `:119`, `:135`, `:148`, `:162`, `:184`, `:214`; sets `sessionId`; asserts `title` = status (`:72`), `scrollIntoView` (`:205`, `:228`) | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts` | Spec updated (see Verification) |

## Architecture decision

- Chosen approach: three layers, each in the lowest library that can hold it without a new dependency edge.
  1. `@ptah-extension/chat-ui` holds the presentational vocabulary: status words, kinds, the ONE status mapping, the
     ONE `cliId -> providerId` table, the ONE role-icon table, the duration formatter, the accessible-label builder and
     the `ptah-agent-avatar` component.
  2. `@ptah-extension/chat` holds the ONE session agent roster (membership, keys, names, status, duration inputs,
     activity, open requests per agent) as a pure builder plus a root service that reads the stores; it also takes over
     `ownedBySession`.
  3. `@ptah-extension/canvas` re-implements `ptah-canvas-lane-tabs` as the agent dock (option B) over the roster:
     priority overflow, `N agents ›` menu, hover / focus card, today's keyboard and selection model.
- Rationale: requirement 18.8 needs one avatar and one status word for the same agent in chips (chat / chat-ui),
  AGENTS rows (chat) and the dock (canvas); evidence rows 30-31 show `chat-ui` is the only lib reachable from all three
  that may use lucide, and `chat` is the only lib reachable from both the inspector host (chat, ChatViewComponent) and
  the dock (canvas) without a cycle. Architect check 4 ("feed the same list to the dock and to the AGENTS section")
  becomes a single roster function.
- Rejected alternatives:
  - Avatar in `libs/frontend/ui`: the lib is `type:ui` and deliberately lucide-free (row 30); hand-inlining ~20 lucide
    icons as stroke paths duplicates lucide and breaks the "lucide-angular" Angular rule of this task.
  - Roster in `canvas` (first Part C proposal): `chat` hosts the inspector (Part B evidence: ChatViewComponent is the
    inspector host) and must not import `canvas` (row 31); rejected after Part B's objection.
  - Keeping horizontal scroll plus the avatar: rejected by PM-15 / decisions row 31 (priority overflow is the
    requirement; scroll is a changed mechanism, not a removed capability).
  - A `providerId` input on the avatar for the Orchestrator: no data source exists (rows 1-3); an always-null input is a
    speculative option. Added when a field exists (Decision C1).
- Assumptions (each with its check):
  - A1: `PermissionRequest.sessionId` / `AskUserQuestionRequest.sessionId` carry the SDK session id that
    `findTabBySessionIdAcrossWorkspaces` resolves. Check: the same rule already runs in
    `compact-session-card.component.ts:637-641`; reuse it verbatim, no new semantics.
  - A2: The hover card positioned by `FloatingUIService` is not clipped by an ancestor of `ptah-canvas-focus-area`.
    Check: visual review at 400 / 760 px in Rail and in a split pane; if clipped, use Floating UI `strategy: 'fixed'`
    through `FloatingUIOptions` (verify the option name at `floating-ui.service.ts:41-84`).
  - A3: SDK sub-agent status `paused` means "not progressing, not terminal, nothing asked of the user" (the SDK patch
    union at `libs/shared/src/lib/types/execution/stream-background.ts:163-164` carries no reason). Mapped to `queued`
    (Decision C4). Check: code-logic reviewer confirms no permission flow sets `paused`.
- Effect on existing code: `canvas-lane-tabs.component.ts` is rewritten in place (same file, class, selector, outputs);
  `lane-owner.ts` moves to chat and is deleted from canvas; `compact-lane-rows.ts` `laneStatus` delegates to the shared
  mapper with identical compact output; `canvas-focus-area.component.ts` binds `tabId` instead of `sessionId`. The
  compact card, `canvas-lane-view`, the stores, `CanvasDetailService`, lane keys and the request handlers are unchanged.

## Component specifications

### 1. Agent avatar vocabulary and `ptah-agent-avatar` (chat-ui)

- Purpose: one visual identity and one status vocabulary for an agent, shared by every avatar view.
- Responsibilities:
  1. Types (file `agent-avatar.types.ts`):
     - `AgentStatusWord = 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'queued'` (design-spec §3.5 table,
       §4.7 "Status words"). `error` never appears as a word.
     - `AgentKind = 'orchestrator' | 'subagent' | 'cli' | 'background'` (req. 18.6: no other lane kind).
     - `AGENT_KIND_LABEL: Readonly<Record<AgentKind, string>>` = `Orchestrator`, `Sub-agent`, `CLI lane`, `Background`
       (§4.2 kind badge copy).
     - `AgentAvatarSize = 24 | 28 | 32` (D40).
  2. The ONE status mapping (file `agent-status.ts`), pure functions, `type`-only imports:
     - `cliLaneStatusWord(status: AgentStatus, openRequests: number): AgentStatusWord` - `openRequests > 0` ->
       `waiting`; `running` -> `running`; `completed` -> `done`; `failed` | `timeout` -> `failed`; `stopped` ->
       `stopped`.
     - `subagentStatusWord(status: SubagentRecord['status'], hasOpenRequest: boolean): AgentStatusWord` -
       `hasOpenRequest` -> `waiting`; `pending` | `paused` -> `queued`; `running` | `background` -> `running`;
       `completed` -> `done`; `failed` -> `failed`; `killed` | `stopped` -> `stopped`.
     - `backgroundAgentStatusWord(status: BackgroundAgentEntry['status']): AgentStatusWord` - `running` -> `running`;
       `completed` -> `done`; `error` -> `failed`; `stopped` -> `stopped`.
     - `orchestratorStatusWord(status: SessionStatus, hasOpenRequest: boolean): AgentStatusWord | null` -
       `hasOpenRequest` -> `waiting`; `streaming` | `resuming` -> `running`; `loaded` | `awaiting-background` |
       `sleeping` | `switching` -> `done`; `fresh` | `draft` -> `null` (nothing has run; no ring, no badge, no word)
       (Decision C3).
     - Every `switch` is exhaustive over its union (a `never` default), so a new SDK / store status fails typecheck
       instead of silently mapping.
     - `AGENT_STATUS_URGENCY: Readonly<Record<AgentStatusWord, number>>` is NOT added; priority is the dock's concern
       (Component 6).
  3. `formatAgentDuration(ms: number): string | null` (file `agent-duration.ts`), Part A's agreed rule (design-spec
     §3.9): non-finite, negative or `< 1000` -> `null`; `< 60 s` -> `{s}s`; `< 1 h` -> `{m}m {ss}s` (seconds
     zero-padded); otherwise `{h}h {mm}m`. Callers show no number for `null`.
  4. `agentAccessibleLabel(agent: { name: string; kind: AgentKind; status: AgentStatusWord | null; durationMs?: number
     | null }): string` -> `{name}, {kind label}, {status} {duration}` with absent parts and their separators dropped
     (Orchestrator: `Orchestrator, Orchestrator, running` is avoided: when `kind` is `orchestrator` the kind segment is
     omitted, so the name stays `Orchestrator` per req. 18.5). Part A appends `. Open lane`; Part B appends
     `. {activity}`.
  5. The ONE `cliId -> providerId` table (file `agent-marks.ts`): `CLI_PROVIDER_MARK_IDS: Readonly<Record<CliType,
     string>>` with `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `grok` -> the same id (keys of
     `PROVIDER_BRAND_SLUGS`, row 28) and `pi`, `ptah-cli` -> the same id (keys of `PROVIDER_MARKS`, row 29). `Record<
     CliType, ...>` makes a new `CliType` a compile error until it gets a row. `cliMarkFor(cliId: string | null):
     { kind: 'provider'; providerId: string } | { kind: 'monogram'; label: string }` returns `provider` only for an id
     present in the table (own-property check), otherwise `monogram` with the id as label (req. 18.2). The Claude mark
     (`claude-cli`) is never produced by this table: it is an Orchestrator mark only and the Orchestrator has no
     authoritative provider today (Decision C1).
  6. The ONE role-icon table (same file): `AGENT_ROLE_ICONS: Readonly<Record<string, LucideIconData>>` with the 14 rows
     of design-spec §4.7 (`frontend-developer` -> `LayoutTemplate`, `backend-developer` -> `ServerCog`,
     `software-architect` -> `DraftingCompass`, `team-leader` -> `Users`, `project-manager` -> `ClipboardList`,
     `ui-ux-designer` -> `Palette`, `senior-tester` -> `FlaskConical`, `code-logic-reviewer` -> `SearchCheck`,
     `code-style-reviewer` -> `ScanEye`, `researcher-expert` -> `Telescope`, `devops-engineer` -> `Container`,
     `technical-content-writer` -> `ScrollText`, `modernization-detector` -> `Sparkles`, `visual-reviewer` -> `Eye`);
     `roleIconFor(agentType: string | null | undefined): LucideIconData` returns the row (own-property check) or `Bot`.
     `LucideIconData` is the type `lucide-angular` exports for `[img]` (Assumption-free check for the implementer: open
     `lucide-angular` typings for the exact exported type name before use; if it differs, use that name).
  7. `AgentAvatarComponent` (file `agent-avatar.component.ts`), selector `ptah-agent-avatar`, standalone, OnPush,
     `host: { 'aria-hidden': 'true', class: 'relative inline-flex shrink-0' }`, imports `LucideAngularModule`,
     `ProviderMarkComponent` (from `@ptah-extension/ui`).
     Inputs (all `input()`): `kind = input.required<AgentKind>()`, `status = input<AgentStatusWord | null>(null)`,
     `size = input<AgentAvatarSize>(28)`, `cliId = input<string | null>(null)`, `agentType = input<string | null>(null)`.
     No outputs. Rendering (computed signals, no template branches on ids):
     - Tile: circle `size` px, `bg-surface-2`, 1 px `border-[var(--surface-border-strong)]`, glyph `text-base-content`;
       Orchestrator: gold hairline `border-secondary` (selected-indicator gold, §4.2 / §8.2 pair).
     - Glyph: `orchestrator` -> lucide `Workflow`; `subagent` | `background` -> `roleIconFor(agentType)`; `cli` ->
       `cliMarkFor(cliId)`: `provider` -> `<ptah-provider-mark [providerId] [size]>` with `size` `sm` for 24 / 28 and
       `md` for 32 (no new provider-mark input, D40); `monogram` -> a circle-filling span with
       `monogramGlyph(label)` and `monogramTintClass(label)` (Component 3 exports them). Lucide glyph size 58% of the
       tile (24 -> 14 px, 28 -> 16 px, 32 -> 18 px).
     - Status ring (4 px outside the tile, an absolutely positioned SVG): `running` = 28% track + 30% arc rotating
       1.1 s linear (`transform: rotate` only); `waiting` = solid 2 px ring + 1.8 s halo (`opacity` / `transform`
       only); `failed` = solid 2 px ring; `done`, `stopped`, `queued`, `null` = no ring. Ink: `--state-ink-run`,
       `-need`, `-err` (row 38).
     - Corner badge (46% of the tile, min 10 px: 24 -> 11, 28 -> 13, 32 -> 15 px): `bg-surface-0`, 1.5 px ink border,
       lucide glyph in ink: `running` `LoaderCircle`, `done` `Check` (`state-done`), `failed` `CircleAlert`,
       `waiting` `Hand`, `stopped` `CirclePause` (`state-idle`); `queued` and `null` -> no badge (Decision C5).
     - Component `styles`: the two keyframes and `@media (prefers-reduced-motion: reduce)` that stops rotation and halo,
       leaves the static 30% arc, and sets transitions to 0 ms (req. 18.9).
- Verified contracts and entry points: rows 6-10, 27-29, 33-35, 38.
- Dependencies: `@angular/core`, `lucide-angular`, `@ptah-extension/ui` (`ProviderMarkComponent`, `monogramGlyph`,
  `monogramTintClass`), `type` imports from `@ptah-extension/shared` (`AgentStatus`, `CliType`),
  `@ptah-extension/chat-streaming` (`SubagentRecord`, `BackgroundAgentEntry`), `@ptah-extension/chat-types`
  (`SessionStatus`). All edges exist today (row 31). No `BrandMarkComponent` (row 32).
- Integration points: Part A chips (size 24), Part B AGENTS rows (size 32), the dock (28 in avatar chips, 28 in the
  pill, 32 in the hover card), the dock menu rows (24).
- Failure behaviour: unknown agent type -> `Bot`; unknown CLI id -> monogram (never `Bot`, never `>_`); empty CLI id ->
  monogram of `?` is NOT drawn: `cliMarkFor(null | '')` returns `monogram` with label `CLI lane` (first letter `C`)
  so a tile is never blank; `status` `null` -> tile only.
- Quality requirements: no new colour pair (§4.7 contrast list); `aria-hidden` on the whole avatar (req. 18.10);
  infinite animations change `transform` / `opacity` only; lucide icons imported by name (row 35) so only the ~24 used
  icons enter the bundle; no timer or observer.
- Verification seam: pure functions (mappers, `formatAgentDuration`, `cliMarkFor`, `roleIconFor`,
  `agentAccessibleLabel`) are observable through the consumer specs listed in Verification; the component through the
  dock spec (rendered `ptah-agent-avatar` with the expected `ptah-provider-mark` / lucide glyph). `nx typecheck` proves
  the exhaustive switches and `Record<CliType, ...>`.
- Files:
  - CREATE `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.types.ts`
  - CREATE `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-status.ts`
  - CREATE `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-duration.ts`
  - CREATE `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-marks.ts` (CLI table, role-icon table, `cliMarkFor`,
    `roleIconFor`, `agentAccessibleLabel` may sit in `agent-avatar.types.ts` instead; one file per concern is the rule)
  - CREATE `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.component.ts`
  - MODIFY `libs/frontend/chat-ui/src/index.ts` (append export lines: `AgentAvatarComponent`, `AgentStatusWord`,
    `AgentKind`, `AgentAvatarSize`, `AGENT_KIND_LABEL`, `cliLaneStatusWord`, `subagentStatusWord`,
    `backgroundAgentStatusWord`, `orchestratorStatusWord`, `formatAgentDuration`, `agentAccessibleLabel`,
    `CLI_PROVIDER_MARK_IDS`, `cliMarkFor`, `roleIconFor`)

### 2. Session agent roster (chat)

- Purpose: the ONE list of a session's agents (membership, identity, status, timing, activity, open requests) that the
  dock and the inspector AGENTS section both read (architect check 4, req. 18.8, 19.1).
- Responsibilities:
  1. `SessionAgent` (readonly): `key` (`'orchestrator'` or `laneKey(...)`), `kind: AgentKind`, `name`, `cliId: string |
     null`, `agentType: string | null`, `status: AgentStatusWord | null`, `startedAt: number | null`, `endedAt: number |
     null`, `activity: string | null`, `openRequestIds: readonly string[]`.
  2. `buildSessionAgentRoster(input)` (pure) with `input` = `{ sessionId: string | null; tabStatus: SessionStatus;
     subagents: readonly SubagentRecord[]; cliAgents: readonly MonitoredAgent[]; backgroundAgents: readonly
     BackgroundAgentEntry[]; permissions: readonly PermissionRequest[]; questions: readonly AskUserQuestionRequest[] }`
     (permissions / questions already tab-targeted). Output order = dock order: Orchestrator, Sub-agents, CLI lanes,
     Background (E-7). Membership and keys exactly as `canvas-lane-tabs.component.ts:98-162` (row 14), with
     `ownedBySession` (row 12):
     - Orchestrator: always first; `name` `Orchestrator`; `status` `orchestratorStatusWord(tabStatus, ids.length > 0)`;
       `openRequestIds` = ids of permissions without `agentToolCallId` + ids of all questions; `startedAt` / `endedAt`
       `null` (the dock pill shows no duration for the Orchestrator; no turn-start source is invented); `activity`
       `null`.
     - Sub-agent (`status !== 'background'`): key `laneKey('subagent', parentToolUseId)`; name `teammateName ||
       agentType || description || 'Sub-agent'`; `agentType`; `openRequestIds` = permissions with `agentToolCallId ===
       parentToolUseId`; status `subagentStatusWord`; `startedAt` `null` (§4.7: no start time); `endedAt` `null`;
       `activity` `lastToolName ?? null`.
     - CLI lane: key `laneKey('cli', agentId)`; name `displayName || cli` (same rule as `compact-lane-rows.ts:68`; today
       the strip showed `cli`, Decision C7); `cliId` `cli`; `openRequestIds` = `permissionQueue[].requestId`; status
       `cliLaneStatusWord(status, permissionQueue.length)`; `startedAt`; `endedAt` `completedAt ?? null`; `activity` =
       last non-empty line of the last `segments` entry's `content`, trimmed, else `null` (§9 row "Agent rows").
     - Background sub-agent (`status === 'background'`): key `laneKey('background', parentToolUseId)`; name
       `teammateName || agentType || 'Background agent'`; status `subagentStatusWord`; activity `lastToolName ?? null`;
       no timing.
     - Background-store entry not matching a sub-agent `parentToolUseId === toolCallId` (dedup, E-6): key
       `laneKey('background', toolCallId)`; name `teammateName || agentType || 'Background agent'`; `agentType`;
       status `backgroundAgentStatusWord`; `startedAt`; `endedAt` `completedAt ?? null`; `activity` `agentDescription ??
       null`.
     - No session id -> Orchestrator only (E-3).
  3. `SessionAgentRosterService` (`@Injectable({ providedIn: 'root' })`, `inject()` of `AgentMonitorStore`,
     `BackgroundAgentStore`, `PermissionHandlerService`, `TabManagerService`):
     - `requestsForTab(tabId: string | null): { permissions; questions }` - reads `routingTargetRevision()`, skips
       `surfaceMode`, and applies the `targetsTab` rule of `compact-session-card.component.ts:622-642` (row 25) using
       `findTabByIdAcrossWorkspaces` / `findTabBySessionIdAcrossWorkspaces` (row 26). Part B reuses this; it is the only
       copy outside the compact card (the compact card keeps its private copy; replacing it is outside Part C and is
       recorded as a follow-up in Decisions).
     - `roster(tabId: string | null): readonly SessionAgent[]` - resolves the tab (`claudeSessionId`, `status`), reads
       the three store signals and `requestsForTab`, calls the builder. A plain method that reads signals; callers wrap
       it in their own `computed` (no per-tab cache, nothing to release). Unknown tab -> Orchestrator only with status
       `null`.
  4. `ownedBySession` moves unchanged to `owned-by-session.ts` and is exported; canvas imports it from
     `@ptah-extension/chat`.
- Verified contracts and entry points: rows 6, 9-17, 22-26.
- Dependencies: `@ptah-extension/chat-streaming` (stores, `PermissionHandlerService`), `@ptah-extension/chat-state`
  (`TabManagerService`), `@ptah-extension/chat-ui` (types and mappers), `@ptah-extension/shared` (request types),
  `laneKey` from the same lib (`compact-lane-rows.ts`). All edges exist (row 31).
- Integration points: dock (Component 6) via `@ptah-extension/chat`; Part B aggregate via `roster` /
  `requestsForTab`.
- Failure behaviour: missing optional fields fall back as listed (never invented); an unresolved owner excludes the
  agent (strict ownership, E-3); a request whose tab cannot be resolved is not counted for this tab (same as compact
  card).
- Quality requirements: O(agents + requests) per evaluation; the background dedup uses a `Set` of sub-agent
  `parentToolUseId`s instead of today's nested `some` (same result).
- Verification seam: `buildSessionAgentRoster` is pure; covered through the existing dock spec (membership cases at
  `canvas-lane-tabs.component.spec.ts:27`, `:75`, `:101`, `:119`, `:135`, `:148`) with mocked stores, tab manager and
  permission handler.
- Files:
  - CREATE `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts`
  - CREATE `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.service.ts`
  - CREATE `libs/frontend/chat/src/lib/services/session-agents/owned-by-session.ts`
  - MODIFY `libs/frontend/chat/src/lib/services/index.ts` (append exports: `SessionAgent`, `buildSessionAgentRoster`,
    `SessionAgentRosterService`, `ownedBySession`)

### 3. Monogram helpers on the ui barrel (ui)

- Purpose: let the circular avatar reuse the existing monogram rule instead of copying it.
- Responsibilities: add `monogramGlyph` and `monogramTintClass` to the `export { ... }` of
  `libs/frontend/ui/src/lib/native/monogram-tile/index.ts` (row 33). Nothing else changes.
- Verified contracts: row 33; the R7 barrel rule (`native/index.ts` is a pure list of `export * from` lines) is not
  touched.
- Dependencies: none new. Integration: Component 1. Failure behaviour: n/a.
- Quality: the helpers import no artwork, so the chat-ui boundary spec (row 32) stays green.
- Verification seam: `nx lint` / `nx test` of `@ptah-extension/ui` and the chat-ui boundary spec.
- Files: MODIFY `libs/frontend/ui/src/lib/native/monogram-tile/index.ts`

### 4. Compact lane status delegation (chat)

- Purpose: keep one status mapping (check 2) without changing the compact card.
- Responsibilities: `laneStatus` in `compact-lane-rows.ts:43-49` is replaced by a `toCompactLaneStatus(word:
  AgentStatusWord): CompactLaneStatus` adapter (`failed` -> `error`, `queued` -> `waiting`, others identical) applied to
  `cliLaneStatusWord(agent.status, agent.permissionQueue.length)` and `subagentStatusWord(agent.status, false)`. The
  compact output is identical for every input (`pending` / `paused` -> `queued` -> `waiting`, as today).
- Verified contracts: rows 17-18.
- Failure behaviour: n/a (pure).
- Verification seam: existing `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.spec.ts`
  passes unchanged (that is the proof of identical output).
- Files: MODIFY `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts`

### 5. Dock hover / focus card and `N agents ›` menu (canvas)

- Purpose: the two dock overlays of D35 and the menu of req. 19.9, as presentational children of the dock.
- Responsibilities:
  1. `AgentDockCardComponent` `ptah-agent-dock-card` (standalone, OnPush): inputs `agent = input.required<
     SessionAgent>()`, `durationText = input<string | null>(null)`, `cardId = input.required<string>()`. Renders
     `role="tooltip"` `[id]="cardId()"`: avatar 32, name, kind label, status word (state ink, `waiting` / `failed`, never
     `Needs you` / `Error`), duration, activity (omitted when `null`), hint `Click to view this thread` with
     `MousePointerClick`. No controls, no tab stop (D35). Emits `pointerenter` / `pointerleave` through outputs
     `hovered = output<boolean>()` so the dock keeps it open while the pointer is over it (WCAG 1.4.13).
  2. `AgentDockMenuComponent` `ptah-agent-dock-menu` (standalone, OnPush): wraps `ptah-native-dropdown` (row 36) with
     `[panelRole]="null"`, `hasBackdrop` true, `closeOnBackdropClick` true. Inputs: `agents = input.required<readonly
     SessionAgent[]>()` (all agents, dock order), `hidden = input.required<readonly SessionAgent[]>()`, `selectedKey =
     input.required<string>()`, `compact = input(false)`, `now = input.required<number>()`. Output `select =
     output<string>()`.
     - Trigger: `<button type="button" aria-haspopup="menu" [attr.aria-expanded]>` at least 24 x 24 (38 px high chip):
       label `{N} agents ›` (`N` = all agents), or a count badge when `compact`; inside it a decorative pile of the
       hidden agents' avatars (24 px, `aria-hidden`), or the lucide `Users` icon when nothing is hidden; pip (`aria-
       hidden`) in `state-need` ink when any hidden agent is `waiting`, else `state-err` when any is `failed`.
       Accessible name: `{N} agents`, plus `, {w} waiting, needs you` and / or `, {f} failed` counted over HIDDEN agents
       (Delta 2 "Overflow"). Always enabled, also when nothing is hidden (req. 19.9).
     - Panel: `role="menu"` `aria-label="Agents"`, `max-h-[340px] overflow-y-auto`; group headings (`role="presentation"`
       text: `Orchestrator`, `Sub-agents {n}`, `CLI lanes {n}`, `Background {n}`); rows `role="menuitemradio"`
       `[attr.aria-checked]="key === selectedKey"` with avatar 24, name, status word, duration; selected row has the
       2 px gold bar (`bg-secondary`).
     - Keys on the panel (all `preventDefault` + `stopPropagation`, so the Rail handler never sees them): Up / Down
       (wrap), Home / End, Enter / Space -> `select.emit(key)` and close, Escape -> close and focus the trigger, Tab ->
       close (no `preventDefault`, focus moves on). On open, focus the checked row (else the first). Roving `tabindex`
       inside the panel (`0` on the active row, `-1` others).
- Verified contracts: rows 16, 36, 37; design-spec Delta 2 "Switcher" and "Hover and focus card".
- Dependencies: `@ptah-extension/chat-ui` (avatar, words, formatter), `@ptah-extension/chat` (`SessionAgent`),
  `@ptah-extension/ui` (`NativeDropdownComponent`), `lucide-angular` (`MousePointerClick`, `Users`, `ChevronRight`).
- Integration points: only the dock (Component 6) renders them.
- Failure behaviour: empty `hidden` -> `Users` icon, no pip; `agents` always contains the Orchestrator.
- Quality requirements: menu and card transitions 0 ms under reduced motion; every target at least 24 x 24; focus ring
  2 px `focus-visible` in the focus token with 2 px offset (§8.4).
- Verification seam: through the dock spec (menu open / Enter selects / Escape returns focus; card has
  `role="tooltip"` and the tab's `aria-describedby` points at it).
- Files:
  - CREATE `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-card.component.ts`
  - CREATE `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts`

### 6. Agent dock: `ptah-canvas-lane-tabs` rewritten as option B (canvas)

- Purpose: the main-view thread switcher (req. 19) with every capability of parity E-1..E-18.
- Responsibilities:
  1. Contract (E-1): same file, class `CanvasLaneTabsComponent`, selector `ptah-canvas-lane-tabs` (e2e row 21), standalone,
     OnPush. Inputs `tabId = input<string | null>(null)` (replaces `sessionId`, Decision C6), `panelId =
     input('canvas-lane-panel')`, `laneKey = input('orchestrator')`; output `laneSelected = output<string>()`.
  2. Data: `agents = computed(() => this.roster.roster(this.tabId()))` (Component 2).
  3. Selection (E-8, verbatim from `:164-177`): `selectedKey` over all roster keys (not only visible ones), `sub:` <->
     `bg:` migration, else `orchestrator`; the effect that emits the corrected key stays.
  4. Overflow (E-9 changed mechanism, E-10, req. 19.7, 19.10, 19.12): pure helper file `dock-overflow.ts`:
     - `dockCapacity(width: number): number` - number of avatar chips that fit beside the pill, the dividers and the
       menu button: `floor((width - 16 padding - 180 pill reserve - menuWidth - 27 dividers) / 40 step)`, `menuWidth`
       112 px, or 44 px when `width < 480` (compact). Yields 3 at 400 px (pinned four with the pill) and 10 at 760 px
       (8 mock agents fit) - the two widths the spec states.
     - `planDockOverflow(agents, selectedKey, capacity): { visible: readonly SessionAgent[]; hidden: readonly
       SessionAgent[] }` - rank: Orchestrator 0, selected 1, `waiting` 2, `failed` 3, `running` 4, rest 5; stable by
       dock index; take the first `capacity + 1` (the +1 is the selected pill); `visible` is re-emitted in dock order;
       `hidden` in dock order. Strict: a lower rank is never visible while a higher rank is hidden.
     - One `ResizeObserver` on the dock root (per dock instance, not per item) updates a `width` signal; disconnected
       through `DestroyRef` (kept from `:183-192`). `typeof ResizeObserver === 'undefined'` -> width stays at its
       initial `Infinity` (everything visible), as today's guard.
     - The selected agent is always visible by rank 1, which replaces `revealSelected` / `scrollIntoView` and the edge
       mask (`:42-44`, `:88-93`, `:195-214` deleted).
  5. Render (Delta 2 "Switcher"): root `role="tablist"` `aria-label="Lanes"` (E-11), no horizontal scroll; groups in dock
     order separated by 1 px rules (`bg-[var(--surface-border-strong)]`, `aria-hidden`); selected agent = expanded
     gold-bordered pill (38 px high, avatar 28 + name + status word + duration, `max-w-[180px]`, name truncates);
     every other visible agent = avatar chip (`button`, 38 x 38, avatar 28, hover fill). Each tab keeps `role="tab"`,
     `id = {panelId}-tab-{key}`, `aria-selected`, `aria-controls = panelId`, roving `tabindex` (E-11, E-12), and
     `aria-label = agentAccessibleLabel(...)` (req. 19.2). Then `ptah-agent-dock-menu` (Component 5).
  6. Keyboard (E-12, req. 19.4): `onKeydown` keeps `:216-239` over the VISIBLE keys: Left / Right wrap, Home / End,
     `preventDefault` + `stopPropagation`, `laneSelected.emit`, then focus the tab with id `tabId(next)` in
     `afterNextRender({ injector })` (the pill and the chip are different elements, so the element is looked up after
     the re-render). Escape while the card is open: close the card, `stopPropagation`, focus and selection unchanged
     (req. 19.6).
  7. Click / tap (E-13, req. 19.3, 19.14): `laneSelected.emit(key)`; menu `select` -> `laneSelected.emit(key)` then focus
     the selected tab after render.
  8. Hover / focus card (D35, req. 19.5, 19.6): signal `cardKey: string | null`; one `setTimeout` handle (220 ms) on
     `pointerenter` with `pointerType !== 'touch'`; immediate open on `focus` when the tab `matches(':focus-visible')`;
     close when the pointer leaves both tab and card (card `hovered` output) and focus is not on the tab; one
     `ptah-agent-dock-card` rendered for `cardKey` with id `{panelId}-agent-card`; only that tab carries
     `aria-describedby` to it; placement through a component-provided `FloatingUIService.position(tabEl, cardEl, {
     placement: 'bottom-start' })` (row 37), `cleanup()` on close and destroy; the timer is cleared on leave, on close
     and through `DestroyRef`. A document-level Escape (host listener `(document:keydown.escape)`) closes a
     hover-opened card only when one is open.
  9. Clock: one `now` signal driven by one `setInterval(1000)` that runs only while some roster agent is `running` with
     a `startedAt`; started / stopped by an `effect`, cleared through `DestroyRef`. Durations: running ->
     `now - startedAt`; finished -> `endedAt - startedAt`; no `startedAt` -> no duration; text via
     `formatAgentDuration`.
  10. Status changes (req. 19.13) re-render avatars and words through signals; focus and selection are untouched (no
      effect moves focus on data changes).
- Verified contracts and entry points: rows 5, 12-21, 35-37.
- Dependencies: `@ptah-extension/chat` (`SessionAgentRosterService`, `SessionAgent`), `@ptah-extension/chat-ui`
  (avatar module), `@ptah-extension/ui` (`FloatingUIService`), Component 5. Direction canvas -> chat / chat-ui / ui
  exists (row 31). The dock stops importing `AgentMonitorStore` / `BackgroundAgentStore` directly.
- Integration points: `canvas-focus-area.component.ts:56-61` binds `[tabId]="id"` instead of `[sessionId]` (other
  bindings unchanged); `CanvasDetailService.laneKeyFor` / `selectLaneFor` unchanged.
- Failure behaviour: unknown tab / no session -> Orchestrator only; zero width (hidden pane) -> capacity 0 -> pill +
  menu; `ResizeObserver` absent -> all visible; a selected key that disappears -> fallback rule emits the corrected key.
- Quality requirements: req. 19.12 at 400 px (24 x 24 targets, no overlap, no horizontal scrollbar, no clipped
  target); focus ring per §8.4; reduced motion via the avatar's styles and 0 ms overlay transitions; one observer, one
  timer for the card delay, one interval for the clock, each released on destroy (runtime-cost rule).
- Verification seam: `canvas-lane-tabs.component.spec.ts` (updated) with mocked stores, `TabManagerService` and
  `PermissionHandlerService` and the real roster service; visual check at 400 / 760 px (`capture-delta2.mjs checks` is
  the designer's audit, not part of this plan's commands).
- Files:
  - REWRITE `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`
  - CREATE `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts` (binding `[tabId]="id"`)
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (import `ownedBySession` from
    `@ptah-extension/chat`)
  - MODIFY `libs/frontend/canvas/src/lib/canvas-needs-you-queue.ts` (same import change)
  - DELETE `libs/frontend/canvas/src/lib/canvas-detail/lane-owner.ts`
  - MODIFY (spec) `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts`
  - MODIFY (spec) `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts` (stub input
    `sessionId` -> `tabId`)

## Parity map (E-1..E-18 and the AGENTS tile)

| Row | Capability | Decision | New location (component) |
| --- | --- | --- | --- |
| E-1 | Inputs `panelId`, `laneKey`, output `laneSelected`, parent binding | keep; `sessionId` -> `tabId` (C6) | Comp. 6 item 1; `canvas-focus-area.component.ts` binding |
| E-2 | Orchestrator first, no group label | keep | Roster first entry (Comp. 2); dock first item, `Workflow` avatar (Comp. 1, 6) |
| E-3 | Ownership filter; no session -> Orchestrator only | keep | `ownedBySession` in chat; `buildSessionAgentRoster` (Comp. 2) |
| E-4 | Sub-agent key / label fallback | keep | Roster (Comp. 2); role icon (Comp. 1) |
| E-5 | CLI lane key, each lane once | keep; label `displayName || cli` (C7) | Roster (Comp. 2); provider mark / monogram (Comp. 1) |
| E-6 | Background entries + dedup by `toolCallId` | keep | Roster (Comp. 2) |
| E-7 | Fixed group order, empty groups hidden, group labels | move | Dock dividers (Comp. 6) and grouped menu headings with counts (Comp. 5) |
| E-8 | Selection fallback `sub:` <-> `bg:`, else Orchestrator; parent told | keep | Comp. 6 item 3 (verbatim) |
| E-9 | Horizontal scroll + edge fade | move (changed mechanism, PM-15) | `dock-overflow.ts` + `N agents ›` menu (Comp. 5, 6) |
| E-10 | Selected kept in view; observer disconnected | keep | Rank 1 in `planDockOverflow`; one `ResizeObserver` released on destroy (Comp. 6 item 4) |
| E-11 | `tablist` / `tab` ARIA, ids, `aria-controls` | keep (+ accessible name, `aria-describedby`) | Comp. 6 item 5, 8 |
| E-12 | Roving tabindex, arrows wrap, Home / End, stop propagation, automatic activation | keep | Comp. 6 item 6; menu keys added (Comp. 5) |
| E-13 | Click selects | keep | Comp. 6 item 7; menu rows (Comp. 5) |
| E-14 | Selected / hover visuals | move | Gold pill with name, word, duration; hover fill; 24 px targets (Comp. 6 item 5) |
| E-15 | Raw status as `title`, decorative dot | move | Ring + badge + word in avatar, word in `aria-label` and card (Comp. 1, 5, 6) |
| E-16 | `◇` / `›_` / `≋` kind glyphs | keep (changed visual) | `ptah-agent-avatar` for chips (Part A), AGENTS rows (Part B), dock (Part C); the compact card's own glyphs are not in Part C |
| E-17 | Orchestrator fixed `running` | move | `orchestratorStatusWord(tab.status, ...)` through the roster (Comp. 1, 2) |
| E-18 | Strip below the focus header | keep | Same selector and mount point (`canvas-focus-area.component.ts:56`) |
| AGENTS tile (§4.7 / options §2.4) | avatar 32 + ring + badge, word, duration, kind badge on line 2, activity, permission line | Part B renders the row | Part C supplies `ptah-agent-avatar` (size 32), `SessionAgent` (name, kind, status, timing, activity, `openRequestIds`), `AGENT_KIND_LABEL`, `agentAccessibleLabel`, `formatAgentDuration` |

## Integration architecture

- Data flow: SDK / CLI events -> `AgentMonitorStore` / `BackgroundAgentStore` / `PermissionHandlerService` (unchanged)
  -> `SessionAgentRosterService.roster(tabId)` (resolves tab via `TabManagerService`, targets requests, calls
  `buildSessionAgentRoster`, which calls the chat-ui mappers) -> consumers: the dock `computed` (canvas) and Part B's
  aggregate `computed` (chat) -> views render `ptah-agent-avatar` + words. Selection: dock / menu click or key ->
  `laneSelected` -> `CanvasDetailService.selectLaneFor` (unchanged) -> `laneKeyFor` -> dock `laneKey` input and the lane
  view.
- State or persistence: none new. Dock-local UI state only (`width`, `cardKey`, menu open, `now`), owned by the dock
  instance and released on destroy. No persisted field, no backend call (G1 of §9.1).
- External boundaries: none; all inputs are in-process store signals. Lane CLI output text used as the activity line is
  rendered by interpolation (no `innerHTML`).
- Failure and rollback: every absent field is hidden (`null`), never invented; unknown ids fall back to `Bot` /
  monogram; an unknown tab yields the Orchestrator alone; the change is UI-only and reverts by reverting the files.
- Observability: not applicable (pure UI derivation); a wrong status is observable in the dock spec and in the
  `aria-label` of each tab.

## Architecture-level quality requirements

- Functional: req. 18.1-18.11 and 19.1-19.16 (with 18.4 satisfied through 18.5 because no provider id exists); one
  status word per agent across chip, AGENTS row, dock, card and menu (all derive from the roster or the same mappers);
  displayed words are `running`, `waiting`, `done`, `failed`, `stopped`, `queued` only.
- Performance: roster is linear in agents + requests and recomputes only when a read signal changes; at most one
  observer, one card timer and one 1 s interval per dock (bounded by pane count); infinite animations use `transform`
  / `opacity` only; ~24 lucide icons imported by name.
- Security: no `innerHTML`; no new RPC; marks drawn by the existing attribute-only renderer (`ptah-mark-svg`).
- Maintainability: no new library edge (row 31); no `BrandMarkComponent` in chat-ui (row 32); one table each for
  `cliId -> providerId`, role icons and status mapping, with `Record<CliType, ...>` and exhaustive switches; tags and
  depConstraints unchanged.
- Testability: membership, fallback, keyboard and overflow behaviour asserted in the existing dock spec; compact
  output identity asserted by the existing compact-lane-rows spec.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| C1 | Orchestrator avatar always shows lucide `Workflow`; no provider input | add a `providerId` input now; infer from `ContextCapacity.providerId`; default to Claude | rows 1-3; req. 18.5, PM-14; decisions rows 33 / 37 | yes: add one input and one `cliMarkFor`-style lookup when an authoritative field exists |
| C2 | Avatar + vocabulary in `@ptah-extension/chat-ui`; roster in `@ptah-extension/chat` | `ui` (lucide-free, `type:ui`); `canvas` (cycle with chat) | rows 30-31; Part B evidence (inspector hosted by chat) | yes (file moves) |
| C3 | Orchestrator word: `streaming` / `resuming` -> `running`; idle states -> `done`; `fresh` / `draft` -> no word | `stopped` for idle; `queued` for fresh | req. 19.15 ("running only while the session is working"); §3.5 vocabulary has no `idle` | yes (one switch) |
| C4 | Sub-agent `pending` and `paused` -> `queued` (not `waiting`) | keep today's compact mapping (`waiting`) | §4.7: `waiting` carries the `needs you` urgency (pip, count); §3.5 `queued` = not started; Assumption A3 for `paused` | yes; compact card output unchanged by the adapter |
| C5 | `queued` and `null` status: no ring, no badge (word only) | invent a queued glyph | §4.7 lists rings / badges for running, waiting, failed, done, stopped only; req. 18.7 names those five | yes |
| C6 | Dock input `sessionId` replaced by `tabId` | keep `sessionId` and add `tabId` / `tabStatus` | the roster needs the tab (status, request targeting, row 25-26); one source avoids drift; parent already has `id` (row 19) | yes |
| C7 | CLI lane name `displayName || cli` (today the strip showed `cli`) | keep raw `cli` | `compact-lane-rows.ts:68` uses the same rule; spec examples show `Antigravity`, `Codex` | yes |
| C8 | Strict priority wins over the "pinned four" example at 400 px | always pin first `waiting` and first `failed` | req. 19.7 strict order; the Delta 2 line describes the mock with one of each | yes |
| C9 | Background-command visuals (dashed border, `SquareTerminal`) not built | build an unused variant | §9 "live shells are not exposed"; req. 18.3 gives background agents role icons; no data source | yes |
| C10 | After menu Enter, focus moves to the newly selected dock tab; Escape returns focus to the button | keep focus on the button after Enter | req. 19.9 specifies Escape only; the selected agent becomes the visible pill | yes |
| C11 | Up / Down in the menu wrap | stop at ends | consistency with the dock's wrapping arrows (E-12) | yes |

Follow-up (not in Part C): the compact card keeps a private copy of the tab-targeting rule
(`compact-session-card.component.ts:622-642`); it can call `SessionAgentRosterService.requestsForTab` later.

## Team-leader handoff

- Recommended executors: frontend-developer for all components (Angular standalone / OnPush / signals / lucide work in
  webview libs).
- Complexity: MEDIUM-HIGH - three libs, a pure roster with exact membership parity, a keyboard / overlay component with
  WCAG 1.4.13 behaviour, and spec rewrites; no backend.
- Dependencies and ordering (component level): Components 1 and 3 first (types and helpers); Components 2 and 4 depend on
  1; Components 5 and 6 depend on 1 and 2. Part A and Part B consume 1 and 2, so 1 and 2 should land before their
  consumers.
- Parallel-safe work: Component 3 (ui) is file-disjoint from Component 1 (chat-ui) but Component 1 imports its export;
  Component 4 is file-disjoint from Component 2 (same lib). Suggested file-disjoint batches:
  - C-1 (chat-ui + ui): Components 1 and 3.
  - C-2 (chat): Components 2 and 4.
  - C-3 (canvas): Components 5 and 6.
- Files affected:
  - CREATE: `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.types.ts`, `agent-status.ts`,
    `agent-duration.ts`, `agent-marks.ts`, `agent-avatar.component.ts`;
    `libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts`, `session-agent-roster.service.ts`,
    `owned-by-session.ts`; `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-card.component.ts`,
    `agent-dock-menu.component.ts`, `dock-overflow.ts`.
  - MODIFY: `libs/frontend/chat-ui/src/index.ts`; `libs/frontend/ui/src/lib/native/monogram-tile/index.ts`;
    `libs/frontend/chat/src/lib/services/index.ts`;
    `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.ts`;
    `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts`;
    `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`;
    `libs/frontend/canvas/src/lib/canvas-needs-you-queue.ts`; specs listed below.
  - REWRITE: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts`.
  - DELETE: `libs/frontend/canvas/src/lib/canvas-detail/lane-owner.ts`.
- Files that may overlap with Part A / Part B: `libs/frontend/chat-ui/src/index.ts` (append-only export lines; Part A
  said it adds none, Part B may); `libs/frontend/chat/src/lib/services/index.ts` (append-only; Part B adds its
  aggregate exports); `compact-lane-rows.ts` (Part B reads `buildLaneSummary`; Part C changes only `laneStatus`);
  `canvas-focus-area.component.ts` (Part C changes one binding; check whether Part B mounts anything there).
- Existing specs whose assertions change because of intended behaviour (no new spec files):
  - `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts`: providers add `TabManagerService`
    (`findTabByIdAcrossWorkspaces`, `findTabBySessionIdAcrossWorkspaces`) and `PermissionHandlerService`
    (`permissionRequests`, `questionRequests`, `targetTabsFor`, `questionTargetTabsFor`, `routingTargetRevision`) mocks;
    `setInput('sessionId', ...)` -> `setInput('tabId', ...)` with a tab whose `claudeSessionId` is `owner` (`:58`,
    `:85`, `:105`, `:123`, `:138`, `:155`, `:172`, `:198`, `:221`); `:72` `title` = status -> the tab's `aria-label`
    contains the status word (`done` for `completed`); `:27` group order now via dividers and menu headings; `:184`
    and `:214` (`scrollIntoView`, edge update) -> ResizeObserver callback recomputes capacity and the selected tab stays
    rendered, observer disconnected on destroy; `:162` arrow keys unchanged in intent (visible tabs). Add assertions
    inside existing cases where natural: orchestrator word follows `tab.status`; overflow keeps a `waiting` agent and
    hides a `done` one at small width.
  - `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts:59-69`: stub input `sessionId` ->
    `tabId`.
  - Expected unchanged: `compact-lane-rows.spec.ts`, `canvas-lane-view.component.spec.ts`,
    `canvas-needs-you-queue` spec(s) (import path only in sources), chat-ui `dependency-boundaries.spec.ts`.
  - Not run in this task: `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:150-154` (selector kept).
- Verification points (one heavy check at a time; `--parallel=1`, `--maxWorkers=2`; never workspace-wide; no build /
  serve / e2e):
  - C-1:
    `node .ptah/tmp/check-run.mjs c1-chatui-test -- npx nx test @ptah-extension/chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`;
    `node .ptah/tmp/check-run.mjs c1-chatui-tc -- npx nx typecheck @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`;
    `node .ptah/tmp/check-run.mjs c1-chatui-lint -- npx nx lint @ptah-extension/chat-ui --parallel=1 --skip-nx-cache`;
    `node .ptah/tmp/check-run.mjs c1-ui-test -- npx nx test @ptah-extension/ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`;
    `node .ptah/tmp/check-run.mjs c1-ui-lint -- npx nx lint @ptah-extension/ui --parallel=1 --skip-nx-cache`.
  - C-2:
    `node .ptah/tmp/check-run.mjs c2-chat-lanes -- npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/compact-session/compact-lane-rows.spec.ts --coverage=false --maxWorkers=2`;
    `node .ptah/tmp/check-run.mjs c2-chat-tc -- npx nx typecheck @ptah-extension/chat --parallel=1 --skip-nx-cache`;
    `node .ptah/tmp/check-run.mjs c2-chat-lint -- npx nx lint @ptah-extension/chat --parallel=1 --skip-nx-cache`.
  - C-3:
    `node .ptah/tmp/check-run.mjs c3-canvas-test -- npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`;
    `node .ptah/tmp/check-run.mjs c3-canvas-tc -- npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache`;
    `node .ptah/tmp/check-run.mjs c3-canvas-lint -- npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache`.
  - Contracts to confirm while implementing: the exact lucide-angular icon data type name for `[img]`; Floating UI
    option names (`floating-ui.service.ts:41-84`) for A2; `ptah_get_diagnostics` on every changed file.
  - Review checks: exactly one `cliId -> providerId` table and no per-id branch in any template (req. 18.1); no
    `Needs you` / `Error` status word in any avatar view; no hard-coded vendor for the Orchestrator (risk row,
    task-description:857).

## Open checks

- Exact exported type name of lucide-angular icon data for `[img]` (Component 1 item 6) - implementer opens the
  `lucide-angular` typings before use.
- Assumption A2 (hover card clipping) - visual review at 400 / 760 px in Rail and in a split pane.
- Assumption A3 (`paused` semantics) - code-logic reviewer.
- Whether Part B mounts anything in `canvas-focus-area.component.ts` (overlap check by the team-leader).

## Clarifications Needed

None. No user-reserved item: the work is frontend-only, adds no lane type and removes no capability.
