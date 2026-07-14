/**
 * SpecHarvesterService — turns `.ptah/specs/TASK_*` orchestration artifacts into
 * skill telemetry. A spec is eligible only once its `task.md` frontmatter status
 * is `done`/`cancelled` (see `extractSpec`); legacy carrier-less folders are
 * skipped. Three jobs:
 *  1. harvest()  — reconcile the optimistic `succeeded:true` subagent events
 *     against graded per-batch verdicts (tasks.md word statuses), keyed by
 *     executor slug.
 *  2. getRecentFindings() — feed review reports into the enhancer (SpecFindingsPort).
 *  3. listSpecs() / clearStaleSpecs() — classify and prune harvested specs.
 *
 * Self-contained: reads the workspace `.ptah/specs` folder directly and writes
 * through SkillCandidateStore. No coupling to the shipped orchestration skill.
 */
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import * as os from 'node:os';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import { SkillCandidateStore } from './skill-candidate.store';
import {
  extractSpec,
  HARVEST_MARKER_FILE,
  type HarvestedSpec,
} from './spec-extractor';
import type { SpecFindingsPort } from './spec-findings.port';

const ARCHIVE_DIR = '.archive';
const DEFAULT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FINDING_SPECS = 3;
const MAX_FINDINGS_CHARS = 4000;

export type SpecStatus = 'active' | 'complete-unharvested' | 'harvested';

export interface SpecSummary {
  readonly taskId: string;
  readonly status: SpecStatus;
  readonly batchCount: number;
  readonly harvestedAt: number | null;
  readonly ageDays: number | null;
}

export interface HarvestResult {
  readonly scanned: number;
  readonly harvested: number;
  readonly reconciled: number;
}

export interface ClearStaleResult {
  readonly cleared: number;
  readonly mode: 'archive' | 'delete';
  readonly taskIds: readonly string[];
}

interface HarvestMarker {
  readonly taskId: string;
  readonly harvestedAt: number;
  readonly reconciledCount: number;
}

