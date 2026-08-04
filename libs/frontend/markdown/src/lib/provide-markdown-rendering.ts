import type { Provider } from '@angular/core';
import { provideMarkdown, MARKED_EXTENSIONS, SANITIZE } from 'ngx-markdown';
import DOMPurify from 'dompurify';
import { getMarkedExtensions } from './marked-extensions';

/**
 * Configuration for the markdown rendering pipeline.
 *
 * - `'full'`: webview app preset — five marked extensions (callouts, code-block
 *   headers, decorative dividers, enhanced headings, list cards) plus a
 *   permissive DOMPurify sanitizer that blocks only real XSS vectors.
 * - `'basic'`: landing-page preset — bare ngx-markdown with no extensions and
 *   no sanitizer override.
 * - `'member'`: Ptah Builders member panel preset — an ALLOWLIST DOMPurify
 *   sanitizer for member-authored user-generated content, plus a link-policy
 *   hook. No marked extensions: those decorate AI output, not forum posts.
 *
 * ⚠️ `'basic'` IS NOT SAFE FOR USER-GENERATED CONTENT. It installs no
 * `SANITIZE` override at all, so ngx-markdown falls through to its
 * `DEFAULT_SECURITY_CONTEXT` — Angular's `DomSanitizer`, not DOMPurify. Never
 * reach for it because "member content is simpler than AI content".
 */
export interface MarkdownRenderingConfig {
  readonly extensions: 'full' | 'basic' | 'member';
}

/**
 * Permissive DOMPurify sanitizer for AI-generated markdown content.
 *
 * Blocks only actual XSS vectors (script injection, event handlers, javascript: URIs)
 * while preserving all legitimate HTML that AI agents commonly produce:
 * - Code blocks, tables, lists, headings, links, images
 * - SVG diagrams, details/summary, kbd, abbr, mark
 * - data-* attributes, class, id, style (safe subset)
 * - Custom elements from marked extensions (callout cards, code headers, etc.)
 */
function createPermissiveSanitizer(): (html: string) => string {
  return (html: string) =>
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
}

/* -------------------------------------------------------------------------- */
/* The 'member' preset — allowlist, not deny-list                             */
/* -------------------------------------------------------------------------- */

/**
 * Tags a member may produce through the markdown composer, plus the ones
 * `marked` emits for them.
 *
 * ⚠️ THIS IS AN ALLOWLIST AND MUST STAY ONE. The `'full'` preset above is a
 * DENY-list tuned for AI output — it deliberately permits SVG, `<details>`,
 * `style` attributes and the custom elements the marked extensions emit,
 * because mangling an agent's diagram is a real cost and the agent is not an
 * attacker. A forum post is authored by another member over the network; there
 * the default must be "reject unless named". Anything absent from these two
 * lists is removed, which is the correct failure direction for UGC.
 */
const MEMBER_ALLOWED_TAGS = [
  // Block
  'p',
  'br',
  'hr',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  // Inline
  'a',
  'code',
  'em',
  'strong',
  'del',
  's',
  'sup',
  'sub',
  'kbd',
  'mark',
  'span',
  'img',
] as const;

/**
 * `class` is here because `marked` puts the fence language on the code element
 * (`<code class="language-ts">`) and the highlighter needs it. `style`, `id`
 * and `data-*` are deliberately absent: a member has no reason to position or
 * repaint anything inside a post, and `id` collisions would let one post break
 * another surface's anchors.
 */
const MEMBER_ALLOWED_ATTR = [
  'href',
  'title',
  'src',
  'alt',
  'class',
  'lang',
  'dir',
  'start',
  'colspan',
  'rowspan',
  'align',
] as const;

/**
 * `https?` and `mailto` only, plus relative URLs (the `[^a-z]` / no-colon
 * alternatives). `tel:` and `data:` are dropped from the permissive preset's
 * list. The trailing `/i` is load-bearing: without it `JAVASCRIPT:` (any
 * casing) slips through.
 */
