/**
 * The Discourse export schema — TASK_2026_177 Task 8.3, plan §7.2.
 *
 * THIS FILE IS NOT BOILERPLATE. It is where every content-integrity property of
 * the MG-1 migration is asserted mechanically, before a single row is written,
 * instead of by a human reading a diff. The original defect this whole batch
 * exists to prevent — an export in which all 19 bodies came back `null` because
 * `/t/{id}.json` omits the markdown — passed human review, because the file was
 * large and well-formed and the missing field was one key among five.
 *
 * ⚠️ THE RENDERED-HTML FIELD IS NOT DECLARED HERE AT ALL, AND THAT IS STRONGER
 * THAN plan §7.2's `z.unknown()`. §7.2 types it as `unknown` so that reading it
 * is a compile error. But a Zod object schema STRIPS undeclared keys, so simply
 * not declaring it means the field is absent from the parsed value at runtime as
 * well as from its type — there is nothing left to read, not merely nothing
 * usefully typed. It also lets AD-8's quarantine be enforced as a literal
 * source-text assertion over every file in this directory (Task 8.7 assertion
 * 7), which `z.unknown()` would have made impossible: the declaration itself
 * would have been the first violation. Ptah renders member content through
 * `libs/frontend/markdown`, a markdown chokepoint; feeding it Discourse's
 * pre-rendered HTML would push HTML through a sanitiser configured for markdown.
 * The authored markdown in `raw` is the source of truth and the only field read.
 *
 * ⚠️ `raw` IS `z.string()`, WHICH REJECTS `null`. That is the RK-9 control: the
 * regression that produced the original defect fails loudly here rather than
 * writing 19 empty bodies. See {@link EXPECTED_NON_EMPTY_BODY_POSTS} for the
 * second half of that control and for a real discrepancy in the current export.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * How many of the export's posts must carry a non-empty `raw`.
 *
 * 🔴 THIS IS 20, NOT 21, AND THE PLAN SAYS 21. plan §7.1 records "`raw`
 * populated: 19 of 19. Zero nulls. 12,474 chars of markdown", and Task 8.3
 * therefore prescribes `raw: z.string().min(1)`. The character total is right
 * and "zero nulls" is literally true, but the export contains **one post whose
 * `raw` is the empty string**: topic 13 ("Start here — how this cohort works"),
 * post #2, whose rendered field is empty too. That is the signature of a
 * Discourse *small-action* post — the grey one-line marker Discourse writes when
 * a topic is pinned, which topic 13 is — not a body that failed to capture.
 *
 * `.min(1)` as specified would therefore abort on the real export and the seed
 * could never run at all. Relaxing `raw` to "any string" would delete the
 * control instead. This constant is the third option and the one the repo
 * already uses elsewhere (`EXPECTED_ROUTES`, `NAMED_PRIMITIVE_PARAM_COUNT`): an
 * **exact census**, checked by equality. A re-capture that regresses to empty
 * bodies aborts, because 0 ≠ 20. A re-capture that fixes the phantom post also
 * aborts, because 21 ≠ 20 — which is correct: that is a change to the content
 * source and a human should acknowledge it rather than have it slip through.
 *
 * TASK_2026_202 moved this pair 18/19 → 20/21 by adding two curriculum topics
 * (source ids 24 and 25) when the eight weekly modules became ten daily ones.
 * The one skipped small-action post is untouched, so the invariant
 * `NON_EMPTY = POST_COUNT − 1` is unchanged and the exact-census control is
 * intact — the pair moved together, which is the only way it may ever move.
 *
 * The seed skips the one empty-body post rather than writing a blank reply into
 * the product; see `SKIP_EMPTY_BODY_POSTS` in `map-topics.ts`.
 */
export const EXPECTED_NON_EMPTY_BODY_POSTS = 20;

/** MG-1.6's counts, asserted before any write rather than counted after one. */
export const EXPECTED_CATEGORY_COUNT = 4;
export const EXPECTED_TOPIC_COUNT = 19;
export const EXPECTED_POST_COUNT = 21;

/** The U+FFFD replacement character, built from its code point. */
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

const exportPostSchema = z.object({
  postNumber: z.number().int().positive(),
  username: z.string().min(1),
  createdAt: z.iso.datetime(),
  /**
   * MG-1.9. `z.string()` rejects `null`, which is the exact regression that
   * produced the original defect. The refinement below rejects mojibake: a
   * mangled em-dash still "looks like markdown" and survives review, so it has
   * to fail here or it will not fail anywhere.
   */
  raw: z
    .string()
    .refine(
      (s) => !s.includes(REPLACEMENT_CHARACTER),
      'raw contains a U+FFFD replacement character (mojibake); re-capture the export with UTF-8',
    ),
});

