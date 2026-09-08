import { randomUUID } from 'crypto';
import type { Locator } from '@playwright/test';
import { test, expect } from '../../support/fixtures';

const SHARED_SESSION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const FABLE_MODEL_ID = 'claude-fable-5-1[1m]';
const RESTORED_TRANSCRIPT = 'PTAH_E2E_COMPACTION_RESTORED_TRANSCRIPT';
const COMPACTION_SUMMARY = 'Earlier context was compacted into this summary.';

interface ObservedRpcCall {
  method: string;
  params: unknown;
}

function tabIdFrom(call: ObservedRpcCall): string {
  const params = call.params as { tabId?: unknown };
  expect(typeof params.tabId).toBe('string');
  return params.tabId as string;
}

function turnStateIdle(tabId: string, revision: number) {
  return {
    type: 'chat:chunk',
    payload: {
      tabId,
      sessionId: SHARED_SESSION_ID,
      event: {
        id: randomUUID(),
        eventType: 'turn_state',
        timestamp: Date.now(),
        sessionId: SHARED_SESSION_ID,
        messageId: `turn-state-${tabId}-${revision}`,
        phase: 'idle',
        revision,
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: 'completed',
      },
    },
  };
}

async function chooseFableModel(tile: Locator): Promise<void> {
  const selector = tile.locator('ptah-model-selector');
  const trigger = selector.locator('button').first();
  await trigger.click();
  await selector.getByText('Fable Test', { exact: true }).click();
  await expect(selector.locator('span[title="Fable Test"]')).toBeVisible();
}

