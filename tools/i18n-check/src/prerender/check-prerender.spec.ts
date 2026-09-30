import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as babelPlugin from 'prettier/plugins/babel';
import * as estreePlugin from 'prettier/plugins/estree';
import { format } from 'prettier/standalone';
import { parse } from 'parse5';
import { UsageError } from '../lib/cli';
import {
  PRERENDER_ROUTES,
  checkPrerender,
  collapseWhitespace,
  describeDifference,
  extractVisibleText,
  parseArgs,
  serialiseBaseline,
  snapshotPage,
  type PrerenderOptions,
} from './check-prerender';

const page = (body: string, htmlAttrs = 'lang="en" dir="ltr"'): string =>
  `<!doctype html><html ${htmlAttrs}><head><title>Head text is not body text</title>` +
  `<style>.a{}</style></head><body>${body}</body></html>`;

const bodyText = (body: string): string => snapshotPage(page(body)).text;

describe('extractVisibleText (the shared normalisation)', () => {
  it('joins across a new island wrapper with no separator: $29/mo', () => {
    expect(bodyText('<p><span class="ltr-island">$29</span>/mo</p>')).toBe(
      '$29/mo',
    );
    // Identical to the unwrapped original, so wrapping never drifts a baseline.
    expect(bodyText('<p>$29/mo</p>')).toBe('$29/mo');
    expect(bodyText('<p><span dir="ltr">$29</span>/mo</p>')).toBe('$29/mo');
  });

  it('keeps whitespace that exists between nodes, collapsed', () => {
    expect(bodyText('<p>Hello</p>\n   <p>world</p>')).toBe('Hello world');
    expect(bodyText('<h1>It ships<br><span>the SaaS.</span></h1>')).toBe(
      'It shipsthe SaaS.',
    );
  });

  it('collapses Unicode whitespace runs and trims', () => {
    expect(bodyText('  <p>a   \t\n b</p>  ')).toBe('a b');
    expect(collapseWhitespace('　 x   y ')).toBe('x y');
  });

  it('decodes entities', () => {
    expect(bodyText('<p>Tom &amp; Jerry &rarr; &#36;5</p>')).toBe(
      'Tom & Jerry → $5',
    );
  });

  it('skips comments, script, style, template and [data-i18n-switcher]', () => {
    const body =
      '<p>a<!-- hidden comment -->b</p>' +
      '<script>var hidden = 1;</script>' +
      '<style>.hidden{}</style>' +
      '<template><p>hidden template</p></template>' +
      '<div data-i18n-switcher><button>English</button><button>العربية</button></div>' +
      '<p>c</p>';
    expect(bodyText(body)).toBe('abc');
  });

  it('skips a [data-prerender-volatile] subtree, whatever it renders', () => {
    // The countdown host: ticking cells before the deadline, a fixed label
    // after it. Neither is baselined.
    const ticking =
      '<p>Offer closes Sep 30</p>' +
      '<ptah-countdown-timer data-prerender-volatile="">' +
      '<div><span>03</span><span>Days</span>:<span>07</span><span>Hrs</span></div>' +
      '</ptah-countdown-timer>' +
      '<p>Apply</p>';
    const expired = ticking.replace(
      /<div>.*<\/div>/,
      '<div>Applications closing</div>',
    );
    expect(bodyText(ticking)).toBe('Offer closes Sep 30Apply');
    expect(bodyText(expired)).toBe('Offer closes Sep 30Apply');
  });

  it('joins the text on both sides of a volatile subtree with no separator', () => {
    expect(bodyText('a<span data-prerender-volatile>1</span>b')).toBe('ab');
    // Whitespace outside the subtree is kept (collapsed), as for any element.
    expect(bodyText('a <span data-prerender-volatile>1</span>\n b')).toBe(
      'a b',
    );
  });

  it('extracts body text only (head <title> is not included)', () => {
    expect(bodyText('<p>x</p>')).toBe('x');
  });

  it('is the function used for headings as well as the page', () => {
    const doc = parse('<h1> A <span>B</span> </h1>');
    expect(extractVisibleText(doc)).toBe('A B');
    expect(snapshotPage(page('<h1> A <span>B</span> </h1>')).h1).toBe('A B');
  });
});

