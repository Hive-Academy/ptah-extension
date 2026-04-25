/**
 * P3.B2 — Chat flow E2E specs: permission prompt dialog.
 *
 * Validates the allow / deny / always-allow handshake. The host sends
 * `permission:request` with `{ id, tool, action }`; the webview shows a
 * dialog and posts back `permission:response` with the user's decision.
 */
import { test, expect } from '../../test-fixtures';

async function mountPermissionDialog(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.evaluate(() => {
    const root = document.getElementById('ptah-e2e-fixture-root');
    if (!root) {
      throw new Error('fixture root missing');
    }
    root.innerHTML = `<div data-testid="permission-host"></div>`;
    const host = root.querySelector<HTMLDivElement>(
      '[data-testid="permission-host"]',
    )!;
    const vscode = (
      window as unknown as {
        acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
      }
    ).acquireVsCodeApi();

    interface PermissionRequest {
      id: string;
      tool: string;
      action: string;
    }

    const respond = (
      id: string,
      decision: 'allow' | 'deny' | 'always-allow',
    ): void => {
      vscode.postMessage({
        type: 'permission:response',
        id,
        payload: { decision },
      });
      // Tear down the dialog.
      host.innerHTML = '';
    };

    const renderDialog = (req: PermissionRequest): void => {
      const dlg = document.createElement('div');
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      dlg.setAttribute('aria-labelledby', 'perm-title');
      dlg.dataset['testid'] = 'permission-dialog';
      dlg.dataset['requestId'] = req.id;
      dlg.innerHTML = `
        <h2 id="perm-title">Allow ${req.tool}?</h2>
        <p data-testid="permission-action">${req.action}</p>
        <button data-testid="permission-allow">Allow</button>
        <button data-testid="permission-deny">Deny</button>
        <button data-testid="permission-always">Always allow</button>
      `;
      host.appendChild(dlg);
      dlg
        .querySelector<HTMLButtonElement>('[data-testid="permission-allow"]')!
        .addEventListener('click', () => respond(req.id, 'allow'));
      dlg
        .querySelector<HTMLButtonElement>('[data-testid="permission-deny"]')!
        .addEventListener('click', () => respond(req.id, 'deny'));
      dlg
        .querySelector<HTMLButtonElement>('[data-testid="permission-always"]')!
        .addEventListener('click', () => respond(req.id, 'always-allow'));
    };

    window.addEventListener('message', (ev) => {
      const data = ev.data as { type?: string; payload?: PermissionRequest };
      if (data?.type === 'permission:request' && data.payload) {
        renderDialog(data.payload);
      }
    });
  });
}

test.describe('chat permission prompt', () => {
  test('opens a dialog when permission:request arrives', async ({
    webviewPage,
    bridge,
  }) => {
    await mountPermissionDialog(webviewPage);
    await bridge.inject({
      type: 'permission:request',
      payload: { id: 'p-1', tool: 'fs.write', action: 'Write to /tmp/x' },
    });
    const dlg = webviewPage.getByTestId('permission-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute('aria-modal', 'true');
    await expect(dlg.getByTestId('permission-action')).toHaveText(
      'Write to /tmp/x',
    );
  });

  test('Allow button posts permission:response{decision:"allow"}', async ({
    webviewPage,
    bridge,
  }) => {
    await mountPermissionDialog(webviewPage);
    await bridge.inject({
      type: 'permission:request',
      payload: { id: 'p-allow', tool: 'fs.read', action: 'Read /a' },
    });
    await webviewPage.getByTestId('permission-allow').click();
    const sent = await bridge.waitForOutbound(
      (m) => m.type === 'permission:response' && m.id === 'p-allow',
    );
    expect(sent.payload).toEqual({ decision: 'allow' });
    await expect(webviewPage.getByTestId('permission-dialog')).toHaveCount(0);
  });

  test('Deny button posts permission:response{decision:"deny"}', async ({
    webviewPage,
    bridge,
  }) => {
    await mountPermissionDialog(webviewPage);
    await bridge.inject({
      type: 'permission:request',
      payload: { id: 'p-deny', tool: 'fs.delete', action: 'rm /b' },
    });
    await webviewPage.getByTestId('permission-deny').click();
    const sent = await bridge.waitForOutbound(
      (m) => m.type === 'permission:response' && m.id === 'p-deny',
    );
    expect(sent.payload).toEqual({ decision: 'deny' });
  });

  test('Always-allow posts decision:"always-allow"', async ({
    webviewPage,
    bridge,
  }) => {
    await mountPermissionDialog(webviewPage);
    await bridge.inject({
      type: 'permission:request',
      payload: { id: 'p-always', tool: 'net.fetch', action: 'GET https://x' },
    });
    await webviewPage.getByTestId('permission-always').click();
    const sent = await bridge.waitForOutbound(
      (m) => m.type === 'permission:response' && m.id === 'p-always',
    );
    expect(sent.payload).toEqual({ decision: 'always-allow' });
  });
});