test.describe('Compaction recovery for duplicate visible session tiles (TASK_2026_391)', () => {
  test('restores both tiles in place when /compact originates from the non-first same-session tile', async ({
    ui,
  }) => {
    const page = ui.page;
    await ui.mockRpc({
      'config:models-list': {
        models: [
          {
            id: 'default',
            name: 'Default',
            description: 'Global default model',
            isSelected: true,
            providerModelId: null,
          },
          {
            id: FABLE_MODEL_ID,
            name: 'Fable Test',
            description: 'Per-tile selected model',
            isSelected: false,
            providerModelId: null,
          },
        ],
      },
      'session:list': { sessions: [], total: 0, hasMore: false },
      'session:validate': { exists: true },
      'chat:start': { success: true },
      'chat:continue': { success: true },
      'session:load': {},
      'chat:resume': {
        messages: [
          {
            id: randomUUID(),
            role: 'user',
            timestamp: Date.now(),
            content: 'Please continue after compaction.',
          },
          {
            id: randomUUID(),
            role: 'assistant',
            timestamp: Date.now() + 1,
            content: RESTORED_TRANSCRIPT,
          },
        ],
        stats: {
          totalCost: 35.668,
          tokens: {
            input: 200_000,
            output: 26_000,
            cacheRead: 728,
            cacheCreation: 0,
          },
          messageCount: 2,
          model: FABLE_MODEL_ID,
        },
      },
    });

    await ui.goto('chat');
    const tiles = page.locator('[data-testid="canvas-tile"]');
    await expect(tiles).toHaveCount(1);

    const firstTile = tiles.nth(0);
    await chooseFableModel(firstTile);
    await firstTile
      .locator('ptah-chat-input textarea[role="combobox"]')
      .fill('Bind the first tile');
    await firstTile.locator('[data-testid="chat-send-btn"]').click();
    await expect
      .poll(async () => (await ui.getObservedCalls('chat:start')).length)
      .toBe(1);
    const firstTabId = tabIdFrom(
      (await ui.getObservedCalls('chat:start'))[0],
    );
    await ui.pushEvent({
      type: 'session:id-resolved',
      payload: { tabId: firstTabId, realSessionId: SHARED_SESSION_ID },
    });
    await ui.pushEvent(turnStateIdle(firstTabId, 1));

    await page.locator('[title="Add new session tile"]').click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(tiles).toHaveCount(2);

    const secondTile = tiles.nth(1);
    await chooseFableModel(secondTile);
    await secondTile
      .locator('ptah-chat-input textarea[role="combobox"]')
      .fill('Bind the second tile');
    await secondTile.locator('[data-testid="chat-send-btn"]').click();
    await expect
      .poll(async () => (await ui.getObservedCalls('chat:start')).length)
      .toBe(2);
    const secondTabId = tabIdFrom(
      (await ui.getObservedCalls('chat:start'))[1],
    );
    expect(secondTabId).not.toBe(firstTabId);
    await ui.pushEvent({
      type: 'session:id-resolved',
      payload: { tabId: secondTabId, realSessionId: SHARED_SESSION_ID },
    });
    // Routing this event from the second real tile binds it to the existing
    // conversation that already contains SHARED_SESSION_ID. From this point
    // the renderer genuinely has two visible same-conversation/session tiles.
    await ui.pushEvent(turnStateIdle(secondTabId, 2));

    await secondTile
      .locator('ptah-chat-input textarea[role="combobox"]')
      .fill('/compact');
    await secondTile.locator('[data-testid="chat-send-btn"]').click();
    await expect
      .poll(async () => (await ui.getObservedCalls('chat:continue')).length)
      .toBe(1);
    const compactCall = (await ui.getObservedCalls('chat:continue'))[0];
    expect(compactCall.params).toEqual(
      expect.objectContaining({
        prompt: '/compact',
        sessionId: SHARED_SESSION_ID,
        tabId: secondTabId,
        model: FABLE_MODEL_ID,
      }),
    );

    const resumeBaseline = (await ui.getObservedCalls('chat:resume')).length;
    await ui.pushEvent({
      type: 'session:compactionComplete',
      payload: {
        sessionId: SHARED_SESSION_ID,
        cwd: 'C:\\ptah-e2e-ws',
        trigger: 'manual',
        compactSummary: COMPACTION_SUMMARY,
        timestamp: Date.now(),
      },
    });
    await ui.pushEvent({
      type: 'chat:chunk',
      payload: {
        tabId: secondTabId,
        sessionId: SHARED_SESSION_ID,
        event: {
          id: randomUUID(),
          eventType: 'compaction_complete',
          timestamp: Date.now(),
          sessionId: SHARED_SESSION_ID,
          trigger: 'manual',
          preTokens: 8_000,
          postTokens: 1_500,
          durationMs: 1_250,
          source: 'stream',
        },
      },
    });

    // This is the regression boundary: the old session-only in-flight guard
    // issued one reload, and openSessionTab re-selected the first matching tab.
    // The fixed path must issue one explicit resume for each original tab.
    await expect
      .poll(async () => (await ui.getObservedCalls('chat:resume')).length)
      .toBe(resumeBaseline + 2);
    const resumeTabIds = (await ui.getObservedCalls('chat:resume'))
      .slice(resumeBaseline)
      .map(tabIdFrom)
      .sort();
    expect(resumeTabIds).toEqual([firstTabId, secondTabId].sort());

    for (const tile of [firstTile, secondTile]) {
      await expect(tile.locator('[data-testid="chat-tool-output"]')).toContainText(
        RESTORED_TRANSCRIPT,
      );

      const stats = tile.locator('ptah-session-stats-summary');
      await expect(stats).toContainText('Tokens');
      await expect(stats).toContainText('226.7k');
      await expect(stats).toContainText('Cost');
      await expect(stats).toContainText('$35.67');
      await expect(stats).toContainText('Compactions');
      await expect(stats).toContainText('1');

      const marker = tile.locator('ptah-compaction-marker');
      await expect(marker).toContainText('Context compacted');
      await expect(marker).toContainText('8,000');
      await expect(marker).toContainText('1,500');
      await expect(marker).toContainText('1.3s');

      await expect(
        tile.locator('ptah-model-selector span[title="Fable Test"]'),
      ).toBeVisible();
    }

    await secondTile
      .locator('ptah-compaction-marker')
      .getByRole('button', { name: 'View' })
      .click();
    await expect(
      secondTile.locator('ptah-compaction-marker dialog'),
    ).toContainText(COMPACTION_SUMMARY);

    // A targeted compaction reload must not create a third tile or activate
    // the array-first match. The non-first origin remains focused throughout.
    await expect(tiles).toHaveCount(2);
    await expect(firstTile.locator('.canvas-tile')).toHaveAttribute(
      'data-focused',
      'false',
    );
    await expect(secondTile.locator('.canvas-tile')).toHaveAttribute(
      'data-focused',
      'true',
    );
  });
});
