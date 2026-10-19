# Code Logic Review - TASK_2026_685 batches A4, A4b, B1, B2a, B3a

Review family: claude (reviewer) / codex (implementer)

Scope: commits 5a12850a4, 1cda7cbf1, 2d1910965, f8cc7fa24, af584ec9c, read via `git show` and the committed files. Nothing was run (another lane is editing rpc-handlers and rpc.types.ts).

Score: 7/10
Verdict: CHANGES REQUESTED (no Blocking issues; 4 Moderate issues should be fixed or explicitly deferred before the dependent batches B2b, B3b and B5 build on them)

## Findings

1. Moderate - B2a replay identity is not stable across calls when the JSONL lacks `message.id` or a parseable timestamp.
   `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts` (`replayAgentToStreamEvents`, f8cc7fa24) passes `Date.now()` as `parentTimestamp`.
   In preserve mode, `eventTime()` falls back to `parentTimestamp + sequence * 0.0001` when `Date.parse` fails.
   The synthesized `agentMessageId` (`agent_msg_${parent}_${i}_${floor(parentTimestamp)}`) and the factory event ids (`evt_agent_${parent}_${index}_${floor(ts)}`) then change on every request.
   Page-to-page cursors and the D15 id-plus-block-index merge depend on stable ids, so the same transcript yields different ids on each call.
   Fix: in preserve mode derive the fallback timestamp and message id from the JSONL position (line index, `msg.uuid`), never from the wall clock.
   Add a spec that replays twice and expects identical ids.

2. Moderate - B2a message-merge logic is inconsistent.
   The `continued` flag compares against `previousId`, which persists across skipped lines.
   The `continues` flag (suppresses `message_complete`) looks only at `messages[messageIndex + 1]`.
   If a non-assistant or empty-content line (system, attachment, string content) sits between two same-id assistant lines, a `message_complete` is emitted and the next line is then treated as continued with no `message_start`.
   That produces orphan blocks after a completed message.
   Fix: compute `continues` by scanning to the next assistant line with array content, using the same skip rule as the main loop.

3. Moderate - A4 drops the agent node's own content.
   `canvas-lane-view.component.ts` (1cda7cbf1, ~line 142) passes `[nodes]="agentNode()?.children ?? []"`.
   Before, the whole agent node was rendered through `ptah-execution-node`.
   `agent-execution.component.ts` renders `summaryContent` (and the agent result), and the lane now never shows it.
   The final summary of a finished sub-agent disappears from the canvas lane.
   Fix: render `agentNode().summaryContent`, or keep the node and let `ptah-execution-node` render it.

4. Moderate - B3a `skipStoreEffects` is only partial.
   `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:603-622` (`background_agent_started/completed/stopped`, `agent_progress`, `agent_status`, `agent_completed`) still call `backgroundAgentStore` and `agentMonitorStore` unconditionally.
   `sessionManager.registerAgent` (~:510) also runs unguarded and drains pending deltas from the shared SessionManager.
   The plan lists only the usage/terminate/start sites, and A8 assumes `registerAgent` is idempotent.
   The flag is documented as "suppressing tab-level agent store updates", though, and a per-agent or merge rebuild that replays one of these events would double-apply status or terminal transitions.
   Fix: guard those six cases too, or document that the per-agent store must filter them out.
   Pin A8 with a spec that registers the same `toolCallId` twice, and stub `SessionManager` so a rebuild cannot consume live pending deltas.

5. Minor - A4 shows contradictory empty states.
   When `agentNode()` is absent and the agent is finished, `ptah-subagent-lane` shows "No output recorded" (`subagent-lane.component.ts` `@empty`) directly above "Live agent unavailable. Showing saved transcript." and the transcript viewer.
   While loading, it shows "Starting agent".
   Fix: pass a flag so the lane suppresses its `@empty` copy when the saved-transcript fallback is active.

