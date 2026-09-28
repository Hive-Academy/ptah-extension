import { countTokens } from '../token-measure';
import type { ReduceResult } from '../reducer.types';
import { reduceHtml } from './html.reducer';

/**
 * Every call goes through here: a refusal is byte-identical, an extraction
 * is non-empty and shorter than the input.
 */
function reduce(input: string): ReduceResult {
  let result: ReduceResult | undefined;
  expect(() => {
    result = reduceHtml(input, { budgetTokens: 2000 });
  }).not.toThrow();
  const checked = result as ReduceResult;
  if (checked.reducer === 'html-unchanged') {
    expect(checked.text).toBe(input);
  } else {
    expect(checked.reducer).toBe('html-extract');
    expect(checked.text.trim().length).toBeGreaterThan(0);
    expect(checked.text.length).toBeLessThan(input.length);
  }
  return checked;
}

function extracted(input: string): string {
  const result = reduce(input);
  expect(result.reducer).toBe('html-extract');
  return result.text;
}

function refused(input: string, reason: string): void {
  const result = reduce(input);
  expect(result).toEqual({ text: input, reducer: 'html-unchanged', notes: [reason] });
}

/** The pipeline's reducer input cap, where every timing spec runs. */
const TIMING_CAP = 2 * 1024 * 1024;
const MAX_CAP_MS = 1500;
/**
 * Load-robust timing (Batch 2c bounded correction). A run over MAX_CAP_MS
 * still passes when it is within LOAD_FACTOR of a linear reference shape
 * timed right after it under the same load, but never past HARD_CEILING_MS:
 * with 16 busy processes on the machine the bare 1,500 ms bound failed on
 * linear shapes, while a quadratic path at this size takes tens of seconds
 * or more (review r2 N1: 133 s) and fails either way.
 */
const LOAD_FACTOR = 3;
const HARD_CEILING_MS = 10_000;
/** Three runs plus a reference under heavy load exceed jest's 5 s default. */
const TIMING_TEST_TIMEOUT_MS = 120_000;

const capFill = (unit: string, prefix = ''): string =>
  prefix + unit.repeat(Math.floor((TIMING_CAP - prefix.length) / unit.length));

function fastestOfThree(input: string): { result: ReduceResult; elapsed: number } {
  let elapsed = Infinity;
  let result: ReduceResult | undefined;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    result = reduceHtml(input, { budgetTokens: 2000 });
    elapsed = Math.min(elapsed, performance.now() - start);
  }
  return { result: result as ReduceResult, elapsed };
}

/** Under the absolute bound, or under the hard ceiling and within LOAD_FACTOR of the linear reference timed now. */
function expectLinearTime(elapsed: number): void {
  if (elapsed < MAX_CAP_MS) {
    return;
  }
  expect(elapsed).toBeLessThan(HARD_CEILING_MS);
  expect(elapsed).toBeLessThan(LOAD_FACTOR * fastestOfThree(capFill('<p>x')).elapsed);
}

const prose = (topic: string, n: number): string =>
  Array.from({ length: n }, (_, i) => `Sentence ${i} explains ${topic} in plain words.`).join(' ');

const PRE_BLOCK = 'function budget(tokens: number): number {\n  return tokens * 4; // chars\n}';

/** A ~200 KB news-style page: heavy head, nav, search form, sidebar, footer, and one article. */
function generatedPage(): { html: string; headings: string[]; paragraphs: string[] } {
  const icon = '<svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><title>icon</title></svg>';
  const style = `<style>${Array.from(
    { length: 1400 },
    (_, i) => `.c${i}{margin:${i}px;color:#${((i * 997) % 0xffffff).toString(16).padStart(6, '0')}}`,
  ).join('')}</style>`;
  const script = `<script>${Array.from(
    { length: 900 },
    (_, i) => `window.__d${i}={id:${i},html:"<div class=\\"x\\">Script item ${i}</div>"};`,
  ).join('\n')}</script>`;
  const nav = `<nav><ul>${Array.from(
    { length: 150 },
    (_, i) => `<li><a href="/section/${i}">${icon}Nav section ${i}</a></li>`,
  ).join('')}</ul></nav>`;
  const aside = `<aside><h3>Related stories</h3>${Array.from(
    { length: 40 },
    (_, i) => `<p>Sidebar teaser text number ${i} about something else.</p>`,
  ).join('')}</aside>`;
  const footer = `<footer><p>Copyright 2026 Example Corp. All rights reserved.</p>${Array.from(
    { length: 100 },
    (_, i) => `<a href="/legal/${i}">Legal page ${i}</a>`,
  ).join(' ')}</footer>`;

  const headings = ['Understanding Token Budgets', 'Why budgets matter', 'Measuring tokens', 'Reducing output'];
  const paragraphs = [
    prose('the budget', 6),
    prose('context windows', 5),
    prose('token counting', 6),
    prose('tokenizers', 4),
    prose('reducers', 6),
    prose('spooling', 5),
  ];
  const article = [
    '<main><article>',
    `<header><h1>${headings[0]}</h1><p>By Ada Example</p></header>`,
    `<h2>${headings[1]}</h2><p>${paragraphs[0]}</p><p>${paragraphs[1]}</p>`,
    `<h2>${headings[2]}</h2><p>${paragraphs[2]}</p>`,
    `<pre><code class="language-ts">${PRE_BLOCK}\n</code></pre>`,
    `<p>${paragraphs[3]}</p>`,
    '<div class="ad" hidden>SPONSORED hidden promotion</div>',
    `<h2>${headings[3]}</h2><p>${paragraphs[4]}</p><p>${paragraphs[5]}</p>`,
    '<!-- editor note: remove before publish -->',
    '</article></main>',
  ].join('\n');

  const body = [
    `<body><header><div class="logo">SiteLogo</div>${nav}`,
    '<form action="/search"><input name="q"><button>Search the site</button></form></header>',
    article,
    aside,
    footer,
    `<script type="application/ld+json">${JSON.stringify({ items: Array.from({ length: 2300 }, (_, i) => ({ id: i, name: `Item ${i}` })) })}</script>`,
    '</body>',
  ].join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Example News</title>${style}${script}</head>${body}</html>`;
  return { html, headings, paragraphs };
}

