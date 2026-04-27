import { test as baseTest, expect, type Page } from '@playwright/test';
import {
  installPostMessageBridge,
  type PostMessageBridge,
} from './postmessage-bridge';
import { installCspStub } from './csp-stub';
import { startFixtureServer, type FixtureServerHandle } from './fixture-server';

/**
 * Test-scoped fixtures provided by this harness. (Worker-scoped fixtures
 * — like `fixtureServer` — are declared via the second generic of
 * `test.extend` below and are not part of this interface.)
 */
export interface WebviewFixtures {
  /**
   * Page that has the postMessage bridge + CSP stub installed and has
   * already navigated to the fixture root. Specs should generally use
   * this instead of the raw `page` fixture.
   */
  webviewPage: Page;
  /**
   * The bridge instance bound to `webviewPage`. Use it to capture outbound
   * (webview -> ext) messages and inject inbound (ext -> webview) ones.
   */
  bridge: PostMessageBridge;
}

/**
 * Worker-scoped fixtures. The fixture HTTP server is booted once per
 * worker (not per test) for speed.
 */
export interface WebviewWorkerFixtures {
  fixtureServer: FixtureServerHandle;
}

/**
 * Playwright test object pre-extended with the harness fixtures. Spec
 * authors should import from `@ptah-extension/webview-e2e-harness`:
 *
 * ```ts
 * import { test, expect } from '@ptah-extension/webview-e2e-harness';
 *
 * test('chat send', async ({ webviewPage, bridge }) => {
 *   await webviewPage.getByRole('textbox').fill('hello');
 *   await webviewPage.getByRole('button', { name: 'Send' }).click();
 *   const sent = await bridge.waitForOutbound(m => m.type === 'chat:send');
 *   expect(sent.payload).toBeDefined();
 * });
 * ```
 */
export const test = baseTest.extend<WebviewFixtures, WebviewWorkerFixtures>({
  fixtureServer: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await startFixtureServer();
      try {
        await use(server);
      } finally {
        await server.close();
      }
    },
    { scope: 'worker' },
  ],

  webviewPage: async ({ page, fixtureServer }, use) => {
    await installCspStub(page);
    // Install the bridge BEFORE navigation so `addInitScript` runs in the
    // first document. We re-use the same install here and expose the
    // resulting handle via the `bridge` fixture below.
    await installPostMessageBridge(page);
    await page.goto(fixtureServer.url);
    await use(page);
  },

  bridge: async ({ webviewPage }, use) => {
    // `installPostMessageBridge` is idempotent at the init-script level
    // (the global is keyed by name and re-install is a no-op), so calling
    // it again to retrieve the handle is safe.
    const handle = await installPostMessageBridge(webviewPage);
    await use(handle);
  },
});

export { expect };
