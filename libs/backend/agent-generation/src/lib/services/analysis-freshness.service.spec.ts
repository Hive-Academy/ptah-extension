import 'reflect-metadata';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

jest.mock('@ptah-extension/vscode-core', () => ({
  Logger: jest.fn(),
  TOKENS: { LOGGER: Symbol.for('Logger') },
}));

import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import type { MultiPhaseManifestV4 } from '../types/multi-phase.types';
import { computeWorkspaceFingerprint } from './analysis-fingerprint';
import { AnalysisStorageService } from './analysis-storage.service';
import {
  ANALYSIS_MAX_AGE_MS,
  AnalysisFreshnessService,
} from './analysis-freshness.service';

const ROOT = resolve('/ws/demo');
const DIR = join(ROOT, '.ptah', 'analysis', 'demo');
const REL_DIR = '.ptah/analysis/demo';
const NOW = new Date('2026-10-14T12:00:00.000Z');
const OUTPUT = Buffer.from('verified analysis\n');
const OUTPUT_HASH = createHash('sha256').update(OUTPUT).digest('hex');
const IDS = [
  'project-profile',
  'architecture-assessment',
  'quality-audit',
  'elevation-plan',
] as const;

describe('AnalysisFreshnessService', () => {
  let fs: MockFileSystemProvider;
  let service: AnalysisFreshnessService;
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  let fingerprint: Awaited<ReturnType<typeof computeWorkspaceFingerprint>>;

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    fs = createMockFileSystemProvider();
    await fs.writeFile(join(ROOT, 'package.json'), '{"name":"demo"}');
    await fs.writeFile(join(ROOT, 'pnpm-lock.yaml'), 'lock: one');
    fingerprint = await computeWorkspaceFingerprint(ROOT, fs);
    const storage = new AnalysisStorageService(logger as never, fs);
    service = new AnalysisFreshnessService(storage, fs, logger as never);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function saveManifest(overrides: Partial<MultiPhaseManifestV4> = {}) {
    const phases = Object.fromEntries(
      IDS.map((id, index) => [
        id,
        {
          status: 'completed',
          file: `${index + 1}-${id}.md`,
          durationMs: 1,
          attempt: 1,
          sessionId: 'sdk-session',
          input: {
            workspaceSha256: fingerprint.digest,
            promptSha256: OUTPUT_HASH,
            priorPhaseSha256: null,
            model: 'test-model',
          },
          verification: {
            status: 'verified',
            outputSha256: OUTPUT_HASH,
            checkedAt: NOW.toISOString(),
          },
        },
      ]),
    ) as MultiPhaseManifestV4['phases'];
    const manifest: MultiPhaseManifestV4 = {
      version: 4,
      runId: 'RUN-1',
      slug: 'demo',
      analyzedAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      lifecycle: 'completed',
      model: 'test-model',
      totalDurationMs: 4,
      workspaceFingerprint: fingerprint,
      phases,
      ...overrides,
    };
    await fs.writeFile(join(DIR, 'manifest.json'), JSON.stringify(manifest));
    for (const id of IDS) {
      await fs.writeFileBytes(join(DIR, manifest.phases[id].file), OUTPUT);
    }
    jest.clearAllMocks();
    return manifest;
  }

  function expectNoWrites() {
    for (const method of [
      fs.writeFile,
      fs.writeFileBytes,
      fs.delete,
      fs.createDirectory,
      fs.createDirectoryExclusive,
    ])
      expect(method).not.toHaveBeenCalled();
  }

  it('reports no-analysis for a missing workspace or run', async () => {
    expect(await service.getStatus(null)).toMatchObject({
      state: 'missing',
      reason: 'no-analysis',
      analysisDir: null,
    });
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'missing',
      reason: 'no-analysis',
      analysisDir: null,
    });
    expectNoWrites();
  });

  it('reports a verified completed v4 run as fresh without writing', async () => {
    await saveManifest();
    expect(await service.getStatus(ROOT)).toEqual({
      state: 'fresh',
      reason: 'ok',
      analysisDir: REL_DIR,
      checkedAt: NOW.toISOString(),
      analyzedAt: NOW.toISOString(),
    });
    expectNoWrites();
  });

  it('skips rejected v2 and malformed manifests beside a newer fresh v4 run', async () => {
    const v4 = await saveManifest();
    const analysisRoot = join(ROOT, '.ptah', 'analysis');
    await fs.writeFile(
      join(analysisRoot, 'old-v2', 'manifest.json'),
      JSON.stringify({
        version: 2,
        analyzedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      }),
    );
    await fs.writeFile(
      join(analysisRoot, 'malformed', 'manifest.json'),
      '{broken',
    );
    await fs.writeFile(
      join(analysisRoot, 'invalid-date', 'manifest.json'),
      JSON.stringify({
        ...v4,
        slug: 'invalid-date',
        analyzedAt: 'not-a-date',
      }),
    );
    jest.clearAllMocks();
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'fresh',
      reason: 'ok',
      analysisDir: REL_DIR,
    });
    expectNoWrites();
  });

  it('skips a rejected v2 manifest newer than a fresh v4 run', async () => {
    await saveManifest({
      analyzedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    await fs.writeFile(
      join(ROOT, '.ptah', 'analysis', 'newer-v2', 'manifest.json'),
      JSON.stringify({ version: 2, analyzedAt: NOW.toISOString() }),
    );
    jest.clearAllMocks();
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'fresh',
      reason: 'ok',
      analysisDir: REL_DIR,
    });
    expectNoWrites();
  });

  it('ignores an archived v3 folder even when its manifest is newer', async () => {
    const manifest = await saveManifest();
    const archive = join(ROOT, '.ptah', 'analysis', 'demo-v3-archive-1');
    await fs.writeFile(
      join(archive, 'manifest.json'),
      JSON.stringify({
        ...manifest,
        analyzedAt: new Date(NOW.getTime() + 60_000).toISOString(),
      }),
    );
    jest.clearAllMocks();
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'fresh',
      reason: 'ok',
      analysisDir: REL_DIR,
    });
    expectNoWrites();
  });

  it('qualifies a v4 fallback beside an older v3 folder', async () => {
    const manifest = await saveManifest();
    const fallback = `${DIR}--v4`;
    const phases = Object.fromEntries(
      IDS.map((id) => [
        id,
        { status: 'completed', file: manifest.phases[id].file, durationMs: 1 },
      ]),
    );
    const { workspaceFingerprint: _fingerprint, ...common } = manifest;
    await fs.writeFile(
      join(DIR, 'manifest.json'),
      JSON.stringify({
        ...common,
        version: 3,
        analyzedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        phases,
      }),
    );
    await fs.writeFile(
      join(fallback, 'manifest.json'),
      JSON.stringify({ ...manifest, slug: 'demo--v4' }),
    );
    for (const id of IDS)
      await fs.writeFileBytes(join(fallback, manifest.phases[id].file), OUTPUT);
    jest.clearAllMocks();
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'fresh',
      reason: 'ok',
      analysisDir: '.ptah/analysis/demo--v4',
    });
    expectNoWrites();
  });

  it('reports a legacy v3 run', async () => {
    const v4 = await saveManifest();
    const phases = Object.fromEntries(
      IDS.map((id) => [
        id,
        {
          status: 'completed',
          file: v4.phases[id].file,
          durationMs: 1,
        },
      ]),
    );
    const { workspaceFingerprint: _fingerprint, ...common } = v4;
    await fs.writeFile(
      join(DIR, 'manifest.json'),
      JSON.stringify({ ...common, version: 3, phases }),
    );
    jest.clearAllMocks();
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'stale',
      reason: 'legacy-v3',
      analysisDir: REL_DIR,
    });
    expectNoWrites();
  });

  it('reports an incomplete run', async () => {
    await saveManifest({ lifecycle: 'paused' });
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'stale',
      reason: 'incomplete',
    });
    expectNoWrites();
  });

  it('accepts the exact age boundary and expires one millisecond past it', async () => {
    const manifest = await saveManifest({
      updatedAt: new Date(NOW.getTime() - ANALYSIS_MAX_AGE_MS).toISOString(),
    });
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'fresh',
      reason: 'ok',
    });
    manifest.updatedAt = new Date(
      NOW.getTime() - ANALYSIS_MAX_AGE_MS - 1,
    ).toISOString();
    await fs.writeFile(join(DIR, 'manifest.json'), JSON.stringify(manifest));
    jest.clearAllMocks();
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'stale',
      reason: 'expired',
    });
    expectNoWrites();
  });

  it('detects changed workspace metadata', async () => {
    await saveManifest();
    await fs.writeFile(join(ROOT, 'pnpm-lock.yaml'), 'lock: two');
    jest.clearAllMocks();
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'stale',
      reason: 'workspace-changed',
    });
    expectNoWrites();
  });

  it('detects changed or missing phase output', async () => {
    await saveManifest();
    await fs.writeFile(join(DIR, '1-project-profile.md'), 'tampered');
    jest.clearAllMocks();
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'stale',
      reason: 'output-mismatch',
    });
    expectNoWrites();
    await fs.delete(join(DIR, '1-project-profile.md'));
    jest.clearAllMocks();
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'stale',
      reason: 'output-mismatch',
    });
    expectNoWrites();
  });

  it('reports a rejected v2 manifest with no valid run as unreadable', async () => {
    await fs.writeFile(
      join(DIR, 'manifest.json'),
      JSON.stringify({ version: 2, analyzedAt: NOW.toISOString() }),
    );
    jest.clearAllMocks();
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'stale',
      reason: 'unreadable',
      analysisDir: REL_DIR,
    });
    expectNoWrites();
  });

  it('reports filesystem read errors as unreadable', async () => {
    await saveManifest();
    fs.readFileBytes.mockRejectedValueOnce(new Error('I/O failure'));
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'stale',
      reason: 'unreadable',
      analysisDir: '.ptah/analysis',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[AnalysisFreshness]'),
      expect.objectContaining({
        errorName: 'Error',
        errorMessage: 'I/O failure',
      }),
    );
    expectNoWrites();
  });

  it('reports manifest read errors as unreadable', async () => {
    await saveManifest();
    fs.readFile.mockRejectedValueOnce(new Error('I/O failure'));
    expect(await service.getStatus(ROOT)).toMatchObject({
      state: 'stale',
      reason: 'unreadable',
    });
    expectNoWrites();
  });

  it('fingerprints independent of directory order, but tracks lockfile bytes', async () => {
    const original = await computeWorkspaceFingerprint(ROOT, fs);
    const readDirectory = fs.readDirectory.getMockImplementation();
    fs.readDirectory.mockImplementation(async (path) =>
      (await readDirectory!(path)).reverse(),
    );
    expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).toBe(
      original.digest,
    );
    await fs.writeFile(join(ROOT, 'pnpm-lock.yaml'), 'lock: changed');
    expect((await computeWorkspaceFingerprint(ROOT, fs)).digest).not.toBe(
      original.digest,
    );
  });
});
