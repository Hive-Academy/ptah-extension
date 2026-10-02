/**
 * SkillRetirementService — usage-based dormancy and retirement of promoted
 * skills, and the only remover of an active SKILL.md for a decided row.
 *
 * With N = `skillSynthesis.retirement.dormantAfterDays` and
 * M = `skillSynthesis.retirement.retireAfterDormantDays` (both default 30), a
 * promoted skill idle for at least N days turns dormant, and one idle for at
 * least N + M days is retired: its active directory is removed, the row is
 * rejected with {@link RETIRED_UNUSED_REASON}, and its `synth` registry row is
 * deleted. Idle time runs from the newest invocation event, else the
 * promotion, else the row's creation (`listPromotedLastUse`). There is no
 * automatic re-residency.
 *
 * Exempt: pinned rows, and rows whose slug is registered `authored` or
 * `diverged` (user-owned content).
 *
 * Order for a retirement: filesystem first, database second. `rmSync` with
 * `force` is idempotent, so a crash between the two leaves a promoted row
 * whose directory is already gone, and the next pass finishes the DB move.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { QueryOrigin } from '../internal-query.interface';
import { SkillCandidateStore } from '../skill-candidate.store';
import { SkillMdGenerator } from '../skill-md-generator';
import { SkillRegistryStore } from '../skill-registry.store';
import {
  SKILL_REPROPAGATION_TOKEN,
  type SkillRepropagationPort,
} from '../skill-repropagation.port';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import { RETIRED_UNUSED_REASON, type SkillCandidateRow } from '../types';

/** Settings section, matching every other reader in this library. */
export const RETIREMENT_SETTINGS_SECTION = 'ptah';
export const DORMANT_AFTER_DAYS_KEY =
  'skillSynthesis.retirement.dormantAfterDays';
export const RETIRE_AFTER_DORMANT_DAYS_KEY =
  'skillSynthesis.retirement.retireAfterDormantDays';
/** Matches `FILE_BASED_SETTINGS_DEFAULTS` in `platform-core`. */
export const RETIREMENT_DAYS_DEFAULT = 30;

const DAY_MS = 86_400_000;

/** The file-settings boundary: whole days, one day to ten years. */
const RetirementDaysSchema = z.number().int().min(1).max(3650);

export interface SkillRetirementResult {
  /** Rows moved resident → dormant this pass. */
  readonly dormant: number;
  /** Rows rejected with `retired:unused` this pass. */
  readonly retired: number;
  readonly skippedPinned: number;
  /** Rows exempt because their slug is registered `authored` or `diverged`. */
  readonly skippedExempt: number;
  /** Rows due for retirement whose directory is not `<activeRoot>/<slug>`. */
  readonly skippedUncontained: number;
  readonly dormantSlugs: readonly string[];
  readonly retiredSlugs: readonly string[];
  /** Set when the whole pass was skipped. */
  readonly skippedReason?: 'registry-unavailable';
}

const EMPTY_RESULT: SkillRetirementResult = {
  dormant: 0,
  retired: 0,
  skippedPinned: 0,
  skippedExempt: 0,
  skippedUncontained: 0,
  dormantSlugs: [],
  retiredSlugs: [],
};

/** What {@link SkillRetirementService.retire} did with one row. */
type RetireOutcome = 'retired' | 'uncontained' | 'skipped';

type PromotedLastUse = ReturnType<SkillCandidateStore['listPromotedLastUse']>;