describe('snapshotPage assertions input', () => {
  it('flags a text node that is a scope-anchored key path', () => {
    const snap = snapshotPage(
      page(
        '<p> landing.hero.title </p><p>panelUi.nav.group-1</p>' +
          '<a>ptah.live</a><p>see core.errors for details</p><p>landing</p>',
      ),
    );
    expect(snap.keyPaths).toEqual([
      'landing.hero.title',
      'panelUi.nav.group-1',
    ]);
  });

  it('does not report a key path inside a volatile subtree (one shared skip)', () => {
    // Chosen on purpose: every walk uses the same skip, so capture, compare,
    // headings and key paths never disagree about what a page contains. The
    // only volatile host (the countdown) renders numbers and fixed labels, and
    // a key path anywhere else is still reported.
    const snap = snapshotPage(
      page(
        '<div data-prerender-volatile><p>ui.countdown.days</p></div>' +
          '<p>ui.countdown.hours</p>',
      ),
    );
    expect(snap.keyPaths).toEqual(['ui.countdown.hours']);
  });

  it('ignores headings inside a volatile subtree', () => {
    const snap = snapshotPage(
      page('<div data-prerender-volatile><h1></h1></div><h1>Real</h1>'),
    );
    expect(snap.emptyHeadings).toEqual([]);
    expect(snap.h1).toBe('Real');
  });

  it('lists empty h1 and h2 elements, including whitespace-only ones', () => {
    const snap = snapshotPage(
      page('<h1> </h1><h2><span></span></h2><h2>ok</h2><h3></h3>'),
    );
    expect(snap.emptyHeadings).toEqual(['h1', 'h2']);
    expect(snap.h1).toBe('');
  });

  it('reads lang and dir from <html>', () => {
    expect(snapshotPage(page('<p>x</p>', 'lang="en"')).dir).toBeNull();
    const snap = snapshotPage(page('<p>x</p>', 'lang="ar" dir="rtl"'));
    expect(snap).toMatchObject({ lang: 'ar', dir: 'rtl' });
  });
});

describe('describeDifference', () => {
  it('points at the first differing character', () => {
    expect(describeDifference('abcdef', 'abcXef')).toBe(
      'first difference at character 3: baseline "abcdef", prerender "abcXef"',
    );
  });
});

describe('serialiseBaseline', () => {
  it('is already Prettier-clean, so the pre-commit format leaves it unchanged', async () => {
    const content = serialiseBaseline({
      route: '/pricing',
      h1: 'Ptah Is Free. "Quoted"',
      text: 'Long text → with a quote " and a backslash \\ and $29/mo',
    });
    const formatted = await format(content, {
      parser: 'json',
      plugins: [babelPlugin, estreePlugin],
      singleQuote: true,
    });
    expect(formatted).toBe(content);
  });
});

describe('parseArgs', () => {
  it('parses flags and resolves the workspace root', () => {
    expect(
      parseArgs([
        '--dist',
        'd',
        '--baseline',
        'b',
        '--update',
        '--workspace-root',
        '/w',
      ]),
    ).toEqual({
      workspaceRoot: path.resolve('/w'),
      dist: 'd',
      baseline: 'b',
      update: true,
    });
  });

  it.each([
    [['--dist', 'd'], '--dist and --baseline are required'],
    [['--dist', '--baseline', 'b'], '--dist needs a value'],
    [
      ['--dist', 'd', '--baseline', 'b', '--bogus'],
      'unknown argument "--bogus"',
    ],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(new UsageError(message));
  });
});

