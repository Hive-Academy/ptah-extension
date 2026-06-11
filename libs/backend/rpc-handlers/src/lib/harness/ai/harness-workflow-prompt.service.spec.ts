import 'reflect-metadata';

import type { HarnessWorkspaceContextService } from '../workspace/harness-workspace-context.service';
import { HarnessWorkflowPromptService } from './harness-workflow-prompt.service';

type Mocked<T> = jest.Mocked<T>;

function buildService(): {
  service: HarnessWorkflowPromptService;
  workspaceContext: Mocked<HarnessWorkspaceContextService>;
} {
  const workspaceContext = {
    resolveWorkspaceContext: jest.fn().mockResolvedValue({
      projectName: 'acme-app',
      projectType: 'nx-monorepo',
      frameworks: ['NestJS', 'Angular'],
      languages: ['TypeScript'],
    }),
    getAvailableAgents: jest.fn().mockReturnValue([
      {
        id: 'gemini',
        name: 'Gemini CLI',
        description: 'Google Gemini CLI',
        type: 'cli',
        available: true,
      },
    ]),
    discoverAvailableSkills: jest.fn().mockReturnValue([
      {
        id: 'lint',
        name: 'Linter',
        description: 'runs lint',
        source: 'plugin',
        isActive: true,
      },
    ]),
    isWorkspaceEffectivelyEmpty: jest.fn().mockResolvedValue(false),
  } as unknown as Mocked<HarnessWorkspaceContextService>;

  const service = new HarnessWorkflowPromptService(workspaceContext);
  return { service, workspaceContext };
}

describe('HarnessWorkflowPromptService', () => {
  it('composes a prompt containing workspace context, the proposeConfig instruction, and the user intent', async () => {
    const { service, workspaceContext } = buildService();

    const { prompt } = await service.composePrompt({
      mode: 'configure-harness',
      intent: 'build a real estate CRM harness',
    });

    expect(workspaceContext.resolveWorkspaceContext).toHaveBeenCalled();
    expect(prompt).toContain('acme-app');
    expect(prompt).toContain('NestJS');
    expect(prompt).toContain('proposeConfig');
    expect(prompt).toContain('isConfigComplete');
    expect(prompt).toContain('build a real estate CRM harness');
    expect(prompt).toContain('Gemini CLI');
    expect(prompt).toContain('Linter');
  });

  it('renders "(none discovered)" when no skills are available', async () => {
    const { service, workspaceContext } = buildService();
    workspaceContext.discoverAvailableSkills.mockReturnValue([]);

    const { prompt } = await service.composePrompt({
      mode: 'configure-harness',
      intent: 'anything',
    });

    expect(prompt).toContain('(none discovered)');
  });

  it('leads with project planning instructions for an empty workspace', async () => {
    const { service, workspaceContext } = buildService();
    workspaceContext.isWorkspaceEffectivelyEmpty.mockResolvedValue(true);

    const { prompt } = await service.composePrompt({
      mode: 'configure-harness',
      intent: 'build something new',
    });

    expect(prompt).toContain('Project Planning');
    expect(prompt).toContain('README');
    expect(prompt).toMatch(/interview the user/i);
    expect(prompt).toMatch(/propose an architecture/i);
    const planningIndex = prompt.indexOf('Project Planning');
    const teamIndex = prompt.indexOf('design the AI team');
    expect(planningIndex).toBeGreaterThan(-1);
    expect(planningIndex).toBeLessThan(teamIndex);
  });

  it('keeps the existing-workspace flow when the workspace is not empty', async () => {
    const { service } = buildService();

    const { prompt } = await service.composePrompt({
      mode: 'configure-harness',
      intent: 'anything',
    });

    expect(prompt).not.toContain('Project Planning');
    expect(prompt).toContain('drive the configuration to completion');
  });

  it('tells the user what Apply writes in both variants', async () => {
    const { service, workspaceContext } = buildService();

    const nonEmpty = await service.composePrompt({
      mode: 'configure-harness',
      intent: 'anything',
    });
    expect(nonEmpty.prompt).toContain('.claude/CLAUDE.md');
    expect(nonEmpty.prompt).toContain('.claude/agents/');
    expect(nonEmpty.prompt).toContain('.claude/skills/');

    workspaceContext.isWorkspaceEffectivelyEmpty.mockResolvedValue(true);
    const empty = await service.composePrompt({
      mode: 'configure-harness',
      intent: 'anything',
    });
    expect(empty.prompt).toContain('.claude/CLAUDE.md');
    expect(empty.prompt).toContain('.claude/agents/');
    expect(empty.prompt).toContain('.claude/skills/');
  });
});