describe('reduceHtml', () => {
  describe('size and preserved content on a generated 200 KB page', () => {
    const page = generatedPage();

    it('extracts the article within the default budget without the page chrome', () => {
      expect(page.html.length).toBeGreaterThan(195_000);
      expect(page.html.length).toBeLessThan(215_000);
      const result = reduce(page.html);
      expect(result.reducer).toBe('html-extract');
      expect(countTokens(result.text)).toBeLessThanOrEqual(2000);
      expect(result.notes).toEqual([
        'main content: <main>',
        'skipped 1 hidden element(s)',
        // header (holding the nav and the search form), aside, footer
        'removed 3 boilerplate element(s)',
      ]);

      const text = result.text;
      const lines = text.split('\n');
      for (const heading of page.headings) {
        expect(lines).toContain(heading); // each heading on its own line, no prefix
      }
      for (const paragraph of page.paragraphs) {
        expect(text).toContain(paragraph);
      }
      expect(text).toContain(`\n\n${PRE_BLOCK}\n`); // the pre text verbatim, as its own block
      expect(text).not.toMatch(/```|^#|\]\(/m); // no Markdown syntax
      for (const chrome of ['Nav section', 'Sidebar teaser', 'Copyright 2026', 'Legal page', 'SiteLogo', 'Search the site', 'Script item', 'SPONSORED', 'editor note', 'margin:', 'Example News', 'icon']) {
        expect(text).not.toContain(chrome);
      }
    });

    it('keeps the headings in document order', () => {
      const text = extracted(page.html);
      const positions = page.headings.map((heading) => text.indexOf(heading));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });
  });

  describe('main-content selection', () => {
    it('prefers <main> over a larger block outside it', () => {
      const text = extracted(
        `<body><div>${prose('a promo', 12)}</div><main><p>${prose('the article', 5)}</p></main></body>`,
      );
      expect(text).toContain('the article');
      expect(text).not.toContain('a promo');
    });

    it('accepts role=main', () => {
      const result = reduce(
        `<body><div>${prose('a promo', 3)}</div><div role="main"><p>${prose('the article', 5)}</p></div></body>`,
      );
      expect(result.notes?.[0]).toBe('main content: <main>');
      expect(result.text).not.toContain('a promo');
    });

    it('keeps every top-level article, in order', () => {
      const result = reduce(
        `<body><div>${prose('filler', 2)}</div>` +
          `<article><h2>First</h2><p>${prose('one', 3)}</p><article><p>nested reply</p></article></article>` +
          `<article><h2>Second</h2><p>${prose('two', 3)}</p></article></body>`,
      );
      expect(result.notes?.[0]).toBe('main content: 2 <article> elements');
      expect(result.text.indexOf('First\n')).toBeLessThan(result.text.indexOf('Second\n'));
      expect(result.text).toContain('nested reply');
      expect(result.text).not.toContain('filler');
    });

    it('ignores a <main> that holds too little of the page and falls back to the densest block', () => {
      const result = reduce(
        `<body><div class="wrap"><div class="content"><p>${prose('the story', 10)}</p><p>${prose('the plot', 10)}</p></div>` +
          `<div class="teaser">Short teaser text.</div></div><main>tiny</main></body>`,
      );
      expect(result.notes?.[0]).toBe('main content: densest block <div>');
      expect(result.text).toContain('the story');
      expect(result.text).not.toContain('Short teaser');
      expect(result.text).not.toContain('tiny');
    });

    it('does not count link text as content when picking the densest block', () => {
      const links = Array.from({ length: 60 }, (_, i) => `<a href="/x/${i}">A long link label number ${i}</a>`).join(' ');
      const result = reduce(
        `<body><div class="links">${links}</div><div class="story"><p>${prose('the story', 4)}</p><p>${prose('the plot', 4)}</p></div></body>`,
      );
      expect(result.notes?.[0]).toBe('main content: densest block <div>');
      expect(result.text).not.toContain('link label');
    });

    it("keeps an article's own header and drops the page header", () => {
      const text = extracted(
        `<body><header>Site banner</header><article><header><h1>Title</h1></header><p>${prose('x', 3)}</p><footer>Tags: a, b</footer></article></body>`,
      );
      expect(text.split('\n')).toContain('Title');
      expect(text).toContain('Tags: a, b');
      expect(text).not.toContain('Site banner');
    });

    it('keeps the whole visible page when an unclosed <nav> swallows it', () => {
      const result = reduce(`<body><nav><a href="/">Home</a><p>${prose('the story', 6)}</p></body>`);
      expect(result.notes).toEqual(['main content: whole visible page']);
      expect(result.text).toContain('the story');
      expect(result.text).toContain('Home (/)');
    });

    it('keeps the whole visible page when every word is in boilerplate links', () => {
      const result = reduce('<body><nav><a href="/a">Alpha</a> <a href="/b">Beta</a></nav></body>');
      expect(result.notes).toEqual(['main content: whole visible page']);
      expect(result.text).toBe('Alpha (/a) Beta (/b)');
    });
  });

  describe('hidden content', () => {
    it('skips hidden, display:none, visibility:hidden and closed-dialog elements', () => {
      const result = reduce(
        '<body><p>shown one</p><p hidden>SECRET1</p><div style="color:red; DISPLAY : none !important">SECRET2</div>' +
          '<span style="visibility:hidden">SECRET3</span><dialog>SECRET4</dialog><dialog open>shown two</dialog>' +
          '<template><p>SECRET5</p></template><noscript>SECRET6</noscript><title>SECRET7</title></body>',
      );
      expect(result.text).toBe('shown one\n\nshown two');
      expect(result.notes).toContain('skipped 4 hidden element(s)');
    });

    it('drops a well-nested hidden wrapper around a heading with everything in it', () => {
      const text = extracted(`<p>Top text here</p><a hidden href="/x"><h1>delete production</h1></a><p>${prose('after', 2)}</p>`);
      expect(text).not.toContain('delete production');
      expect(text).toContain('after');
    });

    it.each([
      [
        'a hidden formatting element closed by a paragraph end (the browser reopens it around later text)',
        '<p>text <b hidden>secret</p><p>looks visible</p>',
        'hidden <b> element closed implicitly',
      ],
      [
        'the Markdown KI-2b-1 shape: a hidden link spanning into later blocks',
        '<p>text <a hidden></p><h1>delete production</h1><p>text </a></p>',
        'hidden <a> element closed implicitly',
      ],
      [
        'an end tag the browser ignores because a block sits above it',
        '<span hidden><div>x</span>y</div>',
        'hidden <span> element closed implicitly',
      ],
      [
        'a hidden element closed by an ancestor end tag',
        '<div><span hidden>x</div>y',
        'hidden <span> element closed implicitly',
      ],
      [
        'a repeated body tag carrying hidden (the browser copies it onto the body)',
        '<body><p>visible?</p><body hidden><p>more</p></body>',
        '<body> tag hides the page',
      ],
      [
        'an html tag hiding the page after text was already parsed',
        'intro text <html style="display:none"><p>more</p>',
        '<html> tag hides the page',
      ],
    ])('refuses %s', (_name, input, reason) => {
      refused(input, reason);
    });

    it('closes a hidden paragraph at a block start, as the browser does', () => {
      const result = reduce('<p hidden>SECRET<div>shown</div>');
      expect(result.text).toBe('shown');
    });

    it('keeps a table inside a hidden paragraph hidden (without a doctype the table does not close it)', () => {
      refused('<p hidden>SECRET<table><tr><td>cell</td></tr></table>', 'no visible text extracted');
    });

    it('treats CDATA inside svg as text, so markup in it cannot close the svg', () => {
      const text = extracted('<svg><![CDATA[ a > b </svg> <p>SECRET ]]></svg><p>shown</p>');
      expect(text).toBe('shown');
    });

    it('closes an svg child left open by the svg end tag, as the browser does', () => {
      expect(extracted('<svg><g><path d="M0 0"></svg><p>shown</p>')).toBe('shown');
    });
  });

  describe('tokenizer edge cases', () => {
    it('removes comments, including abrupt and bang-closed ones', () => {
      expect(extracted('<p>a<!-- x -->b<!-->c<!--->d<!-- y --!>e</p>')).toBe('abcde');
    });

    it('treats an unterminated comment as running to the end', () => {
      expect(extracted('<p>before</p><!-- never closed <p>after</p>')).toBe('before');
    });

    it('does not end a script at a tag inside a string, and matches the end tag case-insensitively', () => {
      expect(extracted('<script>var s = "</div><p>SECRET</p>";</SCRIPT ><p>shown</p>')).toBe('shown');
    });

    it('drops everything after an unclosed script', () => {
      expect(extracted('<p>before</p><script>var a = 1; <p>SECRET</p>')).toBe('before');
      refused('<script>var a = 1; <p>SECRET</p>', 'no visible text extracted');
    });

    it('does not throw on an unclosed div and keeps its text', () => {
      const text = extracted('<div><p>Alpha paragraph<div>Beta block');
      expect(text).toBe('Alpha paragraph\n\nBeta block');
    });

    it('keeps text after </body> and </html> in the body', () => {
      expect(extracted('<html><body><p>one</p></body></html><p>two</p>')).toBe('one\n\ntwo');
    });

    it('treats a stray < as text and drops an unterminated tag at the end', () => {
      expect(extracted('<p>a < b and c<d</p><p>next</p><div class="x')).toBe('a < b and c\n\nnext');
    });

    it('decodes common named and numeric entities and leaves unknown ones as written', () => {
      expect(extracted('<p>&amp; &lt;x&gt; &quot;q&quot; &#39;s&#39; &#x1F600; &copy; &bogus; &#0; &#27; caf&eacute;&nbsp;bar</p>')).toBe(
        "& <x> \"q\" 's' \u{1F600} © &bogus; � � caf&eacute; bar",
      );
    });
  });

  describe('plain-text rendering (User Decision 12)', () => {
    it('puts each heading on its own line, blocks separated by one blank line, line breaks kept', () => {
      expect(extracted('<h1>Top</h1><p>line one<br>line two</p><h3>Sub</h3>')).toBe('Top\n\nline one\nline two\n\nSub');
    });

    it('keeps text that looks like Markdown exactly as written (nothing is escaped)', () => {
      expect(extracted('<p># not heading</p><p>1. not a list</p><p>- not a bullet</p><p>&gt; not a quote</p><p>---</p><p>```</p><p>|a|</p>')).toBe(
        '# not heading\n\n1. not a list\n\n- not a bullet\n\n> not a quote\n\n---\n\n```\n\n|a|',
      );
    });

    it('keeps a <pre> block verbatim as its own block, with no delimiters', () => {
      expect(extracted('<pre>\nfirst line\n  indented ``` here<br>after break</pre>')).toBe(
        'first line\n  indented ``` here\nafter break',
      );
    });

    it('renders links as text (url), dropping script, data and in-page targets', () => {
      expect(
        extracted(
          '<p><a href="https://x.dev/a b(c)">see [this]</a> <a href="javascript:alert(1)">js</a> ' +
            '<a href="#top">top</a> <a href="data:text/html,x">data</a> <a href="/p?a=1&amp;b=2">amp</a> <a href="/i"><img src="i.png"></a></p>',
        ),
      ).toBe('see [this] (https://x.dev/a b(c)) js top data amp (/p?a=1&b=2)');
    });

    it('renders a link whose text is its url as just the text', () => {
      expect(extracted('<p>see <a href="https://x.dev/a">https://x.dev/a</a> now</p>')).toBe('see https://x.dev/a now');
    });

    it('keeps inline code as raw text with no delimiters', () => {
      expect(extracted('<p>call <code>run()</code> or <code>a ` b</code></p>')).toBe('call run() or a ` b');
    });

    it('renders list items as lines starting with - or N., nested items indented by two spaces', () => {
      expect(extracted('<ul><li>one</li><li>two<ul><li>inner</li></ul></li></ul><ol start="3"><li>three<li>four</ol>')).toBe(
        '- one\n- two\n\n  - inner\n\n3. three\n4. four',
      );
    });

    it('keeps a <pre> inside a list item verbatim (never indented)', () => {
      expect(extracted('<ul><li>step<pre>  a\n b</pre></li></ul>')).toBe('- step\n\n  a\n b');
    });

    it('renders a table as one line per row, cells joined by " | "', () => {
      expect(
        extracted('<table><thead><tr><th>Name</th><th>A|B</th></tr></thead><tbody><tr><td>x</td></tr><tr><td>y</td><td><b>z</b></td></tr></tbody></table>'),
      ).toBe('Name | A|B\nx\ny | z');
    });

    it('renders block quote content as its own paragraphs, and image alt text', () => {
      expect(extracted('<main><blockquote><p>quoted</p><p>more</p></blockquote><p><img alt="A chart"></p></main>')).toBe(
        'quoted\n\nmore\n\n[image: A chart]',
      );
    });
  });

  describe('refusals', () => {
    it('returns input without elements unchanged', () => {
      refused('just text, no tags', 'no HTML elements found');
      refused('', 'no HTML elements found');
    });

    it('returns input over 2 MiB unchanged', () => {
      refused(`<p>${'x'.repeat(2 * 1024 * 1024)}</p>`, 'input larger than 2 MiB; not extracted');
    });

    it('refuses nesting deeper than 512 elements, and handles 500 levels', () => {
      refused(`${'<div>'.repeat(513)}x`, 'element nesting deeper than 512');
      expect(extracted(`${'<div>'.repeat(500)}deep text`)).toBe('deep text');
      expect(extracted(`${'<ul><li>'.repeat(250)}deep item`)).toContain('deep item');
    });

    it('never throws on generated tag soup', () => {
      const tags = ['div', 'p', 'span', 'b', 'a', 'li', 'ul', 'table', 'tr', 'td', 'pre', 'code', 'nav', 'main', 'article', 'h2', 'svg', 'script', 'style', 'textarea', 'title', 'template', 'dialog', 'br', 'html', 'body', 'head'];
      const pieces = ['<!--', '-->', '<!-->', '<![CDATA[', ']]>', '&amp;', '&#x', '<', '>', '"', "'", ' hidden', '=', '/'];
      let seed = 7;
      const next = (n: number): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      for (let c = 0; c < 400; c++) {
        let html = '';
        for (let k = 0; k < 40; k++) {
          const roll = next(6);
          const tag = tags[next(tags.length)];
          html +=
            roll === 0 ? `<${tag}${next(3) === 0 ? ' hidden' : ''}>` :
            roll === 1 ? `</${tag}>` :
            roll === 2 ? pieces[next(pieces.length)] :
            ` word${k} `;
        }
        reduce(html);
      }
    });
  });

  describe('linear cost at the 2 MiB cap', () => {
    const CAP = 2 * 1024 * 1024;
    /**
     * Fastest of three runs. Measured on an idle machine (Node 24, fastest of
     * three): text under 500 nested links 668 ms, unclosed list items 566 ms,
     * items under 250 nested lists 552 ms, unclosed paragraphs 542 ms, quotes
     * 524 ms, unclosed cells 466 ms, every other shape under 350 ms. These are
     * the element-count and nesting worst cases (about 400,000 elements;
     * nested decoration stops at 8 levels); the
     * bound leaves room for a loaded CI runner while still failing on any
     * quadratic path, which at this size would take minutes.
     *
     * Load-robust fallback (the Batch 2a timing note: a relative budget
     * against a linear baseline measured in the same run): a shape over the
     * absolute bound still passes when it is within {@link LOAD_FACTOR} of
     * a linear reference shape timed right after it, under the same load.
     * On a machine at 100% CPU every shape here ran 2-3x slower while
     * staying within ~1.5x of the reference; a quadratic path at this size
     * is 100x+ slower (review r2 N1: 133 s against ~0.5 s), so it fails
     * either way (see {@link expectLinearTime}, which also caps every run
     * at a hard ceiling).
     */
    const fill = capFill;

    it.each([
      ['stray < characters', () => fill('<')],
      ['one unterminated tag name', () => fill('<a')],
      ['unclosed divs (refused by depth)', () => fill('<div>')],
      ['unclosed paragraphs', () => fill('<p>x')],
      ['unclosed list items', () => fill('<li>x')],
      ['unclosed cells', () => fill('<td>x')],
      ['unclosed inline tags', () => fill('<b>x</i>')],
      ['stray end tags', () => fill('</div>', '<div>')],
      ['stray end tags under a deep open stack', () => fill('</span>', '<div>'.repeat(500))],
      ['comment openers', () => fill('<!--')],
      ['dash runs in one comment', () => fill('-', '<!--')],
      ['near-miss script end tags', () => fill('</scrip', '<script>')],
      ['one huge text node', () => fill('word ', '<p>')],
      ['ampersands', () => fill('&', '<p>')],
      ['numeric entity prefixes', () => fill('&#', '<p>')],
      ['one unterminated attribute value', () => fill('x', '<a href="')],
      ['many attributes', () => fill(' a=b', '<p')],
      ['CDATA openers in svg', () => fill('<![CDATA[', '<svg>')],
      ['processing instructions', () => fill('<?')],
      ['sibling elements with text', () => fill('<span>ab</span>', '<p>')],
      ['nested tables at depth', () => fill('<table><tr><td>')],
      ['headings', () => fill('<h2>x</h2>')],
      ['line breaks', () => fill('<br>', '<p>')],
      ['list items with links', () => fill('<li><a href="/y">item</a></li>', '<ul>')],
      ['items under 250 nested lists', () => fill('<li>x', '<ul><li>'.repeat(250))],
      ['text under 500 nested links', () => fill('word ', '<a href="/x">'.repeat(500))],
      ['paragraphs under 500 nested quotes', () => fill('<p>x', '<blockquote>'.repeat(500))],
      ['inline styles with comments', () => fill('<i style="color:red;display:block;/* c */">x</i>')],
      ['a comment-wrapped script opener', () => fill('<a', '<script><!--')],
    ])('%s stays fast, never throws and stays valid', (_name, build) => {
      const input = build();
      expect(input.length).toBeLessThanOrEqual(CAP);
      expect(input.length).toBeGreaterThan(CAP - 1024);
      const { result: checked, elapsed } = fastestOfThree(input);
      expectLinearTime(elapsed);
      if (checked.reducer === 'html-unchanged') {
        expect(checked.text).toBe(input);
      } else {
        expect(checked.text.trim().length).toBeGreaterThan(0);
      }
    }, TIMING_TEST_TIMEOUT_MS);
  });

  describe('review r1 regressions', () => {
    it('D2 never lets double-escaped script data out as content', () => {
      const result = reduce('<main><p>shown</p><script><!--<script></script><h1>SECRET</h1>--></script></main>');
      expect(result.text.includes('SECRET') && result.reducer === 'html-extract').toBe(false);
      expect(result).toEqual({
        text: '<main><p>shown</p><script><!--<script></script><h1>SECRET</h1>--></script></main>',
        reducer: 'html-unchanged',
        notes: ['script body may be double-escaped'],
      });
    });

    it('D2 still extracts around a legacy comment-wrapped script', () => {
      expect(extracted('<main><script><!-- var a = "<b>"; //--></script><p>shown</p></main>')).toBe('shown');
    });

    it('D3 consumes a quoted > inside end-tag attributes', () => {
      expect(extracted('<main><p>shown</p><div hidden>x</div title=">SECRET"><p>after</p></main>')).toBe('shown\n\nafter');
    });

    it.each([
      ['a numeric reference for the colon', '<div style="display&#58;none">SECRET</div>'],
      ['a numeric reference without a semicolon', '<div style="display&#58none">SECRET</div>'],
      ['a comment between colon and value', '<div style="display:/**/none">SECRET</div>'],
      ['upper case and !important', '<div style="DISPLAY : NONE !IMPORTANT; display: block">SECRET</div>'],
      ['visibility collapse', '<div style="visibility:collapse">SECRET</div>'],
      ['content-visibility hidden', '<div style="content-visibility: hidden">SECRET</div>'],
    ])('D4 hides an element whose inline style resolves to hidden: %s', (_name, hidden) => {
      expect(extracted(`<main><p>shown</p>${hidden}</main>`)).toBe('shown');
    });

    it.each([
      ['a later valid declaration', '<div style="display:none;display:block">VISIBLE</div>'],
      ['a semicolon inside a string', '<div style=\'font-family:"x;display:none"\'>VISIBLE</div>'],
      ['a split property name', '<div style="dis/**/play:none">VISIBLE</div>'],
    ])('D4 keeps an element whose inline style resolves to visible: %s', (_name, visible) => {
      expect(extracted(`<main><p>shown</p>${visible}</main>`)).toBe('shown\n\nVISIBLE');
    });

    it.each([
      ['an unknown named reference', '<div style="display&colon;none">x</div>', 'inline style has an unknown character reference'],
      ['a CSS escape', '<div style="di\\73 play:none">x</div>', 'inline style uses CSS syntax this extractor does not model'],
      ['an unterminated string', '<div style="font-family:\'x; display:none">x</div>', 'inline style uses CSS syntax this extractor does not model'],
    ])('D4 refuses an inline style it cannot resolve: %s', (_name, element, reason) => {
      refused(`<main><p>shown</p>${element}</main>`, reason);
    });

    it('D5 keeps a table caption next to its table', () => {
      expect(
        extracted('<main><table><caption>Amounts in thousands</caption><tr><th>USD</th></tr><tr><td>5</td></tr></table></main>'),
      ).toBe('Amounts in thousands\n\nUSD\n5');
    });

    it('D5 keeps text the browser moves out of a table (foster parenting)', () => {
      expect(extracted('<main><table>Totals are estimates<tr><td>5</td></tr></table></main>')).toBe(
        'Totals are estimates\n\n5',
      );
    });

    it('D6 renders a ragged table without padding every row, in linear time at the 2 MiB cap', () => {
      const n = 6000;
      let input = `<main><table><tr>${'<td>x</td>'.repeat(n)}</tr>${'<tr><td>y</td></tr>'.repeat(n)}</table></main>`;
      input += `<!--${'x'.repeat(2 * 1024 * 1024 - input.length - 7)}-->`;
      expect(input.length).toBe(2 * 1024 * 1024);
      const { result, elapsed } = fastestOfThree(input);
      expectLinearTime(elapsed);
      expect(result.reducer).toBe('html-extract');
      expect(result.text.split('\n').slice(1, 3)).toEqual(['y', 'y']);
    }, TIMING_TEST_TIMEOUT_MS);

    it('D7 keeps trailing whitespace inside <pre>', () => {
      expect(extracted('<main><p>shown</p><pre>first\nlast  \n\n</pre></main>')).toBe('shown\n\nfirst\nlast  \n\n');
    });

    it('D8 keeps a chosen heading as its own block', () => {
      expect(extracted('<h1>Only heading</h1>')).toBe('Only heading');
    });
  });

  describe('review r2 regressions', () => {
    const CAP = 2 * 1024 * 1024;

    /** Fastest of up to three runs (stops early once a run is under the bound). */
    function fastest(input: string, bound: number): { result: ReduceResult; elapsed: number } {
      let elapsed = Infinity;
      let result: ReduceResult | undefined;
      for (let run = 0; run < 3 && elapsed >= bound; run++) {
        const start = performance.now();
        result = reduceHtml(input, { budgetTokens: 2000 });
        elapsed = Math.min(elapsed, performance.now() - start);
      }
      return { result: result as ReduceResult, elapsed };
    }

    it.each([
      ['without a comment', ''],
      ['with a comment after the scripts', '<!-- c -->'],
    ])('N1 scans many sibling scripts in linear time at the 2 MiB cap (%s)', (_name, tail) => {
      const head = '<main><p>visible</p>';
      const end = `${tail}</main>`;
      const input = head + '<script></script>'.repeat(Math.floor((CAP - head.length - end.length) / 17)) + end;
      expect(input.length).toBeGreaterThan(CAP - 17);
      const { result, elapsed } = fastest(input, MAX_CAP_MS);
      expectLinearTime(elapsed);
      expect(result.text).toBe('visible');
    }, TIMING_TEST_TIMEOUT_MS);

    it.each([
      ['display:none;display:inline flow'],
      ['display:none;display:block flex'],
      ['display:none;display:list-item block flow'],
    ])('N2 keeps an element whose later multi-keyword display overrides none: %s', (style) => {
      expect(extracted(`<main><p>shown</p><div style="${style}">VISIBLE</div></main>`)).toBe('shown\n\nVISIBLE');
    });

    it.each([
      ['a custom property', 'display:none;display:var(--d)'],
      ['an unknown keyword', 'display:none; display:blok'],
      ['an unknown visibility value', 'visibility:hidden;visibility:var(--v)'],
    ])('N2 refuses a style whose hiding value may be overridden by an unmodelled value: %s', (_name, style) => {
      refused(`<main><p>shown</p><div style="${style}">x</div></main>`, 'inline style value this extractor does not model');
    });

    it('N2 still hides when an unmodelled value cannot override an !important none', () => {
      expect(extracted('<main><p>shown</p><div style="display:none !important;display:var(--d)">SECRET</div></main>')).toBe('shown');
    });

    const nested = (depth: number): string =>
      '<main>' +
      '<blockquote>'.repeat(depth) +
      '<p>before <a href="/essential">link</a> after</p><p><code>text &lt;span hidden&gt;VISIBLE&lt;/span&gt;</code></p>' +
      '</blockquote>'.repeat(depth) +
      '</main>';

    it.each([7, 8, 9])('N3 keeps the link target and the literal code text at quote depth %i', (depth) => {
      // Plain text needs no nested rendering for quotes, links or code, so
      // nothing is flattened and nothing is refused at any depth.
      expect(extracted(nested(depth))).toBe(
        'before link (/essential) after\n\ntext <span hidden>VISIBLE</span>',
      );
    });

    it.each([
      ['a comment before the newline keeps it', '<pre><!--c-->\nline</pre>', '\nline'],
      ['a newline character reference is dropped', '<pre>&#10;line</pre>', 'line'],
      ['a hex newline reference is dropped', '<pre>&#x0A;line</pre>', 'line'],
      ['a lone CR is dropped', '<pre>\rline</pre>', 'line'],
      ['a CRLF is dropped', '<pre>\r\nline</pre>', 'line'],
      ['a longer numeric reference is not a newline', '<pre>&#105;x</pre>', 'ix'],
      ['a newline inside the first inline child is kept', '<pre><code>\nline</code></pre>', '\nline'],
    ])('N4 follows the parser for the newline after <pre>: %s', (_name, pre, text) => {
      expect(extracted(`<main><p>shown</p>${pre}</main>`)).toBe(`shown\n\n${text}`);
    });

    it('N5 puts browser-fostered content before the caption and the table', () => {
      expect(extracted('<main><table><caption>CAPTION</caption><tr><td>CELL</td></tr><div>OUTSIDE</div></table></main>')).toBe(
        'OUTSIDE\n\nCAPTION\n\nCELL',
      );
    });
  });

  describe('review r3 regressions', () => {
    const quoted = (inner: string): string =>
      `<main>${'<blockquote>'.repeat(8)}${inner}${'</blockquote>'.repeat(8)}</main>`;

    it.each([
      ['a shallow tt', '<main><p>text <tt>&lt;span hidden&gt;VISIBLE&lt;/span&gt;</tt></p></main>', 'text <span hidden>VISIBLE</span>'],
      ['ordinary paragraph text', '<main><p>a &lt;b&gt; tag and &lt;!-- c --&gt;</p></main>', 'a <b> tag and <!-- c -->'],
      ['an entity spelled out in text', '<main><p>write &amp;lt; or &amp;#60; or &amp;copy;</p></main>', 'write &lt; or &#60; or &copy;'],
      ['an ampersand before a space', '<main><p>Tom &amp; Jerry</p></main>', 'Tom & Jerry'],
      ['image alt text', '<main><p><img alt="&lt;i&gt;x"></p></main>', '[image: <i>x]'],
      ['text directly in a list', '<main><ul>&lt;b&gt;x<li>item</li></ul></main>', '<b>x\n- item'],
    ])('R3-1 keeps literal markup in visible text as literal characters: %s', (_name, input, output) => {
      expect(extracted(input)).toBe(output);
    });

    it.each([
      ['var', '<var>text &lt;span hidden&gt;VISIBLE&lt;/span&gt;</var>', 'text <span hidden>VISIBLE</span>'],
      ['script-looking paragraph', '<p>text &lt;script&gt;VISIBLE&lt;/script&gt;</p>', 'text <script>VISIBLE</script>'],
    ])('R3-1 keeps literal markup as literal characters under eight quotes: %s', (_name, inner, output) => {
      expect(extracted(quoted(inner))).toBe(output);
    });

    it('R3-1 keeps a link target as written', () => {
      expect(extracted('<main><p><a href="/p?a=1&amp;copy;b">x</a></p></main>')).toBe('x (/p?a=1&copy;b)');
    });

    it('R3-1 keeps code text raw, with no delimiters', () => {
      expect(extracted('<main><p>run <code>&lt;b&gt; ``x``</code></p><pre>&lt;i&gt; ````</pre></main>')).toBe(
        'run <b> ``x``\n\n<i> ````',
      );
    });

    it.each([
      ['xmp', '<main><p>shown</p><xmp>text &lt;span hidden&gt;VISIBLE&lt;/span&gt;</xmp></main>'],
      ['plaintext', '<main><p>shown</p><plaintext>raw &lt;b&gt; rest'],
    ])('R3-2 refuses %s raw text instead of dropping or misreading it', (_name, input) => {
      refused(input, 'xmp or plaintext raw text is not modelled');
    });
  });

  describe('review r4 regressions (User Decision 12: plain text)', () => {
    it.each([
      ['A: backslashes before encoded angles', '<main><p>text \\&lt;span hidden&gt;VISIBLE\\&lt;/span&gt;</p></main>', 'text \\<span hidden>VISIBLE\\</span>'],
      ['A: the comment variant', '<main><p>text \\&lt;!--VISIBLE--&gt; after</p></main>', 'text \\<!--VISIBLE--> after'],
      ['B: an entity split across text nodes', '<main><p>text &amp;<span>copy;</span></p></main>', 'text &copy;'],
      ['C: literal link syntax', '<main><p>text [VISIBLE](/wrong)</p></main>', 'text [VISIBLE](/wrong)'],
      ['C: literal image syntax', '<main><p>see ![VISIBLE](/image.png)</p></main>', 'see ![VISIBLE](/image.png)'],
      ['C: a heading ending in #', '<main><h1>literal #</h1></main>', 'literal #'],
      ['C: an image alt with link punctuation', '<main><p><img alt="a](/wrong)"></p></main>', '[image: a](/wrong)]'],
    ])('defect 1 keeps literal source text as literal characters: %s', (_name, input, output) => {
      expect(extracted(input)).toBe(output);
    });

    it.each([
      ['A: adjacent code elements', '<main><p><code>a</code><code>b</code></p></main>', 'ab'],
      ['B: spaces at code edges', '<main><p>A<code> x </code>B</p></main>', 'A x B'],
      ['inner spaces of code are kept', '<main><p>run <code>a  b</code> now</p></main>', 'run a  b now'],
    ])('defect 2 keeps code text raw, joined with its neighbours: %s', (_name, input, output) => {
      expect(extracted(input)).toBe(output);
    });

    it.each([
      ['A: hidden with a display override', '<main><p>shown</p><div hidden style="display:block">VISIBLE</div></main>'],
      ['B: a visible child under visibility:hidden', '<main><p>shown</p><div style="visibility:hidden">SECRET<span style="visibility:visible">VISIBLE</span></div></main>'],
      ['a closed dialog with a display override', '<main><p>shown</p><dialog style="display:block">VISIBLE</dialog></main>'],
      ['a UA-hidden element with a display override', '<main><p>shown</p><script style="display:block">VISIBLE</script></main>'],
    ])('defect 3 refuses a conflicting visibility state: %s', (_name, input) => {
      refused(input, 'conflicting visibility state not modelled');
    });

    it('defect 3 still hides hidden content without an override', () => {
      expect(extracted('<main><p>shown</p><div hidden style="color:red">SECRET</div><div style="visibility:hidden"><span>SECRET</span></div></main>')).toBe('shown');
    });
  });
});
