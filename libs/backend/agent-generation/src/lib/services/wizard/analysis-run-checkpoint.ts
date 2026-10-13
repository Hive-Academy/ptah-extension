/** Durable v4 lifecycle and verification for one multi-phase analysis run. */
import { createHash } from 'crypto';
import { join } from 'path';
import { ulid } from 'ulid';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type { AnalysisStorageService } from '../analysis-storage.service';
import { computeWorkspaceFingerprint } from '../analysis-freshness.service';
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

  /** Persist before returning so archive or checkpoint failures precede SDK work. */
  static async open(
    storage: AnalysisStorageService,
    fs: IFileSystemProvider,
    workspacePath: string,
    projectDescription: string,
    model: string,
    resume: boolean,
  ): Promise<AnalysisRunCheckpoint> {
    const fingerprint = await computeWorkspaceFingerprint(workspacePath, fs);
    const { slugDir } = await storage.ensureSlugDir(
      workspacePath,
      projectDescription,
    );
    const existing = await storage.readManifest(slugDir);
    if (existing?.kind === 'legacy-v3') {
      await storage.archiveLegacyRun(workspacePath, slugDir);
    } else if (
      resume &&
      existing?.kind === 'current' &&
      existing.manifest.lifecycle !== 'completed' &&
      existing.manifest.model === model
    ) {
      const manifest = existing.manifest;
      for (const phase of Object.values(manifest.phases)) {
        if (phase.status === 'running') phase.status = 'pending';
      }
      manifest.workspaceFingerprint = fingerprint;
      manifest.lifecycle = 'running';
      const checkpoint = new AnalysisRunCheckpoint(
        storage,
        fs,
        slugDir,
        manifest,
        true,
      );
      await checkpoint.persist();
      return checkpoint;
    }

    const created = await storage.createSlugDir(
      workspacePath,
      projectDescription,
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
    let outputSha256: string | null = null;
    if (phase.file === config?.file) {
      try {
        outputSha256 = createHash('sha256')
          .update(await this.fs.readFileBytes(join(this.slugDir, phase.file)))
          .digest('hex');
      } catch {
        // An absent or unreadable output cannot be trusted for resume.
      }
    }
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

  statuses(): PhaseStatusSnapshot {
    return PHASE_CONFIGS.map((config) => ({
      id: config.id,
      status: this.manifest.phases[config.id].status,
    }));
  }

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

  async pause(activeId: MultiPhaseId | null): Promise<void> {
    if (activeId) {
      const phase = this.manifest.phases[activeId];
      phase.status = 'pending';
      delete phase.error;
    }
    this.manifest.lifecycle = 'paused';
    await this.persist();
  }

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
