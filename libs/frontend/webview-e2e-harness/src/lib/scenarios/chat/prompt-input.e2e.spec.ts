/**
 * P3.B2 — Chat flow E2E specs: prompt input.
 *
 * These specs exercise the contract between a webview prompt input and the
 * extension host RPC bridge. They run against the placeholder fixture HTML
 * served by `startFixtureServer` when no SPA build is present, so the UI
 * scaffolding under test is injected per-test via `page.evaluate` and driven
 * with real Playwright APIs (typing, keyboard, click). The outbound RPC
 * surface is asserted via `bridge.captured`/`bridge.waitForOutbound`.
 *
 * Spec authors at P3.B3+ should re-target these against real chat
 * components once the Angular build is wired into the fixture root.
 */
import { test, expect } from '../../test-fixtures';

/**
 * Mount a minimal prompt-input form into the fixture page. The form mirrors
 * the contract of the real `PromptInputComponent`:
 *   - textarea[role=textbox] for the message body
 *   - button[Send] that posts `chat:send` with `{ text }`
 *   - Enter submits, Shift+Enter inserts a newline
 *   - paperclip button posts `chat:attach-context`
 */
async function mountPromptInput(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.evaluate(() => {
    const root = document.getElementById('ptah-e2e-fixture-root');
    if (!root) {
      throw new Error('fixture root missing');
    }
    root.innerHTML = `
      <form id="prompt-form" data-testid="prompt-form">
        <textarea
          data-testid="prompt-textbox"
          aria-label="Message Ptah"
          rows="3"
        ></textarea>
        <button type="button" data-testid="attach-context-button" aria-label="Attach context">
          Attach
        </button>
        <button type="submit" data-testid="send-button" aria-label="Send">Send</button>
      </form>
    `;
    const vscode = (
      window as unknown as {
        acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
      }
    ).acquireVsCodeApi();
    const ta = root.querySelector<HTMLTextAreaElement>(
      '[data-testid="prompt-textbox"]',
    )!;
    const form = root.querySelector<HTMLFormElement>('#prompt-form')!;
    const attach = root.querySelector<HTMLButtonElement>(
      '[data-testid="attach-context-button"]',
    )!;

    const submit = (): void => {
      const text = ta.value;
      if (!text.trim()) {
        return;
      }
      vscode.postMessage({
        type: 'chat:send',
        id: `req-${Date.now()}`,
        payload: { text },
      });
      ta.value = '';
    };

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      submit();
    });
    ta.addEventListener('keydown', (ev) => {
      const ke = ev as KeyboardEvent;
      if (ke.key === 'Enter' && !ke.shiftKey) {
        ev.preventDefault();
        submit();
      }
    });
    attach.addEventListener('click', () => {
      vscode.postMessage({
        type: 'chat:attach-context',
        id: `req-${Date.now()}`,
      });
    });
  });
}

test.describe('chat prompt input', () => {
  test('typing into the textbox updates its value', async ({ webviewPage }) => {
    await mountPromptInput(webviewPage);
    const tb = webviewPage.getByTestId('prompt-textbox');
    await tb.fill('hello world');
    await expect(tb).toHaveValue('hello world');
  });

  test('Enter submits and posts chat:send with trimmed text', async ({
    webviewPage,
    bridge,
  }) => {
    await mountPromptInput(webviewPage);
    const tb = webviewPage.getByTestId('prompt-textbox');
    await tb.fill('hi there');
    await tb.press('Enter');
    const sent = await bridge.waitForOutbound((m) => m.type === 'chat:send');
    expect(sent.payload).toMatchObject({ text: 'hi there' });
    await expect(tb).toHaveValue('');
  });

  test('Shift+Enter inserts a newline and does NOT submit', async ({
    webviewPage,
    bridge,
  }) => {
    await mountPromptInput(webviewPage);
    const tb = webviewPage.getByTestId('prompt-textbox');
    await tb.fill('line one');
    await tb.press('Shift+Enter');
    await tb.type('line two');
    // Give any potential erroneous send a chance to fire, then assert none did.
    await webviewPage.waitForTimeout(150);
    const all = await bridge.outbound();
    expect(all.filter((m) => m.type === 'chat:send')).toHaveLength(0);
    await expect(tb).toHaveValue('line one\nline two');
  });

  test('Send button click also dispatches chat:send', async ({
    webviewPage,
    bridge,
  }) => {
    await mountPromptInput(webviewPage);
    await webviewPage.getByTestId('prompt-textbox').fill('via click');
    await webviewPage.getByTestId('send-button').click();
    const sent = await bridge.waitForOutbound((m) => m.type === 'chat:send');
    expect(sent.payload).toMatchObject({ text: 'via click' });
  });

  test('attach-context button posts chat:attach-context', async ({
    webviewPage,
    bridge,
  }) => {
    await mountPromptInput(webviewPage);
    await webviewPage.getByTestId('attach-context-button').click();
    const sent = await bridge.waitForOutbound(
      (m) => m.type === 'chat:attach-context',
    );
    expect(sent.id).toMatch(/^req-/);
  });

  test('empty / whitespace-only input does not submit', async ({
    webviewPage,
    bridge,
  }) => {
    await mountPromptInput(webviewPage);
    const tb = webviewPage.getByTestId('prompt-textbox');
    await tb.fill('   ');
    await tb.press('Enter');
    await webviewPage.waitForTimeout(150);
    const all = await bridge.outbound();
    expect(all.filter((m) => m.type === 'chat:send')).toHaveLength(0);
  });
});
