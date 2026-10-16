# Batch A1-3 report (Wave 5) - message bubble assistant branch + transcript

Status: implementation complete; awaiting team-leader MODE 2 scoped checks (no nx/jest run here, decisions row 59).
Continuation executor: the first A1-3 executor stopped on an API rate limit after the bubble `.ts` and the
inline-agent-bubble edit; both were reviewed and kept unchanged.

## Files (all under `libs/frontend/chat/src/lib/components/organisms/`)

- MODIFIED `message-bubble.component.ts` (first executor, kept): turn inputs/outputs, `split`, `logExpanded`,
  disclosure label/counts/peek, chips/actions/live-line/activity gates; old collapse state, effects, footer removed.
- MODIFIED `execution/inline-agent-bubble.component.ts` (first executor, kept): Delta 3 model badge, `rawModelId`,
  `modelDisplayName`, `ModelStateService` injection and `resolveModelDisplayName` import removed. No tool-row diff.
- REWRITTEN `message-bubble.component.html` assistant branch: `<article aria-label="Assistant">` with disclosure row,
  grid-collapse work log `<ol aria-label="Work log">` of per-child `ptah-execution-node` rows (root `'message'` case
  inputs: `textClosed = child is not the root's last child && text`, `ptahUi` forwarded), streaming quotes, `.cs-answer`
  (same per-child loop; raw/mermaid fallback kept verbatim), agent chips, action row (copy + `Show activity`), activity
  panel, live line. Avatar, `Claude` + time header, collapse header, collapsed badges and metadata footer removed.
  User branch: wrapped in `<article aria-label="You" class="st-t block">`, re-indented only.
- MODIFIED `message-bubble.component.css`: collapse wrapper retimed 320 -> 260 ms on `--ptah-ease-soft` with
  `visibility: hidden` after the transition; removed the dead `bubbleFade*` keyframes/classes (only the removed
  badges/footer used them); added `.cs-answer` paragraph gap (12 px, 8 px compact) and inline-code pill (§3.4).
- MODIFIED `transcript/chat-transcript.component.ts`: `turnMessages` (gated slot records), `turnContexts`,
  `viewMode`, `turnLogOpen` + `onLogToggled`, `logOpenFor`, `turnAgentKeys`, lazy `roster`, `turnAgents`,
  `streamingTurnIds`, `liveTurnIds`, ONE `TranscriptLiveClock`, `needsYouCount`, `onLaneRequested`, `noAgents`.
- MODIFIED `transcript/chat-transcript.component.html` (`:47-60`): new bubble bindings via `@let turn` / `@let turnLive`;
  `[messageIndex]` / `[totalMessages]` removed.
- CREATED `transcript/transcript-turn-contexts.ts`: identity-stable turn contexts, per-turn agent keys
  (`laneKey('subagent'|'background', node.toolCallId)`), roster filter, streaming/live turn ids. Pure.
- CREATED `transcript/transcript-live-clock.ts`: the one 1 s interval (outside the zone), runs only while a turn is
  live on a visible transcript, released on stop and on `DestroyRef`.

## Spec edits (existing files only)

- `message-bubble.component.spec.ts`: `:91` agent-tile forwarding now asserted on a child row (root with one text
  child); `:143-204` cost/footer tests rewritten against the closed activity panel (closed by default,
  `aria-expanded`/`aria-controls`, Tokens + `$0.50`; unpriced -> no Cost item; `$0.0000` kept; all-unknown -> action
  row without `Show activity`); the `isFinalizing` badge motion-gate `it.each` deleted (badges and `bubble-fade-*`
  removed); unused `readFileSync`/`join` imports removed. `:123` unchanged.
- `transcript/testing/transcript-spec-harness.ts`: bubble stub drops `messageIndex`/`totalMessages`, gains `turn`,
  `viewMode`, `logOpen`, `turnLive`, `now`, `needsYouCount`, `agents`, `logToggled`, `laneRequested`; harness provides
  `SessionAgentRosterService` (`roster: () => []`) and `SessionInspectorStore` (`needsYouCount: 0`) stubs.
