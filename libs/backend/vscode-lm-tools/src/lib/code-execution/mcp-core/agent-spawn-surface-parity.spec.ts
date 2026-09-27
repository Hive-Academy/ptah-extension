import { AgentSpawnArgsSchema } from './agent-spawn-args.schema';
import { buildAgentSpawnTool } from './tool-description.builder';
import { getToolResultBudget } from './tool-result-budget';
import { buildMcpAgentSpawnTool } from '../mcp-stdio/tool-builders';

describe('agent spawn surface parity', () => {
  it('advertises exactly the keys the shared schema accepts', () => {
    const advertised = Object.keys(
      buildAgentSpawnTool().inputSchema.properties,
    ).sort();
    const accepted = Object.keys(AgentSpawnArgsSchema.shape).sort();

    expect(advertised).toEqual(accepted);
  });

  it('gives the stdio tool the HTTP definition under its own name', () => {
    const http = buildAgentSpawnTool();
    const stdio = buildMcpAgentSpawnTool();

    expect(http.name).toBe('ptah_agent_spawn');
    expect(stdio.name).toBe('agent_spawn');
    // The HTTP `tools/list` stamps the result ceiling onto the builder's
    // definition (`declareResultBudgets`); the stdio builder declares the
    // same ceiling itself, so the two served definitions are equal.
    expect({ ...stdio, name: http.name }).toEqual({
      ...http,
      _meta: {
        ...http._meta,
        'anthropic/maxResultSizeChars': getToolResultBudget(http.name).chars,
      },
    });
  });

  it('requires only task on both surfaces', () => {
    expect(buildAgentSpawnTool().inputSchema.required).toEqual(['task']);
    expect(buildMcpAgentSpawnTool().inputSchema.required).toEqual(['task']);
    expect(AgentSpawnArgsSchema.safeParse({ task: 't' }).success).toBe(true);
  });
});
