/**
 * YouTube video-id extraction — R2.2.1.
 *
 * ⚠️ DETERMINISTIC AND PURE. {@link extractVideoId} is a total function of its
 * input. It performs no network I/O, reads no configuration and never throws:
 * every input it does not recognise yields `null`. It is the SERVER-SIDE half
 * of R2.2.1 ("the 11-char YouTube id, extracted server-side from an id or
 * URL") — an admin may paste whatever their browser gave them and the column
 * still receives a canonical id.
 *
 * ⚠️ WHAT THIS IS NOT: it is **not** a validity check. A syntactically perfect
 * id for a video that does not exist, is private, or is not embeddable comes
 * back from here unchanged — those three outcomes are the YouTube Data API's
 * answer (plan §4.4) and only `YouTubeMetadataProvider.fetchVideo()` can
 * produce them. Treating a non-`null` return as "this video is usable" is the
 * mistake this paragraph exists to prevent.
 *
 * ⚠️ {@link VIDEO_ID_PATTERN} IS DECLARED HERE, EXPORTED, AND IS THE ONLY COPY.
 * Plan §4.6.3 requires the same regex on the frontend, immediately before
 * `bypassSecurityTrustResourceUrl` builds the embed URL (Batch 10, Task 10.3).
 * That consumer IMPORTS this constant. Two independent spellings of the same
 * regex is how one of them drifts — and the one that drifts is the one guarding
 * a trusted-URL construction.
 */

/**
 * The canonical YouTube video-id shape: exactly 11 characters from the
 * URL-safe base64 alphabet.
 *
 * ⚠️ `+` AND `/` ARE EXCLUDED ON PURPOSE. YouTube ids use the URL-SAFE
 * alphabet (`-` and `_`), not standard base64. An 11-character string
 * containing `+` or `/` is the realistic wrong input — it is what a caller
 * pasted from somewhere that re-encoded the id — and accepting it would build
 * an embed URL whose path silently breaks at the `/`.
 *
 * Anchored at both ends, so it is safe to use directly as a whole-string test.
 * It carries no `g` flag, so it holds no `lastIndex` state and repeated
 * `.test()` calls cannot alternate true/false — a real hazard for a module-level
 * shared `RegExp`.
 */
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Hostnames a YouTube video id may legitimately arrive on.
 *
 * ⚠️ THE HOST IS CHECKED, so `https://evil.example.com/watch?v=<id>` yields
 * `null` rather than an id. Nothing downstream is compromised by a wrong id
 * here — the id is re-fetched against the Data API and the embed is built from
 * the id alone, never from the pasted URL — but silently accepting an arbitrary
 * host means an admin who pasted the wrong link gets a lesson that looks saved
 * and points at the wrong video. A refusal is the honest answer.
 *
 * `youtube-nocookie.com` is included because plan §4.6.2 makes it the embed
 * host, so it is the domain an admin copying a URL out of our OWN player will
 * paste back in.
 */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** Short-link host. Its FIRST path segment is the id — there is no `/watch`. */
const YOUTU_BE_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

/**
 * Path prefixes whose NEXT segment is the video id.
 *
 * `/v/` is the long-dead Flash embed path and is included because old course
 * material and old bookmarks still carry it; it costs one array entry.
 */
const PATH_PREFIXES = ['embed', 'shorts', 'live', 'v'];

/**
 * Extract the canonical 11-character video id from a bare id or any YouTube
 * URL form, or return `null`.
 *
 * Accepted:
 * - a bare id — `dQw4w9WgXcQ`
 * - `https://www.youtube.com/watch?v=<id>` (plus any other query parameters,
 *   in any order — `&t=42s`, `&list=...`, `&si=...`)
 * - `https://youtu.be/<id>` (plus query parameters)
 * - `https://www.youtube.com/embed/<id>`
 * - `https://www.youtube.com/shorts/<id>`
 * - `https://www.youtube.com/live/<id>`
 * - `https://www.youtube.com/v/<id>`
 * - any of the above without a scheme (`youtu.be/<id>`), because that is what
 *   a mobile share sheet produces
 *
 * Everything else — a channel URL, a playlist URL with no `v`, a 10- or
 * 12-character id, an id containing `+` or `/`, a non-YouTube host, the empty
 * string — returns `null`.
 */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }

  // A bare id is the common authoring case and needs no URL parsing at all.
  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const url = parseUrl(trimmed);
  if (url === null) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  // `pathname` always begins with `/`, so segment 0 of a naive split is the
  // empty string. Filtering blanks also collapses a trailing slash.
  const segments = url.pathname.split('/').filter((segment) => segment !== '');

  if (YOUTU_BE_HOSTS.has(host)) {
    return canonicalise(segments[0]);
  }

  if (!YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  if (segments[0] === 'watch') {
    return canonicalise(url.searchParams.get('v') ?? undefined);
  }

  if (segments[0] !== undefined && PATH_PREFIXES.includes(segments[0])) {
    return canonicalise(segments[1]);
  }

  return null;
}

/**
 * Parse `value` as an absolute URL, tolerating a missing scheme.
 *
 * ⚠️ THE SCHEME IS ONLY SUPPLIED WHEN THE INPUT HAS NO `:` BEFORE ITS FIRST
 * `/`. Blindly prefixing `https://` would turn `javascript:alert(1)/watch?v=x`
 * into a parseable https URL whose hostname is `javascript:alert(1)` — which
 * fails the host check anyway, but only by accident. Refusing to re-scheme
 * something that already carries a scheme keeps the refusal deliberate.
 *
 * Returns `null` instead of throwing, so the caller has one shape to handle.
 */
function parseUrl(value: string): URL | null {
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
    ? value
    : `https://${value}`;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

/** Return `value` when it is a well-formed id, `null` otherwise. */
function canonicalise(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  return VIDEO_ID_PATTERN.test(value) ? value : null;
}
