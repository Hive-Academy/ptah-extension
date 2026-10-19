import { randomUUID } from 'crypto';
import { test, expect } from '../support/fixtures';

/**
 * TASK_2026_337 — an agent card whose SUMMARY or TOOL COUNT moves must
 * re-render, even though cost, duration, model, tokenUsage and status all stay
 * put.
 *
 * ## What the fix changed, and what this spec can honestly claim
 *
 * The fix widened `fingerprintNode`
 * (`libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts`)
 * to fold `node.summaryContent` and `node.toolCount`. Read against the current
 * builders, NO producer writes either field onto an agent node:
 * `buildAgentNode` (`chat-execution-tree/src/lib/builders/agent-node.fn.ts`)
 * renders the summary as a `-summary-text` CHILD node and takes its stats from
 * `AgentStatsService.aggregateAgentStats`, which returns only `agentModel`,
 * `tokenUsage`, `cost` and `duration`. So the two new folds are DEFENSIVE
 * today and cannot be exercised through the running app — that part is
 * reported as not-observable.
 *
 * What IS observable, and what this spec pins, is the user-visible behaviour
 * the task exists to protect: the rendered agent card must follow its summary
 * text and its tool count. That currently holds through two other mechanisms —
 * the summary folds into `computeGlobalEpoch` via `agentSummaryAccumulators`
 * total length, and both summary and tools change the node's CHILDREN, whose
 * fingerprints the parent folds. A regression in either would show up here.
 *
 * ## Method
 *
 * Everything is injected on the existing `to-renderer` seam:
 * - the agent card itself from a `Task` `tool_start` plus a parent-linked
 *   `agent_start` (shapes copied from
 *   `chat-execution-tree/src/lib/builders/builders.spec.ts`),
 * - the summary from `agent:summary-chunk` (which appends to the parent
 *   `StreamingState.agentSummaryAccumulators`) together with `agent_progress`
 *   (which updates the lane's `SubagentRecord.latestSummary` peek),
 * - each nested tool from a sub-`message_start` carrying
 *   `parentToolUseId` plus its own `tool_start`.
 *
 * The card is the store-backed sub-agent lane (`subagent-lane.component.ts`,
 * TASK_2026_685). The summary is its header peek (`latestSummary`), and the
 * tool-count observable is its disclosure row, which renders `"1 tool"` /
 * `"<n> tools"`.
 *
 * ## Falsifiability
 *
 * Every assertion is paired with its negation: after the second summary delta
 * the card must show the NEW text AND no longer show only the old marker
 * alone; after the second nested tool the row must read `2 tools` and must
 * NOT still read `1 tool`. A card served from a stale cached node fails the
 * second half of each pair while passing the first.
 */

const CHAT_CHUNK = 'chat:chunk';
const AGENT_SUMMARY_CHUNK = 'agent:summary-chunk';
// The pane's accessible name carries the session title (`Focused session: <title>`),
// so match the focus area itself, not an exact label.
const FOCUSED_SESSION = 'ptah-canvas-focus-area';
// The Rail transcript renders an agent as a compact tile (`agentTileMode`);
// opening it shows the store-backed sub-agent lane.
const AGENT_TILE = 'ptah-subagent-tile';
const AGENT_TILE_OPEN = '[data-testid="subagent-open"]';
const AGENT_CARD = 'ptah-subagent-lane';

const SUMMARY_ONE = 'PTAH_E2E_SUMMARY_FIRST';
const SUMMARY_TWO = 'PTAH_E2E_SUMMARY_SECOND';
const AGENT_TYPE = 'researcher-expert';
const AGENT_DESCRIPTION = 'Investigate the reuse key';

function chunk(sessionId: string, event: Record<string, unknown>) {
  return { type: CHAT_CHUNK, payload: { sessionId, event } };
}

function messageStart(
  sessionId: string,
  messageId: string,
  timestamp: number,
  parentToolUseId?: string,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'message_start',
    timestamp,
    sessionId,
    source: 'complete',
    messageId,
    role: 'assistant',
    ...(parentToolUseId ? { parentToolUseId } : {}),
  });
}

function taskToolStart(
  sessionId: string,
  messageId: string,
  toolCallId: string,
  timestamp: number,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'tool_start',
    timestamp,
    sessionId,
    source: 'complete',
    messageId,
    toolCallId,
    toolName: 'Task',
    isTaskTool: true,
    agentType: AGENT_TYPE,
    agentDescription: AGENT_DESCRIPTION,
  });
}

function agentStart(
  sessionId: string,
  messageId: string,
  toolCallId: string,
  agentId: string,
  timestamp: number,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'agent_start',
    timestamp,
    sessionId,
    source: 'complete',
    messageId,
    parentToolUseId: toolCallId,
    toolCallId,
    agentType: AGENT_TYPE,
    agentDescription: AGENT_DESCRIPTION,
    agentId,
  });
}

function nestedToolStart(
  sessionId: string,
  messageId: string,
  parentToolUseId: string,
  toolCallId: string,
  toolName: string,
  timestamp: number,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'tool_start',
    timestamp,
    sessionId,
    source: 'complete',
    messageId,
    parentToolUseId,
    toolCallId,
    toolName,
    isTaskTool: false,
    toolInput: { file_path: `C:\\ptah-e2e-ws\\${toolName}.ts` },
  });
}

