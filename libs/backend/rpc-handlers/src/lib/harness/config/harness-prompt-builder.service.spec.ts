import 'reflect-metadata';
import type {
  HarnessConfig,
  HarnessSubagentDefinition,
} from '@ptah-extension/shared';
import { HarnessPromptBuilderService } from './harness-prompt-builder.service';

describe('HarnessPromptBuilderService.buildClaudeMdContent', () => {
  it('renders a subagent the designing agent recorded without tools', () => {
    // `HarnessConfigUpdatesSchema` validates subagents as `z.unknown()`, so an
    // AI-authored entry can arrive with no `tools` array. `harness:apply` used
    // to fail with "Cannot read properties of undefined (reading 'join')".
    const subagent = {
      id: 'catalog-reviewer',
      name: 'Catalog Reviewer',
      description: 'Reviews Shopify drafts',
      role: 'reviewer',
      executionMode: 'on-demand',
      instructions: 'Check variants.',
    } as unknown as HarnessSubagentDefinition;
    const config = {
      name: 'shop',
      persona: { label: 'Operator', description: 'Runs the shop', goals: [] },
      agents: { enabledAgents: {}, harnessSubagents: [subagent] },
      skills: { selectedSkills: [], selectedSkillRefs: [], createdSkills: [] },
      prompt: { systemPrompt: '', enhancedSections: {} },
      mcp: { servers: [], enabledTools: {} },
    } as unknown as Omit<HarnessConfig, 'claudeMd' | 'createdAt' | 'updatedAt'>;

    const content = new HarnessPromptBuilderService().buildClaudeMdContent(
      config,
    );

    expect(content).toContain('### Catalog Reviewer');
    expect(content).toContain('- **Tools**: ');
  });
});
