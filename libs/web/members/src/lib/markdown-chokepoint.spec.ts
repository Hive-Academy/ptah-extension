import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * NFR-S2 / RK-2 / AD-1 / OQ-2 — THERE IS ONE MARKDOWN RENDERER AND ONE
 * SANITIZER, AND THIS FILE IS WHAT MAKES THAT TRUE RATHER THAN INTENDED.
 *
 * ⚠️ WHY THIS LANDS IN PHASE 2 AND NOT IN BATCH 4. §8.1: "the NFR-S2 test lands
 * in the same phase as the first rendered content". Batch 4 built the member
 * shell and rendered nothing a member wrote. Batch 7 renders forum posts —
 * text authored by one member and displayed to every other member over the
 * network — so this is the first commit where a second renderer would be a live
 * XSS vector rather than a hypothetical one.
 *
 * ⚠️ WHAT IT FORBIDS, AND WHY EACH ONE.
 *   · `innerHTML`                 — the direct bypass. `[innerHTML]="post.body"`
 *                                   is one line, looks like rendering, and puts
 *                                   member-authored markup straight into the DOM.
 *   · `bypassSecurityTrustHtml`   — the same bypass wearing Angular's own API,
 *                                   which reads as sanctioned because it says
 *                                   "security" and "trust".
 *   · `from 'marked'`             — a second PARSER. Even a correctly-sanitized
 *   · `from 'dompurify'`             second pipeline is a second CONFIGURATION
 *   · `from 'ngx-markdown'`          to keep in step with the `'member'` preset,
 *                                   and the copy that drifts is the one nobody
 *                                   is watching.
 *
 * ⚠️ OQ-2 OPTION (c) — AUTHORING A SECOND RENDERER — IS EXPLICITLY FORBIDDEN.
 * If a rendering need cannot be met by the `'member'` preset, THE PRESET
 * CHANGES, inside `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts`
 * (PRE-4). It does not fork, and it is not shadowed locally. That file is shared
 * with the VS Code webview, so a change there is a change to two products and
 * belongs in a review, not in a member-panel component.
 *
 * ⚠️ A NEGATIVE-ONLY SPEC PASSES TRIVIALLY ON A FILE THAT RENDERS NOTHING. So
 * the positive half below asserts that every surface which DOES display
 * member-authored text goes through `<ptah-markdown-block>` — with exactly one
 * declared exemption, the search page, whose excerpts are plain text by design
 * (R1.7.5) and are rendered as escaped text nodes.
 *
 * ⚠️ COMMENTS ARE STRIPPED BEFORE SCANNING, AND THAT IS LOAD-BEARING. Half the
 * files in this lib DISCUSS `[innerHTML]` in their docblocks — telling the next
 * reader not to use it is exactly the documentation this rule wants. Matching
 * raw text would make every such warning a violation and the only way to keep
 * the spec green would be to delete the warnings.
 */

/** `libs/web/members/src` — the whole lib, from this file's location. */
const SRC_ROOT = join(__dirname, '..');

/** This file's own path. It contains every needle and must not match itself. */
const SELF = join(__dirname, 'markdown-chokepoint.spec.ts');

interface ScannedFile {
  /** `lib/community/thread-page.ts` — stable across machines. */
  readonly label: string;
  readonly path: string;
  /** Source with comments removed — see the file docblock. */
  readonly code: string;
  /** Raw text, for the few checks that legitimately want comments. */
  readonly raw: string;
}

/**
 * The forbidden needles.
 *
 * `innerHTML` is matched bare rather than as `[innerHTML]` on purpose: it also
 * catches `element.innerHTML = html` in component code, which is the same hole
 * reached through a different door.
 */
const FORBIDDEN: readonly { needle: string; why: string }[] = [
  {
    needle: 'innerHTML',
    why: 'Binds a string into the DOM as HTML, bypassing the one sanitizer. Render through <ptah-markdown-block> instead.',
  },
  {
    needle: 'bypassSecurityTrustHtml',
    why: "Angular's explicit sanitizer opt-out. There is no member-panel case for it; the 'member' DOMPurify preset is the boundary.",
  },
  {
    needle: "from 'marked'",
    why: "A second markdown parser. The one parser is inside libs/frontend/markdown; a second configuration drifts from the 'member' preset.",
  },
  {
    needle: "from 'dompurify'",
    why: 'A second sanitizer configuration. PRE-4: the allowlist lives in provide-markdown-rendering.ts and nowhere else.',
  },
  {
    needle: "from 'ngx-markdown'",
    why: 'The renderer is wrapped by MarkdownBlockComponent. Importing it directly re-opens the preset question at every call site.',
  },
];

