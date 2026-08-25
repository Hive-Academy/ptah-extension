import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseIso8601Duration } from './parse-iso8601-duration';
import {
  resolveThumbnailUrl,
  youtubeVideoListResponseSchema,
} from './youtube.schemas';
import type { YouTubeFetchResult } from './youtube.types';

/**
 * YouTubeMetadataProvider — resolves a video id into the four columns
 * persisted on `Lesson`, via the YouTube Data API v3 `videos.list` endpoint
 * using `fetch` (NO googleapis npm package), plan §4.2.
 *
 * Design rules (mirrors `GoogleAuthProvider`, whose docblock this follows):
 * - Reads all config via `ConfigService` (NFR-S6 — never `process.env`),
 *   ONCE, in the constructor.
 * - NEVER throws. Transport failure, abort, non-2xx, unparseable JSON and Zod
 *   failure all fold into an `ok: false` arm of {@link YouTubeFetchResult}
 *   with a short sanitised reason — raw upstream bodies are never surfaced
 *   (NFR-S7).
 * - Feature-off: when `YOUTUBE_API_KEY` is unset, `isEnabled()` is `false` and
 *   no request is made — `{ ok: false, skipped: true }`, logged ONCE. This is
 *   NOT an error arm: the admin save proceeds with
 *   `videoMetadataSource: 'manual'` (R2.2.6), and that is exit-gate clause 3.
 * - A hung endpoint is bounded by an `AbortController` at
 *   {@link YouTubeMetadataProvider.TIMEOUT_MS}.
 *
 * ⚠️ NO CACHE, NO TTL, NO RETRY, NO BACKOFF (plan §4.5, RK-6). Metadata is
 * fetched once at authoring time and PERSISTED; persistence *is* the cache.
 * A member page view issues zero third-party calls (NFR-P6), which is why
 * there is nothing here to cache. `videos.list` costs 1 quota unit against a
 * 10,000/day default and authoring is tens of writes per month, so quota
 * tracking and a backoff scheduler are explicitly rejected rather than
 * forgotten.
 *
 * ⚠️ THE API KEY NEVER CROSSES TO THE CLIENT (RK-6). It appears in no returned
 * object and in no log line. The request URL is never logged, because the key
 * is a query parameter on it, and any upstream text that IS logged is passed
 * through {@link YouTubeMetadataProvider.redact} first.
 *
 * ⚠️ THIS LIB IMPORTS NOTHING FROM `libs/api/*`, deliberately. `ConfigService`
 * and `Logger` are npm packages outside the Nx tag graph, so `type:util`'s
 * `onlyDependOnLibsWithTags: ['type:util']` never has to be reasoned about.
 * See the README — RISK-Q is settled there.
 */
@Injectable()
export class YouTubeMetadataProvider {
  /**
   * Plan §4.2. Long enough that a slow-but-working Google response completes,
   * short enough that an admin saving a lesson does not sit on a spinner for a
   * quarter of a minute. It is asserted by a spec, not assumed: an unexercised
   * abort path is a 10-second hang in the authoring flow.
   */
  private static readonly TIMEOUT_MS = 10_000;

  private static readonly ENDPOINT =
    'https://www.googleapis.com/youtube/v3/videos';

  /** Cap on upstream text reaching a log line. Enough to identify, not to dump. */
  private static readonly MAX_LOGGED_BODY_CHARS = 300;

  private readonly logger = new Logger(YouTubeMetadataProvider.name);

  private readonly apiKey: string | undefined;

