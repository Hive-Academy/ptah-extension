import { builderPreviewSummary } from './builder-sidebar-helpers';

describe('builderPreviewSummary', () => {
  it('counts enabled agents, selected skills, and created skills', () => {
    expect(
      builderPreviewSummary({
        agents: {
          enabledAgents: {
            claude: { enabled: true },
            codex: { enabled: false },
          },
          harnessSubagents: [],
        },
        skills: {
          selectedSkills: ['review'],
          selectedSkillRefs: [],
          createdSkills: [
            {
              name: 'custom',
              description: 'Custom skill',
              content: '# Custom',
            },
          ],
        },
      }),
    ).toBe('1 agents, 2 skills');
  });
});