/**
 * Fields whose presence in a COMPONENT means that component displays
 * member-authored text.
 *
 * `bodyMarkdown` is a raw post body; `bodyExcerpt` / `titleExcerpt` are the
 * search excerpts. Any of the three in a rendering file is the trigger for the
 * positive rule below.
 */
const MEMBER_TEXT_FIELDS = ['bodyMarkdown', 'bodyExcerpt', 'titleExcerpt'];

/**
 * The ONE surface that displays member-authored text without the renderer, and
 * the reason it is allowed to.
 *
 * ⚠️ THIS IS AN ALLOWLIST OF ONE AND IT SHOULD STAY THAT WAY. `search-page.ts`
 * renders `SearchExcerpt.text` — PLAIN TEXT with match offsets, never HTML
 * (R1.7.5) — as sibling `<span>`s built by `HighlightTextPipe` and emitted with
 * `{{ }}` interpolation, so every character reaches the DOM as a text node
 * Angular escapes. It runs NO markdown pipeline at all, deliberately: splitting
 * rendered HTML on character offsets would cut through tags, and the excerpt is
 * plain precisely so highlighting can never become an injection path.
 *
 * Adding an entry here is a security decision. It needs the same argument.
 */
const RENDERER_EXEMPT: readonly { label: string; why: string }[] = [
  {
    label: 'lib/search/search-page.ts',
    why: 'R1.7.5 — search excerpts are plain text plus offsets and are rendered as escaped text nodes by HighlightTextPipe. No markdown pipeline runs on this page by design.',
  },
];

/* -------------------------------------------------------------------------- */
/* Collection                                                                  */
/* -------------------------------------------------------------------------- */

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

/**
 * Removes comments so a docblock warning about `[innerHTML]` is not itself a
 * violation.
 *
 * `ts.transpileModule` with `removeComments` is used rather than a regexp
 * because a regexp cannot tell a `//` inside a URL string from a line comment,
 * and truncating a line at `https://` would create a place a needle could hide.
 * Template literals — where Angular's inline templates live — survive intact,
 * so HTML comments inside them are stripped separately.
 */
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
  // ⚠️ THE SELF-MATCH BUG. This file names every needle it forbids, so scanning
  // it fails the spec on its own text. That is the classic failure of this
  // idiom and it is excluded by absolute path, not by name pattern — a name
  // pattern would also silently exclude a future file that happened to match.
  .filter((path) => path !== SELF)
  // Other `.spec.ts` files are excluded too: a spec legitimately reads
  // `element.innerHTML` to make an assertion (this one's sibling
  // `thread-page.spec.ts` does exactly that, to prove the string is ABSENT),
  // and a spec renders to no member. Production code is what ships.
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

/** Files that declare an Angular component — the ones that can render. */
const COMPONENTS = FILES.filter((file) => file.raw.includes('@Component'));

/* -------------------------------------------------------------------------- */

