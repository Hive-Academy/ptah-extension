/**
 * 🔴 THE WORKSPACE'S FIRST TRUSTED-URL CONSTRUCTION, AND THE VALIDATION HALF OF
 * IT (TASK_2026_177 Task 10.3, RISK-S, NFR-S3, plan §4.6.3, R2.2.7).
 *
 * `bypassSecurityTrustResourceUrl` disables Angular's URL sanitizer for the
 * value it is handed. Before Batch 10 that API appeared NOWHERE in this
 * repository — verified by `rg` across `libs` and `apps`, zero hits — so there
 * is no precedent to imitate and nothing that would have noticed a second call
 * site appearing. This file and `youtube-player.ts` are that chokepoint, split
 * in two on purpose:
 *
 *   · THIS FILE VALIDATES AND BUILDS A PLAIN `string`. No Angular import, no
 *     `DomSanitizer`, no `TestBed` needed to test it — so the hostile-input
 *     cases below are a pure-function table rather than a component harness.
 *   · `lib/learning/youtube-player.ts` IS THE ONE PLACE THAT CALLS THE BYPASS,
 *     and it calls it ONLY on a non-`null` return from here.
 *
 * `lib/youtube-embed-chokepoint.spec.ts` asserts both halves structurally: the
 * bypass appears in exactly one named file, that file's argument expression
 * references {@link buildYoutubeEmbedUrl}, and no other file in
 * `libs/web/members` carries a `youtube.com` / `youtube-nocookie.com` literal.
 * It is a deliberate sibling of `markdown-chokepoint.spec.ts` — a second
 * chokepoint of the same SHAPE (one path from a persisted string to a trusted
 * value) but a different invariant, so the two failure messages stay tellable
 * apart.
 *
 * ⚠️ VALIDATION RUNS ON THE ID, NOT ON THE ASSEMBLED URL. Checking a
 * concatenated string is how `abcdefghijk"></iframe><script>` and
 * `../../evil` survive: by then the dangerous characters are indistinguishable
 * from the ones the template put there. The id is tested against an anchored,
 * exact-length pattern FIRST, and the host and every query parameter are
 * literals in this file — the id is the only interpolated value (§4.6.3).
 *
 * ⚠️ IT RETURNS `null` AND NEVER THROWS, AND NEVER RETURNS A PARTIAL URL. The
 * caller renders the poster with a stated "unavailable" message rather than
 * pointing an iframe at something unvalidated. A throw would tempt a `try` that
 * swallows, and a partial URL is the failure mode this whole file exists to
 * foreclose.
 */

/**
 * The canonical YouTube video-id shape: exactly 11 characters from the URL-safe
 * base64 alphabet.
 *
 * 🔴 DECLARED HERE RATHER THAN IMPORTED, AND THAT IS A BOUNDARY FACT, NOT AN
 * OVERSIGHT. `libs/api/youtube/src/lib/extract-video-id.ts` exports an
 * identical `VIDEO_ID_PATTERN` and its docblock says "that consumer IMPORTS
 * this constant". It cannot: `libs/web/*` is tagged `scope:web`, which
 * `eslint.config.mjs` permits to depend on `scope:shared`, `scope:web` and
 * `scope:api-contracts` ONLY — never on `scope:api`. The import would be a
 * lint error, not a shortcut.
 *
 * So there are two copies and they MUST agree. That is turned from a convention
 * into an assertion: `youtube-embed-chokepoint.spec.ts` reads both files and
 * compares the literal pattern text. If either is edited alone, the build
 * fails naming both paths.
 *
 * ⚠️ ANCHORED AT BOTH ENDS, EXACT LENGTH, NO FLAGS.
 *   · `^…$` with `{11}` — not `{11,}`, not unanchored. An unanchored pattern
 *     accepts `abcdefghijk"></iframe><script>`; the anchoring IS the control.
 *   · No `m` flag — with `m`, `$` matches before a trailing newline and
 *     `"abcdefghijk\n"` would validate. There is a spec case for exactly that.
 *   · No `g` flag — a `/g` regex carries `lastIndex` between calls, so a
 *     module-level shared instance would alternate true/false on the same
 *     input. `api-youtube` asserts `.global === false` on its copy for the same
 *     reason.
 *   · `+` and `/` are excluded on purpose: YouTube ids use the URL-SAFE
 *     alphabet (`-` and `_`), and those two characters are precisely what
 *     distinguishes ordinary base64 from base64url — the realistic wrong input.
 */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * The privacy-preserving embed origin (NFR-S3, R2.2.7).
 *
 * ⚠️ `youtube-nocookie.com`, NEVER `youtube.com`. The nocookie domain does not
 * set advertising cookies until playback begins, which is the whole point of
 * the facade-then-player design: the poster costs the member nothing and the
 * player is an explicit act.
 */
const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

/**
 * Embed parameters, as a literal.
 *
 * `rel=0` keeps end-cards inside the same channel, `modestbranding=1` drops the
 * YouTube wordmark, and `enablejsapi=1` is REQUIRED — without it
 * `player.getCurrentTime()` does not work at all and `CoursePlayerStore` has
 * nothing to poll.
 */
const EMBED_PARAMS = 'rel=0&modestbranding=1&enablejsapi=1';

/**
 * Builds the `youtube-nocookie.com` embed URL for a persisted video id.
 *
 * @param videoId the raw `MemberLessonDetail.youtubeVideoId` off the wire —
 *   assume it is attacker-controlled even though the server validates it on
 *   write. Re-validation here is the point: this is the last check before a
 *   sanitizer is switched off.
 * @returns the embed URL, or `null` for ANY input the pattern rejects.
 */
export function buildYoutubeEmbedUrl(videoId: string): string | null {
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  // The id is the only interpolated value. Everything else is a literal above.
  return `${EMBED_ORIGIN}/embed/${videoId}?${EMBED_PARAMS}`;
}
