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
 */
export interface MarkdownRenderingConfig {
  readonly extensions: 'full' | 'basic';
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
      // Block dangerous tags only — allow everything else
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
      // Block event handlers and dangerous attributes only
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
      // Allow data-* attributes (used by marked extensions)
      ALLOW_DATA_ATTR: true,
      // Allow ARIA attributes for accessibility
      ALLOW_ARIA_ATTR: true,
      // Allow safe URI protocols
      ALLOWED_URI_REGEXP:
        /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    });
}

/**
 * Returns the Angular providers that wire up ngx-markdown for the given
 * preset. Use `'full'` inside the webview app and `'basic'` inside the
 * landing page.
 */
export function provideMarkdownRendering(
  config: MarkdownRenderingConfig,
): Provider[] {
  if (config.extensions === 'basic') {
    return [provideMarkdown()];
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
