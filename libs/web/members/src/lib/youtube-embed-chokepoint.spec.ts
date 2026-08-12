import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * 🔴 NFR-S3 / RISK-S / §4.6.3 — THERE IS ONE TRUSTED-URL CONSTRUCTION AND THIS
 * FILE IS WHAT MAKES THAT TRUE RATHER THAN INTENDED.
 *
 * ⚠️ WHY THIS IS A SIBLING OF `markdown-chokepoint.spec.ts` AND NOT A RULE
 * INSIDE IT. That spec exists because there is ONE path from untrusted text to
 * the DOM and it must stay one. `bypassSecurityTrustResourceUrl` creates a
 * SECOND chokepoint of the same SHAPE — one path from a persisted string to a
 * trusted URL — but a DIFFERENT invariant. Its negative list is `innerHTML`,
 * `bypassSecurityTrustHtml`, `marked`, `dompurify`, `ngx-markdown`; folding a
 * resource-URL rule into it would mean one spec enforcing two unrelated
 * invariants whose failure messages a reader would have to tell apart.
 *
 * ⚠️ 🔴 AND THE MARKDOWN SPEC CANNOT COVER IT ANYWAY, WHICH IS THE STRONGER
 * ARGUMENT. Its needle is the literal string `bypassSecurityTrustHtml`.
 * `bypassSecurityTrustResourceUrl` DOES NOT CONTAIN THAT SUBSTRING — the two
 * API names diverge after `bypassSecurityTrust` — so
 * `'…ResourceUrl'.includes('bypassSecurityTrustHtml')` is `false` and every
 * resource-URL bypass in this lib would pass that spec silently. Verified by
 * reading the needle out of that file below, so this claim cannot go stale.
 *
 * ⚠️ AND RISK-S: `bypassSecurityTrustResourceUrl` appeared NOWHERE in this
 * repository before Batch 10 — `rg` across `libs` and `apps`, zero hits. So
 * before this file there was nothing that would have noticed a second one.
 *
 * ⚠️ COMMENTS ARE STRIPPED BEFORE SCANNING, AND THAT IS LOAD-BEARING. Half the
 * files in this lib DISCUSS the bypass in their docblocks — telling the next
 * reader not to call it is exactly the documentation this rule wants. Matching
 * raw text would make every warning a violation and the only way to keep the
 * spec green would be to delete the warnings. `ts.transpileModule` is used
 * rather than a regexp because a regexp cannot tell a `//` inside a URL from a
 * line comment, and truncating a line at `https://` would create a place a
 * needle could hide (B7 hit precisely this).
 */

/** `libs/web/members/src` — the whole lib, from this file's location. */
const SRC_ROOT = join(__dirname, '..');

/** This file's own path. It names every needle and must not match itself. */
const SELF = join(__dirname, 'youtube-embed-chokepoint.spec.ts');

/** The ONE file permitted to call the sanitizer bypass. */
const BYPASS_CALL_SITE = 'lib/learning/youtube-player.ts';

/** The ONE file permitted to build the embed URL. */
const URL_BUILDER = 'lib/learning/youtube-embed-url.ts';

/**
 * Files permitted to contain a YouTube hostname literal.
 *
 * `youtube-embed-url.ts` owns the `youtube-nocookie.com` embed origin;
 * `youtube-player.ts` owns the `youtube.com/iframe_api` bootstrap script, which
 * is only served from that host. Anything else is a SECOND construction path.
 */
const HOST_LITERAL_OWNERS = [URL_BUILDER, BYPASS_CALL_SITE];

interface ScannedFile {
  /** `lib/learning/youtube-player.ts` — stable across machines. */
  readonly label: string;
  readonly path: string;
  /** Source with comments removed — see the file docblock. */
  readonly code: string;
  readonly raw: string;
}

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, acc);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.html')) {
      acc.push(full);
    }
  }
  return acc;
}

function stripComments(path: string, text: string): string {
  if (path.endsWith('.html')) return stripHtmlComments(text);

  const transpiled = ts.transpileModule(text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      experimentalDecorators: true,
    },
    reportDiagnostics: false,
  }).outputText;

  return stripHtmlComments(transpiled);
}

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

const FILES: ScannedFile[] = collect(SRC_ROOT)
  // ⚠️ THE SELF-MATCH BUG, excluded by ABSOLUTE PATH rather than by a name
  // pattern — a pattern would also silently exclude a future file that happened
  // to match it.
  .filter((path) => path !== SELF)
  // Other `.spec.ts` files are excluded too: a spec legitimately writes the
  // forbidden string in order to assert its absence (this file's siblings do),
  // and a spec ships to no member. Production code is what ships.
  .filter((path) => !path.endsWith('.spec.ts'))
  .map((path) => {
    const raw = readFileSync(path, 'utf8');
    return {
      label: relative(SRC_ROOT, path).split(sep).join('/'),
      path,
      raw,
      code: stripComments(path, raw),
    };
  });