describe('NFR-S2 — one markdown renderer, one sanitizer, across libs/web/members', () => {
  describe('anti-vacuity — the scanner actually read the lib', () => {
    // Every assertion below is "the set of violations is empty". If `collect`
    // found nothing, all of them pass forever.
    it('found a substantial number of source files', () => {
      expect(FILES.length).toBeGreaterThanOrEqual(15);
    });

    it('found the files that actually render member-authored text', () => {
      const labels = FILES.map((f) => f.label);

      expect(labels).toContain('lib/community/thread-page.ts');
      expect(labels).toContain('lib/community/components/topic-composer.ts');
      expect(labels).toContain('lib/community/components/reply-composer.ts');
      expect(labels).toContain('lib/search/search-page.ts');
    });

    it('excluded ONLY itself and the specs', () => {
      const labels = FILES.map((f) => f.label);

      expect(labels).not.toContain('lib/markdown-chokepoint.spec.ts');
      expect(labels.filter((l) => l.endsWith('.spec.ts'))).toEqual([]);
      // …and did not over-exclude: the lib's external template is still scanned.
      expect(labels).toContain('lib/member-layout/member-layout.html');
    });

    it('strips comments without swallowing code', () => {
      // The mechanism the whole negative half depends on. If `stripComments`
      // returned '' the spec would be decoration; if it failed to strip, every
      // docblock warning about [innerHTML] would be a violation.
      const stripped = stripComments(
        'probe.ts',
        `// innerHTML in a line comment
         /** bypassSecurityTrustHtml in a docblock */
         const url = 'https://example.com/a//b';
         export const kept = 'REAL_CODE';`,
      );

      expect(stripped).not.toContain('innerHTML');
      expect(stripped).not.toContain('bypassSecurityTrustHtml');
      expect(stripped).toContain('REAL_CODE');
      // The URL survived intact — a regexp stripper would have truncated it.
      expect(stripped).toContain('https://example.com/a//b');
    });

    it('strips HTML comments inside an inline template', () => {
      const stripped = stripComments(
        'probe.ts',
        'const t = `<div><!-- innerHTML is forbidden --><p>KEPT</p></div>`;',
      );

      expect(stripped).not.toContain('innerHTML');
      expect(stripped).toContain('KEPT');
    });
  });

  describe('the negative half — no second path from text to DOM', () => {
    for (const { needle, why } of FORBIDDEN) {
      it(`no file contains ${needle}`, () => {
        // `toEqual` on the offending LABELS, not a count: the failure message
        // names the file, so the fix is obvious from the output alone.
        const offenders = FILES.filter((file) =>
          file.code.includes(needle),
        ).map((file) => `${file.label} — ${why}`);

        expect(offenders).toEqual([]);
      });
    }
  });

  describe('the positive half — every body goes through the chokepoint', () => {
    // ⚠️ Without this block, deleting every rendering component would make the
    // negative half pass perfectly.

    it('every component that displays member-authored text renders <ptah-markdown-block>', () => {
      const exempt = new Set(RENDERER_EXEMPT.map((e) => e.label));

      const offenders = COMPONENTS.filter((file) =>
        MEMBER_TEXT_FIELDS.some((field) => file.code.includes(field)),
      )
        .filter((file) => !exempt.has(file.label))
        .filter((file) => !file.code.includes('ptah-markdown-block'))
        .map(
          (file) =>
            `${file.label} references member-authored text but renders no <ptah-markdown-block>. ` +
            'Render it through the shared component, or add a justified entry to RENDERER_EXEMPT.',
        );

      expect(offenders).toEqual([]);
    });

    it('the rule is NOT vacuous — it matches at least the three known renderers', () => {
      // If `MEMBER_TEXT_FIELDS` stopped matching anything (a field renamed on
      // the contract, say), the assertion above would pass over an empty set.
      const matched = COMPONENTS.filter((file) =>
        MEMBER_TEXT_FIELDS.some((field) => file.code.includes(field)),
      ).map((file) => file.label);

      expect(matched).toContain('lib/community/thread-page.ts');
      expect(matched).toContain('lib/community/components/topic-composer.ts');
      expect(matched).toContain('lib/search/search-page.ts');
      expect(matched.length).toBeGreaterThanOrEqual(3);
    });

    it('the composers preview through the chokepoint, not through a raw div', () => {
      // A preview is the easiest place to reach for innerHTML, because the text
      // is "your own" — which is exactly the reasoning that ships the hole, since
      // the same component renders it back to everyone else.
      for (const label of [
        'lib/community/components/topic-composer.ts',
        'lib/community/components/reply-composer.ts',
      ]) {
        const file = FILES.find((f) => f.label === label);
        expect(file?.code).toContain('ptah-markdown-block');
      }
    });

    it('every markdown block on a member surface passes variant="auto" (NFR-U5)', () => {
      // Not a security property, but it travels with every renderer and the
      // default (`'invert'`, for the dark-only webview) renders near-white text
      // on the near-white base-200 of operator-member-light.
      const rendering = FILES.filter((file) =>
        file.code.includes('<ptah-markdown-block'),
      );

      expect(rendering.length).toBeGreaterThanOrEqual(3);
      for (const file of rendering) {
        expect(file.code).toContain('variant="auto"');
      }
    });

    it('the renderer is imported ONLY from the shared lib', () => {
      // The component may be imported; the pipeline behind it may not be
      // reconfigured. This is the import-side statement of the same rule the
      // negative half makes on `ngx-markdown` / `marked` / `dompurify`.
      const importers = FILES.filter((file) =>
        file.code.includes('@ptah-extension/markdown'),
      ).map((file) => file.label);

      expect(importers.sort()).toEqual([
        'lib/community/components/reply-composer.ts',
        'lib/community/components/topic-composer.ts',
        'lib/community/thread-page.ts',
      ]);
    });
  });

  describe('the exemption list is small and justified', () => {
    it('names exactly one file, and that file exists', () => {
      // An exemption list that grows silently is how a rule stops being one.
      expect(RENDERER_EXEMPT).toHaveLength(1);

      for (const entry of RENDERER_EXEMPT) {
        expect(FILES.map((f) => f.label)).toContain(entry.label);
        expect(entry.why.length).toBeGreaterThan(40);
      }
    });

    it('the exempt page really does run no markdown pipeline', () => {
      // The exemption claims search renders plain text. Assert the claim rather
      // than trusting the comment: if search ever grows a renderer, the
      // exemption becomes wrong and this fails.
      const search = FILES.find((f) => f.label === 'lib/search/search-page.ts');

      expect(search?.code).not.toContain('ptah-markdown-block');
      expect(search?.code).toContain('highlightText');
    });
  });
});
