/**
 * SpecHarvesterService — turns `.ptah/specs/TASK_*` orchestration artifacts into
 * skill telemetry. A spec is eligible only once its `task.md` frontmatter status
 * is `done`/`cancelled` (see `extractSpec`); legacy carrier-less folders are
 * skipped. Three jobs:
 *  1. harvest()  — reconcile the optimistic `succeeded:true` invocation events
 *     of each finished task against its task-level verdict (`taskVerdict`:
 *     cancelled -> failed; done -> the latest work review), by task id within
 *     the same workspace, and write review grades. Folders skipped for want of
 *     a carrier are warned about once per run rather than dropped silently.
 *  2. getRecentFindings() — feed review reports into the enhancer (SpecFindingsPort).
 *  3. listSpecs() / clearStaleSpecs() — classify and prune harvested specs.
 *
 * Reads the workspace `.ptah/specs` folder and writes task reconciliation
 * through SkillInvocationEventStore and review grades through SkillTaskGradeStore.
 */
import {
  mkdir,
  lstat,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import * as os from 'node:os';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { BATCHES_FILE, CARRIER_FILE } from '@ptah-extension/shared';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import { SkillInvocationEventStore } from './skill-invocation-event.store';
import { SkillTaskGradeStore, type GradeAttribution, type SkillTaskGrade } from './skill-task-grade.store';
import {
  extractSpec,
  HARVEST_MARKER_FILE,
  isDocumentReview,
  taskVerdict,
  type HarvestedSpec,
  type SpecReviewVerdict,
} from './spec-extractor';
import type { SpecFindingsPort } from './spec-findings.port';
import type { SkillRegistryKind } from './skill-registry.store';

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
  /** TASK_* folders with a valid `task.md` carrier. */
  readonly scanned: number;
  /** Finished specs whose grades and marker were written this run. */
  readonly harvested: number;
  /** Invocation events reconciled this run (summed over every finished spec). */
  readonly reconciled: number;
  /** Scanned specs not yet done or cancelled; harvested once they finish. */
  readonly pending: number;
  /** TASK_* folders skipped because they have no valid `task.md` carrier. */
  readonly skippedFolders: number;
}

export type HarvestTrigger = 'manual' | 'auto';

export interface HarvestOptions {
  /** Who started the run; logged with the run's counts. */
  readonly trigger?: HarvestTrigger;
}

export interface ClearStaleResult {
  readonly cleared: number;
  readonly mode: 'archive' | 'delete';
  readonly taskIds: readonly string[];
}

interface HarvestMarker {
  readonly version: number;
  readonly artifactDigest: string;
  readonly taskId: string;
  readonly harvestedAt: number;
  readonly reconciledCount: number;
}

/**
 * Version 3: task-level reconciliation (P3/P4). A marker from an older version
 * makes the spec re-harvest once.
 */
const MARKER_VERSION = 3;

/**
 * The reviews sharing the newest `modifiedAt`, in their original order. One
 * entry unless several reviews were written in the same millisecond.
 */
function latestReviews(reviews: readonly SpecReviewVerdict[]): SpecReviewVerdict[] {
  if (reviews.length === 0) return [];
  const latestAt = Math.max(...reviews.map((review) => review.modifiedAt));
  return reviews.filter((review) => review.modifiedAt === latestAt);
}

