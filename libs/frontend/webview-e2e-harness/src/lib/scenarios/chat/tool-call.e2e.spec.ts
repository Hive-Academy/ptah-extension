/**
 * Chat flow E2E specs: tool-call card render.
 *
 * Exercises the tool-call portion of the streaming protocol:
 *   - `tool:call`   — host announces a tool invocation
 *   - `tool:result` — host returns the result for a previously announced call
 * Multi-tool ordering is validated by interleaving multiple `tool:call`
 * events with mixed-order `tool:result` arrivals and asserting each card
 * resolves to its own result.
 */
import { test, expect } from '../../test-fixtures';

async function mountToolCallSurface(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.evaluate(() => {
    const root = document.getElementById('ptah-e2e-fixture-root');
    if (!root) {
      throw new Error('fixture root missing');
    }
    root.innerHTML = `<div data-testid="tool-call-list"></div>`;
    const list = root.querySelector<HTMLDivElement>(
      '[data-testid="tool-call-list"]',
    )!;

    interface ToolCall {
      id: string;
      name: string;
      args: unknown;
    }
    interface ToolResult {
      id: string;
      result: unknown;
    }

    const renderCard = (call: ToolCall): void => {
      const card = document.createElement('div');
      card.dataset['testid'] = `tool-call-${call.id}`;
      card.dataset['toolId'] = call.id;
      card.dataset['state'] = 'pending';
      card.innerHTML = `
        <div data-testid="tool-name">${call.name}</div>
        <button data-testid="expand-${call.id}">Expand</button>
        <div data-testid="result-${call.id}" hidden></div>
      `;
      list.appendChild(card);
      const expand = card.querySelector<HTMLButtonElement>(
        `[data-testid="expand-${call.id}"]`,
      )!;
      expand.addEventListener('click', () => {
        const r = card.querySelector<HTMLDivElement>(
          `[data-testid="result-${call.id}"]`,
        )!;
        r.hidden = !r.hidden;
      });
    };

    const applyResult = (result: ToolResult): void => {
      const card = list.querySelector<HTMLDivElement>(
        `[data-testid="tool-call-${result.id}"]`,
      );
      if (!card) {
        return;
      }
      card.dataset['state'] = 'done';
      const r = card.querySelector<HTMLDivElement>(
        `[data-testid="result-${result.id}"]`,
      )!;
      r.textContent = JSON.stringify(result.result);
    };

    window.addEventListener('message', (ev) => {
      const data = ev.data as { type?: string; payload?: unknown };
      if (!data || typeof data.type !== 'string') {
        return;
      }
      if (data.type === 'tool:call') {
        renderCard(data.payload as ToolCall);
      } else if (data.type === 'tool:result') {
        applyResult(data.payload as ToolResult);
      }
    });
  });
}

test.describe('chat tool-call rendering', () => {
  test('renders a card on tool:call with pending state', async ({
    webviewPage,
    bridge,
  }) => {
    await mountToolCallSurface(webviewPage);
    await bridge.inject({
      type: 'tool:call',
      payload: { id: 'tc-1', name: 'read_file', args: { path: '/a.txt' } },
    });
    const card = webviewPage.getByTestId('tool-call-tc-1');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-state', 'pending');
    await expect(card.getByTestId('tool-name')).toHaveText('read_file');
  });

  test('expands to reveal result text on click after tool:result', async ({
    webviewPage,
    bridge,
  }) => {
    await mountToolCallSurface(webviewPage);
    await bridge.inject({
      type: 'tool:call',
      payload: { id: 'tc-2', name: 'list_dir', args: {} },
    });
    await bridge.inject({
      type: 'tool:result',
      payload: { id: 'tc-2', result: { entries: ['a', 'b'] } },
    });
    const card = webviewPage.getByTestId('tool-call-tc-2');
    await expect(card).toHaveAttribute('data-state', 'done');
    const result = card.getByTestId('result-tc-2');
    await expect(result).toBeHidden();
    await card.getByTestId('expand-tc-2').click();
    await expect(result).toContainText('"entries"');
  });

  test('preserves order across multiple interleaved tool calls', async ({
    webviewPage,
    bridge,
  }) => {
    await mountToolCallSurface(webviewPage);
    await bridge.inject({
      type: 'tool:call',
      payload: { id: 'a', name: 'first', args: {} },
    });
    await bridge.inject({
      type: 'tool:call',
      payload: { id: 'b', name: 'second', args: {} },
    });
    await bridge.inject({
      type: 'tool:call',
      payload: { id: 'c', name: 'third', args: {} },
    });
    // Verify DOM order matches arrival order.
    const ids = await webviewPage.evaluate(() => {
      return Array.from(
        document.querySelectorAll<HTMLDivElement>(
          '[data-testid="tool-call-list"] > div',
        ),
      ).map((el) => el.dataset['toolId']);
    });
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  test('out-of-order results land on the right cards', async ({
    webviewPage,
    bridge,
  }) => {
    await mountToolCallSurface(webviewPage);
    await bridge.inject({
      type: 'tool:call',
      payload: { id: 'a', name: 'first', args: {} },
    });
    await bridge.inject({
      type: 'tool:call',
      payload: { id: 'b', name: 'second', args: {} },
    });
    // Results arrive reversed.
    await bridge.inject({
      type: 'tool:result',
      payload: { id: 'b', result: 'B-RESULT' },
    });
    await bridge.inject({
      type: 'tool:result',
      payload: { id: 'a', result: 'A-RESULT' },
    });
    await webviewPage.getByTestId('expand-a').click();
    await webviewPage.getByTestId('expand-b').click();
    await expect(webviewPage.getByTestId('result-a')).toContainText('A-RESULT');
    await expect(webviewPage.getByTestId('result-b')).toContainText('B-RESULT');
  });
});
