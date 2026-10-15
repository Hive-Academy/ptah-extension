import { buildSubagentRunTag } from './subagent-run-tag';

const input = {
  tool_name: 'Agent', tool_use_id: 'tool-1', tool_response: { agentId: 'response_1' },
};

describe('buildSubagentRunTag', () => {
  it('prefers the registry id and uses the exact run grammar', () => {
    expect(buildSubagentRunTag(input, () => 'registry_1').tag)
      .toBe('ptah-run: runId=subagent:registry_1');
  });

  it('uses the SDK response id when the registry misses', () => {
    expect(buildSubagentRunTag(input, () => undefined).tag)
      .toBe('ptah-run: runId=subagent:response_1');
  });

  it('skips subagent results and invalid ids', () => {
    expect(buildSubagentRunTag({ ...input, agent_id: 'child' }).tag).toBeNull();
    expect(buildSubagentRunTag({ ...input, tool_response: { agentId: 'bad:id' } }).tag)
      .toBeNull();
  });
});
