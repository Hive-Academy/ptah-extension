/**
 * Task tool result → held SubagentStart binding (F-F, TASK_2026_614 F.5 B1).
 *
 * A SubagentStart hook that arrives without a `toolUseId`, for an agent no
 * registry record names yet, is held by `SubagentRegistryService`. The Task
 * tool result is the first message tying that agent to its Task tool_use id:
 * its text carries the SDK's `agentId: <hex>` line. Both tool_result sites
 * (assistant and user messages) call {@link bindTaskResultToHeldStart} so the
 * held start becomes a registry record under the Task's toolCallId — which is
 * what `subagent:stop`, `subagent:send-message` and the budget stop look up.
 *
 * Exact id only: a result naming two different ids, or an id several held
 * starts share, stays unbound with a WARN rather than guessing.
 */

import type { TransformerHelpers } from './transformer-helpers';

/** The SDK's `agentId: <hex>` line in a Task tool result. */
const AGENT_ID_LINE = /agentId:\s*([0-9a-f]+)/gi;

/** Distinct agent ids named by a tool result's `agentId:` lines, in order. */
export function readTaskResultAgentIds(content: unknown): string[] {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  if (!text) {
    return [];
  }
  const ids: string[] = [];
  for (const match of text.matchAll(AGENT_ID_LINE)) {
    if (!ids.includes(match[1])) {
      ids.push(match[1]);
    }
  }
  return ids;
}

/**
 * Bind a held SubagentStart to `toolCallId` when this tool result names its
 * agentId. A no-op while nothing is held, so ordinary tool results are never
 * scanned.
 */
export function bindTaskResultToHeldStart(
  toolCallId: string,
  content: unknown,
  helpers: TransformerHelpers,
): void {
  const registry = helpers.subagentRegistry;
  if (!registry.hasHeldUnboundStarts()) {
    return;
  }
  const agentIds = readTaskResultAgentIds(content);
  if (agentIds.length === 0) {
    return;
  }
  if (agentIds.length > 1) {
    helpers.logger.warn(
      '[SdkMessageTransformer] Tool result names several agentIds — held SubagentStarts stay unbound',
      { toolCallId, agentIds },
    );
    return;
  }

  const outcome = registry.bindHeldStartToToolCall(toolCallId, agentIds[0]);
  if (outcome === 'no-held-start') {
    helpers.logger.warn(
      '[SdkMessageTransformer] Tool result names an agentId no held SubagentStart matches — it stays unbound',
      { toolCallId, agentId: agentIds[0] },
    );
  }
}