/* -------------------------------------------------------------------------- */

describe('NFR-S3 — one trusted-URL construction, across libs/web/members', () => {
  describe('anti-vacuity — the scanner actually read the lib', () => {
    it('found a substantial number of source files', () => {
      // Every assertion below is "the set of offenders is empty". If `collect`
      // found nothing, all of them pass forever.
      expect(FILES.length).toBeGreaterThanOrEqual(25);
    });

    it('found the two files this rule is ABOUT', () => {
      const labels = FILES.map((f) => f.label);
      expect(labels).toContain(BYPASS_CALL_SITE);
      expect(labels).toContain(URL_BUILDER);
      // …and the Phase-3 surfaces that must stay inside the scan.
      expect(labels).toContain('lib/learning/lesson-page.ts');
      expect(labels).toContain('lib/learning/youtube-player.html');
    });

    it('excluded ONLY itself and the specs', () => {
      const labels = FILES.map((f) => f.label);
      expect(labels).not.toContain('lib/youtube-embed-chokepoint.spec.ts');
      expect(labels.filter((l) => l.endsWith('.spec.ts'))).toEqual([]);
      // …and did not over-reach: external templates are still scanned.
      expect(labels).toContain('lib/member-layout/member-layout.html');
      expect(labels).toContain('lib/learning/components/progress-meter.html');
    });

    it('strips comments without swallowing code or URLs', () => {
      const stripped = stripComments(
        'probe.ts',
        `// bypassSecurityTrustResourceUrl in a line comment
         /** youtube.com in a docblock */
         const url = 'https://example.com/a//b';
         export const kept = 'REAL_CODE';`,
      );

      expect(stripped).not.toContain('bypassSecurityTrustResourceUrl');
      expect(stripped).not.toContain('youtube.com');
      expect(stripped).toContain('REAL_CODE');
      // The URL survived intact — a regexp stripper would have truncated it.
      expect(stripped).toContain('https://example.com/a//b');
    });

    it('strips HTML comments inside an inline template', () => {
      const stripped = stripComments(
        'probe.ts',
        'const t = `<div><!-- bypassSecurityTrustResourceUrl is forbidden --><p>KEPT</p></div>`;',
      );
      expect(stripped).not.toContain('bypassSecurityTrustResourceUrl');
      expect(stripped).toContain('KEPT');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 rule 1 — the bypass appears in EXACTLY ONE file, by name', () => {
    it('names youtube-player.ts and nothing else', () => {
      const callers = FILES.filter((file) =>
        file.code.includes('bypassSecurityTrustResourceUrl'),
      )
        .map((file) => file.label)
        .sort();

      expect(callers).toEqual([BYPASS_CALL_SITE]);
    });

    it('no OTHER sanitizer bypass appears anywhere in the lib', () => {
      // `bypassSecurityTrustHtml` is the markdown spec's; the other four are
      // nobody's. Listing them here means a new one is a diff a reviewer reads.
      const others = [
        'bypassSecurityTrustHtml',
        'bypassSecurityTrustScript',
        'bypassSecurityTrustStyle',
        'bypassSecurityTrustUrl',
      ];

      for (const needle of others) {
        const offenders = FILES.filter((file) =>
          file.code.includes(needle),
        ).map((file) => `${file.label} — ${needle} has no member-panel case.`);
        expect(offenders).toEqual([]);
      }
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 rule 2 — buildYoutubeEmbedUrl is the only producer of the trusted value', () => {
    const player = FILES.find((f) => f.label === BYPASS_CALL_SITE);

    it('the call site imports the builder', () => {
      expect(player?.code).toContain('buildYoutubeEmbedUrl');
      expect(player?.raw).toContain("from './youtube-embed-url'");
    });

    it("the bypass's ARGUMENT comes from the builder's return value", () => {
      // A source-text assertion is enough here, and the failure message says
      // what to do instead. The value passed to the bypass is the local the
      // builder produced — never a template literal, never a concatenation.
      const code = player?.code ?? '';
      const call = /bypassSecurityTrustResourceUrl\(([^)]*)\)/.exec(code);

      expect(call).not.toBeNull();
      const argument = (call as RegExpExecArray)[1].trim();

      // Anti-vacuity: the regex really matched a call.
      expect(argument.length).toBeGreaterThan(0);
      // The argument is a plain identifier — not an interpolation, not a
      // concatenation, not a member expression off a response object.
      expect(argument).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
      // …and that identifier is assigned from the builder in the same scope.
      expect(code).toMatch(
        new RegExp(`const ${argument} = this\\.embedUrl\\(\\)`),
      );
      expect(code).toContain('buildYoutubeEmbedUrl(id)');
      // …guarded by an explicit null check before the bypass runs.
      expect(code).toMatch(
        new RegExp(`if \\(${argument} === null\\)[\\s\\S]{0,40}return null;`),
      );
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 rule 3 — YouTube host literals live in exactly two files', () => {
    for (const needle of ['youtube.com', 'youtube-nocookie.com', 'ytimg.com']) {
      it(`no file outside the two owners contains ${needle}`, () => {
        const offenders = FILES.filter((file) => file.code.includes(needle))
          .filter((file) => !HOST_LITERAL_OWNERS.includes(file.label))
          .map(
            (file) =>
              `${file.label} contains a hardcoded ${needle}. A second embed URL is a second construction path — ` +
              `build it with buildYoutubeEmbedUrl() in ${URL_BUILDER} instead.`,
          );

        expect(offenders).toEqual([]);
      });
    }

    it('and the two owners really do carry theirs (anti-vacuity)', () => {
      // Without this the rule above would pass on a lib that embedded nothing.
      const builder = FILES.find((f) => f.label === URL_BUILDER);
      const player = FILES.find((f) => f.label === BYPASS_CALL_SITE);

      expect(builder?.code).toContain('https://www.youtube-nocookie.com');
      expect(player?.code).toContain('https://www.youtube.com/iframe_api');
    });

    it('🔴 the EMBED origin is the nocookie domain, never youtube.com', () => {
      const builder = FILES.find((f) => f.label === URL_BUILDER);
      // The builder must not know about `youtube.com` at all: the only place
      // that host is legal is the API bootstrap script in the player.
      expect(builder?.code).not.toContain('https://www.youtube.com');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 rule 4 — the positive half, and the cross-file pattern equality', () => {
    // ⚠️ A NEGATIVE-ONLY SPEC PASSES TRIVIALLY ON A LIB THAT RENDERS NO VIDEO.
    it('the builder really exports the function and the pattern', () => {
      const builder = FILES.find((f) => f.label === URL_BUILDER);
      expect(builder?.code).toContain('export function buildYoutubeEmbedUrl');
      expect(builder?.code).toContain('export const YOUTUBE_VIDEO_ID_PATTERN');
    });

    it('the pattern is anchored, exact-length and unflagged', () => {
      const builder = FILES.find((f) => f.label === URL_BUILDER);
      expect(builder?.code).toContain(
        'YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;',
      );
    });

    it('🔴 its literal text EQUALS VIDEO_ID_PATTERN in @ptah-api/youtube', () => {
      // ⚠️ TWO COPIES EXIST BECAUSE `scope:web` MAY NOT DEPEND ON `scope:api`
      // (`eslint.config.mjs`), so the import the backend's docblock claims the
      // frontend makes is a boundary error. Reading both files turns the
      // convention into an assertion.
      const apiFile = join(
        SRC_ROOT,
        '..',
        '..',
        '..',
        'api',
        'youtube',
        'src',
        'lib',
        'extract-video-id.ts',
      );
      const apiSource = readFileSync(apiFile, 'utf8');
      const apiMatch = /export const VIDEO_ID_PATTERN = (\/.*\/[a-z]*);/.exec(
        apiSource,
      );

      const webSource = FILES.find((f) => f.label === URL_BUILDER)?.raw ?? '';
      const webMatch =
        /export const YOUTUBE_VIDEO_ID_PATTERN = (\/.*\/[a-z]*);/.exec(
          webSource,
        );

      // Anti-vacuity: a renamed constant on either side must fail loudly rather
      // than make the comparison skippable.
      expect(apiMatch).not.toBeNull();
      expect(webMatch).not.toBeNull();
      expect((webMatch as RegExpExecArray)[1]).toBe(
        (apiMatch as RegExpExecArray)[1],
      );
    });

    it('the player only calls the bypass on a non-null return', () => {
      const player = FILES.find((f) => f.label === BYPASS_CALL_SITE);
      const code = player?.code ?? '';
      const bypassIndex = code.indexOf('bypassSecurityTrustResourceUrl');
      const guardIndex = code.indexOf('=== null');

      expect(bypassIndex).toBeGreaterThan(0);
      expect(guardIndex).toBeGreaterThan(0);
      // The guard is before the call, in the same computed.
      expect(guardIndex).toBeLessThan(bypassIndex);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 the markdown chokepoint would NOT catch this, and that is why this file exists', () => {
    it("its needle is 'bypassSecurityTrustHtml', which is not a substring of the resource-URL API", () => {
      // Read out of the sibling spec so the claim cannot go stale if its
      // needle list changes.
      const markdownSpec = readFileSync(
        join(__dirname, 'markdown-chokepoint.spec.ts'),
        'utf8',
      );
      expect(markdownSpec).toContain("needle: 'bypassSecurityTrustHtml'");
      expect(markdownSpec).not.toContain('bypassSecurityTrustResourceUrl');

      // The mechanical fact that makes the two specs necessary rather than
      // redundant: `.includes()` is what that spec uses.
      expect(
        'bypassSecurityTrustResourceUrl'.includes('bypassSecurityTrustHtml'),
      ).toBe(false);
    });
  });
});
