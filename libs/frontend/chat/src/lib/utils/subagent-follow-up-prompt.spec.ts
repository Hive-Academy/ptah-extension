import type { SubagentRecord } from '@ptah-extension/chat-streaming';
import { subagentFollowUpPrompt } from './subagent-follow-up-prompt';

const base: SubagentRecord = {
  parentToolUseId: 'toolu_1',
  status: 'completed',
};

describe('subagentFollowUpPrompt', () => {
  it('names the agent type, id and task', () => {
    expect(
      subagentFollowUpPrompt(
        {
          ...base,
          agentType: 'software-architect',
          teammateName: 'ada',
          agentId: 'a01',
          taskDescription: 'Plan the lane input',
        },
        'Add a test plan',
      ),
    ).toBe(
      'Continue the software-architect sub-agent (agent id a01) that worked on "Plan the lane input" with this message from me:\n\nAdd a test plan',
    );
  });

  it('falls back to the teammate name, then to "sub-agent"', () => {
    expect(subagentFollowUpPrompt({ ...base, teammateName: 'ada' }, 'x')).toBe(
      'Continue the ada sub-agent with this message from me:\n\nx',
    );
    expect(subagentFollowUpPrompt(base, 'x')).toBe(
      'Continue the sub-agent with this message from me:\n\nx',
    );
  });

  it('leaves out an unknown id and an unknown task', () => {
    expect(
      subagentFollowUpPrompt(
        { ...base, agentType: 'Explore', taskDescription: 'Map it' },
        'go on',
      ),
    ).toBe(
      'Continue the Explore sub-agent that worked on "Map it" with this message from me:\n\ngo on',
    );
    expect(
      subagentFollowUpPrompt(
        { ...base, agentType: 'Explore', agentId: 'b2' },
        'go on',
      ),
    ).toBe(
      'Continue the Explore sub-agent (agent id b2) with this message from me:\n\ngo on',
    );
  });
});
