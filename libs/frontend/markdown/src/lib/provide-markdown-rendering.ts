import type { Provider } from '@angular/core';
import { provideMarkdown, MARKED_EXTENSIONS, SANITIZE } from 'ngx-markdown';
import DOMPurify from 'dompurify';
import type { UponSanitizeAttributeHook } from 'dompurify';
import { getMarkedExtensions } from './marked-extensions';
import { MARKDOWN_FILE_LINKS_OPT_IN_ATTR } from './markdown-file-links';

/**
 * Configuration for the markdown rendering pipeline.
 *
 * - `'full'`: webview app preset — six marked extensions (callouts, code-block
 *   headers, decorative dividers, enhanced headings, list cards, file links)
 *   plus a permissive DOMPurify sanitizer that blocks XSS vectors and
 *   layout escapes (allowed classes only, no positioning styles, no
 *   `<style>`/`<dialog>`, no popover attributes).
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
 * The only `class` tokens that may survive the `'full'` preset: the ones
 * this pipeline itself emits (`marked-extensions.ts`) plus marked's
 * fence-language class. An agent-authored class attribute can activate any
 * rule in the app stylesheet — daisyUI is unprefixed, so `modal modal-open`
 * produces a fixed full-viewport overlay and the `:root:has(.modal-open)`
 * rule hides the root's scrollbar — and no token deny-list can enumerate
 * every spelling (TASK_2026_532, review defects 2 and 6). The policy is an
 * allowlist: a token the pipeline did not emit is dropped, whatever it
 * spells. Tailwind utilities on agent HTML (`flex`, `text-sm`) go with it.
 */
const ALLOWED_CLASS_EXACT = new Set([
  'callout',
  'code-lang-badge',
  'code-line-count',
  'prose-divider',
  'prose-list-card',
  'ptah-file-link',
]);

/**
 * The prefix families the extensions emit: `callout-note`, `callout-header`,
 * `code-block-container`, `prose-divider-ornament`, `prose-heading-accented`,
 * `language-ts` and friends.
 */
const ALLOWED_CLASS_PREFIXES = [
  'callout-',
  'code-block-',
  'prose-divider-',
  'prose-heading-',
  'language-',
] as const;

function isAllowedClassToken(token: string): boolean {
  return (
    ALLOWED_CLASS_EXACT.has(token) ||
    ALLOWED_CLASS_PREFIXES.some((prefix) => token.startsWith(prefix))
  );
}

/**
 * CSS properties that move an element out of normal flow or place it against
 * the viewport. `transform`, `translate` and negative `margin` are
 * deliberately absent: layer 1 ({@link wrapInContainmentRoot}) clips their
 * geometry, and
 * enumerating every positioning property is a race a deny-list cannot win
 * (review defect 4).
 */
const POSITION_STYLE_PROPERTIES = new Set([
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
]);

/**
 * A `style` value is rejected wholesale when it contains a CSS comment or a
 * backslash escape. Both can smuggle `position` past the property-name check
 * below — a comment spliced before or inside the property name, and a
 * hex-escaped first letter, compute to the same declaration a browser reads —
 * and DOMPurify hands this hook raw attribute text, not a parsed stylesheet
 * (review defect 1). Serialized declarations only, or nothing.
 */
function isObfuscatedStyle(value: string): boolean {
  return value.includes('/*') || value.includes('\\');
}

/**
 * Judges a `style` attribute by its declared property names, case-insensitive
 * and whitespace-tolerant. Runs only after {@link isObfuscatedStyle} has
 * passed; the whole attribute is dropped, not the single declaration, because
 * the hook API is per-attribute and partially rewritten CSS is a parser trap
 * (comments, `url()` strings) this pipeline has no reason to own.
 */
function declaresPositioningStyle(value: string): boolean {
  for (const declaration of value.split(';')) {
    const property = declaration.split(':', 1)[0]?.trim().toLowerCase();
    if (property !== undefined && POSITION_STYLE_PROPERTIES.has(property)) {
      return true;
    }
  }
  return false;
}

/**
 * `uponSanitizeAttribute` for the `'full'` preset. DOMPurify honours both a
 * mutated `attrValue` and `keepAttr = false` after this hook runs, which is
 * what makes token-level `class` filtering possible. Every other attribute
 * passes through untouched.
 *
 * - `class` — allowlist ({@link isAllowedClassToken}); when no token
 *   survives, the attribute is dropped, never left empty.
 * - `style` — dropped when it is obfuscated ({@link isObfuscatedStyle}) or
 *   declares a positioning property
 *   ({@link declaresPositioningStyle}).
 */
const enforceClassStylePolicy: UponSanitizeAttributeHook = (
  _currentNode,
  hookEvent,
) => {
  if (hookEvent.attrName === 'class') {
    const kept = hookEvent.attrValue
      .split(/\s+/)
      .filter((token) => token.length > 0 && isAllowedClassToken(token));
    if (kept.length === 0) {
      hookEvent.keepAttr = false;
      return;
    }
    hookEvent.attrValue = kept.join(' ');
    return;
  }
  if (
    hookEvent.attrName === 'style' &&
    (isObfuscatedStyle(hookEvent.attrValue) ||
      declaresPositioningStyle(hookEvent.attrValue))
  ) {
    hookEvent.keepAttr = false;
  }
};

