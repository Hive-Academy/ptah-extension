import 'reflect-metadata';
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
}));

import { GenerationCheckpointManifestSchema } from '@ptah-extension/agent-generation';

describe('generation checkpoint compatibility', () => {
  it('parses a version-1 checkpoint without a tab binding and keeps final outcomes', () => {
    const old = {
      version: 1,
      runId: 'old-run',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      lifecycle: 'paused',
      outputDirectory: '/workspace/.claude/agents',
      selectedAgentIds: ['agent'],
      input: { model: 'sonnet' },
      agents: {
        agent: {
          agentId: 'agent',
          filePath: '/workspace/.claude/agents/agent.md',
          status: 'written',
          rejectedSections: 1,
          tailoredSections: 2,
        },
      },
    };
    const parsed = GenerationCheckpointManifestSchema.parse(old);
    expect(parsed.tabBinding).toBeUndefined();
    expect(parsed.agents['agent'].status).toBe('written');
    expect(parsed.input.model).toBe('sonnet');
  });
});
