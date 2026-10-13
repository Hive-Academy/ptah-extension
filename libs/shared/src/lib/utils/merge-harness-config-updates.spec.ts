import type { HarnessConfig } from '../types/rpc/rpc-harness.types';
import { mergeHarnessConfigUpdates } from './merge-harness-config-updates';

describe('mergeHarnessConfigUpdates', () => {
  it('keeps unmentioned persona, prompt, and CLAUDE.md fields', () => {
    const base: Partial<HarnessConfig> = {
      persona: { label: 'Reviewer', description: 'Reviews code', goals: ['quality'] },
      prompt: { systemPrompt: 'Be careful', enhancedSections: { review: 'Check' } },
      claudeMd: {
        generateProjectClaudeMd: true,
        customSections: { notes: 'Keep' },
        previewContent: 'Preview',
      },
    };

    expect(mergeHarnessConfigUpdates(base, {
      persona: { label: 'Builder' } as HarnessConfig['persona'],
      prompt: { systemPrompt: 'Build' } as HarnessConfig['prompt'],
      claudeMd: { previewContent: 'New preview' } as HarnessConfig['claudeMd'],
    })).toEqual({
      persona: { label: 'Builder', description: 'Reviews code', goals: ['quality'] },
      prompt: { systemPrompt: 'Build', enhancedSections: { review: 'Check' } },
      claudeMd: {
        generateProjectClaudeMd: true,
        customSections: { notes: 'Keep' },
        previewContent: 'New preview',
      },
    });
  });

  it('merges enabled agents and MCP tools by key while retaining other fields', () => {
    const base: Partial<HarnessConfig> = {
      agents: {
        enabledAgents: { reviewer: { enabled: true } },
        harnessSubagents: [],
      },
      mcp: {
        servers: [{ name: 'search', url: 'https://example.test', enabled: true }],
        enabledTools: { search: ['query'] },
      },
    };
    const merged = mergeHarnessConfigUpdates(base, {
      agents: { enabledAgents: { builder: { enabled: false } } } as HarnessConfig['agents'],
      mcp: { enabledTools: { files: ['read'] } } as unknown as HarnessConfig['mcp'],
    });

    expect(merged.agents).toEqual({
      enabledAgents: {
        reviewer: { enabled: true },
        builder: { enabled: false },
      },
      harnessSubagents: [],
    });
    expect(merged.mcp).toEqual({
      servers: base.mcp?.servers,
      enabledTools: { search: ['query'], files: ['read'] },
    });
  });

  it('keeps selected skill origins, prunes removed skills, and merges refs by skillId', () => {
    const base: Partial<HarnessConfig> = {
      skills: {
        selectedSkills: ['review', 'triage', 'retired'],
        selectedSkillRefs: [
          { skillId: 'review', source: 'skills.sh', installSource: 'owner/review' },
          { skillId: 'triage', source: 'skills.sh', installSource: 'owner/triage' },
          { skillId: 'retired', source: 'local' },
        ],
        createdSkills: [],
      },
    };
    const selected = mergeHarnessConfigUpdates(base, {
      skills: {
        selectedSkills: ['review', 'triage'],
        selectedSkillRefs: [],
      } as unknown as HarnessConfig['skills'],
    });
    expect(selected.skills?.selectedSkillRefs).toEqual([
      { skillId: 'review', source: 'skills.sh', installSource: 'owner/review' },
      { skillId: 'triage', source: 'skills.sh', installSource: 'owner/triage' },
    ]);

    const refsOnly = mergeHarnessConfigUpdates(selected, {
      skills: {
        selectedSkillRefs: [
          { skillId: 'review', source: 'skills.sh', installSource: 'owner/moved' },
        ],
      } as HarnessConfig['skills'],
    });
    expect(refsOnly.skills?.selectedSkills).toEqual(['review', 'triage']);
    expect(refsOnly.skills?.selectedSkillRefs).toEqual([
      { skillId: 'review', source: 'skills.sh', installSource: 'owner/moved' },
      { skillId: 'triage', source: 'skills.sh', installSource: 'owner/triage' },
    ]);
  });

  it('returns an equivalent new object for an empty update without mutating inputs', () => {
    const base: Partial<HarnessConfig> = {
      name: 'Existing',
      agents: { enabledAgents: { reviewer: { enabled: true } } },
    };
    const update: Partial<HarnessConfig> = {
      agents: { enabledAgents: { builder: { enabled: true } } },
    };
    const baseBefore = JSON.stringify(base);
    const updateBefore = JSON.stringify(update);

    const empty = mergeHarnessConfigUpdates(base, {});
    expect(empty).toEqual(base);
    expect(empty).not.toBe(base);
    expect(mergeHarnessConfigUpdates(base, update).agents?.enabledAgents).toEqual({
      reviewer: { enabled: true },
      builder: { enabled: true },
    });
    expect(JSON.stringify(base)).toBe(baseBefore);
    expect(JSON.stringify(update)).toBe(updateBefore);
  });
});
