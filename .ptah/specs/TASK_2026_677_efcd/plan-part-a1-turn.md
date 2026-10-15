# Plan part A1 - The clean turn (TASK_2026_677_efcd)

Scope: design-spec.md §3 (lines 187-373) only. Parts A2 (header/composer), B (inspector),
C (agent dock / `ptah-agent-avatar`) are referenced, not planned here.

## Summary

The transcript stays a flat list of per-message slots (render window, prepend anchor, replay
mount all key on `slot.id`, `chat-transcript.component.html:35-68`); we do NOT wrap turns in a new
DOM container, because that would break slot-level windowing (B-23). Instead the transcript computes
one per-message `TurnContext` map (same pattern as `ptahUiOrderKeys` / `changeSetAnchors`,
`chat-transcript.component.ts:606-617`, `:619+`) and owns the per-turn "user opened the log" flag.
The assistant branch of `MessageBubbleComponent` is rewritten into the clean-turn anatomy:
disclosure row (first assistant message of a turn), work log (every assistant message; each root
child wrapped in `<li>`, rendered by the UNCHANGED `ptah-execution-node`), final answer (trailing
text children of the turn's last assistant message), agent chips + action row + activity panel +
live line (last assistant message of the turn). Turn duration is a pure frontend derivation from
`timestamp` / `duration`. One data defect blocks "identical after reload" (§3.9): live-finalized
assistant messages carry `Date.now()` as `timestamp`, history-loaded ones carry the message-start
time. A1 fixes that at the source (Decision A1-D1). User-turn branch of the bubble is untouched
except the `<article aria-label="You">` wrapper.

## Components

All new code lives in `libs/frontend/chat` (`scope:webview`, `type:feature`,
`libs/frontend/chat/project.json:7`); the only cross-lib import added is from
`@ptah-extension/chat-ui` (already imported by the bubble, same tags), plus part C's
`ptah-agent-avatar` (location owned by part C; see Open checks). No new project, no new tag.

| # | Component | Kind | Path (all under `libs/frontend/chat/src/lib/`) | Responsibility |
| --- | --- | --- | --- | --- |
| 1 | `turn-facts.utils.ts` | CREATE, pure fns | `utils/turn-facts.utils.ts` | Group messages into turns; build `ReadonlyMap<messageId, TurnContext>`; derive `S`, `E`, settled/live label (§3.9); per-message + summary metrics for §3.11; `formatTurnElapsed(ms)` (`{s}s`, `{m}m {ss}s`, `{h}h {mm}m`) |
| 2 | `turn-answer-split.utils.ts` | CREATE, pure fn | `utils/turn-answer-split.utils.ts` | Split one assistant root (`type 'message'`) into `logChildren` and `answerChildren` (trailing run of `text` children after the last non-text child, only for the turn's last assistant message and only when not streaming); report `hasActivity` (any `tool`/`agent`/`thinking` child) and the compact-mode peek text of the newest log child |
| 3 | `TurnDisclosureRowComponent` (`ptah-turn-disclosure-row`) | CREATE, presentational, OnPush | `components/molecules/turn/turn-disclosure-row.component.ts` | §3.2 button: chevron, `Worked for …` / `Working · …` / `Worked` / `Working`, pulse dot, count meta, optional compact peek; inputs `open`, `label`, `live`, `meta`, `peek`, `controlsId`; output `toggled` |
| 4 | `TurnActivityPanelComponent` (`ptah-turn-activity-panel`) | CREATE, presentational, OnPush | `components/molecules/turn/turn-activity-panel.component.ts` | §3.11 `<dl>`: summary (`Duration`, `Message duration` for single-message turns, `Tokens`, `Cost`, `Tool calls`, `Files changed`) and, for N>1, one `<section aria-label="Message n of N">` per message; omits unknown items; renders nothing when all unknown |
| 5 | `TurnLiveLineComponent` (`ptah-turn-live-line`) | CREATE, presentational, OnPush | `components/molecules/turn/turn-live-line.component.ts` | §3.7 `role="status"` line: verb (`Orchestrating` / `Waiting for you` from needs-you count input), `aria-hidden` timer |
| 6 | `TurnAgentChipsComponent` (`ptah-turn-agent-chips`) | CREATE, presentational, OnPush | `components/molecules/turn/turn-agent-chips.component.ts` | §3.5 chip row; icon via part C `ptah-agent-avatar`; status word in `text-state-*`; emits `laneRequested(key)` |
| 7 | `MessageBubbleComponent` | REWRITE assistant branch (html + ts), user branch kept | `components/organisms/message-bubble.component.{ts,html}` | Composes 2-6 + action row (copy, `Show activity`) + work log + answer; removes B-1 auto-collapse, collapsed header/badges, footer badges |
| 8 | `ChatTranscriptComponent` | MODIFY | `components/organisms/transcript/chat-transcript.component.{ts,html}` | Computes `turnContexts`, owns `turnLogOpen` map, `viewMode`, single live clock; binds new bubble inputs/outputs |
| 9 | Format extraction | MODIFY (behaviour-preserving) | `libs/frontend/chat-ui/src/lib/atoms/{token-badge,cost-badge}.component.ts` + `libs/frontend/chat-ui/src/index.ts` | Export the badges' existing text formatters as pure fns so the activity panel renders plain text with the same format (spec §3.11). Duration already has the shared `formatDurationMs` (used by `duration-badge.component.ts:28-29`) |
| 10 | Live-finalize timestamp fix | MODIFY | `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts` | Decision A1-D1 |
| 11 | Chat-view compact card retirement (A-6) | MODIFY | `libs/frontend/chat/src/lib/components/templates/chat-view.component.{html,ts}` | Remove the `showCompactCard()` swap so the transcript renders in both modes (§3.8). OVERLAP with A2 (shell) — whoever owns `chat-view.*` does this edit once |

## Exact edits per file

### `utils/turn-facts.utils.ts` (CREATE)

- `interface TurnMessageMetrics { id; timestamp: number | null; duration?: number; tokens?: MessageTokenUsage; cost?: number | null; toolCount: number; filesChanged: number }`
  (toolCount/filesChanged from `extractMessageSummary(msg.streamingState, msg.cost, msg.duration)`,
  `utils/message-summary.utils.ts`, already used by the bubble at `message-bubble.component.ts:188-192`).
- `interface TurnContext { turnId; startTs: number | null; assistantIds: readonly string[]; index: number; count: number; isFirstAssistant; isLastAssistant; hasActivity: boolean; messages: readonly TurnMessageMetrics[]; settledEndTs: number | null }`.
  `turnId` = id of the turn's opening user message, or of its first assistant message when the
  transcript starts mid-turn (older history not loaded yet).
- `buildTurnContexts(messages: readonly ExecutionChatMessage[]): ReadonlyMap<string, TurnContext>` -
  one pass; a turn = a user message + every assistant message up to the next user message (§3.9).
  User messages whose `isCompactionContinuation` text prefix matches
  (`'This session is being continued from a previous conversation'`, same literal as
  `message-bubble.component.ts:239-241`; move it to an exported const here and have the bubble import
  it) do NOT open a new turn's `S` (B-18 rule); inbound peer messages DO (§3.9 row S). Messages with
  `role: 'system'` are skipped. Only assistant ids are keys.
- `startTs` = first qualifying user `timestamp` that is finite, else `null`.
- `settledEndTs` = see Decision A1-D2.
- `turnElapsedLabel(ctx, live: boolean, now: number): { text: string; live: boolean }` - §3.9 rows:
  live -> `Working · {formatTurnElapsed(now - S)}` or `Working` when no S; settled -> `Worked for …`
  when `E - S >= 1000`, else `Worked`. Never `0s`.
- `formatTurnElapsed(ms)`: `<60 s` -> `{s}s`; `<1 h` -> `{m}m {ss}s` (seconds zero-padded); else
  `{h}h {mm}m`. NOT `formatAgentElapsed` (`chat-ui/.../background-agent-strip.component.ts:96-106`),
  which drops zero seconds and does not pad - different spec.
- `summarizeTurnMetrics(ctx)`: sums of known tokens/cost/toolCount/filesChanged + `knownCount` per
  item, for the `Tokens · 2 of 3 messages` qualifier (§3.11).

### `utils/turn-answer-split.utils.ts` (CREATE)

- `splitTurnMessage(root: ExecutionNode, opts: { isLastAssistant: boolean; streaming: boolean }): { log: readonly ExecutionNode[]; answer: readonly ExecutionNode[]; hasActivity: boolean; peek: string | null }`.
  Non-text types are `agent|tool|thinking|system` (`node.ts:24-30`). Answer = trailing `text`
  children after the last non-text child, only when `isLastAssistant && !streaming`; while streaming
  everything is log (§3.1 row 1). If the root has no non-text child the whole root is answer and
  `hasActivity=false`. `peek` = newest log child: `text` -> first line of `content`; `tool` ->
  `toolName`; `agent` -> `agentDescription` (fields at `node.ts:146,150,175`).
- Memoize by `root` identity (WeakMap) so the bubble's `computed` returns stable arrays and
  `@for ... track child.id` does not churn (the render-throttle specs rely on stable node identity).

### `components/molecules/turn/*.component.ts` (CREATE x4)

Standalone, `ChangeDetectionStrategy.OnPush`, `input()`/`output()`, `LucideAngularModule` icons
(`ChevronRight`, `Copy` is NOT needed here, `Activity`, `Bot`, `Layers`, `Terminal`) with
`aria-hidden="true"`, Tailwind/DaisyUI classes exactly as design-spec §3.2/§3.5/§3.7/§3.11. Inline
templates (each is small). No services injected - inputs only - so they need no providers in specs.

### `message-bubble.component.ts` (MODIFY)

- New inputs: `turn = input<TurnContext | null>(null)`, `viewMode = input<'full'|'compact'>('full')`,
  `logOpen = input<boolean | null>(null)` (null = not touched by the user -> auto rule),
  `turnLive = input<boolean>(false)` (turn streaming or owned agent running), `now = input<number>(0)`
  (only fed to the live turn), `needsYouCount = input<number>(0)`, `agents = input<readonly TurnAgentChip[]>([])`.
- New outputs: `logToggled = output<{ turnId: string; open: boolean }>()`,
  `laneRequested = output<string>()`.
- New computeds: `split` (calls `splitTurnMessage`), `logExpanded` = `logOpen() ?? (streaming && viewMode()==='full')`
  (§3.1 auto-open only while streaming; §3.8 compact keeps it collapsed), `durationLabel`,
  `activityOpen = signal(false)` (local, per bubble; closed by default).
- Remove: `shouldAutoCollapse`, `isCollapsed`, `userToggled`, `previousMessageId`, the two
  `effect()`s, `toggleCollapse`, `hasCollapsedFooterData` (`:216-280`, `:352-355`) and the
  `ChevronDown`, `TokenBadgeComponent`, `CostBadgeComponent`, `DurationBadgeComponent` imports when
  no longer used. Keep `messageSummary` (feeds count meta), `isCompactionContinuation`,
  `isContinuationCollapsed`, `inboundPeerLabel`, `imageCountLabel`, `onBranchClick`,
  `onRewindClick`, `formatTime`, `formatDateTime`, file helpers.

### `message-bubble.component.html` (REWRITE lines 1-192, keep 193-347)

Assistant branch becomes `<article aria-label="Assistant" class="…density by viewMode…">`:

1. Disclosure row (`turn().isFirstAssistant && turn().hasActivity`): `<ptah-turn-disclosure-row>`;
   `controlsId` = `'turn-log-' + turn().turnId`; click emits `logToggled`.
2. Work log (`split().log.length > 0`): grid-rows collapse wrapper (reuse the existing
   `.bubble-collapse-wrapper` / `.bubble-collapsed` CSS from the bubble stylesheet, retimed to 260 ms
   per §3.3; add `invisible` after transition) containing `<ol aria-label="Work log">` with
   `@for (child of split().log; track child.id) <li><ptah-execution-node [node]="child" [isStreaming] [textClosed]="true when child is not the tree's last child" [isFinalizing] [getPermissionForTool] [agentTileMode] [ptahUi]="ptahUiContext()" (permissionResponded) /></li>`.
   This replicates exactly what the root `'message'` case does
   (`execution-node.component.ts:389-401`: same inputs, `textClosed = !$last && child.type==='text'`,
   `ptahUi` forwarded only at this level), so every tool, agent, thinking and `ptah-ui` row renders
   through the unchanged component (decisions row 32). `id` of the `ol` wrapper = `controlsId`
   only on the first assistant message; later messages of the same turn use the same `logExpanded`.
   Streaming caret (B-7): keep `<ptah-typing-cursor>` after the last `li` while streaming.
   Streaming quotes (B-13): render `<ptah-streaming-quotes>` inside the log while streaming and the
   log has no row yet.
3. Answer (`split().answer.length > 0`): `<div class="cs-answer max-w-[600px] …">` with the same
   per-child `ptah-execution-node` loop (answer text renders as today's markdown/prose).
   Raw fallback (no `streamingState`, `:113-128`) stays as the answer.
4. Agent chips (`turn().isLastAssistant && agents().length && !streaming`): `<ptah-turn-agent-chips>`.
5. Action row (`turn().isLastAssistant && !turnLive()`): existing `<ptah-copy-button [message]>`
   (B-10, now visible at rest - drop the `opacity-0 group-hover` wrapper of `:159-161`) restyled
   per §3.6 only through its host class if its API allows (Open check 5), and a `Show activity`
   button (`Activity` icon, `aria-expanded`, `aria-controls`).
6. Activity panel (`activityOpen()`): `<ptah-turn-activity-panel [turn]="turn()" [durationLabel]>`.
7. Live line (`turn().isLastAssistant && turnLive()`): `<ptah-turn-live-line [startTs] [now] [needsYouCount]>`.

Removed from the assistant branch: avatar + `Claude`/time header (`:4-31`), collapse header and
description (`:39-91`), collapsed badges (`:136-153`), metadata footer (`:165-185`). See Decision
A1-D5 for the assistant header.

User branch (`:193-347`): wrap in `<article aria-label="You">`; NO other change (B-14..B-20,
decisions row 23: hover reveal, header time at rest, `opacity-60` unchanged).

### `chat-transcript.component.ts` (MODIFY)

- `turnContexts = computed(() => buildTurnContexts(this.vm().messages))` - derived from the gated
  `vm` like `ptahUiOrderKeys` (`:606-617`), so a hidden transcript does no work.
- `turnLogOpen = signal<ReadonlyMap<string, boolean>>(new Map())` + `onLogToggled({turnId, open})`
  (immutable map update). Per-turn flag; never reset by auto-collapse (§3.1). In memory only.
- `viewMode = computed(() => this.tabManager.getTabViewMode(this.tabId()))` - verified getter
  `libs/frontend/chat-state/src/lib/tab-manager.service.ts:3108-3110` (reads the `_tabs` signal).
- ONE live clock: `liveNow = signal(Date.now())` driven by a single `setInterval(1000)` started only
  while some turn is live and cleared when none is, plus on `DestroyRef` (runtime rule: no timer
  per item). `turnLive` per turn = any of its assistant slots has `i >= vm().streamingBoundary`
  OR part C's agent source reports a running agent owned by the turn (Open check 3).
- `onLaneRequested(key)` -> existing `openSubagentLane(key)` (`:769-791`).

### `chat-transcript.component.html` (MODIFY `:47-60`)

Add bindings on `<ptah-message-bubble>`: `[turn]="turnContexts().get(slot.id) ?? null"`,
`[viewMode]="viewMode()"`, `[logOpen]="turnLogOpen().get(ctx.turnId) ?? null"`,
`[turnLive]`, `[now]="isLive ? liveNow() : 0"` (non-live bubbles get a constant so they do not
re-render each second), `[needsYouCount]` (part B aggregate), `[agents]` (part C source),
`(logToggled)="onLogToggled($event)"`, `(laneRequested)="onLaneRequested($event)"`. Remove
`[messageIndex]` / `[totalMessages]` (only fed B-1 auto-collapse, `message-bubble.component.ts:221-223`)
together with those inputs.

### `chat-ui` formatters (MODIFY, behaviour-preserving)

Export `formatTokenCount(count)` (body of `token-badge.component.ts` text formatter, `:99-103`) and
`formatCostUsd(cost)` (cost-badge text, `:39`, `:70+`) from the same files and from
`libs/frontend/chat-ui/src/index.ts` (exports at `:10`, `:24`); badges call them. `formatDurationMs`
is already shared (import path: copy it from `duration-badge.component.ts` imports; Open check 6).

### `message-finalization.service.ts` (MODIFY `:198-242`) - Decision A1-D1

Pass `timestamp` = the message-start event timestamp of `tree.id` when finite, else leave the
`Date.now()` default. Same for the reuse branch `:198-206` (do not overwrite an existing finite
start timestamp). No new field, no backend change.

### `chat-view.component.{html,ts}` (MODIFY, overlap A2)

Delete the compact-card branch (`chat-view.component.html:4-14`, `showCompactCard()` /
`expandToFull` at `chat-view.component.ts:962-978`) per A-6/A-16; the transcript always renders.
Rail card path (A-5, `SESSION_FORCED_CARD`) untouched.

## Parity row -> location

| Row | Today | New location (A1) |
| --- | --- | --- |
| A-1/A-2 | `TabState.viewMode` | Read via `getTabViewMode` in transcript -> bubble `viewMode` input (density, live-log auto-open) |
| A-6 | chat-view compact card swap | Removed in `chat-view.component.*` (overlap A2) |
| A-16 | card "Show output" | Disclosure row + `Show activity` panel |
| B-1 | auto-collapse older than last four | Per-turn log auto-collapse on final message; transcript `turnLogOpen` flag |
| B-2 | collapse header + chevron | `ptah-turn-disclosure-row` (`aria-expanded`, `aria-controls`) |
| B-3 | title / description when collapsed | Final answer always visible under the disclosure |
| B-4 | tool/file count badges | Disclosure count meta `{n} tools · {n} files` (from `messageSummary`, summed over the turn) |
| B-5 | execution tree | Work log `<li>` rows via unchanged `ptah-execution-node` |
| B-6 | mermaid fallback | Answer (raw fallback branch kept verbatim) |
| B-7 | typing cursor | `ptah-typing-cursor` after the last log row while streaming |
| B-8 | collapsed cost badge | Activity panel `Cost` |
| B-9 | collapsed duration badge | Disclosure label (§3.9) + panel `Duration` |
| B-10 | copy (hover) | Action row `Copy message`, visible at rest |
| B-11 | token + cost badges | Panel `Tokens`, `Cost` (summary + per-message for N>1) |
| B-12 | message duration badge | Panel `Message duration` (N=1) / per-message `Duration` (N>1) |
| B-13 | streaming quotes | Inside the live work log while it has no row yet |
| B-14..B-20 | user turn | Unchanged markup inside `<article aria-label="You">` |
| B-21 | sub-agent tile | Chip row (A1) + activity row in log (unchanged tile via `agentTileMode`) + inspector row (B) |
| B-22, B-23, B-24 | inline agent bubble, render window, older history | Unchanged |

## Data flow + empty/failure states

1. Messages: history (`history-message-builder.service.ts:186-216`) / live finalize
   (`message-finalization.service.ts:215-242`) / streaming projection
   (`stream-presentation-store.service.ts:255-289`) -> `vm().messages` -> `buildTurnContexts` ->
   `turnContexts` map -> bubble `turn` input.
2. Bubble: `splitTurnMessage(streamingState)` -> log rows / answer; `turnElapsedLabel` -> disclosure;
   `turn.messages` -> activity panel.
3. User toggles -> `logToggled` -> transcript `turnLogOpen` -> `logOpen` input (round trip, OnPush safe).
4. Live: transcript `liveNow` (one interval) -> only the live turn's last/first bubble.

Empty and failure states:

- No `streamingState` (raw/system/error assistant messages, e.g. `message-dispatch.service.ts:338-394`,
  `tab-manager.service.ts:1125`): no disclosure, no log; raw text is the answer; action row shown.
- No tool/agent/thinking in the turn: no disclosure row (§3.1 row 3); answer only.
- `S` or `E` missing / non-finite / `E - S < 1000`: label `Worked` (never `0s`).
- All panel items unknown: `Show activity` button still shown? NO - hide the panel AND the
  button's `aria-expanded` target never renders; Decision A1-D4: hide the `Show activity` button
  when every item is unknown (spec: "hidden entirely when every item is unknown").
- Turn starts before loaded history (no user message in window): `turnId` = first assistant id,
  `S = null` -> `Working` / `Worked`; corrects itself when older history loads (map recomputes).
- Old saved `compact` tab: renders transcript in compact density (§3.8 migration, no data change).

## Bundle impact

Small and in the existing `chat` chunk: 4 inline-template presentational components, 2 pure util
files. Removes `TokenBadgeComponent`, `CostBadgeComponent`, `DurationBadgeComponent` from the
bubble's `imports` (still used elsewhere, so no net library removal). No new dependency, no new
`@defer` block, no new lib. Lucide adds `Activity`, `Bot`, `Layers`, `Terminal` glyphs (tree-shaken,
< 2 KB). Net expected: under +6 KB minified to the chat chunk.

## Suggested file-disjoint batches + verification commands

- A1-B1 (frontend-developer): `utils/turn-facts.utils.ts`, `utils/turn-answer-split.utils.ts`,
  `chat-ui` formatter export (`token-badge`, `cost-badge`, `chat-ui/src/index.ts`).
- A1-B2 (frontend-developer, after B1): `components/molecules/turn/*` (4 components).
- A1-B3 (frontend-developer, after B2 and after part C publishes `ptah-agent-avatar` + agent source,
  part B publishes the needs-you count): `message-bubble.component.{ts,html,css}`,
  `chat-transcript.component.{ts,html}`.
- A1-B4 (frontend-developer, independent): `chat-streaming/.../message-finalization.service.ts`.
- A1-B5 (whoever owns `chat-view.*`, likely A2): compact-card removal.

Verification (one at a time, from the worktree):

```
node .ptah/tmp/check-run.mjs a1-chat-test -- npx nx test @ptah-extension/chat --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs a1-chat-typecheck -- npx nx typecheck @ptah-extension/chat --parallel=1
node .ptah/tmp/check-run.mjs a1-chat-lint -- npx nx lint @ptah-extension/chat --parallel=1
node .ptah/tmp/check-run.mjs a1-chatui-test -- npx nx test @ptah-extension/chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
node .ptah/tmp/check-run.mjs a1-streaming-test -- npx nx test @ptah-extension/chat-streaming --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
```

Project names verified (Open check 7). Also
`ptah_get_diagnostics` scoped to the changed files after each batch.

## Existing specs likely needing assertion updates

- `components/organisms/message-bubble.component.spec.ts`: cost/metadata footer cases `:143-204`
  (cost now inside the closed activity panel - open it first, or assert absence at rest);
  `:91` agent tile forwarding (the tree is now rendered per child - assert on a child
  `ptah-execution-node`); `:123` "no branch/rewind for assistant" stays valid.
- `components/organisms/transcript/chat-transcript.component.spec.ts:1034`: the stub
  `ptah-message-bubble` must declare the new inputs/outputs (`turn`, `viewMode`, `logOpen`,
  `turnLive`, `now`, `needsYouCount`, `agents`, `logToggled`, `laneRequested`) and drop
  `messageIndex`/`totalMessages`, or template binding fails.
- `chat-transcript.display.spec.ts`, `chat-transcript.ptah-ui.spec.ts` (`isCollapsed` fixtures at
  `:124-150`, `:289-319` are node fields, not the bubble - probably unaffected; re-run).
- `execution-node.*.spec.ts`: unaffected (component unchanged).
- `chat-ui` `token-badge` / `cost-badge` specs: unaffected if extraction is behaviour-preserving.
- `chat-streaming` message-finalization spec(s): timestamp assertions if any use `Date.now()`.
- `compact-session-card.component.spec.ts` / `chat-view.component.spec.ts`: A-6 removal (overlap A2).

## Decisions

- A1-D1 Live-finalized assistant `timestamp`. Problem: `createExecutionChatMessage` defaults
  `timestamp: Date.now()` (`factories.ts:37`) and finalization passes none
  (`message-finalization.service.ts:228-240`), while history uses the message-start time
  (`history-message-builder.service.ts:216`), so `timestamp + duration` differs before and after
  reload, breaking §3.9 / criterion 8. Options: (a) set the start timestamp at finalization
  [chosen]; (b) ignore `timestamp` and use only `duration` sums (contradicts D22 `E` rule);
  (c) backend field (forbidden: "no backend, no new stored field"). Evidence above. Reversible.
- A1-D2 `E` with partially known durations. Spec text: every term needs a finite `duration`,
  else not derivable. Source: live finalization puts `duration` ONLY on the turn's last new root
  (`message-finalization.service.ts:215-216` comment, `:233-239`), so a live multi-root turn would
  always show `Worked`, while a reloaded one (each message has its own complete event,
  `history-message-builder.service.ts:177-184`) would show a number -> before/after reload mismatch.
  Chosen: `E = max(timestamp + duration)` over assistant messages that have BOTH finite; not
  derivable only when none do. Since timestamps increase, the last message dominates the max, so
  the value equals the spec's whenever the spec's is derivable. Report to orchestrator as a
  spec-vs-source resolution; reversible (one function).
- A1-D3 No turn DOM wrapper; per-message slots keep the transcript windowing (B-23). Turn-level
  rows sit on the first (disclosure) / last (chips, actions, panel, live line) assistant message
  of the turn. Rejected: `<article>` per turn spanning slots - breaks `ptahTranscriptSlot` /
  render-window / prepend-anchor contracts keyed per message. Consequence: the "Assistant"
  `<article>` is per assistant message; for N>1 a turn has N articles (accepted; screen readers
  still get one disclosure per turn).
- A1-D4 `Show activity` button hidden when every panel item is unknown (spec §3.11 "hidden
  entirely"; §3.6 says the row is exactly two buttons - with no data the second has no target).
- A1-D5 Assistant avatar + `Claude` + time header removed (§3 anatomy has none; no parity row
  covers it - Open check 4). Per-message time appears in the activity panel for N>1.
- A1-D6 The work log renders each root child in an `<li>` with the same inputs the root `'message'`
  case uses (`execution-node.component.ts:389-401`) instead of passing a synthetic root, so the
  `<ol>` semantics of §3.3 hold and `ptah-execution-node` stays unchanged.
- A1-D7 One transcript-level 1 s clock, fed only to the live turn (runtime rule).

## Open checks

1. Turn grouping in practice: confirm whether one user prompt yields ONE assistant message (tree
   builder merges SDK messages; `history-message-builder.service.ts:205` `usedTreeNodeIds`) or
   several. Plan works for both; affects how often the N>1 panel appears.
2. Message-start timestamp lookup in finalization (A1-D1): confirm `tree.id` equals the
   `message_start` event id (implied by `history-message-builder.service.ts:169`
   `treeById.get(messageStartEvent.id)`) and that the finalization service can read that event
   from the tab's streaming state.
3. Agent status per turn (chips, `turnLive` for "answered, work still running"): source and
   mapping owned by part C (`AgentMonitorStore`, chip vocabulary §3.5). A1 consumes
   `TurnAgentChip { key; name; kind: 'subagent'|'cli'|'background'; providerId?; status }`;
   part C must confirm the type name/location and how to resolve a chip's lane key (today
   `subagent-tile` -> transcript `openSubagentLane(key)` `chat-transcript.component.ts:769-791`).
4. Assistant header removal (A1-D5): orchestrator confirms no parity row requires the assistant
   `Claude` + time line (`message-bubble.component.html:22-31`).
5. `ptah-copy-button` (`chat-ui/src/lib/atoms/copy-button.component.ts:25`, input
   `message` `:48`, already `aria-label="Copy message"` `:32`): verify its internal button classes
   match the §3.6 28 px recipe; if not, adjust in-place in chat-ui (keep API) - overlap-free.
6. RESOLVED: `formatDurationMs` comes from `@ptah-extension/shared`
   (`chat-ui/src/lib/atoms/duration-badge.component.ts:2`).
7. RESOLVED (names): Nx project names are `@ptah-extension/chat`, `@ptah-extension/chat-ui`,
   `@ptah-extension/chat-streaming` (each `project.json` `name`). Use these in every `nx` command
   above (e.g. `npx nx test @ptah-extension/chat ...`), replacing the short names.
8. Needs-you aggregate (live line verb, §3.7): signal name/location from part B (section 9, G1).
9. Contrast of the user-turn time with `opacity-60` (kept by user decision, row 23 / Delta 1):
   estimate ~3:1 on surface-0 dark (muted 6.06:1 blended at 60%) - likely below 4.5:1. Pre-existing;
   frontend dev measures with `prototype/assets/contrast-check.mjs`; if it fails, escalate to the
   user (changing it reverses a user decision) - do not silently drop the opacity.
10. Streaming caret look: §3.3 asks for a 7x14 block; `ptah-typing-cursor` glyph not inspected -
    restyle via its `colorClass` input only if sufficient, else accept today's cursor (B-7 "move").
11. Compaction-continuation turn: a turn whose only user message is the continuation has `S = null`
    -> `Working`/`Worked` (spec-consistent; confirm acceptable).

## Evidence log (working notes, verified)

- One `MessageBubbleComponent` per `ExecutionChatMessage`
  (`libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts:100-109`);
  inputs `message`, `agentTileMode`, `isStreaming`, `isFinalizing`, `messageIndex`, `totalMessages`,
  `isSessionActive`, `ptahUiOrderKey`, `ptahUiSnapshot` (:109-161); outputs `branchRequested`,
  `rewindRequested` (:177, :183). Template is 347 lines (`message-bubble.component.html`).
- `messageSummary` = `extractMessageSummary(msg.streamingState, msg.cost, msg.duration)` for assistant
  only (:188-192; `utils/message-summary.utils.ts`, 142 lines).
- Old auto-collapse (B-1): `shouldAutoCollapse` = not streaming and `index < total - 4` (:216-224),
  `isCollapsed` signal + non-signal `userToggled` flag reset on message id change (:227-280). This is
  the per-turn "user opened by hand stays open" pattern §3.1 wants; reuse its shape.
- Assistant template (`message-bubble.component.html:1-192`): avatar + `Claude` header with time
  (:7-31); collapse header with `summary.toolCount` / `filesChanged` badges (:39-91); ONE
  `<ptah-execution-node [node]="message().streamingState!">` renders the whole tree (text, thinking,
  tools, agents) inside `.bubble-collapse-wrapper` (:97-134); raw/mermaid fallback (:113-128);
  typing cursor (:129-131); collapsed cost/duration badges (:136-153); footer copy (hover reveal)
  + token/cost/duration badges `data-testid="message-metadata-footer"` (:157-185); streaming
  quotes (:188-190). User branch starts at :193.
- `ExecutionChatMessage` (`libs/shared/src/lib/types/execution/agent.ts:85-151`): `timestamp: number`
  (:93, required), `streamingState: ExecutionNode | null` (:100), `tokens?` (:144), `cost?` (:147),
  `duration?` (:150). Node types `message|agent|tool|thinking|text|system`
  (`libs/shared/src/lib/types/execution/node.ts:24-30`).
- `createExecutionChatMessage` defaults `timestamp: Date.now()` (`libs/shared/src/lib/types/execution/factories.ts:32-41`).
- TIMESTAMP SEMANTICS DIFFER BY PATH (blocks §3.9 "identical after reload"):
  - History load: assistant `timestamp = messageStartEvent.timestamp`, `duration = completeEvent.duration`
    only when `completeEvent.tokenUsage` exists (`libs/frontend/chat-streaming/src/lib/history-message-builder.service.ts:170-216`).
    User messages also get `messageStartEvent.timestamp` (:186-201).
  - Live finalize: no `timestamp` passed -> `Date.now()` at finalize time; stats (`tokens`, `cost`,
    `duration`) only on the LAST new root (`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:215-242`;
    reuse path :198-206 patches stats onto the existing last message).
  - Live streaming projection: `Date.now()` at memo build, rebuilt when `pendingStats` changes
    (`libs/frontend/chat/src/lib/services/stream-presentation-store.service.ts:255-289`); same in
    `chat-transcript.component.ts:498-506`.
  - Consequence: live-finalized `timestamp + duration` ~= end + duration; reloaded = start + duration.
    See Decision A1-D1.
- `isCompactionContinuation` (:235-242) and `inboundPeerLabel` (:309-314), `imageCountLabel` (:317-321)
  stay as-is (B-17..B-20).

