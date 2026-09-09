/**
 * E2E: the back-office activity ticker in the Electron shell
 * (TASK_2026_380, Task 5.1 — the second of the two cases Batch 4 deferred,
 * D-6 in `batch-4-report.md`).
 *
 * `BackOfficeActivityService`'s unit tests (component 14d) pin the mapper
 * and ring behaviour in isolation, and `ActivityTickerComponent`'s unit
 * tests (component 14e) pin the rotation/idle-collapse behaviour against
 * inputs it is handed directly. Neither proves the wiring in
 * `electron-shell.component.ts` — the service injected and
 * `<ptah-activity-ticker>` mounted in the floating toast — actually carries a
 * real `activity:event` push from the message router into the rendered
 * ticker line.
 *
 * Since TASK_2026_405 the ticker is NOT in the navbar: it renders inside the
 * fixed `[data-testid="activity-toast"]` card, and the whole toast is absent
 * from the DOM while the service reports idle. The assertions below therefore
 * check both the line text and that the navbar row holds no activity element.
 *
 * Uses the REAL `ptah-extension-webview` Angular bundle, following the
 * pattern (and the `isElectron: true` `ptahConfig` justification) in
 * `../thoth/skills-lane-pickers.e2e.spec.ts` — read its file doc comment
 * before changing that flag. This spec does not navigate into the Thoth
 * tab; the ticker lives in the shell header, mounted as soon as the
 * workspace gate clears, independent of which tab is active.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';

const RPC_FIXTURES: Record<string, unknown> = {
  // Clears `ElectronLayoutService.hasWorkspaceFolders()` so
  // `ElectronShellComponent` renders the 3-panel layout (and its header,
  // where the ticker lives) instead of the open-folder gate.
  'workspace:getInfo': {
    folders: ['C:\\ptah-e2e-ws'],
    activeFolder: 'C:\\ptah-e2e-ws',
  },
  'workspace:switch': { success: true },
};

/** Copied from the sibling thoth scenario — see its file doc comment. */
async function installRpcAutoResponder(
  page: Page,
  fixtures: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((serializedFixtures: string) => {
    const parsedFixtures = JSON.parse(serializedFixtures) as Record<
      string,
      unknown
    >;
    const w = window as unknown as {
      acquireVsCodeApi?: () => {
        postMessage: (msg: unknown) => void;
        getState: () => unknown;
        setState: (s: unknown) => void;
      };
      vscode?: unknown;
      ptahConfig?: unknown;
    };
    if (typeof w.acquireVsCodeApi !== 'function') {
      return;
    }
    const api = w.acquireVsCodeApi();
    const originalPostMessage = api.postMessage.bind(api);
    api.postMessage = (msg: unknown): void => {
      originalPostMessage(msg);
      const envelope = msg as {
        type?: string;
        payload?: {
          method?: string;
          params?: unknown;
          correlationId?: string;
        };
      };
      if (envelope?.type !== 'rpc:call' || !envelope.payload?.method) {
        return;
      }
      const { method, correlationId } = envelope.payload;
      if (!Object.prototype.hasOwnProperty.call(parsedFixtures, method)) {
        return;
      }
      const data = parsedFixtures[method];
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'rpc:response', correlationId, success: true, data },
          }),
        );
      });
    };
    w.vscode = api;
    w.ptahConfig = {
      isVSCode: false,
      isElectron: true,
      theme: 'dark',
      workspaceRoot: 'C:\\ptah-e2e-ws',
      workspaceName: 'ptah-e2e-ws',
      extensionUri: '',
      baseUri: '',
      iconUri: '',
      userIconUri: '',
      panelId: 'e2e-harness',
      platform: 'win32',
      initialView: 'chat',
    };
  }, JSON.stringify(fixtures));
}

/** Same worker-scoping rule as the sibling thoth scenario: file-scope opt-in. */
test.use({ useAppBuild: true });

test.describe('webview > thoth > activity ticker', () => {
  test('an activity:event push renders in the header ticker line', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    const bridge = await installPostMessageBridge(page);
    await installRpcAutoResponder(page, RPC_FIXTURES);
    await page.goto(fixtureServer.url);

    // Idle by default (empty ring) — the toast is not in the DOM at all, so
    // neither the card nor the line exists yet (TASK_2026_405).
    await expect(page.locator('[data-testid="activity-toast"]')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="activity-ticker-line"]'),
    ).toHaveCount(0);

    // The pass-through layer is always mounted and never takes clicks.
    const layer = page.locator('[data-testid="activity-toast-layer"]');
    await expect(layer).toHaveCount(1);
    await expect(layer).toHaveCSS('pointer-events', 'none');

    await bridge.inject({
      type: 'activity:event',
      payload: {
        source: 'cron',
        kind: 'backup:daily',
        summary: 'Backup finished',
        timestamp: Date.now(),
      },
    });

    const line = page.locator('[data-testid="activity-ticker-line"]');
    await expect(line).toBeVisible();
    await expect(line).toContainText('Backup finished');

    // The visible card opts back into pointer events, so it stays clickable.
    await expect(page.locator('[data-testid="activity-toast"]')).toHaveCSS(
      'pointer-events',
      'auto',
    );

    // AC 1: the ticker no longer lives inside the navbar row, so the tab
    // strip cannot be pushed by a long summary.
    await expect(
      page.locator('[role="tablist"] [data-testid="activity-ticker-line"]'),
    ).toHaveCount(0);
    const tabStrip = page.locator('[role="tablist"].electron-tabs');
    const beforeBox = await tabStrip.boundingBox();

    await bridge.inject({
      type: 'activity:event',
      payload: {
        source: 'cron',
        kind: 'backup:daily',
        summary:
          'A considerably longer activity summary that would previously have widened the navbar action cluster',
        timestamp: Date.now(),
      },
    });
    await expect(line).toContainText('considerably longer');

    const afterBox = await tabStrip.boundingBox();
    expect(afterBox?.x).toBe(beforeBox?.x);
    expect(afterBox?.width).toBe(beforeBox?.width);
  });
});
