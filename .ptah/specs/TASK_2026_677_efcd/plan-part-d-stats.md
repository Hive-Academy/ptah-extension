# Plan part D - Delta 3: session stats, plan limits, lanes and the tray move into the inspector

Root for every relative path: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\`.
`F/` = `libs/frontend/`. Frontend only: no backend call, no new RPC, no stored field, no new Nx project, no new
spec file. Merged into `implementation-plan.md` (§2.1, §2.2 D1-D6, §3.1, §3.3, §4, §5, §6.2 M-7..M-12, §8, §9);
where the two disagree, `implementation-plan.md` wins.

## D0 Inputs and constraints

- Requirements: `task-description.md` req 21 (21.1-21.28, lines 827-977), PM-17..PM-21; `design-spec.md` Delta 3
  (D3.1-D3.9, lines 1369-1597) and D44-D56 (lines 1101-1113) as revised in round 1;
  `design-spec-review-delta3-r1.md` (APPROVED 9/10, rulings, one Minor on `prototype/DELTA-3-NOTES.md:27,35`);
  `parity-inventory.md` C-2..C-6 (84-88), C-19..C-50 (112-144), C-48b (142), C-49 (143); `decisions.md` rows 50, 54,
  56, 57, 59, 60, 61, 62, 64; execution state: W1, W2 COMPLETE; W3 NOT STARTED (`decisions.md` row 62, authoritative:
  "W3 not started ... Start W3 after ... Gate 2 delta passes"). `batches.md` shows B-3, C-3, A2-1 as IN_PROGRESS only
  because MODE 2 flagged the next wave; no executor ran.
- Corrections applied: the Minor note of r1 (DELTA-3-NOTES rows 27 and 35 are superseded): implementers follow
  `design-spec.md:1509-1514` (model in the AGENTS row) and `delta3.js:50-53,214-219` (status / evidence / cooldown
  tiles drawn), never those two notes rows.
- Constraint (dependency, not execution state): B-3 and A2-1 are NOT amended although they have not started. Every
  delta 3 contract they would need (`SessionLimitSummary`, `ContextRingComponent`, `limitAwareDot`) is built by D-1
  in the SAME wave W3; amending them would make B-3 / A2-1 depend on D-1 and serialize W3. Delta 3 work that touches
  their files is placed in later batches as named second owners (§D6, D-8) or composed outside them (D-7).
- Missing decision-critical input: none. One code fact contradicts the task prompt ("the components STAY"): the tray
  component has exactly one host (chat-view), so it becomes dead code. USER approved its removal (R2, option (a),
  `decisions.md` row 64); CV-1 deletes it (see "Proposed Removals", now approved).

## D1 Codebase evidence

| # | Evidence | Location | Implication |
| --- | --- | --- | --- |
| 1 | The strip mount passes six inputs | `F/chat/src/lib/components/templates/chat-view.component.html:35-51` (element at :42) | The SESSION / PLAN LIMITS / LANES sections take the same six values. |
| 2 | The tray mount, `[sessionId]="traySessionId()"` | `chat-view.component.html:53-64` (element at :60); `traySessionId` / `showBackgroundStrip` `chat-view.component.ts:554-564` | Removing the mount leaves `traySessionId` / `showBackgroundStrip` unused in chat-view. |
| 3 | Stats sources are chat-view computeds over the tab | `chat-view.component.ts:1023-1042` (`resolvedSessionStats`, `resolvedLiveModelStats`, `resolvedCompactionCount`), `:1083-1100` (`resolvedStatsLimits`), `:1105` (`resolvedSessionBudget` = `SessionBudgetActionsService.budget`, which is `tab.sessionBudget`, `session-budget-actions.service.ts:113-115`) | Every value is a function of `TabState` (scoped view) or `ChatStore` (main panel: `resolvedTab()` is null, `:948-953`) + root stores; the same derivation, moved, runs in both hosts. |
| 4 | Plan-limits scope is a FIELD of chat-view, not of the strip | `chat-view.component.ts:1044-1049` (`registerScope(inject(DestroyRef))`); update effect `:1328-1337` with `sessionRunOwnerKeys` `:1073-1076` | C-39 survives the mount removal untouched; the scope is released with the view. Do not add a scope in the inspector. |
| 5 | `registerScope` semantics: union of live scopes, release on destroy, release does not reload | `F/core/src/lib/services/plan-limits.store.ts:144-164` | A second registration (Rail board) is unnecessary: each Rail tile's chat-view already registers its session. |
| 6 | Module-level helpers live in the chat-view file and are imported by its spec | `chat-view.component.ts:142-157` (`toStatsLimitLaneRun`), `:160-167` (`recordedOwnerKeys`), `:169-171` (`sameStrings`); spec import `chat-view.component.spec.ts:68`, cases `:1792-1840` | Moving them changes one spec import (CV-1). |
| 7 | `buildStatsLimitViewModel` and `StatsLimitViewModel` are public chat-ui API | `F/chat-ui/src/index.ts:95-100`; VM `stats-limit-view-model.types.ts:215-227`; indicator `:125-129` (`state: 'at-limit' \| 'near-limit'`); subgroup `state: LaneLimitState`, `stateChip` `:169-177` | The session limit summary is a pure function of the VM (D3.7). |
| 8 | `indicator` comes from the session plan only; lanes are separate | `stats-limit-view-model.ts:43-68` | A lane-only limit has no indicator: the summary must also scan `laneTiles[].subgroups[]`. |
| 9 | Strip tooltip / label logic lives in component computeds | `F/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:140-380` (`hasKnownContextWindow` :193, `contextPercentLabel` :220, `primaryModelName` :250, `knownSubtotal` :265, `agentCount` :276, `durationMs` :282, `costTooltip` :316, `tokenTooltip` :325, `contextTooltip` :354, `knownSubtotalTooltip` / `agentsTooltip` :186-190, `lanesAriaLabel` :166) | Verbatim text in the inspector requires ONE pure source both hosts read; extract, do not copy. |
| 10 | Plan / lane tiles are presentational with `tile`, `open`, `toggled` | `plan-limits/plan-limit-tile.component.ts:173-179`, `lane-usage-tile.component.ts:195-199`, `lane-subtotal-tile.component.ts:52-54`, `plan-window-detail.component.ts:114-120` | Reused inside chat-ui by relative import; none is exported from the barrel, so the new sections must live in chat-ui. |
| 11 | Lane plan-tile chips are static spans today | `lane-usage-tile.component.ts:150-160` (`data-testid="lane-plan-tile-chip"`) | D3.5 "opens and focuses that plan tile" needs an opt-in input/output; the strip keeps the span. |
| 12 | Expansion store is view-scoped, keyed by session + tile id | `plan-limits/stats-tile-expansion.state.ts:3-42`; provided by chat-view `chat-view.component.ts:249-255`; strip falls back to a private instance (`session-stats-summary.component.ts` `inject(StatsTileExpansionState, { optional: true }) ?? new ...`) | The inspector rendered inside chat-view inherits it; the Rail board must provide one. |
| 13 | Population summary grammar lives in the strip component | `F/chat-ui/src/lib/molecules/background-agent-strip.component.ts:491-514` (`summaryText`); entry type `:40-60` (no model field) | Extract to a pure function used by the strip and AGENTS. |
| 14 | Tray mapping, scope and the five actions are component code | `F/chat/src/lib/components/organisms/background-agent-tray.component.ts:29-40` (`StripContext`), `:54-145` (label / status helpers), `:196-224` (`context` map, scope via `agentVisibleInSession`, dedupe by `toolCallId`, background wins), `:245-335` (`fromSubagent`, `fromBackground` with `stoppable`, `canBackground`, `canViewTranscript`, `steerable`), `:338-383` (focus, steer, stop, background, transcript) | Move into a chat service the AGENTS section reads; one copy. |
| 15 | Tray has ONE host | grep: only `chat-view.component.html:60` and `chat-view.component.ts:34,231` reference `BackgroundAgentTrayComponent`; `canvas-lane-view.component.ts:124` mounts the presentational `ptah-background-agent-strip`, not the tray; `harness-builder-view.component.ts:400` mounts the stats strip | Strip and stats summary stay (PM-17); the tray component is orphaned (Proposed Removals). |
| 16 | Roster rows are the AGENTS data; keys are `laneKey(kind, id)` | `F/chat/src/lib/services/session-agents/session-agent-roster.ts:22-31` (`SessionAgent`, no model / tokens), `:132`, `:161`, `:182`; `laneKey` `compact-lane-rows.ts:32-34` | Join tray context and model to rows by roster key; no roster change (C-2 is closed). |
| 17 | Model sources | `F/chat-streaming/src/lib/agent-monitor.store.ts:141` (`SubagentUsageTotals.model`), `:613` (`SubagentRecord.usage`), `:448` (`MonitoredAgent.model`), `:891` (`agentsOwnedBySession`) | Frontend-only model for Claude sub-agents and CLI lanes (D3.6). |
| 18 | Bubble footer model badge | `F/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts:515-523` (badge), `:889-904` (`rawModelId`, `modelDisplayName`) | Removed from the transcript (C-49 move). |
| 19 | Steer input contract | `F/chat-ui/src/lib/molecules/agent-steer-input.component.ts:24,66-73` (`steerable`, `pending`, `placeholder`, `steer`); exported `F/chat-ui/src/index.ts:44` | AGENTS reuses it unchanged. |
| 20 | `ProviderMarkComponent` comes from `@ptah-extension/ui` | used by `F/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.component.ts:129` | PLAN LIMITS provenance mark follows the avatar's import. |
| 21 | Header contract (A2-1, not started, `decisions.md` row 62) | `plan-part-a2-header.md:34-35` (`inspectorDot: 'need' \| 'sel' \| null`, `needsYouCount`, `inspectorOpen`, `toggleLabel`), binding `:168-170` | Delta 3 widens `inspectorDot` and adds three inputs: CV-2 is the second owner of the header file. |
| 22 | Inspector contract (B-4, pending) | `plan-part-b-inspector.md:214-219` (`OrchestratorCardModel` with model / context / tokens / cost / turns), `:310-330` (component inputs; optional `usage` input) | B-4 is amended: the card shrinks (D3.2) and `usage` is replaced by `stats`. |
| 23 | e2e showcase scenes locate the strip in chat-view | `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:154`, `chat-code-edit.scene.ts:121` | They break when the mount goes; not run (no e2e); risk R-D6. |

## D2 Architecture decision

- Chosen approach: (1) ONE pure stats layer in chat-ui (extracted from the strip, which then delegates) plus three
  new chat-ui presentational pieces (SESSION section, PLAN LIMITS + LANES sections, context ring); (2) ONE chat
  injection-context factory `injectSessionStatsSource()` that both hosts (chat-view, Rail board) call to build the
  six values plus the derived context cue and session limit summary; (3) the tray's mapping and actions move into a
  chat service that the inspector AGENTS section reads, joined to roster rows by key; (4) chat-view loses the two
  mounts; the header gets the closed-state cues from the same source object.
- Rationale: req 21.28 and risk "two reads that disagree" (task-description:1053) demand one derivation; evidence 9
  and 14 show today's logic is inside components, so it must be lifted, not copied. Evidence 10 forces the sections
  into chat-ui (tiles are not exported). Evidence 3-5 show the values are pure functions of `TabState` (or ChatStore
  in the main panel, `chat-view.component.ts:1023-1042`) + root stores,
  so the Rail board can build them without a chat-view (req 21.1 "either host"; Rail tiles lose the strip too).
- Rejected alternatives:
  - chat-view passes its existing `resolved*` computeds as an input and the Rail board passes `null` (Part B's
    `usage` input, `plan-part-b-inspector.md:326`): loses every stat in Rail once the strip leaves the tile.
  - A root per-tab cache service (like `SessionInspectorStore.modelFor`): adds map pruning for a value each host
    reads once; the factory in injection context is enough (two hosts, one call each).
  - Export the plan-limit tiles from chat-ui and build the sections in chat: widens the chat-ui API by five
    components for one consumer; the sections and tiles are one cohesive presentational unit.
  - Recompute near / at from percentages, or render a new chip set: D49 forbids; the engine VM already carries it.
- Assumptions: A-D1 is WITHDRAWN (rev 1): `resolvedTab()` is null in the main panel by construction
  (`chat-view.component.ts:948-953`, no `SESSION_CONTEXT`), and the main panel is exactly where chat-view hosts the
  inspector (`plan-part-b-inspector.md:451`). The source therefore carries today's ChatStore branch (D3-8, D-11).
- Effect on existing code: the strip and the agent strip keep their markup and behaviour (computeds delegate to the
  pure layer; their specs pass unchanged). chat-view drops the two mounts, the stats computeds and three module
  helpers (moved, not re-derived, into D3-8). The tray component becomes a thin delegate in B-4 and is deleted in
  CV-1 with its two specs renamed onto the tray service files (R2, USER-approved, row 64). `inline-agent-bubble`
  loses the model badge.

## D3 Components per lib

### D3-1 chat-ui pure stats layer (NEW, batch D-1)

- Files: CREATE `F/chat-ui/src/lib/molecules/session/session-stats-view.ts`; MODIFY
  `session-stats-summary.component.ts` (computeds delegate; template, inputs, outputs unchanged).
- Contract (pure, no Angular):

```ts
export interface SessionStatsInputs {           // the six values of the removed mount + two derived values
  readonly sessionId: string | null;
  readonly snapshot: SessionStatsEntry | null;
  readonly liveModelStats: LiveModelStats | null;
  readonly compactionCount: number;
  readonly limits: StatsLimitViewModel | null;
  readonly budget: SessionBudgetState | null;
  readonly context: SessionContextCue;          // sessionContextCue(liveModelStats)
  readonly limitSummary: SessionLimitSummary;   // sessionLimitSummary(limits)
}
export interface SessionContextCue {
  readonly hasLive: boolean;        // false -> tile "No data yet", no description part
  readonly known: boolean;          // hasKnownContextWindow rule (component :193-218)
  readonly percent: number | null;  // null when !known; drives ring arc and toggle ring
  readonly label: string;           // contextPercentLabel text, '—' when unknown
  readonly usedTokens: number | null; // null when !known (never printed for unknown)
}
export function sessionContextCue(live: LiveModelStats | null): SessionContextCue;
export function contextDetailsText(live: LiveModelStats | null, compactions: number): string | null;
export function tokenDetailsText(s: SessionStatsEntry | null, b: SessionBudgetState | null): string;
export function costDetailsText(s: SessionStatsEntry | null, b: SessionBudgetState | null): string | null;
export function knownSubtotalOf(s: SessionStatsEntry | null): { value: number } | null;
export function agentCountOf(s: SessionStatsEntry | null): number | null;   // null when 0 / absent
export function durationMsOf(s: SessionStatsEntry | null): number | null;   // null when 0 / absent
export function lanesAriaLabelFor(count: number): string;
export const KNOWN_SUBTOTAL_DETAILS: string; export const AGENTS_DETAILS: string; // :186-190 verbatim
```

  `contextDetailsText` appends the only new copy, `Number of context compactions during this session: {n}`, when
  `compactions > 0` (D3.3). Strings are moved verbatim; the strip's `contextTooltip()` etc. call these functions
  with `compactions = 0` where the strip did not print that line (the strip's own `title` text stays identical).
- Failure: none thrown; unknown -> `null` / `'—'`, never `0` (req 21.5).
- Verification seam: `session-stats-summary.component.spec.ts`, `session-budget-format.spec.ts`,
  `session-stats-format.spec.ts` pass UNCHANGED.

### D3-2 chat-ui session limit summary and cue helpers (NEW, batch D-1)

- File: CREATE `F/chat-ui/src/lib/molecules/session/plan-limits/session-limit-summary.ts`.

```ts
export interface SessionLimitSummary {
  readonly state: 'none' | 'near' | 'at';
  readonly text: string | null;        // winning candidate text
  readonly extra: number;              // further near/at candidates
  readonly source: 'session' | 'lane' | null;
  readonly fullText: string | null;    // text + ` (+{extra} more)` when extra > 0
}
export function sessionLimitSummary(vm: StatsLimitViewModel | null): SessionLimitSummary;
export function inspectorToggleDescription(
  context: SessionContextCue, summary: SessionLimitSummary, needsYou: number): string;
