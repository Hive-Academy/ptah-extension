# Batch 22 report — H1 transcript projections (TASK_2026_623_3492)

Executor: frontend-developer. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`. No git
commands run. `batches.md`, `decisions.md` and `task.md` are not edited.

## Tasks

| Task | Status | Files |
| --- | --- | --- |
| 22.1 fence-line display check | COMPLETE | `libs/frontend/chat/src/lib/components/organisms/execution/ptah-ui-fence-line.ts` (MODIFIED), `ptah-ui-fence-line.spec.ts` (CREATED) |
| 22.2 `collectDisplayCandidates` | COMPLETE | `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-display-candidates.ts` (CREATED), `.spec.ts` (CREATED) |
| 22.3 `collectTurnAgentFacts` | COMPLETE | `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-agent-facts.ts` (CREATED), `.spec.ts` (CREATED) |

### 22.1 `hasPtahUiDisplayFenceLine` and `hasPtahUiFenceLine`

- New `hasPtahUiDisplayFenceLine(text)`: a column-0 line ```` ```ptah-ui display ```` or
  ```` ```ptah-ui display <word> ````, then trailing spaces and one optional `\r` before `\n` or the end. This is the
  segmenter's line rule (`libs/shared/src/mcp-apps-contracts/ptah-ui-fence.ts:89-104,125-148`).
- `hasPtahUiFenceLine` now also matches the display openers (plan component 7, file list). Without this, a text whose
  only fences are display fences never mounts the lazy message-text host that draws the display chip.
- Zero imports, as before. Both functions share one scanner (`hasOpenerLine`).
- Spec evidence:
  - 28 table cases. These cover inline vs display, an id, CRLF, trailing spaces, a double space, two words, `displayed`,
    indentation, `ptah-ui-x`, mid-line text, HTML imitation and the empty string.
  - Decision #26 is cross-checked against the real `segmentPtahUi`: every text in which the segmenter yields a segment
    with `target === 'display'` passes the gate. A text whose fences all have an absent `target` (inline) fails it.
  - The existing `hasPtahUiFenceLine` table in `execution-node.ptah-ui.spec.ts` still passes (27/27, run below).

### 22.2 `collectDisplayCandidates(messages, streamingBoundary, previous?)`

- Scope (R2.11): text nodes reached from an assistant message's `streamingState` through `message` nodes only. This is
  the same rule that forwards the ptah-ui context (`execution-node.component.ts:343-360`, `@case ('message')`). User
  and system messages, thinking, tool children and `agent` subtrees never qualify.
- Gate: `hasPtahUiDisplayFenceLine`. The lazy sync segments each candidate and keeps `target === 'display'`
  (`display-surfaces.ts:167-168`), so decision #26 is applied downstream, where it has the parsed segment.
- Each candidate carries `blockKey` = `` `${messageId}:${nodeId}` ``, `messageId`, `nodeId`, `orderKey`, `text`,
  `turnKey` and `live`, typed by `import type { DisplayCandidate } from '@ptah-extension/chat-ui/display-panel'`. The
  only value imports are the sibling `ptah-ui-fence-line` and `transcript-change-set-anchors` files.
- `orderKey` = `transcriptOrderKey(message)` (root `startTime`, else `timestamp`). This is the clock the transcript
  merges on and feeds to `ptahUiOrderKeys`, so it does not move when the message finalizes.
- `turnKey` = the id of the last user message before the assistant message. An assistant message before the first
  user message yields no candidate (same rule as `groupTurns`, `transcript-turns.ts:65-73`).
- `live` = `index >= streamingBoundary`, the bubble rule (`chat-transcript.component.html:53`).
- R2.10 (ordering) and R2.7 (the streaming case): order is message order, then pre-order text-node order. An unclosed
  display fence in a streaming node is a live candidate with its streaming tail; the sync yields no fence for it until
  the fence closes.
- Identity cache: a candidate whose ids, text (length first, then content), `orderKey`, `turnKey` and `live` are
  unchanged is the previous object. When every candidate is unchanged, the previous array itself is returned, so the
  sync's `fences` computed (keyed on input identity) does not re-run on a tick that does not touch display text.
- The decision #71 spec covers ids with `:` (`msg:a:1` / `node:text:7`) and asserts `blockKey`, `messageId`, `nodeId`
  and `turnKey`. It also covers the cache case where two different id splits share a `blockKey` (`a:b`+`c` vs
  `a`+`b:c`): the previous object is not reused.

### 22.3 `collectTurnAgentFacts(messages)`

- One `TurnAgentFacts` per user message, in order, with `startedAt` = the user message `timestamp` (D7, CLI-lane
  window). A user message without a reply yet still gets its entry, so a lane started then has a turn. Assistant
  messages before the first user message, system messages and `null` trees contribute nothing.
- `nodes` (N): every foreground `agent` node in a pre-order walk of the whole tree, nested agents included.
- `spawnToolCallIds`: the `toolCallId` of every agent-dispatch tool node (`isAgentDispatchTool`: `Task`, `Agent`,
  `dispatch_agent`, `dispatch_subagent`, from the `@ptah-extension/shared` main barrel) and of every agent node.
  First occurrence is kept.
- Allow-list (R5.1, D6): `id`, `toolCallId`, `agentId`, `agentType`, `startTime`, `tokens` (= `tokenUsage.input +
  output`, the R5 merge rule at task-description.md:602-603), `cost` (a `null` cost is kept as `null`), `durationMs`
  (`duration`) and `status`. Absent values stay absent. The sentinel spec seeds `content`, `agentPrompt`,
  `agentDescription`, `summaryContent`, `error`, `toolInput`, `toolOutput`, `model` and a child text node. It asserts
  the sentinel appears nowhere in the serialized result and that every fact key is on the allow-list.
- The type is `import type { TurnAgentFacts } from '@ptah-extension/shared/mcp-apps-contracts/surface'`. `AgentNodeFact`
  is not exported from that entry, so it is derived as `TurnAgentFacts['nodes'][number]` and shared is not touched.

## Assumptions resolved

- **A3, verified with one consequence.** The docblock has moved: it is now `agent-monitor.store.ts:515-524`, not
  241-251. It says `SubagentRecord.parentToolUseId` is the Task tool_use id, and also the `toolCallId` on the agent
  node.
  - The tree builder sets `toolCallId` on both real and placeholder agent nodes (`agent-node.fn.ts:125`,
    `tool-node.fn.ts:411`). The Task tool node carries the same id.
  - A background agent can lack a real agent node, so `spawnToolCallIds` holds the Task tool node's id as well. A
    record-only agent (R5.9(d)) then still finds its turn through the resolver's `recordTurnIndex`
    (`ptah-ui-agents-source.ts:335-349`).
  - A record no loaded tree carries (for example its turn is on an unloaded older page) belongs to no turn (D7).
  - The R5.9(d) spec fixture seeds the Task tool node with no agent node and asserts its id is in turn 0 only.
- **A4: FALSE on the default path. This is a hard input requirement for Batch 24.**
  - With `STREAM_PRESENTATION_RECORDS_ENABLED` (default `true`, `stream-presentation-store.service.ts:24-27`),
    `vm().messages` is `presentation.messages`. That array is republished only on a structural change: ids, boundary
    or `isStreaming` (`stream-presentation-store.service.ts:141-147`).
  - A content-only streaming write updates the per-message `slot.record()` signal, not `vm().messages`. So
    `vm().messages` holds the streaming message as it was at the last structural change, which is stale text and
    stale agent nodes.
  - On the legacy path (`allMessages`), `vm().messages` does carry the live tree on every recompute.
  - Both projections take any `ExecutionChatMessage[]`. Batch 24 must pass the current records, for example
    `vm().slots.map((slot) => slot.record())`, together with `vm().streamingBoundary`. Otherwise candidates and N
    values lag until the next structural change, which violates R2.7.
  - Spec: a streaming tree with an open display fence produces a live candidate carrying the streaming tail.

## Decision #81 compatibility (Batches 23-25)

- Neither projection holds module-level state. The display-candidate cache is the caller's own previous result, so
  each transcript keeps its own cache and one tab cannot see another's (specs: "keeps no state between calls").
- Both functions are synchronous and pure, with no `await` or scheduling. They do not touch `DisplayDockState`, so
  `hasSeen` -> open -> `markSeen` stays a synchronous sequence in the store.
- `retainedViewStateIds` is unaffected: candidate identity reuse only reduces recomputes, and the sync still computes
  the D10 diff from the dock's previous surfaces.
- Turn indexing for Batch 23's `PtahUiHostSources.turnIndexOf(messageId)`: index `i` of `collectTurnAgentFacts` is the
  turn of the `i`-th user message, and a candidate's `turnKey` is that same user message's id. `turnIndexOf` must use
  the same rule: count user messages up to the message, and return `null` before the first one.

## Edge cases (validation section)

- Unclosed or streaming fence: it is a live candidate, and the sync yields nothing until the fence closes. A closed
  fence followed by more streaming changes the candidate's text, but the fence body is unchanged, so the sync's
  compile cache keyed by `surfaceId NUL body` does not re-apply it. That property lives in the sync (Task 20.2); the
  candidate side passes the full text, as it must.
- Reload (D8): N facts come from the stored tree and rebuild. R-only values are the resolver's concern ("unavailable").
- Reserved `ptah.` ids, the cap and eviction are handled in `display-surfaces.ts`. The gate deliberately lets any
  id-shaped word through (see deviation 4).

## Plan deviations (numbered for a ruling)

1. **`collectDisplayCandidates` takes an optional third parameter, `previous`.** The plan's signature is
   `(messages, streamingBoundary)`, and the plan asks for "a per-node identity cache keyed by (text length, text)".
   The cache has to live somewhere. Module-level state is ruled out (decision #81, per transcript), so it is the
   caller's previous result. Batch 24 passes its last result back in, for example by keeping it in a field next to the
   computed, the same pattern as `_allMessagesCache` in `chat-transcript.component.ts`.
2. **`collectTurnAgentFacts` takes `(messages)` only, with no `streamingBoundary`.** D7 attribution does not depend on
   whether a message is still streaming, and live N values come from the tree itself. An unused parameter would be dead
   API.
3. **Background agent nodes (`isBackground: true`) are not N.** Their `toolCallId` is still in `spawnToolCallIds`.
   - Basis: the R5 source table says "Foreground subagent `ExecutionNode`s" (task-description.md:558). A background
     node is the Task tool's placeholder (`tool-node.fn.ts:398-418`). Its `duration` and status describe the
     immediately-returning Task call, and under the N-first precedence they would override the record's real values.
   - Consequence: a background agent's row comes from R only, matched through the Task tool id. After reload (D8) it
     has no row.
   - The alternative is to include background nodes as N, so that a row survives reload but its duration shows the
     Task call's. That choice needs a ruling.
4. **`hasPtahUiDisplayFenceLine` is a superset of the segmenter.** It accepts any one space-free word as the id,
   without checking `SURFACE_ID_PATTERN` or the 128-character limit, so the gate keeps zero imports. A text with an
   invalid id becomes a candidate that yields no display segment in the sync, which costs one lazy segment pass and
   produces no surface.
5. **Gap fill: duplicate `blockKey`s are dropped, first one kept.** Downstream keys (`displayFenceKey`,
   `anon:<blockKey>:<ordinal>`) cannot tell two such nodes apart, so a second one would overwrite statuses. With the
   current id sources this does not happen; the guard keeps the published keys unique.

## Verification (worktree, bash, command-line `--moduleNameMapper` only; no config changed)

- `npx jest -c libs/frontend/chat/jest.config.ts …/ptah-ui-fence-line.spec.ts …/transcript-display-candidates.spec.ts
  …/transcript-agent-facts.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{…}' 2>&1 | tail -n 40`
  → `Test Suites: 3 passed, 3 total`, `Tests: 65 passed, 65 total`.
