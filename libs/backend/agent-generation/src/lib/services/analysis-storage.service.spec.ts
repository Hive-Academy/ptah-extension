/**
 * AnalysisStorageService Tests
 *
 * The one owner of `.ptah/analysis` I/O, driven through an in-memory
 * `IFileSystemProvider`. Covers:
 * - authorized analysis-dir canonicalization
 * - destructive `createSlugDir` vs non-destructive `ensureSlugDir`
 * - version-3 manifest round-trip; v2 / malformed manifests are rejected and
 *   never deleted
 * - generation checkpoint create / load / update, including the root fallback
 * - resumable-run discovery
 * - enhanced-prompt trace writes with a slug and with the fallback root
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { join, resolve } from 'path';

jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: { LOGGER: Symbol.for('Logger') },
}));

import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import { AnalysisStorageService } from './analysis-storage.service';
import type { MultiPhaseManifest } from '../types/multi-phase.types';
import type { GenerationCheckpointManifest } from '../types/generation-checkpoint.types';

const WORKSPACE = resolve('/ws/demo');
const ANALYSIS_ROOT = join(WORKSPACE, '.ptah', 'analysis');

function manifestV3(
  overrides: Partial<MultiPhaseManifest> = {},
): MultiPhaseManifest {
  return {
    version: 3,
    runId: 'RUN-1',
    slug: 'demo',
    analyzedAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-08-30T10:05:00.000Z',
    lifecycle: 'completed',
    model: 'test-model',
    totalDurationMs: 1000,
    phases: {
      'project-profile': {
        status: 'completed',
        file: '01-project-profile.md',
        durationMs: 10,
      },
      'architecture-assessment': {
        status: 'completed',
        file: '02-architecture-assessment.md',
        durationMs: 10,
      },
      'quality-audit': {
        status: 'completed',
        file: '03-quality-audit.md',
        durationMs: 10,
      },
      'elevation-plan': {
        status: 'completed',
        file: '04-elevation-plan.md',
        durationMs: 10,
      },
    },
    ...overrides,
  };
}

function generationManifest(
  overrides: Partial<GenerationCheckpointManifest> = {},
): GenerationCheckpointManifest {
  return {
    version: 1,
    runId: 'GEN-1',
    createdAt: '2026-08-30T10:10:00.000Z',
    updatedAt: '2026-08-30T10:10:00.000Z',
    lifecycle: 'running',
    outputDirectory: join(WORKSPACE, '.claude', 'agents'),
    selectedAgentIds: ['backend-developer'],
    input: { threshold: 50 },
    agents: {
      'backend-developer': {
        agentId: 'backend-developer',
        filePath: join(WORKSPACE, '.claude', 'agents', 'backend-developer.md'),
        status: 'pending',
        rejectedSections: 0,
        tailoredSections: 0,
      },
    },
    ...overrides,
  };
}

describe('AnalysisStorageService', () => {
  let fs: MockFileSystemProvider;
  let service: AnalysisStorageService;
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fs = createMockFileSystemProvider();
    service = new AnalysisStorageService(logger as never, fs);
  });

  describe('resolveAuthorizedAnalysisDir', () => {
    it('accepts an absolute slug directory under the analysis root', () => {
      const slugDir = join(ANALYSIS_ROOT, 'demo');
      expect(service.resolveAuthorizedAnalysisDir(WORKSPACE, slugDir)).toBe(
        slugDir,
      );
    });

    it('accepts a workspace-relative slug directory', () => {
      expect(
        service.resolveAuthorizedAnalysisDir(WORKSPACE, '.ptah/analysis/demo'),
      ).toBe(join(ANALYSIS_ROOT, 'demo'));
    });

    it('accepts the analysis root itself', () => {
      expect(
        service.resolveAuthorizedAnalysisDir(WORKSPACE, ANALYSIS_ROOT),
      ).toBe(ANALYSIS_ROOT);
    });

    it('rejects a ".." escape', () => {
      expect(
        service.resolveAuthorizedAnalysisDir(
          WORKSPACE,
          join(ANALYSIS_ROOT, '..', '..', 'secrets'),
        ),
      ).toBeNull();
      expect(
        service.resolveAuthorizedAnalysisDir(WORKSPACE, '.ptah/analysis/../x'),
      ).toBeNull();
    });

    it('rejects an absolute path outside the workspace', () => {
      expect(
        service.resolveAuthorizedAnalysisDir(WORKSPACE, resolve('/elsewhere')),
      ).toBeNull();
    });
  });

  describe('slug directories', () => {
    it('createSlugDir removes previous content', async () => {
      const slugDir = join(ANALYSIS_ROOT, 'demo');
      await fs.writeFile(join(slugDir, 'stale.md'), 'stale');

      const created = await service.createSlugDir(WORKSPACE, 'Demo');

      expect(created).toEqual({ slugDir, slug: 'demo' });
      expect(fs.delete).toHaveBeenCalledWith(slugDir, { recursive: true });
      expect(await fs.exists(join(slugDir, 'stale.md'))).toBe(false);
      expect(await fs.exists(slugDir)).toBe(true);
    });

    it('ensureSlugDir keeps existing content', async () => {
      const slugDir = join(ANALYSIS_ROOT, 'demo');
      await fs.writeFile(join(slugDir, 'kept.md'), 'kept');

      const ensured = await service.ensureSlugDir(WORKSPACE, 'Demo');

      expect(ensured).toEqual({ slugDir, slug: 'demo' });
      expect(fs.delete).not.toHaveBeenCalled();
      expect(await fs.readFile(join(slugDir, 'kept.md'))).toBe('kept');
    });
  });

  describe('phase files', () => {
    it('writePhaseFile creates the directory first and phaseFileExists sees it', async () => {
      const slugDir = join(ANALYSIS_ROOT, 'fresh');

      expect(await service.phaseFileExists(slugDir, 'a.md')).toBe(false);
      await service.writePhaseFile(slugDir, 'a.md', 'content');

      expect(fs.createDirectory).toHaveBeenCalledWith(slugDir);
      expect(await service.phaseFileExists(slugDir, 'a.md')).toBe(true);
      expect(await service.readPhaseFile(slugDir, 'a.md')).toBe('content');
      expect(await service.readPhaseFile(slugDir, 'missing.md')).toBeNull();
    });
  });

  describe('analysis manifest (v3)', () => {
    const slugDir = join(ANALYSIS_ROOT, 'demo');

    it('round-trips a version-3 manifest', async () => {
      const manifest = manifestV3({ lifecycle: 'paused' });
      await service.writeManifest(slugDir, manifest);

      const loaded = await service.loadManifest(slugDir);

      expect(loaded).toEqual(manifest);
      expect(fs.createDirectory).toHaveBeenCalledWith(slugDir);
    });

    it('rejects a version-2 manifest and leaves the file untouched', async () => {
      const v2 = JSON.stringify({
        version: 2,
        slug: 'demo',
        analyzedAt: '2026-01-01T00:00:00.000Z',
        model: 'm',
        totalDurationMs: 1,
        phases: {},
      });
      await fs.writeFile(join(slugDir, 'manifest.json'), v2);

      expect(await service.loadManifest(slugDir)).toBeNull();
      expect(fs.delete).not.toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(await fs.readFile(join(slugDir, 'manifest.json'))).toBe(v2);
    });

    it('rejects malformed JSON and leaves the file untouched', async () => {
      await fs.writeFile(join(slugDir, 'manifest.json'), '{ not json');

      expect(await service.loadManifest(slugDir)).toBeNull();
      expect(fs.delete).not.toHaveBeenCalled();
      expect(await fs.readFile(join(slugDir, 'manifest.json'))).toBe(
        '{ not json',
      );
    });

    it('rejects a failed phase without an error message', async () => {
      const broken = manifestV3();
      broken.phases['quality-audit'] = {
        status: 'failed',
        file: '03-quality-audit.md',
        durationMs: 1,
      };
      await fs.writeFile(
        join(slugDir, 'manifest.json'),
        JSON.stringify(broken),
      );

      expect(await service.loadManifest(slugDir)).toBeNull();
    });

    it('returns null when there is no manifest', async () => {
      expect(await service.loadManifest(slugDir)).toBeNull();
    });
  });

  describe('generation checkpoint', () => {
    const slugDir = join(ANALYSIS_ROOT, 'demo');

    it('writes beside the analysis manifest and loads it back', async () => {
      const manifest = generationManifest();

      const path = await service.writeGenerationManifest(
        WORKSPACE,
        slugDir,
        manifest,
      );

      expect(path).toBe(join(slugDir, 'generation-manifest.json'));
      expect(fs.createDirectory).toHaveBeenCalledWith(slugDir);
      expect(await service.loadGenerationManifest(WORKSPACE, slugDir)).toEqual(
        manifest,
      );
    });

    it('uses the analysis root when the run has no slug', async () => {
      await service.writeGenerationManifest(
        WORKSPACE,
        null,
        generationManifest(),
      );

      expect(service.getGenerationManifestPath(WORKSPACE, null)).toBe(
        join(ANALYSIS_ROOT, 'generation-manifest.json'),
      );
      expect(
        await fs.exists(join(ANALYSIS_ROOT, 'generation-manifest.json')),
      ).toBe(true);
    });

    it('updates an existing checkpoint and bumps updatedAt', async () => {
      await service.writeGenerationManifest(
        WORKSPACE,
        slugDir,
        generationManifest(),
      );

      const updated = await service.updateGenerationManifest(
        WORKSPACE,
        slugDir,
        (current) => ({
          ...current,
          lifecycle: 'completed',
          agents: {
            ...current.agents,
            'backend-developer': {
              ...current.agents['backend-developer'],
              status: 'written',
            },
          },
        }),
      );

      expect(updated?.lifecycle).toBe('completed');
      expect(updated?.agents['backend-developer'].status).toBe('written');
      expect(updated?.updatedAt).not.toBe('2026-08-30T10:10:00.000Z');
      const reloaded = await service.loadGenerationManifest(WORKSPACE, slugDir);
      expect(reloaded?.lifecycle).toBe('completed');
    });

    it('returns null for update when no valid checkpoint exists', async () => {
      await fs.writeFile(
        join(slugDir, 'generation-manifest.json'),
        JSON.stringify({ version: 99 }),
      );

      expect(
        await service.updateGenerationManifest(WORKSPACE, slugDir, (m) => m),
      ).toBeNull();
      expect(
        await service.loadGenerationManifest(WORKSPACE, slugDir),
      ).toBeNull();
      expect(fs.delete).not.toHaveBeenCalled();
    });
  });

  describe('findLatestResumableRun', () => {
    it('returns the latest unfinished analysis with its generation checkpoint', async () => {
      const olderDir = join(ANALYSIS_ROOT, 'older');
      const newerDir = join(ANALYSIS_ROOT, 'newer');
      await service.writeManifest(
        olderDir,
        manifestV3({
          slug: 'older',
          lifecycle: 'paused',
          updatedAt: '2026-08-29T00:00:00.000Z',
        }),
      );
      await service.writeManifest(
        newerDir,
        manifestV3({
          slug: 'newer',
          lifecycle: 'paused',
          updatedAt: '2026-08-31T00:00:00.000Z',
        }),
      );
      await service.writeGenerationManifest(
        WORKSPACE,
        newerDir,
        generationManifest({ lifecycle: 'paused' }),
      );

      const run = await service.findLatestResumableRun(WORKSPACE);

      expect(run?.slugDir).toBe(newerDir);
      expect(run?.manifest?.slug).toBe('newer');
      expect(run?.generation?.lifecycle).toBe('paused');
    });

    it('offers a completed analysis when its generation is unfinished', async () => {
      const slugDir = join(ANALYSIS_ROOT, 'demo');
      await service.writeManifest(slugDir, manifestV3());
      await service.writeGenerationManifest(
        WORKSPACE,
        slugDir,
        generationManifest({ lifecycle: 'timed-out' }),
      );

      const run = await service.findLatestResumableRun(WORKSPACE);

      expect(run?.manifest?.lifecycle).toBe('completed');
      expect(run?.generation?.lifecycle).toBe('timed-out');
    });

    it('returns null when everything is completed', async () => {
      const slugDir = join(ANALYSIS_ROOT, 'demo');
      await service.writeManifest(slugDir, manifestV3());
      await service.writeGenerationManifest(
        WORKSPACE,
        slugDir,
        generationManifest({ lifecycle: 'completed' }),
      );

      expect(await service.findLatestResumableRun(WORKSPACE)).toBeNull();
    });

    it('ignores version-2 manifests and never deletes them', async () => {
      const slugDir = join(ANALYSIS_ROOT, 'legacy');
      await fs.writeFile(
        join(slugDir, 'manifest.json'),
        JSON.stringify({ version: 2, slug: 'legacy', phases: {} }),
      );

      expect(await service.findLatestResumableRun(WORKSPACE)).toBeNull();
      expect(await service.findLatestMultiPhaseAnalysis(WORKSPACE)).toBeNull();
      expect(fs.delete).not.toHaveBeenCalled();
      expect(await fs.exists(join(slugDir, 'manifest.json'))).toBe(true);
    });

    it('falls back to a slug-less generation checkpoint in the analysis root', async () => {
      await service.writeGenerationManifest(
        WORKSPACE,
        null,
        generationManifest({ lifecycle: 'running' }),
      );

      const run = await service.findLatestResumableRun(WORKSPACE);

      expect(run).toEqual({
        slugDir: null,
        manifest: null,
        generation: expect.objectContaining({ runId: 'GEN-1' }),
      });
    });

    it('returns null when the analysis root does not exist', async () => {
      expect(await service.findLatestResumableRun(WORKSPACE)).toBeNull();
    });
  });

  describe('findLatestMultiPhaseAnalysis', () => {
    it('picks the newest analyzedAt among valid manifests', async () => {
      await service.writeManifest(
        join(ANALYSIS_ROOT, 'a'),
        manifestV3({ slug: 'a', analyzedAt: '2026-08-01T00:00:00.000Z' }),
      );
      await service.writeManifest(
        join(ANALYSIS_ROOT, 'b'),
        manifestV3({ slug: 'b', analyzedAt: '2026-08-20T00:00:00.000Z' }),
      );

      const latest = await service.findLatestMultiPhaseAnalysis(WORKSPACE);

      expect(latest?.manifest.slug).toBe('b');
      expect(latest?.slugDir).toBe(join(ANALYSIS_ROOT, 'b'));
    });
  });

  describe('writeEnhancedPromptTrace', () => {
    const metadata = {
      generatedAt: '2026-08-31T00:00:00.000Z',
      configHash: 'hash:pt1',
      detectedStack: {
        languages: ['TypeScript'],
        frameworks: [],
        buildTools: [],
        testingFrameworks: [],
        additionalTools: [],
        projectType: 'app',
        configFiles: [],
      },
      analysisDirectory: '.ptah/analysis/demo',
      analysisPhaseIds: ['project-profile'],
      promptLength: 12,
    };

    it('writes markdown and metadata into the slug directory', async () => {
      const slugDir = join(ANALYSIS_ROOT, 'demo');

      const paths = await service.writeEnhancedPromptTrace(
        WORKSPACE,
        slugDir,
        '## Prompt body',
        metadata,
      );

      expect(paths).toEqual({
        markdownPath: join(slugDir, 'enhanced-prompt.md'),
        metadataPath: join(slugDir, 'enhanced-prompt.json'),
      });
      expect(fs.createDirectory).toHaveBeenCalledWith(slugDir);
      expect(await fs.readFile(paths.markdownPath)).toBe('## Prompt body');
      expect(JSON.parse(await fs.readFile(paths.metadataPath))).toEqual(
        metadata,
      );
    });

    it('uses the analysis root when there is no slug', async () => {
      const paths = await service.writeEnhancedPromptTrace(
        WORKSPACE,
        null,
        'prompt',
        { ...metadata, analysisDirectory: null, analysisPhaseIds: [] },
      );

      expect(paths.markdownPath).toBe(
        join(ANALYSIS_ROOT, 'enhanced-prompt.md'),
      );
      expect(paths.metadataPath).toBe(
        join(ANALYSIS_ROOT, 'enhanced-prompt.json'),
      );
      expect(fs.createDirectory).toHaveBeenCalledWith(ANALYSIS_ROOT);
    });

    it('propagates a write failure', async () => {
      fs.writeFile.mockRejectedValueOnce(new Error('EACCES'));

      await expect(
        service.writeEnhancedPromptTrace(WORKSPACE, null, 'p', metadata),
      ).rejects.toThrow('EACCES');
    });
  });

  describe('list / loadMultiPhase', () => {
    it('lists valid runs newest first with completed-phase counts', async () => {
      const partial = manifestV3({
        slug: 'partial',
        analyzedAt: '2026-08-25T00:00:00.000Z',
        lifecycle: 'failed',
      });
      partial.phases['elevation-plan'] = {
        status: 'failed',
        file: '04-elevation-plan.md',
        durationMs: 1,
        error: 'timed out',
      };
      await service.writeManifest(join(ANALYSIS_ROOT, 'partial'), partial);
      await service.writeManifest(
        join(ANALYSIS_ROOT, 'full'),
        manifestV3({ slug: 'full', analyzedAt: '2026-08-26T00:00:00.000Z' }),
      );

      const items = await service.list(WORKSPACE);

      expect(items.map((i) => i.filename)).toEqual(['full', 'partial']);
      expect(items[1].phaseCount).toBe(3);
    });

    it('loads only completed phase contents and exposes v3 manifest fields', async () => {
      const slugDir = join(ANALYSIS_ROOT, 'demo');
      const manifest = manifestV3({ lifecycle: 'failed' });
      manifest.phases['quality-audit'] = {
        status: 'failed',
        file: '03-quality-audit.md',
        durationMs: 1,
        error: 'no result',
      };
      await service.writeManifest(slugDir, manifest);
      await service.writePhaseFile(slugDir, '01-project-profile.md', 'P1');
      await service.writePhaseFile(slugDir, '03-quality-audit.md', 'DIAG');

      const response = await service.loadMultiPhase(WORKSPACE, 'demo');

      expect(response.isMultiPhase).toBe(true);
      expect(response.manifest.version).toBe(3);
      expect(response.manifest.runId).toBe('RUN-1');
      expect(response.manifest.lifecycle).toBe('failed');
      expect(response.phaseContents).toEqual({ 'project-profile': 'P1' });
      expect(response.analysisDir).toBe(slugDir);
    });

    it('throws for a missing manifest', async () => {
      await expect(service.loadMultiPhase(WORKSPACE, 'nope')).rejects.toThrow(
        'Invalid or missing analysis manifest',
      );
    });
  });
});
