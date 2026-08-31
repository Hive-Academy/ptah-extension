/**
 * GenerationCheckpointService — the wizard generation handler's view of the
 * durable generation checkpoint.
 *
 * `AnalysisStorageService` (agent-generation) owns the file: its path, its
 * Zod validation and every byte written. This service owns the RUN-LEVEL
 * decisions the handler needs on top of that file:
 *
 * - a fresh run gets a manifest BEFORE any orchestrator work starts;
 * - a resumed run re-runs only `pending | running | failed` agents and carries
 *   `written | unchanged` files forward untouched;
 * - a checkpoint whose paths point outside the workspace is never resumed;
 * - a checkpoint that cannot be updated after an outcome stops the run rather
 *   than letting later agents proceed unrecorded.
 *
 * Nothing here deletes a checkpoint. A paused or timed-out run stays
 * discoverable until a later run completes it.
 */

import { randomUUID } from 'node:crypto';
import * as path from 'path';
import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  isPathWithinRoots,
} from '@ptah-extension/platform-core';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import type {
  AnalysisStorageService,
  GenerationAgentCheckpoint,
  GenerationCheckpointManifest,
} from '@ptah-extension/agent-generation';
import type {
  GenerationAgentOutcome,
  ResumableGenerationRun,
} from '@ptah-extension/shared';

/** Where a run's checkpoint lives: beside its analysis slug, or in the root. */
export interface GenerationCheckpointLocation {
  workspaceRoot: string;
  /** Canonical absolute analysis slug directory, or null for a slug-less run. */
  analysisDir: string | null;
}

/** Inputs persisted with a fresh run so a resume needs no frontend memory. */
export interface FreshGenerationRun {
  workspaceRoot: string;
  analysisDir: string | null;
  analysisRunId?: string;
  selectedAgentIds: string[];
  input: GenerationCheckpointManifest['input'];
}

/** What the handler launches after a checkpoint was created or resumed. */
export interface PreparedGenerationRun {
  location: GenerationCheckpointLocation;
  manifest: GenerationCheckpointManifest;
  /** Agents the orchestrator must (re)run in this invocation. */
  agentIds: string[];
  /**
   * Agents skipped on resume because their file is already current. They are
   * reported as `unchanged` in this invocation's completion payload; their
   * checkpoint records keep the status the earlier run recorded.
   */
  carriedOver: GenerationAgentOutcome[];
}

const RESUMABLE_STATUSES: ReadonlySet<GenerationAgentCheckpoint['status']> =
  new Set(['pending', 'running', 'failed']);

/** Read-only wire DTO for a persisted generation checkpoint. */
export function toResumableGenerationRun(
  manifest: GenerationCheckpointManifest,
): ResumableGenerationRun {
  return {
    runId: manifest.runId,
    analysisDirectory: manifest.analysisDirectory ?? null,
    outputDirectory: manifest.outputDirectory,
    lifecycle: manifest.lifecycle,
    selectedAgentIds: [...manifest.selectedAgentIds],
    agents: Object.values(manifest.agents).map((agent) => ({ ...agent })),
  };
}

/** Whether any selected agent still has work a resume would pick up. */
export function hasResumableAgentWork(
  manifest: GenerationCheckpointManifest,
): boolean {
  return Object.values(manifest.agents).some((agent) =>
    RESUMABLE_STATUSES.has(agent.status),
  );
}

