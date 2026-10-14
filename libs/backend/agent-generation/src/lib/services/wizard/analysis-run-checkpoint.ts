/** Durable v4 lifecycle and verification for one multi-phase analysis run. */
import { randomUUID } from 'crypto';
import { join } from 'path';
import { ulid } from 'ulid';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  AnalysisStorageService,
  LegacyRunArchiveError,
} from '../analysis-storage.service';
import {
  computeWorkspaceFingerprint,
  hashFileOrNull,
  sha256Hex,
} from '../analysis-fingerprint';
import {
  MultiPhaseManifestV4Schema,
  PHASE_CONFIGS,
  type AnalysisPhaseStatus,
  type MultiPhaseId,
  type MultiPhaseManifestV4,
  type PhaseResultV4,
} from '../../types/multi-phase.types';

export type PhaseStatusSnapshot = Array<{
  id: MultiPhaseId;
  status: AnalysisPhaseStatus;
}>;
export type PhaseInput = NonNullable<PhaseResultV4['input']>;

const pendingVerification = (): PhaseResultV4['verification'] => ({
  status: 'pending',
  outputSha256: null,
  checkedAt: null,
});

export class AnalysisRunCheckpoint {
  private readonly sessionStart = Date.now();
  private readonly baseDurationMs: number;

  private constructor(
    private readonly storage: AnalysisStorageService,
    private readonly fs: IFileSystemProvider,
    readonly slugDir: string,
    readonly manifest: MultiPhaseManifestV4,
    readonly resumed: boolean,
  ) {
    this.baseDurationMs = manifest.totalDurationMs;
  }

  /** Open a run, pinning resume to the requested model because SDK sessions are model-specific. */
  static async open(
    storage: AnalysisStorageService,
    fs: IFileSystemProvider,
    logger: Logger,
    workspacePath: string,
    projectDescription: string,
    model: string,
    resume: boolean,
  ): Promise<AnalysisRunCheckpoint> {
    let fingerprint: MultiPhaseManifestV4['workspaceFingerprint'];
    try {
      fingerprint = await computeWorkspaceFingerprint(workspacePath, fs);
    } catch (error) {
      // degradation-audit: optional-capability - a random digest cannot match a future workspace fingerprint.
      logger.warn(
        'Workspace fingerprint failed; starting an unverified analysis run',
        error,
      );
      fingerprint = {
        algorithm: 'sha256-v1',
        digest: sha256Hex(randomUUID()),
        capturedAt: new Date().toISOString(),
      };
    }
    const { slugDir } = storage.getRunDir(workspacePath, projectDescription);
    const existing = await storage.readManifest(slugDir);
    let variant: 'primary' | 'legacy-fallback' = 'primary';
    if (existing?.kind === 'legacy-v3') {
      try {
        await storage.archiveLegacyRun(workspacePath, slugDir);
      } catch (error) {
        // degradation-audit: optional-capability - preserve the legacy bytes and use a separate v4 folder.
        logger.warn(
          'Legacy analysis archive failed; using v4 fallback directory',
          {
            error: error instanceof Error ? error.message : String(error),
            archiveDir:
              error instanceof LegacyRunArchiveError ? error.archiveDir : null,
          },
        );
        variant = 'legacy-fallback';
      }
    }
    const fallbackDir = storage.getRunDir(
      workspacePath,
      projectDescription,
      'legacy-fallback',
    ).slugDir;
    const fallback = resume ? await storage.readManifest(fallbackDir) : null;
    const primaryResumable =
      existing?.kind === 'current' &&
      existing.manifest.lifecycle !== 'completed' &&
      existing.manifest.model === model;
    const fallbackResumable =
      fallback?.kind === 'current' &&
      fallback.manifest.lifecycle !== 'completed' &&
      fallback.manifest.model === model;
    const resumeDir =
      variant === 'primary' && primaryResumable ? slugDir : fallbackDir;
    const resumable = resumeDir === slugDir ? existing : fallback;
    if (
      resume &&
      resumable?.kind === 'current' &&
      resumable.manifest.lifecycle !== 'completed' &&
      resumable.manifest.model === model
    ) {
      variant = resumeDir === slugDir ? 'primary' : 'legacy-fallback';
      const manifest = resumable.manifest;
      for (const phase of Object.values(manifest.phases)) {
        if (phase.status === 'running') phase.status = 'pending';
      }
      manifest.workspaceFingerprint = fingerprint;
      manifest.lifecycle = 'running';
      const checkpoint = new AnalysisRunCheckpoint(
        storage,
        fs,
        resumeDir,
        manifest,
        true,
      );
      await checkpoint.persist();
      return checkpoint;
    }

    if (variant === 'primary' && !primaryResumable && fallbackResumable) {
      variant = 'legacy-fallback';
    }

    const created = await storage.createSlugDir(
      workspacePath,
      projectDescription,
      variant,
    );
    const now = new Date().toISOString();
    const phases = {} as Record<MultiPhaseId, PhaseResultV4>;
    for (const config of PHASE_CONFIGS) {
      phases[config.id] = {
        status: 'pending',
        file: config.file,
        durationMs: 0,
        attempt: 0,
        sessionId: null,
        input: null,
        verification: pendingVerification(),
      };
    }
    const manifest: MultiPhaseManifestV4 = {
      version: 4,
      runId: ulid(),
      slug: created.slug,
      analyzedAt: now,
      updatedAt: now,
      lifecycle: 'running',
      model,
      totalDurationMs: 0,
      workspaceFingerprint: fingerprint,
      phases,
    };
    const checkpoint = new AnalysisRunCheckpoint(
      storage,
      fs,
      created.slugDir,
      manifest,
      false,
    );
    await checkpoint.persist();
    return checkpoint;
  }

