import { test, expect } from '../../support/fixtures';
import type { UiDriver } from '../../support/ui-driver';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

function flatEvent(
  eventType: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: `evt-${eventType}-${Math.random().toString(36).slice(2)}`,
    eventType,
    timestamp: 1_700_000_000_000,
    sessionId: SESSION_ID,
    messageId: 'e2e-assistant-msg-1',
    ...extra,
  };
}

function chunk(tabId: string, event: Record<string, unknown>) {
  return {
    type: 'chat:chunk',
    payload: { tabId, sessionId: SESSION_ID, event },
  };
}

async function captureTabIdFromSend(ui: UiDriver): Promise<string> {
  const observed = await ui.waitForObservedCall('chat:start');
  const params = observed.params as { tabId?: string };
  const tabId = params?.tabId;
  if (!tabId) {
    throw new Error('chat:start did not carry a tabId in params');
  }
  return tabId;
}

async function sendMessage(ui: UiDriver, text: string): Promise<string> {
  await ui.mockRpc({ 'chat:start': { success: true } });
  const textarea = ui.page.locator('ptah-chat-input textarea[role="combobox"]');
  await textarea.fill(text);
  await ui.page.locator('[data-testid="chat-send-btn"]').click();
  return captureTabIdFromSend(ui);
}

test.describe('Chat — streaming', () => {
  test('empty chat renders with input present', async ({ ui }) => {
    await ui.goto('chat');

    const textarea = ui.page.locator(
      'ptah-chat-input textarea[role="combobox"]',
    );
    await expect(textarea).toBeVisible();
    await expect(
      ui.page.locator('[data-testid="chat-send-btn"]'),
    ).toBeVisible();
    await expect(ui.page.locator('ptah-chat-empty-state')).toBeVisible();
  });

  test('send dispatches chat:start', async ({ ui }) => {
    await ui.goto('chat');

    const tabId = await sendMessage(ui, 'Run the build');
    expect(tabId).toBeTruthy();

    const userBubble = ui.page.locator('ptah-message-bubble .chat-end');
    await expect(userBubble.first()).toBeVisible();
    await expect(userBubble.first()).toContainText('Run the build');
  });

  test('streamed assistant turn renders text + tool output', async ({ ui }) => {
    await ui.goto('chat');
    await ui.forceVisible();

    const tabId = await sendMessage(ui, 'Run the build');

    await ui.pushEvent(
      chunk(tabId, flatEvent('message_start', { role: 'assistant' })),
    );
    await ui.pushEvent(
      chunk(
        tabId,
        flatEvent('text_delta', { delta: 'Building…', blockIndex: 0 }),
      ),
    );
    await ui.pushEvent(
      chunk(
        tabId,
        flatEvent('tool_start', {
          toolCallId: 't1',
          toolName: 'Bash',
          toolInput: { command: 'npm run build' },
          isTaskTool: false,
        }),
      ),
    );
    await ui.pushEvent(
      chunk(
        tabId,
        flatEvent('tool_result', {
          toolCallId: 't1',
          output: 'build ok',
          isError: false,
        }),
      ),
    );
    await ui.pushEvent(
      chunk(tabId, flatEvent('message_complete', { stopReason: 'end_turn' })),
    );

    const assistantBubble = ui.page.locator(
      'ptah-message-bubble .chat-start [data-testid="chat-tool-output"]',
    );
    await expect(assistantBubble.first()).toContainText('Building…');

    const toolCard = assistantBubble.locator('ptah-tool-call-item');
    await expect(toolCard.first()).toBeVisible();
    await expect(toolCard.first()).toContainText('Bash');

    await ui.pushEvent({
      type: 'session:turnEnded',
      payload: {
        sessionId: SESSION_ID,
        cwd: 'C:\\ptah-e2e-ws',
        lastAssistantMessage: 'Building…',
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: null,
        timestamp: 1_700_000_000_001,
      },
    });
    await ui.pushEvent({
      type: 'session:stats',
      payload: {
        sessionId: SESSION_ID,
        cost: 0.01,
        tokens: { input: 10, output: 20 },
        duration: 1234,
      },
    });

    await expect(ui.page.locator('[data-testid="chat-stop-btn"]')).toHaveCount(
      0,
    );
  });

  test('batched turn renders identically', async ({ ui }) => {
    await ui.goto('chat');
    await ui.forceVisible();

    const tabId = await sendMessage(ui, 'Run the build');

    await ui.pushBatch([
      chunk(tabId, flatEvent('message_start', { role: 'assistant' })),
      chunk(
        tabId,
        flatEvent('text_delta', { delta: 'Building…', blockIndex: 0 }),
      ),
      chunk(
        tabId,
        flatEvent('tool_start', {
          toolCallId: 't1',
          toolName: 'Bash',
          toolInput: { command: 'npm run build' },
          isTaskTool: false,
        }),
      ),
      chunk(
        tabId,
        flatEvent('tool_result', {
          toolCallId: 't1',
          output: 'build ok',
          isError: false,
        }),
      ),
      chunk(tabId, flatEvent('message_complete', { stopReason: 'end_turn' })),
    ]);

    const assistantBubble = ui.page.locator(
      'ptah-message-bubble .chat-start [data-testid="chat-tool-output"]',
    );
    await expect(assistantBubble.first()).toContainText('Building…');
    await expect(
      assistantBubble.locator('ptah-tool-call-item').first(),
    ).toContainText('Bash');
  });
});
