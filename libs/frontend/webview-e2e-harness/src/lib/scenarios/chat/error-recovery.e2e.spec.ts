/**
 * P3.B2 — Chat flow E2E specs: error & recovery banners.
 *
 * Validates UX surfaces for two failure paths:
 *   1. Provider error mid-stream    -> error banner + Retry button posts `chat:retry`.
 *   2. Network drop / reconnect    -> connectivity banner toggles via
 *      `connection:status` events.
 */
import { test, expect } from '../../test-fixtures';

async function mountErrorSurface(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.evaluate(() => {
    const root = document.getElementById('ptah-e2e-fixture-root');
    if (!root) {
      throw new Error('fixture root missing');
    }
    root.innerHTML = `
      <div data-testid="connection-banner" hidden role="status"></div>
      <div data-testid="error-banner" hidden role="alert">
        <span data-testid="error-message"></span>
        <button data-testid="retry-button">Retry</button>
      </div>
      <div data-testid="last-request-id"></div>
    `;
    const vscode = (
      window as unknown as {
        acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
      }
    ).acquireVsCodeApi();

    const errorBanner = root.querySelector<HTMLDivElement>(
      '[data-testid="error-banner"]',
    )!;
    const errorMessage = root.querySelector<HTMLSpanElement>(
      '[data-testid="error-message"]',
    )!;
    const retryButton = root.querySelector<HTMLButtonElement>(
      '[data-testid="retry-button"]',
    )!;
    const connBanner = root.querySelector<HTMLDivElement>(
      '[data-testid="connection-banner"]',
    )!;
    const lastReqId = root.querySelector<HTMLDivElement>(
      '[data-testid="last-request-id"]',
    )!;

    let pendingRequestId: string | null = null;

    retryButton.addEventListener('click', () => {
      const id = pendingRequestId ?? `retry-${Date.now()}`;
      vscode.postMessage({
        type: 'chat:retry',
        id,
        payload: { previousId: pendingRequestId },
      });
      errorBanner.hidden = true;
    });

    window.addEventListener('message', (ev) => {
      const data = ev.data as {
        type?: string;
        id?: string;
        payload?: { message?: string; status?: 'online' | 'offline' };
      };
      if (!data?.type) {
        return;
      }
      if (data.type === 'chat:error') {
        errorBanner.hidden = false;
        errorMessage.textContent = data.payload?.message ?? 'Unknown error';
        pendingRequestId = data.id ?? null;
        if (data.id) {
          lastReqId.textContent = data.id;
        }
      } else if (data.type === 'connection:status') {
        if (data.payload?.status === 'offline') {
          connBanner.hidden = false;
          connBanner.textContent = 'Disconnected. Reconnecting…';
        } else if (data.payload?.status === 'online') {
          connBanner.textContent = 'Reconnected';
          // Auto-clear after marking it visible briefly.
          connBanner.dataset['state'] = 'reconnected';
        }
      }
    });
  });
}

test.describe('chat error & recovery', () => {
  test('shows an error banner with role=alert on chat:error', async ({
    webviewPage,
    bridge,
  }) => {
    await mountErrorSurface(webviewPage);
    await bridge.inject({
      type: 'chat:error',
      id: 'req-1',
      payload: { message: 'Provider rate-limited' },
    });
    const banner = webviewPage.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(webviewPage.getByTestId('error-message')).toHaveText(
      'Provider rate-limited',
    );
  });

  test('Retry button posts chat:retry referencing the failed request id', async ({
    webviewPage,
    bridge,
  }) => {
    await mountErrorSurface(webviewPage);
    await bridge.inject({
      type: 'chat:error',
      id: 'req-42',
      payload: { message: 'Provider error' },
    });
    await webviewPage.getByTestId('retry-button').click();
    const sent = await bridge.waitForOutbound((m) => m.type === 'chat:retry');
    expect(sent.payload).toMatchObject({ previousId: 'req-42' });
    await expect(webviewPage.getByTestId('error-banner')).toBeHidden();
  });

  test('connection banner appears on offline status and clears on online', async ({
    webviewPage,
    bridge,
  }) => {
    await mountErrorSurface(webviewPage);
    await bridge.inject({
      type: 'connection:status',
      payload: { status: 'offline' },
    });
    const banner = webviewPage.getByTestId('connection-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Disconnected');

    await bridge.inject({
      type: 'connection:status',
      payload: { status: 'online' },
    });
    await expect(banner).toContainText('Reconnected');
    await expect(banner).toHaveAttribute('data-state', 'reconnected');
  });

  test('multiple successive errors update the banner with the latest', async ({
    webviewPage,
    bridge,
  }) => {
    await mountErrorSurface(webviewPage);
    await bridge.inject({
      type: 'chat:error',
      id: 'req-a',
      payload: { message: 'First failure' },
    });
    await expect(webviewPage.getByTestId('error-message')).toHaveText(
      'First failure',
    );
    await bridge.inject({
      type: 'chat:error',
      id: 'req-b',
      payload: { message: 'Second failure' },
    });
    await expect(webviewPage.getByTestId('error-message')).toHaveText(
      'Second failure',
    );
    // Retrying should reference the most recent failure id.
    await webviewPage.getByTestId('retry-button').click();
    const sent = await bridge.waitForOutbound((m) => m.type === 'chat:retry');
    expect(sent.payload).toMatchObject({ previousId: 'req-b' });
  });
});
