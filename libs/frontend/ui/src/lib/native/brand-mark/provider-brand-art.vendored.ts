/**
 * VENDORED by `scripts/vendor-brand-icons.mjs` from `scripts/brand-icons.manifest.json`.
 * Do not edit by hand: run `npm run vendor:brand-icons` and commit the result.
 *
 * Source: theSVG (https://github.com/glincker/thesvg) at commit
 * 20c10d8dd10bbce6de90101f50599d5686061cfa, pinned 2026-09-23.
 * https://github.com/glincker/thesvg/tree/20c10d8dd10bbce6de90101f50599d5686061cfa/public/icons
 *
 * SHIPPED NOTICES: production minification strips this comment, so the
 * licence and attribution notices users receive live in a plain-text file
 * generated beside this one: `libs/frontend/ui/src/lib/native/brand-mark/brand-icons-notices.txt`.
 * It is copied to the root of the VS Code package and to `resources/` of the
 * desktop app. Keep it in sync by regenerating, never by hand.
 *
 * Each SVG was normalised with svgo (preset-default, shapes to paths, styles to
 * attributes, transforms applied, precision 2) and reduced to path data. The
 * marks are TypeScript on purpose: the VS Code Marketplace scanner rejects AI
 * vendor names in non-JS files by path and by content, so no `.svg` file is
 * vendored anywhere.
 *
 * Trademark notice: every mark below is a trademark of its respective owner.
 * Ptah shows a mark only to identify the product or service it names (nominative
 * use). No endorsement by, or affiliation with, any owner is implied.
 *
 * The SVG code comes from theSVG under the following licence (verbatim):
 *
 *   MIT License
 *
 *   Copyright (c) 2025 thesvg.org
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 *
 * Per-icon licence as declared by theSVG's index (src/data/icons.json):
 *   anthropic: CC0-1.0
 *   claude: CC0-1.0
 */

import type { MarkArtwork } from './mark-artwork';

export const PROVIDER_ART_ANTHROPIC: MarkArtwork = {
  kind: 'fill',
  paths: [
    {
      d: 'M17.3 3.54h-3.67l6.7 16.92H24Zm-10.6 0L0 20.46h3.74l1.37-3.55h7l1.38 3.55h3.74l-6.7-16.92Zm-.38 10.22 2.3-5.94 2.29 5.94Z',
      fill: null,
    },
  ],
  viewBox: '0 0 24 24',
};

export const PROVIDER_ART_CLAUDE: MarkArtwork = {
  kind: 'fill',
  paths: [
    {
      d: 'm4.71 15.96 4.72-2.65.08-.23-.08-.13H9.2l-.79-.05-2.7-.07-2.33-.1-2.27-.12-.57-.12-.53-.7.05-.36.48-.32.69.06 1.52.1 2.27.16 1.66.1 2.44.25h.4l.05-.15-.14-.1-.1-.1-2.36-1.6-2.55-1.68-1.33-.97-.73-.5L2 6.22l-.16-1 .66-.73.88.06.22.06.9.69 1.9 1.48L8.9 8.6l.36.3.14-.1.02-.07-.16-.28L7.9 6.02l-1.44-2.5L5.8 2.5l-.17-.62c-.06-.26-.1-.47-.1-.73L6.29.13 6.7 0l1 .13.41.37.62 1.41 1 2.23 1.56 3.03.45.9.25.83.09.26h.16V9l.12-1.7.24-2.1.23-2.7.08-.76.38-.9.74-.5.59.28.48.69-.07.44-.29 1.85-.55 2.9-.37 1.95h.21l.25-.25.98-1.3 1.65-2.07.73-.81.85-.9.55-.44h1.03l.76 1.13-.34 1.16-1.06 1.35-.89 1.14-1.26 1.7-.79 1.36.08.11.18-.02 2.86-.6 1.54-.28 1.84-.32.83.4.1.39-.34.8-1.96.49-2.31.46-3.44.81-.04.03.05.07 1.55.14.66.04h1.62l3.02.22.79.52.47.64-.08.49-1.21.62-1.64-.4-3.83-.9-1.3-.33h-.19v.1l1.1 1.08 2 1.8 2.5 2.34.13.57-.32.46-.34-.05-2.2-1.66-.85-.74-1.93-1.62h-.13v.17l.45.65 2.34 3.52.12 1.08-.17.35-.6.21-.67-.12-1.38-1.92-1.41-2.17-1.14-1.94-.14.08-.68 7.25-.31.37-.73.28-.6-.46-.33-.75.32-1.47.4-1.93.3-1.53.3-1.9.16-.63v-.04l-.15.02-1.43 1.96-2.18 2.95-1.73 1.84-.4.17-.72-.37.06-.66.4-.6 2.39-3.03 1.44-1.88.93-1.09v-.16h-.06l-6.34 4.12-1.13.15-.49-.46.06-.75.23-.24 1.91-1.31Z',
      fill: null,
    },
  ],
  viewBox: '0 0 24 24',
};

/**
 * The `mono` (else `art`) artwork of the provider brands only. The eager
 * `ProviderMarkComponent` imports this module and never the brand table: a
 * separate module is what keeps `BRAND_MARKS` in the lazy chunk (R7; `ui` is
 * `sideEffects: false`).
 */
export const PROVIDER_BRAND_ART: Readonly<Record<string, MarkArtwork>> = {
  anthropic: PROVIDER_ART_ANTHROPIC,
  claude: PROVIDER_ART_CLAUDE,
};
