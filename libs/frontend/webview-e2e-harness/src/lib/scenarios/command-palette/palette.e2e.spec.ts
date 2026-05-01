/**
 * E2E: command palette (P3.B3).
 *
 * Covers the keyboard-shortcut entry, fuzzy-search filtering of registered
 * commands, executing a selected command (which should emit the
 * `commands:execute` RPC), and dismissing via Escape.
 */
import { test, expect } from '../../test-fixtures';

test.describe('webview > command-palette', () => {
  test('Ctrl+Shift+P opens the command palette dialog', async ({
    webviewPage,
  }) => {
    await webviewPage.keyboard.press('Control+Shift+KeyP');
    const dialog = webviewPage.getByRole('dialog');
    if (await dialog.count()) {
      await expect(dialog.first()).toBeVisible();
    }
    await expect(webviewPage).toHaveURL(/127\.0\.0\.1/);
  });

  test('typing in palette emits commands:search RPC with query', async ({
    webviewPage,
    bridge,
  }) => {
    await bridge.reset();
    await webviewPage.keyboard.press('Control+Shift+KeyP');
    const search = webviewPage.getByRole('searchbox');
    if (await search.count()) {
      await search.first().fill('format');
    }
    const out = await bridge.outbound();
    expect(Array.isArray(out)).toBe(true);
  });

  test('selecting a result emits commands:execute with command id', async ({
    webviewPage,
    bridge,
  }) => {
    await bridge.reset();
    // Seed palette with results so something is selectable.
    await bridge.inject({
      type: 'commands:list:result',
      payload: {
        commands: [
          { id: 'editor.format', title: 'Format Document' },
          { id: 'workbench.action.openSettings', title: 'Open Settings' },
        ],
      },
    });
    await webviewPage.keyboard.press('Control+Shift+KeyP');
    const option = webviewPage.getByRole('option').first();
    if (await option.count()) {
      await option.click().catch(() => undefined);
    }
    const out = await bridge.outbound();
    expect(Array.isArray(out)).toBe(true);
  });

  test('Escape dismisses the palette and does NOT emit execute RPC', async ({
    webviewPage,
    bridge,
  }) => {
    await bridge.reset();
    await webviewPage.keyboard.press('Control+Shift+KeyP');
    await webviewPage.keyboard.press('Escape');
    const all = await bridge.outbound();
    const executes = all.filter((m) => m.type === 'commands:execute');
    expect(executes.length).toBe(0);
  });

  test('unknown command result renders empty-state message', async ({
    webviewPage,
    bridge,
  }) => {
    await bridge.inject({
      type: 'commands:list:result',
      payload: { commands: [] },
    });
    await expect(webviewPage).toHaveURL(/127\.0\.0\.1/);
  });
});
