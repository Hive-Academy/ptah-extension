/**
 * AnalysisRunCheckpoint — durable lifecycle bookkeeping for one analysis run.
 *
 * Owns the in-memory version-3 manifest for a multi-phase analysis and
 * persists it through `AnalysisStorageService` on every lifecycle transition:
 * before the first phase, on `pending -> running`, after every terminal
 * transition, and when the run pauses or finishes.
 *
 * `MultiPhaseAnalysisService` composes one of these per run and stays the
 * public facade; this class knows nothing about the SDK stream.
 */

import { ulid } from 'ulid';
import type { AnalysisStorageService } from '../analysis-storage.service';
import {
  PHASE_CONFIGS,
  type AnalysisPhaseStatus,
  type MultiPhaseId,
  type MultiPhaseManifest,
  type PhaseResult,
} from '../../types/multi-phase.types';

/** Per-phase status snapshot in pipeline order, for progress broadcasts. */
export type PhaseStatusSnapshot = Array<{
  id: MultiPhaseId;
  status: AnalysisPhaseStatus;
}>;

export class AnalysisRunCheckpoint {
  private readonly sessionStart = Date.now();
  private readonly baseDurationMs: number;

  private constructor(
    private readonly storage: AnalysisStorageService,
    /** Absolute slug directory holding the manifest and phase files. */
    readonly slugDir: string,
    /** The live manifest. Mutated in place, persisted by this class only. */
    readonly manifest: MultiPhaseManifest,
    /** True when this run continues a persisted manifest. */
    readonly resumed: boolean,
  ) {
    this.baseDurationMs = manifest.totalDurationMs;
  }

  /**
   * Open a checkpoint for a run.
   *
   * With `resume === true` the existing version-3 manifest of the slug is
   * loaded without deleting anything: stale `running` phases go back to
   * `pending` and the lifecycle returns to `running`. When no resumable
   * manifest exists (missing, malformed, version 2, or already completed),
   * the run falls back to a FRESH run: the slug directory is recreated and a
   * new `runId` is minted. The manifest is persisted before this returns, so
   * a persistence failure surfaces before any SDK work starts.
   */
  static async open(
    storage: AnalysisStorageService,
    workspacePath: string,
    projectDescription: string,
    model: string,
    resume: boolean,
  ): Promise<AnalysisRunCheckpoint> {
    if (resume) {
      const { slugDir } = await storage.ensureSlugDir(
        workspacePath,
        projectDescription,
      );
      const existing = await storage.loadManifest(slugDir);
      if (existing && existing.lifecycle !== 'completed') {
        for (const phase of Object.values(existing.phases)) {
          if (phase.status === 'running') phase.status = 'pending';
        }
        existing.lifecycle = 'running';
        const checkpoint = new AnalysisRunCheckpoint(
          storage,
          slugDir,
          existing,
          true,
        );
        await checkpoint.persist();
        return checkpoint;
      }
    }

    const { slugDir, slug } = await storage.createSlugDir(
      workspacePath,
      projectDescription,
    );
    const now = new Date().toISOString();
    const phases = {} as Record<MultiPhaseId, PhaseResult>;
    for (const config of PHASE_CONFIGS) {
      phases[config.id] = {
        status: 'pending',
        file: config.file,
        durationMs: 0,
      };
    }
    const manifest: MultiPhaseManifest = {
      version: 3,
      runId: ulid(),
      slug,
      analyzedAt: now,
      updatedAt: now,
      lifecycle: 'running',
      model,
      totalDurationMs: 0,
      phases,
    };
    const checkpoint = new AnalysisRunCheckpoint(
      storage,
      slugDir,
      manifest,
      false,
    );
    await checkpoint.persist();
    return checkpoint;
  }

  /** Whether a phase already reached `completed` (skipped on resume). */
  isCompleted(id: MultiPhaseId): boolean {
    return this.manifest.phases[id]?.status === 'completed';
  }

  /** Phase statuses in pipeline order. */
  statuses(): PhaseStatusSnapshot {
    return PHASE_CONFIGS.map((config) => ({
      id: config.id,
      status: this.manifest.phases[config.id]?.status ?? 'pending',
    }));
  }

  /** `pending -> running` for one phase. */
  async markRunning(id: MultiPhaseId): Promise<void> {
    const phase = this.phase(id);
    phase.status = 'running';
    delete phase.error;
    await this.persist();
  }

  /** Terminal `completed` for one phase. */
  async markCompleted(id: MultiPhaseId, durationMs: number): Promise<void> {
    const phase = this.phase(id);
    phase.status = 'completed';
    phase.durationMs = durationMs;
    delete phase.error;
    await this.persist();
  }

  /**
   * Terminal `failed` for one phase. The error is always non-empty because
   * the manifest schema refuses a failed phase without one.
   */
  async markFailed(
    id: MultiPhaseId,
    durationMs: number,
    error: string,
  ): Promise<void> {
    const phase = this.phase(id);
    phase.status = 'failed';
    phase.durationMs = durationMs;
    phase.error =
      error.trim().length > 0 ? error : 'Phase failed without an error message';
    await this.persist();
  }

  /**
   * User pause. The active phase returns to `pending` with its partial file
   * left in place; later phases stay `pending`; the run is `paused`.
   */
  async pause(activeId: MultiPhaseId | null): Promise<void> {
    if (activeId) {
      const phase = this.phase(activeId);
      phase.status = 'pending';
      delete phase.error;
    }
    this.manifest.lifecycle = 'paused';
    await this.persist();
  }

  /**
   * The pipeline ran to its end: `completed` when every phase completed,
   * otherwise `failed` (a later resume re-runs the non-completed phases).
   */
  async finish(): Promise<void> {
    const allCompleted = PHASE_CONFIGS.every(
      (config) => this.manifest.phases[config.id]?.status === 'completed',
    );
    this.manifest.lifecycle = allCompleted ? 'completed' : 'failed';
    await this.persist();
  }

  private phase(id: MultiPhaseId): PhaseResult {
    const existing = this.manifest.phases[id];
    if (existing) return existing;
    const config = PHASE_CONFIGS.find((c) => c.id === id);
    const created: PhaseResult = {
      status: 'pending',
      file: config?.file ?? `${id}.md`,
      durationMs: 0,
    };
    this.manifest.phases[id] = created;
    return created;
  }

  private async persist(): Promise<void> {
    this.manifest.updatedAt = new Date().toISOString();
    this.manifest.totalDurationMs =
      this.baseDurationMs + (Date.now() - this.sessionStart);
    await this.storage.writeManifest(this.slugDir, this.manifest);
  }
}