@injectable()
export class SpecHarvesterService implements SpecFindingsPort {
  private readonly gradeFailures = new Map<string, { digest: string; attempts: number }>();
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SkillInvocationEventStore)
    private readonly events: SkillInvocationEventStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_TASK_GRADE_STORE)
    private readonly grades?: SkillTaskGradeStore,
  ) {}

  /**
   * Reconcile the invocation events of every finished spec under the workspace
   * `.ptah/specs` and write review grades for specs whose artifacts changed.
   *
   * Event reconciliation runs for every finished spec with a task verdict on
   * every run, marker or not: the store only touches rows with
   * `reconciled_at IS NULL`, so it is idempotent and overlapping runs cannot
   * flip an event twice. Grades and the marker are written only when the
   * marker is missing, from an older version, or has a different digest.
   */
  async harvest(workspaceRoot?: string, options: HarvestOptions = {}): Promise<HarvestResult> {
    const root = this.resolveSpecsRoot(workspaceRoot);
    const workspace = normalizeWorkspaceRoot(join(root, '..', '..'));
    const { specs, skippedFolders } = await this.readSpecs(root, { warnOnSkipped: true });
    let harvested = 0;
    let reconciled = 0;
    let pending = 0;
    const now = Date.now();

    for (const spec of specs) {
      if (!spec.completed) {
        pending += 1;
        continue;
      }
      const verdict = taskVerdict(spec);
      const count = verdict === null ? 0 : this.events.reconcileTaskEvents({
        taskId: spec.taskId,
        workspaceRoot: workspace,
        succeeded: verdict === 'succeeded',
        verdictSource: `spec:${spec.taskId}`,
        reconciledAt: now,
      });
      reconciled += count;
      const marker = await this.readMarker(spec.dir);
      const current = marker?.version === MARKER_VERSION;
      if (current && marker?.artifactDigest === spec.artifactDigest) continue;
      for (const diagnostic of spec.diagnostics) {
        this.logger.warn('[spec-harvester] invalid review artifact', { taskId: spec.taskId, reason: diagnostic.slice(0, 120) });
      }
      if (this.grades) {
        const failure = this.gradeFailures.get(spec.dir);
        if (failure?.digest === spec.artifactDigest && failure.attempts >= 3) continue;
        if (!this.writeGrades(spec, workspace, now)) {
          this.gradeFailures.set(spec.dir, {
            digest: spec.artifactDigest,
            attempts: failure?.digest === spec.artifactDigest ? failure.attempts + 1 : 1,
          });
          continue;
        }
        this.gradeFailures.delete(spec.dir);
      }
      await this.writeMarker(spec, now, (current ? marker?.reconciledCount ?? 0 : 0) + count);
      harvested += 1;
    }

    this.logger.info('[spec-harvester] harvest complete', {
      trigger: options.trigger ?? 'unspecified',
      scanned: specs.length,
      harvested,
      reconciled,
      pending,
      skippedFolders,
    });
    return { scanned: specs.length, harvested, reconciled, pending, skippedFolders };
  }

  private writeGrades(spec: HarvestedSpec, workspaceRoot: string, now: number): boolean {
    if (!this.grades) return true;
    try {
      const attributions: GradeAttribution[] = this.grades.findAttributions(spec.taskId, workspaceRoot);
      if (attributions.length === 0 && spec.batches.length > 0) {
        this.logger.warn('[spec-harvester] no grade attributions for spec batches', {
          taskId: spec.taskId, batchCount: spec.batches.length, attributionCount: 0,
        });
      }
      const keep: string[] = [];
      for (const attribution of attributions) {
        const siblings = attributions.filter((candidate) => candidate.kind === attribution.kind && candidate.slug === attribution.slug);
        const batch = attribution.kind === 'agent' && siblings.length === 1
          ? spec.batches.find((item) => item.slug === attribution.slug) : undefined;
        // Planning-document reviews never grade work on any branch (as in taskVerdict).
        const matching = spec.reviews.filter((review) => !isDocumentReview(review.file) && (
          (review.runId !== null && review.runId === attribution.runId) ||
          (review.runId === null && review.sessionId !== null && review.sessionId === attribution.sessionId && siblings.length === 1) ||
          (review.runId === null && review.sessionId === null && siblings.length === 1 && attribution.kind === 'agent')));
        const final = matching.filter((review) => !review.file.startsWith('judge-round-'));
        const selected = final.length > 0 ? final : matching;
        const latest = latestReviews(selected);
        const laneVerdict = attribution.finalReview === 'approved' ? 'pass' : attribution.finalReview === 'rejected' ? 'fail' : null;
        if (!batch && !laneVerdict && new Set(selected.map((review) => review.verdict)).size > 1) {
          if (new Set(latest.map((review) => review.verdict)).size > 1) {
            this.logger.warn('[spec-harvester] conflicting review verdicts', { taskId: spec.taskId, slug: attribution.slug.slice(0, 80) });
            continue;
          }
          this.logger.debug('[spec-harvester] conflicting review verdicts resolved to the latest review', {
            taskId: spec.taskId, slug: attribution.slug.slice(0, 80), file: latest.at(-1)?.file,
          });
        }
        const review = latest.at(-1);
        const verdict = batch ? (batch.status === 'COMPLETE' ? 'pass' : 'fail') : laneVerdict ?? review?.verdict;
        if (!verdict) continue;
        const grade: SkillTaskGrade = {
          taskId: spec.taskId, subjectKind: attribution.kind, subjectSlug: attribution.slug,
          attributionKey: attribution.attributionKey, runId: attribution.runId, verdict,
          sourceFile: batch ? BATCHES_FILE : laneVerdict ? 'lane_outcome_records' : review?.file ?? null,
          sourceDigest: spec.artifactDigest, evidenceSource: batch ? 'batch' : laneVerdict ? 'lane-final-review' : 'task-review',
          workspaceRoot, gradedAt: now, findingsRef: review ? `${spec.taskId}/${review.file}` : null,
        };
        if (!this.grades.upsert(grade)) {
          this.logger.warn('[spec-harvester] grade key owned by another workspace', {
            taskId: spec.taskId, slug: attribution.slug.slice(0, 80),
          });
          continue;
        }
        keep.push(`${grade.subjectKind}:${grade.subjectSlug}:${grade.attributionKey}`);
      }
      const removed = this.grades.removeAbsent(spec.taskId, workspaceRoot, keep);
      if (removed > 0) {
        this.logger.info('[spec-harvester] pruned stale grades', {
          taskId: spec.taskId, removed, kept: keep.length,
        });
      }
      return true;
    } catch (error: unknown) {
      // degradation-audit: reported - logged at warn; the digest is retried on the next harvest.
      this.logger.warn('[spec-harvester] grade write unavailable', {
        taskId: spec.taskId, reason: error instanceof Error ? error.name : 'unknown',
      });
      return false;
    }
  }

  /** Classify every TASK_* spec for the cleanup UI. */
  async listSpecs(workspaceRoot?: string): Promise<SpecSummary[]> {
    const root = this.resolveSpecsRoot(workspaceRoot);
    const { specs } = await this.readSpecs(root);
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
    const { specs } = await this.readSpecs(root);
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
  async getRecentFindings(slug: string, kind?: SkillRegistryKind): Promise<string | null> {
    if (!slug) return null;
    let root: string;
    try {
      root = this.resolveSpecsRoot();
    } catch {
      // degradation-audit: optional-capability - Workspace spec findings are
      // optional enhancement evidence; null means none can be resolved.
      return null;
    }
    const workspace = normalizeWorkspaceRoot(join(root, '..', '..'));
    const specs = (await this.readSpecs(root)).specs
      .filter(
        (spec) =>
          spec.completed &&
          spec.reviewFindings.length > 0 &&
          (spec.batches.some((b) => b.slug === slug) ||
            (this.grades?.hasGradeForTask(spec.taskId, slug, kind, workspace) ?? false)),
      )
      .sort((a, b) => b.windowEnd - a.windowEnd)
      .slice(0, MAX_FINDING_SPECS);
    if (specs.length === 0) return null;
    return specs
      .map((spec) => `[${spec.taskId}]\n${spec.reviewFindings}`)
      .join('\n\n---\n\n')
      .slice(0, MAX_FINDINGS_CHARS);
  }

  /**
   * Read every `TASK_*` folder under the specs root.
   *
   * `extractSpec` returns null for a folder with no readable `task.md` carrier.
   * Those nulls used to be dropped silently, which made a whole class of
   * failure — a missed carrier — indistinguishable from "nothing to harvest".
   * `warnOnSkipped` surfaces them.
   *
   * The warn is emitted ONCE PER RUN naming every skipped folder, not once per
   * folder and not once per read attempt: a workspace can easily carry a dozen
   * carrier-less folders, and per-folder logging would turn a real signal into
   * noise. Only `harvest()` opts in — the read-only accessors run on hot paths
   * where this would repeat without telling anyone anything new.
   *
   * Returns the specs and the number of skipped carrier-less folders.
   */
  private async readSpecs(
    root: string,
    options: { warnOnSkipped?: boolean } = {},
  ): Promise<{ specs: HarvestedSpec[]; skippedFolders: number }> {
    // degradation-audit: optional-capability - a workspace without .ptah/specs has no specs to read.
    const actualRoot = await realpath(root).catch(() => null);
    // degradation-audit: optional-capability - an unresolvable workspace root means no specs to read.
    const actualWorkspace = await realpath(join(root, '..', '..')).catch(() => null);
    if (!actualRoot || !actualWorkspace) return { specs: [], skippedFolders: 0 };
    const rootWithinWorkspace = relative(actualWorkspace, actualRoot);
    if (!rootWithinWorkspace || rootWithinWorkspace.startsWith('..') || isAbsolute(rootWithinWorkspace)) {
      this.logger.warn('[spec-harvester] spec root resolves outside workspace');
      return { specs: [], skippedFolders: 0 };
    }
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      // degradation-audit: optional-capability - The specs directory is
      // optional; an unreadable or absent root contains no harvest candidates.
      return { specs: [], skippedFolders: 0 };
    }
    const specs: HarvestedSpec[] = [];
    const skipped: string[] = [];
    for (const entry of entries) {
      if (!entry.startsWith('TASK_')) continue;
      const spec = await extractSpec(join(root, entry), root);
      if (spec) {
        specs.push(spec);
      } else {
        skipped.push(entry);
      }
    }
    if (options.warnOnSkipped === true && skipped.length > 0) {
      this.logger.warn(
        `[spec-harvester] skipped ${skipped.length} TASK_* folder(s) with no valid ${CARRIER_FILE} carrier — invisible to harvesting and to the Tasks board`,
        { folders: skipped, carrier: CARRIER_FILE },
      );
    }
    return { specs, skippedFolders: skipped.length };
  }

  private async writeMarker(
    spec: HarvestedSpec,
    harvestedAt: number,
    reconciledCount: number,
  ): Promise<void> {
    const marker: HarvestMarker = {
      version: MARKER_VERSION,
      artifactDigest: spec.artifactDigest,
      taskId: spec.taskId,
      harvestedAt,
      reconciledCount,
    };
    try {
      const target = join(spec.dir, HARVEST_MARKER_FILE);
      const temp = join(spec.dir, `.harvested-${process.pid}-${Date.now()}.tmp`);
      await writeFile(temp, JSON.stringify(marker, null, 2), { encoding: 'utf8', flag: 'wx' });
      await rename(temp, target);
    } catch (error: unknown) {
      this.logger.warn('[spec-harvester] failed to write harvest marker', {
        taskId: spec.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async readMarker(dir: string): Promise<HarvestMarker | null> {
    try {
      const path = join(dir, HARVEST_MARKER_FILE);
      const info = await lstat(path);
      if (!info.isFile() || info.size > 4096) return null;
      const actual = await realpath(path);
      const relativePath = relative(await realpath(dir), actual);
      if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
      const handle = await open(path, 'r');
      let raw: string;
      try {
        const buffer = Buffer.alloc(4097);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 4096) return null;
        raw = buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
      const value: unknown = JSON.parse(raw);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
      const data = value as Record<string, unknown>;
      if (typeof data['taskId'] !== 'string' || typeof data['harvestedAt'] !== 'number' || typeof data['reconciledCount'] !== 'number') return null;
      return {
        taskId: data['taskId'], harvestedAt: data['harvestedAt'], reconciledCount: data['reconciledCount'],
        version: typeof data['version'] === 'number' ? data['version'] : 0,
        artifactDigest: typeof data['artifactDigest'] === 'string' ? data['artifactDigest'] : '',
      };
    } catch {
      // degradation-audit: optional-capability - The harvest marker is cache
      // state; null safely treats the spec as not yet harvested.
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
