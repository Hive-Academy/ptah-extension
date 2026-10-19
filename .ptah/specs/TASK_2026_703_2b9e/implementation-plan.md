# Implementation Plan - TASK_2026_703_2b9e

Lane message input and stats header (follow-up of PR #751 / TASK_2026_685).
Worktree: `D:\projects\ptah-extension\.claude-worktrees\lane-input-and-stats`, branch
`feat/lane-input-and-stats`. All paths below are relative to that worktree.

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_703_2b9e/context.md` (4 scopes, user decisions),
  `.ptah/specs/TASK_2026_685_64f4/reports/code-logic-review-final-fix-and-b5c.md`,
  `.ptah/specs/TASK_2026_685_64f4/reports/visual-review-final.md`,
  `.ptah/specs/TASK_2026_685_64f4/HANDOFF.md` (what landed after the reviews), `CLAUDE.md`.
- Corrections applied: the review findings were re-checked against the merged code. Several
  were fixed after the reviews in `e1a87d8b9` (CodeRabbit round) and `95f21c3fe`. The plan only
  carries the defects that are still open (see "Verified current state").
- Design handoff used: none. The visual reference is the existing `ptah-session-stats-summary`
  collapsed bar (`libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.html:18-140`).
- Missing decision-critical input: whether the VS Code single-chat in-place agent view should
  get the same lane (Decision 2), and scope 4 (Decision 1). Work that does not depend on them is
  fully specified; the affected parts are marked CONDITIONAL.
- Parallel task (another branch) owns `tool-call-header.component.ts`, `marked-extensions.ts`, a
  chat-ui lane "result card", and possibly the agent text rendering in
  `inline-agent-bubble.component.ts` / `execution-node.component.ts`. This plan does not edit any
  of those files. The only shared file is `libs/frontend/chat-ui/src/index.ts`, where both tasks
  add export lines (an append-only merge).

## Verified current state per scope

### Scope 1 - message input

| Fact | Location | Implication |
| --- | --- | --- |
| The lane shows the steer input only after the header toggle, and only when the tray context is `steerable` | `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts:102-120`, `:159-175`, `:275-277` | The toggle and `steerOpen` state get replaced by an input that is always shown |
| Tray contexts exist only for active sub-agents (`running`/`pending`/`paused`) and for background entries; a background entry is `steerable` only while running | `libs/frontend/chat/src/lib/services/session-agents/session-agent-tray.ts:146-148`, `:173`, `:229`, `:260` | A finished agent has `context() === null`, so the lane must route its input without a tray context |
| Steer goes through `SessionAgentTrayService.steer` -> `AgentMonitorStore.sendMessageToAgent` -> `subagent:send-message`; failures are recorded in `subagentRpcError` | `session-agent-tray.service.ts:81-91`; `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:2482-2516`; `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts:236-260` | Reuse as is for running agents. No backend change |
| An existing port sends a message to a session's chat with send-or-queue routing and never rejects | `libs/frontend/core/src/lib/tokens/agent-feedback-sender.token.ts:7-37`; `libs/frontend/chat/src/lib/services/agent-feedback/chat-agent-feedback-sender.service.ts:25-80` | This is the "follow-up to the main chat" transport for finished sub-agents |
| Precedent prompt for asking the main agent to resume a sub-agent | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:1560-1571` (`handleResumeAgent`) | The follow-up prompt follows the same shape |
| Queueing behind a streaming turn also answers that tab's pending permission prompts with the message text (`deny_with_message`) | `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:181-230` | Same behaviour as typing in the main composer. Accepted, and the input's hint says the text goes to the main chat |
| CLI follow-ups: `AgentContinueInputComponent` (queue while running, continue, resume fallback) is rendered only by the agent monitor panel | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts`; `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts:534-543`; `AgentFollowUpQueueService` `libs/frontend/chat/src/lib/services/agent-follow-up-queue.service.ts:71-140` | Reuse unchanged |
| The only CLI lane surface is the canvas lane (`ptah-agent-card presentation="flat"`); it has no input | `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:130-175` (the `@case ('cli')` block, card at `:167-170`) | Mount `ptah-agent-continue-input` under the card |
| `AgentContinueInputComponent` is already a public export of `@ptah-extension/chat` | `libs/frontend/chat/src/lib/components/index.ts:57` | Canvas can import it without a boundary change (both are `scope:webview, type:feature`) |
| The single chat cannot open CLI lanes; it opens a sub-agent in place through `ptah-single-chat-subagent-view`, which renders the agent node (the inline bubble), not `ptah-subagent-lane` | `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:925-949`; `chat-transcript.component.html:189-195`; `single-chat-subagent-view.component.ts:79-86` | The bubble keeps its own running-only message toggle (`inline-agent-bubble.component.ts:327-346`, `:1063-1067`). See Decision 2 |

### Scope 2 - lane stats header

| Fact | Location | Implication |
| --- | --- | --- |
| Sub-agent lane top = execution header + `ptah-subagent-usage-summary` (mono row) + Model/Task/Parent `<dl>`, all inside the collapsed details region | `subagent-lane.component.ts:60-149`; `libs/frontend/chat/src/lib/components/molecules/execution-header/execution-header.component.ts:27-31` (details render only when `open()`) | The stats bar must sit outside the details so it is always visible |
| D3: the usage row tints value text with `text-info/70`, `text-accent/70`, `text-warning/70` | `libs/frontend/chat/src/lib/components/molecules/agent-card/subagent-usage-summary.component.ts:69`, `:76`, `:93`, `:102` | Replacing the row fixes D3; the new bar uses base-content ink for values |
| `ptah-subagent-usage-summary` is used only by the lane; it also triggers the one `chat:subagent-query` that supplies the cache TTL | grep: only `subagent-lane.component.ts:123`; load at `subagent-usage-summary.component.ts:147-169`, store `agent-monitor.store.ts:2323-2364` | Delete the component; move the cache-info load into the lane |
| Main bar look: chips with an uppercase muted label and a base-content value (Model purple tint, Context cyan, Tokens neutral, Cost success); the values use base-content ink because tinted text measured 1.4-2.4:1 | `session-stats-summary.component.html:18-115` (comment at `:25-28`) | The new lane bar copies these chip classes |
| `ptah-session-stats-summary` reads only a backend `SessionStatsEntry` snapshot plus limits/budget inputs | `session-stats-summary.component.ts` (`snapshot` input, budget, limits, lanes) | An adapter onto it would fake a snapshot. A sibling presentational component is the fit |
| Sub-agent figures available: `subagentUsageView(record, now)` gives context tokens, cache state, cache read/write, output, estimated cost; `record.usage.model`; `record.totalTokens` | `agent-monitor.store.ts:347-378`, `:530-620` | Sub-agent adapter input |
| CLI figures: `agent.usageTotals ?? usageTotalsFromSegments(segments)` (context, input, output, cache, cost, partial), `agent.model`; token rule in `laneMeta` | `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.ts:58-80`; `agent-card.component.ts:250-258` | CLI adapter input; the token rule moves unchanged |
| The CLI flat lane uses `ptah-cli-lane-usage-summary presentation="flat"` inside the details; the card presentation (monitor panel) uses it too | `agent-card.component.ts:96`, `:121-125` | The flat lane switches to the new bar; the card keeps the old row, and its `flat` branch is deleted |
| D6: `description` is overwritten by every `agent_progress` / `agent_status` event; only `agent_start` carries the real task (`agentDescription`) | `agent-monitor.store.ts:2025` (start), `:2131` (progress), `:2172` (status); lane Task row `subagent-lane.component.ts:131-136` | Add a task field that only `agent_start` writes |
| Header meta already shows `N tokens` from `record.totalTokens` (sub-agent) and from the CLI token rule | `subagent-lane.component.ts:327-337`; `agent-card.component.ts:250-258` | Tokens move to the bar and leave the header meta, so the number is never shown twice from two sources |

### Scope 3 - open defects from the #751 reviews

| Finding | Status now | Evidence |
| --- | --- | --- |
| Major 1 (bubble history states never render) | FIXED | `entryFor` returns a snapshot per revision, `subagent-execution.store.ts:173-190` (commit `e1a87d8b9`) |
| Major 2 (`retain()` tracked read) | FIXED | `retain` body runs in `untracked`, `subagent-execution.store.ts:420-437` |
| Lane history effect never re-fires (unnumbered minor) | FIXED by the same snapshot | `subagent-lane.component.ts:359-364` reads `entry()` which now changes identity per revision |
| m1 `keyRevisions` never pruned | OPEN | `remove()` bumps but keeps the signal, `subagent-execution.store.ts:499-512` (bump at `:503`) |
| m2 LRU only updated by `retain` | OPEN, accepted | `subagent-execution.store.ts:434`; the degradation is the documented summary fallback |
| m3 wrong session pinned by the bubble fallback, `not-found` sticky | OPEN | `open()` only fills an empty `sessionId`, `subagent-execution.store.ts:213-216`; `ensureHistory` returns on `not-found`, `:532-536`; bubble fallback `inline-agent-bubble.component.ts:734-746` |
| m4 refinalize on late events | OPEN, deferred | `subagent-execution.store.ts:180-183` |
| m5 lane reused across selection in the monitor panel carries steer state; usage summary dropped; no permission lookup | OPEN | `agent-monitor-panel.component.ts:574-577` binds only `record` and `sessionId` |
| D1 tile `0 tools` | FIXED | commit `95f21c3fe` |
| D2 restored lane loses header facts and tool nodes | OPEN, deferred | visual-review-final.md D2: the restored tree holds one text node; the cause is in what history returns, not in the lane |
| D4 no Load control on a restored main-chat agent | NO CHANGE NEEDED | the lane auto-loads (`subagent-lane.component.ts:359-364`) and shows Retry on failure (`:207-229`); the single-chat bubble has `Load agent output` (`inline-agent-bubble.component.ts:446-454`) |
| D5a `ensureHistory` silent when no entry | OPEN (minor) | `subagent-execution.store.ts:524-525` |
| D5b load returns while `loading` after a generation change | FIXED in effect | the generation only changes in `abort()`, which resets `loading` to `idle`, `subagent-execution.store.ts:457-463`; `enforceLiveCap` sets `idle` at `:493` |

### Scope 4 - `agent:summary-chunk`

| Fact | Location |
| --- | --- |
| The webview still handles `agent:summary-chunk` into `StreamingState.agentSummaryAccumulators` | `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:748-758`; `chat-store/chat-lifecycle.service.ts:153-200` |
| No backend code produces it: no `summaryDelta` / `AGENT_SUMMARY_CHUNK` producer under `libs/backend` or `apps/*/src` (only the Electron batching set relays the type) | repo grep; `apps/ptah-electron/src/ipc/ipc-bridge.ts:57-62` |
| The watcher that used to send it is a no-op stub; sub-agent text now arrives as forwarded sub-agent messages (`forwardSubagentText: true`) carrying `parent_tool_use_id` | `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:15-24` |
| Those forwarded messages are routed into `SubagentExecutionStore`, which the lane renders | `subagent-execution.store.ts:236-300` (`claim`) |
| The lane's `summaryContent` input is never bound by any consumer | grep: declared at `subagent-lane.component.ts:259`, read at `:302-306`; no binding in canvas or panel |
| Only the e2e harness emits the event | `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts:35`, `:56` |

## Architecture decision

- Chosen approach:
  1. Sub-agent lane: an always-visible composer at the bottom of the lane. Its mode comes from
     the agent's state: steer (`subagent:send-message`) while the tray context is steerable,
     otherwise a main-chat follow-up through `ChatAgentFeedbackSender` with a prompt that asks the
     main agent to continue that sub-agent.
  2. CLI lane: mount the existing `ptah-agent-continue-input` under the canvas CLI card.
  3. Stats: a new presentational chat-ui component, `ptah-agent-lane-stats`, that takes a plain
     view model and copies the chip look of the main bar. Two pure adapters in chat build the view
     model from a `SubagentRecord` or a `MonitoredAgent`. It replaces the usage rows in both lanes.
  4. Store fixes: m1, m3, D5a in `SubagentExecutionStore`; D6 through a new
     `SubagentRecord.taskDescription` field.
- Rationale: every transport already exists and is verified (steer RPC, feedback sender,
  `agent:continue`/resume via `AgentFollowUpQueueService`). This is frontend-only work, and each
  piece reuses an established pattern.
- Rejected alternatives:
  - Feeding `ptah-session-stats-summary` a synthetic `SessionStatsEntry`. It would invent backend
    accounting fields (`modelUsageList`, `tokenCount`, budget, lanes) that lanes do not have.
    The component's contract is "only the backend snapshot" (`session-stats-summary.component.ts`
    class doc). Rejected.
  - A backend RPC to resume a finished sub-agent directly. The user decided on routing through
    the main chat, and the resume RPC was removed in #751. Rejected.
  - Keeping `ptah-subagent-usage-summary` in the details and only recolouring it (minimal D3
    fix). That leaves two stats rows. Rejected: the replacement removes the row.
  - A new `SubagentFollowUpService`. It would have one caller and one implementation. A pure
    prompt function plus a direct call to `ChatAgentFeedbackSender` (same library) is enough.
- Assumptions (with the check that resolves each):
  - A1: a restored (replayed) sub-agent record still goes through `onAgentStart`, so it gets
    `taskDescription`. Check: in `agent-monitor.store.spec.ts`, replay an `agent_start` then an
    `agent_progress` and assert the field survives. If replay builds records elsewhere, set the
    field there as well (grep `description:` in `agent-monitor.store.ts`).
  - A2: the Electron dock shows CLI lanes only through the canvas lane view (from the brief).
    Check: grep `ptah-agent-card` in `apps/ptah-electron` and `libs/frontend`. Today only
    `canvas-lane-view.component.ts:167` and `agent-monitor-panel.component.ts:534` render it.
  - A3: `ChatAgentFeedbackSender.activateSessionTab` switching to the owning tab is harmless from
    a canvas lane, because the lane's tile is that tab. Check during the visual pass.
- Effect on existing code: deletes `SubagentUsageSummaryComponent` (+ spec, + export), the lane's
  steer toggle and its state, the lane's `summaryContent` input (CONDITIONAL on Decision 1), the
  Model row and token meta in both lane headers, and `CliLaneUsageSummaryComponent`'s `flat`
  presentation. The agent monitor panel's card presentation, the bubble, the tray, the inspector
  steer input and the backend stay unchanged.

## Component specifications

### 1. `SubagentRecord.taskDescription` (D6)

- Purpose: keep the agent's real task apart from the progress text that overwrites `description`.
- Responsibilities: `onAgentStart` sets `taskDescription: event.agentDescription ?? existing?.taskDescription`.
  Every other reducer (`onBackgroundAgentStarted`, `onAgentProgress`, `onAgentStatus`,
  `onAgentCompleted`, `onSubagentMessageComplete`, cache-info merge) carries `existing?.taskDescription`.
  `description` keeps its current meaning (the latest activity), so the tray and inspector do not change.
- Verified contracts: `SubagentRecord` `agent-monitor.store.ts:530-620`; reducers at `:2012`, `:2068`,
  `:2118`, `:2159`, `:2200`.
- Dependencies: none new.
- Integration points: lane Task row (component 5), follow-up prompt (component 4).
- Failure behaviour: field absent -> the Task row is hidden (never falls back to progress text).
- Verification seam: `agent-monitor.store.spec.ts`: start -> progress -> status -> completed keeps
  `taskDescription` equal to the start's `agentDescription` while `description` follows progress.
- Files: MODIFY `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`,
  `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts`.

### 2. `SubagentExecutionStore` residual fixes (m1, m3, D5a)

- Purpose: close the open store defects the lane and the bubble depend on.
- Responsibilities:
  - m1: in `remove()`, bump the key's revision signal, then `keyRevisions.delete(key)`. This is
    safe: the bump dirties consumers, and their next `revisionFor(key)` creates and subscribes to
    a fresh signal (`revisionFor` `:163-170`).
  - m3: in `syncRecord(record)`, the monitor record's `parentSessionId` is authoritative. When it
    is known and differs from `entry.sessionId`, overwrite it. If `history` is `not-found`, `error`
    or `unresolved`, reset it to `idle` and clear `historyError`, then publish. The lane's
    auto-load effect, or the bubble's Load button, then retries with the right session. `open()`
    keeps first-fill semantics for callers without a record.
  - D5a: `ensureHistory(key)` with no entry logs `logger.warn('SubagentExecutionStore', ...)` and
    returns. Callers always `retain` first, so this only flags misuse. Annotate it with the
    repository's `degradation-audit: reported` comment convention (as at `:614-615`).
- Verified contracts: `open` `:192-218`, `syncRecord` `:220-233`, `remove` `:499-512`,
  `ensureHistory` `:523-551`.
- Dependencies: unchanged.
- Failure behaviour: the m3 reset happens only on a session change, so a genuine `not-found` for
  the right session stays sticky.
- Verification seam: `subagent-execution.store.spec.ts`: (a) after `remove`, `revisionFor` creates
  a new signal and a computed consumer still recomputes on the next publish; (b) an entry opened
  with session A whose history ended `not-found`, then synced with a record naming session B,
  becomes `idle` with `sessionId` B; (c) `ensureHistory` on an unknown key warns and does not throw.
- Files: MODIFY `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts`,
  `libs/frontend/chat-streaming/src/lib/subagent-execution.store.spec.ts`.

### 3. `AgentLaneStatsComponent` (`ptah-agent-lane-stats`, chat-ui)

- Purpose: the compact stats bar for one lane (sub-agent or CLI), with the look of the main
  session bar.
- Responsibilities: render chips from a view model only (no store access except
  `ModelStateService` for display names, as `session-stats-summary.component.ts` does). Chips:
  - Model (purple tint): `resolveModelDisplayName(model, availableModels())`, hidden when `null`.
  - Context (cyan tint): formatted tokens, `—` when `null`.
  - Tokens (neutral): formatted, with a `≥ ` prefix when `tokensPartial`, `—` when `null`, and
    `tokensTitle` as the tooltip.
  - Cost (success tint): `undefined` -> `—` (not reported); `null` -> `ptah-cost-badge`
    "cost unavailable"; a number -> `ptah-cost-badge`, with `≥ ` when `costPartial`.
  - Cache (sub-agent only, when `cache` is not `null`): `warm`/`cold` text with `cacheTitle`.
- View model (exported type, in the component file):
  `AgentLaneStatsView { model: string | null; contextTokens: number | null; tokens: number | null;
  tokensPartial: boolean; tokensTitle: string | null; cost: number | null | undefined;
  costPartial: boolean; cache: 'warm' | 'cold' | null; cacheTitle: string | null }`.
- Verified contracts: chip markup and classes `session-stats-summary.component.html:18-115`;
  `CostBadgeComponent` `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts`;
  `formatTokens` / `formatOptionalTokens` `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-format.ts:18`, `:29`;
  `resolveModelDisplayName` from `@ptah-extension/shared` and `ModelStateService` from
  `@ptah-extension/core` (imports at the top of `session-stats-summary.component.ts`).
- Dependencies: chat-ui -> shared, core (existing edges). No chat-streaming import.
- Integration points: input `stats: AgentLaneStatsView` (required). `role="group"`,
  `aria-label="Agent usage"`.
- Failure behaviour: every missing figure renders `—`, never `0`.
- Quality requirements: OnPush, signal inputs. Values use `text-base-content`, labels
  `text-base-content-muted`, and no opacity-tinted text (D3), so text contrast is at least 4.5:1
  in `anubis` and `anubis-light`. One row with `overflow-x-auto` and no wrapping, like the main bar.
- Verification seam: `agent-lane-stats.component.spec.ts`: model display name, `—` for missing
  figures, `undefined` vs `null` cost, the partial prefix, the cache chip shown and hidden, and no
  class matching `/\/70\b/` on value spans.
- Files: CREATE `libs/frontend/chat-ui/src/lib/molecules/agent-lane-stats/agent-lane-stats.component.ts`,
  `.../agent-lane-stats.component.spec.ts`; MODIFY `libs/frontend/chat-ui/src/index.ts` (export the
  component and the type; append-only, may meet the parallel task's export lines).

### 4. Lane stats adapters and follow-up prompt (chat, pure functions)

- Purpose: turn store records into `AgentLaneStatsView`, and build the follow-up prompt.
- Responsibilities:
  - `subagentLaneStats(record, now): AgentLaneStatsView`. It uses `subagentUsageView(record, now)`
    for context, cache state and cost; model = `record.usage?.model ?? null`.
    tokens = `record.totalTokens` when finite and > 0 (the same source as today's header meta,
    `subagent-lane.component.ts:330-335`), else the sum of the four `record.usage` classes, else
    `null`. `tokensTitle` lists in/out/cache read/cache write when reported. `cacheTitle` keeps
    today's text (`subagent-usage-summary.component.ts:131-137`).
  - `cliLaneStats(agent): AgentLaneStatsView`. usage = `agent.usageTotals ?? usageTotalsFromSegments(agent.segments)`.
    tokens and the partial flag follow the `laneMeta` rule exactly (`agent-card.component.ts:252-257`);
    cost and `costPartial` follow `cli-lane-usage-summary.component.ts:73-77`; context =
    `usageTotals?.contextTokens`; cache = `null`; model = `agent.model ?? null`.
  - `subagentFollowUpPrompt(record, text): string`, of this shape:
    `Continue the {agentType || teammateName || 'sub-agent'} sub-agent[ (agent id {agentId})][ that worked on "{taskDescription}"] with this message from me:\n\n{text}`.
    Bracketed parts are left out when unknown.
- Verified contracts: `subagentUsageView` `agent-monitor.store.ts:347-378`; `usageTotalsFromSegments`,
  `formatTokens` `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts:10`;
  `handleResumeAgent` prompt precedent `chat-view.component.ts:1567`.
- Dependencies: chat -> chat-streaming, chat-ui types (existing edges).
- Failure behaviour: pure. Missing data maps to `null`/`undefined` per the view model.
- Verification seam: `lane-stats.adapters.spec.ts` (sub-agent with and without usage, CLI with
  structured and segment-fallback usage, the partial flags); prompt tests for each omitted part.
- Files: CREATE `libs/frontend/chat/src/lib/utils/lane-stats.adapters.ts`,
  `libs/frontend/chat/src/lib/utils/lane-stats.adapters.spec.ts`,
  `libs/frontend/chat/src/lib/utils/subagent-follow-up-prompt.ts`,
  `libs/frontend/chat/src/lib/utils/subagent-follow-up-prompt.spec.ts`.

### 5. `SubagentLaneComposerComponent` (`ptah-subagent-lane-composer`, chat)

- Purpose: the always-visible message input of a sub-agent lane. It routes the text by agent state.
- Responsibilities:
  - Inputs: `record: SubagentRecord` (required), `context: TrayAgentContext | null`,
    `sessionId: string | null` (the lane's fallback session).
  - `mode`: `'steer'` when `context?.entry.steerable`; otherwise `'follow-up'` when the owning
    session (`record.parentSessionId ?? context?.sessionId ?? sessionId`) is known; otherwise
    `'unavailable'`.
  - Renders `ptah-agent-steer-input` with `[steerable]="true"`, `[clearOnSubmit]="false"`,
    `[(draft)]`, `[pending]`, and the placeholder `Message {name}…` (steer) or
    `Ask the main agent to continue {name}…` (follow-up). Under it, a visible hint in follow-up
    mode: "Sends to the main chat as a follow-up". In `unavailable` mode it shows a muted notice
    "This agent's session is not open" instead of the input.
  - Steer: `tray.steer(context, text)`. True clears the draft; false shows an `role="alert"` line
    "Could not send your message. Try again." and keeps the draft (the RPC error itself already
    shows through the lane's `commandError`).
  - Follow-up: `ChatAgentFeedbackSender.send({ sessionId }, subagentFollowUpPrompt(record, text))`.
    `sent` clears the draft and shows `role="status"` "Sent to the main chat" until the next
    input. Otherwise it shows the returned `error` as `role="alert"` and keeps the draft.
  - m5: an effect keyed on `record().parentToolUseId` resets the draft, pending, error and status
    (writes in `untracked`). A reused lane can then never send agent A's draft to agent B.
- Verified contracts: `AgentSteerInputComponent` `libs/frontend/chat-ui/src/lib/molecules/agent-steer-input.component.ts:24-104`
  (its `draft` becomes a `model()`, see Batch F2); `SessionAgentTrayService.steer` `:81-91`;
  `ChatAgentFeedbackSender.send` `chat-agent-feedback-sender.service.ts:29-64`;
  `TrayAgentContext` `session-agent-tray.ts:15-31`.
- Dependencies: chat services (same lib), chat-ui steer input.
- Integration points: placed by the lane (component 6) as the last child, in a
  `sticky bottom-0 bg-base-100` footer, so it stays in view while the lane scrolls in the canvas
  host (`canvas-lane-view.component.ts` host `overflow-auto`) and in the panel's `agentScroll`.
- Failure behaviour: no rejection escapes (the sender never rejects; `tray.steer` catches). A
  double send is blocked by `pending`. An agent that finishes during a steer makes the steer fail
  with the error line. The mode then flips to follow-up, and the kept draft can be re-sent.
- Quality requirements: OnPush. Input label = placeholder. Status and alert lines announced.
  No timers.
- Verification seam: `subagent-lane-composer.component.spec.ts` with mocked tray and sender:
  mode per status and context; steer success and failure; follow-up success and failure with the
  exact prompt; the unavailable notice; reset on record key change.
- Files: CREATE `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane-composer.component.ts`,
  `.../subagent-lane-composer.component.spec.ts`.

### 6. `SubagentLaneComponent` rework (chat)

- Purpose: the same lane with the stats bar and the composer.
- Responsibilities:
  - Remove: the message toggle button, `steerOpen`/`steerPending`/`steerFailed`, `toggleSteer`,
    `closeSteer`, `onSteer`, the `steerToggle` viewChild, the `MessageSquare` icon, the
    `AgentSteerInputComponent` and `SubagentUsageSummaryComponent` imports, the Model `<dl>` row,
    and the `N tokens` entry in `meta()` (the Background entry stays).
  - Add `<ptah-agent-lane-stats [stats]="stats()" />` directly after `</ptah-execution-header>`
    (outside the details). `stats = computed(() => { if (live()) monitor.tick(); return subagentLaneStats(record(), Date.now()); })`.
    This is the same shared tick the old row used (`subagent-usage-summary.component.ts:122-126`),
    so there is no timer of its own.
  - Add an effect keyed on `key()` that calls `monitor.loadSubagentCacheInfo(key)` in `untracked`
    and catches/logs a thrown error (moved from `subagent-usage-summary.component.ts:147-169`).
  - Task row reads `record().taskDescription` only (D6).
  - Add `<ptah-subagent-lane-composer [record]="record()" [context]="context()" [sessionId]="sessionId()" />` as the last child.
  - Reset `stopPending`/`backgroundPending` when `key()` changes (m5).
  - CONDITIONAL on Decision 1 = "no" (recommended): delete the `summaryContent` input. `finishedSummary`
    then uses `record().latestSummary` only when not live and the tree is empty. If the user
    chooses "yes", keep the input; Batch F5 binds it instead.
- Verified contracts: current template and class, `subagent-lane.component.ts:59-428`.
- Dependencies: components 3, 4, 5; component 1 for `taskDescription`.
- Failure behaviour: unchanged history states (`:177-252`); the cache-info failure leaves the
  cache chip hidden.
- Verification seam: rewrite the steer-toggle cases in `subagent-lane.component.spec.ts`. New
  cases: the composer is present for running and finished records; the stats bar shows outside
  the details while the header is collapsed; the Task row shows the start description after a
  progress update; the meta has no token entry; the cache-info load runs once per key.
- Files: MODIFY `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.ts`,
  `.../subagent-lane.component.spec.ts`.

### 7. Remove `SubagentUsageSummaryComponent` (chat)

- Purpose: replace, do not accumulate. The lane bar supersedes it (D3).
- Files: DELETE `libs/frontend/chat/src/lib/components/molecules/agent-card/subagent-usage-summary.component.ts`
  and `.../subagent-usage-summary.component.spec.ts`. MODIFY `libs/frontend/chat/src/lib/components/index.ts:56`
  (drop the export). MODIFY `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.spec.ts:30`, `:172`
  (it imports the component in a test host; switch to the lane stats or drop the case).
- Verification seam: chat typecheck. A grep for `SubagentUsageSummary` returns nothing outside
  the `.ptah/` docs.

### 8. CLI flat lane (chat `AgentCardComponent`, `CliLaneUsageSummaryComponent`)

- Purpose: the same stats bar on the CLI lane.
- Responsibilities: in the `flat` branch of `agent-card.component.ts`, add
  `<ptah-agent-lane-stats [stats]="laneStats()" />` right after `</ptah-execution-header>`,
  remove `ptah-cli-lane-usage-summary` from the details (`:96`), remove the Model row (`:99`), and
  remove the token entry from `laneMeta` (the status and stop-reason entries stay). Delete the
  `presentation` input and the `flat` class bindings in `cli-lane-usage-summary.component.ts`,
  since the card presentation (`:121-125`) is its only remaining use.
- Verified contracts: `agent-card.component.ts:52-125`, `:250-258`; `cli-lane-usage-summary.component.ts:12-80`.
- Failure behaviour: missing usage renders `—` chips.
- Verification seam: update `agent-card-flat-header.spec.ts` and `cli-lane-usage-summary.component.spec.ts`.
  The flat header shows the stats bar and no token meta; the card presentation is unchanged.
- Files: MODIFY `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts`,
  `.../cli-lane-usage-summary.component.ts`, `.../agent-card-flat-header.spec.ts`,
  `.../cli-lane-usage-summary.component.spec.ts`.

### 9. Canvas CLI lane input (canvas)

- Purpose: CLI follow-ups from the canvas and Electron lane.
- Responsibilities: in the `@case ('cli')` block of `canvas-lane-view.component.ts`, render
  `<ptah-agent-continue-input class="flex-shrink-0" [agent]="agent" />` after `ptah-agent-card`,
  and add `AgentContinueInputComponent` (from `@ptah-extension/chat`) to `imports`. The component
  hides itself when the agent cannot continue (`agent-continue-input.component.ts` `visible`) and
  queues while the agent runs (`AgentFollowUpQueueService`).
- Verified contracts: `canvas-lane-view.component.ts:130-175`; export `libs/frontend/chat/src/lib/components/index.ts:57`.
- Failure behaviour: owned by `AgentFollowUpQueueService` (undelivered text goes back into the box).
- Verification seam: `canvas-lane-view.component.spec.ts`. A CLI lane with `cliSessionId` renders
  `ptah-agent-continue-input`; a sub-agent lane does not.
- Files: MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`,
  `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts`.

### 10. CONDITIONAL (Decision 2 = yes): single-chat in-place view uses the lane

- Purpose: VS Code single chat gets the same stats bar and visible input.
- Responsibilities: `SingleChatSubagentViewComponent` looks up
  `AgentMonitorStore.subagents().get(node().toolCallId)`. With a record it renders
  `<ptah-subagent-lane [record]="rec" [sessionId]="…" [getPermissionForTool]="getPermissionForTool" (permissionResponded)="onPermissionResponse($event)" />`;
  without one it keeps today's `ptah-execution-node` body. Back, focus and Escape stay.
- Verified contracts: `single-chat-subagent-view.component.ts:30-140`; lane inputs
  `subagent-lane.component.ts:257-263`.
- Overlap: none with the parallel task. The bubble is not edited; it simply is not mounted when
  the lane is.
- Verification seam: `single-chat-subagent-view.component.spec.ts`: lane with a record, node
  fallback without one.
- Files: MODIFY `libs/frontend/chat/src/lib/components/organisms/transcript/single-chat-subagent-view.component.ts`,
  `.../single-chat-subagent-view.component.spec.ts`.

## Integration architecture

- Data flow (sub-agent input): user text -> `SubagentLaneComposerComponent`. In steer mode:
  `SessionAgentTrayService.steer` -> `AgentMonitorStore.sendMessageToAgent` -> RPC
  `subagent:send-message` (`sessionId` = owning session). In follow-up mode:
  `subagentFollowUpPrompt` -> `ChatAgentFeedbackSender.send({sessionId})` -> owning tab ->
  `ChatStore.sendOrQueueMessage` (send now, or queue behind the running turn) -> user bubble in
  the main transcript -> the main agent resumes or continues the sub-agent.
- Data flow (CLI input): `AgentContinueInputComponent` -> `AgentFollowUpQueueService` ->
  `AgentMonitorStore.continueAgent` (`agent:continue`) or `resumeAgentWithMessage` (`agent:resumeCliSession`).
- Data flow (stats): `AgentMonitorStore` record or agent signals -> pure adapter in a lane
  `computed` -> `ptah-agent-lane-stats`. The sub-agent cache TTL is loaded once per key by the lane
  (`chat:subagent-query`).
- State: draft, pending and status live in the composer, reset per agent key. The CLI queue lives
  in the root `AgentFollowUpQueueService`. No new persistent state.
- External boundaries: no new RPC or message type. The text is sent as typed, inside the
  generated prompt. The backend schema `SubagentSendMessageSchema` validates the steer params
  (`subagent-rpc.handlers.ts:241-247`).
- Failure and rollback: every send failure keeps the draft and shows an inline alert. Nothing is
  mutated optimistically.
- Observability: steer errors go to `subagentRpcError` (shown in the lane). Follow-up errors are
  the sender's user-facing `error`. Cache-info failures are `console.warn` (unchanged behaviour).

## Deferred (with reason)

- D2 (restored lane has one text node and no facts): the restored history is missing the tool
  events, so the cause is in what `subagent:history-page` returns, not in the lane. It needs a
  backend investigation with a real restored session (`libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts`,
  the agent-sdk session history reader). Open it as its own task. The new bar shows `—` honestly
  in the meantime.
- m2 (LRU order only through `retain`): degrades to the documented record-summary fallback.
  Low value.
- m4 (refinalize per late event after a terminal status): medium confidence, depends on runtime
  ordering that the removed resume RPC made rare.
- m5 tail (no `getPermissionForTool` on the monitor panel's workflow lane): the old viewer could
  not answer these prompts either. It needs `WorkflowPermissionPresenterService` wiring, which is
  out of this scope.
- The dead `agent:summary-chunk` frontend path (handler, accumulator, registry baseline entry
  `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:434`, e2e emitter): removing it
  touches the DI and host-source guard specs. It belongs in a separate cleanup task.
- Removals-review minors (stale doc comment `background-agent-strip.component.ts:139`, dead
  `TrayAgentContext.agentId`): unrelated to this scope. The follow-up prompt reads
  `record.agentId`, not `TrayAgentContext.agentId`.

## Decisions (made here, reversible)

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| The stats bar is a sibling presentational component, not an adapter onto `ptah-session-stats-summary` | adapter / sibling | snapshot-only contract of `SessionStatsSummaryComponent` | yes |
| Tools stay in the header disclosure row (where every lane and turn row shows them); the bar has Model, Context, Tokens, Cost, Cache | tools in bar / in header / both | `execution-header.component.ts:13-24`; the e2e asserts the tool count in the disclosure meta (`task-337…spec.ts:251-252`) | yes |
| Tokens move from the header meta into the bar, from the same source rule | keep in both / move | `subagent-lane.component.ts:327-337`, `agent-card.component.ts:250-258` | yes |
| The follow-up uses the existing `ChatAgentFeedbackSender` and a prompt modelled on `handleResumeAgent` | new service / existing sender | `chat-agent-feedback-sender.service.ts`, `chat-view.component.ts:1560-1571` | yes |
| Accept that a queued follow-up answers the main tab's pending permission prompts like typed text does | special-case / accept | `message-dispatch.service.ts:181-230` | yes |
| The CLI input mounts in the canvas lane view, not inside `AgentCardComponent` | card / host view | the monitor panel precedent puts it outside the card, `agent-monitor-panel.component.ts:534-543` | yes |
| D4 needs no change; D5b and Majors 1-2 are already fixed | - | see the scope 3 table | - |

## User decisions (2026-10-19)

- Decision 1 (summary-chunk in the lane): NO. Delete the unbound `summaryContent` input. Skip F5.
- Decision 2 (single chat uses the lane): YES. Run F6.
- Plan approved: F1-F4 and F6. The deferred items stay deferred.
- Added later the same day: batch F7 removes the whole dead `agent:summary-chunk` path in this
  task (it is no longer deferred). The subagent streaming flag (`forwardSubagentText`) replaces it.

## Decisions needed

1. USER DECISION - scope 4, `agent:summary-chunk` in the lane. Recommendation: do not show it,
   and delete the lane's unbound `summaryContent` input. Trade-off: nothing in the backend emits
   the event any more (the watcher is a no-op stub, `subagent-hook-handler.ts:23-24`). The
   sub-agent's text already reaches the lane as forwarded sub-agent messages in the store, so
   showing the accumulator would add a second copy of text that no production path ever fills.
   Only the e2e harness sends it. The alternative (bind the parent tab's accumulator, keyed by
   `agentId`, as the empty-tree fallback) is a small batch F5 in canvas and chat. It would serve
   only the e2e mock or an older host. (Recommended: No.)
2. VS Code single chat: should the in-place sub-agent view render `ptah-subagent-lane` (stats bar
   and always-visible input) instead of the inline bubble, when a monitor record exists?
   (Recommended: Yes. It is batch F6, one file plus its spec, and does not edit the bubble.)
   No leaves the single chat with the bubble's running-only "Message agent" toggle.

## Architecture-level quality requirements

- Functional: a running sub-agent's lane always shows an input that steers it. A finished one
  shows an input whose text lands as a follow-up in the owning main chat. A CLI canvas lane with
  continuation or a CLI session shows `ptah-agent-continue-input`. Both lanes show the stats bar
  without expanding the header. The Task row shows the start description live and after a restore.
- Performance: no new timers, observers or per-item subscriptions. The stats recompute on the
  existing shared `monitor.tick`, and only while live. One `chat:subagent-query` per lane key.
- Security: the text is sent as data inside the prompt string. No HTML rendering of the draft.
  No new RPC surface.
- Maintainability: Nx tags unchanged (`scope:webview, type:feature` for chat-ui, chat, canvas).
  chat-ui does not import chat-streaming. No edits to the parallel task's files.
- Testability: each component has a spec at its own boundary (store, adapter, composer, bar,
  lane, canvas view), with mocks for the tray, the sender and the RPC.

## Team-leader handoff

- Recommended executors: frontend-developer for every batch (all Angular). No backend batch: no
  RPC, handler or backend type changes are needed (steer, `agent:continue` and
  `agent:resumeCliSession` exist; scope 4 recommends no wiring).
- Complexity: MEDIUM. Four frontend projects; the composer routing and the lane spec rewrite
  carry the risk.
- Dependencies and ordering: F1 (chat-streaming) and F2 (chat-ui) are independent. F3 (chat)
  needs F1 (`taskDescription`) and F2 (`ptah-agent-lane-stats`, steer input `model`). F4 (canvas)
  is independent. F5 and F6 are conditional and run after F3.
- Parallel-safe work: F1, F2 and F4 are file-disjoint and can run in parallel. The heavy checks
  still run one at a time (CLAUDE.md).

### Batch F1 - chat-streaming: record task field and store fixes

- Files: MODIFY `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`, `agent-monitor.store.spec.ts`,
  `subagent-execution.store.ts`, `subagent-execution.store.spec.ts`.
- Acceptance: component 1 and component 2 verification seams pass. `description` behaviour is
  unchanged for the tray and inspector specs.
- Verify (one at a time): `npx nx test @ptah-extension/chat-streaming --parallel=1`;
  `npx nx typecheck @ptah-extension/chat-streaming --parallel=1`; `npx nx lint @ptah-extension/chat-streaming --parallel=1`.

### Batch F2 - chat-ui: lane stats bar and steer input draft model

- Files: CREATE `libs/frontend/chat-ui/src/lib/molecules/agent-lane-stats/agent-lane-stats.component.ts`,
  `agent-lane-stats.component.spec.ts`. MODIFY `libs/frontend/chat-ui/src/index.ts` (exports),
  `libs/frontend/chat-ui/src/lib/molecules/agent-steer-input.component.ts` (`draft` -> `model('')`;
  `background-agent-strip` and `inspector-agents-section` do not bind it, so they keep working),
  plus its spec if present (add a case: setting `draft` from the parent clears the field).
- Acceptance: component 3 seam. Existing steer-input consumers' specs stay green.
- Verify: `npx nx test @ptah-extension/chat-ui --parallel=1`; `npx nx typecheck @ptah-extension/chat-ui --parallel=1`;
  `npx nx lint @ptah-extension/chat-ui --parallel=1`.

### Batch F3 - chat: adapters, composer, lane rework, CLI flat bar, removal

- Files: CREATE `libs/frontend/chat/src/lib/utils/lane-stats.adapters.ts` (+ spec),
  `libs/frontend/chat/src/lib/utils/subagent-follow-up-prompt.ts` (+ spec),
  `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane-composer.component.ts` (+ spec).
  MODIFY `subagent-lane.component.ts` (+ spec), `molecules/agent-card/agent-card.component.ts`,
  `molecules/agent-card/cli-lane-usage-summary.component.ts` (+ spec), `molecules/agent-card/agent-card-flat-header.spec.ts`,
  `components/index.ts`, `organisms/agent-monitor-panel.component.spec.ts`.
  DELETE `molecules/agent-card/subagent-usage-summary.component.ts` (+ spec).
- Acceptance: the seams of components 4-8. A grep for `SubagentUsageSummary` returns nothing in
  `libs/`. With Decision 1 = No, `summaryContent` is gone from the lane.
- Verify: `npx nx test @ptah-extension/chat --parallel=1` (a known flaky `CompactSessionCardComponent`
  case under load passes alone); `npx nx typecheck @ptah-extension/chat --parallel=1`;
  `npx nx lint @ptah-extension/chat --parallel=1`.

### Batch F4 - canvas: CLI lane input

- Files: MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (+ spec).
- Acceptance: component 9 seam.
- Verify: `npx nx test @ptah-extension/canvas --parallel=1`; `npx nx typecheck @ptah-extension/canvas --parallel=1`;
  `npx nx lint @ptah-extension/canvas --parallel=1`.

### Batch F5 - CONDITIONAL (Decision 1 = Yes): summary-chunk fallback

- Files: MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` (bind
  `summaryContent` from the owning tab's `streamingState.agentSummaryAccumulators.get(record.agentId)`)
  and the lane's `finishedSummary` (show it while live when the tree is empty).
- Verify: canvas and chat tests as in F3 and F4.

### Batch F6 - CONDITIONAL (Decision 2 = Yes): single-chat view uses the lane

- Files: MODIFY `libs/frontend/chat/src/lib/components/organisms/transcript/single-chat-subagent-view.component.ts` (+ spec).
- Acceptance: component 10 seam. The chat-transcript specs that open a sub-agent stay green.
- Verify: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/transcript/single-chat-subagent-view.component.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.spec.ts --coverage=false --maxWorkers=2`,
  then `npx nx typecheck @ptah-extension/chat --parallel=1`.

- Files affected: CREATE 7 (bar + spec, adapters + spec, prompt + spec, composer + spec, counted
  as source/spec pairs). MODIFY about 18. DELETE 2. All are listed per batch above.
- Verification points: no RPC or message-type change, so the DI and host-source guard specs are
  not required. If F5 is chosen it reads only existing state, and they are still not required.
  Never run build, serve or e2e. The task-337 e2e asserts the disclosure peek and meta tool
  count, which this plan keeps. After the batches, a visual pass in `anubis` and `anubis-light`
  at 1440 and 760 confirms the D3 contrast and the sticky composer.