@injectable()
export class GenerationCheckpointService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly container: DependencyContainer,
  ) {}

  /** The directory the orchestrator writes agent files into. */
  outputDirectoryFor(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.claude', 'agents');
  }

  /**
   * Canonicalize a caller-supplied analysis directory against the workspace.
   * Returns null when it escapes `<workspace>/.ptah/analysis`.
   */
  resolveAuthorizedAnalysisDir(
    workspaceRoot: string,
    candidate: string,
  ): string | null {
    return this.storage().resolveAuthorizedAnalysisDir(
      workspaceRoot,
      candidate,
    );
  }

  /**
   * Persist the manifest for a fresh run. Every selected agent starts
   * `pending`. Throws when the write fails, so the caller starts no work.
   */
  async createFresh(run: FreshGenerationRun): Promise<PreparedGenerationRun> {
    const now = new Date().toISOString();
    const outputDirectory = this.outputDirectoryFor(run.workspaceRoot);
    let analysisRunId = run.analysisRunId;
    if (!analysisRunId && run.analysisDir) {
      // Linkage to the analysis run is informational; a missing or v2
      // manifest must not stop generation.
      analysisRunId = (await this.storage().loadManifest(run.analysisDir))
        ?.runId;
    }
    const agents: Record<string, GenerationAgentCheckpoint> = {};
    for (const agentId of run.selectedAgentIds) {
      agents[agentId] = {
        agentId,
        filePath: path.join(outputDirectory, `${agentId}.md`),
        status: 'pending',
        rejectedSections: 0,
        tailoredSections: 0,
      };
    }
    const manifest: GenerationCheckpointManifest = {
      version: 1,
      runId: randomUUID(),
      ...(analysisRunId ? { analysisRunId } : {}),
      ...(run.analysisDir ? { analysisDirectory: run.analysisDir } : {}),
      createdAt: now,
      updatedAt: now,
      lifecycle: 'running',
      outputDirectory,
      selectedAgentIds: [...run.selectedAgentIds],
      input: run.input,
      agents,
    };
    const location: GenerationCheckpointLocation = {
      workspaceRoot: run.workspaceRoot,
      analysisDir: run.analysisDir,
    };
    const filePath = await this.storage().writeGenerationManifest(
      location.workspaceRoot,
      location.analysisDir,
      manifest,
    );
    this.logger.info('Generation checkpoint created', {
      runId: manifest.runId,
      filePath,
      agentCount: run.selectedAgentIds.length,
    });
    return {
      location,
      manifest,
      agentIds: [...run.selectedAgentIds],
      carriedOver: [],
    };
  }

  /**
   * Find the checkpoint a `resume: true` request refers to. With an explicit
   * (already canonical) analysis directory the checkpoint beside it is used;
   * otherwise the latest resumable run in the workspace. Read-only.
   */
  async locateResumable(
    workspaceRoot: string,
    analysisDir: string | null,
  ): Promise<{
    location: GenerationCheckpointLocation;
    manifest: GenerationCheckpointManifest;
  } | null> {
    const storage = this.storage();
    if (analysisDir !== null) {
      const manifest = await storage.loadGenerationManifest(
        workspaceRoot,
        analysisDir,
      );
      return manifest
        ? { location: { workspaceRoot, analysisDir }, manifest }
        : null;
    }
    const latest = await storage.findLatestResumableRun(workspaceRoot);
    if (!latest?.generation) return null;
    return {
      location: { workspaceRoot, analysisDir: latest.slugDir },
      manifest: latest.generation,
    };
  }

  /**
   * A checkpoint is resumed only when every path it names stays inside the
   * workspace: the output directory under the root, and both the analysis
   * directory it records and the one it was found beside under
   * `<workspace>/.ptah/analysis`. Anything else is reported unavailable and
   * left on disk.
   */
  isTrusted(
    location: GenerationCheckpointLocation,
    manifest: GenerationCheckpointManifest,
  ): boolean {
    const { workspaceRoot } = location;
    if (!isPathWithinRoots(manifest.outputDirectory, [workspaceRoot])) {
      return false;
    }
    const storage = this.storage();
    const candidates = [location.analysisDir, manifest.analysisDirectory];
    return candidates.every(
      (dir) =>
        dir === null ||
        dir === undefined ||
        storage.resolveAuthorizedAnalysisDir(workspaceRoot, dir) !== null,
    );
  }

  /**
   * Turn a located checkpoint into a run: stale `running` records (a host
   * that died mid-agent) go back to `pending`, the lifecycle returns to
   * `running`, and only non-current agents are handed to the orchestrator.
   */
  async prepareResume(
    location: GenerationCheckpointLocation,
    manifest: GenerationCheckpointManifest,
  ): Promise<PreparedGenerationRun> {
    const agentIds: string[] = [];
    const carriedOver: GenerationAgentOutcome[] = [];
    const agents: Record<string, GenerationAgentCheckpoint> = {};

    for (const agent of Object.values(manifest.agents)) {
      if (RESUMABLE_STATUSES.has(agent.status)) {
        agentIds.push(agent.agentId);
        agents[agent.agentId] =
          agent.status === 'running' ? { ...agent, status: 'pending' } : agent;
        continue;
      }
      agents[agent.agentId] = agent;
      carriedOver.push({
        agentId: agent.agentId,
        filePath: agent.filePath,
        status: 'unchanged',
        rejectedSections: agent.rejectedSections,
        tailoredSections: agent.tailoredSections,
      });
    }

    const next: GenerationCheckpointManifest = {
      ...manifest,
      lifecycle: 'running',
      updatedAt: new Date().toISOString(),
      agents,
    };
    await this.storage().writeGenerationManifest(
      location.workspaceRoot,
      location.analysisDir,
      next,
    );
    this.logger.info('Generation checkpoint resumed', {
      runId: next.runId,
      remaining: agentIds,
      carriedOver: carriedOver.map((agent) => agent.agentId),
    });
    return { location, manifest: next, agentIds, carriedOver };
  }

  /**
   * Record one terminal agent outcome. Throws when the checkpoint cannot be
   * updated: the orchestrator awaits this callback, so the throw stops later
   * agents instead of leaving written files unrecorded.
   */
  async recordOutcome(
    location: GenerationCheckpointLocation,
    outcome: GenerationAgentOutcome,
  ): Promise<void> {
    const updated = await this.storage().updateGenerationManifest(
      location.workspaceRoot,
      location.analysisDir,
      (current) => ({
        ...current,
        agents: {
          ...current.agents,
          [outcome.agentId]: {
            agentId: outcome.agentId,
            filePath: outcome.filePath,
            status: outcome.status,
            rejectedSections: outcome.rejectedSections,
            tailoredSections: outcome.tailoredSections,
            ...(outcome.error !== undefined ? { error: outcome.error } : {}),
          },
        },
      }),
    );
    if (!updated) {
      throw new Error(
        'Generation checkpoint is no longer readable; stopping before further agents.',
      );
    }
  }

  /**
   * Record the run's terminal lifecycle. Best-effort: the outcome has already
   * been decided, so a failure here is logged and the payload still goes out.
   */
  async finalize(
    location: GenerationCheckpointLocation,
    lifecycle: GenerationCheckpointManifest['lifecycle'],
  ): Promise<void> {
    try {
      const updated = await this.storage().updateGenerationManifest(
        location.workspaceRoot,
        location.analysisDir,
        (current) => ({ ...current, lifecycle }),
      );
      if (!updated) {
        this.logger.warn('Generation checkpoint missing at finalize', {
          lifecycle,
          analysisDir: location.analysisDir,
        });
      }
    } catch (error: unknown) {
      this.logger.warn('Failed to finalize generation checkpoint', {
        lifecycle,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private storage(): AnalysisStorageService {
    return this.container.resolve<AnalysisStorageService>(
      AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE,
    );
  }
}
