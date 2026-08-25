/**
 * Category mapping — TASK_2026_177 Task 8.4, plan §7.3, MG-1.4.
 *
 * Four rows, keyed on the SOURCE category id. plan §7.1 records a correction to
 * MG-1.6 that this file implements: MG-1.6 remembers "Start here" and
 * "Questions" as living in General; in the export they are both in Builders
 * Lounge (source id 5), and General holds two different topics. Mapping by
 * source id yields the placement the export actually has, and cannot drift back
 * to the misremembered one.
 */
import type {
  DiscourseExport,
  DiscourseExportCategory,
} from './discourse-export.schema';

/** `Category.visibility` — 'member' | 'cohort' | 'staff' (R1.1.1). */
export type CategoryVisibility = 'member' | 'cohort' | 'staff';

/** One row of MG-1.4's mapping table, before the cohort key is resolved. */
export interface CategoryMappingRule {
  readonly sourceId: number;
  readonly slug: string;
  readonly visibility: CategoryVisibility;
  readonly sortOrder: number;
}

/**
 * MG-1.4 / plan §7.3, verbatim.
 *
 * ⚠️ `cohortKeys` IS NOT IN THIS TABLE. It is derived at run time from the
 * default `MemberGroup`, and only for the one `cohort` row. Hard-coding
 * `['founding']` here would survive a rename of the cohort and silently gate the
 * category on a key nothing matches — which fails open in the direction of
 * showing nobody the content, but fails closed in review, because the table
 * would still look right.
 */
export const CATEGORY_MAPPING: readonly CategoryMappingRule[] = [
  { sourceId: 4, slug: 'general', visibility: 'member', sortOrder: 10 },
  {
    sourceId: 5,
    slug: 'builders-lounge',
    visibility: 'cohort',
    sortOrder: 20,
  },
  { sourceId: 2, slug: 'site-feedback', visibility: 'member', sortOrder: 30 },
  { sourceId: 3, slug: 'staff', visibility: 'staff', sortOrder: 40 },
] as const;

/** Thrown when no default `MemberGroup` exists to gate the cohort category on. */
export class MissingDefaultCohortError extends Error {
  constructor() {
    super(
      'No MemberGroup has isDefault = true, so the cohort-gated category cannot be gated on anything.\n' +
        'Seeding it with an empty cohortKeys array would leave `builders-lounge` visible to every entitled member,\n' +
        'which is the opposite of what visibility: "cohort" means. Set a default group in the admin surface\n' +
        '(Admin -> Member Groups) and re-run. Nothing has been written.',
    );
    this.name = 'MissingDefaultCohortError';
  }
}

/** Thrown when the export's categories do not match {@link CATEGORY_MAPPING}. */
export class CategoryMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryMappingError';
  }
}

/**
 * Turn the one HTML-bearing source field into plain text.
 *
 * ⚠️ `Category.description` IS THE ONE FIELD DISCOURSE CARRIES AS HTML — it has
 * no authored-markdown counterpart, unlike every post body. Four rows, one
 * sentence each. Stripping tags with a fixed regex and storing plain text is
 * what keeps "no HTML anywhere in this pipeline" TOTAL rather than
 * nearly-total: the column is typed and rendered as plain text everywhere in
 * this task, it never reaches `libs/frontend/markdown`, and it never reaches
 * `[innerHTML]`.
 *
 * ⚠️ THIS IS NOT A SANITISER AND MUST NEVER BE USED AS ONE. It is a one-shot
 * transform over four known strings from a trusted, committed file, executed
 * once at seed time by an operator. A regex is categorically the wrong tool for
 * untrusted HTML. The guard below exists so that if the source ever stops being
 * these four sentences — nested markup, an entity, an attribute containing `>` —
 * the seed aborts instead of storing something that looks like plain text and
 * is not.
 */
export function stripHtmlToPlainText(html: string): string {
  const text = html
    .replace(/<[^<>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.includes('<') || text.includes('>')) {
    throw new CategoryMappingError(
      `Category description still contains angle brackets after tag stripping: ${JSON.stringify(
        text,
      )}. The fixed regex in stripHtmlToPlainText() is not sufficient for this ` +
        'input. Correct the export or widen the transform deliberately; do not store it as-is.',
    );
  }

  if (/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/.test(text)) {
    throw new CategoryMappingError(
      `Category description contains an HTML entity after tag stripping: ${JSON.stringify(
        text,
      )}. Entities render as literal "&amp;" once the value is treated as plain ` +
        'text. Decode it in the export or add a decoding step deliberately.',
    );
  }

  return text;
}

/** A category row ready to be written, in `Category` field names. */
export interface CategorySeedRow {
  readonly sourceId: number;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly sortOrder: number;
  readonly visibility: CategoryVisibility;
  readonly cohortKeys: readonly string[];
}

/**
 * Build the four category rows.
 *
 * `cohortKey` is the resolved default `MemberGroup.key`. It is applied ONLY to
 * the `cohort` row; a `member` or `staff` category with a non-empty
 * `cohortKeys` would be a contradiction the schema does not forbid (the docblock
 * on `Category.cohortKeys` says "empty while visibility != 'cohort'", which is a
 * comment, not a constraint).
 */
export function buildCategoryRows(
  exportData: DiscourseExport,
  cohortKey: string,
): readonly CategorySeedRow[] {
  const bySourceId = new Map<number, DiscourseExportCategory>(
    exportData.categories.map((c) => [c.id, c]),
  );

  return CATEGORY_MAPPING.map((rule) => {
    const source = bySourceId.get(rule.sourceId);
    if (!source) {
      throw new CategoryMappingError(
        `The export has no category with source id ${rule.sourceId} (expected "${rule.slug}"). ` +
          `Present ids: ${[...bySourceId.keys()].join(', ')}. ` +
          'MG-1.4 maps by source id; a renumbered export needs CATEGORY_MAPPING updated deliberately.',
      );
    }

    return {
      sourceId: rule.sourceId,
      slug: rule.slug,
      name: source.name,
      description:
        source.description === null
          ? null
          : stripHtmlToPlainText(source.description),
      sortOrder: rule.sortOrder,
      visibility: rule.visibility,
      cohortKeys: rule.visibility === 'cohort' ? [cohortKey] : [],
    };
  });
}