describe('checkPrerender', () => {
  let root: string;
  const pages: Record<string, string> = {
    home: '<h1>It ships<br><span>the SaaS.</span></h1><p><span class="ltr-island">$29</span>/mo</p>',
    download: '<h1>Downloads</h1>',
    pricing: '<h1>Ptah Is Free.</h1>',
    'terms-and-conditions': '<h1>Terms of Service</h1>',
    privacy: '<h1>Privacy Policy</h1>',
    refund: '<h1>Refund Policy</h1>',
  };
  const writeDist = (
    htmlAttrs: string,
    override: Record<string, string> = {},
  ): void => {
    for (const route of PRERENDER_ROUTES) {
      const abs = path.join(root, 'dist', route.file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(
        abs,
        page(override[route.slug] ?? pages[route.slug], htmlAttrs),
      );
    }
  };
  const options = (over: Partial<PrerenderOptions> = {}): PrerenderOptions => ({
    workspaceRoot: root,
    dist: 'dist',
    baseline: 'baseline',
    update: false,
    ...over,
  });
  const baselinePath = (slug: string): string =>
    path.join(root, 'baseline', `${slug}.json`);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-prerender-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('captures without asserting dir (pre-i18n build) and writes { route, h1, text }', () => {
    writeDist('lang="en"');
    const result = checkPrerender(options({ update: true }));
    expect(result.code).toBe(0);
    expect(result.lines).toHaveLength(6);
    expect(JSON.parse(fs.readFileSync(baselinePath('home'), 'utf8'))).toEqual({
      route: '/',
      h1: 'It shipsthe SaaS.',
      text: 'It shipsthe SaaS.$29/mo',
    });
    expect(
      JSON.parse(fs.readFileSync(baselinePath('terms-and-conditions'), 'utf8'))
        .route,
    ).toBe('/terms-and-conditions');
  });

  it('compare asserts dir; every other check passes against its own capture', () => {
    writeDist('lang="en"');
    checkPrerender(options({ update: true }));
    const result = checkPrerender(options());
    expect(result.code).toBe(1);
    expect(
      result.lines.filter((l) => l.includes('[prerender-dir]')),
    ).toHaveLength(6);
    expect(result.lines.at(-1)).toBe(
      'check-prerender (compare): 6 violation(s)',
    );

    writeDist('lang="en" dir="ltr"');
    expect(checkPrerender(options())).toEqual({
      code: 0,
      lines: ['check-prerender: 6 routes match their baselines'],
    });
  });

  it('passes when a price is later wrapped in an island (no-separator join)', () => {
    writeDist('lang="en" dir="ltr"', {
      home: pages['home'].replace(
        '<span class="ltr-island">$29</span>',
        // A function, so "$29" is literal text, not a replacement pattern.
        () => '$29',
      ),
    });
    checkPrerender(options({ update: true }));
    writeDist('lang="en" dir="ltr"');
    expect(checkPrerender(options()).code).toBe(0);
  });

  it('compares baselines as parsed JSON, not bytes', () => {
    writeDist('lang="en" dir="ltr"');
    checkPrerender(options({ update: true }));
    const parsed = JSON.parse(fs.readFileSync(baselinePath('pricing'), 'utf8'));
    fs.writeFileSync(baselinePath('pricing'), JSON.stringify(parsed));
    expect(checkPrerender(options()).code).toBe(0);
  });

  it('reports text and h1 drift with the first difference', () => {
    writeDist('lang="en" dir="ltr"');
    checkPrerender(options({ update: true }));
    writeDist('lang="en" dir="ltr"', { pricing: '<h1>Ptah Is Paid.</h1>' });
    const result = checkPrerender(options());
    expect(result.code).toBe(1);
    expect(result.lines).toEqual([
      'dist/pricing/index.html:0: [prerender-drift] h1 - first difference at character 8: baseline "Ptah Is Free.", prerender "Ptah Is Paid."',
      'dist/pricing/index.html:0: [prerender-drift] text - first difference at character 8: baseline "Ptah Is Free.", prerender "Ptah Is Paid."',
      'check-prerender (compare): 2 violation(s)',
    ]);
  });

  it('fails a key path, an empty heading and a wrong lang, and captures nothing', () => {
    writeDist('lang="ar"', {
      download: '<h1>Downloads</h1><h2></h2><p>core.errors.network</p>',
    });
    const result = checkPrerender(options({ update: true }));
    expect(result.code).toBe(1);
    expect(result.lines).toContain(
      'dist/download/index.html:0: [prerender-key-path] core.errors.network - a translation key path is rendered as text',
    );
    expect(result.lines).toContain(
      'dist/download/index.html:0: [prerender-empty-heading] - an empty <h2> is rendered',
    );
    expect(
      result.lines.filter((l) => l.includes('[prerender-lang]')),
    ).toHaveLength(6);
    expect(result.lines.at(-1)).toBe(
      'check-prerender (capture): 8 violation(s); no baseline written',
    );
    expect(fs.existsSync(path.join(root, 'baseline'))).toBe(false);
  });

  it('fails an empty h1', () => {
    writeDist('lang="en" dir="ltr"', { refund: '<h1><!-- icon only --></h1>' });
    const result = checkPrerender(options({ update: true }));
    expect(result.lines).toContain(
      'dist/refund/index.html:0: [prerender-empty-heading] - an empty <h1> is rendered',
    );
  });

  it('reports missing prerender output, missing and malformed baselines', () => {
    writeDist('lang="en" dir="ltr"');
    checkPrerender(options({ update: true }));
    fs.rmSync(path.join(root, 'dist', 'privacy', 'index.html'));
    fs.rmSync(baselinePath('download'));
    fs.writeFileSync(baselinePath('pricing'), '{ not json');
    fs.writeFileSync(
      baselinePath('refund'),
      JSON.stringify({ route: '/refund', h1: 1 }),
    );
    fs.writeFileSync(
      baselinePath('home'),
      JSON.stringify({ route: '/download', h1: '', text: '' }),
    );
    const lines = checkPrerender(options()).lines;
    expect(lines).toEqual(
      expect.arrayContaining([
        'dist/privacy/index.html:0: [missing-file] - prerendered /privacy missing; build ptah-landing-page first',
        'baseline/download.json:0: [missing-file] - baseline missing; baselines are captured once and never regenerated',
        expect.stringMatching(/^baseline\/pricing\.json:0: \[parse-error\] - /),
        'baseline/refund.json:0: [invalid-value] - baseline must be { "route": string, "h1": string, "text": string }',
        'baseline/home.json:0: [invalid-value] - baseline route is "/download", expected "/"',
      ]),
    );
    expect(lines.at(-1)).toBe('check-prerender (compare): 5 violation(s)');
  });
});
