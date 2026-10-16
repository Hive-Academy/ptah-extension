export interface SubagentRunTagInput {
  readonly agent_id?: string;
  readonly tool_name: string;
  readonly tool_use_id: string;
  readonly tool_response: unknown;
}

export interface SubagentRunTagResult {
  readonly tag: string | null;
  readonly registryAgentId?: string;
  readonly responseAgentId?: string;
  readonly reason?: 'invalid-agent-id' | 'missing-agent-id';
}

const AGENT_ID = /^[A-Za-z0-9_-]{1,200}$/;

export function buildSubagentRunTag(
  input: SubagentRunTagInput,
  lookup?: (toolUseId: string) => string | undefined,
): SubagentRunTagResult {
  if (input.agent_id || (input.tool_name !== 'Agent' && input.tool_name !== 'Task')) {
    return { tag: null };
  }
  const registryAgentId = lookup?.(input.tool_use_id);
  const response = input.tool_response;
  const responseAgentId = response !== null && typeof response === 'object' &&
    'agentId' in response && typeof response.agentId === 'string'
    ? response.agentId : undefined;
  const agentId = registryAgentId ?? responseAgentId;
  if (!agentId) {
    return { tag: null, registryAgentId, responseAgentId, reason: 'missing-agent-id' };
  }
  if (!AGENT_ID.test(agentId)) {
    return { tag: null, registryAgentId, responseAgentId, reason: 'invalid-agent-id' };
  }
  return { tag: `ptah-run: runId=subagent:${agentId}`, registryAgentId, responseAgentId };
}