export function limitAwareDot(base: 'need' | 'sel' | null, open: boolean,
  summary: SessionLimitSummary | null): 'need' | 'err' | 'sel' | null;   // null summary = state 'none'
```

  Rules (D3.7, verbatim): candidates = `vm.indicator` (state `at-limit`->at, `near-limit`->near, text
  `indicator.text`) and every `laneTiles[].subgroups[]` with `state` `at-limit` / `near-limit`, text
  `{laneTile.label} · {subgroup.stateChip.text}`; `confirmed-room` and `unknown` are never candidates. Worst wins (at
  before near); a tie keeps the session indicator first, then lane order. Description parts in order, each only when
  true: `Context {round(percent)}%.` / `Context unknown.` (omitted when `!hasLive`), `{fullText}.`, `{n} need you.`;
  joined by one space. `limitAwareDot`: `null` while open; `'need'` when `base === 'need'` (pending request);
  else `'err'` at; else `'need'` near; else `base` (`'sel'` or `null`).
- Assumption A-D2: the exact `LaneLimitState` literals are `at-limit` / `near-limit` / `confirmed-room` / `unknown`
  as the design names them. Check: `lane-tiles.ts` type definition before coding the switch (exhaustive).

### D3-3 `ptah-context-ring` atom (NEW, batch D-1)

- File: CREATE `F/chat-ui/src/lib/atoms/context-ring.component.ts`. Standalone, OnPush.
- Inputs: `percent = input.required<number>()`, `size = input<44 | 28>(44)`. SVG `r=18`/stroke 4 (44) or `r=12`/
  stroke 2 (28), rotated -90 deg, track `--surface-border-strong`, arc `currentColor`; ink class from the 80 / 95
  rule (gold < 80, `--state-ink-need` 80-94, `--state-ink-err` >= 95; PM-21). `host: { 'aria-hidden': 'true' }`:
  progressbar semantics sit on the SESSION tile wrapper (D3.3), the toggle ring is decorative (D3.7). The caller
  renders no ring when `percent` is null. Arc transition 400 ms `--ptah-ease-soft`, none under reduced motion.

### D3-4 `ptah-inspector-session-stats` (NEW, batch D-1)

- File: CREATE `F/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts`
  (template inline or `.html` beside it).
- Contract: `stats = input.required<SessionStatsInputs>()`; `limitsLinkActivated = output<'session' | 'lane'>()`.
  Injects `ModelStateService` (`@ptah-extension/core`, as the strip) for display names and
  `inject(StatsTileExpansionState, { optional: true }) ?? new StatsTileExpansionState()` (strip pattern).
- Renders D3.3 exactly: `section aria-labelledby` (per-instance id), header + `~ = estimate` meta while
  `snapshot.provisional`; limits alert line only when `limitSummary.state !== 'none'` (`AlertTriangle` 14,
  `fullText`, ink by state, 24 px text button `Plan limits` / `Lanes` emitting the source; no `role`); tile grid with
  Context (ring via D3-3, `role="progressbar"` with the D3.3 `aria-valuetext` only when known), Tokens, Cost (with
  `ptah-cost-badge` from the atoms folder), Time (static, `{n} turns` caption only when a turn count is supplied, see
  open check D-O4), Agents; the four `info` disclosure buttons (28 x 28, `aria-expanded`, `aria-controls`,
  `Esc` closes) whose regions show D3-1 texts with `whitespace-pre-line`; open tile `col-span-2`; expansion keys
  `sd-context` / `sd-tokens` / `sd-cost` / `sd-agents` in `StatsTileExpansionState` keyed by `sessionId`; Models row
  (static for one model, disclosure for >= 2) and the stacked per-model panel (D54) from `snapshot.modelUsageList`
  with today's `title`s and a `Total` row (`formatCost(snapshot.totalCost)`).
- No `title` attribute carries detail text. Values update in place; the section adds no `aria-live` region (the
  alert is static text, D3.3; only the PLAN LIMITS refresh notice keeps `role="status"`, req 21.27).

### D3-5 `ptah-inspector-limits-lanes` (NEW, batch D-1)

- File: CREATE `F/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts`.
- Contract: `limits = input.required<StatsLimitViewModel>()`, `sessionId = input<string | null>(null)`;
  public method `focusHeading(which: 'session' | 'lane'): void` (focuses `planH` or `lanesH`, per-instance ids,
  headings carry `tabindex="-1"`). Renders TWO sections: PLAN LIMITS (D3.4: refresh notice first with
  `role="status"`, provenance line with `ProviderMarkComponent` from `@ptah-extension/ui` or lucide `Gauge`,
  `planSectionProvenance` caption / chips once, then `ptah-plan-limit-tile` per `planTiles` entry in VM order) and
  LANES (D3.5: meta `{laneTiles.length} lane(s) · {lanesCount} runs` with `aria-label` = `lanesAriaLabelFor`,
  `sharedLaneCaption` caption, `ptah-lane-usage-tile` per tile with `linkPlanTiles` true, `ptah-lane-subtotal-tile`).
  Each section is omitted under the D3.4 / D3.5 conditions. Expansion through the same `StatsTileExpansionState`
  (tile ids from the VM), so a snapshot push never closes a tile (req 21.15, 21.27). A plan-tile chip request opens
  that plan tile (`setOpen`) and focuses its button.
- Re-skin: host classes and the inspector tile recipe come from the section; where a tile renders its own
  classes that conflict with D3.4 / D3.5 (bar height, chip ink), add an opt-in `variant = input<'strip' |
  'inspector'>('strip')` to THAT tile only; default `'strip'` keeps today's markup byte-identical (open check D-O2).
- MODIFY `plan-limits/lane-usage-tile.component.ts`: `linkPlanTiles = input<boolean>(false)`,
  `planTileRequested = output<string>()` (plan tile id); with `false` the chip stays today's `<span>`.

### D3-6 chat-ui population summary (NEW, batch D-1)

- File: CREATE `F/chat-ui/src/lib/molecules/background-agent-population.ts`:
  `export function backgroundAgentPopulation(entries: readonly BackgroundAgentStripEntry[]): string` = the body of
  `summaryText` (`background-agent-strip.component.ts:491-514`) verbatim; the strip's `summaryText` delegates.
  `background-agent-strip.component.spec.ts` passes unchanged.

### D3-7 chat-ui barrel lines (batch D-1, chat-ui barrel 3rd owner, append-only)

Append to `F/chat-ui/src/index.ts`: `ContextRingComponent`, `InspectorSessionStatsComponent`,
`InspectorLimitsLanesComponent`, `sessionContextCue`, `sessionLimitSummary`, `inspectorToggleDescription`,
`limitAwareDot`, `backgroundAgentPopulation`, and the types `SessionStatsInputs`, `SessionContextCue`,
`SessionLimitSummary`, `LiveModelStats` (already exported, do not duplicate). Nothing else.

### D3-8 chat stats source factory (NEW file, built in CV-1)

- File: CREATE `F/chat/src/lib/services/session-stats/session-stats-source.ts`. MOVE (not copy)
  `toStatsLimitLaneRun`, `recordedOwnerKeys`, `sameStrings` from `chat-view.component.ts:142-171`.

```ts
export interface SessionStatsHost {
  /** Tab of a scoped view (SESSION_CONTEXT tile, Rail board); `null` in the main panel. */
  readonly tab: () => TabState | null;
  /** The host's resolved session id (main panel: ChatStore.currentSessionId()). */
  readonly sessionId: () => string | null;
  /** The host's budget (chat-view: resolvedSessionBudget; Rail: focusedTab()?.sessionBudget ?? null). */
  readonly budget: () => SessionBudgetState | null;
  /** When false, `inputs` is null (chat-view: today's strip mount rule `resolvedMessages().length > 0`). */
  readonly available: () => boolean;
}
export interface SessionStatsSource {
  readonly inputs: Signal<SessionStatsInputs | null>;   // null only when available() is false
  readonly runOwnerKeys: Signal<readonly string[]>;     // for chat-view's scope update effect (C-39)
}
export function injectSessionStatsSource(host: SessionStatsHost): SessionStatsSource;
// injection context only; injects ChatStore, PlanLimitsStore, AgentMonitorStore, LOCALE_ID
export { toStatsLimitLaneRun };
```

  ONE source, today's resolution MOVED verbatim from chat-view (not re-derived). Rev 1 (finding 1): the r0 text made
  `inputs` null whenever `tab()` was null, which is ALWAYS the case in the main panel: `resolvedTab()` returns null
  without `SESSION_CONTEXT` (`chat-view.component.ts:948-953`), and Part B mounts the inspector only there
  (`plan-part-b-inspector.md:451`, `hostsInspector = !this._sessionContext ...`). Today's strip reads ChatStore in
  that case and mounts whenever the view has messages (`chat-view.component.html:35-49`). The moved computeds are:
  - `snapshot` = body of `resolvedSessionStats` (`chat-view.component.ts:1023-1028`): `tab !== null ? (tab.sessionStats
    ?? null) : chatStore.sessionStats()`;
  - `liveModelStats` = body of `resolvedLiveModelStats` (`:1030-1035`): `tab !== null ? (tab.liveModelStats ?? null)
    : chatStore.liveModelStats()`;
  - `compactionCount` = body of `resolvedCompactionCount` (`:1037-1042`): `tab !== null ? (tab.compactionCount ?? 0)
    : chatStore.compactionCount()`;
  - `laneRuns` / `runOwnerKeys` = `sessionLaneRuns` + `sessionRunOwnerKeys` (`:1061-1076`) over `host.sessionId()`
    (`agentsOwnedBySession(sessionId)`, `[]` without a session; `equal: sameStrings`);
  - `limits` = body of `resolvedStatsLimits` (`:1083-1099`) over `host.sessionId()`, `PlanLimitsStore.snapshot /
    sessionOwner / now / loadError` and the moved `_limitTime` (`:1051-1054`, `LOCALE_ID`); null without a session id
    or a snapshot, exactly as today;
  - `budget` = `host.budget()`; chat-view passes `() => this.resolvedSessionBudget()` (`:1105`, the view's
    `SessionBudgetActionsService.budget` = `activeTab()?.sessionBudget`, `session-budget-actions.service.ts:113-115`),
    so the main panel keeps today's budget;
  - `sessionId` = `host.sessionId()`; chat-view passes `() => this.resolvedSessionId()` (`:798-807`, ChatStore
    `currentSessionId()` in the main panel);
  - plus `context = sessionContextCue(liveModelStats)` and `limitSummary = sessionLimitSummary(limits)` (D-4).
  `inputs` = that object when `host.available()`, else null. Result per host: main panel = ChatStore values + active
  session id + view budget (today's strip); SESSION_CONTEXT tile = tab values (today's tile strip); Rail board =
  focused tab values (`available: () => focusedTab() !== null`, so the ChatStore branch is never reached there).
  It registers NO plan-limits scope and starts no timer (the clock is `PlanLimitsStore.now()`); chat-view keeps its
  ONE scope `_planLimitsScope` (`:1044-1049`, C-39) and its update effect (`:1328-1337`) reads
  `stats.runOwnerKeys()`. Exported from `@ptah-extension/chat` (chat barrel 4th owner) for the Rail board.
  Assumption: `SessionBudgetState` is importable in chat from the module `session-budget-actions.service.ts` already
  imports it from; the implementer confirms the import path there before writing the factory.

### D3-9 chat tray service (NEW files, built in B-4)

- Files: CREATE `F/chat/src/lib/services/session-agents/session-agent-tray.ts` (pure: moved `agentLabel`,
  `agentSummary`, `basename`, `tidyAgentSummary`, `backgroundStatus`, `fromSubagent`, `fromBackground` and
  `buildTrayContexts(subagents, backgroundAgents, scope)`; `export interface TrayAgentContext { entry:
  BackgroundAgentStripEntry; taskId?: string; sessionId?: string; agentId?: string; model: string | null }`);
  CREATE `session-agent-tray.service.ts` (`@Injectable({ providedIn: 'root' })`).

```ts
export interface AgentRowExtras {
  readonly tray: TrayAgentContext | null;  // actions exist only when present
  readonly model: string | null;           // raw id; display via resolveModelDisplayName
  readonly tokens: number | null;          // tray entry totalTokens; null when unknown
}
// pure, in session-agent-tray.ts: model of EVERY roster agent, independent of tray contexts
export function agentModelsByKey(
  subagents: Iterable<SubagentRecord>, cliAgents: readonly MonitoredAgent[],
): ReadonlyMap<string, string>;   // key = roster key; entries only where a model is known
class SessionAgentTrayService {
  contextsFor(sessionId: string | null): ReadonlyMap<string, TrayAgentContext>; // key = toolCallId; null -> empty
  extrasFor(sessionId: string | null, rows: readonly SessionAgent[]): ReadonlyMap<string, AgentRowExtras>;
                                                        // key = row.key, one entry per roster row
  focus(ctx: TrayAgentContext): void;                   // TabManagerService.findTabBySessionId + switchTab
  steer(ctx: TrayAgentContext, text: string): Promise<void>; // AgentMonitorStore.sendMessageToAgent
  stop(ctx: TrayAgentContext): void;                    // only with taskId
  sendToBackground(ctx: TrayAgentContext): void;
  viewTranscript(ctx: TrayAgentContext): void;          // SubagentTranscriptViewerService.openFor
}
```

  Plain signal-reading methods (callers wrap them in `computed`), like `SessionAgentRosterService.roster`. Scope is
  the shown session only (row 54): `buildTrayContexts` keeps the tray's `agentVisibleInSession` filter and the
  `toolCallId` dedupe with the background record winning (`background-agent-tray.component.ts:196-224`), and its
  population UNCHANGED: foreground sub-agents only while `running` / `pending` / `paused` (`:217-222`,
  `isActiveSubagent` `:241-244`), every background record. Tray contexts drive ONLY the summary line, the actions
  menu, the steer input and Focus; they are never the model source.
  Model (rev 1, finding 2): an INDEPENDENT join over ALL roster agents, so a completed foreground sub-agent keeps its
  known model (design `design-spec.md:1509-1514`, req 21.11). The roster includes completed records
  (`session-agent-roster.ts:145-157`: only `status !== 'background'` filters the foreground list) while the tray
  drops them, so the r0 tray-derived model lost them. `agentModelsByKey` walks the SAME store reads the roster
  service uses (`session-agent-roster.service.ts:82-83`: `[...monitor.subagents().values()]`, `monitor.agents()`):
  each `SubagentRecord` -> key `laneKey(rec.status === 'background' ? 'background' : 'subagent',
  rec.parentToolUseId)` (the roster's own split, `session-agent-roster.ts:132,155-157,173-175`) -> `rec.usage?.model`
  (`SubagentRecord.usage` `agent-monitor.store.ts:613`, `model` `:141`); each `MonitoredAgent` -> `laneKey('cli',
  a.agentId)` (`session-agent-roster.ts:161`) -> `a.model` (`agent-monitor.store.ts:448`); keys without a model are
  absent. No session filter is needed: keys are unique ids and the section looks up only its own rows.
  `extrasFor(sessionId, rows)` returns one entry per roster row, `toolCallIdOf(row)` = `parseLaneKey(row.key)?.id`
  for `subagent` / `background` rows (`compact-lane-rows.ts:32-40`), none otherwise:
  `{ tray: contexts.get(toolCallIdOf(row)) ?? null,
  model: models.get(row.key) ?? null, tokens: tray?.entry.totalTokens ?? null }`; the Orchestrator row and background
  commands get `model: null`. The C-2 roster type `SessionAgent` is NOT changed (C-2 committed, `3db987a97`).
  No node walk (D3.6 (2) fallback not taken: the aggregate holds no nodes). MODIFY `background-agent-tray.component.ts`
  in B-4 to call the moved functions and the service (no duplicate copy while it exists; CV-1 deletes it, R2).

### D3-10 inspector amendments (batch B-4, amended)

- `inspector-orchestrator-card`: D3.2: dot, `Orchestrator`, state line WITHOUT model, request line; no context bar,
  no stats `dl`, no `Usage and limits` disclosure (D46, D3.9 item 9). `OrchestratorCardModel`'s `model`,
  `contextPercent`, `contextWindow`, `tokens`, `cost`, `turns` are not read (B-3 builds them; see M-9).
- `session-inspector`: input `stats = input<SessionStatsInputs | null>(null)` REPLACES Part B's optional `usage`
  input. Order D45: Orchestrator, add-on slot, SESSION (`ptah-inspector-session-stats`, when `stats` non-null),
  AGENTS, PLAN LIMITS + LANES (`ptah-inspector-limits-lanes`, when `stats?.limits`), TASK, TODOS, GIT. Visibility
  (rev 1): in the MAIN PANEL `stats` is non-null whenever the view has messages (D3-8, ChatStore branch), so SESSION
  shows there; PLAN LIMITS + LANES show whenever `limits` is non-null, i.e. a session id (ChatStore
  `currentSessionId()`) plus a plan-limits snapshot, exactly when today's strip showed its tiles. Same rules in a
  scoped view and the Rail board, over the tab's values. Wires
  `limitsLinkActivated` to `viewChild(InspectorLimitsLanesComponent)?.focusHeading(source)`. Staggered entry counts
  the new sections as rows (cap 6 unchanged).
- `inspector-agents-section`: summary line `backgroundAgentPopulation([...contextsFor(sessionId).values()].map(c =>
  c.entry))`, omitted when empty; extras `computed(() => tray.extrasFor(sessionId(), rows()))` over ALL roster rows
  (D3-9); per row the leading model token from `extras.model` (`resolveModelDisplayName(raw,
  modelState.availableModels())`, `title` raw id, `aria-describedby` hidden span `Model {name}, id {raw}`),
  `· {tokens} tokens` on the activity line when known; a 28 x 28 `ellipsis` actions button when `extras.tray` has any
  action; inline `ptah-agent-steer-input` (`steerable`, `pending` = section-level `pendingSteerId` signal,
  `placeholder` `Steer {name}...`).
  Row activation (rev 1, finding 3; req 21.23, `task-description.md:948-952`), on the existing Part B
  `<button class="agent__main">` (`plan-part-b-inspector.md:329`), in this order:
  1. `hasLaneSurface` true (a lane surface exists): emit `laneRequested(row.key)` exactly as Part B.
  2. else, `extras.tray` non-null: call `SessionAgentTrayService.focus(extras.tray)` = today's tray Focus (switch to
     the tab owning `ctx.sessionId`, `background-agent-tray.component.ts:338-343`, same guards: no session id or no
     tab -> no-op). This is the main-panel path: Part B's `hasLaneSurface` is false there
     (`plan-part-b-inspector.md:452`).
  3. else (no tray context: the Orchestrator row, a completed foreground sub-agent, a CLI lane): no Focus action. The
     button keeps Part B's select behaviour only and carries no navigation; it is not given a Focus label. Evidence
     that nothing is lost: today such agents never had a Focus action (the tray omits completed sub-agents,
     `:217-222,241-244`, and never lists CLI lanes, `:212-234`). Decision D-13.
  The section injects `SessionAgentTrayService` (root) itself; no new output, no chat-view handler. Assumption: Part
  B's section receives `hasLaneSurface` as an input (it gates `laneRequested` per `plan-part-b-inspector.md:329`);
  B-4 confirms the input name in the section it creates.
- CREATE `inspector-agent-actions-menu.component.ts`: inputs `name`, `ctx: TrayAgentContext`; output
  `action = output<'transcript' | 'steer' | 'background' | 'stop'>()`; `role="menu"`, `menuitem`s by flags
  (`canViewTranscript`, `steerable`, `canBackground`, `stoppable`), Up / Down / Home / End, `Esc` closes and returns
  focus to the trigger; lucide `eye`, `message-square-text`, `arrow-down-to-line`, `square`. One open menu per section.

### D3-11 chat-view and header (batches CV-1 and CV-2, amended)

- CV-1: delete the strip block (`chat-view.component.html:35-51`) and the tray block (`:53-64`), the
  `SessionStatsSummaryComponent` / `BackgroundAgentTrayComponent` imports (`chat-view.component.ts:34,39,231,235`),
  `showBackgroundStrip`, `traySessionId`, `resolvedSessionStats`, `resolvedLiveModelStats`,
  `resolvedCompactionCount`, `resolvedStatsLimits`, `sessionLaneRuns`, `sessionRunOwnerKeys`, `_limitTime` and the
  moved helpers (their bodies MOVE into D3-8, see there); add `protected readonly stats = injectSessionStatsSource({
  tab: () => this.resolvedTab(), sessionId: () => this.resolvedSessionId(), budget: () =>
  this.resolvedSessionBudget(), available: () => this.resolvedMessages().length > 0 })`; the scope effect
  (`:1328-1337`) reads `stats.runOwnerKeys()`; `_planLimitsScope` (the ONE scope per chat view, C-39) and
  `resolvedSessionBudget` (budget banner `:141`) STAY. Bind `[stats]="stats.inputs()"` on the inspector. Main panel
  result: the inspector's SESSION / PLAN LIMITS / LANES show the same values the strip showed (ChatStore fallback,
  active session id, view budget), from the first message on.
  Append the barrel line. Delete the tray component and move its two specs onto the tray service files (R2,
  approved, "Proposed Removals" 1).
- CV-2: header inputs (session-header second owner, §D6): `inspectorDot: 'need' | 'err' | 'sel' | null`,
  `limitCue = input<SessionLimitSummary | null>(null)` (chip `Limit near` / `At limit`, `role="status"`, 22 px,
  `TriangleAlert` 12 dropped below 440 px, `title` + sr-only `: {fullText}`, only while `!inspectorOpen` and state not
  `none`), `contextRingPercent = input<number | null>(null)` (28 px ring around `panel-right` while closed and known),
  `toggleDescription = input<string>('')` (`aria-describedby`, per-instance id; accessible NAME unchanged). chat-view
  adds three computeds and binds them (replacing A2's `shell.isOpen() ? null : shell.showDot()` binding,
  `plan-part-a2-header.md:170`): `inspectorDot = limitAwareDot(shell.showDot(), shell.isOpen(),
  stats.inputs()?.limitSummary ?? null)`; `limitCue = stats.inputs()?.limitSummary ?? null`;
  `contextRingPercent = stats.inputs()?.context.percent ?? null`; `toggleDescription =
  inspectorToggleDescription(context, summary, inspectorModel().needsYouCount)` (empty string with no stats).

### D3-12 bubble badge (batch A1-3, amended) and Rail board (batch B-5, amended)

- A1-3: MODIFY `inline-agent-bubble.component.ts`: remove the badge block `:515-523`, `rawModelId`, `modelDisplayName`
  (`:889-904`) and the `ModelStateService` injection / `resolveModelDisplayName` import if nothing else uses them.
  The only sanctioned edit inside the execution tree (row 32 still forbids tool-row diffs).
- B-5: `canvas-rail-board.component.ts` adds `StatsTileExpansionState` to its `providers` and binds the board
  inspector's `[stats]` from `injectSessionStatsSource({ tab: focusedTab, sessionId: () =>
  focusedTab()?.claudeSessionId ?? null, budget: () => focusedTab()?.sessionBudget ?? null, available: () =>
  focusedTab() !== null })` (same rule as `chat-view.component.ts:798-805` tile branch; budget as
  `session-budget-actions.service.ts:113-115`). No
  registerScope (evidence 5).

## D4 Data flow and sources

1. `TabState.{sessionStats, liveModelStats, compactionCount}` (scoped host) OR `ChatStore.{sessionStats,
   liveModelStats, compactionCount}` (main panel, no tab; D3-8) + host budget + host session id + `PlanLimitsStore.snapshot /
   sessionOwner / now / loadError` (root, `F/core/.../plan-limits.store.ts`) + `AgentMonitorStore.agentsOwnedBySession`
   -> `injectSessionStatsSource` (one call per host) -> `SessionStatsInputs` (with `context`, `limitSummary`).
2. chat-view: `stats.inputs()` -> `ptah-session-inspector [stats]` -> `ptah-inspector-session-stats [stats]` and
   `ptah-inspector-limits-lanes [limits]`; the same object -> header `limitCue`, `contextRingPercent`,
   `toggleDescription`, dot. Rail board: same factory -> board inspector `[stats]`.
3. Plan-limits loading: unchanged. chat-view's scope (`:1044-1049`) updates with `{ sessionIds, ownerKeys:
   stats.runOwnerKeys() }`; released with the view (C-39, req 21.28: refreshes whether or not the inspector is open).
4. AGENTS: `SessionAgentRosterService.roster(tabId)` (rows) + `SessionAgentTrayService.extrasFor(sessionId, rows)`
   (tray context from the active tray population; model from `agentModelsByKey` over ALL roster agents; tokens; by
   roster key) -> rows; row activation -> `laneRequested` with a lane surface, else `focus(ctx)` (D3-10); actions ->
   `AgentMonitorStore.sendMessageToAgent / stopAgent /
   backgroundAgent`, `SubagentTranscriptViewerService.openFor`, `TabManagerService.switchTab`, each targeting the
   context's owning session (req 21.23).
5. Model labels: SESSION Models row from `snapshot.modelUsageList`; AGENTS row from `extras.model`; composer selector
   unchanged; nothing else in the main column (req 21.10).

## D5 Failure behaviour

- No snapshot / no live stats / unknown window: D3.3 rules (`—`, `No data yet`, `Window unknown`, no ring, no
  progressbar role); never `0` (req 21.5). `stats` null -> SESSION and PLAN/LANES sections not rendered; `stats` is
  null ONLY when the host reports `available() === false` (chat-view: no messages, today's strip rule; Rail: no
  focused tab), never because the main panel has no tab (D3-8).
- No plan-limits snapshot (`limits` null): PLAN LIMITS / LANES omitted; `limitSummary.state = 'none'` -> no chip, no
  dot change, no alert. Refresh failure with held data: `refreshNotice` first line of PLAN LIMITS (`role="status"`).
- Tray action targets a vanished context: the service no-ops (today's guards `:338-383`); steer `finally` clears
  `pendingSteerId`; menu closes; focus returns to the trigger.
- Model unknown: no token, no description part, no placeholder.
- Live updates: values change in place; expansion keyed by session + tile id survives pushes; no per-update
  announcement (req 21.27).

## D6 File list and batch proposal

Lane rule (row 60): CLI lanes may BUILD self-contained, mostly-new-file batches; Claude keeps chat-view chain,
A1-2/A1-3 and shared-barrel edits except a mechanical append given verbatim in the plan. Lane suitability as ruled
by the Gate 2 delta review (`implementation-plan-review-delta3.md:21-29`), recorded in `implementation-plan.md` §5:
D-1 YES (codex lane); C-3 YES with an ownership guard (one lane builds the whole batch, a reviewer from a separate
model family reviews it); B-3, A2-1, B-4, A1-3, CV-1, CV-2, CV-3, B-5 NO (Claude).

| Batch | Wave | Files | Depends on | Lane-suitable |
| --- | --- | --- | --- | --- |
| D-1 NEW: inspector stats presentation (chat-ui) | W3 (4th; B-3, C-3, A2-1 are file-disjoint) | C: `chat-ui/src/lib/molecules/session/session-stats-view.ts`, `.../session/plan-limits/session-limit-summary.ts`, `chat-ui/src/lib/atoms/context-ring.component.ts`, `.../session/inspector-stats/{inspector-session-stats,inspector-limits-lanes}.component.ts`, `chat-ui/src/lib/molecules/background-agent-population.ts`; M: `.../session/session-stats-summary.component.ts` (delegation only), `.../background-agent-strip.component.ts` (delegation only), `.../plan-limits/lane-usage-tile.component.ts` (opt-in input/output), optional `variant` input on `plan-limit-tile` / `lane-subtotal-tile` (D-O2), `chat-ui/src/index.ts` (barrel 3rd owner, D3-7 lines) | C-1, A1-1 (barrel order) | YES (codex): new files + behaviour-preserving delegations guarded by unchanged specs; one append-only barrel edit with exact lines; contract D3-1..D3-7 |
| B-4 amended | W4 | + C: `chat/src/lib/services/session-agents/{session-agent-tray,session-agent-tray.service}.ts`, `organisms/session-inspector/inspector-agent-actions-menu.component.ts`; + M: `organisms/background-agent-tray.component.ts` (delegate); changed scope of `inspector-orchestrator-card`, `inspector-agents-section`, `session-inspector.{ts,html}` per D3-10 | + D-1 | no (Claude; chat barrel 3rd owner, inspector tree) |
| A1-3 amended | W5 | + M: `chat/.../organisms/execution/inline-agent-bubble.component.ts` (+ `inline-agent-bubble.component.spec.ts` only if it asserts the badge) | unchanged | no (Claude) |
| CV-1 amended | W5 | + C: `chat/src/lib/services/session-stats/session-stats-source.ts`; + M: `chat/src/index.ts` (barrel 4th owner); chat-view per D3-11; D (R2 approved, row 64): `organisms/background-agent-tray.component.ts`; R (rename + harness rewrite): `organisms/background-agent-tray.component.spec.ts` -> `services/session-agents/session-agent-tray.service.spec.ts`, `organisms/background-agent-tray.scope.spec.ts` -> `services/session-agents/session-agent-tray.spec.ts` | + D-1 (transitively via B-4) | no (chat-view chain) |
| CV-2 amended | W6 | + M: `chat/.../molecules/session-header/session-header.component.ts` (second owner after A2-1); chat-view header bindings per D3-11 | unchanged (A2-1, CV-1) | no (chat-view chain) |
| B-5 amended | W6 | M: `canvas-rail-board.component.ts` (+ spec) per D3-12 | + CV-1 (barrel export) - already a dependency | no (unchanged executor) |

Existing specs a batch must keep green or update (no new spec files): D-1 -> `session-stats-summary.component.spec.ts`,
`background-agent-strip.component.spec.ts`, `lane-usage-tile.component.spec.ts`, `plan-limit-tile.component.spec.ts`
(all UNCHANGED); B-4 -> `background-agent-tray.component.spec.ts`, `background-agent-tray.scope.spec.ts` (UNCHANGED
in B-4; CV-1 renames both onto the tray service files with the same cases, R2);
A1-3 -> `inline-agent-bubble.component.spec.ts`; CV-1 -> chat-view specs (`toStatsLimitLaneRun` import at
`chat-view.component.spec.ts:68` re-pointed to `../../services/session-stats/session-stats-source`, strip / tray mount
assertions removed); CV-2 -> chat-view specs (dot, chip, description); B-5 -> `canvas-rail-board.component.spec.ts`;
PM-17 hosts unchanged -> harness-builder and `canvas-lane-view` specs pass untouched.

## D7 Open checks

| # | Check | Owner |
| --- | --- | --- |
| D-O1 | `LaneLimitState` literal set (A-D2) before the exhaustive switch | D-1 |
| D-O2 | Whether `plan-limit-tile` / `lane-subtotal-tile` faces already meet D3.4 / D3.5 with host classes; add `variant` only where they do not; strip markup byte-identical | D-1, visual review |
| D-O3 | Provider id for the PLAN LIMITS provenance mark (owner's provider): read it from the owner snapshot only if the VM / `planSectionProvenance` exposes an authoritative id; else lucide `Gauge` (D37). No new field | D-1 |
| D-O4 | Source of `{n} turns` on the Time tile: use the turn count B-3 actually built for `OrchestratorCardModel.turns` if non-null; pass it to `ptah-inspector-session-stats` through an optional `turns = input<number \| null>(null)`; if B-3 has none, omit the caption (no invented value) | B-4 |
| D-O5 | CLOSED (rev 1). A-D1 (`resolvedTab()` null with messages) is not a corner case: it is the main panel's normal state (`chat-view.component.ts:948-953`, no `SESSION_CONTEXT`). D3-8 moves today's ChatStore fallbacks (`:1023-1042`), session id (`:798-807`), budget (`:1105`) and the mount rule (`.html:35-49`) into the source; nothing to check at build time | - |
| D-O6 | Rail board closed-state cue: D3.7 names only the chat-view header. If the Rail aside can be closed while a limit is near/at, report to the orchestrator for a design call (req 21.18); do not invent a cue | B-5 |
| D-O7 | No `Model` text left in the main column apart from the composer selector (grep templates for `modelDisplayName`, `formatModelName`, `Model `) | CV-2, reviewer |

## D8 Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D-1 | One pure stats layer extracted from the strip; strip delegates | copy the logic into new components; keep strip as source and wrap it | D1 #9; req 21.3/21.4 "same number / same text"; risk task-description:1053 | yes |
| D-2 | Sections live in chat-ui; chat composes them | export five tiles and build in chat | D1 #10 (tiles not exported) | yes |
| D-3 | `injectSessionStatsSource` factory called by each host once | chat-view input + Rail `null`; root per-tab cache | D1 #3-5; req 21.1 either host | yes |
| D-4 | Context cue and limit summary computed once inside the source and carried in `SessionStatsInputs` | each consumer calls the pure function | D3.9 item 5 ("never derive them separately") | yes |
| D-5 | Tray mapping + actions move to `SessionAgentTrayService`; AGENTS joins by roster key | add fields to `SessionAgent` (C-2 closed, roster file owned by a COMPLETE batch); B-3 store join (B-3 not started, row 62, but a store join would add tray / monitor reads to B-3 and couple it to B-4's moved code) | D1 #14, #16; W2 COMPLETE (row 62) | yes |
| D-6 | Model for AGENTS from `rec.usage.model` / `MonitoredAgent.model` in the tray service; no node walk | node fallback via tree walk | design-spec:1509-1514 (D56 r1); D1 #17 | yes |
| D-7 | Dot precedence composed in chat-view through `limitAwareDot(shell.showDot(), ...)`; controller unchanged | widen `InspectorShellController.showDot` in B-3 | D1 #21; implementation-plan §2.2 B1; B-3 has not started (row 62) but `SessionLimitSummary` is a D-1 type in the same wave W3, so widening B-3 would make it depend on D-1 | yes |
| D-8 | KEEP: header delta-3 inputs (`limitCue`, `contextRingPercent`, `toggleDescription`, widened `inspectorDot`) added by CV-2 as second owner of `session-header.component.ts`; `limitAwareDot` stays a D-1 chat-ui function composed in chat-view by CV-2 | move the inputs into A2-1 now that W3 has not started (row 62) | A2-1 is W3 like D-1; the inputs need D-1's `SessionLimitSummary` and `ContextRingComponent`, so moving them would serialize A2-1 after D-1 inside W3; CV-2 already depends on A2-1 and CV-1 (sequential second owner, accepted as safe by the Gate 2 delta review) and is the first batch that binds the header | yes |
| D-11 | Main-panel stats keep today's ChatStore fallbacks: ONE source, two branches (D3-8) | null without a tab (r0); separate main-panel factory | `chat-view.component.ts:948-953` (no `SESSION_CONTEXT` -> `resolvedTab()` null), `:1023-1042`, `.html:35-49` | yes |
| D-12 | AGENTS model join over ALL roster agents, independent of tray contexts | model from tray contexts only (r0) | tray keeps only active foreground sub-agents (`background-agent-tray.component.ts:212-222,241-244`); roster keeps completed (`session-agent-roster.ts:145-157`) | yes |
| D-13 | AGENTS row activation: lane request with a lane surface, else tray `focus(ctx)`; a row with no tray context gets no Focus action (Part B select only, no navigation) | lane request only (r0); synthesize a focus for any row | `plan-part-b-inspector.md:328-329,452`; `background-agent-tray.component.ts:338-343`; req 21.23 | yes |
| D-14 | Tray component deleted in CV-1, its two specs renamed onto the tray service files (R2) | (b) delete without cases; (c) unmounted delegate | USER row 64 | no (approved removal) |
| D-9 | Plan-limit tiles reused; plan-chip link opt-in (`linkPlanTiles`); `variant` only if needed | fork tile components | D1 #10-11; D3.9 item 1 | yes |
| D-10 | No plan-limits scope in the inspector or Rail board | register one per inspector | D1 #4-5; C-39 one scope per chat view | yes |

## D9 Risks

1. R-D1 D-1 delegation changes strip internals: guarded by the unchanged strip specs; any spec edit in D-1 is a
   red flag for the reviewer (PM-17).
2. R-D2 W3 runs four batches; D-1 (lane) and three Claude batches. Heavy checks stay one at a time (team-leader
   MODE 2 runs them once per batch, row 59).
3. R-D3 B-4 grows (tray service + actions menu + three mounts). Mitigation: D-1 lands first with finished sections;
   B-4 composes. If B-4 overruns, the team-leader may split the agents additions into a follow-up batch that OWNS
   `inspector-agents-section` from the start (decide before B-4 starts, never as a second owner mid-wave).
4. R-D4 chat-ui barrel order becomes C-1 -> A1-1 -> D-1 -> A2-2; chat barrel C-2 -> B-3 -> B-4 -> CV-1. Both orders are
   forced by §5 dependencies (A2-2 is W4 after D-1; CV-1 depends on B-4).
5. R-D5 One source per value: a reviewer checks that no template outside the pure layer formats context, tokens,
   cost or the limit summary itself.
6. R-D6 Showcase scenes `canvas-orchestra.scene.ts:154` and `chat-code-edit.scene.ts:121` locate the strip in
   chat-view and will fail when re-recorded. Not in 677's scope (e2e/showcase not run); flag in the handoff.
7. R-D7 Bundle: the sections join the deferred inspector chunk (B-4 is `@defer`), the context ring and two pure
   helpers add a little eager code to the header; BUILD-1 measures (row 43).

## D10 Parity mapping (req 21, C-2..C-6, C-19..C-50, C-48b, C-49)

| Rows | Today | New location | Batch | Req |
| --- | --- | --- | --- | --- |
| C-2, C-20..C-23, C-25..C-28 | strip values, tooltips, estimate marks, known subtotal | SESSION section (D3-4) over D3-1 texts | D-1, B-4 | 21.3-21.7 |
| C-3 | compaction count | Context tile caption + Context details 4th line | D-1 | 21.3 |
| C-4, C-29..C-33 | plan limits, tiles, expand, status/evidence/cooldown, alert | PLAN LIMITS (D3-5); alert = SESSION line from `limitSummary` | D-1, B-4 | 21.12-21.17 |
| C-34 | refresh-failed notice | first line of PLAN LIMITS, `role="status"` | D-1 | 21.17 |
| C-35..C-38 | lanes header, lane tiles, expand, Subtotal | LANES (D3-5) | D-1 | 21.19-21.21 |
| C-5 | budget suffixes / text / lines | Tokens and Cost tiles + details; banner C-12 unchanged | D-1 | 21.8 |
| C-19 | collapse / expand toggle | dropped as a control: headline values always shown; per-tile disclosures keep detail (design D3.1 row 2, Gate 1.7) | D-1 | 21.3 |
| C-24 | `Models {n}` + breakdown | Models row disclosure + stacked panel (D54) | D-1 | 21.9 |
| C-6, C-40..C-47 | tray summary, rows, focus, menu, transcript, steer, background, stop | AGENTS summary line, rows, actions menu, steer input (D3-9, D3-10); Focus = row activation (`laneRequested` with a lane surface, else `SessionAgentTrayService.focus`, main panel) | B-4 | 21.22-21.23 |
| C-48 | tray population, dedupe, tile scope | `buildTrayContexts` (moved verbatim), session scope | B-4 | 21.22 |
| C-48b | main-panel all-sessions tray | settled row 54: AGENTS (this session) + each session's own tab | - | 21.24 |
| C-39 | plan-limits scope per open chat view | unchanged field in chat-view; inspector registers none | CV-1 (keeps) | 21.28 |
| C-49 | bubble model badge | AGENTS row model token + described raw id for EVERY roster agent with a known model, completed sub-agents included (`agentModelsByKey`, D3-9); badge removed | A1-3, B-4 | 21.10-21.11 |
| C-50 | planned Orchestrator card model line | not built; SESSION Models row | B-4 | 21.10 |
| - | closed-inspector cues (PM-20) | header chip, toggle ring, dot precedence, description (D3-11) | CV-2 | 21.18, 21.25 |
| - | strip / tray in harness-builder, canvas-lane-view | unchanged | - | 21.2 |

## Proposed Removals

1. `BackgroundAgentTrayComponent` (`F/chat/src/lib/components/organisms/background-agent-tray.component.ts`) and its
   specs `background-agent-tray.component.spec.ts`, `background-agent-tray.scope.spec.ts`. CODE only, no capability:
   every tray capability is in AGENTS (D10 rows C-6, C-40..C-48). Its only host is chat-view (D1 #15), so after CV-1
   it is unmounted. This contradicts the task prompt's "the components STAY", which holds for the strip and the stats
   summary but not for the tray.
   - **APPROVED by the USER, option (a)** (`decisions.md` row 64, recorded as R2 in `implementation-plan.md` §6.1):
     CV-1 deletes `background-agent-tray.component.ts` and moves its two specs onto the tray service files:
     `background-agent-tray.component.spec.ts` -> `F/chat/src/lib/services/session-agents/session-agent-tray.service.spec.ts`
     and `background-agent-tray.scope.spec.ts` -> `F/chat/src/lib/services/session-agents/session-agent-tray.spec.ts`
     (`git mv`-style rename, then the harness is rewritten from a component fixture to the pure functions / the
     service; the SAME cases, no added or dropped case, no new spec file). Action cases (focus / steer / stop /
     background / transcript) target `SessionAgentTrayService`; population / scope / dedupe cases target
     `buildTrayContexts`. Rejected options (b) delete without moving the cases, (c) keep an unmounted delegate.
   - B-4 therefore does NOT need to keep the component delegating for longer than B-4 -> CV-1: B-4 makes the
     component call the moved code (its two specs stay green unchanged in B-4); CV-1 deletes it and renames the specs.
   - parity-inventory.md is updated by the team-leader (row 64), not by this plan.
2. None else. The Time tile's `title="Session duration"` is dropped by design (D3.3, approved at Gate 1.7), and the
   strip's 70 / 90 context thresholds are replaced by 80 / 95 in the inspector only (PM-21); both were ruled, not
   proposed here.

## Revise round 1

Source: `implementation-plan-review-delta3.md` (codex, REVISE 5/10) plus the orchestrator's revise brief (USER rows
60, 62, 64). Line numbers are those of this revision.

| # | Finding | Resolution | Edited lines (plan-part-d-stats.md) | Edited lines (implementation-plan.md) |
| --- | --- | --- | --- | --- |
| 1 | BLOCKING: main-panel stats null (`tab()` null in the main panel) | ONE source `injectSessionStatsSource(host)` with `{ tab, sessionId, budget, available }`; today's `resolvedSessionStats` / `resolvedLiveModelStats` / `resolvedCompactionCount` (`tab !== null ? tab : ChatStore`), `sessionLaneRuns` / `sessionRunOwnerKeys`, `resolvedStatsLimits` MOVED verbatim; budget and session id from the host (`resolvedSessionBudget`, `resolvedSessionId`); `inputs` null only when `available()` is false (today's mount rule `resolvedMessages().length > 0`). ONE plan-limits scope per chat view kept (C-39). D-O5 closed; A-D1 withdrawn; visibility of SESSION / PLAN LIMITS / LANES restated for the main panel | 34 (evidence 3), 66-67 (D2 rationale), 77-79 (A-D1 withdrawn), 221-276 (D3-8), 337-341 (visibility), 375-383 (CV-1 call), 403-406 (Rail call), 411-412 (D4 item 1), 432-435 (D5), 477 (D-O5), 493 (D-11) | 134-142 (§2.2 D2), 166-167 (D6 visibility), 182 (§3.1 CV-1), 387 (M-8) |
| 2 | SERIOUS: completed foreground sub-agent models lost | pure `agentModelsByKey(subagents, cliAgents)` over the roster's own store reads (`SubagentRecord.usage.model`, `MonitoredAgent.model`) keyed by roster key; `extrasFor(sessionId, rows)` returns one entry per roster row; tray contexts keep today's active-only population and actions; `SessionAgent` (C-2) unchanged | 291-305 (D3-9 API), 309-330 (D3-9 text), 345-347 (section extras), 420-423 (D4 item 4), 494 (D-12), 534 (D10 C-49) | 155-162 (§2.2 D5), 388 (M-9), 486 (D-D-1) |
| 3 | SERIOUS: no main-panel Focus | row activation: `laneRequested` with a lane surface; else `SessionAgentTrayService.focus(extras.tray)` (today's owning-tab switch); else (no tray context: Orchestrator, completed sub-agent, CLI lane) no Focus action, Part B select only, as today (the tray never listed them) | 352-365 (D3-10 row activation), 422 (D4), 495 (D-13), 530 (D10 C-6) | 161-162 (§2.2 D5), 399-403 (§6.3) |
| 4 | MODERATE: stale W3 "in progress" | W3 NOT started (row 62); `batches.md` IN_PROGRESS is the MODE 2 next-wave flag only. Choice: KEEP CV-2 as the second owner of `session-header.component.ts` and `limitAwareDot` in D-1 composed by CV-2; reason: the header inputs need D-1's `SessionLimitSummary` / `ContextRingComponent` in the same wave, so moving them into A2-1 (or widening B-3) would serialize W3 behind D-1 | 13-23 (D0), 52 (evidence 21), 489-492 (D-5, D-7, D-8) | 185-189 (§3.1 second owner), 308-315 (§5 placement), 389-390 (M-10, M-11), 399-401 (§6.3) |
| 5 | USER row 64: R2 approved, option (a) | CV-1 deletes `BackgroundAgentTrayComponent` and renames its two specs onto `session-agent-tray.service.spec.ts` / `session-agent-tray.spec.ts` (same cases, harness rewrite, no new spec file); B-4 still makes it delegate first; parity-inventory left to the team-leader | 24-26 (D0), 80-84 (D2 effect), 384-385 (CV-1), 456 (D6 CV-1 row), 462-463 (specs), 496 (D-14), 539-557 (Proposed Removals 1, APPROVED) | 58 (§2.1), 241 (§3.3 B-4), 243 (§3.3 CV-1), 368-375 (§6.1 R2), 490 (§8 R2) |
| 6 | Lane suitability (USER row 60) | D-1 YES (codex lane); C-3 YES with ownership guard (one lane, whole batch, separate reviewer family); B-3, A2-1, B-4, A1-3, CV-1..3, B-5 NO | 444-448 (D6 lane rule) | 317-327 (§5 table), 365-366 (§6.1 row 60) |

Not changed: `batches.md`, `decisions.md`, `design-spec.md`, `task-description.md`, `parity-inventory.md`, product
code. No new removal is proposed in this round.
