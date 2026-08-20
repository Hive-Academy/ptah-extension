/**
 * The seed's summary output — TASK_2026_177 Task 8.6, plan §7.5, MG-1.10;
 * extended by Task 11.4.
 *
 * ⚠️ DATA-DRIVEN ON PURPOSE. Batch 11 added `courses`, `modules` and `lessons`
 * rows to this same block and completed the post assertion. Keeping the rows in
 * an array meant B11 APPENDED entries rather than rewriting a template literal —
 * and a rewritten template is how the two batches' output would end up
 * disagreeing about the same run. `formatSummary` was not rewritten; it gained
 * one branch, for the lesson variant of the `--refresh-bodies` log.
 */

/** One `created N updated M` line. */
export interface EntityCounts {
  created: number;
  updated: number;
}

export function emptyCounts(): EntityCounts {
  return { created: 0, updated: 0 };
}

/**
 * One `--refresh-bodies` overwrite, named precisely enough to reconstruct what
 * was destroyed (§7.4).
 *
 * ⚠️ ONE LOG, TWO VARIANTS — NOT TWO LOGGERS. Task 11.3 is explicit that
 * `--refresh-bodies` must reach lessons and that the existing logger is extended
 * rather than duplicated. A second array would let the flag appear to work while
 * silently leaving one of the two body kinds stale, which is exactly the failure
 * mode the discriminant makes impossible: every overwrite lands in this one list
 * and is printed by the one loop below.
 */
export type RefreshedBody =
  | {
      readonly kind: 'post';
      readonly topicSlug: string;
      readonly postNumber: number;
      readonly previousLength: number;
      readonly newLength: number;
    }
  | {
      readonly kind: 'lesson';
      readonly moduleSlug: string;
      readonly lessonSlug: string;
      readonly previousLength: number;
      readonly newLength: number;
    };

/** Everything the summary needs. Batch 11 extends `entities` and `assertions`. */
export interface SeedSummary {
  /** Ordered; the label is printed verbatim. */
  readonly entities: readonly { label: string; counts: EntityCounts }[];
  /**
   * MG-1.8 / A-4. Source usernames that matched no `User`, with the number of
   * SOURCE posts they authored.
   */
  readonly unmatchedUsernames: readonly {
    username: string;
    postCount: number;
  }[];
  readonly bodies: {
    /** Bodies written by this run. */
    readonly imported: number;
    /** Bodies this run was responsible for. */
    readonly total: number;
    /** Always 0. See the docblock on the printer. */
    readonly transformed: number;
  };
  readonly assertions: readonly string[];
  /** Posts skipped for having an empty source body, named individually. */
  readonly skippedEmptyBodies: readonly {
    topicSlug: string;
    postNumber: number;
  }[];
  /**
   * `--refresh-bodies` overwrites, one entry per row (§7.4). A bulk
   * "N bodies refreshed" line cannot reconstruct what was destroyed, which is
   * the only reason to log a destructive operation at all.
   */
  readonly refreshedBodies: readonly RefreshedBody[];
}

const LABEL_WIDTH = 12;

/**
 * Render the summary.
 *
 * ⚠️ THE `unmatched usernames` COUNT DESCRIBES THE SOURCE, NOT ONE ENTITY. It
 * reports 19 posts because all 19 of the export's posts are authored by
 * `system`, which matches no `User` (A-4). Batch 8's wording said the count was
 * a superset of what the run wrote, because the 8 curriculum bodies were still
 * unwritten; **Task 11.4 closes that** — the same 19 now split into 10 forum
 * posts, 1 skipped empty body and 8 lesson bodies, which is exactly what the two
 * `assertions:` lines below show. The clause says so, so the arithmetic is not
 * read as a bug by the next person to run this.
 *
 * ⚠️ `0 transformed` IS A CLAIM, NOT A DECORATION. `bodyMarkdown` is the
 * export's `raw` copied verbatim — no re-wrap, no entity decoding, not even a
 * trim. `community-seed.spec.ts` asserts it byte for byte. If a transform is
 * ever added, this number must move with it or the summary becomes a lie that
 * looks like a checksum.
 */
export function formatSummary(summary: SeedSummary): string {
  const lines: string[] = ['Community seed complete'];

  for (const entity of summary.entities) {
    lines.push(
      `  ${`${entity.label}:`.padEnd(LABEL_WIDTH)} created ${String(
        entity.counts.created,
      ).padEnd(2)} updated ${entity.counts.updated}`,
    );
  }

  for (const unmatched of summary.unmatchedUsernames) {
    lines.push(
      `  unmatched usernames: ${unmatched.username} (${unmatched.postCount} posts)` +
        ' -> attributed to the system author (A-4); the count is the SOURCE total,' +
        ' now fully accounted for across forum posts and lesson bodies by the assertions below',
    );
  }

  lines.push(
    `  bodies: ${summary.bodies.imported}/${summary.bodies.total} imported from \`raw\`; ` +
      `${summary.bodies.transformed} transformed`,
  );

  for (const skipped of summary.skippedEmptyBodies) {
    lines.push(
      `  skipped: ${skipped.topicSlug} post #${skipped.postNumber} — empty source body ` +
        '(Discourse small-action marker, not content); see SKIP_EMPTY_BODY_POSTS',
    );
  }

  for (const refreshed of summary.refreshedBodies) {
    const subject =
      refreshed.kind === 'post'
        ? `${refreshed.topicSlug} post #${refreshed.postNumber}`
        : `${refreshed.moduleSlug}/${refreshed.lessonSlug} lesson`;
    lines.push(
      `  refreshed: ${subject} — ` +
        `overwrote ${refreshed.previousLength} chars with ${refreshed.newLength} (--refresh-bodies)`,
    );
  }

  for (const assertion of summary.assertions) {
    lines.push(`  assertions: ${assertion}`);
  }

  return lines.join('\n');
}
