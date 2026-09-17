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
 * - the summary from `agent:summary-chunk`
 *   (`MESSAGE_TYPES.AGENT_SUMMARY_CHUNK`), the only writer of
 *   `StreamingState.agentSummaryAccumulators`
 *   (`chat-lifecycle.service.ts` `handleAgentSummaryChunk`),
 * - each nested tool from a sub-`message_start` carrying
 *   `parentToolUseId` plus its own `tool_start`.
 *
 * The tool-count observable is the card's own header badge, `childStats()`
 * (`inline-agent-bubble.component.ts`), which renders `"<n> tools"` once the
 * agent is no longer streaming.
 *
 * ## Falsifiability
 *
 * Every assertion is paired with its negation: after the second summary delta
 * the card must show the NEW text AND no longer show only the old marker
 * alone; after the second nested tool the badge must read `2 tools` and must
 * NOT still read `1 tools`. A card served from a stale cached node fails the
 * second half of each pair while passing the first.
 */

const CHAT_CHUNK = 'chat:chunk';
const AGENT_SUMMARY_CHUNK = 'agent:summary-chunk';
const TILE = '[data-testid="canvas-tile"]';
const AGENT_CARD = 'ptah-inline-agent-bubble';

const SUMMARY_ONE = 'PTAH_E2E_SUMMARY_FIRST';
const SUMMARY_TWO = 'PTAH_E2E_SUMMARY_SECOND';
const AGENT_TYPE = 'researcher-expert';

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
    agentDescription: 'Investigate the reuse key',
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
    agentDescription: 'Investigate the reuse key',
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

    const tile = page.locator(TILE).first();
    const card = tile.locator(AGENT_CARD);

    // Root assistant message binds the tile to the session, then spawns the
    // agent.
    await ui.pushEvent(messageStart(sessionId, rootMessageId, t0));
    await ui.pushEvent(
      taskToolStart(sessionId, rootMessageId, taskToolCallId, t0 + 1),
    );
    await ui.pushEvent(
      agentStart(sessionId, rootMessageId, taskToolCallId, agentId, t0 + 2),
    );

    await expect(card).toHaveCount(1);
    await expect(card).toContainText(AGENT_TYPE);

    // --- Summary: first delta ------------------------------------------
    await ui.pushEvent(
      summaryChunk(sessionId, taskToolCallId, agentId, `${SUMMARY_ONE} `),
    );
    await expect(card).toContainText(SUMMARY_ONE);
    await expect(card).not.toContainText(SUMMARY_TWO);

    // --- Summary: second delta. Cost, duration, model, tokenUsage and the
    // agent's status are all untouched by an `agent:summary-chunk`, so this is
    // exactly the "only the summary moved" case.
    await ui.pushEvent(
      summaryChunk(sessionId, taskToolCallId, agentId, `${SUMMARY_TWO} `),
    );
    await expect(card).toContainText(SUMMARY_TWO);
    // Deltas append, so the first marker must still be there — a card that
    // replaced rather than appended would be a different defect.
    await expect(card).toContainText(SUMMARY_ONE);

    // --- Tool count -----------------------------------------------------
    // One nested tool, then close the Task tool so the agent leaves
    // `streaming` and the header badge (childStats) renders.
    await ui.pushEvent(
      messageStart(sessionId, agentMessageId, t0 + 3, taskToolCallId),
    );
    await ui.pushEvent(
      nestedToolStart(
        sessionId,
        agentMessageId,
        taskToolCallId,
        'toolu_e2e_child_1',
        'Read',
        t0 + 4,
      ),
    );
    await ui.pushEvent(
      toolResult(sessionId, rootMessageId, taskToolCallId, t0 + 5),
    );

    await expect(card).toContainText('1 tools');

    // Add a SECOND nested tool. Nothing else about the agent moves: same
    // status, same description, same (absent) stats.
    await ui.pushEvent(
      nestedToolStart(
        sessionId,
        agentMessageId,
        taskToolCallId,
        'toolu_e2e_child_2',
        'Grep',
        t0 + 6,
      ),
    );

    await expect(card).toContainText('2 tools');
    await expect(card).not.toContainText('1 tools');
  });
});
