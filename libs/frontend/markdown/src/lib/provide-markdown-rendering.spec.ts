// Mock ngx-markdown so we don't pull marked.esm.mjs into the Jest module
// graph. The shape only needs to be enough for `provideMarkdown(...)` to
// return a serializable provider tree we can compare across presets.
jest.mock('ngx-markdown', () => {
  const provideMarkdown = (config?: unknown) => [
    { provide: 'NGX_MARKDOWN', useValue: config ?? {} },
  ];
  return {
    provideMarkdown,
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    SANITIZE: 'SANITIZE',
  };
});

import DOMPurify from 'dompurify';
import {
  provideMarkdownRendering,
  __resetMemberPurifierForTests,
  type MarkdownRenderingConfig,
} from './provide-markdown-rendering';

describe('provideMarkdownRendering', () => {
  it('returns Provider[] for the basic preset', () => {
    const providers = provideMarkdownRendering({ extensions: 'basic' });
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
  });

  it('returns Provider[] for the full preset', () => {
    const providers = provideMarkdownRendering({ extensions: 'full' });
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
  });

  it('returns Provider[] for the member preset', () => {
    const providers = provideMarkdownRendering({ extensions: 'member' });
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThan(0);
  });

  it('produces a different (richer) provider tree for full vs basic', () => {
    const basic = provideMarkdownRendering({ extensions: 'basic' });
    const full = provideMarkdownRendering({ extensions: 'full' });
    // Both arrays exist; their flattened content should differ in size because
    // the full preset wires up the sanitizer + 5 marked extensions.
    expect(JSON.stringify(basic)).not.toBe(JSON.stringify(full));
  });

  it('gives the member preset its own sanitizer, distinct from full', () => {
    const member = memberConfig();
    const full = presetConfig('full');
    expect(member.sanitize.useFactory).not.toBe(full.sanitize.useFactory);
    // No marked extensions: those decorate AI output, not forum posts.
    expect(member.markedExtensions).toBeUndefined();
    expect(full.markedExtensions).toBeDefined();
  });

  it('accepts a config object satisfying MarkdownRenderingConfig', () => {
    const cfg: MarkdownRenderingConfig = { extensions: 'full' };
    expect(() => provideMarkdownRendering(cfg)).not.toThrow();
  });
});

/**
 * Reaches through the `provideMarkdown` mock above to the config object the
 * factory actually passed. This exercises the SHIPPED sanitizer rather than a
 * copy of its options — the weakness of the `'full'` suite further down, which
 * re-states DOMPurify's options and so cannot notice them drifting.
 */
interface CapturedMarkdownConfig {
  sanitize: { provide: string; useFactory: () => (html: string) => string };
  markedExtensions?: unknown;
}

function presetConfig(extensions: 'full' | 'member'): CapturedMarkdownConfig {
  const providers = provideMarkdownRendering({ extensions }) as Array<
    Array<{ provide: string; useValue: CapturedMarkdownConfig }>
  >;
  return providers[0][0].useValue;
}

function memberConfig(): CapturedMarkdownConfig {
  return presetConfig('member');
}

