/**
 * Chat flow E2E specs: streaming response render.
 *
 * Validates the inbound side of the bridge: the host streams `chat:chunk`
 * messages and a final `chat:done`, and the webview renders tokens as they
 * arrive while keeping the latest message in view. The test mounts a
 * minimal stream-receiver into the fixture page that listens to
 * `window.message` events with the documented protocol shape.
 */
import { test, expect } from '../../test-fixtures';

async function mountStreamReceiver(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.evaluate(() => {
    const root = document.getElementById('ptah-e2e-fixture-root');
    if (!root) {
      throw new Error('fixture root missing');
    }
    root.innerHTML = `
      <div data-testid="message-list" style="height: 120px; overflow-y: auto;">
        <div data-testid="assistant-message" data-state="idle"></div>
      </div>
      <div data-testid="stream-status">idle</div>
    `;
    const msg = root.querySelector<HTMLDivElement>(
      '[data-testid="assistant-message"]',
    )!;
    const list = root.querySelector<HTMLDivElement>(
      '[data-testid="message-list"]',
    )!;
    const status = root.querySelector<HTMLDivElement>(
      '[data-testid="stream-status"]',
    )!;

    window.addEventListener('message', (ev) => {
      const data = ev.data as { type?: string; payload?: { token?: string } };
      if (!data || typeof data.type !== 'string') {
        return;
      }
      if (
        data.type === 'chat:chunk' &&
        typeof data.payload?.token === 'string'
      ) {
        msg.textContent = (msg.textContent ?? '') + data.payload.token;
        msg.dataset['state'] = 'streaming';
        status.textContent = 'streaming';
        // Mimic auto-scroll-to-latest: pin scrollTop to bottom on each chunk.
        list.scrollTop = list.scrollHeight;
      } else if (data.type === 'chat:done') {
        msg.dataset['state'] = 'done';
        status.textContent = 'done';
      }
    });
  });
}

test.describe('chat streaming response', () => {
  test('renders tokens incrementally as chunks arrive', async ({
    webviewPage,
    bridge,
  }) => {
    await mountStreamReceiver(webviewPage);
    const msg = webviewPage.getByTestId('assistant-message');

    await bridge.inject({ type: 'chat:chunk', payload: { token: 'Hello' } });
    await expect(msg).toHaveText('Hello');

    await bridge.inject({ type: 'chat:chunk', payload: { token: ', ' } });
    await bridge.inject({ type: 'chat:chunk', payload: { token: 'world!' } });
    await expect(msg).toHaveText('Hello, world!');
  });

  test('marks the message done on chat:done', async ({
    webviewPage,
    bridge,
  }) => {
    await mountStreamReceiver(webviewPage);
    await bridge.inject({ type: 'chat:chunk', payload: { token: 'x' } });
    await bridge.inject({ type: 'chat:done' });
    await expect(webviewPage.getByTestId('assistant-message')).toHaveAttribute(
      'data-state',
      'done',
    );
    await expect(webviewPage.getByTestId('stream-status')).toHaveText('done');
  });

  test('keeps the message list scrolled to the latest token', async ({
    webviewPage,
    bridge,
  }) => {
    await mountStreamReceiver(webviewPage);
    // Push enough tokens to overflow the 120px viewport.
    for (let i = 0; i < 40; i++) {
      await bridge.inject({
        type: 'chat:chunk',
        payload: { token: `token-${i} ` },
      });
    }
    await bridge.inject({ type: 'chat:done' });
    const scroll = await webviewPage.evaluate(() => {
      const list = document.querySelector<HTMLDivElement>(
        '[data-testid="message-list"]',
      )!;
      return {
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        clientHeight: list.clientHeight,
      };
    });
    // scrollTop + clientHeight should equal scrollHeight when pinned to bottom.
    expect(scroll.scrollTop + scroll.clientHeight).toBeGreaterThanOrEqual(
      scroll.scrollHeight - 2,
    );
  });

  test('ignores malformed inbound messages without throwing', async ({
    webviewPage,
    bridge,
  }) => {
    await mountStreamReceiver(webviewPage);
    // Garbage payload — should not break the listener nor mutate state.
    await bridge.inject({ type: 'chat:chunk' });
    await bridge.inject({ type: 'unknown:event', payload: { token: 'no' } });
    await expect(webviewPage.getByTestId('assistant-message')).toHaveText('');
    await expect(webviewPage.getByTestId('stream-status')).toHaveText('idle');
  });
});