function toolResult(
  sessionId: string,
  messageId: string,
  toolCallId: string,
  timestamp: number,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'tool_result',
    timestamp,
    sessionId,
    source: 'complete',
    messageId,
    toolCallId,
    output: 'agent finished',
    isError: false,
  });
}

function summaryChunk(
  sessionId: string,
  toolUseId: string,
  agentId: string,
  summaryDelta: string,
) {
  return {
    type: AGENT_SUMMARY_CHUNK,
    payload: { sessionId, toolUseId, agentId, summaryDelta },
  };
}

function agentProgress(
  sessionId: string,
  messageId: string,
  toolCallId: string,
  agentId: string,
  summary: string,
  timestamp: number,
) {
  return chunk(sessionId, {
    id: randomUUID(),
    eventType: 'agent_progress',
    timestamp,
    sessionId,
    source: 'complete',
    messageId,
    parentToolUseId: toolCallId,
    taskId: 'task-e2e-337',
    agentId,
    description: AGENT_DESCRIPTION,
    summary,
    totalTokens: 0,
    toolUses: 0,
    durationMs: 0,
  });
}

test.describe('Agent card follows its summary and tool count (TASK_2026_337)', () => {
  test('a summary delta and an added nested tool each re-render the card, with nothing else about the agent changing', async ({
    ui,
  }) => {
    const page = ui.page;
    await ui.goto('chat');

    const sessionId = randomUUID();
    const rootMessageId = randomUUID();
    const agentMessageId = randomUUID();
    const taskToolCallId = 'toolu_e2e_task_337';
    const agentId = 'agent337';
    const t0 = Date.now();

    const focusArea = page.locator(FOCUSED_SESSION);
    const tile = focusArea.locator(AGENT_TILE);
    // The card the assertions follow. It renders only inside the sub-agent lane.
    const card = focusArea.locator(AGENT_CARD);

    // Root assistant message binds the tile to the session, then spawns the
    // agent.
    await ui.pushEvent(messageStart(sessionId, rootMessageId, t0));
    await ui.pushEvent(
      taskToolStart(sessionId, rootMessageId, taskToolCallId, t0 + 1),
    );
    await ui.pushEvent(
      agentStart(sessionId, rootMessageId, taskToolCallId, agentId, t0 + 2),
    );

    // The transcript shows the agent as a tile; open its lane so the card renders.
    await expect(tile).toHaveCount(1);
    await expect(tile).toContainText(AGENT_TYPE);
    await tile.locator(AGENT_TILE_OPEN).click();

    await expect(card).toHaveCount(1);
    const peek = card.locator('[data-test="turn-disclosure-peek"]');
    const meta = card.locator('[data-test="turn-disclosure-meta"]');
    await expect(peek).toContainText(AGENT_DESCRIPTION);

    // --- Summary: first delta ------------------------------------------
    await ui.pushEvent(
      summaryChunk(sessionId, taskToolCallId, agentId, `${SUMMARY_ONE} `),
    );
    await ui.pushEvent(
      agentProgress(
        sessionId,
        rootMessageId,
        taskToolCallId,
        agentId,
        `${SUMMARY_ONE} `,
        t0 + 3,
      ),
    );
    await expect(peek).toContainText(SUMMARY_ONE);
    await expect(peek).not.toContainText(SUMMARY_TWO);

    // --- Summary: second delta. Cost, duration, model, tokenUsage and the
    // agent's status stay visually unchanged as the rolling summary updates.
    await ui.pushEvent(
      summaryChunk(sessionId, taskToolCallId, agentId, `${SUMMARY_TWO} `),
    );
    await ui.pushEvent(
      agentProgress(
        sessionId,
        rootMessageId,
        taskToolCallId,
        agentId,
        `${SUMMARY_ONE} ${SUMMARY_TWO} `,
        t0 + 4,
      ),
    );
    await expect(peek).toContainText(SUMMARY_TWO);
    // Deltas append, so the first marker must still be there — a card that
    // replaced rather than appended would be a different defect.
    await expect(peek).toContainText(SUMMARY_ONE);

    // --- Tool count -----------------------------------------------------
    // One nested tool, then close the Task tool so the lane's disclosure
    // row shows the finalized tool count.
    await ui.pushEvent(
      messageStart(sessionId, agentMessageId, t0 + 5, taskToolCallId),
    );
    await ui.pushEvent(
      nestedToolStart(
        sessionId,
        agentMessageId,
        taskToolCallId,
        'toolu_e2e_child_1',
        'Read',
        t0 + 6,
      ),
    );
    await ui.pushEvent(
      toolResult(sessionId, rootMessageId, taskToolCallId, t0 + 7),
    );

    await expect(meta).toContainText('1 tool');

    // Add a SECOND nested tool. Nothing else about the agent moves: same
    // status, same description, same (absent) stats.
    await ui.pushEvent(
      nestedToolStart(
        sessionId,
        agentMessageId,
        taskToolCallId,
        'toolu_e2e_child_2',
        'Grep',
        t0 + 8,
      ),
    );

    await expect(meta).toContainText('2 tools');
    await expect(meta).not.toContainText('1 tool');
  });
});
