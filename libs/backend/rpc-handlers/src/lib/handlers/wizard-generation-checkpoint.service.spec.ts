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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GenerationCheckpointManifest } from '@ptah-extension/agent-generation';
import type { GenerationTargetInfo } from '@ptah-extension/shared';
import {
  GenerationCheckpointService,
  generationOutputRoot,
} from './wizard-generation-checkpoint.service';
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

describe('run manifest decisions (target, output root, guards)', () => {
  let root: string;
  let opened: string;
  let sibling: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-checkpoint-'));
    // A root marker, so the harness root of every folder below is `root`.
    fs.mkdirSync(path.join(root, '.git'));
    opened = path.join(root, 'packages', 'app');
    sibling = path.join(root, 'packages', 'other');
    fs.mkdirSync(opened, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function serviceWith(storage: Record<string, unknown>) {
    const child = container.createChildContainer();
    child.register(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, {
      useValue: storage,
    });
    return new GenerationCheckpointService(
      Object.create(Logger.prototype) as Logger,
      child,
    );
  }

  function manifestWriting(outputRoot: string, outputDirectory?: string) {
    return GenerationCheckpointManifestSchema.parse({
      version: 1,
      runId: 'run',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      lifecycle: 'paused',
      outputDirectory:
        outputDirectory ?? path.join(outputRoot, '.claude', 'agents'),
      outputRoot,
      selectedAgentIds: [],
      input: {},
      agents: {},
    });
  }

  const harnessTarget = (): GenerationTargetInfo => ({
    harnessRoot: root,
    openedFolder: opened,
    chosen: 'harness-root',
    openedIsHarnessRoot: false,
  });

  it('isTrusted accepts the harness root and the opened folder, and rejects a sibling', () => {
    const service = serviceWith({
      resolveAuthorizedAnalysisDir: (_ws: string, candidate: string) =>
        candidate,
    });
    const location = { workspaceRoot: opened, analysisDir: null };

    expect(service.isTrusted(location, manifestWriting(root))).toBe(true);
    expect(service.isTrusted(location, manifestWriting(opened))).toBe(true);
    expect(service.isTrusted(location, manifestWriting(sibling))).toBe(false);
    // The output directory must be the root's own agent directory.
    expect(
      service.isTrusted(
        location,
        manifestWriting(root, path.join(sibling, '.claude', 'agents')),
      ),
    ).toBe(false);
  });

  it('createFresh writes the chosen root and persists the target and one guard per selected agent', async () => {
    const writeGenerationManifest = jest
      .fn()
      .mockResolvedValue('manifest.json');
    const service = serviceWith({ writeGenerationManifest });
    const keep = { mode: 'keep' as const };

    const prepared = await service.createFresh({
      workspaceRoot: opened,
      analysisDir: null,
      selectedAgentIds: ['agent-a'],
      input: {},
      target: harnessTarget(),
      fileGuards: { 'agent-a': keep, 'not-selected': keep },
    });

    const outputDirectory = path.join(root, '.claude', 'agents');
    expect(prepared.manifest).toMatchObject({
      outputRoot: root,
      outputDirectory,
      target: harnessTarget(),
      fileGuards: { 'agent-a': keep },
    });
    expect(prepared.manifest.agents['agent-a'].filePath).toBe(
      path.join(outputDirectory, 'agent-a.md'),
    );
    // What was written is what a resume reads back.
    const written = writeGenerationManifest.mock
      .calls[0][2] as GenerationCheckpointManifest;
    expect(GenerationCheckpointManifestSchema.parse(written)).toEqual(written);
  });

  it('the opened-folder target writes under the opened folder', () => {
    expect(
      generationOutputRoot(opened, {
        ...harnessTarget(),
        chosen: 'opened-folder',
      }),
    ).toBe(opened);
    expect(generationOutputRoot(opened, harnessTarget())).toBe(root);
    expect(
      generationOutputRoot(root, {
        ...harnessTarget(),
        openedFolder: root,
        openedIsHarnessRoot: true,
      }),
    ).toBe(root);
  });

  it('a resume carries files left alone forward with their status and clears the Library outcome', async () => {
    const writeGenerationManifest = jest
      .fn()
      .mockResolvedValue('manifest.json');
    const service = serviceWith({ writeGenerationManifest });
    const agent = (
      agentId: string,
      status: GenerationCheckpointManifest['agents'][string]['status'],
    ) => ({
      agentId,
      filePath: path.join(root, '.claude', 'agents', `${agentId}.md`),
      status,
      rejectedSections: 0,
      tailoredSections: 0,
    });
    const manifest = GenerationCheckpointManifestSchema.parse({
      version: 1,
      runId: 'run',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      lifecycle: 'paused',
      outputDirectory: path.join(root, '.claude', 'agents'),
      outputRoot: root,
      fileGuards: { kept: { mode: 'keep' } },
      library: { pass: 'updated', diverged: ['written'] },
      selectedAgentIds: ['kept', 'changed', 'written', 'pending'],
      input: {},
      agents: {
        kept: agent('kept', 'kept'),
        changed: agent('changed', 'changed-since-preview'),
        written: agent('written', 'written'),
        pending: agent('pending', 'pending'),
      },
    });

    const prepared = await service.prepareResume(
      { workspaceRoot: root, analysisDir: null },
      manifest,
    );

    expect(prepared.agentIds).toEqual(['pending']);
    expect(
      Object.fromEntries(
        prepared.carriedOver.map((o) => [o.agentId, o.status]),
      ),
    ).toEqual({
      kept: 'kept',
      changed: 'changed-since-preview',
      written: 'unchanged',
    });
    expect(prepared.manifest.fileGuards).toEqual({ kept: { mode: 'keep' } });
    expect(prepared.manifest).not.toHaveProperty('library');
  });

  it('rejects a persisted replace guard without a baseline', () => {
    const result = GenerationCheckpointManifestSchema.safeParse({
      version: 1,
      runId: 'run',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      lifecycle: 'paused',
      outputDirectory: '/workspace/.claude/agents',
      fileGuards: { agent: { mode: 'replace-allowed' } },
      selectedAgentIds: [],
      input: {},
      agents: {},
    });
    expect(result.success).toBe(false);
  });
});