describe("the 'member' preset sanitizer (member-authored UGC)", () => {
  let sanitize: (html: string) => string;

  beforeEach(() => {
    __resetMemberPurifierForTests();
    sanitize = memberConfig().sanitize.useFactory();
  });

  afterAll(() => {
    __resetMemberPurifierForTests();
  });

  it('keeps the markdown a composer can actually produce', () => {
    const out = sanitize(
      '<h2>Title</h2><p><strong>bold</strong> and <em>italic</em></p>' +
        '<ul><li>one</li></ul><pre><code class="language-ts">x</code></pre>' +
        '<blockquote><p>quoted</p></blockquote>' +
        '<table><tbody><tr><td>cell</td></tr></tbody></table>',
    );
    expect(out).toContain('<h2>Title</h2>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('class="language-ts"');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<td>cell</td>');
  });

  it('strips <script>', () => {
    const out = sanitize('<p>Hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<p>Hi</p>');
  });

  it('strips inline event handlers', () => {
    const out = sanitize('<p onclick="alert(1)">click</p>');
    expect(out.toLowerCase()).not.toContain('onclick');
  });

  it('rejects tags the permissive full preset allows', () => {
    // These four are exactly why the member preset is an allowlist: the `'full'`
    // deny-list permits every one of them, which is right for an AI diagram and
    // wrong for a post another member wrote.
    const out = sanitize(
      '<svg><circle r="1" /></svg><details><summary>s</summary></details>' +
        '<style>body{display:none}</style><ptah-callout>x</ptah-callout>',
    );
    expect(out).not.toContain('<svg');
    expect(out).not.toContain('<details');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('<ptah-callout');
  });

  it('strips style and data-* attributes', () => {
    const out = sanitize('<p style="position:fixed" data-x="1">t</p>');
    expect(out).not.toContain('style=');
    expect(out).not.toContain('data-x');
  });

  it('blocks javascript: URIs in any casing', () => {
    const out = sanitize('<a href="JaVaScRiPt:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('blocks data: URIs, which the full preset allows', () => {
    const out = sanitize(
      '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" alt="x">',
    );
    expect(out).not.toContain('data:text/html');
  });

  it('forces rel and target on every surviving anchor', () => {
    const out = sanitize('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });

  it('overwrites an author-supplied rel rather than trusting it', () => {
    const out = sanitize('<a href="https://example.com" rel="dofollow">x</a>');
    expect(out).not.toContain('dofollow');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
  });

  it('leaves relative links usable', () => {
    const out = sanitize('<a href="/members/hub">hub</a>');
    expect(out).toContain('href="/members/hub"');
  });

  it('does not register its anchor hook on the shared DOMPurify instance', () => {
    // The hook is instance-global. If it had been added to the default export,
    // the webview's `'full'` preset would silently start rewriting every anchor
    // it renders. This is the assertion that keeps the two presets independent.
    const viaDefault = DOMPurify.sanitize(
      '<a href="https://example.com">x</a>',
    );
    expect(viaDefault).not.toContain('nofollow');
  });
});

/**
 * The permissive sanitizer is created inside provide-markdown-rendering and
 * is not directly exported — but its behavior IS the public contract we
 * inherited from the webview. We exercise DOMPurify with the same options
 * the helper installs to confirm the ruleset blocks XSS but allows the
 * markdown features the chat UI relies on.
 */
describe('permissive sanitizer behavior (DOMPurify configuration)', () => {
  // Mirror the options inside createPermissiveSanitizer.
  const sanitize = (html: string): string =>
    DOMPurify.sanitize(html, {
      FORBID_TAGS: [
        'script',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'textarea',
        'select',
        'button',
      ],
      FORBID_ATTR: [
        'onerror',
        'onload',
        'onclick',
        'onmouseover',
        'onfocus',
        'onblur',
        'onsubmit',
        'onchange',
        'oninput',
        'onkeydown',
        'onkeyup',
        'onkeypress',
      ],
      ALLOW_DATA_ATTR: true,
      ALLOW_ARIA_ATTR: true,
      ALLOWED_URI_REGEXP:
        /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    });

  it('strips <script> tags', () => {
    const out = sanitize('<p>Hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).toContain('<p>Hi</p>');
  });

  it('strips inline onclick handlers', () => {
    const out = sanitize('<a href="#" onclick="alert(1)">click</a>');
    expect(out.toLowerCase()).not.toContain('onclick');
  });

  it('preserves <details> and <summary> elements', () => {
    const out = sanitize(
      '<details><summary>more</summary><p>body</p></details>',
    );
    expect(out).toContain('<details');
    expect(out).toContain('<summary');
  });

  it('preserves <kbd> elements', () => {
    const out = sanitize('<p>Press <kbd>Ctrl</kbd> + <kbd>C</kbd></p>');
    expect(out).toContain('<kbd>Ctrl</kbd>');
    expect(out).toContain('<kbd>C</kbd>');
  });

  it('preserves <table> structures', () => {
    const out = sanitize(
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>',
    );
    expect(out).toContain('<table');
    expect(out).toContain('<thead');
    expect(out).toContain('<tbody');
    expect(out).toContain('<th>h</th>');
    expect(out).toContain('<td>v</td>');
  });

  it('preserves data-* attributes used by marked extensions', () => {
    const out = sanitize('<div data-callout="note">x</div>');
    expect(out).toContain('data-callout="note"');
  });
});