- Extra regression check for the changed `hasPtahUiFenceLine` (its consumer):
  `npx jest -c libs/frontend/chat/jest.config.ts …/execution/execution-node.ptah-ui.spec.ts --coverage=false
  --maxWorkers=2 --moduleNameMapper='{…}'` → `Tests: 27 passed, 27 total`.
- `npx nx typecheck @ptah-extension/chat --parallel=1 2>&1 | tail -n 20` → `Successfully ran target typecheck`. The one
  visible diagnostic is a pre-existing template warning (`res.target?.name`), not in a batch file.
- `npx nx lint @ptah-extension/chat --parallel=1` → `0 errors, 34 warnings`. A grep of the lint output for the three
  batch file stems finds nothing; all warnings are pre-existing (for example `max-lines` on a 1390-line file).
- Prettier was run on the six files (only the two specs were reformatted).
- No TODO/FIXME markers. The only lazy-entry imports are `import type`. The value imports are `@ptah-extension/shared`
  (main barrel, already eager in `chat`) and sibling `chat` files.

## Out-of-scope observations

- `transcriptOrderKey` and the `live` rule use index vs boundary over the time-merged list, as the bubbles do. A user
  message merged in before a still-streaming tree (`mergeByTime`) can put that streaming message below the boundary
  index. In that case its candidate is `live: false`, so it would not auto-open. This is the bubble's existing
  behaviour, and it is not changed here.
