import 'reflect-metadata';
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {
    Node: 'node',
    React: 'react',
    Vue: 'vue',
    Angular: 'angular',
    NextJS: 'nextjs',
    Python: 'python',
    Java: 'java',
    Rust: 'rust',
    Go: 'go',
    DotNet: 'dotnet',
    PHP: 'php',
    Ruby: 'ruby',
    General: 'general',
    Unknown: 'unknown',
  },
  Framework: {
    React: 'react',
    Vue: 'vue',
    Angular: 'angular',
    NextJS: 'nextjs',
    Nuxt: 'nuxt',
    Express: 'express',
    Django: 'django',
    Laravel: 'laravel',
    Rails: 'rails',
    Svelte: 'svelte',
    Astro: 'astro',
    NestJS: 'nestjs',
    Fastify: 'fastify',
    Flask: 'flask',
    FastAPI: 'fastapi',
    Spring: 'spring',
  },
  MonorepoType: {
    Nx: 'nx',
    Lerna: 'lerna',
    Rush: 'rush',
    Turborepo: 'turborepo',
    PnpmWorkspaces: 'pnpm-workspaces',
    YarnWorkspaces: 'yarn-workspaces',
  },
  FileType: {
    Source: 'source',
    Test: 'test',
    Config: 'config',
    Documentation: 'docs',
    Asset: 'asset',
  },
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  AstAnalysisService: class AstAnalysisServiceStub {},
  DependencyGraphService: class DependencyGraphServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ContextService: class ContextServiceStub {},
  ContextOrchestrationService: class ContextOrchestrationServiceStub {},
  WorkspaceService: class WorkspaceServiceStub {},
  TokenCounterService: class TokenCounterServiceStub {},
  FileSystemService: class FileSystemServiceStub {},
  FileSystemError: class FileSystemErrorStub extends Error {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  DependencyAnalyzerService: class DependencyAnalyzerServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
  PatternMatcherService: class PatternMatcherServiceStub {},
  IgnorePatternResolverService: class IgnorePatternResolverServiceStub {},
  WorkspaceIndexerService: class WorkspaceIndexerServiceStub {},
  FileTypeClassifierService: class FileTypeClassifierServiceStub {},
  FileRelevanceScorerService: class FileRelevanceScorerServiceStub {},
  ContextSizeOptimizerService: class ContextSizeOptimizerServiceStub {},
  ContextEnrichmentService: class ContextEnrichmentServiceStub {},
}));

import {
  AGENT_GENERATION_TOKENS,
  GenerationCheckpointManifestSchema,
} from '@ptah-extension/agent-generation';
import { GenerationCheckpointService } from './wizard-generation-checkpoint.service';
import { Logger } from '@ptah-extension/vscode-core';
import { container } from 'tsyringe';

describe('generation checkpoint compatibility', () => {
  it.each([
    [
      'source analysis',
      {
        source: {
          kind: 'verified-analysis',
          analysisDir: '/foreign/analysis',
          analysisRunId: 'run',
        },
      },
    ],
    ['workspace root', { workspaceRoot: '/foreign' }],
    [
      'tab workspace',
      {
        tabBinding: {
          tabId: 'tab',
          workflow: 'setup-agent-generation',
          workspacePath: '/foreign',
        },
      },
    ],
  ])('rejects a foreign %s path', (_name, change) => {
    const child = container.createChildContainer();
    child.register(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, {
      useValue: {
        resolveAuthorizedAnalysisDir: (_root: string, candidate: string) =>
          candidate.startsWith('/workspace/.ptah/analysis/') ? candidate : null,
      },
    });
    const service = new GenerationCheckpointService(
      Object.create(Logger.prototype) as Logger,
      child,
    );
    const manifest = GenerationCheckpointManifestSchema.parse({
      version: 1,
      runId: 'run',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      lifecycle: 'paused',
      outputDirectory: '/workspace/.claude/agents',
      selectedAgentIds: [],
      input: {},
      agents: {},
      ...change,
    });
    expect(
      service.isTrusted(
        { workspaceRoot: '/workspace', analysisDir: null },
        manifest,
      ),
    ).toBe(false);
  });
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
    expect(parsed.verifiedResult).toBeUndefined();
    expect(parsed.propagation).toBeUndefined();
    expect(
      GenerationCheckpointManifestSchema.parse({
        ...old,
        verifiedResult: true,
        propagation: { consent: 'granted', status: 'completed' },
      }),
    ).toMatchObject({
      verifiedResult: true,
      propagation: { consent: 'granted', status: 'completed' },
    });
  });

  it('clears prior result facts when preparing a resume', async () => {
    const writeGenerationManifest = jest
      .fn()
      .mockResolvedValue('manifest.json');
    const child = container.createChildContainer();
    child.register(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, {
      useValue: { writeGenerationManifest },
    });
    const service = new GenerationCheckpointService(
      Object.create(Logger.prototype) as Logger,
      child,
    );
    const manifest = GenerationCheckpointManifestSchema.parse({
      version: 1,
      runId: 'run',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      lifecycle: 'paused',
      outputDirectory: '/workspace/.claude/agents',
      selectedAgentIds: ['agent'],
      input: {},
      agents: {
        agent: {
          agentId: 'agent',
          filePath: '/workspace/.claude/agents/agent.md',
          status: 'pending',
          rejectedSections: 0,
          tailoredSections: 0,
        },
      },
      verifiedResult: true,
      propagation: { consent: 'granted', status: 'completed' },
    });
    const prepared = await service.prepareResume(
      { workspaceRoot: '/workspace', analysisDir: null },
      manifest,
    );
    expect(prepared.manifest).not.toHaveProperty('verifiedResult');
    expect(prepared.manifest).not.toHaveProperty('propagation');
    expect(prepared.previousPropagation).toEqual({
      consent: 'granted',
      status: 'completed',
    });
    expect(writeGenerationManifest.mock.calls[0][2]).not.toHaveProperty(
      'verifiedResult',
    );
    expect(writeGenerationManifest.mock.calls[0][2]).not.toHaveProperty(
      'propagation',
    );
  });
});
