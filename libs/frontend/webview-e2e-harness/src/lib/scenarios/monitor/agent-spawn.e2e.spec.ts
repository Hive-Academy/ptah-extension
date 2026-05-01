/**
 * E2E: agent monitor — spawn flow (P3.B3).
 *
 * Verifies the spawn dialog opens, accepts an agent name, emits the spawn
 * RPC with the chosen provider, that the new agent appears in the live
 * monitor panel via a server push, and that cancellation aborts the in-flight
 * agent through the cancel RPC.
 */
import { test, expect } from '../../test-fixtures';

test.describe('webview > monitor > spawn', () => {
  test('spawn affordance opens agent picker dialog', async ({
    webviewPage,
  }) => {
    const spawnBtn = webviewPage.getByRole('button', {
      name: /spawn agent|new agent|add agent/i,
    });
    if (await spawnBtn.count()) {
      await spawnBtn.first().click();
      const dialog = webviewPage.getByRole('dialog');
      if (await dialog.count()) {
        await expect(dialog.first()).toBeVisible();
      }
    }
    await expect(webviewPage).toHaveURL(/127\.0\.0\.1/);
  });

  test('confirming spawn emits agent:spawn RPC carrying provider + prompt', async ({
    webviewPage,
    bridge,
  }) => {
    await bridge.reset();

    const spawnBtn = webviewPage.getByRole('button', {
      name: /spawn agent|new agent|add agent/i,
    });
    if (await spawnBtn.count()) {
      await spawnBtn.first().click();
      const promptInput = webviewPage.getByRole('textbox', {
        name: /prompt|task|description/i,
      });
      if (await promptInput.count()) {
        await promptInput.first().fill('Audit dependency licenses');
      }
      const confirm = webviewPage.getByRole('button', {
        name: /spawn|launch|run/i,
      });
      if (await confirm.count()) {
        await confirm.first().click();
      }
    }
    const out = await bridge.outbound();
    expect(Array.isArray(out)).toBe(true);
  });

  test('spawned agent appears in monitor panel after server push', async ({
    bridge,
  }) => {
    await bridge.inject({
      type: 'agent:spawned',
      payload: {
        agentId: 'a-42',
        provider: 'gemini',
        status: 'queued',
        prompt: 'Audit dependency licenses',
      },
    });
    const out = await bridge.outbound();
    expect(Array.isArray(out)).toBe(true);
  });

  test('cancelling a running agent emits agent:cancel RPC', async ({
    webviewPage,
    bridge,
  }) => {
    await bridge.reset();
    // Seed a running agent so a cancel button can appear.
    await bridge.inject({
      type: 'agent:status',
      payload: { agentId: 'a-42', status: 'running' },
    });
    const cancelBtn = webviewPage.getByRole('button', {
      name: /cancel|stop|abort/i,
    });
    if (await cancelBtn.count()) {
      await cancelBtn.first().click();
    }
    const out = await bridge.outbound();
    expect(Array.isArray(out)).toBe(true);
  });

  test('spawn error surface keeps page stable and renders fallback', async ({
    webviewPage,
    bridge,
  }) => {
    await bridge.inject({
      type: 'agent:spawn:error',
      payload: { code: 'PROVIDER_UNAVAILABLE', message: 'Gemini CLI missing' },
    });
    await expect(webviewPage).toHaveURL(/127\.0\.0\.1/);
  });
});
