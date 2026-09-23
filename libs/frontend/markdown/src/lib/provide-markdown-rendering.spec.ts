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
import type { MarkedExtension, Tokens } from 'marked';
import { parseFileLinkHref } from './file-link-target';
import {
  provideMarkdownRendering,
  __resetMemberPurifierForTests,
  MARKDOWN_CONTAINMENT_ROOT_CLASS,
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

/**
 * The shipped 'full' sanitizer wraps every render in the containment root
 * (TASK_2026_532). This asserts the wrapper on every call and hands back the
 * inner HTML, so the policy tests below compare exactly what content became.
 */
const CONTAINMENT_ROOT_OPEN = `<div class="${MARKDOWN_CONTAINMENT_ROOT_CLASS}" style="contain: layout paint; isolation: isolate; overflow-x: auto;">`;

function unwrapContainmentRoot(output: string): string {
  expect(output.startsWith(CONTAINMENT_ROOT_OPEN)).toBe(true);
  expect(output.endsWith('</div>')).toBe(true);
  return output.slice(CONTAINMENT_ROOT_OPEN.length, -'</div>'.length);
}

function fullSanitizer(): (html: string) => string {
  const sanitize = presetConfig('full').sanitize.useFactory();
  return (html) => unwrapContainmentRoot(sanitize(html));
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

  it('rejects tags even when the full preset allows them', () => {
    // These are exactly why the member preset is an allowlist: the `'full'`
    // preset permits SVG and custom elements for AI output, which is right
    // for a diagram an agent drew and wrong for a post another member wrote.
    // The two presets have since diverged further (TASK_2026_532): `'full'`
    // now forbids `<style>` too, while still keeping `<details>`; member
    // rejects both.
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
 * The permissive sanitizer's behaviour, exercised through the SHIPPED 'full'
 * factory (not a hand-copied DOMPurify config — a copied config cannot notice
 * the real FORBID_TAGS, FORBID_ATTR or the class/style hook drifting). These
 * are the compatibility promises: XSS blocked, ordinary markdown features
 * kept.
 */
describe("permissive sanitizer behavior (the shipped 'full' factory)", () => {
  let sanitize: (html: string) => string;

  beforeEach(() => {
    sanitize = fullSanitizer();
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

/**
 * File links through the SHIPPED `'full'` pipeline: the link renderer the
 * provider registers, then the sanitizer the provider installs. Nothing here
 * re-states DOMPurify options, so a drift in either is caught.
 */
describe("file links through the shipped 'full' pipeline", () => {
  interface FullPresetConfig extends CapturedMarkdownConfig {
    markedExtensions: Array<{ useValue: MarkedExtension }>;
  }

  const fullConfig = (): FullPresetConfig =>
    presetConfig('full') as FullPresetConfig;

  const renderLink = (href: string): string | false => {
    const link = fullConfig()
      .markedExtensions.map((provider) => provider.useValue.renderer?.link)
      .find((renderer) => typeof renderer === 'function');
    if (!link) throw new Error("the 'full' preset registers no link renderer");
    return (link as (this: unknown, token: Tokens.Link) => string | false).call(
      { parser: { parseInline: () => 'open' } },
      {
        type: 'link',
        raw: '',
        href,
        title: null,
        text: 'open',
        tokens: [],
      } as Tokens.Link,
    );
  };

  const firstAnchor = (html: string): HTMLAnchorElement => {
    const template = document.createElement('template');
    template.innerHTML = html;
    const anchor = template.content.querySelector('a');
    if (!anchor) throw new Error('no anchor survived sanitizing');
    return anchor;
  };

  let sanitize: (html: string) => string;

  beforeEach(() => {
    sanitize = fullSanitizer();
  });

  it('keeps a Windows drive target in data-ptah-file-href', () => {
    const anchor = firstAnchor(sanitize(renderLink('C:\\x.ts:12:3') as string));
    expect(anchor.getAttribute('data-ptah-file-href')).toBe('C:\\x.ts:12:3');
    expect(anchor.getAttribute('href')).toBe('#');
    expect(anchor.getAttribute('class')).toBe('ptah-file-link');
  });

  it('keeps a file URL target in data-ptah-file-href', () => {
    const anchor = firstAnchor(
      sanitize(renderLink('file:///C:/a%20b.ts') as string),
    );
    expect(anchor.getAttribute('data-ptah-file-href')).toBe(
      'file:///C:/a%20b.ts',
    );
  });

  it.each([
    'C:\\x',
    'file:///C:/x',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
  ])('still strips a raw href of %s', (href) => {
    const anchor = firstAnchor(sanitize(`<a href="${href}">x</a>`));
    expect(anchor.hasAttribute('href')).toBe(false);
  });

  it('leaves an http link to the default renderer, and the sanitizer keeps it', () => {
    expect(renderLink('https://example.com/a.ts')).toBe(false);
    const anchor = firstAnchor(
      sanitize('<a href="https://example.com/a.ts">x</a>'),
    );
    expect(anchor.getAttribute('href')).toBe('https://example.com/a.ts');
  });

  it('strips the file-link opt-in marker from rendered content', () => {
    const clean = sanitize(
      '<div data-ptah-file-links=""><a href="#" data-ptah-file-href="src/a.ts" data-ptah-file-links>x</a></div>',
    );
    expect(clean).not.toContain('data-ptah-file-links');
    expect(firstAnchor(clean).getAttribute('data-ptah-file-href')).toBe(
      'src/a.ts',
    );
  });

  it('strips the opt-in marker in any casing', () => {
    const clean = sanitize('<p DATA-PTAH-FILE-LINKS="1">x</p>');
    expect(clean.toLowerCase()).not.toContain('data-ptah-file-links');
  });

  it('treats an agent-authored data-ptah-file-href as transport, not trust', () => {
    const anchor = firstAnchor(
      sanitize('<a href="#" data-ptah-file-href="javascript:alert(1)">x</a>'),
    );
    const raw = anchor.getAttribute('data-ptah-file-href');
    // The sanitizer keeps data attributes without URI checks...
    expect(raw).toBe('javascript:alert(1)');
    // ...so the parser, not the sanitizer, is what refuses it.
    expect(parseFileLinkHref(raw)).toBeNull();
  });
});

/**
 * Layer 2 of markdown containment, through the SHIPPED `'full'` pipeline
 * (TASK_2026_532, review-lane-b defects 1–6): `class` is an allowlist of the
 * tokens the pipeline itself emits, `style` rejects obfuscation and
 * positioning declarations, and the popover/invoker and `<dialog>`
 * affordances are gone. Layer 1 (the containment root) is asserted
 * structurally in the next block; its layout effect is a browser guarantee
 * jsdom cannot measure and was verified in a Chromium harness.
 */
describe("the 'full' preset containment root (TASK_2026_532)", () => {
  const rawFull = (html: string): string =>
    presetConfig('full').sanitize.useFactory()(html);

  it('wraps the sanitized output in exactly one outermost root', () => {
    const template = document.createElement('template');
    template.innerHTML = rawFull('<p>a</p><p>b</p>');
    expect(template.content.children).toHaveLength(1);
    const root = template.content.firstElementChild as HTMLElement;
    expect(root.className).toBe(MARKDOWN_CONTAINMENT_ROOT_CLASS);
    expect(root.getAttribute('style')).toBe(
      'contain: layout paint; isolation: isolate; overflow-x: auto;',
    );
    expect(root.children).toHaveLength(2);
  });

  it('keeps unbalanced closing tags in content from ending the root early', () => {
    const template = document.createElement('template');
    template.innerHTML = rawFull('x</div></div><div data-probe>y</div>');
    expect(template.content.children).toHaveLength(1);
    expect(template.content.querySelector('[data-probe]')?.parentElement).toBe(
      template.content.firstElementChild,
    );
  });

  it('does not let content forge a root of its own', () => {
    expect(
      fullSanitizer()(
        `<div class="${MARKDOWN_CONTAINMENT_ROOT_CLASS}">x</div>`,
      ),
    ).toBe('<div>x</div>');
  });
});

describe("the 'full' preset class and style policy (TASK_2026_532)", () => {
  let sanitize: (html: string) => string;

  beforeEach(() => {
    sanitize = fullSanitizer();
  });

  it('drops an overlay utility spelling entirely, keeping the element', () => {
    const out = sanitize('<div class="fixed inset-0 z-50 flex">x</div>');
    // By design `flex` goes too: the policy is an allowlist, and no utility
    // class is emitted by the pipeline.
    expect(out).not.toContain('class');
    expect(out).toBe('<div>x</div>');
  });

  it('drops a purely utility class attribute with no allowed token', () => {
    const out = sanitize('<p class="text-sm font-bold">x</p>');
    expect(out).toBe('<p>x</p>');
  });

  it('keeps only the allowed tokens of a mixed class attribute', () => {
    const out = sanitize(
      '<div class="callout callout-note fixed modal">x</div>',
    );
    expect(out).toBe('<div class="callout callout-note">x</div>');
  });

  it('removes a <style> element and its declarations, keeping surrounding markup', () => {
    // <style> injects global CSS into the whole webview — an escape the
    // attribute hook cannot reach, because the declarations are element
    // content. FORBID_TAGS drops the tag; `style` is in DOMPurify's default
    // FORBID_CONTENTS, so the declarations go with it.
    const out = sanitize(
      '<p>before</p><style>body{display:none}</style><p>after</p>',
    );
    expect(out).not.toContain('<style');
    expect(out).not.toContain('display:none');
    expect(out).toContain('<p>before</p>');
    expect(out).toContain('<p>after</p>');
  });

  it.each([
    'fixed',
    'inset-0',
    'z-50',
    'md:fixed',
    'hover:z-50',
    'dark:sticky',
    'z-[999]',
    'top-[0px]',
    '-top-4',
    '!fixed',
    'md:!z-50',
    '!-top-4',
    // Review defect 6: `fixed-width` shares only the prefix of `fixed`. The
    // allowlist drops it for the same reason as the utility itself — no
    // deny-list parsing is involved anymore.
    'fixed-width',
  ])(
    'drops the token %s from a class attribute, keeping an allowed neighbour',
    (utility) => {
      const out = sanitize(`<div class="${utility} callout">x</div>`);
      expect(out).toContain('callout');
      expect(out).not.toContain(utility);
    },
  );

  it('drops the app overlay pair modal modal-open entirely', () => {
    // Review defect 2: daisyUI ships unprefixed; its `.modal` is
    // fixed/inset-0/z-999, and `modal-open` alone drives the global
    // :root:has() rule that hides the root scrollbar.
    const out = sanitize('<div class="modal modal-open">x</div>');
    expect(out).not.toContain('modal');
    expect(out).toBe('<div>x</div>');
  });

  it('drops modal-open alone, the driver of the root :has() rule', () => {
    const out = sanitize('<p class="modal-open">innocent text</p>');
    expect(out).toBe('<p>innocent text</p>');
  });

  it('keeps the classes the marked extensions emit', () => {
    const out = sanitize(
      '<div class="callout callout-note"><div class="prose-list-card">' +
        '<code class="language-ts">x</code>' +
        '<a href="#" class="ptah-file-link">f</a></div></div>',
    );
    expect(out).toContain('callout callout-note');
    expect(out).toContain('prose-list-card');
    expect(out).toContain('class="language-ts"');
    expect(out).toContain('ptah-file-link');
  });

  it('drops a style attribute that declares positioning', () => {
    const out = sanitize('<div style="position:fixed;top:0">x</div>');
    expect(out).not.toContain('style');
    expect(out).toContain('<div>x</div>');
  });

  it('drops a style attribute in mixed casing with padded declarations', () => {
    const out = sanitize(
      '<div style="POSITION : fixed ; Z-INDEX : 50">x</div>',
    );
    expect(out).not.toContain('style');
  });

  it('keeps a style attribute with no positioning declaration', () => {
    const out = sanitize('<div style="color:red">x</div>');
    expect(out).toContain('style="color:red"');
  });

  // Review defect 1: comments and backslash escapes smuggle `position`
  // past any property-name check. All three spellings computed to
  // `position: fixed` in the reviewer's Chromium harness.
  const OBFUSCATED_POSITION_STYLES = [
    '/**/position:fixed;/**/inset:0;background:red',
    'position/**/:fixed;inset/**/:0;background:red',
    '\\70 osition:fixed;\\69 nset:0;background:red',
  ];

  it.each(OBFUSCATED_POSITION_STYLES)(
    'drops the obfuscated style %s on a div',
    (style) => {
      const out = sanitize(`<div style="${style}">x</div>`);
      expect(out).not.toContain('style');
      expect(out).toContain('<div>x</div>');
    },
  );

  it.each(OBFUSCATED_POSITION_STYLES)(
    'drops the obfuscated style %s on an svg',
    (style) => {
      const out = sanitize(
        `<svg style="${style}"><rect width="1" height="1" /></svg>`,
      );
      expect(out).not.toContain('style');
      expect(out).toContain('<svg');
    },
  );

  it('strips the popover attribute, whose UA stylesheet positions the element', () => {
    // Review defect 3: no `position` declaration anywhere — the browser
    // stylesheet supplies fixed geometry once display is overridden.
    const out = sanitize('<div popover style="display:block">x</div>');
    expect(out.toLowerCase()).not.toContain('popover');
    // display:block alone is inert and stays: the style policy only
    // rejects positioning and obfuscation.
    expect(out).toContain('display:block');
  });

  it('removes <dialog>, which carries UA out-of-flow geometry', () => {
    const out = sanitize('<p>a</p><dialog open>d</dialog><p>b</p>');
    expect(out).not.toContain('<dialog');
    expect(out).toContain('<p>a</p>');
    expect(out).toContain('<p>b</p>');
  });

  it('does not leak the hook onto the shared DOMPurify instance', () => {
    // The hook is instance-global. If it had been added to the default export,
    // every other DOMPurify user in the app would start losing classes. This
    // is the counterpart of the member preset's non-leak assertion.
    const viaDefault = DOMPurify.sanitize('<div class="fixed z-50">x</div>');
    expect(viaDefault).toContain('fixed');
    expect(viaDefault).toContain('z-50');
  });

  it('does not leak the hook onto the member preset', () => {
    __resetMemberPurifierForTests();
    const member = memberConfig().sanitize.useFactory()(
      '<p class="fixed z-50">x</p>',
    );
    // The member instance has no containment hook; its allowlist is the only
    // defence there, which is a separate contract from this task.
    expect(member).toContain('fixed');
    __resetMemberPurifierForTests();
  });
});

/**
 * The class allowlist is only safe if it keeps EVERY class the six marked
 * extensions actually render. Each test here invokes the extension's real
 * renderer through the shipped providers and sanitizes its output — the
 * rendered markup, not a hand-written copy of it.
 */
describe("the 'full' preset keeps every extension's rendered output", () => {
  let sanitize: (html: string) => string;

  beforeEach(() => {
    sanitize = fullSanitizer();
  });

  /** The single extension that registers a renderer method of this name. */
  const rendererFor = (
    name: string,
  ): ((this: unknown, token: unknown) => string | false) => {
    const found = (
      presetConfig('full').markedExtensions as Array<{
        useValue: MarkedExtension;
      }>
    )
      .map(
        (provider) =>
          (provider.useValue.renderer ?? {}) as unknown as Record<
            string,
            unknown
          >,
      )
      .map((renderer) => renderer[name])
      .find((candidate) => typeof candidate === 'function');
    if (!found) {
      throw new Error(`no extension registers a '${name}' renderer`);
    }
    return found as (this: unknown, token: unknown) => string | false;
  };

  it('keeps the callout card classes', () => {
    const raw = rendererFor('blockquote').call(
      { parser: { parse: () => '<p>Body</p>' } },
      { type: 'blockquote', calloutType: 'NOTE', tokens: [] },
    );
    expect(raw).not.toBe(false);
    const out = sanitize(raw as string);
    expect(out).toContain('callout callout-note');
    expect(out).toContain('callout-header');
    expect(out).toContain('callout-dot');
    expect(out).toContain('callout-title');
    expect(out).toContain('callout-body');
  });

  it('keeps the code-block header classes, including the collapsible path', () => {
    const longText = Array.from({ length: 16 }, () => 'line').join('\n');
    const raw = rendererFor('code').call(
      {},
      { type: 'code', raw: '', lang: 'ts', text: longText },
    );
    expect(raw).not.toBe(false);
    const out = sanitize(raw as string);
    expect(out).toContain('code-block-container');
    expect(out).toContain('code-block-header');
    expect(out).toContain('code-lang-badge');
    expect(out).toContain('code-line-count');
    expect(out).toContain('code-block-collapsible');
    expect(out).toContain('code-block-toggle');
    expect(out).toContain('language-ts');
  });

  it('keeps the decorative divider classes', () => {
    const out = sanitize(rendererFor('hr').call({}, {}) as string);
    expect(out).toContain('prose-divider');
    expect(out).toContain('prose-divider-ornament');
  });

  it('keeps the enhanced heading classes', () => {
    const parser = { parseInline: () => 'Title' };
    const h1 = rendererFor('heading').call(
      { parser },
      { depth: 1, tokens: [] },
    );
    const h3 = rendererFor('heading').call(
      { parser },
      { depth: 3, tokens: [] },
    );
    const out = sanitize(`${h1 as string}${h3 as string}`);
    expect(out).toContain('prose-heading-accented');
    expect(out).toContain('prose-heading-dot');
    expect(out).toContain('prose-heading-bordered');
  });

  it('keeps the list-card classes', () => {
    const raw = rendererFor('list').call(
      { parser: { parse: () => 'Item' } },
      { ordered: true, start: 1, items: [{ tokens: [] }] },
    );
    expect(raw).not.toBe(false);
    const out = sanitize(raw as string);
    expect(out).toContain('prose-list-card');
  });

  it('keeps the file-link class', () => {
    const raw = rendererFor('link').call(
      { parser: { parseInline: () => 'open' } },
      {
        type: 'link',
        raw: '',
        href: 'C:\\x.ts:12:3',
        title: null,
        text: 'open',
        tokens: [],
      },
    );
    expect(raw).not.toBe(false);
    const out = sanitize(raw as string);
    expect(out).toContain('ptah-file-link');
    expect(out).toContain('data-ptah-file-href');
  });
});
