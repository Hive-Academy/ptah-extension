/**
 * Topic and post mapping — TASK_2026_177 Task 8.5, plan §7.3, MG-1.6 … MG-1.8.
 *
 * Pure. Nothing in this file touches the database; it turns a validated export
 * into the exact rows the writer will create, which is what makes byte-fidelity,
 * the timestamp property and the post census assertable without a database.
 */
import type {
  DiscourseExport,
  DiscourseExportTopic,
} from './discourse-export.schema';

/**
 * The 9 topics this batch imports as forum threads (MG-1.6).
 *
 * The remaining 8 — source ids 15…22, the "Week N build thread" topics — are
 * NOT forum topics. They become a course, and that is Batch 11's work against
 * the same module. Importing them here as threads and re-importing them there as
 * lessons would double the content.
 */
export const IMPORTED_TOPIC_IDS: readonly number[] = [
  5,
  23, // General
  13,
  14, // Builders Lounge
  8,
  9,
  10, // Site Feedback
  4,
  6, // Staff
] as const;

/** Source ids 15…22 — Batch 11's curriculum. Listed so the split is explicit. */
export const CURRICULUM_TOPIC_IDS: readonly number[] = [
  15, 16, 17, 18, 19, 20, 21, 22,
] as const;

/**
 * Skip posts whose `raw` is the empty string rather than writing a blank body.
 *
 * 🔴 THIS EXISTS BECAUSE THE EXPORT CONTAINS ONE SUCH POST AND THE PLAN SAYS IT
 * DOES NOT. Topic 13 ("Start here — how this cohort works", pinned), post #2:
 * `raw` is `""` and Discourse's rendered field is `""` too. Both being empty is
 * the signature of a Discourse *small-action* post — the grey one-line marker
 * written when a topic is pinned, which topic 13 was — rather than a body that
 * failed to capture. A capture failure leaves the rendered text populated and
 * only the markdown missing, which is exactly the defect the export commit
 * `a22b03eb6` fixed.
 *
 * ⚠️ THE SEED CANNOT PROVE THAT DISTINCTION AND MUST NOT TRY. AD-8 forbids this
 * module from reading Discourse's rendered field at all, so the only signal
 * available here is `raw.length === 0`. The classification above was made by a
 * human reading the export once; this constant records the resulting policy in
 * one place so it can be reversed by editing one line.
 *
 * ⚠️ THIS MOVES THE POST COUNT FROM 11 TO 10, AND THE EXIT GATE SAYS 11.
 * The three available options were: abort (specified, but then the seed can
 * never run against the real export at all); import the empty post (a blank
 * reply rendered in the product under a pinned welcome thread, and
 * `Topic.postCount` = 1 promising a reply that has no content); or skip it,
 * counted and named in the summary. The third writes nothing wrong into the
 * product and loses nothing recoverable — the post carried no content to lose.
 * The genuinely correct fix is upstream: re-capture the export without
 * small-action posts, at which point `EXPECTED_NON_EMPTY_BODY_POSTS` and
 * `EXPECTED_POST_COUNT` both move and this constant can go. Flagged for the user
 * in `batch-8-report.md`.
 */
export const SKIP_EMPTY_BODY_POSTS = true;

/** Thrown when the export cannot supply the topics MG-1.6 names. */
export class TopicMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopicMappingError';
  }
}

/** A post row ready to be written, in `Post` field names. */
export interface PostSeedRow {
  readonly postNumber: number;
  /**
   * The export's `raw`, copied verbatim. No transform, no re-wrap, no entity
   * decoding, no trimming. Byte-identical to the source is the property the exit
   * gate checks, and any normalisation — even a `.trim()` — breaks it.
   */
  readonly bodyMarkdown: string;
  /** MG-1.7. The source instant, never `now()`. */
  readonly createdAt: Date;
  /**
   * A-4 / MG-1.8. Every source username is `system`, which matches no `User`.
   * Always null; no placeholder `User` is fabricated, because `User` is the one
   * table entitlement derives from (A-2).
   */
  readonly authorId: null;
  /**
   * AD-9/R1.3.3. Post #1 is the topic's opening body; post #2 is a TOP-LEVEL
   * reply, not a child of post #1. Depth 3 is unrepresentable in this schema and
   * a reply to the opening body is depth 1, not depth 2.
   */
  readonly parentId: null;
}

