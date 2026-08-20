import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  YOUTUBE_VIDEO_ID_PATTERN,
  buildYoutubeEmbedUrl,
} from './youtube-embed-url';

/**
 * RISK-S — the validation in front of the workspace's ONLY
 * `bypassSecurityTrustResourceUrl` call.
 *
 * ⚠️ THIS SPEC PROVES THE VALIDATION CANNOT BE BYPASSED, NOT MERELY THAT IT
 * WORKS. A single happy-path case would pass against `return url` with no check
 * at all. Every hostile row below is a real shape someone could put in the
 * `youtubeVideoId` column, and each names what it forecloses.
 *
 * ⚠️ IT NEEDS NO `TestBed`, AND THAT IS WHY THE FUNCTION IS PURE. Task 10.3
 * split validation (here) from the sanitizer bypass (`youtube-player.ts`)
 * precisely so the security-critical half is testable as a table.
 */
describe('buildYoutubeEmbedUrl — the trusted-URL chokepoint (RISK-S, NFR-S3)', () => {
  /* -------------------------------------------------------------------- */
  /* The controls. Without these the negative cases prove nothing.        */
  /* -------------------------------------------------------------------- */

  describe('the positive controls', () => {
    it('builds a URL for a well-formed 11-character id', () => {
      expect(buildYoutubeEmbedUrl('abcdefghijk')).toBe(
        'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0&modestbranding=1&enablejsapi=1',
      );
    });

    it('accepts an id made entirely of `-` and `_` (over-strictness control)', () => {
      // ⚠️ THE NEGATIVE CONTROL FOR THE NEGATIVE CASES. A pattern tightened to
      // `[A-Za-z0-9]{11}` would pass every hostile row below and silently break
      // every real lesson whose id contains a dash — which is most of them.
      const result = buildYoutubeEmbedUrl('-_-_-_-_-_-');
      expect(result).not.toBeNull();
      expect(result).toContain('/embed/-_-_-_-_-_-?');
    });

    it('accepts a realistic id with mixed case and a dash', () => {
      expect(buildYoutubeEmbedUrl('dQw4w9WgXcQ')).not.toBeNull();
    });

    it('🔴 the ORIGIN is youtube-nocookie.com — asserted as an origin, not a substring', () => {
      // ⚠️ `toContain('youtube-nocookie')` passes for
      // `https://evil.com/?x=youtube-nocookie.com`. Parsing and comparing the
      // origin is the only check that means what it says.
      const url = buildYoutubeEmbedUrl('abcdefghijk');
      expect(url).not.toBeNull();
      expect(new URL(url as string).origin).toBe(
        'https://www.youtube-nocookie.com',
      );
      expect(new URL(url as string).protocol).toBe('https:');
    });

    it('carries enablejsapi=1 — without it getCurrentTime() does not work', () => {
      const url = new URL(buildYoutubeEmbedUrl('abcdefghijk') as string);
      expect(url.searchParams.get('enablejsapi')).toBe('1');
      expect(url.searchParams.get('rel')).toBe('0');
      expect(url.searchParams.get('modestbranding')).toBe('1');
    });

    it('the id is the ONLY interpolated value — the path is /embed/<id> exactly', () => {
      const url = new URL(buildYoutubeEmbedUrl('abcdefghijk') as string);
      expect(url.pathname).toBe('/embed/abcdefghijk');
    });
  });

  /* -------------------------------------------------------------------- */
  /* Hostile input. Every row is `null`, and every row says why.           */
  /* -------------------------------------------------------------------- */

  describe('hostile and malformed input all yields null', () => {
    const HOSTILE: readonly { input: string; why: string }[] = [
      { input: '', why: 'empty string' },
      { input: '          ', why: 'whitespace only' },
      { input: 'abcdefghij', why: '10 characters — one short' },
      { input: 'abcdefghijkl', why: '12 characters — one long' },
      { input: 'abcdefghij/', why: 'base64 confusion: `/` is not URL-safe' },
      { input: 'abcdefghij+', why: 'base64 confusion: `+` is not URL-safe' },
      {
        input: 'abcdefghij?',
        why: 'query injection — a second `?` in the URL',
      },
      { input: 'abcdefghij#', why: 'fragment injection' },
      {
        input: 'abcdefghij&',
        why: 'parameter injection into the literal query',
      },
      { input: 'abcdefghij=', why: 'parameter injection' },
      { input: '../../evil', why: 'path traversal to a different host path' },
      { input: '..%2f..%2fevil', why: 'encoded path traversal' },
      { input: 'abcdefghij"', why: 'attribute-breaking double quote' },
      { input: "abcdefghij'", why: 'attribute-breaking single quote' },
      { input: 'abcdefghij<', why: 'tag-opening `<`' },
      { input: 'abcdefghij>', why: 'tag-closing `>`' },
      { input: 'abcdefghij\n', why: 'trailing newline — the `m`-flag case' },
      { input: '\nabcdefghijk', why: 'leading newline' },
      { input: 'abcdefghij\r', why: 'trailing carriage return' },
      { input: 'abcdefghij\t', why: 'trailing tab' },
      { input: 'abcdefghij\0', why: 'NUL byte' },
      { input: 'abcdefghij ', why: 'trailing space' },
      { input: ' abcdefghijk', why: 'leading space' },
      { input: 'javascript:alert(1)', why: 'javascript: scheme' },
      { input: 'JavaScript:alert(1)', why: 'javascript: scheme, mixed case' },
      {
        input: 'data:text/html,<script>alert(1)</script>',
        why: 'data: URL carrying markup',
      },
      {
        input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        why: 'a full URL — the id must already be extracted server-side',
      },
      {
        input: 'https://evil.example.com/embed/dQw4w9WgXcQ',
        why: 'a full URL on an attacker host',
      },
      {
        input: 'abcdefghijk"></iframe><script>alert(1)</script>',
        why: '🔴 the exact payload an UNANCHORED pattern would accept',
      },
      {
        input: 'аbcdefghijk',
        why: 'unicode lookalike — Cyrillic а (U+0430), not Latin a',
      },
      { input: 'аbcdefghij', why: 'unicode lookalike at 10 code points' },
      { input: '𝟎bcdefghijk', why: 'mathematical digit zero (astral plane)' },
      { input: 'abcdefghij%', why: 'percent — the start of an escape' },
      { input: 'abcdefghij\\', why: 'backslash' },
      { input: '//evil.com/x', why: 'protocol-relative URL' },
    ];

    for (const { input, why } of HOSTILE) {
      it(`rejects ${JSON.stringify(input)} — ${why}`, () => {
        expect(buildYoutubeEmbedUrl(input)).toBeNull();
      });
    }

    it('rejects null and undefined without throwing', () => {
      // The wire type is `string | null` and the caller is expected to branch,
      // but a chokepoint that throws on the shape it exists to refuse is a
      // chokepoint someone will wrap in a swallowing `try`.
      expect(() =>
        buildYoutubeEmbedUrl(null as unknown as string),
      ).not.toThrow();
      expect(buildYoutubeEmbedUrl(null as unknown as string)).toBeNull();
      expect(buildYoutubeEmbedUrl(undefined as unknown as string)).toBeNull();
    });

    it('ANTI-VACUITY — the hostile table is substantial and every row is distinct', () => {
      // A table that silently lost its rows would make the loop above pass over
      // nothing at all.
      expect(HOSTILE.length).toBeGreaterThanOrEqual(30);
      expect(new Set(HOSTILE.map((h) => h.input)).size).toBe(HOSTILE.length);
    });
  });

  /* -------------------------------------------------------------------- */
  /* The pattern's own properties                                          */
  /* -------------------------------------------------------------------- */

  describe('the pattern itself', () => {
    it('is anchored at both ends with an exact length', () => {
      expect(YOUTUBE_VIDEO_ID_PATTERN.source).toBe('^[A-Za-z0-9_-]{11}$');
    });

    it('carries NO flags — `g` holds lastIndex, `m` makes `$` match before \\n', () => {
      expect(YOUTUBE_VIDEO_ID_PATTERN.flags).toBe('');
      expect(YOUTUBE_VIDEO_ID_PATTERN.global).toBe(false);
      expect(YOUTUBE_VIDEO_ID_PATTERN.multiline).toBe(false);
    });

    it('is stateless across repeated calls on the same input', () => {
      // The `/g` hazard, asserted rather than assumed: a global regex would
      // alternate true/false here.
      for (let i = 0; i < 5; i += 1) {
        expect(YOUTUBE_VIDEO_ID_PATTERN.test('abcdefghijk')).toBe(true);
      }
    });

    /**
     * 🔴 THE CROSS-FILE EQUALITY CHECK (Task 10.3).
     *
     * `libs/api/youtube/src/lib/extract-video-id.ts` declares the same regex and
     * its docblock claims the frontend imports it. It cannot — `scope:web` may
     * not depend on `scope:api` — so there are two copies, and this is what
     * keeps them equal. Reading both files rather than importing is deliberate:
     * an import would be the boundary error the duplication exists to avoid.
     */
    it('has the SAME literal text as VIDEO_ID_PATTERN in @ptah-api/youtube', () => {
      const apiFile = join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        'api',
        'youtube',
        'src',
        'lib',
        'extract-video-id.ts',
      );
      const source = readFileSync(apiFile, 'utf8');
      const match = /export const VIDEO_ID_PATTERN = (\/.*\/[a-z]*);/.exec(
        source,
      );

      // Anti-vacuity: if the constant were renamed, a `null` match would make
      // any comparison below trivially skippable.
      expect(match).not.toBeNull();
      expect((match as RegExpExecArray)[1]).toBe(
        String(YOUTUBE_VIDEO_ID_PATTERN),
      );
    });
  });
});
