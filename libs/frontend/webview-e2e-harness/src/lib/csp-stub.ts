import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';

/**
 * Web fonts served from the repository, never from the network (TASK_2026_555 Batch 51.5: two Gate G runs failed
 * when `fonts.gstatic.com` was unreachable).
 *
 * The production build inlines the Google Fonts CSS from `styles.css`, so the page requests only the 15 woff2 files
 * below. They are a byte copy of Google's files, at the same paths under `fonts/gstatic/`: Inter v20, Cinzel v26 and
 * JetBrains Mono v24, about 325 KB in total. All three families are under the SIL Open Font License 1.1
 * (`fonts/OFL-*.txt`), which allows redistribution with the licence.
 *
 * A gstatic file that is not in the copy is aborted, not fetched. When the app moves to a new font version, copy the
 * new files in (the URLs are in `dist/apps/ptah-extension-webview`).
 */
const FONT_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fonts', 'gstatic');
const FONT_HOST = 'https://fonts.gstatic.com/';

async function fulfillLocalFont(route: Route, url: string): Promise<void> {
  const file = normalize(join(FONT_ROOT, new URL(url).pathname));
  // The path comes from the request: never serve anything outside the font copy.
  if (!file.startsWith(FONT_ROOT + sep)) {
    await route.abort('blockedbyclient');
    return;
  }
  try {
    await route.fulfill({ status: 200, contentType: 'font/woff2', body: await readFile(file),
      headers: { 'access-control-allow-origin': '*' } });
  } catch (error: unknown) {
    // Not in the copy: an offline run must not depend on it, so it is aborted (the page falls back to a local font).
    console.warn(`[csp-stub] no local copy of ${url} (${error instanceof Error ? error.message : 'unreadable'})`);
    await route.abort('internetdisconnected');
  }
}

export interface CspStubOptions {
  /**
   * If true, strip `Content-Security-Policy` and
   * `Content-Security-Policy-Report-Only` headers from every response. Real
   * webview HTML ships with a strict CSP that breaks Playwright eval/inject
   * helpers; tests need a permissive surface.
   * @default true
   */
  readonly stripCspHeaders?: boolean;

  /**
   * Optional URL pattern (string or RegExp) limiting where the route handler
   * applies. Defaults to all requests.
   */
  readonly urlPattern?: string | RegExp;
}

/**
 * Install a permissive route handler that removes CSP headers from every
 * intercepted response. Call this BEFORE `page.goto(...)`. The webview's
 * production HTML carries a very strict CSP (`script-src 'nonce-…'`) which
 * prevents Playwright's `addInitScript` and `evaluate` from running; this
 * stub neutralizes it so the harness's bridge install can take effect.
 */
export async function installCspStub(
  page: Page,
  options: CspStubOptions = {},
): Promise<void> {
  const stripCsp = options.stripCspHeaders ?? true;
  const pattern: string | RegExp = options.urlPattern ?? '**/*';

  await page.route(pattern, async (route: Route) => {
    const url = route.request().url();
    if (url.startsWith(FONT_HOST)) {
      await fulfillLocalFont(route, url);
      return;
    }
    if (!stripCsp) {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['x-frame-options'];

    await route.fulfill({
      response,
      headers,
    });
  });
}
