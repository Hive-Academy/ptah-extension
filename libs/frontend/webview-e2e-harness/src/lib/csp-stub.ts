import type { Page, Route } from '@playwright/test';

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
