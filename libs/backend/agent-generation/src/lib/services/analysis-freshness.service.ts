import { isAbsolute, join, relative } from 'path';
import { inject, injectable } from 'tsyringe';
import {
  FileType,
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import type { AnalysisStatus } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';
import { PHASE_CONFIGS } from '../types/multi-phase.types';
import { computeWorkspaceFingerprint, sha256Hex } from './analysis-fingerprint';
import {
  AnalysisStorageService,
  isLegacyArchiveDirName,
  type ManifestReadResult,
} from './analysis-storage.service';

export const ANALYSIS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_TAG = '[AnalysisFreshness]';
type LatestRun = {
  dir: string;
  analyzedAtMs: number;
  read: ManifestReadResult;
};
type RejectedRun = { rejectedDir: string };

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/** Reads analysis freshness without writing; returned paths are workspace-relative. */
@injectable()
export class AnalysisFreshnessService {
  constructor(
    @inject(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE)
    private readonly storage: AnalysisStorageService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  /** Report status with workspace-relative analysisDir and '/' separators. */
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
    const relativeDir = (dir: string): string =>
      relative(workspaceRoot, dir).replace(/\\/g, '/');
    try {
      const latest = await this.findLatestRun(analysisRoot);
      if (!latest) return status('missing', 'no-analysis');
      if ('rejectedDir' in latest)
        return status('stale', 'unreadable', relativeDir(latest.rejectedDir));
      const result = await this.qualify(latest, workspaceRoot, checkedAt);
      return status(
        result.state,
        result.reason,
        relativeDir(latest.dir),
        latest.read.manifest.analyzedAt,
      );
    } catch (error) {
      this.logger.warn(
        `${SERVICE_TAG} Could not determine analysis freshness`,
        {
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error),
          analysisRoot,
        },
      );
      return status('stale', 'unreadable', '.ptah/analysis');
    }
  }

  private async findLatestRun(
    analysisRoot: string,
  ): Promise<LatestRun | RejectedRun | null> {
    let entries;
    try {
      entries = await this.fs.readDirectory(analysisRoot);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    let latest: LatestRun | null = null;
    let rejectedDir: string | null = null;
    for (const entry of entries) {
      if (
        entry.type !== FileType.Directory ||
        isLegacyArchiveDirName(entry.name)
      )
        continue;
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
        this.logger.debug(`${SERVICE_TAG} Manifest rejected`, { dir });
        continue;
      }
      const analyzedAtMs = Date.parse(read.manifest.analyzedAt);
      if (!Number.isFinite(analyzedAtMs)) {
        rejectedDir ??= dir;
        this.logger.debug(
          `${SERVICE_TAG} Manifest rejected: invalid analyzedAt`,
          { dir },
        );
        continue;
      }
      if (!latest || analyzedAtMs > latest.analyzedAtMs) {
        latest = { dir, analyzedAtMs, read };
      }
    }
    return latest ?? (rejectedDir ? { rejectedDir } : null);
  }

  private async qualify(
    latest: LatestRun,
    workspaceRoot: string,
    checkedAt: string,
  ): Promise<Pick<AnalysisStatus, 'state' | 'reason'>> {
    const { dir, read } = latest;
    if (read.kind === 'legacy-v3')
      return { state: 'stale', reason: 'legacy-v3' };
    const manifest = read.manifest;
    if (
      manifest.lifecycle !== 'completed' ||
      PHASE_CONFIGS.some(({ id }) => {
        const phase = manifest.phases[id];
        return (
          !phase ||
          phase.status !== 'completed' ||
          phase.verification.status !== 'verified' ||
          !phase.verification.outputSha256
        );
      })
    )
      return { state: 'stale', reason: 'incomplete' };

    const updatedAtMs = Date.parse(manifest.updatedAt);
    const age = Date.parse(checkedAt) - updatedAtMs;
    if (!Number.isFinite(age) || age < 0)
      return { state: 'stale', reason: 'unreadable' };
    if (age > ANALYSIS_MAX_AGE_MS) return { state: 'stale', reason: 'expired' };

    const fingerprint = await computeWorkspaceFingerprint(
      workspaceRoot,
      this.fs,
    );
    if (fingerprint.digest !== manifest.workspaceFingerprint.digest) {
      return { state: 'stale', reason: 'workspace-changed' };
    }
    for (const { id } of PHASE_CONFIGS) {
      const phase = manifest.phases[id];
      if (
        !phase.file ||
        phase.file === '.' ||
        phase.file === '..' ||
        isAbsolute(phase.file) ||
        /[/\\]/.test(phase.file)
      ) {
        return { state: 'stale', reason: 'output-mismatch' };
      }
      let bytes: Uint8Array;
      try {
        bytes = await this.fs.readFileBytes(join(dir, phase.file));
      } catch (error) {
        if (isMissing(error))
          return { state: 'stale', reason: 'output-mismatch' };
        throw error;
      }
      if (sha256Hex(bytes) !== phase.verification.outputSha256) {
        return { state: 'stale', reason: 'output-mismatch' };
      }
    }
    return { state: 'fresh', reason: 'ok' };
  }
}
