/**
 * THE CSP_META STRIP AS AN EXECUTABLE CONTRACT (PR 558, SonarCloud S8786).
 *
 * `copy-renderer.js` removes any Content-Security-Policy `<meta>` a previous
 * run left behind before it writes its own. Without that removal a second run
 * emits two conflicting policies and the browser enforces the intersection,
 * which silently breaks the renderer.
 *
 * SonarCloud flagged the pattern that does the removal with `javascript:S8786`
 * — super-linear runtime from backtracking. The cause was two open quantifiers
 * sitting in front of a literal: `[ \t]*<meta` rescans every run of whitespace
 * once per starting offset, and this pattern runs over the WHOLE built
 * renderer document. Both are now bounded.
 *
 * Bounding a quantifier is only safe if the bound is above anything real, so
 * these tests pin the behaviour the bound must not change, and the last one
 * fails loudly if the backtracking ever comes back.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { secureRendererHtml } = require('../../scripts/copy-renderer.js') as {
  secureRendererHtml: (html: string) => {
    html: string;
    scripts: Array<{ fileName: string; content: string }>;
  };
};

const CSP_TAG =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'">';

function documentWith(head: string): string {
  return `<!doctype html>\n<html>\n<head>\n${head}\n<title>t</title>\n</head>\n<body></body>\n</html>\n`;
}

describe('copy-renderer CSP meta strip', () => {
  it('is idempotent: patching an already-patched document is a no-op', () => {
    const once = secureRendererHtml(documentWith('    <title-ph>'));
    const twice = secureRendererHtml(once.html);

    expect(twice.html).toBe(once.html);
    expect(twice.scripts).toEqual([]);
  });

  it('removes a stale policy rather than emitting a second one', () => {
    const { html } = secureRendererHtml(documentWith(`    ${CSP_TAG}`));

    expect(html.match(/http-equiv="Content-Security-Policy"/gi)).toHaveLength(
      1,
    );
  });

  it('still matches when the tag carries unusual inner whitespace', () => {
    const spaced = CSP_TAG.replace('<meta ', '<meta \t  ');
    const { html } = secureRendererHtml(documentWith(`\t\t${spaced}`));

    expect(html.match(/http-equiv="Content-Security-Policy"/gi)).toHaveLength(
      1,
    );
  });

  // A value that appears in the STALE tag and never in the policy the script
  // writes, so "did the old tag survive" is unambiguous. Asserting on
  // `default-src 'none'` cannot work — the new policy contains it too.
  const STALE = 'stale-sentinel.example';

  it('removes a policy whose attributes are in the other order', () => {
    // Anchoring on http-equiv being the FIRST attribute let this tag survive.
    // A surviving policy intersects with the one written below it, and
    // Chromium enforces the intersection — a stale policy then blocks the
    // lifted ./inline-*.js scripts and the renderer never starts.
    const reordered = `<meta content="default-src ${STALE}" http-equiv="Content-Security-Policy">`;
    const { html } = secureRendererHtml(documentWith(`  ${reordered}`));

    expect(html).not.toContain(STALE);
    expect(html.match(/http-equiv=/gi)).toHaveLength(1);
  });

  it('removes a policy written with single quotes', () => {
    const singleQuoted = `<meta http-equiv='Content-Security-Policy' content='default-src ${STALE}'>`;
    const { html } = secureRendererHtml(documentWith(`  ${singleQuoted}`));

    expect(html).not.toContain(STALE);
    expect(html.match(/http-equiv=/gi)).toHaveLength(1);
  });

  it('leaves unrelated meta tags untouched', () => {
    const { html } = secureRendererHtml(
      documentWith(
        '  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width">',
      ),
    );

    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
  });

  it('still matches a policy whose content attribute is very long', () => {
    // The tag scan leaves `[^>]*` unbounded on purpose: a real CSP `content`
    // runs to hundreds of characters, and a negated class before its own
    // terminator cannot backtrack. A bound here would silently stop stripping
    // the tags that matter most.
    const long = `<meta http-equiv="Content-Security-Policy" content="${'a'.repeat(2000)}">`;
    const { html } = secureRendererHtml(documentWith(`  ${long}`));

    expect(html.match(/http-equiv="Content-Security-Policy"/gi)).toHaveLength(
      1,
    );
    expect(html).not.toContain('a'.repeat(2000));
  });

  it('does not degrade on a document full of whitespace runs', () => {
    // The S8786 regression guard. With the old open `[ \t]*`, a document of
    // many indented non-matching lines costs O(n^2). 20k lines finished in
    // milliseconds once bounded; the budget is deliberately loose so this
    // fails on a real regression, not on a slow machine.
    const filler = `${' '.repeat(60)}<div></div>\n`.repeat(20_000);
    const started = Date.now();

    secureRendererHtml(documentWith(`  ${CSP_TAG}\n${filler}`));

    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
