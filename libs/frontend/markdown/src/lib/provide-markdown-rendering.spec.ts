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

  it('produces a different (richer) provider tree for full vs basic', () => {
    const basic = provideMarkdownRendering({ extensions: 'basic' });
    const full = provideMarkdownRendering({ extensions: 'full' });
    // Both arrays exist; their flattened content should differ in size because
    // the full preset wires up the sanitizer + 5 marked extensions.
    expect(JSON.stringify(basic)).not.toBe(JSON.stringify(full));
  });

  it('accepts a config object satisfying MarkdownRenderingConfig', () => {
    const cfg: MarkdownRenderingConfig = { extensions: 'full' };
    expect(() => provideMarkdownRendering(cfg)).not.toThrow();
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
