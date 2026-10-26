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
 * those four themes into the initial bundle.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAISYUI_THEMES } from '@ptah-extension/core';

const INDEX_HTML = join(__dirname, '..', 'index.html');
const SERVICE_SOURCE = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'libs', 'frontend', 'core', 'src', 'lib', 'services', 'theme.service.ts'),
  'utf8',
);

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
    expect(readList(html, 'EAGER')).toEqual(['anubis', 'anubis-light', 'ptah-glass', 'ptah-glass-light']);
  });

  it('EAGER matches EAGER_THEMES in theme.service.ts', () => {
    // EAGER_THEMES is module-private, so it is read from source the same way
    // the ACCENTS check below reads its list.
    const declared =
      /const EAGER_THEMES: ReadonlySet<string> = new Set\(\[([^\]]+)\]\)/
        .exec(SERVICE_SOURCE)?.[1]
        .match(/'([^']+)'/g)
        ?.map((name) => name.slice(1, -1)) ?? [];

    expect(declared.length).toBeGreaterThan(0);
    expect([...readList(html, 'EAGER')].sort()).toEqual([...declared].sort());
  });

  it('every other theme-name literal in the script is a declared, eager theme of the right lightness', () => {
    // The glass-migration targets are spelled inline in the script, and the
    // <html> default is spelled in markup. Both must be themes styles.css
    // carries (no sheet fetch on the migration path), and the migration
    // targets must sit on the side of DARK their names claim.
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    const eager = new Set(readList(html, 'EAGER'));
    const dark = new Set(readList(html, 'DARK'));
    const darkTarget = /\? '([^']+)'\s*:\s*'([^']+)'\s*: null/.exec(script);

    expect(darkTarget?.slice(1, 3)).toEqual(['ptah-glass', 'ptah-glass-light']);
    expect(dark.has('ptah-glass')).toBe(true);
    expect(dark.has('ptah-glass-light')).toBe(false);
    for (const name of ['ptah-glass', 'ptah-glass-light']) {
      expect(eager.has(name)).toBe(true);
    }

    const htmlDefault = /<html[^>]*data-theme="([^"]+)"/.exec(html)?.[1];
    const serviceDefault =
      /_currentTheme = signal<ThemeName>\('([^']+)'\)/.exec(SERVICE_SOURCE)?.[1];
    expect(htmlDefault).toBeDefined();
    expect(htmlDefault).toBe(serviceDefault);
    expect(eager.has(htmlDefault ?? '')).toBe(true);
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

  it('GLASS matches the opt-in theme metadata', () => {
    expect([...readList(html, 'GLASS')].sort()).toEqual(
      DAISYUI_THEMES.filter((theme) => theme.glass).map((theme) => theme.name).sort(),
    );
  });

  it('pre-paint accepts exactly the declared accents', () => {
    // Gold IS in the list on purpose (stored-gold fix): a stored 'gold' must
    // be recognised as valid so a stale non-default localStorage mirror
    // cannot override it. The script still applies data-accent only for the
    // non-default accents; gold IS the default.
    const source = readFileSync(join(__dirname, '..', '..', '..', '..', 'libs', 'frontend', 'core', 'src', 'lib', 'services', 'theme.service.ts'), 'utf8');
    const declared = /export const ACCENTS:[^=]+ = \[([^\]]+)\]/.exec(source)?.[1].match(/'([^']+)'/g)?.map((name) => name.slice(1, -1)) ?? [];
    expect(readList(html, 'ACCENT')).toEqual(declared);
  });

  it('pre-paint accepts exactly the declared scenes, including the default', () => {
    const declared = /export const SCENES:[^=]+ = \[([^\]]+)\]/.exec(SERVICE_SOURCE)?.[1].match(/'([^']+)'/g)?.map((name) => name.slice(1, -1)) ?? [];
    expect(declared).toEqual(['aurora', 'ember', 'tide', 'horizon']);
    expect(readList(html, 'SCENE')).toEqual(declared);
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