- `transcript/chat-transcript.component.spec.ts`: `TileBubbleStub.agents()` renamed `agentNodes()` (it would clash
  with the stub's new `agents` input).
- `transcript/chat-transcript.replay-mount.spec.ts:423`: live bubble found by `message.id === 'live'` instead of the
  removed `messageIndex`.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| 1 | Turn facts read each slot's CURRENT record (`slot.record()`), gated like `vm` | `vm().messages` (plan text) / slot records | `STREAM_PRESENTATION_RECORDS_ENABLED` defaults `true`; on that path `presentation.messages` changes only structurally, a growing tree updates its record alone (same reason as `ptahUiSnapshots`). With `vm().messages` the live turn's disclosure row would not appear | yes |
| 2 | Identity-stable contexts / agent arrays (`TranscriptTurnContexts`, `turnAgentsOf(previous)`) | rebuild per chunk | runtime rule: only the live turn's bubbles should re-render per chunk | yes |
| 3 | `viewMode` = `this._tab()?.viewMode ?? 'full'` | `tabManager.getTabViewMode(tabId)` | identical semantics (`tab-manager.service.ts:3108-3110` reads the same `viewMode` field with the same default); reuses the existing tab lookup and needs no new TabManager method in the spec stubs | yes |
| 4 | Roster and inspector store resolved lazily via `Injector.get` (roster only when a turn has an agent node; store only when a turn is live) | eager `inject()` | `chat-view.memo.spec.ts` (CV-1 owned) builds the real transcript with a `{ tabs }` TabManager stub: an eager `SessionInspectorStore` calls `tabManager.onTabClosed` in its constructor and would break every memo test; also a transcript without agents never builds the roster | yes |
| 5 | Chip click routes through `SESSION_CARD_ACTIONS.openLane(key)` (resolved at click time) | call `openSubagentLane` directly (plan) | sub-agent tiles use the same token: a host (Rail) wins, the single chat view falls back to `openSubagentLane` (`chat-transcript.component.ts` providers block). Same behaviour in the single view, correct in the Rail | yes |
| 6 | Work-log open state per turn: `logOpenFor(turn)` = user choice ?? (full mode && any message of the turn streaming ? true : null) | per-bubble `isStreaming` only | with the per-bubble rule an earlier message's log closed while a later one streamed, so the first message's disclosure row said closed while a log was open | yes |
| 7 | Live turn = streaming message OR roster agent of the turn `running` / `waiting` / `queued` | `running` only | §3.1 "answered, work still running"; `waiting` (needs you) and `queued` are unfinished work | yes |
| 8 | Agent ids collected at any depth of the turn's trees | top-level only | nested agents are still spawned within the turn; roster filter keeps only session-owned entries | yes |
| 9 | `data-testid="chat-tool-output"` kept on the assistant `<article>` | drop with the bubble card | used by 8 Electron e2e specs/scenes | yes |
| 10 | Streaming caret: after the last log row while streaming with no answer yet, else after the last answer row; raw fallback caret kept | plan: after last `li` only | a text-only streaming message has no log (`splitTurnMessage`), its text is the answer | yes |
| 11 | Streaming quotes render outside the log wrapper when the log has no row | inside the log (plan) | with no row the log wrapper is not rendered (`hasLog`) | yes |
| 12 | Copy button unchanged (24 px `btn-xs btn-square`), no wrapper opacity | restyle to 28 px recipe | Open check 5: `CopyButtonComponent` exposes only `message`; restyling needs a chat-ui change outside this batch | yes |

## Deviations from the plan

- Two new non-spec source files in `transcript/` (decision 1, 2 and the live clock), following the
  `transcript-turn-snapshots.ts` / `transcript-display-feed.ts` sibling-helper pattern instead of growing the
  1,200-line transcript component.
- `messageSummary` was removed by the first executor (plan said keep); the disclosure counts use
  `summarizeTurnMetrics(turn)` over the whole turn instead, which is the plan's "summed over the turn" (B-4).
- `.st-t` also lands on every `.cs-answer` (one per assistant message with answer rows), not only the turn's last;
  never nested, so CV-2's index pass is unaffected.

## Diagnostics

`ptah_get_diagnostics` scoped to every changed `.ts` (bubble, inline-agent-bubble, transcript, both helpers, bubble
spec, harness, transcript spec, replay-mount spec): no diagnostics in the requested files. The sibling errors it
lists are pre-existing spec typing errors in files this batch did not touch (agent-card-truncation, chat-input,
compact-lane-rows, compact-session-card, send-message-chip, workflow-card, tab-bar). Templates are not covered by
this tool: MODE 2 `nx typecheck`/`test` must confirm them.

## For CV-1 / CV-3 / team-leader (outside A1-3 ownership)

- REQUIRED, CV-1-owned spec: `templates/chat-view.keepalive.spec.ts:~95-110` has its own `ptah-message-bubble` stub
  (with `messageIndex`/`totalMessages`). `src/test-setup.ts` sets `errorOnUnknownProperties: true`, so the
  transcript's new bindings will throw there until the stub gains inputs `turn`, `viewMode`, `logOpen`, `turnLive`,
  `now`, `needsYouCount`, `agents` and outputs `logToggled`, `laneRequested` (the two old inputs can go).
- Chat-view bindings for CV-3: none needed. The transcript reads `viewMode`, the roster and the needs-you count
  itself; chat-view's compact-card retirement (A-6/A-16) stays with CV-2.
- `chat-view.memo.spec.ts` should keep passing (it never renders the template; decision 4 keeps construction free
  of the inspector store and roster).