  /**
   * Guard owned by {@link isEnabledOrLogOnce}, so the disabled notice is
   * emitted once per process rather than once per authoring save.
   */
  private loggedDisabled = false;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.apiKey =
      this.configService.get<string>('YOUTUBE_API_KEY')?.trim() || undefined;
  }

  /**
   * True when `YOUTUBE_API_KEY` is configured. When false, callers treat
   * YouTube as a no-op (feature-off) rather than an error — R2.2.6, NFR-R1.
   */
  isEnabled(): boolean {
    return this.apiKey !== undefined;
  }

  /**
   * Resolve `videoId` into persistable metadata. Plan §4.4, in full.
   *
   * Never throws and never rejects. Every outcome is a value.
   */
  async fetchVideo(videoId: string): Promise<YouTubeFetchResult> {
    if (!this.isEnabledOrLogOnce()) {
      return { ok: false, skipped: true };
    }

    const response = await this.request(videoId);
    if (!response.ok) {
      return response.failure;
    }

    return this.mapBody(videoId, response.body);
  }

  /**
   * The disabled-log-once mechanism.
   *
   * ⚠️ A PRIVATE METHOD THAT RETURNS THE BOOLEAN *AND* OWNS THE FLAG, copied
   * in shape from `SessionsService.isEnabledOrLogOnce()`
   * (`libs/api/community/src/lib/google-sessions/sessions.service.ts:427-438`).
   * The alternative — a bare `loggedDisabled` field plus an
   * `if (!this.loggedDisabled)` at each call site — lets one call site forget
   * the check and lets another log twice. Here neither is expressible.
   *
   * (`GoogleAuthProvider`'s `loggedScopeVerdict` is a DIFFERENT idiom guarding
   * a scope verdict, not a disabled notice. RISK-R records the mix-up.)
   */
  private isEnabledOrLogOnce(): boolean {
    if (this.isEnabled()) {
      return true;
    }
    if (!this.loggedDisabled) {
      this.logger.log(
        'YouTube metadata integration disabled (YOUTUBE_API_KEY unset) — video metadata is admin-entered and saves proceed with videoMetadataSource: manual',
      );
      this.loggedDisabled = true;
    }
    return false;
  }

  /**
   * Perform the bounded request and return either the parsed JSON body or a
   * ready-made failure arm.
   *
   * Transport errors, aborts and non-2xx responses all resolve here — nothing
   * propagates out as an exception.
   */
  private async request(
    videoId: string,
  ): Promise<
    { ok: true; body: unknown } | { ok: false; failure: YouTubeFetchResult }
  > {
    const url = this.buildUrl(videoId);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      YouTubeMetadataProvider.TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        // Read the body for the LOG ONLY. A 403 quota body is the single most
        // useful thing an operator can see here, and the single thing that
        // must not reach the caller (NFR-S7).
        const text = await this.readBodyForLog(response);
        this.logger.warn(
          `YouTube videos.list failed for ${videoId}: HTTP ${response.status}${text}`,
        );
        return {
          ok: false,
          failure: {
            ok: false,
            error: 'unavailable',
            status: response.status,
          },
        };
      }

      // A 2xx whose body is not JSON is a MALFORMED RESPONSE, not a transport
      // failure. Both are `ok: false`, but they are different rows of §4.4 and
      // Task 9.12 maps them to different admin messages — folding an HTML
      // error page from a proxy into `unavailable` would be defensible, while
      // folding it into "we reached YouTube and it made no sense" is more
      // precise and is what the Zod branch below says for the same class of
      // defect one layer in.
      try {
        return { ok: true, body: await response.json() };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown JSON parse error';
        this.logger.warn(
          `YouTube videos.list returned a non-JSON 2xx body for ${videoId}: ${this.redact(message)}`,
        );
        return {
          ok: false,
          failure: { ok: false, error: 'malformed_response' },
        };
      }
    } catch (error: unknown) {
      // An abort arrives here as an AbortError, indistinguishable in KIND from
      // a DNS failure as far as the caller is concerned: both mean "we could
      // not reach YouTube", which is `unavailable` with no status.
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown YouTube transport error';
      this.logger.warn(
        `YouTube videos.list transport error for ${videoId}: ${this.redact(message)}`,
      );
      return { ok: false, failure: { ok: false, error: 'unavailable' } };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Apply plan §4.4's outcome table to a fetched body.
   *
   * Row order is the table's order. `private` is checked before `embeddable`
   * because a private video reports `embeddable: true` and "that video is
   * private" is the more actionable message.
   */
  private mapBody(videoId: string, body: unknown): YouTubeFetchResult {
    const parsed = youtubeVideoListResponseSchema.safeParse(body);
    if (!parsed.success) {
      // The Zod issue list can quote fragments of the upstream body, so it is
      // summarised to paths and codes rather than logged whole.
      this.logger.warn(
        `YouTube videos.list body failed schema validation for ${videoId}: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '<root>'}:${issue.code}`)
          .join(', ')}`,
      );
      return { ok: false, error: 'malformed_response' };
    }

    const item = parsed.data.items[0];
    if (item === undefined) {
      return { ok: false, error: 'not_found' };
    }

    // 'unlisted' is ACCEPTED — it is the Checkpoint-0 delivery model for every
    // course video in this product (plan §4.4's footnote).
    if (item.status.privacyStatus === 'private') {
      return { ok: false, error: 'private' };
    }

    if (!item.status.embeddable) {
      return { ok: false, error: 'not_embeddable' };
    }

    const durationSeconds = parseIso8601Duration(item.contentDetails.duration);
    if (durationSeconds === null) {
      // A body that parsed but carries a duration we cannot convert is not a
      // success with a missing field: `videoDurationSeconds` is the number
      // R2.3.2's completion threshold is computed against (ASSUMPTION-8), and
      // inventing one is the failure `parseIso8601Duration` returns null to
      // prevent. Surface it loudly instead.
      this.logger.warn(
        `YouTube videos.list returned an unparseable duration for ${videoId}: ${JSON.stringify(
          item.contentDetails.duration,
        )}`,
      );
      return { ok: false, error: 'malformed_response' };
    }

    return {
      ok: true,
      video: {
        videoId: item.id,
        title: item.snippet.title,
        durationSeconds,
        thumbnailUrl: resolveThumbnailUrl(item.snippet.thumbnails),
      },
    };
  }

  /**
   * Build the request URL.
   *
   * ⚠️ THE RETURN VALUE CARRIES THE API KEY AND MUST NEVER BE LOGGED. It is
   * built here and consumed once, in {@link request}, and appears in no other
   * expression.
   */
  private buildUrl(videoId: string): string {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails,status',
      id: videoId,
      // `isEnabledOrLogOnce()` gates every path that reaches here.
      key: this.apiKey ?? '',
    });
    return `${YouTubeMetadataProvider.ENDPOINT}?${params.toString()}`;
  }

  /**
   * Read an error response body for logging, truncated and redacted, and
   * tolerating a body that cannot be read at all.
   */
  private async readBodyForLog(response: Response): Promise<string> {
    try {
      const text = await response.text();
      if (text === '') {
        return '';
      }
      return ` — ${this.redact(
        text.slice(0, YouTubeMetadataProvider.MAX_LOGGED_BODY_CHARS),
      )}`;
    } catch {
      return '';
    }
  }

  /**
   * Belt-and-braces: strip the API key from any text about to be logged.
   *
   * Google does not echo the key in an error body today. This exists so that
   * "the key is in no log line" stays true if that ever changes, rather than
   * depending on an upstream service's discretion.
   */
  private redact(text: string): string {
    if (this.apiKey === undefined) {
      return text;
    }
    return text.split(this.apiKey).join('[REDACTED]');
  }
}
