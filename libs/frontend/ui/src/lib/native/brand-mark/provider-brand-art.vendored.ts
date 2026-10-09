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
 *   cursor, github-copilot, ollama, google-gemini, opencode: CC0-1.0
 *
 * The additional provider-only marks below are reduced from the corresponding
 * Simple Icons SVG paths (https://github.com/simple-icons/simple-icons/tree/develop/icons,
 * CC0-1.0). They deliberately live in this provider subset so every provider
 * surface uses the same safe, attribute-bound renderer rather than parsed SVG.
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

const PROVIDER_ART_OPENAI: MarkArtwork = {
  kind: 'fill',
  viewBox: '0 0 24 24',
  paths: [
    {
      fill: null,
      d: 'M12.1 0a5.9 5.9 0 0 0-5.04 2.83A5.92 5.92 0 0 0 1.92 11.7a5.9 5.9 0 0 0 2.47 9.6 5.91 5.91 0 0 0 9.35.9 5.9 5.9 0 0 0 9.12-4.87 5.9 5.9 0 0 0-.13-10.55A5.9 5.9 0 0 0 12.1 0Zm0 2.1c1.28 0 2.48.6 3.23 1.62l-3.58 2.07a3.82 3.82 0 0 0-3.83 0L7.06 3.7A3.82 3.82 0 0 1 12.1 2.1Zm-5.8 3.35 3.58 2.07a3.8 3.8 0 0 0 0 4.42L6.3 14a3.82 3.82 0 0 1 0-8.55Zm11.4 0a3.82 3.82 0 0 1 .02 8.55l-3.6-2.07a3.8 3.8 0 0 0 0-4.42l3.59-2.06ZM12 7.7a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Zm-5.8 8.36 3.59-2.08a3.82 3.82 0 0 0 3.83 0l.86 2.1a3.82 3.82 0 0 1-8.28-.02Zm11.6 0a3.82 3.82 0 0 1-8.28.02l.86-2.1a3.82 3.82 0 0 0 3.83 0l3.59 2.08Z',
    },
  ],
};

const PROVIDER_ARTS: Readonly<Record<string, MarkArtwork>> = {
  openai: PROVIDER_ART_OPENAI,
  cursor: {
    kind: 'fill',
    viewBox: '0 0 24 24',
    paths: [
      {
        fill: null,
        d: 'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23',
      },
    ],
  },
  'github-copilot': {
    kind: 'fill',
    viewBox: '0 0 24 24',
    paths: [
      {
        fill: null,
        d: 'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656v2.869a.641.641 0 0 1-.078.256ZM12 11.005h-.344c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492Z',
      },
    ],
  },
  'google-gemini': {
    kind: 'fill',
    viewBox: '0 0 24 24',
    paths: [
      {
        fill: null,
        d: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
      },
    ],
  },
  opencode: {
    kind: 'fill',
    viewBox: '0 0 24 24',
    paths: [{ fill: null, d: 'M22 24H2V0h20zM17 4.8H7v14.4h10z' }],
  },
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
  ...PROVIDER_ARTS,
};