const MEMBER_ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/**
 * Post-sanitize link policy for member content. Two jobs.
 *
 * **1. Close the `data:` hole `ALLOWED_URI_REGEXP` cannot close.** DOMPurify
 * accepts a `src`/`href` if it matches `ALLOWED_URI_REGEXP` *or* if the tag is
 * in its built-in `DATA_URI_TAGS` set, which contains `img`, `audio`, `video`,
 * `source` and `track`. So `<img src="data:text/html;base64,...">` survives a
 * regexp that never mentions `data:` — verified, not assumed: the first version
 * of this preset relied on the regexp alone and the spec caught the image
 * through. No config flag removes a tag from `DATA_URI_TAGS`, so the attribute
 * is dropped here instead.
 *
 * **2. Force every surviving anchor to open safely.** `noopener` cuts the
 * `window.opener` back-reference (reverse tabnabbing), `noreferrer` withholds
 * the member's current URL from the destination, and `nofollow` stops the forum
 * passing ranking signal to whatever a member links to. Applied here rather
 * than trusting author-supplied `rel`, because `rel` is absent from
 * {@link MEMBER_ALLOWED_ATTR} — an author cannot set it, and cannot weaken it.
 */
function enforceMemberLinkPolicy(node: Element): void {
  for (const attribute of ['src', 'href']) {
    const value = node.getAttribute(attribute);
    if (value !== null && stripsToDataUri(value)) {
      node.removeAttribute(attribute);
    }
  }

  if (node.tagName !== 'A') return;
  node.setAttribute('rel', 'noopener noreferrer nofollow');
  node.setAttribute('target', '_blank');
}

/**
 * `data:` detection after removing every character a browser ignores inside a
 * URI scheme — a tab or newline spliced into `data:` resolves identically in a
 * browser and must here too. Written as a character-code filter rather than a
 * regexp because matching the C0 control range in a literal is exactly what
 * `no-control-regex` exists to flag.
 */
function stripsToDataUri(value: string): boolean {
  let normalized = '';
  for (const character of value) {
    if (character.charCodeAt(0) > 0x20) normalized += character;
  }
  return normalized.slice(0, 5).toLowerCase() === 'data:';
}

/**
 * A DOMPurify instance private to this preset.
 *
 * ⚠️ NOT the shared default instance. `addHook` is instance-global, so
 * registering {@link enforceMemberLinkPolicy} on the default export would
 * silently rewrite every anchor the `'full'` webview preset renders too.
 * Calling the default export as a factory (`DOMPurify()`) returns a fresh
 * instance bound to the same window, which is the only way to scope a hook to
 * one preset.
 *
 * Built lazily on first sanitize rather than at module load so importing this
 * file never requires a DOM.
 */
let memberPurifier: ReturnType<typeof DOMPurify> | null = null;

function getMemberPurifier(): ReturnType<typeof DOMPurify> {
  if (memberPurifier) return memberPurifier;
  const instance = DOMPurify();
  instance.addHook('afterSanitizeAttributes', enforceMemberLinkPolicy);
  memberPurifier = instance;
  return instance;
}

/**
 * Allowlist DOMPurify sanitizer for member-authored markdown (forum posts,
 * lesson comments, session-request notes).
 */
function createMemberSanitizer(): (html: string) => string {
  return (html: string) =>
    getMemberPurifier().sanitize(html, {
      ALLOWED_TAGS: [...MEMBER_ALLOWED_TAGS],
      ALLOWED_ATTR: [...MEMBER_ALLOWED_ATTR],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: true,
      ALLOWED_URI_REGEXP: MEMBER_ALLOWED_URI_REGEXP,
    });
}

/**
 * Test seam: drops the memoised member instance so a spec can build a fresh
 * one. Not part of the runtime contract.
 *
 * @internal
 */
export function __resetMemberPurifierForTests(): void {
  memberPurifier = null;
}

/**
 * Returns the Angular providers that wire up ngx-markdown for the given
 * preset. Use `'full'` inside the webview app, `'basic'` for the landing
 * page's marketing surfaces, and `'member'` for the `/members` subtree.
 *
 * The `'member'` providers are installed on the `/members` ROUTE, not in
 * `app.config.ts`: `provideMarkdown()` returns plain providers (its
 * `MarkdownService` is a bare class provider, not `providedIn: 'root'`), so a
 * route-level injector shadows the app's `'basic'` pair for that subtree only,
 * with no cross-contamination and no app-config change.
 */
export function provideMarkdownRendering(
  config: MarkdownRenderingConfig,
): Provider[] {
  if (config.extensions === 'basic') {
    return [provideMarkdown()];
  }
  if (config.extensions === 'member') {
    return [
      provideMarkdown({
        sanitize: { provide: SANITIZE, useFactory: createMemberSanitizer },
      }),
    ];
  }
  return [
    provideMarkdown({
      sanitize: { provide: SANITIZE, useFactory: createPermissiveSanitizer },
      markedExtensions: getMarkedExtensions().map((ext) => ({
        provide: MARKED_EXTENSIONS,
        useValue: ext,
        multi: true,
      })),
    }),
  ];
}