@injectable()
export class SkillRetirementService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, { isOptional: true })
    private readonly registry: SkillRegistryStore | null,
    @inject(SkillMdGenerator)
    private readonly mdGenerator: SkillMdGenerator,
    @inject(SKILL_REPROPAGATION_TOKEN, { isOptional: true })
    private readonly repropagation: SkillRepropagationPort | null,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { isOptional: true })
    private readonly workspace: IWorkspaceProvider | null,
  ) {}

  /**
   * One dormancy and retirement sweep over every promoted row. A failure on
   * one row is logged and the loop continues; every changed slug is
   * repropagated once, after the loop.
   */
  async run(
    origin: QueryOrigin = {},
    now: number = Date.now(),
  ): Promise<SkillRetirementResult> {
    const exemptSlugs = this.readExemptSlugs();
    if (exemptSlugs === null) {
      return { ...EMPTY_RESULT, skippedReason: 'registry-unavailable' };
    }

    const dormantAfterDays = this.readDays(DORMANT_AFTER_DAYS_KEY);
    const retireAfterDays =
      dormantAfterDays + this.readDays(RETIRE_AFTER_DORMANT_DAYS_KEY);

    let skippedPinned = 0;
    let skippedExempt = 0;
    let skippedUncontained = 0;
    const dormantSlugs: string[] = [];
    const retiredSlugs: string[] = [];

    for (const { row, lastUsedAt } of this.readPromotedLastUse()) {
      const idleDays = (now - lastUsedAt) / DAY_MS;
      if (idleDays < dormantAfterDays) continue;
      if (row.pinned) {
        skippedPinned++;
        continue;
      }
      if (exemptSlugs.has(row.name.toLowerCase())) {
        skippedExempt++;
        continue;
      }
      try {
        if (idleDays >= retireAfterDays) {
          const outcome = this.retire(row, now);
          if (outcome === 'retired') retiredSlugs.push(row.name);
          if (outcome === 'uncontained') skippedUncontained++;
        } else if (row.residency === 'resident') {
          this.store.setResidency(row.id, 'dormant');
          dormantSlugs.push(row.name);
        }
      } catch (err) {
        // Wraps the whole per-row unit, including the `inImmediateTransaction`
        // call, so a store-write failure has already rolled back (R-f2).
        this.logger.warn(
          '[skill-synthesis] retirement sweep failed for one skill (retried next pass)',
          {
            candidateId: row.id,
            slug: row.name,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }

    if (dormantSlugs.length > 0 || retiredSlugs.length > 0) {
      this.logger.info('[skill-synthesis] retirement sweep changed residency', {
        dormantSlugs,
        retiredSlugs,
        dormantAfterDays,
        retireAfterDays,
      });
    }
    await this.emitRepropagation([...dormantSlugs, ...retiredSlugs], origin);

    return {
      dormant: dormantSlugs.length,
      retired: retiredSlugs.length,
      skippedPinned,
      skippedExempt,
      skippedUncontained,
      dormantSlugs,
      retiredSlugs,
    };
  }

  /** The sweep's input; a failed read logs and yields an empty pass. */
  private readPromotedLastUse(): PromotedLastUse {
    let rows: PromotedLastUse = [];
    try {
      rows = this.store.listPromotedLastUse();
    } catch (err) {
      this.logger.warn(
        '[skill-synthesis] failed to read promoted skills; retirement pass skipped',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
    return rows;
  }

  /**
   * Remove the active directories of rows another unit already decided (the
   * accept path's merged promoted members, whose registry rows were deleted
   * inside that unit's transaction), then repropagate. Same containment rule
   * as {@link run}. Returns the slugs whose directory was removed.
   */
  async removeMaterializations(
    rows: readonly SkillCandidateRow[],
    origin: QueryOrigin = {},
  ): Promise<string[]> {
    const removed: string[] = [];
    for (const row of rows) {
      try {
        if (this.removeActiveDir(row)) removed.push(row.name);
      } catch (err) {
        this.logger.warn(
          '[skill-synthesis] failed to remove a merged skill directory',
          {
            candidateId: row.id,
            slug: row.name,
            bodyPath: row.bodyPath,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
    await this.emitRepropagation(removed, origin);
    return removed;
  }

  /**
   * Retire one row. Filesystem first; then ONE transaction holding only
   * plain-statement writes (R-f): the compare-and-set rejection, and the
   * registry delete only when this pass won it. No catch in here (R-f2) — a
   * throw rolls the transaction back and reaches the caller's per-row catch.
   *
   * Directly before the destructive step the row and the registry are read
   * again, outside any transaction: the pass's snapshot may be stale, and a
   * row decided, pinned, or turned `authored`/`diverged` since then is
   * skipped with nothing deleted. A race in the gap after this re-check is
   * still resolved by the transaction's compare-and-set.
   *
   * `'uncontained'` when the directory failed containment and `'skipped'`
   * when the re-check failed or another writer decided the row first; in both
   * the transaction wrote nothing.
   */
  private retire(row: SkillCandidateRow, now: number): RetireOutcome {
    if (!this.stillRetirable(row)) return 'skipped';
    if (!this.removeActiveDir(row)) return 'uncontained';

    const won = this.store.inImmediateTransaction(() => {
      const rejected = this.store.rejectIfStatus(
        row.id,
        'promoted',
        RETIRED_UNUSED_REASON,
        now,
      );
      if (rejected) this.registry?.remove('skill', row.name);
      return rejected;
    });
    if (!won) {
      this.logger.info(
        '[skill-synthesis] retirement lost the race; row already decided elsewhere',
        { candidateId: row.id, slug: row.name },
      );
    }
    return won ? 'retired' : 'skipped';
  }

  /**
   * Fresh reads of the row (still `promoted`, not pinned) and of the registry
   * (slug not `authored`/`diverged`, case-insensitive). An unreadable
   * registry counts as a failed check.
   */
  private stillRetirable(row: SkillCandidateRow): boolean {
    const current = this.store.findById(row.id);
    const rowOk =
      current !== null && current.status === 'promoted' && !current.pinned;
    const exempt = rowOk ? this.readExemptSlugs() : null;
    const registryOk =
      exempt !== null && !exempt.has(row.name.toLowerCase());
    if (!rowOk || !registryOk) {
      this.logger.info(
        '[skill-synthesis] skill no longer retirable at re-check; directory kept',
        {
          candidateId: row.id,
          slug: row.name,
          status: current?.status ?? null,
          pinned: current?.pinned ?? null,
          registryReadable: rowOk ? exempt !== null : null,
        },
      );
    }
    return rowOk && registryOk;
  }

  /**
   * Remove `dirname(row.bodyPath)` only when it is exactly
   * `<activeRoot>/<row.name>` (R-j). Anything else — a path outside the root,
   * the root itself, a nested directory, or a basename that is not the slug —
   * is left alone with a warn, and the row is not retired.
   */
  private removeActiveDir(row: SkillCandidateRow): boolean {
    const root = path.resolve(this.mdGenerator.activeRoot());
    const dir = path.resolve(path.dirname(row.bodyPath));
    const relative = path.relative(root, dir);
    const contained =
      row.name.length > 0 &&
      relative === row.name &&
      path.basename(dir) === row.name &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative);
    if (!contained) {
      this.logger.warn(
        '[skill-synthesis] skill directory is not <activeRoot>/<slug>; not removed',
        {
          candidateId: row.id,
          slug: row.name,
          bodyPath: row.bodyPath,
          activeRoot: root,
        },
      );
      return false;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  /**
   * Slugs exempt from dormancy and retirement: registry `kind='skill'` rows
   * whose `clone_status` is `authored` or `diverged`, lowercased so the
   * lookup is case-insensitive (case-insensitive filesystems map `My-Skill`
   * and `my-skill` to one directory).
   *
   * Fails closed: no registry bound (CLI/e2e hosts) or a registry that fails
   * to read ⇒ `null`, and the caller skips the whole pass. Retiring without
   * knowing which skills the user owns could delete authored content; the
   * next pass retries.
   */
  private readExemptSlugs(): Set<string> | null {
    if (!this.registry) {
      this.logger.warn(
        '[skill-synthesis] no skill registry bound; retirement pass skipped',
      );
      return null;
    }
    let exempt: Set<string> | null = null;
    try {
      exempt = new Set(
        this.registry
          .listAll()
          .filter(
            (entry) =>
              entry.kind === 'skill' &&
              (entry.cloneStatus === 'authored' ||
                entry.cloneStatus === 'diverged'),
          )
          .map((entry) => entry.slug.toLowerCase()),
      );
    } catch (err) {
      this.logger.warn(
        '[skill-synthesis] failed to read the skill registry; retirement pass skipped',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
    return exempt;
  }

  /**
   * One retirement threshold in days. The key comes from a JSON file a user
   * can hand-edit, so anything that is not a whole number in 1..3650 falls
   * back to {@link RETIREMENT_DAYS_DEFAULT} with a warn.
   */
  private readDays(key: string): number {
    if (!this.workspace) return RETIREMENT_DAYS_DEFAULT;
    let raw: unknown = RETIREMENT_DAYS_DEFAULT;
    try {
      raw = this.workspace.getConfiguration<number>(
        RETIREMENT_SETTINGS_SECTION,
        key,
        RETIREMENT_DAYS_DEFAULT,
      );
    } catch (err) {
      this.logger.warn(
        '[skill-synthesis] failed to read a retirement setting; using the default',
        {
          key,
          default: RETIREMENT_DAYS_DEFAULT,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
    if (raw === undefined || raw === null) return RETIREMENT_DAYS_DEFAULT;
    const parsed = RetirementDaysSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    this.logger.warn(
      '[skill-synthesis] invalid retirement setting; using the default',
      { key, value: raw, default: RETIREMENT_DAYS_DEFAULT },
    );
    return RETIREMENT_DAYS_DEFAULT;
  }

  /**
   * Tell the harness these slugs' residency changed. Never throws: the change
   * is already committed, and the next activation's reconcile heals a missed
   * propagation (pattern `skill-promotion.service.ts` `emitRepropagation`).
   */
  private async emitRepropagation(
    slugs: readonly string[],
    origin: QueryOrigin,
  ): Promise<void> {
    if (!this.repropagation || slugs.length === 0) return;
    const workspaceRoot = this.workspaceRoot();
    for (const slug of new Set(slugs)) {
      try {
        await this.repropagation.repropagate(
          'skill',
          slug,
          workspaceRoot,
          origin,
        );
      } catch (err) {
        this.logger.warn(
          '[skill-synthesis] skill repropagation failed (retirement change is still committed)',
          { slug, error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
  }

  /** `''` when no workspace is open — what a headless host legitimately has. */
  private workspaceRoot(): string {
    let root = '';
    try {
      root = this.workspace?.getWorkspaceRoot() ?? '';
    } catch (err) {
      this.logger.debug(
        '[skill-synthesis] no workspace root for repropagation; reconciling known scope',
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
    return root;
  }
}