const exportTopicSchema = z.object({
  id: z.number().int(),
  title: z.string().min(1),
  /**
   * The natural key the whole import is idempotent on (AD-15). Constrained to
   * the character set `libs/api/forum/src/lib/common/slug.ts` produces, so a
   * source slug that a natively-created topic could never have had — a leading
   * hyphen, an uppercase letter, a double hyphen — aborts instead of becoming a
   * permanent public identifier. The seed reuses these slugs rather than
   * regenerating them; see `map-topics.ts`.
   */
  slug: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'topic slug must match the generator in libs/api/forum/src/lib/common/slug.ts',
    ),
  categoryId: z.number().int(),
  categoryName: z.string(),
  pinned: z.boolean(),
  createdAt: z.iso.datetime(),
  posts: z.array(exportPostSchema).min(1),
});

const exportCategorySchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  slug: z.string().min(1),
  /** HTML in the source. Never stored as HTML — see `map-categories.ts`. */
  description: z.string().nullable(),
  color: z.string(),
  read_restricted: z.boolean(),
  topic_count: z.number().int(),
});

export const discourseExportSchema = z
  .object({
    exportedFrom: z.string().min(1),
    /**
     * Why the per-post fetch is necessary. Validated as present and non-empty on
     * purpose (§7.2): it records that `/t/{id}.json` omits the markdown, so the
     * shortcut that caused the original defect cannot be silently reintroduced
     * by someone who re-captures the export and drops the note with it.
     */
    note: z.string().min(1),
    categories: z.array(exportCategorySchema).length(EXPECTED_CATEGORY_COUNT),
    topics: z.array(exportTopicSchema).length(EXPECTED_TOPIC_COUNT),
  })
  .refine(
    (d) => countPosts(d.topics) === EXPECTED_POST_COUNT,
    `export must contain exactly ${EXPECTED_POST_COUNT} posts`,
  )
  .refine(
    (d) =>
      d.topics.reduce(
        (n, t) => n + t.posts.filter((p) => p.raw.length > 0).length,
        0,
      ) === EXPECTED_NON_EMPTY_BODY_POSTS,
    `exactly ${EXPECTED_NON_EMPTY_BODY_POSTS} of the ${EXPECTED_POST_COUNT} posts must carry a non-empty body`,
  )
  .refine(
    (d) => new Set(d.topics.map((t) => t.slug)).size === EXPECTED_TOPIC_COUNT,
    'topic slugs must be unique — they are the upsert key for the whole import',
  );

export type DiscourseExport = z.infer<typeof discourseExportSchema>;
export type DiscourseExportTopic = DiscourseExport['topics'][number];
export type DiscourseExportPost = DiscourseExportTopic['posts'][number];
export type DiscourseExportCategory = DiscourseExport['categories'][number];

function countPosts(topics: readonly { posts: readonly unknown[] }[]): number {
  return topics.reduce((n, t) => n + t.posts.length, 0);
}

/**
 * Thrown when the export file is unreadable, is not JSON, or fails the schema.
 *
 * Named so the entry point can tell a content problem from a configuration one
 * and print a different remedy for each.
 */
export class ExportValidationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(
      issues.length > 0 ? `${message}\n  - ${issues.join('\n  - ')}` : message,
    );
    this.name = 'ExportValidationError';
  }
}

/**
 * Validate an already-parsed value against the schema.
 *
 * ⚠️ THE WHOLE FILE IS VALIDATED BEFORE A SINGLE WRITE (MG-1.2). Streaming
 * validation — validate a topic, write it, validate the next — would leave a
 * partial import behind when post 12 of 19 turns out to be malformed, and the
 * operator would then have to work out which half landed.
 */
export function validateDiscourseExport(value: unknown): DiscourseExport {
  const result = discourseExportSchema.safeParse(value);
  if (result.success) return result.data;

  throw new ExportValidationError(
    'The Discourse export failed validation; nothing was written.',
    result.error.issues.map(
      (i) => `${i.path.join('.') || '<root>'}: ${i.message}`,
    ),
  );
}

/**
 * Read and validate the export from disk.
 *
 * The read, the JSON parse and the schema check each raise the same named error
 * so that every "the content source is wrong" failure reaches the operator as
 * one category with one remedy, distinct from "the database is unconfigured".
 */
export function readDiscourseExport(path: string): DiscourseExport {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error: unknown) {
    throw new ExportValidationError(
      `Could not read the Discourse export at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    throw new ExportValidationError(
      `The Discourse export at ${path} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return validateDiscourseExport(parsed);
}
