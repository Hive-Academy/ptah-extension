/**
 * `@ptah-api/youtube` — the single outbound YouTube Data API v3 integration
 * (TASK_2026_177, Phase 3, plan §4).
 *
 * One outbound integration, no persistence. This lib never sees Prisma, never
 * sees a `MemberContext`, never sees an HTTP request or response, and never
 * throws — every outcome, including a timeout and a malformed upstream body,
 * is an arm of {@link YouTubeFetchResult}.
 *
 * ⚠️ `youtube.schemas.ts` IS DELIBERATELY NOT EXPORTED. A consumer that can
 * reach the Zod schema can parse a hand-written object into something shaped
 * like a `YouTubeVideoMetadata` without ever calling `fetchVideo()` —
 * bypassing plan §4.4's outcome mapping, which is what refuses private and
 * non-embeddable videos. That bypass is the one thing this lib exists to
 * prevent, so the schema stays inside it. Same reasoning for
 * `resolveThumbnailUrl`, which is a detail of that mapping.
 *
 * ⚠️ `VIDEO_ID_PATTERN` IS EXPORTED BECAUSE IT HAS A SECOND, DISTANT CONSUMER.
 * Plan §4.6.3 requires the identical regex on the frontend immediately before
 * `bypassSecurityTrustResourceUrl` builds the embed URL (Batch 10, Task 10.3).
 * That consumer imports this constant rather than re-spelling it — two copies
 * of a regex guarding a trusted-URL construction is how the guard drifts.
 */

export { YoutubeModule } from './lib/youtube.module';
export { YouTubeMetadataProvider } from './lib/youtube-metadata.provider';
export { extractVideoId, VIDEO_ID_PATTERN } from './lib/extract-video-id';
export { parseIso8601Duration } from './lib/parse-iso8601-duration';
export type {
  YouTubeFetchError,
  YouTubeFetchResult,
  YouTubeVideoMetadata,
} from './lib/youtube.types';
