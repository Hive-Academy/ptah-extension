import { createHash } from 'crypto';
import { isAbsolute, join } from 'path';
import { inject, injectable } from 'tsyringe';
import {
  FileType,
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import type {
  AnalysisStatus,
  WorkspaceFingerprint,
} from '@ptah-extension/shared';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';
import type { MultiPhaseId } from '../types/multi-phase.types';
import { AnalysisStorageService } from './analysis-storage.service';

export const ANALYSIS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const ROOT_METADATA_FILES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'pyproject.toml',
  'poetry.lock',
  'uv.lock',
  'Pipfile',
  'Pipfile.lock',
  'requirements.txt',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
  'deno.json',
  'deno.jsonc',
  'deno.lock',
]);
const EXCLUDED_TOP_LEVEL_NAMES = new Set([
  '.ptah',
  '.git',
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.nx',
  '.turbo',
  '.cache',
  '.yarn',
  '.pnpm-store',
]);
const PHASE_IDS: MultiPhaseId[] = [
  'project-profile',
  'architecture-assessment',
  'quality-audit',
  'elevation-plan',
];

function hashPart(
  hash: ReturnType<typeof createHash>,
  value: Uint8Array,
): void {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(value.byteLength);
  hash.update(length);
  hash.update(value);
}

/** Hash bounded root metadata without walking dependency or generated trees. */
export async function computeWorkspaceFingerprint(
  workspaceRoot: string,
  fs: IFileSystemProvider,
): Promise<WorkspaceFingerprint> {
  const entries = (await fs.readDirectory(workspaceRoot))
    .filter((entry) => !EXCLUDED_TOP_LEVEL_NAMES.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const hash = createHash('sha256');
  hash.update('sha256-v1\0');
  for (const entry of entries) {
    hashPart(hash, Buffer.from(entry.name, 'utf8'));
    hashPart(hash, Buffer.from(String(entry.type), 'utf8'));
    if (entry.type === FileType.File && ROOT_METADATA_FILES.has(entry.name)) {
      hashPart(hash, await fs.readFileBytes(join(workspaceRoot, entry.name)));
    }
  }
  return {
    algorithm: 'sha256-v1',
    digest: hash.digest('hex'),
    capturedAt: new Date().toISOString(),
  };
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

@injectable()
export class AnalysisFreshnessService {
  constructor(
    @inject(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE)
    private readonly storage: AnalysisStorageService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
  ) {}

  async getStatus(workspaceRoot: string | null): Promise<AnalysisStatus> {
    const checkedAt = new Date().toISOString();
    const status = (
      state: AnalysisStatus['state'],
      reason: AnalysisStatus['reason'],
      analysisDir: string | null = null,
      analyzedAt: string | null = null,
    ): AnalysisStatus => ({
      state,
      reason,
      analysisDir,
      checkedAt,
      analyzedAt,
    });
    if (!workspaceRoot) return status('missing', 'no-analysis');

    const analysisRoot = this.storage.getAnalysisDir(workspaceRoot);
    try {
      let entries;
      try {
        entries = await this.fs.readDirectory(analysisRoot);
      } catch (error) {
        if (isMissing(error)) return status('missing', 'no-analysis');
        throw error;
      }
      let latest: {
        dir: string;
        analyzedAtMs: number;
        manifest: NonNullable<
          Awaited<ReturnType<AnalysisStorageService['readManifest']>>
        >;
      } | null = null;
      let rejectedDir: string | null = null;
      for (const entry of entries) {
        if (entry.type !== FileType.Directory) continue;
        const dir = join(analysisRoot, entry.name);
        const manifestPath = join(dir, 'manifest.json');
        try {
          await this.fs.readFile(manifestPath);
        } catch (error) {
          if (isMissing(error)) continue;
          throw error;
        }
        const read = await this.storage.readManifest(dir);
        if (!read) {
          try {
            await this.fs.readFileBytes(manifestPath);
          } catch (error) {
            if (isMissing(error)) continue;
            throw error;
          }
          rejectedDir ??= dir;
          continue;
        }
        const analyzedAtMs = Date.parse(read.manifest.analyzedAt);
        if (!Number.isFinite(analyzedAtMs)) {
          rejectedDir ??= dir;
          continue;
        }
        if (!latest || analyzedAtMs > latest.analyzedAtMs) {
          latest = { dir, analyzedAtMs, manifest: read };
        }
      }
      if (!latest) {
        return rejectedDir
          ? status('stale', 'unreadable', rejectedDir)
          : status('missing', 'no-analysis');
      }
      const { dir, manifest: read } = latest;
      const analyzedAt = read.manifest.analyzedAt;
      if (read.kind === 'legacy-v3')
        return status('stale', 'legacy-v3', dir, analyzedAt);
      const manifest = read.manifest;
      if (
        manifest.lifecycle !== 'completed' ||
        PHASE_IDS.some((id) => {
          const phase = manifest.phases[id];
          return (
            !phase ||
            phase.status !== 'completed' ||
            phase.verification.status !== 'verified' ||
            !phase.verification.outputSha256
          );
        })
      )
        return status('stale', 'incomplete', dir, analyzedAt);

      const updatedAtMs = Date.parse(manifest.updatedAt);
      const age = Date.parse(checkedAt) - updatedAtMs;
      if (!Number.isFinite(age) || age < 0)
        return status('stale', 'unreadable', dir, analyzedAt);
      if (age > ANALYSIS_MAX_AGE_MS)
        return status('stale', 'expired', dir, analyzedAt);

      const fingerprint = await computeWorkspaceFingerprint(
        workspaceRoot,
        this.fs,
      );
      if (fingerprint.digest !== manifest.workspaceFingerprint.digest) {
        return status('stale', 'workspace-changed', dir, analyzedAt);
      }
      for (const id of PHASE_IDS) {
        const phase = manifest.phases[id];
        if (
          !phase.file ||
          phase.file === '.' ||
          phase.file === '..' ||
          isAbsolute(phase.file) ||
          /[/\\]/.test(phase.file)
        ) {
          return status('stale', 'output-mismatch', dir, analyzedAt);
        }
        let bytes: Uint8Array;
        try {
          bytes = await this.fs.readFileBytes(join(dir, phase.file));
        } catch (error) {
          if (isMissing(error))
            return status('stale', 'output-mismatch', dir, analyzedAt);
          throw error;
        }
        if (
          createHash('sha256').update(bytes).digest('hex') !==
          phase.verification.outputSha256
        ) {
          return status('stale', 'output-mismatch', dir, analyzedAt);
        }
      }
      return status('fresh', 'ok', dir, analyzedAt);
    } catch {
      return status('stale', 'unreadable', analysisRoot);
    }
  }
}
