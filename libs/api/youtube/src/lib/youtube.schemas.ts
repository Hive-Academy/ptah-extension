import { z } from 'zod';

/**
 * The Zod boundary for `videos.list` — plan §4.3, R2.2.3, NFR-S1.
 *
 * 🔴 NOT ONE FIELD IS PERSISTED BEFORE `safeParse` SUCCEEDS. This is the only
 * place an untrusted third-party body becomes typed data in this lib, and a
 * failure here maps to `{ ok: false, error: 'malformed_response' }` — never to
 * a partially populated `Lesson`.
 *
 * ⚠️ THIS MODULE IS NOT EXPORTED FROM THE LIB BARREL, ON PURPOSE. A consumer
 * that can reach this schema can parse a hand-written object into something
 * shaped like a `YouTubeVideoMetadata` without ever calling `fetchVideo()` —
 * bypassing the §4.4 outcome mapping that refuses private and non-embeddable
 * videos. That bypass is the single thing this lib exists to prevent, so the
 * schema stays inside it.
 *
 * ⚠️ THIS MODULE EXPORTS NO "PARSE OR DEFAULT" HELPER, AND MUST NOT GAIN ONE.
 * The first caller to reach for a parse-with-fallback is the caller that
 * persists garbage under a plausible-looking default. `safeParse` at the one
 * call site, with the failure folded into the result union, is the whole
 * design. {@link resolveThumbnailUrl} is not such a helper: it takes ALREADY
 * PARSED data and selects among fields the schema has already validated. It
 * cannot turn an unvalidated body into a value.
 *
 * ⚠️ ZOD IS 4.3.6 HERE. `z.string().url()` is the deprecated v3 spelling;
 * `z.url()` is the v4 form. Both currently type-check, which is exactly why the
 * wrong one survives review.
 */

/**
 * A single thumbnail entry.
 *
 * The URL is validated as a URL rather than as a bare string: it is
 * interpolated into an `<img src>` on the member course pages, and an
 * unvalidated value from an upstream response is not something to put there.
 */
const thumbnailSchema = z.object({ url: z.url() });

/**
 * The `snippet.thumbnails` map.
 *
 * ⚠️ ALL THREE SIZES ARE `.optional()`. YouTube omits `high` on some videos
 * (notably very old uploads and some shorts), and a required field would turn
 * a perfectly good video into a `malformed_response`. The selection rule lives
 * in {@link resolveThumbnailUrl}, which returns `null` when all three are
 * absent rather than throwing — plan §4.3.
 */
const thumbnailsSchema = z.object({
  medium: thumbnailSchema.optional(),
  high: thumbnailSchema.optional(),
  default: thumbnailSchema.optional(),
});

/**
 * The `videos.list` response shape this lib depends on — plan §4.3 verbatim.
 *
 * By default Zod objects STRIP unknown keys, which is what we want: a real
 * response also carries `kind`, `etag` and `pageInfo`, plus dozens of fields
 * inside `snippet` and `status` that this lib has no business reading. Adding
 * `.strict()` would make every additive change YouTube ships a
 * `malformed_response`.
 *
 * ⚠️ `privacyStatus` IS A CLOSED ENUM OF THREE. `'unlisted'` is one of them and
 * is ACCEPTED — unlisted is the Checkpoint-0 delivery model for every course
 * video in this product (plan §4.4's footnote). A schema that admitted only
 * `'public'` would reject the entire content library.
 */
export const youtubeVideoListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z.object({
        title: z.string(),
        thumbnails: thumbnailsSchema,
      }),
      // ISO-8601, e.g. "PT1H2M3S". Kept as a string here and converted by
      // `parseIso8601Duration`, so an unconvertible value is distinguishable
      // from an absent one.
      contentDetails: z.object({ duration: z.string() }),
      status: z.object({
        privacyStatus: z.enum(['public', 'unlisted', 'private']),
        embeddable: z.boolean(),
      }),
    }),
  ),
});

/** The parsed `videos.list` body. */
export type YoutubeVideoListResponse = z.infer<
  typeof youtubeVideoListResponseSchema
>;

/** One validated `items[]` entry. */
export type YoutubeVideoListItem = YoutubeVideoListResponse['items'][number];

/**
 * Pick the best available thumbnail: `high`, else `medium`, else `default`,
 * else `null` — plan §4.3.
 *
 * Descending quality order, because the poster is rendered at card and hero
 * sizes and upscaling a 120px `default` is visibly worse than downscaling a
 * 480px `high`.
 *
 * ⚠️ TAKES PARSED INPUT ONLY. Its parameter type comes from the schema above,
 * so it is unreachable without a successful `safeParse`. It is therefore not
 * the "parse or default" helper the module docblock forbids.
 */
export function resolveThumbnailUrl(
  thumbnails: YoutubeVideoListItem['snippet']['thumbnails'],
): string | null {
  return (
    thumbnails.high?.url ??
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    null
  );
}