  /** Capture the inputs whose bytes must match before a completed phase is reused. */
  input(promptSha256: string, priorPhaseSha256: string | null): PhaseInput {
    return {
      workspaceSha256: this.manifest.workspaceFingerprint.digest,
      promptSha256,
      priorPhaseSha256,
      model: this.manifest.model,
    };
  }

  /** A mismatch invalidates this phase and every dependent phase. */
  async isCompleted(id: MultiPhaseId, input: PhaseInput): Promise<boolean> {
    const phase = this.manifest.phases[id];
    if (phase.status !== 'completed') return false;
    const config = PHASE_CONFIGS.find((candidate) => candidate.id === id);
    const outputSha256 =
      phase.file === config?.file
        ? await hashFileOrNull(this.fs, join(this.slugDir, phase.file))
        : null;
    if (
      phase.input?.workspaceSha256 === input.workspaceSha256 &&
      phase.input.promptSha256 === input.promptSha256 &&
      phase.input.priorPhaseSha256 === input.priorPhaseSha256 &&
      phase.input.model === input.model &&
      phase.verification.status === 'verified' &&
      outputSha256 !== null &&
      phase.verification.outputSha256 === outputSha256
    )
      return true;

    const first = PHASE_CONFIGS.findIndex((candidate) => candidate.id === id);
    for (const config of PHASE_CONFIGS.slice(first)) {
      const descendant = this.manifest.phases[config.id];
      descendant.status = 'pending';
      descendant.file = config.file;
      descendant.sessionId = null;
      descendant.input = null;
      descendant.verification = pendingVerification();
      delete descendant.error;
    }
    await this.persist();
    return false;
  }

  /** Return phase statuses in pipeline order. */
  statuses(): PhaseStatusSnapshot {
    return PHASE_CONFIGS.map((config) => ({
      id: config.id,
      status: this.manifest.phases[config.id].status,
    }));
  }

  /** Persist the start of a phase attempt. */
  async markRunning(id: MultiPhaseId, input: PhaseInput): Promise<void> {
    const phase = this.manifest.phases[id];
    phase.attempt += 1;
    phase.status = 'running';
    phase.sessionId = null;
    phase.input = input;
    phase.verification = pendingVerification();
    delete phase.error;
    await this.persist();
  }

  /** Persist a phase's verified output and SDK session. */
  async markCompleted(
    id: MultiPhaseId,
    durationMs: number,
    sessionId: string,
    outputSha256: string,
  ): Promise<void> {
    const phase = this.manifest.phases[id];
    phase.status = 'completed';
    phase.durationMs = durationMs;
    phase.sessionId = sessionId;
    phase.verification = {
      status: 'verified',
      outputSha256,
      checkedAt: new Date().toISOString(),
    };
    delete phase.error;
    await this.persist();
  }

  /** Persist a phase failure with its diagnostic text. */
  async markFailed(
    id: MultiPhaseId,
    durationMs: number,
    error: string,
    sessionId: string | null = null,
  ): Promise<void> {
    const phase = this.manifest.phases[id];
    phase.status = 'failed';
    phase.durationMs = durationMs;
    phase.sessionId = sessionId;
    phase.verification = {
      status: 'failed',
      outputSha256: null,
      checkedAt: new Date().toISOString(),
    };
    phase.error = error.trim() || 'Phase failed without an error message';
    await this.persist();
  }

  /** Pause an interrupted run and reset its active phase for retry. */
  async pause(activeId: MultiPhaseId | null): Promise<void> {
    if (activeId) {
      const phase = this.manifest.phases[activeId];
      phase.status = 'pending';
      delete phase.error;
    }
    this.manifest.lifecycle = 'paused';
    await this.persist();
  }

  /** Set the run lifecycle from its completed phase statuses. */
  async finish(): Promise<void> {
    this.manifest.lifecycle = PHASE_CONFIGS.every(
      (config) => this.manifest.phases[config.id].status === 'completed',
    )
      ? 'completed'
      : 'failed';
    await this.persist();
  }

  private async persist(): Promise<void> {
    this.manifest.updatedAt = new Date().toISOString();
    this.manifest.totalDurationMs =
      this.baseDurationMs + (Date.now() - this.sessionStart);
    await this.storage.writeManifest(
      this.slugDir,
      MultiPhaseManifestV4Schema.parse(this.manifest),
    );
  }
}