6. Minor - A4 accessibility parity gaps.
   - The steer toggle sets `aria-expanded` but has no `aria-controls`, and focus is not moved to the steer input on open (`subagent-lane.component.ts`, steer button and `ptah-agent-steer-input`).
   - Escape does not close the input.
   - Stop and background fire with no pending or disabled state, and the returned promises are not awaited (`tray.stop(ctx)`, `tray.sendToBackground(ctx)`). A double click sends two commands.
   - Errors do reach the user through `commandError` with `role="alert"`, which is good.

7. Minor - B2a reader details.
   - `readSubagentEvents` rethrows validation errors ('Invalid agent id') inside the `try`, so they are caught and replaced by 'Subagent history could not be read', and they are logged as a read failure.
   - The 10 000 tail slice (`events.slice(-10_000)`) can start mid-message with an orphan `tool_result` or no `message_start`. This is presumably superseded by B2b paging; confirm.
   - `AGENT_ID_PATTERN` is reused for `toolCallId`. Tool ids with `.` or `:` from non-Anthropic providers would be rejected.
   - A client-supplied `agentId` is not checked against `toolCallId`, so it can mislabel events with another agent's transcript. It is path-safe and inside the same session, so this is low impact.
   - In `processAgentMessages` the new `tool_result` branch inside assistant content is dead for real data, because real results sit in `user` lines and arrive via the `toolResults` map. It is harmless.

8. Minor - B3a.
   - `buildTree` options are not part of the tree cache identity (`execution-tree-builder.service.ts`, `treeCache` keyed by `cacheKey` only).
   - Reusing one key with and without `rootParentToolUseId` returns a stale tree. The plan uses distinct `subagent-<key>` keys, so this is safe by convention only. Add a doc comment or fold the option into the cached entry.
   - `ownedByRealRoot` in `execution-tree-cache.ts:296` still treats a sub-agent root as non-root. The digest spec covers the isolated-state case but not a state that also holds the parent `tool_start`.
   - `eventCap` has a one-time global warn flag (`__streamingCapWarned`) shared across all capped states, so a second state hitting its cap logs nothing.

## Checks that came out clean

- B1 (`chat-stream-broadcaster.service.ts:269, 284-286`): `!event.parentToolUseId` treats undefined, null and '' as root. A sub-agent that completes before or after the root can no longer reset or fire the gate. No edge found; the 94-line spec covers the ordering.
- B2a path safety: session id, tool call id, agent id and the correlated id all pass the same pattern before use in `path.join`, so there is no traversal. ENOENT is treated as not-found, other errors are wrapped without paths, and malformed JSONL lines are skipped by the shared parser. The size limit comes from `readJsonlMessages` (`MAX_SESSION_FILE_SIZE`) and the 60-second transcript cache bounds repeat reads.
- B2a legacy location: `messages[0]?.sessionId !== sessionId` guards the cross-session agent file.
- Orchestrator's spec mock fix (`session-history-reader.service.spec.ts` top): `fs/promises` and `node:fs/promises` resolve to one module, so the mocks must share one shape. Both factories now expose `{ stat, access }`, which is sound. Both are imported and both are `jest.fn`s, so the surviving registration wins consistently.
- B3a hot path: `skipStoreEffects` and `eventCap` add one boolean check and one `??` per event, which is O(1). Defaults leave live behaviour unchanged.
- A4b: `formatAgentDuration(idleMs) ?? '<1s'` is null-safe, and the spec was updated.

## Five questions (short)

1. Silent failure: finding 4 (an unguarded store effect during rebuild); finding 3 (a summary silently missing).
2. Unexpected user action: double-clicking stop or background (finding 6); a finished agent with no live node (finding 5).
3. Wrong answer from data: finding 2 (interleaved non-assistant lines) and finding 1 (missing ids or timestamps).
4. Dependency failure: reader errors are wrapped and surfaced as typed statuses. Handling is acceptable.
5. Missing, never specified: no explicit Escape or focus handling for the steer input; no test for replay determinism.
