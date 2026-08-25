/**
 * Guard for the pre-paint theme boot script in `src/index.html`.
 *
 * That script cannot import anything — it runs in `<head>` before any module
 * is evaluated — so it hard-codes three theme name lists. They MUST stay in
 * step with `DAISYUI_THEMES`, because they decide:
 *
 *   - EAGER    which themes are compiled into `styles.css` (never fetch the
 *              deferred sheet for these)
 *   - DEFERRED which themes live in `theme-extra.css` (block the first paint
 *              on the sheet for these)
 *   - DARK     the value written to `data-theme-mode` before Angular boots
 *
 * A theme added to `DAISYUI_THEMES` but missing from DEFERRED would silently
 * render with the wrong (anubis) variables for anyone who selects it. This
 * spec is the reason that cannot ship unnoticed.
 *
 * The EAGER list is also the contract with
 * `apps/ptah-extension-webview/tailwind.config.js`, which compiles exactly
 * those two themes into the initial bundle.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAISYUI_THEMES } from '@ptah-extension/core';

const INDEX_HTML = join(__dirname, '..', 'index.html');

function readList(html: string, name: string): readonly string[] {
  // Matches:  var EAGER =\n  'a b c';
  const match = new RegExp(`var ${name} =\\s*\\n?\\s*'([^']*)'`).exec(html);
  if (!match) {
    throw new Error(
      `Could not find "var ${name} = '...'" in index.html — the pre-paint ` +
        `theme boot script was restructured; update this spec with it.`,
    );
  }
  return match[1].split(' ').filter(Boolean);
}

describe('index.html pre-paint theme boot lists', () => {
  const html = readFileSync(INDEX_HTML, 'utf8');

  it('EAGER lists exactly the themes compiled into styles.css', () => {
    expect(readList(html, 'EAGER')).toEqual(['anubis', 'anubis-light']);
  });

  it('EAGER + DEFERRED together cover every theme in DAISYUI_THEMES', () => {
    const covered = [
      ...readList(html, 'EAGER'),
      ...readList(html, 'DEFERRED'),
    ].sort();
    const declared = DAISYUI_THEMES.map((t) => t.name as string).sort();

    expect(covered).toEqual(declared);
  });

  it('DEFERRED contains no theme that is bundled eagerly', () => {
    const eager = new Set(readList(html, 'EAGER'));
    const overlap = readList(html, 'DEFERRED').filter((t) => eager.has(t));

    expect(overlap).toEqual([]);
  });

  it('DARK matches the isDark classification in DAISYUI_THEMES', () => {
    const declared = DAISYUI_THEMES.filter((t) => t.isDark)
      .map((t) => t.name as string)
      .sort();

    expect([...readList(html, 'DARK')].sort()).toEqual(declared);
  });

  it('does not link the deferred sheet as a stylesheet or preload', () => {
    // The marker link must stay inert. `rel="stylesheet"` or `rel="preload"`
    // here would make every default-theme user fetch theme-extra.css, which
    // is the entire point of the split.
    const marker =
      /<link[^>]*id="ptah-theme-extra"[^>]*>/.exec(html)?.[0] ?? '';

    expect(marker).toContain('theme-extra.css');
    expect(marker).toContain('rel="ptah-deferred-stylesheet"');
    expect(html).not.toMatch(/rel="(stylesheet|preload)"[^>]*theme-extra\.css/);
    expect(html).not.toMatch(
      /theme-extra\.css"[^>]*rel="(stylesheet|preload)"/,
    );
  });
});