@injectable()
export class SpecHarvesterService implements SpecFindingsPort {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly store: SkillCandidateStore,
  ) {}

  /**
   * Reconcile every completed, un-harvested spec under the workspace `.ptah/specs`.
   * Idempotent: harvested specs (marker present) are skipped, and the store's
   * `reconciled_at` guard prevents double-flipping a row.
   */
  async harvest(workspaceRoot?: string): Promise<HarvestResult> {
    const root = this.resolveSpecsRoot(workspaceRoot);
    const specs = await this.readSpecs(root);
    let harvested = 0;
    let reconciled = 0;
    const now = Date.now();

    for (const spec of specs) {
      if (!spec.completed || spec.harvested) continue;
      let count = 0;
      for (const batch of spec.batches) {
        const did = this.store.reconcileSubagentEvent({
          slug: batch.slug,
          succeeded: batch.status === 'COMPLETE',
          isError: batch.status === 'FAILED',
          windowStart: spec.windowStart,
          windowEnd: spec.windowEnd,
          verdictSource: `spec:${spec.taskId}`,
          reconciledAt: now,
        });
        if (did) {
          count += 1;
          reconciled += 1;
        }
      }
      await this.writeMarker(spec, now, count);
      harvested += 1;
    }

    if (harvested > 0) {
      this.logger.info('[spec-harvester] harvest complete', {
        scanned: specs.length,
        harvested,
        reconciled,
      });
    }
    return { scanned: specs.length, harvested, reconciled };
  }

  /** Classify every TASK_* spec for the cleanup UI. */
  async listSpecs(workspaceRoot?: string): Promise<SpecSummary[]> {
    const root = this.resolveSpecsRoot(workspaceRoot);
    const specs = await this.readSpecs(root);
    const now = Date.now();
    const summaries: SpecSummary[] = [];
    for (const spec of specs) {
      const status: SpecStatus = !spec.completed
        ? 'active'
        : spec.harvested
          ? 'harvested'
          : 'complete-unharvested';
      const marker = spec.harvested ? await this.readMarker(spec.dir) : null;
      const harvestedAt = marker?.harvestedAt ?? null;
      summaries.push({
        taskId: spec.taskId,
        status,
        batchCount: spec.batches.length,
        harvestedAt,
        ageDays:
          harvestedAt === null
            ? null
            : Math.floor((now - harvestedAt) / DAY_MS),
      });
    }
    return summaries;
  }

  /**
   * Remove specs that are completed AND harvested AND older than the retention
   * window. Active / in-flight specs are never touched. Default mode archives
   * into `.ptah/specs/.archive/`; `delete` removes irrecoverably.
   */
  async clearStaleSpecs(
    workspaceRoot?: string,
    options: { retentionDays?: number; mode?: 'archive' | 'delete' } = {},
  ): Promise<ClearStaleResult> {
    const root = this.resolveSpecsRoot(workspaceRoot);
    const mode = options.mode ?? 'archive';
    const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const cutoff = Date.now() - retentionDays * DAY_MS;
    const specs = await this.readSpecs(root);
    const cleared: string[] = [];

    for (const spec of specs) {
      if (!spec.completed || !spec.harvested) continue;
      const marker = await this.readMarker(spec.dir);
      const harvestedAt = marker?.harvestedAt ?? spec.windowEnd;
      if (harvestedAt > cutoff) continue;
      try {
        if (mode === 'archive') {
          const archiveRoot = join(root, ARCHIVE_DIR);
          await mkdir(archiveRoot, { recursive: true });
          await rename(spec.dir, join(archiveRoot, spec.taskId));
        } else {
          await rm(spec.dir, { recursive: true, force: true });
        }
        cleared.push(spec.taskId);
      } catch (error: unknown) {
        this.logger.warn('[spec-harvester] clear-stale failed for spec', {
          taskId: spec.taskId,
          mode,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (cleared.length > 0) {
      this.logger.info('[spec-harvester] cleared stale specs', {
        mode,
        count: cleared.length,
      });
    }
    return { cleared: cleared.length, mode, taskIds: cleared };
  }

  /** SpecFindingsPort — graded review findings for a slug's most recent specs. */
  async getRecentFindings(slug: string): Promise<string | null> {
    if (!slug) return null;
    let root: string;
    try {
      root = this.resolveSpecsRoot();
    } catch {
      return null;
    }
    const specs = (await this.readSpecs(root))
      .filter(
        (spec) =>
          spec.completed &&
          spec.reviewFindings.length > 0 &&
          spec.batches.some((b) => b.slug === slug),
      )
      .sort((a, b) => b.windowEnd - a.windowEnd)
      .slice(0, MAX_FINDING_SPECS);
    if (specs.length === 0) return null;
    return specs
      .map((spec) => `[${spec.taskId}]\n${spec.reviewFindings}`)
      .join('\n\n---\n\n')
      .slice(0, MAX_FINDINGS_CHARS);
  }

  private async readSpecs(root: string): Promise<HarvestedSpec[]> {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return [];
    }
    const specs: HarvestedSpec[] = [];
    for (const entry of entries) {
      if (!entry.startsWith('TASK_')) continue;
      const spec = await extractSpec(join(root, entry));
      if (spec) specs.push(spec);
    }
    return specs;
  }

  private async writeMarker(
    spec: HarvestedSpec,
    harvestedAt: number,
    reconciledCount: number,
  ): Promise<void> {
    const marker: HarvestMarker = {
      taskId: spec.taskId,
      harvestedAt,
      reconciledCount,
    };
    try {
      await writeFile(
        join(spec.dir, HARVEST_MARKER_FILE),
        JSON.stringify(marker, null, 2),
        'utf8',
      );
    } catch (error: unknown) {
      this.logger.warn('[spec-harvester] failed to write harvest marker', {
        taskId: spec.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async readMarker(dir: string): Promise<HarvestMarker | null> {
    try {
      const raw = await readFile(join(dir, HARVEST_MARKER_FILE), 'utf8');
      return JSON.parse(raw) as HarvestMarker;
    } catch {
      return null;
    }
  }

  private resolveSpecsRoot(workspaceRoot?: string): string {
    const root = workspaceRoot ?? this.resolveWorkspaceRoot();
    return join(root, '.ptah', 'specs');
  }

  private resolveWorkspaceRoot(): string {
    try {
      const root = this.workspaceProvider.getWorkspaceRoot();
      if (root && root.length > 0) return root;
    } catch {
      // fall through to homedir
    }
    return os.homedir();
  }
}