/** A topic row ready to be written, in `Topic` field names. */
export interface TopicSeedRow {
  readonly sourceId: number;
  readonly categorySourceId: number;
  /** Reused from the export, not regenerated — see {@link buildTopicRows}. */
  readonly slug: string;
  readonly title: string;
  readonly pinned: boolean;
  readonly createdAt: Date;
  /** AD-11. Computed from the imported posts, in the same transaction. */
  readonly lastPostedAt: Date;
  /** AD-11. Replies only: excludes post #1. */
  readonly postCount: number;
  readonly authorId: null;
  readonly posts: readonly PostSeedRow[];
}

export interface TopicMappingResult {
  readonly topics: readonly TopicSeedRow[];
  /** Posts skipped by {@link SKIP_EMPTY_BODY_POSTS}, for the summary. */
  readonly skippedEmptyBodies: readonly {
    readonly topicSlug: string;
    readonly postNumber: number;
  }[];
}

/**
 * Build the 9 topic rows and their posts.
 *
 * ⚠️ THE EXPORT'S `slug` IS REUSED, NOT REGENERATED. `buildSlug()` in
 * `libs/api/forum/src/lib/common/slug.ts` is the create path's generator, and
 * calling it here would break idempotency outright: its collision resolver takes
 * the set of slugs already in use, so a second run would see the first run's
 * `guidelines`, resolve to `guidelines-2` and create a duplicate topic. The
 * export's slugs are stable, unique across all 17, and the schema constrains
 * them to exactly the character set `slugify()` emits — so the RULES are
 * reproduced and asserted, while the VALUES stay the ones the source published.
 * (16 of the 17 are byte-identical to `slugify(title)` anyway; the one exception
 * is topic 5, whose title ends in an emoji shortcode that Discourse dropped from
 * the slug and `slugify` would render as a trailing `-wave`.)
 */
export function buildTopicRows(
  exportData: DiscourseExport,
): TopicMappingResult {
  const byId = new Map<number, DiscourseExportTopic>(
    exportData.topics.map((t) => [t.id, t]),
  );

  const skippedEmptyBodies: {
    readonly topicSlug: string;
    readonly postNumber: number;
  }[] = [];

  const topics = IMPORTED_TOPIC_IDS.map((sourceId) => {
    const source = byId.get(sourceId);
    if (!source) {
      throw new TopicMappingError(
        `The export has no topic with source id ${sourceId}. MG-1.6 names 9 topics by id; ` +
          `present ids: ${[...byId.keys()].join(', ')}.`,
      );
    }

    const posts: PostSeedRow[] = [];
    for (const post of source.posts) {
      if (SKIP_EMPTY_BODY_POSTS && post.raw.length === 0) {
        skippedEmptyBodies.push({
          topicSlug: source.slug,
          postNumber: post.postNumber,
        });
        continue;
      }
      posts.push({
        postNumber: post.postNumber,
        bodyMarkdown: post.raw,
        createdAt: new Date(post.createdAt),
        authorId: null,
        parentId: null,
      });
    }

    if (posts.length === 0) {
      throw new TopicMappingError(
        `Topic ${sourceId} ("${source.slug}") has no importable post. A topic with no ` +
          'opening body has no content (AD-9) and must not be created.',
      );
    }

    const openingPost = posts.find((p) => p.postNumber === 1);
    if (!openingPost) {
      throw new TopicMappingError(
        `Topic ${sourceId} ("${source.slug}") has no post #1. AD-9 makes post #1 the ` +
          'topic body, so a topic without one would render empty.',
      );
    }

    return {
      sourceId,
      categorySourceId: source.categoryId,
      slug: source.slug,
      title: source.title,
      pinned: source.pinned,
      createdAt: new Date(source.createdAt),
      // AD-11, computed here rather than defaulted: the newest imported post.
      lastPostedAt: new Date(
        Math.max(...posts.map((p) => p.createdAt.getTime())),
      ),
      // AD-11: replies only. 1 for the multi-post topics, 0 for the rest.
      postCount: posts.filter((p) => p.postNumber > 1).length,
      authorId: null,
      posts,
    } satisfies TopicSeedRow;
  });

  return { topics, skippedEmptyBodies };
}