/**
 * A DOMPurify instance private to this preset.
 *
 * ⚠️ NOT the shared default instance, for the same reason as the member
 * instance below: `addHook` is instance-global, so registering
 * {@link enforceClassStylePolicy} on the default export would strip classes
 * and styles from every DOMPurify user in the app, not just the markdown
 * pipeline. Calling the default export as a factory (`DOMPurify()`) returns
 * a fresh instance bound to the same window.
 *
 * Built lazily on first sanitize rather than at module load so importing this
 * file never requires a DOM.
 */
let fullPurifier: ReturnType<typeof DOMPurify> | null = null;

function getFullPurifier(): ReturnType<typeof DOMPurify> {
  if (fullPurifier) return fullPurifier;
  const instance = DOMPurify();
  instance.addHook('uponSanitizeAttribute', enforceClassStylePolicy);
  fullPurifier = instance;
  return instance;
}

/**
 * Permissive DOMPurify sanitizer for AI-generated markdown content.
 *
 * Blocks actual XSS vectors (script injection, event handlers, javascript:
 * URIs) while preserving the legitimate HTML that AI agents commonly produce:
 * - Code blocks, tables, lists, headings, links, images
 * - SVG diagrams, details/summary, kbd, abbr, mark, data-* attributes, id
 * - class and style as a SAFE SUBSET, not as authored:
 *   - `class` is an allowlist of the tokens this pipeline itself emits
 *     (callout cards, code headers, prose ornaments, `ptah-file-link`,
 *     `language-*`); an agent-authored class can otherwise activate any
 *     rule in the app stylesheet — including daisyUI's `.modal` and the
 *     global `:root:has(.modal-open)` scrollbar rule — whatever spelling a
 *     deny-list tried to enumerate (TASK_2026_532).
 *   - `style` is dropped when it is obfuscated (CSS comment or backslash
 *     escape) or declares a positioning property (`position`, `inset`, the
 *     edge offsets, `z-index`).
 * - Custom elements from marked extensions (callout cards, code headers, etc.)
 *
 * Layer 2 of the containment design. Layer 1 is
 * {@link wrapInContainmentRoot}, which contains any escape that still slips
 * past a text-level policy.
 */
function createPermissiveSanitizer(): (html: string) => string {
  return (html: string) => wrapInContainmentRoot(sanitizeFull(html));
}

/**
 * Class of the element every `'full'` render is wrapped in. Not in
 * {@link ALLOWED_CLASS_EXACT}, so content cannot forge a root of its own.
 */
export const MARKDOWN_CONTAINMENT_ROOT_CLASS = 'ptah-markdown-root';

/**
 * Layer 1 of the containment design: the sanitized HTML is wrapped AFTER
 * DOMPurify runs, so the wrapper is outside anything content controls.
 * `contain: layout paint` makes it the containing block for fixed/absolute
 * descendants and clips them to its box, however their CSS was spelled or
 * wherever the browser stylesheet placed them; `isolation: isolate` caps
 * descendant z-index; `overflow-x: auto` scrolls content that cannot wrap
 * (many-column tables, fixed-width SVG) instead of clipping it out of reach.
 *
 * Inline style rather than a stylesheet rule so the library owns its own
 * boundary: it holds in any app that installs the preset, and content cannot
 * override it — `<style>` is forbidden and no class can reach this element.
 */
function wrapInContainmentRoot(html: string): string {
  return `<div class="${MARKDOWN_CONTAINMENT_ROOT_CLASS}" style="contain: layout paint; isolation: isolate; overflow-x: auto;">${html}</div>`;
}

function sanitizeFull(html: string): string {
  return getFullPurifier().sanitize(html, {
    FORBID_TAGS: [
      'script',
      // <style> survives DOMPurify's default allowlist and injects global
      // CSS into the whole webview — a bigger layout escape than any class
      // token, and one the attribute hook cannot reach because the
      // declarations are element content, not an attribute (TASK_2026_532).
      // `link`, `meta` and `base` are already outside the default
      // allowlist, so `style` is the only one to name. Its content is
      // dropped with it: `style` is in DOMPurify's default FORBID_CONTENTS.
      'style',
      // <dialog> carries UA-supplied out-of-flow geometry (review defect 3)
      // and nothing in this content contract needs it; details/summary
      // remain the sanctioned collapse pattern.
      'dialog',
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
      // The popover/invoker family positions an element through the
      // browser stylesheet, with no `position` declaration anywhere for
      // the style policy to see (review defect 3).
      'popover',
      'popovertarget',
      'popovertargetaction',
      'command',
      'commandfor',
      // The file-link opt-in marker belongs to the surface around the
      // rendered markdown, never to content. FORBID_ATTR wins over
      // ALLOW_DATA_ATTR, so agent HTML cannot carry it.
      MARKDOWN_FILE_LINKS_OPT_IN_ATTR,
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
